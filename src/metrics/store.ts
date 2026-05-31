import Database, { Database as DB } from 'better-sqlite3';
import path from 'path';
import { MetricPoint, ProcessStatus } from '../core/types.js';
import { WARDEN_HOME } from '../core/constants.js';
import { ensureDir } from '../core/utils.js';

const DB_PATH = path.join(WARDEN_HOME, 'metrics.db');
/** Keep at most this many rows per process (24 h @ 5 s = 17 280). */
const MAX_ROWS_PER_PROCESS = 17_280;

export class MetricsStore {
  private db: DB;

  constructor(dbPath = DB_PATH) {
    ensureDir(path.dirname(dbPath));
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        warden_id   INTEGER NOT NULL,
        ts      INTEGER NOT NULL,
        cpu     REAL    NOT NULL,
        memory  INTEGER NOT NULL,
        status  TEXT    NOT NULL,
        restarts INTEGER NOT NULL,
        uptime  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_metrics_warden_ts ON metrics(warden_id, ts);
    `);
  }

  insert(warden_id: number, cpu: number, memory: number, status: ProcessStatus, restarts: number, uptime: number): void {
    this.db
      .prepare(
        `INSERT INTO metrics (warden_id, ts, cpu, memory, status, restarts, uptime)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(warden_id, Date.now(), cpu, memory, status, restarts, uptime);

    // Ring-buffer: delete oldest rows beyond MAX_ROWS_PER_PROCESS
    this.db
      .prepare(
        `DELETE FROM metrics WHERE warden_id = ? AND id NOT IN (
           SELECT id FROM metrics WHERE warden_id = ? ORDER BY ts DESC LIMIT ?
         )`
      )
      .run(warden_id, warden_id, MAX_ROWS_PER_PROCESS);
  }

  /** Get the latest N metric points for a process. */
  getRecent(warden_id: number, limit = 60): MetricPoint[] {
    const rows = this.db
      .prepare(
        `SELECT ts, cpu, memory FROM metrics
         WHERE warden_id = ? ORDER BY ts DESC LIMIT ?`
      )
      .all(warden_id, limit) as { ts: number; cpu: number; memory: number }[];
    return rows.reverse();
  }

  /** Get metric points within a time range. */
  getRange(warden_id: number, fromTs: number, toTs: number): MetricPoint[] {
    const rows = this.db
      .prepare(
        `SELECT ts, cpu, memory FROM metrics
         WHERE warden_id = ? AND ts >= ? AND ts <= ?
         ORDER BY ts ASC`
      )
      .all(warden_id, fromTs, toTs) as { ts: number; cpu: number; memory: number }[];
    return rows;
  }

  /** Latest single sample for a process. */
  getLatest(warden_id: number): { cpu: number; memory: number } | null {
    const row = this.db
      .prepare(
        `SELECT cpu, memory FROM metrics WHERE warden_id = ? ORDER BY ts DESC LIMIT 1`
      )
      .get(warden_id) as { cpu: number; memory: number } | undefined;
    return row ?? null;
  }

  /** Delete all metrics for a process (called on delete). */
  deleteProcess(warden_id: number): void {
    this.db.prepare('DELETE FROM metrics WHERE warden_id = ?').run(warden_id);
  }

  /** Purge metrics older than cutoffTs (Unix ms). */
  purgeOlderThan(cutoffTs: number): void {
    this.db.prepare('DELETE FROM metrics WHERE ts < ?').run(cutoffTs);
  }

  close(): void {
    this.db.close();
  }
}
