import { parsePortraitVisual, portraitVisualPaths, samplePortraitVisual, type PortraitVisualDefinition } from './portrait-visual.js';

export type CharacterPortraits = Record<string, Record<string, string>>;
export type CharacterVisuals = Record<string, Record<string, PortraitVisualDefinition>>;

export interface ProjectPortrait {
  role: string;
  outfit: string;
  expression: string;
  sourcePath: string;
  visual?: PortraitVisualDefinition;
  /** Explicit slots replace filename discovery, even when their file is missing. */
  configured?: true;
  overriddenSourcePaths?: string[];
}

const image = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validPart = (value: string) => value.length > 0 && value.trim() === value && !/[:/\\"\u0000-\u001f]/.test(value);
const slot = (portrait: ProjectPortrait) => `${portrait.role}:${portrait.outfit}:${portrait.expression}`;
const compare = ([a]: [string, unknown], [b]: [string, unknown]) => a < b ? -1 : a > b ? 1 : 0;

export function portraitSourcePaths(portrait: ProjectPortrait): string[] {
  return portrait.visual ? portraitVisualPaths(portrait.visual) : [portrait.sourcePath];
}

/** Automatic discovery has one identity grammar, shared with authoring diagnostics. */
export function parsePortraitFileName(fileName: string): Pick<ProjectPortrait, 'role' | 'outfit' | 'expression'> | null {
  if (Array.from(fileName).length > 120 || fileName.trim() !== fileName || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(fileName)) return null;
  const parts = fileName.replace(/\.[^.]*$/, '').split('_');
  if (parts.length !== 3 || parts.some(part => !validPart(part))) return null;
  const [role, outfit, expression] = parts as [string, string, string];
  return { role, outfit, expression };
}

/** A catalog may report ambiguous slots; a runtime must never choose one implicitly. */
export function assertUniquePortraitBindings(bindings: readonly ProjectPortrait[]): void {
  const paths = new Map<string, string>();
  for (const binding of bindings) {
    const identity = slot(binding), previous = paths.get(identity);
    if (previous !== undefined && previous !== binding.sourcePath) {
      throw new Error(`立绘绑定冲突：${identity}（${previous}、${binding.sourcePath}）。请在角色资料中明确绑定文件。`);
    }
    paths.set(identity, binding.sourcePath);
  }
}

/** Only explicit mappings: stable config dependency, independent of display names and avatars. */
export function projectPortraitOverrides(config: Record<string, unknown>): ProjectPortrait[] {
  const result: ProjectPortrait[] = [];
  if (!record(config.characters)) return result;
  for (const [role, declaration] of Object.entries(config.characters).sort(compare)) {
    if (!record(declaration)) continue;
    if (declaration.portraits === undefined && declaration.visuals === undefined) continue;
    if (!validPart(role) || (declaration.portraits !== undefined && !record(declaration.portraits))) throw new Error(`角色立绘配置非法：characters.${role}.portraits`);
    for (const [outfit, expressions] of Object.entries(declaration.portraits ?? {}).sort(compare)) {
      if (!validPart(outfit) || !record(expressions)) throw new Error(`角色服装配置非法：${role}:${outfit}`);
      for (const [expression, sourcePath] of Object.entries(expressions).sort(compare)) {
        if (!validPart(expression) || typeof sourcePath !== 'string' || !sourcePath.startsWith('content/assets/portrait/')
          || sourcePath.includes('\\') || sourcePath.split('/').some(part => !part || part === '.' || part === '..') || !image.test(sourcePath)) {
          throw new Error(`角色表情必须指向完整立绘图片路径：${role}:${outfit}:${expression} → ${String(sourcePath)}`);
        }
        result.push({ role, outfit, expression, sourcePath, configured: true });
      }
    }
    if (declaration.visuals !== undefined && !record(declaration.visuals)) throw new Error(`角色动态配置非法：characters.${role}.visuals`);
    for (const [outfit, expressions] of Object.entries(declaration.visuals ?? {}).sort(compare)) {
      if (!validPart(outfit) || !record(expressions)) throw new Error(`角色动态服装配置非法：${role}:${outfit}`);
      for (const [expression, value] of Object.entries(expressions).sort(compare)) {
        if (!validPart(expression)) throw new Error(`角色动态表情非法：${role}:${outfit}:${expression}`);
        if (result.some(item => item.role === role && item.outfit === outfit && item.expression === expression)) throw new Error(`静态与动态立绘显式绑定冲突：${role}:${outfit}:${expression}`);
        const visual = parsePortraitVisual(value);
        result.push({ role, outfit, expression, sourcePath: samplePortraitVisual(visual, 0, false, false).images[0]!, visual, configured: true });
      }
    }
  }
  return result;
}

/** Shared by the catalog, Player and working preview. Does not read files or select duplicate auto entries. */
export function resolveProjectPortraits(config: Record<string, unknown>, paths: readonly string[]): ProjectPortrait[] {
  const overrides = projectPortraitOverrides(config);
  const automatic: ProjectPortrait[] = [];
  for (const sourcePath of [...new Set(paths)].sort()) {
    if (!/^content\/assets\/portrait\//i.test(sourcePath) || sourcePath.includes('\\') || !image.test(sourcePath)) continue;
    const identity = parsePortraitFileName(sourcePath.split('/').at(-1)!);
    if (identity) automatic.push({ ...identity, sourcePath });
  }
  const explicitSlots = new Set(overrides.map(slot));
  return [
    ...automatic.filter(value => !explicitSlots.has(slot(value))),
    ...overrides.map(value => ({ ...value, overriddenSourcePaths: automatic.filter(auto => slot(auto) === slot(value) && auto.sourcePath !== value.sourcePath).map(auto => auto.sourcePath) })),
  ];
}
