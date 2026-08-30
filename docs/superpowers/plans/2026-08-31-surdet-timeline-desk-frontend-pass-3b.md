# Surdet Timeline Desk — Frontend Pass 3B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven development or execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every failed gate stops the run and is appended to the Execution Ledger before further authorization.

**Goal:** Repair Timeline editing safety and rebuild the full-page Timeline Desk into a Chinese-first, recoverable and responsive production workspace without changing timeline JSON or runtime semantics.

**Architecture:** Keep Core timeline definitions and serialized enums authoritative. Add Editor-only EOL identity, timeline history, shared cue selection, natural ruler projection and project-asset choices; then rebuild the existing full-page panel around those pure contracts. The screenplay Timeline Dock remains absent, and its future association model is documented rather than implemented without a current consumer.

**Tech Stack:** TypeScript, imperative DOM, CSS, Vite 6, Vitest 3, existing File System Access/fake filesystem, existing `@surdet/core` timeline validation and existing Preview page. No new dependencies.

**Design authority:** `docs/superpowers/specs/2026-08-31-surdet-timeline-desk-frontend-pass-3b-design.md`

**Master phase authority:** `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`

**Detailed execution ledger authority:** this taskbook's append-only `Execution Ledger`; the master phase ledger is updated only at initialization, scope decisions and closure.

## Global Constraints

- This is `Frontend Pass 3B`, a Post-Wave-6 / Pre-Wave-7 Editor subproject. It is not mainline Wave 3 or Wave 7.
- Production scope is Editor-only. Do not modify Authoring, Core, CLI, Renderer, Host, Shell, Starter, project/timeline schema, dependencies or lockfile.
- Serialized track kinds, action names, easing names and payload keys remain unchanged.
- The first implementation phase is correctness. Any correctness gate failure stops before visual migration.
- `state.currentTimeline` is the only timeline ID selection truth. Cue selection must not duplicate the timeline ID.
- Timeline undo/redo must never mutate a screenplay scene; scene undo/redo must never mutate a timeline.
- Existing LF/CRLF identity survives edits, Save All and cold reopen.
- Resource-bearing cues use actual project assets or are not written. Never inject `castle_hall`, `lynn:uniform` or `tense_01` as generic defaults.
- `sparkle` may remain as an explicit Renderer built-in particle preset; do not misclassify it as a project asset.
- Destructive track/cue/reset edits must be recoverable. Whole-timeline deletion remains restorable until physical Save All deletion succeeds.
- Validation, Authoring index and project-bar facts are refreshed after every timeline edit.
- The screenplay Timeline Dock remains absent. A later separately approved implementation must first establish zero/single/multiple association truth from compiled scene instructions; 3B does not create an unused production abstraction for it.
- Port 4173 remains reserved for the neighbouring project. Port 4175 remains the manual Surdet service. Browser evidence uses strict free ports 4251–4290 and never stops another process.
- Browser artifacts and screenshots stay outside the repository under `%TEMP%\surdet-editorial-timeline-desk-3b-*`.
- Exact staging only. Never `git add .` / `-A`, amend, rebase, reset or force-push. This taskbook does not authorize push.
- No `verify:all`: complete Editor tests, typecheck, build, focused adjacent tests and one real isolated browser path are proportional to this C-level Editor boundary.
- Keep verified facts, reasonable inference and unverified Owner visual judgement separate.

---

## File map

### Production create

- `packages/editor/src/timeline-history.ts` — isolated timeline text history.
- `packages/editor/src/timeline-presentation.ts` — Chinese labels, natural ruler ticks and project-asset choice projection.
- `packages/editor/src/styles/timeline-workspace.css` — dedicated Timeline Desk visual and responsive layer.

### Production modify

- `packages/editor/src/state.ts` — timeline EOL, shared cue selection and pending deletion recovery state.
- `packages/editor/src/timeline-model.ts` — EOL-aware serialization and neutral track/cue creation.
- `packages/editor/src/panels/timeline-panel.ts` — safe commands, shared selection, full Timeline Desk DOM and focus restoration.
- `packages/editor/src/main.ts` — timeline undo routing and edit freshness hooks.
- `packages/editor/src/project-io.ts` — timeline EOL read/write identity, selection/history reset and deletion commit receipt.
- `packages/editor/src/autosave.ts` — additive dirty-timeline crash recovery.
- `packages/editor/src/styles.css` — delete legacy Timeline rules only.
- `packages/editor/index.html` — load the dedicated Timeline stylesheet after shared layers.

### Permanent tests create

- `packages/editor/test/timeline-history.test.ts`
- `packages/editor/test/timeline-presentation.test.ts`
- `packages/editor/test/timeline-panel.test.ts`
- `packages/editor/test/editor-timeline-workspace-contract.test.ts`
- `packages/editor/e2e/editorial-timeline-desk-wave-3b.e2e.mjs`
- `packages/editor/test/editorial-timeline-desk-wave-3b-runner.test.mjs`

### Permanent tests modify

- `packages/editor/test/timeline-model.test.ts`
- `packages/editor/test/timeline-project-bar-projection.test.ts`
- `packages/editor/test/project-io.test.ts`
- `packages/editor/test/autosave.test.ts`
- `packages/editor/test/editor-integrated-authoring-workbench.test.ts`
- `packages/editor/test/preview-scenes.test.ts`

### Documentation

- this taskbook;
- the design specification;
- the master Frontend Execution Ledger;
- the existing long-term roadmap ledger remains untracked and unstaged.

Anything else requires an append-only scope decision before edit.

---

## Task 0 — Freeze baseline and initialize evidence ledger

**Files:**

- Modify: this taskbook Execution Ledger only.
- Read only: every production/test path listed above.

**Interfaces:**

- Consumes: Git `main`, current `surdet/main`, current protected/untracked files.
- Produces: one immutable baseline used by every later task.

- [ ] **Step 1: Record baseline identity**

Run:

```powershell
git branch --show-current
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count surdet/main...HEAD
git status --short --branch
git diff --check
git diff --cached --check
```

Immutable planning ancestry:

```text
branch = main
planning parent = 42be0fcd2f614f032b8a539475c039c7f4ebd66f
surdet/main = 42be0fcd2f614f032b8a539475c039c7f4ebd66f
```

The planning commit cannot contain its own hash. At implementation start, require the current HEAD to be an ordinary docs-only descendant whose first parent is the planning parent above, record its actual hash as `PLANNING_HEAD`, and require tracked worktree/staging clean. A changed live remote is not automatically an implementation blocker if it does not alter local ancestry, but it must be recorded and must not be reconciled without Owner authorization.

- [ ] **Step 2: Confirm forbidden-path baseline**

Save `git status --short` in the Ledger. Preserve all existing untracked/protected paths. Verify there is no `pnpm-lock.yaml` or `pnpm-workspace.yaml` generated by this task.

- [ ] **Step 3: Read exact current implementation**

Use symbol/reference queries for:

```text
timeline-model.stringifyTimeline/createTrack/createCue
timeline-panel.commit/renderRuler/renderTracks/renderInspector/renderTimelinePanel/selectTimelineCue
main.doUndo/doRedo/bindTimelineHooks
project-io.readTimelineDir/saveAll/openProject
autosave.buildAutosave/pickRecoverable
```

- [ ] **Step 4: Append Task 0 result and stop on local baseline drift**

Stop if the branch is not `main`, HEAD is not the docs-only planning descendant described above, or tracked/staging state was not clean before the Task 0 Ledger append. Record live-remote drift separately; do not pull, rebase or otherwise reconcile it without Owner authorization.

---

## Task 1 — EOL-aware timeline model and IO

**Files:**

- Modify: `packages/editor/src/state.ts`
- Modify: `packages/editor/src/timeline-model.ts`
- Modify: `packages/editor/src/panels/timeline-panel.ts`
- Modify: `packages/editor/src/project-io.ts`
- Modify: `packages/editor/test/timeline-model.test.ts`
- Modify: `packages/editor/test/project-io.test.ts`

**Interfaces:**

- Produces:

```ts
type TimelineEol = '\r\n' | '\n';

interface TimelineEntry {
  id: string;
  file: string;
  text: string;
  eol: TimelineEol;
  dirty: boolean;
  handle: FileSystemFileHandle | null;
}

function stringifyTimeline(definition: TimelineDefinition, eol?: TimelineEol): string;
```

- [ ] **Step 1: Write EOL RED**

Add model cases:

```ts
expect(stringifyTimeline(definition, '\r\n')).not.toMatch(/(^|[^\r])\n/);
expect(stringifyTimeline(definition, '\r\n').endsWith('\r\n')).toBe(true);
expect(stringifyTimeline(definition, '\n')).not.toContain('\r\n');
```

Add IO cases that read one CRLF and one LF fake timeline, mutate one value, save, and inspect the fake file bytes.

- [ ] **Step 2: Run RED**

```powershell
npm run test -w surdet-editor -- test/timeline-model.test.ts test/project-io.test.ts
```

Expected: FAIL because `TimelineEntry.eol` and the serializer argument do not exist and edited CRLF writes LF.

- [ ] **Step 3: Implement the minimum EOL contract**

Detect EOL in `readTimelineDir()`:

```ts
const text = await (await ent.getFile()).text();
const eol: TimelineEol = text.includes('\r\n') ? '\r\n' : '\n';
```

Serialize with one requested convention:

```ts
const lf = `${JSON.stringify(definition, null, 2)}\n`;
return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
```

New timelines created in `timeline-panel.ts` use `eol: '\n'`; every `TimelineEntry` construction site must provide the field.

- [ ] **Step 4: Run GREEN**

Run the same command plus `npm run typecheck -w surdet-editor`. Expected: all selected files PASS, typecheck PASS and Core timeline roundtrip remains identical.

- [ ] **Step 5: Commit Task 1 exactly**

```powershell
git add -- packages/editor/src/state.ts packages/editor/src/timeline-model.ts packages/editor/src/panels/timeline-panel.ts packages/editor/src/project-io.ts packages/editor/test/timeline-model.test.ts packages/editor/test/project-io.test.ts
git diff --cached --check
git commit -m "fix(editor): preserve timeline document identity"
```

Verify `git show --name-only --format='' HEAD` equals the six paths.

---

## Task 2 — Independent timeline history and undo routing

**Files:**

- Create: `packages/editor/src/timeline-history.ts`
- Modify: `packages/editor/src/panels/timeline-panel.ts`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/src/project-io.ts`
- Create: `packages/editor/test/timeline-history.test.ts`
- Modify: `packages/editor/test/timeline-project-bar-projection.test.ts`

**Interfaces:**

```ts
export interface TimelineHistoryDepth { undo: number; redo: number }
export function pushTimelineSnapshot(timelineId: string, previousText: string): void;
export function takeTimelineUndo(timelineId: string, currentText: string): string | null;
export function takeTimelineRedo(timelineId: string, currentText: string): string | null;
export function clearTimelineHistory(timelineId: string): void;
export function clearTimelineHistories(): void;
export function timelineHistoryDepth(timelineId?: string): TimelineHistoryDepth;
```

`timeline-panel.commit()` must push the exact previous text before replacing `entry.text`. Drag/resize pushes once on release, not every pointer move.

- [ ] **Step 1: Write history RED**

Cover:

- edit timeline A → undo restores exact A text;
- scene text/history remains byte-identical;
- timeline B remains unchanged;
- redo restores edit;
- new edit after undo clears redo;
- switching timelines uses the selected timeline's independent history;
- project open clears all timeline histories.

- [ ] **Step 2: Run RED**

```powershell
npm run test -w surdet-editor -- test/timeline-history.test.ts test/timeline-project-bar-projection.test.ts test/history.test.ts
```

Expected: FAIL because the timeline history API and timeline shortcut routing do not exist.

- [ ] **Step 3: Implement acyclic history using existing snapshot primitives**

Use a `Map<string, SnapshotHistory<string>>`. The history module owns stacks only and imports neither `timeline-panel.ts` nor `main.ts`. `takeTimelineUndo()` / `takeTimelineRedo()` receive the timeline ID and current text, update the relevant stacks and return the replacement text or `null`.

`main.ts` owns orchestration: it reads `state.currentTimeline`, applies the returned text to only that `TimelineEntry`, preserves EOL, marks it dirty, rerenders Timeline and runs the shared edit-freshness hook exactly once. `timeline-panel.ts` imports only `pushTimelineSnapshot()`. This one-way dependency forbids a panel/history cycle.

Route shortcuts exactly:

```ts
if (state.mainTab === 'config') configUndo();
else if (state.mainTab === 'timeline') applyTimelineHistory('undo');
else undo();
```

Use the parallel branch for redo.

- [ ] **Step 4: Move cue selection to shared state**

Add:

```ts
state.currentTimelineCue = null as { trackIndex: number; cueIndex: number } | null;
```

Delete module-local `selectedCue`. List selection clears cue selection; `selectTimelineCue()` sets current timeline then indices; every selected cue class verifies timeline + track + cue.

- [ ] **Step 5: Run GREEN and adjacent regression**

```powershell
npm run test -w surdet-editor -- test/timeline-history.test.ts test/timeline-project-bar-projection.test.ts test/history.test.ts test/config-edit.test.ts
npm run typecheck -w surdet-editor
```

- [ ] **Step 6: Commit Task 2 exactly**

```powershell
git add -- packages/editor/src/timeline-history.ts packages/editor/src/panels/timeline-panel.ts packages/editor/src/main.ts packages/editor/src/project-io.ts packages/editor/test/timeline-history.test.ts packages/editor/test/timeline-project-bar-projection.test.ts
git diff --cached --check
git commit -m "fix(editor): isolate timeline edit history"
```

---

## Task 3 — Destructive recovery and timeline crash backup

**Files:**

- Modify: `packages/editor/src/state.ts`
- Modify: `packages/editor/src/timeline-history.ts`
- Modify: `packages/editor/src/panels/timeline-panel.ts`
- Modify: `packages/editor/src/project-io.ts`
- Modify: `packages/editor/src/autosave.ts`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/test/timeline-history.test.ts`
- Modify: `packages/editor/test/project-io.test.ts`
- Modify: `packages/editor/test/autosave.test.ts`

**Interfaces:**

```ts
interface PendingTimelineRestore {
  entry: TimelineEntry;
  index: number;
  previousTimelineId: string | null;
  previousCue: TimelineCueSelection | null;
}

state.pendingTimelineRestores: Map<string, PendingTimelineRestore>;

export function restorePendingTimelineDeletion(timelineId: string): boolean;
```

- [ ] **Step 1: Write destructive RED**

Test exact text/history/dirty outcomes for:

- cancel track replacement;
- confirm replacement → Ctrl+Z restores exact target/cues;
- delete cue → undo restores exact cue and selection;
- reset invalid raw file → undo restores invalid raw bytes;
- total-duration clipping → undo restores timings;
- delete full timeline → restore before save;
- delete → restore → Save All leaves the original disk file present;
- delete two timelines before save → both tombstones remain independently restorable;
- IDs held by pending deletes/tombstones cannot be reused by new timeline creation;
- physical delete failure → restore remains available;
- successful physical deletion → restore receipt and only that ID's old history clear;
- recreating a physically deleted ID starts with empty undo/redo history.

- [ ] **Step 2: Write autosave RED**

Add timeline-only dirty backup, mixed scene/timeline backup, exact EOL restore, legacy scenes-only payload, and newly-created-not-on-disk timeline cases. Assert backup clears only when both collections are clean.

- [ ] **Step 3: Run RED**

```powershell
npm run test -w surdet-editor -- test/timeline-history.test.ts test/project-io.test.ts test/autosave.test.ts
```

- [ ] **Step 4: Implement one-snapshot destructive commands**

All confirm handlers push exactly one text snapshot before mutation. Cancel writes nothing. Cue/track/reset handlers set a clear status such as `已删除，可撤销`.

Whole-timeline delete stores the full restore record by timeline ID and appends the pending physical delete. Render one normal-flow `撤销删除` action per tombstone. Restoring must also remove the ID from `pendingTimelineDeletes`, so the next Save All cannot delete the restored file. New-ID allocation treats both pending-delete and tombstone IDs as reserved. `saveAll()` clears only the restore record and `clearTimelineHistory(id)` for each successfully deleted file; a second pending deletion never overwrites the first.

- [ ] **Step 5: Extend autosave additively**

Keep `timelines?` optional in the payload. `parseAutosave()` accepts old payloads. Recovery updates matching disk-backed entries in memory; when the timeline is absent because it was newly created and never saved, insert a `TimelineEntry` with the preserved `file`, exact text/EOL, `handle: null` and `dirty: true`.

- [ ] **Step 6: Run GREEN**

Run the RED command plus `test/history.test.ts`; expect all PASS.

- [ ] **Step 7: Commit Task 3 exactly**

```powershell
git add -- packages/editor/src/state.ts packages/editor/src/timeline-history.ts packages/editor/src/panels/timeline-panel.ts packages/editor/src/project-io.ts packages/editor/src/autosave.ts packages/editor/src/main.ts packages/editor/test/timeline-history.test.ts packages/editor/test/project-io.test.ts packages/editor/test/autosave.test.ts
git diff --cached --check
git commit -m "fix(editor): recover destructive timeline edits"
```

---

## Task 4 — Neutral project-asset creation and fresh evidence

**Files:**

- Modify: `packages/editor/src/timeline-model.ts`
- Create: `packages/editor/src/timeline-presentation.ts`
- Modify: `packages/editor/src/panels/timeline-panel.ts`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/test/timeline-model.test.ts`
- Create: `packages/editor/test/timeline-presentation.test.ts`
- Create: `packages/editor/test/timeline-panel.test.ts`

**Interfaces:**

```ts
export interface TimelineAssetChoice {
  kind: 'background' | 'portrait' | 'audio';
  key: string;
  expression?: string;
  sourceKind: 'bg' | 'portrait' | 'bgm' | 'se' | 'voice';
}

export function timelineAssetChoices(dirAssets: readonly DirAsset[]): TimelineAssetChoice[];
export function createTrack(kind: TimelineTrackKind): TimelineTrack; // cues: []
export function createNeutralCue(kind: 'camera' | 'screen' | 'particle', action: string): TimelineCue | null;
export interface TimelineCueDraft {
  cue: TimelineCue;
  trackPatch?: { target: string };
}
export function createResourceCue(
  kind: 'background' | 'portrait' | 'audio',
  action: string,
  choice: TimelineAssetChoice,
): TimelineCueDraft | null;
```

- [ ] **Step 1: Write neutral-default RED**

Assert newly created model data contains none of:

```text
castle_hall
lynn:uniform
tense_01
```

Assert `sparkle` is presented as a built-in particle preset, not a directory asset. Assert `ambience` remains excluded because Core Timeline audio actions are exactly `bgm`, `se` and `voice`.

- [ ] **Step 2: Write project-asset RED**

Given `DirAsset[]`, verify Chinese-labelled choices for backgrounds, portrait target/expression and BGM/SE/voice. Empty inventory must return an honest empty choice set.

- [ ] **Step 3: Run RED**

```powershell
npm run test -w surdet-editor -- test/timeline-model.test.ts test/timeline-presentation.test.ts test/timeline-panel.test.ts
```

- [ ] **Step 4: Implement neutral tracks and staged cue creation**

`createTrack(kind)` returns `{ kind, cues: [] }`. `createNeutralCue()` returns a complete safe cue only for camera/screen/built-in-particle actions and returns `null` for resource-bearing actions. `createResourceCue()` accepts a matching validated project choice and returns a draft. For portrait, the draft contains `trackPatch.target = choice.key` and the cue uses the choice expression; apply both in one history-backed commit. Resource-bearing UI collects the real resource/target first and writes once only after the constructor succeeds.

Changing track kind uses `更换类型…`, displays the cue count to be removed, requires confirmation, and stays undoable through Task 2 history.

- [ ] **Step 5: Refresh shared evidence after edit**

Timeline `onEdited` in `main.ts` must:

```ts
markProjectEdited();
scheduleValidate();
scheduleAuthoringIndexRebuild();
```

`markProjectEdited()` already refreshes the Project Bar; do not call that projection twice.

- [ ] **Step 6: Run GREEN and commit**

Run the RED command and Editor typecheck, then:

```powershell
git add -- packages/editor/src/timeline-model.ts packages/editor/src/timeline-presentation.ts packages/editor/src/panels/timeline-panel.ts packages/editor/src/main.ts packages/editor/test/timeline-model.test.ts packages/editor/test/timeline-presentation.test.ts packages/editor/test/timeline-panel.test.ts
git diff --cached --check
git commit -m "fix(editor): use project assets in timeline edits"
```

---

## Task 5 — Preserve the Dock deferral boundary

**Files:**

- Modify only if an assertion is missing: `packages/editor/test/editor-integrated-authoring-workbench.test.ts`
- Modify only if an assertion is missing: `packages/editor/test/timeline-project-bar-projection.test.ts`

This task intentionally creates no production scene-association module. The full-page Timeline Desk has no present consumer for zero/single/multiple scene association, so building that abstraction now would be speculative.

- [ ] **Step 1: Audit the existing absence contract**

Confirm screenplay mode mounts no `.timeline-shell`, calls no `renderTimelinePanel`, exposes no compact Timeline surface and never projects `state.currentTimeline` as current-scene truth. Confirm Timeline mode mounts exactly one full-page surface.

- [ ] **Step 2: Add only missing permanent assertions**

If the existing tests already cover every statement, make no edit and create no empty commit. Otherwise add the smallest assertions to the two existing test files. Do not introduce zero/single/multiple fixture data or a production helper in this pass.

- [ ] **Step 3: Run the boundary tests**

```powershell
npm run test -w surdet-editor -- test/editor-integrated-authoring-workbench.test.ts test/timeline-project-bar-projection.test.ts
```

- [ ] **Step 4: Commit only if tests changed**

```powershell
git add -- packages/editor/test/editor-integrated-authoring-workbench.test.ts packages/editor/test/timeline-project-bar-projection.test.ts
git diff --cached --check
```

If the staged diff is non-empty, commit `test(editor): preserve one timeline surface`. If it is empty, record `NO_CHANGE_REQUIRED` and do not create a commit.

The future Dock prerequisite remains documented in the design spec: derive zero/single/multiple truth from compiled timeline instructions and never infer it from the globally opened timeline. It is not 3B production code.

---

## Task 6 — Natural ruler and Chinese presentation

**Files:**

- Modify: `packages/editor/src/timeline-presentation.ts`
- Modify: `packages/editor/src/panels/timeline-panel.ts`
- Modify: `packages/editor/test/timeline-presentation.test.ts`
- Modify: `packages/editor/test/timeline-panel.test.ts`

**Interfaces:**

```ts
export interface TimelineTick { valueMs: number; label: string; leftPercent: number }
export function buildTimelineTicks(durationMs: number, availableWidth: number, minLabelGap?: number): TimelineTick[];
export function timelineTrackLabel(kind: TimelineTrackKind): string;
export function timelineActionLabel(kind: TimelineTrackKind, action: string): string;
export function timelineEasingLabel(easing: TimelineEasing): string;
```

- [ ] **Step 1: Write ruler RED**

For 0, 100, 499, 500, 600, 1200 and 600000ms, assert ticks are unique, strictly increasing, contain zero once, contain final at most once, never duplicate 100%, and respect 64px minimum distance when width permits.

- [ ] **Step 2: Write Chinese projection RED**

Assert all six track kinds, every supported action and all easing values have Chinese visible labels while `<option value>` and serialized definitions keep original English values.

- [ ] **Step 3: Run RED**

```powershell
npm run test -w surdet-editor -- test/timeline-presentation.test.ts test/timeline-panel.test.ts
```

- [ ] **Step 4: Implement `1/2/5 × 10ⁿ` ticks**

Choose the smallest natural step whose estimated label count fits `availableWidth / minLabelGap`. Dedupe the final duration and clamp all positions to 0–100.

- [ ] **Step 5: Render stable value/label pairs**

Use Chinese option text with English enum values. Put raw key/action/easing details in a collapsed technical section.

- [ ] **Step 6: Run GREEN and commit**

Commit the exact presentation/panel/test paths listed in this task:

```powershell
git add -- packages/editor/src/timeline-presentation.ts packages/editor/src/panels/timeline-panel.ts packages/editor/test/timeline-presentation.test.ts packages/editor/test/timeline-panel.test.ts
git diff --cached --check
git commit -m "feat(editor): project timeline language and scale"
```

---

## Task 7 — Rebuild the full-page Timeline Desk

**Files:**

- Modify: `packages/editor/src/panels/timeline-panel.ts`
- Modify: `packages/editor/src/styles.css`
- Create: `packages/editor/src/styles/timeline-workspace.css`
- Modify: `packages/editor/index.html`
- Modify: `packages/editor/test/timeline-panel.test.ts`
- Create: `packages/editor/test/editor-timeline-workspace-contract.test.ts`
- Modify: `packages/editor/test/preview-scenes.test.ts`

**Required semantic regions:**

```text
timeline-workbench
timeline-library
timeline-header
timeline-toolbar
timeline-ruler
timeline-tracks
timeline-inspector
timeline-recovery
```

- [ ] **Step 1: Write workspace RED**

Require one full Timeline surface, Chinese main copy, full selected surfaces, focus rings, normal-flow actions, dedicated internal scroll, no colored left rail, and dedicated stylesheet loaded after shared/script/flow layers.

- [ ] **Step 2: Write interaction RED**

Cover list/header/project-bar identity, cue selection, create/delete, track replacement confirmation, cue remove/undo, Inspector numeric keyboard alternative, preview hook, empty/invalid/recovery states and focus restoration after rerender.

- [ ] **Step 3: Remove legacy Timeline CSS only**

Move Timeline selectors from `styles.css` into `timeline-workspace.css`. Do not change non-Timeline legacy selectors in this task.

- [ ] **Step 4: Build the production-slate desk**

Wide layout = library / tracks / Inspector. Medium collapses library. At 800/720 and 200% equivalent, library and Inspector are reachable normal-flow disclosures, tracks use independent horizontal scroll and ruler/track labels remain reachable.

Do not add gradients, rainbow tracks, colored selection rails, floating primary actions or a second preview iframe.

- [ ] **Step 5: Preserve pointer and keyboard behavior**

Use pointer capture and `pointercancel` cleanup for cue move/resize. Inspector start/duration inputs remain complete keyboard alternatives. After edits, restore focus by timeline/track/cue/control identity.

- [ ] **Step 6: Run GREEN**

```powershell
npm run test -w surdet-editor -- test/timeline-panel.test.ts test/editor-timeline-workspace-contract.test.ts test/timeline-project-bar-projection.test.ts test/preview-scenes.test.ts
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

- [ ] **Step 7: Commit Task 7 exactly**

```powershell
git add -- packages/editor/src/panels/timeline-panel.ts packages/editor/src/styles.css packages/editor/src/styles/timeline-workspace.css packages/editor/index.html packages/editor/test/timeline-panel.test.ts packages/editor/test/editor-timeline-workspace-contract.test.ts packages/editor/test/preview-scenes.test.ts
git diff --cached --check
git commit -m "feat(editor): rebuild timeline desk"
```

Verify the commit contains only the panel, legacy `styles.css` Timeline-rule removal, dedicated CSS, index and exact related tests.

---

## Task 8 — Focused, full Editor and adjacent gates

**Files:** no production edit unless a gate exposes an in-scope regression and the Execution Ledger records a scope decision.

- [ ] **Step 1: Run correctness group**

```powershell
npm run test -w surdet-editor -- test/timeline-model.test.ts test/timeline-history.test.ts test/timeline-presentation.test.ts test/project-io.test.ts test/autosave.test.ts
```

- [ ] **Step 2: Run UI group**

```powershell
npm run test -w surdet-editor -- test/timeline-panel.test.ts test/editor-timeline-workspace-contract.test.ts test/timeline-project-bar-projection.test.ts test/editor-integrated-authoring-workbench.test.ts test/preview-scenes.test.ts
```

- [ ] **Step 3: Run complete Editor gates**

```powershell
npm run test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
git diff --check
git diff --cached --check
```

Expected: all exit 0. The existing Vite large-chunk advisory is informational unless size materially increases from the frozen baseline.

- [ ] **Step 4: Record the preliminary implementation gate**

Confirm every production/test commit since the planning HEAD is within the authorized list. Record the provisional implementation HEAD, exact changed paths and remaining untracked files. Do not name it `CODE_EVIDENCE_HEAD`: the browser runner and its permanent contract do not exist yet, so the final evidence identity cannot be frozen here.

---

## Task 9 — Isolated real-browser evidence

**Files:**

- Create: `packages/editor/e2e/editorial-timeline-desk-wave-3b.e2e.mjs`
- Create: `packages/editor/test/editorial-timeline-desk-wave-3b-runner.test.mjs`

**Runner constants:**

```ts
export const FORBIDDEN_PORTS = Object.freeze([4173, 4175]);
export const SEARCH_RANGE = Object.freeze({ from: 4251, to: 4290 });
export const MODES = Object.freeze(['preflight', 'diagnostic', 'formal']);
```

- [ ] **Step 1: Establish runner contract RED**

Write the runner contract test first. Require strict-port selection, exclusive artifact writes, runner identity, Starter-derived fake FS, one CRLF timeline, cold reopen from saved dump, screenshot set, error channels and cleanup.

Run the permanent RED:

```powershell
node --test packages/editor/test/editorial-timeline-desk-wave-3b-runner.test.mjs
```

Expected: non-zero because the runner or required contract fields are not implemented. Preserve the output identity in the taskbook Ledger.

- [ ] **Step 2: Build fixture without modifying Starter**

Augment only the fake file map:

- convert one copied timeline JSON to CRLF;
- record augmentation paths/hashes in evidence.

- [ ] **Step 3: Build browser milestones**

The runner must prove:

1. strict isolated port;
2. Vite ready;
3. fixture opened through picker;
4. screenplay Dock absent;
5. exactly one full Timeline surface;
6. list/header/project-bar/current timeline agree;
7. Chinese display with stable enum values;
8. cue selection belongs to current timeline;
9. edit marks only timeline dirty;
10. timeline undo/redo leaves scene bytes unchanged;
11. destructive cancel no-op;
12. destructive confirm then undo exact restore;
13. selected-timeline preview handoff;
14–18. 1440/1280/1024/800/720 layouts and non-overlapping ticks;
19. 200% page-scale command reachability;
20. save writes only expected timeline data;
21. CRLF preserved;
22. fake tree dumped after save;
23. first page/context closed;
24. second fresh page/context injected from saved dump;
25. edited value survives cold reopen;
26. reopened project clean;
27. original Starter unchanged;
28. browser error channels empty;
29. isolated process cleanup.

- [ ] **Step 4: Implement real cold reopen**

Do not call `page.reload()` against the original fake map. Dump with `window.__surdetDumpFakeRoot()`, close the first page/context, create a second page/context initialized from the saved dump, and open the project again.

- [ ] **Step 5: Run contract GREEN and syntax gate**

```powershell
node --test packages/editor/test/editorial-timeline-desk-wave-3b-runner.test.mjs
node --check packages/editor/e2e/editorial-timeline-desk-wave-3b.e2e.mjs
git diff --check
git diff --cached --check
```

Expected: all exit 0. If the contract remains red, stop before any browser run.

- [ ] **Step 6: Run one preflight**

Preflight verifies launcher identity, port policy, fixture identity, runner syntax, existing app title and no process residue. It does not mutate project data.

```powershell
node packages/editor/e2e/editorial-timeline-desk-wave-3b.e2e.mjs --mode preflight
```

- [ ] **Step 7: Run bounded diagnostic evidence**

Allow at most two DIAGNOSTIC runs while the code HEAD is still unfrozen. Every failure artifact remains untouched and is appended to the Ledger. If the second diagnostic fails, stop before FORMAL.

```powershell
node packages/editor/e2e/editorial-timeline-desk-wave-3b.e2e.mjs --mode diagnostic
```

- [ ] **Step 8: Freeze the final code evidence exactly**

After DIAGNOSTIC PASS, append all pre-FORMAL facts to this taskbook, then stage exactly the runner, runner contract and this taskbook. No other tracked path may remain modified.

```powershell
git add -- packages/editor/e2e/editorial-timeline-desk-wave-3b.e2e.mjs packages/editor/test/editorial-timeline-desk-wave-3b-runner.test.mjs docs/superpowers/plans/2026-08-31-surdet-timeline-desk-frontend-pass-3b.md
git diff --cached --check
git commit -m "test(editor): verify timeline desk workflow"
git status --short
git rev-parse HEAD
```

Require staging empty and tracked worktree clean. Set this exact commit as the one and only `CODE_EVIDENCE_HEAD`.

- [ ] **Step 9: Run one FORMAL**

Run one FORMAL against the frozen commit requiring:

```powershell
$env:SURDET_CODE_EVIDENCE_HEAD = (git rev-parse HEAD)
node packages/editor/e2e/editorial-timeline-desk-wave-3b.e2e.mjs --mode formal
```

```text
artifact.runHead === CODE_EVIDENCE_HEAD
trackedCodeDiffPaths = []
29/29 milestones PASS
originalStarterUnchanged = true
errors/console/page/request/stderr/cleanup = []
```

No replacement FORMAL without a new Owner/manager authorization.

---

## Task 10 — Independent review, documentation closure and stop

**Files:**

- Modify: this taskbook
- Modify: `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`
- Create: `docs/EDITORIAL-TIMELINE-DESK-FRONTEND-PASS-3B-DELIVERY-REPORT-2026-08-31.md`

- [ ] **Step 1: Independent read-only review**

Review exact commits, forbidden intersections, history/EOL/recovery semantics, Dock deferral boundary, final artifact identity and screenshots. BLOCKER/HIGH must be fixed before closure.

- [ ] **Step 2: Generate the delivery report last**

Only after all verification, write confirmed facts, reasonable inferences, unverified Owner visual items, commit identities, artifact bytes/SHA and stop boundary.

- [ ] **Step 3: Run documentation gates**

```powershell
npm run verify:docs
git diff --check
git diff --cached --check
```

- [ ] **Step 4: Commit exact docs**

Stage only this taskbook, the master Frontend Ledger and the delivery report. Commit:

```text
docs(editor): close timeline desk frontend pass 3b
```

- [ ] **Step 5: Stop**

```text
FRONTEND_PASS_3B_TECHNICAL_GATES = PASSED
LOCAL_INDEPENDENT_REVIEW = PASSED
OWNER_VISUAL_ACCEPTANCE = NOT_STARTED
REMOTE_REVIEW = NOT_STARTED
PUSH = NOT_PERFORMED
FRONTEND_PASS_4 = NOT_STARTED
MAINLINE_WAVE_7 = NOT_DESIGNED / NOT_AUTHORIZED / NOT_STARTED
```

Do not begin Configuration Ledger, mainline Wave 7, push, deploy, package or release.

---

## Verification budget

```text
verify:all = NOT_AUTHORIZED
browser preflight = 1
browser DIAGNOSTIC = maximum 2 before code freeze
browser FORMAL = 1 after code freeze
replacement FORMAL = NOT_AUTHORIZED
Owner visual acceptance = separate human gate
```

Focused unit tests may run as needed for RED→GREEN. Complete Editor tests/typecheck/build run once after the final production edit, plus a single recovery run only if the first failure is demonstrably unrelated environment capacity and a manager records the exception.

---

## Execution Ledger

### 2026-08-31 — Taskbook creation baseline

**CONFIRMED_FACTS**

- Branch `main`, local HEAD and live/persisted `surdet/main` are all `42be0fcd2f614f032b8a539475c039c7f4ebd66f`; ahead/behind is `0/0` after the Owner-authorized ordinary push.
- Tracked worktree and staging were empty before the design/taskbook documents were created. Existing protected and unrelated untracked paths remain preserved.
- Frontend Pass 3A.1 is locally closed and pushed. Mainline Stage 6 Wave 6 is also in remote history. Mainline Wave 7 remains undesigned, unauthorized and unstarted.
- Three independent read-only audits covered timeline data/recovery, UI/accessibility and test/browser evidence. No production/test file was changed during audit.

**FIRST-ORDER FINDINGS**

- Timeline Ctrl/Cmd+Z currently targets scene history.
- Timeline first edit normalizes CRLF to LF.
- Cue delete, track/action replacement, reset and timeline delete lack complete recovery.
- Timeline-only dirty content is absent from crash recovery.
- New resource tracks/cues fabricate Starter keys.
- Timeline edits do not refresh validation/index facts.
- Short timeline ticks duplicate and overlap deterministically.
- Current page lacks dedicated permanent DOM/browser contracts and remains English-heavy with a colored selection rail.
- Scene association truth has no current Timeline Desk consumer; the screenplay Dock and its required zero/single/multiple model remain deferred rather than implemented speculatively.

**UNVERIFIED_ITEMS**

- No Frontend Pass 3B RED, production implementation, build, browser evidence, Owner visual acceptance or push has run.

**STOP_BOUNDARY**

- Documentation creation only. Wait for Owner review/implementation authorization before Task 0 execution. Do not start mainline Wave 7.

### 2026-08-31 — Independent planning review closure

**CONFIRMED_FACTS**

- The first independent review found one evidence-freeze BLOCKER plus history-cycle, deletion, asset-contract, autosave and unused-abstraction issues. The taskbook was corrected rather than accepted conditionally.
- The second review found three remaining data-integrity seams: required EOL on new entries, restored files still queued for deletion, and ID/history reuse after deletion; it also required atomic portrait target/cue creation. All were corrected.
- The final independent read-only review returned PASS with no remaining BLOCKER, HIGH, MEDIUM or LOW finding.
- Documentation verification and whitespace checks pass. The only console note is Git's future LF-to-CRLF working-copy warning, not a content defect.

**DECISIONS**

- Final code evidence freezes only after runner contract GREEN and DIAGNOSTIC PASS; the frozen commit contains the runner, runner contract and pre-FORMAL taskbook Ledger, then one FORMAL runs from that exact clean HEAD.
- No production scene-association module is created without a current consumer. The screenplay Dock remains absent and its zero/single/multiple truth model stays a future prerequisite.

**STOP_BOUNDARY**

- Planning is complete. Wait for explicit Owner authorization before Task 0 or any production edit. Push of this planning commit is not authorized. Mainline Wave 7 remains undesigned, unauthorized and unstarted.
