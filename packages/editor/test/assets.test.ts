/** 编辑器素材交互适配器测试：插入行构造与目录命名约定。 */
import { describe, expect, it } from 'vitest';
import { galleryUnlockEntries, insertLineForAsset, parsePortraitFileName, kindOfDir } from '../src/assets.js';
import type { DirAsset } from '../src/assets.js';

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

describe('galleryUnlockEntries（鉴赏条目插入能力）', () => {
  it('保留 CG、鉴赏音乐和回想三类既有指令入口', () => {
    const entries = galleryUnlockEntries({
      cgs: [{ id: 'cg_hall', src: 'castle_hall' }],
      music: [{ id: 'memory_theme', src: 'chapter_theme' }],
      texts: [{ id: 'first_meeting', scene: 'ch01' }],
    });

    expect(entries.map((entry) => [entry.kind, entry.key, insertLineForAsset(entry)])).toEqual([
      ['cg', 'cg_hall', '@unlock_cg cg_hall'],
      ['music', 'memory_theme', '@unlock_music memory_theme'],
      ['text', 'first_meeting', '@unlock_text first_meeting'],
    ]);
  });
});

describe('素材目录约定助手', () => {
  it('kindOfDir 识别六类目录，未知目录返回 null', () => {
    expect(kindOfDir('bg')).toBe('bg');
    expect(kindOfDir('portrait')).toBe('portrait');
    expect(kindOfDir('voice')).toBe('voice');
    expect(kindOfDir('MUSIC')).toBe('bgm');
    expect(kindOfDir('AmBiEnCe')).toBe('ambience');
    expect(kindOfDir('random_dir')).toBeNull();
  });
  it('parsePortraitFileName：角色_服装_表情 → 角色:服装 + 表情（缺段补 normal）', () => {
    expect(parsePortraitFileName('lynn_armor_despair.png')).toEqual({ key: 'lynn:armor', expr: 'despair' });
    expect(parsePortraitFileName('lynn_uniform.jpg')).toEqual({ key: 'lynn:uniform', expr: 'normal' });
  });
});
