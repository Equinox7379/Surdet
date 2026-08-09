# Surdet Renderer v2 M7 第二轮限定整改与最终诊断报告

日期：2026-08-09；状态：`WAITING_FOR_REVIEW` ︱ M8：未开始 ︱ 远端推送：未执行

## 1. 执行边界与验收结论

本轮以总经理复审指出的最终 M7 阻断项为唯一施工范围：

1. 让 `commands.presentation.validate` 验证完整 Presentation 快照，并与 `PresentationController.restorePresentation` 共用同一套准备/验证路径。
2. 修复 World validate fallback 的接收者绑定，使 World port、Stage fallback 和 Stage 缺失 World port 三种路径各自绑定到真实拥有者。
3. 按预先声明的固定轮数，在隔离临时 Git worktree 中对 M0 与 M7 做同会话交错 A/B 性能诊断；不通过挑选偶然绿色轮次关闭门禁。

本轮没有开始 M8，没有正式消费者 cutover，没有修改 DSL、存档格式、游戏规则、编辑器行为或玩家功能，没有修改性能阈值、冻结基线、样本数和性能字段，也没有 push。

性能结论必须单独说明：Renderer 的功能、结构和正式游戏门禁全部通过，但官方冻结性能比较在本机当前状态下仍未稳定通过，因此性能门禁没有被关闭，M8 仍然被阻断。本报告是可复核的性能诊断，不把偶然通过轮次写成通过。

## 2. 基线、提交与工作树

| 项目 | 值 |
|---|---|
| M7 整改起始 HEAD | `12c539904ee2971f7190b8a25e846aa202c934ce` |
| 代码与测试提交 | `04459650fbdf85599d503bea9e6eae71165d9410` |
| 代码提交父提交 | `12c539904ee2971f7190b8a25e846aa202c934ce` |
| 分支 | `main` |
| 本地相对 `surdet/main`（代码提交后） | ahead `54` / behind `0` |
| 远端操作 | 未 push，未 force push |
| 最终交付状态 | `WAITING_FOR_REVIEW` |

报告文件在代码提交之后作为独立文档提交；最终报告提交 SHA 以本次交付后的 Git 回报为准。代码提交只包含本报告第 5 节列出的 7 个 Renderer 文件。

工作树在代码提交后只保留以下四个预先存在的未跟踪文件，均未读取后改写、暂存、提交、删除或推送：

- `USER.md`
- `SESSION-HANDOFF.md`
- `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
- `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`

## 3. 独立复审阻断项的修复

### 3.1 完整 Presentation validate

此前的 Facade validate 只做顶层形状检查，然后把 `snapshot.stage` 交给 World；它可以错误接受以下负载：

```ts
{ version: 2, stage: null, timelines: [] }
{ version: 1, stage: null, timelines: "not-an-array" }
```

整改内容：

- 在 `PresentationController` 公开 `validatePresentation(payload)`。
- `validatePresentation` 与 `restorePresentation` 都调用同一个 `#preparePresentationRestore`。
- `#preparePresentationRestore` 统一负责：顶层对象、`version === 1`、`timelines` 数组、timeline definition、timeline snapshot、有限数值 ID、ID 唯一性及嵌套 World 快照的准备/验证。
- Controller 在准备阶段验证失败时不清除已有时间轴、不恢复 Stage、不应用事件、不请求帧、不播放音频，也不改变可见状态。
- 嵌套 World 校验通过显式的内部 stage-validation port 接入，不复制 Presentation timeline 规则；World 自己继续复用其快照准备逻辑。
- `AdvRenderer` 增加兼容包装方法，legacy 调用仍进入同一个 Controller 意图。
- 所有拒绝路径继续使用 `PRESENTATION_SNAPSHOT_INVALID`。

新增直接回归覆盖：

- `version` 不等于 `1`；
- `timelines` 不是数组；
- timeline definition 非法；
- timeline snapshot 非法；
- timeline ID 重复；
- 嵌套 World 非法；
- 合法完整快照；
- validate 前后 Controller snapshot 完全不变。

### 3.2 World validate fallback 接收者绑定

此前采用“先选方法、再猜接收者”的写法，Stage 方法可能被以 World port 为 `this` 调用。

现在是显式分支：

```ts
if (worldPort?.validatePresentation) {
  worldPort.validatePresentation.call(worldPort, snapshot.stage ?? null);
} else if (stage.validatePresentation) {
  stage.validatePresentation.call(stage, snapshot.stage ?? null);
}
```

回归测试分别证明：

- World port 有校验方法：World 调用一次，Stage 调用零次，`this === worldPort`；
- World port 存在但没有可选校验方法：Stage 调用一次，`this === stage`；
- 没有 World port：Stage 调用一次，`this === stage`。

实际 v2 组合优先调用 `PresentationController.validatePresentation`，因此完整快照验证不会落回只验证 World 的旧分支；fallback 只保留给旧 Controller/旧 Stage 组合的兼容窗口。

## 4. 失败先行与修复证据

在生产代码修改之前，先在起始 HEAD `12c539904ee2971f7190b8a25e846aa202c934ce` 加入回归测试并执行：

```text
npm test -w @surdet/renderer -- presentation-controller.test.ts legacy-world-contract.test.ts
```

修复前结果：2 个测试文件、11 个测试；9 个通过、2 个失败。

- 完整 Presentation validate 测试未能拒绝非法完整快照；
- fallback 接收者测试收到的是 World port，而不是 Stage。

修复后同一聚焦命令结果：2 个测试文件、11/11 通过。随后将 fallback 测试扩展为三种接线分支，仍为 11/11 通过。

## 5. 实际改动文件

代码提交 `04459650fbdf85599d503bea9e6eae71165d9410` 只纳入以下 7 个文件：

1. `packages/renderer/src/adv-renderer.ts`
2. `packages/renderer/src/api/renderer-runtime.ts`
3. `packages/renderer/src/runtime/create-renderer-runtime.ts`
4. `packages/renderer/src/runtime/presentation-controller.ts`
5. `packages/renderer/src/runtime/renderer-facade.ts`
6. `packages/renderer/test/legacy/legacy-world-contract.test.ts`
7. `packages/renderer/test/runtime/presentation-controller.test.ts`

本轮没有为了性能另改生产代码；性能专项只采集、比较和分析。

## 6. 固定轮数性能诊断

### 6.1 预先声明的方法

测试开始前预先声明固定六轮，顺序严格为：

```text
M0 → M7 → M0 → M7 → M0 → M7
```

隔离环境：

- 临时 worktree 根目录：`C:\Users\Equinox\AppData\Local\Temp\surdet-m7-ab-20260809-2`
- M0 worktree：`...\m0`，源码 SHA `cab200b5aaed49b053b18ff05907aac4d02fb731`
- M7 worktree：`...\m7`，源码 SHA `12c539904ee2971f7190b8a25e846aa202c934ce`
- M0 轮次显式传入 `--source-equivalent-to cab200b5aaed49b053b18ff05907aac4d02fb731`；M7 轮次不写该字段。
- 两个 worktree 均使用同一 `package-lock.json`、`npm ci --ignore-scripts --no-audit --no-fund`、同一 Node/npm/Electron/Playwright。
- 两边使用相同构建顺序：core → renderer → host → shell → starter。
- 每轮先暖机一次，再采集 5 个独立 Electron 启动；每次启动使用独立临时 `userData`。
- cold/asset 保存 5 个完整原始样本，顶层按官方规则取中位数；menu/scene 顶层按官方规则取 p95。
- 使用仓库正式比较器和冻结文件 `docs/baselines/renderer-v2-cab200b.json`，没有自定义绿色规则。

环境记录：Node `v24.15.0`、npm `11.12.1`、Electron `43.2.0`、Playwright `1.62.1`、Windows `10.0.26220`、x64、AMD Ryzen 9 7940HX；构建模式为 `electron-dev-shell-starter`。

每轮完整 JSON 原始结果保存在：

```text
C:\Users\Equinox\AppData\Local\Temp\surdet-m7-ab-20260809-2\results\m0-1.json
C:\Users\Equinox\AppData\Local\Temp\surdet-m7-ab-20260809-2\results\m7-1.json
C:\Users\Equinox\AppData\Local\Temp\surdet-m7-ab-20260809-2\results\m0-2.json
C:\Users\Equinox\AppData\Local\Temp\surdet-m7-ab-20260809-2\results\m7-2.json
C:\Users\Equinox\AppData\Local\Temp\surdet-m7-ab-20260809-2\results\m0-3.json
C:\Users\Equinox\AppData\Local\Temp\surdet-m7-ab-20260809-2\results\m7-3.json
```

六轮均为资产 6/6、页面错误 0、控制台错误 0、失败请求 0。

### 6.2 冻结比较器与完整原始样本

冻结样本和门槛：

| 指标 | 冻结值 | 允许倍数 | 顶层统计 |
|---|---:|---:|---|
| `coldStartMs` | 891.8183 ms | 1.10 | 中位数 |
| `assetReadyMs` | 948.0453 ms | 1.10 | 中位数 |
| `menuOpenP95Ms` | 10.8000 ms | 1.15 | p95 |
| `sceneP95Ms` | 25.6000 ms | 1.15 | p95 |

下表的数组是每轮的 5 个独立正式样本；`top` 是官方比较器所用的顶层统计量，`✓/✗` 是相对冻结基线的正式比较结果。

#### M0-1

```text
cold  [909.9163, 927.1102, 930.2414, 936.2332, 998.1798]  top=930.2414  1.043084  ✓
asset [954.7864, 971.2595, 979.0519, 1040.2881, 1307.3652] top=979.0519  1.032706  ✓
menu  [5.3000, 6.1000, 7.8000, 9.8000, 10.7000]             top=10.7000  0.990741  ✓
scene [23.8000, 25.1000, 28.2000, 28.3000, 40.1000]          top=40.1000  1.566406  ✗
```

#### M7-1

```text
cold  [1043.3562, 1068.0603, 1073.1290, 1073.9394, 1115.1787] top=1073.1290 1.203305 ✗
asset [1095.5663, 1119.6382, 1121.7175, 1124.4297, 1552.4520] top=1121.7175 1.183190 ✗
menu  [0.8000, 6.8000, 7.4000, 9.7000, 10.9000]               top=10.9000  1.009259 ✓
scene [25.7000, 25.7000, 30.4000, 36.3000, 37.8000]            top=37.8000  1.476562 ✗
```

#### M0-2

```text
cold  [1053.9560, 1071.3518, 1087.6537, 1094.3777, 1137.6516] top=1087.6537 1.219591 ✗
asset [1122.3291, 1187.2566, 1434.1417, 1473.6543, 1486.9665] top=1434.1417 1.512735 ✗
menu  [6.8000, 7.4000, 8.4000, 9.9000, 11.6000]               top=11.6000  1.074074 ✓
scene [32.5000, 32.7000, 35.6000, 44.1000, 78.7000]            top=78.7000  3.074219 ✗
```

#### M7-2

```text
cold  [1005.4221, 1013.2794, 1044.3625, 1074.7758, 1100.2290] top=1044.3625 1.171049 ✗
asset [1061.9451, 1092.3242, 1128.1465, 1436.2152, 1490.5397] top=1128.1465 1.189971 ✗
menu  [9.3000, 9.5000, 9.9000, 11.0000, 12.1000]               top=12.1000  1.120370 ✓
scene [26.0000, 26.8000, 28.2000, 30.9000, 89.8000]             top=89.8000  3.507812 ✗
```

#### M0-3

```text
cold  [981.4334, 1036.0520, 1107.3348, 1114.5789, 1211.4320] top=1107.3348 1.241660 ✗
asset [1026.5396, 1169.0602, 1269.0082, 1433.2851, 1497.7672] top=1269.0082 1.338552 ✗
menu  [6.2000, 8.4000, 9.4000, 10.2000, 12.5000]               top=12.5000  1.157407 ✗
scene [24.4000, 25.6000, 26.8000, 35.4000, 96.8000]             top=96.8000  3.781250 ✗
```

#### M7-3

```text
cold  [966.3440, 982.1947, 987.9703, 996.2739, 1019.9186] top=987.9703  1.107816 ✗
asset [1028.3448, 1040.2637, 1042.9217, 1386.0830, 1412.1488] top=1042.9217 1.100076 ✗
menu  [6.8000, 7.7000, 9.6000, 10.9000, 11.9000]             top=11.9000  1.101852 ✓
scene [25.0000, 25.3000, 25.4000, 25.9000, 28.9000]            top=28.9000  1.128906 ✓
```

### 6.3 A/B 判断

结果不是“连续挑选两个通过轮次”的产物，而是固定序列的全部结果：

- M0-1 仅 scene 失败；M7-1 cold、asset、scene 失败；
- M0-2 cold、asset、scene 失败；M7-2 cold、asset、scene 失败；
- M0-3 四项全部失败；M7-3 cold 和 asset 仍略超 10%，menu/scene 通过。
- M0 的 scene 在三轮全部失败；M7 的 cold/asset 三轮全部失败；两边都没有稳定满足冻结门禁。
- 第 1 对中 M7 的 cold/asset 比 M0 慢、scene 比 M0 快；第 2 对中 M7 的 cold/asset 比 M0 快、scene 比 M0 慢；第 3 对 M7 四项均比 M0 快，但 cold/asset 仍因冻结门槛而失败。

因此这组同会话 A/B 支持的结论是：冻结历史样本与当前机器/系统状态之间存在差异，当前性能门禁不稳定；它没有证明一个可稳定复现的 M7-only 回退。当前没有足够证据进行定向性能优化，也没有理由擅自更新冻结基线。

### 6.4 就绪、首帧与场景提交拆分诊断

另外运行了相同构建和隔离方式下的诊断脚本；每边 1 次暖机 + 3 个正式样本，仅用于拆分瓶颈，不代替官方 5 样本比较器，也没有用它挑选绿色轮次。

M0 原始拆分样本：

```text
rendererReady          [918.6303, 892.4450, 894.2680]  median=894.2680
assetReady             [963.4430, 935.4927, 1243.6514] median=963.4430
firstFrameAfterReady   [10.2, 1.4, 10.4]               median=10.2
sceneCommandReturned   [24.2, 4.5, 4.6]                median=4.6
sceneNextFrame         [24.4, 29.2, 25.7]               median=25.7
sceneCommit            [27.7328, 33.1659, 30.1285]      median=30.1285
first-paint            [368, 368, 368]
first-contentful-paint [532, 520, 520]
```

M7 原始拆分样本：

```text
rendererReady          [928.8249, 929.0062, 903.2414]  median=928.8249
assetReady             [1285.8572, 973.7671, 1262.8181] median=1262.8181
firstFrameAfterReady   [4.0, 4.5, 4.1]                  median=4.1
sceneCommandReturned   [4.7, 5.3, 6.7]                  median=5.3
sceneNextFrame         [26.1, 25.9, 26.5]               median=26.1
sceneCommit            [31.4524, 30.2628, 30.2405]      median=30.2628
first-paint            [368, 380, 372]
first-contentful-paint [532, 540, 528]
```

这组小样本显示 M7 的 ready/asset 中位数较高，但 M0 也有资源高离群值；两边 scene commit 中位数约为 30.13 ms 与 30.26 ms，不能支持“场景提交必然由 M7 结构回退导致”的结论。完整原始拆分结果位于：

```text
C:\Users\Equinox\AppData\Local\Temp\surdet-m7-ab-20260809-2\results\breakdown-m0.json
C:\Users\Equinox\AppData\Local\Temp\surdet-m7-ab-20260809-2\results\breakdown-m7.json
```

### 6.5 Bundle 与静态接线检查

在两个 worktree 使用完全相同构建模式后，Starter 主 bundle 和总产物如下：

| 版本 | 总产物字节数 | Starter 主 bundle | 相对前一阶段 |
|---|---:|---:|---:|
| M0 / `cab200b` | 7,522,420 | 583,620 | — |
| M6 / `3237505` | 7,557,200 | 618,400 | M0→M6：+34,780 |
| M7 / `12c5399` | 7,564,851 | 626,051 | M6→M7：+7,651；M0→M7：+42,431 |

静态接线检查结果：

- `examples/starter/src/main.ts` 在 M0、M6、M7 间字节完全一致，SHA-256 为 `b133396a4b8a101af2c8b7e46e349768e0794e438c9705835554bd6fb102fda1`，大小 51,125 字节。
- Starter 入口显式使用 `PixiStage`、`AdvRenderer`、`FrameScheduler` 和 `RenderPerformanceMonitor`；没有直接 import `RendererFacade` 或 `createRendererRuntime`。
- M7 的 `PixiStage` 静态 import `DialogueLayer`、`MenuLayer`、`GalleryLayer`、`SystemPanelLayer`、`WorldLayer`。这些是实际生产投影实现，不应被误报为“仅供兼容/诊断”的死代码。
- `PresentationController` 通过 `AdvRenderer` 进入 legacy 主路径；`RenderPerformanceMonitor` 在 Starter 入口中是显式运行时依赖。
- 新 v2 Facade/runtime API 没有被 Starter 入口源码直接 import；是否进入最终 bundle 仍受生产模块的静态可达性和打包器 tree-shaking 影响，不能仅凭字符串搜索对 minified bundle 做过度归因。

## 7. 全量门禁结果

以下均在本轮修复后的工作树上重新执行并退出码为 0：

| 门禁 | 结果 |
|---|---|
| Presentation validate/restore 专项 | 2 个文件、11/11 |
| M7 World/Presentation 专项 | 10 个文件、56/56 |
| `npm run typecheck -w @surdet/renderer` | 通过 |
| `npm run build -w @surdet/renderer` | 通过 |
| `npm test -w @surdet/renderer` | 44 个文件、303/303 |
| `npm run verify:renderer-boundaries` | 3/3 + boundary check 通过 |
| `npm test -w surdet-starter` | 2 个文件、3/3 |
| `npm run verify:all` | 通过 |
| `npm run e2e -w @surdet/shell` | 通过；55 steps、41 choices、save/load 成功 |
| `npm run lint -w zero-after-midnight` | 11 场景、0 错误、0 警告 |
| `npm run simulate -w zero-after-midnight` | 23/23 choice 分支、3 结局、运行时错误 0 |
| `node examples/zero-after-midnight/scripts/check-assets.mjs` | `assets ok: 44` |
| `npm run build -w zero-after-midnight` | 通过 |
| `git diff --check` | 通过 |

`npm run verify:all` 还重新覆盖了根级工具测试、能力矩阵/唯一性/昂贵命令去重、shell:false 约束、Renderer boundaries、全 workspace 类型/测试、正式 lint/simulate/assets/build；本轮没有发现新的功能回归。

正式游戏验收结果：

- 选择分支：23/23；
- 结局：`testimony_end`、`meeting_end`、`silence_end`，共 3 个；
- 资产：44 项；
- 运行时错误：0。

## 8. Git 纳入与排除清单

纳入代码提交的只有第 5 节列出的 7 个文件；本报告随后作为独立文档提交。

明确排除且保持原状：

- `USER.md`
- `SESSION-HANDOFF.md`
- `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
- `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`

没有暂存、删除、清理或改写任何上述文件；没有提交截图、日志、缓存、临时 worktree 产物或生成目录；没有 push。

## 9. 遗留事项与停止点

本轮完成了两个代码阻断项，且全部功能/结构/正式游戏门禁通过。唯一未关闭的事项是官方冻结性能比较：在固定同会话 A/B 中 M0 与 M7 都无法稳定满足冻结阈值。该结果不能通过挑选样本、提高门槛、减少样本、删除字段或更新冻结基线来消除。

因此：

1. 不进行无证据的性能微优化；
2. 不更新 `docs/baselines/renderer-v2-cab200b.json`；
3. 不开始 M8；
4. 不 push；
5. 停止在 `WAITING_FOR_REVIEW`，等待总经理独立复审和明确的下一步指令。
