import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { copyStarter, sealCandidate } from './agent-candidate-composition-wave-5.e2e.mjs';
import { createHarness, withPort, callTool, buildReviewedPlanRequest } from './human-agent-review-wave-6.e2e.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from '../../editor/e2e/asset-import-authority.e2e.mjs';
import { startDevProject } from '../../editor/scripts/dev-project.mjs';
import { HumanWorkspaceStore } from '../dist/authoring/human-workspace-store.js';
import { NodeLocalLeaseManager } from '../dist/authoring/node-local-lease.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const starterRoot = path.join(repoRoot, 'examples/starter');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await test()) return; await delay(50); }
  throw new Error(`Timeout: ${label}`);
}
function result(envelope, label) {
  assert.equal(envelope.ok, true, `${label}: ${JSON.stringify(envelope.error)}`);
  return envelope.result;
}
function tree(root) {
  const files = [];
  const visit = (directory, relative = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['node_modules', 'dist', '.vite'].includes(entry.name)) continue;
      if (relative === '' && /^\.surdet-bind-.*\.json$/.test(entry.name)) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path.join(directory, entry.name), name);
      else if (entry.isFile()) files.push([name, crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, entry.name))).digest('hex')]);
    }
  };
  visit(root);
  return files;
}
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave7-'));
  const projectRoot = path.join(root, 'project');
  const dataDir = path.join(root, 'agent-data');
  const priorDataDir = process.env.SURDET_AGENT_DATA_DIR;
  process.env.SURDET_AGENT_DATA_DIR = dataDir;
  const originalStarter = tree(starterRoot);
  copyStarter(projectRoot);
  assert.deepEqual(tree(projectRoot), originalStarter);
  fs.mkdirSync(dataDir, { recursive: true });
  const harness = createHarness();
  const workspaceStore = new HumanWorkspaceStore({ dataRoot: dataDir });
  const leases = new NodeLocalLeaseManager(dataDir);
  const canonicalRoot = fs.realpathSync(projectRoot);
  const options = { projectRoot: canonicalRoot, dataDir };
  const milestones = [];
  const pageErrors = [];
  const browserErrors = [];
  const failedRequests = [];
  const failedResponses = [];
  let server;
  let browser;
  let page;
  let reviewPage;
  let failure;
  const pass = (name, detail = {}) => { milestones.push({ name, ...detail }); console.log(`PASS ${name}`); };
  const observe = action => withPort(harness, { ...options, policy: 'observe' }, action);
  const describe = () => observe(async port => result(await callTool(port, 'surdet_session_describe'), 'describe'));
  const waitWorkspace = availability => until(async () => (await workspaceStore.inspect(canonicalRoot)).summary.availability === availability,
    `workspace ${availability}`);
  const readyChange = async label => withPort(harness, { ...options, policy: 'stage' }, async port => {
    result(await callTool(port, 'surdet_project_inspect'), 'fresh inspect');
    const begun = result(await callTool(port, 'surdet_change_begin', { intent: label, acceptanceCriteria: ['Wave 7 sequential relay'], initiator: 'external-agent' }), 'begin');
    result(await callTool(port, 'surdet_variable_ensure', { operationId: `${label}-ensure`, name: `wave7.${label}`, type: 'string', initial: label }), 'ensure');
    result(await callTool(port, 'surdet_change_diff'), 'diff');
    assert.equal(result(await callTool(port, 'surdet_project_validate'), 'validate').ok, true);
    assert.equal(result(await callTool(port, 'surdet_project_simulate', { sceneId: 'wave7_alpha' }), 'simulate').status, 'passed');
    assert.equal(result(await callTool(port, 'surdet_runtime_run_from', { sceneId: 'wave7_alpha', seed: 907, choices: [] }), 'runtime').status, 'passed');
    return begun.changeId;
  });
  const commit = (changeId, extra = {}) => withPort(harness, { ...options, policy: 'apply', resumeChangeId: changeId, ...extra },
    port => callTool(port, 'surdet_change_commit'));
  const editorState = () => page.evaluate(() => ({ current: window.surdetEditorDebug.state.current,
    mainTab: window.surdetEditorDebug.state.mainTab,
    selectedObjectRef: window.surdetEditorDebug.state.selectedObjectRef,
    currentTimeline: window.surdetEditorDebug.state.currentTimeline,
    text: window.surdetEditorDebug.state.scenes.get(window.surdetEditorDebug.state.current)?.text,
    dirty: window.surdetEditorDebug.state.scenes.get(window.surdetEditorDebug.state.current)?.dirty }));
  const edit = async marker => {
    await page.locator('[data-editor-mode="editor"]').click();
    await page.locator('[data-script-view="source"]').click();
    const input = page.locator('.v4-source-editor');
    const previous = await input.inputValue();
    await input.fill(`${previous}\n${marker}\n`);
    await waitWorkspace('dirty');
    return input.inputValue();
  };
  const sync = async discard => {
    await page.locator(`[data-action="${discard ? 'discard-project-drafts' : 'sync-project'}"]`).click();
    await until(async () => (await page.locator('#status').textContent()).startsWith('项目已同步'), 'explicit project sync');
    await waitWorkspace('clean');
  };
  const save = async () => {
    await page.locator('[data-action="save-project"]').click();
    await waitWorkspace('clean');
    assert.equal((await editorState()).dirty, false);
  };
  try {
    const port = await freePort();
    server = await startDevProject(['--project', canonicalRoot, '--data-root', path.join(root, 'asset-data'), '--port', String(port)],
      { registerSignals: false, cacheDir: path.join(os.tmpdir(), 'surdet-wave7-vite-cache') });
    assert.equal((await leases.inspect('project', canonicalRoot)).state, 'free');
    const url = `http://127.0.0.1:${port}`;
    browser = await chromium.launch({ headless: true });
    const roots = { project: canonicalRoot };
    const bridge = createNodeFsBridge(roots);
    const openPage = async picker => {
      const next = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      next.on('pageerror', error => pageErrors.push(error.stack ?? error.message));
      next.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
      next.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText,
        navigation: request.isNavigationRequest(), frame: request.frame() }));
      next.on('response', response => { if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() }); });
      await next.exposeFunction('__surdetNodeFs', request => {
        assert(!(['write', 'remove', 'mkdir'].includes(request.op) && request.rootKey === 'project'),
          'bound Editor attempted direct browser filesystem publication');
        return bridge(request);
      });
      await next.addInitScript(nodeBackedFileSystemInit, { initialRootKey: picker });
      await next.goto(url, { waitUntil: 'networkidle' });
      return next;
    };
    page = await openPage('project');
    await page.locator('[data-action="open-project"]').click();
    await page.locator('[data-relay-protection="connected"]').waitFor();
    await page.waitForFunction(() => window.surdetEditorDebug.state.projectLoading === false);
    await waitWorkspace('clean');
    assert.equal((await describe()).humanWorkspace.availability, 'clean');
    pass('bound-editor-idle-and-agent-share-free-project-lease');

    const beforeStage = tree(canonicalRoot);
    const candidates = [
      await sealCandidate(canonicalRoot, dataDir, 'wave7-alpha', [{ tool: 'surdet_scene_create', args: { sceneId: 'wave7_alpha',
        blocks: [{ kind: 'text', speaker: 'lynn', value: 'Wave 7 reviewed scene.' }] } }]),
      await sealCandidate(canonicalRoot, dataDir, 'wave7-beta', [{ tool: 'surdet_variable_ensure', args: { name: 'wave7.beta', type: 'string', initial: 'reviewed' } }]),
    ];
    const candidateRefs = candidates.map(candidate => candidate.ref);
    const projectIdentity = candidates[0].capsule.projectIdentity;
    const comparison = await observe(async port => result(await callTool(port, 'surdet_review_prepare_comparison', { candidateRefs }), 'prepare comparison'));
    roots.comparison = path.join(dataDir, projectIdentity, 'reviews', comparison.reviewId);
    reviewPage = await openPage('comparison');
    await reviewPage.locator('[data-action="open-review"]').click();
    await reviewPage.locator('[data-review-main="comparison"]').waitFor();
    await reviewPage.getByRole('button', { name: '保存我的决定', exact: true }).click();
    await until(() => fs.existsSync(path.join(roots.comparison, 'decision.json')), 'real decision receipt');
    const decision = JSON.parse(fs.readFileSync(path.join(roots.comparison, 'decision.json'), 'utf8'));
    assert.equal(decision.reviewerChannel, 'surdet-editor-local');
    const plan = await withPort(harness, { ...options, policy: 'stage' }, async port => result(await callTool(port, 'surdet_composition_plan', buildReviewedPlanRequest({
      candidateRefs, comparisonFingerprint: comparison.projection.sourceIdentity.comparisonFingerprint,
      reviewDecision: { reviewId: comparison.reviewId, decisionId: decision.decisionId, decisionFingerprint: decision.decisionFingerprint },
    })), 'reviewed plan'));
    const execution = await withPort(harness, { ...options, policy: 'stage' }, async port => result(await callTool(port, 'surdet_composition_execute', {
      planId: plan.planId, artifactSha256: plan.artifactSha256, executeOperationId: 'wave7-reviewed-execute',
    }), 'execute'));
    const integrationChangeId = execution.integrationChangeId;
    const reviewResult = await withPort(harness, { ...options, policy: 'stage', resumeChangeId: integrationChangeId }, async port => {
      result(await callTool(port, 'surdet_change_diff'), 'reviewed diff');
      assert.equal(result(await callTool(port, 'surdet_project_validate'), 'reviewed validate').ok, true);
      assert.equal(result(await callTool(port, 'surdet_project_simulate', { sceneId: 'wave7_alpha' }), 'reviewed simulate').status, 'passed');
      assert.equal(result(await callTool(port, 'surdet_runtime_run_from', { sceneId: 'wave7_alpha', seed: 907, choices: [] }), 'reviewed runtime').status, 'passed');
      return result(await callTool(port, 'surdet_review_prepare_result', { planId: plan.planId, artifactSha256: plan.artifactSha256, changeId: integrationChangeId }), 'prepare result');
    });
    roots.result = path.join(dataDir, projectIdentity, 'reviews', reviewResult.reviewId);
    await reviewPage.evaluate(() => window.__surdetE2eSetPickerRoot('result'));
    await reviewPage.locator('[data-action="open-review"]').click();
    await reviewPage.locator('[data-review-main="result"]').waitFor();
    await reviewPage.getByRole('button', { name: '批准这个计划', exact: true }).click();
    await until(() => fs.existsSync(path.join(roots.result, 'final-approval.json')), 'real approval receipt');
    const approval = JSON.parse(fs.readFileSync(path.join(roots.result, 'final-approval.json'), 'utf8'));
    assert.equal(approval.reviewerChannel, 'surdet-editor-local');
    assert.deepEqual(tree(canonicalRoot), beforeStage, 'stage/review changed the source project');
    await reviewPage.close();
    await page.locator('#editor .block[data-object-ref]:not([data-object-ref=""])').first().click();
    await page.locator('[data-editor-mode="preview"]').click();
    await page.waitForFunction(() => document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug?.rendererStatus === 'awaiting');
    const oldPreview = await page.locator('iframe.preview-frame').elementHandle();
    const beforeApply = await editorState();
    await waitWorkspace('clean');
    const applied = await withPort(harness, { ...options, policy: 'apply', resumeChangeId: integrationChangeId }, async port => result(await callTool(port, 'surdet_change_commit', {
      approvalRef: { resultReviewId: reviewResult.reviewId, approvalId: approval.approvalId, approvalFingerprint: approval.approvalFingerprint },
    }), 'reviewed apply'));
    assert.equal(applied.status, 'COMMITTED');
    await page.locator('[data-relay-update="pending"]').waitFor();
    assert.equal((await editorState()).text, beforeApply.text, 'external notice automatically reloaded buffers');
    assert.equal(await oldPreview.evaluate(node => node.isConnected), true, 'notice replaced the active preview');
    await page.locator('[data-action="view-project-changes"]').click();
    await page.locator('#editor-project-changes').waitFor();
    assert((await page.locator('#editor-project-changes').textContent()).includes('content/scenario/wave7_alpha.gal'));
    assert((await page.locator('#editor-project-changes').textContent()).includes('game.config.json'));
    await page.locator('#editor-project-changes').getByRole('button', { name: '关闭', exact: true }).click();
    await sync(false);
    assert.equal((await editorState()).current, beforeApply.current, 'sync lost the exact scene key');
    assert.equal((await editorState()).mainTab, 'preview');
    assert.equal((await editorState()).selectedObjectRef, beforeApply.selectedObjectRef);
    assert.equal((await editorState()).currentTimeline, beforeApply.currentTimeline);
    assert.equal(await oldPreview.evaluate(node => node.isConnected), false, 'sync retained the old preview');
    await page.waitForFunction(() => document.querySelector('iframe.preview-frame')?.contentWindow?.surdetPreviewDebug?.rendererStatus === 'awaiting');
    await page.locator('[data-editor-mode="config"]').click();
    await page.locator('[data-config-section-target="variables"]').click();
    await page.locator('[data-config-section="variables"]').getByRole('button', { name: 'wave7.beta', exact: true }).click();
    const variableInputs = page.locator('[data-config-section="variables"] input[aria-label^="变量名"]');
    const variableIndex = await variableInputs.evaluateAll(inputs => inputs.findIndex(input => input.value === 'wave7.beta'));
    assert(variableIndex >= 0, 'reviewed variable is absent from Editor');
    await page.locator('[data-config-section="variables"] input[aria-label^="初始值"]').nth(variableIndex).fill('人类接力 Flow A。');
    await waitWorkspace('dirty');
    await page.getByRole('button', { name: '保存变量表', exact: true }).click();
    await waitWorkspace('clean');
    const inspected = await observe(async port => result(await callTool(port, 'surdet_project_inspect'), 'inspect human project'));
    assert.equal(inspected.variables.find(variable => variable.name === 'wave7.beta')?.declaration.initial, '人类接力 Flow A。');
    await page.screenshot({ path: path.join(root, 'flow-a.png') });
    pass('flow-a-reviewed-agent-apply-explicit-sync-human-save-agent-inspect', { integrationChangeId, reviewId: reviewResult.reviewId });

    const changeB = await readyChange('flowB');
    await edit('人类未保存 Flow B。');
    const beforeB = { project: tree(canonicalRoot), change: tree(path.join(dataDir, projectIdentity, changeB)) };
    const blockedB = await commit(changeB);
    assert.equal(blockedB.error?.code, 'HUMAN_WORKSPACE_DIRTY');
    assert.deepEqual(tree(canonicalRoot), beforeB.project, 'dirty rejection wrote project files');
    const afterChangeB = tree(path.join(dataDir, projectIdentity, changeB));
    const afterChangeMap = new Map(afterChangeB);
    for (const [name, hash] of beforeB.change) assert.equal(afterChangeMap.get(name), hash, `dirty rejection changed ${name}`);
    const beforeChangeNames = new Set(beforeB.change.map(([name]) => name));
    const additions = afterChangeB.filter(([name]) => !beforeChangeNames.has(name));
    assert.equal(additions.length, 1, 'rejection may only append its existing invocation audit record');
    assert(additions[0][0].startsWith('invocations/'));
    const rejectedInvocation = JSON.parse(fs.readFileSync(path.join(dataDir, projectIdentity, changeB, additions[0][0]), 'utf8'));
    assert.equal(rejectedInvocation.capability, 'change.commit');
    assert.equal(rejectedInvocation.ok, false);
    assert.equal(rejectedInvocation.errorCode, 'HUMAN_WORKSPACE_DIRTY');
    assert.equal(rejectedInvocation.projectRevisionBefore, rejectedInvocation.projectRevisionAfter);
    assert.equal(rejectedInvocation.workingRevisionBefore, rejectedInvocation.workingRevisionAfter);
    await sync(true);
    assert.deepEqual(tree(canonicalRoot), beforeB.project, 'discard wrote project files');
    assert.equal(result(await commit(changeB), 'same change retry').status, 'COMMITTED');
    await page.locator('[data-relay-update="pending"]').waitFor();
    await sync(false);
    pass('flow-b-dirty-zero-advance-explicit-discard-same-change-retry', { changeId: changeB });

    const oldChangeC = await readyChange('flowC_old');
    await edit('人类保存 Flow C。');
    assert.equal((await commit(oldChangeC)).error?.code, 'HUMAN_WORKSPACE_DIRTY');
    await save();
    const stale = await commit(oldChangeC);
    assert(['PROJECT_CHANGED_SINCE_BEGIN', 'CHANGE_STALE', 'CHANGE_NOT_OPEN'].includes(stale.error?.code), JSON.stringify(stale));
    const newChangeC = await readyChange('flowC_new');
    assert.equal(result(await commit(newChangeC), 'new base apply').status, 'COMMITTED');
    await page.locator('[data-relay-update="pending"]').waitFor();
    await sync(false);
    pass('flow-c-human-save-invalidates-old-agent-change-new-inspect-succeeds', { oldChangeId: oldChangeC, newChangeId: newChangeC });

    const changeD = await readyChange('flowD');
    const pauseRoot = path.join(root, 'gate-pause');
    fs.mkdirSync(pauseRoot);
    const hook = path.join(pauseRoot, 'pause-after-clean-gate.mjs');
    const cliDist = pathToFileURL(path.join(repoRoot, 'packages/cli/dist/')).href;
    fs.writeFileSync(hook, `import fs from 'node:fs/promises';\nimport { AuthoringService } from '${cliDist}authoring/authoring-service.js';\nimport { HumanWorkspaceStore } from '${cliDist}authoring/human-workspace-store.js';\nimport { NodeProjectStorage } from '${cliDist}authoring/node-project-storage.js';\nlet committing=false, cleanGate=false, paused=false;\nconst commit=AuthoringService.prototype.commit;\nAuthoringService.prototype.commit=async function(...args){committing=true;try{return await commit.apply(this,args)}finally{committing=false}};\nconst inspect=HumanWorkspaceStore.prototype.inspect;\nHumanWorkspaceStore.prototype.inspect=async function(...args){const value=await inspect.apply(this,args);if(committing&&value.summary.availability==='clean')cleanGate=true;return value};\nconst list=NodeProjectStorage.prototype.listFiles;\nNodeProjectStorage.prototype.listFiles=async function(...args){if(committing&&cleanGate&&!paused){paused=true;await fs.writeFile(${JSON.stringify(path.join(pauseRoot, 'ready'))},'clean gate passed');const until=Date.now()+30000;while(true){try{await fs.stat(${JSON.stringify(path.join(pauseRoot, 'release'))});break}catch{}if(Date.now()>until)throw new Error('gate pause timed out');await new Promise(r=>setTimeout(r,20));}}return list.apply(this,args)};\n`, 'utf8');
    await waitWorkspace('clean');
    const pendingCommit = commit(changeD, { preload: pathToFileURL(hook).href });
    try {
      await until(() => fs.existsSync(path.join(pauseRoot, 'ready')), 'Agent paused after clean gate');
      assert.equal((await leases.inspect('project', canonicalRoot)).state, 'owned');
      const lateDraft = await edit('Agent 检查后新输入 Flow D。');
      fs.writeFileSync(path.join(pauseRoot, 'release'), 'continue');
      assert.equal(result(await pendingCommit, 'commit after late typing').status, 'COMMITTED');
      await page.locator('[data-relay-update="conflict"]').waitFor();
      assert.equal((await editorState()).text.replaceAll('\r\n', '\n'), lateDraft);
      const beforeHumanSave = tree(canonicalRoot);
      await page.locator('[data-action="save-project"]').click();
      await until(async () => (await page.locator('#status').textContent()).includes('项目已被外部更新'), 'old-baseline human save rejection');
      assert.deepEqual(tree(canonicalRoot), beforeHumanSave);
      assert.equal((await editorState()).text.replaceAll('\r\n', '\n'), lateDraft);
      assert.equal((await editorState()).dirty, true);
      assert.equal(JSON.parse(fs.readFileSync(path.join(canonicalRoot, 'game.config.json'), 'utf8')).variables['wave7.flowD'].initial, 'flowD');
      await page.screenshot({ path: path.join(root, 'flow-d.png') });
    } finally {
      if (!fs.existsSync(path.join(pauseRoot, 'release'))) fs.writeFileSync(path.join(pauseRoot, 'release'), 'cleanup');
      await pendingCommit.catch(() => {});
    }
    pass('flow-d-late-typing-preserved-old-baseline-save-rejected', { changeId: changeD });
    assert.deepEqual(tree(starterRoot), originalStarter, 'original Starter changed');
    assert.deepEqual(pageErrors, []);
    assert(failedRequests.every(request => request.url === `${url}/preview.html`
      && request.error === 'net::ERR_ABORTED' && request.navigation && request.frame.isDetached()),
    'only navigation canceled by removal of an old preview frame is expected');
    assert.deepEqual(failedResponses, [{ url: `${url}/__surdet/project-asset-import/v1/workspace/begin`, status: 409 }],
      'only the exercised old-baseline save rejection may fail an HTTP request');
    assert.deepEqual(browserErrors, ['Failed to load resource: the server responded with a status of 409 (Conflict)']);
    assert.deepEqual(harness.protocolErrors, []);
    assert.deepEqual(harness.stderrLines, []);
    assert.deepEqual(harness.childCleanupFailures, []);
  } catch (error) {
    failure = error;
    if (reviewPage && !reviewPage.isClosed()) {
      console.error('REVIEW_UI', (await reviewPage.locator('body').innerText()).slice(0, 2000));
      await reviewPage.screenshot({ path: path.join(root, 'review-failure.png') }).catch(() => {});
    }
    if (page) await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
  } finally {
    await browser?.close();
    await server?.close();
    assert.equal((await leases.inspect('project', canonicalRoot)).state, 'free', 'project lease leaked after shutdown');
    if (priorDataDir === undefined) delete process.env.SURDET_AGENT_DATA_DIR;
    else process.env.SURDET_AGENT_DATA_DIR = priorDataDir;
    fs.writeFileSync(path.join(root, 'wave7-result.json'), JSON.stringify({ status: failure ? 'FAILED' : 'PASSED', milestones,
      pageErrors, browserErrors,
      failedRequests: failedRequests.map(({ frame, ...request }) => ({ ...request, detached: frame.isDetached() })),
      failedResponses, failure: failure?.stack ?? null, projectRoot: canonicalRoot, dataDir }, null, 2));
    console.log(`WAVE7_RESULT=${root}`);
  }
  if (failure) throw failure;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
