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
