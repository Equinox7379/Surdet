import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { buildObjectIndex } from '../src/object-index.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { validateSnapshot } from '../src/validation.js';
import { buildAssetCatalog } from '../src/asset-catalog.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

const catalog = buildAssetCatalog([
  'content/assets/bg/castle_hall.svg',
  'content/assets/bg/night_field.svg',
  'content/assets/portrait/lynn_uniform_normal.svg',
  'content/assets/portrait/lynn_uniform_night.svg',
]);

const agentProbeText = ['@scene agent_probe', '@label start', '@timeline agent_blackout @ blocking', '@end'].join('\n');

function storageFor(contents: Record<string, string>): ProjectStorage {
  return {
    rootIdentity: 'validation-fixture',
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error('missing fixture file: ' + path);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

const goodTimeline = JSON.stringify({
  version: 1,
  id: 'agent_blackout',
  durationMs: 800,
  tracks: [
    { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night_field' }] },
    { kind: 'portrait', target: 'lynn:uniform', cues: [{ atMs: 100, durationMs: 0, easing: 'linear', action: 'show', expression: 'night', position: 'left' }] },
  ],
});

describe('timeline validation wiring', () => {
  it('routes core validateTimeline diagnostics into the validation envelope as errors', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText,
      'content/timelines/agent_blackout.json': JSON.stringify({
        version: 2,
        id: 'agent_blackout',
        durationMs: 800,
        tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 5 }] }],
      }),
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    const timelineErrors = result.issues.filter((issue) => (
      issue.file === 'content/timelines/agent_blackout.json' && issue.severity === 'error'
    ));
    expect(timelineErrors.length).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });

  it('reports a missing timeline target as an error when timelines are part of the snapshot', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText.replace('agent_blackout @ blocking', 'missing_show @ blocking'),
      'content/timelines/agent_blackout.json': goodTimeline,
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    const missing = result.issues.find((issue) => issue.code === 'TIMELINE_MISSING');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('error');
    expect(result.ok).toBe(false);
  });

  it('reports unresolved asset references as warnings that never block', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText,
      'content/timelines/agent_blackout.json': JSON.stringify({
        version: 1,
        id: 'agent_blackout',
        durationMs: 800,
        tracks: [
          { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'missing_bg' }] },
          { kind: 'portrait', target: 'lynn:casual', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'show', expression: 'smile', position: 'left' }] },
        ],
      }),
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    const warnings = result.issues.filter((issue) => issue.severity === 'warning' && issue.code === 'ASSET_UNRESOLVED');
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    for (const warning of warnings) {
      expect(warning.objectRef).toBeDefined();
      expect(warning.action).toBeDefined();
    }
    expect(result.issues.every((issue) => issue.severity !== 'error')).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('passes a fully resolved wave 2 slice with only non-blocking noise', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText,
      'content/timelines/agent_blackout.json': goodTimeline,
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    expect(result.issues.filter((issue) => issue.code === 'ASSET_UNRESOLVED')).toHaveLength(0);
    expect(result.ok).toBe(true);
  });
});
