import { describe, it, expect } from 'vitest';
import { loadEcosystem, isEcosystemConfigFile } from '../src/config/loader.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

const TMP = os.tmpdir();

describe('isEcosystemConfigFile', () => {
  it('recognises ecosystem.config.js', () => {
    expect(isEcosystemConfigFile('ecosystem.config.js')).toBe(true);
  });

  it('recognises warden.config.json', () => {
    expect(isEcosystemConfigFile('/path/to/warden.config.json')).toBe(true);
  });

  it('recognises any *.config.json as ecosystem config', () => {
    expect(isEcosystemConfigFile('/path/to/staging.config.json')).toBe(true);
  });

  it('recognises custom *.config.js files', () => {
    expect(isEcosystemConfigFile('staging.config.js')).toBe(true);
    expect(isEcosystemConfigFile('production.config.cjs')).toBe(true);
  });

  it('does not treat regular app scripts as ecosystem configs', () => {
    expect(isEcosystemConfigFile('scheduler.js')).toBe(false);
    expect(isEcosystemConfigFile('server.js')).toBe(false);
    expect(isEcosystemConfigFile('./src/index.js')).toBe(false);
  });

  it('detects JSON files with an apps array', () => {
    const file = path.join(TMP, `apps-only-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ apps: [{ script: './a.js' }] }));
    expect(isEcosystemConfigFile(file)).toBe(true);
    fs.unlinkSync(file);
  });

  it('does not treat JSON without apps as ecosystem config', () => {
    const file = path.join(TMP, `package-like-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ name: 'my-app', version: '1.0.0' }));
    expect(isEcosystemConfigFile(file)).toBe(false);
    fs.unlinkSync(file);
  });
});

describe('loadEcosystem', () => {
  it('loads a JSON ecosystem config', () => {
    const file = path.join(TMP, `eco-test-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({
      apps: [
        { name: 'api', script: './api.js' },
        { name: 'worker', script: './worker.js', instances: 2, exec_mode: 'cluster' },
      ],
    }));
    const eco = loadEcosystem(file);
    expect(eco.apps).toHaveLength(2);
    expect(eco.apps[0].name).toBe('api');
    expect(eco.apps[1].instances).toBe(2);
    fs.unlinkSync(file);
  });

  it('throws for missing script field', () => {
    const file = path.join(TMP, `eco-bad-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ apps: [{ name: 'broken' }] }));
    expect(() => loadEcosystem(file)).toThrow(/script/i);
    fs.unlinkSync(file);
  });

  it('throws for missing file', () => {
    expect(() => loadEcosystem('/nonexistent/path/eco.json')).toThrow(/not found/i);
  });

  it('throws if apps is not an array', () => {
    const file = path.join(TMP, `eco-noarr-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ apps: 'not an array' }));
    expect(() => loadEcosystem(file)).toThrow();
    fs.unlinkSync(file);
  });
});
