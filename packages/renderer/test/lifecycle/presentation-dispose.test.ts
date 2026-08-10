import { describe, expect, it, vi } from 'vitest';
import { EventBus, type CoreEventMap } from '@surdet/core';
import { PresentationController } from '../../src/runtime/presentation-controller.js';
import { createPresentationPorts } from '../../src/runtime/presentation-ports.js';
import type { AdvStage } from '../../src/types.js';

function videoHarness(): {
  controller: PresentationController;
  bus: EventBus<CoreEventMap>;
  finishVideo: () => void;
  showVideo: ReturnType<typeof vi.fn>;
  hideVideo: ReturnType<typeof vi.fn>;
  onWaitEnd: ReturnType<typeof vi.fn>;
  frameRequest: ReturnType<typeof vi.fn>;
} {
  let finishVideo: () => void = () => undefined;
  const showVideo = vi.fn((_source: string, onEnd: () => void) => { finishVideo = onEnd; });
  const hideVideo = vi.fn();
  const onWaitEnd = vi.fn();
  const frameRequest = vi.fn();
  const stage = {
    showText: () => undefined,
    showChoices: () => undefined,
    hideChoices: () => undefined,
    showVideo,
    hideVideo,
  } as unknown as AdvStage;
  const ports = createPresentationPorts(stage);
  const controller = new PresentationController(ports.commands, ports.queries, undefined, {
    commands: ports.commands,
    queries: ports.queries,
    onWaitEnd,
  });
  controller.setFrameRequest(frameRequest);
  return { controller, bus: new EventBus<CoreEventMap>(), finishVideo: () => finishVideo(), showVideo, hideVideo, onWaitEnd, frameRequest };
}

function startVideo(harness: ReturnType<typeof videoHarness>): void {
  harness.controller.connect(harness.bus);
  harness.bus.emit('video', { src: 'cutscene.mp4' });
  harness.frameRequest.mockClear();
}

describe('PresentationController video invalidation on destroy/dispose', () => {
  it('destroy invalidates the old callback and hides an active video exactly once', () => {
    const harness = videoHarness();
    startVideo(harness);

    expect(harness.showVideo).toHaveBeenCalledOnce();
    harness.controller.destroy();
    harness.controller.destroy();
    harness.finishVideo();

    expect(harness.hideVideo).toHaveBeenCalledOnce();
    expect(harness.onWaitEnd).not.toHaveBeenCalled();
    expect(harness.frameRequest).not.toHaveBeenCalled();
  });

  it('dispose has the same invalidation and hide semantics as destroy', () => {
    const harness = videoHarness();
    startVideo(harness);

    harness.controller.dispose();
    harness.finishVideo();

    expect(harness.hideVideo).toHaveBeenCalledOnce();
    expect(harness.onWaitEnd).not.toHaveBeenCalled();
  });

  it('stateReset and resetSession continue invalidating old video callbacks independently', () => {
    const stateReset = videoHarness();
    startVideo(stateReset);
    stateReset.bus.emit('stateReset', { reason: 'load' });
    stateReset.finishVideo();
    expect(stateReset.onWaitEnd).not.toHaveBeenCalled();

    const resetSession = videoHarness();
    startVideo(resetSession);
    resetSession.controller.resetSession();
    resetSession.finishVideo();
    expect(resetSession.onWaitEnd).not.toHaveBeenCalled();
  });

  it('normal video completion invokes onWaitEnd at most once', () => {
    const harness = videoHarness();
    startVideo(harness);

    harness.finishVideo();
    harness.finishVideo();

    expect(harness.onWaitEnd).toHaveBeenCalledOnce();
    expect(harness.hideVideo).not.toHaveBeenCalled();
  });
});
