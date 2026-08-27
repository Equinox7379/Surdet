import * as crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  HumanReviewProjection,
  ReviewEvidenceBinding,
  ReviewFinalResult,
  TextHasher,
} from '@surdet/authoring';
import {
  openReviewWorkspace,
  writeApprovalReceipt,
  writeDecisionReceipt,
  writeReturnReceipt,
  type ReviewDecisionDraft,
  type ReviewWorkspaceIdentity,
} from '../src/review-workspace.js';

type MemoryNode = MemoryDirectory | MemoryFile;

class MemoryFile {
  readonly kind = 'file' as const;
  constructor(readonly name: string, public text: string) {}

  handle(): FileSystemFileHandle {
    return {
      kind: 'file',
      name: this.name,
      isSameEntry: async () => false,
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getFile: async () => ({
        name: this.name,
        size: Buffer.byteLength(this.text, 'utf8'),
        text: async () => this.text,
        arrayBuffer: async () => Uint8Array.from(Buffer.from(this.text, 'utf8')).buffer,
      }) as unknown as File,
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
        throw new Error(`missing directory ${name}`);
      },
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        const existing = this.entries.get(name);
        if (existing?.kind === 'file') return existing.handle();
        if (options?.create) return this.file(name, '').handle();
        throw new Error(`missing file ${name}`);
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

    const draft: ReviewDecisionDraft = { decisionId: 'decision-1', selectedUnitIds: [], conflictResolutions: [] };
    const first = await writeDecisionReceipt(loaded, draft, '2026-08-27T00:00:00.000Z');
    expect(first.reviewId).toBe(value.reviewId);
    expect((first as unknown as Record<string, unknown>)['actor']).toBeUndefined();
    expect(await writeDecisionReceipt(loaded, draft, '2026-08-27T00:00:00.000Z')).toEqual(first);
    const reopened = await openReviewWorkspace(root.handle(), hasher);
    expect(reopened.decisionDraft.decisionId).toBe('decision-1');
    await expect(writeDecisionReceipt(loaded, { ...draft, decisionId: 'decision-2' }, '2026-08-27T00:00:00.000Z'))
      .rejects.toMatchObject({ code: 'REVIEW_IDENTITY_MISMATCH' });
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
