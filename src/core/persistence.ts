import fs from 'fs';
import path from 'path';
import { AppEntry, AppConfig } from '../core/types.js';
import { WARDEN_DUMP_FILE } from '../core/constants.js';
import { ensureDir } from '../core/utils.js';

interface DumpEntry {
  config: AppConfig;
  warden_id: number;
  name: string;
  status: string;
  restarts: number;
  created_at: number;
}

export function save(entries: AppEntry[]): void {
  ensureDir(path.dirname(WARDEN_DUMP_FILE));
  const dump: DumpEntry[] = entries.map((e) => ({
    config: entryToConfig(e),
    warden_id: e.warden_id,
    name: e.name,
    status: e.status,
    restarts: e.restarts,
    created_at: e.created_at,
  }));
  fs.writeFileSync(WARDEN_DUMP_FILE, JSON.stringify(dump, null, 2), 'utf8');
}

export function loadDump(): DumpEntry[] {
  if (!fs.existsSync(WARDEN_DUMP_FILE)) return [];
  try {
    const raw = fs.readFileSync(WARDEN_DUMP_FILE, 'utf8');
    return JSON.parse(raw) as DumpEntry[];
  } catch {
    return [];
  }
}

/** Convert a runtime AppEntry back to an AppConfig for serialisation. */
function entryToConfig(e: AppEntry): AppConfig {
  return {
    name: e.name,
    script: e.script,
    args: e.args,
    interpreter: e.interpreter,
    interpreter_args: e.interpreter_args,
    node_args: e.node_args,
    cwd: e.cwd,
    env: e.env,
    instances: e.instances,
    exec_mode: e.exec_mode,
    watch: e.watch,
    ignore_watch: e.ignore_watch,
    max_memory_restart: e.max_memory_restart,
    cron_restart: e.cron_restart,
    max_restarts: e.max_restarts,
    min_uptime: e.min_uptime,
    restart_delay: e.restart_delay,
    autorestart: e.autorestart,
    kill_timeout: e.kill_timeout,
    merge_logs: e.merge_logs,
    out_file: e.out_log_path,
    err_file: e.err_log_path,
    max_log_size: e.max_log_size,
    log_date_format: e.log_date_format,
  };
}

export { DumpEntry };
