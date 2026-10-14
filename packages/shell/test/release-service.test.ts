import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkReleaseManifest, isNewerVersion, parseReleaseManifest } from '../src/release-service.js';

describe('release service', () => {
  it('compares valid semantic versions and rejects malformed manifests', () => {
    expect(isNewerVersion('1.2.0', '1.1.9')).toBe(true);
    expect(isNewerVersion('1.1.0', '1.1.0')).toBe(false);
    expect(isNewerVersion('1.9.9', '2.0.0')).toBe(false);
    expect(parseReleaseManifest({ engine: 'other' })).toBeNull();
  });

  it('never treats a URL as a network request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try {
      expect((await checkReleaseManifest('https://updates.invalid/manifest.json', '1.0.0')).status).toBe('invalid');
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([
    ['1.2.3.5', '1.2.3.4', true],
    ['1.2.3.4', '1.2.3.4', false],
    ['1.2.3.3', '1.2.3.4', false],
    ['1.2.3.1', '1.2.3', true],
    ['1.2.3.0', '1.2.3', false],
    ['1.2.4', '1.2.3.65535', true],
    ['v2.0.0', '1.9.9.65535', true],
    ['1.2.0', '1.2', false],
    ['1.2.3.4.5', '1.2.3', false],
  ])('compares %s against %s', (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected);
  });

  it('reports unsupported versions as invalid rather than up to date', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-release-version-'));
    const file = path.join(root, 'update-manifest.json');
    try {
      const write = (version: string) => fs.writeFileSync(file, JSON.stringify({
        engine: 'surdet', game: 'release-fixture', version, generatedAt: '2026-10-14T00:00:00Z', notes: '',
      }));
      for (const version of ['latest', '1.2.3.4.5', '999999999999999999999.0.0']) {
        write(version);
        expect((await checkReleaseManifest(file, '1.2.3.4')).status).toBe('invalid');
      }
      write('1.2.3.5');
      expect((await checkReleaseManifest(file, 'unknown')).status).toBe('invalid');
      expect((await checkReleaseManifest(file, '1.2.3.4')).status).toBe('update-available');
      expect((await checkReleaseManifest(file, '1.2.3.5')).status).toBe('up-to-date');
      expect((await checkReleaseManifest(file, '1.2.4')).status).toBe('up-to-date');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
