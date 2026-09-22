import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  browserFileMapTreeIdentity,
  fakeFileSystemInit,
  fileMapForDirectory,
  hashProjectTree,
} from './support/fake-file-system.mjs';

const runnerPath = fileURLToPath(import.meta.url);
const editorRoot = path.resolve(path.dirname(runnerPath), '..');
const repoRoot = path.resolve(editorRoot, '..', '..');
const starterRoot = path.join(repoRoot, 'examples', 'starter');

export const FORBIDDEN_PORTS = Object.freeze([4173, 4175]);
const forbiddenPorts = new Set(FORBIDDEN_PORTS);

export const VIEWPORTS = Object.freeze([
  { id: '1920', width: 1920, height: 1080 },
  { id: '1440', width: 1440, height: 900 },
  { id: '1280', width: 1280, height: 720 },
  { id: '1024', width: 1024, height: 768 },
  { id: '800', width: 800, height: 900 },
]);

export const MILESTONE_IDS = Object.freeze([
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

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorText(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function readFileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return {
    path: path.resolve(file),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function writeExclusiveJson(file, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const descriptor = fs.openSync(file, 'wx');
  try {
    fs.writeSync(descriptor, bytes, 0, bytes.byteLength, 0);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  return readFileIdentity(file);
}

async function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function chooseStrictPort() {
  for (let port = 4211; port <= 4250; port += 1) {
    if (forbiddenPorts.has(port)) continue;
    if (await portIsAvailable(port)) return port;
  }
  throw new Error('no strict Wave 3A browser port available in 4211..4250');
}

async function waitForServer(child, url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited before readiness (${child.exitCode})`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite has not published its listener yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite readiness timeout: ${url}`);
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function stopServer(child, cleanupFailures) {
  if (!child) return;
  const pid = child.pid;
  if (child.exitCode === null) {
    try {
      child.kill('SIGTERM');
    } catch (error) {
      cleanupFailures.push(`SIGTERM ${pid}: ${errorText(error)}`);
    }
  }
  if (await waitForExit(child)) return;
  if (process.platform === 'win32' && Number.isInteger(pid)) {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    await waitForExit(killer, 5_000);
  } else if (child.exitCode === null) {
    try {
      child.kill('SIGKILL');
    } catch (error) {
      cleanupFailures.push(`SIGKILL ${pid}: ${errorText(error)}`);
    }
  }
  if (!(await waitForExit(child))) cleanupFailures.push(`Vite child remained alive: ${pid}`);
}

function rectanglesOverlap(left, right, tolerance = 0.5) {
  return left.left < right.right - tolerance
    && left.right > right.left + tolerance
    && left.top < right.bottom - tolerance
    && left.bottom > right.top + tolerance;
}

function parseWorldTransform(value) {
  const match = /^translate\(([-\d.]+)[ ,]([-\d.]+)\) scale\(([-\d.]+)\)$/.exec(value ?? '');
  assert(match, `unexpected flow world transform: ${String(value)}`);
  return { tx: Number(match[1]), ty: Number(match[2]), scale: Number(match[3]) };
}

function transformChanged(before, after) {
  return Math.abs(before.tx - after.tx) > 0.5
    || Math.abs(before.ty - after.ty) > 0.5
    || Math.abs(before.scale - after.scale) > 0.001;
}

async function worldTransform(page) {
  const value = await page.locator('[data-flow-world]').getAttribute('transform');
  return parseWorldTransform(value);
}

async function takeScreenshot(page, artifactDirectory, name, screenshots) {
  const file = path.join(artifactDirectory, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  screenshots.push(readFileIdentity(file));
}

async function openRealStarter(page) {
  await page.locator('[data-action="open-project"]').waitFor({ state: 'visible' });
  await page.locator('[data-action="open-project"]').click();
  await page.locator('.manuscript-sheet[data-scene-id="ch01_01"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.surdetEditorDebug?.state?.authoringIndex !== null);
  return page.evaluate(() => ({
    projectName: document.querySelector('.editor-project-name')?.textContent ?? null,
    sceneCount: window.surdetEditorDebug?.state?.scenes?.size ?? null,
    current: window.surdetEditorDebug?.state?.current ?? null,
    timelineCount: window.surdetEditorDebug?.state?.timelines?.length ?? null,
    assetCount: window.surdetEditorDebug?.state?.dirAssets?.length ?? null,
  }));
}

async function enterFlowMode(page) {
  await page.locator('[data-editor-mode="flow"]').click();
  await page.locator('[data-editor-region="flow-workbench"]').waitFor({ state: 'visible' });
  await page.locator('[data-flow-node-kind][data-node-id]').first().waitFor({ state: 'visible' });
}

async function ensureLegendReachable(page) {
  const legend = page.locator('[data-editor-region="flow-legend"]');
  if (await legend.isVisible()) return 'visible';
  const toggle = page.locator('[data-flow-action="toggle-legend"]');
  assert(await toggle.isVisible(), 'collapsed flow legend has no reachable disclosure command');
  await toggle.click();
  await legend.waitFor({ state: 'visible' });
  return 'opened-through-disclosure';
}

async function setLegendExpanded(page, expanded) {
  const legend = page.locator('[data-editor-region="flow-legend"]');
  const currentlyExpanded = await legend.evaluate((element) => !element.hasAttribute('hidden'));
  if (currentlyExpanded !== expanded) {
    await scrollFlowCommandIntoVisualViewport(page, 'toggle-legend');
    const toggle = page.locator('[data-flow-action="toggle-legend"]');
    await toggle.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (shouldExpand) => document.querySelector('[data-editor-region="flow-legend"]')?.hasAttribute('hidden') === !shouldExpand,
      expanded,
    );
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('data-flow-action') === 'toggle-legend',
    );
  }
  return expanded ? 'expanded' : 'default-collapsed';
}

async function switchFlowView(page, action) {
  const selector = `[data-flow-action="${action}"]`;
  const button = page.locator(selector);
  await button.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (expectedAction) => document.querySelector(`[data-flow-action="${expectedAction}"]`)?.getAttribute('aria-pressed') === 'true',
    action,
  );
  await page.waitForFunction(
    (expectedAction) => document.activeElement?.getAttribute('data-flow-action') === expectedAction,
    action,
  );
  return {
    action,
    activeAction: await page.evaluate(() => document.activeElement?.getAttribute('data-flow-action') ?? null),
    transform: await worldTransform(page),
  };
}

async function enableTechnicalConnections(page) {
  await ensureLegendReachable(page);
  const toggle = page.locator('[data-flow-action="toggle-technical-edges"]');
  if (!(await toggle.isVisible())) {
    await page.locator('details.flow-technical > summary').click();
    await toggle.waitFor({ state: 'visible' });
  }
  if (await toggle.getAttribute('aria-pressed') !== 'true') {
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[data-flow-action="toggle-technical-edges"]')?.getAttribute('aria-pressed') === 'true');
  }
  return inspectNarrativeMap(page);
}

async function inspectFlowLayout(page) {
  return page.evaluate(() => {
    const inspect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        selector,
        display: style.display,
        position: style.position,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        visible: style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const nodeRects = [...document.querySelectorAll('[data-flow-node-kind]')].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.getAttribute('data-node-id'),
        kind: node.getAttribute('data-flow-node-kind'),
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
    const commandRects = [...document.querySelectorAll('[data-editor-region="flow-toolbar"] [data-flow-action]')].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        action: button.getAttribute('data-flow-action'),
        disabled: button.hasAttribute('disabled'),
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    });
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        visualScale: window.visualViewport?.scale ?? 1,
        visualWidth: window.visualViewport?.width ?? window.innerWidth,
        visualHeight: window.visualViewport?.height ?? window.innerHeight,
      },
      pageWidth: {
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      },
      workbench: inspect('[data-editor-region="flow-workbench"]'),
      status: inspect('[data-editor-region="flow-status"]'),
      toolbar: inspect('[data-editor-region="flow-toolbar"]'),
      canvas: inspect('[data-editor-region="flow-canvas"]'),
      legend: inspect('[data-editor-region="flow-legend"]'),
      minimap: inspect('[data-editor-region="flow-minimap"]'),
      svg: inspect('[data-editor-region="flow-canvas"] .flow-canvas-svg'),
      menu: inspect('[role="menu"]'),
      nodeRects,
      frameCount: document.querySelectorAll('[data-flow-scene-frame][data-scene-id]').length,
      frameSceneIds: [...document.querySelectorAll('[data-flow-scene-frame][data-scene-id]')]
        .map((frame) => frame.getAttribute('data-scene-id')),
      routeCount: document.querySelectorAll('[data-flow-route="orthogonal"]').length,
      activeViewAction: [...document.querySelectorAll('[data-flow-action="view-focus"], [data-flow-action="view-overview"]')]
        .find((button) => button.getAttribute('aria-pressed') === 'true')?.getAttribute('data-flow-action') ?? null,
      commandRects,
    };
  });
}

function assertFlowLayout(layout, expectedWidth, expectation) {
  assert(layout.viewport.width === expectedWidth, `viewport width ${layout.viewport.width} != ${expectedWidth}`);
  assert(layout.pageWidth.client === layout.pageWidth.scroll, `${expectedWidth}: horizontal page overflow`);
  for (const [name, region] of Object.entries({
    workbench: layout.workbench,
    status: layout.status,
    toolbar: layout.toolbar,
    canvas: layout.canvas,
    minimap: layout.minimap,
    svg: layout.svg,
  })) {
    assert(region?.visible, `${expectedWidth}: ${name} region is not visible`);
    assert(region.left >= -0.5 && region.right <= expectedWidth + 0.5, `${expectedWidth}: ${name} escapes horizontally`);
  }
  assert(layout.legend && layout.legend.visible === false, `${expectedWidth}: default legend is not collapsed`);
  assert(layout.canvas.height >= 260, `${expectedWidth}: flow canvas height ${layout.canvas.height} is not usable`);
  assert(layout.svg.width >= 360, `${expectedWidth}: flow svg width ${layout.svg.width} is not usable`);
  assert(layout.frameCount === expectation.frameCount, `${expectedWidth}: narrative map rendered ${layout.frameCount}/${expectation.frameCount} scene frames`);
  assert(layout.activeViewAction === expectation.activeViewAction, `${expectedWidth}: active view ${layout.activeViewAction} != ${expectation.activeViewAction}`);
  assert(layout.routeCount > 0, `${expectedWidth}: narrative map rendered no orthogonal routes`);
  assert(!rectanglesOverlap(layout.status, layout.canvas), `${expectedWidth}: status overlaps graph canvas`);
  assert(!rectanglesOverlap(layout.toolbar, layout.canvas), `${expectedWidth}: toolbar overlaps graph canvas`);
  const requiredCommands = ['zoom-out', 'zoom-in', 'fit-canvas', 'focus-current'];
  for (const action of requiredCommands) {
    const command = layout.commandRects.find((item) => item.action === action);
    assert(command, `${expectedWidth}: missing ${action} command`);
    assert(command.width > 0 && command.height > 0, `${expectedWidth}: ${action} command is unreachable`);
    assert(command.left >= -0.5 && command.right <= expectedWidth + 0.5, `${expectedWidth}: ${action} command escapes horizontally`);
  }
  assert(layout.nodeRects.length === expectation.nodeCount, `${expectedWidth}: fit rendered ${layout.nodeRects.length}/${expectation.nodeCount} nodes`);
  for (let index = 0; index < layout.nodeRects.length; index += 1) {
    const left = layout.nodeRects[index];
    if (left.width <= 0 || left.height <= 0) continue;
    assert(left.left >= layout.canvas.left - 1.5, `${expectedWidth}: fit leaves ${left.id} left of canvas`);
    assert(left.right <= layout.canvas.right + 1.5, `${expectedWidth}: fit leaves ${left.id} right of canvas`);
    assert(left.top >= layout.canvas.top - 1.5, `${expectedWidth}: fit leaves ${left.id} above canvas`);
    assert(left.bottom <= layout.canvas.bottom + 1.5, `${expectedWidth}: fit leaves ${left.id} below canvas`);
    for (let peer = index + 1; peer < layout.nodeRects.length; peer += 1) {
      const right = layout.nodeRects[peer];
      if (right.width <= 0 || right.height <= 0) continue;
      assert(!rectanglesOverlap(left, right, 1), `${expectedWidth}: flow nodes ${left.id} and ${right.id} overlap`);
    }
  }
}

async function inspectTextGeometry(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const contains = (surface, text) => text.left >= surface.left - 1.5
      && text.right <= surface.right + 1.5
      && text.top >= surface.top - 1.5
      && text.bottom <= surface.bottom + 1.5;
    const overlaps = (left, right, tolerance = 0.5) => left.left < right.right - tolerance
      && left.right > right.left + tolerance
      && left.top < right.bottom - tolerance
      && left.bottom > right.top + tolerance;
    const nodes = [...document.querySelectorAll('[data-flow-node-kind]')].map((node) => {
      const surfaceElement = node.querySelector('.flow-node-surface');
      const surface = surfaceElement ? rect(surfaceElement) : null;
      const labels = [...node.querySelectorAll('.flow-node-primary, .flow-node-meta')].map((label) => {
        const geometry = rect(label);
        return {
          className: label.getAttribute('class') ?? '',
          text: label.textContent?.trim() ?? '',
          rect: geometry,
          contained: surface !== null && contains(surface, geometry),
          pointerEvents: getComputedStyle(label).pointerEvents,
        };
      });
      return { nodeId: node.getAttribute('data-node-id'), surface, labels };
    });
    const routeChips = [...document.querySelectorAll('[data-flow-world] .flow-route-chip-text')].map((label) => {
      const surfaceElement = label.previousElementSibling;
      const surface = surfaceElement?.classList.contains('flow-route-chip-surface') ? rect(surfaceElement) : null;
      const geometry = rect(label);
      return {
        text: label.textContent?.trim() ?? '',
        rect: geometry,
        surface,
        contained: surface !== null && contains(surface, geometry),
        textPointerEvents: getComputedStyle(label).pointerEvents,
        surfacePointerEvents: surfaceElement ? getComputedStyle(surfaceElement).pointerEvents : null,
      };
    });
    const cjk = /[\u3400-\u9fff]/u;
    const nodeLabels = nodes.flatMap((node) => node.labels.map((label) => ({ ...label, nodeId: node.nodeId })));
    const longestChineseNode = nodeLabels.filter((label) => cjk.test(label.text)).sort((a, b) => b.text.length - a.text.length)[0] ?? null;
    const longestChineseRouteChip = routeChips.filter((label) => cjk.test(label.text)).sort((a, b) => b.text.length - a.text.length)[0] ?? null;
    const labeledVisibleRouteCount = [...document.querySelectorAll('[data-flow-route="orthogonal"][data-flow-label]')]
      .filter((route) => {
        const style = getComputedStyle(route);
        return style.display !== 'none' && style.visibility !== 'hidden' && (route.getTotalLength?.() ?? 0) > 0;
      }).length;
    const routeChipOverlaps = [];
    for (let left = 0; left < routeChips.length; left += 1) {
      for (let right = left + 1; right < routeChips.length; right += 1) {
        if (overlaps(routeChips[left].surface ?? routeChips[left].rect, routeChips[right].surface ?? routeChips[right].rect)) {
          routeChipOverlaps.push([routeChips[left].text, routeChips[right].text]);
        }
      }
    }
    return { nodes, routeChips, labeledVisibleRouteCount, routeChipOverlaps, longestChineseNode, longestChineseRouteChip };
  });
}

function assertTextGeometry(evidence) {
  const nodeLabels = evidence.nodes.flatMap((node) => node.labels);
  assert(nodeLabels.length > 0, 'flow nodes expose no visible label geometry');
  assert(evidence.longestChineseNode, 'no Chinese node label was measured');
  assert(nodeLabels.every((label) => label.contained), 'a node label escapes its node surface');
  assert(evidence.routeChips.length === evidence.labeledVisibleRouteCount, `route chip count ${evidence.routeChips.length} does not match ${evidence.labeledVisibleRouteCount} visible labeled routes`);
  if (evidence.routeChips.length === 0) return;
  assert(evidence.longestChineseRouteChip, 'no Chinese route chip was measured');
  assert(evidence.routeChips.every((label) => label.contained), 'a route chip escapes its attached surface');
  assert(evidence.routeChipOverlaps.length === 0, `route chips overlap: ${JSON.stringify(evidence.routeChipOverlaps)}`);
  assert(evidence.routeChips.every((label) => label.textPointerEvents === 'none' && label.surfacePointerEvents === 'none'), 'route chips intercept pointer input');
}

async function flowGeometrySnapshot(page) {
  return page.evaluate(() => {
    const geometry = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const minimap = document.querySelector('[data-editor-region="flow-minimap"]');
    const viewport = minimap?.querySelector('.flow-minimap-viewport');
    const commands = [...document.querySelectorAll('[data-editor-region="flow-toolbar"] [data-flow-action]')].map((command) => {
      const bounds = command.getBoundingClientRect();
      return {
        action: command.getAttribute('data-flow-action'),
        disabled: command.hasAttribute('disabled'),
        width: bounds.width,
        height: bounds.height,
      };
    });
    return {
      canvas: geometry(document.querySelector('[data-editor-region="flow-canvas"]')),
      minimap: geometry(minimap),
      minimapViewBox: minimap?.getAttribute('viewBox') ?? null,
      minimapViewport: viewport ? {
        x: viewport.getAttribute('x'),
        y: viewport.getAttribute('y'),
        width: viewport.getAttribute('width'),
        height: viewport.getAttribute('height'),
      } : null,
      legendHidden: document.querySelector('[data-editor-region="flow-legend"]')?.hasAttribute('hidden') ?? null,
      activeAction: document.activeElement?.getAttribute?.('data-flow-action') ?? null,
      commands,
    };
  });
}

function assertLegendGeometrySnapshot(snapshot, expectedHidden, phase) {
  assert(snapshot.legendHidden === expectedHidden, `${phase}: unexpected legend state`);
  assert(snapshot.canvas?.width > 0 && snapshot.canvas?.height > 0, `${phase}: current canvas geometry is unusable`);
  assert(snapshot.minimap?.width > 0 && snapshot.minimap?.height > 0, `${phase}: current minimap geometry is unusable`);
  assert(typeof snapshot.minimapViewBox === 'string' && snapshot.minimapViewBox.trim().length > 0, `${phase}: minimap viewBox is missing`);
  assert(snapshot.minimapViewport && Number(snapshot.minimapViewport.width) > 0 && Number(snapshot.minimapViewport.height) > 0, `${phase}: minimap viewport is unusable`);
  assert(snapshot.activeAction === 'toggle-legend', `${phase}: legend command did not retain focus`);
  const requiredActions = ['zoom-out', 'zoom-in', 'fit-canvas', 'focus-current', 'toggle-legend'];
  for (const action of requiredActions) {
    const command = snapshot.commands.find((candidate) => candidate.action === action);
    assert(command && !command.disabled && command.width > 0 && command.height > 0, `${phase}: command ${action} is unavailable`);
  }
}

async function scrollFlowCommandIntoVisualViewport(page, action) {
  await page.locator(`[data-flow-action="${action}"]`).evaluate((command) => new Promise((resolve) => {
    command.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function inspectPageScaleCommandGeometry(page) {
  return page.evaluate(() => {
    const visual = window.visualViewport;
    if (!visual) return null;
    const rawRect = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const inVisualViewport = (rect) => ({
      left: rect.left - visual.offsetLeft,
      top: rect.top - visual.offsetTop,
      right: rect.right - visual.offsetLeft,
      bottom: rect.bottom - visual.offsetTop,
      width: rect.width,
      height: rect.height,
    });
    const commandBoxes = [...document.querySelectorAll('[data-editor-region="flow-toolbar"] [data-flow-action]')].map((command) => {
      const layout = rawRect(command);
      const visualRect = inVisualViewport(layout);
      return {
        action: command.getAttribute('data-flow-action'),
        layout,
        visual: visualRect,
        horizontallyVisible: visualRect.left >= -0.5 && visualRect.right <= visual.width + 0.5,
        verticallyVisible: visualRect.top >= -0.5 && visualRect.bottom <= visual.height + 0.5,
      };
    });
    const toolbarElement = document.querySelector('[data-editor-region="flow-toolbar"]');
    const toolbarLayout = toolbarElement ? rawRect(toolbarElement) : null;
    return {
      visualBoundsInLayout: {
        left: visual.offsetLeft,
        top: visual.offsetTop,
        right: visual.offsetLeft + visual.width,
        bottom: visual.offsetTop + visual.height,
        width: visual.width,
        height: visual.height,
        scale: visual.scale,
        pageLeft: visual.pageLeft,
        pageTop: visual.pageTop,
      },
      toolbarLayout,
      toolbarVisual: toolbarLayout ? inVisualViewport(toolbarLayout) : null,
      commandBoxes,
      activeAction: document.activeElement?.getAttribute?.('data-flow-action') ?? null,
    };
  });
}

function assertPageScaleCommandGeometry(evidence) {
  const requiredActions = new Set(['view-focus', 'view-overview', 'zoom-out', 'zoom-in', 'fit-canvas', 'focus-current', 'toggle-legend']);
  assert([...requiredActions].every((action) => evidence.some((command) => command.action === action)), 'page-scale Flow toolbar omits a required command');
  for (const command of evidence) {
    const { action } = command;
    assert(command.before.horizontallyVisible && command.before.verticallyVisible, `${action} could not enter the page-scale visual viewport`);
    assert(command.focusedAction === action, `${action} could not receive page-scale keyboard focus`);
    assert(command.activatedAction === action, `${action} could not retain focus after page-scale activation`);
  }
}

async function verifyPageScaleCommandsIndividually(page) {
  const requiredActions = new Set(['view-focus', 'view-overview', 'zoom-out', 'zoom-in', 'fit-canvas', 'focus-current', 'toggle-legend']);
  const activationOrder = ['view-overview', 'view-focus', 'zoom-out', 'zoom-in', 'fit-canvas', 'focus-current', 'toggle-legend'];
  const evidence = [];
  for (const action of activationOrder) {
    await scrollFlowCommandIntoVisualViewport(page, action);
    const beforeSnapshot = await inspectPageScaleCommandGeometry(page);
    assert(beforeSnapshot, 'page-scale visual viewport is unavailable');
    assert(beforeSnapshot.toolbarVisual, 'Flow toolbar has no page-scale geometry');
    const before = beforeSnapshot.commandBoxes.find((command) => command.action === action);
    assert(before, `page-scale Flow toolbar omits ${action}`);
    const command = page.locator(`[data-flow-action="${action}"]`);
    await command.focus();
    const focusedAction = await page.evaluate(() => document.activeElement?.getAttribute('data-flow-action') ?? null);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (expectedAction) => document.activeElement?.getAttribute('data-flow-action') === expectedAction,
      action,
    );
    const afterSnapshot = await inspectPageScaleCommandGeometry(page);
    const activatedAction = afterSnapshot?.activeAction ?? null;
    evidence.push({ action, before, focusedAction, activatedAction });
  }
  assert([...requiredActions].every((action) => evidence.some((command) => command.action === action)), 'page-scale command evidence is incomplete');
  assertPageScaleCommandGeometry(evidence);
  return evidence;
}

async function inspectNarrativeMap(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const contains = (outer, inner, tolerance = 1.5) => inner.left >= outer.left - tolerance
      && inner.right <= outer.right + tolerance
      && inner.top >= outer.top - tolerance
      && inner.bottom <= outer.bottom + tolerance;
    const overlaps = (left, right, tolerance = 1) => left.left < right.right - tolerance
      && left.right > right.left + tolerance
      && left.top < right.bottom - tolerance
      && left.bottom > right.top + tolerance;
    const frames = [...document.querySelectorAll('[data-flow-scene-frame][data-scene-id][data-flow-component]')].map((frame) => {
      const sceneId = frame.getAttribute('data-scene-id');
      const surface = frame.querySelector('.flow-scene-frame-surface');
      const frameRect = surface ? rect(surface) : rect(frame);
      const members = [...document.querySelectorAll(`[data-flow-node-kind][data-scene-id="${sceneId}"]`)].map((node) => ({
        id: node.getAttribute('data-node-id'),
        rect: rect(node),
      }));
      return {
        sceneId,
        component: frame.getAttribute('data-flow-component'),
        rect: frameRect,
        memberIds: members.map((member) => member.id),
        membersContained: members.every((member) => contains(frameRect, member.rect)),
      };
    });
    const frameOverlaps = [];
    for (let left = 0; left < frames.length; left += 1) {
      for (let right = left + 1; right < frames.length; right += 1) {
        if (overlaps(frames[left].rect, frames[right].rect)) {
          frameOverlaps.push([frames[left].sceneId, frames[right].sceneId]);
        }
      }
    }
    const nodeRects = new Map(
      [...document.querySelectorAll('[data-flow-node-kind][data-node-id]')]
        .map((node) => [node.getAttribute('data-node-id'), rect(node)]),
    );
    const routes = [...document.querySelectorAll('[data-flow-route="orthogonal"]')].map((route) => {
      const path = route.getAttribute('d') ?? '';
      const from = route.getAttribute('data-flow-from');
      const to = route.getAttribute('data-flow-to');
      const crossedNodeIds = [];
      const matrix = route.getScreenCTM?.();
      const total = route.getTotalLength?.() ?? 0;
      if (matrix && total > 0 && typeof DOMPoint === 'function') {
        for (let distance = 2; distance < total - 2; distance += 3) {
          const local = route.getPointAtLength(distance);
          const point = new DOMPoint(local.x, local.y).matrixTransform(matrix);
          for (const [nodeId, bounds] of nodeRects.entries()) {
            if (nodeId === from || nodeId === to || crossedNodeIds.includes(nodeId)) continue;
            if (point.x > bounds.left + 1 && point.x < bounds.right - 1
              && point.y > bounds.top + 1 && point.y < bounds.bottom - 1) {
              crossedNodeIds.push(nodeId);
            }
          }
        }
      }
      return {
        kind: route.getAttribute('data-flow-edge-kind'),
        from,
        to,
        path,
        terminalSegment: [...path.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)]
          .map((match) => `${Number(match[1])},${Number(match[2])}`)
          .slice(-2)
          .join(' -> '),
        // Orthogonal routes use only M/L commands; this explicitly rejects cubic Bezier C segments.
        orthogonal: path.includes('C') === false && /^[ML\s\d.,-]+$/.test(path),
        technical: route.classList.contains('is-technical'),
        crossedNodeIds,
      };
    });
    const primaryTextSelectors = [
      '.flow-component-heading',
      '.flow-scene-frame-title',
      '.flow-scene-frame-status',
      '.flow-node-primary',
      '.flow-node-meta',
      '.flow-route-chip-text',
    ];
    const primaryTexts = [...document.querySelectorAll(primaryTextSelectors.join(','))]
      .filter((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
      })
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '')
      .filter(Boolean);
    const routeChips = [...document.querySelectorAll('[data-flow-route-label]')].map((chip) => ({
      kind: chip.getAttribute('data-flow-route-label'),
      text: chip.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      rect: rect(chip),
    }));
    const returnMarkers = [...document.querySelectorAll('[data-flow-return-target]')].map((marker) => ({
      targetSceneId: marker.getAttribute('data-flow-return-target'),
      text: marker.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    }));
    const activeViewAction = [...document.querySelectorAll('[data-flow-action="view-focus"], [data-flow-action="view-overview"]')]
      .find((button) => button.getAttribute('aria-pressed') === 'true')?.getAttribute('data-flow-action') ?? null;
    const unprojectableExplanationElement = document.querySelector('.flow-technical-panel .surdet-technical-text');
    const unprojectableExplanationBounds = unprojectableExplanationElement?.getBoundingClientRect();
    const unprojectableExplanationStyle = unprojectableExplanationElement
      ? getComputedStyle(unprojectableExplanationElement)
      : null;
    return {
      frames,
      frameOverlaps,
      routes,
      routeChips,
      mainHeading: document.querySelector('[data-flow-component-heading="main"]')?.textContent?.trim() ?? null,
      secondaryHeading: document.querySelector('[data-flow-component-heading="secondary"]')?.textContent?.trim() ?? null,
      mainSceneIds: frames.filter((frame) => frame.component === 'main').sort((a, b) => a.rect.left - b.rect.left).map((frame) => frame.sceneId),
      secondarySceneIds: frames.filter((frame) => frame.component === 'secondary').map((frame) => frame.sceneId),
      primaryTexts,
      primaryText: primaryTexts.join(' | '),
      choiceDestinationTexts: primaryTexts.filter((text) => text.startsWith('选择“') && text.endsWith('”后')),
      hasHumanCondition: primaryTexts.includes('有条件') || primaryTexts.some((text) => text.includes('有条件')),
      activeViewAction,
      technicalPressed: document.querySelector('[data-flow-action="toggle-technical-edges"]')?.getAttribute('aria-pressed') ?? null,
      unprojectableExplanation: unprojectableExplanationElement?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      unprojectableExplanationVisible: Boolean(unprojectableExplanationBounds
        && unprojectableExplanationBounds.width > 0
        && unprojectableExplanationBounds.height > 0
        && unprojectableExplanationStyle?.display !== 'none'
        && unprojectableExplanationStyle?.visibility !== 'hidden'),
      returnMarkers,
      currentSceneId: window.surdetEditorDebug?.state?.current ?? null,
      realNodeCount: document.querySelectorAll('[data-flow-node-kind][data-node-id]').length,
      presentationBranchNodeCount: document.querySelectorAll('[data-flow-node-kind="choice"], [data-node-id^="choice:"]').length,
    };
  });
}

function assertCommonNarrativeGeometry(evidence) {
  assert(evidence.frames.every((frame) => frame.membersContained), 'scene frame does not contain every real scene member');
  assert(evidence.frameOverlaps.length === 0, `scene frames overlap: ${JSON.stringify(evidence.frameOverlaps)}`);
  assert(evidence.routes.length > 0, 'default narrative map renders no routes');
  assert(evidence.routes.every((route) => route.orthogonal), 'a narrative route is not orthogonal');
  assert(evidence.routes.every((route) => route.crossedNodeIds.length === 0), 'an orthogonal route crosses a real node interior');
  assert(evidence.presentationBranchNodeCount === 0, 'presentation-only choice card leaked into real node identity');
}

function assertFocusProjection(evidence) {
  assertCommonNarrativeGeometry(evidence);
  assert(evidence.activeViewAction === 'view-focus', `focus projection pressed ${evidence.activeViewAction}`);
  assert(evidence.mainHeading === '当前聚焦路径', `unexpected focus heading: ${evidence.mainHeading}`);
  assert(evidence.secondaryHeading === null, `focus projection unexpectedly rendered ${evidence.secondaryHeading}`);
  assert(JSON.stringify(evidence.mainSceneIds) === JSON.stringify(['ch01_01', 'ch01_02']), `focus scene projection is not ch01_01 + ch01_02: ${evidence.mainSceneIds.join(', ')}`);
  assert(evidence.secondarySceneIds.length === 0, 'focus projection leaked disconnected scenes');
  const focused = evidence.frames.find((frame) => frame.sceneId === 'ch01_01');
  const neighbour = evidence.frames.find((frame) => frame.sceneId === 'ch01_02');
  assert(focused && neighbour && focused.memberIds.length > 2 && neighbour.memberIds.length === 1, 'focused scene is not expanded while its neighbour stays compact');
  assert(evidence.routes.every((route) => route.kind !== 'choice'), 'default focus projection rendered a choice route');
  const requiredChoiceTexts = ['选择“先问凛和沈岳的关系”后', '选择“在窗口查退回章的理由”后', '选择“先收下信，等她自己开口”后'];
  for (const choiceText of requiredChoiceTexts) {
    assert(evidence.choiceDestinationTexts.includes(choiceText), `missing attached choice destination text: ${choiceText}`);
  }
  assert(!evidence.hasHumanCondition, 'focus projection exposed a conditional choice outside the current route');
  for (const forbidden of ['@label', '[if:', 'host-entry', 'answer_']) {
    assert(!evidence.primaryText.includes(forbidden), `primary narrative text exposes technical token ${forbidden}`);
  }
}

function assertFocusRouteBundle(evidence) {
  const jumps = evidence.routes.filter((route) => route.kind === 'jump' && route.to === 's:ch01_02');
  assert(jumps.length === 3, `focus projection rendered ${jumps.length}/3 jumps into ch01_02`);
  const terminalSegments = new Set(jumps.map((route) => route.terminalSegment));
  assert(terminalSegments.size === 1 && !terminalSegments.has(''), `three jumps do not share one terminal trunk: ${JSON.stringify([...terminalSegments])}`);
}

function assertOverviewProjection(evidence) {
  assertCommonNarrativeGeometry(evidence);
  assert(evidence.activeViewAction === 'view-overview', `overview projection pressed ${evidence.activeViewAction}`);
  assert(evidence.mainHeading === '全局场景概览', `unexpected overview heading: ${evidence.mainHeading}`);
  assert(evidence.secondaryHeading === '其他入口', `unexpected secondary heading: ${evidence.secondaryHeading}`);
  assert(JSON.stringify([...evidence.frames.map((frame) => frame.sceneId)].sort()) === JSON.stringify(['ch01_01', 'ch01_02', 'ch02', 'ending_delivered', 'ending_open_door', 'ending_unanswered', 'playground']), `overview is not the current seven-scene projection: ${evidence.frames.map((frame) => frame.sceneId).join(', ')}`);
  assert(evidence.frames.every((frame) => frame.memberIds.length === 1), 'overview expanded internal story beats');
  assert(evidence.returnMarkers.length === 3 && evidence.returnMarkers.every((marker) => marker.targetSceneId === 'playground' && marker.text === '↩ 返回 playground'), `overview return markers do not match the current playground loops: ${JSON.stringify(evidence.returnMarkers)}`);
  assert(!evidence.routes.some((route) => (
    (route.from === 's:ch02' || route.from?.startsWith('l:ch02.'))
      && (route.to === 's:ch01_01' || route.to?.startsWith('l:ch01_01.'))
  )), 'overview rendered a non-existent ch02 → ch01_01 return route');
}

async function inspectRealFlowFacts(page) {
  return page.evaluate(() => {
    const workbench = document.querySelector('[data-editor-region="flow-workbench"]');
    const status = document.querySelector('[data-editor-region="flow-status"]');
    const legend = document.querySelector('[data-editor-region="flow-legend"]');
    const nodes = [...document.querySelectorAll('[data-flow-node-kind]')];
    const edges = [...document.querySelectorAll('[data-flow-world] .flow-route[data-flow-edge-kind]')];
    const nodeKinds = Object.fromEntries(['scene', 'label', 'host-entry'].map((kind) => [
      kind,
      nodes.filter((node) => node.getAttribute('data-flow-node-kind') === kind).length,
    ]));
    const edgeKinds = [...new Set(edges.map((edge) => edge.getAttribute('data-flow-edge-kind')).filter(Boolean))].sort();
    const currentNodes = nodes.filter((node) => node.getAttribute('aria-current') === 'true');
    const statusText = status?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const nodeStat = status?.querySelector('[data-flow-stat="nodes"]');
    const edgeStat = status?.querySelector('[data-flow-stat="edges"]');
    const statusSceneCount = Number(/场景\s*(\d+)/.exec(nodeStat?.textContent ?? '')?.[1] ?? Number.NaN);
    const statusChoiceCount = Number(/选择\s*(\d+)/.exec(edgeStat?.textContent ?? '')?.[1] ?? Number.NaN);
    const statusNodeCount = Number(/真实节点\s*(\d+)/.exec(nodeStat?.getAttribute('title') ?? '')?.[1] ?? Number.NaN);
    const statusEdgeCount = Number(/真实连接\s*(\d+)/.exec(edgeStat?.getAttribute('title') ?? '')?.[1] ?? Number.NaN);
    return {
      mainTab: window.surdetEditorDebug?.state?.mainTab ?? null,
      current: window.surdetEditorDebug?.state?.current ?? null,
      workbenchCount: document.querySelectorAll('[data-editor-region="flow-workbench"]').length,
      canvasCount: document.querySelectorAll('[data-editor-region="flow-canvas"] .flow-canvas-svg').length,
      minimapCount: document.querySelectorAll('[data-editor-region="flow-minimap"]').length,
      previewCount: document.querySelectorAll('#preview-view, iframe').length,
      timelineCount: document.querySelectorAll('#timeline-view').length,
      nodeCount: nodes.length,
      renderedEdgeCount: edges.length,
      statusSceneCount,
      statusChoiceCount,
      statusNodeCount,
      statusEdgeCount,
      nodeKinds,
      edgeKinds,
      choiceCount: edges.filter((edge) => edge.getAttribute('data-flow-edge-kind') === 'choice').length,
      focusableNodeCount: nodes.filter((node) => node.getAttribute('role') === 'button' && node.getAttribute('tabindex') === '0').length,
      currentNodeIds: currentNodes.map((node) => node.getAttribute('data-node-id')),
      statusText,
      workbenchText: workbench?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      legendText: legend?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      labelStartText: document.querySelector('[data-node-id="l:ch01_01.start"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      hostText: document.querySelector('[data-flow-node-kind="host-entry"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      humanConditionPresent: [...workbench?.querySelectorAll('.flow-node-meta, .flow-route-chip-text, [aria-label]') ?? []]
        .some((element) => `${element.textContent ?? ''} ${element.getAttribute?.('aria-label') ?? ''}`.includes('有条件'))
        || document.querySelector('[data-flow-condition="有条件"]') !== null,
    };
  });
}

function assertRealFlowFacts(facts) {
  assert(facts.mainTab === 'flow', `unexpected main tab ${facts.mainTab}`);
  assert(facts.current === 'ch01_01', `unexpected real current scene ${facts.current}`);
  assert(facts.workbenchCount === 1, `flow workbench count ${facts.workbenchCount}`);
  assert(facts.canvasCount === 1, `flow canvas count ${facts.canvasCount}`);
  assert(facts.minimapCount === 1, `flow minimap count ${facts.minimapCount}`);
  assert(facts.previewCount === 0, 'flow mode duplicated preview content');
  assert(facts.timelineCount === 0, 'flow mode duplicated timeline content');
  assert(facts.nodeKinds.scene === 2, `expected two focused Starter scenes, got ${facts.nodeKinds.scene}`);
  assert(facts.nodeKinds.label > 0, 'focused scene did not expose its story beats');
  assert(facts.nodeKinds['host-entry'] === 0, `unexpected focused project entry badge, got ${facts.nodeKinds['host-entry']}`);
  assert(facts.choiceCount === 0, `default focus projection rendered ${facts.choiceCount} choice routes`);
  assert(facts.focusableNodeCount === facts.nodeCount, 'not every real flow node is keyboard focusable');
  assert(facts.currentNodeIds.length === 1 && facts.currentNodeIds[0] === 's:ch01_01', 'current scene node is not explicit');
  assert(facts.statusSceneCount === 2, `status scene count ${facts.statusSceneCount}`);
  assert(facts.statusChoiceCount === 13, `status choice count ${facts.statusChoiceCount}`);
  assert(facts.statusNodeCount > facts.nodeCount, `bounded focus projection did not hide any raw nodes: ${facts.statusNodeCount}/${facts.nodeCount}`);
  assert(facts.statusEdgeCount === 74, `expected 74 real Starter graph connections, got ${facts.statusEdgeCount}`);
  assert(facts.renderedEdgeCount > 0 && facts.renderedEdgeCount < facts.statusEdgeCount, `default narrative routes ${facts.renderedEdgeCount} did not suppress technical connections`);
  assert(/开场/.test(facts.labelStartText), `label node is not writer-facing: ${facts.labelStartText}`);
  assert(facts.hostText === '', `unexpected host-entry text in the current Starter project: ${facts.hostText}`);
  for (const term of ['场景分镜', '剧情段落', '项目入口', '顺序', '选项', '条件']) {
    assert(facts.legendText.includes(term), `legend omits ${term}`);
  }
  for (const forbidden of ['章节时长', '协作者', '版本 12', '完成率', '路径覆盖率', '分支概率']) {
    assert(!facts.workbenchText.includes(forbidden), `flow workbench fabricated unsupported fact: ${forbidden}`);
  }
}

async function clickFlowNode(page, nodeId) {
  const node = page.locator(`[data-node-id="${nodeId}"]`);
  await node.scrollIntoViewIfNeeded();
  const box = await node.boundingBox();
  assert(box, `node ${nodeId} has no pointer geometry`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function keyboardOpenFlowNode(page, nodeId, key) {
  const node = page.locator(`[data-node-id="${nodeId}"]`);
  await node.focus();
  await page.keyboard.press(key);
}

async function assertCurrentNodeCentered(page, nodeId) {
  const geometry = await page.evaluate((id) => {
    const canvas = document.querySelector('[data-editor-region="flow-canvas"]');
    const node = document.querySelector(`[data-node-id="${id}"]`);
    if (!canvas || !node) return null;
    const c = canvas.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    return {
      canvasCenterX: (c.left + c.right) / 2,
      canvasCenterY: (c.top + c.bottom) / 2,
      nodeCenterX: (n.left + n.right) / 2,
      nodeCenterY: (n.top + n.bottom) / 2,
      canvasWidth: c.width,
      canvasHeight: c.height,
    };
  }, nodeId);
  assert(geometry, `cannot inspect centered node ${nodeId}`);
  assert(Math.abs(geometry.nodeCenterX - geometry.canvasCenterX) <= geometry.canvasWidth * 0.22, `${nodeId} is not horizontally centered`);
  assert(Math.abs(geometry.nodeCenterY - geometry.canvasCenterY) <= geometry.canvasHeight * 0.22, `${nodeId} is not vertically centered`);
  return geometry;
}

async function run() {
  const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-editorial-flow-canvas-wave3a-'));
  const evidencePath = path.join(artifactDirectory, 'evidence.json');
  const identityPath = path.join(artifactDirectory, 'identity.json');
  const milestones = [];
  const screenshots = [];
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  const childCleanupFailures = [];
  const serverStdout = [];
  const serverStderr = [];
  const starterBefore = hashProjectTree(starterRoot);
  const browserFiles = fileMapForDirectory(starterRoot);
  const injectedBefore = browserFileMapTreeIdentity(browserFiles);
  let browser = null;
  let page = null;
  let cdp = null;
  let server = null;
  let port = null;
  let failure = null;
  let portReleased = false;
  let opened = null;
  let flowFacts = null;
  let narrativeMapEvidence = null;
  let layoutEvidence = null;
  let controlEvidence = null;
  let navigationEvidence = null;
  let editEvidence = null;
  let injectedAfter = null;

  const pass = (name, evidence = {}) => milestones.push({ name, status: 'passed', evidence });
  try {
    port = await chooseStrictPort();
    assert(!forbiddenPorts.has(port), `forbidden port selected: ${port}`);
    pass('strict-isolated-port-selected', { port, forbiddenPorts: FORBIDDEN_PORTS });

    const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    assert(fs.existsSync(viteBin), `Vite launcher missing: ${viteBin}`);
    server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: editorRoot,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    server.stdout.setEncoding('utf8');
    server.stderr.setEncoding('utf8');
    server.stdout.on('data', (chunk) => serverStdout.push(chunk));
    server.stderr.on('data', (chunk) => serverStderr.push(chunk));
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(server, `${baseUrl}/index.html`);
    pass('isolated-vite-ready', { baseUrl, pid: server.pid });

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(errorText(error)));
    page.on('requestfailed', (request) => requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
    await page.addInitScript(fakeFileSystemInit, { rootName: 'starter', files: browserFiles });
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
    opened = await openRealStarter(page);
    assert(opened.projectName === 'starter', `project bar did not show Starter: ${opened.projectName}`);
    assert(opened.sceneCount === 7, `expected seven real Starter scenes, got ${opened.sceneCount}`);
    assert(opened.timelineCount === 1, `expected one real Starter timeline, got ${opened.timelineCount}`);
    assert(opened.assetCount >= 6, `expected real Starter assets, got ${opened.assetCount}`);
    pass('real-starter-opened-through-picker', opened);

    await enterFlowMode(page);
    await page.locator('[data-flow-action="fit-canvas"]').click();
    const topology = await page.evaluate(() => ({
      mainTab: window.surdetEditorDebug?.state?.mainTab ?? null,
      flowViewCount: document.querySelectorAll('#flow-view').length,
      workbenchCount: document.querySelectorAll('[data-editor-region="flow-workbench"]').length,
      svgCount: document.querySelectorAll('[data-editor-region="flow-canvas"] .flow-canvas-svg').length,
      minimapCount: document.querySelectorAll('[data-editor-region="flow-minimap"]').length,
      previewCount: document.querySelectorAll('#preview-view, iframe').length,
      timelineCount: document.querySelectorAll('#timeline-view').length,
    }));
    assert(topology.mainTab === 'flow', `unexpected main tab ${topology.mainTab}`);
    assert(topology.flowViewCount === 1, `flow view count ${topology.flowViewCount}`);
    assert(topology.workbenchCount === 1, `flow workbench count ${topology.workbenchCount}`);
    assert(topology.svgCount === 1, `flow SVG count ${topology.svgCount}`);
    assert(topology.minimapCount === 1, `flow minimap count ${topology.minimapCount}`);
    assert(topology.previewCount === 0, 'preview duplicated in flow mode');
    assert(topology.timelineCount === 0, 'timeline duplicated in flow mode');
    pass('flow-workbench-single-truth', topology);

    flowFacts = await inspectRealFlowFacts(page);
    assertRealFlowFacts(flowFacts);
    pass('semantic-regions-and-real-facts', {
      statusText: flowFacts.statusText,
      nodeCount: flowFacts.nodeCount,
      statusEdgeCount: flowFacts.statusEdgeCount,
      renderedEdgeCount: flowFacts.renderedEdgeCount,
      focusableNodeCount: flowFacts.focusableNodeCount,
    });
    const focusMap = await inspectNarrativeMap(page);
    assertFocusProjection(focusMap);
    pass('focus-projection-bounded', {
      nodeKinds: flowFacts.nodeKinds,
      edgeKinds: flowFacts.edgeKinds,
      choiceCount: flowFacts.choiceCount,
      currentNodeIds: flowFacts.currentNodeIds,
      labelStartText: flowFacts.labelStartText,
      hostText: flowFacts.hostText,
      humanConditionPresent: flowFacts.humanConditionPresent,
      mainHeading: focusMap.mainHeading,
      mainSceneIds: focusMap.mainSceneIds,
      focusFrames: focusMap.frames,
      choiceDestinationTexts: focusMap.choiceDestinationTexts,
      primaryTexts: focusMap.primaryTexts,
    });
    assertFocusRouteBundle(focusMap);
    const textGeometry = await inspectTextGeometry(page);
    assertTextGeometry(textGeometry);
    pass('focus-route-bundle-readable', {
      frameCount: focusMap.frames.length,
      frameOverlaps: focusMap.frameOverlaps,
      routeCount: focusMap.routes.length,
      routes: focusMap.routes,
      jumpTerminalSegments: focusMap.routes.filter((route) => route.kind === 'jump' && route.to === 's:ch01_02').map((route) => route.terminalSegment),
      nodeLabelCount: textGeometry.nodes.reduce((count, node) => count + node.labels.length, 0),
      routeChipCount: textGeometry.routeChips.length,
      labeledVisibleRouteCount: textGeometry.labeledVisibleRouteCount,
      routeChipOverlaps: textGeometry.routeChipOverlaps,
      longestChineseNode: textGeometry.longestChineseNode,
      longestChineseRouteChip: textGeometry.longestChineseRouteChip,
      routeChipsIgnorePointerInput: textGeometry.routeChips.every((label) => label.textPointerEvents === 'none' && label.surfacePointerEvents === 'none'),
    });

    const overviewSwitch = await switchFlowView(page, 'view-overview');
    const overviewMap = await inspectNarrativeMap(page);
    assertOverviewProjection(overviewMap);
    await takeScreenshot(page, artifactDirectory, 'flow-global-overview', screenshots);
    pass('overview-scene-map-readable', {
      switch: overviewSwitch,
      frames: overviewMap.frames,
      mainSceneIds: overviewMap.mainSceneIds,
      secondarySceneIds: overviewMap.secondarySceneIds,
      returnMarkers: overviewMap.returnMarkers,
      routes: overviewMap.routes,
    });

    const focusSwitch = await switchFlowView(page, 'view-focus');
    const restoredFocusMap = await inspectNarrativeMap(page);
    assertFocusProjection(restoredFocusMap);
    assert(focusSwitch.activeAction === 'view-focus', `mode switch did not retain keyboard focus on view-focus: ${focusSwitch.activeAction}`);
    assert(restoredFocusMap.currentSceneId === 'ch01_01', `mode switch changed the current scene to ${restoredFocusMap.currentSceneId}`);
    const autoFitLayout = await inspectFlowLayout(page);
    assertFlowLayout(autoFitLayout, 1440, {
      nodeCount: restoredFocusMap.realNodeCount,
      frameCount: 2,
      activeViewAction: 'view-focus',
    });
    pass('mode-switch-focus-stable', {
      overviewSwitch,
      focusSwitch,
      currentSceneId: restoredFocusMap.currentSceneId,
      autoFitLayout,
    });

    const defaultRouteCount = restoredFocusMap.routes.length;
    const technicalMap = await enableTechnicalConnections(page);
    const legendModeForTechnicalRoutes = 'opened-through-disclosure';
    const revealedRouteCount = technicalMap.routes.length;
    assert(technicalMap.technicalPressed === 'true', 'technical route toggle did not expose its pressed state');
    assert(revealedRouteCount > defaultRouteCount, 'technical route toggle did not reveal more real routes');
    assert(technicalMap.unprojectableExplanationVisible, 'technical explanation for unprojectable connections is not visible');
    assert(technicalMap.unprojectableExplanation.includes('另有 13 条连接因端点缺失未显示'), `unexpected unprojectable explanation: ${technicalMap.unprojectableExplanation}`);
    const unprojectableMatch = /另有\s+(\d+)\s+条连接因端点缺失未显示/.exec(technicalMap.unprojectableExplanation);
    assert(unprojectableMatch, `visible technical explanation has no unprojectable count: ${technicalMap.unprojectableExplanation}`);
    const unprojectableRawEdgeCount = Number(unprojectableMatch[1]);
    assert(unprojectableRawEdgeCount === 13, `expected 13 raw Starter connections with missing endpoints, got ${unprojectableRawEdgeCount}`);
    const projectableNarrativeRouteCount = flowFacts.statusEdgeCount - unprojectableRawEdgeCount;
    assert(revealedRouteCount === projectableNarrativeRouteCount, `technical route toggle revealed ${revealedRouteCount}/${projectableNarrativeRouteCount} projectable narrative routes`);
    assert(technicalMap.frames.length === 7, `technical view rendered ${technicalMap.frames.length}/7 scene frames`);
    assert(technicalMap.hasHumanCondition, 'technical view did not expose the current playground conditional choices');
    assert(technicalMap.realNodeCount === flowFacts.statusNodeCount, `technical view rendered ${technicalMap.realNodeCount}/${flowFacts.statusNodeCount} projectable nodes`);
    await takeScreenshot(page, artifactDirectory, 'flow-technical-connections', screenshots);
    await page.locator('[data-flow-action="toggle-technical-edges"]').click();
    await page.waitForFunction((expected) => document.querySelectorAll('[data-flow-route="orthogonal"]').length === expected, defaultRouteCount);
    assert(await page.locator('[data-flow-action="toggle-technical-edges"]').getAttribute('aria-pressed') === 'false', 'technical route toggle did not return to the readable default');
    pass('technical-connections-on-demand', {
      legendMode: legendModeForTechnicalRoutes,
      defaultRouteCount,
      revealedRouteCount,
      projectableNarrativeRouteCount,
      unprojectableRawEdgeCount,
      unprojectableExplanation: technicalMap.unprojectableExplanation,
      unprojectableExplanationVisible: technicalMap.unprojectableExplanationVisible,
      rawGraphEdgeCount: flowFacts.statusEdgeCount,
      frameCount: technicalMap.frames.length,
      nodeCount: technicalMap.realNodeCount,
    });
    await setLegendExpanded(page, false);
    narrativeMapEvidence = { focus: focusMap, overview: overviewMap, technical: technicalMap };

    layoutEvidence = {};
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await switchFlowView(page, 'view-focus');
      await setLegendExpanded(page, false);
      await page.locator('[data-flow-action="fit-canvas"]').click();
      const legendMode = 'default-collapsed';
      const layout = await inspectFlowLayout(page);
      layoutEvidence[viewport.id] = { ...layout, legendMode };
      await takeScreenshot(page, artifactDirectory, `flow-${viewport.id}`, screenshots);
      assertFlowLayout(layout, viewport.width, {
        nodeCount: restoredFocusMap.realNodeCount,
        frameCount: 2,
        activeViewAction: 'view-focus',
      });
      pass(`layout-${viewport.id}`, {
        viewport: layout.viewport,
        pageWidth: layout.pageWidth,
        workbench: layout.workbench,
        canvas: layout.canvas,
        legend: layout.legend,
        minimap: layout.minimap,
        commandCount: layout.commandRects.length,
        visibleNodeCount: layout.nodeRects.filter((node) => node.width > 0 && node.height > 0).length,
        legendMode,
      });
    }

    await page.setViewportSize({ width: 800, height: 500 });
    await setLegendExpanded(page, false);
    await page.locator('[data-flow-action="fit-canvas"]').click();
    const pageScaleLegendMode = 'default-collapsed';
    const pageScaleBaseline = await inspectFlowLayout(page);
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await page.waitForFunction(() => Math.abs((window.visualViewport?.scale ?? 1) - 2) < 0.05);
    const perCommandReachability = await verifyPageScaleCommandsIndividually(page);
    await setLegendExpanded(page, false);
    const beforeScaledFit = await worldTransform(page);
    await scrollFlowCommandIntoVisualViewport(page, 'fit-canvas');
    const scaledFit = page.locator('[data-flow-action="fit-canvas"]');
    await scaledFit.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-flow-action') === 'fit-canvas');
    const afterScaledFit = await worldTransform(page);
    assert(transformChanged(beforeScaledFit, afterScaledFit), 'fit-canvas was not actually activated at page scale 2');
    const pageScaleCommandGeometry = await inspectPageScaleCommandGeometry(page);
    const fitCommandGeometry = pageScaleCommandGeometry?.commandBoxes.find((command) => command.action === 'fit-canvas');
    assert(fitCommandGeometry?.horizontallyVisible && fitCommandGeometry.verticallyVisible, 'active fit command is outside the page-scale visual viewport');
    assert(pageScaleCommandGeometry.activeAction === 'fit-canvas', 'page-scale fit action lost keyboard focus');
    const pageScaleLayout = await inspectFlowLayout(page);
    layoutEvidence.pageScaleCommandReachability = {
      baseline: pageScaleBaseline,
      scaled: pageScaleLayout,
      commandGeometry: pageScaleCommandGeometry,
      perCommandReachability,
      legendMode: pageScaleLegendMode,
    };
    assertFlowLayout(pageScaleLayout, 800, {
      nodeCount: restoredFocusMap.realNodeCount,
      frameCount: 2,
      activeViewAction: 'view-focus',
    });
    assert(Math.abs(pageScaleBaseline.viewport.visualScale - 1) < 0.05, `unexpected baseline page scale ${pageScaleBaseline.viewport.visualScale}`);
    assert(Math.abs(pageScaleLayout.viewport.visualScale - 2) < 0.05, `expected 200% page scale, got ${pageScaleLayout.viewport.visualScale}`);
    assert(pageScaleLayout.viewport.visualWidth <= pageScaleLayout.viewport.width / 1.9, `200% page scale did not narrow effective CSS geometry: ${pageScaleLayout.viewport.visualWidth}/${pageScaleLayout.viewport.width}`);
    assert(pageScaleLayout.viewport.devicePixelRatio === pageScaleBaseline.viewport.devicePixelRatio, 'page-scale evidence incorrectly depends on a DPR change');
    await takeScreenshot(page, artifactDirectory, 'flow-page-scale-command-reachability', screenshots);
    pass('page-scale-command-reachability', {
      method: 'Chromium Emulation.setPageScaleFactor',
      layoutViewport: {
        width: pageScaleLayout.viewport.width,
        height: pageScaleLayout.viewport.height,
      },
      visualViewport: {
        width: pageScaleLayout.viewport.visualWidth,
        height: pageScaleLayout.viewport.visualHeight,
        scale: pageScaleLayout.viewport.visualScale,
      },
      baselineVisualViewport: {
        width: pageScaleBaseline.viewport.visualWidth,
        height: pageScaleBaseline.viewport.visualHeight,
        scale: pageScaleBaseline.viewport.visualScale,
      },
      devicePixelRatioBefore: pageScaleBaseline.viewport.devicePixelRatio,
      devicePixelRatioAfter: pageScaleLayout.viewport.devicePixelRatio,
      pageWidth: pageScaleLayout.pageWidth,
      commandGeometry: pageScaleCommandGeometry,
      perCommandReachability,
      fitActivation: {
        before: beforeScaledFit,
        after: afterScaledFit,
        focusAction: pageScaleCommandGeometry.activeAction,
        containedNodeCount: pageScaleLayout.nodeRects.length,
      },
      legendMode: pageScaleLegendMode,
    });
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await page.waitForFunction(() => Math.abs((window.visualViewport?.scale ?? 1) - 1) < 0.05);
    await cdp.detach();
    cdp = null;
    await page.setViewportSize({ width: 1440, height: 900 });

    const beforeZoom = await worldTransform(page);
    await page.locator('[data-flow-action="zoom-in"]').click();
    const afterZoomIn = await worldTransform(page);
    assert(afterZoomIn.scale > beforeZoom.scale, 'zoom-in did not change the existing flow view scale');
    await page.locator('[data-flow-action="zoom-out"]').click();
    const afterZoomOut = await worldTransform(page);
    assert(afterZoomOut.scale < afterZoomIn.scale, 'zoom-out did not change the existing flow view scale');
    await page.locator('[data-flow-action="zoom-in"]').click();
    await page.locator('[data-flow-action="zoom-in"]').click();
    const beforeFit = await worldTransform(page);
    await page.locator('[data-flow-action="fit-canvas"]').click();
    const afterFit = await worldTransform(page);
    assert(transformChanged(beforeFit, afterFit), 'fit-canvas did not update the existing flow view');
    const visibleAfterFit = await page.locator('[data-flow-node-kind]').evaluateAll((nodes) => nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      const canvas = document.querySelector('[data-editor-region="flow-canvas"]')?.getBoundingClientRect();
      return canvas && rect.left >= canvas.left - 1 && rect.right <= canvas.right + 1 && rect.top >= canvas.top - 1 && rect.bottom <= canvas.bottom + 1;
    }).length);
    const visibleNodeCountBeforeFit = await page.locator('[data-flow-node-kind]').count();
    assert(visibleAfterFit === visibleNodeCountBeforeFit, `fit-canvas kept only ${visibleAfterFit}/${visibleNodeCountBeforeFit} visible nodes in reach`);
    await page.locator('[data-flow-action="focus-current"]').click();
    const currentCentered = await assertCurrentNodeCentered(page, 's:ch01_01');
    controlEvidence = { beforeZoom, afterZoomIn, afterZoomOut, beforeFit, afterFit, visibleAfterFit, currentCentered };
    pass('viewport-controls-use-existing-view', controlEvidence);

    await page.locator('[data-flow-action="fit-canvas"]').click();
    const keyboardZoom = page.locator('[data-flow-action="zoom-in"]');
    await keyboardZoom.focus();
    const keyboardZoomBefore = await worldTransform(page);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-flow-action') === 'zoom-in');
    const keyboardZoomAfterEnter = await worldTransform(page);
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-flow-action') === 'zoom-in');
    const keyboardZoomAfterSpace = await worldTransform(page);
    assert(keyboardZoomAfterEnter.scale > keyboardZoomBefore.scale, 'keyboard Enter did not operate zoom-in');
    assert(keyboardZoomAfterSpace.scale > keyboardZoomAfterEnter.scale, 'consecutive keyboard Space did not operate zoom-in');
    pass('toolbar-keyboard-focus-stable', {
      action: 'zoom-in',
      focusAfterEnter: 'zoom-in',
      focusAfterSpace: 'zoom-in',
      before: keyboardZoomBefore,
      afterEnter: keyboardZoomAfterEnter,
      afterSpace: keyboardZoomAfterSpace,
    });

    await page.locator('[data-flow-action="fit-canvas"]').click();
    await setLegendExpanded(page, true);
    const legendToggle = page.locator('[data-flow-action="toggle-legend"]');
    await legendToggle.focus();
    const legendBefore = await flowGeometrySnapshot(page);
    assertLegendGeometrySnapshot(legendBefore, false, 'initial expanded legend');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-editor-region="flow-legend"]')?.hasAttribute('hidden') === true);
    const legendCollapsed = await flowGeometrySnapshot(page);
    assertLegendGeometrySnapshot(legendCollapsed, true, 'collapsed legend');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-editor-region="flow-legend"]')?.hasAttribute('hidden') === false);
    const legendExpandedGeometry = await flowGeometrySnapshot(page);
    assertLegendGeometrySnapshot(legendExpandedGeometry, false, 're-expanded legend');
    pass('legend-geometry-recomputed', {
      before: legendBefore,
      collapsed: legendCollapsed,
      expanded: legendExpandedGeometry,
    });

    await clickFlowNode(page, 's:ch01_02');
    await page.locator('.manuscript-sheet[data-scene-id="ch01_02"]').waitFor({ state: 'visible' });
    const pointerNavigation = await page.evaluate(() => ({
      mainTab: window.surdetEditorDebug?.state?.mainTab ?? null,
      current: window.surdetEditorDebug?.state?.current ?? null,
      manuscriptScene: document.querySelector('.manuscript-sheet')?.getAttribute('data-scene-id') ?? null,
    }));
    assert(pointerNavigation.mainTab === 'editor' && pointerNavigation.current === 'ch01_02', 'pointer navigation did not open ch01_02');
    assert(pointerNavigation.manuscriptScene === 'ch01_02', 'pointer navigation manuscript did not follow real scene identity');

    await enterFlowMode(page);
    await enableTechnicalConnections(page);
    await page.locator('[data-flow-action="fit-canvas"]').click();
    await keyboardOpenFlowNode(page, 'l:ch01_01.keep_moving', 'Enter');
    await page.locator('.manuscript-sheet[data-scene-id="ch01_01"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.surdetEditorDebug?.state?.current === 'ch01_01');
    const enterNavigation = await page.evaluate(() => ({
      mainTab: window.surdetEditorDebug?.state?.mainTab ?? null,
      current: window.surdetEditorDebug?.state?.current ?? null,
      selectedLine: document.querySelector('#editor .block[aria-selected="true"]')?.getAttribute('data-line') ?? null,
    }));
    assert(enterNavigation.mainTab === 'editor' && enterNavigation.current === 'ch01_01', 'Enter navigation did not open ch01_01');
    assert(enterNavigation.selectedLine === '40', `Enter navigation selected zero-based line ${enterNavigation.selectedLine}`);

    await enterFlowMode(page);
    await enableTechnicalConnections(page);
    await page.locator('[data-flow-action="fit-canvas"]').click();
    await keyboardOpenFlowNode(page, 'l:ch01_02.start', 'Space');
    await page.locator('.manuscript-sheet[data-scene-id="ch01_02"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.surdetEditorDebug?.state?.current === 'ch01_02');
    const spaceNavigation = await page.evaluate(() => ({
      mainTab: window.surdetEditorDebug?.state?.mainTab ?? null,
      current: window.surdetEditorDebug?.state?.current ?? null,
      selectedLine: document.querySelector('#editor .block[aria-selected="true"]')?.getAttribute('data-line') ?? null,
    }));
    assert(spaceNavigation.mainTab === 'editor' && spaceNavigation.current === 'ch01_02', 'Space navigation did not open ch01_02');
    assert(spaceNavigation.selectedLine === '1', `Space navigation selected zero-based line ${spaceNavigation.selectedLine}`);
    navigationEvidence = { pointerNavigation, enterNavigation, spaceNavigation };
    pass('pointer-and-keyboard-navigation', navigationEvidence);

    await enterFlowMode(page);
    await page.locator('[data-flow-action="fit-canvas"]').click();
    const canvasBox = await page.locator('[data-editor-region="flow-canvas"] .flow-canvas-svg').boundingBox();
    assert(canvasBox, 'flow canvas has no pointer geometry');
    const beforePan = await worldTransform(page);
    await page.mouse.move(canvasBox.x + 12, canvasBox.y + 12);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 92, canvasBox.y + 66, { steps: 8 });
    await page.mouse.up();
    const afterPan = await worldTransform(page);
    assert(transformChanged(beforePan, afterPan), 'background pan did not update existing flow view');

    const beforeMinimap = afterPan;
    const minimapBox = await page.locator('[data-editor-region="flow-minimap"]').boundingBox();
    assert(minimapBox, 'minimap has no pointer geometry');
    const beforeMinimapViewportBox = await page.locator('[data-editor-region="flow-minimap"] .flow-minimap-viewport').boundingBox();
    assert(beforeMinimapViewportBox, 'minimap viewport has no pre-click geometry');
    const beforeViewportCenterRelative = {
      x: (beforeMinimapViewportBox.x + beforeMinimapViewportBox.width / 2 - minimapBox.x) / minimapBox.width,
      y: (beforeMinimapViewportBox.y + beforeMinimapViewportBox.height / 2 - minimapBox.y) / minimapBox.height,
    };
    const minimapClickCandidates = [
      { x: 0.18, y: 0.22 },
      { x: 0.82, y: 0.22 },
      { x: 0.18, y: 0.78 },
      { x: 0.82, y: 0.78 },
    ].map((target) => ({
      ...target,
      distance: Math.hypot(target.x - beforeViewportCenterRelative.x, target.y - beforeViewportCenterRelative.y),
    }));
    const chosenMinimapTarget = minimapClickCandidates.reduce((farthest, target) => (
      target.distance > farthest.distance ? target : farthest
    ));
    const minimapClickRelative = { x: chosenMinimapTarget.x, y: chosenMinimapTarget.y };
    const minimapTargetDistance = chosenMinimapTarget.distance;
    assert(minimapTargetDistance >= 0.4, `minimap target is only ${minimapTargetDistance} relative units from the current viewport center`);
    const minimapClick = {
      x: minimapBox.x + minimapBox.width * minimapClickRelative.x,
      y: minimapBox.y + minimapBox.height * minimapClickRelative.y,
    };
    const minimapHitTarget = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return {
        tagName: target?.tagName ?? null,
        className: target?.getAttribute?.('class') ?? null,
        insideMinimap: Boolean(target?.closest?.('[data-editor-region="flow-minimap"]')),
      };
    }, minimapClick);
    assert(minimapHitTarget.insideMinimap, `minimap click target is obscured: ${JSON.stringify(minimapHitTarget)}`);
    await page.mouse.click(minimapClick.x, minimapClick.y);
    const afterMinimap = await worldTransform(page);
    assert(
      transformChanged(beforeMinimap, afterMinimap),
      `minimap navigation did not update existing flow view: ${JSON.stringify({ beforeMinimap, afterMinimap, beforeViewportCenterRelative, minimapClickRelative, minimapTargetDistance, minimapHitTarget })}`,
    );
    const minimapViewportBox = await page.locator('[data-editor-region="flow-minimap"] .flow-minimap-viewport').boundingBox();
    assert(minimapViewportBox, 're-rendered minimap viewport has no pointer geometry');
    const minimapViewportCenter = {
      x: minimapViewportBox.x + minimapViewportBox.width / 2,
      y: minimapViewportBox.y + minimapViewportBox.height / 2,
    };
    const minimapViewportCenterDistance = Math.hypot(
      minimapViewportCenter.x - minimapClick.x,
      minimapViewportCenter.y - minimapClick.y,
    );
    assert(minimapViewportCenterDistance <= 4, `minimap viewport center missed click by ${minimapViewportCenterDistance}px`);
    await page.locator('[data-flow-action="focus-current"]').click();
    const focusedCurrent = await assertCurrentNodeCentered(page, 's:ch01_02');
    pass('pan-and-minimap-navigation', {
      beforePan,
      afterPan,
      beforeMinimap,
      afterMinimap,
      beforeViewportCenterRelative,
      minimapClickRelative,
      minimapTargetDistance,
      minimapClick,
      minimapViewportCenter,
      minimapViewportCenterDistance,
      focusedCurrent,
    });

    await page.locator('[data-flow-action="fit-canvas"]').click();
    const menuNode = page.locator('[data-node-id="s:ch01_02"]');
    const menuNodeBox = await menuNode.boundingBox();
    assert(menuNodeBox, 'context-menu node has no pointer geometry');
    const beforeContextTransform = await worldTransform(page);
    const contextX = menuNodeBox.x + menuNodeBox.width / 2;
    const contextY = menuNodeBox.y + menuNodeBox.height / 2;
    await page.mouse.move(contextX, contextY);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(contextX + 4, contextY + 3, { steps: 2 });
    await page.mouse.up({ button: 'right' });
    const afterContextTransform = await worldTransform(page);
    assert(!transformChanged(beforeContextTransform, afterContextTransform), 'right-click with slight movement panned the flow world');
    const menu = page.locator('[role="menu"]');
    await menu.waitFor({ state: 'visible' });
    const menuEvidence = await page.evaluate(() => {
      const menuElement = document.querySelector('[role="menu"]');
      const workbench = document.querySelector('[data-editor-region="flow-workbench"]');
      if (!menuElement || !workbench) return null;
      const menuRect = menuElement.getBoundingClientRect();
      const workbenchRect = workbench.getBoundingClientRect();
      return {
        menuRect: { left: menuRect.left, top: menuRect.top, right: menuRect.right, bottom: menuRect.bottom },
        workbenchRect: { left: workbenchRect.left, top: workbenchRect.top, right: workbenchRect.right, bottom: workbenchRect.bottom },
        labels: [...menuElement.querySelectorAll('button')].map((button) => button.textContent?.trim() ?? ''),
        focusableButtons: [...menuElement.querySelectorAll('button')].filter((button) => !button.disabled && button.tabIndex >= 0).length,
      };
    });
    assert(menuEvidence, 'context menu evidence missing');
    assert(menuEvidence.menuRect.left >= menuEvidence.workbenchRect.left - 1, 'context menu escapes left');
    assert(menuEvidence.menuRect.right <= menuEvidence.workbenchRect.right + 1, 'context menu escapes right');
    assert(menuEvidence.menuRect.top >= menuEvidence.workbenchRect.top - 1, 'context menu escapes top');
    assert(menuEvidence.menuRect.bottom <= menuEvidence.workbenchRect.bottom + 1, 'context menu escapes bottom');
    assert(menuEvidence.labels.some((label) => label.includes('重命名')), 'context menu omits rename');
    assert(menuEvidence.labels.some((label) => label.includes('删除')), 'context menu omits delete');
    assert(menuEvidence.focusableButtons >= 2, 'context menu commands are not keyboard reachable');
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    pass('context-menu-pointer-stable', { ...menuEvidence, beforeContextTransform, afterContextTransform, movementCssPixels: { x: 4, y: 3 } });

    await menuNode.focus();
    await page.keyboard.press('Shift+F10');
    await menu.waitFor({ state: 'visible' });
    const activeMenuLabel = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? null);
    const menuFocusSequence = [{ key: 'initial', label: await activeMenuLabel() }];
    for (const key of ['ArrowDown', 'ArrowUp', 'End', 'Home']) {
      await page.keyboard.press(key);
      menuFocusSequence.push({ key, label: await activeMenuLabel() });
    }
    assert(menuFocusSequence[0].label?.includes('重命名'), 'Shift+F10 did not focus the first menu command');
    assert(menuFocusSequence[1].label?.includes('删除'), 'ArrowDown did not focus the next menu command');
    assert(menuFocusSequence[2].label?.includes('重命名'), 'ArrowUp did not focus the previous menu command');
    assert(menuFocusSequence[3].label?.includes('删除'), 'End did not focus the last menu command');
    assert(menuFocusSequence[4].label?.includes('重命名'), 'Home did not focus the first menu command');
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    const returnedFocusNodeId = await page.evaluate(() => document.activeElement?.getAttribute?.('data-node-id') ?? null);
    assert(returnedFocusNodeId === 's:ch01_02', `Escape returned focus to ${returnedFocusNodeId}`);
    pass('context-menu-keyboard-complete', { triggerNodeId: 's:ch01_02', menuFocusSequence, returnedFocusNodeId });

    const sourceSceneId = 'ch01_02';
    const targetNodeId = 'l:ch01_01.start';
    // 撤销栈按当前场景路由。先通过真实节点导航把源场景设为当前，再返回流程画布建链，
    // 验证用户可理解的“打开源场景 → 建链 → 撤销”路径，而不是跨场景隐式撤销。
    await enableTechnicalConnections(page);
    await page.locator(`[data-node-id="s:${sourceSceneId}"]`).click();
    await page.waitForFunction((sceneId) => window.surdetEditorDebug.state.current === sceneId, sourceSceneId);
    await enterFlowMode(page);
    await enableTechnicalConnections(page);
    await page.locator('[data-flow-action="fit-canvas"]').click();
    const beforeLink = await page.evaluate((sceneId) => window.surdetEditorDebug.state.scenes.get(sceneId).text, sourceSceneId);
    const sourceBox = await page.locator(`[data-node-id="s:${sourceSceneId}"]`).boundingBox();
    const targetBox = await page.locator(`[data-node-id="${targetNodeId}"]`).boundingBox();
    assert(sourceBox && targetBox, 'drag-to-link endpoints are not simultaneously reachable after fit');
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 14 });
    await page.mouse.up();
    const expectedJump = '@jump ch01_01.start';
    await page.waitForFunction(({ sceneId, line }) => window.surdetEditorDebug.state.scenes.get(sceneId).text.includes(line), {
      sceneId: sourceSceneId,
      line: expectedJump,
    });
    const afterLink = await page.evaluate((sceneId) => ({
      text: window.surdetEditorDebug.state.scenes.get(sceneId).text,
      status: document.querySelector('#status')?.textContent ?? '',
    }), sourceSceneId);
    assert(afterLink.status.includes('新增剧情跳转') && afterLink.status.includes('可撤销'), `link status is not human-readable: ${afterLink.status}`);
    await page.locator('[data-action="undo"]').click();
    await page.waitForFunction(({ sceneId, text }) => window.surdetEditorDebug.state.scenes.get(sceneId).text === text, {
      sceneId: sourceSceneId,
      text: beforeLink,
    });
    const afterUndo = await page.evaluate((sceneId) => window.surdetEditorDebug.state.scenes.get(sceneId).text, sourceSceneId);
    assert(afterUndo === beforeLink, 'existing undo path did not restore drag-to-link scene text');
    editEvidence = {
      sourceSceneId,
      targetNodeId,
      insertedLine: expectedJump,
      beforeBytes: Buffer.byteLength(beforeLink, 'utf8'),
      afterLinkBytes: Buffer.byteLength(afterLink.text, 'utf8'),
      restored: afterUndo === beforeLink,
      status: afterLink.status,
    };
    pass('drag-link-and-undo', editEvidence);

    const dumpedFiles = await page.evaluate(() => window.__surdetDumpFakeRoot());
    injectedAfter = browserFileMapTreeIdentity(dumpedFiles);
    assert(injectedAfter.sha256 === injectedBefore.sha256, 'fake Starter file tree changed without save');
    pass('fake-project-remains-byte-identical', { before: injectedBefore, after: injectedAfter });

    assert(consoleErrors.length === 0, `browser console errors: ${consoleErrors.join(' | ')}`);
    assert(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`);
    assert(requestFailures.length === 0, `browser request failures: ${requestFailures.join(' | ')}`);
    pass('browser-error-channels-empty');
  } catch (error) {
    failure = errorText(error);
  } finally {
    try {
      if (cdp) await cdp.detach();
    } catch (error) {
      childCleanupFailures.push(`CDP detach: ${errorText(error)}`);
    }
    try {
      await page?.close();
    } catch (error) {
      childCleanupFailures.push(`page close: ${errorText(error)}`);
    }
    try {
      await browser?.close();
    } catch (error) {
      childCleanupFailures.push(`browser close: ${errorText(error)}`);
    }
    await stopServer(server, childCleanupFailures);
    if (port !== null) portReleased = await portIsAvailable(port);
    if (!portReleased) childCleanupFailures.push(`strict port remained occupied: ${port}`);
    if (portReleased && childCleanupFailures.length === 0) {
      pass('isolated-process-cleanup', { port, portReleased, childCleanupFailures: [] });
    }
  }

  const starterAfter = hashProjectTree(starterRoot);
  const stderrLines = serverStderr.join('').split(/\r?\n/).filter(Boolean);
  if (starterAfter.sha256 !== starterBefore.sha256 && failure === null) {
    failure = `original Starter changed: ${starterBefore.sha256} -> ${starterAfter.sha256}`;
  }
  if (stderrLines.length > 0 && failure === null) {
    failure = `Vite stderr was not empty: ${stderrLines.join(' | ')}`;
  }
  if (childCleanupFailures.length > 0 && failure === null) {
    failure = `cleanup failures: ${childCleanupFailures.join(' | ')}`;
  }
  const passedMilestones = new Set(milestones.filter((milestone) => milestone.status === 'passed').map((milestone) => milestone.name));
  const missingMilestones = MILESTONE_IDS.filter((id) => !passedMilestones.has(id));
  if (missingMilestones.length > 0 && failure === null) {
    failure = `missing required milestones: ${missingMilestones.join(', ')}`;
  }

  const evidence = {
    schemaVersion: 1,
    evidenceClass: 'EDITOR_FLOW_CANVAS_BROWSER_DIAGNOSTIC',
    status: failure === null ? 'PASSED' : 'FAILED',
    runner: readFileIdentity(runnerPath),
    repoRoot,
    editorRoot,
    starterRoot,
    artifactDirectory,
    port,
    forbiddenPorts: FORBIDDEN_PORTS,
    portReleased,
    starterBefore,
    starterAfter,
    originalStarterUnchanged: starterBefore.sha256 === starterAfter.sha256,
    injectedBefore,
    injectedAfter,
    opened,
    flowFacts,
    narrativeMapEvidence,
    layoutEvidence,
    controlEvidence,
    navigationEvidence,
    editEvidence,
    screenshots,
    milestones,
    errors: failure === null ? [] : [failure],
    consoleErrors,
    pageErrors,
    requestFailures,
    stderrLines,
    childCleanupFailures,
    serverStdout: serverStdout.join('').split(/\r?\n/).filter(Boolean),
  };
  const evidenceIdentity = writeExclusiveJson(evidencePath, evidence);
  const identity = writeExclusiveJson(identityPath, {
    schemaVersion: 1,
    evidenceClass: evidence.evidenceClass,
    status: evidence.status,
    evidence: evidenceIdentity,
    runner: evidence.runner,
    originalStarterUnchanged: evidence.originalStarterUnchanged,
    portReleased,
  });
  process.stdout.write(`${JSON.stringify({
    status: evidence.status,
    artifactDirectory,
    evidence: evidenceIdentity,
    identity,
    port,
    portReleased,
    milestones: milestones.map(({ name, status }) => ({ name, status })),
    screenshots,
    error: failure,
  }, null, 2)}\n`);
  if (failure !== null) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(runnerPath)) {
  await run();
}
