import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { AppEntry, LogEvent } from '../core/types.js';
import { ensureDir } from '../core/utils.js';

const TAIL_LINES = 15; // default lines to tail on logs_subscribe

export class LogManager extends EventEmitter {
  private streams = new Map<number, { out: fs.WriteStream; err: fs.WriteStream }>();

  /** Open (or reopen) log files for a process. Emits 'log' on new data. */
  openLogs(entry: AppEntry): { out: fs.WriteStream; err: fs.WriteStream } {
    this.closeLogs(entry.warden_id);

    ensureDir(path.dirname(entry.out_log_path));
    if (!entry.merge_logs) ensureDir(path.dirname(entry.err_log_path));

    const out = fs.createWriteStream(entry.out_log_path, { flags: 'a' });
    const err = entry.merge_logs
      ? out
      : fs.createWriteStream(entry.err_log_path, { flags: 'a' });

    this.streams.set(entry.warden_id, { out, err });
    return { out, err };
  }

  closeLogs(warden_id: number): void {
    const s = this.streams.get(warden_id);
    if (!s) return;
    try { s.out.close(); } catch { /* ignore */ }
    try { if (s.err !== s.out) s.err.close(); } catch { /* ignore */ }
    this.streams.delete(warden_id);
  }

  /** Append a log line to the write stream. */
  write(warden_id: number, type: 'out' | 'err', data: string): void {
    const s = this.streams.get(warden_id);
    if (!s) return;
    const stream = type === 'out' ? s.out : s.err;
    stream.write(data);
  }

  /** Return last N lines from a log file. */
  tail(filePath: string, lines = TAIL_LINES): string[] {
    if (!fs.existsSync(filePath)) return [];
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const all = content.split('\n');
      return all.slice(Math.max(0, all.length - lines - 1));
    } catch {
      return [];
    }
  }

  /**
   * Watch a log file and call onLine whenever new content is appended.
   * Returns an unsubscribe function.
   */
  watchFile(filePath: string, onLine: (data: string) => void): () => void {
    if (!fs.existsSync(filePath)) {
      // wait until it exists
      const dir = path.dirname(filePath);
      ensureDir(dir);
      fs.writeFileSync(filePath, '');
    }

    let offset = fs.statSync(filePath).size;

    const watcher = fs.watch(filePath, (_event) => {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size < offset) {
          // file was rotated / truncated
          offset = 0;
        }
        if (stat.size > offset) {
          const fd = fs.openSync(filePath, 'r');
          const buf = Buffer.allocUnsafe(stat.size - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          fs.closeSync(fd);
          offset = stat.size;
          onLine(buf.toString('utf8'));
        }
      } catch { /* file may have been deleted */ }
    });

    return () => {
      try { watcher.close(); } catch { /* ignore */ }
    };
  }

  /** Flush (truncate) a log file. */
  flush(filePath: string): void {
    try {
      fs.truncateSync(filePath, 0);
    } catch { /* ignore */ }
  }

  closeAll(): void {
    for (const [id] of this.streams) this.closeLogs(id);
  }
}
