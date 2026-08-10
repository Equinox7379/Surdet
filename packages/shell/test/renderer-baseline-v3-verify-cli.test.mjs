import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const shellDir = path.resolve(testDir, '..');
const repositoryRoot = path.resolve(shellDir, '../..');
const verifyScript = path.join(shellDir, 'e2e', 'renderer-baseline-v3-verify.mjs');
const baselineArtifact = path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v3-m8-ab-2026-08-10.json');
const currentArtifact = path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v3-m8-final-remediation-ab-2026-08-10.json');

function runVerifier(args) {
  const result = spawnSync(process.execPath, [verifyScript, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  return {
    ...result,
    output: String(result.stdout ?? '') + String(result.stderr ?? ''),
  };
}

function expectedFailures(filePath) {
  const artifact = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return artifact.comparison.failures.map((failure) => failure.metric).join(',');
}

describe('renderer v3 artifact verifier CLI', () => {
  it('validates only the explicitly requested A artifact', () => {
    const result = runVerifier(['--artifact', baselineArtifact]);

    expect(result.status).toBe(2);
    expect(result.output).toContain('artifactPath=' + path.resolve(baselineArtifact));
    expect(result.output).toContain('formalFailures=' + expectedFailures(baselineArtifact));
    expect(result.output).toContain('VALID ARTIFACT');
    expect(result.output).toContain('FORMAL GATE FAIL');
    expect(result.output).not.toContain(path.resolve(currentArtifact));
  });

  it('validates only the explicitly requested B artifact', () => {
    const result = runVerifier(['--artifact', currentArtifact]);

    expect(result.status).toBe(2);
    expect(result.output).toContain('artifactPath=' + path.resolve(currentArtifact));
    expect(result.output).toContain('formalFailures=assetReadyMs,sceneP95Ms');
    expect(result.output).toContain('baselineCommit=007438b569ec95350fdc9d7882ad49f55bbb7968');
    expect(result.output).toContain('currentCommit=db12cb02083c64e750527283ada2aceb10d30597');
    expect(result.output).not.toContain(path.resolve(baselineArtifact));
  });

  it('rejects a tampered B artifact instead of reporting a formal result', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-v3-verify-cli-'));
    const tamperedPath = path.join(repositoryRoot, 'docs', 'baselines', '.verify-cli-' + path.basename(tempRoot) + '.json');
    try {
      const value = JSON.parse(fs.readFileSync(currentArtifact, 'utf8'));
      value.comparison.failures = [];
      fs.writeFileSync(tamperedPath, JSON.stringify(value), 'utf8');

      const result = runVerifier(['--artifact', tamperedPath]);

      expect(result.status).toBe(1);
      expect(result.output).not.toContain('VALID ARTIFACT');
      expect(result.output).toContain('Renderer v3');
    } finally {
      fs.rmSync(tamperedPath, { force: true });
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['missing artifact', []],
    ['unknown option', ['--no-such-option', currentArtifact]],
    ['duplicate artifact', ['--artifact', currentArtifact, '--artifact', currentArtifact]],
    ['extra positional argument', ['--artifact', currentArtifact, 'unexpected']],
  ])('rejects %s without falling back to the historical candidate', (_label, args) => {
    const result = runVerifier(args);

    expect(result.status).toBe(1);
    expect(result.output).not.toContain('renderer-v3-candidate-2026-08-09.json');
  });
});
