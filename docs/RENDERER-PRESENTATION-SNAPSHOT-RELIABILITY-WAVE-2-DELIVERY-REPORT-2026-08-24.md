# 结论：Renderer Presentation Snapshot Reliability / Wave 2 已通过自动化门禁与项目所有者 NVL 存读档人工验收，现停在独立总经理复审前

本轮未 push、未部署、未打包、未发行，未进入下一 Foundation Wave 或 Wave 5。

## 1. 当前交付状态

```ini
WAVE = PRE-WAVE-5 RENDERER PRESENTATION SNAPSHOT RELIABILITY / WAVE 2
INITIAL_HEAD = 04c60e3bb4bbf8e8f0b209a29fb69524cf47bb5d
CODE_EVIDENCE_HEAD = e337550b03eaad8ae6dd62f5d9b05a88e125f4b8
DOCUMENT_CLOSURE_BEFORE_HEAD = e337550b03eaad8ae6dd62f5d9b05a88e125f4b8
REMOTE_MAIN = 04c60e3bb4bbf8e8f0b209a29fb69524cf47bb5d
AHEAD_BEHIND_BEFORE_DOCUMENT_COMMIT = 2/0
TRACKED_WORKTREE_BEFORE_DOCUMENT_COMMIT = CLEAN
STAGING_AREA_BEFORE_DOCUMENT_COMMIT = EMPTY
OWNER_NVL_SNAPSHOT_ACCEPTANCE = PASS
PUSH = NOT_PERFORMED
DEPLOYMENT = NOT_PERFORMED
RELEASE = NOT_PERFORMED
NEXT_PRE_WAVE_5_THEME = NOT_STARTED
WAVE_5 = NOT_STARTED
STOP_STATE = READY_FOR_INDEPENDENT_MANAGER_REVIEW
```

`DOCUMENT_CLOSURE_BEFORE_HEAD` 是本报告与任务书写入前的真实 HEAD；文档闭合提交的真实身份在提交后从 Git 回读并在交接中报告，不在文档内制造自指提交记录。

## 2. 实际提交与修改范围

### 2.1 代码提交

```ini
CODE_COMMIT_1 = e9056e7bf3fa8d96e6e20b784720ef741c04fc1d
CODE_COMMIT_1_PARENT = 04c60e3bb4bbf8e8f0b209a29fb69524cf47bb5d
CODE_COMMIT_1_MESSAGE = fix(renderer): preserve presentation snapshot semantics
CODE_COMMIT_2 = e337550b03eaad8ae6dd62f5d9b05a88e125f4b8
CODE_COMMIT_2_PARENT = e9056e7bf3fa8d96e6e20b784720ef741c04fc1d
CODE_COMMIT_2_MESSAGE = test(renderer): keep snapshot integration off legacy boundary
```

`CODE_COMMIT_2` 是恢复门禁所需的测试边界修正：集成测试改用本地结构类型，不再直接导入 legacy `AdvStage`。没有修改 Renderer 生产语义。

### 2.2 代码提交实际覆盖的文件

```text
packages/renderer/src/api/renderer-commands.ts
packages/renderer/src/api/renderer-queries.ts
packages/renderer/src/layers/dialogue/dialogue-layer.ts
packages/renderer/src/runtime/create-renderer-runtime.ts
packages/renderer/src/runtime/presentation-controller.ts
packages/renderer/src/runtime/presentation-ports.ts
packages/renderer/src/runtime/renderer-facade.ts
packages/renderer/test/integration/presentation-save-roundtrip.test.ts
packages/renderer/test/layers/dialogue-layer.test.ts
packages/renderer/test/legacy/presentation-controller.test.ts
```

本轮文档提交只允许包含：

```text
docs/superpowers/plans/2026-08-24-pre-wave-5-renderer-presentation-snapshot-reliability-wave-2.md
docs/RENDERER-PRESENTATION-SNAPSHOT-RELIABILITY-WAVE-2-DELIVERY-REPORT-2026-08-24.md
```

未修改 Core、Renderer 其它模块、Host、Shell、Editor、Authoring、CLI、Starter、Zero、长期路线台账、受保护文件、CLI artifacts 与桌面 fixture。

## 3. 实现合同

### A1：缺失 presentation 的中性恢复

- 外层 `presentation` 缺失或为 `null` 时，Core load 链可以通过 Renderer presentation 校验。
- restore 后 stage/presentation 进入中性状态，NVL 关闭，当前 NVL 页面清空。
- controller 与 facade fallback 使用一致的缺失值合同。
- 旧存档不需要迁移，不升级 SaveSnapshot 或 presentation version。
- state reset 与 restore 均保持幂等，不调用会额外重置主题、设置或 Backlog 的全量 DialogueLayer reset。

### A2：NVL 当前页快照与精确去重

- DialogueLayer 保存纯 JSON `{ speaker, text }` 条目，并与可见行淘汰同步。
- 查询返回克隆后的纯数据，调用方修改返回值不会污染内部状态。
- `clearNvlText()` 同时清理节点、计数与原始条目。
- NVL active 时，快照只删除末尾与 Core 当前 text 精确匹配的一条；不匹配、不在末尾或非 text 时不猜测删除。
- restore 先设置 NVL 模式、清空旧页，再按快照条目重建页面；Core 随后重放的当前行不会重复。
- 旧 v1 payload（无 dialogue 子对象）继续恢复为 NVL inactive、空页面。

## 4. 自动化证据

### 4.1 红灯与测试设施纠正

第一轮出现两份测试设施无效记录，均保留为历史证据，未被当作产品结论：

```text
HISTORICAL_SNAPSHOT task1-red.log
exit = 1; 3 files / 26 tests were not reached as a valid product RED
reason = test harness syntax failure

HISTORICAL_SNAPSHOT task1-red-valid.log
exit = 1
reason = second test harness syntax failure
```

修正测试设施后得到有效产品红灯：

```ini
TASK1_VALID_PRODUCT_RED = PASS_AS_EVIDENCE
TASK1_VALID_PRODUCT_RED_EXIT = 1
TASK1_VALID_PRODUCT_RED_TEST_FILES = 3
TASK1_VALID_PRODUCT_RED_TESTS = 26
TASK1_VALID_PRODUCT_RED_FAILURES = 6
```

失败指向：缺失 presentation 被拒、facade fallback 不接受 null、缺失 NVL 查询/快照数据，以及非法 dialogue payload 未在 mutation 前拒绝。

### 4.2 聚焦 Green

```text
Task 2 A1 focus: 2 passed, 13 skipped, 1 file, exit 0
Task 3 DialogueLayer focus: 9 passed, exit 0
Task 3 controller focus: 15 passed, exit 0
Task 3 Core + Renderer roundtrip final focus: 2 passed, exit 0
Renderer typecheck: exit 0
Renderer build: exit 0
```

集成回归实际走真实 Core `Interpreter.saveSnapshot()` / JSON stringify-parse / `loadSnapshot()`，没有以直接调用私有 restore 代替存档链。

### 4.3 相邻与全量门

```ini
RENDERER_FULL = PASS; 50 files / 412 tests; exit 0
CORE_ADJACENT = PASS; 2 files / 23 tests; exit 0
EDITOR_BUILD = PASS; exit 0
```

第一次 `verify:all` 的历史记录不是产品失败：

```ini
HISTORICAL_SNAPSHOT = task4-verify-all.log
EXIT = 1
FIRST_FAILED_NODE = verify:renderer-legacy
REASON = integration test imported legacy AdvStage directly
```

该问题通过独立的 `CODE_COMMIT_2` 测试边界修正解决。经项目所有者与总经理授权，随后只运行一次恢复 `verify:all`：

```ini
RECOVERY_VERIFY_ALL = PASS
RECOVERY_VERIFY_ALL_INVOCATION = 1
RECOVERY_VERIFY_ALL_COMMAND = npm run verify:all
RECOVERY_VERIFY_ALL_EXIT = 0
RECOVERY_VERIFY_ALL_PATH = <local-path>
RECOVERY_VERIFY_ALL_BYTES = 58436
RECOVERY_VERIFY_ALL_SHA256 = 661C8EDCEBD7DFDB5650D08E2093FAA8D10C6ECC130C9E00C44BF6C937C58264
```

`verify:all` 总共保留一份历史失败记录和一份获准恢复记录；没有在恢复通过后再次运行大型门禁。

## 5. 项目所有者人工验收

### OWNER_REPORTED_VISUAL_FACTS

项目所有者对同一隔离 fixture 的 NVL 存读档路径原始反馈为：

> 人工 NVL 存读档路径通过：第三行仅一次，第四行消失，NVL 模式保持。

该反馈确认 RPS-12 的可见 NVL 存档路径，不由执行 AI 代填字体、布局、视觉或交互结论。原先已经通过的字体、资源合同、舞台居中和剧情体验结论继续保持有效。

### Fixture 身份

```ini
ACCEPTANCE_ROOT = <local-path>
PROJECT_ROOT = <local-path>
STARTER_COPY_MODE = filtered copy; excluded node_modules, dist, logs, cache and .git
FIXTURE_AT_PREP_FILES = 37
FIXTURE_AT_PREP_BYTES = 6705750
FIXTURE_AT_PREP_TREE_SHA256 = 4944FC4A41FEA63D063CE6443BFC12C76E5D7DBE8F5322AFF63E4A58A9B6FE0A
PROJECT_FIXTURE_EQUALS_STARTER_AT_PREP = YES
```

为人工路径增加的隔离场景文件为：

```ini
SCENARIO = <local-path>
SCENARIO_BYTES = 253
SCENARIO_SHA256 = 4F649402C88F177AF767F1130D1023901EFEF0EC82DE0E312225AFCE0C5E95B2
```

人工验收后 fixture 只增加该场景文件：

```ini
FIXTURE_AFTER_ACCEPTANCE_FILES = 38
FIXTURE_AFTER_ACCEPTANCE_BYTES = 6706003
FIXTURE_AFTER_ACCEPTANCE_TREE_SHA256 = DC366E463A2D70EE00BA55819D7A641B93E6317CFF4E5151767D345A1FD9F12D
```

原始 Starter 磁盘回读前后完全一致：

```ini
ORIGINAL_STARTER_BEFORE_FILES = 114
ORIGINAL_STARTER_BEFORE_BYTES = 27694647
ORIGINAL_STARTER_BEFORE_TREE_SHA256 = 1570F1E43C602C62C1B5308EC1F2B43AB9A0DD0CF28927582AD411CF5BBE2B86
ORIGINAL_STARTER_AFTER_FILES = 114
ORIGINAL_STARTER_AFTER_BYTES = 27694647
ORIGINAL_STARTER_AFTER_TREE_SHA256 = 1570F1E43C602C62C1B5308EC1F2B43AB9A0DD0CF28927582AD411CF5BBE2B86
ORIGINAL_STARTER_UNCHANGED = YES
```

Editor 根地址预检返回 HTTP 200，页面标题为 `Surdet 剧本编辑器`；人工验收结束后开发服务器已停止，4173 端口未继续监听。

## 6. 事实边界

### AUTOMATED_FACTS

- A1、A2 聚焦测试、Renderer 全测试、Core 相邻测试、Renderer typecheck/build、Editor build 均有 exit 0 证据。
- 恢复 `verify:all` 只运行一次并 exit 0；历史失败记录仍保留。
- 集成测试使用真实 Core save/load 和 JSON roundtrip，证明 NVL 当前页第三行只保留一次、读档后第四行消失，再推进可继续。
- 项目所有者已报告 NVL 存读档人工路径通过。
- 原始 Starter tree SHA-256 前后一致；人工 fixture 位于 Desktop 且不在仓库内。

### REASONABLE_INFERENCES

- 缺失外层 presentation 被明确恢复为中性状态，避免旧存档把旧 NVL 页面带入新状态。
- 快照只承担 Renderer presentation 可见页，Core 仍负责当前剧情指令重放，因此当前行去重是精确的一条而不是整页猜测。
- 本次测试边界提交不改变运行时代码，只解除恢复全量门对 legacy 测试导入的错误分类。

### UNVERIFIED

- 未对所有浏览器、所有屏幕尺寸和长时间运行进行新的人工视觉量化测量。
- 未运行性能矩阵、Electron、打包或发行验证。
- 未开始真实外部 Agent、Owner Editor 其它主题或下一 Wave 验收。

### OUT_OF_SCOPE

- Backlog、搜索、ADV 当前文本节点、逐字动画、等待剩余时间、选择高亮、自动/快进、设置、音频、视频、timeline 音频游标。
- Core save schema、Renderer presentation version、Starter 内容、主题/Menu/Gallery、seeded RNG、DSL 寻址、Agent store 与 stale recovery。

## 7. Artifact 身份索引

以下路径均为本轮实际磁盘证据，均未进入 Git：

| Artifact | bytes | SHA-256 |
|---|---:|---|
| `<local-path>` | 9065 | `92548A425EA4A8CC4E264A36B1FC5814131DCFE425FCDB2125565F56F1E7F697` |
| `...\task1-red-valid.log` | 9136 | `B3AB477C6D47178D82EC199DC9F0358F22DBC73EBCBBD062E83AC706AB6605C0` |
| `...\task1-red-final.log` | 9955 | `FE8E0683119F7ACA8A3FA4C62664BF018FFF5B93B35AABEF237347C179432656` |
| `...\task2-a1-green.log` | 985 | `8988B29400ABFFE9281ED268E9C279376D22AC8FF6CB84DA4AF37DF050E90E60` |
| `...\task3-dialogue-green.log` | 393 | `354B04CF462EBA01A3508462C1A739CAF8AB9C19BB12F99FBA1F3136DC7A9A8E` |
| `...\task3-controller-green.log` | 908 | `6F9EDE63D926E18F596CBCE1EB30C0972F731EAE712E0110FFDD7FED9EF76A50` |
| `...\task3-roundtrip-green.log` | 2024 | `42D895FBDCAB788F5AFF5E7D6AF8F2A68616197DD46F3FF26F6DBA339DF40DE4` |
| `...\task3-roundtrip-green-final.log` | 2154 | `5DDB95301151C0D150CB59EE0CBFDC4D91EDBD0F7E445874D66EA933401DA17B` |
| `...\task3-roundtrip-green-final2.log` | 429 | `DADE89391844AB4E7AB84CE89FE670109D0950CE3AA2022E6C2C35C594EC9C95CB` |
| `...\task3-renderer-typecheck.log` | 1022 | `4E54004D2D4EBF80C0A061148BDAB5A8C1F2D8929D45C2C9B958E3A39419CE71` |
| `...\task3-renderer-typecheck-final.log` | 73 | `0887975148C79BDE3ABFE26F60A0B98452D61E1A207B702149A2F54B307DCE3B` |
| `...\task3-renderer-build.log` | 66 | `A38A62DF3F9F3E95D3C5EAB05B5B5E53DB3995920B214A062C732A49F9629B91` |
| `...\task4-renderer-full.log` | 3451 | `B60554059622DB5CFD49943FE061A4220F480AE1699C007DA82396C3DE90DAA7` |
| `...\task4-core-adjacent.log` | 440 | `1418FB9B6007821B5A35481275FABA98FDE6E873CFF9D886BF6F3B013B59F3BD` |
| `...\task4-renderer-typecheck.log` | 73 | `0887975148C79BDE3ABFE26F60A0B98452D61E1A207B702149A2F54B307DCE3B` |
| `...\task4-renderer-build.log` | 66 | `A38A62DF3F9F3E95D3C5EAB05B5B5E53DB3995920B214A062C732A49F9629B91` |
| `...\task4-renderer-legacy-recheck.log` | 644 | `C6B0BD755885D20F9217915224D81208CDA878B98D7B747A6967C2B55162C5E7` |
| `...\task4-integration-boundary-fix-test.log` | 429 | `2B011A694655284BA386B100A9466F50CF88E8984A6D9F3307BFF64EB8C62C23` |
| `...\task4-renderer-typecheck-after-boundary-fix.log` | 73 | `0887975148C79BDE3ABFE26F60A0B98452D61E1A207B702149A2F54B307DCE3B` |
| `...\task4-editor-build.log` | 1998 | `C26BFCEE28D7942D3AC7742562A2B364E1EEA42A4E25314ED3A7876F7F3090B0` |
| `...\task4-verify-all.log` | 2910 | `2EFF843285C07F87841A04CB02313C74DADC4F045D47D17CF45612748B4B8742` |
| `...\task4-verify-all-recovery.log` | 58436 | `661C8EDCEBD7DFDB5650D08E2093FAA8D10C6ECC130C9E00C44BF6C937C58264` |

表中 `...` 仅为显示压缩；每个 artifact 的完整目录均为：

```text
<local-path>
```

## 8. 最终交接边界

```text
RENDERER_MISSING_PRESENTATION_COMPATIBILITY_VERIFIED
NVL_PRESENTATION_SNAPSHOT_ROUNDTRIP_VERIFIED
OWNER_NVL_SNAPSHOT_ACCEPTANCE_PASSED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
NEXT_PRE_WAVE_5_THEME_NOT_STARTED
WAVE_5_NOT_STARTED
```

下一步负责人是独立总经理复审。未经新的明确授权，不执行 push、部署、发行或下一主题施工。
