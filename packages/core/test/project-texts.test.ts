import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { collectProjectTextRows, projectTextSources, createProjectTextResolver, readTextCatalog, isStoryTextSource, type TextCatalog } from '../src/project-texts.js';
import { compileScene } from '../src/dsl/compiler.js';
import { Interpreter, type CoreEventMap } from '../src/runtime/interpreter.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { VariableStore } from '../src/state/variable-store.js';

const sha256 = async (text: string) => createHash('sha256').update(text).digest('hex');
const script = '@scene intro\n@label start\n@set hits += 1\nrin：你好，{name}。\n@choice\n  隐藏 [if: false] -> @goto end\n  前往 {name} [if: true] -> @goto end\n@label end\n结尾。\n@end\n';
const config = { characters: { rin: { name: '凛' } }, ui: { version: 1, pages: { title: {
  id: 'start', type: 'button', frame: { x: 0, y: 0, width: 150, height: 40 }, text: { kind: 'literal', value: '开始' }, action: { kind: 'start' },
} } } };
async function fixture(text = script) {
  const scene = { id: 'intro', path: 'content/scenario/intro.gal', text, sha256: await sha256(text) };
  const sources = await projectTextSources(collectProjectTextRows(config, [scene], { terms: [{ canonical: '雾港', variants: [] }] }), sha256);
  const translate = (text: string, locale: string) => text === '你好，{name}。' ? locale === 'en' ? 'Hello, {name}.' : 'こんにちは、{name}。'
    : text === '前往 {name}' ? locale === 'en' ? 'Go {name}' : '{name}へ' : `${locale}:${text}`;
  const catalog: TextCatalog = { version: 1, sourceLocale: 'zh-CN', entries: sources.map(({ sourceId, path, line, ...source }, i) => ({
    key: `text.${i}`, source, translations: Object.fromEntries(['en', 'ja'].map(locale => [locale, { value: translate(source.text, locale), sourceVersion: source.version }])),
  })) };
  const resolver = createProjectTextResolver(readTextCatalog({ textCatalog: catalog }), sources);
  return { scene, sources, catalog, resolver };
}

describe('project text source and playback contract', () => {
  it('shares stable scene coordinates and explicit display-field references', async () => {
    const { sources, resolver } = await fixture();
    expect(sources.filter(isStoryTextSource).map(source => source.sourceId)).toEqual(['["intro","start",0]', '["intro","start",1]', '["intro","start",2]', '["intro","end",0]']);
    expect(resolver.field('character', 'character:rin', '凛', 'en')).toBe('en:凛');
    expect(resolver.field('ui', 'ui:start', '开始', 'ja')).toBe('ja:开始');
    expect(resolver.field('term', 'term:雾港', '雾港', 'en')).toBe('en:雾港');
    expect(resolver.locales).toEqual(['zh-CN', 'en', 'ja']);
    expect(resolver.diagnostics('en')).toEqual([]);
  });
  it('falls back on stale scene/field content or missing/stale translations without guessing a nearby line', async () => {
    const { catalog, scene } = await fixture();
    const changed = { ...scene, text: script.replace('rin：', '新增。\nrin：') }; changed.sha256 = await sha256(changed.text);
    const changedSources = await projectTextSources(collectProjectTextRows({ ...config, characters: { rin: { name: '新名字' } } }, [changed]), sha256);
    const stale = createProjectTextResolver(catalog, changedSources);
    expect(stale.story('intro', 5, 'dialogue', '你好，{name}。', 'en', changed.sha256)).toBe('你好，{name}。');
    expect(stale.field('character', 'character:rin', '新名字', 'en')).toBe('新名字');
    expect(stale.diagnostics('en').some(issue => issue.includes('来源变化'))).toBe(true);
    const f = await fixture(); delete f.catalog.entries[0]!.translations.en;
    f.catalog.entries[1]!.translations.en!.sourceVersion = '0'.repeat(64);
    const fallback = createProjectTextResolver(f.catalog, f.sources);
    expect(fallback.story('intro', 4, 'dialogue', '你好，{name}。', 'en', scene.sha256)).toBe('你好，{name}。');
    expect(fallback.story('intro', 6, 'choice', '隐藏', 'en', scene.sha256)).toBe('隐藏');
    expect(fallback.diagnostics('en')).toHaveLength(2);
  });
  it.each(['zh-CN', 'en', 'ja'])('keeps %s route, variables, save positions and original choice indices unchanged', async locale => {
    const { scene, resolver } = await fixture();
    const bus = new EventBus<CoreEventMap>(), registry = new SceneRegistry();
    registry.register({ ...compileScene(script, scene.path, scene.id), textSourceVersion: scene.sha256 });
    const store = new VariableStore([{ name: 'hits', type: 'number', initial: 0 }, { name: 'name', type: 'string', initial: '凛' }]);
    const interpreter = new Interpreter(store, bus, registry);
    let activeLocale = locale;
    interpreter.setTextResolver(source => source.kind === 'speaker' ? source.text : resolver.story(source.sceneId, source.line, source.kind, source.text, activeLocale, source.sceneVersion ?? ''));
    const spoken: string[] = [], refreshed: CoreEventMap['textRefresh'][] = [], choices: CoreEventMap['choice'][] = [];
    bus.on('text', event => spoken.push(event.value)); bus.on('textRefresh', event => refreshed.push(event)); bus.on('choice', event => choices.push(event));
    interpreter.start('intro');
    expect(spoken).toEqual([locale === 'en' ? 'Hello, 凛.' : locale === 'ja' ? 'こんにちは、凛。' : '你好，凛。']);
    const before = interpreter.saveSnapshot()!;
    activeLocale = 'ja'; interpreter.refreshDisplayedText();
    expect(refreshed[0]!.text!.value).toBe('こんにちは、凛。'); expect(spoken).toHaveLength(1);
    for (const key of ['position', 'variables', 'readSet', 'callStack'] as const) expect(interpreter.saveSnapshot()![key]).toEqual(before[key]);
    interpreter.advance(); expect(choices[0]!.options).toEqual([{ index: 1, label: '凛へ' }]);
    activeLocale = 'en'; interpreter.refreshDisplayedText();
    expect(refreshed.at(-1)!.choices!.options).toEqual([{ index: 1, label: 'Go 凛' }]);
    interpreter.choose(1); expect(store.get('hits')).toBe(1);
    interpreter.loadSnapshot(before); // Saved under an earlier locale, restored with current preference.
    expect(spoken.at(-1)).toBe('Hello, 凛.'); expect(store.get('hits')).toBe(1);
    expect(interpreter.saveSnapshot()!.position).toEqual(before.position);
  });
});
