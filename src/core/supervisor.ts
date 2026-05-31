import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import { AppEntry, ProcessStatus } from '../core/types.js';
import { backoffDelay, formatUptime } from '../core/utils.js';
import { MAX_RESTART_BACKOFF } from '../core/constants.js';
import { LogManager } from '../logs/manager.js';

export interface SupervisorEvents {
  status: [entry: AppEntry];
  log: [warden_id: number, type: 'out' | 'err', data: string];
}

/**
 * Manages a single fork-mode process: spawn, crash detection, auto-restart
 * with exponential backoff, and graceful stop.
 */
export class ProcessSupervisor extends EventEmitter {
  private child: ChildProcess | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private stabilityTimer: NodeJS.Timeout | null = null;
  private stopRequested = false;
  private crashCount = 0;
  private startedAt = 0;

  constructor(
    public readonly entry: AppEntry,
    private readonly logManager: LogManager
  ) {
    super();
  }

  // ── State helpers ──────────────────────────────────────────────────────

  private setStatus(status: ProcessStatus, pid: number | null = this.entry.pid): void {
    this.entry.status = status;
    this.entry.pid = pid;
    if (status === 'online') {
      this.entry.online_since = Date.now();
    } else if (status === 'stopped' || status === 'errored') {
      this.entry.online_since = null;
      this.entry.pid = null;
    }
    this.emit('status', this.entry);
  }

  // ── Public API ─────────────────────────────────────────────────────────

  start(): void {
    this.stopRequested = false;
    this.spawnProcess();
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    this.clearRestartTimer();
    this.clearStabilityTimer();

    if (!this.child || this.child.exitCode !== null) {
      this.setStatus('stopped');
      return;
    }

    this.setStatus('stopping');

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        this.child?.kill('SIGKILL');
        resolve();
      }, this.entry.kill_timeout);

      this.child!.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });

      this.child!.kill('SIGTERM');
    });

    this.setStatus('stopped');
  }

  async restart(): Promise<void> {
    await this.stop();
    this.stopRequested = false;
    this.crashCount = 0;
    this.spawnProcess();
  }

  /** Replace process in-place for reload (cluster handles rolling; fork just restarts). */
  async reload(): Promise<void> {
    return this.restart();
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private spawnProcess(): void {
    this.setStatus('launching');
    this.startedAt = Date.now();

    const { cmd, args } = this.buildCommand();

    const child = spawn(cmd, args, {
      cwd: this.entry.cwd,
      env: { ...process.env, ...this.entry.env, WARDEN_ID: String(this.entry.warden_id) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    this.child = child;

    child.stdout!.on('data', (data: Buffer) => {
      const text = this.maybeTimestamp(data.toString());
      this.logManager.write(this.entry.warden_id, 'out', text);
      this.emit('log', this.entry.warden_id, 'out', text);
    });

    child.stderr!.on('data', (data: Buffer) => {
      const text = this.maybeTimestamp(data.toString());
      this.logManager.write(this.entry.warden_id, 'err', text);
      this.emit('log', this.entry.warden_id, 'err', text);
    });

    child.once('spawn', () => {
      this.setStatus('online', child.pid ?? null);
      this.logManager.openLogs(this.entry);
      this.scheduleStabilityCheck();
    });

    child.once('error', (err) => {
      this.logManager.write(
        this.entry.warden_id,
        'err',
        `[warden] spawn error: ${err.message}\n`
      );
      this.handleCrash(1, null);
    });

    child.once('exit', (code, signal) => {
      if (this.entry.status === 'stopping') return; // intentional stop handled above
      this.handleCrash(code, signal);
    });
  }

  private buildCommand(): { cmd: string; args: string[] } {
    const { interpreter, interpreter_args, node_args, script, args } = this.entry;

    if (interpreter === 'none') {
      return { cmd: script, args };
    }

    if (interpreter === 'node') {
      return {
        cmd: process.execPath,
        args: [...node_args, ...interpreter_args, script, ...args],
      };
    }

    return {
      cmd: interpreter,
      args: [...interpreter_args, script, ...args],
    };
  }

  private maybeTimestamp(text: string): string {
    if (!this.entry.log_date_format) return text;
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return text
      .split('\n')
      .map((line) => (line ? `${ts}: ${line}` : line))
      .join('\n');
  }

  private handleCrash(code: number | null, signal: string | null): void {
    this.clearStabilityTimer();

    if (this.stopRequested) {
      this.setStatus('stopped');
      return;
    }

    this.entry.restarts += 1;
    this.entry.online_since = null;
    this.entry.pid = null;

    if (!this.entry.autorestart) {
      this.setStatus('stopped');
      return;
    }

    if (this.crashCount >= this.entry.max_restarts) {
      this.logManager.write(
        this.entry.warden_id,
        'err',
        `[warden] Process exceeded max_restarts (${this.entry.max_restarts}), marked errored.\n`
      );
      this.setStatus('errored');
      return;
    }

    this.crashCount += 1;
    this.entry.unstable_restarts += 1;

    const delay = backoffDelay(
      this.crashCount,
      this.entry.restart_delay || 500,
      MAX_RESTART_BACKOFF
    );

    this.setStatus('launching');

    if (delay > 0) {
      this.restartTimer = setTimeout(() => this.spawnProcess(), delay);
    } else {
      this.spawnProcess();
    }
  }

  private scheduleStabilityCheck(): void {
    this.clearStabilityTimer();
    if (this.entry.min_uptime <= 0) return;
    this.stabilityTimer = setTimeout(() => {
      // process has been running long enough – reset crash counter
      this.crashCount = 0;
    }, this.entry.min_uptime);
  }

  private clearRestartTimer(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private clearStabilityTimer(): void {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }
}
