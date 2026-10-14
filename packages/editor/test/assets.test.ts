/** 编辑器素材交互适配器测试：插入行构造与目录命名约定。 */
import { describe, expect, it } from 'vitest';
import { galleryUnlockEntries, insertLineForAsset, parsePortraitFileName, projectPortraitAssets, kindOfDir } from '../src/assets.js';
import type { DirAsset } from '../src/assets.js';
import { compileScene, decodeStageToken, EventBus, Interpreter, SceneRegistry, VariableStore, type CoreEventMap } from '@surdet/core';
import { appendLineToScene } from '../src/scene-text.js';

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
  it.each(['bg', 'bgm', 'ambience', 'se', 'voice', 'video', 'portrait'] as const)('A014 preserves the real %s argument, not lexer tokens', kind => {
    const key = '雨夜 @主题';
    const source = insertLineForAsset(mk(key, kind, ['微 笑']))!;
    const registry = new SceneRegistry();
    registry.register(compileScene(source, 'start.gal', 'start'));
    const bus = new EventBus<CoreEventMap>();
    const events: CoreEventMap['instr'][] = [];
    const videos: string[] = [];
    bus.on('instr', event => events.push(event));
    bus.on('video', event => videos.push(decodeStageToken(event.src)));
    const interpreter = new Interpreter(new VariableStore(), bus, registry);
    interpreter.start('start');
    if (kind === 'video') { expect(videos).toEqual([key]); return; }
    const event = events[0]!;
    expect(event.args.map(decodeStageToken)).toEqual(kind === 'portrait' ? [key, '微 笑'] : [key]);
    expect(event.modifiers.size).toBe(0);
  });
  it.each(['\n', '\r\n', '\r'])('A015 inserts before the exit and preserves %j source and trailing comments', eol => {
    const original = ['@scene start', '// 原有注释', '@end', '// 保留结尾', ''].join(eol);
    const result = appendLineToScene(original, eol, '@bg harbor');
    expect(result).toBe(original.replace('@end', `@bg harbor${eol}@end`));
    const registry = new SceneRegistry();
    registry.register(compileScene(result, 'start.gal', 'start'));
    const bus = new EventBus<CoreEventMap>();
    const names: string[] = [];
    bus.on('instr', event => names.push(event.name));
    new Interpreter(new VariableStore(), bus, registry).start('start');
    expect(names).toContain('bg');
  });
  it('A015 does not split a conditional exit or choice group', () => {
    const conditional = '@scene start\n@if true\n@end\n@else\n@end\n@endif\n';
    expect(appendLineToScene(conditional, '\n', '@bg harbor')).toBe(conditional.replace('@if true', '@bg harbor\n@if true'));
    const choice = '@choice\n  离开 -> @goto finish\n  留下 -> @goto finish\n@label finish\n@end';
    expect(appendLineToScene(choice, '\n', '@bg harbor')).toBe('@bg harbor\n' + choice);
    for (const instruction of ['@switch score 1:finish', '@loop 2 finish']) {
      const source = `${instruction}\n@end\n@label finish\n到达。\n@end`;
      expect(appendLineToScene(source, '\n', '@bg harbor')).toBe('@bg harbor\n' + source);
    }
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
  it('projects usable portrait slots instead of trusting scanner keys, including explicit bindings', () => {
    const file = (name: string): DirAsset => ({ key: 'wrong:scan', expr: 'normal', kind: 'portrait', handle: null, isImage: true, sourcePath: `content/assets/portrait/${name}` });
    const normal = file('lynn_uniform_normal.png'), duplicate = file('lynn_uniform_normal.webp'), backup = file('lynn_uniform_normal_backup.png');
    expect(projectPortraitAssets([normal, backup], '{}')).toEqual([{ ...normal, key: 'lynn:uniform', expr: 'normal' }]);
    expect(projectPortraitAssets([normal, duplicate, backup], '{}')).toEqual([]);
    const config = JSON.stringify({ characters: { lynn: { portraits: { uniform: { normal: backup.sourcePath, smile: backup.sourcePath } } } } });
    expect(projectPortraitAssets([normal, duplicate, backup], config)).toEqual([
      { ...backup, key: 'lynn:uniform', expr: 'normal' }, { ...backup, key: 'lynn:uniform', expr: 'smile' },
    ]);
    expect(projectPortraitAssets([normal], '{')).toEqual([]);
    expect(projectPortraitAssets([normal], config)).toEqual([]);
  });
  it('kindOfDir 识别六类目录，未知目录返回 null', () => {
    expect(kindOfDir('bg')).toBe('bg');
    expect(kindOfDir('portrait')).toBe('portrait');
    expect(kindOfDir('voice')).toBe('voice');
    expect(kindOfDir('MUSIC')).toBe('bgm');
    expect(kindOfDir('AmBiEnCe')).toBe('ambience');
    expect(kindOfDir('random_dir')).toBeNull();
  });
  it('parsePortraitFileName uses the same exact three-part identity as the runtime', () => {
    expect(parsePortraitFileName('lynn_armor_despair.png')).toEqual({ key: 'lynn:armor', expr: 'despair' });
    expect(parsePortraitFileName('lynn_uniform.jpg')).toBeNull();
    expect(parsePortraitFileName('lynn_uniform_normal_backup.png')).toBeNull();
  });
});
