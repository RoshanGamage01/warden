import { Command } from 'commander';
import chalk from 'chalk';
import os from 'os';
import path from 'path';
import { getClient } from './daemon-bootstrap.js';
import {
  printProcessTable,
  printDescribe,
  printInfo,
  printError,
  printSuccess,
  ListRow,
} from './output.js';
import { isEcosystemConfigFile, loadEcosystem } from '../config/loader.js';
import { AppConfig, LogEvent } from '../core/types.js';
import { VERSION } from '../core/constants.js';
import { getCliName } from './cli-name.js';

// ── Monit dashboard ─────────────────────────────────────────────────────────

async function runMonit(): Promise<void> {
  const client = await getClient();
  const REFRESH = 2_000;

  const render = async () => {
    try {
      const entries = await client.call<ListRow[]>('list');
      process.stdout.write('\x1B[2J\x1B[0;0H'); // clear screen
      console.log(
        chalk.cyan.bold('  Warden Live Monitor') +
          chalk.grey(`  (refresh ${REFRESH / 1000}s · press Ctrl+C to quit)`)
      );
      console.log();
      printProcessTable(entries);
      console.log(chalk.grey(`  Updated: ${new Date().toLocaleTimeString()}`));
    } catch {
      // daemon died
    }
  };

  await render();
  const timer = setInterval(render, REFRESH);

  process.on('SIGINT', () => {
    clearInterval(timer);
    client.disconnect();
    process.exit(0);
  });
}

// ── Build app config from CLI options ──────────────────────────────────────

function buildConfig(script: string, opts: Record<string, unknown>): AppConfig {
  const config: AppConfig = { script };
  if (opts['name']) config.name = opts['name'] as string;
  if (opts['interpreter']) config.interpreter = opts['interpreter'] as string;
  if (opts['nodeArgs']) config.node_args = (opts['nodeArgs'] as string).split(' ').filter(Boolean);
  // Resolve relative script paths from the CLI's cwd, not the daemon's.
  config.cwd = (opts['cwd'] as string | undefined) ?? process.cwd();
  if (opts['env']) {
    const envPairs = (opts['env'] as string[]);
    config.env = {};
    for (const pair of envPairs) {
      const [k, ...rest] = pair.split('=');
      config.env[k] = rest.join('=');
    }
  }
  if (opts['instances']) {
    const n = String(opts['instances']);
    config.instances = n === 'max'
      ? os.cpus().length
      : parseInt(n, 10);
    if (config.instances > 1 && !opts['execMode']) config.exec_mode = 'cluster';
  }
  if (opts['execMode']) config.exec_mode = opts['execMode'] as 'fork' | 'cluster';
  if (opts['watch']) config.watch = true;
  if (opts['maxMemoryRestart']) config.max_memory_restart = opts['maxMemoryRestart'] as string;
  if (opts['cron']) config.cron_restart = opts['cron'] as string;
  if (opts['maxRestarts'] !== undefined) config.max_restarts = Number(opts['maxRestarts']);
  if (opts['minUptime']) config.min_uptime = opts['minUptime'] as string;
  if (opts['restartDelay'] !== undefined) config.restart_delay = Number(opts['restartDelay']);
  if (opts['noAutoRestart']) config.autorestart = false;
  if (opts['mergeLogs']) config.merge_logs = true;
  if (opts['killTimeout'] !== undefined) config.kill_timeout = Number(opts['killTimeout']);
  const extraArgs = (opts['_args'] as string[] | undefined) ?? [];
  if (extraArgs.length) config.args = extraArgs;
  return config;
}

// ── Wrap async commands with error handling ─────────────────────────────────

function wrap(fn: (...args: unknown[]) => Promise<void>) {
  return (...args: unknown[]) => {
    fn(...args).catch((err: Error) => {
      printError(err.message);
      process.exit(1);
    });
  };
}

// ── Create commander program ────────────────────────────────────────────────

export function createProgram(): Command {
  const program = new Command();

  program
    .name(getCliName())
    .description('Warden — Internal process manager')
    .version(VERSION, '-v, --version')
    .allowUnknownOption(false);

  // ── start ────────────────────────────────────────────────────────────

  program
    .command('start <script_or_ecosystem>')
    .description('Start a process (or all apps in an ecosystem config)')
    .option('-n, --name <name>', 'App name')
    .option('-i, --instances <n>', 'Number of instances (use "max" for all CPUs)')
    .option('--exec-mode <mode>', 'Execution mode: fork | cluster', 'fork')
    .option('--interpreter <binary>', 'Interpreter binary (e.g. python3)')
    .option('--node-args <args>', 'Extra node args (quoted string)')
    .option('--cwd <dir>', 'Working directory')
    .option('-e, --env <KEY=VAL>', 'Environment variable (repeatable)', (v, acc: string[]) => [...acc, v], [] as string[])
    .option('--watch', 'Watch files and restart on change')
    .option('--max-memory-restart <size>', 'Restart on memory limit (e.g. 150M)')
    .option('--cron <expr>', 'Cron expression for scheduled restarts')
    .option('--max-restarts <n>', 'Max crash-restart attempts')
    .option('--min-uptime <ms>', 'Min uptime to reset crash counter (e.g. 1s)')
    .option('--restart-delay <ms>', 'Delay between restarts (ms)')
    .option('--no-auto-restart', 'Disable automatic restarts on crash')
    .option('--merge-logs', 'Merge stdout and stderr into one file')
    .option('--kill-timeout <ms>', 'Graceful shutdown timeout (ms)')
    .allowUnknownOption(true)
    .action(wrap(async (scriptOrEco: string, opts, cmd) => {
      const client = await getClient();

      // Ecosystem configs use known filenames (*.config.js, ecosystem.config.js, …).
      // Regular scripts like scheduler.js are started directly.
      if (isEcosystemConfigFile(scriptOrEco)) {
        const ecoPath = path.resolve(scriptOrEco);
        const ecoDir = path.dirname(ecoPath);
        const eco = loadEcosystem(scriptOrEco);
        for (const appConfig of eco.apps) {
          const config = {
            ...appConfig,
            cwd: appConfig.cwd ?? ecoDir,
          };
          const entry = await client.call<{ name: string; warden_id: number; status: string }>(
            'start', config
          );
          printSuccess(`${entry.name} started (id ${entry.warden_id})`);
        }
      } else {
        const extraArgs = cmd.args.slice(1); // args after the script
        const config = buildConfig(scriptOrEco, { ...opts, _args: extraArgs });
        const entry = await client.call<{ name: string; warden_id: number; status: string }>(
          'start', config
        );
        printSuccess(`${entry.name} started (id ${entry.warden_id})`);
      }

      client.disconnect();
    }));

  // ── stop ─────────────────────────────────────────────────────────────

  program
    .command('stop <id>')
    .description('Stop a process by name or id')
    .action(wrap(async (id: string) => {
      const client = await getClient();
      await client.call('stop', { id });
      printSuccess(`${id} stopped`);
      client.disconnect();
    }));

  // ── restart ───────────────────────────────────────────────────────────

  program
    .command('restart <id>')
    .description('Restart a process by name or id')
    .action(wrap(async (id: string) => {
      const client = await getClient();
      await client.call('restart', { id });
      printSuccess(`${id} restarted`);
      client.disconnect();
    }));

  // ── reload ────────────────────────────────────────────────────────────

  program
    .command('reload <id>')
    .description('Zero-downtime reload (cluster mode) or graceful restart (fork mode)')
    .action(wrap(async (id: string) => {
      const client = await getClient();
      await client.call('reload', { id });
      printSuccess(`${id} reloaded`);
      client.disconnect();
    }));

  // ── delete ────────────────────────────────────────────────────────────

  program
    .command('delete <id>')
    .alias('del')
    .description('Stop and delete a process from the registry')
    .action(wrap(async (id: string) => {
      const client = await getClient();
      await client.call('delete', { id });
      printSuccess(`${id} deleted`);
      client.disconnect();
    }));

  // ── list ──────────────────────────────────────────────────────────────

  program
    .command('list')
    .alias('ls')
    .description('List all managed processes')
    .action(wrap(async () => {
      const client = await getClient();
      const entries = await client.call<ListRow[]>('list');
      printProcessTable(entries);
      client.disconnect();
    }));

  // ── describe ──────────────────────────────────────────────────────────

  program
    .command('describe <id>')
    .alias('info')
    .description('Show detailed info for a process')
    .action(wrap(async (id: string) => {
      const client = await getClient();
      const entry = await client.call<ListRow>('describe', { id });
      printDescribe(entry);
      client.disconnect();
    }));

  // ── logs ──────────────────────────────────────────────────────────────

  program
    .command('logs [id]')
    .description('Stream logs for all processes or a specific one')
    .option('-n, --lines <n>', 'Number of historical lines to show', '15')
    .action(wrap(async (id: string | undefined, opts) => {
      const client = await getClient();

      const warden_id = id !== undefined
        ? (() => {
            const n = parseInt(id, 10);
            return isNaN(n) ? undefined : n;
          })()
        : undefined;

      const lines = parseInt(opts.lines, 10);

      client.onEvent((ev) => {
        if (ev.event === 'log') {
          const log = ev.data as LogEvent;
          const prefix = chalk.cyan(`[${log.name}|${log.warden_id}]`);
          const typeTag = log.type === 'err' ? chalk.red('[err]') : chalk.grey('[out]');
          process.stdout.write(`${prefix}${typeTag} ${log.data}`);
        }
      });

      process.on('SIGINT', () => {
        client.disconnect();
        process.exit(0);
      });

      // Subscribe; daemon sends ack then streams events
      await client.call('logs_subscribe', { warden_id, lines });

      // Keep alive until Ctrl+C
      await new Promise<void>(() => {/* stream until SIGINT */});
    }));

  // ── flush ─────────────────────────────────────────────────────────────

  program
    .command('flush [id]')
    .description('Empty log files for a process or all processes')
    .action(wrap(async (id: string | undefined) => {
      const client = await getClient();
      await client.call('flush', id !== undefined ? { id } : {});
      printSuccess(id ? `Flushed logs for ${id}` : 'Flushed all logs');
      client.disconnect();
    }));

  // ── save ──────────────────────────────────────────────────────────────

  program
    .command('save')
    .description('Save the current process list to disk (~/.warden/dump.json)')
    .action(wrap(async () => {
      const client = await getClient();
      await client.call('save');
      printSuccess('Process list saved to ~/.warden/dump.json');
      client.disconnect();
    }));

  // ── resurrect ────────────────────────────────────────────────────────

  program
    .command('resurrect')
    .description('Restore previously saved process list')
    .option('--no-daemon', 'Run in foreground (used by startup services)')
    .action(wrap(async (opts) => {
      const client = await getClient();
      const result = await client.call<{ resurrected: number }>('resurrect');
      printSuccess(`Resurrected ${result.resurrected} process(es)`);
      client.disconnect();
    }));

  // ── scale ─────────────────────────────────────────────────────────────

  program
    .command('scale <id> <n>')
    .description('Scale a cluster app to N instances')
    .action(wrap(async (id: string, n: string) => {
      const instances = parseInt(n, 10);
      if (isNaN(instances) || instances < 1) {
        printError('Instance count must be a positive integer');
        process.exit(1);
      }
      const client = await getClient();
      await client.call('scale', { id, instances });
      printSuccess(`${id} scaled to ${instances} instance(s)`);
      client.disconnect();
    }));

  // ── reset ─────────────────────────────────────────────────────────────

  program
    .command('reset <id>')
    .description('Reset restart counters for a process')
    .action(wrap(async (id: string) => {
      const client = await getClient();
      await client.call('reset', { id });
      printSuccess(`${id} counters reset`);
      client.disconnect();
    }));

  // ── monit ─────────────────────────────────────────────────────────────

  program
    .command('monit')
    .description('Live terminal dashboard')
    .action(wrap(async () => {
      await runMonit();
    }));

  // ── startup ───────────────────────────────────────────────────────────

  program
    .command('startup [platform]')
    .description('Generate and install a startup script (systemd | launchd | auto)')
    .action(wrap(async (platform: string | undefined) => {
      const client = await getClient();
      const result = await client.call<{ platform: string; instructions: string }>(
        'startup', { platform: platform ?? 'auto' }
      );
      console.log(chalk.cyan(`\nStartup script generated (${result.platform})`));
      console.log(result.instructions);
      client.disconnect();
    }));

  // ── unstartup ─────────────────────────────────────────────────────────

  program
    .command('unstartup [platform]')
    .description('Remove the startup script')
    .action(wrap(async (platform: string | undefined) => {
      const client = await getClient();
      const result = await client.call<{ message: string }>(
        'unstartup', { platform: platform ?? 'auto' }
      );
      console.log(result.message);
      client.disconnect();
    }));

  // ── kill ──────────────────────────────────────────────────────────────

  program
    .command('kill')
    .description('Stop all processes and shut down the Warden daemon')
    .action(wrap(async () => {
      const { getDaemonPid } = await import('./daemon-bootstrap.js');
      const pid = getDaemonPid();
      if (!pid) {
        printError('No running daemon found');
        return;
      }
      try {
        process.kill(pid, 'SIGTERM');
        printSuccess(`Daemon (pid ${pid}) sent SIGTERM`);
      } catch {
        printError(`Could not signal daemon pid ${pid}`);
      }
    }));

  // ── ping / status ─────────────────────────────────────────────────────

  program
    .command('ping')
    .description('Check if the daemon is running and show its info')
    .action(wrap(async () => {
      const client = await getClient();
      const info = await client.call<{
        pid: number; version: string; started_at: number;
        socket_path: string; api_port: number;
      }>('info');
      printInfo(info);
      client.disconnect();
    }));

  return program;
}
