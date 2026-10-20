import { describe, expect, it, vi } from 'vitest';
import { contentPlayerProject, type PlayerContentManifest } from '../../shared/player/content-player.js';

vi.mock('../../shared/player/player.js', () => ({ startPlayer: vi.fn(), showPlayerRecovery: vi.fn() }));

const manifest = (assets: string[] = []): PlayerContentManifest => ({
  id: 'content-test', config: { entryScene: 'intro', variables: {} },
  scenes: { 'content/scenario/intro.gal': '@scene intro\n开场\n@end' },
  timelines: {}, assets, trustedPlugins: [],
});
const base = 'http://127.0.0.1:8000/game/';

describe('prebuilt content path boundaries', () => {
  it.each(['../secret.png', 'bg/../../secret.png', './bg.png', 'bg//sky.png', '/bg.png', 'bg\\..\\secret.png', 'C:/secret.png'])('rejects non-relative or non-canonical manifest asset %s', file => {
    expect(() => contentPlayerProject(manifest([file]), base)).toThrow('相对路径');
  });

  it('keeps nested Chinese names, spaces and literal URL punctuation inside assets', async () => {
    const file = 'bg/雨 夜%23#?.svg';
    const font = 'font/字体 100%.woff2';
    const project = contentPlayerProject(manifest([file, font]), base);
    expect(project.assetFiles[file]).toBe(base + 'content/assets/bg/%E9%9B%A8%20%E5%A4%9C%2523%23%3F.svg');
    expect(project.fontFiles?.['content/assets/' + font]).toBe(base + 'content/assets/font/%E5%AD%97%E4%BD%93%20100%25.woff2');
    expect(await project.sceneFiles['content/scenario/intro.gal']!()).toBe(manifest().scenes['content/scenario/intro.gal']);
  });

  it('rejects path traversal in scene resolution without rejecting encoded-looking literal names', () => {
    const project = contentPlayerProject(manifest(), base);
    expect(() => project.resolveSceneUrl('../outside.gal')).toThrow('相对路径');
    expect(project.resolveSceneUrl('content/scenario/%2e%2e.gal')).toBe(base + 'content/scenario/%252e%252e.gal');
  });
});
