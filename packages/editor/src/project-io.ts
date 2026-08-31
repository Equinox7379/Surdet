/**
 * 项目读写（E0 拆分：原 main.ts 纯搬移）。
 * File System Access 打开目录 / 递归读场景 / 保存回目录 / 下载导出兜底 / 内存演示项目。
 * UI 联动（renderAll/runValidate/renderSidebar）经钩子注入，保持模块无环。
 */
import { state, setStatus } from './state.js';
import { histories } from './history.js';
import { clearTimelineHistories, clearTimelineHistory, pushTimelineSnapshot } from './timeline-history.js';
import { resolveAutosaveProjectIdentity } from './autosave.js';
import type { AutosaveTimelineEntry } from './autosave.js';
import {
  inspectTimelineAutosaveIdentity,
  normalizeTimelineAutosaveDocument,
  type TimelineAutosaveDocument,
  type TimelineAutosaveIdentity,
} from './timeline-autosave-identity.js';
import { timelinePathFor } from '@surdet/authoring';
import { kindOfDir, parsePortraitFileName } from './assets.js';
import type { AssetKind } from './assets.js';

let renderAll: () => void = () => {};
let runValidate: () => void = () => {};
let renderSidebar: () => void = () => {};
/** 项目载入完成（崩溃保险恢复检查挂点；A1） */
let onProjectLoaded: () => void = () => {};
/** 保存全部完成（清除崩溃备份挂点；A1） */
let onSaved: () => void = () => {};
/** 保存尝试完成后的 UI 事实投影；不改变任何写盘或恢复语义。 */
let onSaveSettled: (outcome: ProjectSaveOutcome) => void = () => {};
let onTimelineDeleted: (timelineId: string) => void = () => {};

export interface ProjectSaveOutcome {
  hadPendingChanges: boolean;
  saved: number;
  removed: number;
  failures: number;
  remainingDirty: boolean;
}

export function bindProjectIoHooks(opts: {
  renderAll: () => void;
  runValidate: () => void;
  renderSidebar: () => void;
  onProjectLoaded?: () => void;
  onSaved?: () => void;
  onSaveSettled?: (outcome: ProjectSaveOutcome) => void;
  onTimelineDeleted?: (timelineId: string) => void;
}): void {
  renderAll = opts.renderAll;
  runValidate = opts.runValidate;
  renderSidebar = opts.renderSidebar;
  onProjectLoaded = opts.onProjectLoaded ?? (() => {});
  onSaved = opts.onSaved ?? (() => {});
  onSaveSettled = opts.onSaveSettled ?? (() => {});
  onTimelineDeleted = opts.onTimelineDeleted ?? (() => {});
}

export async function openProject(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker: (opts?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const dir = await picker({ mode: 'readwrite' });
  await openProjectFromHandle(dir);
}

export async function openProjectFromHandle(
  dir: FileSystemDirectoryHandle,
  options: { source?: 'normal' | 'review-fixture' } = {},
): Promise<void> {
  state.projectLoading = true;
  if ((options.source ?? 'normal') === 'normal') {
    state.reviewWorkspace = null;
    state.mainTab = 'editor';
  } else {
    state.mainTab = 'review';
  }
  state.dirName = dir.name;
  state.dirHandle = dir;
  state.scenes.clear();
  state.timelines = [];
  state.pendingTimelineDeletes = [];
  state.pendingTimelineRestores.clear();
  state.currentTimeline = null;
  state.currentTimelineCue = null;
  state.previewTimelineId = null;
  histories.clear(); // 换项目：历史栈失效
  clearTimelineHistories();
  state.handles = { gameConfig: null, achievements: null, calendar: null, events: null, growth: null, gallery: null, terminology: null };
  state.dirAssets = [];
  // content/config/*.json（E1a：流程图宿主入口与 CLI collectConfigSceneRoots 同源；
  // E2/E3：achievements/gallery 供素材清单与配置编辑器；解析失败按无配置）
  state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
  for (const name of ['events', 'growth', 'calendar', 'achievements', 'gallery', 'terminology'] as const) {
    try {
      const contentDir = await dir.getDirectoryHandle('content');
      const configDir = await contentDir.getDirectoryHandle('config');
      const fh = await configDir.getFileHandle(`${name}.json`);
      state.configFiles[name] = JSON.parse(await (await fh.getFile()).text()) as unknown;
      // 配置编辑器写盘句柄（E3 全部配置文件）
      if (name === 'achievements' || name === 'calendar' || name === 'events' || name === 'growth' || name === 'gallery' || name === 'terminology') {
        state.handles[name] = fh;
      }
    } catch {
      state.configFiles[name] = null;
    }
  }
  // game.config.json（entryScene/变量表；句柄供变量编辑器写盘）
  try {
    const cfgHandle = await dir.getFileHandle('game.config.json');
    state.handles.gameConfig = cfgHandle;
    state.gameConfigText = await (await cfgHandle.getFile()).text();
    const cfg = JSON.parse(state.gameConfigText) as { entryScene?: string };
    state.entryScene = typeof cfg.entryScene === 'string' ? cfg.entryScene : '';
  } catch {
    state.gameConfigText = '';
    state.entryScene = '';
  }
  // 素材目录扫描（E2）：content/assets 与 public/，目录约定类型，无目录静默跳过
  try {
    const contentDir = await dir.getDirectoryHandle('content');
    const assetsDir = await contentDir.getDirectoryHandle('assets');
    await walkAssetDir(assetsDir, 'content/assets');
  } catch { /* 无素材目录 */ }
  try {
    const publicDir = await dir.getDirectoryHandle('public');
    await walkAssetDir(publicDir, 'public');
  } catch { /* 无 public 目录 */ }
  // 递归读取 content/scenario/**/*.gal
  try {
    const contentDir = await dir.getDirectoryHandle('content');
    const scenarioDir = await contentDir.getDirectoryHandle('scenario');
    await readScenarioDir(scenarioDir, '');
  } catch {
    /* 无剧本目录：空项目 */
  }
  try {
    const contentDir = await dir.getDirectoryHandle('content');
    const timelineDir = await contentDir.getDirectoryHandle('timelines');
    await readTimelineDir(timelineDir, '');
  } catch {
    /* 没有时间轴目录按空目录处理 */
  }
  const first = state.scenes.keys().next().value as string | undefined;
  state.current = first ?? null;
  state.currentTimeline = state.timelines[0]?.id ?? null;
  state.autosaveProjectId = await resolveAutosaveProjectIdentity(dir);
  state.projectLoading = false;
  renderAll();
  runValidate(); // 打开后立即校验
  if (!state.autosaveProjectId) {
    setStatus('当前浏览器无法安全识别项目目录，自动备份未启用', false, 8000);
  }
  onProjectLoaded(); // 崩溃保险：检查同项目未保存快照（A1）
}

/** 素材目录扫描（E2）：顶层目录定类型（bg/portrait/avatar/bgm/se/voice/video），子目录继承类型；
 *  未知类型的目录/文件跳过（不强制素材约定） */
const IMG_RE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

/** handle → 项目相对路径（'/' 分隔；供共享 asset catalog 的路径元数据枚举，不读文件内容）。 */
const assetPathByHandle = new WeakMap<FileSystemFileHandle, string>();

export function recordAssetPath(handle: FileSystemFileHandle, relativePath: string): void {
  assetPathByHandle.set(handle, relativePath);
}

export function assetPathForHandle(handle: FileSystemFileHandle): string | undefined {
  return assetPathByHandle.get(handle);
}

async function walkAssetDir(root: FileSystemDirectoryHandle, basePath: string): Promise<void> {
  const walk = async (dh: FileSystemDirectoryHandle, kind: AssetKind | null, relative: string): Promise<void> => {
    const entries = (dh as unknown as {
      values: () => AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
    }).values();
    for await (const ent of entries) {
      if (ent.kind === 'directory') {
        await walk(ent, kind ?? kindOfDir(ent.name), relative.length === 0 ? ent.name : `${relative}/${ent.name}`);
      } else if (ent.kind === 'file' && kind) {
        const filePath = relative.length === 0 ? ent.name : `${relative}/${ent.name}`;
        recordAssetPath(ent, `${basePath}/${filePath}`);
        if (kind === 'portrait') {
          const { key, expr } = parsePortraitFileName(ent.name);
          state.dirAssets.push({ key, kind, expr, handle: ent, isImage: IMG_RE.test(ent.name) });
        } else {
          const key = ent.name.replace(/\.[^.]+$/, '');
          state.dirAssets.push({ key, kind, handle: ent, isImage: IMG_RE.test(ent.name) });
        }
      }
    }
  };
  await walk(root, null, '');
}

/** 配置文件写盘（E3 共用：创建可写流 → 写入 → 关闭） */
export async function writeFileHandle(fh: FileSystemFileHandle, text: string): Promise<void> {
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}

export async function readScenarioDir(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
  // values() 异步迭代器未包含在默认 DOM lib 类型中，显式断言
  const entries = (dir as unknown as {
    values: () => AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }).values();
  for await (const ent of entries) {
    if (ent.kind === 'directory') {
      await readScenarioDir(ent, prefix + ent.name + '/');
    } else if (ent.kind === 'file' && ent.name.endsWith('.gal')) {
      const id = ent.name.replace(/\.gal$/, '');
      const text = await (await ent.getFile()).text();
      // key = 相对路径：子目录同名 .gal 各占一条，同名冲突由校验 LINT_DUP 显式报错（M4）
      const key = prefix + id;
      state.scenes.set(key, {
        id,
        file: prefix + ent.name,
        text,
        eol: text.includes('\r\n') ? '\r\n' : '\n',
        dirty: false,
        handle: ent,
      });
    }
  }
}

/** 递归读取 content/timelines 下的 JSON；文本原样保留，预览发送时再解析。 */
export async function readTimelineDir(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
  const entries = (dir as unknown as {
    values: () => AsyncIterable<FileSystemDirectoryHandle | FileSystemFileHandle>;
  }).values();
  for await (const ent of entries) {
    if (ent.kind === 'directory') {
      await readTimelineDir(ent, prefix + ent.name + '/');
    } else if (ent.kind === 'file' && ent.name.endsWith('.json')) {
      const text = await (await ent.getFile()).text();
      state.timelines.push({
        id: ent.name.replace(/\.json$/, ''),
        file: prefix + ent.name,
        text,
        eol: text.includes('\r\n') ? '\r\n' : '\n',
        dirty: false,
        handle: ent,
      });
    }
  }
}

export interface TimelineAutosaveRestoreResult {
  restored: number;
  conflicts: TimelineAutosaveRestoreConflict[];
}

export type TimelineAutosaveConflictReason =
  | 'recovered-json-invalid'
  | 'recovered-id-mismatch'
  | 'current-json-invalid'
  | 'current-id-mismatch'
  | 'same-file-different-id'
  | 'same-id-different-file'
  | 'definition-id-collision'
  | 'quarantined-backup';

export interface TimelineAutosaveRestoreConflict {
  key: string;
  reason: TimelineAutosaveConflictReason;
  recovered: AutosaveTimelineEntry;
  recoveredIdentity: TimelineAutosaveIdentity;
  current: TimelineAutosaveDocument | null;
  currentIdentity: TimelineAutosaveIdentity | null;
}

export type TimelineAutosaveRepairAction =
  | { kind: 'replace-current' }
  | { kind: 'save-as-new'; newId: string };

export type TimelineAutosaveRepairResult =
  | { ok: true; timelineId: string }
  | { ok: false; error: string };

function timelineDocument(entry: TimelineAutosaveDocument): TimelineAutosaveDocument {
  return { id: entry.id, file: entry.file, text: entry.text, eol: entry.eol };
}

function timelineRestoreConflict(
  recovered: AutosaveTimelineEntry,
  recoveredIdentity: TimelineAutosaveIdentity,
  reason: TimelineAutosaveConflictReason,
  index: number,
  current: TimelineAutosaveDocument | null = null,
): TimelineAutosaveRestoreConflict {
  const currentSnapshot = current ? timelineDocument(current) : null;
  return {
    key: `${recovered.id}\0${recovered.file}\0${index}`,
    reason,
    recovered: timelineDocument(recovered),
    recoveredIdentity,
    current: currentSnapshot,
    currentIdentity: currentSnapshot ? inspectTimelineAutosaveIdentity(currentSnapshot) : null,
  };
}

type TimelineAutosaveRestoreDecision =
  | { kind: 'conflict'; conflict: TimelineAutosaveRestoreConflict }
  | { kind: 'replace'; target: (typeof state.timelines)[number] }
  | { kind: 'insert' };

function classifyTimelineAutosaveEntry(
  recovered: AutosaveTimelineEntry,
  index: number,
): TimelineAutosaveRestoreDecision {
  const recoveredIdentity = inspectTimelineAutosaveIdentity(recovered);
  if (recoveredIdentity.parseError !== null) {
    return {
      kind: 'conflict',
      conflict: timelineRestoreConflict(recovered, recoveredIdentity, 'recovered-json-invalid', index),
    };
  }
  if (!recoveredIdentity.canonical) {
    return {
      kind: 'conflict',
      conflict: timelineRestoreConflict(recovered, recoveredIdentity, 'recovered-id-mismatch', index),
    };
  }

  const sameFile = state.timelines.find((entry) => entry.file === recovered.file);
  if (sameFile && sameFile.id !== recovered.id) {
    return {
      kind: 'conflict',
      conflict: timelineRestoreConflict(
        recovered, recoveredIdentity, 'same-file-different-id', index, sameFile,
      ),
    };
  }
  const sameId = state.timelines.find((entry) => entry.id === recovered.id);
  if (sameId && sameId.file !== recovered.file) {
    return {
      kind: 'conflict',
      conflict: timelineRestoreConflict(
        recovered, recoveredIdentity, 'same-id-different-file', index, sameId,
      ),
    };
  }

  const exact = state.timelines.find((entry) => entry.id === recovered.id && entry.file === recovered.file);
  if (exact) {
    const currentIdentity = inspectTimelineAutosaveIdentity(exact);
    if (currentIdentity.parseError !== null) {
      return {
        kind: 'conflict',
        conflict: timelineRestoreConflict(
          recovered, recoveredIdentity, 'current-json-invalid', index, exact,
        ),
      };
    }
    if (!currentIdentity.canonical) {
      return {
        kind: 'conflict',
        conflict: timelineRestoreConflict(
          recovered, recoveredIdentity, 'current-id-mismatch', index, exact,
        ),
      };
    }
    return { kind: 'replace', target: exact };
  }

  const definitionCollision = state.timelines.find((entry) => (
    inspectTimelineAutosaveIdentity(entry).definitionId === recoveredIdentity.definitionId
  ));
  if (definitionCollision) {
    return {
      kind: 'conflict',
      conflict: timelineRestoreConflict(
        recovered, recoveredIdentity, 'definition-id-collision', index, definitionCollision,
      ),
    };
  }
  return { kind: 'insert' };
}

export function restoreTimelineAutosaveEntries(entries: readonly AutosaveTimelineEntry[]): TimelineAutosaveRestoreResult {
  let restored = 0;
  const conflicts: TimelineAutosaveRestoreResult['conflicts'] = [];
  for (const [index, recovered] of entries.entries()) {
    const decision = classifyTimelineAutosaveEntry(recovered, index);
    if (decision.kind === 'conflict') {
      conflicts.push(decision.conflict);
      continue;
    }
    if (decision.kind === 'replace') {
      decision.target.text = recovered.text;
      decision.target.eol = recovered.eol;
      decision.target.dirty = true;
    } else {
      state.timelines.push({
        id: recovered.id,
        file: recovered.file,
        text: recovered.text,
        eol: recovered.eol,
        dirty: true,
        handle: null,
      });
    }
    restored++;
  }
  if (!state.currentTimeline && state.timelines.length > 0) {
    state.currentTimeline = state.timelines[0]!.id;
  }
  return { restored, conflicts };
}

export function quarantineTimelineAutosaveEntries(
  entries: readonly AutosaveTimelineEntry[],
): TimelineAutosaveRestoreConflict[] {
  return entries.map((recovered, index) => {
    const decision = classifyTimelineAutosaveEntry(recovered, index);
    const conflict = decision.kind === 'conflict'
      ? decision.conflict
      : timelineRestoreConflict(
        recovered,
        inspectTimelineAutosaveIdentity(recovered),
        'quarantined-backup',
        index,
        decision.kind === 'replace' ? decision.target : null,
      );
    return { ...conflict, key: `quarantine:${conflict.key}` };
  });
}

function repairFailure(error: string): TimelineAutosaveRepairResult {
  return { ok: false, error };
}

function timelineDefinitionId(entry: TimelineAutosaveDocument): string | null {
  return inspectTimelineAutosaveIdentity(entry).definitionId;
}

export function repairTimelineAutosaveConflict(
  conflict: TimelineAutosaveRestoreConflict,
  action: TimelineAutosaveRepairAction,
): TimelineAutosaveRepairResult {
  if (action.kind === 'replace-current') {
    const current = conflict.current;
    if (current === null) return repairFailure('当前项目中没有可替换的演出');

    const targets = state.timelines.filter((entry) => entry.id === current.id && entry.file === current.file);
    if (targets.length !== 1) return repairFailure('当前演出已变化或不唯一，请重新打开项目后再处理');
    const target = targets[0]!;
    if (target.text !== current.text || target.eol !== current.eol) {
      return repairFailure('当前演出已在冲突出现后发生变化，未执行替换');
    }

    const normalized = normalizeTimelineAutosaveDocument(conflict.recovered, target.id, target.file);
    if (!normalized.ok) return repairFailure(normalized.error);
    if (!inspectTimelineAutosaveIdentity(normalized.entry).canonical) {
      return repairFailure('自动备份规范化后身份仍不一致');
    }

    pushTimelineSnapshot(
      target.id,
      target.text,
      state.currentTimeline === target.id && state.currentTimelineCue
        ? { ...state.currentTimelineCue }
        : null,
    );
    target.text = normalized.entry.text;
    target.eol = normalized.entry.eol;
    target.dirty = true;
    return { ok: true, timelineId: target.id };
  }

  const newId = action.newId.trim();
  let projectPath: string;
  try {
    projectPath = timelinePathFor(newId);
  } catch (error) {
    return repairFailure(error instanceof Error ? error.message : String(error));
  }
  const newFile = projectPath.slice('content/timelines/'.length);
  const currentCollision = state.timelines.some((entry) => (
    entry.id === newId
    || entry.file === newFile
    || timelineDefinitionId(entry) === newId
  ));
  if (currentCollision) return repairFailure(`演出 ID 或文件已存在：${newId}`);

  const deletedCollision = state.pendingTimelineDeletes.some((entry) => (
    entry.id === newId || entry.file === newFile
  ));
  if (deletedCollision) return repairFailure(`演出仍在待删除列表中：${newId}`);

  const restoreCollision = [...state.pendingTimelineRestores.entries()].some(([id, restore]) => (
    id === newId
    || restore.entry.id === newId
    || restore.entry.file === newFile
    || timelineDefinitionId(restore.entry) === newId
  ));
  if (restoreCollision) return repairFailure(`演出仍在可恢复列表中：${newId}`);

  const normalized = normalizeTimelineAutosaveDocument(conflict.recovered, newId, newFile);
  if (!normalized.ok) return repairFailure(normalized.error);
  if (!inspectTimelineAutosaveIdentity(normalized.entry).canonical) {
    return repairFailure('另存后的演出身份仍不一致');
  }

  state.timelines.push({
    ...normalized.entry,
    dirty: true,
    handle: null,
  });
  return { ok: true, timelineId: newId };
}

export async function saveAll(): Promise<void> {
  if (!state.fsSupported) {
    const timeline = state.currentTimeline
      ? state.timelines.find((entry) => entry.id === state.currentTimeline)
      : undefined;
    if (timeline) exportTimeline(timeline.id, timeline.text);
    else exportCurrent();
    const remainingDirty = [...state.scenes.values()].some((scene) => scene.dirty)
      || state.timelines.some((entry) => entry.dirty)
      || state.pendingTimelineDeletes.length > 0
      || state.pendingTimelineRestores.size > 0;
    onSaveSettled({
      hadPendingChanges: remainingDirty,
      saved: 0,
      removed: 0,
      failures: 0,
      remainingDirty,
    });
    return;
  }
  const hadPendingChanges = [...state.scenes.values()].some((scene) => scene.dirty)
    || state.timelines.some((timeline) => timeline.dirty)
    || state.pendingTimelineDeletes.length > 0
    || state.pendingTimelineRestores.size > 0;
  let saved = 0;
  let removed = 0;
  let failures = 0;
  const failureMessages: string[] = [];
  const recordFailure = (label: string, err: unknown): void => {
    failures++;
    const message = err instanceof Error ? err.message : String(err);
    failureMessages.push(`${label}：${message}`);
    setStatus(`${label}失败：${message}`, false, 6000);
  };
  if (state.dirHandle) {
    const remaining: typeof state.pendingTimelineDeletes = [];
    for (const pending of state.pendingTimelineDeletes) {
      try {
        const contentDir = await state.dirHandle.getDirectoryHandle('content');
        let timelineDir = await contentDir.getDirectoryHandle('timelines');
        const parts = pending.file.split('/').filter(Boolean);
        const fileName = parts.pop();
        if (!fileName) {
          recordFailure(`时间轴 '${pending.id}' 删除`, new Error('文件名为空'));
          remaining.push(pending);
          continue;
        }
        for (const part of parts) timelineDir = await timelineDir.getDirectoryHandle(part);
        await timelineDir.removeEntry(fileName);
        state.pendingTimelineRestores.delete(pending.id);
        clearTimelineHistory(pending.id);
        onTimelineDeleted(pending.id);
        removed++;
      } catch (err) {
        remaining.push(pending);
        recordFailure(`时间轴 '${pending.id}' 删除`, err);
      }
    }
    state.pendingTimelineDeletes = remaining;
    for (const [timelineId, restore] of [...state.pendingTimelineRestores]) {
      if (restore.entry.handle !== null) continue;
      state.pendingTimelineRestores.delete(timelineId);
      clearTimelineHistory(timelineId);
      onTimelineDeleted(timelineId);
      removed++;
    }
  }
  for (const [key, sc] of state.scenes) {
    if (!sc.dirty) continue;
    const handle = sc.handle;
    if (!handle) {
      // 新建场景：在项目目录 content/scenario/ 下真实创建文件落盘（M3：不再以下载冒充保存）
      if (state.dirHandle) {
        try {
          const contentDir = await state.dirHandle.getDirectoryHandle('content', { create: true });
          const scenarioDir = await contentDir.getDirectoryHandle('scenario', { create: true });
          const fileName = `${sc.id}.gal`;
          const fh = await scenarioDir.getFileHandle(fileName, { create: true });
          await writeFileHandle(fh, sc.text);
          sc.handle = fh;
          sc.file = `content/scenario/${fileName}`;
          sc.dirty = false;
          saved++;
        } catch (err) {
          recordFailure(`场景 '${sc.id}' 创建`, err);
        }
        continue;
      }
      // 演示项目（无目录句柄）：下载导出 + 保留脏标记，诚实提示（不冒充已保存）
      exportScene(sc.id, sc.text);
      recordFailure(`演示项目场景 '${sc.id}' 保存`, new Error(`已下载 ${sc.id}.gal，请手动放入 content/scenario/（脏标记保留）`));
      continue;
    }
    try {
      await writeFileHandle(handle, sc.text);
      sc.dirty = false;
      saved++;
    } catch (err) {
      recordFailure(`场景 '${sc.id}' 保存`, err);
    }
    void key;
  }
  let timelineSaved = false;
  for (const timeline of state.timelines) {
    if (!timeline.dirty) continue;
    try {
      let handle = timeline.handle;
      if (!handle) {
        if (!state.dirHandle) {
          exportTimeline(timeline.id, timeline.text);
          recordFailure(`演示项目时间轴 '${timeline.id}' 保存`, new Error(`已下载 ${timeline.id}.json（脏标记保留）`));
          continue;
        }
        const contentDir = await state.dirHandle.getDirectoryHandle('content', { create: true });
        const parts = timeline.file.split('/').filter(Boolean);
        const fileName = parts.pop() ?? `${timeline.id}.json`;
        let timelineDir = await contentDir.getDirectoryHandle('timelines', { create: true });
        for (const part of parts) timelineDir = await timelineDir.getDirectoryHandle(part, { create: true });
        handle = await timelineDir.getFileHandle(fileName, { create: true });
        timeline.handle = handle;
      }
      await writeFileHandle(handle, timeline.text);
      timeline.dirty = false;
      timelineSaved = true;
      saved++;
    } catch (err) {
      recordFailure(`时间轴 '${timeline.id}' 保存`, err);
    }
  }
  const remainingDirty = [...state.scenes.values()].some((scene) => scene.dirty)
    || state.timelines.some((timeline) => timeline.dirty)
    || state.pendingTimelineDeletes.length > 0
    || state.pendingTimelineRestores.size > 0;
  const changed = saved + removed;
  if (!hadPendingChanges) {
    setStatus('无待保存改动', true, 4000);
  } else if (failures === 0 && !remainingDirty) {
    setStatus(`全部成功：已保存 ${saved} 项${removed > 0 ? `，删除 ${removed} 条时间轴` : ''}`, true, 4000);
  } else if (changed > 0) {
    setStatus(`部分成功：已保存 ${saved} 项${removed > 0 ? `，删除 ${removed} 条时间轴` : ''}，失败 ${failures} 项`, false, 6000);
  } else {
    setStatus(`全部失败：${failures} 项操作失败`, false, 6000);
  }
  if (timelineSaved) renderAll();
  else renderSidebar();
  if (failures === 0 && !remainingDirty) {
    onSaved(); // 崩溃保险：仅在磁盘已最新时清除备份
  }
  onSaveSettled({ hadPendingChanges, saved, removed, failures, remainingDirty });
}

export function exportScene(id: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${id}.gal`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function exportCurrent(): void {
  if (!state.current) return;
  const sc = state.scenes.get(state.current);
  if (sc) exportScene(state.current, sc.text);
}

export function exportTimeline(id: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 无 FS API 环境的内存演示项目 */
export function loadDemoProject(): void {
  state.projectLoading = true;
  state.reviewWorkspace = null;
  state.mainTab = 'editor';
  state.dirName = '（演示项目·未连接目录）';
  state.dirHandle = null;
  state.scenes.clear();
  state.timelines = [];
  state.pendingTimelineDeletes = [];
  state.pendingTimelineRestores.clear();
  state.currentTimeline = null;
  state.currentTimelineCue = null;
  state.previewTimelineId = null;
  histories.clear();
  clearTimelineHistories();
  state.gameConfigText = '';
  state.entryScene = 'demo';
  state.handles = { gameConfig: null, achievements: null, calendar: null, events: null, growth: null, gallery: null, terminology: null };
  state.dirAssets = [];
  state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
  state.scenes.set('demo', {
    id: 'demo',
    file: 'demo.gal',
    text: '@scene demo\n@bg hall\n凛：你好，这里是演示场景。\n@choice\n  打个招呼 -> @goto greet\n  沉默离开 -> @goto bye\n@label greet\n凛：很高兴见到你。\n@end\n@label bye\n凛：……下次见。\n@end',
    eol: '\n',
    dirty: false,
    handle: null,
  });
  state.timelines.push({
    id: 'demo_intro',
    file: 'demo_intro.json',
    text: JSON.stringify({
      version: 1,
      id: 'demo_intro',
      durationMs: 1200,
      tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 800, easing: 'inOutSine', action: 'fade', alpha: 0 }] }],
    }, null, 2) + '\n',
    eol: '\n',
    dirty: false,
    handle: null,
  });
  state.current = 'demo';
  state.currentTimeline = 'demo_intro';
  state.autosaveProjectId = 'demo-project';
  state.projectLoading = false;
  renderAll();
  runValidate();
  onProjectLoaded(); // 崩溃保险：演示项目同样支持恢复（dirName 区分）
}
