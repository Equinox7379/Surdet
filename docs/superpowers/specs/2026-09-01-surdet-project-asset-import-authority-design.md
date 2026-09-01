# Surdet Project Asset Import Authority Design

**Status:** APPROVED DIRECTION — owner approved the strengthened local-authority approach on 2026-09-01.

**Gate ID:** `PROJECT_ASSET_IMPORT_AUTHORITY`

**Predecessor:** `ASSET_CENTER_READ_ONLY_INTELLIGENCE_1 = PASSED`

## 1. Purpose

This gate turns the read-only Asset Center into a safe import workbench for real project files.

The feature must let a human select multiple source files, review their destination category and final name in Chinese, stage the bytes through a trusted local Node authority, and publish only new files under `content/assets`. It must preserve enough identity and journal evidence to recover honestly after interruption and to undo a completed import only while every imported file still matches its receipt.

This is a project-data boundary. The design therefore prefers explicit state, fail-closed behavior, durable receipts, and bounded recovery over a browser-only shortcut.

## 2. Corrected guarantee

Neither the browser File System Access API nor Node provides one operating-system transaction that makes an arbitrary multi-file batch appear simultaneously.

This design does **not** claim global atomicity. Its guarantee is a **recoverable import transaction**:

- no existing target is overwritten;
- every source byte stream is staged and hashed before publication;
- one authority project lease serializes asset-import writers for the bound project;
- every publication transition is recorded durably;
- a failed batch rolls back only files proven to have been created by that operation;
- an interrupted transaction is inspected on restart and either finalized, rolled back, or stopped for manual recovery;
- no partial state is reported as success.

Single-file publication remains individually verifiable, but external programs outside Surdet are not controlled by the lease. Every target and parent chain is therefore revalidated immediately before and after each mutation, and the full batch is rescanned before the receipt is written.

The Phase 2 threat model is an ordinary local single-user editor session with cooperating Surdet writers and possible accidental external edits. It does not claim security against a malicious process already running as the same operating-system user and deliberately racing path checks. Node does not provide a portable `openat`/directory-handle-relative mutation API on all supported platforms; adding a native filesystem broker is outside this gate. If pre/post identity differs, the authority fails closed and preserves recovery evidence. The specification never describes those checks as protection from an adversarial same-account filesystem racer.

## 3. Alternatives considered

### 3.1 Browser-native writer

The Editor could write selected `File` objects through `FileSystemDirectoryHandle`. This keeps the feature self-contained, but it cannot strongly bind a Node journal to the browser-selected absolute project, cannot provide cross-process ownership, and cannot guarantee exclusive destination creation across external writers.

Rejected for this gate.

### 3.2 Strengthened local authority — selected

A pure Authoring planner defines names, categories, paths, conflicts, plan identity, and receipts. A local Node authority owns byte staging, project-root confinement, the project lease, publication, rollback, undo, and recovery. The Editor is a human-facing client only.

Selected because Surdet already has root-confined Node storage, lease and journal patterns, recovery inspection, a same-origin token boundary, and Vite configuration injection. This gate extends those verified patterns without making the Agent Port the owner of human imports.

### 3.3 Single-file-only import

One file per operation reduces recovery complexity but makes ordinary asset onboarding needlessly slow and does not establish the batch contract needed by a mature engine.

Rejected as the primary workflow. The selected design still treats every file as an independently evidenced item inside the batch.

## 4. Scope

### 4.1 Included

- Selecting up to 512 source files through a normal browser file input or drag-and-drop.
- A Chinese in-place import workbench inside the Asset Center.
- Suggested category and destination name, with explicit human confirmation.
- Streaming uploads to a same-origin local Node authority; no base64 payloads.
- SHA-256 and byte-count identity for every staged and published file.
- Project binding proof between the browser directory handle and the authority's configured root.
- Strict safe-path, symlink/junction, case-fold, Unicode-normalization, reserved-name, extension, and collision checks.
- New-file-only publication under `content/assets`.
- Project lease, durable journal, recovery inspection, success receipt, and exact-fingerprint undo.
- Refreshing the shared Asset Center truth after success or undo.
- Stable structured contracts that CLI and a future Agent apply policy can reuse.
- A reserved internal workspace at `.surdet/asset-import/` for same-filesystem prepared files and recovery quarantine. Runtime, Asset Center inventory, project revision, and content packaging must ignore this exact internal tree.

### 4.2 Excluded

- Overwriting or replacing an existing project file.
- Renaming, moving, converting, optimizing, deleting, or deduplicating existing assets.
- Automatically editing scenes, timelines, characters, gallery configuration, or other references.
- Automatically generating human-facing display-name metadata.
- Importing into the legacy `public/` compatibility tree.
- Exposing import commit or undo through the Agent Port in this gate.
- Building the future desktop project-picker shell.
- Deployment, release packaging, Frontend Pass 5, mainline Wave 7, or destructive Git operations.

Undo is the only deletion-like action in scope. It may remove only paths created by the same successful import receipt and only when all current hashes still equal the receipt. It never removes a pre-existing or subsequently modified file.

## 5. Existing boundaries retained

- `buildProjectAssetIntelligence` remains the single physical-asset truth.
- Physical identity remains `file:<project-relative-path>`.
- The physical source root remains `content/assets` only.
- Existing `gallery.json` arrays remain compatibility/UI action adapters, not a second physical index.
- The Editor never receives an unrestricted filesystem path-writing API.
- The Agent-facing projection remains professional structured English while ordinary Editor copy remains natural Chinese.
- Review terminal authority and project asset import authority are separate domains. Neither endpoint accepts the other's commands.

## 6. Architecture

### 6.1 Pure Authoring planner

`@surdet/authoring` owns a new pure module, `asset-import.ts`. It has no Node, browser, HTTP, or File System Access dependency.

It consumes staged source facts and requested targets, then produces a deterministic `ProjectAssetImportPlan`. The planner owns:

- category-to-directory mapping;
- extension compatibility;
- safe final filename validation;
- portrait filename validation;
- duplicate target detection inside the batch;
- collision projection supplied by the storage adapter;
- deterministic operation ordering;
- blocking issue codes;
- `planFingerprint` computation input.

The planner does not read bytes, write files, silently rename anything, or infer that identical content permits replacement.

### 6.2 Local Node authority core

`@surdet/cli` owns `src/asset-import-authority/`. This is a local project mutation authority, not an Agent Port capability.

Its core responsibilities are:

- opening one configured project root through the existing root-confined Node storage rules;
- allocating a stable operation directory under the authority data root;
- streaming source bytes to staged files while computing SHA-256;
- writing journal generations with exclusive-create plus durable replacement semantics;
- holding one authority-owned project lease for the lifetime of the bound service;
- revalidating target absence and path safety;
- publishing new files without overwrite;
- verifying final bytes and hashes;
- rolling back exact operation-created files after failure;
- inspecting and executing recovery;
- writing immutable success and undo receipts.
- serializing every transition of one operation through an in-process operation mutex in addition to the lifetime authority project lease;
- enforcing a durable project recovery barrier before binding confirmation, operation creation, planning, commit, recovery, and undo;
- serializing project-namespace registration and recovery-resolution state through the lifetime authority project lease, physically separate from the Agent change-lock directory.

Authority artifacts live under one stable local data root. The repository launcher accepts an optional absolute `--data-root`; when omitted it resolves a platform-native persistent location:

- Windows: `%LOCALAPPDATA%/Surdet/asset-import-authority/v1`;
- macOS: `~/Library/Application Support/Surdet/asset-import-authority/v1`;
- Linux: `${XDG_STATE_HOME:-~/.local/state}/surdet/asset-import-authority/v1`.

The resolved root is never a temporary directory. Tests always pass an isolated `--data-root`. The authority creates directories with mode `0700` and files with mode `0600` where the platform enforces POSIX modes, rejects a data root that is a symlink/junction or has unsafe ancestors, and stores no bearer token there. On startup it writes or verifies a versioned `data-root-identity.json`; while running it revalidates the root device/inode/birth identity before every open. Replacement, corruption, or an unsupported identity fails the authority closed instead of silently starting an empty history.

The exact persistent layout is:

```text
<data-root>/
  data-root-identity.json
  locks/projects/<project-identity-hash>.lock/lease.json
  projects/<project-identity-hash>/
    project-identity.json
    operation-index/<operation-id>.json
    challenge-index/<challenge-id>.json
    recovery-barriers/<barrier-id>.json
    recovery-resolutions/<barrier-id>.json
    challenges/<challenge-id>/journal.json
    operations/<operation-id>/
      journal.json
      plan.json
      staging/<item-id>.bin
      receipt.json
      undo-receipt.json
```

`operation-index/<operation-id>.json` and `challenge-index/<challenge-id>.json` are create-only registration records written before their corresponding project-visible work. They are the restart-discovery source; operation-directory enumeration alone never grants authority. `recovery-barriers/<barrier-id>.json` is a create-only incident record written before reporting an uncertain failure. A barrier is active until an exact create-only resolution record names its hash and proves every referenced operation terminal and every retained quarantine path accounted for. New binding, create, plan, commit, recovery, and undo check registrations and unresolved barriers independently of leases and directory enumeration.

Every registration, barrier, resolution, journal, plan, and receipt is a closed versioned envelope containing `generation`, `previousGenerationSha256` where applicable, and its own canonical SHA-256. It is written to an exclusive temporary sibling, file-synced, atomically renamed to its final create-only name, then parent-directory-synced where the platform exposes that operation. Existing different bytes are corruption. The lifetime authority project lease serializes registration and barrier-resolution decisions across processes; challenge and operation transitions use keyed in-process mutexes because a second authority process cannot hold the same project lease. A missing generation, broken hash chain, duplicate logical identity, corrupt record, or ambiguous case-fold sibling fails closed and creates or preserves a recovery barrier rather than being rebuilt from guesses.

The artifact tree is outside the project. Staged bytes may therefore cross filesystem boundaries during publication; the authority relies on exclusive target creation, hashing, journaling, and recovery rather than claiming rename-based atomicity.

The configured data root is canonicalized once and revalidated before every operation open. The data root, project namespace, operation directory, staging directory, and artifact files are checked segment by segment with bigint `lstat` plus native `realpath`; symlinks, junctions, non-directory parents, path escapes, ambiguous case-fold siblings, and create-through-reparse behavior are rejected. The recorded identity fields are platform, canonical real path, device, inode, and nanosecond birth time. Operation, item, challenge, receipt, and undo IDs are strict lowercase UUIDs or fixed server-generated prefixed hashes; invalid identifiers are rejected and never sanitized into another identifier.

The authority also uses `.surdet/asset-import/<operation-id>/` inside the canonical project root for same-filesystem prepared files and quarantine links. It rejects an existing `.surdet` or descendant that is a symlink, junction, non-directory, or outside the revalidated root. It records every created internal parent durably before use. Successful commit removes prepared links and empty operation directories; rollback or undo may retain quarantine links as recovery evidence. A shared exact-path predicate excludes only `.surdet/asset-import` from every general project enumerator used by revision calculation, Asset Center inventory, validation, packaging, and fixture snapshots; it must not exclude unrelated `.surdet` content and must not rely on the existing `.surdet-*` basename rule.

The authority must not reuse any of the following as its binary mutation implementation:

- `ProjectWriteStorage`, `NodeProjectStorage.replaceFromStage`, or `NodeProjectStorage.removePath`;
- `NodeChangeStore` or text `CommitJournal`;
- `transaction-recovery.ts` file classification;
- Agent Port error normalization or capability registration.

Those contracts are text/change specific and permit replacement/removal semantics that violate new-file-only import. The new binary journal, storage adapter, errors, receipts, and recovery barrier are separate. The authority project lease reuses the proven owner-token, heartbeat, stale-process, and identity checks of `NodeLocalLeaseManager`, but lives under the dedicated asset-import data root and coordinates only asset-import authority instances. Agent Port writers remain outside this lease and are treated like other external writers: target absence and parent identity are revalidated around every new-file publication.

Authority-side staged facts are constructed only from bytes measured and hashed by the Node upload stream. Browser-declared size, MIME, source name, and digest are request evidence, never authoritative planner facts.

Text `ProjectWriteStorage` is not widened to accept arbitrary binary values. The authority introduces a focused binary storage adapter so text change transactions and asset import transactions cannot accidentally call each other's operations.

### 6.3 Same-origin HTTP adapter

A parallel Vite plugin exposes `/__surdet/project-asset-import/v1`. It reuses the verified review-authority security shape but not its routes or token.

Every request requires:

- loopback host;
- exact expected Origin;
- a separate random token of at least 128 bits injected into the main Editor document only;
- the expected method and content type;
- a known project-binding token for all operation routes;
- bounded JSON or binary size;
- a UUID operation ID on mutation calls, including operation creation;
- a response envelope with a stable error code and retry disposition.

Preview pages, static unbound builds, and foreign origins receive no authority configuration. Absolute project paths, data-root paths, tokens, and staged identities never appear as ordinary UI copy or Agent projection values.

### 6.4 Editor client and workbench

The Editor owns:

- source-file selection;
- local object URLs for pre-import preview;
- editable requested category and final name;
- Chinese explanations and recovery actions;
- upload progress;
- calls to the narrow authority client;
- refreshing the already-open browser directory handle after commit or undo.

It does not compute authoritative plan identity, choose a conflict policy silently, publish bytes, remove files, or fabricate success after an unavailable response.

## 7. Project identity binding

The authority starts with one exact configured project root and computes the existing project root identity. The browser may have independently opened a `FileSystemDirectoryHandle`, but that handle exposes no trustworthy absolute path.

The authority freezes an internal `ProjectRootBindingIdentity` at launch:

```ts
interface ProjectRootBindingIdentity {
  canonicalRootRealPath: string;
  platform: NodeJS.Platform;
  device: string;
  inode: string;
  birthtimeNs: string;
  publicProjectIdentity: string;
}
```

`canonicalRootRealPath` comes from native `realpath`; the configured root itself must be a real directory, not a symlink or junction. `device`, `inode`, and nanosecond birth time come from bigint `lstat`. If the platform/filesystem cannot provide a nonzero stable directory identity, import authority startup fails with `PROJECT_ROOT_IDENTITY_UNAVAILABLE`; it does not fall back to path-only identity. `publicProjectIdentity` is SHA-256 over a version tag plus platform, canonical root, device, inode, and birth time. Only the public hash crosses HTTP.

The canonical root, its parent relationship, realpath, device, inode, and birth time are revalidated before challenge creation, challenge confirmation, commit, recovery, and undo. Replacing the directory at the same path, inserting a junction, or changing a parent to redirect the path invalidates the binding before further mutation.

The two sides are bound through a one-time project probe:

1. The Editor requests a binding challenge.
2. While holding the lifetime authority project lease and the keyed challenge mutex, the authority first create-only registers the exact challenge ID, deterministic probe basename, nonce hash, process identity, expiry, and `PROBE_CREATE_INTENT`; only then it exclusive-creates the root-level `.surdet-bind-<uuid>.json` containing the nonce, format version, and expiry.
3. The Editor reads that exact relative file through its selected directory handle and returns the nonce.
4. The authority verifies the nonce, root identity, session, and expiry, then removes the probe.
5. The authority confirms probe removal and returns a short-lived binding token scoped to that project and browser session.

The binding fails if the probe already exists, cannot be read, is read from a different handle, expires, or cannot be removed. A failed or interrupted probe is recoverable only when its exact file contains the authority marker and matching operation identity. Arbitrary `.surdet-bind-*` files are never deleted by pattern alone.

The authority acquires the project lease once at startup and holds it until clean shutdown. Challenge creation and cleanup then use a keyed in-process challenge mutex; operation transitions use a keyed in-process operation mutex. No request may wait on two keyed mutexes simultaneously. The project lease is released only by its exact owner token, uses heartbeat and live-process checks, and an ambiguous stale lease fails startup instead of being stolen. Challenge registration is durable before `PROBE_CREATE_INTENT`, and the challenge journal records `PROBE_CREATED`, `PROBE_VERIFIED`, and `PROBE_REMOVED`. The probe is create-only, at most 1 KiB, expires after 60 seconds, and is tied to the current authority process token. Startup scans only create-only `challenge-index` registrations, derives the one exact basename from each valid record, and never glob-deletes `.surdet-bind-*`. Therefore a crash immediately after probe creation is still discoverable. A probe cleanup failure raises a create-only durable recovery barrier and prevents a binding token from being issued.

The project tree must be byte-identical before and after a successful binding probe. The binding snapshot is a dedicated symlink-safe recursive inventory of every project entry except `.git`, `node_modules`, `dist`, and the exact authority-owned `.surdet/asset-import` tree; it is not `NodeProjectStorage.listFiles()`. Probe and internal workspace paths are recorded separately and must reconcile to empty/expected state. If cleanup cannot be proved, import remains unavailable and the UI gives a recovery action.

The first implementation launches the authority with an explicit project root. A future desktop Editor shell may supply that root through a native folder dialog without changing this contract. The current browser-only open-project path remains fully read-only when no matching authority is bound.

The first repository launcher is:

```text
npm run dev:project -w surdet-editor -- --project <absolute-project-root> [--data-root <absolute-persistent-data-root>] [--port <loopback-port>]
```

It serves the Editor and authority on loopback, binds exactly one canonical project root, defaults to the Editor's current configured port 5174 and the platform-native persistent data root defined above, uses strict-port ownership, and fails closed when the requested port is already owned. Ports 4173 and 4175 remain forbidden by the existing cross-project collision contract. It never kills or reuses an unrelated process. Ordinary `npm run dev` remains an unbound read-only development surface unless tests instantiate the plugin with an explicit fixture root and isolated data root.

This gate does not claim that the private Editor workspace has become a distributable desktop product. A future native Editor shell will replace the repository command with a folder dialog while keeping the same authority and binding contracts.

## 8. Import destination contract

The canonical directory mapping is:

| Shared kind | Destination directory |
| --- | --- |
| `background` | `content/assets/bg` |
| `portrait` | `content/assets/portrait` |
| `avatar` | `content/assets/avatar` |
| `music` | `content/assets/bgm` |
| `ambience` | `content/assets/ambience` |
| `sound-effect` | `content/assets/se` |
| `voice` | `content/assets/voice` |
| `video` | `content/assets/video` |
| `font` | `content/assets/fonts` |
| `other` | `content/assets/other` |

The final filename:

- is one basename, never a path;
- is normalized to Unicode NFC before planning;
- is 1–120 characters including extension;
- contains no NUL, control character, slash, backslash, `:`, `*`, `?`, quote, `<`, `>`, or `|`;
- has no leading/trailing whitespace, trailing period, `.` segment, or `..` segment;
- is not a Windows reserved device name, including a reserved stem followed by an extension. After NFC normalization and ordinal uppercase, the blocked stems are `CON`, `PRN`, `AUX`, `NUL`, `CLOCK$`, `COM1` through `COM9`, `LPT1` through `LPT9`, and the documented superscript variants `COM¹`/`COM²`/`COM³` and `LPT¹`/`LPT²`/`LPT³`;
- contains a non-empty stem and one supported extension;
- matches the selected category's existing format contract;
- for portrait imports, follows `角色_服装_表情.ext` with three non-empty components.

Collision comparison is Unicode-NFC and conservatively case-folded across the requested batch and existing destination directory. The exact portable fold is `value.normalize('NFC').toUpperCase().toLowerCase()` over Unicode code points, followed by ordinal code-point comparison. It deliberately blocks more names than a case-sensitive filesystem may require; it does not claim to emulate every NTFS locale rule. Final filesystem creation still uses exclusive semantics. Permanent tests cover NFC/composed equivalence, combining marks, Chinese plus Latin names, German sharp-s expansion, and case-only differences.

A collision blocks the item. The authority never appends `(1)`, changes case, or replaces a file without the human choosing a new valid name and producing a new plan.

`sourceName` is display evidence only. It is NFC-normalized, limited to 240 visible code points, strips no content silently, rejects controls and path separators, and never participates in target-path construction. HTTP errors return only the safe normalized basename or `未命名文件`; browser-supplied absolute/path-like text is never echoed.

The source `File.type` is advisory only. Phase 2 validates the extension contract, staged byte count, and SHA-256; it does not claim deep codec validity or transcode content. `other` accepts only formats already supported by the global image/audio/video/font sets; arbitrary executable, script, HTML, archive, or extensionless files remain blocked. Existing preview and runtime validation continue to report media decode failures honestly.

## 9. Operation lifecycle

### 9.1 Browser draft

The browser-only draft contains selected `File` objects, preview URLs, requested kinds, and requested names. It is not durable and has no permission to write the project.

Removing an item or closing the draft revokes every object URL and creates no authority operation if upload has not started.

### 9.2 Authority operation states

```text
UPLOADING
  -> STAGED
  -> READY
  -> PUBLISHING
  -> COMMITTED

UPLOADING | STAGED | READY
  -> CANCELLED

PUBLISHING
  -> ROLLING_BACK
  -> ROLLED_BACK

PUBLISHING | ROLLING_BACK | UNDOING
  -> RECOVERY_REQUIRED

COMMITTED
  -> UNDOING
  -> UNDONE
```

`PUBLISHING -> COMMITTED` and `COMMITTED -> UNDOING -> UNDONE` are explicit legal transitions. `RECOVERY_REQUIRED` is the only operation state name for uncertain disk state. HTTP returns `IMPORT_RECOVERY_REQUIRED`, and status projections expose `manualRecoveryRequired: true`; `MANUAL_RECOVERY_REQUIRED` is not a second journal state.

Each operation transition is serialized by its keyed in-process mutex while the process holds the lifetime authority project lease. Each journal update increments `journalVersion`, records the previous generation hash, and is create-only or atomically replaces only the immediately preceding generation. On uncertain disk state, the operation first journals `RECOVERY_REQUIRED` and sets a process-wide `projectRecoveryBlocked` flag before releasing its mutex. A create-only barrier incident is then persisted before another request is accepted. After a crash, startup scans every registered journal for `RECOVERY_REQUIRED` before serving routes and recreates any missing barrier incident. This removes the deadlock window without allowing new work through an unrecorded recovery state. Per-file states are:

```text
UPLOADED
PREPARE_INTENT
PREPARED
LINK_INTENT
LINKED
VERIFIED
ROLLBACK_RENAME_INTENT
ROLLBACK_QUARANTINED
UNDO_RENAME_INTENT
UNDO_QUARANTINED
UNDO_VERIFIED
```

The journal is written before the corresponding project mutation. When the filesystem cannot make the mutation and its journal update indivisible, the pre-mutation intent plus filesystem identity determines recovery; uncertainty becomes `RECOVERY_REQUIRED`, never optimistic success.

### 9.3 Upload and seal

- `create` reserves a caller-supplied lowercase UUID operation ID, returns an operation token, and records the expected item count and safe source-name metadata.
- Each raw binary `upload` uses the route item ID plus operation token. Source basename and declared byte count come only from the closed operation-create manifest; the server compares its measured stream length with that manifest and also checks `Content-Length` when the user agent supplies it.
- The authority streams to a new staged file, enforces limits while streaming, closes it, and records the measured bytes and SHA-256.
- A retry with the same operation/item ID and byte-equal content returns the existing fact; different content returns `IMPORT_OPERATION_CONFLICT`.
- `plan` combines staged facts with requested targets and current target-absence facts.
- A plan with any blocking issue is not executable.
- `seal` fixes the ordered item set and returns `planId` plus `planFingerprint`.

`planId` is derived from the full SHA-256 `planFingerprint`; it is not a random identity. Repeating a byte-equal sealed request returns the same plan. A different request under the same operation ID returns `IMPORT_OPERATION_CONFLICT`.

The fingerprint uses a versioned canonical JSON encoder, uppercase 64-character SHA-256 strings, NFC strings, ordinal Unicode code-point ordering, and deterministic arrays. It binds the authority's operation manifest and measured staged facts; it never trusts a browser-supplied digest.

If the service restarts while `UPLOADING`, any partial item is discarded and the operation becomes `CANCELLED` because no project mutation occurred. Complete `STAGED` and `READY` operations remain discoverable. Explicit cancel removes only journal-listed stage paths; cleanup failure raises the recovery barrier without changing the project.

### 9.4 Commit

Commit requires the sealed `planFingerprint`.

Before commit, the authority verifies that the project filesystem supports same-filesystem hard links inside the exact authority workspace. An unsupported filesystem returns `IMPORT_FILESYSTEM_UNSUPPORTED` before target or canonical category mutation.

While holding the lifetime authority project lease and the operation mutex, the authority:

1. reloads the journal and plan;
2. verifies the project root identity and binding token;
3. verifies every staged file's bytes and SHA-256;
4. revalidates every target path, parent, symlink/junction boundary, case-fold collision, and absence;
5. writes `PUBLISHING` before the first project mutation;
6. writes a parent-create intent before any missing canonical category directory is created, then records the created directory's device/inode/birth identity before use;
7. copies each authority-stage file into `.surdet/asset-import/<operation-id>/prepared/<item-id>.bin` with `wx`, hashes and syncs it, and records its device/inode identity as `PREPARED`;
8. writes `LINK_INTENT` for one target while proving that the target is still absent;
9. calls hard-link creation from the prepared file to the final target; hard-link creation must fail when the final target exists;
10. verifies that final and prepared paths have the same device/inode identity, then journals `LINKED`;
11. reopens the final path, verifies bytes and SHA-256, and journals `VERIFIED` before proceeding;
12. after every item is individually verified, reopens every final path with no-follow behavior where supported, revalidates the complete parent chain, compares pre/post-read file identity and metadata, and rehashes the full batch; any detected change enters rollback;
13. writes an immutable success receipt whose hash and source journal generation are recorded;
14. writes `COMMITTED`, removes prepared links and empty internal operation directories best-effort, then releases the operation mutex; the authority project lease remains held until service shutdown.

Any stale target or binding fails before publication. A failure after publication starts enters rollback.

### 9.5 Rollback

The prepared path remains a hard link to the published inode until the whole transaction is committed. Rollback never directly unlinks a final pathname after a separate hash check. It first journals `ROLLBACK_RENAME_INTENT` with the exact expected final identity and a unique create-only quarantine pathname in a newly created empty private directory. It then atomically renames the current final pathname into that quarantine path, journals `ROLLBACK_QUARANTINED`, and inspects the quarantined device/inode and bytes.

If quarantine matches the prepared identity and target hash, the visible target is rolled back while its bytes remain preserved in quarantine. If it contains a replacement or changed inode, those unexpected bytes are still preserved; the authority renames them back to the final path only when that path remains absent, otherwise raises `RECOVERY_REQUIRED`. A rename failure leaves the final path unchanged and also raises recovery. Phase 2 never purges rollback quarantine.

If a final path has a different inode, a linked journal entry is missing, an unsafe parent appears, or restoration cannot be proved, the authority stops, preserves every artifact, raises the durable project recovery barrier, and blocks further imports. It keeps its lifetime lease until clean service shutdown so a second authority cannot race the unresolved state.

Newly created category directories are removed only when a completed journal generation records their exact filesystem identity and they are empty after target rollback. A directory found after only `parent-create intent` is never assumed to be authority-created; uncertainty becomes manual recovery. Pre-existing or non-empty directories are never removed.

### 9.6 Recovery

On authority startup and project binding, the durable recovery barrier scans journal indexes before new work. Binding confirmation returns summaries of incomplete operations and recent receipts so the Editor never needs to remember an operation ID across restart.

Recovery classifies each file from both its journal state and prepared/final filesystem identity:

- `LINK_INTENT` plus absent final: not published; safe to continue rollback.
- `LINK_INTENT` plus final/prepared same inode: the operation created the final link; journal it as linked, then roll back.
- `LINK_INTENT` plus a different final inode: manual recovery.
- `LINKED` or `VERIFIED` plus missing final: external deletion; manual recovery, never silent cancellation.
- All items `VERIFIED`, final identities byte-equal, and no receipt: create the immutable receipt and finalize `COMMITTED`.
- A strict published subset whose final/prepared identities agree: resume rollback while retaining prepared links.
- `ROLLBACK_RENAME_INTENT` plus final present and quarantine absent: the rename did not occur; retry only after identity revalidation.
- `ROLLBACK_RENAME_INTENT` plus final absent and quarantine present: inspect the quarantined identity; matching prepared bytes may advance to `ROLLBACK_QUARANTINED`, while unexpected bytes are restored if and only if the final path is still absent.
- `ROLLBACK_RENAME_INTENT` with both paths present or both absent: manual recovery.
- `UNDO_RENAME_INTENT` plus final present and quarantine absent: undo has not moved that file and may retry after full-batch preflight.
- `UNDO_RENAME_INTENT` plus final absent and quarantine present: verify the quarantine against the receipt, then advance to `UNDO_QUARANTINED`; mismatch is restored only to an absent final path.
- `UNDO_QUARANTINED` or `UNDO_VERIFIED` plus final absent and matching quarantine: continue verification; when every item is verified, create the undo receipt and finalize `UNDONE`.
- Any undo state with both final and quarantine present, neither present, a changed quarantine, or an occupied restoration target: manual recovery with both paths preserved.
- Corrupt generations, missing prepared evidence before commit, changed identity, or unsafe path: `RECOVERY_REQUIRED`.

Recovery is explicit and idempotent. It never treats elapsed time alone as proof of stale ownership.

### 9.7 Undo

Undo is a new journaled mutation, not history deletion. It is available only for a `COMMITTED` receipt and only when all receipt targets exist and all current bytes, SHA-256 values, and filesystem identities match a fresh preflight. Any missing or changed file blocks the entire undo before visible-path mutation.

For each target, the authority journals `UNDO_RENAME_INTENT` with a unique private quarantine destination and atomically renames the current final pathname into `.surdet/asset-import/<operation-id>/undo/<item-id>.bin`. It journals `UNDO_QUARANTINED`, then verifies the quarantined device/inode, bytes, and SHA-256 against the receipt and records `UNDO_VERIFIED`. Whatever occupied the final path at the instant of rename is preserved; an external writer racing the preflight cannot be unlinked or discarded. A mismatch is renamed back when the final path remains absent and otherwise raises `RECOVERY_REQUIRED` with both paths preserved.

A successful undo verifies every final pathname absent, writes an immutable undo receipt, and marks `UNDONE`. Phase 2 retains undo quarantine bytes and does not provide a purge action; a later explicitly designed garbage-collection gate may remove them. Undo does not edit references because Phase 2 never creates references.

## 10. Public contracts

### 10.1 Planner input

```ts
export interface ProjectAssetImportStagedItem {
  operationId: string;
  itemId: string;
  sourceName: string;
  bytes: number;
  sha256: string;
  stagedItemFingerprint: string;
}

export interface ProjectAssetImportTargetRequest {
  itemId: string;
  kind: ProjectAssetKind;
  fileName: string;
}

export interface ProjectAssetImportTargetFact {
  path: string;
  state: 'absent' | 'exists-file' | 'exists-directory' | 'unsafe';
}
```

### 10.2 Planner output

```ts
export type ProjectAssetImportIssueCode =
  | 'IMPORT_NAME_INVALID'
  | 'IMPORT_FORMAT_UNSUPPORTED'
  | 'IMPORT_PORTRAIT_NAME_INVALID'
  | 'IMPORT_TARGET_DUPLICATE_IN_BATCH'
  | 'IMPORT_TARGET_EXISTS'
  | 'IMPORT_TARGET_UNSAFE';

export interface ProjectAssetImportPlanItem {
  itemId: string;
  sourceName: string;
  bytes: number;
  sha256: string;
  kind: ProjectAssetKind;
  fileName: string;
  targetPath: string;
  issues: ProjectAssetImportIssueCode[];
}

export interface ProjectAssetImportPlan {
  schemaVersion: 1;
  planId: string;
  planFingerprint: string;
  projectIdentity: string;
  status: 'blocked' | 'ready';
  items: ProjectAssetImportPlanItem[];
  issues: ProjectAssetImportIssueCode[];
  totalBytes: number;
}
```

The fingerprint covers the schema version, project identity, ordered staged identities, requested targets, target facts, and all issue codes. It never includes absolute project paths.

### 10.3 Receipt

```ts
export interface ProjectAssetImportReceipt {
  schemaVersion: 1;
  receiptId: string;
  receiptSha256: string;
  operationId: string;
  planId: string;
  planFingerprint: string;
  projectIdentity: string;
  status: 'COMMITTED';
  journalVersion: number;
  authorityContractVersion: 1;
  files: Array<{
    itemId: string;
    targetPath: string;
    bytes: number;
    sha256: string;
    fileIdentity: {
      device: string;
      inode: string;
      birthtimeNs: string;
    };
  }>;
  committedAt: string;
}

export interface ProjectAssetImportUndoReceipt {
  schemaVersion: 1;
  undoReceiptId: string;
  undoReceiptSha256: string;
  operationId: string;
  projectIdentity: string;
  status: 'UNDONE';
  journalVersion: number;
  removedPaths: string[];
  quarantinePaths: string[];
  undoneAt: string;
}
```

Receipt hashes are computed over canonical JSON with the hash field omitted. Receipts and undo receipts are create-only; an existing byte-equal record is an idempotent retry, while an existing different record is corruption and raises the project recovery barrier.

Machine contracts use stable English values. Editor copy maps them to Chinese and never displays the raw error code as the main message.

## 11. HTTP surface

The first contract exposes:

```text
POST   /status
POST   /binding/challenges
POST   /binding/challenges/:challengeId/confirm
POST   /binding/revoke
POST   /operations
PUT    /operations/:operationId/items/:itemId
POST   /operations/:operationId/plan
POST   /operations/:operationId/seal
POST   /operations/:operationId/commit
POST   /operations/:operationId/cancel
POST   /operations/query
POST   /operations/:operationId/query
POST   /operations/:operationId/resume
POST   /operations/:operationId/recover
POST   /operations/:operationId/undo
```

The server binds only `127.0.0.1`, never `0.0.0.0`, an external interface, or an IPv6 wildcard. The exact server origin is the only accepted `Origin`; missing, `null`, foreign, or malformed Origin is rejected. The server emits no CORS allow headers and rejects `OPTIONS` because every supported request is same-origin.

Tokens exist only in request headers:

```text
x-surdet-asset-import-authority  server-session token
x-surdet-project-binding        bound-project token
x-surdet-import-operation       operation token
```

Tokens never appear in URLs, cookies, Local Storage, logs, errors, or artifacts. The server-session token is at least 128 random bits, rotates on every authority start, and is required even for `/status` and challenge creation. A challenge-confirm response issues a project-binding token with 30 minutes idle lifetime and 8 hours maximum lifetime; root revalidation failure or server restart revokes it. The Editor may call `/binding/revoke` during an explicit project close, but unload delivery is best-effort and correctness always relies on server TTL and restart invalidation. An operation token is returned only by create or the explicit `resume` route, is scoped to one operation, and expires when the operation reaches a terminal state or the binding expires. A valid binding may request a fresh operation token for a discoverable incomplete operation or a committed receipt eligible for undo.

Challenge JSON is exact and closed:

```ts
type ProjectAssetImportOperationStatus =
  | 'UPLOADING' | 'STAGED' | 'READY' | 'PUBLISHING'
  | 'ROLLING_BACK' | 'ROLLED_BACK' | 'RECOVERY_REQUIRED'
  | 'COMMITTED' | 'UNDOING' | 'UNDONE' | 'CANCELLED';
type PendingOperationStatus = Exclude<
  ProjectAssetImportOperationStatus,
  'ROLLED_BACK' | 'COMMITTED' | 'UNDONE' | 'CANCELLED'
>;
type OperationSummary = {
  operationId: string;
  status: ProjectAssetImportOperationStatus;
  itemCount: number;
  updatedAt: string;
  manualRecoveryRequired: boolean;
};
type ReceiptSummary = {
  operationId: string;
  receiptId: string;
  status: 'COMMITTED' | 'UNDONE';
  fileCount: number;
  committedAt: string;
};
type CreateBindingChallengeRequest = { browserSessionId: string };
type CreateBindingChallengeResponse = {
  challengeId: string;
  relativeProbePath: string;
  expiresAt: string;
};
type ConfirmBindingChallengeRequest = {
  browserSessionId: string;
  nonce: string;
};
type ConfirmBindingChallengeResponse = {
  projectIdentity: string;
  projectName: string;
  bindingToken: string;
  bindingExpiresAt: string;
  recoveryBarrier: 'clear' | 'recoverable' | 'manual-recovery';
  pendingOperations: Array<OperationSummary & { status: PendingOperationStatus }>;
  recentReceipts: ReceiptSummary[];
};
```

Operation creation is exact and closed:

```ts
type CreateImportOperationRequest = {
  operationId: string;
  items: Array<{ itemId: string; sourceName: string; declaredBytes: number }>;
};
type CreateImportOperationResponse = {
  operationId: string;
  operationToken: string;
  status: 'UPLOADING';
  expiresAt: string;
};
type StatusRequest = { browserSessionId: string };
type StatusResponse = {
  authorityContractVersion: 1;
  authorityAvailable: true;
  projectIdentity: string;
  bindingRequired: boolean;
};
type ListOperationsRequest = Record<string, never>;
type ListOperationsResponse = {
  pendingOperations: Array<OperationSummary & { status: PendingOperationStatus }>;
  recentReceipts: ReceiptSummary[];
};
type OperationDetailResponse = {
  operation: OperationSummary;
  plan: ProjectAssetImportPlan | null;
  receipt: ProjectAssetImportReceipt | null;
  undoReceipt: ProjectAssetImportUndoReceipt | null;
  allowedActions: Array<'upload' | 'plan' | 'seal' | 'commit' | 'cancel' | 'resume' | 'recover' | 'undo'>;
};
type QueryOperationRequest = Record<string, never>;
type PlanOperationRequest = { targets: ProjectAssetImportTargetRequest[] };
type PlanOperationResponse = { operationId: string; status: 'STAGED' | 'READY'; plan: ProjectAssetImportPlan };
type SealOperationRequest = { planFingerprint: string };
type SealOperationResponse = { operationId: string; status: 'READY'; planId: string; planFingerprint: string };
type CommitOperationRequest = { planFingerprint: string };
type CommitOperationResponse = { operation: OperationSummary; receipt: ProjectAssetImportReceipt };
type CancelOperationRequest = Record<string, never>;
type CancelOperationResponse = { operation: OperationSummary & { status: 'CANCELLED' | 'ROLLED_BACK' } };
type ResumeOperationRequest = Record<string, never>;
type ResumeOperationResponse = { operationToken: string; expiresAt: string; detail: OperationDetailResponse };
type RecoverOperationRequest = { action: 'resume' | 'rollback' };
type RecoverOperationResponse = { detail: OperationDetailResponse };
type UndoOperationRequest = { receiptId: string; receiptSha256: string };
type UndoOperationResponse = { operation: OperationSummary; undoReceipt: ProjectAssetImportUndoReceipt };
type RevokeBindingRequest = { browserSessionId: string };
type RevokeBindingResponse = { revoked: true };

type AuthorityErrorCode =
  | 'INVALID_REQUEST'
  | 'AUTHORITY_ORIGIN_REJECTED'
  | 'AUTHORITY_TOKEN_REJECTED'
  | 'AUTHORITY_UNAVAILABLE'
  | 'PROJECT_ROOT_IDENTITY_UNAVAILABLE'
  | 'PROJECT_IDENTITY_MISMATCH'
  | 'PROJECT_BUSY'
  | 'IMPORT_FILESYSTEM_UNSUPPORTED'
  | 'IMPORT_OPERATION_NOT_FOUND'
  | 'IMPORT_OPERATION_CONFLICT'
  | 'IMPORT_PLAN_BLOCKED'
  | 'IMPORT_PLAN_STALE'
  | 'IMPORT_TARGET_EXISTS'
  | 'IMPORT_TARGET_UNSAFE'
  | 'IMPORT_UPLOAD_MISMATCH'
  | 'IMPORT_LIMIT_EXCEEDED'
  | 'IMPORT_RECOVERY_REQUIRED'
  | 'IMPORT_UNDO_BLOCKED_CHANGED';
type AuthorityRetryDisposition = 'same-request' | 'after-refresh' | 'after-human-action' | 'manual-recovery' | 'never';
type AuthorityErrorEnvelope = {
  ok: false;
  error: {
    code: AuthorityErrorCode;
    messageKey: string;
    retryDisposition: AuthorityRetryDisposition;
    details?: { operationId?: string; itemId?: string; field?: string };
  };
};
type AuthoritySuccessEnvelope<T> = { ok: true; data: T };
```

All JSON requests are exact closed objects; unknown keys fail schema validation. Every successful JSON response is `AuthoritySuccessEnvelope<T>` using the route's response type above. Every protocol, origin, token, schema, business, and 503 failure is `AuthorityErrorEnvelope`; `details` accepts only the three safe identifiers shown above and never contains a path, token, stack, source name, or staged identity. The Editor maps `code`/`messageKey` to Chinese and does not show raw machine text as its primary message. `resume` only obtains a fresh operation token and current detail; it never commits, rolls back, or undoes automatically. `/operations/query` is project-binding scoped and returns incomplete operations plus committed/undone receipt summaries without absolute paths or staged identities. `/operations/:operationId/query` returns terminal states as well as pending states. These routes are the authoritative restart-discovery surface.

Binary upload uses `application/octet-stream`. The operation manifest's `declaredBytes` is the expected length, while the authority's stream counter is authoritative. A browser-controlled `Content-Length` is not required; when the user agent supplies it, it must match the manifest before streaming. Chunked transfer is allowed, non-identity `Content-Encoding` is rejected with 415, measured short/long bodies fail with `IMPORT_UPLOAD_MISMATCH`, and 30 seconds without body progress fails with 408. Streaming uses Node pipeline backpressure, stops immediately beyond the declared or global limit, and deletes only the exact partial staged file after closing the stream.

JSON bodies are limited to 1 MiB. One operation is limited to 512 files, 2 GiB per file, and 8 GiB total. At most one upload mutates one operation at a time, at most two upload streams run per authority, uncommitted staging is limited to 16 GiB per project, and excess returns 429/413 without project mutation. Limits are enforced before and during streaming. Operation state transitions are operation-lock serialized, so concurrent requests cannot reuse a journal generation or stage path.

Stable errors include:

```text
INVALID_REQUEST
AUTHORITY_ORIGIN_REJECTED
AUTHORITY_TOKEN_REJECTED
AUTHORITY_UNAVAILABLE
PROJECT_ROOT_IDENTITY_UNAVAILABLE
PROJECT_IDENTITY_MISMATCH
PROJECT_BUSY
IMPORT_FILESYSTEM_UNSUPPORTED
IMPORT_OPERATION_NOT_FOUND
IMPORT_OPERATION_CONFLICT
IMPORT_PLAN_BLOCKED
IMPORT_PLAN_STALE
IMPORT_TARGET_EXISTS
IMPORT_TARGET_UNSAFE
IMPORT_UPLOAD_MISMATCH
IMPORT_LIMIT_EXCEEDED
IMPORT_RECOVERY_REQUIRED
IMPORT_UNDO_BLOCKED_CHANGED
```

The HTTP/status mapping is fixed:

| Error family | HTTP | Retry disposition |
| --- | ---: | --- |
| malformed/schema/method/content/origin/token | 400/401/403/405/415 | `after-human-action` |
| `IMPORT_LIMIT_EXCEEDED` | 413 or 429 | `after-human-action` |
| `IMPORT_OPERATION_NOT_FOUND` | 404 | `after-refresh` |
| `PROJECT_BUSY` | 409 | `after-refresh` |
| project mismatch, stale plan, target exists, operation conflict | 409 | `after-human-action` |
| plan blocked or upload mismatch | 422 | `after-human-action` |
| `IMPORT_RECOVERY_REQUIRED` | 409 | `manual-recovery` |
| authority unavailable | 503 | `same-request` |

Protocol/schema failures do not return a success-shaped body. Business failures return a stable error envelope. Commit, cancel, recover, and undo are idempotent: a lost HTTP response followed by the same operation request returns the existing terminal receipt/status and never starts a second mutation.

## 12. Editor interaction design

### 12.1 Entry

The Asset Center header gains one stable primary action: `导入素材`. It is not a floating viewport button.

- Bound authority: enabled.
- No authority: disabled with `本机写入服务未连接；素材浏览仍可使用`.
- Project mismatch: disabled with `当前项目与本机写入服务不是同一目录`.
- Recovery required: replaced by `处理未完成的导入`.

Entry-state priority is deterministic:

1. No injected authority or failed `/status`: unavailable; no recovery button is shown because it cannot work.
2. Authority available but no valid project binding or wrong directory: bind/mismatch guidance.
3. Valid binding with `manual-recovery` barrier: only `查看恢复详情`; new import and automatic recovery are blocked.
4. Valid binding with recoverable incomplete operation: `处理未完成的导入`.
5. Valid binding with clear barrier: `导入素材`.

An unavailable authority never masks the read-only library; a recovery state never exposes a dead import button.

### 12.2 In-place workbench

Import opens as an in-place sub-workbench, not a generic floating modal:

```text
素材中心 / 导入素材
┌──────────────┬─────────────────────────────────┬──────────────────────┐
│ 待导入文件   │ 文件、归类、最终名称、目标位置  │ 预览与问题说明       │
│ 12           │                                 │                      │
└──────────────┴─────────────────────────────────┴──────────────────────┘
│ 取消导入                         已就绪 10 · 需处理 2   准备导入 │
```

The workbench is a three-row grid: heading, independently scrollable content, and action row. The action row is the final grid row, not `position: fixed`, not sticky over content, and not part of the item scroll. It therefore stays in one stable location without covering cards. The content region owns sufficient focus scroll margin, and the 800 px layout keeps the same three-row structure while stacking inspector content inside the middle row.

The selected Asset Center category preselects a destination kind. When no category is selected, ambiguous images and audio remain `请选择归类`; the Editor never guesses that an image is a background or that an MP3 is music.

Each row shows:

- source filename and size;
- Chinese category selector;
- editable final filename;
- destination preview such as `素材 / 背景 / station.webp`;
- one concise readiness statement;
- expanded technical detail only on demand.

The category labels are frozen:

| Machine value | Human label |
| --- | --- |
| `background` | 背景 |
| `portrait` | 立绘 |
| `avatar` | 头像 |
| `music` | 音乐 |
| `ambience` | 环境音 |
| `sound-effect` | 音效 |
| `voice` | 语音 |
| `video` | 视频 |
| `font` | 字体 |
| `other` | 其他 |

Primary copy, validation messages, actions, recovery summaries, and empty states use these labels and never fall back to machine English. Stable machine values remain available in DOM data attributes and expanded technical details for Agent/test readability.

### 12.3 Commit and result

The primary action progresses through stable labels:

```text
准备导入 -> 正在上传 -> 正在写入项目 -> 导入完成
```

The final result shows imported count, total bytes, `查看已导入素材`, and `撤销本次导入`. Before undo, the UI states `撤销会把这些文件移出素材库，并由 Surdet 保留恢复副本；不会改动后来修改过的文件。` After success it states `已撤销，恢复副本仍由 Surdet 保留。` A failed or interrupted operation names the first blocked stage and the next safe action. It never displays an optimistic success toast before the committed receipt is read back.

### 12.4 Visual and accessibility constraints

- Preserve the established editorial workbench tokens and spacing.
- No gradient, glass surface, decorative metric cards, colored selection rails, or category rainbow.
- Do not reduce body copy below the current readable scale.
- All rows, inputs, selectors, progress, and recovery actions are keyboard reachable.
- Focus returns to the affected row after validation rerender.
- Progress and state are exposed through text plus `aria-live`; color is secondary.
- The import list uses `role="list"`; each file card uses `role="listitem"`. Selection controls are native buttons or inputs, never clickable generic containers. Enter activates the focused primary button; Space toggles native checkboxes only.
- Validation messages have stable IDs referenced by the corresponding field's `aria-describedby`; invalid fields set `aria-invalid="true"`. The first invalid field receives focus only after an explicit submit, not during typing.
- Progress and recovery summaries use one `aria-live="polite"` region. A transition into manual recovery additionally moves focus to the recovery heading; routine byte progress never uses `assertive`.
- Reduced-motion mode receives no progress animation beyond text updates.
- At 1440 px all three regions remain visible; at 1024 px the inspector narrows; at 800 px the inspector follows the table and the action row remains reachable without horizontal scrolling.

## 13. Failure behavior

- Authority unavailable: read-only Asset Center remains fully usable.
- Project binding mismatch: no upload or write; explain how to reopen the bound project.
- Unsupported/invalid name: block that item before upload can be sealed.
- Existing target: block; require a new name; never offer `覆盖`.
- Upload interruption: project remains unchanged; same operation/item may resume only with byte-equal content.
- Plan stale: project remains unchanged; refresh target facts and create a new plan fingerprint.
- Project busy: preserve operation and retry only after lease refresh.
- Publish failure with successful rollback: report `导入未完成，项目已恢复`.
- Rollback uncertainty: report `需要人工恢复`, preserve evidence, and block all new imports for that project.
- Browser closes after commit: the authority receipt remains authoritative and the next binding can reopen it.
- UI refresh failure after committed receipt: report committed result and offer `重新载入素材中心`; never attempt a second commit.

## 14. Test and evidence strategy

### 14.1 Authoring permanent tests

Cover deterministic planning, directory mapping, NFC normalization, Chinese filenames, Windows reserved names, path separators, case-fold duplicates, within-batch duplicates, existing targets, unsupported extensions, strict portrait naming, item ordering, plan status, and fingerprint stability.

### 14.2 Node authority permanent tests

Cover canonical root replacement at the same path, parent replacement, zero/unstable directory identity, root confinement, project/data/internal-workspace symlink or junction parents, challenge binding and cleanup, wrong project, wrong/missing/null Origin, token/header/method/content type, JSON and binary limits, chunked/encoded/short/long/stalled uploads, streaming SHA-256, global/project quotas, upload idempotency, operation-mutex contention, operation conflicts, stale plans, target races, lifetime authority-lease contention, hard-link capability, every pre/post-link crash window, durable recovery barrier, exact journal generations, operation discovery after restart, success/undo receipt identity, quarantine preservation, cleanup, launcher strict-port behavior, unbound dev/preview behavior, and no absolute-path or token disclosure.

Fault injection must stop after each meaningful publication/journal step. Every state is inspected to prove one of:

- zero published targets;
- all targets committed and byte-equal;
- rollback completed to zero;
- explicit manual recovery with evidence preserved.

Undo tests cover unchanged success, any changed target blocking the whole undo, any missing target blocking, interrupted undo recovery, and second undo idempotency.

Stable fault-point IDs are:

```text
after_probe_create_before_created_journal
after_upload_file_close_before_journal
after_prepare_intent_before_file
after_prepare_file_before_journal
after_parent_intent_before_mkdir
after_mkdir_before_parent_journal
after_link_intent_before_link
after_final_link_before_linked_journal
after_linked_journal_before_verify
after_verify_before_verified_journal
after_receipt_create_before_committed_journal
after_rollback_rename_intent_before_rename
after_rollback_final_rename_before_quarantined_journal
after_undo_rename_intent_before_rename
after_undo_final_rename_before_quarantined_journal
after_undo_quarantine_verify_before_undo_receipt
```

Fault injection exists only as a constructor dependency in tests. The browser runner starts a dedicated child authority with an injected callback and may terminate that child at one stable point. Production Vite options, HTTP routes, headers, environment variables, and Agent capabilities expose no fault switch.

Every injected run records expected point, last durable journal generation, per-file journal state, prepared/final/quarantine filesystem identities, project content snapshot before and after, internal-workspace snapshot, receipt state, lease state, recovery barrier, child exit, restart result, and first unexpected error. A fault-point run passes only when its exact recovery outcome matches the matrix; expected injected termination is not counted as a hidden real error.

### 14.3 Editor permanent tests

Cover unavailable/mismatch/recovery entry states, Chinese workbench copy, category preselection, ambiguous kinds, name editing, conflict presentation, no overwrite control, fixed action row, upload progress, committed receipt reopening, exact undo blocking, focus retention, object URL cleanup, and Asset Center refresh.

### 14.4 Real browser flow

One isolated authority-bound fixture must prove:

1. Wrong directory binding fails before upload.
2. Correct directory binding leaves the project tree unchanged after probe cleanup.
3. Multiple valid files reach ready state with explicit categories and names.
4. Existing target and case-only collision are blocked without mutation.
5. Commit creates only the planned files with exact hashes.
6. Shared Asset Center truth refreshes and selects an imported item.
7. A committed receipt survives page reload.
8. Undo removes only unchanged receipt paths from `content/assets`, retains exact quarantine evidence, and refreshes the Asset Center.
9. A modified imported file blocks the whole undo without deletion.
10. Injected mid-publish failure recovers to zero published targets.
11. All errors, protocol, console, page, request, stderr, cleanup, lease, probe, staging, and project-mutation channels reconcile with the expected state.
12. 1440/1024/800 layouts retain readable rows, inspector, and action region.

No test may point at the repository, the user's active game project, or a previous acceptance fixture. All write-path evidence uses a new temporary project copied from a sealed fixture.

### 14.5 Proportional completion gate

The implementation keeps an append-only execution section in its taskbook, but does not manufacture a separate evidence archive. Completion requires one fresh run of each affected workspace's focused tests, typecheck, and build; one isolated browser flow covering the real import and undo path; and one aggregate `verify:all` because this feature crosses Authoring, CLI, and Editor. A failed real gate is reported as failed and investigated from its original output; the same command is not repeated merely to obtain a green result.

Tests use only disposable fixture projects and isolated data roots. No test or acceptance action may write the repository, Starter, or a user's active game project.

## 15. Delivery order

1. Pure Authoring contracts and planner.
2. Binary staging storage, journal, receipt, and recovery core.
3. Project binding challenge and same-origin HTTP boundary.
4. The new `surdet-editor` `dev:project` launcher, strict port ownership, exact root option, and proof that ordinary dev/preview remain unbound.
5. Editor client and import state model.
6. Chinese in-place import workbench.
7. Commit, receipt reopening, undo, and refresh integration.
8. Permanent fault-injection matrix and browser flow.
9. Independent code review, aggregate verification, taskbook closeout, long-term ledger update, and separately authorized ordinary push.

Each implementation task must establish a focused RED before production code. A later green test does not erase an earlier failed artifact.

## 16. Completion boundary

The gate is complete only when:

- all planner, authority, Editor, recovery, and undo contracts are permanent-test green;
- an isolated real browser proves binding, import, receipt, refresh, undo, wrong-directory rejection, conflict blocking, and fault recovery;
- affected workspaces pass proportional tests, typecheck, and build;
- one aggregate verification runs against the final implementation;
- an independent review finds no BLOCKER or HIGH issue;
- the long-term ledger is append-only updated after reviewed closure;
- any ordinary push has separate authorization and succeeds without force.

Completion does not imply codec validation, asset conversion, reference generation, existing-file replacement, general file management, desktop Editor packaging, deployment, Frontend Pass 5, or Wave 7.

```text
PROJECT_ASSET_IMPORT_AUTHORITY_DESIGN = APPROVED
IMPLEMENTATION_TASKBOOK = NOT_STARTED
PROJECT_BINDING = NOT_IMPLEMENTED
NEW_FILE_ONLY_IMPORT = NOT_IMPLEMENTED
RECOVERABLE_IMPORT_TRANSACTION = NOT_IMPLEMENTED
IMPORT_RECEIPT = NOT_IMPLEMENTED
EXACT_FINGERPRINT_UNDO = NOT_IMPLEMENTED
EXISTING_ASSET_OVERWRITE = NOT_SUPPORTED
EXISTING_ASSET_DELETE = NOT_SUPPORTED
AGENT_IMPORT_COMMIT = NOT_EXPOSED
DEPLOYMENT = NOT_PERFORMED
FRONTEND_PASS_5 = NOT_STARTED
WAVE_7 = NOT_STARTED
```
