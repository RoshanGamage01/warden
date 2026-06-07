import { describe, it, expect, afterEach } from 'vitest';
import { getCliName } from '../src/cli/cli-name.js';

describe('getCliName', () => {
  const originalArgv = process.argv[1];

  afterEach(() => {
    process.argv[1] = originalArgv;
  });

  it('returns warden when invoked as warden.js', () => {
    process.argv[1] = '/usr/local/bin/warden.js';
    expect(getCliName()).toBe('warden');
  });

  it('returns wdn when invoked as wdn shim', () => {
    process.argv[1] = '/usr/local/bin/wdn';
    expect(getCliName()).toBe('wdn');
  });

  it('falls back to warden for unknown entry names', () => {
    process.argv[1] = '/tmp/custom-runner';
    expect(getCliName()).toBe('warden');
  });
});
