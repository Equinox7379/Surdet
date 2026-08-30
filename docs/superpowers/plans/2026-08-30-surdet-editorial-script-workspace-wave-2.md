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
- `packages/editor/src/causal-selection.ts` (scope decision: reconcile the existing selection truth after real object-index rebuilds; Editor-only, no new selection state)
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
- `packages/editor/test/causal-selection.test.ts` (permanent selection-reconciliation regression for the approved scope decision)

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

---

## 7. Execution closure — 2026-08-30

### CONFIRMED_FACTS

- Planning authority was frozen in commit `0caceceb2ae21f2e8b3c7fd21b6fadcabd2d26a9`, parent `27361d9269475350ffea1d1ccdf4eb9bd5069148`, with exactly the design specification, this taskbook and the master taskbook.
- Permanent RED was established before the implementation: 3 files / 15 tests, 12 passed / 3 failed, exit 1. The three failures were the missing Wave 2 scene/asset whole-surface selection, manuscript selection and responsive bounded-layout CSS contracts.
- The implementation retains the real `state.scenes`, `state.current`, `state.selectedObjectRef`, authoring index, history, asset insertion, validation, search, issue and causal-selection pathways. It adds a presentation topology and scoped styles; it does not add a second scene, selection, preview, trace, timeline or persistence truth.
- Independent review first returned `NEEDS_FIX`: narrow layouts made auxiliary panes unreachable; right-topology and new-scene navigation bypassed the centralized route; selection could become stale after a real object-index rebuild; dirty facts and asset insertion did not immediately refresh; row actions overlaid content; and native tabs lacked complete keyboard behavior. Each Blocker / High finding was corrected before code freeze.
- The explicit scope decision above adds `packages/editor/src/causal-selection.ts` and `packages/editor/test/causal-selection.test.ts` to preserve the one existing selection truth across index rebuilds. No shared-engine or backend package changed.
- Final code evidence is commit `0531388ccc703ce603f02eb4d34d5594013ffc89`, parent `0caceceb2ae21f2e8b3c7fd21b6fadcabd2d26a9`, message `feat(editor): build narrative continuity workspace`. It contains exactly 17 reviewed Editor production / test / browser-runner paths; staged missing and extra path counts were both zero.
- Final focused contracts passed: 4 files / 23 tests. The complete Editor suite passed: 40 files / 255 tests. Editor typecheck and production build passed; build output contained only the existing Vite large-chunk advisory.
- The final browser runner is 27723 bytes with SHA-256 `0206E9E3988A305E9DDBD9A4AE6C73DBF21F444E52EEFBF2814441959B26A145`.
- A runner-only assertion mistake was preserved rather than erased: `C:\Users\Equinox\AppData\Local\Temp\surdet-editorial-script-workspace-wave2-r0VnDj\evidence.json`, 41363 bytes, SHA-256 `0E2A65AAB615CD61AF1A24A0F58D9537C12754DBFD0FFF1B3AC6734F764E7EFF`. It incorrectly read an input's `textContent` instead of its value; the product path had already passed the preceding milestones.
- After correcting only that test assertion and after the final new-scene navigation correction, a fresh real-Starter run passed 16 / 16 milestones without rerun substitution: `C:\Users\Equinox\AppData\Local\Temp\surdet-editorial-script-workspace-wave2-mwDnEl\evidence.json`, 56931 bytes, SHA-256 `F7B70A09C9CE890196AF0930AE044C09D9F8AB393A527DBAC3BBE83DD533E6BC`.
- The fresh browser run proved: isolated strict port selection; project opening through the real picker path; no duplicate preview / trace / timeline in script mode; bounded 1440, 1280, 1024 and 800 layouts; outline/context replacement at narrow widths; real scene switch and search selection; edit + undo with selection reconciliation and dirty-fact refresh; real asset insertion + undo; unchanged project bytes; and empty browser error, request and cleanup channels.
- The browser runner used port 4187 and released it. It did not stop, claim or reuse 4173 or 4175. Original Starter SHA-256 remained `8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6` before and after.
- Independent review returned `PASS` with no Blocker, High or Medium finding. It passed an additional 4 files / 38 regression tests and replayed the final runner after the last source edit: 16 / 16 passed, Starter unchanged, error channels empty and port 4187 released.

### REASONABLE_INFERENCES

- Wave 2 materially closes the gap from a stack of generic forms toward a dense authoring desk because scene/asset discovery, ordered manuscript editing and current-object evidence now share one visible workspace and one semantic selection.
- The implementation is a credible foundation for later preview/timeline/causal docking, but visual proximity to the full benchmark still depends on future workspaces and real project assets.

### UNVERIFIED_ITEMS

- The approved benchmark's preview, timeline, causal graph, flow, statistics, audit and final visual language are not Wave 2 deliverables. Unsupported chapter hierarchy, durations, production state, collaboration, comments, version and character metrics remain intentionally omitted rather than fabricated.
- A low-severity existing edge remains deferred: after a brand-new scene receives its first physical save path, the currently rendered manuscript path label may not update until the next full render. Save semantics and stored bytes are unaffected; it is not a Blocker or High for this workspace closure.
- The browser artifact freezes its runner hash and disk identity but not a complete application-source hash or `runHead`; freshness was established here by two post-edit reruns and exact commit review. A later high-risk wave may strengthen that evidence envelope.
- Owner visual acceptance of the loaded final Wave 2 page, remote GitHub review, push, deployment and release have not occurred.

### STOP_BOUNDARY

- `WAVE_2_TECHNICAL_VERIFICATION = PASSED`
- `OWNER_VISUAL_ACCEPTANCE = NOT_STARTED`
- `REMOTE_REVIEW = NOT_STARTED`
- `PUSH = NOT_PERFORMED`
- `WAVE_3 = NOT_STARTED`
- Close only the master taskbook and this taskbook in the docs-only commit; stop before Wave 3 and wait for the owner's next direction.
