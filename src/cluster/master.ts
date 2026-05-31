/**
 * Cluster master process.
 *
 * Spawned by ClusterManager via child_process.fork(). Manages N cluster
 * workers, reports status back via process IPC, and handles reload/scale
 * messages from the parent daemon.
 *
 * Environment variables set by ClusterManager:
 *   WARDEN_EXEC_SCRIPT   - absolute path of the user script
 *   WARDEN_INSTANCES     - number of initial workers
 *   WARDEN_ID            - the app's warden_id (forwarded to workers)
 *   WARDEN_NODE_ARGS     - JSON array of node args for workers
 */

import cluster from 'cluster';
import path from 'path';

const EXEC_SCRIPT = process.env.WARDEN_EXEC_SCRIPT!;
const INSTANCES = parseInt(process.env.WARDEN_INSTANCES ?? '1', 10);
const WARDEN_ID = process.env.WARDEN_ID ?? '0';
const NODE_ARGS: string[] = JSON.parse(process.env.WARDEN_NODE_ARGS ?? '[]');

if (!EXEC_SCRIPT) {
  process.stderr.write('[cluster-master] WARDEN_EXEC_SCRIPT not set\n');
  process.exit(1);
}

// Worker wrapper script that loads the user script
const WORKER_ENTRY = path.resolve(__dirname, 'worker-entry.js');

cluster.setupPrimary({
  exec: WORKER_ENTRY,
  args: [],
  execArgv: NODE_ARGS,
  silent: false,
});

// ── State ─────────────────────────────────────────────────────────────────

interface WorkerState {
  instanceId: number;
  pid: number | null;
  status: 'launching' | 'online' | 'stopping' | 'stopped' | 'errored';
  restarts: number;
  uptime: number | null;
  stable: boolean;
}

const workers = new Map<number, WorkerState>(); // instanceId -> state
let nextInstanceId = 0;

function send(msg: object): void {
  if (process.send) process.send(msg);
}

function workerCount(): number {
  return workers.size;
}

// ── Worker lifecycle ──────────────────────────────────────────────────────

function forkWorker(instanceId?: number): void {
  const id = instanceId ?? nextInstanceId++;
  const w = cluster.fork({
    WARDEN_EXEC_SCRIPT: EXEC_SCRIPT,
    WARDEN_ID,
    WARDEN_WORKER_INSTANCE: String(id),
  });

  const state: WorkerState = {
    instanceId: id,
    pid: w.process.pid ?? null,
    status: 'launching',
    restarts: 0,
    uptime: null,
    stable: false,
  };
  workers.set(id, state);

  (w as NodeJS.EventEmitter & typeof w).on('online', () => {
    state.status = 'online';
    state.pid = w.process.pid ?? null;
    state.uptime = Date.now();
    send({ type: 'worker_online', instanceId: id, pid: state.pid });
    // stability timer
    setTimeout(() => { state.stable = true; }, 1_000);
  });

  (w as NodeJS.EventEmitter & typeof w).on('exit', (code, signal) => {
    state.pid = null;
    state.uptime = null;

    if (state.status === 'stopping') {
      state.status = 'stopped';
      workers.delete(id);
      send({ type: 'worker_exit', instanceId: id, code, signal, intentional: true });
      return;
    }

    state.restarts += 1;
    state.status = 'launching';
    send({ type: 'worker_exit', instanceId: id, code, signal, intentional: false });

    // Auto-restart
    setTimeout(() => forkWorker(id), 500);
  });
}

// ── Rolling reload ────────────────────────────────────────────────────────

async function rollingReload(): Promise<void> {
  const oldIds = Array.from(workers.keys());
  for (const id of oldIds) {
    // Spawn new worker
    const newId = nextInstanceId++;
    forkWorker(newId);

    // Wait for new worker to come online (max 10s)
    await waitForOnline(newId, 10_000);

    // Kill old worker gracefully
    const oldState = workers.get(id);
    if (oldState) {
      oldState.status = 'stopping';
      const w = getClusterWorker(id);
      if (w) w.process.kill('SIGTERM');
      await waitForExit(id, 5_000);
    }
  }
  send({ type: 'reload_done' });
}

function getClusterWorker(instanceId: number) {
  for (const w of Object.values(cluster.workers ?? {})) {
    if (!w) continue;
    const env = (w.process as NodeJS.Process & { env?: Record<string, string> }).env;
    if (env?.WARDEN_WORKER_INSTANCE === String(instanceId)) return w;
  }
  return null;
}

function waitForOnline(instanceId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    const interval = setInterval(() => {
      const s = workers.get(instanceId);
      if (s?.status === 'online') {
        clearTimeout(t);
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}

function waitForExit(instanceId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    const interval = setInterval(() => {
      if (!workers.has(instanceId)) {
        clearTimeout(t);
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}

// ── Scale ─────────────────────────────────────────────────────────────────

async function scaleWorkers(target: number): Promise<void> {
  const current = workers.size;
  if (target > current) {
    for (let i = 0; i < target - current; i++) forkWorker();
  } else if (target < current) {
    const toKill = Array.from(workers.keys()).slice(target);
    for (const id of toKill) {
      const state = workers.get(id)!;
      state.status = 'stopping';
      const w = getClusterWorker(id);
      if (w) w.process.kill('SIGTERM');
    }
  }
  send({ type: 'scale_done', instances: target });
}

// ── Message handler ───────────────────────────────────────────────────────

process.on('message', (msg: { type: string; instances?: number }) => {
  switch (msg.type) {
    case 'reload':
      rollingReload().catch((e) =>
        send({ type: 'error', message: String(e) })
      );
      break;
    case 'scale':
      scaleWorkers(msg.instances ?? 1).catch((e) =>
        send({ type: 'error', message: String(e) })
      );
      break;
    case 'stop':
      for (const [id, state] of workers) {
        state.status = 'stopping';
        const w = getClusterWorker(id);
        if (w) w.process.kill('SIGTERM');
      }
      setTimeout(() => process.exit(0), 2_000);
      break;
    case 'status':
      send({
        type: 'status',
        workers: Array.from(workers.values()),
      });
      break;
  }
});

// ── Initial spawn ─────────────────────────────────────────────────────────

for (let i = 0; i < INSTANCES; i++) {
  forkWorker();
}

send({ type: 'ready' });

// Prevent master from exiting
setInterval(() => { /* keep-alive */ }, 30_000).unref();
