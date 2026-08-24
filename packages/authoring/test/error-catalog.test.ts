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
      expect(['same-request', 'after-inspect', 'after-refresh', 'after-repair', 'new-change', 'manual-recovery', 'never']).toContain(definition.retryDisposition);
    }
    expect(errorDefinition('CHANGE_RECORD_CONFLICT' as any).retryDisposition).toBe('after-refresh');
    expect(errorDefinition('RECOVERY_PLAN_STALE' as any).repairActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability: 'change.recovery.inspect' }),
    ]));
  });
});
