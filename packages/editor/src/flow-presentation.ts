import { findChoiceCondition } from '@surdet/core';
import type {
  FlowEdge,
  FlowEdgeKind,
  FlowNode,
  FlowNodeKind,
} from './graph/build.js';

export type FlowValidationState = 'unchecked' | 'ok' | 'warning' | 'error';

export interface FlowNodePresentation {
  kindLabel: string;
  primaryText: string;
  technicalText: string;
  ariaLabel: string;
}

export interface FlowEdgePresentation {
  kindLabel: string;
  displayText: string;
  technicalText: string;
  choiceText?: string;
  conditionText?: string;
}

const NODE_KIND_LABELS: Record<FlowNodeKind, string> = {
  scene: '场景',
  label: '段落标记',
  'host-entry': '项目入口',
};

const EDGE_KIND_LABELS: Record<FlowEdgeKind, string> = {
  flow: '顺序',
  goto: '段内跳转',
  jump: '场景跳转',
  call: '调用',
  switch: '分支',
  loop: '循环',
  choice: '选项',
  if: '条件',
  host: '由项目配置触发',
};

const VALIDATION_STATE_LABELS: Record<FlowValidationState, string> = {
  unchecked: '尚未校验',
  ok: '正常',
  warning: '警告',
  error: '错误',
};

export function flowNodeKindLabel(kind: FlowNodeKind): string {
  return NODE_KIND_LABELS[kind];
}

export function flowEdgeKindLabel(kind: FlowEdgeKind): string {
  return EDGE_KIND_LABELS[kind];
}

export function flowValidationStateLabel(state: FlowValidationState): string {
  return VALIDATION_STATE_LABELS[state];
}

export function presentFlowNode(node: FlowNode): FlowNodePresentation {
  const kindLabel = flowNodeKindLabel(node.kind);
  if (node.kind === 'label') {
    const label = node.label?.trim() || '未命名';
    return {
      kindLabel,
      primaryText: `段落 ${label}`,
      technicalText: `场景 ${node.sceneId} · @label ${node.label ?? ''} · 节点 ${node.id}`,
      ariaLabel: `段落 ${label}，位于场景 ${node.sceneId}，点击打开`,
    };
  }
  if (node.kind === 'host-entry') {
    return {
      kindLabel,
      primaryText: `项目入口 ${node.sceneId}`,
      technicalText: `host-entry · 场景 ${node.sceneId} · 节点 ${node.id}`,
      ariaLabel: `项目入口，通向场景 ${node.sceneId}，点击打开`,
    };
  }
  return {
    kindLabel,
    primaryText: node.sceneId,
    technicalText: `scene · 场景 ${node.sceneId} · 节点 ${node.id}`,
    ariaLabel: `场景 ${node.sceneId}，点击打开`,
  };
}

export function presentFlowEdge(edge: FlowEdge): FlowEdgePresentation {
  const kindLabel = flowEdgeKindLabel(edge.kind);
  const content = edge.label?.trim();
  if (edge.kind === 'choice') {
    let match: ReturnType<typeof findChoiceCondition> = null;
    // An unfinished draft is still displayable; diagnostics owns its syntax error.
    try { match = findChoiceCondition(content ?? ''); } catch { /* Show the original draft label. */ }
    const choiceText = (match ? content!.slice(0, match.index) : content ?? '').trim() || '未命名选择';
    return {
      kindLabel,
      displayText: choiceText,
      choiceText,
      ...(match?.value.trim() ? { conditionText: '有条件' } : {}),
      technicalText: `${edge.kind} · ${edge.from} → ${edge.to}${content ? ` · ${content}` : ''}`,
    };
  }
  return {
    kindLabel,
    displayText: content ? `${kindLabel}：${content}` : kindLabel,
    technicalText: `${edge.kind} · ${edge.from} → ${edge.to}${content ? ` · ${content}` : ''}`,
  };
}
