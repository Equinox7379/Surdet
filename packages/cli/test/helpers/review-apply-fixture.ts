import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  approvalFingerprintOf, decisionFingerprintV2Of,
  type AuthoringObject, type ComparisonDecisionReceiptV2, type FinalApprovalReceipt,
} from '@surdet/authoring';
import { generateDeliveryCapsule } from '../../src/agent-port/delivery-capsule.js';
import { openAgentPortSession } from '../../src/agent-port/session.js';
import { AuthoringService } from '../../src/authoring/authoring-service.js';
import { NodeLocalLeaseManager } from '../../src/authoring/node-local-lease.js';
import { compositionServiceForProject } from '../../src/authoring/composition-service.js';
import { ReviewTerminalAuthority } from '../../src/authoring/review-terminal-authority.js';
import { reviewServiceForProject } from '../../src/authoring/review-service.js';

const hasher = { sha256: async (text: string) => crypto.createHash('sha256').update(text).digest('hex') };

/** Only candidates and comparison; no saved decision, formal plan, integration or result. */
export async function createReviewComparisonFixture(root: string, entryScene = 'start', background?: Uint8Array, branching = false) {
  const projectRoot = path.join(root, '试写项目');
  const dataRoot = path.join(root, 'data');
  await fs.mkdir(path.join(projectRoot, 'content/scenario'), { recursive: true });
  await fs.mkdir(dataRoot, { recursive: true });
  if (background) {
    await fs.mkdir(path.join(projectRoot, 'content/assets/bg'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'content/assets/bg/harbor.png'), background);
  }
  await fs.writeFile(path.join(projectRoot, 'game.config.json'), JSON.stringify({ title: '写回试用', entryScene,
    variables: branching ? { luck: { type: 'number', initial: 0 } } : {} }));
  const branch = '@random luck 0 100\n@label crossroads\n@choice\n  再想一想 -> @goto crossroads\n  继续走 -> @goto confirm\n@label confirm\n@choice\n  返回路口 -> @goto crossroads\n  继续故事 -> @goto finish\n@label finish\n我们走到了故事的出口。\n@clear branch_done\n';
  const initial = `@scene ${entryScene}\n${background ? '@bg harbor\n' : ''}这是试写项目的原始台词。\n${branching ? branch : ''}@end\n`;
  await fs.writeFile(path.join(projectRoot, 'content/scenario', `${entryScene}.gal`), initial);
  // Existing Agent Port fixtures use process-scoped storage. Only fixture creation
  // changes it; the application backend itself always receives an explicit root.
  const oldDataRoot = process.env['SURDET_AGENT_DATA_DIR'];
  process.env['SURDET_AGENT_DATA_DIR'] = dataRoot;
  try {
    const refs = [];
    for (const name of ['a', 'b']) {
      const session = await openAgentPortSession({ projectRoot, policy: 'stage' });
      try {
        const invoke = async (operation: Parameters<typeof session.invoke>[0], input: Record<string, unknown>) => {
          const response = await session.invoke(operation, input);
          if (!response.ok) throw new Error(JSON.stringify(response));
          return response.result;
        };
        await invoke('change.begin', { intent: `试写方案 ${name}` });
        const scene = await invoke('object.inspect', { objectRef: `scene:${entryScene}` }) as AuthoringObject;
        const target = await invoke('object.inspect', { objectRef: scene.childRefs![background ? 2 : 1] }) as AuthoringObject;
        await invoke('scene.patch', { operationId: `text-${name}`, sceneId: entryScene, patch: {
          kind: 'replaceText', target: target.objectRef, expectedFingerprint: target.fingerprint,
          value: name === 'a' ? '窗外的雨停了，我们继续写下一个故事。' : '灯光亮起，新的一页开始了。',
        } });
        await invoke('scene.create', { operationId: `scene-${name}`, sceneId: `ending_${name}`, blocks: [{ kind: 'text', value: '这是一份非正式试写样例。' }] });
        for (const operation of ['change.diff', 'project.validate', 'project.simulate'] as const) await invoke(operation, {});
        await invoke('runtime.run-from', { sceneId: entryScene, choices: branching ? [1, 1] : [] });
        const capsule = await generateDeliveryCapsule(session);
        if (capsule.composition.eligibility !== 'ready') throw new Error('fixture candidate is not ready');
        refs.push({ changeId: capsule.changeId, capsuleId: capsule.capsuleId, artifactSha256: capsule.artifactIdentity.sha256 });
      } finally { await session.close(); }
    }
    const reviews = await reviewServiceForProject(projectRoot, dataRoot);
    const comparison = await reviews.prepareComparison({ candidateRefs: refs, creativeBrief: {
      title: '写回试用', request: '在专用试写项目中体验批准、写回和继续编辑。', acceptanceCriteria: ['保留真实项目与草稿边界'],
    } });
    return { root, projectRoot, dataRoot, initial, refs, reviews, comparison };
  } finally {
    if (oldDataRoot === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
    else process.env['SURDET_AGENT_DATA_DIR'] = oldDataRoot;
  }
}

/** Synthetic receipts through the normal authority, never Owner acceptance. */
export async function createReviewApplyFixture(root: string, approve = true) {
    const { projectRoot, dataRoot, initial, refs, reviews, comparison } = await createReviewComparisonFixture(root);
    const authority = new ReviewTerminalAuthority(dataRoot, undefined, hasher, projectRoot);
    const candidate = comparison.projection.candidates[0]!;
    const command = { projectIdentity: comparison.identity.projectIdentity, reviewId: comparison.reviewId,
      reviewPayload: { bytes: comparison.identity.payload.bytes, sha256: comparison.identity.payload.sha256 } };
    const preview = await authority.previewDecision({ ...command,
      decisionIntent: { mode: 'adopt-candidate', candidate: { candidateId: candidate.candidateId, ref: candidate.ref } } });
    const decision: ComparisonDecisionReceiptV2 = {
      receiptVersion: '2.0.0', decisionId: 'synthetic-decision', reviewId: comparison.reviewId,
      reviewFingerprint: comparison.projection.reviewFingerprint,
      comparisonFingerprint: comparison.projection.sourceIdentity.comparisonFingerprint,
      projectIdentity: comparison.identity.projectIdentity, expectedProjectRevision: comparison.identity.expectedProjectRevision,
      candidateRefs: refs, decisionIntent: preview.decisionIntent, selectedUnitIds: preview.selectedUnitIds,
      conflictResolutions: preview.conflictResolutions, planContentFingerprint: preview.planContentFingerprint,
      previewFingerprint: preview.previewFingerprint, reviewerChannel: 'surdet-editor-local',
      decidedAt: new Date().toISOString(), decisionFingerprint: '',
    };
    decision.decisionFingerprint = await decisionFingerprintV2Of(decision, hasher);
    await authority.write({ ...command, protocolVersion: '1.0.0', requestId: 'synthetic-decision', action: 'comparison-decision', receipt: decision });
    const verified = await reviews.inspectDecision({ reviewId: comparison.reviewId });
    const composition = await compositionServiceForProject(projectRoot, dataRoot);
    const planned = await composition.plan({ candidateRefs: refs, comparisonFingerprint: decision.comparisonFingerprint,
      selectedUnitIds: verified.selectedUnitIds, conflictResolutions: verified.conflictResolutions,
      review: verified.review, expectedPlanContentFingerprint: decision.planContentFingerprint });
    const executed = await composition.executePlan({ planId: planned.plan.planId,
      artifactSha256: planned.identity.sha256, executeOperationId: 'execute-fixture' });
    const authoring = new AuthoringService(undefined, new NodeLocalLeaseManager(dataRoot));
    await authoring.diff(executed.changeId);
    await authoring.validate(executed.changeId);
    await authoring.simulate(executed.changeId, {});
    await authoring.runFrom(executed.changeId, { sceneId: 'start', choices: [] });
    const result = await reviews.prepareResult({ planId: planned.plan.planId,
      artifactSha256: planned.identity.sha256, changeId: executed.changeId });
    const final = result.projection.finalResult!;
    const approval: FinalApprovalReceipt = {
      receiptVersion: '1.0.0', approvalId: 'synthetic-approval', resultReviewId: result.reviewId,
      decisionFingerprint: decision.decisionFingerprint, planId: final.planId, planFingerprint: final.planFingerprint,
      integrationChangeId: final.integrationChangeId, workingRevision: final.workingRevision,
      projectIdentity: result.projection.projectIdentity, expectedProjectRevision: result.projection.expectedProjectRevision,
      diffFingerprint: final.diffFingerprint, evidence: final.evidence, resultTreeSha256: final.resultTreeSha256,
      reviewerChannel: 'surdet-editor-local', approvedAt: new Date().toISOString(), approvalFingerprint: '',
    };
    approval.approvalFingerprint = await approvalFingerprintOf(approval, hasher);
    const resultCommand = { projectIdentity: result.identity.projectIdentity, reviewId: result.reviewId,
      reviewPayload: { bytes: result.identity.payload.bytes, sha256: result.identity.payload.sha256 } };
    if (approve) await authority.write({ ...resultCommand, protocolVersion: '1.0.0', requestId: 'synthetic-approval', action: 'result-approval', receipt: approval });
    if (await fs.readFile(path.join(projectRoot, 'content/scenario/start.gal'), 'utf8') !== initial) throw new Error('approval mutated source project');
    return { root, projectRoot, dataRoot, initial, authority, authoring, reviews, result, resultCommand, approval,
      ref: { resultReviewId: approval.resultReviewId, approvalId: approval.approvalId, approvalFingerprint: approval.approvalFingerprint } };
}
