import { describe, test, expect } from 'bun:test';
import { filterForWebMode, getToolRegistry, isBrowserToolEnabled, WEB_MODE_TOOLS } from './registry.js';

describe('browser tool gating', () => {
  test('disabled in web mode', () => {
    expect(isBrowserToolEnabled({ DEXTER_WEB_MODE: '1' })).toBe(false);
    expect(isBrowserToolEnabled({})).toBe(true);
  });

  test('registry omits the browser tool when DEXTER_WEB_MODE=1', () => {
    const previous = process.env.DEXTER_WEB_MODE;
    try {
      process.env.DEXTER_WEB_MODE = '1';
      expect(getToolRegistry('gpt-5.2').map((t) => t.name)).not.toContain('browser');
      delete process.env.DEXTER_WEB_MODE;
      const registry = getToolRegistry('gpt-5.2');
      const browser = registry.find((t) => t.name === 'browser');
      expect(browser?.dispose).toBeDefined();
      // Each registry call gets its own browser tool instance (per-run isolation)
      expect(getToolRegistry('gpt-5.2').find((t) => t.name === 'browser')?.tool).not.toBe(browser?.tool);
    } finally {
      if (previous === undefined) delete process.env.DEXTER_WEB_MODE;
      else process.env.DEXTER_WEB_MODE = previous;
    }
  });
});

describe('web mode tool allow-list', () => {
  test('only WEB_MODE_TOOLS are registered when DEXTER_WEB_MODE=1', () => {
    const previous = process.env.DEXTER_WEB_MODE;
    try {
      delete process.env.DEXTER_WEB_MODE;
      const cliNames = getToolRegistry('gpt-5.2').map((t) => t.name);
      // Sanity: the CLI registry really contains the dangerous tools being filtered
      for (const name of ['web_fetch', 'read_file', 'write_file', 'edit_file', 'memory_update', 'cron']) {
        expect(cliNames).toContain(name);
      }

      process.env.DEXTER_WEB_MODE = '1';
      const webNames = getToolRegistry('gpt-5.2').map((t) => t.name);
      expect(webNames.length).toBeGreaterThan(0);
      for (const name of webNames) expect(WEB_MODE_TOOLS.has(name)).toBe(true);
      for (const name of ['browser', 'web_fetch', 'read_file', 'write_file', 'edit_file', 'bash',
        'heartbeat', 'cron', 'memory_search', 'memory_get', 'memory_update', 'ask_user_question', 'spawn_subagent']) {
        expect(webNames).not.toContain(name);
      }
    } finally {
      if (previous === undefined) delete process.env.DEXTER_WEB_MODE;
      else process.env.DEXTER_WEB_MODE = previous;
    }
  });
});

describe('filterForWebMode', () => {
  const tools = [{ name: 'get_financials' }, { name: 'bash' }, { name: 'read_file' }, { name: 'skill' }];

  test('drops non-allow-listed tools in web mode', () => {
    expect(filterForWebMode(tools, { DEXTER_WEB_MODE: '1' }).map((t) => t.name)).toEqual(['get_financials', 'skill']);
  });

  test('keeps everything outside web mode', () => {
    expect(filterForWebMode(tools, {})).toBe(tools);
  });
});
