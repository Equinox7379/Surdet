import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { HumanReviewProjection } from '@surdet/authoring';
import {
  buildReviewPreviewRequest,
  hashReviewFixtureTree,
  reconcileReviewTraceEvidence,
  selectReviewPreviewScene,
} from '../src/review-preview.js';

class MemoryFile {
  readonly kind = 'file' as const;
  constructor(readonly name: string, readonly bytes: Uint8Array) {}
  handle(): FileSystemFileHandle {
    return { kind: 'file', name: this.name, getFile: () => this.getFile() } as unknown as FileSystemFileHandle;
  }
  async getFile(): Promise<{
    name: string;
    size: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  }> {
    return {
      name: this.name,
      size: this.bytes.byteLength,
      arrayBuffer: async () => this.bytes.slice().buffer,
    };
  }
}

class MemoryDirectory {
  readonly kind = 'directory' as const;
  readonly entries = new Map<string, MemoryDirectory | MemoryFile>();
  constructor(readonly name: string) {}
  file(name: string, text: string): this {
    this.entries.set(name, new MemoryFile(name, new TextEncoder().encode(text)));
    return this;
  }
  directory(name: string): MemoryDirectory {
    const child = new MemoryDirectory(name);
    this.entries.set(name, child);
    return child;
  }
  handle(): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name: this.name,
      values: async function* (this: MemoryDirectory) {
        for (const value of this.entries.values()) yield value.handle();
      }.bind(this),
    } as unknown as FileSystemDirectoryHandle;
  }
}

const bytesHasher = async (bytes: Uint8Array): Promise<string> => crypto.createHash('sha256').update(bytes).digest('hex');

function projection(): HumanReviewProjection {
  return {
    reviewVersion: '1.0.0', reviewId: 'review-result', kind: 'integration-result', state: 'STAGE_READY',
    projectIdentity: 'project-1', expectedProjectRevision: 'revision-1',
    task: { title: 'result', acceptanceCriteria: [], candidateCount: 1, objectCount: 1, conflictCount: 0, statementSource: 'generated-fallback' },
    candidates: [], safeGroups: [], conflicts: [], dependencies: [],
    evidence: { candidateMatrix: [], blockingCount: 0, selectionRequiredCount: 0, advisoryCount: 0, canCreateDecision: true },
    objects: [{ objectRef: 'scene:wave6_alpha', kind: 'scene', references: [], referencedBy: [], potentialImpact: [], observedImpact: [] }],
    sourceIdentity: { projectIdentity: 'project-1', expectedProjectRevision: 'revision-1', comparisonFingerprint: 'comparison-fp' },
    reviewFingerprint: 'review-fp',
    finalResult: {
      planId: 'plan-1', planFingerprint: 'plan-fp', integrationChangeId: 'change-1', workingRevision: 2,
      diffFingerprint: 'diff-fp', changedObjects: [],
      evidence: { diffEvidenceId: 'diff-1', validationEvidenceId: 'validation-1', simulationEvidenceId: 'simulation-1', runtimeTraceIds: ['trace-1', 'trace-2'] },
      resultTreeSha256: 'tree-fp', warnings: [],
    },
  };
}

describe('review result preview', () => {
  it('selects the first runnable changed scene while respecting explicit scene, choices, and timeline requests', () => {
    const value = projection();
    expect(selectReviewPreviewScene(['fallback', 'wave6_alpha'], value, undefined)).toBe('wave6_alpha');
    expect(selectReviewPreviewScene(['fallback', 'wave6_alpha'], value, 'fallback')).toBe('fallback');
    expect(buildReviewPreviewRequest(value, { sceneId: 'wave6_alpha', choices: { 'choice-1': 'a' }, timelineId: 'timeline-1' }))
      .toEqual({ sceneId: 'wave6_alpha', choices: { 'choice-1': 'a' }, timelineId: 'timeline-1' });
  });

  it('hashes the fixture tree by sorted relative file identities, independent of enumeration order', async () => {
    const first = new MemoryDirectory('project').file('b.txt', 'B').file('a.txt', 'A');
    const second = new MemoryDirectory('project').file('a.txt', 'A').file('b.txt', 'B');
    expect(await hashReviewFixtureTree(first.handle(), bytesHasher)).toBe(await hashReviewFixtureTree(second.handle(), bytesHasher));
    second.file('b.txt', 'changed');
    expect(await hashReviewFixtureTree(first.handle(), bytesHasher)).not.toBe(await hashReviewFixtureTree(second.handle(), bytesHasher));
  });

  it('matches observed runtime trace IDs against result evidence without inventing observations', () => {
    expect(reconcileReviewTraceEvidence(projection(), ['trace-2', 'trace-3'])).toEqual({ matched: ['trace-2'], missing: ['trace-1'], unexpected: ['trace-3'] });
    expect(reconcileReviewTraceEvidence(projection(), [])).toEqual({ matched: [], missing: ['trace-1', 'trace-2'], unexpected: [] });
  });
});
