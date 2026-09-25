import { describe, expect, it } from 'vitest';
import {
  CompositionReferenceAnalysisError,
  analyzeCharacterCompositionReferences,
  analyzeSceneCompositionReferences,
  analyzeTimelineCompositionReferences,
} from '../src/composition-reference-analysis.js';

describe('raw composition reference analysis', () => {
  it('keeps missing scene targets and distinguishes local labels from external scenes', () => {
    const refs = analyzeSceneCompositionReferences({
      sceneId: 'entry',
      path: 'content/scenario/entry.gal',
      text: [
        '@scene entry',
        '@goto local',
        '@loop local',
        '@jump entry.local',
        '@call other.next',
        '@jump missing.end',
        '@end',
        '@label local',
      ].join('\n'),
      characters: {},
    });

    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'label', scope: 'primary-local', token: 'local', objectRef: 'label:entry.local' }),
      expect.objectContaining({ kind: 'scene', scope: 'primary-local', token: 'entry', objectRef: 'scene:entry' }),
      expect.objectContaining({ kind: 'scene', scope: 'candidate-external', token: 'other', objectRef: 'scene:other' }),
      expect.objectContaining({ kind: 'scene', scope: 'candidate-external', token: 'missing', objectRef: 'scene:missing' }),
    ]));
  });

  it('extracts choice when variables and every inline variable/jump effect', () => {
    const refs = analyzeSceneCompositionReferences({
      sceneId: 'entry',
      path: 'content/scenario/entry.gal',
      text: [
        '@scene entry',
        '@choice',
        '  A [if:trust > 0 && route == 2] -> @set picked = 1 @mod trust +1 @goto next',
        '  B [if:flag] -> @toggle flag @jump other',
        '@end',
      ].join('\n'),
      characters: {},
    });

    expect(new Set(refs.filter((ref) => ref.kind === 'variable').map((ref) => ref.objectRef))).toEqual(new Set([
      'variable:flag', 'variable:picked', 'variable:route', 'variable:trust',
    ]));
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'label', objectRef: 'label:entry.next', scope: 'primary-local', token: 'next' }),
      expect.objectContaining({ kind: 'scene', objectRef: 'scene:other', scope: 'candidate-external', token: 'other' }),
    ]));
    expect(refs.find((ref) => ref.objectRef === 'variable:route')?.source.optionIndex).toBe(0);
    expect(refs.find((ref) => ref.objectRef === 'variable:flag')?.source.optionIndex).toBe(1);
  });

  it('keeps real dependencies and source lines after quoted arrows, brackets and escaped quotes', () => {
    const literal = JSON.stringify('] -> @jump fake "quote"');
    const refs = analyzeSceneCompositionReferences({
      sceneId: 'entry', path: 'content/scenario/entry.gal', characters: {},
      text: [
        '@scene entry', '@if true', '@choice', '  // retained comment', '',
        `  Continue [if:flag && ${literal} == ${literal}] -> @set score = 1 @bg dusk @jump other.entry @jump ignored`,
        '@endif', '@end',
      ].join('\n'),
    });
    expect(refs.map(ref => ref.objectRef).sort()).toEqual(['asset:bg:dusk', 'scene:other', 'variable:flag', 'variable:score']);
    expect(refs.every(ref => ref.source.line === 6 && ref.source.blockIndex === 5 && ref.source.optionIndex === 0)).toBe(true);
  });

  it('reads an arrow-containing condition without actions and still rejects malformed conditions', () => {
    const input = { sceneId: 'entry', path: 'content/scenario/entry.gal', characters: {},
      text: '@scene entry\n@choice\n  Continue [if:flag && " -> " == " -> "]\n@end\n' };
    expect(analyzeSceneCompositionReferences(input).map(ref => ref.objectRef)).toEqual(['variable:flag']);
    expect(() => analyzeSceneCompositionReferences({ ...input,
      text: '@scene entry\n@choice\n  Invalid [if:flag &&] -> @jump other\n@end\n',
    })).toThrow(CompositionReferenceAnalysisError);
  });

  it('collects set RHS and if/elif variables while ignoring quoted constants', () => {
    const refs = analyzeSceneCompositionReferences({
      sceneId: 'entry',
      path: 'content/scenario/entry.gal',
      text: [
        '@scene entry',
        '@set result = trust + "quoted_only"',
        '@set literal = "another_constant"',
        '@if unlocked && count > 0',
        '@elif fallback == "branch_constant"',
        '@endif',
        '@end',
      ].join('\n'),
      characters: {},
    });

    expect(new Set(refs.filter((ref) => ref.kind === 'variable').map((ref) => ref.objectRef))).toEqual(new Set([
      'variable:result', 'variable:trust', 'variable:literal', 'variable:unlocked',
      'variable:count', 'variable:fallback',
    ]));
    expect(refs.some((ref) => ref.objectRef === 'variable:quoted_only')).toBe(false);
    expect(refs.some((ref) => ref.objectRef === 'variable:another_constant')).toBe(false);
    expect(refs.some((ref) => ref.objectRef === 'variable:branch_constant')).toBe(false);
  });

  it('reports malformed inline syntax without hiding parseable facts after it', () => {
    let thrown: unknown;
    try {
      analyzeSceneCompositionReferences({
        sceneId: 'entry',
        path: 'content/scenario/entry.gal',
        text: [
          '@scene entry',
          '@choice',
          '  Broken -> @set value = "unterminated',
          '@jump later',
          '@end',
        ].join('\n'),
        characters: {},
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CompositionReferenceAnalysisError);
    const error = thrown as CompositionReferenceAnalysisError;
    expect(error.source).toMatchObject({ path: 'content/scenario/entry.gal', line: 3, optionIndex: 0 });
    expect(error.partialReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'scene', token: 'later', objectRef: 'scene:later' }),
    ]));
  });

  it('maps known speakers, keeps ordinary speakers non-composition, and emits exact direct assets', () => {
    const refs = analyzeSceneCompositionReferences({
      sceneId: 'entry',
      path: 'content/scenario/entry.gal',
      text: [
        '@scene entry',
        '凛：hello',
        '旁白：world',
        '@bg castle_hall',
        '@show lynn:uniform smile',
        '@end',
      ].join('\n'),
      characters: { lynn: { name: '凛' } },
    });

    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'character', scope: 'candidate-external', token: '凛', objectRef: 'character:lynn' }),
      expect.objectContaining({ kind: 'character', scope: 'non-composition', token: '旁白' }),
      expect.objectContaining({ kind: 'background-asset', objectRef: 'asset:bg:castle_hall', token: 'castle_hall' }),
      expect.objectContaining({ kind: 'portrait-asset', objectRef: 'asset:portrait:lynn:uniform:smile', token: 'lynn:uniform:smile' }),
    ]));
  });

  it('uses the same exact asset semantics for timelines and characters', () => {
    const timelineRefs = analyzeTimelineCompositionReferences({
      timelineId: 'opening',
      path: 'content/timelines/opening.json',
      definition: {
        tracks: [
          { kind: 'background', cues: [{ action: 'set', key: 'night' }] },
          { kind: 'portrait', target: 'lynn:uniform', cues: [{ action: 'show', expression: 'smile' }] },
          { kind: 'audio', cues: [{ action: 'bgm', key: 'theme' }] },
          { kind: 'portrait', target: 'lynn:uniform', cues: [{ action: 'hide' }, { action: 'move' }] },
        ],
      },
    });

    expect(timelineRefs).toEqual([
      expect.objectContaining({ kind: 'background-asset', objectRef: 'asset:bg:night', source: expect.objectContaining({ trackIndex: 0, cueIndex: 0 }) }),
      expect.objectContaining({ kind: 'portrait-asset', objectRef: 'asset:portrait:lynn:uniform:smile', source: expect.objectContaining({ trackIndex: 1, cueIndex: 0 }) }),
    ]);
    expect(analyzeCharacterCompositionReferences({ id: 'lynn', avatar: 'lynn' })).toEqual([
      expect.objectContaining({ kind: 'avatar-asset', token: 'lynn', objectRef: 'asset:avatar:lynn', source: { path: 'game.config.json' } }),
    ]);
  });
});
