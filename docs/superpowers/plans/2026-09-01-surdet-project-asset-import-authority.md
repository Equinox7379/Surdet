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
- Modify: `packages/cli/src/asset-import-authority/record-store.ts`
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
