import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerPath = path.join(shellRoot, 'e2e', 'player-experience-gallery-music.e2e.mjs');
const packageJson = JSON.parse(fs.readFileSync(path.join(shellRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

function runnerSource(): string {
  return fs.existsSync(runnerPath) ? fs.readFileSync(runnerPath, 'utf8') : '';
}

describe('Gallery music playback E2E contract', () => {
  it('registers a dedicated formal Zero runner', () => {
    expect(packageJson.scripts?.['e2e:gallery-music'])
      .toBe('node e2e/player-experience-gallery-music.e2e.mjs');
    expect(fs.existsSync(runnerPath)).toBe(true);
  });

  it('uses isolated Electron sessions, the formal Zero dist, and real mouse input', () => {
    const source = runnerSource();
    for (const token of [
      'examples/zero-after-midnight',
      "'dist'",
      'SURDET_E2E_GAME_DIR',
      '--user-data-dir=',
      'tempUserData',
      'page.mouse.click',
      'old_room',
      'midnight_rain',
      'source',
      'audioPlayback',
    ]) {
      expect(source).toContain(token);
    }
    expect(source).not.toContain('examples/starter/dist');
    expect(source).not.toContain('titleSelect(');
  });

  it('covers title and in-game Gallery paths with playback/error evidence', () => {
    const source = runnerSource();
    for (const token of [
      'title-gallery-music',
      'game-gallery-music',
      '标题 → 鉴赏 → 音乐',
      '新游戏 → 系统菜单 → 鉴赏 → 音乐',
      'bgmPlaying',
      'callbackCount',
      'sourceResolved',
      'howlerErrors',
      'pageErrors',
      'consoleErrors',
      'requestFailures',
      'unhandledRejections',
      'rendererErrors',
      'releaseFailures',
      'before',
      'after',
    ]) {
      expect(source).toContain(token);
    }
  });
});
