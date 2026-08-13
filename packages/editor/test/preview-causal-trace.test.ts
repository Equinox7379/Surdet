import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acceptPreviewTraceMessage, normalizePreviewTraceMessage } from '../src/panels/preview-panel.js';

const previewSourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/preview.ts',
);

describe('preview causal trace contract', () => {
  it('declares Core-to-Presentation trace messages and snapshot evidence', () => {
    const source = readFileSync(previewSourcePath, 'utf8');
    expect(source).toContain("type: 'surdet-preview-trace-start'");
    expect(source).toContain("type: 'surdet-preview-trace-event'");
    expect(source).toContain("type: 'surdet-preview-trace-complete'");
    expect(source).toContain('coreEmitted: true');
    expect(source).toContain('presentationApplied');
    expect(source).toContain('queries.presentation.snapshot()');
  });

  it('drops a normalized event from an older iframe generation', () => {
    const old = normalizePreviewTraceMessage({
      type: 'surdet-preview-trace-event',
      traceId: 'trace-old',
      generation: 1,
      sequence: 0,
      coreEmitted: true,
      presentationApplied: false,
      presentationBefore: { scene: 'old' },
      presentationAfter: { scene: 'old' },
      event: {
        kind: 'instruction',
        source: { sceneId: 'intro', index: 0, op: 'text', file: 'intro.gal', line: 1, col: 1 },
      },
    });
    expect(old).not.toBeNull();
    expect(acceptPreviewTraceMessage(old, 2)).toBeNull();

    const current = normalizePreviewTraceMessage({
      type: 'surdet-preview-trace-event',
      traceId: 'trace-current',
      generation: 2,
      sequence: 0,
      coreEmitted: true,
      presentationApplied: true,
      presentationBefore: { scene: 'before' },
      presentationAfter: { scene: 'after' },
      event: {
        kind: 'instruction',
        source: { sceneId: 'intro', index: 0, op: 'text', file: 'intro.gal', line: 1, col: 1 },
      },
    });
    expect(acceptPreviewTraceMessage(current, 2)).toEqual(current);
  });
});
