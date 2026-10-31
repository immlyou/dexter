import http from 'node:http';
import net from 'node:net';
import { resolvePublicHost } from './url-guard.js';

/** Returns the addresses to connect to for `host`, or throws if it is not allowed. */
export type ResolveFn = (host: string) => Promise<string[]>;

export interface EgressProxy {
  /** Proxy URL for Playwright's `proxy.server` launch option. */
  readonly server: string;
  close(): Promise<void>;
}

// Headers that only concern the browser -> proxy leg
const PROXY_ONLY_HEADERS = ['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive'];

function parseAuthority(authority: string): { host: string; port: number } | null {
  const match = authority.match(/^\[([^\]]+)\]:(\d+)$/) ?? authority.match(/^([^:[\]]+):(\d+)$/);
  const port = Number(match?.[2]);
  if (!match || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: match[1]!, port };
}

function refuse(socket: net.Socket, status: string): void {
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * Local forward proxy for the CLI browser. Chromium sends every connection here (including
 * each redirect hop and loopback targets; Playwright forces `<-loopback>`), and the proxy
 * resolves the host itself, rejects non-public addresses and connects to the checked address.
 * Pinning the connection to that address is what closes the DNS-rebinding window.
 */
export async function startEgressProxy(resolve: ResolveFn = (host) => resolvePublicHost(host)): Promise<EgressProxy> {
  const sockets = new Set<net.Socket>();
  const server = http.createServer();

  server.on('connection', (socket: net.Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  // HTTPS (and anything else tunneled): CONNECT host:port
  server.on('connect', (req: http.IncomingMessage, client: net.Socket, head: Buffer) => {
    client.on('error', () => client.destroy());
    const target = parseAuthority(req.url ?? '');
    if (!target) return refuse(client, '400 Bad Request');
    resolve(target.host).then(
      ([address]) => {
        const upstream = net.connect({ host: address, port: target.port });
        sockets.add(upstream);
        upstream.on('close', () => sockets.delete(upstream));
        client.on('close', () => upstream.destroy());
        upstream.on('error', () => {
          if (upstream.connecting) refuse(client, '502 Bad Gateway');
          else client.destroy();
        });
        upstream.once('connect', () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          upstream.pipe(client);
          client.pipe(upstream);
        });
      },
      () => refuse(client, '403 Forbidden'),
    );
  });

  // Plain HTTP: absolute-form request URL
  server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
    const reject = (status: number) => {
      if (!res.headersSent) res.writeHead(status, { connection: 'close', 'content-length': '0' });
      res.end();
    };
    let url: URL;
    try {
      url = new URL(req.url ?? '');
    } catch {
      return reject(400);
    }
    if (url.protocol !== 'http:') return reject(400);
    resolve(url.hostname).then(
      ([address]) => {
        const headers = { ...req.headers };
        for (const name of PROXY_ONLY_HEADERS) delete headers[name];
        const upstream = http.request({
          host: address,
          port: Number(url.port) || 80,
          method: req.method,
          path: url.pathname + url.search,
          headers,
          agent: false,
        });
        upstream.on('response', (response) => {
          // One request per connection keeps each browser connection tied to one checked host.
          // Ending the socket explicitly also works around Bun leaving it open after an
          // empty proxied body (e.g. a bare 302).
          res.writeHead(response.statusCode ?? 502, { ...response.headers, connection: 'close' });
          res.once('finish', () => req.socket.end());
          response.pipe(res);
        });
        upstream.on('error', () => (res.headersSent ? res.destroy() : reject(502)));
        req.pipe(upstream);
      },
      () => reject(403),
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
        for (const socket of sockets) socket.destroy();
        server.close(() => done());
      }),
  };
}
