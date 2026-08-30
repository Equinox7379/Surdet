import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindTimelineHooks, selectTimelineCue } from '../src/panels/timeline-panel.js';
import { state } from '../src/state.js';

afterEach(() => {
  bindTimelineHooks({ onPreview: () => {} });
  state.currentTimeline = null;
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
    expect(onSelectionChanged).toHaveBeenCalledTimes(1);
  });
});
