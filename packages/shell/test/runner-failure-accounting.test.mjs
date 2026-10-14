import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// Execute the real runner functions without their CLI startup, builds or Electron processes.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const source = (name) => fs.readFileSync(new URL(`../e2e/${name}`, import.meta.url), 'utf8');
const qualification = source('renderer-v4-qualification-runner.mjs');
function section(text, start, end) {
  const left = text.indexOf(start), right = text.indexOf(end, left + start.length);
  if (left < 0 || right < 0) throw new Error(`Runner function boundary missing: ${start}`);
  return text.slice(left, right);
}
const execute = (code, dependencies, call) => new AsyncFunction(...Object.keys(dependencies), `${code}\nreturn ${call};`)(...Object.values(dependencies));
const emptyEvents = () => ({ pageErrors: [], consoleErrors: [], requestFailures: [],
  unhandledRejections: [], rendererErrors: [], releaseFailures: [], unexpectedWindowClosed: false });
const cloneJson = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
const errorText = error => error instanceof Error ? error.message : String(error);

describe('startup sampling boundaries', () => {
  it.each([60, 75])('observes debug before asset waits and preserves timing discrepancy (%s)', async pageAssetDuration => {
    let now = 0;
    const page = {
      on() {},
      async waitForFunction(predicate) {
        const query = predicate.toString();
        now = Math.max(now, query.includes('assetLoading') ? 90 : query.includes('__surdetRendererStartupDiagnostic') ? 20 : 30);
      },
      async waitForTimeout(ms) { now += ms; },
      async reload() {},
      async evaluate(query) {
        now += 1;
        return query.toString().includes('__surdetRendererStartupDiagnostic')
          ? { derived: { navigationToDebugMs: 30, runtimeCreateMs: 5, assetLoadMs: pageAssetDuration,
            debugToAssetDoneMs: pageAssetDuration, assetDoneToStableFrameMs: 5 } }
          : { total: 1, completed: 1, failed: 0, done: true };
      },
    };
    const close = vi.fn();
    const code = section(qualification, 'async function waitForDiagnostic(', 'async function measureMenu(')
      + section(qualification, 'function phaseMetrics(', 'async function collectGroup(');
    const sample = await execute(code, {
      path, readyTimeout: 100, assertUnder() {},
      fs: { mkdtempSync: () => 'fixture', mkdirSync() {}, rmSync() {} }, os: { tmpdir: () => 'temp' },
      electron: { async launch() { now = 10; return { async firstWindow() { now = 20; return page; }, close }; } },
      stamp: () => ({ monotonicMs: now }), duration: (a, b) => b.monotonicMs - a.monotonicMs,
      validateRendererStartupDiagnosticSnapshot() {}, measureMenu: async () => ({ elapsed: 5 }), measureScene: async () => ({ elapsed: 5 }),
    }, "collectLaunch('fixture', 'current', 1, 1)");
    expect(sample.failed).not.toBe(true);
    expect(sample.metrics.coldStartMs).toBe(30);
    expect(sample.metrics.assetReadyMs).toBe(90);
    expect(sample.hostDurations.hostDebugToAssetDoneMs).toBe(60);
    expect(sample.observer.lagMs).toBe(Math.abs(60 - pageAssetDuration));
    expect(close).toHaveBeenCalledOnce();
  });

  it.each(['candidate-qualified', 'not-qualified', 'sample-failed'])('propagates %s to the runner exit status', async outcome => {
    const process = { argv: ['node', 'runner'], exitCode: 0 };
    const group = { id: 'group', artifact: 'group.json', baseline: { root: 'base', commit: 'fixture' }, current: { root: 'current', commit: 'fixture' } };
    const artifact = { qualification: { status: outcome === 'candidate-qualified' ? outcome : 'not-qualified' } };
    const writes = [];
    await execute(section(qualification, 'async function main()', '\nmain().catch('), {
      path, process, defaultRepositoryRoot: 'fixture',
      parseRendererV4QualificationArgs: () => ({ repositoryRoot: 'fixture', artifactDir: 'artifacts', tempRoot: 'temp' }),
      validateRepositoryRoot() {}, assertUnder() {}, fs: { existsSync: () => false, mkdirSync() {} },
      buildQualificationMatrix: () => [group], buildCleanupManifest: () => ({ worktrees: [] }),
      writeJson: (file, value) => writes.push({ file, value: cloneJson(value) }),
      createQualificationWorktrees: () => [], uniqueRootDescriptors: () => [group.baseline, group.current],
      runNpm() {}, collectBuildManifest: () => ({}), buildEquivalenceRecord: () => ({ qualified: true }),
      writeBuildEvidence() {}, applyRendererStartupInstrumentation: () => ({}), environmentFor: () => ({}),
      collectGroup: async () => ({ failed: outcome === 'sample-failed', artifact }), console: { log() {} }, isoNow: () => 'fixture',
    }, 'main()');
    expect(writes.some(entry => entry.value.qualification?.status === artifact.qualification.status)).toBe(true);
    expect(process.exitCode).toBe(outcome === 'candidate-qualified' ? 0 : 1);
  });
});

describe('E2E result accounting after cleanup', () => {
  for (const runner of ['gallery-music', 'wave-4']) {
    const text = source(`player-experience-${runner}.e2e.mjs`);
    it.each(['none', 'action', 'page', 'close', 'late-page', 'asset'])('%s failure is reflected by ' + runner, async failure => {
      const events = emptyEvents();
      if (failure === 'page') events.pageErrors.push('page failure');
      const close = vi.fn(async () => {
        if (failure === 'late-page') events.pageErrors.push('late page failure');
        if (failure === 'close') throw new Error('close failure');
      });
      const session = { events, close, lastSnapshot: {}, screenshots: [], tempUserData: 'fixture', userData: 'fixture',
        identity: { title: 'fixture', assetLoading: { done: failure !== 'asset', total: 1, completed: failure === 'asset' ? 0 : 1, failed: 0 } } };
      const prepare = async () => { if (failure === 'action') throw new Error('action failure'); };
      const protocol = { musicIds: ['track'], cases: [{ id: 'C' }] };
      const code = runner === 'gallery-music'
        ? section(text, 'async function runCase(', 'function aggregateEvents(')
        : section(text, 'function caseEvidence(', 'async function runSmokeCase(')
          + section(text, 'async function runCase(', 'function writeArtifact(');
      const result = await execute(code, {
        launchSession: async () => session, prepareCase: prepare, prepareSession: prepare,
        clickMusic: async () => ({ actualPlayback: failure !== 'asset' }), runBacklogCase: async () => ({ completed: true }),
        protocol, cloneJson, errorText, emptyEvents, path, tempRoot: 'temp', gameSourceRoot: 'fixture', gameDist: 'dist',
      }, runner === 'gallery-music' ? "runCase({ id: 'C', source: 'fixture' })" : "runCase('C')");
      const main = text.slice(text.indexOf('async function main()'));
      const statusStatement = main.match(/const status = [\s\S]*?;/)?.[0];
      const status = new Function('cases', 'protocol', `${statusStatement}\nreturn status;`)([result], protocol);
      expect(result.ok).toBe(failure === 'none');
      expect(status).toBe(failure === 'none' ? 'PASSED' : 'FAILED');
      expect(close).toHaveBeenCalledOnce();
      if (failure === 'page' || failure === 'late-page') expect(result.events.pageErrors).toHaveLength(1);
      if (failure === 'close') expect(result.events.consoleErrors).toContain('close: close failure');
    });
  }
});
