import path from 'path';
import os from 'os';

export const VERSION = '1.0.0';

// ─── Directories ───────────────────────────────────────────────────────────

export const WARDEN_HOME = path.join(os.homedir(), '.warden');
export const WARDEN_LOGS_DIR = path.join(WARDEN_HOME, 'logs');
export const WARDEN_PIDS_DIR = path.join(WARDEN_HOME, 'pids');

// ─── Daemon IPC ────────────────────────────────────────────────────────────

/** Unix domain socket (Linux/macOS). Windows falls back to named pipe. */
export const WARDEN_SOCKET_PATH =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\warden-daemon'
    : path.join(WARDEN_HOME, 'daemon.sock');

export const WARDEN_PID_FILE = path.join(WARDEN_HOME, 'daemon.pid');
export const WARDEN_DUMP_FILE = path.join(WARDEN_HOME, 'dump.json');

// ─── HTTP API ──────────────────────────────────────────────────────────────

export const DEFAULT_API_PORT = 9615;
export const DEFAULT_API_HOST = '127.0.0.1';

// ─── Metrics ───────────────────────────────────────────────────────────────

/** How often to sample CPU/memory for each process (ms). */
export const METRICS_SAMPLE_INTERVAL = 5_000;

/** Number of samples to keep per process (5s × 17280 = 24h). */
export const METRICS_MAX_SAMPLES = 17_280;

// ─── Process defaults ──────────────────────────────────────────────────────

export const DEFAULT_MAX_RESTARTS = 16;
export const DEFAULT_MIN_UPTIME = 1_000;     // 1s
export const DEFAULT_RESTART_DELAY = 0;
export const DEFAULT_KILL_TIMEOUT = 1_600;   // 1.6s
export const DEFAULT_MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
export const DEFAULT_LOG_DATE_FORMAT = 'YYYY-MM-DDTHH:mm:ss';
export const MAX_RESTART_BACKOFF = 15_000;   // 15s cap on backoff delay

// ─── Cluster worker entry ──────────────────────────────────────────────────

/** Resolved at runtime relative to __dirname in manager.ts */
export const CLUSTER_MASTER_SCRIPT = path.resolve(__dirname, '../cluster/master.js');
