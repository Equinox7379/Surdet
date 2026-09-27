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
    expect(panelSource).toContain('timelineAssetChoices(state.dirAssets, state.gameConfigText)');
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

  it('provides pointer cancellation/capture and human-facing Timeline copy', () => {
    expect(panelSource).toContain('setPointerCapture');
    expect(panelSource).toContain('pointercancel');
    expect(panelSource).not.toMatch(/['"`]\+ cue|Cue 检查器|选择一个 cue|删除 cue/);
    expect(panelSource).toContain('适应窗口');
    expect(panelSource).toContain('片段设置');
  });

  it('keeps destructive selection, view state and project-resource choices coherent', () => {
    expect(panelSource).toContain('pendingTimelineRestores');
    expect(panelSource).toContain('timelineViewStates');
    expect(panelSource).toContain('canvasScrollLeft');
    expect(panelSource).toContain('rootContainer.isConnected');
    expect(panelSource).toContain("scroll.addEventListener('scroll'");
    expect(panelSource).toContain('ResizeObserver');
    expect(panelSource).toContain('timelineLayoutObserver');
    expect(panelSource).toContain('currentExpression');
    expect(panelSource).toContain('choice.expression === currentExpression');
    expect(panelSource).toContain('state.currentTimelineCue = { trackIndex, cueIndex };\n      commit(');
    expect(panelSource).toContain('删除轨道');
    expect(panelSource).toContain('前往素材工作区');
    expect(panelSource).toContain("block.classList.toggle('instant', cue.durationMs === 0)");
  });

  it('persists an explicit disclosure click before the deferred native toggle event', () => {
    expect(panelSource).toContain("summary.addEventListener('click', () => {\n    view.inspectorOpen = !inspector.open;\n  });");
    expect(panelSource).toContain("librarySummary.addEventListener('click', () => {\n    if (view) view.libraryOpen = !library.open;\n  });");
  });

  it('implements real search and keeps zero valid for signed numeric inputs', () => {
    expect(panelSource).toContain('search.oninput');
    expect(panelSource).toContain('item.hidden =');
    expect(panelSource).toContain('Number.isFinite(parsed)');
    expect(panelSource).not.toContain('Number(input.value) || min');
    expect(panelSource).toContain("{ left: '左侧', center: '中央', right: '右侧', custom: '自定义横坐标' }");
    expect(panelSource).toContain("custom: '自定义横坐标'");
    expect(panelSource).toContain("block.classList.toggle('instant-at-end', geometry.anchorAtEnd)");
    expect(panelSource).not.toContain('Math.max(-2000, Math.min(2000, parsed))');
  });

  it('provides editable targets for every non-audio track while retaining audio projection', () => {
    expect(panelSource).toContain("if (track.kind !== 'audio')");
    expect(panelSource).toContain('track-${trackIndex}-target');
    expect(panelSource).toContain("target.value.trim()");
    expect(panelSource).toContain('delete nextTrack.target');
    expect(panelSource).toContain("else if (track.target) {");
  });

  it('keeps the inspector controls aligned with every Core non-audio payload', () => {
    for (const control of [
      'createResourceCue',
      "typeof cue.expression === 'string'",
      "next.position = position.value",
      "setNumber('透明度', 'alpha'",
      "setNumber('缩放', 'scale'",
      "setNumber('水平偏移', 'x'",
      "setNumber('垂直偏移', 'y'",
      "setNumber('震动强度', 'strength'",
      "setNumber('颜色值', 'color'",
      "setString('粒子预设', 'kind'",
    ]) {
      expect(panelSource).toContain(control);
    }
    expect(panelSource).toContain("duration.dataset.timelineFocus = 'timeline-duration'");
    expect(panelSource).toContain("duration.title = '时间轴总时长（毫秒）'");
    expect(panelSource).toContain("if (track.kind === 'camera')");
    expect(panelSource).toContain("if (track.kind === 'screen')");
    expect(panelSource).toContain("if (track.kind === 'particle' && cue.action === 'start')");
  });
});
