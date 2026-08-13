import type { ObjectIndex, AuthoringObject, RuntimeTraceEvent } from '@surdet/authoring';

export interface CausalTraceEvent {
  step?: number;
  sequence?: number;
  sourceRef?: string;
  kind?: string;
  event?: RuntimeTraceEvent;
  source?: RuntimeTraceEvent['source'];
  [key: string]: unknown;
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
