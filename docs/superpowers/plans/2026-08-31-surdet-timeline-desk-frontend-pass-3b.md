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
- Modify: `packages/editor/src/state.ts`
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
git add -- packages/editor/src/timeline-history.ts packages/editor/src/state.ts packages/editor/src/panels/timeline-panel.ts packages/editor/src/main.ts packages/editor/src/project-io.ts packages/editor/test/timeline-history.test.ts packages/editor/test/timeline-project-bar-projection.test.ts
git diff --cached --check
git commit -m "fix(editor): isolate timeline edit history"
```

---

## Task 3 — Destructive recovery and timeline crash backup

**Files:**

- Modify: `packages/editor/src/state.ts`
- Read only: `packages/editor/src/timeline-history.ts` (Task 2 already provides single-ID clear)
- Modify: `packages/editor/src/panels/timeline-panel.ts`
- Modify: `packages/editor/src/project-io.ts`
- Modify: `packages/editor/src/autosave.ts`
- Modify: `packages/editor/src/main.ts`
- Read only: `packages/editor/test/timeline-history.test.ts` (Task 2 already covers single-ID clear)
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
git add -- packages/editor/src/state.ts packages/editor/src/panels/timeline-panel.ts packages/editor/src/project-io.ts packages/editor/src/autosave.ts packages/editor/src/main.ts packages/editor/test/project-io.test.ts packages/editor/test/autosave.test.ts
git diff --cached --check
git commit -m "fix(editor): recover destructive timeline edits"
```

---

## Task 4 — Neutral project-asset creation and fresh evidence

**Files:**

- Modify: `packages/editor/src/timeline-model.ts`
- Create: `packages/editor/src/timeline-presentation.ts`
- Modify: `packages/editor/src/panels/timeline-panel.ts`
- Read only: `packages/editor/src/main.ts` (Task 2 already connected the shared freshness hook)
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
export interface TimelineCueDraft {
  cue: TimelineCue;
  trackPatch?: { target: string };
}
export function createNeutralCue(kind: 'camera' | 'screen' | 'particle', action: string): TimelineCueDraft | null;
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
git add -- packages/editor/src/timeline-model.ts packages/editor/src/timeline-presentation.ts packages/editor/src/panels/timeline-panel.ts packages/editor/test/timeline-model.test.ts packages/editor/test/timeline-presentation.test.ts packages/editor/test/timeline-panel.test.ts
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

After DIAGNOSTIC PASS, append all pre-FORMAL facts to this taskbook, then stage exactly the runner, runner contract, this taskbook and the already-reviewed design-spec interface correction. No other tracked path may remain modified.

```powershell
git add -- packages/editor/e2e/editorial-timeline-desk-wave-3b.e2e.mjs packages/editor/test/editorial-timeline-desk-wave-3b-runner.test.mjs docs/superpowers/plans/2026-08-31-surdet-timeline-desk-frontend-pass-3b.md docs/superpowers/specs/2026-08-31-surdet-timeline-desk-frontend-pass-3b-design.md
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

### 2026-08-31 — Authoritative continuation closeout: DIAGNOSTIC budget exhausted

This append-only entry is the chronological successor to the pre-existing safe-restart checkpoint above. The earlier continuation and DIAGNOSTIC #1 sections were inserted before that checkpoint during editing; their facts remain valid, while this entry is the authoritative current stop state.

**CONFIRMED_FACTS**

- Production correction HEAD remains `b6299894d3f991107152014d2bd4ff9af6b0991b`. No production code changed after that exact commit.
- DIAGNOSTIC attempt 2/2 ran once with runner SHA-256 `C400282F2A7F75C23610967446CC65723D4B0C1F9D091DC2D7AD404234C2FA42` and `trackedCodeDiffPaths=[]`. It failed and was not rerun.
- Artifact: `C:\Users\Equinox\AppData\Local\Temp\surdet-editorial-timeline-desk-3b-diagnostic-As6aOX\evidence.json`, 150908 bytes, SHA-256 `2FD4403A1B6E40AB8B8D1B791BBB17E9FFB176526B1058118B6C746810B6A9C7`. Identity sidecar: 583 bytes, SHA-256 `B770509FE56690497204D3778D80B23A22B259E8BD1DAB6472ED4F79D71FEE85`.
- Twenty-eight of twenty-nine required milestones passed. Last passed node in sequence: `original-starter-unchanged`. First failed node: `browser-error-channels-empty`.
- Freshly passed real-browser facts include: project picker open; one Timeline Desk truth; Chinese/stable enum projection; shared selection; timeline-only dirty state; isolated history; destructive cancel/restore; preview handoff; layouts at 1440/1280/1024/800/720; 200% page-scale command reachability; exact single-timeline save; CRLF preservation; fake-tree dump; real first-context close; fresh second-context injection; cold-reopen value survival; reopened project clean; original Starter unchanged; isolated process cleanup.
- The sole failure is six request-failure records, all `net::ERR_ABORTED`, for Preview/Vite/Core/Renderer module URLs. Console errors, page errors, Vite stderr, child cleanup failures and active port residue are empty. The evidence does not prove whether these are expected navigation/iframe cancellation or a product request failure, so they are not waived.
- Saved fake tree changed exactly `content/timelines/intro_arrival.json`. Cold reopen preserved `durationMs=1375`, `eol=CRLF` and timeline SHA-256 `55A2C77D83A25A7E35833A7F927E61E678E35C137CB9574D032DB4ADDEE6C5AC`.
- Strict port 4251 is no longer listening; `portReleased=true`; original Starter remains unchanged.
- Staging remains empty. Runner, runner contract, taskbook and design spec are not frozen. No FORMAL was run, no push occurred and no later frontend/mainline wave started.

**STOP / REQUIRED DECISION**

```text
FRONTEND_PASS_3B = NOT_CLOSED
PREFLIGHT = PASSED_1_OF_1 / NOT_RERUN
DIAGNOSTIC_ATTEMPT_1 = FAILED / ARTIFACT_PRESERVED
DIAGNOSTIC_ATTEMPT_2 = FAILED / ARTIFACT_PRESERVED
DIAGNOSTIC_BUDGET = EXHAUSTED_2_OF_2
FIRST_FAILED_NODE = browser-error-channels-empty
CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
FORMAL = NOT_RUN
STAGING = EMPTY
PUSH = NOT_PERFORMED
FRONTEND_PASS_4 = NOT_STARTED
MAINLINE_WAVE_7 = NOT_DESIGNED / NOT_AUTHORIZED / NOT_STARTED
WAITING_FOR_NEW_MANAGER_AUTHORIZATION = YES
```

- A new authorization must define whether to prove and narrowly classify intentional navigation/iframe `ERR_ABORTED` requests or to treat them as product failures. It must grant a new diagnostic budget; the consumed 2/2 budget cannot be reused.

### 2026-08-31 — Restart continuation, independent-review closure and correction commit

**CONFIRMED_FACTS**

- The restart checkpoint was resumed without rerunning the already-consumed preflight. Staging was empty and the recorded HEAD/status matched the checkpoint before edits continued.
- The stale position assertion was corrected. A pure `projectTimelineCueGeometry()` contract now keeps a 0ms cue at the exact timeline end right-anchored inside the lane, including a zero-duration timeline case.
- The runner now reads custom portrait position as three separate facts: stable mode `custom`, Chinese label `自定义横坐标`, and numeric value `3000`; it no longer expects the mode select itself to contain `3000`.
- Independent review first returned FAIL with actionable autosave, disclosure, custom-position, focus, history-selection and FORMAL-runner-identity findings. Every finding was corrected and re-reviewed rather than waived.
- Autosave now uses a persistent `FileSystemDirectoryHandle` registry plus `isSameEntry()` as its only physical project-identity authority. If IndexedDB, handle cloning or identity comparison cannot prove that identity, project autosave fails closed, displays a Chinese warning and performs no recovery/write/delete. It never guesses by directory name or project content, and the legacy unscoped slot is neither read nor deleted.
- Timeline history snapshots now carry the one shared cue selection. Cue creation/deletion, track replacement/deletion, Undo and Redo restore the exact valid selection and keyboard focus expected by the design contract.
- Responsive disclosure preferences record only user toggles, not wide-layout forced visibility. Custom position `0` commits immediately; deleting the last removable track restores focus to the surviving track command.
- FORMAL is now fail-closed on runner identity: the runner must be Git-tracked, `git show HEAD:<runner>` must exist, and its raw blob SHA-256 must equal the executing runner SHA-256. `runnerHeadIdentity` is written into evidence.
- Updated browser evidence additionally covers cue-delete Undo selection/focus, last-track deletion focus and compact disclosure preference after a wide-layout round trip.
- Final focused gate on the correction commit: 6 files / 64 tests PASS. Final complete Editor gate: 50 files / 367 tests PASS. Editor typecheck PASS. Editor build PASS with 906 modules; the existing Preview chunk-size warning remains non-blocking and unchanged in kind.
- Two independent read-only reviews returned PASS after the final fixes: production/state persistence PASS; runner and FORMAL identity PASS.
- Exact correction commit: `b6299894d3f991107152014d2bd4ff9af6b0991b` (`fix(editor): preserve timeline workspace state`), parent `9c5f699c116ae34a456f2351632052f4860d0d58`. Its 13 paths are exactly the reviewed Editor production/test correction set; no taskbook, design spec, runner or unrelated path entered it.
- Current runner identity: 76600 bytes / SHA-256 `8AA489D60B0E42BA40000B143D9FF45E036FD15973FAA0CBC36FAC7B7CCC9746`. Runner contract: 7688 bytes / SHA-256 `F884F852FA3CFB7C6A5C46E149D3A7A1AD20E7E99AA6DAC40DC6FDE517C8E9F9`. Static runner contract 9/9 PASS and `node --check` PASS.

**EVIDENCE BOUNDARY**

- The earlier preflight remains a valid launcher/port/fixture preflight for this task but predates the final runner bytes. It is not represented as a browser workflow PASS. Per the taskbook budget, it was not rerun.
- No DIAGNOSTIC or FORMAL has run. The design spec, taskbook and both runner files remain outside the correction commit for the exact final evidence freeze sequence.

**NEXT**

1. Run at most the first remaining DIAGNOSTIC against committed production code and the updated untracked runner.
2. If DIAGNOSTIC passes, append its artifact identity, freeze runner + contract + taskbook + design spec in one exact commit, establish `CODE_EVIDENCE_HEAD`, and run the sole FORMAL.
3. If the first DIAGNOSTIC fails, preserve the artifact and use at most the second authorized DIAGNOSTIC only after a bounded in-scope repair.

```text
REVIEW_CORRECTION_COMMIT = b6299894d3f991107152014d2bd4ff9af6b0991b
INDEPENDENT_PRODUCTION_REVIEW = PASS
INDEPENDENT_RUNNER_REVIEW = PASS
PREFLIGHT = PASSED_1_OF_1 / NOT_RERUN
DIAGNOSTIC = NOT_RUN_0_OF_2
CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
FORMAL = NOT_RUN
PUSH = NOT_PERFORMED
FRONTEND_PASS_4 = NOT_STARTED
MAINLINE_WAVE_7 = NOT_DESIGNED / NOT_AUTHORIZED / NOT_STARTED
```

### 2026-08-31 — DIAGNOSTIC #1 failed on runner selector scope

**CONFIRMED_FACTS**

- DIAGNOSTIC attempt 1/2 ran once from production HEAD `b6299894d3f991107152014d2bd4ff9af6b0991b` and failed; it was not rerun. Runner SHA-256 at execution was `8AA489D60B0E42BA40000B143D9FF45E036FD15973FAA0CBC36FAC7B7CCC9746` and `trackedCodeDiffPaths=[]`.
- Artifact: `C:\Users\Equinox\AppData\Local\Temp\surdet-editorial-timeline-desk-3b-diagnostic-G1mt8D\evidence.json`, 70362 bytes, SHA-256 `D9D3E5774D3E2551340246858F4135FAE5C5FBD34B1D2D8DE25AE79DE7FB4238`. Identity sidecar: 582 bytes, SHA-256 `ED6AD87BFEB96E3520D5974E2CD5BD8943C1D63D0A77AE5939E3DF1B5A4C4A20`.
- Last passed node: `layout-720`. First failed node: `page-scale-command-reachability`. Nineteen of twenty-nine milestones passed before failure.
- Direct failure: `inspectPageScaleControl()` referenced outer `selector` inside `locator.evaluate()` without passing it into the browser callback, producing `ReferenceError: selector is not defined`.
- The five `ERR_ABORTED` request-failure observations were emitted during failure cleanup after the primary runner exception; they are retained in the artifact and are not rewritten as independent product failures.
- Strict port 4251 was released, child cleanup failures were empty, and the original Starter tree remained unchanged.
- Permanent runner contract RED added one exact outer-selector binding assertion: 9 PASS / 1 expected FAIL. Minimal runner fix passes `selector` as the second `locator.evaluate()` argument and records it as `evaluatedSelector`.
- Replacement static GREEN: runner contract 10/10 PASS; `node --check` PASS; both diff checks PASS. Updated runner identity: 76648 bytes / SHA-256 `C400282F2A7F75C23610967446CC65723D4B0C1F9D091DC2D7AD404234C2FA42`. Updated contract identity: 7935 bytes / SHA-256 `05314053271B6CC48805E8C1AA6C77287E6F7B5CA2FEE20E79813C4B9B5F61F3`.

**BUDGET / NEXT**

```text
PREFLIGHT = PASSED_1_OF_1 / NOT_RERUN
DIAGNOSTIC_ATTEMPT_1 = FAILED / ARTIFACT_PRESERVED
DIAGNOSTIC_REMAINING = 1
FORMAL = NOT_RUN
```

- The bounded repair is runner/test-only and does not alter production code or invalidate the fresh Editor gates. Use the one remaining DIAGNOSTIC once. Any failure stops before freeze/FORMAL.

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

### 2026-08-31 — Task 0 implementation baseline

**CONFIRMED_FACTS**

- Owner explicitly authorized Frontend Pass 3B implementation with `开工`.
- `PLANNING_HEAD=ca11a09df96a1daceae8c6847273499571943555`; first parent and current `surdet/main` are `42be0fcd2f614f032b8a539475c039c7f4ebd66f`; ahead/behind=`1/0`.
- Branch is `main`. Before this Ledger append, tracked worktree and staging were clean; `git diff --check` and `git diff --cached --check` exited 0.
- Existing protected/untracked files remain present and out of scope, including the long-term roadmap ledger, handoffs, protected art-direction documents and historical CLI artifacts.
- Serena TypeScript indexing is active. The approved design/taskbook and exact current Timeline/state/IO/autosave symbols were re-read before production edits.

**DECISIONS**

- Execute correctness before visual migration. Pure history, presentation and autosave modules may be implemented in parallel with disjoint file ownership; the primary agent owns state, IO, panel, main integration and final verification.
- No push, mainline Wave 7, Frontend Pass 4, backend/runtime/schema change or forbidden-port action is authorized.

**NEXT**

- Begin Task 1 EOL-aware Timeline document identity and its permanent RED→GREEN evidence.

### 2026-08-31 — Task 1 EOL-aware Timeline identity

**CONFIRMED_FACTS**

- Permanent RED ran once: `timeline-model.test.ts` and `project-io.test.ts` reported 2 expected failures because the serializer ignored CRLF and loaded entries had no EOL identity; 13 existing tests passed.
- Minimum GREEN adds required `TimelineEntry.eol`, detects loaded timeline CRLF/LF, defaults new/demo timelines to LF and serializes panel edits/resets with the entry's original convention.
- Fresh focused GREEN: 2 files / 15 tests PASS. Fresh Editor typecheck PASS after the disjoint autosave module exposed and the primary agent connected its new build signature.
- Exact six-path commit: `b6c04b8` — `fix(editor): preserve timeline document identity`. Commit scope equals the Task 1 whitelist; no taskbook, subagent-owned module or unrelated file entered it.

**NEXT**

- Begin Task 2 independent Timeline history, shared cue selection and Timeline-specific undo/redo routing.

### 2026-08-31 — Task 2 independent Timeline history

**CONFIRMED_FACTS**

- Pure history-module RED failed because the module did not exist; GREEN covers per-ID isolation, exact text, redo, redo-branch clearing, single-ID clear and full clear: 5/5 PASS. Adjacent generic history total: 20/20 PASS.
- Integration RED then produced 2 precise failures: cue selection remained module-local and `main.ts` had no Timeline-specific undo/redo branch.
- GREEN moves cue selection to `state.currentTimelineCue`, records one previous-text snapshot per completed edit, keeps the history module free of panel/main imports, routes Timeline undo/redo separately and clears histories/selection on project switch.
- Timeline edit routing now schedules shared validation and Authoring-index refresh once. The parallel autosave module's required four-argument `buildAutosave` call was connected in `main.ts` during this task solely to keep every intermediate commit type-correct; actual timeline recovery remains Task 3.
- Fresh focused GREEN: 4 files / 53 tests PASS. Fresh Editor typecheck PASS.
- Exact seven-path commit: `ab2adb8` — `fix(editor): isolate timeline edit history`.

**NEXT**

- Begin Task 3 multi-item deletion recovery and additive Timeline crash backup integration.

### 2026-08-31 — Task 3 deletion and crash recovery

**CONFIRMED_FACTS**

- Autosave permanent RED produced 6 expected failures before Timeline payload support; its pure GREEN is 10/10 PASS and keeps legacy scenes-only payloads readable.
- Integration RED retained 26 existing passes and exposed exactly two missing seams: successful physical deletion did not clear the tombstone/history, and the state integration for Timeline autosave recovery did not exist.
- GREEN adds independent multi-item tombstones, cancels pending physical deletion on restore, reserves pending IDs, clears only the successfully deleted ID's history, commits unsaved deletions at Save All, and restores both disk-backed and never-saved Timeline entries with exact EOL.
- Track type/action replacement now asks before clearing payload, cue/reset/delete actions publish an undo receipt, and every confirmed mutation remains history-backed.
- Fresh focused GREEN: 4 files / 43 tests PASS. Fresh Editor typecheck PASS. The Task 2 history module already supplied single-ID clear, so Task 3 required no duplicate modification to that module/test.
- Exact seven-path commit: `c5acbf3` — `fix(editor): recover destructive timeline edits`.

**NEXT**

- Begin Task 4 neutral project-asset cue creation and evidence-freshness integration.

### 2026-08-31 — Task 4 neutral project assets

**CONFIRMED_FACTS**

- Pure presentation RED failed because the module did not exist; its GREEN covers 6 track labels, all 17 current Core actions, 4 easing labels, natural ticks and real-project bg/portrait/bgm/se/voice choices: 13/13 PASS.
- Model RED produced 4 expected failures because tracks still injected Starter assets and neutral/resource constructors did not exist.
- GREEN makes every new track empty, removes `castle_hall`, `lynn:uniform` and `tense_01` from production Timeline creation, rejects unsupported/mismatched choices and atomically applies portrait `track.target` with cue expression.
- The panel stages action plus actual project asset before writing a resource cue. Empty inventories write nothing and show a specific direction. Resource replacement uses the same constructor; no arbitrary background/portrait/audio key field remains.
- Fresh focused GREEN: 3 files / 24 tests PASS. Fresh Editor typecheck PASS. Shared validation/index freshness had already been connected by Task 2 and was not duplicated.
- Exact six-path commit: `f26204c` — `fix(editor): use project assets in timeline edits`.

**NEXT**

- Preserve the single full-page Timeline surface boundary, then complete natural ruler/Chinese projection integration and the full Timeline Desk migration.

### 2026-08-31 — Task 5 Dock deferral boundary

**CONFIRMED_FACTS**

- Existing permanent contracts already prove screenplay mode does not mount `.timeline-shell` or call `renderTimelinePanel`, while Timeline mode retains the one full-page surface and Project Bar timeline identity.
- Fresh boundary run: 2 files / 10 tests PASS.
- No assertion gap was found, so Task 5 is `NO_CHANGE_REQUIRED`; no speculative scene-association module and no empty commit were created.

**NEXT**

- Begin Task 6 integration of the natural ruler and Chinese presentation values into the real panel.

### 2026-08-31 — Task 6 natural ruler and Chinese projection

**CONFIRMED_FACTS**

- Panel-integration RED kept 16 projection tests green and failed the one required contract because the real panel still used the fixed 500ms ruler and raw enum copy.
- GREEN now renders the `1/2/5 × 10ⁿ` projection, preserves raw option values, shows Chinese track/action/easing names and removes visible `cue`/`screen` wording from the primary Timeline controls.
- Fresh focused GREEN: 2 files / 17 tests PASS. Fresh Editor typecheck PASS.
- Presentation logic/tests were already committed in Task 4; the exact Task 6 delta is two paths. Commit: `0baae78` — `feat(editor): project timeline language and scale`.

**NEXT**

- Begin Task 7 full-page Timeline Desk DOM/CSS and responsive interaction migration.

### 2026-08-31 — Task 7 full Timeline Desk migration

**CONFIRMED_FACTS**

- Workspace RED produced 5 expected failures: missing dedicated stylesheet/semantic regions/responsive contracts and missing pointer capture/cancel.
- GREEN replaces the legacy Timeline block with one dedicated stylesheet and a single full-page production desk: collapsible演出片段库, current-performance header, normal-flow toolbar, natural ruler/tracks, and collapsible片段设置.
- Selection is a complete neutral surface; no colored left rail, gradients, rainbow tracks or floating primary action remains. Raw file/enum facts are collapsed under 技术信息.
- Pointer move/resize uses capture plus `pointercancel` cleanup; Inspector numeric fields remain keyboard alternatives and focus identities survive synchronous rerender.
- Fresh focused GREEN: 4 files / 18 tests PASS. Fresh Editor typecheck and production build PASS (906 modules); the existing preview chunk-size advisory remains unchanged in status.
- Live browser self-review on the local Surdet 4175 service confirmed the wide desk, selected-cue Inspector and an 800px responsive layout. At 800px the library/Inspector become native disclosures and the timeline remains horizontally reachable. This is implementation self-review, not Owner visual acceptance.
- Exact six-path commit: `9c5f699` — `feat(editor): rebuild timeline desk`. `preview-scenes.test.ts` required no edit and therefore did not enter the commit.

**NEXT**

- Run Task 8 complete Editor preliminary gates, then build the isolated 3B browser evidence runner.

### 2026-08-31 — Task 8 complete Editor preliminary gate

**CONFIRMED_FACTS**

- Complete Editor tests: 49 files / 353 tests PASS.
- Editor typecheck PASS; production build PASS with 906 transformed modules. The existing `preview` chunk advisory remains informational and no performance threshold changed.
- `git diff --check` and `git diff --cached --check` PASS.
- Provisional implementation HEAD is `9c5f699c116ae34a456f2351632052f4860d0d58`. All production/test commits since `PLANNING_HEAD` are within the approved Editor-only path set.
- Remaining tracked changes are documentation only: this append-only taskbook and the reviewed `createNeutralCue` return-type correction in the design spec. Existing unrelated/protected untracked paths remain untouched.

**STOP/CONTINUE DECISION**

- This is a preliminary implementation gate, not `CODE_EVIDENCE_HEAD`. Continue only to the isolated runner contract, bounded DIAGNOSTIC, exact final freeze and one FORMAL.

### 2026-08-31 — Safe restart checkpoint during independent-review correction

**CONFIRMED_FACTS**

- Owner requested an immediate restart-safe stop before the remaining context budget was exhausted. Work stopped without running DIAGNOSTIC or FORMAL and without staging, committing or pushing the in-flight review corrections.
- Current committed HEAD remains `9c5f699c116ae34a456f2351632052f4860d0d58` (`feat(editor): rebuild timeline desk`). Staging is empty; `git diff --check` passes; existing protected/unrelated untracked paths remain untouched.
- Independent code/visual review identified and the working tree already fixes: destructive selection ordering, resize/pointercancel selection, exact portrait expression matching, zero-preserving numeric edits, long-canvas/library/Inspector view state, resize-aware ruler, narrow disclosure state, custom portrait X, track deletion/undo, asset-workspace route, 0ms marker, autosave rejection clearing, same-id/file conflict detection and persistent conflict preservation.
- Fresh focused run after most corrections had 61 PASS / 1 FAIL. The only failure was a stale source-string assertion in `timeline-panel.test.ts` after the position label map gained `custom`; Editor typecheck and build both passed. This is not a final GREEN because later small corrections still require one new focused run.
- Runner contract RED was preserved; current runner contract is 9/9 PASS and `node --check` PASS. The one preflight already passed on strict port 4251 and released it. No DIAGNOSTIC was consumed.
- Runner identity at stop: `editorial-timeline-desk-wave-3b.e2e.mjs` = 72411 bytes / SHA-256 `8ECD1FEFE79AD8627661BD7EDB96AD69319AD413524DD6450BAABA70857567AA`; runner contract = 7195 bytes / SHA-256 `58B7F3C0AEE5EC45CEE99B94646497848EE9D8ABE2DA8C55B20760BA38941165`.

**OPEN ITEMS — RESUME HERE**

1. Correct the stale position-map source assertion.
2. Clamp an instant cue anchored at the exact timeline end so its point marker remains visible inside the lane; add the exact-end permanent case.
3. Correct the runner's custom-position evidence shape: `inspector-position` must prove mode=`custom` / label=`自定义横坐标`; numeric `3000` comes from `inspector-position-custom` and the serialized cue. The current runner contract is green but DIAGNOSTIC would fail this stale assertion.
4. Fresh-run focused tests/typecheck/build, then complete final independent review of these corrections.
5. Create one exact local commit for the review-correction production/test paths; leave taskbook/spec for final evidence freeze.
6. Tell the runner worker the production DOM is stable, rerun its updated contract and syntax gate, then consume at most the remaining two DIAGNOSTIC attempts. Do not rerun preflight.
7. Only after DIAGNOSTIC PASS, stage runner + contract + taskbook + spec, establish `CODE_EVIDENCE_HEAD`, and run the sole FORMAL.

**STOP STATE**

```text
FRONTEND_PASS_3B_RESTART_CHECKPOINT = SAFE
STAGING = EMPTY
REVIEW_CORRECTIONS = IN_FLIGHT_UNCOMMITTED
RUNNER_FILES = UNTRACKED_AND_PRESERVED
PREFLIGHT = PASSED_1_OF_1
DIAGNOSTIC = NOT_RUN_0_OF_2
CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
FORMAL = NOT_RUN
PUSH = NOT_PERFORMED
FRONTEND_PASS_4 = NOT_STARTED
MAINLINE_WAVE_7 = NOT_DESIGNED / NOT_AUTHORIZED / NOT_STARTED
```

### 2026-08-31 — Execution Ledger chronology correction

- The three entries titled `Authoritative continuation closeout`, `Restart continuation` and `DIAGNOSTIC #1 failed` above were written after this safe-restart checkpoint but inserted before it by a patch anchor. This append-only correction restores the reading order without rewriting their facts.
- The authoritative current state is the `Authoritative continuation closeout`: production HEAD `b6299894d3f991107152014d2bd4ff9af6b0991b`; DIAGNOSTIC budget exhausted 2/2; second artifact SHA-256 `2FD4403A1B6E40AB8B8D1B791BBB17E9FFB176526B1058118B6C746810B6A9C7`; first failed node `browser-error-channels-empty`; no `CODE_EVIDENCE_HEAD`, FORMAL or push.

### 2026-08-31 — W3B request-abort classification recovery 1

**AUTHORIZATION**

- Owner approved only: classify the six `ERR_ABORTED` requests, establish permanent RED→GREEN, apply a minimal runner repair if they were confirmed as controlled Preview navigation/iframe teardown, and run one replacement DIAGNOSTIC. FORMAL, push and Frontend Pass 4 remained prohibited.

**CONFIRMED ROOT CAUSE / CONTRACT**

- The six failed URLs are exactly the dynamically-created Preview iframe module graph: Vite env, Preview diagnostics/lifecycle/trace helpers, Core and Renderer.
- The original runner clicked `▶ 预览演出`, waited only for parent `mainTab/previewTimelineId`, then immediately returned to Timeline. `renderMainArea()` synchronously removed the iframe while its module graph was still loading.
- Permanent RED proved the runner lacked a settle-before-teardown contract: 10 PASS / 1 expected FAIL.
- Minimal repair installs a source-matched `surdet-preview-ready` listener before clicking Preview; requires the exact `#preview-view iframe.preview-frame[title="剧情预览"]`; waits for pathname `/preview.html`, the ready signal and `networkidle`, all with explicit timeouts; verifies one runtime and one canvas; only then returns to Timeline.
- No `ERR_ABORTED` filter, allow-list or ignore path exists. `requestfailed` remains fatal. A new HTTP response channel also makes every status `>=400` fatal because Playwright does not report HTTP 404/503 as `requestfailed`.
- Permanent GREEN: runner contract 11/11 PASS; runner syntax PASS; both diff checks PASS. Two independent read-only reviews accepted the lifecycle classification and repair.

**UNIQUE REPLACEMENT DIAGNOSTIC**

- Status: PASSED. Evidence class: `EDITOR_TIMELINE_DESK_BROWSER_DIAGNOSTIC`. `runHead=b6299894d3f991107152014d2bd4ff9af6b0991b`; `trackedCodeDiffPaths=[]`; 29/29 milestones PASS; `firstFailedNode=null`.
- Evidence: `C:\Users\Equinox\AppData\Local\Temp\surdet-editorial-timeline-desk-3b-diagnostic-uDeiQx\evidence.json`, 151404 bytes, SHA-256 `69419B5A606F610BF5C7A80AEFE1CD7617A33FED15904A1DDD49A435622DB4E3`.
- Identity sidecar: 583 bytes, SHA-256 `E6AA3DE593A68A103AE30AFE1699792D9B7F824346AB8E4A32E4A0829D9CF645`.
- Runner: 79369 bytes, SHA-256 `66C57F051F858659D463F93F0DEC6BFAD384CE69648228CC60D5A79E13FCBF21`. Contract: 9333 bytes, SHA-256 `BA00DDB3518D32429118CC7587B2D012F0FA0BE7BAB375B8A9776E6DBD539D0A`.
- Preview evidence: URL `/preview.html`; `readyState=complete`; `runtimeReady=true`; `canvasCount=1`; `readySignal=true`.
- `errors=[]`, `consoleErrors=[]`, `pageErrors=[]`, `requestFailures=[]`, `responseFailures=[]`, `stderrLines=[]`, `childCleanupFailures=[]`.
- Strict port 4251 was released and is not listening. Original Starter unchanged. Saved/cold-reopened CRLF Timeline evidence remains intact.

**AUTHORIZED STOP**

```text
W3B_REQUEST_ABORT_CLASSIFICATION_RECOVERY_1 = PASSED
REPLACEMENT_DIAGNOSTIC = PASSED_1_OF_1
DIAGNOSTIC_MILESTONES = 29_OF_29
RUNNER_CONTRACT = PASSED_11_OF_11
CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
FORMAL = NOT_RUN
STAGING = EMPTY
PUSH = NOT_PERFORMED
FRONTEND_PASS_4 = NOT_STARTED
WAITING_FOR_FREEZE_AND_FORMAL_AUTHORIZATION = YES
```

### 2026-08-31 — W3B evidence freeze and FORMAL authorization

- Owner authorized exactly one freeze commit containing this taskbook, the reviewed design spec, the browser runner and its permanent contract, followed by one FORMAL. Push and Frontend Pass 4 remain prohibited.
- Pre-freeze HEAD: `b6299894d3f991107152014d2bd4ff9af6b0991b`.
- Exact freeze set:
  - `packages/editor/e2e/editorial-timeline-desk-wave-3b.e2e.mjs`
  - `packages/editor/test/editorial-timeline-desk-wave-3b-runner.test.mjs`
  - `docs/superpowers/plans/2026-08-31-surdet-timeline-desk-frontend-pass-3b.md`
  - `docs/superpowers/specs/2026-08-31-surdet-timeline-desk-frontend-pass-3b-design.md`
- Fresh pre-freeze gates: runner contract 11/11 PASS; runner syntax PASS; `verify:docs` PASS; worktree diff check PASS; staged diff check PASS.

```text
FREEZE_COMMIT = PENDING
CODE_EVIDENCE_HEAD = PENDING
FORMAL_BUDGET = 1_OF_1 UNCONSUMED
PUSH = NOT_PERFORMED
FRONTEND_PASS_4 = NOT_STARTED
```

### 2026-08-31 — Frontend Pass 3B FORMAL result

**FREEZE IDENTITY**

- Exact freeze commit / `CODE_EVIDENCE_HEAD`: `f70a8edce90e0572d4718c88b75717a028e54447`.
- Parent: `b6299894d3f991107152014d2bd4ff9af6b0991b`.
- Commit message: `test(editor): verify timeline desk workflow`.
- Commit scope is exactly the four authorized paths: runner, runner contract, this taskbook and design spec. Tracked worktree and staging were empty immediately before FORMAL.

**UNIQUE FORMAL**

- FORMAL budget 1/1 consumed once; exit 0; status PASSED; evidence class `EDITOR_TIMELINE_DESK_BROWSER_FORMAL`.
- `runHead === codeEvidenceHead === f70a8edce90e0572d4718c88b75717a028e54447`.
- Runner HEAD blob identity equals executing bytes: 79369 bytes, SHA-256 `66C57F051F858659D463F93F0DEC6BFAD384CE69648228CC60D5A79E13FCBF21`.
- `trackedCodeDiffPaths=[]`; 29/29 milestones PASS; `firstFailedNode=null`.
- FORMAL evidence: `C:\Users\Equinox\AppData\Local\Temp\surdet-editorial-timeline-desk-3b-formal-SvyESr\evidence.json`, 150249 bytes, SHA-256 `7E1BFDF61C238E1DDA4084627BB0C6085CE3BA443050955CD51A3551BD816DEB`.
- Identity sidecar: 571 bytes, SHA-256 `0C837F359487FE92A65716A07F5AC0ECEAEE5FCD227507ACBB620896BF8FCC6F`.
- Preview runtime evidence: URL `/preview.html`; `readyState=complete`; `runtimeReady=true`; one canvas; source-matched ready signal received.
- `errors=[]`, `consoleErrors=[]`, `pageErrors=[]`, `requestFailures=[]`, `responseFailures=[]`, `stderrLines=[]`, `childCleanupFailures=[]`.
- Strict port released; original Starter unchanged; single-Timeline save, CRLF identity and cold reopen all passed.

**POST-FORMAL BOUNDARY**

- This Ledger entry is the only tracked modification after FORMAL and remains intentionally uncommitted; no docs-only closure commit was authorized or created.
- No push, Owner visual acceptance or Frontend Pass 4 action occurred.

```text
FRONTEND_PASS_3B_FORMAL = PASSED
CODE_EVIDENCE_HEAD = f70a8edce90e0572d4718c88b75717a028e54447
FORMAL = PASSED_1_OF_1
FORMAL_MILESTONES = 29_OF_29
READY_FOR_INDEPENDENT_MANAGER_REVIEW = YES
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW = YES
PUSH = NOT_PERFORMED
FRONTEND_PASS_4 = NOT_STARTED
MAINLINE_WAVE_7 = NOT_DESIGNED / NOT_AUTHORIZED / NOT_STARTED
```

### 2026-08-31 — Independent-manager correction before push

**AUTHORIZATION / REVIEW RESULT**

- The Owner authorized the independent manager to repair the final-review findings, verify, commit and perform an ordinary push. Frontend Pass 4 and mainline Wave 7 remain out of scope.
- Independent final review changed the previous recommendation from PASS to `NEEDS_FIX` after finding two uncovered user paths:
  1. a stable physical `projectId` could be resolved through `isSameEntry()`, but a renamed directory was still rejected by mutable `dirName`; the next clean autosave tick could then remove the only recovery payload;
  2. `▶ 播放 / 重载` cleared `previewTimelineId`, silently converting a direct Timeline replay into an ordinary scene preview.

**RED -> GREEN / MINIMAL PRODUCT REPAIR**

- Autosave RED: 18/20 passed; the two expected failures proved renamed-project recovery returned `null` and a storage-key / payload `projectId` mismatch was accepted. GREEN: 20/20 PASS.
- Preview replay RED: 1 failed because expected `previewTimelineId=opening` became `null`. GREEN: 1/1 PASS; adjacent Preview set 9/9 PASS.
- `projectId` is now the only recovery identity after a physical handle has been proven. `dirName` remains display metadata. A payload whose embedded `projectId` does not match its scoped storage key fails closed.
- `▶ 播放 / 重载` now keeps the current direct-Timeline identity. The explicit scene-start / label selector still exits direct-Timeline mode.
- The browser runner now clicks the real replay control, requires the Timeline identity to remain selected and waits for a fresh runtime trace event before leaving Preview.

**FRESH LOCAL GATES**

- Editor full test: 51 files / 370 tests PASS.
- Editor typecheck: PASS.
- Editor build: PASS, 906 modules; only the existing Vite chunk-size warning remains.
- Runner contract: 11/11 PASS; runner syntax PASS; diff check PASS.

**FAILED DIAGNOSTIC EVIDENCE — PRESERVED, NOT REWRITTEN AS PRODUCT FAILURES**

- `N2sdgU`: failed at `layout-800` after 17 milestones because the newly added replay click left its asynchronous Preview load in flight before the runner returned to Timeline. Evidence 56610 bytes / SHA-256 `45677DAE8EC5ED07E4B95DB5F4B3FFA7610DA0A9BE6983D1A4526BB7D9FD803D`; identity 582 bytes / SHA-256 `94CAEF8A35D1960898D09B1704F4E81063C69F8609F6195955748869764748E2`.
- `RH9L4c`: failed at `timeline-history-scene-isolated`; the runner sampled `scrollLeft` before the redo restoration frame settled. Evidence 29453 bytes / SHA-256 `D979BFA7CD6C3F5C0303ACD76D9F8701E08D444D101CE9A89E25534B27480247`; identity 582 bytes / SHA-256 `7845D0CAE5435D61D69C0E85BC18F9BCD1A1705798B5551401552B9AD7D959AA`.
- `oEwTd7`: stable evidence proved the product final value was correct (`actualScrollLeft=1337`) while the runner had captured the transient pre-restore value as its expectation (`expectedScrollLeft=0`). Evidence 29628 bytes / SHA-256 `5C72526FC3312247ADD2AA57E67DFD904055FA7FDE45D433776E97FD5DBD99CC`; identity 582 bytes / SHA-256 `8588250D115D712DA4F825B6210D090B950F6ABAA5996C1AF77C3DB1529C47DA`.
- The permanent runner correction waits across the redo restoration frames before recording the expected scroll position, then samples the post-navigation value after two further animation frames. Exact equality remains required; no tolerance or error allow-list was added.

**PRE-FREEZE IDENTITY**

- Current base HEAD remains `f70a8edce90e0572d4718c88b75717a028e54447`; remote `surdet/main` remains `42be0fcd2f614f032b8a539475c039c7f4ebd66f` (ahead/behind 9/0 from the local perspective).
- Intended correction freeze contains exactly eight paths: the three product files, two product regression tests, browser runner, runner contract and this taskbook. Protected/unrelated untracked files remain untouched.
- Current runner: 80842 bytes / SHA-256 `05D72C7149D9F0FF2014BE02CE300D124778DE55B77074CDA266C5E0896ADA27`.
- Manager authorizes one replacement FORMAL only after an exact clean freeze commit. No more DIAGNOSTIC reruns are authorized. Any FORMAL failure stops before push.

```text
W3B_INDEPENDENT_MANAGER_CORRECTION = READY_TO_FREEZE
REPLACEMENT_FORMAL_BUDGET = 1_OF_1 UNCONSUMED
PUSH = AUTHORIZED_AFTER_REPLACEMENT_FORMAL_PASS
FRONTEND_PASS_4 = NOT_STARTED
```

### 2026-08-31 — Independent-manager replacement FORMAL failure

**FROZEN IDENTITY**

- Correction `CODE_EVIDENCE_HEAD`: `0632b9688effe5763a5512687214f8119b0a3171`; parent `f70a8edce90e0572d4718c88b75717a028e54447`; commit message `fix(editor): preserve recovery and preview identity`.
- Commit scope is exactly the eight predeclared paths. Tracked worktree and staging were empty before FORMAL. Runner HEAD identity was 80842 bytes / SHA-256 `05D72C7149D9F0FF2014BE02CE300D124778DE55B77074CDA266C5E0896ADA27`.

**REPLACEMENT FORMAL — FAILED, NOT RERUN**

- FORMAL budget 1/1 consumed once; exit 1; evidence class `EDITOR_TIMELINE_DESK_BROWSER_FORMAL`; `runHead === codeEvidenceHead`; `trackedCodeDiffPaths=[]`.
- Thirteen milestones passed. Last passed node: `destructive-confirm-undo-restore`. First failed node: `selected-timeline-preview-handoff`.
- Failure: after the real `▶ 播放 / 重载` click, the parent Editor did not receive a new runtime trace event within the fixed 10000ms bound. The run stopped before layout/save/cold-reopen milestones.
- Identity retention itself was not serialized because the combined wait timed out first. This artifact therefore does not prove whether the failure lies in async project reads, load dispatch, child runtime replay or parent trace receipt; no root cause is claimed.
- All independent browser error channels remained empty: console, page, request, HTTP response, Vite stderr and cleanup. Strict port 4251 was released; original Starter remained unchanged.
- The earlier scroll-sampling correction was independently proven by this FORMAL before the new failure: pre-round-trip expected/actual were both 1337, and post-round-trip `scrollLeft` remained 1337 at 300% zoom.
- Evidence: `C:\Users\Equinox\AppData\Local\Temp\surdet-editorial-timeline-desk-3b-formal-oWnYq7\evidence.json`, 34849 bytes, SHA-256 `DE1A3B5B5B59A5B918D250161037A5778E87ED557A72AD61527520EF66D5CB08`.
- Identity sidecar: 570 bytes, SHA-256 `2E6E0023D61F3478CFF008181E5DF7EC735F95828D0F7A3AB90119F8B9F956F1`.

**HARD STOP**

```text
W3B_INDEPENDENT_MANAGER_CORRECTION_COMMIT = 0632b9688effe5763a5512687214f8119b0a3171
REPLACEMENT_FORMAL = FAILED_1_OF_1
PUSH = NOT_PERFORMED
FRONTEND_PASS_4 = NOT_STARTED
WAITING_FOR_NEW_MANAGER_RECOVERY_AUTHORIZATION = YES
```

### 2026-08-31 — W3B replay-receipt recovery authorization

**READ-ONLY ROOT CAUSE REVIEW**

- Three bounded Luna audits and the manager's source review agreed that commit `0632b9688effe5763a5512687214f8119b0a3171` already preserves `previewTimelineId` and sends it in both initial/replay payloads. No additional backend, Renderer or public protocol change is justified.
- The failed FORMAL runner waited only for iframe boot/runtime construction before clicking replay. The initial parent `send()` and child `loadQueue` had not yet reached the direct `@timeline` instruction, so the second load correctly queued behind the first and no second runtime event could arrive within the bound.
- A legal direct Timeline run always emits a Core runtime event whose `event.source.op === 'timeline'` when the synthetic `@timeline` instruction executes. This is the minimum authoritative replay-start receipt; `surdet-preview-ready`, trace-start, interpreter construction and generic diagnostics are weaker.

**MINIMAL EVIDENCE REPAIR**

- Before replay, the runner now requires the first run's `source.op=timeline` event. Only then does it click the real `▶ 播放 / 重载` control.
- Because parent `send()` clears the previous trace synchronously, the runner then requires a second `source.op=timeline` event and the same `previewTimelineId`. Initial and replay event counts are serialized into `selected-timeline-preview-handoff`.
- The permanent panel test now records both real `surdet-preview-load` messages and proves `timelinePreviewId=opening` in both payloads; selecting the ordinary scene-start/label entry remains the only action in this test that clears direct-Timeline identity.
- No request allow-list, timeout relaxation, load cancellation, requestId protocol or speculative queue rewrite was added.

**RECOVERY BOUNDARY**

- Focused replay test: 1/1 PASS. Runner contract: 11/11 PASS. Runner syntax, Editor typecheck and diff check: PASS.
- Manager authorizes one new clean freeze commit containing exactly the taskbook, runner, runner contract and replay panel test, followed by one replacement FORMAL. Any failure stops before push; no DIAGNOSTIC rerun is authorized.

```text
W3B_REPLAY_RECEIPT_RECOVERY = READY_TO_FREEZE
AUTHORIZED_PATH_COUNT = 4
REPLACEMENT_FORMAL_BUDGET = 1_OF_1 UNCONSUMED
PUSH = AUTHORIZED_ONLY_AFTER_FORMAL_PASS
FRONTEND_PASS_4 = NOT_STARTED
```
