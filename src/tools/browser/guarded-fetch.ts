import type { APIResponse, Route } from 'playwright';
import { assertPublicHttpUrl, UrlNotAllowedError, type LookupFn } from './url-guard.js';

export const MAX_REDIRECTS = 10;

// Credentials of the original request must not follow a redirect to another host.
const DROPPED_ON_REDIRECT = new Set(['cookie', 'authorization', 'proxy-authorization']);
const DROPPED_ON_GET = new Set(['content-type', 'content-length']);

/**
 * Fetch a routed request in Node, following redirects here so every hop passes the URL
 * guard. Chromium follows redirects (even fulfilled ones) without routing the next hop,
 * so the browser must only ever receive the final, non-redirect response.
 * Hosts are resolved again for the actual connection, so DNS rebinding remains possible.
 */
export async function fetchGuarded(route: Pick<Route, 'request' | 'fetch'>, lookup?: LookupFn): Promise<APIResponse> {
  const request = route.request();
  let url = request.url();
  let method = request.method();
  let headers: Record<string, string> | undefined;
  let postData: Buffer | undefined = request.postDataBuffer() ?? undefined;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpUrl(url, lookup);
    const response = await route.fetch({ url, method, headers, postData, maxRedirects: 0 });
    const location = response.headers()['location'];
    const status = response.status();
    if (status < 300 || status > 399 || !location) return response;
    await response.dispose();

    const next = new URL(location, url);
    const toGet = status === 303 || ((status === 301 || status === 302) && method === 'POST');
    if (toGet) {
      method = 'GET';
      postData = undefined;
    }
    const sameOrigin = next.origin === new URL(url).origin;
    headers = Object.fromEntries(Object.entries(headers ?? request.headers()).filter(([name]) => {
      const lower = name.toLowerCase();
      return (sameOrigin || !DROPPED_ON_REDIRECT.has(lower)) && !(toGet && DROPPED_ON_GET.has(lower));
    }));
    url = next.toString();
  }
  throw new UrlNotAllowedError('Too many redirects');
}
