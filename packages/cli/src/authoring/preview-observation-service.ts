import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {
  AuthoringOperationError, buildObjectIndex, isPreviewAssetPath, isPreviewSourcePath, loadProjectSnapshot,
  locateObjectForTraceEvent, normalizePreviewTraceMessage, parsePreviewPublishInput,
  PREVIEW_MAX_EVENTS, previewSourceText, stableStringify,
  type PreviewObservation, type PreviewPublishInput, type PreviewPublishAck, type PreviewReadInput,
  type PreviewReadResult, type PreviewSourceFacts, type ProjectStorage, type PreviewContentTarget,
} from '@surdet/authoring';
import { HumanWorkspaceStore, type HumanWorkspaceRecord } from './human-workspace-store.js';
import { NodeLocalLeaseManager } from './node-local-lease.js';
import { NodeProjectStorage } from './node-project-storage.js';
import { loadProjectCoordinationBaseline } from './project-coordination-baseline.js';
import { projectIdentityFromRoot } from './project-identity.js';
import { createJsonRecord, readJsonRecord, replaceJsonRecord } from './node-json-record.js';
import { PreviewContentService } from './preview-content-service.js';

interface StoredPreview {
  formatVersion: 1; projectIdentity: string; workspaceSessionId: string; browserSessionId: string;
  workspaceGeneration: number; previewGeneration: number; invalidated: string | null;
  assetPaths: string[]; observation: PreviewObservation | null;
}
function hash(text: string): string { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }
function failure(code: string, message: string): never { throw new AuthoringOperationError(code, message); }
function canonicalFacts(source: PreviewSourceFacts): string {
  return stableStringify({ files: [...source.files].sort((a, b) => a.path.localeCompare(b.path)),
    assets: [...source.assets].sort((a, b) => a.path.localeCompare(b.path)) });
}

/** Persists actual bound-Editor messages; never executes Core or writes project content. */
export class PreviewObservationService {
  private readonly workspaces: HumanWorkspaceStore;
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly contents: PreviewContentService;
  constructor(private readonly dataRoot = new NodeLocalLeaseManager().dataRoot, workspaceStore?: HumanWorkspaceStore) {
    this.workspaces = workspaceStore ?? new HumanWorkspaceStore({ dataRoot });
    this.contents = new PreviewContentService(dataRoot);
  }
  private file(root: string, sessionId: string): string {
    if (!/^[0-9a-f-]{36}$/.test(sessionId)) return failure('INVALID_REQUEST', '预览 workspace 身份无效');
    return path.join(this.dataRoot, 'preview-observations', projectIdentityFromRoot(root), `${sessionId}.json`);
  }
  private async readStored(root: string, sessionId: string): Promise<StoredPreview | null> {
    let loaded: Awaited<ReturnType<typeof readJsonRecord<StoredPreview>>>;
    try { loaded = await readJsonRecord<StoredPreview>(this.file(root, sessionId)); }
    catch (error) {
      if (error instanceof AuthoringOperationError && error.code === 'CHANGE_STORE_CORRUPT') {
        return failure('PREVIEW_OBSERVATION_CORRUPT', '预览持久记录无法核对，原记录已保留');
      }
      throw error;
    }
    if (loaded === null) return null;
    const record = loaded.value;
    if (!record || record.formatVersion !== 1 || record.projectIdentity !== projectIdentityFromRoot(root)
      || record.workspaceSessionId !== sessionId || !Number.isSafeInteger(record.previewGeneration)
      || !Number.isSafeInteger(record.workspaceGeneration) || typeof record.browserSessionId !== 'string'
      || !Array.isArray(record.assetPaths) || record.assetPaths.some(value => typeof value !== 'string')
      || (record.invalidated !== null && typeof record.invalidated !== 'string')) return failure('PREVIEW_OBSERVATION_CORRUPT', '预览记录身份或格式无法核对');
    const observed = record.observation;
    if (observed !== null) {
      if (!observed || observed.workspaceSessionId !== sessionId || observed.projectIdentity !== record.projectIdentity
        || observed.previewGeneration !== record.previewGeneration || !Array.isArray(observed.events)
        || observed.events.length > PREVIEW_MAX_EVENTS || !['starting', 'running', 'passed', 'failed'].includes(observed.state)
        || (observed.runtimeGeneration !== null && (!Number.isSafeInteger(observed.runtimeGeneration) || observed.runtimeGeneration < 0))
        || (observed.runtimeGeneration === null && (observed.state !== 'starting' || observed.events.length !== 0))
        || !Number.isFinite(Date.parse(observed.startedAt)) || !Number.isFinite(Date.parse(observed.updatedAt))) return failure('PREVIEW_OBSERVATION_CORRUPT', '预览观察记录无法核对');
      try {
        parsePreviewPublishInput({ action: 'begin', previewId: observed.previewId, previewGeneration: observed.previewGeneration,
          sceneId: observed.sceneId, ...(observed.label === undefined ? {} : { label: observed.label }),
          expectedProjectRevision: observed.projectRevision, expectedCoordinationRevision: observed.coordinationRevision, source: observed.source,
          ...(observed.seed === undefined ? {} : { seed: observed.seed }),
          ...(observed.content === undefined ? {} : { content: observed.content }) });
      } catch { return failure('PREVIEW_OBSERVATION_CORRUPT', '预览来源记录无法核对'); }
      for (const [sequence, event] of observed.events.entries()) {
        if (normalizePreviewTraceMessage(event)?.type !== 'surdet-preview-trace-event' || event.sequence !== sequence
          || event.traceId !== observed.previewId || event.generation !== observed.runtimeGeneration
          || (event.objectRef !== null && typeof event.objectRef !== 'string')) return failure('PREVIEW_OBSERVATION_CORRUPT', '预览事件记录无法核对');
      }
    }
    return record;
  }
  private async currentWorkspace(root: string, sessionId: string, browserId?: string): Promise<HumanWorkspaceRecord> {
    const inspected = await this.workspaces.inspect(root);
    const live = inspected.observations.find(value => value.workspaceSessionId === sessionId && value.connection === 'active');
    const workspace = await this.workspaces.readSession(root, sessionId);
    if (!live || !workspace || (browserId !== undefined && workspace.browserSessionId !== browserId)) {
      return failure('PREVIEW_OBSERVATION_UNAVAILABLE', '预览工作区连接已失效，请从当前绑定项目重新播放');
    }
    return workspace;
  }
  private available(workspace: HumanWorkspaceRecord, target?: PreviewContentTarget): boolean {
    return workspace.availability === 'clean' || (target !== undefined && target.kind !== 'saved-project' && workspace.availability === 'dirty');
  }
  private async contentStorage(root: string, disk: NodeProjectStorage, content?: PreviewObservation['content']): Promise<ProjectStorage> {
    if (content === undefined) return disk;
    const resolved = await this.contents.resolve(root, content.target);
    if (resolved.content.contentRevision !== content.contentRevision) return failure('PREVIEW_OBSERVATION_STALE', '试玩内容版本已变化，请重新加载');
    return resolved.storage;
  }
  private async diskSource(storage: NodeProjectStorage, source: PreviewSourceFacts, texts: ProjectStorage = storage): Promise<{ source: PreviewSourceFacts; assetPaths: string[] }> {
    const paths = await storage.listFiles();
    const files = await Promise.all((await texts.listFiles()).filter(isPreviewSourcePath).map(async file => ({ path: file,
      sha256: hash(previewSourceText(file, (await texts.readText(file)).text)) })));
    const assets = await Promise.all(source.assets.map(fact => storage.readFileFingerprint(fact.path)));
    return { source: { files, assets }, assetPaths: paths.filter(isPreviewAssetPath).sort() };
  }
  async publish(root: string, sessionId: string, browserId: string, value: PreviewPublishInput): Promise<PreviewPublishAck> {
    const input = parsePreviewPublishInput(value);
    const file = this.file(root, sessionId);
    const previous = this.pending.get(file) ?? Promise.resolve();
    const work = previous.catch(() => undefined).then(() => this.publishSerial(root, sessionId, browserId, input));
    this.pending.set(file, work);
    try { return await work; } finally { if (this.pending.get(file) === work) this.pending.delete(file); }
  }
  private async publishSerial(root: string, sessionId: string, browserId: string, input: PreviewPublishInput): Promise<PreviewPublishAck> {
    const workspace = await this.currentWorkspace(root, sessionId, browserId);
    const previous = await this.readStored(root, sessionId);
    if (previous !== null && (previous.browserSessionId !== browserId || input.previewGeneration < previous.previewGeneration)) {
      return failure('PREVIEW_OBSERVATION_STALE', '旧预览代次不能覆盖当前观察');
    }
    let record: StoredPreview;
    if (input.action === 'invalidate') {
      record = { formatVersion: 1, projectIdentity: projectIdentityFromRoot(root), workspaceSessionId: sessionId,
        browserSessionId: browserId, workspaceGeneration: workspace.workspaceGeneration, previewGeneration: input.previewGeneration,
        invalidated: input.reason, assetPaths: [], observation: null };
    } else if (input.action === 'begin') {
      if (!this.available(workspace, input.content?.target)) return failure('HUMAN_WORKSPACE_DIRTY', '来源预览需要保存草稿；隔离试玩不会保存草稿，但仍需等待当前操作结束');
      if (previous && input.previewGeneration === previous.previewGeneration) {
        const observed = previous.observation;
        if (observed?.previewId === input.previewId && previous.invalidated === null
          && observed.sceneId === input.sceneId && observed.label === input.label
          && observed.projectRevision === input.expectedProjectRevision
          && observed.coordinationRevision === input.expectedCoordinationRevision
          && observed.seed === input.seed
          && stableStringify(observed.content ?? null) === stableStringify(input.content ?? null)
          && canonicalFacts(observed.source) === canonicalFacts(input.source)
          && workspace.workspaceGeneration === previous.workspaceGeneration) {
          return { previewId: input.previewId, previewGeneration: input.previewGeneration };
        }
        return failure('PREVIEW_OBSERVATION_STALE', '同一预览代次不能替换来源或恢复已失效观察');
      }
      const storage = await NodeProjectStorage.open(root);
      const before = await loadProjectCoordinationBaseline(storage);
      if (before.projectRevision !== input.expectedProjectRevision || before.coordinationRevision !== input.expectedCoordinationRevision
        || workspace.loadedProjectRevision !== before.projectRevision || workspace.loadedCoordinationRevision !== before.coordinationRevision) {
        return failure('PREVIEW_OBSERVATION_STALE', '预览载入版本与当前已保存项目不一致');
      }
      let actual: Awaited<ReturnType<PreviewObservationService['diskSource']>>;
      const texts = await this.contentStorage(root, storage, input.content);
      try { actual = await this.diskSource(storage, input.source, texts); }
      catch (error) {
        if (!(error instanceof AuthoringOperationError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return failure('PREVIEW_OBSERVATION_STALE', '预览引用的来源文件无法核对，请重新加载项目');
      }
      if (canonicalFacts(actual.source) !== canonicalFacts(input.source)) return failure('PREVIEW_OBSERVATION_STALE', '实际发送的预览内容与所选版本不一致');
      const snapshot = await loadProjectSnapshot(texts, { sha256: async text => hash(text) });
      if (!snapshot.scenes.some(scene => scene.id === input.sceneId)) return failure('PREVIEW_OBSERVATION_STALE', '预览入口不属于所选内容');
      const after = await loadProjectCoordinationBaseline(storage);
      const confirmed = await this.currentWorkspace(root, sessionId, browserId);
      if (after.coordinationRevision !== before.coordinationRevision || confirmed.workspaceGeneration !== workspace.workspaceGeneration
        || !this.available(confirmed, input.content?.target)) return failure('PREVIEW_OBSERVATION_STALE', '核对预览来源期间项目或工作区已变化');
      await this.contentStorage(root, storage, input.content);
      const now = new Date().toISOString();
      record = { formatVersion: 1, projectIdentity: projectIdentityFromRoot(root), workspaceSessionId: sessionId,
        browserSessionId: browserId, workspaceGeneration: workspace.workspaceGeneration, previewGeneration: input.previewGeneration,
        invalidated: null, assetPaths: actual.assetPaths,
        observation: { previewId: input.previewId, previewGeneration: input.previewGeneration, workspaceSessionId: sessionId,
          projectIdentity: projectIdentityFromRoot(root), projectRevision: before.projectRevision, coordinationRevision: before.coordinationRevision,
          sceneId: input.sceneId, ...(input.label === undefined ? {} : { label: input.label }), startedAt: now, updatedAt: now,
          runtimeGeneration: null, state: 'starting', source: input.source, events: [],
          ...(input.seed === undefined ? {} : { seed: input.seed }),
          ...(input.content === undefined ? {} : { content: input.content }) } };
    } else {
      if (!previous || previous.invalidated !== null || previous.observation?.previewId !== input.previewId
        || previous.previewGeneration !== input.previewGeneration || previous.workspaceGeneration !== workspace.workspaceGeneration
        || !this.available(workspace, previous.observation?.content?.target)) return failure('PREVIEW_OBSERVATION_STALE', '这条消息不属于当前预览');
      record = structuredClone(previous);
      const observed = record.observation!;
      const storage = await NodeProjectStorage.open(root);
      const texts = await this.contentStorage(root, storage, observed.content);
      const snapshot = await loadProjectSnapshot(texts, { sha256: async text => hash(text) });
      if (snapshot.revision !== (observed.content?.contentRevision ?? observed.projectRevision)) return failure('PREVIEW_OBSERVATION_STALE', '项目内容已变化，旧预览不能继续追加');
      const index = buildObjectIndex(snapshot);
      for (const message of input.messages) {
        if (message.traceId !== observed.previewId) return failure('PREVIEW_OBSERVATION_STALE', '轨迹不属于本次预览');
        if (message.type === 'surdet-preview-trace-start') {
          if (message.sceneId !== observed.sceneId || message.label !== observed.label
            || message.seed !== observed.seed
            || (observed.runtimeGeneration !== null && observed.runtimeGeneration !== message.generation)) return failure('PREVIEW_OBSERVATION_STALE', '运行入口或代次不一致');
          if (observed.runtimeGeneration === null) { observed.runtimeGeneration = message.generation; observed.state = 'running'; }
          continue;
        }
        if (message.generation !== observed.runtimeGeneration) return failure('PREVIEW_OBSERVATION_STALE', '运行代次已变化');
        if (message.type === 'surdet-preview-trace-event') {
          if (message.playback !== undefined && (message.playback.seed !== observed.seed || message.playback.sceneId !== observed.sceneId
            || message.playback.label !== observed.label)) return failure('PREVIEW_OBSERVATION_STALE', '续接路径的随机种子或入口不属于本次预览');
          if (message.sequence < observed.events.length) {
            const { objectRef: _objectRef, ...original } = observed.events[message.sequence]!;
            if (stableStringify(original) !== stableStringify(message)) return failure('PREVIEW_OBSERVATION_STALE', '同一事件序号不能替换事实');
            continue;
          }
          if (observed.state !== 'running' || message.sequence !== observed.events.length) return failure('PREVIEW_OBSERVATION_STALE', '预览事件缺失或轨迹已结束');
          if (observed.events.length >= PREVIEW_MAX_EVENTS) return failure('PREVIEW_OBSERVATION_LIMIT', '本次观察事件达到上限，请从较近标签重新播放');
          observed.events.push({ ...message, objectRef: locateObjectForTraceEvent({ event: message.event }, index) });
        } else {
          if (message.eventCount !== observed.events.length || (observed.state !== 'running'
            && (observed.state !== message.status || observed.firstError !== message.firstError))) {
            return failure('PREVIEW_OBSERVATION_STALE', '预览完成消息与实际事件不一致');
          }
          observed.state = message.status;
          if (message.firstError !== undefined) observed.firstError = message.firstError;
        }
      }
      observed.updatedAt = new Date().toISOString();
    }
    if (previous === null) await createJsonRecord(this.file(root, sessionId), record);
    else await replaceJsonRecord(this.file(root, sessionId), record);
    return { previewId: record.observation?.previewId ?? null, previewGeneration: record.previewGeneration };
  }

  async read(root: string, query: PreviewReadInput = {}): Promise<PreviewReadResult> {
    if (query === null || typeof query !== 'object' || Array.isArray(query)
      || Object.keys(query).some(key => !['previewId', 'offset', 'limit'].includes(key))
      || (query.previewId !== undefined && !/^preview-[0-9a-f-]{36}$/.test(query.previewId))
      || (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0))
      || (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100))) {
      return failure('INVALID_REQUEST', '预览读取参数无效');
    }
    const result: PreviewReadResult = { view: 'saved-project', kind: 'editor-preview', status: 'unavailable',
      reasons: [], observation: null, eventCount: 0, hasMore: false, availablePreviews: [] };
    const live = (await this.workspaces.inspect(root)).observations.filter(value => value.connection === 'active');
    const records = (await Promise.all(live.map(value => this.readStored(root, value.workspaceSessionId))))
      .filter((value): value is StoredPreview => value?.observation !== undefined && value.observation !== null);
    result.availablePreviews = records.map(record => ({ previewId: record.observation!.previewId,
      workspaceSessionId: record.workspaceSessionId, sceneId: record.observation!.sceneId }));
    if (records.length === 0) { result.reasons = ['no-active-saved-preview']; return result; }
    if (query.previewId === undefined && live.length > 1) { result.status = 'ambiguous'; result.reasons = ['multiple-editor-workspaces']; return result; }
    const record = query.previewId === undefined ? records[0]! : records.find(value => value.observation!.previewId === query.previewId);
    if (!record) { result.reasons = ['preview-replaced-or-disconnected']; return result; }
    const observed = record.observation!;
    result.view = observed.content?.target.kind ?? 'saved-project';
    const current = await this.currentWorkspace(root, record.workspaceSessionId);
    if (current.browserSessionId !== record.browserSessionId || current.workspaceGeneration !== record.workspaceGeneration
      || !this.available(current, observed.content?.target) || record.invalidated !== null) result.reasons.push('workspace-changed');
    const storage = await NodeProjectStorage.open(root);
    const baseline = await loadProjectCoordinationBaseline(storage);
    if (baseline.projectRevision !== observed.projectRevision || baseline.coordinationRevision !== observed.coordinationRevision
      || current.loadedProjectRevision !== observed.projectRevision || current.loadedCoordinationRevision !== observed.coordinationRevision) result.reasons.push('saved-content-changed');
    try {
      const texts = await this.contentStorage(root, storage, observed.content);
      const actual = await this.diskSource(storage, observed.source, texts);
      if (canonicalFacts(actual.source) !== canonicalFacts(observed.source) || stableStringify(actual.assetPaths) !== stableStringify(record.assetPaths)) result.reasons.push('preview-source-changed');
    } catch (error) {
      if (!(error instanceof AuthoringOperationError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      result.reasons.push('preview-source-unavailable');
      if (error instanceof AuthoringOperationError) result.reasons.push(error.code);
    }
    const after = await loadProjectCoordinationBaseline(storage);
    const latest = await this.readStored(root, record.workspaceSessionId);
    const confirmed = await this.currentWorkspace(root, record.workspaceSessionId);
    try { await this.contentStorage(root, storage, observed.content); }
    catch (error) {
      if (!(error instanceof AuthoringOperationError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      result.reasons.push('changed-during-read');
      if (error instanceof AuthoringOperationError && !result.reasons.includes(error.code)) result.reasons.push(error.code);
    }
    if (after.coordinationRevision !== baseline.coordinationRevision || latest?.previewGeneration !== record.previewGeneration
      || latest?.observation?.previewId !== observed.previewId || latest?.invalidated !== null
      || confirmed.workspaceGeneration !== current.workspaceGeneration) result.reasons.push('changed-during-read');
    result.status = result.reasons.length === 0 ? 'current' : 'stale';
    result.eventCount = observed.events.length;
    const offset = query.offset ?? 0; const limit = query.limit ?? 100;
    result.observation = { ...observed, events: observed.events.slice(offset, offset + limit) };
    result.hasMore = offset + result.observation.events.length < result.eventCount;
    return result;
  }
}
