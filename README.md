# Warden — Internal Process Manager

A self-hosted, PM2-equivalent process manager built in TypeScript for Node 18+.  
Manages **any** process (Node.js, Python, Ruby, binaries, shell scripts) with the full PM2 feature set and first-class telemetry.

## Features

| Category | Feature |
|----------|---------|
| **Process modes** | Fork mode (any process), Node.js Cluster mode (multi-instance, port-sharing) |
| **Auto-restart** | Crash detection, exponential backoff, `max_restarts`, `min_uptime` stability gate |
| **Zero-downtime reload** | Rolling reload for cluster apps (`warden reload`) |
| **Scale** | `warden scale <name> <n>` — add/remove cluster workers at runtime |
| **Watch** | File-system watch triggers reload (`--watch`) |
| **Cron restart** | Scheduled restarts via cron expression (`--cron "0 0 * * *"`) |
| **Memory limit** | Auto-restart on memory threshold (`--max-memory-restart 150M`) |
| **Log management** | Per-process stdout/stderr files, rotation, streaming via `warden logs` |
| **Persistence** | `warden save` / `warden resurrect` with `~/.warden/dump.json` |
| **Startup** | Generate systemd / launchd service via `warden startup` |
| **Ecosystem config** | Declare multiple apps in `ecosystem.config.js` / `.json` |
| **Live dashboard** | `warden monit` — auto-refreshing terminal table |
| **HTTP API** | `GET /processes`, `/summary`, `/processes/:id/metrics` |
| **Prometheus** | `GET /metrics` endpoint (prom-client gauges/counters) |
| **Telemetry** | SQLite time-series, 24-hour retention, 5-second sampling |

---

## Installation

```bash
# From the workspace root:
npm install
npm run build

# Link globally (optional):
npm link
```

The `warden` binary is at `./dist/bin/warden.js` after build.

---

## Quick start

```bash
# Start any Node script directly
warden start ./server.js --name api

# Start a Python script
warden start ./worker.py --interpreter python3 --name worker

# Start with 4 cluster instances (Node.js only, port-sharing)
warden start ./app.js --instances 4 --name app

# Use an ecosystem config (ecosystem.config.js, warden.config.json, or *.config.js)
warden start ecosystem.config.js

# List all processes
warden list

# Stream logs
warden logs           # all processes
warden logs api       # by name
warden logs 0         # by id

# Live dashboard
warden monit
```

---

## CLI Reference

### Process management

| Command | Description |
|---------|-------------|
| `warden start <script>` | Start a process (`.js`, `.py`, binaries, etc.) |
| `warden start <ecosystem.config.js>` | Start all apps in an ecosystem config |
| `warden stop <id\|name>` | Stop a process |
| `warden restart <id\|name>` | Restart a process |
| `warden reload <id\|name>` | Zero-downtime reload (cluster) or graceful restart (fork) |
| `warden delete <id\|name>` | Stop and remove from registry |
| `warden scale <id\|name> <n>` | Scale cluster app to N workers |
| `warden reset <id\|name>` | Reset restart counters |

### Inspection

| Command | Description |
|---------|-------------|
| `warden list` / `warden ls` | Process table with CPU/mem/uptime |
| `warden describe <id\|name>` | Full process detail including cluster workers |
| `warden monit` | Live refreshing dashboard (Ctrl+C to quit) |
| `warden ping` | Check daemon status |

### Logs

| Command | Description |
|---------|-------------|
| `warden logs [id]` | Stream logs (Ctrl+C to stop) |
| `warden logs -n 50 [id]` | Show last 50 historical lines then stream |
| `warden flush [id]` | Truncate log files |

### Persistence & startup

| Command | Description |
|---------|-------------|
| `warden save` | Write current process list to `~/.warden/dump.json` |
| `warden resurrect` | Start all saved processes |
| `warden startup [platform]` | Install system startup service (auto, systemd, launchd) |
| `warden unstartup [platform]` | Remove startup service |

### Daemon

| Command | Description |
|---------|-------------|
| `warden kill` | Gracefully stop all processes and the daemon |

---

## `start` options

```
-n, --name <name>               App name (defaults to script filename)
-i, --instances <n|max>         Number of instances; "max" uses all CPUs
    --exec-mode <fork|cluster>  Execution mode (auto-set to cluster if -i > 1)
    --interpreter <binary>      Interpreter (e.g. python3, ruby)
    --node-args <args>          Extra Node.js args
    --cwd <dir>                 Working directory
-e, --env <KEY=VAL>             Environment variable (repeatable)
    --watch                     Restart on file changes
    --max-memory-restart <size> Restart threshold (e.g. 150M, 1G)
    --cron <expr>               Scheduled restart (cron expression)
    --max-restarts <n>          Max crash-restart attempts (default 16)
    --min-uptime <time>         Stability gate (e.g. 1s, 500ms)
    --restart-delay <ms>        Delay between restarts
    --no-auto-restart           Disable crash auto-restart
    --merge-logs                Merge stdout and stderr into one file
    --kill-timeout <ms>         Graceful shutdown timeout
```

---

## Ecosystem config

```js
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'api',
      script: './src/api.js',
      instances: 2,
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production', PORT: '3000' },
      max_memory_restart: '500M',
    },
    {
      name: 'worker',
      script: './src/worker.js',
      watch: ['./src'],
      ignore_watch: ['node_modules'],
      cron_restart: '0 3 * * *',  // restart daily at 3am
    },
    {
      name: 'ml-model',
      script: './predict.py',
      interpreter: 'python3',
      autorestart: true,
      max_restarts: 5,
    },
  ],
};
```

```bash
warden start ecosystem.config.js
```

---

## HTTP API

Runs on `http://127.0.0.1:9615` by default.

| Endpoint | Description |
|----------|-------------|
| `GET /health` | `{ status: 'ok', pid }` |
| `GET /processes` | All processes with latest CPU/mem |
| `GET /processes/:id` | Single process + 120 recent metric points |
| `GET /processes/:id/metrics?range=1h` | Time-series data (range: `1h`, `6h`, `24h`, `7d`) |
| `GET /summary` | Aggregate totals (online, stopped, errored, CPU, memory) |
| `GET /metrics` | Prometheus exposition format |

---

## Prometheus / Grafana

Point your Prometheus scrape config at `http://127.0.0.1:9615/metrics`:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: warden
    static_configs:
      - targets: ['127.0.0.1:9615']
```

Available metrics:
- `warden_process_cpu_percent{warden_id, name}`
- `warden_process_memory_bytes{warden_id, name}`
- `warden_process_restarts_total{warden_id, name}`
- `warden_process_uptime_seconds{warden_id, name}`
- `warden_process_online{warden_id, name, status}`
- Standard Node.js process metrics via `prom-client`

---

## File locations

| Path | Purpose |
|------|---------|
| `~/.warden/daemon.sock` | Unix domain socket (IPC) |
| `~/.warden/daemon.pid` | Daemon PID file |
| `~/.warden/dump.json` | Saved process list |
| `~/.warden/metrics.db` | SQLite metrics database (24-hour rolling window) |
| `~/.warden/logs/<name>-<id>/out.log` | Stdout log |
| `~/.warden/logs/<name>-<id>/err.log` | Stderr log |
| `~/.warden/logs/<name>-<id>/out.log.1` | Rotated log (up to 5 backups) |

---

## Architecture overview

```
CLI (warden)
  │  JSON-RPC over Unix domain socket
  ▼
Daemon (God process)
  ├─ IPC Server          — RPC request router
  ├─ AppRegistry         — Registry of all managed apps
  │    ├─ ProcessSupervisor  — fork-mode lifecycle, backoff, log piping
  │    └─ ClusterManager    — fork(cluster/master.js) → N workers
  ├─ WatchManager        — chokidar → restart
  ├─ CronScheduler       — croner → restart
  ├─ MemoryMonitor       — pidusage → restart on threshold
  ├─ MetricsSampler      — pidusage every 5s → SQLite
  ├─ LogRotator          — size-based rotation every 60s
  └─ HTTP API (Fastify)  — /processes, /metrics (Prometheus)
```

### Daemon bootstrap

1. CLI checks if `~/.warden/daemon.sock` is connectable
2. If not, spawns daemon detached: `node dist/daemon/index.js`
3. CLI polls socket every 100 ms (max 5 s) for readiness
4. CLI connects and sends JSON-RPC

### IPC framing

```
[4-byte BE uint32: body length] [UTF-8 JSON payload]
```

Handles TCP fragmentation and multiple messages per chunk.

### Process state machine

```
 [*] ──► launching ──► online ──► stopping ──► stopped
                │         │                       │
                │         └──► launching (crash)  │
                │         └──► errored (exceeded) │
                └───────────────────────────────► [start]
```

---

## Development

```bash
npm run dev     # watch mode build
npm test        # unit tests
npm run test:watch  # watch mode

# Run integration tests (starts/stops real daemon)
npm test        # integration tests are auto-run (uses isolated ~/.warden)

# Skip integration tests
SKIP_INTEGRATION=1 npm test
```

---

## Windows support

On Windows, the Unix domain socket path is replaced with a named pipe (`\\.\pipe\warden-daemon`). All other functionality is identical. The `pidusage` and `better-sqlite3` packages are cross-platform; `better-sqlite3` may require the [Build Tools for Visual Studio](https://visualstudio.microsoft.com/downloads/) if prebuilt binaries are not available for your Node version.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WARDEN_API_PORT` | `9615` | HTTP API port |
| `WARDEN_API_HOST` | `127.0.0.1` | HTTP API bind address |

---

## License

MIT
