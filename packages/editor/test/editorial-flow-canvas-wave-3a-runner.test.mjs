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
      'focus-projection-bounded',
      'focus-route-bundle-readable',
      'overview-scene-map-readable',
      'technical-connections-on-demand',
      'mode-switch-focus-stable',
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
    expect(source).toContain("path.join(artifactDirectory, 'identity.json')");
    expect(source).toContain('identity,');
  });

  it('uses the frozen semantic regions and real graph identities', () => {
    for (const region of ['flow-workbench', 'flow-status', 'flow-toolbar', 'flow-canvas', 'flow-legend', 'flow-minimap']) {
      expect(source).toContain(`data-editor-region="${region}"`);
    }
    for (const action of ['view-focus', 'view-overview', 'zoom-out', 'zoom-in', 'fit-canvas', 'focus-current', 'toggle-legend']) {
      expect(source).toContain(`data-flow-action="${action}"`);
    }
    expect(source).toContain('[data-flow-world]');
    expect(source).toContain('[data-flow-node-kind]');
    expect(source).toContain('[data-flow-edge-kind]');
    expect(source).toContain('s:ch01_01');
    expect(source).toContain('l:ch01_01.answer_silence');
    expect(source).toContain('l:ch01_02.start');
    expect(source).toContain('humanConditionPresent');
    expect(source).toContain('有条件');
    expect(source).toContain("facts.nodeKinds.scene === 2");
    expect(source).toContain("facts.choiceCount === 0");
    expect(source).toContain("facts.statusChoiceCount === 3");
  });

  it('proves the writer-facing narrative map instead of the compiler-shaped graph', () => {
    for (const milestone of [
      'focus-projection-bounded',
      'focus-route-bundle-readable',
      'overview-scene-map-readable',
      'technical-connections-on-demand',
      'mode-switch-focus-stable',
    ]) {
      expect(MILESTONE_IDS).toContain(milestone);
    }
    expect(source).toContain('inspectNarrativeMap(page)');
    expect(source).toContain('[data-flow-scene-frame][data-scene-id][data-flow-component]');
    expect(source).toContain('[data-flow-component-heading="main"]');
    expect(source).toContain('[data-flow-action="view-focus"]');
    expect(source).toContain('[data-flow-action="view-overview"]');
    expect(source).toContain('[data-flow-route="orthogonal"]');
    expect(source).toContain('[data-flow-route-label]');
    expect(source).toContain('[data-flow-action="toggle-technical-edges"]');
    expect(source).toContain('path.includes(\'C\') === false');
    expect(source).toContain("'选择“沉默”后'");
    expect(source).toContain("'选择“拔出剑”后'");
    expect(source).toContain("'选择“转身离开”后'");
    expect(source).toContain("'当前聚焦路径'");
    expect(source).toContain("'全局场景概览'");
    expect(source).toContain("'其他入口'");
    expect(source).toContain("['@label', '[if:', 'host-entry', 'answer_']");
    expect(source).toContain('scene frame does not contain');
    expect(source).toContain('scene frames overlap');
    expect(source).toContain("focus scene projection is not ch01_01 + ch01_02");
    expect(source).toContain('focused scene is not expanded while its neighbour stays compact');
    expect(source).toContain('default focus projection rendered a choice route');
    expect(source).toContain("route.kind === 'jump' && route.to === 'l:ch01_02.start'");
    expect(source).toContain('three jumps do not share one terminal trunk');
    expect(source).not.toContain("route.kind === 'jump' && route.to === 's:ch01_02'");
    expect(source).toContain('overview is not a four-scene projection');
    expect(source).toContain("overview return marker is not ↩ 返回 ch01_01");
    expect(source).toContain('overview rendered the long ch02 → ch01_01 return route');
    expect(source).toContain('technical route toggle did not reveal more real routes');
    expect(source).not.toContain('const unprojectableRawEdgeCount = flowFacts.statusEdgeCount - revealedRouteCount');
    expect(source).toContain('technicalMap.unprojectableExplanation');
    expect(source).toContain('technicalMap.unprojectableExplanationVisible');
    expect(source).toContain("'另有 2 条连接因端点缺失未显示'");
    expect(source).toContain('const unprojectableRawEdgeCount = Number(unprojectableMatch[1])');
    expect(source).toContain('const projectableNarrativeRouteCount = flowFacts.statusEdgeCount - unprojectableRawEdgeCount');
    expect(source).toContain('expected 2 raw Starter connections with missing endpoints');
    expect(source).toContain("mode switch did not retain keyboard focus on view-focus");
    expect(source).toContain("'flow-global-overview'");
    expect(source).toContain("'flow-technical-connections'");
    expect(source).not.toContain('revealedRouteCount === flowFacts.statusEdgeCount');
  });

  it('proves the existing navigation, viewport, context-menu and edit paths rather than decorative controls', () => {
    expect(source).toContain("await enableTechnicalConnections(page)");
    expect(source).toContain("keyboardOpenFlowNode(page, 'l:ch01_01.answer_silence', 'Enter')");
    expect(source).toContain("keyboardOpenFlowNode(page, 'l:ch01_02.start', 'Space')");
    expect(source).toContain("page.locator('[data-flow-action=\"fit-canvas\"]')");
    expect(source).toContain("page.locator('[data-flow-action=\"focus-current\"]')");
    expect(source).toContain("page.locator('[data-editor-region=\"flow-minimap\"]')");
    expect(source).toContain("page.locator('[data-editor-region=\"flow-minimap\"] .flow-minimap-viewport')");
    expect(source).toContain('minimapViewportCenterDistance <= 4');
    expect(source).toContain('const minimapClickCandidates = [');
    expect(source).toContain('{ x: 0.18, y: 0.22 }');
    expect(source).toContain('{ x: 0.82, y: 0.78 }');
    expect(source).toContain('beforeViewportCenterRelative');
    expect(source).toContain('minimapTargetDistance >= 0.4');
    expect(source).toContain('minimapTargetDistance,');
    expect(source).not.toContain('minimapClickRelative = { x: 0.72, y: 0.32 }');
    expect(source).toContain("page.locator('[role=\"menu\"]')");
    expect(source).toContain("page.keyboard.press('Shift+F10')");
    for (const key of ['ArrowDown', 'ArrowUp', 'End', 'Home']) expect(source).toContain(`'${key}'`);
    expect(source).toContain("returnedFocusNodeId === 's:ch01_02'");
    expect(source).toContain('movementCssPixels: { x: 4, y: 3 }');
    expect(source).toContain("document.activeElement?.getAttribute('data-flow-action') === 'zoom-in'");
    expect(source).toContain('await setLegendExpanded(page, true)');
    expect(source).toContain('assertLegendGeometrySnapshot(legendCollapsed, true');
    expect(source).toContain('assertLegendGeometrySnapshot(legendExpandedGeometry, false');
    expect(source).not.toContain('__wave3aLegendGeometryRefs');
    expect(source).not.toContain('oldCanvasConnected');
    expect(source).not.toContain('oldMinimapConnected');
    expect(source).toContain("const expectedJump = '@jump ch01_01.start'");
    expect(source).toContain('window.surdetEditorDebug.state.current === sceneId');
    expect(source).toContain("page.locator('[data-action=\"undo\"]')");
    expect(source).toContain("afterUndo === beforeLink");
    expect(source).toContain('新增剧情跳转');
  });

  it('proves page-scale command reachability through real visual geometry and activation', () => {
    expect(source).toContain('verifyPageScaleCommandsIndividually(page)');
    expect(source).toContain("command.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })");
    expect(source).not.toContain('toolbar.scrollIntoView');
    expect(source).toContain('inspectPageScaleCommandGeometry(page)');
    expect(source).toContain('visualBoundsInLayout');
    expect(source).not.toContain('commandBoxes.every((command) => command.horizontallyVisible)');
    expect(source).not.toContain('commandBoxes.every((command) => command.verticallyVisible)');
    expect(source).toContain('command.before.horizontallyVisible && command.before.verticallyVisible');
    expect(source).toContain('command.focusedAction === action');
    expect(source).toContain('command.activatedAction === action');
    expect(source).toContain('const requiredActions = new Set([');
    expect(source).toContain("'view-focus', 'view-overview', 'zoom-out', 'zoom-in', 'fit-canvas', 'focus-current', 'toggle-legend'");
    expect(source).toContain('[...requiredActions].every((action) => evidence.some((command) => command.action === action))');
    expect(source).not.toContain('evidence.commandBoxes.length === 5');
    expect(source).toContain("document.activeElement?.getAttribute('data-flow-action') === 'fit-canvas'");
    expect(source).toContain('fit-canvas was not actually activated at page scale 2');
    expect(source).toContain('perCommandReachability');
    expect(source).toContain("'flow-page-scale-command-reachability'");
    expect(source).not.toContain('commandsReachable');
    expect(source).not.toContain('browser-zoom');
  });

  it('toggles the legend through a viewport-safe keyboard path at every page scale', () => {
    const helper = source.slice(
      source.indexOf('async function setLegendExpanded(page, expanded)'),
      source.indexOf('async function switchFlowView(page, action)'),
    );
    expect(helper).toContain("await scrollFlowCommandIntoVisualViewport(page, 'toggle-legend')");
    expect(helper).toContain('await toggle.focus()');
    expect(helper).toContain("await page.keyboard.press('Enter')");
    expect(helper).toContain("document.activeElement?.getAttribute('data-flow-action') === 'toggle-legend'");
    expect(helper).toContain("document.querySelector('[data-editor-region=\"flow-legend\"]')?.hasAttribute('hidden') === !shouldExpand");
    expect(helper).not.toContain('.click()');
  });

  it('measures real narrative text, attached route chips and fit geometry instead of trusting CSS declarations', () => {
    expect(source).toContain('inspectTextGeometry(page)');
    expect(source).toContain('longestChineseNode');
    expect(source).toContain('longestChineseRouteChip');
    expect(source).toContain("document.querySelectorAll('[data-flow-route=\"orthogonal\"][data-flow-label]')");
    expect(source).toContain('evidence.routeChips.length === evidence.labeledVisibleRouteCount');
    expect(source).toContain('if (evidence.routeChips.length === 0) return');
    expect(source).toContain('evidence.routeChipOverlaps.length === 0');
    expect(source).not.toContain("assert(evidence.routeChips.length > 0, 'cross-scene routes expose no attached label geometry')");
    expect(source).toContain("label.textPointerEvents === 'none'");
    expect(source).toContain("label.surfacePointerEvents === 'none'");
    expect(source).toContain('fit rendered ${layout.nodeRects.length}/${expectation.nodeCount} nodes');
    expect(source).toContain('fit leaves ${left.id} left of canvas');
    expect(source).toContain('fit leaves ${left.id} right of canvas');
    expect(source).toContain('fit leaves ${left.id} above canvas');
    expect(source).toContain('fit leaves ${left.id} below canvas');
  });

  it('captures each responsive layout in the product default collapsed-legend state', () => {
    expect(source).toContain("await switchFlowView(page, 'view-focus')");
    expect(source).toContain('await setLegendExpanded(page, false)');
    expect(source).toContain("const legendMode = 'default-collapsed'");
    expect(source).not.toContain('const legendMode = await ensureLegendReachable(page)');
    expect(source).not.toContain('const pageScaleLegendMode = await ensureLegendReachable(page)');
    const responsiveLoop = source.slice(
      source.indexOf('for (const viewport of VIEWPORTS)'),
      source.indexOf('await page.setViewportSize({ width: 800, height: 500 })'),
    );
    expect(responsiveLoop.indexOf('await setLegendExpanded(page, false)')).toBeGreaterThanOrEqual(0);
    expect(responsiveLoop.indexOf('await setLegendExpanded(page, false)')).toBeLessThan(responsiveLoop.indexOf('await takeScreenshot('));
    const pageScaleBlock = source.slice(
      source.indexOf('await page.setViewportSize({ width: 800, height: 500 })'),
      source.indexOf("await takeScreenshot(page, artifactDirectory, 'flow-page-scale-command-reachability'"),
    );
    expect(pageScaleBlock.indexOf('await setLegendExpanded(page, false)')).toBeGreaterThanOrEqual(0);
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
