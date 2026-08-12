import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(shellRoot, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(shellRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const scriptPath = path.join(shellRoot, 'e2e', 'player-experience-wave-5a-rollback-black-screen.e2e.mjs');
const zeroMainPath = path.join(repoRoot, 'examples', 'zero-after-midnight', 'src', 'main.ts');
const zeroWindowPath = path.join(repoRoot, 'examples', 'zero-after-midnight', 'src', 'surdet-window.d.ts');

describe('Player Experience Wave 5A rollback Electron contract', () => {
  it('registers the dedicated Wave 5A command and runner', () => {
    expect(packageJson.scripts?.['e2e:player-experience:wave5a'])
      .toBe('node e2e/player-experience-wave-5a-rollback-black-screen.e2e.mjs');
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('pins the formal Zero dist and independent userData sessions', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source).toContain("'zero-after-midnight'");
    expect(source).toContain("'dist'");
    expect(source).toContain('SURDET_E2E_GAME_DIR');
    expect(source).toContain('--user-data-dir=');
    expect(source).toContain('examples/zero-after-midnight');
    expect(source).not.toContain('examples/starter/dist');
  });

  it('freezes the 8-session, 20-attempt, five-cycle protocol', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    for (const token of [
      'sessionCount: 8',
      'attemptsPerSession: 20',
      'cycleCount: 5',
      'advancePerCycle: 4',
      'rollbackPerCycle: 4',
      "'settled'",
      "'rapid'",
      'mode ===',
    ]) {
      expect(source).toContain(token);
    }
    expect(source).toContain('for (let sessionIndex = 0; sessionIndex < protocol.sessionCount; sessionIndex += 1)');
    expect(source).toContain('page.mouse.click');
  });

  it('records the complete rollback snapshot and failure evidence contract', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    for (const field of [
      'schemaVersion',
      'head',
      'sourceRoot',
      'distRoot',
      'sessions',
      'position',
      'rendererStatus',
      'uiSession',
      'activeOverlay',
      'backgroundKey',
      'portraits',
      'cameraScale',
      'cameraPan',
      'fadeAlpha',
      'tint',
      'particleKind',
      'timelines',
      'dialogueProjection',
      'resourceSnapshot',
      'resourceLedger',
      'lastRendererError',
      'canvasPngHash',
      'canvasWidth',
      'canvasHeight',
      'meanLuma',
      'blackPixelRatio',
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
    expect(source).toContain('errorStack');
  });

  it('exposes the existing renderer resource ledger through the formal Zero read-only debug surface', () => {
    const mainSource = fs.readFileSync(zeroMainPath, 'utf8');
    const windowSource = fs.readFileSync(zeroWindowPath, 'utf8');
    expect(mainSource).toContain('get resourceLedger()');
    expect(mainSource).toContain('queries.diagnostics.resourceLedger?.()');
    expect(windowSource).toContain('resourceLedger');
  });

  it('uses real player input and does not call debug actions or mutate interpreter position', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source).toContain('page.mouse.click');
    expect(source).toContain('page.keyboard.press');
    expect(source).not.toContain('performRollback(');
    expect(source).not.toContain('titleSelect(');
    expect(source).not.toContain('interpreter.position =');
    expect(source).not.toContain('debug.action');
  });
});
