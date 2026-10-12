import { parsePreviewPlaybackCheckpoint, type PreviewPlaybackCheckpoint, type PreviewContentTarget } from '@surdet/authoring';

/** Namespace includes the bound project and selected source; working revisions intentionally share a replay path. */
export function previewCheckpointKey(projectIdentity: string | undefined, target: PreviewContentTarget | null, sceneId: string, label?: string): string | null {
  if (projectIdentity === undefined) return null;
  const identity = target?.kind === 'working-change' ? { kind: target.kind, changeId: target.changeId } : target;
  return `surdet:preview:checkpoint:${JSON.stringify([projectIdentity, identity, sceneId, label ?? null])}`;
}

export function readPreviewCheckpoint(key: string | null): PreviewPlaybackCheckpoint | null {
  if (key === null) return null;
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : parsePreviewPlaybackCheckpoint(JSON.parse(value));
  } catch { return null; }
}

export function writePreviewCheckpoint(key: string | null, checkpoint: PreviewPlaybackCheckpoint): boolean {
  if (key === null) return false;
  try { localStorage.setItem(key, JSON.stringify(checkpoint)); return true; } catch { return false; }
}

/** A run that stopped for a reason the next one would meet again leaves nothing to resume. */
export function clearPreviewCheckpoint(key: string | null): void {
  if (key === null) return;
  try { localStorage.removeItem(key); } catch { /* Unavailable storage holds no checkpoint. */ }
}
