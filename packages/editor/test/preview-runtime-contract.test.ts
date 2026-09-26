import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const previewSourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/preview.ts',
);

describe('editor preview Renderer v2 lifecycle contract', () => {
  it('uses one RendererRuntime and exposes semantic diagnostics instead of legacy globals', () => {
    const source = readFileSync(previewSourcePath, 'utf8');
    const legacyStageName = ['Pixi', 'Stage'].join('');
    const legacyRendererName = ['Adv', 'Renderer'].join('');

    expect(source).toContain('createRendererRuntime');
    expect(source).toContain('PreviewRuntimeLifecycle');
    expect(source).toMatch(/let runtime:\s*RendererRuntime\s*\|\s*null/);
    expect(source).not.toMatch(/let stage\s*:/);
    expect(source).not.toMatch(/let renderer\s*:/);
    expect(source).not.toMatch(/let frameScheduler\s*:/);
    expect(source).not.toMatch(new RegExp(`new ${legacyStageName}\\s*\\(`));
    expect(source).not.toMatch(new RegExp(`new ${legacyRendererName}\\s*\\(`));
    expect(source).not.toMatch(/new FrameScheduler\s*\(/);
    expect(source).toContain('previewLifecycle.listen');
    expect(source).toContain('controller.dispatchInput');
    expect(source).toMatch(/(?:runtime|runtimeLifecycle)\??\.dispose\(\)/);
    expect(source).toMatch(/(?:runtime|queries)\.queries?\.presentation\.snapshot\(\)|queries\.presentation\.snapshot\(\)/);
    expect(source).toContain('queries.diagnostics.resourceSnapshot()');
  });

  it('invalidates the previous executable session before a reload can fail', () => {
    const source = readFileSync(previewSourcePath, 'utf8');
    const invalidationBody = source.slice(
      source.indexOf('function invalidatePreviewSession()'),
      source.indexOf('async function load('),
    );
    const loadBody = source.slice(
      source.indexOf('async function load('),
      source.indexOf('let loadQueue = Promise.resolve()'),
    );

    const invalidateAt = loadBody.indexOf('invalidatePreviewSession();');
    const resetAt = loadBody.indexOf('activeRuntime.resetSession({ clearAssets: true })');
    const compileAt = loadBody.indexOf('const reg = new SceneRegistry()');

    expect(invalidateAt).toBeGreaterThanOrEqual(0);
    expect(invalidateAt).toBeLessThan(resetAt);
    expect(resetAt).toBeLessThan(compileAt);
    expect(invalidationBody).toMatch(/interp\s*=\s*null;/);
    expect(invalidationBody).toMatch(/store\s*=\s*null;/);
    expect(invalidationBody).toMatch(/registry\s*=\s*null;/);
    expect(invalidationBody).toMatch(/calendar\s*=\s*null;/);
    expect(invalidationBody).toMatch(/growth\s*=\s*null;/);
    expect(invalidationBody).toMatch(/turnResumeSnap\s*=\s*null;/);
    // Configuration rebuild invalidates the old runtime before creating its replacement.
    expect(loadBody.match(/invalidatePreviewSession\(\);/g)).toHaveLength(3);
    const failureBody = loadBody.slice(loadBody.lastIndexOf('catch (err)'));
    expect(failureBody).toContain('if (previewDisposed) return;');
    expect(failureBody.indexOf('invalidatePreviewSession();')).toBeGreaterThan(failureBody.indexOf('if (previewDisposed) return;'));
    expect(failureBody.indexOf('invalidatePreviewSession();')).toBeLessThan(failureBody.indexOf('failPreviewTrace('));
  });

  it('keeps Ctrl temporary skip owned by one hold and never reopens after auto-stop', () => {
    const source = readFileSync(previewSourcePath, 'utf8');
    const block = source.slice(
      source.indexOf('let ctrlTempSkip = false'),
      source.indexOf('// ===== system 事件', source.indexOf('let ctrlTempSkip = false')),
    );

    expect(block).toContain('e.repeat');
    expect(block).toContain('ctrlTempSkip');
    expect(block).toContain('if (controller.skipMode)');
    expect(block).toContain('const releaseCtrlTempSkip');
    expect(block).toMatch(/keyup[\s\S]*releaseCtrlTempSkip/);
    expect(block).toMatch(/blur[\s\S]*releaseCtrlTempSkip/);
  });
});
