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

export function createPreviewTraceEvidenceSnapshot(
  presentation: unknown,
  projection: unknown,
): PreviewTraceEvidenceSnapshot {
  return cloneEvidence({ presentation, projection });
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
