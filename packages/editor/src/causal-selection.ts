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
    asset: '素材',
  };
  const semanticName = object.semanticId?.slice(object.semanticId.indexOf(':') + 1);
  const title = ['scene', 'variable', 'timeline', 'asset'].includes(object.kind)
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
  if (ref.startsWith('timeline:')) return `时间轴 ${ref.slice('timeline:'.length)}`;
  return ref;
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
  ));
  return (preferred ?? candidates[0])?.objectRef ?? null;
}

export function filterTraceByObject<T extends CausalTraceEvent>(selectedRef: string, trace: readonly T[], index?: ObjectIndex): T[] {
  return trace.filter((event) => locateObjectForTraceEvent(event, index) === selectedRef);
}
