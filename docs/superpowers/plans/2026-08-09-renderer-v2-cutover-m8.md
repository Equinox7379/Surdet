# Surdet Renderer v2 M8 Cutover and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use parallel subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Renderer v2 the sole production path for every in-repository consumer, reduce `PixiStage`/`AdvRenderer` to one-version compatibility adapters, publish migration evidence, and pass full source, visual, resource, performance, HMR, editor, formal-game, and Windows-package acceptance.

**Architecture:** Composition Root owns Pixi Application, shared services, Layers, Controller, Scheduler and disposal. New consumers call `createRendererRuntime()` and domain commands/queries. Legacy exports remain as typed deprecated adapters delegating to the same runtime for one version.

**Tech Stack:** TypeScript 5.7, PixiJS 8.19, Vitest 3, Vite 6, Playwright 1.49, Electron 43, npm workspaces, electron-builder, PowerShell.

## Global Constraints

- M0–M7 must be independently approved before M8 starts.
- M8 may not hide unfinished Layer work inside compatibility adapters.
- Internal consumers must have zero production legacy API use at completion; compatibility files/tests are the only exceptions.
- Preserve current player-visible behavior, DSL, save data, HMR, editor preview, starter, formal game, packaging and encryption.
- Do not remove legacy exports in Wave 2; mark them `@deprecated` and test them.
- Do not print repetitive runtime deprecation warnings in production.
- Do not modify real user data. Packaged acceptance uses a unique isolated temporary directory.
- Do not push until independent final review authorizes it.

---

### Task 19: Invert ownership and contain the legacy API

**Files:**
- Create: `packages/renderer/src/legacy/legacy-stage-adapter.ts`
- Create: `packages/renderer/src/legacy/legacy-renderer-adapter.ts`
- Create: `packages/renderer/test/legacy/legacy-stage-contract.test.ts`
- Create: `packages/renderer/test/legacy/legacy-renderer-contract.test.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/adv-renderer.ts`
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/renderer/src/runtime/create-renderer-runtime.ts`

**Interfaces:**
- Consumes: complete v2 Runtime, Commands, Queries and Controller
- Produces: deprecated `AdvStage`, `PixiStage`, `AdvRenderer` compatibility exports

- [ ] **Step 1: Write final parity tests before deleting residual bodies**

Run one table-driven suite over direct v2 and legacy paths. The table must include every public legacy method/getter, not a representative subset:

```ts
interface LegacyContractCase {
  name: string;
  runLegacy(harness: LegacyHarness): unknown | Promise<unknown>;
  runV2(harness: V2Harness): unknown | Promise<unknown>;
  observe(harness: ContractHarness): unknown;
}

for (const contract of legacyStageContracts) {
  it(contract.name, async () => {
    const legacy = await createLegacyHarness();
    const v2 = await createV2Harness();
    expect(await contract.runLegacy(legacy)).toEqual(await contract.runV2(v2));
    expect(contract.observe(legacy)).toEqual(contract.observe(v2));
  });
}
```

Create an explicit compile-time list of `keyof AdvStage` and public `PixiStage`/`AdvRenderer` methods so a forgotten method fails review/test rather than silently disappearing.

- [ ] **Step 2: Run RED where residual methods are not yet delegated**

```powershell
npm test -w @surdet/renderer -- legacy-stage-contract.test.ts legacy-renderer-contract.test.ts
```

Expected: PASS for already delegated domains and a precise failure/list gap for any residual public method.

- [ ] **Step 3: Implement thin adapters**

`LegacyStageAdapter` contains only property/method forwarding, callback bridging and synchronous-constructor compatibility. `LegacyRendererAdapter` contains only Controller delegation. Representative shape:

```ts
/** @deprecated Use createRendererRuntime() and RendererRuntime.commands/queries. */
export class LegacyStageAdapter implements AdvStage {
  constructor(protected readonly runtime: RendererRuntime) {}
  setBackground(key: string | null): void { this.runtime.commands.world.setBackground(key); }
  showText(speaker: string | null, value: string): void { this.runtime.commands.dialogue.showText(speaker, value); }
  snapshotPresentation(): unknown { return this.runtime.queries.presentation.snapshot(); }
}
```

Because historical `new PixiStage(); await stage.init(canvas)` is synchronous-then-async, preserve that shape in `PixiStage` by creating the v2 runtime during `init`. Calls before successful `init` must produce the same documented behavior or a typed `RENDERER_NOT_INITIALIZED` error covered by tests.

`AdvRenderer` delegates to `PresentationController` and preserves constructor/method/getter signatures. It must not contain copied state-machine logic.

- [ ] **Step 4: Remove duplicate implementation from legacy files**

After all parity tests pass, inspect `pixi-stage.ts` and `adv-renderer.ts`. They may contain:

- compatibility constructor/init plumbing;
- adapter forwarding;
- deprecated JSDoc;
- required public type re-exports.

They may not contain Pixi UI construction, view state, animation/ticker logic, resource maps, Core event switch logic or a second snapshot implementation.

- [ ] **Step 5: Run adapter and full Renderer gates**

```powershell
npm test -w @surdet/renderer -- legacy-stage-contract.test.ts legacy-renderer-contract.test.ts renderer-runtime.test.ts
npm test -w @surdet/renderer
npm run typecheck
npm run verify:renderer-boundaries
```

- [ ] **Step 6: Commit Task 19**

```powershell
git add -- packages/renderer/src/legacy packages/renderer/test/legacy packages/renderer/src/pixi-stage.ts packages/renderer/src/adv-renderer.ts packages/renderer/src/types.ts packages/renderer/src/index.ts packages/renderer/src/runtime/create-renderer-runtime.ts
git diff --cached --check
git commit -m "refactor(renderer): contain legacy API adapters"
```

### Task 20: Add a static legacy-use audit

**Files:**
- Create: `scripts/check-renderer-legacy-usage.mjs`
- Create: `scripts/test/renderer-legacy-usage.test.mjs`
- Modify: `package.json`
- Modify: `scripts/verify-all.mjs`

**Interfaces:**
- Produces: `checkLegacyUsage(root): string[]`
- Produces: `npm run verify:renderer-legacy`

- [ ] **Step 1: Write a RED fixture test**

```js
test('allows adapters/tests but rejects production imports', () => {
  const root = createFixture({
    'examples/game/src/main.ts': "import { PixiStage } from '@surdet/renderer';\n",
    'packages/renderer/src/legacy/legacy-stage-adapter.ts': "import type { AdvStage } from '../types.js';\n",
  });
  expect(checkLegacyUsage(root)).toEqual([
    'examples/game/src/main.ts imports legacy renderer symbol PixiStage',
  ]);
});
```

- [ ] **Step 2: Implement exact symbol scanning**

Scan TypeScript/JavaScript imports and constructor references for `PixiStage`, `AdvRenderer`, and `AdvStage`. Allow only:

```text
packages/renderer/src/legacy/**
packages/renderer/src/pixi-stage.ts
packages/renderer/src/adv-renderer.ts
packages/renderer/src/types.ts
packages/renderer/test/legacy/**
```

Do not allow blanket path exemptions for all tests/examples. Return sorted failures.

- [ ] **Step 3: Add the gate and confirm it initially reports consumers**

```json
"verify:renderer-legacy": "node --test scripts/test/renderer-legacy-usage.test.mjs && node scripts/check-renderer-legacy-usage.mjs"
```

Before Task 21 migration, repository CLI is expected to exit 1 and list starter, formal, editor and template use sites. Save that list in the M8 working notes; do not weaken the scanner.

- [ ] **Step 4: Commit scanner and fixture test**

```powershell
git add -- scripts/check-renderer-legacy-usage.mjs scripts/test/renderer-legacy-usage.test.mjs package.json scripts/verify-all.mjs
git diff --cached --check
git commit -m "test(renderer): audit legacy API consumers"
```

Do not add the failing repository check to `verify:all` until Task 21 completes; add only the Node fixture test now.

### Task 21: Migrate starter and formal game to Renderer v2

**Files:**
- Modify: `examples/starter/src/main.ts`
- Modify: `examples/starter/src/surdet-window.d.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `examples/zero-after-midnight/src/surdet-window.d.ts`
- Modify: `examples/shared/rollback-runtime.ts` — replace legacy renderer/stage types with narrow v2 Controller and presentation ports; behavior is frozen
- Test: starter rollback/HMR and formal simulation

**Interfaces:**
- Consumes: `createRendererRuntime`, `RendererRuntime`, `RendererInputAction`
- Removes: production use of `new PixiStage`, `new AdvRenderer`, `stage.app`, manual `FrameScheduler`

Replace the shared rollback helper's legacy types with this exact narrow port:

```ts
export interface RollbackRendererPort {
  readonly status: RenderStatus;
  readonly backlogOpen: boolean;
  resetSession(options?: { preserveWorld?: boolean; clearAssets?: boolean }): void;
  snapshotPresentation(): unknown;
  restorePresentation(snapshot: unknown): void;
}
```

Each game supplies one adapter backed by `runtime.controller`, `runtime.resetSession`, `runtime.queries.presentation.snapshot()` and `runtime.commands.presentation.restore()`. `createRollbackRuntime()` behavior and synchronous `perform(): boolean` remain unchanged.

- [ ] **Step 1: Add/extend consumer smoke assertions before migration**

Debug API must expose semantic v2 data without private Layer access:

```ts
get rendererStatus(): string { return runtime.controller.status; },
get resourceSnapshot(): RendererResourceSnapshot { return runtime.queries.diagnostics.resourceSnapshot(); },
get presentationSnapshot(): unknown { return runtime.queries.presentation.snapshot(); },
```

Extend HMR test to assert the runtime session remains, resources stabilize, and queries do not change the snapshot.

- [ ] **Step 2: Migrate initialization**

Replace:

```ts
const stage = new PixiStage();
await stage.init();
const renderer = new AdvRenderer(stage, audio, options);
new FrameScheduler(stage.app!, renderer, [stage], options);
```

with:

```ts
const runtime = await createRendererRuntime({
  audio,
  performanceMonitor,
  onError: (error) => console.error('[starter] Renderer failed:', error),
  onAdvance: () => interpreter.advance(),
  onSelect: (index) => interpreter.choose(index),
  onWaitEnd: () => interpreter.finishWait(),
});
appEl.appendChild(runtime.canvas);
runtime.resize();
const renderer = runtime.controller;
```

Callbacks reference the already-created Interpreter, never the Runtime being initialized. Follow the public API; do not expose internals to solve initialization order.

- [ ] **Step 3: Replace all Stage calls domain by domain**

Use exact mappings:

```text
asset registration → runtime.commands.assets
background/portrait/effects → commands.world
complete presentation validate/restore/clear → commands.presentation
fonts → commands.assets / queries.preferences or asset query
text/banner/rail/backlog/NVL → commands.dialogue
title/ending/system/settings/save-load → commands.menu
Gallery → commands.gallery
battle/map/shop/base/video → commands.system
loading → commands.loading
thumbnail/presentation snapshot/performance/resource state → queries
resize → runtime.resize
session reset/dispose → runtime.resetSession/runtime.dispose
```

Replace manual keyboard/mouse/gamepad condition trees with normalized `renderer.dispatchInput(action)` where the Controller owns the behavior. Host-only overlays may still guard input before dispatch.

- [ ] **Step 4: Preserve HMR and rollback boundaries**

HMR keeps the same long-lived Runtime and only swaps valid scene content. Invalid updates keep previous state. rollback snapshot/restore uses v2 presentation queries/commands and existing generation rules. Do not create a second Runtime during HMR.

- [ ] **Step 5: Run starter gates**

```powershell
npm run typecheck -w surdet-starter
npm test -w surdet-starter -- rollback-runtime.test.ts vite-scene-hmr.test.ts
npm run lint -w surdet-starter
node packages/cli/dist/index.js simulate examples/starter --assume battleWon=true
npm run build -w surdet-starter
```

- [ ] **Step 6: Apply the same v2 migration to the formal game**

Do not copy starter-specific story/system behavior. Use the same Renderer Runtime API, retain formal game configuration and callbacks.

- [ ] **Step 7: Run formal gates**

```powershell
npm run typecheck -w zero-after-midnight
npm run verify:formal
npm test -w zero-after-midnight
npm run build -w zero-after-midnight
```

- [ ] **Step 8: Run resource and baseline comparison**

For both games, exercise title → story → Backlog → settings → save/load → Gallery → system panel → reset. Run two stable 50-cycle batches for accessible overlays. Compare M8 timings to same-environment baseline.

- [ ] **Step 9: Commit Task 21 in two focused commits**

```powershell
git add -- examples/starter/src examples/starter/test
git commit -m "refactor(starter): adopt Renderer v2 runtime"

git add -- examples/zero-after-midnight/src
git commit -m "refactor(formal): adopt Renderer v2 runtime"
```

Stage only changed exact files; do not include generated `dist`.

### Task 22: Migrate editor preview and CLI game template

**Files:**
- Modify: `packages/editor/src/preview.ts`
- Modify: `packages/editor/src/preview-diagnostics.ts` if diagnostic types change
- Modify: editor preview tests
- Modify: `packages/cli/templates/game/src/main.ts`
- Modify: `packages/cli/templates/game/src/scene-hmr-boundary.ts`
- Modify: CLI `new`/template tests

**Interfaces:**
- Consumes: same public v2 API as games
- Removes: editor/template production legacy usage

- [ ] **Step 1: Add editor preview lifecycle tests**

Assert one Runtime is created, preview reload/reset does not duplicate canvas/ticker/listeners, settings/save-load/map callbacks work, and teardown calls `runtime.dispose()` once. Diagnostic UI reads Queries only.

- [ ] **Step 2: Migrate editor preview**

Replace global `stage: PixiStage | null` and `renderer: AdvRenderer | null` with one `runtime: RendererRuntime | null`. Replace all calls through domains. Frame scheduling is internal. Canvas listeners dispatch normalized actions and are registered/disposed with preview lifecycle.

- [ ] **Step 3: Run editor gates**

```powershell
npm test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

- [ ] **Step 4: Migrate CLI template**

Generated games initialize `createRendererRuntime()`, use v2 domains, and dispose on teardown. Keep the template minimal; do not copy formal-game systems.

- [ ] **Step 5: Prove generated project health**

Extend `packages/cli/test/new.test.ts` to create a temporary game and assert its source imports `createRendererRuntime` and not `PixiStage`/`AdvRenderer`. Run its lint/typecheck path already used by the CLI test harness.

```powershell
npm test -w @surdet/cli -- new.test.ts lint.test.ts
npm run typecheck -w @surdet/cli
```

- [ ] **Step 6: Enable and pass repository legacy scan**

Add `verify:renderer-legacy` to `verify-all.mjs`, then run:

```powershell
npm run verify:renderer-legacy
```

Expected: PASS; production legacy uses are zero; adapters and legacy tests remain.

- [ ] **Step 7: Commit Task 22**

Use focused commits:

```text
refactor(editor): adopt Renderer v2 runtime
refactor(cli): generate Renderer v2 games
```

### Task 23: Publish migration and API documentation

**Files:**
- Create: `docs/renderer-v2-migration.md`
- Modify: `README.md`
- Modify: `docs/AI-GUIDE.md`
- Modify: `docs/capabilities.json`
- Regenerate: `docs/capability-matrix.md`
- Modify: `packages/renderer/src/index.ts` — export v2 entry points and retain deprecated legacy exports with exact JSDoc

**Interfaces:**
- Documents: one-version compatibility policy and next-major removal condition

- [ ] **Step 1: Write the migration guide with complete mappings**

Required sections:

```text
installation/initialization;
old PixiStage + AdvRenderer example;
new createRendererRuntime example;
complete old method → v2 domain table;
Commands vs Queries rule;
input action migration;
resource ownership/disposal;
presentation snapshot migration;
editor/template migration;
deprecated API window and next-major removal;
common errors with RendererErrorCode;
audit command.
```

Do not use ellipses in code examples. Every example must typecheck in a documentation test or extracted sample fixture.

- [ ] **Step 2: Mark legacy symbols deprecated**

Use JSDoc:

```ts
/**
 * @deprecated Use `createRendererRuntime()` and `RendererRuntime.commands/queries`.
 * Compatibility is retained for Wave 2 and scheduled for removal in the next major version.
 */
```

Do not emit per-call console warnings in production.

- [ ] **Step 3: Update capability evidence truthfully**

Add Renderer v2/lifecycle capabilities only when code and direct tests exist. All cited files must pass the M0 existence validator. Regenerate the matrix; do not hand-edit generated Markdown.

- [ ] **Step 4: Run documentation gates**

```powershell
npm run docs:capabilities
npm run verify:docs
npm run verify:renderer-legacy
```

- [ ] **Step 5: Commit Task 23**

```powershell
git add -- docs/renderer-v2-migration.md README.md docs/AI-GUIDE.md docs/capabilities.json docs/capability-matrix.md packages/renderer/src/index.ts
git diff --cached --check
git commit -m "docs(renderer): publish v2 migration guide"
```

### Task 24: Run final visual, resource, performance, and source gates

**Files:**
- Create: `packages/shell/e2e/renderer-v2-acceptance.e2e.mjs`
- Modify: `packages/shell/package.json` — add `e2e:renderer-v2` for the deterministic acceptance harness
- Create: `docs/ENGINE-RENDERER-V2-WAVE-2-DELIVERY-REPORT-2026-08-09.md`

**Interfaces:**
- Consumes all M0–M8 gates and baseline artifacts

- [ ] **Step 1: Run targeted Renderer suites**

```powershell
npm test -w @surdet/renderer
npm test -w surdet-starter -- rollback-runtime.test.ts vite-scene-hmr.test.ts
npm test -w @surdet/host -- system-router.test.ts
npm test -w @surdet/core -- interpreter-save.test.ts variable-store.test.ts audit-fixes.test.ts
```

Expected: all PASS; total tests exceed the `cab200b` baseline 766.

- [ ] **Step 2: Run total source gates once**

```powershell
npm run verify:all
npm run verify:renderer-boundaries
npm run verify:renderer-legacy
git diff --check
```

- [ ] **Step 3: Run deterministic visual suite**

Exercise title, ADV+Ruby, narration, choice, NVL, Backlog, settings, save/load, Gallery tabs, battle, map, shop, base, particle/transition and reduced-motion. Record each state PASS/FAIL and link any approved delta. Zero unexplained deltas are allowed.

- [ ] **Step 4: Run resource cycles and same-environment performance comparison**

For every Layer, run two 50-cycle batches. Compare stable ticker, listener, tween, async, Blob, display-object and pool counts. Record startup/assets/menu/scene deltas against M0. Stop if 10%/15% limits are exceeded.

- [ ] **Step 5: Inspect source containment**

Record:

```powershell
rg -n "new PixiStage|new AdvRenderer|AdvStage" packages examples -g "*.ts"
rg -n "from .*layers/" packages/renderer/src/layers -g "*.ts"
```

Expected: legacy names only in allowed adapter/tests; no cross-Layer import. Inspect `pixi-stage.ts` and `adv-renderer.ts` manually to confirm forwarding only.

### Task 25: Build and independently validate the Windows artifact

**Files:**
- No source changes unless a fresh failing packaging test proves a migration-blocking defect
- Output: existing ignored `packages/shell/release/`

**Interfaces:**
- Produces: unpacked EXE hash and isolated acceptance evidence

- [ ] **Step 1: Protect staging and package with encryption policy**

Use the existing pack workflow; do not set `SURDET_ENCRYPT=0`. Confirm the staging protection and artifact verifier pass.

```powershell
npm run pack -w @surdet/shell
node packages/shell/scripts/verify-pack.mjs --artifact
```

- [ ] **Step 2: Hash the exact artifact**

```powershell
Get-FileHash -LiteralPath 'E:\surdet\packages\shell\release\win-unpacked\Surdet Game.exe' -Algorithm SHA256
```

Record path, bytes, modification time and SHA-256.

- [ ] **Step 3: Launch with a fresh isolated userData**

Acceptance must prove:

```text
canvas exists;
all packaged assets complete with failed=0;
body/title/ui fonts bound;
resource IDs/session established;
title → story works;
system boundary probe clears rollback;
quick save/load succeeds;
Profile and Settings write/read only in temporary directory;
resource diagnostics are stable;
page errors=0 and console errors=0.
```

Close the app in `finally`. Verify the resolved directory is the exact newly created child of the intended temporary root before sending it to Recycle Bin or deleting it.

- [ ] **Step 4: Complete the Wave 2 delivery report**

The report includes every milestone SHA, total changed files, exact test totals, formal simulation, visual table, resource cycles, performance comparison, legacy/boundary scans, artifact hash, isolated EXE result, warnings, known risks and current Git state.

- [ ] **Step 5: Commit report and stop for independent review**

```powershell
git add -- docs/ENGINE-RENDERER-V2-WAVE-2-DELIVERY-REPORT-2026-08-09.md
git diff --cached --check
git commit -m "docs(renderer): report Wave 2 delivery"
git status --short
git rev-list --left-right --count HEAD...surdet/main
```

Do not push. Stop and request independent final review. Push only after explicit approval.
