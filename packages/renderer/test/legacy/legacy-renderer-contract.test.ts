import { describe, expect, it } from 'vitest';
import { AdvRenderer } from '../../src/legacy/legacy-renderer-adapter.js';
import type { AdvStage } from '../../src/types.js';

const stage = {
  setBackground() {},
  setPortrait() {},
  removePortrait() {},
  showText() {},
  showChoices() {},
  hideChoices() {},
  setFade() {},
} as AdvStage;

const rendererMethods = [
  'setFrameRequest', 'connect', 'disconnect', 'subscribe', 'destroy', 'dispose', 'reset',
  'resetSession', 'update', 'setTextSpeed', 'setAutoWait', 'toggleBacklog', 'toggleHideInterface',
  'focusBacklogSearch', 'appendBacklogSearch', 'scrollBacklog', 'backspaceBacklogSearch',
  'handleBacklogEscape', 'toggleAuto', 'toggleSkip', 'toggleSkipAll', 'advance', 'select',
  'choiceUp', 'choiceDown', 'choiceConfirm', 'selectChoiceAt', 'dispatchInput', 'backlogEntries',
  'snapshotPresentation', 'validatePresentation', 'clearPresentation', 'restorePresentation',
] as const;

const rendererGetters = [
  'presentationOwnsStage', 'status', 'needsUpdate', 'interfaceHidden', 'backlogOpen',
  'backlogSearchQuery', 'skipAll', 'autoPlay', 'skipMode',
] as const;

describe('legacy renderer adapter contract', () => {
  it('keeps the complete historical AdvRenderer method and getter surface', () => {
    const renderer = new AdvRenderer(stage);
    try {
      for (const method of rendererMethods) expect(typeof (renderer as unknown as Record<string, unknown>)[method]).toBe('function');
      for (const getter of rendererGetters) expect((renderer as unknown as Record<string, unknown>)[getter]).toBeDefined();
    } finally {
      renderer.dispose();
    }
  });
});
