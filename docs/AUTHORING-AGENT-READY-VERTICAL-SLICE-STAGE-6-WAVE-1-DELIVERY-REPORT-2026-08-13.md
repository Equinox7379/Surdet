# Surdet Agent-Ready Authoring Vertical Slice — Stage 6 Wave 1 交付报告

日期：2026-08-14（Asia/Shanghai）

本报告记录 Stage 6 Wave 1 Task 8 的正式聚合结果、Task 8 Step 8 的人工入口准备，以及 Task 9 的最终验证结果。它不代替项目所有者的 Chrome/Edge 人工验收，也不修改长期路线台账。

## 结论先行

- Task 8 的唯一 FORMAL 聚合已在 runner 提交后运行一次并通过：artifact `status=PASSED`，`evidenceClass=FORMAL`，`runHead` 与本轮代码证据 HEAD 完全一致。
- 正式 A/B editor preview 路径均到达真实 `preview.html`，使用真实键盘与真实鼠标输入，记录了不同的可见后续台词、`trust=1/-1`、两条 preview trace、`choiceCoverage=2/2` 和 `stateOutcomes=[-1,1]`。正式 runner 在写入 PASSED 前实际断言了 Core runtime trace、基础演出 `coreEmitted=true` 以及同一演出的 `presentationApplied=true`。
- Task 9 Step 1 的六个工作区测试和 Step 2 的 14 个 typecheck/build 子命令均返回 exit `0`。
- Task 9 Step 3 的首次 `npm run verify:all` 已按原任务书只运行一次，但 exit `1`，首个失败节点为 `verify:types` 中 `examples/starter` 的 save bridge 类型不一致；本次授权收口只补齐了 Starter 类型声明后重新运行一次 `verify:all`，没有重跑挑绿或放宽门禁。
- Starter 类型声明收口后的那次历史 `npm run verify:all` 已通过 `verify:types`、`verify:tests` 和 `verify:starter-lint`，但 exit `1`，首个失败节点为 `verify:starter-simulate`：`examples/starter/content/scenario/ch02.gal:14:1` 的 `@exp` 需要宿主注入 `GrowthSystem`。该历史结果不是类型声明修正的直接症状，已在本报告后续的共享模拟修复记录中闭合。
- 本轮获批的共享 authoring 模拟回退已恢复 `growth.json` 快照接线、Core `GrowthSystem` 注入和 CLI Node 文件适配；authoring/CLI 聚焦合同、typecheck/build、Starter simulate、必要前置门禁和唯一一次新的 `npm run verify:all` 均通过。Starter 内容、Core、Renderer、Host、Shell、editor、Zero 和 FORMAL/DIAGNOSTIC 聚合均未被修改或重跑。
- Task 8 FORMAL runner 的正式 preview 入口固定为 `http://127.0.0.1:4173/preview.html`；它只证明正式 preview，不是完整编辑器人工验收入口。当前 4173 服务未停止或重启，根地址 `http://127.0.0.1:4173/` 返回 HTTP `200`、标题为 `Surdet 剧本编辑器`，`/preview.html` 返回 HTTP `200`、标题为 `Surdet 预览`。项目所有者执行 16 步人工验收时必须在 Chrome/Edge 打开根地址 `/`，人工验收仍为 `HUMAN_ACCEPTANCE_NOT_STARTED`，没有自动填写视觉、操作或手感结论。

最终状态：

```text
STAGE_6_WAVE_1_IMPLEMENTED_LOCALLY
FORMAL_AGGREGATE_PASSED
STARTER_SAVE_BRIDGE_DECLARATION_ALIGNED
STAGE_6_SHARED_GROWTH_SIMULATION_RESTORED
STARTER_SIMULATE_PASSED
TASK_9_VERIFY_ALL_PASSED
FORMAL_AGGREGATE_REMAINS_VALID
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED
STAGE_6_WAVE_2_NOT_STARTED
```

## 9. 因果桥人工红灯修复与项目所有者最终复测（2026-08-14）

本报告前文的 `HUMAN_ACCEPTANCE_NOT_STARTED` 与后续 GrowthSystem 收口停止状态属于当时的历史事实，已由本节的新鲜人工结果 supersede；不得再把它们解释为当前状态。

项目所有者首次执行 16 步人工路径时，打开项目、双场景、无 UUID 噪声、A/B 不同可见文本、保存前真实预览、保存及刷新重开均通过，但发现两项真实因果桥红灯：路径 A/B 只显示内部 objectRef，没有可读“当前对象”与 `trust + path_a/path_b` 直接关系；点击任意因果轨迹事件也不会返回块编辑定位。

最小修复提交 `dd54667a6f6024e98979417f388aa6c2180d7e3a fix(editor): restore causal authoring bridge` 完成了三项对症修正：共享 authoring object-index 复用 Core 内联指令解析来提取 choice effects 与跳转；editor 因果区显示可读当前对象、位置和直接引用；preview/main 使用同一 `window` 事件桥完成轨迹反向选择。与症状匹配的红灯、authoring/editor 聚焦测试、两个工作区 typecheck/build和桌面 fixture 只读索引均已通过；没有重跑 FORMAL、`verify:all`、Electron、性能、pack、部署或发行。文档闭合提交为 `3da114754c37e83e624649e2391c7f03acc12e0f docs(editor): close causal bridge ledger`。

项目所有者随后只复测原失败点并明确反馈“非常顺利”。当前人工事实为：

- 可读“当前对象”显示正常；
- 路径 A 显示 `trust + path_a`，路径 B 显示 `trust + path_b`；
- 点击因果轨迹事件能够返回块编辑并定位对应对象；
- 此前已通过的 A/B 真实预览、手工编辑、保存和刷新重开继续有效。

据此，Stage 6 Wave 1 项目所有者人工验收通过。该结论不等于授权普通 push，也不等于批准 Stage 6 Wave 2。因额度即将耗尽，项目所有者决定由 DeepSeek V4 临时总经理与临时执行 AI 接班，最长六天；临时总经理应先独立复审本节、两笔提交和真实 Git，再向项目所有者提出下一步。

当前真实 Git 身份（写入本节前的提交状态）：

```text
branch=main
HEAD=3da114754c37e83e624649e2391c7f03acc12e0f
surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01
ahead/behind=36 0
push=未执行
```

最终停止状态更新为：

```text
STAGE_6_WAVE_1_HUMAN_ACCEPTANCE_PASSED_BY_OWNER
CAUSAL_BRIDGE_HUMAN_RETEST_PASSED
READY_FOR_TEMPORARY_MANAGER_INDEPENDENT_REVIEW
NOT_PUSHED
STAGE_6_WAVE_2_NOT_AUTHORIZED
```

## 10. 已验收基线普通 push（2026-08-14）

项目所有者明确要求先 push，以便临时 DeepSeek V4 团队在施工期间拥有稳定回退锚点。推送前已重新抓取 `surdet/main` 并确认远端没有新提交；实际只执行一次普通命令：

```text
git push surdet main:main
```

远端返回：

```text
5994ec7..3da1147  main -> main
```

随后从远端只读复核：

```text
git ls-remote surdet refs/heads/main
3da114754c37e83e624649e2391c7f03acc12e0f  refs/heads/main
```

当前本地 `HEAD`、本地 `surdet/main` 与远端 `refs/heads/main` 均为 `3da114754c37e83e624649e2391c7f03acc12e0f`，ahead/behind=`0 0`。本次 push 只包含已经提交的历史，没有包含未提交的 Stage 6 最终闭合文档、长期路线台账、临时交接书、受保护文件、`.learnings/` 或 `.dsh` 临时附件；没有部署、打包、发行或进入 Wave 2。

当前最终状态：

```text
STAGE_6_WAVE_1_HUMAN_ACCEPTANCE_PASSED_BY_OWNER
CAUSAL_BRIDGE_HUMAN_RETEST_PASSED
PUSH_COMPLETED_FOR_VERIFIED_BASELINE
REMOTE_MAIN_AT_3DA1147
LOCAL_REMOTE_SYNCED
STAGE_6_WAVE_2_NOT_AUTHORIZED
```

## 11. 项目所有者人工验收与因果桥最小修复（2026-08-14 03:01–03:14）

项目所有者使用真实 Chrome/Edge、编辑器根地址和桌面隔离 fixture 完成了 Stage 6 Wave 1 人工路径。项目打开、双场景、`.gal` 无持久 UUID 污染、真实键盘路径 A、真实鼠标路径 B、不同可见后续台词、手工编辑、未保存内存预览、保存及刷新重开均通过；保存后的 `ch01_01.gal` 为 `290` bytes、SHA-256=`C0ED835EDA4ADA19C123FFEB08E3DD9C9695C734924CC33DB9E7995AE1C761B6`，`[STAGE6-OWNER-PROBE]` 在磁盘中存在。

人工验收发现两个阻断：choice-option 因果区只显示裸 revision-scoped objectRef，没有 `trust` 与 `path_a/path_b` 直接关系；点击任意因果轨迹事件均不切回块编辑。独立根因分别为共享 object-index 只识别箭头后立即出现的 goto/jump、漏掉 choice effects，以及 preview 在 document 发事件而 main 在 window 监听。

经项目所有者授权，本轮最小修复：

- `@surdet/authoring` object-index 复用 Core `parseInlineInstructions`，从真实 choice option 同时索引变量 effect 与最终 goto/jump；
- editor 因果区新增“当前对象”、人类可读标题、来源行和可读直接引用，objectRef 降为次要身份信息；
- preview 与 main 共用唯一轨迹选择事件桥，不再分别绑定 document/window；
- 新增 authoring choice relationships 及 editor 事件桥/人类说明聚焦合同。

真实红灯：authoring object-index 新断言得到 `references=[]`；editor 事件桥和可读说明函数不存在，两条测试失败。修复后聚焦验证为：authoring 3 files / 6 tests、editor 3 files / 7 tests 全部通过；两个工作区 typecheck/build 均 exit=`0`。使用修复后共享 dist 对真实桌面 fixture 建索引得到路径 A `[variable:trust,label:ch01_01.path_a]`、路径 B `[variable:trust,label:ch01_01.path_b]`。新 editor build 已由保留中的 4173 服务提供，根页面 HTTP `200`、标题“Surdet 剧本编辑器”、bundle=`assets/main-CsqBD9ql.js`。

本轮没有重跑 FORMAL/DIAGNOSTIC、`verify:all`、Electron 或性能矩阵；既有 FORMAL 与此前通过的人工作者路径仍有效。当前不宣布整轮人工验收通过，只等待项目所有者复测原失败的三点：当前对象/直接关系显示、路径 A/B 的 `trust + path_*` 关系，以及点击轨迹事件切回块编辑定位对象。

```text
STAGE_6_CAUSAL_BRIDGE_FIX_IMPLEMENTED
FOCUSED_TESTS_TYPECHECK_BUILDS_PASSED
HUMAN_CAUSAL_BRIDGE_RETEST_PENDING
NOT_PUSHED
STAGE_6_WAVE_2_NOT_STARTED
```

### 11.1 因果桥修复提交身份

本轮因果桥修复已创建普通本地提交：

```text
dd54667a6f6024e98979417f388aa6c2180d7e3a
fix(editor): restore causal authoring bridge
```

该提交只包含本报告、当前 Stage 6 Wave 1 任务书和八个允许的 authoring/editor 源码与测试文件。提交后 `HEAD...surdet/main=35 0`，tracked 工作树干净、暂存区为空、tracked `*.log` 无输出；长期路线台账、桌面 fixture、FORMAL artifact 和受保护文件均未进入提交。没有 push。当前仍只等待项目所有者复测因果面板可读关系与轨迹反向定位。

## 10. Post-commit closure for shared simulation path evidence

本轮四个 authoring/CLI 源码与测试文件、当前 Stage 6 Wave 1 任务书和本交付报告已精确暂存并创建普通本地提交。提交后立即回读：

```text
git log --oneline -1 = 9ca3a2f fix(authoring): preserve simulation path evidence
git rev-parse HEAD = 9ca3a2f050969fe5bd02996b31dc212ac7662e4b
surdet/main = 5994ec7bd64b2106da6e47cd86e88fb4df82ed01
ahead/behind = 33 0
```

`git show --name-status HEAD` 只包含上述六个允许文件；提交后 tracked 工作树和暂存区为空，既有未跟踪治理/交接文件未触碰；`git diff --check`、`git diff --cached --check` 均 exit=`0`；`git ls-files '*.log'` 无输出。该提交没有 push。

提交后交付报告从磁盘读取为 `29750` bytes / SHA-256=`8B651D3B408C2988D724F9F99E00E1000B3E4A588E78FBD8C761648742B9F418`；既有 FORMAL artifact、Starter 文件身份和 4173 PID=`36436` 保持本节前述事实。接下来只做本报告与任务书的文档闭合提交，不重跑测试、`verify:all`、FORMAL/DIAGNOSTIC 或人工路径。

本轮最终仍不进入人工验收或 Wave 2：

```text
STAGE_6_SHARED_SIMULATION_PATH_EVIDENCE_RESTORED
STARTER_SIMULATION_PATH_COUNT_TRUSTWORTHY
TASK_9_VERIFY_ALL_PASSED
FORMAL_AGGREGATE_REMAINS_VALID
READY_FOR_INDEPENDENT_MANAGER_REVIEW
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED
STAGE_6_WAVE_2_NOT_STARTED
```

## 9. Shared simulation path evidence closure

### 9.1 复审发现与最小修正

上一轮 GrowthSystem 接线修复后，`npm run verify:all` 已通过，但项目所有者复审发现 Starter 的模拟输出仍为“探索 0 条、状态签名剪枝 7 次”，同时已有 choice 分支、存档往返和 `demo_end` 证据。这是共享 authoring 报告模型与 CLI 映射的证据一致性问题：状态签名剪枝没有失败，但 `paths.length` 不能代表实际已经进入过的路径数量。

本轮先实际运行 `npm run simulate -w surdet-starter`，exit=`0`，保留了该矛盾作为红灯证据；随后增加最小红灯后，`npm run test -w @surdet/authoring -- test/simulation.test.ts` 首次 exit=`1`，1 个文件 / 6 个测试中 3 个 `pathsExplored` 断言失败，说明公共报告字段尚不存在。没有修改 Core、GrowthSystem、Starter 内容或其他生产层。

最小修正只落在共享 authoring 模拟和 CLI 合同：

- `SimulationReport` 增加 `pathsExplored`；根路径计数为 1，每个真实 choice branch 在进入前计数；`maxPaths` 依据该计数而不是 `paths.length`，超预算时在进入分支前停止并设置 `budgetExhausted`。
- `SimulationPath` 增加明确的 `termination`；状态签名剪枝保留 `status=passed`、`termination=pruned`、`prunedReason=state-signature` 的结果，超预算保留 `termination=budget-exhausted` 的非错误结果。剪枝既不伪装为自然结束，也不写入 runtime error。
- CLI 直接使用共享报告的 `report.pathsExplored`；没有复制模拟逻辑、没有放宽断言、没有引入 fallback 或第二套状态机。

实际修改文件只有：

- `packages/authoring/src/simulation.ts`
- `packages/authoring/test/simulation.test.ts`
- `packages/cli/src/simulate.ts`
- `packages/cli/test/simulate.test.ts`

### 9.2 验证事实

聚焦验证全部通过：

- `npm run test -w @surdet/authoring -- test/simulation.test.ts`：exit=`0`，1 个文件 / 6 个测试；
- `npm run typecheck -w @surdet/authoring`：exit=`0`；`npm run build -w @surdet/authoring`：exit=`0`；
- `npm run test -w @surdet/cli -- test/simulate.test.ts`：exit=`0`，1 个文件 / 9 个测试；
- `npm run typecheck -w @surdet/cli`：exit=`0`；`npm run build -w @surdet/cli`：exit=`0`。

修正后的 `npm run simulate -w surdet-starter` exit=`0`，实际输出为：

```text
路径：探索 13 条（预算 500）；状态签名剪枝 7 次循环
choice 分支覆盖：2/3
存档往返冒烟：25 次 save/load
结局可达：demo_end（12 次）
运行时错误：0 ✓
```

这里的 `探索 13 条` 来自共享 `pathsExplored=13`，不是从 `paths.length` 推断；CLI 测试同时将 CLI 结果与同一快照直接调用 `simulateSnapshot` 的 `pathsExplored` 对比。循环测试确认 `cyclesPruned>0`、出口 `demo_end` 可达、`runtimeErrors=[]`，并能区分 state-signature prune 与自然 ended；预算测试确认根路径/分支计数不超过 `maxPaths`、状态为 incomplete、`budgetExhausted=true`。

随后只运行一次 `npm run verify:all`，实际 exit=`0`。全量工具、边界/legacy、文档、hygiene、workspace typecheck/build、tests、Starter lint/simulate 和 diff-check 均通过。本轮没有重新运行 FORMAL/DIAGNOSTIC 聚合、没有运行 Electron 矩阵、性能资格化、pack、部署或发行。

### 9.3 证据边界与最终停止点

既有 FORMAL artifact 只读复核且身份保持不变，未重跑、未覆盖：

```text
path=C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-EdIstQ\agent-ready-authoring-wave-1.json
bytes=7591
sha256=77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0
status=PASSED
evidenceClass=FORMAL
runHead=b9d9703e1c442cb927b59fd53026638a4345680d
```

`git diff --quiet -- examples/starter` exit=`0`；Starter 内容、配置、资产和类型声明均未修改。4173 preview server 仍由 PID=`36436` 监听，本轮没有停止或重启。人工验收仍未开始，执行 AI 没有代替项目所有者填写视觉、声音、操作或手感结论。

本轮没有修改 GrowthSystem 接线、Core、Renderer、Host、Shell、editor、Zero、Starter、Task 8 runner、长期路线台账、artifact、fixture 或受保护文件；没有 push、部署、打包、发行或进入 Wave 2。下一步是完成本轮代码证据与文档的本地普通提交，随后等待总经理独立复审。

```text
STAGE_6_SHARED_SIMULATION_PATH_EVIDENCE_RESTORED
STARTER_SIMULATION_PATH_COUNT_TRUSTWORTHY
TASK_9_VERIFY_ALL_PASSED
FORMAL_AGGREGATE_REMAINS_VALID
READY_FOR_INDEPENDENT_MANAGER_REVIEW
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED
STAGE_6_WAVE_2_NOT_STARTED
```

### Post-commit closure for the shared simulation fix

本轮第一笔修复提交已按精确暂存范围创建并立即回读：

```text
git log --oneline -1 = d8b20de fix(authoring): preserve growth simulation semantics
git rev-parse HEAD = d8b20de25d190edcd2c246254bce288a942d888e
surdet/main = 5994ec7bd64b2106da6e47cd86e88fb4df82ed01
ahead/behind = 31 0
```

`git show --name-status HEAD` 只有本报告第 8 节列出的 7 个 authoring/CLI 源码与测试文件，以及本任务书和本报告；没有夹带长期路线台账、AGENTS、受保护文件、handoff、fixture、artifact、日志或构建产物。提交后 tracked 工作树和暂存区均为空，既有未跟踪治理文件保持原样；`git diff --check`、`git diff --cached --check` 均 exit `0`，`git ls-files '*.log'` 无输出。

这笔本地提交没有 push。4173 listener PID `36436` 仍保留供项目所有者后续人工验收准备；没有重新运行 FORMAL/DIAGNOSTIC 聚合，也没有邀请或代替项目所有者验收。最终仍停止在：`READY_FOR_INDEPENDENT_MANAGER_REVIEW` / `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。

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

- artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-a6ctio\agent-ready-authoring-wave-1.json`
- bytes：`7130`
- SHA-256：`68D58D5E9682834F2F5CE3172F77BEB0CCEE347A32FEE091044132BDF2F9E0CC`
- `evidenceClass=DIAGNOSTIC`，`runHead=01def6d4f2d508eb452bb1ecb1a5866a8bc5eaeb`
- fixture：`C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786640713447-fe0b5a128914`
- 最后通过节点：`editor.preview.server`
- 首个失败节点：`editor.preview.renderer.paths.A-B`
- 真实原因：选择后公开 Renderer 已进入 `awaiting`，runner 在发送下一次真实输入前等待 `surdet-preview-trace-complete`，因等待顺序不匹配而超时。
- 清理：browser 已关闭，Vite child exit/close 已观察，4173/4174 均释放。

### Diagnostic 2

- artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-Vys8rr\agent-ready-authoring-wave-1.json`
- bytes：`7127`
- SHA-256：`3F187E335E358A086F8015DD52463C5C2737086D31BC59F13853EF32465D36A9`
- `evidenceClass=DIAGNOSTIC`，`runHead=01def6d4f2d508eb452bb1ecb1a5866a8bc5eaeb`
- fixture：`C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786640865132-261cd588cb81`
- 最后通过节点：`editor.preview.server`
- 首个失败节点：`editor.preview.renderer.paths.A-B`
- 真实原因：A 分支没有 `presentationApplied=true`。只读检查确认 runner fixture 没有改变公开 Presentation snapshot；随后仅在 runner fixture 构造中加入 Starter 已有的 `@bg night_field` 指令。
- 清理：browser、Vite child 和 4173/4174 均已清理。

### Diagnostic 3 — 全绿

- artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-a8cFUu\agent-ready-authoring-wave-1.json`
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

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-EdIstQ\agent-ready-authoring-wave-1.json`
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
C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786641370693-4e4e09d75522
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
- 使用的 fixture：`C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786641370693-4e4e09d75522`。

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

### Step 3：一次 verify:all（Starter 收口历史结果）

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

### Step 3A：共享 GrowthSystem 回退后的唯一最终门禁

本轮授权的唯一主题是恢复 Stage 6 共享 authoring 模拟运行时丢失的 Starter `GrowthSystem` 接线。实现没有新增第二套模拟器：

- `packages/authoring/src/project-storage.ts` 现在把 `content/config/growth.json` 纳入快照路径；
- `packages/authoring/src/project-snapshot.ts` 把该文件纳入 `files` 与 `revision`，并为已加载快照提供 `growthFile` / `growthConfig`；
- `packages/authoring/src/simulation.ts` 在共享 `runtimeFor` 中按快照配置创建 Core `GrowthSystem`，再注入 `Interpreter`；`simulateSnapshot` 与 `runExplicitPath` 共用这一运行时；没有配置时仍严格保留 `@exp` 缺少 `GrowthSystem` 的错误；
- `packages/cli/src/simulate.ts` 只读取 Node 项目中的 `growth.json` 并传给共享快照，没有复制 GrowthSystem 或 DFS 模拟逻辑；
- 测试只覆盖 authoring/CLI 的共享合同，未修改 Starter 内容或任何 Core 生产实现。

本轮实际命令与结果：

- `npm run test -w @surdet/authoring -- test/project-snapshot.test.ts test/simulation.test.ts`：exit `0`，2 个文件 / 7 个测试通过；
- `npm run test -w @surdet/cli -- test/simulate.test.ts`：在刷新本地 authoring dist 前首次运行因 stale workspace dist 读到旧共享实现而 exit `1`；随后 `npm run build -w @surdet/authoring` exit `0`，同一 CLI 聚焦测试重新运行 exit `0`，1 个文件 / 8 个测试通过。该首次结果是构建接线前置问题，不是通过放宽断言获得的业务绿灯；
- `npm run typecheck -w @surdet/authoring`：exit `0`；`npm run build -w @surdet/authoring`：exit `0`；`npm run typecheck -w @surdet/cli`：exit `0`；`npm run build -w @surdet/cli`：exit `0`；
- `npm run simulate -w surdet-starter`：exit `0`；Starter 4 场景加载，运行时错误 `0`。本命令未修改 Starter 内容；
- `npm run verify:formal`：exit `0`；`npm run build -w surdet-editor`、`npm run build -w surdet-starter`、`npm run build -w zero-after-midnight`：均 exit `0`；`git diff --check`：exit `0`；
- 本轮唯一一次新的 `npm run verify:all`：exit `0`。`verify:tools`、Renderer boundaries/legacy、docs、hygiene、types、tests、Starter lint/simulate 以及其余工作区门禁全部通过。没有运行 FORMAL/DIAGNOSTIC 聚合、Electron 矩阵、性能资格化、pack、部署或发行。

本轮唯一允许的源代码/测试修改文件为：

- `packages/authoring/src/project-storage.ts`
- `packages/authoring/src/project-snapshot.ts`
- `packages/authoring/src/simulation.ts`
- `packages/authoring/test/project-snapshot.test.ts`
- `packages/authoring/test/simulation.test.ts`
- `packages/cli/src/simulate.ts`
- `packages/cli/test/simulate.test.ts`

Starter 未修改事实：`git diff --quiet -- examples/starter` exit `0`；当前 Starter 的 `content/config/growth.json` 与 `content/scenario/ch02.gal` 均保持仓库版本。既有 FORMAL artifact 身份未变：

- `C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-EdIstQ\agent-ready-authoring-wave-1.json`
- `status=PASSED`、`evidenceClass=FORMAL`、`runHead=b9d9703e1c442cb927b59fd53026638a4345680d`
- `bytes=7591`、SHA-256=`77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0`

本轮未重新运行该 FORMAL artifact 对应的聚合，也未修改任何旧失败 artifact、诊断 artifact、桌面 fixture 或项目所有者文件。

## 7. Git 与停止点（Starter 收口历史记录）

本次文档提交前回读的真实 Git 基线：

```text
branch=main
HEAD=b88d45a2b8af0d59bd79a5de82983de04cd710d0
surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01
ahead/behind=29 0
```

本轮代码证据提交未 push；诊断稳定化提交没有夹带 fixture、artifact、日志、构建产物、长期路线台账或受保护文件。本次文档收口提交只允许包含 Starter 类型声明、本报告和当前 Stage 6 Wave 1 任务书；桌面 fixture、FORMAL artifact、诊断 artifact 和历史 FAILED artifact 均不进入 Git。当前没有 push、部署、打包、发行或人工验收。

上一轮 Starter 声明收口完成时的未解决问题：

- Starter save bridge 类型声明已对齐，`npm run typecheck -w surdet-starter` 已通过；但新的唯一 `verify:all` 运行在 `verify:starter-simulate` 因 `ch02.gal` 的 `@exp` 宿主 `GrowthSystem` 缺失而失败，不能宣称 Task 9 全仓验证通过；
- 项目所有者尚未进行 Chrome/Edge 人工验收；
- 本地 4173 preview server 为人工入口准备而保留，根地址是人工验收入口，`/preview.html` 仅是 FORMAL preview 入口，不能写成部署或发行；
- 不进入 Wave 2，不开始扩展市场、MCP、内置 AI、音频、性能、美术、Gallery 或发行工作。

建议由总经理登记的历史事实：FORMAL editor preview A/B 聚合已经通过且既有 artifact 身份保持不变；Starter save bridge 声明已在允许范围内对齐，Starter typecheck 已通过，但当时唯一的 `verify:all` 运行在 `verify:starter-simulate` 因 `ch02.gal` 的 `@exp` 宿主注入问题失败。该问题已由本报告第 3A 节记录的共享 authoring 修复闭合。

```text
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
STAGE_6_WAVE_2_NOT_STARTED
```

## 8. 本轮共享 GrowthSystem 修复的真实收口

本轮代码与测试修改均在以下真实工作树基线之上完成并验证：

```text
branch=main
validation HEAD=43964488196d685c1efe31bfcd4483651b22c12c
surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01
ahead/behind=30 0
```

验证完成后、文档提交前，tracked 工作树包含且仅包含本轮七个 authoring/CLI 源码与测试文件以及本计划和本报告；暂存区为空。`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出。既有未跟踪的 AGENTS、长期路线台账、受保护文件、handoff 与 `.learnings` 文件均未触碰、未暂存。

当前 4173 listener 仍为 PID `36436`，本轮未停止、未重启；人工入口仍为 `http://127.0.0.1:4173/`，FORMAL preview 入口仍为 `http://127.0.0.1:4173/preview.html`。项目所有者人工验收状态仍为 `HUMAN_ACCEPTANCE_NOT_STARTED`，执行 AI 没有代填视觉、声音、操作或手感结论。

本轮没有重新运行 FORMAL/DIAGNOSTIC 聚合，没有修改或覆盖任何历史 artifact/fixture，没有修改 Starter 内容或 Core、Renderer、Host、Shell、editor、Zero 生产代码，没有 push、部署、打包、发行或进入 Wave 2。当前应交由总经理独立复审共享模拟接线修复、`verify:all` 唯一通过结果和未开始的人工验收。

最终停止状态：

```text
STAGE_6_SHARED_GROWTH_SIMULATION_RESTORED
STARTER_SIMULATE_PASSED
TASK_9_VERIFY_ALL_PASSED
FORMAL_AGGREGATE_REMAINS_VALID
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED
STAGE_6_WAVE_2_NOT_STARTED
```
