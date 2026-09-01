# Surdet Asset Center — Read-only Intelligence Implementation Plan

> **For agentic workers:** execute task by task, preserve the append-only evidence ledger, and stop only at a real safety or correctness boundary. The Owner has pre-authorized design, implementation, proportional verification, exact scoped commits, and ordinary push. Destructive asset operations, history rewrites, release/deployment, and scope expansion remain unauthorized.

**Goal:** Deliver a Chinese-first, read-only Asset Center backed by one shared Authoring asset projection, while preserving all existing Editor and Agent behavior.

**Architecture:** `@surdet/authoring` owns deterministic physical-file classification, stable identity, references, issues, and totals. CLI enriches existing `project.assets` metadata with root-confined file sizes. Editor supplies browser handles only for selected-file preview and renders a dedicated top-level three-region Asset Center. The Script sidebar becomes a compact consumer of the same shared truth.

**Tech Stack:** TypeScript 5.7, `@surdet/core` compiled scene/timeline contracts, `@surdet/authoring`, File System Access API, Vite 6, Vitest, Microsoft Playwright CLI, existing Surdet visual tokens and editorial workspace shell.

**Approved design:** `docs/superpowers/specs/2026-09-01-surdet-asset-center-read-only-intelligence-design.md`

## Global constraints

- `content/assets` is the only game asset root in this gate. Do not mix `public` into asset truth.
- Physical project-relative path is identity. A semantic key never overwrites or collapses another path.
- Keep `project.assets.backgrounds`, `portraits`, and `avatars` compatible for current Agent/timeline callers.
- The new intelligence projection is additive and byte-equal between `project.assets` and `project.inspect.assets`.
- The additive Agent asset projection contains structured metadata only. It adds no binary bytes, browser handles, object URLs, arbitrary read capability, or absolute asset path; the pre-existing top-level project identity remains unchanged.
- Editor primary UI is natural Chinese. Stable English enums remain protocol/data attributes and collapsed technical information.
- No import, move, rename, replace, delete, deduplicate, batch cleanup, automatic repair, package-policy write, cache database, or project-format migration.
- No hash-all pass. Ordinary inspection reads directory metadata only; preview reads only the selected local file.
- Preserve existing Script asset insert/copy/undo behavior and all existing main workspaces.
- Do not change Core runtime behavior, Renderer, Host, Shell runtime protocol, Starter, Zero content, save-game format, dependencies, lockfile, or performance thresholds.
- Do not modify, stage, commit, delete, or move protected files. Keep the long-term roadmap ledger intentionally untracked until reviewed closeout.
- Do not clean existing unrelated untracked files or historical artifacts.
- Use exact scoped staging. Never use `git add .` or broad globs.
- One final `verify:all` is appropriate because the feature changes Authoring, CLI, and Editor public surfaces. Preserve and report a first failure honestly; do not loop the aggregate to manufacture green.
- Ordinary push is authorized only after tests, browser evidence, independent Luna review, exact staged-diff review, and clean tracked worktree.
- No deploy, release, Wave 7, Frontend Pass 5, force push, rebase, reset, amend, squash, or destructive filesystem operation.

## Risk classification

This is a C-level cross-layer read contract and UI task:

- shared public metadata grows additively;
- the Editor changes main-mode navigation and project scanning facts;
- all asset operations remain read-only;
- project and binary contents are never rewritten.

Required evidence is therefore permanent unit/integration coverage, affected workspace typecheck/build, one real isolated browser path, one aggregate gate, and independent diff review. Release matrices and destructive acceptance are not required.

## Planned commit sequence

1. `docs(editor): design read-only asset center`
2. `feat(authoring): index project asset intelligence`
3. `feat(cli): expose project asset facts`
4. `feat(editor): add asset center workspace`
5. `test(editor): verify asset center workflow`
6. `docs(editor): close asset center read-only gate`

Small corrective commits may be added only for concrete findings with focused RED→GREEN evidence.

## Delegation boundary

The General Manager owns the selected architecture, shared contracts, CLI exposure, Editor integration, security boundary, final browser evidence, exact commits, completion claims, and push. Luna workers may independently audit or own disjoint test/fixture files after an explicit assignment. They may not change shared production contracts, stage broad paths, commit, push, or reinterpret the approved design. Every worker diff is reread by the General Manager.

---

### Task 0: Freeze baseline, scope, and design evidence

**Files:**
- Add: `docs/superpowers/specs/2026-09-01-surdet-asset-center-read-only-intelligence-design.md`
- Add/modify: `docs/superpowers/plans/2026-09-01-surdet-asset-center-read-only-intelligence.md`
- Read only: existing asset, navigation, project storage, and LetsGal installation files

**Produces:** exact baseline, alternatives, scope inventory, and one approved implementation contract.

- [ ] **Step 1: Record Git baseline**

Run:

```powershell
git rev-parse HEAD HEAD^ surdet/main
git rev-list --left-right --count surdet/main...HEAD
git status --short
git diff --check
git diff --cached --check
```

Expected: tracked and staging clean; only established unrelated untracked paths exist.

- [ ] **Step 2: Record the three-source audit**

Append concise confirmed facts from:

1. Authoring/CLI asset catalog and Agent contract;
2. Editor directory/gallery/script inventory and UI entry;
3. LetsGal visible asset-management information architecture.

Explicitly record the limit: the LetsGal audit covers the installed 1.9.7 asset workflow, not every runtime feature or private implementation detail.

- [ ] **Step 3: Freeze selected architecture**

The plan must reject both an Editor-only expansion and a persistent cache/database. It must name `content/assets` as root, physical path as identity, shared Authoring projection as authority, and first release as read-only.

- [ ] **Step 4: Review and commit documents**

Review both documents for false claims, unsupported features, hidden writes, contract ambiguity, and AI-style UI language. Run both diff checks, stage only the two new documents, inspect `git diff --cached --name-status`, and commit:

```text
docs(editor): design read-only asset center
```

---

### Task 1: Shared asset intelligence contract and deterministic builder

**Files:**
- Add: `packages/authoring/src/asset-intelligence.ts`
- Modify: `packages/authoring/src/asset-catalog.ts`
- Modify: `packages/authoring/src/contracts.ts`
- Modify: `packages/authoring/src/index.ts`
- Modify: `packages/authoring/src/object-index.ts`
- Modify: `packages/authoring/src/capability-registry.ts`
- Add: `packages/authoring/test/asset-intelligence.test.ts`
- Modify: `packages/authoring/test/asset-catalog.test.ts`
- Modify: `packages/authoring/test/capability-registry.test.ts`

**Consumes:** `ProjectSnapshot`, compiled scene instructions, timeline documents, game config, optional gallery config adapter, normalized physical file facts.

**Produces:** `ProjectAssetIntelligence`, additive `ProjectAssetCatalog.intelligence`, deterministic issues and totals, unchanged legacy arrays.

- [ ] **Step 1: Write permanent RED contracts**

Create a fixture containing:

- one used background;
- one unused background;
- two same-key background files in different subdirectories;
- valid and invalid portrait names;
- avatar, music, ambience, sound effect, voice, video, font, and unknown file;
- one unsupported extension;
- a missing background reference;
- character avatar reference;
- scene direct references with source lines;
- timeline background/portrait references;
- gallery CG/music source references;
- optional bytes on some but not all files.

Require:

```ts
expect(result.items.map((item) => item.assetId)).toEqual([...stableIds]);
expect(result.items.filter((item) => item.key === 'castle_hall')).toHaveLength(2);
expect(result.summary.totalBytes).toBe(expectedMeasuredBytes);
expect(result.issues.map((issue) => issue.code)).toContain('ASSET_REFERENCE_MISSING');
expect(result.issues.map((issue) => issue.code)).toContain('ASSET_KEY_DUPLICATE');
expect(result.issues.map((issue) => issue.code)).toContain('ASSET_NAME_INVALID');
expect(result.issues.map((issue) => issue.code)).toContain('ASSET_FORMAT_UNSUPPORTED');
expect(result.issues.map((issue) => issue.code)).toContain('ASSET_UNUSED');
```

Also require a second input with the same facts in reverse order to produce deep-equal output.

- [ ] **Step 2: Run Task 1 RED once**

```powershell
npm run test -w @surdet/authoring -- --run test/asset-intelligence.test.ts test/asset-catalog.test.ts test/capability-registry.test.ts
```

Expected: missing module/types/schema fail. Preserve the exact first failure in the taskbook.

- [ ] **Step 3: Implement path normalization and classification**

Rules:

- accept project-relative `/` paths only;
- ignore files outside `content/assets/`;
- reject traversal and empty relative names from the projection;
- classify known directories and retain unknown directories as `other`;
- use strict three-segment portrait parsing;
- retain invalid physical files with `ASSET_NAME_INVALID`;
- use kind-specific extension recognition;
- never read binary content.

- [ ] **Step 4: Implement reference extraction**

Extract exact, sorted references from:

```text
scene: bg, show, bgm, ambience, se, voice, video
timeline: background set; portrait show/expression
character: avatar declaration
gallery: cgs[].src; music[].src
```

Preserve source path/line and a stable reference ID. Missing references become synthetic items. Duplicate matches attach to every physical item and do not choose a winner.

- [ ] **Step 5: Implement issues and totals**

Calculate totals from physical items only. `totalBytes` is the sum of measured bytes and is omitted only when no byte fact exists. Keep separate counts for referenced, unused, missing, duplicated, unsupported, and invalid names.

- [ ] **Step 6: Extend legacy catalog additively**

Keep current `backgrounds`, `portraits`, and `avatars` content and order. Add `intelligence`. Update strict output schema without exposing binary or absolute-path fields. Make `inspectProject()` pass its snapshot into the shared builder.

- [ ] **Step 7: Run Task 1 GREEN and workspace gates**

```powershell
npm run test -w @surdet/authoring -- --run test/asset-intelligence.test.ts test/asset-catalog.test.ts test/capability-registry.test.ts
npm run test -w @surdet/authoring
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
```

Expected: all pass; no snapshot, validation, simulation, or change semantics regress.

- [ ] **Step 8: Exact commit**

Stage only Task 1 files, review cached diff and both diff checks, then commit:

```text
feat(authoring): index project asset intelligence
```

---

### Task 2: Root-confined CLI file facts and Agent projection

**Files:**
- Modify: `packages/cli/src/authoring/node-project-storage.ts`
- Modify: `packages/cli/src/authoring/authoring-service.ts`
- Add: `packages/cli/test/node-project-asset-facts.test.ts`
- Modify: `packages/cli/test/authoring-presentation-wave2.test.ts`
- Modify: `packages/cli/test/authoring-project-config-wave3.test.ts`
- Modify: `packages/cli/test/agent-port-output-contract.test.ts`

**Consumes:** enumerated, root-confined file paths and the shared builder.

**Produces:** byte-size facts for physical assets; byte-equal enriched `project.assets` and `project.inspect.assets`; unchanged Agent binary-read boundary.

- [ ] **Step 1: Write CLI RED tests**

Require `NodeProjectStorage` to return sorted `{ path, bytes }` for regular enumerated asset files. Cover:

- nested file;
- zero-byte file;
- non-asset path filtered by caller;
- missing file after enumeration failing loud;
- symlink/reparse escape preserving the existing safe-path error;
- no file contents returned.

Require service output:

```ts
expect(projectAssets.result).toEqual(projectInspect.result.assets);
expect(projectAssets.result.intelligence.summary.totalBytes).toBe(fixtureBytes);
expect(JSON.stringify(projectAssets)).not.toContain(projectRootAbsolutePath);
```

- [ ] **Step 2: Run Task 2 RED once**

```powershell
npm run test -w @surdet/cli -- --run test/node-project-asset-facts.test.ts test/authoring-presentation-wave2.test.ts test/authoring-project-config-wave3.test.ts test/agent-port-output-contract.test.ts
```

- [ ] **Step 3: Implement safe metadata read**

Add one read-only method on concrete `NodeProjectStorage`; do not widen the general text `ProjectStorage` interface. The method must resolve through existing root checks, reject symlinks/non-regular files, and use filesystem stat metadata only.

- [ ] **Step 4: Integrate service context**

Enumerate once under the existing project lease, derive `content/assets` paths, read byte facts, and pass the same snapshot/facts to both service methods. Do not include asset bytes in snapshot revision.

- [ ] **Step 5: Run CLI GREEN and workspace gates**

```powershell
npm run test -w @surdet/cli -- --run test/node-project-asset-facts.test.ts test/authoring-presentation-wave2.test.ts test/authoring-project-config-wave3.test.ts test/agent-port-output-contract.test.ts
npm run test -w @surdet/cli
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

- [ ] **Step 6: Exact commit**

Stage only Task 2 files and commit:

```text
feat(cli): expose project asset facts
```

---

### Task 3: Editor physical facts and shared state

**Files:**
- Modify: `packages/editor/src/assets.ts`
- Modify: `packages/editor/src/project-io.ts`
- Modify: `packages/editor/src/authoring-project-storage.ts`
- Modify: `packages/editor/src/state.ts`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/test/assets.test.ts`
- Modify: `packages/editor/test/project-io.test.ts`
- Modify: `packages/editor/test/presentation-asset-catalog.test.ts`

**Produces:** source paths and byte facts on browser directory entries; shared intelligence stored after Authoring snapshot rebuild; project-reset-safe selection.

- [ ] **Step 1: Write Editor model RED tests**

Require directory scanning to preserve normalized `sourcePath`, `bytes`, `lastModified`, handle, kind, and portrait variant. Require same-key paths to remain distinct.

Require project reset to clear prior asset intelligence, query/filter selection, and preview selection while retaining unrelated Editor defaults.

- [ ] **Step 2: Run Task 3 RED once**

```powershell
npm run test -w @surdet/editor -- --run test/assets.test.ts test/project-io.test.ts test/presentation-asset-catalog.test.ts
```

- [ ] **Step 3: Enrich `DirAsset` without binary reads**

During the existing asynchronous directory walk, call `getFile()` for metadata only. Record normalized project-relative path and size. Do not call `arrayBuffer()`, `text()`, image decode, or media probing.

- [ ] **Step 4: Build shared intelligence with the Authoring snapshot**

In the existing debounced rebuild, build the object index and asset intelligence from the same snapshot. Reconcile selected asset by exact `assetId`; clear it if absent. Failed rebuild sets an honest unavailable state and does not retain stale facts as fresh.

- [ ] **Step 5: Migrate Editor-only inventory helper**

Retire `buildAssetInventory()` as semantic authority. Preserve only:

- browser directory-kind adapter;
- shared-item to insertion-line adapter;
- shared-item to preview-handle lookup;
- Chinese labels.

Any temporary adapter must consume `ProjectAssetItem` and may not rescan scenes/gallery independently.

- [ ] **Step 6: Run Task 3 GREEN and Editor gates**

```powershell
npm run test -w @surdet/editor -- --run test/assets.test.ts test/project-io.test.ts test/presentation-asset-catalog.test.ts
npm run typecheck -w @surdet/editor
npm run build -w @surdet/editor
```

---

### Task 4: Top-level Chinese Asset Center workspace

**Files:**
- Modify: `packages/editor/src/shell/editor-modes.ts`
- Modify: `packages/editor/src/main.ts`
- Add: `packages/editor/src/panels/asset-center.ts`
- Modify: `packages/editor/src/panels/assets.ts`
- Modify: `packages/editor/index.html`
- Add: `packages/editor/src/styles/asset-center.css`
- Add: `packages/editor/test/editor-asset-center-contract.test.ts`
- Modify: `packages/editor/test/editor-asset-sidebar-contract.test.ts`
- Modify: `packages/editor/test/editor-visual-token-contract.test.ts`

**Produces:** a dedicated top-level `素材` mode, compact shared-truth sidebar, searchable/filterable library, fixed inspector, previews, and reference navigation.

- [ ] **Step 1: Write UI contract RED tests**

Freeze these requirements:

- `assets` is a real `EditorModeId` between Script and Flow;
- mode panel ID is stable;
- stylesheet loads after shared shell/workspace layers;
- no colored selection edge, gradient, glass blur, or inline style positioning;
- primary visible labels are Chinese;
- `data-asset-id`, `data-asset-kind`, `data-asset-status`, `data-source-path`, and optional `data-source-line` exist;
- asset rows use keyboard-reachable native controls and `aria-selected`;
- inspector is persistent, not hover-only;
- avatar and ambience have visible categories;
- technical fields live in a disclosure;
- old sidebar consumes shared items and preserves insert/copy actions.

- [ ] **Step 2: Run Task 4 RED once**

```powershell
npm run test -w @surdet/editor -- --run test/editor-asset-center-contract.test.ts test/editor-asset-sidebar-contract.test.ts test/editor-visual-token-contract.test.ts
```

- [ ] **Step 3: Add shell mode and workspace frame**

Add the mode without changing other IDs. Render an `asset-center-view` section. Handle four explicit states:

```text
未打开项目
正在整理素材
素材事实可用
素材事实暂时不可用
```

- [ ] **Step 4: Build header and overview**

Header contains title, one-sentence explanation, search, list/grid view switch, and filter summary. Overview shows files, measured size, referenced, unused, and problems as one editorial strip—not equal floating cards.

- [ ] **Step 5: Build category/status rail and library**

Categories:

```text
全部 / 背景 / 立绘 / 头像 / 音乐 / 环境音 / 音效 / 语音 / 视频 / 字体 / 其他
```

Statuses:

```text
全部状态 / 已引用 / 未引用 / 引用缺失 / 同名冲突 / 命名异常 / 格式待确认
```

Search matches friendly label, key, and project-relative path. Counts always derive from the same filtered result. Empty results explain the active filter rather than claiming the project has no assets.

- [ ] **Step 6: Build fixed inspector and safe preview**

Inspector selection survives view/filter changes only while the selected item remains in the unfiltered catalog. It displays:

- image/audio/video preview where a matching handle exists;
- exact Chinese status explanation;
- friendly name, category, measured size, format;
- reference locations;
- collapsed technical key, path, asset ID, and issue codes.

Revoke old object URLs on selection change, render, project close, and window unload. Never autoplay media.

- [ ] **Step 7: Implement reference navigation**

Scene reference opens Script and focuses the exact line. Timeline reference opens Timeline and selects the timeline. Character/gallery sources open Configuration with the closest stable section. An unavailable precise target remains readable and reports `暂时无法精确定位`.

- [ ] **Step 8: Preserve compact Script sidebar**

Show all shared kinds, including avatar and ambience. Keep compact grouping, insert, copy, and undo semantics. Replace hover-only preview with `前往素材中心` for full inspection; a lightweight hover image may remain only if it is race-safe and revokes URLs.

- [ ] **Step 9: Implement editorial responsive CSS**

Use existing tokens. Required outcomes:

- 1440: rail + library + fixed inspector;
- 1024: narrower inspector, wrapped overview;
- 800: filters compact, inspector follows list, no clipping;
- text is not below the established workbench minimum size;
- hierarchy comes from spacing, type, and boundaries;
- no left/top selection bars, rainbow category colors, giant pills, gradients, or decorative prose.

- [ ] **Step 10: Run Task 4 GREEN and full Editor suite**

```powershell
npm run test -w @surdet/editor -- --run test/editor-asset-center-contract.test.ts test/editor-asset-sidebar-contract.test.ts test/editor-visual-token-contract.test.ts
npm run test -w @surdet/editor
npm run typecheck -w @surdet/editor
npm run build -w @surdet/editor
```

- [ ] **Step 11: Exact commit**

Stage Task 3 and Task 4 files only, inspect the cached path set and diff, then commit:

```text
feat(editor): add asset center workspace
```

---

### Task 5: Permanent browser workflow and mutation proof

**Files:**
- Add: `packages/editor/e2e/asset-center-read-only.e2e.mjs`
- Add: `packages/editor/test/asset-center-runner-contract.test.mjs`
- Modify only if a concrete browser RED requires it: Task 3/4 production and permanent test files

**Produces:** isolated browser evidence for visible behavior, responsive layouts, Agent-readable DOM, cleanup, and zero project mutation.

- [ ] **Step 1: Create isolated fixture**

Copy Starter to a fresh temp root and add fixture-only files/references for:

- image, audio, video, font;
- avatar and ambience;
- unused item;
- missing reference;
- duplicate semantic key in two physical paths;
- invalid portrait name;
- unsupported extension.

Hash the fixture tree before launch. Never modify Starter or a user project.

- [ ] **Step 2: Write runner contract RED**

The runner source contract must require stable milestones, unique temp roots, loopback-only server, explicit project handle injection through the existing authorized harness, browser error channels, responsive sizes, project-tree before/after identity, and process cleanup.

- [ ] **Step 3: Run runner contract RED once, then GREEN**

```powershell
npm run test -w @surdet/editor -- --run test/asset-center-runner-contract.test.mjs
node --check packages/editor/e2e/asset-center-read-only.e2e.mjs
```

- [ ] **Step 4: Run one DIAGNOSTIC browser flow**

Use the permanent repository-local Node Playwright runner with a unique in-memory project, fresh browser context, and unique isolated loopback port. Keep the separate Microsoft Playwright CLI manual-acceptance screenshots as complementary visual evidence. Prove:

1. top-level Asset Center opens;
2. summary and categories match fixture;
3. search and filters remain consistent;
4. image/audio/video selection updates the inspector;
5. missing, duplicate, unused, invalid-name, and unsupported facts are visible in Chinese;
6. keyboard selection works;
7. a scene reference returns to the expected source line;
8. 1440, 1024, and 800 layouts keep essential content reachable;
9. no console, page, request, cleanup, or lease failure;
10. fixture tree hash is unchanged.

Capture screenshots outside the repository in the runner's unique temporary artifact directory. Close the context/server and confirm the selected port is released; separately confirm no manual Playwright CLI task session remains.

- [ ] **Step 5: Correct only evidence-backed defects**

For each failure, classify product vs runner vs environment. Add/adjust a permanent RED before production correction. Do not ignore real network errors or loosen semantic predicates to make a run green.

- [ ] **Step 6: Run one FORMAL browser flow from frozen code**

After runner/tests and production code are exact-committed, run the same flow with `runHead === CODE_EVIDENCE_HEAD` and `trackedCodeDiffPaths=[]`. Preserve artifact identity and screenshots.

- [ ] **Step 7: Exact test commit**

Commit runner and permanent contract only after the DIAGNOSTIC is green:

```text
test(editor): verify asset center workflow
```

If runner must be part of code evidence before FORMAL, freeze it in this commit first and run FORMAL afterward.

---

### Task 6: Independent Luna review and pre-aggregate correction

**Files:** read-only review of every scoped diff; modify only files implicated by a concrete finding.

- [ ] **Step 1: Dispatch two disjoint reviews**

One Luna reviews Authoring/CLI truth, identity, reference matching, schemas, and security. A second reviews Editor information hierarchy, Chinese copy, keyboard access, URL cleanup, responsive CSS, and zero-mutation behavior.

- [ ] **Step 2: General Manager verifies findings**

Reread every cited source range. Classify findings as blocker/high/medium/low and confirmed/inference/unverified. Do not implement speculative preferences as defects.

- [ ] **Step 3: Fix blocker/high findings with focused RED→GREEN**

Each production correction requires a permanent failing test or reproducible browser step. Rerun only the affected focused gates. Medium/low findings may be documented when outside the approved read-only boundary.

- [ ] **Step 4: Freeze code evidence**

Require:

```text
staging empty
tracked worktree clean
scoped path set exact
runner SHA recorded
CODE_EVIDENCE_HEAD established
```

The intentionally untracked long-term ledger and other unrelated untracked paths do not make code evidence dirty.

---

### Task 7: Aggregate gate, closeout, and ordinary push

**Files:**
- Modify: `docs/superpowers/plans/2026-09-01-surdet-asset-center-read-only-intelligence.md`
- Modify after reviewed closure, keep untracked: `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`

- [ ] **Step 1: Run final affected gates from frozen code**

```powershell
npm run test -w @surdet/authoring
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run test -w @surdet/cli
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
npm run test -w @surdet/editor
npm run typecheck -w @surdet/editor
npm run build -w @surdet/editor
```

- [ ] **Step 2: Run one aggregate verification**

```powershell
npm run verify:all
```

Record exit code, first failing node if any, log path, bytes, and SHA-256 from disk. Do not erase or rewrite a failure. A failure blocks completion only when related or when aggregate policy requires a new correction.

- [ ] **Step 3: Append final taskbook evidence**

Record:

- final commits and exact path scopes;
- permanent test counts;
- typecheck/build results;
- browser URL/session mode, visible assertions, screenshots, console/network findings, process cleanup, and project-tree identity;
- independent review disposition;
- aggregate result;
- explicit non-goals not performed.

- [ ] **Step 4: Commit docs-only closeout**

Run docs and diff checks, stage only this taskbook/spec corrections if any, inspect cached diff, and commit:

```text
docs(editor): close asset center read-only gate
```

- [ ] **Step 5: Update the long-term ledger append-only**

Append the reviewed closure, new capability status, evidence boundary, known follow-ups, and next recommended gate. Keep the ledger untracked and unstaged exactly as established.

- [ ] **Step 6: Final local/remote identity check**

```powershell
git status --short
git diff --check
git diff --cached --check
git rev-list --left-right --count surdet/main...HEAD
```

Expected: tracked and staging clean; only established untracked paths remain; local branch is ahead only by this gate.

- [ ] **Step 7: Ordinary push**

```powershell
git push surdet main
```

No force. After push, verify local `HEAD === surdet/main` and ahead/behind `0/0`.

## Final completion state

The only valid green completion statement is:

```text
ASSET_CENTER_READ_ONLY_INTELLIGENCE_1 = PASSED
SHARED_ASSET_TRUTH = ESTABLISHED
EDITOR_ASSET_CENTER = PASSED
AGENT_STRUCTURED_ASSET_METADATA = PASSED
PROJECT_MUTATION = NO
ASSET_WRITE_OPERATIONS = NOT_STARTED
VERIFY_ALL = PASSED
INDEPENDENT_LUNA_REVIEW = PASSED
PUSH = PERFORMED
WAVE_7 = NOT_STARTED
```

If any item is not proven, report its exact status rather than filling the template optimistically.

## Execution ledger

Append-only execution evidence begins below. Do not rewrite earlier entries to make later runs look cleaner.

### 2026-09-01 — Task 0 design start

- Owner authorized one-step design, taskbook, implementation, proportional verification, scoped commits, and ordinary continuation without routine approval pauses.
- High-risk exclusions remain destructive asset/data operations, history rewrite, deploy/release, and scope expansion.
- Three independent Luna read-only audits were completed: Authoring/CLI truth, Editor asset UI/data flow, and LetsGal 1.9.7 visible asset workflow.
- Selected architecture: shared pure Authoring projection + dedicated read-only Editor Asset Center + compact existing sidebar.
- Confirmed boundaries: `content/assets` only; physical path identity; Agent metadata only; no asset writes.

### 2026-09-01 — Tasks 1–4 shared truth and Editor implementation

- `43e397e0ec44a182d181dfb477d6b92cbe40802c` committed the approved design specification and this taskbook.
- `87f026b94f5a5014c2ca8882848e4a59ce0e0d1c` added the Authoring physical-asset intelligence projection and additive public contracts.
- `4e87bba35151e13aaec7e03802b037939c722d6d` corrected gallery-source integration while retaining the legacy background/portrait/avatar arrays.
- `6635f925d609554fac0ee8e8ed080c022ab91a93` added root-confined Node file-size facts and exposed byte-equal `project.assets.intelligence` / `project.inspect.assets.intelligence` through CLI.
- The Editor now has a first-class Chinese `素材` mode, a three-region read-only Asset Center, persistent inspector, search/facets, list/grid modes, local image/audio/video preview, reference navigation, and 1440/1024/800 responsive layouts.
- The compact Script sidebar consumes the same physical truth and retains the pre-existing `gallery.json` CG/music/text unlock insertion actions as UI action adapters, not as another physical index.
- No asset create, rename, move, delete, overwrite, conversion, import, or project save path was added.

### 2026-09-01 — Contract review corrections

- Independent Authoring review found quoted asset arguments, omitted portrait expression, duplicate physical facts, duplicate gallery IDs, fabricated config/timeline line numbers, and summary-schema drift. Permanent tests established the failures before the minimal corrections.
- A later exact RED proved `@ambience "off"` produced a false missing asset. The implementation now dequotes before comparing the runtime stop token; the focused replacement test is GREEN.
- Duplicate gallery IDs retain every distinct source and fan one unlock instruction out to all matching sources. Gallery reference IDs remain distinct and deterministic.
- Summary facts now expose `measuredFileCount`, `measuredBytes`, optional `totalBytes`, and per-kind `{ files, measuredFiles, bytes? }`; unknown bytes are not represented as zero.
- Independent Editor review found a real asynchronous hover-preview race. A permanent RED required the resolved preview to still own the exact live preview element before creating an Object URL or appending fallback content. The focused replacement test is GREEN.
- Keyboard activation now restores focus to the newly rendered selected row. The visible `当前显示 N 项，共 M 项` summary is asserted alongside stable DOM counts.
- Focused final gates before freeze: Authoring 3 files / 27 tests PASS; CLI 2 files / 13 tests PASS; Editor 5 files / 22 tests PASS; Editor typecheck/build PASS; runner contract 6/6 PASS; runner syntax PASS.

### 2026-09-01 — Browser evidence history

- Manual isolated Playwright CLI acceptance used port 4176 and fresh non-persistent sessions. Search, missing filter, keyboard selection, scene-line navigation, image/audio/video preview surfaces, and 1440/1024/800 layouts were observed; console and failed-request channels were empty; all sessions and the development server were closed.
- DIAGNOSTIC #1 failed on a runner-only hard-coded row count. Artifact `surdet-asset-center-read-only-4m1A9m/evidence.json`: 48,281 bytes, SHA-256 `8C54BFF792FB2A6A380DFC7024C45B5786749B3BAAD39C9BB1245014B21773E3`.
- The first replacement attempt stopped before browser execution because the runner tried to add a Starter path that already existed. It produced no evidence artifact and made no project change.
- DIAGNOSTIC #2 failed on a runner-only Chinese-label scope error. Artifact `surdet-asset-center-read-only-bDOdm6/evidence.json`: 49,208 bytes, SHA-256 `BE56146AF97D3B6F48A23D96409F8B5F74C3D2AE221736EE1D827BE5BABCB5F5`.
- Replacement DIAGNOSTIC then passed 24/24, but independent review correctly rejected it as sufficient formal preparation because invalid media bytes proved only fallback behavior and the FORMAL identity checks ignored untracked runner replacement.
- Permanent RED→GREEN corrections added valid minimal WAV/WebM fixtures with correct MIME, separate broken-media fallback milestones, exact milestone order, mode-specific evidence class, committed-blob identity for the runner and every new Asset Center path, visible summary assertions, and restored keyboard focus.
- Final replacement DIAGNOSTIC passed 26/26 without rerun. Evidence: `<local-path>`, 86,707 bytes, SHA-256 `4D9B3FE4EBD157CEC6BC1848036E2D474DC03782FAAD56066892908FD3AA2FE2`. Identity SHA-256: `FE40E7B01269C8D401F8418D08BA70101D6A757CC04B4DC6776636D668FE87F1`.
- Final diagnostic facts: audio and video each reached native controls with `readyState=4`; broken audio/video independently reached the Chinese safe fallback; keyboard focus remained on the selected row; 26 milestone names exactly matched the frozen sequence; object URLs were 15 created / 15 revoked; fixture mutation was false; original Starter unchanged; every browser/error/cleanup channel empty; port 4331 released.
- Frozen runner before final code-evidence establishment: 49,577 bytes, SHA-256 `A167C595050D73EECCB89FC63EFAF41ED8DD9AE5C6E2CFFF234BE82209CE0AE7`.

### 2026-09-01 — Independent review disposition and local commits

- Authoring/CLI Luna final disposition: BLOCKER 0, HIGH 0. Quoted `off`, duplicate gallery IDs, physical deduplication, summary schema, line provenance, path confinement, and byte-equal Agent projections were confirmed.
- Editor Luna final disposition: BLOCKER 0, HIGH 0. Gallery actions, hover-preview race safety, keyboard focus, URL cleanup, responsive rules, no decorative selection rails, and existing insert/copy/undo behavior were confirmed.
- Browser/runner Luna final disposition: BLOCKER 0, HIGH 0. Valid/failing media separation, exact milestone order, mode identity, committed-blob FORMAL checks, visible summaries, zero final mutation, and cleanup evidence were confirmed.
- Non-blocking follow-ups remain explicit: legacy `public/` compatibility scanning needs its own migration gate; malformed gallery completeness stays coupled to existing validation evidence; localized display-name metadata is not yet available; direct rendering and instantaneous-write detection can be strengthened only after measured need.
- `2023243` committed only four Authoring contract-hardening files.
- `84375d4` committed the 15-file Editor Asset Center production/permanent-test scope.
- `63defe0` committed only the permanent runner, runner contract, and shared fake-file MIME support.
- FORMAL, aggregate verification, final docs closeout, long-term ledger consolidation, and push had not run at this ledger point.

### 2026-09-01 — Frozen full gates and aggregate verification

- Frozen affected-workspace gates passed without retry: Authoring 32 files / 275 tests, CLI 40 files / 324 tests, and Editor 60 files / 476 tests. Typecheck and build passed for all three workspaces.
- The unique aggregate `verify:all` run passed with exit code 0. Artifact: `<local-path>`, 74,964 bytes, SHA-256 `778E74B4724B6A4B7E7178153C7EDB86855F300C32652E8C674BEAE7A2557762`.
- The aggregate run covered workspace tests, types, documentation/hygiene gates, Starter simulation, Zero formal verification, and builds. Existing lint warnings remained warnings; no verification error was suppressed or rerun.
- `475500def90bac0a3a9b92f8b13e84cbad1bafaf` is the frozen `CODE_EVIDENCE_HEAD`. It contains only the reviewed implementation, permanent tests, runner/support contract, design specification, and pre-FORMAL taskbook evidence.

### 2026-09-01 — Unique FORMAL and closeout boundary

- The unique FORMAL run passed 26/26 without rerun and with `runHead === CODE_EVIDENCE_HEAD`.
- FORMAL evidence: `<local-path>`, 87,903 bytes, SHA-256 `7CD30F59BA70066F2AC721FCA03246EFFEDEE32F81F862D8FAB868502A5E9B06`.
- FORMAL identity: 465 bytes, SHA-256 `B64EFC2F0DFA8044928B4F13E18BEF2C1BF6F1F2D726EA3525320664A21825DA`.
- FORMAL proved `trackedCodeDiffPaths=[]`, committed-blob identity for the runner and six required new paths, exact 26-milestone order, native audio/video readiness, broken-media fallback, responsive 1440/1024/800 surfaces, keyboard focus retention, balanced Object URL lifecycle, zero browser/protocol/request/cleanup errors, released port, no fixture mutation, and original Starter identity preservation.
- FORMAL screenshots were sealed inside the artifact root: 1440 width, 81,152 bytes, SHA-256 `62F054791204E15B700F586D3DEE4BAF1CC6D88F2161D14116531B1F987F330A`; 1024 width, 47,974 bytes, SHA-256 `DED064CB0193E66329C52F75C654F1DE4F7AAD9B59CB2E8CA7C23BB6DE019AFC`; 800 width, 44,389 bytes, SHA-256 `0416790F782676CFB9BD1366953E07100D3B713808EB2B6155F44F189EFE48E`.
- This gate establishes read-only asset intelligence only. Asset import/create/rename/move/delete/overwrite/convert, legacy `public/` migration, localized display-name metadata, deployment/release, Frontend Pass 5, and mainline Wave 7 were not started.
- At this ledger point the next actions are limited to documentation/hygiene checks, the exact docs-only closeout commit, append-only long-term ledger consolidation, and the already authorized ordinary push. No force push or history rewrite is permitted.

```text
ASSET_CENTER_READ_ONLY_INTELLIGENCE_1 = PASSED
SHARED_ASSET_TRUTH = ESTABLISHED
EDITOR_ASSET_CENTER = PASSED
AGENT_STRUCTURED_ASSET_METADATA = PASSED
AUTHORING_FULL = 32 files / 275 tests PASS
CLI_FULL = 40 files / 324 tests PASS
EDITOR_FULL = 60 files / 476 tests PASS
VERIFY_ALL = PASS
FORMAL = 26/26 PASS
CODE_EVIDENCE_HEAD = 475500def90bac0a3a9b92f8b13e84cbad1bafaf
PROJECT_MUTATION = NO
ORIGINAL_STARTER_UNCHANGED = YES
ASSET_WRITE_OPERATIONS = NOT_STARTED
PUSH = AUTHORIZED_PENDING_DOCS_CLOSEOUT
WAVE_7 = NOT_STARTED
```
