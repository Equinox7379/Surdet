# Surdet Player Shell Foundation Wave 3 最终限定整改报告

> 交付状态：`PLAYER_SHELL_FOUNDATION_WAVE_3_FINAL_REMEDIATION_COMPLETE`
>
> 复审状态：`WAITING_FOR_REVIEW`
>
> 本轮第三次最终限定整改严格限定为 R1–R4：完整五层 Theme token 身份审计、Starter Vite HMR 生命周期诊断、文档台账修正和最终门禁。未进入 M9、未进行性能工作、未 push、未发行。

> 本次最终微型收口在保留 S1/D1 既有成果的基础上，关闭了 S2 的 Gallery/五层 token 身份遗漏，并完成 Starter Vite HMR 的 owner/key 级诊断与确定性回归。HMR 的 `4 → 3` 是启动异步标题投影与测试过早点击造成的瞬态初始状态；修正等待条件后，长期 listener 集合稳定为三项，最终门禁不再保留该基线例外。

## 1. 结论与范围

本次整改解决了独立复审基于 `f0a0e3f7dc984c56a8136d3d39554639053b9ea3` 发现的三个阻断问题：

1. `PlayerUiSession.restore()` 不再接受非法根 `base`、`overlay`、布尔字段、嵌套 frame 或结构缺失的快照；非法输入在任何内部状态写入前失败，并保持原快照引用、值和 operation origin 不变。
2. 嵌套 Player Shell Provider 的 close/reopen 事务现在保留完整活动请求和上下文；子 Provider 已关闭而父 Provider 重开失败时，Controller 通过显式补偿保持 Session 与真实 Provider 投影一致，并保留原始错误 cause 及补偿错误 cause。
3. `setTheme()` 不再只更新主题状态或等待下一次 `show()`；Menu、Dialogue、Gallery、SystemPanel、Loading 五类 Layer 会对已经显示的真实 Pixi `PText`/`Graphics` DisplayObject 进行原地重绘，保留 Container、监听器、资源 owner 和音频，不创建新帧以外的额外生命周期。
4. Starter Vite HMR 不再用启动竞态下的数字 listener 总数判断生命周期；资源诊断现在记录 owner、kind、key、注册来源和 release/dispose 路径，正式回归验证两次合法 HMR、一次非法 HMR 和一次恢复后的三项长期 listener 均保持。

原 Wave 3 交付报告中把“命令/查询同步”和“Layer 收到 `setTheme`”写得过于接近真实画面验收。本次已修正文档，明确只有读取已经显示的 Pixi DisplayObject 颜色状态才构成真实视觉投影证据；该直接证据由本报告第 5 节给出。

### 最终状态

```text
PLAYER_SHELL_FOUNDATION_WAVE_3_FINAL_REMEDIATION_COMPLETE
PLAYER_UI_SNAPSHOT_VALIDATION_VERIFIED
PLAYER_SHELL_PROVIDER_ATOMICITY_VERIFIED
LIVE_RENDERER_THEME_PROJECTION_VERIFIED
THEME_TOKEN_IDENTITY_FULLY_VERIFIED
STARTER_HMR_RESOURCE_LIFECYCLE_VERIFIED
EXPECTED_ERROR_LEDGER_RETAINED
PERFORMANCE_WORK_DEFERRED
PERFORMANCE_MEASUREMENT_NOT_QUALIFIED_RETAINED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_REVIEW
```

### 明确未纳入本轮

- 未修改 DSL、`SaveSnapshot`、`SAVE_SCHEMA_VERSION`、存档格式或存档路径。
- 未修改剧情、游戏规则、美术、音频、正式资产或用户提供的四个受保护文件。
- 未修改性能脚本、性能 artifact、性能门限；未重新采样 Q1–Q5，未重跑旧版正式 A/B。
- 未开始 M9、Wave 4 或任何正式发行/EXE 重打包工作。
- Starter、《零点之后》和 CLI 仅保留必要的正式接线和验收改动，没有复制 Host 状态机或第二套主题逻辑。

## 2. 起点、当前实现边界与提交链

独立复审冻结起点：

```text
HEAD: f0a0e3f7dc984c56a8136d3d39554639053b9ea3
HEAD...surdet/main: 20 0
```

本次实现/测试提交均为普通新提交，没有 amend、rebase、reset、squash 或历史改写。第三次最终限定整改从 `75e53e61a1a8a1d2feb6c27250a9d41c653ec8bd` 开始；R1/R2 实现与测试提交后的 HEAD 为 `a38443bdf6ffdc4de0027286999832c3c6d9f13a`。此前 Wave 3/S1/S2/D1 提交链仍作为历史证据保留，不与本轮整改提交混写。

```text
90ba895fd7e47c6a80b75a61dbff201597cd52cd
```

本轮 R1–R3 提交完整 SHA 如下：

| 顺序 | 完整提交 SHA | 提交信息 | 责任范围 |
| ---: | --- | --- | --- |
| 1 | `47e42150462509fffd2e9368c47f8fba819f3796` | `test(host): expose invalid player snapshot restore` | R1 运行时快照非法输入红灯与回归测试 |
| 2 | `74b8f53b9515cb014b1053fc2964c07c38f72695` | `fix(host): validate complete player ui snapshots` | R1 完整快照校验、不可变提交与防部分写入 |
| 3 | `ee5a62214b37678b19ace8ea67f5f87d51d12d4f` | `test(host): expose nested provider rollback split` | R2 真实 Provider 投影和嵌套补偿红灯 |
| 4 | `dcc739fa6f209b5c4ba0f6cacc88919c76eeb5a5` | `fix(host): make player shell close compensation consistent` | R2 活动请求栈、父级重投影和 AggregateError 补偿 |
| 5 | `069b885228765afb3feab0b567d924c45dd08889` | `test(renderer): expose stale visible theme projections` | R3 真实 Pixi Layer 主题重绘红灯 |
| 6 | `80c1a0593214bd16adfc8f6f3245f5ec95e7e8a1` | `fix(renderer): repaint live player theme projections` | R3 原地重绘、主题投影快照和查询接线 |
| 7 | `7a8cca84c3090d8be8763de695a8dc27d6ee7bd8` | `test(shell): gate real wave 3 theme projection` | 正式 Zero Electron 场景 F 真实 Pixi 主题证据 |
| 8 | `de1b7535a2f2e2ec46e895815262b8a0279cdfa8` | `fix(renderer): scope theme repaint to owning layers` | 限制各 Layer 只重绘自己的显示树 |
| 9 | `b3b1d3c1a807ed8e90f0103d7153f0929ef4da93` | `fix(renderer): route player layer colors through theme` | 将共用 UI 视觉默认值接入主题令牌，保留玩法语义色 |
| 10 | `90ba895fd7e47c6a80b75a61dbff201597cd52cd` | `test(renderer): verify theme projection query purity` | 主题 projection query 的普通数据、深克隆和冻结纯度测试 |

本报告和历史报告口径修正将在上述实现/测试提交之后以新的普通文档提交归档。由于一个文件不能在自身内容中无矛盾地写入“包含该字段之后自身的 SHA-256”，本报告不伪造自引用哈希；最终报告文件的真实字节数、SHA-256、最终 HEAD、ahead/behind 和工作树由提交后机器复核输出记录。

### 2.1 本次最终微型收口追加提交

| 完整提交 SHA | 提交信息 | 责任范围 |
| --- | --- | --- |
| `40980f3bdc112acc859c91e3ce8c807510e4d68a` | `fix(host): converge player shell reset projections` | S1：reset/title/completeOperation 先清理真实 Provider，保持 Session、Provider、活动投影和 InputGate 一致，并保留原始/补偿错误 |
| `fbe8a5b55dbc29a9bbc5d40602496c0498004a8f` | `fix(renderer): preserve semantic theme token identity` | S2：以内部 WeakMap 保存 Player UI 颜色、字号和字距的稳定语义身份；同值 token 不再靠数值反推 |
| `78d9cbc50391c8cfbc212151ccba40564de57e90` | `test(shell): gate colliding theme restoration` | 正式 Zero Electron F 场景改为 text/accent 同值碰撞并验证恢复 |
| `fdc259984fcc07225d5d4dbec1cd784b2a9aaf83` | `test(shell): fix colliding theme predicate` | 修正页面谓词不得捕获 Node 局部变量；最终两轮 F 证据均由修正后的测试脚本产生 |
| `f4ae2f8e89c44a54a927dc96ecdf7f31041cbf26` | `fix(renderer): preserve save load transaction callbacks` | 最终代码下 Wave 2 save/load 异步回调回归：Provider teardown 后仍完成成功/错误回调，命令栏恢复 |
| `c7ec48abc22149f20b12e7b4973280d6a66f4443` | `docs(engine): record wave 3 micro remediation` | 三份报告/计划台账完成 D1 修正并归档 |

文档台账修正已在上述实现/测试提交之后以普通提交 `c7ec48abc22149f20b12e7b4973280d6a66f4443` 归档；未 amend 既有提交。

### 2.2 第三次最终限定整改提交

| 完整提交 SHA | 提交信息 | 责任范围 |
| --- | --- | --- |
| `1efd75f1058e6d23fe6ae43fc40578773439e184` | `fix(renderer): complete theme token identity audit` | R1：补齐 Gallery music/text/CG 分支及五类 Layer 的显式 token 绑定，并以 fail-closed 审计阻止未来遗漏；真实 Gallery 红灯修复前为 13 项失败，修复后焦点主题/Gallery/SystemPanel/Menu/Dialogue 测试 87/87。 |
| `a38443bdf6ffdc4de0027286999832c3c6d9f13a` | `fix(shell): make scene hmr lifecycle assertion deterministic` | R2：加入只读资源 owner/key/source/release 台账，Starter 调试查询只返回普通数据；修正启动等待竞态，回归覆盖两次合法 HMR、一次非法 HMR、一次恢复合法 HMR。 |
| `72cfea6c8d14db80e40ce1662090c99b628de747` | `docs(engine): record wave 3 final remediation diagnostics` | R3：三份文档完成 Theme/HMR 事实修正。 |
| `ba598386e02a7df06deffc4df82d3a0cda695f53` | `docs(engine): finalize wave 3 remediation delivery` | R4：最终整改报告归档。 |
| `7d53eeadd0bb3586111508d87458005cbc419fa0` | `docs(engine): close wave 3 execution ledger` | R4：执行台账收口。 |
| `fbf08a0cd898ed372797a7ebcdc5c444d86a471e` | `docs(engine): record wave 3 ledger close` | R4：补记 Wave 3 台账关闭事实。 |
| `fb94389b846faf18f47cf6d76ffc94673f3eabf2` | `docs(engine): normalize wave 3 ledger hash` | R4：台账哈希规范化。 |

R3 三份文档更新已由普通提交 `72cfea6c8d14db80e40ce1662090c99b628de747` 归档。R4 在该提交之后完成全部最终门禁；随后由 `ba598386`、`7d53eead`、`fbf08a0c` 和 `fb94389b` 完成报告、台账、遗漏记录和哈希规范化闭环。文档不伪造自引用的最终字节数/SHA-256，均以落盘后机器复核为准。

### 2.3 诊断设施最终微型收口（F1–F3）

本轮严格限定为 RenderLifecycle 诊断事件历史、resourceLedger 只读合同和三份 artifact 台账文档；未修改 Theme、PlayerShellController、Starter HMR 场景替换、DSL、存档、剧情、美术、音频或性能体系。

| 项目 | 修复前红灯 | 修复后绿灯 | 提交 |
| --- | --- | --- | --- |
| F1 RenderLifecycle 事件历史 | 同一聚焦命令中生命周期套件 9 项有 2 项失败：2048 次注册/释放后事件为 4097，且 replacement 缺少新资源 `register/replace` 事件 | 固定容量 1024 的环形缓冲淘汰最旧事件；active owner/kind/key/source 保留；replacement 同时记录旧 `dispose/replace` 与新 `register/replace`；forget/release/releaseOwner/dispose/failure cause 保留；生命周期聚焦 9/9 | `cff8691105523cf1edd8f23598808a6d31d50417` |
| F2 resourceLedger | 同一聚焦命令中 query-purity 套件 3 项有 1 项失败：Facade 返回的根 ledger 未冻结 | `resourceLedger` 复用深克隆 + 递归冻结路径；根、active/events 数组、entry/event 均不可写；查询不改变生命周期状态；query-purity 与 Renderer typecheck 通过 | `462c97b64118c5afe192fa2218611e0a2b0ae93c` |
| F3 artifact 台账 | 三份文档把当前 Wave 3 artifact 错写成“不输出错误数组字段” | 当前 Wave 3 artifact 为 schemaVersion=1；顶层无 `expectedRendererErrors` 汇总字段，但每个 `case.events` 含错误数组；C 为 `expectedErrors=2`、`expectedRendererErrors=1`，其余 case 均为 0；所有 case 的 page/console/request/unhandled/release 为 0 且 `unexpectedWindowClosed=false`；Wave 2 旧 schema 缺失字段仍按未观测记录 | 待本轮三份文档普通提交归档 |

## 3. R1：PlayerUiSession 完整快照运行时校验

### 3.1 独立复审复现与原测试漏点

独立复审构造如下非法根快照，原实现会把它当作可恢复状态接受：

```json
{
  "base": "corrupt",
  "overlay": "alien",
  "operation": "idle",
  "interfaceHidden": false,
  "videoActive": false,
  "returnStack": []
}
```

原有测试主要覆盖合法状态转换和表面 API 行为，没有逐字段验证 `base`、`overlay`、布尔值、嵌套 frame、字段缺失和异常数值的完整边界，因此没有捕获该复现。R1 遵循先测试后实现：新增测试在生产修复前运行时为 24 项中 9 项失败；失败直接来自非法输入被接受、恢复后状态未按合同失败和防御性复制缺口，不是人为降低断言后的红灯。

### 3.2 生产修复

主要文件：

- `packages/host/src/player-ui.ts`
- `packages/host/test/player-ui-coordination.test.ts`

修复内容：

- 统一校验根 `base`、`overlay`、`operation`、`interfaceHidden`、`videoActive` 和 `returnStack`。
- 统一校验每个 `returnStack` frame 的对象形状、`base` 和 `overlay`。
- 拒绝 `null`、数组冒充对象、缺失字段、非法字符串和 NaN 式非有限输入。
- constructor、`restore()` 和最终 commit 共享同一套准备/校验逻辑；不是只在 `restore()` 外部追加临时判断。
- 非法恢复统一抛出 `PLAYER_UI_INVALID_TRANSITION`，在 commit 前失败，原 Session 的引用、值和 operation origin 均保持不变。
- 合法恢复结果递归冻结，且不与调用方输入共享可写嵌套引用。

### 3.3 测试证据

| 检查 | 结果 |
| --- | --- |
| invalid root base | 通过 |
| invalid root overlay | 通过 |
| invalid boolean | 通过 |
| null snapshot | 通过 |
| invalid return frame | 通过 |
| valid nested idle snapshot | 通过 |
| restore 失败前后引用和值完全不变 | 通过 |
| operation origin 保留 | 通过 |
| 调用方对象不被冻结/不被修改 | 通过 |
| R1 聚焦测试 | 24/24 |
| Host typecheck | PASS |

## 4. R2：嵌套 close 的 Session/Provider 原子一致性

### 4.1 独立复审复现与原测试漏点

独立复审路径为：`game → system-menu → settings → close settings`。Settings Provider close 成功后，System Menu Provider reopen 抛错；原实现只恢复 Session snapshot，导致 Session 声称 `system-menu` 或 `settings` 仍在，而真实 Provider 已经关闭，或者父级重新投影失败后两者分裂。

原有测试只断言事件顺序/调用数组和 Session，未记录 Provider 的真实活动/可见状态，因此没有把该“账面状态与真实投影分离”作为失败条件。新增测试在生产修复前对关键嵌套场景产生 2 个失败：一个是父级重开失败后的真实投影不一致，另一个是补偿路径无法保留完整活动请求上下文。

### 4.2 生产修复

主要文件：

- `packages/host/src/player-shell-controller.ts`
- `packages/host/test/player-shell-controller.test.ts`

修复内容：

- Controller 保留完整活动 projection request 和 context，包括 save-load 的 `mode`，不再只由 `PlayerOverlay` 反推请求。
- close 先收敛当前子 Provider，再按完整父 frame 重开；父 frame 的操作失败时进入明确补偿流程。
- 每个已成功 Provider 副作用都有相应补偿路径；补偿失败不静默，使用 `AggregateError` 保留原始失败和补偿失败 cause，并统一映射到 `PLAYER_SHELL_SLOT_FAILED`。
- Provider 方法通过正确 receiver 调用，未改变正常路径不必要的调用次数。
- Session commit 与 Provider 实际活动投影在成功、失败、重试和 reset 后保持一致。

### 4.3 真实 Provider 状态证据

测试使用真实共享的 `state.visibleSlot`、`state.visibleRequest` 和 Provider open/close 计数，而不是只读事件数组：

- 子 Provider close 自身抛错：Session 保留原活动投影，Provider 仍标记为活动，错误保留原始 cause。
- 子 Provider close 成功、父 Provider reopen 抛错：测试确认子 Provider 的关闭和父 Provider 的补偿状态与最终 Session 一致，不存在幽灵 `settings` 或虚假的 `system-menu`。
- 父 Provider reopen 成功、后续收口步骤抛错：补偿路径保留失败和补偿 cause，实际可见槽位与 Session 相同。
- title/gallery 单层 close 失败：Session 与对应 Provider 活动标记不分裂。
- 正常 `system-menu → settings → close`：父菜单重新投影，随后连续 close 回到 `game/none`。
- 重复 close/无活动 overlay：稳定失败，不污染状态，可安全重试或 reset。

### 4.4 测试证据

| 检查 | 结果 |
| --- | --- |
| R2 聚焦测试 | 14/14 |
| Host 全量测试 | 8 文件 / 70 tests |
| Host typecheck | PASS |
| Host build | PASS |
| `PLAYER_SHELL_SLOT_FAILED` 与原始 cause | 通过 |
| Provider/Session 最终状态一致 | 通过 |

### 4.5 最终微型整改：reset/收敛状态一致性

独立复审基线上的直接回归在生产修复前先形成红灯：`player-shell-controller.test.ts` 的 18 项中 4 项失败，真实 Provider 的 `visibleSlot` 在 `system-menu → settings → reset('title')` 后仍为 `settings`，且 close 失败被吞掉或留下 Session/Provider 分裂。修复后同一 18 项全部通过。

Controller 现在先按活动栈自顶向下清理真实 Provider，只有清理成功才提交 Session reset/title/completeOperation；失败时保留原始 cause，补偿失败通过 `PlayerShellSlotError` + `AggregateError` 报告，并保留可安全重试的活动台账。成功收敛后的真实合同为：Session 的目标 base、`overlay=none`、`operation=idle`、`returnStack=[]`，Provider 实际可见状态为空，Controller 活动 projection 为空，InputGate 已 reset；随后重新 open/close 使用全新栈。

## 5. R3：五类已显示 Layer 的真实主题投影

### 5.1 独立复审复现与原测试漏点

独立复审在标题已经显示后调用 `MenuLayer.setTheme()`，观察到 `theme.colors.text` 从默认值变为 `0x123456`，但已显示标题的 `PText.style.fill` 不变。原 Wave 3 Electron 场景 F 只检查 commands/queries 中的 accent 数值，因此只能证明状态同步，不能证明显示对象重绘。

R3 先新增真实 Layer 红灯测试：用真实 Pixi `Container`、`Graphics`、`PText`、真实 Menu/Dialogue/Gallery/SystemPanel/Loading Layer、RenderLifecycle 和 RenderAssetRegistry，先显示界面，再调用 `setTheme()`，最后读取真实 DisplayObject 的 `TextStyle` 和 Graphics instruction。生产实现前聚焦集合为 20 项、6 项失败；失败具体表现为已显示文本/装饰仍保留旧色。

### 5.2 生产修复

主要文件：

- `packages/renderer/src/theme-projection.ts`
- `packages/renderer/src/api/renderer-queries.ts`
- `packages/renderer/src/pixi-stage-host.ts`
- `packages/renderer/src/layers/menu/menu-layer.ts`
- `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- `packages/renderer/src/layers/gallery/gallery-layer.ts`
- `packages/renderer/src/layers/system-panel/system-panel-layer.ts`
- `packages/renderer/src/loading-layer.ts`
- `packages/shell/e2e/player-shell-wave-3.e2e.mjs`
- `examples/zero-after-midnight/src/main.ts`

核心行为：

- `repaintThemeProjection()` 递归访问已有显示树，原地更新现有 `PText.style` 和 `Graphics.context` instruction 的颜色，不替换 Container、Texture、监听器、资源 owner 或音频。
- Player UI 的 `PText` 与 `Graphics` 在创建时通过内部 `WeakMap` 绑定稳定的语义 token（颜色、字号、字距）；绑定对象在同色主题和 Graphics context 重建后仍按原语义重绘。数值反推只保留给未绑定的旧兼容/玩法对象，不能决定已绑定 Player token 的身份。
- 每个 Layer 只重绘自己的拥有树：Menu 的 title/ending/menu/settings/saveLoad；Dialogue 的 dialogueRoot/overlayRoot；Gallery 的 galleryLayer；SystemPanel 的 battle/map/shop/base；Loading 的自身背景、进度条和文字。
- `readThemeProjection()` 返回冻结的普通数据对象；`RendererQueries.diagnostics.projectionSnapshot.themeProjection` 不暴露 Pixi、Layer 或可写引用。
- `setTheme()` 保持相同主题幂等、一次有效更新只请求一帧、非法 patch 不改变旧主题、disposed Runtime 按 RendererError 合同失败。
- Menu、Dialogue、Gallery、SystemPanel、Loading 的共用 UI 视觉默认值改为读取 `this.#theme.colors`；玩法语义色（如 HP/AP、地图状态、金币、战斗/世界语义）保留为独立颜色，并在源码附近说明其不属于 Player UI Theme。

### 5.3 五类真实 DisplayObject 证据

真实 Renderer 测试 `packages/renderer/test/theme.test.ts` 27/27 通过；最终 Renderer 全量为 48 文件 / 384 tests 通过，覆盖以下已显示对象，并增加同色 token、字体碰撞、同色主题下新建对象、重复主题和资源计数回归：

| Layer | 已显示内容 | 读取的真实投影 | 结论 |
| --- | --- | --- | --- |
| MenuLayer | title、可用菜单项、accent 装饰、system-menu、settings、save-load | 真实 `PText.style.fill` 与 Graphics instruction | 主题更新后原地换色，恢复默认后恢复 |
| DialogueLayer | 对话文字、说话人、选项/command rail、backlog overlay | 真实 Dialogue/overlay 树的文本与装饰颜色 | 主题更新后原地换色，资源计数不增 |
| GalleryLayer | gallery 标签、unlocked/locked music 与 text、空列表提示、CG viewer 返回提示 | 真实 gallery DisplayObject 文本/图形颜色 | 主题更新后原地换色，恢复默认后按原 token 恢复 |
| SystemPanelLayer | battle/map/shop/base 中至少一个已显示 Panel | 真实 Panel 文本/图形颜色 | 主题更新后原地换色 |
| LoadingLayer | loading 背景、进度条和文字 | 真实 Loading DisplayObject 颜色 | 主题更新后原地换色 |

测试同时确认：同主题幂等、无额外帧请求、非法主题不污染旧主题、disposed 失败、资源/监听器/显示对象计数不增长、调用方 patch 不被修改、查询返回冻结值。

### 5.4 查询纯度与正式 Runtime 证据

`packages/renderer/test/api/query-purity.test.ts` 2/2 通过，确认 `themeProjection` 是深克隆/递归冻结的普通数据，修改返回值不会影响 Layer；查询不会创建 Pixi 对象、注册资源、请求帧或改变可见状态。正式 Runtime 和 Starter debug 查询只提供语义快照，不暴露真实 Layer 引用。

正式 Electron 场景 F 的证据分两层：

1. 先检查 `commands.preferences.setTheme()` 与 `queries.preferences.theme()` 的 accent/text 状态同步。
2. 再读取主题设置前已显示的正式 Dialogue 对象的真实 `PText.style.fill`：默认 `0xf2f6ff` → 自定义 `0x123456` → 恢复默认 `0xf2f6ff`；资源计数保持不变。

这两层共同证明了命令/查询状态、Layer 主题意图和已显示 Pixi DisplayObject 真实重绘三者没有混淆。

### 5.5 最终微型整改：同值主题 token 身份

独立复审基线上的同色回归在生产修复前先形成红灯：原 `theme.test.ts` 的 26 项中 5 项失败；Menu、Gallery、Dialogue、SystemPanel 的同值颜色恢复会把默认 `text` 错恢复成 `accent`，字体碰撞会把 `uiSize` 错恢复成另一字号。R1 又增加了 fail-closed 遗漏审计和真实 Gallery 分支，最终主题套件为 27/27；最终 Renderer 全量为 48 文件 / 384 tests 通过。

整改后的绑定 API 在对象创建时把 Player UI 的颜色、字号和字距语义写入内部 `WeakMap`；切换 `A → B → C → default`、同主题重复设置、同色主题下新建对象，以及 Graphics instruction/context 重建都按稳定语义恢复。绑定不进入公共 query；查询继续只返回冻结普通数据，生命周期资源计数不增长。未绑定旧兼容/玩法对象仍可走 legacy fallback，但该 fallback 不再参与已绑定 Player token 身份判定。

## 6. Starter Vite HMR 诊断与修复

### 6.1 隔离复现与 owner/key 证据

诊断在两个独立临时 Git worktree 中进行，使用相同 Node `v24.15.0`、npm `11.12.1`、lockfile、`npm ci --ignore-scripts --no-audit --no-fund`、构建顺序和 Playwright/Vite 测试入口：

- 冻结基线 `4e0e752b7a23a6e7fab341e93f8cb13831254034`：原测试一次观测到初始 listener 数 4、第一次合法 HMR 后仍为 4；
- R1 后当前代码 `1efd75f1058e6d23fe6ae43fc40578773439e184`：原测试稳定复现初始 4、第一次合法 HMR 后为 3。

当前代码的只读 lifecycle ledger 明确显示，HMR 前多出的唯一活动 listener 是：

```text
owner = menu
kind  = listener
key   = title
source = at #registerListener (.../packages/renderer/dist/layers/menu/menu-layer.js:748:25)
```

长期 listener 则为：

```text
dialogue:listener:command-rail-pointer
runtime:listener:presentation-controller
runtime:listener:core-events
```

`menu:title` 的事件台账记录了 `register`（启动异步 `showTitleScreen()`）以及 HMR 后 `dispose / release`；其 `source` 与释放路径均来自真实 Renderer runtime，不是测试虚构。HMR 前后没有其他 owner/kind/key 消失，Blob、ticker、display owner 和 session/resource IDs 也没有变化。

根因是 Starter 在 `__surdetDebug` 暴露后仍可能处于异步 `loadAssets()` 尾段；原测试立即调用 `titleSelect('new')`，与 `loadAssets()` 完成后的 `showTitleScreen()` 竞争。于是测试把本来应在进入游戏前清除的 `menu:title` 瞬态 listener 采成初始长期资源；HMR 随后按正常 release 路径清除它，形成假性的 `4 → 3`。

### 6.2 最小处理与语义回归

没有修改生产 HMR 重新注册逻辑，也没有用延时、放宽断言或吞掉错误伪造通过。R2 只做两件事：

1. 为 `RenderLifecycle` 增加冻结的普通数据诊断快照，记录活动资源的 owner/kind/key/source 和 register/dispose/forget 的 path/outcome/cause；RendererFacade 与 Starter debug 只暴露深克隆后的诊断数据，不暴露 disposer、Layer 或 Pixi 引用。
2. 测试先等待 `assetLoading.done` 和资源快照存在，再执行 `titleSelect('new')`；随后以语义 listener 集合断言三项长期 listener，并保留 ticker、Blob、显示对象、session、resource IDs、舞台语义身份和导航次数断言。

同一回归现在覆盖：初始加载 → 合法 HMR 1 → 合法 HMR 2 → 非法 HMR 回滚 → 恢复合法文件。最终页面导航次数为 1；三项长期 listener 始终为上述集合；资源数量、Blob URL、ticker、display owner、sessionId、resourceIds 保持；非法编辑保留旧场景，恢复合法文件后场景哈希回到初始值，交互路径仍可继续。动态相机/淡入淡出/时间轴游标不作错误的精确相等断言，但 stage 的背景、粒子和立绘语义身份保持。

R2 证据：`render-lifecycle.test.ts` 7/7、Starter Vite HMR 1/1、Renderer typecheck/build、Starter typecheck 均通过。R4 最终 HEAD 上 Renderer 48/384、Host 8/70、Starter 4/7、根级 `verify:all` exit code 0。

## 7. Electron 玩家证据

所有 Wave 3 artifact 均使用独立 Electron、独立临时 `userData`，并明确加载正式游戏：

```text
E:\surdet\examples\zero-after-midnight\dist
```

每轮均记录 `schemaVersion`、A–F 结果、正式 dist 路径、独立 userData、资产加载和错误分类。历史 Wave 3 artifact 的权威错误台账为：`unexpected page errors = 0`、`unexpected console errors = 0`、`unexpected request failures = 0`、`unexpected unhandled rejections = 0`、`unexpected release failures = 0`；`expected injected Renderer errors = 1 per run`。R4 当前 Wave 3 artifact 为 `schemaVersion=1`：顶层没有单独的 `expectedRendererErrors` 汇总字段，但每个 `case.events` 都包含错误数组；case C 为 `expectedErrors=2`、`expectedRendererErrors=1`，其他 case 的两项均为 0。全部 case 的 `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`releaseFailures` 均为 0，`unexpectedWindowClosed=false`。历史记录中的 expected Renderer error 来自场景 C 的 save reject 注入，用于验证失败后的 retry success，不是非预期产品错误。

### 7.1 Wave 3 A–F：历史两轮与 R4 当前复验

| 轮次 | Artifact 绝对路径 | 字节数 | SHA-256 | 结果 |
| --- | --- | ---: | --- | --- |
| R4-current | `C:\Users\Equinox\AppData\Local\Temp\surdet-player-shell-wave-3-hEp080\task7-player-shell-wave-3-matrix.json` | 77835 | `B0AB3B65125DA3DFABF7FC97CEEDAA8663D71D9F2C5D71FAC034FDC804B0587B` | A–F 6/6 |
| round-1 | `C:\Users\Equinox\AppData\Local\Temp\surdet-player-shell-wave-3-uYMkKg\task7-player-shell-wave-3-matrix.json` | 77835 | `ACC8DB1006F797F3FB94E984CD009F414B70CC0616256043BAB9FD95936954FC` | A–F 6/6 |
| round-2 | `C:\Users\Equinox\AppData\Local\Temp\surdet-player-shell-wave-3-CWLvRm\task7-player-shell-wave-3-matrix.json` | 77835 | `D99630BFE50FDE4DA5FD4A65819140FAFCB81D53159028DBBF3BBFAE300C1D8D` | A–F 6/6 |

R4 当前复验和历史两轮均为 6 个独立 Electron / 6 个独立 userData，正式路径均为 Zero dist。R4 当前 artifact 的 schema 顶层字段为 `schemaVersion/phase/runKind/generatedAt/formalGame/isolation/cases/status`，其中 `schemaVersion=1`；顶层没有 `expectedRendererErrors` 汇总字段，但每个 `case.events` 都包含错误数组。当前 case C 为 `expectedErrors=2`、`expectedRendererErrors=1`，其他 case 两项均为 0；全部 case 的 `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`releaseFailures` 均为 0，`unexpectedWindowClosed=false`，并且 A–F 每个 case 均为 `ok=true`。历史两轮 artifact 明确记录 `expectedRendererErrors = 1`、`expectedErrors = 2`，均来自注入的 save reject 及其上报，不属于非预期产品错误。

本次同会话另有一轮 Wave 2 运行在 case I 启动时以 Windows 进程码 `3221226505` 终止，未生成完整矩阵；临时证据根为 `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-Kyw1Je`，该失败未被删除。随后在相同代码、正式 Zero dist、独立 Electron/userData 下重新运行并通过，详见下表。

场景覆盖：

- A：title → gallery → close；
- B：game → system-menu → settings → close；
- C：save reject → retry success；
- D：load success → title；
- E：无 override 时的固定六槽 defaults；
- F：正式 Dialogue 文字在 `text === accent` 同色主题下换色、恢复默认 `text=0xf2f6ff`（不误恢复成 `accent=0x5ac8ff`），并保持资源计数稳定。

### 7.2 Wave 2 A–I 回归

| Artifact 绝对路径 | 字节数 | SHA-256 | 结果 |
| --- | ---: | --- | --- |
| R4-current `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-8rnt6C\task7-player-experience-matrix.json` | 712416 | `BDCCB87EC1A9D8408E4894D0B4C5E1EFB9CCEE9F50AAEDEAE77E27DA26036ABB` | A–I 9/9 |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-uZQeK3\task7-player-experience-matrix.json` | 743880 | `F34E57580ACCB129B896FF71BE461748D0E776A90773CBB1B7D984A76DBDAE39` | A–I 9/9 |

Wave 2 R4 当前回归和历史成功回归均明确加载正式 Zero dist，9 个 case 使用独立 userData；当前成功 artifact 的可观测 page/console/request/unhandled/unexpectedWindowClosed 全部为 0，且 A–I 全部通过。该旧脚本未在 artifact schema 中单独输出 `releaseFailures` 和 expected Renderer error 数组；不能把缺失字段写成已观测的数值 0。R2/S1/S2 修复没有破坏 Wave 2 玩家路径。

## 8. 正式《零点之后》结果

最终验证保持既有正式游戏合同：

| 项目 | 结果 |
| --- | --- |
| 场景 | 11 |
| choice 分支 | 23/23 |
| 结局 | 3：`testimony_end`、`meeting_end`、`silence_end` |
| 资产 | 44，资产检查通过 |
| runtime errors | 0 |
| warnings | 0 |
| Zero lint | PASS |
| Zero simulate `--max-paths 500 --max-steps 20000` | PASS |
| Zero typecheck | PASS |
| Zero build | PASS |

没有修改《零点之后》的剧情、美术、音频或正式资源。

## 9. 测试与门禁

### 9.1 聚焦与全量

| 命令/范围 | 结果 |
| --- | --- |
| Renderer Theme/query 聚焦 | 2 files / 29 tests PASS（theme 27 + query-purity 2） |
| Host 聚焦 | 2 files / 42 tests PASS（player-shell-controller + player-ui-coordination） |
| Renderer lifecycle 聚焦 | `render-lifecycle.test.ts` 7/7 PASS |
| Starter HMR 聚焦 | `vite-scene-hmr.test.ts` 1/1 PASS；两次合法 HMR、一次非法 HMR、一次恢复合法 HMR，语义 listener 集合稳定 |
| Host R1/R2 聚焦（历史整改） | 2 files / 38 tests PASS（24 + 14） |
| Host 全量 | 8 files / 70 tests PASS |
| Host typecheck/build | PASS |
| Renderer R1/R2/R3 聚焦 | 5 files / 87 tests PASS（历史焦点集合） |
| Renderer 全量 | 48 files / 384 tests PASS |
| Renderer typecheck/build | PASS |
| `npm run verify:renderer-boundaries` | 3/3 PASS |
| `npm run verify:renderer-legacy` | 4/4 PASS |
| `npm run verify:tools` | 10/10 PASS |
| `npm run verify:hygiene` | PASS，605 tracked paths |
| Starter 全量测试 | 4 files / 7 tests PASS |
| Starter typecheck/build | PASS |
| Zero typecheck/build | PASS |
| `npm run verify:all` | exit code 0 |
| Shell generic E2E | PASS（仅作通用 Shell 回归，不冒充正式 Zero E2E） |
| Renderer v2 Electron E2E | PASS；17 个视觉状态均为 CANDIDATE/语义通过，未冒充人工批准金样 |
| Wave 3 Electron | R4 当前 A–F 6/6 PASS；历史两轮各 6/6 PASS |
| Wave 2 Electron | R4 当前 A–I 9/9 PASS；历史成功回归 9/9 PASS |
| `git diff --check` | PASS |
| `git ls-files '*.log'` | 空 |

R2 已将旧的 HMR 基线例外关闭；R4 在当前提交链上重新确认 Starter HMR 1/1 与根级 `verify:all` exit code 0。历史 `4 → 3` 失败和旧的 `verify:all` exit code 1 仅作为整改前证据保留，不是当前状态。

## 10. 代码与测试文件清单

### Host

- `packages/host/src/player-ui.ts`
- `packages/host/src/player-shell-controller.ts`
- `packages/host/test/player-ui-coordination.test.ts`
- `packages/host/test/player-shell-controller.test.ts`

### Renderer

- `packages/renderer/src/theme-projection.ts`
- `packages/renderer/src/api/renderer-queries.ts`
- `packages/renderer/src/pixi-stage-host.ts`
- `packages/renderer/src/layers/menu/menu-layer.ts`
- `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- `packages/renderer/src/layers/gallery/gallery-layer.ts`
- `packages/renderer/src/layers/system-panel/system-panel-layer.ts`
- `packages/renderer/src/loading-layer.ts`
- `packages/renderer/src/lifecycle/render-lifecycle.ts`
- `packages/renderer/src/runtime/renderer-facade.ts`
- `packages/renderer/src/runtime/create-renderer-runtime.ts`
- `packages/renderer/test/theme.test.ts`
- `packages/renderer/test/api/query-purity.test.ts`
- `packages/renderer/test/lifecycle/render-lifecycle.test.ts`

### Shell/正式接线

- `packages/shell/e2e/player-shell-wave-3.e2e.mjs`
- `examples/zero-after-midnight/src/main.ts`
- `examples/starter/src/main.ts`
- `examples/starter/src/surdet-window.d.ts`
- `examples/starter/test/vite-scene-hmr.test.ts`

### 文档

- `docs/ENGINE-PLAYER-SHELL-FOUNDATION-WAVE-3-DELIVERY-REPORT-2026-08-11.md`（修正原主题证据边界）
- `docs/ENGINE-PLAYER-SHELL-FOUNDATION-WAVE-3-FINAL-REMEDIATION-REPORT-2026-08-11.md`（本报告）

没有纳入构建产物、日志、截图、缓存或临时 worktree 文件。

## 11. Git、保护文件与性能延期

R3 文档提交后的机器状态为：

```text
HEAD: 72cfea6c8d14db80e40ce1662090c99b628de747
HEAD...surdet/main: 41 0
```

R4 的聚焦、全量、正式 Zero 和 Electron 门禁均已在上述 R3 提交之后执行并通过。最终报告归档提交和随后计划台账收口提交的真实 SHA、最终 HEAD、ahead/behind、status、diff-check 和 tracked-log 结果在提交后机器复核中记录；本报告不伪造提交后尚不存在的 SHA 或自引用文件摘要。

最终报告文件在归档提交后重新读取并计算字节数/SHA-256；由于文件不能无矛盾地嵌入其自身最终 SHA，本报告不伪造自引用摘要，真实摘要以最终机器复核为准。

工作树必须只保留以下四个受保护未跟踪文件：

```text
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
```

四个文件未修改、未暂存、未提交、未删除、未移动；不得在后续复审前处理它们。tracked log 必须为空。

性能仍维持既有结论：`PERFORMANCE_MEASUREMENT_NOT_QUALIFIED`。本轮没有修改性能阈值、artifact 或比较器，没有通过 UI 测试覆盖性能风险。

## 12. 独立复审入口

建议复审顺序：

1. 核对最终提交后的 HEAD、工作树、`HEAD...surdet/main`、`git diff --check` 和 tracked log。
2. 运行 Host R1/R2 聚焦测试，检查非法快照失败保持原状态，以及嵌套 Provider 的真实活动/可见状态。
3. 运行 Renderer `theme.test.ts` 和 `query-purity.test.ts`，直接读取已显示 Pixi DisplayObject 的颜色变化。
4. 检查 Wave 3 两份和 Wave 2 一份 artifact 的正式 Zero dist、独立 userData、schema、unexpected/expected 错误分类和资产状态。
5. 运行 `npm run verify:all` 与正式 Zero lint/simulate/assets/typecheck/build。

本轮完成后停止在 `WAITING_FOR_REVIEW`，等待总经理独立复审；未经新的明确授权，不执行 M9、性能工作、发行或 push。
