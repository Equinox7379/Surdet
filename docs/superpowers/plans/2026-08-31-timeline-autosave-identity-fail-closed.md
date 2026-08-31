# Timeline Autosave Identity Fail-Closed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make timeline crash recovery prove `stable ID === file stem === definition.id` before automatic mutation, preserve every ambiguous backup, and provide explicit Chinese repair actions without writing through the wrong file handle.

**Architecture:** A new pure identity module reuses Authoring's canonical path rule and owns parse/normalize/classification facts. `project-io.ts` remains the only stateful recovery/repair adapter and `saveAll()` remains the only filesystem writer. A small handle-free conflict panel projects structured conflicts from `main.ts`; every action revalidates current state before one atomic in-memory mutation and immediately persists remaining autosave evidence.

**Tech Stack:** TypeScript, DOM APIs, File System Access handles, localStorage autosave adapter, `@surdet/authoring` timeline identity helpers, Vitest, Vite.

## Global Constraints

- Approved design: `docs/superpowers/specs/2026-08-31-timeline-autosave-identity-fail-closed-design.md` at commit `22f70ad`.
- The canonical invariant is exactly `TimelineEntry.id === timelineIdFromPath(TimelineEntry.file) === JSON definition.id`.
- Exact canonical identity may auto-restore; every missing, invalid, ambiguous, or mismatched identity is fail-closed.
- No conflict branch may change current text, ID, file, EOL, dirty state, handle, selection, history, filesystem, or autosave bytes.
- Save All remains the only filesystem writer. Guided repair prepares dirty in-memory entries only.
- Do not change Core schema, Authoring/CLI/Agent Port public contracts, project path semantics, save-game format, test timeouts, or package dependencies.
- Do not add aliases, fallback lookup, migration tables, a second timeline index, automatic scene-reference rewrites, or a general JSON merge editor.
- Preserve scenes-only autosave compatibility and existing `AutosaveTimelineEntry` fields.
- Add only an optional `AutosavePayload.timelineConflicts` evidence bucket; ordinary dirty entries remain in `timelines`, and old payloads require no migration.
- Visible UI is Chinese-first; English reason enums live only in `data-*`/technical projections.
- Preserve all unrelated and protected untracked files. Never use `git add .` or `git add -A`.
- No push, Review Terminal Atomicity, Asset Center, Frontend Pass 5, or Wave 7 work.

---

## File map

- Create `packages/editor/src/timeline-autosave-identity.ts`: pure identity inspection, normalization, conflict key/reason projection.
- Modify `packages/editor/src/autosave.ts`: share the document type and retain unresolved conflicts using canonical identity plus exact text/EOL.
- Modify `packages/editor/src/project-io.ts`: fail-closed restore classification and explicit repair adapters; preserve handles unless the user explicitly targets the current entry.
- Create `packages/editor/src/panels/timeline-autosave-conflicts.ts`: compact Chinese conflict surface and action callbacks.
- Modify `packages/editor/src/main.ts`: own pending conflicts, render the panel, dispatch repairs, immediately persist autosave evidence.
- Modify `packages/editor/src/styles/timeline-workspace.css`: minimal conflict surface styles using existing tokens and no colored selection bar.
- Create `packages/editor/test/timeline-autosave-identity.test.ts`: pure identity and normalization contract.
- Modify `packages/editor/test/autosave.test.ts`: unresolved/preserved conflict contract.
- Modify `packages/editor/test/project-io.test.ts`: restore and repair atomicity/handle contract.
- Create `packages/editor/test/timeline-autosave-conflicts.test.ts`: Chinese DOM/action availability contract.
- Create `packages/editor/test/timeline-autosave-conflict-integration.test.ts`: narrow main wiring and immediate-persistence contract.
- Append this taskbook with exact RED/GREEN, commits, test counts, failure boundaries, and final stop state.

### Task 0: Freeze baseline and exact invariants

**Files:**
- Read: `packages/editor/src/autosave.ts`
- Read: `packages/editor/src/project-io.ts`
- Read: `packages/authoring/src/timeline-identity.ts`
- Modify: `docs/superpowers/plans/2026-08-31-timeline-autosave-identity-fail-closed.md`

**Interfaces:**
- Consumes: `timelineIdFromPath(path)` and `timelinePathFor(timelineId)` from `@surdet/authoring`.
- Produces: a baseline record proving current HEAD, clean tracked/staging state, current defect location, and unchanged protected files.

- [x] **Step 1: Record baseline**

Run read-only Git identity/status commands. Expected baseline HEAD is the taskbook commit parent; tracked worktree and staging must be clean before RED tests. Existing long-term ledger and protected untracked paths remain untouched.

- [x] **Step 2: Reconfirm the defect without editing production**

Read the bodies of `restoreTimelineAutosaveEntries()`, `saveAll()`, `pickRecoverableTimelines()`, and `unresolvedAutosaveTimelineConflicts()`. Record that current recovery matches file before outer ID and never parses `definition.id`.

### Task 1: Pure triple-identity projection and normalization

**Files:**
- Create: `packages/editor/src/timeline-autosave-identity.ts`
- Create: `packages/editor/test/timeline-autosave-identity.test.ts`

**Interfaces:**
- Consumes: `timelineIdFromPath()` and `timelinePathFor()` from `@surdet/authoring`.
- Produces:

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

export function inspectTimelineAutosaveIdentity(entry: TimelineAutosaveDocument): TimelineAutosaveIdentity;

export type TimelineAutosaveNormalizeResult =
  | { ok: true; entry: TimelineAutosaveDocument }
  | { ok: false; error: string };

export function normalizeTimelineAutosaveDocument(
  source: TimelineAutosaveDocument,
  targetId: string,
  targetFile?: string,
): TimelineAutosaveNormalizeResult;
```

- [x] **Step 1: Write pure RED tests**

Cover exact canonical nested path, outer/file mismatch, internal mismatch, invalid JSON, missing/non-string ID, BOM, CRLF/LF normalization, valid new ID, invalid new ID, and preservation of every non-ID JSON field.

Representative assertions:

```ts
expect(inspectTimelineAutosaveIdentity({
  id: 'intro', file: 'nested/intro.json',
  text: '{"version":1,"id":"intro","durationMs":100,"tracks":[]}', eol: '\n',
})).toMatchObject({ fileId: 'intro', definitionId: 'intro', canonical: true });

expect(inspectTimelineAutosaveIdentity({
  id: 'intro', file: 'intro.json', text: '{"id":"other"}', eol: '\n',
}).canonical).toBe(false);

expect(normalizeTimelineAutosaveDocument(source, 'new_id')).toMatchObject({
  ok: true,
  entry: { id: 'new_id', file: 'new_id.json', eol: source.eol },
});
```

- [x] **Step 2: Run RED once**

```powershell
npm run test -w surdet-editor -- --run test/timeline-autosave-identity.test.ts
```

Expected: module/import or missing-export failures only.

- [x] **Step 3: Implement the pure helper**

Implementation requirements:

- remove at most one BOM before `JSON.parse`;
- require a non-array object and a non-empty string `id`;
- derive `fileId` only through `timelineIdFromPath`;
- set `canonical` from exact equality of all three IDs;
- validate `targetId` by calling `timelinePathFor(targetId)` rather than copying the regex;
- for default Save As New, strip the `content/timelines/` prefix from `timelinePathFor(targetId)`;
- parse and fully prepare normalized JSON before returning success;
- serialize with two-space indentation, one trailing newline, and the requested EOL;
- never mutate the source object or parsed source record.

- [x] **Step 4: Run GREEN once**

Run the same focused command. Expected: all pure identity tests pass.

### Task 2: Fail-closed restore and handle preservation

**Files:**
- Modify: `packages/editor/src/project-io.ts`
- Modify: `packages/editor/test/project-io.test.ts`

**Interfaces:**
- Consumes: `inspectTimelineAutosaveIdentity()` and `TimelineAutosaveDocument`.
- Produces:

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

export interface TimelineAutosaveRestoreResult {
  restored: number;
  conflicts: TimelineAutosaveRestoreConflict[];
}
```

- [x] **Step 1: Write restore RED tests**

Use valid timeline JSON fixtures rather than plain placeholder text. Freeze:

- exact canonical triple updates only text/EOL/dirty and retains the exact handle;
- same file/different outer ID conflicts with zero entry mutation and zero writes after `saveAll()`;
- same outer ID/different file remains conflict;
- same outer/file with different internal ID conflicts;
- invalid recovered JSON conflicts;
- invalid current JSON conflicts on an exact target;
- canonical new timeline inserts `handle:null`;
- non-canonical new timeline does not insert;
- internal-ID collision against another current entry conflicts.

- [x] **Step 2: Run restore RED once**

```powershell
npm run test -w surdet-editor -- --run test/project-io.test.ts
```

Expected: new identity/atomicity cases fail on current file-first behavior while existing save isolation remains green.

- [x] **Step 3: Implement classification before mutation**

For every recovered entry, compute all recovered/current projections and collision candidates before changing `state.timelines`. Build immutable handle-free conflict snapshots. Only exact canonical target or unique canonical insertion reaches mutation.

For exact restore:

```ts
existing.text = recovered.text;
existing.eol = recovered.eol;
existing.dirty = true;
```

Do not assign `existing.id`, `existing.file`, or `existing.handle`.

- [x] **Step 4: Run restore GREEN once**

Run the same focused project-IO test. Expected: all tests pass and wrong-handle writes remain zero.

### Task 3: Preserve unresolved identity evidence

**Files:**
- Modify: `packages/editor/src/autosave.ts`
- Modify: `packages/editor/test/autosave.test.ts`

**Interfaces:**
- Consumes: `inspectTimelineAutosaveIdentity()`.
- Produces: optional `timelineConflicts` parsing/persistence and conflict retention that resolves only on canonical exact ID/file/text/EOL.

- [x] **Step 1: Write persistence RED tests**

Freeze these cases:

```ts
expect(unresolvedAutosaveTimelineConflicts([conflict], [{
  id: 'same', file: 'same.json', text: currentCanonicalText, eol: '\n',
}])).toEqual([conflict]);

expect(unresolvedAutosaveTimelineConflicts([conflict], [{
  id: conflict.id, file: conflict.file, text: conflict.text, eol: conflict.eol,
}])).toEqual([]);
```

The first case uses the same outer tuple but different recovered bytes/internal ID. Also prove `preserveAutosaveTimelineConflicts()` keeps the fresh working entry in `timelines` and the unresolved recovered bytes in optional `timelineConflicts`, and that `parseAutosave()` reads both arrays without making the new field mandatory.

- [x] **Step 2: Run persistence RED once**

```powershell
npm run test -w surdet-editor -- --run test/autosave.test.ts
```

- [x] **Step 3: Implement canonical exact resolution**

Update `unresolvedAutosaveTimelineConflicts()` input projection to include `text/eol`. A conflict resolves only if a current entry is canonical and exactly matches the recovered ID, file, text, and EOL. Write unresolved entries to `payload.timelineConflicts`; never merge them into or overwrite `payload.timelines`. On startup, conflict-bucket entries bypass automatic restore and are rebuilt as pending structured conflicts.

- [x] **Step 4: Run persistence GREEN once**

Run the same focused autosave test. Expected: all tests pass, including scenes-only legacy parsing.

- [x] **Step 5: Commit the correctness core**

Stage only the pure helper/test, autosave source/test, project-IO source/test, the minimal `main.ts` structured-conflict projection adaptation, and this taskbook. Verify the exact set and commit:

```text
fix(editor): fail closed timeline autosave identity
```

### Task 4: Explicit repair operations

**Files:**
- Modify: `packages/editor/src/project-io.ts`
- Modify: `packages/editor/test/project-io.test.ts`

**Interfaces:**
- Consumes: structured conflict records, `normalizeTimelineAutosaveDocument()`, `pushTimelineSnapshot()`, current `state.timelines`, pending delete/restore state.
- Produces:

```ts
export type TimelineAutosaveRepairAction =
  | { kind: 'replace-current' }
  | { kind: 'save-as-new'; newId: string };

export type TimelineAutosaveRepairResult =
  | { ok: true; timelineId: string }
  | { ok: false; error: string };

export function repairTimelineAutosaveConflict(
  conflict: TimelineAutosaveRestoreConflict,
  action: TimelineAutosaveRepairAction,
): TimelineAutosaveRepairResult;
```

- [x] **Step 1: Write repair RED tests**

Freeze Replace Current success, Save As New success, invalid new ID, ID/file/internal collision, pending delete/restore collision, invalid JSON, stale current target, undo snapshot, retained handle/path, and zero mutation for every failure.

- [x] **Step 2: Run repair RED once**

Run the focused project-IO test. Expected: missing repair export/cases fail.

- [x] **Step 3: Implement prepare-then-apply repair**

Replace Current re-finds a unique target by the recorded current ID/file, normalizes recovered text to that target, verifies canonical output, pushes one undo snapshot, then assigns text/EOL/dirty only.

Save As New validates via `timelinePathFor`, rejects all current/pending collisions, constructs the full null-handle entry, verifies canonical output, and pushes exactly once.

- [x] **Step 4: Run repair GREEN once**

Run the focused project-IO test. Expected: all restore and repair cases pass.

### Task 5: Chinese conflict panel

**Files:**
- Create: `packages/editor/src/panels/timeline-autosave-conflicts.ts`
- Create: `packages/editor/test/timeline-autosave-conflicts.test.ts`
- Modify: `packages/editor/src/styles/timeline-workspace.css`

**Interfaces:**
- Consumes: readonly structured conflicts and callback options.
- Produces:

```ts
export interface TimelineAutosaveConflictPanelActions {
  onReplaceCurrent: (key: string) => void;
  onSaveAsNew: (key: string, newId: string) => void;
  onDiscard: (key: string) => void;
  onDownload: (key: string) => void;
}

export function renderTimelineAutosaveConflictPanel(
  container: HTMLElement,
  conflicts: readonly TimelineAutosaveRestoreConflict[],
  actions: TimelineAutosaveConflictPanelActions,
): void;
```

- [x] **Step 1: Write panel RED tests**

Test no-conflict emptiness; heading `演出备份需要处理`; current/backup file and IDs; Chinese reason map; stable `data-conflict-key`/`data-conflict-reason`; collapsed technical text; Replace availability only with a current target and parseable backup; Save As New disabled for invalid JSON; discard/replace confirmation callbacks; download availability for invalid JSON.

- [x] **Step 2: Run panel RED once**

```powershell
npm run test -w surdet-editor -- --run test/timeline-autosave-conflicts.test.ts
```

- [x] **Step 3: Implement semantic DOM and minimal styles**

Use `<section>`, `<details>`, `<button>`, `<label>`, and `<input>`; do not inject raw HTML. Buttons use `type=button`. Destructive discard is visually secondary. CSS uses existing variables, 14px-or-larger body copy, clear spacing, keyboard focus, no gradient, no shadow stack, and no colored left selection bar.

- [x] **Step 4: Run panel GREEN once**

Run the same focused panel test. Expected: all DOM/action contracts pass.

### Task 6: Main integration and immediate persistence

**Files:**
- Modify: `packages/editor/src/main.ts`
- Create: `packages/editor/test/timeline-autosave-conflict-integration.test.ts`

**Interfaces:**
- Consumes: `TimelineAutosaveRestoreConflict[]`, panel renderer, repair adapter, autosave build/preserve/write/clear functions.
- Produces: one source of pending conflict state and immediate persistence after action.

- [x] **Step 1: Write integration tests**

Prove:

- restore stores structured conflicts directly instead of reverse-looking up by old ID/file fields;
- `renderMainArea()` mounts the panel above the active mode surface whenever conflicts exist;
- Replace/Save As New remove a conflict only after repair success;
- discard requires confirmation and removes only its key;
- every successful repair/discard immediately rebuilds/preserves/writes or clears autosave;
- a failed/stale repair keeps the conflict and backup;
- invalid JSON download does not remove the conflict;
- status copy is Chinese and reports exact failure without claiming a save.

- [ ] **Step 2: Run integration RED once**

Run the narrow integration test. Expected: wiring exports/hooks are absent.

- [x] **Step 3: Implement shared persistence helper and callbacks**

Extract one main-local `persistCurrentAutosave(now)` used by interval tick and conflict actions. Keep `pendingAutosaveTimelineConflicts` as structured records. For persistence, pass `conflict.recovered` entries to the autosave evidence functions.

Render the panel before the active mode content. Download uses a Blob/temporary anchor and never mutates project/autosave state.

- [x] **Step 4: Run integration GREEN once**

Run the integration test, then the four focused test files together. Expected: all pass.

- [x] **Step 5: Commit guided repair UI**

Stage only Task 4–6 files plus this taskbook and commit:

```text
feat(editor): guide timeline backup conflict repair
```

### Task 7: Proportional final verification and evidence freeze

**Files:**
- Modify: `docs/superpowers/plans/2026-08-31-timeline-autosave-identity-fail-closed.md`

**Interfaces:**
- Consumes: Tasks 1–6 commits.
- Produces: one reviewed local evidence head, with no push and no third repair gate.

- [ ] **Step 1: Run focused combined tests**

```powershell
npm run test -w surdet-editor -- --run test/timeline-autosave-identity.test.ts test/autosave.test.ts test/project-io.test.ts test/timeline-autosave-conflicts.test.ts test/timeline-autosave-conflict-integration.test.ts
```

- [ ] **Step 2: Run Editor full gates**

```powershell
npm run test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

- [ ] **Step 3: Run one aggregate verification**

Because this gate changes crash recovery, state mutation, shared Authoring identity consumption, and browser UI wiring, run exactly one:

```powershell
npm run verify:all
```

If it fails, record the first failure and stop without rerun or timeout changes.

- [ ] **Step 4: Verify scope and commit identities**

Run both diff checks, inspect every commit scope, confirm no production path outside the approved Editor files, and confirm the long-term ledger/protected files remain unstaged.

- [ ] **Step 5: Independent manager review**

Use one bounded read-only secondary reviewer for the final commit range; the manager independently checks every finding, actual diff, and fresh outputs. Subagent review does not replace remote CI or owner acceptance.

- [ ] **Step 6: Append final stop state**

Record exact HEAD/parents, counts, aggregate result, tracked/staging status, known evidence gaps, and:

```text
TIMELINE_AUTOSAVE_IDENTITY_FAIL_CLOSED_LOCAL_VERIFIED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
PUSH_NOT_PERFORMED
REVIEW_TERMINAL_ATOMICITY_NOT_STARTED
ASSET_CENTER_NOT_STARTED
FRONTEND_PASS_5_NOT_STARTED
WAVE_7_NOT_STARTED
```

## Execution Ledger

Append-only. Record actual commands, exits, counts, failures, commits, recovery decisions, reviewer findings, and stop states. Never rewrite a failed run as green.

- 2026-08-31 design baseline: approved spec and implementation baseline `22f70addc0696ed5c81e335930dd6748d9da1980`. Gate 1 is closed locally at `0adcc019`; remote Ubuntu CI and push remain unverified/unauthorized. Gate 3 and Asset Center have not started.
- Owner design choice: fail-closed preservation plus explicit guided repair. Automatic filename-only guessing and permanent preserve-only quarantine were rejected.
- Delegation boundary: Luna workers may own RED tests or the pure panel module with exact file ownership. The manager owns identity architecture, stateful restore/repair, main integration, final verification, commits, and completion claims.
- Task 0 baseline after taskbook freeze: `HEAD=7d30380d1d4701801284b64c0882f19f60419331`, `surdet/main=bca72247d0dc76983330367be0f38043036a0fca`, ahead/behind `8/0`, tracked worktree clean, staging empty. Only the pre-existing untracked/protected paths and the intentionally untracked long-term roadmap ledger remain outside Git.
- Manager source reconfirmation: `restoreTimelineAutosaveEntries()` still matches `file` before outer ID, overwrites text/EOL while retaining the old handle, and never inspects JSON `definition.id`; `unresolvedAutosaveTimelineConflicts()` still considers only outer `id + file`. No production edit had occurred when this baseline was recorded.
- Design self-review amendment before production: unresolved conflict bytes and newer same-identity dirty bytes require separate storage. The approved backward-compatible representation is optional `AutosavePayload.timelineConflicts`; it is not a save-game or public protocol change. Tests must prove ordinary `timelines` and quarantined conflict bytes coexist and that the conflict bucket never auto-applies after restart.
- Task 1 RED was delegated to one bounded Luna worker owning only `packages/editor/test/timeline-autosave-identity.test.ts`. The one focused run exited `1` at the expected missing `../src/timeline-autosave-identity.js` module; no production file existed. Manager review corrected one over-restrictive worker assumption: a parseable JSON object with missing/non-string/empty `id` can be explicitly normalized because the user has chosen a target ID; only invalid JSON or a non-object root is unrepairable.
- Task 1 GREEN: the manager implemented `packages/editor/src/timeline-autosave-identity.ts` using Authoring `timelineIdFromPath/timelinePathFor`, BOM-safe object parsing, path traversal rejection, exact triple projection, source-immutable normalization, EOL preservation, and no output on failure. The sole focused GREEN exited `0`: `1/1` file, `24/24` tests.
- Task 2/3 RED was delegated to one bounded Luna worker owning only `project-io.test.ts` and `autosave.test.ts`. The one Project IO RED exited `1` with `15/23` passed and `8` identity/atomicity failures; the one Autosave RED exited `1` with `15/20` passed and `5` missing conflict-bucket/exact-resolution failures. The worker changed no production or Git state.
- Task 2 first GREEN exited `0`: `project-io.test.ts` passed `23/23`. The first Task 3 implementation run exited `1` with `19/20` passed because one worker-authored oracle treated byte-identical but non-canonical recovered JSON as automatically resolved, contradicting its own canonical-exact test name and the approved fail-closed design. The manager corrected the oracle: non-canonical evidence remains unresolved until explicit repair; a separately canonical exact conflict proves the automatic-clear branch. Production strictness was not weakened.
- Task 3 replacement GREEN exited `0`: `autosave.test.ts` passed `20/20`. Ordinary dirty `timelines` and quarantined `timelineConflicts` now coexist, parse independently, and only canonical exact current bytes resolve evidence automatically.
- Combined Task 1–3 focused run passed `67/67`. The first Editor typecheck then exited `2` because `main.ts` still read removed flat conflict fields (`id/recoveredFile`). The approved fix is a minimal projection adaptation to consume `conflict.recovered` directly; no compatibility fields or duplicate truth were added.
- Replacement Editor typecheck after the minimal projection adaptation exited `0`.
- Task 1–3 correctness core was staged as exactly `8` paths with no scope delta and committed as `c551283` (`fix(editor): fail closed timeline autosave identity`). The commit contains the pure helper/test, autosave source/test, project-IO source/test, minimal main projection adaptation, and this taskbook; no UI, timeout, dependency, public protocol, protected file, or long-term ledger entered the commit.
- Task 4 delegated RED run exited `1` with `23/34` passing and `11` failures. Its first failure exposed a test-helper scope mistake, while later failures also proved the planned repair export was absent. The worker corrected only the helper without a second run. The manager then implemented prepare-before-apply repair, exact target revalidation, canonical normalization, collision rejection, one undo snapshot, and zero-mutation failures. The focused repair GREEN passed `34/34`; after adding conflict-bucket quarantine coverage, the combined run passed the expanded `36/36` Project IO suite.
- Task 5 delegated RED did not establish a valid product RED: an old-style NUL escape caused esbuild collection failure before any test ran. This invalid evidence remains recorded rather than being relabelled. After correcting only the test key and implementing the pure panel, the single panel GREEN passed `5/5`. The panel uses Chinese semantic DOM, collapsed technical details, explicit replace/save-as-new/download/discard actions, confirmations for destructive choices, and no colored selection bar.
- Task 6 sequencing deviation: the manager completed the narrow main wiring before creating the source-level integration contract, so no separately executed Task 6 RED exists. The new integration contract then passed `6/6` on its first run. It freezes structured pending conflict state, conflict-bucket quarantine, panel-before-workspace mounting, success-only removal, immediate persistence, failure retention, and non-mutating download.
- Task 4–6 combined focused verification passed `5/5` files and `91/91` tests. The first Editor typecheck then exited `2` because the delegated panel test helper typed `fileId` as `string | null`; production code was not implicated. The manager narrowed the test helper to the actual `string` contract, and the replacement Editor typecheck exited `0`.
- Guided repair UI was frozen as exact commit `fb56b460d82f6f72a87f218542edd3a1ddfbebb3` (`feat(editor): guide timeline backup conflict repair`), containing exactly the planned taskbook plus seven Editor source/test paths. No protected file, long-term ledger, artifact, dependency, timeout, or remote operation entered the commit.
- Final pre-review gates at `fb56b46` passed: focused `5/5` files and `91/91` tests; Editor full `55/55` files and `435/435` tests; Editor typecheck and build exited `0`; the sole root `verify:all` exited `0`. Existing Starter and Zero lint warnings remained warnings with zero errors, simulations reported zero runtime errors, and the aggregate ended at its own `git diff --check` with exit `0`.
- The bounded read-only secondary review then reported two concrete findings, both independently confirmed by the manager: (P1) `inspectTimelineAutosaveIdentity()` accepted unsafe/non-normalized paths because basename equality alone could mark `../id.json`, absolute paths, or a duplicated `content/timelines/` prefix canonical; (P2) the panel enabled Replace Current for a recorded target whose ID/file pair could not be normalized, producing an action that was guaranteed to fail. Scope review otherwise found no unauthorized path.
- Manager-correction RED ran the three affected suites once and exited `1`: `65/76` passed and `11` failed exactly across unsafe path/invalid stable-ID admission, automatic unsafe insertion, and misleading Replace availability. The minimal correction now validates stable IDs through `timelinePathFor`, requires a normalized safe timeline-root-relative file, rejects duplicated timeline-root prefixes, and derives Replace availability through the same normalization helper used by the repair operation. Replacement GREEN passed `3/3` files and `76/76` tests.
- Evidence boundary: the taskbook-authorized sole aggregate run was already consumed at `fb56b46` before manager review found P1/P2. It remains a valid pass for that commit but cannot be represented as a final-HEAD aggregate. No second `verify:all` will be run without a separate authorization; the manager correction must instead receive fresh affected Editor full tests, typecheck, build, diff checks, and exact commit review before local closure.
