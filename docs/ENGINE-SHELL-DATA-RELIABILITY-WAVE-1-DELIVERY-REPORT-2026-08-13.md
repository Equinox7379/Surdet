# Surdet Shell 失败数据可靠性 Wave 1 交付报告

日期：2026-08-13

状态：`WAITING_FOR_REVIEW` / `NOT_PUSHED` / `NOT_DEPLOYED`

## 1. 路线阶段与本轮结论

本轮属于项目路线台账的阶段 2：Shell 失败数据可靠性。

本轮围绕公共 Host/Shell 存储边界核验并修复了一个真实缺陷：

`FileSaveStore.list()` 在保存目录已经消失时直接返回空数组，把真实的文件系统 `ENOENT` 故障伪装成“没有存档”。这会让上游无法区分空列表和存储失败。本轮移除该错误短路，使目录枚举的原始 I/O 异常继续向上抛出。

其余任务书要求的公共契约在既有实现和新增回归中已经得到证据支持，没有进行猜测性修改。

## 2. 起始基线

Task 0 开始前真实只读结果：

```text
git rev-parse HEAD
99abc9abc1f42cb29e54c9871d9aad163a0f7d4a

git rev-parse surdet/main
7c4a0059204e927061a67b2005da0036d056409e

git rev-list --left-right --count HEAD...surdet/main
6 0
```

起始工作树没有 tracked 修改，只有以下未跟踪文件：

```text
?? AGENTS.md
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
?? docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md
?? docs/superpowers/plans/2026-08-13-shell-data-reliability-wave-1.md
```

`git diff --check` 退出码为 `0`，`git ls-files '*.log'` 为空。

路线台账、`AGENTS.md`、四个受保护文件和上一轮 BGM 本地提交均未修改、暂存或提交。

## 3. Task 1：红灯证据

Task 0 盘点确认，以下契约已经有覆盖，因此没有重复添加：

- `ElectronSaveStorage` 已经逐一保留 `read`、`write`、`delete`、`list`、`listMeta` 的原始 rejection 身份；缺失读档返回 `null`。
- `PlayerShellController` 已经覆盖保存/读档失败后的 session 恢复、一次错误报告、projection compensation、原始 cause 和可重试路径。
- fixed six-slot registry 已经覆盖 provider `this` 绑定及失败 cause。
- Renderer 既有 `menu-layer.test.ts` 已覆盖真实有效存档槽位的 pending 重复点击、消费输入、失败后保持页面和重试语义；本轮不扩大到 Renderer 文件。

唯一发现的 Shell 覆盖缺口是实际文件系统/索引失败。新增测试：

1. 损坏 `index.json` 时，`listMeta()` 必须抛出索引读取错误，并在 `cause` 中保留原始 `SyntaxError`；该测试在修复前已通过，说明现有索引错误包装语义正确。
2. 构造函数完成后删除保存目录，再调用 `list()`；修复前命令产生真实红灯：

```text
npm run test -w @surdet/shell -- test/save-store.test.ts
退出码：1
21 tests：20 passed / 1 failed
失败事实：list() 返回 undefined error，实际把消失目录当成空列表。
```

这不是通过改断言制造的红灯，而是对外部存储目录消失这一真实 I/O 故障的最小复现。

## 4. Task 2：公共层修复

修改文件：

- `packages/shell/src/save-store.ts`
- `packages/shell/test/save-store.test.ts`

生产改动只有一处：删除 `FileSaveStore.list()` 中的：

```ts
if (!fs.existsSync(this.dir)) return [];
```

随后直接调用 `fs.readdirSync(this.dir)`。因此：

- 正常存在的空目录仍返回 `[]`；
- 目录实际消失或枚举失败时，原始 `ENOENT`/文件系统错误继续上抛；
- 没有把故障转换成空列表、成功、`null` 或成功通知；
- 没有修改 `read()` 的缺失槽位 `null` 语义；
- 没有修改 `.bak`、迁移、备份恢复或存档格式。

同一测试在修复后：

```text
npm run test -w @surdet/shell -- test/save-store.test.ts
退出码：0
1 file / 21/21 tests
```

Task 2 普通本地提交：

```text
2da191cfee3fbec6a506831f49f2c70220c429a0
fix(host): preserve shell storage failures
```

提交虽然使用了任务书建议的 `host` scope，但实际修改仅限 Shell `FileSaveStore` 及其测试；没有修改 Host 生产代码。

## 5. 各类失败契约证据

### 缺失读档槽位

- Host bridge 测试证明 `storage.read('missing')` 返回 `null`。
- Shell `FileSaveStore` 测试证明不存在槽位返回 `null`。
- 不调用真实读档失败路径、不抛错、不关闭页面、不推进剧情的公共语义由既有存读档菜单/Host session 契约保留。

### 真实存储失败

- Electron bridge 的 read/write/delete/list/listMeta rejection 均以原始错误对象向上游传播。
- 损坏主存档不会伪装成空槽位，也不会静默回退 `.bak`；该既有边界保持不变。
- 损坏索引的包装错误保留原始解析异常于 `cause`。
- 保存目录消失时 `list()` 现在保留真实 `ENOENT`，不再返回假空列表。

### 删除、写入与索引错误

- Host bridge 测试证明 delete/write 失败的原始错误身份。
- Shell 已有测试覆盖写入序列化失败、大小上限失败、删除后的槽位消失和索引列表行为。
- 本轮没有扩展到 `.bak` 恢复或存档文件系统事务回滚；这些属于后续备份/恢复边界，不能在本轮隐式加入。

### UI/session/projection 回滚

既有 Host 测试实际证明：

- 失败前后 `PlayerUiSession` snapshot 保持一致；
- save/load overlay 保持可见；
- provider projection 在关闭/重投影失败时恢复；
- command rail/session 的 busy operation 不被宣称为成功；
- 原始 error 或 `PlayerShellSlotError.cause`/`AggregateError.errors` 保留；
- 失败后可安全重试。

本轮没有修改这些已经通过的 Host/Renderer 边界。

### pending 重复点击

Renderer 既有 `packages/renderer/test/legacy/menu-layer.test.ts` 已覆盖真实有效存档/读档槽位在 deferred host transaction 期间的重复点击、一次 beginOperation、pending 页面保持、成功单次完成以及失败后的重试。本轮没有修改或重新实现 Renderer pending 逻辑。

## 6. Task 3：正式 Zero 消费者路径

运行：

```text
npm run test -w zero-after-midnight -- player-ui-integration.test.ts
```

退出码 `0`。工作区既有脚本完成了正式内容预检：`44` 项资产、`11` 个场景、`3` 个结局；随后 5 个测试文件、`31/31` 测试通过，其中 `player-ui-integration.test.ts` 为 `2/2`。

该测试确认《零点之后》继续使用公共 Host controller、六槽 registry、Renderer theme 和公开回退/标题边界，没有创建游戏专用 PlayerShellController、PlayerInputGate 或错误状态机。

当前 Zero 集成测试没有一个授权的存储故障注入接口，因此本轮没有在游戏层添加假失败、错误显示器或 fallback。标题列表失败、游戏内保存/读档失败的真实 Electron 注入仍属于未直接观测的证据缺口，不能被静态接线测试冒充为完整玩家验收。

## 7. Task 4：回归门禁

| 命令 | 实际结果 |
|---|---|
| `npm run test -w @surdet/host` | 退出码 0，11 files / 87/87 |
| `npm run test -w @surdet/shell -- test/save-store.test.ts` | 退出码 0，1 file / 21/21 |
| `npm run test -w zero-after-midnight -- player-ui-integration.test.ts` | 退出码 0，预检通过，5 files / 31/31 |
| `npm run typecheck -w @surdet/host` | 退出码 0 |
| `npm run build -w @surdet/host` | 退出码 0 |
| `npm run typecheck -w @surdet/shell` | 退出码 0 |
| `npm run build -w @surdet/shell` | 退出码 0 |
| `npm run typecheck -w zero-after-midnight` | 退出码 0 |
| `npm run build -w zero-after-midnight` | 退出码 0；仅有既有 Vite chunk-size warning |
| `npm run verify:hygiene` | 退出码 0，644 tracked paths |
| `git diff --check` | 退出码 0 |
| `git ls-files '*.log'` | 空 |

没有运行 `npm run verify:all`、Renderer boundary/legacy、性能资格化、大型 Electron 矩阵、pack 或 electron-builder。原因是本轮只修改 Shell `FileSaveStore`，任务书没有要求无关全仓库门禁；没有为了已知无关的 Editor CRLF/LF 问题扩大范围。

## 8. 文件范围

本轮实际修改并提交：

- `packages/shell/src/save-store.ts`
- `packages/shell/test/save-store.test.ts`

本轮新增并在文档收口阶段提交：

- `docs/ENGINE-SHELL-DATA-RELIABILITY-WAVE-1-DELIVERY-REPORT-2026-08-13.md`
- `docs/superpowers/plans/2026-08-13-shell-data-reliability-wave-1.md`

没有修改：

- `packages/host/src/electron-save-storage.ts`
- `packages/host/src/player-shell-controller.ts`
- `packages/shell/src/main.ts`
- `packages/shell/src/preload.ts`
- `examples/zero-after-midnight` 的任何生产代码或测试；
- Renderer、Core、Editor、Starter、CLI；
- 音频、BGM、SE、美术、剧情、DSL、存档格式；
- 回退黑屏、Ghost Choice、`.bak` 恢复、性能 artifact、性能门限和 M9。

受保护文件和长期路线台账均未触碰、未暂存、未提交。

## 9. Git 与停止点

代码证据提交：

```text
2da191cfee3fbec6a506831f49f2c70220c429a0
fix(host): preserve shell storage failures
```

文档收口提交将只包含本报告和本 Wave 1 计划；其真实 SHA、最终 HEAD、最终 `HEAD...surdet/main` 和最终工作树由提交后的只读复核确定，并在最终交付回报中报告，避免在本报告写入不存在的自引用 SHA。

当前文档提交前基线：

```text
HEAD = 2da191cfee3fbec6a506831f49f2c70220c429a0
HEAD...surdet/main = 7 0
```

最终工作树预期只保留：五个受保护未跟踪文件、未跟踪的长期路线台账，以及本 Wave 计划/报告在提交前的暂存内容；文档提交后不应残留本轮 tracked 修改。

明确声明：

- 未 push；
- 未部署；
- 未打包或发行；
- 未处理性能；
- 未处理音频生产；
- 未处理编辑器；
- 未处理备份恢复；
- 未进入 M9；
- 未修改 AGENTS.md、四个受保护文件或长期路线台账。

## 10. 未解决与延期

- 真实 Electron 环境下通过正式《零点之后》触发标题列表失败、游戏内 save/load 失败，并观察窗口可用性、overlay、command rail 和世界状态的端到端注入证据，本轮没有执行；当前公共静态/单元契约没有授权的故障注入 seam。
- 存档主文件与索引之间的跨文件事务回滚、`.bak` 显式恢复和恢复后的表现清理属于路线阶段 3，不在本轮处理。
- 没有将“自动化通过”表述为完整玩家失败路径已由 Electron 复核。

最终状态：

```text
SHELL_DATA_RELIABILITY_WAVE_1_IMPLEMENTED
SHELL_STORAGE_FAILURE_PROPAGATION_VERIFIED
SHELL_LIST_DIRECTORY_FAILURE_NO_LONGER_FALSE_EMPTY
ZERO_PUBLIC_CONSUMER_WIRING_RETAINED
BACKUP_RECOVERY_NOT_STARTED
AUDIO_PRODUCTION_DEFERRED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
NOT_DEPLOYED
WAITING_FOR_REVIEW
```
