# Surdet Player Shell Foundation Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把玩家系统界面的来源/返回语义、固定系统界面槽位、默认壳编排和视觉主题令牌收回 Surdet 公共引擎层，让 Starter、《零点之后》和 CLI 新项目共享同一套行为契约。

**Architecture:** `@surdet/host` 在现有 `PlayerUiSession` / `PlayerInputGate` 上增加不可变 overlay 返回栈、固定系统槽注册表和显式 commands/queries 控制器；`@surdet/renderer` 继续只负责 Pixi 投影，用独立、可验证、不可变的 `RendererTheme` 取代各 Layer 重复的硬编码主题。游戏项目只提供内容、视图数据、存储适配和可选覆盖，不拥有第二套状态机。

**Tech Stack:** TypeScript 5.7、Node.js 20+、PixiJS 8、Vitest 3、Electron sandbox preload、Vite 6、Renderer v2 commands/queries、Shell Electron E2E。

## Global Constraints

- 冻结起点：`9bbec32946e169a5d081b29863edddaad64959fe`；开工时 `HEAD...surdet/main = 0 0`。
- 开工时 `git status --short` 允许四个受保护未跟踪文件，以及本任务书 `docs/superpowers/plans/2026-08-11-player-shell-foundation-wave-3.md` 这一份已获授权的新文件；Task 0 必须先提交任务书。Task 0 之后直到结束，status 只能保留四个受保护文件：`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`。四个文件不得修改、暂存、提交、删除或移动。
- 本轮固定命名 `PLAYER_SHELL_FOUNDATION_WAVE_3`，不是 M9；不得处理性能、Q1–Q5、门限、正式 A/B、发行或 EXE 打包。
- 引擎优先：行为必须落在 `packages/host` / `packages/renderer`；Starter、Zero 和 CLI 模板只接线与验收。禁止只改《零点之后》。
- 清洁室：不得复制 LetsGal 代码、JSON、字段组合、默认值、文案、色值、素材或 source map；只使用本文独立定义的 Surdet 接口。
- 游戏运行时继续 Pixi-only；不引入 React/Vue/DOM overlay，不新增 npm 依赖。
- 不改 `SaveSnapshot`、`SAVE_SCHEMA_VERSION`、存档目录、文件名或现有数据。“系统界面槽位”不是磁盘存档槽位。
- 保持 Electron `contextIsolation: true`、`sandbox: true`、preload 白名单和 AES-256-GCM 路径。
- 新生产代码只用 Renderer v2 commands/queries，不导入 `AdvRenderer`、`PixiStage` 或具体 Layer。
- 一版兼容窗口：现有 Session 与 Renderer commands 不删除；只做加法式升级。
- 公共查询只返回递归冻结 plain data，不暴露 Pixi 对象、Provider、回调或可写数组。
- 每 Task 必须 TDD：先红灯、后最小实现、再绿灯；真实结果写入台账。
- 每 Task 独立普通 commit；禁止 amend/rebase/reset/squash。完成后不 push，停在 `WAITING_FOR_REVIEW`。

---

## Scope

### 必须交付

1. Host 公共 overlay 返回栈，明确 title/game/system-menu 来源与返回。
2. Host 固定六个系统界面槽：title、system-menu、save-load、settings、gallery、backlog。
3. Host 公共 `PlayerShellController`，用显式 commands/queries 管理 open/close、operation、输入消费和 reset。
4. Renderer 公共 Theme token；Menu、Dialogue、Gallery、SystemPanel、Loading 共用。
5. Starter、Zero、CLI 模板消费同一 Controller/Registry/Theme。
6. 新增 Wave 3 Electron 矩阵，并复跑 Wave 2 A–I。
7. 更新能力矩阵、迁移文档、清洁室记录、计划台账和交付报告。

### 明确不做

- 不做可视化 UI Schema/编辑器、素材 manifest/扫描/缩略图、独立预览窗口或构建任务中心；这些分别留给 Wave 4–6。
- 不做插件市场、任意第三方 JS、云协作、热补丁、移动端、账号或遥测。
- 不改剧情、美术、音频、存档内容；不重新设计默认视觉。

---

## Frozen Interfaces

### Overlay 返回栈（`packages/host/src/player-ui.ts`）

```ts
export interface PlayerOverlayFrame {
  readonly base: PlayerBase;
  readonly overlay: PlayerOverlay;
}

export interface PlayerUiSessionSnapshot {
  readonly base: PlayerBase;
  readonly overlay: PlayerOverlay;
  readonly operation: PlayerOperation;
  readonly interfaceHidden: boolean;
  readonly videoActive: boolean;
  readonly returnStack: readonly PlayerOverlayFrame[];
}
```

- `openOverlay()` 仍只从 `overlay='none'` 打开，并压入当前 frame。
- 新增 `pushOverlay(overlay)`：从活动 overlay 打开子界面并压栈。
- `closeOverlay()` 弹出并恢复一帧；栈空则回当前 base 的 none。
- 新增 `dismissOverlays()`：清栈回 none，用于成功读档、返回标题和 reset。
- operation origin 保存完整 snapshot；fail 恢复完整栈，complete 默认清栈。
- snapshot 根对象、数组和 frame 全冻结；reset 清栈。

### 固定系统槽（`packages/host/src/player-shell-slots.ts`）

```ts
export const PLAYER_SHELL_SLOT_IDS = [
  'title', 'system-menu', 'save-load', 'settings', 'gallery', 'backlog',
] as const;
export type PlayerShellSlotId = typeof PLAYER_SHELL_SLOT_IDS[number];
export type PlayerShellSource = 'title' | 'game' | 'system-menu';

export type PlayerShellOpenRequest =
  | { readonly slot: 'title'; readonly source: 'title' | 'game' }
  | { readonly slot: 'system-menu'; readonly source: 'game' }
  | { readonly slot: 'save-load'; readonly source: PlayerShellSource; readonly mode: 'save' | 'load' }
  | { readonly slot: 'settings'; readonly source: PlayerShellSource }
  | { readonly slot: 'gallery'; readonly source: 'title' | 'game' }
  | { readonly slot: 'backlog'; readonly source: 'game' };

export interface PlayerShellSlotContext {
  readonly source: PlayerShellSource;
  readonly returnTo: PlayerOverlayFrame;
}
export interface PlayerShellSlotProvider {
  readonly id: string;
  open(request: PlayerShellOpenRequest, context: PlayerShellSlotContext): void;
  close(): void;
}
export interface PlayerShellSlotBindingSnapshot {
  readonly slot: PlayerShellSlotId;
  readonly providerId: string;
  readonly overridden: boolean;
}
export interface PlayerShellSlotRegistry {
  open(request: PlayerShellOpenRequest, context: PlayerShellSlotContext): void;
  close(slot: PlayerShellSlotId): void;
  snapshot(): PlayerShellSlotRegistrySnapshot;
}
export interface PlayerShellSlotRegistrySnapshot {
  readonly bindings: readonly PlayerShellSlotBindingSnapshot[];
}
export function createPlayerShellSlotRegistry(options: {
  readonly defaults: Readonly<Record<PlayerShellSlotId, PlayerShellSlotProvider>>;
  readonly overrides?: Readonly<Partial<Record<PlayerShellSlotId, PlayerShellSlotProvider>>>;
}): PlayerShellSlotRegistry;
```

`createPlayerShellSlotRegistry({ defaults, overrides })` 的 defaults 六项缺一不可；override 只能覆盖固定 ID。未知 ID 抛 `PLAYER_SHELL_SLOT_UNKNOWN`；Provider 失败包装为 `PLAYER_SHELL_SLOT_FAILED` 并保留 cause。快照按固定数组排序并递归冻结，不暴露 Provider。

### 显式 Controller（`packages/host/src/player-shell-controller.ts`）

```ts
export interface PlayerShellCommands {
  open(request: PlayerShellOpenRequest): void;
  close(): void;
  beginOperation(operation: Exclude<PlayerOperation, 'idle'>): void;
  completeOperation(options?: CompletePlayerOperationOptions): void;
  failOperation(error: unknown): void;
  consumePointer(): void;
  reset(base?: PlayerBase): void;
}
export interface PlayerShellQueries {
  snapshot(): PlayerUiSessionSnapshot;
  slots(): PlayerShellSlotRegistrySnapshot;
  canAdvance(): boolean;
  canRollback(): boolean;
}
export interface PlayerShellController {
  readonly commands: PlayerShellCommands;
  readonly queries: PlayerShellQueries;
  decidePointer(pointer: PrimaryPointerLike): PointerDecision;
}
```

- open/close 采用 prepare → commit → provider 的原子路径；Provider 失败恢复旧 snapshot。
- failOperation 先恢复 origin，再上报一次；无错误边界时重新抛，不静默。
- Controller 组合现有 Session/InputGate，不复制输入规则。
- 槽位映射固定：title 使用 `dismissOverlays()+enterTitle()`；system-menu/settings/gallery/backlog 对应同名 `PlayerOverlay`；save-load 对应 `PlayerOverlay='save-load'` 并由 request.mode 区分 save/load。非法 source/slot 组合在调用 Provider 前抛 `PLAYER_SHELL_SOURCE_INVALID`。

### Renderer Theme（`packages/renderer/src/theme.ts`）

```ts
export interface RendererTheme {
  readonly colors: {
    readonly canvas: number; readonly scrim: number; readonly panel: number;
    readonly surface: number; readonly surfaceStrong: number; readonly line: number;
    readonly accent: number; readonly accentSoft: number; readonly text: number;
    readonly textMuted: number; readonly textDisabled: number;
    readonly textOnAccent: number; readonly danger: number;
  };
  readonly opacity: {
    readonly scrim: number; readonly panel: number; readonly surface: number;
    readonly line: number; readonly disabled: number;
  };
  readonly typography: {
    readonly titleSize: number; readonly headingSize: number; readonly bodySize: number;
    readonly uiSize: number; readonly captionSize: number;
    readonly titleLetterSpacing: number; readonly uiLetterSpacing: number;
  };
  readonly spacing: { readonly xs: number; readonly sm: number; readonly md: number; readonly lg: number; readonly xl: number };
  readonly radius: { readonly sm: number; readonly md: number; readonly lg: number };
}
export type RendererThemeOverrides = {
  readonly [K in keyof RendererTheme]?: Partial<RendererTheme[K]>;
};
export const DEFAULT_RENDERER_THEME: RendererTheme;
export function createRendererTheme(overrides?: RendererThemeOverrides): RendererTheme;
```

- 默认值机械迁移当前 Surdet 视觉；不采用竞品值。
- 颜色是 `0x000000..0xffffff` 有限整数；opacity 为 `0..1`；字号/间距/圆角为有限非负数。
- 未知键、NaN、Infinity、负数和越界抛 `RENDERER_THEME_INVALID`。
- 结果递归冻结，不冻结调用方 overrides。
- PreferenceCommands 增加同步 `setTheme(overrides)`；PreferenceQueries 增加 `theme()`。

---

### Task 0: 基线与清洁室记录

**Files:**
- Create: `docs/competitive-research/2026-08-11-surdet-player-shell-clean-room-decisions.md`
- Modify: 本计划

- [x] 运行 `git rev-parse HEAD`、ahead/behind、status、diff-check、tracked logs；必须确认 HEAD/远端同步，status 只有四个受保护文件加本任务书，且本任务书是唯一获准在 Task 0 纳入的既有未跟踪文件。
- [x] 清洁室文档写明：仅借鉴抽象思想；Surdet 独立六槽、Host Controller、Renderer v2、Pixi-only、sandbox、不可变快照；禁止复制的对象逐项列出。
- [x] 在台账记录真实基线并提交：

```powershell
git add docs/competitive-research/2026-08-11-surdet-player-shell-clean-room-decisions.md docs/superpowers/plans/2026-08-11-player-shell-foundation-wave-3.md
git commit -m "docs(engine): freeze player shell wave 3"
git log --oneline -1
```

---

### Task 1: PlayerUiSession 返回栈

**Files:**
- Modify: `packages/host/src/player-ui.ts`
- Modify: `packages/host/src/index.ts`
- Test: `packages/host/test/player-ui-coordination.test.ts`

- [x] 先写失败测试：game → system-menu → settings → close 回 system-menu → close 回 game；title → gallery → close；operation reject 恢复完整栈；success/dismiss/reset 清栈；根/数组/frame 冻结；篡改不污染；busy 时拒绝。
- [x] 红灯：

```powershell
npm run test -w @surdet/host -- --run test/player-ui-coordination.test.ts
```

Expected: 因 `returnStack` / `pushOverlay` / `dismissOverlays` 不存在失败。记录测试总数与首个失败。

- [x] 实现最小返回栈；内部数组永不直接返回；operation origin 保存完整 snapshot。
- [x] 绿灯与类型：

```powershell
npm run test -w @surdet/host -- --run test/player-ui-coordination.test.ts
npm run typecheck -w @surdet/host
```

- [x] 提交：

```powershell
git add packages/host/src/player-ui.ts packages/host/src/index.ts packages/host/test/player-ui-coordination.test.ts docs/superpowers/plans/2026-08-11-player-shell-foundation-wave-3.md
git commit -m "feat(host): add player overlay return stack"
```

---

### Task 2: 固定系统槽注册表

**Files:**
- Create: `packages/host/src/player-shell-slots.ts`
- Modify: `packages/host/src/index.ts`
- Create: `packages/host/test/player-shell-slots.test.ts`

- [x] 先写失败测试：六 defaults 完整；缺一构造失败；override 只替换对应槽；未知 ID 拒绝；open/close 各调用一次且 this 正确；cause 保留；snapshot 固定顺序、冻结、不暴露 Provider。
- [x] 红灯：`npm run test -w @surdet/host -- --run test/player-shell-slots.test.ts`。红灯证据为模块不存在，测试未收集。
- [x] 用固定数组驱动实现；不得用开放式字符串 Map 接受新 ID。
- [x] 绿灯：聚焦测试 5/5；Host typecheck 通过。
- [x] 提交：

```powershell
git add packages/host/src/player-shell-slots.ts packages/host/src/index.ts packages/host/test/player-shell-slots.test.ts docs/superpowers/plans/2026-08-11-player-shell-foundation-wave-3.md
git commit -m "feat(host): add fixed player shell slots"
```

---

### Task 3: PlayerShellController 原子协调

**Files:**
- Create: `packages/host/src/player-shell-controller.ts`
- Modify: `packages/host/src/player-ui.ts`
- Modify: `packages/host/src/index.ts`
- Create: `packages/host/test/player-shell-controller.test.ts`

- [x] 先写失败测试：title gallery；game system-menu/settings 双层返回；Provider open/close 抛错无半提交；save/load begin/fail 恢复栈且只报一次；无 onError 上抛；指针消费一次；queries 安全。
- [x] 红灯：`npm run test -w @surdet/host -- --run test/player-shell-controller.test.ts`。红灯证据为 Controller 模块不存在，测试未收集。
- [x] 实现 prepare/commit/rollback。Session 的 `restore` 严格校验 idle snapshot 后再冻结，未提供无验证写入口。
- [x] 绿灯：

```powershell
npm run test -w @surdet/host -- --run test/player-shell-controller.test.ts
npm run test -w @surdet/host
npm run typecheck -w @surdet/host
```

- [x] 提交：`git commit -m "feat(host): coordinate the default player shell"`，仅暂存本 Task 文件与台账。

---

### Task 4: RendererTheme 公共契约

**Files:**
- Create: `packages/renderer/src/theme.ts`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/renderer/src/api/renderer-commands.ts`
- Modify: `packages/renderer/src/api/renderer-queries.ts`
- Create: `packages/renderer/test/theme.test.ts`
- Modify: `packages/renderer/test/api/renderer-contract.test.ts`
- Modify: `packages/renderer/test/api/query-purity.test.ts`

- [x] 先写失败测试：完整默认值、局部深合并、结果递归冻结、输入不冻结；未知键、非法颜色/opacity、NaN、Infinity、负尺寸全部拒绝；API 含 setTheme/theme。
- [x] 红灯：

```powershell
npm run test -w @surdet/renderer -- --run test/theme.test.ts test/api/renderer-contract.test.ts test/api/query-purity.test.ts
```

- [x] 实现纯主题模块；枚举允许键；禁止修改默认对象。
- [x] 聚焦绿灯 + Renderer typecheck。
- [x] 提交：`git commit -m "feat(renderer): define immutable theme tokens"`。

---

### Task 5: 五类 Layer 主题接线

**Files:**
- Modify: `packages/renderer/src/runtime/create-renderer-runtime.ts`
- Modify: `packages/renderer/src/runtime/renderer-facade.ts`
- Modify: `packages/renderer/src/runtime/presentation-ports.ts`
- Modify: `packages/renderer/src/pixi-stage-host.ts`
- Modify: `packages/renderer/src/layers/menu/menu-layer.ts`
- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/src/layers/gallery/gallery-layer.ts`
- Modify: `packages/renderer/src/layers/system-panel/system-panel-layer.ts`
- Modify: `packages/renderer/src/loading-layer.ts`
- Test: `packages/renderer/test/theme.test.ts`
- Test: `packages/renderer/test/api/query-purity.test.ts`
- Test: `packages/renderer/test/integration/renderer-runtime.test.ts`
- Test: `packages/renderer/test/legacy/menu-layer.test.ts`
- Test: `packages/renderer/test/legacy/pixi-stage.test.ts`

- [x] 先写失败测试，通过 Runtime v2 调 `setTheme({colors:{accent:0x47c8ff}})`，证明五类真实 Layer 都收到主题；不能只测 Host 保存值。
- [x] 另测：一次 setTheme 只请求一帧；相同主题幂等；非法输入不改变旧值；disposed 遵守 RendererError；查询篡改不污染。
- [x] 红灯运行上述五个测试文件：首次生产接线前 5 个文件中已有 70/71 通过，新增真实 Runtime 断言因 Layer 没有 `setTheme` 而失败。
- [x] 机械迁移 Surdet 当前 `NIGHT_AZURE` / `MODERN_ADV` 默认值，不重新设计视觉。删除 Layer 内同义主题常量；确属玩法语义的色值必须注释说明。
- [x] 每个 Layer 实现 `setTheme(theme)`，只重绘 Graphics/TextStyle；不得销毁重建 Container、Texture、音频、监听器或资源 owner。
- [x] 绿灯与边界：

```powershell
npm run test -w @surdet/renderer -- --run test/theme.test.ts test/api/query-purity.test.ts test/integration/renderer-runtime.test.ts test/legacy/menu-layer.test.ts test/legacy/pixi-stage.test.ts
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
  npm run verify:renderer-boundaries
  npm run verify:renderer-legacy
```

- [x] 绿灯：5 个文件、71/71；Renderer typecheck/build、boundary 3/3 和 legacy 4/4 均通过；验证了单帧请求、同主题幂等、非法输入保留旧值、disposed 错误和资源计数不增长。
- [x] 提交：`git commit -m "feat(renderer): apply theme across player layers"`。

---

### Task 6: 三个正式入口统一接线

**Files:**
- Create: `packages/host/src/renderer-player-shell-slots.ts`
- Create: `packages/host/test/renderer-player-shell-slots.test.ts`
- Modify: `packages/host/src/index.ts`
- Modify: `examples/starter/src/main.ts`
- Modify: `examples/starter/test/player-ui-integration.test.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Create: `examples/zero-after-midnight/test/player-ui-integration.test.ts`
- Modify: `packages/cli/templates/game/src/main.ts`
- Modify: `packages/cli/test/new.test.ts`

- [x] 先写失败的架构/行为测试：三入口检查公共 `PlayerShellController`、Renderer-backed `createRendererPlayerShellSlots` 和 `createRendererTheme`；固定六槽 Registry 由该 Host helper 内部唯一创建，禁止入口复制 Registry 或创建局部 `systemMenuOpen/saveLoadOpen/galleryOpen/settingsOpen/onTitleScreen`。
- [x] 行为测试：Host helper 覆盖 title gallery close、game system-menu → settings close、save/load failure 回原页面；Starter/Zero/CLI 接线测试确认公共入口和 immutable Theme；Zero 保留既有 empty-load no-op 路径。
- [x] 红灯（生产接线前）：Host `renderer-player-shell-slots.test.ts` 3/3 失败（`createRendererPlayerShellSlots is not a function`）；Starter 聚焦 2/2 失败（缺 Controller/Renderer helper）；Zero 聚焦原有 22 项通过、新接线断言 1 项失败；CLI `new.test.ts` 2/3 通过、新 scaffold 断言失败。
- [x] Renderer-backed defaults 只依赖 Renderer v2 commands/queries 和调用方 view/callback factory；Host helper 内部调用固定 Registry，不导入 Layer/Pixi。
- [x] Starter、Zero 和 CLI 模板只提供内容/存储/回调；Controller 管来源/返回/busy/输入/reset，Registry 管固定默认与 override；Zero 没有专属 Controller 或复制 Host 源码。既有 `PlayerUiSession` 仅注入 Controller 并承载 interfaceHidden/video。
- [x] 绿灯：Host 全量 8 文件 49/49；Starter 全量 4 文件 7/7、typecheck/build；Zero 全量 21/21、integration 23/23、typecheck/build；CLI 全量 7 文件 86/86、typecheck/build；Host typecheck/build 通过；`git diff --check` 通过。
- [x] 提交：`git commit -m "refactor(player): adopt the public player shell"`。

---

### Task 7: Electron 玩家矩阵

**Files:**
- Create: `packages/shell/e2e/player-shell-wave-3.e2e.mjs`
- Modify: `packages/shell/package.json`
- Create: `packages/shell/test/player-experience-e2e-contract.test.ts`

- [x] 先写 E2E 契约红灯测试；首次运行 3 项契约断言因脚本、npm 命令和正式游戏路径约束缺失而失败，生产接线前完成。
- [x] 新脚本固定每 case 独立 Electron/userData：
  - A title → gallery → close：回 title，栈清零。
  - B game → system-menu → settings → close：先回 system-menu，再回 game。
  - C save reject：保留页面/栈/隐藏 rail；重试成功清零。
  - D load success → title：不恢复旧 menu，无 release failure。
  - E 不提供 override：六槽仍有默认 Provider，`overridden=false`。
  - F 测试 accent 同步到五类 Layer，再恢复默认；资源计数不增长。
- [x] artifact 固定含 `schemaVersion/status/formalGame/isolation/cases`、PlayerShell snapshot、binding snapshot、Renderer projection/resource、page/console/request/unhandled/release 数组；失败也落盘且退出非零。
- [x] npm 命令：`"e2e:player-shell-wave-3": "node e2e/player-shell-wave-3.e2e.mjs"`。
- [x] 先 smoke，再跑两轮 Wave 3；各 A–F 6/6，正式路径为 `E:\\surdet\\examples\\zero-after-midnight\\dist`；已记录绝对路径、字节和 SHA：smoke `<local-path>`（10334，`67676fe35cdcdac4ff41d06e6d0b57d2cb408dbfe447680d1721d6bc72c6ef64`）；round-1 `<local-path>`（60278，`c2ce916ac3be3952470f032939afd53ebea1c60c5118fa6b183b2a9f953f1a9f`）；round-2 `<local-path>`（60278，`c02ab654346bd9f540dab62f0f816f970cf5c346879b2cf3c022ebe3a76df941`）。
- [x] 再跑 `npm run e2e:player-experience -w @surdet/shell`，Wave 2 A–I 9/9；artifact `<local-path>`（729483，`cabe7851959283ef08f2fdd35e20622e861cc3e0aa2b85cad04305f43be654c4`）。旧 Wave 2 B 断言已按已冻结的 settings → system-menu → game 返回合同更新。
- [x] 提交：`git commit -m "test(shell): gate player shell wave 3"`，真实提交 `35b3009934b34a5683036eb412e5e0cb2940a1cd`。

---

### Task 8: 文档、全量门禁与交付报告

**Files:**
- Modify: `docs/capabilities.json`
- Regenerate: `docs/CAPABILITY-MATRIX.md`
- Create: `docs/player-shell-migration.md`
- Modify: `README.md`
- Modify: `docs/AI-GUIDE.md`
- Modify: 本计划
- Create last: `docs/ENGINE-PLAYER-SHELL-FOUNDATION-WAVE-3-DELIVERY-REPORT-2026-08-11.md`

- [ ] 能力矩阵新增 `player-shell-coordination` 与 `renderer-theme-tokens`，填写真实测试/文档路径；运行 `npm run docs:capabilities` 和 `npm run verify:docs`。
- [ ] 迁移文档必须含：旧手工编排 → Controller；六槽/default/override；来源返回；Theme override；一版兼容窗口；错误码；“UI 槽不是存档槽”。
- [ ] 串行执行最终门禁：

```powershell
npm run test -w @surdet/core
npm run test -w @surdet/renderer
npm run test -w @surdet/host
npm run test -w @surdet/shell
npm run test -w surdet-starter
npm run test -w zero-after-midnight
npm run test -w @surdet/cli
npm run verify:renderer-boundaries
npm run verify:renderer-legacy
npm run verify:tools
npm run verify:hygiene
npm run verify:all
npm run e2e -w @surdet/shell
npm run e2e:renderer-v2 -w @surdet/shell
npm run e2e:player-experience -w @surdet/shell
npm run e2e:player-shell-wave-3 -w @surdet/shell
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000
node examples/zero-after-midnight/scripts/check-assets.mjs
npm run typecheck -w zero-after-midnight
npm run build -w zero-after-midnight
git diff --check
git ls-files '*.log'
```

- [ ] Expected：全部退出 0；Zero 仍是 11 场景、23/23 分支、3 结局、44 项项目资产、0 模拟运行时错误；Electron 错误数组全空。
- [ ] 所有验证结束后才写报告。报告含：起点/HEAD、逐 Task 全 SHA、引擎/项目归属、红绿证据、六槽 fallback、返回栈真值表、五 Layer Theme、两轮 Wave 3 与一轮 Wave 2 artifact 路径/字节/SHA、门禁、受保护文件、延期项和性能红灯保留声明。
- [ ] 提交文档：`git commit -m "docs(engine): publish player shell wave 3"`。
- [ ] 报告提交后机器复核：

```powershell
$report = 'E:\surdet\docs\ENGINE-PLAYER-SHELL-FOUNDATION-WAVE-3-DELIVERY-REPORT-2026-08-11.md'
Get-Item -LiteralPath $report | Select-Object FullName,Length,LastWriteTime
Get-FileHash -Algorithm SHA256 -LiteralPath $report
git rev-parse HEAD
git rev-list --left-right --count HEAD...surdet/main
git status --short
git diff --check
git ls-files '*.log'
```

- [ ] 不 push，停止等待独立复审。

---

## Acceptance

只有全部成立才能交付：

1. 返回栈、六槽、Controller、Theme 均在引擎包并从公共 index 导出。
2. Starter、Zero、CLI 模板消费公共接口，无同义局部状态机。
3. 漏项目 override 时默认壳仍可用。
4. title/game/system-menu 返回与存读档 success/failure 均通过真实 Electron。
5. Theme 确实投影到五类 Layer，且不增长资源、不暴露可写引用。
6. Wave 2 A–I 9/9；Wave 3 A–F 两轮各 6/6；正式路径是 Zero dist。
7. 全量门禁通过；不得删断言、放宽检查、挑绿或更换默认游戏。
8. 报告真实存在，路径/字节/SHA/commit/ahead 可复现。
9. 未 push、未进入 M9、未处理性能、未发行、未触碰受保护文件。

最终状态只能写：

```text
PLAYER_SHELL_FOUNDATION_WAVE_3_IMPLEMENTED
ENGINE_FIRST_OWNERSHIP_VERIFIED
PLAYER_OVERLAY_RETURN_STACK_IMPLEMENTED
FIXED_PLAYER_SHELL_SLOTS_IMPLEMENTED
RENDERER_THEME_TOKENS_IMPLEMENTED
WAVE_2_REGRESSION_RETAINED
PERFORMANCE_WORK_DEFERRED
PERFORMANCE_MEASUREMENT_NOT_QUALIFIED_RETAINED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_REVIEW
```

## Later Waves — 本轮不得提前做

1. Wave 4：Asset manifest、扫描、缩略图、恢复、模板导入、许可证台账。
2. Wave 5：只读 UI Schema + lint + Runtime 投影，再评估可视化编辑器。
3. Wave 6：独立预览窗口、类型化协议、可取消构建任务中心。
4. Audio Engineering Program：等待音频工程师交接报告后单独设计。

## Execution Ledger

| Task | Red evidence | Green evidence | Commit | Review status |
| --- | --- | --- | --- | --- |
| 0 | N/A（文档基线任务无红灯） | HEAD `9bbec32946e169a5d081b29863edddaad64959fe`；任务书 25173 字节 / SHA-256 `639A934053C9879DFABAA287B71E3CC3010B2F5E3249004CC02EC923C5DA2D65`；清洁室记录已创建；修正后 diff-check 通过；tracked logs 为空 | `445cf5106f9ca9c0401044b7e9cfa121c45ffcb4`（Task 0 基线提交） | implemented |
| 1 | 13 项中 5 项失败；首个失败为快照缺少 `returnStack`，随后 `session.pushOverlay is not a function`；红灯发生于生产代码修改前 | 聚焦测试 13/13；`npm run typecheck -w @surdet/host` 通过；覆盖嵌套返回、title/gallery、失败恢复、成功清栈、reset、递归冻结、篡改隔离和 busy 拒绝 | `a6286a2581db40a6683136a4a015045b5f3250e5` | implemented |
| 2 | 测试先于生产代码运行；模块不存在导致测试未收集（1 个测试文件失败、0 个测试收集） | 固定槽测试 5/5；Host typecheck 通过；覆盖六 defaults、缺失 default、未知 override/open、this 绑定、cause 保留、冻结快照和 Provider 隔离 | `c4ffce8737e6326309076a27622200ee969ebd26` | implemented |
| 3 | 测试先于生产代码运行；Controller 模块不存在导致测试文件失败、0 项收集 | Controller 聚焦 8/8；Host 全量 7 文件、46/46；Host typecheck 通过；覆盖来源校验、title/gallery、双层返回、Provider open/close 原子回滚、save/load 失败恢复和错误边界、指针消费与查询纯度 | `112351ee9e7a2a3b1e6f4d2a7b2fbe7e754815b3` | implemented |
| 4 | 主题模块不存在，且运行时 `preferences.theme()` 不存在；聚焦命令 2 个测试套件失败（主题套件无法收集，查询纯度 1 项失败） | Theme/contract/query-purity 3 文件、19/19；Renderer typecheck 通过；Facade/兼容 ports 提供冻结主题的最小契约实现，尚未接线 Layer | `8843b9b5071718f234f7a9273efac866118bb777` | implemented |
| 5 | 5 个聚焦文件首次运行 70/71；新增真实 Runtime 断言因 `setTheme` 尚未存在而失败 | 5 文件、71/71；Renderer typecheck/build；boundary 3/3；legacy 4/4；单帧、幂等、非法输入、disposed、资源计数和五类真实 Layer 接收主题均通过 | `7dc7668ae9e41a332d05c319d82ec79e4be55497` | implemented |
| 6 | Host/Starter/Zero/CLI 聚焦红灯已保留：Host 3/3 因 `createRendererPlayerShellSlots is not a function` 失败；Starter 2/2、Zero 新接线断言、CLI scaffold 断言分别因公共 Controller/helper/Theme 接线不存在而失败；其余既有 Zero 22 项通过 | Host 全量 8 文件 49/49；Starter 全量 7/7、typecheck/build；Zero 全量 21/21、integration 23/23、typecheck/build；CLI 全量 86/86、typecheck/build；Host typecheck/build；Renderer-backed helper 只依赖 public commands/queries 并内部唯一创建固定六槽 Registry；`git diff --check` 通过 | `8032f1e24b5c4ecbcf88823f74686f408043b814` | implemented |
| 7 | 契约红灯 3 项失败（脚本/命令/正式路径约束尚未存在）；首轮正式 A–F 为 5/6，B 在 settings 关闭后暴露真实父 system-menu 未重新投影；新增 Host 回归在修复前收到 `open:system-menu, open:settings, close:settings`，缺少父槽位 `open:system-menu`；旧 Wave 2 B 断言也因新返回合同暂时失败 | Host 全量 8 文件 50/50；Host typecheck；Shell 契约 3/3、Shell typecheck；最终 smoke 1/1；Wave 3 两轮各 A–F 6/6，正式 Zero dist、每案独立 Electron/userData，错误数组为空；Wave 2 A–I 9/9；`git diff --check` 通过；tracked logs 为空。Controller 关闭嵌套 overlay 后按返回栈重新投影父槽，E2E 使用真实 requestAnimationFrame 等待呈现动画完成；artifact 路径/字节/SHA 已写入本行 | `35b3009934b34a5683036eb412e5e0cb2940a1cd` | implemented |
| 8 | pending | pending | pending | not-started |
