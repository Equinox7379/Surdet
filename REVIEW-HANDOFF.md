# Surdet 引擎 · 独立复审任务书

> 本文档是自包含的复审交接书。你（独立复审 AI）不需要任何上下文即可开始工作。
> 任务：对下述变更范围进行**独立代码复审**，产出结构化审查报告。你不需要修改代码，只需要审查并报告。

---

## 1. 项目概况

**Surdet** 是一个成熟、数据驱动的桌面 galgame（视觉小说）引擎，TypeScript monorepo（npm workspaces），目标平台 Electron + Web。

核心理念：**一切游戏系统数据驱动**——剧情用自研 DSL（`.gal` 文件）编写，玩法系统（日历、战斗、商店、成长、成就等）全部由 `content/config/*.json` 配置驱动，引擎侧不含任何游戏特定逻辑。

### 包结构

| 包 | 职责 |
|---|---|
| `@surdet/core` | DSL 词法/语法/编译、表达式求值、解释器、存档、各玩法系统（纯逻辑，无 DOM） |
| `@surdet/cli` | `surdet` 命令：new / lint / build / pack |
| `@surdet/renderer` | PixiJS 渲染层：ADV 渲染器、Backlog、设置、UI 视图 |
| `@surdet/shell` | Electron 壳：主进程、窗口、打包 |
| `surdet-editor` | 可视化剧情编辑器（浏览器端） |
| `examples/starter` | 示例游戏，全系统接线演示 |

### 必读文档（复审前先读）

- `docs/dsl-spec.md` — DSL 指令规范与实现状态表
- `docs/architecture.md` — 分层架构与全家桶系统说明
- `docs/AI-GUIDE.md` — AI 协作指南

---

## 2. 复审范围（精确）

- **仓库路径**：`E:\surdet`（Windows，shell 为 PowerShell）
- **分支**：`master`
- **复审提交范围**：`6407a6f..HEAD`，共 **11 个提交**，HEAD = `ab42cfe`
- **变更规模**：35 个文件，+2617 / −496 行

### 提交清单（时间顺序，旧 → 新）

| 提交 | 内容 |
|---|---|
| `77cd08f` | 演出三件套：`@particle` / `@mov` / `@tint` 从 W002 占位转正并实现 |
| `0711ca9` | `@clear` 周目闭环：ClearTracker 全局通关记录 + NGP 继承接线 |
| `c5314ac` | UX 补全：H 键隐藏界面 + Backlog 语音回放 |
| `fde5e47` | 事件优先级调度器：EventScheduler 三档优先级队列 + CalendarRunner 回合头尾闭环 |
| `59ad27a` | 角色成长系统：GrowthSystem 经验/升级曲线 + `@exp` + growth 事件 + 存档往返 |
| `c266271` | 成就系统：条件/事件双途径解锁 + `@achievement` + hidden 成就 + 存档往返 |
| `d153c7c` | 据点指令（base commands）：AP/限次/when/effects 执行引擎 + PixiStage 指令面板 + 滚轮 Backlog |
| `39bc2d8` | 快进策略设置：`GameSettings.skipStrategy` 持久化枚举 + 设置面板 + S 键行为跟随 |
| `bb56368` | 审计轮1：DSL 规范/架构文档同步 + 编辑器指令面板补新指令模板 |
| `17940b1` | 审计轮2：CLI 配置表达式校验补全（calendar `baseCommands[].when` + achievements `when`） |
| `ab42cfe` | 审计轮3：成就 restore 去重防旧档污染 + 成长负经验兜底（不降级、经验下限 0） |

### 变更文件全清单

**新增（core 系统）**
- `packages/core/src/systems/achievement.ts`
- `packages/core/src/systems/clear-tracker.ts`
- `packages/core/src/systems/event-scheduler.ts`
- `packages/core/src/systems/growth.ts`
- `packages/core/test/achievement.test.ts`
- `packages/core/test/event-scheduler.test.ts`
- `packages/core/test/growth.test.ts`

**新增（示例内容）**
- `examples/starter/content/config/achievements.json`
- `examples/starter/content/config/growth.json`

**修改（core）**
- `packages/core/src/calendar/calendar.ts`（CalendarRunner：调度器闭环 + 据点指令执行）
- `packages/core/src/dsl/compiler.ts`（新指令注册）
- `packages/core/src/runtime/interpreter.ts`（新指令运行时）
- `packages/core/src/save/save-manager.ts`（新系统存档往返）
- `packages/core/src/index.ts`
- `packages/core/test/calendar.test.ts`、`compiler.test.ts`、`interpreter-save.test.ts`

**修改（renderer）**
- `packages/renderer/src/adv-renderer.ts`（快进策略、Backlog 语音回放）
- `packages/renderer/src/backlog.ts`
- `packages/renderer/src/pixi-stage.ts`（据点指令面板、H 隐藏界面）
- `packages/renderer/src/settings-store.ts`（skipStrategy 持久化）
- `packages/renderer/src/types.ts`、`ui-views.ts`
- `packages/renderer/test/adv-renderer.test.ts`、`settings-store.test.ts`

**修改（cli）**
- `packages/cli/src/lint.ts`（JSON 配置内 DSL 表达式校验扩展）
- `packages/cli/test/lint.test.ts`

**修改（editor / 示例 / 文档）**
- `packages/editor/src/main.ts`（指令面板模板）
- `examples/starter/src/main.ts`、`examples/starter/game.config.json`、`content/scenario/ch02.gal`、`content/config/calendar.json`
- `docs/architecture.md`、`docs/dsl-spec.md`

> 快速获取完整 diff：`git diff 6407a6f..HEAD`（在仓库根目录）

---

## 3. 有意为之的设计决策（复审时请勿误报为缺陷）

以下是明确的设计取舍，如果你认为某条是错的，请在报告中论证而不是默认当成 bug：

1. **全系统存档往返**：growth / achievement / clear 记录 / 调度器状态都必须能 snapshot → restore 无损还原，这是硬性验收标准。
2. **成就 restore 去重**：读档时已解锁成就不可被旧档数据回退或重复触发（`ab42cfe` 修复点）。
3. **成长系统负经验兜底**：经验值下限为 0，负经验不降级（`ab42cfe` 修复点）。
4. **EventScheduler 三档优先级**：high / normal / low 队列在回合头部统一结算，事件内可注入新事件但不可无限递归（有防护）。
5. **据点指令执行在 CalendarRunner 内**：AP 消耗、次数限制、`when` 条件、effects 全部在核心层执行，渲染层只做面板展示。
6. **CLI lint 单一事实源**：场景级校验逻辑下沉 `@surdet/core` 的 scene-lint，CLI 与编辑器共用；`content/config/*.json` 内的 DSL 表达式（visibleWhen / when / 伤害公式 / clearCondition）走声明式扫描表 `CONFIG_EXPR_SCANS`。
7. **编辑器对未知指令有单输入框优雅回退**，不报错。
8. **skipStrategy 是持久化用户设置**，S 键行为跟随设置（仅跳已读 / 全部跳过），不是硬编码。

---

## 4. 当前验收基线（复审前请自行复验）

以下命令在仓库根目录（PowerShell）执行，**当前状态全部为绿**，你复验时任何一项不过都属于回归，需立即报告：

| 命令 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 通过 |
| `npm run test` | **430 个测试全过**（core 254 / cli 63 / renderer 80 / shell 19 / editor 14） |
| `npm run lint -w surdet-starter` | 3 场景 0 错 0 警 |
| `npm run build` | 全部包构建成功 |

工作区当前干净（`git status` 无未提交改动）。若你发现问题，**不要提交任何修复**，只记录在报告中。

---

## 5. 复审重点（按优先级）

### A. 正确性（必查）
- [ ] 各系统的 snapshot/restore 是否真正无损（尤其成长经验、成就解锁集合、调度器队列、据点指令使用次数）
- [ ] `EventScheduler` 优先级结算顺序、回合内注入事件的处理、递归/重入防护
- [ ] `@clear` → ClearTracker → NGP 继承的完整闭环，周目计数与条件判定
- [ ] 据点指令的 AP 不足 / 次数用尽 / `when` 为假时的拒绝路径是否无副作用
- [ ] 快进策略在自动播放/跳过模式切换时的一致性（S 键、设置面板、实际跳过行为三处同步）
- [ ] 表达式求值安全性：配置 JSON 里的 DSL 表达式是否有注入或异常吞没风险

### B. 健壮性（必查）
- [ ] 旧存档（无新字段的存档）载入是否向后兼容，不崩不丢数据
- [ ] 边界值：经验 0 / 满级、AP 0、成就列表为空、growth.json 缺失时的行为
- [ ] 异常路径是否有静默吞错（搜索 `catch` 后仅 `console.error` 的地方是否合理）
- [ ] DOM 侧（pixi-stage 指令面板、Backlog）销毁/重建时是否泄漏监听器或定时器

### C. 一致性（建议查）
- [ ] `docs/dsl-spec.md` 指令状态表与 `IMPLEMENTED_INSTRUCTIONS` 实际集合一致
- [ ] `docs/architecture.md` 描述与实际接线一致
- [ ] CLI lint 的 `CONFIG_EXPR_SCANS` 覆盖与 `content/config/*.json` 实际表达式字段一致（新增配置不应漏校验）
- [ ] 编辑器 INSTR_FIELDS 与全部已实现指令的同步程度

### D. 代码质量（可选）
- [ ] 命名、分层违反（renderer 直接依赖 core 内部、核心层触碰 DOM 等）
- [ ] 测试质量：是否只测 happy path，关键不变量有无断言
- [ ] 明显的重复代码或可提取的公共逻辑

---

## 6. 报告输出格式（必须遵守）

请输出 Markdown 报告，按以下结构：

```
## 复审结论
（一句话：通过 / 有条件通过 / 需整改）

## 严重问题（Critical）—— 会导致崩溃、数据损坏、存档损坏
每条：文件:行号 + 问题描述 + 复现路径

## 重要问题（Major）—— 逻辑错误但不立即崩溃
每条：文件:行号 + 问题描述 + 建议修复方向

## 次要问题（Minor）—— 边界疏漏、不一致
## 建议（Suggestions）—— 不影响合并的改进
## 复验记录
（你实际运行了哪些命令、结果如何，特别是第 4 节的四项基线）
## 已确认无问题的重点项
（对第 5 节 checklist 逐项给出 ✅ / ❌ / 未验证）
```

规则：
- 每条问题必须给出 `文件:行号`，禁止泛泛而谈。
- 不确定的问题请明确标注"存疑，未复现"。
- 不要修改任何代码、不要提交、不要推送。
- 不要重新格式化或重构任何文件。

---

## 7. 环境提示

- Windows + PowerShell：没有 `tail`/`grep` 等 Unix 命令，用 `Select-Object` / `Select-String` 替代；git diff 建议 `git --no-pager diff`。
- Node >= 20，依赖已安装（`node_modules` 存在），无需 `npm install`。
- 仓库未配置远端推送；**请勿执行 `git push`**。

祝复审顺利。
