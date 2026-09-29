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

/** The same projection is retained in the public preview trace, with its Core source. */
export function readingPreviewDiagnostic(generation: number, source: { sceneId: string; file?: string; line?: number },
  issues: readonly { severity: 'info' | 'warning'; code: string; target: string; message: string }[]): PreviewDiagnostic | null {
  const actionable = issues.filter(issue => issue.severity === 'warning' || issue.code === 'TEXT_SCROLL');
  if (!actionable.length) return null;
  const targetName = (target: string): string => target === 'speaker' ? '名字栏' : target === 'dialogue' ? '对话正文'
    : target === 'choices' ? '选项' : target.startsWith('choice:') ? `选项 ${Number(target.slice(7)) + 1}`
    : target.startsWith('nvl:') ? `全文模式第 ${Number(target.slice(4)) + 1} 段` : target === 'nvl' ? '全文模式' : target;
  return { generation, phase: 'runtime', sceneId: source.sceneId,
    level: actionable.some(issue => issue.severity === 'warning') ? 'warning' : 'info',
    message: `当前位置 ${source.file ?? source.sceneId}${source.line === undefined ? '' : `:${source.line}`}：`
      + actionable.map(issue => `[${targetName(issue.target)}] ${issue.message}`).join('；') };
}

export class PreviewGeneration {
  #value = 0;
  next(): number { this.#value += 1; return this.#value; }
  get current(): number { return this.#value; }
  isCurrent(value: number): boolean { return value === this.#value; }
}
