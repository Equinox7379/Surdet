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

**Interfaces:**
- Consumes: injected authority token/endpoint, shared command/snapshot types, existing receipt builders/fingerprints, and review workspace identity.
- Produces: bounded `ReviewTerminalClient`, authority status in workspace state, read-only fallback, and authority-backed decision/approval/return functions.

- [ ] **Step 1: Write client RED tests**

Test exact status/describe/write requests, token header, bounded timeout, strict response parsing, and uncertain-response resolution:

```ts
await expect(client.write(command)).rejects.toMatchObject({
  code: 'REVIEW_AUTHORITY_UNAVAILABLE',
});
expect(fetchCalls).toHaveLength(1);
```

For a timeout after server commit, `describe()` returns the persisted exact receipt and the client does not mint a new request ID or receipt.

- [ ] **Step 2: Write workspace and panel RED tests**

Freeze:

- opening checks authority after local identity/payload validation;
- unavailable/mismatch/corrupt states keep readable projection and disable terminal actions;
- success state is updated only from authority snapshot;
- double click/repeated Enter produces one in-flight command;
- reopened canonical receipt is read-only;
- no `writeCreateOnly(...decision/final-approval/return-request...)` remains;
- visible status copy is the approved Chinese text.

- [ ] **Step 3: Run Task 6 RED once**

```powershell
npm run test -w surdet-editor -- --run test/review-terminal-client.test.ts test/review-workspace.test.ts test/review-panel.test.ts
```

Expected: client/status hooks absent and old direct writes violate assertions.

- [ ] **Step 4: Implement strict browser client**

The client reads one injected configuration, sends same-origin relative requests, applies an `AbortController` timeout, and parses only shared snapshots/errors. It exposes no data-root or path option.

- [ ] **Step 5: Replace direct workspace writes**

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

- [ ] **Step 6: Implement Chinese authority states in the panel**

Disable actions during checking/submitting or when state is unavailable/mismatch/corrupt/terminal. Do not hide review evidence. Existing technical details may display structured codes only after expansion.

- [ ] **Step 7: Run Task 6 GREEN and full Editor adjacency**

```powershell
npm run test -w surdet-editor -- --run test/review-terminal-client.test.ts test/review-workspace.test.ts test/review-panel.test.ts test/review-authority-boundary.test.ts
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

- [ ] **Step 8: Commit Task 6 exactly**

Stage six Task 6 paths plus taskbook and commit:

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

- [ ] **Step 1: Write runner contract RED tests**

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

- [ ] **Step 2: Run runner RED once**

```powershell
npm run test -w @surdet/cli -- --run test/review-terminal-atomicity-runner.test.mjs
```

Expected: missing runner/import failures.

- [ ] **Step 3: Implement fixed milestones**

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

- [ ] **Step 4: Run runner contract GREEN**

```powershell
node --check packages/cli/e2e/review-terminal-atomicity-gate.e2e.mjs
npm run test -w @surdet/cli -- --run test/review-terminal-atomicity-runner.test.mjs
```

- [ ] **Step 5: Run one preflight**

Build Authoring, CLI, and Editor first, then:

```powershell
node packages/cli/e2e/review-terminal-atomicity-gate.e2e.mjs --preflight
```

Expected: endpoint identity, token rejection controls, fixture identity, two process workers, browser availability, and cleanup all pass without terminal mutation.

- [ ] **Step 6: Commit runner and contract**

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

- [ ] **Step 1: Run all focused suites before secondary review**

```powershell
npm run test -w @surdet/authoring -- --run test/review-terminal.test.ts test/error-catalog.test.ts test/review-receipts.test.ts
npm run test -w @surdet/cli -- --run test/node-local-lease.test.ts test/node-review-store.test.ts test/review-service.test.ts test/review-terminal-authority.test.ts test/review-authority-http.test.ts test/review-terminal-atomicity-runner.test.mjs
npm run test -w surdet-editor -- --run test/review-terminal-client.test.ts test/review-workspace.test.ts test/review-panel.test.ts test/review-authority-boundary.test.ts
```

- [ ] **Step 2: Perform pre-aggregate manager and bounded secondary review**

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

- [ ] **Step 3: Freeze CODE_EVIDENCE_HEAD**

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

- [ ] **Step 4: Run one FORMAL runner at frozen HEAD**

```powershell
$env:SURDET_CODE_EVIDENCE_HEAD = (git rev-parse HEAD)
node packages/cli/e2e/review-terminal-atomicity-gate.e2e.mjs --formal
```

Expected: all 15 milestones pass, artifact `runHead` equals the environment/HEAD, tracked code diff paths are empty, one terminal winner exists in each race, and all error/cleanup/lease channels are empty. Do not rerun a failed FORMAL without a new explicit recovery authorization.

- [ ] **Step 5: Run workspace full gates**

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

- [ ] **Step 6: Run exactly one aggregate verification**

```powershell
npm run verify:all
```

If it fails, record the exact first failing node and stop. Do not rerun, change timeouts, or relabel the failure based on focused gates.

- [ ] **Step 7: Verify final scope and documentation**

```powershell
npm run verify:docs
npm run verify:hygiene
git diff --check
git diff --cached --check
git status --short
git log --oneline --decorate -12
```

Record final commit identities, test counts, artifact path/bytes/SHA, ahead/behind, tracked/staging state, known gaps, and whether aggregate HEAD matches final code HEAD.

- [ ] **Step 8: Create docs-only closeout**

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

```text
REVIEW_TERMINAL_ATOMICITY_DESIGN = APPROVED
REVIEW_TERMINAL_ATOMICITY_TASKBOOK = IN_PROGRESS
PRODUCTION = NOT_STARTED
PUSH = NOT_AUTHORIZED
ASSET_CENTER = NOT_STARTED
FRONTEND_PASS_5 = NOT_STARTED
WAVE_7 = NOT_STARTED
```
