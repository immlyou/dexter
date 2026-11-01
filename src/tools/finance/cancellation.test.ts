import { describe, test, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as realLlm from '../../model/llm.js';

// ---------------------------------------------------------------------------
// Cancellation: every Financial Datasets request a finance tool makes must be
// bound to the run's abort signal, and every request has its own timeout even
// when no caller signal exists.
// ---------------------------------------------------------------------------

// Delegates to the real module unless a test installs a stub, so other test
// files sharing this process are unaffected by the module mock. The original
// is captured first: mock.module live-updates the `realLlm` namespace, so
// calling realLlm.callLlm from the stub would recurse into itself.
const originalCallLlm = realLlm.callLlm;
let llmStub: ((prompt: string, options?: { outputSchema?: unknown }) => Promise<unknown>) | null = null;
mock.module('../../model/llm.js', () => ({
  ...realLlm,
  callLlm: (prompt: string, options?: Parameters<typeof originalCallLlm>[1]) =>
    llmStub ? llmStub(prompt, options) : originalCallLlm(prompt, options),
}));

const { api, REQUEST_TIMEOUT_MS } = await import('./api.js');
const { callLlm: mockedCallLlm } = await import('../../model/llm.js');
const { createReadFilings } = await import('./read-filings.js');
const { createScreenStocks } = await import('./screen-stocks.js');

type Call = { url: string; method: string; signal?: AbortSignal | null };
const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
const originalDataDir = process.env.DEXTER_DATA_DIR;
let calls: Call[];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  calls = [];
  process.env.DEXTER_DATA_DIR = mkdtempSync(join(tmpdir(), 'dexter-cancel-test-'));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
  llmStub = null;
  rmSync(process.env.DEXTER_DATA_DIR!, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DEXTER_DATA_DIR;
  else process.env.DEXTER_DATA_DIR = originalDataDir;
});

afterAll(() => {
  mock.restore();
});

describe('callLlm module mock', () => {
  test('falls back to the original callLlm, not the mock itself', () => {
    expect(mockedCallLlm).not.toBe(originalCallLlm);
    expect(realLlm.callLlm).toBe(mockedCallLlm);
  });
});

describe('executeRequest per-request timeout', () => {
  test('every request gets a timeout signal even without a caller signal', async () => {
    const timeouts: number[] = [];
    const fired = new AbortController();
    AbortSignal.timeout = ((ms: number) => {
      timeouts.push(ms);
      return fired.signal;
    }) as typeof AbortSignal.timeout;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', signal: init?.signal });
      // Simulate a stalled connection that only ends when the signal fires
      // (with a fallback so a missing timeout fails instead of hanging).
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
        setTimeout(() => fired.abort(new Error('per-request timeout')), 5);
        setTimeout(() => reject(new Error('stalled: request had no timeout')), 200);
      });
    }) as typeof fetch;

    await expect(api.get('/prices/', { ticker: 'AAPL' })).rejects.toThrow(/per-request timeout/);
    expect(timeouts).toEqual([REQUEST_TIMEOUT_MS]);
    expect(calls.length).toBe(1);
    expect(calls[0].signal?.aborted).toBe(true);
  });
});

describe('read_filings metadata fetch honours the run signal', () => {
  test('aborting during the first request stops all metadata requests', async () => {
    llmStub = async () => ({ response: { ticker: 'AAPL', filing_types: ['10-K'], limit: 3 } });
    const controller = new AbortController();
    let n = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', signal: init?.signal });
      controller.abort(new Error('user cancelled'));
      await new Promise((r) => setTimeout(r, 5));
      init?.signal?.throwIfAborted();
      return json({ filings: [{}], next_page_url: `https://api.financialdatasets.ai/filings/?cursor=${++n}` });
    }) as typeof fetch;

    const tool = createReadFilings('gpt-5.5');
    const parsed = JSON.parse(await tool.invoke({ query: 'AAPL 10-K risks' }, { signal: controller.signal })) as {
      data: { error?: string };
    };
    await new Promise((r) => setTimeout(r, 30));

    expect(parsed.data.error).toBe('Failed to fetch filings metadata');
    // Only the two parallel first requests (filings + item types) ever start.
    expect(calls.length).toBeLessThanOrEqual(2);
    expect(calls.every((c) => c.signal?.aborted)).toBe(true);
  });
});

describe('read_filings metadata fetch cancels the sibling branch', () => {
  test('a failing filings request aborts the still-running item-types pagination', async () => {
    llmStub = async () => ({ response: { ticker: 'AAPL', filing_types: ['10-K'], limit: 3 } });
    let n = 0;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', signal: init?.signal });
      if (!String(url).includes('/filings/items/types/')) {
        return new Response('boom', { status: 500, statusText: 'Internal Server Error' });
      }
      await new Promise((r) => setTimeout(r, 5));
      init?.signal?.throwIfAborted();
      return json({ '10-K': [], next_page_url: `https://api.financialdatasets.ai/filings/items/types/?cursor=${++n}` });
    }) as typeof fetch;

    const tool = createReadFilings('gpt-5.5');
    const parsed = JSON.parse(await tool.invoke({ query: 'AAPL 10-K risks' })) as { data: { error?: string } };
    const itemCalls = () => calls.filter((c) => c.url.includes('/filings/items/types/'));
    const countAtReturn = itemCalls().length;
    await new Promise((r) => setTimeout(r, 50));

    expect(parsed.data.error).toBe('Failed to fetch filings metadata');
    expect(itemCalls().length).toBe(countAtReturn);
    expect(itemCalls().every((c) => c.signal?.aborted)).toBe(true);
  });
});

describe('stock_screener honours the run signal', () => {
  test('an already-aborted run makes no screener requests', async () => {
    llmStub = async () => {
      throw new Error('LLM must not be reached on an aborted run');
    };
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', signal: init?.signal });
      return json({});
    }) as typeof fetch;
    const controller = new AbortController();
    controller.abort();

    const tool = createScreenStocks('gpt-5.5');
    const parsed = JSON.parse(await tool.invoke({ query: 'low P/E' }, { signal: controller.signal })) as {
      data: { error?: string };
    };

    expect(parsed.data.error).toBe('Failed to fetch screener metrics');
    expect(calls.length).toBe(0);
  });

  test('aborting mid-POST cancels the screener request', async () => {
    llmStub = async () => ({ response: { filters: [{ field: 'pe_ratio', operator: 'lt', value: 15 }], currency: 'USD', limit: 5 } });
    const controller = new AbortController();
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url: String(url), method, signal: init?.signal });
      if (method === 'POST') {
        controller.abort(new Error('user cancelled'));
        init?.signal?.throwIfAborted();
      }
      return json({ metrics: [] });
    }) as typeof fetch;

    const tool = createScreenStocks('gpt-5.5');
    const parsed = JSON.parse(await tool.invoke({ query: 'low P/E' }, { signal: controller.signal })) as {
      data: { error?: string };
    };

    expect(parsed.data.error).toBe('Screener request failed');
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.signal?.aborted).toBe(true);
  });
});
