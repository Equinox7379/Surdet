# Surdet 存档备份与显式恢复 Wave 1 交付报告

状态：`FORMAL_ELECTRON_SAVE_RESTORE_VERIFIED` / `WAITING_FOR_REVIEW` / `NOT_PUSHED` / `NOT_DEPLOYED`

本轮属于路线台账的“阶段 3：存档、备份与显式恢复边界”。本报告只记录已经从磁盘和命令输出重新核对的事实。独立复审后，本轮唯一一次正式 Electron 路径已证明第一次保存位置、不同的覆盖前位置、真实恢复动作以及恢复回第一次位置；这证明了自动化玩家路径，但不等于项目所有者人工视觉、声音或手感验收通过。

## 1. 范围与停止边界

已处理的公共落点：

- `packages/core/src/save/save-manager.ts`：公开单备份元信息和显式恢复契约，MemoryStorage 保持一份上一版本备份。
- `packages/core/test/save.test.ts`：覆盖备份保留、显式恢复、无备份失败、正常 load 和损坏主档不自动回退。
- `packages/shell/src/save-store.ts`：列出 `.json.bak` 元信息；显式恢复前完整读取并校验；更新主档和 index；保留 `.bak`；失败时保留原始 cause 并做最小补偿。
- `packages/shell/src/main.ts`、`packages/shell/src/preload.ts`：增加备份列表和恢复 IPC 直通。
- `packages/host/src/electron-save-storage.ts` 及直接测试：保持 rejection 身份向上游传播。
- `packages/renderer/src/ui-views.ts`、`packages/renderer/src/api/renderer-commands.ts`、`packages/renderer/src/layers/menu/menu-layer.ts`、`packages/renderer/src/runtime/renderer-facade.ts`：只在 load + `backupAvailable` 时投影“恢复备份并读取”，区分普通槽位点击，host transaction pending 期间消费重复输入。
- `examples/zero-after-midnight/src/main.ts`、`examples/zero-after-midnight/src/surdet-window.d.ts` 及直接测试：列出备份元信息，显式恢复后复用 `completeLoadedSnapshot` 正常读档完成路径；浏览器 localStorage 与 Electron 存储保持同一契约。
- `packages/shell/e2e/save-backup-restore.e2e.mjs`：一条最小正式入口 E2E runner；debug 仅读取状态和交互几何，输入使用 `page.mouse.click`/键盘。
- 本次独立复审仅在上述 E2E runner 增加资源完成等待、输入后双 `requestAnimationFrame`、`waitForOverlay` 的期望参数传递、运行时 `git rev-parse HEAD` artifact 字段，以及复用 Wave 4 语义的最多 4 次真实推进；没有修改 Core、Renderer、Host、Zero 生产逻辑。

明确没有处理：音频/BGM、性能、编辑器、Gallery、回退黑屏、Ghost Choice、备份 `.bak` 以外的恢复策略、剧情、美术、DSL、存档 schema 版本、发行、部署和 M9。未运行 `verify:all`、性能资格化、pack 或发行。

## 2. 起点和 Git

Task 0 真实起点：

- `HEAD`: `7cc7a3283de10f357226669f1f303eaf032b8171`
- `surdet/main`: `7c4a0059204e927061a67b2005da0036d056409e`
- `HEAD...surdet/main`: `9 0`
- 起点工作树只有五个受保护未跟踪文件和未跟踪的长期路线台账；`git diff --check` exit `0`；tracked `.log` 为空。

当前代码闭环提交链（按本轮实际提交顺序）：

1. `7dd2aa0f3ee34532d3c92409c02ebe56eb805207` — `feat(core): add explicit save backup contract`
2. `9a592c75f6a0958107ba5fb0192edadcfadb369e` — `feat(shell): expose explicit save backup restore`
3. `86cc43c85d5f1d8178d1549563bec7a710bb68f5` — `feat(renderer): add explicit save backup action`
4. `f9c92b217f5d7526e2b48ba2015f5ad49007a1da` — `test(shell): use visible rail for save restore e2e`
5. `ad23e20aae809f2f04c98407751d552830ce0620` — `test(shell): open save menu through player keybinding`
6. `2144d3c6fb90d7e2e486433920aefc5d74246c63` — `test(shell): wait for player game transaction idle`
7. `fc82f5cebcdfb84438d10a3b9b6616664e82ba49` — `test(shell): use semantic advance for backup restore e2e`

后三个提交只修正本轮新增的 E2E harness，不修改生产代码；它们是为区分“产品恢复缺陷”和“测试入口未打开菜单”而保留的本地普通提交。任务书原定的三类主题提交因此多出三枚测试设施提交，属于本轮实际偏差，未隐去。

上一轮文档收口提交为 `7b37fc93bd339230840317526a9de70b9a2df9f2`；本轮 runner 普通提交为 `fc82f5cebcdfb84438d10a3b9b6616664e82ba49`。当前真实代码 HEAD 为 `fc82f5cebcdfb84438d10a3b9b6616664e82ba49`，相对 `surdet/main` 为 `17 0`。以下“工作树保留未提交计划和报告修改”是本报告文档提交前的真实快照；文档收口后以最终 `git status` 为准，长期路线台账仍不暂存、不提交、不 push。

## 3. 红灯 → 绿灯证据

### Core

- 修改前新增备份测试合法红灯：Save 聚焦套件 28 项中 3 项失败，原因是 `SaveManager.listBackupMeta/restoreBackup` 不存在。
- 修复后：`npm run test -w @surdet/core -- --run test/save.test.ts` 为 `28/28`；Core typecheck/build 均 exit `0`。
- 已证明：覆盖同槽位保留上一版本，显式恢复后普通 load 读取恢复后的主档；无备份明确失败；空槽仍为 null；损坏主档普通读取不自动读 `.bak`。

### Shell / Host

- 修改前新增 FileSaveStore 测试 24 项中 3 项失败；Host adapter 的新增 rejection identity 断言失败。
- 修复后：Shell SaveStore `24/24`、Host bridge `2/2`；Shell/Host typecheck/build 均 exit `0`。
- 已证明：备份先完整读取/校验；无效备份不会写主档/index；成功恢复保留 `.bak`；写入失败保留原始错误并进行最小补偿；IPC/Host 不把 rejection 伪装为空数组、null、false 或成功。

### Renderer / Zero

- 修改前 Renderer Menu 聚焦测试新增的备份投影断言为 28 项中 2 项失败；Zero 直接接线测试的新增断言失败。
- 修复后：Renderer `28/28`；Zero 直接相关套件 `32/32`，预检继续报告 11 场景、3 结局、44 资产。
- Renderer/Zero typecheck/build 均 exit `0`。
- 已证明：恢复按钮文案仅由 Renderer MenuLayer 在读档页、有效 `backupAvailable` 槽位内投影；普通槽位点击不走恢复；host transaction pending 时重复恢复点击被消费；Zero 恢复成功路径调用恢复后再普通 load，并复用 `completeLoadedSnapshot`。

## 4. 正式 Electron 证据：一次路径有效通过

### 4.1 代码与 artifact 身份

- `CODE_EVIDENCE_HEAD`：`fc82f5cebcdfb84438d10a3b9b6616664e82ba49`
- `ARTIFACT_HEAD`：`fc82f5cebcdfb84438d10a3b9b6616664e82ba49`
- 两者一致；artifact 的 `runHead` 来自 runner 运行时执行的 `git rev-parse HEAD`。
- `DOCUMENT_CLOSURE_HEAD`：由本报告与任务计划共同产生的本轮文档提交 HEAD；提交后必须立即通过 `git rev-parse HEAD` 重新读取，最终值登记在长期路线台账和本轮最终回执中，不在提交前伪填。

### 4.2 有效路径条件

本轮只运行了一次正式 runner，使用了：

- 正式入口：`E:\surdet\examples\zero-after-midnight\dist`
- 独立临时 `userData`：`C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-l5qflh\user-data`
- 窗口标题：`零点之后 / AFTER MIDNIGHT`
- 资源加载：`total=48 / completed=48 / failed=0`
- `backupRestoreTargetVisible=true`
- `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures`：全部为 `0`

真实玩家输入路径通过了：

- 标题 → 新游戏 → 可推进文本 → PlayerShell `base=game / overlay=none / operation=idle`；
- 真实 `Escape` → `system-menu`；
- 保存槽位 1 → 回到游戏；
- 复用 Wave 4 语义的真实 `Space` 输入：第一次输入完成文字边界，第二次输入后公开位置从 `prologue:7` 变为 `prologue:8`；
- 覆盖槽位 1 → 回到游戏，并保留上一版本备份；
- 进入读档页，公开恢复按钮目标存在；
- 真实鼠标命中恢复按钮区域，而不是普通槽位点击或内部调用；
- 恢复动作结束、读档页关闭，恢复后公开位置回到 `prologue:7`，且不同于覆盖前的 `prologue:8`。

### 4.3 新鲜 artifact

artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-l5qflh\save-backup-restore.json`

| 字段 | 磁盘实测值 |
|---|---|
| 状态 | `PASSED` |
| 字节数 | `1,097` |
| SHA-256 | `D078476A7379FDFBD80F7147DAABFD8D7BB54068837CB07704B94D9385BC692F` |
| `runHead` | `fc82f5cebcdfb84438d10a3b9b6616664e82ba49` |
| `firstSavePosition` | `prologue:7` |
| `secondSavePosition` | `prologue:8` |
| `restoredPosition` | `prologue:7` |
| `failures` | 空数组 |

此前四份菜单入口失败 artifact 仍保留，作为历史阻断证据：

| 尝试 | 输入入口 | artifact | 字节数 | SHA-256 | 失败点 |
|---|---|---|---:|---|---|
| 1 | 右键 contextmenu | `C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-MTnBcf\save-backup-restore.json` | 1052 | `A7BF89849C308822BE24D32BF3DB8F3F1E9D4A8042F99C961D216F3CFD47B584` | 等待 `activeOverlay=system-menu` 超时 |
| 2 | 可见 `rail:menu` 鼠标点击 | `C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-EoNMHh\save-backup-restore.json` | 1052 | `B38280C60A6D393D5AB063CB5568D568633616CBE7ACE2BCAEBE015F40D53D79` | 等待 `activeOverlay=system-menu` 超时 |
| 3 | `Escape` 键 | `C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-ayltGb\save-backup-restore.json` | 1052 | `1D4558AC2E01DB358256E65C32C83CE334CBFE760BB53BE2397F1FCCDF6DA0FE` | 等待 `activeOverlay=system-menu` 超时 |
| 4 | `Escape` 键 + `base=game/operation=idle` 等待 | `C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-Mu3tNU\save-backup-restore.json` | 1052 | `7BF898B84A9ABEBAD6CC9E7094693BB623F8EB90AE9532EA76B9A44ACC758F3B` | 等待 `activeOverlay=system-menu` 超时 |

四份历史 artifact 没有被删除或覆盖；新鲜 artifact 的错误通道也全部为空。当前正式 Electron 自动化结果为 `FORMAL_ELECTRON_SAVE_RESTORE_VERIFIED`。该结果只证明自动化真实输入路径和存档恢复契约，不等于项目所有者人工视觉、声音或操作手感验收通过。

## 5. 尚未证明和后续入口

尚未证明：

- 项目所有者按桌面 11 步草案进行的人工实机验收；
- 人工验收中的视觉、声音和操作手感是否符合项目所有者标准；
- 任何部署、发行或远端 push 结果。

不得宣称：

- “项目所有者已经人工验收通过”；
- “正式发行或部署已经完成”；
- “下一阶段已经获准开始”。

下一步停止在总经理独立复审。只有总经理复审通过并明确给出部署授权后，才可把最终被测 HEAD 写入部署指令，请项目所有者按 11 步草案进行人工验收；本轮不自动部署、不进入阶段 4。

## 6. 当前收口状态

- Core 备份契约：已实现并由聚焦测试验证。
- Shell 显式恢复：已实现并由临时目录测试验证。
- Renderer 恢复按钮/事务输入：已实现并由聚焦测试验证。
- Zero 接线：已实现并由直接测试、typecheck/build 和模拟验证。
- 正式 Electron：自动化真实路径有效通过；人工验收尚未进行。
- `verify:all`：按任务书未运行，不伪称本轮全量通过。
- 是否修改 BGM：否；上一轮本地 BGM 提交仍未获批准推送。
- 是否 push：否。
- 是否部署/打包/发行：否。
- 是否进入 M9：否。
- `CODE_EVIDENCE_HEAD`：`fc82f5cebcdfb84438d10a3b9b6616664e82ba49`。
- `ARTIFACT_HEAD`：`fc82f5cebcdfb84438d10a3b9b6616664e82ba49`。
- `DOCUMENT_CLOSURE_HEAD`：本轮计划与报告共同产生的文档提交 HEAD；提交后按命令重新读取，并登记在长期路线台账和本轮最终回执中。

最终状态：

```text
SAVE_BACKUP_AND_EXPLICIT_RECOVERY_WAVE_1_IMPLEMENTED
CORE_BACKUP_CONTRACT_VERIFIED
SHELL_EXPLICIT_RESTORE_VERIFIED
RENDERER_BACKUP_ACTION_VERIFIED
ZERO_EXPLICIT_RECOVERY_VERIFIED
FORMAL_ELECTRON_SAVE_RESTORE_VERIFIED
AUDIO_PRODUCTION_DEFERRED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
NOT_DEPLOYED
WAITING_FOR_REVIEW
```
