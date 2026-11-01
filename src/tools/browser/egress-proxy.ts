import http from 'node:http';
import net from 'node:net';
import { resolvePublicHost } from './url-guard.js';

/** Returns the addresses to connect to for `host`, or throws if it is not allowed. */
export type ResolveFn = (host: string) => Promise<string[]>;

export interface EgressProxyOptions {
  resolve?: ResolveFn;
  /** Ports CONNECT may tunnel to (default 80 and 443). */
  allowConnectPort?: (port: number) => boolean;
  /** Deadline for each upstream connection attempt. */
  connectTimeoutMs?: number;
  /** Upstream connections with no traffic for this long are closed. */
  idleTimeoutMs?: number;
}

export interface EgressProxy {
  /** Proxy URL for Playwright's `proxy.server` launch option. */
  readonly server: string;
  close(): Promise<void>;
}

// Headers that only concern the browser -> proxy leg
const PROXY_ONLY_HEADERS = ['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive'];
const DEFAULT_CONNECT_PORTS = new Set([80, 443]);

/** Upstream failure, carrying the status to report to the browser. */
class EgressError extends Error {
  constructor(readonly status: 403 | 502) {
    super(`egress ${status}`);
  }
}

function parseAuthority(authority: string): { host: string; port: number } | null {
  const match = authority.match(/^\[([^\]]+)\]:(\d+)$/) ?? authority.match(/^([^:[\]]+):(\d+)$/);
  const port = Number(match?.[2]);
  if (!match || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: match[1]!, port };
}

/** IPv4 first (stable): an AAAA answer on a host without an IPv6 route would otherwise stall each request. */
export function preferIPv4(addresses: string[]): string[] {
  return [...addresses].sort((a, b) => Number(net.isIPv6(a)) - Number(net.isIPv6(b)));
}

function refuse(socket: net.Socket, status: string): void {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * Local forward proxy for the CLI browser. Chromium sends every connection here (including
 * each redirect hop and loopback targets; browser.ts sets `<-loopback>`), and the proxy
 * resolves the host itself, rejects non-public addresses and connects to a checked address.
 * Pinning the connection to that address is what closes the DNS-rebinding window.
 */
export async function startEgressProxy(options: EgressProxyOptions = {}): Promise<EgressProxy> {
  const {
    resolve = (host) => resolvePublicHost(host),
    allowConnectPort = (port) => DEFAULT_CONNECT_PORTS.has(port),
    connectTimeoutMs = 10_000,
    idleTimeoutMs = 120_000,
  } = options;
  // Every live socket and upstream request, so close() can tear them all down
  const live = new Set<{ destroy(): unknown; once(event: 'close', fn: () => void): unknown }>();
  let closed = false;
  const track = (handle: { destroy(): unknown; once(event: 'close', fn: () => void): unknown }) => {
    if (closed) return void handle.destroy();
    live.add(handle);
    handle.once('close', () => live.delete(handle));
  };

  function connectOne(host: string, port: number): Promise<net.Socket> {
    return new Promise((done, fail) => {
      const socket = net.connect({ host, port });
      track(socket);
      const timer = setTimeout(() => socket.destroy(new Error('connect timeout')), connectTimeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        done(socket);
      });
      // After `connect` these are no-ops; callers attach their own handlers
      socket.on('error', (err) => {
        clearTimeout(timer);
        fail(err);
      });
      socket.once('close', () => {
        clearTimeout(timer);
        fail(new Error('closed'));
      });
    });
  }

  /**
   * Resolve and check `host`, then connect to the first reachable checked address (IPv4
   * first). Never re-resolves, so every attempt targets an address that passed the check.
   */
  async function open(host: string, port: number): Promise<{ socket: net.Socket; address: string }> {
    let addresses: string[];
    try {
      addresses = await resolve(host);
    } catch {
      throw new EgressError(403);
    }
    for (const address of preferIPv4(addresses)) {
      if (closed) break;
      try {
        return { socket: await connectOne(address, port), address };
      } catch {
        // try the next address
      }
    }
    throw new EgressError(502);
  }

  const server = http.createServer();
  server.on('connection', track);

  // HTTPS (and anything else tunneled): CONNECT host:port
  server.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    // Bun hands CONNECT a socket distinct from the one seen on `connection`
    track(client);
    client.on('error', () => client.destroy());
    const target = parseAuthority(req.url ?? '');
    if (!target) return refuse(client, '400 Bad Request');
    if (!allowConnectPort(target.port)) return refuse(client, '403 Forbidden');
    open(target.host, target.port).then(
      ({ socket: upstream }) => {
        if (client.destroyed) return void upstream.destroy();
        upstream.on('error', () => upstream.destroy());
        upstream.once('close', () => client.destroy());
        client.once('close', () => upstream.destroy());
        // Socket timeouts count traffic in both directions through the tunnel
        upstream.setTimeout(idleTimeoutMs, () => upstream.destroy());
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      },
      (err) => refuse(client, err instanceof EgressError && err.status === 403 ? '403 Forbidden' : '502 Bad Gateway'),
    );
  });

  // Plain HTTP: absolute-form request URL
  server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
    const reject = (status: number) => {
      if (res.destroyed) return;
      if (!res.headersSent) res.writeHead(status, { connection: 'close', 'content-length': '0' });
      res.once('finish', () => req.socket.end());
      res.end();
    };
    let url: URL;
    try {
      url = new URL(req.url ?? '');
    } catch {
      return reject(400);
    }
    if (url.protocol !== 'http:') return reject(400);
    const port = Number(url.port) || 80;
    open(url.hostname, port).then(
      ({ socket: probe, address }) => {
        // Bun's http.request cannot adopt an existing socket, so the probe only picks a
        // reachable checked address and the request connects to that same address.
        probe.destroy();
        if (res.destroyed) return;
        const headers = { ...req.headers };
        for (const name of PROXY_ONLY_HEADERS) delete headers[name];
        const upstream = http.request({
          host: address,
          port,
          method: req.method,
          path: url.pathname + url.search,
          headers,
          agent: false,
        });
        track(upstream);
        upstream.setTimeout(idleTimeoutMs, () => upstream.destroy(new Error('idle timeout')));
        let responded = false;
        upstream.on('response', (response) => {
          responded = true;
          // One request per connection keeps each browser connection tied to one checked host.
          // Ending the socket explicitly also works around Bun leaving it open after an
          // empty proxied body (e.g. a bare 302).
          res.writeHead(response.statusCode ?? 502, { ...response.headers, connection: 'close' });
          res.once('finish', () => req.socket.end());
          // A truncated upstream body must close the browser connection, not look slow
          const abort = () => res.destroy();
          response.on('error', abort);
          response.on('aborted', abort);
          response.once('close', () => {
            if (!response.complete) abort();
          });
          response.pipe(res);
        });
        // Bun may emit only `close` (no `error`) when a timed-out request is destroyed
        const fail = () => (res.headersSent ? res.destroy() : reject(502));
        upstream.on('error', fail);
        upstream.once('close', () => {
          if (!responded) fail();
        });
        req.on('error', () => upstream.destroy());
        res.once('close', () => upstream.destroy());
        req.pipe(upstream);
      },
      (err) => reject(err instanceof EgressError ? err.status : 502),
    );
  });

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done());
  });
  const { port } = server.address() as net.AddressInfo;

  return {
    server: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done) => {
        closed = true;
        for (const handle of live) handle.destroy();
        server.close(() => done());
      }),
  };
}
