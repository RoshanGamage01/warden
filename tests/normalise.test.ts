import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { normaliseConfig } from '../src/core/utils.js';
import { AppConfig } from '../src/core/types.js';

describe('normaliseConfig', () => {
  it('derives name from script filename', () => {
    const config: AppConfig = { script: '/tmp/my-app.js' };
    const entry = normaliseConfig(config, 0);
    expect(entry.name).toBe('my-app');
  });

  it('uses provided name', () => {
    const config: AppConfig = { script: '/tmp/app.js', name: 'custom-name' };
    const entry = normaliseConfig(config, 0);
    expect(entry.name).toBe('custom-name');
  });

  it('defaults exec_mode to fork', () => {
    const entry = normaliseConfig({ script: './app.js' }, 0);
    expect(entry.exec_mode).toBe('fork');
  });

  it('assigns warden_id', () => {
    const entry = normaliseConfig({ script: './app.js' }, 42);
    expect(entry.warden_id).toBe(42);
  });

  it('defaults status to stopped', () => {
    const entry = normaliseConfig({ script: './app.js' }, 0);
    expect(entry.status).toBe('stopped');
  });

  it('respects autorestart: false', () => {
    const entry = normaliseConfig({ script: './app.js', autorestart: false }, 0);
    expect(entry.autorestart).toBe(false);
  });

  it('resolves max_memory_restart string', () => {
    const entry = normaliseConfig({ script: './app.js', max_memory_restart: '100M' }, 0);
    expect(entry.max_memory_restart).toBe(104857600);
  });

  it('resolves min_uptime string', () => {
    const entry = normaliseConfig({ script: './app.js', min_uptime: '2s' }, 0);
    expect(entry.min_uptime).toBe(2000);
  });

  it('sets interpreter=node for .js', () => {
    const entry = normaliseConfig({ script: '/tmp/server.js' }, 0);
    expect(entry.interpreter).toBe('node');
  });

  it('sets interpreter=python3 for .py', () => {
    const entry = normaliseConfig({ script: '/tmp/script.py' }, 0);
    expect(entry.interpreter).toBe('python3');
  });
});
