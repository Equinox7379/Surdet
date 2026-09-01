import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  QUALIFICATION_TEMP_ROOT,
  buildQualificationMatrix,
  buildCleanupManifest,
  parseRendererV4QualificationArgs,
  validateRepositoryRoot,
  validateQualificationPath,
} from '../e2e/renderer-v4-worktree.mjs';

const TEST_REPOSITORY_ROOT = path.resolve(os.tmpdir(), 'surdet-renderer-v4-qualification-test-repository');
const TEST_TEMP_ROOT = path.resolve(os.tmpdir(), 'surdet-renderer-v4-qualification-test-temp');
const TEST_ARTIFACT_DIR = path.join(TEST_REPOSITORY_ROOT, 'docs', 'baselines');
const OUTSIDE_TEMP_ROOT = path.resolve(path.dirname(TEST_TEMP_ROOT), 'surdet-renderer-v4-qualification-outside-temp');
const OUTSIDE_REPOSITORY_ROOT = path.resolve(path.dirname(TEST_REPOSITORY_ROOT), 'surdet-renderer-v4-qualification-outside-repository');

describe('renderer v4 qualification matrix and worktree discipline', () => {
  it('produces the fixed Q1→Q5 order and exact commit/role mapping', () => {
    const matrix = buildQualificationMatrix(QUALIFICATION_TEMP_ROOT);
    expect(matrix.map((group) => group.id)).toEqual([
      'q1-007-a-b',
      'q2-007-b-a',
      'q3-f7-a-b',
      'q4-f7-b-a',
      'q5-f7-same-root',
    ]);
    expect(matrix[0].baseline.commit).toBe('007438b569ec95350fdc9d7882ad49f55bbb7968');
    expect(matrix[0].current.commit).toBe('007438b569ec95350fdc9d7882ad49f55bbb7968');
    expect(matrix[2].baseline.commit).toBe('f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59');
    expect(matrix[3].baseline.label).toBe('B');
    expect(matrix[3].current.label).toBe('A');
    expect(matrix[4].baseline.root).toBe(matrix[4].current.root);
  });

  it('never reuses a physical root across Q1–Q4 and keeps every path under the platform temp root', () => {
    const matrix = buildQualificationMatrix(QUALIFICATION_TEMP_ROOT);
    const roots = matrix.flatMap((group) => [group.baseline.root, group.current.root]);
    expect(new Set(roots.slice(0, 8)).size).toBe(8);
    for (const root of roots) expect(() => validateQualificationPath(root, QUALIFICATION_TEMP_ROOT)).not.toThrow();
    expect(() => validateQualificationPath(OUTSIDE_TEMP_ROOT, QUALIFICATION_TEMP_ROOT)).toThrow();
    expect(() => validateQualificationPath(path.join(QUALIFICATION_TEMP_ROOT, '..', 'other'), QUALIFICATION_TEMP_ROOT)).toThrow();
  });

  it('requires explicit repository/temp/artifact paths and does not expose skip or parallel controls', () => {
    expect(() => parseRendererV4QualificationArgs([])).toThrow(/--repository-root/);
    expect(() => parseRendererV4QualificationArgs(['--repository-root', TEST_REPOSITORY_ROOT])).toThrow(/--temp-root/);
    expect(() => parseRendererV4QualificationArgs([
      '--repository-root', TEST_REPOSITORY_ROOT, '--temp-root', TEST_TEMP_ROOT,
      '--artifact-dir', TEST_ARTIFACT_DIR, '--skip-q3', 'true',
    ])).toThrow(/未知参数/);
    const parsed = parseRendererV4QualificationArgs([
      '--repository-root', TEST_REPOSITORY_ROOT, '--temp-root', TEST_TEMP_ROOT, '--artifact-dir', TEST_ARTIFACT_DIR,
    ]);
    expect(parsed.repositoryRoot).toBe(TEST_REPOSITORY_ROOT);
    expect(parsed.tempRoot).toBe(TEST_TEMP_ROOT);
    expect(parsed.artifactDir).toBe(TEST_ARTIFACT_DIR);
    expect(() => parseRendererV4QualificationArgs([
      '--repository-root', TEST_REPOSITORY_ROOT, '--temp-root', TEST_TEMP_ROOT, '--artifact-dir', TEST_TEMP_ROOT,
    ])).toThrow(/不同路径/);
  });

  it('accepts the repository root itself while rejecting paths outside it', () => {
    expect(validateRepositoryRoot(TEST_REPOSITORY_ROOT, TEST_REPOSITORY_ROOT)).toBe(TEST_REPOSITORY_ROOT);
    expect(() => validateRepositoryRoot(OUTSIDE_REPOSITORY_ROOT, TEST_REPOSITORY_ROOT)).toThrow(/repository-root/);
  });

  it('creates a cleanup manifest with exact paths and no wildcard semantics', () => {
    const matrix = buildQualificationMatrix(QUALIFICATION_TEMP_ROOT);
    const manifest = buildCleanupManifest(matrix, { stage: 'constructed', artifact: null });
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.worktrees).toHaveLength(9);
    expect(manifest.worktrees.every((entry) => pathIsExact(entry.path))).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain('*');
  });
});

function pathIsExact(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('*');
}
