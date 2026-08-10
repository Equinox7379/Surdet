# Surdet Renderer v2 M8 最终限定整改：当前权威交付报告

日期：2026-08-10

工作区：`E:\surdet`

状态：`FUNCTIONALLY_APPROVED / PERFORMANCE_MEASUREMENT_NOT_QUALIFIED`

发布状态：`RELEASE_BLOCKED`

M9：未开始
远端：未 push，未 force push

> 本报告是本轮证据系统与性能裁决整改的唯一当前口径。它不覆盖、不重写、不删除历史冻结或历史红灯 artifact。性能测量资格未建立，因此本报告不把性能结论表述为绿色，也不批准正式发行。

## 1. 执行范围与保护边界

本轮严格限制为总经理批准的两项 P1 整改：

1. 移除生产 Runtime、Starter 和 window debug 对真实 Renderer Layer 的可取得引用，并把 `projectionSnapshot` 收敛为只读、深克隆、递归冻结的普通数据查询。
2. 建立可审计的菜单诊断探针与测量资格试验；先证明测量协议可资格化，再决定是否运行新的正式 A/B。没有直接代码热点证据时不做生产性能优化。

本轮没有修改 DSL、存档格式、游戏规则、正式消费者行为、视觉文案、输入键位或编辑器产品语义；没有开始 M9。

以下四个用户文件全程未修改、未暂存、未提交、未删除、未移动：

- `SESSION-HANDOFF.md`
- `USER.md`
- `docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`
- `docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`

## 2. 起始基线与历史证据封存

本轮开始工作树 HEAD：`f19837b8b49e4161413f645082ef141c412ec58e`。开始时 `HEAD...surdet/main = 87 0`，工作树除了上述四个受保护未跟踪文件外无既有改动。

历史正式性能裁决继续以此前冻结的 A/B 为准：

- baseline：`007438b569ec95350fdc9d7882ad49f55bbb7968`
- current：`db12cb02083c64e750527283ada2aceb10d30597`
- `pairCount=20`，`rawLaunches=40`
- 正式失败：`assetReadyMs`、`sceneP95Ms`
- 1.10 / 1.15 门限未修改；paired median 只作诊断，不能覆盖正式 gate。

本轮重新计算并确认以下历史文件未被覆盖：

| 文件 | SHA-256 | 说明 |
|---|---|---|
| `docs/baselines/renderer-v3-m8-ab-2026-08-10.json` | `0c08c3c9d7b36d6b45f4a40551224ef0b1830bff06c385b179938065ab8261e9` | 历史正式 A/B |
| `docs/baselines/renderer-v3-m8-final-remediation-ab-2026-08-10.json` | `e2522cbfd2f475e62719e66afac20eee5522a7c64c96539e02ea5c5b96d03817` | 当前权威历史红灯：assetReady / scene |
| `docs/baselines/renderer-v3-candidate-2026-08-09.json` | `61ef931c07fa74a4890ce5a80607685954b99ec31c3040b4ca1a2caff2c2a90e` | 历史 candidate |
| `docs/baselines/renderer-v2-cab200b.json` | `de0aa52bef955165213123eda9632d14456355828a15b2fe9f4cbb548d934edc` | M0/cab200b 冻结样本 |
| `docs/baselines/renderer-v3-menu-diagnostic-2026-08-10.json` | `1bba300b15c144a17342246cf41b9e7966231848c3faf1a8a607034fcb3238ab` | 旧手工探针证据，保留不覆盖 |

## 3. 已完成的工程整改

### 3.1 Runtime projectionSnapshot 只读化

`packages/renderer/src/runtime/renderer-facade.ts` 现在对 `diagnostics.projectionSnapshot()` 的结果执行：

- 从 Provider 快照生成独立 clone；
- 对根对象、所有嵌套普通对象和数组递归 `Object.freeze`；
- 不冻结 Provider 原始对象；
- 不向宿主返回 Layer、Pixi DisplayObject 或其他渲染实例。

测试先行记录：

- 修复前 `query-purity.test.ts` 的 2 项冻结断言均失败；
- 修复后该文件 2/2 通过；
- 覆盖根、dialogue、choiceLabels、nvlLines、menu、gallery、system、world 以及 overlay 嵌套对象；
- 严格模式下修改返回快照会抛错；下一次查询保持原值；Provider 原始快照仍未冻结且返回对象不是同一引用。

既有 `packages/renderer/test/integration/renderer-runtime.test.ts` 继续证明 Runtime 的 own keys 不含 `__rendererV2Debug`，注入的 Layer sentinel 不会从 Runtime 或 projection 查询泄漏。

Renderer v2 Electron 验收又增加了 window debug 边界断言：

- `window.surdetDebug` 没有 `rendererV2Layers`；
- `window.__surdetDebug` 没有 `rendererV2Layers`；
- `window.__surdetDebug` 没有 `__rendererV2Debug`；
- 17 个状态的语义断言全部继续通过。

### 3.2 Artifact verifier 收敛为显式输入

`packages/shell/e2e/renderer-baseline-v3-verify.mjs` 不再自动选择 candidate，必须显式提供：

```text
node packages/shell/e2e/renderer-baseline-v3-verify.mjs --artifact <path>
```

当前行为：

- 缺少 `--artifact`、未知参数、重复参数、位置参数、缺失值均失败；
- 解析后的文件必须位于仓库 `docs/baselines` 下且是普通文件；
- 输出 artifact 路径、SHA-256、baseline/current commit、pairCount、raw launch 数、formal failures、historical failures；
- 结构合法但存在正式失败时输出 `VALID ARTIFACT` 与 `FORMAL GATE FAIL`，退出码为 2；
- 结构与正式 gate 都通过时输出 `VALID ARTIFACT` 与 `FORMAL GATE PASS`，退出码为 0；
- 结构无效时退出码为 1，不会回退到历史 candidate。

测试先行与回归：

- 生产修复前新增的 CLI 回归 7/7 失败，证明旧脚本确实忽略了显式选择和错误参数；
- 修复后 `packages/shell/test/renderer-baseline-v3-verify-cli.test.mjs` 为 7/7 通过；
- 旧权威红灯 artifact 实际复核结果为 exit 2，并准确打印 `formalFailures=assetReadyMs,sceneP95Ms`；没有被误报成 PASS。

### 3.3 统一、可重放的菜单诊断探针

新增的诊断工具位于测试/诊断范围，不暴露 Layer 或 Pixi 引用，也不把可写生产状态放进 Runtime：

- 探针脚本：`packages/shell/e2e/renderer-menu-diagnostic-instrumentation.mjs`
- 自动 runner：`packages/shell/e2e/renderer-menu-diagnostic-runner.mjs`
- 诊断消费者：`packages/shell/e2e/renderer-menu-diagnostic.mjs`
- 统一探针脚本 SHA-256：`826642a7a5e03860147d1fcbba278ef1d8adbc75219e95f1d45b182ee09a89d1`
- 每个 clean worktree 只修改 `examples/starter/src/main.ts`；`git diff --check=true`；完整 diff SHA 等于探针 diff SHA；`onlyUnifiedInstrumentationDiff=true`。
- 三个版本的 lockfile SHA 均为 `60a48410727eb3c536ad005459a6e3460bb9abf77e3bdd7d19c799429e273e8f`。

应用版本：

| 角色 | 原始 commit |
|---|---|
| M7.5 | `007438b569ec95350fdc9d7882ad49f55bbb7968` |
| 原始 M8 | `89c69ab427d75b064c761832bd09695778e446e6` |
| 当前 M8 诊断版本 | `0365cff80910597d4985408a187c4b663020e1f0` |

执行纪律已实际落实：先为每个版本完成 1 次 smoke；三版本 smoke 全部成功后，才进行每个版本 1 次暖机 + 10 次正式诊断。完整 artifact 不覆盖旧手工探针。

smoke artifact：

- `docs/baselines/renderer-v3-menu-diagnostic-repro-smoke-2026-08-10.json`
- SHA-256：`bda2d83498ad99907b805e6227b495d17f075b8c9fe380b1c798fe4ba3dcd758`
- 三个角色各 1 个 raw sample，顺序和 clean-worktree diff 证据完整。

正式诊断 artifact：

- `docs/baselines/renderer-v3-menu-diagnostic-repro-2026-08-10.json`
- SHA-256：`ec75fe6b73bad4b2d3fadaa1db892937c49f717f2db1e28d54047450615ae648`
- `rawSamples=30`、`warmups=3`、`executionOrder=33`；完整原始样本保留；三角色每个资源状态均为 6/6 completed、failed=0、done=true；页面错误、控制台错误、失败请求均为 0。

## 4. 菜单诊断结论：没有直接的生产热点证据

统一探针分别记录：

1. `titleSelect('settings')` 同步命令耗时；
2. Menu projection commit 耗时；
3. 命令完成到下一 `requestAnimationFrame` 的等待；
4. 是否错过 16.67ms 帧预算。

| 角色 | sync median / p95 ms | projection median / p95 ms | command→rAF p95 ms | total→rAF p95 ms | missed |
|---|---:|---:|---:|---:|---:|
| M7.5 | 1.400 / 2.010 | 1.350 / 1.865 | 214.150 | 215.975 | 1/10 |
| 原始 M8 | 1.400 / 2.010 | 1.200 / 1.855 | 0.255 | 2.210 | 0/10 |
| 当前 M8 | 1.400 / 1.500 | 1.300 / 1.455 | 0.200 | 1.600 | 0/10 |

M7.5 也出现了 215ms 级别的 `command→rAF` 尾延迟，而当前 M8 的 projection p95 只有约 1.455ms、total p95 约 1.600ms。这证明此前 menuOpenP95Ms 的异常尾部不能直接归因于 MenuLayer 投影代码；本轮没有进行无证据的缓存、懒加载或阈值修改。

## 5. 测量资格试验与性能裁决

### 5.1 固定协议

在结果产生前已固定：

- baseline 自比较：`007438b` worktree A vs `007438b` worktree B；
- current 自比较：`db12cb` worktree A vs `db12cb` worktree B；
- 每组 20 对、40 个正式 raw launch；两侧各暖机 1 次；counterbalanced 交错顺序；
- 每次 Electron 使用独立临时 userData；两侧执行同一构建模式、工具版本和 lockfile；
- 所有 raw、warmup、执行顺序、环境和健康状态写入新 artifact；不覆盖旧红灯。

### 5.2 baseline 自比较

artifact：`docs/baselines/renderer-v3-control-baseline-2026-08-10.json`
SHA-256：`843604fbfedc18b472a7cdecc6c6f7b5e412bbabf35af104159d8e1dae898ab6`

| 指标 | 左侧 summary | 右侧 summary | gateRatio | 门限 | 结果 |
|---|---:|---:|---:|---:|---|
| coldStartMs median | 962.834 | 969.511 | 1.006935 | 1.10 | PASS |
| assetReadyMs median | 1087.175 | 1052.227 | 0.967854 | 1.10 | PASS |
| menuOpenP95Ms p95 | 11.850 | 12.405 | 1.046835 | 1.15 | PASS |
| sceneP95Ms p95 | 28.245 | 29.870 | 1.057532 | 1.15 | PASS |

健康状态：40 个 raw launch、2 个 warmup，assetsFailed/pageErrors/consoleErrors/failedRequests 均为 0。

### 5.3 current 自比较

artifact：`docs/baselines/renderer-v3-control-current-2026-08-10.json`
SHA-256：`ace8a8425ef1a5f973465a9cc129fdcf69864f5181bb35fd583c85650a930b7f`

| 指标 | 左侧 summary | 右侧 summary | gateRatio | 门限 | 结果 |
|---|---:|---:|---:|---:|---|
| coldStartMs median | 923.818 | 927.714 | 1.004218 | 1.10 | PASS |
| assetReadyMs median | 1046.140 | 1337.561 | 1.278568 | 1.10 | **FAIL** |
| menuOpenP95Ms p95 | 22.865 | 22.775 | 0.996064 | 1.15 | PASS |
| sceneP95Ms p95 | 27.740 | 29.435 | 1.061103 | 1.15 | PASS |

健康状态同样为零错误、零资源失败、40 个 raw launch、2 个 warmup。

current 自比较的 `assetReadyMs` 正式 summary 已超过同一正式 gate 的 1.10 门限，因此不能说测量协议已资格化。其 pairedMedianRatio 为 1.040984，但该值只能作诊断，不能覆盖正式失败。由于 qualification 未通过，本轮按纪律不再运行新的正式 baseline-vs-current A/B，也不通过挑选轮次或提高门限来刷绿。

### 5.4 性能状态

性能裁决为：

- 功能和架构验收：通过；
- 测量系统资格：未通过；
- 历史正式性能红灯：保留，不能被本轮诊断覆盖；
- 没有足够证据证明存在 MenuLayer 生产代码回退；
- 发布：阻断；
- M9：不启动。

## 6. 回归门禁结果

### 6.1 包级测试与类型/构建

- Renderer：46 个测试文件，325/325 通过；
- Starter：5/5 通过；
- Editor：20 个测试文件，135/135 通过；
- CLI：7 个测试文件，86/86 通过；
- `npm test -w @surdet/shell`：8 个文件，51/51 通过；
- Renderer typecheck：通过；
- Renderer build：通过；
- 根级 typecheck/build 链路：通过。

### 6.2 边界与根级门禁

- `npm run verify:renderer-boundaries`：3/3 通过；
- `npm run verify:renderer-legacy`：3/3 通过；
- `npm run verify:tools`：7/7 通过；
- `npm run verify:all`：退出码 0；其中 capability、verify-all uniqueness、shell:false、文档、卫生、全 workspace typecheck、全 workspace tests、Starter/正式游戏门禁、build、diff-check 均通过；
- `git diff --check`：通过；
- 新 artifact verifier：baseline control exit 0；current control exit 2 且为结构合法的正式失败，不是 verifier 异常。

### 6.3 Electron 与正式游戏

- Renderer v2 视觉验收：17 个状态全部完成；17 个状态的语义断言全部通过；debug boundary 断言全部通过；本轮仍按现有流程标记为 `CANDIDATE`，没有把候选图片冒充永久视觉 PASS；
- Shell Electron E2E：通过；`steps=55`、`choices=41`、快速存档/读档均成功、最终到达 `awaiting-choice`；
- 《零点之后》 lint：11 个场景，0 错误，0 警告；
- 《零点之后》 simulate：选择分支 23/23，3 个结局均可达，运行时错误 0；
- 《零点之后》资产检查：44 项通过；
- 《零点之后》 typecheck/build：通过。

## 7. 本轮正式提交与工作树

代码、测试、诊断 runner、诊断原始证据和 verifier 已组成一个聚焦本地提交：

`b0d9e8f5007554024e53f7a6c89a34b8f667ce0c`  具体提交信息：`fix(renderer): harden v3 evidence and projection snapshots`

完整 SHA 在提交后为：

`b0d9e8f5007554024e53f7a6c89a34b8f667ce0c`

本报告将在该实现/证据提交之后单独加入；因此最终 HEAD 以交付回报中的最终 `git rev-parse HEAD` 为准。两次提交都不 push。

报告生成前工作树除四个保护文件外为空；报告提交后预期只保留以下四个未跟踪路径：

```text
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
```

`HEAD...surdet/main` 的最终数值在报告提交后再次读取并在交付回报中给出；本轮明确未 push、未 force push。

## 8. 遗留事项与复审结论

1. 正式历史性能 gate 的 `assetReadyMs` / `sceneP95Ms` 红灯继续保留。
2. `db12cb` 自比较未通过 `assetReadyMs` 正式门限，性能测量系统仍未资格化；不能据此继续盲目改生产性能代码。
3. menu 统一探针没有发现 MenuLayer projection 的直接热点；出现的尾延迟位于命令到下一帧的调度等待，且 M7.5 也可复现同类尾部。
4. 本轮没有新的正式 A/B；旧正式 artifact 仍是性能裁决依据。
5. 需要下一轮独立复审决定如何重新设计/资格化性能测量协议；在此之前不得宣布性能绿色、正式发行或开始 M9。

本报告完成后状态：`WAITING_FOR_REVIEW`。
