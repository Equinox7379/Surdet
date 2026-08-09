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

    expect(source).toContain('createRendererRuntime');
    expect(source).toContain('PreviewRuntimeLifecycle');
    expect(source).toMatch(/let runtime:\s*RendererRuntime\s*\|\s*null/);
    expect(source).not.toMatch(/let stage\s*:/);
    expect(source).not.toMatch(/let renderer\s*:/);
    expect(source).not.toMatch(/let frameScheduler\s*:/);
    expect(source).not.toMatch(/new PixiStage\s*\(/);
    expect(source).not.toMatch(/new AdvRenderer\s*\(/);
    expect(source).not.toMatch(/new FrameScheduler\s*\(/);
    expect(source).toContain('previewLifecycle.listen');
    expect(source).toContain('controller.dispatchInput');
    expect(source).toMatch(/(?:runtime|runtimeLifecycle)\??\.dispose\(\)/);
    expect(source).toMatch(/(?:runtime|queries)\.queries?\.presentation\.snapshot\(\)|queries\.presentation\.snapshot\(\)/);
    expect(source).toContain('queries.diagnostics.resourceSnapshot()');
  });
});
