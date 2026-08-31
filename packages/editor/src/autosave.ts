/**
 * 编辑器崩溃保险（A1）：定时把未保存（dirty）场景和时间轴文本快照到 localStorage，
 * 浏览器崩溃/误关后重新打开同一项目时提示恢复。
 *  - 只快照 dirty 场景/时间轴（干净内容磁盘已有，无需备份）
 *  - 保存全部成功后清除快照（磁盘已是最新）
 *  - 存储按持久项目身份隔离；恢复时再核对项目显示名与当前内存差异
 * 纯逻辑（build/pick/parse）可单测；存储读写薄封装带 try/catch（隐私模式等场景静默降级）。
 */

export const AUTOSAVE_KEY = 'surdet-editor:autosave';
/** 快照周期（30 秒：崩溃最多丢半分钟编辑，写入成本可忽略） */
export const AUTOSAVE_INTERVAL_MS = 30_000;

export interface AutosaveEntry {
  /** 场景 Map key（含子目录前缀） */
  key: string;
  text: string;
}

export interface AutosaveTimelineEntry {
  id: string;
  file: string;
  text: string;
  eol: '\r\n' | '\n';
}

export interface AutosavePayload {
  dirName: string;
  /** 浏览器持久目录句柄对应的项目身份；旧单槽快照可缺失。 */
  projectId?: string;
  savedAt: number;
  scenes: AutosaveEntry[];
  /** 可选以兼容旧版 scenes-only 快照。 */
  timelines?: AutosaveTimelineEntry[];
}

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
  scenes: ReadonlyMap<string, { text: string; dirty: boolean }>,
  timelines: Iterable<{ id: string; file: string; text: string; eol: '\r\n' | '\n'; dirty: boolean }>,
  now: number,
  projectId?: string,
): AutosavePayload | null {
  const entries: AutosaveEntry[] = [];
  for (const [key, sc] of scenes) {
    if (sc.dirty) entries.push({ key, text: sc.text });
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
  if (entries.length === 0 && timelineEntries.length === 0) return null;
  const payload: AutosavePayload = { dirName, ...(projectId ? { projectId } : {}), savedAt: now, scenes: entries };
  if (timelineEntries.length > 0) payload.timelines = timelineEntries;
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
    if (typeof e.key === 'string' && typeof e.text === 'string') scenes.push({ key: e.key, text: e.text });
  }
  const projectId = typeof d.projectId === 'string' && d.projectId.length > 0 ? d.projectId : undefined;
  if (d.timelines === undefined) return { dirName: d.dirName, ...(projectId ? { projectId } : {}), savedAt: d.savedAt, scenes };
  if (!Array.isArray(d.timelines)) return null;
  const timelines: AutosaveTimelineEntry[] = [];
  for (const timeline of d.timelines) {
    if (!timeline || typeof timeline !== 'object') continue;
    const entry = timeline as Record<string, unknown>;
    if (
      typeof entry.id === 'string'
      && typeof entry.file === 'string'
      && typeof entry.text === 'string'
      && (entry.eol === '\n' || entry.eol === '\r\n')
    ) {
      timelines.push({ id: entry.id, file: entry.file, text: entry.text, eol: entry.eol });
    }
  }
  return { dirName: d.dirName, ...(projectId ? { projectId } : {}), savedAt: d.savedAt, scenes, timelines };
}

/** 可恢复条目：同项目 + 快照文本与当前内存不同（相同说明改动已在内存/已还原，无需打扰） */
export function pickRecoverable(payload: AutosavePayload | null, dirName: string, scenes: Map<string, { text: string }>): AutosaveEntry[] {
  if (!payload || payload.dirName !== dirName) return [];
  const out: AutosaveEntry[] = [];
  for (const e of payload.scenes) {
    const cur = scenes.get(e.key);
    if (cur && cur.text !== e.text) out.push(e);
  }
  return out;
}

/**
 * 可恢复时间轴：同项目，且磁盘载入内容与快照不同；内存中不存在的条目视为新建未落盘。
 * 调用方负责把返回条目更新或插入 state。
 */
export function pickRecoverableTimelines(
  payload: AutosavePayload | null,
  dirName: string,
  timelines: Iterable<{ id: string; file?: string; text: string; eol: '\r\n' | '\n' }>,
): AutosaveTimelineEntry[] {
  if (!payload || payload.dirName !== dirName || !payload.timelines) return [];
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
    ? { ...payload, savedAt: now, scenes: [...payload.scenes], timelines: [...(payload.timelines ?? [])] }
    : { dirName, ...(projectId ? { projectId } : {}), savedAt: now, scenes: [], timelines: [] };
  const byIdentity = new Map((next.timelines ?? []).map((entry) => [`${entry.id}\0${entry.file}`, entry]));
  for (const conflict of conflicts) {
    const identity = `${conflict.id}\0${conflict.file}`;
    if (!byIdentity.has(identity)) byIdentity.set(identity, conflict);
  }
  next.timelines = [...byIdentity.values()];
  return next;
}

export function unresolvedAutosaveTimelineConflicts(
  conflicts: readonly AutosaveTimelineEntry[],
  timelines: Iterable<{ id: string; file: string }>,
): AutosaveTimelineEntry[] {
  const currentIdentities = new Set([...timelines].map((entry) => `${entry.id}\0${entry.file}`));
  return conflicts.filter((entry) => !currentIdentities.has(`${entry.id}\0${entry.file}`));
}

/** 存储薄封装：隐私模式/超限时静默降级（崩溃保险不应阻塞主流程） */
export function writeAutosave(payload: AutosavePayload): void {
  try {
    if (!payload.projectId) return;
    localStorage.setItem(autosaveStorageKey(payload.projectId), JSON.stringify(payload));
  } catch { /* 存储不可用：放弃备份，不影响编辑 */ }
}

export function readAutosave(projectId: string, dirName: string): AutosavePayload | null {
  try {
    const scoped = parseAutosave(localStorage.getItem(autosaveStorageKey(projectId)));
    return scoped?.dirName === dirName ? scoped : null;
  } catch {
    return null;
  }
}

export function clearAutosave(projectId: string, dirName: string): void {
  try {
    localStorage.removeItem(autosaveStorageKey(projectId));
  } catch { /* 同上 */ }
}
