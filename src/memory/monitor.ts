import pidusage from 'pidusage';
import { AppEntry } from '../core/types.js';

type RestartFn = (warden_id: number) => Promise<void>;

const CHECK_INTERVAL = 30_000; // 30 seconds

export class MemoryMonitor {
  private timer: NodeJS.Timeout | null = null;
  private getEntries: () => AppEntry[];

  constructor(getEntries: () => AppEntry[], private readonly restart: RestartFn) {
    this.getEntries = getEntries;
    this.timer = setInterval(() => this.tick(), CHECK_INTERVAL).unref();
  }

  private async tick(): Promise<void> {
    const entries = this.getEntries().filter(
      (e) => e.max_memory_restart > 0 && e.status === 'online' && e.pid !== null
    );

    if (entries.length === 0) return;

    const pids = entries.map((e) => e.pid!);

    let stats: Record<number, { memory: number }>;
    try {
      stats = await pidusage(pids);
    } catch {
      return;
    }

    for (const entry of entries) {
      const s = stats[entry.pid!];
      if (!s) continue;
      if (s.memory > entry.max_memory_restart) {
        process.stderr.write(
          `[warden] '${entry.name}' exceeded max_memory_restart ` +
            `(${(s.memory / 1024 / 1024).toFixed(1)}M > ` +
            `${(entry.max_memory_restart / 1024 / 1024).toFixed(1)}M), restarting...\n`
        );
        try {
          await this.restart(entry.warden_id);
        } catch { /* ignore */ }
      }
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
