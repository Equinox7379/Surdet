import { describe, expect, it } from 'vitest';
import { actionForKeyboardEvent, bindingsForPreset, type GameAction } from '../src/keybindings.js';

describe('keybindings', () => {
  it('provides duplicate-free standard and left-handed presets', () => {
    for (const preset of ['standard', 'left-handed'] as const) {
      const bindings = bindingsForPreset(preset);
      const codes = Object.values(bindings).flatMap((values) => [...values]);
      expect(new Set(codes).size).toBe(codes.length);
      expect(bindings.quickSave).toContain('F5');
      expect(bindings.quickLoad).toContain('F9');
    }
  });

  it('maps safe keyboard events to actions and rejects browser/system chords', () => {
    expect(actionForKeyboardEvent({ code: 'Space', ctrlKey: false, altKey: false, metaKey: false }, 'standard')).toBe<GameAction>('advance');
    expect(actionForKeyboardEvent({ code: 'F5', ctrlKey: false, altKey: false, metaKey: false }, 'standard')).toBe('quickSave');
    expect(actionForKeyboardEvent({ code: 'F5', ctrlKey: true, altKey: false, metaKey: false }, 'standard')).toBeNull();
    expect(actionForKeyboardEvent({ code: 'KeyL', ctrlKey: false, altKey: true, metaKey: false }, 'standard')).toBeNull();
    expect(actionForKeyboardEvent({ code: 'KeyA', ctrlKey: false, altKey: false, metaKey: true }, 'standard')).toBeNull();
  });

  it('does not expose arbitrary keys through the preset API', () => {
    const bindings = bindingsForPreset('standard');
    expect(bindings).not.toHaveProperty('userDefined');
    expect(actionForKeyboardEvent({ code: 'KeyZ', ctrlKey: false, altKey: false, metaKey: false }, 'standard')).toBeNull();
  });
});
