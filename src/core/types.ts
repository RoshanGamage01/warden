// ─── Process lifecycle ─────────────────────────────────────────────────────

export type ProcessStatus =
  | 'launching'
  | 'online'
  | 'stopping'
  | 'stopped'
  | 'errored';

// ─── Config (what the user provides) ───────────────────────────────────────

export interface AppConfig {
  name?: string;
  script: string;
  args?: string[];
  /** interpreter binary, e.g. 'python3', 'node'. Defaults to the detected interpreter. */
  interpreter?: string;
  interpreter_args?: string[];
  /** Extra Node.js args prepended before the script (only for node interpreter). */
  node_args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  instances?: number;
  exec_mode?: 'fork' | 'cluster';
  watch?: boolean | string[];
  ignore_watch?: string[];
  /** e.g. '150M', '1G', or bytes as number. 0 = disabled. */
  max_memory_restart?: string | number;
  /** Cron expression, e.g. '0 0 * * *'. Empty = disabled. */
  cron_restart?: string;
  max_restarts?: number;
  /** Minimum uptime before a process is considered stable, resets crash counter. e.g. '1s', ms number. */
  min_uptime?: string | number;
  /** Delay in ms between restarts. */
  restart_delay?: number;
  autorestart?: boolean;
  merge_logs?: boolean;
  out_file?: string;
  err_file?: string;
  log_date_format?: string;
  /** Max log file size before rotation, e.g. '10M' or bytes. */
  max_log_size?: string | number;
  /** Timeout in ms to wait for graceful shutdown before SIGKILL. */
  kill_timeout?: number;
}

// ─── Runtime entry (what the daemon stores) ────────────────────────────────

export interface AppEntry {
  // identity
  warden_id: number;
  name: string;
  // execution
  script: string;
  args: string[];
  interpreter: string;
  interpreter_args: string[];
  node_args: string[];
  cwd: string;
  env: Record<string, string>;
  // scaling
  instances: number;
  exec_mode: 'fork' | 'cluster';
  // restart policy
  autorestart: boolean;
  max_restarts: number;
  min_uptime: number;        // ms
  restart_delay: number;     // ms
  kill_timeout: number;      // ms
  // features
  watch: boolean | string[];
  ignore_watch: string[];
  max_memory_restart: number; // bytes, 0 = disabled
  cron_restart: string;       // empty = disabled
  // logging
  merge_logs: boolean;
  out_log_path: string;
  err_log_path: string;
  max_log_size: number;       // bytes
  log_date_format: string;
  // runtime state
  pid: number | null;
  status: ProcessStatus;
  restarts: number;
  unstable_restarts: number;
  online_since: number | null;   // Date.now() when became online
  created_at: number;
  // cluster sub-instances (exec_mode='cluster' only)
  instances_list?: ClusterWorkerInfo[];
}

export interface ClusterWorkerInfo {
  instance_id: number;
  pid: number | null;
  status: ProcessStatus;
  online_since: number | null;
  restarts: number;
}

// ─── Metrics ───────────────────────────────────────────────────────────────

export interface MetricPoint {
  ts: number;
  cpu: number;   // percent
  memory: number; // bytes
}

export interface ProcessMetrics {
  warden_id: number;
  cpu: number;
  memory: number;
  uptime: number;  // ms
  status: ProcessStatus;
  restarts: number;
  recent: MetricPoint[];
}

// ─── Daemon info ───────────────────────────────────────────────────────────

export interface DaemonInfo {
  pid: number;
  version: string;
  started_at: number;
  socket_path: string;
  api_port: number;
}

// ─── IPC / RPC ─────────────────────────────────────────────────────────────

export interface RpcRequest {
  id: number;
  method: string;
  params?: unknown;
}

export interface RpcResponse {
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

/** Server-push event (no id – not a request/response). */
export interface RpcEvent {
  event: string;
  data: unknown;
}

export type RpcMessage = RpcRequest | RpcResponse | RpcEvent;

// ─── Log streaming ─────────────────────────────────────────────────────────

export interface LogEvent {
  warden_id: number;
  name: string;
  type: 'out' | 'err';
  data: string;
  timestamp: number;
}

// ─── Ecosystem config ──────────────────────────────────────────────────────

export interface EcosystemConfig {
  apps: AppConfig[];
}
