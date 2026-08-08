# Surdet Renderer v2 Foundation M0–M2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use parallel subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish truthful evidence/CI baselines, create the Renderer v2 public contract without behavior changes, and install owner-scoped lifecycle, cancellation, diagnostics, and normalized input foundations before extracting UI layers.

**Architecture:** M0 fixes governance and records the `cab200b`-equivalent baseline. M1 adds a command/query facade that delegates to the current implementation while parity tests protect behavior. M2 replaces ad hoc resource and input ownership with scoped primitives consumed by later Layer extractions.

**Tech Stack:** TypeScript 5.7, PixiJS 8.19, Vitest 3, Node test runner, Vite 6, Playwright 1.49, Electron 43, npm workspaces.

## Global Constraints

- Read `docs/superpowers/specs/2026-08-09-renderer-v2-architecture-design.md` and the master plan before this file.
- Work only on M0, M1, and M2. Stop after each milestone report and wait for approval.
- Preserve Renderer behavior, DSL, save format, editor behavior, starter/formal game behavior, HMR, rollback, and packaging.
- Only fix a migration-blocking defect after adding a direct failing test.
- New public names in this plan are locked; do not replace them with `any`, generic maps, or an event bus.
- Do not move Pixi UI implementations into Layers during M0–M2; M3–M7 own those moves.
- Stage exact paths only. Exclude `USER.md`, `SESSION-HANDOFF.md`, generated baselines from foreign machines, screenshots, logs, caches, release output, and `.superpowers/`.

---

## File Map

**Create:**

- `scripts/lib/capability-matrix.mjs` — parse, validate, and render capability records;
- `scripts/test/capability-matrix.test.mjs` — evidence-existence regression tests;
- `scripts/verify-all.mjs` — one non-duplicating local verification orchestrator;
- `packages/renderer/src/api/renderer-errors.ts` — typed errors;
- `packages/renderer/src/api/renderer-input.ts` — normalized actions;
- `packages/renderer/src/api/renderer-commands.ts` — command interfaces;
- `packages/renderer/src/api/renderer-queries.ts` — query interfaces;
- `packages/renderer/src/api/renderer-runtime.ts` — runtime/factory contracts;
- `packages/renderer/src/runtime/renderer-facade.ts` — command/query delegating facade;
- `packages/renderer/src/runtime/create-renderer-runtime.ts` — M1 composition root over current implementation;
- `packages/renderer/src/runtime/presentation-controller.ts` — M2 controller contract/implementation;
- `packages/renderer/src/lifecycle/render-lifecycle.ts` — owner-scoped registry;
- `packages/renderer/src/lifecycle/async-generation.ts` — cancellation generation;
- `packages/renderer/src/services/render-asset-registry.ts` — sole shared asset/font registry;
- `packages/renderer/src/diagnostics/renderer-baseline.ts` — baseline schema/comparison;
- tests under `packages/renderer/test/api`, `lifecycle`, `integration`;
- `packages/shell/e2e/renderer-baseline.e2e.mjs` — isolated Electron measurement harness.

**Modify:**

- `scripts/render-capability-matrix.mjs` — thin CLI around library;
- `docs/capabilities.json` and generated `docs/capability-matrix.md` — real paths;
- `package.json` and `.github/workflows/ci.yml` — atomic, non-duplicating gates;
- `scripts/verify-p1-p2.mjs` — compatibility alias/no duplicate orchestration and shell-free spawn;
- `packages/renderer/src/index.ts` — public v2 exports;
- `packages/renderer/src/resource-lifecycle.ts` — retain compatibility wrapper over new scoped registry;
- `packages/renderer/src/adv-renderer.ts` — only where M2 delegates controller logic; no UI extraction;
- `examples/starter/src/surdet-window.d.ts` and `examples/zero-after-midnight/src/surdet-window.d.ts` — add the exact diagnostic snapshot fields used by M2 acceptance.

## M0 — Truth, CI, and Baseline

### Task 1: Make capability evidence verifiable

**Files:**
- Create: `scripts/lib/capability-matrix.mjs`
- Create: `scripts/test/capability-matrix.test.mjs`
- Modify: `scripts/render-capability-matrix.mjs`
- Modify: `docs/capabilities.json`
- Modify: `docs/capability-matrix.md` via generator only
- Modify: `package.json`

**Interfaces:**
- Produces: `validateCapabilityDocument(input, root): void`
- Produces: `renderCapabilityMatrix(input): string`
- Consumes: capability JSON schema already encoded by the current script

- [ ] **Step 1: Write failing evidence-path tests**

Create a temporary root and assert both missing test and missing documentation paths fail:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateCapabilityDocument } from '../lib/capability-matrix.mjs';

function record(overrides = {}) {
  return {
    id: 'sample', kind: 'ui', core: 'n/a', renderer: 'implemented',
    editor: 'n/a', host: 'n/a', tests: ['test/sample.test.ts'],
    docs: ['docs/sample.md'], ...overrides,
  };
}

test('implemented capability rejects a missing test evidence path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-capability-'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs/sample.md'), '# sample');
  assert.throws(
    () => validateCapabilityDocument({ version: 1, capabilities: [record()] }, root),
    /sample.*test\/sample\.test\.ts.*不存在/,
  );
});

test('capability rejects a missing documentation evidence path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-capability-'));
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'test/sample.test.ts'), '');
  assert.throws(
    () => validateCapabilityDocument({ version: 1, capabilities: [record()] }, root),
    /sample.*docs\/sample\.md.*不存在/,
  );
});
```

- [ ] **Step 2: Run the tests and confirm RED**

Run:

```powershell
node --test scripts/test/capability-matrix.test.mjs
```

Expected: FAIL because `scripts/lib/capability-matrix.mjs` or the exported function does not exist.

- [ ] **Step 3: Extract validation/rendering into the library**

The validator must normalize separators, reject absolute paths and traversal, and verify existence:

```js
import fs from 'node:fs';
import path from 'node:path';

const allowedKinds = new Set(['dsl', 'system', 'ui', 'tooling']);
const allowedStatuses = new Set(['implemented', 'n/a', 'planned']);
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateEvidencePath(root, capabilityId, kind, value) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${capabilityId} 的 ${kind} 证据必须是非空相对路径`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (path.isAbsolute(value) || normalized.split('/').includes('..')) {
    throw new Error(`${capabilityId} 的 ${kind} 证据不是安全相对路径：${value}`);
  }
  if (!fs.existsSync(path.join(root, value))) {
    throw new Error(`${capabilityId} 的 ${kind} 证据不存在：${value}`);
  }
}

export function validateCapabilityDocument(input, root) {
  if (input?.version !== 1) throw new Error('capabilities version 必须为 1');
  if (!Array.isArray(input.capabilities)) throw new Error('capabilities 必须是数组');
  const ids = new Set();
  for (const [index, record] of input.capabilities.entries()) {
    if (!record || typeof record !== 'object') throw new Error(`第 ${index + 1} 条能力记录不是对象`);
    if (typeof record.id !== 'string' || !idPattern.test(record.id) || ids.has(record.id)) {
      throw new Error(`能力 ID 必须是唯一 kebab-case：第 ${index + 1} 条`);
    }
    ids.add(record.id);
    if (!allowedKinds.has(record.kind)) throw new Error(`未知能力 kind：${record.id}`);
    for (const field of ['core', 'renderer', 'editor', 'host']) {
      if (!allowedStatuses.has(record[field])) throw new Error(`未知 ${field} 状态：${record.id}`);
    }
    if (!Array.isArray(record.tests) || !Array.isArray(record.docs)) {
      throw new Error(`tests/docs 必须是数组：${record.id}`);
    }
    if ([record.core, record.renderer, record.editor, record.host].includes('implemented') && record.tests.length === 0) {
      throw new Error(`implemented 能力必须提供非空测试证据：${record.id}`);
    }
    for (const value of record.tests) validateEvidencePath(root, record.id, 'test', value);
    for (const value of record.docs) validateEvidencePath(root, record.id, 'docs', value);
  }
}
```

Move the current deterministic Markdown rendering into `renderCapabilityMatrix(input)`. Keep `scripts/render-capability-matrix.mjs` responsible only for reading files, calling the two functions, comparing/writing output, and setting the exit code.

- [ ] **Step 4: Replace the five nonexistent evidence paths with real evidence**

Use these exact replacements after reading the named tests and confirming the asserted behavior:

```text
backlog: remove packages/renderer/test/backlog.test.ts;
         retain packages/renderer/test/pixi-stage.test.ts.
battle-move: replace packages/renderer/test/battle-view.test.ts
             with packages/renderer/test/gallery.test.ts (contains buildBattleView tests).
gallery-cg: remove packages/core/test/gallery.test.ts;
            retain packages/renderer/test/gallery.test.ts and pixi-stage.test.ts.
gallery-text: remove packages/core/test/gallery.test.ts;
              retain packages/renderer/test/gallery.test.ts and formal example evidence.
save-hooks: replace packages/shell/test/e2e.spec.ts
            with packages/shell/e2e/game.e2e.mjs and packages/host/test/system-router.test.ts.
```

Do not point at a file without reading its assertions. If one listed real file does not directly prove the claim, add a direct test in that existing file before citing it.

- [ ] **Step 5: Add the atomic documentation verification script**

Add to root `package.json`:

```json
"verify:docs": "node --test scripts/test/capability-matrix.test.mjs && node scripts/render-capability-matrix.mjs --check"
```

Keep `docs:capabilities` and `docs:capabilities:check` for compatibility.

- [ ] **Step 6: Run GREEN gates**

Run:

```powershell
node --test scripts/test/capability-matrix.test.mjs
npm run docs:capabilities
npm run verify:docs
```

Expected: Node tests PASS; generator reports the matrix path; verification exits 0 with no missing-evidence message.

- [ ] **Step 7: Commit Task 1**

```powershell
git add -- scripts/lib/capability-matrix.mjs scripts/test/capability-matrix.test.mjs scripts/render-capability-matrix.mjs docs/capabilities.json docs/capability-matrix.md package.json
git diff --cached --check
git commit -m "fix(docs): verify capability evidence paths"
```

### Task 2: Remove CI gate duplication without reducing coverage

**Files:**
- Create: `scripts/verify-all.mjs`
- Modify: `scripts/verify-p1-p2.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Test: `scripts/test/verify-all.test.mjs`

**Interfaces:**
- Produces: `verificationSteps` array with unique step IDs and commands
- Produces: `runVerification(steps, spawn): number`

- [ ] **Step 1: Write a failing uniqueness test**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { verificationSteps } from '../verify-all.mjs';

test('verify-all has unique step ids and command signatures', () => {
  assert.equal(new Set(verificationSteps.map((step) => step.id)).size, verificationSteps.length);
  const signatures = verificationSteps.map((step) => [step.command, ...step.args].join('\0'));
  assert.equal(new Set(signatures).size, signatures.length);
});
```

- [ ] **Step 2: Run RED**

```powershell
node --test scripts/test/verify-all.test.mjs
```

Expected: FAIL because `scripts/verify-all.mjs` does not exist.

- [ ] **Step 3: Implement a shell-free orchestrator**

```js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export const verificationSteps = [
  { id: 'docs', command: npmCommand, args: ['run', 'verify:docs'] },
  { id: 'hygiene', command: npmCommand, args: ['run', 'verify:hygiene'] },
  { id: 'types', command: npmCommand, args: ['run', 'typecheck'] },
  { id: 'tests', command: npmCommand, args: ['test'] },
  { id: 'formal', command: npmCommand, args: ['run', 'verify:formal'] },
  { id: 'editor-build', command: npmCommand, args: ['run', 'build', '-w', 'surdet-editor'] },
  { id: 'starter-build', command: npmCommand, args: ['run', 'build', '-w', 'surdet-starter'] },
  { id: 'formal-build', command: npmCommand, args: ['run', 'build', '-w', 'zero-after-midnight'] },
  { id: 'diff-check', command: 'git', args: ['diff', '--check'] },
];

export function runVerification(steps = verificationSteps, spawn = spawnSync) {
  for (const step of steps) {
    console.log(`[verify:${step.id}] ${step.command} ${step.args.join(' ')}`);
    const result = spawn(step.command, step.args, { cwd: process.cwd(), stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runVerification();
}
```

- [ ] **Step 4: Rewire scripts and CI**

Add:

```json
"verify:all": "node scripts/verify-all.mjs"
```

Move the required-file presence checks from `scripts/verify-p1-p2.mjs` into its only behavior and expose it as `verify:p1p2:policy`. Keep `verify:p1p2` as a backwards-compatible local aggregate that calls policy and `verify:all`. CI calls policy and `verify:all` separately, so each expensive gate runs once:

```json
"verify:p1p2:policy": "node scripts/verify-p1-p2.mjs",
"verify:p1p2": "npm run verify:p1p2:policy && npm run verify:all"
```

Use this CI shape:

```yaml
- name: Verify all
  run: npm run verify:all
- name: P1/P2 policy
  run: npm run verify:p1p2:policy
```

Add unique `starter-lint` and `starter-simulate` entries to `verificationSteps` using the two commands already present in CI. Do not add another workspace test or typecheck entry.

- [ ] **Step 5: Run tests and inspect commands**

```powershell
node --test scripts/test/verify-all.test.mjs
npm run verify:p1p2:policy
npm run verify:all
```

Expected: tests PASS; no Node `DEP0190` warning; each expensive command appears once in `verify:all`; all gates exit 0.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- scripts/verify-all.mjs scripts/test/verify-all.test.mjs scripts/verify-p1-p2.mjs package.json .github/workflows/ci.yml
git diff --cached --check
git commit -m "chore(ci): compose verification gates once"
```

### Task 3: Define and record the Renderer baseline

**Files:**
- Create: `packages/renderer/src/diagnostics/renderer-baseline.ts`
- Create: `packages/renderer/test/diagnostics/renderer-baseline.test.ts`
- Create: `packages/shell/e2e/renderer-baseline.e2e.mjs`
- Create: `docs/baselines/renderer-v2-cab200b.json`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/shell/package.json`

**Interfaces:**
- Produces: `RendererBaseline`, `RendererMetric`, `compareRendererBaseline()`
- Produces: `npm run e2e:renderer-baseline -w @surdet/shell -- --out <path>`

- [ ] **Step 1: Write failing comparison tests**

```ts
import { describe, expect, it } from 'vitest';
import { compareRendererBaseline } from '../../src/diagnostics/renderer-baseline.js';

describe('compareRendererBaseline', () => {
  it('fails timing regressions beyond the configured ratio', () => {
    const result = compareRendererBaseline(
      { coldStartMs: 1000, assetReadyMs: 1000, menuOpenP95Ms: 100, sceneP95Ms: 200 },
      { coldStartMs: 1110, assetReadyMs: 1090, menuOpenP95Ms: 116, sceneP95Ms: 229 },
    );
    expect(result.failures.map((item) => item.metric)).toEqual(['coldStartMs', 'menuOpenP95Ms']);
  });
});
```

- [ ] **Step 2: Run RED**

```powershell
npm test -w @surdet/renderer -- renderer-baseline.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement typed ratio comparison**

```ts
export interface RendererMetricSummary {
  coldStartMs: number;
  assetReadyMs: number;
  menuOpenP95Ms: number;
  sceneP95Ms: number;
}

export interface RendererBaselineComparison {
  failures: Array<{ metric: keyof RendererMetricSummary; baseline: number; current: number; ratio: number; limit: number }>;
}

const limits: Record<keyof RendererMetricSummary, number> = {
  coldStartMs: 1.10,
  assetReadyMs: 1.10,
  menuOpenP95Ms: 1.15,
  sceneP95Ms: 1.15,
};

export function compareRendererBaseline(
  baseline: RendererMetricSummary,
  current: RendererMetricSummary,
): RendererBaselineComparison {
  const failures: RendererBaselineComparison['failures'] = [];
  for (const metric of Object.keys(limits) as Array<keyof RendererMetricSummary>) {
    const ratio = baseline[metric] === 0 ? (current[metric] === 0 ? 1 : Infinity) : current[metric] / baseline[metric];
    if (ratio > limits[metric]) failures.push({ metric, baseline: baseline[metric], current: current[metric], ratio, limit: limits[metric] });
  }
  return { failures };
}
```

Extend `RendererBaseline` with environment, repeated raw samples, resource snapshot, bundle bytes, warning strings, Git SHA, and timestamp. Comparison uses only same-environment results.

- [ ] **Step 4: Add isolated Electron measurement harness**

The harness must:

- parse `--out` and require an explicit output path;
- create a unique temporary userData directory;
- launch Electron/packaged target with that directory;
- wait for `__surdetDebug.assetLoading.done`;
- collect at least five menu and scene samples after one warmup;
- capture resource/asset/font/blob/error values;
- write JSON only to the explicit output path;
- close the app in `finally`;
- verify the resolved temporary directory is under `os.tmpdir()` before recoverable cleanup.

Core launch structure:

```js
const startedAt = performance.now();
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], cwd: shellDir });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__surdetDebug?.assetLoading?.done === true);
  const assetReadyMs = performance.now() - startedAt;
  // warmup once, collect five deterministic samples, sort and calculate p95
} finally {
  await app.close();
}
```

Do not use the user's normal Electron profile.

- [ ] **Step 5: Record baseline and validate schema**

```powershell
npm run build
npm run e2e:renderer-baseline -w @surdet/shell -- --out docs/baselines/renderer-v2-cab200b.json
npm test -w @surdet/renderer -- renderer-baseline.test.ts
```

Expected: JSON contains Git SHA, environment, timing samples, asset count, errors, and resource fields; page/console errors are 0. If the source SHA is `fe72abe`, record `sourceEquivalentTo: cab200b5aaed49b053b18ff05907aac4d02fb731` because `fe72abe` changes documentation only.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- packages/renderer/src/diagnostics/renderer-baseline.ts packages/renderer/test/diagnostics/renderer-baseline.test.ts packages/renderer/src/index.ts packages/shell/e2e/renderer-baseline.e2e.mjs packages/shell/package.json docs/baselines/renderer-v2-cab200b.json
git diff --cached --check
git commit -m "test(renderer): record Wave 2 runtime baseline"
```

- [ ] **Step 7: Write M0 report and stop**

Create `docs/ENGINE-RENDERER-V2-M0-DELIVERY-REPORT-2026-08-09.md`, run `npm run verify:all`, commit the report with `docs(renderer): report M0 baseline gates`, and stop at `WAITING_FOR_APPROVAL`.

## M1 — Public API and Compatibility Contract

### Task 4: Define errors, input actions, Commands, Queries, and Runtime types

**Files:**
- Create: `packages/renderer/src/api/renderer-errors.ts`
- Create: `packages/renderer/src/api/renderer-input.ts`
- Create: `packages/renderer/src/api/renderer-commands.ts`
- Create: `packages/renderer/src/api/renderer-queries.ts`
- Create: `packages/renderer/src/api/renderer-runtime.ts`
- Create: `packages/renderer/test/api/renderer-contract.test.ts`
- Modify: `packages/renderer/src/index.ts`

**Interfaces:**
- Produces every public interface locked by the master plan
- Consumes existing view types from `types.ts`, `ui-views.ts`, `gallery.ts`, and `battle-view.ts`

- [ ] **Step 1: Write compile/runtime contract tests**

Test representative methods from every domain and freeze expected domain keys:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { RendererCommands, RendererQueries, RendererRuntime } from '../../src/index.js';

describe('Renderer v2 public contract', () => {
  it('has stable command and query domains', () => {
    const commandKeys: Array<keyof RendererCommands> = ['assets', 'world', 'dialogue', 'menu', 'gallery', 'system', 'loading', 'preferences', 'presentation'];
    const queryKeys: Array<keyof RendererQueries> = ['world', 'dialogue', 'overlay', 'preferences', 'presentation', 'diagnostics'];
    expect(commandKeys).toHaveLength(9);
    expect(queryKeys).toHaveLength(6);
    expectTypeOf<RendererRuntime['dispose']>().returns.toEqualTypeOf<void>();
  });
});
```

- [ ] **Step 2: Run RED**

```powershell
npm test -w @surdet/renderer -- renderer-contract.test.ts
```

Expected: FAIL because the API modules/exports do not exist.

- [ ] **Step 3: Implement exact public contracts**

Use the architecture design signatures. Define domain methods using existing view types rather than `unknown` except the existing externally opaque presentation payload. Minimum locked shape:

```ts
export interface WorldCommands {
  setBackground(key: string | null): void;
  setPortrait(key: string, view: PortraitView): void;
  removePortrait(key: string): void;
  setFade(alpha: number): void;
  transition(name: TransitionName | string, durationMs: number): boolean;
}

export interface PresentationCommands {
  validate(snapshot: unknown): void;
  restore(snapshot: unknown): void;
  clear(): void;
}

export interface DialogueCommands {
  showText(speaker: string | null, value: string): void;
  showChoices(options: readonly ChoiceOptionView[]): void;
  hideChoices(): void;
  setAwaiting(awaiting: boolean): void;
  showBacklog(entries: readonly BacklogEntry[], onReplayVoice?: (voice: string) => void, query?: string): void;
  hideBacklog(): void;
}

export interface RendererDiagnosticQueries {
  resourceSnapshot(): RendererResourceSnapshot;
  performanceSnapshot(): RenderPerformanceSnapshot | null;
  isDisposed(): boolean;
}
```

Include every baseline public Stage method in exactly one command/query domain. The mapping table in the architecture design is the checklist. Add a comment only when an assignment is non-obvious.

Define `RendererError` as a class preserving `cause`, `code`, `domain`, and optional `command`. Define `RendererInputAction` as a discriminated union, not a string:

```ts
export type RendererInputAction =
  | { type: 'advance' }
  | { type: 'choice.move'; delta: -1 | 1 }
  | { type: 'choice.select'; index: number }
  | { type: 'backlog.toggle' }
  | { type: 'backlog.scroll'; delta: number }
  | { type: 'auto.toggle' }
  | { type: 'skip.toggle'; scope: 'read' | 'all' }
  | { type: 'interface.toggle' }
  | { type: 'escape' };
```

- [ ] **Step 4: Run contract and type gates**

```powershell
npm test -w @surdet/renderer -- renderer-contract.test.ts
npm run typecheck -w @surdet/renderer
```

Expected: PASS with no `any` introduced in the new API directory.

- [ ] **Step 5: Commit Task 4**

```powershell
git add -- packages/renderer/src/api packages/renderer/test/api/renderer-contract.test.ts packages/renderer/src/index.ts
git diff --cached --check
git commit -m "feat(renderer): define v2 runtime contract"
```

### Task 5: Build a v2 facade over current behavior and prove parity

**Files:**
- Create: `packages/renderer/src/runtime/renderer-facade.ts`
- Create: `packages/renderer/src/runtime/create-renderer-runtime.ts`
- Create: `packages/renderer/test/integration/renderer-runtime.test.ts`
- Create: `packages/renderer/test/api/query-purity.test.ts`
- Modify: `packages/renderer/src/index.ts`

**Interfaces:**
- Consumes: M1 public contracts
- Temporarily consumes: current `PixiStage`, `AdvRenderer`, `FrameScheduler`
- Produces: `createRendererRuntime()` and a facade delegating to the current implementation

- [ ] **Step 1: Write RED runtime construction and query-purity tests**

Inject factories so tests do not require WebGL:

```ts
it('constructs one runtime and disposes it idempotently', async () => {
  const internals = fakeInternals();
  const runtime = await createRendererRuntimeFromInternals(internals);
  expect(runtime.canvas).toBe(fakeCanvas);
  runtime.dispose();
  runtime.dispose();
  expect(disposeOrder).toEqual(['scheduler', 'controller', 'stage']);
});

it('diagnostic queries do not mutate visible or resource state', async () => {
  const internals = fakeInternals();
  const runtime = await createRendererRuntimeFromInternals(internals);
  const before = internals.observableSnapshot();
  runtime.queries.diagnostics.resourceSnapshot();
  runtime.queries.presentation.snapshot();
  expect(internals.observableSnapshot()).toEqual(before);
});
```

Define `RendererRuntimeInternals` and `createRendererRuntimeFromInternals(internals)` in `create-renderer-runtime.ts`, export them only from that relative module with `@internal`, and do not re-export them from `packages/renderer/src/index.ts`. Tests import the relative module. Do not expose Pixi factories as public game API.

- [ ] **Step 2: Run RED**

```powershell
npm test -w @surdet/renderer -- renderer-runtime.test.ts query-purity.test.ts
```

Expected: FAIL because factory/facade are absent.

- [ ] **Step 3: Implement the temporary composition root**

Production path:

```ts
export async function createRendererRuntime(options: RendererRuntimeOptions = {}): Promise<RendererRuntime> {
  const stage = new PixiStage();
  await stage.init(options.canvas);
  const controller = new AdvRenderer(stage, options.audio ?? NULL_AUDIO, controllerOptions(options));
  const monitor = options.performanceMonitor ?? new RenderPerformanceMonitor();
  const scheduler = new FrameScheduler(stage.app!, controller, [stage], { monitor });
  const facade = new RendererFacade({ stage, controller, monitor });
  return createRuntimeHandle({ facade, controller, stage, scheduler });
}
```

This is intentionally transitional: the v2 facade delegates to current behavior in M1. Do not copy method bodies. `dispose()` order is scheduler → controller → stage, guarded by one disposed flag. `resetSession()` delegates current semantics.

- [ ] **Step 4: Add parity tests for representative domains**

For fake Stage/Controller calls, assert each v2 domain method produces the same single old call and arguments. Include assets, world, dialogue, menu, gallery, system, loading, preferences, snapshot and diagnostics. Test at least one method per domain plus all stateful restore/reset/dispose calls.

- [ ] **Step 5: Run targeted and full Renderer tests**

```powershell
npm test -w @surdet/renderer -- renderer-contract.test.ts renderer-runtime.test.ts query-purity.test.ts
npm test -w @surdet/renderer
npm run typecheck -w @surdet/renderer
```

Expected: all PASS; existing PixiStage/AdvRenderer tests unchanged.

- [ ] **Step 6: Commit Task 5**

```powershell
git add -- packages/renderer/src/runtime/renderer-facade.ts packages/renderer/src/runtime/create-renderer-runtime.ts packages/renderer/test/integration/renderer-runtime.test.ts packages/renderer/test/api/query-purity.test.ts packages/renderer/src/index.ts
git diff --cached --check
git commit -m "feat(renderer): compose v2 facade over current runtime"
```

- [ ] **Step 7: Write M1 report and stop**

Create and commit `docs/ENGINE-RENDERER-V2-M1-DELIVERY-REPORT-2026-08-09.md`. Run `npm run verify:all`; compare baseline without claiming Layer extraction; stop for approval.

## M2 — Scoped Lifecycle, Cancellation, and Input

### Task 6: Implement owner-scoped RenderLifecycle

**Files:**
- Create: `packages/renderer/src/lifecycle/render-lifecycle.ts`
- Create: `packages/renderer/test/lifecycle/render-lifecycle.test.ts`
- Modify: `packages/renderer/src/resource-lifecycle.ts`
- Modify: `packages/renderer/src/index.ts`

**Interfaces:**
- Produces: `RenderLifecycle`, `RendererResourceSnapshot`, `ResourceOwner`, `ResourceKind`
- Preserves: current `ResourceLifecycle` API as a wrapper

- [ ] **Step 1: Write RED owner and idempotency tests**

```ts
it('releases only the requested owner and reports exact counts', () => {
  const lifecycle = new RenderLifecycle();
  const disposed: string[] = [];
  lifecycle.register('dialogue', 'listener', 'choice', () => disposed.push('choice'));
  lifecycle.register('world', 'tween', 'fade', () => disposed.push('fade'));
  expect(lifecycle.snapshot()).toMatchObject({ listeners: 1, activeTweens: 1 });
  lifecycle.releaseOwner('dialogue');
  lifecycle.releaseOwner('dialogue');
  expect(disposed).toEqual(['choice']);
  expect(lifecycle.snapshot()).toMatchObject({ listeners: 0, activeTweens: 1 });
});
```

Also test key replacement disposes old exactly once, disposer exceptions do not skip later resources, and final dispose is idempotent.

- [ ] **Step 2: Run RED**

```powershell
npm test -w @surdet/renderer -- render-lifecycle.test.ts
```

Expected: FAIL because scoped lifecycle is absent.

- [ ] **Step 3: Implement scoped registry**

Use a composite key and reverse owner index. Locked kinds:

```ts
export type ResourceKind = 'ticker' | 'listener' | 'tween' | 'async' | 'blob' | 'pool' | 'display';
export type ResourceOwner = 'runtime' | 'world' | 'dialogue' | 'menu' | 'gallery' | 'system' | 'loading' | 'legacy';

export class RenderLifecycle {
  register(owner: ResourceOwner, kind: ResourceKind, key: string, dispose: () => void): void;
  release(owner: ResourceOwner, kind: ResourceKind, key: string): boolean;
  releaseOwner(owner: ResourceOwner): void;
  snapshot(): RendererResourceSnapshot;
  dispose(): void;
}
```

Disposer failures are aggregated into one `RendererError` after every selected resource was attempted. Remove registry entries before invoking disposers so re-entrant disposal cannot double-run.

- [ ] **Step 4: Preserve old ResourceLifecycle**

Implement it as a wrapper using owner `legacy` and kind `display`; preserve `register`, `release`, `clear`, and `size`. Run existing tests unchanged.

- [ ] **Step 5: Run GREEN gates**

```powershell
npm test -w @surdet/renderer -- render-lifecycle.test.ts
npm test -w @surdet/renderer
npm run typecheck -w @surdet/renderer
```

- [ ] **Step 6: Commit Task 6**

```powershell
git add -- packages/renderer/src/lifecycle/render-lifecycle.ts packages/renderer/test/lifecycle/render-lifecycle.test.ts packages/renderer/src/resource-lifecycle.ts packages/renderer/src/index.ts
git diff --cached --check
git commit -m "refactor(renderer): add owner-scoped lifecycle"
```

### Task 7: Implement async generation cancellation

**Files:**
- Create: `packages/renderer/src/lifecycle/async-generation.ts`
- Create: `packages/renderer/test/lifecycle/async-generation.test.ts`
- Modify: `packages/renderer/src/index.ts`

**Interfaces:**
- Produces: `AsyncGeneration`, `GenerationToken`

- [ ] **Step 1: Write RED stale-task tests**

```ts
it('invalidates old tokens and never revives after dispose', () => {
  const generation = new AsyncGeneration();
  const first = generation.token();
  generation.advance();
  const second = generation.token();
  expect(first.current).toBe(false);
  expect(second.current).toBe(true);
  generation.dispose();
  expect(second.current).toBe(false);
  expect(() => generation.token()).toThrowError(/RENDERER_DISPOSED/);
});
```

- [ ] **Step 2: Run RED, implement, and run GREEN**

Implementation shape:

```ts
export interface GenerationToken { readonly id: number; readonly signal: AbortSignal; readonly current: boolean; }

export class AsyncGeneration {
  #id = 0;
  #controller = new AbortController();
  #disposed = false;
  token(): GenerationToken;
  advance(): GenerationToken;
  dispose(): void;
}
```

`advance()` aborts the old controller, increments ID, and returns a fresh token. Token `current` checks ID, signal and disposed state dynamically.

Run:

```powershell
npm test -w @surdet/renderer -- async-generation.test.ts
npm run typecheck -w @surdet/renderer
```

- [ ] **Step 3: Commit Task 7**

```powershell
git add -- packages/renderer/src/lifecycle/async-generation.ts packages/renderer/test/lifecycle/async-generation.test.ts packages/renderer/src/index.ts
git diff --cached --check
git commit -m "refactor(renderer): add async generation cancellation"
```

### Task 8: Extract the sole shared RenderAssetRegistry

**Files:**
- Create: `packages/renderer/src/services/render-asset-registry.ts`
- Create: `packages/renderer/test/services/render-asset-registry.test.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/runtime/create-renderer-runtime.ts`
- Modify: `packages/renderer/src/runtime/renderer-facade.ts`
- Modify: `packages/renderer/src/index.ts`

**Interfaces:**
- Consumes: `RenderLifecycle`, `AsyncGeneration`, Pixi `Texture`
- Produces: `RenderAssetRegistry`

- [ ] **Step 1: Write RED atomic replacement and ownership tests**

```ts
it('keeps the old resource when replacement preparation fails', async () => {
  const registry = createAssetRegistryHarness();
  await registry.registerBackground('room', goodSource);
  await expect(registry.registerBackground('room', failingSource)).rejects.toThrow();
  expect(registry.resolveBackground('room')).toBe(goodTexture);
  expect(goodTexture.destroy).not.toHaveBeenCalled();
});

it('shares one font role and disposes it once', async () => {
  const registry = createAssetRegistryHarness();
  await registry.registerFontRole('body', fontUrl, 'GameBody');
  expect(registry.fontFamily('body')).toBe('GameBody');
  registry.dispose();
  registry.dispose();
  expect(removeFontFace).toHaveBeenCalledTimes(1);
});
```

Also test stale generation replacement, avatar/portrait composite keys, Blob source release, reset with and without `clearAssets`, and safe cloned diagnostic metadata.

- [ ] **Step 2: Run RED**

```powershell
npm test -w @surdet/renderer -- render-asset-registry.test.ts
```

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement the explicit registry**

```ts
export interface RenderAssetRegistry {
  registerBackground(key: string, source: string | Texture, format?: string): Promise<void>;
  registerPortrait(charId: string, costume: string, expression: string, source: string | Texture, format?: string): Promise<void>;
  registerAvatar(key: string, source: string | Texture, format?: string): Promise<void>;
  registerFontRole(role: FontRole, url: string, family?: string, timeoutMs?: number): Promise<boolean>;
  resolveBackground(key: string): Texture | null;
  resolvePortrait(charId: string, costume: string, expression: string): Texture | null;
  resolveAvatar(key: string): Texture | null;
  fontFamily(role: FontRole): string;
  reset(options?: { clearAssets?: boolean }): void;
  dispose(): void;
}
```

Move only registration/cache/source/font ownership from `PixiStage`; leave visible Sprite/Text creation in the Stage until its Layer milestone. The registry uses one `AsyncGeneration` and registers destructors with `RenderLifecycle` owner `runtime`. Do not destroy caller-owned `Texture` instances unless the existing contract already owns them; encode ownership metadata explicitly.

- [ ] **Step 4: Make Stage and Facade delegate to the registry**

Preserve every existing registration method signature. `AssetCommands` delegates to the registry. Stage rendering resolves resources from the injected registry. Remove old registration maps only after old Stage tests and the new registry tests prove parity.

- [ ] **Step 5: Run GREEN gates**

```powershell
npm test -w @surdet/renderer -- render-asset-registry.test.ts pixi-stage.test.ts renderer-runtime.test.ts
npm test -w @surdet/renderer
npm run typecheck
```

- [ ] **Step 6: Commit Task 8**

```powershell
git add -- packages/renderer/src/services/render-asset-registry.ts packages/renderer/test/services/render-asset-registry.test.ts packages/renderer/src/pixi-stage.ts packages/renderer/src/runtime/create-renderer-runtime.ts packages/renderer/src/runtime/renderer-facade.ts packages/renderer/src/index.ts
git diff --cached --check
git commit -m "refactor(renderer): centralize shared asset ownership"
```

### Task 9: Normalize input and introduce PresentationController

**Files:**
- Create: `packages/renderer/src/runtime/presentation-controller.ts`
- Create: `packages/renderer/test/runtime/presentation-controller.test.ts`
- Modify: `packages/renderer/src/runtime/create-renderer-runtime.ts`
- Modify: `packages/renderer/src/adv-renderer.ts`
- Modify: `packages/renderer/src/keybindings.ts`
- Modify: `packages/renderer/src/gamepad.ts`
- Modify: `packages/renderer/src/index.ts`

**Interfaces:**
- Consumes: `RendererInputAction`, `RendererCommands`, `RendererQueries`
- Produces: `PresentationController`
- Preserves: public `AdvRenderer` behavior through delegation

- [ ] **Step 1: Write RED action-routing tests**

Cover each union variant and state guard:

```ts
it('routes choice movement only while choosing', () => {
  const controller = createControllerHarness({ status: 'choice' });
  expect(controller.dispatchInput({ type: 'choice.move', delta: -1 })).toBe(true);
  expect(controller.choiceIndex).toBe(0);
  controller.setStatusForTest('awaiting');
  expect(controller.dispatchInput({ type: 'choice.move', delta: 1 })).toBe(false);
});
```

Use public observable state; do not add production setters solely for tests. The harness injects fake commands and Core callbacks.

- [ ] **Step 2: Run RED**

```powershell
npm test -w @surdet/renderer -- presentation-controller.test.ts
```

- [ ] **Step 3: Move control logic without changing it**

Move Core EventBus subscription, typing/awaiting/choice state, advance/select, auto/skip, choice navigation, Backlog control and presentation coordination from `AdvRenderer` into `PresentationController`. Replace direct Stage calls with Commands/Queries.

Preserve existing public getters and return values. `connect(bus)` must return an unsubscribe function and `dispose()` must unsubscribe once.

`AdvRenderer` becomes a compatibility wrapper that constructs or receives a `PresentationController` and delegates every public method/getter. Do not delete the old class or change its constructor during this milestone.

- [ ] **Step 4: Map keyboard/gamepad inputs to actions**

Keep the existing host-level `GameAction` because `menu`, `quickSave`, `quickLoad` and `rollback` are not Renderer actions. Add a pure `rendererInputForGameAction(action: GameAction): RendererInputAction | null` mapping for Renderer-owned actions (`advance`, `auto`, `skip`, `backlog`, `hideUi`); host-owned actions return `null`. Gamepad actions use the same conversion rule. No mapping function installs a DOM listener.

- [ ] **Step 5: Run compatibility gates**

```powershell
npm test -w @surdet/renderer -- presentation-controller.test.ts adv-renderer.test.ts keybindings.test.ts gamepad.test.ts renderer-runtime.test.ts
npm test -w @surdet/renderer
npm run typecheck
```

Expected: all existing AdvRenderer tests remain green; new action tests pass; no public behavior change.

- [ ] **Step 6: Commit Task 9**

```powershell
git add -- packages/renderer/src/runtime/presentation-controller.ts packages/renderer/test/runtime/presentation-controller.test.ts packages/renderer/src/runtime/create-renderer-runtime.ts packages/renderer/src/adv-renderer.ts packages/renderer/src/keybindings.ts packages/renderer/src/gamepad.ts packages/renderer/src/index.ts
git diff --cached --check
git commit -m "refactor(renderer): centralize presentation input control"
```

### Task 10: Integrate lifecycle diagnostics and complete M2

**Files:**
- Modify: `packages/renderer/src/runtime/create-renderer-runtime.ts`
- Modify: `packages/renderer/src/runtime/renderer-facade.ts`
- Create: `packages/renderer/test/integration/resource-cycles.test.ts`
- Modify: `examples/starter/src/surdet-window.d.ts`
- Modify: `examples/zero-after-midnight/src/surdet-window.d.ts`

**Interfaces:**
- `queries.diagnostics.resourceSnapshot()` returns the scoped registry snapshot
- Runtime dispose order remains scheduler → controller → layer/current stage resources

- [ ] **Step 1: Write RED runtime lifecycle tests**

Register one fake resource for each kind and assert reset owner release, Runtime dispose, repeated dispose, and late async completion behavior. Execute two consecutive 50-cycle batches and assert the second stable snapshot equals the first.

- [ ] **Step 2: Run RED**

```powershell
npm test -w @surdet/renderer -- resource-cycles.test.ts
```

- [ ] **Step 3: Wire the registry into the transitional runtime**

Composition Root owns one `RenderLifecycle`; FrameScheduler, Controller unsubscribe, existing Blob/resource cleanup, and async generation are registered under explicit owners. Do not pretend uninstrumented Pixi objects are counted: add exact counters only where ownership is known, and document fields still unavailable until M3–M7.

- [ ] **Step 4: Run M2 gates and compare baseline**

```powershell
npm test -w @surdet/renderer -- resource-cycles.test.ts renderer-runtime.test.ts presentation-controller.test.ts
npm run verify:all
npm run e2e:renderer-baseline -w @surdet/shell -- --out docs/baselines/renderer-v2-m2-current.json
```

Expected: all gates pass; comparison respects 10%/15% limits; page and console errors remain 0. Do not commit machine-specific current measurement unless the baseline schema marks it as an approved same-environment comparison artifact.

- [ ] **Step 5: Commit Task 10 and M2 report**

Stage exact source/tests and `docs/ENGINE-RENDERER-V2-M2-DELIVERY-REPORT-2026-08-09.md`. Commit with focused implementation/report commits. Stop at `WAITING_FOR_APPROVAL` before M3.
