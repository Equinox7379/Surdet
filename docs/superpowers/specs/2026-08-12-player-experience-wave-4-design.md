# Surdet Player Experience Wave 4 公共契约整改设计

> 状态：设计已获用户批准采用“B：公共契约整改”路线；本文用于总经理最终需求确认，尚未授权实施、push、发行或重新打包。
>
> 基线：`70f4a4f9cc42e17651b13434977bc34d88f14ec1`（与 `surdet/main` 同步）。
>
> 实机环境：Windows，1920×1080 显示器，开发态 Electron 显式加载 `E:\surdet\examples\zero-after-midnight\dist`。

## 1. 背景与实机证据

Wave 1–3 已解决资源释放失败、空读档槽报错、菜单点击穿透推进、对话框闪烁、H 隐藏恢复、Player Shell 会话协调、主题投影和 HMR 生命周期等问题。Wave 3 推送后，用户在真实游戏窗口中完成首轮实机复测，确认仍存在以下六项需要施工的问题：

1. 从标题页进入鉴赏后，“关闭”恢复正常，但“音乐”和“文本”标签点击无反应；游戏内进入同一鉴赏页面则完全正常。
2. 对话框不再闪烁，但右下角命令栏仍会整体轻微变亮、变暗。
3. Backlog 的“Ctrl+F 搜索”和“文字记录……”标题固定在屏幕上，滚动正文会与二者重叠；搜索提示压住正文，正文又压住标题。
4. 回退只能执行一次；必须再推进两条对话，才能再次回退。
5. 存档后立即读档时，背景和立绘消失，只剩对话框、文字和命令栏；进入下一场景后世界画面才重新出现。
6. 新游戏未读档时返回标题，标题页面残留离开游戏时的背景和立绘。

用户另报告普通“最大化窗口”在 1920×1080 显示器上左右留黑，但 F11 真全屏后黑边完全消失、画面完整。该现象由带标题栏/任务栏的 Electron 内容区并非严格 16:9、Renderer 采用等比 contain 策略导致，不是背景资产或全屏 Renderer 缺陷。

## 2. 设计目标

本 Wave 的目标是把六项实机缺陷修成可复用的公共能力，而不是给《零点之后》堆叠局部补丁：

- 标题来源和游戏来源的 Gallery 都具备一致、可靠的真实鼠标交互。
- 命令栏整体视觉稳定，推进对话不会造成整条菜单明暗变化。
- Backlog 具备固定标题区和严格裁剪的独立正文滚动区。
- 回退支持连续多步向历史方向移动，不要求在两次回退之间重新推进。
- Interpreter 存档自动纳入 Renderer Presentation，并在读档时原子恢复背景、立绘和演出状态。
- 进入标题会话时彻底清理上一游戏会话的 World/Presentation，不泄露旧背景或立绘。
- Starter、《零点之后》和 CLI 新项目模板采用同一公共接线，遗漏时由测试或契约检查暴露。
- 所有修复保留 Wave 1–3 已通过的资源生命周期、输入门控、错误传播和存读档事务能力。

## 3. 非目标与禁止范围

本 Wave 不包含：

- M9 或新的 Renderer 架构阶段；
- 性能测量资格化、性能优化、阈值或 artifact 修改；
- 音频资产重建、ducking 或循环点；
- 美术资产替换、头像接线或画质压缩；
- `gallery.json` 的内容本地化和 Starter 死配置清理；
- 文档归档治理；
- 正式发行、正式 EXE 打包或 electron-builder；
- Player Shell 全面重写；
- 画布横向拉伸、非等比缩放或点击坐标补丁；
- 为普通最大化窗口强行进入全屏；
- 删除已有搜索能力；本轮只删除 Backlog 常驻的“Ctrl+F 搜索”提示；
- 未经新证据的顺手重构。

## 4. 总体架构决策

### 4.1 公共能力优先

修复责任按照以下顺序归属：

1. Renderer：Gallery 命中、命令栏视觉、Backlog 布局和 Presentation 查询/恢复。
2. Host：Interpreter、Renderer、Player Shell 之间的组合根契约；连续回退公共运行时；标题会话边界。
3. Starter 与 CLI 模板：采用 Host 公共组合能力，作为新项目参考实现。
4. 《零点之后》：删除或替换重复接线，仅保留游戏配置、剧情、资源和回调。

不允许为了减少改动而把通用算法继续留在 `examples/zero-after-midnight/src/main.ts`。

### 4.2 一版兼容窗口

若共享 `examples/shared/rollback-runtime.ts` 迁移至 `@surdet/host`，旧文件在本 Wave 保留为薄 re-export 或带弃用说明的兼容入口；Starter 与《零点之后》立即改用公共 Host API。下一 Wave 才能评估移除旧入口，避免无关消费者突然断裂。

### 4.3 测试先行

每项修复必须先在基线代码上获得与用户描述一致的红灯。若自动化无法复现，不得直接猜测并修改生产代码；应先补足真实交互探针或记录最小诊断证据。

## 5. G1：标题来源 Gallery 真实交互一致性

### 5.1 已知事实

- Gallery 的“关闭”在标题来源已恢复。
- “音乐”“文本”在标题来源真实鼠标点击无反应。
- 游戏来源同一标签真实点击正常。
- `GalleryLayer` 已声明稳定 header/hitArea，但现有门禁未捕获本次真实玩家路径。

因此设计不得预设唯一根因是 hitArea、层级、事件消费或 Player Shell source；实施时必须用红灯证据确定真实断点。

### 5.2 目标契约

对 `source=title` 与 `source=game`：

- 点击 CG、音乐、文本标签均切换 `GalleryOverlayState.tab`；
- 标签切换只发生一次，不推进剧情、不关闭 Gallery；
- 关闭只发生一次，并恢复正确的来源页面；
- 锁定条目不会阻止标签本身切换；
- 重建 Gallery 内容后，header 的真实命中区域仍有效；
- 隐藏的 Title/System Menu 不得继续接收点击；
- PointerInputGate 必须消费本次 UI 点击，不能穿透到游戏推进。

### 5.3 验证层次

1. `GalleryLayer` 单元测试：真实 Pixi pointer event 切换三标签，覆盖内容重建前后。
2. Host/Renderer 集成测试：分别用 `source=title`、`source=game` 打开、切换、关闭。
3. Electron 玩家测试：使用 Playwright 真实鼠标坐标点击可见文字区域；禁止调用 `titleSelect()`、Gallery command 或 debug callback 代替玩家点击。
4. 自动化必须断言可见投影状态变化，而不只断言“没有抛错”。

## 6. G2：命令栏稳定视觉

### 6.1 用户批准的视觉规则

- 整条命令栏保持固定透明度和固定基础颜色。
- 不再存在 2.8 秒唤醒后从约 `0.94` 衰减至约 `0.38` 的整体动画。
- 推进文本、刷新按钮可用状态、捕获回退检查点都不能改变整条命令栏 alpha。
- 鼠标悬停时只允许当前按钮产生局部高亮。
- 自动、快进等 active 状态继续使用固定强调色。
- disabled 状态继续使用固定弱化色。
- 打开菜单时命令栏仍按 Player Shell 规则隐藏；关闭后以同一固定透明度恢复。

### 6.2 实现边界

Renderer 应删除或停用命令栏整体 wake/fade tween 的生产路径与生命周期登记。不能通过每帧把 alpha 强行写回制造额外更新；稳定状态应当不再请求动画帧。

局部 hover 可以保留 label、下划线或按钮色反馈，但 `pointerout` 必须恢复由 active/disabled 状态决定的确定性样式。

### 6.3 验收

- 无输入等待 5 秒，命令栏根 alpha 不变。
- 连续推进 20 条文本，根 alpha 不变。
- 悬停一个按钮，只该按钮样式变化，根 alpha 不变。
- 移出后恢复；active/disabled 语义不丢失。
- Renderer `needsUpdate()` 不因已删除的命令栏淡出长期保持 true。

## 7. G3：Backlog 固定标题与裁剪滚动区

### 7.1 用户批准的布局

- 删除未输入搜索词时常驻显示的“Ctrl+F 搜索”。
- 保留固定标题：“文字记录（滚轮/PageUp/PageDown 滚动 · 点击任意处关闭）”。
- 标题位于固定 header 区，不随滚轮移动。
- 正文从 header 下方开始，使用独立滚动容器。
- 正文容器必须应用 Pixi mask/裁剪矩形；正文滚到上边界或下边界以外时不可见。
- 正文永远不能覆盖标题。

### 7.2 搜索行为

已有 Ctrl+F 搜索能力可保留。只有用户实际按下 Ctrl+F、输入查询时，才允许出现临时搜索状态或“搜索：关键词”。关闭或清空查询后不恢复常驻“Ctrl+F 搜索”提示。

如果当前搜索输入通过 DOM 完成，其 DOM 元素也必须位于明确的 header/search 区，关闭 Backlog 时销毁或隐藏，不得残留到游戏画面。

### 7.3 滚动模型

- 滚动 viewport 的 top、bottom、height 使用明确常量或布局值，不从正文第一行的魔法坐标反推。
- `maxScroll = max(0, contentHeight - viewportHeight)`。
- 空记录、短记录、长记录、中文换行、emoji 和扩展汉字均不能越界。
- 滚轮、PageUp、PageDown 共享同一 clamped scroll 命令。
- 重开 Backlog 时滚动位置按现有产品规则重置为顶部；本 Wave 不新增持久化滚动位置。

### 7.4 验收

- 至少 120 条多行记录压力场景中，正文不能与标题发生像素/边界重叠。
- 标题位置在滚动前后完全不变。
- 正文容器的可见区域严格位于 header 下方。
- 点击关闭仍被消费，不推进背后剧情。
- Backlog 始终位于正常 Dialogue 正文之上。

## 8. G4：连续多步回退公共运行时

### 8.1 归属调整

当前 `examples/shared/rollback-runtime.ts` 同时依赖 Core Interpreter 和 Renderer Presentation/Audio，实质上属于 Host 组合层。本 Wave 应把权威实现迁移到 `@surdet/host`，由 Host 公开稳定接口；示例共享文件仅作为一版兼容入口。

### 8.2 状态语义

回退历史应表示“按玩家看到文本状态排列的可恢复帧”。连续回退不应依赖在每次恢复后重新生成两个检查点。

必须明确区分：

- 当前可见帧；
- 先前历史帧；
- 回退恢复期间由 `loadSnapshot()` 触发的 `text` 事件；
- 玩家回退后重新前进产生的新分支历史。

恢复期间产生的事件不能重复压入当前帧，也不能清空剩余历史。第一次回退后，若历史仍有帧，`canRollback()` 应立即保持 true。

### 8.3 连续回退契约

- 推进 N 条文本后最多连续回退 N-1 个有效历史状态。
- 每次回退恰好移动一个可见文本状态。
- 两次回退之间不需要推进任何文本。
- 到达最早边界后返回 false/no-op，不抛错、不破坏当前状态。
- Choice、System Boundary、视频、忙操作等既有阻断边界继续生效。
- 背景、立绘、Presentation、音频快照和 Interpreter 变量同步恢复。
- 回退失败时保留被弹出的帧和原始 cause，不能静默丢历史。

### 8.4 分支策略

玩家回退后重新向前推进形成新历史分支时，旧的“未来”不需要保留为可前进历史；本 Wave 不实现 redo。回退栈只服务继续向过去回退。

### 8.5 验收

- 公共 Host 测试连续捕获 10 帧并回退 5 次，状态严格为 9、8、7、6、5。
- 每次恢复后立即验证 `canRollback()`。
- 恢复产生的 `text/stateReset` 事件不重复捕获。
- Starter 与《零点之后》使用同一公共实现。
- Electron 真实命令栏连续点击“回退”至少 4 次，无需中间推进。

## 9. G5：Presentation 存档接线成为公共契约

### 9.1 已知接线缺口

Core `Interpreter` 已支持 `PresentationSnapshotHooks`，Starter 已调用 `interp.setPresentationHooks(...)`，但《零点之后》遗漏。因此 `loadSnapshot()` 的 `stateReset` 清空 World 后，没有完整 Presentation payload 可恢复，直到后续场景指令重新设置背景和立绘。

### 9.2 Host 公共组合接口

Host 应提供一个命名明确、类型安全的公共组合函数，将：

- `Interpreter.setPresentationHooks()`；
- `RendererRuntime.queries.presentation.snapshot()`；
- `RendererRuntime.commands.presentation.validate()`（若公共接口可用）；
- `RendererRuntime.commands.presentation.restore()`

组合为一个调用点。具体函数名在实施计划中以现有命名风格确定，但必须由 `@surdet/host` 导出，避免 Core 直接依赖 Renderer。

该接口应返回可处置或可断开的连接句柄，防止 HMR/Runtime dispose 后旧 Interpreter 继续调用已销毁 Renderer。

### 9.3 原子恢复顺序

读档顺序保持 Core 的二阶段严格校验原则：

1. 校验和迁移完整 SaveSnapshot；
2. 无副作用验证 system 与 presentation payload；
3. 进入状态重置边界；
4. 恢复 Interpreter/Core/System 状态；
5. 恢复完整 Presentation；
6. Player Shell 事务成功后关闭读档页并恢复命令栏。

若 Presentation 验证或恢复失败：

- 读档 Promise 必须失败；
- Player Shell 恢复读档前 UI 会话；
- 页面保持可重试；
- 原始错误与 cause 向错误边界传播；
- 不得留下“文字已换、世界为空”的半提交状态。

若现有 Core 顺序无法做到完整补偿，实施应先设计 prepare/commit 或 prevalidated restore，而不是在游戏里捕获错误后继续。

### 9.4 接线覆盖

- Starter 改用 Host 公共组合接口。
- 《零点之后》改用同一接口。
- CLI 新项目模板生成同一接线。
- 文档和 capability matrix 指向公共接口。
- 增加静态/集成门禁，禁止正式示例创建 Interpreter + Renderer Runtime 却没有 Presentation 连接。

### 9.5 存档内容验收

至少覆盖：

- 背景；
- 一个或多个立绘及其位置/表情；
- 摄像机平移/缩放；
- fade/tint 等稳定演出状态；
- 活动 timeline snapshot；
- 音频继续由既有音频快照/管理器契约处理，不在 Presentation 中复制 Howl 实例。

手动档、快速档、自动档应使用同一 `Interpreter.saveSnapshot()` Presentation payload，不得分叉三套规则。

## 10. G6：进入标题时的会话清理契约

### 10.1 当前问题

《零点之后》的 `showTitleScreen()` 当前选择 `runtime.resetSession({ preserveWorld: true })`，因此旧背景和立绘可能透过标题层残留。保留 World 不是标题页读档所必需；正确的读档应依赖 G5 的完整 Presentation 快照。

### 10.2 目标契约

从游戏进入标题时：

- 关闭 Player Shell overlay 与忙操作；
- 停止自动、快进、视频、临时 timeline 与非标题音频策略；
- 清除 Dialogue、Backlog、Command Rail 的游戏会话投影；
- 清除 World 背景、立绘、过渡、摄像机与临时效果；
- 显示标题自有背景和标题菜单；
- 重复进入标题幂等；
- 不释放仍由全局 Runtime/Asset Registry 合法持有的共享资源；
- 不产生 `Renderer resource release failed`。

### 10.3 公共入口

Host/Player Shell 应提供或组合一个语义明确的“进入标题会话”边界，统一 Session reset 与 Renderer reset。游戏可以提供标题 View 和音频偏好，但不应自行排列多层 hide/reset 调用。

一版兼容窗口内，旧游戏仍可调用现有低级命令；Starter 与《零点之后》立即采用公共入口。

### 10.4 验收路径

- 新游戏 → 返回标题：只见标题背景，无旧立绘。
- 游戏 → 标题 → 读档：完整恢复存档 World。
- 游戏 → 标题 → 鉴赏 → 关闭：恢复纯标题，不泄露 World。
- 连续执行三轮“新游戏 → 标题”：资源计数收敛，无错误。
- 读档后 → 标题：无旧 World、无 release failure。

## 11. D7：窗口最大化与 F11 全屏裁决

用户已确认：右上角最大化窗口时左右留黑；F11 真全屏后黑边消失、画面完整。

本 Wave 作如下决策：

- 维持 1280×720 逻辑画布和等比 contain；
- 不横向拉伸；
- 不使用可能裁掉 UI 的全画布 cover；
- 不劫持 Windows 最大化按钮进入全屏；
- F11 与 Alt+Enter 继续作为真全屏入口；
- 保留 Shell E2E 对全屏往返、点击命中和 UI 完整性的回归；
- 若未来需要提升可发现性，应单独设计“全屏提示/设置”，不混入本 Wave。

因此 D7 是已解释并由 F11 验证通过的产品行为，不计入 Wave 4 生产代码修复数。

## 12. 数据流与状态边界

### 12.1 正常存档

```text
Player selects slot
  → PlayerShell beginOperation(saving)
  → Interpreter.saveSnapshot()
      → Core/System snapshots
      → Host-connected Renderer Presentation snapshot
  → SaveStorage atomic write
  → PlayerShell completeOperation
  → close overlay / restore stable command rail
```

### 12.2 正常读档

```text
Player selects occupied slot
  → PlayerShell beginOperation(loading)
  → SaveStorage read
  → validate/migrate complete snapshot
  → prevalidate System + Presentation
  → Interpreter load transaction
  → Renderer restores complete Presentation
  → PlayerShell completeOperation(base=game, overlay=none)
  → stable command rail restored once
```

### 12.3 返回标题

```text
Player selects Return Title
  → PlayerShell consumes pointer
  → close/abort current overlay transaction safely
  → enterTitleSession public boundary
      → clear game-only World/Presentation/UI state
      → retain valid runtime and shared asset ownership
  → project title background + menu
```

## 13. 错误处理原则

- 不得吞掉 Promise rejection、RendererError 或原始 cause。
- 不得把失败后的半恢复状态报告为成功。
- UI 操作失败必须回到操作前可交互状态，并允许玩家重试。
- 资源释放继续保持幂等；重复 close/reset/dispose 不得报错。
- 自动化中的预期错误必须单独记账，不能与 unexpected errors 混为 0。
- Electron 玩家矩阵必须记录 page error、console error、request failure、unhandled rejection、Renderer error 和 release failure。

## 14. 测试与门禁设计

### 14.1 单元与集成测试

- Renderer Gallery：标题/游戏两来源三标签真实事件。
- Renderer Dialogue：固定 command rail alpha、局部 hover、无 tween。
- Renderer Backlog：mask、header 边界、长正文滚动、Unicode。
- Host Rollback：连续 5 次、多分支、边界、恢复失败补偿。
- Host Presentation connection：connect/disconnect、disposed runtime、验证失败。
- Core 存档：Presentation payload 保留、验证先于写入状态。
- Player Shell title boundary：多层关闭、World 清理、幂等、补偿错误。
- Starter/Zero 集成：共同采用公共 API。
- CLI 模板测试：新建项目包含公共接线并可 typecheck/build。

### 14.2 真实 Electron 玩家矩阵

每个 case 使用独立 Electron 进程和独立临时 userData，明确加载 `E:\surdet\examples\zero-after-midnight\dist`：

- A：标题 → 鉴赏 → 音乐 → 文本 → CG → 关闭。
- B：游戏 → 鉴赏 → 音乐 → 文本 → 关闭，剧情不推进。
- C：长 Backlog 滚动，标题不动、正文不越界。
- D：推进至少 8 条，连续回退 4 次。
- E：存档 → 立即读档，背景和立绘保持。
- F：读档 → 存档 → 再读档，Presentation 保持且无 release failure。
- G：新游戏 → 返回标题，旧 World 完全消失。
- H：标题读档 → 返回标题，完整恢复后再彻底清理。
- I：命令栏等待 5 秒及推进 20 条，根 alpha 稳定；悬停只影响单按钮。
- J：F11 进入/退出全屏，画面完整、点击命中正确。

自动化不得用 debug command 代替 A、B、C、D、E、G、H、I 的玩家点击；debug query 仅用于断言真实点击后的内部投影。

### 14.3 全量门禁

- Core、Renderer、Host、Shell、Starter、CLI、《零点之后》相关测试全部通过。
- 相关 workspace typecheck/build 全部通过。
- `npm run verify:renderer-boundaries` 通过。
- `npm run verify:renderer-legacy` 通过。
- `npm run verify:tools` 通过。
- `npm run verify:hygiene` 通过。
- `npm run verify:all` 通过。
- 《零点之后》lint、simulate、asset check、typecheck、build 通过。
- 23/23 choice 分支、3 个结局、44 项正式项目资产、0 模拟运行时错误保持。
- `git diff --check` 通过，tracked `.log` 为空。

## 15. 交付与 Git 纪律

- 执行 AI 从当前 `surdet/main` 同步基线开工。
- 不使用 force push、rebase、reset、amend、squash 或历史改写。
- 每个可独立复审的契约形成普通提交；文档提交与实现提交分开。
- 实施完成后不 push，停在 `WAITING_FOR_REVIEW`。
- 四个受保护未跟踪文件不得修改、暂存、提交、删除或移动：
  - `SESSION-HANDOFF.md`
  - `USER.md`
  - `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
  - `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`
- 不删除用户存档、Profile、设置或历史报告。
- 临时 Electron userData 和测试 worktree 必须使用精确路径台账；清理前验证目标，禁止触碰主工作树和历史 worktree。

## 16. 完成定义

只有同时满足以下条件，Wave 4 才能标记为实施完成：

1. 六项实机问题均有基线红灯、生产修复和绿灯。
2. 通用行为落在 Renderer/Host/Core/共享模板，游戏侧只采用公共接口。
3. 标题和游戏两种 Gallery 来源都经真实鼠标验证。
4. 命令栏根视觉完全稳定。
5. Backlog 正文无法越过固定标题边界。
6. 连续回退至少四次无需中间推进。
7. 存档立即读档完整恢复背景与立绘。
8. 返回标题不残留旧 World。
9. F11 全屏行为保持通过，未引入拉伸或点击漂移。
10. Wave 1–3 的 release failure、空槽、输入门控、H 隐藏和事务回归继续通过。
11. 全量门禁通过，工作树只剩明确受保护文件。
12. 执行 AI 停在 `WAITING_FOR_REVIEW`，未 push、未发行、未进入其他 Wave。

## 17. 设计状态

```text
APPROACH_B_PUBLIC_CONTRACTS_APPROVED
PLAYER_EXPERIENCE_WAVE_4_DESIGN_READY_FOR_USER_REVIEW
IMPLEMENTATION_NOT_STARTED
M9_NOT_STARTED
PERFORMANCE_WORK_DEFERRED
ASSET_WORK_NOT_STARTED
AUDIO_WORK_NOT_STARTED
NO_RELEASE
NO_PUSH
```
