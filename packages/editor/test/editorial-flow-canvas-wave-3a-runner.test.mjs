import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_PORTS,
  MILESTONE_IDS,
  VIEWPORTS,
} from '../e2e/editorial-flow-canvas-wave-3a.e2e.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.resolve(testDirectory, '../e2e/editorial-flow-canvas-wave-3a.e2e.mjs');
const source = fs.readFileSync(runnerPath, 'utf8');

describe('Wave 3A browser runner contract', () => {
  it('reserves the neighbouring and manual-preview ports while covering every required geometry', () => {
    expect(FORBIDDEN_PORTS).toEqual([4173, 4175]);
    expect(VIEWPORTS).toEqual([
      { id: '1920', width: 1920, height: 1080 },
      { id: '1440', width: 1440, height: 900 },
      { id: '1280', width: 1280, height: 720 },
      { id: '1024', width: 1024, height: 768 },
      { id: '800', width: 800, height: 900 },
    ]);
    expect(source).toContain("for (let port = 4211; port <= 4250; port += 1)");
    expect(source).toContain("'Emulation.setPageScaleFactor'");
    expect(source).toContain('pageScaleFactor: 2');
    expect(source).toContain('window.visualViewport?.scale');
    expect(source).toContain('devicePixelRatioBefore');
    expect(source).toContain('devicePixelRatioAfter');
    expect(source).not.toContain('Emulation.setDeviceMetricsOverride');
    expect(source).not.toContain('deviceScaleFactor: 2');
    expect(source).not.toContain('page.waitForTimeout(');
  });

  it('freezes the complete fail-closed milestone sequence', () => {
    expect(MILESTONE_IDS).toEqual([
      'strict-isolated-port-selected',
      'isolated-vite-ready',
      'real-starter-opened-through-picker',
      'flow-workbench-single-truth',
      'semantic-regions-and-real-facts',
      'real-node-edge-content',
      'text-label-geometry-safe',
      'layout-1920',
      'layout-1440',
      'layout-1280',
      'layout-1024',
      'layout-800',
      'page-scale-command-reachability',
      'viewport-controls-use-existing-view',
      'toolbar-keyboard-focus-stable',
      'legend-geometry-recomputed',
      'pointer-and-keyboard-navigation',
      'pan-and-minimap-navigation',
      'context-menu-pointer-stable',
      'context-menu-keyboard-complete',
      'drag-link-and-undo',
      'fake-project-remains-byte-identical',
      'browser-error-channels-empty',
      'isolated-process-cleanup',
    ]);
    expect(source).toContain('missing required milestones');
    expect(source).toContain("evidenceClass: 'EDITOR_FLOW_CANVAS_BROWSER_DIAGNOSTIC'");
    expect(source).toContain("fs.openSync(file, 'wx')");
  });

  it('uses the frozen semantic regions and real graph identities', () => {
    for (const region of ['flow-workbench', 'flow-status', 'flow-toolbar', 'flow-canvas', 'flow-legend', 'flow-minimap']) {
      expect(source).toContain(`data-editor-region="${region}"`);
    }
    for (const action of ['zoom-out', 'zoom-in', 'fit-canvas', 'focus-current', 'toggle-legend']) {
      expect(source).toContain(`data-flow-action="${action}"`);
    }
    expect(source).toContain('[data-flow-world]');
    expect(source).toContain('[data-flow-node-kind]');
    expect(source).toContain('[data-flow-edge-kind]');
    expect(source).toContain('s:ch01_01');
    expect(source).toContain('l:ch01_01.answer_silence');
    expect(source).toContain('l:ch01_02.start');
    expect(source).toContain('hasSword');
    expect(source).toContain("facts.nodeKinds.scene === 4");
    expect(source).toContain("facts.nodeKinds.label === 6");
    expect(source).toContain("facts.choiceCount === 3");
  });

  it('proves the existing navigation, viewport, context-menu and edit paths rather than decorative controls', () => {
    expect(source).toContain("keyboardOpenFlowNode(page, 'l:ch01_01.answer_silence', 'Enter')");
    expect(source).toContain("keyboardOpenFlowNode(page, 'l:ch01_02.start', 'Space')");
    expect(source).toContain("page.locator('[data-flow-action=\"fit-canvas\"]')");
    expect(source).toContain("page.locator('[data-flow-action=\"focus-current\"]')");
    expect(source).toContain("page.locator('[data-editor-region=\"flow-minimap\"]')");
    expect(source).toContain("page.locator('[data-editor-region=\"flow-minimap\"] .flow-minimap-viewport')");
    expect(source).toContain('minimapViewportCenterDistance <= 4');
    expect(source).toContain('minimapClickRelative = { x: 0.72, y: 0.32 }');
    expect(source).toContain("page.locator('[role=\"menu\"]')");
    expect(source).toContain("page.keyboard.press('Shift+F10')");
    for (const key of ['ArrowDown', 'ArrowUp', 'End', 'Home']) expect(source).toContain(`'${key}'`);
    expect(source).toContain("returnedFocusNodeId === 's:ch01_02'");
    expect(source).toContain('movementCssPixels: { x: 4, y: 3 }');
    expect(source).toContain("document.activeElement?.getAttribute('data-flow-action') === 'zoom-in'");
    expect(source).toContain('__wave3aLegendGeometryRefs');
    expect(source).toContain('oldCanvasConnected === false');
    expect(source).toContain('oldMinimapConnected === false');
    expect(source).toContain("const expectedJump = '@jump ch01_01.start'");
    expect(source).toContain('window.surdetEditorDebug.state.current === sceneId');
    expect(source).toContain("page.locator('[data-action=\"undo\"]')");
    expect(source).toContain("afterUndo === beforeLink");
    expect(source).toContain('新增剧情跳转');
  });

  it('proves page-scale command reachability through real visual geometry and activation', () => {
    expect(source).toContain('scrollFlowCommandsIntoVisualViewport(page)');
    expect(source).toContain("firstCommand.scrollIntoView({ block: 'center', inline: 'start', behavior: 'instant' })");
    expect(source).toContain("lastCommand.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })");
    expect(source).not.toContain('toolbar.scrollIntoView');
    expect(source).toContain('inspectPageScaleCommandGeometry(page)');
    expect(source).toContain('visualBoundsInLayout');
    expect(source).toContain('commandBoxes.every((command) => command.horizontallyVisible)');
    expect(source).toContain('commandBoxes.every((command) => command.verticallyVisible)');
    expect(source).toContain("document.activeElement?.getAttribute('data-flow-action') === 'fit-canvas'");
    expect(source).toContain('fit-canvas was not actually activated at page scale 2');
    expect(source).toContain("'flow-page-scale-command-reachability'");
    expect(source).not.toContain('commandsReachable');
    expect(source).not.toContain('browser-zoom');
  });

  it('measures real text, edge-label and fit geometry instead of trusting CSS declarations', () => {
    expect(source).toContain('inspectTextGeometry(page)');
    expect(source).toContain('longestChineseNode');
    expect(source).toContain('longestChineseEdge');
    expect(source).toContain("label.textPointerEvents === 'none'");
    expect(source).toContain("label.surfacePointerEvents === 'none'");
    expect(source).toContain('fit rendered ${layout.nodeRects.length}/${expectedNodeCount} nodes');
    expect(source).toContain('fit leaves ${left.id} left of canvas');
    expect(source).toContain('fit leaves ${left.id} right of canvas');
    expect(source).toContain('fit leaves ${left.id} above canvas');
    expect(source).toContain('fit leaves ${left.id} below canvas');
  });

  it('keeps real Starter identity and every browser/process error channel in the artifact', () => {
    expect(source).toContain("path.join(repoRoot, 'examples', 'starter')");
    expect(source).toContain('fileMapForDirectory(starterRoot)');
    expect(source).toContain('fakeFileSystemInit');
    expect(source).toContain('browserFileMapTreeIdentity');
    expect(source).toContain('originalStarterUnchanged');
    expect(source).toContain('portReleased');
    for (const channel of ['errors', 'consoleErrors', 'pageErrors', 'requestFailures', 'stderrLines', 'childCleanupFailures']) {
      expect(source).toContain(channel);
    }
    expect(source).toContain('strict port remained occupied');
  });
});
