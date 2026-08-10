import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILD_EQUIVALENCE_SCHEMA_VERSION,
  collectBuildManifest,
  compareBuildManifests,
  validateBuildManifest,
} from '../e2e/renderer-build-equivalence.mjs';

function fixtureManifest(overrides = {}) {
  return {
    schemaVersion: BUILD_EQUIVALENCE_SCHEMA_VERSION,
    artifactKind: 'renderer-build-manifest',
    sourceCommit: 'a'.repeat(40),
    packageLockSha256: 'b'.repeat(64),
    buildCommand: ['npm', 'run', 'build'],
    installCommand: ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    noMtime: true,
    worktreeStatus: '',
    environment: { node: 'v20.0.0', npm: '10.0.0', electron: '43.2.0', playwright: '1.49.0', os: 'win32 10.0', platform: 'win32', arch: 'x64', cpu: 'fixture' },
    roots: {
      shellDist: 'packages/shell/dist',
      starterDist: 'examples/starter/dist',
    },
    files: [
      { relativePath: 'examples/starter/dist/assets/index-test.js', size: 20, sha256: 'c'.repeat(64) },
      { relativePath: 'examples/starter/dist/index.html', size: 60, sha256: 'd'.repeat(64) },
      { relativePath: 'packages/shell/dist/helper.js', size: 8, sha256: '1'.repeat(64) },
      { relativePath: 'packages/shell/dist/main.js', size: 10, sha256: 'e'.repeat(64) },
      { relativePath: 'packages/shell/dist/preload.js', size: 12, sha256: 'f'.repeat(64) },
    ],
    bundleEntries: {
      'packages/shell/dist/main.js': 'e'.repeat(64),
      'packages/shell/dist/preload.js': 'f'.repeat(64),
      'examples/starter/dist/index.html': 'd'.repeat(64),
      'examples/starter/dist/assets/index-test.js': 'c'.repeat(64),
    },
    ...overrides,
  };
}

describe('renderer build equivalence', () => {
  it('accepts a complete deterministic manifest without mtime', () => {
    expect(() => validateBuildManifest(fixtureManifest())).not.toThrow();
  });

  it.each([
    ['schema', (value) => { value.schemaVersion = 2; }],
    ['source SHA', (value) => { value.sourceCommit = 'a'.repeat(39); }],
    ['lockfile SHA', (value) => { value.packageLockSha256 = 'b'.repeat(63); }],
    ['mtime field', (value) => { value.files[0].mtimeMs = 1; }],
    ['unsorted files', (value) => { value.files.reverse(); }],
    ['duplicate file', (value) => { value.files.push({ ...value.files[0] }); }],
    ['missing entry', (value) => { delete value.bundleEntries['packages/shell/dist/main.js']; }],
    ['entry hash mismatch', (value) => { value.bundleEntries['packages/shell/dist/main.js'] = '0'.repeat(64); }],
  ])('rejects malformed build evidence: %s', (_label, mutate) => {
    const value = fixtureManifest();
    mutate(value);
    expect(() => validateBuildManifest(value)).toThrow();
  });

  it('compares complete manifests and reports exact path/size/hash differences', () => {
    const baseline = fixtureManifest();
    const current = fixtureManifest();
    expect(compareBuildManifests(baseline, current)).toEqual({ equivalent: true, differences: [] });
    current.files.find((file) => file.relativePath === 'packages/shell/dist/helper.js').sha256 = '2'.repeat(64);
    expect(compareBuildManifests(baseline, current)).toEqual({
      equivalent: false,
      differences: [
        'files[packages/shell/dist/helper.js].sha256: 1111111111111111111111111111111111111111111111111111111111111111 !== 2222222222222222222222222222222222222222222222222222222222222222',
      ],
    });
  });

  it('collects sorted path/size/hash entries and referenced starter bundle entries', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-build-manifest-test-'));
    try {
      fs.mkdirSync(path.join(root, 'packages/shell/dist'), { recursive: true });
      fs.mkdirSync(path.join(root, 'examples/starter/dist/assets'), { recursive: true });
      fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n', 'utf8');
      fs.writeFileSync(path.join(root, 'packages/shell/dist/main.js'), 'main', 'utf8');
      fs.writeFileSync(path.join(root, 'packages/shell/dist/preload.js'), 'preload', 'utf8');
      fs.writeFileSync(path.join(root, 'examples/starter/dist/assets/index-test.js'), 'bundle', 'utf8');
      fs.writeFileSync(path.join(root, 'examples/starter/dist/index.html'), '<script type="module" src="./assets/index-test.js"></script>', 'utf8');
      execFileSync('git', ['init', '--quiet'], { cwd: root, shell: false });
      execFileSync('git', ['config', 'user.email', 'manifest@example.invalid'], { cwd: root, shell: false });
      execFileSync('git', ['config', 'user.name', 'Manifest Test'], { cwd: root, shell: false });
      execFileSync('git', ['add', '--', '.'], { cwd: root, shell: false });
      execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root, shell: false });
      const manifest = collectBuildManifest(root);
      expect(manifest.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(manifest.noMtime).toBe(true);
      expect(manifest.files.map((file) => file.relativePath)).toEqual([
        'examples/starter/dist/assets/index-test.js',
        'examples/starter/dist/index.html',
        'packages/shell/dist/main.js',
        'packages/shell/dist/preload.js',
      ]);
      expect(manifest.bundleEntries['examples/starter/dist/assets/index-test.js']).toMatch(/^[0-9a-f]{64}$/);
      expect(() => validateBuildManifest(manifest)).not.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the equivalence tool shell-free', () => {
    const source = fs.readFileSync(new URL('../e2e/renderer-build-equivalence.mjs', import.meta.url), 'utf8');
    expect(source).toContain('shell: false');
    expect(source).not.toContain('shell: true');
  });
});
