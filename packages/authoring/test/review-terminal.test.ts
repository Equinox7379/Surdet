import { describe, expect, it } from 'vitest';
import {
  AuthoringOperationError,
  parseReviewTerminalCommand,
  parseReviewTerminalSnapshot,
  type ReviewTerminalCommand,
  type ReviewTerminalSnapshot,
} from '../src/index.js';

const SHA = 'a'.repeat(64);

function decisionCommand(): ReviewTerminalCommand {
  return {
    protocolVersion: '1.0.0',
    requestId: 'request-1',
    projectIdentity: 'project-1',
    reviewId: 'review-comparison-1',
    reviewPayload: { bytes: 123, sha256: SHA },
    action: 'comparison-decision',
    receipt: {
      receiptVersion: '1.0.0',
      decisionId: 'decision-1',
      reviewId: 'review-comparison-1',
      decisionFingerprint: 'b'.repeat(64),
    },
  };
}

function approvalCommand(): ReviewTerminalCommand {
  return {
    protocolVersion: '1.0.0',
    requestId: 'request-2',
    projectIdentity: 'project-1',
    reviewId: 'review-result-1',
    reviewPayload: { bytes: 456, sha256: 'c'.repeat(64) },
    action: 'result-approval',
    receipt: {
      receiptVersion: '1.0.0',
      approvalId: 'approval-1',
      resultReviewId: 'review-result-1',
      approvalFingerprint: 'd'.repeat(64),
    },
  };
}

function returnCommand(): ReviewTerminalCommand {
  return {
    protocolVersion: '1.0.0',
    requestId: 'request-3',
    projectIdentity: 'project-1',
    reviewId: 'review-result-1',
    reviewPayload: { bytes: 456, sha256: 'c'.repeat(64) },
    action: 'result-return',
    receipt: {
      receiptVersion: '1.0.0',
      returnId: 'return-1',
      resultReviewId: 'review-result-1',
      returnFingerprint: 'e'.repeat(64),
    },
  };
}

function expectInvalid(operation: () => unknown): void {
  try {
    operation();
    throw new Error('expected INVALID_REQUEST');
  } catch (error) {
    expect(error).toBeInstanceOf(AuthoringOperationError);
    expect(error).toMatchObject({ code: 'INVALID_REQUEST' });
  }
}

describe('review terminal transport contract', () => {
  it('accepts all three exact command envelopes without carrying a filesystem path', () => {
    for (const command of [decisionCommand(), approvalCommand(), returnCommand()]) {
      expect(parseReviewTerminalCommand(command)).toEqual(command);
      expect(command).not.toHaveProperty('reviewPath');
    }
  });

  it('rejects unknown fields, empty or oversized IDs, malformed payload identity, and unknown actions', () => {
    const command = decisionCommand();
    expectInvalid(() => parseReviewTerminalCommand({ ...command, reviewPath: 'C:/secret' }));
    expectInvalid(() => parseReviewTerminalCommand({ ...command, requestId: '' }));
    expectInvalid(() => parseReviewTerminalCommand({ ...command, reviewId: 'x'.repeat(257) }));
    expectInvalid(() => parseReviewTerminalCommand({
      ...command,
      reviewPayload: { bytes: -1, sha256: SHA },
    }));
    expectInvalid(() => parseReviewTerminalCommand({
      ...command,
      reviewPayload: { bytes: 1.5, sha256: SHA },
    }));
    expectInvalid(() => parseReviewTerminalCommand({
      ...command,
      reviewPayload: { bytes: 1, sha256: SHA.toUpperCase() },
    }));
    expectInvalid(() => parseReviewTerminalCommand({ ...command, action: 'approve-anything' }));
  });

  it('rejects action and receipt identity mismatches before business validation', () => {
    const decision = decisionCommand();
    expectInvalid(() => parseReviewTerminalCommand({
      ...decision,
      receipt: approvalCommand().receipt,
    }));
    expectInvalid(() => parseReviewTerminalCommand({
      ...decision,
      receipt: { ...decision.receipt as Record<string, unknown>, reviewId: 'other-review' },
    }));
    expectInvalid(() => parseReviewTerminalCommand({
      ...approvalCommand(),
      receipt: { receiptVersion: '1.0.0', approvalId: 'approval-1' },
    }));
    expectInvalid(() => parseReviewTerminalCommand({
      ...returnCommand(),
      receipt: { ...returnCommand().receipt as Record<string, unknown>, resultReviewId: 'other-review' },
    }));
  });

  it('accepts the five exact snapshot states and enforces their record relation', () => {
    const open: ReviewTerminalSnapshot = {
      protocolVersion: '1.0.0',
      reviewId: 'review-1',
      projectIdentity: 'project-1',
      state: 'open',
    };
    const written: ReviewTerminalSnapshot[] = [
      {
        ...open,
        reviewId: 'review-comparison-1',
        state: 'decision-written',
        record: {
          action: 'comparison-decision',
          file: 'decision.json',
          bytes: 100,
          sha256: SHA,
          receipt: decisionCommand().receipt,
        },
      },
      {
        ...open,
        reviewId: 'review-result-1',
        state: 'approval-written',
        record: {
          action: 'result-approval',
          file: 'final-approval.json',
          bytes: 100,
          sha256: SHA,
          receipt: approvalCommand().receipt,
        },
      },
      {
        ...open,
        reviewId: 'review-result-1',
        state: 'returned',
        record: {
          action: 'result-return',
          file: 'return-request.json',
          bytes: 100,
          sha256: SHA,
          receipt: returnCommand().receipt,
        },
      },
    ];
    const corrupt: ReviewTerminalSnapshot = { ...open, state: 'corrupt' };

    for (const snapshot of [open, ...written, corrupt]) {
      expect(parseReviewTerminalSnapshot(snapshot)).toEqual(snapshot);
    }

    expectInvalid(() => parseReviewTerminalSnapshot({ ...open, extra: true }));
    expectInvalid(() => parseReviewTerminalSnapshot({ ...open, record: written[0]!.record }));
    expectInvalid(() => parseReviewTerminalSnapshot({ ...written[0], state: 'approval-written' }));
    expectInvalid(() => parseReviewTerminalSnapshot({ ...corrupt, record: written[0]!.record }));
  });
});
