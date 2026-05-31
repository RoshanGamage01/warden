import fs from 'fs';
import path from 'path';
import { AppEntry } from '../core/types.js';

const MAX_ROTATIONS = 5;

/**
 * Rotate a log file if its size exceeds entry.max_log_size.
 * Keeps up to MAX_ROTATIONS backups: .1, .2, ... .5
 */
export function maybeRotate(filePath: string, maxBytes: number): boolean {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (stat.size < maxBytes) return false;
  rotateFile(filePath);
  return true;
}

function rotateFile(filePath: string): void {
  // shift backups: .5 deleted, .4 -> .5, ... .1 -> .2, current -> .1
  for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
    const src = `${filePath}.${i}`;
    const dst = `${filePath}.${i + 1}`;
    if (fs.existsSync(src)) {
      try { fs.renameSync(src, dst); } catch { /* ignore */ }
    }
  }
  try { fs.renameSync(filePath, `${filePath}.1`); } catch { /* ignore */ }
  // create fresh empty file
  try { fs.writeFileSync(filePath, ''); } catch { /* ignore */ }
}

/** Rotate both out and err log files for a process entry if needed. */
export function rotateEntryLogs(entry: AppEntry): void {
  maybeRotate(entry.out_log_path, entry.max_log_size);
  if (!entry.merge_logs) maybeRotate(entry.err_log_path, entry.max_log_size);
}

/** Periodic rotation check: iterate all entries and rotate as needed. */
export class LogRotator {
  private timer: NodeJS.Timeout | null = null;
  private getEntries: () => AppEntry[];

  constructor(getEntries: () => AppEntry[], intervalMs = 60_000) {
    this.getEntries = getEntries;
    this.timer = setInterval(() => this.tick(), intervalMs).unref();
  }

  private tick(): void {
    for (const entry of this.getEntries()) {
      rotateEntryLogs(entry);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
