import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RENDERER_STARTUP_DIAGNOSTIC_SCHEMA_VERSION,
  rendererStartupSourceRelativePath,
  applyRendererStartupInstrumentation,
  parseRendererStartupDiagnosticArgs,
  transformRendererStartupSource,
  validateRendererStartupDiagnosticSnapshot,
} from '../e2e/renderer-startup-diagnostic-instrumentation.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const starterSourcePath = path.join(repositoryRoot, rendererStartupSourceRelativePath);
const legacyStarterCommit = '007438b569ec95350fdc9d7882ad49f55bbb7968';

function starterSource() {
  return fs.readFileSync(starterSourcePath, 'utf8');
}

function legacyStarterSource() {
  return execFileSync('git', ['show', `${legacyStarterCommit}:examples/starter/src/main.ts`], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
  });
}

function validSnapshot() {
  return {
    schemaVersion: RENDERER_STARTUP_DIAGNOSTIC_SCHEMA_VERSION,
    timeOriginMs: 1000,
    navigationStartMs: 1000,
    markers: {
      starterModuleStartedAt: { available: true, monotonicMs: 1 },
      runtimeCreateStartedAt: { available: true, monotonicMs: 2 },
      runtimeCreateCompletedAt: { available: true, monotonicMs: 8 },
      debugPublishedAt: { available: true, monotonicMs: 9 },
      assetLoadStartedAt: { available: true, monotonicMs: 10 },
      assetLoadCompletedAt: { available: true, monotonicMs: 30 },
      fontsReadyAt: { available: false, reason: 'font loading is part of the asset queue' },
      titleReadyAt: { available: true, monotonicMs: 31 },
      firstStableFrameAt: { available: true, monotonicMs: 47 },
    },
    derived: {
      navigationToDebugMs: 9,
      runtimeCreateMs: 6,
      assetLoadMs: 20,
      debugToAssetDoneMs: 21,
      assetDoneToStableFrameMs: 17,
    },
    resourceTiming: {
      count: 1,
      byInitiatorType: { script: 1, img: 1 },
      totalTransferSize: 120,
      entries: [{ name: 'starter.js', initiatorType: 'script', durationMs: 2, transferSize: 80, encodedBodySize: 80, decodedBodySize: 120 }],
    },
  };
}

describe('renderer startup diagnostic instrumentation', () => {
  it('inserts every required marker exactly once into the diagnostic worktree source', () => {
    const transformed = transformRendererStartupSource(starterSource());
    for (const marker of [
      'starterModuleStartedAt',
      'runtimeCreateStartedAt',
      'runtimeCreateCompletedAt',
      'debugPublishedAt',
      'assetLoadStartedAt',
      'assetLoadCompletedAt',
      'titleReadyAt',
      'firstStableFrameAt',
    ]) {
      expect(transformed.match(new RegExp(marker, 'g'))?.length, marker).toBe(1);
    }
    expect(transformed).toContain('__surdetRendererStartupDiagnostic');
    expect(transformed).toContain('PerformanceResourceTiming');
    expect(transformed).not.toContain('__rendererV2Debug.layers');
  });

  it('rejects a second application instead of stacking diagnostic probes', () => {
    const transformed = transformRendererStartupSource(starterSource());
    expect(() => transformRendererStartupSource(transformed)).toThrow(/重复插桩/);
  });

  it('rejects missing or ambiguous source anchors', () => {
    expect(() => transformRendererStartupSource(starterSource().replace('const runtime = await createRendererRuntime({', 'const runtime = await createRendererRuntime({\n    const runtime = await createRendererRuntime({'))).toThrow(/唯一/);
    expect(() => transformRendererStartupSource(starterSource().replace('async function loadAssets(): Promise<void> {', 'async function loadAssets(): Promise<void> {\n  async function loadAssets(): Promise<void> {'))).toThrow(/唯一/);
  });

  it('supports the frozen 007438b legacy starter entry with the same marker contract', () => {
    const transformed = transformRendererStartupSource(legacyStarterSource());
    const legacyStageConstructor = ['Pixi', 'Stage'].join('');
    for (const marker of [
      'starterModuleStartedAt',
      'runtimeCreateStartedAt',
      'runtimeCreateCompletedAt',
      'debugPublishedAt',
      'assetLoadStartedAt',
      'assetLoadCompletedAt',
      'titleReadyAt',
      'firstStableFrameAt',
    ]) {
      expect(transformed.match(new RegExp(marker, 'g'))?.length, marker).toBe(1);
    }
    expect(transformed).toContain(`__surdetMarkStartup('runtimeCreateStartedAt');\n  const stage = new ${legacyStageConstructor}();`);
    expect(transformed).toContain("await stage.init();\n  __surdetMarkStartup('runtimeCreateCompletedAt');");
  });

  it('rejects snapshots with missing, negative, non-finite, or fabricated marker values', () => {
    const missing = validSnapshot();
    delete missing.markers.debugPublishedAt;
    expect(() => validateRendererStartupDiagnosticSnapshot(missing)).toThrow(/debugPublishedAt/);

    const negative = validSnapshot();
    negative.markers.titleReadyAt.monotonicMs = -1;
    expect(() => validateRendererStartupDiagnosticSnapshot(negative)).toThrow(/非负/);

    const fabricated = validSnapshot();
    fabricated.markers.fontsReadyAt = { available: true, monotonicMs: Number.NaN };
    expect(() => validateRendererStartupDiagnosticSnapshot(fabricated)).toThrow(/有限/);
  });

  it('accepts explicit unavailable markers and keeps resource timing as an ordinary snapshot', () => {
    const snapshot = validSnapshot();
    expect(() => validateRendererStartupDiagnosticSnapshot(snapshot)).not.toThrow();
    expect(snapshot.markers.fontsReadyAt).toEqual({ available: false, reason: 'font loading is part of the asset queue' });
  });

  it('rejects resource entries with negative timing or non-finite transfer size', () => {
    const negative = validSnapshot();
    negative.resourceTiming.entries[0].durationMs = -1;
    expect(() => validateRendererStartupDiagnosticSnapshot(negative)).toThrow(/durationMs/);

    const nonFinite = validSnapshot();
    nonFinite.resourceTiming.entries[0].transferSize = Infinity;
    expect(() => validateRendererStartupDiagnosticSnapshot(nonFinite)).toThrow(/transferSize/);
  });

  it('requires explicit root and output arguments and rejects unknown arguments', () => {
    expect(() => parseRendererStartupDiagnosticArgs([])).toThrow(/--root/);
    expect(() => parseRendererStartupDiagnosticArgs(['--root', 'E:/one'])).toThrow(/--out/);
    expect(() => parseRendererStartupDiagnosticArgs(['--unknown', 'value', '--root', 'E:/one', '--out', 'x.json'])).toThrow(/未知参数/);
    const parsed = parseRendererStartupDiagnosticArgs(['--root', 'E:/one', '--out', 'diagnostic.json']);
    expect(parsed.root).toBe(path.resolve('E:/one'));
    expect(parsed.outputPath).toBe(path.resolve('diagnostic.json'));
  });

  it('applies only the unified source diff and records exact instrumentation hashes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-startup-instrumentation-test-'));
    try {
      fs.mkdirSync(path.dirname(path.join(root, rendererStartupSourceRelativePath)), { recursive: true });
      fs.writeFileSync(path.join(root, rendererStartupSourceRelativePath), starterSource(), 'utf8');
      fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n', 'utf8');
      execFileSync('git', ['init', '--quiet'], { cwd: root, shell: false });
      execFileSync('git', ['config', 'user.email', 'diagnostic@example.invalid'], { cwd: root, shell: false });
      execFileSync('git', ['config', 'user.name', 'Diagnostic Test'], { cwd: root, shell: false });
      execFileSync('git', ['add', '--', rendererStartupSourceRelativePath, 'package-lock.json'], { cwd: root, shell: false });
      execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root, shell: false });
      const result = applyRendererStartupInstrumentation(root);
      expect(result.instrumentedPaths).toEqual([rendererStartupSourceRelativePath]);
      expect(result.onlyUnifiedInstrumentationDiff).toBe(true);
      expect(result.instrumentationDiffSha256).toBe(result.fullDiffSha256);
      expect(result.beforeStatus).toBe('');
      expect(result.afterStatus).toHaveLength(1);
      expect(result.afterStatus[0]).toContain(rendererStartupSourceRelativePath);
      expect(() => applyRendererStartupInstrumentation(root)).toThrow(/干净 checkout/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps diagnostic child-process execution shell-free and diagnostic-only', () => {
    const runner = fs.readFileSync(path.join(repositoryRoot, 'packages/shell/e2e/renderer-startup-diagnostic-runner.mjs'), 'utf8');
    const diagnostic = fs.readFileSync(path.join(repositoryRoot, 'packages/shell/e2e/renderer-startup-diagnostic.mjs'), 'utf8');
    expect(runner).toContain('shell: false');
    expect(diagnostic).toContain('shell: false');
    expect(runner).not.toContain('shell: true');
    expect(diagnostic).not.toContain('shell: true');
    expect(runner).toContain('renderer-startup-diagnostic.mjs');
    expect(diagnostic).toContain('diagnosticOnly: true');
  });
});
