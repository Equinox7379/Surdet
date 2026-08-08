# Wave 1 审计整改交付报告

日期：2026-08-08<br>
仓库：`E:\surdet`<br>
基线 HEAD：`3ecd43a0ad5829b0253141e9a5bd42db061ff1e4`<br>
分支：`main`<br>
远端分歧：`HEAD...surdet/main = 0 0`

## 结论

任务书要求的四个阻断项已完成修正，并通过纯函数、包级、真实 Vite、starter shell E2E 和正式 Electron 隔离启动验收。正式包保持 `release`、加密和 `zero-after-midnight/prologue` 身份。

本报告只记录可复验事实。当前工作树仍保留未提交的既有 Wave 1 修改和本轮整改修改；没有执行 `git commit`、`git push`、`git reset`、`git clean`，没有清理工作树，也没有读取、修改或删除用户真实存档。

## 四项阻断项修正

### 1. system 交互 rollback 边界

`@surdet/host` 现在在 system adapter 的 `enter`、`complete`、`fail`、`reset`、`dispose` 边界安全清理回退缓冲。清理同时推进 generation，阻止已排队的异步文本检查点在边界之后重新写回，因此 system 交互完成后不能回退到交互前。

覆盖测试：

- `packages/host/test/create-host.test.ts`：system 交互完成后不能回退；adapter 失败、reset、dispose 均关闭边界。
- `examples/starter/test/rollback-runtime.test.ts`：直接覆盖 `captureText → clear → microtask` 的 generation 失效，以及边界后新 generation 继续捕获。
- shell/隔离 EXE 的 debug probe：作为端到端补充证据；普通文本 EXE 回退不被当作 system boundary 测试。

### 2. system snapshot 原子恢复

Calendar、Combat、Affection、Achievement、EventScheduler 都先执行无副作用深校验，再进入状态写入。入口恢复前先完成具体 validator；验证失败时不会写入任何已验证系统或变量。正式游戏空战斗配置的合法 idle 快照也被明确纳入兼容规则，其他非法阵营、单位、生命值仍拒绝。

覆盖测试：

- `packages/host/test/system-router.test.ts`：真实 Interpreter 链路中畸形 combat 快照在变量提交前失败，calendar/combat/其他状态保持原值。
- `packages/core/test/interpreter-save.test.ts`：SystemHooks 预校验失败时不提交变量、不调用 restore。
- `packages/core/test/variable-store.test.ts`：变量内部先全量校验、后统一提交。
- `packages/core/test/audit-fixes.test.ts`：无阵营配置的正式游戏 idle combat 快照可恢复，同时保留非法快照拒绝。

### 3. 公共 `@surdet/host` 边界

`packages/host/src/system-router.ts` 只保留通用路由/生命周期连接；默认兵种、规则、产品文案和具体系统 adapter 已移至：

- `examples/starter/src/system-adapters.ts`
- `examples/zero-after-midnight/src/system-adapters.ts`

公共 host 源码禁用词/硬编码扫描无命中。按任务书规定的 `Get-Content(...).Count`，两个入口当前行数为 starter `1179`、正式游戏 `1238`，合计 `2417`；相对基线 `2727` 减少 `310` 行，比 `2377` 上限多 40 行。原报告的 `1148/1207/2355/-372` 使用了排除空行的口径，现已纠正。总经理已批准这 40 行安全边界例外；不再通过压缩代码或移动游戏规则追逐指标。starter、正式游戏和 CLI 模板均完成 typecheck/lint/build/simulation 验证。

### 4. 真实 Vite `.gal` HMR

新增静态可分析的 scene boundary 模块，主入口不再使用运行时动态 `import.meta.hot.accept(Object.keys(sceneFiles), ...)`。真实 Vite 浏览器集成测试验证：

- 有效 `.gal` 修改能替换场景，不整页刷新、不重建长生命周期资源，活动 PC 被限制到合法范围；
- 语法错误保留旧场景、旧 hash 和旧资源，并输出诊断；
- 重复更新不增加 PixiStage、AudioManager、FrameScheduler 或 Blob URL。

测试文件：`examples/starter/test/vite-scene-hmr.test.ts`。纯决策测试位于 `packages/renderer/test/scene-hot-reload.test.ts`。这两类测试与 shell E2E、正式 EXE 启动验收分别记录，未把 transform/build 通过当作 HMR 通过。

rollback generation 的直接证据不是 HMR 测试，而是 `examples/starter/test/rollback-runtime.test.ts` 的：

- `invalidates a queued text checkpoint when a system boundary clears rollback`；
- `captures new checkpoints after the boundary generation advances`。

HMR 证据仅归属于 `examples/starter/test/vite-scene-hmr.test.ts`。

## 门禁与测试证据

以下是本轮 Task 5 完成后的最终门禁快照；所有源码修正、定向测试、标准门禁、正式打包和隔离 EXE 验收均已完成：

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | PASS；core、renderer、host build/typecheck 及各 workspace typecheck 均通过 |
| `npm test` | PASS；CLI 86、core 298、editor 133、host 18、renderer 196、shell 32、starter 3（rollback 2 + HMR 1），共 766 项测试通过；正式游戏 verify-simulation 通过 |
| `npm run docs:capabilities:check` | PASS |
| `npm run verify:hygiene` | PASS；424 tracked paths（本次新增文件已纳入暂存区后的最终口径） |
| `npm run lint -w surdet-starter` | PASS；4 场景，0 错误，0 警告 |
| `npm run verify:formal` | PASS；11 场景、24 paths、23/23 choices、39 save/load、3 endings、0 runtime errors、44 assets |
| `npm run verify:p1p2` | PASS；含 typecheck、全 workspace tests、正式模拟、编辑器/starter/formal build 与 diff 检查 |
| `npm run e2e -w @surdet/shell` | PASS；starter 画布、剧情、F5/F9、system/ending 引导回归通过；steps=55、choices=41 |
| `npm run pack -w @surdet/shell` | PASS；正式 `release` 包完成 preflight、portable 和 NSIS 构建，并内置 artifact 校验 |
| `node packages/shell/scripts/verify-pack.mjs --artifact` | PASS；app.asar 关键文件、身份和素材校验通过 |
| `git diff --check` | PASS；仅有 Windows 行尾转换 warning，无 whitespace error |

本轮定向门禁也全部通过：`@surdet/host` 的 `system-router.test.ts` 为 6 项，`@surdet/core` 的 `variable-store.test.ts`、`interpreter-save.test.ts`、`audit-fixes.test.ts` 合计 53 项，starter 的 `rollback-runtime.test.ts` 与真实 Vite HMR 合计 3 项。

正式游戏无头验收的固定数字为：入口 `prologue`，11 场景，24 条路径，23/23 choice 覆盖，39 次 save/load，`testimony_end`/`meeting_end`/`silence_end` 三类结局，运行时错误 0。

## 正式包与隔离 EXE

使用显式正式目标重新打包：

```powershell
$env:SURDET_GAME_DIR = (Resolve-Path 'examples/zero-after-midnight').Path
$env:SURDET_PACK_MODE = 'release'
Remove-Item Env:SURDET_ENCRYPT -ErrorAction SilentlyContinue
$env:SURDET_EXPECTED_GAME = 'zero-after-midnight'
$env:SURDET_EXPECTED_ENTRY = 'prologue'
npm run pack -w @surdet/shell
node packages/shell/scripts/verify-pack.mjs --artifact
```

结果：`mode=release`、`encrypted=true`、game=`zero-after-midnight`、title=`零点之后`、version=`0.1.0`、entryScene=`prologue`；staging 记录 50 个加密素材，发行产物位于 `E:\surdet\packages\shell\release\`。

随后使用新建临时 `--user-data-dir` 启动 `E:\surdet\packages\shell\release\win-unpacked\Surdet Game.exe`。最终隔离验收结果：48/48 素材加载、failed=0、画布存在、body/title/ui 三个字体角色成功、活动 Blob URL 48、普通文本回退有效、system probe 返回 `opened=true, hadRollback=true, rollbackBlocked=true`、F5/F9 成功、Profile/settings 写入均在临时 userData、页面错误 0、控制台错误 0。临时目录仅在验证其绝对路径位于本次临时根目录后删除。

这次隔离验收过程中曾真实暴露两个问题：正式游戏空 combat idle 快照被误拒，以及异步检查点跨 system 边界重新写入。两项均已修复，并在上述全量门禁和最终 EXE 验收中重新通过；没有通过放宽测试阈值掩盖。

## 精确工作树统计

以下统计是在正式包、隔离 EXE 验收完成后、计划勾选和报告同步前取得的最终工作树快照；报告本身未跟踪，因此不计入 `git diff` 的 tracked 修改统计：

- tracked modified：49 个文件，`+1948 / -1004` 行；
- untracked：59 个路径，其中排除内部文件 `USER.md`、`SESSION-HANDOFF.md` 后为 57 个交付路径；
- HEAD：`3ecd43a0ad5829b0253141e9a5bd42db061ff1e4`；branch：`main`；与 `surdet/main` 分歧 `0/0`；
- untracked 交付/实现路径包括 `packages/host/`、`examples/shared/`、starter/formal 的 `system-adapters.ts` 与 `scene-hmr-boundary.ts`、`examples/starter/test/`、renderer 的资源/回退/HMR/转场测试模块、CLI stats、core project-stats、shell profile-store、`scripts/check-repo-hygiene.mjs`、`scripts/render-capability-matrix.mjs`、能力矩阵文档、归档文档及两份 Wave 1 计划/报告；
- `USER.md`、`SESSION-HANDOFF.md` 为内部记忆文件，明确不纳入本轮交付范围；
- release/dist/pack-stage 等既有生成物未被清理，避免扩大变更范围。

## 计划与后续状态

本次整改计划的 Task 0→5 已完成并逐项勾选；Task 5 的标准门禁、四项定向验收、正式包、隔离 EXE、报告和精确统计均有记录。原 Wave 1 计划仅将有本轮证据的 Task 13 Step 1→5 勾选为完成；历史交付报告已改为指向本报告，不再使用“Task 0→13 全部完成”的绝对表述。

等待总经理复审前，本工作树保持未提交、未推送状态。
