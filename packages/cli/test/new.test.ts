import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
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
    expect(gameTemplateMain).toContain("from '../../../examples/shared/player/player.js'");
    expect(gameTemplateMain).toContain('startPlayer({');
    expect(sharedPlayer).toContain('connectInterpreterPresentation');
    expect(sharedPlayer).toContain('enterPlayerTitleSession');
    expect(sharedPlayer).toContain('clearForBoundary');
    expect(sharedPlayer).not.toContain('interp.setPresentationHooks');
    expect(sharedPlayer).not.toContain('preserveWorld: true');
  });

  it('创建脚手架 + 注册 workspace + lint 通过', async () => {
    const engine = makeFakeEngine();
    const code = await cmdNew('mytest', engine);
    expect(code).toBe(0);

    const target = path.join(engine, 'games', 'mytest');
    expect(fs.existsSync(path.join(target, 'content/scenario/ch01_01.gal'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'game.config.json'))).toBe(true);
    expect(fs.existsSync(path.join(target, 'src/main.ts'))).toBe(true);

    const generatedEntry = fs.readFileSync(path.join(target, 'src/main.ts'), 'utf8');
    expect(generatedEntry).toContain("from '../../../examples/shared/player/player.js'");
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
  });

  it('非法名字拒绝', async () => {
    const engine = makeFakeEngine();
    expect(await cmdNew('Bad Name!', engine)).toBe(1);
    expect(await cmdNew('', engine)).toBe(1);
  });

  it('目录已存在拒绝', async () => {
    const engine = makeFakeEngine();
    await cmdNew('dup', engine);
    expect(await cmdNew('dup', engine)).toBe(1);
  });
});
