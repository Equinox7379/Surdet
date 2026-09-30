import { describe, expect, it } from 'vitest';
import { buildGalleryViews } from '../src/gallery.js';
import type { GalleryConfig } from '../src/gallery.js';
import { buildBattleView } from '../src/battle-view.js';
import type { CombatSnapshot } from '@surdet/core';

const config: GalleryConfig = {
  cgs: [
    { id: 'cg1', name: '初遇', src: 'bg_a' },
    { id: 'cg2', name: '告别' },
  ],
  music: [{ id: 'm1', name: '主题曲', src: 'theme.mp3' }],
};

describe('buildGalleryViews', () => {
  it('masks every locked dossier field and uses the supplied character/term names for unlocked fragments', () => {
    const metadata = { ...config, profiles: [{ id: 'rin.first', character: 'rin', title: '初见', description: '相遇。' }, { id: 'rin.secret', character: 'rin', title: '秘密', description: '剧透。' }], terms: [{ id: 'port', canonical: '雾港', description: '小城。' }] };
    const views = buildGalleryViews(metadata, { cgs: [], music: [], profiles: ['rin.first', 'removed'] }, { characters: { rin: 'Rin' }, terms: { 雾港: 'Harbor' } });
    expect(views.profiles[0]).toMatchObject({ name: 'Rin · 初见', description: '相遇。', unlocked: true });
    expect(views.profiles[1]).toEqual({ id: 'rin.secret', name: '???', description: undefined, unlocked: false });
    expect(views.terms[0]).toEqual({ id: 'port', name: '???', description: undefined, unlocked: false });
    expect(JSON.stringify(views)).not.toContain('秘密'); expect(JSON.stringify(views)).not.toContain('小城。');
  });
  it('masks locked ending names and descriptions and counts only configured entries', () => {
    const endings = buildGalleryViews({ ...config, endings: [
      { id: 'home', name: '归途', description: '雨停了。' }, { id: 'secret', name: '秘密结局', description: '剧透' },
    ] }, { cgs: [], music: [], endings: ['removed', 'home', 'home'] }).endings;
    expect(endings).toEqual([{ id: 'home', name: '归途', description: '雨停了。', unlocked: true },
      { id: 'secret', name: '???', description: undefined, unlocked: false }]);
    expect(endings.filter(entry => entry.unlocked)).toHaveLength(1);
    expect(buildGalleryViews(config, { cgs: [], music: [] }).endings).toEqual([]);
  });
  it('已解锁条目保留名称，未解锁标记 unlocked=false', () => {
    const views = buildGalleryViews(config, { cgs: ['cg1'], music: [] });
    expect(views.cgs[0]).toEqual({ id: 'cg1', name: '初遇', unlocked: true, src: 'bg_a' });
    expect(views.cgs[1]!.unlocked).toBe(false);
    expect(views.music[0]!.unlocked).toBe(false);
  });

  it('解锁集合中的未知 id 不影响列表（只按配置展示）', () => {
    const views = buildGalleryViews(config, { cgs: ['ghost'], music: ['ghost'] });
    expect(views.cgs.every((c) => !c.unlocked)).toBe(true);
    expect(views.music.every((m) => !m.unlocked)).toBe(true);
  });

  it('顺序与配置一致', () => {
    const views = buildGalleryViews(config, { cgs: [], music: [] });
    expect(views.cgs.map((c) => c.id)).toEqual(['cg1', 'cg2']);
  });
});

describe('buildBattleView', () => {
  const snap: CombatSnapshot = {
    turn: 3,
    actingTeam: 'allies',
    winner: null,
    finished: false,
    units: [
      { uid: 'allies_0', defId: 'sword', name: '剑士', team: 'allies', hp: 5, maxHp: 20, atk: 5, def: 2, range: 1, move: 2, kind: 'human', skills: [], alive: true, position: 0, cooldowns: {} },
      { uid: 'enemies_0', defId: 'goblin', name: '哥布林', team: 'enemies', hp: 0, maxHp: 10, atk: 3, def: 0, range: 1, move: 1, kind: 'beast', skills: [], alive: false, position: 1, cooldowns: {} },
    ],
  };

  it('映射单位与血量比例', () => {
    const v = buildBattleView(snap);
    expect(v.turn).toBe(3);
    expect(v.actingTeam).toBe('allies');
    expect(v.units[0]).toMatchObject({ uid: 'allies_0', hpRatio: 0.25, alive: true });
    expect(v.units[1]).toMatchObject({ uid: 'enemies_0', hpRatio: 0, alive: false });
  });

  it('maxHp 为 0 时 hpRatio 安全为 0（不产生 NaN）', () => {
    const v = buildBattleView({ ...snap, units: [{ ...snap.units[0]!, maxHp: 0, hp: 0 }] });
    expect(v.units[0]!.hpRatio).toBe(0);
  });
});
