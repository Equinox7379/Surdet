import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { beginChange, InMemoryChangeRepository } from '../src/change-session.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { buildAssetCatalog } from '../src/asset-catalog.js';
import { applyUiDocument, applyUiPatch, inspectUi } from '../src/ui-operations.js';
import { buildObjectIndex } from '../src/object-index.js';
import { validateSnapshot } from '../src/validation.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const hasher = { sha256: async (text: string) => hash(text) };
const configText = JSON.stringify({ entryScene: 'start', variables: { trust: { type: 'number', initial: 3 } } });
const sceneText = '@scene start\n旁白：你好。\n@end\n';
const root = { id: 'hud-root', type: 'container' as const, frame: { x: 0, y: 0, width: 1280, height: 720 }, children: [
  { id: 'trust-value', type: 'text' as const, frame: { x: 20, y: 20, width: 200, height: 40 }, text: { kind: 'variable' as const, name: 'trust' } },
] };

async function fixture(extraConfig: Record<string, unknown> = {}) {
  const files = { 'game.config.json': JSON.stringify({ ...JSON.parse(configText), ...extraConfig }), 'content/scenario/start.gal': sceneText };
  const snapshot = await loadProjectSnapshot({ rootIdentity: 'ui-fixture', listFiles: async () => Object.keys(files), exists: async path => path in files,
    readText: async path => { const text = files[path as keyof typeof files]; return { path, text, bytes: text.length, sha256: hash(text) }; } }, hasher);
  const change = await beginChange(snapshot, new InMemoryChangeRepository());
  change.record.composition = { ...change.record.composition!, mode: 'direct' };
  return { snapshot, change };
}

describe('project.ui direct working patch', () => {
  it('patches conditional status panels atomically and indexes every actual variable dependency', async () => {
    const { snapshot, change } = await fixture({ variables: { trust: { type: 'number', initial: 3 }, panelOpen: { type: 'flag', initial: false }, energy: { type: 'number', min: 0, max: 10, initial: 5, readonly: true }, bag: { type: 'string[]', initial: [] } } });
    const assets = buildAssetCatalog([], snapshot), frame = root.children[0]!.frame;
    const hud = { ...root, children: [
      { id: 'energy', type: 'progress' as const, frame, binding: { kind: 'variable' as const, name: 'energy' } },
      { id: 'items', type: 'text' as const, frame, visibleWhen: 'panelOpen && trust >= 2', text: { kind: 'variable' as const, name: 'bag', format: 'list' as const } },
      { id: 'open', type: 'button' as const, frame, enabledWhen: 'trust > 0', action: { kind: 'variable-set' as const, name: 'panelOpen', value: true } },
    ] };
    const initial = await inspectUi(snapshot.config, hasher);
    const created = await applyUiPatch(change, { operationId: 'status', expectedFingerprint: initial.fingerprint, patch: { type: 'page.set', page: 'hud', root: hud } }, hasher, assets);
    const working = JSON.parse(change.record.workingFiles['game.config.json']!);
    const index = buildObjectIndex({ ...snapshot, config: working });
    expect(index.byRef.get('ui:items')?.references).toEqual(expect.arrayContaining(['variable:panelOpen', 'variable:trust', 'variable:bag']));
    expect(index.byRef.get('ui:open')?.references).toEqual(expect.arrayContaining(['variable:panelOpen', 'variable:trust']));
    const before = JSON.stringify(change.record);
    await expect(applyUiPatch(change, { operationId: 'invalid', expectedFingerprint: created.ui.fingerprint,
      patch: { type: 'node.update', page: 'hud', id: 'items', patch: { visibleWhen: 'ghost' } } }, hasher, assets)).rejects.toMatchObject({ code: 'UI_INVALID' });
    expect(JSON.stringify(change.record)).toBe(before);
    await applyUiPatch(change, { operationId: 'unconditional', expectedFingerprint: created.ui.fingerprint,
      patch: { type: 'node.update', page: 'hud', id: 'items', patch: { visibleWhen: null } } }, hasher, assets);
    expect(JSON.parse(change.record.workingFiles['game.config.json']!).ui.pages.hud.children[1].visibleWhen).toBeUndefined();
  });

  it('uses the same permissions, fingerprint and final asset checks for a complete draft', async () => {
    const { snapshot, change } = await fixture();
    const assets = buildAssetCatalog([], snapshot);
    const request = { operationId: 'document', expectedFingerprint: (await inspectUi(snapshot.config, hasher)).fingerprint,
      value: { version: 1 as const, pages: { hud: root } } };
    for (const mode of ['candidate', 'integration'] as const) {
      change.record.composition!.mode = mode === 'candidate' ? 'candidate' : 'direct';
      if (mode === 'integration') change.record.integration = {} as NonNullable<typeof change.record.integration>;
      const before = JSON.stringify(change.record);
      await expect(applyUiDocument(change, request, hasher, assets)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
      expect(JSON.stringify(change.record)).toBe(before);
    }
    delete change.record.integration;
    change.record.composition!.mode = 'direct';
    const before = JSON.stringify(change.record);
    await expect(applyUiDocument(change, { ...request, expectedFingerprint: 'stale' }, hasher, assets)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    await expect(applyUiDocument(change, { ...request, value: { version: 1, pages: { hud: { id: root.id, frame: root.frame, type: 'image', asset: 'missing' } } } }, hasher, assets)).rejects.toMatchObject({ code: 'UI_INVALID' });
    expect(JSON.stringify(change.record)).toBe(before);
    const result = await applyUiDocument(change, request, hasher, assets);
    expect(result.ui.value).toEqual(request.value);
    expect(result.diffEntry.directChange).toEqual({ path: 'game.config.json', fields: ['ui.pages.hud'] });
    const saved = JSON.stringify(change.record);
    expect(await applyUiDocument(change, request, hasher, assets)).toEqual(result);
    await expect(applyUiDocument(change, { ...request, value: null }, hasher, assets)).rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
    expect(JSON.stringify(change.record)).toBe(saved);
  });
  it('edits one node with a stable identity, preserves project source and rejects stale or candidate writes atomically', async () => {
    const { snapshot, change } = await fixture();
    const assets = buildAssetCatalog([], snapshot);
    const before = await inspectUi(snapshot.config, hasher);
    expect(before.defaultPages).toContain('hud');
    const set = await applyUiPatch(change, { operationId: 'set-hud', expectedFingerprint: before.fingerprint,
      patch: { type: 'page.set', page: 'hud', root } }, hasher, assets);
    expect(set.ui.nodes.map(node => node.id)).toEqual(['hud-root', 'trust-value']);
    expect(snapshot.config.ui).toBeUndefined();
    const updated = await applyUiPatch(change, { operationId: 'move-hud', expectedFingerprint: set.ui.fingerprint,
      patch: { type: 'node.update', page: 'hud', id: 'trust-value', patch: { frame: { x: 30, y: 24, width: 200, height: 40 } } } }, hasher, assets);
    expect(updated.ui.nodes.map(node => node.id)).toEqual(['hud-root', 'trust-value']);
    const working = JSON.parse(change.record.workingFiles['game.config.json']!);
    expect(working.ui.pages.hud.children[0].frame.x).toBe(30);
    expect(buildObjectIndex({ ...snapshot, config: working }).byRef.get('ui:trust-value')?.references).toContain('variable:trust');
    const record = JSON.stringify(change.record);
    await expect(applyUiPatch(change, { operationId: 'stale', expectedFingerprint: set.ui.fingerprint,
      patch: { type: 'page.remove', page: 'hud' } }, hasher, assets)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(JSON.stringify(change.record)).toBe(record);
    change.record.composition!.mode = 'candidate';
    const candidateRecord = JSON.stringify(change.record);
    await expect(applyUiPatch(change, { operationId: 'candidate', expectedFingerprint: updated.ui.fingerprint,
      patch: { type: 'page.remove', page: 'hud' } }, hasher, assets)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(JSON.stringify(change.record)).toBe(candidateRecord);
  });
  it('rejects missing and ambiguous project images without recording partial content', async () => {
    const { snapshot, change } = await fixture();
    const before = await inspectUi(snapshot.config, hasher);
    const imageRoot = { ...root, children: [{ id: 'art', type: 'image' as const, frame: { x: 0, y: 0, width: 100, height: 100 }, asset: 'paper' }] };
    const request = { operationId: 'image', expectedFingerprint: before.fingerprint, patch: { type: 'page.set' as const, page: 'hud' as const, root: imageRoot } };
    const record = JSON.stringify(change.record);
    await expect(applyUiPatch(change, request, hasher, buildAssetCatalog([], snapshot))).rejects.toMatchObject({ code: 'UI_INVALID' });
    await expect(applyUiPatch(change, request, hasher, buildAssetCatalog(['content/assets/bg/paper.png', 'content/assets/bg/paper.jpg'], snapshot))).rejects.toMatchObject({ code: 'UI_INVALID' });
    expect(JSON.stringify(change.record)).toBe(record);
    const catalog = buildAssetCatalog(['content/assets/bg/paper.png'], snapshot);
    const result = await applyUiPatch(change, request, hasher, catalog);
    expect(result.ui.value?.pages.hud?.children?.[0]?.asset).toBe('paper');
    const invalid = { ...snapshot, config: JSON.parse(change.record.workingFiles['game.config.json']!) };
    expect(validateSnapshot(invalid, buildObjectIndex(invalid), { assetCatalog: catalog }).ok).toBe(true);
  });
});
