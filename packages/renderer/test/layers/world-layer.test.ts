import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Container, Sprite, Texture } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderLifecycle } from '../../src/lifecycle/render-lifecycle.js';
import { RenderAssetRegistry } from '../../src/services/render-asset-registry.js';
import { WorldLayer, type WorldPresentationSnapshot } from '../../src/layers/world/world-layer.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface WorldRuntime {
  readonly root: Container;
  readonly layer: WorldLayer;
  readonly lifecycle: RenderLifecycle;
  readonly assets: RenderAssetRegistry;
  readonly requests: { count: number };
}

function makeRuntime(): WorldRuntime {
  const root = new Container();
  const lifecycle = new RenderLifecycle();
  const assets = new RenderAssetRegistry({ lifecycle });
  const requests = { count: 0 };
  const layer = new WorldLayer({
    width: 1280,
    height: 720,
    assets,
    lifecycle,
    requestFrame: () => { requests.count += 1; },
    captureThumbnail: () => 'thumbnail',
  });
  root.addChild(
    layer.worldContainer,
    layer.particleContainer,
    layer.screenContainer,
    layer.wipeOverlay,
    layer.fadeOverlay,
    layer.flashOverlay,
  );
  return { root, layer, lifecycle, assets, requests };
}

async function registerWorldAssets(assets: RenderAssetRegistry): Promise<void> {
  await assets.registerBackground('hall', Texture.EMPTY);
  await assets.registerBackground('night', Texture.WHITE);
  await assets.registerPortrait('lynn', 'armor', 'normal', Texture.EMPTY);
  await assets.registerPortrait('lynn', 'casual', 'happy', Texture.WHITE);
  await assets.registerPortrait('mio', 'uniform', 'normal', Texture.EMPTY);
}

function disposeRuntime(runtime: WorldRuntime): void {
  runtime.layer.dispose();
  runtime.assets.dispose();
  runtime.lifecycle.dispose();
}

function findSprite(root: Container, width: number): Sprite {
  const visit = (container: Container): Sprite | undefined => {
    for (const child of container.children) {
      if (child instanceof Sprite && child.width === width) return child;
      if (child instanceof Container) {
        const found = visit(child);
        if (found) return found;
      }
    }
    return undefined;
  };
  const found = visit(root);
  expect(found).toBeDefined();
  return found as Sprite;
}

function findSprites(root: Container): Sprite[] {
  const sprites: Sprite[] = [];
  const visit = (container: Container): void => {
    for (const child of container.children) {
      if (child instanceof Sprite) sprites.push(child);
      if (child instanceof Container) visit(child);
    }
  };
  visit(root);
  return sprites;
}

function snapshot(runtime: WorldRuntime): WorldPresentationSnapshot {
  return runtime.layer.snapshotPresentation();
}

describe('WorldLayer direct presentation contract', () => {
  it('projects backgrounds, composite portraits, focus dimming, replacement, and character removal', async () => {
    const runtime = makeRuntime();
    try {
      await registerWorldAssets(runtime.assets);
      runtime.layer.setBackground('hall');
      runtime.layer.setPortrait('lynn:armor', {
        charId: 'lynn', costume: 'armor', expression: 'normal', pos: 'left',
      });
      runtime.layer.setPortrait('lynn:casual', {
        charId: 'lynn', costume: 'casual', expression: 'happy', pos: 'right',
      });
      runtime.layer.setPortrait('mio:uniform', {
        charId: 'mio', costume: 'uniform', expression: 'normal', pos: 'center',
      });
      runtime.layer.setPortraitFocus('lynn');

      expect(snapshot(runtime).backgroundKey).toBe('hall');
      expect(snapshot(runtime).portraits).toHaveLength(3);
      expect(findSprite(runtime.layer.worldContainer, 430).alpha).toBe(1);
      expect(findSprites(runtime.layer.worldContainer).map((sprite) => sprite.alpha)).toEqual(
        expect.arrayContaining([1, 0.46]),
      );

      runtime.layer.setBackground('night');
      expect(snapshot(runtime).backgroundKey).toBe('night');
      runtime.layer.removePortrait('lynn');
      expect(snapshot(runtime).portraits.map((entry) => entry.key)).toEqual(['mio:uniform']);
      runtime.layer.removePortrait('lynn');
      runtime.layer.removePortrait('mio:uniform');
      expect(snapshot(runtime).portraits).toEqual([]);
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('covers move, fade, shake directions, transitions, flash, zoom, wipe, tint, and particles', async () => {
    const runtime = makeRuntime();
    try {
      await registerWorldAssets(runtime.assets);
      runtime.layer.setPortrait('lynn:armor', {
        charId: 'lynn', costume: 'armor', expression: 'normal', pos: 'center',
      });
      const portrait = findSprite(runtime.layer.worldContainer, 430);
      runtime.layer.movePortrait('lynn:armor', 'right', 100);
      runtime.layer.update(50);
      expect(portrait.x).toBeCloseTo(800, 5);

      runtime.layer.setFade(0.4);
      expect(runtime.layer.fadeOverlay.alpha).toBeCloseTo(0.4);
      expect(runtime.layer.transition('fade', 100)).toBe(true);
      expect(runtime.layer.transition('not-registered', 100)).toBe(false);
      runtime.layer.update(100);
      expect(runtime.layer.worldContainer.alpha).toBe(1);

      vi.spyOn(Math, 'random').mockReturnValue(0.75);
      for (const direction of ['both', 'horizontal', 'vertical', 'diagonal'] as const) {
        runtime.layer.shake(100, 12, direction);
        runtime.layer.update(50);
        runtime.layer.update(50);
      }
      runtime.layer.flash(100);
      expect(runtime.layer.flashOverlay.alpha).toBe(1);
      runtime.layer.zoom(1.5, 100);
      runtime.layer.wipe(100);
      runtime.layer.setTint(0xff0000, 0.4, 100);
      runtime.layer.startParticles('snow');
      expect(runtime.layer.particleContainer.children.length).toBeGreaterThan(0);
      runtime.layer.update(50);
      expect(snapshot(runtime).cameraScale).toBeCloseTo(1.25, 5);
      expect(snapshot(runtime).tint.alpha).toBeCloseTo(0.2, 5);
      runtime.layer.clearTint(100);
      runtime.layer.stopParticles();
      runtime.layer.update(100);
      expect(runtime.layer.particleContainer.children).toHaveLength(0);
      expect(runtime.layer.wipeOverlay.visible).toBe(false);
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('applies timeline frames, preserves reduced-motion and quality/post-process contracts, and requests frames', async () => {
    const runtime = makeRuntime();
    try {
      await registerWorldAssets(runtime.assets);
      runtime.layer.setBackground('hall');
      runtime.layer.setPortrait('lynn:armor', {
        charId: 'lynn', costume: 'armor', expression: 'normal', pos: 'left',
      });
      const panCue = { atMs: 0, durationMs: 100, easing: 'linear' as const, action: 'pan' as const, x: 180, y: -40 };
      runtime.layer.applyTimelineFrame({ track: 'camera', cue: panCue, started: true, final: false, progress: 0.5, elapsedMs: 50 });
      expect(snapshot(runtime).cameraPan).toEqual({ x: 90, y: -20 });
      runtime.layer.applyTimelineFrame({ track: 'camera', cue: panCue, started: false, final: true, progress: 1, elapsedMs: 100 });
      expect(snapshot(runtime).cameraPan).toEqual({ x: 180, y: -40 });

      const tintCue = { atMs: 0, durationMs: 100, easing: 'linear' as const, action: 'tint' as const, color: 0xff0000, alpha: 0.4 };
      runtime.layer.applyTimelineFrame({ track: 'screen', cue: tintCue, started: true, final: false, progress: 0.5, elapsedMs: 50 });
      expect(snapshot(runtime).tint).toEqual({ color: 0xff0000, alpha: 0.2 });
      runtime.layer.applyTimelineFrame({ track: 'screen', cue: tintCue, started: false, final: true, progress: 1, elapsedMs: 100 });
      expect(snapshot(runtime).tint).toEqual({ color: 0xff0000, alpha: 0.4 });

      runtime.layer.setPresentationPreferences({ reducedMotion: true });
      expect(runtime.layer.getPresentationPreferences().transitionScale).toBe(0);
      runtime.layer.transition('fade', 100);
      runtime.layer.update(1);
      expect(runtime.layer.needsUpdate).toBe(false);
      runtime.layer.setQuality('high');
      expect(runtime.layer.getQuality()).toBe('high');
      runtime.layer.setPostProcess({ enabled: true, saturation: 0.8 });
      expect(runtime.layer.getPostProcess()).toMatchObject({ enabled: true, saturation: 0.8 });
      expect(runtime.layer.captureThumbnail()).toBe('thumbnail');
      expect(runtime.requests.count).toBeGreaterThan(0);
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('restores valid snapshots atomically and rejects invalid snapshots without partial mutation', async () => {
    const runtime = makeRuntime();
    try {
      await registerWorldAssets(runtime.assets);
      runtime.layer.setBackground('hall');
      runtime.layer.setPortrait('lynn:armor', {
        charId: 'lynn', costume: 'armor', expression: 'normal', pos: 'left',
      });
      runtime.layer.setTint(0x123456, 0.25, 1);
      const before = snapshot(runtime);
      expect(() => runtime.layer.restorePresentation({
        version: 1,
        backgroundKey: 'night',
        portraits: [{ key: 'broken', view: { charId: 42, costume: 'armor', expression: 'normal', pos: 'left' } }],
        cameraScale: 1,
      })).toThrowError(expect.objectContaining({ code: 'PRESENTATION_SNAPSHOT_INVALID' }));
      expect(snapshot(runtime)).toEqual(before);

      const valid = {
        ...before,
        backgroundKey: 'night',
        cameraScale: 1.4,
        cameraPan: { x: 20, y: -10 },
      } satisfies WorldPresentationSnapshot;
      runtime.layer.restorePresentation(valid);
      expect(snapshot(runtime)).toMatchObject({ backgroundKey: 'night', cameraScale: 1.4, cameraPan: { x: 20, y: -10 } });

      runtime.layer.reset({ preserveWorld: true });
      expect(snapshot(runtime)).toMatchObject({
        backgroundKey: 'night',
        portraits: before.portraits,
        cameraScale: 1,
        cameraPan: { x: 0, y: 0 },
      });

      runtime.layer.clearPresentation();
      expect(snapshot(runtime)).toMatchObject({ backgroundKey: null, portraits: [], cameraScale: 1, cameraPan: { x: 0, y: 0 }, particleKind: null });
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('invalidates every pending visual effect before applying a rollback snapshot', async () => {
    const runtime = makeRuntime();
    try {
      await registerWorldAssets(runtime.assets);
      runtime.layer.setBackground('hall');
      runtime.layer.setPortrait('lynn:armor', {
        charId: 'lynn', costume: 'armor', expression: 'normal', pos: 'left',
      });
      const target = snapshot(runtime);

      runtime.layer.transition('fade', 1_000);
      runtime.layer.setFade(1);
      runtime.layer.setTint(0xff0000, 1, 1_000);
      runtime.layer.flash(1_000);
      runtime.layer.zoom(1.6, 1_000);
      runtime.layer.wipe(1_000);
      runtime.layer.movePortrait('lynn:armor', 'right', 1_000);
      runtime.layer.shake(1_000, 12);
      runtime.layer.startParticles('snow');

      runtime.layer.restorePresentation(target);
      runtime.layer.update(2_000);

      expect(snapshot(runtime)).toEqual(target);
      expect(runtime.layer.needsUpdate).toBe(false);
      expect(runtime.lifecycle.snapshot().activeTweens).toBe(0);
      expect(runtime.layer.fadeOverlay.alpha).toBe(0);
      expect(runtime.layer.wipeOverlay.visible).toBe(false);
      expect(runtime.layer.flashOverlay.alpha).toBe(0);
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('preserves the active speaker projection across clear and restore', async () => {
    const runtime = makeRuntime();
    try {
      await registerWorldAssets(runtime.assets);
      const lynn = { charId: 'lynn', costume: 'armor', expression: 'normal', pos: 'left' } as const;
      const mio = { charId: 'mio', costume: 'uniform', expression: 'normal', pos: 'right' } as const;
      runtime.layer.setPortrait('lynn:armor', lynn);
      runtime.layer.setPortrait('mio:uniform', mio);
      runtime.layer.setPortraitFocus('lynn');
      const saved = snapshot(runtime);

      runtime.layer.clearPresentation();
      runtime.layer.setPortrait('lynn:armor', lynn);
      runtime.layer.setPortrait('mio:uniform', mio);
      expect(findSprites(runtime.layer.worldContainer).map((sprite) => sprite.alpha)).toEqual([1, 0.46]);

      runtime.layer.setPortraitFocus('mio');
      runtime.layer.restorePresentation(saved);
      expect(findSprites(runtime.layer.worldContainer).map((sprite) => sprite.alpha)).toEqual([0.46, 1]);
    } finally {
      disposeRuntime(runtime);
    }
  });

  it('keeps world-only dependencies and performs two stable 50-cycle batches', async () => {
    const sourcePath = fileURLToPath(new URL('../../src/layers/world/world-layer.ts', import.meta.url));
    const source = readFileSync(sourcePath, 'utf8');
    expect(source).not.toMatch(/from ['"][^'"]*(?:@surdet\/core|interpreter|variable-store|combat|calendar|shop|host)[^'"]*['"]/i);
    expect(source).not.toMatch(/from ['"][^'"]*\/layers\/(?!world)[^'"]*['"]/i);

    const lifecycle = new RenderLifecycle();
    const assets = new RenderAssetRegistry({ lifecycle });
    await assets.registerBackground('hall', Texture.EMPTY);
    await assets.registerPortrait('lynn', 'uniform', 'normal', Texture.EMPTY);
    const runBatch = (): ReturnType<RenderLifecycle['snapshot']> => {
      for (let i = 0; i < 50; i++) {
        const root = new Container();
        const layer = new WorldLayer({ width: 1280, height: 720, assets, lifecycle });
        root.addChild(layer.worldContainer, layer.particleContainer, layer.screenContainer, layer.wipeOverlay, layer.fadeOverlay, layer.flashOverlay);
        layer.setBackground('hall');
        layer.setPortrait('lynn:uniform', { charId: 'lynn', costume: 'uniform', expression: 'normal', pos: 'left' });
        layer.transition('slide-left', 100);
        layer.startParticles('rain');
        layer.update(100);
        layer.reset();
        layer.dispose();
        expect(root.children).toHaveLength(0);
      }
      return lifecycle.snapshot();
    };
    try {
      const first = runBatch();
      const second = runBatch();
      expect(second).toEqual(first);
      expect(second.listeners).toBe(0);
      expect(second.activeTweens).toBe(0);
      expect(second.displayObjectsByOwner.world).toBe(0);
    } finally {
      assets.dispose();
      lifecycle.dispose();
    }
  });
});
