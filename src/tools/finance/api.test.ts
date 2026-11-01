import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCache } from '../../utils/cache.js';
import { api, MAX_PAGES, MAX_AGGREGATE_CHARS } from './api.js';
import { withTimeout } from './utils.js';

// ---------------------------------------------------------------------------
// Cursor pagination: api.get must follow next_page_url until absent and
// return one merged document, so every tool and the cache always see the
// complete result set.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let requestedUrls: string[] = [];
let responses: Record<string, unknown>[] = [];

function jsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  requestedUrls = [];
  responses = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    requestedUrls.push(String(url));
    const body = responses.shift();
    if (!body) {
      throw new Error('test received more requests than stubbed responses');
    }
    return jsonResponse(body);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('api.get pagination', () => {
  test('follows next_page_url to the end and concatenates record arrays', async () => {
    responses = [
      { prices: [{ time: '2024-01-01' }, { time: '2024-01-02' }], next_page_url: 'https://api.financialdatasets.ai/prices/?cursor=page2' },
      { prices: [{ time: '2024-01-03' }], next_page_url: 'https://api.financialdatasets.ai/prices/?cursor=page3' },
      { prices: [{ time: '2024-01-04' }] },
    ];

    const { data } = await api.get('/prices/', { ticker: 'AAPL' });

    expect((data.prices as unknown[]).length).toBe(4);
    // Pages 2+ request the returned URL verbatim — never re-derived from params.
    expect(requestedUrls[1]).toBe('https://api.financialdatasets.ai/prices/?cursor=page2');
    expect(requestedUrls[2]).toBe('https://api.financialdatasets.ai/prices/?cursor=page3');
  });

  test('strips next_page_url from the merged document', async () => {
    responses = [
      { prices: [{ time: '2024-01-01' }], next_page_url: 'https://api.financialdatasets.ai/prices/?cursor=page2' },
      { prices: [{ time: '2024-01-02' }] },
    ];

    const { data } = await api.get('/prices/', { ticker: 'AAPL' });

    expect('next_page_url' in data).toBe(false);
  });

  test('merges the nested /financials/ envelope arrays in lockstep', async () => {
    responses = [
      {
        financials: {
          income_statements: [{ report_period: '2024-03-31' }],
          balance_sheets: [{ report_period: '2024-03-31' }],
          cash_flow_statements: [{ report_period: '2024-03-31' }],
        },
        next_page_url: 'https://api.financialdatasets.ai/financials/?cursor=page2',
      },
      {
        financials: {
          income_statements: [{ report_period: '2023-12-31' }],
          balance_sheets: [{ report_period: '2023-12-31' }],
          cash_flow_statements: [{ report_period: '2023-12-31' }],
        },
      },
    ];

    const { data } = await api.get('/financials/', { ticker: 'AAPL', limit: 20 });

    const financials = data.financials as Record<string, unknown[]>;
    expect(financials.income_statements.length).toBe(2);
    expect(financials.balance_sheets.length).toBe(2);
    expect(financials.cash_flow_statements.length).toBe(2);
  });

  test('a single-page response makes exactly one request', async () => {
    responses = [{ snapshot: { price: 123.45 } }];

    const { data } = await api.get('/prices/snapshot/', { ticker: 'AAPL' });

    expect(requestedUrls.length).toBe(1);
    expect((data.snapshot as Record<string, unknown>).price).toBe(123.45);
  });
});

// ---------------------------------------------------------------------------
// Pagination/redirect hardening: the API key must never leave the API origin,
// pagination must terminate, and cancellation must stop further requests.
// ---------------------------------------------------------------------------

describe('api.get pagination hardening', () => {
  type Call = { url: string; apiKey: string | null; signal?: AbortSignal | null };
  let calls: Call[];
  let handler: (url: string) => Response;
  const originalDataDir = process.env.DEXTER_DATA_DIR;

  beforeEach(() => {
    calls = [];
    process.env.DEXTER_DATA_DIR = mkdtempSync(join(tmpdir(), 'dexter-api-test-'));
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), apiKey: headers.get('x-api-key'), signal: init?.signal });
      return handler(String(url));
    }) as typeof fetch;
  });

  afterEach(() => {
    rmSync(process.env.DEXTER_DATA_DIR!, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DEXTER_DATA_DIR;
    else process.env.DEXTER_DATA_DIR = originalDataDir;
  });

  test.each([
    'http://api.financialdatasets.ai/prices/?cursor=2',
    'http://127.0.0.1:8080/steal',
    'https://attacker.example/prices/?cursor=2',
    'https://api.financialdatasets.ai.attacker.example/prices/',
    'https://api.financialdatasets.ai:8443/prices/',
  ])('refuses off-origin next_page_url %s without sending the key', async (next) => {
    handler = () => jsonResponse({ prices: [{ time: '1' }], next_page_url: next });

    await expect(api.get('/prices/', { ticker: 'AAPL' })).rejects.toThrow(/refused/);
    expect(calls.length).toBe(1);
    expect(calls.every((c) => new URL(c.url).origin === 'https://api.financialdatasets.ai')).toBe(true);
  });

  test('refuses a redirect that leaves the API origin', async () => {
    handler = () => new Response(null, { status: 302, headers: { location: 'https://attacker.example/x' } });

    await expect(api.get('/prices/', { ticker: 'AAPL' })).rejects.toThrow(/refused/);
    expect(calls.length).toBe(1);
  });

  test('follows a same-origin redirect', async () => {
    handler = (url) =>
      url.includes('/prices/snapshot/?')
        ? new Response(null, { status: 301, headers: { location: '/prices/snapshot/v2' } })
        : jsonResponse({ snapshot: { price: 1 } });

    const { data } = await api.get('/prices/snapshot/', { ticker: 'AAPL' });
    expect(calls.map((c) => c.url)[1]).toBe('https://api.financialdatasets.ai/prices/snapshot/v2');
    expect((data.snapshot as Record<string, unknown>).price).toBe(1);
  });

  test('stops on a repeated cursor, marks the result truncated and skips the cache', async () => {
    const loop = 'https://api.financialdatasets.ai/prices/?cursor=loop';
    handler = () => jsonResponse({ prices: [{ time: 'x' }], next_page_url: loop });

    const { data, warnings } = await api.get('/prices/', { ticker: 'AAPL' }, { cacheable: true });
    expect(calls.length).toBe(2);
    expect(data.truncated).toBe(true);
    expect(warnings?.[0]).toMatch(/INCOMPLETE DATA/);
    expect(readCache('/prices/', { ticker: 'AAPL' })).toBeNull();
  });

  test(`stops after ${MAX_PAGES} pages`, async () => {
    let n = 0;
    handler = () => jsonResponse({ prices: [{}], next_page_url: `https://api.financialdatasets.ai/prices/?cursor=${++n}` });

    const { data } = await api.get('/prices/', { ticker: 'AAPL' });
    expect(calls.length).toBe(MAX_PAGES);
    expect((data.prices as unknown[]).length).toBe(MAX_PAGES);
    expect(data.truncated).toBe(true);
  });

  test('stops once the aggregate response size reaches the cap, with a warning', async () => {
    let n = 0;
    // ~1/3 of the cap per page: the 3rd page crosses it, so no 4th is fetched.
    const blob = 'x'.repeat(Math.ceil(MAX_AGGREGATE_CHARS / 3));
    handler = () => jsonResponse({ prices: [{ blob }], next_page_url: `https://api.financialdatasets.ai/prices/?cursor=${++n}` });

    const { data, warnings } = await api.get('/prices/', { ticker: 'AAPL' }, { cacheable: true });
    expect(calls.length).toBe(3);
    expect(data.truncated).toBe(true);
    expect(warnings?.[0]).toMatch(/INCOMPLETE DATA/);
    expect(readCache('/prices/', { ticker: 'AAPL' })).toBeNull();
  });

  // Streams `chunks` JSON chunks of `chunkSize` chars, counting how many were pulled.
  function streamingResponse(prefix: string, chunkSize: number, chunks: number, pulled: { n: number }): Response {
    const enc = new TextEncoder();
    let i = 0;
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i === 0) controller.enqueue(enc.encode(prefix));
        if (i < chunks) {
          pulled.n++;
          controller.enqueue(enc.encode('x'.repeat(chunkSize)));
          i++;
        } else {
          controller.enqueue(enc.encode('"}]}'));
          controller.close();
        }
      },
    }), { status: 200 });
  }

  test('a single oversized first page is cut off mid-stream, truncated and not cached', async () => {
    const pulled = { n: 0 };
    const chunkSize = 1_000_000;
    const chunks = Math.ceil(MAX_AGGREGATE_CHARS / chunkSize) * 4;
    handler = () => streamingResponse('{"prices":[{"blob":"', chunkSize, chunks, pulled);

    const { data, warnings } = await api.get('/prices/', { ticker: 'AAPL' }, { cacheable: true });
    expect(calls.length).toBe(1);
    expect(pulled.n).toBeLessThan(chunks / 2);
    expect(data.truncated).toBe(true);
    expect(data.prices).toBeUndefined();
    expect(warnings?.[0]).toMatch(/INCOMPLETE DATA/);
    expect(readCache('/prices/', { ticker: 'AAPL' })).toBeNull();
  });

  test('a follow-up page larger than the remaining budget is dropped before merging', async () => {
    const pulled = { n: 0 };
    const chunkSize = 1_000_000;
    const chunks = Math.ceil(MAX_AGGREGATE_CHARS / chunkSize) * 4;
    handler = (url) => url.includes('cursor=2')
      ? streamingResponse('{"prices":[{"blob":"', chunkSize, chunks, pulled)
      : jsonResponse({ prices: [{ time: '1' }], next_page_url: 'https://api.financialdatasets.ai/prices/?cursor=2' });

    const { data, warnings } = await api.get('/prices/', { ticker: 'AAPL' }, { cacheable: true });
    expect(calls.length).toBe(2);
    expect(pulled.n).toBeLessThan(chunks / 2);
    expect(data.prices).toEqual([{ time: '1' }]);
    expect(data.truncated).toBe(true);
    expect(warnings?.[0]).toMatch(/INCOMPLETE DATA/);
    expect(readCache('/prices/', { ticker: 'AAPL' })).toBeNull();
  });

  test('a complete cacheable result is still cached', async () => {
    handler = () => jsonResponse({ prices: [{ time: '1' }] });
    await api.get('/prices/', { ticker: 'MSFT' }, { cacheable: true });
    expect(readCache('/prices/', { ticker: 'MSFT' })).not.toBeNull();
  });

  test('timeout aborts the in-flight request and stops further pages', async () => {
    let n = 0;
    handler = () => jsonResponse({ prices: [{}], next_page_url: `https://api.financialdatasets.ai/prices/?cursor=${++n}` });
    // Each page takes 20ms, so a 50ms timeout lands mid-pagination.
    const slowFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      await new Promise((r) => setTimeout(r, 20));
      init?.signal?.throwIfAborted();
      return slowFetch(url, init);
    }) as typeof fetch;

    await expect(withTimeout(() => api.get('/prices/', { ticker: 'AAPL' }), 50, 'prices')).rejects.toThrow(/timed out/);
    const countAtTimeout = calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(calls.length).toBe(countAtTimeout);
    expect(countAtTimeout).toBeLessThan(5);
  });

  test('an already-aborted parent signal prevents any request', async () => {
    handler = () => jsonResponse({ prices: [] });
    const controller = new AbortController();
    controller.abort();

    await expect(
      withTimeout(() => api.get('/prices/', { ticker: 'AAPL' }), 1000, 'prices', controller.signal),
    ).rejects.toThrow();
    expect(calls.length).toBe(0);
  });
});
