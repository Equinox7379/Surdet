import { Container, Text as PText, type FederatedPointerEvent } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { CommandRailItem } from '../../src/types.js';
import { DialogueLayer } from '../../src/layers/dialogue/dialogue-layer.js';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';

interface DialogueRuntime {
  readonly root: Container;
  readonly layer: DialogueLayer;
  readonly lifecycle: RenderLifecycle;
  readonly assets: RenderAssetRegistry;
  readonly requestFrame: ReturnType<typeof vi.fn>;
}

const railItems: CommandRailItem[] = [
  { id: 'auto', label: '自动', icon: 'A' },
  { id: 'menu', label: '菜单', icon: 'M', enabled: false },
];

function makeRuntime(): DialogueRuntime {
  const root = new Container();
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const requestFrame = vi.fn();
  const layer = new DialogueLayer({
    uiLayer: root,
    width: 1280,
    height: 720,
    assets,
    lifecycle,
    requestFrame,
  });
  return { root, layer, lifecycle, assets, requestFrame };
}

function disposeRuntime(runtime: DialogueRuntime): void {
  runtime.layer.dispose();
  runtime.assets.dispose();
  runtime.lifecycle.dispose();
}

function commandRailRoot(root: Container): Container {
  const dialogueRoot = root.children[0];
  expect(dialogueRoot).toBeInstanceOf(Container);
  const rail = (dialogueRoot as Container).children[6];
  expect(rail).toBeInstanceOf(Container);
  return rail as Container;
}

function alphaSnapshot(layer: DialogueLayer): number {
  return (layer.debugSnapshot() as unknown as { commandRailAlpha: number }).commandRailAlpha;
}

describe('DialogueLayer command rail stability', () => {
  it('keeps the command rail fully visible and idle after show and a long wait', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.showCommandRail(railItems, () => undefined);

      expect(alphaSnapshot(runtime.layer)).toBe(1);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);

      runtime.layer.update(5000);

      expect(alphaSnapshot(runtime.layer)).toBe(1);
      expect(runtime.layer.needsUpdate()).toBe(false);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('does not wake a whole-rail tween when items are rebuilt repeatedly', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.showCommandRail(railItems, () => undefined);
      runtime.requestFrame.mockClear();

      for (let index = 0; index < 20; index += 1) {
        runtime.layer.setCommandRailItems([
          { ...railItems[0]!, label: `自动-${index}` },
          railItems[1]!,
        ]);
      }

      expect(alphaSnapshot(runtime.layer)).toBe(1);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);
      expect(runtime.layer.needsUpdate()).toBe(false);
      expect(runtime.requestFrame).toHaveBeenCalled();
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('limits hover changes to the target row without waking the rail', () => {
    const runtime = makeRuntime();
    try {
      runtime.layer.showCommandRail(railItems, () => undefined);
      const rail = commandRailRoot(runtime.root);
      const row = rail.children[1] as Container;
      const label = row.children[2] as PText;
      expect(label.alpha).toBe(0);

      row.emit('pointerover', {} as FederatedPointerEvent);
      expect(label.alpha).toBe(1);
      expect(alphaSnapshot(runtime.layer)).toBe(1);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);

      row.emit('pointerout', {} as FederatedPointerEvent);
      expect(label.alpha).toBe(0);
      expect(alphaSnapshot(runtime.layer)).toBe(1);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);
    } finally {
      disposeRuntime(runtime);
    }
  });
});
