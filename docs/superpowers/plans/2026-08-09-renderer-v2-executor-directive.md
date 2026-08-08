# Surdet Renderer v2 Wave 2 最高执行指令

> 用途：将本文件全文复制给唯一的执行 AI。
> 本指令的约束高于执行 AI 自行提出的优化、重构习惯和“顺手改进”。
> 你是执行者，不是产品经理或架构审批者。遇到未决事项必须停止并汇报，不得替总经理作主。

## 一、你的任务

你将在 `E:\surdet` 仓库中，按照已经批准的 Renderer v2 设计和计划，串行完成 Wave 2。

核心目标：

1. 建立 Renderer v2 Commands / Queries 接口；
2. 将 Renderer 拆为 Dialogue、Menu、Gallery、SystemPanel、World 和 RenderLifecycle 边界；
3. 建立唯一 `RenderAssetRegistry`；
4. 旧 `PixiStage`、`AdvStage`、`AdvRenderer` 保留一个版本，但只能作为薄适配器；
5. starter、正式样例、编辑器和 CLI 模板全部迁移到 v2；
6. 证明无行为回归、无资源泄漏、无未批准视觉变化、无显著性能倒退；
7. 在最终独立验收批准前，不推送。

## 二、开工前必须全文阅读

按以下顺序阅读，不得只读摘要：

1. `docs/superpowers/specs/2026-08-09-renderer-v2-architecture-design.md`
2. `docs/superpowers/plans/2026-08-09-renderer-v2-wave-2-master-implementation.md`
3. 当前阶段计划：
   - M0–M2：`docs/superpowers/plans/2026-08-09-renderer-v2-foundation-m0-m2.md`
   - M3–M7：`docs/superpowers/plans/2026-08-09-renderer-v2-layers-m3-m7.md`
   - M8：`docs/superpowers/plans/2026-08-09-renderer-v2-cutover-m8.md`
4. `docs/AI-GUIDE.md`
5. `docs/dsl-spec.md`
6. `docs/capabilities.json`
7. 当前任务列出的全部源码和测试。

如果你具备 `superpowers:executing-plans`，必须使用它逐任务执行。不要使用并行 subagent；本项目指定一个执行 AI 串行工作。

## 三、开工状态核对

先运行并原样报告摘要：

```powershell
git branch --show-current
git rev-parse HEAD
git status --short
git rev-list --left-right --count HEAD...surdet/main
git log --oneline -5
```

预期：

- 分支为 `main`；
- 设计基线包含 `fe72abe` 及后续计划文档提交；
- `USER.md`、`SESSION-HANDOFF.md` 可以保持未跟踪；
- 其他意外改动必须先报告，不能覆盖、删除、stash 或提交；
- 不得运行 `git reset --hard`、`git checkout --` 或 force push。

如果状态不符合预期，停止，不要开工。

## 四、严格阶段顺序

只能按以下顺序执行：

```text
M0 事实证据、CI 去重、性能/资源/视觉基线
↓ 审批
M1 Renderer v2 API、Facade、当前行为兼容契约
↓ 审批
M2 RenderLifecycle、AsyncGeneration、RenderAssetRegistry、输入归一化
↓ 审批
M3 DialogueLayer
↓ 审批
M4 MenuLayer
↓ 审批
M5 GalleryLayer
↓ 审批
M6 SystemPanelLayer
↓ 审批
M7 WorldLayer
↓ 审批
M8 所有消费者迁移、旧接口收口、文档、发行版总验收
↓ 独立总经理复审
批准后才允许 push
```

每次只执行一个里程碑。完成报告后必须停止，等待明确的“批准进入 M<N+1>”。测试全绿不等于自动批准。

## 五、每个任务必须采用的工作循环

对于改变行为或所有权的任务，严格执行：

```text
1. 写直接失败测试；
2. 运行指定测试，亲眼确认它因目标能力缺失而失败；
3. 实现最小代码；
4. 运行定向测试并通过；
5. 运行受影响包测试；
6. 运行阶段门禁；
7. 检查 diff；
8. 精确暂存；
9. 创建聚焦提交；
10. 更新阶段报告。
```

禁止先写实现再补一个必然通过的测试。禁止 fake 重新实现生产逻辑。

## 六、不得自行改变的架构决定

### 6.1 公开入口

新入口固定为：

```ts
createRendererRuntime(options?): Promise<RendererRuntime>
```

Runtime 固定暴露：

```text
canvas
commands
queries
controller
resize()
resetSession()
dispose()
```

### 6.2 Commands 域

固定为：

```text
assets
world
dialogue
menu
gallery
system
loading
preferences
presentation
```

### 6.3 Queries 域

固定为：

```text
world
dialogue
overlay
preferences
presentation
diagnostics
```

不得将 Commands/Queries 换成通用字符串事件总线，不得使用 `Record<string, any>` 逃避接口设计。

### 6.4 Layer 边界

- Dialogue：ADV、Ruby、选择、NVL、Backlog、Banner、Command Rail；
- Menu：标题、结局、系统菜单、设置、存读档；
- Gallery：CG、音乐、文本回想；
- SystemPanel：战斗、地图、商店、据点、视频；
- World：背景、立绘、摄像机、转场、粒子、调色、时间轴；
- RenderLifecycle：ticker、listener、tween、async、Blob、pool、display 的登记与释放；
- RenderAssetRegistry：背景、立绘、头像、字体和注册素材源的唯一仓库。

Layer 不得导入另一个 Layer。跨层协调只允许经过 Facade 或 Controller。

### 6.5 旧接口

`PixiStage`、`AdvStage`、`AdvRenderer` 本轮不能删除。它们必须：

- 标记 deprecated；
- 委托到 v2；
- 通过完整契约测试；
- 不保留第二份渲染、状态机、快照或资源逻辑；
- 不在正式运行时反复打印弃用警告。

## 七、绝对禁止事项

你不得：

1. 新增玩家功能；
2. 修改 DSL、存档格式、游戏规则或文案；
3. 顺手实现战斗阵型、插件系统、新转场、新粒子或编辑器改版；
4. 因文件大而重写无关 Core/Host/Shell；
5. 为压行数而挪代码、压缩格式或创建无意义转发文件；
6. 删除、跳过或弱化测试；
7. 调宽性能门槛；
8. 批量更新视觉基准；
9. 吞掉异常、屏蔽 console error 或把错误改成 warning；
10. 让 Query 创建对象、注册监听、改变缓存或改变画面；
11. 让每个 Layer 各自维护一份纹理/字体缓存；
12. 在旧适配器中复制新实现；
13. 读取、迁移、覆盖或删除用户真实存档；
14. 使用用户正常 Electron userData 做验收；
15. 提交 `USER.md`、`SESSION-HANDOFF.md`、日志、截图、缓存、临时脚本、`.superpowers/` 或 release 产物；
16. 使用 `git add .`、`git add -A`、`git reset --hard` 或 force push；
17. 未审批就进入下一里程碑；
18. 最终独立复审前自行 push。

## 八、只允许修复阻断缺陷

如果迁移暴露旧缺陷，只有同时满足以下条件才可在本轮修复：

1. 缺陷会阻断当前迁移或导致状态错误、泄漏、测试不稳定；
2. 你能说明现有正确契约；
3. 先增加一个在旧实现上失败的直接测试；
4. 修复最小，不扩展产品范围；
5. 在报告中单列“迁移阻断缺陷”，说明原因、测试和改动。

普通体验问题只登记，不修复。

## 九、必须停止的红线

出现以下任一情况，立即停止并报告：

- Layer 需要导入另一个 Layer；
- Query 前后状态或资源数量发生变化；
- 旧接口与 v2 契约不一致；
- 存档、rollback、HMR、system boundary 或正式样例行为变化；
- 两轮 50 次循环后资源仍增长；
- 性能超过冷启动/素材 10%，菜单/场景 15% 门槛；
- 出现无法解释的视觉差异；
- 需要修改非目标范围才能继续；
- 你无法解释准备删除的旧逻辑；
- 测试、编辑器、starter、正式样例或 EXE 失败；
- 需要提高阈值、删除断言或屏蔽错误才能通过。

停止时不得重置工作。必须提供：最后绿色提交、失败命令、预期、实际、相关文件、最小复现和建议选择，然后等待。

## 十、资源与异步规则

所有资源必须登记 owner 和 kind。释放必须幂等。替换资源遵循：

```text
validate → prepare → commit → release previous
                  ↘ fail：释放临时资源，保留旧状态
```

异步背景、字体、视频、转场和 HMR 使用 generation 或 AbortSignal：

- 新任务使旧 token 失效；
- reset/dispose 使全部旧 token 失效；
- 旧任务晚到只能释放自己，不能提交；
- 取消不是崩溃；
- dispose 后回调不能重新创建对象。

每个 Layer 做两轮各 50 次 show/hide 或 mount/unmount。第二轮结束的稳定资源快照必须等于第一轮，或等于文档明确的固定对象池上限。

## 十一、提交纪律

提交前运行：

```powershell
git status --short
git diff --check
git diff --stat
git diff --cached --stat
```

只暂存任务列出的精确路径：

```powershell
git add -- <exact-file-1> <exact-file-2>
git diff --cached --check
git commit -m "<计划规定的提交信息>"
```

如果发现无关用户改动，不得覆盖；调整实现避开它或停止报告。

## 十二、里程碑报告格式

每个里程碑创建：

```text
docs/ENGINE-RENDERER-V2-M<N>-DELIVERY-REPORT-2026-08-09.md
```

必须包含：

```markdown
# Renderer v2 M<N> Delivery Report

## Scope
- 完成的计划任务：
- 明确延期内容：
- 迁移阻断缺陷：

## Commits
| SHA | Message | Files |

## Contract Evidence
| Requirement | Test/file | Result |

## Commands Run
| Command | Exit code | Tests/summary |

## Resource and Performance Comparison
| Metric | Baseline | Current | Delta | Gate |

## Visual Evidence
| State | Result | Difference |

## Git State
- git status --short：
- HEAD...surdet/main：
- 明确排除文件：

## Known Risks
- 具体风险；没有则写 None observed。

## Approval Request
- 请求批准进入的下一个里程碑：
```

不能把旧报告结论复制成新证据；所有命令必须是本阶段新鲜运行结果。

## 十三、每次汇报给用户的简短格式

不要只说“完成了”。使用：

```text
当前里程碑：M<N>
状态：WAITING_FOR_APPROVAL / BLOCKED
新增提交：<SHA + message>
定向测试：<数量和结果>
全门禁：<结果>
资源循环：<结果>
性能差异：<结果>
视觉差异：<结果>
工作树：<结果>
报告：<绝对路径>
下一步请求：<明确审批事项>
```

## 十四、最终 M8 特别要求

M8 必须额外证明：

- 仓库内部 legacy 使用为 0，适配器和兼容测试除外；
- Layer 横向导入为 0；
- `PixiStage`、`AdvRenderer` 只剩委托；
- starter、正式样例、编辑器、CLI 模板均使用 v2；
- 全量测试高于基线 766；
- 正式样例 23/23 choice 分支及结局可达性仍通过；
- HMR、rollback、存读档、Profile、system boundary 全部通过；
- 能力矩阵证据路径全部真实存在；
- CI 没有重复昂贵门禁；
- Windows EXE 在隔离 userData 下通过；
- 记录 EXE 路径、大小、时间和 SHA-256；
- 页面错误、控制台错误、素材失败均为 0；
- 最终报告已经提交；
- 未经独立复审批准，不推送。

## 十五、现在该做什么

1. 阅读全部权威文档；
2. 运行开工状态核对；
3. 只执行 M0；
4. 按 M0 计划逐 checkbox 工作；
5. 写 M0 报告并提交；
6. 停止；
7. 向用户请求“批准进入 M1”。

不要直接开始 M1，更不要一次性完成 Wave 2。
