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
});
