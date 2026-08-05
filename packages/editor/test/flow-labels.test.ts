/**
 * 边标签位置回归（验收反馈三轮）：真实 starter 全图——每条带标签的边，
 * 其标签 y 必须落在该边两端点的纵向范围之内（此前同泳道误判为跨列回边，
 * 三条选择肢标签整体下移一层）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileScene, collectConfigSceneRoots } from '@surdet/core';
import type { CompiledScene } from '@surdet/core';
import { buildFlowGraph } from '../src/graph/build.js';
import { layoutFlowGraph, edgeGeometry } from '../src/panels/flow.js';

const base = new URL('../../../examples/starter/', import.meta.url);
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, base)), 'utf8');

describe('边标签纵向位置回归（真实 starter 全图）', () => {
  const scenes = new Map<string, CompiledScene>();
  for (const id of ['ch01_01', 'ch01_02', 'ch02', 'ch03_turn_event']) {
    scenes.set(id, compileScene(read(`content/scenario/${id}.gal`), `${id}.gal`, id));
  }
  const roots = collectConfigSceneRoots({
    events: JSON.parse(read('content/config/events.json')),
    growth: JSON.parse(read('content/config/growth.json')),
    calendar: JSON.parse(read('content/config/calendar.json')),
  });
  const graph = buildFlowGraph(scenes, roots);
  const layout = layoutFlowGraph(graph, 'ch01_01');

  it('ch01_01 的 3 条 choice 边标签各归其位（沉默最上、转身离开最下）', () => {
    const labeled = graph.edges.filter((e) => e.kind === 'choice');
    expect(labeled).toHaveLength(3);
    const lyOf = (labelPrefix: string): number => {
      const e = labeled.find((x) => x.label!.startsWith(labelPrefix))!;
      const a = layout.boxes.get(e.from)!;
      const b = layout.boxes.get(e.to)!;
      const sameLane = a.node.sceneId === b.node.sceneId && a.node.kind !== 'host-entry' && b.node.kind !== 'host-entry';
      return edgeGeometry(a, b, e.kind, sameLane).ly;
    };
    const lySilence = lyOf('沉默');
    const lySword = lyOf('拔出剑');
    const lyLeave = lyOf('转身离开');
    // 顺序与目标节点深度一致：沉默(answer_silence) 最上，转身离开(answer_leave) 最下
    expect(lySilence).toBeLessThan(lySword);
    expect(lySword).toBeLessThan(lyLeave);
  });

  it('任意带标签的边：标签 y 落在边两端点纵向范围之内（错位即失败）', () => {
    for (const e of graph.edges.filter((x) => x.label)) {
      const a = layout.boxes.get(e.from)!;
      const b = layout.boxes.get(e.to)!;
      const sameLane = a.node.sceneId === b.node.sceneId && a.node.kind !== 'host-entry' && b.node.kind !== 'host-entry';
      const geo = edgeGeometry(a, b, e.kind, sameLane);
      const lo = Math.min(a.y + a.h / 2, b.y + b.h / 2);
      const hi = Math.max(a.y + a.h / 2, b.y + b.h / 2);
      expect(geo.ly, `边 '${e.label}' 标签 y=${geo.ly} 超出边范围 [${lo},${hi}]`).toBeGreaterThanOrEqual(lo - 1);
      expect(geo.ly, `边 '${e.label}' 标签 y=${geo.ly} 超出边范围 [${lo},${hi}]`).toBeLessThanOrEqual(hi + 1);
    }
  });
});
