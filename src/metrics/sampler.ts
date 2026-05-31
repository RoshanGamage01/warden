import pidusage from 'pidusage';
import { AppEntry } from '../core/types.js';
import { MetricsStore } from './store.js';
import { METRICS_SAMPLE_INTERVAL } from '../core/constants.js';

export class MetricsSampler {
  private timer: NodeJS.Timeout | null = null;
  private getEntries: () => AppEntry[];

  constructor(getEntries: () => AppEntry[], private readonly store: MetricsStore) {
    this.getEntries = getEntries;
    this.timer = setInterval(() => this.sample(), METRICS_SAMPLE_INTERVAL).unref();
  }

  async sample(): Promise<void> {
    const entries = this.getEntries().filter(
      (e) => e.status === 'online' && e.pid !== null
    );
    if (entries.length === 0) return;

    const pids = entries.map((e) => e.pid!);

    let stats: Record<number, { cpu: number; memory: number }>;
    try {
      stats = await pidusage(pids);
    } catch {
      return;
    }

    const now = Date.now();
    for (const entry of entries) {
      const s = stats[entry.pid!];
      if (!s) continue;
      const uptime = entry.online_since ? now - entry.online_since : 0;
      this.store.insert(entry.warden_id, s.cpu, s.memory, entry.status, entry.restarts, uptime);
    }

    // For stopped processes, record a zero-cpu sample
    const allEntries = this.getEntries();
    for (const entry of allEntries) {
      if (entry.status !== 'online') {
        this.store.insert(entry.warden_id, 0, 0, entry.status, entry.restarts, 0);
      }
    }

    // Periodic purge of data older than 24 hours
    if (Math.random() < 0.01) {
      this.store.purgeOlderThan(now - 24 * 60 * 60 * 1_000);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
