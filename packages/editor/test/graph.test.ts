/**
 * graph/build.ts 图构建单测（E1a）：choice 多边、条件标签、call/jump/switch/loop 边、
 * 宿主入口节点、流单元顺序流。
 */
import { describe, expect, it } from 'vitest';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore } from '@surdet/core';
import type { CompiledScene, CoreEventMap } from '@surdet/core';
import { buildFlowGraph, sceneNodeId, labelNodeId, hostNodeId } from '../src/graph/build.js';

function compile(id: string, src: string): CompiledScene {
  return compileScene(src, `${id}.gal`, id);
}

function scenesOf(entries: [string, string][]): Map<string, CompiledScene> {
  const m = new Map<string, CompiledScene>();
  for (const [id, src] of entries) m.set(id, compile(id, src));
  return m;
}

describe('buildFlowGraph（标签级流程图数据模型）', () => {
  it.each([true, false])('does not invent an empty label for internal if/else control flow (labelled destination=%s)', (labelled) => {
    const compiled = compile('ch1', '@if x > 1\n凛：条件满足。\n@else\n凛：条件不满足。\n@endif\n'
      + (labelled ? '@label after\n' : '') + '凛：条件合并。\n@end\n');
    const graph = buildFlowGraph(new Map([['ch1', compiled]]));
    expect(graph.edges.filter((edge) => !graph.nodes.some((node) => node.id === edge.to))).toEqual([]);
    expect(graph.edges.filter((edge) => edge.kind === 'goto')).toEqual(labelled
      ? [{ from: sceneNodeId('ch1'), to: labelNodeId('ch1', 'after'), kind: 'goto' }]
      : [{ from: sceneNodeId('ch1'), to: sceneNodeId('ch1'), kind: 'goto' }]);
    const missing = buildFlowGraph(scenesOf([['real', '@jump missing\n']]));
    expect(missing.edges).toContainEqual({ from: sceneNodeId('real'), to: sceneNodeId('missing'), kind: 'jump', line: 1 });
  });

  it.each([true, false])('keeps a real effect-only choice and its continuation in the target flow unit (labelled=%s)', (labelled) => {
    const compiled = compile('ch1', '@choice\n  继续 -> @mod x +1\n'
      + (labelled ? '@label after\n' : '') + '凛：合并。\n@end\n');
    const graph = buildFlowGraph(new Map([['ch1', compiled]]));
    const to = labelled ? labelNodeId('ch1', 'after') : sceneNodeId('ch1');
    expect(graph.edges.filter((edge) => !graph.nodes.some((node) => node.id === edge.to))).toEqual([]);
    expect(graph.edges.filter((edge) => edge.kind === 'choice')).toEqual([
      { from: sceneNodeId('ch1'), to, kind: 'choice', label: '继续' },
    ]);
    expect(graph.edges.filter((edge) => edge.kind === 'goto')).toEqual([
      { from: sceneNodeId('ch1'), to, kind: 'goto' },
    ]);
  });

  it('carries the source line of real jumps, calls and options, never of compiler-internal jumps', () => {
    const graph = buildFlowGraph(scenesOf([['ch1', '@scene ch1\n@goto a\n@label a\n@call ch2\n@choice\n  去 -> @jump ch2\n  留 -> @mod x +1\n@if x > 1\n凛：多。\n@else\n凛：少。\n@endif\n@end\n'],
      ['ch2', '@scene ch2\n@return\n']]));
    const lines = graph.edges.filter((edge) => edge.from.includes('ch1') && edge.kind !== 'flow')
      .map((edge) => `${edge.kind}:${edge.label ?? ''}:${edge.line ?? '-'}`).sort();
    expect(lines).toEqual(['call::4', 'choice:去:6', 'choice:留:-', 'goto::-', 'goto::2', 'goto::-', 'jump::6'].sort());
  });

  it.each([0, 2])('labels a conditional skip with the actual false condition for x=%d', (x) => {
    const compiled = compile('ch1', '@if x > 1\n凛：条件满足。\n@endif\n@label after\n凛：条件合并。\n@end\n');
    const graph = buildFlowGraph(new Map([['ch1', compiled]]));
    const conditionalEdges = graph.edges.filter((edge) => edge.kind === 'if');
    const store = new VariableStore([{ name: 'x', type: 'number', initial: x }]);
    const bus = new EventBus<CoreEventMap>();
    const registry = new SceneRegistry();
    registry.register(compiled);
    const interpreter = new Interpreter(store, bus, registry);
    const text: string[] = [];
    const conditions: boolean[] = [];
    bus.on('text', (event) => text.push(event.value));
    bus.on('runtimeTrace', (event) => { if (event.condition) conditions.push(event.condition.result); });
    interpreter.start('ch1');
    expect(conditions).toEqual([x > 1]);
    expect(text).toEqual([x > 1 ? '条件满足。' : '条件合并。']);
    expect(conditionalEdges).toEqual([{
      from: sceneNodeId('ch1'), to: labelNodeId('ch1', 'after'), kind: 'if', label: '不满足（x > 1）',
    }]);
    expect(store.snapshot()).toEqual({ x });
  });

  it('每个场景产出场景入口节点 + 各 label 节点，相邻流单元有顺序流边', () => {
    const g = buildFlowGraph(scenesOf([
      ['ch1', '凛：开场。\n@label a\n凛：甲。\n@label b\n凛：乙。\n'],
    ]));
    const ids = g.nodes.map((n) => n.id);
    expect(ids).toContain(sceneNodeId('ch1'));
    expect(ids).toContain(labelNodeId('ch1', 'a'));
    expect(ids).toContain(labelNodeId('ch1', 'b'));
    const flows = g.edges.filter((e) => e.kind === 'flow');
    expect(flows).toEqual([
      { from: sceneNodeId('ch1'), to: labelNodeId('ch1', 'a'), kind: 'flow' },
      { from: labelNodeId('ch1', 'a'), to: labelNodeId('ch1', 'b'), kind: 'flow' },
    ]);
  });

  it('choice 每个选项一条边，边标签 = 选项文本；[if:] 条件显示在边上', () => {
    const g = buildFlowGraph(scenesOf([
      ['ch1', '@choice\n  打招呼 -> @goto greet\n  离开 [if:hasSword] -> @goto bye\n@label greet\n凛：好。\n@label bye\n凛：再见。\n'],
    ]));
    const choiceEdges = g.edges.filter((e) => e.kind === 'choice');
    expect(choiceEdges).toHaveLength(2);
    expect(choiceEdges.some((e) => e.to === labelNodeId('ch1', 'greet') && e.label === '打招呼')).toBe(true);
    expect(choiceEdges.some((e) => e.to === labelNodeId('ch1', 'bye') && e.label === '离开 [if:hasSword]')).toBe(true);
  });

  it('跨场景 @jump 场景.标签 → 目标标签节点；裸场景 → 场景节点；@call 边 kind=call', () => {
    const g = buildFlowGraph(scenesOf([
      ['ch1', '@jump ch2.mid\n@call ch3\n'],
      ['ch2', '@label mid\n凛：中段。\n'],
      ['ch3', '凛：子场景。\n'],
    ]));
    expect(g.edges.some((e) => e.kind === 'jump' && e.from === sceneNodeId('ch1') && e.to === labelNodeId('ch2', 'mid'))).toBe(true);
    expect(g.edges.some((e) => e.kind === 'call' && e.from === sceneNodeId('ch1') && e.to === sceneNodeId('ch3'))).toBe(true);
  });

  it('@switch 每个分支一条边（边标签=分支值）；@loop 回边指向标签', () => {
    const g = buildFlowGraph(scenesOf([
      ['ch1', '@switch chapter 1:c1 2:c2\n@label c1\n凛：一。\n@label c2\n凛：二。\n@loop c1\n'],
    ]));
    const sw = g.edges.filter((e) => e.kind === 'switch');
    expect(sw).toHaveLength(2);
    expect(sw.some((e) => e.to === labelNodeId('ch1', 'c1') && e.label === '1')).toBe(true);
    expect(sw.some((e) => e.to === labelNodeId('ch1', 'c2') && e.label === '2')).toBe(true);
    expect(g.edges.some((e) => e.kind === 'loop' && e.to === labelNodeId('ch1', 'c1'))).toBe(true);
  });

  it('@if 条件跳转目标恰为 @label 时画条件边（边标签含表达式）', () => {
    const g = buildFlowGraph(scenesOf([
      ['ch1', '@if x > 1\n@jump ch1\n@endif\n@label after\n凛：后。\n'],
    ]));
    // @if 为假跳过 then 块 → condJump 指向 endif 之后；若编译器将目标定位到 label after 则画边
    const ifEdges = g.edges.filter((e) => e.kind === 'if');
    expect(ifEdges).toHaveLength(1);
    for (const e of ifEdges) {
      expect(e.label).toBe('不满足（x > 1）');
      expect(e.to).toBe(labelNodeId('ch1', 'after'));
    }
  });

  it('宿主入口：configRoots 中的场景画 host-entry 节点 + host 边；悬空引用不虚构节点', () => {
    const g = buildFlowGraph(scenesOf([
      ['ch1', '凛：开场。\n'],
      ['turn_ev', '凛：回合事件。\n'],
    ]), ['turn_ev', 'ghost_scene']);
    expect(g.nodes.some((n) => n.id === hostNodeId('turn_ev') && n.kind === 'host-entry')).toBe(true);
    expect(g.edges.some((e) => e.kind === 'host' && e.from === hostNodeId('turn_ev') && e.to === sceneNodeId('turn_ev'))).toBe(true);
    expect(g.nodes.some((n) => n.sceneId === 'ghost_scene')).toBe(false); // 悬空不画
  });

  it('starter 剧本形态：choice 多边 + goto 回边可组合（集成烟囱）', () => {
    const g = buildFlowGraph(scenesOf([
      ['ch01', '凛：开场。\n@choice\n  选项A -> @goto a\n  选项B -> @goto b\n@label a\n凛：甲。\n@jump ch02.start\n@label b\n凛：乙。\n'],
      ['ch02', '@label start\n凛：二章。\n'],
    ]));
    expect(g.edges.filter((e) => e.kind === 'choice')).toHaveLength(2);
    expect(g.edges.some((e) => e.kind === 'jump' && e.to === labelNodeId('ch02', 'start'))).toBe(true);
    // 标签节点携带定位行（导航用）
    const labelA = g.nodes.find((n) => n.id === labelNodeId('ch01', 'a'));
    expect(labelA?.line).toBeGreaterThan(0);
  });
});
