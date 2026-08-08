# Surdet Engine Experience Optimization Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This project uses one execution AI; do not dispatch parallel workers.

**Goal:** 在不重复现有能力、不改变剧情语义和正式发行安全边界的前提下，先稳定文档事实、仓库卫生、Profile 与宿主复用边界，再完成 CI、加载体验、资源队列、回退、转场与震动、环境音分层、快捷键、Backlog 搜索、CLI 统计和开发热更新。

**Architecture:** 优化按“先校正文档与仓库 → 抽出 Profile/Host 边界 → 建立持续验证 → 改善启动与资源 → 增加可恢复状态 → 扩出演出和作者工具”的顺序串行实施。通用宿主流程进入 `@surdet/host`，规则继续留在 headless core，投影继续留在 renderer；PixiStage 本轮保持兼容 Facade，新能力放入独立控制器而不是继续堆进单文件。所有视觉能力必须服从 reduced-motion 与 FrameScheduler，所有新增状态必须可验证、可释放、可存取或明确排除在存档之外。

**Tech Stack:** TypeScript 5.7、Node.js >=20、Vitest 3、PixiJS、Howler、Vite 6、Electron 43、GitHub Actions、PowerShell。

## Global Constraints

- 仓库：`E:\surdet`；基线提交：`3ecd43a`；分支：`main`；基线远端：`surdet/main`。
- 基线工作树只有 `USER.md`、`SESSION-HANDOFF.md` 两个刻意未提交的内部文件。必须保留它们；不得执行 `git reset --hard`、`git clean -fd`、`git checkout -- .`、批量格式化或覆盖式代码生成。
- 执行前必须保存 `git status --short`；每个任务只暂存/提交本任务明确列出的文件。未获得项目所有者另行授权时，不 commit、不 push。
- 只允许一个执行 AI 串行工作；不得派生并行执行者，不得让多个任务同时修改 `pixi-stage.ts`、`audio-manager.ts` 或正式游戏宿主。
- 不把 `zero-after-midnight`、`prologue`、正式标题或正式素材名硬编码进通用引擎。
- 不改变现有 DSL 指令语义；新增 DSL 必须同步修改 compiler、lint、renderer、editor 指令清单、文档与测试。
- 不削弱 release 包强制加密、显式目标、受控 `.pack-stage`、身份校验和 SDAT2 验证。
- 不删除、迁移或读取用户真实 `userData`；EXE 验收必须使用独立临时用户目录。
- 任何常驻动画都必须服从 `PresentationPreferences.reducedMotion`，且静止画面仍允许 FrameScheduler 停止 ticker。
- `PixiStage` 在本轮继续作为公共 Facade；新增加载、转场、Backlog 查询等实现必须放入独立模块，由 Facade 转发。除纯转发、字段装配和兼容清理外，`pixi-stage.ts` 本轮净新增不得超过 150 行。
- 新增缓存必须有容量上限、活动资源保护、清理入口和生命周期测试。
- 正式游戏现状是启动时枚举并加载全部可运行素材；不得把它误写成“运行时完全按需加载”。
- 本计划不授权完整 LSP、纹理图集、BitmapText 全量迁移、确定性重放、完整多语言目录或插件 DSL 扩展。
- 本计划不授权完整重写 PixiStage、删除 Facade、战斗阵型编辑或战斗阶段模型重构。

---

## Recommendation Disposition

| 原建议 | 本计划决定 | 理由 |
| --- | --- | --- |
| A1 可注册转场 | 本轮实施，先交付 fade/slide/circle；blur 仅在性能门禁通过时启用 | 建立扩展接口，避免一次引入四套高风险滤镜 |
| A2 立绘差分图层 | 后续候选，本轮禁止实施 | 需要素材规范、存档投影和编辑器联合设计 |
| A3 呼吸/眨眼/微动 | 后续候选，本轮禁止实施 | 会改变静态休眠策略，必须另做功耗与 reduced-motion 设计 |
| A4 多轨 BGM | 本轮改写为 BGM + ambience 双层模型 | 不把刚稳定的 BGM 缓存直接重构成无限轨道 |
| A5 方向化震动 | 本轮实施 | 边界清晰，可复用现有 tween/updateEffects |
| B1 DSL REPL | 后续候选 | 价值明确但不优先于 CI、热更新和统计 |
| B2 DSL LSP | 后续候选 | 需要独立协议与编辑器扩展项目 |
| B3 热重载 | 本轮实施，范围仅 Vite 游戏宿主 | 先验证场景替换与位置安全，不改 Electron 正式包 |
| B4 时间轴预览器 | 已有基础，本轮不重做 | editor 已有 timeline panel/model/preview |
| B5 统计仪表盘 | 本轮只补 CLI 结构化输出 | editor 已有 stats 面板与纯统计逻辑 |
| C1 纹理图集 | 后续候选 | 需要构建、加密、Pixi loader 和增量构建共同设计 |
| C2 预加载策略 | 本轮实施通用优先级队列与进度；场景静态分析延后 | 先消除启动黑箱并建立数据基线 |
| C3 文字渲染缓存 | 后续候选 | Ruby 对象池已经完成，先测量再决定 BitmapText |
| C4 帧预算管理 | 已有监控，本轮只增加验收阈值，不做任务延迟器 | FrameScheduler 与 RenderPerformanceMonitor 已存在 |
| D1 插件增强 | 已有基础，本轮不扩 API | plugin-host 已有隔离、版本和生命周期 |
| D2 确定性重放 | 后续候选 | PRNG 与外部副作用需要单独设计规格 |
| D3 多语言架构 | 已有 key-value 基础，本轮不扩目录级 i18n | core/renderer localization 已存在 |
| D4 Rollback | 本轮实施完整检查点，不采用“只存 position + variables” | 避免画面、音频与剧情状态错位 |
| D5 鉴赏/音乐室/回顾 | 已有基础，本轮不重做 | gallery UI 已覆盖 CG、音乐、文本回顾 |
| D6 自动回归管线 | 本轮实施 | 当前 CI 仍监听 master 且只验证 starter |
| E1 自定义字体 | 已有三角色字体基础，本轮不开放任意文件 | 涉及文件选择、安全与字体授权 |
| E2 快捷键自定义 | 本轮实施安全的预设映射 | 先做可验证预设，不做任意冲突绑定 UI |
| E3 Backlog 搜索 | 本轮实施 | 纯过滤逻辑与现有 Backlog UI 可增量接入 |
| E4 加载画面 | 本轮实施 | 与资源进度队列同一交付单元 |

### Additional Architecture Recommendation Disposition

| 新建议 | 本计划决定 | 理由 |
| --- | --- | --- |
| 能力矩阵与 README 同步 | 本轮 P0 实施 | README 已存在可复现的事实矛盾，属于审计噪声来源 |
| 文档归档规则 | 本轮 P0 实施 | `3ecd43a` 已纳入大量交接材料，需要明确正式文档与历史证据边界 |
| 仓库卫生门禁 | 本轮补充可执行检查 | `.gitignore` 已基本治理，仍缺 staged/tracked 自动检查 |
| `@surdet/host` | 本轮有界实施 | 两个宿主超过 1300 行且高度重复，但只抽公共流程，不吸收游戏规则 |
| Profile 存储桥 | 本轮实施 | 通关记录直接写 localStorage，桌面原子写入与版本边界缺失 |
| PixiStage 完整分层 | 后续独立重构，本轮只建立模块化新增边界 | 3502 行搬迁会与本轮加载、转场、Backlog 修改形成高冲突大爆炸式变更 |
| 战斗阵型与阶段模型 | 后续独立产品项目 | 属于 headless 规则、快照和 UI 联合设计，不是当前缺陷修复 |
| 演出与性能扩展 | 保留本计划原有实施范围 | 转场、ambience、资源队列、诊断已经有明确任务与门禁 |

---

## File Map

### New files

- `docs/capabilities.json`：当前能力的机器可读单一事实源。
- `docs/capability-matrix.md`：由能力事实源生成的人类可读矩阵。
- `docs/archive/README.md`：正式文档、验收证据、历史交接和内部记忆的归档规则。
- `scripts/render-capability-matrix.mjs`：生成或 `--check` 验证能力矩阵。
- `scripts/check-repo-hygiene.mjs`：检查 tracked/staged 临时产物，不删除文件。
- `packages/host/package.json`、`packages/host/tsconfig.json`、`packages/host/tsconfig.build.json`：`@surdet/host` workspace 配置。
- `packages/host/src/types.ts`：宿主 adapters、callbacks、overlay 与 feature flags 公共契约。
- `packages/host/src/profile-store.ts`：ProfileStorage、版本 envelope、内存与浏览器实现。
- `packages/host/src/create-host.ts`：通用 system routing、pause/resume、reset 与 dispose 控制器。
- `packages/host/src/system-router.ts`：可选系统 adapter 注册、路由和 exactly-once 恢复。
- `packages/host/src/save-hooks.ts`：通用 SaveManager system hooks 聚合。
- `packages/host/src/index.ts`：公共导出。
- `packages/host/test/profile-store.test.ts`：Profile 版本、损坏数据和兼容回退测试。
- `packages/host/test/create-host.test.ts`：可选系统、暂停恢复、覆盖层关闭和错误隔离测试。
- `packages/shell/src/profile-store.ts`：Electron `userData/profile/` 文件实现与 key/size/envelope 校验。
- `packages/shell/test/profile-store.test.ts`：桌面 Profile key、原子写入与损坏回退测试。
- `packages/renderer/src/loading-progress.ts`：资源作业、优先级、并发加载与进度快照的纯逻辑。
- `packages/renderer/src/loading-layer.ts`：加载覆盖层视图与对象生命周期；PixiStage 只装配和转发。
- `packages/renderer/test/loading-progress.test.ts`：顺序、并发、失败收敛和进度测试。
- `packages/renderer/src/rollback-buffer.ts`：带容量上限的完整运行时检查点缓冲。
- `packages/renderer/test/rollback-buffer.test.ts`：不可变性、容量和回退顺序测试。
- `packages/renderer/src/transition-registry.ts`：转场注册表、名称验证和活动转场契约。
- `packages/renderer/src/world-effects-controller.ts`：内置转场、方向震动和 reduced-motion 生命周期。
- `packages/renderer/test/transition-registry.test.ts`：注册、重复、未知转场和释放测试。
- `packages/renderer/src/keybindings.ts`：动作、默认预设、规范化与冲突检查。
- `packages/renderer/src/backlog-search-controller.ts`：Backlog 查询输入状态和投影，不读写 DOM HTML。
- `packages/renderer/test/keybindings.test.ts`：损坏设置回退、冲突和事件匹配测试。
- `packages/core/src/project-stats.ts`：可由 editor 与 cli 共用的项目统计纯函数。
- `packages/core/test/project-stats.test.ts`：字数、角色、分支、结局、未到达场景和资源引用测试。
- `packages/cli/src/stats.ts`：`surdet stats` 命令与 JSON/文本输出。
- `packages/cli/test/stats.test.ts`：命令输出和失败退出测试。
- `packages/renderer/src/scene-hot-reload.ts`：场景替换决策、PC clamp 和诊断的纯逻辑。
- `packages/renderer/test/scene-hot-reload.test.ts`：同 ID 替换、编译失败保留旧场景和位置修复测试。

### Modified files

- `README.md`：删除与现状冲突的“未实现”描述，链接能力矩阵。
- `.gitignore`：只在卫生测试发现遗漏时追加精确规则，不得用宽泛目录通配掩盖源码。
- `package-lock.json`：注册 `@surdet/host` workspace 后由 `npm install --package-lock-only` 更新。
- `.github/workflows/ci.yml`：监听 main，验证正式游戏 lint/simulate/assets 和 P1/P2 门禁。
- `packages/shell/src/main.ts`、`packages/shell/src/preload.ts`：Profile IPC 桥和受信 sender 检查。
- `packages/shell/src/json-file.ts`：复用既有原子 JSON 写入，不复制实现。
- `packages/cli/templates/game/package.json`、`examples/starter/package.json`、`examples/zero-after-midnight/package.json`：声明 `@surdet/host` 依赖。
- `packages/renderer/src/index.ts`：导出本轮新增公共模块。
- `packages/renderer/src/types.ts`：加载、转场、方向震动和 ambience 的可选接口。
- `packages/renderer/src/pixi-stage.ts`：加载覆盖层、转场注册与方向震动投影、Backlog 查询投影。
- `packages/renderer/test/pixi-stage.test.ts`：加载层、转场、震动和 Backlog 查询生命周期。
- `packages/renderer/src/audio-manager.ts`：单一 ambience 循环轨及其生命周期。
- `packages/renderer/test/audio-manager.test.ts`：BGM/ambience 隔离、淡出、缓存和 dispose。
- `packages/renderer/src/settings-store.ts`：快捷键预设持久化和损坏输入回退。
- `packages/renderer/test/settings-store.test.ts`：新增设置回归。
- `packages/renderer/src/backlog.ts`：规范化搜索与结果索引。
- `packages/renderer/test/adv-renderer.test.ts`：Backlog 搜索结果与回放语音保持关联。
- `packages/core/src/index.ts`：导出共享统计 API。
- `packages/editor/src/stats.ts`、`packages/editor/test/stats.test.ts`：迁移到 core 统计，不改变面板结果。
- `packages/cli/src/index.ts`：注册 `stats` 命令。
- `packages/cli/src/lint.ts`、`packages/core/src/dsl/compiler.ts`、`packages/core/src/scene-lint.ts`：新增转场与 ambience 指令白名单及诊断。
- `packages/editor/src/panels/editor.ts`、`packages/editor/src/assets.ts`：新增指令补全与素材引用识别。
- `examples/starter/src/main.ts`、`packages/cli/templates/game/src/main.ts`：加载进度、快捷键预设、回退和热更新参考接线。
- `examples/zero-after-midnight/src/main.ts`：正式游戏接线与诊断探针，不含游戏 ID 特判。
- `docs/AI-GUIDE.md`：新增 DSL、加载、回退、快捷键与开发热更新说明。
- `package.json`：新增稳定的正式项目验证命令。

---

### Task 0: Freeze and Verify the Baseline

**Files:**
- Read: `docs/PROJECT-GENERAL-MANAGER-HANDOFF-2026-08-08.md`
- Read: `docs/ENGINE-AUDIT-REMEDIATION-DELIVERY-REPORT-2026-08-08.md`
- Create during execution: none

**Interfaces:**
- Consumes: HEAD `3ecd43a`、已同步的 `surdet/main` 和两个受保护内部文件。
- Produces: 执行报告中的基线证据；不产生源码接口。

- [ ] **Step 1: Record the protected baseline**

Run:

```powershell
Set-Location E:\surdet
git rev-parse --short HEAD
git branch --show-current
git status --short
git rev-list --left-right --count HEAD...surdet/main
```

Expected: HEAD 为 `3ecd43a` 或其后继提交；分支为 `main`；`git rev-list --left-right --count HEAD...surdet/main` 在执行开始时为 `0 0`；只保留 `USER.md`、`SESSION-HANDOFF.md`，不执行清理。

- [ ] **Step 2: Run the pre-change gate**

Run:

```powershell
npm run typecheck
npm test
npm run lint -w surdet-starter
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight
node examples/zero-after-midnight/scripts/check-assets.mjs
npm run e2e -w @surdet/shell
git diff --check
```

Expected: 全部退出码为 0；单测 702 或更多；正式模拟保持 24 paths、23/23 choices、39 save/load、3 endings、0 errors；素材为 44。

- [ ] **Step 3: Stop on baseline regression**

If any command fails, do not edit source. Record the exact command, exit code and first actionable error in the delivery report, then return control to the project owner.

---

### Task 1: Establish Documentation Truth and Repository Hygiene

**Files:**
- Create: `docs/capabilities.json`
- Create: `docs/capability-matrix.md`
- Create: `docs/archive/README.md`
- Create: `scripts/render-capability-matrix.mjs`
- Create: `scripts/check-repo-hygiene.mjs`
- Modify: `README.md`
- Modify: `docs/ENGINE-OPTIMIZATION-RECOMMENDATIONS-2026-08-08.md`
- Modify only if a missing exact rule is demonstrated: `.gitignore`
- Modify: `package.json`
- Test through executable check modes: the two new scripts

**Interfaces:**
- Produces: `npm run docs:capabilities:check`, `npm run verify:hygiene`.
- Produces capability schema:

```ts
interface CapabilityRecord {
  id: string;
  kind: 'dsl' | 'system' | 'ui' | 'tooling';
  core: 'implemented' | 'n/a' | 'planned';
  renderer: 'implemented' | 'n/a' | 'planned';
  editor: 'implemented' | 'n/a' | 'planned';
  host: 'implemented' | 'n/a' | 'planned';
  tests: string[];
  docs: string[];
  limitation?: string;
}
```

- [ ] **Step 1: Capture the current contradictions as a failing check fixture**

The initial `docs/capabilities.json` must include at least `particle`, `mov`, `tint`, `clear`, `gallery-text`, `battle-move`, `battle-formation`, `profile-storage`, `transition-registry`, `ambience`, `rollback`, and `hot-reload`. Mark only evidence-backed current capabilities as `implemented`; mark future work as `planned` with a limitation.

Run before correcting README:

```powershell
node scripts/render-capability-matrix.mjs --check
```

Expected: FAIL because the generated matrix is absent or stale. The script must not write in `--check` mode.

- [ ] **Step 2: Implement deterministic generation and validation**

`scripts/render-capability-matrix.mjs` must:

```js
const mode = process.argv[2] ?? '--write';
if (!['--write', '--check'].includes(mode)) process.exitCode = 2;
```

It validates unique kebab-case IDs, known enum values, non-empty test evidence for every `implemented` record, sorts by `kind` then `id`, and renders `docs/capability-matrix.md`. In `--check`, compare bytes and exit 1 on drift; in `--write`, use an atomic temp-file rename.

- [ ] **Step 3: Correct README from evidence, not prose memory**

Remove the contradictory claims that `@particle/@mov/@tint`, text replay UI and battle movement are unimplemented. Keep honest limitations for battle formation, cross-save Backlog and features still marked `planned`. Add:

```markdown
当前能力与证据索引见 [Capability Matrix](docs/capability-matrix.md)。README 只保留产品概览；能力状态以该矩阵及其测试路径为准。
```

Also correct the recommendation document's opening claim: `3ecd43a` publishes the audit remediation and this Wave 1 plan; it does not prove that Tasks 1–13 in this plan have already been implemented.

- [ ] **Step 4: Define archive classes without moving history in this wave**

`docs/archive/README.md` must define four classes:

1. maintained technical documentation under `docs/`;
2. current implementation plans/specs under `docs/superpowers/`;
3. immutable acceptance evidence and historical handoffs eligible for a separately approved archive move;
4. internal AI/session memory (`USER.md`, `SESSION-HANDOFF.md`) that is never committed automatically.

Do not bulk-move the 113-file published history in this task; moving tracked history needs a separate owner-approved change.

- [ ] **Step 5: Implement a non-destructive hygiene gate**

The script accepts exactly one mode:

```text
node scripts/check-repo-hygiene.mjs --tracked
node scripts/check-repo-hygiene.mjs --staged
```

It obtains paths from `git ls-files` or `git diff --cached --name-only --diff-filter=ACMR`, normalizes `/`, and rejects:

```js
const forbidden = [
  /(^|\/)\.vite\//,
  /(^|\/)(\.opensquilla|\.superpowers|memory)\//,
  /(^|\/).*\.log$/i,
  /^shot.*\.(png|mjs)$/i,
  /^(main\.js|preload\.js)$/i,
];
```

It reports every rejected path and never deletes or modifies a file. `USER.md` and `SESSION-HANDOFF.md` are not rejected by `--tracked`; their commit policy is documented, not silently enforced by filename.

- [ ] **Step 6: Register and verify both gates**

Add root scripts:

```json
"docs:capabilities": "node scripts/render-capability-matrix.mjs --write",
"docs:capabilities:check": "node scripts/render-capability-matrix.mjs --check",
"verify:hygiene": "node scripts/check-repo-hygiene.mjs --tracked"
```

Run:

```powershell
npm run docs:capabilities
npm run docs:capabilities:check
npm run verify:hygiene
git diff --check -- README.md docs/ENGINE-OPTIMIZATION-RECOMMENDATIONS-2026-08-08.md docs/capabilities.json docs/capability-matrix.md docs/archive/README.md scripts/render-capability-matrix.mjs scripts/check-repo-hygiene.mjs package.json
```

Expected: all exit 0; matrix includes evidence rows for the formerly contradictory features.

---

### Task 2: Add a Versioned Profile Storage Bridge

**Files:**
- Create: `packages/host/package.json`
- Create: `packages/host/tsconfig.json`
- Create: `packages/host/tsconfig.build.json`
- Create: `packages/host/src/types.ts`
- Create: `packages/host/src/profile-store.ts`
- Create: `packages/host/src/index.ts`
- Create: `packages/host/test/profile-store.test.ts`
- Create: `packages/shell/src/profile-store.ts`
- Modify: `packages/shell/src/main.ts`
- Modify: `packages/shell/src/preload.ts`
- Modify: `packages/shell/src/json-file.ts`
- Create: `packages/shell/test/profile-store.test.ts`
- Modify: `packages/cli/templates/game/package.json`
- Modify: `examples/starter/package.json`
- Modify: `examples/zero-after-midnight/package.json`
- Modify: `package-lock.json`
- Modify: `examples/starter/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`

**Interfaces:**
- Produces:

```ts
export interface ProfileStorage {
  read<T = unknown>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface ProfileEnvelope<T = unknown> {
  schemaVersion: 1;
  updatedAt: string;
  value: T;
}
export interface BrowserKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export class MemoryProfileStorage implements ProfileStorage {
  read<T = unknown>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
export class LocalStorageProfileStorage implements ProfileStorage {
  constructor(storage: BrowserKeyValueStorage, prefix?: string);
  read<T = unknown>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing host storage tests**

Tests must cover roundtrip, defensive cloning, delete, invalid key, non-JSON values, corrupt envelope and legacy localStorage fallback:

```ts
const storage = new MemoryProfileStorage();
await storage.write('clear-record', { endings: ['a'] });
const first = await storage.read<{ endings: string[] }>('clear-record');
first!.endings.push('b');
expect(await storage.read('clear-record')).toEqual({ endings: ['a'] });
```

Allowed keys match `/^[A-Za-z0-9._-]{1,80}$/`. Reject functions, symbols, bigint, cycles and serialized payloads larger than 1 MiB.

- [ ] **Step 2: Build the workspace without coupling core to renderer/Electron**

`@surdet/host` may depend on `@surdet/core` and `@surdet/renderer`; core must not depend on host. For Task 2, profile-store itself imports neither renderer nor Electron.

Run:

```powershell
npm install --package-lock-only
npm test -w @surdet/host -- profile-store.test.ts
```

Expected before implementation: FAIL; after minimal implementation: PASS.

- [ ] **Step 3: Add trusted Electron Profile IPC**

Expose only:

```ts
window.surdetProfile = {
  read: (key: string) => ipcRenderer.invoke('profile:read', key),
  write: (key: string, value: unknown) => ipcRenderer.invoke('profile:write', key, value),
  delete: (key: string) => ipcRenderer.invoke('profile:delete', key),
};
```

Main process handlers call `assertTrustedSender`, validate the key, and store one envelope per encoded key under `userData/profile/`. Reuse `writeJsonAtomic`; do not copy its temp/rename implementation. A corrupt file returns null after logging a warning and does not block game start.

- [ ] **Step 4: Preserve existing clear records without destructive migration**

Host read order is:

1. Electron Profile bridge;
2. if bridge returns null, legacy `localStorage['surdet:clearRecord']`;
3. default empty record.

On the next successful write, write the Profile bridge and leave the legacy localStorage value untouched. Do not delete, rename or enumerate user saves.

- [ ] **Step 5: Replace direct clear-record storage in both hosts**

Use the same key `clear-record` and an explicit versioned value schema. Ordinary save slots remain on `SaveStorage`; settings remain on `SettingsStorage`. Do not merge these stores.

- [ ] **Step 6: Verify bridge and compatibility**

Run:

```powershell
npm test -w @surdet/host -- profile-store.test.ts
npm test -w @surdet/shell -- profile-store.test.ts json-file.test.ts
npm run typecheck
npm run build -w surdet-starter
npm run build -w zero-after-midnight
```

Expected: PASS; damaged Profile data returns null; legacy browser clear record is readable; no real userData path is accessed in tests.

---

### Task 3: Extract a Bounded `@surdet/host` Runtime

**Files:**
- Create: `packages/host/src/create-host.ts`
- Create: `packages/host/src/system-router.ts`
- Create: `packages/host/src/save-hooks.ts`
- Modify: `packages/host/src/types.ts`
- Modify: `packages/host/src/index.ts`
- Create: `packages/host/test/create-host.test.ts`
- Create: `packages/host/test/system-router.test.ts`
- Modify: `examples/starter/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `packages/cli/templates/game/src/main.ts`
- Modify: `docs/AI-GUIDE.md`

**Interfaces:**
- Produces:

```ts
export interface HostSystemAdapter<TPayload = unknown> {
  readonly id: string;
  open(payload: TPayload, context: HostSystemContext): void | Promise<void>;
  reset?(): void;
  dispose?(): void;
}
export interface HostSystemContext {
  pause(): void;
  resume(): void;
  fail(error: unknown): void;
}
export interface DefaultHostOptions {
  interpreter: Interpreter;
  renderer: AdvRenderer;
  stage: AdvStage;
  adapters?: readonly HostSystemAdapter[];
  onError?: (error: unknown) => void;
  onStateReset?: () => void;
}
export interface DefaultHostController {
  routeSystem(id: string, payload: unknown): Promise<boolean>;
  reset(): void;
  dispose(): void;
}
export function createDefaultHost(options: DefaultHostOptions): DefaultHostController;
export interface HostStateAdapter {
  readonly id: string;
  snapshot(): unknown;
  validate(value: unknown): void;
  restore(value: unknown): void;
}
export function createSystemHooks(adapters: readonly HostStateAdapter[]): SystemHooks;
```

- [ ] **Step 1: Write contract tests before moving host code**

Tests must prove optional adapters, duplicate adapter rejection, unknown system returning false, pause-before-open, exactly-once resume, async failure recovery, state-reset closing adapters, and idempotent dispose.

```ts
const adapter = { id: 'battle', open: vi.fn(async (_payload, ctx) => ctx.resume()), reset: vi.fn() };
const host = createDefaultHost({ interpreter, renderer, stage, adapters: [adapter] });
expect(await host.routeSystem('battle', {})).toBe(true);
expect(adapter.open).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Keep game rules outside the host package**

`@surdet/host` routes and owns lifecycle only. Battle solving, calendar advancement, affection decisions, shop pricing, map content, gallery configuration, title copy and resource keys remain supplied by each game through adapters/callbacks.

- [ ] **Step 3: Extract system pause/resume and reset atomically**

The router must set an active adapter before calling `open`; `resume()` clears active state exactly once. On rejection/throw, it clears active state, calls `interpreter.resumeHost()` if paused, invokes `onError`, and never leaves the interpreter frozen.

- [ ] **Step 4: Extract common system save hooks**

`save-hooks.ts` accepts `HostStateAdapter[]` and returns the existing `SystemHooks` shape. Restore calls every participating adapter's `validate(value)` before invoking any `restore(value)` mutation; if any validator fails, none of the adapters restore. Duplicate IDs are rejected at construction.

- [ ] **Step 5: Migrate hosts one at a time with parity gates**

Order:

1. CLI template;
2. starter;
3. zero-after-midnight.

After each migration, run that workspace build/lint/test before touching the next. Do not perform a blind file-to-file copy. Preserve game-specific title, gallery, ending and resource behavior in the project.

- [ ] **Step 6: Enforce a measurable but non-gaming line reduction**

After both examples migrate, the combined host entry line count must fall by at least 350 lines relative to the recorded baseline `1328 + 1399 = 2727`, excluding comments added solely to game-specific configuration. If the reduction cannot be achieved without moving game rules into host, stop at the safe boundary and explain the shortfall; do not chase the metric by minifying code.

- [ ] **Step 7: Verify host parity**

Run:

```powershell
npm test -w @surdet/host
npm run typecheck
npm run lint -w surdet-starter
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight
npm run e2e -w @surdet/shell
```

Expected: PASS; formal simulation remains 24 paths, 23/23 choices, 39 save/load and 3 endings; system pause/resume behavior is unchanged.

---

### Task 4: Make CI Validate the Actual Mainline and Formal Game

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `lint`, `simulate`, asset check and `verify:p1p2` commands.
- Produces: `npm run verify:formal`; CI on `main` and pull requests.

- [ ] **Step 1: Add the formal verification command**

Modify the root scripts with this exact entry:

```json
"verify:formal": "npm run lint -w zero-after-midnight && npm run simulate -w zero-after-midnight && node examples/zero-after-midnight/scripts/check-assets.mjs"
```

- [ ] **Step 2: Run the command before changing CI**

Run:

```powershell
npm run verify:formal
```

Expected: exit 0 with 0 lint errors/warnings, 23/23 choices and `assets ok: 44`.

- [ ] **Step 3: Replace the stale branch and starter-only CI tail**

The workflow must contain these jobs/steps:

```yaml
on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - name: Install
        run: npm ci
      - name: Documentation truth
        run: npm run docs:capabilities:check
      - name: Repository hygiene
        run: npm run verify:hygiene
      - name: Typecheck
        run: npm run typecheck
      - name: Test
        run: npm test
      - name: Verify starter
        run: |
          npm run lint -w surdet-starter
          node packages/cli/dist/index.js simulate examples/starter --assume battleWon=true
      - name: Verify formal game
        run: npm run verify:formal
      - name: Verify P1/P2 gate
        run: npm run verify:p1p2
```

- [ ] **Step 4: Validate YAML and local equivalents**

Run:

```powershell
npm run verify:formal
npm run verify:p1p2
npm run docs:capabilities:check
npm run verify:hygiene
git diff --check -- .github/workflows/ci.yml package.json
```

Expected: all exit 0. Do not claim the hosted workflow passed until GitHub reports it.

---

### Task 5: Add a Bounded Priority Resource Queue and Loading Progress Model

**Files:**
- Create: `packages/renderer/src/loading-progress.ts`
- Create: `packages/renderer/test/loading-progress.test.ts`
- Modify: `packages/renderer/src/index.ts`

**Interfaces:**
- Produces:

```ts
export type AssetPriority = 'critical' | 'scene' | 'background';
export interface AssetLoadJob { id: string; priority: AssetPriority; load(): Promise<void>; }
export interface LoadingProgress { total: number; completed: number; failed: number; current: string | null; done: boolean; }
export class AssetLoadQueue {
  constructor(concurrency?: number);
  run(jobs: readonly AssetLoadJob[], onProgress?: (progress: LoadingProgress) => void): Promise<LoadingProgress>;
}
```

- [ ] **Step 1: Write failing queue tests**

Create tests covering priority, concurrency, duplicate IDs, failure convergence and immutable progress:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AssetLoadQueue } from '../src/loading-progress.js';

describe('AssetLoadQueue', () => {
  it('runs critical before scene before background while preserving order inside a priority', async () => {
    const order: string[] = [];
    const queue = new AssetLoadQueue(1);
    await queue.run([
      { id: 'b', priority: 'background', load: async () => { order.push('b'); } },
      { id: 'c', priority: 'critical', load: async () => { order.push('c'); } },
      { id: 's', priority: 'scene', load: async () => { order.push('s'); } },
    ]);
    expect(order).toEqual(['c', 's', 'b']);
  });

  it('settles failures and reports the final counts', async () => {
    const seen = vi.fn();
    const result = await new AssetLoadQueue(2).run([
      { id: 'ok', priority: 'critical', load: async () => {} },
      { id: 'bad', priority: 'scene', load: async () => { throw new Error('bad asset'); } },
    ], seen);
    expect(result).toMatchObject({ total: 2, completed: 1, failed: 1, done: true });
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ done: true }));
  });
});
```

- [ ] **Step 2: Verify the tests fail for the missing module**

Run:

```powershell
npm test -w @surdet/renderer -- loading-progress.test.ts
```

Expected: FAIL because `loading-progress.js` does not exist.

- [ ] **Step 3: Implement the queue with exact safety rules**

Implementation requirements:

```ts
const ORDER: Record<AssetPriority, number> = { critical: 0, scene: 1, background: 2 };

export class AssetLoadQueue {
  readonly concurrency: number;

  constructor(concurrency = 4) {
    this.concurrency = Math.max(1, Math.min(8, Math.floor(concurrency)));
  }

  async run(jobs: readonly AssetLoadJob[], onProgress?: (progress: LoadingProgress) => void): Promise<LoadingProgress> {
    const ids = new Set<string>();
    for (const job of jobs) {
      if (!job.id.trim() || ids.has(job.id)) throw new Error(`duplicate or empty asset job '${job.id}'`);
      ids.add(job.id);
    }
    const pending = jobs.map((job, index) => ({ job, index }))
      .sort((a, b) => ORDER[a.job.priority] - ORDER[b.job.priority] || a.index - b.index);
    let completed = 0;
    let failed = 0;
    let cursor = 0;
    const emit = (current: string | null, done = false): LoadingProgress => {
      const snapshot = { total: jobs.length, completed, failed, current, done };
      onProgress?.({ ...snapshot });
      return snapshot;
    };
    emit(null, jobs.length === 0);
    const worker = async (): Promise<void> => {
      while (cursor < pending.length) {
        const current = pending[cursor++]!.job;
        emit(current.id);
        try { await current.load(); completed += 1; }
        catch { failed += 1; }
        emit(current.id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, pending.length) }, () => worker()));
    return emit(null, true);
  }
}
```

Do not retain job closures after `run` returns. Do not add retries in this task.

- [ ] **Step 4: Export and verify**

Add:

```ts
export * from './loading-progress.js';
```

Run:

```powershell
npm test -w @surdet/renderer -- loading-progress.test.ts
npm run typecheck -w @surdet/renderer
```

Expected: PASS.

---

### Task 6: Project Loading Progress into Pixi and Wire Both Game Hosts

**Files:**
- Modify: `packages/renderer/src/types.ts`
- Create: `packages/renderer/src/loading-layer.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/test/pixi-stage.test.ts`
- Modify: `examples/starter/src/main.ts`
- Modify: `packages/cli/templates/game/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`

**Interfaces:**
- Consumes: `LoadingProgress`, `AssetLoadQueue` from Task 5 and shared host boundaries from Task 3.
- Produces:

```ts
AdvStage.showLoading?(progress: LoadingProgress): void;
AdvStage.hideLoading?(): void;
```

- [ ] **Step 1: Add a failing loading lifecycle test**

Add a PixiStage test that calls:

```ts
const stage = new PixiStage();
stage.showLoading({ total: 10, completed: 4, failed: 1, current: 'bg/title.png', done: false });
stage.showLoading({ total: 10, completed: 9, failed: 1, current: null, done: true });
stage.hideLoading();
stage.hideLoading();
stage.destroy();
```

Expected: no throw; repeated hide and destroy are idempotent.

- [ ] **Step 2: Implement one persistent loading module behind the Facade**

Create `LoadingLayer` in `loading-layer.ts`; PixiStage owns one instance and forwards `showLoading`/`hideLoading`. The module owns a dedicated container with a dark background, title, progress bar and status text. `showLoading` must update existing Graphics/Text objects rather than recreate them. Percentage is:

```ts
const settled = progress.completed + progress.failed;
const ratio = progress.total === 0 ? 1 : Math.max(0, Math.min(1, settled / progress.total));
```

The layer must be above world/dialog layers, below fatal DOM overlays, hidden by `resetSession`, and destroyed only by `PixiStage.destroy()`. Loading drawing/progress logic must not be duplicated inside PixiStage.

- [ ] **Step 3: Replace sequential formal asset loading with queue jobs**

In each host, keep the existing `register(rel, url)` behavior but create jobs:

```ts
const priorityFor = (rel: string): AssetPriority => {
  if (rel === 'bg/title_bg.png' || rel.startsWith('fonts/')) return 'critical';
  if (rel.startsWith('bg/') || rel.startsWith('portrait/') || rel.startsWith('avatar/')) return 'scene';
  return 'background';
};

const finalProgress = await new AssetLoadQueue(4).run(
  files.map((rel) => ({ id: rel, priority: priorityFor(rel), load: () => loadAndRegister(rel) })),
  (progress) => stage.showLoading(progress),
);
if (finalProgress.failed > 0) console.warn(`[assets] ${finalProgress.failed} asset(s) failed`);
stage.hideLoading();
```

`loadAndRegister` must revoke a Blob URL on registration failure and retain it only when registration succeeds. Fonts stay in the configured-font path but contribute critical progress jobs.

- [ ] **Step 4: Preserve diagnostics and add completion state**

Extend only the generic metrics payload:

```ts
get assetLoading(): LoadingProgress { return { ...lastLoadingProgress }; }
```

Do not expose asset bytes or decryption keys.

- [ ] **Step 5: Verify loading and packaged behavior**

Run:

```powershell
npm test -w @surdet/renderer -- pixi-stage.test.ts loading-progress.test.ts
npm run build -w surdet-starter
npm run build -w zero-after-midnight
npm run e2e -w @surdet/shell
```

Expected: all pass; formal game reaches `done=true`, retains 45 asset Blob URLs and 24 audio entries; loading layer is hidden before title interaction.

---

### Task 7: Add Correct Full-State Rollback

**Files:**
- Create: `packages/renderer/src/rollback-buffer.ts`
- Create: `packages/renderer/test/rollback-buffer.test.ts`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/audio-manager.ts`
- Modify: `packages/renderer/test/audio-manager.test.ts`
- Modify: `examples/starter/src/main.ts`
- Modify: `packages/cli/templates/game/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`

**Interfaces:**
- Produces:

```ts
export interface AudioPlaybackSnapshot { bgm: string | null; ambience: string | null; }
export interface RollbackFrame<TSnapshot> {
  snapshot: TSnapshot;
  presentation: unknown;
  audio: AudioPlaybackSnapshot;
}
export class RollbackBuffer<TSnapshot> {
  constructor(capacity?: number);
  push(frame: RollbackFrame<TSnapshot>): void;
  pop(): RollbackFrame<TSnapshot> | null;
  clear(): void;
  get size(): number;
}
```

- [ ] **Step 1: Write failing buffer tests**

Tests must prove deep immutability, last-in-first-out order and default capacity 50:

```ts
const source = { snapshot: { vars: { trust: 1 } }, presentation: { bg: 'room' }, audio: { bgm: 'night', ambience: 'rain' } };
const buffer = new RollbackBuffer<typeof source.snapshot>(2);
buffer.push(source);
source.snapshot.vars.trust = 9;
expect(buffer.pop()?.snapshot.vars.trust).toBe(1);
```

Use `structuredClone` when available and the project recursive clone convention otherwise; reject non-cloneable input with `TypeError`.

- [ ] **Step 2: Add audio snapshot support without exposing Howl**

Extend `AudioHandle` with optional methods:

```ts
snapshotPlayback?(): AudioPlaybackSnapshot;
restorePlayback?(snapshot: AudioPlaybackSnapshot): void;
```

`AudioManager.restorePlayback` must call public channel methods, never mutate cache maps directly.

- [ ] **Step 3: Integrate host checkpoints at stable text boundaries**

Subscribe to text events but defer capture until the interpreter finishes the current step:

```ts
bus.on('text', () => {
  queueMicrotask(() => {
    const snapshot = interp.saveSnapshot();
    if (!snapshot || interp.status === 'running') return;
    rollback.push({
      snapshot,
      presentation: stage.snapshotPresentation(),
      audio: audioManager.snapshotPlayback(),
    });
  });
});
```

Deduplicate consecutive frames by `sceneId + pc + sceneHash`. Clear the buffer on new game, title return and incompatible save load.

- [ ] **Step 4: Restore in the only safe order**

The rollback action must:

```ts
const frame = rollback.pop();
if (!frame) return false;
renderer.resetSession({ preserveWorld: false });
interp.loadSnapshot(frame.snapshot);
stage.restorePresentation(frame.presentation);
audioManager.restorePlayback(frame.audio);
return true;
```

Guard against rollback during `running`, video, battle, map, shop, save/load and settings overlays. It is enabled only in normal ADV text/choice states.

- [ ] **Step 5: Add input and command-rail entry**

Use action ID `rollback`; default key is `ArrowUp` only when Backlog is closed and choices are not active. Add a command-rail item labelled `回退` and disable it when the buffer is empty.

- [ ] **Step 6: Verify no side-effect duplication**

Add integration tests proving:

- a text checkpoint restores position, variables, presentation and audio;
- rollback does not re-fire achievements/autosave during restore;
- rollback cannot cross a system interaction boundary;
- 51 checkpoints retain only the newest 50.

Run:

```powershell
npm test -w @surdet/renderer -- rollback-buffer.test.ts audio-manager.test.ts adv-renderer.test.ts
npm test -w @surdet/core -- interpreter-save.test.ts
npm run typecheck
```

Expected: PASS.

---

### Task 8: Register Transitions and Add Directional Damped Shake

**Files:**
- Create: `packages/renderer/src/transition-registry.ts`
- Create: `packages/renderer/src/world-effects-controller.ts`
- Create: `packages/renderer/test/transition-registry.test.ts`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/test/pixi-stage.test.ts`
- Modify: `packages/renderer/src/adv-renderer.ts`
- Modify: `packages/renderer/test/adv-renderer.test.ts`
- Modify: `packages/core/src/dsl/compiler.ts`
- Modify: `packages/core/src/scene-lint.ts`
- Modify: `packages/core/test/compiler.test.ts`
- Modify: `packages/cli/test/lint.test.ts`
- Modify: `packages/editor/src/panels/editor.ts`
- Modify: `docs/AI-GUIDE.md`

**Interfaces:**
- Produces:

```ts
export type TransitionName = 'fade' | 'slide-left' | 'slide-right' | 'circle';
export interface StageTransition { readonly name: string; start(durationMs: number): void; update(deltaMs: number): boolean; cancel(): void; }
export class TransitionRegistry {
  register(transition: StageTransition): void;
  get(name: string): StageTransition | null;
  start(name: string, durationMs: number): boolean;
  update(deltaMs: number): boolean;
  cancelActive(): void;
}
export type ShakeDirection = 'both' | 'horizontal' | 'vertical' | 'diagonal';
```

- [ ] **Step 1: Test registry ownership**

Tests must prove valid IDs, duplicate rejection, unknown lookup returning null, `start()` returning false for an unknown name, and `cancelActive()` calling exactly one active transition cancel. `update()` returns false with no active transition and clears the active reference when the transition reports completion.

- [ ] **Step 2: Add DSL without overloading modifiers**

Use explicit instructions:

```gal
@transition slide-left 600
@shake horizontal 400 12
```

Compiler-known instructions must include `transition`; renderer parsing rules are:

```ts
const name = args[0] ?? 'fade';
const durationMs = boundedNumber(args[1], 600, 1, 10_000);
```

Unknown transition names produce a lint error, not a silent fallback. Existing `@wipe`, `@fadein` and `@fadeout` remain valid.

- [ ] **Step 3: Implement three built-ins in a world-effects controller**

- `fade`: old/new alpha cross-fade.
- `slide-left` and `slide-right`: move old/new world containers without changing their logical base positions.
- `circle`: animate one reusable Graphics mask radius; remove the mask on finish/cancel.

Every transition must use `presentationDuration`, request frames while active, restore final positions/alpha, and destroy only objects it owns. Calling a new transition cancels the previous one first.

PixiStage constructs `WorldEffectsController` with the existing world/background layers and forwards transition/shake/update/reset calls. The controller owns masks, transition state and shake state; do not add another independent ticker.

- [ ] **Step 4: Gate blur behind evidence**

Do not add `blur` unless a targeted performance test on the current Electron/Pixi renderer shows `maxUpdateMs <= 8` across 120 transition frames on the reference machine. If it fails, record blur as deferred in the delivery report; this does not fail Task 8.

- [ ] **Step 5: Implement direction and quadratic damping**

Shake amplitude must be:

```ts
const t = shakeRemain / shakeDuration;
const amplitude = shakeStrength * t * t;
```

Horizontal sets only X, vertical only Y, diagonal uses the same signed sample for X/Y, both keeps independent X/Y samples. On completion/cancel/reset, world position returns exactly to camera pan base.

- [ ] **Step 6: Verify lifecycle and reduced motion**

Run:

```powershell
npm test -w @surdet/renderer -- transition-registry.test.ts pixi-stage.test.ts adv-renderer.test.ts
npm test -w @surdet/core -- compiler.test.ts
npm test -w @surdet/cli -- lint.test.ts
npm run typecheck
```

Expected: PASS; reduced motion makes transitions finish in one update without leaving masks or offsets.

---

### Task 9: Add One Bounded Ambience Layer Beside BGM

**Files:**
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/audio-manager.ts`
- Modify: `packages/renderer/test/audio-manager.test.ts`
- Modify: `packages/renderer/src/adv-renderer.ts`
- Modify: `packages/renderer/test/adv-renderer.test.ts`
- Modify: `packages/renderer/src/settings-store.ts`
- Modify: `packages/renderer/test/settings-store.test.ts`
- Modify: `packages/core/src/dsl/compiler.ts`
- Modify: `packages/core/src/scene-lint.ts`
- Modify: `packages/cli/test/lint.test.ts`
- Modify: `packages/editor/src/assets.ts`
- Modify: `packages/editor/src/panels/editor.ts`
- Modify: `docs/AI-GUIDE.md`

**Interfaces:**
- Produces:

```ts
AudioHandle.playAmbience?(src: string | null, fadeMs?: number): void;
AudioHandle.setAmbienceVolume?(value: number): void;
AudioHandle.getAmbienceVolume?(): number;
```

- [ ] **Step 1: Write failing audio tests**

Tests must prove:

```ts
am.playBgm('music.ogg');
am.playAmbience('rain.ogg', 400);
expect(mockHowl).toHaveBeenCalledTimes(2);
am.playBgm('next.ogg');
expect(am.snapshotPlayback()).toEqual({ bgm: 'next.ogg', ambience: 'rain.ogg' });
```

Also cover same source in BGM and ambience creating distinct cache entries, ambience limit 8, active ambience protection, `stopAll`, `dispose`, and restore.

- [ ] **Step 2: Implement a finite channel**

Extend `AudioChannel` to `'bgm' | 'ambience' | 'se' | 'voice'` and limits to:

```ts
const CACHE_LIMITS = { bgm: 8, ambience: 8, se: 32, voice: 8 } as const;
```

Keep exactly one active ambience Howl. Switching ambience cross-fades and uses the existing epoch pattern so delayed stops cannot kill a reused current source.

- [ ] **Step 3: Add explicit DSL**

Use:

```gal
@ambience rain_window 800
@ambience off 500
```

`AdvRenderer` resolves the asset through the same audio resolver as BGM/SE. Missing assets remain non-fatal but emit the existing diagnostic path.

- [ ] **Step 4: Persist ambience volume**

Add `ambienceVolume: number` with default `0.7`, clamp `0..1`, and a settings row labelled `环境音量`. Do not reinterpret existing `bgmVolume` saves.

- [ ] **Step 5: Verify audio regression**

Run:

```powershell
npm test -w @surdet/renderer -- audio-manager.test.ts settings-store.test.ts adv-renderer.test.ts
npm test -w @surdet/core -- compiler.test.ts
npm test -w @surdet/cli -- lint.test.ts
npm run typecheck
```

Expected: PASS; existing BGM, SE and voice tests remain unchanged in meaning.

---

### Task 10: Add Safe Key Presets and Backlog Search

**Files:**
- Create: `packages/renderer/src/keybindings.ts`
- Create: `packages/renderer/test/keybindings.test.ts`
- Create: `packages/renderer/src/backlog-search-controller.ts`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/renderer/src/settings-store.ts`
- Modify: `packages/renderer/test/settings-store.test.ts`
- Modify: `packages/renderer/src/backlog.ts`
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/test/pixi-stage.test.ts`
- Modify: `examples/starter/src/main.ts`
- Modify: `packages/cli/templates/game/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`

**Interfaces:**
- Produces:

```ts
export type GameAction = 'advance' | 'auto' | 'skip' | 'backlog' | 'menu' | 'quickSave' | 'quickLoad' | 'rollback' | 'hideUi';
export type KeyPreset = 'standard' | 'left-handed';
export function bindingsForPreset(preset: KeyPreset): Readonly<Record<GameAction, readonly string[]>>;
export function actionForKeyboardEvent(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'metaKey'>, preset: KeyPreset): GameAction | null;
export function searchBacklog(entries: readonly BacklogEntry[], query: string): Array<{ index: number; entry: BacklogEntry }>;
```

- [ ] **Step 1: Write pure failing tests**

Key tests must reject dangerous browser/system chords and prove that presets contain no duplicate codes. Search tests must trim, lowercase Latin, preserve Chinese matching, return original indices and retain `voice`.

```ts
expect(searchBacklog([
  { speaker: '凛', text: '第一通电话', voice: 'v1' },
  { speaker: null, text: '雨声继续。' },
], ' 电话 ')).toEqual([{ index: 0, entry: { speaker: '凛', text: '第一通电话', voice: 'v1' } }]);
```

- [ ] **Step 2: Persist only the preset ID**

Add `keyPreset: KeyPreset` to settings. Invalid stored values fall back to `standard`. Do not persist arbitrary JavaScript key strings in this wave.

- [ ] **Step 3: Centralize host key routing**

Replace duplicated key comparisons with:

```ts
const action = actionForKeyboardEvent(event, settings.settings.keyPreset);
if (!action) return;
if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
routeGameAction(action);
```

Overlay priority remains: fatal/video > settings/save/gallery/system > backlog > choice > normal ADV. F5/F9 keep working in the standard preset.

- [ ] **Step 4: Add Backlog query projection through a dedicated controller**

Extend the stage method to:

```ts
showBacklog?(entries: readonly BacklogEntry[], onReplayVoice?: (voice: string) => void, query?: string): void;
```

Use a Pixi-rendered query label. When Backlog is open, printable key input appends to an in-memory query, Backspace removes one Unicode code point, Escape clears query before closing the panel, and Ctrl+F focuses search mode. Never use `innerHTML`.

`BacklogSearchController` owns query/focus state and returns filtered indexed entries. PixiStage forwards input and renders the returned view; the controller must not know about interpreter, saves, Electron or game-specific speakers.

- [ ] **Step 5: Verify input conflicts and search lifecycle**

Run:

```powershell
npm test -w @surdet/renderer -- keybindings.test.ts settings-store.test.ts pixi-stage.test.ts adv-renderer.test.ts
npm run build -w surdet-starter
npm run build -w zero-after-midnight
npm run e2e -w @surdet/shell
```

Expected: PASS; Backlog search does not advance text or trigger quick save/load.

---

### Task 11: Share Project Statistics with a New CLI Command

**Files:**
- Create: `packages/core/src/project-stats.ts`
- Create: `packages/core/test/project-stats.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/editor/src/stats.ts`
- Modify: `packages/editor/test/stats.test.ts`
- Create: `packages/cli/src/stats.ts`
- Create: `packages/cli/test/stats.test.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `docs/AI-GUIDE.md`

**Interfaces:**
- Produces:

```ts
export interface ProjectStats {
  sceneCount: number;
  totalTextLines: number;
  totalCharacters: number;
  choiceCount: number;
  endingCount: number;
  speakerLines: Record<string, number>;
  reachableScenes: string[];
  unreachableScenes: string[];
  referencedAssets: Record<string, string[]>;
}
export interface ProjectStatsInput {
  scenes: readonly CompiledScene[];
  entryScene: string;
  sourceTextByScene: Readonly<Record<string, string>>;
}
export function computeProjectStats(input: ProjectStatsInput): ProjectStats;
export async function statsCommand(projectDir: string, options?: { json?: boolean }): Promise<number>;
```

- [ ] **Step 1: Move, do not duplicate, shared calculations**

Start with tests copied from editor and add deterministic ordering. `speakerLines`, scene arrays and asset arrays must be stable across filesystem enumeration order.

- [ ] **Step 2: Keep editor presentation local**

`packages/editor/src/stats.ts` may retain UI-specific duration formatting, but word/line/branch/reachability calculations must import `computeProjectStats` from `@surdet/core`.

- [ ] **Step 3: Implement text and JSON output**

CLI usage:

```text
surdet stats <projectDir>
surdet stats <projectDir> --json
```

JSON mode writes only valid JSON to stdout. Diagnostics and fatal errors go to stderr. Missing/invalid projects exit 1; success exits 0.

- [ ] **Step 4: Add concrete CLI assertions**

Test JSON output by parsing it, not snapshotting whitespace:

```ts
const result = runCli(['stats', dir, '--json']);
expect(result.status).toBe(0);
expect(JSON.parse(result.stdout)).toMatchObject({ sceneCount: 2, endingCount: 1 });
```

- [ ] **Step 5: Verify editor parity and CLI**

Run:

```powershell
npm test -w @surdet/core -- project-stats.test.ts
npm test -w surdet-editor -- stats.test.ts
npm test -w @surdet/cli -- stats.test.ts
npm run typecheck
node packages/cli/dist/index.js stats examples/zero-after-midnight --json
```

Expected: all pass; JSON parses and reports 11 scenes and 3 endings for the formal game.

---

### Task 12: Add Fail-Safe Vite Scene Hot Reload

**Files:**
- Create: `packages/renderer/src/scene-hot-reload.ts`
- Create: `packages/renderer/test/scene-hot-reload.test.ts`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/core/src/runtime/scene-registry.ts`
- Modify: `packages/core/test/audit-fixes.test.ts`
- Modify: `examples/starter/src/main.ts`
- Modify: `packages/cli/templates/game/src/main.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `docs/AI-GUIDE.md`

**Interfaces:**
- Produces:

```ts
SceneRegistry.replace(scene: CompiledScene): void;
export interface HotReloadDecision { apply: boolean; nextPc: number; diagnostic?: string; }
export function decideSceneHotReload(currentSceneId: string, currentPc: number, replacement: CompiledScene): HotReloadDecision;
```

- [ ] **Step 1: Test atomic SceneRegistry replacement**

Replacement with the same scene ID swaps the scene. A mismatched ID throws. If compilation fails, the caller never invokes replace and the previous scene remains resolvable.

- [ ] **Step 2: Test PC safety**

The decision must clamp PC to a valid instruction boundary:

```ts
const nextPc = Math.max(0, Math.min(currentPc, replacement.instructions.length));
```

If scene hash changes, return a diagnostic. Never silently jump to another scene.

- [ ] **Step 3: Wire Vite HMR in development only**

Use `import.meta.hot` guards. On an accepted `.gal?raw` update:

1. compile the changed source;
2. if diagnostics contain errors, display diagnostics and retain the old compiled scene;
3. replace the registry entry atomically;
4. if the active scene matches, save a snapshot, update its position PC with the decision, and restore through the normal `loadSnapshot` path;
5. do not run this code when `import.meta.hot` is absent.

Do not implement filesystem watchers in Electron main; Vite owns development watching.

- [ ] **Step 4: Prevent resource leaks across repeated updates**

Hot scene replacement must not recreate PixiStage, AudioManager, FrameScheduler or Blob URLs. A project-level full reload remains responsible for resource disposal.

- [ ] **Step 5: Verify development and production builds**

Run:

```powershell
npm test -w @surdet/renderer -- scene-hot-reload.test.ts
npm test -w @surdet/core -- audit-fixes.test.ts
npm run build -w surdet-starter
npm run build -w zero-after-midnight
npm run typecheck
```

Expected: PASS; production bundles contain no runtime dependency on a Node filesystem watcher.

---

### Task 13: Full Regression, Performance Gate and Formal Package Acceptance

**Files:**
- Modify only if results require documentation correction: `docs/AI-GUIDE.md`
- Create: `docs/ENGINE-EXPERIENCE-OPTIMIZATION-WAVE-1-DELIVERY-REPORT-2026-08-08.md`

**Interfaces:**
- Consumes: Tasks 1–12.
- Produces: one evidence-backed delivery report; no new runtime API.

- [x] **Step 1: Run focused regression**

Run:

```powershell
npm run typecheck
npm test
npm run docs:capabilities:check
npm run verify:hygiene
npm run lint -w surdet-starter
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight
node examples/zero-after-midnight/scripts/check-assets.mjs
npm run verify:p1p2
npm run e2e -w @surdet/shell
git diff --check
```

Expected: all exit 0; test count is at least 702; formal simulation remains fully covered.

- [x] **Step 2: Run resource and performance acceptance**

Using the formal game development build and renderer diagnostics, record:

- loading progress monotonically reaches done;
- failed asset count is 0;
- active Blob URL count remains 45 after title load;
- audio entries remain 24 plus any explicitly added ambience source;
- static title and static dialogue allow ticker sleep;
- transition sample window has `maxUpdateMs <= 8` for enabled built-ins;
- repeated rollback 50 times does not grow Pixi Text/Sprite/Howl counts after settling.
- Profile clear-record roundtrip uses only the isolated temp `userData/profile/` directory;
- the two game hosts use `@surdet/host` while keeping project-specific titles, galleries, endings and resources local;
- `pixi-stage.ts` respects the 150-line net-new Facade limit and owns no second ticker.

If a threshold fails, do not hide it with a larger budget. Disable only the new optional effect responsible and record the evidence.

- [x] **Step 3: Build the explicit encrypted formal package**

Run in PowerShell:

```powershell
$env:SURDET_GAME_DIR = (Resolve-Path 'examples/zero-after-midnight').Path
$env:SURDET_PACK_MODE = 'release'
Remove-Item Env:SURDET_ENCRYPT -ErrorAction SilentlyContinue
$env:SURDET_EXPECTED_GAME = 'zero-after-midnight'
$env:SURDET_EXPECTED_ENTRY = 'prologue'
npm run pack -w @surdet/shell
```

Expected: exit 0; artifact verifier reports release + encrypted + correct identity. This command may only be run after confirming `.pack-stage` marker protection remains intact.

- [x] **Step 4: Launch the unpacked EXE with isolated user data**

Use Playwright Electron with a freshly created temp directory passed as `--user-data-dir`. Verify:

- title `零点之后 / AFTER MIDNIGHT`;
- canvas exists;
- loading progress reaches done and overlay hides;
- three font roles load;
- 45 retained asset Blob URLs;
- `prologue` reaches `awaiting-advance`;
- rollback succeeds once after two text checkpoints;
- F5/F9 succeed and create files only under the temp directory;
- Profile write/read succeeds under the same isolated temp root and legacy localStorage fallback remains non-destructive;
- zero page errors and zero console errors.

Close the app and remove only the temp directory created by this step after resolving and verifying its absolute prefix.

- [x] **Step 5: Write the delivery report**

The report must contain:

- exact HEAD and branch;
- scoped file list;
- every command and exit status;
- test count and formal simulation numbers;
- performance and resource measurements;
- package identity/encryption result;
- EXE acceptance result;
- any deferred optional effect;
- confirmation that no user save directory was touched;
- confirmation that no commit/push occurred unless separately authorized.

Do not state “all passed” unless every claimed command was rerun after the final source edit.

---

## Explicitly Deferred Follow-up Projects

The following are recorded but are not authorized by this plan:

1. **Portrait composition project:** base/body-part layers, expression schema, editor preview and save/presentation compatibility.
2. **Idle animation project:** blink/breath/hair animation with reduced-motion, ticker sleep windows and power measurements.
3. **Author tooling project:** DSL REPL and a separately versioned LSP server.
4. **Asset build project:** portrait-only atlas proof of concept integrated with SDAT2 packaging and Pixi Assets.
5. **Text performance project:** measured comparison of Text, BitmapText and incremental Ruby updates before migration.
6. **Deterministic replay project:** seeded PRNG, serialized inputs, external-effect boundaries and replay validation.
7. **Full localization project:** language-specific scenarios, resources, fonts, wrapping and runtime locale switching.
8. **Plugin API v2 project:** DSL instruction registration, variable observers and isolated UI containers with capability controls.
9. **Custom font import project:** file picker, license warning, safe persistence and fallback behavior.
10. **Renderer layer migration project:** move existing World/Dialogue/Menu/Gallery/SystemPanel code behind the PixiStage Facade with behavior-preserving characterization tests; do not combine with new feature delivery.
11. **Battle productization project:** define headless BattleLayout, formation snapshot and explicit setup/action/settlement phases before any drag-and-drop battle UI.

Each deferred item requires its own design specification and implementation plan before code changes.

---

## Self-Review Checklist

- [ ] Every accepted recommendation maps to a numbered task.
- [ ] Existing timeline editor, stats panel, gallery, localization, plugin host and performance monitor are reused rather than recreated.
- [ ] README, recommendation status and capability matrix agree with test-backed current behavior.
- [ ] Profile data is versioned and remains separate from slot saves and settings.
- [ ] `@surdet/host` owns routing/lifecycle but no game-specific rules or assets.
- [ ] PixiStage remains a compatibility Facade and new feature logic lives in focused modules.
- [ ] No task weakens packaging encryption or staging protection.
- [ ] Rollback captures interpreter, presentation and audio state together.
- [ ] Constant animation cannot keep the ticker awake when reduced motion is enabled.
- [ ] Audio additions remain bounded and disposable.
- [ ] CLI JSON output is machine-readable and deterministic.
- [ ] Hot reload is development-only and atomic on compile success.
- [ ] Formal game remains a validation fixture, not a hard-coded engine dependency.
- [ ] Final success claims are backed by fresh post-edit commands.
