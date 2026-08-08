export type PreviewDiagnosticLevel = 'info' | 'warning' | 'error';
export type PreviewDiagnosticPhase = 'boot' | 'compile' | 'assets' | 'runtime' | 'reload';

export interface PreviewDiagnostic {
  generation: number;
  level: PreviewDiagnosticLevel;
  phase: PreviewDiagnosticPhase;
  message: string;
  sceneId?: string;
  label?: string;
}

export function normalizePreviewDiagnostic(value: unknown): PreviewDiagnostic | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!Number.isInteger(raw.generation) || (raw.generation as number) < 0) return null;
  if (!['info', 'warning', 'error'].includes(String(raw.level))) return null;
  if (!['boot', 'compile', 'assets', 'runtime', 'reload'].includes(String(raw.phase))) return null;
  if (typeof raw.message !== 'string' || raw.message.trim().length === 0) return null;
  return {
    generation: raw.generation as number,
    level: raw.level as PreviewDiagnosticLevel,
    phase: raw.phase as PreviewDiagnosticPhase,
    message: raw.message,
    ...(typeof raw.sceneId === 'string' ? { sceneId: raw.sceneId } : {}),
    ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
  };
}

export class PreviewGeneration {
  #value = 0;
  next(): number { this.#value += 1; return this.#value; }
  get current(): number { return this.#value; }
  isCurrent(value: number): boolean { return value === this.#value; }
}
