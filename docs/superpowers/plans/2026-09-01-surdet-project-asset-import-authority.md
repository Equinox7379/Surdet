# Surdet Project Asset Import Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven development for bounded low-risk tasks or execute this plan task-by-task inline. Steps use checkbox (`- [ ]`) syntax for tracking. The primary agent owns architecture, mutation code, integration, Git commits, and final sign-off; Luna workers may implement isolated planner/UI tests or perform read-only reviews.

**Goal:** Turn the read-only Asset Center into a Chinese, new-file-only import workbench backed by a recoverable local Node authority, immutable receipts, and conservative undo.

**Architecture:** `@surdet/authoring` owns deterministic import planning. A separate CLI-side asset-import authority owns binding, byte staging, new-file publication, recovery, and undo; it is exposed only by an explicitly bound Editor launcher. The Editor remains a human-facing client and refreshes the existing shared asset intelligence after successful mutations.

**Tech Stack:** TypeScript, Node.js filesystem/streams/crypto, Vite 6 plugin API, Vitest, existing Editor DOM architecture, existing `NodeLocalLeaseManager` lease behavior, isolated Playwright browser flow.

## Global Constraints

- Design authority: `docs/superpowers/specs/2026-09-01-surdet-project-asset-import-authority-design.md`.
- Only publish new files under `content/assets`; never overwrite, replace, rename, or delete an existing user asset.
- Do not write `public/`, scene/timeline/config references, gallery metadata, Agent changes, or review workspaces.
- `ProjectAssetKind` remains the existing Authoring machine vocabulary; ordinary Editor copy is Chinese.
- Runtime, project revision, Asset Center inventory, validation, and packaging must ignore the exact internal tree `.surdet/asset-import`, not all `.surdet` content.
- Ordinary `npm run dev -w surdet-editor` remains unbound and read-only. `dev:project` binds only `127.0.0.1`, uses strict port ownership, defaults to 5174, and keeps 4173/4175 forbidden.
- Tests use disposable projects and explicit temporary data roots only. Never point a write path at this repository, Starter, a previous acceptance fixture, or a user's active game project.
- No new runtime dependency unless an existing API demonstrably cannot satisfy the task.
- No Agent Port capability, MCP route, review-authority route, deployment, release, or push in this plan.
- Validation is proportional: one focused RED→GREEN cycle per task, affected workspace typecheck/build, one isolated browser flow, and one final `verify:all` because three workspaces change.
- This plan does not add a separate FORMAL/CODE_EVIDENCE artifact protocol; the committed code, focused tests, isolated browser behavior, final aggregate check, Git diff, and append-only task ledger are the completion evidence required by the current project rules.
- Preserve all unrelated tracked and untracked files. Stage exact paths only; never use `git add .` or `git add -A`.

---

## File Map

### Authoring

- Create `packages/authoring/src/asset-import.ts`: pure filename/category/collision planner and canonical plan fingerprint.
- Modify `packages/authoring/src/index.ts`: export the new module.
- Create `packages/authoring/test/asset-import.test.ts`: deterministic planner contract.

### CLI authority

- Create `packages/cli/src/asset-import-authority/types.ts`: internal journal, identity, receipt, and HTTP types not suitable for public Authoring contracts.
- Create `packages/cli/src/asset-import-authority/filesystem.ts`: data-root/project identity, safe relative paths, staged/prepared/final/quarantine operations, hashing.
- Create `packages/cli/src/asset-import-authority/record-store.ts`: create-only registrations, versioned journals, receipts, barriers, and restart discovery.
- Create `packages/cli/src/asset-import-authority/project-lease.ts`: lifetime authority lease adapter around `NodeLocalLeaseManager` using the dedicated data root.
- Create `packages/cli/src/asset-import-authority/binding.ts`: challenge registration, probe lifecycle, root-handle proof.
- Create `packages/cli/src/asset-import-authority/authority.ts`: operation orchestration, upload, plan, seal, commit, rollback, recovery, undo.
- Create `packages/cli/src/asset-import-authority/http-handler.ts`: exact same-origin protocol and bounded request parsing.
- Create `packages/cli/src/asset-import-authority/vite-plugin.ts`: conditional Vite configuration injection and routes.
- Create `packages/cli/test/asset-import-authority-storage.test.ts`: filesystem, persistence, lease, and recovery tests.
- Create `packages/cli/test/asset-import-authority.test.ts`: operation lifecycle tests.
- Create `packages/cli/test/asset-import-authority-http.test.ts`: origin/token/schema/upload/idempotency tests.

### Shared project enumeration

- Modify `packages/cli/src/authoring/node-project-storage.ts`: exclude exact `.surdet/asset-import` from `listFiles()`.
- Modify `packages/cli/test/node-project-storage.test.ts`: permanent exact-exclusion regression.

### Editor and launcher

- Create `packages/editor/scripts/dev-project.mjs`: parse explicit project/data-root/port and start strict loopback Vite.
- Modify `packages/editor/package.json`: add `dev:project`.
- Modify `packages/editor/vite.config.ts`: install the asset-import plugin without binding ordinary dev.
- Create `packages/editor/src/asset-import-client.ts`: typed authority client and safe Chinese error mapping.
- Create `packages/editor/src/asset-import-workspace.ts`: browser draft and durable authority workspace state.
- Create `packages/editor/src/panels/asset-import-workbench.ts`: in-place three-row import UI.
- Create `packages/editor/src/styles/asset-import.css`: layout and responsive rules.
- Modify `packages/editor/index.html`: load the new stylesheet after `asset-center.css`.
- Modify `packages/editor/src/state.ts`: hold import workspace state.
- Modify `packages/editor/src/project-io.ts`: expose a focused asset-intelligence refresh that preserves editing state.
- Modify `packages/editor/src/main.ts`: wire import actions, project close cleanup, and refresh.
- Modify `packages/editor/src/panels/asset-center.ts`: stable `导入素材` entry and workspace mount.
- Create `packages/editor/test/dev-project-launcher.test.mjs`.
- Create `packages/editor/test/asset-import-client.test.ts`.
- Create `packages/editor/test/asset-import-workbench.test.ts`.
- Modify `packages/editor/test/editor-asset-center-contract.test.ts`.

### Browser flow

- Create `packages/editor/e2e/asset-import-authority.e2e.mjs`: one isolated end-to-end flow.
- Create `packages/editor/test/asset-import-authority-runner.test.mjs`: permanent runner contract.

## Task Dependency Graph

```text
Task 1 ───────────────────────────────┐
Task 2 -> Task 3                     │
Task 2 -> Task 4 -> Task 5 -> Task 6├-> Task 7 -> Task 9 -> Task 10 -> Task 11
Task 2 -> Task 8 --------------------┘
```

Tasks 2 through 7 modify one authority contract and must run sequentially. They must never be dispatched to parallel workers. Task 1 may run independently before Task 4 consumes its export. Task 8 may be reviewed independently but must be merged before Task 9. The primary agent owns Tasks 2–7 and integration; Luna workers may own only Task 1, Task 10's isolated presentation layer, or read-only review when given exact non-overlapping files.

---

### Task 1: Pure Authoring import planner

**Files:**
- Create: `packages/authoring/src/asset-import.ts`
- Modify: `packages/authoring/src/index.ts`
- Test: `packages/authoring/test/asset-import.test.ts`

**Interfaces:**
- Consumes: existing `ProjectAssetKind` from `packages/authoring/src/contracts.ts`.
- Produces:

```ts
export interface ProjectAssetImportStagedItem {
  operationId: string;
  itemId: string;
  sourceName: string;
  bytes: number;
  sha256: string;
  stagedItemFingerprint: string;
}

export interface BuildProjectAssetImportPlanInput {
  projectIdentity: string;
  stagedItems: ProjectAssetImportStagedItem[];
  targets: Array<{ itemId: string; kind: ProjectAssetKind; fileName: string }>;
  targetFacts: Array<{ path: string; state: 'absent' | 'exists-file' | 'exists-directory' | 'unsafe' }>;
}

export function buildProjectAssetImportPlan(
  input: BuildProjectAssetImportPlanInput,
  hasher: TextHasher,
): Promise<ProjectAssetImportPlan>;
export function destinationDirectoryForAssetKind(kind: ProjectAssetKind): string;
```

- [ ] **Step 1: Write the permanent failing planner tests**

Cover all ten category directories, NFC normalization, Chinese names, `CON`/`COM1`/`LPT¹`, separators, trailing dot/space, case-fold duplicates, duplicate target facts, portrait `角色_服装_表情.ext`, unsupported extensions, deterministic ordering, and stable fingerprint. Assert no automatic suffix or overwrite path exists.

- [ ] **Step 2: Run the focused RED**

Run: `npm test -w @surdet/authoring -- asset-import.test.ts`

Expected: fail because `asset-import.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal pure planner**

Use an immutable directory map, exact portable name validation, canonical JSON ordering, and the existing injected `TextHasher` pattern used by candidate comparison. Do not import Node crypto or add a dependency to Authoring.

- [ ] **Step 4: Run GREEN and workspace checks**

Run:

```text
npm test -w @surdet/authoring -- asset-import.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
```

Expected: focused tests, typecheck, and build pass.

- [ ] **Step 5: Commit exact files**

Commit: `feat(authoring): plan project asset imports`

---

### Task 2: Persistent identity, records, and lifetime lease

**Files:**
- Create: `packages/cli/src/asset-import-authority/types.ts`
- Create: `packages/cli/src/asset-import-authority/filesystem.ts`
- Create: `packages/cli/src/asset-import-authority/record-store.ts`
- Create: `packages/cli/src/asset-import-authority/project-lease.ts`
- Test: `packages/cli/test/asset-import-authority-storage.test.ts`

**Interfaces:**

```ts
export interface AssetImportAuthorityPaths {
  dataRoot: string;
  projectRoot: string;
  projectIdentity: string;
  projectNamespace: string;
  internalWorkspace: string;
}

export async function openAssetImportAuthorityPaths(options: {
  projectRoot: string;
  dataRoot?: string;
}): Promise<AssetImportAuthorityPaths>;

export class AssetImportRecordStore {
  registerOperation(record: OperationRegistration): Promise<void>;
  readOperation(operationId: string): Promise<AssetImportJournal>;
  writeJournal(previous: AssetImportJournal, next: AssetImportJournal): Promise<void>;
  listOperations(): Promise<AssetImportJournal[]>;
  writeBarrier(incident: RecoveryBarrierIncident): Promise<void>;
  resolveBarrier(resolution: RecoveryBarrierResolution): Promise<void>;
}

export interface AssetImportProjectLease {
  ownerToken: string;
  release(): Promise<void>;
}
```

- [ ] **Step 1: Write storage RED tests**

Prove stable default/explicit data-root resolution, absolute/canonical project root, replacement detection, no symlink/junction segments, create-only records, version/hash-chain rejection, restart discovery, recovery barrier behavior, lease owner protection, and ambiguous stale lease failure. Test with injected temporary roots and small records only.

- [ ] **Step 2: Run RED**

Run: `npm test -w @surdet/cli -- asset-import-authority-storage.test.ts`

Expected: module-not-found or missing exported contracts.

- [ ] **Step 3: Implement focused persistence**

Instantiate `NodeLocalLeaseManager` with the dedicated asset-import data root and acquire one `project` lease by passing the canonical absolute project root, not the public project hash, for the service lifetime. The lease coordinates authority instances sharing that persistent data root; Agent Port writers remain external and are covered by exclusive target creation plus parent/target revalidation. Keep challenge/operation mutual exclusion in keyed in-process promise queues only after the lifetime lease is held. Add a two-process contention test proving a second authority using the same project/data root fails before serving requests. Use `lstat({ bigint: true })`, native `realpath`, exclusive temporary siblings, file sync, rename, and parent sync where supported. Do not reuse Agent data directories or change IDs.

- [ ] **Step 4: Run GREEN**

Run:

```text
npm test -w @surdet/cli -- asset-import-authority-storage.test.ts
npm run typecheck -w @surdet/cli
```

Expected: focused storage tests and CLI typecheck pass.

- [ ] **Step 5: Commit exact files**

Commit: `feat(cli): persist project asset imports`

---

### Task 3: Project binding challenge

**Files:**
- Create: `packages/cli/src/asset-import-authority/binding.ts`
- Modify: `packages/cli/src/asset-import-authority/types.ts`
- Modify: `packages/cli/src/asset-import-authority/record-store.ts`
- Test: `packages/cli/test/asset-import-authority-storage.test.ts`

**Interfaces:**

```ts
export class AssetImportBindingService {
  createChallenge(browserSessionId: string): Promise<CreateBindingChallengeResponse>;
  confirmChallenge(challengeId: string, request: ConfirmBindingChallengeRequest): Promise<ConfirmBindingChallengeResponse>;
  revoke(browserSessionId: string): void;
}
```

- [ ] **Step 1: Add failing challenge tests**

Test registration before probe creation, exact deterministic probe recovery after a crash, wrong directory handle nonce, expiry, successful cleanup, cleanup failure barrier, no wildcard deletion, and byte-identical project inventory before/after success.

- [ ] **Step 2: Run RED**

Run: `npm test -w @surdet/cli -- asset-import-authority-storage.test.ts`

Expected: new challenge cases fail.

- [ ] **Step 3: Implement binding**

Write `PROBE_CREATE_INTENT` before exclusive root probe creation. Return only the relative probe path. Bind tokens to server session, browser session, and project identity; use 30-minute idle and 8-hour maximum expiration. Never include absolute paths or tokens in persistent records.

- [ ] **Step 4: Run GREEN and commit**

Run the focused storage test and CLI typecheck. Commit: `feat(cli): bind asset imports to project roots`.

---

### Task 4: Upload, plan, and seal operations

**Files:**
- Create: `packages/cli/src/asset-import-authority/authority.ts`
- Modify: `packages/cli/src/asset-import-authority/filesystem.ts`
- Modify: `packages/cli/src/asset-import-authority/project-lease.ts`
- Modify: `packages/cli/src/asset-import-authority/record-store.ts`
- Modify: `packages/cli/src/asset-import-authority/types.ts`
- Test: `packages/cli/test/asset-import-authority-storage.test.ts`
- Test: `packages/cli/test/asset-import-authority.test.ts`

**Interfaces:**

```ts
export class ProjectAssetImportAuthority {
  createOperation(request: CreateImportOperationRequest): Promise<CreateImportOperationResponse>;
  uploadItem(operationId: string, itemId: string, body: NodeJS.ReadableStream): Promise<ProjectAssetImportStagedItem>;
  plan(operationId: string, request: PlanOperationRequest): Promise<PlanOperationResponse>;
  seal(operationId: string, request: SealOperationRequest): Promise<SealOperationResponse>;
  query(operationId: string): Promise<OperationDetailResponse>;
  list(): Promise<ListOperationsResponse>;
}
```

- [ ] **Step 1: Write lifecycle RED tests**

Cover create-only UUID operations, exact manifests, measured streaming length/hash, optional `Content-Length`, short/long body, stalled/oversized stream cancellation, byte-equal retry, conflicting retry, operation mutex, quota injection, blocked plan, ready plan, seal idempotency, restart query, and cancel before publication.

- [ ] **Step 2: Run RED**

Run: `npm test -w @surdet/cli -- asset-import-authority.test.ts`

- [ ] **Step 3: Implement minimal upload/planning path**

Stream directly to exclusive staging files with backpressure and incremental hash. Build planner facts exclusively from measured bytes. Revalidate target facts immediately before plan/seal. Keep JSON and size limits constructor-injectable for tests but fixed to the spec defaults in production.
Require an injected lifetime-lease guard and revalidate its real on-disk ownership before every public authority request. Persist upload intents before partial-file creation, verify operation/data namespace segments as real directories, and fail closed behind a durable recovery barrier when a record, staged binary, or internal path cannot be reconciled.

- [ ] **Step 4: Run GREEN and commit**

Run the focused test and CLI typecheck. Commit: `feat(cli): stage project asset imports`.

---

### Task 5: New-file commit, rollback, and restart recovery

**Files:**
- Modify: `packages/cli/src/asset-import-authority/authority.ts`
- Modify: `packages/cli/src/asset-import-authority/filesystem.ts`
- Modify: `packages/cli/src/asset-import-authority/record-store.ts`
- Test: `packages/cli/test/asset-import-authority.test.ts`

**Interfaces:**

```ts
commit(operationId: string, request: CommitOperationRequest): Promise<CommitOperationResponse>;
recover(operationId: string, request: RecoverOperationRequest): Promise<RecoverOperationResponse>;
```

- [ ] **Step 1: Add commit/recovery RED tests**

Prove hard-link capability before mutation, target absence, no overwrite race, prepared-file identity, per-item link/verify journal states, final full-batch rescan, immutable receipt, changed-parent failure, partial rollback through quarantine rename, crash recovery at every named fault point, manual recovery on ambiguity, and idempotent repeated commit/recover.

- [ ] **Step 2: Run RED**

Run: `npm test -w @surdet/cli -- asset-import-authority.test.ts`

- [ ] **Step 3: Implement commit and recovery**

Publish only through hard links from same-filesystem prepared files. Journal every intent before mutation. On failure, rename the current final path into the exact private quarantine path before inspecting it; never check then unlink a pathname. For uncertain state, write and sync `RECOVERY_REQUIRED`, set the process recovery flag, create and sync the exact `recovery-barriers/<barrier-id>.json`, and only then return the failure. While the flag is set or any unresolved barrier exists, reject create/plan/commit/undo. Startup scans indexed journals and recreates a missing barrier before serving any route.

- [ ] **Step 4: Run GREEN and commit**

Run focused CLI authority tests and typecheck. Commit: `feat(cli): commit recoverable asset imports`.

---

### Task 6: Immutable receipt undo

**Files:**
- Modify: `packages/cli/src/asset-import-authority/authority.ts`
- Modify: `packages/cli/src/asset-import-authority/filesystem.ts`
- Modify: `packages/cli/src/asset-import-authority/record-store.ts`
- Test: `packages/cli/test/asset-import-authority.test.ts`

- [ ] **Step 1: Add undo RED tests**

Cover unchanged success, any changed/missing/replaced file blocking the entire undo before mutation, exact identity/hash checks, rename-to-undo-quarantine, interrupted undo recovery, immutable undo receipt, retained quarantine, and second undo idempotency.

- [ ] **Step 2: Run RED**

Run the focused authority test.

- [ ] **Step 3: Implement conservative undo**

Require receipt ID and receipt hash. Preflight the full batch, then journal `UNDO_RENAME_INTENT`, rename each final path to its unique quarantine path, verify, write the undo receipt, and mark `UNDONE`. Never purge quarantine in this phase.

- [ ] **Step 4: Run GREEN and commit**

Run focused CLI tests and typecheck. Commit: `feat(cli): undo unchanged asset imports`.

---

### Task 7: Exact HTTP boundary and bound Editor launcher

**Files:**
- Create: `packages/cli/src/asset-import-authority/http-handler.ts`
- Create: `packages/cli/src/asset-import-authority/vite-plugin.ts`
- Create: `packages/editor/scripts/dev-project.mjs`
- Modify: `packages/editor/package.json`
- Modify: `packages/editor/vite.config.ts`
- Test: `packages/cli/test/asset-import-authority-http.test.ts`
- Test: `packages/editor/test/dev-project-launcher.test.mjs`

- [ ] **Step 1: Write HTTP/launcher RED tests**

Assert loopback-only, exact same Origin on every POST/PUT, no CORS/OPTIONS, three separate headers, token rotation, closed JSON schemas, safe error envelope, no path/token disclosure, upload limits, idempotent terminal responses, strict 5174 ownership, 4173/4175 rejection, explicit project/data root, and ordinary dev remaining unbound.

- [ ] **Step 2: Run RED**

Run:

```text
npm test -w @surdet/cli -- asset-import-authority-http.test.ts
npm test -w surdet-editor -- dev-project-launcher.test.mjs
```

- [ ] **Step 3: Implement HTTP and launcher**

Use the exact routes and envelope types from the design. The Vite plugin receives explicit options; it injects configuration only when both canonical project root and data root are present. `dev-project.mjs` parses arguments without shell interpolation and starts Vite programmatically with `host: '127.0.0.1'`, `strictPort: true`.

- [ ] **Step 4: Run GREEN, typecheck/build, and commit**

Run focused tests plus CLI and Editor typecheck/build. Commit: `feat(editor): launch bound asset import authority`.

---

### Task 8: Exact internal-workspace exclusion and focused refresh

**Files:**
- Modify: `packages/cli/src/authoring/node-project-storage.ts`
- Modify: `packages/cli/test/node-project-storage.test.ts`
- Modify: `packages/editor/src/project-io.ts`
- Test: `packages/editor/test/project-io.test.ts`

**Interfaces:**

```ts
export function isAssetImportInternalPath(relativePath: string): boolean;
export async function refreshProjectAssetIntelligence(): Promise<void>;
```

- [ ] **Step 1: Write exact exclusion and refresh RED tests**

Assert `.surdet/asset-import/**` is absent from `listFiles()`, while `.surdet/other.json` remains visible. Prove the same sentinel is absent from project snapshot/revision, Authoring inspection/validation, and asset-fact consumers that call `listFiles()`. In the isolated final fixture, build once with an internal sentinel and assert it is absent from `dist`; do not change packaging code unless that proof fails. Assert a focused asset refresh updates `state.dirAssets` and `state.assetIntelligence` without clearing scenes, timeline selection, dirty flags, review workspace, or current tab.

- [ ] **Step 2: Run RED**

Run the two focused test files.

- [ ] **Step 3: Implement the shared exact predicate and refresh**

Use normalized project-relative slash paths. Do not broaden the existing `.surdet-*` rule. Refactor only the minimum project-load code needed to expose refresh.

- [ ] **Step 4: Run GREEN and commit**

Commit: `fix(authoring): hide asset import workspace`.

---

### Task 9: Editor client and durable workspace projection

**Files:**
- Create: `packages/editor/src/asset-import-client.ts`
- Create: `packages/editor/src/asset-import-workspace.ts`
- Modify: `packages/editor/src/state.ts`
- Modify: `packages/editor/src/main.ts`
- Test: `packages/editor/test/asset-import-client.test.ts`

- [ ] **Step 1: Write client/workspace RED tests**

Cover unavailable/unbound/mismatch/recovery/ready priority, exact headers and envelopes, challenge file read through the existing directory handle, token non-persistence, upload progress, and object URL cleanup. The reload test must discard every in-memory token, reacquire the project directory handle, run a fresh challenge/confirm, then query/resume the incomplete operation or reopen the committed receipt; reusing the old token is forbidden.

- [ ] **Step 2: Run RED**

Run: `npm test -w surdet-editor -- asset-import-client.test.ts`

- [ ] **Step 3: Implement client and workspace state**

Keep machine values in typed data and map all ordinary messages/actions to Chinese. Do not store tokens in Local Storage or IndexedDB. Keep selected browser `File` objects only in the current page draft.

- [ ] **Step 4: Run GREEN and commit**

Run focused Editor tests and typecheck. Commit: `feat(editor): manage project asset imports`.

---

### Task 10: Chinese in-place import workbench

**Files:**
- Create: `packages/editor/src/panels/asset-import-workbench.ts`
- Create: `packages/editor/src/styles/asset-import.css`
- Modify: `packages/editor/src/panels/asset-center.ts`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/index.html`
- Create: `packages/editor/test/asset-import-workbench.test.ts`
- Modify: `packages/editor/test/editor-asset-center-contract.test.ts`

- [ ] **Step 1: Write UI RED tests**

Assert stable header action `导入素材`, no floating/sticky overlay, three-row grid, independently scrolling file region, all ten Chinese category labels, no overwrite action, editable safe final names, destination preview, receipt result, conservative undo copy, list/listitem semantics, field error association, polite live region, keyboard operation, and 1440/1024/800 CSS contracts.

- [ ] **Step 2: Run RED**

Run:

```text
npm test -w surdet-editor -- asset-import-workbench.test.ts editor-asset-center-contract.test.ts
```

- [ ] **Step 3: Implement the workbench**

Mount the workbench inside the existing Asset Center shell. Preserve the existing editorial tokens; add no gradient, glass panel, colored selection rail, decorative metric cards, or English primary copy. A successful commit invokes `refreshProjectAssetIntelligence()` and selects the imported item without reopening the project.

- [ ] **Step 4: Run GREEN, Editor typecheck/build, and commit**

Commit: `feat(editor): import project assets`

---

### Task 11: Isolated browser flow and final verification

**Files:**
- Create: `packages/editor/e2e/asset-import-authority.e2e.mjs`
- Create: `packages/editor/test/asset-import-authority-runner.test.mjs`
- Modify: this taskbook's Execution Ledger only after each result is known.

- [ ] **Step 1: Write runner contract RED**

Require a new temporary project and data root, strict non-forbidden port, wrong-directory rejection, successful binding cleanup, multi-file import, collision blocking, modified-file undo block, unchanged undo success, retained quarantine, zero repository/Starter mutation, and child-process cleanup. Receipt reload is a named milestone: reload the page, prove old tokens are absent, reopen the fixture directory, perform a new challenge/confirm, then query and display the original committed receipt.

- [ ] **Step 2: Run runner contract RED then GREEN**

Run: `npm test -w surdet-editor -- asset-import-authority-runner.test.mjs`

- [ ] **Step 3: Run one isolated browser flow**

Run: `node packages/editor/e2e/asset-import-authority.e2e.mjs`

Expected: the complete new-file import and undo path passes in the generated fixture; no real project is touched.

- [ ] **Step 4: Run final affected checks once**

Run:

```text
npm test -w @surdet/authoring -- asset-import.test.ts
npm test -w @surdet/cli -- asset-import-authority-storage.test.ts asset-import-authority.test.ts asset-import-authority-http.test.ts node-project-storage.test.ts
npm test -w surdet-editor -- dev-project-launcher.test.mjs asset-import-client.test.ts asset-import-workbench.test.ts editor-asset-center-contract.test.ts project-io.test.ts asset-import-authority-runner.test.mjs
npm run typecheck -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run typecheck -w surdet-editor
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
npm run build -w surdet-editor
npm run verify:all
```

Do not repeat a failed aggregate command simply to seek a green result. Diagnose the first functional failure and stop if it cannot be fixed within the current feature scope.

- [ ] **Step 5: Independent review and exact final commit**

Have a Luna worker perform read-only review for data-loss, overwrite, path escape, token leakage, stale receipt, and UI regression. The primary agent resolves any BLOCKER/HIGH, verifies the exact diff, then creates one exact final commit containing every post-check test or taskbook change; if that path set is empty, record `FINAL_CLOSURE_COMMIT = NOT_REQUIRED`. Do not push.

---

## Execution Ledger

### 2026-09-01 — Planning baseline

**Confirmed facts**

- Design commit: `e618fed` (`docs(editor): design project asset import authority`).
- Baseline before implementation: tracked worktree and staging were clean; `surdet/main` matched the previous HEAD.
- The design was reviewed by the primary agent and three Luna workers. Final design review had no unresolved BLOCKER or HIGH after corrections.
- The implementation taskbook passed primary self-review plus separate data-boundary and Editor/browser reviews. Accepted corrections include canonical-root lease keys, persisted recovery barriers, explicit task dependencies, downstream internal-tree checks, and reload re-binding.
- A suggested separate FORMAL/CODE_EVIDENCE regime was not adopted because the current project rules require proportional verification rather than a second evidence framework.
- Current implementation status: not started.

**Authorized boundary**

- The owner authorized direct taskbook creation and implementation after self-review.
- Local focused commits are allowed as implementation checkpoints.
- Push, deployment, release, real-project writes, Agent Port exposure, and Wave 7 are not authorized.

**Next action**

- Execute Task 1 with a focused RED→GREEN cycle.

### 2026-09-01 — Task 2 persistence foundation

**Confirmed facts**

- Focused RED failed because the four authority foundation modules did not exist.
- Focused GREEN: `asset-import-authority-storage.test.ts` passed 6/6.
- CLI typecheck passed.
- Commit: `fcbf99d` (`feat(cli): persist project asset imports`).
- The implementation uses a dedicated asset-import data root, stable project identity, create-only operation registrations and barriers, restart journal discovery, and a lifetime lease keyed by canonical project root.

**Boundary**

- Binding, upload, commit, recovery, undo, HTTP, launcher, Editor UI, and browser flow are not implemented yet.

### 2026-09-01 — Task 3 project binding

**Confirmed facts**

- Binding-focused RED failed because `binding.ts` did not exist.
- Focused GREEN: storage/binding suite passed 9/9; CLI typecheck passed.
- Commit: `ef43c02` (`feat(cli): bind asset imports to project roots`).
- The implementation registers the challenge before the root probe, validates the exact nonce/session/project, removes only the registered probe, keeps tokens memory-only, and recovers only expired registered probes.

**Boundary**

- The HTTP route and browser directory-handle client are not connected yet.

### 2026-09-01 — Task 1 pure Authoring planner

**Confirmed facts**

- Focused RED failed because `asset-import.ts` did not exist.
- Focused GREEN: `asset-import.test.ts` passed 4/4.
- Authoring typecheck and build passed.
- The primary agent reviewed the implementation after the Luna worker completed it.
- The planner covers the ten canonical category directories, NFC names, deterministic ordering and identity, portable collision checks, existing/ambiguous targets, strict portrait naming, and supported-format blocking without inventing suffixes or overwrite paths.

**Boundary**

- The planner is pure and does not read, stage, publish, undo, or delete project files.
- The Task 1 code commit is created separately from this append-only ledger entry.

**Commits**

- `8618614` — `feat(authoring): plan project asset imports`
- `b79ab6e` — `fix(authoring): bind import plans to manifests`
- `5d91b38` — `fix(authoring): require complete import targets`

### 2026-09-01 — Task 4 upload, plan, and seal authority

**Confirmed facts**

- Focused RED failed because `authority.ts` did not exist.
- Final focused GREEN: Task 4 lifecycle plus storage/lease suites passed 19/19; CLI typecheck passed.
- Commit: `87424a0` (`feat(cli): stage project asset imports`).
- Upload streams are measured and hashed by the authority, use persisted upload intents and exclusive staging paths, and permit only byte-identical retry.
- Every plan binds the immutable manifest, complete staged-item set, measured target facts, and deterministic planner result. Seal revalidates both stored semantic integrity and current target absence.
- Operation records, staged binaries, plan records, authority namespace segments, and the real on-disk lifetime lease fail closed. Unreconciled state creates a durable recovery barrier and also blocks the current process if that barrier itself cannot be persisted.
- Cancellation deletes only reconciled authority-owned paths; unknown staging entries are preserved and turn cancellation into recovery instead of optimistic success.
- A Luna worker performed three bounded read-only reviews. All reported BLOCKER/HIGH findings were corrected; the final review result was PASS.

**Boundary**

- Publication, rollback, restart recovery execution, receipts, undo, HTTP routes, launcher wiring, Editor UI, and browser acceptance remain unimplemented.
- No project asset was published, no real project was opened for writing, and no push was performed.

### 2026-09-01 — Task 8 internal-tree exclusion, CLI portion

**Confirmed facts**

- Focused RED exposed `.surdet/asset-import/**` through `NodeProjectStorage.listFiles()` and downstream asset facts.
- Focused GREEN: `node-project-asset-facts.test.ts` plus `node-project-storage.test.ts` passed 13/13.
- Commit: `c711dc7` (`fix(authoring): hide asset import workspace`).
- Only the exact `.surdet/asset-import` directory is newly excluded. Existing `.surdet-*` filtering remains unchanged, while `.surdet/other.json` stays visible.

**Boundary**

- The Editor state-preserving asset refresh half of Task 8 is still pending and will be implemented with Task 9 client integration.

### 2026-09-01 — Task 5 recoverable new-file publication

**Confirmed facts**

- Commit: `c8948b0` (`feat(cli): commit recoverable asset imports`).
- Final focused authority/storage GREEN: 30/30; CLI typecheck passed.
- Commit performs a fresh sealed-plan revalidation before `PUBLISHING`, journals every project-internal and canonical parent creation, copies stage bytes to same-filesystem prepared files, proves hard-link capability before canonical category mutation, and publishes only through create-failing hard links.
- Per-file publication generations cover prepare, link, verify, rollback rename intent, and retained rollback quarantine. The current publication generation has its own canonical SHA-256 and an exact target/internal-parent allowlist.
- Final success requires a full-batch identity/hash rescan and one create-only self-hashed receipt. A receipt written before a crash can only resume to `COMMITTED`; a later rollback request is rejected.
- Recovery tests cover a final link created before its journal update, both rollback rename crash windows, receipt creation before the committed journal, late external same-inode mutation, external target races, unowned prepared evidence, and an externally created parent in the mkdir window.
- Rollback never unlinks a visible target after a separate check. It first renames the exact owned inode into the private rollback quarantine and retains the bytes. Ambiguous or externally changed state creates a durable recovery barrier.
- Barrier resolution binds the incident file hash, terminal journal generation, publication generation/hash, and retained quarantine path set. Unknown parent paths and changed receipt bytes fail closed.
- A Luna safety review found two final high-risk issues (receipt-before-rollback ordering and parent allowlisting). Both gained permanent regressions; the follow-up review result was PASS with no remaining BLOCKER/HIGH.

**Boundary**

- Immutable receipt undo is not implemented yet; Task 6 is next.
- HTTP routes, launcher wiring, Editor import workbench, isolated browser acceptance, real-project writes, and push remain unperformed.

### 2026-09-01 — Task 6 immutable receipt undo

**Confirmed facts**

- Commit: `44c2245` (`feat(cli): undo unchanged asset imports`).
- Final focused authority/storage GREEN: 43/43; CLI typecheck and diff check passed.
- Undo accepts only the exact committed receipt ID and receipt SHA-256. It preflights the complete batch against current bytes, SHA-256, and filesystem node identity before visible mutation; missing, changed, or same-byte replacement targets block the entire initial undo.
- Each target is journaled through undo rename intent, retained undo quarantine, verification, one create-only self-hashed undo receipt, and `UNDONE`. Quarantine bytes are retained; this phase never purges them.
- Recovery revalidates the canonical project root, exact operation workspace, publication parent identities, every remaining target, and every existing undo quarantine before continuing. Parent replacement, ambiguous paths, changed later targets, or altered quarantine evidence fail closed behind a durable recovery barrier.
- `UNDONE` is not accepted without a valid immutable undo receipt. Barrier resolution re-reads retained quarantine in bounded chunks and verifies node identity, size, modification generation, byte count, and SHA-256.
- Permanent regressions cover unchanged success and idempotency, receipt mismatch, changed/missing/replaced whole-batch blocking, three crash windows, parent replacement, partial multi-file recovery, unexpected post-rename content, missing/tampered undo receipts, and changed retained quarantine.
- A Luna safety audit found recovery-boundary and terminal-receipt gaps. After two correction rounds, the final read-only audit result was PASS with no remaining BLOCKER/HIGH.

**Boundary**

- HTTP routes and the bound Editor launcher are not implemented yet; Task 7 is next.
- No real project, Starter, external Agent, deployment, push, release, or Wave 7 work was performed.

### 2026-09-01 — Task 7 exact HTTP boundary and bound Editor launcher

**Confirmed facts**

- Commit: `d108ec0` (`feat(editor): launch bound asset import authority`). The exact commit contains 12 Task 7 production/test files; this append-only taskbook was excluded.
- Final focused suites passed: authority 34/34, storage/binding 11/11, HTTP 10/10, and real launcher 6/6. CLI and Editor typecheck/build passed; launcher syntax and both Git diff checks passed.
- Ordinary Editor development remains unbound. Only `dev:project` supplies an explicit absolute project root and separate data root, listens on `127.0.0.1`, owns one strict port, and rejects reserved ports 4173/4175.
- The browser boundary requires the exact loopback Origin plus separate server-session, project-binding, and operation tokens. It has no CORS/OPTIONS escape, uses closed JSON requests and safe public response projections, streams binary bodies with measured limits, maps stalled uploads to 408, and does not expose paths, tokens, stacks, source names, or internal staged identities.
- Binding tokens are revoked when the canonical project root changes. Data roots that equal, contain, or sit inside the project root are rejected before any data-root file is created.
- Operation tokens expire at `COMMITTED`, `CANCELLED`, `ROLLED_BACK`, and `UNDONE`. A valid binding may explicitly resume a committed operation for undo. Lost-response replay is accepted only when binding, operation, terminal route, canonical request fingerprint, and current terminal status all match; changed payloads and cross-route reuse are rejected.
- Vite middleware setup is registered before final fallback routing, while authority runtime/lease acquisition is deferred until the launcher owns the server handle. Every project-controlled ready/listen/print/close failure path releases the lease and closes the owned server. The unavoidable external boundary where Vite itself rejects before returning any handle acquires no authority lease.
- Two Luna workers performed repeated read-only HTTP/launcher safety reviews. Their final conclusions contain no remaining BLOCKER, HIGH, or necessary MEDIUM.
- A repeat typecheck was temporarily blocked by a full C drive. Only npm's regenerable download cache was targeted; `npm cache clean --force` freed about 2.5 GB before ending on a 27.5 MB `ENOTEMPTY` residue. No repository file, test evidence, Wave artifact, or user data was removed. All affected checks then passed freshly.

**Boundary**

- The HTTP service and launcher are implemented, but the Editor browser client, human-facing import workbench, state-preserving asset refresh, and isolated browser acceptance are not yet complete.
- No real user project or Starter was opened for writing. No external Agent, deployment, push, release, or Wave 7 work was performed.
- Task 9 Editor client/workbench integration is next; it consumes the already completed CLI half of Task 8 and must finish the Editor refresh half without resetting unrelated UI state.

### 2026-09-01 — Tasks 8/9 focused Editor refresh and private browser client

**Confirmed facts**

- Commit: `6def547` (`feat(editor): manage project asset imports`). The exact commit contains seven Editor production/test files; this append-only taskbook and the Task 10 RED test were excluded.
- The Editor now scans asset directories into a local list and replaces `dirAssets` only after a complete scan. Focused refresh failures preserve the previous list, intelligence, state, and selection; concurrent scans accept only the latest project/revision.
- `refreshProjectAssetIntelligence()` never reopens the project. It waits for the shared Authoring projection rebuild and preserves scenes, dirty flags, timelines, cue selection, review workspace, current tab, filters, and view mode.
- Project switching now invalidates old scans, pending Authoring rebuilds, waiters, browser clients, preview URLs, and binding generations. Success and failure both settle the switching lifecycle; old A-project binding/rebuild results cannot overwrite B-project state.
- Browser HTTP DTOs are independently defined and runtime validated. CLI internal manifests, staged identities, paths, and tokens are not reused as public browser types.
- Server-session, project-binding, operation tokens, and browser session identity stay in the private client closure. They never enter global Editor state, autosave, DOM copy, URL, storage, cookies, logs, or the debug projection.
- Binding uses the current `FileSystemDirectoryHandle` to read one exact root-level challenge probe, with closed shape and a 4 KiB bound. Reload creates a new client/session, performs a fresh challenge, then queries/resumes durable operations; old tokens are not reusable.
- Binary upload uses `XMLHttpRequest` solely for measured upload progress. It has no fixed total-duration timeout; a 35-second no-progress timer resets on every progress event, while the server's 408 is mapped to a stable Chinese upload-timeout result.
- Commit success is not trusted from the immediate response alone: the client queries the durable operation and receipt before projecting completion. Recovery and undo remain explicit human actions.
- Final focused GREEN: client/workspace 12/12 and project IO 44/44. Editor typecheck and build passed. Two Luna read-only reviews found and then verified closure of upload timeout, stale cross-project results, unsafe details, stale workspace projections, BFCache return, and project-switch rebuild lifecycle; the final client review reported no BLOCKER or HIGH.

**Boundary**

- Task 10's in-place Chinese import workbench is not implemented yet. Its permanent RED contract exists separately and currently fails as expected.
- No real project import, Starter mutation, deployment, push, release, or later Wave work was performed.

### 2026-09-01 — Task 10 Chinese in-place import workbench

**Confirmed facts**

- Commit: `e319747` (`feat(editor): import project assets`). The exact commit contains the six Task 10 Editor production/test files; this append-only taskbook was excluded.
- The Asset Center now has one stable `导入素材` entry and an in-place three-row workbench. The header, independently scrollable file/settings/preview region, and ordinary footer action row do not use a modal, floating/sticky action bar, gradient, glass effect, or colored selection rail.
- All ten asset categories use Chinese primary labels. Source name, editable final name, category, destination preview, progress, conflicts, receipt, recovery, conservative undo, and status messages remain human-facing; item and operation identities stay inside data attributes or collapsed technical details.
- The workbench never offers overwrite. A blocked plan explains that an existing or unsafe target must be renamed, then allows a fresh plan against the current fields before seal/commit.
- The browser path is create-only and explicit: choose files, upload into authority staging, plan, human confirmation, seal, commit, durable receipt query, state-preserving asset refresh, then select the first imported asset. Commit and undo report a distinct message when the durable operation succeeded but the local Asset Center refresh failed.
- Project generation, action sequence, captured client instance, and directory-handle identity fence every asynchronous action. A late result from project A cannot project into project B after a switch. Once an operation exists, the file set is locked; upload/plan windows also lock category/name controls, and the final plan reads the current workspace targets.
- Upload and planning are cancellable at bounded safe points. Seal/commit/recovery/undo are explicitly non-interruptible from the UI. `READY`, `PUBLISHING`, `ROLLING_BACK`, `UNDOING`, and `RECOVERY_REQUIRED` all retain a reachable continuation; a receipt never hides an in-progress recovery state.
- Final focused GREEN: workbench 10/10, existing Asset Center 7/7, browser client/workspace 12/12, and project IO 44/44 (73/73 total). Editor typecheck and build passed; Git diff check passed.
- A Luna presentation worker created the initial isolated workbench/CSS implementation. A separate Luna reviewer found three HIGH lifecycle gaps (recovery reachability, stale upload targets, and busy cancellation). After three focused correction passes, its final verdict was `CLOSED / CLOSED / CLOSED`.

**Boundary**

- No real project or Starter was opened for writing. No external Agent, deployment, release, or push was performed in Task 10.
- Task 11 isolated browser flow and final affected verification remain pending. Pass 4 and later roadmap work have not started.

### 2026-09-01 — Task 11 isolated browser runner

**Confirmed facts**

- The permanent runner contract first failed 5/5 because the browser runner did not exist. The test was corrected to use Vitest directly after the old `node:test`-inside-Vitest pattern was observed returning a false process success despite printed failures.
- The final runner contract passes 5/5 and requires a strict non-reserved loopback port, a fresh Starter-derived project/data root, a live Node-backed directory handle, Chinese workbench actions, exact ordered milestones, exclusive evidence files, reload token rotation, and every browser/process error channel.
- Three runner-only diagnostic corrections were retained in history rather than overwritten: an incorrect host selector stopped at 3/14; a Node `--eval` argument boundary stopped before the browser; and the first complete 12/14 path exposed Chrome's generic console echo for the expected `409 /undo` business rejection.
- The expected 409 console echo is now classified only when exactly one `IMPORT_UNDO_BLOCKED_CHANGED` response and exactly one matching Chrome message occur. Other console or network failures still fail the run.
- Final isolated browser flow: 14/14 passed. Evidence: `C:\Users\Equinox\AppData\Local\Temp\surdet-asset-import-e2e-uD6wvE\artifact\evidence.json`, 67,423 bytes, SHA-256 `b74ccc216abb141ffdab8c24bb2799fe83a8aca927bd5170192d8043e0190b8e`. Identity: 403 bytes, SHA-256 `19fce5fa7af6f4b805804312556347be8ed76458717eb440f5a4de791d16b36a`.
- The browser proved wrong-directory rejection, fresh successful binding, two-file selection, create-only collision blocking, multi-file commit, immediate asset-fact refresh, reload with fresh binding and operation tokens, durable receipt reopening, whole-batch undo blocking after one imported file changed, successful undo after exact byte restoration, retained quarantine, final fixture restoration, original Starter/repository preservation, port release, and zero active lease directories.
- The one expected 409 and its matching console echo are preserved separately. All other runner, console, page, request, response, stderr, child-cleanup, and lease channels are empty.

**Boundary**

- The browser flow used only a generated temporary fixture. It did not write a real user project or the original Starter.
- Final affected workspace checks, aggregate `verify:all`, independent Luna review, exact closure commit, and the owner-authorized ordinary push remain pending.

### 2026-09-01 — Task 11 final affected verification

**Confirmed facts**

- Focused Authoring import planner: 5/5 passed.
- Focused CLI authority/storage/HTTP/project-storage suites: 62/62 passed.
- Focused Editor launcher/client/workbench/Asset Center/project IO/runner suites: 84/84 passed.
- Authoring, CLI, and Editor typechecks passed. Authoring, CLI, and Editor builds passed.
- The single aggregate `npm run verify:all` completed through its final diff check without a failed node. It included tools/boundaries/docs/hygiene, all workspace typechecks, Authoring 280/280, CLI 380/380, Core 329/329, Editor 514/514, Host 87/87, Renderer 413/413, Shell 195/195, Starter 7/7, Zero After Midnight 29/29, Starter simulation, formal lint/simulation/assets, and all three production builds.
- Existing Starter and Zero After Midnight lint warnings remain warnings with zero lint errors and are unrelated to this import feature. The aggregate run reported zero simulation runtime errors.
- Post-build Git inspection found no generated tracked diff outside the authorized taskbook, receipt-reopen UI/test, and Task 11 runner/contract paths. Both Git diff checks passed.

**Boundary**

- Independent Luna review and final exact commit are next. No push had been performed at this checkpoint.

### 2026-09-01 — Independent review closure

**Confirmed facts**

- The Editor/data-safety Luna review found no BLOCKER and one HIGH: opening a historical receipt while a draft or active operation existed could replace the active projection and indirectly discard the draft. The workbench now exposes historical receipts only when both `activeOperation === null` and `draftItems.length === 0`; the reviewer's follow-up verdict is `CLOSED`.
- The same correction pass keeps recent receipt status aligned after commit/undo and renders an undone receipt as `导入已撤销` without a link to a no-longer-existing imported asset.
- The runner Luna review found no BLOCKER or HIGH. Its evidence-hardening suggestions were applied: canonical project comparison excludes only `.surdet/asset-import`; expected undo 409 reads and validates the exact `IMPORT_UNDO_BLOCKED_CHANGED` JSON code; asset facts must drop both imported IDs after undo; pending header capture drains before evidence; and repository/Starter identity is rechecked after the child process exits.
- The final targeted follow-up review confirmed every runner hardening item in the current source and returned PASS with no new BLOCKER or HIGH. It made no file changes and did not rely on a replacement run.
- Post-review focused Editor tests passed 73/73. Editor typecheck and build passed. The final strengthened isolated browser run passed 14/14 with no failed node.
- Final browser evidence: `C:\Users\Equinox\AppData\Local\Temp\surdet-asset-import-e2e-no6TIe\artifact\evidence.json`, 68,241 bytes, SHA-256 `96501e908f8f63357efc53cc7f4165e6b32a1072f716fef4937f774e6e3d649f`. Identity: 403 bytes, SHA-256 `0bbfa62ec15aae27092d110fa01906afd0e9ee4c741a75dc59512f782feb2efb`.
- No aggregate rerun was used after the localized review correction. The already-passed aggregate remains recorded honestly; the final changed Editor boundary is covered by focused tests, Editor typecheck/build, and the fresh physical browser path.

**Boundary**

- Exact final commit and the owner-authorized ordinary push remain pending. Pass 4 and later roadmap work have not started.
