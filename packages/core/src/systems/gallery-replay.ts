import { VariableStore, type VarDeclaration, type VarValue } from '../state/variable-store.js';
import { isJsonSafeValue } from '../save/save-manager.js';

export interface GalleryReplayEntry extends Record<string, unknown> {
  id: string; name: string; scene: string; label?: string; variables?: Record<string, VarValue>;
}

export function readGalleryReplayEntries(gallery: Record<string, unknown>, declarations?: readonly VarDeclaration[]): GalleryReplayEntry[] {
  const entries = gallery.texts === undefined ? [] : gallery.texts;
  if (!Array.isArray(entries)) throw new Error('剧情回想 texts 必须是数组');
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
      || ['id', 'name', 'scene'].some(key => typeof entry[key] !== 'string' || !entry[key].trim())
      || (entry.label !== undefined && (typeof entry.label !== 'string' || !entry.label.trim()))) {
      throw new Error('剧情回想必须包含非空 id/name/scene，label 若提供必须非空');
    }
    if (ids.has(entry.id)) throw new Error(`回想标识重复：${entry.id}`);
    ids.add(entry.id);
    if (entry.variables !== undefined) {
      if (!entry.variables || typeof entry.variables !== 'object' || Array.isArray(entry.variables) || !isJsonSafeValue(entry.variables)) throw new Error(`回想 ${entry.id} 的初始变量必须是 JSON 对象`);
      if (declarations) resolveGalleryReplayVariables(declarations, entry.variables);
    }
  }
  return entries;
}

/** The author supplies initial conditions, not a copy of the player's live variables. */
export function resolveGalleryReplayVariables(declarations: readonly VarDeclaration[], overrides: unknown): Record<string, VarValue> {
  const fresh = new VariableStore(declarations);
  if (overrides === undefined) return fresh.snapshot();
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || !isJsonSafeValue(overrides)) {
    throw new Error('回想初始变量必须是可保存的 JSON 对象');
  }
  for (const [name, value] of Object.entries(overrides)) {
    const declaration = declarations.find(item => item.name === name);
    if (!declaration) throw new Error(`回想初始变量未声明：${name}`);
    if (typeof value === 'number' && ((declaration.min !== undefined && value < declaration.min)
      || (declaration.max !== undefined && value > declaration.max))) throw new Error(`回想初始变量超出范围：${name}`);
  }
  // Initial conditions may set readonly declarations, but must still match their types.
  fresh.restore(overrides as Record<string, VarValue>, { allowReadonly: true });
  return fresh.snapshot();
}
