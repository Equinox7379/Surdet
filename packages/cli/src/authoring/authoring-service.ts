import * as crypto from 'node:crypto';
import {
  EventBus,
  Interpreter,
  SceneRegistry,
  VariableStore,
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
  beginChange,
  buildAssetCatalog,
  buildObjectIndex,
  buildOperationLedgerDiff,
  commitChange,
  createChangeDiff,
  createEvidenceEnvelope,
  ensureVariable,
  inspectObject,
  inspectProject,
  normalizeTrace,
  openChange,
  applySceneCreate,
  applyScenePatch,
  queryTrace,
  recordValidation,
  rollbackChange,
  simulateSnapshot,
  timelineFingerprint,
  validateSnapshot,
  loadProjectSnapshot,
  type AuthoringObject,
  type ChangeSession,
  type CharacterEnsureInput,
  type CharacterRemoveInput,
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

export const AUTHORING_CAPABILITIES = [
  'capabilities.describe',
  'project.inspect',
  'project.assets',
  'object.inspect',
  'change.begin',
  'scene.create',
  'scene.patch',
  'variable.ensure',
  'character.ensure',
  'character.remove',
  'timeline.create',
  'timeline.patch',
  'project.entry-scene.set',
  'project.validate',
  'project.simulate',
  'runtime.run-from',
  'runtime.read-trace',
  'change.diff',
  'change.commit',
  'change.rollback',
] as const;

export interface ServiceMetadata {
  projectRevision: string;
  changeId?: string;
  workingRevision?: number;
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

async function openChangeContext(changeId: string): Promise<{
  store: NodeChangeStore;
  session: ChangeSession;
  storage: NodeProjectStorage;
  snapshot: ProjectSnapshot;
}> {
  const opened = await NodeChangeStore.openByChangeId(changeId);
  if (opened === null) throw new AuthoringOperationError('CHANGE_NOT_FOUND', `变更事务不存在：${changeId}`);
  const storage = await NodeProjectStorage.open(opened.record.projectRootIdentity);
  if (storage.rootIdentity !== opened.record.projectRootIdentity) {
    throw new AuthoringOperationError('PROJECT_CHANGED_SINCE_BEGIN', '项目根目录身份已变化');
  }
  const session = openChange(opened.record, opened.store, storage);
  const snapshot = await loadSnapshot(new WorkingProjectStorage(session.record));
  return { store: opened.store, session, storage, snapshot };
}

function metadataForChange(session: ChangeSession, projectRevision = session.record.baseRevision): ServiceMetadata {
  return {
    projectRevision,
    changeId: session.record.changeId,
    workingRevision: session.record.workingRevision,
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
  seed?: number;
}> {
  const sceneId = input.sceneId ?? snapshot.entryScene ?? snapshot.scenes[0]?.id ?? '';
  if (sceneId.length === 0) throw new AuthoringOperationError('RUNTIME_FAILED', 'runtime.run-from 缺少 sceneId 且项目没有 entryScene');
  const choices = input.choices ?? [];
  const store = new VariableStore(declarations(snapshot));
  for (const [name, value] of Object.entries(input.variables ?? {})) store.set(name, value);
  const registry = new SceneRegistry();
  for (const scene of snapshot.scenes) registry.register(scene.compiled);
  const events: RuntimeTraceEvent[] = [];
  const bus = new EventBus<CoreEventMap>();
  bus.on('runtimeTrace', (event) => events.push(event));
  const interpreter = new Interpreter(store, bus, registry);
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
    ...(input.seed === undefined ? {} : { seed: input.seed }),
  };
}

export class AuthoringService {
  async describeCapabilities(): Promise<ServiceResult<{ capabilities: string[] }>> {
    return { projectRevision: 'unbound', result: { capabilities: [...AUTHORING_CAPABILITIES] } };
  }

  async inspectProject(projectRoot: string): Promise<ServiceResult<ReturnType<typeof inspectProject>>> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const snapshot = await loadSnapshot(storage);
    const index = buildObjectIndex(snapshot);
    const assetPaths = assetPathsFromFiles(await storage.listFiles());
    return { projectRevision: snapshot.revision, result: inspectProject(snapshot, index, assetPaths) };
  }

  async projectAssets(projectRoot: string): Promise<ServiceResult<{ backgrounds: unknown[]; portraits: unknown[] }>> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const snapshot = await loadSnapshot(storage);
    const assetPaths = assetPathsFromFiles(await storage.listFiles());
    return {
      projectRevision: snapshot.revision,
      result: buildAssetCatalog(assetPaths),
    };
  }

  async inspectObject(projectRoot: string, objectRef: string, changeId?: string): Promise<ServiceResult<AuthoringObject>> {
    // 带 --change 时读取事务 workingFiles 的对象（patch 指纹以事务内当前状态为准）。
    const snapshot = changeId === undefined
      ? await loadSnapshot(await NodeProjectStorage.open(projectRoot))
      : (await openChangeContext(changeId)).snapshot;
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
    return { projectRevision: snapshot.revision, result: object };
  }

  async timelineCreate(changeId: string, input: TimelineCreateInput): Promise<ServiceResult<unknown>> {
    const context = await openChangeContext(changeId);
    const result = await applyTimelineCreate(context.session, input, { sha256: async (text) => hashText(text) });
    return { ...metadataForChange(context.session), result };
  }

  async timelinePatch(changeId: string, input: TimelinePatchInput): Promise<ServiceResult<unknown>> {
    const context = await openChangeContext(changeId);
    const result = await applyTimelinePatch(context.session, input, { sha256: async (text) => hashText(text) });
    return { ...metadataForChange(context.session), result };
  }

  async characterEnsure(changeId: string, input: CharacterEnsureInput): Promise<ServiceResult<unknown>> {
    const context = await openChangeContext(changeId);
    const result = await applyCharacterEnsure(context.session, input, { sha256: async (text) => hashText(text) });
    return { ...metadataForChange(context.session), result };
  }

  async characterRemove(changeId: string, input: CharacterRemoveInput): Promise<ServiceResult<unknown>> {
    const context = await openChangeContext(changeId);
    const result = await applyCharacterRemove(context.session, input, { sha256: async (text) => hashText(text) });
    return { ...metadataForChange(context.session), result };
  }

  async entrySceneSet(changeId: string, input: EntrySceneSetInput): Promise<ServiceResult<unknown>> {
    const context = await openChangeContext(changeId);
    const result = await applyEntrySceneSet(context.session, input, { sha256: async (text) => hashText(text) });
    return { ...metadataForChange(context.session), result };
  }

  async begin(projectRoot: string): Promise<ServiceResult<{ changeId: string; baseRevision: string; workingRevision: number }>> {
    const storage = await NodeProjectStorage.open(projectRoot);
    const snapshot = await loadSnapshot(storage);
    const store = await NodeChangeStore.forProject(snapshot.rootIdentity);
    const session = await beginChange(snapshot, store, storage);
    return {
      ...metadataForChange(session, snapshot.revision),
      result: {
        changeId: session.record.changeId,
        baseRevision: session.record.baseRevision,
        workingRevision: session.record.workingRevision,
      },
    };
  }

  async sceneCreate(changeId: string, input: SceneCreateInput): Promise<ServiceResult<unknown>> {
    const context = await openChangeContext(changeId);
    const result = await applySceneCreate(context.session, input);
    return { ...metadataForChange(context.session), result };
  }

  async scenePatch(changeId: string, input: ScenePatchInput): Promise<ServiceResult<unknown>> {
    const context = await openChangeContext(changeId);
    const result = await applyScenePatch(context.session, input);
    return { ...metadataForChange(context.session), result };
  }

  async variableEnsure(changeId: string, input: VariableEnsureInput): Promise<ServiceResult<unknown>> {
    const context = await openChangeContext(changeId);
    const result = await ensureVariable(context.session, input);
    return { ...metadataForChange(context.session), result };
  }

  async validate(changeId: string): Promise<ServiceResult<ReturnType<typeof validateSnapshot> & { evidenceId: string }>> {
    const context = await openChangeContext(changeId);
    const index = buildObjectIndex(context.snapshot);
    const assetPaths = assetPathsFromFiles(await context.storage.listFiles());
    const assetCatalog = buildAssetCatalog(assetPaths);
    const validation = validateSnapshot(context.snapshot, index, { assetCatalog });
    const evidence = validationEvidence(context.snapshot.revision, changeId, context.session.record.workingRevision, validation);
    await context.store.writeEvidence(changeId, evidence.evidenceId, evidence);
    await recordValidation(context.session, {
      evidenceId: evidence.evidenceId,
      errors: validation.issues.filter((issue) => issue.severity === 'error').length,
    });
    return {
      ...metadataForChange(context.session, context.snapshot.revision),
      result: { ...validation, evidenceId: evidence.evidenceId },
    };
  }

  async simulate(changeId: string, input?: { sceneId?: string }): Promise<ServiceResult<ReturnType<typeof simulateSnapshot>>> {
    const context = await openChangeContext(changeId);
    // 显式场景选择：不依赖 game.config.entryScene，不默认从 ch01_01 启动。
    const sceneId = input?.sceneId;
    let snapshot = context.snapshot;
    if (sceneId !== undefined) {
      if (!snapshot.scenes.some((scene) => scene.id === sceneId)) {
        throw new AuthoringOperationError('PROJECT_NOT_FOUND', `模拟目标场景不存在：${sceneId}`);
      }
      snapshot = { ...snapshot, entryScene: sceneId };
    }
    const simulation = simulateSnapshot(snapshot);
    const evidence = simulationEvidence(context.snapshot.revision, changeId, context.session.record.workingRevision, simulation);
    await context.store.writeEvidence(changeId, evidence.evidenceId, evidence);
    if (simulation.status === 'incomplete') throw new AuthoringOperationError('SIMULATION_INCOMPLETE', '项目模拟达到预算上限');
    if (simulation.status === 'failed') throw new AuthoringOperationError('RUNTIME_FAILED', '项目模拟包含运行时失败');
    return { ...metadataForChange(context.session, context.snapshot.revision), result: simulation };
  }

  async runFrom(changeId: string, input: Record<string, unknown>): Promise<ServiceResult<{ traceId: string; status: 'passed'; sceneId: string; choices: number[]; finalVariables: Record<string, VarValue>; eventCount: number }>> {
    const context = await openChangeContext(changeId);
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
      projectRevision: context.snapshot.revision,
      createdAt: new Date().toISOString(),
      events: result.events,
    });
    return {
      ...metadataForChange(context.session, context.snapshot.revision),
      result: {
        traceId,
        status: result.status,
        sceneId: result.sceneId,
        choices: result.choices,
        finalVariables: result.finalVariables,
        eventCount: result.events.length,
      },
    };
  }

  async readTrace(changeId: string, traceId: string, query: TraceQuery = {}): Promise<ServiceResult<{ traceId: string; events: unknown[]; count: number }>> {
    const context = await openChangeContext(changeId);
    const value = await context.store.readTrace(changeId, traceId) as { events?: Parameters<typeof normalizeTrace>[0] } | null;
    if (value === null || !Array.isArray(value.events)) throw new AuthoringOperationError('PROJECT_NOT_FOUND', `运行轨迹不存在：${traceId}`);
    const events = queryTrace(normalizeTrace(value.events), query);
    return {
      ...metadataForChange(context.session, context.snapshot.revision),
      result: { traceId, events, count: events.length },
    };
  }

  async diff(changeId: string): Promise<ServiceResult<ReturnType<typeof diffForChange>>> {
    const context = await openChangeContext(changeId);
    const result = diffForChange(context.session);
    await context.store.writeDiff(changeId, result);
    return { ...metadataForChange(context.session), result };
  }

  async commit(changeId: string): Promise<ServiceResult<{ changeId: string; status: 'COMMITTED'; files: string[] }>> {
    const context = await openChangeContext(changeId);
    const result = await commitChange(context.session, context.storage);
    const snapshot = await loadSnapshot(context.storage);
    return { ...metadataForChange(context.session, snapshot.revision), result };
  }

  async rollback(changeId: string): Promise<ServiceResult<{ changeId: string; status: 'ROLLED_BACK' }>> {
    const context = await openChangeContext(changeId);
    const record = await rollbackChange(context.session);
    return { ...metadataForChange(context.session), result: { changeId: record.changeId, status: 'ROLLED_BACK' } };
  }
}
