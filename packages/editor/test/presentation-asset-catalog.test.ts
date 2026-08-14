import { describe, expect, it, afterEach } from 'vitest';
import { buildAssetCatalog, buildObjectIndex, loadProjectSnapshot } from '@surdet/authoring';
import { createEditorProjectStorage } from '../src/authoring-project-storage.js';
import { recordAssetPath } from '../src/project-io.js';
import { describeAuthoringReference, locateTimelineCuesForStageChange } from '../src/causal-selection.js';
import { state } from '../src/state.js';

const originalDirAssets = state.dirAssets;

afterEach(() => {
  state.dirAssets = originalDirAssets;
});

const CLI_CATALOG_PATHS = [
  'content/assets/bg/castle_hall.svg',
  'content/assets/bg/night_field.svg',
  'content/assets/portrait/lynn_uniform_night.svg',
];

describe('presentation asset catalog', () => {
  it('returns a field-identical catalog for the same path metadata as the CLI contract', () => {
    // 与 CLI 合同测试锁定同一输入/输出：CLI 与 editor 不各自实现解析器。
    const catalog = buildAssetCatalog(CLI_CATALOG_PATHS);
    expect(catalog.backgrounds.map((entry) => entry.key)).toEqual(['castle_hall', 'night_field']);
    expect(catalog.backgrounds.every((entry) => entry.resolved && entry.format === 'svg')).toBe(true);
    expect(catalog.backgrounds[1]).toEqual({
      kind: 'background',
      key: 'night_field',
      sourcePath: 'content/assets/bg/night_field.svg',
      format: 'svg',
      resolved: true,
    });
    const lynn = catalog.portraits[0];
    expect(lynn).toEqual({
      kind: 'portrait',
      key: 'lynn:uniform',
      role: 'lynn',
      outfit: 'uniform',
      expression: 'night',
      sourcePath: 'content/assets/portrait/lynn_uniform_night.svg',
      format: 'svg',
      resolved: true,
    });
  });

  it('enumerates content/assets paths from the editor directory scan without reading binaries', async () => {
    state.dirName = 'catalog-project';
    state.gameConfigText = JSON.stringify({ entryScene: 'agent_probe', variables: {} });
    state.scenes = new Map([['agent_probe', {
      id: 'agent_probe', file: 'agent_probe.gal', text: '@scene agent_probe\n@label start\n@end\n', eol: '\n', dirty: false, handle: null,
    }]]);
    state.timelines = [];
    state.configFiles = { events: null, growth: null, calendar: null, achievements: null, gallery: null, terminology: null };
    const nightHandle = { kind: 'file', name: 'night_field.svg' } as unknown as FileSystemFileHandle;
    const portraitHandle = { kind: 'file', name: 'lynn_uniform_night.svg' } as unknown as FileSystemFileHandle;
    recordAssetPath(nightHandle, 'content/assets/bg/night_field.svg');
    recordAssetPath(portraitHandle, 'content/assets/portrait/lynn_uniform_night.svg');
    state.dirAssets = [
      { key: 'night_field', kind: 'bg', handle: nightHandle, isImage: true },
      { key: 'lynn:uniform', kind: 'portrait', expr: 'night', handle: portraitHandle, isImage: true },
    ];

    const storage = createEditorProjectStorage();
    const listed = await storage.listFiles();
    expect(listed).toContain('content/assets/bg/night_field.svg');
    expect(listed).toContain('content/assets/portrait/lynn_uniform_night.svg');
    // 快照仍只收集文本契约文件，资产二进制不进入 snapshot/revision。
    const snapshot = await loadProjectSnapshot(storage, storage);
    expect(snapshot.files.map((file) => file.path)).not.toContain('content/assets/bg/night_field.svg');
  });

  it('describes track, cue and asset references readably', () => {
    expect(describeAuthoringReference('asset:bg:night_field')).toBe('背景 night_field');
    expect(describeAuthoringReference('asset:portrait:lynn:uniform:night')).toBe('立绘 lynn:uniform（night）');
    expect(describeAuthoringReference('timeline:agent_blackout/track:1')).toBe('轨道（agent_blackout · #1）');
    expect(describeAuthoringReference('timeline:agent_blackout/track:1/cue:0')).toBe('Cue（agent_blackout · 轨道 1 · #0）');
    expect(describeAuthoringReference('timeline:agent_blackout')).toBe('时间轴 agent_blackout');
  });

  it('reverse-locates timeline cues from stage snapshot differences', async () => {
    const timelineText = JSON.stringify({
      version: 1,
      id: 'agent_blackout',
      durationMs: 800,
      tracks: [
        { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night_field' }] },
        { kind: 'portrait', target: 'lynn:uniform', cues: [{ atMs: 100, durationMs: 0, easing: 'linear', action: 'show', expression: 'night', position: 'left' }] },
        {
          kind: 'screen',
          cues: [
            { atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 1 },
            { atMs: 50, durationMs: 700, easing: 'inOutSine', action: 'fade', alpha: 0 },
          ],
        },
      ],
    });
    const contents: Record<string, string> = {
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': ['@scene agent_probe', '@label start', '@timeline agent_blackout @ blocking', '@end'].join('\n'),
      'content/timelines/agent_blackout.json': timelineText,
    };
    const hasher = { sha256: async (text: string) => {
      let hash = 0x811c9dc5;
      for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    } };
    const snapshot = await loadProjectSnapshot({
      rootIdentity: 'stage-fixture',
      listFiles: async () => Object.keys(contents),
      readText: async (path: string) => {
        const text = contents[path];
        if (text === undefined) throw new Error('missing: ' + path);
        return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
      },
      exists: async (path: string) => path in contents,
    }, hasher);
    const index = buildObjectIndex(snapshot);
    const before = { stage: { backgroundKey: null, portraits: [], fadeAlpha: 0 } };
    const after = {
      stage: {
        backgroundKey: 'night_field',
        portraits: [{ key: 'lynn:uniform', view: { charId: 'lynn', costume: 'uniform', expression: 'night', pos: 'left' } }],
        fadeAlpha: 1,
      },
    };
    const cueRefs = locateTimelineCuesForStageChange(before, after, index, 'timeline:agent_blackout');
    expect(cueRefs).toEqual([
      'timeline:agent_blackout/track:1/cue:0',  // 立绘登场 show cue
      'timeline:agent_blackout/track:0/cue:0',  // 背景 set cue
      'timeline:agent_blackout/track:2/cue:1',  // 非零时长 fade cue（时长排序优先）
    ]);
    expect(locateTimelineCuesForStageChange(before, before, index, 'timeline:agent_blackout')).toEqual([]);
  });
});
