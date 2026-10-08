import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { collectProjectTextRows, hintForCode, projectTextSources } from '@surdet/core';
import { validateProject } from '../src/validate.js';

const sc = (id: string, source: string, key?: string) => ({
  key: key ?? id,
  id,
  file: id + '.gal',
  source,
});

describe('validateProject', () => {
  it('gives editor-only checks the same code-specific advice as surdet lint', async () => {
    const result = await validateProject([sc('a', '@scene a\n@label unused\n凛：继续。\n@end')], 'a', { path: 'game.config.json', raw: { entryScene: 'a' } });
    const unused = result.issues.find(issue => issue.code === 'W006');
    expect(unused?.hint).toBe(hintForCode('W006'));
    expect(result.issues.every(issue => typeof issue.hint === 'string' && issue.hint.length > 0)).toBe(true);
  });

  it.each([
    { name: 'absent without unlocks', source: '@scene a\n凛：继续。\n@end', lines: [] },
    { name: 'absent with dossiers', source: '@scene a\n@unlock_profile "first"\n@unlock_term port\n@end', lines: [2, 3] },
    { name: 'empty with dossiers', source: '@scene a\n@unlock_profile "first"\n@unlock_term port\n@end', gallery: { cgs: [], music: [] }, lines: [2, 3] },
    { name: 'defined dossiers', source: '@scene a\n@unlock_profile "first"\n@unlock_term port\n@end', gallery: { cgs: [], music: [], profiles: [{ id: 'first', character: 'rin' }], terms: [{ id: 'port', canonical: '雾港' }] }, lines: [] },
  ])('validates gallery references: $name', async ({ source, gallery, lines }) => {
    const config = { path: 'game.config.json', raw: { entryScene: 'a', characters: { rin: { name: '凛' } } },
      terminologyText: '{"terms":[{"canonical":"雾港","variants":[]}]}',
      ...(gallery ? { galleryText: JSON.stringify(gallery) } : {}),
    };
    const result = await validateProject([sc('a', source)], 'a', config);
    expect(result.issues.filter(issue => issue.severity === 'error')).toHaveLength(lines.length);
    expect(result.issues.filter(issue => issue.code === 'G006').map(issue => ({ file: issue.file, line: issue.line })))
      .toEqual(lines.map(line => ({ file: 'a.gal', line })));
  });

  it.each(['', '\uFEFF'])('uses exact source hashes and current terminology without false stale warnings (%j BOM)', async bom => {
    const text = `${bom}@scene start\r\n旁白：雾港。\r\n@end\r\n`, terminology = { terms: [{ canonical: '雾港', variants: [] }] };
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    const sources = await projectTextSources(collectProjectTextRows({}, [{ id: 'start', path: 'start.gal', text, sha256: hash(text) }], terminology), async value => hash(value));
    const entries = sources.map(({ sourceId, path, line, ...source }, i) => ({ key: `text.${i}`, source, translations: {} }));
    const config = { path: 'game.config.json', raw: { entryScene: 'start', textCatalog: { version: 1, sourceLocale: 'zh-CN', entries } }, terminologyText: JSON.stringify(terminology) };
    expect((await validateProject([sc('start', text)], 'start', config)).issues.filter(issue => issue.code?.startsWith('TEXT_'))).toEqual([]);
    const changed = [sc('start', text + '\r\n// unsaved source change')];
    expect((await validateProject(changed, 'start', config)).issues.filter(issue => issue.code === 'TEXT_SOURCE_STALE')).toHaveLength(1);
    config.terminologyText = '{"terms":[]}';
    expect((await validateProject(changed, 'start', config)).issues.filter(issue => issue.code === 'TEXT_SOURCE_STALE')).toHaveLength(2);
  });
  it('跨场景 jump 目标不存在 → error', async () => {
    const r = await validateProject([sc('a', '凛：x\n@jump ghost')]);
    expect(r.issues.some((i) => i.severity === 'error' && i.text.includes('不存在'))).toBe(true);
  });

  it('合法项目：jump/call 目标存在 → 无 error', async () => {
    const r = await validateProject([
      sc('a', '凛：x\n@jump b.start'),
      sc('b', '@label start\n凛：y'),
    ], 'a');
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('@switch 目标标签不存在 → error；存在则无', async () => {
    const bad = await validateProject([sc('a', '@set x = 1\n@switch x 1:ghost')], undefined, {
      raw: { variables: { x: { type: 'number', initial: 0 } } },
      path: 'game.config.json',
    });
    expect(bad.issues.some((i) => i.text.includes('@switch'))).toBe(true);
    const ok = await validateProject([sc('a', '@set x = 1\n@switch x 1:t\n@label t\n凛：ok')], undefined, {
      raw: { variables: { x: { type: 'number', initial: 0 } } },
      path: 'game.config.json',
    });
    expect(ok.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('未使用标签 → warning；不可达场景 → warning', async () => {
    const r = await validateProject([
      sc('a', '@label unused\n凛：x'),
      sc('orphan', '凛：孤岛'),
    ], 'a');
    expect(r.issues.some((i) => i.text.includes('从未被'))).toBe(true);
    expect(r.issues.some((i) => i.text.includes('不可达'))).toBe(true);
  });

  it('M4：子目录同名场景（key 不同、basename 相同）→ LINT_DUP error', async () => {
    const r = await validateProject([
      sc('ch01', '凛：x', 'ch01'),
      sc('ch01', '凛：y', 'sub/ch01'),
    ]);
    expect(r.issues.some((i) => i.code === 'LINT_DUP' && i.severity === 'error')).toBe(true);
  });

  it('M5：变量声明交叉校验与 CLI 同源（未声明变量 V001/V002）', async () => {
    const r = await validateProject(
      [sc('a', '@set ghost = 1\n凛：{ghost2}')],
      undefined,
      { raw: { variables: { x: { type: 'number', initial: 0 } } }, path: 'game.config.json' },
    );
    expect(r.issues.some((i) => i.code === 'V001')).toBe(true);
    expect(r.issues.some((i) => i.code === 'V002')).toBe(true);
  });

  it('M5：customInstructions 传入后自定义指令不报 W001', async () => {
    const withCustom = await validateProject(
      [sc('a', '@my_custom 123')],
      undefined,
      { raw: { customInstructions: ['my_custom'] }, path: 'game.config.json' },
    );
    expect(withCustom.issues.some((i) => i.code === 'W001')).toBe(false);
    const without = await validateProject([sc('a', '@my_custom 123')]);
    expect(without.issues.some((i) => i.code === 'W001')).toBe(true);
  });
});

/* ============ Reliability Phase 2C（A3）：Editor 实时校验接入真实 timelines ============ */

const introTimelineText = JSON.stringify({
  version: 1,
  id: 'intro_cine',
  durationMs: 900,
  tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 1 }] }],
});
const tl = (id: string) => ({ path: `content/timelines/${id}.json`, text: introTimelineText.replace('"intro_cine"', `"${id}"`) });

describe('timeline reference validation wiring (Phase 2C)', () => {
  it('E1: 合法 timeline 存在于项目 timelines → 不报 TIMELINE_MISSING', async () => {
    const r = await validateProject(
      [sc('a', '@scene a\n@timeline intro_cine @ blocking\n凛：x\n@end')],
      undefined,
      undefined,
      [tl('intro_cine')],
    );
    expect(r.issues.some((i) => i.code === 'TIMELINE_MISSING')).toBe(false);
  });

  it('E2: 引用不存在的 timeline → 报 TIMELINE_MISSING', async () => {
    const r = await validateProject(
      [sc('a', '@scene a\n@timeline ghost_cine @ blocking\n凛：x\n@end')],
      undefined,
      undefined,
      [tl('intro_cine')],
    );
    const missing = r.issues.find((i) => i.code === 'TIMELINE_MISSING');
    expect(missing).toBeDefined();
    expect(missing!.text).toContain("'ghost_cine'");
  });

  it('E3: 项目无任何 timeline 文件且引用 ghost → 仍报 TIMELINE_MISSING（不依赖 count gate）', async () => {
    const r = await validateProject(
      [sc('a', '@scene a\n@timeline ghost_cine @ blocking\n凛：x\n@end')],
      undefined,
      undefined,
      [],
    );
    expect(r.issues.some((i) => i.code === 'TIMELINE_MISSING' && i.text.includes("'ghost_cine'"))).toBe(true);
  });
});
