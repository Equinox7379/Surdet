# Review Terminal Atomicity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make comparison decisions and integration-result approval/return receipts first-writer-immutable across Editor windows and independent Node processes through one local Node authority.

**Architecture:** Editor remains the human decision surface but submits terminal commands to a same-origin local Review Authority. The authority validates the canonical review payload through shared Authoring contracts, acquires a review-scoped `NodeLocalLeaseManager` lease, and performs the existing create-only Node record write. Static/no-authority Editor sessions are read-only for terminal actions and never fall back to browser file writes.

**Tech Stack:** TypeScript 5.7, Node.js 20+, Vite 6 middleware, File System Access API for read-only workspace evidence, existing `@surdet/authoring` review receipt validators, `NodeLocalLeaseManager`, `NodeReviewStore`, Vitest, Node child processes, Playwright through the existing local E2E harness.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-09-01-review-terminal-atomicity-design.md`.
- Preserve `decision.json`, `final-approval.json`, and `return-request.json`; do not add or migrate to `terminal.json`.
- No browser production path may create or write a terminal receipt file after Task 6.
- No MCP/Agent Port capability may approve, return, or choose on behalf of a human.
- Review receipt writes may change review receipt metadata only. Project files, change records, integration trees, source capsules, immutable review payloads, and identity sidecars remain unchanged.
- Every terminal pre-check and create occurs under one review-scoped cross-process lease.
- No direct browser-write fallback is allowed when authority status is unavailable, mismatched, busy, corrupt, or uncertain.
- The HTTP adapter accepts no absolute path, uses exact same-origin and a per-server token, limits JSON bodies to 256 KiB, and never exposes token, stack, data root, or hidden receipt content in errors.
- Keep Editor visible copy natural Chinese. Protocol codes and receipt fields remain in collapsed technical information.
- Reuse existing Authoring receipt validators and Node create-only storage. Do not duplicate fingerprint or business validation in HTTP/Vite code.
- Do not change Core, Renderer, Host, Shell, Starter, Zero, save-game format, project content format, performance thresholds, or unrelated frontend styling.
- Do not modify, stage, or commit protected files or the long-term roadmap ledger. The long-term ledger remains intentionally untracked and is updated only after reviewed closure.
- Do not push, deploy, publish, start Asset Center, start Frontend Pass 5, or enter Wave 7.
- Run the single aggregate `npm run verify:all` only after pre-aggregate manager review findings are corrected and `CODE_EVIDENCE_HEAD` is frozen. A failed aggregate is recorded once and not rerun without new authorization.

---

## Current baseline and known failure

Current production writers are not globally atomic:

```text
Editor: WeakMap keyed by one ReviewWorkspaceState object
Node:   Map keyed inside one Node process
Disk:   final-approval.json and return-request.json are separate targets
```

The gate is GREEN only when two independent Node processes and two independent browser contexts converge on one persisted terminal outcome.

## Planned commit sequence

1. `feat(authoring): define review terminal contract`
2. `feat(cli): lease review terminal writes`
3. `fix(cli): serialize review terminal receipts`
4. `feat(cli): add local review terminal authority`
5. `feat(editor): connect local review authority`
6. `test(authoring): verify review terminal atomicity`
7. pre-aggregate correction commits only when a concrete review finding has its own RED→GREEN evidence
8. `docs(authoring): close review terminal atomicity gate`

## Delegation boundary

The General Manager owns Tasks 1–5 architecture, public contracts, leases, authority validation, security decisions, integration, commits, final review, and completion claims. A bounded worker may own only one disjoint test fixture, HTTP test harness, Editor presentation test, or E2E runner file at a time. Worker reports are candidate evidence; the manager rereads every diff and runs final gates.

---

### Task 0: Freeze the baseline and old-writer evidence

**Files:**
- Modify: `docs/superpowers/plans/2026-09-01-review-terminal-atomicity.md`
- Read only: `packages/editor/src/review-workspace.ts`
- Read only: `packages/cli/src/authoring/node-review-store.ts`
- Read only: `packages/cli/src/authoring/node-local-lease.ts`
- Read only: `packages/authoring/src/review-receipts.ts`

**Interfaces:**
- Consumes: design commit and current Git state.
- Produces: exact baseline, approved-path inventory, and proof that old serializers are process-local.

- [x] **Step 1: Record exact Git and workspace baseline**

Run:

```powershell
git rev-parse HEAD HEAD^ surdet/main
git rev-list --left-right --count surdet/main...HEAD
git status --short
git diff --check
git diff --cached --check
```

Expected: only the taskbook/spec correction is tracked; staging is empty; existing untracked/protected files remain untouched.

- [x] **Step 2: Freeze the old serializer proof**

Record the exact symbols and current behavior:

```text
Editor withResultReceiptWrite -> WeakMap<ReviewWorkspaceState, Promise>
Editor writeCreateOnly -> get existing, create handle, write; no exclusive create
Node withResultReceiptWrite -> process-local Map<string, Promise>
Node createFinalApproval/createReturnRequest -> pre-check two different files
```

No source change occurs in this step.

- [x] **Step 3: Freeze the authorized production and test file list**

The allowed list is exactly the files named in Tasks 1–7 plus this taskbook and approved design correction. Any new production file requires a taskbook amendment before edit. Protected files, long-term ledger, historical artifacts, package outputs, and screenshots stay unstaged.

---

### Task 1: Shared review terminal command and error contract

**Files:**
- Create: `packages/authoring/src/review-terminal.ts`
- Modify: `packages/authoring/src/error-catalog.ts`
- Modify: `packages/authoring/src/index.ts`
- Create: `packages/authoring/test/review-terminal.test.ts`
- Modify: `packages/authoring/test/error-catalog.test.ts`

**Interfaces:**
- Consumes: existing receipt types from `review-receipts.ts` / `review-contracts.ts` and error envelope conventions.
- Produces: `ReviewTerminalAction`, `ReviewTerminalCommand`, `ReviewTerminalRecord`, `ReviewTerminalSnapshot`, exact runtime parsers, `REVIEW_BUSY`, and `REVIEW_TERMINAL_ALREADY_SET`.

- [x] **Step 1: Write shared contract RED tests**

Add tests that require:

```ts
const command: ReviewTerminalCommand = {
  protocolVersion: '1.0.0',
  requestId: 'req_01',
  projectIdentity: 'a'.repeat(32),
  reviewId: 'review_result_01',
  reviewPayload: { bytes: 123, sha256: 'b'.repeat(64) },
  action: 'result-approval',
  receipt: {
    receiptVersion: '1.0.0',
    approvalId: 'approval_01',
    resultReviewId: 'review_result_01',
    approvalFingerprint: 'c'.repeat(64),
  },
};

expect(parseReviewTerminalCommand(command)).toEqual(command);
expect(() => parseReviewTerminalCommand({ ...command, reviewPath: 'C:/secret' }))
  .toThrowErrorMatchingObject({ code: 'INVALID_REQUEST' });
```

Cover unknown fields, empty IDs, malformed SHA/bytes, action values, action/receipt structure mismatch, and exact snapshot states. Freeze error catalog retry semantics:

```ts
expect(errorContract('REVIEW_BUSY')).toMatchObject({
  category: 'conflict',
  retryDisposition: 'after-refresh',
});
expect(errorContract('REVIEW_TERMINAL_ALREADY_SET')).toMatchObject({
  category: 'conflict',
  retryDisposition: 'never',
});
```

- [x] **Step 2: Run Task 1 RED once**

```powershell
npm run test -w @surdet/authoring -- --run test/review-terminal.test.ts test/error-catalog.test.ts
```

Expected: missing module/exports/error codes fail while existing error tests remain green.

- [x] **Step 3: Implement strict shared types and parsers**

`review-terminal.ts` must export:

```ts
export type ReviewTerminalAction =
  | 'comparison-decision'
  | 'result-approval'
  | 'result-return';

export type ReviewTerminalState =
  | 'open'
  | 'decision-written'
  | 'approval-written'
  | 'returned'
  | 'corrupt';

export function parseReviewTerminalCommand(value: unknown): ReviewTerminalCommand;
export function parseReviewTerminalSnapshot(value: unknown): ReviewTerminalSnapshot;
```

Use strict record key comparison, `Number.isSafeInteger(bytes) && bytes >= 0`, exact lowercase 64-hex SHA, non-empty bounded IDs, and no path field. Parser failures use `AuthoringOperationError('INVALID_REQUEST', ...)`.

Add the two error codes to `AUTHORING_ERROR_CODES` and catalog. Do not add a capability registry entry.

- [x] **Step 4: Run Task 1 GREEN and workspace checks**

```powershell
npm run test -w @surdet/authoring -- --run test/review-terminal.test.ts test/error-catalog.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
```

Expected: all exit `0`.

- [x] **Step 5: Verify capability surface did not gain a writer**

```powershell
rg -n "review\.(approve|return|decide)|terminal.*minimumPolicy" packages/authoring/src/capability-registry.ts
```

Expected: no new terminal writer capability.

- [x] **Step 6: Commit Task 1 exactly**

Stage the five Task 1 paths plus this taskbook only, run both diff checks, inspect `git diff --cached --name-only`, then commit:

```text
feat(authoring): define review terminal contract
```

---

### Task 2: Extend the proven lease manager with review scope

**Files:**
- Modify: `packages/cli/src/authoring/node-local-lease.ts`
- Modify: `packages/cli/test/node-local-lease.test.ts`

**Interfaces:**
- Consumes: `REVIEW_BUSY` and existing lease publication/recovery machinery.
- Produces: `LeaseScope = 'change' | 'project' | 'review'` and review lock directories under `.locks/reviews`.

- [x] **Step 1: Write review-scope lease RED tests**

Add the review scope to existing table-driven heartbeat/release tests and add exact assertions:

```ts
const manager = new NodeLocalLeaseManager(dataRoot, deterministicOptions);
const first = await manager.acquire({ scope: 'review', resourceId: 'project\0review_1' });

await expect(contender.acquire({
  scope: 'review',
  resourceId: 'project\0review_1',
})).rejects.toMatchObject({ code: 'REVIEW_BUSY' });

expect(first.directory).toContain(path.join('.locks', 'reviews'));
```

Cover distinct review IDs, same review across managers, wrong owner release, heartbeat drain, dead same-host owner recovery, live owner preservation, foreign host, corrupt lease, publication window, sentinel/extra-file fail-loud release, and zero changes to change/project error codes.

- [x] **Step 2: Run Task 2 RED once**

```powershell
npm run test -w @surdet/cli -- --run test/node-local-lease.test.ts
```

Expected: TypeScript/test failures because review scope and error mapping do not exist.

- [x] **Step 3: Implement review scope without copying the lease state machine**

Update the existing branches rather than adding another lock class:

```ts
export type LeaseScope = 'change' | 'project' | 'review';

function busyCode(scope: LeaseScope): 'CHANGE_BUSY' | 'PROJECT_BUSY' | 'REVIEW_BUSY' {
  if (scope === 'change') return 'CHANGE_BUSY';
  if (scope === 'project') return 'PROJECT_BUSY';
  return 'REVIEW_BUSY';
}
```

`scopeDirectory('review')` returns `.locks/reviews`. `lockDirectory()` uses `safeId(resourceId)` for change/review and `projectIdentityFromRoot()` only for project. Every other acquire/inspect/release/heartbeat path remains shared.

- [x] **Step 4: Run Task 2 GREEN**

```powershell
npm run test -w @surdet/cli -- --run test/node-local-lease.test.ts
npm run typecheck -w @surdet/cli
```

Expected: all exit `0`; existing change/project lease counts unchanged except expanded table cases.

- [x] **Step 5: Commit Task 2 exactly**

Stage the two Task 2 files plus taskbook and commit:

```text
feat(cli): lease review terminal writes
```

---

### Task 3: Make NodeReviewStore terminal writes cross-process atomic

**Files:**
- Modify: `packages/cli/src/authoring/node-review-store.ts`
- Modify: `packages/cli/test/node-review-store.test.ts`
- Modify: `packages/cli/src/authoring/node-local-lease.ts`
- Modify: `packages/cli/test/node-local-lease.test.ts`
- Create: `packages/cli/test/fixtures/review-terminal-worker.mjs`

**Interfaces:**
- Consumes: review-scoped `NodeLocalLeaseManager` and existing create-only JSON record storage.
- Produces: lease-bound `createDecision`, `createFinalApproval/createApproval`, and `createReturnRequest` with idempotent existing-byte semantics.

- [x] **Step 1: Write independent-process RED fixtures**

The worker accepts only a JSON stdin command containing data root, project identity, review ID, action, and receipt fixture. It constructs `NodeReviewStore` and performs one create. It emits one JSON stdout result and no logs.

Add tests that spawn two workers simultaneously:

```ts
const [approval, returned] = await Promise.all([
  runWorker({ action: 'approval', receipt: approvalReceipt }),
  runWorker({ action: 'return', receipt: returnReceipt }),
]);

expect([approval.status, returned.status].sort()).toEqual(['rejected', 'written']);
expect(receiptNames(reviewDirectory)).toHaveLength(1);
```

Also race two different decisions and two identical requests. The concurrent loser receives `REVIEW_BUSY`; after the winner releases, retry the exact losing command. Different content must then receive `REVIEW_TERMINAL_ALREADY_SET`, while identical content must return the existing byte identity. Assert exact disk bytes/SHA, unchanged identity/payload, and zero active review lock directories.

- [x] **Step 2: Run Task 3 RED once**

```powershell
npm run build -w @surdet/cli
npm run test -w @surdet/cli -- --run test/node-review-store.test.ts
```

The build refreshes the plain-Node worker's `dist` import before the test; it is not a verification substitute. Expected: the real approval/return multi-process race can create both files or the tests fail on missing lease injection/terminal mapping.

- [x] **Step 3: Inject the shared lease manager**

Use one constructor field:

```ts
private readonly leases: NodeLocalLeaseManager;

constructor(
  projectDirectory: string,
  private readonly expectedProjectIdentity: string,
  leases?: NodeLocalLeaseManager,
) {
  this.projectDirectory = validatedProjectDirectory(projectDirectory, expectedProjectIdentity);
  this.leases = leases ?? new NodeLocalLeaseManager(path.dirname(this.projectDirectory));
}
```

Add a private `withReviewLease(reviewId, callback)` using resource ID `${expectedProjectIdentity}\0${reviewId}`. Move review re-read, kind check, terminal pre-check, and create-only write inside it.

- [x] **Step 4: Define exact existing-terminal mapping**

Inside the lease:

```text
same target + identical bytes -> return existing identity
same target + different bytes -> REVIEW_TERMINAL_ALREADY_SET
opposite result target exists -> REVIEW_TERMINAL_ALREADY_SET
both result targets exist -> REVIEW_IDENTITY_MISMATCH
no target -> createOnlyJson
```

Remove the process-local `resultReceiptWrites` map only after all tests use the lease.

- [x] **Step 5: Run Task 3 GREEN and adjacent tests**

```powershell
npm run build -w @surdet/cli
npm run test -w @surdet/cli -- --run test/node-review-store.test.ts test/review-service.test.ts test/node-local-lease.test.ts
npm run typecheck -w @surdet/cli
```

Expected: all exit `0`, real worker races leave one receipt, and lock cleanup is empty.

- [x] **Step 6: Commit Task 3 exactly**

Stage the three Task 3 paths plus taskbook and commit:

```text
fix(cli): serialize review terminal receipts
```

---

### Task 4: Add the canonical ReviewTerminalAuthority service

**Files:**
- Create: `packages/cli/src/authoring/review-terminal-authority.ts`
- Create: `packages/cli/test/review-terminal-authority.test.ts`
- Modify: `packages/cli/src/authoring/node-review-store.ts`
- Modify: `packages/cli/test/node-review-store.test.ts`
- Modify: `packages/cli/src/authoring/review-service.ts`
- Modify: `packages/cli/test/review-service.test.ts`

**Interfaces:**
- Consumes: `ReviewTerminalCommand`, `ReviewTerminalSnapshot`, `NodeReviewStore`, `validateComparisonDecision`, `validateFinalApproval`, `validateReturnRequest`, and `TextHasher`.
- Produces: exported `parseReviewProjection()`, `ReviewTerminalAuthority.describe()`, and `.write()`.

**Approved implementation correction:** authority validation and terminal creation must occur inside one review lease. `NodeReviewStore` therefore exposes one lease-bound terminal write entry accepting an optional validation callback over the freshly re-read immutable workspace. Existing `createDecision/createFinalApproval/createApproval/createReturnRequest` remain wrappers. This avoids both a validate-then-lock TOCTOU window and a nested acquisition deadlock; it does not expand the public Agent capability surface.

**Observed lease correction:** the Task 4 combined run exposed a real release/read race: after `mkdir` reports an existing lock, the holder may validly release the directory before the contender reads `lease.json`. That exact disappearance must restart acquisition, not exhaust the publication window as `LEASE_CORRUPT`. Task 4 therefore adds one deterministic RED→GREEN case to the existing lease manager; persistent missing `lease.json`, malformed records, sentinels, and other true corruption remain fail-loud.

- [x] **Step 1: Write authority RED tests**

Create immutable comparison and result fixtures through the existing review preparation helpers. Test:

```ts
const authority = new ReviewTerminalAuthority(dataRoot, leases, hasher);
const before = await authority.describe(identityInput);
expect(before.state).toBe('open');

const after = await authority.write(command);
expect(after).toMatchObject({ state: 'approval-written' });
```

Cover all three actions, wrong project/review/payload identity, malformed receipt, invalid fingerprint, invalid reason category, result not ready, already terminal, both-file corrupt, identical retry, unknown path-like request field, and project/change/payload tree hashes before/after.

- [x] **Step 2: Run Task 4 RED once**

```powershell
npm run test -w @surdet/cli -- --run test/review-terminal-authority.test.ts
```

Expected: missing authority module/methods fail.

- [x] **Step 3: Implement describe as a pure canonical read**

Rename/export the existing private `reviewProjection()` validator as `parseReviewProjection()` and keep its current callers on that one function. `describe()` validates IDs and payload identity, resolves `path.join(dataRoot, projectIdentity)` through `NodeReviewStore`, rechecks payload identity, parses the payload through `parseReviewProjection()`, reads legal receipt files, and returns exactly one state. It does not acquire a write lease because it cannot authorize mutation.

- [x] **Step 4: Implement write through shared validators and store lease**

`write()` parses the command, reloads canonical review, verifies payload identity, dispatches the exact Authoring validator for the action, then calls the corresponding lease-bound store create method. It returns a fresh `describe()` snapshot after the create.

No action may accept a raw path or skip fingerprint recomputation.

- [x] **Step 5: Run Task 4 GREEN and service adjacency**

```powershell
npm run test -w @surdet/cli -- --run test/review-terminal-authority.test.ts test/node-review-store.test.ts test/review-service.test.ts test/node-local-lease.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

- [x] **Step 6: Commit Task 4 exactly**

Stage Task 4 files plus taskbook and commit:

```text
feat(cli): add local review terminal authority
```

---

### Task 4A: Independent audit hardening before transport exposure

**Files:**
- Modify: `packages/authoring/src/error-catalog.ts`
- Modify: `packages/authoring/test/error-catalog.test.ts`
- Modify: `packages/cli/src/authoring/node-review-store.ts`
- Modify: `packages/cli/src/authoring/review-service.ts`
- Modify: `packages/cli/src/authoring/review-terminal-authority.ts`
- Modify: `packages/cli/test/node-review-store.test.ts`
- Modify: `packages/cli/test/review-service.test.ts`
- Modify: `packages/cli/test/review-terminal-authority.test.ts`

- [x] **Step 1: Establish audit RED tests**

Freeze mismatched authority/lease roots, runtime-unknown terminal actions, malformed projection arrays, malformed and business-invalid single receipt classification, recoverable `REVIEW_BUSY` metadata, and child cleanup/type accuracy.

- [x] **Step 2: Implement the minimum hardening**

Reject root mismatch in the authority constructor; switch explicitly over all three store actions; strengthen the existing projection parser enough that shared validators cannot receive missing collections; classify a single corrupt receipt as `corrupt`; keep `REVIEW_BUSY` non-terminal and refreshable.

- [x] **Step 3: Record the local filesystem threat boundary**

The authority protects against browser-origin abuse and cooperative Surdet window/process concurrency. It cannot claim integrity against a malicious same-account process with arbitrary filesystem write access, because that actor can directly edit review receipts independent of this API. Static symbolic-link/path escape remains rejected; no repeated `realpath` check is presented as a complete local-adversary defense.

- [x] **Step 4: Run focused GREEN and commit the audit fix**

Run Authoring error contract, CLI authority/store/service/lease suites, both typechecks/builds affected by the shared catalog, then commit exact audited paths plus this taskbook as:

```text
fix(cli): harden review authority boundary
```

---

### Task 5: Secure same-origin HTTP and Vite mounting

**Files:**
- Create: `packages/cli/src/review-authority/http-handler.ts`
- Create: `packages/cli/src/review-authority/vite-plugin.ts`
- Create: `packages/cli/test/review-authority-http.test.ts`
- Modify: `packages/editor/vite.config.ts`
- Create: `packages/editor/test/review-authority-boundary.test.ts`

**Interfaces:**
- Consumes: `ReviewTerminalAuthority` and strict shared command/snapshot parsers.
- Produces: status/describe/write HTTP endpoints and Vite dev/preview plugin mounting.

- [x] **Step 1: Write HTTP security RED tests**

Use minimal fake request/response objects or a loopback ephemeral server. Require:

```text
GET status: same origin, no receipt data, reports protocol 1.0.0
POST describe/write: exact Origin + X-Surdet-Review-Authority token + application/json
body > 262144 bytes: reject 413 before JSON/business dispatch
wrong method/origin/token/content type/unknown key: reject
business error: structured bounded JSON, no stack/token/dataRoot
```

Freeze a spy proving rejected requests never call authority methods.

- [x] **Step 2: Write Editor boundary RED test**

Read the Editor browser source and Vite config separately:

```ts
expect(browserSources).not.toMatch(/node:|node-review-store|node-local-lease|@surdet\/cli/);
expect(viteConfigSource).toMatch(/reviewAuthorityVitePlugin/);
```

Expected RED: plugin/middleware absent.

- [x] **Step 3: Run Task 5 RED once**

```powershell
npm run test -w @surdet/cli -- --run test/review-authority-http.test.ts
npm run test -w surdet-editor -- --run test/review-authority-boundary.test.ts
```

- [x] **Step 4: Implement the bounded HTTP handler**

The handler accepts constructor dependencies rather than reading globals in tests:

```ts
export function createReviewAuthorityHttpHandler(options: {
  authority: ReviewTerminalAuthority;
  token: string;
  expectedOrigin: (request: IncomingMessage) => string;
  maxBodyBytes?: number;
}): (request: IncomingMessage, response: ServerResponse) => void;
```

Use exact routes, methods, token, origin, content type, body limit, JSON parsing, and one response envelope. Do not log command receipts.

- [x] **Step 5: Implement the Vite plugin**

`reviewAuthorityVitePlugin()` creates one random token and one authority bound to `SURDET_AGENT_DATA_DIR`/existing default. It mounts the same handler in `configureServer` and `configurePreviewServer`, then injects only the token and protocol endpoint into `index.html`. It does not alter `preview.html`.

Vite 6 preview does not run `transformIndexHtml`; the plugin therefore uses a preview-only pre-static middleware to read the built `index.html`, inject that server's token in memory, and return it. Static build output remains token-free, while `/preview.html` always falls through byte-for-byte.

`packages/editor/vite.config.ts` adds the plugin without changing port/build inputs.

- [x] **Step 6: Run Task 5 GREEN, typechecks, and build**

```powershell
npm run test -w @surdet/cli -- --run test/review-authority-http.test.ts
npm run test -w surdet-editor -- --run test/review-authority-boundary.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

- [x] **Step 7: Commit Task 5 exactly**

Stage the five Task 5 paths plus taskbook and commit:

```text
feat(editor): mount local review authority
```

---

### Task 6: Route Editor review actions through the authority

**Files:**
- Create: `packages/editor/src/review-terminal-client.ts`
- Modify: `packages/editor/src/review-workspace.ts`
- Modify: `packages/editor/src/panels/review-panel.ts`
- Create: `packages/editor/test/review-terminal-client.test.ts`
- Modify: `packages/editor/test/review-workspace.test.ts`
- Modify: `packages/editor/test/review-panel.test.ts`
- Modify: `packages/editor/test/review-authority-boundary.test.ts`

**Interfaces:**
- Consumes: injected authority token/endpoint, shared command/snapshot types, existing receipt builders/fingerprints, and review workspace identity.
- Produces: bounded `ReviewTerminalClient`, authority status in workspace state, read-only fallback, and authority-backed decision/approval/return functions.

- [x] **Step 1: Write client RED tests**

Test exact status/describe/write requests, token header, bounded timeout, strict response parsing, and uncertain-response resolution:

```ts
await expect(client.write(command)).rejects.toMatchObject({
  code: 'REVIEW_AUTHORITY_UNAVAILABLE',
});
expect(fetchCalls).toHaveLength(1);
```

For a timeout after server commit, `describe()` returns the persisted exact receipt and the client does not mint a new request ID or receipt.

- [x] **Step 2: Write workspace and panel RED tests**

Freeze:

- opening checks authority after local identity/payload validation;
- unavailable/mismatch/corrupt states keep readable projection and disable terminal actions;
- success state is updated only from authority snapshot;
- double click/repeated Enter produces one in-flight command;
- reopened canonical receipt is read-only;
- no `writeCreateOnly(...decision/final-approval/return-request...)` remains;
- visible status copy is the approved Chinese text.

- [x] **Step 3: Run Task 6 RED once**

```powershell
npm run test -w surdet-editor -- --run test/review-terminal-client.test.ts test/review-workspace.test.ts test/review-panel.test.ts
```

Expected: client/status hooks absent and old direct writes violate assertions.

- [x] **Step 4: Implement strict browser client**

The client reads one injected configuration, sends same-origin relative requests, applies an `AbortController` timeout, and parses only shared snapshots/errors. It exposes no data-root or path option.

- [x] **Step 5: Replace direct workspace writes**

Receipt-building functions keep the existing schema and fingerprint logic, then submit:

```ts
const command: ReviewTerminalCommand = {
  protocolVersion: '1.0.0',
  requestId,
  projectIdentity: workspace.identity.projectIdentity,
  reviewId: workspace.identity.reviewId,
  reviewPayload: {
    bytes: workspace.identity.payload.bytes,
    sha256: workspace.identity.payload.sha256,
  },
  action: 'result-approval',
  receipt,
};
```

Delete browser terminal file creation. Update state from returned canonical snapshot only.

- [x] **Step 6: Implement Chinese authority states in the panel**

Disable actions during checking/submitting or when state is unavailable/mismatch/corrupt/terminal. Do not hide review evidence. Existing technical details may display structured codes only after expansion.

- [x] **Step 7: Run Task 6 GREEN and full Editor adjacency**

```powershell
npm run test -w surdet-editor -- --run test/review-terminal-client.test.ts test/review-workspace.test.ts test/review-panel.test.ts test/review-authority-boundary.test.ts
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

- [x] **Step 8: Commit Task 6 exactly**

Stage seven Task 6 paths plus taskbook and commit:

```text
feat(editor): connect local review authority
```

---

### Task 7: Real cross-process and cross-window proof

**Files:**
- Create: `packages/cli/e2e/review-terminal-atomicity-gate.e2e.mjs`
- Create: `packages/cli/test/review-terminal-atomicity-runner.test.mjs`

**Interfaces:**
- Consumes: built Authoring, CLI authority, Editor dist/plugin, isolated review fixtures, two Node workers, and two browser contexts.
- Produces: one fixed preflight/formal runner and exclusive evidence artifact.

- [x] **Step 1: Write runner contract RED tests**

Freeze these runner requirements:

```text
modes: --preflight | --formal
strict loopback port allocated dynamically; 4173 and 4175 forbidden
exclusive temp artifact root
runHead and runnerSha256 in evidence
formal requires clean tracked worktree and runHead === CODE_EVIDENCE_HEAD
fixed milestone names and count
all error/console/page/request/stderr/cleanup/active-review-lease channels empty
```

Require runner source to check disk bytes/SHA, both receipt filenames, project tree identity, payload identity, process cleanup, and no Agent writer capability.

- [x] **Step 2: Run runner RED once**

```powershell
npm run test -w @surdet/cli -- --run test/review-terminal-atomicity-runner.test.mjs
```

Expected: missing runner/import failures.

- [x] **Step 3: Implement fixed milestones**

Use this order:

```text
01 baseline-and-capability-surface
02 isolated-review-fixtures
03 authority-server-identity
04 comparison-two-process-race
05 comparison-idempotent-retry
06 result-approval-return-two-process-race
07 corrupt-both-files-fail-loud
08 editor-authority-available
09 editor-two-context-race
10 losing-context-reopens-winner
11 static-editor-read-only
12 payload-identity-mismatch
13 project-change-review-payload-unchanged
14 process-and-lease-cleanup
15 evidence-identity
```

No milestone may mutate the original Starter or repository project.

- [x] **Step 4: Run runner contract GREEN**

```powershell
node --check packages/cli/e2e/review-terminal-atomicity-gate.e2e.mjs
npm run test -w @surdet/cli -- --run test/review-terminal-atomicity-runner.test.mjs
```

- [x] **Step 5: Run one preflight**

Build Authoring, CLI, and Editor first, then:

```powershell
node packages/cli/e2e/review-terminal-atomicity-gate.e2e.mjs --preflight
```

Expected: endpoint identity, token rejection controls, fixture identity, two process workers, browser availability, and cleanup all pass without terminal mutation.

- [x] **Step 6: Commit runner and contract**

Stage the two Task 7 files plus taskbook and commit:

```text
test(authoring): verify review terminal atomicity
```

Do not run FORMAL until Task 8 freezes the reviewed code evidence head.

---

### Task 8: Pre-aggregate review, frozen evidence, final gates, and stop

**Files:**
- Modify: `docs/superpowers/plans/2026-09-01-review-terminal-atomicity.md`
- Update after reviewed closure only: untracked `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`

**Interfaces:**
- Consumes: Tasks 1–7 commits.
- Produces: reviewed `CODE_EVIDENCE_HEAD`, one FORMAL artifact, proportionate full gates, one aggregate result, docs-only closeout, and no push.

- [x] **Step 1: Run all focused suites before secondary review**

```powershell
npm run test -w @surdet/authoring -- --run test/review-terminal.test.ts test/error-catalog.test.ts test/review-receipts.test.ts
npm run test -w @surdet/cli -- --run test/node-local-lease.test.ts test/node-review-store.test.ts test/review-service.test.ts test/review-terminal-authority.test.ts test/review-authority-http.test.ts test/review-terminal-atomicity-runner.test.mjs
npm run test -w surdet-editor -- --run test/review-terminal-client.test.ts test/review-workspace.test.ts test/review-panel.test.ts test/review-authority-boundary.test.ts
```

- [x] **Step 2: Perform pre-aggregate manager and bounded secondary review**

Review the complete design-to-HEAD range for:

- browser direct-write remnants;
- bypass around the review lease;
- cross-process lock and stale recovery correctness;
- action/receipt validation mismatch;
- endpoint path/token/origin/body vulnerabilities;
- unsafe retry or optimistic success;
- Agent Port writer exposure;
- project/change/payload mutation;
- test-only behavior not reached by production.

Any concrete finding is corrected now with its own focused RED→GREEN and exact commit. Do not defer a confirmed finding until after aggregate verification.

- [x] **Step 3: Freeze CODE_EVIDENCE_HEAD**

Require:

```text
tracked worktree clean
staging empty
git diff --check = 0
git diff --cached --check = 0
commit file sets match the taskbook
long-term ledger and protected files remain unstaged
```

Record `CODE_EVIDENCE_HEAD=$(git rev-parse HEAD)` in the Execution Ledger.

- [x] **Step 4: Run one FORMAL runner at frozen HEAD**

```powershell
$env:SURDET_CODE_EVIDENCE_HEAD = (git rev-parse HEAD)
node packages/cli/e2e/review-terminal-atomicity-gate.e2e.mjs --formal
```

Expected: all 15 milestones pass, artifact `runHead` equals the environment/HEAD, tracked code diff paths are empty, one terminal winner exists in each race, and all error/cleanup/lease channels are empty. Do not rerun a failed FORMAL without a new explicit recovery authorization.

- [x] **Step 5: Run workspace full gates**

```powershell
npm run test -w @surdet/authoring
npm run test -w @surdet/cli
npm run test -w surdet-editor
npm run typecheck -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run typecheck -w surdet-editor
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
npm run build -w surdet-editor
```

Run serially to avoid manufacturing capacity timeouts while still preserving default command behavior.

- [x] **Step 6: Run exactly one aggregate verification**

```powershell
npm run verify:all
```

If it fails, record the exact first failing node and stop. Do not rerun, change timeouts, or relabel the failure based on focused gates.

- [x] **Step 7: Verify final scope and documentation**

```powershell
npm run verify:docs
npm run verify:hygiene
git diff --check
git diff --cached --check
git status --short
git log --oneline --decorate -12
```

Record final commit identities, test counts, artifact path/bytes/SHA, ahead/behind, tracked/staging state, known gaps, and whether aggregate HEAD matches final code HEAD.

- [x] **Step 8: Create docs-only closeout**

Commit only this taskbook after final evidence:

```text
docs(authoring): close review terminal atomicity gate
```

Then append the reviewed outcome to the existing untracked long-term ledger without staging it.

- [ ] **Step 9: Stop without expanding scope**

Final state must include:

```text
REVIEW_TERMINAL_ATOMICITY_LOCAL_REVIEWED_CLOSURE = PASS or precise failure state
PUSH = NOT_PERFORMED
REMOTE_UBUNTU_CI = NOT_REVERIFIED
OWNER_REAL_CONCURRENCY_ACCEPTANCE = NOT_RUN unless actually performed
ASSET_CENTER = NOT_STARTED
FRONTEND_PASS_5 = NOT_STARTED
WAVE_7 = NOT_STARTED
```

### Task 8 FORMAL failure stop — 2026-09-01

- Task 8 exact finding commit: `6a7a868882e1fa123df989304424a725692d50f1` (`fix(authoring): harden review terminal closure`), parent `1410f72a616fc9eb7685f131069e1f7600d0d12f`, exact eight-path staged set, both diff checks exit `0`. This commit is the frozen `CODE_EVIDENCE_HEAD`; tracked worktree and staging were empty before FORMAL.
- The single FORMAL allowance was consumed exactly once and exited `1`. All 15 ordered milestones reported `PASSED`, including both Authority process races, idempotent retry, two-browser race, canonical reopen, valid V2 source change/capsule preservation, no extra terminal JSON, complete project/Starter preservation, and process/lease cleanup.
- FORMAL nevertheless failed at the post-milestone `evidence-contract` validation. The browser's two expected losing writes each returned the required `409 Conflict`, but Chromium also emitted one `Failed to load resource: the server responded with a status of 409 (Conflict)` console message per context. The Runner recorded both in `consoleErrors`; the global contract correctly refused to relabel a non-empty issue channel as success. This is confirmed as an evidence-classification failure after the intended 409 behavior, not a product-success claim and not evidence that the 409 itself was unexpected.
- Failure channels: `errors=1` (`evidence contains blocking issue channels`), `consoleErrors=2`; protocol, page, request, stderr, child cleanup, and active review lease channels were all `0`. `projectMutation=false`, `starterMutation=false`, `trackedCodeDiffPaths=[]`, `stagingPaths=[]`, and `runHead===CODE_EVIDENCE_HEAD`.
- Failure evidence: `C:\Users\Equinox\AppData\Local\Temp\surdet-review-terminal-atomicity-DhS8rh\formal\evidence.json`, 51367 bytes, SHA-256 `8FABA77D134A8CAD4D77F6535E2CA8C755B13D8C536A264B0734DB121E5C74D7`; identity sidecar 101 bytes, SHA-256 `47EA2D1D8EA8A55B14275F400D854B21287669D5FDAFCC706A4B651B4D89E873`. Artifact Runner SHA-256 is `D8128A09491C2D7E3B79C5CEA4AFC37F85BB062EACE2F22BC4AA9679A87C956E`.
- Per the one-run rule, no source/test repair, replacement FORMAL, workspace full gate, `verify:all`, closeout commit, push, deployment, Asset Center, Frontend Pass 5, or Wave 7 was started after this failure.

```text
REVIEW_TERMINAL_ATOMICITY_FORMAL = FAILED_AT_EVIDENCE_CONTRACT
FORMAL_MILESTONES = 15/15 PASSED
FORMAL_BUDGET = 1/1 CONSUMED
FIRST_FAILED_NODE = evidence-contract
FULL_GATES = NOT_RUN
VERIFY_ALL = NOT_RUN
PUSH = NOT_PERFORMED
ASSET_CENTER = NOT_STARTED
FRONTEND_PASS_5 = NOT_STARTED
WAVE_7 = NOT_STARTED
WAITING_FOR_NEW_MANAGER_AUTHORIZATION = YES
```

### REVIEW-TERMINAL-ATOMICITY-FORMAL-CONSOLE-409-RECOVERY-1

- Owner continuation authorization: on 2026-09-01 the owner explicitly authorized the General Manager to continue design, taskbook work, implementation, bounded Luna review, ledger closure, and ordinary push without further pauses except for a genuinely severe or destructive incident. This newer instruction authorizes this recovery, one replacement FORMAL, the already-planned serial full gates and single `verify:all` if FORMAL passes, docs/ledger closeout, and ordinary push after final review. It does not authorize force-push, history rewriting, destructive cleanup, deployment, Asset Center, Frontend Pass 5, or Wave 7.
- Recovery scope is exact: modify only this taskbook, `packages/cli/e2e/review-terminal-atomicity-gate.e2e.mjs`, and `packages/cli/test/review-terminal-atomicity-runner.test.mjs`. The original FORMAL remains `1/1 CONSUMED_AND_FAILED`; this recovery adds one replacement FORMAL and does not rewrite or replace the old artifact.
- Classification invariant: a browser console error may move out of the blocking channel only when it is the exact Chromium-native `409 (Conflict)` resource message and is bound one-to-one to a separately proved Authority rejection with the same page label, exact full strict-loopback URL, `POST`, status `409`, allowed route and allowed business code. The proof also requires an exact `{ ok, error }` failure envelope, bounded non-control-character message, exact write/describe request keys, and matching project/review/payload identity. Wrong status/code/route/label/text/origin/port/query, missing URL, script-generated messages, unproved responses, malformed request/envelope evidence, and duplicate events remain blocking. Request failures, protocol errors, page errors, stderr, cleanup failures, and lease failures are untouched.
- First recovery RED/GREEN: the focused Runner contract passed 10/11 and failed exactly because `classifyBrowserConsoleErrors` did not exist, then passed 11/11 after the strict one-to-one classifier and its negative controls were added. No production test or previous milestone regressed.
- Independent Luna finding and second RED: a read-only contract audit identified that the first implementation accepted a manually registered status/code tuple without proving the returned envelope and originating request identity. The strengthened contract passed 11/12 and failed exactly because `proveExpectedAuthorityRejection` did not exist.
- Final recovery implementation and GREEN: console events are retained structurally until the harness is closed. Expected rejection evidence is registered only through `proveExpectedAuthorityRejection()` after the real browser race or payload-identity negative control has returned its response. The pure classifier consumes each proven rejection at most once; all unmatched events populate the original blocking `consoleErrors` channel. Raw classification evidence is serialized in the final artifact. The Runner contract passed 12/12, including two positive controls and negative controls for malformed envelopes/messages/requests and for wrong status, code, route, response proof, script URL, console text, label, URL, query, port, HTTP error, and duplicate events. A real isolated Playwright probe on `127.0.0.1:4269` confirmed Chromium reports the native 409 console event with the exact rejected resource URL. The final read-only Luna audit found no concrete HIGH or BLOCKER.
- Post-recovery Runner identity before freeze: 70221 bytes, SHA-256 `6B9568D045BFEA51EC714D57BEF28E7AAD81B24936B6221BEF8D0295A7D23097`. No replacement FORMAL has run at this ledger point.

---

## Execution Ledger

Append-only. Record commands, exit codes, test counts, artifacts, failures, corrections, commit identities, review findings, and stop states. Never delete or rewrite a failed run as green.

- 2026-09-01 planning authorization: after the second repair gate local closure, the project owner explicitly approved a standalone third repair gate and selected the local “single stamp keeper” boundary. The owner then authorized the General Manager to finish the design/taskbook and proceed directly into implementation without another approval pause. This authorization excludes push, deployment, Asset Center, Frontend Pass 5, and Wave 7.
- Current confirmed defect: Editor terminal serialization is keyed to one in-memory workspace object; NodeReviewStore result serialization is keyed to one Node process; approval and return use separate files. Existing same-object/same-process tests cannot prove cross-window or cross-process uniqueness.
- Selected design: one local Node Review Authority, review-scoped cross-process lease, same-origin tokenized Editor transport, existing receipt files retained, static/no-authority Editor terminal actions read-only, and no Agent Port human-decision writer.
- Design document was initially committed as `4720e42` (`docs(authoring): specify review terminal atomicity`). Its first cached diff check reported trailing whitespace in the three metadata lines, but the PowerShell command sequence continued and committed. The correction is intentionally preserved as a follow-up taskbook/spec commit rather than amending history.
- Production implementation has not started at the time this taskbook is created.
- Task 0 implementation baseline: branch `main`, `HEAD=844a0ef431bf736d2a5993ff41c095088e47b0ca`, parent `4720e42d160ac60b0a32fd49a5fdd8cd91da2e64`, `surdet/main=bca72247d0dc76983330367be0f38043036a0fca`, ahead/behind `15/0`. Tracked worktree and staging were clean; only pre-existing untracked/protected paths, CLI historical artifacts, and the intentionally untracked long-term ledger remained. Both diff checks exited `0`.
- Task 0 source proof: Editor `withResultReceiptWrite()` is a `WeakMap` queue scoped to one `ReviewWorkspaceState`; Editor `writeCreateOnly()` performs get/create/write without exclusive creation. NodeReviewStore `withResultReceiptWrite()` is a process-local `Map`; result approval and return pre-check then create two distinct target files. No cross-window/cross-process authority existed at baseline.
- Task 0 approved path inventory is frozen to Tasks 1–7. Any scope change requires an append-only taskbook amendment before edit. No Core/Renderer/Host/Shell/Starter/Zero/protected/long-term-ledger path is authorized for production staging.
- Task 1 RED: the focused Authoring run exited `1` with 5 expected failures: both parsers were absent and `REVIEW_BUSY` was missing, while 6 existing error-contract tests remained green.
- Task 1 GREEN: `review-terminal.test.ts` + `error-catalog.test.ts` passed 11/11; Authoring typecheck and build exited `0`. The shared parser rejects extra/path fields, malformed payload identity, action/receipt mismatches, and inconsistent snapshot state. Capability-registry search returned no terminal human writer entry (expected no-match exit `1`).
- Task 1 taskbook correction: the illustrative approval command now contains the minimum action-specific receipt identity required by the approved strict parser, and the source/catalog names were corrected to the actual repository symbols. This is a documentation correction, not a contract expansion.
- Task 1 exact commit: `2098836` (`feat(authoring): define review terminal contract`), six-path staged set, both diff checks exit `0`.
- Task 2 RED: the existing lease suite ran 16 tests with 14 passing and 2 expected failures. Review scope incorrectly landed in `.locks/projects`, and the simulated review publication window therefore did not contend with the real review path.
- Task 2 GREEN: the same suite passed 16/16 and CLI typecheck exited `0`. Review scope now shares the proven heartbeat/drain, stale takeover, sentinel-preserving release, publication wait, corruption, inspection, and busy-envelope state machine while mapping contention to `REVIEW_BUSY`; change/project mappings remain unchanged.
- Task 2 exact commit: `22259d4` (`feat(cli): lease review terminal writes`), three-path staged set, both diff checks exit `0`.
- Task 3 worker prerequisite: CLI `dist` was refreshed before each plain-Node worker phase so the child processes exercised the current source. The taskbook command order was corrected accordingly; build output was not treated as proof by itself.
- Task 3 RED: the initial 19-test store run had 3 failures (old `REVIEW_IDENTITY_MISMATCH` terminal mapping); the strengthened 20-test run had 4 failures and deterministically proved independent workers ignored a separately held review lease. Existing identical cross-process file creation happened to be idempotent, but there was no shared lease authority.
- Task 3 first GREEN attempt correctly produced `REVIEW_BUSY` for concurrent losers, exposing an over-constrained test assumption that the lease would silently queue. The approved error contract is fail-fast: refresh and retry the same command. Tests were corrected without adding a hidden queue.
- Task 3 final GREEN: NodeReviewStore 20/20, adjacent ReviewService + lease suite 24/24, combined 44/44, CLI typecheck and build all exited `0`. Concurrent approval/return leaves exactly one receipt; different decisions preserve one winner; an identical retry after refresh returns the existing byte identity; review identity/payload bytes remain unchanged; active review locks drain to zero.
- Task 3 exact commit: `423b5d1` (`fix(cli): serialize review terminal receipts`), four-path staged set, both diff checks exit `0`.
- Task 4 pre-implementation correction: authority business validation and create-only persistence need the same review lease. Task 4 now includes `NodeReviewStore` source/test so one lease-bound `writeTerminal()` can run the validator against the freshly re-read workspace before the existing exact terminal mapping. This prevents TOCTOU without nesting the same lease or creating a second mutex.
- Task 4 combined-gate observation: 33/34 tests passed; one independent approval/return race returned `LEASE_CORRUPT` instead of `REVIEW_BUSY`. A focused rerun passed, but source inspection confirmed a real race: `loadLeaseAwaitingPublication()` keeps polling after the lock directory has been normally removed. The scope is amended before editing the lease files; no timeout or corruption rule is relaxed.
- Task 4 lease RED/GREEN: the deterministic release-before-read case failed with `LEASE_CORRUPT`, then passed after `loadLeaseAwaitingPublication()` began returning “retry acquisition” only when the lock directory itself is absent. The full lease suite passed 17/17; persistent missing/malformed lease evidence remains fail-loud.
- Task 4 authority RED: focused execution exited `1` before collection because `review-terminal-authority.js` did not exist. No existing test failed in that run.
- Task 4 GREEN: authority 5/5, NodeReviewStore 21/21, ReviewService 9/9, lease 17/17 (52/52 total), CLI typecheck and build all exited `0`. The authority rejects path-like namespaces and payload mismatch, recomputes all three receipt fingerprints through shared Authoring validators, runs validation inside the same review lease as create-only persistence, reports malformed/multiple terminal records as corrupt, and leaves immutable review evidence unchanged.
- Task 4 exact commit: `8c7b1ac` (`feat(cli): add local review terminal authority`), nine-path staged set, both diff checks exit `0`.
- Independent Luna audit was read-only. Accepted findings for Task 4A: enforce authority/lease-root equality, reject runtime-unknown store actions, strengthen projection runtime shape, classify a single corrupt receipt, correct `REVIEW_BUSY` non-terminal metadata, and tighten worker harness cleanup/types. HTTP detail redaction remains a mandatory Task 5 gate.
- Local-adversary finding is bounded honestly: arbitrary same-account filesystem writers are outside this authority's enforceable threat model and can directly alter receipts regardless of API checks. Static symlink/path escape remains rejected; the project will not claim that repeated path checks provide native handle-level isolation.
- Task 4A RED: Authoring catalog 6/7 and CLI 34/39 passed. Exact failures proved the `REVIEW_BUSY` terminal-flag contradiction, lease-root mismatch acceptance, unknown-action-to-return fallthrough, incomplete projection acceptance, and malformed single-receipt exception leakage.
- Task 4A GREEN: Authoring error catalog 7/7; CLI authority/store/service/lease 56/56; Authoring and CLI typechecks/builds all exited `0`. Root binding is exact (case-folded on Windows), store actions use an exhaustive runtime guard, projection collections/final-result identity are checked before validators, malformed single terminals become `corrupt`, and timed-out child workers are killed and reaped before rejection.
- Task 4A exact commit: `be1500e` (`fix(cli): harden review authority boundary`), nine-path staged set, both diff checks exit `0`.
- Task 5 RED: CLI HTTP test could not load the absent handler; Editor boundary had 1/2 pass and failed because Vite had no authority plugin. Browser sources were already free of Node/CLI imports.
- Task 5 independent audits were read-only. HTTP findings accepted: trusted loopback Origin list derived from the socket rather than request Host, fixed body cap, chunked overflow/timeout, close-on-reject, listener cleanup, safe error-code whitelist, and serialization fallback. Vite findings accepted: preview needs a pre-static `dist/index.html` interceptor because it does not call `transformIndexHtml`; build transform has an explicit no-server guard; Node imports remain tooling-only.
- Task 5 GREEN: HTTP 13/13, Editor boundary 2/2, CLI and Editor typechecks/builds exited `0`. A real `vite preview` on `127.0.0.1:4185` produced exactly one main-page marker, zero preview-page markers, a fresh 43-character token, and status `{ protocolVersion: '1.0.0', status: 'available' }`; the service was stopped afterward. Fresh static build output contained no authority marker, global config name, or test token.
- Task 6 RED: the focused Editor command exited `1`. The browser client module was absent, the source boundary still found `writeCreateOnly` beside terminal filenames, and workspace/panel tests proved that authority-unavailable read-only state and disabled controls did not exist. The other collected tests remained green; this RED was not treated as a product-complete result.
- Task 6 implementation: the browser client accepts only the injected relative endpoint/token contract, applies a bounded abort timeout, parses exact envelopes and shared terminal snapshots, and resolves an uncertain write only through `describe()` of the same immutable review identity. `review-workspace.ts` retains local evidence reading but contains no terminal-file creation path; it reconciles local and canonical receipt identities, treats mismatch/corrupt as readable locked states, and updates success state only from the authority snapshot. Comparison and result actions both use immediate in-flight guards.
- Task 6 bounded Luna work was disjoint: one worker owned only the new browser client; one worker owned only the workspace fake-authority test migration. The manager integrated and reread both, added canonical-corrupt and result repeated-click coverage, and retained final verification responsibility.
- Task 6 GREEN: the focused client/workspace/panel/boundary group passed 51/51; the complete Editor suite passed 460/460; Editor typecheck and build exited `0`. The production build emitted only the existing chunk-size advisory. Static source search found terminal filenames only in read paths, with no `writeCreateOnly` or terminal `createWritable()` path.
- Task 6 pre-commit independent audit was read-only and found three real closure gaps: result retry could mint a new command after an uncertain response, result preview could start while approval was in flight, and the Editor did not verify canonical record bytes/SHA. The permanent recovery RED passed 42/46 and failed exactly those four assertions (three workspace contracts plus preview locking); no unrelated test failed.
- Task 6 audit GREEN: pending terminal commands now retain the exact request ID, receipt ID, timestamp, fingerprint, and payload until the outcome is known; an opposite terminal action is blocked while that command is unresolved. Result preview/reload/exploration checks are disabled during in-flight or uncertain approval, and approval rechecks fixture identity before submission. Canonical records are serialized using the Node record contract (`JSON.stringify(..., null, 2)` plus LF) and their bytes/SHA are verified before use. The fake authority now uses the same serialization.
- Task 6 final gates: focused client/workspace/panel/boundary passed 55/55; complete Editor passed 465/465; typecheck and build exited `0`. User-facing terminal errors use fixed Chinese messages and do not surface raw transport text. The boundary test now rejects any browser `createWritable()`, terminal `{ create: true }`, or missing authority write path.
- Task 6 final manager hardening: an unresolved command is also retained for malformed/unknown transport responses classified unavailable; result preview and terminal writes are mutually exclusive in both directions, including reload and fixture-refresh controls. The final focused set passed 56/56, the final complete Editor suite passed 466/466, and fresh typecheck/build exited `0`; the build retained only the pre-existing chunk-size advisory.
- Task 6 exact commit: `18c564e` (`feat(editor): connect local review authority`), eight-path staged set, both diff checks exited `0`; no unrelated untracked path was staged.
- Task 7 RED handoff record: the delegated runner worker had already consumed the single missing-runner/import RED before the manager resumed the task. The resumed context did not retain a standalone raw RED log, so the manager did not rerun or replace that failure.
- Task 7 contract hardening: the first contract draft froze the correct mode and milestone names but relied too heavily on source keywords. Two bounded read-only Luna audits identified fake-green gaps around FORMAL identity, bytes/SHA, error channels, process/context counts, Agent writer absence, mutation evidence, Vite lifecycle, and winner-to-disk binding. The manager replaced those with executable pure-contract checks and real runtime evidence assertions before consuming preflight.
- Task 7 GREEN correction: the first post-runner command exposed that `node:test` failures were printed but ignored by the Vitest workspace command. The contract was migrated to Vitest, the expected failure assertion was corrected, and the final runner contract passed 8/8 with `node --check` exit `0`. This correction occurred before preflight and did not weaken any product assertion.
- Task 7 runner implementation: the fixed runner supports only `--preflight` and `--formal`; scans strict `127.0.0.1` ports 4260–4269 while forbidding 4173/4175; creates an exclusive temp artifact; binds the Vite authority to the isolated data root; uses real Node workers and independent browser contexts; compares winner receipt bytes/SHA/content to disk; verifies immutable review payload and identity sidecars, project tree, complete Starter tree, process/lease cleanup, static read-only behavior, token/origin/payload rejection, and an empty Agent writer capability set. Setup, milestone, validation, stderr, protocol, and child-exit failures all remain artifact-producing failure paths.
- Task 7 prerequisite builds: Authoring build, CLI build, and Editor build exited `0`. Editor emitted only the existing chunk-size advisory.
- Task 7 unique preflight: exactly one `--preflight` run exited `0` with `status=PASSED`. It used ports `4260,4261`, two real probe workers, two browser contexts, zero terminal files, `agentWriterCapabilities=[]`, `projectMutation=false`, `starterMutation=false`, and eight empty error/cleanup/lease channels. Evidence: `C:\Users\Equinox\AppData\Local\Temp\surdet-review-terminal-atomicity-GQAmGz\preflight\evidence.json`, 2487 bytes, SHA-256 `4471016EDCCF47856CC3B2D8445227C45F3A3603EEE606AE0FAB5E77AE2143E8`; identity sidecar 100 bytes, SHA-256 `3DD6C3C4E344883A0C328E3EC6A167DA678F615EE1E6DC5961997DB9B527081E`. The runner SHA recorded by the artifact is `1DA79F0CAAFCC07DC35A1CC36C03B769699BAD834503C1CC28A81850B89C677F` at `runHead=18c564e3a75e1fe8fd696d201791404e02ae257e`.
- Task 8 initial focused suites passed: Authoring 32/32, CLI 77/77, and Editor 56/56. Three bounded read-only Luna reviews then examined backend/security, Editor/browser behavior, and Runner/evidence coverage; the manager retained implementation and final gate ownership.
- Task 8 independent-review correction: the earlier Task 6 Ledger statement that reload and fixture-refresh were already mutually exclusive in both directions was too strong. Source review proved those handlers disabled competing operations only when another operation started first; starting reload/refresh first left approval, return, and preview reachable. The corrected permanent Editor RED passed 48/51 and failed exactly the two reverse-operation cases plus one live-disk approval freshness case.
- Task 8 Editor finding GREEN: one workspace-scoped fixture-operation lock now guards preview, approval, return, restore, and refresh in both handler guards and disabled state. Sync throws and async rejections release the lock before rerender. Approval with a real project handle re-reads the result tree immediately before authority submission and rejects unreadable or changed evidence with `REVIEW_APPROVAL_STALE`. The focused Editor pair passed 51/51; the final four-file Editor gate passed 59/59; typecheck and build exited `0`, with only the existing chunk-size advisory.
- Task 8 Runner finding RED: the first strengthened contract passed 7/9 and failed because independent workers and idempotent retry still bypassed `ReviewTerminalAuthority`, and because no real source evidence baseline existed. A second exact RED also passed 7/9 and proved that a synthetic three-file canary and canonical-file-only checks could not establish a valid V2 change/capsule or reject an extra `terminal.json`.
- Task 8 Runner finding GREEN: both Node races now submit full immutable commands through independent `ReviewTerminalAuthority` instances; identical retry also traverses Authority and binds the returned canonical record to disk bytes/SHA. Fixture setup uses `NodeChangeStore.forProject()` plus `beginChange()` to create a valid V2 integration change, then `writeCapsulePayload()` under the real change lease to create payload and identity sidecar. Its complete tree identity is equal before/after. Review-root top-level JSON uses an explicit allowlist, so `terminal.json` or any other extra JSON is blocking. The executable contract passed 10/10 and the final six-file CLI gate passed 79/79; CLI typecheck/build and both Runner/worker syntax checks exited `0`.
- Task 8 final focused rerun passed Authoring 32/32, CLI 79/79, and Editor 59/59. All three post-fix Luna reviews reported no remaining concrete `HIGH` or `BLOCKER`. The known non-blocking boundary is explicit: Editor fixture-operation locks are scoped to one workspace object, while approval freshness is re-read from disk; this gate does not claim a cross-browser project-file transaction lock.
- Task 8 evidence identity boundary: the Task 7 preflight artifact remains preserved and valid for its recorded old Runner SHA only. It is not evidence for the reviewed Runner now at 63114 bytes / SHA-256 `D8128A09491C2D7E3B79C5CEA4AFC37F85BB062EACE2F22BC4AA9679A87C956E`. No replacement preflight was run. The current Runner must be proved by the single frozen-HEAD FORMAL; FORMAL remains unconsumed at this point.

```text
REVIEW_TERMINAL_ATOMICITY_DESIGN = APPROVED
REVIEW_TERMINAL_ATOMICITY_TASKBOOK = IN_PROGRESS
PRODUCTION = NOT_STARTED
PUSH = NOT_AUTHORIZED
ASSET_CENTER = NOT_STARTED
FRONTEND_PASS_5 = NOT_STARTED
WAVE_7 = NOT_STARTED
```

- Task 8 first FORMAL ran exactly once at `CODE_EVIDENCE_HEAD=6a7a868882e1fa123df989304424a725692d50f1`. All 15/15 milestones passed, but the aggregate evidence contract failed because Chromium emitted two native resource-console messages for two intentionally exercised Authority `409` responses. The old FORMAL remains `1/1 CONSUMED_AND_FAILED`; its evidence and identity sidecar are preserved at the identities recorded above. No full gate or `verify:all` followed that failure.
- Owner continuation authorization superseding the earlier no-push stop: the owner authorized continued design, implementation, bounded Luna review, ledger closure, ordinary push, and completion without another routine approval pause. This does not authorize force-push, history rewriting, destructive cleanup, deployment, Asset Center, Frontend Pass 5, or Wave 7.
- Recovery-1 first RED/GREEN: the Runner contract moved from 10/11 (missing strict console classifier) to 11/11. A real isolated Playwright probe confirmed that Chromium locates the native 409 console event at the exact rejected Authority resource URL.
- Recovery-1 independent audit correction: a bounded read-only Luna audit found that status/code registration alone did not prove the returned envelope and originating request. The second RED passed 11/12 and failed on the missing proof helper; the final implementation accepts only an exact, identity-bound Authority request/response proof and then passed 12/12.
- Recovery-1 final read-only Luna audit found no concrete HIGH or BLOCKER. The pre-freeze Runner is 70221 bytes with SHA-256 `6B9568D045BFEA51EC714D57BEF28E7AAD81B24936B6221BEF8D0295A7D23097`. The original FORMAL artifact is not reused or rewritten; one replacement FORMAL remains authorized but unconsumed at this ledger point.

```text
REVIEW_TERMINAL_ATOMICITY_FORMAL = 1/1 CONSUMED_AND_FAILED
RECOVERY_1_RUNNER_CONTRACT = 12/12 PASSED
RECOVERY_1_LUNA_FINAL_AUDIT = NO_HIGH_OR_BLOCKER
REPLACEMENT_FORMAL = AUTHORIZED_NOT_RUN
FULL_GATES = NOT_RUN
VERIFY_ALL = NOT_RUN
PUSH = AUTHORIZED_NOT_PERFORMED
ASSET_CENTER = NOT_STARTED
FRONTEND_PASS_5 = NOT_STARTED
WAVE_7 = NOT_STARTED
```

### REVIEW-TERMINAL-ATOMICITY-CLI-FULL-CAPACITY-RECOVERY-2

- Replacement FORMAL ran exactly once at `CODE_EVIDENCE_HEAD=31042cb61f77dcdb20eed96a9f6ece9e9207aaf0` and passed 15/15. Evidence: `C:\Users\Equinox\AppData\Local\Temp\surdet-review-terminal-atomicity-1liM5V\formal\evidence.json`, 55857 bytes, SHA-256 `10978C4F66F946E443E02800E992E10D94B1BE698CBCB164B826AD039088FB69`; identity sidecar 101 bytes, SHA-256 `A1C73688D7C0E9B66E745CEFDA6B72DC41FDA01E34F10A534B030360D78E56D7`. `runHead===CODE_EVIDENCE_HEAD`, Runner SHA-256 is `6B9568D045BFEA51EC714D57BEF28E7AAD81B24936B6221BEF8D0295A7D23097`, all issue/cleanup/lease channels are empty, two expected native 409 console events are classified with zero blocking console events, and project/Starter mutation are false.
- Post-FORMAL Authoring full gate passed 31/31 files and 266/266 tests. The default CLI full gate then failed: 25/39 files and 303/319 tests passed; 14 files and 16 tests failed. Thirteen failures were the existing 5-second or 15-second per-test timeout under default file parallelism. The three remaining observations were `LEASE_CORRUPT` during an in-process review lease race, one missing orphan record, and one missing change lookup; because they occurred alongside timeouts and timed-out async work, their independence from timeout cleanup is not yet proved.
- Failure discipline: the CLI result remains failed. Editor full tests, workspace typechecks/builds, the single `verify:all`, closeout, and push did not run after this failure. The default CLI command did not persist a standalone log artifact, so its full console summary and counts are recorded here without inventing a path or hash.
- Owner continuation authority permits a bounded recovery rather than a routine approval stop. Recovery-2 first allows one read-only, strictly serial CLI diagnostic (`--no-file-parallelism --maxWorkers=1`) with a fresh preserved log. It must not relax timeouts. If the three non-timeout signatures persist, establish a focused deterministic RED before production repair. If the serial diagnostic is fully green, separately review whether the CLI workspace's I/O-heavy suite needs a bounded default worker policy; do not silently rewrite the failed default-parallel fact.

```text
REPLACEMENT_FORMAL = 15/15 PASSED
AUTHORING_FULL = 31/31 FILES; 266/266 TESTS PASSED
CLI_FULL_DEFAULT = FAILED; 25/39 FILES; 303/319 TESTS PASSED
CLI_FULL_SERIAL_DIAGNOSTIC = AUTHORIZED 1/1; NOT_RUN
EDITOR_FULL = NOT_RUN
WORKSPACE_TYPECHECK_BUILD = NOT_RUN
VERIFY_ALL = NOT_RUN
PUSH = AUTHORIZED_NOT_PERFORMED
ASSET_CENTER = NOT_STARTED
FRONTEND_PASS_5 = NOT_STARTED
WAVE_7 = NOT_STARTED
```

- Recovery-2 serial diagnostic ran exactly once and passed 39/39 files and 319/319 tests without changing any timeout. Preserved log: `C:\Users\Equinox\AppData\Local\Temp\surdet-review-terminal-atomicity-recovery2-8f51777b1aae494e8ed220de8d34150a\cli-full-serial-diagnostic.log`, 15404 bytes, SHA-256 `6ADF6BF0548509E9F252F32493E396F17A07DA6026863DB047039BFAD1EAB051`. The three non-timeout signatures from the default-parallel run did not recur. This supports a capacity/timeout-cleanup classification but does not erase the failed default-parallel result or prove one unique causal mechanism.
- Manager decision for the separate test-capacity boundary: the CLI suite already contains explicit in-process and cross-process concurrency tests; file-level parallelism adds machine contention but is not the product concurrency oracle. Do not increase timeouts and do not change production code. Freeze the default CLI test command to one file worker using Vitest's supported `--no-file-parallelism --maxWorkers=1` flags.
- Recovery-2 scope extension is exact: this taskbook, `packages/cli/package.json`, and `scripts/test/verify-all.test.mjs`. First add a permanent policy contract and observe it RED against the current package script; then make the one-line package-script change, run the policy GREEN, and run the default CLI full command exactly once as the replacement full gate. Because the frozen HEAD changes, a later FORMAL must use a fresh HEAD and a newly authorized single run; the prior PASSED FORMAL remains valid only for `31042cb`.

```text
CLI_FULL_SERIAL_DIAGNOSTIC = 39/39 FILES; 319/319 TESTS PASSED
CLI_TEST_CAPACITY_CONTRACT = RED_NOT_RUN
CLI_DEFAULT_CAPACITY_FIX = NOT_IMPLEMENTED
REPLACEMENT_CLI_FULL = NOT_RUN
NEW_CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
NEW_FORMAL = NOT_RUN
VERIFY_ALL = NOT_RUN
PUSH = AUTHORIZED_NOT_PERFORMED
```

- CLI capacity contract RED passed 2/3 and failed exactly because the current `@surdet/cli` test script lacked `--no-file-parallelism`; it did not execute the CLI suite or modify product code. The one-line script change added `--no-file-parallelism --maxWorkers=1` without changing any test timeout. The same permanent policy contract then passed 3/3.
- The replacement default command `npm run test -w @surdet/cli` ran exactly once after the script change and passed 39/39 files and 319/319 tests. Preserved log: `C:\Users\Equinox\AppData\Local\Temp\surdet-review-terminal-atomicity-cli-green-51856ae7b2c64aa5bf514df355b26eeb\cli-full-default-replacement.log`, 15515 bytes, SHA-256 `0052C8D904781BC88B789FF82F7D0C894119E301BA559B767C1FDFC59629E1EE`. The previously observed timeout, missing-record/change, and lease-corrupt signatures did not recur.
- Recovery-2 changed no production source and preserved the original default-parallel failure as a separate failed fact. Before aggregate verification, freeze the exact three-path recovery (`packages/cli/package.json`, `scripts/test/verify-all.test.mjs`, this taskbook), establish a new code evidence HEAD, and run one fresh FORMAL at that HEAD. Do not reuse the FORMAL from `31042cb` as proof for the changed test policy.

```text
CLI_TEST_CAPACITY_CONTRACT = RED 2/3; GREEN 3/3
CLI_DEFAULT_CAPACITY_FIX = ONE_FILE_WORKER; NO_TIMEOUT_CHANGE
REPLACEMENT_CLI_FULL = 39/39 FILES; 319/319 TESTS PASSED
NEW_CODE_EVIDENCE_HEAD = NOT_ESTABLISHED
NEW_FORMAL = AUTHORIZED 1/1; NOT_RUN
VERIFY_ALL = NOT_RUN
PUSH = AUTHORIZED_NOT_PERFORMED
```

- Recovery-2 final bounded Luna reviews were read-only and found no HIGH or BLOCKER. They confirmed that file-level serialization does not remove the suite's explicit `Promise.all`, child-process, and lease concurrency contracts; the three-path tracked scope and all recorded evidence identities are exact. The remaining boundary is explicit: the default CLI suite is now a correctness gate, not an ambient machine-pressure benchmark.

### Final reviewed local closure — 2026-09-01

- Final code evidence HEAD is `1fe0abda714fd5f3888ddcc0cd4628a15dbbc90c`, parent `31042cb61f77dcdb20eed96a9f6ece9e9207aaf0`, commit `test(cli): bound workspace file parallelism`. Its exact three-path scope is this taskbook, `packages/cli/package.json`, and `scripts/test/verify-all.test.mjs`; no production source or timeout changed.
- The fresh single FORMAL at that HEAD passed 15/15 without rerun. Evidence: `C:\Users\Equinox\AppData\Local\Temp\surdet-review-terminal-atomicity-u9S0Ug\formal\evidence.json`, 55845 bytes, SHA-256 `44610BA5C67B47164AD5139A31DCCF960490562AE3E70702D0DF4E772126B8D4`; identity sidecar 101 bytes, SHA-256 `1B7A86273A1D04D3FD5F59BCB093F828E9E695A258C59295941C31AEAC99F365`. `runHead===CODE_EVIDENCE_HEAD`, Runner SHA-256 is `6B9568D045BFEA51EC714D57BEF28E7AAD81B24936B6221BEF8D0295A7D23097`, all 15 milestones passed, the two expected native 409 messages had exact proofs, every blocking/error/cleanup/lease channel was empty, and project/Starter mutation were false.
- Frozen-HEAD workspace full gates passed: Authoring 31/31 files and 266/266 tests; CLI 39/39 files and 319/319 tests; Editor 57/57 files and 469/469 tests. Authoring, CLI, and Editor typechecks and builds passed. Editor build emitted only the existing chunk-size advisory.
- The single aggregate `npm run verify:all` ran once and passed. Preserved log: `C:\Users\Equinox\AppData\Local\Temp\surdet-review-terminal-atomicity-verify-all-f9be448a753742da945d8b07e8002e7c\verify-all.log`, 72524 bytes, SHA-256 `353C14A84C22A3F48BB9151D16B72DD189D6C7346C25564A31732F249C1B729B`. Starter simulation explored 259 paths, covered 23/23 choice branches, performed 367 save/load round trips, reached all three endings, and reported zero runtime errors. Existing content warnings and bundle-size advisories remain non-blocking and are not relabelled as fixes.
- Final documentation and hygiene gates passed: `verify:docs` exit `0`; tracked hygiene passed for 845 paths; both diff checks exited `0`. Before this docs-only closeout, the tracked worktree and staging were empty; pre-existing protected and unrelated untracked paths, the long-term ledger, and historical CLI artifacts remained unstaged.
- The original failed FORMAL and original default-parallel CLI failure remain preserved as failed historical facts. The later strict response proof, serialized CLI correctness gate, two fresh passing FORMAL artifacts, replacement/full workspace gates, and aggregate verification are additive recovery evidence; they do not overwrite the failures.
- Final bounded Luna reviews found no HIGH or BLOCKER in the response-proof recovery or CLI capacity policy. Remote Ubuntu CI, deployment, owner manual real-concurrency acceptance, Asset Center, Frontend Pass 5, and Wave 7 were not run in this gate.

```text
REVIEW_TERMINAL_ATOMICITY_LOCAL_REVIEWED_CLOSURE = PASS
CODE_EVIDENCE_HEAD = 1fe0abda714fd5f3888ddcc0cd4628a15dbbc90c
FINAL_FORMAL = 15/15 PASSED
AUTHORING_FULL = 31/31 FILES; 266/266 TESTS PASSED
CLI_FULL = 39/39 FILES; 319/319 TESTS PASSED
EDITOR_FULL = 57/57 FILES; 469/469 TESTS PASSED
VERIFY_ALL = 1/1 PASSED
VERIFY_DOCS = PASSED
VERIFY_HYGIENE = PASSED
PUSH = AUTHORIZED_PENDING_DOCS_CLOSEOUT
DEPLOYMENT = NOT_PERFORMED
ASSET_CENTER = NOT_STARTED
FRONTEND_PASS_5 = NOT_STARTED
WAVE_7 = NOT_STARTED
```
