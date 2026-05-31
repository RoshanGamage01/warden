import { Cron } from 'croner';
import { AppEntry } from '../core/types.js';

type RestartFn = (warden_id: number) => Promise<void>;

export class CronScheduler {
  private jobs = new Map<number, Cron>();

  constructor(private readonly restart: RestartFn) {}

  schedule(entry: AppEntry): void {
    if (!entry.cron_restart) return;
    this.unschedule(entry.warden_id);

    try {
      const job = new Cron(entry.cron_restart, async () => {
        try {
          await this.restart(entry.warden_id);
        } catch { /* process may be gone */ }
      });
      this.jobs.set(entry.warden_id, job);
    } catch (err) {
      process.stderr.write(
        `[warden] Invalid cron expression for '${entry.name}': ${entry.cron_restart}\n`
      );
    }
  }

  unschedule(warden_id: number): void {
    const job = this.jobs.get(warden_id);
    if (job) {
      job.stop();
      this.jobs.delete(warden_id);
    }
  }

  stopAll(): void {
    for (const [id] of this.jobs) this.unschedule(id);
  }
}
