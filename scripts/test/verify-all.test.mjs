import assert from 'node:assert/strict';
import test from 'node:test';
import { verificationSteps } from '../verify-all.mjs';

test('verify-all has unique step ids and command signatures', () => {
  assert.equal(new Set(verificationSteps.map((step) => step.id)).size, verificationSteps.length);
  const signatures = verificationSteps.map((step) => [step.command, ...step.args].join('\0'));
  assert.equal(new Set(signatures).size, signatures.length);
});
