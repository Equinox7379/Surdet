import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { presentFlowEdge } from '../src/flow-presentation.js';
import type { FlowEdge, FlowEdgeKind, FlowNode, FlowNodeKind } from '../src/graph/build.js';

type FlowValidationState = 'unchecked' | 'ok' | 'warning' | 'error';

interface FlowNodePresentation {
  kindLabel: string;
  primaryText: string;
  technicalText: string;
  ariaLabel: string;
}

interface FlowEdgePresentation {
  kindLabel: string;
  displayText: string;
  technicalText: string;
}

interface FlowPresentationModule {
  flowNodeKindLabel: (kind: FlowNodeKind) => string;
  flowEdgeKindLabel: (kind: FlowEdgeKind) => string;
  flowValidationStateLabel: (state: FlowValidationState) => string;
  presentFlowNode: (node: FlowNode) => FlowNodePresentation;
  presentFlowEdge: (edge: FlowEdge) => FlowEdgePresentation;
}

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const presentationPath = path.join(editorRoot, 'src/flow-presentation.ts');

async function loadPresentation(): Promise<FlowPresentationModule | null> {
  if (!existsSync(presentationPath)) return null;
  const moduleUrl = pathToFileURL(presentationPath).href;
  return import(/* @vite-ignore */ moduleUrl) as Promise<FlowPresentationModule>;
}

async function requirePresentation(): Promise<FlowPresentationModule> {
  const presentation = await loadPresentation();
  expect(
    presentation,
    'Wave 3A must provide the pure src/flow-presentation.ts display projection',
  ).not.toBeNull();
  return presentation!;
}

describe('Flow Canvas Chinese presentation contract', () => {
  it('#63 displays the complete quoted choice label and only marks real conditions', () => {
    const edge: FlowEdge = { kind: 'choice', from: 's:a', to: 's:b', label: '显示"[if:false]" [if:true]' };
    expect(presentFlowEdge(edge)).toMatchObject({ displayText: '显示"[if:false]"', choiceText: '显示"[if:false]"', conditionText: '有条件' });
    expect(presentFlowEdge({ ...edge, label: '显示"[if:false]"' }).conditionText).toBeUndefined();
    expect(presentFlowEdge({ ...edge, label: '显示"[if:false]"' }).choiceText).toBe('显示"[if:false]"');
    expect(presentFlowEdge({ ...edge, label: '未完成 [if:true' })).toMatchObject({ choiceText: '未完成 [if:true' });
    expect(presentFlowEdge({ ...edge, label: '条件 [if:true] 后面还在写' })).toMatchObject({ choiceText: '条件 [if:true] 后面还在写' });
  });
  it('covers every stable node, edge, and validation kind with Chinese-first labels', async () => {
    const presentation = await requirePresentation();

    expect(Object.fromEntries(
      (['scene', 'label', 'host-entry'] satisfies FlowNodeKind[])
        .map((kind) => [kind, presentation.flowNodeKindLabel(kind)]),
    )).toEqual({
      scene: '场景',
      label: '段落标记',
      'host-entry': '项目入口',
    });

    expect(Object.fromEntries(
      (['flow', 'goto', 'jump', 'call', 'switch', 'loop', 'choice', 'if', 'host'] satisfies FlowEdgeKind[])
        .map((kind) => [kind, presentation.flowEdgeKindLabel(kind)]),
    )).toEqual({
      flow: '顺序',
      goto: '段内跳转',
      jump: '场景跳转',
      call: '调用',
      switch: '分支',
      loop: '循环',
      choice: '选项',
      if: '条件',
      host: '由项目配置触发',
    });

    expect(Object.fromEntries(
      (['unchecked', 'ok', 'warning', 'error'] satisfies FlowValidationState[])
        .map((state) => [state, presentation.flowValidationStateLabel(state)]),
    )).toEqual({
      unchecked: '尚未校验',
      ok: '正常',
      warning: '警告',
      error: '错误',
    });
  });

  it('shows human-readable node text while retaining raw identity only as technical detail', async () => {
    const presentation = await requirePresentation();
    const scene = Object.freeze({ kind: 'scene', id: 's:ch01_01', sceneId: 'ch01_01' } satisfies FlowNode);
    const label = Object.freeze({
      kind: 'label',
      id: 'l:ch01_01.start',
      sceneId: 'ch01_01',
      label: 'start',
      line: 2,
    } satisfies FlowNode);
    const entry = Object.freeze({
      kind: 'host-entry',
      id: 'h:entryScene:ch01_01',
      sceneId: 'ch01_01',
    } satisfies FlowNode);

    expect(presentation.presentFlowNode(scene)).toMatchObject({
      kindLabel: '场景',
      primaryText: 'ch01_01',
    });
    expect(presentation.presentFlowNode(label)).toMatchObject({
      kindLabel: '段落标记',
      primaryText: '段落 start',
    });
    expect(presentation.presentFlowNode(entry)).toMatchObject({
      kindLabel: '项目入口',
      primaryText: '项目入口 ch01_01',
    });

    const labelProjection = presentation.presentFlowNode(label);
    expect(labelProjection.primaryText).not.toContain('@label');
    expect(labelProjection.technicalText).toContain('@label start');
    expect(labelProjection.technicalText).toContain('ch01_01');
    expect(labelProjection.ariaLabel).toContain('点击打开');
    expect(labelProjection.ariaLabel).toContain('段落 start');

    expect(label).toEqual({
      kind: 'label',
      id: 'l:ch01_01.start',
      sceneId: 'ch01_01',
      label: 'start',
      line: 2,
    });
  });

  it('formats real choice and condition content without translating serialized values', async () => {
    const presentation = await requirePresentation();
    const choice = Object.freeze({
      from: 'l:ch01_01.start',
      to: 'l:ch01_01.stay',
      kind: 'choice',
      label: '保持沉默',
    } satisfies FlowEdge);
    const condition = Object.freeze({
      from: 'l:ch01_01.start',
      to: 's:ch02',
      kind: 'if',
      label: 'trust >= 10',
    } satisfies FlowEdge);

    expect(presentation.presentFlowEdge(choice)).toMatchObject({
      kindLabel: '选项',
      displayText: '保持沉默',
      choiceText: '保持沉默',
    });
    expect(presentation.presentFlowEdge(condition)).toMatchObject({
      kindLabel: '条件',
      displayText: '条件：trust >= 10',
    });
    expect(presentation.presentFlowEdge(condition).technicalText).toContain('if');
    expect(presentation.presentFlowEdge(condition).technicalText).toContain('trust >= 10');
    expect(condition.label).toBe('trust >= 10');
  });

  it('does not invent unavailable production fields or a generic status truth', async () => {
    const presentation = await requirePresentation();
    const nodeProjection = presentation.presentFlowNode({
      kind: 'scene',
      id: 's:ch01_01',
      sceneId: 'ch01_01',
    });
    const edgeProjection = presentation.presentFlowEdge({
      from: 's:ch01_01',
      to: 's:ch02',
      kind: 'jump',
    });
    const keys = [...Object.keys(nodeProjection), ...Object.keys(edgeProjection)];
    const forbidden = [
      'chapter', 'duration', 'completion', 'status', 'locked', 'review', 'author', 'owner',
      'version', 'collaboration', 'comments', 'notifications', 'probability', 'coverage',
      'runtimeTruth', 'sourceLine',
    ];

    for (const field of forbidden) {
      expect(keys, `presentation must not fabricate ${field}`).not.toContain(field);
    }
  });
});
