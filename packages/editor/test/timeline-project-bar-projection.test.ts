import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bindTimelineHooks, selectTimelineCue } from '../src/panels/timeline-panel.js';
import { state } from '../src/state.js';

const mainSource = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
const panelSource = readFileSync(fileURLToPath(new URL('../src/panels/timeline-panel.ts', import.meta.url)), 'utf8');

afterEach(() => {
  bindTimelineHooks({ onPreview: () => {} });
  state.currentTimeline = null;
  state.currentTimelineCue = null;
});

describe('timeline project bar projection hook', () => {
  it('publishes timeline selection changes even before a timeline surface is mounted', () => {
    const onSelectionChanged = vi.fn();
    bindTimelineHooks({
      onPreview: vi.fn(),
      onSelectionChanged,
    });

    selectTimelineCue('opening', 0, 0);

    expect(state.currentTimeline).toBe('opening');
    expect(state.currentTimelineCue).toEqual({ trackIndex: 0, cueIndex: 0 });
    expect(onSelectionChanged).toHaveBeenCalledTimes(1);
  });

  it('clears the shared cue selection when selecting only a different timeline', () => {
    selectTimelineCue('opening', 2, 3);
    selectTimelineCue('ending');

    expect(state.currentTimeline).toBe('ending');
    expect(state.currentTimelineCue).toBeNull();
  });

  it('routes timeline undo separately and keeps cue selection out of panel-local state', () => {
    expect(mainSource).toMatch(/state\.mainTab === 'timeline'[\s\S]*applyTimelineHistory\('undo'\)/);
    expect(mainSource).toMatch(/state\.mainTab === 'timeline'[\s\S]*applyTimelineHistory\('redo'\)/);
    expect(panelSource).toContain('pushTimelineSnapshot');
    expect(panelSource).not.toMatch(/let\s+selectedCue\s*:/);
  });
});
