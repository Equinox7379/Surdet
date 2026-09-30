import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readGalleryDossiers } from '../src/systems/gallery-dossiers.js';
import { GalleryState, effectiveGalleryUnlocks, readGalleryUnlockPolicy } from '../src/systems/gallery-state.js';
import { compileScene } from '../src/dsl/compiler.js';
import { Interpreter, type CoreEventMap } from '../src/runtime/interpreter.js';
import type { SaveSnapshot } from '../src/save/save-manager.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { VariableStore } from '../src/state/variable-store.js';
import { collectProjectTextRows, projectTextSources, createProjectTextResolver, readTextCatalog } from '../src/project-texts.js';

const metadata = { profiles: [{ id: 'rin.first', character: 'rin', title: '初见', description: '在车站相遇。' }], terms: [{ id: 'harbor', canonical: '雾港', description: '海边的小城。' }] };

describe('character dossiers and glossary', () => {
  it('checks shape, duplicate IDs and real character/canonical references', () => {
    expect(readGalleryDossiers(metadata, { characters: { rin: {} }, terms: ['雾港'] })).toEqual(metadata);
    for (const value of [{ profiles: null }, { profiles: [{ id: 'x', character: ' ' }] }, { terms: [...metadata.terms, ...metadata.terms] }]) expect(() => readGalleryDossiers(value)).toThrow();
    expect(() => readGalleryDossiers(metadata, { characters: {}, terms: ['雾港'] })).toThrow('人物不存在');
    expect(() => readGalleryDossiers(metadata, { characters: { rin: {} }, terms: [] })).toThrow('规范词不存在');
  });
  it('restores old and current saves and keeps permanent data out of story state', () => {
    const state = new GalleryState(), old = state.snapshot();
    expect(state.unlockProfile('rin.first')).toBe(true); expect(state.unlockProfile('rin.first')).toBe(false);
    state.unlockTerm('harbor'); const saved = state.snapshot();
    state.restore(old); expect(state.snapshot()).toEqual(old);
    const policy = readGalleryUnlockPolicy({ unlockPolicy: { profiles: 'profile' } });
    expect(effectiveGalleryUnlocks(old, saved, policy)).toMatchObject({ profiles: ['rin.first'], terms: [] });
    expect(state.snapshot()).toEqual(old);
    state.restore(saved); expect(state.snapshot()).toEqual(saved);
  });
  it('translates names, dossier titles and descriptions with stale translation fallback', async () => {
    const config = { characters: { rin: { name: '凛' } } };
    const sources = await projectTextSources(collectProjectTextRows(config, [], { terms: [{ canonical: '雾港', variants: [] }] }, metadata), text => Promise.resolve(createHash('sha256').update(text).digest('hex')));
    const description = sources.find(source => source.kind === 'gallery' && source.objectRef === 'gallery:terms:harbor' && source.field === 'description')!;
    const { sourceId, path, line, ...bound } = description;
    const catalog = readTextCatalog({ textCatalog: { version: 1, sourceLocale: 'zh-CN', entries: [{ key: 'harbor.desc', source: bound, translations: { en: { value: 'A seaside town.', sourceVersion: description.version } } }] } });
    const resolver = createProjectTextResolver(catalog, sources);
    expect(resolver.field('gallery', 'gallery:terms:harbor', '海边的小城。', 'en', 'description')).toBe('A seaside town.');
    expect(resolver.field('gallery', 'gallery:terms:harbor', '已经修改。', 'en', 'description')).toBe('已经修改。');
    expect(sources.map(source => source.kind)).toEqual(expect.arrayContaining(['character', 'term', 'gallery']));
  });
  it('executes quoted dossier unlocks and validates failed loads before mutating current progress', () => {
    const bus = new EventBus<CoreEventMap>(), registry = new SceneRegistry(), store = new VariableStore([]);
    const interp = new Interpreter(store, bus, registry);
    const events: string[] = []; bus.on('gallery', event => events.push(`${event.type}:${event.id}:${event.fresh}`));
    registry.register(compileScene('@unlock_profile "rin.first"\n@unlock_term harbor\n@unlock_profile "rin.first"\n旁白：继续。', 'main.gal', 'main'));
    interp.start('main');
    const saved = interp.saveSnapshot()!;
    expect(saved.gallery).toMatchObject({ profiles: ['rin.first'], terms: ['harbor'] });
    expect(events).toEqual(['profile:rin.first:true', 'term:harbor:true', 'profile:rin.first:false']);
    const bad = { ...saved, gallery: { ...saved.gallery, profiles: [1] } } as unknown as SaveSnapshot;
    expect(() => interp.loadSnapshot(bad)).toThrow('gallery.profiles');
    expect(interp.gallery.snapshot()).toEqual(saved.gallery);
    interp.gallery.restore({ cgs: [], music: [] }); interp.loadSnapshot(saved);
    expect(interp.gallery.snapshot()).toEqual(saved.gallery);
  });
});
