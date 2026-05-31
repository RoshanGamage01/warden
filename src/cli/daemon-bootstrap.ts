import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { RpcClient, tryConnect } from '../ipc/client.js';
import { WARDEN_SOCKET_PATH, WARDEN_PID_FILE } from '../core/constants.js';

const DAEMON_SCRIPT = path.resolve(__dirname, '../daemon/index.js');
const WAIT_ATTEMPTS = 50;  // 50 × 100ms = 5s
const WAIT_INTERVAL = 100;

/**
 * Get an RPC client connected to the running daemon.
 * If no daemon is running, spawn one first and wait for it to be ready.
 */
export async function getClient(autospawn = true): Promise<RpcClient> {
  // Fast path: already running
  const existing = await tryConnect(WARDEN_SOCKET_PATH);
  if (existing) return existing;

  if (!autospawn) {
    throw new Error(
      'Warden daemon is not running. Start it with: warden start <script>'
    );
  }

  await spawnDaemon();
  await waitForSocket();

  const client = await tryConnect(WARDEN_SOCKET_PATH);
  if (!client) {
    throw new Error('Daemon started but could not connect. Check logs.');
  }
  return client;
}

async function spawnDaemon(): Promise<void> {
  if (!fs.existsSync(DAEMON_SCRIPT)) {
    throw new Error(
      `Daemon script not found at ${DAEMON_SCRIPT}. ` +
      'Have you run `npm run build`?'
    );
  }

  const child = spawn(process.execPath, [DAEMON_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  child.unref();

  // Give process a moment to start
  await sleep(200);
}

async function waitForSocket(): Promise<void> {
  for (let i = 0; i < WAIT_ATTEMPTS; i++) {
    if (await canConnect()) return;
    await sleep(WAIT_INTERVAL);
  }
  throw new Error(`Daemon did not become ready within ${WAIT_ATTEMPTS * WAIT_INTERVAL}ms`);
}

function canConnect(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection(WARDEN_SOCKET_PATH, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read the daemon PID file.
 */
export function getDaemonPid(): number | null {
  try {
    const raw = fs.readFileSync(WARDEN_PID_FILE, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}
