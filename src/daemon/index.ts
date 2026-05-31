/**
 * Daemon entry point.
 *
 * Spawned detached by the CLI when no daemon is running.
 * Writes its PID to ~/.warden/daemon.pid, creates the IPC socket,
 * starts the HTTP API, and waits for RPC requests.
 */

import fs from 'fs';
import path from 'path';
import { IpcServer } from '../ipc/server.js';
import { AppRegistry } from '../core/app-registry.js';
import { DaemonRouter } from './router.js';
import { WatchManager } from '../watch/watcher.js';
import { CronScheduler } from '../cron/scheduler.js';
import { MemoryMonitor } from '../memory/monitor.js';
import { MetricsStore } from '../metrics/store.js';
import { MetricsSampler } from '../metrics/sampler.js';
import { LogRotator } from '../logs/rotator.js';
import { createApiServer } from '../api/server.js';
import {
  WARDEN_HOME,
  WARDEN_PID_FILE,
  WARDEN_SOCKET_PATH,
  DEFAULT_API_PORT,
  DEFAULT_API_HOST,
} from '../core/constants.js';
import { ensureDir } from '../core/utils.js';
import { RpcRequest } from '../core/types.js';
import { IpcConnection } from '../ipc/server.js';

async function main() {
  // ── Bootstrap directories ────────────────────────────────────────────
  ensureDir(WARDEN_HOME);
  ensureDir(path.join(WARDEN_HOME, 'logs'));
  ensureDir(path.join(WARDEN_HOME, 'pids'));

  // ── Remove stale socket ──────────────────────────────────────────────
  if (process.platform !== 'win32' && fs.existsSync(WARDEN_SOCKET_PATH)) {
    fs.unlinkSync(WARDEN_SOCKET_PATH);
  }

  // ── Write PID file ───────────────────────────────────────────────────
  fs.writeFileSync(WARDEN_PID_FILE, String(process.pid), 'utf8');

  // ── Core services ────────────────────────────────────────────────────
  const registry = new AppRegistry();
  const store = new MetricsStore();
  const sampler = new MetricsSampler(() => registry.list(), store);
  const watchManager = new WatchManager(async (warden_id) => {
    await registry.restart(warden_id);
  });
  const cronScheduler = new CronScheduler(async (warden_id) => {
    await registry.restart(warden_id);
  });
  const memMonitor = new MemoryMonitor(
    () => registry.list(),
    async (warden_id) => { await registry.restart(warden_id); }
  );
  const logRotator = new LogRotator(() => registry.list());

  const router = new DaemonRouter(registry, watchManager, cronScheduler, store, sampler);

  // ── IPC server ───────────────────────────────────────────────────────
  const ipc = new IpcServer(WARDEN_SOCKET_PATH);

  ipc.on('request', async (req: RpcRequest, conn: IpcConnection) => {
    try {
      const result = await router.handle(req.method, req.params, conn);
      conn.send({ id: req.id, result: result ?? null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      conn.send({ id: req.id, error: { code: -32000, message } });
    }
  });

  await ipc.listen();
  process.stderr.write(`[warden-daemon] IPC listening on ${WARDEN_SOCKET_PATH}\n`);

  // ── HTTP API ─────────────────────────────────────────────────────────
  const apiPort = parseInt(process.env.WARDEN_API_PORT ?? String(DEFAULT_API_PORT), 10);
  const apiHost = process.env.WARDEN_API_HOST ?? DEFAULT_API_HOST;
  const api = await createApiServer({
    host: apiHost,
    port: apiPort,
    getEntries: () => registry.list(),
    store,
  });

  try {
    await api.start();
    process.stderr.write(`[warden-daemon] HTTP API listening on http://${apiHost}:${apiPort}\n`);
  } catch (err) {
    process.stderr.write(`[warden-daemon] Could not start HTTP API: ${(err as Error).message}\n`);
  }

  // ── Graceful shutdown ────────────────────────────────────────────────
  const shutdown = async (reason: string) => {
    process.stderr.write(`[warden-daemon] Shutting down (${reason})...\n`);
    logRotator.stop();
    sampler.stop();
    memMonitor.stop();
    watchManager.stopAll();
    cronScheduler.stopAll();
    await registry.stopAll();
    registry.logManager.closeAll();
    await ipc.close();
    await api.stop().catch(() => {});
    store.close();
    try { fs.unlinkSync(WARDEN_PID_FILE); } catch { /* ignore */ }
    try {
      if (process.platform !== 'win32') fs.unlinkSync(WARDEN_SOCKET_PATH);
    } catch { /* ignore */ }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[warden-daemon] uncaughtException: ${err.stack ?? err.message}\n`);
  });
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[warden-daemon] unhandledRejection: ${reason}\n`);
  });

  // Signal to the CLI that we are ready
  process.send?.({ type: 'ready' });
}

main().catch((err) => {
  process.stderr.write(`[warden-daemon] Fatal: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
