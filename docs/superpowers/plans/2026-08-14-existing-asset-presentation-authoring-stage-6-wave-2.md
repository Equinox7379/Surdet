# Surdet Stage 6 Wave 2 实施任务书
# Existing-Asset Presentation Authoring Vertical Slice
# （既有资源驱动的场景演出纵向切片）

> 状态：**实施任务书，待项目所有者批准派发执行 AI。**
> 设计基线：设计规格修订版 2（提交 `c48067ecac8e409132045867b6bc76fbf70fe88b`，27,681 bytes，SHA-256 `D534A8FB4142E806B2D21A4022B49E5DB057C2BF7C2C321E58BD6BF184BE54F0`）。
> 本任务书不授权修改生产代码、派发执行 AI 或 push；项目所有者单独批准派发后，执行 AI 才按本任务书施工。
> 编写时间：2026-08-14（Asia/Shanghai）。编写者：临时总经理（DeepSeek V4）。

## 一、阶段归属与工程目标

- **阶段**：Stage 6 Wave 2（延续 Wave 1 已闭合的 Agent-Ready Authoring 纵向切片路线）。
- **为什么现在做**：Wave 1 的类型化写操作止于 scene/variable；timeline 是 Galgame 演出核心对象，Core 校验与 Renderer 播放/投影实现均已成熟，是能力扩展的最近真实缺口。
- **目标**：让外部桌面 Agent 发现已有背景/立绘资源 → 通过共享类型化 authoring 能力创建或修改一段最小 timeline → 用既有 `@timeline` 语义连接场景 → 在正式 Surdet Presentation 预览中证明背景切换、角色登场和一次 screen fade 确实发生 → 项目所有者在编辑器中理解、反向定位、预览、保存和重开这段演出。
- **验收落点**：静态校验、Core blocking 运行、正式投影（`stage.*` 前后真实变化）、项目所有者人工验收四层证据。

## 二、任务书级强制约束（Codex 4.75 固化，不得偏离）

### 约束 1：FORMAL 初始基线必须干净

Starter `ch01_01.gal` 原有 `@timeline intro_cinematic @ blocking`（会显示 `lynn:uniform`），因此**禁止**把 `@timeline agent_blackout` 简单追加到 Starter 场景末尾。本任务书采用方式 (a)：**由 Agent 用 `scene.create` 在隔离 fixture 中创建新隔离场景 `agent_probe`**（文件 `content/scenario/agent_probe.gal`，含 `@label start` 与 `@timeline agent_blackout @ blocking`，不含任何其它 `@timeline` 或立绘指令）。FORMAL 必须证明触发 agent_blackout 之前 `stage.portraits` 不含 `lynn:uniform`、`stage.backgroundKey ≠ night_field`、`stage.fadeAlpha = 0`；不得用"场景后面追加"冒充立绘从不可见到可见。

### 约束 2：资源发现必须共享且只读

`@surdet/authoring` 新增**只读 asset catalog 适配器**，语义唯一来源是共享层：

- CLI 与 editor 各自只提供 `content/assets/**` 的路径/文件名/扩展名元数据（Node 侧 `listFiles()` 已能枚举；editor 侧通过既有目录句柄枚举 `content/assets` 下的 bg/portrait 文件路径），**不读文件内容、不把 SVG/图片二进制读进 ProjectSnapshot**（`isSnapshotPath` 保持不变，资源文件不进快照/修订）；
- 共享层统一解析命名规则（`bg/<key>.<ext>`；`portrait/<role>_<outfit>_<expression>.<ext>`）与受支持格式集合，输出 `{ backgrounds, portraits }` 两类的 `AssetEntry[]`；
- **禁止**在 CLI 与 editor 各写一份资源解析器；**禁止**写入、移动、重命名或覆盖任何资源。
- 验收：CLI 与 editor 对同一 fixture 的同一路径元数据输入必须返回**逐字段相同的 catalog**（用同一份共享单元测试锁定）。

### 约束 3：fade 中间值必须帧采样

FORMAL 证明 `0 < stage.fadeAlpha < 1` 必须用**实际播放帧时间序列采样**（runner 以 ≤100ms 间隔连续轮询，或使用 rAF 帧回调收集样本，覆盖 cue 2 的 700ms 窗口），**禁止固定 sleep 一次后单次读取**。

## 三、文件白名单与禁止项

### 允许修改/新增

- `packages/authoring/src/`：`contracts.ts`（新增类型）、新 `timeline-operations.ts`、新 `asset-catalog.ts`、`object-index.ts`（track/cue/asset 索引与四向因果）、`validation.ts`（timeline 校验接线）、`diff.ts`（operation-ledger 对象级 diff）、`index.ts`（导出）。
- `packages/authoring/test/`：新增 `timeline-operations / asset-catalog / object-index / validation / diff` 聚焦测试。
- `packages/cli/src/authoring/`：`authoring-service.ts`（注册 timeline.create / timeline.patch / assets 查询 / object.inspect 扩展）；`node-project-storage.ts` 仅在资产路径枚举不足时做最小扩展；`authoring-command.ts` 或命令注册面新增两条命令。
- `packages/cli/test/`：新增 CLI 合同与纵向切片测试。
- `packages/editor/src/`：`authoring-project-storage.ts`（`listFiles` 扩展资产路径元数据）、`project-io.ts`（如需要，仅枚举资产路径）、`causal-selection.ts`/`panels/right.ts`/`panels/preview-panel.ts`（因果区对象范围扩展，复用 Wave 1 机制与现有 timeline 面板/Cue 检查器）。
- `packages/editor/test/`：新增聚焦测试。
- `packages/shell/e2e/agent-ready-presentation-wave-2.e2e.mjs`（新 runner）与 `packages/shell/package.json`（新增脚本 `e2e:authoring:wave2` 指向该 runner；runner 参数：`--preflight`=入口一致性预检、`--diagnostic`=有界诊断、缺省=唯一 FORMAL）。
- 本任务书与新建的 Wave 2 交付报告。

### 禁止修改/触碰

Core、Renderer、Host、Shell 生产代码（投影证据字段已存在，零改动）；Starter 原始内容；game.config、growth、存档 schema；Wave 1 任务书与交付报告；长期路线台账；AGENTS.md；受保护文件；音频/性能/发行相关文件；assets 目录下的任何资源文件（只读枚举）。

## 四、Task 0–6 固定纪律

执行 AI 每轮按此顺序施工，不得合并多主题。

### Task 0：读取权威资料与真实基线

按序完整读取：`AGENTS.md` → 长期路线台账 → 本任务书 → 设计规格修订版 2 → Wave 1 任务书/交付报告 → 临时执行 AI 交接书。随后只读记录：`git rev-parse HEAD`、`git rev-parse surdet/main`、`git rev-list --left-right --count HEAD...surdet/main`、`git status --short --untracked-files=all`、`git diff --check`、`git diff --cached --check`、tracked `*.log`。不得 reset/checkout/clean/stash/删除/移动任何文件。

### Task 1：建立与症状匹配的最小红灯

按第五节的每个能力先写红灯再实现，红灯必须真实失败一次并保留证据，不得改写为通过。

### Task 2：最小范围实现（白名单内）

按共享层 → CLI → editor → harness 顺序：asset-catalog（只读解析）→ timeline-operations（create/patch）→ object-index 扩展 → validation 接线 → diff ledger → CLI 命令 → editor 接线 → Wave 2 runner。任何一处发现需要修改白名单外文件，立即停止并报告，不猜测性扩大。

### Task 3：聚焦验证（精确测试文件，禁止整包测试）

- `npm run test -w @surdet/authoring -- test/timeline-operations.test.ts test/asset-catalog.test.ts test/timeline-object-index.test.ts test/validation-timeline.test.ts test/diff-ledger.test.ts`；
- `npm run typecheck -w @surdet/authoring`、`npm run build -w @surdet/authoring`；
- `npm run test -w @surdet/cli -- test/authoring-presentation-wave2.test.ts`；CLI typecheck/build；
- `npm run test -w surdet-editor -- test/presentation-asset-catalog.test.ts`；editor typecheck/build；
- `node --check packages/shell/e2e/agent-ready-presentation-wave-2.e2e.mjs`；
- preflight：`npm run e2e:authoring:wave2 -w @surdet/shell -- --preflight`（入口一致性预检：与正式路径同 launcher/cwd/dist/入口/fixture，禁止替身 server、错误入口、只测内部函数的自检）。
- **禁止整包 `npm run test -w <pkg>`**：整包测试包含与本轮无关的历史红灯面（如 editor 全量测试的既有断言、Wave 1 遗留面），重复运行浪费额度；必须按上面写死的文件级命令运行。
- `verify:all`、Electron、性能矩阵不在本轮。

### Task 4：更新 Execution Ledger 与交付报告（FORMAL 完成后才执行）

在唯一 FORMAL 完成后，才执行本 Task：任务书末尾追加 Execution Ledger；新建 `docs/EXISTING-ASSET-PRESENTATION-AUTHORING-STAGE-6-WAVE-2-DELIVERY-REPORT-2026-08-14.md`，末尾列"建议由总经理登记的事实"，不得修改长期路线台账。FORMAL 之前不得写最终交付报告（若 FORMAL 失败，只记录失败事实并保留 artifact）。

### Task 5：磁盘回读

从磁盘重新读取：HEAD/远端关系/工作树；所有新增文件路径、字节数与 SHA-256；DIAGNOSTIC/FORMAL artifact 的 path/bytes/SHA-256/status/runHead（必须等于 `CODE_EVIDENCE_HEAD`）；失败证据保留。

### Task 6：两次提交与停止（顺序见 6.2）

按 6.2 顺序完成两次普通本地提交：先**代码证据提交**（仅代码白名单文件，记录 `CODE_EVIDENCE_HEAD`），取证完成后最后**文档闭合提交**（仅本任务书与交付报告）。每次提交：`git add --` 精确文件 → `git diff --cached --check` → `git diff --cached --name-status` 核对范围 → 提交 → 提交后立即回读。两次提交都不得 push、部署、打包、发行、改史；停止在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`。

## 五、各能力实现规格（契约要点）

1. **timeline.create**：`{ operationId, timelineId, definition }`。写入前强制 `timelineId === definition.id === content/timelines/<file-stem>.json` 的 file-stem，任一不一致 → `VALIDATION_FAILED` 且不生成文件；`timelineId` 或目标文件已存在 → `OBJECT_PRECONDITION_FAILED`；定义只含白名单 track/action（`background.set`、`portrait.show/hide/move/expression`、`screen.fade`），白名单外 → `UNSUPPORTED_OPERATION`；写入前经 Core `validateTimeline`，结构错误 → validation error 且不 staging。
2. **timeline.patch**：`{ operationId, timelineId, patch }`，**一次只执行一个 patch**；五种 op（`addTrack` 验 timeline 指纹；`removeTrack`/`insertCue` 验 track 指纹；`replaceCue`/`removeCue` 验 cue 指纹）。指纹 = 该对象规范化 JSON 片段的 SHA-256（规范化规则由共享层唯一实现并测试固定）。指纹不符 → `OBJECT_REF_STALE`；引用不存在 → `OBJECT_NOT_FOUND`；一次 patch 全有或全无，失败不得改 `workingFiles`/`workingRevision`/operation ledger；禁止失效引用模糊重定位。多次 patch 在同一 change 事务串行执行，每次成功后 `workingRevision` 增加，调用方重新 `object.inspect`。
3. **asset catalog**：共享层 `buildAssetCatalog(paths: readonly string[])` 输出 `{ backgrounds: AssetEntry[], portraits: AssetEntry[] }`；`AssetEntry = { kind: 'background'|'portrait', key, role?, outfit?, expression?, sourcePath, format, resolved }`；`resolved = 路径存在 && format ∈ 共享层定义的受支持格式集合`（以仓库现有资源加载器事实为基线，先固化 svg）。asset 语义身份：`asset:bg:<key>`、`asset:portrait:<role>:<outfit>:<expression>`。
4. **object.inspect**：支持 `timeline` / `track` / `cue` / `asset` 四类 ref，返回结构、来源位置（timeline 文件路径 + JSON 路径）、references、referencedBy。
5. **project.inspect 扩展**：`assets` 字段 = asset catalog 结果。
6. **project.validate**：对快照内每个 timeline 文件调用 Core `validateTimeline`，结构诊断进 validation error 信封；资源引用（cue.key / track.target+expression）解析失败 → warning（`objectRef` + `action`），**不拒绝、不阻止 commit**。
7. **scene.patch 复用**：instruction block 写 `@timeline <id> [@ blocking]` 已是既有能力；只补 object-index 因果边（`@timeline` 指令 → `timeline:<id>`）与 validate 的目标 timeline 存在性检查。
8. **change.diff**：timeline 按稳定语义 ID `timeline:<id>` 对齐；track/cue **没有持久语义 ID**，对象级 semantic diff 由已成功执行的类型化 operation ledger 产生，每条含 `operationId / operation kind / objectBefore / objectAfter / fingerprintBefore / fingerprintAfter / directChange / potentialImpact / observedImpact`；文件级 JSON diff 保留但不得用数组位置猜身份、不做模糊树匹配。

## 六、harness 纪律与正式运行命令（写死，不得替换）

### 6.1 注册脚本与三条命令

`packages/shell/package.json` 注册：

```json
"e2e:authoring:wave2": "node e2e/agent-ready-presentation-wave-2.e2e.mjs"
```

- **preflight**（先于任何 DIAGNOSTIC，与正式路径同 launcher/cwd/dist/入口/fixture；禁止替身 server、错误入口、只测内部函数的自检）：

```text
npm run e2e:authoring:wave2 -w @surdet/shell -- --preflight
```

- **DIAGNOSTIC**（最多 3 次；每次必须产生新的增量 artifact，路径唯一、不得覆盖旧 artifact）：

```text
npm run e2e:authoring:wave2 -w @surdet/shell -- --diagnostic
```

- **FORMAL**（runner 候选版本冻结提交且诊断全绿后，只运行一次；失败保留 artifact，禁止重跑与覆盖）：

```text
npm run e2e:authoring:wave2 -w @surdet/shell
```

第 3 次 DIAGNOSTIC 仍失败 → 停止并复审方法，不修一处跑一次（禁止"一修一 FORMAL"）。

### 6.2 提交与取证顺序（写死）

1. 代码、测试、editor 接线与 runner 全部完成后，先精确暂存**代码白名单文件**（不含本任务书与交付报告），核对 `git diff --cached --check` 与 `git diff --cached --name-status`，创建**代码证据提交**（如 `feat(authoring): add presentation timeline authoring`），提交后立即回读并记录 `CODE_EVIDENCE_HEAD`。
2. preflight、全部 DIAGNOSTIC 与唯一 FORMAL **必须基于 `CODE_EVIDENCE_HEAD` 的已提交 runner**，不得在未提交工作树上取证。
3. DIAGNOSTIC 最多 3 次，每次生成新的 artifact；诊断全绿后只运行一次 FORMAL；每次运行的 `artifact.runHead` 必须等于 `CODE_EVIDENCE_HEAD`。
4. 失败 artifact 必须保留，不得重跑、覆盖或筛选。
5. FORMAL 完成后，才更新本任务书 Execution Ledger 与新建 Wave 2 交付报告。
6. 最后精确暂存**仅本任务书与交付报告**，核对缓存范围后创建**文档闭合提交**（如 `docs(authoring): report stage 6 wave 2 presentation slice`）。
7. 代码证据提交与文档闭合提交**两次都不得 push**、部署、打包、发行或改史。

### 6.3 artifact 回读要求（每次 DIAGNOSTIC 与 FORMAL 后从磁盘回读）

- `path`（DIAGNOSTIC 每次唯一路径；FORMAL 单份唯一路径）；
- `status`（PASSED/FAILED）、`evidenceClass`（DIAGNOSTIC/FORMAL）、`runHead`（必须等于 `CODE_EVIDENCE_HEAD`）、`targetSceneId`、`targetLabel`；
- `bytes` 与 `SHA-256`（磁盘实测，不得凭记忆填写）；
- 失败 artifact 一律保留，不得删除、覆盖或筛选。

### 6.4 显式场景选择（所有正式运行）

CLI `runtime.run-from`、共享 authoring 模拟、preview 启动与 FORMAL **必须显式指定 `sceneId = agent_probe`、`label = start`**：

- 不得依赖 `game.config.entryScene`，不得默认从 `ch01_01` 启动；
- CLI run-from 输入 JSON 显式携带场景/标签；共享模拟入口显式传初始场景；preview 父页 postMessage 显式加载 `agent_probe`；
- artifact 必须记录 `targetSceneId = 'agent_probe'` 与 `targetLabel = 'start'`；
- FORMAL 必须断言目标场景确实为 agent_probe/start（preview 实际加载的场景 ID 与 artifact 记录一致）。

### 6.5 browser/Vite 清理与 FORMAL 断言

1. browser 与 Vite child 由 runner 精确拥有，成功/失败路径都清理（Wave 1 4.59/4.60 教训固化）。
2. FORMAL 断言（使用 `queries.presentation.snapshot()` 的 `stage.*`，**不得用 `projectionSnapshot().world`**）：
   - 初始（触发 agent_blackout 前）：`stage.portraits` 不含 `key === 'lynn:uniform'`；`stage.backgroundKey !== 'night_field'`；`stage.fadeAlpha === 0`（约束 1）；
   - 播放后：`stage.backgroundKey === 'night_field'`；`stage.portraits` 含 `key === 'lynn:uniform'` 且 `view.expression === 'night'`；
   - fade 轨迹：达到 1 → **帧采样**捕获至少一次 `0 < fadeAlpha < 1` → 播放完成后回到 0（约束 3）；
   - 资源门槛：night_field 与 lynn_uniform_night 在 catalog 中 `resolved === true`；CLI 与 editor catalog 逐字段一致（约束 2）；
   - 错误通道全空；不允许只验证 cue/事件名存在或"最终状态本来就等于目标状态"。

## 七、最小 fixture 与人工验收路径

1. fixture = Starter 隔离副本（`game.config.json` + `content/**`），不含 node_modules/dist/src/test/Git 元数据；创建前后核对原始 Starter 身份不变。
2. Agent 编排：`scene.create agent_probe`（含 `@label start` 与 `@timeline agent_blackout @ blocking`）→ `timeline.create agent_blackout`（background.set night_field + portrait.show lynn:uniform:night + screen.fade 两段 cue：`atMs=0,durationMs=0,alpha=1` 与 `atMs=50,durationMs=700,alpha=0`）→ `project.validate` → `change.diff` → `change.commit`。
3. **显式场景选择**：所有正式运行（CLI `runtime.run-from`、共享模拟、preview 启动、FORMAL）显式指定 `sceneId = agent_probe`、`label = start`，不得依赖 `game.config.entryScene`、不得默认从 `ch01_01` 启动；artifact 记录 `targetSceneId`/`targetLabel`（见 6.4）。
4. 人工验收（项目所有者 Chrome/Edge，只报告异常）：编辑器打开 fixture → 显式选择 agent_probe 场景 → 因果区从 `@timeline` 指令看到 `timeline:agent_blackout` 与背景/立绘资产引用 → 预览真实看到背景切到 night_field、lynn 登场、一次 fade 淡出 → 从预览轨迹反向定位到 timeline cue → 用现有 timeline 面板/Cue 检查器微调一处 cue（如 expression 改 despair）→ 预览 → 保存 → 刷新重开仍在。

## 八、与本轮无关的历史问题（明确不处理）

Stage 5 已修复的混合 EOL（现为 authoring 共享能力，非红灯）；GrowthSystem 共享模拟（已恢复）；Wave 1 因果桥（已闭合）；音频占位音与音频生产冻结；性能资格化；发行/打包/部署；Legacy 与文档治理；远端 GitHub Actions 账单限制（4.26 登记的外部基础设施事实，非本轮阻断）。

## 九、结束状态与停止点

执行 AI 完成 Task 6 后必须停在：

```text
STAGE_6_WAVE_2_IMPLEMENTED_LOCALLY
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED_AFTER_STAGE_6_WAVE_2
STAGE_6_WAVE_3_NOT_STARTED
```

随后由临时总经理独立复审提交、diff、命令、artifact 与 fixture 身份；人工验收与 push 均需项目所有者另行明确授权。

## Execution Ledger

> 执行 AI 从 Task 0 开始按时间顺序追加；不得预填未运行结果，不得改写历史失败记录。

### Task 0 基线（2026-08-14 12:0x +08:00）

- 按序完整读取 AGENTS.md、长期路线台账（含 4.72–4.79）、本任务书、设计规格修订版 2、Wave 1 任务书/交付报告与临时执行 AI 交接书。设计规格磁盘实测 `27681` bytes、SHA-256=`D534A8FB4142E806B2D21A4022B49E5DB057C2BF7C2C321E58BD6BF184BE54F0`；本任务书磁盘实测 `18901` bytes、SHA-256=`C541310C4007D68AEC035273BB53A5C87849DDE3362BA3EBA825DB3BD119055B`，均与台账 4.75/4.78 一致。
- 真实 Git：branch=`main`；`HEAD=44c289fb74b194bfa48ccd09479b3714d43f0015`；`surdet/main=3da114754c37e83e624649e2391c7f03acc12e0f`；ahead/behind=`7 0`；tracked 工作树与暂存区干净，既有未跟踪治理文件未触碰。

### Task 1 红灯（2026-08-14 12:0x +08:00）

- 五个新 authoring 测试文件先写红灯：`test/timeline-operations.test.ts`、`test/asset-catalog.test.ts`、`test/timeline-object-index.test.ts`、`test/validation-timeline.test.ts`、`test/diff-ledger.test.ts`。首次运行 exit=`1`，5 个文件全部失败（模块尚不存在 + 3 个真实断言红灯：track/cue 对象缺失、timeline 因果边缺失、指纹能力缺失）。红灯证据保留在本轮 Ledger，未改写为通过。
- CLI 纵向测试 `packages/cli/test/authoring-presentation-wave2.test.ts` 与 editor 测试 `packages/editor/test/presentation-asset-catalog.test.ts` 在实现前同样以红灯起步（`timeline` 命令族未注册 → exit=`1`）。

### Task 2 实现（2026-08-14 12:0x +08:00）

- 共享层：新增 `asset-catalog.ts`（只读解析 bg/portrait 命名与支持格式，resolved=格式受支持）、`timeline-operations.ts`（timeline.create 身份不变量/白名单/Core 校验；五种单 patch 原子操作；SHA-256 规范化指纹）；扩展 `object-index.ts`（timeline/track/cue/asset 对象与四向因果、@timeline 指令边）、`validation.ts`（validateTimeline 结构 error、资源引用 warning、TIMELINE_MISSING）、`diff.ts`（operation ledger 对象级 diff）、`contracts.ts`/`index.ts`。
- CLI：注册 `timeline.create`/`timeline.patch`/`project.assets`（capabilities 14→17）；object.inspect 支持 `--change` 事务视图并附 SHA-256 指纹；project.inspect 扩展 assets catalog；validate 注入 assetCatalog；simulate 显式场景（代理 entryScene，共享模拟器不复制）。
- editor：project-io 记录 handle→资产相对路径；authoring-project-storage.listFiles 枚举 content/assets 路径（不读内容，快照仍排除资产）；causal-selection 扩展 track/cue/asset 显示与 stage→cue 反向定位纯函数；preview-panel 对 @timeline 事件用前后 stage 差异定位 cue；right.ts 时间轴对象展示轨道/Cue 子列表。
- harness：新增 `packages/shell/e2e/agent-ready-presentation-wave-2.e2e.mjs`（--preflight/--diagnostic/缺省 FORMAL），shell 注册 `e2e:authoring:wave2`（`node e2e/...` workspace 路径）。

### Task 3 聚焦绿灯（2026-08-14 12:0x +08:00）

- authoring 五文件聚焦测试 5 files / 30 tests 全绿；authoring typecheck/build exit=`0`。
- CLI `test/authoring-presentation-wave2.test.ts` 1/1 通过（完整纵向链：17 能力 → assets/inspect catalog 一致 → begin → scene.create agent_probe → timeline.create → object.inspect 指纹 → 三种 patch 串行 → 指纹过期 OBJECT_REF_STALE → 白名单外 UNSUPPORTED_OPERATION → 身份不一致 VALIDATION_FAILED → validate 绿灯 → simulate 显式 agent_probe → run-from 显式 → diff ledger 4 条 → commit 磁盘回读）；CLI typecheck/build exit=`0`。
- editor `test/presentation-asset-catalog.test.ts` 4/4 通过；editor typecheck/build exit=`0`（既有大 chunk warning 保留，未修改性能门限）。
- `node --check packages/shell/e2e/agent-ready-presentation-wave-2.e2e.mjs` exit=`0`。
- 未运行整包测试、`verify:all`、Electron、性能矩阵（任务书禁止整包）。

### 代码证据提交与 preflight（2026-08-14 12:0x +08:00）

- 代码证据提交 `748458e0621fa83096afc701647eb100cd4e34a0 feat(authoring): add presentation timeline authoring`：24 个白名单文件（+3087/-38），`git diff --cached --check` exit=`0`，`--name-status` 精确核对无夹带。
- preflight 基于 `748458e` 运行 exit=`0`：`PREFLIGHT_PASSED`、`runHead=748458e`、CLI/editor dist 与 Vite CLI 存在、正式 launcher 启动真实 preview.html（frame pathname=/preview.html、canvas、surdet-preview-ready）、Starter 只读 catalog 门槛通过。preflight 不创建 fixture/artifact。

### DIAGNOSTIC 1 失败（2026-08-14 12:0x +08:00）——harness 资产传输序列化缺陷

- 新 artifact `<local-path>`：`8965` bytes、SHA-256=`E08628B9B7E44534423BD9CEE7F53A5A9C8DF8E59B90441361B1172EFA8C6818`、`status=FAILED`、`runHead=748458e`、最后通过 `editor.preview.frame`、首个失败（artifact 实测）`startup`（postMessage transfer 列表在 Playwright evaluate 序列化后不再 transferable；本记录按 4.81 以 artifact 实测为准修正措辞）。
- 根因是 runner 把 ArrayBuffer 作为 evaluate 参数传递的序列化假设错误；修正为 base64 载荷 + 浏览器侧重建 ArrayBuffer 后再 transfer。修正提交 `dc7f93a086fa569c828944d3b733c6c56bb66091 test(authoring): fix wave 2 preview asset transfer`。未修改生产代码或其它断言。

### DIAGNOSTIC 2 失败（2026-08-14 12:0x +08:00）——harness 消息等待谓词序列化缺陷

- 新 artifact `<local-path>`：`10986` bytes、SHA-256=`4683149199BEA2EC6AB43CED9E95904A1566436D64DBDA5E913DDD2F14E7851D`、`status=FAILED`、`runHead=dc7f93a`、最后通过 `editor.preview.frame`、首个失败 `editor.preview.trace-start.scene-target`（waitForFunction 不能序列化谓词函数）。
- 根因是 runner 把 predicate 源码字符串传进浏览器侧 waitForFunction；修正为 Node 侧 50ms 轮询父窗口消息数组（消息只增不丢）。修正提交 `7dda6a7d485d715c77e5bb1774b66b30afca7ea3 test(authoring): poll preview messages in wave 2 runner`。未修改生产代码或其它断言。

### DIAGNOSTIC 3 失败（2026-08-14 12:0x +08:00）——fade 帧采样错过 1.0 平台期 → 停止

- 新 artifact `<local-path>`：`15442` bytes、SHA-256=`54D354FB40D833E408EC409975230089698C9474C0E57F81388F693F64807705`、`status=FAILED`、`runHead=7dda6a7`、最后通过 `editor.preview.timeline-event.clean-baseline`、首个失败 `editor.preview.fade.frame-sampling`。
- 已通过的证据：显式 `agent_probe/start` 目标断言通过（trace-start 记录 targetSceneId/targetLabel）；触发 agent_blackout 前 `stage.portraits` 不含 `lynn:uniform`、`backgroundKey ≠ night_field`、`fadeAlpha === 0` 干净基线断言通过；第一帧后 `backgroundKey === night_field` 通过。
- 失败事实：rAF 帧采样最大 `fadeAlpha=0.9985963032133129`，未达到严格 `1`。根因是采样注入发生在 timeline 事件消息到达 parent 之后（消息传递 + evaluate 往返约 100ms+），而 cue1（atMs=0、durationMs=0、alpha=1）的 `alpha=1` 平台只有 50ms 就被 cue2 淡出覆盖；采样因此从淡出中段开始，错过 1.0 平台。这不是 Core/Renderer/editor 生产缺陷，也不是 fade 没有发生（`0.9986→0` 的淡出轨迹与第一帧 microtask 快照都证明 fade 真实发生）。
- 已就绪但未执行的方法修正（等待授权）：(1) 把 rAF 采样注入提前到 `surdet-preview-trace-start` 消息到达时（timeline 触发前），使采样覆盖 cue1 的 1.0 平台；(2) 用 timeline 事件的 `presentationAfter.stage.fadeAlpha === 1` 第一帧快照与 rAF 采样互证"达到 1"；(3) 中间值断言（0<α<1）与完成后回 0 断言保持不变。
- 按任务书与设计规格 G.4：第 3 次 DIAGNOSTIC 仍失败，停止取证，不修一处跑一次。三份 FAILED artifact 均保留、未覆盖、未复用；三个桌面 fixture 保留；未 push、未改史。

### 停止状态（2026-08-14 12:0x +08:00）

```text
DIAGNOSTIC_BUDGET_EXHAUSTED
DIAGNOSTIC_1_HARNESS_TRANSFER_FIXED_AND_COMMITTED
DIAGNOSTIC_2_HARNESS_WAIT_FIXED_AND_COMMITTED
DIAGNOSTIC_3_FADE_SAMPLING_WINDOW_CONFIRMED
FADE_SAMPLING_METHOD_FIX_READY_PENDING_AUTHORIZATION
CODE_EVIDENCE_CHAIN = 748458e -> dc7f93a -> 7dda6a7
FORMAL_NOT_RUN
STAGE_6_WAVE_2_NOT_VERIFIED
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED_AFTER_STAGE_6_WAVE_2
STAGE_6_WAVE_3_NOT_STARTED
```

下一停止点：向临时总经理报告三次失败证据与方法复审结论，申请"修正 fade 采样窗口并重新开始 DIAGNOSTIC 序列（≤3 次）"的裁决；未获批前不修改 runner、不运行 DIAGNOSTIC/FORMAL、不创建交付报告。

### 治理收口与重新取证授权（2026-08-14 12:4x +08:00）

临时总经理按台账 4.80/4.81 书面授权（经项目所有者转达）：本轮唯一主题是 DIAGNOSTIC 方法修正 + 提交治理收口 + 重新取证。

- **方法修正（两个文件，白名单）**：
  1. `packages/shell/e2e/agent-ready-presentation-wave-2.e2e.mjs`：(a) rAF 采样注入提前到 `surdet-preview-trace-start` 消息到达时（interp.start 之前发出，覆盖 cue1 的 `alpha=1` 平台）；(b) clean-baseline 步骤新增断言：timeline 事件第一帧 `presentationAfter.stage.fadeAlpha === 1`（容差 0.001），作为"达到 1"的主证据；(c) 中间值（0<α<1）与完成后回 0 断言不变。
  2. `packages/cli/test/authoring-contract.test.ts`：能力数断言 14→17 最小更新（只改数字断言与用例名，未改其它逻辑）。
- **聚焦验证（真实运行，exit 0）**：`node --check packages/shell/e2e/agent-ready-presentation-wave-2.e2e.mjs`；`npm run test -w @surdet/cli -- test/authoring-contract.test.ts`（2/2 通过）；`npm run e2e:authoring:wave2 -w @surdet/shell -- --preflight`（`PREFLIGHT_PASSED`）。未运行整包测试、`verify:all`、Electron、性能矩阵。
- **提交治理**：精确暂存上述两个文件（`git diff --cached --check` exit=`0`，`--name-status` 只有二者）后创建普通本地提交：

```text
dcf2905837e7da2ce80c4ae1a60d0b7ee379fc32
test(authoring): fix wave 2 fade sampling window
```

- **HEAD 链与治理收口说明**：本 Wave 代码证据链为 `748458e → dc7f93a → 7dda6a7 → dcf2905`。此前三次 DIAGNOSTIC 的 `artifact.runHead` 分别为 `748458e`、`dc7f93a`、`7dda6a7`，滚动变化不满足任务书"固定 CODE_EVIDENCE_HEAD"契约，已按 4.80/4.81 收口：不把三次失败取证伪装成同一 frozen HEAD 下的证据；自本轮起，**新 CODE_EVIDENCE_HEAD = `dcf2905837e7da2ce80c4ae1a60d0b7ee379fc32`**，其后所有 DIAGNOSTIC/FORMAL 的 `artifact.runHead` 必须等于它。
- **非阻断遗留确认（4.81 第 6 条）**：Temp 下 59 个 `surdet-player-experience-wave-2-task*` 目录，最后写入时间均为 2026-08-11，来源是历史 Player Experience Wave 2 的 CLI 测试残留，与本轮 Stage 6 Wave 2 无关；本轮未创建、未触碰该类目录（详情记入交付报告）。
- **非阻断遗留确认（4.81 第 6 条）**：Temp 下 59 个 `surdet-player-experience-wave-2-task*` 目录，最后写入时间均为 2026-08-11，来源是历史 Player Experience Wave 2 的 CLI 测试残留，与本轮 Stage 6 Wave 2 无关；本轮未创建、未触碰该类目录（详情记入交付报告）。
- 重新取证预算：DIAGNOSTIC ≤3 次（新预算，每次唯一 artifact 路径）；全绿后冻结 runner，只运行一次 FORMAL。未 push、未改史、未修改生产代码。

### 重新取证 DIAGNOSTIC 1（新预算，2026-08-14 12:4x +08:00）——PASSED

- 新 artifact `<local-path>`：磁盘实测 `15958` bytes、SHA-256=`0348226AE1E983BB3CF9423BF1066245088E5B0F12F3221E5662EE0EACCDFF6A`、`status=PASSED`、`evidenceClass=DIAGNOSTIC`、`runHead=dcf2905837e7da2ce80c4ae1a60d0b7ee379fc32`（等于新 CODE_EVIDENCE_HEAD）。
- 关键证据：`targetSceneId=agent_probe`、`targetLabel=start`；触发前 `stage.fadeAlpha=0`、`backgroundKey` 为空、`portraits` 为空；第一帧 `presentationAfter.stage.fadeAlpha=1` 且 `backgroundKey=night_field`；播放完成后 `backgroundKey=night_field`、`lynn:uniform` 表情 `night`、`fadeAlpha=0`；rAF 帧采样 41 帧，`max=1`、中间值（0<α<1）28 帧、最后一帧 `0`；六类错误通道全空；browser/Vite 清理字段全成功。旧三份 FAILED artifact 未覆盖、未复用。

### 唯一 FORMAL（2026-08-14 12:4x +08:00）——PASSED

- 命令：`npm run e2e:authoring:wave2 -w @surdet/shell`（缺省 FORMAL），实际 exit=`0`，只运行一次。
- 新 artifact `<local-path>`：磁盘实测 `15368` bytes、SHA-256=`737FF06901BBB34084FB9078FFE3A617C72A6FC7A13565BCEF0544E2A751FCC2`、`status=PASSED`、`evidenceClass=FORMAL`、`runHead=dcf2905837e7da2ce80c4ae1a60d0b7ee379fc32`（等于 CODE_EVIDENCE_HEAD）。
- FORMAL 断言全部通过：显式场景 `targetSceneId=agent_probe`/`targetLabel=start`（trace-start 实测一致）；触发 agent_blackout 前 `stage.portraits` 不含 `lynn:uniform`、`backgroundKey ≠ night_field`、`fadeAlpha === 0`；第一帧 `fadeAlpha === 1` 且 `backgroundKey === night_field`；播放后 `stage.backgroundKey === 'night_field'`、`stage.portraits` 含 `lynn:uniform` 且 `view.expression === 'night'`；rAF 帧采样 37 帧（`max=1`、中间值 28 帧、最后一帧 `0`）；catalog 门槛 `night_field`/`lynn_uniform_night` 均 `resolved=true` 且 `project.assets` 与 `project.inspect.assets` 逐字段一致；六类错误通道全空；`originalStarter.unchanged=true`；browser/Vite/端口清理字段全成功。
- fixture `<local-path>`：25 个文件；`content/scenario/agent_probe.gal` 为 `72` bytes、SHA-256=`231C5AAD5865D0333C36B8E6DF24FBA3DA783B3EBA364E3A016496764417399A`；`content/timelines/agent_blackout.json` 为 `952` bytes、SHA-256=`547D4E7F5AE797046FE46D2BBE8AA17A8F0FA0DE2C652382F2747F16C44B7AF7`；无 `.surdet-*` 临时文件。

### FORMAL 之后的 editor 因果跳转修正（2026-08-14 2026-08-14 15:22）——人工验收发现并修复

- 项目所有者人工验收发现：因果轨迹中 timeline 事件（agent_probe:3）点击无跳转反应（editor 只对场景内对象跳块编辑，对 timeline/track/cue 引用无跳转）。
- 临时总经理亲自修复（红灯→绿灯）：新增 `parseTimelineObjectRef` 纯函数（红灯 exit 1 留证）；`timeline-panel.selectTimelineCue` 导出；`main.ts` 统一跳转（trace 选择与因果区引用按钮都走 `jumpToTimelineObjectIfNeeded`）。
- 聚焦验证（真实运行）：`npm run test -w surdet-editor -- test/causal-selection.test.ts` 4/4、`npm run typecheck -w surdet-editor` exit 0、`npm run build -w surdet-editor` exit 0（新 bundle `main-BhHN5A_I.js`）。
- 普通本地提交：`8b9d11c8d46fbbca25ecc13ea9d0dce00776ca26 fix(editor): jump timeline cue from causal trace`（仅 4 个 editor 文件，+50/-1），未 push。
- 项目所有者已在该基线上复测通过（"没毛病，通过"）。

### 最终停止状态（2026-08-14 2026-08-14 15:22）

```text
STAGE_6_WAVE_2_IMPLEMENTED_LOCALLY
STAGE_6_WAVE_2_FORMAL_PASSED
FORMAL_AGGREGATE_RUNHEAD_MATCHES_CODE_EVIDENCE_HEAD
FORMAL_EVIDENCE_BASELINE = dcf2905
POST_FORMAL_EDITOR_CUE_JUMP_FIX = 8b9d11c
STAGE_6_WAVE_2_HUMAN_ACCEPTANCE_PASSED_BY_OWNER
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED_AFTER_STAGE_6_WAVE_2
STAGE_6_WAVE_3_NOT_STARTED
```

下一停止点：FORMAL 自动化证据基线仍为 `dcf2905`（不重跑、不改写）；`8b9d11c` 是 FORMAL 之后的 editor 因果跳转修正；项目所有者已在 `8b9d11c` 基线上完成人工复测并通过。push 与 Wave 3 均需项目所有者另行明确授权。
