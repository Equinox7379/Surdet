import { describe, expect, it } from 'vitest';
import {
  CompositionReferenceAnalysisError,
  analyzeCharacterCompositionReferences,
  analyzeSceneCompositionReferences,
  analyzeTimelineCompositionReferences,
} from '../src/composition-reference-analysis.js';
import { resolveOperationRequirementsAtSequence } from '../src/candidate-composition-guard.js';
import type { RecordedOperationCompositionFacts } from '../src/composition-contracts.js';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, type CoreEventMap, type VarDeclaration } from '@surdet/core';

describe('raw composition reference analysis', () => {
  it.each([
    ['@random "dice" 1 6', [{ name: '"dice"', type: 'number', initial: 0 }]],
    ["@add_item 'bag' apple", [{ name: "'bag'", type: 'string[]', initial: [] }]],
    ['@remove_item "bag" apple', [{ name: '"bag"', type: 'string[]', initial: ['apple'] }]],
    ['@has_item "bag" apple "has"', [{ name: '"bag"', type: 'string[]', initial: ['apple'] }, { name: '"has"', type: 'boolean', initial: false }]],
    ['@switch "chapter" 1:one\n@label one', [{ name: '"chapter"', type: 'number', initial: 1 }]],
    ['@set "score" = 1', [{ name: '"score"', type: 'number', initial: 0 }]],
    ['@mod "score" +1', [{ name: '"score"', type: 'number', initial: 0 }]],
    ['@inc "score"', [{ name: '"score"', type: 'number', initial: 0 }]],
    ['@choice\n  试试 -> @random "dice" 1 6', [{ name: '"dice"', type: 'number', initial: 0 }]],
  ] satisfies [string, VarDeclaration[]][])('preserves literal variable identities used by Core in %s', (text, declarations) => {
    const compiled = compileScene(text, 'entry.gal', 'entry');
    const run = (variables: VarDeclaration[]) => {
      const registry = new SceneRegistry(); registry.register(compiled);
      const interpreter = new Interpreter(new VariableStore(variables), new EventBus<CoreEventMap>(), registry);
      interpreter.start('entry');
      if (interpreter.status === 'awaiting-choice') interpreter.choose(0);
    };
    expect(() => run(declarations)).not.toThrow();
    const unquoted = declarations.map(declaration => ({ ...declaration, name: declaration.name.slice(1, -1) }));
    expect(() => run(unquoted)).toThrow(/Undefined variable/);
    const refs = analyzeSceneCompositionReferences({ sceneId: 'entry', path: 'entry.gal', text, characters: {} });
    expect(refs.filter(ref => ref.kind === 'variable').map(ref => ref.objectRef).sort())
      .toEqual(declarations.map(declaration => `variable:${declaration.name}`).sort());
    const input = { rawReferences: refs, sequence: declarations.length + 1, baseAssetRefs: [], priorOperations: [],
      baseObjects: unquoted.map(declaration => ({ objectRef: `variable:${declaration.name}`, references: [] })) };
    expect(resolveOperationRequirementsAtSequence(input)).toMatchObject({ ok: false });
    const priorOperations = declarations.map((declaration, index) => {
      const objectRef = `variable:${declaration.name}`;
      const facts: RecordedOperationCompositionFacts = { factsVersion: '1.0.0', capabilityId: 'variable.ensure', primaryObject: objectRef,
        rawReferences: [], producedObjects: [{ objectRef, disposition: 'create' }], requiredObjects: [] };
      return { operationId: `declare-${index}`, sequence: index + 1, facts };
    });
    expect(resolveOperationRequirementsAtSequence({ ...input, priorOperations })).toMatchObject({ ok: true,
      requiredObjects: declarations.map(() => expect.objectContaining({ source: 'candidate' })) });
  });

  it('accepts an established random target from an earlier operation, but not a future one', () => {
    const rawReferences = analyzeSceneCompositionReferences({ sceneId: 'entry', path: 'content/scenario/entry.gal', characters: {}, text: '@random dice 1 6' });
    const facts: RecordedOperationCompositionFacts = { factsVersion: '1.0.0', capabilityId: 'variable.ensure',
      primaryObject: 'variable:dice', rawReferences: [], producedObjects: [{ objectRef: 'variable:dice', disposition: 'create' }], requiredObjects: [] };
    const input = { rawReferences, sequence: 2, baseObjects: [], baseAssetRefs: [], priorOperations: [{ operationId: 'create', sequence: 1, facts }] };
    expect(resolveOperationRequirementsAtSequence(input)).toEqual({ ok: true,
      requiredObjects: [{ objectRef: 'variable:dice', source: 'candidate', candidateOperationSequence: 1 }] });
    expect(resolveOperationRequirementsAtSequence({ ...input, sequence: 1 })).toMatchObject({ ok: false });
  });

  it.each([
    ['@random dice 1 6', ['dice']],
    ['@add_item bag apple', ['bag']],
    ['@remove_item bag apple', ['bag']],
    ['@has_item bag apple has', ['bag', 'has']],
    ['@check flag && score > 0 && "literal" == "literal"', ['flag', 'score']],
    ['@switch chapter 1:one\n@label one', ['chapter']],
    ['@choice\n  试试 -> @random dice 1 6 @has_item bag apple has', ['bag', 'dice', 'has']],
  ])('guards the actual variable dependencies in %s', (text, names) => {
    const refs = analyzeSceneCompositionReferences({ sceneId: 'entry', path: 'content/scenario/entry.gal', text, characters: {} });
    expect(refs.filter(ref => ref.kind === 'variable').map(ref => ref.objectRef).sort())
      .toEqual(names.map(name => `variable:${name}`).sort());
    const input = { rawReferences: refs, sequence: 2, baseObjects: [], baseAssetRefs: [], priorOperations: [] };
    const missing = resolveOperationRequirementsAtSequence(input);
    expect(missing).toMatchObject({ ok: false, issues: names.map(() => expect.objectContaining({ code: 'OBJECT_NOT_ESTABLISHED' })) });
    const present = resolveOperationRequirementsAtSequence({ ...input, baseObjects: names.map(name => ({ objectRef: `variable:${name}`, references: [] })) });
    expect(present).toMatchObject({ ok: true, requiredObjects: names.map(() => expect.objectContaining({ source: 'base' })) });
  });

  it('tracks rule dependencies through timeline clips without claiming background or prose fields', () => {
    const child = { version: 2, id: 'mask_child', durationMs: 800, tracks: [
      { kind: 'screen', cues: [{ atMs: 0, durationMs: 800, easing: 'linear', action: 'rule', rule: '遮罩 @左' }] },
      { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: '遮罩 @左' }] },
    ] };
    const refs = analyzeTimelineCompositionReferences({ timelineId: 'parent', path: 'content/timelines/parent.json',
      definition: { version: 2, tracks: [], clips: [{ timelineId: 'mask_child', atMs: 0 }] },
      lookup: () => ({ path: 'content/timelines/mask_child.json', definition: child }) });
    expect(refs.filter(ref => ref.kind === 'rule-asset')).toEqual([expect.objectContaining({
      scope: 'candidate-external', token: '遮罩 @左', objectRef: 'asset:rule:遮罩 @左',
      source: expect.objectContaining({ path: 'content/timelines/mask_child.json', trackIndex: 0, cueIndex: 0 }),
    })]);
    expect(refs.some(ref => ref.objectRef === 'asset:bg:遮罩 @左')).toBe(true);
  });
  it('tracks the real rule modifier as an external asset, not prose or a same-named background', () => {
    const refs = analyzeSceneCompositionReferences({ sceneId: 'entry', path: 'content/scenario/entry.gal', characters: {},
      text: '@scene entry\n遮罩 @左 只是正文\n@bg "遮罩 @左"\n@transition rule 800 @rule="遮罩 @左" @soft .2\n@end' });
    expect(refs.filter(ref => ref.kind === 'rule-asset')).toEqual([expect.objectContaining({
      scope: 'candidate-external', token: '遮罩 @左', objectRef: 'asset:rule:遮罩 @左', source: expect.objectContaining({ line: 4 }),
    })]);
    expect(refs.find(ref => ref.objectRef === 'asset:bg:遮罩 @左')).toBeDefined();
  });
  it('collects interpolated text/choice variables through markup and ignores escaped braces', () => {
    const refs = analyzeSceneCompositionReferences({ sceneId: 'entry', path: 'content/scenario/entry.gal', characters: {},
      text: '<b>{正文变量}</b> {{不是变量}}\n@choice\n  <color=accent>{选项变量}</color> -> @goto end\n@label end' });
    expect(refs.filter(ref => ref.kind === 'variable').map(ref => ref.objectRef)).toEqual(['variable:正文变量', 'variable:选项变量']);
  });
  it.each(['"', "'"])('does not let an unclosed %s in prose consume media and scene dependencies', quote => {
    const refs = analyzeSceneCompositionReferences({ sceneId: 'entry', path: 'content/scenario/entry.gal', characters: {},
      text: `@scene entry\n@choice\n  未闭合的 ${quote}文案 [if:flag && " -> " == " -> "] -> @bg ${quote}night${quote} @jump accepted.entry @jump ignored\n@end` });
    expect(refs.map(ref => ref.objectRef).sort()).toEqual(['asset:bg:night', 'scene:accepted', 'variable:flag']);
    expect(refs.every(ref => ref.source.line === 3 && ref.source.optionIndex === 0)).toBe(true);
  });
  it('keeps audio/video dependencies in scene and choice instructions, but not empty stops or ambience off', () => {
    const refs = analyzeSceneCompositionReferences({ sceneId: 'entry', path: 'content/scenario/entry.gal', characters: {},
      text: '@scene entry\n@bgm "同名 声音"\n@ambience "同名 声音"\n@video "片头 WEBM"\n@ambience off\n@bgm\n@choice\n  听听 -> @se "同名 声音" @voice "同名 声音" @goto done\n@label done\n@end\n' });
    expect(refs.filter(ref => ref.kind.endsWith('-asset')).map(ref => ref.objectRef).sort()).toEqual([
      'asset:ambience:同名 声音', 'asset:bgm:同名 声音', 'asset:se:同名 声音', 'asset:video:片头 WEBM', 'asset:voice:同名 声音',
    ]);
    expect(refs.find(ref => ref.objectRef === 'asset:voice:同名 声音')?.source).toMatchObject({ line: 8, optionIndex: 0 });
    const timeline = analyzeTimelineCompositionReferences({ timelineId: 'sound', path: 'content/timelines/sound.json',
      definition: { tracks: [{ kind: 'audio', cues: ['bgm', 'se', 'voice'].map(action => ({ action, atMs: 0, key: '同名 声音' })) }] } });
    expect(timeline.map(ref => ref.objectRef).sort()).toEqual(['asset:bgm:同名 声音', 'asset:se:同名 声音', 'asset:voice:同名 声音']);
    expect(timeline.find(ref => ref.objectRef === 'asset:voice:同名 声音')?.source).toMatchObject({ trackIndex: 0, cueIndex: 2 });
  });
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
        `  Continue " -> @jump fake_label " [if:flag && ${literal} == ${literal}] -> @set score = 1 @bg dusk @jump other.entry @jump ignored`,
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
      expect.objectContaining({ kind: 'audio-asset', objectRef: 'asset:bgm:theme', source: expect.objectContaining({ trackIndex: 2, cueIndex: 0 }) }),
    ]);
    expect(analyzeCharacterCompositionReferences({ id: 'lynn', avatar: 'lynn' })).toEqual([
      expect.objectContaining({ kind: 'avatar-asset', token: 'lynn', objectRef: 'asset:avatar:lynn', source: { path: 'game.config.json' } }),
    ]);
  });
});
