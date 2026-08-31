import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runVerification, verificationSteps } from '../verify-all.mjs';

const cliPackage = JSON.parse(fs.readFileSync(new URL('../../packages/cli/package.json', import.meta.url), 'utf8'));

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
