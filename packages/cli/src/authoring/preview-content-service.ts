import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DslError } from '@surdet/core';
import {
  AuthoringOperationError, isPreviewAssetPath, isPreviewSourcePath, isSnapshotPath, isContentHistoryPath, loadProjectSnapshot, parsePreviewContentTarget, stableStringify,
  fingerprintWorkingObject, fingerprintWorkingObjectValue,
  type PreviewContent, type PreviewContentOption, type PreviewContentTarget, type ProjectStorage, type ChangeRecord,
} from '@surdet/authoring';
import { NodeChangeStore } from './node-change-store.js';
import { NodeLocalLeaseManager } from './node-local-lease.js';
import { NodeProjectStorage } from './node-project-storage.js';
import { loadProjectCoordinationBaseline } from './project-coordination-baseline.js';
import { projectIdentityFromRoot } from './project-identity.js';
import { ChangeRecordProjectStorage } from './working-project-storage.js';
import { NodeCompositionStore } from './node-composition-store.js';
import { readJsonRecord } from './node-json-record.js';
import { materializeCompositionReplay } from './composition-service.js';
import { NodeReviewStore } from './node-review-store.js';
import { hashProjectTree } from './review-service.js';

const hasher = { sha256: async (text: string) => crypto.createHash('sha256').update(text, 'utf8').digest('hex') };
function stale(message: string): never { throw new AuthoringOperationError('PREVIEW_OBSERVATION_STALE', message); }
async function snapshotOf(storage: ProjectStorage) {
  try { return await loadProjectSnapshot(storage, hasher); }
  catch (error) {
    if (error instanceof DslError || error instanceof SyntaxError || (error instanceof AuthoringOperationError && error.code === 'PROJECT_INVALID')) {
      throw new AuthoringOperationError('PREVIEW_CONTENT_INVALID', `试玩内容无法编译或读取配置：${error.message}`);
    }
    throw error;
  }
}
async function directories(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  return entries.filter(entry => entry.isDirectory() && /^[A-Za-z0-9_-]+$/.test(entry.name)).map(entry => entry.name).sort();
}
function overlay(disk: NodeProjectStorage, record: ChangeRecord): ProjectStorage {
  const working = new ChangeRecordProjectStorage(record);
  const owns = (file: string) => isSnapshotPath(file) || isContentHistoryPath(file)
    && (Object.hasOwn(record.baseFiles, file) || Object.hasOwn(record.workingFiles, file));
  return {
    rootIdentity: disk.rootIdentity,
    listFiles: async () => [...new Set([...(await disk.listFiles()).filter(file => !owns(file)), ...await working.listFiles()])].sort(),
    readText: file => owns(file) ? working.readText(file) : disk.readText(file),
    exists: file => owns(file) ? working.exists(file) : disk.exists(file),
  };
}

/** Resolves existing project/change storage without creating a game, change, plan, or write receipt. */
export class PreviewContentService {
  constructor(private readonly dataRoot = new NodeLocalLeaseManager().dataRoot) {}

  async list(root: string): Promise<PreviewContentOption[]> {
    const disk = await NodeProjectStorage.open(root);
    const directory = path.join(this.dataRoot, projectIdentityFromRoot(disk.rootIdentity));
    const compositions = new NodeCompositionStore(directory, projectIdentityFromRoot(disk.rootIdentity));
    const result: PreviewContentOption[] = [{ target: { kind: 'saved-project' }, title: '来源项目（已保存）' }];
    for (const changeId of (await directories(directory)).filter(name => name.startsWith('chg_'))) {
      const opened = await NodeChangeStore.openForProject(changeId, disk.rootIdentity, { dataRoot: this.dataRoot, allowStale: true, allowTerminal: true });
      if (!opened) continue;
      const record = opened.record;
      if (record.status === 'OPEN' && !record.integration) result.push({ target: { kind: 'working-change', changeId: record.changeId },
        title: `工作变更 · ${record.intent?.intent ?? record.changeId} · 版本 ${record.workingRevision}` });
      if (record.status === 'OPEN' && record.integration?.status === 'READY') result.push({
        target: { kind: 'integration-result', changeId, planId: record.integration.planId, planFingerprint: record.integration.planFingerprint, workingRevision: record.workingRevision },
        title: `组合结果（只读）· ${record.intent?.intent ?? changeId}`,
      });
      for (const capsuleId of await directories(path.join(directory, changeId, 'capsules'))) {
        const sidecar = await readJsonRecord<{ sha256: string }>(path.join(directory, changeId, 'capsules', capsuleId, 'identity.json'));
        if (!sidecar) continue;
        const ref = { changeId, capsuleId, artifactSha256: sidecar.value.sha256 };
        const candidate = await compositions.readCandidate(ref);
        if (candidate.composition.eligibility !== 'ready') continue;
        result.push({ target: { kind: 'candidate', ...ref }, title: `封存候选（只读）· ${candidate.intent ?? changeId} · 版本 ${candidate.sourceWorkingRevision} · ${capsuleId.slice(-8)}` });
      }
    }
    return result;
  }

  async resolve(root: string, request: PreviewContentTarget): Promise<{ content: PreviewContent; storage: ProjectStorage }> {
    const target = parsePreviewContentTarget(request);
    const disk = await NodeProjectStorage.open(root);
    const before = await loadProjectCoordinationBaseline(disk);
    let storage: ProjectStorage = disk;
    let resolved = target;
    let title = '来源项目（已保存）';
    const projectIdentity = projectIdentityFromRoot(disk.rootIdentity);
    const compositions = new NodeCompositionStore(path.join(this.dataRoot, projectIdentity), projectIdentity);
    if (target.kind === 'working-change') {
      const opened = await NodeChangeStore.openForProject(target.changeId, disk.rootIdentity, { dataRoot: this.dataRoot });
      if (!opened) throw new AuthoringOperationError('CHANGE_NOT_FOUND', '当前项目中没有这份工作变更');
      const record = opened.record;
      if (record.status !== 'OPEN' || record.integration) throw new AuthoringOperationError('CHANGE_NOT_OPEN', '此内容不是可编辑的工作变更，请选择对应封存结果');
      if (record.baseRevision !== before.projectRevision) throw new AuthoringOperationError('PREVIEW_CONTENT_BASE_CHANGED', '来源项目已离开这份工作变更的基线');
      if (target.workingRevision !== undefined && target.workingRevision !== record.workingRevision) throw new AuthoringOperationError('PREVIEW_CONTENT_CHANGED', '工作变更已修改，请重新加载当前工作版本');
      resolved = { kind: 'working-change', changeId: record.changeId, workingRevision: record.workingRevision };
      title = `工作变更 · ${record.intent?.intent ?? record.changeId} · 版本 ${record.workingRevision}`;
      storage = overlay(disk, record);
    } else if (target.kind === 'candidate') {
      const candidate = await compositions.readCandidate(target);
      const manifest = candidate.composition.manifest;
      if (candidate.projectIdentity !== projectIdentity) throw new AuthoringOperationError('PROJECT_IDENTITY_MISMATCH', '封存候选不属于当前项目');
      if (candidate.baseProjectRevision !== before.projectRevision) throw new AuthoringOperationError('PREVIEW_CONTENT_BASE_CHANGED', '封存候选的来源基线已变化');
      if (candidate.composition.eligibility !== 'ready' || !manifest) throw new AuthoringOperationError('CANDIDATE_NOT_COMPOSABLE', '候选没有可核对的封存操作');
      const { manifestFingerprint, ...body } = manifest;
      if (manifest.sourceChangeId !== target.changeId || manifest.projectIdentity !== projectIdentity
        || manifest.baseProjectRevision !== before.projectRevision || manifest.sourceWorkingRevision !== candidate.sourceWorkingRevision
        || await hasher.sha256(stableStringify(body)) !== manifestFingerprint) stale('候选封存操作身份不匹配');
      for (const [index, operation] of manifest.operations.entries()) {
        if (operation.sequence !== index || await hasher.sha256(stableStringify(operation.normalizedInput)) !== operation.inputSha256) stale('候选封存操作顺序或输入指纹不匹配');
      }
      const produced = new Map(manifest.operations.flatMap(operation => operation.producedObjects.map(object => [object.objectRef, object] as const)));
      const replay = await materializeCompositionReplay(await snapshotOf(disk), {
        expectedProjectRevision: candidate.baseProjectRevision,
        replayOperations: manifest.operations.map(operation => ({ ...operation, integrationOperationId: `preview-${operation.sequence}`, sourceCapsule: target, sourceUnitId: operation.primaryObject })),
        provenance: [...produced.keys()].map(targetObject => ({ targetObject, sourceCapsule: target, sourceUnitId: targetObject, sourceOperationIds: [] })),
      }, hasher);
      if (!replay.record) throw new AuthoringOperationError('COMPOSITION_REPLAY_FAILED', '封存候选无法按原操作重放', { errors: replay.report.errors });
      storage = overlay(disk, replay.record);
      for (const [objectRef, object] of produced) {
        // Manifest facts hash the object's value; plan dry-run fingerprints also
        // wrap object identity/presence and are deliberately a different contract.
        const actual = await fingerprintWorkingObjectValue(replay.record.workingFiles, objectRef, hasher);
        if (object.disposition === 'remove' ? actual !== undefined
          : object.finalFingerprint !== undefined && object.finalFingerprint !== actual) stale('候选重放内容与封存产物指纹不一致');
      }
      title = `封存候选（只读）· ${candidate.intent ?? target.changeId} · 版本 ${candidate.sourceWorkingRevision}`;
    } else if (target.kind === 'integration-result') {
      const opened = await NodeChangeStore.openForProject(target.changeId, disk.rootIdentity, { dataRoot: this.dataRoot, allowTerminal: true });
      const record = opened?.record;
      if (record && record.baseRevision !== before.projectRevision) throw new AuthoringOperationError('PREVIEW_CONTENT_BASE_CHANGED', '组合结果的来源基线已变化');
      if (!record || record.status !== 'OPEN' || record.workingRevision !== target.workingRevision || record.baseRevision !== before.projectRevision
        || record.integration?.status !== 'READY' || record.integration.planId !== target.planId || record.integration.planFingerprint !== target.planFingerprint) stale('组合结果身份、版本或来源基线已变化');
      const { plan } = await compositions.readPlan(target.planId);
      if (plan.projectIdentity !== projectIdentity || plan.planId !== target.planId || plan.planFingerprint !== target.planFingerprint || plan.expectedProjectRevision !== before.projectRevision || plan.dryRun.status !== 'passed') stale('组合结果的封存计划不匹配');
      const plannedOperations = new Set(plan.replayOperations.map(operation => operation.integrationOperationId));
      if (Object.keys(record.operations).some(operationId => !plannedOperations.has(operationId))) {
        stale('组合包含保存计划之外的编辑，请返回原工作变更返修并重新组合');
      }
      for (const [objectRef, expected] of Object.entries(plan.dryRun.finalObjectFingerprints)) {
        if ((await fingerprintWorkingObject(record.workingFiles, objectRef, hasher)).fingerprint !== expected) stale('组合结果已偏离封存计划产物');
      }
      const review = record.integration.review?.resultReview;
      storage = overlay(disk, record);
      if (review) {
        const reviews = new NodeReviewStore(compositions.projectDirectory, projectIdentity);
        const directory = await reviews.resultProjectDirectory(review.reviewId);
        if (review.workingRevision !== record.workingRevision || await hashProjectTree(directory) !== review.resultTreeSha256) stale('正式结果目录已变化');
        const result = await NodeProjectStorage.open(directory);
        if ((await snapshotOf(result)).revision !== (await snapshotOf(storage)).revision) stale('正式结果与原组合工作内容不匹配');
        const assetPaths = (await result.listFiles()).filter(isPreviewAssetPath).sort();
        if (stableStringify(assetPaths) !== stableStringify((await disk.listFiles()).filter(isPreviewAssetPath).sort())) {
          throw new AuthoringOperationError('PREVIEW_CONTENT_BASE_CHANGED', '来源素材目录已不同于正式结果');
        }
        for (const assetPath of assetPaths) {
          if ((await result.readFileFingerprint(assetPath)).sha256 !== (await disk.readFileFingerprint(assetPath)).sha256) {
            throw new AuthoringOperationError('PREVIEW_CONTENT_BASE_CHANGED', '来源素材字节已不同于正式结果');
          }
        }
        // Playback sends the bound source's identical asset bytes, but all text
        // and optional configuration now come from the verified sealed tree.
        storage = { rootIdentity: disk.rootIdentity, listFiles: () => result.listFiles(), readText: file => result.readText(file), exists: file => result.exists(file) };
      }
      title = `组合结果（只读）· ${record.intent?.intent ?? target.changeId}`;
    }
    const snapshot = await snapshotOf(storage);
    const files: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const file of (await storage.listFiles()).filter(isPreviewSourcePath)) files[file] = (await storage.readText(file)).text;
    const after = await loadProjectCoordinationBaseline(disk);
    if (before.coordinationRevision !== after.coordinationRevision) stale('读取试玩内容期间来源项目已变化');
    if (resolved.kind === 'working-change' || resolved.kind === 'integration-result') {
      const current = await NodeChangeStore.openForProject(resolved.changeId, disk.rootIdentity, { dataRoot: this.dataRoot, allowTerminal: true });
      if (current === null || current.record.workingRevision !== resolved.workingRevision || current.record.status !== 'OPEN') stale('读取试玩内容期间工作版本已变化');
    }
    return { storage, content: { target: resolved, title, files, contentRevision: snapshot.revision,
      projectIdentity: projectIdentityFromRoot(disk.rootIdentity), projectRevision: before.projectRevision, coordinationRevision: before.coordinationRevision } };
  }
}
