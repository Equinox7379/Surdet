# Pre-Wave 4 Reliability R4–R6 Closure Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans if available. Execute this taskbook strictly in Task 0 → Task 6 order. This is one authorized batch: after an ordinary lane passes its own gates, continue directly to the next lane without waiting for manager review. Do not parallelize production edits and do not enter Wave 4.

**Goal:** In one bounded execution batch, close the three remaining confirmed Pre-Wave 4 reliability findings: reject non-object `game.config.json` consistently across shared Authoring and Editor save logic, preserve target instruction zero when `start()` is called from any generic instruction callback, and lint `events.json scheduled[].when` with the same expression semantics as `events[].when`.

**Architecture:** The batch contains three independent, sequential lanes with separate invariants, permanent RED/GREEN evidence, and separate code commits. R4 establishes one small shared config-document parser in `@surdet/authoring` and reuses it from snapshot/config operations/Editor; R5 fixes the generic interpreter dispatch branch in Core without special-casing `@clear`; R6 extends the existing CLI declarative expression scan so `events[]` and `scheduled[]` share one extractor. The lanes do not share production files. Only after all three lanes are green may the executor run the single aggregate `verify:all`, create one combined delivery report, and create one docs-only closure commit.

**Tech Stack:** TypeScript 5.7, Node.js >=20, Vitest 3, npm workspaces, PowerShell, Git.

---

## 0. Authorization, ownership, and batch decision

### 0.1 Authorization

The project owner authorizes R4, R5, and R6 to be implemented as one reliability closure batch.

This authorization means:

- R4 → R5 → R6 may proceed continuously after each lane passes its own focused gates;
- there is no ordinary manager stop between lanes;
- each lane still has an independent permanent regression test and code commit;
- one combined final report and one final independent review are sufficient;
- no push is authorized;
- Wave 4 remains paused until this batch is independently approved and the owner makes a separate push/next-stage decision.

### 0.2 Why batching is safe

The Fresh Gate confirmed three defects in disjoint production boundaries:

| Lane | Finding | Production boundary | Primary failure |
|---|---|---|---|
| R4 | `A7-INVALID-CONFIG` | Authoring + Editor | syntactically valid non-object config is silently normalized or falsely saved |
| R5 | `M1-GENERIC-START-REENTRANCY` | Core Interpreter | generic event callback `start()` skips target instruction zero |
| R6 | `N4-SCHEDULED-WHEN-LINT` | CLI lint | Runtime is strict but CLI ignores `scheduled[].when` |

They do not require a common production refactor, schema migration, Electron path, asset change, or save-format change. Therefore batching reduces review/document overhead without weakening code isolation.

### 0.3 Authority boundary

The execution AI owns:

- implementation and permanent tests within the exact whitelist;
- focused/full workspace verification defined below;
- one aggregate `verify:all` after all three lanes are green;
- the Execution Ledger in this taskbook;
- the combined delivery report;
- exact local commits.

The execution AI does **not** own:

- the long-term roadmap/decision ledger;
- project-owner acceptance statements;
- push, deployment, packaging, release, or Wave 4 authorization;
- unrelated cleanup or refactors;
- an Architect PASS that was not actually supplied.

The long-term ledger remains manager-owned. The execution AI may place a final section named `建议由总经理登记的事实` in the delivery report, but must not edit:

`docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`

---

## 1. Global constraints

### 1.1 Allowed files

R4 whitelist:

- Create: `packages/authoring/src/config-document.ts`
- Modify: `packages/authoring/src/index.ts`
- Modify: `packages/authoring/src/project-snapshot.ts`
- Modify: `packages/authoring/src/config-operations.ts`
- Modify: `packages/authoring/test/project-snapshot.test.ts`
- Modify: `packages/editor/src/config-edit.ts`
- Modify: `packages/editor/test/config-edit.test.ts`

R5 whitelist:

- Modify: `packages/core/src/runtime/interpreter.ts`
- Modify: `packages/core/test/interpreter.test.ts`

R6 whitelist:

- Modify: `packages/cli/src/lint.ts`
- Modify: `packages/cli/test/lint.test.ts`

Batch documentation whitelist:

- This taskbook: `docs/superpowers/plans/2026-08-21-pre-wave-4-reliability-r4-r6-closure-batch.md`
- Create only after all final gates pass: `docs/PRE-WAVE-4-RELIABILITY-R4-R6-CLOSURE-BATCH-DELIVERY-REPORT-2026-08-21.md`

### 1.2 Forbidden scope

Do not modify:

- Renderer, Host, Shell, Starter, Zero, game content, assets, audio, save schema, or Electron harnesses;
- `packages/core/src/systems/event-scheduler.ts` or its existing runtime semantics;
- package manifests, lockfiles, dependencies, build configuration, or public release metadata;
- R1/R2/R3 taskbooks or delivery reports;
- Fresh Gate evidence or temporary artifacts;
- long-term roadmap/decision ledger;
- `AGENTS.md`, protected files, handoff files, `.learnings`, or `.dsh` content.

Do not:

- add compatibility fallbacks for hypothetical old internal data;
- special-case only `@clear` in R5;
- create a second config parser in Editor;
- create a third expression scanner for scheduled events;
- weaken assertions, rewrite fixture inputs to avoid the defect, or replace visible failures with internal-state-only checks;
- run Electron, FORMAL/DIAGNOSTIC presentation harnesses, performance matrices, pack, deploy, or release;
- amend, squash, rebase, reset, clean, force push, or push;
- stage with `git add -A` or `git add .`.

### 1.3 Protected existing worktree state

At taskbook creation, the verified baseline was:

```text
branch = main
HEAD = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
surdet/main = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
ahead/behind = 0/0
tracked worktree = clean
staging area = empty
```

Known untracked governance/protected paths already existed. Their presence is not a defect and they must remain untouched. The executor must re-read the live state; the values above are historical creation-time facts, not substitutes for Task 0 evidence.

### 1.4 Cost and quality discipline

Quality is the first priority. When quality is unchanged, minimize token and runtime cost.

Per lane:

- one permanent focused RED run per distinct confirmed symptom;
- one corresponding focused GREEN run;
- one affected-workspace full test run;
- one affected-workspace typecheck and build;
- one exact code commit.

For the whole batch:

- only one `verify:all`, after all lane gates pass;
- no mid-lane manager review for ordinary successful work;
- no repeated “FORMAL-like” aggregate loop;
- no rerun solely to produce prettier output;
- no re-running prior successful lane suites after a later lane, except through the single final `verify:all`.

If a focused command fails because of a test syntax/path/reporter mistake rather than the intended business assertion, the executor may correct the harness once and record `HARNESS_CORRECTION`. Such a failure is not a valid RED or production finding.

### 1.5 Conditions that stop the batch early

Stop and report without entering the next lane only when one of these occurs:

1. the required fix leaves the file whitelist or changes a public/schema contract not authorized here;
2. a new production defect is discovered that is not a direct consequence of the current lane;
3. a test implies risk to real project/user data;
4. Git metadata cannot be written after one environment-level retry;
5. the source contradicts a core architectural assumption in this taskbook;
6. the third bounded focused GREEN attempt for one lane still fails;
7. the single aggregate `verify:all` fails.

When stopping, preserve all artifacts and completed local commits. Do not erase completed lane history and do not begin an unrelated repair.

---

## 2. Confirmed Fresh Gate evidence

The following artifacts are historical, read-only RED evidence. Do not rerun or overwrite them:

| Finding | Artifact | bytes | SHA-256 | Confirmed result |
|---|---|---:|---|---|
| R4 Authoring | `C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\a7-authoring-vitest.json` | 1811 | `6C7ACA4D7FD3ADCBA96B3F71C6D56002219A96F44939B960E3CA0748A2DE5974` | `loadProjectSnapshot()` resolves for top-level `[]` |
| R4 Editor | `C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\a7-editor-vitest.json` | 1848 | `40A661374E12B59D660E99700E5A91DD958E829BBED7785EE3D1136CB98BFDB8` | `applyVariablesToConfig('[]', ...)` does not throw |
| R5 Core | `C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\m1-generic-start-vitest.json` | 1900 | `B8CAEE1652AEC096969B7FCB24BF1B9A9CFB22E3E175C4AA7353C03E94B9BDF0` | actual text is `['第二条']`, not `['第一条']` |
| R6 Runtime oracle | `C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\n4-runtime-oracle.json` | 2806 | `D117922A0625586DC51AB10F64A0B32CE886BD920D1CA3AC52A6A2D4CCD51B72` | undefined scheduled variable throws at Runtime |
| R6 CLI | `C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\n4-cli-lint.json` | 1865 | `39BACDA17AFF30CEAB1E5710D6CA4AD3AFC24FA2BD112B6A04AD56F314600793` | CLI emits no `V002` for `scheduled[].when` |

Fresh Gate authority:

- `docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md`
- `docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md`

The historical artifacts prove that the findings existed. This batch must still add permanent regression tests and capture fresh RED/GREEN artifacts against the current parent HEAD.

---

## 3. Long-term invariants

### R4 invariants

```text
R4-I1  A present, non-empty game.config.json must parse as a JSON object; array, null, string, number, or boolean is invalid.
R4-I2  Invalid JSON and valid non-object JSON fail loudly with AuthoringOperationError code PROJECT_INVALID in shared Authoring paths.
R4-I3  Snapshot loading, authoring config operations, and Editor variables save reuse one shared config-document parser.
R4-I4  A missing or whitespace-only config retains the existing caller-specific empty-object behavior where already supported.
R4-I5  A valid object preserves unrelated top-level keys, stable key order, and Editor two-space JSON formatting.
R4-I6  R4 does not broaden validation of nested variables/characters fields beyond existing contracts.
```

### R5 invariants

```text
R5-I1  Any synchronous generic instruction event callback may call Interpreter.start() without recursive stepping.
R5-I2  The target scene begins at the exact resolved pc; target instruction zero is not incremented by the source generic branch.
R5-I3  The fix is generic-branch reentrancy handling, not a clear-event special case.
R5-I4  Existing hostJump/jumpOverride behavior remains correct and takes precedence when set.
R5-I5  Ordinary generic state instructions still increment pc exactly once.
R5-I6  New scene status, pending choice cleanup, host pause reset, and call stack reset retain existing start() semantics.
```

### R6 invariants

```text
R6-I1  CLI scans both events.json events[].when and scheduled[].when.
R6-I2  Both arrays use one local expression extraction truth and the existing parse/type/reference checker.
R6-I3  An undeclared variable in either array emits V002.
R6-I4  A malformed expression in either array emits CONFIG_EXPR.
R6-I5  Existing declared variables remain clean; no duplicate issue is emitted for one expression.
R6-I6  Runtime EventScheduler strict evaluation is unchanged and remains the semantic oracle.
```

---

## 4. File responsibilities and design

### 4.1 R4 shared config document

Create `packages/authoring/src/config-document.ts` with one narrow responsibility: parse a non-empty `game.config.json` document into `Record<string, unknown>` or throw a structured `PROJECT_INVALID` error.

Required shape:

```ts
import { AuthoringOperationError } from './change-session.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseProjectConfigDocument(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new AuthoringOperationError(
      'PROJECT_INVALID',
      `game.config.json 解析失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new AuthoringOperationError('PROJECT_INVALID', 'game.config.json 必须是 JSON 对象');
  }
  return parsed;
}
```

The final implementation may adjust local naming/formatting, but must retain:

- BOM stripping;
- structured `PROJECT_INVALID` errors;
- exact rejection of all non-object top-level values;
- no mutation and no serialization responsibility.

Export it from `packages/authoring/src/index.ts`.

Reuse it as follows:

- `project-snapshot.ts`: present and nonblank config → shared parser; missing/blank → existing `{}` behavior;
- `config-operations.ts`: remove its private duplicate `parseConfig` and call the shared parser;
- `config-edit.ts`: import from `@surdet/authoring`; blank text → `{}` as before, otherwise shared parser before writing `variables`.

Do not move general operation logic into the parser. Do not store prompts, recovery advice, migrations, or examples in this module.

### 4.2 R5 generic branch reentrancy

The confirmed defect is in the `case 'instr'` branch after `#execGeneric(instr)`. `start()` called by a synchronous generic event callback sets the target scene/pc and `#resumeRequested=true`; the old branch then increments the new pc and skips target instruction zero.

Required control-flow shape:

```ts
case 'instr': {
  this.#resumeRequested = false;
  this.#execGeneric(instr);
  this.#emitStateTrace(instr, variablesBefore);
  if (this.#jumpOverride) {
    this.#jumpOverride = false;
    this.#status = 'running';
    continue;
  }
  if (this.#resumeRequested) {
    this.#resumeRequested = false;
    this.#status = 'running';
    continue;
  }
  this.#pc++;
  break;
}
```

The final code may factor a small existing-style helper if that is genuinely simpler, but must not:

- add `if (instr.name === 'clear')`;
- recursively call `#step()`;
- increment source or target pc after a callback-requested start;
- alter `start()`, `hostJump()`, event payloads, or save schema without a new manager decision.

### 4.3 R6 shared events expression extraction

Keep `CONFIG_EXPR_SCANS` as the single declarative registry. Within the existing `events.json` entry, use one helper to extract `when` strings from both arrays.

Recommended local shape:

```ts
function extractWhenExpressions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    .map((entry) => entry['when'])
    .filter((when): when is string => typeof when === 'string');
}

// CONFIG_EXPR_SCANS events.json entry
extract: (cfg) => [
  ...extractWhenExpressions(cfg['events']),
  ...extractWhenExpressions(cfg['scheduled']),
],
```

Do not add a second lint pass or call Runtime during lint. Reuse the current `lintConfigExpressions()` pipeline so syntax parsing, `V002`, `T003`, allowed variables, severity, and issue formatting remain one truth.

---

## 5. Artifact and evidence protocol

### 5.1 Create one batch root

Task 0 creates one system-temp directory and reuses it:

```powershell
$r46Root = Join-Path ([System.IO.Path]::GetTempPath()) ("surdet-reliability-r4-r6-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $r46Root | Out-Null
$r46Root
```

Do not place logs, screenshots, JSON reporters, fixtures, or generated artifacts in the repository.

### 5.2 Expected batch artifacts

```text
r4-authoring-red.json
r4-editor-red.json
r4-authoring-green.json
r4-editor-green.json
r4-authoring-full.txt
r4-editor-full.txt
r4-authoring-typecheck.txt
r4-authoring-build.txt
r4-editor-typecheck.txt
r4-editor-build.txt

r5-core-red.json
r5-core-green.json
r5-core-full.txt
r5-core-typecheck.txt
r5-core-build.txt

r6-runtime-oracle.json
r6-cli-red.json
r6-cli-green.json
r6-cli-full.txt
r6-cli-typecheck.txt
r6-cli-build.txt

r46-verify-all.txt
r46-artifact-manifest.txt
```

Every artifact referenced in the report must be re-read from disk for absolute path, bytes, and SHA-256. A missing artifact is evidence loss and must not be represented as passed.

### 5.3 Reporter rules

- JSON reporter artifacts are immutable after the run.
- Text logs must contain the command's actual output and exit result.
- Do not replace a failed artifact with a later successful file of the same name.
- If a rerun is permitted after a harness correction, use a new filename with `-harness-correction-1`.
- If a bounded implementation correction requires another focused GREEN attempt, use `-green-2` or `-green-3`; retain all prior attempts.

---

## Task 0 — Read authority, capture live baseline, and prepare evidence root

**Read completely, in order:**

1. `AGENTS.md`
2. `docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md`
3. `docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md`
4. this taskbook
5. R1, R2, and R3 final taskbooks/reports only as historical closure boundaries; do not reopen their work.

- [ ] **Step 0.1: Capture the live Git baseline**

```powershell
git branch --show-current
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'
git log --oneline -8
```

Expected starting relationship after the owner-approved R3 push is `0/0`, but use live output as authority. If the tracked worktree or staging area contains unexpected edits, stop before changing files.

- [ ] **Step 0.2: Verify scope anchors**

```powershell
rg -n "asRecord|JSON.parse|variables" packages/authoring/src/project-snapshot.ts packages/authoring/src/config-operations.ts packages/editor/src/config-edit.ts
rg -n "resumeRequested|jumpOverride|case 'instr'|case 'clear'" packages/core/src/runtime/interpreter.ts
rg -n "CONFIG_EXPR_SCANS|events.json|scheduled|extract" packages/cli/src/lint.ts packages/cli/test/lint.test.ts
```

- [ ] **Step 0.3: Create `$r46Root` and record it in the Execution Ledger**

- [ ] **Step 0.4: Read-only verify historical Fresh Gate artifacts**

Re-read bytes/SHA-256 for the five paths in section 2. If a historical artifact has disappeared, record that honestly; do not recreate it. The permanent tests in this batch remain mandatory either way.

- [ ] **Step 0.5: Record Task 0 facts in the Execution Ledger**

Record time, live HEAD, remote relationship, worktree, exact untracked paths, artifact root, and files planned for modification. Do not edit the long-term ledger.

---

## Task 1 — R4 permanent RED: non-object project config must fail loudly

### Files

- Modify: `packages/authoring/test/project-snapshot.test.ts`
- Modify: `packages/editor/test/config-edit.test.ts`

- [ ] **Step 1.1: Extend the Authoring fixture without changing existing defaults**

Add an optional `configText` argument to `fixtureStorage()` after existing arguments:

```ts
function fixtureStorage(
  order: 'normal' | 'reverse' = 'normal',
  growthText = JSON.stringify({ curve: { base: 10 }, profiles: [] }),
  configText = '{"entryScene":"prologue","variables":{}}',
): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': configText,
    // existing fixture files unchanged
  };
  // existing implementation unchanged
}
```

- [ ] **Step 1.2: Add the permanent Authoring regression**

```ts
it('rejects a syntactically valid non-object game.config.json', async () => {
  await expect(loadProjectSnapshot(
    fixtureStorage('normal', JSON.stringify({ curve: { base: 10 }, profiles: [] }), '[]'),
    hasher,
  )).rejects.toMatchObject({
    code: 'PROJECT_INVALID',
    message: expect.stringMatching(/game\.config\.json.*JSON 对象/),
  });
});
```

The test must use valid JSON `[]`; a syntax-error-only test does not reproduce A7.

- [ ] **Step 1.3: Run exactly one Authoring RED**

```powershell
npm run test -w @surdet/authoring -- project-snapshot.test.ts -t "rejects a syntactically valid non-object game.config.json" --reporter=json --outputFile="$r46Root\r4-authoring-red.json"
$r4AuthoringRedExit = $LASTEXITCODE
if ($r4AuthoringRedExit -ne 1) { throw "R4 Authoring RED expected exit 1, got $r4AuthoringRedExit" }
```

Valid RED signature: the promise resolves instead of rejecting. Any compile/import/fixture failure is `HARNESS_INVALID`.

- [ ] **Step 1.4: Add the permanent Editor regression**

```ts
it('applyVariablesToConfig rejects a non-object top-level config', () => {
  expect(() => applyVariablesToConfig('[]', {
    route: { type: 'string', initial: '' },
  })).toThrow(/game\.config\.json.*JSON 对象/);
});
```

- [ ] **Step 1.5: Run exactly one Editor RED**

```powershell
npm run test -w surdet-editor -- config-edit.test.ts -t "applyVariablesToConfig rejects a non-object top-level config" --reporter=json --outputFile="$r46Root\r4-editor-red.json"
$r4EditorRedExit = $LASTEXITCODE
if ($r4EditorRedExit -ne 1) { throw "R4 Editor RED expected exit 1, got $r4EditorRedExit" }
```

Valid RED signature: no exception is thrown for `[]`. Do not accept a missing Authoring dist/import failure as the RED.

- [ ] **Step 1.6: Read back both RED artifacts**

Record absolute path, bytes, SHA-256, failed test name, expected value, and actual behavior.

---

## Task 2 — R4 shared fix, GREEN gates, and code commit

### Files

- Create: `packages/authoring/src/config-document.ts`
- Modify: `packages/authoring/src/index.ts`
- Modify: `packages/authoring/src/project-snapshot.ts`
- Modify: `packages/authoring/src/config-operations.ts`
- Modify: `packages/authoring/test/project-snapshot.test.ts`
- Modify: `packages/editor/src/config-edit.ts`
- Modify: `packages/editor/test/config-edit.test.ts`
- Include this taskbook in the R4 code commit so the authorized batch contract enters Git history.

- [ ] **Step 2.1: Implement the shared parser**

Follow section 4.1. Do not add options, schema validation, repair behavior, migrations, or serialization.

- [ ] **Step 2.2: Replace the private parser in config operations**

Import `parseProjectConfigDocument` and replace calls to the old private `parseConfig`. Keep the local `isRecord` helper if it is still used for nested `characters`/fingerprint checks.

- [ ] **Step 2.3: Make snapshot loading fail loudly**

Replace only the top-level parse path:

```ts
const config = configFile === null || configFile.text.trim().length === 0
  ? {}
  : parseProjectConfigDocument(configFile.text);
```

Do not change growth parsing or nested `variables` fallback in this lane.

- [ ] **Step 2.4: Reuse the shared parser in Editor save logic**

```ts
import { parseProjectConfigDocument } from '@surdet/authoring';

export function applyVariablesToConfig(
  originalText: string,
  variables: Record<string, unknown>,
): string {
  const obj = originalText.trim().length === 0
    ? {}
    : parseProjectConfigDocument(originalText);
  obj['variables'] = variables;
  return JSON.stringify(obj, null, 2);
}
```

Preserve valid-object output behavior and unrelated top-level keys.

- [ ] **Step 2.5: Build Authoring before the Editor GREEN**

The Editor consumes `@surdet/authoring` through its built package entry. Refresh Authoring dist before testing the cross-workspace import:

```powershell
npm run build -w @surdet/authoring 2>&1 | Tee-Object -FilePath "$r46Root\r4-authoring-build.txt"
if ($LASTEXITCODE -ne 0) { throw 'R4 Authoring build failed' }
```

- [ ] **Step 2.6: Run the two corresponding GREENs once**

```powershell
npm run test -w @surdet/authoring -- project-snapshot.test.ts -t "rejects a syntactically valid non-object game.config.json" --reporter=json --outputFile="$r46Root\r4-authoring-green.json"
if ($LASTEXITCODE -ne 0) { throw 'R4 Authoring GREEN failed' }

npm run test -w surdet-editor -- config-edit.test.ts -t "applyVariablesToConfig rejects a non-object top-level config" --reporter=json --outputFile="$r46Root\r4-editor-green.json"
if ($LASTEXITCODE -ne 0) { throw 'R4 Editor GREEN failed' }
```

- [ ] **Step 2.7: Run R4 adjacent gates**

```powershell
npm run test -w @surdet/authoring 2>&1 | Tee-Object -FilePath "$r46Root\r4-authoring-full.txt"
if ($LASTEXITCODE -ne 0) { throw 'R4 Authoring full test failed' }

npm run typecheck -w @surdet/authoring 2>&1 | Tee-Object -FilePath "$r46Root\r4-authoring-typecheck.txt"
if ($LASTEXITCODE -ne 0) { throw 'R4 Authoring typecheck failed' }

npm run test -w surdet-editor 2>&1 | Tee-Object -FilePath "$r46Root\r4-editor-full.txt"
if ($LASTEXITCODE -ne 0) { throw 'R4 Editor full test failed' }

npm run typecheck -w surdet-editor 2>&1 | Tee-Object -FilePath "$r46Root\r4-editor-typecheck.txt"
if ($LASTEXITCODE -ne 0) { throw 'R4 Editor typecheck failed' }

npm run build -w surdet-editor 2>&1 | Tee-Object -FilePath "$r46Root\r4-editor-build.txt"
if ($LASTEXITCODE -ne 0) { throw 'R4 Editor build failed' }
```

Do not run `verify:all` here.

- [ ] **Step 2.8: Inspect and commit exact R4 scope**

```powershell
git diff --check
git status --short
git diff -- packages/authoring/src/config-document.ts packages/authoring/src/index.ts packages/authoring/src/project-snapshot.ts packages/authoring/src/config-operations.ts packages/authoring/test/project-snapshot.test.ts packages/editor/src/config-edit.ts packages/editor/test/config-edit.test.ts docs/superpowers/plans/2026-08-21-pre-wave-4-reliability-r4-r6-closure-batch.md

git add -- packages/authoring/src/config-document.ts packages/authoring/src/index.ts packages/authoring/src/project-snapshot.ts packages/authoring/src/config-operations.ts packages/authoring/test/project-snapshot.test.ts packages/editor/src/config-edit.ts packages/editor/test/config-edit.test.ts docs/superpowers/plans/2026-08-21-pre-wave-4-reliability-r4-r6-closure-batch.md
git diff --cached --check
git diff --cached --name-status
git commit -m "fix(authoring): reject non-object project config"
```

Immediately read back:

```powershell
git rev-parse HEAD
git show --name-status --format=fuller HEAD
git status --short
```

Expected code commit scope is exactly the R4 whitelist plus this taskbook. Record `R4_CODE_EVIDENCE_HEAD`; then continue directly to R5.

---

## Task 3 — R5 permanent RED, generic fix, GREEN gates, and code commit

### Files

- Modify: `packages/core/test/interpreter.test.ts`
- Modify: `packages/core/src/runtime/interpreter.ts`

- [ ] **Step 3.1: Add the permanent generic callback regression**

Place it near the existing `sceneEnd` callback `start()` test:

```ts
it('generic instruction callback start() preserves target instruction zero', () => {
  const store = new VariableStore([]);
  const bus = new EventBus<CoreEventMap>();
  const registry = new SceneRegistry();
  const interp = new Interpreter(store, bus, registry);
  registry.register(compileScene('@clear old_end\n@end', 'source.gal', 'source'));
  registry.register(compileScene('第一条\n第二条\n@end', 'title.gal', 'title'));
  const texts: string[] = [];
  bus.on('text', (payload) => texts.push(payload.value));
  bus.on('clear', () => interp.start('title'));

  interp.start('source');

  expect(texts).toEqual(['第一条']);
  expect(interp.position).toEqual({ sceneId: 'title', pc: 1 });
  expect(interp.status).toBe('awaiting-advance');
});
```

Use existing imports/helpers if already present; do not duplicate test infrastructure unnecessarily.

- [ ] **Step 3.2: Run exactly one R5 RED**

```powershell
npm run test -w @surdet/core -- interpreter.test.ts -t "generic instruction callback start\(\) preserves target instruction zero" --reporter=json --outputFile="$r46Root\r5-core-red.json"
$r5RedExit = $LASTEXITCODE
if ($r5RedExit -ne 1) { throw "R5 RED expected exit 1, got $r5RedExit" }
```

Valid RED signature:

```text
actual texts = ['第二条']
expected texts = ['第一条']
```

If the test fails because its name filter matches zero tests or imports are wrong, correct the harness once and use a new artifact filename.

- [ ] **Step 3.3: Implement generic resume consumption**

Follow section 4.2. The new branch must clear `#resumeRequested` before emitting a generic event, consume it after the callback, and avoid pc increment when it was set.

Do not modify the `clear` case itself.

- [ ] **Step 3.4: Run the R5 GREEN once**

```powershell
npm run test -w @surdet/core -- interpreter.test.ts -t "generic instruction callback start\(\) preserves target instruction zero" --reporter=json --outputFile="$r46Root\r5-core-green.json"
if ($LASTEXITCODE -ne 0) { throw 'R5 GREEN failed' }
```

- [ ] **Step 3.5: Run R5 adjacent gates**

```powershell
npm run test -w @surdet/core 2>&1 | Tee-Object -FilePath "$r46Root\r5-core-full.txt"
if ($LASTEXITCODE -ne 0) { throw 'R5 Core full test failed' }

npm run typecheck -w @surdet/core 2>&1 | Tee-Object -FilePath "$r46Root\r5-core-typecheck.txt"
if ($LASTEXITCODE -ne 0) { throw 'R5 Core typecheck failed' }

npm run build -w @surdet/core 2>&1 | Tee-Object -FilePath "$r46Root\r5-core-build.txt"
if ($LASTEXITCODE -ne 0) { throw 'R5 Core build failed' }
```

Do not rerun R4 suites and do not run `verify:all` here.

- [ ] **Step 3.6: Inspect and commit exact R5 scope**

```powershell
git diff --check
git diff -- packages/core/src/runtime/interpreter.ts packages/core/test/interpreter.test.ts
git add -- packages/core/src/runtime/interpreter.ts packages/core/test/interpreter.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "fix(core): preserve generic start reentrancy"
git rev-parse HEAD
git show --name-status --format=fuller HEAD
git status --short
```

Expected commit contains exactly two R5 files. Record `R5_CODE_EVIDENCE_HEAD`; then continue directly to R6.

---

## Task 4 — R6 paired oracle, permanent RED, shared lint fix, GREEN gates, and code commit

### Files

- Read only: `packages/core/src/systems/event-scheduler.ts`
- Read/run existing: `packages/core/test/event-scheduler.test.ts`
- Modify: `packages/cli/src/lint.ts`
- Modify: `packages/cli/test/lint.test.ts`

- [ ] **Step 4.1: Reconfirm the Runtime semantic oracle once**

```powershell
npm run test -w @surdet/core -- event-scheduler.test.ts -t "条件求值严格策略" --reporter=json --outputFile="$r46Root\r6-runtime-oracle.json"
if ($LASTEXITCODE -ne 0) { throw 'R6 Runtime oracle changed; stop before CLI work' }
```

This is not a Core repair. If undefined variables no longer throw, stop because R6's semantic premise changed.

- [ ] **Step 4.2: Add a permanent scheduled-expression lint test**

Add a separate test near the existing `content/config 内 DSL 表达式校验` test:

```ts
it('events.json scheduled[].when uses the same undeclared-variable lint as events[].when', () => {
  const dir = makeProject({
    'game.config.json': JSON.stringify({
      entryScene: 'prologue',
      variables: { turn: { type: 'number', initial: 1 } },
    }),
    'content/scenario/prologue.gal': '@scene prologue\n旁白：开始。\n@end\n',
    'content/scenario/turn_event.gal': '@scene turn_event\n旁白：事件。\n@end\n',
    'content/config/events.json': JSON.stringify({
      events: [
        { id: 'ok', characterId: 'system', when: 'turn > 0', scene: 'turn_event', once: false },
      ],
      scheduled: [
        { id: 'bad', characterId: 'system', when: 'ghost > 0', scene: 'turn_event', once: false },
      ],
    }),
  });

  const result = lintProject(dir);
  const ghostIssues = result.issues.filter(
    (issue) => issue.code === 'V002' && issue.text.includes('ghost'),
  );
  expect(ghostIssues).toHaveLength(1);
  expect(result.issues.some(
    (issue) => issue.code === 'V002' && issue.text.includes('turn'),
  )).toBe(false);
});
```

The declared `events[].when` entry is a paired clean control. The scheduled entry is the intended RED.

- [ ] **Step 4.3: Run exactly one R6 CLI RED**

```powershell
npm run test -w @surdet/cli -- lint.test.ts -t "events.json scheduled\[\]\.when uses the same undeclared-variable lint as events\[\]\.when" --reporter=json --outputFile="$r46Root\r6-cli-red.json"
$r6RedExit = $LASTEXITCODE
if ($r6RedExit -ne 1) { throw "R6 RED expected exit 1, got $r6RedExit" }
```

Valid RED signature: `ghostIssues` length is `0`, not `1`.

- [ ] **Step 4.4: Implement one shared extractor**

Follow section 4.3. Modify only the existing `events.json` declarative scan and one narrow local helper. Do not touch Runtime or duplicate downstream checking.

Update the nearby documentation comment so it truthfully says `events.json events[].when + scheduled[].when`.

- [ ] **Step 4.5: Run the R6 GREEN once**

```powershell
npm run test -w @surdet/cli -- lint.test.ts -t "events.json scheduled\[\]\.when uses the same undeclared-variable lint as events\[\]\.when" --reporter=json --outputFile="$r46Root\r6-cli-green.json"
if ($LASTEXITCODE -ne 0) { throw 'R6 GREEN failed' }
```

- [ ] **Step 4.6: Run R6 adjacent gates**

Because CLI imports built Authoring/Core packages, preserve the current built state from prior lanes and run:

```powershell
npm run test -w @surdet/cli 2>&1 | Tee-Object -FilePath "$r46Root\r6-cli-full.txt"
if ($LASTEXITCODE -ne 0) { throw 'R6 CLI full test failed' }

npm run typecheck -w @surdet/cli 2>&1 | Tee-Object -FilePath "$r46Root\r6-cli-typecheck.txt"
if ($LASTEXITCODE -ne 0) { throw 'R6 CLI typecheck failed' }

npm run build -w @surdet/cli 2>&1 | Tee-Object -FilePath "$r46Root\r6-cli-build.txt"
if ($LASTEXITCODE -ne 0) { throw 'R6 CLI build failed' }
```

- [ ] **Step 4.7: Inspect and commit exact R6 scope**

```powershell
git diff --check
git diff -- packages/cli/src/lint.ts packages/cli/test/lint.test.ts
git add -- packages/cli/src/lint.ts packages/cli/test/lint.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "fix(cli): lint scheduled event conditions"
git rev-parse HEAD
git show --name-status --format=fuller HEAD
git status --short
```

Expected commit contains exactly two R6 files. Record `R6_CODE_EVIDENCE_HEAD`.

---

## Task 5 — Aggregate verification, evidence readback, and combined delivery report

Task 5 begins only when R4, R5, and R6 each have:

- valid permanent RED evidence;
- corresponding GREEN evidence;
- affected workspace full tests, typecheck, and build passing;
- an exact local code commit.

- [ ] **Step 5.1: Verify the commit chain and forbidden scope before aggregate testing**

```powershell
git log --oneline -6
git show --name-status --format=fuller $env:R4_CODE_EVIDENCE_HEAD
git show --name-status --format=fuller $env:R5_CODE_EVIDENCE_HEAD
git show --name-status --format=fuller $env:R6_CODE_EVIDENCE_HEAD
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'
```

If environment variables were not used, substitute the actual recorded hashes. Do not use guessed hashes.

Confirm:

- R4 commit = R4 whitelist + taskbook only;
- R5 commit = two Core files only;
- R6 commit = two CLI files only;
- no forbidden production file changed across the batch parent → R6 HEAD;
- staged area is empty;
- only the expected taskbook ledger modification remains tracked.

- [ ] **Step 5.2: Run the single aggregate gate**

```powershell
npm run verify:all 2>&1 | Tee-Object -FilePath "$r46Root\r46-verify-all.txt"
$verifyAllExit = $LASTEXITCODE
if ($verifyAllExit -ne 0) { throw "R4-R6 aggregate verify:all failed: $verifyAllExit" }
```

This command may run workspace tests/builds internally. Do not run a second `verify:all` in this batch. If it fails, preserve the output, record the last passed node and first failed node, and stop for review. Do not fix an unrelated failure.

- [ ] **Step 5.3: Re-read all artifact identities**

```powershell
$manifest = Get-ChildItem -LiteralPath $r46Root -File | Sort-Object Name | ForEach-Object {
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
  "{0}`t{1}`t{2}" -f $_.FullName,$_.Length,$hash
}
$manifest | Set-Content -LiteralPath "$r46Root\r46-artifact-manifest.txt" -Encoding utf8
$manifest
Get-Item -LiteralPath "$r46Root\r46-artifact-manifest.txt" | Select-Object FullName,Length
Get-FileHash -Algorithm SHA256 -LiteralPath "$r46Root\r46-artifact-manifest.txt"
```

After writing the manifest, separately append the manifest's own path/bytes/SHA to the report; do not put the manifest's hash inside itself.

- [ ] **Step 5.4: Create the combined delivery report last**

Create:

`docs/PRE-WAVE-4-RELIABILITY-R4-R6-CLOSURE-BATCH-DELIVERY-REPORT-2026-08-21.md`

Required first line:

```text
PRE_WAVE_4_RELIABILITY_R4_R6_BATCH_VERIFIED — R4_CONFIG_FAIL_LOUD_PASSED; R5_GENERIC_START_REENTRANCY_PASSED; R6_SCHEDULED_WHEN_LINT_PASSED; VERIFY_ALL_PASSED; WAITING_FOR_INDEPENDENT_FINAL_REVIEW; NOT_PUSHED; WAVE_4_PAUSED
```

Required report sections:

1. authorized scope and explicit exclusions;
2. live initial Git baseline;
3. R4 RED → implementation → GREEN facts;
4. R5 RED → implementation → GREEN facts;
5. R6 paired Runtime oracle → CLI RED → implementation → GREEN facts;
6. all focused/full/typecheck/build results with actual counts and exits;
7. single `verify:all` result, including last/first node if failed;
8. exact code commit identities and file scopes;
9. artifact table with absolute path, bytes, SHA-256, status, and evidence class;
10. unchanged/forbidden-scope proof;
11. known boundaries and non-claims;
12. Git state, no push, Wave 4 paused;
13. `建议由总经理登记的事实`.

The report must distinguish:

```text
VERIFIED FACT
REASONABLE INFERENCE
NOT VERIFIED / OUT OF SCOPE
```

Do not claim:

- all invalid nested config shapes are now schema-validated;
- all possible interpreter callback reentrancy forms are proven beyond the generic/start contract tested here;
- CLI lint executes Runtime or guarantees all runtime conditions;
- release, Electron, performance, player experience, or Wave 4 acceptance;
- push.

- [ ] **Step 5.5: Self-review the report**

Search for placeholders and overclaims:

```powershell
rg -n "TODO|TBD|PENDING|PLACEHOLDER|NOT_CREATED_YET|假定|预计|应该通过|已 push|Wave 4 已开始" docs/PRE-WAVE-4-RELIABILITY-R4-R6-CLOSURE-BATCH-DELIVERY-REPORT-2026-08-21.md
```

Any `PENDING` retained as a historical fact must be explicitly labeled `HISTORICAL`. There must be no unqualified placeholder.

---

## Task 6 — Document identity protocol, docs-only closure commit, and stop

This task exists to prevent the repeated self-referential documentation corrections seen in earlier reliability lanes.

### 6.1 Identity rules

1. The delivery report must **not contain its own bytes or SHA-256**.
2. The taskbook may record the frozen delivery report bytes/SHA after the report is final.
3. After the taskbook records that identity, do not modify the report again.
4. Neither document may claim the final docs commit hash before that commit exists.
5. The final handoff message, not the committed document, records the actual docs closure HEAD and final ahead/behind.
6. Do not create a second docs-only correction merely to embed the commit's own hash.
7. Historical identities must be labeled `HISTORICAL`; never leave a bare `PENDING` as current truth.

- [ ] **Step 6.1: Freeze and read back the delivery report**

```powershell
$report = 'E:\surdet\docs\PRE-WAVE-4-RELIABILITY-R4-R6-CLOSURE-BATCH-DELIVERY-REPORT-2026-08-21.md'
$reportItem = Get-Item -LiteralPath $report
$reportHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $report).Hash
"REPORT_PATH=$($reportItem.FullName)"
"REPORT_BYTES=$($reportItem.Length)"
"REPORT_SHA256=$reportHash"
```

Append these three values to the Execution Ledger in this taskbook. Then re-read the report again and prove its identity did not change.

- [ ] **Step 6.2: Final taskbook/report consistency review**

Check that:

- all three code heads are actual commits;
- report artifact identities match disk;
- report path matches the actual file;
- report contains no self-hash claim;
- taskbook labels creation-time/fresh-gate identities correctly;
- no test is claimed unless it actually ran;
- `ARCHITECT_PASS` is not claimed unless a real report exists;
- `PUSH=NOT_PERFORMED` and `WAVE_4=PAUSED` are current;
- long-term ledger is not in the diff.

- [ ] **Step 6.3: Precisely stage only the two closure documents**

```powershell
git add -- docs/superpowers/plans/2026-08-21-pre-wave-4-reliability-r4-r6-closure-batch.md docs/PRE-WAVE-4-RELIABILITY-R4-R6-CLOSURE-BATCH-DELIVERY-REPORT-2026-08-21.md
git diff --cached --check
git diff --cached --name-status
```

Expected staged scope:

```text
M docs/superpowers/plans/2026-08-21-pre-wave-4-reliability-r4-r6-closure-batch.md
A docs/PRE-WAVE-4-RELIABILITY-R4-R6-CLOSURE-BATCH-DELIVERY-REPORT-2026-08-21.md
```

No code file may be staged here.

- [ ] **Step 6.4: Create the ordinary docs-only closure commit**

```powershell
git commit -m "docs(reliability): report R4-R6 closure batch"
```

- [ ] **Step 6.5: Read the true final state after commit**

```powershell
git rev-parse HEAD
git rev-parse HEAD^
git show --name-status --format=fuller HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git status --short
git diff --check
git diff --cached --check
git ls-files '*.log'
```

Do not edit either document after this readback. The final handoff must report:

```text
R4_CODE_EVIDENCE_HEAD = <actual>
R5_CODE_EVIDENCE_HEAD = <actual>
R6_CODE_EVIDENCE_HEAD = <actual>
DOCUMENT_CLOSURE_HEAD = <actual post-commit HEAD>
REMOTE_MAIN = <actual>
AHEAD_BEHIND = <actual>
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
PUSH = NOT_PERFORMED
WAVE_4 = PAUSED
NEXT_STOP = WAITING_FOR_INDEPENDENT_FINAL_REVIEW
```

If known untracked protected/governance files remain, list them as preserved, not as garbage.

---

## 7. Commit topology and review contract

Expected local commit topology:

```text
<remote/main parent>
  └─ R4 code evidence: fix(authoring): reject non-object project config
      └─ R5 code evidence: fix(core): preserve generic start reentrancy
          └─ R6 code evidence: fix(cli): lint scheduled event conditions
              └─ docs closure: docs(reliability): report R4-R6 closure batch
```

No manager review is required between these commits.

### Final independent review

小衡 performs one final read-only review containing the former Local Audit duties plus independent semantic review.

Required verdict fields:

```text
LOCAL_AUDIT_RESULT = PASS | NEEDS_FIX
R4_CONFIG_CONTRACT = PASS | NEEDS_FIX
R5_REENTRANCY_CONTRACT = PASS | NEEDS_FIX
R6_LINT_CONTRACT = PASS | NEEDS_FIX
REGRESSION_SUITE_SOUND = YES | NO
AGGREGATE_VERIFY_ALL = PASS | FAIL
INDEPENDENT_FINAL_REVIEW_RESULT = PASS | NEEDS_FIX
```

The reviewer must verify:

- actual HEAD/parent/remote/ahead-behind;
- all four commit scopes;
- permanent RED and GREEN artifacts from disk;
- R4 parser is shared and Editor has no duplicate JSON-object parser;
- R5 fix is generic and preserves instruction zero;
- R6 uses the existing declarative scan/checking pipeline;
- single `verify:all` evidence;
- report identity in taskbook matches the frozen report;
- tracked worktree/staging area are clean;
- protected/untracked files were not included;
- no push and no Wave 4 implementation.

This taskbook does not require a separate Architect review. If none is supplied, the handoff must say:

```text
ARCHITECT_REVIEW = NOT_SEPARATELY_PERFORMED
ARCHITECT_PASS = NOT_CLAIMED
```

Do not invent or infer an Architect PASS.

### Owner gate after PASS

Only the project owner may authorize:

1. push of the R4-R6 commit chain;
2. marking the Pre-Wave 4 reliability sweep closed;
3. resuming Wave 4 implementation.

---

## 8. Acceptance matrix

| ID | Required proof | Pass condition |
|---|---|---|
| R4-A | permanent Authoring RED | current parent resolves for top-level `[]` and test exits 1 |
| R4-B | permanent Editor RED | current parent does not throw for `[]` and test exits 1 |
| R4-C | shared implementation | one Authoring parser reused by snapshot, config operations, Editor |
| R4-D | focused GREEN | both permanent tests pass without weakened inputs/assertions |
| R4-E | adjacent gates | Authoring + Editor full tests/typecheck/build pass |
| R5-A | permanent RED | callback start produces `第二条` first on old code |
| R5-B | generic implementation | resume request consumed before any pc increment; no clear special case |
| R5-C | focused GREEN | target emits `第一条`, position is `title:1`, status awaits advance |
| R5-D | adjacent gates | Core full test/typecheck/build pass |
| R6-A | Runtime oracle | undefined scheduled variable still throws |
| R6-B | permanent CLI RED | `scheduled[].when` ghost produces no V002 on old code |
| R6-C | shared extraction | events + scheduled flow through one extractor/current checker |
| R6-D | focused GREEN | exactly one ghost V002; declared turn remains clean |
| R6-E | adjacent gates | CLI full test/typecheck/build pass |
| BATCH-A | scope | three exact code commits, no forbidden changes |
| BATCH-B | aggregate | single `verify:all` exits 0 |
| BATCH-C | evidence | every referenced artifact exists and matches bytes/SHA |
| BATCH-D | docs | one truthful combined report + one docs closure commit |
| BATCH-E | final state | clean tracked/staged state; no push; Wave 4 paused |

All rows are required for `PRE_WAVE_4_RELIABILITY_R4_R6_BATCH_VERIFIED`.

---

## 9. Explicit non-goals and deferred work

This batch does not:

- implement Agent Port / MCP / Wave 4 capabilities;
- modify editor product layout or add embedded AI;
- add extension marketplace support;
- produce or replace audio;
- change performance qualifications;
- package or release the engine;
- redesign save/recovery or Windows replacement;
- alter project content or Starter fixtures;
- close future findings not named R4/R5/R6;
- broadly normalize all JSON documents;
- guarantee arbitrary third-party callback behavior beyond the tested Interpreter contract.

If a useful improvement is discovered but not required for an invariant above, record it as a post-batch suggestion. Do not implement it in this batch.

---

## 10. Execution Ledger

> Append-only during execution. Each entry must include local time, live HEAD, remote relationship, worktree/staging state, files changed, commands actually run with exit results, artifact identities, current verdict, unresolved issue, and next stop. Do not rewrite historical entries into current facts.

### 2026-08-21 Taskbook creation baseline

```text
ROLE = GENERAL_MANAGER_TASKBOOK_AUTHOR
BRANCH = main
HEAD = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
REMOTE_MAIN = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
AHEAD_BEHIND = 0/0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
EXISTING_UNTRACKED_GOVERNANCE_AND_PROTECTED_PATHS = PRESERVED
PRODUCTION_FILES_CHANGED_BY_TASKBOOK_AUTHOR = NONE
TESTS_RUN_BY_TASKBOOK_AUTHOR = NONE
PUSH = NOT_PERFORMED
R4_R6 = AUTHORIZED_AS_ONE_SEQUENTIAL_BATCH
WAVE_4 = PAUSED
NEXT = EXECUTION_AI_TASK_0
```

The taskbook author's source inspection verified:

```text
R4 current snapshot top-level parser = JSON.parse + non-object coercion to {}
R4 current config-operations parser = strict PROJECT_INVALID object parser
R4 current Editor applyVariablesToConfig = unchecked JSON.parse cast
R5 current generic branch = checks jumpOverride but not resumeRequested before pc++
R6 current events.json scan = events[].when only
R6 Runtime scheduler = strict evalExprBoolean oracle
```

No production code, test, report, long-term ledger, protected file, commit, or remote state was changed while creating this taskbook.

### 2026-08-21 01:23:13 +08:00 Task 0 live authority and baseline

```text
R46_TASK_0 = COMPLETED
BRANCH = main
INITIAL_HEAD = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
INITIAL_PARENT = d079f3fcf4eded33836123c4caf3308285430526
REMOTE_MAIN = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
AHEAD_BEHIND = 0/0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
TRACKED_LOGS = NONE
PUSH = NOT_PERFORMED
R4_R6 = AUTHORIZED_AS_ONE_SEQUENTIAL_BATCH
R4_R6_IMPLEMENTATION = NOT_STARTED
WAVE_4 = PAUSED
```

Authority files were read completely in the taskbook-prescribed order. Their Task 0 readback identities were:

| path | bytes | SHA-256 |
|---|---:|---|
| `AGENTS.md` | 7808 | `4184285B9BD47B6AD61C34A181CA99BFEEDD7257896815461BE4B46E8137AEE` |
| `docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md` | 54483 | `045E73D27D862CCF16607EFD64A09E0B485409D59829EA8A25D1EFD6ABD9D107` |
| `docs/PRE-WAVE-4-RELIABILITY-FRESH-GATE-DELIVERY-REPORT-2026-08-20.md` | 10705 | `3EF6A354F14BDCC5FD7887D3EAEEC6513D2B9199EFF35920B30646056AA27C89` |
| `docs/superpowers/plans/2026-08-21-pre-wave-4-reliability-r4-r6-closure-batch.md` | 48306 | `1028C6C170E7C50068D8BC0FDC95F3F220D919F64CFB9D4B29C45C8AF516C915` |
| `docs/superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md` | 48931 | `255EAC30C2FF0F73689EFC22898BE6A1D58B15CC3C70D324FE2CF23227051196` |
| `docs/RELIABILITY-R1-SIMULATION-CONTROL-FLOW-IDENTITY-DELIVERY-REPORT-2026-08-20.md` | 10674 | `8E2EE2248B3CA2533CE855108F8343DDF56310A07872379C0D4F938EB5B6D785` |
| `docs/superpowers/plans/2026-08-20-reliability-r2-post-replacement-commit-contract.md` | 50396 | `A2CD3E767ED32DAB191D99C250996B6713276CEDEFF594547E7F729747E262EB` |
| `docs/RELIABILITY-R2-POST-REPLACEMENT-COMMIT-CONTRACT-DELIVERY-REPORT-2026-08-20.md` | 12656 | `2E645A352F939FE5A35E6A568DFBF148F160350995018B7126028FC05ADFBD0E` |
| `docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md` | 55854 | `1EA38DA11F369D666FA3FD6263C72FEEEEC6DD5CB918C8DAA20B08134B1BD52F` |
| `docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md` | 13181 | `B1EAF74ACBA4099CB73AF40BAA6D4CCEE41673DACE60903D19AE2564D7697E19` |
```

Fresh Gate historical artifacts were present and matched the taskbook identities: `a7-authoring-vitest.json` 1811 bytes, `a7-editor-vitest.json` 1848 bytes, `m1-generic-start-vitest.json` 1900 bytes, `n4-runtime-oracle.json` 2806 bytes, and `n4-cli-lint.json` 1865 bytes. They were read-only and not overwritten.

The unique batch evidence root is:

```text
C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060
ROOT_ENTRIES_AT_CREATION = 0
```

Live scope anchors confirmed the intended pre-fix surfaces: snapshot/config/editor still contain separate top-level JSON parsing paths; Interpreter contains the generic `instr` branch with `resumeRequested` handling elsewhere; and CLI `events.json` scanning currently has a single `events[].when` extraction path while existing tests already mention `scheduled[]` for unrelated host-jump coverage. No production or test file was modified in Task 0. Known untracked governance/protected paths were preserved, including the current R4–R6 taskbook; the long-term roadmap was not touched.

### 2026-08-21 01:24:46 +08:00 Task 1 R4 permanent RED evidence

```text
R46_TASK_1 = COMPLETED
R4_AUTHORING_TEST_CHANGE = packages/authoring/test/project-snapshot.test.ts
R4_EDITOR_TEST_CHANGE = packages/editor/test/config-edit.test.ts
R4_AUTHORING_RED = VALID; exit 1; promise resolved instead of rejecting
R4_EDITOR_RED = VALID; exit 1; no exception thrown for []
HARNESS_INVALID = NO
RED_RERUN = NO
R4_IMPLEMENTATION = NOT_STARTED
R5_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_PERFORMED
```

Fresh RED commands and readbacks:

```text
npm run test -w @surdet/authoring -- project-snapshot.test.ts -t "rejects a syntactically valid non-object game.config.json" --reporter=json --outputFile="C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-authoring-red.json"
exit = 1
business failure = promise resolved with snapshot instead of rejecting
artifact bytes = 2291
artifact SHA-256 = 2677469C6327E03BFEFA4C5CDC580F09436714C7A57059774E738489DDB4EA6E

npm run test -w surdet-editor -- config-edit.test.ts -t "applyVariablesToConfig rejects a non-object top-level config" --reporter=json --outputFile="C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-editor-red.json"
exit = 1
business failure = expected throw did not occur for []
artifact bytes = 10492
artifact SHA-256 = 58EA6B0E7B9442CDEB71201084CFF9885C517921A72DF133D09A96F5E8A08389
```

Both failures reproduce the confirmed A7 non-object-config symptoms. The RED artifacts remain immutable in the unique batch root; no production file was changed before or during RED.

### 2026-08-21 01:27:29 +08:00 Task 2 R4 implementation and code evidence

```text
R46_TASK_2 = COMPLETED
R4_IMPLEMENTATION = PASS
R4_SHARED_PARSER = packages/authoring/src/config-document.ts
R4_SHARED_PARSER_EXPORT = packages/authoring/src/index.ts
R4_SHARED_CONSUMERS = project-snapshot.ts; config-operations.ts; packages/editor/src/config-edit.ts
R4_PRIVATE_PARSE_CONFIG_REMOVED = YES
R4_NON_OBJECT_TOP_LEVEL_REJECTION = PROJECT_INVALID
R4_EMPTY_CONFIG_BEHAVIOR_PRESERVED = YES
R4_NESTED_VARIABLE_VALIDATION_EXPANDED = NO
R4_FOCUSED_GREEN = PASS; Authoring and Editor targeted tests each passed
R4_AUTHORING_FULL = PASS; 20 files / 124 tests
R4_AUTHORING_TYPECHECK = PASS; exit 0
R4_AUTHORING_BUILD = PASS; exit 0
R4_EDITOR_FULL = PASS; 26 files / 173 tests
R4_EDITOR_TYPECHECK = PASS; exit 0
R4_EDITOR_BUILD = PASS; exit 0
R4_CODE_EVIDENCE_HEAD = 325fd0688a638fe52f59edfd9f798f5420dca347
R4_CODE_EVIDENCE_PARENT = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
R4_CODE_EVIDENCE_MESSAGE = fix(authoring): reject non-object project config
R4_CODE_EVIDENCE_SCOPE = EXACT_R4_WHITELIST_PLUS_TASKBOOK
REMOTE_MAIN_AFTER_R4 = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
AHEAD_BEHIND_AFTER_R4 = 1/0
R5_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_PERFORMED
```

R4 code commit scope read back exactly:

```text
A docs/superpowers/plans/2026-08-21-pre-wave-4-reliability-r4-r6-closure-batch.md
A packages/authoring/src/config-document.ts
M packages/authoring/src/config-operations.ts
M packages/authoring/src/index.ts
M packages/authoring/src/project-snapshot.ts
M packages/authoring/test/project-snapshot.test.ts
M packages/editor/src/config-edit.ts
M packages/editor/test/config-edit.test.ts
```

R4 artifact identities, all read from the unique batch root:

| artifact | bytes | SHA-256 |
|---|---:|---|
| `r4-authoring-red.json` | 2291 | `2677469C6327E03BFEFA4C5CDC580F09436714C7A57059774E738489DDB4EA6E` |
| `r4-editor-red.json` | 10492 | `58EA6B0E7B9442CDEB71201084CFF9885C517921A72DF133D09A96F5E8A08389` |
| `r4-authoring-green.json` | 1421 | `DDAE33E380DAEDFA3DC0D498713D27BDFA5D8C453ECAA1D9BBE0817687F6D9DF` |
| `r4-editor-green.json` | 9625 | `5363C3AC7CCDD1EB1456E3BE80F16E05D7AB2362E2E705FE3C156C3788D0C9F0` |
| `r4-authoring-full.txt` | 1289 | `2E79E49045692708829F65BF5579181CE322A82AF9500D82ABC969BFDBA8F2D0` |
| `r4-authoring-typecheck.txt` | 74 | `9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78` |
| `r4-authoring-build.txt` | 67 | `D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9` |
| `r4-editor-full.txt` | 1549 | `4FDD379C1F5F0E9B8C5B417A677EF6C26E4BAAECD8AD6AE5EA647AC27DE8AA4F` |
| `r4-editor-typecheck.txt` | 70 | `6C063F98A510A39EA4D645FDB790D9576ACDBEEA0A0B16E9335C0C373A538AD3` |
| `r4-editor-build.txt` | 1998 | `91446F3ABB67D5C7B055EE14776C72E3B63E4FF0DFD8E8A82A0F43E39F07E005` |
```

No R4 suite was rerun after the code commit; the taskbook is now the only expected tracked modification before continuing directly to Task 3.

### 2026-08-21 01:29:34 +08:00 Task 3 R5 generic reentrancy evidence

```text
R46_TASK_3 = COMPLETED
R5_RED = VALID; exit 1; actual first text was 第二条 instead of 第一条
R5_GREEN = PASS; exit 0; target instruction zero preserved
R5_GENERIC_BRANCH_FIX = YES
R5_CLEAR_SPECIAL_CASE = NO
R5_RECURSIVE_STEP_ADDED = NO
R5_HOST_JUMP_PRECEDENCE = PRESERVED
R5_CORE_FULL = PASS; 24 files / 319 tests
R5_CORE_TYPECHECK = PASS; exit 0
R5_CORE_BUILD = PASS; exit 0
R5_CODE_EVIDENCE_HEAD = 67b7d915f1fd97c03fdca18ad5eb356b096771ef
R5_CODE_EVIDENCE_PARENT = 325fd0688a638fe52f59edfd9f798f5420dca347
R5_CODE_EVIDENCE_MESSAGE = fix(core): preserve generic start reentrancy
R5_CODE_EVIDENCE_SCOPE = EXACTLY_TWO_CORE_FILES
REMOTE_MAIN_AFTER_R5 = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
AHEAD_BEHIND_AFTER_R5 = 2/0
R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_PERFORMED
```

R5 code commit scope read back exactly:

```text
M packages/core/src/runtime/interpreter.ts
M packages/core/test/interpreter.test.ts
```

R5 artifact identities, all read from the unique batch root:

| artifact | bytes | SHA-256 |
|---|---:|---|
| `r5-core-red.json` | 12286 | `E72DDC901750BCB66228DC7E7B13C651F00902FE91B5726F4DBACF77B5EDA1BB` |
| `r5-core-green.json` | 11414 | `7FDDE9B2B4B27022CF328C885E7EF52DBCE21EDCD1AB1661BE4E669FFF867C3F` |
| `r5-core-full.txt` | 3125 | `19DB72B9F16CE00FEFDD725F858A093F3F8F8F1A0B643D3B94D2E251BAA9FD10` |
| `r5-core-typecheck.txt` | 69 | `A18A84F9CE7D19E0E4C7B6261986CBBED38BC76378B22D4492897B461F0FA2DA` |
| `r5-core-build.txt` | 62 | `0943F1AA4B29D9DA4EADBA76586FAC5B15FF29332FEBCDB4A810A8AF64AEED8D` |
```

R5 RED/GREEN and adjacent gates passed without rerunning R4; the taskbook remains the only tracked modification between lane commits. Continue directly to Task 4.

### 2026-08-21 01:32:23 +08:00 Task 4 R6 scheduled-expression lint evidence

```text
R46_TASK_4 = COMPLETED
R6_RUNTIME_ORACLE = PASS; exit 0; undefined scheduled expression remains strict at Runtime
R6_RED = VALID; exit 1; scheduled ghost expression produced zero V002 issues
R6_GREEN_INITIAL_ARTIFACT = HARNESS_INVALID; exit 0; 0 passed / 0 failed because the filter contained an extra space
HARNESS_CORRECTION = 1
R6_GREEN = PASS; exit 0; corrected artifact 1 passed / 0 failed
R6_SHARED_EXTRACTOR = extractWhenExpressions(events + scheduled)
R6_SECOND_LINT_PASS = NO
R6_RUNTIME_MODIFIED = NO
R6_CLI_FULL = PASS; 15 files / 138 tests
R6_CLI_TYPECHECK = PASS; exit 0
R6_CLI_BUILD = PASS; exit 0
R6_CODE_EVIDENCE_HEAD = ee4b198fa8d2922bff0b4fc5c732b678ef247474
R6_CODE_EVIDENCE_PARENT = 67b7d915f1fd97c03fdca18ad5eb356b096771ef
R6_CODE_EVIDENCE_MESSAGE = fix(cli): lint scheduled event conditions
R6_CODE_EVIDENCE_SCOPE = EXACTLY_TWO_CLI_FILES
REMOTE_MAIN_AFTER_R6 = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
AHEAD_BEHIND_AFTER_R6 = 3/0
WAVE_4 = PAUSED
PUSH = NOT_PERFORMED
```

R6 code commit scope read back exactly:

```text
M packages/cli/src/lint.ts
M packages/cli/test/lint.test.ts
```

R6 artifact identities, all read from the unique batch root:

| artifact | bytes | SHA-256 | status |
|---|---:|---|---|
| `r6-runtime-oracle.json` | 2807 | `DC06D24962985B26D24E374424B46A3585DAD93C26E164B97AC2128C9C53844C` | PASS; 1/0 |
| `r6-cli-red.json` | 18683 | `849CD79050838EFDEFDA98E926B98B4EFC03E662E969724E6F2AD1DB8B74181D` | VALID RED; 0/1 |
| `r6-cli-green.json` | 17782 | `11BA3295078E5896274A52834CD2C2C72B39CFC71FB937F847ACF9D63CE79374` | HARNESS_INVALID; 0/0 |
| `r6-cli-green-harness-correction-1.json` | 17815 | `73BA96A446E99F0418998BDD53F59D51E090861493034489D6C1768974E55F38` | PASS; 1/0 |
| `r6-cli-full.txt` | 5121 | `E72BA3CCD7993E94F4A594D52DFDA0DF3A334C04C350E69DD2ECB6EB2B8919B9` | PASS |
| `r6-cli-typecheck.txt` | 68 | `AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917` | PASS |
| `r6-cli-build.txt` | 61 | `898D2AD82D33C86E701D8865F20A428CA48DB35240DD429FD8E62F480C2EA93E` | PASS |
```

The initial zero-test green artifact was preserved and is not used as success evidence. The corrected run matched the intended test and passed. R4 and R5 were not rerun; continue to Task 5 aggregate scope verification.

### 2026-08-21 01:39:56 +08:00 Task 5 aggregate verification and artifact manifest

```text
R46_TASK_5 = COMPLETED
BATCH_SCOPE = PASS
R4_COMMIT_SCOPE = EXACT_R4_WHITELIST_PLUS_TASKBOOK
R5_COMMIT_SCOPE = EXACTLY_TWO_CORE_FILES
R6_COMMIT_SCOPE = EXACTLY_TWO_CLI_FILES
TASKBOOK_ONLY_TRACKED_MODIFICATION_BEFORE_FINAL_DOCS = YES
STAGING_BEFORE_FINAL_DOCS = EMPTY
GIT_DIFF_CHECK = PASS
GIT_DIFF_CACHED_CHECK = PASS
TRACKED_LOG_FILES = NONE
R46_VERIFY_ALL_COMMAND = npm run verify:all 2>&1 | Tee-Object -FilePath r46-verify-all.txt
R46_VERIFY_ALL = PASS; exit 0; process completed through final verify:diff-check with no non-zero node
R46_VERIFY_ALL_NODES = 14 sequential nodes reached completion
R46_VERIFY_TOOLS = PASS; 10/10
R46_RENDERER_BOUNDARIES = PASS; 3/3
R46_RENDERER_LEGACY = PASS; 4/4
R46_HYGIENE = PASS; 739 tracked paths
R46_AUTHORING_TESTS = PASS; 20 files / 124 tests
R46_CLI_TESTS = PASS; 15 files / 138 tests
R46_CORE_TESTS = PASS; 24 files / 319 tests
R46_EDITOR_TESTS = PASS; 26 files / 173 tests
R46_HOST_TESTS = PASS; 11 files / 87 tests
R46_RENDERER_TESTS = PASS; 49 files / 406 tests
R46_SHELL_TESTS = PASS; 22 files / 195 tests
R46_STARTER_TESTS = PASS; 4 files / 7 tests
R46_ZERO_TESTS = PASS; 4 files / 29 tests
R46_STARTER_LINT = PASS
R46_STARTER_SIMULATE = PASS; executed only as an internal verify:all node
R46_FORMAL = PASS; executed only as an internal verify:all node
R46_EDITOR_BUILD = PASS
R46_STARTER_BUILD = PASS
R46_FORMAL_BUILD = PASS
R46_DIFF_CHECK = PASS; line-ending warning only
R46_VERIFY_ALL_STANDALONE_STARTER_SIMULATE = NO
R46_VERIFY_ALL_ELECTRON = NO
R46_VERIFY_ALL_PERFORMANCE_PACK_DEPLOY_RELEASE = NO
WAVE_4 = PAUSED
PUSH = NOT_PERFORMED
```

The aggregate log completed after all listed nodes and contains no failing node. It includes the repository's existing Zero speaker warnings and build chunk-size warnings; they did not produce a non-zero node. No lane code, test, package manifest, lockfile, or forbidden file was changed after the R6 commit.

Final aggregate artifact identities, all read from the unique batch root:

```text
R46_ARTIFACT_COUNT = 23
R46_ARTIFACT_MANIFEST_PATH = C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r46-artifact-manifest.txt
R46_ARTIFACT_MANIFEST_BYTES = 4271
R46_ARTIFACT_MANIFEST_SHA256 = E67DDD2556F4B17F406504E297F57B19C32F847F8BD4FB93FB1C3EBF22432DFC
```

The manifest includes the preserved `r6-cli-green.json` harness-invalid artifact and the corrected `r6-cli-green-harness-correction-1.json` pass artifact. No temporary artifact was added to the repository.

### 2026-08-21 01:41:19 +08:00 Task 6.1 frozen delivery report identity

```text
R46_TASK_6_1 = COMPLETED
R46_REPORT_PATH = E:\surdet\docs\PRE-WAVE-4-RELIABILITY-R4-R6-CLOSURE-BATCH-DELIVERY-REPORT-2026-08-21.md
R46_REPORT_BYTES = 23642
R46_REPORT_SHA256 = 7C52EDBBC49887F8C858AD1DDAE2BAEA0F168949DEED1F7022BFED0BF4853CB5
R46_REPORT_IDENTITY_READBACK = PASS
R46_REPORT_SELF_HASH_INCLUDED = NO
R46_REPORT_MODIFIED_AFTER_FREEZE = NO
```

The report identity was read from disk before this ledger append and read back again afterward; only this taskbook changed. The report intentionally contains neither its own bytes/SHA nor a pre-commit docs closure hash.

### 2026-08-21 01:45:45 +08:00 Task 6.1 pre-commit formatting correction

```text
R46_REPORT_PRE_FORMAT_IDENTITY = HISTORICAL_PRE_VALIDATION_IDENTITY
R46_REPORT_PRE_FORMAT_BYTES = 23642
R46_REPORT_PRE_FORMAT_SHA256 = 7C52EDBBC49887F8C858AD1DDAE2BAEA0F168949DEED1F7022BFED0BF4853CB5
R46_REPORT_FORMAT_CORRECTION = REMOVED_THREE_INTENTIONAL_MARKDOWN_TRAILING_SPACES
R46_REPORT_FINAL_FROZEN_BYTES = 23636
R46_REPORT_FINAL_FROZEN_SHA256 = E8BBF44D1A5C9CAD39800A37D1C5998D25E55415C0D70DB4C0C8DEE7FAA4B6F9
R46_REPORT_FINAL_IDENTITY_READBACK = PASS
R46_TESTS_RERUN_DURING_CORRECTION = NO
R46_PRODUCTION_FILES_MODIFIED_DURING_CORRECTION = NO
R46_REPORT_MODIFIED_AFTER_FINAL_FREEZE = NO
```

The pre-format identity is historical only. The final report identity above was read from disk after the whitespace correction and passed the required cached diff check; no test, build, or production file was rerun or changed.
