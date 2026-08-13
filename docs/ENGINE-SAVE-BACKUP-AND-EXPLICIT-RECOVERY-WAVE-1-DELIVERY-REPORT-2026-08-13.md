# Surdet 存档备份与显式恢复 Wave 1 交付报告

状态：`WAITING_FOR_REVIEW` / `NOT_PUSHED` / `NOT_DEPLOYED`

本轮属于路线台账的“阶段 3：存档、备份与显式恢复边界”。本报告只记录本轮已经在磁盘和命令输出中证明的事实；正式 Electron 玩家恢复路径在本轮被测试 harness 的菜单呈现阻断，不能宣称整条玩家路径已通过。

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

后三个提交只修正本轮新增的 E2E harness，不修改生产代码；它们是为区分“产品恢复缺陷”和“测试入口未打开菜单”而保留的本地普通提交。任务书原定的三类主题提交因此多出三枚测试设施提交，属于本轮实际偏差，未隐去。

文档收口提交尚未创建；本报告和计划将在本次收口提交中纳入。当前代码 HEAD 为 `2144d3c6fb90d7e2e486433920aefc5d74246c63`，当前相对 `surdet/main` 为 `15 0`。

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

## 4. 正式 Electron 证据：阻断而非通过

正式入口和隔离条件均正确：

- `E:\surdet\examples\zero-after-midnight\dist`
- 每次独立临时 `userData`
- 窗口标题实际为 `零点之后 / AFTER MIDNIGHT`
- 标题 → 新游戏 → 可推进文本均通过

但最小路径尚未走到存档页。四次保留的失败 artifact 如下：

| 尝试 | 输入入口 | artifact | 字节数 | SHA-256 | 失败点 |
|---|---|---|---:|---|---|
| 1 | 右键 contextmenu | `C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-MTnBcf\save-backup-restore.json` | 1052 | `A7BF89849C308822BE24D32BF3DB8F3F1E9D4A8042F99C961D216F3CFD47B584` | 等待 `activeOverlay=system-menu` 超时 |
| 2 | 可见 `rail:menu` 鼠标点击 | `C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-EoNMHh\save-backup-restore.json` | 1052 | `B38280C60A6D393D5AB063CB5568D568633616CBE7ACE2BCAEBE015F40D53D79` | 等待 `activeOverlay=system-menu` 超时 |
| 3 | `Escape` 键 | `C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-ayltGb\save-backup-restore.json` | 1052 | `1D4558AC2E01DB358256E65C32C83CE334CBFE760BB53BE2397F1FCCDF6DA0FE` | 等待 `activeOverlay=system-menu` 超时 |
| 4 | `Escape` 键 + `base=game/operation=idle` 等待 | `C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-Mu3tNU\save-backup-restore.json` | 1052 | `7BF898B84A9ABEBAD6CC9E7094693BB623F8EB90AE9532EA76B9A44ACC758F3B` | 等待 `activeOverlay=system-menu` 超时 |

四份 artifact 的 `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 均为空；最后一份还证明 PlayerShell 已进入 `base=game / overlay=none / operation=idle`。因此当前事实是：菜单呈现入口的新增 E2E harness 仍阻断，不能据此判断 FileSaveStore、Host、Renderer 恢复功能在正式玩家路径失败，也不能把显式恢复写成 Electron 已通过。

本轮没有再重跑路径，也没有删除或覆盖任何历史 artifact。正式 Electron 结果：`FORMAL_ELECTRON_SAVE_RESTORE_BLOCKED_BY_HARNESS_MENU_ENTRY`。

## 5. 尚未证明和后续入口

尚未证明：

- 正式 Electron 中从菜单保存槽位 1、覆盖槽位 1、进入读档页并点击“恢复备份并读取”的完整玩家路径；
- 恢复后正式窗口位置是否回到第一次保存点；
- 正式 Electron 下恢复按钮的可见命中位置、页面关闭时序和 command rail 恢复时序。

不得宣称：

- “所有存档/读档期间的恢复已通过”；
- “正式玩家路径已验证”；
- “Electron 恢复功能已通过”。

下一步必须先由独立复审确认新的菜单入口证据方案，再继续；本轮不自动进入下一阶段。

## 6. 当前收口状态

- Core 备份契约：已实现并由聚焦测试验证。
- Shell 显式恢复：已实现并由临时目录测试验证。
- Renderer 恢复按钮/事务输入：已实现并由聚焦测试验证。
- Zero 接线：已实现并由直接测试、typecheck/build 和模拟验证。
- 正式 Electron：阻断，未取得完整玩家证据。
- `verify:all`：按任务书未运行，不伪称本轮全量通过。
- 是否修改 BGM：否；上一轮本地 BGM 提交仍未获批准推送。
- 是否 push：否。
- 是否部署/打包/发行：否。
- 是否进入 M9：否。
- `DOCUMENT_CLOSURE_HEAD`：本报告提交完成后产生；不得在提交前伪填。

最终状态：

```text
SAVE_BACKUP_AND_EXPLICIT_RECOVERY_WAVE_1_IMPLEMENTED
CORE_BACKUP_CONTRACT_VERIFIED
SHELL_EXPLICIT_RESTORE_VERIFIED
RENDERER_BACKUP_ACTION_VERIFIED
ZERO_EXPLICIT_RECOVERY_VERIFIED
FORMAL_ELECTRON_SAVE_RESTORE_BLOCKED_BY_HARNESS_MENU_ENTRY
AUDIO_PRODUCTION_DEFERRED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
NOT_DEPLOYED
WAITING_FOR_REVIEW
```
