import { describe, expect, it } from 'vitest';
import {
  AuthoringOperationError,
  createFailureEnvelope,
  errorDefinition,
} from '../src/index.js';

describe('authoring error catalog and envelopes', () => {
  it('turns stale object failures into an inspect-first repair contract', () => {
    const envelope = createFailureEnvelope({
      sessionId: 's1', capability: 'scene.patch', projectIdentity: 'p1',
    }, new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', 'fingerprint stale'));
    expect(envelope.ok).toBe(false);
    if (envelope.ok) throw new Error('expected failure');
    expect(envelope.error.retryDisposition).toBe('after-inspect');
    expect(envelope.error.repairActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'object.inspect' }),
    ]));
  });

  it('marks recovery failure terminal and manual', () => {
    const error = errorDefinition('COMMIT_RECOVERY_FAILED');
    expect(error.retryDisposition).toBe('manual-recovery');
    expect(error.repairActions.every((action) => action.terminal)).toBe(true);
  });

  it('does not carry the legacy fuzzy retry fields', () => {
    const envelope = createFailureEnvelope({
      sessionId: 's1', capability: 'change.commit', projectIdentity: 'p1',
    }, new AuthoringOperationError('VALIDATION_REQUIRED', 'validate first'));
    expect(JSON.stringify(envelope)).not.toContain('"retriable"');
    expect(JSON.stringify(envelope)).not.toContain('"action"');
  });

  it('publishes every Wave 4 transaction and recovery error with a repair contract', () => {
    const codes = [
      'CHANGE_RECORD_CONFLICT', 'CHANGE_BUSY', 'PROJECT_BUSY', 'LEASE_CORRUPT',
      'CHANGE_STORE_CORRUPT', 'CHANGE_STORE_FORMAT_UNSUPPORTED', 'JOURNAL_CORRUPT',
      'RECOVERY_NOT_REQUIRED', 'RECOVERY_PLAN_STALE', 'RECOVERY_AMBIGUOUS',
      'RECOVERY_EXECUTION_FAILED', 'INVOCATION_LEDGER_WRITE_FAILED',
    ] as const;
    for (const code of codes) {
      const definition = errorDefinition(code as any);
      expect(definition, code).toBeDefined();
      expect(definition.repairActions, code).toEqual(expect.arrayContaining([expect.any(Object)]));
      expect(['same-request', 'after-inspect', 'after-refresh', 'after-repair', 'after-human-review', 'new-change', 'manual-recovery', 'never']).toContain(definition.retryDisposition);
    }
    expect(errorDefinition('CHANGE_RECORD_CONFLICT' as any).retryDisposition).toBe('after-refresh');
    expect(errorDefinition('RECOVERY_PLAN_STALE' as any).repairActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'change.recovery.inspect' }),
    ]));
  });
});

describe('wave 5 composition error catalog', () => {
  it('publishes all ten wave-5 composition errors with repair contracts', async () => {
    const { AUTHORING_ERROR_CODES, errorDefinition } = await import('../src/error-catalog.js');
    const expected = [
      ['CAPSULE_IDENTITY_MISMATCH', 'never'],
      ['CANDIDATE_PROJECT_MISMATCH', 'new-change'],
      ['CANDIDATE_BASE_MISMATCH', 'new-change'],
      ['CANDIDATE_NOT_COMPOSABLE', 'new-change'],
      ['COMPOSITION_DEPENDENCY_MISSING', 'after-repair'],
      ['COMPOSITION_CONFLICT_UNRESOLVED', 'after-repair'],
      ['COMPOSITION_PLAN_STALE', 'after-refresh'],
      ['COMPOSITION_PLAN_INVALID', 'never'],
      ['COMPOSITION_REPLAY_FAILED', 'after-repair'],
      ['COMPOSITION_INCOMPLETE', 'after-inspect'],
    ] as const;
    for (const [code, disposition] of expected) {
      expect(AUTHORING_ERROR_CODES).toContain(code);
      const definition = errorDefinition(code);
      expect(definition.category, code).toBeTruthy();
      expect(definition.retryDisposition, code).toBe(disposition);
      expect(Array.isArray(definition.repairActions), `${code}.repairActions`).toBe(true);
    }
  });

  it('keeps terminal identity/invalid composition errors non-retryable in envelopes', async () => {
    const { createFailureEnvelope, AuthoringOperationError } = await import('../src/index.js');
    for (const code of ['CAPSULE_IDENTITY_MISMATCH', 'CANDIDATE_PROJECT_MISMATCH', 'COMPOSITION_PLAN_INVALID'] as const) {
      const envelope = createFailureEnvelope(
        { sessionId: 's1', capability: 'composition.compare', projectIdentity: 'p1' },
        new AuthoringOperationError(code, 'wave 5 terminal'),
      );
      if (envelope.ok) throw new Error(`expected failure for ${code}`);
      expect(envelope.error.retryDisposition, code).toBe(code === 'CANDIDATE_PROJECT_MISMATCH' ? 'new-change' : 'never');
    }
  });
});

describe('wave 6 human review error catalog', () => {
  it('publishes all review errors with exact retry dispositions and repair contracts', async () => {
    const { AUTHORING_ERROR_CODES, errorDefinition } = await import('../src/error-catalog.js');
    const expected = [
      ['REVIEW_NOT_FOUND', 'after-inspect'],
      ['REVIEW_IDENTITY_MISMATCH', 'never'],
      ['REVIEW_FORMAT_UNSUPPORTED', 'never'],
      ['REVIEW_DECISION_REQUIRED', 'after-human-review'],
      ['REVIEW_DECISION_INVALID', 'after-human-review'],
      ['REVIEW_DECISION_STALE', 'after-refresh'],
      ['REVIEW_RESULT_NOT_READY', 'after-inspect'],
      ['REVIEW_APPROVAL_REQUIRED', 'after-human-review'],
      ['REVIEW_APPROVAL_STALE', 'after-refresh'],
      ['REVIEW_RETURNED', 'never'],
      ['REVIEW_FIXTURE_CHANGED', 'after-refresh'],
      ['REVIEW_BUSY', 'after-refresh'],
      ['REVIEW_TERMINAL_ALREADY_SET', 'never'],
    ] as const;
    for (const [code, disposition] of expected) {
      expect(AUTHORING_ERROR_CODES).toContain(code);
      const definition = errorDefinition(code);
      expect(definition.category, code).toBeTruthy();
      expect(definition.retryDisposition, code).toBe(disposition);
      expect(definition.repairActions, code).toEqual(expect.arrayContaining([expect.any(Object)]));
    }
    expect(errorDefinition('REVIEW_BUSY').repairActions.every((item) => item.terminal !== true)).toBe(true);
  });
});
