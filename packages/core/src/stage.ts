/** Project stage data and validation. No renderer, filesystem or SDK dependency. */
export interface StagePoint { x: number; y: number }
export interface StageRect extends StagePoint { width: number; height: number }
export interface StagePose extends StagePoint {
  scale: number;
  facing: 'left' | 'right';
  opacity: number;
  z: number;
  baseHeight: number;
  anchorX: number;
  anchorY: number;
}
export type StagePosePatch = Partial<StagePose>;
export type StageSource =
  | { kind: 'scene'; file: string; line: number; sceneId?: string; instructionIndex?: number }
  | { kind: 'composition'; id: string }
  | { kind: 'timeline'; timelineId: string; trackIndex: number; cueIndex: number;
      instances?: { timelineId: string; clipIndex: number; iteration: number }[] };
export interface StageInspectionObject {
  id: string; kind: 'portrait' | 'layer'; target: string;
  pose: Partial<StagePose>; source: StageSource | null;
  propertySources: Record<string, StageSource>;
  charId?: string; costume?: string; expression?: string; assetKey?: string;
}
export interface StageInspection {
  design: { width: number; height: number };
  camera: { x: number; y: number; scale: number };
  objects: StageInspectionObject[];
}
export type StageCommand = (
  | { type: 'show'; target: string; expression: string; instance?: string; modifiers?: Record<string, string>; legacy?: boolean }
  | { type: 'pose'; target: string; modifiers: Record<string, string>; durationMs?: number; easing?: import('./timeline.js').TimelineEasing }
  | { type: 'layer'; definition: StageLayerDefinition }
  | { type: 'remove-layer'; id: string }
  | { type: 'layer-pose'; id: string; modifiers: Record<string, string>; durationMs?: number; easing?: import('./timeline.js').TimelineEasing }
  | { type: 'composition'; id: string; keepActors?: boolean }
  | { type: 'clear' }
  | { type: 'finish-timeline'; runId: number }
  | { type: 'skip-motions' }) & { source?: StageSource };

export function validateStageFrame(value: unknown, width: number, height: number): StageRect {
  const frame = rectangle(value, 'portrait.frame');
  if (frame.x + frame.width > width || frame.y + frame.height > height) throw new StageValidationError('portrait.frame', '校准矩形超出实际图片边界');
  return frame;
}
export interface StageImageSource {
  path: string; sha256: string; width: number; height: number;
}
export interface StagePortraitProfile {
  sources: Record<string, StageImageSource>;
  height: number;
  anchorX: number;
  anchorY: number;
  expressions: Record<string, StageRect>;
}
export interface StageLayerDefinition extends StagePoint {
  id: string;
  key: string;
  band: 'environment' | 'foreground';
  scale: number;
  opacity: number;
  z: number;
  parallax: number;
}
export interface StageComposition {
  background?: string | null;
  layers?: StageLayerDefinition[];
  keepActors: boolean;
  resetCamera: boolean;
}
export interface ProjectStage {
  version: 1;
  design: { width: number; height: number };
  positions: Record<string, StagePoint>;
  distances: Record<string, number>;
  portraits: Record<string, StagePortraitProfile>;
  compositions: Record<string, StageComposition>;
}

export class StageValidationError extends Error {
  readonly code = 'STAGE_INVALID';
  constructor(readonly path: string, reason: string) { super(`${path}: ${reason}`); this.name = 'StageValidationError'; }
}
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new StageValidationError(path, '必须是对象');
  return value as Record<string, unknown>;
}
function number(value: unknown, fallback: number, path: string, min: number, max: number, integer = false): number {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result) || result < min || result > max || integer && !Number.isInteger(result)) {
    throw new StageValidationError(path, `必须是 ${min} 到 ${max} 的${integer ? '整数' : '有限数字'}`);
  }
  return result;
}
function key(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\u0000-\u001f\\]/.test(value)) throw new StageValidationError(path, '必须是非空、无控制字符的准确标识');
  return value;
}
function map<T>(value: unknown, path: string, parse: (entry: unknown, path: string) => T): Record<string, T> {
  if (value === undefined) return {};
  return Object.fromEntries(Object.entries(object(value, path)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, entry]) => [key(name, path), parse(entry, `${path}.${name}`)]));
}
function fields(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const name of Object.keys(value)) if (!allowed.includes(name)) throw new StageValidationError(`${path}.${name}`, '当前舞台版本不支持此字段');
}
function point(value: unknown, path: string): StagePoint {
  const raw = object(value, path); fields(raw, ['x', 'y'], path);
  return { x: number(raw.x, 0, `${path}.x`, -100_000, 100_000), y: number(raw.y, 0, `${path}.y`, -100_000, 100_000) };
}
function rectangle(value: unknown, path: string): StageRect {
  const raw = object(value, path); fields(raw, ['x', 'y', 'width', 'height'], path);
  return { x: number(raw.x, 0, `${path}.x`, 0, 100_000), y: number(raw.y, 0, `${path}.y`, 0, 100_000),
    width: number(raw.width, NaN, `${path}.width`, 1, 100_000), height: number(raw.height, NaN, `${path}.height`, 1, 100_000) };
}

export function parseStageLayer(value: unknown, path = 'layer'): StageLayerDefinition {
  const raw = object(value, path);
  fields(raw, ['id', 'key', 'band', 'x', 'y', 'scale', 'opacity', 'z', 'parallax'], path);
  if (raw.band !== undefined && raw.band !== 'environment' && raw.band !== 'foreground') throw new StageValidationError(`${path}.band`, '只支持 environment / foreground');
  return { id: key(raw.id, `${path}.id`), key: key(raw.key, `${path}.key`), band: raw.band === 'foreground' ? 'foreground' : 'environment',
    x: number(raw.x, 0, `${path}.x`, -100_000, 100_000), y: number(raw.y, 0, `${path}.y`, -100_000, 100_000),
    scale: number(raw.scale, 1, `${path}.scale`, 0.01, 16), opacity: number(raw.opacity, 1, `${path}.opacity`, 0, 1),
    z: number(raw.z, 0, `${path}.z`, -32768, 32767, true), parallax: number(raw.parallax, 1, `${path}.parallax`, 0, 2) };
}

/** Undefined means old project defaults; null explicitly disables the stage configuration. */
export function readProjectStage(config: Record<string, unknown>): ProjectStage | null {
  if (config.stage === undefined || config.stage === null) return null;
  return parseProjectStage(config.stage);
}
export function parseProjectStage(value: unknown): ProjectStage {
  const raw = object(value, 'stage');
  fields(raw, ['version', 'design', 'positions', 'distances', 'portraits', 'compositions'], 'stage');
  if (raw.version !== 1) throw new StageValidationError('stage.version', '仅支持版本 1');
  const design = raw.design === undefined ? {} : object(raw.design, 'stage.design');
  fields(design, ['width', 'height'], 'stage.design');
  const width = number(design.width, 1280, 'stage.design.width', 320, 7680, true);
  const height = number(design.height, 720, 'stage.design.height', 240, 4320, true);
  const positions = { left: { x: width * .25, y: height }, center: { x: width * .5, y: height }, right: { x: width * .75, y: height },
    ...map(raw.positions, 'stage.positions', point) };
  const distances = { far: .75, medium: 1, near: 1.3, ...map(raw.distances, 'stage.distances', (v, p) => number(v, 1, p, .01, 16)) };
  const portraits = map(raw.portraits, 'stage.portraits', (value, path): StagePortraitProfile => {
    const profile = object(value, path); fields(profile, ['height', 'anchorX', 'anchorY', 'expressions', 'sources'], path);
    return { height: number(profile.height, height * .9, `${path}.height`, 1, 20_000),
      anchorX: number(profile.anchorX, .5, `${path}.anchorX`, 0, 1), anchorY: number(profile.anchorY, 1, `${path}.anchorY`, 0, 1),
      expressions: map(profile.expressions, `${path}.expressions`, rectangle),
      sources: map(profile.sources, `${path}.sources`, parseStageImageSource) };
  });
  const compositions = map(raw.compositions, 'stage.compositions', (value, path): StageComposition => {
    const composition = object(value, path); fields(composition, ['background', 'layers', 'keepActors', 'resetCamera'], path);
    if (composition.resetCamera !== undefined && typeof composition.resetCamera !== 'boolean') throw new StageValidationError(`${path}.resetCamera`, '必须是布尔值');
    if (composition.keepActors !== undefined && typeof composition.keepActors !== 'boolean') throw new StageValidationError(`${path}.keepActors`, '必须是布尔值');
    if (composition.layers !== undefined && !Array.isArray(composition.layers)) throw new StageValidationError(`${path}.layers`, '必须是数组');
    const layers = (composition.layers as unknown[] | undefined ?? []).map((layer, index) => parseStageLayer(layer, `${path}.layers.${index}`));
    if (layers.length > 64 || new Set(layers.map(layer => layer.id)).size !== layers.length) throw new StageValidationError(`${path}.layers`, '图层最多 64 个，且 ID 不得重复');
    return { ...(composition.background === undefined ? {} : { background: composition.background === null ? null : key(composition.background, `${path}.background`) }),
      ...(composition.layers === undefined ? {} : { layers }), keepActors: composition.keepActors !== false, resetCamera: composition.resetCamera === true };
  });
  return { version: 1, design: { width, height }, positions, distances, portraits, compositions };
}

export function validateStagePose(value: unknown, path = 'pose'): StagePose {
  const raw = object(value, path);
  fields(raw, ['x', 'y', 'scale', 'facing', 'opacity', 'z', 'baseHeight', 'anchorX', 'anchorY'], path);
  if (raw.facing !== 'left' && raw.facing !== 'right') throw new StageValidationError(`${path}.facing`, '必须是 left / right');
  return { x: number(raw.x, NaN, `${path}.x`, -100_000, 100_000), y: number(raw.y, NaN, `${path}.y`, -100_000, 100_000),
    scale: number(raw.scale, NaN, `${path}.scale`, .01, 16), facing: raw.facing,
    opacity: number(raw.opacity, NaN, `${path}.opacity`, 0, 1), z: number(raw.z, NaN, `${path}.z`, -32768, 32767, true),
    baseHeight: number(raw.baseHeight, NaN, `${path}.baseHeight`, 1, 20_000),
    anchorX: number(raw.anchorX, NaN, `${path}.anchorX`, 0, 1), anchorY: number(raw.anchorY, NaN, `${path}.anchorY`, 0, 1) };
}

export function stageDefaultPose(stage: ProjectStage, portraitKey: string): StagePose {
  const profile = own(stage.portraits, portraitKey) ? stage.portraits[portraitKey] : undefined;
  const center = stage.positions.center!;
  return { ...center, scale: 1, facing: 'right', opacity: 1, z: 0,
    baseHeight: profile?.height ?? stage.design.height * .9, anchorX: profile?.anchorX ?? .5, anchorY: profile?.anchorY ?? 1 };
}

/** Preset fields are applied first; explicitly supplied coordinates/scale win. Omission preserves current values. */
export function stagePoseFromModifiers(stage: ProjectStage, portraitKey: string, modifiers: ReadonlyMap<string, string>, current?: StagePose): StagePose {
  const next = { ...(current ?? stageDefaultPose(stage, portraitKey)) };
  const position = modifiers.get('pos');
  if (position !== undefined) {
    if (own(stage.positions, position)) Object.assign(next, stage.positions[position]);
    else if (position.trim() && Number.isFinite(Number(position))) next.x = Number(position);
    else throw new StageValidationError('pos', `不存在的位置方案 ${position}`);
  }
  const distance = modifiers.get('distance');
  if (distance !== undefined) {
    if (!own(stage.distances, distance)) throw new StageValidationError('distance', `不存在的距离方案 ${distance}`);
    next.scale = stage.distances[distance]!;
  }
  for (const name of ['x', 'y', 'scale', 'opacity', 'z', 'baseHeight', 'anchorX', 'anchorY'] as const) {
    const raw = modifiers.get(name);
    if (raw !== undefined) next[name] = raw.trim() ? Number(raw) : NaN;
  }
  const alpha = modifiers.get('alpha');
  if (alpha !== undefined) {
    if (modifiers.has('opacity')) throw new StageValidationError('alpha', 'alpha 与 opacity 不得同时提供');
    next.opacity = alpha.trim() ? Number(alpha) : NaN;
  }
  if (modifiers.has('facing')) next.facing = modifiers.get('facing') as StagePose['facing'];
  return validateStagePose(next);
}

export function projectStageAssetKeys(stage: ProjectStage | null): string[] {
  return stage === null ? [] : [...new Set(Object.values(stage.compositions).flatMap(value => [
    ...(value.background == null ? [] : [value.background]), ...(value.layers ?? []).map(layer => layer.key),
  ]))].sort();
}

export const STAGE_POSE_MODIFIERS = ['pos', 'distance', 'x', 'y', 'scale', 'facing', 'opacity', 'alpha', 'z', 'baseHeight', 'anchorX', 'anchorY'] as const;

/** Shared grammar for authoring validation and presentation; input tokens are dequoted. */
export function stageCommandFromInstruction(name: string, rawArgs: readonly string[], rawModifiers: ReadonlyMap<string, string>): StageCommand | null {
  // Choice inline actions use @ as an instruction separator, so they carry
  // properties as name=value arguments rather than inventing a second parser.
  const modifiers = new Map(rawModifiers);
  const args: string[] = [];
  const namedStart = name === 'show' || name === 'layer' ? 2 : 1;
  for (const [index, token] of rawArgs.entries()) {
    const match = index >= namedStart && ['show', 'pose', 'layer', 'stage'].includes(name) ? /^([A-Za-z][A-Za-z0-9]*)=(.*)$/.exec(token) : null;
    if (!match) { args.push(token); continue; }
    if (modifiers.has(match[1]!)) throw new StageValidationError(`${name}.${match[1]}`, '属性不能重复提供');
    modifiers.set(match[1]!, decodeStageToken(match[2]!));
  }
  if (['pose', 'layer', 'stage'].includes(name)) {
    const allowed = name === 'pose' ? [...STAGE_POSE_MODIFIERS, 'duration', 'easing']
      : name === 'layer' ? ['off', 'x', 'y', 'scale', 'opacity', 'z', 'parallax', 'band'] : ['keepActors'];
    for (const modifier of modifiers.keys()) if (!allowed.includes(modifier as never)) throw new StageValidationError(`${name}.${modifier}`, '不支持的修饰符');
    if (args.length > (name === 'stage' ? 1 : 2)) throw new StageValidationError(name, '存在多余参数');
  }
  const poseModifiers = Object.fromEntries([...modifiers].filter(([name]) => (STAGE_POSE_MODIFIERS as readonly string[]).includes(name)));
  const timing = (): { durationMs: number; easing: import('./timeline.js').TimelineEasing } => {
    const rawDuration = modifiers.get('duration') ?? args[1];
    const durationMs = number(rawDuration === undefined ? undefined : rawDuration.trim() ? Number(rawDuration) : NaN, 0, 'duration', 0, 600_000, true);
    const easing = modifiers.get('easing') ?? 'linear';
    if (!['linear', 'inOutSine', 'outCubic', 'inOutCubic'].includes(easing)) throw new StageValidationError('easing', '不支持的缓动');
    return { durationMs, easing: easing as import('./timeline.js').TimelineEasing };
  };
  if (name === 'show') {
    const bare = ['left', 'center', 'right'].find(value => modifiers.has(value));
    if (bare && !modifiers.has('pos')) poseModifiers.pos = bare;
    return { type: 'show', target: key(args[0], 'show.target'), expression: args[1] ?? 'normal', legacy: true,
      ...(modifiers.has('instance') ? { instance: key(modifiers.get('instance'), 'show.instance') } : {}), modifiers: poseModifiers };
  }
  if (name === 'pose') {
    if (!Object.keys(poseModifiers).length) throw new StageValidationError('pose', '至少需要一个明确属性');
    const target = key(args[0], 'pose.target');
    return target.startsWith('layer:') ? { type: 'layer-pose', id: key(target.slice(6), 'pose.layer'), modifiers: poseModifiers, ...timing() }
      : { type: 'pose', target: target.startsWith('portrait:') ? key(target.slice(9), 'pose.portrait') : target, modifiers: poseModifiers, ...timing() };
  }
  if (name === 'layer') {
    const id = key(args[0], 'layer.id');
    if (modifiers.has('off')) {
      if (args.length !== 1 || modifiers.size !== 1 || !['', 'true'].includes(modifiers.get('off')!)) throw new StageValidationError('layer.off', '关闭图层不能同时创建或变换');
      return { type: 'remove-layer', id };
    }
    const raw: Record<string, unknown> = { id, key: args[1] };
    for (const field of ['x', 'y', 'scale', 'opacity', 'z', 'parallax']) {
      const value = modifiers.get(field); if (value !== undefined) raw[field] = value.trim() ? Number(value) : NaN;
    }
    if (modifiers.has('band')) raw.band = modifiers.get('band');
    return { type: 'layer', definition: parseStageLayer(raw) };
  }
  if (name === 'stage') {
    if (args[0] === 'off') {
      if (modifiers.size) throw new StageValidationError('stage.off', '清场不能同时指定保留规则');
      return { type: 'clear' };
    }
    const keep = modifiers.get('keepActors');
    if (keep !== undefined && keep !== 'true' && keep !== 'false') throw new StageValidationError('stage.keepActors', '必须明确 true / false');
    return { type: 'composition', id: key(args[0], 'stage.id'), ...(keep === undefined ? {} : { keepActors: keep === 'true' }) };
  }
  return null;
}

/** Stable semantic identity for restore preflight, not a file-byte digest. */
export function stageConfigurationKey(value: ProjectStage | null): string {
  const stable = (v: unknown): string => v === null || typeof v !== 'object' ? JSON.stringify(v)
    : Array.isArray(v) ? `[${v.map(stable).join(',')}]`
      : `{${Object.keys(v).sort().map(key => `${JSON.stringify(key)}:${stable((v as Record<string, unknown>)[key])}`).join(',')}}`;
  return stable(value);
}

/** Decode already lexed generic value tokens, matching the existing Renderer contract. */
export function decodeStageToken(s: string): string {
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  if ((first !== '"' && first !== "'") || first !== last) return s;

  // 扫描确认末位引号是"未转义的闭合引号"（而非 \" 转义序列的一部分），
  // 且闭合前无其他未转义同类引号（避免 "a"b" 这类多段引号误剥）。
  let escaped = false;
  for (let i = 1; i < s.length - 1; i++) {
    const c = s[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (c === first) return s; // 中间出现未转义引号：非单一引号值，保持原样
  }
  if (escaped) return s; // 反斜杠悬空（\ 后无字符），保守不剥

  // 剥外引号并还原转义：\x → x（\" → "、\\ → \、\n → n 由表达式语境之外按字面还原）
  return s.slice(1, -1).replace(/\\(.)/g, '$1');
}


export function parseStageImageSource(value: unknown, path = 'portrait.source'): StageImageSource {
  const raw = object(value, path); fields(raw, ['path', 'sha256', 'width', 'height'], path);
  if (typeof raw.path !== 'string' || !raw.path.startsWith('content/assets/') || raw.path.includes('\\')
    || raw.path.split('/').some(part => !part || part === '.' || part === '..') || /[\u0000-\u001f]/.test(raw.path)) throw new StageValidationError(path, '校准来源必须是准确的项目素材路径');
  if (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(raw.sha256)) throw new StageValidationError(path, '校准必须包含源图片 SHA-256');
  return { path: raw.path, sha256: raw.sha256,
    width: number(raw.width, NaN, `${path}.width`, 1, 100000, true), height: number(raw.height, NaN, `${path}.height`, 1, 100000, true) };
}


export function validStageSource(value: unknown): value is StageSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f]/.test(value);
  const index = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100000;
  if (v.kind === 'scene') return id(v.file) && index(v.line) && Number(v.line) > 0;
  if (v.kind === 'composition') return id(v.id);
  return v.kind === 'timeline' && id(v.timelineId) && index(v.trackIndex) && index(v.cueIndex)
    && (v.instances === undefined || Array.isArray(v.instances) && v.instances.length <= 16 && v.instances.every(item =>
      item && typeof item === 'object' && id(item.timelineId) && index(item.clipIndex) && index(item.iteration)));
}

export function stagePinnedSourcePaths(config: Record<string, unknown>): string[] {
  const stage = readProjectStage(config);
  return [...new Set(Object.values(stage?.portraits ?? {}).flatMap(profile => Object.values(profile.sources).map(source => source.path)))].sort();
}
