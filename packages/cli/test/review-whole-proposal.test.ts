import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decisionFingerprintV2Of,
  approvalFingerprintOf,
  validateFinalApproval,
  integrationPlanContentFingerprintOf,
  stableStringify,
  type AuthoringObject,
  type ComparisonDecisionReceiptV2,
  type FinalApprovalReceipt,
  type ReviewDecisionPreview,
  type TextHasher,
} from '@surdet/authoring';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';
import { openAgentPortSession } from '../src/agent-port/session.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { NodeCompositionStore } from '../src/authoring/node-composition-store.js';
import { ReviewTerminalAuthority } from '../src/authoring/review-terminal-authority.js';
import { reviewServiceForProject } from '../src/authoring/review-service.js';
import { compositionServiceForProject } from '../src/authoring/composition-service.js';

const roots: string[] = [];
const originalDataRoot = process.env['SURDET_AGENT_DATA_DIR'];
const hasher: TextHasher = { sha256: async (text) => crypto.createHash('sha256').update(text).digest('hex') };

afterEach(() => {
  if (originalDataRoot === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
  else process.env['SURDET_AGENT_DATA_DIR'] = originalDataRoot;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else files[path.relative(root, file)] = fs.readFileSync(file).toString('base64');
    }
  };
  visit(root);
  return files;
}

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-whole-review-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const dataRoot = path.join(root, 'data');
  fs.mkdirSync(path.join(projectRoot, 'content/scenario'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }));
  fs.writeFileSync(path.join(projectRoot, 'content/scenario/start.gal'), '@scene start\n凛：原始对白。\n@end\n');
  process.env['SURDET_AGENT_DATA_DIR'] = dataRoot;
  const refs = [];
  const sealedTraceIds: string[][] = [];
  for (const name of ['a', 'b']) {
    const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
    try {
      expect((await session.invoke('change.begin', { intent: `候选 ${name} 自述`, acceptanceCriteria: [`${name} 的自定目标`] })).ok).toBe(true);
      const scene = await session.invoke('object.inspect', { objectRef: 'scene:start' });
      if (!scene.ok) throw new Error(JSON.stringify(scene));
      const target = await session.invoke('object.inspect', { objectRef: (scene.result as AuthoringObject).childRefs![1] });
      if (!target.ok) throw new Error(JSON.stringify(target));
      const object = target.result as AuthoringObject;
      expect((await session.invoke('scene.patch', {
        operationId: `text-${name}`, sceneId: 'start',
        patch: { kind: 'replaceText', target: object.objectRef, expectedFingerprint: object.fingerprint, value: `方案 ${name} 的对白。` },
      })).ok).toBe(true);
      expect((await session.invoke('scene.create', { operationId: `scene-${name}`, sceneId: `ending_${name}`, blocks: [{ kind: 'text', value: `${name} 独有结尾。` }] })).ok).toBe(true);
      expect((await session.invoke('variable.ensure', { operationId: `var-${name}`, name: `flag_${name}`, type: 'number', initial: 0 })).ok).toBe(true);
      for (const operation of ['project.validate', 'project.simulate', 'change.diff'] as const) {
        expect((await session.invoke(operation, {})).ok).toBe(true);
      }
      expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.composition.eligibility).toBe('ready');
      refs.push({ changeId: capsule.changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 });
      sealedTraceIds.push((await NodeChangeStore.openByChangeId(capsule.changeId))!.record.runtimeTraces!.map((trace) => trace.traceId));
      // A later run is valid evidence for the live change, but is not part of this sealed candidate.
      expect((await session.invoke('runtime.run-from', { sceneId: `ending_${name}`, choices: [] })).ok).toBe(true);
    } finally {
      await session.close();
    }
  }
  const service = await reviewServiceForProject(projectRoot, dataRoot);
  const prepared = await service.prepareComparison({ candidateRefs: refs, creativeBrief: { title: '委托', request: '原始创作要求', acceptanceCriteria: ['原始验收目标'] } });
  const command = { projectIdentity: prepared.identity.projectIdentity, reviewId: prepared.reviewId,
    reviewPayload: { bytes: prepared.identity.payload.bytes, sha256: prepared.identity.payload.sha256 } };
  const authority = new ReviewTerminalAuthority(dataRoot, undefined, hasher, projectRoot);
  const candidate = prepared.projection.candidates[0]!;
  const decisionIntent = { mode: 'adopt-candidate' as const, candidate: { candidateId: candidate.candidateId, ref: candidate.ref } };
  return { root, projectRoot, dataRoot, service, prepared, command, authority, decisionIntent, sealedTraceIds, refs };
}

async function receiptFor(f: Awaited<ReturnType<typeof fixture>>, preview: ReviewDecisionPreview): Promise<ComparisonDecisionReceiptV2> {
  const receipt: ComparisonDecisionReceiptV2 = {
    receiptVersion: '2.0.0', decisionId: 'decision_whole', reviewId: f.prepared.reviewId,
    reviewFingerprint: f.prepared.projection.reviewFingerprint,
    comparisonFingerprint: f.prepared.projection.sourceIdentity.comparisonFingerprint,
    projectIdentity: f.prepared.identity.projectIdentity, expectedProjectRevision: f.prepared.identity.expectedProjectRevision,
    candidateRefs: f.prepared.projection.candidates.map((candidate) => candidate.ref),
    decisionIntent: preview.decisionIntent, selectedUnitIds: preview.selectedUnitIds, conflictResolutions: preview.conflictResolutions,
    planContentFingerprint: preview.planContentFingerprint, previewFingerprint: preview.previewFingerprint,
    reviewerChannel: 'surdet-editor-local', decidedAt: '2026-09-11T00:00:00Z', decisionFingerprint: '',
  };
  receipt.decisionFingerprint = await decisionFingerprintV2Of(receipt, hasher);
  return receipt;
}

describe('whole proposal review through sealed candidates and local authority', () => {
  it.each(['stale', 'rename', 'patch-and-rename'] as const)('projects current scene content from a real %s candidate', async (mode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-review-content-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    const dataRoot = path.join(root, 'data');
    fs.mkdirSync(path.join(projectRoot, 'content/scenario/nested'), { recursive: true });
    const characters = { rin: { name: '凛' } };
    fs.writeFileSync(path.join(projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {}, characters }));
    fs.writeFileSync(path.join(projectRoot, mode === 'rename' ? 'content/scenario/nested/start.gal' : 'content/scenario/start.gal'), '@scene start\n凛：原始对白。\n@end\n');
    process.env['SURDET_AGENT_DATA_DIR'] = dataRoot;
    const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
    try {
      expect((await session.invoke('change.begin', { intent: '来源回归候选' })).ok).toBe(true);
      const patch = async (operationId: string, value: string) => {
        const scene = await session.invoke('object.inspect', { objectRef: 'scene:start' });
        if (!scene.ok) throw new Error(JSON.stringify(scene));
        const target = await session.invoke('object.inspect', { objectRef: (scene.result as AuthoringObject).childRefs![1] });
        if (!target.ok) throw new Error(JSON.stringify(target));
        const object = target.result as AuthoringObject;
        const changed = await session.invoke('scene.patch', { operationId, sceneId: 'start', patch: {
          kind: 'replaceText', target: object.objectRef, expectedFingerprint: object.fingerprint, value,
        } });
        expect(changed.ok, JSON.stringify(changed)).toBe(true);
      };
      if (mode !== 'rename') await patch('first-text', '较早版本对白。');
      if (mode === 'stale') {
        expect((await session.invoke('change.diff', {})).ok).toBe(true);
        await patch('final-text', '最终版本对白。');
      } else {
        const renamed = await session.invoke('character.ensure', { operationId: 'rename', id: 'rin', name: '小凛',
          expectedFingerprint: await hasher.sha256(stableStringify(characters)) });
        expect(renamed.ok, JSON.stringify(renamed)).toBe(true);
        expect((await session.invoke('change.diff', {})).ok).toBe(true);
      }
      for (const operation of ['project.validate', 'project.simulate'] as const) expect((await session.invoke(operation, {})).ok).toBe(true);
      expect((await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.composition.eligibility).toBe('ready');
      const diff = capsule.objectDiff as { freshness: { status: string; workingRevision: number; currentWorkingRevision: number }; semantic: unknown[] };
      expect(diff.freshness.status).toBe(mode === 'stale' ? 'stale' : 'fresh');
      expect(diff.semantic.length).toBeGreaterThan(0);
      const ref = { changeId: capsule.changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 };
      const store = new NodeCompositionStore(path.join(dataRoot, session.projectIdentity), session.projectIdentity);
      const candidate = await store.readCandidate(ref);
      const service = await reviewServiceForProject(projectRoot, dataRoot);
      const other = await openAgentPortSession({ projectRoot, policy: 'stage' });
      let otherRef;
      try {
        expect((await other.invoke('change.begin', {})).ok).toBe(true);
        expect((await other.invoke('variable.ensure', { operationId: 'other', name: 'other', type: 'number', initial: 0 })).ok).toBe(true);
        const sealed = await generateDeliveryCapsule(other);
        otherRef = { changeId: sealed.changeId, capsuleId: sealed.capsuleId, artifactSha256: sealed.artifactIdentity.sha256 };
      } finally { await other.close(); }
      const prepared = await service.prepareComparison({ candidateRefs: [ref, otherRef] });
      if (prepared.projection.reviewVersion !== '2.0.0') throw new Error('v2 required');
      const reviewed = prepared.projection.candidates.find((item) => item.ref.changeId === ref.changeId)!;
      const content = reviewed.verifiedFacts.content;
      expect(reviewed.adoptionPreset.status).toBe('available');
      if (mode === 'stale') {
        expect.soft(content.finalScenes).toEqual([]);
        expect.soft(candidate.semanticDiff).toEqual([]);
        expect.soft(reviewed.verifiedFacts.units.every((unit) => unit.potentialImpact.length === 0 && unit.observedImpact.length === 0)).toBe(true);
        expect(JSON.stringify(content.scenes)).toContain('最终版本对白。');
      } else {
        const unitIds = reviewed.verifiedFacts.units.map((unit) => unit.unitId).sort();
        expect(content.finalScenes).toEqual([{ sceneId: 'start', producerUnitIds: unitIds, source: 'sealed-current-object-diff',
          paragraphs: [`小凛：${mode === 'rename' ? '原始对白。' : '较早版本对白。'}`] }]);
        expect(unitIds).toHaveLength(mode === 'rename' ? 1 : 2);
      }
    } finally {
      await session.close();
    }
  }, 30_000);

  it('keeps the three information sources separate and previews the whole candidate without writing artifacts', async () => {
    const f = await fixture();
    const projection = f.prepared.projection;
    expect(projection.reviewVersion).toBe('2.0.0');
    if (projection.reviewVersion !== '2.0.0') throw new Error('v2 required');
    expect(projection.defaultSelectedUnitIds).toEqual([]);
    expect(JSON.stringify(projection.creativeBrief)).toContain('原始创作要求');
    expect(JSON.stringify(projection.creativeBrief)).not.toContain('候选 a 自述');
    for (const candidate of projection.candidates) {
      const index = f.refs.findIndex((ref) => ref.changeId === candidate.ref.changeId);
      const name = index === 0 ? 'a' : 'b';
      expect(candidate.claims.statement).toBe(`候选 ${name} 自述`);
      expect(candidate.adoptionPreset.status, JSON.stringify(candidate.adoptionPreset)).toBe('available');
      expect(candidate.verifiedFacts.units).toHaveLength(3);
      expect(candidate.verifiedFacts.content.finalScenes).toHaveLength(2);
      expect(JSON.stringify(candidate.verifiedFacts.content.finalScenes)).toContain(`方案 ${name} 的对白。`);
      expect(JSON.stringify(candidate.verifiedFacts.content.finalScenes)).not.toContain('原始对白。');
      expect(JSON.stringify(candidate.verifiedFacts.runtime)).toContain(f.sealedTraceIds[index]![0]);
      expect(JSON.stringify(candidate.verifiedFacts.runtime)).not.toContain(`${name} 独有结尾。`);
    }
    // The launcher-bound directory remains authoritative even when another process has a different default.
    process.env['SURDET_AGENT_DATA_DIR'] = path.join(f.root, 'unrelated-data');
    const before = tree(f.root);
    const preview = await f.authority.previewDecision({ ...f.command, decisionIntent: f.decisionIntent });
    expect(tree(f.root)).toEqual(before);
    expect(preview.status).toBe('ready');
    expect(preview.selectedUnitIds).toEqual(projection.candidates[0]!.adoptionPreset.selectedUnitIds);
    expect(preview.effectiveUnitIds).toEqual(preview.selectedUnitIds);
    expect(preview.implicitInclusions).toEqual([]);
    expect(preview.excludedUnitIds).toHaveLength(3);
    const receipt = await receiptFor(f, preview);
    const saved = await f.authority.write({ protocolVersion: '1.0.0', requestId: 'save_whole', ...f.command, action: 'comparison-decision', receipt });
    expect(saved.state).toBe('decision-written');
    expect(await f.authority.describe(f.command)).toEqual(saved);
    const decision = await f.service.inspectDecision({ reviewId: f.prepared.reviewId });
    const composition = await compositionServiceForProject(f.projectRoot, f.dataRoot);
    const beforePlan = tree(f.root);
    await expect(composition.plan({ candidateRefs: receipt.candidateRefs, comparisonFingerprint: receipt.comparisonFingerprint,
      selectedUnitIds: decision.selectedUnitIds, conflictResolutions: decision.conflictResolutions, review: decision.review,
      expectedPlanContentFingerprint: '0'.repeat(64),
    })).rejects.toMatchObject({ code: 'REVIEW_DECISION_STALE' });
    expect(tree(f.root)).toEqual(beforePlan);
    const planned = await composition.plan({ candidateRefs: receipt.candidateRefs, comparisonFingerprint: receipt.comparisonFingerprint,
      selectedUnitIds: decision.selectedUnitIds, conflictResolutions: decision.conflictResolutions, review: decision.review,
      expectedPlanContentFingerprint: receipt.planContentFingerprint,
    });
    expect(await integrationPlanContentFingerprintOf(planned.plan, planned.plan.dryRun, hasher)).toBe(preview.planContentFingerprint);
    expect(planned.plan.review).toEqual(decision.review);
    process.env['SURDET_AGENT_DATA_DIR'] = f.dataRoot;
    const projectBefore = tree(f.projectRoot);
    const executed = await composition.executePlan({ planId: planned.plan.planId, artifactSha256: planned.identity.sha256, executeOperationId: 'execute_whole' });
    const integrationSession = await openAgentPortSession({ projectRoot: f.projectRoot, policy: 'stage', resumeChangeId: executed.changeId });
    try {
      for (const operation of ['change.diff', 'project.validate', 'project.simulate'] as const) {
        expect((await integrationSession.invoke(operation, {})).ok).toBe(true);
      }
      expect((await integrationSession.invoke('runtime.run-from', { sceneId: 'start', choices: [] })).ok).toBe(true);
    } finally {
      await integrationSession.close();
    }
    const result = await f.service.prepareResult({ planId: planned.plan.planId, artifactSha256: planned.identity.sha256, changeId: executed.changeId });
    expect(result.projection.reviewVersion).toBe('2.0.0');
    const final = result.projection.finalResult!;
    expect(final.actualExplanation!.decisionIntent).toEqual(receipt.decisionIntent);
    expect(final.actualExplanation!.actualIncluded).toHaveLength(3);
    expect(final.actualExplanation!.actualExcluded.some((fact) => fact.kind === 'excluded-candidate')).toBe(true);
    const excludedUnits = final.actualExplanation!.actualExcluded.filter((fact) => fact.kind === 'excluded-unit');
    expect(excludedUnits.map((fact) => fact.unitId).sort()).toEqual([...preview.excludedUnitIds].sort());
    expect(excludedUnits.every((fact) => typeof fact.objectRef === 'string')).toBe(true);
    expect(final.actualExplanation!.actualRuntimeOutcomes.map((trace) => trace.traceId)).toEqual(final.evidence.runtimeTraceIds);
    expect(tree(f.projectRoot)).toEqual(projectBefore);
    const originalIndex = f.refs.findIndex((ref) => ref.changeId === f.decisionIntent.candidate.ref.changeId);
    const chosenName = originalIndex === 0 ? 'a' : 'b';
    expect(fs.readFileSync(path.join(result.projectDirectory!, 'content/scenario/start.gal'), 'utf8')).toContain(`方案 ${chosenName} 的对白。`);
    expect(fs.existsSync(path.join(result.projectDirectory!, `content/scenario/ending_${chosenName}.gal`))).toBe(true);
    expect(fs.existsSync(path.join(result.projectDirectory!, `content/scenario/ending_${chosenName === 'a' ? 'b' : 'a'}.gal`))).toBe(false);
    const approval: FinalApprovalReceipt = {
      receiptVersion: '1.0.0', approvalId: 'approve_whole', resultReviewId: result.reviewId,
      decisionFingerprint: receipt.decisionFingerprint, planId: final.planId, planFingerprint: final.planFingerprint,
      integrationChangeId: final.integrationChangeId, workingRevision: final.workingRevision,
      projectIdentity: result.projection.projectIdentity, expectedProjectRevision: result.projection.expectedProjectRevision,
      diffFingerprint: final.diffFingerprint, evidence: final.evidence, resultTreeSha256: final.resultTreeSha256,
      reviewerChannel: 'surdet-editor-local', approvedAt: '2026-09-11T00:00:00Z', approvalFingerprint: '',
    };
    approval.approvalFingerprint = await approvalFingerprintOf(approval, hasher);
    const current = { ...approval, projectRevision: approval.expectedProjectRevision };
    await expect(validateFinalApproval({ projection: result.projection, receipt: approval, current }, hasher)).resolves.toBeDefined();
    const tampered = structuredClone(result.projection);
    tampered.finalResult!.actualExplanation!.actualIncluded[0]!.label = '伪造实际结果';
    await expect(validateFinalApproval({ projection: tampered, receipt: approval, current }, hasher))
      .rejects.toMatchObject({ code: 'REVIEW_APPROVAL_STALE' });
  }, 30_000);

  it('rejects stale project state and a forged preview at the create-only save boundary', async () => {
    const f = await fixture();
    const preview = await f.authority.previewDecision({ ...f.command, decisionIntent: f.decisionIntent });
    const receipt = await receiptFor(f, preview);
    const forged = { ...receipt, planContentFingerprint: '0'.repeat(64) };
    forged.decisionFingerprint = await decisionFingerprintV2Of(forged, hasher);
    await expect(f.authority.write({ protocolVersion: '1.0.0', requestId: 'save_whole', ...f.command, action: 'comparison-decision', receipt: forged }))
      .rejects.toMatchObject({ code: 'REVIEW_DECISION_INVALID' });
    expect((await f.authority.describe(f.command)).state).toBe('open');
    fs.appendFileSync(path.join(f.projectRoot, 'content/scenario/start.gal'), '\n');
    await expect(f.authority.write({ protocolVersion: '1.0.0', requestId: 'save_whole', ...f.command, action: 'comparison-decision', receipt }))
      .rejects.toMatchObject({ code: 'REVIEW_DECISION_STALE' });
    expect((await f.authority.describe(f.command)).state).toBe('open');
  }, 30_000);
});
