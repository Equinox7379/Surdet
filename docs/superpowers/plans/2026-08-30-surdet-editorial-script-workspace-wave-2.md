# Surdet Editorial Script Workspace — Wave 2 Implementation Taskbook

**Date:** 2026-08-30

**Design authority:** `docs/superpowers/specs/2026-08-30-surdet-editorial-script-workspace-wave-2-design.md`

**Master plan:** `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`

**Authorization:** owner authorized specification, planning and implementation to proceed without an intermediate approval pause

**Stop boundary:** close Wave 2 and stop before Wave 3; no push

---

## 1. Outcome

Rebuild script mode as a real narrative continuity desk while preserving all existing Editor behavior:

- horizontal eight-mode strip;
- real scene / asset outline;
- continuous ordered manuscript;
- current-object, validation and causal context;
- single current scene and selected object across every jump route;
- deterministic desktop / narrow layout;
- no colored selection rails, cards-as-everything, gradients, glass or floating primary actions;
- no fabricated chapter, duration, production, collaboration, version or character-state data;
- no second preview iframe, timeline editor, trace projection or business truth.

---

## 2. Evidence authority

This taskbook is the executable Wave 2 checklist. It does **not** create a parallel evidence ledger. All run facts, commits, artifact identities, failure points and stop boundaries must be appended to the existing `Execution Ledger` in:

`docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`

Never rewrite older Ledger entries.

---

## 3. Baseline

- Expected initial HEAD: `27361d9269475350ffea1d1ccdf4eb9bd5069148`.
- Expected parent: `96d1bae6e1afc25b6061500a45e1758fe3dfbf97`.
- Expected local remote relation: `surdet/main...HEAD = 0 23` before Wave 2 docs commit.
- Expected tracked worktree and staging: clean.
- Existing untracked governance, handoff, protected art-direction, `design/`, long-term ledger and CLI artifact paths must remain unmodified and unstaged.
- Port `4173` is reserved for the neighbouring Jiuan workspace and must never be claimed, stopped or reused by this task. Editor manual preview uses `4175`; the self-contained browser runner uses a separate strict port that is verified free before launch.

If the tracked baseline differs before the first Wave 2 commit, stop and inspect. Do not reset, stash, clean, checkout, amend or rewrite history.

---

## 4. Authorized files

### Wave 2 design / planning commit

- `docs/superpowers/specs/2026-08-30-surdet-editorial-script-workspace-wave-2-design.md`
- `docs/superpowers/plans/2026-08-30-surdet-editorial-script-workspace-wave-2.md`
- `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`

### Wave 2 production candidates

- `packages/editor/index.html`
- `packages/editor/src/main.ts`
- `packages/editor/src/shell/app-shell.ts`
- `packages/editor/src/shell/authoring-workbench.ts` (new)
- `packages/editor/src/panels/editor.ts`
- `packages/editor/src/panels/sidebar.ts`
- `packages/editor/src/panels/assets.ts`
- `packages/editor/src/panels/issues.ts`
- `packages/editor/src/panels/right.ts`
- `packages/editor/src/styles.css`
- `packages/editor/src/styles/app-shell.css`
- `packages/editor/src/styles/script-workspace.css` (new)

### Wave 2 permanent tests

- `packages/editor/test/editor-asset-sidebar-contract.test.ts` (new)
- `packages/editor/test/editor-script-workspace-contract.test.ts` (new)
- `packages/editor/test/editor-integrated-authoring-workbench.test.ts` (new)
- existing adjacent Editor tests only when an assertion must be migrated without weakening behavior

### Wave 2 test-only browser evidence

- `packages/editor/e2e/editorial-script-workspace-wave-2.e2e.mjs` (new)
- `packages/editor/e2e/support/fake-file-system.mjs` (new)
- `packages/editor/test/editorial-script-workspace-wave-2-runner.test.mjs` (new, only if needed to freeze runner contracts)

Anything outside this list requires a new explicit scope decision. Do not edit backend or shared engine production packages to make the UI easier.

---

## 5. Forbidden behavior

- No second `state.current`, `selectedObjectRef`, scene map or authoring index.
- No editable projection separate from the ordered `.gal` text.
- No three-column storyboard editor.
- No duplicated preview iframe, trace state, timeline edit model or causal model.
- No fake chapters, durations, status, versions, collaboration, comments, notifications or character metrics.
- No production demo / fixture loader solely for screenshots.
- No timeout inflation or weakened semantic assertions.
- No `git add .`, `git add -A`, reset, stash, amend, rebase, force push or cleanup of untracked files.
- No push, deployment, release or Wave 3 work.

---

## Task 0 — Reconfirm baseline and capability boundary

- [ ] Record `git status --short`, HEAD, parent and `surdet/main...HEAD` in the master Ledger.
- [ ] Confirm tracked worktree / staging are clean and protected untracked paths still exist.
- [ ] Confirm the identity of listeners on `4173` and `4175`; preserve any non-Surdet listener, never claim `4173`, and reuse `4175` only when it is the owned Surdet Editor process.
- [ ] Confirm the actual state and callback paths:
  - `state.scenes`, `state.current`;
  - `state.selectedObjectRef`, `state.authoringIndex`;
  - history / `setCurrentText`;
  - search jump;
  - issue jump;
  - asset inventory / insertion;
  - project load / save outcome.
- [ ] Confirm no current data source exists for every unsupported reference field named in the design.
- [ ] Append baseline facts to the master Execution Ledger.

**Gate:** no production edit before Task 0 is recorded.

---

## Task 1 — Commit the Wave 2 design and taskbook

- [ ] Run placeholder scan for `TBD`, `TODO`, ambiguous future tense and contradictory stop boundaries.
- [ ] Run `npm run verify:docs`.
- [ ] Run `git diff --check`.
- [ ] Stage exactly the Wave 2 design, Wave 2 taskbook and master taskbook.
- [ ] Run `git diff --cached --check` and verify exact staged names.
- [ ] Commit:

```text
docs(editor): plan narrative continuity workspace wave 2
```

- [ ] Record commit identity and exact path set in the master Ledger only after the commit succeeds.

---

## Task 2 — Establish permanent RED contracts

Create:

- `editor-asset-sidebar-contract.test.ts`
- `editor-script-workspace-contract.test.ts`
- `editor-integrated-authoring-workbench.test.ts`

### Required RED assertions

#### Outline / assets

- [ ] native scene / asset tab semantics with `data-sidebar-mode`, `role="tab"` and `aria-selected`;
- [ ] scene buttons expose `data-scene-id`; only the real current scene is selected;
- [ ] asset catalog exposes `data-editor-region="asset-catalog"` and `data-asset-key`;
- [ ] stable `insert-asset` and `copy-asset-key` actions;
- [ ] referenced and unreferenced assets remain visible;
- [ ] insert behavior still reaches history / dirty / undo semantics through existing helpers.

#### Manuscript

- [ ] `article[data-editor-region="manuscript"][data-scene-id]`;
- [ ] `.block[data-line][data-object-ref]` compatibility;
- [ ] keyboard focus and `aria-selected`;
- [ ] click, Enter and Space write the same `selectedObjectRef` truth;
- [ ] raw text and object reference live under `技术信息` disclosure;
- [ ] all existing edit callbacks remain reachable;
- [ ] scoped CSS forbids colored or inset left selection rails for scenes, assets and blocks.

#### Integrated workbench

- [ ] semantic outline, manuscript, context and dock-region boundary;
- [ ] one current scene across project bar, outline, manuscript and context projection;
- [ ] one selected object across manuscript and Inspector;
- [ ] scene change clears the previous scene object reference;
- [ ] search / issue line jump selects a real resolved destination reference;
- [ ] horizontal mode strip contract;
- [ ] responsive controls use native buttons and correct ARIA;
- [ ] script mode creates no preview iframe, trace projection or timeline editor;
- [ ] desktop CSS has one flexible manuscript column and bounded auxiliaries;
- [ ] responsive auxiliary content stays in normal flow, never fixed / absolute over manuscript content.

Run exactly:

```powershell
npx vitest run packages/editor/test/editor-asset-sidebar-contract.test.ts packages/editor/test/editor-script-workspace-contract.test.ts packages/editor/test/editor-integrated-authoring-workbench.test.ts
```

**Expected:** exit 1 for the named missing Wave 2 contracts. Record exact failures in the master Ledger. Do not manufacture failures in existing green behavior.

---

## Task 3 — Build the pure workbench topology

Create `packages/editor/src/shell/authoring-workbench.ts`.

- [ ] Export a pure DOM builder returning stable containers for:
  - outline (`#sidebar`);
  - search toolbar (`#search-panel`);
  - manuscript (`#editor`);
  - context (`#right`);
  - future Dock semantic boundary, only if real content is present.
- [ ] Add `data-editor-region`, headings and accessible labels.
- [ ] Add UI-only responsive auxiliary controls with `aria-controls` / `aria-expanded`.
- [ ] Do not import state, history, project IO, preview, timeline, validation or authoring services.
- [ ] Update `main.ts` to use this topology while calling all existing renderers.
- [ ] Keep every stable DOM ID used by tests and integrations.

**Gate:** pure topology tests pass; no business callback has moved into the shell module.

---

## Task 4 — Establish one scene / object selection coordinator

- [ ] In `main.ts`, make `jumpToScene()` the single scene-navigation coordinator for outline, search and issues.
- [ ] Scene change sets `state.current` and clears the old `state.selectedObjectRef` before re-render.
- [ ] A line jump resolves the destination block's real `data-object-ref`, writes it through `selectAuthoringObject()` and dispatches the existing selection event.
- [ ] If no object reference exists, keep selection null; do not synthesize one.
- [ ] Extend `bindSidebarHooks` with an `onSelectScene` callback; remove direct partial scene rendering from sidebar selection.
- [ ] Add a small issue-navigation binding so `issues.ts` no longer mutates scene / DOM state independently.
- [ ] Preserve scroll-to-line and keyboard focus.
- [ ] Refresh project bar, outline, manuscript and context from the coordinated render.

**Gate:** permanent selection contracts plus search, causal selection and issue navigation pass.

---

## Task 5 — Rebuild scene and asset outline

### Scene view

- [ ] Use real tab controls and a labelled outline region.
- [ ] Group only by real relative directories; label the root honestly.
- [ ] Use buttons for scene rows.
- [ ] Show real id / path, dirty state and exact character count.
- [ ] Use full-surface selected treatment, `当前` text and `aria-selected`.
- [ ] Remove old scene cards, shadows, hover translation and selected left inset.

### Asset view

- [ ] Preserve `buildAssetInventory()` and all real fields.
- [ ] Use semantic type groups and stable `data-asset-key`.
- [ ] Keep referenced and unreferenced entries.
- [ ] Keep insert, copy and hover preview callbacks.
- [ ] Use direct Chinese actions and honest missing-preview text.
- [ ] Remove card / chip styling and any colored left selection line.

**Gate:** new sidebar contract and existing asset tests pass.

---

## Task 6 — Rebuild the continuous manuscript

- [ ] Render the current scene as one manuscript `article`.
- [ ] Add a real scene heading derived only from current id / path, dirty state and character count.
- [ ] Render every ordered line as a continuity-sheet row with line number, semantic type and existing fields.
- [ ] Preserve text, label, instruction, choice, flow, variable and raw edit behavior.
- [ ] Preserve insert, delete, move, append and history behavior.
- [ ] Move raw source and object reference into `技术信息` disclosure.
- [ ] Add visible `当前段`, complete selection boundary and ARIA.
- [ ] Add Enter / Space selection without stealing keyboard use inside inputs, selects or textareas.
- [ ] Keep line operations reachable by keyboard and visible on focus-within.
- [ ] Remove colored `t-*` left rails, card shadows, large rounded corners and disconnected vertical gaps.

**Gate:** manuscript contracts, history, model round-trip and focused editing tests pass.

---

## Task 7 — Rebuild current context and search surface

- [ ] Keep search / replace in the manuscript toolbar and preserve callbacks.
- [ ] Add a current-scene summary using only real path, count and dirty state.
- [ ] Keep validation issues distinct from current-object facts.
- [ ] Keep causal / reference information tied to `selectedObjectRef`.
- [ ] Label project-wide variables and topology as project context.
- [ ] Put fingerprints, object refs and raw identifiers under technical disclosure where feasible.
- [ ] Ensure issue click routes through the selection coordinator.
- [ ] Provide honest missing-validation, missing-config and no-selection states.

**Gate:** issues, search, causal and project-bar projection remain synchronized.

---

## Task 8 — Apply the Wave 2 visual and responsive system

- [ ] Load `script-workspace.css` after legacy and Wave 1 styles.
- [ ] Move the eight-mode navigation into a horizontal strip for all required desktop sizes.
- [ ] At 1440+, use bounded outline / flexible manuscript / bounded context columns.
- [ ] At 1280, narrow auxiliaries without hiding the manuscript.
- [ ] At 1024, keep outline + manuscript by default; context replaces the auxiliary column through an in-flow accessible control.
- [ ] Ensure body and application frame never overflow horizontally.
- [ ] Limit hover / focus motion to 120–180 ms and honor reduced motion.
- [ ] Remove gradients, glass, generic panel shadows, universal pills and decorative text.
- [ ] Preserve clear focus and non-color-only state.

**Gate:** static visual contracts pass before browser evidence.

---

## Task 9 — Turn all focused and adjacent gates GREEN

Run:

```powershell
npx vitest run packages/editor/test/editor-asset-sidebar-contract.test.ts packages/editor/test/editor-script-workspace-contract.test.ts packages/editor/test/editor-integrated-authoring-workbench.test.ts packages/editor/test/assets.test.ts packages/editor/test/presentation-asset-catalog.test.ts packages/editor/test/search.test.ts packages/editor/test/history.test.ts packages/editor/test/project-io.test.ts packages/editor/test/model-roundtrip.test.ts packages/editor/test/causal-selection.test.ts packages/editor/test/editor-action-scope-contract.test.ts
npm run test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

- [ ] Focused and adjacent command passes.
- [ ] Complete Editor suite passes.
- [ ] Typecheck passes.
- [ ] Build passes.
- [ ] Only the existing Vite large-chunk advisory may remain.
- [ ] No `verify:all` is run.

---

## Task 10 — Build and run the isolated real-fixture browser evidence

Create a test-only runner. It may copy the established fake File System Access pattern into Editor test support, but must not import CLI internals or modify production loading behavior.

- [ ] Runner starts its own strict-port Editor process and owns cleanup.
- [ ] Runner injects an isolated in-memory representation of `examples/starter`.
- [ ] Runner clicks the real `打开项目` action and verifies real project / scene identity.
- [ ] Runner records 1440×900, 1280×720 and 1024×768 screenshots outside the repository.
- [ ] At every size: page scroll width equals client width.
- [ ] At 1440: outline, manuscript and context are visible; manuscript is the largest region.
- [ ] At 1024: context is hidden by default, the accessible reveal control works, and no overlay covers manuscript content.
- [ ] Scene switch updates outline, manuscript, project bar and context identity.
- [ ] Search jump updates real selected object reference.
- [ ] Edit then undo proves the existing history path.
- [ ] Asset inventory contains referenced and unreferenced facts where the fixture provides them; insert uses the existing path.
- [ ] Script mode contains zero preview iframe, preview trace projection and timeline editor instances.
- [ ] Errors, console errors, page errors, request failures and cleanup failures are empty.
- [ ] Starter on disk is unchanged.

Record artifact paths, bytes and SHA-256 in the master Ledger.

---

## Task 11 — Independent review and exact code commit

- [ ] Review exact diff and nearby selectors.
- [ ] Verify no forbidden production root changed.
- [ ] Verify every new projection traces to an existing fact.
- [ ] Verify no duplicated selection / preview / timeline state.
- [ ] Verify screenshots show the loaded fixture, not an empty shell.
- [ ] Run `git diff --check`.
- [ ] Stage only the exact reviewed Wave 2 code / test / runner paths.
- [ ] Run `git diff --cached --check` and exact staged-name comparison.
- [ ] Commit:

```text
feat(editor): build narrative continuity workspace
```

- [ ] Do not push.

---

## Task 12 — Ledger and docs-only closure

- [ ] Append confirmed facts, reasonable inferences, unverified items and stop boundary to the master Execution Ledger.
- [ ] Record code commit, exact path set, tests, artifacts, browser facts and independent review.
- [ ] Explicitly state which reference features remain deferred or unsupported.
- [ ] Mark Task 2 / Wave 2 complete in the master taskbook without rewriting historical entries.
- [ ] Run `npm run verify:docs`, `git diff --check` and exact docs staging checks.
- [ ] Commit only the master taskbook and this taskbook if it changed:

```text
docs(editor): close narrative continuity workspace wave 2
```

- [ ] Stop with tracked worktree clean, staging empty, untracked protected paths preserved, `4173` and test ports free.
- [ ] Do not begin Wave 3 and do not push.

---

## 6. Completion report format

The final report must state:

- what visibly changed and what behavior was preserved;
- what reference features were intentionally omitted and why;
- focused / full / typecheck / build / browser evidence;
- exact code and docs commits;
- exact Git and port state;
- `OWNER_VISUAL_ACCEPTANCE = NOT_STARTED` unless the owner personally evaluates the loaded Wave 2 page;
- `REMOTE_REVIEW = NOT_STARTED` and `PUSH = NOT_PERFORMED`;
- `WAVE_3 = NOT_STARTED`.
