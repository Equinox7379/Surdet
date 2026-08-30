import * as crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  FinalApprovalReceipt,
  HumanReviewProjection,
  ReviewEvidenceBinding,
  ReviewFinalResult,
  ReturnRequestReceipt,
  TextHasher,
} from '@surdet/authoring';
import {
  openReviewWorkspace,
  writeApprovalReceipt,
  writeDecisionReceipt,
  writeReturnReceipt,
  type ReviewDecisionDraft,
  type ReviewWorkspaceIdentity,
  type ReviewWorkspaceState,
} from '../src/review-workspace.js';

type MemoryNode = MemoryDirectory | MemoryFile;

class MemoryFile {
  readonly kind = 'file' as const;
  readFailure: Error | null = null;
  constructor(readonly name: string, public text: string) {}

  handle(): FileSystemFileHandle {
    return {
      kind: 'file',
      name: this.name,
      isSameEntry: async () => false,
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getFile: async () => {
        if (this.readFailure !== null) throw this.readFailure;
        return {
          name: this.name,
          size: Buffer.byteLength(this.text, 'utf8'),
          text: async () => this.text,
          arrayBuffer: async () => Uint8Array.from(Buffer.from(this.text, 'utf8')).buffer,
        } as unknown as File;
      },
      createWritable: async () => ({
        write: async (value: string) => { this.text = value; },
        close: async () => {},
      }) as unknown as FileSystemWritableFileStream,
    } as unknown as FileSystemFileHandle;
  }
}

class MemoryDirectory {
  readonly kind = 'directory' as const;
  readonly entries = new Map<string, MemoryNode>();

  constructor(readonly name: string) {}

  directory(name: string): MemoryDirectory {
    const child = new MemoryDirectory(name);
    this.entries.set(name, child);
    return child;
  }

  file(name: string, text: string): MemoryFile {
    const child = new MemoryFile(name, text);
    this.entries.set(name, child);
    return child;
  }

  handle(): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name: this.name,
      isSameEntry: async () => false,
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getDirectoryHandle: async (name: string, options?: { create?: boolean }) => {
        const existing = this.entries.get(name);
        if (existing?.kind === 'directory') return existing.handle();
        if (options?.create) return this.directory(name).handle();
        const error = new Error(`missing directory ${name}`);
        error.name = 'NotFoundError';
        throw error;
      },
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        const existing = this.entries.get(name);
        if (existing?.kind === 'file') return existing.handle();
        if (options?.create) return this.file(name, '').handle();
        const error = new Error(`missing file ${name}`);
        error.name = 'NotFoundError';
        throw error;
      },
      removeEntry: async (name: string) => { this.entries.delete(name); },
      values: async function* (this: MemoryDirectory) {
        for (const entry of this.entries.values()) yield entry.kind === 'directory' ? entry.handle() : entry.handle();
      }.bind(this),
    } as unknown as FileSystemDirectoryHandle;
  }
}

const hasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

function projection(overrides: Partial<HumanReviewProjection> = {}): HumanReviewProjection {
  return {
    reviewVersion: '1.0.0',
    reviewId: 'rev_comparison_1',
    kind: 'comparison',
    state: 'COMPARISON_PREPARED',
    projectIdentity: 'project-1',
    expectedProjectRevision: 'revision-1',
    task: { title: '比较候选', acceptanceCriteria: [], candidateCount: 0, objectCount: 0, conflictCount: 0, statementSource: 'generated-fallback' },
    candidates: [],
    safeGroups: [],
    defaultSelectedUnitIds: ['unit-root'],
    conflicts: [],
    dependencies: [],
    evidence: { candidateMatrix: [], blockingCount: 0, selectionRequiredCount: 0, advisoryCount: 0, canCreateDecision: true },
    objects: [],
    sourceIdentity: { projectIdentity: 'project-1', expectedProjectRevision: 'revision-1', comparisonFingerprint: 'comparison-fp' },
    reviewFingerprint: 'review-fp',
    ...overrides,
  };
}

function identityFor(value: HumanReviewProjection): ReviewWorkspaceIdentity {
  const payload = `${JSON.stringify(value)}\n`;
  return {
    reviewVersion: '1.0.0',
    reviewId: value.reviewId,
    kind: value.kind,
    projectIdentity: value.projectIdentity,
    expectedProjectRevision: value.expectedProjectRevision,
    comparisonFingerprint: value.sourceIdentity.comparisonFingerprint,
    ...(value.sourceIdentity.planFingerprint === undefined ? {} : { planFingerprint: value.sourceIdentity.planFingerprint }),
    ...(value.sourceIdentity.integrationChangeId === undefined ? {} : { integrationChangeId: value.sourceIdentity.integrationChangeId }),
    ...(value.sourceIdentity.workingRevision === undefined ? {} : { workingRevision: value.sourceIdentity.workingRevision }),
    payload: {
      relativePath: value.kind === 'comparison' ? 'comparison/review.json' : 'result/review.json',
      bytes: Buffer.byteLength(payload, 'utf8'),
      sha256: crypto.createHash('sha256').update(Buffer.from(payload, 'utf8')).digest('hex'),
    },
  };
}

function installWorkspace(root: MemoryDirectory, value: HumanReviewProjection): void {
  const identity = identityFor(value);
  root.file('identity.json', `${JSON.stringify(identity)}\n`);
  const [directory, file] = identity.payload.relativePath.split('/');
  root.directory(directory!).file(file!, `${JSON.stringify(value)}\n`);
}

function resultProjection(): HumanReviewProjection {
  const evidence: ReviewEvidenceBinding = {
    diffEvidenceId: 'diff-1',
    validationEvidenceId: 'validation-1',
    simulationEvidenceId: 'simulation-1',
    runtimeTraceIds: ['trace-1'],
  };
  const finalResult: ReviewFinalResult = {
    planId: 'plan-1',
    planFingerprint: 'plan-fp',
    integrationChangeId: 'change-1',
    workingRevision: 2,
    diffFingerprint: 'diff-fp',
    changedObjects: [],
    evidence,
    plan: {
      review: {
        reviewState: 'human-reviewed',
        reviewId: 'rev_comparison_1',
        decisionId: 'decision-1',
        decisionFingerprint: 'decision-fp',
      },
      sourceCapsules: [],
      sourceCandidates: [],
      selectedUnitIds: [],
      includedUnitIds: [],
      implicitInclusions: [],
      excludedUnitIds: [],
      conflictResolutions: [],
      deduplicatedUnits: [],
      replayOperations: [],
      provenance: [],
      finalObjectFingerprints: {},
    },
    diff: {
      summary: { createdScenes: 0, modifiedScenes: 0, changedVariables: 0, warnings: [] },
      semantic: [],
      files: [],
    },
    freshness: { diff: 'fresh', validation: 'fresh', simulation: 'fresh', runtime: 'fresh' },
    runtimeTraceObservations: [{ traceId: 'trace-1', observationKeys: ['scene|alpha|0|text|alpha.gal|1|1'] }],
    resultTreeSha256: 'tree-fp',
    warnings: [],
  };
  return projection({
    reviewId: 'rev_result_1',
    kind: 'integration-result',
    state: 'STAGE_READY',
    sourceIdentity: {
      projectIdentity: 'project-1',
      expectedProjectRevision: 'revision-1',
      comparisonFingerprint: 'comparison-fp',
      planFingerprint: 'plan-fp',
      integrationChangeId: 'change-1',
      workingRevision: 2,
      decisionReviewId: 'rev_comparison_1',
      decisionId: 'decision-1',
      decisionFingerprint: 'decision-fp',
    },
    finalResult,
  });
}

describe('Editor review workspace', () => {
  const roots: MemoryDirectory[] = [];

  afterEach(() => {
    roots.splice(0);
  });

  it('loads identity before payload and makes a create-only decision receipt', async () => {
    const root = new MemoryDirectory('review-root');
    roots.push(root);
    const value = projection();
    installWorkspace(root, value);

    const loaded = await openReviewWorkspace(root.handle(), hasher);
    expect(loaded.projection.reviewId).toBe('rev_comparison_1');
    expect(loaded.identity.payload.sha256).toBe(identityFor(value).payload.sha256);
    expect(loaded.decisionDraft).toEqual({
      decisionId: '',
      selectedUnitIds: ['unit-root'],
      conflictResolutions: [],
    });

    const draft: ReviewDecisionDraft = { decisionId: 'decision-1', selectedUnitIds: [], conflictResolutions: [] };
    const first = await writeDecisionReceipt(loaded, draft, '2026-08-27T00:00:00.000Z');
    expect(first.reviewId).toBe(value.reviewId);
    expect((first as unknown as Record<string, unknown>)['actor']).toBeUndefined();
    expect(await writeDecisionReceipt(loaded, draft, '2026-08-27T00:00:00.000Z')).toEqual(first);
    const reopened = await openReviewWorkspace(root.handle(), hasher);
    expect(reopened.receiptStatus).toBe('decision-written');
    expect(reopened.decisionReceipt).toEqual(first);
    expect(reopened.decisionDraft).toEqual({
      decisionId: first.decisionId,
      selectedUnitIds: first.selectedUnitIds,
      conflictResolutions: first.conflictResolutions,
    });
    expect(reopened.decisionReceipt?.decisionFingerprint).toBe(first.decisionFingerprint);
    await expect(writeDecisionReceipt(loaded, { ...draft, decisionId: 'decision-2' }, '2026-08-27T00:00:00.000Z'))
      .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });

  it('treats only an explicit missing receipt as absent and fails loud on corrupt or unreadable receipts', async () => {
    const absentRoot = new MemoryDirectory('absent-receipt-root');
    roots.push(absentRoot);
    installWorkspace(absentRoot, projection());
    const absent = await openReviewWorkspace(absentRoot.handle(), hasher);
    expect(absent.receiptStatus).toBe('none');
    expect(absent.decisionReceipt).toBeNull();

    const corruptRoot = new MemoryDirectory('corrupt-receipt-root');
    roots.push(corruptRoot);
    installWorkspace(corruptRoot, projection());
    corruptRoot.file('decision.json', '{not-json');
    await expect(openReviewWorkspace(corruptRoot.handle(), hasher))
      .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });

    const unreadableRoot = new MemoryDirectory('unreadable-receipt-root');
    roots.push(unreadableRoot);
    installWorkspace(unreadableRoot, projection());
    const unreadable = unreadableRoot.file('decision.json', '{}');
    unreadable.readFailure = new Error('forced receipt read failure');
    await expect(openReviewWorkspace(unreadableRoot.handle(), hasher))
      .rejects.toThrow('forced receipt read failure');
  });

  it.each([
    ['project identity', (receipt: Record<string, unknown>) => { receipt['projectIdentity'] = 'other-project'; }, 'REVIEW_DECISION_STALE'],
    ['decision fingerprint', (receipt: Record<string, unknown>) => { receipt['decisionFingerprint'] = '0'.repeat(64); }, 'REVIEW_DECISION_INVALID'],
  ])('validates a persisted comparison receipt through the shared truth and rejects changed %s', async (_label, mutate, code) => {
    const root = new MemoryDirectory(`changed-${String(_label).replaceAll(' ', '-')}`);
    roots.push(root);
    installWorkspace(root, projection());
    const loaded = await openReviewWorkspace(root.handle(), hasher);
    await writeDecisionReceipt(loaded, {
      decisionId: 'decision-1',
      selectedUnitIds: [],
      conflictResolutions: [],
    }, '2026-08-27T00:00:00.000Z');
    const file = root.entries.get('decision.json') as MemoryFile;
    const receipt = JSON.parse(file.text) as Record<string, unknown>;
    mutate(receipt);
    file.text = `${JSON.stringify(receipt)}\n`;

    await expect(openReviewWorkspace(root.handle(), hasher)).rejects.toMatchObject({ code });
  });

  it('rejects a direct empty decision id without creating decision.json', async () => {
    const root = new MemoryDirectory('empty-decision-root');
    roots.push(root);
    installWorkspace(root, projection());
    const loaded = await openReviewWorkspace(root.handle(), hasher);

    await expect(writeDecisionReceipt(loaded, {
      decisionId: '',
      selectedUnitIds: ['unit-root'],
      conflictResolutions: [],
    }, '2026-08-27T00:00:00.000Z')).rejects.toMatchObject({ code: 'REVIEW_DECISION_INVALID' });
    expect(root.entries.has('decision.json')).toBe(false);
  });

  it.each([
    ['missing options', undefined],
    ['wrong options type', 'not-an-array'],
  ])('fails closed when a comparison conflict has %s', async (_label, options) => {
    const root = new MemoryDirectory(`invalid-comparison-${String(_label).replaceAll(' ', '-')}`);
    roots.push(root);
    const value = projection({
      conflicts: [{
        conflictId: 'conflict-1',
        severity: 'selection-required',
        code: 'OBJECT_RESULTS_DIVERGE',
        unitIds: ['unit-a'],
        candidateIds: ['candidate-a'],
        objectRefs: ['scene:alpha'],
        allowedResolutions: ['choose-unit'],
        repairActions: [],
        options: [],
      }],
    });
    const conflict = value.conflicts[0] as unknown as Record<string, unknown>;
    if (options === undefined) delete conflict['options'];
    else conflict['options'] = options;
    installWorkspace(root, value);

    await expect(openReviewWorkspace(root.handle(), hasher)).rejects.toMatchObject({ code: 'REVIEW_FORMAT_UNSUPPORTED' });
  });

  it('fails closed when a dependency has no human-readable source object', async () => {
    const root = new MemoryDirectory('invalid-dependency-root');
    roots.push(root);
    const value = projection({
      dependencies: [{
        fromUnitId: 'unit-b-scene',
        fromObjectRef: 'scene:wave6_beta',
        toUnitId: 'unit-b-timeline',
        objectRef: 'timeline:wave6_beta_opening',
        inclusion: 'implicit',
      }],
    });
    delete (value.dependencies[0] as unknown as Record<string, unknown>)['fromObjectRef'];
    installWorkspace(root, value);

    await expect(openReviewWorkspace(root.handle(), hasher)).rejects.toMatchObject({ code: 'REVIEW_FORMAT_UNSUPPORTED' });
  });

  it.each([
    ['plan', undefined],
    ['plan', 'not-an-object'],
    ['diff', undefined],
    ['diff', 'not-an-object'],
    ['freshness', undefined],
    ['freshness', 'not-an-object'],
    ['runtimeTraceObservations', undefined],
    ['runtimeTraceObservations', 'not-an-array'],
  ] as const)('fails closed when an integration result has invalid %s', async (field, replacement) => {
    const root = new MemoryDirectory(`invalid-result-${field}-${replacement === undefined ? 'missing' : 'wrong'}`);
    roots.push(root);
    const value = resultProjection();
    const finalResult = value.finalResult as unknown as Record<string, unknown>;
    if (replacement === undefined) delete finalResult[field];
    else finalResult[field] = replacement;
    installWorkspace(root, value);

    await expect(openReviewWorkspace(root.handle(), hasher)).rejects.toMatchObject({ code: 'REVIEW_FORMAT_UNSUPPORTED' });
  });

  it('creates an approval or return receipt, but never both', async () => {
    const root = new MemoryDirectory('result-root');
    roots.push(root);
    const value = resultProjection();
    installWorkspace(root, value);
    const loaded = await openReviewWorkspace(root.handle(), hasher);

    const approval = await writeApprovalReceipt(loaded, { approvalId: 'approval-1' }, '2026-08-27T00:00:00.000Z');
    expect(approval.resultReviewId).toBe(value.reviewId);
    await expect(writeReturnReceipt(loaded, { returnId: 'return-1', reasonCategory: 'content' }, '2026-08-27T00:00:00.000Z'))
      .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
    root.file('return-request.json', JSON.stringify({ returnId: 'return-1' }));
    await expect(openReviewWorkspace(root.handle(), hasher)).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });

  it('allows only one concurrent approval-or-return outcome and persists exactly one terminal receipt', async () => {
    const root = new MemoryDirectory('result-race-root');
    roots.push(root);
    installWorkspace(root, resultProjection());
    const loaded = await openReviewWorkspace(root.handle(), hasher);

    const settled = await Promise.allSettled([
      writeApprovalReceipt(loaded, { approvalId: 'approval-race' }, '2026-08-30T00:00:00.000Z'),
      writeReturnReceipt(loaded, { returnId: 'return-race', reasonCategory: 'other' }, '2026-08-30T00:00:00.000Z'),
    ]);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
    expect(Number(root.entries.has('final-approval.json')) + Number(root.entries.has('return-request.json'))).toBe(1);
  });

  it('reopens and verifies a persisted approval identity without rewriting its bytes', async () => {
    const root = new MemoryDirectory('approved-reopen-root');
    roots.push(root);
    installWorkspace(root, resultProjection());
    const loaded = await openReviewWorkspace(root.handle(), hasher);
    const approval = await writeApprovalReceipt(loaded, { approvalId: 'approval-reopen' }, '2026-08-30T00:00:00.000Z');
    const approvalFile = root.entries.get('final-approval.json') as MemoryFile;
    const bytesBefore = approvalFile.text;

    const reopened = await openReviewWorkspace(root.handle(), hasher) as ReviewWorkspaceState & {
      approvalReceipt: FinalApprovalReceipt | null;
      returnReceipt: ReturnRequestReceipt | null;
    };
    expect(reopened.receiptStatus).toBe('approval-written');
    expect(reopened.approvalReceipt).toEqual(approval);
    expect(reopened.returnReceipt).toBeNull();
    expect(approvalFile.text).toBe(bytesBefore);
  });

  it('reopens and verifies a persisted return identity without rewriting its bytes', async () => {
    const root = new MemoryDirectory('returned-reopen-root');
    roots.push(root);
    installWorkspace(root, resultProjection());
    const loaded = await openReviewWorkspace(root.handle(), hasher);
    const returned = await writeReturnReceipt(loaded, { returnId: 'return-reopen', reasonCategory: 'content' }, '2026-08-30T00:00:00.000Z');
    const returnFile = root.entries.get('return-request.json') as MemoryFile;
    const bytesBefore = returnFile.text;

    const reopened = await openReviewWorkspace(root.handle(), hasher) as ReviewWorkspaceState & {
      approvalReceipt: FinalApprovalReceipt | null;
      returnReceipt: ReturnRequestReceipt | null;
    };
    expect(reopened.receiptStatus).toBe('returned');
    expect(reopened.approvalReceipt).toBeNull();
    expect(reopened.returnReceipt).toEqual(returned);
    expect(returnFile.text).toBe(bytesBefore);
  });

  it.each([
    ['approval fingerprint', 'final-approval.json', 'REVIEW_DECISION_INVALID', async (loaded: ReviewWorkspaceState) => {
      const receipt = await writeApprovalReceipt(loaded, { approvalId: 'approval-corrupt' }, '2026-08-30T00:00:00.000Z');
      return { ...receipt, approvalFingerprint: '0'.repeat(64) };
    }],
    ['return fingerprint', 'return-request.json', 'REVIEW_IDENTITY_MISMATCH', async (loaded: ReviewWorkspaceState) => {
      const receipt = await writeReturnReceipt(loaded, { returnId: 'return-corrupt', reasonCategory: 'content' }, '2026-08-30T00:00:00.000Z');
      return { ...receipt, returnFingerprint: '0'.repeat(64) };
    }],
    ['return reason category', 'return-request.json', 'REVIEW_IDENTITY_MISMATCH', async (loaded: ReviewWorkspaceState) => {
      const receipt = await writeReturnReceipt(loaded, { returnId: 'return-category', reasonCategory: 'content' }, '2026-08-30T00:00:00.000Z');
      return { ...receipt, reasonCategory: 'unknown-category' };
    }],
  ] as const)('fails loud when a persisted result receipt has a corrupt %s', async (_label, fileName, expectedCode, corrupt) => {
    const root = new MemoryDirectory(`corrupt-result-${_label.replaceAll(' ', '-')}`);
    roots.push(root);
    installWorkspace(root, resultProjection());
    const loaded = await openReviewWorkspace(root.handle(), hasher);
    const invalid = await corrupt(loaded);
    (root.entries.get(fileName) as MemoryFile).text = `${JSON.stringify(invalid)}\n`;

    await expect(openReviewWorkspace(root.handle(), hasher))
      .rejects.toMatchObject({ code: expectedCode });
  });

  it('fails closed on payload identity, missing project identity and unsupported version changes', async () => {
    const root = new MemoryDirectory('invalid-root');
    roots.push(root);
    const value = projection();
    installWorkspace(root, value);
    const identity = root.entries.get('identity.json') as MemoryFile;
    identity.text = identity.text.replace('"1.0.0"', '"9.0.0"');
    await expect(openReviewWorkspace(root.handle(), hasher)).rejects.toMatchObject({ code: 'REVIEW_FORMAT_UNSUPPORTED' });

    const mismatchRoot = new MemoryDirectory('mismatch-root');
    roots.push(mismatchRoot);
    installWorkspace(mismatchRoot, value);
    const mismatchPayload = mismatchRoot.entries.get('comparison') as MemoryDirectory;
    mismatchPayload.entries.set('review.json', new MemoryFile('review.json', '{}'));
    await expect(openReviewWorkspace(mismatchRoot.handle(), hasher)).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });

    const missingProjectRoot = new MemoryDirectory('missing-project-root');
    roots.push(missingProjectRoot);
    installWorkspace(missingProjectRoot, value);
    const missingProjectIdentity = missingProjectRoot.entries.get('identity.json') as MemoryFile;
    missingProjectIdentity.text = missingProjectIdentity.text.replace('"project-1"', '""');
    await expect(openReviewWorkspace(missingProjectRoot.handle(), hasher)).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });
});
