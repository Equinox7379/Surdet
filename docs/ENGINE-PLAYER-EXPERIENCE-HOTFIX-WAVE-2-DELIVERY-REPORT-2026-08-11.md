# Surdet Player Experience Hotfix Wave 2 交付报告

日期：2026-08-11
项目：Surdet / 《零点之后》
状态：限定整改完成，等待独立复审；未 push

## 1. 结论

本轮按权威任务书 Task 0 → Task 8 串行执行，完成了玩家 UI 会话状态、输入消费、覆盖层合成、Gallery 生命周期、菜单资源所有权、存读档事务、对话换行稳定性和真实 Electron 玩家验收矩阵。

当前结论为：

```text
PLAYER_EXPERIENCE_HOTFIX_WAVE_2_REMEDIATED
ENGINE_PLAYER_UI_COORDINATION_IMPLEMENTED
UX_06_REMEDIATED
SAVE_FAILURE_PROPAGATION_REMEDIATED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_REVIEW
```

本轮不是 M9，不是性能优化，不是性能资格化，不是正式发行，也没有重新采样 Q1–Q5、修改性能 artifact/门限、重新打包正式 EXE、修改剧情/DSL/存档格式、修改美术或音频内容。

R2 代码/测试最终 HEAD 为：

```text
9d01801e79d2939970d059a57cde827a729532b0
```

初始交付文档提交为：

```text
e713f2c（docs(engine): report player experience hotfix wave 2）
```

本报告所对应的最终运行时/测试代码 HEAD 为 `9d01801e79d2939970d059a57cde827a729532b0`；随后只允许提交报告与计划台账，不改变运行时代码。最终 Git HEAD 以文档提交后的复核输出为准，且不会 push。

## 2. 起始与范围

Wave 2 起始基线：

```text
4a162b9446bb10be3f720b98531d532db568dd6e
```

R2 代码提交后：

```text
HEAD = 9d01801e79d2939970d059a57cde827a729532b0
HEAD...surdet/main = 21 0
```

工作树在整个施工期间均保留且未触碰以下四个受保护未跟踪文件：

```text
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
```

它们没有被修改、暂存、提交、删除、移动或推送。

## 3. 真实资源释放错误证据与根因

Task 1 使用真实 Electron、正式《零点之后》dist 和独立临时 userData 复现，不是默认 Starter。第一轮真实失败证据：

```text
C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task1-r9XqQn\task1-failure-matrix.json
SHA-256: 4D401FBD52BDC5DC5EBE715F06400C284765A538F1E2C84023156E65C3E0E9F4
```

失败元数据原样记录为：

| 字段 | 实际值 |
| --- | --- |
| 顶层信息 | `Renderer resource release failed` |
| `code` | `COMMAND_COMMIT_FAILED` |
| `command` | `release` |
| `owner` | `menu` |
| `kind` | `pool` |
| `key` | `thumbnail:<data-url>`；Task 5 测试中的可复现键为 `thumbnail:data:image/png;base64,task5-real-thumbnail` |
| 原始 cause | `TypeError: Cannot read properties of undefined (reading 'destroy')` |
| 调用位置 | `RenderLifecycle.release` |

这不是被吞掉的警告。`RenderLifecycle` 在一个 disposer 抛错时仍保留 `RendererError`、失败条目的 owner/kind/key 和原始 cause；多个 disposer 失败时仍聚合报告。任务书要求的失败记录没有被降级或隐藏。

根因链：

1. 菜单的 thumbnail 进入 `menu/pool` 资源所有权路径；重复 hide/reset/release、空槽点击和 save/load/title 交替会把同一资源生命周期推入重复释放边界。
2. Pixi v8 在无有效 DOM Image 的测试/诊断环境中，对 data URL 直接 `Texture.from(string)` 可能得到不可销毁的未定义底层对象；原 disposer 仍尝试读取 `.destroy`，于是暴露出上述 TypeError。
3. 旧的多个宿主布尔状态在 overlay、异步存读档和返回标题期间可能半提交，导致菜单资源释放与 UI 状态不一致。

为什么表现为特定入口/同会话顺序：初始渲染本身不是必现错误，触发条件是菜单资源已经经历过重复的 overlay 生命周期；title/game 的 Gallery 返回上下文不同，save/load/title 与空槽路径又会重复进入/退出菜单资源边界，因此同一会话里的组合路径更容易命中问题。Task 1 的第二份正式失败矩阵也保留了该差异：

```text
C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task1-QGP8WB\task1-failure-matrix.json
SHA-256: A8B0124C776D89E011A4E9060624DDAFA951A32A40ED509CD78A42377B9B7662
```

它确认正式游戏与独立 userData，但没有新的资源元数据；前置 UX 红灯造成的链式失败也没有被伪报为通过。

修复后的所有最终玩家矩阵均为 `releaseFailureEvidence=[]`，没有 page error、console error、request failure 或 unhandled rejection。

## 4. 修复后的生命周期与事务协议

### 4.1 资源所有权

- `MenuLayer` 为真实 data URL thumbnail 建立可销毁的 Image-backed texture；非 DOM 环境使用共享 `Texture.WHITE` 回退，不注册错误的独立 disposer。
- thumbnail cache 只由 cache owner 负责销毁；hide 保留可复用资源，reset/dispose 释放资源。
- `RenderLifecycle` 采用先移除 registry entry、再调用 disposer 的顺序；重复 release、releaseOwner、reset、dispose 幂等。
- 失败时保持 `RendererError` 与原始 cause，不 catch/ignore，不把 error 改成 warning，不用延时或反复 hide/show 遮盖失败。

### 4.2 存读档事务

Host save/load 采用 begin → commit / fail → restore / finally：

- 空槽和不存在槽位是 no-op，不调用 load，不关闭读档页，不改变剧情位置；
- 成功存读档才提交目标 UI 状态；
- 失败恢复操作前的 UI session、overlay、command rail 和解释器语义；
- load/title/new 之间明确区分 title/game 返回上下文；
- command rail 只按当前 UI session 状态恢复，不由 Renderer 无条件猜测。

### 4.3 玩家 UI 状态机

`packages/host/src/player-ui.ts` 提供的公共 `PlayerUiSession` 成为宿主协调的唯一状态来源，正式游戏、Starter 和 CLI 模板共享同一 typed contract，覆盖：

- base：`title` / `game`；
- overlay：`none`、`system-menu`、`save-load`、`settings`、`gallery`、`backlog`；
- operation：`idle`、`saving`、`loading`、`returning-title`；
- `interfaceHidden`、`videoActive`；
- overlay 互斥、title/game gallery 返回上下文、非法 transition 拒绝、成功提交和失败回滚。

查询只读同一个冻结快照，不调用 Renderer 或执行可见副作用。

### 4.4 输入消费协议

`PlayerInputGate` 统一 canvas pointerdown 决策：

- UI 命中在同一同步事件中先消费当前 pointer，再允许宿主回调；
- overlay、backlog、settings、gallery、save/load、system menu 和命令栏不会把点击泄漏到底层剧情；
- 正常无阻塞游戏面仍可推进；
- 隐藏界面的第一次左键只恢复界面，下一次正常游戏面输入才推进；
- rollback 成功和 no-op 都消费当前操作；右键、非主键和阻塞状态不推进；
- 没有定时器、debounce 或固定延时伪修复。

## 5. UX-01～UX-10 逐项验收

| 编号 | 原始复现与根因 | 修复文件/措施 | 专项与最终真实玩家结果 | 结论 |
| --- | --- | --- | --- | --- |
| UX-01 | title → gallery → music → text 切换可能超时；Gallery tab/header/listener 在 tab 重建时被销毁，title/game 上下文差异使问题更明显。 | `packages/renderer/src/layers/gallery/gallery-layer.ts`：稳定保留 header/tab/blocker，只重建内容并清理 listener；dispose 才销毁完整树。 | Gallery layer `12/12`；Task 4 title/game gallery 对照 `5/5`、`3/3`；Task 7 A title gallery/CG/music/text/close `5/5`，B 游戏内 gallery 通过。 | 通过 |
| UX-02 | 连续对话换行时，空文本中间态可能让面板 `true → false → true` 闪烁。 | `DialogueLayer.beginText/clearText` 与 `#lineActive`；`PresentationController` 每行先 begin，只有显式清空才 clear。 | 原始 renderer 红灯：Dialogue `14 tests / 2 failed`、Controller `10 / 1 failed`；修复后聚焦 `24/24`；Task 7 I 连续 10 句逐帧采样通过。 | 通过 |
| UX-03 | 空读档槽点击关闭页面并触发 menu thumbnail release；真实元数据见第 3 节。 | `MenuLayer` 建立静态、可命中的消费面，不注册 selectable handler；Host 空槽 no-op，保留页面和命令栏；thumbnail owner 幂等释放。 | Task 5 红灯：menu `19/18 passed/1 failed`；修复后 menu `21/21`；Task 7 E 空槽真实鼠标点击 `5` 次，overlay 保持，无资源错误。 | 通过 |
| UX-04 | 有效读档后返回标题可能进入半损坏 menu/resource 状态。 | PlayerUiSession title/game context；save/load/title 事务恢复；overlay 退出与资源释放顺序收敛。 | Task 1 单轮已保留通过对照；Task 7 G `load → title ×3 → new/load`、H 有效读档对照通过，标题仍可操作。 | 通过 |
| UX-05 | canvas 全局 pointerdown 只检查 title，system/backlog/save-load/settings/gallery 等点击可泄漏到底层推进。 | `player-input-gate.ts`、宿主同步 consumed 回调、各 UI blocker/回调在同一事件中消费。 | Task 3 `PlayerInputGate 7/7`；Task 7 B overlay clicks 不改变 position，A/B/E/C/D 各项 UI 点击均无泄漏。 | 通过 |
| UX-06 | `bringTextDisplaysToFront()` 把正文追加到共享 UI root 末尾，可能压在菜单/记录之上。 | `DialogueLayer` 自有 `#dialogueRoot`；正文只在自身 root 内排序；固定合成顺序 World < Dialogue < overlays < Loading/Fatal。 | z-order 红灯先复现后转绿；Task 4 聚焦 `27/27`；Renderer v2 backlog/settings/save-load/gallery 语义验收通过。 | 通过 |
| UX-07 | rollback 点击可能被忽略后变成推进，或无历史时操作泄漏。 | pointer 消费 + RollbackRuntime 明确 `canRollback/perform`，overlay/blocking 时拒绝；测试观测可用回退、耗尽历史和稳定 no-op。 | Task 7 C `rollback available/unavailable ×5` 通过；可用回退只改变到历史位置，耗尽后连续 no-op，不推进。 | 通过 |
| UX-08 | H/界面隐藏后左键可能继续推进，无法恢复。 | `PlayerInputGate` 与 PlayerUiSession 统一 `interfaceHidden`；隐藏态首个左键只恢复。 | Task 7 D H 与“界面”各 `3` 次，恢复点击不推进，下一次正常输入才推进。 | 通过 |
| UX-09 | 同会话 save/load 顺序容易重复释放 menu 资源并留下半状态。 | save/load begin/commit/fail/restore；Menu/RenderLifecycle 资源释放幂等；成功后才关闭/恢复目标 UI。 | Task 1/5 相关红灯先保留；Task 7 F 在同一会话中 save→load 与 load→save 各 `3` 轮，slot、position、rail、错误监控均通过。 | 通过 |
| UX-10 | 错误后剧情仍能推进但 command rail 消失，回标题再报错。 | 单一 UI session、失败原子恢复、title/game 返回上下文、command rail 从当前快照投影；Renderer 不再无条件恢复 rail。 | Task 7 G/H 覆盖 load/title/new 与三条正常对照；所有最终矩阵 rail 状态符合 session，资源/页面错误均为零。 | 通过 |

## 6. 测试、门禁与正式游戏结果

### 6.1 Workspace 测试

| 命令 | 结果 |
| --- | --- |
| `npm run test -w @surdet/core` | 23 files / 304 tests passed |
| `npm run test -w @surdet/renderer` | 47 files / 351 tests passed |
| `npm run test -w @surdet/host` | 5 files / 28 tests passed |
| `npm run test -w @surdet/shell` | 15 files / 122 tests passed |
| `npm run test -w surdet-starter` | 4 files / 7 tests passed |
| `npm run test -w zero-after-midnight` | 2 files / 21 tests passed；同时 assets 44、11 scenes、3 endings |
| `npm test -w surdet-editor` | 21 files / 142 tests passed |
| `npm test -w @surdet/cli` | 7 files / 86 tests passed |

五个 workspace 的 typecheck 全部退出码 `0`；五个 workspace 的 build 全部退出码 `0`。正式游戏 Vite 构建只产生既有大 chunk advisory，没有 lint warning，也没有构建失败。

### 6.2 工具与正式游戏门禁

- `npm run verify:renderer-boundaries`：`3/3` 通过；
- `npm run verify:renderer-legacy`：`4/4` 通过；
- `npm run verify:tools`：`10/10` 通过；
- `npm run verify:hygiene`：tracked `587` paths 通过；
- `npm run lint -w zero-after-midnight`：`11` scenes、`0 errors`、`0 warnings`；
- `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000`：`23/23` choice branches、`3` endings、`39` save/load smoke、`0` runtime errors；
- `node examples/zero-after-midnight/scripts/check-assets.mjs`：`assets ok: 44`；
- `npm run verify:all`：退出码 `0`；tools/docs/hygiene/types/tests/formal/editor/starter build 链均通过；
- `git diff --check`：通过；
- `git ls-files '*.log'`：空。

### 6.3 Electron 验收

1. `npm run e2e -w @surdet/shell`：通过 Shell E2E；引导、画布、存读档和剧情推进完成，无失败请求，Starter 对照路径没有替代正式游戏验收。
2. `npm run e2e:renderer-v2 -w @surdet/shell`：通过，17 个视觉候选状态均有语义断言和截图；状态仍标记为 `CANDIDATE`，不把候选图冒充永久视觉金样；无 page/console/request error。
3. Task 7 要求的两轮完整正式玩家矩阵：每轮 9 个独立 Electron/userData，显式加载 `E:\surdet\examples\zero-after-midnight\dist`，A–I `9/9` 通过：

   - 第一轮：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-jy037r\task7-player-experience-matrix.json`；SHA-256 `77A676492DC8299BDF0DB32BB534DF2FACBA570E258237212464581F1003808D`。
   - 第二轮：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-Qbo9QI\task7-player-experience-matrix.json`；SHA-256 `262F75BB15C180C52428276A9123E6697AF05D981AD46F058D8B9F4A07FED473`。

4. Task 8 按计划额外复跑一次完整玩家矩阵，同样为正式游戏、9 个独立 userData、A–I `9/9`：

   - `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-KkP9lN\task7-player-experience-matrix.json`；SHA-256 `8CAC0F83539CE02366776B7D7B8B0D5B06C08E4E92E2E141122376B611CC69E6`。

三轮最终 JSON 的 `schemaVersion=2`、`status=PASSED`，正式游戏字段为 `title=《零点之后》`、`distRoot=E:\surdet\examples\zero-after-midnight\dist`；每轮 `pageErrors=[]`、`consoleErrors=[]`、`requestFailures=[]`、`unhandledRejections=[]`、`releaseFailureEvidence=[]`，asset loading 为 `total=48/completed=48/failed=0/done=true`。`check-assets` 的正式项目资产计数为 `44`，二者口径不同且均通过。

## 7. 测试先行与保留的失败证据

没有删除失败证据，也没有重跑到通过后只报告绿色结果。除第 3 节 Task 1 证据外，Task 7 测试夹具修正过程保留了以下原始 JSON：

| 阶段 | 失败原因 | JSON SHA-256 |
| --- | --- | --- |
| `task7-mBjqsN` | B 错用 Space 测 gallery；C/D 谓词引用 Node 闭包 | `971DC7268D978314FA100F6579C2694B0DC3B7AD40845B73056549FC83222BE4` |
| `task7-PE2n82` | 修正 B/谓词后，C/D 暴露单次真实输入可能仍在打字机/等待阶段 | `10CDF4B38E025087FAC93CA6A6D39A823DF85F74020E361FA4BC652F57BB0E26` |
| `task7-5apRBB` | C 第二次“无历史”假设错误，历史缓冲仍有合法回退 | `32A5C77FE62D61ECFF25C11595CE8B92007C980F4F05DD82273D45858A7BFDE0` |
| `task7-PMIc0K` | 单次 no-op 不能证明缓冲已耗尽 | `B55B1F0755727282952F07A85999DAA99B2933AAFE66FCCB84F15E37CB39F46B` |
| `task7-TO0dx6` | 回退恢复后的重复检查点在稳定护栏下再次暴露 | `0F735BD521422F06F0D1094EECD9910A307AC0737DE7E42E19E76B7600BAE2FE` |

最终测试只改了 E2E 观测夹具：真实输入最多继续到位置变化；回退只有连续两次稳定 no-op 后才判定历史耗尽，再额外验证 no-op。没有修改生产逻辑来掩盖测试失败。

## 7.5 独立复审后的最终限定整改（R1/R2/R3）

总经理复审要求只处理三个阻断项：公共 Player UI 协调层、真实 Dialogue Backlog 合成顺序，以及异步存档错误传播/命令栏事务边界。本节是对前述 Task 记录的补充，不覆盖原始失败证据。

### R3：公共 Player UI 协调层

- `packages/host/src/player-ui.ts` 公开 `PlayerUiSession`、`PlayerInputGate` 和纯 selectors；正式游戏、Starter、CLI 模板不再各自维护互相漂移的 UI 状态副本。
- `562a764021b03c98cf3fdc315e4933f68de9cf0c`：`refactor(host): share player UI coordination`。
- Host focused `8/8`；Starter `4 files / 7 tests`；Zero `2 files / 21 tests`；typed contract/build/typecheck 通过。

### R1：真实 Dialogue Backlog 合成顺序

- 复审前真实 Backlog 红灯是 `DialogueLayer` 自身层级问题：正文重排会把正文追加到与 Backlog 相同的 root，导致 Backlog 不能稳定位于正文之上。修复为 Dialogue content root 与 Dialogue overlay root 两层；Backlog 只进入 overlay root，正文排序不越界。
- `backlogAboveDialogueText` 只作为普通数据快照返回，不暴露 Pixi 对象。
- `c5cb38d354395328056afb387b45e1decfed6d88`：`fix(renderer): preserve real backlog overlay order`。
- R1 真实 Dialogue 测试先红后绿；本次最终 Renderer 全量包含该回归且 `47 files / 351 tests` 通过。

### R2：异步存档错误传播与命令栏事务边界

#### 修复前红灯与根因

1. Renderer `menu-layer.test.ts` 在 host transaction 尚未有正式契约时：`22 tests | 21 passed | 1 failed`；异步 handler 返回后页面已提前隐藏，无法证明 pending 期间可继续操作。
2. Shell `save-store.test.ts`：`19 tests | 17 passed | 2 failed`；损坏 JSON 与损坏主存档被静默转为 `null`/回退 `.bak`。
3. Host adapter 测试先于生产模块执行：`Cannot find module '../src/electron-save-storage.js'`。
4. 生产修复后旧版 Starter 真实 Electron E2E 首次复测仍发现：`stateReset` 在 `quickLoad` 的 `loading` 事务中调用 `uiSession.reset()`，随后完成分支失败，catch 又调用 `failOperation()`，原始错误被 `PLAYER_UI_INVALID_TRANSITION: fail-operation requires a busy operation` 遮蔽。该失败命令、堆栈和输出均保留在本次执行记录中。

#### 最小修复

- 新增 `packages/host/src/electron-save-storage.ts`，Electron bridge 的读取、写入、删除、列表和元数据操作直接向上传播拒绝；只有明确的 missing-file 仍返回 `null`。
- `packages/shell/src/save-store.ts` 不再吞掉损坏 JSON、非法顶层结构、索引读写失败或删除失败；损坏主存档不再静默回退 `.bak`。
- `MenuLayer` 增加显式 `host-transaction` 契约：pending 保持 save-load 页面，重复关闭/背景点击只消费当前事件；Promise 成功才 hide，返回 `false` 或 reject 保持页面，未提供错误边界时 reject 在 microtask 重新抛出。
- `RendererFacade`、PixiStage host 和 legacy adapter 传递 typed options；正式 Host 明确使用 host transaction，并在 `onTransactionComplete` 中恢复命令栏。旧同步调用路径继续保持兼容。
- Starter/Zero 的异步存读档使用真实 Electron storage 与 begin/commit/fail/restore 事务。Starter 的 `stateReset` 只有在 UI session 空闲时才执行完整 reset；busy save/load 期间保留事务，让 quickLoad 成功完成或失败恢复能够各自执行一次。

#### R2 验证结果

- R2 提交：`9d01801e79d2939970d059a57cde827a729532b0`，message `fix(player): complete wave 2 remediation`。
- Renderer `47 files / 351 tests`、Host `5 files / 28 tests`、Shell `15 files / 122 tests`、Starter `4 files / 7 tests`、Zero `2 files / 21 tests`、Editor `21 files / 142 tests`、CLI `7 files / 86 tests` 全部通过。
- Renderer/Host/Shell/Starter/Zero typecheck 与 build 通过；`verify:renderer-boundaries` `3/3`、`verify:renderer-legacy` `4/4`、`npm run verify:all` 退出码 `0`；`git diff --check` 通过。
- `npm run e2e -w @surdet/shell` 修复后通过：Starter 快速存档和快速读档均成功，读档后剧情可继续推进，未再出现状态机二次错误。

#### R2 后两轮正式玩家验收

两轮均由独立 Electron 启动、独立临时 `userData`，显式加载 `E:\surdet\examples\zero-after-midnight\dist`，不是默认 Starter；每轮 A–I `9/9`，schema `2`、`status=PASSED`，页面错误、控制台错误、失败请求、未处理 rejection 和 `releaseFailureEvidence` 均为 `0`。

- 第一轮：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-DtjHPd\task7-player-experience-matrix.json`；SHA-256 `28FFBB1A3FF2EAA5671DE79BD90E03DF80248ECDCD1EDE2176513BA2B737598C`。
- 第二轮：`C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-2-task7-zSiTX2\task7-player-experience-matrix.json`；SHA-256 `38FE8420F2B2B6CAF5CBD0A49B4BE24520D49A27BE9950383875913D880372B2`。
- 两轮均覆盖标题/游戏 Gallery、空槽、save/load 两种顺序、load/title/new、Backlog、rollback、隐藏界面和三条已确认正常对照路径；正式游戏仍为 `23/23` 分支、`3` 结局、`44` 项项目资产、`0` 运行时错误。
- `npm run e2e:renderer-v2 -w @surdet/shell` 通过；17 个视觉状态仍标记为 `CANDIDATE`，没有将截图升级为永久视觉金样。

## 8. 实际提交与文件范围

从 Wave 2 起始 HEAD 到本报告生成前，已提交的实际提交如下：

| 阶段 | SHA | message |
| --- | --- | --- |
| Task 0 implementation | `fe43fc7453b3bc1566dca21a116591d54353af74` | `docs(engine): freeze player experience hotfix wave 2` |
| Task 0 ledger | `829fbb4abf97e0ffae6aa0acbb2790066d2a6d6f` | `docs(engine): record task 0 baseline ledger` |
| Task 1 implementation | `b342b06a62f7b02b09eb3f3e52d95ca864de3e69` | `test(engine): reproduce player experience wave 2 failures` |
| Task 1 ledger | `9e4bc1f5c4cacb8652f90dbbc652e8cd89ae7e4f` | `docs(engine): record task 1 failure evidence` |
| Task 2 implementation | `f5e3c9231f6a7965254d886828d420be5cd8163c` | `refactor(zero-after-midnight): centralize player ui session state` |
| Task 2 ledger | `53d579995781d824c990ab712afb44997f21d8a9` | `docs(engine): record task 2 ui session state` |
| Task 3 implementation | `a4f67b36cb3071f8d98a92de24a6b8c874afde04` | `fix(engine): consume player ui input before dialogue advance` |
| Task 3 ledger | `c54740a4cd893cec9623362dd34ff2b08b128333` | `docs(engine): record task 3 input gate` |
| Task 4 implementation | `5e52d44da7f3d8409a8ed187f235a0c3ee9af73d` | `fix(renderer): preserve overlay input and composition order` |
| Task 4 ledger | `53a15f213bac21bd4f308974237d5193435e4f1a` | `docs(engine): record task 4 overlay ordering` |
| Task 5 implementation | `93d0a1d13faddb22f038c9d85eece27915742f64` | `fix(renderer): make player resource transitions idempotent` |
| Task 5 ledger | `8eacc4208a5db8015c531a096ee2138c2f43fae4` | `docs(engine): record task 5 resource transitions` |
| Task 6 implementation | `77b3bc5f22e62d5ec05808e7d7dac45d49caf607` | `fix(renderer): keep dialogue presentation stable between lines` |
| Task 6 ledger | `07496c38550c1fc2372e88b12cf8f823f4c69aa2` | `docs(engine): record task 6 dialogue stability` |
| Task 7 implementation | `22ae65837b030282f939123a0fb7f5ca7224944c` | `test(shell): gate player experience hotfix wave 2` |
| Task 7 ledger | `f2d261013595ef17cbb1cbaf20eafdcf4645982c` | `docs(engine): record task 7 player matrix` |
| R3 implementation | `562a764021b03c98cf3fdc315e4933f68de9cf0c` | `refactor(host): share player UI coordination` |
| R1 implementation | `c5cb38d354395328056afb387b45e1decfed6d88` | `fix(renderer): preserve real backlog overlay order` |
| R2 implementation | `9d01801e79d2939970d059a57cde827a729532b0` | `fix(player): complete wave 2 remediation` |

从 Wave 2 起始基线核对，R2 代码提交后的完整 name-status 已核对；实际改动只涉及本 Wave 2 的计划台账、正式游戏 UI/输入、Renderer 相关生命周期/Layer/测试、Host/Shell 接线/测试和玩家 E2E；没有构建产物、截图、日志、缓存或性能 artifact 进入提交。R2 本地提交实际新增/修改 20 个文件，详见 `9d01801e79d2939970d059a57cde827a729532b0`。

实际文件清单：

- 计划/报告：`docs/superpowers/plans/2026-08-11-player-experience-hotfix-wave-2.md`、本报告；
- 正式游戏：`examples/zero-after-midnight/package.json`、`src/main.ts`、`src/player-input-gate.ts`、`src/player-ui-session.ts`、`test/player-input-gate.test.ts`、`test/player-ui-session.test.ts`；
- Renderer：`src/api/renderer-commands.ts`、`src/api/renderer-runtime.ts`、`src/layers/dialogue/dialogue-layer.ts`、`src/layers/gallery/gallery-layer.ts`、`src/layers/menu/menu-layer.ts`、`src/legacy/legacy-stage-adapter.ts`、`src/lifecycle/render-lifecycle.ts`、`src/pixi-stage-host.ts`、`src/runtime/create-renderer-runtime.ts`、`src/runtime/presentation-controller.ts`、`src/runtime/presentation-ports.ts`、`src/runtime/renderer-facade.ts`，以及对应 `resource-cycles`、Gallery、Dialogue、Menu、PresentationController、RenderLifecycle 测试；
- Shell：`e2e/player-experience-wave-2.e2e.mjs`、`package.json`、`src/main-entry-policy.ts`、`src/main.ts`、`test/main-entry-policy.test.mjs`。
- R2 追加/修改：`examples/starter/src/main.ts`、`examples/zero-after-midnight/src/main.ts`、`packages/host/src/electron-save-storage.ts`、`packages/host/src/index.ts`、`packages/host/test/electron-save-storage.test.ts`、`packages/renderer/src/api/renderer-commands.ts`、`packages/renderer/src/api/renderer-queries.ts`、`packages/renderer/src/layers/dialogue/dialogue-layer.ts`、`packages/renderer/src/layers/menu/menu-layer.ts`、`packages/renderer/src/legacy/legacy-stage-adapter.ts`、`packages/renderer/src/pixi-stage-host.ts`、`packages/renderer/src/runtime/presentation-ports.ts`、`packages/renderer/src/runtime/renderer-facade.ts`、对应 Renderer query/runtime/dialogue/menu 测试、`packages/shell/src/save-store.ts`、`packages/shell/test/save-store.test.ts` 和 `packages/shell/e2e/player-experience-wave-2.e2e.mjs`。

## 9. 性能、发布与保护边界

- 性能状态仍为 `PERFORMANCE_MEASUREMENT_NOT_QUALIFIED`；本轮没有修改性能 artifact、门限、比较器、资格化协议，也没有重新运行旧正式 A/B。
- 未开始 M9；未进行正式发行；未重新打包正式 EXE；未 push；未 force push；未 rebase、reset 或改写历史。
- 视觉 E2E 截图和 manifest 仍是候选/语义验收证据，不是永久视觉金样。
- 四个受保护未跟踪文件未触碰；`git ls-files '*.log'` 为空。

## 10. 最终交付后检查（报告提交后执行）

以下项目已在 R2 代码提交 `9d01801e79d2939970d059a57cde827a729532b0` 后执行并通过；随后只做文档事实回填，文档提交后还会再次复核：

- `npm run verify:all`：退出码 `0`；
- `git diff --check`：通过；
- `git status --short`：仍只有四个受保护未跟踪文件；
- `git rev-list --left-right --count HEAD...surdet/main`：保持领先、未 push；
- `git ls-files '*.log'`：空。

最终停止点：等待总经理独立复审，不自行 push。
