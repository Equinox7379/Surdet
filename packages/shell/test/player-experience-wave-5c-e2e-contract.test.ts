import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(shellRoot, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(shellRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const scriptPath = path.join(shellRoot, 'e2e', 'player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs');
const zeroMainPath = path.join(repoRoot, 'examples', 'zero-after-midnight', 'src', 'main.ts');

function runnerSource() {
  return fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
}

describe('Player Experience Wave 5C rollback restore atomicity contract', () => {
  it('registers the dedicated command and runner', () => {
    expect(packageJson.scripts?.['e2e:player-experience:wave5c'])
      .toBe('node e2e/player-experience-wave-5c-rollback-restore-atomicity.e2e.mjs');
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('pins the formal Zero dist and isolated Electron sessions', () => {
    const source = runnerSource();
    expect(source).toContain("'zero-after-midnight'");
    expect(source).toContain("'dist'");
    expect(source).toContain('SURDET_E2E_GAME_DIR');
    expect(source).toContain('--user-data-dir=');
    expect(source).toContain('examples/zero-after-midnight');
    expect(source).toContain('tempUserData');
    expect(source).not.toContain('examples/starter/dist');
  });

  it('freezes the two-case bounded rollback diagnostic protocol', () => {
    const source = runnerSource();
    for (const token of [
      "'prologue-rapid-rollback'",
      "'common-0017-choice-rollback'",
      'rollbackCount: 12',
      'maxSessions: 2',
      'maxValidRollbacks: 14',
      'maxRegularScreenshots: 8',
      "rollbackInput: 'rail:rollback'",
      "'rail:rollback'",
      "'choice:0'",
      'page.mouse.click',
      'page.keyboard.press',
      'validHistory',
      'firstAnomaly',
    ]) {
      expect(source).toContain(token);
    }
    expect(source).toContain('rapid');
    expect(source).toContain('settled');
  });

  it('records rollback visual, choice, resource and error evidence', () => {
    const source = runnerSource();
    for (const field of [
      'schemaVersion',
      'head',
      'sourceRoot',
      'distRoot',
      'protocol',
      'cases',
      'position',
      'interpreterStatus',
      'rendererStatus',
      'uiSession',
      'activeOverlay',
      'backgroundKey',
      'portraits',
      'fadeAlpha',
      'tint',
      'worldAlpha',
      'flash',
      'wipe',
      'activeTransition',
      'choiceVisibleCount',
      'choiceLabels',
      'choiceBounds',
      'fadeTweenActive',
      'canCaptureRollbackCheckpoint',
      'rollbackInput',
      'caseEvidence',
      'resourceSnapshot',
      'resourceLedger',
      'lastRendererError',
      'canvasPngHash',
      'meanLuma',
      'blackPixelRatio',
      'frameSamples',
      'pageErrors',
      'consoleErrors',
      'requestFailures',
      'unhandledRejections',
      'rendererErrors',
      'releaseFailures',
      'failureMessage',
      'failureStack',
      'screenshots',
    ]) {
      expect(source).toContain(field);
    }
    expect(source).toContain("git', ['rev-parse', 'HEAD']");
    expect(source).toContain('sha256');
    expect(source).toContain('screenshotSha256');
    expect(source).toContain('pixelHash');
    expect(source).toContain('visualThumbnail');
  });

  it('keeps Core awaiting-choice distinct from Renderer choice', () => {
    const source = runnerSource();
    expect(source).toContain("debug?.status === 'awaiting-choice'");
    expect(source).toContain("window.__surdetDebug?.rendererStatus === 'choice'");
    expect(source).not.toContain("debug?.status === 'choice'");
    expect(source).not.toContain("window.__surdetDebug?.status === 'choice'");
    expect(source).not.toContain("snapshot?.interpreterStatus === 'choice'");
    expect(source).not.toContain("current?.interpreterStatus === 'choice'");
  });

  it('uses real player input and forbids debug or direct interpreter shortcuts', () => {
    const source = runnerSource();
    expect(source).toContain('page.mouse.click');
    expect(source).toContain('page.keyboard.press');
    expect(source).toContain("clickTarget('rail:rollback'");
    expect(source).not.toContain('performRollback(');
    expect(source).not.toContain('titleSelect(');
    expect(source).not.toContain('interpreter.position =');
    expect(source).not.toContain('debug.action');
    expect(source).not.toContain('showTitleScreen(');
  });

  it('keeps screenshots in the system temporary directory and bounds capture', () => {
    const source = runnerSource();
    expect(source).toContain('os.tmpdir()');
    expect(source).toContain('captureScreenshot');
    expect(source).toContain('start');
    expect(source).toContain('end');
    expect(source).toContain('firstAnomaly');
    expect(source).not.toMatch(/captureScreenshot\([^)]*rollback/i);
    expect(source).not.toContain('screenshots/rollback-');
  });

  it('requires the existing read-only renderer diagnostics only', () => {
    const mainSource = fs.readFileSync(zeroMainPath, 'utf8');
    expect(mainSource).not.toContain('interpreter.position =');
    expect(mainSource).toContain('__surdetDebug');
    expect(mainSource).toContain('presentationSnapshot');
    expect(mainSource).toContain('canCaptureRollbackCheckpoint');
    expect(mainSource).toContain('fadeTweenActive');
    expect(mainSource).toContain('choiceBounds');
    expect(mainSource).toContain('visualThumbnail');
  });
});
