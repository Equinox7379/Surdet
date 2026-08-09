# Surdet Renderer v2 M8 交付前磁盘自检报告

日期：2026-08-10  
自检范围：M8 交付前独立磁盘、Git、源码、测试、构建产物和性能证据核验  
最终状态：WAITING_FOR_REVIEW  
发布状态：RELEASE_BLOCKED（未取得独立最终发行批准）

## 1. 结论先行

本次自检不依赖对话上下文，重新从磁盘、Git、计划文档、源码、测试输出和候选 artifact 建立事实。

结论如下：

- P0：0 项；
- P1：0 项；
- P2：1 项工具证据观察，未影响当前运行时、消费者迁移、性能 artifact 或发布包，未扩大 M8 范围修复；
- M8 代码、测试和门禁均已落盘；
- M7.5 冻结候选的 formalFailures=sceneP95Ms 仍然保留，gateRatio=1.2488932612，没有被改写为绿色；
- M7.5→M8 固定配对 A/B artifact 与最终运行时代码 SHA 一致，正式增量比较无失败；
- M0→M8 历史比较仍保留 assetReadyMs、sceneP95Ms 风险；
- 没有重新采样未修改源码，也没有提高 1.10/1.15 门限、删除异常值或覆盖 v2 冻结文件；
- 没有修改 DSL、存档格式、游戏规则、正式游戏剧本或四个受保护文件；
- 没有 push，也没有 force push；
- 本报告完成本地提交后停止，等待总经理独立复审。

本次没有发现需要修改生产源码的 P0/P1。自检只新增本报告，不对 Renderer、Starter、正式游戏、编辑器、CLI、DSL 或存档实现作改动。

## 2. 自检边界与真实 Git 起点

M8 原始授权起始 HEAD：

~~~text
007438b569ec95350fdc9d7882ad49f55bbb7968
~~~

自检开始时 HEAD：

~~~text
34d5e9af2e7e6847837d8800dfd403138a1cd31a
docs(renderer): report Wave 2 delivery
~~~

自检结束时 HEAD：

~~~text
待本报告首个本地提交完成后现场回读，并在最终元数据提交中写入
~~~

自检期间没有执行 reset、checkout、stash、clean、force push 或远端写入。所有检查均在 E:\surdet 最终工作树执行。

## 3. M8 完整提交链

以下链条由磁盘现场执行 git log --format='%H|%s' --reverse 007438b...HEAD 得到：

| 顺序 | 完整 SHA | 提交信息 |
|---:|---|---|
| 1 | ccfb110c89dafbf8270402d3eeef1e7ad40efa3f | fix(renderer): harden v3 artifact evidence |
| 2 | c91a9cf2a1ff9908f5d6d7a449a0d037ea68915a | refactor(renderer): contain legacy API adapters |
| 3 | 954119b2307afc15693b6a8e9fcf61bad1c0549f | test(renderer): audit legacy API consumers |
| 4 | a301de78371957cc0bdbda27d9e86fcfefba551e | refactor(renderer): expose v2 runtime consumer surface |
| 5 | 7d12a92f569549b5e7acf66ed56ee47a0f35dc44 | refactor(starter): adopt Renderer v2 runtime |
| 6 | cccb5fbf2541675ee6177ff73ec0dc8a546df5f6 | refactor(formal): adopt Renderer v2 runtime |
| 7 | ce1f5aac16d715d565f78d64c53f81308505ebe8 | refactor(editor): adopt Renderer v2 runtime |
| 8 | f56802465b7fcc926405af3b6b1359703988a6a7 | refactor(cli): adopt Renderer v2 template |
| 9 | 727125310ee4b44fed5152d7aae8d2291a074803 | docs(renderer): publish v2 migration guide |
| 10 | 89c69ab427d75b064c761832bd09695778e446e6 | test(shell): add Renderer v2 acceptance harness |
| 11 | 34d5e9af2e7e6847837d8800dfd403138a1cd31a | docs(renderer): report Wave 2 delivery |

M8 运行时代码点是 89c69ab427d75b064c761832bd09695778e446e6。最后的 34d5e9a 只加入交付报告和 M8 A/B artifact；自检现场确认 89c69ab..HEAD 没有任何 packages、examples、package.json 或 scripts 运行时代码差异。

## 4. M8 要求—实现—测试—证据矩阵

| 要求 | 实际实现文件 | 对应测试/命令 | 实际结果 | 报告或 artifact 证据 |
|---|---|---|---|---|
| 每个 warmup/formal raw 的资源完成状态必须完整 | packages/shell/e2e/renderer-baseline-v3-artifact.mjs | packages/shell/test/renderer-baseline-v3-artifact.test.mjs；Shell artifact test | 12/12 通过 | M8 A/B artifact；M8 交付报告 §3 |
| 恶意资源字段必须拒绝 | 同上 | completed=0、completed<total、total=0、done=false、删除 done、failed>0 六类参数化测试 | 6 类全部拒绝 | Shell artifact test 输出 12/12 |
| sampledAt 与 rebuiltAt 分离 | renderer-baseline-v3-artifact.mjs、renderer-baseline-v3-rebuild.mjs | 重建纯函数测试；Git 机械读取 9d39dc9；ISO 日期解析 | 通过；sampledAt 未被重建改变 | M7.5 候选与 M8 A/B JSON |
| 旧 API 只保留一版兼容窗口 | packages/renderer/src/pixi-stage.ts、adv-renderer.ts、legacy/* | legacy stage/renderer contract；Renderer 全量 | 兼容测试和全量 Renderer 通过 | M8 提交链；M8 交付报告 §3 |
| 正式消费者全部走 v2 | Starter、正式游戏、Editor preview、CLI template、shared rollback | legacy scanner；Starter HMR；Editor/CLI 测试；verify:all | 外部生产消费者无 legacy 符号；通过 | M8 working notes、M8 交付报告 §3.2/§6.4 |
| Layer 不横向依赖 | packages/renderer/src/layers/* | npm run verify:renderer-boundaries | 3/3 通过，跨 Layer import 为 0 | boundary test 和扫描输出 |
| Commands/Queries、快照事务和 Query 纯度保持 | packages/renderer/src/api/*、runtime/* | Renderer contract、query-purity、presentation-controller、presentation-clear、legacy-world | 聚焦 39/39；Renderer 323/323 | Renderer 测试和 M8 交付报告 |
| Lifecycle/AssetRegistry 两批 50 次资源循环稳定 | packages/renderer/test/integration/resource-cycles.test.ts、各 Layer | Renderer 全量 | 两批各 50；第二批与第一批稳定点相等；真实 dispose 终态清空 | M8 交付报告 §5 |
| 可视状态覆盖 M8 目标 | packages/shell/e2e/renderer-v2-acceptance.e2e.mjs | npm run e2e:renderer-v2 -w @surdet/shell | 17/17 状态通过；页面/控制台/请求错误为 0 | 可视 harness 原始输出；M8 交付报告 §4 |
| 正式性能 artifact 必须与运行时代码一致 | docs/baselines/renderer-v3-m8-ab-2026-08-10.json | 官方 artifact validator；final source delta check | currentCommit=89c69ab...，与最终运行时代码一致 | M8 A/B artifact |
| M7.5 红灯必须继承保留 | docs/baselines/renderer-v3-candidate-2026-08-09.json | renderer-baseline-v3-verify.mjs | formalFailures=sceneP95Ms | M7.5 候选现场校验 |
| 正式游戏行为与发行包保持可用 | examples/zero-after-midnight/src/*、Shell pack | lint、simulate、assets、build、pack verifier、Shell E2E | 23/23、3 结局、39 次往返、44 资产、运行时错误 0；包校验通过 | M8 交付报告 §7/§8；EXE 证据 |

矩阵中每一项均有实际文件、实际命令和实际输出；没有用文档描述代替缺失的实现或测试。

## 5. 实际变更范围与未修改范围

### 5.1 M8 起点到最终 HEAD 的真实差异

现场执行 git diff --name-status 007438b...HEAD 得到 52 个路径、5,705 行新增、1,737 行删除。按运行时代码点 89c69ab 统计为 50 个路径、3,428 行新增、1,737 行删除；最终交付提交另加入 2 个证据文件。

变更路径如下：

~~~text
README.md
docs/AI-GUIDE.md
docs/ENGINE-RENDERER-V2-WAVE-2-DELIVERY-REPORT-2026-08-09.md
docs/baselines/renderer-v3-candidate-2026-08-09.json
docs/baselines/renderer-v3-m8-ab-2026-08-10.json
docs/capabilities.json
docs/capability-matrix.md
docs/examples/renderer-v2-migration.ts
docs/renderer-v2-migration.md
docs/superpowers/notes/2026-08-09-renderer-v2-m8-working-notes.md
examples/shared/font-jobs.ts
examples/shared/rollback-runtime.ts
examples/starter/src/main.ts
examples/starter/src/surdet-window.d.ts
examples/starter/src/system-adapters.ts
examples/starter/test/rollback-runtime.test.ts
examples/starter/test/vite-scene-hmr.test.ts
examples/zero-after-midnight/src/main.ts
examples/zero-after-midnight/src/surdet-window.d.ts
examples/zero-after-midnight/src/system-adapters.ts
package.json
packages/cli/templates/game/src/main.ts
packages/cli/test/new.test.ts
packages/editor/src/preview-runtime-lifecycle.ts
packages/editor/src/preview.ts
packages/editor/test/preview-runtime-contract.test.ts
packages/editor/test/preview-runtime-lifecycle.test.ts
packages/host/src/create-host.ts
packages/host/src/types.ts
packages/renderer/src/adv-renderer.ts
packages/renderer/src/api/renderer-runtime.ts
packages/renderer/src/diagnostics/renderer-baseline-v3.ts
packages/renderer/src/index.ts
packages/renderer/src/legacy/legacy-renderer-adapter.ts
packages/renderer/src/legacy/legacy-stage-adapter.ts
packages/renderer/src/pixi-stage-host.ts
packages/renderer/src/pixi-stage.ts
packages/renderer/src/runtime/create-renderer-runtime.ts
packages/renderer/src/runtime/renderer-facade.ts
packages/renderer/test/integration/renderer-runtime.test.ts
packages/renderer/test/legacy/legacy-renderer-contract.test.ts
packages/renderer/test/legacy/legacy-stage-contract.test.ts
packages/shell/e2e/renderer-baseline-v3-ab.e2e.mjs
packages/shell/e2e/renderer-baseline-v3-artifact.mjs
packages/shell/e2e/renderer-baseline-v3-rebuild.mjs
packages/shell/e2e/renderer-v2-acceptance.e2e.mjs
packages/shell/package.json
packages/shell/test/renderer-baseline-v3-artifact.test.mjs
scripts/check-renderer-legacy-usage.mjs
scripts/test/renderer-legacy-usage.test.mjs
scripts/test/renderer-v2-docs.test.mjs
scripts/verify-all.mjs
~~~

### 5.2 明确未修改范围

Git 差异没有出现：

- docs/dsl-spec.md；
- 任何 .gal 剧本、正式游戏 content/ 剧本或游戏规则配置；
- packages/core/；
- 存档 schema、存档版本和存档迁移文件；
- 真实用户存档、Profile 或正常 Electron userData；
- M8 之外的下一阶段实现；
- packages/shell/release/ 发行输出的 Git 纳入项；
- 日志、截图、缓存、临时脚本和生成目录。

## 6. 工具卫生修复复核

### 6.1 资源完成状态

validator 逐个检查 warmup 和 formal raw launch 的：

~~~text
assetLoading.total > 0
assetLoading.completed === assetLoading.total
assetLoading.failed === 0
assetLoading.done === true
~~~

现场的 6 个恶意篡改用例全部拒绝，未通过删除字段、改写统计或吞掉异常取得通过。

### 6.2 采样时间与离线重建时间

从提交 9d39dc9 机械读取的原始值：

~~~text
generatedAt = 2026-08-09T13:31:47.300Z
~~~

最终冻结候选：

~~~text
sampledAt = 2026-08-09T13:31:47.300Z
rebuiltAt = 2026-08-09T14:48:11.573Z
~~~

M8 A/B artifact：

~~~text
sampledAt = 2026-08-09T16:15:05.134Z
rebuiltAt = 2026-08-09T16:16:42.144Z
~~~

所有四个时间字段均可解析为合法 ISO 时间。测试证明重复离线 rebuild 保留 sampledAt，只更新 rebuiltAt。报告没有把 rebuiltAt 描述成新的 40 次 Electron 采样时间。

## 7. 消费者迁移、兼容窗口与边界

现场检索结果：

- Starter、正式游戏、Editor preview、CLI template 均通过 createRendererRuntime() 接入；
- 这些生产入口使用 runtime.commands、runtime.queries、runtime.controller 或 runtime.canvas；
- 外部生产消费者没有 new PixiStage、new AdvRenderer 或 AdvStage 使用；
- packages/renderer/src/layers 没有横向 Layer import；
- PixiStage 只继承 LegacyStageAdapter；
- AdvRenderer 模块只转出 legacy/legacy-renderer-adapter.ts；
- 实际 Pixi/UI 所有权位于 RendererStageHost 和各 Layer，不在旧入口中复制；
- Presentation 的 snapshot/validate/restore/clear、World/Stage this 绑定、Facade/Controller 边界在 Renderer 聚焦和全量测试中继续通过；
- 文档样例由 verify:tools 进行类型检查；能力矩阵 17 项、89 个证据路径全部存在。

### 7.1 P2 工具观察

scripts/check-renderer-legacy-usage.mjs 的 ALLOWED_PATHS 文字列出了 adapter 和 legacy test 路径，但实现同时对整个 packages/renderer/src/ 与测试路径作实现级豁免。实际当前外部生产扫描结果为空，Renderer 内部的剩余旧类型引用集中在兼容 Facade/插件类型和 legacy 测试；因此没有发现新消费者绕过 v2，也没有运行时或发行阻断。

这属于静态规则收紧的 P2 观察，不是 P0/P1。自检没有把它扩大为 Renderer 内部类型重排或插件 API 重构；后续若要收紧，应先由负责人明确哪些 Renderer 内部兼容端口属于允许范围，再补失败测试和单独工具变更。

## 8. 性能证据自检

M8 修改了正式 Renderer/Starter 可达运行时代码，所以按计划使用一次固定配对 A/B，未在未修改源码上反复重跑。

### 8.1 A/B 身份与完整性

~~~text
baseline = 12c539904ee2971f7190b8a25e846aa202c934ce
current  = 89c69ab427d75b064c761832bd09695778e446e6
pairCount = 20
warmups = 2
formal rawLaunches = 40
~~~

两边使用相同 Node/npm/Electron/Playwright、相同 package-lock、独立临时 userData、counterbalanced 顺序和官方比较器；所有 rawLaunches 均保存，没有删除异常值。M8 A/B artifact validator 现场通过。

### 8.2 M7.5→M8 增量

| 指标 | 统计量 | baseline | current | gateRatio | 门限 | 结果 |
|---|---|---:|---:|---:|---:|---|
| coldStartMs | median | 963.4208 | 913.04515 | 0.9477116853 | 1.10 | PASS |
| assetReadyMs | median | 1056.2238 | 1107.56135 | 1.0486048033 | 1.10 | PASS |
| menuOpenP95Ms | p95 | 12.8300 | 10.5450 | 0.8219017929 | 1.15 | PASS |
| sceneP95Ms | p95 | 31.6600 | 36.1200 | 1.1408717626 | 1.15 | PASS |

M8 artifact 的正式失败项为空；pairedMedianRatio 只作为诊断，不作为正式 gate。

### 8.3 M0→M8 历史风险与 M7.5 红灯

M7.5 冻结候选现场校验：

~~~text
formalFailures = sceneP95Ms
gateRatio(sceneP95Ms) = 1.2488932612
limit = 1.15
~~~

M8 artifact 重新以冻结 v2 文件比较的历史失败项为：

~~~text
historicalFailures = assetReadyMs, sceneP95Ms
~~~

Starter 主 bundle 的已记录静态值：

| 版本 | bytes |
|---|---:|
| M0/cab200b | 583,620 |
| M6 | 618,400 |
| M7 | 626,051 |
| M7.5 | 626,453 |
| M8 | 651,823 |

M7.5→M8 增加 25,370 bytes（约 4.050%）；M0→M8 增加 68,203 bytes（约 11.686%）。M8 没有用增量 PASS 覆盖历史风险，没有改 1.10/1.15 门限，没有覆盖 renderer-v2-cab200b.json，也没有在没有热点证据时做盲目缓存或懒加载优化。

## 9. 最终落盘门禁真实结果

以下均为本次自检对当前最终 HEAD/最终落盘文件的新鲜执行；不是从旧报告复制的“应该通过”结论。

| 命令/检查 | 退出码 | 实际结果 |
|---|---:|---|
| node packages/shell/e2e/renderer-baseline-v3-verify.mjs | 0 | M7.5 artifact PASS；formalFailures=sceneP95Ms；历史四项失败保留 |
| M8 A/B direct artifact validator | 0 | formal failures none；历史 assetReadyMs,sceneP95Ms；40 raw/2 warmup |
| npm test -w @surdet/renderer -- renderer-baseline.test.ts | 0 | 1 文件、19/19 |
| npm test -w @surdet/renderer -- presentation-controller.test.ts legacy-world-contract.test.ts | 0 | 2 文件、13/13 |
| npm test -w @surdet/shell -- renderer-baseline-v3-artifact.test.mjs | 0 | 1 文件、12/12 |
| npm run typecheck -w @surdet/renderer | 0 | 通过 |
| npm run build -w @surdet/renderer | 0 | 通过 |
| npm test -w @surdet/renderer | 0 | 46 文件、323/323 |
| npm test -w @surdet/shell | 0 | 7 文件、44/44 |
| npm run verify:renderer-boundaries | 0 | 3/3 |
| npm test -w surdet-starter | 0 | 2 文件、3/3 |
| npm run verify:all | 0 | verify:tools 7/7；全 workspace 907/907；hygiene 519 paths |
| npm run e2e -w @surdet/shell | 0 | steps=55、choices=41、saved=true、loaded=true；page/console/request errors=0 |
| npm run e2e:renderer-v2 -w @surdet/shell | 0 | 17/17 visual states；system boundary rollback probe PASS；错误均为 0 |
| npm run lint -w zero-after-midnight | 0 | 11 scenes、0 errors、0 warnings |
| npm run simulate -w zero-after-midnight | 0 | 23/23 choice branches；3 endings；39 save/load；runtime errors=0 |
| node examples/zero-after-midnight/scripts/check-assets.mjs | 0 | 44 assets PASS |
| npm run build -w zero-after-midnight | 0 | 通过 |
| node packages/shell/scripts/verify-pack.mjs --artifact | 0 | app.asar 关键文件/身份/加密素材通过 |
| git diff --check | 0 | 通过 |

根级 verify:all 的 907 项组成：CLI 86、Core 298、Editor 135、Host 18、Renderer 323、Shell 44、Starter 3。

正式游戏独立 simulate 输出的具体事实：入口 prologue、11 个场景、探索 24 条路径、23/23 choice 分支、3 个结局、39 次存读档往返、运行时错误 0、44 项资产通过。

Shell Electron E2E 输出的具体事实：steps=55、choices=41、快速存档与快速读档均为 true；标题 DOM 点击出现一次既有命中波动，脚本按既定 fallback 使用公开 debug titleSelect(new)，最终流程通过，未隐藏错误。

## 10. 首次失败和重跑记录

本自检没有出现需要重跑的门禁失败，但 M8 交付链中的首次失败仍完整保留：

1. 固定性能 A/B 的第一轮因两个 worktree 的 package-lock.json 字节 SHA 不一致，被官方 comparator 在采样计数前拒绝；该轮没有计入正式性能样本。统一锁文件后按同一预声明协议执行唯一有效的 20 对 A/B，结果和全部 raw 均保存在 artifact。
2. 首次 EXE 探针在业务检查通过后主动调用 runtime.dispose()，再触发正式游戏 beforeunload，制造了重复释放顺序的 RendererError: Renderer runtime has already been disposed。没有吞掉该错误；验收脚本改为读取 live snapshot 后走真实自然关闭，M8 交付报告记录的第二次自然关闭结果为 page/console/request errors 0。
3. M7.5 早期独立复测曾出现正式性能失败、通过、通过、失败、失败序列；M7.5 冻结候选的 sceneP95Ms 红灯未被后续偶然轮次覆盖。

## 11. Windows EXE 与文件 SHA-256

现场对现有发行产物执行了只读 verify-pack.mjs --artifact 和 SHA-256：

~~~text
path   = E:\surdet\packages\shell\release\win-unpacked\Surdet Game.exe
bytes  = 225613824
SHA256 = 4618e3eae46e130ed6f815594961ea8c2886a88108bb4e5d872b9ca1c578d50d
~~~

M8 运行时代码点之后没有运行时代码差异，因此 M8 交付报告中的隔离临时 userData 自然关闭验收仍对应同一代码 SHA；本次自检没有再次启动 EXE 或写入正常用户目录。

关键性能文件 SHA-256：

~~~text
docs/baselines/renderer-v2-cab200b.json
DE0AA52BEF955165213123EDA9632D14456355828A15B2FE9F4CBB548D934EDC

docs/baselines/renderer-v3-candidate-2026-08-09.json
61EF931C07FA74A4890CE5A80607685954B99EC31C3040B4CA1A2CAFF2C2A90E

docs/baselines/renderer-v3-m8-ab-2026-08-10.json
8EB1165C2A8F4407CCC37E4B7769D63CD66649CC8379FE1B7F85D23089EACE3F
~~~

## 12. 受保护文件与 Git 证据

以下四个文件没有被跟踪、修改、暂存、提交、删除、移动或推送：

~~~text
SESSION-HANDOFF.md
USER.md
docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
~~~

自检开始时及报告提交前的工作树均只有这四项未跟踪文件；没有其他 tracked modification。docs/baselines/renderer-v2-cab200b.json 未修改，SHA-256 如 §11 所列。

## 13. Git 状态与停止点

自检开始时现场值：

~~~text
HEAD = 34d5e9af2e7e6847837d8800dfd403138a1cd31a
HEAD...surdet/main = 74 0
git diff --check = PASS
~~~

报告首个本地提交后，将现场补写并复核：

~~~text
自检结束 HEAD = 待最终元数据提交后回读
最终 HEAD...surdet/main = 待最终元数据提交后回读
git status --short = 仅四个受保护未跟踪文件
~~~

明确结论：

- 本轮未 push；
- 本轮未 force push；
- 没有进入新的开发阶段；
- 没有开始 M9 或任何计划外施工；
- 未取得独立最终批准前，不正式发行；
- 当前停止状态为 WAITING_FOR_REVIEW。

## 14. 自检提交记录

本轮没有源码修复，因此没有“自检整改源码提交”。本报告采用两次精确文档提交：第一次纳入完整自检报告，第二次只回填第一次提交后的最终 HEAD、status 和 ahead/behind，避免在报告中伪造尚未产生的 commit SHA。

~~~text
首次报告提交 SHA = 待首个提交完成后回读
最终自检报告提交 SHA = 待最终元数据提交完成后回读
~~~

### 最终审计结论

M8 的实现、测试、构建、性能证据和发布包均已在磁盘上得到可复核证明；性能正式绿灯仍未宣称，M7.5 的 sceneP95Ms 红灯和 M0→M8 历史风险均保留。等待总经理独立复审，不执行任何远端写入。

