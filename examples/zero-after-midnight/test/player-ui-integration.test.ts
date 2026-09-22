import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CalendarRunner,
  compileScene,
  EventBus,
  EventScheduler,
  Interpreter,
  SceneRegistry,
  VariableStore,
} from '@surdet/core';
import { createDefaultHost } from '@surdet/host';
import {
  createPlayerShellController,
  createPlayerUiSession,
  createRendererPlayerShellSlots,
} from '@surdet/host';
import { createRendererTheme } from '@surdet/renderer';
import { createSystemAdapters as createSharedSystemAdapters } from '../../shared/player/system-adapters.js';
import { createSystemAdapters as createZeroSystemAdapters } from '../src/system-adapters.js';

const zeroMain = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const sharedPlayer = readFileSync(new URL('../../shared/player/player.ts', import.meta.url), 'utf8');

function sourceBlock(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `${startMarker} should exist`).toBeGreaterThanOrEqual(0);
  expect(end, `${endMarker} should follow ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

async function runCalendarHeadEvent(kind: 'shared' | 'zero'): Promise<{
  reward: unknown;
  fired: boolean;
  texts: string[];
  maps: number;
  resumeSnapshot: unknown;
  errors: unknown[];
}> {
  const store = new VariableStore([{ name: 'reward', type: 'number', initial: 0 }]);
  const bus = new EventBus();
  const registry = new SceneRegistry();
  registry.register(compileScene('@calendar map\n地图结束后的正文。\n@end', 'start.gal', 'start'));
  registry.register(compileScene('必须显示的一次性演出。\n@end', 'cutscene.gal', 'cutscene'));
  const interpreter = new Interpreter(store, bus, registry);
  const calendar = new CalendarRunner(
    { nodes: [], maxAp: 2, maxTurns: 10, dateTemplate: '第{turn}回合' },
    { getVariable: (name) => store.get(name) },
  );
  const scheduler = new EventScheduler(
    [{ id: 'opening', when: 'true', once: true, scene: 'cutscene', effects: { reward: 1 } }],
    { getVariable: (name) => store.get(name) },
  );
  let maps = 0;
  let resumeSnapshot: unknown = null;
  const texts: string[] = [];
  const errors: unknown[] = [];
  const renderer = {
    showMap: (_view: unknown, _onEnter: (nodeId: string) => void, _onEndTurn: () => void) => { maps += 1; },
    hideMap: () => undefined,
    showBaseCommands: () => undefined,
    hideBaseCommands: () => undefined,
    showBattle: () => undefined,
    hideBattle: () => undefined,
    showShop: () => undefined,
    hideShop: () => undefined,
  };
  const options = {
    interpreter,
    renderer,
    store,
    registry,
    calendar,
    scheduler,
    onTurnResumeSnapshot: (snapshot: unknown) => { resumeSnapshot = snapshot; },
  };
  const adapters = kind === 'shared'
    ? createSharedSystemAdapters(options)
    : createZeroSystemAdapters(options);
  const host = createDefaultHost({ interpreter, renderer, adapters, onError: (error) => { errors.push(error); } });
  let routed: Promise<boolean> | undefined;
  bus.on('text', ({ value }) => { texts.push(value); });
  bus.on('system', (payload) => { routed = host.routeSystem(payload.type, payload); });
  try {
    interpreter.start('start');
    await routed;
    return {
      reward: store.get('reward'),
      fired: scheduler.isFired('opening'),
      texts,
      maps,
      resumeSnapshot,
      errors,
    };
  } finally {
    host.dispose();
  }
}

describe('Zero public player shell coordination', () => {
  it('uses the shared Host controller, six-slot defaults and Renderer theme contract', () => {
    expect(zeroMain).toContain('createPlayerShellController');
    expect(zeroMain).toContain('createRendererPlayerShellSlots');
    expect(zeroMain).toContain('createRendererTheme');
    expect(zeroMain).toContain('createPlayerUiSession');
    expect(zeroMain).toContain('createRollbackRuntime');
    expect(zeroMain).toContain('clearRollbackForBoundary');
    expect(zeroMain).toContain('connectInterpreterPresentation');
    expect(zeroMain).toContain('enterPlayerTitleSession');
    expect(zeroMain).toContain('presentationConnection.disconnect()');
    expect(zeroMain).not.toContain('preserveWorld: true');
    expect(zeroMain).not.toContain("from '../../shared/rollback-runtime.js'");
    expect(zeroMain).not.toMatch(/new PlayerInputGate\(\)/);
    expect(zeroMain).not.toMatch(/uiSession\.(openOverlay|closeOverlay|beginOperation|completeOperation|failOperation|reset|enterGame|enterTitle)/);
    expect(zeroMain).not.toMatch(/inputGate\.decidePointer/);
  });

  it('keeps the public theme result immutable', () => {
    expect(typeof createPlayerShellController).toBe('function');
    expect(typeof createPlayerUiSession).toBe('function');
    expect(typeof createRendererPlayerShellSlots).toBe('function');
    expect(Object.isFrozen(createRendererTheme({ colors: { accent: 0x47c8ff } }))).toBe(true);
  });

  it('wires backup metadata and explicit restore through the normal load path', () => {
    expect(zeroMain).toContain('listBackupMeta');
    expect(zeroMain).toContain('restoreBackup');
    expect(zeroMain).toContain('backupAvailable');
    expect(zeroMain).toContain('onRestore');
  });

  it.each([
    ['shared Player', sharedPlayer],
    ['Zero Player', zeroMain],
  ] as const)('keeps %s Ctrl temporary skip owned by one hold', (_label, source) => {
    const block = sourceBlock(source, '// Ctrl 按住临时快进', 'function routeGameAction');
    expect(block).toContain('e.repeat');
    expect(block).toContain('ctrlTempSkip');
    expect(block).toContain('if (renderer.skipMode)');
    expect(block).toContain("window.addEventListener('blur'");
    expect(block).toMatch(/stateReset[\s\S]*releaseCtrlTempSkip/);
  });

  it.each(['shared', 'zero'] as const)('routes a once calendar head event scene exactly once (%s)', async (kind) => {
    const result = await runCalendarHeadEvent(kind);
    expect(result.reward).toBe(1);
    expect(result.fired).toBe(true);
    expect(result.texts).toEqual(['必须显示的一次性演出。']);
    expect(result.maps).toBe(0);
    expect(result.resumeSnapshot).toMatchObject({ position: { sceneId: 'start' } });
    expect(result.errors).toEqual([]);
  });
});
