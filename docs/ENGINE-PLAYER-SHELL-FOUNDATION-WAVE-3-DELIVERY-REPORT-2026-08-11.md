# Surdet Player Shell Foundation Wave 3 交付报告

> 状态：`PLAYER_SHELL_FOUNDATION_WAVE_3_IMPLEMENTED`  
> 复核阶段：`WAITING_FOR_REVIEW`  
> 本轮没有 push、没有进入 M9、没有处理性能测量或正式发行。

## 1. 交付结论

Wave 3 已把玩家系统界面的来源/返回语义、固定系统界面槽、默认壳编排和 Renderer 主题令牌收回公共引擎层。行为实现位于 `packages/host` 与 `packages/renderer`；Starter、《零点之后》和 CLI 模板只负责公共接口接线与正式验收，没有创建第二套 PlayerShellController，也没有复制 Host 状态机。

本报告依据所有门禁完成后的实现 HEAD `abc5f913702c863b89ff7d6e86ce79c03f7332da` 编写。该 HEAD 包含 Task 8 文档/能力矩阵提交和 Task 8 台账提交；本报告本身随后以独立普通文档提交归档。报告提交后的真实仓库 HEAD、文件字节数和 SHA-256 由提交后机器复核记录，不在文件内容中伪造自引用提交哈希。

最终状态：

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

## 2. 起点、提交和施工边界

冻结起点为 `9bbec32946e169a5d081b29863edddaad64959fe`，起点时 `HEAD...surdet/main = 0 0`。Task 0–8 的真实提交链如下：

| 阶段 | 提交 | 内容归属 |
| --- | --- | --- |
| Task 0 | `445cf5106f9ca9c0401044b7e9cfa121c45ffcb4`；清洁室台账 `083bd63` | 基线与清洁室记录 |
| Task 1 | `a6286a2581db40a6683136a4a015045b5f3250e5`；台账 `066fead` | Host overlay 返回栈 |
| Task 2 | `c4ffce8737e6326309076a27622200ee969ebd26`；台账 `d484071` | Host 固定六槽注册表 |
| Task 3 | `112351ee9e7a2a3b1e6f4d2a7b2fbe7e754815b3`；台账 `5717d2f` | Host PlayerShellController 原子协调 |
| Task 4 | `8843b9b5071718f234f7a9273efac866118bb777`；台账 `fd4a243` | RendererTheme 公共契约 |
| Task 5 | `7dc7668ae9e41a332d05c319d82ec79e4be55497`；台账 `797a5d6` | 五类 Layer 主题投影 |
| Task 6 | `8032f1e24b5c4ecbcf88823f74686f408043b814`；台账 `6ab354c` | Starter/Zero/CLI 公共接线 |
| Task 7 | `35b3009934b34a5683036eb412e5e0cb2940a1cd`；台账 `5830622` | Electron 玩家矩阵 |
| Task 8 文档 | `54c440bcb95c7a54c76e063e2c25c45fd7c19e0d` | 能力矩阵、迁移指南、README、AI-GUIDE |
| Task 8 台账 | `abc5f913702c863b89ff7d6e86ce79c03f7332da` | 本计划最终门禁与证据台账 |

本轮明确未修改：DSL、SaveSnapshot、SAVE_SCHEMA_VERSION、存档目录/文件名、剧情、规则、美术、音频、性能脚本、性能 artifact、性能门限、M9、EXE 正式发行路径和四个受保护未跟踪文件。

## 3. 引擎归属与公共接口

### 3.1 Host：来源、返回栈和壳编排

- `packages/host/src/player-ui.ts` 提供不可变 `returnStack`、`pushOverlay()`、`closeOverlay()`、`dismissOverlays()` 和操作起点快照；根对象、数组和 frame 递归冻结，外部篡改不会污染内部状态。
- `packages/host/src/player-shell-slots.ts` 固定并验证六个槽位：`title`、`system-menu`、`save-load`、`settings`、`gallery`、`backlog`。defaults 缺项、未知 override、Provider 失败都有稳定错误码和原始 `cause`。
- `packages/host/src/player-shell-controller.ts` 通过 prepare → commit → provider 顺序完成打开/关闭，Provider 抛错时回滚旧 session；统一处理 operation、输入消费、reset 和查询。
- `packages/host/src/renderer-player-shell-slots.ts` 是 Renderer-backed 默认 Provider 的唯一 Host helper；它只依赖 Renderer v2 commands/queries，不导入 Layer、PixiStage 或 AdvRenderer。

### 3.2 Renderer：不可变主题令牌

- `packages/renderer/src/theme.ts` 提供 `DEFAULT_RENDERER_THEME`、`createRendererTheme()` 和严格数值/键校验；结果递归冻结但不冻结调用方 patch。
- `commands.preferences.setTheme()` 与 `queries.preferences.theme()` 是唯一主题更新/查询入口；非法 patch 不改变旧主题，已 dispose 的 Runtime 按 RendererError 契约失败。
- Menu、Dialogue、Gallery、SystemPanel、Loading 五类真实 Layer 都消费同一个冻结主题意图，只重绘已有 Graphics/TextStyle，不销毁重建资源 owner、监听器、补间或 Container。
- 相同主题更新保持幂等并只请求一帧；主题查询不暴露 Pixi 或可写引用。

### 3.3 项目接线

Starter、《零点之后》和 CLI 模板均消费公共 Controller、固定槽 helper 和 Renderer Theme。入口只提供视图工厂、存储适配和游戏业务回调；没有在正式游戏中复制 `systemMenuOpen`、`saveLoadOpen`、`galleryOpen`、`settingsOpen`、`onTitleScreen` 等局部状态机。

## 4. TDD 红灯/绿灯证据

| Task | 红灯事实 | 绿灯事实 |
| --- | --- | --- |
| 1 | 13 项返回栈测试中 5 项先失败：快照无 `returnStack`，随后 `pushOverlay` 不存在 | Host 聚焦 13/13，Host typecheck 通过 |
| 2 | 模块不存在，测试文件未收集 | 固定槽聚焦 5/5，Host typecheck 通过 |
| 3 | Controller 模块不存在，测试文件未收集 | Controller 聚焦 8/8，Host 全量 46/46，typecheck 通过 |
| 4 | Theme 模块无法收集，查询纯度中 `preferences.theme()` 缺失 | 主题/契约/纯度 19/19，Renderer typecheck 通过 |
| 5 | 真实 Runtime 主题接线断言失败，聚焦集合 70/71 | 五文件 71/71；Renderer typecheck/build、boundary 3/3、legacy 4/4 |
| 6 | Host helper、Starter/Zero/CLI 公共接线断言先失败；既有 Zero 22 项仍通过 | Host 49/49；Starter 7/7；Zero 21/21；CLI 86/86；各自 typecheck/build 通过 |
| 7 | 契约 3 项先失败；首轮 Wave 3 B 为 5/6，发现 settings 关闭后父 system-menu 未重新投影 | 修复真实父槽投影后 Wave 3 两轮 A–F 6/6；Wave 2 A–I 9/9；契约 3/3 |
| 8 | 文档任务无生产红灯；修改前 `npm run verify:docs` 基线通过 | 能力矩阵、迁移文档、全量门禁和正式 Electron 验收均通过 |

Task 7 的失败 artifact 未删除，保留在本机临时目录作为红灯证据；正式仓库未纳入日志、截图、缓存或临时产物。

## 5. 六槽、来源和返回真值表

| 当前请求/操作 | 合法来源或起点 | 成功后的返回/收敛 | 失败后的状态 |
| --- | --- | --- | --- |
| `title` | `title` / `game` | 清理覆盖层并进入 title | Provider 失败回滚旧 snapshot |
| `system-menu` | `game` | `game / system-menu` | 回滚旧 snapshot |
| `settings` | `title` / `game` / `system-menu` | 关闭 settings 后恢复父 frame；在 system-menu 子层时回到 system-menu | 保留原 overlay/returnStack |
| `gallery` | `title` / `game` | 关闭后回到原 base/frame | 保留原 overlay/returnStack |
| `backlog` | `game` | 关闭后回到 game | 保留原 overlay/returnStack |
| `save-load(save/load)` | `title` / `game` / `system-menu` | success 收敛到目标上下文并清栈 | reject/fail 恢复完整 origin 栈并上报一次 |
| `reset()` / `dismissOverlays()` | 任意非 busy 状态 | 回到 base 的 none，栈清零 | 非法 busy 转移抛 `PLAYER_UI_INVALID_TRANSITION` |

固定槽 defaults 六项缺一不可；不提供 override 仍能使用 Renderer-backed defaults。override 仅能覆盖固定 ID；查询快照只返回冻结绑定数据，不暴露 Provider 或真实 Layer。UI `save-load` 槽只是界面槽，不是 SaveManager 的数据槽 `1`、`quick`、`auto`。

## 6. 主题接线验收

已用 Runtime v2 真实命令验证 accent override 会同步到五类 Layer：Dialogue、Menu、Gallery、SystemPanel、Loading。另已验证：

- 同一主题重复设置幂等且只请求一帧；
- 非法颜色、opacity、尺寸、未知键和 disposed Runtime 均按契约拒绝；
- 非法设置不污染旧主题；
- 主题快照被修改不会影响 Layer 或调用方状态；
- 主题更新不增长资源 owner、监听器或显示对象数量；
- Starter、Zero、CLI scaffold 均从公共 Renderer Theme 接线。

## 7. Electron 证据

以下正式玩家矩阵均明确加载 `E:\surdet\examples\zero-after-midnight\dist`，每个 case 使用独立 Electron 和独立临时 userData；页面错误、console 错误、失败请求、unhandled rejection 和 release failure 均为 0。

### Wave 3 A–F

| 轮次 | Artifact | 字节数 | SHA-256 | 结果 |
| --- | --- | ---: | --- | --- |
| round-1 | `<local-path>` | 60278 | `c2ce916ac3be3952470f032939afd53ebea1c60c5118fa6b183b2a9f953f1a9f` | A–F 6/6 |
| round-2 | `<local-path>` | 60278 | `c02ab654346bd9f540dab62f0f816f970cf5c346879b2cf3c022ebe3a76df941` | A–F 6/6 |
| Task 8 final rerun | `<local-path>` | 60278 | `c32c64e3bed554ebe2d8f56fc257b21703a623781cb9f1c052a0dac03dd70da6` | A–F 6/6 |

A title→gallery→close、B game→system-menu→settings→close、C save reject→retry success、D load success→title、E 无 override 的六槽 defaults、F 主题 accent 同步/恢复默认全部通过。

### Wave 2 A–I 回归

| Artifact | 字节数 | SHA-256 | 结果 |
| --- | ---: | --- | --- |
| `<local-path>` | 761716 | `c6f6b82e23d022045b4245e84d6648ae323351a0622e6d7995a2a9f3ae4afdbe` | A–I 9/9 |

旧 Wave 2 三条正常对照路径继续通过；Wave 3 修改了 settings 子层关闭后的父 system-menu 重新投影合同，Wave 2 B 断言已同步到该已验收返回语义。

## 8. 全量门禁

| 门禁 | 结果 |
| --- | --- |
| `npm run docs:capabilities` / `npm run verify:docs` | PASS |
| Core | 23 文件 / 304 tests PASS |
| Renderer | 48 文件 / 368 tests PASS |
| Host | 8 文件 / 50 tests PASS |
| Shell | 16 文件 / 125 tests PASS |
| Starter | 4 文件 / 7 tests PASS |
| Zero | 2 文件 / 21 tests PASS；内置模拟校验 11 scenes / 3 endings / 44 assets |
| CLI | 7 文件 / 86 tests PASS |
| `npm run verify:renderer-boundaries` | 3/3 PASS |
| `npm run verify:renderer-legacy` | 4/4 PASS |
| `npm run verify:tools` | 10/10 PASS |
| `npm run verify:hygiene` | 601 tracked paths PASS |
| `npm run verify:all` | exit code 0 |
| Shell 通用 E2E | PASS |
| Renderer v2 Electron E2E | PASS；17 个视觉状态均为 CANDIDATE/语义通过，未冒充人工批准金样 |
| Wave 2 / Wave 3 玩家 E2E | A–I 9/9；A–F 两轮各 6/6 |
| Zero lint | 11 场景、0 errors、0 warnings |
| Zero simulate | 23/23 choice、3 endings、0 runtime errors |
| Zero assets | `assets ok: 44` |
| Zero typecheck/build | PASS |
| `git diff --check` | PASS |
| `git ls-files '*.log'` | 空 |

## 9. Git、保护文件和延期项

Task 8 文档提交完成后，最终报告提交前的实现 HEAD 为 `abc5f913702c863b89ff7d6e86ce79c03f7332da`，相对 `surdet/main` 为 `18 0`。最终报告提交是独立的普通文档提交，不 push；提交后的真实 HEAD、ahead/behind、status、报告字节数和 SHA-256 由最终机器复核输出。

工作树允许且必须保留的四个未跟踪文件为：

```text
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
```

四个文件未修改、未暂存、未提交、未删除、未移动。tracked log 为空。

本轮延期且明确不属于交付内容：

- Renderer 性能测量仍为 `PERFORMANCE_MEASUREMENT_NOT_QUALIFIED`；保留既有性能红灯，不调整阈值、不重跑正式 A/B、不以 UI 通过覆盖性能结论。
- M9、正式发行、EXE 重新打包、Wave 4–6 资产/Schema/预览窗口能力、音频工程计划均未开始。
- 一版 `PixiStage`/`AdvRenderer`/`AdvStage` 兼容窗口继续保留，待后续独立迁移周期和复审后再决定收口。

## 10. 复审入口

建议独立复审按以下顺序复核：

1. `git rev-parse HEAD`、`git status --short`、`git rev-list --left-right --count HEAD...surdet/main`；
2. `docs/capabilities.json` 与生成的 `docs/capability-matrix.md` 一致性；
3. Host 六槽、返回栈和 Controller 测试；
4. Renderer 五类 Layer 主题真实投影和 query purity；
5. 两轮 Wave 3 与 Wave 2 artifact 的 `formalGame`、隔离 userData、错误数组；
6. `npm run verify:all` 和正式 Zero dist 的玩家路径。

未获得下一阶段批准前，本任务停留在 `WAITING_FOR_REVIEW`，不执行 push 或任何 Wave 4/M9 工作。
