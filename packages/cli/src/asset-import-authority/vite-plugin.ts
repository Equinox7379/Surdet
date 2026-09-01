import * as crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AssetImportBindingService } from './binding.js';
import { ProjectAssetImportAuthority } from './authority.js';
import { openAssetImportAuthorityPaths } from './filesystem.js';
import {
  ASSET_IMPORT_AUTHORITY_BASE_PATH,
  createAssetImportAuthorityHttpHandler,
  type AssetImportAuthorityHttpTarget,
} from './http-handler.js';
import { acquireAssetImportProjectLease, type AssetImportProjectLease } from './project-lease.js';
import { AssetImportRecordStore } from './record-store.js';
import { AssetProjectMutationCoordinator } from './mutation-coordinator.js';
import { AssetRelocationStore } from './asset-relocation-store.js';
import { ProjectAssetRelocationAuthority } from './asset-relocation-authority.js';

export interface AssetImportAuthorityBrowserConfig {
  authorityContractVersion: 1;
  endpoint: typeof ASSET_IMPORT_AUTHORITY_BASE_PATH;
  token: string;
}

export interface AssetImportAuthorityVitePluginOptions {
  projectRoot?: string;
  dataRoot?: string;
}

type Middleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

interface MiddlewareServer {
  middlewares: { use(handler: Middleware): unknown };
  httpServer?: { once(event: 'close', listener: () => void): unknown } | null;
}

export interface AssetImportAuthorityVitePlugin {
  name: string;
  apply: 'serve';
  api: { ready(): Promise<void> };
  configureServer(server: MiddlewareServer): void | Promise<void>;
  closeBundle(): void | Promise<void>;
  transformIndexHtml: {
    order: 'pre';
    handler(html: string, context: { path: string; server?: unknown }): string;
  };
}

interface Runtime {
  authority: AssetImportAuthorityHttpTarget;
  lease: AssetImportProjectLease;
  close(): void;
}

const INJECTED_MARKER = 'data-surdet-asset-import-authority';

function scriptSource(config: AssetImportAuthorityBrowserConfig): string {
  const json = JSON.stringify(config)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script ${INJECTED_MARKER}>globalThis.__SURDET_ASSET_IMPORT_AUTHORITY__=Object.freeze(${json});</script>`;
}

export function injectAssetImportAuthorityConfig(
  html: string,
  pathname: string,
  config: AssetImportAuthorityBrowserConfig,
): string {
  if (pathname !== '/' && pathname !== '/index.html') return html;
  if (html.includes(INJECTED_MARKER)) return html;
  const script = scriptSource(config);
  return html.includes('</head>') ? html.replace('</head>', `${script}</head>`) : `${script}${html}`;
}

function expectedOrigin(request: IncomingMessage): string | undefined {
  const port = request.socket.localPort;
  if (port === undefined) return undefined;
  return `http://127.0.0.1:${port}`;
}

async function openRuntime(options: Required<Pick<AssetImportAuthorityVitePluginOptions, 'projectRoot' | 'dataRoot'>>): Promise<Runtime> {
  const paths = await openAssetImportAuthorityPaths({ projectRoot: options.projectRoot, dataRoot: options.dataRoot });
  const lease = await acquireAssetImportProjectLease({ projectRoot: paths.projectRoot, dataRoot: paths.dataRoot });
  let stopChallengeCleanup: (() => void) | undefined;
  try {
    const store = new AssetImportRecordStore(paths);
    const mutationCoordinator = new AssetProjectMutationCoordinator();
    const binding = new AssetImportBindingService(paths, store);
    await binding.recoverExpiredChallenges();
    stopChallengeCleanup = binding.startExpiredChallengeCleanup();
    const authority = new ProjectAssetImportAuthority(paths, store, {
      textHasher: {
        sha256: async (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
      },
      assertLeaseHeld: () => lease.assertHeld(),
      mutationCoordinator,
    });
    const relocation = new ProjectAssetRelocationAuthority(
      paths,
      new AssetRelocationStore(paths),
      store,
      {
        textHasher: {
          sha256: async (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
        },
        assertLeaseHeld: () => lease.assertHeld(),
        mutationCoordinator,
      },
    );
    await authority.list();
    await relocation.list();
    const target: AssetImportAuthorityHttpTarget = {
      projectIdentity: paths.projectIdentity,
      createChallenge: (browserSessionId) => binding.createChallenge(browserSessionId),
      confirmChallenge: (challengeId, request) => binding.confirmChallenge(challengeId, request),
      validateBinding: (token, browserSessionId) => browserSessionId === undefined
        ? binding.validateBindingToken(token)
        : binding.validateBinding(token, browserSessionId),
      revoke: (browserSessionId) => binding.revoke(browserSessionId),
      createOperation: (request) => authority.createOperation(request),
      expectedUploadBytes: (operationId, itemId) => authority.expectedUploadBytes(operationId, itemId),
      uploadItem: (operationId, itemId, body) => authority.uploadItem(operationId, itemId, body),
      plan: (operationId, request) => authority.plan(operationId, request),
      seal: (operationId, request) => authority.seal(operationId, request),
      commit: (operationId, request) => authority.commit(operationId, request),
      cancel: (operationId) => authority.cancel(operationId),
      list: () => authority.list(),
      query: (operationId) => authority.query(operationId),
      issueOperationToken: (operationId) => authority.issueOperationToken(operationId),
      recover: (operationId, request) => authority.recover(operationId, request),
      undo: (operationId, request) => authority.undo(operationId, request),
      verifyOperationToken: (operationId, token) => authority.verifyOperationToken(operationId, token),
      relocationPlan: (request) => relocation.plan(request),
      relocationList: () => relocation.list(),
      relocationQuery: (operationId) => relocation.query(operationId),
      relocationCommit: (operationId, request) => relocation.commit(operationId, request),
      relocationCancel: (operationId) => relocation.cancel(operationId),
      relocationRecover: (operationId, request) => relocation.recover(operationId, request),
      relocationUndo: (operationId, request) => relocation.undo(operationId, request),
    };
    return { authority: target, lease, close: () => stopChallengeCleanup?.() };
  } catch (error) {
    stopChallengeCleanup?.();
    await lease.release().catch(() => undefined);
    throw error;
  }
}

export function assetImportAuthorityVitePlugin(
  options: AssetImportAuthorityVitePluginOptions = {},
): AssetImportAuthorityVitePlugin {
  const configured = options.projectRoot !== undefined || options.dataRoot !== undefined;
  if (configured && (options.projectRoot === undefined || options.dataRoot === undefined)) {
    throw new Error('asset import authority requires both projectRoot and dataRoot');
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const browserConfig: AssetImportAuthorityBrowserConfig = {
    authorityContractVersion: 1,
    endpoint: ASSET_IMPORT_AUTHORITY_BASE_PATH,
    token,
  };
  let activeLease: AssetImportProjectLease | undefined;
  let closeActiveRuntime: (() => void) | undefined;
  let releasePromise: Promise<void> | undefined;
  let configuredServer: MiddlewareServer | undefined;
  let configurationError: unknown;
  let mountedHandler: ((request: IncomingMessage, response: ServerResponse) => void) | undefined;
  let readyPromise: Promise<void> | undefined;
  const releaseRuntime = (): Promise<void> => {
    if (releasePromise !== undefined) return releasePromise;
    closeActiveRuntime?.();
    closeActiveRuntime = undefined;
    releasePromise = activeLease?.release() ?? Promise.resolve();
    return releasePromise.finally(() => { activeLease = undefined; });
  };

  return {
    name: 'surdet-project-asset-import-authority',
    apply: 'serve',
    api: {
      ready() {
        if (!configured) return Promise.resolve();
        if (readyPromise !== undefined) return readyPromise;
        readyPromise = (async () => {
          if (configurationError !== undefined) throw configurationError;
          const server = configuredServer;
          if (server?.httpServer === null || server?.httpServer === undefined) {
            throw new Error('asset import authority requires a dedicated HTTP server');
          }
          const runtime = await openRuntime({ projectRoot: options.projectRoot!, dataRoot: options.dataRoot! });
          activeLease = runtime.lease;
          closeActiveRuntime = runtime.close;
          try {
            const handler = createAssetImportAuthorityHttpHandler({
              authority: runtime.authority,
              token,
              expectedOrigin,
            });
            server.httpServer.once('close', () => { void releaseRuntime().catch(() => undefined); });
            mountedHandler = handler;
          } catch (error) {
            mountedHandler = undefined;
            await releaseRuntime();
            throw error;
          }
        })();
        return readyPromise;
      },
    },
    configureServer(server) {
      configuredServer = server;
      try {
        server.middlewares.use((request, response, next) => {
          if ((request.url ?? '').startsWith(`${ASSET_IMPORT_AUTHORITY_BASE_PATH}/`) && mountedHandler !== undefined) {
            mountedHandler(request, response);
          } else {
            next();
          }
        });
      } catch (error) {
        configurationError = error;
      }
    },
    closeBundle: releaseRuntime,
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!configured || context.server === undefined) return html;
        return injectAssetImportAuthorityConfig(html, context.path, browserConfig);
      },
    },
  };
}
