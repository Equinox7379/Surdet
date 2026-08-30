import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const panelSource = readFileSync(fileURLToPath(new URL('../src/panels/timeline-panel.ts', import.meta.url)), 'utf8');
const mainSource = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

describe('Timeline panel project-asset and freshness contract', () => {
  it('does not inject Starter-specific asset placeholders', () => {
    expect(panelSource).not.toMatch(/castle_hall|lynn:uniform|tense_01/);
  });

  it('stages resource cues from the real project inventory before committing', () => {
    expect(panelSource).toContain('timelineAssetChoices(state.dirAssets)');
    expect(panelSource).toContain('createResourceCue');
    expect(panelSource).toContain('当前项目没有可用素材');
    expect(panelSource).toMatch(/if \(!draft\)[\s\S]*return;[\s\S]*commit\(/);
  });

  it('keeps Timeline edits on the shared validation and Authoring-index path', () => {
    expect(mainSource).toMatch(/function handleTimelineEdited\(\)[\s\S]*markProjectEdited\(\);[\s\S]*scheduleValidate\(\);[\s\S]*scheduleAuthoringIndexRebuild\(\);/);
    expect(mainSource).toContain('onEdited: handleTimelineEdited');
  });

  it('renders the real panel through natural ticks and Chinese label projections', () => {
    expect(panelSource).toContain('buildTimelineTicks');
    expect(panelSource).toContain('timelineTrackLabel');
    expect(panelSource).toContain('timelineActionLabel');
    expect(panelSource).toContain('timelineEasingLabel');
    expect(panelSource).not.toContain('Math.max(4, Math.ceil(durationMs / 500))');
  });
});
