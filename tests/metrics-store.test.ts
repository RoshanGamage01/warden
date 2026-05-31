import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { MetricsStore } from '../src/metrics/store.js';

const TMP_DB = path.join(os.tmpdir(), `warden-test-${Date.now()}.db`);

describe('MetricsStore', () => {
  let store: MetricsStore;

  beforeEach(() => {
    store = new MetricsStore(TMP_DB);
  });

  afterEach(() => {
    store.close();
    fs.rmSync(TMP_DB, { force: true });
  });

  it('inserts and retrieves a metric point', () => {
    store.insert(0, 1.5, 52428800, 'online', 0, 5000);
    const recent = store.getRecent(0, 10);
    expect(recent).toHaveLength(1);
    expect(recent[0].cpu).toBeCloseTo(1.5);
    expect(recent[0].memory).toBe(52428800);
  });

  it('returns empty for unknown warden_id', () => {
    const recent = store.getRecent(99, 10);
    expect(recent).toHaveLength(0);
  });

  it('getLatest returns most recent sample', () => {
    store.insert(1, 2.0, 1000, 'online', 0, 1000);
    store.insert(1, 4.0, 2000, 'online', 1, 2000);
    const latest = store.getLatest(1);
    expect(latest).not.toBeNull();
    expect(latest!.cpu).toBeCloseTo(4.0);
    expect(latest!.memory).toBe(2000);
  });

  it('deleteProcess removes all rows for that warden_id', () => {
    store.insert(2, 1.0, 100, 'online', 0, 0);
    store.insert(2, 2.0, 200, 'online', 0, 0);
    store.insert(3, 3.0, 300, 'online', 0, 0);
    store.deleteProcess(2);
    expect(store.getRecent(2, 100)).toHaveLength(0);
    expect(store.getRecent(3, 100)).toHaveLength(1);
  });

  it('getRange returns points within time window', async () => {
    const now = Date.now();
    store.insert(4, 1.0, 100, 'online', 0, 0);
    await new Promise((r) => setTimeout(r, 50));
    const midTs = Date.now();
    await new Promise((r) => setTimeout(r, 50));
    store.insert(4, 2.0, 200, 'online', 0, 0);

    const all = store.getRange(4, 0, Date.now() + 1000);
    expect(all).toHaveLength(2);

    const recent = store.getRange(4, midTs, Date.now() + 1000);
    expect(recent).toHaveLength(1);
    expect(recent[0].cpu).toBeCloseTo(2.0);
  });
});
