export interface PreviewTraceEvidenceSnapshot {
  presentation: unknown;
  projection: unknown;
}

function cloneEvidence<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

/**
 * The saved presentation now carries the whole reading history (up to 200 lines). It is not a
 * change on stage and every trace event would copy it twice, so evidence keeps the presentation
 * without it, as before the history was saved. Saves are unaffected.
 */
function withoutReadingHistory(presentation: unknown): unknown {
  if (!presentation || typeof presentation !== 'object') return presentation;
  const dialogue = (presentation as { dialogue?: unknown }).dialogue;
  if (!dialogue || typeof dialogue !== 'object' || !('backlog' in dialogue || 'backlogReplayCurrent' in dialogue)) return presentation;
  const { backlog: _history, backlogReplayCurrent: _replay, ...rest } = dialogue as Record<string, unknown>;
  return { ...presentation, dialogue: rest };
}

export function createPreviewTraceEvidenceSnapshot(
  presentation: unknown,
  projection: unknown,
): PreviewTraceEvidenceSnapshot {
  return cloneEvidence({ presentation: withoutReadingHistory(presentation), projection });
}

export function previewTraceEvidenceChanged(
  before: PreviewTraceEvidenceSnapshot,
  after: PreviewTraceEvidenceSnapshot,
): boolean {
  try {
    return JSON.stringify(before) !== JSON.stringify(after);
  } catch {
    return before !== after;
  }
}
