import type { ObjectIndex, AuthoringObject, RuntimeTraceEvent } from '@surdet/authoring';

export interface CausalTraceEvent {
  step?: number;
  sequence?: number;
  sourceRef?: string;
  kind?: string;
  event?: RuntimeTraceEvent;
  source?: RuntimeTraceEvent['source'];
}

export interface PreviewTraceSelectionDetail {
  event: CausalTraceEvent;
  objectRef: string | null;
  sequence: number;
}

export interface AuthoringObjectDisplay {
  title: string;
  location?: string;
  objectRef: string;
}

const PREVIEW_TRACE_SELECTION_EVENT = 'surdet-preview-trace-select';

function defaultEventTarget(): EventTarget {
  return window;
}

/** 预览轨迹与主编辑器共用同一个事件入口，避免 document/window 装配分叉。 */
export function dispatchPreviewTraceSelection(
  detail: PreviewTraceSelectionDetail,
  target: EventTarget = defaultEventTarget(),
): void {
  target.dispatchEvent(new CustomEvent<PreviewTraceSelectionDetail>(PREVIEW_TRACE_SELECTION_EVENT, { detail }));
}

export function listenForPreviewTraceSelection(
  listener: (detail: PreviewTraceSelectionDetail) => void,
  target: EventTarget = defaultEventTarget(),
): () => void {
  const handler: EventListener = (event) => {
    listener((event as CustomEvent<PreviewTraceSelectionDetail>).detail);
  };
  target.addEventListener(PREVIEW_TRACE_SELECTION_EVENT, handler);
  return () => target.removeEventListener(PREVIEW_TRACE_SELECTION_EVENT, handler);
}

function sceneNameFromPath(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.endsWith('.gal') ? file.slice(0, -'.gal'.length) : file;
}

function quotedSummary(kind: AuthoringObject['kind'], raw: string): string {
  const trimmed = raw.trim();
  if (kind === 'choice-option') {
    const label = trimmed.split(' -> ')[0]?.trim() ?? trimmed;
    return `选项“${label}”`;
  }
  if (kind === 'text') return `台词“${trimmed}”`;
  if (kind === 'label') return `标签“${trimmed.replace(/^@label\s+/, '')}”`;
  if (kind === 'choice') return '选择分支';
  if (kind === 'instruction') return `指令“${trimmed}”`;
  return trimmed;
}

export function describeAuthoringObject(object: AuthoringObject): AuthoringObjectDisplay {
  const raw = object.source?.raw ?? object.semanticId ?? object.objectRef;
  const kindNames: Record<AuthoringObject['kind'], string> = {
    scene: '场景',
    label: '标签',
    text: '台词',
    choice: '选择分支',
    'choice-option': '选项',
    instruction: '指令',
    variable: '变量',
    timeline: '时间轴',
    track: '轨道',
    cue: 'Cue',
    asset: '素材',
  };
  const semanticName = object.semanticId?.slice(object.semanticId.indexOf(':') + 1);
  const title = ['scene', 'variable', 'timeline', 'track', 'cue', 'asset'].includes(object.kind)
    ? `${kindNames[object.kind]} ${semanticName ?? object.objectRef}`
    : object.source
      ? quotedSummary(object.kind, raw)
      : `${kindNames[object.kind]} ${semanticName ?? object.objectRef}`;
  const location = object.source
    ? `${sceneNameFromPath(object.source.path)} · 第 ${object.source.line} 行`
    : undefined;
  return { title, ...(location === undefined ? {} : { location }), objectRef: object.objectRef };
}

export function describeAuthoringReference(ref: string): string {
  if (ref.startsWith('variable:')) return `变量 ${ref.slice('variable:'.length)}`;
  if (ref.startsWith('label:')) {
    const value = ref.slice('label:'.length);
    const separator = value.indexOf('.');
    if (separator >= 0) return `标签 ${value.slice(separator + 1)}（${value.slice(0, separator)}）`;
    return `标签 ${value}`;
  }
  if (ref.startsWith('scene:')) return `场景 ${ref.slice('scene:'.length)}`;
  if (ref.startsWith('asset:bg:')) return `背景 ${ref.slice('asset:bg:'.length)}`;
  if (ref.startsWith('asset:portrait:')) {
    const value = ref.slice('asset:portrait:'.length);
    const [role, outfit, expression] = value.split(':');
    return `立绘 ${role ?? ''}:${outfit ?? ''}（${expression ?? ''}）`;
  }
  if (ref.startsWith('timeline:') && ref.includes('/track:')) {
    const timeline = ref.slice('timeline:'.length).split('/track:')[0];
    const cueMatch = /\/track:(\d+)\/cue:(\d+)$/.exec(ref);
    if (cueMatch) return `Cue（${timeline} · 轨道 ${cueMatch[1]} · #${cueMatch[2]}）`;
    const trackMatch = /\/track:(\d+)$/.exec(ref);
    if (trackMatch) return `轨道（${timeline} · #${trackMatch[1]}）`;
    return ref;
  }
  if (ref.startsWith('timeline:')) return `时间轴 ${ref.slice('timeline:'.length)}`;
  return ref;
}

export interface TimelineObjectRef {
  timelineId: string;
  trackIndex: number | null;
  cueIndex: number | null;
}

/** 解析 timeline:<id>[/track:<n>[/cue:<m>]] 引用；非 timeline 引用返回 null。 */
export function parseTimelineObjectRef(ref: string): TimelineObjectRef | null {
  if (!ref.startsWith('timeline:')) return null;
  const rest = ref.slice('timeline:'.length);
  const cueMatch = /^(.+?)\/track:(\d+)\/cue:(\d+)$/.exec(rest);
  if (cueMatch) return { timelineId: cueMatch[1]!, trackIndex: Number(cueMatch[2]), cueIndex: Number(cueMatch[3]) };
  const trackMatch = /^(.+?)\/track:(\d+)$/.exec(rest);
  if (trackMatch) return { timelineId: trackMatch[1]!, trackIndex: Number(trackMatch[2]), cueIndex: null };
  return { timelineId: rest, trackIndex: null, cueIndex: null };
}

export function selectAuthoringObject(ref: string | null): string | null {
  return typeof ref === 'string' && ref.trim().length > 0 ? ref : null;
}

function sourceOf(event: CausalTraceEvent): RuntimeTraceEvent['source'] | undefined {
  if (event.event?.source) return event.event.source;
  return event.source;
}

function sourceMatches(object: AuthoringObject, source: RuntimeTraceEvent['source']): boolean {
  if (!object.source || object.source.line !== source.line) return false;
  if (object.source.path === source.file) return true;
  return object.source.path.endsWith(`/${source.file}`) || source.file.endsWith(`/${object.source.path}`);
}

/** 从已有 sourceRef 或共享对象索引定位事件，不在 editor 生成第二种对象 ID。 */
export function locateObjectForTraceEvent(event: CausalTraceEvent, index?: ObjectIndex): string | null {
  if (typeof event.sourceRef === 'string' && event.sourceRef.length > 0) return event.sourceRef;
  const source = sourceOf(event);
  if (!source || index === undefined) return null;
  const candidates = index.objects.filter((object) => sourceMatches(object, source));
  if (candidates.length === 0) return null;
  const preferred = candidates.find((object) => (
    (source.op === 'text' && object.kind === 'text')
    || (source.op === 'choice' && object.kind === 'choice')
    || (source.op === 'label' && object.kind === 'label')
    || (source.op === 'timeline' && object.kind === 'instruction')
  ));
  return (preferred ?? candidates[0])?.objectRef ?? null;
}

function objectDetails(object: AuthoringObject | undefined): Record<string, unknown> | null {
  if (object?.details === undefined || object.details === null || Array.isArray(object.details) || typeof object.details !== 'object') return null;
  return object.details as Record<string, unknown>;
}

function stageOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const stage = record['stage'];
  if (typeof stage === 'object' && stage !== null && !Array.isArray(stage)) return stage as Record<string, unknown>;
  return record;
}

/**
 * 从同一时间轴触发事件的前后 stage 快照差异，反查具体 timeline cue（Wave 2 反向定位）。
 * 顺序：新登场立绘 show cue → 背景 set cue → 屏幕 fade cue；无变化返回空数组。
 */
export function locateTimelineCuesForStageChange(
  before: unknown,
  after: unknown,
  index: ObjectIndex,
  timelineRef: string,
): string[] {
  const beforeStage = stageOf(before);
  const afterStage = stageOf(after);
  if (beforeStage === null || afterStage === null) return [];
  const cueObjects = index.objects.filter((object) => (
    object.kind === 'cue' && object.objectRef.startsWith(`${timelineRef}/track:`)
  ));
  const found: string[] = [];

  const beforePortraits = Array.isArray(beforeStage['portraits']) ? beforeStage['portraits'] as { key?: unknown }[] : [];
  const afterPortraits = Array.isArray(afterStage['portraits']) ? afterStage['portraits'] as { key?: unknown }[] : [];
  const beforeKeys = new Set(beforePortraits.map((p) => p?.key).filter((key): key is string => typeof key === 'string'));
  for (const portrait of afterPortraits) {
    const key = portrait?.key;
    if (typeof key !== 'string' || beforeKeys.has(key)) continue;
    const show = cueObjects.find((cue) => {
      const details = objectDetails(cue);
      if (details?.['action'] !== 'show') return false;
      const track = objectDetails(index.byRef.get(cue.parentRef ?? ''));
      return track?.['target'] === key;
    });
    if (show) found.push(show.objectRef);
  }

  const beforeBg = beforeStage['backgroundKey'];
  const afterBg = afterStage['backgroundKey'];
  if (afterBg !== beforeBg && typeof afterBg === 'string' && afterBg.length > 0) {
    const set = cueObjects.find((cue) => {
      if (objectDetails(cue)?.['key'] !== afterBg) return false;
      return objectDetails(index.byRef.get(cue.parentRef ?? ''))?.['kind'] === 'background';
    });
    if (set) found.push(set.objectRef);
  }

  if (beforeStage['fadeAlpha'] !== afterStage['fadeAlpha']) {
    const fades = cueObjects.filter((cue) => (
      objectDetails(cue)?.['action'] === 'fade'
      && objectDetails(index.byRef.get(cue.parentRef ?? ''))?.['kind'] === 'screen'
    )).sort((left, right) => (
      Number(objectDetails(right)?.['durationMs'] ?? 0) - Number(objectDetails(left)?.['durationMs'] ?? 0)
    ));
    if (fades.length > 0) found.push(fades[0]!.objectRef);
  }
  return found;
}

export function filterTraceByObject<T extends CausalTraceEvent>(selectedRef: string, trace: readonly T[], index?: ObjectIndex): T[] {
  return trace.filter((event) => locateObjectForTraceEvent(event, index) === selectedRef);
}
