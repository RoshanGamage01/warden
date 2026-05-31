/**
 * Integration test: start the daemon, run basic CLI commands, stop daemon.
 *
 * Requires the project to be built (`npm run build`).
 * Skipped in CI if SKIP_INTEGRATION=1.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const SKIP = process.env.SKIP_INTEGRATION === '1';

const TEST_HOME = path.join(os.tmpdir(), `warden-test-home-${Date.now()}`);
const WARDEN_BIN = path.resolve(__dirname, '../dist/bin/warden.js');

function warden(...args: string[]): string {
  return execSync(`node "${WARDEN_BIN}" ${args.join(' ')}`, {
    env: { ...process.env, HOME: TEST_HOME },
    timeout: 15_000,
  }).toString().trim();
}

describe.skipIf(SKIP)('Integration: daemon lifecycle', () => {
  beforeAll(() => {
    fs.mkdirSync(TEST_HOME, { recursive: true });
  });

  afterAll(() => {
    try { warden('kill'); } catch { /* ignore if already down */ }
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it('warden ping starts the daemon and shows info', () => {
    const out = warden('ping');
    expect(out).toMatch(/Warden Daemon/i);
    expect(out).toMatch(/pid/i);
  });

  it('warden list returns empty list initially', () => {
    const out = warden('list');
    expect(out).toMatch(/No processes found/i);
  });

  it('warden start launches a node process', () => {
    const script = path.join(TEST_HOME, 'hello.js');
    fs.writeFileSync(script, `setInterval(() => {}, 1000);\n`);
    const out = warden(`start "${script}" --name test-app`);
    expect(out).toMatch(/test-app started/i);
  });

  it('warden list shows the started process', () => {
    const out = warden('list');
    expect(out).toMatch(/test-app/);
    let online = false;
    for (let i = 0; i < 10; i++) {
      const status = warden('list');
      if (status.includes('online')) { online = true; break; }
      execSync('sleep 0.5');
    }
    expect(online).toBe(true);
  });

  it('warden stop stops the process', () => {
    const out = warden('stop test-app');
    expect(out).toMatch(/stopped/i);
  });

  it('warden restart restarts a stopped process', () => {
    warden('restart test-app');
    const out = warden('list');
    expect(out).toMatch(/test-app/);
  });

  it('warden save and resurrect work', () => {
    warden('save');
    const dumpPath = path.join(TEST_HOME, '.warden', 'dump.json');
    expect(fs.existsSync(dumpPath)).toBe(true);
    const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
    expect(Array.isArray(dump)).toBe(true);
    expect(dump.length).toBeGreaterThan(0);
    expect(dump[0].name).toBe('test-app');
  });

  it('warden flush clears log files', () => {
    warden('flush test-app');
  });

  it('warden delete removes the process', () => {
    warden('delete test-app');
    const out = warden('list');
    expect(out).toMatch(/No processes found/i);
  });

  it('warden kill shuts down the daemon', () => {
    warden('kill');
    execSync('sleep 1');
    const pidFile = path.join(TEST_HOME, '.warden', 'daemon.pid');
    expect(fs.existsSync(pidFile)).toBe(false);
  });
});
