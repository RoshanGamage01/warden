import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 'bin/warden': 'bin/warden.ts' },
    format: ['cjs'],
    target: 'node18',
    platform: 'node',
    clean: true,
    external: ['better-sqlite3'],
    banner: { js: '#!/usr/bin/env node' },
    shims: false,
  },
  {
    entry: {
      'daemon/index': 'src/daemon/index.ts',
      'cluster/master': 'src/cluster/master.ts',
      'cluster/worker-entry': 'src/cluster/worker-entry.ts',
    },
    format: ['cjs'],
    target: 'node18',
    platform: 'node',
    clean: false,
    external: ['better-sqlite3'],
    shims: false,
  },
]);
