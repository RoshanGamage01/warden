import Fastify from 'fastify';
import { Registry, Gauge, Counter, collectDefaultMetrics } from 'prom-client';
import { AppEntry } from '../core/types.js';
import { MetricsStore } from '../metrics/store.js';
import { computeUptime } from '../core/utils.js';
import { DEFAULT_API_PORT, DEFAULT_API_HOST } from '../core/constants.js';

interface ApiServerOpts {
  host?: string;
  port?: number;
  getEntries: () => AppEntry[];
  store: MetricsStore;
}

export async function createApiServer(opts: ApiServerOpts): Promise<{
  start: () => Promise<void>;
  stop: () => Promise<void>;
  port: number;
}> {
  const { host = DEFAULT_API_HOST, port = DEFAULT_API_PORT } = opts;

  // ── Prometheus registry ──────────────────────────────────────────────

  const register = new Registry();
  register.setDefaultLabels({ app: 'warden' });
  collectDefaultMetrics({ register });

  const pmCpu = new Gauge({
    name: 'warden_process_cpu_percent',
    help: 'CPU usage of a managed process',
    labelNames: ['warden_id', 'name'],
    registers: [register],
  });

  const pmMemory = new Gauge({
    name: 'warden_process_memory_bytes',
    help: 'Memory usage of a managed process in bytes',
    labelNames: ['warden_id', 'name'],
    registers: [register],
  });

  const pmRestarts = new Gauge({
    name: 'warden_process_restarts_total',
    help: 'Total restart count of a managed process',
    labelNames: ['warden_id', 'name'],
    registers: [register],
  });

  const pmUptime = new Gauge({
    name: 'warden_process_uptime_seconds',
    help: 'Uptime of a managed process in seconds',
    labelNames: ['warden_id', 'name'],
    registers: [register],
  });

  const pmStatus = new Gauge({
    name: 'warden_process_online',
    help: '1 if process is online, 0 otherwise',
    labelNames: ['warden_id', 'name', 'status'],
    registers: [register],
  });

  // ── HTTP server ──────────────────────────────────────────────────────

  const app = Fastify({ logger: false, disableRequestLogging: true });

  app.get('/health', async () => ({ status: 'ok', pid: process.pid }));

  app.get('/processes', async () => {
    const entries = opts.getEntries();
    return entries.map((e) => formatEntry(e, opts.store));
  });

  app.get<{ Params: { id: string } }>('/processes/:id', async (req, reply) => {
    const entries = opts.getEntries();
    const warden_id = parseInt(req.params.id, 10);
    const entry = entries.find((e) => e.warden_id === warden_id || e.name === req.params.id);
    if (!entry) return reply.status(404).send({ error: 'not found' });
    const recent = opts.store.getRecent(entry.warden_id, 120);
    return { ...formatEntry(entry, opts.store), recent };
  });

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    '/processes/:id/metrics',
    async (req, reply) => {
      const entries = opts.getEntries();
      const entry = entries.find(
        (e) => e.warden_id === parseInt(req.params.id, 10) || e.name === req.params.id
      );
      if (!entry) return reply.status(404).send({ error: 'not found' });

      const rangeMs = parseRange(req.query.range ?? '1h');
      const now = Date.now();
      const points = opts.store.getRange(entry.warden_id, now - rangeMs, now);
      return { warden_id: entry.warden_id, name: entry.name, points };
    }
  );

  app.get('/summary', async () => {
    const entries = opts.getEntries();
    const online = entries.filter((e) => e.status === 'online').length;
    const errored = entries.filter((e) => e.status === 'errored').length;

    let totalCpu = 0;
    let totalMem = 0;
    for (const e of entries) {
      const latest = opts.store.getLatest(e.warden_id);
      if (latest) {
        totalCpu += latest.cpu;
        totalMem += latest.memory;
      }
    }

    return {
      total: entries.length,
      online,
      stopped: entries.filter((e) => e.status === 'stopped').length,
      errored,
      launching: entries.filter((e) => e.status === 'launching').length,
      total_cpu_percent: parseFloat(totalCpu.toFixed(2)),
      total_memory_bytes: totalMem,
    };
  });

  app.get('/metrics', async (req, reply) => {
    // Refresh Prometheus gauges from latest metrics
    const entries = opts.getEntries();
    for (const e of entries) {
      const labels = { warden_id: String(e.warden_id), name: e.name };
      const latest = opts.store.getLatest(e.warden_id);
      pmCpu.set(labels, latest?.cpu ?? 0);
      pmMemory.set(labels, latest?.memory ?? 0);
      pmRestarts.set(labels, e.restarts);
      pmUptime.set(labels, computeUptime(e) / 1000);
      pmStatus.set({ ...labels, status: e.status }, e.status === 'online' ? 1 : 0);
    }

    const text = await register.metrics();
    return reply
      .header('Content-Type', register.contentType)
      .send(text);
  });

  return {
    start: async () => {
      await app.listen({ port, host });
    },
    stop: async () => {
      await app.close();
    },
    port,
  };
}

function formatEntry(entry: AppEntry, store: MetricsStore) {
  const latest = store.getLatest(entry.warden_id);
  return {
    warden_id: entry.warden_id,
    name: entry.name,
    status: entry.status,
    pid: entry.pid,
    exec_mode: entry.exec_mode,
    instances: entry.instances,
    restarts: entry.restarts,
    uptime: computeUptime(entry),
    cpu: latest?.cpu ?? 0,
    memory: latest?.memory ?? 0,
    script: entry.script,
    cwd: entry.cwd,
    out_log_path: entry.out_log_path,
    err_log_path: entry.err_log_path,
    instances_list: entry.instances_list,
    created_at: entry.created_at,
  };
}

function parseRange(r: string): number {
  const lower = r.toLowerCase();
  const n = parseFloat(lower);
  if (lower.endsWith('d')) return n * 86_400_000;
  if (lower.endsWith('h')) return n * 3_600_000;
  if (lower.endsWith('m')) return n * 60_000;
  if (lower.endsWith('s')) return n * 1_000;
  return 3_600_000; // default 1h
}
