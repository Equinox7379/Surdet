import type { CoreEventMap, EventBus, Interpreter } from '@surdet/core';
import { AdvRenderer, AudioManager, PixiStage, createRendererRuntime } from '@surdet/renderer';
import type { AudioHandle } from '@surdet/renderer';
import { connectInterpreterPresentation } from '@surdet/host';

/** Complete legacy example kept for the one-version compatibility window. */
export async function startLegacyRenderer(
  hostElement: HTMLElement,
  interpreter: Interpreter,
  bus: EventBus<CoreEventMap>,
  audio: AudioHandle,
): Promise<{ stage: PixiStage; renderer: AdvRenderer }> {
  const stage = new PixiStage();
  await stage.init();
  hostElement.appendChild(stage.app!.canvas);
  stage.fitWindow();
  const renderer = new AdvRenderer(stage, audio, {
    onAdvance: () => interpreter.advance(),
    onSelect: (index) => interpreter.choose(index),
  });
  renderer.subscribe(bus);
  return { stage, renderer };
}

/** Minimal v2 host example sharing the production Presentation connection. */
export async function startV2Renderer(
  hostElement: HTMLElement,
  interpreter: Interpreter,
  bus: EventBus<CoreEventMap>,
): Promise<() => void> {
  const audio = new AudioManager();
  const runtime = await createRendererRuntime({
    audio,
    onAdvance: () => interpreter.advance(),
    onSelect: (index) => interpreter.choose(index),
  });
  hostElement.appendChild(runtime.canvas);
  runtime.resize();
  const unsubscribe = runtime.controller.connect(bus);
  const presentationConnection = connectInterpreterPresentation({ interpreter, renderer: runtime });
  return () => {
    presentationConnection.disconnect();
    unsubscribe();
    runtime.dispose();
    audio.dispose();
  };
}
