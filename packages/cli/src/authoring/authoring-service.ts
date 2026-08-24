import * as crypto from 'node:crypto';
import {
  EventBus,
  Interpreter,
  SceneRegistry,
  VariableStore,
  assertValidRandomSeed,
  createSeededRandomSource,
  type CoreEventMap,
  type VarDeclaration,
  type VarValue,
} from '@surdet/core';
import {
  applyCharacterEnsure,
  applyCharacterRemove,
  applyEntrySceneSet,
  applyTimelineCreate,
  charactersFingerprint,
  entrySceneFingerprint,
  applyTimelinePatch,
  assetPathsFromFiles,
  AuthoringOperationError,
  AUTHORING_CAPABILITY_REGISTRY,
  AUTHORING_CONTRACT_VERSION,
  beginChange,
  buildAssetCatalog,
  buildObjectIndex,
  buildOperationLedgerDiff,
  buildTimelineRegistry,
  commitChange,
  createChangeDiff,
  createEvidenceEnvelope,
  DEFAULT_AUTHORING_EVIDENCE_SEED,
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
  simulateSnapshot,
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
  type ProjectStorage,
  type ProjectWriteStorage,
  type RuntimeTraceEvent,
  type SceneCreateInput,
  type ScenePatchInput,
  type TimelineCreateInput,
  type TimelinePatchInput,
  type TraceQuery,
  type VariableEnsureInput,
} from '@surdet/authoring';
import { NodeChangeStore } from './node-change-store.js';
import { NodeProjectStorage } from './node-project-storage.js';
import { projectIdentityFromRoot } from './project-identity.js';

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

class WorkingProjectStorage implements ProjectStorage {
  readonly rootIdentity: string;

  constructor(private readonly record: ChangeSession['record']) {
    this.rootIdentity = record.projectRootIdentity;
  }

  async listFiles(): Promise<string[]> {
    return Object.keys(this.record.workingFiles).sort((a, b) => a.localeCompare(b));
  }

  async readText(filePath: string): Promise<ProjectFile> {
    const text = this.record.workingFiles[filePath];
    if (text === undefined) throw new AuthoringOperationError('PROJECT_NOT_FOUND', `事务文件不存在：${filePath}`);
    const bytes = Buffer.byteLength(text, 'utf8');
    return {
      path: filePath,
      text,
      bytes,
      sha256: crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
    };
  }

  async exists(filePath: string): Promise<boolean> {
    return Object.prototype.hasOwnProperty.call(this.record.workingFiles, filePath);
  }
}

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

function declarations(snapshot: ProjectSnapshot): VarDeclaration[] {
  const result: VarDeclaration[] = [];
  for (const [name, value] of Object.entries(snapshot.variables)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    const raw = value as Record<string, unknown>;
    if (typeof raw['type'] !== 'string' || !('initial' in raw)) continue;
    result.push({
      ...raw,
      name,
      type: raw['type'] as VarDeclaration['type'],
      initial: raw['initial'] as VarValue,
    });
  }
  return result;
}

function loadSnapshot(storage: ProjectStorage): Promise<ProjectSnapshot> {
  return loadProjectSnapshot(storage, {
    sha256: async (text) => hashText(text),
  });
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
  const snapshot = await loadSnapshot(new WorkingProjectStorage(session.record));
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
    const snapshot = await loadSnapshot(new WorkingProjectStorage(session.record));
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

async function runTrace(snapshot: ProjectSnapshot, input: {
  sceneId?: string;
  label?: string;
  variables?: Record<string, VarValue>;
  choices?: number[];
  maxSteps?: number;
  seed?: number;
}): Promise<{
  status: 'passed';
  sceneId: string;
  choices: number[];
  finalVariables: Record<string, VarValue>;
  events: RuntimeTraceEvent[];
  seed: number;
}> {
  const sceneId = input.sceneId ?? snapshot.entryScene ?? snapshot.scenes[0]?.id ?? '';
  if (sceneId.length === 0) throw new AuthoringOperationError('RUNTIME_FAILED', 'runtime.run-from 缺少 sceneId 且项目没有 entryScene');
  const seed = input.seed ?? DEFAULT_AUTHORING_EVIDENCE_SEED;
  try {
    assertValidRandomSeed(seed);
  } catch (error) {
    throw new AuthoringOperationError('RUNTIME_FAILED', error instanceof Error ? error.message : String(error));
  }
  const choices = input.choices ?? [];
  const store = new VariableStore(declarations(snapshot));
  for (const [name, value] of Object.entries(input.variables ?? {})) store.set(name, value);
  const registry = new SceneRegistry();
  for (const scene of snapshot.scenes) registry.register(scene.compiled);
  const events: RuntimeTraceEvent[] = [];
  const bus = new EventBus<CoreEventMap>();
  bus.on('runtimeTrace', (event) => events.push(event));
  // 与共享 simulateSnapshot / Editor Preview 同一 timeline runtime truth：注入项目真实
  // TimelineRegistry（非法 timeline 在验证通道 fail-loud，映射为 RUNTIME_FAILED 结构化错误）。
  let timelines: ReturnType<typeof buildTimelineRegistry>;
  try {
    timelines = buildTimelineRegistry(snapshot);
  } catch (error) {
    throw new AuthoringOperationError('RUNTIME_FAILED', error instanceof Error ? error.message : String(error));
  }
  const interpreter = new Interpreter(store, bus, registry, undefined, undefined, {}, undefined, null, timelines);
  interpreter.setRandomSource(createSeededRandomSource(seed));
  let choiceCursor = 0;
  let latestChoices: { index: number; label: string }[] = [];
  bus.on('choice', (event) => { latestChoices = event.options; });
  const maxSteps = input.maxSteps ?? 20_000;
  try {
    interpreter.start(sceneId, input.label);
    let steps = 0;
    while (interpreter.status !== 'ended' && interpreter.status !== 'idle') {
      if (++steps > maxSteps) throw new Error(`单路径步数超过 ${maxSteps}，疑似死循环`);
      if (interpreter.status === 'awaiting-advance') interpreter.advance();
      else if (interpreter.status === 'awaiting-timer') interpreter.finishWait();
      else if (interpreter.status === 'awaiting-choice') {
        const index = choices[choiceCursor++];
        if (index === undefined) throw new Error('显式路径在 choice 处缺少选择，不得猜测选项');
        if (!latestChoices.some((option) => option.index === index)) throw new Error(`显式路径选择 ${index} 当前不可用`);
        interpreter.choose(index);
      } else throw new Error(`意外运行状态：${interpreter.status}`);
    }
  } catch (error) {
    throw new AuthoringOperationError('RUNTIME_FAILED', error instanceof Error ? error.message : String(error));
  }
  return {
    status: 'passed',
    sceneId,
    choices: choices.slice(0, choiceCursor),
    finalVariables: store.snapshot(),
    events: normalizeTrace(events),
    seed,
  };
}

export class AuthoringService {
  constructor(private readonly leasedStore?: NodeChangeStore) {}

  withLeasedStore(leasedStore: NodeChangeStore): AuthoringService {
    return new AuthoringService(leasedStore);
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
    const snapshot = await loadSnapshot(storage);
    const index = buildObjectIndex(snapshot);
    const assetPaths = assetPathsFromFiles(await storage.listFiles());
    return { projectIdentity: projectIdentityFromRoot(snapshot.rootIdentity), projectRevision: snapshot.revision, result: inspectProject(snapshot, index, assetPaths) };
  }

  async projectAssets(projectRoot: string): Promise<ServiceResult<ReturnType<typeof buildAssetCatalog>>> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const snapshot = await loadSnapshot(storage);
    const assetPaths = assetPathsFromFiles(await storage.listFiles());
    return {
      projectIdentity: projectIdentityFromRoot(snapshot.rootIdentity),
      projectRevision: snapshot.revision,
      result: buildAssetCatalog(assetPaths),
    };
  }

  async validateProject(projectRoot: string): Promise<ServiceResult<{
    view: 'project';
    ok: boolean;
    issues: unknown[];
  }>> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const snapshot = await loadSnapshot(storage);
    const index = buildObjectIndex(snapshot);
    const assetCatalog = buildAssetCatalog(assetPathsFromFiles(await storage.listFiles()));
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
    const sourceSnapshot = await loadSnapshot(storage);
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
    const snapshot = context?.snapshot ?? await loadSnapshot(await NodeProjectStorage.open(projectRoot));
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

  async begin(projectRoot: string, intent?: ChangeIntentMetadata): Promise<ServiceResult<{ changeId: string; baseRevision: string; workingRevision: number }>> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const snapshot = await loadSnapshot(storage);
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
      const result = await runTrace(context.snapshot, {
        sceneId: typeof input['sceneId'] === 'string' ? input['sceneId'] : undefined,
        label: typeof input['label'] === 'string' ? input['label'] : undefined,
        variables: typeof input['variables'] === 'object' && input['variables'] !== null && !Array.isArray(input['variables'])
          ? input['variables'] as Record<string, VarValue>
          : undefined,
        choices: Array.isArray(input['choices']) ? input['choices'].filter((value): value is number => typeof value === 'number') : [],
        maxSteps: typeof input['maxSteps'] === 'number' ? input['maxSteps'] : undefined,
        seed: typeof input['seed'] === 'number' ? input['seed'] : undefined,
      });
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

  async commit(changeId: string): Promise<ServiceResult<{ changeId: string; status: 'COMMITTED'; files: string[] }>> {
    return this.withOpenChange(changeId, async (context) => {
      const result = await commitChange(context.session, context.storage);
      const snapshot = await loadSnapshot(context.storage);
      return { ...metadataForChange(context.session, snapshot.revision), result };
    });
  }

  async rollback(changeId: string): Promise<ServiceResult<{ changeId: string; status: 'ROLLED_BACK' }>> {
    // Rollback is the recovery escape hatch for an OPEN change. It must not
    // parse workingFiles: a poisoned snapshot is precisely what rollback must
    // be able to clear without evaluating.
    return this.withOpenChange(changeId, async (context) => {
      const record = await rollbackChange(context.session);
      return { ...metadataForChange(context.session), result: { changeId: record.changeId, status: 'ROLLED_BACK' } };
    });
  }
}
