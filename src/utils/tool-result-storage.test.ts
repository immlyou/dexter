import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToolMessage } from '@langchain/core/messages';
import { capLargeResult, IN_MEMORY_RESULT_CHARS, MAX_TOOL_RESULT_CHARS } from './tool-result-storage.js';
import { BUDGET_IN_MEMORY_CHARS, enforceResultBudget, MAX_TURN_RESULT_CHARS } from './tool-result-budget.js';

const big = (n: number, ch = 'x') => ch.repeat(n);

let dataDir: string;
const saved = { dataDir: process.env.DEXTER_DATA_DIR, webMode: process.env.DEXTER_WEB_MODE };

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'dexter-results-test-'));
  process.env.DEXTER_DATA_DIR = dataDir;
  delete process.env.DEXTER_WEB_MODE;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  for (const [key, value] of [['DEXTER_DATA_DIR', saved.dataDir], ['DEXTER_WEB_MODE', saved.webMode]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('capLargeResult', () => {
  test('CLI persists under DEXTER_DATA_DIR and points read_file at it', () => {
    const result = big(MAX_TOOL_RESULT_CHARS + 1);
    const content = capLargeResult('call/1', result);

    const filePath = join(dataDir, 'tool-results', 'call_1.txt');
    expect(readFileSync(filePath, 'utf-8')).toBe(result);
    expect(content).toContain(filePath);
    expect(content).toContain('read_file');
  });

  test('CLI falls back to in-memory truncation when the write fails', () => {
    // A regular file where the data dir should be makes mkdir fail
    const blocker = join(dataDir, 'not-a-dir');
    writeFileSync(blocker, '');
    process.env.DEXTER_DATA_DIR = blocker;

    const content = capLargeResult('call-2', big(MAX_TOOL_RESULT_CHARS + 1));
    expect(content).toStartWith(big(IN_MEMORY_RESULT_CHARS));
    expect(content).toContain('Result truncated');
    expect(content).not.toContain('read_file');
  });

  test('web mode never writes to disk nor reveals paths or read_file', () => {
    process.env.DEXTER_WEB_MODE = '1';
    const content = capLargeResult('call-3', big(MAX_TOOL_RESULT_CHARS * 2));

    expect(existsSync(join(dataDir, 'tool-results'))).toBe(false);
    expect(content).not.toContain(dataDir);
    expect(content).not.toContain('read_file');
    expect(content).toStartWith(big(IN_MEMORY_RESULT_CHARS));
    expect(content.length).toBeLessThan(IN_MEMORY_RESULT_CHARS + 300);
  });
});

describe('enforceResultBudget', () => {
  const messages = (count: number, size: number) =>
    Array.from({ length: count }, (_, i) => new ToolMessage({ content: big(size), tool_call_id: `t${i}`, name: 'x' }));
  const total = (tms: ToolMessage[]) => tms.reduce((sum, tm) => sum + String(tm.content).length, 0);

  test('under budget returns the same array', () => {
    const tms = messages(2, 1000);
    expect(enforceResultBudget(tms)).toBe(tms);
  });

  test('web mode truncates in memory to fit the budget without touching disk', () => {
    process.env.DEXTER_WEB_MODE = '1';
    const capped = enforceResultBudget(messages(5, 49_000));

    expect(total(capped)).toBeLessThanOrEqual(MAX_TURN_RESULT_CHARS);
    expect(capped.some((tm) => String(tm.content).startsWith(big(BUDGET_IN_MEMORY_CHARS)))).toBe(true);
    expect(capped.every((tm) => !String(tm.content).includes('read_file'))).toBe(true);
    expect(existsSync(join(dataDir, 'tool-results'))).toBe(false);
  });

  test('CLI persists the largest results to fit the budget', () => {
    const capped = enforceResultBudget(messages(5, 49_000));
    expect(total(capped)).toBeLessThanOrEqual(MAX_TURN_RESULT_CHARS);
    expect(existsSync(join(dataDir, 'tool-results', 't0.txt'))).toBe(true);
  });
});
