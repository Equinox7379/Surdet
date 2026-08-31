# Timeline Autosave Identity Fail-Closed Design

**Status:** Approved direction; implementation authorized after spec and taskbook freeze

**Date:** 2026-08-31

**Gate:** `TIMELINE_AUTOSAVE_IDENTITY_FAIL_CLOSED`

**Baseline:** `0adcc01973098f36ee33597cacaf62b94cb7cdd8`

## 1. Goal

Make Editor timeline crash recovery safe across filename changes, stable-ID changes, and JSON internal-ID changes. Automatic recovery may reuse an existing `FileSystemFileHandle` only when one canonical identity is proven. Ambiguous backups remain recoverable through explicit Chinese UI actions; they never silently overwrite a current timeline or create a second hidden identity truth.

## 2. Confirmed defect

The current chain is:

```text
readTimelineDir()
  -> TimelineEntry { id from filename, file, text, eol, handle }
buildAutosave()
  -> AutosaveTimelineEntry { id, file, text, eol }
pickRecoverableTimelines()
  -> restoreTimelineAutosaveEntries()
  -> saveAll()
```

`restoreTimelineAutosaveEntries()` currently looks up an existing entry by `file` first. When the recovered entry has the same file but a different outer `id`, it replaces `text/eol`, marks the old entry dirty, and retains the old `id` and old handle. `saveAll()` then writes the recovered text through that handle. Neither recovery nor conflict retention inspects the recovered JSON `definition.id`.

The real invariant already established by Authoring is:

```text
TimelineEntry.id === timelineIdFromPath(TimelineEntry.file) === JSON definition.id
```

Gate 2 must reuse that rule. It must not create an Editor-only alias, fallback, or secondary index.

## 3. Scope

### In scope

- Pure projection of timeline autosave identity from outer ID, relative file path, and JSON text.
- Fail-closed classification for current/recovered collisions.
- Exact-match automatic restore without replacing the existing ID, file, or handle.
- Safe insertion of a new unpersisted timeline only when its triple identity is canonical and unique.
- Structured conflict records with machine reasons and Chinese explanations.
- Persistent conflict retention across autosave ticks and successful saves.
- One optional backward-compatible `timelineConflicts` evidence bucket so unresolved recovered bytes and newer same-identity dirty bytes never overwrite each other.
- A compact human repair panel with explicit actions:
  - replace the uniquely identified current timeline with normalized backup content;
  - save normalized backup content as a new timeline ID;
  - keep current content and explicitly discard the backup;
  - download raw backup text when automatic normalization is impossible.
- Immediate revalidation and autosave persistence after every repair action.
- Permanent RED→GREEN tests for core classification, handle preservation, conflict persistence, and repair actions.

### Out of scope

- Core `TimelineDefinition` schema changes.
- Agent Port, CLI, Authoring public protocol, save-game format, or runtime changes.
- Timeline aliases, migration tables, automatic reference rewrites, or a second asset/timeline index.
- Automatically guessing that a rename, move, duplicate, or typo was intended.
- The separate possible race between project loading and a manual Save All click.
- Duplicate filename stems across nested timeline directories during ordinary project loading.
- A general merge editor or line-level JSON conflict resolver.
- Push, deployment, Frontend Pass 5, Review Terminal Atomicity, Asset Center, or Wave 7.

## 4. Identity model

Create `packages/editor/src/timeline-autosave-identity.ts` as a pure Editor adapter over the shared Authoring path rule.

```ts
export interface TimelineAutosaveDocument {
  id: string;
  file: string;
  text: string;
  eol: '\r\n' | '\n';
}

export interface TimelineAutosaveIdentity {
  stableId: string;
  file: string;
  fileId: string;
  definitionId: string | null;
  parseError: string | null;
  canonical: boolean;
}

export function inspectTimelineAutosaveIdentity(
  entry: TimelineAutosaveDocument,
): TimelineAutosaveIdentity;
```

Rules:

1. `fileId` comes only from Authoring `timelineIdFromPath(file)`.
2. The JSON text is parsed after removing one optional BOM.
3. `definitionId` is a non-empty string `value.id`; otherwise it is `null`.
4. Full timeline structure is not required for identity inspection. Crash recovery must be able to preserve an in-progress document with unrelated validation errors. JSON syntax and a string internal ID are the minimum identity proof.
5. `canonical=true` only when parsing succeeded and `stableId === fileId === definitionId`.
6. Identity inspection never mutates text, files, state, handles, or storage.

## 5. Conflict model

`restoreTimelineAutosaveEntries()` returns structured conflicts instead of only `{ id, currentFile, recoveredFile }`.

```ts
export type TimelineAutosaveConflictReason =
  | 'recovered-json-invalid'
  | 'recovered-id-mismatch'
  | 'current-json-invalid'
  | 'current-id-mismatch'
  | 'same-file-different-id'
  | 'same-id-different-file'
  | 'definition-id-collision';

export interface TimelineAutosaveRestoreConflict {
  key: string;
  reason: TimelineAutosaveConflictReason;
  recovered: AutosaveTimelineEntry;
  recoveredIdentity: TimelineAutosaveIdentity;
  current: TimelineAutosaveDocument | null;
  currentIdentity: TimelineAutosaveIdentity | null;
}
```

`key` is a stable in-memory selector derived from recovered `id`, recovered `file`, and recovered text. It is not a public ID or a persisted business identity.

The conflict owns an immutable, handle-free snapshot of the recovered entry and current identity facts. UI actions must not trust the snapshot as authority; they re-run classification against current `state.timelines` immediately before mutation.

## 6. Restore classification algorithm

For each recovered entry, in order:

1. Inspect recovered identity.
2. If recovered JSON cannot establish a string internal ID, return `recovered-json-invalid`.
3. If recovered outer ID, file stem, and internal ID differ, return `recovered-id-mismatch`.
4. Locate current entries independently by exact file, stable ID, and parsed internal ID.
5. If the same file belongs to another stable ID, return `same-file-different-id`.
6. If the same stable ID belongs to another file, return `same-id-different-file`.
7. If another current entry claims the recovered internal ID, return `definition-id-collision`.
8. When the exact current `id + file` entry exists, inspect it. Invalid JSON yields `current-json-invalid`; a non-canonical triple yields `current-id-mismatch`.
9. Only an exact canonical current identity may receive recovered `text/eol`. Its `id`, `file`, and `handle` remain unchanged; it becomes dirty.
10. If no current entry collides and the recovered identity is canonical, insert one dirty entry with `handle:null`.

No conflict branch may change a current entry, current selection, dirty bit, handle, timeline history, filesystem, or autosave bytes.

## 7. Conflict persistence

The current module-level pending list remains the temporary UI owner, but its element type becomes `TimelineAutosaveRestoreConflict`.

`AutosavePayload` gains one optional field:

```ts
timelineConflicts?: AutosaveTimelineEntry[];
```

Existing `timelines` keeps its current meaning: the newest dirty working entries. `timelineConflicts` contains only recovered bytes that were explicitly classified as unresolved. Old scenes-only and timelines-only snapshots remain readable; the new field is never required.

An unresolved conflict is cleared automatically only when current state contains a canonical entry whose `id`, `file`, `text`, and `eol` exactly equal the recovered entry. Matching `id + file` alone is insufficient.

`preserveAutosaveTimelineConflicts()` writes recovered `AutosaveTimelineEntry` payloads to `timelineConflicts`, never to the ordinary `timelines` array and never with DOM state or `FileSystemFileHandle`. A newer dirty snapshot with the same outer ID/file stays independently in `timelines`; neither byte stream overwrites the other.

On startup, `timelineConflicts` entries are reconstructed as conflicts and shown to the user. They are not passed through the automatic exact-match restore path. This prevents a previously quarantined backup from overwriting a newer working snapshot after restart.

Conflict repair/discard updates localStorage immediately rather than waiting for the 30-second timer.

## 8. Explicit repair actions

Create pure preparation functions in `timeline-autosave-identity.ts` and stateful application functions beside `restoreTimelineAutosaveEntries()` in `project-io.ts`.

### 8.1 Replace current timeline

Available only when the conflict points to exactly one current entry by file or stable ID and the recovered text is parseable as a JSON object.

On explicit confirmation:

1. Re-find the current entry and reclassify the conflict.
2. Abort with a Chinese error if the target changed or became ambiguous.
3. Rewrite only the recovered JSON `id` to the target current stable ID.
4. Serialize with the recovered EOL.
5. Push the current text into timeline undo history.
6. Replace current `text/eol`, mark dirty, and retain current `id/file/handle`.
7. Inspect the fully prepared replacement and require a canonical triple before changing the current entry.
8. Apply the prepared text/EOL in one mutation, remove the conflict, and immediately persist remaining autosave state.

The project file is not written until the existing Save All path runs.

### 8.2 Save as new timeline

The user supplies a new ID. It must:

- be non-empty and satisfy the existing timeline ID character rule;
- have no collision with current timeline IDs, file paths, parsed internal IDs, pending deletes, or pending restores;
- map to `<newId>.json` through the existing canonical rule.

The recovered JSON `id` is rewritten to `newId`; the result is inserted as a dirty `TimelineEntry` with `handle:null`. It will use the existing save path to create `content/timelines/<newId>.json`. No scene reference is rewritten automatically.

### 8.3 Keep current and discard backup

After explicit confirmation, remove only that recovered conflict entry and immediately rewrite or clear the autosave snapshot. Current timeline state and files remain unchanged.

### 8.4 Invalid JSON

Invalid JSON cannot be normalized safely. Replace and Save As New remain disabled. The panel offers raw-text download, explicit discard, and Later. Download does not alter project or autosave state.

## 9. Human interface

Create `packages/editor/src/panels/timeline-autosave-conflicts.ts`.

The panel is rendered above the active Editor mode whenever pending conflicts exist, so the user does not have to discover a hidden Timeline tab. It uses natural Chinese and progressive disclosure:

- heading: `演出备份需要处理`;
- one-line summary and conflict count;
- each card shows `当前项目` and `自动备份` with file, stable ID, and internal ID;
- a short reason label such as `同一文件对应了不同名称`;
- technical JSON text stays collapsed;
- primary action is context-dependent Replace or Save As New;
- destructive discard is secondary and requires confirmation;
- Later collapses the panel but preserves the backup.

The DOM exposes stable `data-*` hooks and reason codes for tests/agents. Visible copy does not expose English enums unless technical details are expanded.

No colored left selection bars, decorative gradients, generic dashboard cards, or unrelated visual redesign enter this correctness gate.

## 10. Error handling and atomicity

- All preparation occurs before state mutation.
- Revalidation occurs immediately before mutation.
- A thrown parse, validation, collision, or stale-target error leaves state and autosave unchanged.
- Replace Current mutates one existing entry only after the normalized text is ready.
- Save As New constructs the complete entry before one `state.timelines.push()`.
- Conflict removal happens only after the repair mutation succeeds.
- Immediate autosave persistence happens after in-memory success. If localStorage persistence fails, the existing storage wrapper remains fail-soft, but the project file is still not written automatically.
- Save All remains the sole filesystem writer.

## 11. Test strategy

### Pure identity tests

- canonical nested path / stable ID / internal ID;
- same file with a different stable ID;
- same stable ID with a different file;
- internal ID mismatch;
- invalid JSON, missing ID, non-string ID;
- normalization preserves all non-ID JSON fields and selected EOL;
- invalid replacement ID rejects without output.

### Restore and handle tests

- exact triple restores and later writes through the original handle;
- same file / different ID returns conflict and leaves text/eol/dirty/handle unchanged;
- same ID / different file remains fail-closed;
- matching outer ID/file with different internal ID returns conflict;
- invalid recovered JSON returns conflict;
- canonical new entry is inserted with `handle:null`;
- non-canonical new entry is not inserted;
- combined collisions produce independent stable reasons.

### Persistence tests

- unresolved internal-ID conflict survives autosave tick/save-success filtering;
- `id + file` equality alone cannot clear it;
- exact canonical text/EOL clears it;
- a fresh dirty snapshot and unresolved recovered bytes coexist in `timelines` and `timelineConflicts`.

### Repair tests

- Replace Current revalidates, pushes undo, retains handle/path, and produces canonical text;
- stale target aborts with zero mutation;
- Save As New rejects every collision class and inserts one canonical dirty null-handle entry on success;
- discard removes only the selected conflict;
- invalid JSON only exposes download/discard/later actions.

### UI contract tests

- Chinese heading/reason/current-vs-backup fields;
- stable reason/data hooks;
- disabled unsafe actions;
- explicit confirmation for discard/replace;
- technical text collapsed by default;
- no conflict panel when list is empty.

### Verification

- Focused RED→GREEN tests for the new helper, autosave, project IO, panel, and main integration.
- Editor full tests, typecheck, and build.
- One root `verify:all` only if the final diff crosses shared workspace verification boundaries; otherwise root tools/docs/hygiene plus Editor full gates are proportionate.
- `git diff --check`, exact staging, commit-scope readback, and independent manager review.

## 12. File plan

Expected production files:

- Create `packages/editor/src/timeline-autosave-identity.ts`.
- Modify `packages/editor/src/autosave.ts`.
- Modify `packages/editor/src/project-io.ts`.
- Modify `packages/editor/src/main.ts`.
- Create `packages/editor/src/panels/timeline-autosave-conflicts.ts`.
- Modify the existing Timeline workspace stylesheet only for the compact conflict surface.

Expected tests:

- Create `packages/editor/test/timeline-autosave-identity.test.ts`.
- Modify `packages/editor/test/autosave.test.ts`.
- Modify `packages/editor/test/project-io.test.ts`.
- Create `packages/editor/test/timeline-autosave-conflicts.test.ts`.
- Add or update a narrow main integration/static contract only if required to prove immediate persistence and panel wiring.

## 13. Acceptance criteria

1. Automatic recovery occurs only for a proven canonical triple.
2. Every mismatch leaves current ID, file, text, EOL, dirty bit, and handle unchanged.
3. No mismatch can reach Save All through an old handle without explicit repair.
4. Conflict bytes survive later autosave activity until repaired or explicitly discarded.
5. Same-identity fresh dirty bytes and conflict bytes are both preserved in separate optional autosave arrays.
6. The user can safely Replace Current or Save As New when normalization is possible.
7. Invalid JSON remains downloadable and recoverable manually, never silently discarded.
8. Visible conflict UI is Chinese-first and explains current versus backup identity.
9. Core, Authoring public contracts, Agent Port, project timeline path semantics, and save-game format remain unchanged.
10. Existing successful timeline autosave recovery and CRLF/LF preservation continue to pass.
11. No push or next repair gate begins under this design.

## 14. Design decision record

The project owner selected fail-closed preservation (Approach A) and then approved explicit guided repair rather than permanent quarantine. Automatic filename-only normalization was rejected because it cannot distinguish a deliberate rename from a stale backup. Preserve-only with no repair UI was rejected as safe but unnecessarily hostile to human users.

The owner explicitly authorized the sequence `write spec -> write taskbook -> implement` without another interactive pause. This authorization does not waive RED→GREEN, scope review, or final evidence boundaries.
