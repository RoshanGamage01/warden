/**
 * Worker entry point: simply require/load the user script.
 * Environment: WARDEN_EXEC_SCRIPT is the absolute path to the target script.
 */

const script = process.env.WARDEN_EXEC_SCRIPT;

if (!script) {
  process.stderr.write('[warden-worker] WARDEN_EXEC_SCRIPT not set\n');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
require(script);
