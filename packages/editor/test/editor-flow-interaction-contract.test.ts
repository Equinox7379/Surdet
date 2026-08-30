import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { layoutFlowGraph, minimapClientToWorld } from '../src/panels/flow.js';
import type { FlowGraph } from '../src/graph/build.js';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flowSource = readFileSync(path.join(editorRoot, 'src/panels/flow.ts'), 'utf8');
const flowExecutableSource = flowSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('Flow Canvas interaction preservation contract', () => {
  it('keeps graph construction and scene edit semantics on their established imports', () => {
    expect(flowSource).toMatch(/import\s*\{[^}]*buildFlowGraph[^}]*\}\s*from\s*['"]\.\.\/graph\/build\.js['"]/s);
    expect(flowSource).toMatch(/import\s*\{[^}]*setSceneText[^}]*\}\s*from\s*['"]\.\.\/history\.js['"]/s);
    expect(flowSource).toMatch(/import\s*\{[^}]*appendLineToScene[^}]*\}\s*from\s*['"]\.\.\/scene-text\.js['"]/s);
    expect(flowSource).toMatch(/collectConfigSceneRoots\(state\.configFiles\)/);
    expect(flowSource).toMatch(/buildFlowGraph\(scenes\s*,\s*roots\)/);
    expect(flowSource).toMatch(/buildJumpLine\(\s*from(?:Node)?\s*,\s*to(?:Node)?\s*\)/);
    expect(flowSource).toMatch(/setSceneText\(/);
  });

  it('makes every real node focusable and activates the same navigation with Enter or Space', () => {
    expect(flowSource).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]button['"]\s*\)/);
    expect(flowSource).toMatch(/setAttribute\(\s*['"]tabindex['"]\s*,\s*['"]0['"]\s*\)/);
    expect(flowSource).toMatch(/setAttribute\(\s*['"]aria-label['"]/);
    expect(flowSource).toMatch(/setAttribute\(\s*['"]aria-current['"]/);
    expect(flowSource).toMatch(/addEventListener\(\s*['"]keydown['"]/);
    expect(flowSource).toMatch(/(?:event|e)\.key\s*===\s*['"]Enter['"]/);
    expect(flowSource).toMatch(/(?:event|e)\.key\s*===\s*['"] ['"]/);

    const keydownHandler = [...flowSource.matchAll(/addEventListener\(\s*['"]keydown['"][\s\S]{0,1200}?\n\s*}\s*\)/g)]
      .map((match) => match[0])
      .find((handler) => handler.includes('openFlowNode(node)')) ?? '';
    const sharedNavigation = keydownHandler.match(/\b([A-Za-z_$][\w$]*(?:FlowNode|ToFlowNode|Node))\(\s*node\s*\)/)?.[1];
    expect(sharedNavigation, 'keyboard activation must call a shared node navigation helper').toBeTruthy();
    expect(
      flowSource.match(new RegExp(`\\b${sharedNavigation}\\(\\s*(?:box\\.)?node\\s*\\)`, 'g'))?.length ?? 0,
      'pointer and keyboard paths must both call the same navigation helper',
    ).toBeGreaterThanOrEqual(2);
  });

  it('uses honest single-click language and exposes raw DSL only as technical detail', () => {
    expect(flowExecutableSource).toMatch(/点击打开/);
    expect(flowExecutableSource).not.toMatch(/双击跳转/);
    expect(flowSource).toMatch(/presentFlowNode\(/);
    expect(flowSource).toMatch(/\.primaryText/);
    expect(flowSource).toMatch(/technicalText/);
  });

  it('exposes stable viewport commands that operate on the existing view object', () => {
    for (const action of ['zoom-out', 'zoom-in', 'fit-canvas', 'focus-current', 'toggle-legend']) {
      expect(flowSource, `missing data-flow-action=${action}`).toMatch(
        new RegExp(`(?:dataset\\.flowAction\\s*=\\s*['\"]${action}['\"]|setAttribute\\(\\s*['\"]data-flow-action['\"]\\s*,\\s*['\"]${action}['\"]\\s*\\))`),
      );
    }

    expect(flowSource).toMatch(/view\.k/);
    expect(flowSource).toMatch(/view\.tx/);
    expect(flowSource).toMatch(/view\.ty/);
    expect(flowSource).toMatch(/layout\.boxes/);
    expect(flowSource).toMatch(/state\.current/);
    expect(flowSource).toMatch(/aria-expanded/);
    expect(flowSource).toMatch(/rerenderFlow\(\s*container\s*,\s*focusSelector\s*\)/);
    expect(flowSource).toMatch(/focusSelector[\s\S]{0,400}?focus\(\s*\{\s*preventScroll\s*:\s*true\s*}\s*\)/);

    const fitHandler = flowSource.match(/fitCanvas\.onclick\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*};/)?.[0] ?? '';
    expect(fitHandler).toMatch(/availableWidth\s*\/\s*contentWidth/);
    expect(fitHandler).toMatch(/availableHeight\s*\/\s*contentHeight/);
    expect(fitHandler).toMatch(/currentViewportSize\(\)/);
    expect(fitHandler).not.toMatch(/Math\.max\(\s*0\.2/);
  });

  it('preserves pointer pan, zoom, link editing, minimap, rename, and delete paths', () => {
    expect(flowSource).toMatch(/addEventListener\(\s*['"]wheel['"]/);
    expect(flowSource).toMatch(/addEventListener\(\s*['"]pointerdown['"]/);
    expect(flowSource).toMatch(/addEventListener\(\s*['"]pointermove['"]/);
    expect(flowSource).toMatch(/addEventListener\(\s*['"]pointerup['"]/);
    expect(flowSource).toMatch(/buildMinimap\(/);
    expect(flowSource).toMatch(/setAttribute\(\s*['"]viewBox['"]/);
    expect(flowSource).toMatch(/setAttribute\(\s*['"]preserveAspectRatio['"]\s*,\s*['"]none['"]\s*\)/);
    expect(flowSource).toMatch(/createLink\(/);
    expect(flowSource).toMatch(/renameScene\(/);
    expect(flowSource).toMatch(/deleteScene\(/);
    expect(flowSource).toMatch(/svg\.addEventListener\(\s*['"]pointerdown['"][\s\S]{0,180}?button\s*!==\s*0/);
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape']) {
      expect(flowSource).toContain(`'${key}'`);
    }
    expect(flowSource).toMatch(/closeSceneMenu\(\s*true\s*\)/);
    expect(flowSource).toMatch(/truncateTextToWidth\(/);
  });

  it('reserves a full slot for host entries instead of overlapping the previous scene lane', () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 's:alpha', kind: 'scene', sceneId: 'alpha' },
        { id: 'l:alpha.end', kind: 'label', sceneId: 'alpha', label: 'end', line: 8 },
        { id: 's:beta', kind: 'scene', sceneId: 'beta' },
        { id: 'h:beta', kind: 'host-entry', sceneId: 'beta' },
      ],
      edges: [],
    };

    const layout = layoutFlowGraph(graph, 'alpha');
    const previousLane = layout.boxes.get('l:alpha.end')!;
    const hostEntry = layout.boxes.get('h:beta')!;
    const targetScene = layout.boxes.get('s:beta')!;

    expect(previousLane.y + previousLane.h).toBeLessThan(hostEntry.y);
    expect(hostEntry.y + hostEntry.h).toBeLessThan(targetScene.y);
  });

  it('maps a CSS-compressed minimap point through the rendered and intrinsic dimensions', () => {
    const point = minimapClientToWorld(76, 58, {
      left: 10,
      top: 10,
      renderedWidth: 132,
      renderedHeight: 96,
      intrinsicWidth: 180,
      intrinsicHeight: 140,
      worldScale: 0.2,
      worldPadding: 40,
    });

    // 目标点位于压缩后小地图正中央；分别按真实的横纵压缩比恢复到 SVG 中心。
    expect(point.x).toBe(410);
    expect(point.y).toBe(310);
  });
});
