import path from 'path';
import { AppRegistry } from '../core/app-registry.js';
import { IpcConnection } from '../ipc/server.js';
import { WatchManager } from '../watch/watcher.js';
import { CronScheduler } from '../cron/scheduler.js';
import { MetricsStore } from '../metrics/store.js';
import { MetricsSampler } from '../metrics/sampler.js';
import { computeUptime } from '../core/utils.js';
import { save, loadDump } from '../core/persistence.js';
import { generateStartupScript, removeStartupScript } from '../startup/index.js';
import { AppConfig, LogEvent } from '../core/types.js';
import { VERSION, WARDEN_SOCKET_PATH, DEFAULT_API_PORT } from '../core/constants.js';
import { LogManager } from '../logs/manager.js';

export class DaemonRouter {
  private logSubscriptions = new Map<
    IpcConnection,
    { warden_id: number | null; unsubs: (() => void)[] }
  >();
  private daemonStartedAt = Date.now();

  constructor(
    private readonly registry: AppRegistry,
    private readonly watchManager: WatchManager,
    private readonly cronScheduler: CronScheduler,
    private readonly store: MetricsStore,
    private readonly sampler: MetricsSampler
  ) {
    // Forward log events to streaming connections
    registry.on('log', (ev: LogEvent) => {
      this.broadcastLog(ev);
    });
  }

  // ── RPC dispatch ──────────────────────────────────────────────────────

  async handle(method: string, params: unknown, conn: IpcConnection): Promise<unknown> {
    const p = params as Record<string, unknown> | undefined;

    switch (method) {
      case 'start':
        return this.handleStart(p as AppConfig, conn);

      case 'stop':
        return this.handleStop(p as { id: string | number });

      case 'restart':
        return this.handleRestart(p as { id: string | number });

      case 'reload':
        return this.handleReload(p as { id: string | number });

      case 'delete':
        return this.handleDelete(p as { id: string | number });

      case 'list':
        return this.handleList();

      case 'describe':
        return this.handleDescribe(p as { id: string | number });

      case 'save':
        return this.handleSave();

      case 'resurrect':
        return this.handleResurrect();

      case 'flush':
        return this.handleFlush(p as { id?: string | number });

      case 'scale':
        return this.handleScale(p as { id: string | number; instances: number });

      case 'reset':
        return this.handleReset(p as { id: string | number });

      case 'startup':
        return this.handleStartup(p as { platform?: string });

      case 'unstartup':
        return this.handleUnstartup(p as { platform?: string });

      case 'info':
        return this.handleInfo();

      case 'logs_subscribe':
        return this.handleLogsSubscribe(
          p as { warden_id?: number; lines?: number },
          conn
        );

      case 'logs_unsubscribe':
        return this.handleLogsUnsubscribe(conn);

      case 'metrics':
        return this.handleMetrics(p as { id: string | number });

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────

  private async handleStart(config: AppConfig, conn: IpcConnection) {
    if (!config?.script) throw new Error('script is required');

    // If name matches an existing entry, update config and restart
    const existing = config.name ? this.registry.get(config.name) : undefined;
    if (existing) {
      // Just restart with new config
      await this.registry.restart(existing.warden_id);
      const entry = this.registry.getById(existing.warden_id)!;
      this.afterStart(entry);
      return entry;
    }

    const entry = this.registry.register(config);
    this.registry.start(entry);
    this.afterStart(entry);
    return entry;
  }

  private afterStart(entry: import('../core/types.js').AppEntry): void {
    if (entry.watch) this.watchManager.watch(entry);
    if (entry.cron_restart) this.cronScheduler.schedule(entry);
  }

  private async handleStop(p: { id: string | number }) {
    await this.registry.stop(p.id);
    this.watchManager.unwatch(this.idToNumber(p.id));
    this.cronScheduler.unschedule(this.idToNumber(p.id));
    return null;
  }

  private async handleRestart(p: { id: string | number }) {
    await this.registry.restart(p.id);
    return null;
  }

  private async handleReload(p: { id: string | number }) {
    await this.registry.reload(p.id);
    return null;
  }

  private async handleDelete(p: { id: string | number }) {
    const entry = this.registry.get(p.id);
    if (entry) {
      this.watchManager.unwatch(entry.warden_id);
      this.cronScheduler.unschedule(entry.warden_id);
      this.store.deleteProcess(entry.warden_id);
    }
    await this.registry.delete(p.id);
    return null;
  }

  private handleList() {
    return this.registry.list().map((e) => ({
      ...e,
      uptime: computeUptime(e),
    }));
  }

  private handleDescribe(p: { id: string | number }) {
    const entry = this.registry.get(p.id);
    if (!entry) throw new Error(`Process '${p.id}' not found`);
    const recent = this.store.getRecent(entry.warden_id, 60);
    return { ...entry, uptime: computeUptime(entry), recent };
  }

  private handleSave() {
    save(this.registry.list());
    return null;
  }

  private handleResurrect() {
    const dump = loadDump();
    let count = 0;
    for (const item of dump) {
      const existing = this.registry.get(item.name);
      if (!existing && (item.status === 'online' || item.status === 'launching')) {
        const entry = this.registry.register(item.config);
        this.registry.start(entry);
        this.afterStart(entry);
        count++;
      }
    }
    return { resurrected: count };
  }

  private handleFlush(p: { id?: string | number }) {
    if (p?.id !== undefined) {
      const entry = this.registry.get(p.id);
      if (!entry) throw new Error(`Process '${p.id}' not found`);
      this.registry.logManager.flush(entry.out_log_path);
      if (!entry.merge_logs) this.registry.logManager.flush(entry.err_log_path);
    } else {
      for (const entry of this.registry.list()) {
        this.registry.logManager.flush(entry.out_log_path);
        if (!entry.merge_logs) this.registry.logManager.flush(entry.err_log_path);
      }
    }
    return null;
  }

  private async handleScale(p: { id: string | number; instances: number }) {
    await this.registry.scale(p.id, p.instances);
    return null;
  }

  private handleReset(p: { id: string | number }) {
    this.registry.reset(p.id);
    return null;
  }

  private handleStartup(p: { platform?: string }) {
    const result = generateStartupScript(p?.platform as never ?? 'auto');
    return result;
  }

  private handleUnstartup(p: { platform?: string }) {
    const msg = removeStartupScript(p?.platform as never ?? 'auto');
    return { message: msg };
  }

  private handleInfo() {
    return {
      pid: process.pid,
      version: VERSION,
      started_at: this.daemonStartedAt,
      socket_path: WARDEN_SOCKET_PATH,
      api_port: DEFAULT_API_PORT,
    };
  }

  private handleLogsSubscribe(
    p: { warden_id?: number; lines?: number },
    conn: IpcConnection
  ) {
    conn.markStreaming();

    const warden_id = p?.warden_id ?? null;
    const lines = p?.lines ?? 15;

    // Send historical tail lines first
    const entries = warden_id !== null
      ? [this.registry.getById(warden_id)].filter(Boolean)
      : this.registry.list();

    for (const entry of entries) {
      if (!entry) continue;
      const outLines = this.registry.logManager.tail(entry.out_log_path, lines);
      for (const line of outLines) {
        if (line.trim()) {
          conn.send({
            event: 'log',
            data: {
              warden_id: entry.warden_id,
              name: entry.name,
              type: 'out',
              data: line + '\n',
              timestamp: Date.now(),
            } as LogEvent,
          });
        }
      }
      if (!entry.merge_logs) {
        const errLines = this.registry.logManager.tail(entry.err_log_path, lines);
        for (const line of errLines) {
          if (line.trim()) {
            conn.send({
              event: 'log',
              data: {
                warden_id: entry.warden_id,
                name: entry.name,
                type: 'err',
                data: line + '\n',
                timestamp: Date.now(),
              } as LogEvent,
            });
          }
        }
      }
    }

    // Watch for future log lines
    const unsubs: (() => void)[] = [];
    const targetEntries = warden_id !== null
      ? [this.registry.getById(warden_id)].filter(Boolean)
      : this.registry.list();

    for (const entry of targetEntries) {
      if (!entry) continue;
      const unsub = this.registry.logManager.watchFile(
        entry.out_log_path,
        (data) => {
          conn.send({
            event: 'log',
            data: { warden_id: entry!.warden_id, name: entry!.name, type: 'out', data, timestamp: Date.now() },
          });
        }
      );
      unsubs.push(unsub);

      if (!entry.merge_logs) {
        const unsubErr = this.registry.logManager.watchFile(
          entry.err_log_path,
          (data) => {
            conn.send({
              event: 'log',
              data: { warden_id: entry!.warden_id, name: entry!.name, type: 'err', data, timestamp: Date.now() },
            });
          }
        );
        unsubs.push(unsubErr);
      }
    }

    this.logSubscriptions.set(conn, { warden_id, unsubs });

    // Cleanup on disconnect
    conn.once('close', () => {
      this.handleLogsUnsubscribe(conn);
    });

    // Return ack so the CLI call resolves; events stream separately
    return 'subscribed';
  }

  private handleLogsUnsubscribe(conn: IpcConnection) {
    const sub = this.logSubscriptions.get(conn);
    if (sub) {
      for (const u of sub.unsubs) u();
      this.logSubscriptions.delete(conn);
    }
    return null;
  }

  private handleMetrics(p: { id: string | number }) {
    const entry = this.registry.get(p.id);
    if (!entry) throw new Error(`Process '${p.id}' not found`);
    const recent = this.store.getRecent(entry.warden_id, 60);
    const latest = this.store.getLatest(entry.warden_id);
    return {
      warden_id: entry.warden_id,
      name: entry.name,
      cpu: latest?.cpu ?? 0,
      memory: latest?.memory ?? 0,
      uptime: computeUptime(entry),
      status: entry.status,
      restarts: entry.restarts,
      recent,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private idToNumber(id: string | number): number {
    const entry = this.registry.get(id);
    return entry?.warden_id ?? -1;
  }

  private broadcastLog(ev: LogEvent): void {
    for (const [conn, sub] of this.logSubscriptions) {
      if (sub.warden_id === null || sub.warden_id === ev.warden_id) {
        conn.send({ event: 'log', data: ev });
      }
    }
  }
}
