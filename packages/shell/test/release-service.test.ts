import { describe, expect, it, vi } from 'vitest';
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
});
