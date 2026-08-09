# Surdet Renderer v2 Wave 2（M8）独立交付报告

日期：2026-08-10
里程碑：M8 — Renderer v2 cutover 及最终交付验收
执行状态：WAITING_FOR_REVIEW
发布状态：RELEASE_BLOCKED（仅开发放行；未经独立最终批准不得正式发行）

## 1. 结论先行

M8 已按既定 Task 19–25 完成源码迁移、兼容边界、编辑器/CLI 消费者迁移、工具卫生修复、全量门禁、确定性可视验收、资源循环验收、固定配对 A/B 和 Windows unpacked EXE 隔离验收。

本轮没有 push，也没有 force push；完成本报告及本地提交后停止，等待总经理独立复审。

必须保留的性能结论如下：

- M7.5 冻结候选 docs/baselines/renderer-v3-candidate-2026-08-09.json 未被覆盖其性能语义，仍为 formalFailures=sceneP95Ms。
- M7.5 候选的正式 sceneP95Ms 为 gateRatio=1.2488932612，门限为 1.15，仍是 FAIL。
- M8 的同会话 M7.5→M8 配对 A/B 没有显示超过增量门限的新退化，但不能用这一结果覆盖 M0→M8 的历史风险。
- M8 新 A/B artifact 的正式比较结果没有失败项；其 historicalComparison 仍保留相对于冻结 M0/v2 样本的 assetReadyMs 与 sceneP95Ms 历史失败。

因此本报告不宣称 Renderer v3 性能全绿，不宣称正式发行获批。

## 2. 起始点、最终代码点与提交序列

M8 授权起始 HEAD：

~~~
007438b569ec95350fdc9d7882ad49f55bbb7968
docs(renderer): report M7.5 final remediation
~~~

本报告写入前的最终运行时代码 HEAD：

~~~
89c69ab427d75b064c761832bd09695778e446e6
test(shell): add Renderer v2 acceptance harness
~~~

该 SHA 是 M8 当前代码和测试 artifact 的 currentCommit。本报告及 M8 A/B artifact 还会形成一个只包含交付证据的本地提交；报告提交 SHA 以提交完成后的 Git 回报为准。没有任何远端推送。

M8 从授权起点到最终运行时代码点的聚焦提交序列：

| 顺序 | SHA | 语义 |
|---:|---|---|
| 1 | ccfb110 | fix(renderer): harden v3 artifact evidence |
| 2 | c91a9cf | refactor(renderer): contain legacy API adapters |
| 3 | 954119b | test(renderer): audit legacy API consumers |
| 4 | a301de7 | refactor(renderer): expose v2 runtime consumer surface |
| 5 | 7d12a92 | refactor(starter): adopt Renderer v2 runtime |
| 6 | cccb5fb | refactor(formal): adopt Renderer v2 runtime |
| 7 | ce1f5aa | refactor(editor): adopt Renderer v2 runtime |
| 8 | f568024 | refactor(cli): adopt Renderer v2 template |
| 9 | 7271253 | docs(renderer): publish v2 migration guide |
| 10 | 89c69ab | test(shell): add Renderer v2 acceptance harness |

## 3. 实际变更范围

从 M8 起始 HEAD 到 89c69ab，Git 记录为 50 个已跟踪文件、3428 行新增、1737 行删除。最终交付提交另增加本报告和 M8 A/B 原始 artifact；不会纳入四个保护文件。

### 3.1 Renderer 所有权与兼容窗口

- PixiStage 和 AdvRenderer 的旧实现已收缩为兼容转发边界。
- 新增 packages/renderer/src/pixi-stage-host.ts，承载实际 Stage 端口实现。
- 新增 packages/renderer/src/legacy/legacy-stage-adapter.ts 与 legacy-renderer-adapter.ts。
- 兼容测试覆盖旧构造/API，旧入口没有重新保留第二份 Layer 状态机、资源图、动画/帧逻辑或 Core 事件分发逻辑。
- Renderer v2 的公开 consumer surface、Presentation port、World/Stage 窄端口和生命周期边界保持不变；没有修改 DSL、存档格式、游戏规则或编辑器玩家可见行为。

### 3.2 生产消费者迁移

- Starter 迁移到 createRendererRuntime()、runtime.commands、runtime.queries 和 runtime.controller。
- 《零点之后》迁移到同一 Renderer v2 入口，保留正式游戏的场景、系统适配器、回滚和存读档语义。
- examples/shared/rollback-runtime.ts 和字体任务改用窄端口，不再让正式消费者依赖旧 Stage 类型。
- Editor preview 增加独立 preview runtime 生命周期边界，并继续保留编辑器现有预览/热更新行为。
- CLI 新游戏模板改用 Renderer v2 入口；同时增加模板回归断言，防止新生成项目重新复制旧宿主接线。

### 3.3 工具卫生与证据链

ccfb110 的限定修复包含两项 M8 开工前批准的工具卫生任务：

1. Renderer v3 artifact validator 对每个 warmup 和 formal raw launch 强制要求：total > 0、completed === total、failed === 0、done === true；恶意篡改用例覆盖 completed=0、completed<total、total=0、done=false、删除 done 和 failed>0。
2. artifact 明确区分 sampledAt 与 rebuiltAt。M7.5 冻结候选的原始时间由提交 9d39dc9 机械读取，值为：

~~~
2026-08-09T13:31:47.300Z
~~~

离线重建保留 sampledAt，只更新 rebuiltAt；validator 验证两者均为合法 ISO 时间，测试验证重复 rebuild 不改变 sampledAt。

M7.5 原始候选文件没有被 M8 的 A/B 输出覆盖。M8 A/B 使用单独文件：

~~~
docs/baselines/renderer-v3-m8-ab-2026-08-10.json
~~~

## 4. Renderer v2 确定性可视验收

命令：

~~~
npm run e2e:renderer-v2 -w @surdet/shell
~~~

验收 harness 使用独立 Electron、独立临时 userData、正式公开 debug/runtime 端口和真实 Layer 投影；截图只写入临时根目录，验收结束后按精确路径清理，没有截图或日志进入仓库。

实际通过 17 个状态（不是 18 个）：

| 状态 | 断言 |
|---|---|
| title | 标题菜单存在 |
| settings | 标题设置覆盖层存在 |
| gallery-tabs | 鉴赏标签页存在 |
| adv-ruby | ADV 文本与 Ruby 投影存在 |
| narration | 旁白路径可投影 |
| choice | 选择肢路径可投影 |
| nvl | NVL 文本路径可投影 |
| backlog | Backlog 路径可投影 |
| settings-command | 运行时设置命令可投影 |
| save-load | 存读档覆盖层可投影 |
| gallery-command | 运行时鉴赏命令可投影 |
| map | 地图系统面板可投影 |
| base | 据点系统面板可投影 |
| shop | 商店系统面板可投影 |
| battle | 战斗系统面板可投影 |
| particle-transition | 粒子/转场路径可投影 |
| reduced-motion | reduced-motion 路径可投影 |

该次运行还通过：

- title → story 的真实启动路径；
- Renderer v2 公开系统边界探针：opened=true、hadRollback=true、rollbackBlocked=true；
- 页面错误 0、console error 0、failed request 0；
- runtime 在关闭前保持未 dispose，稳定资源快照由资源循环测试和 EXE 验收分别核验。

## 5. 资源生命周期与 50×2 循环

Renderer 全量测试：46 个文件 / 323 个测试通过。

packages/renderer/test/integration/resource-cycles.test.ts 保留并通过：

- 人工 lifecycle 两批各 50 次循环，第二批 stable snapshot 与第一批完全相等；
- 真实 runtime + RenderAssetRegistry + PresentationController 两批各 50 次循环；
- 每次覆盖资源注册、reset、clearAssets、迟到异步、disconnect、unsubscribe 和 dispose；
- 迟到异步全部被丢弃；
- 最终真实 runtime snapshot 为 disposed=true、displayObjectsByOwner={}，并且 listeners、active async、active tweens、ticker、Blob 等清零。

本轮定向资源测试实际为 6 个文件 / 53 个测试通过，完整 Renderer 测试也再次通过上述 46/323。

EXE 自然关闭路径的稳定快照（关闭前两次读取完全相同）为：

~~~json
{
  "disposed": false,
  "tickerCallbacks": 1,
  "listeners": 3,
  "activeTweens": 1,
  "activeAsyncTasks": 1,
  "blobUrls": 24,
  "pooledObjects": {},
  "displayObjectsByOwner": {
    "world": 6,
    "dialogue": 12,
    "menu": 5,
    "gallery": 1,
    "system": 4
  }
}
~~~

这是“运行中有可见投影”的稳定点，不冒充 dispose 终态；dispose 终态由 Renderer 真实循环测试覆盖。

### 5.1 首次 EXE 探针的失败记录

第一次隔离 EXE 探针在所有业务检查通过后，主动先调用 runtime.dispose()，随后又触发正式游戏 beforeunload。正式游戏的正常 teardown 会再次调用 assets.releaseRegisteredAssetSources()，于是记录到：

~~~
RendererError: Renderer runtime has already been disposed
~~~

这不是玩家关闭程序的真实顺序，而是验收脚本绕过正式游戏 owner teardown 后制造的重复顺序。没有通过吞掉错误或降低门禁处理；脚本改为先读取稳定 live snapshot，再执行真实自然关闭。第二次 EXE 验收在自然关闭路径下 page/console/request errors 均为 0，并且 Settings、Profile、quick save 文件都确认位于本次新建的临时 userData 内。没有为此扩大 M8 生产代码范围。

## 6. 性能 A/B 与历史风险

因为 M8 修改了 Starter/正式游戏可达运行时代码，执行了计划要求的一次固定配对 A/B。没有继续重复抽样来挑绿色轮次。

### 6.1 采样协议

~~~
baseline = 12c539904ee2971f7190b8a25e846aa202c934ce  （M7.5 开工前的 M7 最终运行时）
current  = 89c69ab427d75b064c761832bd09695778e446e6  （M8 最终运行时代码）
pairCount = 20
warmup = baseline 一次、current 一次
正式 raw = 40 次（每边 20 次）
顺序 = 奇数 pair: baseline → current；偶数 pair: current → baseline
工具 = 官方 renderer-baseline-v3-ab runner + 官方比较器
userData = 每次独立系统临时目录
异常值 = 不删除、不隐藏
~~~

M8 artifact：

~~~
path      = docs/baselines/renderer-v3-m8-ab-2026-08-10.json
sampledAt = 2026-08-09T16:15:05.134Z
rebuiltAt = 2026-08-09T16:16:42.144Z
raw       = warmups 2 + formal 40
health    = assetsFailed 0, pageErrors 0, consoleErrors 0, failedRequests 0
~~~

第一次执行因两 worktree 的 package-lock.json 字节 SHA 不一致被官方 comparator 硬门禁拒绝，没有把它当成性能样本；统一同一份锁文件字节后按同一预声明协议完成有效采样。该失败记录没有被隐藏。

### 6.2 M7.5→M8 正式比较

| 指标 | 统计量 | baseline | M8 current | gateRatio | 门限 | 结果 |
|---|---|---:|---:|---:|---:|---|
| coldStartMs | median | 963.4208 | 913.04515 | 0.9477116853 | 1.10 | PASS |
| assetReadyMs | median | 1056.2238 | 1107.56135 | 1.0486048033 | 1.10 | PASS |
| menuOpenP95Ms | p95 | 12.8300 | 10.5450 | 0.8219017929 | 1.15 | PASS |
| sceneP95Ms | p95 | 31.6600 | 36.1200 | 1.1408717626 | 1.15 | PASS |

这是 M7.5→M8 增量结论，不是 M0→M8 历史绿灯结论。

### 6.3 M0→M8 历史风险与 M7.5 红灯保留

静态 Starter 主 bundle 字节数：

| 版本 | 主 bundle |
|---|---:|
| M0 / cab200b | 583,620 |
| M6 | 618,400 |
| M7 | 626,051 |
| M7.5 current | 626,453 |
| M8 current | 651,823 |

增量：

- M7.5→M8：+25,370 字节，约 +4.050%；
- M0→M8：+68,203 字节，约 +11.686%。

M7.5 冻结候选的官方复核结果仍是：

~~~
formalFailures = sceneP95Ms
gateRatio(sceneP95Ms) = 1.2488932612
limit = 1.15
historical v2 failures = coldStartMs, assetReadyMs, menuOpenP95Ms, sceneP95Ms
~~~

M8 A/B artifact 使用 M8 current 的正式摘要与冻结 v2 文件重建历史比较，仍记录：

~~~
historical assetReadyMs ratio = 1.1682578354  FAIL
historical sceneP95Ms ratio   = 1.4109374997  FAIL
~~~

没有修改 1.10/1.15 门限，没有删除性能字段，没有更新或覆盖 docs/baselines/renderer-v2-cab200b.json，没有把 pairedMedianRatio 当成正式 gate。

### 6.4 入口与静态 containment 检查

M8 current Starter bundle 中未发现 v3 诊断统计 token（renderer-baseline-v3、pairedMedianRatio、historicalComparison），也未发现 new PixiStage 或 new AdvRenderer；正式入口通过已构建的 Renderer v2 runtime 消费者路径工作。

~~~
rg -n "new PixiStage|new AdvRenderer|AdvStage" packages examples -g "*.ts"
rg -n "from .*layers/" packages/renderer/src/layers -g "*.ts"
~~~

结果：旧名称只出现在 Renderer 内部兼容实现/类型和测试；packages/renderer/src/layers 没有跨 Layer import。verify:renderer-legacy 2/2 和 verify:renderer-boundaries 3/3 同时通过。

## 7. Windows unpacked EXE 验收

命令：

~~~
$env:SURDET_GAME_DIR = (Resolve-Path 'examples/zero-after-midnight').Path
$env:SURDET_PACK_MODE = 'release'
npm run pack -w @surdet/shell
node packages/shell/scripts/verify-pack.mjs --artifact
~~~

没有设置 SURDET_ENCRYPT=0。打包日志确认：

~~~
game       = zero-after-midnight
title      = 零点之后
entryScene = prologue
encrypted  = true
staged assets = 50
~~~

精确 artifact：

~~~
path    = E:\surdet\packages\shell\release\win-unpacked\Surdet Game.exe
bytes   = 225,613,824
mtime   = 2026-08-09T16:17:58.8133412Z
SHA256  = 4618e3eae46e130ed6f815594961ea8c2886a88108bb4e5d872b9ca1c578d50d
~~~

独立临时 userData 启动结果：

- canvas：1211 × 681，存在；
- runtime asset loading：48/48，failed=0，done=true；
- body/title/ui 字体：SurdetGameBodyFont、SurdetGameTitleFont、SurdetGameUiFont；
- session 与 rendererRuntime/audioManager/frameScheduler resource IDs 均存在；
- title → prologue story 通过；
- quick save、quick load 和 save bridge slot quick 通过；
- Settings 写读值 textSpeedCps=31、masterVolume=0.73；
- Profile 写读 marker renderer-v2-wave-2；
- system boundary：opened=true、hadRollback=true、rollbackBlocked=true；
- Settings/Profile/quick save 文件均位于本次新建的临时 userData 子目录；
- 自然关闭后 page errors=0、console errors=0、failed requests=0；
- 临时根目录和 userData 在删除前均通过精确 assertUnder 校验，验收目录随后清理。

## 8. 全量门禁结果

以下结果均为本轮最终代码点上的新鲜执行记录：

| 命令/检查 | 结果 |
|---|---|
| Renderer 聚焦 Presentation/World/M7.5 | 5 文件 / 39 测试通过 |
| npm test -w @surdet/renderer | 46 文件 / 323 测试通过 |
| npm run typecheck -w @surdet/renderer | PASS |
| npm run build -w @surdet/renderer | PASS |
| npm run verify:renderer-boundaries | 3/3 PASS |
| npm run verify:renderer-legacy | 2/2 PASS |
| npm test -w surdet-starter | 2 文件 / 3 测试通过 |
| npm test -w @surdet/shell | 7 文件 / 44 测试通过 |
| npm run e2e -w @surdet/shell | PASS；Starter 存读档、剧情推进和系统交互通过 |
| Renderer v2 deterministic harness | 17/17 状态 PASS |
| npm run verify:all | PASS，退出码 0 |
| verify:tools | 7/7 PASS |
| 根级 workspace test | CLI 7/86、Core 23/298、Editor 20/135、Host 3/18、Renderer 46/323、Shell 7/44、Starter 2/3；合计 907/907 |
| 全 workspace typecheck | PASS |
| npm run lint -w zero-after-midnight | 11 场景、0 错误、0 警告 |
| npm run simulate -w zero-after-midnight | 23/23 分支、3 结局、运行时错误 0 |
| node examples/zero-after-midnight/scripts/check-assets.mjs | 44 项资产 PASS |
| npm run build -w zero-after-midnight | PASS |
| npm run pack -w @surdet/shell | PASS，release 加密包 |
| node packages/shell/scripts/verify-pack.mjs --artifact | PASS，app.asar 身份/关键文件/加密素材通过 |
| git diff --check | PASS |

## 9. 实际交付文件、排除文件与 Git 状态

### 9.1 纳入本次 M8 交付提交

- docs/ENGINE-RENDERER-V2-WAVE-2-DELIVERY-REPORT-2026-08-09.md
- docs/baselines/renderer-v3-m8-ab-2026-08-10.json

两者分别是可复核报告和完整 2 warmup + 40 raw 的 M8 A/B 证据；A/B artifact 没有替换 M7.5 候选。

M8 代码提交序列中已纳入第 3 节列出的 50 个已跟踪文件，包含 Renderer/Starter/Formal/Editor/CLI 的迁移和测试、边界/legacy 检查、文档和验收 harness。

### 9.2 明确排除、保护且不允许触碰

以下文件不修改、不暂存、不提交、不删除、不移动、不推送：

~~~
USER.md
SESSION-HANDOFF.md
docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
~~~

它们在最终状态仍是既有未跟踪文件。docs/baselines/renderer-v2-cab200b.json 也未修改。

### 9.3 停止点

~~~
状态        = WAITING_FOR_REVIEW
远端推送    = 未执行
force push  = 未执行
正式发行    = 未批准、未宣布、等待独立最终复审
M9          = 未开始（不在本次授权范围）
~~~

## 10. 遗留风险与复审重点

1. sceneP95Ms 是已知性能红灯：M7.5 正式候选 1.2488932612 > 1.15，不能因为 M7.5→M8 增量 A/B 为 1.1408717626 就删除或改写。
2. M0→M8 bundle 累积增加约 11.686%；M8 本轮没有在缺少热点证据的情况下做缓存、懒加载或阈值调整。
3. 直接在正式游戏 owner teardown 之外先调用 runtime.dispose()，再让正式游戏 beforeunload 清理，能够制造“disposed 后资产释放”的 page error；本轮已保留该失败证据并改用真实自然关闭验收，未通过吞错掩盖。后续若要支持任意外部主动 dispose 后仍允许宿主 teardown，需要单独立项并先补明确契约测试。
4. 本报告是 M8 开发交付证据，不是发行批准；只有独立复审明确批准后，才可讨论 push 或正式发行。
