/**
 * E2 素材清单纯逻辑测试：三源汇总（目录/gallery/剧本）、使用统计、插入行构造。
 */
import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import type { CompiledScene } from '@surdet/core';
import { buildAssetInventory, insertLineForAsset, parsePortraitFileName, kindOfDir } from '../src/assets.js';
import type { DirAsset } from '../src/assets.js';

function scenesOf(entries: [string, string][]): Map<string, CompiledScene> {
  const m = new Map<string, CompiledScene>();
  for (const [id, src] of entries) m.set(id, compileScene(src, `${id}.gal`, id));
  return m;
}

const gallery = {
  cgs: [{ id: 'cg_hall', name: '大厅', src: 'castle_hall' }],
  music: [{ id: 'tense_01', name: '紧张', src: 'tense_01' }],
  texts: [{ id: 't_first', name: '初见', scene: 'ch01_01' }],
};

describe('buildAssetInventory（三源汇总）', () => {
  it('剧本指令参数产出素材条目并记录引用场景', () => {
    const scenes = scenesOf([
      ['ch1', '@bg castle_hall\n@bgm tense_01\n@show lynn:armor despair\n凛：好。\n'],
      ['ch2', '@bg night_field\n@voice lynn_01\n'],
    ]);
    const inv = buildAssetInventory({ dirAssets: [], gallery: null, scenes });
    const byKey = new Map(inv.map((e) => [e.key, e]));
    expect(byKey.get('castle_hall')?.kind).toBe('bg');
    expect(byKey.get('castle_hall')?.usedBy).toEqual(['ch1']);
    expect(byKey.get('lynn:armor')?.kind).toBe('portrait');
    expect(byKey.get('lynn:armor')?.exprs).toEqual(['despair']);
    expect(byKey.get('night_field')?.usedBy).toEqual(['ch2']);
    expect(byKey.get('lynn_01')?.kind).toBe('voice');
  });

  it('gallery.json 产出 cg/music/text 条目；unlock_* 关联 src 资源视为间接使用', () => {
    const scenes = scenesOf([
      ['ch1', '@unlock_cg cg_hall\n@unlock_music tense_01\n@unlock_text t_first\n'],
    ]);
    const inv = buildAssetInventory({ dirAssets: [], gallery, scenes });
    const byKey = new Map(inv.map((e) => [e.key, e]));
    expect(byKey.get('cg_hall')?.kind).toBe('cg');
    expect(byKey.get('cg_hall')?.assetSrc).toBe('castle_hall');
    expect(byKey.get('cg_hall')?.usedBy).toEqual(['ch1']);
    expect(byKey.get('t_first')?.kind).toBe('text');
    expect(byKey.get('tense_01')?.usedBy).toEqual(['ch1']);
  });

  it('目录条目打底且来源优先级 dir > gallery > script；同 key 合并 usedBy', () => {
    const dirAssets: DirAsset[] = [
      { key: 'castle_hall', kind: 'bg', handle: null, isImage: true },
      { key: 'lynn:armor', kind: 'portrait', expr: 'normal', handle: null, isImage: true },
    ];
    const scenes = scenesOf([
      ['ch1', '@bg castle_hall\n@show lynn:armor despair\n'],
      ['ch2', '@bg castle_hall\n'],
    ]);
    const inv = buildAssetInventory({ dirAssets, gallery: null, scenes });
    const byKey = new Map(inv.map((e) => [e.key, e]));
    expect(byKey.get('castle_hall')?.source).toBe('dir');
    expect(byKey.get('castle_hall')?.usedBy.sort()).toEqual(['ch1', 'ch2']);
    expect(byKey.get('lynn:armor')?.exprs?.sort()).toEqual(['despair', 'normal']);
  });

  it('0 引用条目也列出（usedBy 为空，UI 标灰提示声明未用）', () => {
    const dirAssets: DirAsset[] = [{ key: 'unused_bg', kind: 'bg', handle: null, isImage: true }];
    const inv = buildAssetInventory({ dirAssets, gallery: null, scenes: new Map() });
    expect(inv).toHaveLength(1);
    expect(inv[0]!.usedBy).toEqual([]);
  });
});

describe('insertLineForAsset（插入辅助）', () => {
  const mk = (key: string, kind: DirAsset['kind'], exprs?: string[]) => ({ key, kind, source: 'script' as const, usedBy: [], exprs });
  it('各类型生成对应指令行', () => {
    expect(insertLineForAsset(mk('castle_hall', 'bg'))).toBe('@bg castle_hall');
    expect(insertLineForAsset(mk('tense_01', 'bgm'))).toBe('@bgm tense_01');
    expect(insertLineForAsset(mk('boom', 'se'))).toBe('@se boom');
    expect(insertLineForAsset(mk('lynn_01', 'voice'))).toBe('@voice lynn_01');
    expect(insertLineForAsset(mk('op', 'video'))).toBe('@video op');
    expect(insertLineForAsset(mk('cg_hall', 'cg'))).toBe('@unlock_cg cg_hall');
    expect(insertLineForAsset(mk('m1', 'music'))).toBe('@unlock_music m1');
    expect(insertLineForAsset(mk('t1', 'text'))).toBe('@unlock_text t1');
  });
  it('立绘用已知情报表情，缺省 normal', () => {
    expect(insertLineForAsset(mk('lynn:armor', 'portrait', ['despair', 'normal']))).toBe('@show lynn:armor despair');
    expect(insertLineForAsset(mk('lynn:uniform', 'portrait'))).toBe('@show lynn:uniform normal');
  });
});

describe('素材目录约定助手', () => {
  it('kindOfDir 识别六类目录，未知目录返回 null', () => {
    expect(kindOfDir('bg')).toBe('bg');
    expect(kindOfDir('portrait')).toBe('portrait');
    expect(kindOfDir('voice')).toBe('voice');
    expect(kindOfDir('random_dir')).toBeNull();
  });
  it('parsePortraitFileName：角色_服装_表情 → 角色:服装 + 表情（缺段补 normal）', () => {
    expect(parsePortraitFileName('lynn_armor_despair.png')).toEqual({ key: 'lynn:armor', expr: 'despair' });
    expect(parsePortraitFileName('lynn_uniform.jpg')).toEqual({ key: 'lynn:uniform', expr: 'normal' });
  });
});
