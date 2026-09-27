import { PROJECT_UI_PAGES, projectUiAssetKeys, readProjectUi, type ProjectUiDocument, type ProjectUiNode, type ProjectUiPageId } from '@surdet/core';
import { AuthoringOperationError, runOperation, stableStringify, type ChangeSession } from './change-session.js';
import { parseProjectConfigDocument, serializeProjectConfigDocument } from './config-document.js';
import type { LedgerDiffEntry, ProjectAssetCatalog } from './contracts.js';
import type { TextHasher } from './project-storage.js';

const CONFIG_PATH = 'game.config.json';

export type UiPatch =
  | { type: 'page.set'; page: ProjectUiPageId; root: ProjectUiNode }
  | { type: 'page.remove'; page: ProjectUiPageId }
  | { type: 'node.insert'; page: ProjectUiPageId; parentId: string; index: number; node: ProjectUiNode }
  | { type: 'node.update'; page: ProjectUiPageId; id: string; patch: Partial<Omit<ProjectUiNode, 'id' | 'type' | 'children'>> }
  | { type: 'node.remove'; page: ProjectUiPageId; id: string }
  | { type: 'node.copy'; page: ProjectUiPageId; id: string; newId: string; index?: number }
  | { type: 'node.reorder'; page: ProjectUiPageId; id: string; index: number };

export interface UiPatchInput { operationId: string; expectedFingerprint: string; patch: UiPatch }

export interface UiInspection {
  value: ProjectUiDocument | null;
  defaultPages: ProjectUiPageId[];
  nodes: Array<{ page: ProjectUiPageId; id: string; type: ProjectUiNode['type']; parentId: string | null }>;
  fingerprint: string;
}

function uiError(error: unknown): never {
  throw new AuthoringOperationError('UI_INVALID', error instanceof Error ? error.message : String(error));
}

export async function inspectUi(config: Record<string, unknown>, hasher: TextHasher): Promise<UiInspection> {
  let value: ProjectUiDocument | null;
  try { value = readProjectUi(config); } catch (error) { uiError(error); }
  const nodes: UiInspection['nodes'] = [];
  const visit = (page: ProjectUiPageId, node: ProjectUiNode, parentId: string | null): void => {
    nodes.push({ page, id: node.id, type: node.type, parentId });
    node.children?.forEach(child => visit(page, child, node.id));
  };
  if (value) for (const page of PROJECT_UI_PAGES) {
    const root = value.pages[page];
    if (root) visit(page, root, null);
  }
  return { value, nodes, defaultPages: PROJECT_UI_PAGES.filter(page => value?.pages[page] === undefined),
    fingerprint: await hasher.sha256(stableStringify(value)) };
}

export function validateUiAssets(ui: ProjectUiDocument | null, assets: ProjectAssetCatalog): void {
  for (const key of projectUiAssetKeys(ui)) {
    const matches = assets.backgrounds.filter(asset => asset.key === key);
    if (matches.length !== 1 || !matches[0]?.resolved) {
      throw new AuthoringOperationError('UI_INVALID', `UI 图片必须对应唯一受支持的项目素材：${key}`);
    }
  }
}

function findNode(root: ProjectUiNode, id: string): { node: ProjectUiNode; siblings: ProjectUiNode[] | null; index: number } | null {
  if (root.id === id) return { node: root, siblings: null, index: 0 };
  const visit = (children: ProjectUiNode[]): ReturnType<typeof findNode> => {
    for (let index = 0; index < children.length; index++) {
      const node = children[index]!;
      if (node.id === id) return { node, siblings: children, index };
      if (node.children) {
        const found = visit(node.children);
        if (found) return found;
      }
    }
    return null;
  };
  return root.children ? visit(root.children) : null;
}

function indexInRange(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index > length) throw new AuthoringOperationError('INVALID_REQUEST', `UI 兄弟位置必须在 0..${length}`);
}

function cloneForCopy(node: ProjectUiNode, newId: string): ProjectUiNode {
  return { ...node, id: newId, ...(node.children ? { children: node.children.map(child => cloneForCopy(child, `${newId}_${child.id}`)) } : {}) };
}

/** The Editor and public operation apply exactly the same one-node edit rules. */
export function patchUiDocument(current: ProjectUiDocument | null, config: Record<string, unknown>, patch: UiPatch): ProjectUiDocument | null {
    if (!patch || typeof patch !== 'object' || !PROJECT_UI_PAGES.includes(patch.page)) throw new AuthoringOperationError('INVALID_REQUEST', 'UI patch 页面或操作非法');
    const ui: ProjectUiDocument = current === null ? { version: 1, pages: {} } : JSON.parse(JSON.stringify(current)) as ProjectUiDocument;
    const root = ui.pages[patch.page];
    if (patch.type === 'page.set') {
      ui.pages[patch.page] = patch.root;
    } else if (patch.type === 'page.remove') {
      delete ui.pages[patch.page];
    } else {
      if (!root) throw new AuthoringOperationError('INVALID_REQUEST', `UI 页面 ${patch.page} 尚未建立`);
      if (patch.type === 'node.insert') {
        const parent = findNode(root, patch.parentId)?.node;
        if (!parent || !['container', 'scroll', 'tabs', 'content'].includes(parent.type)) throw new AuthoringOperationError('INVALID_REQUEST', 'UI 父节点不存在或不允许子节点');
        const children = parent.children ??= [];
        indexInRange(patch.index, children.length);
        children.splice(patch.index, 0, patch.node);
      } else if (patch.type === 'node.update') {
        const found = findNode(root, patch.id);
        if (!found) throw new AuthoringOperationError('INVALID_REQUEST', `UI 节点不存在：${patch.id}`);
        const allowed = new Set(['frame', 'text', 'binding', 'action', 'asset', 'source', 'tab', 'style']);
        for (const [key, value] of Object.entries(patch.patch ?? {})) {
          if (!allowed.has(key)) throw new AuthoringOperationError('INVALID_REQUEST', `UI 节点字段不可修改：${key}`);
          if (value === null) delete (found.node as unknown as Record<string, unknown>)[key];
          else (found.node as unknown as Record<string, unknown>)[key] = value;
        }
      } else if (patch.type === 'node.remove') {
        const found = findNode(root, patch.id);
        if (!found?.siblings) throw new AuthoringOperationError('INVALID_REQUEST', '页面根节点不可移除，请移除页面');
        found.siblings.splice(found.index, 1);
      } else if (patch.type === 'node.copy') {
        const found = findNode(root, patch.id);
        if (!found?.siblings) throw new AuthoringOperationError('INVALID_REQUEST', '页面根节点不可复制，请设置页面');
        const index = patch.index ?? found.index + 1;
        indexInRange(index, found.siblings.length);
        found.siblings.splice(index, 0, cloneForCopy(found.node, patch.newId));
      } else if (patch.type === 'node.reorder') {
        const found = findNode(root, patch.id);
        if (!found?.siblings) throw new AuthoringOperationError('INVALID_REQUEST', '页面根节点不可重排');
        indexInRange(patch.index, found.siblings.length - 1);
        found.siblings.splice(found.index, 1);
        found.siblings.splice(patch.index, 0, found.node);
      } else throw new AuthoringOperationError('INVALID_REQUEST', '未知 UI 操作');
    }
    const projected = { ...config };
    if (Object.keys(ui.pages).length === 0) delete projected.ui;
    else projected.ui = ui;
    try { return readProjectUi(projected); } catch (error) { uiError(error); }
}

export async function applyUiPatch(change: ChangeSession, input: UiPatchInput, hasher: TextHasher, assets: ProjectAssetCatalog) {
  if (change.record.composition?.mode !== 'direct' || change.record.integration !== undefined) {
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', 'UI 修改只支持 direct 草稿', { operationApplied: false, operationId: input.operationId });
  }
  return runOperation(change, input, async record => {
    const source = record.workingFiles[CONFIG_PATH] ?? '{}';
    const config = parseProjectConfigDocument(source);
    const before = await inspectUi(config, hasher);
    if (before.fingerprint !== input.expectedFingerprint) throw new AuthoringOperationError('OBJECT_REF_STALE', 'UI 指纹已变化，请重新读取 project.ui');
    const patch = input.patch;
    const value = patchUiDocument(before.value, config, patch);
    if (value === null) delete config.ui;
    else config.ui = value;
    const after = await inspectUi(config, hasher);
    validateUiAssets(after.value, assets);
    const diffEntry: LedgerDiffEntry = {
      kind: 'config.ui.patch', operationId: input.operationId,
      fingerprintBefore: before.fingerprint, fingerprintAfter: after.fingerprint,
      directChange: { path: CONFIG_PATH, fields: [`ui.pages.${patch.page}`] }, potentialImpact: [], observedImpact: [],
    };
    return { result: { ui: after, diffEntry }, workingFiles: { ...record.workingFiles, [CONFIG_PATH]: serializeProjectConfigDocument(config, source) } };
  });
}
