import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as runner from '../e2e/owner-review-comprehensibility-wave-6.e2e.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.resolve(testDirectory, '../e2e/owner-review-comprehensibility-wave-6.e2e.mjs');

const milestoneIds = [
  'launcher-and-baseline',
  'comparison-workspace-created',
  'localized-task-visible',
  'review-ordinal-explained',
  'identical-provenance-visible',
  'conflict-content-distinguishable',
  'technical-details-lazy',
  'decision-saved-exact-unit',
  'decision-reopened-readonly',
  'project-and-starter-unchanged',
  'cleanup-and-identity',
];

function passingEvidence() {
  const decisionIdentity = { bytes: 512, sha256: 'd'.repeat(64) };
  return {
    status: 'PASSED',
    evidenceClass: 'DIAGNOSTIC',
    milestones: milestoneIds.map((id, index) => ({ ordinal: index + 1, id, status: 'PASSED' })),
    localizedTask: { visible: true, title: '候选创作方案审阅' },
    ordinalEvidence: {
      visible: true,
      text: '方案字母只用于本次审阅排序；请根据内容摘要选择，系统会用稳定来源身份保存决定。',
    },
    identicalProvenance: {
      primaryObject: 'scene:wave5_alpha',
      sourceCount: 2,
      fixtureLabels: ['A', 'D'],
      contentVisible: 'Alpha route A.',
    },
    conflictEvidence: {
      aUnitId: 'unit-a',
      cUnitId: 'unit-c',
      aCardText: '选择方案 B · 新建场景 · 场景 wave5_alpha · 段落标记：start\nlynn：Alpha route A.',
      cCardText: '选择方案 C · 新建场景 · 场景 wave5_alpha · 段落标记：start\nlynn：Alpha route C.',
      aButtonText: '选择方案 B · 新建场景 · 场景 wave5_alpha · 段落标记：start',
      cButtonText: '选择方案 C · 新建场景 · 场景 wave5_alpha · 段落标记：start',
      distinguishable: true,
    },
    technicalEvidence: {
      defaultTechnicalIdsVisible: false,
      expandedUnitId: 'unit-a',
      expandedCandidateId: 'candidate-a',
      expandedFinalFingerprint: 'f'.repeat(64),
      expandedCapsuleId: 'capsule-a',
    },
    decisionEvidence: {
      chosenUnitId: 'unit-a',
      selectedUnitIds: ['unit-a', 'unit-b'],
      excludedUnitId: 'unit-c',
      decisionId: 'decision-1',
      decisionFingerprint: 'e'.repeat(64),
      diskBefore: { ...decisionIdentity },
      diskAfter: { ...decisionIdentity },
      receiptMarker: {
        present: true,
        decisionId: 'decision-1',
        decisionFingerprint: 'e'.repeat(64),
        text: '已读取已保存的决定',
      },
      restoredChoiceVisible: true,
      decisionControlsReadonly: true,
      decisionReceiptCount: 1,
    },
    toolsCalled: ['surdet_composition_compare', 'surdet_review_prepare_comparison'],
    prohibitedToolCalls: [],
    projectMutation: { occurred: false },
    originalStarterUnchanged: true,
    projectFixtureUnchanged: true,
    errors: [],
    protocolErrors: [],
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    stderrLines: [],
    childCleanupFailures: [],
    activeLeaseDirectories: [],
  };
}

test('focused runner exposes the fixed modes, budgets and 11-node contract', () => {
  assert.deepEqual(runner.MODES, ['preflight', 'diagnostic', 'formal']);
  assert.equal(runner.DIAGNOSTIC_BUDGET, 2);
  assert.equal(runner.FORMAL_RUN_BUDGET, 1);
  assert.deepEqual(runner.MILESTONE_IDS, milestoneIds);
});

test('focused evidence predicate accepts only the complete human-comprehensibility proof', () => {
  assert.equal(runner.isFocusedEvidenceSatisfied(passingEvidence()), true);

  const mutations = [
    (value) => { value.localizedTask.title = 'Candidate composition review'; },
    (value) => { value.ordinalEvidence.visible = false; },
    (value) => { value.identicalProvenance.fixtureLabels = ['A']; },
    (value) => { value.conflictEvidence.cCardText = value.conflictEvidence.aCardText; },
    (value) => { value.conflictEvidence.aButtonText = ''; },
    (value) => { value.technicalEvidence.defaultTechnicalIdsVisible = true; },
    (value) => { value.decisionEvidence.chosenUnitId = 'unit-d'; },
    (value) => { value.decisionEvidence.diskAfter.sha256 = '0'.repeat(64); },
    (value) => { value.decisionEvidence.decisionControlsReadonly = false; },
    (value) => { value.decisionEvidence.decisionReceiptCount = 2; },
    (value) => { value.projectMutation.occurred = true; },
    (value) => { value.prohibitedToolCalls.push('surdet_composition_execute'); },
    (value) => { value.consoleErrors.push('browser error'); },
    (value) => { value.milestones[4].status = 'FAILED'; },
  ];
  for (const mutate of mutations) {
    const evidence = structuredClone(passingEvidence());
    mutate(evidence);
    assert.equal(runner.isFocusedEvidenceSatisfied(evidence), false);
  }
});

test('blocking issue classification covers every error and cleanup channel', () => {
  const empty = {
    errors: [], protocolErrors: [], consoleErrors: [], pageErrors: [], requestFailures: [],
    stderrLines: [], childCleanupFailures: [], activeLeaseDirectories: [],
  };
  assert.deepEqual(runner.blockingRunIssues(empty), []);
  for (const channel of Object.keys(empty)) {
    const channels = structuredClone(empty);
    channels[channel].push('failure');
    assert.deepEqual(runner.blockingRunIssues(channels), [channel]);
  }
});

test('expanded provenance cards use their concise review-local source label', () => {
  assert.equal(typeof runner.reviewSourceLabel, 'function');
  assert.equal(runner.reviewSourceLabel('A'), '方案 A');
  assert.equal(runner.reviewSourceLabel('D'), '方案 D');
  assert.doesNotMatch(runner.reviewSourceLabel('A'), /本次审阅编号/);
});

test('conflict evidence reads exact-unit cards while nested exact-unit buttons remain actionable controls', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  const start = source.indexOf("await milestone('conflict-content-distinguishable'");
  const end = source.indexOf("await milestone('technical-details-lazy'", start);
  assert.notEqual(start, -1, 'conflict-content-distinguishable milestone missing');
  assert.notEqual(end, -1, 'technical-details-lazy milestone missing after conflict evidence');
  const block = source.slice(start, end);

  assert.match(block, /\[data-choice-option-unit="\$\{sceneUnitA\.unitId\}"\]/);
  assert.match(block, /\[data-choice-option-unit="\$\{sceneUnitC\.unitId\}"\]/);
  assert.match(block, /aCard\.locator\(`\[data-choice-unit="\$\{sceneUnitA\.unitId\}"\]`\)/);
  assert.match(block, /cCard\.locator\(`\[data-choice-unit="\$\{sceneUnitC\.unitId\}"\]`\)/);
  for (const field of ['aCardText', 'cCardText', 'aButtonText', 'cButtonText', 'aUnitId', 'cUnitId']) {
    assert.match(block, new RegExp(`\\b${field}\\b`), `conflict artifact omits ${field}`);
  }
  assert.doesNotMatch(block, /const aText = await aChoice\.innerText\(\)/);
  assert.doesNotMatch(block, /const cText = await cChoice\.innerText\(\)/);
  assert.doesNotMatch(block, /displayOrdinal|\.nth\(/);
});

test('runner source uses the frozen product paths and never crosses into plan, execute or apply', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.match(source, /prepareAcceptance/);
  assert.match(source, /packages['"],\s*'cli['"],\s*'dist['"],\s*'agent-port['"],\s*'main\.js/);
  assert.match(source, /packages['"],\s*'editor['"],\s*'dist['"],\s*'index\.html/);
  assert.match(source, /surdet_composition_compare/);
  assert.match(source, /surdet_review_prepare_comparison/);
  assert.match(source, /Alpha route A\./);
  assert.match(source, /Alpha route C\./);
  assert.match(source, /方案字母只用于本次审阅排序/);
  assert.match(source, /data-choice-fingerprint/);
  assert.match(source, /data-decision-receipt/);
  assert.match(source, /reviewSourceLabel/);
  assert.match(source, /dumpBrowserRoot/);
  assert.match(source, /writeArtifact/);
  assert.doesNotMatch(source, /callTool\([^\n]+surdet_composition_(?:plan|execute)/);
  assert.doesNotMatch(source, /callTool\([^\n]+surdet_change_commit/);
});

test('formal branch binds runHead to CODE_EVIDENCE_HEAD and requires no tracked diff', () => {
  const source = fs.readFileSync(runnerPath, 'utf8');
  assert.match(source, /SURDET_CODE_EVIDENCE_HEAD/);
  assert.match(source, /trackedCodeDiffPaths/);
  assert.match(source, /runHead[^\n]+codeEvidenceHead|codeEvidenceHead[^\n]+runHead/);
  assert.match(source, /modeName === 'formal'/);
});
