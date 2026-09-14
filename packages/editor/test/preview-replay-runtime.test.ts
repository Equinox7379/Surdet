import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  compileScene,
  createSeededRandomSource,
  EventBus,
  Interpreter,
  SceneRegistry,
  VariableStore,
} from '@surdet/core';
import type { CoreEventMap, VarDeclaration } from '@surdet/core';
import {
  buildPreviewReplaySources,
  type PreviewPlaybackCheckpoint,
  type PreviewReplaySources,
} from '@surdet/authoring';
import { PreviewReplayController, type PreviewReplayInput } from '../src/preview-replay-runtime.js';
import { PresentationController, type RendererCommands, type RendererQueries } from '@surdet/renderer';

const seed = 0x1234;

const hasher = {
  sha256: async (text: string): Promise<string> => createHash('sha256').update(text, 'utf8').digest('hex'),
};

async function sourcesFor(entries: readonly { id: string; text: string }[]): Promise<PreviewReplaySources> {
  return buildPreviewReplaySources(entries, hasher);
}

function makeRuntime(
  scenes: readonly { id: string; text: string }[],
  declarations: readonly VarDeclaration[] = [],
  randomSeed?: number,
): { store: VariableStore; bus: EventBus<CoreEventMap>; registry: SceneRegistry; interpreter: Interpreter } {
  const store = new VariableStore(declarations);
  const bus = new EventBus<CoreEventMap>();
  const registry = new SceneRegistry();
  for (const scene of scenes) registry.register(compileScene(scene.text, `${scene.id}.gal`, scene.id));
  const interpreter = new Interpreter(store, bus, registry);
  if (randomSeed !== undefined) interpreter.setRandomSource(createSeededRandomSource(randomSeed));
  return { store, bus, registry, interpreter };
}

function attach(controller: PreviewReplayController, interpreter: Interpreter, bus: EventBus<CoreEventMap>, input: PreviewReplayInput = {
  advance: () => { interpreter.advance(); return true; },
  select: index => { interpreter.choose(index); return true; },
}): void {
  bus.on('runtimeTrace', (event) => controller.observe(event));
  bus.on('choice', (event) => controller.choice(event.options));
  controller.attach(interpreter, input);
}

async function flushMicrotasks(count = 80): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function sourceAt(sources: PreviewReplaySources, sceneId: string, line: number) {
  const point = sources.get(sceneId)?.get(line);
  if (point === undefined) throw new Error(`missing replay source ${sceneId}:${line}`);
  return point;
}

const replayScene = (extra = ''): string => [
  '@scene intro',
  '@label start',
  '凛：开场。',
  extra,
  '@choice',
  '  A -> @goto after',
  '  B -> @goto elsewhere',
  '@label after',
  '凛：目标对白。',
  '@end',
  '@label elsewhere',
  '凛：别处。',
  '@end',
].filter((line) => line.length > 0).join('\n');

async function recordAReplayCheckpoint(
  text = replayScene(),
  declarations: readonly VarDeclaration[] = [],
): Promise<{ checkpoint: PreviewPlaybackCheckpoint; sources: PreviewReplaySources }> {
  const scenes = [{ id: 'intro', text }];
  const sources = await sourcesFor(scenes);
  const runtime = makeRuntime(scenes, declarations);
  const controller = new PreviewReplayController({
    sources,
    seed,
    sceneId: 'intro',
    label: 'start',
    onStatus: () => {},
  });
  attach(controller, runtime.interpreter, runtime.bus);
  runtime.interpreter.start('intro', 'start');
  runtime.interpreter.advance();
  expect(runtime.interpreter.status).toBe('awaiting-choice');
  runtime.interpreter.choose(0);
  expect(runtime.interpreter.status).toBe('awaiting-advance');
  return { checkpoint: controller.checkpoint(), sources };
}

describe('PreviewReplayController', () => {
  it('clears actual presentation choices when replay reaches the later dialogue', async () => {
    const original = await recordAReplayCheckpoint();
    const runtime = makeRuntime([{ id: 'intro', text: replayScene() }]);
    let visibleChoices: { index: number; label: string }[] = [];
    let text = '';
    const commands = { dialogue: {
      showText: (_speaker: string | null, value: string) => { text = value; },
      showChoices: (options: { index: number; label: string }[]) => { visibleChoices = options; },
      hideChoices: () => { visibleChoices = []; },
      setAwaiting: () => {},
      setChoiceHighlight: () => {},
    } } as unknown as RendererCommands;
    const queries = {} as RendererQueries;
    const presentation = new PresentationController(commands, queries, undefined, {
      commands, queries, onAdvance: () => runtime.interpreter.advance(), onSelect: index => runtime.interpreter.choose(index),
    });
    presentation.connect(runtime.bus);
    const replay = new PreviewReplayController({ sources: original.sources, seed, sceneId: 'intro', label: 'start',
      replay: original.checkpoint, onStatus: () => {},
    });
    attach(replay, runtime.interpreter, runtime.bus, presentation);
    runtime.interpreter.start('intro', 'start');
    await flushMicrotasks();
    presentation.advance(); // Finish the target line's normal typewriter.
    expect(runtime.interpreter.status).toBe('awaiting-advance');
    expect(text).toBe('目标对白。');
    expect(visibleChoices).toEqual([]);
    expect(presentation.status).toBe('awaiting');
    replay.dispose();
    presentation.destroy();
  });

  it('follows a moved performance line back to the original dialogue source', async () => {
    const original = await recordAReplayCheckpoint();
    const changedText = replayScene('凛：新增演出。');
    const changedScenes = [{ id: 'intro', text: changedText }];
    const changedSources = await sourcesFor(changedScenes);
    const runtime = makeRuntime(changedScenes);
    const statuses: string[] = [];
    const texts: string[] = [];
    runtime.bus.on('text', (event) => texts.push(event.value));
    const controller = new PreviewReplayController({
      sources: changedSources,
      seed,
      sceneId: 'intro',
      label: 'start',
      replay: original.checkpoint,
      onStatus: (message) => statuses.push(message),
    });
    attach(controller, runtime.interpreter, runtime.bus);

    runtime.interpreter.start('intro', 'start');
    await flushMicrotasks();

    expect(runtime.interpreter.status).toBe('awaiting-advance');
    expect(texts).toEqual(['开场。', '新增演出。', '目标对白。']);
    expect(controller.checkpoint().choices).toEqual(original.checkpoint.choices);
    expect(controller.checkpoint().target).toEqual(original.checkpoint.target);
    expect(statuses.at(-1)).toContain('保存的目标源点');
  });

  it('stops at a reordered choice group or a same-label option with a changed target', async () => {
    const original = await recordAReplayCheckpoint();
    const variants = [
      replayScene().replace('  A -> @goto after\n  B -> @goto elsewhere', '  B -> @goto elsewhere\n  A -> @goto after'),
      replayScene().replace('  A -> @goto after', '  A -> @goto elsewhere'),
    ];

    for (const changedText of variants) {
      const scenes = [{ id: 'intro', text: changedText }];
      const sources = await sourcesFor(scenes);
      const runtime = makeRuntime(scenes);
      const statuses: string[] = [];
      const controller = new PreviewReplayController({
        sources,
        seed,
        sceneId: 'intro',
        label: 'start',
        replay: original.checkpoint,
        onStatus: (message) => statuses.push(message),
      });
      attach(controller, runtime.interpreter, runtime.bus);
      runtime.interpreter.start('intro', 'start');
      await flushMicrotasks();

      expect(runtime.interpreter.status).toBe('awaiting-choice');
      expect(statuses.some((message) => message.includes('选择组身份'))).toBe(true);
      expect(controller.checkpoint().choices).toEqual([]);
    }
  });

  it('rejects a hidden saved option even when the choice group source is unchanged', async () => {
    const originalText = [
      '@scene intro',
      '@label start',
      '@set allow = true',
      '凛：开场。',
      '@choice',
      '  A [if:allow] -> @goto after',
      '  B -> @goto elsewhere',
      '@label after',
      '凛：目标对白。',
      '@end',
      '@label elsewhere',
      '凛：别处。',
      '@end',
    ].join('\n');
    const original = await recordAReplayCheckpoint(originalText, [{ name: 'allow', type: 'boolean', initial: true }]);
    const changedText = originalText.replace('@set allow = true', '@set allow = false');
    const scenes = [{ id: 'intro', text: changedText }];
    const sources = await sourcesFor(scenes);
    const runtime = makeRuntime(scenes, [{ name: 'allow', type: 'boolean', initial: true }]);
    const statuses: string[] = [];
    const controller = new PreviewReplayController({
      sources,
      seed,
      sceneId: 'intro',
      label: 'start',
      replay: original.checkpoint,
      onStatus: (message) => statuses.push(message),
    });
    attach(controller, runtime.interpreter, runtime.bus);
    runtime.interpreter.start('intro', 'start');
    await flushMicrotasks();

    expect(runtime.interpreter.status).toBe('awaiting-choice');
    expect(statuses.some((message) => message.includes('条件、顺序或可见性'))).toBe(true);
    expect(controller.checkpoint().choices).toEqual([]);
  });

  it('rejects a duplicate source identity instead of guessing between same text or choice points', async () => {
    const duplicateText = [
      '@scene duplicate',
      '@label start',
      '凛：重复。',
      '凛：重复。',
      '@end',
    ].join('\n');
    const textSources = await sourcesFor([{ id: 'duplicate', text: duplicateText }]);
    const duplicateTextPoint = sourceAt(textSources, 'duplicate', 3);
    expect(duplicateTextPoint.unique).toBe(false);
    const textStatuses: string[] = [];
    const textRuntime = makeRuntime([{ id: 'duplicate', text: duplicateText }]);
    const textController = new PreviewReplayController({
      sources: textSources,
      seed,
      sceneId: 'duplicate',
      replay: {
        seed,
        sceneId: 'duplicate',
        choices: [],
        target: duplicateTextPoint.source,
      },
      onStatus: (message) => textStatuses.push(message),
    });
    attach(textController, textRuntime.interpreter, textRuntime.bus);
    textRuntime.interpreter.start('duplicate', 'start');
    await flushMicrotasks();
    expect(textStatuses.some((message) => message.includes('不唯一'))).toBe(true);
    expect(textRuntime.interpreter.status).toBe('awaiting-advance');

    const duplicateChoiceText = [
      '@scene duplicate-choice',
      '@label start',
      '@choice',
      '  A -> @goto end',
      '@choice',
      '  A -> @goto end',
      '@label end',
      '凛：目标。',
      '@end',
    ].join('\n');
    const choiceSources = await sourcesFor([{ id: 'duplicate-choice', text: duplicateChoiceText }]);
    const choicePoint = sourceAt(choiceSources, 'duplicate-choice', 3);
    expect(choicePoint.source.kind).toBe('choice');
    expect(choicePoint.unique).toBe(false);
    const targetPoint = sourceAt(choiceSources, 'duplicate-choice', 8);
    const choiceStatuses: string[] = [];
    const choiceRuntime = makeRuntime([{ id: 'duplicate-choice', text: duplicateChoiceText }]);
    const choiceController = new PreviewReplayController({
      sources: choiceSources,
      seed,
      sceneId: 'duplicate-choice',
      replay: {
        seed,
        sceneId: 'duplicate-choice',
        choices: [{ source: choicePoint.source, optionFingerprint: choicePoint.options![0]!.fingerprint }],
        target: targetPoint.source,
      },
      onStatus: (message) => choiceStatuses.push(message),
    });
    attach(choiceController, choiceRuntime.interpreter, choiceRuntime.bus);
    choiceRuntime.interpreter.start('duplicate-choice', 'start');
    await flushMicrotasks();
    expect(choiceStatuses.some((message) => message.includes('不唯一'))).toBe(true);
    expect(choiceRuntime.interpreter.status).toBe('awaiting-choice');

    // The browser may still make a normal manual choice after automatic
    // continuation has stopped.  That real choice reaches a unique dialogue,
    // but the earlier duplicate source means this checkpoint cannot claim a
    // complete, resumable path.
    choiceRuntime.interpreter.choose(0);
    await flushMicrotasks();
    expect(choiceRuntime.interpreter.status).toBe('awaiting-advance');
    expect(choiceController.checkpoint().target).toBeNull();

    const resumedStatuses: string[] = [];
    const resumedController = new PreviewReplayController({
      sources: choiceSources,
      seed,
      sceneId: 'duplicate-choice',
      replay: choiceController.checkpoint(),
      onStatus: (message) => resumedStatuses.push(message),
    });
    const resumedRuntime = makeRuntime([{ id: 'duplicate-choice', text: duplicateChoiceText }]);
    attach(resumedController, resumedRuntime.interpreter, resumedRuntime.bus);
    resumedRuntime.interpreter.start('duplicate-choice', 'start');
    await flushMicrotasks();
    expect(resumedRuntime.interpreter.status).toBe('awaiting-choice');
    expect(resumedStatuses.some((message) => message.includes('没有可操作的目标源点'))).toBe(true);
  });

  it('lets Core own seeded randomness while the checkpoint retains the same seed', async () => {
    const text = [
      '@scene seeded',
      '@random roll 1 6',
      '凛：结果。',
      '@end',
    ].join('\n');
    const scenes = [{ id: 'seeded', text }];
    const sources = await sourcesFor(scenes);
    const run = (): { roll: number; checkpoint: PreviewPlaybackCheckpoint } => {
      const runtime = makeRuntime(scenes, [{ name: 'roll', type: 'number', initial: 0 }], seed);
      const controller = new PreviewReplayController({ sources, seed, sceneId: 'seeded', onStatus: () => {} });
      attach(controller, runtime.interpreter, runtime.bus);
      runtime.interpreter.start('seeded');
      return { roll: runtime.store.getNumber('roll'), checkpoint: controller.checkpoint() };
    };

    const first = run();
    const second = run();
    expect(first.roll).toBe(second.roll);
    expect(first.checkpoint.seed).toBe(seed);
    expect(second.checkpoint.seed).toBe(seed);
  });

  it('does not let dispose or a new interpreter generation run an old microtask', async () => {
    const text = ['@scene lifecycle', '凛：当前。', '凛：目标。', '@end'].join('\n');
    const scenes = [{ id: 'lifecycle', text }];
    const sources = await sourcesFor(scenes);
    const target = sourceAt(sources, 'lifecycle', 3).source;

    const disposedRuntime = makeRuntime(scenes);
    const disposedAdvance = vi.spyOn(disposedRuntime.interpreter, 'advance');
    const disposedController = new PreviewReplayController({
      sources,
      seed,
      sceneId: 'lifecycle',
      replay: { seed, sceneId: 'lifecycle', choices: [], target },
      onStatus: () => {},
    });
    attach(disposedController, disposedRuntime.interpreter, disposedRuntime.bus);
    disposedRuntime.interpreter.start('lifecycle');
    expect(disposedRuntime.interpreter.status).toBe('awaiting-advance');
    disposedController.dispose();
    await flushMicrotasks();
    expect(disposedAdvance).not.toHaveBeenCalled();

    const oldRuntime = makeRuntime(scenes);
    const newRuntime = makeRuntime(scenes);
    const oldAdvance = vi.spyOn(oldRuntime.interpreter, 'advance');
    const newAdvance = vi.spyOn(newRuntime.interpreter, 'advance');
    const generationController = new PreviewReplayController({
      sources,
      seed,
      sceneId: 'lifecycle',
      replay: { seed, sceneId: 'lifecycle', choices: [], target },
      onStatus: () => {},
    });
    attach(generationController, oldRuntime.interpreter, oldRuntime.bus);
    oldRuntime.interpreter.start('lifecycle');
    expect(oldRuntime.interpreter.status).toBe('awaiting-advance');
    attach(generationController, newRuntime.interpreter, newRuntime.bus);
    await flushMicrotasks();
    expect(oldAdvance).not.toHaveBeenCalled();
    expect(newAdvance).not.toHaveBeenCalled();
  });
});
