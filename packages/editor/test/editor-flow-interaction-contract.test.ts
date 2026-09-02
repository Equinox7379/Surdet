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

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = flowSource.indexOf(startMarker);
  if (start < 0) return '';
  const end = flowSource.indexOf(endMarker, start + startMarker.length);
  return end < 0 ? flowSource.slice(start) : flowSource.slice(start, end);
}

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
    expect(flowSource).toMatch(/buildNarrativeFlowLayout\(/);
    expect(flowSource).toMatch(/layout\.nodePresentation\.get\(/);
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
    const fitHelper = flowSource.match(/const fitLayoutToViewport\s*=\s*\([\s\S]*?\n\s*};/)?.[0] ?? '';
    expect(fitHelper).toMatch(/availableWidth\s*\/\s*contentWidth/);
    expect(fitHelper).toMatch(/availableHeight\s*\/\s*contentHeight/);
    expect(fitHandler).toMatch(/currentViewportSize\(\)/);
    expect(fitHandler).toMatch(/fitLayoutToViewport\(\s*viewport\s*\)/);
    expect(fitHandler).not.toMatch(/Math\.max\(\s*0\.2/);
  });

  it('keeps independent focus, overview, and technical transforms when switching modes', () => {
    expect(flowSource).toMatch(/const\s+flowViews\s*:\s*Record<FlowViewKey[\s\S]{0,260}?focus\s*:\s*\{[\s\S]{0,160}?overview\s*:\s*\{[\s\S]{0,160}?technical\s*:\s*\{/);

    const switchHandler = flowSource.match(/const\s+switchViewMode\s*=\s*\([\s\S]*?\n\s*};/)?.[0] ?? '';
    expect(switchHandler).toMatch(/flowViewMode\s*=\s*nextMode/);
    expect(switchHandler).toMatch(/view\s*=\s*flowViews\[nextMode\]/);
    expect(switchHandler).toMatch(/pendingAutoFit\s*=\s*true/);
    expect(switchHandler).toMatch(/rerenderFlow\(\s*container\s*,\s*focusSelector\s*\)/);
    expect(flowSource).toMatch(/focusView\.onclick\s*=\s*\(\)\s*=>\s*switchViewMode\(\s*['"]focus['"]\s*,\s*['"]\[data-flow-action="view-focus"\]['"]\s*\)/);
    expect(flowSource).toMatch(/overviewView\.onclick\s*=\s*\(\)\s*=>\s*switchViewMode\(\s*['"]overview['"]\s*,\s*['"]\[data-flow-action="view-overview"\]['"]\s*\)/);
  });

  it('renders compact return markers as navigation, not editable graph nodes', () => {
    const returnMarkerBlock = sourceBetween('function drawReturnMarkers(', 'function drawNode(');
    expect(returnMarkerBlock).toMatch(/data-flow-return-target/);
    expect(returnMarkerBlock).not.toMatch(/data-node-id|dataset\.nodeId/);
    expect(returnMarkerBlock).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]link['"]\s*\)/);
    expect(returnMarkerBlock).toMatch(/setAttribute\(\s*['"]tabindex['"]\s*,\s*['"]0['"]\s*\)/);
    expect(returnMarkerBlock).toMatch(/event\.key\s*!==\s*['"]Enter['"]\s*&&\s*event\.key\s*!==\s*['"] ['"]/);
    expect(returnMarkerBlock).toMatch(/const\s+key\s*=\s*resolveSceneKeyForOperation\(marker\.targetSceneId\)/);
    expect(returnMarkerBlock).toMatch(/openSceneHook\(key\)/);
    expect(returnMarkerBlock).toMatch(/addEventListener\(\s*['"]click['"]\s*,\s*openTarget\s*\)/);
    expect(returnMarkerBlock).toMatch(/event\.preventDefault\(\)[\s\S]{0,120}?openTarget\(\)/);
  });

  it('rebuilds the technical projection and returns to the prior readable mode', () => {
    expect(flowSource).toMatch(/layoutFlowGraph\(graph[\s\S]{0,220}?mode\s*:\s*flowViewMode[\s\S]{0,120}?technical\s*:\s*technicalEdgesVisible/);

    const technicalHandler = flowSource.match(/toggleTechnical\.onclick\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\n\s*};/)?.[0] ?? '';
    expect(technicalHandler).toMatch(/technicalEdgesVisible\s*=\s*!technicalEdgesVisible/);
    expect(technicalHandler).toMatch(/view\s*=\s*technicalEdgesVisible\s*\?\s*flowViews\.technical\s*:\s*flowViews\[flowViewMode\]/);
    expect(technicalHandler).toMatch(/pendingAutoFit\s*=\s*true/);
    expect(technicalHandler).toMatch(/rerenderFlow\(\s*container\s*,\s*['"]\[data-flow-action="toggle-technical-edges"\]['"]\s*\)/);
  });

  it('fits and maps the minimap from the current layout projection', () => {
    const minimapBlock = sourceBetween('function buildMinimap(', 'function drawRoute(');
    expect(minimapBlock).toMatch(/const\s+activeBounds\s*=\s*technicalEdgesVisible\s*\?\s*layout\.bounds\s*:\s*layout\.visibleBounds/);
    expect(minimapBlock).toMatch(/for\s*\(const\s+b\s+of\s+layout\.boxes\.values\(\)\)/);

    const fitHelper = flowSource.match(/const\s+fitLayoutToViewport\s*=\s*\([\s\S]*?\n\s*};/)?.[0] ?? '';
    expect(fitHelper).toMatch(/technicalEdgesVisible\s*\?\s*layout\.bounds\s*:\s*layout\.visibleBounds/);
    expect(flowSource).toMatch(/buildMinimap\(\s*layout\s*,\s*cw\s*,\s*ch\s*,\s*container\s*\)/);
  });

  it('preserves pointer pan, zoom, link editing, minimap, rename, and delete paths', () => {
    expect(flowSource).toMatch(/addEventListener\(\s*['"]wheel['"]/);
    expect(flowSource).toMatch(/addEventListener\(\s*['"]pointerdown['"]/);
    expect(flowSource).toMatch(/addEventListener\(\s*['"]pointermove['"]/);
    expect(flowSource).toMatch(/addEventListener\(\s*['"]pointerup['"]/);
    expect(flowSource).toMatch(/buildMinimap\(/);
    expect(flowSource).toMatch(/mm\.addEventListener\(\s*['"]click['"]/);
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

    const negativeOriginPoint = minimapClientToWorld(76, 58, {
      left: 10,
      top: 10,
      renderedWidth: 132,
      renderedHeight: 96,
      intrinsicWidth: 180,
      intrinsicHeight: 140,
      worldScale: 0.2,
      worldPadding: 40,
      worldMinX: -120,
      worldMinY: -60,
    });
    expect(negativeOriginPoint.x).toBe(290);
    expect(negativeOriginPoint.y).toBe(250);
  });
});
