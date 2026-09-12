import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import { NodeLocalLeaseManager } from '../authoring/node-local-lease.js';
import { ReviewTerminalAuthority } from '../authoring/review-terminal-authority.js';
import { NodeReviewApprovedApplyBackend } from '../authoring/node-review-approved-apply.js';
import { ReviewApprovedApplyService } from '../authoring/review-approved-apply-service.js';
import { ReviewPreparationService } from '../authoring/review-preparation-service.js';
import {
  createReviewAuthorityHttpHandler,
  REVIEW_AUTHORITY_BASE_PATH,
} from './http-handler.js';

export interface ReviewAuthorityBrowserConfig {
  protocolVersion: '1.0.0';
  endpoint: typeof REVIEW_AUTHORITY_BASE_PATH;
  token: string;
}

export interface ReviewAuthorityVitePluginOptions {
  dataRoot?: string;
  projectRoot?: string;
  token?: string;
}

type ReviewMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

interface ReviewMiddlewareServer {
  middlewares: { use(handler: ReviewMiddleware): unknown };
}

interface ReviewPreviewServer extends ReviewMiddlewareServer {
  config: { root: string; build: { outDir: string } };
}

export interface ReviewAuthorityVitePlugin {
  name: string;
  apply: 'serve';
  configureServer(server: ReviewMiddlewareServer): void;
  configurePreviewServer(server: ReviewPreviewServer): void;
  transformIndexHtml: {
    order: 'pre';
    handler(html: string, context: { path: string; server?: unknown }): string;
  };
}

const INJECTED_MARKER = 'data-surdet-review-authority';

function expectedOrigin(request: IncomingMessage): readonly string[] {
  const port = request.socket.localPort;
  if (port === undefined) return [];
  const encrypted = 'encrypted' in request.socket && request.socket.encrypted === true;
  const scheme = encrypted ? 'https' : 'http';
  return [
    `${scheme}://127.0.0.1:${port}`,
    `${scheme}://localhost:${port}`,
    `${scheme}://[::1]:${port}`,
  ];
}

function scriptSource(config: ReviewAuthorityBrowserConfig): string {
  const json = JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script ${INJECTED_MARKER}>globalThis.__SURDET_REVIEW_AUTHORITY__=Object.freeze(${json});</script>`;
}

export function injectReviewAuthorityConfig(
  html: string,
  pathname: string,
  config: ReviewAuthorityBrowserConfig,
): string {
  if (pathname !== '/' && pathname !== '/index.html') return html;
  if (html.includes(INJECTED_MARKER)) return html;
  const script = scriptSource(config);
  return html.includes('</head>') ? html.replace('</head>', `${script}</head>`) : `${script}${html}`;
}

export function reviewAuthorityVitePlugin(options: ReviewAuthorityVitePluginOptions = {}): ReviewAuthorityVitePlugin {
  const leases = new NodeLocalLeaseManager(options.dataRoot);
  const authority = new ReviewTerminalAuthority(leases.dataRoot, leases, undefined, options.projectRoot);
  const token = options.token ?? crypto.randomBytes(32).toString('base64url');
  const browserConfig: ReviewAuthorityBrowserConfig = {
    protocolVersion: '1.0.0',
    endpoint: REVIEW_AUTHORITY_BASE_PATH,
    token,
  };
  let applyService: Promise<ReviewApprovedApplyService> | undefined;
  let preparationService: Promise<ReviewPreparationService> | undefined;
  const handler = createReviewAuthorityHttpHandler({ authority, token, expectedOrigin,
    ...(options.projectRoot === undefined ? {} : { prepareResult: async (request) => {
      preparationService ??= ReviewPreparationService.open(options.projectRoot!, leases.dataRoot)
        .catch((error: unknown) => { preparationService = undefined; throw error; });
      return (await preparationService).execute(request);
    } }),
    ...(options.projectRoot === undefined ? {} : { applyApprovedResult: async (request) => {
      applyService ??= NodeReviewApprovedApplyBackend.open(options.projectRoot!, leases.dataRoot)
        .then((backend) => new ReviewApprovedApplyService(backend))
        .catch((error: unknown) => { applyService = undefined; throw error; });
      return (await applyService).execute(request);
    } }),
  });
  const mountAuthority: ReviewMiddleware = (request, response, next) => {
    if ((request.url ?? '').startsWith(`${REVIEW_AUTHORITY_BASE_PATH}/`)) handler(request, response);
    else next();
  };

  return {
    name: 'surdet-review-authority',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(mountAuthority);
    },
    configurePreviewServer(server) {
      server.middlewares.use(mountAuthority);
      server.middlewares.use((request, response, next) => {
        const pathname = (request.url ?? '').split('?', 1)[0] ?? '';
        if (request.method !== 'GET' && request.method !== 'HEAD') return next();
        if (pathname !== '/' && pathname !== '/index.html') return next();
        const indexFile = path.resolve(server.config.root, server.config.build.outDir, 'index.html');
        void fs.readFile(indexFile, 'utf8').then((html) => {
          const rendered = injectReviewAuthorityConfig(html, pathname, browserConfig);
          const bytes = Buffer.from(rendered, 'utf8');
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.setHeader('Content-Length', String(bytes.byteLength));
          response.setHeader('Cache-Control', 'no-store');
          if (request.method === 'HEAD') response.end();
          else response.end(bytes);
        }).catch(() => next());
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (context.server === undefined) return html;
        return injectReviewAuthorityConfig(html, context.path, browserConfig);
      },
    },
  };
}
