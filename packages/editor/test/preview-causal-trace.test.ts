import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { RendererProjectionSnapshot } from '@surdet/renderer';
import {
  acceptPreviewTraceMessage,
  isCurrentPreviewFrameSource,
  normalizePreviewTraceMessage,
  projectPreviewTraceRow,
} from '../src/panels/preview-panel.js';
import {
  createPreviewTraceEvidenceSnapshot,
  previewTraceEvidenceChanged,
} from '../src/preview-trace-evidence.js';

const previewSourcePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/preview.ts',
);

type PreviewTraceProjectionFixture = {
  dialogue: Pick<NonNullable<RendererProjectionSnapshot['dialogue']>,
    'projectionVersion' | 'activeSpeakerId' | 'speakerText' | 'dialogText'> & { panelVisible: boolean };
  world: Pick<NonNullable<RendererProjectionSnapshot['world']>, 'activeSpeakerId' | 'backgroundKey'>;
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

  it('keeps the saved reading history out of trace evidence', () => {
    const history = Array.from({ length: 200 }, (_, index) => ({ speaker: '凛', text: `第${index}句`.repeat(20), markup: `<em>第${index}句</em>` }));
    const presentation = { version: 1, stage: { backgroundKey: 'hall' }, dialogue: { nvlActive: false, nvlEntries: [], backlog: history, backlogReplayCurrent: true } };
    const evidence = createPreviewTraceEvidenceSnapshot(presentation, {});
    expect(evidence.presentation).toEqual({ version: 1, stage: { backgroundKey: 'hall' }, dialogue: { nvlActive: false, nvlEntries: [] } });
    expect(presentation.dialogue.backlog).toHaveLength(200);
    expect(JSON.stringify(evidence).length).toBeLessThan(200);
    // A new history line alone is not a presentation change.
    const longer = { ...presentation, dialogue: { ...presentation.dialogue, backlog: [...history, { speaker: null, text: '新的一句' }] } };
    expect(previewTraceEvidenceChanged(evidence, createPreviewTraceEvidenceSnapshot(longer, {}))).toBe(false);
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

  it('accepts status and trace messages only from the currently mounted iframe', () => {
    const currentFrame = {} as WindowProxy;
    const staleFrame = {} as WindowProxy;

    expect(isCurrentPreviewFrameSource(currentFrame, currentFrame)).toBe(true);
    expect(isCurrentPreviewFrameSource(staleFrame, currentFrame)).toBe(false);
    expect(isCurrentPreviewFrameSource(null, currentFrame)).toBe(false);
    expect(isCurrentPreviewFrameSource(currentFrame, null)).toBe(false);

    const source = readFileSync(path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../src/panels/preview-panel.ts',
    ), 'utf8');
    expect(source).toContain('notifyPreviewReady?.(e.source)');
    expect(source).toContain('notifyPreviewDiagnostic?.(diagnostic, e.source)');
    expect(source).toContain('isCurrentPreviewFrameSource(source, frame.contentWindow)');
  });

  it('projects runtime enums into Chinese-first causal record labels', () => {
    const base = {
      type: 'surdet-preview-trace-event' as const,
      traceId: 'trace-current',
      generation: 2,
      sequence: 3,
      coreEmitted: true as const,
      presentationApplied: true,
      presentationBefore: {},
      presentationAfter: {},
    };

    expect(projectPreviewTraceRow({
      ...base,
      event: {
        kind: 'instruction',
        source: { sceneId: 'intro', index: 4, op: 'text', file: 'intro.gal', line: 12, col: 1 },
      },
    })).toEqual({
      title: '显示台词',
      sourceLabel: 'intro 场景 · 第 12 行',
      technicalLabel: '事件 4 · 执行剧情指令',
    });

    expect(projectPreviewTraceRow({
      ...base,
      sequence: 4,
      event: {
        kind: 'choice',
        source: { sceneId: 'intro', index: 5, op: 'choice', file: 'intro.gal', line: 16, col: 1 },
      },
    }).title).toBe('提供选择');

    expect(projectPreviewTraceRow({
      ...base,
      event: {
        kind: 'future-event',
        source: { sceneId: 'intro', index: 6, op: 'future-op', file: 'intro.gal', line: 18, col: 1 },
      },
    } as unknown as Parameters<typeof projectPreviewTraceRow>[0]).title).toBe('剧情事件');
  });

  it('guards against duplicate, out-of-order, and post-complete trace messages', () => {
    const source = readFileSync(path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../src/panels/preview-panel.ts',
    ), 'utf8');

    expect(source).toContain('let lastTraceSequence = -1');
    expect(source).toContain('let traceCompleted = false');
    expect(source).toContain('current.sequence <= lastTraceSequence');
    expect(source).toContain('if (traceCompleted) return');
  });
});
