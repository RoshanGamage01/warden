import path from 'path';

const CLI_NAMES = new Set(['warden', 'wdn']);

/** Resolved shell command name (warden or wdn). */
export function getCliName(): string {
  const invoked = path.basename(process.argv[1] ?? 'warden', path.extname(process.argv[1] ?? ''));
  return CLI_NAMES.has(invoked) ? invoked : 'warden';
}
