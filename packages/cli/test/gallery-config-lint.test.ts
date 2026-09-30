import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { lintProject } from '../src/lint.js';

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-gallery-lint-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
  }
  return dir;
}

function config(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    entryScene: 'a',
    customInstructions: ['unlock_cg', 'unlock_music', 'unlock_text'],
    variables: { marker: { type: 'flag', initial: false } },
    ...extra,
  });
}

function gallery(value: unknown): string {
  return JSON.stringify(value);
}

function issuesFor(dir: string, code: string) {
  return lintProject(dir).issues.filter((issue) => issue.code === code);
}

function expectAllIssuesHinted(dir: string): void {
  const result = lintProject(dir);
  expect(result.issues.length).toBeGreaterThan(0);
  expect(result.issues.every((issue) => typeof issue.hint === 'string' && issue.hint.trim().length > 0)).toBe(true);
}

describe('generic Gallery content lint', () => {
  it.each([
    { name: 'absent without unlocks', source: '@scene a\n凛：继续。\n@end', lines: [] },
    { name: 'absent with dossiers', source: '@scene a\n@unlock_profile "first"\n@unlock_term port\n@end', lines: [2, 3] },
    { name: 'empty with dossiers', source: '@scene a\n@unlock_profile "first"\n@unlock_term port\n@end', data: { cgs: [], music: [] }, lines: [2, 3] },
    { name: 'defined dossiers', source: '@scene a\n@unlock_profile "first"\n@unlock_term port\n@end', data: { cgs: [], music: [], profiles: [{ id: 'first', character: 'rin' }], terms: [{ id: 'port', canonical: '雾港' }] }, lines: [] },
    { name: 'absent with all gallery unlocks', source: '@scene a\n@unlock_cg absent\n@unlock_music absent\n@unlock_text absent\n@unlock_profile absent\n@unlock_term absent\n@end', lines: [2, 3, 4, 5, 6] },
  ])('validates gallery references: $name', ({ source, data, lines }) => {
    const dir = makeProject({ 'game.config.json': config({ characters: { rin: { name: '凛' } } }),
      'content/scenario/a.gal': source, 'content/config/terminology.json': '{"terms":[{"canonical":"雾港","variants":[]}]}',
      ...(data ? { 'content/config/gallery.json': gallery(data) } : {}),
    });
    const result = lintProject(dir);
    expect(result.ok).toBe(lines.length === 0);
    expect(result.issues.filter(issue => issue.code === 'G006').map(issue => ({ file: issue.file, line: issue.line })))
      .toEqual(lines.map(line => ({ file: path.join(dir, 'content/scenario/a.gal'), line })));
    expect(fs.existsSync(path.join(dir, 'content/config/gallery.json'))).toBe(data !== undefined);
  });

  it('reports G001 for invalid Gallery JSON structure and entry fields', () => {
    const dir = makeProject({
      'game.config.json': config(),
      'content/scenario/a.gal': '标记：有效。\n',
      'content/config/gallery.json': '{"cgs":',
    });
    expect(issuesFor(dir, 'G001')).toHaveLength(1);
    expectAllIssuesHinted(dir);

    fs.writeFileSync(
      path.join(dir, 'content/config/gallery.json'),
      gallery({ cgs: [{}], music: 'not-an-array', texts: [{ id: 'text', name: '', scene: 42 }] }),
      'utf8',
    );
    expect(issuesFor(dir, 'G001').length).toBeGreaterThanOrEqual(3);
    expectAllIssuesHinted(dir);
  });

  it('reports an unreadable gallery path without throwing or duplicating diagnostics', () => {
    const dir = makeProject({ 'game.config.json': config(), 'content/scenario/a.gal': '旁白：继续。\n' });
    fs.mkdirSync(path.join(dir, 'content/config/gallery.json'), { recursive: true });
    expect(issuesFor(dir, 'G001')).toHaveLength(1);
  });

  it('reports G003 when CG or music source keys have no matching asset', () => {
    const dir = makeProject({
      'game.config.json': config(),
      'content/scenario/a.gal': '标记：有效。\n',
      'content/config/gallery.json': gallery({
        cgs: [{ id: 'cg', name: 'CG', src: 'missing_bg' }],
        music: [{ id: 'music', name: '音乐', src: 'missing_bgm' }],
      }),
    });
    expect(issuesFor(dir, 'G003')).toHaveLength(2);
    expectAllIssuesHinted(dir);
  });

  it('reports G004 and G005 for missing replay scenes and labels', () => {
    const dir = makeProject({
      'game.config.json': config(),
      'content/scenario/a.gal': '@label start\n标记：有效。\n',
      'content/config/gallery.json': gallery({
        cgs: [],
        music: [],
        texts: [
          { id: 'missing_scene', name: '缺场景', scene: 'no_such_scene' },
          { id: 'missing_label', name: '缺标签', scene: 'a', label: 'no_such_label' },
        ],
      }),
    });
    expect(issuesFor(dir, 'G004')).toHaveLength(1);
    expect(issuesFor(dir, 'G005')).toHaveLength(1);
    expectAllIssuesHinted(dir);
  });

  it('reports G006 for unknown and argument-less unlock instructions', () => {
    const dir = makeProject({
      'game.config.json': config(),
      'content/scenario/a.gal': '@unlock_music no_such_track\n@unlock_text\n',
      'content/config/gallery.json': gallery({ cgs: [], music: [], texts: [] }),
    });
    expect(issuesFor(dir, 'G006')).toHaveLength(2);
    expectAllIssuesHinted(dir);
  });

  it('reports G007 for valid Gallery entries with no unlock point', () => {
    const dir = makeProject({
      'game.config.json': config(),
      'content/assets/bg/room.png': '',
      'content/assets/bgm/rain.wav': '',
      'content/scenario/a.gal': '@label replay\n标记：有效。\n',
      'content/config/gallery.json': gallery({
        cgs: [{ id: 'room', name: '房间' }],
        music: [{ id: 'rain', name: '雨声' }],
        texts: [{ id: 'replay_a', name: '回想', scene: 'a', label: 'replay' }],
      }),
    });
    expect(issuesFor(dir, 'G007')).toHaveLength(3);
    expectAllIssuesHinted(dir);
  });

  it('reports G002 for duplicate IDs inside one Gallery category', () => {
    const dir = makeProject({
      'game.config.json': config(),
      'content/assets/bgm/rain.wav': '',
      'content/scenario/a.gal': '标记：有效。\n',
      'content/config/gallery.json': gallery({
        cgs: [],
        music: [
          { id: 'rain', name: '雨声' },
          { id: 'rain', name: '雨声副本' },
        ],
        texts: [],
      }),
    });
    expect(issuesFor(dir, 'G002')).toHaveLength(1);
    expectAllIssuesHinted(dir);
  });

  it('reports G008 for a configured avatar key with no avatar asset', () => {
    const dir = makeProject({
      'game.config.json': config({ characters: { aya: { name: '亚雅', avatar: 'missing_avatar' } } }),
      'content/scenario/a.gal': '标记：有效。\n',
      'content/config/gallery.json': gallery({ cgs: [], music: [], texts: [] }),
    });
    expect(issuesFor(dir, 'G008')).toHaveLength(1);
    expectAllIssuesHinted(dir);
  });

  it('accepts valid CG/music/text/label/unlock/avatar links and supplies hints', () => {
    const dir = makeProject({
      'game.config.json': config({ characters: { aya: { name: '亚雅', avatar: 'aya' } } }),
      'content/assets/bg/room.png': '',
      'content/assets/bgm/rain.wav': '',
      'content/assets/avatar/aya.png': '',
      'content/config/gallery.json': gallery({
        cgs: [{ id: 'room', name: '房间' }],
        music: [{ id: 'rain', name: '雨声' }],
        texts: [{ id: 'replay_a', name: '回想', scene: 'a', label: 'replay' }],
      }),
      'content/scenario/a.gal':
        '@scene a\n@label replay\n@unlock_cg room\n@unlock_music rain\n@unlock_text replay_a\n旁白：有效。\n',
    });
    const result = lintProject(dir);
    expect(result.ok).toBe(true);
    expect(result.issues.every((issue) => typeof issue.hint === 'string' && issue.hint.trim().length > 0)).toBe(true);
  });
});
