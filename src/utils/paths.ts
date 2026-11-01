import { join } from 'node:path';

const DEXTER_DIR = '.dexter';

export function getDexterDir(): string {
  return DEXTER_DIR;
}

export function dexterPath(...segments: string[]): string {
  return join(getDexterDir(), ...segments);
}

/**
 * Root directory for runtime data (scratchpads, API cache).
 * Defaults to `.dexter` relative to the working directory; set DEXTER_DATA_DIR to
 * point it at a writable location (e.g. in a container running as a non-root user).
 * Read on every call so tests and late env changes take effect.
 */
export function getDexterDataDir(): string {
  return process.env.DEXTER_DATA_DIR?.trim() || DEXTER_DIR;
}

export function dexterDataPath(...segments: string[]): string {
  return join(getDexterDataDir(), ...segments);
}
