# Surdet Player Experience Wave 4 交付报告

状态：`PLAYER_EXPERIENCE_WAVE_4_IMPLEMENTED`
交付性质：公共 Renderer/Host 契约修复与正式《零点之后》玩家路径验收
报告日期：2026-08-12

## 1. 结论与范围

Wave 4 Task 0 → Task 9 已按计划串行完成。六项目标体验问题 G1–G6 均有先行红灯、最小公共层修复和同一验证路径的绿灯；D7/F11 只做既有行为回归，没有修改生产缩放策略。

本轮实际落地在 Renderer、Host、Core 和组合根公共接线层；Starter、《零点之后》和 CLI 模板只消费公共接口。没有修改 DSL、存档格式、剧情、美术、音频、性能 artifact、性能比较器、性能门限或 EXE 发布流程。

最终代码提交（报告写入前、用于所有 Wave 4 玩家 artifact 的源码提交）：

`38e8a62be9429bcdcf3255dbcb49da51a58c69ab`
`test(shell): gate player experience wave 4`

该提交之后只会创建本报告和计划台账的文档提交；文档提交不会改变运行时代码。包含交付文档后的最终 Git HEAD、ahead/behind 和工作树状态，以 Task 9 Step 7 的最终命令输出为准，未在本报告中预填不存在的提交哈希。

## 2. 基线与普通提交链

开工基线包含设计提交和计划提交，未执行 reset、rebase、amend、squash、cherry-pick 或历史改写。

完整普通提交链：

1. `502a4d55caefe1c6df2919733035221271783652` — `docs(engine): design player experience wave 4`
2. `5850c816531a9a90b6bb1d18b992b4e14aec7385` — `docs(engine): plan player experience wave 4`
3. `f42379855873cdcd4158423896f529bdd1526b0f` — `fix(player): restore title gallery tab input`
4. `4c8967a378de35d855f9315dec962f4e05b94b5e` — `fix(renderer): stabilize command rail visuals`
5. `944f2a25ee34d226f5d9194f40ed61f8629b999f` — `fix(renderer): clip backlog beneath fixed header`
6. `c9ef9583e164985e864baa6713a5569309399a3e` — `fix(host): preserve history across consecutive rollback`
7. `32275c0485a9aa9b37cf83369ec00a4a87453553` — `feat(host): connect validated presentation snapshots`
8. `b07dae7d17edb3e991e3a3899786df3fc2c66780` — `feat(host): define clean title session boundary`
9. `c7b934cf1c2020aee49524f2f99f1f07ad0c643c` — `fix(player): unify presentation and title sessions`
10. `38e8a62be9429bcdcf3255dbcb49da51a58c69ab` — `test(shell): gate player experience wave 4`

Task 8 提交只包含：

- `packages/shell/e2e/player-experience-wave-4.e2e.mjs`
- `packages/shell/test/player-experience-wave-4-e2e-contract.test.ts`

计划台账和本报告没有混入 Task 8 提交。

## 3. G1–G6 红灯、根因与绿灯

### G1：标题来源 Gallery 标签切换与可见画面刷新

旧的语义 Case A 只能证明 `activeOverlay` 从 `gallery:cg` 变为 `gallery:music`，因此是假绿，不能证明 Pixi 画布已经刷新。

先行红灯：

- Renderer `gallery-layer.test.ts`：`13 passed / 2 failed / 15 total`；tab 语义和内容重建通过，但真实 Pixi pointerdown 后 `requestFrame` spy 没有调用。
- 正式 Zero Electron Case A：`activeOverlay=gallery:music`，但音乐页与点击前 CG 页的 PNG SHA/pixel hash 相同；六类错误数组为空，证明是缺帧而不是异常遮蔽。

最小修复：

- `packages/renderer/src/layers/gallery/gallery-layer.ts` 在 `#rebuildGallery()` 这一公共重建边界统一调用 `#requestFrame()`。
- 覆盖 CG→音乐、音乐→文本、文本→CG、CG viewer 返回列表等所有公共 rebuild 路径。
- 没有引入永久 ticker、标题来源特例、重复 UI 或资源 ownership 改变。

绿灯：

- Renderer Gallery：`15/15`。
- Host slots：`5/5`，title/game 两个来源都委托同一套 Gallery 公共路径。
- 正式 Zero Case A：CG→music→text→CG 画布 hash 真实变化并恢复，关闭回到 title；六类错误数组为空。

### G2：命令栏整体视觉稳定

先行红灯：

- Dialogue 新增测试 `3/3` 失败：`commandRailAlpha` 未定义，整体 rail tween 仍存在。
- 真实 resource cycle 测试失败：重复设置命令栏后 `activeTweens=1`，而预期为 `0`。

最小修复：

- 删除仅服务整体淡入/淡出的 wake/fade 状态字段和更新路径。
- command rail root alpha 固定为 `1`；背景自身的 `0.82` alpha 保留。
- hover 只修改目标 row 的 label/underline，不唤醒整条 rail；保留兼容入口但不再注册永久 canvas listener。

绿灯：

- Renderer 聚焦相关 `3 files / 36 tests` 通过，`activeTweens=0`。
- Wave 4 Case I 通过：等待 5 秒和连续句子后 root alpha 稳定，hover 只作用于单按钮。

### G3：Backlog 固定 header 与正文裁剪

先行红灯：

- Dialogue `2/5` 失败：布局快照缺失；空 query 仍显示 `Ctrl+F 搜索`，正文没有 mask。
- BacklogSearchController 原有测试 `2/2` 通过，未把控制器正常误报为失败。

最小修复：

- 固定 `headerY=30`。
- 空 query 使用 `viewportTop=76`；非空 query 使用 `viewportTop=92`。
- entries 使用独立容器和 Graphics mask；滚动 clamp 在 viewport 高度内；重建/关闭同步销毁 mask。
- 空 query 不创建常驻搜索提示，非空 query 只显示 `搜索：${query}`。

绿灯：

- Renderer 布局、搜索、theme、resource cycle 聚焦合计 `4 files / 41 tests` 通过。
- 正式 Zero Case C 真实滚轮/PageDown 通过；`headerY=30` 在滚动前后不变，正文 bounds 留在 viewport 内，关闭不推进剧情。

### G4：连续回退不丢历史

先行红灯：

- Host `rollback-runtime.test.ts` 真实模拟 `perform → renderer.resetSession → stateReset → host.reset → onSystemBoundary → clear`。
- 基线第二次 `perform()` 返回 `false`，说明第一次回退时共享 system boundary 清掉了回退历史。

最小修复：

- 将算法迁入 `packages/host/src/rollback-runtime.ts`，增加公共 `clearForBoundary()`。
- `perform()` 全程设置 `restoring=true`，覆盖 reset/load/Presentation/audio restore，finally 才恢复；恢复期间 boundary 不清历史。
- 异常时把目标 frame 放回并保留原始 cause；去重算法不额外跳过不同历史帧。
- `examples/shared/rollback-runtime.ts` 仅兼容 re-export，不再复制算法。

绿灯：

- Host rollback 聚焦 `1 file / 3 tests`。
- Starter rollback `2/2`；Zero 相关集成 `3 files / 23 tests`。
- 正式 Zero Case D 真实连续点击四次，位置严格为 `prologue:13 → 12 → 11 → 10 → 9`，中间没有推进。

### G5：Presentation 存档预验证与公共连接

先行红灯：

- Core `interpreter-save.test.ts`：`17 passed / 1 failed / 18 total`；非法 Presentation payload 没有在任何状态写入前被拒绝。
- Host connection 测试在公共模块尚不存在时收集失败；未在红灯前修改生产接线。

最小修复：

- Core 在完整 schema/system 校验后、任何变量/readSet/gallery/system/position/stateReset 写入前调用可选 Presentation `validate`。
- 新增 `packages/host/src/presentation-connection.ts`，只通过 Renderer public `commands/queries` 完成 snapshot/validate/restore 接线。
- `disconnect()` 设置 Interpreter hooks 为 null，重复断开幂等，断开后不调用已销毁 Runtime，不吞掉 RendererError cause。

绿灯：

- Core `18/18`。
- Host presentation connection 与 rollback `2 files / 4 tests`。
- Core build、Core/Host typecheck 通过。
- 正式 E/F 存读档矩阵证明背景、立绘、文本、command rail 和 overlay 恢复，非法 Presentation 在状态写入前失败且可重试。

### G6：返回标题时清理旧 World 和 Provider

先行红灯：

- Host 标题会话测试在 `packages/host/src/player-title-session.ts` 尚不存在时收集失败；既有 PlayerShellController 的 `18` 项仍通过。

最小修复：

- 新增 Host 公共 `enterPlayerTitleSession()`，固定顺序：shell reset → `renderer.resetSession({ preserveWorld:false })` → 最后 `openTitle()`。
- providers 关闭一次，重复调用幂等；任何步骤失败保留原始 cause，不伪造已打开的标题。
- Starter/Zero 通过只读 public query 确认 title projection；若幂等边界已成功但标题投影被隐藏，只发一次公共 title open，不访问 Layer 内部。

绿灯：

- Host title session、controller、slots `3 files / 31 tests`。
- 正式 Zero Case G/H 通过：游戏返回标题无旧 World，标题读档后返回仍无 release failure。

## 4. 公共层与采用层改动

### Renderer / Core / Host 公共层

- `packages/renderer/src/layers/gallery/gallery-layer.ts`
- `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- `packages/renderer/test/layers/gallery-layer.test.ts`
- `packages/renderer/test/layers/dialogue-layer.test.ts`
- `packages/renderer/test/integration/resource-cycles.test.ts`
- `packages/renderer/test/backlog-search-controller.test.ts`
- `packages/host/src/rollback-runtime.ts`
- `packages/host/src/presentation-connection.ts`
- `packages/host/src/player-title-session.ts`
- `packages/host/src/index.ts`
- `packages/core/src/runtime/interpreter.ts`
- 对应 Host/Core/Renderer 回归测试。

### Starter、Zero、CLI 和 Shell

- `examples/starter/src/main.ts`
- `examples/zero-after-midnight/src/main.ts`
- `examples/shared/rollback-runtime.ts`
- `packages/cli/templates/game/src/main.ts`
- 对应 Starter/Zero/CLI 集成测试。
- `packages/shell/e2e/player-experience-wave-4.e2e.mjs`
- `packages/shell/test/player-experience-wave-4-e2e-contract.test.ts`
- `packages/shell/package.json` 的 Wave 4 命令入口在 Task 1 已加入；Task 8 提交没有虚构或重复修改该文件。

没有新增第二套 PlayerShellController，没有复制 Host 回退算法，没有导入 Layer/Pixi 到 Host 或游戏业务公共层。

## 5. 正式 Zero Electron 玩家证据

Wave 4 runner 每个 case 都使用独立 Electron、独立临时 userData，并明确加载：

`E:\surdet\examples\zero-after-midnight\dist`

每个最终 schema case 均记录：

- `title = 零点之后 / AFTER MIDNIGHT`；
- `sourceRoot = E:\surdet\examples\zero-after-midnight`；
- `distRoot = E:\surdet\examples\zero-after-midnight\dist`；
- 独立 `userData`；
- 真实鼠标/键盘交互和语义断言；
- `assetLoading = { total:48, completed:48, failed:0, done:true }`；
- `assetComplete=true`；
- `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 全为空。

注意：上述 `48` 是本次 Electron runtime 的资源完成进度，不冒充正式项目资产数量；正式 Zero 项目资产数量由 `check-assets` 固定为 `44`。

### 最终 schema smoke

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-djQkAv\player-experience-wave-4-smoke.json`
- bytes：`1293`
- SHA-256：`EEFC3ACC5809AD9960A2B471DCAE5D16D7B0F1CCFA0491355C74A653ED3AACED`
- 结果：`PASSED`。

### 最终 schema A–J 第一轮

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-LxD7Q9\player-experience-wave-4-1786477593233.json`
- bytes：`43584`
- SHA-256：`83BBA3B8691060B8985D15244A24C40CC7A9F1BAADB5853D1E1951D2208F2C10`
- 结果：A–J `10/10`，`status=PASSED`。

### 最终 schema A–J 第二轮

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-PHO3Gv\player-experience-wave-4-1786477855065.json`
- bytes：`43584`
- SHA-256：`ABE02D6C9A760E2923D0DF327EE491509A006AA6223A3F3E9DEBED506915ADB9`
- 结果：A–J `10/10`，`status=PASSED`。

两份最终 artifact 已做只读结构验证：10 个 case 均为正式 Zero 身份、资产完成条件满足、六类错误数组为空，验证结果 `BAD=`。

### 矩阵中的关键路径

- Case A：标题 → Gallery → CG/music/text/CG → close；画布 hash 在每次 tab 切换时变化并在回到 CG 时恢复。
- Case B：游戏 → system menu → Backlog/Settings/Gallery → close。
- Case C：长 Backlog 真实滚轮/PageDown；header 固定、mask 生效、关闭不推进剧情。
- Case D：真实连续回退四次，状态严格按前一状态回退。
- Case E/F：保存后读档、读档后再保存/读档，背景、立绘、文本和 command rail 恢复。
- Case G/H：游戏返回标题、标题读档后返回标题，旧 World 清理且无 release failure。
- Case I：命令栏稳定与 hover 局部变化。
- Case J：F11 全屏进出回归，未改变 contain 策略。

## 6. Wave 4 证据质量与历史失败保留

### Schema 修复的红灯与绿灯

新增的 Shell 契约测试先在旧 runner 上失败：`4 passed / 1 failed`，缺失 `caseEvidence()` 和逐 case 的 `title/sourceRoot/distRoot/assetLoading`。修复后同一文件为 `1 file / 5 tests passed`。

修复后的 runner：

- `head` 从真实 `git rev-parse HEAD` 获取；
- 即使 case 失败，也保存已采集的 events、assertions、screenshots、错误对象和 stack；
- 明确记录正式 Zero identity 与 per-case asset completion；
- 使用新的临时目录写入 artifact，不覆盖旧证据。

### 真实失败轮次

早期第二轮完整 Wave 4 命令曾真实退出：`3221226505`（Windows `0xC0000409`）。失败根目录：

`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-BeQmhV`

该轮在 H 启动阶段终止，A–G 的独立 userData/session.log 已落盘，H 只有 userData/lockfile，没有最终 JSON；没有把它按产品绿灯处理，也没有覆盖/删除。预声明的 H 单例诊断随后通过：

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-Yq6KkW\player-experience-wave-4-1786476847655.json`
- bytes：`1792`
- SHA-256：`0F7983C8C225BD5ADF09E69B597C6D9417AD9A395A3AECED099E8129C04F47C3`

此外，旧 schema 的第一轮/替代轮 artifact 仍保留在计划台账中，但不作为最终 Task 8 身份证据；最终权威矩阵仅为上节的 LxD7Q9 和 PHO3Gv 两份 corrected schema artifact。

## 7. Wave 2、Wave 3 和 Renderer v2 旧回归

### Wave 2

- 命令：`npm run e2e:player-experience -w @surdet/shell`
- 结果：A–I `9/9`，exit `0`。
- artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-S8Yg8g\task7-player-experience-matrix.json`
- bytes：`755264`
- SHA-256：`397F34B79A7FA7244D4EC3FC37627DC34E9EFCBFBA11C07D62154C7380D44DCC`

### Wave 3

- 命令：`npm run e2e:player-shell-wave-3 -w @surdet/shell`
- 结果：A–F `6/6`，正式标题 `《零点之后》`，6 个独立 userData/新 Electron，exit `0`。
- artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-shell-wave-3-anema3\task7-player-shell-wave-3-matrix.json`
- bytes：`81843`
- SHA-256：`75570ED8D0F645CA415526411D494079207A819754EA93BD08A155FB77F2F886`

### Shell baseline

`npm run e2e -w @surdet/shell` exit `0`：saved/loaded 均为 true，steps=`55`，choices=`41`，最终 `awaiting-choice/choice`，scene=`ch01_01`。其中标题点击命中不足时的既有 debug fallback warning 仍按原命令事实记录；该 baseline 是 Starter，不冒充正式 Zero。

### Renderer v2

`npm run e2e:renderer-v2 -w @surdet/shell` exit `0`；Renderer v2 语义/资源/错误验收通过，视觉图片保持 `CANDIDATE`，没有升级为永久视觉金样。

- manifest：`E:\surdet\packages\shell\e2e\artifacts\renderer-v2-review-2026-08-11T20-01-15-686Z-42764\manifest.json`
- bytes：`25099`
- SHA-256：`77E2206BA56F9286D7C0FC7BA0E856716E62C391D3002A88484543B54B2F8BAE`

## 8. 全量门禁

### Task 9 Step 1 测试

以下均为 exit `0`：

| Workspace | Test files | Tests |
|---|---:|---:|
| `@surdet/core` | 23 | 305 |
| `@surdet/renderer` | 49 | 396 |
| `@surdet/host` | 11 | 84 |
| `@surdet/shell` | 17 | 130 |
| `surdet-starter` | 4 | 7 |
| `zero-after-midnight` | 2 | 21 |
| `@surdet/cli` | 7 | 87 |

此外，`npm run verify:all` 的 workspace 全测包含 `surdet-editor` `21 files / 142 tests`，其余 workspace 结果与上表一致。

### Task 9 Step 2 构建与类型检查

以下按依赖顺序全部 exit `0`：

- Core build/typecheck；
- Renderer build/typecheck；
- Host build/typecheck；
- Shell build/typecheck，sandbox preload 生成成功；
- Starter typecheck/build；
- Zero typecheck/build；
- CLI typecheck/build。

### Task 9 Step 3 正式 Zero

- lint：11 场景、0 errors、0 warnings；
- simulate：24 条探索路径、23/23 choice、39 次 save/load smoke、3 个结局可达、0 runtime errors；
- check-assets：44 项通过。

### Task 9 Step 4 仓库门禁

- `npm run verify:renderer-boundaries`：3/3；
- `npm run verify:renderer-legacy`：4/4；
- `npm run verify:tools`：10/10；
- `npm run verify:hygiene`：tracked 616 paths 通过；
- `npm run verify:all`：exit `0`；
- `git diff --check`：exit `0`；
- `git ls-files '*.log'`：0 个 tracked log。

## 9. Git、保护边界与停止状态

报告写入前的代码 HEAD：`38e8a62be9429bcdcf3255dbcb49da51a58c69ab`。报告和计划台账提交后，Task 9 Step 7 会重新读取真实最终 HEAD、ahead/behind 和工作树；不能把文档提交前的代码 HEAD 冒充文档提交后的最终 SHA。

四个受保护文件始终保持未跟踪，未修改、未暂存、未提交、未删除、未移动：

- `SESSION-HANDOFF.md`
- `USER.md`
- `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
- `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`

本轮明确未执行：

- `git push` 或任何 force push；
- M9；
- 性能测量、性能优化、正式跨版本 A/B；
- 性能 artifact、比较器或门限修改；
- 正式发行、EXE 打包或部署；
- 资产、音频、剧情和 DSL 修改；
- 存档格式修改。

最终停止状态：

```text
PLAYER_EXPERIENCE_WAVE_4_IMPLEMENTED
PUBLIC_RENDERER_HOST_CONTRACTS_IMPLEMENTED
TITLE_GALLERY_INPUT_VERIFIED
COMMAND_RAIL_STABLE
BACKLOG_VIEWPORT_CLIPPED
CONSECUTIVE_ROLLBACK_VERIFIED
PRESENTATION_SAVE_LOAD_VERIFIED
TITLE_WORLD_CLEANUP_VERIFIED
F11_FULLSCREEN_REGRESSION_PASSED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_REVIEW
```

## 10. Wave 4 最终证据微型收口（总经理复审整改）

本节是对本报告中旧的 E/F/I/J 证据质量的补充和收口，不删除历史记录，也不把旧 artifact 重新解释为新证据。本节权威范围仅限玩家证据 runner、静态契约测试、artifact 留证和本轮最终矩阵；没有修改 Renderer、Host、Core 或《零点之后》的生产实现。

### 10.1 原证据为什么不足

独立复审指出，旧的 `LxD7Q9` 与 `PHO3Gv` 两份完整矩阵虽然 A–J 语义结果为 `10/10`，但不能作为本轮最终证据：

- E/F 的保存前后 `portraits` 为空，未证明真实立绘参与存读档恢复；
- I 只记录 `title:new → wait:5s → story/hover`，没有固定的 20 次真实玩家推进，也没有每次命令栏 alpha/可见性记录和局部 hover 证据；
- J 只记录了交互目标 ID，没有在 F11 前后用 `page.mouse.click()` 真正点击 `rail:menu` 并恢复；
- 原先的标题 Gallery Case A 只检查了 `activeOverlay`，因此属于“内部语义假绿”：它证明状态机切到了 `gallery:music`/`gallery:text`，但没有证明静态标题画布已经提交新内容。后续 Task 1 的真实 `requestFrame` 红灯和画布 pixel hash 红灯已经证明该区别；公共 `GalleryLayer.#rebuildGallery()` 修复后，标题和游戏来源都以渲染画布证据通过。

旧 artifact 仍保留在临时目录并在前文台账中列出，但不再冒充 E/F/I/J 的最终权威证据。

### 10.2 本轮测试先行与真实失败轨迹

本轮先加入静态防漏契约，再改 runner：

- 红灯：契约测试 `5 passed / 1 failed`，失败断言为 runner 没有强制 `portraits.length >= 1`、`portraitProjection`、20 次推进、alpha 样本、真实 F11 菜单点击和失败留证字段；
- 绿灯：同一契约测试 `1 file / 6 tests passed`，并通过 `node --check packages/shell/e2e/player-experience-wave-4.e2e.mjs`；
- E 初始两次红灯是 runner 对新鲜 choice 使用 `Space`/`Enter`，未完成真实选项确认，不是产品错误；失败 artifact 未删除：
  - `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-pnHkhJ\player-experience-wave-4-1786506209126.json`，SHA-256 `60AF1C0324EDF905285B49801A749DD93522291C088E437F5A98C3575E5C89E6`；
  - `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-uSHeoE\player-experience-wave-4-1786506585970.json`，SHA-256 `553A4C2725A63E8147E5F25BC5CC505B45FDA0E8755606BC54BA36ADB0265F89`；
  - runner 改为真实数字键 `1` 选择首项后，E 通过；
- 提交后完整矩阵曾真实暴露 F 的打字机取样时序红灯：
  - `cY0Z7q` artifact，bytes `199018`，SHA-256 `747D464008F7F26B69BBE1509101E65EB17F776117A32C42DEA9AD672C9184C1`，F 在保存前取到中间文本“别”，读档后仍在空文本边界；
  - `EyMdel` artifact，bytes `26653`，SHA-256 `59ADB7F0C6218F8EF0ECD9DECA5F400246C86FC0E16CAA24002AA9ED0EA35F1F`，F 在保存前取到“别”，读档后取到完整文本“别开灯。”；
  - 两份失败的 `events.pageErrors/consoleErrors/requestFailures/unhandledRejections/rendererErrors/releaseFailures` 均为空，说明是证据采样时序而非资源或 Renderer 运行时错误；
  - runner 增加基于公开 `rendererStatus !== 'typing'` 的语义稳定等待后，同一 F 测试通过；没有固定延时、没有放宽恢复断言、没有修改生产代码。
- 最终 runner HEAD 上曾有一轮 I 的真实局部 hover 红灯：`6tK2NL` artifact，bytes `217665`，SHA-256 `533C0062DF777DC7B9268B63331D9BEA5AEBE7AD89B0B139A8BE0B95FAE1DC42`；20 次推进与 alpha 记录均通过，失败仅为 `rail:auto` 局部 PNG 前后相同，六类错误数组均为空。随后同一 HEAD 的 I 单项和两轮全量矩阵均通过；该失败 artifact 保留，不被绿色轮次覆盖。

本轮 runner-only 修正形成三个独立普通提交：

1. `10e993f04c0031f22001bee126c78abe7cd638ba` — `test(shell): strengthen wave 4 evidence contracts`；
2. `ff8e75849d06b1e0827288b7a26d17ee30ce97e6` — `test(shell): stabilize save-load evidence capture`；
3. `1cd27079260facb8e3d3aff00b12a6d0777f3509` — `test(shell): capture settled dialogue evidence`。

实际改动仅为：

- `E:\surdet\packages\shell\e2e\player-experience-wave-4.e2e.mjs`；
- `E:\surdet\packages\shell\test\player-experience-wave-4-e2e-contract.test.ts`。

### 10.3 E/F/I/J 最终可复核证据

- E：正式《零点之后》、独立 Electron/userData、真实数字键选择、存档前至少一项真实立绘投影、真实 World 扰动、读档后背景/立绘/portrait projection/对话/说话人/剧情位置恢复；最终两轮矩阵的 E 均通过。
- F：三次 save/load round-trip，保存前后均有真实 `zhirao:commute` portrait projection；两轮扰动后每次读档恢复，最终矩阵的 F 均通过。
- I：正式 Zero 入口连续 20 次真实 `advanceStoryStep`，每步位置或对话发生变化；最终记录 `commandRailAlphaSamples=24`，样本 alpha 均为 `1` 且普通状态可见；`rail:auto` 使用真实鼠标 hover，目标局部 PNG hash 变化，左右相邻区域 hash 保持不变。
- J：两轮 F11 前后均用真实 `page.mouse.click()` 点击 `rail:menu`，等待 `system-menu`，再真实点击 `system:resume`；`menuClicksUsed=2`，剧情位置保持不变；before/entered/exited 画布 aspect ratio 均为 `1.77826725403818`。

### 10.4 两轮最终完整矩阵（同一最终 runner HEAD）

两轮均通过同一正式入口 `E:\surdet\examples\zero-after-midnight\dist`，每个 case 使用独立 Electron 和独立 userData；artifact 的 `head` 均来自运行时真实 `git rev-parse HEAD`，为 `1cd27079260facb8e3d3aff00b12a6d0777f3509`。

| 轮次 | artifact | bytes | SHA-256 | 结果 |
|---|---|---:|---|---|
| 1 | `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-g1VS5I\player-experience-wave-4-1786512459793.json` | 240489 | `4EA455CCB37C97B407A715267EB67E7A72D5817A6E9BB530C398A0D3AF596FD8` | A–J `10/10`, `PASSED` |
| 2 | `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-mBHYqz\player-experience-wave-4-1786512685341.json` | 240517 | `A1493E90F8942A5C616EAEE91385C04CA31C31CED1C717587E9570D07044D58F` | A–J `10/10`, `PASSED` |

两份 artifact 的结构核对结果一致：正式标题 `零点之后 / AFTER MIDNIGHT`；source root 为 `E:\surdet\examples\zero-after-midnight`；dist root 为 `E:\surdet\examples\zero-after-midnight\dist`；每个 case `assetLoading=48/48/0/done=true`；E/F 真实立绘计数均为 `1`；I `progressionCount=20`、alpha 样本 `24`；J 真实菜单点击 `2`；`pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 六类数组在全部 case 均为空。

### 10.5 三项 harness 证据质量修正

1. artifact 顶层 `head` 改为运行时执行 `git rev-parse HEAD` 的真实值，不再写 `unknown`；
2. `caseEvidence()` 在失败时继续保留已经采集的 `events`、`assertions`、`screenshots`、`error`、`errorStack` 和最新 `lastSnapshot`；上述 E/F/I 失败 artifact 验证了这一点；
3. 删除 runner 中不存在的 `window.surdetDebug.showTitleScreen()` 调用，避免 harness 自身 setup 错误污染后续 case。

### 10.6 本轮边界与最终状态

- 未修改 Renderer/Host/Core、正式游戏剧情/资产/音频、DSL、存档格式、性能 artifact/比较器/门限；
- 未进入 M9，未做性能工作，未发行，未 push；
- 四个受保护文件未修改、未暂存、未提交、未删除、未移动：`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`；
- `AGENTS.md` 是本轮执行期间由外部环境新增的未跟踪文件，未被本轮修改、暂存、提交或删除，不能将其误列为本轮交付内容；
- 报告/计划台账提交后的最终 `HEAD`、ahead/behind、工作树和本报告字节数/SHA-256 以提交后最后一次只读核对为准，并在最终回报中记录真实值，不在提交前臆造。

本轮最终停止状态：

```text
PLAYER_EXPERIENCE_WAVE_4_EVIDENCE_REMEDIATION_COMPLETE
VISIBLE_EF_RESTORE_EVIDENCE_VERIFIED
COMMAND_RAIL_20_STEP_EVIDENCE_VERIFIED
F11_REAL_MOUSE_EVIDENCE_VERIFIED
WAVE_4_MATRIX_TWO_FINAL_RUNS_PASSED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_REVIEW
```
