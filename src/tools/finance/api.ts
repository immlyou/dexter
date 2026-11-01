import { AsyncLocalStorage } from 'node:async_hooks';
import { readCache, writeCache, describeRequest } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';

const BASE_URL = 'https://api.financialdatasets.ai';
const API_ORIGIN = new URL(BASE_URL).origin;

// A year of daily prices is ~25 pages; this only stops runaway or cyclic pagination.
export const MAX_PAGES = 100;
// Per-request (per hop) budget, so a stalled connection can't hang a call
// that has no caller-supplied abort signal.
export const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

// Abort signal for the current tool invocation. Carried implicitly so the ~30
// sub-tool call sites don't each need to thread a signal through to api.get.
const requestSignal = new AsyncLocalStorage<AbortSignal>();

/** Run `fn` so every API request it makes is cancelled when `signal` aborts. */
export function runWithAbortSignal<T>(signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
  return requestSignal.run(signal, fn);
}

/** Only the configured HTTPS API origin ever receives the API key. */
function assertApiUrl(raw: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`[Financial Datasets API] invalid URL for ${label}`);
  }
  if (url.protocol !== 'https:' || url.origin !== API_ORIGIN) {
    logger.error(`[Financial Datasets API] refused off-origin URL: ${label}`);
    throw new Error(`[Financial Datasets API] refused to follow URL outside ${API_ORIGIN}`);
  }
  return url.toString();
}

export interface ApiResponse {
  data: Record<string, unknown>;
  url: string;
  /** Set when the result is known to be incomplete (e.g. pagination stopped early). */
  warnings?: string[];
}

/** Warning attached to every tool result built from a truncated api.get response. */
export function truncationWarning(label: string): string {
  return `INCOMPLETE DATA: pagination for ${label} stopped early (page limit reached); `
    + 'later records are missing. Do not treat this result as complete — narrow the query (e.g. a shorter date range or lower limit) if completeness matters.';
}

/**
 * Remove redundant fields from API payloads before they are returned to the LLM.
 * This reduces token usage while preserving the financial metrics needed for analysis.
 */
export function stripFieldsDeep(value: unknown, fields: readonly string[]): unknown {
  const fieldsToStrip = new Set(fields);

  function walk(node: unknown): unknown {
    if (Array.isArray(node)) {
      return node.map(walk);
    }

    if (!node || typeof node !== 'object') {
      return node;
    }

    const record = node as Record<string, unknown>;
    const cleaned: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(record)) {
      if (fieldsToStrip.has(key)) {
        continue;
      }
      cleaned[key] = walk(child);
    }

    return cleaned;
  }

  return walk(value);
}

function getApiKey(): string {
  return process.env.FINANCIAL_DATASETS_API_KEY || '';
}

/**
 * Merge a follow-up page into the accumulated response. The API caps list
 * responses at a fixed page size, so record arrays are concatenated —
 * recursively, because /financials/ nests its three statement arrays one
 * level down. Scalars keep the first page's value; next_page_url is
 * excluded so it never reaches the cache, the formatters, or the LLM.
 */
function mergePage(accumulated: Record<string, unknown>, page: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(page)) {
    if (key === 'next_page_url') {
      continue;
    }
    const existing = accumulated[key];
    if (Array.isArray(existing) && Array.isArray(value)) {
      existing.push(...value);
    } else if (
      existing && value &&
      typeof existing === 'object' && typeof value === 'object' &&
      !Array.isArray(existing) && !Array.isArray(value)
    ) {
      mergePage(existing as Record<string, unknown>, value as Record<string, unknown>);
    }
  }
}

/**
 * Shared request execution: handles API key, error handling, logging, and response parsing.
 */
async function executeRequest(
  url: string,
  label: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const apiKey = getApiKey();

  if (!apiKey) {
    logger.warn(`[Financial Datasets API] call without key: ${label}`);
  }

  const parentSignal = requestSignal.getStore();
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  let target = assertApiUrl(url, label);
  try {
    // Redirects are followed manually so the API key is never forwarded off-origin.
    for (let hop = 0; ; hop++) {
      signal?.throwIfAborted();
      response = await fetch(target, {
        ...init,
        redirect: 'manual',
        signal,
        headers: {
          'x-api-key': apiKey,
          ...init.headers,
        },
      });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) break;
      await response.body?.cancel();
      if (hop >= MAX_REDIRECTS) throw new Error('too many redirects');
      target = assertApiUrl(new URL(location, target).toString(), label);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Financial Datasets API] network error: ${label} — ${message}`);
    throw new Error(`[Financial Datasets API] request failed for ${label}: ${message}`);
  }

  if (!response.ok) {
    const detail = `${response.status} ${response.statusText}`;
    logger.error(`[Financial Datasets API] error: ${label} — ${detail}`);
    throw new Error(`[Financial Datasets API] request failed: ${detail}`);
  }

  const data = await response.json().catch(() => {
    const detail = `invalid JSON (${response.status} ${response.statusText})`;
    logger.error(`[Financial Datasets API] parse error: ${label} — ${detail}`);
    throw new Error(`[Financial Datasets API] request failed: ${detail}`);
  });

  return data as Record<string, unknown>;
}

export const api = {
  async get(
    endpoint: string,
    params: Record<string, string | number | string[] | undefined>,
    options?: { cacheable?: boolean; ttlMs?: number },
  ): Promise<ApiResponse> {
    const label = describeRequest(endpoint, params);

    // Check local cache first — avoids redundant network calls for immutable data
    if (options?.cacheable) {
      const cached = readCache(endpoint, params, options.ttlMs);
      if (cached) {
        return cached;
      }
    }

    const url = new URL(`${BASE_URL}${endpoint}`);

    // Add params to URL, handling arrays
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((v) => url.searchParams.append(key, v));
        } else {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const data = await executeRequest(url.toString(), label, {});

    // Reassemble the full result: follow next_page_url (absolute and
    // self-contained — request it verbatim) until the last page. This runs
    // before the cache write so caches only ever hold complete results.
    // executeRequest rejects next URLs outside the API origin.
    const seen = new Set<string>([url.toString()]);
    let complete = true;
    let nextPageUrl = data.next_page_url;
    while (typeof nextPageUrl === 'string' && nextPageUrl) {
      if (seen.has(nextPageUrl) || seen.size >= MAX_PAGES) {
        logger.warn(`[Financial Datasets API] pagination stopped after ${seen.size} pages: ${label}`);
        complete = false;
        break;
      }
      seen.add(nextPageUrl);
      requestSignal.getStore()?.throwIfAborted();
      const page = await executeRequest(nextPageUrl, label, {});
      mergePage(data, page);
      nextPageUrl = page.next_page_url;
    }
    delete data.next_page_url;
    if (!complete) {
      data.truncated = true;
    }

    // Persist for future requests when the caller marked the response as cacheable
    if (options?.cacheable && complete) {
      writeCache(endpoint, params, data, url.toString());
    }

    return complete
      ? { data, url: url.toString() }
      : { data, url: url.toString(), warnings: [truncationWarning(label)] };
  },

  async post(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<ApiResponse> {
    const label = `POST ${endpoint}`;
    const url = `${BASE_URL}${endpoint}`;

    const data = await executeRequest(url, label, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    return { data, url };
  },
};

/** @deprecated Use `api.get` instead */
export const callApi = api.get;
