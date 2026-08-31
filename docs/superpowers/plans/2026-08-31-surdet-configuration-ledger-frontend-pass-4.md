# Surdet Configuration Ledger — Frontend Pass 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: execute this plan task-by-task with permanent RED -> minimal GREEN evidence. This taskbook is subordinate to the approved full-frontend specification and does not authorize mainline Wave 7.

**Goal:** 把 Surdet 配置页从旧卡片长页迁移为中文优先的配置台账工作区，在不改变任何配置格式、保存语义或业务真相的前提下，让八类配置可定位、可编辑、可下钻并在真实浏览器中稳定工作。

**Architecture:** 保留 `config.ts` 的行模型、独立历史、现有保存函数和 `config-edit.ts` 纯逻辑；只新增一层配置工作区编排：左侧配置目录、中央单一活动台账、默认隐藏的技术名称和独立地图舞台。日历地图只把视觉属性迁移为语义 class/token，不重写几何、拖拽、连线或历史回调。

**Tech Stack:** TypeScript 命令式 DOM、CSS、Vite 6、Vitest 3、Playwright/Chromium E2E、现有 fake File System Access 支持；不新增依赖，不修改 lockfile。

## Global Constraints

- 权威设计：`docs/superpowers/specs/2026-08-30-surdet-frontend-editorial-workbench-redesign-design.md`。
- 总体计划：`docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md` 的 Frontend Pass 4。
- 仅允许修改 `packages/editor` 前端和测试，以及本任务书与总体计划的 append-only Ledger。
- 禁止修改 `packages/authoring`、`packages/core`、`packages/cli`、Renderer、Host、Shell、公共 schema、配置格式、文件写入语义、Starter、依赖和 lockfile。
- 保留角色 `character.ensure` 路径、配置独立 undo/redo、所有现有 parse/serialize/validation/save hooks、地图拖拽和 requires 增删语义。
- `config-edit.ts` 本轮只读；除非永久 RED 证明显示投影无法在 `config.ts` 完成，否则不得改动其转换或校验语义。
- 普通界面中文优先；文件名、JSON key 和内部 ID 默认隐藏在“技术名称”下钻中。
- 禁止 `.cfg-section` 卡片壳、标题蓝色底线、阴影、彩色左竖线、渐变、胶囊、Bento、浮空保存按钮和无意义副标题。
- 新 CSS 只使用 `--surdet-*` token；配置页不得新增裸视觉颜色。
- 日历地图视觉通过 class 和配置组件 token 表达；透明命中线可以继续使用无可见度的实现色，但不得成为可见主题色。
- 表格在自身容器内横向滚动；页面本身在 800px 与 200% 缩放下不得产生横向溢出。
- 人工服务固定使用 4175；自动 runner 使用 4260–4269 严格端口，禁止占用 4173。
- 浏览器 artifact 写入 `%TEMP%\surdet-config-ledger-pass-4-*`，不得进入仓库。
- 精确暂存；禁止 `git add .`、`git add -A`、reset、rebase、amend、force push。
- 本轮未授权 push，也不启动 Frontend Pass 5 或主线 Wave 7。

## Confirmed Pre-existing Boundaries

以下是只读审计确认、但不在本视觉迁移中偷偷修复的既有问题：

1. 离开配置页再返回会重新读盘，可能丢失尚未按区段保存的内存编辑；
2. 普通 `content/config/*.json` 保存没有磁盘外部修改冲突保护；
3. 部分配置保存固定写 LF，未建立逐文件 EOL 身份；
4. 顶栏“保存全部”不等价于保存所有配置区段；
5. 部分 JSON/数字/引用校验仍弱于角色共享事务路径。

本轮浏览器和文档不得把上述边界写成已解决。若视觉改造需要改变这些语义，立即停止并拆分 `CONFIG_PERSISTENCE_RELIABILITY` 独立任务。

---

## Task 0: Freeze Baseline and Open the Ledger

**Files:**
- Create: `docs/superpowers/plans/2026-08-31-surdet-configuration-ledger-frontend-pass-4.md`
- Modify: `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`

**Interfaces:**
- Consumes: approved frontend redesign design and current `main` HEAD.
- Produces: exact Pass 4 scope, gates, stop rules and append-only evidence ledger.

- [x] **Step 1: Record Git identity and protected state**

Run:

```powershell
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count surdet/main...HEAD
git status --short
```

Expected: branch `main`; tracked worktree/staging clean; existing protected and unrelated paths remain untracked.

- [x] **Step 2: Run the focused configuration baseline**

Run:

```powershell
npm run test -w surdet-editor -- --run test/config-edit.test.ts test/calendar-map.test.ts test/project-config-display.test.ts test/terminology-import.test.ts
npm run typecheck -w surdet-editor
```

Expected: current focused config contracts and typecheck pass before DOM/CSS changes.

- [x] **Step 3: Commit the taskbook only**

Stage exactly the two documentation paths and commit:

```powershell
git commit -m "docs(editor): plan configuration ledger pass 4"
```

---

## Task 1: Permanent Configuration Workspace RED

**Files:**
- Create: `packages/editor/test/editor-config-workspace-contract.test.ts`
- Read only: `packages/editor/src/panels/config.ts`
- Read only: `packages/editor/src/panels/calendar-map.ts`
- Read only: `packages/editor/src/styles.css`
- Read only: `packages/editor/index.html`

**Interfaces:**
- Consumes: existing config DOM source and approved design tokens.
- Produces: fail-closed static contracts for the new workspace structure and legacy-visual exit.

- [x] **Step 1: Write source-level RED contracts**

The new test must require all of the following:

```text
data-editor-panel="config"
data-editor-region="config-workbench"
data-config-section for all eight section ids
aria-current="page" section navigation
one active ledger section at a time
default-hidden .config-technical-key
normal-flow .config-actions
config-workspace.css linked after timeline-workspace.css
calendar map semantic classes instead of visible hex attributes
```

It must also reject configuration DOM use of `.cfg-section`, colored title rules, inline visible map colors, fixed/sticky floating primary actions and config-scoped `box-shadow`.

- [x] **Step 2: Run the RED**

Run:

```powershell
npm run test -w surdet-editor -- --run test/editor-config-workspace-contract.test.ts
```

Expected: fail only on missing Pass 4 contracts; preserve the exact output in the Ledger.

---

## Task 2: Configuration Workspace Topology

**Files:**
- Modify: `packages/editor/src/panels/config.ts`
- Test: `packages/editor/test/editor-config-workspace-contract.test.ts`

**Interfaces:**
- Consumes: existing eight `render*Section()` functions and module-level row caches.
- Produces: `ConfigSectionId`, section metadata, stable local selection and one active ledger surface.

- [x] **Step 1: Add stable section metadata**

Use this exact ordered identity set:

```ts
type ConfigSectionId =
  | 'characters'
  | 'variables'
  | 'achievements'
  | 'calendar'
  | 'growth'
  | 'events'
  | 'gallery'
  | 'terminology';
```

Each descriptor contains Chinese `label`, plain-language `description`, source `file`, and renderer callback. Display labels must be:

```text
角色 / 变量 / 成就 / 日历与地图 / 角色成长 / 事件 / 鉴赏 / 名词表
```

- [x] **Step 2: Build the workspace shell without duplicating state**

`renderConfig()` still performs the existing source refresh. After refresh it calls a new internal workspace renderer that creates:

```html
<div class="config-workspace" data-editor-panel="config" data-editor-region="config-workbench">
  <nav class="config-index" aria-label="配置目录">…</nav>
  <main class="config-ledger" aria-live="polite">…</main>
</div>
```

The selected `ConfigSectionId` is module-local display state. Clicking the directory changes only the visible section; it must not refresh disk, clear history or reconstruct business row models.

- [x] **Step 3: Preserve rerender identity**

`rerenderConfig()` rebuilds the workspace from existing cached rows and retains the selected section. Undo, redo, add row, delete row and map edits must remain in the current section.

- [x] **Step 4: Run focused GREEN**

Run the workspace contract, config logic and calendar-map tests. Expected: all pass.

---

## Task 3: Human-facing Ledger Sections and Technical Disclosure

**Files:**
- Modify: `packages/editor/src/panels/config.ts`
- Test: `packages/editor/test/editor-config-workspace-contract.test.ts`
- Test: `packages/editor/test/terminology-import.test.ts`

**Interfaces:**
- Consumes: existing row arrays, `ColDef`, scalar descriptors and save callbacks.
- Produces: Chinese section headers, readable fields, table scroll regions and optional technical-name projection.

- [x] **Step 1: Replace the old section shell**

`sectionShell()` receives section metadata and returns a semantic `<section class="config-ledger-section">` with:

- one Chinese `h1`;
- one practical description;
- a `<details class="config-technical">` containing source file and technical keys;
- a normal-flow `.config-actions` region at the end.

No decorative subtitle, colored rail or card wrapper is permitted.

- [x] **Step 2: Separate human labels from technical keys**

Extend presentation-only field descriptors with `technicalKey`. Visible labels use Chinese task language. `.config-technical-key` is hidden by default and exposed only by the section-level “显示技术名称” control. Inputs retain exact underlying row keys.

- [x] **Step 3: Normalize table and empty-state structure**

Every editable table uses:

```html
<div class="config-table-scroll" tabindex="0" aria-label="…数据表">
  <table class="config-table">…</table>
</div>
```

Delete buttons use the visible text `删除` with a row-specific accessible label. Add actions name the object (`新增变量`, `新增成就`, `新增节点`) rather than generic `新增行` where the section is known.

- [x] **Step 4: Preserve all existing callbacks**

Do not change `pushConfigHistory`, rows-to-JSON conversion, `saveCharacters`, `saveVariables`, `saveAchievements`, import/export or per-section save behavior.

- [x] **Step 5: Run focused GREEN**

Run workspace, config-edit, project-config-display and terminology-import tests. Expected: all pass.

---

## Task 4: Full-size Calendar Map Theme Hooks

**Files:**
- Modify: `packages/editor/src/panels/calendar-map.ts`
- Modify: `packages/editor/src/panels/config.ts`
- Test: `packages/editor/test/calendar-map.test.ts`
- Test: `packages/editor/test/editor-config-workspace-contract.test.ts`

**Interfaces:**
- Consumes: current map geometry, pointer capture, overlap set and history hooks.
- Produces: semantic SVG classes, accessible map description and a dedicated map stage.

- [x] **Step 1: Replace visible inline colors with classes**

Use these class hooks without changing geometry:

```text
config-map-edge
config-map-edge-hit
config-map-edge-preview
config-map-node
config-map-node-base
config-map-node-overlap
config-map-node-label
config-map-node-meta
config-map-node-port
```

The invisible hit target remains transparent. Arrow marker and visible paths receive semantic classes.

- [x] **Step 2: Add accessible map semantics**

The SVG receives `role="img"` and a Chinese `aria-label`. Each node group receives a readable `aria-label` containing name, ID, coordinates and base status. The editable table remains the keyboard alternative; do not invent keyboard drag behavior in this pass.

- [x] **Step 3: Promote the map stage**

Calendar rendering places the map in `.config-map-stage` before technical node/base-command tables. Node and command tables live in a `<details>` named `节点与指令明细`; it opens automatically when no nodes exist.

- [x] **Step 4: Run focused GREEN**

Run map and workspace contracts. Existing drag/requires/overlap pure tests must remain green.

---

## Task 5: Configuration-specific Visual System

**Files:**
- Create: `packages/editor/src/styles/config-workspace.css`
- Modify: `packages/editor/index.html`
- Modify: `packages/editor/src/styles.css`
- Test: `packages/editor/test/editor-config-workspace-contract.test.ts`

**Interfaces:**
- Consumes: approved `--surdet-*` semantic tokens and new DOM hooks.
- Produces: configuration-only layout, typography, tables, focus, map and responsive rules.

- [x] **Step 1: Link the stylesheet**

Add `/src/styles/config-workspace.css` after `timeline-workspace.css` in `index.html`.

- [x] **Step 2: Implement the desktop ledger**

At wide width use a 220–248px directory and a flexible main ledger. The directory is a flat document index separated by rules, not cards. The active item uses a full outline/surface plus `aria-current`, never a colored left rail.

- [x] **Step 3: Implement fields and tables**

Use 8/12/16/24/32 spacing, 0/2/4px radii, no shadows. Tables have sticky headers only inside their scroll container. Long labels wrap; JSON/ID columns use the mono token only when technical names are shown.

- [x] **Step 4: Implement the map stage**

The calendar canvas uses a minimum 420px desktop height and semantic component tokens derived from approved surface/border/action/state tokens. Overlap uses border shape plus warning text, not color alone.

- [x] **Step 5: Implement responsive behavior**

At `max-width: 800px`, the directory becomes a horizontally scrollable tablist above the ledger. Tables retain local horizontal scrolling. At 200% zoom, project navigation, section selection, inputs and save actions remain reachable without page-level horizontal overflow.

- [x] **Step 6: Remove only migrated legacy rules**

Delete config-specific `.cfg-section`, `.cfg-ops`, `.cfg-scalars`, `.cfg-scalar` and `.calendar-map-wrap` visual rules from `styles.css`. Do not remove global `.cfg-table` yet because the statistics page still consumes it.

- [x] **Step 7: Run CSS/DOM GREEN and build**

Run workspace contract, typecheck and Editor build. Expected: no missing stylesheet or selector contract.

---

## Task 6: Owner Browser Acceptance

**Files:**
- No repository file is created by this task.
- Use the dedicated local Editor service on port 4175.

**Interfaces:**
- Consumes: focused automated contracts, typecheck/build and the real Starter opened through the browser picker.
- Produces: Owner-reported visual and interaction facts only; it does not replace automated source, type or build gates.

The original draft proposed a dedicated 22-node Playwright runner. The Owner explicitly chose to perform the browser acceptance personally. Because this is a B-level frontend presentation change rather than a public-state or persistence-contract change, this plan accepts focused automated contracts plus Owner visual acceptance and removes the unimplemented runner contract instead of leaving a permanent red test or manufacturing a second browser framework.

- [ ] **Step 1: Inspect the wide configuration workbench**

Open the real Starter, enter `配置`, and confirm eight Chinese sections, one active section, normal-flow actions, default-hidden technical names and no colored rails, decorative outer rules or legacy stacked cards.

- [ ] **Step 2: Inspect the compact layout**

Narrow the window and confirm the section directory becomes a horizontal local scroller, tables scroll inside their own region, and the page does not gain a global horizontal scrollbar.

- [ ] **Step 3: Inspect the calendar map and reversible interaction**

Confirm the map remains readable and use drag plus undo/redo without saving. The Owner must not write to the original Starter during visual acceptance.

- [ ] **Step 4: Record only the Owner's actual verdict**

Do not infer acceptance from screenshots or automated tests. Record `PASS`, `NEEDS_FIX` or the exact observed issue.

---

## Task 7: Full Gates, Code Evidence and FORMAL

**Files:**
- Modify: this taskbook append-only Ledger
- Modify: overall redesign plan append-only Ledger

**Interfaces:**
- Consumes: completed Tasks 1–6 and clean exact scope.
- Produces: one exact local code-evidence commit and a reviewable local stop.

- [x] **Step 1: Run fresh technical gates**

```powershell
npm run test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
npm run verify:docs
git diff --check
git diff --cached --check
```

Expected: all pass; the existing Vite chunk warning may remain but no new error is accepted.

- [ ] **Step 2: Exact freeze**

Stage only declared Pass 4 production/tests/taskbook paths, verify missing/extra sets are zero, and commit with:

```text
feat(editor): rebuild configuration ledger
```

Set the exact commit as `CODE_EVIDENCE_HEAD`. Tracked worktree and staging must be clean before FORMAL.

- [ ] **Step 3: Stop for independent review**

Append exact files, tests, Owner-reported facts, known limitations and Git state. Do not push or start Pass 5.

---

## Execution Ledger

### 2026-08-31 — Initialization

- Status: `BASELINE_PASSED_READY_FOR_PLAN_COMMIT`.
- Base HEAD and live remote: `bca72247d0dc76983330367be0f38043036a0fca`; ahead/behind `0/0` before the taskbook edit.
- Focused configuration baseline: 4 files / 51 tests PASS. Editor typecheck and `verify:docs` PASS. Both diff checks PASS.
- Owner instruction: continue locally without waiting for the remote reviewer.
- Approved design reused; no new visual direction invented.
- Pre-existing persistence limitations are recorded above and remain outside this visual migration unless separately authorized.

```text
FRONTEND_PASS_4 = BASELINE_PASSED_READY_FOR_PLAN_COMMIT
PUSH = NOT_AUTHORIZED
FRONTEND_PASS_5 = NOT_STARTED
MAINLINE_WAVE_7 = NOT_STARTED
```

### 2026-08-31 — Configuration Ledger implementation and proportional gates

**CONFIRMED_FACTS**

- Taskbook and overall-plan initialization were committed as `611ec8fb8517eba9e0662356ef7f945892fe9307` (`docs(editor): plan configuration ledger pass 4`).
- Permanent workspace RED initially failed 5/5 on the missing configuration-workbench topology, Chinese section projection, technical disclosure, semantic calendar-map hooks and scoped responsive CSS. The final focused set passed 5 files / 56 tests.
- The production implementation remains Editor-only: eight-section local display state, one active ledger, Chinese-first labels, default-hidden technical keys, local table scrolling, normal-flow actions and a full-size calendar map with semantic SVG classes. Existing config row caches, conversion, history, validation and save callbacks remain the only business paths.
- Owner browser review confirmed that the colored left rail was gone and identified a decorative 2px top rule as the same motif moved to another edge. The rule was removed, the ledger surface made transparent, and the permanent CSS contract now rejects decorative outer borders on `.config-ledger-section`.
- Owner then chose to perform browser acceptance personally. The unimplemented 22-node runner contract was removed before freeze; it is not represented as passing evidence and no browser artifact was fabricated. A transient contract invocation failed only because its runner file did not exist, before this gate correction.
- Fresh proportional gates passed: Editor 52 files / 377 tests, Editor typecheck, Editor build (908 modules), `verify:docs`, `git diff --check` and cached diff check. The existing Vite `>500 kB` chunk warning remains a warning, not a new failure.
- Independent remote review of `bca72247d0dc76983330367be0f38043036a0fca` was received during implementation. Read-only local/network checks confirmed its CI portability failure, review-receipt cross-context race and same-file/different-timeline-ID recovery gap. These are separate review storage, CI and recovery themes; none is silently mixed into this frontend commit.

**OWNER EVIDENCE BOUNDARY**

- Wide-layout first review is `NEEDS_RECHECK_AFTER_TOP_RULE_REMOVAL`, not PASS.
- Compact layout, calendar drag/undo and final visual hierarchy verdict have not yet been explicitly accepted by the Owner.
- No save action was requested during Owner visual review; the original Starter was not intentionally written by this pass.

```text
FRONTEND_PASS_4_TECHNICAL_GATES = PASSED
OWNER_VISUAL_ACCEPTANCE = NEEDS_RECHECK_AFTER_TOP_RULE_REMOVAL
REMOTE_AUDIT_REMEDIATION = RECORDED_NOT_STARTED
PUSH = NOT_AUTHORIZED
FRONTEND_PASS_5 = NOT_STARTED
MAINLINE_WAVE_7 = NOT_STARTED
```
