import chalk from 'chalk';
import Table from 'cli-table3';
import { AppEntry } from '../core/types.js';
import { formatBytes, formatUptime } from '../core/utils.js';

// ── Status colours ──────────────────────────────────────────────────────────

export function statusColour(status: string): string {
  switch (status) {
    case 'online':    return chalk.green(status);
    case 'launching': return chalk.yellow(status);
    case 'stopping':  return chalk.yellow(status);
    case 'stopped':   return chalk.grey(status);
    case 'errored':   return chalk.red(status);
    default:          return status;
  }
}

// ── Process list table ──────────────────────────────────────────────────────

export interface ListRow extends AppEntry {
  uptime?: number;
  cpu?: number;
  memory?: number;
}

export function printProcessTable(entries: ListRow[]): void {
  if (entries.length === 0) {
    console.log(chalk.grey('No processes found.'));
    return;
  }

  const table = new Table({
    head: [
      chalk.cyan('id'),
      chalk.cyan('name'),
      chalk.cyan('mode'),
      chalk.cyan('↺'),
      chalk.cyan('status'),
      chalk.cyan('cpu'),
      chalk.cyan('mem'),
      chalk.cyan('uptime'),
      chalk.cyan('pid'),
    ],
    style: { head: [], border: ['grey'] },
    colWidths: [5, 20, 9, 5, 12, 9, 9, 10, 9],
  });

  for (const e of entries) {
    table.push([
      e.warden_id,
      e.name.length > 18 ? e.name.slice(0, 17) + '…' : e.name,
      e.exec_mode === 'cluster' ? chalk.blue('cluster') : 'fork',
      e.restarts,
      statusColour(e.status),
      e.cpu !== undefined ? `${e.cpu.toFixed(1)}%` : '—',
      e.memory !== undefined ? formatBytes(e.memory) : '—',
      e.online_since ? formatUptime(Date.now() - e.online_since) : '—',
      e.pid ?? '—',
    ]);
  }

  console.log(table.toString());
}

// ── Describe ────────────────────────────────────────────────────────────────

export function printDescribe(e: ListRow): void {
  const rows: [string, string][] = [
    ['warden_id', String(e.warden_id)],
    ['name', e.name],
    ['status', statusColour(e.status)],
    ['script', e.script],
    ['args', e.args.join(' ') || '—'],
    ['interpreter', e.interpreter],
    ['cwd', e.cwd],
    ['exec_mode', e.exec_mode],
    ['instances', String(e.instances)],
    ['pid', String(e.pid ?? '—')],
    ['uptime', e.online_since ? formatUptime(Date.now() - e.online_since) : '—'],
    ['restarts', String(e.restarts)],
    ['unstable_restarts', String(e.unstable_restarts)],
    ['autorestart', String(e.autorestart)],
    ['max_restarts', String(e.max_restarts)],
    ['min_uptime', `${e.min_uptime}ms`],
    ['restart_delay', `${e.restart_delay}ms`],
    ['kill_timeout', `${e.kill_timeout}ms`],
    ['watch', JSON.stringify(e.watch)],
    ['cron_restart', e.cron_restart || '—'],
    ['max_memory_restart', e.max_memory_restart ? formatBytes(e.max_memory_restart) : '—'],
    ['out log', e.out_log_path],
    ['err log', e.merge_logs ? '(merged)' : e.err_log_path],
    ['created_at', new Date(e.created_at).toLocaleString()],
  ];

  const table = new Table({
    style: { border: ['grey'] },
  });

  for (const [key, val] of rows) {
    table.push({ [chalk.cyan(key)]: val });
  }

  console.log(table.toString());

  if (e.instances_list && e.instances_list.length > 0) {
    console.log(chalk.cyan('\nCluster workers:'));
    const wTable = new Table({
      head: ['#', 'pid', 'status', 'restarts', 'uptime'],
      style: { head: [], border: ['grey'] },
    });
    for (const w of e.instances_list) {
      wTable.push([
        w.instance_id,
        w.pid ?? '—',
        statusColour(w.status),
        w.restarts,
        w.online_since ? formatUptime(Date.now() - w.online_since) : '—',
      ]);
    }
    console.log(wTable.toString());
  }
}

// ── Info ────────────────────────────────────────────────────────────────────

export function printInfo(info: {
  pid: number;
  version: string;
  started_at: number;
  socket_path: string;
  api_port: number;
}): void {
  console.log(`${chalk.cyan('Warden Daemon')}`);
  console.log(`  pid       : ${info.pid}`);
  console.log(`  version   : ${info.version}`);
  console.log(`  uptime    : ${formatUptime(Date.now() - info.started_at)}`);
  console.log(`  socket    : ${info.socket_path}`);
  console.log(`  api port  : ${info.api_port}`);
}

// ── Error helper ────────────────────────────────────────────────────────────

export function printError(msg: string): void {
  console.error(`${chalk.red('[warden error]')} ${msg}`);
}

export function printSuccess(msg: string): void {
  console.log(`${chalk.green('[warden]')} ${msg}`);
}
