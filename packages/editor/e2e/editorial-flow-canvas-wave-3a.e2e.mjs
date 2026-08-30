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
  await page.locator('[data-node-id="s:ch01_01"]').waitFor({ state: 'visible' });
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
    const commandRects = [...document.querySelectorAll('[data-flow-action]')].map((button) => {
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
      commandRects,
    };
  });
}

function assertFlowLayout(layout, expectedWidth, expectedNodeCount) {
  assert(layout.viewport.width === expectedWidth, `viewport width ${layout.viewport.width} != ${expectedWidth}`);
  assert(layout.pageWidth.client === layout.pageWidth.scroll, `${expectedWidth}: horizontal page overflow`);
  for (const [name, region] of Object.entries({
    workbench: layout.workbench,
    status: layout.status,
    toolbar: layout.toolbar,
    canvas: layout.canvas,
    legend: layout.legend,
    minimap: layout.minimap,
    svg: layout.svg,
  })) {
    assert(region?.visible, `${expectedWidth}: ${name} region is not visible`);
    assert(region.left >= -0.5 && region.right <= expectedWidth + 0.5, `${expectedWidth}: ${name} escapes horizontally`);
  }
  assert(layout.canvas.height >= 260, `${expectedWidth}: flow canvas height ${layout.canvas.height} is not usable`);
  assert(layout.svg.width >= 360, `${expectedWidth}: flow svg width ${layout.svg.width} is not usable`);
  assert(!rectanglesOverlap(layout.status, layout.canvas), `${expectedWidth}: status overlaps graph canvas`);
  assert(!rectanglesOverlap(layout.toolbar, layout.canvas), `${expectedWidth}: toolbar overlaps graph canvas`);
  assert(!rectanglesOverlap(layout.legend, layout.minimap), `${expectedWidth}: legend overlaps minimap`);
  const requiredCommands = ['zoom-out', 'zoom-in', 'fit-canvas', 'focus-current'];
  for (const action of requiredCommands) {
    const command = layout.commandRects.find((item) => item.action === action);
    assert(command, `${expectedWidth}: missing ${action} command`);
    assert(command.width > 0 && command.height > 0, `${expectedWidth}: ${action} command is unreachable`);
    assert(command.left >= -0.5 && command.right <= expectedWidth + 0.5, `${expectedWidth}: ${action} command escapes horizontally`);
  }
  assert(layout.nodeRects.length === expectedNodeCount, `${expectedWidth}: fit rendered ${layout.nodeRects.length}/${expectedNodeCount} nodes`);
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
    const edgeLabels = [...document.querySelectorAll('[data-flow-world] .flow-edge-label')].map((label) => {
      const surfaceElement = label.previousElementSibling;
      const surface = surfaceElement?.classList.contains('flow-edge-label-surface') ? rect(surfaceElement) : null;
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
    const longestChineseEdge = edgeLabels.filter((label) => cjk.test(label.text)).sort((a, b) => b.text.length - a.text.length)[0] ?? null;
    return { nodes, edgeLabels, longestChineseNode, longestChineseEdge };
  });
}

function assertTextGeometry(evidence) {
  const nodeLabels = evidence.nodes.flatMap((node) => node.labels);
  assert(nodeLabels.length > 0, 'flow nodes expose no visible label geometry');
  assert(evidence.edgeLabels.length > 0, 'flow edges expose no visible label geometry');
  assert(evidence.longestChineseNode, 'no Chinese node label was measured');
  assert(evidence.longestChineseEdge, 'no Chinese edge label was measured');
  assert(nodeLabels.every((label) => label.contained), 'a node label escapes its node surface');
  assert(evidence.edgeLabels.every((label) => label.contained), 'an edge label escapes its label surface');
  assert(evidence.edgeLabels.every((label) => label.textPointerEvents === 'none' && label.surfacePointerEvents === 'none'), 'edge labels intercept pointer input');
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
    };
  });
}

async function scrollFlowCommandsIntoVisualViewport(page) {
  await page.locator('[data-flow-action="zoom-out"]').evaluate((firstCommand) => new Promise((resolve) => {
    firstCommand.scrollIntoView({ block: 'center', inline: 'start', behavior: 'instant' });
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.locator('[data-flow-action="toggle-legend"]').evaluate((lastCommand) => new Promise((resolve) => {
    lastCommand.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
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
    const commandBoxes = [...document.querySelectorAll('[data-flow-action]')].map((command) => {
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
  assert(evidence, 'page-scale visual viewport is unavailable');
  assert(evidence.toolbarVisual, 'Flow toolbar has no page-scale geometry');
  assert(evidence.commandBoxes.length === 5, `page-scale Flow command count ${evidence.commandBoxes.length}`);
  assert(evidence.commandBoxes.every((command) => command.horizontallyVisible), 'a Flow command is horizontally outside the page-scale visual viewport');
  assert(evidence.commandBoxes.every((command) => command.verticallyVisible), 'a Flow command is vertically outside the page-scale visual viewport');
}

async function inspectRealFlowFacts(page) {
  return page.evaluate(() => {
    const workbench = document.querySelector('[data-editor-region="flow-workbench"]');
    const status = document.querySelector('[data-editor-region="flow-status"]');
    const legend = document.querySelector('[data-editor-region="flow-legend"]');
    const nodes = [...document.querySelectorAll('[data-flow-node-kind]')];
    const edges = [...document.querySelectorAll('[data-flow-world] .flow-edge[data-flow-edge-kind]')];
    const nodeKinds = Object.fromEntries(['scene', 'label', 'host-entry'].map((kind) => [
      kind,
      nodes.filter((node) => node.getAttribute('data-flow-node-kind') === kind).length,
    ]));
    const edgeKinds = [...new Set(edges.map((edge) => edge.getAttribute('data-flow-edge-kind')).filter(Boolean))].sort();
    const currentNodes = nodes.filter((node) => node.getAttribute('aria-current') === 'true');
    const statusText = status?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const statusNodeCount = Number(/节点\s*(\d+)/.exec(statusText)?.[1] ?? Number.NaN);
    const statusEdgeCount = Number(/连接\s*(\d+)/.exec(statusText)?.[1] ?? Number.NaN);
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
      conditionalChoicePresent: [...workbench?.querySelectorAll('text, title, [aria-label]') ?? []]
        .some((element) => `${element.textContent ?? ''} ${element.getAttribute?.('aria-label') ?? ''}`.includes('hasSword')),
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
  assert(facts.nodeKinds.scene === 4, `expected four real Starter scenes, got ${facts.nodeKinds.scene}`);
  assert(facts.nodeKinds.label === 6, `expected six real Starter labels, got ${facts.nodeKinds.label}`);
  assert(facts.nodeKinds['host-entry'] >= 2, `expected real configuration entry nodes, got ${facts.nodeKinds['host-entry']}`);
  assert(facts.choiceCount === 3, `expected three real choice edges, got ${facts.choiceCount}`);
  assert(facts.focusableNodeCount === facts.nodeCount, 'not every real flow node is keyboard focusable');
  assert(facts.currentNodeIds.length === 1 && facts.currentNodeIds[0] === 's:ch01_01', 'current scene node is not explicit');
  assert(facts.statusNodeCount === facts.nodeCount, `status node count ${facts.statusNodeCount} != rendered real nodes ${facts.nodeCount}`);
  assert(facts.statusEdgeCount === 22, `expected 22 real Starter graph connections, got ${facts.statusEdgeCount}`);
  assert(facts.renderedEdgeCount >= 20 && facts.renderedEdgeCount <= facts.statusEdgeCount, `rendered connection paths ${facts.renderedEdgeCount} are inconsistent with graph count ${facts.statusEdgeCount}`);
  assert(/段落\s*start/.test(facts.labelStartText), `label node is not Chinese-first: ${facts.labelStartText}`);
  assert(/项目入口|由项目配置触发/.test(facts.hostText), `host node is not Chinese-first: ${facts.hostText}`);
  assert(facts.conditionalChoicePresent, 'real hasSword choice condition is not visible or accessible');
  for (const term of ['场景', '段落标记', '项目入口', '选项', '条件']) {
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
    assert(opened.sceneCount === 4, `expected four real Starter scenes, got ${opened.sceneCount}`);
    assert(opened.timelineCount === 3, `expected three real Starter timelines, got ${opened.timelineCount}`);
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
    pass('real-node-edge-content', {
      nodeKinds: flowFacts.nodeKinds,
      edgeKinds: flowFacts.edgeKinds,
      choiceCount: flowFacts.choiceCount,
      currentNodeIds: flowFacts.currentNodeIds,
      labelStartText: flowFacts.labelStartText,
      hostText: flowFacts.hostText,
      conditionalChoicePresent: flowFacts.conditionalChoicePresent,
    });

    const textGeometry = await inspectTextGeometry(page);
    assertTextGeometry(textGeometry);
    pass('text-label-geometry-safe', {
      nodeLabelCount: textGeometry.nodes.reduce((count, node) => count + node.labels.length, 0),
      edgeLabelCount: textGeometry.edgeLabels.length,
      longestChineseNode: textGeometry.longestChineseNode,
      longestChineseEdge: textGeometry.longestChineseEdge,
      edgeLabelsIgnorePointerInput: textGeometry.edgeLabels.every((label) => label.textPointerEvents === 'none' && label.surfacePointerEvents === 'none'),
    });

    layoutEvidence = {};
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.locator('[data-flow-action="fit-canvas"]').click();
      const legendMode = await ensureLegendReachable(page);
      const layout = await inspectFlowLayout(page);
      layoutEvidence[viewport.id] = { ...layout, legendMode };
      await takeScreenshot(page, artifactDirectory, `flow-${viewport.id}`, screenshots);
      assertFlowLayout(layout, viewport.width, flowFacts.nodeCount);
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
    await page.locator('[data-flow-action="fit-canvas"]').click();
    const pageScaleLegendMode = await ensureLegendReachable(page);
    const pageScaleBaseline = await inspectFlowLayout(page);
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await page.waitForFunction(() => Math.abs((window.visualViewport?.scale ?? 1) - 2) < 0.05);
    await scrollFlowCommandsIntoVisualViewport(page);
    const scaledZoom = page.locator('[data-flow-action="zoom-in"]');
    await scaledZoom.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-flow-action') === 'zoom-in');
    const beforeScaledFit = await worldTransform(page);
    await scrollFlowCommandsIntoVisualViewport(page);
    const scaledFit = page.locator('[data-flow-action="fit-canvas"]');
    await scaledFit.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-flow-action') === 'fit-canvas');
    const afterScaledFit = await worldTransform(page);
    assert(transformChanged(beforeScaledFit, afterScaledFit), 'fit-canvas was not actually activated at page scale 2');
    await scrollFlowCommandsIntoVisualViewport(page);
    const pageScaleCommandGeometry = await inspectPageScaleCommandGeometry(page);
    assertPageScaleCommandGeometry(pageScaleCommandGeometry);
    assert(pageScaleCommandGeometry.activeAction === 'fit-canvas', 'page-scale fit action lost keyboard focus');
    const pageScaleLayout = await inspectFlowLayout(page);
    layoutEvidence.pageScaleCommandReachability = {
      baseline: pageScaleBaseline,
      scaled: pageScaleLayout,
      commandGeometry: pageScaleCommandGeometry,
      legendMode: pageScaleLegendMode,
    };
    assertFlowLayout(pageScaleLayout, 800, flowFacts.nodeCount);
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
    assert(visibleAfterFit === flowFacts.nodeCount, `fit-canvas kept only ${visibleAfterFit}/${flowFacts.nodeCount} nodes in reach`);
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
    const legendToggle = page.locator('[data-flow-action="toggle-legend"]');
    await legendToggle.focus();
    const legendBefore = await flowGeometrySnapshot(page);
    await page.evaluate(() => {
      window.__wave3aLegendGeometryRefs = {
        canvas: document.querySelector('[data-editor-region="flow-canvas"]'),
        minimap: document.querySelector('[data-editor-region="flow-minimap"]'),
      };
    });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-editor-region="flow-legend"]')?.hasAttribute('hidden') === true);
    const legendCollapsed = await flowGeometrySnapshot(page);
    const collapsedRecomputed = await page.evaluate(() => ({
      oldCanvasConnected: window.__wave3aLegendGeometryRefs.canvas?.isConnected ?? null,
      oldMinimapConnected: window.__wave3aLegendGeometryRefs.minimap?.isConnected ?? null,
    }));
    assert(collapsedRecomputed.oldCanvasConnected === false && collapsedRecomputed.oldMinimapConnected === false, 'legend collapse did not rebuild canvas and minimap geometry');
    assert(legendCollapsed.legendHidden === true, 'legend did not collapse');
    assert(legendCollapsed.canvas?.width > 0 && legendCollapsed.canvas?.height > 0, 'collapsed canvas geometry is unusable');
    assert(legendCollapsed.minimap?.width > 0 && legendCollapsed.minimap?.height > 0 && legendCollapsed.minimapViewport, 'collapsed minimap geometry is unusable');
    assert(legendCollapsed.activeAction === 'toggle-legend', 'legend collapse did not restore toolbar focus');
    await page.evaluate(() => {
      window.__wave3aLegendGeometryRefs = {
        canvas: document.querySelector('[data-editor-region="flow-canvas"]'),
        minimap: document.querySelector('[data-editor-region="flow-minimap"]'),
      };
    });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-editor-region="flow-legend"]')?.hasAttribute('hidden') === false);
    const legendExpandedGeometry = await flowGeometrySnapshot(page);
    const expandedRecomputed = await page.evaluate(() => {
      const result = {
        oldCanvasConnected: window.__wave3aLegendGeometryRefs.canvas?.isConnected ?? null,
        oldMinimapConnected: window.__wave3aLegendGeometryRefs.minimap?.isConnected ?? null,
      };
      delete window.__wave3aLegendGeometryRefs;
      return result;
    });
    assert(expandedRecomputed.oldCanvasConnected === false && expandedRecomputed.oldMinimapConnected === false, 'legend expansion did not rebuild canvas and minimap geometry');
    assert(legendExpandedGeometry.legendHidden === false, 'legend did not expand');
    assert(legendExpandedGeometry.canvas?.width > 0 && legendExpandedGeometry.canvas?.height > 0, 'expanded canvas geometry is unusable');
    assert(legendExpandedGeometry.minimap?.width > 0 && legendExpandedGeometry.minimap?.height > 0 && legendExpandedGeometry.minimapViewport, 'expanded minimap geometry is unusable');
    assert(legendExpandedGeometry.activeAction === 'toggle-legend', 'legend expansion did not restore toolbar focus');
    pass('legend-geometry-recomputed', {
      before: legendBefore,
      collapsed: { ...legendCollapsed, ...collapsedRecomputed },
      expanded: { ...legendExpandedGeometry, ...expandedRecomputed },
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
    await page.locator('[data-flow-action="fit-canvas"]').click();
    await keyboardOpenFlowNode(page, 'l:ch01_01.answer_silence', 'Enter');
    await page.locator('.manuscript-sheet[data-scene-id="ch01_01"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.surdetEditorDebug?.state?.current === 'ch01_01');
    const enterNavigation = await page.evaluate(() => ({
      mainTab: window.surdetEditorDebug?.state?.mainTab ?? null,
      current: window.surdetEditorDebug?.state?.current ?? null,
      selectedLine: document.querySelector('#editor .block[aria-selected="true"]')?.getAttribute('data-line') ?? null,
    }));
    assert(enterNavigation.mainTab === 'editor' && enterNavigation.current === 'ch01_01', 'Enter navigation did not open ch01_01');
    assert(enterNavigation.selectedLine === '29', `Enter navigation selected zero-based line ${enterNavigation.selectedLine}`);

    await enterFlowMode(page);
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
    const minimapClickRelative = { x: 0.72, y: 0.32 };
    const minimapClick = {
      x: minimapBox.x + minimapBox.width * minimapClickRelative.x,
      y: minimapBox.y + minimapBox.height * minimapClickRelative.y,
    };
    await page.mouse.click(minimapClick.x, minimapClick.y);
    const afterMinimap = await worldTransform(page);
    assert(transformChanged(beforeMinimap, afterMinimap), 'minimap navigation did not update existing flow view');
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
      minimapClickRelative,
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

    const sourceSceneId = 'ch03_turn_event';
    const targetNodeId = 'l:ch01_01.start';
    // 撤销栈按当前场景路由。先通过真实节点导航把源场景设为当前，再返回流程画布建链，
    // 验证用户可理解的“打开源场景 → 建链 → 撤销”路径，而不是跨场景隐式撤销。
    await page.locator(`[data-node-id="s:${sourceSceneId}"]`).click();
    await page.waitForFunction((sceneId) => window.surdetEditorDebug.state.current === sceneId, sourceSceneId);
    await enterFlowMode(page);
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
  process.stdout.write(`${JSON.stringify({
    status: evidence.status,
    artifactDirectory,
    evidence: evidenceIdentity,
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
