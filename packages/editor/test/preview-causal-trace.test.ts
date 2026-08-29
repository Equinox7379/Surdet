import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { RendererProjectionSnapshot } from '@surdet/renderer';
import { acceptPreviewTraceMessage, normalizePreviewTraceMessage } from '../src/panels/preview-panel.js';
import {
  createPreviewTraceEvidenceSnapshot,
  previewTraceEvidenceChanged,
} from '../src/preview-trace-evidence.js';

const previewSourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/preview.ts',
);

type PreviewTraceProjectionFixture = {
  dialogue: Pick<RendererProjectionSnapshot['dialogue'],
    'projectionVersion' | 'activeSpeakerId' | 'speakerText' | 'dialogText' | 'panelVisible'>;
  world: Pick<RendererProjectionSnapshot['world'], 'activeSpeakerId' | 'backgroundKey'>;
};

describe('preview causal trace contract', () => {
  it('declares Core-to-Presentation trace messages and snapshot evidence', () => {
    const source = readFileSync(previewSourcePath, 'utf8');
    expect(source).toContain("type: 'surdet-preview-trace-start'");
    expect(source).toContain("type: 'surdet-preview-trace-event'");
    expect(source).toContain("type: 'surdet-preview-trace-complete'");
    expect(source).toContain('coreEmitted: true');
    expect(source).toContain('presentationApplied');
    expect(source).toContain('queries.presentation.snapshot()');
    expect(source).toContain('queries.diagnostics.projectionSnapshot()');
  });

  it('combines world presentation and Renderer semantic projection for ADV trace evidence', () => {
    const worldPresentation = {
      version: 1,
      stage: { version: 1, backgroundKey: null, portraits: [] },
      timelines: [],
    };
    const projectionBefore = {
      dialogue: {
        projectionVersion: 1,
        activeSpeakerId: null,
        speakerText: '',
        dialogText: '',
        panelVisible: false,
      },
      world: { activeSpeakerId: null, backgroundKey: null },
    } satisfies PreviewTraceProjectionFixture;
    const projectionAfter = {
      dialogue: {
        projectionVersion: 2,
        activeSpeakerId: 'lynn',
        speakerText: '「凛」',
        dialogText: '',
        panelVisible: true,
      },
      world: { activeSpeakerId: 'lynn', backgroundKey: null },
    } satisfies PreviewTraceProjectionFixture;

    const before = createPreviewTraceEvidenceSnapshot(worldPresentation, projectionBefore);
    const after = createPreviewTraceEvidenceSnapshot(worldPresentation, projectionAfter);

    expect(before.presentation).toEqual(worldPresentation);
    expect(before.projection).toEqual(projectionBefore);
    expect('projectionVersion' in projectionBefore).toBe(false);
    expect(projectionBefore.dialogue.projectionVersion).toBe(1);
    expect(after.presentation).toEqual(worldPresentation);
    expect(after.projection).toEqual(projectionAfter);
    expect('projectionVersion' in projectionAfter).toBe(false);
    expect(projectionAfter.dialogue.projectionVersion).toBe(2);
    expect(previewTraceEvidenceChanged(before, after)).toBe(true);
    expect(previewTraceEvidenceChanged(after, createPreviewTraceEvidenceSnapshot(worldPresentation, projectionAfter))).toBe(false);
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
