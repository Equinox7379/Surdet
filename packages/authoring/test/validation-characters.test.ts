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
  'content/assets/avatar/lynn.svg',
  'content/assets/avatar/nova.svg',
]);

const agentProbeText = ['@scene agent_probe', '@label start', '诺瓦：新角色登场。', '@end'].join('\n');

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

const goodConfig = JSON.stringify({
  title: 'Starter',
  version: '0.1.0',
  entryScene: 'agent_probe',
  characters: { lynn: { name: '凛', avatar: 'lynn' }, nova: { name: '诺瓦', avatar: 'nova' } },
  variables: {},
});

describe('character validation wiring', () => {
  it('does not attach line-one config diagnostics to an unrelated variable', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': JSON.stringify({ entryScene: 'missing', characters: { broken: {} }, variables: { flag: { type: 'number', initial: 0 } } }),
      'content/scenario/agent_probe.gal': agentProbeText,
    }), hasher);
    const issues = validateSnapshot(snapshot, buildObjectIndex(snapshot)).issues;
    expect(issues.find(issue => issue.code === 'CHARACTER_INVALID')?.objectRef).toBe('character:broken');
    expect(issues.find(issue => issue.code === 'ENTRY_SCENE_MISSING')?.objectRef).toBe('config:entryScene');
  });

  it('passes a fully resolved project with characters and entryScene', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': goodConfig,
      'content/scenario/agent_probe.gal': agentProbeText,
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    expect(result.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
    expect(result.ok).toBe(true);
  });

  it('distinguishes an unavailable avatar catalog from a known empty catalog', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': goodConfig,
      'content/scenario/agent_probe.gal': agentProbeText,
    }), hasher);
    const unavailable = validateSnapshot(snapshot);
    expect(unavailable.issues.filter((issue) => issue.code === 'ASSET_UNRESOLVED')).toEqual([]);
    const empty = validateSnapshot(snapshot, undefined, { assetCatalog: buildAssetCatalog([]) });
    const missing = empty.issues.filter((issue) => issue.code === 'ASSET_UNRESOLVED');
    expect(missing).toHaveLength(2);
    expect(missing.map((issue) => issue.text)).toEqual(expect.arrayContaining([
      expect.stringContaining("角色 'lynn'"), expect.stringContaining("角色 'nova'"),
    ]));
  });

  it('reports malformed character tables as errors', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': JSON.stringify({ entryScene: 'agent_probe', characters: { bad: { avatar: 'x' } } }),
      'content/scenario/agent_probe.gal': agentProbeText,
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    const errors = result.issues.filter((issue) => issue.code === 'CHARACTER_INVALID' && issue.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });

  it('reports an entryScene pointing at a missing scene as an error', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': JSON.stringify({ entryScene: 'ghost', characters: {} }),
      'content/scenario/agent_probe.gal': agentProbeText,
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    const missing = result.issues.find((issue) => issue.code === 'ENTRY_SCENE_MISSING');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('error');
    expect(result.ok).toBe(false);
  });

  it('reports unresolved avatars and unknown speakers as non-blocking warnings', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': JSON.stringify({
        entryScene: 'agent_probe',
        characters: { lynn: { name: '凛', avatar: 'missing_avatar' } },
      }),
      'content/scenario/agent_probe.gal': ['@scene agent_probe', '@label start', '神秘人：是谁？', '@end'].join('\n'),
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    const avatarWarning = result.issues.find((issue) => issue.code === 'ASSET_UNRESOLVED' && issue.severity === 'warning');
    expect(avatarWarning).toBeDefined();
    expect(avatarWarning!.objectRef).toBe('character:lynn');
    const speakerWarning = result.issues.find((issue) => issue.code === 'SPEAKER_UNRESOLVED' && issue.severity === 'warning');
    expect(speakerWarning).toBeDefined();
    expect(speakerWarning!.action).toBeDefined();
    expect(result.issues.every((issue) => issue.severity !== 'error')).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('URL-leading text lines do not produce SPEAKER_UNRESOLVED false diagnostics (N2)', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': JSON.stringify({
        entryScene: 'agent_probe',
        characters: { lynn: { name: '凛', avatar: 'lynn' } },
      }),
      'content/scenario/agent_probe.gal': [
        '@scene agent_probe',
        '@label start',
        'https://example.com/story',
        'http://example.com/story',
        'ftp://example.com/story',
        'custom+proto://host',
        '凛：正常台词。',
        '@end',
      ].join('\n'),
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    const speakerIssues = result.issues.filter((issue) => issue.code === 'SPEAKER_UNRESOLVED');
    expect(speakerIssues).toHaveLength(0);
    // 不得对 URL scheme 产生 character.ensure 建议（action 仅随 issue 出现，此处断言无该 issue 即无该 action）
    expect(result.issues.some((issue) => issue.code === 'SPEAKER_UNRESOLVED' && /character\.ensure/.test(issue.action ?? ''))).toBe(false);
    expect(result.ok).toBe(true);
  });
});
