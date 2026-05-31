import chokidar, { FSWatcher } from 'chokidar';
import { AppEntry } from '../core/types.js';

type RestartFn = (warden_id: number) => Promise<void>;

export class WatchManager {
  private watchers = new Map<number, FSWatcher>();

  constructor(private readonly restart: RestartFn) {}

  /**
   * Start watching for an app entry that has watch enabled.
   * Debounces file-change events to avoid flapping.
   */
  watch(entry: AppEntry): void {
    if (!entry.watch) return;
    this.unwatch(entry.warden_id);

    const patterns =
      typeof entry.watch === 'boolean'
        ? [entry.cwd]
        : entry.watch.map((p) =>
            p.startsWith('/') ? p : `${entry.cwd}/${p}`
          );

    const ignored: (string | RegExp)[] = [
      ...(entry.ignore_watch ?? []),
      /node_modules/,
      /\.git/,
    ];

    const watcher = chokidar.watch(patterns, {
      ignored,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    let debounce: NodeJS.Timeout | null = null;

    const onChange = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        try {
          await this.restart(entry.warden_id);
        } catch { /* app may be deleted */ }
      }, 500);
    };

    watcher.on('change', onChange);
    watcher.on('add', onChange);
    watcher.on('unlink', onChange);

    this.watchers.set(entry.warden_id, watcher);
  }

  unwatch(warden_id: number): void {
    const w = this.watchers.get(warden_id);
    if (w) {
      w.close().catch(() => { /* ignore */ });
      this.watchers.delete(warden_id);
    }
  }

  stopAll(): void {
    for (const [id] of this.watchers) this.unwatch(id);
  }
}
