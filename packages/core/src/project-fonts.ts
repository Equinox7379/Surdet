export type ProjectFontRole = 'body' | 'title' | 'ui';

/** A role map replaces the whole legacy font setting; omitted/empty roles use defaults. */
export function resolveProjectFontPaths(config: unknown): Partial<Record<ProjectFontRole, string>> {
  if (typeof config !== 'object' || config === null) return {};
  const { fonts, font } = config as { fonts?: unknown; font?: unknown };
  if (fonts !== undefined && (typeof fonts !== 'object' || fonts === null || Array.isArray(fonts))) {
    throw new Error('game.config.json.fonts 必须是字体角色对象');
  }
  const paths: Partial<Record<ProjectFontRole, string>> = {};
  for (const role of ['body', 'title', 'ui'] as const) {
    const value = fonts === undefined ? font : (fonts as Record<string, unknown>)[role];
    if (value !== undefined && typeof value !== 'string') throw new Error(`game.config.json.${fonts === undefined ? 'font' : `fonts.${role}`} 必须是字符串`);
    if (typeof value === 'string' && value.length > 0) paths[role] = value;
  }
  return paths;
}
