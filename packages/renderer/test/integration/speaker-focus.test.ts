import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, type CoreEventMap } from '@surdet/core';
import { Container, Sprite, Texture } from 'pixi.js';
import { RendererStageHost } from '../../src/pixi-stage-host.js';
import { RenderPerformanceMonitor } from '../../src/performance.js';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { createPresentationPorts } from '../../src/runtime/presentation-ports.js';
import { RendererFacade } from '../../src/runtime/renderer-facade.js';
import type { WorldLayer } from '../../src/layers/world/world-layer.js';

beforeEach(() => {
  class CanvasContext {
    font = '';
    measureText(text: string) {
      return { width: text.length * 10, actualBoundingBoxAscent: 20, actualBoundingBoxDescent: 5 };
    }
  }
  vi.stubGlobal('CanvasRenderingContext2D', CanvasContext);
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => new CanvasContext() }) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function makeRuntime() {
  const stage = new RendererStageHost();
  await stage.registerPortrait('lynn', 'uniform', 'normal', Texture.WHITE);
  await stage.registerPortrait('mio', 'uniform', 'normal', Texture.WHITE);
  for (const [index, charId] of ['lynn', 'mio'].entries()) {
    stage.setPortrait(`${charId}:uniform`, { charId, costume: 'uniform', expression: 'normal', pos: index === 0 ? 'left' : 'right' });
  }
  stage.setSpeakerProfiles([{ id: 'lynn', name: '凛' }, { id: 'mio', name: '澪' }]);
  const ports = createPresentationPorts(stage, { worldLayer: stage.worldLayer, dialogueLayer: stage.dialogueLayer });
  const controller = new PresentationController(ports.commands, ports.queries, undefined, {
    commands: ports.commands, queries: ports.queries, validateStagePresentation: ports.validateStagePresentation,
  });
  const bus = new EventBus<CoreEventMap>();
  const disconnect = controller.connect(bus);
  const facade = new RendererFacade({ stage, controller, monitor: new RenderPerformanceMonitor(), dialogueLayer: stage.dialogueLayer, worldLayer: stage.worldLayer });
  const registry = new SceneRegistry();
  const interpreter = new Interpreter(new VariableStore([]), bus, registry);
  interpreter.setPresentationHooks({
    snapshot: () => controller.snapshotPresentation(),
    validate: payload => controller.validatePresentation(payload),
    restore: payload => controller.restorePresentation(payload),
  });
  return {
    stage, ports, controller, bus, facade, interpreter, registry,
    dispose() { disconnect(); controller.dispose(); stage.destroy(); },
  };
}

function portraitAppearance(root: Container): { alpha: number; tint: number }[] {
  return root.children.flatMap(child => child instanceof Sprite && child.texture === Texture.WHITE
    ? [{ alpha: child.alpha, tint: child.tint }] : child instanceof Container ? portraitAppearance(child) : []);
}

describe('speaker focus through production presentation ports', () => {
  it('coordinates real controller text, typewriter updates, narration and speaker changes with portrait dimming', async () => {
    const runtime = await makeRuntime();
    try {
      runtime.bus.emit('text', { speaker: '凛', value: '正在说话。' });
      expect(runtime.stage.worldLayer.snapshotPresentation()).toMatchObject({ activeSpeakerId: 'lynn' });
      expect(portraitAppearance((runtime.stage.worldLayer as WorldLayer).worldContainer)).toEqual([{ alpha: 1, tint: 0xffffff }, { alpha: 1, tint: 0xc4cddd }]);
      runtime.controller.update(10_000);
      expect(runtime.stage.dialogueLayer.activeSpeakerId).toBe('lynn');
      runtime.bus.emit('text', { speaker: '澪', value: '' });
      expect(runtime.stage.worldLayer.snapshotPresentation()).toMatchObject({ activeSpeakerId: 'mio' });
      expect(portraitAppearance((runtime.stage.worldLayer as WorldLayer).worldContainer)).toEqual([{ alpha: 1, tint: 0xc4cddd }, { alpha: 1, tint: 0xffffff }]);
      for (const speaker of [null, '未配置角色']) {
        runtime.bus.emit('text', { speaker, value: '没有角色聚焦。' });
        expect(runtime.stage.worldLayer.snapshotPresentation()).toMatchObject({ activeSpeakerId: null });
        expect(portraitAppearance((runtime.stage.worldLayer as WorldLayer).worldContainer)).toEqual([{ alpha: 1, tint: 0xffffff }, { alpha: 1, tint: 0xffffff }]);
      }
      runtime.ports.commands.dialogue.setActiveSpeaker('lynn');
      expect(runtime.stage.worldLayer.snapshotPresentation()).toMatchObject({ activeSpeakerId: 'lynn' });
    } finally { runtime.dispose(); }
  });

  it.each([false, true])('captures and restores the speaker from actual interpreter dialogue (NVL=%s)', async nvl => {
    const runtime = await makeRuntime();
    try {
      runtime.registry.register(compileScene(`@scene focus\n${nvl ? '@nvl on\n' : ''}凛：第一行。\n澪：第二行。\n凛：第三行。\n@end`, 'focus.gal', 'focus'));
      runtime.interpreter.start('focus');
      runtime.interpreter.advance();
      runtime.controller.update(10_000);
      const saved = JSON.parse(JSON.stringify(runtime.interpreter.saveSnapshot()));
      expect(saved.presentation.payload.stage.activeSpeakerId).toBe('mio');
      runtime.interpreter.advance();
      expect(runtime.stage.worldLayer.snapshotPresentation()).toMatchObject({ activeSpeakerId: 'lynn' });
      runtime.interpreter.loadSnapshot(saved);
      runtime.controller.update(10_000);
      expect(runtime.stage.dialogueLayer.activeSpeakerId).toBe('mio');
      expect(runtime.stage.worldLayer.snapshotPresentation()).toMatchObject({ activeSpeakerId: 'mio' });
      expect(portraitAppearance((runtime.stage.worldLayer as WorldLayer).worldContainer)).toEqual([{ alpha: 1, tint: 0xc4cddd }, { alpha: 1, tint: 0xffffff }]);
    } finally { runtime.dispose(); }
  });

  it.each(['ports', 'facade'] as const)('clears ADV and coordinates NVL speakers through %s commands', async entry => {
    const runtime = await makeRuntime();
    try {
      const commands = runtime[entry].commands.dialogue;
      commands.showText('凛', '上一句。');
      commands.clearText!();
      expect(runtime.stage.worldLayer.snapshotPresentation()).toMatchObject({ activeSpeakerId: null });
      commands.setNvlMode(true);
      commands.appendNvlText('澪', '全屏文本。');
      expect(runtime.stage.dialogueLayer.activeSpeakerId).toBe('mio');
      expect(runtime.stage.worldLayer.snapshotPresentation()).toMatchObject({ activeSpeakerId: 'mio' });
      commands.appendNvlText(null, '旁白。');
      expect(runtime.stage.worldLayer.snapshotPresentation()).toMatchObject({ activeSpeakerId: null });
      commands.appendNvlText('凛', '清页前。');
      commands.clearNvlText();
      expect(runtime.stage.dialogueLayer.activeSpeakerId).toBeNull();
      expect(runtime.stage.worldLayer.snapshotPresentation()).toMatchObject({ activeSpeakerId: null });
    } finally { runtime.dispose(); }
  });
});
