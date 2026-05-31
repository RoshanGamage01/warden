import fs from 'fs';
import path from 'path';
import { AppConfig, EcosystemConfig } from '../core/types.js';

const ECOSYSTEM_BASENAMES = new Set([
  'ecosystem.config.js',
  'ecosystem.config.cjs',
  'ecosystem.config.json',
  'warden.config.js',
  'warden.config.cjs',
  'warden.config.json',
]);

/**
 * Returns true when the path should be loaded as an ecosystem config
 * (not started directly as a process script).
 *
 * Rules:
 * - Known config filenames (ecosystem.config.js, warden.config.json, …)
 * - Any *.config.js / *.config.cjs / *.config.json
 * - Any .json file whose parsed content has an `apps` array
 */
export function isEcosystemConfigFile(filePath: string): boolean {
  const abs = path.resolve(filePath);
  const base = path.basename(abs).toLowerCase();

  if (ECOSYSTEM_BASENAMES.has(base)) return true;
  if (/\.config\.(js|cjs|json)$/i.test(base)) return true;

  if (path.extname(abs).toLowerCase() === '.json' && fs.existsSync(abs)) {
    try {
      const raw = JSON.parse(fs.readFileSync(abs, 'utf8')) as unknown;
      return (
        typeof raw === 'object' &&
        raw !== null &&
        Array.isArray((raw as Record<string, unknown>)['apps'])
      );
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Load an ecosystem config file.
 * Supports .js (module.exports = { apps: [...] }) and .json formats.
 */
export function loadEcosystem(filePath: string): EcosystemConfig {
  const abs = path.resolve(filePath);

  if (!fs.existsSync(abs)) {
    throw new Error(`Ecosystem config not found: ${abs}`);
  }

  const ext = path.extname(abs).toLowerCase();
  let raw: unknown;

  if (ext === '.json') {
    raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } else {
    // JS / CJS module: delete require cache to support hot reload
    delete require.cache[abs];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    raw = require(abs);
  }

  if (!raw || typeof raw !== 'object') {
    throw new Error(`Invalid ecosystem config: must export an object with an 'apps' array`);
  }

  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj['apps'])) {
    throw new Error(`Ecosystem config must have an 'apps' array`);
  }

  const apps = obj['apps'] as AppConfig[];

  // Validate each app has at minimum a 'script' field
  for (const app of apps) {
    if (!app.script) {
      throw new Error(`Each app in ecosystem config must have a 'script' field`);
    }
  }

  return { apps };
}

/**
 * Find an ecosystem config file in the given directory (or cwd).
 * Checks common filenames in priority order.
 */
export function findEcosystem(dir: string = process.cwd()): string | null {
  const candidates = [
    'ecosystem.config.js',
    'ecosystem.config.cjs',
    'ecosystem.config.json',
    'warden.config.js',
    'warden.config.json',
  ];

  for (const name of candidates) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}
