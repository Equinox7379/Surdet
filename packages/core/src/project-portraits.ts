export type CharacterPortraits = Record<string, Record<string, string>>;

export interface ProjectPortrait {
  role: string;
  outfit: string;
  expression: string;
  sourcePath: string;
  /** Explicit slots replace filename discovery, even when their file is missing. */
  configured?: true;
  overriddenSourcePaths?: string[];
}

const image = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validPart = (value: string) => value.length > 0 && value.trim() === value && !/[:/\\"\u0000-\u001f]/.test(value);
const slot = (portrait: ProjectPortrait) => `${portrait.role}:${portrait.outfit}:${portrait.expression}`;
const compare = ([a]: [string, unknown], [b]: [string, unknown]) => a < b ? -1 : a > b ? 1 : 0;

/** Only explicit mappings: stable config dependency, independent of display names and avatars. */
export function projectPortraitOverrides(config: Record<string, unknown>): ProjectPortrait[] {
  const result: ProjectPortrait[] = [];
  if (!record(config.characters)) return result;
  for (const [role, declaration] of Object.entries(config.characters).sort(compare)) {
    if (!record(declaration) || declaration.portraits === undefined) continue;
    if (!validPart(role) || !record(declaration.portraits)) throw new Error(`角色立绘配置非法：characters.${role}.portraits`);
    for (const [outfit, expressions] of Object.entries(declaration.portraits).sort(compare)) {
      if (!validPart(outfit) || !record(expressions)) throw new Error(`角色服装配置非法：${role}:${outfit}`);
      for (const [expression, sourcePath] of Object.entries(expressions).sort(compare)) {
        if (!validPart(expression) || typeof sourcePath !== 'string' || !sourcePath.startsWith('content/assets/portrait/')
          || sourcePath.includes('\\') || sourcePath.split('/').some(part => !part || part === '.' || part === '..') || !image.test(sourcePath)) {
          throw new Error(`角色表情必须指向完整立绘图片路径：${role}:${outfit}:${expression} → ${String(sourcePath)}`);
        }
        result.push({ role, outfit, expression, sourcePath, configured: true });
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
    const [role, outfit = 'normal', expression = 'normal'] = sourcePath.split('/').at(-1)!.replace(image, '').split('_');
    if (role) automatic.push({ role, outfit, expression, sourcePath });
  }
  const explicitSlots = new Set(overrides.map(slot));
  return [
    ...automatic.filter(value => !explicitSlots.has(slot(value))),
    ...overrides.map(value => ({ ...value, overriddenSourcePaths: automatic.filter(auto => slot(auto) === slot(value) && auto.sourcePath !== value.sourcePath).map(auto => auto.sourcePath) })),
  ];
}
