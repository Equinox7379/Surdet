import { beforeEach, describe, expect, it } from 'vitest';
import { simulateSnapshot, type PreviewTraceMessage } from '@surdet/authoring';
import { activateStoryPreview, appendStoryPreview, appendStoryPreviewError, clearStoryPreview, prepareStoryPreview, readStoryPreview,
  storyDiagnostic, storyInputKey, storySnapshot } from '../src/story-check.js';
import { projectPreviewContent } from '../src/preview-content.js';

const files = {
  'game.config.json': JSON.stringify({ entryScene: 'start', variables: { secret: { type: 'string', initial: 'PRIVATE_VARIABLE' } } }),
  'content/scenario/chapter/start.gal': '@scene start\n@choice\n  PRIVATE_LABEL [if:false] -> @end\n  继续 -> @end\nPRIVATE_STORY\n@end\n',
};
beforeEach(clearStoryPreview);

describe('story check snapshots and diagnostics', () => {
  it('retains exact isolated scene paths for identical text and supported uppercase extensions', async () => {
    const sameFiles = { 'game.config.json': '{"entryScene":"a"}',
      'content/scenario/chapter/a.GAL': '同一正文。\n@end\n', 'content/scenario/b.gal': '同一正文。\n@end\n' };
    const snapshot = await storySnapshot({ files: sameFiles });
    const projection = await projectPreviewContent({ target: { kind: 'saved-project' }, title: 'same', projectIdentity: 'editor-story-check',
      contentRevision: snapshot.revision, projectRevision: snapshot.revision, coordinationRevision: 'none', files: sameFiles });
    expect(Object.fromEntries(projection.scenes.map(scene => [scene.id, scene.file])))
      .toEqual({ a: 'content/scenario/chapter/a.GAL', b: 'content/scenario/b.gal' });
  });

  it('captures nested source versions and changes revision for any relevant input', async () => {
    const snapshot = await storySnapshot({ files });
    expect(snapshot.scenes[0]!.path).toBe('content/scenario/chapter/start.gal');
    expect(storyInputKey({ files })).toBe(storyInputKey({ files: Object.fromEntries(Object.entries(files).reverse()) }));
    const changed = { ...files, 'content/config/terminology.json': '[]' };
    expect((await storySnapshot({ files: changed })).revision).not.toBe(snapshot.revision);
  });

  it('exports complete location facts without story text, condition expressions or variable values', async () => {
    const snapshot = await storySnapshot({ files }), report = simulateSnapshot(snapshot);
    report.coverage.stops.push({ kind: 'runtime-error', location: report.coverage.branches[0]!.location, message: 'D:/PRIVATE_ERROR_SECRET' });
    const exported = storyDiagnostic({ check: { revision: snapshot.revision, report, options: { seed: 0, initialVariables: { secret: 'PRIVATE_OVERRIDE' } } }, checkCurrent: false,
      failure: { code: 'DSL001', file: 'content/scenario/chapter/start.gal', line: 3, message: 'D:/PRIVATE_ABSOLUTE_ROOT' } });
    expect(exported.simulation).toMatchObject({ current: false, initialOverrideCount: 1, seed: report.seed });
    expect(exported.simulation!.branches).toHaveLength(report.coverage.branches.length);
    expect(exported.simulation!.branches[0]!.location).toMatchObject({ line: 3, sourceVersion: snapshot.scenes[0]!.file.sha256 });
    const json = JSON.stringify(exported);
    for (const secret of ['PRIVATE_', 'expression', 'finalVariables', 'initialVariables', 'message', 'label', 'D:/']) expect(json).not.toContain(secret);
    expect(exported.checkFailure).toEqual({ code: 'DSL001', file: 'content/scenario/chapter/start.gal', line: 3, col: 1 });
  });

  it('ignores wrong generations, duplicate and completed preview events, and retains the actual error source', async () => {
    let current = true;
    const preview = await prepareStoryPreview({ traceId: 'trace', owner: {}, scope: '当前编辑内容（含草稿）', working: true, seed: 0,
      sources: [{ id: 'start', file: 'content/scenario/chapter/start.gal', text: files['content/scenario/chapter/start.gal'] }],
      contentKey: JSON.stringify(files), isCurrent: () => current });
    expect(readStoryPreview()).toBeNull();
    activateStoryPreview(preview);
    const start: PreviewTraceMessage = { type: 'surdet-preview-trace-start', traceId: 'trace', generation: 4, sceneId: 'start' };
    appendStoryPreview(start);
    const event: PreviewTraceMessage = { type: 'surdet-preview-trace-event', traceId: 'trace', generation: 4, sequence: 0,
      coreEmitted: true, presentationApplied: true, presentationBefore: { secret: 'PRIVATE_PRESENTATION' }, presentationAfter: {},
      event: { kind: 'condition', source: { sceneId: 'start', file: 'start.gal', index: 1, line: 2, col: 1, op: 'choice' },
        stateDelta: [{ variable: 'secret', before: 'PRIVATE_BEFORE', after: 'PRIVATE_AFTER' }], condition: { expression: 'PRIVATE_EXPRESSION', result: false, optionIndex: 0 } } };
    appendStoryPreview({ ...event, generation: 3 }); appendStoryPreview({ ...event, traceId: 'other' });
    appendStoryPreview(event); appendStoryPreview(event);
    expect(preview.eventCount).toBe(1); expect(preview.conditions).toEqual({ passed: 0, failed: 1 });
    appendStoryPreviewError('trace', 'runtime', 'PRIVATE_ERROR');
    appendStoryPreview({ ...event, sequence: 1, event: { ...event.event, kind: 'instruction', condition: undefined, source: { ...event.event.source, index: 3, line: 6 } } });
    expect(preview.eventCount).toBe(2);
    appendStoryPreview({ type: 'surdet-preview-trace-complete', traceId: 'trace', generation: 4, status: 'failed', eventCount: 2, firstError: 'PRIVATE_ERROR' });
    expect(preview.errors[0]!.location?.line).toBe(6);
    appendStoryPreviewError('trace', 'compile', 'PRIVATE_ERROR', { sceneId: 'start', line: 8, col: 4 });
    appendStoryPreview({ ...event, sequence: 2 });
    expect(preview.eventCount).toBe(2); expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0]).toMatchObject({ phase: 'compile', location: { file: 'content/scenario/chapter/start.gal', line: 8, col: 4 } });
    current = false;
    const exported = storyDiagnostic({ preview });
    expect(exported.preview).toMatchObject({ current: false, status: 'failed', eventCount: 2, seed: 0 });
    expect(JSON.stringify(exported)).not.toContain('PRIVATE_');
    clearStoryPreview(); appendStoryPreview(start); expect(readStoryPreview()).toBeNull();
  });

  it('bounds the preview sample while retaining counts, and does not identify isolated content as the current draft', async () => {
    const preview = await prepareStoryPreview({ traceId: 'fixed', owner: {}, scope: '封存候选', working: false, seed: 1,
      sources: [{ id: 'start', file: 'content/scenario/start.gal', text: '@scene start\n@end' }], contentKey: 'fixed', isCurrent: () => true });
    activateStoryPreview(preview);
    appendStoryPreview({ type: 'surdet-preview-trace-start', traceId: 'fixed', generation: 0, sceneId: 'start' });
    for (let sequence = 0; sequence < 45; sequence++) appendStoryPreview({ type: 'surdet-preview-trace-event', traceId: 'fixed', generation: 0, sequence,
      coreEmitted: true, presentationApplied: true, presentationBefore: {}, presentationAfter: {},
      event: { kind: 'instruction', source: { sceneId: 'start', file: 'start.gal', index: 0, line: 1, col: 1, op: 'instr' } } });
    expect(preview.events).toHaveLength(40); expect(preview.eventCount).toBe(45);
    expect(storyDiagnostic({ preview }).preview).toMatchObject({ current: null, eventCount: 45, sampledEvents: 40 });
  });
});
