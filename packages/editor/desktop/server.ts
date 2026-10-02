import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { assetImportAuthorityVitePlugin } from '../../cli/dist/asset-import-authority/vite-plugin.js';
import { reviewAuthorityVitePlugin } from '../../cli/dist/review-authority/vite-plugin.js';
import { DESKTOP_ORIGIN } from './contracts.js';

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.wasm': 'application/wasm' };

/** The loopback transport is private to this process; only the app protocol carries its key. */
export async function startEditorServer(uiRoot: string, dataRoot: string, projectRoot?: string) {
  const transportKey = randomBytes(32).toString('hex');
  const middlewares: Middleware[] = [];
  const asset = assetImportAuthorityVitePlugin(projectRoot ? { projectRoot, dataRoot } : {});
  // Review decisions and mutation coordination share the normal Agent data namespace.
  const review = reviewAuthorityVitePlugin(projectRoot ? { projectRoot } : {});
  let closed = false;
  const server = createServer((req, res) => {
    if (req.headers['x-surdet-desktop-transport'] !== transportKey) { res.writeHead(403).end(); return; }
    let index = 0;
    const next = () => {
      const middleware = middlewares[index++];
      if (middleware) middleware(req, res, next);
      else void serve(req, res).catch(() => { if (!res.headersSent) res.writeHead(404); res.end(); });
    };
    next();
  });
  async function serve(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (relative.split('/').some(part => !part || part === '..' || /[\\:\x00]/.test(part))) { res.writeHead(404).end(); return; }
    let content: Uint8Array = await fs.readFile(path.join(uiRoot, relative));
    if (relative === 'index.html') {
      let html = Buffer.from(content).toString('utf8');
      const context = { path: '/index.html', server };
      html = review.transformIndexHtml.handler(html, context);
      html = asset.transformIndexHtml.handler(html, context);
      content = Buffer.from(html);
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(relative)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  }
  const adapter = { middlewares: { use(handler: Middleware) { middlewares.push(handler); } }, httpServer: server };
  review.configureServer(adapter);
  asset.configureServer(adapter);
  try {
    await asset.api.ready();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  } catch (error) { await asset.closeBundle(); server.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法启动编辑器本地服务。');
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    async request(request: Request): Promise<Response> {
      if (closed) return new Response(null, { status: 503 });
      const url = new URL(request.url);
      if (`${url.protocol}//${url.host}` !== DESKTOP_ORIGIN) return new Response(null, { status: 403 });
      const headers = new Headers(request.headers);
      const source = headers.get('origin');
      if (source && source !== DESKTOP_ORIGIN) return new Response(null, { status: 403 });
      // Authority checks still see their actual transport origin and require their own tokens/bindings.
      headers.set('origin', origin);
      headers.set('x-surdet-desktop-transport', transportKey);
      headers.delete('host');
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
      try { return await fetch(`${origin}${url.pathname}${url.search}`, { method: request.method, headers, body, signal: request.signal, redirect: 'error' }); }
      catch (error) { if (closed || request.signal.aborted) return new Response(null, { status: 503 }); throw error; }
    },
    async close() {
      closed = true;
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await asset.closeBundle();
    },
  };
}
