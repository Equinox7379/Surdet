# Surdet Renderer v2 M7.5 验证与基线报告

日期：2026-08-09
项目目录：E:/surdet
当前状态：〔WAITING_FOR_REVIEW〕
里程碑：M7.5 限定整改；M8 未开始

## 1. 交付结论

本轮严格限定在 M7.5 两项任务：

1. 统一 Presentation 完整快照验证与 Stage/World 窄验证端口的语义；
2. 建立不改写旧 v2 证据的 Renderer 性能基线 v3，并完成预先固定的 20 对配对 A/B 验证。

两项任务均已完成：

- PresentationCommands.validate 现在始终表示完整 Presentation 快照验证；
- WorldLayer 只接收 snapshot.stage 对应的 World 快照；
- PresentationController.validatePresentation() 与 restore 共用同一套准备/验证逻辑；
- 直接构造 PresentationController 时，缺少 Stage 窄验证器不会静默跳过非法嵌套状态，而是 fail closed；
- v2 冻结文件保持原样、原 schema 和原统计含义；
- v3 候选 A/B 保存 2 次暖机、40 个正式启动样本、baseline/current 全部 raw 样本、统计值、配对比率、环境、执行顺序和健康状态；
- v3 的四项配对性能门禁均通过，但历史 v2 冻结比较在本机本轮四项均失败。历史失败没有被删除、过滤或改写，因此本报告不宣称旧 v2 门禁已经关闭；
- v3 文件仍是候选基线，必须经过独立复审后才能成为正式门禁。

本轮没有开始 M8，没有进行正式消费者 cutover，没有 push 或 force push，没有修改 DSL、存档格式、游戏规则、编辑器行为或正式游戏脚本。

## 2. 起始基线、提交和工作树边界

M7.5 起始 HEAD：

`text
1774dd6f84c0570fbd60658f39118041cc6843a9
`

本轮源码与候选数据提交链：

| 提交 | 含义 |
|---|---|
| 7347c460f90a8646505c05928fb700eb9a7a4602 | Presentation 端口统一、v3 统计/比较器、v3 测试、A/B runner |
| 6fa31f58a5cdd9bade4f528edba03fc02b1a530c | 修复 v3 runner 的仓库根目录定位，解除正式输出路径阻断 |
| 93b472bf20e351b53f151323d5080070427fd7f2 | 保留 AdvRenderer 无窄 Stage validator 时的 legacy fallback |
| 03d96e82d01928549578797286dfe177d5835629 | 第一套候选 A/B 原始数据，保留在 Git 历史中 |
| 9d39dc9db73bd66d36607ea7cb9c8d2bbe9d8b85 | 与最终源码 SHA 对齐后的候选数据 |

报告写作前现场核验：

`text
HEAD = 9d39dc9db73bd66d36607ea7cb9c8d2bbe9d8b85
git rev-list --left-right --count HEAD...surdet/main = 59 0
git diff --check = PASS
`

工作树中仅保留以下四个既有、未跟踪文件；它们没有被读取后改写、暂存、提交、删除或推送：

`text
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
`

本报告和候选 JSON 以外，没有把临时日志、截图、缓存、生成目录或上述四个文件纳入提交。

## 3. 任务一：完整 Presentation 验证与 Stage-only 验证

### 3.1 修复前失败证据

在 M7.5 起始 HEAD 上先加入回归测试，再运行：

`text
npm test -w @surdet/renderer -- presentation-controller.test.ts legacy-world-contract.test.ts
`

结果为 2 个文件、13 项测试：11 项通过、2 项失败。失败事实为：

1. createPresentationPorts(...).commands.presentation.validate(fullSnapshot) 的桥接把完整对象（包含 stage 和 timelines）传给了 World validator，而不是只传 fullSnapshot.stage；
2. 直接 new PresentationController(commands, queries) 且没有窄 Stage validator 时，非法嵌套 Stage/World 快照被静默接受，未按要求 fail closed。

这两项失败分别证明了公开完整验证端口与内部 World-only 验证端口存在语义混用，以及直接 Controller 构造路径存在验证缺口。

### 3.2 生产修复后的端口映射

整改后的数据流如下：

`text
完整 Presentation snapshot
        │
        ├── PresentationCommands.validate
        │       └── preparePresentationRestore(full snapshot, narrow stage validator)
        │
        └── PresentationController.validatePresentation / restorePresentation
                └── 同一套 preparePresentationRestore
                        ├── 校验 version、stage、timelines、timeline definition/snapshot、ID 唯一性
                        └── 仅将 snapshot.stage 交给 validateStagePresentation
                                ├── World port：以 World port 为 this 调用一次
                                └── legacy Stage：以 Stage 为 this 调用一次
`

具体保证：

- commands.presentation.validate 始终表示完整 Presentation 快照，不再承担 World-only 或 Stage-only 含义；
- WorldLayer.validatePresentation 只通过内部窄端口接收 snapshot.stage，不会收到 timelines；
- PresentationController.validatePresentation 与 restore 使用共享的 preparePresentationRestore，没有复制第二套规则；
- 直接 Controller 构造没有窄 validator 时，stage === null 的合法快照仍可验证；只要 stage !== null，就会抛出 PRESENTATION_SNAPSHOT_INVALID，不会递归调用公开 commands.presentation.validate，也不会静默跳过嵌套验证；
- AdvRenderer 的 legacy 路径有显式的无操作 Stage bridge，保留原有没有 Stage validator 的旧 API 行为；真实 PixiStage/World validator 路径仍使用正确接收者和窄快照；
- full snapshot 的验证不会清除时间轴、修改 World、播放音频、创建 Pixi 对象或请求帧。

### 3.3 修复后专项结果

`text
npm test -w @surdet/renderer -- presentation-controller.test.ts legacy-world-contract.test.ts
2 个文件、13/13 通过
`

随后发现的 legacy fallback 迁移阻断也先由完整测试暴露：初始 fail-closed 实现使 AdvRenderer 的旧快照恢复场景在没有 Stage validator 的构造中失败，完整 Renderer 结果为 43/44 文件、307/308。补上显式 legacy no-op bridge 后：

`text
npm test -w @surdet/renderer -- adv-renderer.test.ts
1 个文件、56/56 通过
`

该修复只恢复兼容窗口，不引入第二套 Presentation 状态机。

## 4. 任务二：Renderer 性能基线 v3

### 4.1 v2 证据保持不变

以下文件没有被覆盖、删除或改写：

`text
docs/baselines/renderer-v2-cab200b.json
`

其 schemaVersion 仍为 2，历史 sourceSha 仍为：

`text
16416535b4d55b0311ba54b93d5819f862b29170
`

旧 v2 的五样本 p95 计算在 n=5 时落到排序后的最后一个样本，实际等于最大值。本轮没有暗中改变这个含义；v2 只作为历史 informational comparison 读取。

### 4.2 v3 统计和门禁语义

v3 使用新的 schemaVersion: 3，规则固定如下：

| 指标 | 统计值 | 最低样本数 | 门限 |
|---|---:|---:|---:|
| coldStartMs（达到 window.__surdetDebug，Renderer ready marker） | median | 5 | current/baseline ≤ 1.10 |
| assetReadyMs（assetLoading.done === true） | median | 5 | current/baseline ≤ 1.10 |
| menuOpenP95Ms（菜单动作后一帧） | p95 | 20 | current/baseline ≤ 1.15 |
| sceneP95Ms（场景动作后一帧并等待 scene position） | p95 | 20 | current/baseline ≤ 1.15 |

v3 p95 使用线性插值，不再把五个样本的最大值称为稳定 p95。配对门禁优先使用同一 pair 的 current / baseline 比率集合的 median；表中的 aggregate summary ratio 只作信息展示，不替代配对门禁。10%/15% 原门限没有提高，样本没有被删除，异常值没有被过滤。

Runner 在每次独立 Electron 启动中都创建独立临时 userData，并保留 launch 错误、资源错误、原始计时和排序统计。每个正式角色 20 个样本，因此 baseline/current 各有 20 个 startup 样本和 20 个 interaction 样本。

### 4.3 固定 A/B 方法

最终候选数据使用以下隔离 worktree：

`text
baseline root:
<local-path>
source SHA: cab200b5aaed49b053b18ff05907aac4d02fb731

current root:
<local-path>
source SHA: 93b472bf20e351b53f151323d5080070427fd7f2
`

两边：

- 使用同一个 lockfile，SHA-256 为 60A48410727EB3C536AD005459A6E3460BB9ABF77E3BDD7D19C799429E273E8F；
- 均执行 npm ci --ignore-scripts --no-audit --no-fund；
- 使用相同构建顺序：core → renderer → host → shell → starter；
- 使用相同 Node/npm/Electron/Playwright 和构建模式；
- 使用独立临时 Electron userData；
- 先执行一次暖机 baseline、一次暖机 current，不计入正式样本；
- 预先固定 pairCount=20，正式样本总数固定为 40；
- 使用确定性的 counterbalanced 顺序，每两个 pair 交错角色：

`text
B C | C B | B C | C B | B C | C B | B C | C B | B C | C B |
B C | C B | B C | C B | B C | C B | B C | C B | B C | C B
`

其中 B=baseline、C=current。候选 JSON 中保存了完整的 40 项 executionOrder 对象，而不是只保存汇总字符串。

在第一次采样完成后发现最后一个 legacy fallback 修复尚未进入采样 SHA：第一套数据比较的是 cab200b → 6fa31f5，原始 JSON 已由提交 03d96e8 保留。为使正式候选的 currentCommit 与最终代码一致，按同一固定 20 对顺序重新执行一次替换性 A/B，最终候选比较的是 cab200b → 93b472b。这不是按结果挑选绿色轮次，也没有删除第一次数据；第一次候选仍可从 Git 历史取回，当前工作树中的候选文件以最终源码 SHA 对齐的第二套完整 raw 数据为准。

最终候选文件：

`text
docs/baselines/renderer-v3-candidate-2026-08-09.json
`

生成时间：2026-08-09T13:31:47.300Z。健康状态：暖机 2 次、正式样本 40 次、资源失败 0、页面错误 0、控制台错误 0、失败请求 0、环境差异 []。

### 4.4 最终候选 baseline/current 统计

单位均为毫秒；候选 JSON 保留完整浮点原值。summary ratio 是 current 汇总统计除以 baseline 汇总统计，paired ratio 才是 v3 官方配对门禁值。

| 指标 | baseline 统计 | current 统计 | summary ratio | paired ratio | limit | 结果 |
|---|---:|---:|---:|---:|---:|---|
| coldStartMs median | 1605.098450 | 1541.666600 | 0.960481 | 1.011370 | 1.10 | PASS |
| assetReadyMs median | 1715.267800 | 1752.011000 | 1.021421 | 1.012128 | 1.10 | PASS |
| menuOpenP95Ms p95 | 12.495000 | 12.925000 | 1.034414 | 1.065833 | 1.15 | PASS |
| sceneP95Ms p95 | 40.660000 | 50.780000 | 1.248893 | 1.018892 | 1.15 | PASS |

配对比较器返回的失败指标为空：

`text
v3 failures = []
`

### 4.5 全部正式 raw 样本

以下数组是最终候选 JSON 中的全部正式 raw metric samples，保留执行顺序中的每个角色内部 pair 顺序。没有删除其中的高值样本；例如 baseline cold 的 5377.6481、current cold 的 2773.0120，以及 scene 的高值都仍然在数组和候选 JSON 中。

#### baseline raw samples

`json
{
  "coldStartMs": [1620.6882000000005, 5377.648100000002, 1649.9542999999976, 1495.0703999999969, 1505.2109999999957, 1612.7854999999981, 1529.3104999999996, 1598.149100000002, 1473.5256999999983, 1908.6893999999884, 2218.7837, 1826.6879999999946, 1830.1484999999957, 1612.0478000000003, 1550.4619999999995, 1483.2376999999979, 1466.6486000000004, 1430.3341999999975, 1467.6503000000084, 1666.334200000012],
  "assetReadyMs": [2015.8742999999995, 5763.349399999999, 1699.507999999998, 1544.2672999999999, 1893.0703999999969, 1665.597999999998, 1578.1013999999996, 1648.1589999999997, 1856.4763999999996, 1962.5497999999934, 2283.583700000003, 2242.9045999999944, 2231.3333999999886, 1661.6010000000097, 1604.6333000000013, 1530.2595000000001, 1520.7595000000001, 1475.1549999999988, 1851.7790000000095, 1731.0276000000013],
  "menuOpenP95Ms": [6.600000001490116, 9.800000000745058, 11.600000001490116, 6.899999998509884, 7.400000002235174, 7.900000002235174, 7, 10.799999997019768, 8.5, 8, 12.399999998509884, 7.299999997019768, 10.800000000745058, 6.699999999254942, 7.399999998509884, 9.899999998509884, 12.099999997764826, 8.5, 8.399999998509884, 14.300000000745058],
  "sceneP95Ms": [28.5, 35.900000002235174, 28.100000001490116, 28.300000000745058, 29.900000002235174, 28.300000000745058, 27.300000000745058, 31.399999998509884, 29.199999999254942, 37.5, 40.19999999925494, 49.399999998509884, 34.69999999925494, 28.199999999254942, 29.900000002235174, 29.300000000745058, 28.800000000745058, 27.199999999254942, 27.400000002235174, 38.399999998509884]
}
`

#### current raw samples

`json
{
  "coldStartMs": [1912.3837000000003, 1841.8109000000004, 1523.1516999999985, 1514.8158000000003, 1550.776300000005, 1908.1324000000022, 1523.2776999999987, 1476.0161999999982, 2773.0120000000024, 2170.397100000002, 2585.368000000002, 1962.0181999999913, 1493.5406999999977, 1539.3931999999913, 1543.9400000000023, 1524.6564999999973, 1459.5235000000102, 1443.9700000000012, 1572.510099999985, 1517.6564000000071],
  "assetReadyMs": [1990.7922999999992, 1911.1222000000016, 1571.6743999999999, 1564.5304999999971, 1941.8994999999995, 1963.5662999999986, 1571.9029999999984, 1526.9542999999976, 3368.957000000009, 2237.653600000005, 3006.2936999999947, 2376.3410999999905, 1543.807099999991, 1924.4375999999903, 1592.8997999999992, 1575.7344999999914, 1513.5034000000014, 1491.5812999999907, 1955.6523999999918, 1567.0216000000073],
  "menuOpenP95Ms": [12.899999998509884, 10.300000000745058, 8.300000000745058, 7.899999998509884, 6.399999998509884, 10.899999998509884, 12.100000001490116, 0.8999999985098839, 10.5, 12.599999997764826, 13.399999998509884, 11.799999997019768, 8.900000002235174, 6.800000000745058, 7.199999999254942, 11, 8.300000000745058, 10.799999997019768, 6.699999999254942, 10.899999998509884],
  "sceneP95Ms": [47.29999999701977, 42, 29.900000002235174, 28.5, 28, 31, 27.199999999254942, 29.699999999254942, 48.399999998509884, 50.69999999925494, 52.30000000074506, 42.30000000074506, 25.299999997019768, 28, 28.699999999254942, 30.199999999254942, 27.599999997019768, 28.399999998509884, 30.5, 28.199999999254942]
}
`

### 4.6 历史 v2 informational comparison

同一套最终候选数据仍读取未修改的 renderer-v2-cab200b.json。本轮历史比较失败如下：

| 指标 | v2 historical baseline | current | 比率 | limit | 结果 |
|---|---:|---:|---:|---:|---|
| coldStartMs | 891.818300 | 1541.666600 | 1.728678 | 1.10 | informational FAIL |
| assetReadyMs | 948.045300 | 1752.011000 | 1.848025 | 1.10 | informational FAIL |
| menuOpenP95Ms | 10.800000 | 12.925000 | 1.196760 | 1.15 | informational FAIL |
| sceneP95Ms | 25.600000 | 50.780000 | 1.983594 | 1.15 | informational FAIL |

这四项失败被完整写入候选 JSON 的 historicalComparison.failures。它们说明当前机器状态与历史冻结样本的绝对耗时差异仍然很大；不能将 v3 的同会话配对 PASS 误说成旧 v2 冻结基线 PASS，也不能据此在本轮擅自修改冻结文件或提高门限。

### 4.7 首帧与启动入口检查的边界

本轮还检查了 Starter 入口及 runner 的实际测量语义：

- examples/starter/src/main.ts 直接接入的是 PixiStage、AdvRenderer、FrameScheduler 和 RenderPerformanceMonitor；scheduler source 是 [stage]；
- Starter 入口没有直接 import RendererFacade、createRendererRuntime 或 renderer-baseline-v3；
- coldStartMs 的停止点是 window.__surdetDebug ready marker，assetReadyMs 的停止点是 assetLoading.done === true；
- 菜单和场景动作各自等待一次 requestAnimationFrame，场景另外等待 position.sceneId；
- 当前 v3 schema 没有虚构一个未被 runtime 打点支持的独立 GPU first-paint 字段。由于 Starter 在加载素材前就创建只读 debug probe，coldStartMs 应理解为 Renderer ready marker，而不是像素级首帧提交时间；这项更细的 first-paint telemetry 留作后续经批准的诊断增强，不在 M7.5 擅自扩大入口接线或玩家功能范围。

## 5. Bundle 与静态入口增量

在相同构建模式下核对 Starter 主 bundle：

| 版本 | SHA | Starter 主 bundle | 相对前一阶段 |
|---|---|---:|---:|
| M0 / cab200b | cab200b5aaed49b053b18ff05907aac4d02fb731 | 583,620 bytes | — |
| M6 / 3237505 | 32375052f7b4bf68d2d97308a2bbca893916d5f9 | 618,400 bytes | M0→M6：+34,780 |
| M7 / 12c5399 | 12c539904ee2971f7190b8a25e846aa202c934ce | 626,051 bytes | M6→M7：+7,651；M0→M7：+42,431 |
| M7.5 candidate / 93b472b | 93b472bf20e351b53f151323d5080070427fd7f2 | 626,453 bytes | M7→M7.5：+402；M6→M7.5：+8,053；M0→M7.5：+42,833 |

静态检查结论：M7.5 没有把 RendererFacade 或 v3 comparator 直接接入 Starter 启动入口；bundle 增量来自 Renderer 包公开出口及本轮验证/兼容代码进入可达模块图的结果，不能仅凭 minified bundle 字符串把全部增量归因给某一个类。M7.5 没有进行无证据的 bundle 拆分、懒加载或性能微优化。

## 6. 完整门禁结果

以下命令均在最终源码 93b472b 上执行；候选数据刷新后，统计测试再次执行并通过。

| 命令/检查 | 结果 |
|---|---|
| Presentation validate/restore 专项 | 2 文件、13/13 |
| M7 World/Presentation 专项 | 10 文件、58/58 |
| Renderer baseline/statistics 专项 | 1 文件、6/6 |
| npm run typecheck -w @surdet/renderer | PASS |
| npm run build -w @surdet/renderer | PASS |
| npm test -w @surdet/renderer | 44 文件、308/308 |
| npm run verify:renderer-boundaries | 3/3，boundary check PASS |
| npm test -w surdet-starter | 2 文件、3/3 |
| npm run verify:all | PASS |
| npm run e2e -w @surdet/shell | PASS；引导、画布、标题→剧情、F5/F9 存读档、剧情推进均通过 |
| npm run lint -w zero-after-midnight | 11 场景、0 错误、0 警告 |
| npm run simulate -w zero-after-midnight | 23/23 分支、3 结局、39 次存读档往返、运行时错误 0 |
| node examples/zero-after-midnight/scripts/check-assets.mjs | 44 项资产 PASS |
| npm run build -w zero-after-midnight | PASS |
| git diff --check | PASS |

npm run verify:all 的 workspace 汇总也保持通过：verify tools 6/6、CLI 86/86、Core 298/298、Editor 133/133、Host 18/18、Renderer 44 文件 308/308、Shell 32/32、Starter 3/3；正式游戏资产 44、选择分支 23/23、结局 testimony_end / meeting_end / silence_end 共 3 个、运行时错误 0。

## 7. 实际纳入的文件

### 7.1 M7.5 源码、测试和工具

`text
packages/renderer/src/adv-renderer.ts
packages/renderer/src/diagnostics/renderer-baseline-v3.ts
packages/renderer/src/index.ts
packages/renderer/src/runtime/create-renderer-runtime.ts
packages/renderer/src/runtime/presentation-controller.ts
packages/renderer/test/diagnostics/renderer-baseline.test.ts
packages/renderer/test/legacy/legacy-world-contract.test.ts
packages/renderer/test/runtime/presentation-controller.test.ts
packages/shell/e2e/renderer-baseline-v3-ab.e2e.mjs
packages/shell/package.json
docs/baselines/renderer-v3-candidate-2026-08-09.json
`

本报告是本轮独立的文档交付物：

`text
docs/ENGINE-RENDERER-V2-M7-5-VALIDATION-AND-BASELINE-REPORT-2026-08-09.md
`

### 7.2 明确未纳入

以下文件保持未跟踪且未触碰：

`text
USER.md
SESSION-HANDOFF.md
docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
`

docs/baselines/renderer-v2-cab200b.json 未修改。没有提交日志、截图、缓存、生成目录、DSL、存档、游戏规则、编辑器行为或 M8 代码。

## 8. 遗留事项与停止点

1. v3 候选的同会话配对比较四项 PASS，但旧 v2 冻结比较四项 informational FAIL；旧 v2 门禁仍不能被报告为通过。
2. v3 候选只在独立复审批准后才能成为正式基线；本报告没有把候选文件改名覆盖 v2，也没有自动更新冻结基线。
3. coldStartMs 当前是 __surdetDebug Renderer ready marker，不是未经打点证明的 GPU first-paint；独立 first-paint telemetry 需要后续明确授权，不属于本轮实施范围。
4. M8 未开始，未进行正式消费者 cutover，未扩大兼容层，未 push，未 force push。
5. 等待总经理/独立复审对 M7.5 报告和 v3 候选的批准；在此之前不进入 M8。

## 9. 最终核验口径

报告提交前最后一次源码与候选数据 HEAD 为：

`text
9d39dc9db73bd66d36607ea7cb9c8d2bbe9d8b85
`

其完整 SHA、报告文档提交后的最终 HEAD、最终 git status --short 和最终 HEAD...surdet/main 计数以报告提交完成后立即执行的 Git 核验为准。报告提交只增加本文件，不改变上述源码、测试和候选数据结果；预期工作树仍只保留四个受保护的未跟踪文件。
