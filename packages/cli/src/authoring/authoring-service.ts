import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  assertValidRandomSeed,
  type VarValue,
} from '@surdet/core';
import {
  bindVerifiedApproval,
  applyCharacterEnsure,
  applyCharacterRemove,
  applyEntrySceneSet,
  applyTimelineCreate,
  charactersFingerprint,
  entrySceneFingerprint,
  applyTimelinePatch,
  assetPathsFromFiles,
  AuthoringOperationError,
  assertBaseStillMatches,
  AUTHORING_CAPABILITY_REGISTRY,
  AUTHORING_CONTRACT_VERSION,
  beginChange,
  buildAssetCatalog,
  buildObjectIndex,
  buildOperationLedgerDiff,
  commitChange,
  createChangeDiff,
  createEvidenceEnvelope,
  executeTransactionRecovery,
  evidenceFreshness,
  ensureVariable,
  inspectObject,
  inspectProject,
  normalizeTrace,
  nativeCapabilityToMcpTool,
  openChange,
  applySceneCreate,
  applyScenePatch,
  queryTrace,
  recordValidation,
  recordDiffEvidence,
  recordRuntimeTrace,
  recordSimulationEvidence,
  rollbackChange,
  runExplicitPath,
  simulateSnapshot,
  inspectTransactionRecovery,
  timelineFingerprint,
  validateSnapshot,
  loadProjectSnapshot,
  type AuthoringObject,
  type ChangeSession,
  type CharacterEnsureInput,
  type CharacterRemoveInput,
  type ChangeIntentMetadata,
  type EntrySceneSetInput,
  type ProjectFile,
  type ProjectSnapshot,
  type ProjectAssetFileFact,
  type ProjectStorage,
  type ProjectWriteStorage,
  type ReviewApprovalRef,
  type VerifiedReviewApproval,
  type CommitJournal,
  type RecoveryInspection,
  type SceneCreateInput,
  type ScenePatchInput,
  type TimelineCreateInput,
  type TimelinePatchInput,
  type TraceQuery,
  type VariableEnsureInput,
} from '@surdet/authoring';
import { NodeChangeStore } from './node-change-store.js';
import { CompositionService, compositionServiceForProject } from './composition-service.js';
import { reviewServiceForProject } from './review-service.js';
import { NodeLocalLeaseManager, type LeaseHandle } from './node-local-lease.js';
import { NodeProjectStorage } from './node-project-storage.js';
import { projectIdentityFromRoot } from './project-identity.js';
import { ChangeRecordProjectStorage } from './working-project-storage.js';
import { HumanWorkspaceStore } from './human-workspace-store.js';
import { assertHumanWorkspaceAllowsAgentCommit } from './human-workspace-gate.js';
import { loadProjectCoordinationBaseline } from './project-coordination-baseline.js';
import { ProjectMutationNoticeStore } from './project-mutation-notice-store.js';

export interface ServiceMetadata {
  projectIdentity: string;
  projectRevision: string;
  changeId?: string;
  workingRevision?: number;
  workingSnapshotRevision?: string;
}

export interface ServiceResult<T> extends ServiceMetadata {
  result: T;
}

export type AgentCommitCoordination =
  | { status: 'written'; mutationSequence: number }
  | { status: 'warning'; reason: 'coordination-unavailable'; message: string };

function hashText(text: string): string {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function engineIdentity(): { version: string; gitHead: string } {
  return {
    version: process.env['SURDET_ENGINE_VERSION'] ?? '0.1.0',
    gitHead: process.env['SURDET_GIT_HEAD'] ?? 'unknown',
  };
}

function newEvidenceId(kind: string): string {
  return `${kind}_${Date.now()}_${crypto.randomUUID()}`;
}

function loadSnapshot(storage: ProjectStorage): Promise<ProjectSnapshot> {
  return loadProjectSnapshot(storage, {
    sha256: async (text) => hashText(text),
  });
}

interface ProjectSnapshotContext {
  snapshot: ProjectSnapshot;
  assetFiles: ProjectAssetFileFact[];
  gallery?: unknown;
}

async function loadProjectContext(
  leaseManager: NodeLocalLeaseManager,
  storage: NodeProjectStorage,
): Promise<ProjectSnapshotContext> {
  return withProjectLeaseRetry(leaseManager, storage.rootIdentity, async () => {
    const snapshot = await loadSnapshot(storage);
    const assetPaths = assetPathsFromFiles(await storage.listFiles());
    const assetFiles = await storage.inspectFileFacts(assetPaths);
    let gallery: unknown;
    if (await storage.exists('content/config/gallery.json')) {
      try {
        gallery = JSON.parse((await storage.readText('content/config/gallery.json')).text.replace(/^\uFEFF/, '')) as unknown;
      } catch {
        gallery = undefined;
      }
    }
    return { snapshot, assetFiles, ...(gallery === undefined ? {} : { gallery }) };
  });
}

async function withProjectLeaseRetry<T>(
  leaseManager: NodeLocalLeaseManager,
  projectRootIdentity: string,
  callback: (lease: LeaseHandle) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await leaseManager.withProjectLease(projectRootIdentity, callback);
    } catch (error) {
      const transientMissingLease = error instanceof AuthoringOperationError
        && error.code === 'LEASE_CORRUPT'
        && error.message.includes('lease.json 缺失');
      if (!transientMissingLease || attempt === 39) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new AuthoringOperationError('PROJECT_BUSY', `项目 '${projectRootIdentity}' 在有界重试后仍被占用`);
}

async function openChangeRecordContext(changeId: string): Promise<{
  store: NodeChangeStore;
  session: ChangeSession;
}> {
  const opened = await NodeChangeStore.openByChangeId(changeId);
  if (opened === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
  return { store: opened.store, session: openChange(opened.record, opened.store) };
}

async function openChangeIdentityContext(changeId: string): Promise<{
  store: NodeChangeStore;
  session: ChangeSession;
  storage: NodeProjectStorage;
}> {
  const recordContext = await openChangeRecordContext(changeId);
  const storage = await NodeProjectStorage.open(recordContext.session.record.projectRootIdentity);
  if (storage.rootIdentity !== recordContext.session.record.projectRootIdentity) {
    throw new AuthoringOperationError('PROJECT_CHANGED_SINCE_BEGIN', '项目根目录身份已变化');
  }
  const session = openChange(recordContext.session.record, recordContext.store, storage);
  return { store: recordContext.store, session, storage };
}

async function openChangeContext(changeId: string): Promise<{
  store: NodeChangeStore;
  session: ChangeSession;
  storage: NodeProjectStorage;
  snapshot: ProjectSnapshot;
}> {
  const identity = await openChangeIdentityContext(changeId);
  const { session } = identity;
  const snapshot = await loadSnapshot(new ChangeRecordProjectStorage(session.record));
  return { ...identity, snapshot };
}

interface OpenChangeContext extends Awaited<ReturnType<typeof openChangeContext>> {}

async function withChangeLeaseRetry<T>(
  changeId: string,
  callback: (leasedStore: NodeChangeStore) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await NodeChangeStore.withChangeLease(changeId, callback);
    } catch (error) {
      const transientMissingLease = error instanceof AuthoringOperationError
        && error.code === 'LEASE_CORRUPT'
        && error.message.includes('lease.json 缺失');
      if (!(error instanceof AuthoringOperationError)
        || (error.code !== 'CHANGE_BUSY' && !transientMissingLease)
        || attempt === 39) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw new AuthoringOperationError('CHANGE_BUSY', `变更事务 '${changeId}' 在有界重试后仍被占用`);
}

async function withOpenChange<T>(
  changeId: string,
  callback: (context: OpenChangeContext) => Promise<T>,
): Promise<T> {
  return withChangeLeaseRetry(changeId, (leasedStore) => openChangeFromStore(changeId, leasedStore, callback));
}

async function openChangeFromStore<T>(
  changeId: string,
  leasedStore: NodeChangeStore,
  callback: (context: OpenChangeContext) => Promise<T>,
): Promise<T> {
    const record = await leasedStore.read(changeId);
    if (record === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
    const storage = await NodeProjectStorage.open(record.projectRootIdentity);
    if (storage.rootIdentity !== record.projectRootIdentity) {
      throw new AuthoringOperationError('PROJECT_CHANGED_SINCE_BEGIN', '项目根目录身份已变化');
    }
    const session = openChange(record, leasedStore, storage);
    const snapshot = await loadSnapshot(new ChangeRecordProjectStorage(session.record));
    return callback({ store: leasedStore, session, storage, snapshot });
}

function metadataForChange(session: ChangeSession, projectRevision = session.record.baseRevision): ServiceMetadata {
  const files = Object.keys(session.record.workingFiles).sort((left, right) => left.localeCompare(right));
  const workingSnapshotRevision = hashText(files.map((filePath) => `${filePath}\0${hashText(session.record.workingFiles[filePath]!)}`).join('\n'));
  return {
    projectIdentity: projectIdentityFromRoot(session.record.projectRootIdentity),
    projectRevision,
    changeId: session.record.changeId,
    workingRevision: session.record.workingRevision,
    workingSnapshotRevision,
  };
}

function validationEvidence(
  projectRevision: string,
  changeId: string,
  workingRevision: number,
  result: ReturnType<typeof validateSnapshot>,
): ReturnType<typeof createEvidenceEnvelope> {
  const evidenceId = newEvidenceId('validation');
  return createEvidenceEnvelope({
    evidenceId,
    capability: 'project.validate',
    status: result.ok ? 'passed' : 'failed',
    engineIdentity: engineIdentity(),
    projectRevision,
    changeId,
    workingRevision,
    createdAt: new Date().toISOString(),
    result: {
      ok: result.ok,
      issues: result.issues,
    },
  });
}

function simulationEvidence(
  projectRevision: string,
  changeId: string,
  workingRevision: number,
  result: ReturnType<typeof simulateSnapshot>,
): ReturnType<typeof createEvidenceEnvelope> {
  const evidenceId = newEvidenceId('simulation');
  return createEvidenceEnvelope({
    evidenceId,
    capability: 'project.simulate',
    status: result.status,
    engineIdentity: engineIdentity(),
    projectRevision,
    changeId,
    workingRevision,
    createdAt: new Date().toISOString(),
    result,
  });
}

function changedPaths(session: ChangeSession): string[] {
  const paths = new Set([...Object.keys(session.record.baseContents), ...Object.keys(session.record.workingFiles)]);
  return [...paths].filter((filePath) => session.record.baseContents[filePath] !== session.record.workingFiles[filePath]).sort();
}

function diffForChange(session: ChangeSession): ReturnType<typeof createChangeDiff> {
  const paths = changedPaths(session);
  const files = paths.map((filePath) => {
    const before = session.record.baseContents[filePath] ?? '';
    const after = session.record.workingFiles[filePath] ?? '';
    const diff = createChangeDiff({
      operationId: `change.diff:${filePath}`,
      before: {
        path: filePath,
        text: before,
        ...(session.record.baseFiles[filePath]?.sha256 === undefined ? {} : { sha256: session.record.baseFiles[filePath]!.sha256 }),
      },
      after: { path: filePath, text: after, sha256: hashText(after) },
      directChange: { path: filePath },
      potentialImpact: [],
      observedImpact: [],
      kind: filePath === 'game.config.json' ? 'variable' : filePath.startsWith('content/timelines/') ? 'timeline' : 'scene',
    });
    return diff;
  });
  const diffFiles = files.flatMap((diff) => diff.files);
  return {
    summary: {
      createdScenes: paths.filter((filePath) => session.record.baseFiles[filePath] === undefined && filePath.endsWith('.gal')).length,
      modifiedScenes: paths.filter((filePath) => session.record.baseFiles[filePath] !== undefined && filePath.endsWith('.gal')).length,
      changedVariables: paths.includes('game.config.json') ? 1 : 0,
      warnings: diffFiles.flatMap((file) => file.unexpectedFormatChange ? [`${file.path}: 检测到与语义修改无关的行终止符变化`] : []),
    },
    // 文件级 JSON diff 保留；timeline/track/cue 的对象级 diff 只来自已执行的类型化 operation ledger。
    semantic: [...files.flatMap((file) => file.semantic), ...buildOperationLedgerDiff(session.record)],
    files: files.flatMap((file) => file.files),
  };
}

function recoveryLockState(state: Awaited<ReturnType<NodeLocalLeaseManager['inspect']>>['state']): RecoveryInspection['lockState'] {
  return state;
}

function insidePath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sameResolvedPath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function safeStagedIdentity(root: string, stagedIdentity: string): Promise<boolean> {
  if (stagedIdentity.length === 0 || stagedIdentity.includes('\0')) return false;
  const candidate = path.resolve(stagedIdentity);
  if (!insidePath(root, candidate) || !path.basename(candidate).startsWith('.surdet-')) return false;
  const parentRelative = path.relative(root, path.dirname(candidate));
  let current = root;
  for (const segment of parentRelative.length === 0 ? [] : parentRelative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
      const real = await fs.realpath(current);
      if (!insidePath(root, real) || !sameResolvedPath(real, current)) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      return false;
    }
  }
  try {
    const stat = await fs.lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const real = await fs.realpath(candidate);
    return insidePath(root, real) && sameResolvedPath(real, candidate);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

async function assertRecoveryStageIdentities(storage: NodeProjectStorage, journal: CommitJournal): Promise<void> {
  for (const entry of journal.files) {
    if (!await safeStagedIdentity(storage.rootIdentity, entry.stagedIdentity)) {
      throw new AuthoringOperationError('RECOVERY_AMBIGUOUS', `stagedIdentity 不在合法项目范围内：${entry.stagedIdentity}`, {
        path: entry.stagedIdentity,
        manualRecoveryRequired: true,
        repairAction: '保留项目与 journal，由人工检查 staged 文件路径、symlink 或 junction',
      });
    }
  }
}

async function assertRecoveryBaseRevision(
  storage: NodeProjectStorage,
  journal: CommitJournal,
  inspection: RecoveryInspection,
): Promise<void> {
  if (inspection.projectState !== 'base' || (journal.status !== 'STAGING' && journal.status !== 'RECOVERED')) return;
  let currentRevision: string;
  try {
    currentRevision = (await loadSnapshot(storage)).revision;
  } catch (error) {
    throw new AuthoringOperationError('RECOVERY_PLAN_STALE', '项目无法重新读取为原始 base，恢复计划已失效', {
      cause: error instanceof Error ? error.message : String(error),
      manualRecoveryRequired: true,
    });
  }
  if (currentRevision !== journal.projectRevisionAtCommitStart) {
    throw new AuthoringOperationError('RECOVERY_PLAN_STALE', '项目 base revision 已变化，恢复计划已失效', {
      expectedProjectRevision: journal.projectRevisionAtCommitStart,
      actualProjectRevision: currentRevision,
    });
  }
}

async function inspectRecoveryFromStore(
  changeId: string,
  store: NodeChangeStore,
  lockState: RecoveryInspection['lockState'],
): Promise<ServiceResult<RecoveryInspection>> {
  const record = await store.read(changeId);
  if (record === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
  const journal = await store.readLatestJournal(changeId);
  const storage = await NodeProjectStorage.open(record.projectRootIdentity);
  if (storage.rootIdentity !== record.projectRootIdentity) {
    throw new AuthoringOperationError('PROJECT_CHANGED_SINCE_BEGIN', '项目根目录身份已变化', {
      expected: record.projectRootIdentity,
      actual: storage.rootIdentity,
    });
  }
  const inspection = await inspectTransactionRecovery({
    record,
    journal,
    storage,
    leaseState: lockState,
    sha256: async (value) => hashText(value),
  });
  const session = openChange(record, store, storage);
  return {
    ...metadataForChange(session, journal?.projectRevisionAtCommitStart ?? record.baseRevision),
    result: inspection,
  };
}

export class AuthoringService {
  private readonly humanWorkspaceStore: HumanWorkspaceStore;
  private readonly mutationNoticeStore: ProjectMutationNoticeStore;

  constructor(
    private readonly leasedStore?: NodeChangeStore,
    private readonly leaseManager = new NodeLocalLeaseManager(),
    coordination: { humanWorkspaceStore?: HumanWorkspaceStore; mutationNoticeStore?: ProjectMutationNoticeStore } = {},
  ) {
    this.humanWorkspaceStore = coordination.humanWorkspaceStore ?? new HumanWorkspaceStore({ dataRoot: leaseManager.dataRoot });
    this.mutationNoticeStore = coordination.mutationNoticeStore ?? new ProjectMutationNoticeStore({ dataRoot: leaseManager.dataRoot });
  }

  withLeasedStore(leasedStore: NodeChangeStore): AuthoringService {
    return new AuthoringService(leasedStore, this.leaseManager, {
      humanWorkspaceStore: this.humanWorkspaceStore,
      mutationNoticeStore: this.mutationNoticeStore,
    });
  }

  private loadProjectContext(storage: NodeProjectStorage): Promise<ProjectSnapshotContext> {
    return loadProjectContext(this.leaseManager, storage);
  }

  private withOpenChange<T>(changeId: string, callback: (context: OpenChangeContext) => Promise<T>): Promise<T> {
    return this.leasedStore === undefined
      ? withOpenChange(changeId, callback)
      : openChangeFromStore(changeId, this.leasedStore, callback);
  }

  async describeCapabilities(): Promise<ServiceResult<{
    contractVersion: typeof AUTHORING_CONTRACT_VERSION;
    capabilities: Array<(typeof AUTHORING_CAPABILITY_REGISTRY)[number] & { mcpTool: string }>;
  }>> {
    return {
      projectIdentity: 'unbound',
      projectRevision: 'unbound',
      result: {
        contractVersion: AUTHORING_CONTRACT_VERSION,
        capabilities: AUTHORING_CAPABILITY_REGISTRY.map((definition) => ({
          ...definition,
          mcpTool: nativeCapabilityToMcpTool(definition.id),
        })),
      },
    };
  }

  async inspectProject(projectRoot: string): Promise<ServiceResult<ReturnType<typeof inspectProject>>> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const { snapshot, assetFiles, gallery } = await this.loadProjectContext(storage);
    const index = buildObjectIndex(snapshot);
    return { projectIdentity: projectIdentityFromRoot(snapshot.rootIdentity), projectRevision: snapshot.revision, result: inspectProject(snapshot, index, assetFiles, gallery) };
  }

  async projectAssets(projectRoot: string): Promise<ServiceResult<ReturnType<typeof buildAssetCatalog>>> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const { snapshot, assetFiles, gallery } = await this.loadProjectContext(storage);
    return {
      projectIdentity: projectIdentityFromRoot(snapshot.rootIdentity),
      projectRevision: snapshot.revision,
      result: buildAssetCatalog(assetFiles, snapshot, { gallery }),
    };
  }

  async validateProject(projectRoot: string): Promise<ServiceResult<{
    view: 'project';
    ok: boolean;
    issues: unknown[];
  }>> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const { snapshot, assetFiles, gallery } = await this.loadProjectContext(storage);
    const index = buildObjectIndex(snapshot);
    const assetCatalog = buildAssetCatalog(assetFiles, snapshot, { gallery });
    const validation = validateSnapshot(snapshot, index, { assetCatalog, timelineReferenceScope: 'complete' });
    return {
      projectIdentity: projectIdentityFromRoot(snapshot.rootIdentity),
      projectRevision: snapshot.revision,
      result: { view: 'project', ok: validation.ok, issues: validation.issues },
    };
  }

  async simulateProject(projectRoot: string, input?: { sceneId?: string; seed?: number }): Promise<ServiceResult<{
    view: 'project';
    status: 'passed';
    report: ReturnType<typeof simulateSnapshot>;
  }>> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const { snapshot: sourceSnapshot } = await this.loadProjectContext(storage);
    let snapshot = sourceSnapshot;
    if (input?.sceneId !== undefined) {
      if (!snapshot.scenes.some((scene) => scene.id === input.sceneId)) {
        throw new AuthoringOperationError('PROJECT_NOT_FOUND', `模拟目标场景不存在：${input.sceneId}`);
      }
      snapshot = { ...snapshot, entryScene: input.sceneId };
    }
    let report: ReturnType<typeof simulateSnapshot>;
    try {
      report = simulateSnapshot(snapshot, { seed: input?.seed });
    } catch (error) {
      if (error instanceof AuthoringOperationError) throw error;
      throw new AuthoringOperationError('RUNTIME_FAILED', error instanceof Error ? error.message : String(error));
    }
    if (report.status === 'incomplete') throw new AuthoringOperationError('SIMULATION_INCOMPLETE', '项目模拟达到预算上限');
    if (report.status === 'failed') {
      const firstError = report.runtimeErrors[0]?.message;
      throw new AuthoringOperationError('RUNTIME_FAILED', firstError === undefined ? '项目模拟包含运行时失败' : `项目模拟包含运行时失败：${firstError}`);
    }
    return {
      projectIdentity: projectIdentityFromRoot(sourceSnapshot.rootIdentity),
      projectRevision: sourceSnapshot.revision,
      result: { view: 'project', status: 'passed', report },
    };
  }

  async inspectObject(projectRoot: string, objectRef: string, changeId?: string): Promise<ServiceResult<AuthoringObject>> {
    // 带 --change 时读取事务 workingFiles 的对象（patch 指纹以事务内当前状态为准）。
    const context = changeId === undefined ? undefined : await openChangeContext(changeId);
    const snapshot = context?.snapshot ?? (await this.loadProjectContext(await NodeProjectStorage.open(projectRoot))).snapshot;
    const object = inspectObject(buildObjectIndex(snapshot), objectRef);
    // timeline/track/cue 附当前 SHA-256 指纹，供后续类型化 patch 的 expectedFingerprint 使用。
    if ((object.kind === 'timeline' || object.kind === 'track' || object.kind === 'cue') && object.details !== undefined) {
      object.fingerprint = await timelineFingerprint(object.details, { sha256: async (text) => hashText(text) });
    }
    // Wave 3：character 附角色表指纹；entry-scene 附 entryScene 字段指纹（供 character.ensure/remove 与 entry-scene.set 使用）。
    if (object.kind === 'character') {
      object.fingerprint = await charactersFingerprint(snapshot.config, { sha256: async (text) => hashText(text) });
    }
    if (object.kind === 'entry-scene') {
      object.fingerprint = await entrySceneFingerprint(snapshot.config, { sha256: async (text) => hashText(text) });
    }
    if (context !== undefined) return { ...metadataForChange(context.session), result: object };
    return { projectIdentity: projectIdentityFromRoot(snapshot.rootIdentity), projectRevision: snapshot.revision, result: object };
  }

  async timelineCreate(changeId: string, input: TimelineCreateInput): Promise<ServiceResult<unknown>> {
    return this.withOpenChange(changeId, async (context) => {
      const result = await applyTimelineCreate(context.session, input, { sha256: async (text) => hashText(text) });
      return { ...metadataForChange(context.session), result };
    });
  }

  async timelinePatch(changeId: string, input: TimelinePatchInput): Promise<ServiceResult<unknown>> {
    return this.withOpenChange(changeId, async (context) => {
      const result = await applyTimelinePatch(context.session, input, { sha256: async (text) => hashText(text) });
      return { ...metadataForChange(context.session), result };
    });
  }

  async characterEnsure(changeId: string, input: CharacterEnsureInput): Promise<ServiceResult<unknown>> {
    return this.withOpenChange(changeId, async (context) => {
      const result = await applyCharacterEnsure(context.session, input, { sha256: async (text) => hashText(text) });
      return { ...metadataForChange(context.session), result };
    });
  }

  async characterRemove(changeId: string, input: CharacterRemoveInput): Promise<ServiceResult<unknown>> {
    return this.withOpenChange(changeId, async (context) => {
      const result = await applyCharacterRemove(context.session, input, { sha256: async (text) => hashText(text) });
      return { ...metadataForChange(context.session), result };
    });
  }

  async entrySceneSet(changeId: string, input: EntrySceneSetInput): Promise<ServiceResult<unknown>> {
    return this.withOpenChange(changeId, async (context) => {
      const result = await applyEntrySceneSet(context.session, input, { sha256: async (text) => hashText(text) });
      return { ...metadataForChange(context.session), result };
    });
  }

  // —— Wave 5 composition.*：薄投影；依赖/冲突/plan/replay 计算全部在 CompositionService。 ——

  async compareComposition(projectRoot: string, input: Record<string, unknown>): Promise<ServiceResult<unknown>> {
    const service = await compositionServiceForProject(projectRoot);
    const refs = (input as { candidateRefs: Array<{ changeId: string; capsuleId: string; artifactSha256: string }> }).candidateRefs;
    const raw = await service.compare(refs);
    const comparison = raw.comparison as import('@surdet/authoring').CompositionComparison;
    // 批准任务书的公开安全投影：完整 CompositionComparison 字段集；
    // candidates 仅保留 {candidateId, eligibility}，绝不外泄 manifest / normalizedInput / 路径。
    return {
      projectIdentity: service.projectIdentity,
      projectRevision: comparison.expectedProjectRevision ?? raw.currentProjectRevision ?? 'unknown',
      result: {
        comparisonVersion: comparison.comparisonVersion,
        projectIdentity: comparison.projectIdentity,
        expectedProjectRevision: comparison.expectedProjectRevision,
        status: comparison.status,
        candidates: raw.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          eligibility: candidate.composition.eligibility,
        })),
        units: comparison.units,
        dependencyEdges: comparison.dependencyEdges,
        conflicts: comparison.conflicts,
        identicalGroups: comparison.identicalGroups,
        evidenceMatrix: comparison.evidenceMatrix,
        comparisonFingerprint: comparison.comparisonFingerprint,
      },
    };
  }

  async prepareComparisonReview(
    projectRoot: string,
    input: { candidateRefs: Array<{ changeId: string; capsuleId: string; artifactSha256: string }> },
  ): Promise<ServiceResult<unknown>> {
    const service = await reviewServiceForProject(projectRoot);
    const prepared = await service.prepareComparison(input);
    return {
      projectIdentity: prepared.identity.projectIdentity,
      projectRevision: prepared.identity.expectedProjectRevision,
      result: prepared,
    };
  }

  async inspectReviewDecision(
    projectRoot: string,
    input: { reviewId: string; decisionId?: string },
  ): Promise<ServiceResult<unknown>> {
    const service = await reviewServiceForProject(projectRoot);
    const verified = await service.inspectDecision(input);
    return {
      projectIdentity: verified.receipt.projectIdentity,
      projectRevision: verified.receipt.expectedProjectRevision,
      result: verified,
    };
  }

  async prepareResultReview(
    projectRoot: string,
    input: { planId: string; artifactSha256: string; changeId: string },
  ): Promise<ServiceResult<unknown>> {
    const service = await reviewServiceForProject(projectRoot);
    const prepared = await service.prepareResult(input);
    return {
      projectIdentity: prepared.identity.projectIdentity,
      projectRevision: prepared.identity.expectedProjectRevision,
      result: prepared,
    };
  }

  async inspectApprovalReview(
    projectRoot: string,
    input: { resultReviewId: string; approvalId?: string },
  ): Promise<ServiceResult<unknown>> {
    const service = await reviewServiceForProject(projectRoot);
    const inspected = await service.inspectApproval(input);
    const receipt = inspected.receipt as unknown as Record<string, unknown>;
    return {
      projectIdentity: service.composition.projectIdentity,
      projectRevision: typeof receipt['expectedProjectRevision'] === 'string'
        ? receipt['expectedProjectRevision']
        : 'unknown',
      result: inspected,
    };
  }

  async planComposition(projectRoot: string, input: Record<string, unknown>): Promise<ServiceResult<unknown>> {
    const service = await compositionServiceForProject(projectRoot);
    const hasReviewedDecision = Object.prototype.hasOwnProperty.call(input, 'reviewDecision');
    const hasDirectSelection = Object.prototype.hasOwnProperty.call(input, 'selectedUnitIds');
    if (hasReviewedDecision === hasDirectSelection) {
      throw new AuthoringOperationError('INVALID_REQUEST', 'composition.plan 必须且只能选择 direct 或 reviewed 输入');
    }
    const candidateRefs = input['candidateRefs'] as Parameters<CompositionService['plan']>[0]['candidateRefs'];
    const comparisonFingerprint = input['comparisonFingerprint'] as string;
    const planInput = hasReviewedDecision
      ? await (async () => {
        const decision = input['reviewDecision'] as {
          reviewId: string;
          decisionId: string;
          decisionFingerprint: string;
        };
        const reviewService = await reviewServiceForProject(projectRoot);
        const verified = await reviewService.inspectDecision({
          reviewId: decision.reviewId,
          decisionId: decision.decisionId,
        });
        if (verified.review.decisionFingerprint !== decision.decisionFingerprint) {
          throw new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', 'reviewDecision fingerprint 与已验证决定不一致', {
            reviewId: decision.reviewId,
            decisionId: decision.decisionId,
          });
        }
        return {
          candidateRefs,
          comparisonFingerprint,
          selectedUnitIds: verified.selectedUnitIds,
          conflictResolutions: verified.conflictResolutions,
          review: verified.review,
        };
      })()
      : {
        candidateRefs,
        comparisonFingerprint,
        selectedUnitIds: input['selectedUnitIds'] as string[],
        conflictResolutions: input['conflictResolutions'] as Parameters<CompositionService['plan']>[0]['conflictResolutions'],
        review: { reviewState: 'unreviewed' as const },
      };
    const raw = await service.plan(planInput);
    const sealedPlan = raw.plan as {
      planId: string;
      planFingerprint: string;
      expectedProjectRevision?: string;
      dryRun?: { status?: string };
    };
    // registry output schema 形状：{ planId, planFingerprint, artifactSha256, dryRunStatus }
    return {
      projectIdentity: service.projectIdentity,
      projectRevision: sealedPlan.expectedProjectRevision ?? 'unknown',
      result: {
        planId: sealedPlan.planId,
        planFingerprint: sealedPlan.planFingerprint,
        artifactSha256: raw.identity.sha256,
        dryRunStatus: sealedPlan.dryRun?.status ?? 'failed',
      },
    };
  }

  async inspectComposition(projectRoot: string, input: Record<string, unknown>): Promise<ServiceResult<unknown>> {
    const service = await compositionServiceForProject(projectRoot);
    const outcome = await service.inspect(input as { planId: string; artifactSha256: string });
    return {
      projectIdentity: service.projectIdentity,
      projectRevision: 'unknown',
      result: outcome,
    };
  }

  async executeComposition(projectRoot: string, activeChangeId: string | undefined, input: Record<string, unknown>): Promise<ServiceResult<unknown>> {
    const service = await compositionServiceForProject(projectRoot);
    // session 状态机不变量：已有普通 active change 时拒绝执行（integration resume 由 service 核对）。
    if (activeChangeId !== undefined) {
      const record = await NodeChangeStore.openByChangeId(activeChangeId).then((opened) => opened?.record ?? null);
      if (record !== null && record.integration === undefined) {
        throw new AuthoringOperationError('CHANGE_BUSY', '当前 session 已有普通 active change，不能执行 composition.execute', {
          changeId: activeChangeId,
          retryDisposition: 'after-refresh',
        });
      }
    }
    const outcome = await service.executePlan({
      planId: String(input['planId']),
      artifactSha256: String(input['artifactSha256']),
      executeOperationId: String(input['executeOperationId']),
    });
    return {
      projectIdentity: service.projectIdentity,
      projectRevision: 'unknown',
      result: {
        integrationChangeId: outcome.changeId,
        status: outcome.status,
        nextOperationIndex: outcome.nextOperationIndex,
        operationCount: outcome.replayedOperations.length,
      },
    };
  }

  async begin(projectRoot: string, intent?: ChangeIntentMetadata): Promise<ServiceResult<{ changeId: string; baseRevision: string; workingRevision: number }>> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const { snapshot } = await this.loadProjectContext(storage);
    const store = await NodeChangeStore.forProject(snapshot.rootIdentity);
    const session = await beginChange(snapshot, store, storage, intent);
    return {
      ...metadataForChange(session),
      result: {
        changeId: session.record.changeId,
        baseRevision: session.record.baseRevision,
        workingRevision: session.record.workingRevision,
      },
    };
  }

  async sceneCreate(changeId: string, input: SceneCreateInput): Promise<ServiceResult<unknown>> {
    return this.withOpenChange(changeId, async (context) => {
      const result = await applySceneCreate(context.session, input);
      return { ...metadataForChange(context.session), result };
    });
  }

  async scenePatch(changeId: string, input: ScenePatchInput): Promise<ServiceResult<unknown>> {
    return this.withOpenChange(changeId, async (context) => {
      const result = await applyScenePatch(context.session, input);
      return { ...metadataForChange(context.session), result };
    });
  }

  async variableEnsure(changeId: string, input: VariableEnsureInput): Promise<ServiceResult<unknown>> {
    return this.withOpenChange(changeId, async (context) => {
      const result = await ensureVariable(context.session, input);
      return { ...metadataForChange(context.session), result };
    });
  }

  async validate(changeId: string): Promise<ServiceResult<ReturnType<typeof validateSnapshot> & {
    view: 'working';
    evidenceId: string;
    freshness: ReturnType<typeof evidenceFreshness>;
  }>> {
    return this.withOpenChange(changeId, async (context) => {
      const index = buildObjectIndex(context.snapshot);
      const assetPaths = assetPathsFromFiles(await context.storage.listFiles());
      const assetCatalog = buildAssetCatalog(assetPaths);
      const validation = validateSnapshot(context.snapshot, index, { assetCatalog, timelineReferenceScope: 'complete' });
      const evidence = validationEvidence(context.session.record.baseRevision, changeId, context.session.record.workingRevision, validation);
      await context.store.writeEvidence(changeId, evidence.evidenceId, evidence);
      await recordValidation(context.session, {
        evidenceId: evidence.evidenceId,
        errors: validation.issues.filter((issue) => issue.severity === 'error').length,
      });
      return {
        ...metadataForChange(context.session),
        result: {
          ...validation,
          view: 'working',
          evidenceId: evidence.evidenceId,
          freshness: evidenceFreshness(context.session.record.latestValidation, context.session.record.workingRevision),
        },
      };
    });
  }

  async simulate(changeId: string, input?: { sceneId?: string; seed?: number }): Promise<ServiceResult<ReturnType<typeof simulateSnapshot> & {
    view: 'working';
    report: ReturnType<typeof simulateSnapshot>;
    evidenceId: string;
    freshness: ReturnType<typeof evidenceFreshness>;
  }>> {
    return this.withOpenChange(changeId, async (context) => {
      // 显式场景选择：不依赖 game.config.entryScene，不默认从 ch01_01 启动。
      const sceneId = input?.sceneId;
      let snapshot = context.snapshot;
      if (sceneId !== undefined) {
        if (!snapshot.scenes.some((scene) => scene.id === sceneId)) {
          throw new AuthoringOperationError('PROJECT_NOT_FOUND', `模拟目标场景不存在：${sceneId}`);
        }
        snapshot = { ...snapshot, entryScene: sceneId };
      }
      // simulate 是 runtime verification capability：建立 runtime（含 TimelineRegistry 加载）时
      // 的构造失败在 Service 边界统一归类为 RUNTIME_FAILED，保留文件路径等 root cause——
      // 不依赖 CLI 层对 message 的启发式归类（runTrace 同一模式）。
      let simulation: ReturnType<typeof simulateSnapshot>;
      try {
        simulation = simulateSnapshot(snapshot, { seed: input?.seed });
      } catch (error) {
        if (error instanceof AuthoringOperationError) throw error;
        throw new AuthoringOperationError('RUNTIME_FAILED', error instanceof Error ? error.message : String(error));
      }
      const evidence = simulationEvidence(context.session.record.baseRevision, changeId, context.session.record.workingRevision, simulation);
      await context.store.writeEvidence(changeId, evidence.evidenceId, evidence);
      await recordSimulationEvidence(context.session, { evidenceId: evidence.evidenceId, status: simulation.status });
      if (simulation.status === 'incomplete') throw new AuthoringOperationError('SIMULATION_INCOMPLETE', '项目模拟达到预算上限');
      if (simulation.status === 'failed') {
        // 附首个运行时错误根因，Agent 无需二次取证据即可定位（如缺失时间轴的未注册 ID）。
        const firstError = simulation.runtimeErrors[0]?.message;
        throw new AuthoringOperationError('RUNTIME_FAILED', firstError === undefined ? '项目模拟包含运行时失败' : `项目模拟包含运行时失败：${firstError}`);
      }
      return {
        ...metadataForChange(context.session),
        result: {
          ...simulation,
          view: 'working',
          report: simulation,
          evidenceId: evidence.evidenceId,
          freshness: evidenceFreshness(context.session.record.latestSimulation, context.session.record.workingRevision),
        },
      };
    });
  }

  async runFrom(changeId: string, input: Record<string, unknown>): Promise<ServiceResult<{
    view: 'working';
    traceId: string;
    status: 'passed';
    sceneId: string;
    choices: number[];
    finalVariables: Record<string, VarValue>;
    eventCount: number;
    seed: number;
    freshness: ReturnType<typeof evidenceFreshness>;
  }>> {
    return this.withOpenChange(changeId, async (context) => {
      const sceneId = typeof input['sceneId'] === 'string'
        ? input['sceneId']
        : context.snapshot.entryScene ?? context.snapshot.scenes[0]?.id ?? '';
      if (sceneId.length === 0) throw new AuthoringOperationError('RUNTIME_FAILED', 'runtime.run-from 缺少 sceneId 且项目没有 entryScene');
      let result: Awaited<ReturnType<typeof runExplicitPath>>;
      try {
        result = await runExplicitPath(context.snapshot, {
          sceneId,
          label: typeof input['label'] === 'string' ? input['label'] : undefined,
          variables: typeof input['variables'] === 'object' && input['variables'] !== null && !Array.isArray(input['variables'])
            ? input['variables'] as Record<string, VarValue>
            : undefined,
          choices: Array.isArray(input['choices']) ? input['choices'].filter((value): value is number => typeof value === 'number') : [],
          maxSteps: typeof input['maxSteps'] === 'number' ? input['maxSteps'] : undefined,
          seed: typeof input['seed'] === 'number' ? input['seed'] : undefined,
        });
      } catch (error) {
        throw new AuthoringOperationError('RUNTIME_FAILED', error instanceof Error ? error.message : String(error));
      }
      if (result.status === 'failed') {
        throw new AuthoringOperationError('RUNTIME_FAILED', result.error ?? 'runtime.run-from 包含运行时失败');
      }
      const traceId = newEvidenceId('trace');
      await context.store.writeTrace(changeId, traceId, {
        schemaVersion: 1,
        traceId,
        changeId,
        projectRevision: context.session.record.baseRevision,
        createdAt: new Date().toISOString(),
        seed: result.seed,
        events: result.events,
      });
      await recordRuntimeTrace(context.session, { traceId, status: result.status });
      return {
        ...metadataForChange(context.session),
        result: {
          view: 'working',
          traceId,
          status: result.status,
          sceneId: result.sceneId,
          choices: result.choices,
          finalVariables: result.finalVariables,
          eventCount: result.events.length,
          seed: result.seed,
          freshness: evidenceFreshness(
            context.session.record.runtimeTraces?.find((trace) => trace.traceId === traceId),
            context.session.record.workingRevision,
          ),
        },
      };
    });
  }

  async readTrace(changeId: string, traceId: string, query: TraceQuery = {}): Promise<ServiceResult<{ view: 'working'; traceId: string; events: unknown[]; count: number; seed: number; freshness: ReturnType<typeof evidenceFreshness> }>> {
    const context = await openChangeContext(changeId);
    const value = await context.store.readTrace(changeId, traceId) as { events?: Parameters<typeof normalizeTrace>[0]; seed?: unknown } | null;
    if (value === null || !Array.isArray(value.events)) throw new AuthoringOperationError('PROJECT_NOT_FOUND', `运行轨迹不存在：${traceId}`);
    if (typeof value.seed !== 'number') throw new AuthoringOperationError('PROJECT_NOT_FOUND', `运行轨迹缺少实际 seed：${traceId}`);
    try {
      assertValidRandomSeed(value.seed);
    } catch (error) {
      throw new AuthoringOperationError('PROJECT_INVALID', error instanceof Error ? error.message : String(error));
    }
    const events = queryTrace(normalizeTrace(value.events), query);
    return {
      ...metadataForChange(context.session),
      result: {
        view: 'working',
        traceId,
        events,
        count: events.length,
        seed: value.seed,
        freshness: evidenceFreshness(
          context.session.record.runtimeTraces?.find((trace) => trace.traceId === traceId),
          context.session.record.workingRevision,
        ),
      },
    };
  }

  async diff(changeId: string): Promise<ServiceResult<ReturnType<typeof diffForChange> & { view: 'working'; evidenceId: string; freshness: ReturnType<typeof evidenceFreshness> }>> {
    return this.withOpenChange(changeId, async (context) => {
      const result = diffForChange(context.session);
      await context.store.writeDiff(changeId, result);
      const evidenceId = newEvidenceId('diff');
      await context.store.writeEvidence(changeId, evidenceId, {
        evidenceId,
        capability: 'change.diff',
        projectRevision: context.session.record.baseRevision,
        workingRevision: context.session.record.workingRevision,
        result,
      });
      await recordDiffEvidence(context.session, { evidenceId });
      return {
        ...metadataForChange(context.session),
        result: {
          ...result,
          view: 'working',
          evidenceId,
          freshness: evidenceFreshness(context.session.record.latestDiff, context.session.record.workingRevision),
        },
      };
    });
  }

  async commit(
    changeId: string,
    approvalRef?: ReviewApprovalRef,
  ): Promise<ServiceResult<{ changeId: string; status: 'COMMITTED'; files: string[]; coordination: AgentCommitCoordination }>> {
    const opened = await NodeChangeStore.openByChangeId(changeId);
    if (opened === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
    let verifiedApproval: VerifiedReviewApproval | undefined;
    if (opened.record.integration !== undefined) {
      if (approvalRef === undefined) {
        throw new AuthoringOperationError('REVIEW_APPROVAL_REQUIRED', 'integration change 必须显式提供 approvalRef');
      }
      const reviewService = await reviewServiceForProject(opened.record.projectRootIdentity);
      const inspected = await reviewService.inspectApproval(approvalRef);
      if (!('bindingFingerprint' in inspected)) {
        throw new AuthoringOperationError('REVIEW_RETURNED', 'result review 已被项目所有者退回，不能继续 commit');
      }
      verifiedApproval = inspected;
    }
    return this.withOpenChange(changeId, async (context) => {
      return withProjectLeaseRetry(this.leaseManager, context.session.record.projectRootIdentity, async (projectLease) => {
        await assertHumanWorkspaceAllowsAgentCommit(this.humanWorkspaceStore, context.storage.rootIdentity);
        const freshProject = await loadSnapshot(context.storage);
        await assertBaseStillMatches(context.session, freshProject);
        if (verifiedApproval !== undefined) {
          await bindVerifiedApproval(context.session, verifiedApproval);
        }
        const rebound = await context.store.read(changeId);
        if (rebound === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
        const reboundSession = openChange(rebound, context.store, context.storage);
        const result = await commitChange(reboundSession, context.storage);
        let projectRevision = context.snapshot.revision;
        let coordination: AgentCommitCoordination;
        try {
          const baseline = await loadProjectCoordinationBaseline(context.storage);
          projectRevision = baseline.projectRevision;
          const notice = await this.mutationNoticeStore.record(context.storage.rootIdentity, {
            projectRevision,
            coordinationRevision: baseline.coordinationRevision,
            initiator: 'external-agent',
            changedPaths: result.files,
            changeId,
          }, () => this.leaseManager.assertOwned(projectLease));
          coordination = { status: 'written', mutationSequence: notice.sequence };
        } catch {
          coordination = {
            status: 'warning',
            reason: 'coordination-unavailable',
            message: '项目已提交，协调通知暂不可用；请重新读取项目。',
          };
        }
        return { ...metadataForChange(reboundSession, projectRevision), result: { ...result, coordination } };
      });
    });
  }

  async rollback(changeId: string): Promise<ServiceResult<{ changeId: string; status: 'ROLLED_BACK' }>> {
    // Rollback is the recovery escape hatch for an OPEN change. It must not
    // parse workingFiles: a poisoned snapshot is precisely what rollback must
    // be able to clear without evaluating.
    const rollbackWithStore = async (store: NodeChangeStore): Promise<ServiceResult<{ changeId: string; status: 'ROLLED_BACK' }>> => {
      const record = await store.read(changeId);
      if (record === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
      const session = openChange(record, store);
      const rolledBack = await rollbackChange(session);
      return { ...metadataForChange(session), result: { changeId: rolledBack.changeId, status: 'ROLLED_BACK' } };
    };
    return this.leasedStore === undefined
      ? withChangeLeaseRetry(changeId, rollbackWithStore)
      : rollbackWithStore(this.leasedStore);
  }

  async inspectRecovery(changeId: string): Promise<ServiceResult<RecoveryInspection>> {
    const discovered = await NodeChangeStore.openByChangeId(changeId);
    if (discovered === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
    const projectRootIdentity = discovered.record.projectRootIdentity;
    const changeLease = await this.leaseManager.inspect('change', changeId);
    const projectLease = await this.leaseManager.inspect('project', projectRootIdentity);
    const observedLock = changeLease.state !== 'free' ? changeLease : projectLease;
    if (observedLock.state !== 'free') {
      const opened = await NodeChangeStore.openForProject(changeId, projectRootIdentity, { allowTerminal: true, allowStale: true });
      if (opened === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
      return inspectRecoveryFromStore(changeId, opened.store, recoveryLockState(observedLock.state));
    }

    try {
      return await NodeChangeStore.withChangeLeaseForProject(
        changeId,
        projectRootIdentity,
        async (leasedStore) => withProjectLeaseRetry(this.leaseManager, projectRootIdentity, async () => (
          inspectRecoveryFromStore(changeId, leasedStore, 'free')
        )),
        { allowTerminal: true, allowStale: true, leaseManager: this.leaseManager },
      );
    } catch (error) {
      if (error instanceof AuthoringOperationError
        && (error.code === 'CHANGE_BUSY' || error.code === 'PROJECT_BUSY' || error.code === 'LEASE_CORRUPT')) {
        const latestChangeLease = await this.leaseManager.inspect('change', changeId);
        const latestProjectLease = await this.leaseManager.inspect('project', projectRootIdentity);
        const latest = latestChangeLease.state !== 'free' ? latestChangeLease : latestProjectLease;
        const opened = await NodeChangeStore.openForProject(changeId, projectRootIdentity, { allowTerminal: true, allowStale: true });
        if (opened === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
        return inspectRecoveryFromStore(changeId, opened.store, recoveryLockState(latest.state));
      }
      throw error;
    }
  }

  async executeRecovery(
    changeId: string,
    input: { operationId: string; recoveryToken: string },
  ): Promise<ServiceResult<{ changeId: string; status: 'OPEN' | 'COMMITTED'; disposition: string }>> {
    const discovered = await NodeChangeStore.openByChangeId(changeId);
    if (discovered === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
    const projectRootIdentity = discovered.record.projectRootIdentity;
    return NodeChangeStore.withChangeLeaseForProject(
      changeId,
      projectRootIdentity,
      async (leasedStore) => withProjectLeaseRetry(this.leaseManager, projectRootIdentity, async () => {
        // Recovery never reuses inspect's object graph: both record and journal
        // are read after the change -> project locks are held.
        const opened = await NodeChangeStore.openForProject(changeId, projectRootIdentity, { allowTerminal: true, allowStale: true });
        if (opened === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
        const record = await leasedStore.read(changeId);
        if (record === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
        const journal = await leasedStore.readLatestJournal(changeId);
        const storage = await NodeProjectStorage.open(record.projectRootIdentity);
        if (storage.rootIdentity !== record.projectRootIdentity) {
          throw new AuthoringOperationError('PROJECT_CHANGED_SINCE_BEGIN', '项目根目录身份已变化', {
            expected: record.projectRootIdentity,
            actual: storage.rootIdentity,
          });
        }
        const inspection = await inspectTransactionRecovery({
          record,
          journal,
          storage,
          leaseState: 'free',
          sha256: async (value) => hashText(value),
        });
        if (journal === null) {
          if (inspection.disposition === 'NO_ACTION') {
            throw new AuthoringOperationError('RECOVERY_NOT_REQUIRED', `变更事务 '${changeId}' 不需要恢复`);
          }
          throw new AuthoringOperationError('RECOVERY_AMBIGUOUS', `变更事务 '${changeId}' 没有可验证的 journal`);
        }
        if (record.operations[input.operationId] === undefined && inspection.recoveryToken !== input.recoveryToken) {
          throw new AuthoringOperationError('RECOVERY_PLAN_STALE', '恢复计划 token 与当前 record/journal/project 事实不匹配', {
            changeId,
            recoveryToken: input.recoveryToken,
          });
        }
        if (record.operations[input.operationId] === undefined) await assertRecoveryBaseRevision(storage, journal, inspection);
        if (record.operations[input.operationId] === undefined) await assertRecoveryStageIdentities(storage, journal);
        const session = openChange(record, leasedStore, storage);
        const result = await executeTransactionRecovery({
          change: session,
          journal,
          storage,
          inspection,
          recoveryToken: input.recoveryToken,
          operationId: input.operationId,
        });
        if (result.disposition === 'ROLL_BACK_TO_BASE') {
          for (const entry of journal.files) await storage.removeStage(entry.stagedIdentity).catch(() => undefined);
        }
        const projectSnapshot = await loadSnapshot(storage);
        return {
          ...metadataForChange(session, projectSnapshot.revision),
          result,
        };
      }),
      { allowTerminal: true, allowStale: true, leaseManager: this.leaseManager },
    );
  }
}
