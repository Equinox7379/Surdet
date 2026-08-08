# Surdet Renderer v2 Wave 2 Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use parallel subagents: this program is intentionally serialized for one execution AI. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic Renderer public surface with a command/query-based Renderer v2, split Pixi rendering into six owned boundaries, preserve the legacy API for one version, and prove behavioral, resource, visual, performance, editor, game, HMR, and Windows-package compatibility.

**Architecture:** `createRendererRuntime()` constructs one `RendererFacade`, one `PresentationController`, six internal Layers, and one scoped `RenderLifecycle`. New consumers use domain Commands and side-effect-free Queries; deprecated `PixiStage`, `AdvStage`, and `AdvRenderer` delegate to the same v2 implementation during a one-version compatibility window.

**Tech Stack:** TypeScript 5.7, PixiJS 8.19, Vitest 3, Vite 6, Playwright 1.49, Electron 43, npm workspaces, PowerShell on Windows, GitHub Actions.

## Global Constraints

- Baseline commit is `cab200b5aaed49b053b18ff05907aac4d02fb731`; design commit is `fe72abe`.
- One execution AI works serially; do not delegate or edit multiple milestones in parallel.
- Implement milestones strictly in order M0 through M8; do not start the next milestone before the current milestone report is approved.
- Only fix migration-blocking defects. First add a failing regression test, then implement the smallest fix, and list it separately in the milestone report.
- Do not add player-facing features, DSL commands, save-schema changes, battle formations, plugins, transitions, particles, post-processing features, or editor redesigns.
- Do not read, migrate, overwrite, or delete real user saves or profile data.
- `Layer` modules must not import another `Layer`; coordination occurs through `RendererFacade` or `PresentationController`.
- Queries are read-only and must not allocate persistent Pixi objects, register listeners, populate caches, or mutate visible state.
- Legacy adapters contain delegation only; never keep a second rendering implementation.
- Do not use line count as a compression target. Preserve readability and behavior.
- Do not delete tests, loosen assertions, raise performance thresholds, bulk-update visual baselines, or suppress errors to pass a gate.
- Do not force push. Do not commit `USER.md`, `SESSION-HANDOFF.md`, logs, screenshots, caches, temporary scripts, `.superpowers/`, or generated release directories.
- Windows EXE testing must use a newly created isolated `--user-data-dir`; verify the absolute path before cleanup.
- Every task uses TDD where behavior changes: failing test, observed failure, minimal implementation, targeted pass, broader gate, commit.
- Each milestone ends in one or more focused commits and a Markdown delivery report. Stop on any red-line condition in the design.

---

## 1. Required Reading and Authority Order

The execution AI must read these files before changing source:

1. `docs/superpowers/specs/2026-08-09-renderer-v2-architecture-design.md` — architecture authority;
2. this master plan — sequencing and global constraints;
3. the current phase plan listed below — exact task authority;
4. `docs/AI-GUIDE.md`, `docs/dsl-spec.md`, `docs/capabilities.json` — existing behavior contracts;
5. current source and tests named by the active task.

If documents conflict, use the order above and stop for approval rather than inventing a compromise.

## 2. Program Documents

| Program part | Document | Milestones |
| --- | --- | --- |
| Foundation | `docs/superpowers/plans/2026-08-09-renderer-v2-foundation-m0-m2.md` | M0 facts/baseline, M1 API/compatibility, M2 lifecycle/input |
| Layer migration | `docs/superpowers/plans/2026-08-09-renderer-v2-layers-m3-m7.md` | M3 Dialogue, M4 Menu, M5 Gallery, M6 SystemPanel, M7 World |
| Cutover | `docs/superpowers/plans/2026-08-09-renderer-v2-cutover-m8.md` | M8 consumer migration, legacy containment, final gates and EXE |
| Executor control | `docs/superpowers/plans/2026-08-09-renderer-v2-executor-directive.md` | Copyable operating instruction and report format |

An absent document is a blocker. Do not reconstruct it from memory.

## 3. Locked File Structure

The following structure is the target. Do not create generic `utils.ts`, `helpers.ts`, `common.ts`, or a second event bus.

```text
packages/renderer/src/
  api/
    renderer-runtime.ts          Public RendererRuntime and factory option types
    renderer-commands.ts         Public domain command interfaces only
    renderer-queries.ts          Public query and snapshot interfaces only
    renderer-errors.ts           RendererErrorCode and RendererError
    renderer-input.ts            RendererInputAction and input normalization types
  runtime/
    create-renderer-runtime.ts   Sole Composition Root and public async factory
    renderer-facade.ts           Domain facade; delegates to layer ports
    presentation-controller.ts   Core EventBus projection and ADV control state
  lifecycle/
    render-lifecycle.ts          Owner-scoped resource registry and diagnostics
    async-generation.ts          Cancellation/generation primitive
  services/
    render-asset-registry.ts     Sole background/portrait/avatar/font/source registry
  layers/
    world/
      world-layer.ts             World implementation and port
    dialogue/
      dialogue-layer.ts          ADV/NVL/Backlog/choice implementation and port
    menu/
      menu-layer.ts              Title/ending/system/settings/save-load implementation
    gallery/
      gallery-layer.ts           CG/music/text-gallery implementation
    system-panel/
      system-panel-layer.ts      Battle/map/shop/base/video implementation
  legacy/
    legacy-stage-adapter.ts      AdvStage/PixiStage method-to-v2 delegation
    legacy-renderer-adapter.ts   AdvRenderer method-to-controller delegation
  diagnostics/
    renderer-baseline.ts         Runtime measurement schema and comparison logic
```

Existing focused modules such as `frame-scheduler.ts`, `performance.ts`, `world-effects-controller.ts`, `loading-layer.ts`, `transition-registry.ts`, `backlog-search-controller.ts`, `keybindings.ts`, `gallery.ts`, `battle-view.ts`, and `ui-views.ts` remain reusable. Move them only when a milestone proves that relocation improves ownership; do not rename them for cosmetic consistency.

### 3.1 Test Structure

```text
packages/renderer/test/
  api/renderer-contract.test.ts
  api/query-purity.test.ts
  lifecycle/render-lifecycle.test.ts
  lifecycle/async-generation.test.ts
  layers/dialogue-layer.test.ts
  layers/menu-layer.test.ts
  layers/gallery-layer.test.ts
  layers/system-panel-layer.test.ts
  layers/world-layer.test.ts
  legacy/legacy-stage-contract.test.ts
  legacy/legacy-renderer-contract.test.ts
  integration/renderer-runtime.test.ts
  integration/resource-cycles.test.ts
  integration/presentation-snapshot.test.ts
```

Browser/Electron acceptance scripts belong under existing example/shell test directories, not repository root.

## 4. Public Interfaces Locked Across All Phases

M1 creates these names. M2–M8 consume them without renaming:

```ts
export interface RendererRuntime {
  readonly canvas: HTMLCanvasElement;
  readonly commands: RendererCommands;
  readonly queries: RendererQueries;
  readonly controller: PresentationController;
  resize(): void;
  resetSession(options?: ResetSessionOptions): void;
  dispose(): void;
}

export interface RendererCommands {
  readonly assets: AssetCommands;
  readonly world: WorldCommands;
  readonly dialogue: DialogueCommands;
  readonly menu: MenuCommands;
  readonly gallery: GalleryCommands;
  readonly system: SystemPanelCommands;
  readonly loading: LoadingCommands;
  readonly preferences: PreferenceCommands;
  readonly presentation: PresentationCommands;
}

export interface RendererQueries {
  readonly world: WorldQueries;
  readonly dialogue: DialogueQueries;
  readonly overlay: OverlayQueries;
  readonly preferences: PreferenceQueries;
  readonly presentation: PresentationQueries;
  readonly diagnostics: RendererDiagnosticQueries;
}

export async function createRendererRuntime(
  options?: RendererRuntimeOptions,
): Promise<RendererRuntime>;
```

The phase plans define each domain method. If source reality proves a signature impossible without behavior change, stop and propose a design amendment; do not silently rename or widen with `any`.

## 5. Milestone State Machine

```text
NOT_STARTED
  → TEST_RED_CONFIRMED
  → MINIMAL_IMPLEMENTATION
  → TARGETED_GREEN
  → FULL_GATE_GREEN
  → MILESTONE_COMMITTED
  → REPORT_WRITTEN
  → WAITING_FOR_APPROVAL
  → APPROVED
  → next milestone
```

The execution AI must stop at `WAITING_FOR_APPROVAL`. It must not infer approval from test success.

## 6. Baseline and Comparison Rules

M0 records a machine-readable baseline using `cab200b`. Because the design commit only adds documentation, `fe72abe` is acceptable for source-equivalent baseline measurement when the report records both SHAs.

Required baseline dimensions:

- Node, npm, OS, CPU, Electron and Playwright versions;
- cold start to `RendererRuntime`/legacy debug ready;
- asset loading total/completed/failed and completion time;
- menu open and representative scene-transition p50/p95;
- frame update monitor snapshot;
- active ticker/listener/tween/async/Blob/display-object/pool counts;
- bundle sizes and warning list;
- deterministic visual states named by the design;
- current full-test count and formal-simulation result.

Do not compare measurements from different build modes or machines as a pass/fail gate.

## 7. Common Commands

Use PowerShell-compatible commands from repository root `E:\surdet`.

```powershell
npm run typecheck
npm test
npm run docs:capabilities:check
npm run verify:hygiene
npm run verify:formal
npm run verify:p1p2
git diff --check
git status --short
```

Phase plans add targeted commands. Capture the exit code and concise totals; do not paste thousands of passing lines into reports.

## 8. Commit Protocol

Before every commit:

```powershell
git status --short
git diff --check
git diff --stat
git diff --cached --stat
```

Stage exact paths; never use `git add -A` or `git add .` in this dirty-by-design workspace. Example:

```powershell
git add -- packages/renderer/src/api/renderer-runtime.ts packages/renderer/test/api/renderer-contract.test.ts
git diff --cached --check
git commit -m "feat(renderer): add v2 runtime contract"
```

Required commit prefixes:

| Milestone | Prefix |
| --- | --- |
| M0 | `chore(renderer):` or `test(renderer):` |
| M1 | `feat(renderer):` |
| M2 | `refactor(renderer):` or `test(renderer):` |
| M3–M7 | `refactor(renderer): extract dialogue layer` (replace `dialogue` with the active domain name) |
| M8 | `refactor(renderer): migrate consumers to v2` and `docs(renderer): publish v2 migration guide` |

Do not amend an already reported milestone commit. Add a focused follow-up commit.

## 9. Per-Milestone Delivery Report

Create:

```text
docs/ENGINE-RENDERER-V2-M<N>-DELIVERY-REPORT-2026-08-09.md
```

Each report must contain:

```markdown
# Renderer v2 M<N> Delivery Report

## Scope
- Plan tasks completed:
- Explicitly deferred:
- Migration-blocking defects fixed:

## Commits
| SHA | Message | Files |

## Contract Evidence
| Requirement | Test/file | Result |

## Commands Run
| Command | Exit code | Tests/summary |

## Resource and Performance Comparison
| Metric | Baseline | Current | Delta | Gate |

## Git State
- `git status --short`:
- `git rev-list --left-right --count HEAD...surdet/main`:
- Internal files excluded:

## Known Risks
- Concrete remaining risks only; write `None observed` if there are none.

## Stop/Approval Request
- Exact next milestone requested:
```

Reports must distinguish fresh independent evidence from claims copied from earlier reports.

## 10. Program-Level Stop Conditions

Stop immediately if any of these occurs:

- a Layer needs to import another Layer;
- a Query changes resource counts or visible state;
- an adapter contains copied rendering logic;
- a task requires DSL or save-schema changes;
- resource cycles grow after the second stable loop;
- a visual difference has no approved explanation;
- typecheck, full tests, formal simulation, HMR, editor preview, or packaged EXE fails;
- performance crosses the design threshold;
- a failing test is removed, skipped, or weakened;
- execution requires modifying a non-target subsystem without an approved design amendment;
- the execution AI cannot explain the old behavior it is about to remove.

On stop: preserve files, do not reset user work, record the last green commit and exact failure, then wait.

## 11. Program Completion

M8 may request final acceptance only when every checklist item in section 14 of the architecture design is satisfied. The execution AI does not self-approve final completion and does not push until the user explicitly authorizes push after independent review.
