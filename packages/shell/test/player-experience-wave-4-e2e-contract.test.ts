import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(shellRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const scriptPath = path.join(shellRoot, 'e2e', 'player-experience-wave-4.e2e.mjs');

describe('Player Experience Wave 4 Electron contract', () => {
  it('registers the dedicated Wave 4 command and runner', () => {
    expect(packageJson.scripts?.['e2e:player-experience:wave4']).toBe('node e2e/player-experience-wave-4.e2e.mjs');
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('pins the formal Zero dist, isolated userData and smoke/case entry points', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source).toContain("'zero-after-midnight'");
    expect(source).toContain("'dist'");
    expect(source).toContain('SURDET_E2E_GAME_DIR');
    expect(source).toContain('--user-data-dir=');
    expect(source).toContain('--smoke');
    expect(source).toContain('--case');
    expect(source).not.toContain('examples/starter/dist');
  });

  it('declares the Wave 4 artifact schema and six required error channels', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    for (const field of [
      'schemaVersion',
      'sourceRoot',
      'distRoot',
      'cases',
      'pageErrors',
      'consoleErrors',
      'requestFailures',
      'unhandledRejections',
      'rendererErrors',
      'releaseFailures',
    ]) {
      expect(source).toContain(field);
    }
    for (const caseId of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) {
      expect(source).toContain(`'${caseId}'`);
    }
    expect(source).toContain("git', ['rev-parse', 'HEAD']");
    expect(source).toContain('captureCanvas');
    expect(source).toContain('screenshotSha256');
    expect(source).toContain('pixelHash');
    expect(source).toContain('pixelHashMethod');
    expect(source).toContain('errorStack');
    expect(source).not.toContain('showTitleScreen(');
  });

  it('uses real Playwright mouse input in the runner contract', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source).toContain('page.mouse.click');
    expect(source).not.toContain('titleSelect(');
    expect(source).not.toContain('commands.gallery');
  });

  it('records per-case identity and completed asset evidence', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source).toContain('caseEvidence(');
    expect(source).toContain('assetComplete');
    expect(source).toContain('title: identity.title');
    expect(source).toContain('sourceRoot: gameSourceRoot');
    expect(source).toContain('distRoot: path.resolve(gameDist)');
    expect(source).toContain('assetLoading: identity.assetLoading');
  });

  it('requires visible portrait, long-form progression, and real fullscreen click evidence', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source).toContain('portraits.length >= 1');
    expect(source).toContain('portraitProjection');
    expect(source).toContain('index < 20');
    expect(source).toContain('story:advance×${progression.length}');
    expect(source).toContain('commandRailAlphaSamples');
    expect(source).toContain('await session.clickTarget(\'rail:menu\')');
    expect(source).toContain("await session.waitOverlay('system-menu')");
    expect(source).toContain("await session.clickTarget('system:resume')");
    expect(source).toContain('fullscreen');
    expect(source).toContain('lastSnapshot: cloneJson(session?.lastSnapshot)');
    expect(source).toContain('errorStack');
    expect(source).toContain("git', ['rev-parse', 'HEAD']");
  });
});
