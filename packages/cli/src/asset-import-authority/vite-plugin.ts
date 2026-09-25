import * as crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AssetImportBindingService } from './binding.js';
import { ProjectAssetImportAuthority } from './authority.js';
import { openAssetImportAuthorityPaths, absoluteAssetImportProjectPath, assetImportFileIdentity } from './filesystem.js';
import {
  ASSET_IMPORT_AUTHORITY_BASE_PATH,
  createAssetImportAuthorityHttpHandler,
  type AssetImportAuthorityHttpTarget,
} from './http-handler.js';
import { AssetImportRecordStore } from './record-store.js';
import { AssetProjectMutationCoordinator } from './mutation-coordinator.js';
import { AssetRelocationStore } from './asset-relocation-store.js';
import { ProjectAssetRelocationAuthority } from './asset-relocation-authority.js';
import { ProjectSceneLifecycleAuthority } from './scene-lifecycle-authority.js';
import { NodeLocalLeaseManager } from '../authoring/node-local-lease.js';
import { NodeProjectStorage } from '../authoring/node-project-storage.js';
import { loadProjectCoordinationBaseline, type ProjectCoordinationBaseline } from '../authoring/project-coordination-baseline.js';
import { ProjectMutationNoticeStore } from '../authoring/project-mutation-notice-store.js';
import { EditorWorkspaceAuthority } from '../editor-workspace-authority/editor-workspace-authority.js';
import { ProjectMutationLeaseContext } from '../editor-workspace-authority/project-mutation-lease-context.js';
import type {
  AssetImportJournal,
  AssetRelocationJournal,
  AssetRelocationDetailResponse,
} from './types.js';

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
  authority: AssetImportAuthorityHttpTarget & { workspace: EditorWorkspaceAuthority };
  workspace: EditorWorkspaceAuthority;
  close(): Promise<void>;
}

const INJECTED_MARKER = 'data-surdet-asset-import-authority';
const MUTATION_NOTICE_WARNING = '[surdet] project mutation notice unavailable';

type MutationNoticeInitiator = 'asset-authority' | 'scene-authority';

function warnMutationNotice(): void {
  console.warn(MUTATION_NOTICE_WARNING);
}

function changedCoordinationPaths(
  before: ProjectCoordinationBaseline | null,
  after: ProjectCoordinationBaseline | null,
): string[] {
  if (before === null || after === null) return [];
  const left = new Map(before.files.map((file) => [file.path, file.sha256]));
  const right = new Map(after.files.map((file) => [file.path, file.sha256]));
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((path) => left.get(path) !== right.get(path))
    .sort((leftPath, rightPath) => leftPath.localeCompare(rightPath));
}

function relocationDetailPaths(detail: AssetRelocationDetailResponse): string[] {
  return [
    ...(detail.receipt?.moves.flatMap((move) => [move.sourcePath, move.targetPath]) ?? []),
    ...(detail.receipt?.textFiles.map((file) => file.path) ?? []),
    ...(detail.undoReceipt?.moves.flatMap((move) => [move.sourcePath, move.targetPath]) ?? []),
    ...(detail.undoReceipt?.restoredTextFiles.map((file) => file.path) ?? []),
    ...(detail.undoReceipt === null ? [] : [detail.undoReceipt.sourcePath, detail.undoReceipt.targetPath]),
  ];
}

function journalProgressed(
  before: Pick<AssetImportJournal | AssetRelocationJournal, 'journalVersion' | 'status'> | null,
  after: Pick<AssetImportJournal | AssetRelocationJournal, 'journalVersion' | 'status'>,
): boolean {
  return before === null
    || before.journalVersion !== after.journalVersion
    || before.status !== after.status;
}

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
  const leaseManager = new NodeLocalLeaseManager();
  const mutationContext = await ProjectMutationLeaseContext.open(paths.projectRoot, leaseManager);
  const workspace = new EditorWorkspaceAuthority(paths.projectRoot, { leaseManager });
  let stopChallengeCleanup: (() => void) | undefined;
  try {
    const store = new AssetImportRecordStore(paths);
    const relocationStore = new AssetRelocationStore(paths);
    const mutationNoticeStore = new ProjectMutationNoticeStore({ dataRoot: leaseManager.dataRoot });
    const readBaseline = async (): Promise<ProjectCoordinationBaseline | null> => {
      try {
        return await loadProjectCoordinationBaseline(await NodeProjectStorage.open(paths.projectRoot));
      } catch {
        warnMutationNotice();
        return null;
      }
    };
    const readImportJournal = async (operationId: string): Promise<AssetImportJournal | null> => {
      return (await store.readOperation(operationId)).journal;
    };
    const readRelocationJournal = async (operationId: string): Promise<AssetRelocationJournal | null> => {
      return (await relocationStore.read(operationId))?.journal ?? null;
    };
    const targetIdentities = async (targets: string[]): Promise<Map<string, string> | null> => {
      try {
        return new Map(await Promise.all([...new Set(targets)].map(async target => {
          const identity = await assetImportFileIdentity(absoluteAssetImportProjectPath(paths, target)).catch(error => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
          });
          return [target, JSON.stringify(identity)] as const;
        })));
      } catch {
        warnMutationNotice();
        return null;
      }
    };
    const recordNotice = async (
      initiator: MutationNoticeInitiator,
      operationId: string,
      changedPaths: readonly string[],
      baselineAfter: ProjectCoordinationBaseline | null,
    ): Promise<void> => {
      if (changedPaths.length === 0 || baselineAfter === null) return;
      try {
        await mutationNoticeStore.record(paths.projectRoot, {
          projectRevision: baselineAfter.projectRevision,
          coordinationRevision: baselineAfter.coordinationRevision,
          initiator,
          changedPaths: [...new Set(changedPaths)].sort((left, right) => left.localeCompare(right)),
          operationId,
        }, () => mutationContext.assertHeld());
      } catch {
        warnMutationNotice();
      }
    };
    const mutationCoordinator = new AssetProjectMutationCoordinator(mutationContext);
    const binding = new AssetImportBindingService(paths, store);
    await binding.recoverExpiredChallenges();
    stopChallengeCleanup = binding.startExpiredChallengeCleanup();
    const authority = new ProjectAssetImportAuthority(paths, store, {
      textHasher: {
        sha256: async (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
      },
      assertLeaseHeld: () => mutationContext.assertHeld(),
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
        assertLeaseHeld: () => mutationContext.assertHeld(),
        mutationCoordinator,
      },
    );
    const sceneLifecycle = new ProjectSceneLifecycleAuthority(paths, {
      assertLeaseHeld: () => mutationContext.assertHeld(),
      mutationCoordinator,
      onRecovered: async (requestId, changedPaths) => recordNotice('scene-authority', requestId, changedPaths, await readBaseline()),
    });
    const target: AssetImportAuthorityHttpTarget & { workspace: EditorWorkspaceAuthority } = {
      projectIdentity: paths.projectIdentity,
      workspace,
      createChallenge: (browserSessionId) => binding.createChallenge(browserSessionId),
      confirmChallenge: (challengeId, request) => binding.confirmChallenge(challengeId, request),
      validateBinding: (token, browserSessionId) => browserSessionId === undefined
        ? binding.validateBindingToken(token)
        : binding.validateBinding(token, browserSessionId),
      revoke: (browserSessionId) => binding.revoke(browserSessionId),
      createOperation: (request) => authority.createOperation(request),
      expectedUploadBytes: (operationId, itemId) => mutationContext.run(() => authority.expectedUploadBytes(operationId, itemId)),
      uploadItem: (operationId, itemId, body) => authority.uploadItem(operationId, itemId, body),
      plan: (operationId, request) => authority.plan(operationId, request),
      seal: (operationId, request) => authority.seal(operationId, request),
      commit: (operationId, request) => mutationContext.run(async () => {
        const before = await readImportJournal(operationId);
        const response = await authority.commit(operationId, request);
        if (journalProgressed(before, response.operation)) {
          await recordNotice('asset-authority', operationId, response.receipt.files.map(file => file.targetPath), await readBaseline());
        }
        return response;
      }),
      cancel: (operationId) => authority.cancel(operationId),
      list: () => mutationContext.run(() => authority.list()),
      query: (operationId) => mutationContext.run(() => authority.query(operationId)),
      issueOperationToken: (operationId) => mutationContext.run(() => authority.issueOperationToken(operationId)),
      recover: (operationId, request) => mutationContext.run(async () => {
        const before = await readImportJournal(operationId);
        const targets = (await store.readPublication(operationId))?.files.map(file => file.targetPath) ?? [];
        const beforeFiles = await targetIdentities(targets);
        const response = await authority.recover(operationId, request);
        if (journalProgressed(before, response.detail.operation)) {
          const afterFiles = await targetIdentities(targets);
          if (beforeFiles !== null && afterFiles !== null) {
            const changed = targets.filter(target => beforeFiles.get(target) !== afterFiles.get(target));
            if (changed.length > 0) await recordNotice('asset-authority', operationId, changed, await readBaseline());
          }
        }
        return response;
      }),
      undo: (operationId, request) => mutationContext.run(async () => {
        const before = await readImportJournal(operationId);
        const response = await authority.undo(operationId, request);
        if (journalProgressed(before, response.operation)) {
          await recordNotice('asset-authority', operationId, response.undoReceipt.removedPaths, await readBaseline());
        }
        return response;
      }),
      verifyOperationToken: (operationId, token) => authority.verifyOperationToken(operationId, token),
      relocationPlan: (request) => relocation.plan(request),
      relocationList: () => mutationContext.run(() => relocation.list()),
      relocationQuery: (operationId) => mutationContext.run(() => relocation.query(operationId)),
      relocationCommit: (operationId, request) => mutationContext.run(async () => {
        const before = await readRelocationJournal(operationId);
        const response = await relocation.commit(operationId, request);
        if (journalProgressed(before, response.operation)) {
          await recordNotice('asset-authority', operationId, relocationDetailPaths(response), await readBaseline());
        }
        return response;
      }),
      relocationCancel: (operationId) => relocation.cancel(operationId),
      relocationRecover: (operationId, request) => mutationContext.run(async () => {
        const stored = await relocationStore.read(operationId);
        const before = stored?.journal ?? null;
        const targets = stored === null ? [] : [...stored.request.moves.flatMap(move => [move.sourcePath, move.targetPath]), ...stored.textFiles.map(file => file.path)];
        const beforeFiles = await targetIdentities(targets);
        const response = await relocation.recover(operationId, request);
        if (journalProgressed(before, response.operation)) {
          const afterFiles = await targetIdentities(targets);
          if (beforeFiles !== null && afterFiles !== null) {
            const changed = targets.filter(target => beforeFiles.get(target) !== afterFiles.get(target));
            if (changed.length > 0) await recordNotice('asset-authority', operationId, changed, await readBaseline());
          }
        }
        return response;
      }),
      relocationUndo: (operationId, request) => mutationContext.run(async () => {
        const before = await readRelocationJournal(operationId);
        const response = await relocation.undo(operationId, request);
        if (journalProgressed(before, response.operation)) {
          await recordNotice('asset-authority', operationId, relocationDetailPaths(response), await readBaseline());
        }
        return response;
      }),
      scenePlan: (request, workspaceWrite) => workspaceWrite === undefined
        ? mutationContext.run(() => sceneLifecycle.plan(request))
        : workspace.withWriteLease(workspaceWrite, lease => mutationContext.runWithLease(lease, () => sceneLifecycle.plan(request))),
      sceneCommit: (request, workspaceWrite) => workspaceWrite === undefined
        ? mutationContext.run(async () => {
          const before = await readBaseline();
          const response = await sceneLifecycle.commit(request);
          const after = await readBaseline();
          const changedPaths = changedCoordinationPaths(before, after);
          if (changedPaths.length > 0) {
            await recordNotice(
              'scene-authority',
              request.requestId,
              [...response.writes.map((write) => write.path), ...response.deletedPaths, ...changedPaths],
              after,
            );
          }
          return response;
        })
        : workspace.withWriteLease(workspaceWrite, lease => mutationContext.runWithLease(lease, () => sceneLifecycle.commit(request))),
    };
    return { authority: target, workspace, close: async () => { stopChallengeCleanup?.(); await workspace.close(); } };
  } catch (error) {
    stopChallengeCleanup?.();
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
  let closeActiveRuntime: (() => Promise<void>) | undefined;
  let releasePromise: Promise<void> | undefined;
  let configuredServer: MiddlewareServer | undefined;
  let configurationError: unknown;
  let mountedHandler: ((request: IncomingMessage, response: ServerResponse) => void) | undefined;
  let readyPromise: Promise<void> | undefined;
  const releaseRuntime = (): Promise<void> => {
    if (releasePromise !== undefined) return releasePromise;
    releasePromise = closeActiveRuntime?.() ?? Promise.resolve();
    closeActiveRuntime = undefined;
    return releasePromise;
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
