/**
 * 编辑器崩溃保险（A1）：定时把未保存（dirty）场景和时间轴文本快照到 localStorage，
 * 浏览器崩溃/误关后重新打开同一项目时提示恢复。
 *  - 只快照 dirty 场景/时间轴（干净内容磁盘已有，无需备份）
 *  - 保存全部成功后清除快照（磁盘已是最新）
 *  - 存储与恢复仅按持久项目身份隔离；目录名只作显示元数据
 * 纯逻辑（build/pick/parse）可单测；存储读写薄封装带 try/catch（隐私模式等场景静默降级）。
 */
import {
  inspectTimelineAutosaveIdentity,
  type TimelineAutosaveDocument,
} from './timeline-autosave-identity.js';

export const AUTOSAVE_KEY = 'surdet-editor:autosave';
/** 快照周期（30 秒：崩溃最多丢半分钟编辑，写入成本可忽略） */
export const AUTOSAVE_INTERVAL_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export interface AutosaveEntry {
  /** 场景 Map key（含子目录前缀） */
  key: string;
  text: string;
  /** 场景路径事务恢复需要的完整身份；旧快照可缺失。 */
  id?: string;
  file?: string;
  eol?: '\r\n' | '\n';
  persistedSha256?: string;
  pendingCreateOperationId?: string;
}

export interface AutosavePendingSceneMutation {
  kind: 'rename' | 'delete';
  id: string;
  file: string;
  replacementKey?: string;
  operationId: string;
  planFingerprint: string;
  affectedSceneKeys?: string[];
}

export interface AutosaveSceneTransaction {
  pendingDeletes: AutosavePendingSceneMutation[];
  pendingCreates?: Array<{ key: string; operationId: string }>;
}

export interface AutosavePendingSceneCommit {
  requestId: string;
  plans: Array<{ operationId: string; planFingerprint: string }>;
  writes: Array<{ path: string; text: string; expectedSha256: string | null }>;
  deletedPaths: string[];
}

export interface AutosaveTimelineEntry extends TimelineAutosaveDocument {}

export interface AutosavePayload {
  dirName: string;
  /** 浏览器持久目录句柄对应的项目身份；旧单槽快照可缺失。 */
  projectId?: string;
  savedAt: number;
  scenes: AutosaveEntry[];
  /** 可选以兼容旧版 scenes-only 快照。 */
  timelines?: AutosaveTimelineEntry[];
  /** 身份冲突的原始恢复正文；与新的 dirty timelines 分桶，避免同 outer tuple 互相覆盖。 */
  timelineConflicts?: AutosaveTimelineEntry[];
  /** 场景改名/删除与其引用改写必须作为一个整体恢复。 */
  sceneTransaction?: AutosaveSceneTransaction;
  /** 回包丢失时原样重放的已冻结保存请求。 */
  pendingSceneCommit?: AutosavePendingSceneCommit;
}

export type SceneAutosaveRecovery =
  | { status: 'none'; scenes: []; pendingDeletes: [] }
  | { status: 'blocked'; scenes: []; pendingDeletes: [] }
  | {
    status: 'recoverable';
    scenes: Array<AutosaveEntry & Required<Pick<AutosaveEntry, 'id' | 'file' | 'eol'>>>;
    pendingDeletes: AutosavePendingSceneMutation[];
  };

export function autosaveStorageKey(projectId: string): string {
  return `${AUTOSAVE_KEY}:${encodeURIComponent(projectId)}`;
}

export interface AutosaveProjectHandleRecord {
  id: string;
  handle: FileSystemDirectoryHandle;
}

export async function matchingAutosaveProjectIdentity(
  handle: FileSystemDirectoryHandle,
  records: readonly AutosaveProjectHandleRecord[],
): Promise<string | null> {
  for (const record of records) {
    if (await handle.isSameEntry(record.handle)) return record.id;
  }
  return null;
}

function openAutosaveProjectRegistry(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('surdet-editor', 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('project-handles')) {
        database.createObjectStore('project-handles', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('project identity registry unavailable'));
    request.onblocked = () => reject(new Error('project identity registry upgrade blocked'));
  });
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('project identity registry request failed'));
  });
}

function idbTransactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('project identity registry transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('project identity registry transaction failed'));
  });
}

export async function resolveAutosaveProjectIdentity(
  handle: FileSystemDirectoryHandle | null,
): Promise<string | null> {
  if (!handle || typeof indexedDB === 'undefined' || typeof crypto.randomUUID !== 'function') return null;

  let database: IDBDatabase | null = null;
  try {
    database = await openAutosaveProjectRegistry();
    const read = database.transaction('project-handles', 'readonly').objectStore('project-handles');
    const records = await idbRequest(read.getAll()) as AutosaveProjectHandleRecord[];
    const existingId = await matchingAutosaveProjectIdentity(handle, records);
    if (existingId) return existingId;

    const id = crypto.randomUUID();
    const transaction = database.transaction('project-handles', 'readwrite');
    const completed = idbTransactionDone(transaction);
    await idbRequest(transaction.objectStore('project-handles').put({ id, handle }));
    await completed;
    return id;
  } catch {
    // 无法证明物理目录身份时禁用该项目的 autosave，绝不按名称或内容猜测。
    return null;
  } finally {
    database?.close();
  }
}

/** 构建快照：仅收 dirty 内容；场景和时间轴均无 dirty 时返回 null。 */
export function buildAutosave(
  dirName: string,
  scenes: ReadonlyMap<string, {
    text: string;
    dirty: boolean;
    id?: string;
    file?: string;
    eol?: string;
    persistedSha256?: string;
    pendingCreateOperationId?: string;
  }>,
  timelines: Iterable<{ id: string; file: string; text: string; eol: '\r\n' | '\n'; dirty: boolean }>,
  now: number,
  projectId?: string,
  pendingSceneDeletes: readonly {
    kind: 'rename' | 'delete';
    id: string;
    file: string;
    replacementKey?: string;
    operationId?: string;
    planFingerprint?: string;
    affectedSceneKeys?: string[];
  }[] = [],
  pendingSceneCommit: AutosavePendingSceneCommit | null = null,
): AutosavePayload | null {
  const transactionKeys = new Set<string>();
  for (const pending of pendingSceneDeletes) {
    if (pending.replacementKey) transactionKeys.add(pending.replacementKey);
    for (const key of pending.affectedSceneKeys ?? []) transactionKeys.add(key);
  }
  const pendingCreates = [...scenes]
    .filter(([, scene]) => scene.dirty && !scene.persistedSha256
      && typeof scene.pendingCreateOperationId === 'string')
    .map(([key, scene]) => ({ key, operationId: scene.pendingCreateOperationId! }));
  for (const pending of pendingCreates) transactionKeys.add(pending.key);
  const entries: AutosaveEntry[] = [];
  for (const [key, sc] of scenes) {
    if (sc.dirty || transactionKeys.has(key)) {
      entries.push({
        key,
        text: sc.text,
        ...(typeof sc.id === 'string' ? { id: sc.id } : {}),
        ...(typeof sc.file === 'string' ? { file: sc.file } : {}),
        ...(sc.eol === '\n' || sc.eol === '\r\n' ? { eol: sc.eol } : {}),
        ...(typeof sc.persistedSha256 === 'string' ? { persistedSha256: sc.persistedSha256 } : {}),
        ...(typeof sc.pendingCreateOperationId === 'string'
          ? { pendingCreateOperationId: sc.pendingCreateOperationId }
          : {}),
      });
    }
  }
  const timelineEntries: AutosaveTimelineEntry[] = [];
  for (const timeline of timelines) {
    if (timeline.dirty) {
      timelineEntries.push({
        id: timeline.id,
        file: timeline.file,
        text: timeline.text,
        eol: timeline.eol,
      });
    }
  }
  if (entries.length === 0 && timelineEntries.length === 0
    && pendingSceneDeletes.length === 0 && pendingCreates.length === 0
    && pendingSceneCommit === null) return null;
  const payload: AutosavePayload = { dirName, ...(projectId ? { projectId } : {}), savedAt: now, scenes: entries };
  if (timelineEntries.length > 0) payload.timelines = timelineEntries;
  if (pendingSceneDeletes.length > 0 || pendingCreates.length > 0) {
    payload.sceneTransaction = {
      pendingDeletes: pendingSceneDeletes.map((pending) => ({
        kind: pending.kind,
        id: pending.id,
        file: pending.file,
        ...(pending.replacementKey ? { replacementKey: pending.replacementKey } : {}),
        operationId: pending.operationId ?? '',
        planFingerprint: pending.planFingerprint ?? '',
        ...(pending.affectedSceneKeys ? { affectedSceneKeys: [...pending.affectedSceneKeys] } : {}),
      })),
      ...(pendingCreates.length > 0 ? { pendingCreates } : {}),
    };
  }
  if (pendingSceneCommit !== null) {
    payload.pendingSceneCommit = {
      requestId: pendingSceneCommit.requestId,
      plans: pendingSceneCommit.plans.map((entry) => ({ ...entry })),
      writes: pendingSceneCommit.writes.map((entry) => ({ ...entry })),
      deletedPaths: [...pendingSceneCommit.deletedPaths],
    };
  }
  return payload;
}

/** 形状校验解析（外部存储内容不可信：非法形状按无快照处理，不抛错） */
export function parseAutosave(raw: string | null): AutosavePayload | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const d = obj as Record<string, unknown>;
  if (typeof d.dirName !== 'string' || typeof d.savedAt !== 'number' || !Array.isArray(d.scenes)) return null;
  const scenes: AutosaveEntry[] = [];
  for (const s of d.scenes) {
    if (!s || typeof s !== 'object') continue;
    const e = s as Record<string, unknown>;
    if (typeof e.key === 'string' && typeof e.text === 'string') {
      scenes.push({
        key: e.key,
        text: e.text,
        ...(typeof e.id === 'string' ? { id: e.id } : {}),
        ...(typeof e.file === 'string' ? { file: e.file } : {}),
        ...(e.eol === '\n' || e.eol === '\r\n' ? { eol: e.eol } : {}),
        ...(typeof e.persistedSha256 === 'string' ? { persistedSha256: e.persistedSha256 } : {}),
        ...(typeof e.pendingCreateOperationId === 'string'
          ? { pendingCreateOperationId: e.pendingCreateOperationId }
          : {}),
      });
    }
  }
  const projectId = typeof d.projectId === 'string' && d.projectId.length > 0 ? d.projectId : undefined;
  const parseTimelineEntries = (value: unknown): AutosaveTimelineEntry[] | null | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) return null;
    const entries: AutosaveTimelineEntry[] = [];
    for (const timeline of value) {
      if (!timeline || typeof timeline !== 'object') continue;
      const entry = timeline as Record<string, unknown>;
      if (
        typeof entry.id === 'string'
        && typeof entry.file === 'string'
        && typeof entry.text === 'string'
        && (entry.eol === '\n' || entry.eol === '\r\n')
      ) {
        entries.push({ id: entry.id, file: entry.file, text: entry.text, eol: entry.eol });
      }
    }
    return entries;
  };
  const timelines = parseTimelineEntries(d.timelines);
  const timelineConflicts = parseTimelineEntries(d.timelineConflicts);
  if (timelines === null || timelineConflicts === null) return null;
  let sceneTransaction: AutosaveSceneTransaction | undefined;
  if (d.sceneTransaction !== undefined) {
    if (!d.sceneTransaction || typeof d.sceneTransaction !== 'object' || Array.isArray(d.sceneTransaction)) return null;
    const transaction = d.sceneTransaction as Record<string, unknown>;
    if (!Array.isArray(transaction.pendingDeletes)) return null;
    const pendingDeletes: AutosavePendingSceneMutation[] = [];
    for (const value of transaction.pendingDeletes) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const pending = value as Record<string, unknown>;
      if (
        (pending.kind !== 'rename' && pending.kind !== 'delete')
        || typeof pending.id !== 'string' || pending.id.length === 0
        || typeof pending.file !== 'string' || pending.file.length === 0
        || typeof pending.operationId !== 'string' || pending.operationId.length === 0
        || typeof pending.planFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(pending.planFingerprint)
        || pending.replacementKey !== undefined && typeof pending.replacementKey !== 'string'
        || pending.affectedSceneKeys !== undefined && (
          !Array.isArray(pending.affectedSceneKeys)
          || pending.affectedSceneKeys.some((key) => typeof key !== 'string' || key.length === 0)
        )
      ) return null;
      pendingDeletes.push({
        kind: pending.kind,
        id: pending.id,
        file: pending.file,
        ...(typeof pending.replacementKey === 'string' ? { replacementKey: pending.replacementKey } : {}),
        operationId: pending.operationId,
        planFingerprint: pending.planFingerprint,
        ...(Array.isArray(pending.affectedSceneKeys)
          ? { affectedSceneKeys: [...pending.affectedSceneKeys] as string[] }
          : {}),
      });
    }
    const pendingCreates: Array<{ key: string; operationId: string }> = [];
    if (transaction.pendingCreates !== undefined) {
      if (!Array.isArray(transaction.pendingCreates)) return null;
      for (const value of transaction.pendingCreates) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const pending = value as Record<string, unknown>;
        if (typeof pending.key !== 'string' || pending.key.length === 0
          || typeof pending.operationId !== 'string' || pending.operationId.length === 0) return null;
        pendingCreates.push({ key: pending.key, operationId: pending.operationId });
      }
    }
    if (pendingDeletes.length === 0 && pendingCreates.length === 0) return null;
    sceneTransaction = {
      pendingDeletes,
      ...(pendingCreates.length > 0 ? { pendingCreates } : {}),
    };
  }
  let pendingSceneCommit: AutosavePendingSceneCommit | undefined;
  if (d.pendingSceneCommit !== undefined) {
    if (!d.pendingSceneCommit || typeof d.pendingSceneCommit !== 'object'
      || Array.isArray(d.pendingSceneCommit)) return null;
    const pending = d.pendingSceneCommit as Record<string, unknown>;
    if (typeof pending.requestId !== 'string' || !UUID.test(pending.requestId)
      || !Array.isArray(pending.plans) || !Array.isArray(pending.writes)
      || !Array.isArray(pending.deletedPaths)
      || pending.plans.length > 100 || pending.writes.length > 512
      || (pending.plans.length === 0 && pending.writes.length === 0)) return null;
    const plans: AutosavePendingSceneCommit['plans'] = [];
    for (const value of pending.plans) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const plan = value as Record<string, unknown>;
      if (typeof plan.operationId !== 'string' || !UUID.test(plan.operationId)
        || typeof plan.planFingerprint !== 'string' || !SHA256.test(plan.planFingerprint)) return null;
      plans.push({ operationId: plan.operationId, planFingerprint: plan.planFingerprint });
    }
    const writes: AutosavePendingSceneCommit['writes'] = [];
    for (const value of pending.writes) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const write = value as Record<string, unknown>;
      if (typeof write.path !== 'string' || !write.path.startsWith('content/scenario/')
        || normalizedSceneKeyFromFile(write.path) === null || typeof write.text !== 'string'
        || (write.expectedSha256 !== null
          && (typeof write.expectedSha256 !== 'string' || !SHA256.test(write.expectedSha256)))) return null;
      writes.push({
        path: write.path,
        text: write.text,
        expectedSha256: write.expectedSha256 as string | null,
      });
    }
    const deletedPaths = pending.deletedPaths as unknown[];
    if (deletedPaths.some((value) => typeof value !== 'string'
      || !value.startsWith('content/scenario/') || normalizedSceneKeyFromFile(value) === null)) return null;
    const fold = (value: string): string => value.normalize('NFC').toLowerCase();
    if (new Set(plans.map((entry) => entry.operationId)).size !== plans.length
      || new Set(writes.map((entry) => fold(entry.path))).size !== writes.length
      || new Set(deletedPaths.map((entry) => fold(String(entry)))).size !== deletedPaths.length) return null;
    pendingSceneCommit = {
      requestId: pending.requestId,
      plans,
      writes,
      deletedPaths: [...deletedPaths] as string[],
    };
  }
  if (pendingSceneCommit !== undefined) {
    if (sceneTransaction === undefined) return null;
    const planIds = new Set(pendingSceneCommit.plans.map((entry) => entry.operationId));
    const pendingDeleteIds = new Set(sceneTransaction.pendingDeletes.map((entry) => entry.operationId));
    const expectedDeletes = new Set(sceneTransaction.pendingDeletes
      .map((entry) => `content/scenario/${entry.file}`.normalize('NFC').toLowerCase()));
    const actualDeletes = new Set(pendingSceneCommit.deletedPaths
      .map((entry) => entry.normalize('NFC').toLowerCase()));
    if (planIds.size !== pendingDeleteIds.size || [...planIds].some((entry) => !pendingDeleteIds.has(entry))
      || expectedDeletes.size !== actualDeletes.size
      || [...expectedDeletes].some((entry) => !actualDeletes.has(entry))
      || (pendingSceneCommit.plans.length === 0
        && (sceneTransaction.pendingCreates ?? []).some((entry) => entry.operationId !== pendingSceneCommit!.requestId))) {
      return null;
    }
  }
  return {
    dirName: d.dirName,
    ...(projectId ? { projectId } : {}),
    savedAt: d.savedAt,
    scenes,
    ...(timelines !== undefined ? { timelines } : {}),
    ...(timelineConflicts !== undefined ? { timelineConflicts } : {}),
    ...(sceneTransaction ? { sceneTransaction } : {}),
    ...(pendingSceneCommit ? { pendingSceneCommit } : {}),
  };
}

/** 将已提交的冻结请求回执折叠回普通 dirty 快照，保留请求发出后的新编辑。 */
export function settlePendingSceneCommit(
  payload: AutosavePayload,
  result: {
    requestId: string;
    status: 'COMMITTED';
    writes: Array<{ path: string; sha256: string }>;
    deletedPaths: string[];
  },
): AutosavePayload | null {
  const pending = payload.pendingSceneCommit;
  if (!pending || result.requestId !== pending.requestId) return null;
  const fold = (value: string): string => value.normalize('NFC').toLowerCase();
  const expectedWrites = new Map(pending.writes.map((entry) => [fold(entry.path), entry]));
  const receivedWrites = new Map<string, { path: string; sha256: string }>();
  for (const entry of result.writes) {
    const key = fold(entry.path);
    if (!expectedWrites.has(key) || receivedWrites.has(key) || !SHA256.test(entry.sha256)) return null;
    receivedWrites.set(key, entry);
  }
  if (receivedWrites.size !== expectedWrites.size) return null;
  const expectedDeletes = new Set(pending.deletedPaths.map(fold));
  const receivedDeletes = new Set(result.deletedPaths.map(fold));
  if (receivedDeletes.size !== result.deletedPaths.length || receivedDeletes.size !== expectedDeletes.size
    || [...receivedDeletes].some((entry) => !expectedDeletes.has(entry))) return null;
  const matchedWrites = new Set<string>();
  const scenes = payload.scenes.map((entry) => {
    if (!entry.file) return { ...entry };
    const projectPath = entry.file.startsWith('content/scenario/') ? entry.file : `content/scenario/${entry.file}`;
    const key = fold(projectPath);
    const receipt = receivedWrites.get(key);
    if (!receipt) return { ...entry };
    matchedWrites.add(key);
    const { pendingCreateOperationId: _pendingCreateOperationId, ...rest } = entry;
    return { ...rest, persistedSha256: receipt.sha256 };
  });
  if (matchedWrites.size !== receivedWrites.size) return null;
  const {
    sceneTransaction: _sceneTransaction,
    pendingSceneCommit: _pendingSceneCommit,
    ...rest
  } = payload;
  return { ...rest, scenes };
}

function normalizedSceneKeyFromFile(file: string): string | null {
  if (file.includes('\\') || file.startsWith('/') || /^[A-Za-z]:/u.test(file)
    || /[\u0000-\u001f\u007f]/u.test(file)) return null;
  const normalized = file.normalize('NFC');
  if (!normalized.toLowerCase().endsWith('.gal')) return null;
  const withoutRoot = normalized.startsWith('content/scenario/')
    ? normalized.slice('content/scenario/'.length)
    : normalized;
  if (!withoutRoot || withoutRoot.startsWith('/') || withoutRoot.split('/').some((part) => !part || part === '.' || part === '..')) {
    return null;
  }
  return withoutRoot.slice(0, -4);
}

function completeSceneEntry(entry: AutosaveEntry): entry is AutosaveEntry & Required<Pick<AutosaveEntry, 'id' | 'file' | 'eol'>> {
  if (!entry.id || !entry.file || (entry.eol !== '\n' && entry.eol !== '\r\n')) return false;
  if (entry.persistedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(entry.persistedSha256)) return false;
  if (entry.pendingCreateOperationId !== undefined && !UUID.test(entry.pendingCreateOperationId)) return false;
  const key = normalizedSceneKeyFromFile(entry.file);
  return key === entry.key && entry.id === entry.key.split('/').at(-1);
}

/**
 * 场景恢复判定：普通快照也不允许在缺成员时部分恢复；路径事务则必须完整带回
 * 新场景、全部引用改写和待删除源文件，否则整组保持封存。
 */
export function inspectSceneAutosaveRecovery(
  payload: AutosavePayload | null,
  projectId: string,
  scenes: ReadonlyMap<string, { id?: string; file?: string; text: string; persistedSha256?: string }>,
): SceneAutosaveRecovery {
  if (!payload || payload.projectId !== projectId) return { status: 'none', scenes: [], pendingDeletes: [] };
  if (!payload.sceneTransaction) {
    if (payload.scenes.some((entry) => !scenes.has(entry.key))) {
      return { status: 'blocked', scenes: [], pendingDeletes: [] };
    }
    const recoverable = payload.scenes.filter((entry) => scenes.get(entry.key)?.text !== entry.text);
    if (recoverable.length === 0) return { status: 'none', scenes: [], pendingDeletes: [] };
    const complete = recoverable.filter(completeSceneEntry);
    if (complete.length !== recoverable.length) {
      // 旧快照只更新已有场景，不需要路径身份；补齐当前磁盘身份后统一返回。
      return {
        status: 'recoverable',
        scenes: recoverable.map((entry) => {
          const current = scenes.get(entry.key)!;
          return {
            ...entry,
            id: current.id ?? entry.key.split('/').at(-1)!,
            file: current.file ?? `${entry.key}.gal`,
            eol: entry.text.includes('\r\n') ? '\r\n' : '\n',
          };
        }),
        pendingDeletes: [],
      };
    }
    return { status: 'recoverable', scenes: complete, pendingDeletes: [] };
  }

  if (payload.scenes.some((entry) => !completeSceneEntry(entry))) {
    return { status: 'blocked', scenes: [], pendingDeletes: [] };
  }
  const entries = payload.scenes as Array<AutosaveEntry & Required<Pick<AutosaveEntry, 'id' | 'file' | 'eol'>>>;
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  if (byKey.size !== entries.length) return { status: 'blocked', scenes: [], pendingDeletes: [] };
  const replacementKeys = new Set(payload.sceneTransaction.pendingDeletes
    .filter((pending) => pending.kind === 'rename' && pending.replacementKey)
    .map((pending) => pending.replacementKey!));
  const createKeys = new Set(payload.sceneTransaction.pendingCreates?.map((pending) => pending.key) ?? []);
  for (const entry of entries) {
    if (replacementKeys.has(entry.key) || createKeys.has(entry.key)) continue;
    const current = scenes.get(entry.key);
    if (!current || current.id !== entry.id || normalizedSceneKeyFromFile(current.file ?? '') !== entry.key
      || !entry.persistedSha256 || current.persistedSha256 !== entry.persistedSha256) {
      return { status: 'blocked', scenes: [], pendingDeletes: [] };
    }
  }

  for (const pending of payload.sceneTransaction.pendingCreates ?? []) {
    const entry = byKey.get(pending.key);
    if (!entry || entry.pendingCreateOperationId !== pending.operationId
      || entry.persistedSha256 !== undefined || normalizedSceneKeyFromFile(entry.file) !== pending.key
      || scenes.has(pending.key)) {
      return { status: 'blocked', scenes: [], pendingDeletes: [] };
    }
  }

  for (const pending of payload.sceneTransaction.pendingDeletes) {
    const sourceKey = normalizedSceneKeyFromFile(pending.file);
    const source = sourceKey ? scenes.get(sourceKey) : undefined;
    if (!sourceKey || !source || source.id !== pending.id
      || source.file && normalizedSceneKeyFromFile(source.file) !== sourceKey) {
      return { status: 'blocked', scenes: [], pendingDeletes: [] };
    }
    if (pending.kind === 'rename') {
      if (!pending.replacementKey || !byKey.has(pending.replacementKey)) {
        return { status: 'blocked', scenes: [], pendingDeletes: [] };
      }
      const replacement = byKey.get(pending.replacementKey)!;
      if (!replacement.persistedSha256 || source.persistedSha256 !== replacement.persistedSha256) {
        return { status: 'blocked', scenes: [], pendingDeletes: [] };
      }
      const affected = new Set(pending.affectedSceneKeys ?? []);
      if (!affected.has(pending.replacementKey) || [...affected].some((key) => !byKey.has(key))) {
        return { status: 'blocked', scenes: [], pendingDeletes: [] };
      }
    }
  }
  return {
    status: 'recoverable',
    scenes: entries,
    pendingDeletes: payload.sceneTransaction.pendingDeletes.map((pending) => ({
      ...pending,
      ...(pending.affectedSceneKeys ? { affectedSceneKeys: [...pending.affectedSceneKeys] } : {}),
    })),
  };
}

/** 可恢复条目：同一持久项目 + 快照文本与当前内存不同。 */
export function pickRecoverable(
  payload: AutosavePayload | null,
  projectId: string,
  scenes: Map<string, { text: string }>,
): AutosaveEntry[] {
  if (!payload || payload.projectId !== projectId) return [];
  return payload.scenes.filter((entry) => {
    const current = scenes.get(entry.key);
    return current !== undefined && current.text !== entry.text;
  });
}

/**
 * 可恢复时间轴：同一持久项目，且磁盘载入内容与快照不同；内存中不存在的条目视为新建未落盘。
 * 调用方负责把返回条目更新或插入 state。
 */
export function pickRecoverableTimelines(
  payload: AutosavePayload | null,
  projectId: string,
  timelines: Iterable<{ id: string; file?: string; text: string; eol: '\r\n' | '\n' }>,
): AutosaveTimelineEntry[] {
  if (!payload || payload.projectId !== projectId || !payload.timelines) return [];
  const current = new Map<string, { file?: string; text: string; eol: '\r\n' | '\n' }>();
  for (const timeline of timelines) current.set(timeline.id, timeline);
  return payload.timelines.filter((entry) => {
    const existing = current.get(entry.id);
    return !existing
      || existing.file !== undefined && existing.file !== entry.file
      || existing.text !== entry.text
      || existing.eol !== entry.eol;
  });
}

/** 将尚未解决的 file 身份冲突继续封存在下一次快照中，避免定时器静默清除证据。 */
export function preserveAutosaveTimelineConflicts(
  payload: AutosavePayload | null,
  dirName: string,
  conflicts: readonly AutosaveTimelineEntry[],
  now: number,
  projectId?: string,
): AutosavePayload | null {
  if (conflicts.length === 0) return payload;
  const next: AutosavePayload = payload
    ? {
      ...payload,
      savedAt: now,
      scenes: [...payload.scenes],
      ...(payload.timelines ? { timelines: [...payload.timelines] } : {}),
      timelineConflicts: [...(payload.timelineConflicts ?? [])],
    }
    : { dirName, ...(projectId ? { projectId } : {}), savedAt: now, scenes: [], timelines: [] };
  const byEvidence = new Map((next.timelineConflicts ?? []).map((entry) => [
    `${entry.id}\0${entry.file}\0${entry.eol}\0${entry.text}`,
    entry,
  ]));
  for (const conflict of conflicts) {
    const evidence = `${conflict.id}\0${conflict.file}\0${conflict.eol}\0${conflict.text}`;
    if (!byEvidence.has(evidence)) byEvidence.set(evidence, conflict);
  }
  next.timelineConflicts = [...byEvidence.values()];
  return next;
}

export function unresolvedAutosaveTimelineConflicts(
  conflicts: readonly AutosaveTimelineEntry[],
  timelines: Iterable<TimelineAutosaveDocument>,
): AutosaveTimelineEntry[] {
  const current = [...timelines];
  return conflicts.filter((conflict) => !current.some((entry) => (
    entry.id === conflict.id
    && entry.file === conflict.file
    && entry.text === conflict.text
    && entry.eol === conflict.eol
    && inspectTimelineAutosaveIdentity(entry).canonical
  )));
}

/** 存储薄封装：隐私模式/超限时静默降级（崩溃保险不应阻塞主流程） */
export function writeAutosave(payload: AutosavePayload): void {
  try {
    if (!payload.projectId) return;
    localStorage.setItem(autosaveStorageKey(payload.projectId), JSON.stringify(payload));
  } catch { /* 存储不可用：放弃备份，不影响编辑 */ }
}

export function readAutosave(projectId: string): AutosavePayload | null {
  try {
    const scoped = parseAutosave(localStorage.getItem(autosaveStorageKey(projectId)));
    return scoped?.projectId === projectId ? scoped : null;
  } catch {
    return null;
  }
}

export function clearAutosave(projectId: string): void {
  try {
    localStorage.removeItem(autosaveStorageKey(projectId));
  } catch { /* 同上 */ }
}
