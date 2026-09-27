export interface PortraitVisualFrame {
  image: string;
  durationMs: number;
}

export interface PortraitVisualAnimationFrame {
  variant: string;
  durationMs: number;
}

export interface PortraitVisualAnimation {
  frames: PortraitVisualAnimationFrame[];
  loop: boolean;
}

export interface PortraitVisualLayer {
  id: string;
  images: Record<string, string>;
  default: string;
  idle?: PortraitVisualAnimation;
  speaking?: PortraitVisualAnimation;
}

export interface PortraitVisualSequenceDefinition {
  version: 1;
  kind: 'sequence';
  frames: PortraitVisualFrame[];
  loop: boolean;
}

export interface PortraitVisualLayeredDefinition {
  version: 1;
  kind: 'layered';
  layers: PortraitVisualLayer[];
}

export type PortraitVisualDefinition = PortraitVisualSequenceDefinition | PortraitVisualLayeredDefinition;

const MAX_DURATION_MS = 600_000;
const imageExtension = /\.(?:png|jpe?g|webp|gif|avif|svg)$/i;
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

function invalid(path: string, reason: string): never {
  throw new Error(`立绘视觉定义错误（${path}）：${reason}。`);
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(path, '必须是对象');
  }
  return value as Record<string, unknown>;
}

function arrayAt(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value)) invalid(path, '必须是数组');
  if (value.length < min || value.length > max) {
    invalid(path, `数量必须在 ${min} 到 ${max} 之间`);
  }
  return value;
}

function exactFields(
  value: Record<string, unknown>,
  path: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`${path}.${key}`, '不支持该字段');
  }
  for (const key of required) {
    if (!own(value, key)) invalid(`${path}.${key}`, '缺少必填字段');
  }
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== 'string') invalid(path, '必须是字符串');
  return value;
}

function identifierAt(value: unknown, path: string): string {
  const identifier = stringAt(value, path);
  if (!identifier || identifier.trim() !== identifier || /[:/\\\u0000-\u001f\u007f-\u009f]/.test(identifier)) {
    invalid(path, '必须是首尾无空白且不含冒号、斜杠或控制字符的非空标识');
  }
  return identifier;
}

function imagePathAt(value: unknown, path: string): string {
  const image = stringAt(value, path);
  const segments = image.split('/');
  if (!image.startsWith('content/assets/portrait/')
    || image.includes('\\')
    || segments.some(segment => !segment || segment === '.' || segment === '..')
    || !imageExtension.test(image)) {
    invalid(path, '必须是完整的 content/assets/portrait 图片路径（png、jpg、jpeg、webp、gif、avif 或 svg）');
  }
  return image;
}

function durationAt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_DURATION_MS) {
    invalid(path, `必须是 1 到 ${MAX_DURATION_MS} 之间的整数`);
  }
  return value;
}

function loopAt(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') invalid(path, '必须是布尔值');
  return value;
}

function checkedTotal(frames: readonly { durationMs: number }[], path: string): void {
  const total = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  if (total > MAX_DURATION_MS) invalid(path, `总时长不得超过 ${MAX_DURATION_MS} 毫秒`);
}

function parseSequenceFrames(value: unknown, path: string): PortraitVisualFrame[] {
  const frames = arrayAt(value, path, 1, 256).map((entry, index) => {
    const framePath = `${path}[${index}]`;
    const frame = recordAt(entry, framePath);
    exactFields(frame, framePath, ['image', 'durationMs']);
    return {
      image: imagePathAt(frame.image, `${framePath}.image`),
      durationMs: durationAt(frame.durationMs, `${framePath}.durationMs`),
    };
  });
  checkedTotal(frames, path);
  return frames;
}

function parseAnimation(
  value: unknown,
  path: string,
  images: Record<string, string>,
): PortraitVisualAnimation {
  const animation = recordAt(value, path);
  exactFields(animation, path, ['frames', 'loop']);
  const frames = arrayAt(animation.frames, `${path}.frames`, 1, 256).map((entry, index) => {
    const framePath = `${path}.frames[${index}]`;
    const frame = recordAt(entry, framePath);
    exactFields(frame, framePath, ['variant', 'durationMs']);
    const variant = identifierAt(frame.variant, `${framePath}.variant`);
    if (!own(images, variant)) invalid(`${framePath}.variant`, '未在本层 images 中定义');
    return { variant, durationMs: durationAt(frame.durationMs, `${framePath}.durationMs`) };
  });
  checkedTotal(frames, `${path}.frames`);
  return { frames, loop: loopAt(animation.loop, `${path}.loop`) };
}

function parseImages(value: unknown, path: string): Record<string, string> {
  const source = recordAt(value, path);
  const entries = Object.entries(source).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (entries.length < 1 || entries.length > 64) {
    invalid(path, '变体数量必须在 1 到 64 之间');
  }
  const normalized: Array<[string, string]> = entries.map(([variant, image], index) => {
    const variantPath = `${path}.${variant || `[${index}]`}`;
    identifierAt(variant, variantPath);
    return [variant, imagePathAt(image, variantPath)];
  });
  return Object.fromEntries(normalized);
}

function parseLayer(value: unknown, path: string): PortraitVisualLayer {
  const layer = recordAt(value, path);
  exactFields(layer, path, ['id', 'images', 'default'], ['idle', 'speaking']);
  const id = identifierAt(layer.id, `${path}.id`);
  const images = parseImages(layer.images, `${path}.images`);
  const defaultVariant = identifierAt(layer.default, `${path}.default`);
  if (!own(images, defaultVariant)) invalid(`${path}.default`, '未在本层 images 中定义');
  const result: PortraitVisualLayer = { id, images, default: defaultVariant };
  if (own(layer, 'idle')) result.idle = parseAnimation(layer.idle, `${path}.idle`, images);
  if (own(layer, 'speaking')) result.speaking = parseAnimation(layer.speaking, `${path}.speaking`, images);
  return result;
}

/** Validates the strict data format and returns a fully detached normalized copy. */
export function parsePortraitVisual(value: unknown): PortraitVisualDefinition {
  const source = recordAt(value, '$');
  if (source.version !== 1) invalid('$.version', '目前只支持版本 1');
  if (source.kind === 'sequence') {
    exactFields(source, '$', ['version', 'kind', 'frames', 'loop']);
    return {
      version: 1,
      kind: 'sequence',
      frames: parseSequenceFrames(source.frames, '$.frames'),
      loop: loopAt(source.loop, '$.loop'),
    };
  }
  if (source.kind === 'layered') {
    exactFields(source, '$', ['version', 'kind', 'layers']);
    const layers = arrayAt(source.layers, '$.layers', 1, 16).map((entry, index) => parseLayer(entry, `$.layers[${index}]`));
    const ids = new Set<string>();
    for (let index = 0; index < layers.length; index++) {
      const layer = layers[index]!;
      if (ids.has(layer.id)) invalid(`$.layers[${index}].id`, '图层 ID 重复');
      ids.add(layer.id);
    }
    return { version: 1, kind: 'layered', layers };
  }
  invalid('$.kind', '必须是 sequence 或 layered');
}

/** Returns every referenced image once, in first-seen definition order. */
export function portraitVisualPaths(definition: PortraitVisualDefinition): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (image: string) => {
    if (!seen.has(image)) {
      seen.add(image);
      paths.push(image);
    }
  };
  if (definition.kind === 'sequence') {
    for (const frame of definition.frames) add(frame.image);
  } else {
    for (const layer of definition.layers) {
      for (const image of Object.values(layer.images)) add(image);
    }
  }
  return paths;
}

function sampleFrame(
  frames: readonly { durationMs: number }[],
  elapsedMs: number,
  loop: boolean,
): { index: number; active: boolean } {
  const total = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  if (!loop && elapsedMs >= total) return { index: frames.length - 1, active: false };
  const position = loop ? elapsedMs % total : elapsedMs;
  let end = 0;
  for (let index = 0; index < frames.length; index++) {
    end += frames[index]!.durationMs;
    if (position < end) return { index, active: true };
  }
  return { index: frames.length - 1, active: true };
}

/** Samples one image per independent sequence or one variant per layered part. */
export function samplePortraitVisual(
  definition: PortraitVisualDefinition,
  elapsedMs: number,
  speaking = false,
  motion = true,
): { images: string[]; active: boolean } {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error('立绘视觉采样参数错误（elapsedMs）：必须是有限的非负数。');
  }
  if (definition.kind === 'sequence') {
    if (!motion) return { images: [definition.frames[0]!.image], active: false };
    const sample = sampleFrame(definition.frames, elapsedMs, definition.loop);
    return { images: [definition.frames[sample.index]!.image], active: sample.active };
  }

  let active = false;
  const images = definition.layers.map(layer => {
    if (!motion) return layer.images[layer.default]!;
    const animation = speaking ? (layer.speaking ?? layer.idle) : layer.idle;
    if (!animation) return layer.images[layer.default]!;
    const sample = sampleFrame(animation.frames, elapsedMs, animation.loop);
    active ||= sample.active;
    return layer.images[animation.frames[sample.index]!.variant]!;
  });
  return { images, active };
}
