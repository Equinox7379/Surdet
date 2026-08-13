# Surdet Player Experience Wave 6 — Gallery Content Integrity Implementation Plan

> **For agentic workers:** Execute this plan serially, one task at a time. Checkboxes are mandatory progress markers.

**Goal:** Replace stale Gallery data in 《零点之后》 with its real content and add reusable CLI validation for Gallery integrity.

**Architecture:** The CLI owns reusable static validation; Zero supplies only declarative catalogue, unlock locations, and avatar mapping. Runtime layers remain unchanged.

**Tech Stack:** TypeScript, Node filesystem APIs, Vitest, existing Surdet CLI and DSL.

## Global Constraints

- Read `AGENTS.md` before changing code.
- Do not push, deploy, package, release, enter M9, change performance work, or change assets/audio.
- Do not change Renderer, Host, Shell, Editor, Core runtime, save format, DSL grammar, or `examples/zero-after-midnight/src/main.ts`.
- Preserve protected untracked files exactly as found.
- Apply TDD: focused red test, minimal implementation, same focused green test, then proportional gates.
- Stop after local commits and report for independent review.

## Why this is the next wave

Wave 5B now has a direct project-owner manual pass: choices are centered, the continue marker no longer overlaps the command rail, and the Backlog title is readable. The next confirmed content integrity issue is independent of those visual repairs:

- `examples/zero-after-midnight/content/config/gallery.json` still contains Starter residue: `castle_hall`, `night_field`, `tense_01`, `ch01_01`, and `ch01_02`.
- Those keys/scenes do not belong to 《零点之后》.
- The formal game has ten BGM assets and eleven scene files, but it currently has no corresponding Gallery unlock ledger.
- `content/assets/avatar/zhirao.png` already exists and the runtime already registers it, but `game.config.json` does not configure `characters.zhirao.avatar`, so the existing SpeakerProfile-to-DialogueLayer avatar path receives no key.
- The existing `surdet lint` validates scenario structure but does not validate gallery configuration against assets, replay targets, or unlock instructions.

This wave fixes the real data and puts the general preventative rule into `@surdet/cli`. It is deliberately not an audio-production, visual-asset, performance, documentation-governance, or formal-release wave.

## Full Global Constraints

- Read `E:\surdet\AGENTS.md` before changing any file. Its user-feedback priority and proportionate-verification rules override habitual “more testing is always better” behavior.
- Record the actual starting `git rev-parse HEAD`, `git status --short`, and `git rev-list --left-right --count HEAD...surdet/main`. Do not assume the planning HEAD is still current when implementation starts.
- One execution AI works serially. Do not create a worktree, dispatch another AI, or edit several unrelated topics in parallel.
- Only files listed in the locked file map may be created or modified. A tracked source change outside that map is a hard stop unless the project owner gives a new explicit authorization.
- The only Core file allowed is `packages/core/src/lint-hints.ts`, and it may only receive repair hints for the new CLI lint codes. Core runtime, interpreter behavior, GalleryState, save snapshots, and schema version must not change.
- Do not add dependencies, packages, a second lint command, an alternative Gallery runtime API, a compatibility layer, a migration, a fallback path, a background ticker, or a Shell/Electron runner.
- Reuse existing `@unlock_cg`, `@unlock_music`, and `@unlock_text` DSL instructions exactly. Do not alter their syntax, parser, interpreter execution, snapshot behavior, or restore behavior.
- Do not create, delete, resize, convert, regenerate, upload, move, copy, overwrite, or stage any image, audio, font, screenshot, release artifact, baseline artifact, user save, or user profile.
- `cgs` must become an empty JSON array. Existing backgrounds are not dedicated CGs and must not be renamed/relabelled as CG merely to fill a tab. Dedicated CG import is an art-approved future task.
- Do not claim that current music quality improved. The files are known placeholders; this wave only makes their existing keys and unlock mapping truthful. Audio replacement, looping, ducking, and listening review are separate audio-engineering work.
- Do not alter Wave 5B layout behavior: centered choices, continue-indicator anchoring, command rail, Backlog scroll mask, or Backlog title visual styling.
- Do not alter dialogue, choices, variables, route conditions, labels, background keys, BGM keys, BGM selection, fades, timing, endings, scene jumps, or scenario structure. The only scenario edits are the exact `@unlock_*` lines written in this plan.
- Do not move/delete/archive/rename documentation. Documentation governance remains scheduled after active product work.
- Do not enter M9, Q1–Q5, Renderer performance qualification, performance optimization, audio production, visual asset production, formal EXE packaging, `electron-builder`, release, or deployment.
- Do not push, force-push, rebase, reset, amend, squash, cherry-pick, checkout-overwrite, clean, or delete user files. Make ordinary local commits only, then stop for review.
- Keep these user files unmodified, unstaged, uncommitted, undeleted, and unmoved: `AGENTS.md`, `SESSION-HANDOFF.md`, `USER.md`, `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`, and `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`.
- User manual observations are first-class evidence. Do not dismiss a reported player issue merely because a unit test is green.
- Use TDD whenever behavior changes: first focused test red, then minimal implementation, then same focused test green, then the exact adjacent gates listed below.
- Do not inflate this into a large Electron screenshot matrix. The project owner will manually inspect the visible Gallery behavior after reviewing the local delivery and explicitly asking for a development deployment.

---

## Locked file map

### Create

| File | Single responsibility |
| --- | --- |
| `packages/cli/src/gallery-config-lint.ts` | Pure reusable Gallery/config/asset/unlock validator consumed by `surdet lint`; no process exit and no direct console output. |
| `packages/cli/test/gallery-config-lint.test.ts` | Fixture-driven CLI validation tests through public `lintProject()`. |
| `examples/zero-after-midnight/test/gallery-content-contract.test.ts` | Zero-only content contract for the approved catalogue, unlock coverage, valid replay destinations, and `zhirao` avatar mapping. |
| `docs/ENGINE-PLAYER-EXPERIENCE-WAVE-6-GALLERY-CONTENT-INTEGRITY-DELIVERY-REPORT-2026-08-12.md` | Factual delivery report, written only after final checks actually run. |

### Modify

| File | Exact change |
| --- | --- |
| `packages/cli/src/lint.ts` | Compose the reusable Gallery validator before `attachHints(issues)`; do not duplicate its logic. |
| `packages/core/src/lint-hints.ts` | Add useful `G001`–`G008` repair hints, nothing else. |
| `examples/zero-after-midnight/game.config.json` | Add only `characters.zhirao.avatar: "zhirao"`. |
| `examples/zero-after-midnight/content/config/gallery.json` | Replace copied Starter entries with the exact approved Zero-only catalogue. |
| The eleven named `.gal` files in Task 2 | Insert only the exact `@unlock_text` and `@unlock_music` lines from the table. |
| This plan | Maintain execution ledger facts; do not rewrite design intent. |

### Must stay unchanged

```text
all files under packages/renderer/
all files under packages/host/
all files under packages/shell/
all files under packages/editor/
all Core runtime and save directories
examples/zero-after-midnight/src/main.ts
examples/zero-after-midnight/scripts/check-assets.mjs
all files under examples/zero-after-midnight/content/assets/
all files under examples/starter/
all files under docs/baselines/
all files under docs/competitive-research/
```

`check-assets.mjs` intentionally stays unchanged. Gallery integrity gets one canonical reusable implementation in `surdet lint`; this wave must not create a second hand-maintained Zero-only parser.

---

## Required final behavior

### Generic `surdet lint` contract

When a game has `content/config/gallery.json`, `surdet lint` must emit error-level `LintIssue` values, each with a non-empty JSON `hint`, for these conditions:

| Code | Condition | Repair direction |
| --- | --- | --- |
| `G001` | JSON/shape invalid; required `cgs`/`music` arrays missing; malformed entry; empty ID/name; illegal optional property type. | Make the Gallery configuration structurally valid. |
| `G002` | Duplicate ID within one Gallery section. | Use one unique ID per section. |
| `G003` | CG source key has no existing `content/assets/bg/<key>.*`, or music source key has no existing `content/assets/bgm/<key>.*`. | Correct the key or import an approved asset in a separate asset task. |
| `G004` | Text replay scene does not exist or did not compile. | Correct the scene key or repair that scene first. |
| `G005` | Text replay label is absent in its target scene. | Correct/remove the optional label, or separately add a legitimate label. |
| `G006` | `@unlock_cg`, `@unlock_music`, or `@unlock_text` has no matching entry in its Gallery category, including a missing ID argument. | Add/correct the matching entry or instruction. |
| `G007` | A configured Gallery entry has no matching unlock instruction in compiled scenes. | Add the intentional unlock point or remove the dead entry. |
| `G008` | A configured character avatar key is blank/non-string or does not map to `content/assets/avatar/<key>.*`. | Correct the configured key or import an approved avatar separately. |

Exact semantics:

- `cgs` and `music` are required arrays if `gallery.json` exists. `texts` is optional and is interpreted as an empty array when absent, matching the existing Renderer public configuration type.
- Every entry has a non-empty string `id` and `name`.
- `src` is optional for CG/music because current Renderer already falls back to `id`; validate `src` when supplied, otherwise validate `id` as the asset key.
- The current Gallery CG renderer resolves CG sources through the background registry. Therefore generic CG checks use `content/assets/bg`, not a newly invented CG folder.
- Text `label` is optional. With no label, `hostJump(scene, undefined)` begins at scene start. With a label, it must name a real `@label` in a successfully compiled target scene.
- Inspect compiled `GenericInstr` objects (`op === 'instr'`) for `unlock_cg`, `unlock_music`, and `unlock_text`; do not write a second regex-based DSL parser.
- When a target scene already failed compilation, preserve its primary compiler error and suppress a misleading duplicate “missing scene” Gallery error.
- Read only project files. Do not import Renderer, allocate Pixi objects, read/write user data, or use a game-specific name in the generic module.

### Approved Zero Gallery catalogue

Replace all content of `examples/zero-after-midnight/content/config/gallery.json` with this exact JSON. Use ordinary JSON only: no comments, trailing commas, JSON5 syntax, extra keys, placeholder entry, or Starter legacy identifier.

```json
{
  "cgs": [],
  "music": [
    { "id": "midnight_rain", "name": "午夜雨声", "src": "midnight_rain" },
    { "id": "old_room", "name": "旧屋", "src": "old_room" },
    { "id": "convenience_hum", "name": "便利店白噪", "src": "convenience_hum" },
    { "id": "underground_signal", "name": "地下信号", "src": "underground_signal" },
    { "id": "investigation", "name": "调查记录", "src": "investigation" },
    { "id": "last_train", "name": "末班列车", "src": "last_train" },
    { "id": "ending_testimony", "name": "证词", "src": "ending_testimony" },
    { "id": "ending_meeting", "name": "会面", "src": "ending_meeting" },
    { "id": "blackout", "name": "断电", "src": "blackout" },
    { "id": "ending_silence", "name": "沉默", "src": "ending_silence" }
  ],
  "texts": [
    { "id": "prologue", "name": "午夜来电", "scene": "prologue" },
    { "id": "common_0017", "name": "红色笔记", "scene": "common_0017", "label": "start" },
    { "id": "common_apartment", "name": "旧公寓", "scene": "common_apartment", "label": "start" },
    { "id": "common_convenience", "name": "雨夜便利店", "scene": "common_convenience", "label": "start" },
    { "id": "common_passage", "name": "地下通道", "scene": "common_passage", "label": "start" },
    { "id": "route_testimony_station", "name": "档案室", "scene": "route_testimony_station", "label": "start" },
    { "id": "route_testimony_rooftop", "name": "屋顶的证词", "scene": "route_testimony_rooftop", "label": "start" },
    { "id": "route_meeting_train", "name": "末班列车", "scene": "route_meeting_train", "label": "start" },
    { "id": "route_meeting_rooftop", "name": "雨夜屋顶", "scene": "route_meeting_rooftop", "label": "start" },
    { "id": "route_silence_blackout", "name": "停电的房间", "scene": "route_silence_blackout", "label": "start" },
    { "id": "route_silence_dawn", "name": "黎明街道", "scene": "route_silence_dawn", "label": "start" }
  ]
}
```

The empty `cgs` array is a deliberate product truth, not an unfinished item. No ordinary background may be presented as a CG until the art pipeline imports an approved dedicated CG image with an approved unlock moment.

### Exact Zero unlock map

Insert only these lines and preserve everything else in each `.gal` file. Put `@unlock_text` after `@scene` and the optional `@label start`, before the first `@bg`. Put `@unlock_music` directly after that scene’s first `@bgm`.

| Scene file | Text unlock | Music unlock |
| --- | --- | --- |
| `prologue.gal` | `@unlock_text prologue` after `@scene prologue` | `@unlock_music midnight_rain` after `@bgm midnight_rain` |
| `common_0017.gal` | `@unlock_text common_0017` after `@label start` | `@unlock_music midnight_rain` after `@bgm midnight_rain` |
| `common_apartment.gal` | `@unlock_text common_apartment` after `@label start` | `@unlock_music old_room` after `@bgm old_room` |
| `common_convenience.gal` | `@unlock_text common_convenience` after `@label start` | `@unlock_music convenience_hum` after `@bgm convenience_hum` |
| `common_passage.gal` | `@unlock_text common_passage` after `@label start` | `@unlock_music underground_signal` after `@bgm underground_signal` |
| `route_testimony_station.gal` | `@unlock_text route_testimony_station` after `@label start` | `@unlock_music investigation` after `@bgm investigation` |
| `route_testimony_rooftop.gal` | `@unlock_text route_testimony_rooftop` after `@label start` | `@unlock_music ending_testimony` after `@bgm ending_testimony` |
| `route_meeting_train.gal` | `@unlock_text route_meeting_train` after `@label start` | `@unlock_music last_train` after `@bgm last_train` |
| `route_meeting_rooftop.gal` | `@unlock_text route_meeting_rooftop` after `@label start` | `@unlock_music ending_meeting` after `@bgm ending_meeting` |
| `route_silence_blackout.gal` | `@unlock_text route_silence_blackout` after `@label start` | `@unlock_music blackout` after `@bgm blackout` |
| `route_silence_dawn.gal` | `@unlock_text route_silence_dawn` after `@label start` | `@unlock_music ending_silence` after `@bgm ending_silence` |

The duplicate `@unlock_music midnight_rain` is intentionally correct. `GalleryState.unlockMusic()` already deduplicates the ID, while both scenes must be self-sufficient on a normal or replay entry path.

### Exact avatar mapping

Change only this configuration fragment:

```json
"zhirao": {
  "name": "许知遥"
}
```

to:

```json
"zhirao": {
  "name": "许知遥",
  "avatar": "zhirao"
}
```

Do not modify `avatar/zhirao.png`. The existing Zero asset loader already registers it as `zhirao`; `main.ts` already turns the configuration into `SpeakerProfile.avatarKey`; `DialogueLayer` already resolves that key. This wave supplies only the missing declarative connection.

---

## Task 0: Establish a truthful baseline and scope lock

**Files:**

- Modify only the execution ledger section of this plan.
- Read the current rules, Gallery config, game config, scenarios, CLI lint source/tests, and existing asset names.

**Consumes:** Current checked-out source and the project owner’s passed Wave 5B manual visual review.

**Produces:** A recorded baseline, not any production modification.

- [ ] **Step 1: Read authority files in this order.**

  ```text
  E:\surdet\AGENTS.md
  E:\surdet\docs\ENGINE-PLAYER-EXPERIENCE-WAVE-5B-LAYOUT-POLISH-DELIVERY-REPORT-2026-08-12.md
  E:\surdet\docs\superpowers\plans\2026-08-12-player-experience-wave-6-gallery-content-integrity.md
  E:\surdet\packages\cli\src\lint.ts
  E:\surdet\packages\cli\test\lint.test.ts
  E:\surdet\examples\zero-after-midnight\game.config.json
  E:\surdet\examples\zero-after-midnight\content\config\gallery.json
  E:\surdet\examples\zero-after-midnight\scripts\check-assets.mjs
  ```

  Confirm the current Gallery data still contains the five listed Starter identifiers. If another approved task already changed it, stop and report the exact conflict rather than mechanically overwriting current work.

- [ ] **Step 2: Record Git/hygiene facts.**

  Run from `E:\surdet`:

  ```powershell
  git rev-parse HEAD
  git rev-list --left-right --count HEAD...surdet/main
  git status --short
  git diff --check
  git ls-files '*.log'
  ```

  Expected: `git diff --check` exits `0`, tracked log output is empty, and existing protected untracked files are only recorded rather than touched.

- [ ] **Step 3: Establish the meaningful baseline.**

  Run:

  ```powershell
  npm run build -w @surdet/core
  npm run build -w @surdet/cli
  npm run lint -w zero-after-midnight
  node examples/zero-after-midnight/scripts/check-assets.mjs
  ```

  Expected before Task 1: the lint command can pass despite the wrong Gallery graph. Record that as the exact existing tool gap. Do not pretend it is already a failing product test.

- [ ] **Step 4: Verify the source inventory used by this task.**

  ```powershell
  Get-ChildItem examples/zero-after-midnight/content/assets/bgm -File | Select-Object -ExpandProperty BaseName | Sort-Object
  Get-ChildItem examples/zero-after-midnight/content/scenario -Filter *.gal | Select-Object -ExpandProperty BaseName | Sort-Object
  rg -n --glob '*.gal' '@label start|@bgm ' examples/zero-after-midnight/content/scenario
  ```

  Expected: ten BGM assets and eleven scenes agree exactly with the approved tables. A mismatch is a stop condition; do not infer a near-match or invent a substitute.

- [ ] **Step 5: Record, do not commit.**

  Write actual command exits, start HEAD, current status, and inventory result into the plan ledger. Do not make a plan-only commit; proceed directly to Task 1 only after the baseline is understood.

---

## Task 1: Add reusable Gallery content validation to `@surdet/cli`

**Files:**

- Create: `packages/cli/src/gallery-config-lint.ts`
- Create: `packages/cli/test/gallery-config-lint.test.ts`
- Modify: `packages/cli/src/lint.ts`
- Modify: `packages/core/src/lint-hints.ts`
- Modify: execution ledger in this plan

**Consumes:** `lintProject()` compiled scenes, `GenericInstr` unlock instructions, scene labels, normal `LintIssue` values, and game asset folders.

**Produces:** A pure reusable `lintGalleryConfig(context)` helper. `surdet lint` invokes it before `attachHints(issues)`.

### Required module boundary

Create `packages/cli/src/gallery-config-lint.ts` with this contract:

```ts
import type { CompiledScene, LintIssue } from '@surdet/core';

export interface GalleryLintContext {
  readonly root: string;
  readonly scenes: ReadonlyMap<string, CompiledScene>;
  readonly failedSceneIds: ReadonlySet<string>;
  readonly issues: LintIssue[];
}

export function lintGalleryConfig(context: GalleryLintContext): void;
```

The module must be deterministic and synchronous. Its only effect is appending issues; it must never call `process.exit`, write to console, or access another package’s runtime.

Use this data model or an equivalent implementation with identical semantics:

```ts
type GallerySection = 'cgs' | 'music' | 'texts';
type UnlockInstruction = 'unlock_cg' | 'unlock_music' | 'unlock_text';

const SECTION_RULES: Readonly<Record<GallerySection, {
  readonly unlock: UnlockInstruction;
  readonly assetFolder: 'bg' | 'bgm' | null;
}>> = {
  cgs: { unlock: 'unlock_cg', assetFolder: 'bg' },
  music: { unlock: 'unlock_music', assetFolder: 'bgm' },
  texts: { unlock: 'unlock_text', assetFolder: null },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
```

Index asset keys using `path.parse(file).name`, so validation works with currently supported extensions rather than hardcoding `.png` or `.wav`.

- [ ] **Step 1: Write focused failing tests before the production module exists.**

  Create `packages/cli/test/gallery-config-lint.test.ts`. Follow the temporary-project fixture style in `packages/cli/test/lint.test.ts`, but call the public `lintProject(projectDir)` only; do not import a private helper from the new module.

  The test suite must have all eight cases below:

  ```ts
  it('reports G001 for invalid Gallery JSON structure and entry fields', () => {
    // Cover a malformed JSON document and a structurally invalid document
    // with missing cgs/music arrays or an entry with an empty id/name.
    // Expected error code includes G001 with a non-empty hint.
  });

  it('reports G003 when CG or music source keys have no matching asset', () => {
    // gallery has cg src "missing_bg" and music src "missing_bgm".
    // Expected error codes include G003 twice.
  });

  it('reports G004 and G005 for missing replay scenes and labels', () => {
    // one text points to no_such_scene; another points to real scene "a" label "no_such_label".
  });

  it('reports G006 for unknown and argument-less unlock instructions', () => {
    // a.gal contains @unlock_music no_such_track and an argument-less @unlock_text.
  });

  it('reports G007 for valid Gallery entries with no unlock point', () => {
    // source assets and replay target exist but no matching @unlock instructions occur.
  });

  it('reports G002 for duplicate IDs inside one Gallery category', () => {
    // duplicate music IDs in an otherwise valid configuration.
  });

  it('reports G008 for a configured avatar key with no avatar asset', () => {
    // characters.aya.avatar is "missing_avatar".
  });

  it('accepts valid CG/music/text/label/unlock/avatar links and supplies hints', () => {
    // Valid fixture described immediately below.
  });
  ```

  The valid fixture must include these files:

  ```text
  content/assets/bg/room.png
  content/assets/bgm/rain.wav
  content/assets/avatar/aya.png
  content/config/gallery.json
  game.config.json
  content/scenario/a.gal
  ```

  Its gallery declares a CG using `room`, music using `rain`, and text replay `replay_a` targeting scene `a`, label `replay`. Its scene has:

  ```gal
  @scene a
  @label replay
  @unlock_cg room
  @unlock_music rain
  @unlock_text replay_a
  旁白：有效。
  ```

  The valid result must have `result.ok === true`. For every invalid fixture, assert the exact code set and that every emitted issue contains a non-empty `hint` after `lintProject()` returns.

- [ ] **Step 2: Run the new focused test and capture the red result.**

  From `E:\surdet` run:

  ```powershell
  npm exec --workspace @surdet/cli vitest -- run test/gallery-config-lint.test.ts
  ```

  Expected before implementation: failures show that requested `G001`–`G008` behavior is absent. Record the actual failing assertion(s). Do not weaken code expectations to make the missing validator appear green.

- [ ] **Step 3: Implement the smallest generic validator.**

  Implement the following behavior in `gallery-config-lint.ts`:

  1. Resolve `content/config/gallery.json`. If it does not exist, return without adding an issue; Gallery is optional for games that do not use it.
  2. Parse JSON once. A parse failure, non-object root, missing/non-array `cgs` or `music`, a supplied non-array `texts`, malformed entry, empty `id`/`name`, or illegal optional property type produces `G001` at the gallery file with line/column `0`.
  3. Build `Set<string>` asset-key indexes for `content/assets/bg`, `content/assets/bgm`, and `content/assets/avatar`. A missing directory yields an empty set; the actual broken key then receives the normal missing-reference code.
  4. For every `cgs` or `music` entry, use `key = entry.src ?? entry.id`. A supplied `src` must be a non-empty string. If the key is absent from the appropriate index, add `G003`.
  5. For every `texts` entry, require a non-empty `scene`. If it is absent from both `scenes` and `failedSceneIds`, add `G004`. If it is in `failedSceneIds`, do not add `G004`; the compiler error is already the root cause. If `label` is supplied, it must be a non-empty string and must exist in `scenes.get(scene)?.labels`; otherwise add `G005`.
  6. Track IDs independently by `cgs`, `music`, and `texts`. A duplicate inside one category adds `G002`. Duplicate words across different categories remain legal because `GalleryState` has separate collections.
  7. Scan only compiled instruction objects where `instr.op === 'instr'`. For `unlock_cg`, `unlock_music`, and `unlock_text`, require `instr.args[0]` to be a non-empty matching ID in the corresponding category. Missing/unknown IDs add `G006` at the actual instruction file/line/column.
  8. After scanning, each configured item without a matching instruction adds `G007` at the gallery file line/column `0`. Empty `cgs` creates no `G007` result.
  9. Parse `game.config.json` only to inspect the optional `characters` map. If an existing `avatar` property is empty/non-string or points at no indexed avatar file, add `G008`. Do not force every character to have an avatar; that remains a per-game editorial decision.

  In `packages/cli/src/lint.ts`, add the import:

  ```ts
  import { lintGalleryConfig } from './gallery-config-lint.js';
  ```

  Then invoke it directly before the existing hint call:

  ```ts
  lintGalleryConfig({
    root,
    scenes,
    failedSceneIds: failedScenes,
    issues,
  });

  attachHints(issues);
  ```

  Keep `lint.ts` as the composition root. Do not repeat any gallery parsing/asset logic there.

- [ ] **Step 4: Add exact repair hints.**

  Add these values to `LINT_CODE_HINTS` in `packages/core/src/lint-hints.ts` without changing unrelated hints:

  ```ts
  G001: 'gallery.json 结构非法：cgs/music 必须为数组；每项须有非空 id/name，text 须有 scene，src/label 若提供必须为非空字符串。',
  G002: 'gallery.json 同一分类内存在重复 id：保留一个唯一 ID，并让对应 @unlock_* 使用该唯一 ID。',
  G003: 'Gallery 素材键不存在：CG 的 src/id 必须对应 content/assets/bg/<key>.*，音乐必须对应 content/assets/bgm/<key>.*；改正键或在独立素材任务中导入资产。',
  G004: '文本回想目标场景不存在：把 gallery.json texts[].scene 改为 content/scenario 下真实场景 ID，或先修复该场景。',
  G005: '文本回想标签不存在：移除可选 label 以从场景开头回放，或改为目标场景真实的 @label。',
  G006: '@unlock_cg/@unlock_music/@unlock_text 没有对应的 gallery.json 条目：补齐同分类 id 或修正解锁指令参数。',
  G007: 'Gallery 条目永远不会解锁：在合适的剧情到达点加入对应 @unlock_*，或删除尚未拥有内容的条目。',
  G008: '角色头像配置无效：characters.<id>.avatar 必须是 content/assets/avatar 中真实存在的非空素材键。',
  ```

- [ ] **Step 5: Rerun the same focused test to green.**

  ```powershell
  npm exec --workspace @surdet/cli vitest -- run test/gallery-config-lint.test.ts
  ```

  Expected: all eight tests pass. The valid fixture has no error-level issue, and every emitted invalid-fixture issue has a non-empty hint.

- [ ] **Step 6: Run proportional CLI gates.**

  ```powershell
  npm run test -w @surdet/cli
  npm run typecheck -w @surdet/core
  npm run build -w @surdet/core
  npm run typecheck -w @surdet/cli
  npm run build -w @surdet/cli
  ```

  Expected: every command exits `0`. Do not run unrelated performance, Electron, packaging, or release gates.

- [ ] **Step 7: Make one focused ordinary local commit.**

  Stage only:

  ```text
  packages/cli/src/gallery-config-lint.ts
  packages/cli/src/lint.ts
  packages/cli/test/gallery-config-lint.test.ts
  packages/core/src/lint-hints.ts
  docs/superpowers/plans/2026-08-12-player-experience-wave-6-gallery-content-integrity.md
  ```

  Commit message:

  ```text
  feat(cli): validate gallery content integrity
  ```

  Record the real commit SHA, focused red/green output, and full CLI test result in the execution ledger.

---

## Task 2: Repair Zero’s declarative Gallery graph

**Files:**

- Create: `examples/zero-after-midnight/test/gallery-content-contract.test.ts`
- Modify: `examples/zero-after-midnight/game.config.json`
- Modify: `examples/zero-after-midnight/content/config/gallery.json`
- Modify: the eleven exact scenario files listed in the unlock table
- Modify: execution ledger in this plan

**Consumes:** Task 1 generic lint behavior, the approved content tables above, current BGM/scene/label inventory, and the existing public asset/avatars pipeline.

**Produces:** A Zero-only declaration graph that contains no Starter residue, unlocks only real current content, and connects the already-present `zhirao` avatar.

- [ ] **Step 1: Obtain a legal real-game red baseline after Task 1.**

  Rebuild the CLI and lint the unmodified current Zero content:

  ```powershell
  npm run build -w @surdet/cli
  npm run lint -w zero-after-midnight
  ```

  Expected: this now fails with Gallery codes because the old configuration names missing Starter sources/scenes and provides no matching unlock graph. Record the exact output. Do not delete old data first, and do not report green before this run exists.

- [ ] **Step 2: Write the Zero content contract test before changing Zero data.**

  Create `examples/zero-after-midnight/test/gallery-content-contract.test.ts`. It may read JSON and `.gal` sources from the game root, but it must not import/execute `main.ts`, Pixi, Electron, or browser APIs.

  Define the approved IDs verbatim:

  ```ts
  const MUSIC_IDS = [
    'midnight_rain', 'old_room', 'convenience_hum', 'underground_signal',
    'investigation', 'last_train', 'ending_testimony', 'ending_meeting',
    'blackout', 'ending_silence',
  ] as const;

  const TEXT_IDS = [
    'prologue', 'common_0017', 'common_apartment', 'common_convenience',
    'common_passage', 'route_testimony_station', 'route_testimony_rooftop',
    'route_meeting_train', 'route_meeting_rooftop', 'route_silence_blackout',
    'route_silence_dawn',
  ] as const;
  ```

  The test must cover these four behaviors:

  ```ts
  it('uses only the approved Zero Gallery catalogue', () => {
    expect(gallery.cgs).toEqual([]);
    expect(gallery.music.map((entry) => entry.id)).toEqual(MUSIC_IDS);
    expect(gallery.texts.map((entry) => entry.id)).toEqual(TEXT_IDS);
    expect(JSON.stringify(gallery)).not.toMatch(/castle_hall|night_field|tense_01|ch01_01|ch01_02/);
  });

  it('maps 许知遥 to the existing zhirao avatar asset', () => {
    expect(gameConfig.characters.zhirao.avatar).toBe('zhirao');
  });

  it('gives every approved Gallery item one matching unlock instruction', () => {
    expect(unlockIds.music).toEqual(new Set(MUSIC_IDS));
    expect(unlockIds.texts).toEqual(new Set(TEXT_IDS));
    expect(unlockIds.cgs).toEqual(new Set());
  });

  it('keeps every text replay destination real', () => {
    expect(textEntryById('prologue')).toMatchObject({ scene: 'prologue' });
    for (const entry of gallery.texts.filter((item) => item.id !== 'prologue')) {
      expect(sceneLabels.get(entry.scene)?.has('start')).toBe(true);
      expect(entry.label).toBe('start');
    }
  });
  ```

  Build `unlockIds` only from real full source lines that match this pattern:

  ```ts
  /^@unlock_(cg|music|text)\s+([^\s]+)\s*$/
  ```

  It must scan actual scenario files. It must not derive unlock IDs from the Gallery JSON, because that would make a dead unlock graph falsely pass.

- [ ] **Step 3: Run the Zero contract test red.**

  From `E:\surdet\examples\zero-after-midnight` run:

  ```powershell
  npx vitest run test/gallery-content-contract.test.ts
  ```

  Expected: failures show the copied catalogue, absent unlock lines, and missing avatar mapping. Record the actual red result before editing JSON or scenarios.

- [ ] **Step 4: Apply only the approved declarative changes.**

  1. Replace `gallery.json` with the exact approved JSON in this plan.
  2. Add the exact `"avatar": "zhirao"` property in the existing `characters.zhirao` object.
  3. Insert exactly the twenty-two lines in the exact locations in the unlock table.

  Do not change any pre-existing `@bgm`, `@bg`, `@fadein`, `@se`, text, choice, jump, label, or ending line. Do not add an `@unlock_cg` instruction because the approved CG array is empty.

- [ ] **Step 5: Rerun the Zero contract test to green.**

  From `E:\surdet\examples\zero-after-midnight` run:

  ```powershell
  npx vitest run test/gallery-content-contract.test.ts
  ```

  Expected: all four tests pass; there are exactly ten unique music unlock IDs, eleven unique text unlock IDs, and zero CG unlock IDs. The two `midnight_rain` source instructions remain legal because they deduplicate at GalleryState runtime.

- [ ] **Step 6: Rerun the exact command that was red.**

  From `E:\surdet` run:

  ```powershell
  npm run build -w @surdet/cli
  npm run lint -w zero-after-midnight
  ```

  Expected: lint exits `0`, reports eleven scenes, and has no `G001`–`G008` errors. Do not bypass `gallery.json`, suppress errors, loosen the validator, or exclude unlock checks to get a green result.

- [ ] **Step 7: Commit the actual game content repair.**

  Stage only:

  ```text
  examples/zero-after-midnight/test/gallery-content-contract.test.ts
  examples/zero-after-midnight/game.config.json
  examples/zero-after-midnight/content/config/gallery.json
  examples/zero-after-midnight/content/scenario/prologue.gal
  examples/zero-after-midnight/content/scenario/common_0017.gal
  examples/zero-after-midnight/content/scenario/common_apartment.gal
  examples/zero-after-midnight/content/scenario/common_convenience.gal
  examples/zero-after-midnight/content/scenario/common_passage.gal
  examples/zero-after-midnight/content/scenario/route_meeting_train.gal
  examples/zero-after-midnight/content/scenario/route_meeting_rooftop.gal
  examples/zero-after-midnight/content/scenario/route_silence_blackout.gal
  examples/zero-after-midnight/content/scenario/route_silence_dawn.gal
  examples/zero-after-midnight/content/scenario/route_testimony_station.gal
  examples/zero-after-midnight/content/scenario/route_testimony_rooftop.gal
  ```

  Commit message:

  ```text
  feat(zero): wire valid gallery content
  ```

  Record the actual SHA, all test red/green output, and exact changed path list in the execution ledger.

---

## Task 3: Run proportional consumer checks and hand off for visual review

**Files:**

- Create: `docs/ENGINE-PLAYER-EXPERIENCE-WAVE-6-GALLERY-CONTENT-INTEGRITY-DELIVERY-REPORT-2026-08-12.md`
- Modify: this plan’s execution ledger

**Consumes:** Task 1 and Task 2 commits, their fresh command outputs, and final on-disk files.

**Produces:** Factual documentation plus a local `WAITING_FOR_REVIEW` stop. It does not produce a push, deployment, EXE, release, performance artifact, or new player automation runner.

- [ ] **Step 1: Run the proportional final verification set.**

  From `E:\surdet`, in this order:

  ```powershell
  npm run test -w @surdet/cli
  npm run typecheck -w @surdet/core
  npm run build -w @surdet/core
  npm run typecheck -w @surdet/cli
  npm run build -w @surdet/cli
  npm run lint -w surdet-starter
  npm run lint -w zero-after-midnight
  npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000
  node examples/zero-after-midnight/scripts/check-assets.mjs
  npm run typecheck -w zero-after-midnight
  npm run build -w zero-after-midnight
  ```

  Expected final Zero facts remain:

  ```text
  scenes = 11
  choice branches = 23/23
  endings = 3
  project assets = 44
  lint errors = 0
  lint warnings = 0
  simulate runtime errors = 0
  ```

  `npm run verify:all` is deliberately not required. Do not use a heavyweight whole-repository gate or Electron screenshot matrix as a substitute for the targeted CLI and Zero checks above.

- [ ] **Step 2: Assert final data directly.**

  Run:

  ```powershell
  rg -n "castle_hall|night_field|tense_01|ch01_01|ch01_02" examples/zero-after-midnight/game.config.json examples/zero-after-midnight/content/config examples/zero-after-midnight/content/scenario
  rg -n --glob '*.gal' '^@unlock_(cg|music|text)\s+' examples/zero-after-midnight/content/scenario
  Get-FileHash examples/zero-after-midnight/content/assets/avatar/zhirao.png -Algorithm SHA256
  ```

  Expected:

  - first command returns no matches;
  - second command shows twenty-two lines: eleven text unlocks and eleven music instructions, with `midnight_rain` appearing twice; no CG unlock occurs;
  - `avatar/zhirao.png` exists and is only read, never modified.

- [ ] **Step 3: Verify diff scope and hygiene.**

  Use the exact Task 0 starting SHA rather than a guessed one:

  ```powershell
  git diff --name-status <TASK_START_HEAD>..HEAD
  git diff --check
  git ls-files '*.log'
  git status --short
  git rev-list --left-right --count HEAD...surdet/main
  ```

  Before report/plan commit, only Task 1/Task 2 locked source files may appear. After the document commit, only this plan and the delivery report may be added. Any other tracked source, asset, baseline, release, or unapproved file is a stop condition.

- [ ] **Step 4: Write the delivery report from disk, not memory.**

  The delivery report must contain these sections:

  1. Conclusion and scope.
  2. Player value: no wrong-game Gallery entries, content unlocks as its real source scene is entered, and the existing avatar pipeline receives its configured key.
  3. Generic tooling landing point: `@surdet/cli` owns `G001`–`G008`; this is not a Zero-only regex patch.
  4. Exact Zero mapping: ten music IDs, eleven text IDs, intentional empty CG array, exact `zhirao` avatar key.
  5. Red-to-green evidence: Task 1 focused fixture test, Task 2 real Zero lint, Task 2 game contract test.
  6. Actual command table: each Task 3 command and genuine exit result. Do not describe a merely planned/historical command as fresh evidence.
  7. Preserved game facts: only record 11 scenes, 23/23 branches, 3 endings, 44 assets, and zero runtime errors when current commands actually show them.
  8. Intentional exclusions: no CG source assets, no audio replacement, no art migration, no performance work, and no documentation reorganization.
  9. The exact manual player checklist in the next plan section.
  10. Git facts: start SHA, source commits, final SHA, ahead/behind, status, and explicit no-push/no-deploy/no-package statement.

  Re-read the final Markdown report from disk, calculate byte length and SHA-256, and write those exact values into the final summary only after no further report edit is planned.

- [ ] **Step 5: Commit report and ledger, then stop.**

  Stage only:

  ```text
  docs/ENGINE-PLAYER-EXPERIENCE-WAVE-6-GALLERY-CONTENT-INTEGRITY-DELIVERY-REPORT-2026-08-12.md
  docs/superpowers/plans/2026-08-12-player-experience-wave-6-gallery-content-integrity.md
  ```

  Commit message:

  ```text
  docs(engine): record wave 6 gallery integrity
  ```

  After the documentation commit, rerun only:

  ```powershell
  git diff --check
  git ls-files '*.log'
  git status --short
  git rev-parse HEAD
  git rev-list --left-right --count HEAD...surdet/main
  ```

  Do not push, deploy, package, or begin the next topic. Stop at `WAITING_FOR_REVIEW`.

---

## Manual player validation after a separately authorized deployment

This section is **not** an instruction to deploy. The executor must stop after Task 3. Only after the general manager has reviewed the local result, approved a normal push, and separately authorized a development deployment should the player be asked to run this checklist.

The player does not need to count frames, inspect debug data, or provide screenshots unless a failure occurs. The useful report format is simply: “item number + what happened + whether an error dialog appeared.”

### Preconditions

1. Confirm the deployed window title is `零点之后 / AFTER MIDNIGHT`.
2. Confirm the application loads `E:\surdet\examples\zero-after-midnight\dist`, not the Starter game.
3. Begin a genuinely new game once. Do not load a pre-Wave-6 save while checking the first four items, because old saves can legitimately preserve an earlier Gallery unlock state.

### Player checklist

1. **Opening Gallery from the title.** On the title screen, open 鉴赏. The three tabs and the close action must remain responsive. No historical entries named `大厅重逢`, `夜路同行`, `紧张时刻`, `大厅初遇`, or `夜路同行` may be shown.
2. **First scene unlock.** Advance through the opening scene normally. Open the in-game Gallery. The text list should include `午夜来电`; the music list should include `午夜雨声`. Selecting either should open/play its matching real Zero content without an error dialog, freeze, or unexpected title return.
3. **Real title names, not borrowed Starter names.** Continue into the common route until the new scene is visibly entered. Reopen Gallery and confirm that the available text/music names describe `零点之后` locations or story moments, such as `红色笔记`, `雨夜便利店`, `地下通道`, `旧屋`, or `便利店白噪`; none may point to nonexistent `ch01_01`/`ch01_02` content.
4. **Text replay source.** Choose an unlocked text entry. It must restart the corresponding existing scene rather than report a missing scene/label. Return normally and verify the ordinary game session remains usable.
5. **Avatar wiring.** Reach a line spoken by 许知遥. Her existing avatar should appear through the normal dialogue portrait/avatar area when the current presentation design calls for it. This is a configuration connection check, not a request to redraw or replace art.
6. **No fabricated CG expectation.** The CG tab may be empty in this wave. An empty CG tab is correct because the project has no approved dedicated CG assets. It must remain stable and closable; it must not show placeholder Castle/field images or broken-image output.
7. **Regression spot check.** Briefly verify the previously approved Wave 5B player-facing changes remain intact: choice buttons remain visually centered, the Backlog title is readable in white, and the command rail/continue indicator do not overlap.

### What is a failure

Report any one of these as a failure and do not attempt an improvised fix:

- a Gallery tab or close button becomes nonresponsive;
- a title or list item refers to a nonexistent scene, asset, or obvious Starter content;
- selecting valid unlocked music/text produces a Renderer error, blank page, black screen, stuck UI, or unexpected window close;
- a valid Zero asset fails to play or a valid text replay fails to enter its target scene;
- 许知遥 has a configured avatar key but the avatar source is visibly broken;
- any Wave 5B regression appears.

An intentionally empty CG list is **not** a failure. Creating CG art, changing story content, and replacing programmatic audio are all outside Wave 6.

---

## Stop conditions and escalation rules

The executor must stop and report the concrete blocker instead of widening this wave if any of the following occurs.

| Condition | Required response |
|---|---|
| The current HEAD is not clean apart from the five protected untracked files plus this approved Wave 6 plan. | Do not clean, reset, stash, delete, move, stage, or overwrite another person's work. Report exact `git status --short` output. |
| `AGENTS.md` is absent or its contents materially conflict with this plan. | Stop and ask the general manager; do not silently select a policy. |
| A needed generic Gallery rule requires a Core/Renderer runtime API, save schema change, migration, compatibility layer, fallback, dependency, or new configuration layer. | Stop. This plan authorizes only the CLI lint, its hints/tests, and current game content configuration. |
| The real Zero content cannot satisfy the proposed 10 music / 11 text mapping because a source file, scene, label, or asset does not exist. | Do not invent a file, reuse a Starter asset, or weaken validation. Report a compact mismatch table. |
| Adding the explicit `@unlock_*` directives changes branching, ending reachability, state variables, save schema, or simulated story behavior. | Revert only the current Wave 6 in-progress change by a non-destructive edit, retain diagnostic evidence, and stop for review. |
| The generic CLI test cannot be written using the repository's existing test tooling. | Stop with the observed test-harness limitation; do not add packages or a parallel lint framework. |
| Starter's own valid Gallery configuration fails under the generic linter. | First determine whether the linter is wrong or Starter content is actually invalid. Do not add a Zero-specific exemption. Report the comparison. |
| Any focused gate, lint, typecheck, build, simulation, asset check, or diff check fails after a production/content modification. | Do not mark the wave completed. Preserve output, identify the earliest failure, and stop unless the failure is demonstrably caused by the current scoped edit and a direct minimal correction is available. |
| A requirement conflicts with the actual runtime behavior of the existing Gallery system. | Gather a small reproducer or focused source trace, then stop. Do not speculate or alter unrelated Player UI/rollback code. |

The following are never valid ways to get a green result:

- raising or deleting a lint condition;
- excluding Zero from `surdet lint`;
- making missing Gallery assets silently disappear at runtime;
- adding a compatibility alias for `castle_hall`, `night_field`, `ch01_01`, `ch01_02`, or `tense_01`;
- editing a baseline, performance gate, or historic artifact;
- re-running until an arbitrary desired result occurs;
- turning off a test because an old Starter-derived file fails it.

---

## Required final state

The final report may use the following statuses only when the corresponding evidence exists:

```text
PLAYER_EXPERIENCE_WAVE_6_GALLERY_CONTENT_INTEGRITY_IMPLEMENTED
CLI_GALLERY_CONTRACT_VALIDATION_VERIFIED
ZERO_GALLERY_STARTER_RESIDUE_REMOVED
ZERO_GALLERY_UNLOCK_GRAPH_VERIFIED
ZHIRAO_AVATAR_CONFIGURATION_VERIFIED
NO_CG_ASSETS_FABRICATED
NO_AUDIO_ASSETS_CHANGED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
NOT_DEPLOYED
WAITING_FOR_REVIEW
```

It must **not** claim that visual player validation is complete. At the Task 3 stop point, the correct statement is that automated content integrity checks are complete and the precise manual checklist is ready for a separately approved deployment.

---

## Execution ledger template

The executor must update this section as work happens. Do not overwrite the planned requirements above; append factual results below each item.

### Task 0 — baseline

- Start timestamp: `2026-08-13T11:47:47.828+08:00` (Asia/Shanghai).
- `git rev-parse HEAD`: `7fb3cdef7551225c11ce96f19663ada205d10e82`.
- `git rev-list --left-right --count HEAD...surdet/main`: `0 0`.
- Initial `git status --short`:
  - `?? AGENTS.md`
  - `?? SESSION-HANDOFF.md`
  - `?? USER.md`
  - `?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
  - `?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`
  - `?? docs/superpowers/plans/2026-08-12-player-experience-wave-6-gallery-content-integrity.md`
- `AGENTS.md` read at: `2026-08-13` before baseline; Wave 5B delivery report, this plan, CLI lint source/test, Zero game/gallery config, and `check-assets.mjs` read in the task-book order.
- Baseline `npm run build -w @surdet/core`: exit `0` (`tsc -p tsconfig.build.json`).
- Baseline `npm run build -w @surdet/cli`: exit `0` (`tsc -p tsconfig.build.json`).
- Baseline `npm run lint -w zero-after-midnight`: exit `0`; `11` scenes, `0` errors, `0` warnings. This is the pre-Task-1 tool gap: the old lint does not inspect the incorrect Gallery graph.
- Baseline `node examples/zero-after-midnight/scripts/check-assets.mjs`: exit `0`; `assets ok: 44`.
- Baseline `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000`: exit `0`; `11` scenes, `23/23` choice branches, `3` endings, runtime errors `0`.
- Baseline `npm run test -w @surdet/cli`: exit `0`; `7` files / `87` tests passed.
- Baseline `git diff --check`: exit `0`.
- Baseline `git ls-files '*.log'`: empty.
- Baseline inventory: `10` BGM stems (`blackout`, `convenience_hum`, `ending_meeting`, `ending_silence`, `ending_testimony`, `investigation`, `last_train`, `midnight_rain`, `old_room`, `underground_signal`), `11` scenario files, and the expected `@label start`/`@bgm` inventory. Current `gallery.json` still contains Starter residue `castle_hall`, `night_field`, `tense_01`, `ch01_01`, and `ch01_02`; no conflict with the locked Wave 6 repair was found.

### Task 1 — generic CLI Gallery lint

- Red focused test command/result: `npm exec --workspace @surdet/cli vitest -- run test/gallery-config-lint.test.ts` exit `1`; `8` tests, `7` failed because the pre-existing lint emitted no `G001`–`G008` issues. The valid fixture passed, confirming the red result was the missing generic behavior.
- New issue codes and exact triggering fixtures: `G001` malformed/structurally invalid JSON and entry fields; `G002` duplicate music ID; `G003` missing `bg`/`bgm` source stems; `G004` missing text replay scene; `G005` missing replay label; `G006` unknown and argument-less `@unlock_*`; `G007` configured CG/music/text without an unlock; `G008` explicit missing avatar key. Every invalid fixture also asserts a non-empty hint.
- Green focused test command/result: `npm exec --workspace @surdet/cli vitest -- run test/gallery-config-lint.test.ts` exit `0`; `1` file / `8` tests passed.
- CLI proportional gates: `npm run test -w @surdet/cli` exit `0` (`8` files / `95` tests); `npm run typecheck -w @surdet/core` exit `0`; `npm run build -w @surdet/core` exit `0`; `npm run typecheck -w @surdet/cli` first exit `1` on optional `unknown` `src/label` narrowing, then exit `0` after the minimal explicit narrowing; `npm run build -w @surdet/cli` exit `0`.
- Starter lint result: `npm run lint -w surdet-starter` exit `1`; the existing Starter Gallery declares music `tense_01`, but `examples/starter/content/assets/bgm` is absent and no matching BGM file exists. CG sources (`castle_hall`, `night_field`) and text scenes exist. This is a pre-existing invalid Starter declaration, not a linter false positive; no Starter exemption or edit was added.
- Zero lint result before Task 2 (must be red because of real current configuration): `npm run lint -w zero-after-midnight` exit `1`; `12` errors covering Starter CG/music residue, missing `ch01_01`/`ch01_02` text scenes/labels, and all five configured entries lacking matching unlocks.
- Commit SHA/message: to be filled with the real SHA immediately after the focused Task 1 commit; message `feat(cli): validate gallery content integrity`.
- Changed paths: `packages/cli/src/gallery-config-lint.ts`, `packages/cli/src/lint.ts`, `packages/cli/test/gallery-config-lint.test.ts`, `packages/core/src/lint-hints.ts`, and this plan’s execution ledger only.

### Task 2 — Zero content repair

- Exact `gallery.json` validation result:
- Exact eleven text unlock sources:
- Exact eleven music unlock sources:
- Game contract test result:
- Zero lint result after Task 2:
- Zero simulate result:
- Commit SHA/message:
- Changed paths:

### Task 3 — verification and hand-off

- Every final command with real exit result:
- Delivery-report byte length:
- Delivery-report SHA-256:
- Final plan byte length:
- Final plan SHA-256:
- Report/ledger commit SHA/message:
- Final `git rev-parse HEAD`:
- Final `HEAD...surdet/main`:
- Final `git status --short`:
- Explicit stop statement: `WAITING_FOR_REVIEW`.

---

## Plan self-review checklist for the executor

Before claiming this task book is complete, check every statement below against the actual diff and command output:

- [ ] The implementation works at the generic `@surdet/cli` lint boundary; it is not a Zero-only check hidden in a content script.
- [ ] `G001`–`G008` have a code, machine-readable location, and a useful core hint.
- [ ] The linter derives asset stems from the filesystem and does not hard-code a `.png`, `.wav`, or `.mp3` extension.
- [ ] The linter tolerates an optional missing avatar configuration, but rejects an explicit broken avatar key.
- [ ] The empty CG list is represented as `[]`; no fake `cg` asset or placeholder source was created.
- [ ] Every configured music/text ID has exactly one corresponding appropriate unlock instruction somewhere in the actual Zero scenarios, except that `midnight_rain` deliberately has two source scenes and must still be valid under idempotent unlock semantics.
- [ ] No scene, label, BGM asset, Gallery field, avatar image, art, or audio asset was invented or renamed merely to make the check pass.
- [ ] The old Starter residue names have no remaining references in Zero's runtime configuration or scenario content.
- [ ] All code/content edits are covered by focused red-to-green evidence before the final consumer checks.
- [ ] No shell/Electron visual runner, new screenshot collection, bulk performance test, artifact rewrite, or documentation reorganization was added.
- [ ] The final reports distinguish fresh commands from prior historical evidence.
- [ ] No protected untracked file was touched.
- [ ] The branch was not pushed, deployed, packaged, or released.

When every applicable box is true, the only permitted conclusion is local implementation readiness and a request for independent review. The general manager decides whether to authorize a normal push and the later manual deployment.
