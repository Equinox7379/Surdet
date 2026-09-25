/**
 * E1b 流程图交互编辑纯函数测试：引用改写/引用计数/插入行构造/末尾追加。
 * （拖拽 DOM 交互与右键菜单由手工验收覆盖；此处保证落盘文本变换的正确性）
 */
import { describe, expect, it } from 'vitest';
import { rewriteSceneRefs, countSceneRefs, buildJumpLine, appendLineToScene, layoutFlowGraph } from '../src/panels/flow.js';
import { buildFlowGraph } from '../src/graph/build.js';
import type { FlowNode } from '../src/graph/build.js';

const sceneNode = (sceneId: string): FlowNode => ({ kind: 'scene', id: `s:${sceneId}`, sceneId });
const labelNode = (sceneId: string, label: string): FlowNode => ({ kind: 'label', id: `l:${sceneId}.${label}`, sceneId, label });

/** 测试用场景集构造（与 graph.test.ts 同构；真实编译产物驱动布局层） */
import { compileScene } from '@surdet/core';
import type { CompiledScene } from '@surdet/core';
function scenesOf(entries: [string, string][]): Map<string, CompiledScene> {
  const m = new Map<string, CompiledScene>();
  for (const [id, src] of entries) m.set(id, compileScene(src, `${id}.gal`, id));
  return m;
}

describe('rewriteSceneRefs（重命名引用同步改写）', () => {
  it('改写 @jump/@call 的裸场景与 场景.标签 目标', () => {
    const src = '@jump old\n@jump old.mid\n@call old\n@call old.x\n';
    expect(rewriteSceneRefs(src, 'old', 'new')).toBe('@jump new\n@jump new.mid\n@call new\n@call new.x\n');
  });

  it('不误伤台词文本与相似前缀的场景 ID', () => {
    const src = '凛：去 old 城镇看看。\n@jump older\n@jump old2.mid\n@set x = 1\n';
    expect(rewriteSceneRefs(src, 'old', 'new')).toBe(src);
  });

  it('处理 CRLF 与缩进行', () => {
    const src = '@jump old\r\n  @call old.label\r\n';
    expect(rewriteSceneRefs(src, 'old', 'new')).toBe('@jump new\r\n  @call new.label\r\n');
  });

  it('使用条件引号外的真实箭头，不改写条件字串或被 Core 忽略的额外跳转', () => {
    const src = '@choice\n  前往 [if:" -> @jump old " == " -> @jump old "] -> @call old.entry @jump newer @jump old\n';
    expect(countSceneRefs(src, 'old')).toBe(1);
    expect(rewriteSceneRefs(src, 'old', 'new')).toBe(src.replace('@call old.entry', '@call new.entry'));
  });
});

describe('countSceneRefs（删除前引用检查）', () => {
  it('统计裸场景与带标签引用；相似 ID 不计入', () => {
    const src = '@jump sc\n@jump sc.mid\n@call sc\n@jump scx\n凛：sc\n';
    expect(countSceneRefs(src, 'sc')).toBe(3);
  });
});

describe('buildJumpLine（拖拽建链插入行）', () => {
  it('跨场景到标签 → @jump 场景.标签', () => {
    expect(buildJumpLine(sceneNode('ch1'), labelNode('ch2', 'mid'))).toBe('@jump ch2.mid');
  });
  it('跨场景到场景入口 → @jump 场景', () => {
    expect(buildJumpLine(sceneNode('ch1'), sceneNode('ch2'))).toBe('@jump ch2');
  });
  it('同场景到标签 → @goto 标签', () => {
    expect(buildJumpLine(labelNode('ch1', 'a'), labelNode('ch1', 'b'))).toBe('@goto b');
  });
  it('同场景到场景入口 → @jump 本场景（回到开头）', () => {
    expect(buildJumpLine(labelNode('ch1', 'a'), sceneNode('ch1'))).toBe('@jump ch1');
  });
});

describe('appendLineToScene（末尾追加保持换行风格）', () => {
  it('文末无换行 → 补 eol 再追加', () => {
    expect(appendLineToScene('a\nb', '\n', '@jump x')).toBe('a\nb\n@jump x');
  });
  it('文末已有换行 → 直接追加', () => {
    expect(appendLineToScene('a\nb\n', '\n', '@jump x')).toBe('a\nb\n@jump x');
  });
  it('CRLF 风格保持', () => {
    expect(appendLineToScene('a\r\n', '\r\n', '@goto y')).toBe('a\r\n@goto y');
  });
  it('空场景 → 只写新行', () => {
    expect(appendLineToScene('', '\n', '@jump x')).toBe('@jump x');
  });
});

describe('layoutFlowGraph（验收轮 Minor3：顶部越界保护）', () => {
  it('入口场景同时是宿主入口（列首行）：全部节点 y 非负，相对布局不变', () => {
    // ch1 既是 entryScene 又被配置引用（events.json 形态）：host 节点画在目标上方，修复前 y 为负
    const graph = buildFlowGraph(scenesOf([
      ['ch1', '凛：开场。\n'],
      ['ch2', '@label a\n凛：二。\n'],
    ]), ['ch1', 'ch2']);
    const layout = layoutFlowGraph(graph, 'ch1');
    for (const box of layout.boxes.values()) {
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
    // host 节点仍在目标场景节点上方（相对关系保持）
    const host = [...layout.boxes.values()].find((b) => b.node.kind === 'host-entry' && b.node.sceneId === 'ch1');
    const target = layout.boxes.get('s:ch1');
    expect(host && target).toBeTruthy();
    expect(host!.y + host!.h).toBeLessThanOrEqual(target!.y);
  });
});
