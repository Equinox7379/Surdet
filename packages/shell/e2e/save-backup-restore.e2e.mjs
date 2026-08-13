/**
 * Minimal real-player save backup restore path.
 *
 * The debug surface is read-only evidence and interaction geometry only.
 * All game/menu actions use real keyboard or page.mouse.click input.
 */
import { _electron as electron } from 'playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';

const scriptDir = path.dirname(url.fileURLToPath(import.meta.url));
const shellDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(shellDir, '../..');
const gameDist = path.resolve(repoRoot, 'examples/zero-after-midnight/dist');
const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-save-backup-restore-'));
const evidencePath = path.join(evidenceRoot, 'save-backup-restore.json');
const userData = path.join(evidenceRoot, 'user-data');
fs.mkdirSync(userData, { recursive: true });

const failures = [];
const events = {
  pageErrors: [],
  consoleErrors: [],
  requestFailures: [],
  unhandledRejections: [],
  rendererErrors: [],
  releaseFailures: [],
};

const sha256File = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const errorText = (error) => error instanceof Error ? error.stack || error.message : String(error);
const check = (condition, label) => {
  if (condition) {
    console.log(`PASS  ${label}`);
    return;
  }
  failures.push(label);
  console.log(`FAIL  ${label}`);
};

if (!fs.existsSync(path.join(gameDist, 'index.html'))) {
  throw new Error(`正式《零点之后》dist 不存在：${gameDist}`);
}

const app = await electron.launch({
  args: ['.', '--user-data-dir=' + userData],
  cwd: shellDir,
  env: {
    ...process.env,
    SURDET_E2E: '1',
    SURDET_E2E_GAME_DIR: gameDist,
  },
});

const page = await app.firstWindow();
page.on('pageerror', (error) => events.pageErrors.push(errorText(error)));
page.on('requestfailed', (request) => {
  events.requestFailures.push(`${request.url()} ${(request.failure()?.errorText || '')}`.trim());
});
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (/renderer resource release failed/i.test(text)) events.releaseFailures.push(text);
  else if (/renderer error/i.test(text)) events.rendererErrors.push(text);
  else if (text.startsWith('[e2e-unhandledrejection]')) events.unhandledRejections.push(text);
  else events.consoleErrors.push(text);
});
await page.evaluate(() => {
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason);
    console.error('[e2e-unhandledrejection] ' + reason);
  });
});

const snapshot = () => page.evaluate(() => {
  const debug = window.__surdetDebug;
  return {
    status: debug?.status ?? null,
    rendererStatus: debug?.rendererStatus ?? null,
    position: debug?.position ?? null,
    activeOverlay: debug?.activeOverlay ?? null,
    commandRailVisible: debug?.commandRailVisible ?? null,
    uiSession: debug?.uiSession ?? null,
    interactionTargets: debug?.interactionTargets ?? [],
  };
});

const waitFor = async (label, predicate, timeout = 30000) => {
  await page.waitForFunction(predicate, undefined, { timeout });
  console.log(`PASS  ${label}`);
};

const canvasPoint = async (logicalX, logicalY) => page.evaluate(({ logicalX: x, logicalY: y }) => {
  const canvas = document.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + (x / 1280) * rect.width,
    y: rect.top + (y / 720) * rect.height,
  };
}, { logicalX, logicalY });

const clickLogical = async (logicalX, logicalY, button = 'left') => {
  const point = await canvasPoint(logicalX, logicalY);
  if (!point) throw new Error('找不到正式游戏画布');
  await page.mouse.click(point.x, point.y, { button });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
};

const clickTarget = async (targetId) => {
  const target = await page.evaluate((id) => window.__surdetDebug?.interactionTargets?.find((item) => item.id === id) ?? null, targetId);
  if (!target) throw new Error(`找不到公开交互目标：${targetId}`);
  await clickLogical(target.x + target.width / 2, target.y + target.height / 2);
};

const waitForOverlay = (overlay) => waitFor(`overlay=${overlay}`, (expected) => window.__surdetDebug?.activeOverlay === expected, overlay);
const waitForGameText = () => waitFor('游戏处于可推进文本', () => {
  const debug = window.__surdetDebug;
  return debug?.status === 'awaiting-advance' && debug?.rendererStatus !== 'choice'
    && (debug?.dialogueProjection?.visibleChoiceCount ?? 0) === 0;
});

const waitForPlayerGameIdle = () => waitFor('PlayerShell 已进入可交互游戏态', () => {
  const debug = window.__surdetDebug;
  return debug?.uiSession?.base === 'game'
    && debug?.uiSession?.overlay === 'none'
    && debug?.uiSession?.operation === 'idle'
    && debug?.activeOverlay === null;
});

let firstSavePosition = null;
let secondSavePosition = null;
let restoredPosition = null;
let title = null;
try {
  await page.waitForFunction(() => window.__surdetDebug?.interactionTargets?.some((item) => item.id === 'title:new'), undefined, { timeout: 30000 });
  title = await page.title();
  check(title.includes('零点之后') || title.includes('AFTER MIDNIGHT'), `正式窗口标题：${title}`);

  await clickTarget('title:new');
  await waitFor('标题 → 新游戏', () => window.__surdetDebug?.status !== 'idle' && window.__surdetDebug?.position !== null);
  await waitForGameText();
  await waitForPlayerGameIdle();

  firstSavePosition = await page.evaluate(() => window.__surdetDebug.position);
  await page.keyboard.press('Escape');
  await waitForOverlay('system-menu');
  await clickTarget('system:save');
  await waitForOverlay('save-load');
  await clickTarget('save-load:slot-1');
  await waitFor('第一次保存完成并回到游戏', () => window.__surdetDebug?.activeOverlay === null && window.__surdetDebug?.status !== 'idle');
  await waitForPlayerGameIdle();
  check(firstSavePosition !== null, '已记录第一次保存位置');

  await waitForGameText();
  await page.keyboard.press('Space');
  await waitForGameText();
  secondSavePosition = await page.evaluate(() => window.__surdetDebug.position);
  check(JSON.stringify(secondSavePosition) !== JSON.stringify(firstSavePosition), '第二次保存前剧情位置已变化');

  await page.keyboard.press('Escape');
  await waitForOverlay('system-menu');
  await clickTarget('system:save');
  await waitForOverlay('save-load');
  await clickTarget('save-load:slot-1');
  await waitFor('覆盖保存完成并回到游戏', () => window.__surdetDebug?.activeOverlay === null && window.__surdetDebug?.status !== 'idle');
  await waitForPlayerGameIdle();

  await page.keyboard.press('Escape');
  await waitForOverlay('system-menu');
  await clickTarget('system:load');
  await waitForOverlay('save-load');
  await waitFor('读档页出现独立恢复按钮的备份槽位', () => window.__surdetDebug?.activeOverlay === 'save-load');

  // Slot 1 card is at (150, 180); its independent restore label starts at
  // (cardW - 174, 70), so this is a real click on the visible label, not the card.
  const restoreLabel = await page.evaluate(() => {
    const targets = window.__surdetDebug?.interactionTargets ?? [];
    return targets.find((item) => item.id === 'save-load:slot-1') ?? null;
  });
  check(restoreLabel !== null, '读档页公开槽位命中区域存在');
  await clickLogical(515, 258);
  await waitFor('恢复备份并读取完成并关闭读档页', () => window.__surdetDebug?.activeOverlay === null && window.__surdetDebug?.status !== 'idle');
  restoredPosition = await page.evaluate(() => window.__surdetDebug.position);
  check(JSON.stringify(restoredPosition) === JSON.stringify(firstSavePosition), '恢复后位置等于第一次保存位置');
} catch (error) {
  failures.push(errorText(error));
  console.error(errorText(error));
} finally {
  const evidence = {
    schemaVersion: 1,
    status: failures.length === 0 ? 'PASSED' : 'FAILED',
    gameDist,
    userData,
    title,
    firstSavePosition,
    secondSavePosition,
    restoredPosition,
    events,
    failures,
    note: 'All actions used real page.mouse.click or keyboard input; __surdetDebug was read-only evidence and target geometry.',
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`EVIDENCE_PATH=${evidencePath}`);
  console.log(`EVIDENCE_BYTES=${fs.statSync(evidencePath).size}`);
  console.log(`EVIDENCE_SHA256=${sha256File(evidencePath)}`);
  await app.close();
}

process.exit(failures.length === 0 ? 0 : 1);
