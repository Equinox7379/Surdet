import { describe, expect, it } from 'vitest';
import { compileScene, createSeededRandomSource, EventBus, Interpreter, SceneRegistry, VariableStore, type CoreEventMap, type VarDeclaration } from '@surdet/core';
import { findPreviewPath, type PreviewPathOptions, type PreviewPathReport } from '@surdet/authoring';
import { storySnapshot } from '../src/story-check.js';
import { describePreviewPath, normalizePreviewTargetState, parseOptionIndices, parseTargetVariables, PreviewTargetDriver, type PreviewTargetRun } from '../src/preview-target.js';

const config = JSON.stringify({ entryScene: 'entry', variables: { trust: { type: 'number', initial: 0 } } });
const entry = '@scene entry\n@bg harbor\n@choice\n  回家 -> @set trust = 1 @jump home\n  留下 -> @end\n@end';
const home = '@scene home\n@label arrival\n@set trust += 2\n凛：回家了。\n@end';

async function query(scenes: Record<string, string>, options: PreviewPathOptions): Promise<PreviewPathReport> {
  const files: Record<string, string> = { 'game.config.json': config };
  for (const [id, text] of Object.entries(scenes)) files[`content/scenario/${id}.gal`] = text;
  return findPreviewPath(await storySnapshot({ files }), options);
}

/** The preview's runtime shape: config declarations, scenes compiled as the preview does, the report's seed. */
function play(scenes: Record<string, string>, report: PreviewPathReport) {
  const store = new VariableStore([{ name: 'trust', type: 'number', initial: 0 } satisfies VarDeclaration]);
  if (report.mode === 'test') for (const [name, value] of Object.entries(report.initialVariables)) store.set(name, value);
  const bus = new EventBus<CoreEventMap>(), registry = new SceneRegistry();
  for (const [id, text] of Object.entries(scenes)) registry.register(compileScene(text, `${id}.gal`, id));
  const interpreter = new Interpreter(store, bus, registry);
  interpreter.setRandomSource(createSeededRandomSource(report.seed));
  const position = report.position!;
  const run: PreviewTargetRun = { mode: report.mode, breakpoint: { sceneId: position.sceneId, sceneHash: position.sceneHash, index: position.index },
    line: report.target.line, choices: report.choices, targetVisit: report.targetVisit, afterBreakpoints: [] };
  interpreter.configureDebugger({ enabled: true, pauseOnStart: false, breakpoints: [run.breakpoint] });
  const outcomes: unknown[] = [], selected: number[] = [];
  const driver = new PreviewTargetDriver({ interpreter, run,
    input: { advance: () => { interpreter.advance(); return true; }, select: (index) => { selected.push(index); interpreter.choose(index); return true; } },
    continuePast: () => interpreter.debugContinue(),
    report: (outcome) => outcomes.push(outcome) });
  bus.on('runtimeTrace', () => driver.poke());
  bus.on('choice', ({ options }) => driver.choice(options));
  interpreter.start(report.entryScene, report.entryLabel);
  driver.poke();
  return { interpreter, store, outcomes, selected };
}

async function settle(): Promise<void> { for (let index = 0; index < 200; index += 1) await Promise.resolve(); }
/** Core's location identity; the preview compiles scenes as `<id>.gal`, so the file spelling differs. */
const identity = (location: PreviewPathReport['position']) => location && { sceneId: location.sceneId, sceneHash: location.sceneHash, index: location.index, line: location.line, op: location.op };

describe('from-line preview: replaying the found path to a temporary Core breakpoint', () => {
  it('reaches the query position by real input; the variables come from execution, not the report', async () => {
    const report = await query({ entry, home }, { sceneId: 'home', line: 4 });
    expect(report).toMatchObject({ status: 'reached', choices: [0], finalVariables: { trust: 3 } });
    const run = play({ entry, home }, report);
    await settle();
    expect(run.outcomes).toEqual([{ status: 'reached', visit: 1 }]);
    expect(run.selected).toEqual([0]);
    const debug = run.interpreter.debugSnapshot();
    expect(debug).toMatchObject({ paused: true, reason: 'breakpoint' });
    expect(identity(debug.current)).toEqual(identity(report.position));
    expect(run.store.snapshot()).toEqual(report.finalVariables);
    // The temporary breakpoint is gone: continuing runs the target line and on to the end.
    run.interpreter.debugContinue();
    expect(run.interpreter.status).toBe('awaiting-advance');
    expect(run.interpreter.debugSnapshot().current?.line).toBe(4);
  });

  it('stops where the run really is when it no longer matches the query, without guessing', async () => {
    const report = await query({ entry, home }, { sceneId: 'home', line: 4 });
    // The entry scene changed after the query: the recorded option is hidden now.
    const hidden = entry.replace('  回家 ->', '  回家 [if:trust > 0] ->');
    const run = play({ entry: hidden, home }, report);
    await settle();
    expect(run.outcomes).toEqual([{ status: 'stopped', message: '选项序号 0 当前不可见，已停在这组选项。' }]);
    expect(run.interpreter.status).toBe('awaiting-choice');
    expect(run.interpreter.debugSnapshot().paused).toBe(false);
  });

  it('refuses a breakpoint for a target scene whose text changed (Core version guard)', async () => {
    const report = await query({ entry, home }, { sceneId: 'home', line: 4 });
    expect(() => play({ entry, home: home.replace('回家了', '到家了') }, report)).toThrow(/断点场景版本已失配/);
  });

  it('counts real arrivals for a repeated target and passes earlier ones', async () => {
    const loop = '@scene entry\n@label again\n正文\n@choice\n  再来 -> @goto again\n  结束 -> @end';
    const report = await query({ entry: loop }, { sceneId: 'entry', line: 3, mode: 'path', choices: [0], targetVisit: 2 });
    expect(report).toMatchObject({ status: 'reached', targetVisit: 2, choices: [0] });
    const run = play({ entry: loop }, report);
    await settle();
    expect(run.outcomes).toEqual([{ status: 'reached', visit: 2 }]);
    expect(run.selected).toEqual([0]);
    expect(identity(run.interpreter.debugSnapshot().current)).toEqual(identity(report.position));
  });

  it('plays a test start from the nearest label with the temporary values applied through Core', async () => {
    const report = await query({ entry, home }, { sceneId: 'home', line: 4, mode: 'test', variables: { trust: 8 } });
    expect(report).toMatchObject({ status: 'reached', entryScene: 'home', entryLabel: 'arrival', partialStage: true });
    const run = play({ entry, home }, report);
    await settle();
    expect(run.outcomes).toEqual([{ status: 'reached', visit: 1 }]);
    expect(run.store.snapshot()).toEqual({ trust: 10 });
  });
});

describe('from-line preview: form values and summaries', () => {
  it('reads option indices and typed temporary values; blanks keep the work’s values', () => {
    expect(parseOptionIndices('0, 1 2，3')).toEqual([0, 1, 2, 3]);
    expect(parseOptionIndices('  ')).toEqual([]);
    expect(() => parseOptionIndices('一')).toThrow(/从 0 开始/);
    expect(() => parseOptionIndices('-1')).toThrow();
    expect(parseTargetVariables([
      { name: 'trust', type: 'number', initial: 0, value: '8' },
      { name: 'met', type: 'flag', initial: false, value: 'true' },
      { name: 'title', type: 'string', initial: '', value: ' 雨 ' },
      { name: 'items', type: 'string[]', initial: [], value: '["伞"]' },
      { name: 'unused', type: 'number', initial: 1, value: '' },
    ])).toEqual({ trust: 8, met: true, title: ' 雨 ', items: ['伞'] });
    expect(() => parseTargetVariables([{ name: 'trust', type: 'number', initial: 0, value: '很多' }])).toThrow(/trust/);
    expect(() => parseTargetVariables([{ name: 'items', type: 'string[]', initial: [], value: '[伞' }])).toThrow(/items/);
  });

  it('says what the found path is, and what a test start does not rebuild', async () => {
    const found = describePreviewPath(await query({ entry, home }, { sceneId: 'home', line: 4 }));
    expect(found.title).toBe('已找到到达 home 第 4 行的路径');
    expect(found.details[0]).toBe('从 entry 场景开头出发，途中依次选择序号 0，到达 home 第 4 行的这一步之前。');
    const test = describePreviewPath(await query({ entry, home }, { sceneId: 'home', line: 4, mode: 'test', variables: { trust: 8 } }));
    expect(test.details.join('\n')).toContain('之前的背景、立绘和音乐没有重建');
    expect(test.details.join('\n')).toContain('trust = 8');
    const option = describePreviewPath(await query({ entry, home }, { sceneId: 'entry', line: 4 }));
    expect(option.details[0]).toBe('第 4 行是选项，起点停在第 3 行的整组选项出现之前。');
  });

  it('keeps unreachable, budget and host stops apart and names the actual conditions only as observations', async () => {
    const gated = '@scene entry\n@if trust > 0\n@jump home\n@endif\n@end';
    const unreachable = describePreviewPath(await query({ entry: gated, home }, { sceneId: 'home', line: 4 }));
    expect(unreachable.title).toBe('按本次条件没有到达 home 第 4 行');
    expect(unreachable.details.join('\n')).toMatch(/实测从未成立的条件：entry 第 2 行 trust > 0/);
    expect(unreachable.details.at(-1)).toBe('上面的条件只是实际运行中的结果，不一定是到不了的唯一原因。');
    const budget = describePreviewPath(await query({ entry, home }, { sceneId: 'home', line: 4, maxPaths: 1 }));
    expect(budget.title).toBe('查找预算已用完，还不能判断是否可达');
    const host = describePreviewPath(await query({ entry: '@scene entry\n@calendar next\n后文' }, { sceneId: 'entry', line: 3 }));
    expect(host.title).toBe('途中需要战斗、日程等宿主玩法接管');
  });

  it('accepts only well-formed target messages from the preview', () => {
    const message = { type: 'surdet-preview-target-state', traceId: 't', generation: 1, status: 'reached', message: '已到达目标', visit: 2 };
    expect(normalizePreviewTargetState(message)).toEqual(message);
    expect(normalizePreviewTargetState({ ...message, status: 'jumped' })).toBeNull();
    expect(normalizePreviewTargetState({ ...message, visit: 0 })).toBeNull();
    expect(normalizePreviewTargetState({ ...message, generation: '1' })).toBeNull();
  });
});
