# Surdet Flow Canvas — Wave 3A Implementation Taskbook

**Date:** 2026-08-30

**Design authority:** `docs/superpowers/specs/2026-08-30-surdet-flow-canvas-wave-3a-design.md`

**Master plan / single Execution Ledger:** `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`

**Authorization:** owner authorized planning and implementation to continue without an intermediate approval pause

**Stop boundary:** close Flow Canvas 3A and stop before Timeline 3B; no push

---

## 1. Outcome

Rebuild flow mode as a real Chinese narrative-flow workbench while preserving every existing graph and edit behavior:

- real graph and current scene only;
- Chinese-first node, edge, status and action language;
- compact local command bar with functioning viewport controls;
- dominant SVG canvas with real minimap;
- accessible node navigation and non-color-only validation signals;
- no colored selection rails, rainbow connections, gradients, glows, decorative cards or floating primary actions;
- no fake chapters, durations, statuses, collaboration or runtime evidence;
- no timeline, preview, causal or backend change.

---

## 2. Evidence authority

This file is an executable checklist, not a second ledger. All actual baselines, failures, run identities, commits, review findings and stop decisions must be appended to the existing `Execution Ledger` in the master taskbook. Older entries are append-only.

---

## 3. Baseline

- Expected initial HEAD: `2fdbd59eaa4f00669dc5b8a22c754bcb57949b45`.
- Expected local remote relation: `surdet/main...HEAD = 0 26` before the Wave 3A planning commit.
- Expected tracked worktree and staging: clean.
- Existing untracked governance, handoff, protected art-direction, `design/`, long-term ledger and CLI artifact paths remain preserved and unstaged.
- Port `4173` belongs to the neighbouring Jiuan workspace and must not be claimed, stopped or reused.
- Port `4175` is the existing Surdet manual preview. The browser runner must use a separate strict free port and clean it up.

If the tracked baseline differs before the planning commit, inspect; do not reset, stash, clean, checkout, amend or rewrite history.

---

## 4. Authorized files

### Planning commit

- `docs/superpowers/specs/2026-08-30-surdet-flow-canvas-wave-3a-design.md`
- `docs/superpowers/plans/2026-08-30-surdet-flow-canvas-wave-3a.md`
- `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`

### Production candidates

- `packages/editor/index.html`
- `packages/editor/src/panels/flow.ts`
- `packages/editor/src/flow-presentation.ts` (new pure display projection, only if the RED demonstrates value)
- `packages/editor/src/styles.css` (only remove flow rules migrated to the dedicated layer)
- `packages/editor/src/styles/flow-workspace.css` (new)

### Permanent tests

- `packages/editor/test/flow-presentation-contract.test.ts` (new if the pure projection is created)
- `packages/editor/test/editor-flow-workspace-contract.test.ts` (new)
- `packages/editor/test/editor-flow-interaction-contract.test.ts` (new when DOM / keyboard extraction is required)
- `packages/editor/test/flow-edit.test.ts` (only additive preservation assertions)
- `packages/editor/test/flow-labels.test.ts` (only additive real-Starter assertions)

### Browser evidence

- `packages/editor/e2e/editorial-flow-canvas-wave-3a.e2e.mjs` (new)
- `packages/editor/test/editorial-flow-canvas-wave-3a-runner.test.mjs` (new only if needed to freeze runner contracts)
- existing `packages/editor/e2e/support/fake-file-system.mjs` may be reused, but modified only when a deterministic runner defect is demonstrated.

Anything outside this list requires a scope decision appended to the master Ledger before editing.

---

## 5. Forbidden behavior

- No modification to `packages/editor/src/graph/build.ts`, `state.ts`, `main.ts`, scene parsing, history, project IO or file formats.
- No modification to timeline production or tests in Wave 3A.
- No Core, Authoring, CLI, Renderer, Host, Shell, Starter, dependency or lockfile change.
- No second graph, current-scene, layout, history or selection truth.
- No fake production metadata or placeholder feature controls.
- No screenshot-only fixture loader in production.
- No timeout inflation, weakened semantic assertions or filtered browser errors.
- No `git add .`, `git add -A`, reset, stash, amend, rebase, force push or untracked cleanup.
- No push, deployment, release or Timeline 3B work.

---

## Task 0 — Reconfirm capability and baseline

- [x] Record status, HEAD, parent and local remote relation in the master Ledger.
- [x] Confirm tracked worktree / staging are clean and protected untracked paths remain unstaged.
- [x] Confirm the real flow input, current scene, navigation, edit, rename, delete, minimap, pan and zoom paths.
- [x] Confirm unsupported reference data remains unavailable.
- [x] Confirm 4173 / 4175 ownership without stopping either process.
- [x] Append the Wave 3A initialization record to the master Ledger.

**Gate:** no production edit before the baseline and scope decision are recorded.

---

## Task 1 — Commit planning documents

- [x] Scan the two Wave 3A documents and the edited master section for placeholders and contradictory stop boundaries.
- [x] Run `npm run verify:docs`.
- [x] Run `git diff --check`.
- [x] Stage exactly the three planning paths.
- [x] Run cached diff check and verify the exact staged set.
- [x] Commit `docs(editor): plan flow canvas wave 3a`.
- [x] Append the planning commit identity to the master Ledger after the commit succeeds.

---

## Task 2 — Establish permanent RED

Create the smallest permanent contracts that fail against the old flow page for the intended reasons.

### Required RED assertions

- [x] stable `data-editor-region="flow-workbench"`, local status, toolbar, legend, canvas and minimap regions;
- [x] status is computed from the real graph and validation data;
- [x] Chinese node and edge kind presentation covers every stable kind;
- [x] raw DSL / IDs are technical details, not primary labels;
- [x] no chapter, duration, status, author, version, collaboration or probability projection;
- [x] flow styles are loaded after shared layers;
- [x] no inline decorative rainbow palette, gradient, glow or colored left selection rail;
- [x] current node uses complete outline / surface and explicit `aria-current` or selected wording;
- [x] invalid state includes text or shape in addition to color;
- [x] real nodes are keyboard focusable and Enter / Space share navigation behavior;
- [x] viewport command IDs are stable and each reaches the existing view state;
- [x] tooltip language matches actual single-click navigation;
- [x] graph build and scene edit semantics remain imported from their existing paths.

Run only the new contracts plus the existing flow model/edit/label files. RED must not arise from syntax, fixture, import or environment failure.

Record command, counts and first expected failure in the master Ledger.

---

## Task 3 — Implement the pure presentation contract

- [x] Add one small mapping for node kinds, edge kinds and validation states when needed by RED.
- [x] Preserve serialized values and IDs without translation or mutation.
- [x] Put raw technical identity behind `技术信息` or the SVG accessible description.
- [x] Distinguish `尚未校验` from a real empty graph.
- [x] Keep the presentation module free of DOM, state mutation and graph construction.
- [x] Bring presentation tests GREEN before changing the visual shell.

---

## Task 4 — Rebuild the flow workbench shell

- [x] Add a local header with `剧情流程`, real current scene and real node / connection / error / warning counts.
- [x] Add functioning `缩小`, `放大`, `适应画布` and `回到当前` commands on the existing `view` state.
- [x] Wrap the SVG, legend and minimap in named semantic regions.
- [x] Replace inline colors with CSS semantic classes and existing design tokens.
- [x] Replace the dotted demo-board / rainbow aesthetic with a restrained editorial grid and neutral connection system.
- [x] Represent edge kinds with line style, marker or label as well as color.
- [x] Represent current, error and warning states with full boundaries, surface and text / shape signals.
- [x] Add keyboard node navigation and meaningful Chinese accessible names.
- [x] Preserve all pointer pan, zoom, culling, minimap, link, rename and delete callbacks.
- [x] Ensure context menu remains within the viewport and has real menu semantics.
- [x] Migrate only flow-specific legacy CSS out of `styles.css`.

**Gate:** no graph builder, scene-text or history change.

---

## Task 5 — Focused and Editor verification

- [x] Run the new Wave 3A permanent contracts.
- [x] Run existing graph, flow edit and flow label suites.
- [x] Run the complete Editor test once the focused suite is GREEN.
- [x] Run Editor typecheck.
- [x] Run Editor build.
- [x] Run `git diff --check`.

This B-level frontend wave does not authorize `verify:all`. If evidence points to a shared-engine regression, stop and report instead of expanding scope.

---

## Task 6 — Fresh browser evidence

The self-contained runner must:

- [x] verify a strict free port that is not 4173 or 4175;
- [x] load a disposable copy of the real Starter through the project picker path;
- [x] enter flow mode and prove real scene, label, configuration entry, choice and condition content;
- [x] prove click navigation and keyboard navigation use real scene identity;
- [x] prove pan, zoom, fit, current-scene centering and minimap behavior;
- [x] prove drag-to-link changes only the disposable in-memory / fixture scene and the existing undo path restores it;
- [x] capture 1920, 1440, 1280, 1024 and 800 widths plus Chromium page-scale `2` geometry/screenshots; prove the halved visual viewport, unchanged DPR and real command activation, and explicitly leave native Chrome browser zoom to the final cross-mode acceptance;
- [x] assert header, toolbar, graph, legend, minimap and context menu do not overlap or become unreachable;
- [x] record empty console, page, request, stderr and cleanup channels;
- [x] prove original Starter bytes are unchanged;
- [x] stop the isolated Vite/browser process and prove its port is free.

Do not use the empty initial page as visual acceptance evidence.

---

## Task 7 — Independent review and code commit

- [x] Ask a read-only reviewer to inspect the exact diff, design contract and fresh evidence.
- [x] Treat Blocker / High findings as code blockers; fix within scope and rerun only affected proportional gates.
- [x] Record Medium / Low findings honestly and resolve Medium findings unless explicitly deferred with evidence.
- [x] Verify exact code/test/runner path set; no protected or unrelated path.
- [x] Stage exact reviewed paths only.
- [x] Run both diff checks and cached name review.
- [x] Commit `feat(editor): rebuild flow canvas workspace`.
- [x] No push.

---

## Task 8 — Ledger closure

- [x] Append actual RED, GREEN, browser evidence, review, commit and remaining limitations to the master Execution Ledger.
- [x] Run `npm run verify:docs` and both diff checks.
**Terminal commit gate:** create one exact docs-only closure commit containing only the Wave 3A design correction, Wave 3A taskbook closure and master Execution Ledger. Its resulting identity is reported after the commit and cannot be pre-recorded inside its own tree.
- [x] Stop with Timeline 3B, owner visual acceptance, remote review, push and deployment not started.

---

## 6. Stop conditions

Stop and report if:

- real graph/edit behavior would require a shared-engine change;
- the page would need fabricated chapter, duration, state or collaboration data;
- an interaction can only be made visually plausible by disconnecting it from existing callbacks;
- browser evidence cannot identify the correct project or isolated port;
- the original Starter changes;
- tracked paths escape the authorized set;
- a Blocker or High review finding remains.

Ordinary in-scope RED-to-GREEN corrections do not require another owner pause.
