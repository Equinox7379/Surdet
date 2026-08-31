import * as crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ComparisonDecisionReceipt,
  FinalApprovalReceipt,
  HumanReviewProjection,
  ReviewEvidenceBinding,
  ReviewFinalResult,
  ReviewTerminalCommand,
  ReviewTerminalSnapshot,
  ReturnRequestReceipt,
  TextHasher,
} from '@surdet/authoring';
import {
  approvalFingerprintOf,
  decisionFingerprintOf,
  returnFingerprintOf,
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
import {
  ReviewAuthorityClientError,
  type ReviewTerminalClient,
  type ReviewTerminalDescribeInput,
} from '../src/review-terminal-client.js';

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

function receiptFingerprint(action: ReviewTerminalCommand['action'], receipt: unknown): string | null {
  if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt)) return null;
  const field = action === 'comparison-decision'
    ? 'decisionFingerprint'
    : action === 'result-approval' ? 'approvalFingerprint' : 'returnFingerprint';
  const value = (receipt as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

class MemoryReviewTerminalAuthority implements ReviewTerminalClient {
  readonly commands: ReviewTerminalCommand[] = [];
  private readonly snapshots = new Map<string, ReviewTerminalSnapshot>();

  constructor(private readonly availability: 'available' | 'unavailable' = 'available') {}

  private key(value: { projectIdentity: string; reviewId: string }): string {
    return `${value.projectIdentity}\u0000${value.reviewId}`;
  }

  private base(value: { projectIdentity: string; reviewId: string }): ReviewTerminalSnapshot {
    return {
      protocolVersion: '1.0.0',
      projectIdentity: value.projectIdentity,
      reviewId: value.reviewId,
      state: 'open',
    };
  }

  seed(snapshot: ReviewTerminalSnapshot): void {
    this.snapshots.set(this.key(snapshot), snapshot);
  }

  async status(): Promise<'available' | 'unavailable'> {
    return this.availability;
  }

  async describe(input: ReviewTerminalDescribeInput): Promise<ReviewTerminalSnapshot> {
    if (this.availability !== 'available') {
      throw new ReviewAuthorityClientError('REVIEW_AUTHORITY_UNAVAILABLE', '本机审阅服务未连接。');
    }
    return this.snapshots.get(this.key(input)) ?? this.base(input);
  }

  async write(command: ReviewTerminalCommand): Promise<ReviewTerminalSnapshot> {
    if (this.availability !== 'available') {
      throw new ReviewAuthorityClientError('REVIEW_AUTHORITY_UNAVAILABLE', '本机审阅服务未连接。');
    }
    this.commands.push(command);
    const key = this.key(command);
    const existing = this.snapshots.get(key);
    if (existing !== undefined && existing.state !== 'open') {
      const existingFingerprint = existing.record === undefined
        ? null
        : receiptFingerprint(existing.record.action, existing.record.receipt);
      const incomingFingerprint = receiptFingerprint(command.action, command.receipt);
      if (existing.record?.action === command.action && existingFingerprint === incomingFingerprint) return existing;
      throw new ReviewAuthorityClientError('REVIEW_TERMINAL_ALREADY_SET', '该审阅已经保存了另一份正式回执。');
    }
    const file = command.action === 'comparison-decision'
      ? 'decision.json'
      : command.action === 'result-approval' ? 'final-approval.json' : 'return-request.json';
    const state = command.action === 'comparison-decision'
      ? 'decision-written'
      : command.action === 'result-approval' ? 'approval-written' : 'returned';
    const text = `${JSON.stringify(command.receipt, null, 2)}\n`;
    const snapshot: ReviewTerminalSnapshot = {
      protocolVersion: '1.0.0',
      projectIdentity: command.projectIdentity,
      reviewId: command.reviewId,
      state,
      record: {
        action: command.action,
        file,
        bytes: Buffer.byteLength(text, 'utf8'),
        sha256: crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
        receipt: command.receipt,
      },
    };
    this.snapshots.set(key, snapshot);
    return snapshot;
  }
}

const authorities = new WeakMap<MemoryDirectory, MemoryReviewTerminalAuthority>();

function authorityFor(root: MemoryDirectory): MemoryReviewTerminalAuthority {
  const existing = authorities.get(root);
  if (existing !== undefined) return existing;
  const authority = new MemoryReviewTerminalAuthority();
  authorities.set(root, authority);
  return authority;
}

function openWorkspace(
  root: MemoryDirectory,
  terminalClient: ReviewTerminalClient = authorityFor(root),
): Promise<ReviewWorkspaceState> {
  return openReviewWorkspace(root.handle(), hasher, terminalClient);
}

async function decisionReceiptFor(
  value: HumanReviewProjection,
  draft: ReviewDecisionDraft,
  now: string,
): Promise<ComparisonDecisionReceipt> {
  const unsigned: Omit<ComparisonDecisionReceipt, 'decisionFingerprint'> = {
    receiptVersion: '1.0.0',
    decisionId: draft.decisionId,
    reviewId: value.reviewId,
    comparisonFingerprint: value.sourceIdentity.comparisonFingerprint,
    projectIdentity: value.projectIdentity,
    expectedProjectRevision: value.expectedProjectRevision,
    candidateRefs: value.candidates.map((candidate) => ({ ...candidate.ref })),
    selectedUnitIds: [...draft.selectedUnitIds],
    conflictResolutions: draft.conflictResolutions.map((resolution) => ({ ...resolution })),
    reviewerChannel: 'surdet-editor-local',
    decidedAt: now,
  };
  return { ...unsigned, decisionFingerprint: await decisionFingerprintOf(unsigned, hasher) };
}

async function approvalReceiptFor(
  value: HumanReviewProjection,
  approvalId: string,
  now: string,
): Promise<FinalApprovalReceipt> {
  const finalResult = value.finalResult!;
  const unsigned: Omit<FinalApprovalReceipt, 'approvalFingerprint'> = {
    receiptVersion: '1.0.0',
    approvalId,
    resultReviewId: value.reviewId,
    decisionFingerprint: value.sourceIdentity.decisionFingerprint!,
    planId: finalResult.planId,
    planFingerprint: finalResult.planFingerprint,
    integrationChangeId: finalResult.integrationChangeId,
    workingRevision: finalResult.workingRevision,
    projectIdentity: value.projectIdentity,
    expectedProjectRevision: value.expectedProjectRevision,
    diffFingerprint: finalResult.diffFingerprint,
    evidence: { ...finalResult.evidence, runtimeTraceIds: [...finalResult.evidence.runtimeTraceIds] },
    resultTreeSha256: finalResult.resultTreeSha256,
    reviewerChannel: 'surdet-editor-local',
    approvedAt: now,
  };
  return { ...unsigned, approvalFingerprint: await approvalFingerprintOf(unsigned, hasher) };
}

async function returnReceiptFor(
  value: HumanReviewProjection,
  returnId: string,
  reasonCategory: ReturnRequestReceipt['reasonCategory'],
  now: string,
): Promise<ReturnRequestReceipt> {
  const finalResult = value.finalResult!;
  const unsigned: Omit<ReturnRequestReceipt, 'returnFingerprint'> = {
    receiptVersion: '1.0.0',
    returnId,
    resultReviewId: value.reviewId,
    planId: finalResult.planId,
    planFingerprint: finalResult.planFingerprint,
    integrationChangeId: finalResult.integrationChangeId,
    workingRevision: finalResult.workingRevision,
    reasonCategory,
    reviewerChannel: 'surdet-editor-local',
    returnedAt: now,
  };
  return { ...unsigned, returnFingerprint: await returnFingerprintOf(unsigned, hasher) };
}

function installReceipt(root: MemoryDirectory, fileName: string, receipt: unknown): void {
  root.file(fileName, `${JSON.stringify(receipt)}\n`);
}

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

  it('keeps a locally readable workspace read-only when the authority is unavailable', async () => {
    const root = new MemoryDirectory('authority-unavailable-root');
    roots.push(root);
    installWorkspace(root, projection());
    const unavailableClient = new MemoryReviewTerminalAuthority('unavailable');
    const loaded = await openReviewWorkspace(root.handle(), hasher, unavailableClient);
    expect(loaded.projection.reviewId).toBe('rev_comparison_1');
    expect(loaded.authority).toEqual({
      state: 'unavailable',
      message: '本机审阅服务未连接。内容仍可查看，但暂时不能批准或退回。请从 Surdet 正常入口重新打开。',
    });
    await expect(writeDecisionReceipt(loaded, {
      decisionId: 'decision-must-not-write',
      selectedUnitIds: [],
      conflictResolutions: [],
    }, '2026-09-01T00:00:00.000Z')).rejects.toMatchObject({ code: 'REVIEW_AUTHORITY_UNAVAILABLE' });
    expect(root.entries.has('decision.json')).toBe(false);
  });

  it('loads identity before payload and writes a decision through the fake authority', async () => {
    const root = new MemoryDirectory('review-root');
    roots.push(root);
    const value = projection();
    installWorkspace(root, value);
    const authority = authorityFor(root);

    const loaded = await openWorkspace(root, authority);
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
    expect(root.entries.has('decision.json')).toBe(false);
    const reopened = await openWorkspace(root, authority);
    expect(reopened.receiptStatus).toBe('decision-written');
    expect(reopened.decisionReceipt).toEqual(first);
    expect(reopened.decisionDraft).toEqual({
      decisionId: first.decisionId,
      selectedUnitIds: first.selectedUnitIds,
      conflictResolutions: first.conflictResolutions,
    });
    expect(reopened.decisionReceipt?.decisionFingerprint).toBe(first.decisionFingerprint);
    await expect(writeDecisionReceipt(loaded, { ...draft, decisionId: 'decision-2' }, '2026-08-27T00:00:00.000Z'))
      .rejects.toMatchObject({ code: 'REVIEW_TERMINAL_ALREADY_SET' });
  });

  it('treats only an explicit missing receipt as absent and fails loud on corrupt or unreadable receipts', async () => {
    const absentRoot = new MemoryDirectory('absent-receipt-root');
    roots.push(absentRoot);
    installWorkspace(absentRoot, projection());
    const absent = await openWorkspace(absentRoot);
    expect(absent.receiptStatus).toBe('none');
    expect(absent.decisionReceipt).toBeNull();

    const corruptRoot = new MemoryDirectory('corrupt-receipt-root');
    roots.push(corruptRoot);
    installWorkspace(corruptRoot, projection());
    corruptRoot.file('decision.json', '{not-json');
    await expect(openWorkspace(corruptRoot))
      .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });

    const unreadableRoot = new MemoryDirectory('unreadable-receipt-root');
    roots.push(unreadableRoot);
    installWorkspace(unreadableRoot, projection());
    const unreadable = unreadableRoot.file('decision.json', '{}');
    unreadable.readFailure = new Error('forced receipt read failure');
    await expect(openWorkspace(unreadableRoot))
      .rejects.toThrow('forced receipt read failure');
  });

  it.each([
    ['project identity', (receipt: Record<string, unknown>) => { receipt['projectIdentity'] = 'other-project'; }, 'REVIEW_DECISION_STALE'],
    ['decision fingerprint', (receipt: Record<string, unknown>) => { receipt['decisionFingerprint'] = '0'.repeat(64); }, 'REVIEW_DECISION_INVALID'],
  ])('validates a persisted comparison receipt through the shared truth and rejects changed %s', async (_label, mutate, code) => {
    const root = new MemoryDirectory(`changed-${String(_label).replaceAll(' ', '-')}`);
    roots.push(root);
    installWorkspace(root, projection());
    const value = projection();
    const receipt = await decisionReceiptFor(value, {
      decisionId: 'decision-1',
      selectedUnitIds: [],
      conflictResolutions: [],
    }, '2026-08-27T00:00:00.000Z');
    installReceipt(root, 'decision.json', receipt);
    const file = root.entries.get('decision.json') as MemoryFile;
    const persisted = JSON.parse(file.text) as Record<string, unknown>;
    mutate(persisted);
    file.text = `${JSON.stringify(persisted)}\n`;

    await expect(openWorkspace(root)).rejects.toMatchObject({ code });
  });

  it('rejects a direct empty decision id without creating decision.json', async () => {
    const root = new MemoryDirectory('empty-decision-root');
    roots.push(root);
    installWorkspace(root, projection());
    const loaded = await openWorkspace(root);

    await expect(writeDecisionReceipt(loaded, {
      decisionId: '',
      selectedUnitIds: ['unit-root'],
      conflictResolutions: [],
    }, '2026-08-27T00:00:00.000Z')).rejects.toMatchObject({ code: 'REVIEW_DECISION_INVALID' });
    expect(root.entries.has('decision.json')).toBe(false);
  });

  it('locks a local receipt when the authority has a different canonical terminal', async () => {
    const root = new MemoryDirectory('authority-mismatch-root');
    roots.push(root);
    const value = projection();
    installWorkspace(root, value);
    const localReceipt = await decisionReceiptFor(value, {
      decisionId: 'local-decision',
      selectedUnitIds: [],
      conflictResolutions: [],
    }, '2026-08-27T00:00:00.000Z');
    installReceipt(root, 'decision.json', localReceipt);

    const authority = authorityFor(root);
    const canonicalReceipt = await decisionReceiptFor(value, {
      decisionId: 'canonical-decision',
      selectedUnitIds: [],
      conflictResolutions: [],
    }, '2026-08-27T00:00:01.000Z');
    const text = `${JSON.stringify(canonicalReceipt, null, 2)}\n`;
    authority.seed({
      protocolVersion: '1.0.0',
      projectIdentity: value.projectIdentity,
      reviewId: value.reviewId,
      state: 'decision-written',
      record: {
        action: 'comparison-decision',
        file: 'decision.json',
        bytes: Buffer.byteLength(text, 'utf8'),
        sha256: crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
        receipt: canonicalReceipt,
      },
    });

    const loaded = await openWorkspace(root, authority);
    expect(loaded.authority).toEqual({
      state: 'mismatch',
      message: '本机审阅服务与当前审阅任务不一致。内容仍可查看，但终态操作已锁定。请从 Surdet 正常入口重新打开。',
    });
    expect(loaded.decisionReceipt).toEqual(localReceipt);
    await expect(writeDecisionReceipt(loaded, {
      decisionId: 'local-decision',
      selectedUnitIds: [],
      conflictResolutions: [],
    }, '2026-08-27T00:00:00.000Z')).rejects.toMatchObject({ code: 'REVIEW_TERMINAL_ALREADY_SET' });
  });

  it('keeps the projection readable but locks writes for a corrupt authority receipt', async () => {
    const root = new MemoryDirectory('authority-corrupt-root');
    roots.push(root);
    const value = projection();
    installWorkspace(root, value);
    const authority = authorityFor(root);
    const valid = await decisionReceiptFor(value, {
      decisionId: 'corrupt-authority-decision',
      selectedUnitIds: [],
      conflictResolutions: [],
    }, '2026-08-27T00:00:00.000Z');
    const corrupt = { ...valid, decisionFingerprint: '0'.repeat(64) };
    const text = `${JSON.stringify(corrupt, null, 2)}\n`;
    authority.seed({
      protocolVersion: '1.0.0',
      projectIdentity: value.projectIdentity,
      reviewId: value.reviewId,
      state: 'decision-written',
      record: {
        action: 'comparison-decision',
        file: 'decision.json',
        bytes: Buffer.byteLength(text, 'utf8'),
        sha256: crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
        receipt: corrupt,
      },
    });

    const loaded = await openWorkspace(root, authority);
    expect(loaded.projection.reviewId).toBe(value.reviewId);
    expect(loaded.receiptStatus).toBe('none');
    expect(loaded.authority.state).toBe('corrupt');
    await expect(writeDecisionReceipt(loaded, {
      decisionId: 'must-not-write',
      selectedUnitIds: [],
      conflictResolutions: [],
    }, '2026-08-27T00:00:01.000Z')).rejects.toMatchObject({ code: 'REVIEW_TERMINAL_ALREADY_SET' });
  });

  it('reuses the exact pending approval receipt after an uncertain response', async () => {
    const root = new MemoryDirectory('authority-uncertain-approval-root');
    roots.push(root);
    installWorkspace(root, resultProjection());
    const commands: ReviewTerminalCommand[] = [];
    const uncertainClient: ReviewTerminalClient = {
      status: async () => 'available',
      describe: async (input) => ({
        protocolVersion: '1.0.0',
        projectIdentity: input.projectIdentity,
        reviewId: input.reviewId,
        state: 'open',
      }),
      write: async (command) => {
        commands.push(command);
        throw new ReviewAuthorityClientError('REVIEW_BUSY', '请稍候');
      },
    };
    const loaded = await openWorkspace(root, uncertainClient);

    await expect(writeApprovalReceipt(loaded, { approvalId: 'approval-first' }, '2026-09-01T00:00:00.000Z'))
      .rejects.toMatchObject({ code: 'REVIEW_BUSY' });
    await expect(writeApprovalReceipt(loaded, { approvalId: 'approval-second' }, '2026-09-01T00:00:01.000Z'))
      .rejects.toMatchObject({ code: 'REVIEW_BUSY' });

    expect(commands).toHaveLength(2);
    expect(commands[1]?.requestId).toBe(commands[0]?.requestId);
    expect(commands[1]?.receipt).toEqual(commands[0]?.receipt);
  });

  it('rejects approval before authority submission when the result fixture changed', async () => {
    const root = new MemoryDirectory('authority-stale-result-root');
    roots.push(root);
    installWorkspace(root, resultProjection());
    const authority = authorityFor(root);
    const loaded = await openWorkspace(root, authority);
    loaded.fixtureChanged = true;

    await expect(writeApprovalReceipt(loaded, { approvalId: 'approval-stale' }, '2026-09-01T00:00:00.000Z'))
      .rejects.toMatchObject({ code: 'REVIEW_APPROVAL_STALE' });
    expect(authority.commands).toHaveLength(0);
  });

  it('treats a canonical receipt with mismatched bytes or SHA as corrupt', async () => {
    const root = new MemoryDirectory('authority-record-identity-root');
    roots.push(root);
    const value = projection();
    installWorkspace(root, value);
    const receipt = await decisionReceiptFor(value, {
      decisionId: 'record-identity-decision',
      selectedUnitIds: [],
      conflictResolutions: [],
    }, '2026-09-01T00:00:00.000Z');
    const authority = authorityFor(root);
    authority.seed({
      protocolVersion: '1.0.0',
      projectIdentity: value.projectIdentity,
      reviewId: value.reviewId,
      state: 'decision-written',
      record: {
        action: 'comparison-decision',
        file: 'decision.json',
        bytes: 1,
        sha256: '0'.repeat(64),
        receipt,
      },
    });

    const loaded = await openWorkspace(root, authority);
    expect(loaded.projection.reviewId).toBe(value.reviewId);
    expect(loaded.authority.state).toBe('corrupt');
    expect(loaded.receiptStatus).toBe('none');
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

    await expect(openWorkspace(root)).rejects.toMatchObject({ code: 'REVIEW_FORMAT_UNSUPPORTED' });
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

    await expect(openWorkspace(root)).rejects.toMatchObject({ code: 'REVIEW_FORMAT_UNSUPPORTED' });
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

    await expect(openWorkspace(root)).rejects.toMatchObject({ code: 'REVIEW_FORMAT_UNSUPPORTED' });
  });

  it('creates an approval or return receipt, but never both', async () => {
    const root = new MemoryDirectory('result-root');
    roots.push(root);
    const value = resultProjection();
    installWorkspace(root, value);
    const authority = authorityFor(root);
    const loaded = await openWorkspace(root, authority);

    const approval = await writeApprovalReceipt(loaded, { approvalId: 'approval-1' }, '2026-08-27T00:00:00.000Z');
    expect(approval.resultReviewId).toBe(value.reviewId);
    expect(root.entries.has('final-approval.json')).toBe(false);
    await expect(writeReturnReceipt(loaded, { returnId: 'return-1', reasonCategory: 'content' }, '2026-08-27T00:00:00.000Z'))
      .rejects.toMatchObject({ code: 'REVIEW_TERMINAL_ALREADY_SET' });
    installReceipt(root, 'return-request.json', { returnId: 'return-1' });
    await expect(openWorkspace(root, new MemoryReviewTerminalAuthority()))
      .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });

  it('allows only one concurrent approval-or-return outcome and persists exactly one terminal receipt', async () => {
    const root = new MemoryDirectory('result-race-root');
    roots.push(root);
    installWorkspace(root, resultProjection());
    const loaded = await openWorkspace(root);

    const settled = await Promise.allSettled([
      writeApprovalReceipt(loaded, { approvalId: 'approval-race' }, '2026-08-30T00:00:00.000Z'),
      writeReturnReceipt(loaded, { returnId: 'return-race', reasonCategory: 'other' }, '2026-08-30T00:00:00.000Z'),
    ]);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: 'REVIEW_BUSY' });
    expect(Number(root.entries.has('final-approval.json')) + Number(root.entries.has('return-request.json'))).toBe(0);
    const canonical = await authorityFor(root).describe({
      projectIdentity: 'project-1',
      reviewId: 'rev_result_1',
      reviewPayload: identityFor(resultProjection()).payload,
    });
    expect(['approval-written', 'returned']).toContain(canonical.state);
  });

  it('reopens and verifies a persisted approval identity without rewriting its bytes', async () => {
    const root = new MemoryDirectory('approved-reopen-root');
    roots.push(root);
    installWorkspace(root, resultProjection());
    const authority = authorityFor(root);
    const loaded = await openWorkspace(root, authority);
    const approval = await writeApprovalReceipt(loaded, { approvalId: 'approval-reopen' }, '2026-08-30T00:00:00.000Z');
    expect(root.entries.has('final-approval.json')).toBe(false);

    const reopened = await openWorkspace(root, authority) as ReviewWorkspaceState & {
      approvalReceipt: FinalApprovalReceipt | null;
      returnReceipt: ReturnRequestReceipt | null;
    };
    expect(reopened.receiptStatus).toBe('approval-written');
    expect(reopened.approvalReceipt).toEqual(approval);
    expect(reopened.returnReceipt).toBeNull();
    expect(root.entries.has('final-approval.json')).toBe(false);
  });

  it('reopens and verifies a persisted return identity without rewriting its bytes', async () => {
    const root = new MemoryDirectory('returned-reopen-root');
    roots.push(root);
    installWorkspace(root, resultProjection());
    const authority = authorityFor(root);
    const loaded = await openWorkspace(root, authority);
    const returned = await writeReturnReceipt(loaded, { returnId: 'return-reopen', reasonCategory: 'content' }, '2026-08-30T00:00:00.000Z');
    expect(root.entries.has('return-request.json')).toBe(false);

    const reopened = await openWorkspace(root, authority) as ReviewWorkspaceState & {
      approvalReceipt: FinalApprovalReceipt | null;
      returnReceipt: ReturnRequestReceipt | null;
    };
    expect(reopened.receiptStatus).toBe('returned');
    expect(reopened.approvalReceipt).toBeNull();
    expect(reopened.returnReceipt).toEqual(returned);
    expect(root.entries.has('return-request.json')).toBe(false);
  });

  it.each([
    ['approval fingerprint', 'final-approval.json', 'REVIEW_DECISION_INVALID', async (value: HumanReviewProjection) => {
      const receipt = await approvalReceiptFor(value, 'approval-corrupt', '2026-08-30T00:00:00.000Z');
      return { ...receipt, approvalFingerprint: '0'.repeat(64) };
    }],
    ['return fingerprint', 'return-request.json', 'REVIEW_IDENTITY_MISMATCH', async (value: HumanReviewProjection) => {
      const receipt = await returnReceiptFor(value, 'return-corrupt', 'content', '2026-08-30T00:00:00.000Z');
      return { ...receipt, returnFingerprint: '0'.repeat(64) };
    }],
    ['return reason category', 'return-request.json', 'REVIEW_IDENTITY_MISMATCH', async (value: HumanReviewProjection) => {
      const receipt = await returnReceiptFor(value, 'return-category', 'content', '2026-08-30T00:00:00.000Z');
      return { ...receipt, reasonCategory: 'unknown-category' };
    }],
  ] as const)('fails loud when a persisted result receipt has a corrupt %s', async (_label, fileName, expectedCode, corrupt) => {
    const root = new MemoryDirectory(`corrupt-result-${_label.replaceAll(' ', '-')}`);
    roots.push(root);
    const value = resultProjection();
    installWorkspace(root, value);
    const invalid = await corrupt(value);
    installReceipt(root, fileName, invalid);

    await expect(openWorkspace(root))
      .rejects.toMatchObject({ code: expectedCode });
  });

  it('fails closed on payload identity, missing project identity and unsupported version changes', async () => {
    const root = new MemoryDirectory('invalid-root');
    roots.push(root);
    const value = projection();
    installWorkspace(root, value);
    const identity = root.entries.get('identity.json') as MemoryFile;
    identity.text = identity.text.replace('"1.0.0"', '"9.0.0"');
    await expect(openWorkspace(root)).rejects.toMatchObject({ code: 'REVIEW_FORMAT_UNSUPPORTED' });

    const mismatchRoot = new MemoryDirectory('mismatch-root');
    roots.push(mismatchRoot);
    installWorkspace(mismatchRoot, value);
    const mismatchPayload = mismatchRoot.entries.get('comparison') as MemoryDirectory;
    mismatchPayload.entries.set('review.json', new MemoryFile('review.json', '{}'));
    await expect(openWorkspace(mismatchRoot)).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });

    const missingProjectRoot = new MemoryDirectory('missing-project-root');
    roots.push(missingProjectRoot);
    installWorkspace(missingProjectRoot, value);
    const missingProjectIdentity = missingProjectRoot.entries.get('identity.json') as MemoryFile;
    missingProjectIdentity.text = missingProjectIdentity.text.replace('"project-1"', '""');
    await expect(openWorkspace(missingProjectRoot)).rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
  });
});
