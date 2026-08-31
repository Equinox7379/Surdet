# Review Terminal Atomicity Design

**Date:** 2026-09-01
**Gate:** `REVIEW_TERMINAL_ATOMICITY`
**Status:** Owner-approved design; implementation not started
**Predecessor:** `TIMELINE_AUTOSAVE_IDENTITY_FAIL_CLOSED_LOCAL_REVIEWED_CLOSURE`

## 1. Decision summary

Surdet review terminal writes will move from direct browser file writes to one local Node authority. The Editor remains the human decision surface, but it will no longer create `decision.json`, `final-approval.json`, or `return-request.json` through the File System Access API.

Every comparison decision, result approval, and result return will be submitted to a same-origin local Review Authority. The authority resolves the canonical review workspace from the configured Agent data root, verifies the immutable review identity and receipt through shared Authoring contracts, acquires one review-scoped cross-process lease, re-reads terminal state under that lease, and performs the existing create-only record write.

The current three receipt file formats remain canonical. This gate does not add `terminal.json`, migrate existing workspaces, expose a human-decision capability to Agent Port, or embed a model in the Editor.

If the local authority is absent, unreachable, or bound to a different data root, the Editor remains able to open and inspect a review workspace but terminal actions become read-only. It must never fall back to direct browser writes.

## 2. Confirmed current defect

The existing implementation has two process-local serializers:

- `packages/editor/src/review-workspace.ts` serializes result writes in a `WeakMap<ReviewWorkspaceState, Promise<unknown>>`. This protects one in-memory workspace object only. Another browser tab, another Editor server, or another process has a different map.
- `packages/cli/src/authoring/node-review-store.ts` serializes result writes in a process-local `Map<string, Promise<unknown>>`. This protects one Node process only.

The Editor then writes directly through `FileSystemDirectoryHandle`. Its create-check-write sequence is not an exclusive filesystem create. Two Editor instances can both observe no file and write different bytes.

`NodeReviewStore.createFinalApproval()` and `createReturnRequest()` use different target files. Across Node processes, both can pass the pre-check and atomically create their own file, leaving one result review with both terminal outcomes.

Current tests prove same-object or same-process serialization. They do not prove cross-window, cross-Editor-server, or cross-Node-process uniqueness.

## 3. Goals

1. At most one terminal outcome may be created for one result review across all local Editor windows and Node processes.
2. One comparison review may have at most one immutable `decision.json`; retries with identical bytes are idempotent, while different bytes fail loud.
3. All terminal writes use one Node authority and one shared filesystem lease protocol.
4. Receipt validation stays in shared Authoring/ReviewService logic; HTTP and Editor layers remain adapters.
5. Existing receipt filenames, schemas, fingerprints, review payloads, and downstream approval/return gates remain compatible.
6. The Editor gives a Chinese, honest, non-technical state when the authority is connected, busy, already decided, mismatched, or unavailable.
7. Project files, change records, integration working trees, source capsules, and review payloads remain immutable during terminal receipt writes.
8. The design must be testable with real independent Node processes and independent browser contexts.

## 4. Non-goals

- No cloud service, account system, collaboration server, or remote review platform.
- No plugin marketplace, Asset Center, Frontend Pass 5, or Wave 7 work.
- No new Agent Port capability that can approve, return, or choose for a human.
- No replacement of MCP transport or change/project transaction semantics.
- No migration to a new `terminal.json` format.
- No automatic conflict winner based on timestamps, filenames, lexical order, or last writer wins.
- No permanent daemon requirement. The current local Editor host owns the HTTP adapter; a future desktop host may mount the same authority service.
- No fallback to direct File System Access writes when the authority is unavailable.

## 5. Invariants

### 5.1 Single authority

Only `ReviewTerminalAuthority` may call the three `NodeReviewStore` terminal create operations in production. The browser Editor may construct a proposed receipt but cannot write terminal files.

### 5.2 First valid terminal result wins

For an integration-result review:

- no terminal receipt -> one valid approval or return may commit;
- existing approval -> identical approval retry may return the existing identity; return or different approval fails `REVIEW_TERMINAL_ALREADY_SET`;
- existing return -> identical return retry may return the existing identity; approval or different return fails `REVIEW_TERMINAL_ALREADY_SET`;
- both files already present -> fail `REVIEW_IDENTITY_MISMATCH`; never delete or choose one.

### 5.3 Decision idempotency

For a comparison review:

- no `decision.json` -> one validated decision may commit;
- identical retry -> return the existing record identity;
- different decision bytes -> fail `REVIEW_TERMINAL_ALREADY_SET`;
- result-review receipt kinds are rejected.

### 5.4 Lock-before-read

The authority acquires the review lease before the terminal pre-check, validation of current terminal state, and create-only write. It re-reads the immutable review identity and payload while holding the lease. No pre-lock observation may authorize a write.

### 5.5 No side effects on failure

Busy, malformed, stale, mismatched, unauthorized, already-terminal, transport, and storage failures leave all receipt files, review payloads, project files, change state, and integration state unchanged. Failed lock cleanup preserves evidence and reports a structured error.

### 5.6 No silent browser fallback

When the authority cannot be proven available and identity-compatible, Editor terminal buttons are disabled. Existing receipts remain readable. The UI may offer retry/reconnect but cannot call the old direct writer.

## 6. Architecture

### 6.1 Shared Authoring contract

Create `packages/authoring/src/review-terminal.ts` and export it from `packages/authoring/src/index.ts`.

It defines transport-neutral request/result types only:

```ts
export type ReviewTerminalAction =
  | 'comparison-decision'
  | 'result-approval'
  | 'result-return';

export interface ReviewTerminalCommand {
  protocolVersion: '1.0.0';
  requestId: string;
  projectIdentity: string;
  reviewId: string;
  reviewPayload: { bytes: number; sha256: string };
  action: ReviewTerminalAction;
  receipt: unknown;
}

export interface ReviewTerminalRecord {
  action: ReviewTerminalAction;
  file: 'decision.json' | 'final-approval.json' | 'return-request.json';
  bytes: number;
  sha256: string;
  receipt: unknown;
}

export interface ReviewTerminalSnapshot {
  protocolVersion: '1.0.0';
  reviewId: string;
  projectIdentity: string;
  state: 'open' | 'decision-written' | 'approval-written' | 'returned' | 'corrupt';
  record?: ReviewTerminalRecord;
}
```

The command contains no absolute path. `projectIdentity` and `reviewId` select only a canonical workspace beneath the server-bound Agent data root. `reviewPayload.bytes/sha256` bind the browser-opened evidence to the canonical Node workspace.

Add Authoring error catalog entries:

- `REVIEW_BUSY`: another authority process owns the review lease; retry after refresh with the same request and receipt;
- `REVIEW_TERMINAL_ALREADY_SET`: one different terminal result already exists; read and display it;
- existing `REVIEW_IDENTITY_MISMATCH`, `REVIEW_DECISION_INVALID`, `REVIEW_DECISION_STALE`, `REVIEW_RESULT_NOT_READY`, and `REVIEW_RETURNED` remain authoritative.

`REVIEW_AUTHORITY_UNAVAILABLE` is an Editor transport state, not an Authoring business error and not an Agent capability error.

### 6.2 Review-scoped Node lease

Extend the existing `NodeLocalLeaseManager` with `LeaseScope = 'change' | 'project' | 'review'`.

Review locks live under:

```text
<SURDET_AGENT_DATA_DIR>/.locks/reviews/<safe-hash>.lock
```

The resource key is the exact pair `projectIdentity + NUL + reviewId`; it is passed through the existing safe hashing rule. Review locks reuse the existing exclusive directory publication, owner token, PID/hostname evidence, heartbeat, bounded publication polling, stale-candidate handling, safe release, sentinel preservation, and fail-loud corruption behavior.

The review scope maps busy conflicts to `REVIEW_BUSY`. Session descriptions continue to expose only the existing active change/project leases; a short review write lease is not an Agent session capability or a third session mutation state.

### 6.3 NodeReviewStore terminal boundary

`NodeReviewStore` receives an optional `NodeLocalLeaseManager`. Its default manager is created from `path.dirname(projectDirectory)`, which is the exact Agent data root owning that project-identity directory.

The following methods acquire the same review-scoped lease:

- `createDecision()`;
- `createFinalApproval()` / compatibility alias `createApproval()`;
- `createReturnRequest()`.

The process-local `resultReceiptWrites` map is removed after the cross-process lease is proven. No second mutex remains as an apparent source of truth.

Inside the lease, each method reopens the review, verifies kind/project/payload identity, reads all legal terminal files, classifies the current state, then calls existing create-only JSON storage. Existing identical bytes are idempotent. Conflicting existing bytes are reported as `REVIEW_TERMINAL_ALREADY_SET` with safe record identity, never raw hidden content.

### 6.4 ReviewTerminalAuthority service

Create `packages/cli/src/authoring/review-terminal-authority.ts`.

```ts
export class ReviewTerminalAuthority {
  constructor(
    readonly dataRoot: string,
    private readonly leases = new NodeLocalLeaseManager(dataRoot),
    private readonly hasher: TextHasher = nodeTextHasher,
  ) {}

  describe(input: {
    projectIdentity: string;
    reviewId: string;
    reviewPayload: { bytes: number; sha256: string };
  }): Promise<ReviewTerminalSnapshot>;

  write(command: ReviewTerminalCommand): Promise<ReviewTerminalSnapshot>;
}
```

`write()` performs this order:

1. validate the command envelope, IDs, fingerprint shape, and action/receipt combination;
2. resolve `<dataRoot>/<projectIdentity>` without accepting a browser path;
3. construct `NodeReviewStore` bound to that project identity and the shared lease manager;
4. acquire the review lease;
5. re-read `identity.json` and the immutable review payload;
6. require payload bytes/SHA to equal `command.reviewPayload`;
7. validate the proposed decision/approval/return with existing shared Authoring validators;
8. create or idempotently read the one legal receipt;
9. re-read terminal state and return a `ReviewTerminalSnapshot`.

The service never calls project mutation, composition execution, change commit, recovery, or apply.

### 6.5 Same-origin local HTTP adapter

Create a thin Node adapter under `packages/cli/src/review-authority/` and mount it from `packages/editor/vite.config.ts` for both Vite development and preview servers.

Endpoints:

```text
GET  /__surdet/review-authority/v1/status
POST /__surdet/review-authority/v1/describe
POST /__surdet/review-authority/v1/write
```

The adapter:

- binds only through the current local Editor origin;
- injects an unguessable per-server token into `index.html` through Vite HTML transformation;
- requires that token in `X-Surdet-Review-Authority`;
- requires exact same-origin `Origin` for writes;
- accepts JSON only and enforces a fixed 256 KiB body limit;
- rejects unknown keys and arbitrary filesystem paths;
- maps `AuthoringOperationError` to one JSON error envelope;
- emits no stack, token, absolute data-root path, receipt body, or hidden project content in error text;
- does not register an MCP tool or Agent Port capability.

The Vite adapter may import the Node authority from the CLI source as monorepo tooling, but no Editor browser source may import `node:*`, CLI storage, or lease modules. A permanent boundary test freezes this separation.

A future packaged desktop host may mount the same HTTP handler. It must not reimplement receipt validation or locking.

### 6.6 Editor client and workspace state

Create `packages/editor/src/review-terminal-client.ts`.

```ts
export interface ReviewTerminalClient {
  status(): Promise<'available' | 'unavailable'>;
  describe(input: ReviewTerminalDescribeInput): Promise<ReviewTerminalSnapshot>;
  write(command: ReviewTerminalCommand): Promise<ReviewTerminalSnapshot>;
}
```

The browser client reads the injected token, uses same-origin relative URLs, applies a bounded timeout, accepts only the exact protocol shape, and never retries with new receipt bytes. An uncertain response is resolved by `describe()` before any optional same-command retry.

`ReviewWorkspaceState` gains:

```ts
authority: {
  state: 'checking' | 'available' | 'unavailable' | 'mismatch';
  message: string;
};
```

`openReviewWorkspace()` continues to validate local immutable evidence, then asks the authority to describe the same review identity. Canonical authority terminal state supersedes a stale copied workspace view only after project identity, review ID, and payload bytes/SHA all match.

`writeDecisionReceipt()`, `writeApprovalReceipt()`, and `writeReturnReceipt()` keep constructing the existing receipt schema/fingerprint but submit it to the client. They update in-memory state only from the authority response. The old browser `writeCreateOnly()` receipt path is deleted; no fallback remains.

### 6.7 Human interface

The review panel projects authority state without exposing English protocol details:

- checking: `正在连接本机审阅服务…`;
- available/open: normal decision buttons;
- busy: `另一个窗口正在保存这项决定，请稍候刷新`;
- terminal already set: reopen and display the persisted decision, controls read-only;
- unavailable: `本机审阅服务未连接。内容仍可查看，但暂时不能批准或退回。请从 Surdet 正常入口重新打开。`;
- identity mismatch: `当前审阅任务与本机服务记录不一致，已禁止写入。`;
- corrupt: `审阅回执存在冲突，需要人工检查；Surdet 未选择或覆盖任何结果。`.

Buttons are disabled while checking, submitting, unavailable, mismatched, terminal, or corrupt. A double click or repeated Enter submits one stable command. UI success appears only after authority response and canonical terminal re-read.

No modal stack, colored left selection bar, English error dump, or unrelated visual redesign enters this gate. Technical codes stay in the existing collapsed technical details.

## 7. End-to-end flows

### 7.1 Comparison decision

1. Human opens a comparison workspace.
2. Editor validates local identity/payload and calls authority `describe`.
3. Human selects exact units and conflict resolutions.
4. Editor creates one receipt and stable request ID, disables the save action, and calls `write`.
5. Authority acquires the review lease, validates the decision through `validateComparisonDecision`, and create-writes `decision.json`.
6. Editor accepts success only from the returned canonical snapshot and renders the receipt read-only.
7. Concurrent different decisions receive the already-set snapshot and cannot overwrite it.

### 7.2 Result approval versus return

1. Human opens a STAGE_READY result review.
2. Editor describes canonical terminal state.
3. Human selects approval or return.
4. Authority acquires the single review lease and reads both receipt files under the lock.
5. If open, it validates and creates exactly one file.
6. If another process won, it returns the existing terminal state.
7. If both files pre-existed, it reports corrupt and leaves both untouched.

### 7.3 Unavailable authority

1. Local workspace evidence opens normally.
2. Status/describe cannot establish a compatible authority.
3. Editor shows read-only guidance and never calls direct File System Access writes.
4. Reconnecting and reopening may restore actions after a fresh successful describe.

### 7.4 Uncertain network response

1. Editor sends one stable command.
2. The response is lost or times out.
3. Editor does not mint a new receipt ID or timestamp.
4. It calls `describe` for the exact review.
5. If the exact receipt exists, it renders success; if open, it may offer one same-command retry; if a different terminal exists, it renders that terminal read-only.

## 8. Compatibility and migration

- Existing `decision.json`, `final-approval.json`, and `return-request.json` remain readable without rewriting.
- An existing single valid terminal receipt is returned by `describe` and keeps controls read-only.
- Existing workspaces containing both approval and return remain corrupt/fail-loud; no automatic cleanup or winner selection.
- Review payload and identity schemas stay at `1.0.0` unless implementation discovers an unavoidable schema need. Such a discovery stops the gate for a design amendment rather than silently bumping formats.
- Existing Agent Port read/plan/commit gates keep consuming the same receipt files and fingerprints.
- Static Editor builds remain usable for project editing and review reading. Only terminal review writes require the local authority.

## 9. Security and trust boundaries

- The browser never supplies an absolute review or data-root path.
- The server accepts only project identity, review ID, immutable payload identity, action, and receipt.
- All path construction stays beneath the configured Agent data root and reuses `NodeReviewStore` safe-path checks.
- Same-origin and per-server token checks defend the loopback authority from unrelated web pages.
- Request bodies and error bodies are bounded.
- The authority does not trust client fingerprints; it recomputes and validates them through shared Authoring functions.
- The Editor cannot use authority success for a different local workspace identity.
- No approval/return method appears in capability registry, MCP tool lists, Agent session policy, or delivery capsules.
- Logs and errors omit the token and sensitive receipt content.

## 10. Failure handling

| Failure | Required behavior |
|---|---|
| Authority missing | Read-only Editor; no direct write fallback |
| Review lease busy | Return `REVIEW_BUSY`; same receipt remains retryable after describe |
| Lease corrupt/foreign/stale ambiguity | Fail loud; preserve lock evidence; no receipt mutation |
| Review not found | `REVIEW_NOT_FOUND`; no directory creation |
| Payload bytes/SHA mismatch | `REVIEW_IDENTITY_MISMATCH`; no receipt mutation |
| Invalid decision | Existing `REVIEW_DECISION_INVALID`/`STALE`/`RETURNED` |
| Result not ready | `REVIEW_RESULT_NOT_READY` |
| Existing different terminal | `REVIEW_TERMINAL_ALREADY_SET` plus safe existing state |
| Both result files exist | `REVIEW_IDENTITY_MISMATCH`, state `corrupt`, preserve both |
| Create/write/readback failure | Fail loud, preserve any created evidence, never write the opposite outcome |
| Lost HTTP response | Describe before same-command retry |
| Token/origin/body violation | Generic HTTP rejection without business dispatch |

## 11. Test strategy

### 11.1 Shared contract tests

- command/snapshot exact schemas;
- error catalog entries and retry dispositions;
- no new capability registry writer;
- unknown fields and invalid receipt/action combinations rejected.

### 11.2 Lease tests

- review scope uses a distinct lock directory and safe resource hash;
- heartbeat, bounded publication polling, release drain, wrong owner, corruption, foreign host, and stale recovery match existing lease invariants;
- review busy maps to `REVIEW_BUSY` without changing change/project behavior.

### 11.3 NodeReviewStore tests

- same-process and independent-process comparison decision races produce one immutable file;
- independent-process approval versus return produces exactly one file;
- identical retry is idempotent;
- different retry reports terminal already set;
- both pre-existing files remain fail-loud and unchanged;
- lock release leaves zero active review lease directories;
- project/change/payload bytes remain unchanged.

### 11.4 Authority tests

- exact workspace and payload identity required;
- every receipt validated through shared Authoring;
- no arbitrary path accepted;
- describe classifies open/decision/approval/returned/corrupt;
- busy, stale, malformed, and already-terminal envelopes stable;
- no project or change mutation.

### 11.5 HTTP adapter tests

- same-origin token required;
- wrong origin/token/content type/method/unknown fields/body overflow rejected before authority call;
- structured success/error response only;
- token/path/stack never emitted;
- development and preview server hooks mount the same handler;
- browser production bundle contains no Node/CLI storage import.

### 11.6 Editor tests

- unavailable/mismatch/corrupt states are Chinese and read-only;
- available state enables only legal human actions;
- double click and repeated keyboard submission use one stable command;
- uncertain response describes before retry;
- authority response, not local optimistic state, produces success;
- reopening reads the canonical terminal outcome;
- old direct receipt writer is absent;
- existing review readability remains.

### 11.7 Real process/browser proof

A fixed runner creates one isolated review fixture and starts two independent Node workers plus two browser contexts. It proves:

- two distinct comparison decisions -> one winner;
- approval versus return -> one winner;
- losing browser becomes read-only and displays the persisted winner;
- static/no-authority mode remains readable and non-writing;
- all receipt identities match disk bytes/SHA;
- zero project mutation, zero change mutation, zero protocol/console/request errors, zero active review leases, and complete child cleanup.

## 12. Expected file plan

Shared Authoring:

- Create `packages/authoring/src/review-terminal.ts`.
- Modify `packages/authoring/src/error-catalog.ts`.
- Modify `packages/authoring/src/index.ts`.
- Create `packages/authoring/test/review-terminal.test.ts`.
- Modify `packages/authoring/test/error-catalog.test.ts`.

Node authority and storage:

- Modify `packages/cli/src/authoring/node-local-lease.ts`.
- Modify `packages/cli/src/authoring/node-review-store.ts`.
- Modify `packages/cli/src/authoring/review-service.ts` to export the existing projection parser for authority reuse.
- Create `packages/cli/src/authoring/review-terminal-authority.ts`.
- Create `packages/cli/src/review-authority/http-handler.ts`.
- Create `packages/cli/src/review-authority/vite-plugin.ts`.
- Modify `packages/cli/test/node-local-lease.test.ts`.
- Modify `packages/cli/test/node-review-store.test.ts`.
- Modify `packages/cli/test/review-service.test.ts`.
- Create `packages/cli/test/review-terminal-authority.test.ts`.
- Create `packages/cli/test/review-authority-http.test.ts`.
- Create `packages/cli/test/fixtures/review-terminal-worker.mjs`.

Editor:

- Modify `packages/editor/vite.config.ts`.
- Create `packages/editor/src/review-terminal-client.ts`.
- Modify `packages/editor/src/review-workspace.ts`.
- Modify `packages/editor/src/panels/review-panel.ts`.
- Create `packages/editor/test/review-terminal-client.test.ts`.
- Modify `packages/editor/test/review-workspace.test.ts`.
- Modify `packages/editor/test/review-panel.test.ts`.
- Create `packages/editor/test/review-authority-boundary.test.ts`.

Real proof and governance:

- Create `packages/cli/e2e/review-terminal-atomicity-gate.e2e.mjs`.
- Create `packages/cli/test/review-terminal-atomicity-runner.test.mjs`.
- Modify the implementation taskbook only for append-only execution evidence.
- Update the existing long-term roadmap ledger only after reviewed local closure; keep it untracked and unstaged under current governance.

## 13. Acceptance criteria

1. A real cross-process approval/return race leaves exactly one legal terminal receipt.
2. A real cross-window race converges on the same persisted winner and disables the loser.
3. Comparison decisions are immutable and idempotent through the authority.
4. All writers acquire the same review-scoped Node lease before terminal reads/writes.
5. Editor browser code contains no direct receipt write path and no Node storage import.
6. Authority-unavailable Editor is readable but terminal-read-only, with clear Chinese guidance.
7. Existing valid receipt files reopen without migration or byte changes.
8. Both-file corruption remains fail-loud and untouched.
9. Agent Port exposes no human-decision writer capability.
10. Project files, change records, integration trees, review payloads, and source capsules remain unchanged.
11. Focused Authoring/CLI/Editor tests, typechecks, builds, fixed process/browser runner, and proportional aggregate verification pass on a frozen code evidence head.
12. No push, deployment, Asset Center, Frontend Pass 5, or Wave 7 begins in this gate.

## 14. Rejected approaches

### Browser Web Locks plus existing files

Rejected because Web Locks coordinate same-origin browser contexts only. They do not constrain Agent Port or another Node process.

### Only rename the receipts to `terminal.json`

Rejected because a browser File System Access check-create-write is not an exclusive first-writer transaction. One file prevents simultaneous physical filenames but still permits overwrite/last-close-wins and false success.

### Dedicated always-on daemon

Technically sound but rejected for this gate because it adds installation, lifecycle, port, recovery, and support burden. Mounting the same authority in the existing local Editor host provides the required Node boundary without another permanent service.

### Deterministic winner among multiple proposal files

Rejected because a later proposal could change the selected winner unless another immutable seal exists. It preserves contradictory terminal intents instead of enforcing one final human result.

### Keep browser writes as fallback

Rejected because fallback recreates the race precisely when the authority is missing. Availability must degrade to read-only, not weaker correctness.

## 15. Owner decision record

The project owner approved the local “single stamp keeper” model: normal Surdet use starts the authority with the Editor and remains operationally invisible; a static page without the authority becomes read-only for terminal actions. The owner delegated the remaining detailed design to the General Manager and requested a standalone third-gate specification and taskbook, not implementation.

```text
REVIEW_TERMINAL_ATOMICITY_DESIGN = OWNER_APPROVED
SINGLE_NODE_REVIEW_AUTHORITY = SELECTED
STATIC_EDITOR_TERMINAL_WRITES = READ_ONLY
DIRECT_BROWSER_RECEIPT_WRITES = FORBIDDEN
EXISTING_RECEIPT_FORMATS = PRESERVED
AGENT_HUMAN_DECISION_CAPABILITY = NOT_ADDED
IMPLEMENTATION = NOT_STARTED
PUSH = NOT_AUTHORIZED
ASSET_CENTER = NOT_STARTED
FRONTEND_PASS_5 = NOT_STARTED
WAVE_7 = NOT_STARTED
```
