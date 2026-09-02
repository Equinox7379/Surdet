import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

function functionSource(name: string, nextName: string): string {
  const start = mainSource.indexOf(`function ${name}(`);
  const end = mainSource.indexOf(`function ${nextName}(`, start + 1);
  expect(start, `${name} should exist`).toBeGreaterThanOrEqual(0);
  expect(end, `${nextName} should follow ${name}`).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

describe('timeline autosave conflict main integration', () => {
  it('keeps structured conflicts as the single pending UI state', () => {
    expect(mainSource).toMatch(
      /let pendingAutosaveTimelineConflicts:\s*TimelineAutosaveRestoreConflict\[\]\s*=\s*\[\]/,
    );
    expect(mainSource).toMatch(/quarantineTimelineAutosaveEntries\(quarantinedEntries\)/);
    expect(mainSource).toMatch(
      /pendingAutosaveTimelineConflicts\s*=\s*mergeTimelineAutosaveConflicts\(\[[\s\S]*?\.\.\.quarantinedConflicts[\s\S]*?\.\.\.timelineRecovery\.conflicts/,
    );
    expect(mainSource).toMatch(
      /payload\?\.timelineConflicts\?\.length[\s\S]*?persistCurrentAutosave\(Date\.now\(\)\)/,
    );
  });

  it('mounts the guided panel before the active mode surface', () => {
    const appendAt = mainSource.indexOf('main.append(navigation, conflictHost, col)');
    const renderAt = mainSource.indexOf(
      'renderTimelineAutosaveConflictPanel(conflictHost, pendingAutosaveTimelineConflicts',
      appendAt,
    );
    const modeAt = mainSource.indexOf("if (state.mainTab === 'editor')", renderAt);
    expect(appendAt).toBeGreaterThanOrEqual(0);
    expect(renderAt).toBeGreaterThan(appendAt);
    expect(modeAt).toBeGreaterThan(renderAt);
  });

  it('uses one persistence helper for save completion, the timer, and successful conflict actions', () => {
    const persist = functionSource('persistCurrentAutosave', 'handleTimelineAutosaveRepair');
    expect(persist).toMatch(/unresolvedAutosaveTimelineConflicts\([\s\S]*?conflict\)\s*=>\s*conflict\.recovered/);
    expect(persist).toMatch(/buildAutosave\(/);
    expect(persist).toMatch(/preserveAutosaveTimelineConflicts\([\s\S]*?conflict\)\s*=>\s*conflict\.recovered/);
    expect(persist).toMatch(/if \(payload\) writeAutosave\(payload\);[\s\S]*?else clearAutosave/);
    expect(mainSource).toMatch(/onSaved:\s*\(\)\s*=>\s*\{\s*persistCurrentAutosave\(Date\.now\(\)\)/);
    expect(mainSource).toMatch(/setInterval\([\s\S]*?persistCurrentAutosave\(Date\.now\(\)\)/);
  });

  it('removes a conflict only after repair success and keeps exact Chinese failure evidence', () => {
    const repair = functionSource('handleTimelineAutosaveRepair', 'discardTimelineAutosaveConflict');
    const failureAt = repair.indexOf('if (!result.ok)');
    const removeAt = repair.indexOf('.filter((candidate) => candidate.key !== key)');
    const persistAt = repair.indexOf('persistCurrentAutosave(Date.now())');
    expect(failureAt).toBeGreaterThanOrEqual(0);
    expect(removeAt).toBeGreaterThan(failureAt);
    expect(persistAt).toBeGreaterThan(removeAt);
    expect(repair).toContain('演出备份处理失败：${result.error}');
  });

  it('discards only the selected key and persists immediately', () => {
    const discard = functionSource('discardTimelineAutosaveConflict', 'downloadTimelineAutosaveConflict');
    expect(discard).toMatch(/filter\(\(candidate\)\s*=>\s*candidate\.key !== key\)/);
    expect(discard).toMatch(/persistCurrentAutosave\(Date\.now\(\)\)/);
    expect(discard).toContain('已保留当前项目并放弃这份演出备份');
  });

  it('downloads raw backup evidence without removing or persisting the conflict', () => {
    const download = functionSource('downloadTimelineAutosaveConflict', 'tryAutosaveRecover');
    expect(download).toMatch(/new Blob\(\[conflict\.recovered\.text\]/);
    expect(download).toMatch(/URL\.createObjectURL/);
    expect(download).toMatch(/URL\.revokeObjectURL/);
    expect(download).not.toMatch(/pendingAutosaveTimelineConflicts\s*=/);
    expect(download).not.toMatch(/persistCurrentAutosave/);
    expect(download).toContain('待处理记录仍保留');
  });

  it('binds startup recovery to one project and freezes user writes until it settles', () => {
    expect(mainSource).toMatch(/interface SceneAutosaveRecoveryContext[\s\S]*?generation:[\s\S]*?client:[\s\S]*?projectRoot:[\s\S]*?projectId:/);
    expect(mainSource).toMatch(/function sceneAutosaveRecoveryIsCurrent\([\s\S]*?context\.client === assetImportClient[\s\S]*?context\.projectRoot === state\.dirHandle[\s\S]*?context\.projectId === state\.autosaveProjectId/);
    expect(mainSource).toMatch(/context\.client\.sceneCommit\(/);
    expect(mainSource).not.toMatch(/const result = await assetImportClient\.sceneCommit\(/);
    expect(mainSource).toMatch(/main\.toggleAttribute\('inert', sceneAutosaveRecoveryPhase !== 'idle'\)/);
    expect(mainSource).toMatch(/writeLocked: state\.projectWriteLock !== null \|\| sceneRecoveryLocked/);
    expect(mainSource).toMatch(/function confirmProjectSwitch\(\)[\s\S]*?sceneAutosaveRecoveryPhase !== 'idle'/);
    expect(mainSource).toMatch(/async function saveProject\(\)[\s\S]*?sceneAutosaveRecoveryPhase !== 'idle'/);
    expect(mainSource).toMatch(/function doUndo\(\)[\s\S]*?sceneAutosaveRecoveryPhase !== 'idle'/);
    expect(mainSource).toMatch(/function doRedo\(\)[\s\S]*?sceneAutosaveRecoveryPhase !== 'idle'/);
  });

  it('does not let the autosave timer replace evidence while startup recovery is active', () => {
    const persist = functionSource('persistCurrentAutosave', 'handleTimelineAutosaveRepair');
    expect(persist).toMatch(/sceneAutosaveRecoveryPhase !== 'idle'/);
    expect(mainSource).toMatch(/setInterval\([\s\S]*?sceneAutosaveRecoveryPhase !== 'idle'/);
  });
});
