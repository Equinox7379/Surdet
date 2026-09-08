# Surdet Frontend Editorial Workbench Redesign Implementation Plan

> 2026-09-08 当前执行依据：Owner 批准的 Frontend Pass 10 施工包与本机 AGENTS。主代理完成施工，未参与实现的 `luna_worker` 独立复核；允许正常 commit、普通 push 和同 Goal CI 闭合。历史逐波停工/push 门不覆盖本轮持续授权。

**Goal:** 在不修改 Surdet 业务真相、项目格式、存档、Agent Port 或后端语义的前提下，把 Editor 九个主模式与 Renderer 玩家界面逐波迁移为“创作优先版本案卷”，彻底退出旧 Mirror’s Edge/卡片化/AI 模板视觉，并保持所有现有功能可达、可读、可测试。

**Architecture:** 保留现有单例状态、业务 hooks、Panel renderer、RendererTheme 与 Host/Shell 消费边界；新增纯前端视觉基础层、应用框架层和工作区原语层，再逐模式迁移 DOM 与样式。每波先建立语义 RED，再实现最小 GREEN；已迁移区域只消费 `--surdet-*` 语义 token，未迁移区域临时留在 legacy 样式中，但不复制业务逻辑。Editor 与 Renderer 继续各自投影同一业务状态，不建立跨包主题运行时。

**Tech Stack:** TypeScript、命令式 DOM、CSS、Vite 6、Vitest 3、现有 `@surdet/authoring` / `@surdet/core` / `@surdet/renderer`；不新增依赖，不修改 lockfile。

## Global Constraints

- **编号命名空间：** 本文件历史标题中的 `Wave 1–10` 仅是 Wave 6 之后、Wave 7 之前的前端重构内部批次；它们不是 Surdet 主线 Wave。自 2026-08-31 起，对用户和台账统一称为 `Frontend Pass 1–10`。主线 `Stage 6 Wave 6` 已在本地闭合，主线 Wave 7 尚未设计、授权或启动。
- 设计权威：`docs/superpowers/specs/2026-08-30-surdet-frontend-editorial-workbench-redesign-design.md`。
- 只改前端：允许 `packages/editor`、`packages/renderer` 及其测试；`packages/host`、`packages/shell` 默认只跑消费回归。只有当前代码中已经存在、能证明为纯显示的 seam，才允许另开白名单修改。
- 禁止修改 `packages/authoring`、`packages/core`、`packages/cli` 生产代码、公共 schema、项目/存档/脚本/时间轴格式、文件写入/EOL/备份/恢复/lease/apply/commit 语义、Starter 内容、依赖与 lockfile。
- 保留业务单一真相：新视觉组件只渲染现有前端状态，通过回调调用现有业务函数；不得复制状态机、索引、验证、预览、审阅、保存或素材插入逻辑。
- 保留稳定锚点：仍准确的 ID、`data-*`、对象引用和事件合同原样保留；必须替换时，在同一提交中建立等价永久测试。
- 永久删除所有彩色左竖线及等价横向 inset 色条；选择、当前、焦点、错误、警告、只读改用整面反馈、完整边界、文字、图标与 ARIA。
- 禁止旧默认视觉：装饰渐变、渐变字、玻璃拟态、发光、万能胶囊、卡片海、Bento 填充、卡片套卡片、浮空主动作、无意义副标题、随机编号、悬停漂浮和整站等宽字体。
- 新 CSS 使用设计规格定义的 `--surdet-*` 三层 token；组件不得直接重新发明 accent、panel、shadow 或状态裸色。
- 普通界面中文优先；ID、哈希、fingerprint、error code 与原始 JSON 只在技术详情中出现。
- 全局保存始终位于项目栏并保留 `Ctrl/Cmd+S`；工作区动作位于所属对象或区段正常文档流中，不得争夺相同文案或快捷键。
- Editor 人工服务只使用 `4175`；`4173` 必须保持空闲。启动前后核验标题、项目路径、端口和进程归属。
- 截图、浏览器 trace 和视觉 artifact 写到仓库外 `%TEMP%\surdet-frontend-redesign-*`，不得暂存。
- 项目所有者提供的高密度桌面创作工作台参考图是最终“完成度、层级和协同工作面”基准，不是可照抄字段清单。加载真实项目后的最终页面不得仍停留在空壳骨架；参考图中当前状态没有来源的版本、协作、时长、人物数值等字段必须省略，禁止用假数据或后端扩张补画面。
- 精确暂存；禁止 `git add .`、`git add -A`、amend、reset、rebase、force-push。未经项目所有者明确授权不得 push。
- 每波提交可单独回滚；某波失败时停在该波，不扩散到下一波。
- 每波分别记录：`TECHNICAL_GATES`、`LOCAL_INDEPENDENT_REVIEW`、`OWNER_VISUAL_ACCEPTANCE`、`REMOTE_REVIEW`。施工 AI 不代填 Owner 主观视觉通过。
- 施工期间继续在本任务书的 `Execution Ledger` 追加已验证事实；全重构闭合后，才更新既有长期路线台账，不新建第二本台账。

---

## Task 0: Freeze Baseline and Establish the Execution Ledger

**Files:**
- Modify: `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`
- Read only: `docs/superpowers/specs/2026-08-30-surdet-frontend-editorial-workbench-redesign-design.md`
- Read only: `packages/editor/package.json`
- Read only: `packages/renderer/package.json`

- [x] **Step 1: Record the current identity**

Run:

```powershell
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count surdet/main...HEAD
git status --short
```

Expected: branch `main`; protected/untracked files remain untracked; no staged paths.

- [x] **Step 2: Record the exact allowed and forbidden production roots**

Append the actual HEAD, remote relation, tracked state, protected untracked paths, authorized roots and forbidden roots to `Execution Ledger` below. Separate confirmed facts from assumptions.

- [x] **Step 3: Capture a non-mutating Editor baseline**

Run:

```powershell
npm run test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

Expected: existing Editor suite, typecheck and build pass. If a pre-existing failure appears, record it and stop before visual implementation.

- [x] **Step 4: Commit the taskbook before production work**

Run:

```powershell
git add -- docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(editor): plan editorial workbench redesign"
```

Expected staged set: exactly this taskbook.

---

## Task 1: Wave 1 — Visual Tokens, Application Shell, and Anti-AI Contracts

**Outcome:** 八模式始终可达；项目栏、模式导航和内容宿主迁入新壳层；新壳层完全退出旧渐变、胶囊和浮空模板；所有旧业务 renderer 继续工作。

**Files:**
- Create: `packages/editor/src/shell/editor-modes.ts`
- Create: `packages/editor/src/shell/app-shell.ts`
- Create: `packages/editor/src/styles/tokens.css`
- Create: `packages/editor/src/styles/components.css`
- Create: `packages/editor/src/styles/app-shell.css`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/src/panels/review-panel.ts`
- Modify: `packages/editor/src/panels/timeline-panel.ts`
- Modify: `packages/editor/src/project-io.ts`
- Modify: `packages/editor/src/state.ts`
- Modify: `packages/editor/src/styles.css`
- Modify: `packages/editor/index.html`
- Create: `packages/editor/test/editor-shell-navigation-contract.test.ts`
- Create: `packages/editor/test/editor-visual-token-contract.test.ts`
- Create: `packages/editor/test/editor-action-scope-contract.test.ts`
- Modify: `packages/editor/test/project-io.test.ts`
- Create: `packages/editor/test/timeline-project-bar-projection.test.ts`
- Read only: `packages/editor/test/review-operations-layout.test.ts`

- [x] **Step 1: Create a real RED for the eight-mode shell**

Add a contract test that imports `EDITOR_MODES` and asserts the exact IDs, Chinese labels, unique panel IDs and exact order:

```ts
expect(EDITOR_MODES.map(({ id }) => id)).toEqual([
  'editor', 'flow', 'timeline', 'config',
  'preview', 'review', 'stats', 'audit',
]);

expect(EDITOR_MODES.map(({ label }) => label)).toEqual([
  '剧本', '流程', '时间轴', '配置',
  '预览', '审阅', '统计', '审计',
]);
```

The test must also exercise all eight navigation callbacks and assert `data-editor-mode`, `aria-controls`, and `aria-current="page"`.

Run:

```powershell
npx vitest run packages/editor/test/editor-shell-navigation-contract.test.ts
```

Expected: FAIL because the pure contract and semantic navigation do not exist.

- [x] **Step 2: Create a real RED for visual tokens and banned signatures**

Add a small comment-stripping CSS test helper inside `editor-visual-token-contract.test.ts`. Assert that new style files provide the approved primitive and semantic `--surdet-*` tokens and forbid:

```text
radial-gradient(
backdrop-filter:
border-left-color:
border-inline-start-color:
inset 3px 0
border-radius: 999px
```

Do not require unmigrated mode rules in legacy `styles.css` to be fully gone yet. Require the new shell and shared components to be clean, and require old body/header/tabs signatures to be absent from their active selectors.

Run:

```powershell
npx vitest run packages/editor/test/editor-visual-token-contract.test.ts
```

Expected: FAIL because the new files and token namespace do not exist.

- [x] **Step 3: Create a RED for action scope**

The test must require:

```html
<button data-action="save-project" data-action-scope="global">保存全部</button>
```

and preserve workspace actions such as:

```html
<button data-action="save-decision" data-action-scope="workspace">保存我的决定</button>
```

Assert that workspace action containers are normal flow and never `fixed`, `sticky` or bottom-pinned.

Run:

```powershell
npx vitest run packages/editor/test/editor-action-scope-contract.test.ts packages/editor/test/review-operations-layout.test.ts
```

Expected: FAIL on missing global/workspace scope contract while existing review non-floating assertions continue to protect the known fix.

- [x] **Step 4: Implement the pure mode contract**

Create:

```ts
export type EditorModeId =
  | 'editor'
  | 'flow'
  | 'timeline'
  | 'config'
  | 'preview'
  | 'review'
  | 'stats'
  | 'audit';

export interface EditorModeDefinition {
  id: EditorModeId;
  label: string;
  panelId: string;
}

export const EDITOR_MODES: readonly EditorModeDefinition[] = [
  { id: 'editor', label: '剧本', panelId: 'editor-workspace' },
  { id: 'flow', label: '流程', panelId: 'flow-view' },
  { id: 'timeline', label: '时间轴', panelId: 'timeline-view' },
  { id: 'config', label: '配置', panelId: 'config-view' },
  { id: 'preview', label: '预览', panelId: 'preview-view' },
  { id: 'review', label: '审阅', panelId: 'review-view' },
  { id: 'stats', label: '统计', panelId: 'stats-view' },
  { id: 'audit', label: '审计', panelId: 'audit-view' },
] as const;
```

Update `state.mainTab` to `EditorModeId`. Do not move any business state.

- [x] **Step 5: Implement a callback-only application shell**

`app-shell.ts` may create DOM and accept projections/callbacks, but must not import project IO, history, preview or panel modules. Required exports:

```ts
export interface ProjectBarProjection {
  projectName: string;
  objectLabel: string;
  saveState: 'saved' | 'dirty' | 'partial-failure';
  canUndo: boolean;
  canRedo: boolean;
}

export interface ProjectBarActions {
  onOpenProject(): void;
  onOpenReview(): void;
  onUndo(): void;
  onRedo(): void;
  onSaveProject(): void;
}

export function renderProjectBar(
  projection: ProjectBarProjection,
  actions: ProjectBarActions,
): HTMLElement;

export function renderModeNavigation(
  activeMode: EditorModeId,
  onSelect: (mode: EditorModeId) => void,
): HTMLElement;
```

`main.ts` remains the composition root: it passes existing functions into these callbacks and keeps all current conditional behavior, shortcuts, `beforeunload`, status updates and `previewTimelineId = null` routing side effects.

- [x] **Step 6: Establish the new visual foundation**

Create the exact design-spec primitive and semantic tokens in `tokens.css`, including typography, 8/12/16/24/32/48 spacing, 0/2/4 radius, 2px focus ring and 120–200ms motion. Create semantic button, field, rule, empty, status and focus styles in `components.css`; create project bar, left mode rail, main host and responsive mode selector styles in `app-shell.css`.

Load order in `index.html`:

```html
<link rel="stylesheet" href="/src/styles.css" />
<link rel="stylesheet" href="/src/styles/tokens.css" />
<link rel="stylesheet" href="/src/styles/components.css" />
<link rel="stylesheet" href="/src/styles/app-shell.css" />
```

Legacy mode styles stay first only as a temporary compatibility layer. Remove or neutralize the old body/header/project bar/status/tabs rules from active use; new shell DOM must not use their visual classes.

- [x] **Step 7: Preserve current mode mounts and stable IDs**

Keep `#app`, `#main`, `#status`, `#sidebar`, `#search-panel`, `#editor`, `#right`, `#flow-view`, `#timeline-view`, `#config-view`, `#preview-view`, `#review-view`, `#stats-view` and `#audit-view`. The shell may wrap them with semantic regions but must not rename or duplicate them.

- [x] **Step 8: Turn the focused contracts GREEN**

Run:

```powershell
npx vitest run packages/editor/test/editor-shell-navigation-contract.test.ts packages/editor/test/editor-visual-token-contract.test.ts packages/editor/test/editor-action-scope-contract.test.ts packages/editor/test/review-operations-layout.test.ts packages/editor/test/timeline-project-bar-projection.test.ts
```

Expected: all pass.

- [x] **Step 9: Run adjacent Editor gates**

Run:

```powershell
npx vitest run packages/editor/test/project-io.test.ts packages/editor/test/history.test.ts packages/editor/test/preview-stage-layout.test.ts packages/editor/test/review-panel.test.ts packages/editor/test/presentation-asset-catalog.test.ts
npm run test -w surdet-editor
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

Expected: all pass. No Authoring/Core/CLI production changes.

- [x] **Step 10: Inspect the real application on port 4175**

Start a disposable Editor process on `4175`, verify `4173` is free, then inspect 1920×1080, 1440×900, 1280×720 and 1024×768. Confirm:

- project bar is a stable command surface, not a banner;
- all eight Chinese modes remain reachable;
- current mode uses full surface/complete boundary and `aria-current`, no colored left line;
- global save is unique and visually distinct from workspace actions;
- existing Editor/Review/Preview functions are still reachable;
- no decorative gradient, glass, glow, giant pill, slogan or floating action appears;
- title and project path identify Surdet, and listening process belongs to this workspace.

Store screenshots under `%TEMP%\surdet-frontend-redesign-wave1-*`.

- [x] **Step 11: Independently review and commit Wave 1**

Review exact diff, selectors adjacent to every edit, test results, screenshot paths, and forbidden production roots. Then:

```powershell
git add -- packages/editor/index.html packages/editor/src/main.ts packages/editor/src/state.ts packages/editor/src/styles.css packages/editor/src/panels/review-panel.ts packages/editor/src/panels/timeline-panel.ts packages/editor/src/project-io.ts packages/editor/src/shell/editor-modes.ts packages/editor/src/shell/app-shell.ts packages/editor/src/styles/tokens.css packages/editor/src/styles/components.css packages/editor/src/styles/app-shell.css packages/editor/test/editor-shell-navigation-contract.test.ts packages/editor/test/editor-visual-token-contract.test.ts packages/editor/test/editor-action-scope-contract.test.ts packages/editor/test/project-io.test.ts packages/editor/test/timeline-project-bar-projection.test.ts
git diff --check
git diff --cached --check
git diff --cached --name-only
git commit -m "feat(editor): establish editorial application shell"
```

Expected: exact allowlist only. Stop for Wave 1 local review; do not push.

---

## Cross-Wave Completion Benchmark — Mature Integrated Authoring Desk

The approved reference is a maturity benchmark for the completed redesign. It does not change the frontend-only boundary and does not authorize invented product data. The following conditions are mandatory across Waves 2, 3 and 5:

- At 1440×900 and above, a loaded project must offer a coordinated scene/asset outline, continuous manuscript, contextual Inspector or live preview, and a collapsible time/causal Dock around the same current scene. The manuscript remains the largest readable region.
- The project bar `objectLabel`, outline `aria-selected`, manuscript object identity, Inspector `objectRef`, preview scene and timeline/causal linkage must consume the same existing selection truth.
- Preview and timeline peeks may reuse existing runtime/model state only. There must never be two live preview iframes, two trace projections, or two timeline edit states in the DOM or application state.
- 1920×1080, 1440×900, 1280×720 and 1024×768 must define deterministic pane folding. Narrow layouts keep the main task and provide keyboard-operable reveal/restore instead of overlaying navigation or creating three competing long scrollbars.
- Screenshots used for full completion must load Starter or another isolated real fixture. Empty-project screenshots prove shell and empty-state behavior only; they cannot prove the final information density.
- Every visible command, time, chapter, status, version, collaboration signal, character value and causal condition must trace to an existing projection/callback. Missing facts are omitted, never fabricated.

Wave 1 is intentionally the structural foundation and must not be presented as the final visual result.

---

## Task 2: Wave 2 — Script and Asset Workspace

**Outcome:** 剧本模式成为真正的连续稿件主工作面；场景/素材目录、中央稿件、上下文 Inspector 与后续可接入的预览/时间 Dock 使用稳定区域协同；技术身份下钻；块类型不再依赖左色条。

**Files:**
- Create: `packages/editor/src/styles/script-workspace.css`
- Create: `packages/editor/src/shell/authoring-workbench.ts`
- Create: `packages/editor/e2e/editorial-script-workspace-wave-2.e2e.mjs`
- Create: `packages/editor/e2e/support/fake-file-system.mjs`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/src/shell/app-shell.ts`
- Modify: `packages/editor/src/panels/editor.ts`
- Modify: `packages/editor/src/panels/sidebar.ts`
- Modify: `packages/editor/src/panels/assets.ts`
- Modify: `packages/editor/src/panels/search-panel.ts`
- Modify: `packages/editor/src/panels/issues.ts`
- Modify: `packages/editor/src/panels/right.ts`
- Modify: `packages/editor/src/styles.css`
- Create: `packages/editor/test/editor-asset-sidebar-contract.test.ts`
- Create: `packages/editor/test/editor-script-workspace-contract.test.ts`
- Create: `packages/editor/test/editor-integrated-authoring-workbench.test.ts`
- Modify: `packages/editor/test/presentation-asset-catalog.test.ts`
- Modify: `packages/editor/test/assets.test.ts`

- [x] **Step 1:** RED: require `data-sidebar-mode="scenes|assets"`, `aria-selected`, `data-editor-region="asset-catalog"`, `data-asset-key`, insert/copy actions and both referenced/unreferenced assets.
- [x] **Step 2:** RED: require `.block[data-line][data-object-ref]`, continuous manuscript hierarchy, real keyboard focus, current block whole-surface feedback and no `.block.t-*` left border color.
- [x] **Step 3:** RED: require named outline/manuscript/context/dock regions, one current scene identity across all rendered projections, manuscript as the largest region, and deterministic 1280/1024 pane folding; forbid duplicate preview iframe/trace/timeline state.
- [x] **Step 4:** Refactor only presentation DOM; keep existing scene edit/history/search/asset insertion/copy callbacks unchanged. Build the integrated region topology without fabricating preview, timeline, chapter, duration or status content that does not yet exist.
- [x] **Step 5:** Move ordinary users’ default view to Chinese content/title/type/use location; stable keys and hashes remain under technical disclosure.
- [x] **Step 6:** Remove scene/block/asset selected left-line signatures and replace them with complete boundary, surface, “当前/已选” text and ARIA.
- [x] **Step 7:** Run focused script/asset/search/history tests, full Editor test, typecheck and build.
- [x] **Step 8:** Inspect a loaded isolated fixture with long Chinese prose, multiple choices, assets, missing preview, dirty/save failure and 1024×768 folding; do not use empty-project appearance as the density acceptance.
- [x] **Step 9:** Commit exact Wave 2 paths as `feat(editor): rebuild script and asset workspace`; no push.

---

## Task 3A: Wave 3A — Flow Canvas

**Outcome:** 流程页成为中文优先、以真实图为主的专业剧情流程工作台；保留现有图构建、导航、平移、缩放、小地图、建链、重命名、删除、dirty/history/undo 路径，不制造章节、时长、状态或运行概率。

**Design authority:** `docs/superpowers/specs/2026-08-30-surdet-flow-canvas-wave-3a-design.md`

**Implementation taskbook:** `docs/superpowers/plans/2026-08-30-surdet-flow-canvas-wave-3a.md`

**Files:**
- Create: `packages/editor/src/styles/flow-workspace.css`
- Create if justified by RED: `packages/editor/src/flow-presentation.ts`
- Modify: `packages/editor/index.html`
- Modify: `packages/editor/src/panels/flow.ts`
- Modify: `packages/editor/src/styles.css` only to remove migrated flow rules
- Create: focused presentation / workspace / interaction tests
- Create: isolated real-Starter browser runner

- [ ] **Step 1:** RED for semantic workbench regions, Chinese display projection, accessible node interaction, complete selected / invalid boundaries and no decorative rainbow / colored selection rail.
- [ ] **Step 2:** Add the smallest pure display projection without changing graph, scene text or serialized values.
- [ ] **Step 3:** Rebuild the flow shell and SVG presentation around the existing graph and view state; every command must be functional.
- [ ] **Step 4:** Preserve click, keyboard open, pan, zoom, minimap, drag-link, rename, delete, dirty and undo behavior.
- [ ] **Step 5:** Run focused tests, full Editor test, typecheck/build and isolated real-Starter browser evidence at desktop, narrow and 200% zoom.
- [ ] **Step 6:** Independent review, exact code commit, Ledger closure; no push.

---

## Task 3B: Wave 3B — Timeline Desk

**Outcome:** 在独立代码证据中重构完整时间轴页；中文显示继续投影稳定英文枚举，先解决真实编辑正确性，再迁移视觉。剧本页 Timeline Dock 暂缓。

**Required correctness before visual closure:**
- timeline-specific undo must not undo scene text;
- destructive track-type replacement / cue deletion must have an explicit recovery contract;
- new tracks and cues must not hardcode Starter-only assets;
- CRLF / LF must be preserved;
- tick overlap and narrow-layout reachability must be corrected;
- serialized `background/portrait/camera/screen/particle/audio` and action enums must remain unchanged.

**Dock deferral contract:**
- define zero / one / multiple timelines referenced by the current scene;
- define the sole timeline and cue selection truth;
- keep compact and full mounts mutually exclusive;
- show an honest empty state when no association exists;
- never display the first timeline as if it were current-scene truth.

- [ ] **Step 1:** Write and review a separate 3B design / taskbook after 3A closes.
- [ ] **Step 2:** Establish correctness RED before visual RED.
- [ ] **Step 3:** Implement the minimum Editor-only correction and full-page Timeline Desk.
- [ ] **Step 4:** Run proportional timeline, Editor and real-browser gates in a separate code-evidence commit.
- [ ] **Step 5:** Revisit the script Dock only after its truth contract exists.

---

## Task 4: Wave 4 — Configuration Ledger

**Outcome:** 配置页成为中文字段分组与可编辑台账，而非通用卡片表单；保存与验证仍走既有 config edit/project IO 路径。

**Files:**
- Create: `packages/editor/src/styles/config-workspace.css`
- Modify: `packages/editor/src/panels/config.ts`
- Modify: `packages/editor/src/panels/calendar-map.ts`
- Modify: `packages/editor/src/config-edit.ts`
- Modify: `packages/editor/src/styles.css`
- Create: `packages/editor/test/editor-config-workspace-contract.test.ts`
- Modify: `packages/editor/test/config-edit.test.ts`
- Modify: `packages/editor/test/calendar-map.test.ts`
- Modify: `packages/editor/test/project-config-display.test.ts`
- Modify: `packages/editor/test/terminology-import.test.ts`

- [ ] **Step 1:** RED: Chinese labels, section grouping, inline help, technical key disclosure and semantic map theme hooks.
- [ ] **Step 2:** Preserve existing config edits, EOL/save behavior and validation; change only render structure/class names and pure display projections.
- [ ] **Step 3:** Replace map inline color values with semantic component variables.
- [ ] **Step 4:** Verify long labels, invalid values, empty config, keyboard focus and 200% zoom.
- [ ] **Step 5:** Run focused tests, full Editor suite, typecheck/build and real save round-trip.
- [ ] **Step 6:** Commit exact Wave 4 paths as `feat(editor): rebuild configuration ledger`; no push.

---

## Task 5: Wave 5 — Preview Stage and Causal Dock

**Outcome:** Gal Canvas remains centered and largest; causal trace becomes independently scrollable, collapsible bottom Dock; no duplicate runtime or projection.

**Files:**
- Create: `packages/editor/src/styles/preview-workspace.css`
- Create: `packages/editor/src/shell/workbench-dock.ts`
- Modify: `packages/editor/src/panels/preview-panel.ts`
- Modify: `packages/editor/src/preview.ts`
- Modify: `packages/editor/src/preview-diagnostics.ts`
- Modify: `packages/editor/src/styles.css`
- Modify: `packages/editor/test/preview-stage-layout.test.ts`
- Modify: `packages/editor/test/preview-causal-trace.test.ts`
- Modify: `packages/editor/test/preview-diagnostics.test.ts`
- Modify: `packages/editor/test/preview-runtime-contract.test.ts`
- Modify: `packages/editor/test/preview-runtime-lifecycle.test.ts`
- Modify: `packages/editor/test/preview-scenes.test.ts`
- Modify: `packages/editor/test/preview-font-transfer.test.ts`

- [ ] **Step 1:** RED: `data-editor-panel="preview"`, centered canvas constraints, independent trace scroll, Dock keyboard collapse/restore and workspace action scope.
- [ ] **Step 2:** Extract only UI-only Dock state; preserve existing preview runtime, iframe, transfer and causal selection state.
- [ ] **Step 3:** Allow the integrated script workbench to host a live preview/context peek only through the same preview runtime and state used by full preview mode. Moving between modes may remount the one host, but must not leave a second iframe or trace projection alive.
- [ ] **Step 4:** Make stage occupy maximum available center area and prevent trace growth from changing stage geometry.
- [ ] **Step 5:** Render trace as continuous evidence rows, not colored chips/cards; preserve line/object jump behavior.
- [ ] **Step 6:** Run all preview tests, full Editor suite, typecheck/build and real 4-size canvas/trace checks, including the loaded integrated script workbench.
- [ ] **Step 7:** Commit exact Wave 5 paths as `feat(editor): rebuild preview stage and causal dock`; no push.

---

## Task 6: Wave 6 — Review Proofreading Workbench

**Outcome:** 审阅页保留完整来源、决定、回执、stage 结果和只读合同，同时把用户内容、裁决动作和技术证据分层；所有动作处于正常文档流。

**Files:**
- Create: `packages/editor/src/styles/review-workspace.css`
- Modify: `packages/editor/src/panels/review-panel.ts`
- Modify: `packages/editor/src/review-model.ts`
- Modify: `packages/editor/src/review-preview.ts`
- Modify: `packages/editor/src/review-workspace.ts`
- Modify: `packages/editor/src/styles.css`
- Create: `packages/editor/test/editor-review-layout-contract.test.ts`
- Modify: `packages/editor/test/review-model.test.ts`
- Modify: `packages/editor/test/review-panel.test.ts`
- Modify: `packages/editor/test/review-workspace.test.ts`
- Modify: `packages/editor/test/review-preview.test.ts`
- Modify: `packages/editor/test/review-operations-layout.test.ts`

- [ ] **Step 1:** RED: all high-risk review `data-*` anchors, complete candidate content, real radio/checkbox semantics, exact-unit choice, normal-flow actions and receipt readonly reopen.
- [ ] **Step 2:** Preserve Authoring review projections and receipt identities exactly; do not recompute conflict, provenance or approval truth in Editor.
- [ ] **Step 3:** Replace warning/safe/conflict/dependency left bars with titled sections, complete borders, symbols and Chinese next actions.
- [ ] **Step 4:** Keep technical IDs/fingerprints in disclosure; ordinary view shows content differences, impacts and explicit decision target.
- [ ] **Step 5:** Verify create/save/failure/reopen/readonly/result preview/approve/return paths and fixed button location.
- [ ] **Step 6:** Run all review tests, full Editor suite, typecheck/build and real review fixture inspection.
- [ ] **Step 7:** Commit exact Wave 6 paths as `feat(editor): rebuild review proofreading workbench`; no push.

---

## Task 7: Wave 7 — Statistics and Audit Records

**Outcome:** 统计成为低噪声作品摘要，审计成为可追溯记录；两者不复制仪表盘卡片墙，技术信息仍完整可查。

**Files:**
- Create: `packages/editor/src/styles/stats-workspace.css`
- Create: `packages/editor/src/styles/audit-workspace.css`
- Modify: `packages/editor/src/panels/stats-panel.ts`
- Modify: `packages/editor/src/panels/audit-panel.ts`
- Modify: `packages/editor/src/stats.ts`
- Modify: `packages/editor/src/styles.css`
- Create: `packages/editor/test/editor-stats-audit-visual-contract.test.ts`
- Modify: `packages/editor/test/stats.test.ts`
- Modify: `packages/editor/test/audit-pairs.test.ts`

- [ ] **Step 1:** RED: continuous summary/record layout, accessible tables/lists, no KPI card grid, no audit status left bars.
- [ ] **Step 2:** Preserve all existing counts, object pairs, location and selection callbacks.
- [ ] **Step 3:** Use typography, columns, rules and disclosure to establish hierarchy; no fabricated advice cards.
- [ ] **Step 4:** Verify empty/large/error datasets, keyboard path and 200% zoom.
- [ ] **Step 5:** Run focused tests, full Editor suite, typecheck/build and real page checks.
- [ ] **Step 6:** Commit exact Wave 7 paths as `feat(editor): rebuild statistics and audit records`; no push.

---

## Task 8: Wave 8 — Renderer Player Interface and Theme Boundary

**Outcome:** 玩家界面使用同一克制语义方向，但不复用 Editor CSS、不改变 presentation/runtime/save 行为；ADV/NVL、菜单、系统面板、回想、画廊和加载状态全部覆盖。

**Files:**
- Modify: `packages/renderer/src/theme.ts`
- Modify: `packages/renderer/src/theme-projection.ts`
- Modify: `packages/renderer/src/ui-views.ts`
- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/src/layers/menu/menu-layer.ts`
- Modify: `packages/renderer/src/layers/system-panel/system-panel-layer.ts`
- Modify: `packages/renderer/src/layers/gallery/gallery-layer.ts`
- Modify: `packages/renderer/src/loading-layer.ts`
- Create: `packages/renderer/src/editorial-theme-map.ts`
- Create: `packages/renderer/test/editorial-theme-map.test.ts`
- Modify: affected Renderer tests listed in the design spec section 17.1

- [ ] **Step 1:** RED: static semantic mapping from Editor meaning to existing `RendererTheme` fields; no cross-package CSS/runtime dependency.
- [ ] **Step 2:** RED: ADV/NVL/dialogue/menu/system/gallery/loading selected/focus/disabled/readability contracts without decorative gradients or color-only signals.
- [ ] **Step 3:** Make the smallest theme/view changes; keep Renderer commands, queries, presentation lifecycle, save snapshot and public types stable.
- [ ] **Step 4:** Run affected layer suites, all Renderer tests, typecheck/build and integration presentation/resource cycles.
- [ ] **Step 5:** Run real player checks for ADV, NVL, backlog, menu, settings, gallery, loading, keyboard and gamepad.
- [ ] **Step 6:** Commit exact Wave 8 paths as `feat(renderer): establish editorial player interface`; no push.

---

## Task 9: Wave 9 — Host/Shell Consumer Regression

**Outcome:** 证明纯前端重构没有破坏 Host/Shell 槽位、窗口、存档和打包消费边界；默认不修改生产代码。

**Files:**
- Test only unless a separately approved pure-display seam is proven:
  - `packages/host/test/player-ui-coordination.test.ts`
  - `packages/host/test/renderer-player-shell-slots.test.ts`
  - `packages/shell/test/player-experience-e2e-contract.test.ts`
  - `packages/shell/test/save-store.test.ts`
  - `packages/shell/test/window-state.test.ts`

- [ ] **Step 1:** Run the five named consumer suites before any Host/Shell edit.
- [ ] **Step 2:** Run Host and Shell typecheck/build.
- [ ] **Step 3:** Run the smallest existing player E2E that exercises the changed Renderer UI without modifying fixtures.
- [ ] **Step 4:** If a failure is a pure selector/display seam, establish RED and request a precise whitelist before editing; if it is business/storage/window semantics, stop and reject scope expansion.
- [ ] **Step 5:** Record `HOST_SHELL_PRODUCTION_CHANGES=NO` unless independently authorized.
- [ ] **Step 6:** Commit only test migrations if necessary as `test(shell): verify editorial frontend consumers`; no push.

---

## Task 10: Wave 10 — Full Consistency, Accessibility, and Closure

**Outcome:** 删除旧 `src/styles.css` 与生产加载入口，活动结构归入已有语义层；九模式、四视口、键盘、焦点、长中文、横切状态与真实 200% 浏览器缩放完成收口。正常 commit/push 与 exact-head CI 后停止待云端独立终审。Pass 8/9、B01、V4、F01/F02 不重开。

**Files:**
- Delete: `packages/editor/src/styles.css`; remove its link from `packages/editor/index.html`
- Modify: all new `packages/editor/src/styles/*.css` only as required by final findings
- Modify: affected Editor/Renderer accessibility tests
- Create: `packages/editor/test/editor-final-visual-system-contract.test.ts`
- Create: `docs/SURDET-FRONTEND-EDITORIAL-WORKBENCH-REDESIGN-DELIVERY-REPORT-2026-09-08.md`
- Modify: `docs/README.md`
- Modify: `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`
- Update locally, never stage: `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`

- [x] **Step 1:** Permanent RED identifies the loaded legacy stylesheet and tokens. Migrate live structure and remove the old file; final style/navigation contracts GREEN.
- [x] **Step 2:** Exercise editor/assets/flow/timeline/config/preview/review/stats/audit with original mode callbacks and style owners at 1792×900, 1280×800, 960×720 and 390×844.
- [x] **Step 3:** Final aggregate supplies Editor 76 files / 721 tests and Renderer 54 / 439 plus typecheck/build; all passed.
- [x] **Step 4:** Host/Shell consumption including Pass 9 passed 6 files / 69 tests. Host/Shell typecheck and builds passed (Shell build supplied separately); final `verify:all` passed. Renderer production unchanged: no repeated local Pass 8/Windows A–G; CI retains its player regression.
- [x] **Step 5:** Test actual modal/keyboard focus, narrow panels, long Chinese/path, invalid drafts, dirty/empty/error/disabled and image loading states. Check editor/assets/review at real visible Chromium 200% zoom; synthetic composition is not native IME. Readonly review contracts remain covered by existing tests.
- [x] **Step 6:** Inspect six representative built-page screenshots; list thumbnail failure stays in its own row, the real preview canvas/controls remain inside its iframe, and task browsers/temporary servers close.
- [x] **Step 7:** An implementation-independent `luna_worker` reviewed the actual diff, semantic CSS ownership, behavior, final six screenshots and evidence boundaries; no confirmed substantive blockers remain.
- [x] **Step 8:** The 2026-09-08 report records local gates, actual screenshots/zoom, Luna and untested boundaries. The containing commit and its GitHub Checks identify the review version and remote result.
- [x] **Step 9:** This Execution Ledger, docs index and the original untracked local long-term ledger are updated. Owner experience and cloud approval remain unsigned.
- **Step 10 — external closeout:** Normal commit and ordinary push to verified main are authorized. The containing commit's GitHub Checks and the local long-term ledger record the final SHA/run; stop at cloud independent review, with no Starter modernization, Pass 11, Wave 7 or release/deployment.

---

## Execution Ledger

### 2026-08-30 — Plan initialization

**CONFIRMED_FACTS**

- Design authority is committed at `docs/superpowers/specs/2026-08-30-surdet-frontend-editorial-workbench-redesign-design.md`.
- Project owner approved the design, requested the taskbook, and authorized direct implementation after the taskbook is created.
- Project owner authorized selective subagents, not delegation for its own sake; core application shell, state composition and review remain owned by the primary implementation agent.
- No push was authorized.
- Baseline HEAD is `012a405fac2077981da04a42b1c1d579c7fa40ce`; local `surdet/main` is `f8943c293c4537b3867cc8eeea316b19bb4a0b40`; the local branch is ahead 20 and behind 0.
- Before this taskbook was staged, tracked worktree and staging were empty. Existing untracked governance, handoff, protected art-direction, `design/`, long-term ledger and CLI artifact paths were preserved.
- Editor baseline passed: 33 test files / 223 tests, typecheck exit 0, build exit 0. Vite emitted only the existing large-chunk advisory.
- Authorized production roots for the complete redesign are `packages/editor` and `packages/renderer`; the current Wave 1 production root is `packages/editor` only. Forbidden production roots are `packages/authoring`, `packages/core`, `packages/cli`, `packages/host`, `packages/shell`, Starter/game content, dependencies and the lockfile.

**REASONABLE_INFERENCES**

- The safest Wave 1 boundary is a callback-only shell plus new CSS files, preserving all current panel renderers and stable IDs.
- New permanent contracts should target semantic anchors and forbidden visual signatures rather than brittle screenshot pixel equality.

**UNVERIFIED_ITEMS**

- Wave 1 RED/GREEN, full Editor regression, typecheck, build and real-page visual evidence have not yet been executed.
- Owner visual acceptance and remote GitHub review have not started.

**STOP_BOUNDARY**

- Begin Task 0, then execute Task 1 only. Do not begin Task 2 until Task 1 technical gates and local independent review are complete.

### 2026-08-30 — Wave 1 application-shell closure

**CONFIRMED_FACTS**

- Wave 1 code evidence is commit `96d1bae6e1afc25b6061500a45e1758fe3dfbf97`, parent `85f6acc7e443c0758040c5d31abe8998552cbd34`, message `feat(editor): establish editorial application shell`.
- The code commit contains exactly 17 authorized Editor paths: the HTML entry, shell/mode modules, project and timeline observation seams, review action scoping, state projection, four style layers and five permanent contract tests. It contains no Authoring, Core, CLI, Host, Shell, Starter, dependency, lockfile or protected-file changes.
- The application shell exposes exactly eight Chinese task modes and one global save action. Project-bar content is derived from the existing scene, timeline, selection, dirty and save-result facts; it does not create a second business state or mutation path.
- Save outcomes distinguish clean, dirty and partial failure. Long status text retains the full accessible `title` while remaining width-bounded in the visible shell. Review actions remain workspace-scoped and the primary decision action is no longer a floating viewport control.
- Focused Wave 1 contracts passed: 5 files / 22 tests. The complete Editor suite passed: 37 files / 237 tests. Editor typecheck and build passed; Vite emitted only the pre-existing large-chunk advisory.
- An independent read-only review passed with no Blocker, High, Medium or Low findings. Its focused verification passed 8 files / 50 tests, Editor typecheck and diff checks.
- Real-browser geometry checks passed without horizontal page overflow at 1920×1080, 1440×900, 1280×720 and 1024×768. At 1024 px, the navigation folds into a row; a 320-character unbroken status remains visually clipped with ellipsis while the complete value remains available through the title attribute.
- Real-browser interaction checks observed mode-aware object labels, a dirty timeline state and an honest partial-save-failure state. These checks used the existing UI and mutation pathways; no duplicate preview runtime, iframe, project writer or timeline writer was introduced.
- Visual artifacts were created outside the repository:
  - `editor-shell-1920x1080.png`: 106331 bytes, SHA-256 `31FE2939FAD56CD3A8919DBF322892DF749C723E6BCEBAF746840605BA2BC1D0`.
  - `editor-shell-1440x900.png`: 106772 bytes, SHA-256 `FEAA1B1C7EFCADFA649330404EE01E9411197FA68FB11F3F44502F9DC94FA89A`.
  - `editor-shell-1280x720.png`: 85702 bytes, SHA-256 `4CE1C8DF57F4909F20A231C2FC9BF90F2FE370AE00DFD49EA247F729791A7939`.
  - `editor-shell-1024x768.png`: 74219 bytes, SHA-256 `4D54FABDC80289C4B172ABA5C76149D5A27F6DCA5DF39EF481A3359AE9292DB6`.
- The approved reference image is now a final cross-wave maturity benchmark in both the design specification and this taskbook: the completed product must converge on one integrated outline/manuscript/context/preview/timeline/causal authoring desk, deterministic responsive folding and a single semantic selection truth, without fabricating reference-only collaboration, version, duration or character-stat data.

**REASONABLE_INFERENCES**

- Wave 1 establishes a stable, non-AI-styled application frame and the projection seams needed by later workspaces. It is a suitable base for Wave 2, but it is not yet the dense integrated authoring desk shown in the final reference.
- The responsive shell and callback-only observation seams reduce the risk that later visual composition will fork business state or silently change save/timeline behavior.

**UNVERIFIED_ITEMS**

- Waves 2–10 have not started. The outline, manuscript canvas, flow, timeline, preview, review, statistics, audit and Renderer workspaces have not yet received their final redesign.
- A loaded isolated real-project fixture has not yet been used to prove the final integrated density benchmark; Wave 1 browser evidence covers the application shell and existing panels only.
- Owner visual acceptance, remote GitHub review, push, deployment and release have not started.

**STOP_BOUNDARY**

- Wave 1 is technically closed. Stop before Task 2 / Wave 2. Do not push, deploy, modify forbidden roots or begin the manuscript workbench without the next explicit authorization.

### 2026-08-30 — Wave 2 narrative-continuity workspace initialization

**CONFIRMED_FACTS**

- The project owner reviewed the Wave 1 page, judged it more modern but still materially short of the mature desktop-authoring benchmark, and explicitly authorized Wave 2 specification, planning and implementation without another intermediate approval pause.
- Wave 2 baseline HEAD is `27361d9269475350ffea1d1ccdf4eb9bd5069148`, parent `96d1bae6e1afc25b6061500a45e1758fe3dfbf97`; local `surdet/main...HEAD` is behind 0 / ahead 23. Tracked worktree and staging were empty before the Wave 2 documents were created.
- Existing untracked governance, handoff, protected art-direction, `design/`, long-term ledger and CLI artifact paths remain preserved and unstaged. No push is authorized.
- The Wave 2 capability audit confirmed that `state.scenes` / `state.current` are the only scene truth, `state.selectedObjectRef` / `state.authoringIndex` are the only authoring-selection truth, and `buildAssetInventory()` is the existing asset projection. Editing, history, search, issue navigation, asset insertion, validation and causal selection already have production callback paths that must be retained.
- The current product does not expose reliable chapter names, chapter hierarchy, scene or chapter durations, production status, version, collaboration, comments, notifications or character-state metrics. Wave 2 will omit these reference-only facts instead of fabricating them.
- The selected desktop architecture is a narrative-continuity desk: real scene / asset outline, one ordered manuscript and real current-object / validation / causal context. A three-column narrative / dialogue / interaction editor was rejected because `.gal` is one ordered editable stream and the split would create ordering, move, selection and undo ambiguity.
- The eight existing task modes will move from the permanent left rail to a horizontal strip below the project bar. Mode IDs, callbacks, focus semantics and application state remain unchanged; this is a frontend layout correction that releases width for outline + manuscript + context.
- Wave 2 production scope is Editor-only. Authoring, Core, CLI, Host, Shell, Renderer, Starter, dependencies and the lockfile remain outside scope. No second preview iframe, trace projection, timeline model, causal model or authoring truth is authorized.
- Read-only port inspection found `4173` owned by an `E:\jiuan\jiuan-frontend` test harness and `4175` owned by the Surdet Editor Vite process. Wave 2 must not stop, claim or reuse `4173`; manual Surdet preview remains on `4175` and automated browser evidence must use its own verified-free strict port.
- Wave 2 design authority is `docs/superpowers/specs/2026-08-30-surdet-editorial-script-workspace-wave-2-design.md`; executable detail is `docs/superpowers/plans/2026-08-30-surdet-editorial-script-workspace-wave-2.md`. This master taskbook remains the single Execution Ledger.

**REASONABLE_INFERENCES**

- A pure DOM workbench topology plus a composition-root scene / object navigation coordinator is the smallest architecture that can align all current projections without moving business logic into presentation modules.
- A loaded isolated Starter fixture is necessary to judge density, hierarchy and responsive folding; an empty project is insufficient evidence for Wave 2 completion.

**UNVERIFIED_ITEMS**

- Wave 2 permanent RED, implementation, regression tests, typecheck, build and real-fixture browser evidence have not yet run.
- The final 1440 / 1280 / 1024 geometry, interaction behavior and visual proximity to the approved benchmark remain unverified until the implementation exists.
- Owner visual acceptance, remote GitHub review, push, deployment and Wave 3 have not started.

**STOP_BOUNDARY**

- Execute Wave 2 through its local technical and visual gates, create exact local commits and stop before Wave 3. Do not push, deploy or modify any backend / shared-engine production package.

### 2026-08-30 — Wave 2 selection-reconciliation scope decision

**CONFIRMED_FACTS**

- Independent review found that real authoring-index rebuilds could leave `state.selectedObjectRef` pointing at an obsolete object identity after an edit, search jump or scene transition. The workbench must keep the existing single selection truth rather than introduce a second UI-only selection.
- Wave 2 therefore explicitly adds `packages/editor/src/causal-selection.ts` and its existing adjacent regression file `packages/editor/test/causal-selection.test.ts` to the authorized Editor-only path set. The implementation may retain a stable indexed ref, remap a uniquely identifiable content-only ref by source line and kind, or clear an ambiguous / missing ref; it may not invent another index, selection store or backend contract.
- This is an explicit scope decision recorded before the code-evidence commit. Authoring, Core, CLI, Host, Shell, Renderer, Starter, dependencies and lockfiles remain unchanged and outside Wave 2 production scope.

**REASONABLE_INFERENCES**

- Centralized reconciliation is the smallest safe correction because every outline, manuscript, search, issue and causal projection already consumes the same `state.selectedObjectRef`.

**UNVERIFIED_ITEMS**

- The final exact code commit and docs-only closure commit have not yet been created at this ledger point.

**STOP_BOUNDARY**

- Complete the fresh browser rerun and final independent review, then create the exact Wave 2 code commit only if no Blocker or High finding remains. Do not push or begin Wave 3.

### 2026-08-30 — Wave 2 narrative-continuity workspace closure

**CONFIRMED_FACTS**

- Wave 2 planning is commit `0caceceb2ae21f2e8b3c7fd21b6fadcabd2d26a9`. Code evidence is commit `0531388ccc703ce603f02eb4d34d5594013ffc89`, parent `0caceceb2ae21f2e8b3c7fd21b6fadcabd2d26a9`, message `feat(editor): build narrative continuity workspace`, with exactly 17 reviewed Editor production, test and browser-runner paths and no staged-set difference.
- Initial RED was 3 files / 15 tests with 12 passing and 3 expected failures for the absent Wave 2 visual/layout contracts. Final focused coverage passed 4 files / 23 tests; the complete Editor suite passed 40 files / 255 tests; Editor typecheck and build passed with only the existing Vite large-chunk advisory.
- The final script workspace uses the real scene / asset outline, one ordered manuscript and real current-object / validation / causal context. Existing scene editing, history, search, issue navigation, asset insertion, validation and selection behavior remain on their original callbacks and state. No backend/shared-engine production package, Starter, dependency or lockfile changed.
- Independent review's first pass found narrow-layout reachability, navigation consistency, selection reconciliation, dirty/asset refresh, row-action placement and tab-keyboard problems. All Blocker / High findings were corrected. The final review returned `PASS` with no Blocker, High or Medium finding, passed an additional 4 files / 38 tests and independently replayed the final runner successfully.
- A runner assertion failure was retained at `<local-path>`, 41363 bytes, SHA-256 `0E2A65AAB615CD61AF1A24A0F58D9537C12754DBFD0FFF1B3AC6734F764E7EFF`; it read input `textContent` instead of value and did not identify a product failure.
- Final fresh browser evidence passed 16 / 16 at `<local-path>`, 56931 bytes, SHA-256 `F7B70A09C9CE890196AF0930AE044C09D9F8AB393A527DBAC3BBE83DD533E6BC`. It loaded the real Starter through the picker path, proved 1440 / 1280 / 1024 / 800 responsive composition, exercised scene/search/edit/undo/asset insertion paths, found no duplicate preview/trace/timeline state and recorded empty browser error / request / cleanup channels.
- Original Starter remained byte-identical with SHA-256 `8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6`. The runner used and released isolated port 4187; it did not touch 4173 or 4175.

**REASONABLE_INFERENCES**

- The workbench now behaves like a coherent narrative-authoring surface rather than a set of generic cards, while retaining a simple data flow that later preview, timeline and causal workspaces can consume without duplicating truth.
- This materially advances the approved direction but does not make the current Editor pixel-equivalent to the final reference; the missing work is visible and intentionally assigned to later waves.

**UNVERIFIED_ITEMS**

- Preview, timeline, causal graph, flow, statistics, audit, final cross-mode styling and replacement production art remain future waves. Chapter hierarchy, duration, collaboration, comments, version, production state and character metrics remain omitted because the current product has no authoritative facts for them.
- A low-severity existing new-scene edge is deferred: the manuscript's displayed file path may wait for the next full render after the first physical save assigns its final path; save behavior and stored bytes are unaffected.
- The browser artifact records runner hash and disk identity but not a complete application-source hash or `runHead`; two post-edit reruns and exact commit review establish freshness for this B-level UI wave, while a later high-risk wave may strengthen the envelope.
- Owner visual acceptance of the final loaded Wave 2 view, remote GitHub review, push, deployment and release have not occurred.

**STOP_BOUNDARY**

- `WAVE_2_TECHNICAL_VERIFICATION = PASSED`
- `OWNER_VISUAL_ACCEPTANCE = NOT_STARTED`
- `REMOTE_REVIEW = NOT_STARTED`
- `PUSH = NOT_PERFORMED`
- `WAVE_3 = NOT_STARTED`
- Create only the exact docs-only closure commit, then stop. Do not push or begin Wave 3.

### 2026-08-30 — Wave 3 scope correction and Flow Canvas 3A initialization

**CONFIRMED_FACTS**

- The owner explicitly authorized continued implementation toward the mature desktop-authoring reference, with human-friendly Chinese-first language and actual capability taking priority over visual imitation.
- Wave 3A baseline HEAD is `2fdbd59eaa4f00669dc5b8a22c754bcb57949b45`; local `surdet/main...HEAD` is behind 0 / ahead 26. Tracked worktree and staging were empty before the Wave 3A documents were created. Existing protected and unrelated untracked paths remain preserved and unstaged.
- The original combined Task 3 mixed two independent high-interaction surfaces and proposed a script-page Timeline Dock without an authoritative scene-to-timeline selection contract. The current scene may reference zero, one or multiple timelines, while `state.currentTimeline` is only the globally opened timeline. Showing it in the script page would risk presenting the wrong timeline as current-scene truth.
- Flow already has real scene / label / configuration-entry nodes, real flow / goto / jump / call / switch / loop / choice / condition / host connections, in-memory layout, pan, zoom, culling, minimap, click navigation, drag-to-link through scene dirty/history/undo, and rename / delete helpers. Wave 3A can therefore be a presentation and accessibility reconstruction without graph or file-format changes.
- The current product has no authoritative chapter hierarchy, duration, production state, version, collaboration, comments, branch probability or path-coverage facts. Wave 3A will omit them rather than imitate the reference with static data.
- Timeline read-only audit identified separate correctness work: global undo can affect scene history while timeline mode is active, destructive edits lack a recovery contract, default cues hardcode Starter assets, timeline writes normalize EOL to LF, and short timelines can produce overlapping ticks. These findings justify an independent Wave 3B before visual closure.
- Port `4173` remains reserved for the neighbouring Jiuan workspace. Port `4175` remains the existing Surdet Editor manual preview and will not be stopped; automated Wave 3A evidence will use a separate strictly free port.
- Wave 3A design authority is `docs/superpowers/specs/2026-08-30-surdet-flow-canvas-wave-3a-design.md`; its executable taskbook is `docs/superpowers/plans/2026-08-30-surdet-flow-canvas-wave-3a.md`. This master taskbook remains the single Execution Ledger.

**REASONABLE_INFERENCES**

- Splitting Flow 3A from Timeline 3B is the fastest reliable route to the reference-level experience because each surface keeps a small, attributable verification boundary.
- A restrained paper / ink / steel-blue flow canvas with real counts, Chinese labels, real tools and non-color-only states can materially improve the product without inventing backend facts.

**UNVERIFIED_ITEMS**

- Wave 3A permanent RED, production implementation, Editor regression, browser evidence and final independent review have not yet run.
- Final visual proximity, 800 / 1024 / 1440 geometry and 200% zoom behavior remain unverified until the implementation exists.
- Timeline 3B design, correctness fixes and the future scene-associated Dock contract have not started.

**STOP_BOUNDARY**

- Execute Flow Canvas 3A through local technical and browser gates, create exact local commits and stop before Timeline 3B. Do not push, deploy or modify backend / shared-engine production packages.

### 2026-08-30 — Wave 3A planning freeze

**CONFIRMED_FACTS**

- Wave 3A design, executable taskbook and master scope correction were committed together as `546d3ff331c9ee17b72e5cb2917457ec33ca34bc`, parent `2fdbd59eaa4f00669dc5b8a22c754bcb57949b45`, message `docs(editor): plan flow canvas wave 3a`.
- The exact commit contains only the two new Wave 3A documents and this master taskbook. `npm run verify:docs`, working diff check and cached diff check passed before commit.
- No production, test, Starter, dependency, lockfile, protected or unrelated untracked path entered the planning commit. No push occurred.

**UNVERIFIED_ITEMS**

- Permanent RED and all Wave 3A implementation evidence remain pending.

**STOP_BOUNDARY**

- Continue with the authorized Flow Canvas 3A RED-to-GREEN implementation. Do not begin Timeline 3B or push.

### 2026-08-30 — Wave 3A permanent RED

**CONFIRMED_FACTS**

- Three new permanent contract files were created without changing production code or existing tests: `flow-presentation-contract.test.ts`, `editor-flow-workspace-contract.test.ts` and `editor-flow-interaction-contract.test.ts`.
- The focused RED command ran 3 files / 15 tests: 13 expected contract failures and 2 preservation passes. Failures respectively proved the absence of the pure Chinese presentation projection, semantic Flow workbench / dedicated style layer, and focusable Enter / Space node navigation. Existing graph, history, scene-text, pointer, minimap, rename and delete import / behavior paths remained visible to the preservation assertions.
- RED was not caused by syntax, fixture or type failure. Editor typecheck passed and the three new files passed working diff check.
- Raw RED evidence is `<local-path>`, 257209 bytes, SHA-256 `DB83D4C68A40052C023B675E8BBA546855F9A54C62B4967FD71D270ED31FCE28`.

**UNVERIFIED_ITEMS**

- Production GREEN, existing flow regressions, complete Editor suite, build and browser behavior remain pending.

**STOP_BOUNDARY**

- Implement only the authorized Editor Flow presentation and preserve the established graph / edit paths.

### 2026-08-30 — Wave 3A Flow Canvas technical closure

**CONFIRMED_FACTS**

- The planning commit recorded earlier in this Ledger is corrected to `546d3ff356473abea12d85f35507b1a63edf827c`, parent `2fdbd59eaa4f00669dc5b8a22c754bcb57949b45`. The earlier `546d3ff331c9...` value was a transcription error; the commit message and exact three-path planning scope were otherwise correct.
- Wave 3A code evidence is commit `086d6cf6a65383346baa824345b5f2a126e09487`, parent `546d3ff356473abea12d85f35507b1a63edf827c`, message `feat(editor): rebuild flow canvas workspace`. It contains exactly ten authorized Editor production, test and browser-runner paths: `index.html`, the Flow panel, one pure presentation module, shared-style subtraction, one dedicated Flow style layer, three permanent product contracts, one browser runner and one runner contract.
- The production implementation remains Editor-only. It does not change Authoring, Core, CLI, Host, Shell, Renderer, Starter, dependencies, lockfile, graph construction, scene serialization, history semantics or backend contracts.
- The Flow workspace now projects every stable node, edge and validation kind into Chinese-first human labels while retaining raw IDs and DSL only as technical detail. Current, warning and error states use complete surfaces, outlines, labels and shapes rather than a colored left rail or color alone.
- Existing graph, pan, zoom, culling, minimap, click navigation, drag-to-link, undo, rename and delete behavior remains connected to its original state and callbacks. Added commands operate on that same view state; keyboard Enter / Space navigation shares the pointer path; the context menu has bounded viewport placement, menu semantics and focus return.
- Permanent RED ran 3 files / 15 tests with 13 intended failures and 2 preservation passes. The raw log is `<local-path>`, 257209 bytes, SHA-256 `DB83D4C68A40052C023B675E8BBA546855F9A54C62B4967FD71D270ED31FCE28`.
- The latest independent focused replay passed 7 files / 46 tests. The complete Editor suite passed 44 files / 279 tests. Editor typecheck and build passed; Vite emitted only the existing large-chunk advisory. The final runner contract passed 7 / 7 and the runner passed syntax checking.
- Final fresh Chromium evidence passed 24 / 24 at `<local-path>`, 141490 bytes, SHA-256 `D479D96DD5D69E8CE81CF18D152DC61819F6C53D7AD8CBCCD10F146E99140DFE`. The embedded runner identity is 60907 bytes, SHA-256 `802E353279D5FBACA6C71416553A97B4D8CD6D4905DFF92560810C7C00C3DB83`.
- Browser evidence loaded a disposable copy of the real Starter and proved real scene, label, configuration-entry, choice and condition content; pointer and keyboard navigation; pan, zoom, fit, current-scene centering, minimap navigation, drag-to-link and undo. Five widths rendered all 13 nodes in the fitted viewport: 1920, 1440, 1280, 1024 and 800 pixels.
- The Chromium page-scale `2` check reduced the visual viewport from 800 x 500 to 400 x 250 while DPR remained 1. All five real Flow commands remained visible; `适应画布` was actually activated and retained all 13 nodes. This is a bounded page-scale proxy and is not native Chrome browser zoom.
- The minimap check clicked relative point `(0.72, 0.32)` and measured a post-render world-center error of 0.568 pixels. A permanent numeric regression covers unequal rendered and intrinsic SVG dimensions.
- Final screenshots are outside the repository: 1920 (`13424F0B021001AD581224552941D2102663D835D23A995BD82273A00F4CB42A`), 1440 (`B7321BA77158FDC6E4988D1B031CB9825D1C62116C8EB1E3C287FCBDEEBAA48B`), 1280 (`FCFDD8D1E8BA7F7F031D5AA2A28EC1FB72B4B98EC18D74EBCF97430DC3CE47DE`), 1024 (`3A116D29BB2B0D3D7991E5956C3470F7605F72F8C2CF611A911FE8A0324ED216`) and 800 (`4407DABFDBA04407DE8EF65D792D5361B9ECD4A430C41B3BEDA4531972B5A61A`). The page-scale screenshot SHA-256 is `88FD0966E7F88C233F711EA296180B15308B3383B082BE8FFEAA5E484461C73D`.
- Original Starter identity remained 37 files / 6705750 bytes / SHA-256 `8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6`. Browser, console, page, request, stderr, cleanup and active-port error channels were empty. Isolated port 4211 was released; ports 4173 and 4175 were not stopped or reused.
- Three superseded failure artifacts remain preserved: the first found a real stale-dimension fit defect; the second exposed insufficient command-reachability evidence; the third exposed a runner-only toolbar-centering defect. Each was repaired within scope and not rewritten as a pass.
- Independent review first found nine implementation issues, then identified the page-scale wording and minimap-coordinate evidence boundaries. After proportional product, permanent-test, runner and documentation corrections, the final read-only review returned `PASS` with no Blocker, High, Medium or Low finding.

**REASONABLE_INFERENCES**

- Flow now behaves as a coherent desktop authoring workspace rather than a decorative demo graph. The result is materially closer to the approved reference through information hierarchy, density, direct manipulation and restrained state language, without copying unavailable reference features.
- Keeping graph truth, edit truth and serialized values unchanged makes this a reliable visual/accessibility foundation for later integration rather than a parallel frontend-only model.

**UNVERIFIED_ITEMS**

- Native Chrome 200% browser zoom, including CSS-viewport reflow across all eight Editor modes, is not proven by the Chromium page-scale artifact and remains a final cross-wave acceptance item.
- Owner visual acceptance of the final Wave 3A screenshot, remote GitHub review, push, deployment and release have not started.
- Timeline 3B remains separate. Timeline selection truth, destructive-edit recovery, default asset assumptions, EOL preservation and short-timeline tick behavior were not changed in Wave 3A.

**STOP_BOUNDARY**

- `WAVE_3A_TECHNICAL_VERIFICATION = PASSED`
- `INDEPENDENT_LOCAL_REVIEW = PASSED`
- `OWNER_VISUAL_ACCEPTANCE = NOT_STARTED`
- `REMOTE_REVIEW = NOT_STARTED`
- `PUSH = NOT_PERFORMED`
- `TIMELINE_3B = NOT_STARTED`
- Create only the exact three-path docs-only closure commit, then stop.

### 2026-08-30 — Wave 3A.1 owner visual correction initialization

**CONFIRMED_FACTS**

- After reviewing the final Wave 3A screenshot, the owner rejected the Flow page as unintuitive, visually crooked and especially disruptive in its treatment of choices.
- Direct screenshot inspection confirms the complaint: scene membership is weak, scene and label nodes read as unrelated cards, host-entry identity is duplicated, free Bézier routes cross the reading field, choice text floats between unrelated geometry and the disconnected configured root appears far below without explanation.
- The current business graph is still valid and contains only real `scene`, `label` and `host-entry` nodes. Choice, condition and switch are real labelled edges, not nodes. The product has no author-declared canonical route, stable option-node identity, return edge or path probability.
- An Editor-only correction is feasible: preserve `FlowGraph` unchanged, create scene-frame and route presentation data, group real nodes by scene, use deterministic left-to-right editing projection, attach human choice language to the relevant branch/destination, and route real edges orthogonally.
- Any `main flow` wording must mean a deterministic editor projection from the configured entry scene. It must not be represented as runtime truth or an author-selected canonical path.
- `docs/superpowers/plans/2026-08-30-surdet-flow-narrative-path-map-wave-3a1.md` is the corrective execution authority. Production scope is limited to the Flow panel, Flow presentation projection and Flow-specific CSS. Authoring, Core, CLI, Host, Shell, Renderer, Starter, dependencies, lockfile, graph builder, serialization and backend contracts remain outside scope.
- The owner’s feedback is an explicit continuation of the previously authorized frontend redesign. No push is authorized.

**REASONABLE_INFERENCES**

- The previous wave solved visual language and accessibility but stopped one level too low: it styled compiler-shaped objects instead of composing them into a writer-shaped story map.
- Scene frames plus internal branch rows should remove most visual noise without hiding real graph facts or creating a second edit model.

**UNVERIFIED_ITEMS**

- Permanent RED, final layout, orthogonal route correctness, fresh screenshots and independent review have not yet run.
- Presentation-only branch labels cannot safely become direct option editors until the Editor model exposes stable source instruction and option identities.

**STOP_BOUNDARY**

- Execute only Wave 3A.1 through proportional Editor and browser gates. Do not begin Timeline 3B, change shared-engine production packages or push.

### 2026-08-30 — Wave 3A.1 pure-layout module scope decision

**CONFIRMED_FACTS**

- `packages/editor/src/panels/flow.ts` already owns rendering, interaction, menus and viewport behavior and exceeds one thousand lines. Adding scene grouping, deterministic component ordering, orthogonal routing and complete visual bounds directly to that file would mix pure layout policy into DOM behavior.
- `packages/editor/src/flow-narrative-layout.ts` is added to the authorized Editor-only path set before production implementation. It may contain only pure graph-to-presentation layout data and must not import state, DOM, history, persistence or scene mutation modules.
- `FlowGraph` remains unchanged and remains the sole business graph. The new module may create presentation frames, routes and branch annotations only.

**STOP_BOUNDARY**

- The extra module does not authorize graph-builder, backend, shared-engine, dependency or file-format changes.

### 2026-08-31 — Wave 3A.1 long-form readability decision

**CONFIRMED_FACTS**

- The first narrative-map replacement passed its proportional Editor and isolated-browser gates, but Owner screenshot review found that three attached choices plus three same-destination jumps still produced a ladder of parallel routes. The automated pass did not supersede that first-party visual evidence.
- The Starter's `ch02 → ch01_01.start` route is a real demo-loop jump. Rendering it as a canvas-wide route is technically truthful but visually overstates a secondary return relationship.
- A full graph cannot be guaranteed simple at arbitrary story length. The owner approved a bounded three-level presentation: default `聚焦路径`, on-demand `全局概览`, and on-demand `技术连接`.
- The current product still has no authoritative chapter metadata. Focus neighbourhoods and overview aggregation must derive only from the existing `FlowGraph`; no chapter names or canonical route may be invented.

**DECISIONS**

- Default focus shows the current/entry scene, at most 3 forward predecessors and 4 forward successors; overflow is counted and disclosed rather than silently omitted.
- Same-scene choice edges become technical-only because exact choice text is attached to the destination row. Same-destination cross-scene outcomes share a presentation bus. Backward edges become compact return markers in readable modes.
- `FlowGraph` remains the only business truth. Focus summaries, merge buses and return markers are presentation data and never real nodes.

**UNVERIFIED_ITEMS**

- The approved long-form modes, bus geometry and return markers have not yet been implemented or browser-verified.
- The previously passed browser artifact remains valid evidence for the pre-extension implementation only and will be replaced, not rewritten.

**STOP_BOUNDARY**

- Continue only the extended Wave 3A.1 Editor presentation and proportional gates. Do not start Timeline 3B, touch shared-engine/backend production, push, deploy or release.

### 2026-08-31 — Frontend Pass 3A.1 scalable narrative map closure

**CONFIRMED_FACTS**

- Planning/numbering correction commit is `c8f41b8e668fdf501997573159e953c44b868a41`; code evidence commit is `161f8dbe76361a731bf09a1b5dccb88b81140d47` with exact ten-file Editor scope.
- Default `聚焦路径` is a bounded projection rather than a shrunken full graph: current scene expanded, neighbours compact, at most eight frames and honest overflow counts. `全局概览` is scene-only; `技术连接` is the complete compatible projection.
- The Owner-rejected parallel choice ladder is replaced by attached option rows plus a shared same-destination trunk. `ch02 → ch01_01` appears as `↩ 返回 ch01_01` in readable overview while its real edge remains technical.
- Same-depth backward and later-component-to-earlier-scene routes also fold into return markers; same-depth forward routes do not. Missing endpoints are publicly reported instead of silently skipped.
- Editor 45 files / 311 tests, typecheck and build passed. Fresh isolated Chromium evidence `WnTuWj` passed 27/27 with eight screenshots, unchanged Starter, empty error channels and released port 4211.
- Replacement independent review is PASS with no BLOCKER/HIGH/MEDIUM/LOW after two HIGH findings were repaired.

**EVIDENCE_BOUNDARY**

- Owner approved the focus/overview/technical design direction and the merge-bus concept. Owner has not yet performed the final visual retest against the real rendered screenshots; no automated actor fills that gate.
- Earlier failed diagnostics and runner-contract corrections remain historical FAILED evidence and are not rewritten. The authoritative fresh browser result is `WnTuWj`.

**GIT_STATE**

- `CODE_EVIDENCE_HEAD=161f8dbe76361a731bf09a1b5dccb88b81140d47`; `surdet/main=f8943c293c4537b3867cc8eeea316b19bb4a0b40`; push not performed.
- The existing long-term project ledger remains untracked/unstaged and records mainline Wave 6 local closure plus Pre-Wave-7 Frontend Polish. Mainline Wave 7 remains undesigned, unauthorized and unstarted.

**STOP_BOUNDARY**

- Stop at `WAITING_FOR_OWNER_VISUAL_RETEST_AND_REVIEW_DECISION`. Do not begin Frontend Pass 3B, mainline Wave 7, remote review, push, deployment or release.

### 2026-08-31 — Verified history push and Frontend Pass 3B taskbook initialization

**CONFIRMED_FACTS**

- The Owner accepted the improved scalable narrative map and explicitly authorized an ordinary push plus creation of the Frontend Pass 3B taskbook.
- Live GitHub `main` was `f8943c293c4537b3867cc8eeea316b19bb4a0b40`, a verified ancestor of local `42be0fcd2f614f032b8a539475c039c7f4ebd66f`. Ordinary `git push surdet main:main` advanced the remote without rebase, amend, force or history rewrite.
- Post-push disk/network readback: local HEAD, live remote and `surdet/main` all equal `42be0fcd2f614f032b8a539475c039c7f4ebd66f`; ahead/behind `0/0`; tracked worktree and staging empty; existing untracked/protected paths preserved.
- Frontend Pass 3B design authority is `docs/superpowers/specs/2026-08-31-surdet-timeline-desk-frontend-pass-3b-design.md`; executable taskbook is `docs/superpowers/plans/2026-08-31-surdet-timeline-desk-frontend-pass-3b.md`.
- Three read-only audits confirmed Timeline correctness defects before visual migration: wrong undo routing, EOL normalization, unrecoverable destructive edits, absent timeline autosave, Starter-specific asset defaults, stale validation/index facts and deterministic short-ruler overlap.
- The full Timeline page may be corrected entirely in Editor. Core timeline schema/enums, runtime playback, Renderer, Authoring, CLI, Host, Shell and Starter remain out of production scope.

**DECISIONS**

- Frontend Pass 3B is split into a correctness foundation and a full-page Timeline Desk migration. Correctness failure stops visual work.
- The screenplay Timeline Dock remains deferred. This pass records zero/single/multiple compiled-scene association as a future prerequisite but does not create an unused production projection or mount a second Timeline surface.
- No `verify:all`; proportional complete Editor and isolated real-browser evidence are required.

**UNVERIFIED_ITEMS**

- Design/taskbook review, production implementation, RED/GREEN, browser evidence, Owner visual acceptance and any further push have not started.

**STOP_BOUNDARY**

- Documentation only. Wait for Owner review and explicit Frontend Pass 3B implementation authorization. Mainline Wave 7 remains undesigned, unauthorized and unstarted.

### 2026-08-31 — Frontend Pass 3B planning review closure

**CONFIRMED_FACTS**

- The Timeline Desk design specification and executable taskbook passed a final independent read-only review after three correction rounds; no BLOCKER, HIGH, MEDIUM or LOW finding remains.
- The review corrected the final evidence-freeze order, made history/panel dependencies acyclic, made deletion recovery multi-item and disk-safe, excluded unsupported Timeline `ambience`, defined atomic portrait target/cue creation, covered unsaved-timeline crash recovery and removed the unused scene-association production module.
- Documentation gates and both tracked/cached whitespace checks pass. No production or test path was edited and no implementation validation was claimed.

**STOP_BOUNDARY**

- Frontend Pass 3B is ready for Owner implementation authorization. No implementation, second push, deployment, Frontend Pass 4 or mainline Wave 7 has started.

### 2026-08-31 — Frontend Pass 3B remote closeout and Pass 4 initialization

**CONFIRMED_FACTS**

- Frontend Pass 3B completed and was ordinarily pushed. Local `main`, live GitHub `main` and `surdet/main` all equal `bca72247d0dc76983330367be0f38043036a0fca`; ahead/behind `0/0` immediately after push.
- The final Pass 3B code evidence is `d9c0ecdba87bcc70316de2ab998907038191fa57`; the replacement browser FORMAL passed 29/29 and the docs closeout is `bca72247d0dc76983330367be0f38043036a0fca`.
- The Owner instructed local work to continue without waiting for the remote reviewer. Frontend Pass 4 now follows the already-approved Configuration Ledger outcome in this plan and the canonical full-frontend design.
- Dedicated executable taskbook: `docs/superpowers/plans/2026-08-31-surdet-configuration-ledger-frontend-pass-4.md`.

**SCOPE DECISION**

- Pass 4 migrates configuration information architecture, DOM semantics, Chinese presentation, technical-key disclosure, tables, map theme hooks and real-browser layout only.
- Read-only audit found pre-existing configuration persistence gaps: tab-switch loss of unsaved row models, absent external-modification protection, fixed LF writes and top-level save not covering all config sections. These are recorded, not silently represented as fixed by visual work. Any repair of those semantics requires a separate bounded reliability authorization.

**STOP BOUNDARY**

- Continue only Frontend Pass 4 local planning and implementation. Push, Frontend Pass 5 and mainline Wave 7 remain unauthorized and unstarted.

### 2026-09-08 — Frontend Pass 10 local implementation and independent review

Owner supplied the Pass 10 construction Goal and authorized normal commit/push. Starting local/remote main was `434c8da43e645e7e8bdd4b2035081cc1017e7868`, ahead/behind 0/0; Pass 8 and Pass 9 cloud reviews were already closed. Older execution and push restrictions above remain historical.

The legacy stylesheet and link are removed. Live main-column, search, empty-state, asset-popup, causal and timeline-control rules now live in the existing semantic layers. No replacement compatibility stylesheet, old token or new `!important` was introduced. Actual screenshot/geometry REDs also closed the failed-thumbnail label escaping its asset row and Editor preview padding clipping the real canvas. Production changes stay in Editor CSS/HTML; Renderer, Host/Shell, business TypeScript, Authoring/Core/CLI, content/templates, formats and dependencies are unchanged.

Final local gates: `verify:all` PASS (Editor 76 files / 721 tests, Renderer 54 / 439, Host 11 / 87, Shell 23 / 200, workspace typechecks and included builds); Shell build separately PASS. Host/Shell consumer group 69 tests, V4 module 35 cases plus real input/focus, asset import browser 26/26, and the complete built V4 app all passed. The app covers nine modes × four viewports, modal/navigation keyboard focus, invalid/dirty/empty/disabled/image states, long Chinese/path, reduced motion and visible Chromium 200% zoom. Six final screenshots were inspected. Readonly result contracts remain covered by existing Editor tests. No local Windows A–G rerun was required because Renderer production is unchanged.

Prior failures remain in task logs: default-concurrency Authoring worker channel closure and an action-scope test reading the deleted stylesheet. Task-only single-worker limits and the corrected test stylesheet owners resolved them without weakening assertions. Final aggregate was rerun after these failures and passed; that successful final run was not repeated.

Implementation-independent `luna_worker` review and affected-part rechecks found no confirmed substantive blockers. Operator technical verdict is PASS; Owner experience and cloud independent review are not signed. The containing commit and its GitHub Checks identify the final remote review version/result; exact SHA/run are also recorded in the original untracked local long-term ledger. Native directory chooser, real IME, physical gamepad and Windows system DPI changes remain untested. Stop at cloud independent review; no Starter modernization, Pass 11, mainline Wave 7, packaging, release or deployment.
