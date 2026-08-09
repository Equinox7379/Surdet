# Surdet Renderer v2 M7 限定范围整改报告

日期：2026-08-09
状态：`WAITING_FOR_REVIEW`
里程碑：M7 限定范围整改（未开始 M8）

## 1. 结论

本轮只处理总经理独立复审指出的三个 M7 阻断项：

1. Presentation restore 的原子性；
2. RendererFacade 的 World speaker-focus 路由；
3. Renderer 基线的官方门禁与真实采样证据。

源码整改已形成独立本地提交：

`65718135369aaa227e678a0c1eee89b879b68378`
提交信息：`fix(renderer): remediate M7 presentation and routing`

本提交未推送远端。本报告作为独立交付文档随后提交；报告提交不包含任何用户文件、艺术总监交接文档、截图、日志、缓存或生成目录。

当前结论：三个限定问题均已完成最小整改，功能、结构、门禁及正式游戏验收通过；性能采样中出现过一次真实波动失败，但随后两轮独立采样连续通过官方冻结门槛。报告保留该失败样本，不提高阈值、不删除字段、不改写统计方法。现停止在 `WAITING_FOR_REVIEW`，等待独立复审，不进入 M8。

## 2. 基线、范围与禁止事项

### 2.1 起始基线

- M6 最终验收基线：`32375052f7b4bf68d2d97308a2bbca893916d5f9`
- M7 主体实现基线：`4a3df92ffc8272e2eeb2ea274a72a770a85e31bb`
- M7 首轮复审时的工作树 HEAD：`adcfeff87a7551d5f9ea158d2a02d1e7019e12bc`
- 本轮源码整改提交：`65718135369aaa227e678a0c1eee89b879b68378`

### 2.2 本轮允许范围

- 只修复 Presentation restore 的原子事务边界；
- 只修复 Facade 到 World projection port 的 speaker-focus 路由；
- 只修复有直接证据的生产 runtime scheduler 重复注册；
- 为上述问题补充直接回归测试；
- 执行规定的 Renderer、边界、全量门禁和正式游戏验收。

### 2.3 明确未做的工作

- 未开始 M8；
- 未进行正式消费者 cutover；
- 未扩展一版兼容层；
- 未修改 DSL、存档格式、游戏规则、编辑器行为或视觉文案；
- 未做大范围 bundle 拆分、懒加载重构或跨里程碑 Layer 重构；
- 未 push，未 force push。

## 3. 阻断项一：Presentation restore 原子性

### 3.1 修复前失败证据

先加入回归测试，再运行：

```text
npm test -w @surdet/renderer -- presentation-controller.test.ts legacy-dialogue-contract.test.ts
```

修复前结果为 2 个文件、11 个测试中 9 个通过、2 个失败：

- Presentation restore 测试：构造真实 `WorldLayer`，先建立背景和活动时间轴，再提交嵌套 World 快照中的非法 `cameraScale: 99`。旧实现先清除旧时间轴，随后才在 World restore 阶段抛错；异常返回后原快照中的活动时间轴已变成空数组，精确快照比较失败。
- speaker routing 测试：独立 World spy 未收到调用（实际为 0 次），说明 Facade 仍只走 Stage 端口。

这两个失败分别对应复审指出的两个行为阻断，而不是只检查最终可见值的弱测试。

### 3.2 实施的最小修复

`packages/renderer/src/runtime/presentation-controller.ts` 的 `restorePresentation()` 现在分成两个阶段：

1. `#preparePresentationRestore()` 只读解析并验证整个输入：版本、嵌套 Presentation/World 快照、timeline definition、timeline snapshot、ID 唯一性均在清理旧状态前完成；
2. 准备成功后才执行 `#clearTimelines()`、恢复 Stage、写入已准备好的 TimelinePlayer、投影游标事件并请求下一帧。

为嵌套 World 快照增加了只读验证端口：

- `WorldProjectionPort.validatePresentation()`；
- `WorldLayer.validatePresentation()`；
- `PixiStage.validatePresentation()`；
- `AdvRenderer` 兼容 presentation command 的验证委托；
- `RendererFacade` 对 World port 或 legacy Stage 验证端口的选择。

验证失败统一以 `RendererCommandError`、错误码 `PRESENTATION_SNAPSHOT_INVALID` 报告，且在验证阶段不清除当前 Controller 时间轴或 Stage 表现状态。

### 3.3 回归覆盖与结果

新增测试覆盖：

- 非法嵌套 World restore 时，活动时间轴、背景、相机等完整快照保持逐字段不变；
- 非法 restore 抛出 `PRESENTATION_SNAPSHOT_INVALID`；
- 随后对原快照执行合法 restore，结果仍与原快照精确相等；
- 真实 `RenderAssetRegistry`、`RenderLifecycle`、`WorldLayer` 与 `PresentationController` 组合能够完成上述事务边界。

修复后聚焦回归：2 个文件、11/11 通过。

## 4. 阻断项二：RendererFacade World speaker-focus 路由

### 4.1 修复前失败证据

测试使用真实 `PixiStage`，并注入独立的 `DialogueProjectionPort` 与可计数的独立 `WorldProjectionPort`，同时对 Stage 的旧方法建立 spy。它不只断言最终 `portraitFocusId`，而是断言每个端口的调用次数和参数。

修复前：

- v2 `facade.commands.dialogue.showText('凛', '对白')` 的 World port 调用次数为 0，未满足应为 1；
- 生产 v2 speaker 路径不能证明跨层协调经过 World port。

### 4.2 实施的最小修复

`packages/renderer/src/runtime/renderer-facade.ts` 的 `#coordinateWorldFocus()` 现在通过统一的 `#callWorld()` 路由：

- 有 `WorldProjectionPort` 时，Facade 调用 World port 一次；
- 无 World port 时，才回退到 legacy Stage 的 `setPortraitFocus` 一次；
- 本轮没有把 World 回调重新塞回 `DialogueLayer`，也没有新增同义隐式回调。

`createRendererRuntime()` 的生产 scheduler 接线同时移除重复的 `stage.worldLayer` source，只保留 PixiStage 这个已聚合 World/Dialogue/Menu 更新的 composition-root source。该改动仅针对已直接观察到的重复唤醒路径，没有扩展到其他性能重构。

### 4.3 回归结果

修复后的真实接线断言如下：

| 场景 | Dialogue port | World port | Stage focus | 结果 |
|---|---:|---:|---:|---|
| `showText('凛', ...)` 推导 `lynn` | 1 次 | 1 次，参数 `lynn` | 0 次 | 通过 |
| `setActiveSpeaker(null)` | 1 次 | 1 次，参数 `null` | 0 次 | 通过 |
| 无 DialogueProjectionPort 的 legacy fallback `setActiveSpeaker('lynn')` | 不适用 | 不适用 | Stage speaker 1 次，Stage focus 1 次 | 通过 |

直接 legacy `PixiStage`/`AdvRenderer` 路径继续保留旧的 speaker 与立绘焦点组合语义；重复文本的既有幂等规则没有修改。

## 5. 阻断项三：Renderer 官方性能基线

### 5.1 统计契约与冻结基线

比较器仍使用仓库内现有实现 `compareRendererBaseline`，没有修改统计逻辑或门槛。官方冻结文件：

`E:/surdet/docs/baselines/renderer-v2-cab200b.json`

| 指标 | 官方冻结值 | 统计方式 | 允许上限 |
|---|---:|---|---:|
| `coldStartMs` | 891.8183 ms | 5 个原始样本中位数 | +10% |
| `assetReadyMs` | 948.0453 ms | 5 个原始样本中位数 | +10% |
| `menuOpenP95Ms` | 10.8000 ms | 5 个原始样本 p95 | +15% |
| `sceneP95Ms` | 25.6000 ms | 5 个原始样本 p95 | +15% |

每一轮均先执行 1 次不计入统计的暖机，然后执行 5 次独立 Electron 启动，每次使用独立临时 `userData`。所有样本均为 `schemaVersion: 2`，默认未写入 `sourceEquivalentTo`；该字段没有被硬编码。

采样环境：

- Windows `win32 10.0.26220` / x64；
- CPU：AMD Ryzen 9 7940HX with Radeon Graphics；
- Node `v24.15.0`；npm `11.12.1`；
- Electron `43.2.0`；Playwright `1.62.1`；
- build mode：`electron-dev-shell-starter`；
- 所有样本：素材 `6/6`，页面错误 `0`，控制台错误 `0`，请求失败 `0`。

### 5.2 本轮真实原始样本

以下是提交 `65718135369aaa227e678a0c1eee89b879b68378` 上的三轮完整原始样本。原始 JSON 仍保存在本机临时目录：

- `<local-path>`
- `<local-path>`
- `<local-path>`

#### current-5（保留的真实失败样本）

| 指标 | 5 个原始样本 | 顶层值 | 相对官方值 | 门禁 |
|---|---|---:|---:|---|
| cold | 945.7055, 958.1443, 988.5950, 1025.8113, 1047.0637 | 988.5950 ms | 1.108516（+10.85%） | 失败 |
| asset | 990.8193, 1038.2258, 1353.1967, 1461.3672, 1487.4967 | 1353.1967 ms | 1.427354（+42.74%） | 失败 |
| menu | 5.8000, 6.9000, 10.5000, 11.5000, 11.7000 | 11.7000 ms | 1.083333（+8.33%） | 通过 |
| scene | 24.5000, 24.8000, 25.9000, 28.9000, 29.3000 | 29.3000 ms | 1.144531（+14.45%） | 通过 |

#### current-6

| 指标 | 5 个原始样本 | 顶层值 | 相对官方值 | 门禁 |
|---|---|---:|---:|---|
| cold | 930.7604, 961.6649, 980.1517, 996.0512, 1017.8363 | 980.1517 ms | 1.099049（+9.90%） | 通过 |
| asset | 974.7075, 1023.6259, 1039.7641, 1066.3763, 1353.8146 | 1039.7641 ms | 1.096745（+9.67%） | 通过 |
| menu | 7.8000, 8.2000, 10.5000, 10.6000, 12.0000 | 12.0000 ms | 1.111111（+11.11%） | 通过 |
| scene | 24.8000, 24.9000, 26.1000, 27.8000, 28.1000 | 28.1000 ms | 1.097656（+9.77%） | 通过 |

#### current-7

| 指标 | 5 个原始样本 | 顶层值 | 相对官方值 | 门禁 |
|---|---|---:|---:|---|
| cold | 913.7300, 914.6200, 920.5238, 922.2000, 925.3600 | 920.5238 ms | 1.032188（+3.22%） | 通过 |
| asset | 957.2300, 958.4900, 969.1856, 972.6800, 1286.1600 | 969.1856 ms | 1.022299（+2.23%） | 通过 |
| menu | 6.3000, 6.3000, 7.2000, 10.4000, 10.8000 | 10.8000 ms | 1.000000 | 通过 |
| scene | 24.2000, 24.4000, 24.5000, 25.3000, 26.3000 | 26.3000 ms | 1.027344（+2.73%） | 通过 |

current-6 与 current-7 是同一提交上的连续两轮独立采样，四项均通过官方冻结门槛。current-5 的失败没有被删除或重算，因此本报告同时记录“曾发生波动”和“随后两轮连续通过”两个事实。

### 5.3 性能调查边界与遗留风险

已直接确认并修复的重复唤醒接线：旧 `createRendererRuntime()` 同时把 `stage` 和 `stage.worldLayer` 注册给 `FrameScheduler`，而 WorldLayer 自身还会经由 Stage 请求帧；现在只注册已聚合子层工作的 `stage`。

同时确认：正式 starter 入口本身原来已经使用 `[stage]` 作为 scheduler source，因此没有据此声称所有启动/资源耗时都由该一处接线造成。没有观察到可证明的重复素材准备；标题阶段 `backgroundKey` 为空时相关 refresh 不会执行。

当前构建产物中 starter index bundle 约为 `626051` bytes，而历史官方基线记录约为 `583620` bytes。这是 M3–M7 累积变更与历史比较环境之间的直接差异证据，但本轮没有在授权范围外做 bundle 拆分或懒加载改造，因此不能把它写成已证实的唯一根因。后续若性能再次不稳定，最小候选调查是用同一机器、同一提交链做 bundle/startup profiling，并单独验证 M6→M7 的增量；这属于后续性能调查，不属于本轮 M8 或正式 cutover。

## 6. 测试、门禁与正式游戏验收

### 6.1 失败测试先行与修复后聚焦测试

| 命令/检查 | 结果 |
|---|---|
| 修复前 `presentation-controller.test.ts` + `legacy-dialogue-contract.test.ts` | 11 项中 9 通过、2 失败，已记录于第 3/4 节 |
| 修复后同一聚焦回归 | 2 文件、11/11 通过 |
| M7 规定聚焦套件（10 个文件） | 54/54 通过 |
| `npm test -w @surdet/renderer` | 44 个文件、301/301 通过 |
| `npm run typecheck -w @surdet/renderer` | 通过 |
| `npm run build -w @surdet/renderer` | 通过 |
| `npm run verify:renderer-boundaries` | 3/3 通过 |
| `npm test -w surdet-starter` | 2 个文件、3/3 通过 |
| `npm run verify:all` | 退出码 0 |

M7 规定聚焦套件实际执行的文件为：

```text
world-layer.test.ts
legacy-world-contract.test.ts
pixi-stage.test.ts
world-effects-controller.test.ts
transition-registry.test.ts
timeline-player.test.ts
post-process.test.ts
resource-cycles.test.ts
presentation-controller.test.ts
presentation-clear.test.ts
```

### 6.2 Shell 与正式游戏

| 验收 | 结果 |
|---|---|
| `npm run e2e -w @surdet/shell` | 通过；引导、画布、标题→剧情、F5/F9 快速存读档、剧情推进全部通过 |
| `npm run lint -w zero-after-midnight` | 11 个场景，0 个错误，0 个警告 |
| `npm run simulate -w zero-after-midnight` | choice 分支 23/23；存档往返 39 次；运行时错误 0 |
| 正式游戏结局 | `testimony_end`、`meeting_end`、`silence_end`，共 3 个结局可达 |
| `node examples/zero-after-midnight/scripts/check-assets.mjs` | `assets ok: 44` |
| `npm run build -w zero-after-midnight` | 通过，893 modules transformed |

因此正式游戏验收仍为：23/23 选择分支、3 个结局、44 项资产、运行时错误 0，且 typecheck/build 与真实 Shell E2E 均通过。

## 7. 实际改动文件

### 7.1 源码整改提交 `65718135369aaa227e678a0c1eee89b879b68378`

```text
packages/renderer/src/adv-renderer.ts
packages/renderer/src/api/renderer-commands.ts
packages/renderer/src/layers/world/world-layer.ts
packages/renderer/src/pixi-stage.ts
packages/renderer/src/runtime/create-renderer-runtime.ts
packages/renderer/src/runtime/presentation-controller.ts
packages/renderer/src/runtime/renderer-facade.ts
packages/renderer/test/legacy/legacy-dialogue-contract.test.ts
packages/renderer/test/runtime/presentation-controller.test.ts
```

统计：226 行新增、23 行删除；没有其他源码包、游戏脚本、DSL、存档或编辑器文件被纳入该提交。

### 7.2 本报告文件

```text
docs/ENGINE-RENDERER-V2-M7-REMEDIATION-REPORT-2026-08-09.md
```

该文件是本轮交付报告，单独提交。提交完成后的完整文档提交 SHA、最终 HEAD、ahead/behind 将在最终只读核对与对用户回报中列出；源码整改提交的完整 SHA 已在本报告和 Git 历史中固定为 `65718135369aaa227e678a0c1eee89b879b68378`。

## 8. Git 状态与明确排除文件

源码提交完成后的核对：

- `HEAD`：`65718135369aaa227e678a0c1eee89b879b68378`
- `HEAD...surdet/main`：`52 0`
- `git diff --check`：通过
- 源码整改提交后没有已跟踪未提交修改。

以下文件在工作树中保持原样，未读取后改写、未暂存、未提交、未删除、未推送：

```text
USER.md
SESSION-HANDOFF.md
docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
```

其中最后一项是本轮状态检查时发现的额外既有未跟踪文档，也明确排除在本次施工和提交之外。

## 9. 交付状态

- M7 限定整改：完成；
- 三个复审阻断项：均有失败测试、最小修复和通过后的回归证据；
- 官方性能门禁：current-6 与 current-7 连续两轮四项通过，同时保留 current-5 失败样本；
- 正式游戏：23/23、3 结局、44 资产、运行时错误 0；
- M8：未开始；
- 正式消费者 cutover：未开始；
- 远端：未 push；
- 当前状态：`WAITING_FOR_REVIEW`。

等待总经理独立复审及“批准进入 M8”的明确指令。
