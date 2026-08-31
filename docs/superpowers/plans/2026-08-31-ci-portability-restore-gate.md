# CI Portability Restore Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the root tooling gate on a clean Ubuntu checkout by removing one Windows-only repository root and by typechecking the Renderer v2 documentation fixture against workspace source files instead of prebuilt package output.

**Architecture:** Keep both repairs inside the existing root tooling tests. The v2 documentation fixture gets a dedicated test-only TypeScript project whose aliases point to the authoritative Core and Renderer source entrypoints; the v4 qualification test derives the repository root from its own module URL. No production package, runtime, public contract, build output, dependency, or historical qualification artifact changes.

**Tech Stack:** Node.js test runner, ECMAScript modules, TypeScript project configuration, npm workspace tooling, Git.

## Global Constraints

- This is the first of three independently reviewed repair gates: `CI_PORTABILITY_RESTORE` only.
- Do not touch timeline autosave identity, review terminal receipts, Asset Center, Frontend Pass 5, or mainline Wave 7.
- Do not skip tests, weaken assertions, add a compatibility fallback, or depend on committed/generated `dist` files.
- Do not modify package exports or production source merely to make a documentation fixture compile.
- Do not rewrite Renderer v4 protocol paths or historical Windows artifacts; only the current test's repository-root discovery is portable.
- Preserve all protected and unrelated untracked files. Stage only the files listed in this plan.
- A local Windows green run is not proof of Ubuntu CI restoration. Remote recovery remains unverified until a later explicitly authorized push and CI run.
- No push, release, deployment, asset work, or transition to the next repair gate is authorized by this plan.

---

## File map

- Create `scripts/test/fixtures/renderer-v2-docs.tsconfig.json`: test-only TypeScript project that resolves `@surdet/core` and `@surdet/renderer` to workspace source entrypoints.
- Modify `scripts/test/renderer-v2-docs.test.mjs`: freeze the source-alias contract and invoke `tsc` with the dedicated project.
- Modify `scripts/test/renderer-v4-qualification.test.mjs`: freeze module-relative root discovery and remove the hard-coded drive path.
- Create and append `docs/superpowers/plans/2026-08-31-ci-portability-restore-gate.md`: implementation instructions and truthful execution ledger.

### Task 1: Freeze the cross-platform contracts with deterministic RED tests

**Files:**
- Modify: `scripts/test/renderer-v2-docs.test.mjs`
- Modify: `scripts/test/renderer-v4-qualification.test.mjs`
- Modify: `docs/superpowers/plans/2026-08-31-ci-portability-restore-gate.md`

**Interfaces:**
- Consumes: repository-relative `docs/examples/renderer-v2-migration.ts` and the current v4 qualification plan/protocol.
- Produces: permanent assertions that the documentation compiler project exists, maps both workspace packages to source, includes the exact fixture, and that the v4 test contains no fixed `E:/surdet` root.

- [x] **Step 1: Add the v2 compiler-project contract before creating the project file**

Add `fixtureConfigPath` plus a test that reads the future JSON project and requires these exact values:

```js
const fixtureConfigPath = join(root, 'scripts', 'test', 'fixtures', 'renderer-v2-docs.tsconfig.json');

test('Renderer v2 docs compile against workspace sources without prebuilt dist packages', () => {
  const config = JSON.parse(readFileSync(fixtureConfigPath, 'utf8'));
  assert.equal(config.compilerOptions.baseUrl, '../../..');
  assert.deepEqual(config.compilerOptions.paths, {
    '@surdet/core': ['packages/core/src/index.ts'],
    '@surdet/renderer': ['packages/renderer/src/index.ts'],
  });
  assert.deepEqual(config.files, ['../../../packages/renderer/src/pixi-unsafe-eval.d.ts']);
  assert.deepEqual(config.include, ['../../../docs/examples/renderer-v2-migration.ts']);
});
```

- [x] **Step 2: Add the v4 module-relative-root contract before changing the root**

Use `fileURLToPath(import.meta.url)` to identify the test source, then assert that the repository marker exists at the derived root and that the test source does not contain `path.resolve('E:/surdet')`:

```js
const testPath = fileURLToPath(import.meta.url);

test('qualification tooling resolves the repository from its module location', () => {
  assert.equal(fs.existsSync(path.join(root, 'package.json')), true);
  const source = fs.readFileSync(testPath, 'utf8');
  assert.doesNotMatch(source, /path\.resolve\(['"]E:\/surdet['"]\)/i);
});
```

- [x] **Step 3: Run the two focused test files and preserve the expected RED**

Run:

```powershell
node --test scripts/test/renderer-v2-docs.test.mjs scripts/test/renderer-v4-qualification.test.mjs
```

Expected: non-zero exit. The first relevant failures must be the absent v2 test project and the detected hard-coded v4 drive root. Product/runtime assertions must not be weakened to obtain RED.

### Task 2: Make the v2 documentation fixture independent of built package output

**Files:**
- Create: `scripts/test/fixtures/renderer-v2-docs.tsconfig.json`
- Modify: `scripts/test/renderer-v2-docs.test.mjs`
- Modify: `docs/superpowers/plans/2026-08-31-ci-portability-restore-gate.md`

**Interfaces:**
- Consumes: `tsconfig.base.json`, `packages/core/src/index.ts`, `packages/renderer/src/index.ts`, and `docs/examples/renderer-v2-migration.ts`.
- Produces: a test-only TypeScript project and a `tsc --project` invocation; no emitted files.

- [x] **Step 1: Create the dedicated compiler project**

Create exactly:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "lib": ["ES2022", "DOM"],
    "baseUrl": "../../..",
    "paths": {
      "@surdet/core": ["packages/core/src/index.ts"],
      "@surdet/renderer": ["packages/renderer/src/index.ts"]
    }
  },
  "files": ["../../../packages/renderer/src/pixi-unsafe-eval.d.ts"],
  "include": ["../../../docs/examples/renderer-v2-migration.ts"]
}
```

- [x] **Step 2: Compile through the project rather than naked package resolution**

Replace the individual compiler flags and fixture filename with:

```js
const result = spawnSync(process.execPath, [
  compiler,
  '--project', fixtureConfigPath,
], { cwd: root, encoding: 'utf8', shell: false });
```

Keep the existing documentation completeness checks and error reporting unchanged.

- [x] **Step 3: Run the focused v2 test**

Run:

```powershell
node --test scripts/test/renderer-v2-docs.test.mjs
```

Expected: both v2 subtests pass without reading `packages/core/dist` or `packages/renderer/dist`.

### Task 3: Make the v4 qualification test repository-relative

**Files:**
- Modify: `scripts/test/renderer-v4-qualification.test.mjs`
- Modify: `docs/superpowers/plans/2026-08-31-ci-portability-restore-gate.md`

**Interfaces:**
- Consumes: the v4 test module URL.
- Produces: an absolute repository root derived as two parents above `scripts/test`, equally valid on Windows and POSIX.

- [x] **Step 1: Replace the fixed drive root**

Import `fileURLToPath` from `node:url` and use:

```js
const testPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(testPath), '..', '..');
```

Do not change frozen Windows paths inside historical v4 protocol documents or evidence artifacts.

- [ ] **Step 2: Run the focused v4 test (not run separately; covered by the combined and aggregate gates)**

Run:

```powershell
node --test scripts/test/renderer-v4-qualification.test.mjs
```

Expected: all v4 subtests pass from the current repository without a drive-letter assumption.

- [x] **Step 3: Run both focused files together**

Run:

```powershell
node --test scripts/test/renderer-v2-docs.test.mjs scripts/test/renderer-v4-qualification.test.mjs
```

Expected: all subtests pass in one process invocation.

### Task 4: Verify, freeze, and stop at independent review

**Files:**
- Modify: `scripts/test/renderer-v2-docs.test.mjs`
- Modify: `scripts/test/renderer-v4-qualification.test.mjs`
- Create: `scripts/test/fixtures/renderer-v2-docs.tsconfig.json`
- Modify: `docs/superpowers/plans/2026-08-31-ci-portability-restore-gate.md`

**Interfaces:**
- Consumes: the exact RED→GREEN changes from Tasks 1–3.
- Produces: one reviewable code/docs commit and fresh local evidence with an explicit Ubuntu boundary.

- [x] **Step 1: Run the root tooling gate**

Run:

```powershell
npm run verify:tools
```

Expected: all root tooling tests pass.

- [x] **Step 2: Run the aggregate local verification once**

Run:

```powershell
npm run verify:all
```

Expected: exit zero. If it fails, record the first failing node and stop; do not rerun or reinterpret the failure as green. A Windows pass still does not prove Ubuntu CI.

- [x] **Step 3: Check exact scope and whitespace**

Run:

```powershell
git diff --check
git diff --cached --check
git status --short
```

Expected: both diff checks exit zero; no protected or unrelated path is staged.

- [ ] **Step 4: Stage only the four gate files and commit (superseded by Recovery Task 3 Step 2)**

Run the equivalent of these exact-path operations:

```powershell
git add -- scripts/test/renderer-v2-docs.test.mjs scripts/test/renderer-v4-qualification.test.mjs scripts/test/fixtures/renderer-v2-docs.tsconfig.json docs/superpowers/plans/2026-08-31-ci-portability-restore-gate.md
git diff --cached --name-only
git diff --cached --check
git commit -m "fix(ci): restore cross-platform verification"
```

Expected staged set: exactly the four listed paths. Do not use `git add .` or `git add -A`.

- [x] **Step 5: Append final evidence and stop**

Record the final HEAD, parent, focused counts, root-gate result, aggregate result, tracked/staging state, and the explicit `UBUNTU_CI_NOT_YET_REVERIFIED` boundary. If the post-commit ledger append creates a docs-only tracked change, leave it uncommitted for reviewed closure rather than amending history.

Final stop state:

```text
CI_PORTABILITY_RESTORE_LOCAL_VERIFIED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
REMOTE_UBUNTU_CI_NOT_REVERIFIED
TIMELINE_AUTOSAVE_IDENTITY_FAIL_CLOSED_NOT_STARTED
REVIEW_TERMINAL_ATOMICITY_NOT_STARTED
ASSET_CENTER_NOT_STARTED
PUSH_NOT_PERFORMED
```

## Execution Ledger

Append-only. Record commands, exit codes, test counts, failures, commit identities, and evidence boundaries here without deleting earlier facts.

- 2026-08-31 baseline: `HEAD=e238b23a782cad7e8b342879ae60f34a2c2968d4`, `surdet/main=bca72247d0dc76983330367be0f38043036a0fca`, ahead/behind `4/0`, tracked worktree clean, staging empty. Existing untracked/protected paths remain outside scope. Push is not authorized.
- Scope audit: remote failure signatures map to two root-tooling defects only: the v2 documentation fixture resolves workspace package exports through absent `dist` declarations in a clean checkout, and the v4 qualification test fixes its root at `E:/surdet`. No production runtime defect is inferred from these signatures.
- Focused RED #1: `node --test scripts/test/renderer-v2-docs.test.mjs scripts/test/renderer-v4-qualification.test.mjs` exited `1` with `6` tests, `4` passed and `2` failed. The exact failures were absent `scripts/test/fixtures/renderer-v2-docs.tsconfig.json` and the permanent contract detecting `path.resolve('E:/surdet')`; the four existing semantic tests remained green.
- First implementation probe: both original defects were crossed, but the focused run exited `1` with `5/6` passed because source-level compilation did not automatically include Renderer’s existing ambient declaration `packages/renderer/src/pixi-unsafe-eval.d.ts`. The fix boundary remains test-only: explicitly include that authoritative declaration rather than disabling strictness or adding a duplicate declaration.
- Focused RED #2: after freezing that declaration requirement, the v2-only run exited `1` with `0/2` passed: the contract observed the absent `files` entry and TypeScript emitted `TS7016` for `pixi.js/unsafe-eval`. This proved the ambient-declaration path before the configuration was changed.
- Focused GREEN: the v2-only run passed `2/2`; the combined v2/v4 run passed `6/6`. The v2 project points both workspace package names at `src/index.ts`, explicitly includes the existing Renderer ambient declaration, and emits nothing. The v4 test root is derived from `import.meta.url`.
- Root tooling gate: `npm run verify:tools` exited `0` with `12/12` tests passed. `git diff --check` was also clean before the aggregate run.
- Aggregate local gate: the one planned `npm run verify:all` exited `1`; it was not rerun. The run passed `verify:tools`, Renderer boundaries `3/3`, Renderer legacy `4/4`, docs, tracked hygiene and all workspace typechecks, then failed inside `verify:tests` at `@surdet/cli`.
- The CLI Vitest summary reported `32` files passed, `4` files failed, `270` tests passed and `4` tests failed. Every summarized failure was a timeout under the default parallel run: `authoring-vertical-slice.test.ts` at `15000ms`, `authoring-project-config-wave3.test.ts` at `15000ms`, `agent-port-composition.test.ts` at `5000ms`, and `composition-service.test.ts` at `5000ms`. No assertion from the two portability targets failed.
- The CLI stream also emitted a separate Node test failure, `Editor writes the open success status only after the rebuilt DOM exists`, before Vitest's four-failure summary. Vitest did not count it in that summary, so its contribution is recorded as unresolved rather than silently discarded or reclassified.
- After the CLI failure, the aggregate command continued collecting evidence: Core `329/329`, Editor `378/378`, Host `87/87`, Renderer `413/413`, Shell `195/195`, Starter `7/7`, and Zero After Midnight `29/29` passed. These later greens do not change the aggregate exit code.
- Stop decision: Task 4's fail branch applies. No retry, timeout change, staging, commit, push, second repair gate, or Asset Center work was performed. `HEAD` remains `e238b23a782cad7e8b342879ae60f34a2c2968d4`; the code target is focused-green but the gate is not eligible for reviewed closure until the aggregate failure receives a new bounded recovery decision.
- Final local hygiene readback: `git diff --check=0`, `git diff --cached --check=0`, staging empty, remote-tracking comparison still ahead/behind `4/0`. Scope consists of the two modified root-tooling tests plus the new v2 test config and this taskbook; protected and unrelated untracked paths remain untouched.

```text
CI_PORTABILITY_TARGET_FOCUSED_GREEN
VERIFY_TOOLS_PASS
VERIFY_ALL_FAILED
VERIFY_ALL_RERUN_NOT_PERFORMED
CODE_EVIDENCE_COMMIT_NOT_CREATED
REMOTE_UBUNTU_CI_NOT_REVERIFIED
TIMELINE_AUTOSAVE_IDENTITY_FAIL_CLOSED_NOT_STARTED
REVIEW_TERMINAL_ATOMICITY_NOT_STARTED
ASSET_CENTER_NOT_STARTED
PUSH_NOT_PERFORMED
WAITING_FOR_MANAGER_RECOVERY_DECISION
```

## Manager Recovery Authorization: CI_PORTABILITY_RESTORE_GATE_RECOVERY_1

**Decision:** Authorized by the independent manager after the first aggregate failure. This recovery separates a stale static test projection from default-parallel timeout pressure; it does not reinterpret the failed `verify:all` as green.

**Allowed files:**

- `packages/cli/test/human-agent-review-wave-6-runner.test.mjs` for one test-only anchor correction.
- The four existing portability-gate files already listed in this plan.
- This taskbook for append-only evidence.

**Hard constraints:**

- No production source changes, timeout increases, skipped tests, retries inside a test, ignored errors, or altered Vitest defaults.
- Do not change the review-open ordering contract: `await openReviewPanelWorkspace()` must precede `renderAll()`, and the success status must follow the rebuilt DOM.
- Direct Node diagnostic `1/1`, direct Node replacement `1/1`, four-file serial discrimination `1/1`, serial CLI full gate `1/1`, replacement `verify:all` `1/1`.
- Any unexpected assertion, functional error, process crash, lock failure, or exhausted timeout stops the recovery at that node.
- No push and no work on the second repair gate, third repair gate, Asset Center, Frontend Pass 5, or Wave 7.

### Recovery Task 1: Align the review-open static contract with the current shell boundary

- [x] **Step 1: Run the direct Node contract once**

```powershell
node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs
```

Expected: the stale `const reviewBtn` anchor fails while the source still visibly contains the required ordering inside the `onOpenReview` callback.

- [x] **Step 2: Replace only the obsolete source anchor**

Replace the old button-construction slice with the callback boundary now owned by `renderProjectBar`:

```js
const handlerStart = mainSource.indexOf('onOpenReview: () => {');
const handlerEnd = mainSource.indexOf('onUndo: doUndo', handlerStart);
assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'review-open callback source was not found');
const handler = mainSource.slice(handlerStart, handlerEnd);
```

Keep the three ordering assertions and the `openReviewPanelWorkspace()` no-status assertion unchanged.

- [x] **Step 3: Run the direct Node replacement once**

```powershell
node --test packages/cli/test/human-agent-review-wave-6-runner.test.mjs
```

Expected: all Node subtests pass.

### Recovery Task 2: Discriminate timeout pressure without changing budgets

- [x] **Step 1: Run the four previously timed-out files serially once**

From `packages/cli`:

```powershell
npx vitest run test/authoring-vertical-slice.test.ts test/authoring-project-config-wave3.test.ts test/agent-port-composition.test.ts test/composition-service.test.ts --no-file-parallelism --maxWorkers=1 --minWorkers=1
```

Expected: the existing per-test timeouts remain unchanged and all assertions pass. A timeout here is a real recovery failure, not permission to raise the limit.

- [x] **Step 2: Run the complete CLI suite serially once**

From `packages/cli`:

```powershell
npx vitest run --passWithNoTests --exclude "e2e/artifacts/**" --no-file-parallelism --maxWorkers=1 --minWorkers=1
```

Expected: the complete CLI suite passes, including the corrected Node contract.

### Recovery Task 3: Re-establish the unchanged aggregate gate

- [x] **Step 1: Run one replacement aggregate verification**

```powershell
npm run verify:all
```

Expected: exit zero under the repository's unchanged default commands. If it fails, append the first failure and stop without a second replacement.

- [x] **Step 2: Freeze exact scope only after all recovery gates pass**

Run both diff checks, stage only the five implementation/test/config/taskbook paths, verify the exact staged set, and create one commit:

```powershell
git add -- packages/cli/test/human-agent-review-wave-6-runner.test.mjs scripts/test/renderer-v2-docs.test.mjs scripts/test/renderer-v4-qualification.test.mjs scripts/test/fixtures/renderer-v2-docs.tsconfig.json docs/superpowers/plans/2026-08-31-ci-portability-restore-gate.md
git diff --cached --name-only
git diff --cached --check
git commit -m "fix(ci): restore cross-platform verification"
```

Expected staged set: exactly five paths. If the taskbook receives a post-commit evidence append, leave that docs-only delta uncommitted for reviewed closure.

- 2026-08-31 manager pre-recovery audit: current Editor source no longer constructs a local `reviewBtn`; `renderProjectBar` owns that button and invokes `onOpenReview`. The current callback still contains the required order at `packages/editor/src/main.ts`: await workspace open, rebuild DOM, then publish the success status. Therefore the extra Node failure is a stale static anchor, not evidence that the runtime ordering was reversed. This conclusion remains subject to the authorized direct Node RED and replacement GREEN.
- Recovery Task 1 execution: delegated to one bounded `luna_worker` with ownership of only `packages/cli/test/human-agent-review-wave-6-runner.test.mjs`; staging and commits were prohibited. The direct Node RED exited `1` with `20/21` passed and the only failure at `Editor writes the open success status only after the rebuilt DOM exists`. After the exact anchor correction, the one direct replacement exited `0` with `21/21` passed. The manager independently inspected the resulting `3` insertions / `2` deletions, confirmed the three ordering assertions and panel-side negative assertion remain intact, and confirmed no other worker-owned path changed. The later serial full CLI gate, not an extra direct rerun, will provide the manager-owned integrated recheck.
- Recovery Task 2 focused serial discrimination: the one authorized four-file run exited `0` with `4/4` files and `20/20` tests passed under unchanged per-test timeouts. The formerly timed-out cases completed in approximately `4.8s`, `5.6s`, `1.6s`, and `1.0s` respectively; there were no functional assertions, lease errors, process crashes, or timeouts. This supports default-parallel capacity contention but does not yet replace the failed aggregate run.
- Recovery Task 2 serial full gate: the one authorized complete CLI run exited `0` with `36/36` files and `274/274` Vitest tests passed under `--no-file-parallelism --maxWorkers=1 --minWorkers=1`, without changing repository configuration or per-test timeouts. Its embedded Node contract output also passed all `21/21` Wave 6 runner subtests, including the corrected review-open ordering contract. The serial evidence isolates the first aggregate failure from product assertions; the unchanged replacement aggregate remains required.
- Recovery Task 3 replacement aggregate: the sole authorized replacement `npm run verify:all` exited `0` under the unchanged repository commands. It passed tools `12/12`, Renderer boundaries `3/3`, Renderer legacy `4/4`, docs, tracked hygiene, every workspace typecheck, CLI default-parallel `36/36` files and `274/274` tests, Core `329/329`, Editor `378/378`, Host `87/87`, Renderer `413/413`, Shell `195/195`, Starter `7/7`, Zero After Midnight `29/29`, Starter lint/simulation, formal game lint/simulation/assets, Editor/Starter/formal builds, and final diff-check. Existing content and chunk-size warnings remained warnings; runtime errors were `0`. The original failed aggregate remains recorded above and was not overwritten.
- Evidence boundary: the recovery establishes a fresh Windows local aggregate green and confirms the two CI portability targets inside the root tool gate. It does not prove the remote Ubuntu checkout until a later authorized push and real CI run.
- Evidence freeze: exact staging contained `5` paths with `missing=0` and `extra=0`; `git diff --cached --check=0`. Commit `d32c9cf939b17b874ff9c934d3c5cf82e7aaeb7a` (`fix(ci): restore cross-platform verification`) has parent `e238b23a782cad7e8b342879ae60f34a2c2968d4` and contains only this taskbook, the review-open test projection correction, the v2 test project, and the two root-tooling tests. No production source, timeout, package manifest, lockfile, protected file, or historical artifact entered the commit.
- Post-commit state: staging is empty. This final identity append is the only tracked post-commit modification; the long-term roadmap ledger and all pre-existing untracked/protected paths remain unstaged. Push remains unauthorized.

```text
CI_PORTABILITY_RESTORE_CODE_EVIDENCE_HEAD = d32c9cf939b17b874ff9c934d3c5cf82e7aaeb7a
CI_PORTABILITY_RESTORE_LOCAL_VERIFIED = YES
ORIGINAL_VERIFY_ALL_FAILURE_PRESERVED = YES
RECOVERY_VERIFY_ALL = PASS
REMOTE_UBUNTU_CI_NOT_REVERIFIED = TRUE
READY_FOR_MANAGER_REVIEW = YES
TIMELINE_AUTOSAVE_IDENTITY_FAIL_CLOSED_NOT_STARTED = TRUE
REVIEW_TERMINAL_ATOMICITY_NOT_STARTED = TRUE
ASSET_CENTER_NOT_STARTED = TRUE
PUSH_NOT_PERFORMED = TRUE
```

- Secondary read-only review: a different bounded `luna_worker` inspected commit `d32c9cf939b17b874ff9c934d3c5cf82e7aaeb7a` against its parent and the post-commit taskbook append without modifying files or rerunning tests. It reported no BLOCKER/HIGH/MEDIUM/LOW: exact five-file scope, correct module-relative v4 root, correct source-mapped strict/no-emit v2 project, preserved review-open ordering/negative assertions, truthful first-failure and recovery history, and explicit Ubuntu boundary.
- Manager final review: PASS. The manager independently reviewed the staged and committed code, the worker-owned `3` insertion / `2` deletion test delta, the exact scope comparison, fresh serial and aggregate outputs, and the post-commit status. The secondary worker is treated as a second set of eyes, not as external independence. Gate 1 is eligible for docs-only reviewed closure; Gate 2 has not started at this point.

```text
CI_PORTABILITY_RESTORE_INDEPENDENT_MANAGER_REVIEW = PASS
BLOCKER = NONE
HIGH = NONE
MEDIUM = NONE
LOW = NONE
READY_FOR_DOCS_ONLY_CLOSEOUT = YES
REMOTE_UBUNTU_CI_NOT_REVERIFIED = TRUE
PUSH_NOT_PERFORMED = TRUE
```
