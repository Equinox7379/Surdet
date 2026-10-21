import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import type { ProjectSnapshot } from '../src/project-snapshot.js';
import { parseSceneDocument } from '../src/scene-document.js';
import { buildObjectIndex, inspectObject } from '../src/object-index.js';
import { buildTimelineRegistry } from '../src/simulation.js';
import { validateSnapshot } from '../src/validation.js';
import { validateProjectStageContent } from '../src/stage-validation.js';

function project(definitions: Record<string, unknown>): ProjectSnapshot {
  const source = '@scene start\n@timeline parent\n@end';
  const scene = { path: 'content/scenario/start.gal', text: source, bytes: source.length, sha256: 'fixture' };
  const timelines = Object.entries(definitions).map(([path, definition]) => {
    const text = JSON.stringify(definition);
    return { path: `content/timelines/${path}`, text, bytes: text.length, sha256: 'fixture' };
  });
  return {
    rootIdentity: 'clip-reference-test', revision: 'fixture', files: [scene, ...timelines], configFile: null,
    config: { entryScene: 'start', variables: {} }, entryScene: 'start', variables: {}, timelines,
    scenes: [{ id: 'start', path: scene.path, file: scene, document: parseSceneDocument(source), compiled: compileScene(source, scene.path, 'start') }],
  };
}

function child(id = 'child', version = 1) {
  return { version, id, durationMs: 100, tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 100, easing: 'linear', action: 'fade', alpha: 1 }] }] };
}

function parent(timelineId = 'child') {
  return { version: 2, id: 'parent', durationMs: 100, tracks: [], clips: [{ timelineId, atMs: 0 }] };
}

describe('authored clip references in the object index', () => {
  it.each([1, 2])('exposes both directions for a legal v2 clip of a v%s child', version => {
    const snapshot = project({ 'parent.json': parent(), 'nested/child.json': child('child', version) });
    expect(validateSnapshot(snapshot).ok).toBe(true);
    expect(buildTimelineRegistry(snapshot).get('parent')!.tracks).toHaveLength(1);
    const index = buildObjectIndex(snapshot);
    expect(inspectObject(index, 'timeline:parent').references).toEqual(['timeline:child']);
    expect(inspectObject(index, 'timeline:child').referencedBy).toEqual(['timeline:parent']);
    expect(inspectObject(index, 'timeline:child').kind).toBe('timeline');
    expect(inspectObject(index, 'timeline:parent').childRefs).toEqual([]);
  });

  it('deduplicates authored edges while runtime still expands repeated clip instances', () => {
    const snapshot = project({
      'parent.json': { ...parent(), durationMs: 200, clips: [{ timelineId: 'child', atMs: 0 }, { timelineId: 'child', atMs: 100 }] },
      'child.json': child(),
    });
    expect(validateSnapshot(snapshot).ok).toBe(true);
    expect(buildTimelineRegistry(snapshot).get('parent')!.tracks).toHaveLength(2);
    const index = buildObjectIndex(snapshot);
    expect(inspectObject(index, 'timeline:parent').references).toEqual(['timeline:child']);
    expect(inspectObject(index, 'timeline:child').referencedBy).toEqual(['timeline:parent']);
  });

  it('keeps direct clip edges separate from grandchildren and their assets', () => {
    const snapshot = project({
      'parent.json': parent('middle'), 'middle.json': { ...parent(), id: 'middle' },
      'child.json': { ...child(), tracks: [{ kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night' }] }] },
    });
    expect(validateSnapshot(snapshot).ok).toBe(true);
    expect(buildTimelineRegistry(snapshot).get('parent')!.tracks).toHaveLength(1);
    const index = buildObjectIndex(snapshot);
    expect(inspectObject(index, 'timeline:parent').references).toEqual(['timeline:middle']);
    expect(inspectObject(index, 'timeline:middle').references).toEqual(['timeline:child']);
    expect(inspectObject(index, 'timeline:child').referencedBy).toEqual(['timeline:middle']);
    expect(inspectObject(index, 'timeline:child').references).toEqual(['asset:bg:night']);
    expect(inspectObject(index, 'asset:bg:night').referencedBy).not.toContain('timeline:parent');
    expect(inspectObject(index, 'asset:bg:night').referencedBy).not.toContain('timeline:middle');
  });

  it('leaves a missing clip target invalid without fabricating an indexed object', () => {
    const snapshot = project({ 'parent.json': parent('missing') });
    expect(validateSnapshot(snapshot).ok).toBe(false);
    expect(() => buildTimelineRegistry(snapshot).get('parent')).toThrow(/missing/);
    const index = buildObjectIndex(snapshot);
    expect(index.byRef.has('timeline:missing')).toBe(false);
    expect(index.objects.some(object => object.kind === 'asset' && object.objectRef === 'timeline:missing')).toBe(false);
    expect(inspectObject(index, 'timeline:parent').references).toEqual([]);
  });

  it.each([1, 2])('preserves physical portrait asset identity for a v%s child', version => {
    const snapshot = project({
      'parent.json': parent(),
      'child.json': { ...child('child', version), tracks: [{ kind: 'portrait', target: version === 2 ? 'slot' : 'lynn:uniform', cues: [{
        atMs: 0, durationMs: 0, easing: 'linear', action: 'show', expression: 'normal', position: 'left',
        ...(version === 2 ? { source: 'lynn:uniform' } : {}),
      }] }] },
    });
    const validation = validateSnapshot(snapshot);
    expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
    expect(buildTimelineRegistry(snapshot).get('parent')!.tracks).toHaveLength(1);
    const index = buildObjectIndex(snapshot);
    expect(inspectObject(index, 'timeline:parent').references).toEqual(['timeline:child']);
    expect(inspectObject(index, 'timeline:child').references).toEqual(['asset:portrait:lynn:uniform:normal']);
    expect(index.byRef.has('asset:portrait:slot:normal:normal')).toBe(false);
  });
});

describe('stage clip lookup respects existing timeline identities', () => {
  it.each([['json', 'child'], ['JSON', 'child.JSON'], ['JsOn', 'child.JsOn']])('validates a nested .%s child with ID %s consistently with runtime', (extension, id) => {
    const snapshot = project({ 'parent.json': parent(id), [`nested/child.${extension}`]: child(id) });
    expect(buildTimelineRegistry(snapshot).get('parent')!.tracks).toHaveLength(1);
    const index = buildObjectIndex(snapshot);
    expect(inspectObject(index, `timeline:${id}`).kind).toBe('timeline');
    expect(validateProjectStageContent(snapshot)).toEqual([]);
    expect(validateSnapshot(snapshot).ok).toBe(true);
    expect(inspectObject(index, 'timeline:parent').references).toEqual([`timeline:${id}`]);
    expect(inspectObject(index, `timeline:${id}`).referencedBy).toEqual(['timeline:parent']);
    if (extension !== 'json') expect(index.byRef.has('timeline:child')).toBe(false);
  });
});
