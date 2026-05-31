import fs from 'fs';
import path from 'path';
import os from 'os';

export type Platform = 'systemd' | 'launchd' | 'upstart' | 'openrc' | 'auto';

function detectPlatform(): Platform {
  switch (process.platform) {
    case 'darwin':
      return 'launchd';
    case 'linux':
      if (fs.existsSync('/run/systemd/private')) return 'systemd';
      if (fs.existsSync('/sbin/upstart')) return 'upstart';
      return 'systemd';
    default:
      return 'systemd';
  }
}

function resolveWardenBin(): string {
  const candidates = [
    path.resolve(__dirname, '../../bin/warden.js'),
    path.resolve(process.execPath, '../../lib/node_modules/@roshan-gamage/warden/dist/bin/warden.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'warden';
}

function systemdService(wardenBin: string, user: string): string {
  const nodeExec = process.execPath;
  return `[Unit]
Description=Warden Process Manager
Documentation=https://github.com/your-org/warden
After=network.target

[Service]
Type=simple
User=${user}
ExecStart=${nodeExec} ${wardenBin} resurrect --no-daemon
ExecReload=${nodeExec} ${wardenBin} reload all
ExecStop=${nodeExec} ${wardenBin} kill
Restart=on-failure
RestartSec=5s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

function systemdInstall(content: string): string {
  const serviceFile = '/etc/systemd/system/warden.service';
  fs.writeFileSync(serviceFile, content);
  return [
    `Wrote ${serviceFile}`,
    'Run: sudo systemctl daemon-reload',
    'Run: sudo systemctl enable warden',
    'Run: sudo systemctl start warden',
  ].join('\n');
}

function systemdUninstall(): string {
  const serviceFile = '/etc/systemd/system/warden.service';
  const out: string[] = [];
  out.push('Run: sudo systemctl stop warden');
  out.push('Run: sudo systemctl disable warden');
  if (fs.existsSync(serviceFile)) {
    fs.unlinkSync(serviceFile);
    out.push(`Removed ${serviceFile}`);
  }
  out.push('Run: sudo systemctl daemon-reload');
  return out.join('\n');
}

function launchdPlist(wardenBin: string, _user: string): string {
  const nodeExec = process.execPath;
  const label = 'com.warden.daemon';
  const logDir = path.join(os.homedir(), '.warden', 'logs');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${nodeExec}</string>
      <string>${wardenBin}</string>
      <string>resurrect</string>
      <string>--no-daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logDir}/warden-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/warden-stderr.log</string>
  </dict>
</plist>
`;
}

function launchdInstall(content: string): string {
  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  fs.mkdirSync(plistDir, { recursive: true });
  const plistPath = path.join(plistDir, 'com.warden.daemon.plist');
  fs.writeFileSync(plistPath, content);
  return [
    `Wrote ${plistPath}`,
    `Run: launchctl load ${plistPath}`,
  ].join('\n');
}

function launchdUninstall(): string {
  const plistPath = path.join(
    os.homedir(),
    'Library',
    'LaunchAgents',
    'com.warden.daemon.plist'
  );
  const out: string[] = [];
  if (fs.existsSync(plistPath)) {
    out.push(`Run: launchctl unload ${plistPath}`);
    fs.unlinkSync(plistPath);
    out.push(`Removed ${plistPath}`);
  } else {
    out.push('No launchd plist found.');
  }
  return out.join('\n');
}

export function generateStartupScript(platform: Platform = 'auto'): {
  platform: Platform;
  content: string;
  instructions: string;
} {
  const resolved: Platform = platform === 'auto' ? detectPlatform() : platform;
  const wardenBin = resolveWardenBin();
  const user = os.userInfo().username;

  switch (resolved) {
    case 'launchd': {
      const content = launchdPlist(wardenBin, user);
      return {
        platform: resolved,
        content,
        instructions: launchdInstall(content),
      };
    }
    default: {
      const content = systemdService(wardenBin, user);
      return {
        platform: resolved,
        content,
        instructions: systemdInstall(content),
      };
    }
  }
}

export function removeStartupScript(platform: Platform = 'auto'): string {
  const resolved: Platform = platform === 'auto' ? detectPlatform() : platform;
  switch (resolved) {
    case 'launchd':
      return launchdUninstall();
    default:
      return systemdUninstall();
  }
}
