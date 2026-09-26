import { compileScene, type StageSource, type StageInspectionObject } from '@surdet/core';
import {
  beginChange, InMemoryChangeRepository, applyScenePatch, applyTimelinePatch, buildObjectIndex,
  loadProjectSnapshot, parseTimelineDefinition, timelineSelectionFingerprint, timelineFingerprint,
  type ScenePatchInput, type TimelineCueInput,
} from '@surdet/authoring';
import { state } from './state.js';
import { createEditorProjectStorage } from './authoring-project-storage.js';
import { assertProjectWriteUnlocked } from './project-io.js';
import { setSceneText } from './history.js';
import { pushTimelineSnapshot } from './timeline-history.js';

export type StageEditValues = Extract<ScenePatchInput['patch'], { kind: 'patchStageProperties' }>['values'];
export interface StageEditBaseline {
  root: FileSystemDirectoryHandle | null;
  name: string;
  configText: string;
  scenes: Map<string, { id: string; file: string; text: string }>;
  timelines: Map<string, { file: string; text: string }>;
}
let onTimelineEdited: () => void = () => {};
export function bindStageEditingHooks(hooks: { onTimelineEdited: () => void }): void { onTimelineEdited = hooks.onTimelineEdited; }

export function captureStageEditBaseline(): StageEditBaseline {
  return { root: state.dirHandle, name: state.dirName, configText: state.gameConfigText,
    scenes: new Map([...state.scenes].map(([key, scene]) => [key, { id: scene.id, file: scene.file, text: scene.text }])),
    timelines: new Map(state.timelines.map(entry => [entry.id, { file: entry.file, text: entry.text }])) };
}
export function assertStageEditCurrent(baseline: StageEditBaseline): void {
  assertProjectWriteUnlocked();
  if (state.projectLoading || state.pendingSceneCommit != null || state.reviewPreviewReadOnly || state.reviewWorkspace !== null
    || state.dirHandle !== baseline.root || state.dirName !== baseline.name || state.gameConfigText !== baseline.configText) {
    throw new Error('项目、配置或只读来源已经变化；请重新播放后再调整舞台。');
  }
}
export function stageSourceLabel(source: StageSource | null): string {
  if (!source) return '来源不明，不能回写';
  if (source.kind === 'scene') return `${source.file} · 第 ${source.line} 行`;
  if (source.kind === 'composition') return `game.config.json · 构图 ${source.id}`;
  return `${source.timelineId}.json · 轨道 ${source.trackIndex + 1} / 片段 ${source.cueIndex + 1}`
    + (source.instances?.length ? `（引用自 ${source.instances.map(item => `${item.timelineId}[${item.clipIndex + 1}]`).join(' → ')}）` : '');
}
export function sourceForStageProperty(object: StageInspectionObject, property: string): StageSource | null {
  return object.propertySources[property] ?? object.source;
}

/** One explicit application means one existing scene or timeline history item.
 * Pointer moves are never sent here, and this function never writes disk. */
export async function applyStageSourceEdit(baseline: StageEditBaseline, source: StageSource, values: StageEditValues,
  options: { allowVersionUpgrade?: boolean; allowClipDefinition?: boolean } = {}): Promise<{ path: string; changed: boolean }> {
  assertStageEditCurrent(baseline);
  if (source.kind === 'composition') throw new Error('构图配置须使用单独的保存配置入口。');
  if (source.kind === 'timeline' && source.instances?.length && !options.allowClipDefinition) throw new Error('请明确确认修改被引用的片段定义；这会影响它的所有引用。');
  const storage = createEditorProjectStorage();
  const snapshot = await loadProjectSnapshot(storage, storage);
  const change = await beginChange(snapshot, new InMemoryChangeRepository());
  change.record.composition = { ...change.record.composition!, mode: 'direct' };
  if (source.kind === 'scene') {
    const candidates = [...baseline.scenes].filter(([, scene]) => source.sceneId ? scene.id === source.sceneId
      : scene.file === source.file || `${scene.id}.gal` === source.file);
    if (candidates.length !== 1) throw new Error('无法唯一确定舞台来源场景。');
    const [key, before] = candidates[0]!;
    const current = state.scenes.get(key);
    if (!current || current.text !== before.text || current.file !== before.file) throw new Error('来源场景已经改变，请重新预览。');
    const path = before.file.startsWith('content/scenario/') ? before.file : `content/scenario/${before.file}`;
    const objects = buildObjectIndex(snapshot).objects.filter(object => object.source?.path === path && object.source.line === source.line
      && (object.kind === 'instruction' || object.kind === 'choice-option'));
    if (objects.length !== 1 || !objects[0]!.fingerprint) throw new Error('来源对象位置不再唯一；未修改相邻行。');
    const compiled = compileScene(before.text, path, before.id);
    const instructions = compiled.instructions.filter(instruction => instruction.op === 'instr' && instruction.line === source.line && ['show', 'pose', 'layer'].includes(instruction.name));
    const instructionIndex = source.instructionIndex ?? (instructions.length === 1 ? instructions[0]!.index : -1);
    await applyScenePatch(change, { operationId: crypto.randomUUID(), sceneId: before.id, patch: {
      kind: 'patchStageProperties', target: objects[0]!.objectRef, expectedFingerprint: objects[0]!.fingerprint!, instructionIndex, values,
    } }, storage);
    const after = change.record.workingFiles[path]!;
    assertStageEditCurrent(baseline);
    if (state.scenes.get(key) !== current || current.text !== before.text) throw new Error('处理期间来源场景已变化；试改值仍保留。');
    if (after === before.text) return { path, changed: false };
    setSceneText(key, after);
    return { path, changed: true };
  }
  const before = baseline.timelines.get(source.timelineId);
  const entries = state.timelines.filter(entry => entry.id === source.timelineId);
  if (!before || entries.length !== 1 || entries[0]!.text !== before.text || entries[0]!.file !== before.file) throw new Error('来源时间轴已经变化，请重新预览。');
  const entry = entries[0]!;
  const definition = parseTimelineDefinition(before.text);
  const track = definition.tracks[source.trackIndex], cue = track?.cues[source.cueIndex];
  if (!track || !cue || !['portrait', 'layer'].includes(track.kind) || !['show', 'pose', 'move'].includes(cue.action)) throw new Error('选定片段不是可编辑的对象变换。');
  if (definition.version === 1) {
    if (!options.allowVersionUpgrade) throw new Error('这个时间轴仍为版本 1；请明确确认升级后再应用独立变换。');
    await applyTimelinePatch(change, { operationId: crypto.randomUUID(), timelineId: source.timelineId,
      patch: { kind: 'setVersion', version: 2, expectedFingerprint: await timelineFingerprint(definition, storage) } }, storage);
  }
  const path = entry.file.startsWith('content/timelines/') ? entry.file : `content/timelines/${entry.file}`;
  const working = parseTimelineDefinition(change.record.workingFiles[path]!);
  const ref = `timeline:${source.timelineId}/track:${source.trackIndex}/cue:${source.cueIndex}`;
  await applyTimelinePatch(change, { operationId: crypto.randomUUID(), timelineId: source.timelineId, patch: {
    kind: 'replaceCue', cueRef: ref, expectedFingerprint: await timelineSelectionFingerprint(working, ref, storage),
    cue: { ...working.tracks[source.trackIndex]!.cues[source.cueIndex]!, ...values } as TimelineCueInput,
  } }, storage);
  const after = change.record.workingFiles[path]!;
  assertStageEditCurrent(baseline);
  if (!state.timelines.includes(entry) || entry.text !== before.text) throw new Error('处理期间来源时间轴已变化；试改值仍保留。');
  if (after === before.text) return { path, changed: false };
  pushTimelineSnapshot(entry.id, before.text, state.currentTimeline === entry.id ? state.currentTimelineCue : null);
  entry.text = after; entry.dirty = true; state.currentTimeline = entry.id; state.currentTimelineCue = { trackIndex: source.trackIndex, cueIndex: source.cueIndex };
  onTimelineEdited();
  return { path, changed: true };
}
