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
    candidates: [], safeGroups: [], defaultSelectedUnitIds: [], conflicts: [], dependencies: [],
    evidence: { candidateMatrix: [], blockingCount: 0, selectionRequiredCount: 0, advisoryCount: 0, canCreateDecision: true },
    objects: [{ objectRef: 'scene:wave6_alpha', kind: 'scene', references: [], referencedBy: [], potentialImpact: [], observedImpact: [] }],
    sourceIdentity: { projectIdentity: 'project-1', expectedProjectRevision: 'revision-1', comparisonFingerprint: 'comparison-fp' },
    reviewFingerprint: 'review-fp',
    finalResult: {
      planId: 'plan-1', planFingerprint: 'plan-fp', integrationChangeId: 'change-1', workingRevision: 2,
      diffFingerprint: 'diff-fp', changedObjects: [],
      evidence: { diffEvidenceId: 'diff-1', validationEvidenceId: 'validation-1', simulationEvidenceId: 'simulation-1', runtimeTraceIds: ['trace-1', 'trace-2'] },
      plan: {
        review: { reviewState: 'human-reviewed', reviewId: 'review-comparison', decisionId: 'decision-1', decisionFingerprint: 'decision-fp' },
        sourceCapsules: [], sourceCandidates: [], selectedUnitIds: [], includedUnitIds: [], implicitInclusions: [], excludedUnitIds: [],
        conflictResolutions: [], deduplicatedUnits: [], replayOperations: [], provenance: [], finalObjectFingerprints: {},
      },
      diff: { summary: { createdScenes: 0, modifiedScenes: 0, changedVariables: 0, warnings: [] }, semantic: [], files: [] },
      freshness: { diff: 'fresh', validation: 'fresh', simulation: 'fresh', runtime: 'fresh' },
      runtimeTraceObservations: [
        { traceId: 'trace-1', observationKeys: ['text|wave6_alpha|0|text|content/scenario/wave6_alpha.gal|2|1'] },
        { traceId: 'trace-2', observationKeys: ['timeline|wave6_beta|1|timeline|content/scenario/wave6_beta.gal|3|1'] },
      ],
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

  it('starts a whole result at its project entry rather than an alphabetically earlier changed ending', () => {
    const value: HumanReviewProjection = { ...projection(), reviewVersion: '2.0.0', candidates: [], defaultSelectedUnitIds: [],
      creativeBrief: { status: 'not-provided', source: 'review-preparation-input', acceptanceCriteria: [] } };
    expect(selectReviewPreviewScene(['wave6_alpha', 'entry'], value, undefined, 'entry')).toBe('entry');
    expect(selectReviewPreviewScene(['wave6_alpha', 'entry'], value, 'wave6_alpha', 'entry')).toBe('wave6_alpha');
    expect(selectReviewPreviewScene(['wave6_alpha'], value, undefined, 'missing')).toBe('wave6_alpha');
  });

  it('hashes the fixture tree by sorted relative file identities, independent of enumeration order', async () => {
    const first = new MemoryDirectory('project').file('b.txt', 'B').file('a.txt', 'A');
    const second = new MemoryDirectory('project').file('a.txt', 'A').file('b.txt', 'B');
    expect(await hashReviewFixtureTree(first.handle(), bytesHasher)).toBe(await hashReviewFixtureTree(second.handle(), bytesHasher));
    second.file('b.txt', 'changed');
    expect(await hashReviewFixtureTree(first.handle(), bytesHasher)).not.toBe(await hashReviewFixtureTree(second.handle(), bytesHasher));
  });

  it('compares formal and browser observations by stable event identity instead of unrelated trace IDs', () => {
    const observed = [{
      kind: 'text',
      source: { sceneId: 'wave6_alpha', index: 0, op: 'text', file: 'content/scenario/wave6_alpha.gal', line: 2, col: 1 },
    }];
    expect(reconcileReviewTraceEvidence(projection(), observed)).toEqual({
      matched: ['trace-1'],
      missing: ['trace-2'],
      unexpected: [],
    });
    expect(reconcileReviewTraceEvidence(projection(), [])).toEqual({ matched: [], missing: ['trace-1', 'trace-2'], unexpected: [] });
  });
});
