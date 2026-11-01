import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { getStockPrices } from './stock-price.js';
import { getCryptoPrices } from './crypto.js';
import { getIncomeStatements, getAllFinancialStatements } from './fundamentals.js';
import { getFilings } from './filings.js';
import { getCompanyNews } from './news.js';
import { getInsiderNames } from './insider_trades.js';
import { getInstitutionalInvestors } from './institutional_holdings.js';
import { getHistoricalKeyRatios } from './key-ratios.js';

// ---------------------------------------------------------------------------
// When api.get stops paginating early, the tool result handed to the LLM must
// say so explicitly — consumers that return only one array of the merged
// document would otherwise make a partial history look complete.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
const originalDataDir = process.env.DEXTER_DATA_DIR;
let paginate = true;

beforeEach(() => {
  process.env.DEXTER_DATA_DIR = mkdtempSync(join(tmpdir(), 'dexter-trunc-test-'));
  let n = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    // Every array key any of the tools below reads, so each sees records.
    const body: Record<string, unknown> = {
      prices: [{ n }], income_statements: [{ n }], financials: { income_statements: [{ n }] },
      filings: [{ n }], news: [{ n }], names: ['A'], investors: [{ cik: '1' }], financial_metrics: [{ n }],
    };
    if (paginate) body.next_page_url = `https://api.financialdatasets.ai${path}?cursor=${++n}`;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(process.env.DEXTER_DATA_DIR!, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DEXTER_DATA_DIR;
  else process.env.DEXTER_DATA_DIR = originalDataDir;
  paginate = true;
});

const cases: Array<[string, StructuredToolInterface, Record<string, unknown>]> = [
  ['get_stock_prices', getStockPrices, { ticker: 'AAPL', interval: 'day', start_date: '2000-01-01', end_date: '2020-01-01' }],
  ['get_crypto_prices', getCryptoPrices, { ticker: 'BTC-USD', interval: 'day', start_date: '2020-01-01', end_date: '2021-01-01' }],
  ['get_income_statements', getIncomeStatements, { ticker: 'AAPL', period: 'quarterly' }],
  ['get_all_financial_statements', getAllFinancialStatements, { ticker: 'AAPL', period: 'quarterly' }],
  ['get_historical_key_ratios', getHistoricalKeyRatios, { ticker: 'AAPL', period: 'quarterly' }],
  ['get_filings', getFilings, { ticker: 'AAPL' }],
  ['get_company_news', getCompanyNews, { ticker: 'AAPL' }],
  ['get_insider_names', getInsiderNames, { ticker: 'AAPL' }],
  ['get_institutional_investors', getInstitutionalInvestors, {}],
];

describe('truncated pagination is surfaced in tool results', () => {
  test.each(cases)('%s carries an incompleteness warning', async (_name, tool, args) => {
    const parsed = JSON.parse(await tool.invoke(args)) as { data: unknown; warnings?: string[] };
    expect(parsed.data).toBeDefined();
    expect(parsed.warnings?.length).toBe(1);
    expect(parsed.warnings![0]).toMatch(/INCOMPLETE DATA/);
  });

  test.each(cases)('%s has no warning when pagination completes', async (_name, tool, args) => {
    paginate = false;
    const parsed = JSON.parse(await tool.invoke(args)) as { warnings?: string[] };
    expect(parsed.warnings).toBeUndefined();
  });
});
