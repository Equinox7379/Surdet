# Shell 失败数据可靠性 Wave 1 Implementation Plan

> **For agentic workers:** Read `E:\surdet\AGENTS.md`, this plan, the project roadmap ledger, and the latest Core data consistency report before touching code. Execute Task 0 → Task 5 in order. Stop at the first evidence or scope blocker and finish in `WAITING_FOR_REVIEW`.

**Goal:** Make save/load/delete/list failures travel through the public Host/Shell player path without becoming false success, while preserving the exact pre-operation UI/session state and allowing a later retry.

**Architecture:** Use the existing `@surdet/host` typed `SaveStorage` adapter and `PlayerShellController`/`PlayerUiSession` transaction boundary. Keep filesystem details in `@surdet/shell`; keep the Zero example as a consumer, not a second state machine. Every production change requires a focused red test that observes both the original error and the externally visible session/projection result.

**Tech Stack:** TypeScript, Vitest, Electron IPC, `@surdet/core` SaveStorage/SaveManager, `@surdet/host` PlayerShellController/PlayerUiSession, `@surdet/shell` FileSaveStore, and one focused Electron path only if the changed seam crosses the desktop boundary.

## Global Constraints

- This is roadmap Stage 2: Shell 失败数据可靠性. Do not begin Stage 3 backup/recovery, visual editor, audio production, performance qualification, release, M9, or document governance.
- Preserve the local Core Wave 1 commits. No reset, checkout, rebase, amend, squash, history rewrite, or push.
- At start, record real `HEAD`, `surdet/main`, ahead/behind count, and worktree. Do not trust stale values in this file.
- Re-read `E:\surdet\AGENTS.md` and the roadmap ledger. Never modify, stage, commit, delete, or move `AGENTS.md`, `SESSION-HANDOFF.md`, `USER.md`, `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`, `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`, or `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`.
- Do not modify BGM files, audio generation/normalization, performance artifacts/gates, rollback black-screen code, backup `.bak` recovery, editor, release packaging, or unrelated content.
- Do not add compatibility layers, migration logic, success fallbacks, retry queues, global error buses, new configuration layers, or a second UI/session state machine.
- Missing read slot is a normal `null`/empty-slot no-op. It must not throw merely to make a stricter test.
- Real storage errors must remain rejected/thrown with their original cause. Never turn them into `[]`, `null`, `true`, a closed page, a scene transition, or a success notice.
- On failure, preserve the pre-operation `PlayerUiSession` snapshot, shell projection, overlay, command-rail visibility, world/dialogue state, and retry capability. On success, complete/close exactly once.
- During pending async work, duplicate clicks are consumed without invoking the host twice. `false` or rejection keeps the view open and permits retry.
- Do not claim visual/audio success from an internal callback counter. Use visible/state evidence and at most one proportionate Electron path when required.
- No `npm run pack`, electron-builder, release, deployment, or push. Local commits are allowed only for this wave's allowlisted files.

## Allowlist and Boundaries

Only touch a file below when a red test proves the need:

- `packages/host/src/electron-save-storage.ts`
- `packages/host/src/player-shell-controller.ts`
- `packages/host/test/electron-save-storage.test.ts`
- `packages/host/test/player-shell-controller.test.ts`
- `packages/host/test/player-shell-slots.test.ts`
- `packages/host/test/renderer-player-shell-slots.test.ts`
- `packages/shell/src/save-store.ts`
- `packages/shell/src/main.ts`
- `packages/shell/src/preload.ts`
- `packages/shell/test/save-store.test.ts`
- `packages/shell/test/player-shell-data-reliability-e2e-contract.test.ts` (new only if needed)
- `packages/shell/e2e/player-shell-data-reliability.e2e.mjs` (new only if needed)
- `examples/zero-after-midnight/src/main.ts` and tests, only for a proven public wiring defect, never for a game-only workaround
- `docs/ENGINE-SHELL-DATA-RELIABILITY-WAVE-1-DELIVERY-REPORT-2026-08-13.md` (after evidence)
- this plan (ledger updates only)

## Task 0: Baseline and scope confirmation

**Purpose:** Establish fresh evidence without changing production code.

- [ ] Read `AGENTS.md`, roadmap ledger, and Core Wave 1 delivery report.
- [ ] Run `git rev-parse HEAD`, `git rev-parse surdet/main`, `git rev-list --left-right --count HEAD...surdet/main`, `git status --short`, `git diff --check`, and `git ls-files '*.log'`. Record exact outputs in this plan.
- [ ] Run the narrow baseline: `npm run test -w @surdet/host`; `npm run test -w @surdet/shell -- test/save-store.test.ts`; Host/Shell typecheck and build. Record test counts and exit codes.
- [ ] Read the existing adapter/controller/store tests and map coverage for bridge rejection identity, list/listMeta rejection, failed save/load rollback, empty-slot no-op, pending duplicate click, retry, and filesystem/index failure. Do not duplicate already-proven behavior.
- [ ] If a failure is unrelated (Editor CRLF/LF, audio, performance, or docs), record it and do not modify it. Stop if the planned seam cannot be assessed.

## Task 1: Add only missing red tests

**Purpose:** Prove a real gap before changing production code.

**Tests:** `packages/host/test/electron-save-storage.test.ts`, `packages/host/test/player-shell-controller.test.ts`, and `packages/shell/test/save-store.test.ts` only when Task 0 found an uncovered real filesystem/index failure.

- [ ] For every uncovered bridge method, preserve exact error identity. Use this shape: `const failure = new Error('list denied'); const bridge = { read: vi.fn(async () => null), write: vi.fn(async () => undefined), delete: vi.fn(async () => undefined), list: vi.fn(async () => { throw failure; }), listMeta: vi.fn(async () => { throw failure; }) }; const storage = createElectronSaveStorage(bridge); await expect(storage.list()).rejects.toBe(failure); await expect(storage.listMeta?.()).rejects.toBe(failure);` Do not make missing reads throw.
- [ ] For an uncovered save/load transaction, capture `before = controller.queries.snapshot()`, inject a rejected promise or synchronous throw, call the existing failure path, and assert snapshot equality, original error identity, one error report, unchanged provider projection, and a successful later retry.
- [ ] For an uncovered pending selection, call the same save/load callback twice before a deferred promise settles. Assert the host callback once, no close/rail restore while pending, exactly one close/restore after `resolve(true)`, and open/retry behavior after `resolve(false)` or rejection.
- [ ] If a nested projection compensation fails, assert the original error remains in `PlayerShellSlotError.cause` or `AggregateError.errors`; do not assert only a generic message.
- [ ] Run `npm run test -w @surdet/host -- electron-save-storage.test.ts player-shell-controller.test.ts` and, if applicable, `npm run test -w @surdet/shell -- test/save-store.test.ts`.
- [ ] Require at least one newly added test to fail against the current code. If all tests pass, record the invariant as already verified, make no speculative production change, and proceed as diagnosis-only.

## Task 2: Minimal public-layer implementation

**Purpose:** Fix only the confirmed red invariant at the correct engine boundary.

- [ ] Modify only the implicated production file among `packages/host/src/electron-save-storage.ts`, `packages/host/src/player-shell-controller.ts`, `packages/shell/src/save-store.ts`, `packages/shell/src/main.ts`, or `packages/shell/src/preload.ts`.
- [ ] Preserve these contracts: missing read → `null`; actual bridge/I/O/index failure → rejection/throw with original cause; failed operation → exact origin session/projection and idle operation; retry remains possible.
- [ ] Do not call `beginOperation()` twice, complete after rejection/throw/`false`, close before async success, or restore command rail before settlement.
- [ ] If `FileSaveStore` is implicated, keep absent file, malformed file, permission failure, and index failure distinct. Do not add backup recovery in this wave; corrupt main save must not silently become successful backup restoration.
- [ ] Re-run the exact red tests from Task 1. All must pass without weakening assertions or deleting failure evidence.
- [ ] If there is a production change, commit only the changed allowlisted implementation/tests after `git diff --check`, using `git commit -m "fix(host): preserve shell storage failures"`. If no gap was found, do not create a fake fix commit.

## Task 3: Real Zero consumer path

**Purpose:** Ensure the formal game consumes the public contract rather than hiding errors in game code.

- [ ] Prefer the existing `createElectronSaveStorage` bridge seam or a test double. Do not add a Zero-only fallback, second save manager, or local error state machine.
- [ ] Prove these invariants through the existing integration seam: title load-list failure leaves title usable and does not show fake empty success; game save failure leaves the view/origin and game state intact and retryable; game load failure leaves world/dialogue/session intact with no title transition; empty slot performs no host load, error, close, or story advance; quick save/load failure produces no success notice and leaves the command rail usable.
- [ ] If an invariant cannot be represented through the public interface, record the exact missing seam and stop instead of modifying the game to simulate it.
- [ ] Run `npm run test -w zero-after-midnight -- player-ui-integration.test.ts`. Do not add audio, visual, or content assertions.

## Task 4: Proportionate regression gate

**Purpose:** Validate the changed boundary without repeating unrelated release/performance protocols.

- [ ] Run `npm run test -w @surdet/host`; `npm run test -w @surdet/shell -- test/save-store.test.ts`; and the focused Zero integration test. Record exact counts.
- [ ] Run in dependency order: Host typecheck/build, Shell typecheck/build, Zero typecheck/build. Every affected command must exit `0`.
- [ ] If changed files require them, run `npm run verify:renderer-boundaries`, `npm run verify:renderer-legacy`, `npm run verify:hygiene`, `git diff --check`, and `git ls-files '*.log'`. Do not run performance qualification or a large Electron matrix.
- [ ] If the desktop bridge changed, perform one short manual/development Electron smoke only: open save/load, cause one controlled failure, verify the window remains usable, restore the bridge, retry, and verify no false success or scene advance. Do not package or release.
- [ ] If `npm run verify:all` is run, report its complete result honestly. Do not alter the known unrelated Editor CRLF/LF issue to obtain a green result.

## Task 5: Delivery report, ledger, and stop

**Create:** `docs/ENGINE-SHELL-DATA-RELIABILITY-WAVE-1-DELIVERY-REPORT-2026-08-13.md` only after Tasks 0–4 evidence is complete. Update this plan's execution ledger only; never touch the roadmap ledger.

- [ ] Report: roadmap stage; exact symptom/contract; public Host/Shell files changed; game files unchanged; red-to-green evidence; missing-slot semantics; real failure propagation; rollback/projection; pending click; retry; unproven/deferred items; exact commit SHAs; final HEAD/remote/worktree; explicit no push/deploy/package/release/performance/audio/editor/backup/M9.
- [ ] Re-read report metadata from disk with `Get-Item ... | Select-Object Length,FullName` and `Get-FileHash ... -Algorithm SHA256`; put actual values in the report/ledger.
- [ ] Run final `git status --short`, `git diff --check`, `git ls-files '*.log'`, `git rev-parse HEAD`, and `git rev-list --left-right --count HEAD...surdet/main`.
- [ ] Commit the report and plan only after all facts are present: `git add docs/ENGINE-SHELL-DATA-RELIABILITY-WAVE-1-DELIVERY-REPORT-2026-08-13.md docs/superpowers/plans/2026-08-13-shell-data-reliability-wave-1.md`; `git commit -m "docs(host): record shell data reliability wave"`.
- [ ] Stop at `WAITING_FOR_REVIEW`, `NOT_PUSHED`, `NOT_DEPLOYED`. Do not enter Stage 3, edit the visual editor, touch music, qualify performance, package, release, or push.

## Self-review checklist

- [x] One theme only: Shell failure-data reliability.
- [x] Missing-slot no-op is distinguished from real I/O/permission/index failure.
- [x] Production edits require a real red test; diagnosis-only completion is valid when no gap exists.
- [x] Reusable fixes stay in Host/Shell public seams; no Zero-only workaround.
- [x] Stage 3 backup recovery, audio, performance, editor, release, and document migration are excluded.
- [x] Exact paths, commands, expected outcomes, commit boundaries, and stop state are specified.
- [x] Protected files and the long-term roadmap ledger are excluded.

## Execution Ledger

### Task 0 — baseline and scope confirmation (completed)

- Task started after reading `E:\surdet\AGENTS.md`, the project roadmap/decision ledger, this plan, and the Core Wave 1 delivery report.
- Baseline command results from the clean starting tree:
  - `git rev-parse HEAD` → `99abc9abc1f42cb29e54c9871d9aad163a0f7d4a`.
  - `git rev-parse surdet/main` → `7c4a0059204e927061a67b2005da0036d056409e`.
  - `git rev-list --left-right --count HEAD...surdet/main` → `6 0`.
  - `git status --short` contained only the five protected untracked files, this Wave 1 plan, and the untracked long-term roadmap ledger. No tracked modifications were present.
  - `git diff --check` → exit `0`.
  - `git ls-files '*.log'` → empty.
- Baseline gates:
  - `npm run test -w @surdet/host` → exit `0`, 11 files / 87 tests.
  - `npm run test -w @surdet/shell -- test/save-store.test.ts` → exit `0`, 1 file / 19 tests.
  - `npm run typecheck -w @surdet/host` → exit `0`.
  - `npm run build -w @surdet/host` → exit `0`.
  - `npm run typecheck -w @surdet/shell` → exit `0`.
  - `npm run build -w @surdet/shell` → exit `0`; preload generated under ignored `packages/shell/dist`.
- Existing coverage map:
  - `electron-save-storage.test.ts` already proves missing `read()` returns `null` and exact rejection identity for read/write/delete/list/listMeta, plus failed-save session restoration and later retry.
  - `player-shell-controller.test.ts` already proves provider open/close rollback, save/load failure restoration, one error report, projection compensation, exact cause preservation, pending-operation rejection by the session, and retry after reset cleanup failure.
  - `player-shell-slots.test.ts` and `renderer-player-shell-slots.test.ts` already prove fixed six-slot registration, provider `this` binding, projection delegation, and save/load failure projection recovery.
  - `save-store.test.ts` already proves missing read `null`, malformed main-save rejection, write/delete/list/listMeta behavior, index-backed listing, legacy listing, and no silent `.bak` recovery. It did not yet have a direct corrupt-index/listMeta failure assertion.
  - The existing Zero integration test is a public wiring/static contract test; it does not expose a storage-failure injection seam. No game-layer workaround is authorized.
- No unrelated baseline failure was observed. No production file was changed in Task 0.

### Task 1 — missing red tests (completed)

- Added only the missing Shell storage evidence in `packages/shell/test/save-store.test.ts`:
  - corrupt `index.json` remains an index-read failure whose wrapper retains the original `SyntaxError` as `cause`;
  - a disappeared save directory remains a real `ENOENT` from `list()`, rather than becoming an empty list.
- The pre-fix focused run was a genuine red result:
  - `npm run test -w @surdet/shell -- test/save-store.test.ts` → exit `1`, 21 tests: `20 passed / 1 failed`.
  - The failing assertion showed `FileSaveStore.list()` returned no error after its directory was removed; this is the false-empty-list defect.
- Existing Host tests already covered exact bridge rejection identity, missing-read `null`, failed save/load rollback, projection recovery, and retry; existing Renderer menu tests already cover pending duplicate valid-slot clicks. No duplicate Host/Shell tests were added for those already-proven contracts.

### Task 2 — minimal public-layer implementation (completed)

- Changed only `packages/shell/src/save-store.ts`: removed the `!fs.existsSync(this.dir) -> []` short circuit from `list()`. `fs.readdirSync(this.dir)` now propagates the real filesystem error when the save directory disappears.
- No backup recovery, fallback, migration, retry queue, UI state machine, or other production layer was changed.
- The same focused Shell command after the fix → exit `0`, 1 file / `21/21` tests.
- Host focused regression command:
  - `npm run test -w @surdet/host -- electron-save-storage.test.ts player-shell-controller.test.ts` → exit `0`, 2 files / `21/21` tests.
- Task 2 local implementation commit:
  - `2da191cfee3fbec6a506831f49f2c70220c429a0`
  - `fix(host): preserve shell storage failures`

### Task 3 — real Zero consumer path (completed)

- Ran `npm run test -w zero-after-midnight -- player-ui-integration.test.ts` → exit `0`.
- The workspace script performed its existing simulation/assets precheck (`44` assets, `11` scenes, `3` endings) and then ran 5 files / `31/31` tests, including the requested `player-ui-integration.test.ts` (`2/2`).
- The public Zero test confirms shared Host controller, six-slot registry, Renderer theme, rollback/title wiring, and no game-local PlayerShell/InputGate state machine. It has no authorized storage-failure injection seam; no Zero source or game-specific fallback was added.
- Therefore the formal game consumer path remains unchanged and the proven Host/Shell public seam is retained. Actual Electron/UI failure injection remains outside this wave's test seam and is recorded as unproven rather than simulated in the game.

### Task 4 — proportionate regression gate (completed)

- Full/affected regression:
  - `npm run test -w @surdet/host` → exit `0`, 11 files / `87/87` tests.
  - `npm run test -w @surdet/shell -- test/save-store.test.ts` → exit `0`, 1 file / `21/21` tests.
  - `npm run test -w zero-after-midnight -- player-ui-integration.test.ts` → exit `0`, existing precheck plus 5 files / `31/31` tests.
- Dependency-order typecheck/build:
  - `npm run typecheck -w @surdet/host` → exit `0`.
  - `npm run build -w @surdet/host` → exit `0`.
  - `npm run typecheck -w @surdet/shell` → exit `0`.
  - `npm run build -w @surdet/shell` → exit `0`; sandbox preload generated under ignored `packages/shell/dist`.
  - `npm run typecheck -w zero-after-midnight` → exit `0`.
  - `npm run build -w zero-after-midnight` → exit `0` (Vite emitted only its existing chunk-size warning).
- `npm run verify:hygiene` → exit `0` (`644` tracked paths).
- Renderer boundary/legacy checks were not required because no Renderer file changed. No Electron smoke, `verify:all`, performance qualification, or large Electron matrix was run; no desktop bridge source (`main.ts`/`preload.ts`) changed.
- Final post-report checks after the first document closure commit were recorded as: `git status --short` containing only the five protected files and the untracked long-term roadmap ledger; `git diff --check` exit `0`; `git ls-files '*.log'` empty; `git rev-parse HEAD` `89cb61a1c6ea7f34c481e4bd29844fa25a9005cf`; and `git rev-list --left-right --count HEAD...surdet/main` `8 0`.

### Task 5 — delivery report and ledger (completed)

- Delivery report created at `E:\surdet\docs\ENGINE-SHELL-DATA-RELIABILITY-WAVE-1-DELIVERY-REPORT-2026-08-13.md`.
- Independent disk re-read before the final ledger append:
  - report bytes: `10754`;
  - report SHA-256: `476DB8F6126440E3F66FEDFB77B74A88FCBF870EB210C4344FB8BA1E097CD2A2`.
- Plan metadata before this Task 5 ledger append was `19461` bytes / `E258EBCC676F977D5B6FA6C72C99260BB25543F82B8A23523FE0FB9F59C14DA4`; after the first document closure commit it was independently re-read as `20199` bytes / `12BACD13F87C5ECF87ACF7060CA5FD415A106AD1D9497B8FD1EBEC7375733EFA`.
- The first document closure commit was:
  - `89cb61a1c6ea7f34c481e4bd29844fa25a9005cf`
  - `docs(host): record shell data reliability wave`
- Only the delivery report and this Wave 1 plan were staged in that document commit. The roadmap ledger and protected files remain untracked and untouched.
- The final ledger wording correction is this plan-only normal commit; its real SHA and resulting final HEAD are recorded by the final read-only handoff. No source file, report content, roadmap ledger, or protected file is changed by that correction.
