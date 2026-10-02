import { AuthoringOperationError, stableStringify } from './change-session.js';
import { parseSceneDocument, parseSceneStructure } from './scene-document.js';
import type { TextHasher } from './contracts.js';

export interface PreviewReplaySource {
  sceneId: string; kind: 'text' | 'choice'; anchor: string | null; fingerprint: string;
}
export interface PreviewReplayChoice { source: PreviewReplaySource; optionFingerprint: string }
export interface PreviewPlaybackCheckpoint {
  seed: number; sceneId: string; label?: string;
  choices: PreviewReplayChoice[]; target: PreviewReplaySource | null;
  /** Actual visit number of this source point; older records remain readable but cannot be replayed. */
  targetVisit?: number;
}
export interface PreviewReplayPoint {
  source: PreviewReplaySource; unique: boolean;
  options?: { index: number; label: string; fingerprint: string }[];
}
export type PreviewReplaySources = Map<string, Map<number, PreviewReplayPoint>>;

export function samePreviewReplaySource(left: PreviewReplaySource, right: PreviewReplaySource): boolean {
  return left.sceneId === right.sceneId && left.kind === right.kind && left.anchor === right.anchor && left.fingerprint === right.fingerprint;
}

/** Core supplies paired spans. Never infer a conditional/choice boundary by scanning instruction names. */
export async function buildPreviewReplaySources(scenes: readonly { id: string; text: string }[], hasher: TextHasher): Promise<PreviewReplaySources> {
  const result: PreviewReplaySources = new Map();
  for (const scene of scenes) {
    const lines = parseSceneDocument(scene.text);
    const structure = parseSceneStructure(scene.text, `${scene.id}.gal`, scene.id);
    const points = new Map<number, PreviewReplayPoint>();
    const labels = lines.flatMap((line, index) => line.kind === 'label' ? [{ line: index + 1, name: line.name }] : []);
    const anchorAt = (line: number): string | null => {
      let start = 0, end = labels.length;
      while (start < end) {
        const middle = Math.floor((start + end) / 2);
        if (labels[middle]!.line < line) start = middle + 1;
        else end = middle;
      }
      return labels[start - 1]?.name ?? null;
    };
    for (const [index, line] of lines.entries()) {
      if (line.kind !== 'text') continue;
      points.set(index + 1, { source: { sceneId: scene.id, kind: 'text', anchor: anchorAt(index + 1), fingerprint: await hasher.sha256(line.raw.trim()) }, unique: true });
    }
    for (const choice of structure.choices) {
      const raw = lines.slice(choice.span.startLine - 1, choice.span.endLine).map(line => line.raw.trim());
      const guards = structure.conditions.flatMap(condition => condition.branches.filter(branch => branch.bodySpan.startLine <= choice.span.startLine
        && branch.bodySpan.endLine >= choice.span.endLine).map(branch => condition.branches.filter(prior => prior.span.startLine <= branch.span.startLine)
          .map(prior => lines[prior.span.startLine - 1]!.raw.trim()).join('\n')));
      const source: PreviewReplaySource = { sceneId: scene.id, kind: 'choice', anchor: anchorAt(choice.span.startLine),
        fingerprint: await hasher.sha256(stableStringify({ raw, guards })) };
      const options = await Promise.all(choice.options.map(async option => ({ index: option.index, label: option.label,
        fingerprint: await hasher.sha256(lines[option.span.startLine - 1]!.raw.trim()) })));
      points.set(choice.span.startLine, { source, unique: true, options });
    }
    const identity = (source: PreviewReplaySource): string => JSON.stringify([source.sceneId, source.kind, source.anchor, source.fingerprint]);
    const counts = new Map<string, number>();
    for (const point of points.values()) {
      const key = identity(point.source);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const point of points.values()) point.unique = counts.get(identity(point.source)) === 1;
    result.set(scene.id, points);
  }
  return result;
}

export function resolvePreviewReplayOption(point: PreviewReplayPoint | undefined, saved: PreviewReplayChoice, available: readonly { index: number; label: string }[]): number | null {
  if (!point?.unique || !samePreviewReplaySource(point.source, saved.source)) return null;
  const options = point.options?.filter(option => option.fingerprint === saved.optionFingerprint) ?? [];
  const option = options.length === 1 ? options[0] : undefined;
  return option !== undefined && available.some(current => current.index === option.index && current.label === option.label) ? option.index : null;
}

/** Checkpoints contain actual source identities, not variables or saved interpreter state. */
export function parsePreviewPlaybackCheckpoint(value: unknown): PreviewPlaybackCheckpoint {
  const invalid = (): never => { throw new AuthoringOperationError('INVALID_REQUEST', '试玩续接路径格式无效'); };
  const object = (raw: unknown, keys: string[]): Record<string, unknown> => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || Object.keys(raw).some(key => !keys.includes(key))) return invalid();
    return raw as Record<string, unknown>;
  };
  const source = (raw: unknown): PreviewReplaySource => {
    const item = object(raw, ['sceneId', 'kind', 'anchor', 'fingerprint']);
    if (typeof item.sceneId !== 'string' || !item.sceneId || !['text', 'choice'].includes(String(item.kind))
      || (item.anchor !== null && typeof item.anchor !== 'string') || typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.fingerprint)) return invalid();
    return item as unknown as PreviewReplaySource;
  };
  const input = object(value, ['seed', 'sceneId', 'label', 'choices', 'target', 'targetVisit']);
  if (!Number.isSafeInteger(input.seed) || (input.seed as number) < 0 || (input.seed as number) > 0xffffffff
    || typeof input.sceneId !== 'string' || !input.sceneId || (input.label !== undefined && typeof input.label !== 'string')
    || !Array.isArray(input.choices) || input.choices.length > 256) return invalid();
  if (input.targetVisit !== undefined && (input.target === null || !Number.isSafeInteger(input.targetVisit)
    || (input.targetVisit as number) < 1)) return invalid();
  const choices = input.choices.map(raw => {
    const item = object(raw, ['source', 'optionFingerprint']);
    if (typeof item.optionFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.optionFingerprint)) return invalid();
    const ref = source(item.source);
    if (ref.kind !== 'choice') return invalid();
    return { source: ref, optionFingerprint: item.optionFingerprint };
  });
  return { seed: input.seed as number, sceneId: input.sceneId, ...(input.label === undefined ? {} : { label: input.label as string }),
    choices, target: input.target === null ? null : source(input.target),
    ...(input.targetVisit === undefined ? {} : { targetVisit: input.targetVisit as number }) };
}
