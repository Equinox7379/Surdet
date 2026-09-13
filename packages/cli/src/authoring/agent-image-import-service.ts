import * as crypto from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import {
  AGENT_IMAGE_EXTENSIONS, AGENT_IMAGE_MAX_BYTES, AGENT_IMAGE_MAX_FILES, AGENT_IMAGE_MAX_TOTAL_BYTES,
  AuthoringOperationError, stableStringify,
  type AgentImageStageRequest, type AgentImageCommitRequest,
} from '@surdet/authoring';
import { ProjectAssetImportAuthority } from '../asset-import-authority/authority.js';
import { ProjectAssetRelocationAuthority } from '../asset-import-authority/asset-relocation-authority.js';
import { AssetRelocationStore } from '../asset-import-authority/asset-relocation-store.js';
import { ProjectSceneLifecycleAuthority } from '../asset-import-authority/scene-lifecycle-authority.js';
import { AssetProjectMutationCoordinator } from '../asset-import-authority/mutation-coordinator.js';
import { openAssetImportAuthorityPaths } from '../asset-import-authority/filesystem.js';
import { AssetImportRecordStore } from '../asset-import-authority/record-store.js';
import { AssetImportAuthorityError, type OperationDetailResponse } from '../asset-import-authority/types.js';
import { ProjectMutationLeaseContext } from '../editor-workspace-authority/project-mutation-lease-context.js';
import { NodeLocalLeaseManager } from './node-local-lease.js';
import { NodeProjectStorage } from './node-project-storage.js';
import { HumanWorkspaceStore } from './human-workspace-store.js';
import { assertHumanWorkspaceAllowsAgentCommit } from './human-workspace-gate.js';
import { ProjectMutationNoticeStore } from './project-mutation-notice-store.js';
import { loadProjectCoordinationBaseline } from './project-coordination-baseline.js';

export type ImageImportCapability = 'asset.sources' | 'asset.import.stage' | 'asset.import.inspect' | 'asset.import.commit' | 'asset.import.recover';
export interface AuthorizedImageSource {
  sourceId: string;
  root: string;
  identity: string;
}
const hash = (value: string | Uint8Array): string => crypto.createHash('sha256').update(value).digest('hex');
const identity = (stat: Awaited<ReturnType<typeof fs.lstat>>): string => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
const limits = { maxFiles: AGENT_IMAGE_MAX_FILES, maxBytesPerFile: AGENT_IMAGE_MAX_BYTES, maxBytesPerOperation: AGENT_IMAGE_MAX_TOTAL_BYTES };
const forbidden = (): AuthoringOperationError => new AuthoringOperationError('ASSET_SOURCE_FORBIDDEN', '只能读取启动时授权目录内的普通图片文件；不允许路径跳转、链接或下载。');

export async function authorizeImageSources(roots: readonly string[]): Promise<AuthorizedImageSource[]> {
  const result: AuthorizedImageSource[] = [];
  for (const input of roots) {
    if (!path.isAbsolute(input)) throw forbidden();
    const root = await fs.realpath(input);
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || (await fs.lstat(input)).isSymbolicLink()) throw forbidden();
    const fingerprint = identity(stat);
    const sourceId = `source_${hash(`${root}\n${fingerprint}`).slice(0, 20)}`;
    if (!result.some(source => source.sourceId === sourceId)) result.push({ sourceId, root, identity: fingerprint });
  }
  return result;
}

async function checkedSourcePath(source: AuthorizedImageSource, relative: string): Promise<string> {
  if (typeof relative !== 'string' || relative.includes('\\') || path.isAbsolute(relative)
    || (relative !== '' && relative.split('/').some(segment => !segment || segment === '.' || segment === '..'
      || /[<>:"|?*\x00-\x1f]/u.test(segment) || /[. ]$/.test(segment)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(segment)))) throw forbidden();
  const rootStat = await fs.lstat(source.root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || identity(rootStat) !== source.identity
    || await fs.realpath(source.root) !== source.root) throw forbidden();
  let current = source.root;
  for (const segment of relative === '' ? [] : relative.split('/')) {
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink() || await fs.realpath(current) !== current) throw forbidden();
  }
  return current;
}

function imageFormat(bytes: Buffer, fileName: string): void {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const png = bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217;
  const webp = bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
    && bytes.readUInt32LE(4) + 8 === bytes.length;
  if (!(extension === 'png' && png || (extension === 'jpg' || extension === 'jpeg') && jpeg || extension === 'webp' && webp)) {
    throw new AuthoringOperationError('ASSET_IMAGE_INVALID', '图片扩展名或文件头不匹配；首版接受 PNG、JPEG、WebP。');
  }
}

async function readSource(source: AuthorizedImageSource, relative: string): Promise<Buffer> {
  const file = await checkedSourcePath(source, relative);
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw forbidden();
  if (before.size > AGENT_IMAGE_MAX_BYTES) throw new AssetImportAuthorityError('IMPORT_LIMIT_EXCEEDED', '图片超过单文件上限');
  const handle = await fs.open(file, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
  try {
    const opened = await handle.stat();
    if (identity(opened) !== identity(before) || !opened.isFile()) throw forbidden();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length;
      if (size > AGENT_IMAGE_MAX_BYTES) throw new AssetImportAuthorityError('IMPORT_LIMIT_EXCEEDED', '图片超过单文件上限');
      chunks.push(chunk);
    }
    const after = await handle.stat();
    const pathAfter = await fs.lstat(await checkedSourcePath(source, relative));
    if (identity(pathAfter) !== identity(opened) || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs || pathAfter.mtimeMs !== before.mtimeMs || pathAfter.size !== size) {
      throw new AuthoringOperationError('ASSET_SOURCE_CHANGED', '图片在读取期间变化，请重新读取来源事实。');
    }
    const bytes = Buffer.concat(chunks);
    imageFormat(bytes, relative);
    return bytes;
  } finally { await handle.close(); }
}

function sourceFor(sources: readonly AuthorizedImageSource[], sourceId: unknown): AuthorizedImageSource {
  const source = sources.find(item => item.sourceId === sourceId);
  if (source === undefined) throw forbidden();
  return source;
}

async function inspectSources(sources: readonly AuthorizedImageSource[], input: Record<string, unknown>) {
  const roots = sources.map(source => ({ sourceId: source.sourceId, name: path.basename(source.root) }));
  const base = { roots, supportedFormats: [...AGENT_IMAGE_EXTENSIONS], limits };
  if (input['sourceId'] === undefined) return base;
  const source = sourceFor(sources, input['sourceId']);
  const relative = typeof input['path'] === 'string' ? input['path'] : '';
  const file = await checkedSourcePath(source, relative);
  if ((await fs.lstat(file)).isDirectory()) {
    const entries = (await fs.readdir(file, { withFileTypes: true })).filter(entry => !entry.isSymbolicLink()
      && (entry.isDirectory() || entry.isFile() && (AGENT_IMAGE_EXTENSIONS as readonly string[]).includes(path.extname(entry.name).slice(1).toLowerCase())))
      .map(entry => ({ path: relative ? `${relative}/${entry.name}` : entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }));
    return { ...base, sourceId: source.sourceId, entries };
  }
  const bytes = await readSource(source, relative);
  return { ...base, sourceId: source.sourceId, file: { path: relative, bytes: bytes.length, sha256: hash(bytes) } };
}

export class AgentImageImportService {
  constructor(private readonly manager = new NodeLocalLeaseManager()) {}

  async invoke(projectRoot: string, capability: ImageImportCapability, input: Record<string, unknown>,
    sources: readonly AuthorizedImageSource[], dataRoot?: string): Promise<Record<string, unknown>> {
    try {
      if (capability === 'asset.sources') return await inspectSources(sources, input);
      const paths = await openAssetImportAuthorityPaths({ projectRoot, ...(dataRoot === undefined ? {} : { dataRoot }) });
      const lease = await ProjectMutationLeaseContext.open(projectRoot, this.manager);
      return await lease.run(async () => {
        const store = new AssetImportRecordStore(paths);
        const coordinator = new AssetProjectMutationCoordinator(lease);
        const options = { textHasher: { sha256: async (text: string) => hash(text) }, assertLeaseHeld: () => lease.assertHeld(), mutationCoordinator: coordinator };
        const authority = new ProjectAssetImportAuthority(paths, store, { ...options, limits });
        // Register the same durable recovery participants as the Editor authority.
        new ProjectAssetRelocationAuthority(paths, new AssetRelocationStore(paths), store, options);
        new ProjectSceneLifecycleAuthority(paths, { ...options, recoverOnReadinessCheck: false });
        const operationId = input['operationId'] as string;
        await authority.list();
        if (capability === 'asset.import.stage') {
          return this.stage(authority, store, input as unknown as AgentImageStageRequest, sources);
        }
        const detail = await authority.query(operationId);
        if (detail.manifest.agentRequestFingerprint === undefined) {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '该操作不属于 Agent 图像导入入口');
        }
        if (capability === 'asset.import.inspect') return { ...detail };
        if (detail.plan?.planFingerprint !== input['planFingerprint']) {
          throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '计划指纹不匹配，请查询同一导入操作');
        }
        if (capability === 'asset.import.commit' && detail.operation.status === 'COMMITTED') return { ...detail };
        await assertHumanWorkspaceAllowsAgentCommit(new HumanWorkspaceStore({ dataRoot: this.manager.dataRoot }), projectRoot);
        await coordinator.assertOtherReady('asset-import');
        if (capability === 'asset.import.commit') {
          await authority.commit(operationId, input as unknown as AgentImageCommitRequest);
        } else {
          const publication = await store.readPublication(operationId);
          const hasUndoState = publication?.files.some(file => [
            'UNDO_RENAME_INTENT', 'UNDO_QUARANTINED', 'UNDO_VERIFIED',
          ].includes(file.state)) ?? false;
          if (detail.operation.status === 'UNDOING' || detail.undoReceipt !== null || hasUndoState) {
            throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '本入口不执行素材撤销');
          }
          await authority.recover(operationId, { action: 'resume' });
        }
        const settled = await authority.query(operationId);
        let coordination: Record<string, unknown> = { status: 'unchanged' };
        if (settled.operation.status === 'COMMITTED' || settled.operation.status === 'ROLLED_BACK') {
          try {
            const baseline = await loadProjectCoordinationBaseline(await NodeProjectStorage.open(projectRoot));
            const notice = await new ProjectMutationNoticeStore({ dataRoot: this.manager.dataRoot }).record(projectRoot, {
              projectRevision: baseline.projectRevision, coordinationRevision: baseline.coordinationRevision,
              initiator: 'external-agent', operationId,
              changedPaths: settled.plan?.items.flatMap(item => item.targetPath === undefined ? [] : [item.targetPath]) ?? [],
            }, () => lease.assertHeld());
            coordination = { status: 'written', mutationSequence: notice.sequence };
          } catch {
            coordination = { status: 'warning', message: '素材状态已落盘，工作区通知暂不可用；请重新读取项目。' };
          }
        }
        return { ...settled, coordination };
      });
    } catch (error) {
      if (error instanceof AssetImportAuthorityError || error instanceof AuthoringOperationError) {
        throw new AuthoringOperationError(error.code, error.message, { ...error.details, operationId: input['operationId'] });
      }
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new AuthoringOperationError('ASSET_SOURCE_CHANGED', '来源不存在或已变化，请重新读取已授权来源。');
      }
      throw new AuthoringOperationError('IMPORT_IO_FAILED', '素材操作未能确认完成；请先查询同一 operationId。', {
        operationId: input['operationId'], cause: (error as NodeJS.ErrnoException)?.code,
      });
    }
  }

  private async stage(authority: ProjectAssetImportAuthority, store: AssetImportRecordStore,
    request: AgentImageStageRequest, sources: readonly AuthorizedImageSource[]): Promise<Record<string, unknown>> {
    const sourceRequest = request.items.map(({ itemId, sourceId, sourcePath, sha256 }) => ({ itemId, sourceId, sourcePath, sha256 }));
    const agentRequestFingerprint = hash(stableStringify(sourceRequest));
    const registration = await store.readOperationRegistration(request.operationId);
    let detail: OperationDetailResponse | undefined;
    if (registration !== null) {
      detail = await authority.query(request.operationId);
      if (detail.manifest.agentRequestFingerprint !== agentRequestFingerprint) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '同一 operationId 已绑定不同来源请求');
      }
    }
    const targets = request.items.map(({ itemId, kind, fileName }) => ({ itemId, kind, fileName }));
    if (detail !== undefined && !['UPLOADING', 'STAGED'].includes(detail.operation.status)) {
      const planRecord = await store.readPlan(request.operationId);
      if (planRecord === null || stableStringify(planRecord.targets) !== stableStringify(targets)) {
        throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '封存后的素材目标不能替换');
      }
      return { ...detail };
    }
    for (const item of request.items) {
      const sourceExtension = path.posix.extname(item.sourcePath).toLowerCase().replace('.jpeg', '.jpg');
      const targetExtension = path.extname(item.fileName).toLowerCase().replace('.jpeg', '.jpg');
      if (!['.png', '.jpg', '.webp'].includes(sourceExtension) || sourceExtension !== targetExtension) {
        throw new AuthoringOperationError('ASSET_IMAGE_INVALID', '不能通过改扩展名转换图片格式；目标必须保留实际图片格式。');
      }
    }
    const loaded = new Map<string, Buffer>();
    let total = 0;
    for (const item of request.items) {
      const source = sourceFor(sources, item.sourceId);
      const existing = detail?.stagedItems.find(staged => staged.itemId === item.itemId);
      if (existing !== undefined) {
        if (existing.sha256 !== item.sha256) throw new AssetImportAuthorityError('IMPORT_OPERATION_CONFLICT', '暂存图片与来源请求不一致');
        total += existing.bytes;
        continue;
      }
      const bytes = await readSource(source, item.sourcePath);
      if (hash(bytes) !== item.sha256) throw new AuthoringOperationError('ASSET_SOURCE_CHANGED', '图片与读取到的来源摘要不同，请重新读取来源。');
      imageFormat(bytes, item.fileName);
      total += bytes.length;
      if (total > AGENT_IMAGE_MAX_TOTAL_BYTES) throw new AssetImportAuthorityError('IMPORT_LIMIT_EXCEEDED', '本次图片总大小超过上限');
      loaded.set(item.itemId, bytes);
    }
    if (detail === undefined) {
      await authority.createOperation({ operationId: request.operationId, agentRequestFingerprint,
        items: request.items.map(item => ({ itemId: item.itemId, sourceName: path.posix.basename(item.sourcePath), declaredBytes: loaded.get(item.itemId)!.length })),
      });
    }
    for (const [itemId, bytes] of loaded) await authority.uploadItem(request.operationId, itemId, Readable.from(bytes));
    const planned = await authority.plan(request.operationId, { targets });
    if (planned.plan.status !== 'ready') {
      throw new AssetImportAuthorityError('IMPORT_PLAN_BLOCKED', '素材导入计划有阻断项；尚未写入项目，可修正目标后重试同一操作。', { plan: planned.plan });
    }
    await authority.seal(request.operationId, { planFingerprint: planned.plan.planFingerprint });
    return { ...await authority.query(request.operationId) };
  }
}
