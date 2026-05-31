import { EventEmitter } from 'events';
import { AppConfig, AppEntry, LogEvent } from '../core/types.js';
import { normaliseConfig, resolveId } from '../core/utils.js';
import { ProcessSupervisor } from './supervisor.js';
import { ClusterManager } from '../cluster/manager.js';
import { LogManager } from '../logs/manager.js';

export type AppHandle = ProcessSupervisor | ClusterManager;

export class AppRegistry extends EventEmitter {
  private entries = new Map<number, AppEntry>();
  private handles = new Map<number, AppHandle>();
  private nextId = 0;
  readonly logManager = new LogManager();

  // ── CRUD ───────────────────────────────────────────────────────────────

  /** Register a new app (does NOT start it). */
  register(config: AppConfig): AppEntry {
    const warden_id = this.nextId++;
    const entry = normaliseConfig(config, warden_id);
    this.entries.set(warden_id, entry);
    return entry;
  }

  get(id: string | number): AppEntry | undefined {
    return resolveId(Array.from(this.entries.values()), id);
  }

  getById(warden_id: number): AppEntry | undefined {
    return this.entries.get(warden_id);
  }

  list(): AppEntry[] {
    return Array.from(this.entries.values());
  }

  remove(warden_id: number): void {
    this.entries.delete(warden_id);
    this.handles.delete(warden_id);
  }

  // ── Start / stop / restart ─────────────────────────────────────────────

  start(entry: AppEntry): void {
    // Open logs before spawning
    this.logManager.openLogs(entry);

    let handle: AppHandle;

    if (entry.exec_mode === 'cluster') {
      handle = new ClusterManager(entry, this.logManager);
    } else {
      handle = new ProcessSupervisor(entry, this.logManager);
    }

    // Forward events up to registry
    handle.on('status', (e: AppEntry) => this.emit('status', e));
    handle.on('log', (warden_id: number, type: 'out' | 'err', data: string) => {
      const ev: LogEvent = {
        warden_id,
        name: entry.name,
        type,
        data,
        timestamp: Date.now(),
      };
      this.emit('log', ev);
    });

    this.handles.set(entry.warden_id, handle);
    handle.start();
  }

  async stop(id: string | number): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error(`Process '${id}' not found`);
    const handle = this.handles.get(entry.warden_id);
    if (!handle) { entry.status = 'stopped'; return; }
    await handle.stop();
  }

  async restart(id: string | number): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error(`Process '${id}' not found`);
    const handle = this.handles.get(entry.warden_id);
    if (!handle) {
      this.start(entry);
      return;
    }
    await handle.restart();
  }

  async reload(id: string | number): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error(`Process '${id}' not found`);
    const handle = this.handles.get(entry.warden_id);
    if (!handle) {
      this.start(entry);
      return;
    }
    await handle.reload();
  }

  async delete(id: string | number): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error(`Process '${id}' not found`);
    const handle = this.handles.get(entry.warden_id);
    if (handle) await handle.stop();
    this.logManager.closeLogs(entry.warden_id);
    this.remove(entry.warden_id);
  }

  async stopAll(): Promise<void> {
    const entries = this.list();
    await Promise.all(entries.map((e) => this.stop(e.warden_id)));
  }

  // ── Scale (cluster only) ───────────────────────────────────────────────

  async scale(id: string | number, instances: number): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error(`Process '${id}' not found`);
    if (entry.exec_mode !== 'cluster') throw new Error(`'${entry.name}' is not in cluster mode`);
    const handle = this.handles.get(entry.warden_id) as ClusterManager;
    if (!handle) throw new Error(`No running handle for '${entry.name}'`);
    await handle.scale(instances);
  }

  // ── Reset counters ─────────────────────────────────────────────────────

  reset(id: string | number): void {
    const entry = this.get(id);
    if (!entry) throw new Error(`Process '${id}' not found`);
    entry.restarts = 0;
    entry.unstable_restarts = 0;
    this.emit('status', entry);
  }
}
