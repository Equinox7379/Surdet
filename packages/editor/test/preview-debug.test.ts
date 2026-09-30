import { describe, expect, it } from 'vitest';
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore, type CoreEventMap } from '@surdet/core';
import { debugInstructionOptions, validDebugBreakpoints, parsePreviewDebugCommand, normalizePreviewDebugState } from '../src/preview-debug.js';

const scenes = [{ id: 'main', text: '@scene main\n@set trust = 3\n旁白：继续。\n@end' }];

describe('version-bound preview debugging', () => {
  it('uses exact Core instruction locations and refuses to relocate after text changes', () => {
    const points = debugInstructionOptions(scenes, 'main');
    expect(points[1]).toMatchObject({ sceneId: 'main', index: 1, line: 2 });
    expect(validDebugBreakpoints([points[1]!], scenes)).toEqual([points[1]]);
    expect(validDebugBreakpoints([points[1]!], [{ ...scenes[0]!, text: '@scene main\n旁白：新增。\n' + scenes[0]!.text.split('\n').slice(1).join('\n') }])).toEqual([]);
    expect(validDebugBreakpoints([points[1]!], [{ ...scenes[0]!, text: '@scene main\n@if' }])).toEqual([]);
  });
  it('rejects old frame identities and malformed breakpoint requests before execution', () => {
    const command = { type: 'surdet-preview-debug-command', action: 'step', traceId: 'current', generation: 2 };
    expect(parsePreviewDebugCommand(command, 'current', 2)).toEqual(command);
    expect(parsePreviewDebugCommand(command, 'old', 2)).toBeNull();
    expect(parsePreviewDebugCommand(command, 'current', 3)).toBeNull();
    expect(parsePreviewDebugCommand({ ...command, action: 'set-variable' }, 'current', 2)).toBeNull();
    expect(parsePreviewDebugCommand({ ...command, action: ['step'] }, 'current', 2)).toBeNull();
    expect(parsePreviewDebugCommand({ ...command, action: 'breakpoints', breakpoints: [{ index: -1 }] }, 'current', 2)).toBeNull();
  });
  it('projects the actual interpreter state, including the pre-execution location', () => {
    const registry = new SceneRegistry(); registry.register(compileScene(scenes[0]!.text, 'main.gal', 'main'));
    const interp = new Interpreter(new VariableStore([{ name: 'trust', type: 'number', initial: 0 }]), new EventBus<CoreEventMap>(), registry);
    interp.configureDebugger({ enabled: true, pauseOnStart: true }); interp.start('main');
    const message = { type: 'surdet-preview-debug-state', traceId: 'current', generation: 2, snapshot: interp.debugSnapshot() };
    expect(normalizePreviewDebugState(message)).toEqual(message);
    expect(normalizePreviewDebugState({ ...message, snapshot: { ...message.snapshot, next: { line: 1 } } })).toBeNull();
    expect(normalizePreviewDebugState({ ...message, snapshot: { ...message.snapshot, status: ['paused'] } })).toBeNull();
  });
});
