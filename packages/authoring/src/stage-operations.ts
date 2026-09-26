import { readProjectStage, projectStageAssetKeys, type ProjectStage } from '@surdet/core';
import { AuthoringOperationError, runOperation, stableStringify, type ChangeSession } from './change-session.js';
import { parseProjectConfigDocument, serializeProjectConfigDocument } from './config-document.js';
import type { LedgerDiffEntry, ProjectAssetCatalog } from './contracts.js';
import type { TextHasher } from './project-storage.js';

export interface StageConfigPatchInput {
  operationId: string;
  expectedFingerprint: string;
  /** Whole top-level tables replace; absent fields retain. Null removes the stage opt-in. */
  patch: Record<string, unknown> | null;
}
export async function inspectStageConfig(config: Record<string, unknown>, hasher: TextHasher) {
  let effective: ProjectStage | null;
  try { effective = readProjectStage(config); }
  catch (error) { throw new AuthoringOperationError('PROJECT_INVALID', error instanceof Error ? error.message : String(error)); }
  const value = config.stage ?? null;
  return { value, effective, fingerprint: await hasher.sha256(stableStringify(value)) };
}
export function validateStageAssetBindings(stage: ProjectStage | null, assets: ProjectAssetCatalog): void {
  for (const key of projectStageAssetKeys(stage)) {
    if (!assets.backgrounds.some(item => item.key === key && item.resolved && item.usage !== undefined)) {
      throw new AuthoringOperationError('VALIDATION_FAILED', `舞台背景/图层素材缺失或有歧义：${key}`);
    }
  }
  for (const [target, profile] of Object.entries(stage?.portraits ?? {})) {
    for (const [expression, pin] of Object.entries(profile.sources)) {
      const asset = assets.portraits.find(item => item.timelineTarget === target && item.expression === expression && item.resolved);
      const actual = assets.intelligence.items.find(item => item.physical && item.sourcePath === pin.path);
      if (!asset || asset.sourcePath !== pin.path || actual?.sha256 !== undefined && actual.sha256 !== pin.sha256)
        throw new AuthoringOperationError('VALIDATION_FAILED', `校准来源或字节摘要已变化：${target}:${expression}`);
    }
    for (const expression of Object.keys(profile.expressions)) {
      if (!assets.portraits.some(item => item.timelineTarget === target && item.expression === expression && item.resolved)) {
        throw new AuthoringOperationError('VALIDATION_FAILED', `校准所用角色表情不可解析：${target}:${expression}`);
      }
    }
  }
}
export async function applyStageConfigPatch(change: ChangeSession, input: StageConfigPatchInput, hasher: TextHasher, assets: ProjectAssetCatalog) {
  if (change.record.composition?.mode !== 'direct' || change.record.integration !== undefined) {
    throw new AuthoringOperationError('UNSUPPORTED_OPERATION', '舞台配置修改只支持普通 direct 草稿', { operationApplied: false, operationId: input.operationId });
  }
  return runOperation(change, input, async record => {
    const source = record.workingFiles['game.config.json'] ?? '{}';
    const config = parseProjectConfigDocument(source);
    const before = await inspectStageConfig(config, hasher);
    if (before.fingerprint !== input.expectedFingerprint) throw new AuthoringOperationError('OBJECT_REF_STALE', '舞台配置指纹已变化，请重新读取 project.inspect');
    if (input.patch === null) delete config.stage;
    else {
      if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) throw new AuthoringOperationError('INVALID_REQUEST', '舞台 patch 必须是字段对象或 null');
      const next: Record<string, unknown> = { version: 1, ...(before.value as Record<string, unknown> | null ?? {}) };
      for (const [key, value] of Object.entries(input.patch)) {
        if (!['version', 'design', 'positions', 'distances', 'portraits', 'compositions'].includes(key) || value === undefined)
          throw new AuthoringOperationError('INVALID_REQUEST', `非法舞台字段：${key}`);
        if (value === null) delete next[key]; else next[key] = value;
      }
      config.stage = next;
    }
    const after = await inspectStageConfig(config, hasher);
    validateStageAssetBindings(after.effective, assets);
    const diffEntry: LedgerDiffEntry = { kind: 'config.stage.patch', operationId: input.operationId,
      fingerprintBefore: before.fingerprint, fingerprintAfter: after.fingerprint,
      directChange: { path: 'game.config.json', fields: input.patch === null ? ['stage'] : Object.keys(input.patch) },
      potentialImpact: [], observedImpact: [] };
    return { result: { stageConfig: after, diffEntry }, workingFiles: { ...record.workingFiles,
      'game.config.json': serializeProjectConfigDocument(config, source) } };
  });
}
