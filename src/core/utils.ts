import path from 'path';
import fs from 'fs';
import { AppConfig, AppEntry } from './types.js';
import {
  WARDEN_LOGS_DIR,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_MIN_UPTIME,
  DEFAULT_RESTART_DELAY,
  DEFAULT_KILL_TIMEOUT,
  DEFAULT_MAX_LOG_SIZE,
  DEFAULT_LOG_DATE_FORMAT,
} from './constants.js';

// ─── Memory / time string parsers ──────────────────────────────────────────

/**
 * Parse a memory string like "150M", "1G", "512k" into bytes.
 * Accepts a plain number as bytes.
 */
export function parseMemory(value: string | number | undefined): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const lower = value.toLowerCase().trim();
  const num = parseFloat(lower);
  if (lower.endsWith('g')) return Math.floor(num * 1024 * 1024 * 1024);
  if (lower.endsWith('m')) return Math.floor(num * 1024 * 1024);
  if (lower.endsWith('k') || lower.endsWith('kb')) return Math.floor(num * 1024);
  return Math.floor(num);
}

/**
 * Parse a time string like "1s", "2m", "500ms" into milliseconds.
 * Accepts a plain number as milliseconds.
 */
export function parseTime(value: string | number | undefined, defaultMs = 0): number {
  if (value === undefined || value === null) return defaultMs;
  if (typeof value === 'number') return value;
  const lower = value.toLowerCase().trim();
  const num = parseFloat(lower);
  if (lower.endsWith('ms')) return Math.floor(num);
  if (lower.endsWith('m')) return Math.floor(num * 60_000);
  if (lower.endsWith('s')) return Math.floor(num * 1_000);
  if (lower.endsWith('h')) return Math.floor(num * 3_600_000);
  return Math.floor(num);
}

// ─── App config normalisation ──────────────────────────────────────────────

/**
 * Detect the default interpreter for a script file.
 * Returns 'node' for .js/.ts/.mjs/.cjs, 'python3' for .py, etc.
 * Falls back to the script itself (for binaries/scripts with a shebang).
 */
export function detectInterpreter(script: string): string {
  const ext = path.extname(script).toLowerCase();
  switch (ext) {
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'node';
    case '.ts':
      return 'ts-node';
    case '.py':
      return 'python3';
    case '.rb':
      return 'ruby';
    case '.php':
      return 'php';
    case '.sh':
    case '.bash':
      return 'bash';
    default:
      return 'none'; // treat script as executable
  }
}

/**
 * Normalise an AppConfig into a full AppEntry, filling defaults.
 * The warden_id and log paths are assigned by the registry.
 */
export function normaliseConfig(
  config: AppConfig,
  warden_id: number,
  existingEntry?: Partial<AppEntry>
): AppEntry {
  const script = path.resolve(config.cwd ?? process.cwd(), config.script);
  const name = config.name ?? path.basename(config.script, path.extname(config.script));
  const cwd = config.cwd ? path.resolve(config.cwd) : path.dirname(script);

  const interpreter = config.interpreter ?? detectInterpreter(config.script);
  const execMode = config.exec_mode ?? 'fork';
  const instances = config.instances ?? 1;

  const safeName = name.replace(/[^a-z0-9_-]/gi, '_');
  const logDir = path.join(WARDEN_LOGS_DIR, `${safeName}-${warden_id}`);
  const outLog = config.out_file ?? path.join(logDir, 'out.log');
  const errLog = config.err_file ?? (config.merge_logs ? outLog : path.join(logDir, 'err.log'));

  return {
    warden_id,
    name,
    script,
    args: config.args ?? [],
    interpreter,
    interpreter_args: config.interpreter_args ?? [],
    node_args: config.node_args ?? [],
    cwd,
    env: config.env ?? {},
    instances,
    exec_mode: execMode,
    autorestart: config.autorestart ?? true,
    max_restarts: config.max_restarts ?? DEFAULT_MAX_RESTARTS,
    min_uptime: parseTime(config.min_uptime, DEFAULT_MIN_UPTIME),
    restart_delay: config.restart_delay ?? DEFAULT_RESTART_DELAY,
    kill_timeout: config.kill_timeout ?? DEFAULT_KILL_TIMEOUT,
    watch: config.watch ?? false,
    ignore_watch: config.ignore_watch ?? ['node_modules', '.git'],
    max_memory_restart: parseMemory(config.max_memory_restart),
    cron_restart: config.cron_restart ?? '',
    merge_logs: config.merge_logs ?? false,
    out_log_path: outLog,
    err_log_path: errLog,
    max_log_size: parseMemory(config.max_log_size) || DEFAULT_MAX_LOG_SIZE,
    log_date_format: config.log_date_format ?? DEFAULT_LOG_DATE_FORMAT,
    // runtime state (preserve or defaults)
    pid: existingEntry?.pid ?? null,
    status: existingEntry?.status ?? 'stopped',
    restarts: existingEntry?.restarts ?? 0,
    unstable_restarts: existingEntry?.unstable_restarts ?? 0,
    online_since: existingEntry?.online_since ?? null,
    created_at: existingEntry?.created_at ?? Date.now(),
  };
}

// ─── Formatting helpers ────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}G`;
}

export function formatUptime(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function computeUptime(entry: AppEntry): number {
  if (entry.status === 'online' && entry.online_since !== null) {
    return Date.now() - entry.online_since;
  }
  return 0;
}

export function resolveId(
  entries: AppEntry[],
  id: string | number
): AppEntry | undefined {
  if (typeof id === 'number' || /^\d+$/.test(String(id))) {
    return entries.find((e) => e.warden_id === Number(id));
  }
  return entries.find((e) => e.name === id);
}

// ─── FS helpers ────────────────────────────────────────────────────────────

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ─── Exponential backoff ───────────────────────────────────────────────────

/**
 * Calculate restart backoff delay.
 * Doubles each time up to MAX_RESTART_BACKOFF.
 */
export function backoffDelay(restarts: number, baseDelay: number, max: number): number {
  if (baseDelay === 0) return 0;
  const delay = baseDelay * Math.pow(2, Math.min(restarts, 10));
  return Math.min(delay, max);
}
