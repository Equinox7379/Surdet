import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as runner from '../e2e/human-agent-review-wave-6.e2e.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.resolve(testDirectory, '../e2e/human-agent-review-wave-6.e2e.mjs');
const repoRoot = path.resolve(testDirectory, '../../..');
const editorMainPath = path.resolve(repoRoot, 'packages/editor/src/main.ts');
const reviewPanelPath = path.resolve(repoRoot, 'packages/editor/src/panels/review-panel.ts');

const betaSceneUnitId = '3cdfaaf8fb80c62b71f352383cb0c4be';
const betaTimelineUnitId = '50b2068292500c43265de06ab1c775a1';
const excludedSceneUnitId = 'ea9b7d9e3c05029fbd6c5bd4df935103';

function rawIntegrationPlanFixture() {
  return {
    planId: 'pln_efa7b25196ee3fdbf74474a0bfe6f14c',
    review: { reviewState: 'human-reviewed' },
    selectedUnitIds: [betaSceneUnitId],
    implicitInclusions: [betaTimelineUnitId],
    excludedUnitIds: [excludedSceneUnitId],
    replayOperations: [
      { sourceUnitId: betaTimelineUnitId, capabilityId: 'timeline.create' },
      { sourceUnitId: betaSceneUnitId, capabilityId: 'scene.create' },
    ],
    dryRun: {
      status: 'passed',
      finalObjectFingerprints: { 'scene:wave5_beta': 'f'.repeat(64) },
      errors: [],
    },
    provenance: [{ sourceUnitId: betaSceneUnitId }],
  };
}

function rawReviewedPreviewEvidenceFixture() {
  const traceId = 'preview-trace-alpha';
  const sceneId = 'wave5_alpha';
  return {
    sceneId,
    traceId,
    rendererStatus: 'awaiting',
    finalProjection: {
      dialogue: {
        projectionVersion: 4,
        dialogText: 'Alpha route A.',
        activeSpeakerId: 'lynn',
        speakerText: '「凛」',
        panelVisible: true,
      },
    },
    canvasBox: { x: 0, y: 0, width: 1280, height: 720 },
    domEvidence: {
      host: { count: 1, visible: true },
      iframe: { count: 1, visible: true, containedInHost: true },
      tracePanel: { count: 1, visible: true, containedInHost: true },
    },
    traceStart: { type: 'surdet-preview-trace-start', traceId, generation: 1, sceneId },
    textEvent: {
      traceId,
      eventKind: 'instruction',
      sourceOp: 'text',
      sourceSceneId: sceneId,
      coreEmitted: true,
      presentationApplied: true,
      attribution: 'sync-batch-correlation-not-event-exclusive',
      projectionBefore: {
        dialogue: {
          projectionVersion: 1,
          dialogText: '',
          activeSpeakerId: null,
          speakerText: '',
          panelVisible: false,
        },
      },
      projectionAfter: {
        dialogue: {
          projectionVersion: 2,
          dialogText: '',
          activeSpeakerId: 'lynn',
          speakerText: '「凛」',
          panelVisible: true,
        },
      },
    },
  };
}

test('Wave 6 runner exposes the fixed four-mode and budget contract', () => {
  assert.deepEqual(runner.MODES, ['preflight', 'diagnostic', 'formal', 'acceptance-prep']);
  assert.equal(runner.DIAGNOSTIC_BUDGET, 3);
  assert.equal(runner.FORMAL_RUN_BUDGET, 1);
});

test('reviewed composition plan request matches the strict reviewed MCP input schema', () => {
  assert.equal(typeof runner.buildReviewedPlanRequest, 'function');
  const candidateRefs = [
    { changeId: 'change-a', capsuleId: 'capsule-a', artifactSha256: 'a'.repeat(64) },
    { changeId: 'change-b', capsuleId: 'capsule-b', artifactSha256: 'b'.repeat(64) },
  ];
  const request = runner.buildReviewedPlanRequest({
    candidateRefs,
    comparisonFingerprint: 'c'.repeat(64),
    reviewDecision: {
      reviewId: 'review-1',
      decisionId: 'decision-1',
      decisionFingerprint: 'd'.repeat(64),
      actor: 'human',
      receipt: { forbidden: true },
    },
    reason: 'must not cross into the reviewed variant',
    selectedUnitIds: ['unit-a'],
    conflictResolutions: [],
    actor: 'human',
    receipt: { forbidden: true },
    replayOperations: [],
  });

  assert.deepEqual(Object.keys(request).sort(), [
    'candidateRefs',
    'comparisonFingerprint',
    'reviewDecision',
  ]);
  assert.deepEqual(request.reviewDecision, {
    reviewId: 'review-1',
    decisionId: 'decision-1',
    decisionFingerprint: 'd'.repeat(64),
  });
  const serialized = JSON.stringify(request);
  for (const forbidden of [
    'reason', 'selectedUnitIds', 'conflictResolutions', 'actor', 'receipt', 'replayOperations',
  ]) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, forbidden);
  }
});

test('reviewed composition plan call site uses the strict request builder without direct-only fields', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  const reviewedStart = source.indexOf("milestone('reviewed-plan-sealed'");
  const reviewedEnd = source.indexOf("milestone('integration-stage-ready'", reviewedStart);
  assert(reviewedStart >= 0 && reviewedEnd > reviewedStart, 'reviewed plan milestone source was not found');
  const reviewedFlow = source.slice(reviewedStart, reviewedEnd);
  assert.match(reviewedFlow, /buildReviewedPlanRequest/);
  assert.doesNotMatch(reviewedFlow, /\breason\s*:/);
});

test('callTool preserves bounded MCP SDK error evidence when structuredContent is missing', async () => {
  assert.equal(typeof runner.callTool, 'function');
  const validationPrefix = "Input validation error: additional property 'reason' is not allowed";
  const response = {
    isError: true,
    content: [
      { type: 'text', text: `${validationPrefix} ${'x'.repeat(5000)} SHOULD_NOT_LEAK_TAIL` },
      { type: 'image', mimeType: 'image/png', data: 'SECRET_IMAGE_BYTES'.repeat(500) },
    ],
  };
  const port = { client: { callTool: async () => response } };

  await assert.rejects(
    () => runner.callTool(port, 'surdet_composition_plan', { reason: 'invalid' }),
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /tool=surdet_composition_plan/);
      assert.match(message, /response\.isError=true/);
      assert.match(message, /structuredContentPresent=false/);
      assert.match(message, /response\.content=/);
      assert.match(message, /Input validation error/);
      assert.match(message, /\[truncated\]/);
      assert.doesNotMatch(message, /SHOULD_NOT_LEAK_TAIL|SECRET_IMAGE_BYTES/);
      assert(message.length <= 2400, `MCP error evidence exceeded the bounded limit: ${message.length}`);
      return true;
    },
  );

  for (const envelope of [
    { ok: true, result: { value: 1 } },
    { ok: false, error: { code: 'REVIEW_DECISION_INVALID', message: 'business failure' } },
  ]) {
    const envelopePort = { client: { callTool: async () => ({ isError: !envelope.ok, content: [], structuredContent: envelope }) } };
    assert.strictEqual(await runner.callTool(envelopePort, 'surdet_composition_plan', {}), envelope);
  }

  const untouchedEnvelope = { ok: true, result: { value: 2 } };
  const untouchedResponse = { structuredContent: untouchedEnvelope };
  Object.defineProperty(untouchedResponse, 'content', {
    get() {
      throw new Error('valid envelopes must not read failure evidence');
    },
  });
  const untouchedPort = { client: { callTool: async () => untouchedResponse } };
  assert.strictEqual(await runner.callTool(untouchedPort, 'surdet_composition_plan', {}), untouchedEnvelope);
});

test('reviewed plan closure uses the canonical selected, implicit and replay projections', () => {
  const plan = rawIntegrationPlanFixture();
  assert.equal(Object.hasOwn(plan, 'includedUnitIds'), false);
  assert.throws(() => plan.includedUnitIds.includes(betaSceneUnitId), TypeError);
  assert(plan.selectedUnitIds.includes(betaSceneUnitId));
  assert(!plan.selectedUnitIds.includes(betaTimelineUnitId));
  assert(plan.implicitInclusions.includes(betaTimelineUnitId));
  const canonicalClosure = new Set([...plan.selectedUnitIds, ...plan.implicitInclusions]);
  assert(canonicalClosure.has(betaSceneUnitId));
  assert(canonicalClosure.has(betaTimelineUnitId));
  const timelineReplayIndex = plan.replayOperations.findIndex((operation) => operation.sourceUnitId === betaTimelineUnitId);
  const sceneReplayIndex = plan.replayOperations.findIndex((operation) => operation.sourceUnitId === betaSceneUnitId);
  assert(timelineReplayIndex >= 0 && sceneReplayIndex >= 0 && timelineReplayIndex < sceneReplayIndex);

  const source = fs.readFileSync(runnerPath, 'utf8');
  const reviewedStart = source.indexOf("milestone('reviewed-plan-sealed'");
  const reviewedEnd = source.indexOf("milestone('integration-stage-ready'", reviewedStart);
  assert(reviewedStart >= 0 && reviewedEnd > reviewedStart, 'reviewed plan milestone source was not found');
  const reviewedFlow = source.slice(reviewedStart, reviewedEnd);
  assert.doesNotMatch(reviewedFlow, /inspectedPlan\.includedUnitIds/);
  assert.match(reviewedFlow, /Array\.isArray\(inspectedPlan\.selectedUnitIds\)/);
  assert.match(reviewedFlow, /Array\.isArray\(inspectedPlan\.implicitInclusions\)/);
  assert.match(reviewedFlow, /Array\.isArray\(inspectedPlan\.replayOperations\)/);
  assert.match(reviewedFlow, /timelineReplayIndex/);
  assert.match(reviewedFlow, /sceneReplayIndex/);
});

test('reviewed plan fingerprints are read from the strict dryRun projection', () => {
  const plan = rawIntegrationPlanFixture();
  assert.equal(Object.hasOwn(plan, 'finalObjectFingerprints'), false);
  assert.equal(plan.dryRun.status, 'passed');
  assert(Object.keys(plan.dryRun.finalObjectFingerprints).length > 0);

  const source = fs.readFileSync(runnerPath, 'utf8');
  const fingerprintStart = source.indexOf("milestone('all-product-fingerprints-read-back'");
  const fingerprintEnd = source.indexOf("milestone('fresh-diff-validation-simulation-runtime'", fingerprintStart);
  assert(fingerprintStart >= 0 && fingerprintEnd > fingerprintStart, 'fingerprint milestone source was not found');
  const fingerprintFlow = source.slice(fingerprintStart, fingerprintEnd);
  assert.doesNotMatch(fingerprintFlow, /inspectedPlan\.finalObjectFingerprints/);
  assert.match(fingerprintFlow, /inspectedPlan\.dryRun\.finalObjectFingerprints/);
});

test('prepare-result consumes the direct resultOf projection without a second unwrap', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  const resultOfSource = source.match(/function resultOf\(envelope, label\) \{[\s\S]*?\n\}/)?.[0];
  assert(resultOfSource, 'runner resultOf implementation was not found');
  const unwrap = Function('assert', `"use strict"; ${resultOfSource}; return resultOf;`)(assert);
  const review = {
    reviewId: 'review_result_fixture',
    projection: { finalResult: { resultTreeSha256: 'a'.repeat(64) } },
    identity: { kind: 'integration-result' },
    projectDirectory: 'result/project',
  };
  const prepared = unwrap({ ok: true, result: review }, 'review.prepare-result fixture');
  assert.strictEqual(prepared, review);
  assert.equal(Object.hasOwn(prepared, 'result'), false);

  const preparedStart = source.indexOf("milestone('result-review-prepared'");
  const preparedEnd = source.indexOf("milestone('approval-required-error'", preparedStart);
  assert(preparedStart >= 0 && preparedEnd > preparedStart, 'prepare-result milestone source was not found');
  const preparedFlow = source.slice(preparedStart, preparedEnd);
  assert.doesNotMatch(preparedFlow, /resultReview\s*=\s*prepared\.result/);
  assert.match(preparedFlow, /resultReview\s*=\s*prepared\s*;/);
});

test('Wave 6 runner locates a safe group by group identity and resolves logical fixture sources dynamically', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.match(source, /data-safe-group/);
  assert.match(source, /candidateIds/);
  assert.match(source, /displayOrdinal/);
  assert.doesNotMatch(source, /getByText\(['"]2 个方案得到相同结果['"],\s*\{\s*exact:\s*true\s*\}\)/);

  const fixtureCandidates = {
    A: { changeId: 'change-fixture-a', capsuleId: 'capsule-fixture-a', artifactSha256: 'a'.repeat(64) },
    D: { changeId: 'change-fixture-d', capsuleId: 'capsule-fixture-d', artifactSha256: 'd'.repeat(64) },
  };
  const projection = {
    candidates: [
      { candidateId: 'candidate-for-fixture-d', ref: fixtureCandidates.D, displayOrdinal: 'A' },
      { candidateId: 'candidate-for-fixture-a', ref: fixtureCandidates.A, displayOrdinal: 'C' },
    ],
    safeGroups: [{
      groupId: 'safe-scene-alpha',
      primaryObject: 'scene:wave5_alpha',
      candidateIds: ['candidate-for-fixture-a', 'candidate-for-fixture-d'],
    }],
  };
  const resolved = runner.resolveSafeGroupFixtureSources(
    projection,
    fixtureCandidates,
    ['A', 'D'],
    'scene:wave5_alpha',
  );
  assert.equal(resolved.safeGroup.groupId, 'safe-scene-alpha');
  assert.deepEqual(resolved.sources.map(({ fixtureLabel, candidateId, displayOrdinal }) => ({ fixtureLabel, candidateId, displayOrdinal })), [
    { fixtureLabel: 'A', candidateId: 'candidate-for-fixture-a', displayOrdinal: 'C' },
    { fixtureLabel: 'D', candidateId: 'candidate-for-fixture-d', displayOrdinal: 'A' },
  ]);
});

test('Wave 6 runner proves canvas dialogue through one strict semantic projection and preview trace predicate', () => {
  assert.equal(typeof runner.isReviewedPreviewEvidenceSatisfied, 'function');
  const rawEvidence = rawReviewedPreviewEvidenceFixture();
  for (const projection of [
    rawEvidence.textEvent.projectionBefore,
    rawEvidence.textEvent.projectionAfter,
    rawEvidence.finalProjection,
  ]) {
    assert.equal(Object.hasOwn(projection, 'projectionVersion'), false);
  }
  assert.equal(runner.isReviewedPreviewEvidenceSatisfied(rawEvidence), true);
  assert.equal(typeof runner.buildReviewedPreviewEvidence, 'function');
  const validEvidence = runner.buildReviewedPreviewEvidence(rawEvidence);
  assert.deepEqual(validEvidence.projectionVersions, { before: 1, after: 2, final: 4 });

  const partialAfterEvidence = structuredClone(rawEvidence);
  partialAfterEvidence.textEvent.projectionAfter.dialogue.dialogText = 'Alpha route';
  assert.equal(runner.isReviewedPreviewEvidenceSatisfied(partialAfterEvidence), true);

  const rejectedEvidence = [
    ['non-increasing projection versions', (value) => {
      value.textEvent.projectionAfter.dialogue.projectionVersion = 1;
    }],
    ['final projection version not newer', (value) => {
      value.finalProjection.dialogue.projectionVersion = 2;
    }],
    ['missing before projection version', (value) => { delete value.textEvent.projectionBefore.dialogue.projectionVersion; }],
    ['non-integer after projection version', (value) => { value.textEvent.projectionAfter.dialogue.projectionVersion = 2.5; }],
    ['non-number final projection version', (value) => { value.finalProjection.dialogue.projectionVersion = '4'; }],
    ['wrong final dialogue text', (value) => { value.finalProjection.dialogue.dialogText = 'Alpha route C.'; }],
    ['wrong final active speaker', (value) => { value.finalProjection.dialogue.activeSpeakerId = 'other'; }],
    ['wrong final localized speaker text', (value) => { value.finalProjection.dialogue.speakerText = '「lynn」'; }],
    ['hidden final panel', (value) => { value.finalProjection.dialogue.panelVisible = false; }],
    ['final renderer is not awaiting', (value) => { value.rendererStatus = 'running'; }],
    ['dirty before projection', (value) => { value.textEvent.projectionBefore.dialogue.activeSpeakerId = 'lynn'; }],
    ['wrong after active speaker', (value) => { value.textEvent.projectionAfter.dialogue.activeSpeakerId = 'other'; }],
    ['wrong after localized speaker text', (value) => { value.textEvent.projectionAfter.dialogue.speakerText = '「lynn」'; }],
    ['hidden after panel', (value) => { value.textEvent.projectionAfter.dialogue.panelVisible = false; }],
    ['after text is not an A prefix', (value) => { value.textEvent.projectionAfter.dialogue.dialogText = 'Alpha route C.'; }],
    ['wrong trace', (value) => { value.textEvent.traceId = 'preview-trace-other'; }],
    ['wrong scene', (value) => { value.textEvent.sourceSceneId = 'wave5_other'; }],
    ['wrong trace start identity', (value) => { value.traceStart.traceId = 'preview-trace-other'; }],
    ['wrong trace start scene', (value) => { value.traceStart.sceneId = 'wave5_other'; }],
    ['invalid canvas', (value) => { value.canvasBox.width = 0; }],
    ['wrong Core event kind', (value) => { value.textEvent.eventKind = 'text'; }],
    ['wrong Core operation', (value) => { value.textEvent.sourceOp = 'instr'; }],
    ['Core not emitted', (value) => { value.textEvent.coreEmitted = false; }],
    ['presentation not applied', (value) => { value.textEvent.presentationApplied = false; }],
    ['exclusive causation attribution', (value) => { value.textEvent.attribution = 'event-exclusive'; }],
    ['review host absent', (value) => { value.domEvidence.host.count = 0; }],
    ['review host non-unique', (value) => { value.domEvidence.host.count = 2; }],
    ['review host hidden', (value) => { value.domEvidence.host.visible = false; }],
    ['preview iframe absent', (value) => { value.domEvidence.iframe.count = 0; }],
    ['preview iframe non-unique', (value) => { value.domEvidence.iframe.count = 2; }],
    ['preview iframe hidden', (value) => { value.domEvidence.iframe.visible = false; }],
    ['preview iframe outside host', (value) => { value.domEvidence.iframe.containedInHost = false; }],
    ['trace panel absent', (value) => { value.domEvidence.tracePanel.count = 0; }],
    ['trace panel non-unique', (value) => { value.domEvidence.tracePanel.count = 2; }],
    ['trace panel hidden', (value) => { value.domEvidence.tracePanel.visible = false; }],
    ['trace panel outside host', (value) => { value.domEvidence.tracePanel.containedInHost = false; }],
  ];
  for (const [label, mutate] of rejectedEvidence) {
    const evidence = structuredClone(rawEvidence);
    mutate(evidence);
    assert.equal(runner.isReviewedPreviewEvidenceSatisfied(evidence), false, label);
  }

  const source = fs.readFileSync(runnerPath, 'utf8');
  const resultStart = source.indexOf('async function runEditorResult');
  const resultEnd = source.indexOf('async function runWorkflow', resultStart);
  assert(resultStart >= 0 && resultEnd > resultStart, 'result preview workflow source was not found');
  const resultFlow = source.slice(resultStart, resultEnd);

  assert.doesNotMatch(source, /count\(\)\s*>=\s*0/);
  assert.doesNotMatch(resultFlow, /frameBody\.(?:filter|innerText)\s*\(/);
  assert.doesNotMatch(resultFlow, /hasText\s*:\s*['"]Alpha route [AC]\.['"]/);
  assert.doesNotMatch(resultFlow, /\bframeText\b/);
  assert.doesNotMatch(resultFlow, /timeout\s*:\s*7000/);

  assert.match(resultFlow, /installPreviewMessageCollector\(page\)/);
  for (const messageType of [
    'surdet-preview-trace-start',
    'surdet-preview-trace-event',
    'surdet-preview-trace-complete',
  ]) {
    assert.match(source, new RegExp(messageType));
  }
  assert.match(resultFlow, /surdetPreviewDebug[\s\S]{0,240}projectionSnapshot\?\.\(\)/);
  assert.match(resultFlow, /rendererStatus\s*===\s*['"]awaiting['"]/);
  assert.match(resultFlow, /dialogText\s*===\s*['"]Alpha route A\.['"]/);
  assert.match(resultFlow, /activeSpeakerId\s*===\s*['"]lynn['"]/);
  assert.match(resultFlow, /speakerText\s*===\s*['"]「凛」['"]/);
  assert.match(resultFlow, /panelVisible\s*===\s*true/);
  assert.match(resultFlow, /dialogText\s*!==\s*['"]Alpha route C\.['"]/);
  assert.match(resultFlow, /canvasBox\.width\s*>\s*0/);
  assert.match(resultFlow, /canvasBox\.height\s*>\s*0/);
  assert.match(resultFlow, /event\?\.kind\s*===\s*['"]instruction['"]/);
  assert.match(resultFlow, /event\.source\?\.op\s*===\s*['"]text['"]/);
  assert.match(resultFlow, /source\?\.sceneId\s*===\s*alphaScene/);
  assert.match(resultFlow, /coreEmitted\s*===\s*true/);
  assert.match(resultFlow, /presentationApplied\s*===\s*true/);
  assert.match(resultFlow, /buildReviewedPreviewEvidence\(\{/);
  assert.doesNotMatch(resultFlow, /projectionVersions\s*:/);
  assert.doesNotMatch(resultFlow, /projection\?\.projectionVersion/);
  assert.match(resultFlow, /isReviewedPreviewEvidenceSatisfied\(previewEvidence\)/);
  for (const field of [
    'sceneId', 'traceId', 'rendererStatus', 'finalProjection', 'canvasBox', 'domEvidence', 'traceStart', 'textEvent',
    'projectionBefore', 'projectionAfter', 'attribution',
  ]) {
    assert.match(resultFlow, new RegExp(`\\b${field}\\b`));
  }

  for (const diagnosticField of [
    'iframeUrl', 'previewError', 'debugExists', 'debugKeys', 'rendererStatus',
    'projectionSnapshot', 'canvasBox', 'previewTraceMessages',
  ]) {
    assert.match(source, new RegExp(`\\b${diagnosticField}\\b`));
  }

  const milestoneStart = source.indexOf("milestone('editor-result-rendered'");
  const milestoneEnd = source.indexOf("milestone('exploration-invalidates-approval'", milestoneStart);
  const milestoneFlow = source.slice(milestoneStart, milestoneEnd);
  assert.match(milestoneFlow, /previewEvidence/);
  assert.doesNotMatch(milestoneFlow, /frameText/);
});

test('Wave 6 runner rejects forged top-level projection versions without nested dialogue versions', () => {
  const forgedEvidence = rawReviewedPreviewEvidenceFixture();
  const projections = [
    [forgedEvidence.textEvent.projectionBefore, 1],
    [forgedEvidence.textEvent.projectionAfter, 2],
    [forgedEvidence.finalProjection, 4],
  ];
  for (const [projection, version] of projections) {
    delete projection.dialogue.projectionVersion;
    projection.projectionVersion = version;
  }
  forgedEvidence.projectionVersions = { before: 1, after: 2, final: 4 };
  assert.equal(runner.isReviewedPreviewEvidenceSatisfied(forgedEvidence), false);
});

test('Wave 6 runner mounts result preview evidence inside the unique visible review host', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  const resultStart = source.indexOf('async function runEditorResult');
  const resultEnd = source.indexOf('async function runWorkflow', resultStart);
  assert(resultStart >= 0 && resultEnd > resultStart, 'result preview workflow source was not found');
  const resultFlow = source.slice(resultStart, resultEnd);

  assert.doesNotMatch(resultFlow, /#review-preview-host\s+#preview-view/);
  assert.match(resultFlow, /page\.locator\(['"]#review-preview-host['"]\)/);
  assert.match(resultFlow, /reviewPreviewHost\.count\(\)\s*===\s*1/);
  assert.match(resultFlow, /reviewPreviewHost\.waitFor\(\{\s*state:\s*['"]visible['"]/);
  assert.match(resultFlow, /reviewPreviewHost\.locator\(['"]iframe\.preview-frame\[title=[\\'"]剧情预览[\\'"]\]['"]\)/);
  assert.match(resultFlow, /previewFrameLocator\.count\(\)\s*===\s*1/);
  assert.match(resultFlow, /previewFrameLocator\.waitFor\(\{\s*state:\s*['"]visible['"]/);
  assert.match(resultFlow, /reviewPreviewHost\.locator\(['"]\.preview-trace['"]\)/);
  assert.match(resultFlow, /tracePanel\.count\(\)\s*===\s*1/);
  assert.match(resultFlow, /tracePanel\.waitFor\(\{\s*state:\s*['"]visible['"]/);
});

test('Wave 6 runner fails when the chosen unit is not rendered instead of clicking the first option', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.match(source, /targetIndex\s*=\s*-1/);
  assert.match(source, /chosenUnitId.*not rendered|did not render.*chosenUnitId/i);
});

test('Wave 6 runner mutates the reviewed result project and proves its tree identity changed', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.match(source, /result\/project\/content\/scenario\/exploration\.gal/);
  assert.match(source, /exploration.*tree|tree.*exploration/i);

  const file = (pathName, contents) => ({ path: pathName, bytes: Buffer.from(contents, 'utf8').toString('base64') });
  const before = [file('result/project/content/scenario/alpha.gal', 'Alpha route A.')];
  const misplaced = [...before, file('content/scenario/exploration.gal', 'outside reviewed project')];
  const insideReviewedProject = [...before, file('result/project/content/scenario/exploration.gal', 'inside reviewed project')];
  const beforeIdentity = runner.browserFileMapTreeIdentity(before, 'result/project');
  assert.equal(runner.browserFileMapTreeIdentity(misplaced, 'result/project').sha256, beforeIdentity.sha256);
  assert.notEqual(runner.browserFileMapTreeIdentity(insideReviewedProject, 'result/project').sha256, beforeIdentity.sha256);
});

test('Wave 6 runner treats every non-empty error or cleanup channel as a failed run', () => {
  assert.equal(typeof runner.blockingRunIssues, 'function');
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.match(source, /status:\s*blockingIssueChannels\.length\s*===\s*0\s*\?\s*['"]PASSED['"]\s*:\s*['"]FAILED['"]/);
  assert.match(source, /protocolErrors:\s*harness\.protocolErrors/);
  const empty = {
    errors: [], protocolErrors: [], consoleErrors: [], pageErrors: [], requestFailures: [], stderrLines: [],
    childCleanupFailures: [], activeLeaseDirectories: [],
  };
  assert.deepEqual(runner.blockingRunIssues(empty), []);
  for (const key of Object.keys(empty)) {
    const value = { ...empty, [key]: ['failure'] };
    assert.deepEqual(runner.blockingRunIssues(value), [key], key);
  }
});

test('Wave 6 runner observes both decision save outcomes and preserves failure-side browser evidence', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  const comparisonStart = source.indexOf('async function runEditorComparison');
  const comparisonEnd = source.indexOf('async function runEditorResult');
  assert(comparisonStart >= 0 && comparisonEnd > comparisonStart, 'comparison workflow source was not found');
  const comparisonFlow = source.slice(comparisonStart, comparisonEnd);

  assert.match(comparisonFlow, /Promise\.race\s*\(/);
  assert.match(comparisonFlow, /已保存我的决定/);
  assert.match(comparisonFlow, /保存决定失败：/);
  assert.match(comparisonFlow, /(?:innerText|textContent)\s*\(/);

  assert.match(source, /decisionWriteEvidence/);
  assert.match(source, /fakeRootSnapshot/);
  assert.match(source, /decisionJsonExists/);
  assert.match(source, /decisionJsonState/);
  assert.match(source, /decisionWriteEvidence\s*,/);
});

test('Editor writes the open success status only after the rebuilt DOM exists', () => {
  const mainSource = fs.readFileSync(editorMainPath, 'utf8');
  const panelSource = fs.readFileSync(reviewPanelPath, 'utf8');
  const handlerStart = mainSource.indexOf("const reviewBtn = h('button', undefined, '打开审阅任务')");
  const handlerEnd = mainSource.indexOf('header.appendChild(reviewBtn)', handlerStart);
  const handler = mainSource.slice(handlerStart, handlerEnd);
  assert.match(handler, /await\s+openReviewPanelWorkspace\(\)/);
  assert.ok(handler.indexOf('renderAll()') > handler.indexOf('await openReviewPanelWorkspace()'));
  assert.ok(handler.indexOf("setStatus('已打开审阅任务'") > handler.indexOf('renderAll()'));

  const openStart = panelSource.indexOf('export async function openReviewPanelWorkspace');
  const openEnd = panelSource.indexOf('\n}', openStart);
  const openFlow = panelSource.slice(openStart, openEnd + 2);
  assert.doesNotMatch(openFlow, /setStatus\(/);
});

test('Wave 6 runner waits for a newly rendered persisted receipt and proves exact disk identity and readonly controls', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  const comparisonStart = source.indexOf('async function runEditorComparison');
  const comparisonEnd = source.indexOf('async function runEditorResult');
  const comparisonFlow = source.slice(comparisonStart, comparisonEnd);

  assert.match(comparisonFlow, /waitForNewDecisionReceiptMarker/);
  assert.doesNotMatch(comparisonFlow, /getByText\(['"]已打开审阅任务['"],[\s\S]{0,120}count\(\)/);
  assert.match(source, /data-decision-receipt/);
  assert.match(source, /data-decision-id/);
  assert.match(source, /data-decision-fingerprint/);
  assert.match(source, /receiptMarker\.decisionId\s*===\s*decision\.decisionId/);
  assert.match(source, /receiptMarker\.decisionFingerprint\s*===\s*decision\.decisionFingerprint/);
  assert.match(source, /readonlyControls/);
  assert.match(source, /globalStatus/);
  assert.match(source, /fakeRootReceiptSnapshot/);
});

test('Wave 6 runner proves the persisted result approval after closing and reopening the same workspace', () => {
  assert.equal(typeof runner.isResultReceiptReopenEvidenceSatisfied, 'function');
  const receiptIdentity = { bytes: 1024, sha256: 'a'.repeat(64) };
  const valid = {
    expected: {
      approvalId: 'approval-reopened',
      approvalFingerprint: 'b'.repeat(64),
      decisionId: 'decision-1',
      selectedUnitIds: ['unit-a'],
    },
    diskBefore: receiptIdentity,
    diskAfter: { ...receiptIdentity },
    receiptMarker: {
      present: true,
      kind: 'approval',
      text: `已批准 回执 ID：approval-reopened 回执 fingerprint：${'b'.repeat(64)} 原决定：decision-1 原选择：unit-a`,
      approvalId: 'approval-reopened',
      approvalFingerprint: 'b'.repeat(64),
    },
    readonlyControls: [
      { action: 'approve-result', disabled: true },
      { action: 'return-result', disabled: true },
    ],
    fakeRootReceipts: {
      finalApproval: { approvalId: 'approval-reopened', approvalFingerprint: 'b'.repeat(64) },
      returnRequest: null,
    },
  };
  assert.equal(runner.isResultReceiptReopenEvidenceSatisfied(valid), true);
  for (const mutate of [
    (value) => { value.diskAfter.sha256 = 'c'.repeat(64); },
    (value) => { value.receiptMarker.approvalId = 'approval-other'; },
    (value) => { value.receiptMarker.approvalFingerprint = 'd'.repeat(64); },
    (value) => { value.receiptMarker.text = '已批准'; },
    (value) => { value.readonlyControls[0].disabled = false; },
    (value) => { value.fakeRootReceipts.returnRequest = { returnId: 'return-forbidden' }; },
  ]) {
    const invalid = structuredClone(valid);
    mutate(invalid);
    assert.equal(runner.isResultReceiptReopenEvidenceSatisfied(invalid), false);
  }
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.match(source, /waitForNewResultReceiptMarker/);
  assert.match(source, /isResultReceiptReopenEvidenceSatisfied\(reopenEvidence\)/);
});

test('Wave 6 runner proves the B scene decision, implicit timeline closure and visible dependency explanation', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  const comparisonStart = source.indexOf('async function runEditorComparison');
  const comparisonEnd = source.indexOf('async function runEditorResult');
  assert(comparisonStart >= 0 && comparisonEnd > comparisonStart, 'comparison workflow source was not found');
  const comparisonFlow = source.slice(comparisonStart, comparisonEnd);

  assert.match(comparisonFlow, /page\.(?:getByText|locator)[\s\S]{0,240}依赖自动纳入/);
  assert.match(comparisonFlow, /sceneUnitB\.unitId/);
  assert.match(comparisonFlow, /timelineUnitB\.unitId/);
  assert.match(source, /decision\.selectedUnitIds\.includes\(sceneUnitB\.unitId\)/);
  assert.match(source, /!decision\.selectedUnitIds\.includes\(timelineUnitB\.unitId\)/);
  assert.match(source, /inspectedPlan\.selectedUnitIds\.includes\(sceneUnitB\.unitId\)/);
  assert.match(source, /!inspectedPlan\.selectedUnitIds\.includes\(timelineUnitB\.unitId\)/);
  assert.match(source, /inspectedPlan\.implicitInclusions\.includes\(timelineUnitB\.unitId\)/);
});

test('Wave 6 runner source carries identity, gate and cleanup invariants', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.doesNotMatch(source, /prepared\.dataDir/);
  assert.match(source, /prepared\.evidence\.dataDir/);
  for (const token of [
    /runHead/,
    /runnerSha256/,
    /trackedCodeDiffPaths/,
    /activeLeaseDirectories/,
    /childCleanupFailures/,
    /stageProjectMutated/,
  ]) {
    assert.match(source, token);
  }
  assert.match(source, /clean tracked tree|trackedCodeDiffPaths/);
  assert.match(source, /SURDET_CODE_EVIDENCE_HEAD/);
  assert.match(source, /runHead\s*!==\s*codeEvidenceHead|runHead.*codeEvidenceHead/);
  assert.match(source, /exclusive|['"]wx['"]/i);
  assert.match(source, /browser/i);
  assert.match(source, /vite/i);
  assert.match(source, /mcp/i);
  assert.match(source, /finally/);
});

test('Wave 6 runner rejects an unsupported mode without starting a child workflow', () => {
  const result = spawnSync(process.execPath, [runnerPath, '--mode=unsupported'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(`${result.stdout}\n${result.stderr}`, /unsupported|mode/i);
});
