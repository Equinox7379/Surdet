import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createPlayerShellController,
  createPlayerUiSession,
  createRendererPlayerShellSlots,
} from '@surdet/host';
import { createRendererTheme } from '@surdet/renderer';

const zeroMain = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('Zero public player shell coordination', () => {
  it('uses the shared Host controller, six-slot defaults and Renderer theme contract', () => {
    expect(zeroMain).toContain('createPlayerShellController');
    expect(zeroMain).toContain('createRendererPlayerShellSlots');
    expect(zeroMain).toContain('createRendererTheme');
    expect(zeroMain).toContain('createPlayerUiSession');
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
});
