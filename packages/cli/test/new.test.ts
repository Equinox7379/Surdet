import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cmdNew } from '../src/new.js';
import { lintProject } from '../src/lint.js';

const gameTemplateMain = fs.readFileSync(
  new URL('../templates/game/src/main.ts', import.meta.url),
  'utf8',
);
const sharedPlayer = fs.readFileSync(new URL('../../../examples/shared/player/player.ts', import.meta.url), 'utf8');

function makeFakeEngine(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-engine-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fake-engine', workspaces: ['packages/*'] }),
  );
  return dir;
}

describe('surdet new', () => {
  it('模板使用公共 Presentation 与标题会话边界', () => {
    expect(gameTemplateMain).toContain("from '@surdet/player'");
    expect(gameTemplateMain).toContain('startPlayer({');
    expect(sharedPlayer).toContain('connectInterpreterPresentation');
    expect(sharedPlayer).toContain('enterPlayerTitleSession');
    expect(sharedPlayer).toContain('clearForBoundary');
    expect(sharedPlayer).not.toContain('interp.setPresentationHooks');
    expect(sharedPlayer).not.toContain('preserveWorld: true');
  });

  it('创建脚手架 + 注册 workspace + lint 通过', async () => {
    const engine = makeFakeEngine();
    const code = await cmdNew('mytest', { engineRoot: engine });
    expect(code).toBe(0);

    const target = path.join(engine, 'games', 'mytest');
    expect(fs.existsSync(path.join(target, 'content/scenario/ch01_01.gal'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'game.config.json'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'src/main.ts'))).toBe(true);

    const generatedEntry = fs.readFileSync(path.join(target, 'src/main.ts'), 'utf8');
    expect(generatedEntry).toContain("from '@surdet/player'");
    expect(generatedEntry).toContain('startPlayer({');
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);
    expect(fs.statSync(path.join(target, 'content/assets/bg/harbor.png')).size).toBeGreaterThan(0);
    const generatedMain = generatedEntry + '\n' + sharedPlayer;
    expect(generatedMain).toContain('createRendererRuntime');
    expect(generatedMain).toContain('createPlayerShellController');
    expect(generatedMain).toContain('createRendererPlayerShellSlots');
    expect(generatedMain).toContain('createRendererTheme');
    expect(generatedMain).toContain('createPlayerUiSession');
    expect(generatedMain).toContain('connectInterpreterPresentation');
    expect(generatedMain).toContain('enterPlayerTitleSession');
    expect(generatedMain).toContain('clearForBoundary');
    expect(generatedMain).not.toContain('interp.setPresentationHooks');
    expect(generatedMain).not.toContain('preserveWorld: true');
    expect(generatedMain).not.toMatch(/new PlayerInputGate\(\)/);
    expect(generatedMain).not.toMatch(/\bPixiStage\b|\bAdvRenderer\b/);

    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')) as { name: string };
    expect(pkg.name).toBe('surdet-mytest');

    const rootPkg = JSON.parse(fs.readFileSync(path.join(engine, 'package.json'), 'utf8')) as { workspaces: string[] };
    expect(rootPkg.workspaces).toContain('games/*');

    const r = lintProject(target);
    expect(r.ok).toBe(true);
    expect(r.sceneCount).toBe(1);
    expect(r.issues).toEqual([]);
  });

  it('非法名字拒绝', async () => {
    const engine = makeFakeEngine();
    expect(await cmdNew('Bad Name!', { engineRoot: engine })).toBe(1);
    expect(await cmdNew('', { engineRoot: engine })).toBe(1);
  });

  it('a failed template copy leaves no partial game and can be retried', async () => {
    const engine = makeFakeEngine();
    const before = fs.readFileSync(path.join(engine, 'package.json'), 'utf8');
    const original = fs.copyFileSync;
    let calls = 0;
    const copy = vi.spyOn(fs, 'copyFileSync').mockImplementation((...args) => {
      if (++calls === 2) throw new Error('injected copy failure');
      return original(...args);
    });
    try {
      expect(await cmdNew('retry', { engineRoot: engine })).toBe(1);
      expect(fs.readdirSync(path.join(engine, 'games'))).toEqual([]);
      expect(fs.readFileSync(path.join(engine, 'package.json'), 'utf8')).toBe(before);
    } finally {
      copy.mockRestore();
    }
    expect(await cmdNew('retry', { engineRoot: engine })).toBe(0);
    expect(fs.existsSync(path.join(engine, 'games/retry/game.config.json'))).toBe(true);
  });

  it('目录已存在拒绝', async () => {
    const engine = makeFakeEngine();
    await cmdNew('dup', { engineRoot: engine });
    expect(await cmdNew('dup', { engineRoot: engine })).toBe(1);
  });

  it.each(['example', 'blank'] as const)('creates an independent %s project without touching an engine workspace', async template => {
    const engine = makeFakeEngine();
    const before = fs.readFileSync(path.join(engine, 'package.json'), 'utf8');
    const directory = path.join(engine, '中文 项目', template);
    expect(await cmdNew('independent', { engineRoot: engine, directory, template })).toBe(0);
    expect(fs.readFileSync(path.join(engine, 'package.json'), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(engine, 'games'))).toBe(false);
    const config = JSON.parse(fs.readFileSync(path.join(directory, 'game.config.json'), 'utf8'));
    expect(config.entryScene).toBe(template === 'blank' ? 'start' : 'ch01_01');
    const lint = lintProject(directory);
    expect(lint).toMatchObject({ ok: true, sceneCount: 1 });
    expect(lint.issues.map(issue => [issue.severity, issue.code]))
      .toEqual(template === 'blank' ? [['warning', 'EMPTY_VARIABLES']] : []);
    if (template === 'blank') {
      expect(config.variables).toEqual({});
      expect(config.characters).toEqual({});
      expect(fs.readdirSync(path.join(directory, 'content'))).toEqual(['scenario']);
    }
    const tsconfig = JSON.parse(fs.readFileSync(path.join(directory, 'tsconfig.json'), 'utf8'));
    expect(tsconfig.extends).toBeUndefined();
    expect(await cmdNew('again', { directory, template })).toBe(1);
    expect(lintProject(directory).ok).toBe(true);
  });

  it('rejects invalid template and empty directory before creating files', async () => {
    const engine = makeFakeEngine();
    const before = fs.readdirSync(engine);
    expect(await cmdNew('bad', { engineRoot: engine, template: 'typo' as 'blank' })).toBe(1);
    expect(await cmdNew('bad', { engineRoot: engine, directory: '' })).toBe(1);
    expect(fs.readdirSync(engine)).toEqual(before);
  });
});
