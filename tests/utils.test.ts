import { describe, it, expect } from 'vitest';
import { parseMemory, parseTime, formatBytes, formatUptime, backoffDelay } from '../src/core/utils.js';

describe('parseMemory', () => {
  it('parses byte integer', () => expect(parseMemory(1024)).toBe(1024));
  it('parses K suffix', () => expect(parseMemory('512k')).toBe(524288));
  it('parses M suffix', () => expect(parseMemory('10M')).toBe(10485760));
  it('parses G suffix', () => expect(parseMemory('1G')).toBe(1073741824));
  it('returns 0 for undefined', () => expect(parseMemory(undefined)).toBe(0));
  it('returns 0 for 0', () => expect(parseMemory(0)).toBe(0));
});

describe('parseTime', () => {
  it('parses ms integer', () => expect(parseTime(500)).toBe(500));
  it('parses s suffix', () => expect(parseTime('2s')).toBe(2000));
  it('parses m suffix', () => expect(parseTime('1m')).toBe(60000));
  it('parses ms suffix', () => expect(parseTime('250ms')).toBe(250));
  it('parses h suffix', () => expect(parseTime('1h')).toBe(3600000));
  it('uses default for undefined', () => expect(parseTime(undefined, 1000)).toBe(1000));
});

describe('formatBytes', () => {
  it('formats bytes', () => expect(formatBytes(512)).toBe('512B'));
  it('formats KB', () => expect(formatBytes(1536)).toBe('1.5K'));
  it('formats MB', () => expect(formatBytes(2 * 1024 * 1024)).toBe('2.0M'));
  it('formats GB', () => expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.50G'));
});

describe('formatUptime', () => {
  it('formats seconds', () => expect(formatUptime(5000)).toBe('5s'));
  it('formats minutes', () => expect(formatUptime(90_000)).toBe('1m'));
  it('formats hours', () => expect(formatUptime(3_700_000)).toBe('1h'));
  it('formats days', () => expect(formatUptime(86_400_000 * 2)).toBe('2d'));
  it('returns 0s for zero', () => expect(formatUptime(0)).toBe('0s'));
});

describe('backoffDelay', () => {
  it('returns 0 when baseDelay is 0', () => {
    expect(backoffDelay(5, 0, 15_000)).toBe(0);
  });
  it('doubles with each retry', () => {
    expect(backoffDelay(0, 500, 15_000)).toBe(500);
    expect(backoffDelay(1, 500, 15_000)).toBe(1000);
    expect(backoffDelay(2, 500, 15_000)).toBe(2000);
  });
  it('caps at max', () => {
    expect(backoffDelay(20, 500, 15_000)).toBe(15_000);
  });
});
