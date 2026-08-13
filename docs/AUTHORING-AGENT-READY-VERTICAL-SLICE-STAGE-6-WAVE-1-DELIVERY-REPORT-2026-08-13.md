# Surdet Agent-Ready Authoring Vertical Slice — Stage 6 Wave 1 交付报告

日期：2026-08-14（Asia/Shanghai）

本报告记录 Stage 6 Wave 1 Task 8 的正式聚合结果、Task 8 Step 8 的人工入口准备，以及 Task 9 的最终验证结果。它不代替项目所有者的 Chrome/Edge 人工验收，也不修改长期路线台账。

## 结论先行

- Task 8 的唯一 FORMAL 聚合已在 runner 提交后运行一次并通过：artifact `status=PASSED`，`evidenceClass=FORMAL`，`runHead` 与本轮代码证据 HEAD 完全一致。
- 正式 A/B editor preview 路径均到达真实 `preview.html`，使用真实键盘与真实鼠标输入，记录了不同的可见后续台词、`trust=1/-1`、两条 preview trace、`choiceCoverage=2/2` 和 `stateOutcomes=[-1,1]`。正式 runner 在写入 PASSED 前实际断言了 Core runtime trace、基础演出 `coreEmitted=true` 以及同一演出的 `presentationApplied=true`。
- Task 9 Step 1 的六个工作区测试和 Step 2 的 14 个 typecheck/build 子命令均返回 exit `0`。
- Task 9 Step 3 的首次 `npm run verify:all` 已按原任务书只运行一次，但 exit `1`，首个失败节点为 `verify:types` 中 `examples/starter` 的 save bridge 类型不一致；本次授权收口只补齐了 Starter 类型声明后重新运行一次 `verify:all`，没有重跑挑绿或放宽门禁。
- 本次重新运行的 `npm run verify:all` 已通过 `verify:types`、`verify:tests` 和 `verify:starter-lint`，但 exit `1`，首个失败节点变为 `verify:starter-simulate`：`examples/starter/content/scenario/ch02.gal:14:1` 的 `@exp` 需要宿主注入 `GrowthSystem`。因此 Task 9 全仓门禁仍不能写成通过；该失败不是本次类型声明修正的直接症状，本轮不扩大修复范围。
- Task 8 FORMAL runner 的正式 preview 入口固定为 `http://127.0.0.1:4173/preview.html`；它只证明正式 preview，不是完整编辑器人工验收入口。当前 4173 服务未停止或重启，根地址 `http://127.0.0.1:4173/` 返回 HTTP `200`、标题为 `Surdet 剧本编辑器`，`/preview.html` 返回 HTTP `200`、标题为 `Surdet 预览`。项目所有者执行 16 步人工验收时必须在 Chrome/Edge 打开根地址 `/`，人工验收仍为 `HUMAN_ACCEPTANCE_NOT_STARTED`，没有自动填写视觉、操作或手感结论。

最终状态：

```text
STAGE_6_WAVE_1_IMPLEMENTED_LOCALLY
FORMAL_AGGREGATE_PASSED
STARTER_SAVE_BRIDGE_DECLARATION_ALIGNED
TASK_9_VERIFY_ALL_FAILED_AT_STARTER_SIMULATE
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED
STAGE_6_WAVE_2_NOT_STARTED
```

## 1. 本轮范围与实际修改

此前有界 harness 稳定化只修改了：

- `packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`
- `docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md`

runner 内的最小修正包括：

- 正式 editor Vite launcher 明确使用 `packages/editor` 作为 cwd，并在启动前确认 `packages/editor/dist/preview.html` 存在；
- `--preview-harness-self-check` 复用同一个正式 Vite launcher、editor cwd 和 `dist/preview.html`，不再使用替身静态 server；
- 对正式 preview iframe 使用条件等待，覆盖 attached、content frame、`/preview.html`、canvas 和 `surdet-preview-ready`；
- 选择后先沿用公开 `awaiting` 状态和真实输入路径推进下一段，再等待 trace complete；
- 记录 browser、Vite child、端口和成功/失败清理事实；
- 增加 `--diagnostic` 证据类别，并让诊断 artifact 写入 `evidenceClass=DIAGNOSTIC`；
- runner 构造的隔离场景加入 Starter 已有的 `night_field` 公开演出指令，使 Presentation snapshot 有真实变化；没有修改生产逻辑、剧情、Starter 原始文件或存档格式。

此前稳定化没有修改 Core、Renderer、Host、editor 生产代码、authoring、CLI、Zero 或 Starter。随后本次批准的最小收口只追加修改：

- `examples/starter/src/surdet-window.d.ts`
- 本任务书
- 本交付报告

Starter 本次只增加 `window.surdetSave` 的两个已有桥接方法类型声明；没有修改 Starter 的 `main.ts`、内容、配置、资产或运行时实现，也没有修改 Core、Renderer、Host、Shell runtime、editor 生产代码、authoring、CLI、Zero、长期路线台账、受保护文件、音频、性能或发行文件。

## 2. DIAGNOSTIC 证据

本轮共运行三次完整 DIAGNOSTIC 聚合，未达到五次上限；前两次的失败原因不同，第三次全绿。所有 fixture 和 artifact 都是新的，失败证据均保留。

### Diagnostic 1

- artifact：`<local-path>`
- bytes：`7130`
- SHA-256：`68D58D5E9682834F2F5CE3172F77BEB0CCEE347A32FEE091044132BDF2F9E0CC`
- `evidenceClass=DIAGNOSTIC`，`runHead=01def6d4f2d508eb452bb1ecb1a5866a8bc5eaeb`
- fixture：`<local-path>`
- 最后通过节点：`editor.preview.server`
- 首个失败节点：`editor.preview.renderer.paths.A-B`
- 真实原因：选择后公开 Renderer 已进入 `awaiting`，runner 在发送下一次真实输入前等待 `surdet-preview-trace-complete`，因等待顺序不匹配而超时。
- 清理：browser 已关闭，Vite child exit/close 已观察，4173/4174 均释放。

### Diagnostic 2

- artifact：`<local-path>`
- bytes：`7127`
- SHA-256：`3F187E335E358A086F8015DD52463C5C2737086D31BC59F13853EF32465D36A9`
- `evidenceClass=DIAGNOSTIC`，`runHead=01def6d4f2d508eb452bb1ecb1a5866a8bc5eaeb`
- fixture：`<local-path>`
- 最后通过节点：`editor.preview.server`
- 首个失败节点：`editor.preview.renderer.paths.A-B`
- 真实原因：A 分支没有 `presentationApplied=true`。只读检查确认 runner fixture 没有改变公开 Presentation snapshot；随后仅在 runner fixture 构造中加入 Starter 已有的 `@bg night_field` 指令。
- 清理：browser、Vite child 和 4173/4174 均已清理。

### Diagnostic 3 — 全绿

- artifact：`<local-path>`
- bytes：`7592`
- SHA-256：`68E53EF08185CEE9F4C1E9195B45C63DBCB8195ADD0C08DEB539A52DAE20642A`
- `status=PASSED`，`evidenceClass=DIAGNOSTIC`
- `runHead=01def6d4f2d508eb452bb1ecb1a5866a8bc5eaeb`
- `redEvidenceId=validation_1786640948916_987d6bef-5840-49e7-9e14-7bfb0627be5d`
- `greenEvidenceId=validation_1786640949529_9efcc703-bd53-42e2-8f0e-eb61da11496e`
- CLI traceIds：`trace_1786640949881_21895d84-9d58-4d35-a542-506314becd5e`、`trace_1786640950048_fcb170d9-684d-4b0b-8e51-0015c2c90942`
- preview traceIds：`preview-1786640951987-5978602b-8ba4-4b5b-a749-c55068dbba1f`、`preview-1786640952459-98e08d8f-c416-4e2b-ba90-c5108f88a8dd`
- `choiceCoverage=2/2`，`stateOutcomes=[-1,1]`
- 4173/4174 无监听，browser、Vite child 和 Playwright Chromium 无残留。

诊断绿灯后实际通过的聚焦检查：

- `node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，exit `0`；
- `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --preview-harness-self-check`，exit `0`；
- `npm run build -w surdet-editor`，exit `0`；
- 三个 preview contract test 文件共 4 个测试，全部通过；
- `npm run typecheck -w surdet-editor`，exit `0`；
- `git diff --check`，exit `0`。

## 3. FORMAL 聚合证据

提交诊断稳定化 runner 后，重新读取的代码证据 HEAD 为：

```text
CODE_EVIDENCE_HEAD=b9d9703e1c442cb927b59fd53026638a4345680d
commit=b9d9703 test(authoring): stabilize preview diagnostic harness
```

该提交的 `git show --name-status HEAD` 只有：

```text
M docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md
M packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs
```

默认正式命令只运行一次：

```text
node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs
```

正式 artifact 已从磁盘重新读取：

- 路径：`<local-path>`
- bytes：`7591`
- SHA-256：`77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0`
- `status=PASSED`
- `evidenceClass=FORMAL`
- `runHead=b9d9703e1c442cb927b59fd53026638a4345680d`
- `projectRevision=43dead89a25afb8134db105ebf2f11b8523aca2b9c4c69f53ef05e7d22f1a39c`
- `changeId=chg_0001`
- `workingRevision=0`
- `redEvidenceId=validation_1786641372228_70db929f-3567-409d-9571-fe9c7dad2cda`
- `greenEvidenceId=validation_1786641372763_6f3bfc3a-35a5-4a31-a36e-a3dcb291e882`
- `traceIds`：`preview-1786641375189-9f24e3ca-32d8-45df-8f97-ea102cd45670`、`preview-1786641375591-79cda540-8a7a-4e49-a6e6-251bf22060d4`
- CLI `traceIds`：`trace_1786641373123_3e3e4549-644a-4170-a365-4a41ccf26f49`、`trace_1786641373284_ed70f639-5f28-437b-9f9a-0ffeb4ec0e08`
- `choiceCoverage.total=2`、`choiceCoverage.visited=2`
- `stateOutcomes=[-1,1]`

正式预览的可见路径记录为：

| 路径 | 真实输入 | 可见后续台词 | trust | preview traceId |
|---|---|---|---:|---|
| A | `real keyboard: 1` | `Agent 路径 A 后续台词。` | `1` | `preview-1786641375189-9f24e3ca-32d8-45df-8f97-ea102cd45670` |
| B | `real mouse: second choice bounds` | `Agent 路径 B 后续台词。` | `-1` | `preview-1786641375591-79cda540-8a7a-4e49-a6e6-251bf22060d4` |

这些文本是从正式 preview 的可见 Renderer 画面读取的；runner 在生成 PASSED artifact 前还断言了每条路径存在 Core runtime trace、至少一项基础演出 `coreEmitted=true`，并且同一演出的 `presentationApplied=true`。artifact 的 `preview.paths` 保留了两条可见文本、输入、trust 和对应 preview traceId，顶层保留了两条 CLI traceId。

正式 artifact 的错误通道为：

```json
{
  "pageErrors": [],
  "consoleErrors": [],
  "requestFailures": [],
  "unhandledRejections": [],
  "rendererErrors": [],
  "releaseFailures": [],
  "unexpectedWindowClosed": false
}
```

artifact 记录的成功时资源状态为：`browserClosed=true`、`previewServerRetained=true`、`harnessSelfCheckPortFree=true`。runner 进程退出后只读复核发现该 retained child 没有继续占用 4173，因此没有把“artifact 记录 retained”写成“进程仍然存活”。随后按原 Task 8 Step 8 重新启动了指定的本机 preview server，并以实际 HTTP 结果作为人工入口准备证据。

## 4. 桌面 fixture 与原始 Starter 身份

FORMAL runner 创建的新桌面 fixture：

```text
<local-path>
```

fixture tree SHA-256：`F1FAAE3691476879280FF0B5875F2DA42746A4862B6A6C2C12BBF1D2F6371973`。

关键文件从磁盘重新读取：

- `content/scenario/ch01_01.gal`：`270` bytes，SHA-256=`7F8661943B2A13D397A2D84EB848E4D36D0949A8B8C0A39220EC70036B90D794`；
- `game.config.json`：`1619` bytes，SHA-256=`BE77454A4A928C1ABC042BE531B29619667AB9F4ACE169467FDF71FB2A63F92B`；
- fixture 共 `21` 个文件，未复制 `node_modules`、`dist`、`src`、`test` 或 Git 元数据。

原始 Starter 保持未修改：

- `examples/starter/content/scenario/ch01_01.gal`：`1035` bytes，SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`，Git blob=`50b253ef3b683b4d848d7795b8142ab72fd7a690`；
- `examples/starter/game.config.json`：`1623` bytes，SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4`，Git blob=`86ad869719dbb3cfcc065ced9c637a49b3ce6179`；
- artifact `originalStarter.unchanged=true`。

## 5. Task 8 Step 8 人工入口准备

按任务书执行的命令为：

```powershell
npm run preview -w surdet-editor -- --host 127.0.0.1 --port 4173
```

实际复核结果：

- FORMAL runner URL：`http://127.0.0.1:4173/preview.html`；该入口用于正式 preview 证据，不是完整编辑器人工验收入口；
- FORMAL preview HTTP status：`200`；页面标题：`Surdet 预览`；
- 项目所有者人工入口：`http://127.0.0.1:4173/`；HTTP status：`200`；页面标题：`Surdet 剧本编辑器`；
- 实际 Vite listener PID：`36436`；
- 实际命令行指向 `E:\surdet\packages\editor\node_modules\vite\bin\vite.js preview --host 127.0.0.1 --port 4173`；
- 使用的 fixture：`<local-path>`。

这只证明本机人工入口可访问，不证明项目所有者已经完成验收。当前必须由项目所有者在 Chrome/Edge 中自行执行下列 16 步；执行 AI 不代填结果，也不要求在本报告中重复填写“通过”：

1. 在 Chrome/Edge 打开 editor 根地址 `http://127.0.0.1:4173/`（标题为 `Surdet 剧本编辑器`）；不要把 `/preview.html` 当作完整编辑器人工验收入口；
2. 选择桌面 fixture；
3. 确认两个 Agent 场景存在；
4. 确认 `.gal` 无 UUID 噪声；
5. 选择台词查看直接因果；
6. 选择选项查看变量变化与跳转；
7. 运行路径 A；
8. 点击轨迹事件反向定位对象；
9. 运行路径 B；
10. 确认不同后续文本；
11. 手工修改一句台词；
12. 预览修改；
13. 保存全部；
14. 刷新编辑器；
15. 重开同一 fixture；
16. 确认修改仍在且无脏标记。

人工状态：`HUMAN_ACCEPTANCE_NOT_STARTED`。如项目所有者遇到异常，只需提供第一个异常、触发动作、实际现象和必要截图；不要把本报告的自动化结果写成人工验收结论。

## 6. Task 9 最终验证

### Step 1：聚焦工作区测试

以下六个命令均实际运行并 exit `0`：

- `npm run test -w @surdet/core`：24 files / 317 tests passed；
- `npm run test -w @surdet/authoring`：10 / 16 passed；
- `npm run test -w @surdet/cli`：11 / 103 passed；
- `npm run test -w surdet-editor`：24 / 147 passed；
- `npm run test -w @surdet/renderer`：49 / 406 passed；
- `npm run test -w @surdet/shell`：20 / 156 passed。

### Step 2：typecheck 与 build

任务书列出的 14 个 npm 子命令均返回 exit `0`：Core、authoring、CLI、Renderer、Host、Shell、editor 各一个 typecheck 和 build。外层 PowerShell 编排器另有数组索引警告，原因是编排变量使用了 PowerShell 保留的 `$args` 名称；这些警告不来自 npm 子命令，且 14 个实际 npm exit 均为 `0`。本轮没有运行性能矩阵、pack、electron-builder、部署或发行。

### Step 3：一次 verify:all（首次结果与本次授权收口结果）

原 Task 9 首次实际只运行一次：

```text
npm run verify:all
```

首次结果：exit `1`。前置 `verify:tools`、Renderer boundaries/legacy、docs、hygiene 均通过；首个失败节点为 `verify:types` 中的 `examples/starter` typecheck：

```text
src/main.ts(394,33): error TS2345
Argument of type '{ list(); read(); write(); delete(); listMeta(); }'
is not assignable to parameter of type 'ElectronSaveBridge'.
Missing: listBackupMeta, restoreBackup
```

这是当时仓库 Starter 与 `ElectronSaveBridge` 类型的真实不一致。随后本次授权只在 `examples/starter/src/surdet-window.d.ts` 补齐 `listBackupMeta` 与 `restoreBackup`，并确认 `npm run typecheck -w surdet-starter` exit `0`；没有修改 Starter runtime、Shell 生产代码或 save bridge 实现。

本次授权收口随后只重新运行一次：

```text
npm run verify:all
```

结果仍为 exit `1`，但已越过原 `verify:types` 阻断。`verify:tools`、Renderer boundaries/legacy、docs、hygiene、`verify:types`、`verify:tests` 和 `verify:starter-lint` 均通过；最后一个通过节点为 `verify:starter-lint`，第一个失败节点为 `verify:starter-simulate`。真实输出为：

```text
examples/starter/content/scenario/ch02.gal:14:1
@exp 需要宿主注入 GrowthSystem（解释器构造参数或 setGrowth）
```

`verify:all` 按脚本在该节点停止；本轮没有重跑、没有切换 case、没有修改其它生产文件，也没有把这个 Starter 内容/宿主能力问题写成类型声明已经解决。Task 9 Step 3 仍未通过，必须等待独立复审决定是否另行授权。

## 7. Git 与停止点

本次文档提交前回读的真实 Git 基线：

```text
branch=main
HEAD=b88d45a2b8af0d59bd79a5de82983de04cd710d0
surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01
ahead/behind=29 0
```

本轮代码证据提交未 push；诊断稳定化提交没有夹带 fixture、artifact、日志、构建产物、长期路线台账或受保护文件。本次文档收口提交只允许包含 Starter 类型声明、本报告和当前 Stage 6 Wave 1 任务书；桌面 fixture、FORMAL artifact、诊断 artifact 和历史 FAILED artifact 均不进入 Git。当前没有 push、部署、打包、发行或人工验收。

未解决问题：

- Starter save bridge 类型声明已对齐，`npm run typecheck -w surdet-starter` 已通过；但新的唯一 `verify:all` 运行在 `verify:starter-simulate` 因 `ch02.gal` 的 `@exp` 宿主 `GrowthSystem` 缺失而失败，不能宣称 Task 9 全仓验证通过；
- 项目所有者尚未进行 Chrome/Edge 人工验收；
- 本地 4173 preview server 为人工入口准备而保留，根地址是人工验收入口，`/preview.html` 仅是 FORMAL preview 入口，不能写成部署或发行；
- 不进入 Wave 2，不开始扩展市场、MCP、内置 AI、音频、性能、美术、Gallery 或发行工作。

建议由总经理登记的事实：FORMAL editor preview A/B 聚合已经通过且既有 artifact 身份保持不变；Starter save bridge 声明已在允许范围内对齐，Starter typecheck 已通过，但新的唯一 `verify:all` 运行在 `verify:starter-simulate` 因 `ch02.gal` 的 `@exp` 宿主注入问题失败。当前应先独立复审 FORMAL 证据、声明修正和新的失败范围，再决定是否批准任何后续修复或人工验收。

```text
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
STAGE_6_WAVE_2_NOT_STARTED
```
