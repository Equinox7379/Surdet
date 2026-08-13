import type { RuntimeTraceEventPayload } from '@surdet/core';

export type RuntimeTraceEvent = RuntimeTraceEventPayload;

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
