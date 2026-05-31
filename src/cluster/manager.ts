import { ChildProcess, fork } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import { AppEntry, ClusterWorkerInfo, ProcessStatus } from '../core/types.js';
import { LogManager } from '../logs/manager.js';

const MASTER_SCRIPT = path.resolve(__dirname, 'master.js');

interface MasterMessage {
  type: string;
  instanceId?: number;
  pid?: number;
  code?: number | null;
  signal?: string | null;
  intentional?: boolean;
  instances?: number;
  workers?: ClusterWorkerInfo[];
  message?: string;
}

export class ClusterManager extends EventEmitter {
  private master: ChildProcess | null = null;
  private stopRequested = false;
  private workerMap = new Map<number, ClusterWorkerInfo>();

  constructor(
    public readonly entry: AppEntry,
    private readonly logManager: LogManager
  ) {
    super();
  }

  start(): void {
    this.stopRequested = false;
    this.spawnMaster();
  }

  private spawnMaster(): void {
    this.entry.status = 'launching';
    this.entry.pid = null;
    this.emit('status', this.entry);

    const master = fork(MASTER_SCRIPT, [], {
      cwd: this.entry.cwd,
      env: {
        ...process.env,
        ...this.entry.env,
        WARDEN_EXEC_SCRIPT: this.entry.script,
        WARDEN_INSTANCES: String(this.entry.instances),
        WARDEN_ID: String(this.entry.warden_id),
        WARDEN_NODE_ARGS: JSON.stringify(this.entry.node_args),
      },
      silent: true, // pipe stdout/stderr
      execArgv: [],
    });

    this.master = master;

    master.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.logManager.write(this.entry.warden_id, 'out', text);
      this.emit('log', this.entry.warden_id, 'out', text);
    });

    master.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.logManager.write(this.entry.warden_id, 'err', text);
      this.emit('log', this.entry.warden_id, 'err', text);
    });

    master.on('message', (msg: MasterMessage) => {
      this.handleMasterMessage(msg);
    });

    master.once('exit', (code, signal) => {
      if (this.stopRequested) {
        this.entry.status = 'stopped';
        this.entry.pid = null;
        this.entry.online_since = null;
        this.entry.instances_list = [];
        this.emit('status', this.entry);
        return;
      }
      // Master died unexpectedly – restart
      this.entry.restarts += 1;
      setTimeout(() => this.spawnMaster(), 1_000);
    });
  }

  private handleMasterMessage(msg: MasterMessage): void {
    switch (msg.type) {
      case 'ready':
        // Some workers may not be online yet, wait for worker_online
        break;

      case 'worker_online': {
        const info: ClusterWorkerInfo = {
          instance_id: msg.instanceId!,
          pid: msg.pid ?? null,
          status: 'online',
          online_since: Date.now(),
          restarts: 0,
        };
        this.workerMap.set(msg.instanceId!, info);
        this.syncEntryFromWorkers();
        break;
      }

      case 'worker_exit': {
        if (msg.intentional) {
          this.workerMap.delete(msg.instanceId!);
        } else {
          const w = this.workerMap.get(msg.instanceId!);
          if (w) {
            w.status = 'launching';
            w.pid = null;
            w.restarts += 1;
            w.online_since = null;
            this.entry.restarts += 1;
          }
        }
        this.syncEntryFromWorkers();
        break;
      }

      case 'reload_done':
      case 'scale_done':
        this.syncEntryFromWorkers();
        break;
    }
  }

  private syncEntryFromWorkers(): void {
    const list = Array.from(this.workerMap.values());
    this.entry.instances_list = list;

    const onlineWorkers = list.filter((w) => w.status === 'online');
    const hasOnline = onlineWorkers.length > 0;

    this.entry.status = hasOnline ? 'online' : (this.stopRequested ? 'stopped' : 'launching');
    if (hasOnline && this.entry.online_since === null) {
      this.entry.online_since = Date.now();
    }
    // Use first worker's pid as representative pid
    this.entry.pid = onlineWorkers[0]?.pid ?? null;

    this.emit('status', this.entry);
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    if (!this.master || this.master.exitCode !== null) {
      this.entry.status = 'stopped';
      this.emit('status', this.entry);
      return;
    }

    this.entry.status = 'stopping';
    this.emit('status', this.entry);

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.master?.kill('SIGKILL');
        resolve();
      }, this.entry.kill_timeout + 2_000);

      this.master!.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });

      if (this.master!.send) {
        this.master!.send({ type: 'stop' });
      } else {
        this.master!.kill('SIGTERM');
      }
    });

    this.entry.status = 'stopped';
    this.entry.pid = null;
    this.entry.online_since = null;
    this.emit('status', this.entry);
  }

  async restart(): Promise<void> {
    await this.stop();
    this.stopRequested = false;
    this.workerMap.clear();
    this.spawnMaster();
  }

  /** Zero-downtime rolling reload. */
  async reload(): Promise<void> {
    if (!this.master || this.master.exitCode !== null) {
      return this.restart();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 30_000);
      this.master!.once('message', (msg: MasterMessage) => {
        if (msg.type === 'reload_done') {
          clearTimeout(timer);
          resolve();
        }
      });
      this.master!.send({ type: 'reload' });
    });
  }

  async scale(instances: number): Promise<void> {
    if (!this.master) throw new Error('Cluster master not running');
    this.entry.instances = instances;
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 15_000);
      this.master!.once('message', (msg: MasterMessage) => {
        if (msg.type === 'scale_done') {
          clearTimeout(timer);
          resolve();
        }
      });
      this.master!.send({ type: 'scale', instances });
    });
  }
}
