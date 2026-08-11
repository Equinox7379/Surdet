import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(shellRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};
const scriptPath = path.join(shellRoot, 'e2e', 'player-shell-wave-3.e2e.mjs');

describe('Player Shell Foundation Wave 3 Electron contract', () => {
  it('registers a dedicated E2E command and script', () => {
    expect(packageJson.scripts?.['e2e:player-shell-wave-3']).toBe('node e2e/player-shell-wave-3.e2e.mjs');
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  it('pins the formal Zero dist, isolated userData and the A–F evidence schema', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    expect(source).toContain("'zero-after-midnight'");
    expect(source).toContain("'dist'");
    expect(source).toContain('SURDET_E2E_GAME_DIR');
    expect(source).toContain('--user-data-dir=');
    expect(source).toContain('schemaVersion');
    expect(source).toContain('formalGame');
    expect(source).toContain('isolation');
    expect(source).toContain('cases');
    for (const caseId of ['A', 'B', 'C', 'D', 'E', 'F']) {
      expect(source).toMatch(new RegExp(`['\"]${caseId}['\"]`));
    }
  });

  it('records PlayerShell snapshots, registry bindings, Renderer projection/resources and all error channels', () => {
    const source = fs.readFileSync(scriptPath, 'utf8');
    for (const field of [
      'playerShell',
      'bindings',
      'dialogueProjection',
      'resources',
      'pageErrors',
      'consoleErrors',
      'requestFailures',
      'unhandledRejections',
      'releaseFailures',
    ]) {
      expect(source).toContain(field);
    }
  });
});
