import { afterEach, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { lintProject } from '../src/lint.js';
import { findGalFiles } from '../src/scenario-loader.js';
import { collectTimelineFiles } from '../src/timeline-loader.js';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readdirSync: vi.fn(actual.readdirSync) };
});

describe.skipIf(process.platform !== 'win32')('D9 CLI content read boundaries', () => {
  let temporary: string;
  let project: string;
  const links: string[] = [];

  function write(relative: string, text: string): void {
    const file = path.join(project, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }

  function link(ctx: TestContext, target: string, location: string, type: 'junction' | 'file' | 'dir'): void {
    fs.mkdirSync(path.dirname(location), { recursive: true });
    try {
      fs.symlinkSync(target, location, type);
      links.push(location);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') ctx.skip(`Windows ${type} permission unavailable: ${code}`);
      throw error;
    }
    expect(fs.lstatSync(location).isSymbolicLink()).toBe(true);
  }

  beforeEach(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-cli-links-'));
    project = path.join(temporary, '项目 空间');
    fs.mkdirSync(project);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    for (const location of links.splice(0).reverse()) fs.unlinkSync(location);
    // Only remove the directory created by this test; linked targets were unlinked above.
    if (path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith('surdet-cli-links-')) {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  for (const kind of ['scenario', 'timelines'] as const) {
    const extension = kind === 'scenario' ? '.GAL' : '.JSON';
    const consume = (root: string): unknown => kind === 'scenario' ? lintProject(root) : collectTimelineFiles(root);

    for (const relative of ['content', `content/${kind}`, `content/${kind}/章节 空间`]) {
      it(`${kind} rejects a junction at ${relative}`, ctx => {
        const outside = path.join(temporary, 'outside');
        fs.mkdirSync(path.join(outside, kind), { recursive: true });
        fs.writeFileSync(path.join(outside, `linked${extension}`), '@end');
        link(ctx, outside, path.join(project, relative), 'junction');
        expect(() => consume(project)).toThrow(/链接/);
      });
    }

    it(`${kind} rejects an in-project junction`, ctx => {
      const target = path.join(project, 'local-target');
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, `linked${extension}`), '@end');
      link(ctx, target, path.join(project, 'content', kind), 'junction');
      expect(() => consume(project)).toThrow(/链接/);
    });

    it(`${kind} rejects a directory symlink`, ctx => {
      const target = path.join(temporary, 'outside');
      fs.mkdirSync(target);
      link(ctx, target, path.join(project, 'content', kind), 'dir');
      expect(() => consume(project)).toThrow(/链接/);
    });

    for (const targetKind of ['outside', 'inside', 'dangling', 'unrelated-extension']) {
      it(`${kind} rejects a ${targetKind} file symlink`, ctx => {
        const target = path.join(targetKind === 'inside' ? project : temporary, `target${extension}`);
        if (targetKind !== 'dangling') fs.writeFileSync(target, '@end');
        const name = targetKind === 'unrelated-extension' ? 'linked.txt' : `linked${extension}`;
        link(ctx, target, path.join(project, 'content', kind, name), 'file');
        expect(() => consume(project)).toThrow(/链接/);
      });
    }

    it.each(['EACCES', 'EIO'])(`${kind} propagates directory read %s`, code => {
      const directory = path.join(project, 'content', kind);
      fs.mkdirSync(directory, { recursive: true });
      const denied = Object.assign(new Error(`test directory read ${code}`), { code });
      vi.mocked(fs.readdirSync).mockImplementationOnce(() => { throw denied; });
      expect(() => consume(project)).toThrow(denied);
      expect(fs.readdirSync).toHaveBeenCalledWith(directory, { withFileTypes: true });
    });

    it(`${kind} rejects a file in place of its optional directory`, () => {
      write(`content/${kind}`, 'not a directory');
      expect(() => consume(project)).toThrow();
    });
  }

  it('keeps missing optional content directories empty', () => {
    expect(findGalFiles(project)).toEqual([]);
    expect(collectTimelineFiles(project)).toEqual([]);
    fs.mkdirSync(path.join(project, 'content'));
    expect(findGalFiles(project)).toEqual([]);
    expect(collectTimelineFiles(project)).toEqual([]);
  });

  it('preserves Chinese and space filenames and uppercase extensions when collecting content', () => {
    write('content/scenario/章节 空间/中文 开场.GAL', '旁白：你好。\n@end');
    const timeline = '{}';
    write('content/timelines/片段 空间/中文 开场.JSON', `\uFEFF${timeline}`);
    expect(findGalFiles(project)).toEqual([path.join(project, 'content/scenario/章节 空间/中文 开场.GAL')]);
    expect(collectTimelineFiles(project)).toMatchObject([
      { path: 'content/timelines/片段 空间/中文 开场.JSON', text: timeline },
    ]);
  });

  it('accepts the selected projectRoot junction as the authorized root', ctx => {
    write('content/scenario/章节 空间/start.GAL', '@scene start\n你好。\n@end');
    write('content/timelines/intro.JSON', JSON.stringify({ version: 1, id: 'intro.JSON', durationMs: 100,
      tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 1 }] }] }));
    expect(lintProject(project).ok).toBe(true);
    const selected = path.join(temporary, '选中 项目');
    link(ctx, project, selected, 'junction');
    expect(lintProject(selected).ok).toBe(true);
    expect(collectTimelineFiles(selected).map(file => file.path)).toEqual(['content/timelines/intro.JSON']);
  });

  it('keeps lint custom in-project scenarioDir and rejects its linked parent', ctx => {
    write('custom 剧本/章节/start.GAL', '@scene start\n你好。\n@end');
    expect(lintProject(project, 'custom 剧本/章节').ok).toBe(true);
    const selected = path.join(temporary, 'selected');
    link(ctx, project, selected, 'junction');
    expect(lintProject(selected, 'custom 剧本/章节').ok).toBe(true);
    link(ctx, path.join(project, 'custom 剧本'), path.join(project, 'custom-link'), 'junction');
    expect(() => lintProject(project, 'custom-link/章节')).toThrow(/链接/);
  });

  it('rejects custom scenarioDir escaping the project', () => {
    const outside = path.join(temporary, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'start.GAL'), '@scene start\n@end');
    expect(() => lintProject(project, '../outside')).toThrow(/项目根目录/);
  });
});
