import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Scratchpad } from './scratchpad.js';

describe('Scratchpad data directory', () => {
  let base: string;
  const original = process.env.DEXTER_DATA_DIR;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'dexter-scratch-'));
  });

  afterEach(() => {
    if (original === undefined) delete process.env.DEXTER_DATA_DIR;
    else process.env.DEXTER_DATA_DIR = original;
    rmSync(base, { recursive: true, force: true });
  });

  test('writes under DEXTER_DATA_DIR when set', () => {
    process.env.DEXTER_DATA_DIR = join(base, 'data');
    const pad = new Scratchpad('what is AAPL revenue');
    pad.addToolResult('financial_search', { q: 'AAPL' }, '{"ok":true}');

    expect(pad.isPersisted()).toBe(true);
    const files = readdirSync(join(base, 'data', 'scratchpad'));
    expect(files).toHaveLength(1);
    expect(pad.getToolCallRecords()).toHaveLength(1);
  });

  test('falls back to memory when the directory cannot be created', () => {
    // A regular file where the data dir should be makes mkdir fail (also as root)
    const blocker = join(base, 'not-a-dir');
    writeFileSync(blocker, 'x');
    process.env.DEXTER_DATA_DIR = blocker;

    const pad = new Scratchpad('query');
    pad.addToolResult('financial_search', { q: 'MSFT' }, 'plain result');

    expect(pad.isPersisted()).toBe(false);
    const records = pad.getToolCallRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.result).toBe('plain result');
  });

  test('keeps earlier entries in memory if the file becomes unwritable mid-run', () => {
    const dataDir = join(base, 'data');
    process.env.DEXTER_DATA_DIR = dataDir;
    const pad = new Scratchpad('query');
    pad.addToolResult('t1', {}, 'r1');

    const dir = join(dataDir, 'scratchpad');
    const [file] = readdirSync(dir);
    chmodSync(join(dir, file!), 0o444);
    pad.addToolResult('t2', {}, 'r2');

    // Running as root ignores file modes; only assert the fallback when it kicked in
    if (!pad.isPersisted()) {
      expect(pad.getToolCallRecords().map((r) => r.tool)).toEqual(['t1', 't2']);
    } else {
      expect(process.getuid?.()).toBe(0);
    }
  });
});
