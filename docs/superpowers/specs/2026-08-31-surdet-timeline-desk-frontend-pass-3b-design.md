# Surdet Timeline Desk — Frontend Pass 3B Design

**Status:** READY_FOR_OWNER_REVIEW
**Date:** 2026-08-31
**Project phase:** POST_WAVE_6 / PRE_WAVE_7_EDITOR_POLISH
**Risk:** C — Editor state, recovery, persistence and interaction boundaries
**Authority:** `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`

---

## 1. Decision summary

Frontend Pass 3B rebuilds the full-page Timeline Desk only after repairing its editing safety. It stays entirely inside `packages/editor` and preserves the existing Core timeline schema, serialized English enum values, runtime playback and project file locations.

The page has one human job:

> Arrange one reusable performance timeline, preview it through the real runtime path, and recover safely from every edit before saving.

The page must not become a second video editor, a fake scene-linked Dock or a new runtime state machine.

---

## 2. Confirmed current problems

### 2.1 Undo targets the wrong document

`main.ts` routes only Configuration to an independent history. Timeline mode still calls the scene-text `undo()` / `redo()`, which reads `state.current` and can undo a screenplay scene while the user is editing a timeline. Timeline edits themselves have no history.

### 2.2 Existing CRLF files are normalized to LF on first edit

`TimelineEntry` has no EOL identity and `stringifyTimeline()` always emits `\n`. Reading and immediately saving preserves bytes, but any cue, track, duration, action or reset edit rewrites the full file with LF.

### 2.3 Destructive operations have no recovery contract

- deleting a cue immediately splices it;
- changing track kind replaces the complete track and its cues;
- changing cue action replaces the payload;
- reset replaces an invalid raw document;
- reducing total duration can clip cue timing;
- timeline deletion removes the in-memory entry immediately and only delays disk deletion.

### 2.4 Timeline autosave does not exist

The crash-recovery payload stores dirty screenplay scenes only. Timeline-only edits can disappear after restart and can even cause the existing scene-only autosave to be cleared.

### 2.5 New content fabricates Starter assets

`castle_hall`, `lynn:uniform` and `tense_01` are real Starter keys, not general project defaults. They currently enter new tracks/cues and Inspector placeholders. `sparkle` is different: it is a Renderer-defined built-in particle preset and may remain a documented preset.

### 2.6 Timeline evidence becomes stale after editing

The Timeline hook only marks the project dirty. It does not schedule validation, rebuild the Authoring object index or refresh the project bar, so issues and causal references can remain stale.

### 2.7 The ruler is deterministically wrong for short timelines

The existing fixed 500ms ruler plus a minimum of four segments repeats the final label for 100ms, 600ms and 1200ms timelines. This is an algorithmic defect, not a cosmetic edge case.

### 2.8 The page remains an English-heavy legacy layout

Track, action and easing enums appear directly as user copy. The layout assumes a wide three-column canvas, uses a colored selection rail, exposes pointer-only resize controls and can lose focus whenever the whole panel rerenders.

---

## 3. Non-negotiable invariants

1. `@surdet/core` remains the timeline schema and validation authority.
2. Serialized track kinds, action names and easing values remain unchanged.
3. `state.currentTimeline` remains the sole selected timeline ID.
4. Cue selection is one shared state bound to `state.currentTimeline`; no second module-local truth.
5. Timeline undo never reads or mutates a screenplay scene.
6. Scene undo never reads or mutates a timeline.
7. Existing LF/CRLF style survives every timeline edit and save.
8. New resource-bearing cues use actual project assets or remain unwritten; they never fabricate Starter keys.
9. Every destructive in-memory operation has an undo or explicit pre-save restore path.
10. Saving a pending timeline deletion is the commit boundary after which ordinary editor undo does not pretend the disk file still exists.
11. Full-page Timeline Desk is the only Timeline surface. The screenplay Dock remains absent.
12. No new dependency, lockfile, backend service, project format or runtime enum is introduced.

---

## 4. State and persistence design

### 4.1 Timeline entry identity

```ts
export interface TimelineEntry {
  id: string;
  file: string;
  text: string;
  eol: '\r\n' | '\n';
  dirty: boolean;
  handle: FileSystemFileHandle | null;
}
```

`readTimelineDir()` detects the first newline convention exactly as scene IO does. New files default to LF. Existing documents preserve their original convention after edits.

```ts
export function stringifyTimeline(
  definition: TimelineDefinition,
  eol: '\r\n' | '\n' = '\n',
): string;
```

The function formats one canonical JSON representation and then applies the requested EOL consistently, including the final newline.

### 4.2 Shared cue selection

```ts
export interface TimelineCueSelection {
  trackIndex: number;
  cueIndex: number;
}

state.currentTimelineCue: TimelineCueSelection | null;
```

Rules:

- changing `currentTimeline` clears the cue selection;
- `selectTimelineCue()` writes the timeline ID and the shared cue selection;
- delete, project switch and invalid selection clear it;
- selection survives ordinary rerender and Save All when the referenced cue still exists;
- selected styling checks the current timeline, track and cue together.

### 4.3 Independent timeline history

Create `packages/editor/src/timeline-history.ts` using the existing generic snapshot helpers, but keep timeline history separate from scene and config history. The history module owns text stacks only; it does not import the Timeline panel, render DOM or trigger application hooks.

```ts
export interface TimelineHistoryDepth {
  undo: number;
  redo: number;
}

export function pushTimelineSnapshot(timelineId: string, previousText: string): void;
export function takeTimelineUndo(timelineId: string, currentText: string): string | null;
export function takeTimelineRedo(timelineId: string, currentText: string): string | null;
export function clearTimelineHistory(timelineId: string): void;
export function clearTimelineHistories(): void;
export function timelineHistoryDepth(timelineId?: string): TimelineHistoryDepth;
```

Content history is keyed by timeline ID. It covers duration, cue/track add-delete, dragging, resize, parameters, action replacement, track replacement and raw reset. It stores exact text so undo restores unknown fields and formatting content, while subsequent new edits serialize with the entry's EOL. `main.ts` applies a returned text snapshot to the selected entry and then performs the one shared rerender/freshness hook. This one-way boundary prevents a `timeline-history` ↔ `timeline-panel` import cycle.

### 4.4 Whole-timeline deletion

Deleting an entire timeline creates a pre-save tombstone with the complete `TimelineEntry`, original array index and prior selection. Tombstones are keyed by timeline ID, so deleting a second timeline cannot overwrite recovery for the first. IDs in either `pendingTimelineDeletes` or the tombstone map remain reserved and cannot be reused by the new-timeline name allocator. The Timeline list shows every pending deletion with its own normal-flow `撤销删除` action.

Before Save All:

- restore returns the exact entry and selection and removes the same ID from `pendingTimelineDeletes`;
- disk remains unchanged.

After successful physical deletion:

- the tombstone and that ID's content history are cleared;
- undo no longer claims it can restore the committed disk file.

Deletion failure keeps both the pending delete and restore information available.

### 4.5 Crash recovery

Extend the existing autosave payload additively:

```ts
export interface AutosaveTimelineEntry {
  id: string;
  file: string;
  text: string;
  eol: '\r\n' | '\n';
}

export interface AutosavePayload {
  dirName: string;
  savedAt: number;
  scenes: AutosaveEntry[];
  timelines?: AutosaveTimelineEntry[];
}
```

Old scene-only payloads remain readable. Backup is cleared only when both scenes and timelines are clean. Recovery reports how many scenes and timelines will be restored and restores exact timeline text/EOL. If the timeline already exists on disk, recovery replaces its in-memory text/EOL and marks it dirty. If a newly created timeline has never reached disk, recovery inserts a new `TimelineEntry` with the preserved `file`, `handle: null` and `dirty: true`.

---

## 5. Neutral creation and project assets

### 5.1 Empty tracks are valid

Core allows tracks with `cues: []`. `createTrack(kind)` therefore returns a neutral empty track and never inserts `castle_hall`, `lynn:uniform` or `tense_01`.

Camera, screen and built-in particle cues can still use safe model defaults when the user explicitly adds that action. Background, portrait and audio cues require an explicit project selection before insertion.

```ts
export function createNeutralCue(
  kind: 'camera' | 'screen' | 'particle',
  action: string,
): TimelineCue | null;

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

`createNeutralCue()` rejects resource-bearing actions instead of fabricating data. `createResourceCue()` validates that the selected choice matches the track/action before producing a draft. For a portrait choice, the same atomic commit writes `choice.key` to `track.target` and the known expression to the cue; background/audio drafts need no track patch. The UI does not mutate timeline text until either constructor succeeds.

### 5.2 Asset choices

Timeline presentation derives selectable assets from `state.dirAssets`:

- background: `kind === 'bg'`;
- portrait: `kind === 'portrait'`, preserving target and known expression;
- audio: `bgm`, `se` or `voice`, constrained by chosen action.

`ambience` remains a valid project asset and screenplay instruction, but it is not a Core Timeline audio action and is therefore excluded from Timeline choices. If no matching asset exists, the UI says `当前项目没有可用素材` and offers a route to the existing asset workspace. It does not write a broken cue first.

### 5.3 Destructive replacement

Track type and cue action changes use an explicit replacement flow:

- show exactly what will be cleared;
- cancel leaves text, dirty state, selection and history unchanged;
- confirm pushes one history snapshot and performs one replacement;
- Ctrl/Cmd+Z restores the exact previous track/cue.

---

## 6. Dock deferral and future association prerequisite

Frontend Pass 3B does not create a scene-association production module because the full-page Timeline Desk has no present consumer for it. Creating a tested-but-unused abstraction would violate the project's minimal-implementation rule.

The screenplay workbench continues to mount zero Timeline panels. A later, separately approved Dock pass must first establish zero / single / multiple association truth from compiled `op === 'timeline'` instructions, preserve repeated and unresolved references, and prove that `state.currentTimeline` is never used as current-scene truth. That contract is recorded here as a prerequisite, not implemented speculatively in 3B.

---

## 7. Timeline Desk information architecture

```text
┌ 演出片段 ───────┬ 当前演出 opening ─────────────────────┐
│ 搜索  ＋新建    │ 1.2 秒 · 尚未保存   [预览演出] [更多] │
│ opening         ├──────────────────────────────────────┤
│ rain_arrival    │ [适应窗口] [缩小] [放大]   0.0 0.2… │
│ final_fade      │ 背景        ─── 演出片段 ─────────── │
│                 │ 角色立绘    ─────── 演出片段 ─────── │
│                 │ 镜头        ────────────────         │
│                 ├──────────────────────┬───────────────┤
│                 │                      │ 片段设置       │
└─────────────────┴──────────────────────┴───────────────┘
```

### 7.1 Regions

- `timeline-library`: timeline list, search, create and deletion recovery;
- `timeline-header`: active identity, duration, dirty/error state, preview and secondary actions;
- `timeline-toolbar`: fit/zoom and viewport facts only;
- `timeline-ruler`: natural ticks;
- `timeline-tracks`: real tracks and cue buttons;
- `timeline-inspector`: keyboard-accessible editing alternative;
- `timeline-recovery`: pending destructive operation / restore receipt.

### 7.2 Chinese display projection

Serialized values stay English; visible labels are Chinese.

Tracks:

| Serialized | Display |
|---|---|
| `background` | 背景 |
| `portrait` | 角色立绘 |
| `camera` | 镜头 |
| `screen` | 画面效果 |
| `particle` | 粒子特效 |
| `audio` | 声音 |

Actions include `设置背景`, `显示角色`, `隐藏角色`, `移动角色`, `切换表情`, `缩放镜头`, `平移镜头`, `镜头震动`, `透明度渐变`, `叠加色调`, `闪白`, `擦除转场`, `背景音乐`, `音效`, and `语音`.

Easing labels:

- `linear` → `匀速`;
- `inOutSine` → `柔和起止`;
- `outCubic` → `快出慢收`;
- `inOutCubic` → `平滑加减速`.

Raw enum, file path and JSON identity remain available in `<details>` technical information.

### 7.3 Visual language

- Reuse the established paper / ink / steel-blue Editor tokens.
- The signature element is a restrained production slate ruler, not colored SaaS cards.
- Track kind uses Chinese text and structure, not six rainbow colors.
- Selection uses a complete surface and border; no colored left rail or inset stripe.
- Primary actions stay in normal document flow; no sticky/fixed floating save or delete action.
- Preview continues through the existing Preview page and does not embed a second live preview.

---

## 8. Natural ruler and view state

Create a pure `buildTimelineTicks(durationMs, availableWidth, minLabelGap = 64)` projection using a `1 / 2 / 5 × 10ⁿ` natural step.

Contracts:

- tick values are unique and strictly increasing;
- 0 is present exactly once;
- final duration is present at most once;
- adjacent labels respect the requested minimum pixel gap;
- 0, 100, 499, 500, 600, 1200 and 600000ms are permanent cases;
- no duplicate 100% tick;
- view zoom affects presentation only.

Instant cues render as a clear time-point marker; duration cues keep real proportion but receive a minimum pointer target. Numeric Inspector inputs remain the keyboard alternative for drag and resize.

---

## 9. Responsive and accessibility design

Wide:

- library + central tracks + Inspector.

Medium:

- collapsible library + tracks + Inspector.

800px and 200% equivalent:

- tracks own the main surface;
- library and Inspector become normal-flow disclosures/drawers;
- ruler and track names remain reachable while the lane scrolls independently;
- preview, create, undo and recovery actions remain keyboard reachable;
- focus is restored to the exact edited cue/input after rerender;
- pointer drag uses capture/cancel cleanup;
- Inspector numbers provide all pointer-operation alternatives.

Evidence widths: 1440, 1280, 1024, 800 and 720 CSS px plus Chromium page-scale 200% command reachability.

---

## 10. Validation freshness

Every timeline edit hook performs the existing shared actions:

- mark project dirty;
- schedule validation;
- schedule Authoring index rebuild;
- refresh project-bar projection.

No Editor-private validation or object index is created.

---

## 11. Evidence and acceptance

Required technical evidence:

- timeline correctness RED → GREEN;
- complete Editor tests, typecheck and build;
- no change outside authorized Editor paths;
- isolated Chromium runner on a verified free port in 4251–4290;
- fake Starter-derived fixture with one CRLF timeline;
- edit → undo → redo without scene text mutation;
- destructive cancel and confirm→undo;
- preview selected timeline;
- save → dump fake filesystem → second fresh page/context → cold reopen;
- CRLF and edited value survive cold reopen;
- original Starter before/after identity unchanged;
- browser, console, request, stderr and cleanup channels empty.

Final Owner visual acceptance is limited to Timeline Desk readability and interaction feel. Automation must not fill it.

---

## 12. Explicit non-goals

- screenplay Timeline Dock;
- scene-to-timeline automatic selection UI;
- embedded preview or second Pixi runtime;
- playback head or live state not present in the model;
- Core/Renderer/Authoring/CLI changes;
- schema migration or new serialized enum;
- audio production or asset import;
- plugin/market/cloud/collaboration;
- mainline Wave 7;
- push, deployment, packaging or release.

---

## 13. Approval gate

This design authorizes documentation only. Production execution starts only after the Owner approves the design and its detailed taskbook. Failure in the correctness phase stops before visual migration.
