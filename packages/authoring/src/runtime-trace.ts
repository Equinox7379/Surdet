import type { RuntimeTraceEventPayload } from '@surdet/core';
import type { ObjectIndex } from './object-index.js';

export type RuntimeTraceEvent = RuntimeTraceEventPayload;

export interface CausalTraceEvent {
  step?: number; sequence?: number; sourceRef?: string; kind?: string;
  event?: RuntimeTraceEvent; source?: RuntimeTraceEvent['source'];
}

/** Resolve both the Editor dock and the public preview observation against the same object index. */
export function locateObjectForTraceEvent(event: CausalTraceEvent, index?: ObjectIndex): string | null {
  if (typeof event.sourceRef === 'string' && event.sourceRef.length > 0) return event.sourceRef;
  const source = event.event?.source ?? event.source;
  if (!source || index === undefined) return null;
  const candidates = index.objects.filter(object => object.source?.line === source.line
    && (object.source.path === source.file || object.source.path.endsWith(`/${source.file}`) || source.file.endsWith(`/${object.source.path}`)));
  if (candidates.length === 0) return null;
  const preferred = candidates.find(object => (source.op === 'text' && object.kind === 'text')
    || (source.op === 'choice' && object.kind === 'choice') || (source.op === 'label' && object.kind === 'label')
    || (source.op === 'timeline' && object.kind === 'instruction'));
  return (preferred ?? candidates[0])?.objectRef ?? null;
}

export interface TraceQuery {
  kind?: RuntimeTraceEvent['kind'];
  sceneId?: string;
  op?: string;
  variable?: string;
}

export function normalizeTrace(events: readonly RuntimeTraceEvent[]): RuntimeTraceEvent[] {
  return events.map((event) => ({
    ...event,
    source: { ...event.source },
    ...(event.stateDelta === undefined ? {} : { stateDelta: event.stateDelta.map((delta) => ({ ...delta })) }),
  }));
}

export function queryTrace(events: readonly RuntimeTraceEvent[], query: TraceQuery = {}): RuntimeTraceEvent[] {
  return events.filter((event) => {
    if (query.kind !== undefined && event.kind !== query.kind) return false;
    if (query.sceneId !== undefined && event.source.sceneId !== query.sceneId) return false;
    if (query.op !== undefined && event.source.op !== query.op) return false;
    if (query.variable !== undefined && !event.stateDelta?.some((delta) => delta.variable === query.variable)) return false;
    return true;
  });
}
