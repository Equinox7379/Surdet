import { compareCanonicalText } from './canonical-order.js';
import {
  collectVars,
  collectInterpolatedVars,
  findChoiceArrow,
  parseExpr,
  parseInlineInstructions,
  Lexer,
} from '@surdet/core';
import type { RawCompositionReference } from './composition-contracts.js';
import { decodeInstructionArgument, parseSceneDocument, splitInstruction } from './scene-document.js';

const VARIABLE_INSTRUCTIONS = new Set(['set', 'mod', 'inc', 'dec', 'toggle', 'flag', 'unflag', 'random', 'add_item', 'remove_item']);

type ReferenceSource = RawCompositionReference['source'];

/**
 * The raw analyzer deliberately reports parser failures to its caller, while
 * preserving facts collected from every other parseable source location.
 */
export class CompositionReferenceAnalysisError extends Error {
  readonly partialReferences: RawCompositionReference[];
  readonly source: ReferenceSource;
  override readonly cause: unknown;

  constructor(error: unknown, partialReferences: readonly RawCompositionReference[], source: ReferenceSource) {
    super(error instanceof Error ? error.message : String(error));
    this.name = 'CompositionReferenceAnalysisError';
    this.partialReferences = sortRawCompositionReferences(partialReferences);
    this.source = source;
    this.cause = error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sourceFor(path: string, line: number, blockIndex: number, optionIndex?: number): ReferenceSource {
  return {
    path,
    line,
    blockIndex,
    ...(optionIndex === undefined ? {} : { optionIndex }),
  };
}

function timelineSource(path: string, trackIndex: number, cueIndex: number): ReferenceSource {
  return { path, trackIndex, cueIndex };
}

function cleanToken(value: string | undefined): string {
  return value === undefined ? '' : decodeInstructionArgument(value).trim();
}

function instructionTarget(args: readonly string[]): string {
  return args.map(cleanToken).join(' ').trim();
}

function addReference(
  references: RawCompositionReference[],
  kind: RawCompositionReference['kind'],
  scope: RawCompositionReference['scope'],
  token: string,
  source: ReferenceSource,
  objectRef?: string,
): void {
  if (token.length === 0) return;
  references.push({
    kind,
    scope,
    token,
    ...(objectRef === undefined ? {} : { objectRef }),
    source,
  });
}

function addVariableReference(
  references: RawCompositionReference[],
  token: string,
  source: ReferenceSource,
): void {
  const value = cleanToken(token);
  if (value.length === 0) return;
  addReference(references, 'variable', 'candidate-external', value, source, `variable:${value}`);
}

function addExpressionVariables(
  references: RawCompositionReference[],
  expression: string,
  source: ReferenceSource,
): void {
  for (const variable of collectVars(parseExpr(expression))) {
    addVariableReference(references, variable, source);
  }
}

function portraitParts(target: string): { role: string; outfit: string } | null {
  const parts = target.split(':');
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) return null;
  return { role: parts[0]!, outfit: parts[1]! };
}

function addSceneInstructionReferences(
  references: RawCompositionReference[],
  sceneId: string,
  name: string,
  args: readonly string[],
  source: ReferenceSource,
): void {
  if (name === 'bgm' || name === 'ambience' || name === 'se' || name === 'voice' || name === 'video') {
    const token = args[0] === undefined ? '' : decodeInstructionArgument(args[0]);
    if (token.length > 0 && !(name === 'ambience' && token === 'off')) {
      addReference(references, name === 'video' ? 'video-asset' : 'audio-asset', 'candidate-external', token, source, `asset:${name}:${token}`);
    }
    return;
  }
  if (name === 'timeline') {
    const token = cleanToken(args[0]);
    if (token.length > 0 && !token.startsWith('@')) {
      addReference(references, 'timeline', 'candidate-external', token, source, `timeline:${token}`);
    }
    return;
  }

  if (name === 'unlock_profile' || name === 'unlock_term') {
    const token = args[0] === undefined ? '' : decodeInstructionArgument(args[0]);
    addReference(references, name === 'unlock_profile' ? 'gallery-profile' : 'gallery-term', 'candidate-external', token, source, `gallery:${name === 'unlock_profile' ? 'profiles' : 'terms'}:${token}`);
    return;
  }
  if (name === 'unlock_text') {
    const token = args[0] ?? '';
    addReference(references, 'gallery-text', 'candidate-external', token, source, `gallery:texts:${token}`);
    return;
  }
  if (name === 'unlock_cg') {
    // Core stores the exact argument for unlock_cg, including any literal quotes.
    const token = args[0] ?? '';
    addReference(references, 'gallery-cg', 'candidate-external', token, source, `gallery:cgs:${token}`);
    return;
  }

  if (name === 'goto' || name === 'loop') {
    const token = instructionTarget(args);
    if (token.length > 0) {
      addReference(references, 'label', 'primary-local', token, source, `label:${sceneId}.${token}`);
    }
    return;
  }

  if (name === 'jump' || name === 'call') {
    const target = instructionTarget(args);
    const targetScene = target.split('.')[0] ?? '';
    if (targetScene.length === 0) return;
    const scope = targetScene === sceneId ? 'primary-local' : 'candidate-external';
    addReference(references, 'scene', scope, targetScene, source, `scene:${targetScene}`);
    return;
  }

  if (VARIABLE_INSTRUCTIONS.has(name)) {
    addVariableReference(references, args[0] ?? '', source);
    if (name === 'set') {
      const expression = args.slice(2).join(' ');
      if (expression.trim().length > 0) addExpressionVariables(references, expression, source);
    }
    return;
  }

  if (name === 'has_item') {
    addVariableReference(references, args[0] ?? '', source);
    addVariableReference(references, args[2] ?? '', source);
    return;
  }

  if (name === 'switch') {
    addVariableReference(references, args[0] ?? '', source);
    for (const item of args.slice(1)) {
      const separator = item.indexOf(':');
      if (separator < 0) continue;
      const target = item.slice(separator + 1);
      addReference(references, 'label', 'primary-local', target, source, `label:${sceneId}.${target}`);
    }
    return;
  }

  if (name === 'if' || name === 'elif' || name === 'check') {
    const expression = args.join(' ');
    if (expression.trim().length > 0) addExpressionVariables(references, expression, source);
    return;
  }

  if (name === 'layer' && args[1] !== undefined) {
    const token = cleanToken(args[1]);
    addReference(references, 'background-asset', 'candidate-external', token, source, `asset:bg:${token}`);
    return;
  }
  if (name === 'bg') {
    const token = cleanToken(args[0]);
    if (token.length > 0) {
      addReference(references, 'background-asset', 'candidate-external', token, source, `asset:bg:${token}`);
    }
    return;
  }

  if (name === 'show') {
    const target = cleanToken(args[0]);
    const expression = cleanToken(args[1]);
    const parts = portraitParts(target);
    if (target.length > 0) {
      const token = `${target}${expression.length > 0 ? `:${expression}` : ''}`;
      addReference(
        references,
        'portrait-asset',
        'candidate-external',
        token,
        source,
        parts !== null && expression.length > 0 ? `asset:portrait:${parts.role}:${parts.outfit}:${expression}` : undefined,
      );
    }
  }
}

function analyzeChoiceOption(
  references: RawCompositionReference[],
  sceneId: string,
  path: string,
  raw: string,
  line: number,
  blockIndex: number,
  optionIndex: number,
): void {
  const source = sourceFor(path, line, blockIndex, optionIndex);
  const trimmed = raw.trimStart();
  const arrow = findChoiceArrow(trimmed, { file: path, line, col: raw.length - trimmed.length + 1 });
  const arrowIndex = arrow?.index ?? -1;
  const arrowEnd = arrow?.end ?? -1;
  const labelPart = arrowIndex >= 0 ? trimmed.slice(0, arrowIndex) : trimmed;
  const inlinePart = arrowEnd >= 0 ? trimmed.slice(arrowEnd).trim() : '';
  const labelText = labelPart.trim();
  for (const name of collectInterpolatedVars(labelText.replace(/\[if:.+?\]\s*$/, ''))) addVariableReference(references, name, source);
  const whenMatch = /\[if:(.+?)\]\s*$/.exec(labelText);
  if (whenMatch !== null) addExpressionVariables(references, whenMatch[1]!.trim(), source);

  if (inlinePart.length === 0) return;
  const inline = parseInlineInstructions(inlinePart, path, line, raw.length - trimmed.length + Math.max(1, arrowEnd + 1));
  let jumpSeen = false;
  for (const instruction of inline) {
    if (instruction.name === 'goto' || instruction.name === 'jump') {
      if (jumpSeen) continue;
      jumpSeen = true;
    }
    addSceneInstructionReferences(references, sceneId, instruction.name, instruction.args, source);
  }
}

/**
 * Build the speaker token map used by scene raw analysis and object-index.
 * IDs always win; a display name is usable only when it maps to one character.
 */
export function buildSpeakerCharacterRefs(characters: Record<string, unknown>): Map<string, string> {
  const byId = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const id of Object.keys(characters)) {
    byId.set(id, `character:${id}`);
    const declaration = characters[id];
    if (!isRecord(declaration)) continue;
    const name = declaration['name'];
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    const list = byName.get(name.trim()) ?? [];
    list.push(`character:${id}`);
    byName.set(name.trim(), list);
  }
  const result = new Map(byId);
  for (const [name, refs] of byName) {
    if (refs.length === 1 && !result.has(name)) result.set(name, refs[0]!);
  }
  return result;
}

/** Stable ordering shared by operation-time facts and all analyzer callers. */
export function sortRawCompositionReferences(
  values: readonly RawCompositionReference[],
): RawCompositionReference[] {
  return [...values].sort((a, b) => (
    compareCanonicalText(a.source.path, b.source.path)
    || (a.source.line ?? -1) - (b.source.line ?? -1)
    || (a.source.trackIndex ?? -1) - (b.source.trackIndex ?? -1)
    || (a.source.cueIndex ?? -1) - (b.source.cueIndex ?? -1)
    || (a.source.blockIndex ?? -1) - (b.source.blockIndex ?? -1)
    || (a.source.optionIndex ?? -1) - (b.source.optionIndex ?? -1)
    || compareCanonicalText(a.kind, b.kind)
    || compareCanonicalText(a.token, b.token)
    || compareCanonicalText((a.objectRef ?? ''), b.objectRef ?? '')
  ));
}

export function analyzeSceneCompositionReferences(input: {
  sceneId: string;
  path: string;
  text: string;
  characters: Record<string, unknown>;
}): RawCompositionReference[] {
  const references: RawCompositionReference[] = [];
  const document = parseSceneDocument(input.text);
  const speakerRefs = buildSpeakerCharacterRefs(input.characters);
  let choiceOptionIndex: number | null = null;
  let analysisFailure: { error: unknown; source: ReferenceSource } | null = null;

  for (const [blockIndex, line] of document.entries()) {
    const lineNumber = blockIndex + 1;
    const lineSource = sourceFor(input.path, lineNumber, blockIndex);
    try {
      if (line.kind === 'instr') {
        const { name, args } = splitInstruction(line.raw);
        if (name === 'choice') {
          choiceOptionIndex = 0;
          continue;
        }
        choiceOptionIndex = null;
        if (name === 'transition' && cleanToken(args[0]) === 'rule') {
          const token = new Lexer().tokenize(line.raw, input.path).find(token => token.type === 'instruction');
          const rule = token?.type === 'instruction' ? cleanToken(token.modifiers.get('rule')) : '';
          if (rule) addReference(references, 'rule-asset', 'candidate-external', rule, lineSource, `asset:rule:${rule}`);
        }
        addSceneInstructionReferences(references, input.sceneId, name, args, lineSource);
        continue;
      }

      if (line.kind === 'choice-option') {
        const optionIndex = choiceOptionIndex ?? 0;
        analyzeChoiceOption(references, input.sceneId, input.path, line.raw, lineNumber, blockIndex, optionIndex);
        if (choiceOptionIndex !== null) choiceOptionIndex += 1;
        continue;
      }

      if ((line.kind === 'blank' || line.kind === 'comment') && choiceOptionIndex !== null) continue;
      choiceOptionIndex = null;
      if (line.kind !== 'text') continue;
      for (const name of collectInterpolatedVars(line.value + '\n' + line.speaker)) addVariableReference(references, name, lineSource);
      const speaker = line.speaker.trim();
      if (speaker.length === 0) continue;
      const characterRef = speakerRefs.get(speaker);
      if (characterRef === undefined) {
        addReference(references, 'character', 'non-composition', speaker, lineSource);
      } else {
        addReference(references, 'character', 'candidate-external', speaker, lineSource, characterRef);
      }
    } catch (error) {
      // Continue scanning so callers can still use facts after a malformed
      // choice/condition; the failure remains observable after the scan.
      if (analysisFailure === null) {
        const errorSource = line.kind === 'choice-option'
          ? sourceFor(input.path, lineNumber, blockIndex, choiceOptionIndex ?? 0)
          : lineSource;
        analysisFailure = { error, source: errorSource };
      }
    }
  }
  if (analysisFailure !== null) {
    throw new CompositionReferenceAnalysisError(analysisFailure.error, references, analysisFailure.source);
  }
  return sortRawCompositionReferences(references);
}

export function analyzeTimelineCompositionReferences(input: {
  timelineId: string;
  path: string;
  definition: unknown;
  lookup?: (id: string) => { path: string; definition: unknown } | undefined;
  ancestry?: readonly string[];
}): RawCompositionReference[] {
  const references: RawCompositionReference[] = [];
  if ((input.ancestry ?? []).includes(input.timelineId) || (input.ancestry ?? []).length >= 16) throw new Error('时间轴片段引用成环或过深');
  if (isRecord(input.definition) && Array.isArray(input.definition.clips)) {
    for (const clip of input.definition.clips) {
      if (!isRecord(clip) || typeof clip.timelineId !== 'string') continue;
      addReference(references, 'timeline', 'candidate-external', clip.timelineId, { path: input.path }, `timeline:${clip.timelineId}`);
      const child = input.lookup?.(clip.timelineId);
      if (child) references.push(...analyzeTimelineCompositionReferences({ ...child, timelineId: clip.timelineId,
        lookup: input.lookup, ancestry: [...input.ancestry ?? [], input.timelineId] }));
    }
  }
  if (!isRecord(input.definition) || !Array.isArray(input.definition['tracks'])) return references;

  for (const [trackIndex, rawTrack] of input.definition['tracks'].entries()) {
    if (!isRecord(rawTrack) || !Array.isArray(rawTrack['cues'])) continue;
    const kind = rawTrack['kind'];
    const target = typeof rawTrack['target'] === 'string' ? rawTrack['target'].trim() : '';
    for (const [cueIndex, rawCue] of rawTrack['cues'].entries()) {
      if (!isRecord(rawCue)) continue;
      const action = rawCue['action'];
      const source = timelineSource(input.path, trackIndex, cueIndex);
      if (kind === 'screen' && action === 'rule' && typeof rawCue.rule === 'string' && rawCue.rule.trim()) {
        addReference(references, 'rule-asset', 'candidate-external', rawCue.rule, source, `asset:rule:${rawCue.rule}`);
        continue;
      }
      if (kind === 'audio' && (action === 'bgm' || action === 'se' || action === 'voice') && typeof rawCue['key'] === 'string') {
        addReference(references, 'audio-asset', 'candidate-external', rawCue['key'], source, `asset:${action}:${rawCue['key']}`);
        continue;
      }
      if ((kind === 'background' && action === 'set' || kind === 'layer' && action === 'show') && typeof rawCue['key'] === 'string' && rawCue['key'].trim().length > 0) {
        const token = rawCue['key'].trim();
        addReference(references, 'background-asset', 'candidate-external', token, source, `asset:bg:${token}`);
        continue;
      }
      if (kind !== 'portrait' || (action !== 'show' && action !== 'expression') || target.length === 0) continue;
      if (typeof rawCue['expression'] !== 'string' || rawCue['expression'].trim().length === 0) continue;
      const physicalTarget = input.definition.version === 2 && typeof rawCue.source === 'string' ? rawCue.source : target;
      const parts = portraitParts(physicalTarget);
      const expression = rawCue['expression'].trim();
      const token = `${physicalTarget}:${expression}`;
      addReference(references, 'portrait-asset', 'candidate-external', token, source, parts === null ? undefined : `asset:portrait:${parts.role}:${parts.outfit}:${expression}`);
    }
  }
  return sortRawCompositionReferences(references);
}

export function analyzeCharacterCompositionReferences(input: {
  id: string;
  avatar?: string | null;
}): RawCompositionReference[] {
  void input.id;
  const avatar = typeof input.avatar === 'string' ? input.avatar.trim() : '';
  if (avatar.length === 0) return [];
  return [{
    kind: 'avatar-asset',
    scope: 'candidate-external',
    token: avatar,
    objectRef: `asset:avatar:${avatar}`,
    source: { path: 'game.config.json' },
  }];
}
