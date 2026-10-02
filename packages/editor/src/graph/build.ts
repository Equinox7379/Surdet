/**
 * 流程图数据模型（E1a）：从 validate.ts 的编译产物（CompiledScene）提取标签级流程图，
 * 纯函数、可单测、不重新解析源码（编辑器同源纪律）。
 *
 * 节点三类：
 *  - scene      场景入口（s:<sceneId>）
 *  - label      场景内 @label（l:<sceneId>.<label>）
 *  - host-entry 配置驱动的宿主入口（h:<sceneId>；collectConfigSceneRoots 产出）
 *
 * 边类型：flow（顺序流）/ goto / jump / call / switch / loop / choice / if / host。
 * 顺序流：场景按"入口 → 各 label 出现顺序"切分为流单元，相邻单元间一条 flow 细边，
 * 保证图连通；跳转边的源 = 该跳转指令所在流单元。
 */
import type { CompiledScene, ChoiceInstr, CondJumpInstr, JumpInstr, CallInstr, SwitchInstr } from '@surdet/core';

export type FlowNodeKind = 'scene' | 'label' | 'host-entry';
export type FlowEdgeKind = 'flow' | 'goto' | 'jump' | 'call' | 'switch' | 'loop' | 'choice' | 'if' | 'host';

export interface FlowNode {
  id: string;
  kind: FlowNodeKind;
  sceneId: string;
  /** label 节点的标签名 */
  label?: string;
  /** 定位行（label 所在指令行；导航用） */
  line?: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  kind: FlowEdgeKind;
  /** choice 选项文本 / switch 分支值 / if 条件（展示在边上） */
  label?: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const sceneNodeId = (sceneId: string): string => `s:${sceneId}`;
export const labelNodeId = (sceneId: string, label: string): string => `l:${sceneId}.${label}`;
export const hostNodeId = (sceneId: string): string => `h:${sceneId}`;

/** 单个场景的流单元（入口 + 各 label 段）与其指令范围 */
interface FlowUnit {
  nodeId: string;
  /** [start, end) 指令索引范围 */
  start: number;
  end: number;
}

/** 场景切分为流单元：入口单元 + 每个 label 起一个新单元 */
function splitUnits(scene: CompiledScene): FlowUnit[] {
  const units: FlowUnit[] = [{ nodeId: sceneNodeId(scene.sceneId), start: 0, end: scene.instructions.length }];
  for (const [label, idx] of scene.labels) {
    units.push({ nodeId: labelNodeId(scene.sceneId, label), start: idx, end: scene.instructions.length });
  }
  units.sort((a, b) => a.start - b.start);
  for (let i = 0; i < units.length - 1; i++) units[i]!.end = units[i + 1]!.start;
  // 与 label 同索引的入口单元不可能（入口 start=0 且 label 索引≥0 时去重交给 nodeId 去重）
  return units;
}

/** 指令索引 → 所属流单元（units 按 start 升序） */
function unitAt(units: FlowUnit[], index: number): FlowUnit {
  let cur = units[0]!;
  for (const u of units) {
    if (u.start <= index) cur = u;
    else break;
  }
  return cur;
}

/** choice 选项块内的首个跳转指令（选项内联 @goto/@jump 已编译进指令流） */
function optionJump(scene: CompiledScene, optionStart: number, optionEnd: number): JumpInstr | null {
  for (let i = optionStart; i < optionEnd && i < scene.instructions.length; i++) {
    const instr = scene.instructions[i]!;
    if (instr.op === 'jump') return instr;
  }
  return null;
}

/** jump/call 目标解析：'scene.label' → 标签节点；'scene' → 场景节点 */
function targetNodeId(target: string): string {
  const dot = target.indexOf('.');
  return dot >= 0 ? labelNodeId(target.slice(0, dot), target.slice(dot + 1)) : sceneNodeId(target);
}

/** 编译器的内部跳转按目标索引投影到既有流单元，不制造空标签。 */
function gotoTargetNode(scene: CompiledScene, units: FlowUnit[], jump: JumpInstr): string {
  return jump.target === '' && jump.gotoIndex !== null
    ? unitAt(units, jump.gotoIndex).nodeId
    : labelNodeId(scene.sceneId, jump.target);
}

/** 构建单个场景内部的节点与边 */
function buildScene(scene: CompiledScene, nodes: Map<string, FlowNode>, edges: FlowEdge[]): void {
  // 节点：场景入口 + 各 label
  nodes.set(sceneNodeId(scene.sceneId), { kind: 'scene', id: sceneNodeId(scene.sceneId), sceneId: scene.sceneId });
  for (const [label, idx] of scene.labels) {
    const instr = scene.instructions[idx];
    nodes.set(labelNodeId(scene.sceneId, label), {
      kind: 'label',
      id: labelNodeId(scene.sceneId, label),
      sceneId: scene.sceneId,
      label,
      line: instr?.line,
    });
  }

  const units = splitUnits(scene);
  const unitIds = [...new Set(units.map((u) => u.nodeId))];

  // 顺序流边：相邻流单元（入口 → label 段 → label 段 …）
  for (let i = 0; i < unitIds.length - 1; i++) {
    edges.push({ from: unitIds[i]!, to: unitIds[i + 1]!, kind: 'flow' });
  }

  for (const instr of scene.instructions) {
    const from = unitAt(units, instr.index).nodeId;
    switch (instr.op) {
      case 'jump': {
        const j = instr as JumpInstr;
        if (j.kind === 'goto') {
          // @loop 与 @goto 同编译为回跳/跳转指令：目标标签在指令之前 = 循环回边（loop）
          const targetIdx = j.gotoIndex ?? scene.labels.get(j.target);
          const isBack = targetIdx !== undefined && targetIdx <= instr.index;
          edges.push({ from, to: gotoTargetNode(scene, units, j), kind: isBack ? 'loop' : 'goto' });
        } else {
          edges.push({ from, to: targetNodeId(j.target), kind: 'jump' });
        }
        break;
      }
      case 'call': {
        edges.push({ from, to: targetNodeId((instr as CallInstr).target), kind: 'call' });
        break;
      }
      case 'switch': {
        for (const c of (instr as SwitchInstr).cases) {
          edges.push({ from, to: labelNodeId(scene.sceneId, c.label), kind: 'switch', label: c.value });
        }
        break;
      }
      case 'condJump': {
        // @if 编译产物：target 为指令索引；仅当恰好指向某 @label 时画条件边（标签级可表达）
        const cj = instr as CondJumpInstr;
        const target = scene.instructions[cj.target];
        if (target && target.op === 'label') {
          edges.push({ from, to: labelNodeId(scene.sceneId, target.name), kind: 'if', label: `不满足（${cj.expr}）` });
        }
        break;
      }
      case 'choice': {
        const ch = instr as ChoiceInstr;
        // 每个选项一条边（边标签 = 选项文本 + 可选条件）；目标取选项块内首个跳转
        const starts = ch.options.map((o) => o.blockStart);
        ch.options.forEach((opt, oi) => {
          const end = oi + 1 < ch.options.length ? starts[oi + 1]! : ch.afterIndex;
          const jump = optionJump(scene, opt.blockStart, end);
          if (!jump) return; // 无跳转选项：落到 choice 之后（顺序流已表达）
          const to = jump.kind === 'goto' ? gotoTargetNode(scene, units, jump) : targetNodeId(jump.target);
          edges.push({
            from,
            to,
            kind: 'choice',
            label: opt.when ? `${opt.label} [if:${opt.when}]` : opt.label,
          });
        });
        break;
      }
      default:
        break;
    }
  }
}

/**
 * 项目级流程图构建：全部编译产物 + 配置驱动的宿主入口。
 * configRoots 来自 core collectConfigSceneRoots（CLI 同源）：目标场景存在时画"宿主入口"虚框节点。
 */
export function buildFlowGraph(scenes: Map<string, CompiledScene>, configRoots: readonly string[] = []): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  for (const scene of scenes.values()) {
    buildScene(scene, nodes, edges);
  }

  // 宿主入口：配置引用且场景存在才画（悬空引用由 lint 报，不在图中虚构节点）
  for (const root of new Set(configRoots)) {
    if (!scenes.has(root)) continue;
    const hid = hostNodeId(root);
    nodes.set(hid, { kind: 'host-entry', id: hid, sceneId: root });
    edges.push({ from: hid, to: sceneNodeId(root), kind: 'host' });
  }

  return { nodes: [...nodes.values()], edges };
}
