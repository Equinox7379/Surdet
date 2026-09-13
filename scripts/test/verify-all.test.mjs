import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runVerification, verificationSteps } from '../verify-all.mjs';

const cliPackage = JSON.parse(fs.readFileSync(new URL('../../packages/cli/package.json', import.meta.url), 'utf8'));
const rootPackage = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const starterPackage = JSON.parse(fs.readFileSync(new URL('../../examples/starter/package.json', import.meta.url), 'utf8'));
const formalPackage = JSON.parse(fs.readFileSync(new URL('../../examples/zero-after-midnight/package.json', import.meta.url), 'utf8'));
const ciWorkflow = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('verify-all has unique step ids and command signatures', () => {
  assert.equal(new Set(verificationSteps.map((step) => step.id)).size, verificationSteps.length);
  const signatures = verificationSteps.map((step) => [step.command, ...step.args].join('\0'));
  assert.equal(new Set(signatures).size, signatures.length);
  assert.equal(verificationSteps.filter((step) => step.id === 'tools').length, 1);
  const toolsStep = verificationSteps.find((step) => step.id === 'tools');
  assert.equal(toolsStep.args.at(-2), 'run');
  assert.equal(toolsStep.args.at(-1), 'verify:tools');
});

test('verify-all always spawns commands with shell false', () => {
  let receivedOptions;
  const status = runVerification(
    [{ id: 'probe', command: 'node', args: ['--version'] }],
    (_command, _args, options) => {
      receivedOptions = options;
      return { status: 0 };
    },
  );
  assert.equal(status, 0);
  assert.equal(receivedOptions.shell, false);
});

test('the I/O-heavy CLI suite uses one file worker', () => {
  assert.match(cliPackage.scripts.test, /(?:^|\s)--no-file-parallelism(?:\s|$)/);
  assert.match(cliPackage.scripts.test, /(?:^|\s)--maxWorkers=1(?:\s|$)/);
});

test('the root test script builds CLI, Renderer and Host prerequisites before workspace tests', () => {
  const script = rootPackage.scripts.test;
  const coreBuild = script.indexOf('npm run build -w @surdet/core');
  const authoringBuild = script.indexOf('npm run build -w @surdet/authoring');
  const cliBuild = script.indexOf('npm run build -w @surdet/cli');
  const rendererBuild = script.indexOf('npm run build -w @surdet/renderer');
  const hostBuild = script.indexOf('npm run build -w @surdet/host');
  const workspaceTests = script.indexOf('npm run test --workspaces --if-present');

  assert.ok(coreBuild >= 0, 'root test must build @surdet/core');
  assert.ok(authoringBuild > coreBuild, 'root test must build @surdet/authoring after core');
  assert.ok(cliBuild > authoringBuild, 'root test must build @surdet/cli after authoring');
  assert.ok(rendererBuild > coreBuild, 'root test must build Renderer after Core');
  assert.ok(hostBuild > rendererBuild, 'root test must build Host after Renderer');
  assert.ok(workspaceTests > Math.max(cliBuild, hostBuild), 'workspace tests need fresh CLI, Renderer and Host exports');
  assert.doesNotMatch(script, /npm run test -w @surdet\/authoring/, 'workspace tests already include authoring');
});

test('CI provisions the supported Node runtime, repository history, and Chromium', () => {
  assert.equal(rootPackage.engines.node, '>=24');
  assert.match(ciWorkflow, /fetch-depth:\s*0/);
  assert.match(ciWorkflow, /node-version:\s*24/);
  assert.match(ciWorkflow, /npx playwright install --with-deps chromium/);
});

test('example workspace checks invoke the built CLI without relying on a global binary', () => {
  const cliEntrypoint = 'node ../../packages/cli/dist/index.js';
  assert.equal(starterPackage.scripts.lint, `${cliEntrypoint} lint`);
  assert.equal(starterPackage.scripts.simulate, `${cliEntrypoint} simulate --assume battleWon=true`);
  assert.equal(formalPackage.scripts.lint, `${cliEntrypoint} lint .`);
  assert.equal(formalPackage.scripts.simulate, `${cliEntrypoint} simulate . --max-paths 500 --max-steps 20000`);
});
