import { describe, test, expect } from 'bun:test';
import { getToolRegistry, isBrowserToolEnabled } from './registry.js';

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
