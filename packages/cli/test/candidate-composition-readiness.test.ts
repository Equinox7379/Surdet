import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTHORING_CONTRACT_VERSION, CANDIDATE_COMPOSITION_READINESS_SCHEMA, getCapabilityDefinition, type ProjectAssetCatalog, type AuthoringEnvelope, type AuthoringObject, type CompositionManifest } from '@surdet/authoring';
import { openAgentPortSession, type AgentPortSession } from '../src/agent-port/session.js';
import { generateDeliveryCapsule } from '../src/agent-port/delivery-capsule.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { standardSchemaFromJson } from '../src/authoring/schema-validator.js';

const temporaryRoots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave8-project-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave8-data-'));
  temporaryRoots.push(root, data);
  process.env['SURDET_AGENT_DATA_DIR'] = data;
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {}, characters: {} }));
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n旁白：开始。\n@end\n');
  return { root, data };
}

const portraitFramePaths = [
  'content/assets/portrait/visual-frame-a.png',
  'content/assets/portrait/visual-frame-b.png',
];

function portraitSequence(sourcePaths: readonly string[]) {
  return {
    version: 1 as const,
    kind: 'sequence' as const,
    frames: sourcePaths.map(image => ({ image, durationMs: 80 })),
    loop: true,
  };
}

function writePortraitVisualFixture(root: string, visuals: unknown, availablePaths: readonly string[] = portraitFramePaths): string {
  for (const sourcePath of availablePaths) {
    const file = path.join(root, sourcePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'fixture bytes for asset path metadata; no image decoding');
  }
  const configPath = path.join(root, 'game.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  config['characters'] = { rin: { name: '凛', visuals } };
  fs.writeFileSync(configPath, JSON.stringify(config));
  return fs.readFileSync(configPath, 'utf8');
}

function result<T>(envelope: AuthoringEnvelope<unknown>): T {
  expect(envelope.ok, JSON.stringify(envelope)).toBe(true);
  if (!envelope.ok) throw new Error(envelope.error.message);
  return envelope.result as T;
}

async function insertJump(session: AgentPortSession, operationId: string, sceneId: string, target: string) {
  const scene = result<AuthoringObject>(await session.invoke('object.inspect', { objectRef: `scene:${sceneId}` }));
  const anchor = result<AuthoringObject>(await session.invoke('object.inspect', { objectRef: scene.childRefs![0] }));
  return session.invoke('scene.patch', { operationId, sceneId, patch: {
    kind: 'insertAfter', anchor: anchor.objectRef, expectedFingerprint: anchor.fingerprint,
    blocks: [{ kind: 'instruction', name: 'jump', args: [target] }],
  } });
}

describe('Wave 8 candidate readiness through Agent Port', () => {
  it('binds and imports translations through public tools, guards pagination and commits only the reviewed catalog', async () => {
    const { root } = fixture(), configPath = path.join(root, 'game.config.json');
    const original = fs.readFileSync(configPath, 'utf8');
    const session = await openAgentPortSession({ projectRoot: root, policy: 'apply' });
    try {
      result(await session.invoke('change.begin', { compositionMode: 'direct' }));
      const view = result<any>(await session.invoke('project.texts', { view: 'working', locale: 'en', limit: 1 }));
      const stale = await session.invoke('project.texts', { view: 'working', offset: 1 });
      expect(stale.ok).toBe(false);
      expect(result<any>(await session.invoke('project.texts', { view: 'working', offset: 1, expectedRevision: view.revision })).sources).toEqual([]);
      const binding = { operationId: 'text-bind', expectedRevision: view.revision, expectedFingerprint: view.fingerprint,
        patch: { type: 'bind', sourceLocale: 'zh-CN', bindings: [{ key: 'start.hello', sourceId: view.sources[0].sourceId }] } };
      result(await session.invoke('project.texts.patch', binding));
      expect(result<any>(await session.invoke('project.texts', { view: 'project' })).entries).toEqual([]);
      const exported = result<any>(await session.invoke('project.texts', { view: 'working', format: 'csv', locale: 'en' }));
      const csv = exported.csv.replace('"","untranslated"', '"Hello.","untranslated"');
      expect(csv).not.toBe(exported.csv);
      const preview = result<any>(await session.invoke('project.texts.import.preview', { view: 'working', locale: 'en', csv }));
      expect(preview.ready).toBe(true); expect(preview.rows[0].after).toBe('Hello.');
      result(await session.invoke('project.texts.patch', { operationId: 'text-import', expectedRevision: preview.revision, expectedFingerprint: preview.fingerprint,
        patch: { type: 'import', locale: 'en', csv, previewFingerprint: preview.previewFingerprint } }));
      const saved = result<any>(await session.invoke('project.texts', { view: 'working' }));
      expect(saved.entries[0].status).toBe('translated');
      expect(fs.readFileSync(configPath, 'utf8')).toBe(original);
      expect((await session.invoke('project.texts', { view: 'working', offset: 1, expectedRevision: view.revision })).ok).toBe(false);
      expect(result<any>(await session.invoke('project.validate', {})).ok).toBe(true);
      result(await session.invoke('project.simulate', {}));
      result(await session.invoke('runtime.run-from', { sceneId: 'start', choices: [] }));
      result(await session.invoke('change.diff', {}));
      result(await session.invoke('change.commit', {}));
      expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).textCatalog.entries[0].translations.en.value).toBe('Hello.');
    } finally { await session.close(); }
    const candidate = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    try {
      result(await candidate.invoke('change.begin', {}));
      const view = result<any>(await candidate.invoke('project.texts', { view: 'working' }));
      const before = result<any>(await candidate.invoke('change.diff', {}));
      expect((await candidate.invoke('project.texts.patch', { operationId: 'forbidden', expectedRevision: view.revision, expectedFingerprint: view.fingerprint, patch: { type: 'remove', keys: ['start.hello'] } })).ok).toBe(false);
      expect(result<any>(await candidate.invoke('change.diff', {})).files).toEqual(before.files);
      const scene = result<AuthoringObject>(await candidate.invoke('object.inspect', { objectRef: 'scene:start' }));
      const objects = await Promise.all(scene.childRefs!.map(objectRef => candidate.invoke('object.inspect', { objectRef })));
      const text = objects.map(object => result<AuthoringObject>(object)).find(object => object.kind === 'text')!;
      result(await candidate.invoke('scene.patch', { operationId: 'candidate-prose', sceneId: 'start', patch: { kind: 'replaceText', target: text.objectRef, expectedFingerprint: text.fingerprint, value: '返修。' } }));
      const changed = result<any>(await candidate.invoke('project.texts', { view: 'working' }));
      expect(changed.entries[0].status).toBe('needs-rebind');
      expect(changed.fingerprint).toBe(view.fingerprint);
      expect(result<any>(await candidate.invoke('project.validate', {})).issues).toContainEqual(expect.objectContaining({ code: 'TEXT_SOURCE_STALE', severity: 'warning' }));
    } finally { await candidate.close(); }
  });
  it('rejects ambiguous theme keys through public writes and validation without changing source or draft', async () => {
    const { root } = fixture();
    for (const folder of ['one', 'two']) {
      fs.mkdirSync(path.join(root, 'content/assets/bg', folder), { recursive: true });
      fs.writeFileSync(path.join(root, 'content/assets/bg', folder, 'paper.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    }
    const configPath = path.join(root, 'game.config.json');
    const source = fs.readFileSync(configPath, 'utf8');
    const session = await openAgentPortSession({ projectRoot: root, policy: 'apply' });
    try {
      expect(result<any>(await session.invoke('project.validate', {})).ok).toBe(true);
      result(await session.invoke('change.begin', { compositionMode: 'direct' }));
      const before = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      const inspection = result<any>(await session.invoke('project.inspect', { view: 'working' }));
      expect(await session.invoke('project.theme-config.patch', { operationId: 'duplicate-skin', expectedFingerprint: inspection.themeConfig.fingerprint, patch: { dialogSkin: 'paper' } })).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(before);
      expect(fs.readFileSync(configPath, 'utf8')).toBe(source);
    } finally { await session.close(); }
    fs.writeFileSync(configPath, JSON.stringify({ ...JSON.parse(source), theme: { dialogSkin: 'paper' } }));
    const invalid = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    try {
      const validation = result<any>(await invalid.invoke('project.validate', {}));
      expect(validation.ok).toBe(false);
      expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'THEME_INVALID' }));
    } finally { await invalid.close(); }
  });

  it('updates visuals through a direct fingerprint chain, resolves all visual sources, and rejects candidate visuals before writes', async () => {
    const { root } = fixture();
    const originalVisuals = { uniform: { normal: portraitSequence(portraitFramePaths.slice(0, 1)) } };
    const updatedVisuals = { uniform: { normal: portraitSequence(portraitFramePaths) } };
    const source = writePortraitVisualFixture(root, originalVisuals);
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    try {
      result(await session.invoke('change.begin', { compositionMode: 'direct' }));
      const baseline = result<{ charactersFingerprint: string }>(await session.invoke('project.inspect', { view: 'working' }));
      const updated = result<{ fingerprint: string }>(await session.invoke('character.ensure', {
        operationId: 'add-visual-frames', id: 'rin', name: '凛', visuals: updatedVisuals,
        portraits: { uniform: { still: portraitFramePaths[0] } },
        expectedFingerprint: baseline.charactersFingerprint,
      }));
      const afterUpdate = result<{ charactersFingerprint: string }>(await session.invoke('project.inspect', { view: 'working' }));
      expect(afterUpdate.charactersFingerprint).toBe(updated.fingerprint);
      expect(afterUpdate.charactersFingerprint).not.toBe(baseline.charactersFingerprint);

      const omitted = result<{ fingerprint: string }>(await session.invoke('character.ensure', {
        operationId: 'preserve-visuals', id: 'rin', name: '凛', expectedFingerprint: afterUpdate.charactersFingerprint,
      }));
      expect(omitted.fingerprint).toBe(afterUpdate.charactersFingerprint);
      const assets = result<ProjectAssetCatalog>(await session.invoke('project.assets', { view: 'working' }));
      const portrait = assets.portraits.find(item => item.role === 'rin' && item.outfit === 'uniform' && item.expression === 'normal');
      expect(portrait).toMatchObject({ visual: updatedVisuals.uniform.normal, sourcePaths: portraitFramePaths, resolved: true });
      for (const sourcePath of portraitFramePaths) {
        expect(assets.intelligence.items.find(item => item.sourcePath === sourcePath)).toMatchObject({ physical: true });
      }
      result(await session.invoke('character.ensure', { operationId: 'remove-visual-only', id: 'rin', name: '凛', visuals: null, expectedFingerprint: omitted.fingerprint }));
      const retained = result<ProjectAssetCatalog>(await session.invoke('project.assets', { view: 'working' }));
      expect(retained.portraits.find(item => item.role === 'rin' && item.expression === 'still')?.resolved).toBe(true);
      expect(retained.portraits.some(item => item.role === 'rin' && item.visual)).toBe(false);
      expect(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).toBe(source);
      expect(result<{ charactersFingerprint: string }>(await session.invoke('project.inspect', { view: 'project' })).charactersFingerprint)
        .toBe(baseline.charactersFingerprint);
    } finally { await session.close(); }

    const candidate = fixture();
    const candidateSource = writePortraitVisualFixture(candidate.root, originalVisuals);
    const candidateSession = await openAgentPortSession({ projectRoot: candidate.root, policy: 'stage' });
    try {
      result(await candidateSession.invoke('change.begin', { compositionMode: 'candidate' }));
      const before = (await NodeChangeStore.openByChangeId(candidateSession.activeChangeId!))!.record;
      const fingerprint = result<{ charactersFingerprint: string }>(await candidateSession.invoke('project.inspect', { view: 'working' })).charactersFingerprint;
      expect(await candidateSession.invoke('character.ensure', {
        operationId: 'candidate-visual-change', id: 'rin', name: '凛', visuals: updatedVisuals, expectedFingerprint: fingerprint,
      })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_OPERATION' } });
      expect((await NodeChangeStore.openByChangeId(candidateSession.activeChangeId!))!.record).toEqual(before);
      expect(fs.readFileSync(path.join(candidate.root, 'game.config.json'), 'utf8')).toBe(candidateSource);
    } finally { await candidateSession.close(); }
  });

  it('seals candidate @show against complete baseline visual assets and refuses a missing animation frame atomically', async () => {
    const complete = fixture();
    const visuals = { uniform: { normal: portraitSequence(portraitFramePaths) } };
    writePortraitVisualFixture(complete.root, visuals);
    const session = await openAgentPortSession({ projectRoot: complete.root, policy: 'stage' });
    try {
      result(await session.invoke('change.begin', { compositionMode: 'candidate' }));
      const created = await session.invoke('scene.create', {
        operationId: 'show-visual', sceneId: 'show_visual',
        blocks: [{ kind: 'instruction', name: 'show', args: ['rin:uniform', 'normal'] }],
      });
      expect(created.ok, JSON.stringify(created)).toBe(true);
      const assets = result<ProjectAssetCatalog>(await session.invoke('project.assets', { view: 'working' }));
      expect(assets.portraits.find(item => item.role === 'rin' && item.outfit === 'uniform' && item.expression === 'normal'))
        .toMatchObject({ visual: visuals.uniform.normal, sourcePaths: portraitFramePaths, resolved: true });

      const capsule = await generateDeliveryCapsule(session);
      const manifest = capsule.composition.manifest as CompositionManifest;
      const operation = manifest.operations.find(item => item.capabilityId === 'scene.create' && item.primaryObject === 'scene:show_visual')!;
      expect(operation.requiredObjects).toContainEqual({ objectRef: 'asset:portrait:rin:uniform:normal', source: 'base' });
      expect(operation.replayStateRequirements).toEqual(expect.arrayContaining([
        expect.objectContaining({ objectRef: 'config:portraits', source: 'base' }),
      ]));
    } finally { await session.close(); }

    const incomplete = fixture();
    const source = writePortraitVisualFixture(incomplete.root, visuals, portraitFramePaths.slice(0, 1));
    const missingSession = await openAgentPortSession({ projectRoot: incomplete.root, policy: 'stage' });
    try {
      result(await missingSession.invoke('change.begin', { compositionMode: 'candidate' }));
      const before = (await NodeChangeStore.openByChangeId(missingSession.activeChangeId!))!.record;
      expect(await missingSession.invoke('scene.create', {
        operationId: 'show-visual', sceneId: 'show_visual',
        blocks: [{ kind: 'instruction', name: 'show', args: ['rin:uniform', 'normal'] }],
      })).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY' } });
      expect((await NodeChangeStore.openByChangeId(missingSession.activeChangeId!))!.record).toEqual(before);
      expect(fs.readFileSync(path.join(incomplete.root, 'game.config.json'), 'utf8')).toBe(source);
      expect(fs.existsSync(path.join(incomplete.root, 'content', 'scenario', 'show_visual.gal'))).toBe(false);
    } finally { await missingSession.close(); }
  });

  it('rejects a candidate with missing baseline theme images without mutating the draft', async () => {
    const { root } = fixture();
    const config = JSON.parse(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8'));
    fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ ...config, theme: { dialogSkin: 'missing-paper' } }));
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    try {
      result(await session.invoke('change.begin', { compositionMode: 'candidate' }));
      const before = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      expect(await session.invoke('scene.create', { operationId: 'missing-theme', sceneId: 'new_scene', blocks: [{ kind: 'text', value: '正文。' }] }))
        .toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY', details: { issues: [expect.objectContaining({ objectRef: 'asset:bg:missing-paper' })] } } });
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(before);
    } finally { await session.close(); }
  });

  it('seals real theme image dependencies together with the theme configuration fingerprint', async () => {
    const { root } = fixture();
    const config = JSON.parse(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8'));
    fs.mkdirSync(path.join(root, 'content/assets/bg'), { recursive: true });
    for (const key of ['paper', 'button', 'logo']) fs.writeFileSync(path.join(root, `content/assets/bg/${key}.png`), 'catalog fixture, browser tests verify image decoding');
    fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ ...config, player: { titleLogo: 'logo' }, theme: { dialogSkin: 'paper', buttonSkin: 'button' } }));
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    try {
      result(await session.invoke('change.begin', { compositionMode: 'candidate' }));
      result(await session.invoke('scene.create', { operationId: 'themed-scene', sceneId: 'themed', blocks: [{ kind: 'text', value: '正文。' }] }));
      const capsule = await generateDeliveryCapsule(session);
      const operation = (capsule.composition.manifest as CompositionManifest).operations.find(item => item.primaryObject === 'scene:themed')!;
      for (const key of ['paper', 'button', 'logo']) expect(operation.requiredObjects).toContainEqual({ objectRef: `asset:bg:${key}`, source: 'base' });
      expect(operation.replayStateRequirements).toContainEqual(expect.objectContaining({ objectRef: 'config:theme', source: 'base' }));
    } finally { await session.close(); }
  });

  it('exposes effective theme defaults and applies the narrow patch only in the working view', async () => {
    const { root } = fixture();
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    try {
      result(await session.invoke('change.begin', { compositionMode: 'direct' }));
      const before = result<any>(await session.invoke('project.inspect', { view: 'working' })).themeConfig;
      expect(before.effective.tokens.colors.accent).toBe(0x203e88);
      const changed = result<any>(await session.invoke('project.theme-config.patch', { operationId: 'theme', expectedFingerprint: before.fingerprint, patch: { colors: { accent: 0x8b1e3f }, dialogMarginBottom: 24 } }));
      const after = result<any>(await session.invoke('project.inspect', { view: 'working' })).themeConfig;
      expect(after).toEqual(changed.themeConfig);
      expect(after.sources['colors.accent']).toBe('project');
      expect((await standardSchemaFromJson(getCapabilityDefinition('project.inspect').outputSchema)['~standard'].validate(result(await session.invoke('project.inspect', { view: 'working' })))).issues).toBeUndefined();
      expect(result<any>(await session.invoke('project.inspect', { view: 'project' })).themeConfig).toEqual(before);
      expect(await session.invoke('project.theme-config.patch', { operationId: 'stale-theme', expectedFingerprint: before.fingerprint, patch: null })).toMatchObject({ ok: false, error: { code: 'OBJECT_REF_STALE' } });
    } finally { await session.close(); }
  });

  it('rejects a candidate scene whose configured baseline font is missing without writing its record', async () => {
    const { root } = fixture();
    const config = JSON.parse(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8'));
    fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ ...config, fonts: { body: 'content/assets/fonts/missing.ttf' } }));
    const source = fs.readFileSync(path.join(root, 'game.config.json'), 'utf8');
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    try {
      result(await session.invoke('change.begin', {}));
      const before = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      expect(await session.invoke('scene.create', { operationId: 'font-missing', sceneId: 'font_missing', blocks: [{ kind: 'text', value: '正文。' }] }))
        .toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY', details: { issues: [expect.objectContaining({ kind: 'font-asset', objectRef: 'asset:font:content/assets/fonts/missing.ttf' })] } } });
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(before);
      expect(fs.readFileSync(path.join(root, 'game.config.json'), 'utf8')).toBe(source);
    } finally { await session.close(); }
  });
  it('copies public media recipes into candidate scenes/timelines with channel-specific sealed dependencies', async () => {
    const { root } = fixture();
    for (const folder of ['MUSIC', 'ambience', 'se', 'voice', 'video']) {
      const file = path.join(root, 'content/assets', folder, folder === 'video' ? '同名 素材.webm' : '同名 素材.WAV');
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'catalog metadata fixture, not decoding evidence');
    }
    for (const relative of ['bg/duplicate.svg', 'bg/sub/duplicate.png']) {
      const file = path.join(root, 'content/assets', relative);
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'ambiguous image metadata fixture');
    }
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    try {
      const catalog = result<ProjectAssetCatalog>(await session.invoke('project.assets', { view: 'project' }));
      const schema = standardSchemaFromJson(getCapabilityDefinition('project.assets').outputSchema);
      expect((await schema['~standard'].validate(catalog)).issues).toBeUndefined();
      const media = catalog.intelligence.items.filter(item => item.usage);
      expect(media).toHaveLength(5);
      result(await session.invoke('change.begin', {}));
      const before = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      expect(await session.invoke('scene.create', { operationId: 'duplicate-image', sceneId: 'duplicate_image', blocks: [
        { kind: 'instruction', name: 'bg', args: ['duplicate'] },
      ] })).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY' } });
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(before);
      const rejected = await session.invoke('scene.create', { operationId: 'media', sceneId: 'media', blocks: [{ kind: 'instruction', name: 'voice', args: ['absent'] }] });
      expect(rejected).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY' } });
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(before);
      result(await session.invoke('scene.create', { operationId: 'media', sceneId: 'media', blocks: media.map(item => item.usage!.scene) }));
      const voiceAsset = result<AuthoringObject>(await session.invoke('object.inspect', { objectRef: 'asset:voice:同名 素材' }));
      expect(voiceAsset.referencedBy).toHaveLength(1);
      const voiceInstruction = result<AuthoringObject>(await session.invoke('object.inspect', { objectRef: voiceAsset.referencedBy[0] }));
      expect(voiceInstruction.source?.raw).toBe('@voice "同名 素材"');
      const audioTracks = media.flatMap(item => item.usage!.timeline ? [item.usage!.timeline] : []);
      result(await session.invoke('timeline.create', { operationId: 'media-timeline', timelineId: 'sound', definition: { version: 1, id: 'sound', durationMs: 100, tracks: audioTracks } }));
      const timeline = result<AuthoringObject>(await session.invoke('object.inspect', { objectRef: 'timeline:sound' }));
      const track = result<AuthoringObject>(await session.invoke('object.inspect', { objectRef: timeline.childRefs![0] }));
      const cue = result<AuthoringObject>(await session.invoke('object.inspect', { objectRef: track.childRefs![0] }));
      const patch = { kind: 'replaceCue', cueRef: cue.objectRef, expectedFingerprint: cue.fingerprint, cue: { ...(cue.details as Record<string, unknown>), atMs: 20 } };
      result(await session.invoke('timeline.patch', { operationId: 'cue-time', timelineId: 'sound', patch }));
      expect(await session.invoke('timeline.patch', { operationId: 'old-cue', timelineId: 'sound', patch })).toMatchObject({ ok: false, error: { code: 'OBJECT_REF_STALE' } });
      const workingAssets = result<ProjectAssetCatalog>(await session.invoke('project.assets', { view: 'working' }));
      expect(workingAssets.intelligence.items.find(item => item.kind === 'voice')?.references).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceKind: 'scene', sourcePath: 'content/scenario/media.gal' }),
        expect.objectContaining({ sourceKind: 'timeline', sourcePath: 'content/timelines/sound.json' }),
      ]));
      const projectAssets = result<ProjectAssetCatalog>(await session.invoke('project.assets', { view: 'project' }));
      expect(projectAssets.intelligence.items.every(item => item.references.length === 0)).toBe(true);
      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.composition.eligibility, JSON.stringify(capsule.composition)).toBe('ready');
      const manifest = capsule.composition.manifest as CompositionManifest;
      const scene = manifest.operations.find(operation => operation.primaryObject === 'scene:media')!;
      expect(scene.requiredObjects.map(item => item.objectRef).sort()).toEqual(['ambience', 'bgm', 'se', 'video', 'voice'].map(channel => `asset:${channel}:同名 素材`));
      const frozen = structuredClone((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record);
      fs.writeFileSync(path.join(root, 'content/assets/voice/late.wav'), 'later file');
      expect(await session.invoke('scene.create', { operationId: 'late', sceneId: 'late', blocks: [{ kind: 'instruction', name: 'voice', args: ['late'] }] })).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY' } });
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(frozen);
      expect(fs.existsSync(path.join(root, 'content/scenario/media.gal'))).toBe(false);
      expect(fs.existsSync(path.join(root, 'content/timelines/sound.json'))).toBe(false);
    } finally { await session.close(); }
  });
  it.each([{ capability: 'scene.patch' }, { inputSha256: 'conflicting-input-sha' }])('keeps exact retry history and rejects a distinct success fact: %j', async (conflict) => {
    const { root } = fixture();
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    try {
      result(await session.invoke('change.begin', {}));
      const input = { operationId: 'retry-scene', sceneId: 'retry' };
      result(await session.invoke('scene.create', input));
      const before = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      result(await session.invoke('scene.create', input));
      const opened = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!;
      expect(opened.record).toEqual(before);
      const successes = (await opened.store.readInvocations(opened.record.changeId)).filter((entry) => entry.ok && entry.operationId === input.operationId);
      expect(successes).toHaveLength(2);
      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.composition.eligibility, JSON.stringify(capsule.composition.reasons)).toBe('ready');
      expect((capsule.composition.manifest as CompositionManifest).operations).toHaveLength(1);
        await NodeChangeStore.withChangeLeaseForProject(opened.record.changeId, opened.record.projectRootIdentity, async (store) => {
          await store.writeInvocation(opened.record.changeId, { ...successes[0]!, invocationId: `conflict-${Object.keys(conflict)[0]}`, ...conflict });
        });
        const rejected = await generateDeliveryCapsule(session);
        expect(rejected.composition.eligibility).toBe('unavailable');
        expect(rejected.composition.reasons).toContainEqual(expect.objectContaining({ code: 'INVOCATION_FACT_AMBIGUOUS' }));
      expect((await opened.store.readInvocations(opened.record.changeId)).filter((entry) => entry.ok && entry.operationId === input.operationId)).toHaveLength(3);
    } finally { await session.close(); }
  });

  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('recovers from a missing producer and a rejected reciprocal edge in one change, then seals without project writes', async () => {
    const { root } = fixture();
    const beforeConfig = fs.readFileSync(path.join(root, 'game.config.json'));
    const beforeScene = fs.readFileSync(path.join(root, 'content', 'scenario', 'start.gal'));
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    try {
      result(await session.invoke('change.begin', {}));
      const initial = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      const input = { operationId: 'entry', sceneId: 'entry', blocks: [{ kind: 'instruction', name: 'jump', args: ['ending'] }] };
      const missing = await session.invoke('scene.create', input);
      expect(missing).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY', retryDisposition: 'after-repair', details: {
        operationApplied: false, compositionMode: 'candidate', operationId: 'entry', capabilityId: 'scene.create',
        workingRevisionBefore: 0, workingRevisionAfter: 0,
        issues: [expect.objectContaining({ objectRef: 'scene:ending', suggestedCapabilities: ['scene.create'], repairStrategy: 'create-before-retry' })],
      } } });
      expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).toEqual(initial);
      result(await session.invoke('scene.create', { operationId: 'ending', sceneId: 'ending', blocks: [{ kind: 'text', value: '抵达终点。' }] }));
      result(await session.invoke('scene.create', input));
      for (const id of ['A', 'B']) result(await session.invoke('scene.create', { operationId: `create-${id}`, sceneId: id }));
      result(await insertJump(session, 'a-to-b', 'A', 'B'));
      const beforeCycle = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record;
      const rejected = await insertJump(session, 'b-to-a', 'B', 'A');
      expect(rejected).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_CYCLE', details: { operationApplied: false, unsupportedRecovery: 'mutual-empty-skeleton' } } });
      const opened = (await NodeChangeStore.openByChangeId(session.activeChangeId!))!;
      expect(opened.record).toEqual(beforeCycle);
      const description = await session.describe();
      expect(description.contractVersion).toBe(AUTHORING_CONTRACT_VERSION);
      expect(description.candidateReadiness).toMatchObject({ mode: 'candidate', status: 'ready', operationCount: 5, issueCount: 0, truncated: false });
      result(await session.invoke('project.validate', {}));
      result(await session.invoke('project.simulate', { sceneId: 'entry' }));
      result(await session.invoke('runtime.run-from', { sceneId: 'entry', choices: [] }));
      const diff = result<{ compositionReadiness: unknown }>(await session.invoke('change.diff', {}));
      expect(diff.compositionReadiness).toEqual(description.candidateReadiness);
      const capsule = await generateDeliveryCapsule(session);
      expect(capsule.composition.eligibility, JSON.stringify(capsule.composition.reasons)).toBe('ready');
      expect(capsule.validation.status).toBe('fresh');
      expect(capsule.simulation.status).toBe('fresh');
      expect(capsule.runtime.status).toBe('fresh');
      expect(capsule.projectMutation).toMatchObject({ occurred: false, expectedByPolicy: false });
      const invocations = await opened.store.readInvocations(opened.record.changeId);
      expect(invocations.filter((entry) => !entry.ok)).toHaveLength(2);
      for (const entry of invocations) {
        expect(entry.projectRevisionAfter, entry.capability).toBe(initial.baseRevision);
        if (entry.capability !== 'change.begin') expect(entry.projectRevisionBefore, entry.capability).toBe(initial.baseRevision);
      }
      expect(fs.readFileSync(path.join(root, 'game.config.json'))).toEqual(beforeConfig);
      expect(fs.readFileSync(path.join(root, 'content', 'scenario', 'start.gal'))).toEqual(beforeScene);
      expect(fs.readdirSync(path.join(root, 'content', 'scenario'))).toEqual(['start.gal']);
    } finally { await session.close(); }
  });

  it('keeps candidate mode through apply resume and leaves new apply/service changes direct', async () => {
    const { root } = fixture();
    const stage = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    const invalid = await stage.invoke('change.begin', { compositionMode: 'automatic' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    result(await stage.invoke('change.begin', {}));
    const changeId = stage.activeChangeId!;
    await stage.close();
    const resumed = await openAgentPortSession({ projectRoot: root, policy: 'apply', resumeChangeId: changeId });
    expect((await resumed.describe()).candidateReadiness).toMatchObject({ mode: 'candidate', status: 'ready' });
    expect(await resumed.invoke('scene.create', { operationId: 'missing', sceneId: 'entry', blocks: [{ kind: 'instruction', name: 'jump', args: ['missing'] }] })).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY' } });
    await resumed.close();
    const direct = await openAgentPortSession({ projectRoot: root, policy: 'apply' });
    result(await direct.invoke('change.begin', {}));
    expect((await direct.describe()).candidateReadiness).toMatchObject({ mode: 'direct', status: 'not-applicable' });
    result(await direct.invoke('scene.create', { operationId: 'direct-reference', sceneId: 'direct', blocks: [{ kind: 'instruction', name: 'jump', args: ['missing'] }] }));
    await direct.close();
    const serviceChange = await new AuthoringService().begin(root);
    expect((await NodeChangeStore.openByChangeId(serviceChange.result.changeId))!.record.composition?.mode).toBe('direct');
  });

  it('reports an old open record as unavailable without adding temporal metadata', async () => {
    const { root } = fixture();
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    result(await session.invoke('change.begin', {}));
    await NodeChangeStore.withChangeLease(session.activeChangeId!, async (store) => {
      const record = (await store.read(session.activeChangeId!))!;
      Object.assign(record.composition!, { operationFactsVersion: '2.0.0' });
      await store.write({ ...record, recordVersion: record.recordVersion + 1 }, { expectedRecordVersion: record.recordVersion, expectedStatus: record.status });
    });
    const unsupported = (await session.describe()).candidateReadiness;
    expect(unsupported).toMatchObject({ mode: 'candidate', status: 'blocked', issues: [expect.objectContaining({ code: 'OPERATION_FACTS_INVALID' })] });
    expect((await standardSchemaFromJson(CANDIDATE_COMPOSITION_READINESS_SCHEMA)['~standard'].validate(unsupported)).issues).toBeUndefined();
    await NodeChangeStore.withChangeLease(session.activeChangeId!, async (store) => {
      const record = (await store.read(session.activeChangeId!))!;
      delete record.composition;
      await store.write({ ...record, recordVersion: record.recordVersion + 1 }, { expectedRecordVersion: record.recordVersion, expectedStatus: record.status });
    });
    expect((await session.describe()).candidateReadiness).toMatchObject({ mode: 'legacy-unclassified', status: 'legacy-unavailable' });
    expect((await session.describe()).nextActions).toEqual(['change.diff', 'change.rollback']);
    const capsule = await generateDeliveryCapsule(session);
    expect(capsule.composition).toMatchObject({ eligibility: 'unavailable', reasons: [expect.objectContaining({ code: 'OPERATION_FACTS_MISSING' })] });
    expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record).not.toHaveProperty('composition');
    await session.close();
  });

  it('freezes resolved assets at begin instead of admitting files added later', async () => {
    const { root } = fixture();
    const assetDir = path.join(root, 'content', 'assets', 'bg');
    fs.mkdirSync(assetDir, { recursive: true });
    fs.writeFileSync(path.join(assetDir, 'initial.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    result(await session.invoke('change.begin', {}));
    expect((await NodeChangeStore.openByChangeId(session.activeChangeId!))!.record.composition).toEqual({ mode: 'candidate', operationFactsVersion: '1.0.0', baseAssetRefs: ['asset:bg:initial'] });
    fs.writeFileSync(path.join(assetDir, 'later.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(await session.invoke('scene.create', { operationId: 'late-asset', sceneId: 'late', blocks: [{ kind: 'instruction', name: 'bg', args: ['later'] }] })).toMatchObject({ ok: false, error: { code: 'CANDIDATE_DEPENDENCY_NOT_READY' } });
    await session.close();
  });

  it('validates strict mode/status and nested readiness fields under contract 2.22', async () => {
    expect(AUTHORING_CONTRACT_VERSION).toBe('2.22.0');
    const schema = standardSchemaFromJson(CANDIDATE_COMPOSITION_READINESS_SCHEMA);
    const readiness = { mode: 'candidate', status: 'ready', operationFactsVersion: '1.0.0', operationCount: 0, issueCount: 0, issues: [], truncated: false };
    expect((await schema['~standard'].validate(readiness)).issues).toBeUndefined();
    expect((await schema['~standard'].validate({ ...readiness, status: 'not-applicable' })).issues).toBeDefined();
    expect((await schema['~standard'].validate({ ...readiness, extra: true })).issues).toBeDefined();
    expect((await schema['~standard'].validate({ ...readiness, issues: [{ code: 'OPERATION_FACTS_MISSING', message: 'old', extra: true }] })).issues).toBeDefined();
  });
});
