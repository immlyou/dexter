import { DynamicStructuredTool } from '@langchain/core/tools';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { z } from 'zod';
import { formatToolResult } from '../types.js';
import { assertPublicHttpUrl, type LookupFn } from './url-guard.js';

type RefMap = Map<string, { role: string; name?: string; nth?: number }>;

// Type for Playwright's _snapshotForAI result
interface SnapshotForAIResult {
  full?: string;
}

// Extended Page type with _snapshotForAI method
interface PageWithSnapshotForAI extends Page {
  _snapshotForAI?: (opts: { timeout: number; track: string }) => Promise<SnapshotForAIResult>;
}

// One Chromium process is shared; all per-query state lives in an isolated BrowserContext.
let sharedBrowser: Promise<Browser> | null = null;

function getSharedBrowser(): Promise<Browser> {
  if (!sharedBrowser) {
    const launching = chromium.launch({ headless: process.env.DEXTER_HEADFUL !== '1' });
    sharedBrowser = launching;
    launching.then(
      (b) => b.on('disconnected', () => { if (sharedBrowser === launching) sharedBrowser = null; }),
      () => { if (sharedBrowser === launching) sharedBrowser = null; },
    );
  }
  return sharedBrowser;
}

/**
 * Browser state for a single agent run: its own context (cookies, storage, tabs),
 * current page and snapshot refs. Routed HTTP requests are checked against the URL guard.
 * Chromium resolves DNS independently, so this is not a DNS-rebinding boundary.
 */
export class BrowserSession {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  refs: RefMap = new Map();

  constructor(private readonly lookup?: LookupFn) {}

  async ensurePage(): Promise<Page> {
    if (!this.context) {
      const browser = await getSharedBrowser();
      const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
      // WebSocket handshakes bypass HTTP routing. Never connect them to a server.
      await context.routeWebSocket('**/*', (socket) => socket.close());
      // HTTP routing covers subresources and link clicks, but not each redirect hop.
      await context.route('**/*', async (route) => {
        const reqUrl = route.request().url();
        if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:')) return route.continue();
        try {
          await assertPublicHttpUrl(reqUrl, this.lookup);
          await route.continue();
        } catch {
          await route.abort('blockedbyclient');
        }
      });
      this.context = context;
    }
    if (!this.page || this.page.isClosed()) {
      this.page = await this.context.newPage();
    }
    return this.page;
  }

  /** Navigate the current page (or a new tab) to a guarded URL. */
  async goto(rawUrl: string, newTab = false): Promise<Page> {
    const url = await assertPublicHttpUrl(rawUrl, this.lookup);
    const current = await this.ensurePage();
    const target = newTab ? await current.context().newPage() : current;
    await target.goto(url.toString(), { timeout: 30000, waitUntil: 'networkidle' });
    this.page = target;
    return target;
  }

  /** Close this session's context; the session can be reused afterwards. */
  async close(): Promise<void> {
    const context = this.context;
    this.context = null;
    this.page = null;
    this.refs.clear();
    if (context) await context.close().catch(() => {});
  }
}

/**
 * Parse refs from the AI snapshot format.
 * Extracts [ref=eN] patterns and builds a ref map.
 */
function parseRefsFromSnapshot(snapshot: string): RefMap {
  const refs: RefMap = new Map();
  const lines = snapshot.split('\n');
  
  for (const line of lines) {
    // Match patterns like: - button "Click me" [ref=e12]
    const refMatch = line.match(/\[ref=(e\d+)\]/);
    if (!refMatch) continue;
    
    const ref = refMatch[1];
    
    // Extract role (first word after "- ")
    const roleMatch = line.match(/^\s*-\s*(\w+)/);
    const role = roleMatch?.[1] ?? 'generic';
    
    // Extract name (text in quotes)
    const nameMatch = line.match(/"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : undefined;
    
    // Extract nth if present
    const nthMatch = line.match(/\[nth=(\d+)\]/);
    const nth = nthMatch ? parseInt(nthMatch[1]!, 10) : undefined;
    
    refs.set(ref!, { role, name, nth });
  }
  
  return refs;
}

/**
 * Resolve a ref to a Playwright locator using stored ref data.
 */
function resolveRefToLocator(p: Page, refs: RefMap, ref: string): ReturnType<Page['locator']> {
  const refData = refs.get(ref);
  
  if (!refData) {
    // Fallback to aria-ref selector if ref not in map
    return p.locator(`aria-ref=${ref}`);
  }
  
  // Use getByRole with the stored role and name for reliable resolution
  const options: { name?: string | RegExp; exact?: boolean } = {};
  if (refData.name) {
    options.name = refData.name;
    options.exact = true;
  }
  
  let locator = p.getByRole(refData.role as Parameters<Page['getByRole']>[0], options);
  
  // Handle nth occurrence if specified
  if (typeof refData.nth === 'number' && refData.nth > 0) {
    locator = locator.nth(refData.nth);
  }
  
  return locator;
}

/**
 * Take an AI-optimized snapshot using Playwright's _snapshotForAI method.
 * Falls back to ariaSnapshot if _snapshotForAI is not available.
 */
async function takeSnapshot(p: Page, maxChars?: number): Promise<{ snapshot: string; truncated: boolean; refs: RefMap }> {
  const pageWithSnapshot = p as PageWithSnapshotForAI;
  
  let snapshot: string;
  
  if (pageWithSnapshot._snapshotForAI) {
    // Use the AI-optimized snapshot method
    const result = await pageWithSnapshot._snapshotForAI({ timeout: 10000, track: 'response' });
    snapshot = String(result?.full ?? '');
  } else {
    // Fallback to standard ariaSnapshot
    snapshot = await p.locator(':root').ariaSnapshot();
  }
  
  // Parse refs for later action resolution
  const refs = parseRefsFromSnapshot(snapshot);
  
  // Truncate if needed
  let truncated = false;
  const limit = maxChars ?? 50000;
  if (snapshot.length > limit) {
    snapshot = `${snapshot.slice(0, limit)}\n\n[...TRUNCATED - page too large, use read action for full text]`;
    truncated = true;
  }
  
  return { snapshot, truncated, refs };
}

// Schema for the act action's request object
const actRequestSchema = z.object({
  kind: z.enum(['click', 'type', 'press', 'hover', 'scroll', 'wait']).describe('The type of interaction'),
  ref: z.string().optional().describe('Element ref from snapshot (e.g., e12)'),
  text: z.string().optional().describe('Text for type action'),
  key: z.string().optional().describe('Key for press action (e.g., Enter, Tab)'),
  direction: z.enum(['up', 'down']).optional().describe('Scroll direction'),
  timeMs: z.number().optional().describe('Wait time in milliseconds'),
});

/**
 * Create a browser tool bound to its own BrowserSession. Call `dispose` when the run ends.
 */
export function createBrowserTool(options: { lookup?: LookupFn } = {}): { tool: DynamicStructuredTool; dispose: () => Promise<void> } {
  const session = new BrowserSession(options.lookup);
  const tool = new DynamicStructuredTool({
    name: 'browser',
    description: 'Navigate websites, read content, and interact with pages. Use for accessing company websites, earnings reports, and dynamic content.',
    schema: z.object({
      action: z.enum(['navigate', 'open', 'snapshot', 'act', 'read', 'close']).describe('The browser action to perform'),
      url: z.string().optional().describe('URL for navigate action'),
      maxChars: z.number().optional().describe('Max characters for snapshot (default 50000)'),
      request: actRequestSchema.optional().describe('Request object for act action'),
    }),
    func: async ({ action, url, maxChars, request }) => {
      try {
        switch (action) {
          case 'navigate': {
            if (!url) {
              return formatToolResult({ error: 'url is required for navigate action' });
            }
            const p = await session.goto(url);
            return formatToolResult({
              ok: true,
              url: p.url(),
              title: await p.title(),
              hint: 'Page loaded. Call snapshot to see page structure and find elements to interact with.',
            });
          }

          case 'open': {
            if (!url) {
              return formatToolResult({ error: 'url is required for open action' });
            }
            // Opens a new tab in this session's context and switches to it
            const newPage = await session.goto(url, true);
            return formatToolResult({
              ok: true,
              url: newPage.url(),
              title: await newPage.title(),
              hint: 'New tab opened. Call snapshot to see page structure and find elements to interact with.',
            });
          }

          case 'snapshot': {
            const p = await session.ensurePage();
            // Wait for any dynamic content to settle
            await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          
            const { snapshot, truncated, refs } = await takeSnapshot(p, maxChars);
            session.refs = refs;
          
            return formatToolResult({
              url: p.url(),
              title: await p.title(),
              snapshot,
              truncated,
              refCount: refs.size,
              refs: Object.fromEntries(refs),
              hint: 'Use act with kind="click" and ref="eN" to click elements. Or navigate directly to a /url visible in the snapshot.',
            });
          }

          case 'act': {
            if (!request) {
              return formatToolResult({ error: 'request is required for act action' });
            }
          
            const p = await session.ensurePage();
            const { kind, ref, text, key, direction, timeMs } = request;
          
            switch (kind) {
              case 'click': {
                if (!ref) {
                  return formatToolResult({ error: 'ref is required for click' });
                }
                const locator = resolveRefToLocator(p, session.refs, ref);
                await locator.click({ timeout: 8000 });
                // Wait for navigation/content to load
                await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                return formatToolResult({ 
                  ok: true, 
                  clicked: ref,
                  hint: 'Click successful. Call snapshot to see the updated page.',
                });
              }
            
              case 'type': {
                if (!ref) {
                  return formatToolResult({ error: 'ref is required for type' });
                }
                if (!text) {
                  return formatToolResult({ error: 'text is required for type' });
                }
                const locator = resolveRefToLocator(p, session.refs, ref);
                await locator.fill(text, { timeout: 8000 });
                return formatToolResult({ ok: true, ref, typed: text });
              }
            
              case 'press': {
                if (!key) {
                  return formatToolResult({ error: 'key is required for press' });
                }
                await p.keyboard.press(key);
                await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
                return formatToolResult({ ok: true, pressed: key });
              }
            
              case 'hover': {
                if (!ref) {
                  return formatToolResult({ error: 'ref is required for hover' });
                }
                const locator = resolveRefToLocator(p, session.refs, ref);
                await locator.hover({ timeout: 8000 });
                return formatToolResult({ ok: true, hovered: ref });
              }
            
              case 'scroll': {
                const scrollDirection = direction ?? 'down';
                const amount = scrollDirection === 'down' ? 500 : -500;
                await p.mouse.wheel(0, amount);
                await p.waitForTimeout(500);
                return formatToolResult({ ok: true, scrolled: scrollDirection });
              }
            
              case 'wait': {
                const waitTime = Math.min(timeMs ?? 2000, 10000);
                await p.waitForTimeout(waitTime);
                return formatToolResult({ ok: true, waited: waitTime });
              }
            
              default:
                return formatToolResult({ error: `Unknown act kind: ${kind}` });
            }
          }

          case 'read': {
            const p = await session.ensurePage();
            // Wait for content to be fully loaded
            await p.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          
            // Extract visible text from main content area, falling back to body
            const content = await p.evaluate(() => {
              const main = document.querySelector('main, article, [role="main"], .content, #content') as HTMLElement | null;
              return (main || document.body).innerText;
            });
            return formatToolResult({
              url: p.url(),
              title: await p.title(),
              content,
            });
          }

          case 'close': {
            await session.close();
            return formatToolResult({ ok: true, message: 'Browser closed' });
          }

          default:
            return formatToolResult({ error: `Unknown action: ${action}` });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return formatToolResult({ error: message });
      }
    },
  });

  return { tool, dispose: () => session.close() };
}
