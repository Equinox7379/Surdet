# Editor Foundation Polish Wave 1 Delivery Report

## Status

```ini
WAVE = PRE-WAVE-5 EDITOR FOUNDATION POLISH WAVE 1
EDITOR_FOUNDATION_POLISH_WAVE_1_VERIFIED = REOPENED_FOR_TRACE_LAYOUT_FIX
AUTOMATED_EDITOR_GATES_PASSED = YES
OWNER_ACCEPTANCE = PREVIOUS_PASS_RETAINED; TRACE_RETEST_REQUIRED
PREVIEW_STAGE_CENTERING_PASSED_BY_OWNER = PREVIOUS_PASS_RETAINED; TRACE_RETEST_REQUIRED
REPEATED_PREVIEW_FONT_PATH_PASSED_BY_OWNER = PREVIOUS_PASS_RETAINED
OWNER_OBSERVED_PREVIEW_TRACE_LAYOUT_SHIFT = YES
READY_FOR_INDEPENDENT_MANAGER_REVIEW = NO
WAITING_FOR_OWNER_TRACE_LAYOUT_RETEST = YES
PUSH = NOT_PERFORMED
DEFAULT_PLAYER_UI_POLISH = NOT_STARTED
WAVE_5 = NOT_STARTED
```

本报告记录 Task 0–5 的本地执行事实。代码证据、项目所有者人工验收和文档闭合分别记录，不把自动化测试替代为视觉或交互结论。

## AUTOMATED_FACTS

### Baseline and scope

```ini
BRANCH = main
PLANNING_BASE_HEAD = f0e67ec03600292b6b281b37f40d2d6098398245
CODE_EVIDENCE_HEAD = ad0b266cb4b8f2874d5d842bd5bebb87ca080da7
CODE_EVIDENCE_PARENT = 9e025fbd41620dfcf503f802291d048d5d6f3916
REMOTE_MAIN_AT_TASK_0 = f0e67ec03600292b6b281b37f40d2d6098398245
AHEAD_BEHIND_AT_TASK_0 = 0/0
CODE_SCOPE = packages/editor/** only
FORBIDDEN_WORKSPACES_MODIFIED = NO
HISTORICAL_ARTIFACTS = PRESERVED_NOT_TOUCHED
```

Task 1–3 each used an independent red-green boundary and an ordinary local commit:

```ini
TASK_1_RED = npm run test -w surdet-editor -- test/presentation-asset-catalog.test.ts; exit=1; 1 failed / 3 passed
TASK_1_GREEN = npm run test -w surdet-editor -- test/presentation-asset-catalog.test.ts; exit=0; 1 file / 4 tests passed
TASK_1_COMMIT = 9e6d841216a1e6cd2e2ecc1d7c51d062bfbcc665
TASK_1_SCOPE = packages/editor/test/presentation-asset-catalog.test.ts

TASK_2_RED = npm run test -w surdet-editor -- test/preview-font-transfer.test.ts; exit=1; clonePreviewFontsForTransfer is not a function
TASK_2_GREEN = npm run test -w surdet-editor -- test/preview-font-transfer.test.ts test/preview-runtime-contract.test.ts; exit=0; 2 files / 2 tests passed
TASK_2_COMMIT = 9e025fbd41620dfcf503f802291d048d5d6f3916
TASK_2_SCOPE = packages/editor/src/panels/preview-panel.ts; packages/editor/test/preview-font-transfer.test.ts

TASK_3_RED = npm run test -w surdet-editor -- test/preview-stage-layout.test.ts; exit=1; layout contract absent
TASK_3_GREEN = npm run test -w surdet-editor -- test/preview-stage-layout.test.ts test/preview-runtime-contract.test.ts test/preview-runtime-lifecycle.test.ts; exit=0; 3 files / 3 tests passed
TASK_3_COMMIT = ad0b266cb4b8f2874d5d842bd5bebb87ca080da7
TASK_3_SCOPE = packages/editor/preview.html; packages/editor/test/preview-stage-layout.test.ts
```

Task 3 的第一次聚焦绿灯尝试被测试负向正则误判：`width: 100%` 的匹配跨入了合法的 `max-width: 100%`。只修正了测试声明边界，没有改变生产布局语义；随后同一聚焦门通过。

最终 Editor 自动化门：

```ini
EDITOR_FULL_TEST = PASS; npm run test -w surdet-editor; 28 files / 175 tests
EDITOR_TYPECHECK = PASS; npm run typecheck -w surdet-editor; exit=0
EDITOR_BUILD = PASS; npm run build -w surdet-editor; exit=0
EDITOR_BUILD_WARNING = Vite chunk >500 kB warning only; performance threshold unchanged
GIT_DIFF_CHECK = PASS; exit=0
GIT_CACHED_DIFF_CHECK = PASS; exit=0
TRACKED_WORKTREE_AFTER_CODE = CLEAN
STAGING_AREA_AFTER_CODE = EMPTY
```

### Desktop fixture identity

```ini
FIXTURE_ROOT = <local-path>
FIXTURE_ROOT_OUTSIDE_REPOSITORY = YES
FIXTURE_ROOT_ON_DESKTOP = YES
FIXTURE_SOURCE = E:\surdet\examples\starter
FIXTURE_SOURCE_SCOPE = project source files excluding pre-existing dist/ and node_modules/
FIXTURE_PREP_FILE_COUNT = 37
FIXTURE_PREP_BYTES = 6705750
FIXTURE_PREP_TREE_SHA256_RECORDED = 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6
ORIGINAL_STARTER_PREP_FILE_COUNT = 37
ORIGINAL_STARTER_PREP_BYTES = 6705750
ORIGINAL_STARTER_PREP_TREE_SHA256_RECORDED = 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6
```

Task 5 回读使用同一项目源文件口径，重新比较了每个相对路径、字节数和文件 SHA-256：

```ini
FIXTURE_READBACK_FILE_COUNT = 37
FIXTURE_READBACK_BYTES = 6705750
ORIGINAL_STARTER_READBACK_FILE_COUNT = 37
ORIGINAL_STARTER_READBACK_BYTES = 6705750
FIXTURE_READBACK_COMMON_MISMATCH_COUNT = 0
FIXTURE_READBACK_ONLY_COUNT = 0
PROJECT_FIXTURE_EQUALS_STARTER_AT_READBACK = YES
ORIGINAL_STARTER_UNCHANGED = YES
```

完整递归读数另外包含两边预先存在的 `dist/` 和 `node_modules/`：两边均为 114 个文件、27,692,340 bytes，内容比较同样为 0 项差异。生成目录不计入本 Wave 的项目源文件身份口径。

### Implementation facts

- 资产目录测试重新锁定共享 Authoring 资产目录中的 `timelineTarget = lynn:uniform`。
- 预览字体在 `postMessage` transfer 边界发送克隆 buffer，避免 transfer 操作 detach 缓存本体。
- preview document 使用全 viewport root、grid 双轴居中和 canvas contain 约束。
- 没有修改 Renderer 坐标、游戏分辨率、领域返回结构或 Starter 源码。

## OWNER_REPORTED_VISUAL_FACTS

项目所有者在自动化门通过、桌面 fixture 和浏览器验收路径提供后明确回复：

```text
人工验收通过
```

该回复被记录为本 Wave 的人工验收通过结论。执行 AI 没有代替项目所有者填写每个画面字段、字体观感字段或交互手感字段，也没有把自动化测试结果冒充人工观察结果。

据项目所有者的明确通过结论，人工层状态为：

```ini
OWNER_ACCEPTANCE = PASS
PREVIEW_STAGE_CENTERING_PASSED_BY_OWNER = YES
REPEATED_PREVIEW_FONT_PATH_PASSED_BY_OWNER = YES
OWNER_ACCEPTANCE_SCOPE = 任务书规定的 12 步浏览器路径
```

## UNVERIFIED_INFERENCES

- 本报告没有独立推断项目所有者未逐字展开的视觉细节；人工通过结论的来源是项目所有者本人。
- 当前没有额外截图或逐步交互日志，因此不把未提供的截图、浏览器尺寸或具体场景名称写成事实。
- 浏览器服务返回 200 且标题正确，只证明 Editor 入口可打开，不单独证明全部人工体验；人工结论由项目所有者提供。

## OUT_OF_SCOPE_FINDINGS

- Vite 构建中的大 chunk warning 保留为既有警告，本 Wave 没有修改性能门限。
- 未运行 `verify:all`、Electron、部署、发行或后续基础 Wave 门禁；任务书明确不要求这些动作。
- 未修改 Core、Renderer、Host、Shell、Authoring、CLI、Starter、Zero 或长期路线台账。
- 未执行默认玩家 UI polish、Core seeded RNG、CLI 事务可靠性或 Wave 5。

## HISTORICAL_TASK_5_CLOSURE_GIT_FACTS

```ini
DOCUMENT_PLACEHOLDER_SCAN = PASS_WITH_EXPLICIT_HISTORICAL_AND_OUT_OF_SCOPE_STATES
VERIFY_DOCS = PASS; npm run verify:docs; exit=0
VERIFY_HYGIENE = PASS; npm run verify:hygiene; exit=0; 696 tracked paths
FINAL_DIFF_CHECK_BEFORE_STAGING = PASS; exit=0
FINAL_CODE_HEAD = ad0b266cb4b8f2874d5d842bd5bebb87ca080da7
FINAL_CODE_PARENT = 9e025fbd41620dfcf503f802291d048d5d6f3916
REMOTE_MAIN = f0e67ec03600292b6b281b37f40d2d6098398245
AHEAD_BEHIND_BEFORE_DOC_CLOSURE = 3/0
DOC_CLOSURE_SCOPE = this delivery report; current taskbook only
PUSH = NOT_PERFORMED
NEXT_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

本报告不自指记录其最终 bytes、SHA-256 或尚未产生的提交 hash。文档闭合提交完成后的真实 HEAD、tracking ref、ahead/behind、工作树、暂存区和本报告身份由最终交接回读给出。

## Current owner-observed trace-layout reopening

项目所有者在原 Task 5 的人工验收通过后补充了新的真实画面反馈：因果轨迹随事件增加逐步变高，并挤压上方 Gal 预览舞台。总经理复核确认，现有 `max-height: 180px` 并不能阻止达到上限前的持续增长；问题属于本 Wave 的预览布局稳定性缺口。

```ini
REOPEN_REASON = OWNER_OBSERVED_PREVIEW_TRACE_LAYOUT_SHIFT
PREVIOUS_TASK_5_CLOSURE = REOPENED
PREVIOUS_OWNER_ACCEPTANCE = PASS_RETAINED
PREVIOUS_FONT_RESOURCE_CENTERING_AND_PLOT_CONCLUSIONS = RETAINED
TRACE_DATA_PRESERVED = YES
TRACE_EVENTS_TRUNCATED = NO
TRACE_RETEST_REQUIRED = YES
```

### Trace layout red-green evidence

```ini
TRACE_RED_COMMAND = npm run test -w surdet-editor -- test/preview-stage-layout.test.ts
TRACE_RED_EXIT = 1
TRACE_RED_RESULT = 1 failed / 1 passed; missing stable preview-view/frame bounds and fixed trace height contract

TRACE_GREEN_COMMAND = npm run test -w surdet-editor -- test/preview-stage-layout.test.ts test/preview-runtime-contract.test.ts test/preview-runtime-lifecycle.test.ts
TRACE_GREEN_EXIT = 0
TRACE_GREEN_RESULT = 3 files / 4 tests passed

TRACE_CODE_EVIDENCE_HEAD = a3e59f081e559b3f9b15889edea104e91b810c07
TRACE_CODE_EVIDENCE_SCOPE = packages/editor/src/styles.css; packages/editor/test/preview-stage-layout.test.ts
TRACE_PRODUCTION_TRACE_DATA_CHANGED = NO
TRACE_EVENT_RENDERING_CHANGED = NO
```

修复只增加了预览布局边界：`#preview-view` 和 `.preview-frame` 允许在纵向 flex 中收缩；`.preview-trace` 从首次渲染起使用 `flex: 0 0 clamp(96px, 14vh, 136px)` 与同值 `height`，保留 `overflow-y: auto` 和完整事件内容。事件增加后，滚动发生在轨迹区内部，不截断因果证据。

### Trace repair automated gates

```ini
TRACE_EDITOR_FULL_TEST = PASS; 28 files / 176 tests
TRACE_EDITOR_TYPECHECK = PASS; exit=0
TRACE_EDITOR_BUILD = PASS; exit=0
TRACE_EDITOR_BUILD_WARNING = existing Vite chunk >500 kB warning only
TRACE_DIFF_CHECK = PASS; exit=0
TRACE_CACHED_DIFF_CHECK = PASS; exit=0
TRACE_VERIFY_DOCS = PASS; npm run verify:docs; exit=0
TRACE_VERIFY_HYGIENE = PASS; npm run verify:hygiene; exit=0; 698 tracked paths
TRACE_FORBIDDEN_WORKSPACES_MODIFIED = NO
```

### Current stop state

```ini
OWNER_TRACE_LAYOUT_RETEST = NOT_YET_PERFORMED
FINAL_OWNER_TRACE_CONCLUSION = NOT_CLAIMED
WAITING_FOR_OWNER_TRACE_LAYOUT_RETEST = YES
PUSH_NOT_AUTHORIZED = YES
WAVE_5_NOT_STARTED = YES
```
