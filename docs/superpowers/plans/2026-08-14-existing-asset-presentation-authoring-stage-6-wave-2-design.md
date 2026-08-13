# Surdet Stage 6 Wave 2 设计规格（修订版）
# Existing-Asset Presentation Authoring Vertical Slice
# （既有资源驱动的场景演出纵向切片）

> 状态：**设计规格（修订版），待项目所有者复核批准。**
> 本文件只做设计，不授权实施、不派发执行 AI、不制作实施任务书。
> 修订记录：项目所有者已批准设计方向；Codex 给出"有条件批准"，本轮按七项意见整篇修订（身份不变量、单 patch 原子化、错误语义统一、diff 来源、FORMAL 可见变化、合同面收紧、全文一致性）。
> 修订时间：2026-08-14（Asia/Shanghai）。修订者：临时总经理（DeepSeek V4）。

## 一、阶段归属与产品目标

Stage 6 Wave 1（Agent-Ready Authoring Vertical Slice）已闭合：14 项核心 authoring 能力的最小纵向切片经项目所有者人工验收通过并 push，远端回退锚点为 `3da1147`。

Wave 2 的产品目标（项目所有者已批准方向）：

> 让外部桌面 Agent 能发现项目中已有的背景和立绘资源，通过共享类型化 authoring 能力创建或修改一段最小 timeline，将其连接到场景，并在正式 Surdet Presentation 预览中证明背景切换、角色登场和一次 screen fade 确实发生；项目所有者能够在编辑器中理解、反向定位、预览、保存和重开这段演出。

为什么现在做：Wave 1 的类型化写操作止于 `scene` 与 `variable`；timeline 是 Galgame 演出的核心对象，且 Core 的 timeline 数据模型与校验已成熟（见第三节），是能力扩展的最近真实缺口，同时不触碰存档、配置或性能边界。

## 二、范围约束（项目所有者已确认，逐条固化）

1. timeline 是本 Wave 唯一新增可写对象。
2. 现有背景和立绘资源只读发现与引用；不导入、不生成、不删除、不移动、不重命名资源。
3. 场景只通过已有 `@timeline` 语义连接 timeline；不增加新 DSL。
4. 本 Wave 只开放：`background.set`、`portrait.show`、`portrait.hide`、`portrait.move`、`portrait.expression`、`screen.fade`。
5. 不开放 camera、particle、audio、BGM、SE、voice、复杂 screen effect 或 timeline 嵌套。
6. 不修改 game.config、growth、存档 schema 或原始 Starter 内容。
7. 使用隔离 fixture 和已有资源。
8. 不建设内置 AI、MCP、扩展 SDK、扩展市场、云服务或自动发行。
9. 不重构完整时间轴编辑器，也不重构已有 timeline 面板。
10. 资源合同只建立 backgrounds 与 portraits 两类；avatar、fonts 不进入本 Wave 的资源发现合同。

## 三、真实代码事实基础（2026-08-14 只读调研结论）

以下事实来自本仓库磁盘实测，是设计规格的落点依据：

1. **Core timeline 模型已成熟。** `packages/core/src/timeline.ts` 定义 `TimelineDefinition`（version=1、id、durationMs、tracks[]），track kind 为 `background | portrait | camera | screen | particle | audio`，cue 为 `{ atMs, durationMs, easing, action, [payload] }`；`validateTimeline()` 提供 T001–T010 完整校验；`TimelineRegistry` 提供注册与重复 id 拒绝（T010）。本 Wave 开放的 6 个 action 全部在 `ACTIONS` 表内（background:set；portrait:show/hide/move/expression；screen:fade/tint/flash/wipe）。
2. **@timeline DSL 已存在。** `@timeline <id> [@ blocking]` 由 `dsl/compiler.ts` 解析（错误码 C010）；`examples/starter/content/scenario/ch01_01.gal` 第 3、17 行已有真实使用（`intro_cinematic` blocking、`lynn_steps_forward`）。
3. **资源目录约定已存在。** `content/assets/bg/<key>.svg`（castle_hall、night_field）、`content/assets/portrait/<角色>_<服装>_<表情>.svg`（lynn_uniform_normal / night / despair）。目录中另有 avatar、fonts，但不进入本 Wave 合同。
4. **authoring 现状。** `AuthoringObject.kind` 已预留 `'timeline' | 'asset'`；object-index 已对 timeline 文件建立语义索引（`timeline:<name>`）；`ProjectSnapshot` 已把 `content/timelines/*.json` 纳入快照与修订；`ProjectWriteStorage` 事务体系可 staging 任意项目文件。缺口：track/cue 层级索引、asset 索引、timeline 类型化操作、timeline 校验接线与对象级 diff 尚不存在。
5. **Renderer 投影现状。** renderer-queries 已有 `backgroundKey`；stage 已有 fadeOverlay 与 portrait focus 通道。cue 级只读 Presentation 证据字段是否足够证明"背景切换、立绘登场、fade 发生"，留待实施中按第八节边界验证；设计上默认不改 Renderer。
6. **editor 现状。** `packages/editor/src/panels/timeline-panel.ts`（`renderTimelinePanel`/`bindTimelineHooks`）与主界面「时间轴」tab 已存在，提供现有 timeline 面板与 Cue 检查器；本 Wave 复用，不新建第二套 timeline UI、不重构。
7. **既有示例。** Starter 现有 3 个 timeline（intro_cinematic、intro_arrival、lynn_steps_forward），含 background.set、portrait.show/expression/move、camera、screen.fade/tint 的完整用例，可作为数据契约与 fixture 的参照。

## 四、A. 共享 authoring 能力（精确目录）

全部语义落在 `@surdet/authoring`，CLI 只做 Node 文件系统薄适配，editor 复用同一真相。

1. **timeline.create（新增）**
   - 输入：`{ operationId, timelineId, definition: TimelineDefinition }`；definition 只能包含开放 track/action 白名单，否则 `UNSUPPORTED_OPERATION`。
   - **身份不变量（写入前强制校验）：** `timelineId === definition.id === content/timelines/<file-stem>.json 的 file-stem`。三者任一不一致，在写入前拒绝，不生成任何文件，返回 `VALIDATION_FAILED`。
   - **已存在语义：** `timelineId` 或目标文件 `content/timelines/<timelineId>.json` 已存在时，沿用 `scene.create` 的前置条件语义，返回 `OBJECT_PRECONDITION_FAILED`。不得使用 `OBJECT_AMBIGUOUS`——该码只表示查询或引用确实匹配到多个对象。
   - **结构校验：** 写入前经 Core `validateTimeline`；结构错误返回 validation error，本次 create 失败，不 staging 文件。
   - 产出：objectRef `timeline:<timelineId>`、timeline fingerprint 与修订增量。
2. **timeline.patch（新增，单 patch 原子）**
   - 输入：`{ operationId, timelineId, patch: TimelinePatchOperation }`。**一个 capability 调用只执行一个 typed patch**；多个 patch 通过同一个 change 事务串行执行，每次成功后 `workingRevision` 增加，调用方必须重新 `object.inspect` 获取新 objectRef 与 fingerprint。
   - patch 白名单（五种）与 `expectedFingerprint` 校验目标：
     - `addTrack`：校验 `timeline:<id>` 的 timeline fingerprint（父对象是 timeline）；
     - `removeTrack`：校验目标 `trackRef` 的 track fingerprint；
     - `insertCue`：校验目标 `trackRef` 的 track fingerprint；
     - `replaceCue`：校验目标 `cueRef` 的 cue fingerprint；
     - `removeCue`：校验目标 `cueRef` 的 cue fingerprint。
   - **原子性：** 一次 patch 全有或全无；任何失败（指纹不符、引用不存在、白名单外、结构错误）都不得修改 `workingFiles`、`workingRevision` 或 operation ledger。禁止对失效引用的模糊重定位。
3. **project.inspect 扩展：只读资源目录**
   - 新增 `assets` 字段：`{ backgrounds: AssetEntry[], portraits: AssetEntry[] }`，字段见第七节。不含 avatar、fonts。
4. **object.inspect 扩展**
   - 支持 `timeline` / `track` / `cue` / `asset`（asset 仅 background 与 portrait）四类 objectRef，返回结构、来源位置（timeline 文件路径 + JSON 路径）、references 与 referencedBy。
5. **scene.patch 复用已有 @timeline 连接**
   - 不改 DSL；instruction block 写 `@timeline <id> [@ blocking]` 已是既有能力。本轮只补：object-index 把该指令与 `timeline:<id>` 建立因果边；validate 确认目标 timeline 存在。
6. **project.validate 复用 Core validateTimeline**
   - 共享 validation 对快照内每个 timeline 文件调用 Core `validateTimeline`，结构诊断归入统一 validation error 信封；追加资源引用检查：cue.key / track.target+expression 解析失败记为 warning（见第七节，不拒绝、不阻止 commit）。
7. **change.diff 对象级差异**
   - 见第五、六节：对象级 semantic diff 由已成功执行的类型化 operation ledger 产生；file 层沿用既有统一 JSON diff。
8. **capabilities.describe 自动扩展**：能力数由注册表生成，新增上述能力后自动反映。

## 五、B. 对象身份、指纹与冲突行为

1. **timeline：唯一稳定语义身份。** `timeline:<id>`，其中 `id` 严格等于 `content/timelines/<id>.json` 的 file-stem，也等于 `definition.id`。timeline 文件内不注入任何持久 UUID 或 surdet 元数据字段。
2. **track / cue：revision-scoped objectRef，无持久语义 ID。** `timeline:<id>/track:<n>`、`timeline:<id>/track:<n>/cue:<m>`，n/m 为当前 working 文件中的位置序。文件重排后 ref 随修订自然失效；track/cue 不得被描述为拥有持久语义 ID，不得用于跨修订对齐。
3. **asset：只读语义身份。** `asset:bg:<key>`；`asset:portrait:<role>:<outfit>:<expression>`。
4. **fingerprint 定义。**
   - timeline fingerprint：整个 `TimelineDefinition`（规范化 JSON）的 SHA-256；
   - track fingerprint：该 track 对象（规范化 JSON 片段）的 SHA-256；
   - cue fingerprint：该 cue 对象（规范化 JSON 片段）的 SHA-256。
   - 规范化规则（键序稳定、数值规范化、无无关空白）由共享层唯一实现并测试固定；CLI/editor 不得各自重定义。
5. **冲突与错误语义。**
   - 指纹不符 → `OBJECT_REF_STALE`；引用不存在 → `OBJECT_NOT_FOUND`；查询/引用匹配多个对象 → `OBJECT_AMBIGUOUS`。
   - 目标已存在（create 时 timelineId 或文件已存在）→ `OBJECT_PRECONDITION_FAILED`。
   - 结构错误 → validation error；白名单外 → `UNSUPPORTED_OPERATION`；资源 unresolved → warning（非错误）。
   - 禁止任何不带指纹的模糊 patch；不存在"按内容查找"的隐式匹配。
6. **事务冲突。** 沿用 Wave 1：磁盘基线哈希不符 → `PROJECT_CHANGED_SINCE_BEGIN`；operationId 重放/冲突语义不变；commit 失败走既有 journal 恢复协议。

## 六、C. 因果关系（四向）与 diff 来源

1. **scene instruction → timeline（静态，共享索引）**：`@timeline <id>` 指令节点 references `timeline:<id>`。
2. **timeline → asset（静态，共享索引）**：background cue 的 `key` → `asset:bg:<key>`；portrait track 的 `target`（`role:outfit`）+ cue `expression` → `asset:portrait:<role>:<outfit>:<expression>`。
3. **timeline cue → Presentation event（运行时）**：优先复用既有 Core timeline 运行事件（id/blocking/durationMs）与 Renderer 只读 `queries.presentation.snapshot()` 的变化（backgroundKey、portrait 可见性、fadeAlpha）。若实施红灯证明这两者不足以把投影归因到具体 cue，按第八节边界停止并申请最小跨层授权，不得在 authoring/editor 复刻投影。
4. **Presentation event → timeline cue（编辑器反向定位）**：editor 预览 trace 与共享索引联动，从画面事件反查 `timeline:<id>/track:<n>/cue:<m>` 并跳转定位；复用 Wave 1 的 window 事件桥，不建第二套导航。
5. editor 因果区沿用 Wave 1 的"当前对象 / 直接引用 / 直接被引用 / observedImpact"，对象范围扩展到 timeline/track/cue/asset（background/portrait）。

**对象级 semantic diff 的来源：** timeline 可按稳定语义 ID `timeline:<id>` 对齐；track/cue 没有持久语义 ID，**禁止按 track/cue 语义 id 对齐**。本 Wave 的对象级 semantic diff 由已成功执行的类型化 operation ledger 产生，每条至少包含：

```text
operationId、operation kind、objectBefore、objectAfter、
fingerprintBefore、fingerprintAfter、directChange、
potentialImpact、observedImpact
```

文件级 JSON diff 继续保留，但不得用 JSON 数组位置猜测持久对象身份、不建立持久 UUID、不做模糊树匹配。

## 七、D. 资源发现

1. 复用项目现有 `content/assets` 目录约定，不建立第二套命名规则，本 Wave 只建立两类资源合同：
   - 背景：`assets/bg/<key>.<ext>` → key = 文件名 stem；
   - 立绘：`assets/portrait/<role>_<outfit>_<expression>.<ext>` → 三段式解析。
2. `AssetEntry` 字段：`{ kind, key, role?, outfit?, expression?, sourcePath, format, resolved }`，其中 `kind` 仅 `'background' | 'portrait'`。
   - `resolved=true` = 文件存在且 format 属于项目现有资源加载器受支持集合；不发明新的格式规则。
3. **缺失引用处理（统一为 warning）：** timeline cue 引用不存在的 key/role/outfit/expression 时，`project.validate` 报 warning 并给出 `objectRef` 与 `action`；**不拒绝 create/patch，不单独阻止 commit**，保留 placeholder 哲学。
4. **FORMAL 资源门槛：** FORMAL 使用的背景和立绘必须 `resolved=true`；任一不 resolved，FORMAL 证据失败，不得把 warning 当成正式演出通过。
5. 资源发现是只读快照行为：任何 Agent/editor 路径都不写入、移动或重命名 assets。

## 八、E. 公共层边界

1. **Core / Renderer / Host / Shell 默认零改动。** timeline 数据模型、validateTimeline、@timeline DSL、解释器事件与 Renderer 投影全部复用现状。
2. **最小跨层授权条件（三条任一满足即停止并申请）**：
   - 红灯证明缺少必要的纯类型导出（authoring 需要 Core 类型但未导出）；
   - 红灯证明缺少校验信息（现有 validateTimeline 不足以支撑本 Wave 契约）；
   - 红灯证明缺少只读 Presentation 证据字段（snapshot/trace 无法证明背景切换、立绘登场或 fade 发生）。
3. 申请获批前，不得用 authoring/CLI/editor 内的替代实现绕过：禁止复制第二套 timeline 校验、第二套运行语义或第二套 Presentation 投影。

## 九、F. 证据分层（含 FORMAL 真实可见变化）

1. **静态**：timeline 结构校验（Core validateTimeline）+ 资源引用 resolved 检查（warning 级），红灯/绿灯落在共享 validate 与 CLI 合同测试。
2. **运行**：Core `@timeline` blocking 运行证据——simulate / runtime run-from 的 trace 含 timeline 启动事件、等待与完成，运行无错误。
3. **投影（FORMAL 强制真实可见变化）**：
   - 正式 `preview.html` 中通过只读 presentation snapshot 证明真实状态迁移，不允许只验证 cue 存在、事件名存在或"最终状态本来就等于目标状态"。
   - **fade**：fixture 使用两段 screen.fade cue 表达一次可见黑场淡出循环——
     - cue 1：`atMs=0`、`durationMs=0`、`alpha=1`（瞬时压到黑场）；
     - cue 2：`atMs=50`、`durationMs=700`、`alpha=0`（非零时长淡出）。
     - FORMAL 必须证明 fadeAlpha 轨迹：播放前 = 0；播放中达到 1；在 cue 2 的非零时长过程中至少读取到一次 0 与 1 之间的值；播放完成后回到 0。
   - **背景**：播放前 `backgroundKey ≠ night_field`，播放后 `backgroundKey = night_field`。
   - **立绘**：`lynn:uniform:night` 播放前不可见，播放后才可见。
   - 上述三者必须由 snapshot 的时间序列证明真实前后差异。
4. **人工**：项目所有者真实预览、反向定位、保存和重开验收（见第十四节）。

## 十、G. harness 纪律

1. 先完成与正式路径同 launcher、cwd、dist、入口、fixture 的 preflight；禁止替身 server、错误入口或只测内部函数的自检。
2. 聚焦测试按实际需要运行（authoring/CLI/editor 受影响面 + typecheck/build）。
3. 完整 DIAGNOSTIC 每次必须产生增量证据，默认最多 3 次；第 3 次仍失败则停止并复审方法，不再修一处跑一次。
4. runner 冻结提交且诊断全绿后，只运行一次 FORMAL；正式失败不重跑、不覆盖失败 artifact。
5. browser 与 Vite child 必须由 runner 精确拥有并在成功/失败路径都清理（Wave 1 4.59/4.60 教训固化）。
6. 禁止"一修一 FORMAL"循环（4.61/4.62 治理规则固化）。

## 十一、H. 明确排除项

音频生产；美术生成；性能资格化；发行、打包、部署；Legacy 与文档大整理；配置对象写入（game.config / growth / gallery 等）；完整 timeline UI 重构与已有 timeline 面板重构（编辑器只做因果展示与反向定位，复用现有 timeline 面板与 Cue 检查器）；avatar 与 fonts 资源合同；Wave 3；再次 push（本轮及后续 push 均需项目所有者每轮明确授权）。

## 十二、推荐数据契约（TS 形状草案）

```ts
// 复用 Core 类型，不复制：
import type { TimelineDefinition, TimelineEasing } from '@surdet/core';

// 开放白名单（本 Wave 唯一允许写入的 track/action）：
export type Wave2TrackKind = 'background' | 'portrait' | 'screen';
export type Wave2Action =
  | 'set'            // background.set
  | 'show' | 'hide' | 'move' | 'expression'  // portrait.*
  | 'fade';          // screen.fade

export interface TimelineCueInput {
  atMs: number;
  durationMs: number;
  easing: TimelineEasing;
  action: Wave2Action;
  key?: string;        // background.set
  expression?: string; // portrait.show / portrait.expression
  position?: string;   // portrait.show / portrait.move
  alpha?: number;      // screen.fade (0..1)
}

export interface TimelineCreateInput {
  operationId: string;
  timelineId: string;                 // === definition.id === file stem（见身份不变量）
  definition: TimelineDefinition;     // 仅含 Wave2TrackKind 与 Wave2Action
}

// 单 patch 原子操作（一个 capability 调用只执行一个 patch）：
export type TimelinePatchOperation =
  | { kind: 'addTrack'; expectedFingerprint: string; trackKind: Wave2TrackKind; target?: string }
  | { kind: 'removeTrack'; expectedFingerprint: string; trackRef: string }
  | { kind: 'insertCue'; expectedFingerprint: string; trackRef: string; cue: TimelineCueInput }
  | { kind: 'replaceCue'; expectedFingerprint: string; cueRef: string; cue: TimelineCueInput }
  | { kind: 'removeCue'; expectedFingerprint: string; cueRef: string };

export interface TimelinePatchInput {
  operationId: string;
  timelineId: string;
  patch: TimelinePatchOperation;      // 单个；串行多次通过同一 change 事务
}

export interface AssetEntry {
  kind: 'background' | 'portrait';
  key: string;
  role?: string;        // portrait: lynn
  outfit?: string;      // portrait: uniform
  expression?: string;  // portrait: normal / night / despair
  sourcePath: string;   // content/assets/...
  format: string;       // 扩展名（如 svg）
  resolved: boolean;    // 文件存在 + 格式受支持
}

export interface ProjectInspectAssets {
  backgrounds: AssetEntry[];
  portraits: AssetEntry[];
}
```

错误语义沿用 Wave 1 信封，本 Wave 明确：`OBJECT_PRECONDITION_FAILED`（目标已存在）、`OBJECT_NOT_FOUND`（引用不存在）、`OBJECT_AMBIGUOUS`（查询匹配多个对象）、`OBJECT_REF_STALE`（指纹不符）、`UNSUPPORTED_OPERATION`（白名单外）、`VALIDATION_FAILED`（结构错误）；资源 unresolved 只产生 warning，不落入错误信封。

## 十三、数据流

```text
外部桌面 Agent
   │ CLI（Node 薄适配，只做文件系统）
   ▼
@surdet/authoring 共享真相
   │ timeline.create（身份不变量校验 → 结构校验 → 事务 staging）
   │ timeline.patch（单 patch 原子：指纹校验 → 白名单 → 结构 → 全有或全无）
   │ assetCatalog（只读发现：backgrounds + portraits）
   │ validate（Core validateTimeline + resolved warning）
   │ diff（对象级 = operation ledger；文件级 = JSON diff）
   │ object-index（timeline/track/cue/asset + 四向因果）
   ▼
项目磁盘 content/timelines/<id>.json（规范化 JSON，无 UUID 污染，id===stem）
   ▼
editor（同一 authoring 真相 + 现有 timeline 面板/Cue 检查器）
   │ 因果区：scene→timeline→asset；预览 trace→cue 反向定位
   ▼
正式 preview.html → Renderer（既有投影通道，零改动）
   │ queries.presentation.snapshot()：backgroundKey / portrait / fadeAlpha
   ▼
trace + snapshot 证据 → 静态·运行·投影·人工 四层验收
```

## 十四、最小 fixture 与人工验收路径

1. **fixture**：隔离副本只复制 Starter 的 `game.config.json` 与 `content/**`（含 assets、timelines、scenario、config），不复制 node_modules/dist/src/test/Git 元数据；创建前后核对原始 Starter 文件身份不变。
2. **Agent 编排示例（供 FORMAL 与人工共用）**：
   - `timeline.create`：`agent_blackout`（definition.id 同为 `agent_blackout`）——
     - background.set（key=night_field）；
     - portrait.show（target=lynn:uniform，expression=night，position=left）；
     - screen.fade 两段 cue：cue 1 `atMs=0,durationMs=0,alpha=1`；cue 2 `atMs=50,durationMs=700,alpha=0`。
   - `scene.patch`：在隔离场景追加 `@timeline agent_blackout @ blocking`；
   - `change.diff` → `change.commit`。
3. **人工验收路径（沿用 Wave 1 风格，只报告异常）**：
   - 编辑器打开 fixture，因果区选择 `@timeline` 指令能看到 `timeline:agent_blackout` 与背景/立绘资产引用；
   - 预览中真实看到背景切换到 night_field、lynn 登场、一次 fade 淡出；
   - 从预览轨迹事件反向定位到 timeline cue；
   - 手工微调一处 cue（如把 portrait expression 改为 despair）：复用现有 editor timeline 面板与 Cue 检查器完成 → 预览 → 保存 → 刷新重开仍在。

## 十五、文件影响预估

- `packages/authoring/src/`：contracts.ts（新增类型）、新 timeline-operations.ts、新 asset-index.ts、object-index.ts（track/cue/asset 索引与因果）、validation.ts（timeline 校验接线）、diff.ts（operation-ledger 对象级 diff）、index.ts（导出）。
- `packages/authoring/test/`：新增 timeline-operations / asset-index / object-index / diff 聚焦测试。
- `packages/cli/src/authoring/`：authoring-service.ts 注册 timeline.create/patch 与 assets 查询；命令表面新增两条命令。
- `packages/cli/test/`：新增 CLI 合同与纵向切片测试。
- `packages/editor/src/`：因果区/预览面板对象范围扩展（复用 Wave 1 机制与现有 timeline 面板/Cue 检查器，不重构）。
- 不修改：Core、Renderer、Host、Shell 生产代码（默认）、Starter 内容、game.config、growth、存档 schema、Wave 1 任务书与交付报告。
- 文档：本设计规格（修订版）；获批后另建 Wave 2 实施任务书与交付报告。

## 十六、风险与停止条件

1. 若实施红灯证明 Renderer 现有只读投影证据不足以证明"背景切换/立绘登场/fade 发生" → 停止，按第八节申请最小跨层授权。
2. 若 track/cue 指纹的规范化序列化在实现中出现不稳定 → 停止，先固化规范化规则再继续。
3. 若发现任何需要"按 track/cue 持久语义 ID 对齐"的用例 → 停止，回到第五节的 operation-ledger diff 约定，不得引入持久 UUID 或模糊树匹配。
4. DIAGNOSTIC 第 3 次仍失败 → 停止并复审方法，不修一处跑一处。
5. 任何需要修改 Core 校验语义、存档 schema 或 Starter 内容的发现 → 停止并上报。
6. FORMAL 失败（含资源 unresolved、投影前后无真实变化）→ 保留失败 artifact，停止等待总经理独立复审。

## 十七、为什么这一设计强化 Surdet 的独特性（而非模仿参考项目）

1. **共享真相**：Agent 的 timeline 写入与人类编辑器读到的索引、校验、因果来自同一个 `@surdet/authoring` 实现，不存在 GUI 编辑器与外部 Agent 各持一套时间轴语义的割裂。
2. **类型化契约而非图形界面**：参考 Studio 的时间轴是给人操作的 GUI 工作流；Surdet 把演出能力表达为带指纹的单 patch 契约对象（timeline/track/cue），外部桌面 Agent 可编程、可验证、可回滚——这是"外部 Agent 友好引擎"路线的直接延伸，不是复制 GUI。
3. **双向因果延伸到演出层**：Wave 1 证明"文本 ↔ 画面"的因果桥；Wave 2 把同一机制延伸到"画面事件 ↔ timeline cue"，让项目所有者从最终投影反向理解演出是怎么发生的。
4. **既有资产驱动的创作**：资源只读发现（backgrounds + portraits）强化"不生成、不搬运，只编排已有资产"的轻量创作哲学，与 placeholder 渐进哲学一致。
5. **证据分层可验证**：静态 → 运行 → 投影（含 fadeAlpha 前后真实轨迹）→ 人工四层证据，任何一层都不冒充上一层；FORMAL 单次取证与预检纪律是 Wave 1 治理教训的直接产物。

## 十八、设计规格停止状态

```text
STAGE_6_WAVE_2_DIRECTION_APPROVED_BY_OWNER
WAVE_2_DESIGN_SPEC_REVISED
WAITING_FOR_PROJECT_OWNER_REVISED_SPEC_REVIEW
WAVE_2_IMPLEMENTATION_PLAN_NOT_AUTHORIZED
EXECUTION_AI_NOT_DISPATCHED
NOT_PUSHED
```

项目所有者明确批准修订后的书面规格后，才进入 implementation plan；实施任务书仍需单独授权派发执行 AI。
