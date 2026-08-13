# Surdet 存档备份与显式恢复 Wave 1 执行计划

> 本计划严格对应 2026-08-13 总经理任务书，属于路线阶段 3：存档、备份与显式恢复边界。按 Task 0 → Task 5 串行执行；不启动子 AI，不 push、部署、打包或发行。

## 目标与不变量

- 将现有每槽位一份 `.bak` / backup 变为玩家明确触发的“恢复备份并读取”能力。
- 普通 `read/load`、空槽位和损坏主档绝不自动读取 `.bak`。
- 显式恢复前完整读取并校验备份；校验失败时主档和 `index.json` 字节不变。
- 成功恢复后主档和索引元信息与备份一致，`.bak` 保留，后续普通读取只读主档。
- 恢复成功后沿用既有正常读档完成路径；失败保持原世界、表现、音频、UI session、overlay 和 command rail，可重试。
- 不添加第二套存档状态机、migration、兼容层、多版本备份链、全局错误总线或配置开关。

## 严格范围

仅允许在任务书列出的 Core、Shell/IPC、Host、Renderer SaveLoad、Zero 存读档测试与接线、一个最小 Electron E2E、交付报告和本计划内修改。长期路线台账只更新阶段事实/下一步/停止点，不得暂存或提交。

不得触碰 `AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两个艺术交接文件、性能体系、音频资产、编辑器、剧情、DSL、发行和 M9。

## Task 0：基线与现状盘点

- [x] 读取 AGENTS、路线台账、Shell Wave 1 报告和本轮任务书。
- [x] 记录 HEAD、`surdet/main`、ahead/behind、状态、diff check、tracked logs。
- [x] 盘点 Core SaveStorage/SaveManager、MemoryStorage/localStorage、FileSaveStore、Electron bridge/IPC、Renderer SaveLoad 和 Zero 当前 `.bak` 语义：当前没有公开备份列表/显式恢复契约；损坏主档不会自动读取 `.bak`。
- [x] 运行受影响模块未修改基线测试与 typecheck/build：Core Save 25/25、Shell FileSaveStore 21/21、Host bridge 2/2、Renderer Menu 26/26、Zero 相关套件 31/31；五个工作区 typecheck/build 全部 exit 0。

## Task 1：Core 公共备份契约

- [x] 先新增失败测试：覆盖写保留旧快照、备份元信息/内容、显式恢复、无备份失败、恢复后 load、空槽、损坏主档不自动恢复，以及 MemoryStorage/localStorage 实现。
- [x] 最小修改 `packages/core/src/save/save-manager.ts` 及与 SaveManager 直接相关既有测试；如公共 `SaveStorage` 类型位于同文件或直接关联文件，仅在任务书白名单内调整。
- [x] 不修改 schema 版本、迁移、VariableStore、解释器或存档格式。
- [x] 运行 Core 聚焦测试、typecheck/build，建立独立普通提交。

## Task 2：Shell / IPC / Host 接线与恢复事务

- [x] 先新增失败测试：FileSaveStore 备份列表/恢复、无备份、损坏/非法备份、原始 cause、主档/index 字节不变、成功恢复保留 `.bak`。
- [x] 接通 FileSaveStore → main IPC → preload → ElectronSaveBridge → ElectronSaveStorage → SaveManager。
- [x] 恢复失败不得伪装成功；成功前不关闭 UI、不恢复 command rail；失败可重试。
- [x] 主档/index 写入失败时做最小可靠补偿；无法可靠补偿则抛错并保留 `.bak`，不得声称跨文件绝对原子。
- [x] 运行 Shell/Host 聚焦测试、typecheck/build，建立独立普通提交。

## Task 3：Renderer / Zero 显式恢复玩家动作

- [x] 先新增失败测试：按钮只在 load + backupAvailable 出现，普通卡片点击不恢复，恢复点击与普通 load 区分，pending 重复点击消费。
- [x] 恢复按钮文案固定为“恢复备份并读取”，只读档页显示。
- [x] Renderer 只投影 `backupAvailable`、命中区域和 pending 输入，不读取文件系统或备份内容。
- [x] Zero 恢复成功复用既有读档完成路径；失败保持读档页/session/overlay/command rail，可重试。
- [x] 运行 Renderer/Zero 聚焦测试、typecheck/build，建立独立普通提交；新增一条最小 Electron 恢复路径脚本。

## Task 4：比例适当的综合验证

- [ ] Core、Shell、Host、Renderer、Zero 聚焦测试。
- [ ] Core、Shell、Host、Renderer、Zero typecheck/build。
- [ ] `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000`。
- [ ] 仅一次最小正式 Electron 路径：新游戏 → 推进 → 保存槽位 1 → 再推进 → 覆盖槽位 1 → 进入读档 → 点击“恢复备份并读取” → 验证回到第一次保存位置。
- [ ] 不运行 verify:all、性能资格化、多轮 Electron 矩阵、pack 或发行。
- [ ] `git diff --check`、`git ls-files '*.log'`。

## Task 5：报告、台账与停止

- [ ] 创建 `docs/ENGINE-SAVE-BACKUP-AND-EXPLICIT-RECOVERY-WAVE-1-DELIVERY-REPORT-2026-08-13.md`。
- [ ] 更新本计划 Execution Ledger；长期路线台账只做事实更新，不暂存/提交。
- [ ] 报告真实提交链、最终 HEAD、远端关系、工作树、备份按钮是否真实存在、`.bak` 是否仍不自动恢复、主档/index 失败行为、Electron 路径结果及未证明边界。
- [ ] 重新读取报告/计划字节数和 SHA-256，精确暂存本报告与本计划，创建最后文档提交。
- [ ] 停止：`WAITING_FOR_REVIEW`、`NOT_PUSHED`、`NOT_DEPLOYED`。

## Execution Ledger

### Task 0 — baseline and scope confirmation (completed)

- 真实起始 `HEAD`: `7cc7a3283de10f357226669f1f303eaf032b8171`。
- 真实 `surdet/main`: `7c4a0059204e927061a67b2005da0036d056409e`。
- `git rev-list --left-right --count HEAD...surdet/main`: `9 0`。
- 起始 `git status --short` 只有：
  - `?? AGENTS.md`
  - `?? SESSION-HANDOFF.md`
  - `?? USER.md`
  - `?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
  - `?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`
  - `?? docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`
- `git diff --check`: exit `0`。
- `git ls-files '*.log'`: 空。
- 当前本地领先提交包含上一轮 BGM 占位音频提交；本轮不 push、不修改、不混入音频文件。

### Task 1 — completed

- 修改前红灯：`npm run test -w @surdet/core -- --run test/save.test.ts` 为 28 项中 3 项失败，均因 `SaveManager.listBackupMeta/restoreBackup is not a function`。
- 修改后绿灯：同一命令 28/28 通过；`npm run typecheck -w @surdet/core` 与 `npm run build -w @surdet/core` 均 exit 0。
- 实现：`SaveStorage` 增加可选 `listBackupMeta`/`restoreBackup`；`MemoryStorage` 保留单个上一版本备份并支持显式恢复；`SaveManager` 提供统一异步转发；未改变 schema、普通 load 或缺失槽位语义。
- 普通提交：`7dd2aa0f3ee34532d3c92409c02ebe56eb805207`（`feat(core): add explicit save backup contract`）。

### Task 2 — completed

- 修改前红灯：Shell FileSaveStore 新增测试 24 项中 3 项失败（缺少 `listBackupMeta`/`restoreBackup`）；Host bridge 新增 rejection identity 失败（adapter 未暴露新方法）。
- 修改后绿灯：Shell 24/24、Host 2/2；Shell/Host typecheck 与 build 均 exit 0。
- 实现：FileSaveStore 先完整读取并 `assertValidSnapshot(..., 'legacy')` 备份，再替换主档并更新 index；失败时保留原始 cause、主档/index 字节不变并做最小补偿；IPC/preload/Host bridge 逐层直通；普通主档 read 仍不自动读取 `.bak`。
- 普通提交：`9a592c75f6a0958107ba5fb0192edadcfadb369e`（`feat(shell): expose explicit save backup restore`）。

### Task 3 — completed

- 修改前红灯：Renderer `npm run test -w @surdet/renderer -- --run test/legacy/menu-layer.test.ts` 为 28 项中 2 项失败（恢复按钮未投影）；Zero `npm run test -w zero-after-midnight -- --run test/player-ui-integration.test.ts` 为既有 31 项通过且新增接线断言失败（缺少备份列表/恢复接线）。
- 修正测试层级后，同一聚焦命令转绿：Renderer 28/28；Zero 5 个直接相关测试文件共 32/32，且预检保持 11 场景、3 结局、44 资产。
- Renderer/Zero typecheck 与 build 均 exit `0`；`node --check packages/shell/e2e/save-backup-restore.e2e.mjs` exit `0`。正式 Electron 路径尚留 Task 4 单次门禁。
- 实现：SaveLoadView 增加 `backupAvailable`；MenuLayer 只在 load 页绘制“恢复备份并读取”并消费 pending 输入；RendererFacade 接通恢复事务；Zero 接线列出备份、显式恢复后复用正常 `completeLoadedSnapshot`；window bridge 类型已更新。
- 普通提交：`86cc43c85d5f1d8178d1549563bec7a710bb68f5`（`feat(renderer): add explicit save backup action`）。

### Task 4 — blocked

- 预备门禁已完成：Core Save 28/28、Shell FileSaveStore 24/24、Host bridge 2/2、Renderer Menu 28/28、Zero 直接相关套件 32/32；Core/Shell/Host/Renderer/Zero typecheck/build 均 exit `0`；Zero simulate 为 23/23 choice 分支、3 结局、39 次 save/load、运行时错误 `0`。
- 正式入口确为 `E:\surdet\examples\zero-after-midnight\dist`，独立 userData；四次临时证据均在菜单打开处阻断：`MTnBcf`（右键）、`EoNMHh`（命令栏鼠标）、`ayltGb`（Escape）、`Mu3tNU`（Escape + PlayerShell game/idle 等待）。四次均先验证窗口标题和标题→新游戏→可推进文本；均未进入保存/恢复阶段。
- 四份失败 artifact 均保留在系统临时目录，状态均为 `FAILED`，错误数组全部为空；失败点均为等待 `activeOverlay === 'system-menu'` 超时。不能把这解释为产品恢复失败，也不能作为显式恢复玩家路径通过证据。
- 为排除 runner 自身问题，新增了命令栏/键位/PlayerShell idle 等最小 harness 修正并分别普通提交；仍无法取得菜单呈现红/绿闭环后，按阻断规则停止，不再继续 Electron 试跑。

### Task 5 — completed (blocked delivery closure)

- 已生成阻断交付报告，保留已通过的 Core/Shell/Host/Renderer/Zero 单元/构建/模拟证据，明确显式恢复的正式 Electron 路径尚未验证。
- 报告当前磁盘字节数 `9184`，SHA-256 `460BC7B3BBEF10F3AB55FDC867C7ECE1FE8E82A19098B382F2BD8E859805C540`；计划当前磁盘字节数 `10113`，SHA-256 `70C426E502580CD5D7942A549599FC8DF6A883C9C5F55BE53F404FD89025221A`。
- `git diff --check` exit `0`；`git ls-files '*.log'` 为空；长期路线台账仍未暂存/提交。文档收口提交只允许包含本报告和本计划，创建后在最终回复记录真实 SHA。
- 停止：`WAITING_FOR_REVIEW`、`NOT_PUSHED`、`NOT_DEPLOYED`；不进入下一主题。
