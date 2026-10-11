import { describe, expect, it } from 'vitest';
import { findPreviewPath } from '@surdet/authoring';
import { planFlowEdit, type FlowEdit } from '../src/flow-operations.js';
import { storySnapshot } from '../src/story-check.js';

const config = JSON.stringify({ entryScene: 'intro', variables: { trust: { type: 'number', initial: 0 } } });
function project(scenes: Record<string, string>): Record<string, string> {
  return { 'game.config.json': config, ...Object.fromEntries(Object.entries(scenes).map(([id, text]) => [`content/scenario/${id}.gal`, text])) };
}
async function plan(scenes: Record<string, string>, edit: FlowEdit) {
  const result = await planFlowEdit(project(scenes), edit);
  return { ...result, text: (id: string) => result.files.find(file => file.sceneId === id)?.after };
}
async function reaches(files: Record<string, string>, sceneId: string, line: number): Promise<string> {
  return findPreviewPath(await storySnapshot({ files }), { sceneId, line }).status;
}

describe('flow-map edits through the shared scene operations', () => {
  it('connects before a real terminator, so the new jump is reachable instead of dead after @end', async () => {
    const scenes = { intro: '@scene intro\n凛：开场。\n@end\n', home: '@scene home\n凛：到家。\n@end\n' };
    const result = await plan(scenes, { kind: 'connect', from: { sceneId: 'intro' }, to: { sceneId: 'home' } });
    expect(result.text('intro')).toBe('@scene intro\n凛：开场。\n@jump home\n@end\n');
    expect(result.summary).toBe('从 intro 开头 连到 home 开头：插在第 3 行的 @end 之前');
    expect(result.note).toContain('不再执行它');
    expect(await reaches(project({ ...scenes, intro: result.text('intro')! }), 'home', 2)).toBe('reached');
    expect(await reaches(project(scenes), 'home', 2)).toBe('unreachable');
  });

  it('inserts before the exit actually taken when a segment ends with several exits', async () => {
    const result = await plan({ intro: '@scene intro\n凛：开场。\n@jump river\n\n@end\n', river: '@scene river\n@end\n', home: '@scene home\n@end\n' },
      { kind: 'connect', from: { sceneId: 'intro' }, to: { sceneId: 'home' } });
    expect(result.text('intro')).toBe('@scene intro\n凛：开场。\n@jump home\n@jump river\n\n@end\n');
    expect(result.note).toBe('原来第 3 行的 @jump 会移到新连接之后，按顺序走到这里时不再执行它。');
  });

  it('handles a scene whose first body line is @end, an empty label segment, and CRLF with a BOM', async () => {
    const first = await plan({ intro: '@scene intro\n@end', home: '@scene home\n凛：到家。\n@end\n' },
      { kind: 'connect', from: { sceneId: 'intro' }, to: { sceneId: 'home' } });
    expect(first.text('intro')).toBe('@scene intro\n@jump home\n@end');
    const empty = await plan({ intro: '@scene intro\n@label a\n@label b\n凛：B。\n@end\n' },
      { kind: 'connect', from: { sceneId: 'intro', label: 'a' }, to: { sceneId: 'intro', label: 'b' } });
    expect(empty.text('intro')).toBe('@scene intro\n@label a\n@goto b\n@label b\n凛：B。\n@end\n');
    const crlf = await plan({ intro: '﻿@scene intro\r\n凛：开场。\r\n@end\r\n', home: '@scene home\n@end\n' },
      { kind: 'connect', from: { sceneId: 'intro' }, to: { sceneId: 'home' } });
    expect(crlf.text('intro')).toBe('﻿@scene intro\r\n凛：开场。\r\n@jump home\r\n@end\r\n');
  });

  it.each([['\n', true], ['\r\n', true], ['\r', true], ['\n', false], ['\r\n', false]] as const)(
    'connecting after the last line keeps how the file ends (%j, final newline: %j)', async (eol, terminated) => {
      const scenes = { intro: `@scene intro${eol}凛：开场。${terminated ? eol : ''}`, home: '@scene home\n凛：到家。\n@end\n' };
      const result = await plan(scenes, { kind: 'connect', from: { sceneId: 'intro' }, to: { sceneId: 'home' } });
      expect(result.text('intro')).toBe(`@scene intro${eol}凛：开场。${eol}@jump home${terminated ? eol : ''}`);
      expect(await reaches(project({ ...scenes, intro: result.text('intro')! }), 'home', 2)).toBe('reached');
    });

  it('never takes a branch end nested in @if or a choice as the segment end', async () => {
    const nested = await plan({ intro: '@scene intro\n@if trust > 0\n  @jump home\n@endif\n', home: '@scene home\n@end\n' },
      { kind: 'connect', from: { sceneId: 'intro' }, to: { sceneId: 'home', label: undefined } });
    expect(nested.text('intro')).toBe('@scene intro\n@if trust > 0\n  @jump home\n@endif\n@jump home\n');
    expect(nested.summary).toContain('条件块结束');
    const choice = await plan({ intro: '@scene intro\n@choice\n  A -> @goto a\n  B -> @goto b\n@label a\n@end\n@label b\n@end\n' },
      { kind: 'connect', from: { sceneId: 'intro' }, to: { sceneId: 'intro', label: 'b' } });
    expect(choice.text('intro')).toBe('@scene intro\n@choice\n  A -> @goto a\n  B -> @goto b\n@goto b\n@label a\n@end\n@label b\n@end\n');
  });

  it('adds a typed choice group and creates a new scene through scene.create', async () => {
    const scenes = { intro: '@scene intro\n凛：开场。\n@end\n', home: '@scene home\n@label door\n@end\n' };
    const branch = await plan(scenes, { kind: 'branch', from: { sceneId: 'intro' },
      options: [{ label: '回家', to: { sceneId: 'home', label: 'door' } }, { label: '留下', to: { sceneId: 'intro' } }] });
    expect(branch.text('intro')).toBe('@scene intro\n凛：开场。\n@choice\n  回家 -> @jump home.door\n  留下 -> @jump intro\n@end\n');
    const created = await plan(scenes, { kind: 'create', from: { sceneId: 'intro' }, sceneId: 'river' });
    expect(created.files.find(file => file.sceneId === 'river')).toEqual({ path: 'content/scenario/river.gal', sceneId: 'river', before: null, after: '@scene river\n@end\n' });
    expect(created.text('intro')).toBe('@scene intro\n凛：开场。\n@jump river\n@end\n');
  });

  it('retargets goto, jump and call by replacing the instruction, and a choice option keeping its condition and effects', async () => {
    const intro = '@scene intro\n@goto a\n@label a\n@call home.door\n@choice\n  走 [if:trust > 0] -> @set trust = 2 @goto a\n@end\n';
    const scenes = { intro, home: '@scene home\n@label door\n@return\n@label yard\n@return\n' };
    const local = await plan(scenes, { kind: 'retarget', edge: { sceneId: 'intro', line: 2, kind: 'goto' }, to: { sceneId: 'home' } });
    expect(local.text('intro')!.split('\n')[1]).toBe('@jump home');
    const call = await plan(scenes, { kind: 'retarget', edge: { sceneId: 'intro', line: 4, kind: 'call' }, to: { sceneId: 'home', label: 'yard' } });
    expect(call.text('intro')!.split('\n')[3]).toBe('@call home.yard');
    const option = await plan(scenes, { kind: 'retarget', edge: { sceneId: 'intro', line: 6, kind: 'choice' }, to: { sceneId: 'home', label: 'yard' } });
    expect(option.text('intro')!.split('\n')[5]).toBe('  走 [if:trust > 0] -> @set trust = 2 @jump home.yard');
    expect(option.summary).toBe('把选项「走」改为去 home · yard（条件和效果保持不变）');
  });

  it('refuses to retarget a line the shared renderer cannot reproduce unchanged', async () => {
    await expect(plan({ intro: '@scene intro\n@goto    a\n@label a\n@end\n' },
      { kind: 'retarget', edge: { sceneId: 'intro', line: 2, kind: 'goto' }, to: { sceneId: 'intro' } })).rejects.toThrow(/无法原样保留/);
  });

  it('removes a connection, or a choice option with its connection, and refuses to split a choice group', async () => {
    const scenes = { intro: '@scene intro\n@goto a\n@label a\n@choice\n  A -> @goto a\n  B -> @goto b\n@label b\n@end\n' };
    const removed = await plan(scenes, { kind: 'remove', edge: { sceneId: 'intro', line: 2, kind: 'goto' } });
    expect(removed.text('intro')).toBe('@scene intro\n@label a\n@choice\n  A -> @goto a\n  B -> @goto b\n@label b\n@end\n');
    const option = await plan(scenes, { kind: 'remove', edge: { sceneId: 'intro', line: 5, kind: 'choice' } });
    expect(option.text('intro')).toBe('@scene intro\n@goto a\n@label a\n@choice\n  B -> @goto b\n@label b\n@end\n');
    expect(option.note).toContain('选项本身也会删除');
    // A label whose segment is only a choice: a connection goes after the whole group, never between options.
    const after = await plan(scenes, { kind: 'connect', from: { sceneId: 'intro', label: 'a' }, to: { sceneId: 'intro', label: 'b' } });
    expect(after.text('intro')).toBe('@scene intro\n@goto a\n@label a\n@choice\n  A -> @goto a\n  B -> @goto b\n@goto b\n@label b\n@end\n');
  });
});
