import { describe, expect, it } from 'vitest';
import {
  assertDiskFileMatchesBaseline,
  diffProjectDiskBaselines,
  expectedShaFor,
} from '../src/project-disk-baseline.js';

const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const c = 'c'.repeat(64);

describe('project disk baseline', () => {
  it('finds all changes between the Editor loaded baseline and current disk', () => {
    const result = diffProjectDiskBaselines(
      {
        projectRevision: a,
        coordinationRevision: a,
        files: [
          { path: 'content/scenario/a.gal', sha256: a },
          { path: 'content/scenario/b.gal', sha256: b },
        ],
      },
      {
        projectRevision: b,
        coordinationRevision: b,
        files: [
          { path: 'content/scenario/a.gal', sha256: c },
          { path: 'content/scenario/c.gal', sha256: a },
        ],
      },
    );
    expect(result).toEqual({
      created: ['content/scenario/c.gal'],
      modified: ['content/scenario/a.gal'],
      deleted: ['content/scenario/b.gal'],
      all: [
        'content/scenario/a.gal',
        'content/scenario/b.gal',
        'content/scenario/c.gal',
      ],
    });
  });

  it('does not rely on only the latest mutation notice', () => {
    const oldBaseline = {
      projectRevision: a,
      coordinationRevision: a,
      files: [
        { path: 'content/scenario/a.gal', sha256: a },
        { path: 'content/scenario/b.gal', sha256: a },
      ],
    };
    const current = {
      projectRevision: c,
      coordinationRevision: c,
      files: [
        { path: 'content/scenario/a.gal', sha256: b },
        { path: 'content/scenario/b.gal', sha256: c },
      ],
    };
    expect(diffProjectDiskBaselines(oldBaseline, current).all).toEqual([
      'content/scenario/a.gal',
      'content/scenario/b.gal',
    ]);
  });

  it('returns null for files that did not exist in the loaded baseline', () => {
    expect(expectedShaFor({ projectRevision: a, coordinationRevision: a, files: [] }, 'content/scenario/new.gal'))
      .toBeNull();
  });

  it('preserves the human draft when the current file no longer matches', () => {
    expect(() => assertDiskFileMatchesBaseline(a, b, 'content/scenario/a.gal'))
      .toThrow('未覆盖你的草稿');
  });
});
