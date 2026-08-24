# Pre-Wave 5 Evidence Trustworthiness / Wave 3 交付报告

日期：2026-08-24
范围：Task 0–Task 6
停止状态：等待独立经理复审；未 push；未进入 Wave 5。

## VERIFIED_FACTS

### 1. 基线与范围

```text
INITIAL_HEAD = e636ac72b20ec8483c3131c4d18a14f43b81794e
INITIAL_PARENT = f8a4c08aed404c06c1706b224466fda67b0abb9a
REMOTE_MAIN_AT_BASELINE = e636ac72b20ec8483c3131c4d18a14f43b81794e
INITIAL_AHEAD_BEHIND = 0/0
INITIAL_TRACKED_WORKTREE = CLEAN
INITIAL_STAGING_AREA = EMPTY
TRACKED_LOG_FILES = 0
EVIDENCE_ROOT = C:\Users\Equinox\AppData\Local\Temp\surdet-evidence-trust-wave3-2804d615639a47628b45fcab5ae6e4f9
```

初始工作区已有的未跟踪治理文件、交接文件、受保护文件、长期路线台账和历史 `packages/cli/e2e/artifacts/` 均被保留，没有进入本轮提交。没有修改 Core 之外的禁止层，也没有修改 Renderer、Host、Shell、Editor、Starter、Zero、依赖或 lockfile。

### 2. RED 证据

任务书的四类 RED 由三条真实聚焦命令覆盖；Core 命令分别暴露 RNG、Scene ID 和 Choice inline 缺口，Authoring 命令暴露 duplicate validation 缺口，CLI 命令暴露 evidence seed 缺口。三条命令均 exit 1，均收集到非零测试数，不是 `HARNESS_INVALID`。

| 合同 | 命令 exit | artifact | bytes | SHA-256 | 失败事实 |
|---|---:|---|---:|---|---|
| RNG / Scene ID / Choice inline | 1 | `C:\Users\Equinox\AppData\Local\Temp\surdet-evidence-trust-wave3-2804d615639a47628b45fcab5ae6e4f9\task1-core-red.log` | 7921 | `63BC28F980553635C2C5994C7665653C444F4B0AFBB1941D23CA90B67C245ABF` | seeded source 不存在、dotted ID 可注册、非法 choice arrow 未抛 S009 |
| Duplicate validation | 1 | `C:\Users\Equinox\AppData\Local\Temp\surdet-evidence-trust-wave3-2804d615639a47628b45fcab5ae6e4f9\task1-authoring-red.log` | 5204 | `48D04DFE5D73690DC9727D8266472AAE81FC22B5D3E30F3566BC7D2ABDF5B759` | seeded 模拟结果错误、duplicate diagnostics 不完整 |
| Evidence seed | 1 | `C:\Users\Equinox\AppData\Local\Temp\surdet-evidence-trust-wave3-2804d615639a47628b45fcab5ae6e4f9\task1-cli-red.log` | 2068 | `16867E16AB08AB5F8968022A9FEC9733DEF29E5175D680C5104558BD3AC7F7B6` | seed contract 在实现前失败 |

### 3. 实现提交与范围

```text
TASK2_COMMIT = 0aec8801ea8bcb9cf16378dc12c4ac9eeef2cc90
TASK2_MESSAGE = fix(core): fail loud on ambiguous scene syntax
TASK3_COMMIT = 52be22a580dd2aa232a1795cb5ae8defbed785d7
TASK3_MESSAGE = fix(core): make random state reproducible
TASK3_EXPORT_CORRECTION_COMMIT = d14f52adec8132324df163909ad3eee69c1c6d44
TASK3_EXPORT_CORRECTION_MESSAGE = fix(core): export seeded random source
TASK4_COMMIT = f4f8f2417d5f121864f3f66848432a0e502ce8dc
TASK4_MESSAGE = fix(authoring): make evidence seed and scene validation trustworthy
CODE_EVIDENCE_HEAD = f4f8f2417d5f121864f3f66848432a0e502ce8dc
```

Task 2 只涉及 Core scene-id/registry/parser/lint-hints/index、Authoring operations/validation 及对应测试；Task 3 只涉及 Core random source、Interpreter、save manager 及对应测试；Task 3 的单文件 export correction 用独立普通提交完成；Task 4 只涉及 Authoring simulation/capability registry、CLI dispatcher/service/index/simulate 及对应测试。提交均未 amend、rebase、squash 或 push。

### 4. 合同结果

#### Seeded DSL random

```text
SEEDED_RANDOM_ALGORITHM = mulberry32-v1
SEED_0_VECTOR = [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197]
SEED_1_VECTOR = [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]
SEED_7_SAVE_LOAD_NEXT = 0.06195825757458806
DEFAULT_AUTHORING_EVIDENCE_SEED = 1592639710
```

固定向量使用精确相等断言。`save → draw → load → draw` 复现同一个 next raw value；`SaveSnapshot.random` 保持可选，旧快照仍可加载。simulation 的同 seed 结果一致、不同固定 seed 在专用 fixture 上产生精确差异：seed 0 的 `@random` 结果为 `[26, 0]`，seed 1 为 `[63, 0]`。`simulationStateSignature` 包含随机状态，分支回溯不会把随机序列串线。

#### Scene ID / Choice / Duplicate

- SceneRegistry 在写入前拒绝 `my.scene`，失败后 registry 为空；合法 `my` 的 `scene` label 仍支持 `resolve('my.scene')`。
- `A ->`、`A -> goto target`、`A -> text @goto target` 均在编译期抛 `S009`；合法 `@goto` 和无箭头 choice 保持通过。
- duplicate validation 在 Map 建索引前报告 `LINT_DUP`，同时保留 first path 与 duplicate path，并保留第二个物理文件自己的 `J002` 诊断；CLI/Agent `project.validate` 走同一 Authoring 结果。

#### Authoring / CLI evidence seed

真实 `project.simulate`、`runtime.run-from`、`runtime.read-trace` contract 测试均返回实际 seed。CLI JSON 结果证据：

```text
task4-cli-seed0-a.json  bytes=319  sha256=15E2D160D675B08B5980832DFD9E970A6012A94067862DA847AD1160D6F243DF
task4-cli-seed0-b.json  bytes=319  sha256=15E2D160D675B08B5980832DFD9E970A6012A94067862DA847AD1160D6F243DF
task4-cli-seed1.json    bytes=319  sha256=B436A2222850484A3900A4E6FBC687EE434874028486CC67F73080BD8C9E3DE2
SEED0_BYTE_IDENTICAL = YES
SEED0_REPORT_SEED = 0
SEED1_REPORT_SEED = 1
```

### 5. Task 5 验证

所有下列命令实际 exit 0：

```text
npm run test -w @surdet/core                         26 files / 327 tests
npm run test -w @surdet/authoring                   22 files / 138 tests
npm run test -w @surdet/cli                        22 files / 178 tests
npm run typecheck -w @surdet/core
npm run build -w @surdet/core
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
npm run simulate -w surdet-starter -- --seed 1592639710
```

Starter 模拟 exit 0，报告 13 paths、2/3 choices、25 save/load、runtime errors = 0。对应 artifact：

```text
path = C:\Users\Equinox\AppData\Local\Temp\surdet-evidence-trust-wave3-2804d615639a47628b45fcab5ae6e4f9\task5-starter-simulate.log
bytes = 372
sha256 = C74FB65D2F89D49B5D664A0DE6798AD274FADBBD54EA07079433FE99068CAC9C
```

最新 CLI dist 对同一 Starter、同一 seed 连续运行两次，两个 328-byte JSON 逐字节一致：

```text
task5-cli-direct-a.json  bytes=328  sha256=433EF4E48034DD7E58787E845AA45B7EA81FD548C9E3DE578A8D95FC290330BD
task5-cli-direct-b.json  bytes=328  sha256=433EF4E48034DD7E58787E845AA45B7EA81FD548C9E3DE578A8D95FC290330BD
SEED0_BYTE_IDENTICAL = YES
git diff --quiet -- examples/starter = exit 0
STARTER_GIT_TREE_INITIAL = 3333db468f50c848b8c5b7bd6869ae91c2e376a7
STARTER_GIT_TREE_CURRENT = 3333db468f50c848b8c5b7bd6869ae91c2e376a7
```

唯一一次主聚合门禁：

```text
VERIFY_ALL_RUNS = 1
VERIFY_ALL_EXIT = 0
VERIFY_ALL_LOG = C:\Users\Equinox\AppData\Local\Temp\surdet-evidence-trust-wave3-2804d615639a47628b45fcab5ae6e4f9\task5-verify-all.log
VERIFY_ALL_BYTES = 58476
VERIFY_ALL_SHA256 = B1CA024C929CEB93BE9230C9858D506C8417E5D5E32DA13C718C6606441B5409
RECOVERY_VERIFY_ALL = NOT_RUN
```

没有运行 DIAGNOSTIC、独立 FORMAL、Electron、浏览器人工验收、性能矩阵、pack、部署、发行或任何 Wave 4/Wave 5 流程。`verify:all` 内部既有的 `verify:formal` 节点属于本任务书唯一授权的聚合命令，不是另行启动的独立 FORMAL。

### 6. 证据目录完整身份

以下 artifact 均从磁盘回读：

```text
task1-authoring-red.log  bytes=5204   sha256=48D04DFE5D73690DC9727D8266472AAE81FC22B5D3E30F3566BC7D2ABDF5B759
task1-cli-red.log        bytes=2068   sha256=16867E16AB08AB5F8968022A9FEC9733DEF29E5175D680C5104558BD3AC7F7B6
task1-core-red.log       bytes=7921   sha256=63BC28F980553635C2C5994C7665653C444F4B0AFBB1941D23CA90B67C245ABF
task4-cli-seed0-a.json   bytes=319    sha256=15E2D160D675B08B5980832DFD9E970A6012A94067862DA847AD1160D6F243DF
task4-cli-seed0-b.json   bytes=319    sha256=15E2D160D675B08B5980832DFD9E970A6012A94067862DA847AD1160D6F243DF
task4-cli-seed1.json     bytes=319    sha256=B436A2222850484A3900A4E6FBC687EE434874028486CC67F73080BD8C9E3DE2
task5-cli-direct-a.json  bytes=328    sha256=433EF4E48034DD7E58787E845AA45B7EA81FD548C9E3DE578A8D95FC290330BD
task5-cli-direct-b.json  bytes=328    sha256=433EF4E48034DD7E58787E845AA45B7EA81FD548C9E3DE578A8D95FC290330BD
task5-starter-simulate.log bytes=372 sha256=C74FB65D2F89D49B5D664A0DE6798AD274FADBBD54EA07079433FE99068CAC9C
task5-verify-all.log    bytes=58476  sha256=B1CA024C929CEB93BE9230C9858D506C8417E5D5E32DA13C718C6606441B5409
```

## REASONABLE_INFERENCES

- 本 Wave 的 DSL `@random`、Authoring simulation/evidence 和 save/load 证据链已经具备可复现的 seeded contract；这不等于所有 Surdet 运行时随机来源都已被统一。
- 由于任务书禁止真实浏览器和人工体验，本报告不能替代视觉、声音、交互或外部 Agent 验收。
- 代码证据 HEAD 与远端之间的 ahead 状态是本地未 push 提交的结果，不是远端已发布状态。

## UNVERIFIED_BOUNDARIES

- 无 seed 的普通玩家解释器仍使用 `Math.random()` fallback。
- 未覆盖的非 DSL 随机路径、真实发行包、跨设备表现和完整玩家体验未在本 Wave 验证。
- 没有进行外部 Agent、Editor、Electron 或人工浏览器验收。

## OUT_OF_SCOPE_FINDINGS

本轮没有发现必须转入 Wave 3 范围外的生产阻断；Renderer、Host、Shell、Editor、Starter、Zero、依赖、lockfile、长期路线台账和受保护文件均未修改。历史未跟踪治理文件与旧 artifact 仍在原位置保留。

## FINAL_HANDOFF

```text
PRE_WAVE_5_EVIDENCE_TRUSTWORTHINESS_WAVE_3_VERIFIED = YES
DSL_RANDOM_SEEDED_EVIDENCE_VERIFIED = YES
SCENE_ID_ADDRESSING_FAIL_LOUD = YES
CHOICE_INLINE_ACTION_FAIL_LOUD = YES
DUPLICATE_SCENE_VALIDATION_FAIL_LOUD = YES
READY_FOR_INDEPENDENT_MANAGER_REVIEW = YES
PUSH = NOT_PERFORMED
AGENT_TRANSACTION_RECOVERY_WAVE_4 = NOT_STARTED
WAVE_5 = NOT_STARTED
```

最终 docs-only 提交后的真实 HEAD、parent、remote、ahead/behind、工作树、暂存区以及本文件和任务书的最终 bytes/SHA-256，由交接时从磁盘回读；不在文档中制造自指身份字段。
