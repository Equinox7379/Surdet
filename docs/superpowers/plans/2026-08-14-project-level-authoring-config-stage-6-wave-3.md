# Surdet Stage 6 Wave 3 实施任务书
# Project-Level Authoring Config Vertical Slice
# （项目级创作配置纵向切片）

> 状态：**实施任务书（候选），待项目所有者批准后派发执行 AI。**
> 背景：老总经理（Codex）额度用尽前已确认 Wave 3 方向（不堆编辑器面板，补 Agent 尚不能安全完成的项目级创作配置）；临时总经理接续调研并落成本任务书。
> 编写时间：2026-08-14（Asia/Shanghai）。编写者：临时总经理（DeepSeek V4）。
> 本任务书不授权修改生产代码、派发执行 AI 或 push。

## 一、阶段归属与工程目标

- **阶段**：Stage 6 Wave 3（延续「外部 Agent 与人类共用同一创作内核」主线）。
- **为什么现在做**：Wave 1 给了 scene/variable 写、Wave 2 给了 timeline 演出写，但 Agent 仍不能创建/修改**角色表（characters）**，也不能设置**入口场景（entryScene）**——这两项是「做一个可玩的 Galgame 项目」的项目级创作配置，缺口真实且明显。角色是台词 speaker 的归属对象，角色表不能写，Agent 自建角色必须手改 JSON，违背共享内核目标。
- **目标**：让外部桌面 Agent 通过共享类型化 authoring 能力：发现已有角色与头像资源 → 创建/修改角色（id/name/avatar）→ 设置入口场景（指向存在的场景）→ 在共享模拟与正式预览中证明该角色台词真实出现 → 项目所有者在编辑器中理解（speaker→角色因果）、预览、保存和重开。
- **验收落点**：静态校验（characters 结构、avatar resolved、entryScene 存在性）、共享模拟运行（entryScene 启动 + 角色台词）、正式预览投影（speaker 显示名）、项目所有者人工验收四层。

## 二、范围约束（固化）

1. characters 角色表与 entryScene 是**本 Wave 唯一新增可写对象**；title 可选纳入（纯文本字段，无引用）。
2. avatar 头像资源**只读发现**（assets/avatar/<name>.<ext>，复用 Wave 2 asset-catalog 模式扩展）；不导入、不生成、不删除、不移动、不重命名资源。
3. **不修改存档 schema、growth.json、存档读写路径**；growth 配置写入明确排除（涉及成长状态回写，风险高一档）。
4. 不修改 Core 数据模型、不新增 DSL；speaker 继续用既有角色 ID 语义。
5. 场景连接角色不靠新语法：scene.patch 的 text block 既有 speaker 字段即为角色引用（只补索引因果）。
6. 使用隔离 fixture 和已有资源；不修改原始 Starter 内容。
7. 不建设内置 AI、MCP、扩展 SDK、扩展市场、云服务；音频/性能/发行继续冻结。
8. 编辑器不新建面板：复用既有 config 区展示角色表，因果区展示 speaker→character 边。

## 三、真实代码事实基础（2026-08-14 只读调研结论）

1. game.config.json 结构（Starter 实测）：title、version、entryScene（ch01_01）、characters（lynn: {name:凛, avatar:lynn}）、variables。**不含存档 schema**——写 game.config 不碰存档。
2. project-snapshot.ts 已把 game.config.json 纳入快照并提取 entryScene；simulation.ts 已用 snapshot.entryScene 启动模拟（entryScene 写后模拟自动跟随，无需改 Core）。
3. variable.ensure 已有写 game.config.json 的事务模式（operations.ts 既有能力），character 写操作可同构复用。
4. asset-catalog.ts 已有 bg/portrait 只读解析与受支持格式集合（svg/png/jpg/jpeg/webp/gif/avif）；avatar 扩展只需加 content/assets/avatar/ 前缀分支。
5. object-index.ts 已索引 scenes/variables/timelines，**未索引 characters，也没有 text.speaker → character 的因果边**（本 Wave 核心补点）。
6. editor 已有 config 区（growth 表格等），但 game.config 角色表无专门面板；因果区（right.ts）已支持任意 kind 的引用下钻（Wave 2 修复后含 timeline/cue 跳转）。
7. Renderer/预览侧：Wave 2 runner 已用 characters 构建 speakerProfiles（{id,name}），角色显示名链路已存在。

## 四、A. 共享 authoring 能力（精确目录）

1. **character.ensure（新增）**
   - 输入：{ operationId, id, name, avatar?, expectedFingerprint }；expectedFingerprint = 当前角色表规范化 JSON 片段的 SHA-256（角色不存在时 = 空对象指纹）。
   - 行为：事务内 staging game.config.json；id 合法（仅字母数字下划线点横线开头不能是数字外符号，形如 [A-Za-z0-9_.-] 且首字符合法）；同名已存在 → 覆盖 name/avatar 并要求指纹匹配；不存在 → 新增并要求空指纹；结构经 Core 配置编译校验后才可提交。
   - 产出：character:<id> objectRef + 新指纹。
2. **character.remove（新增）**
   - 输入：{ operationId, id, expectedFingerprint }；指纹不符 → OBJECT_REF_STALE；角色不存在 → OBJECT_NOT_FOUND。
   - 移除后共享 validate 必须报告**仍然引用该角色的台词行**（warning 级，含 objectRef/action，不阻止 commit——与 Wave 2 资源 warning 同哲学）。
3. **project.entry-scene.set（新增）**
   - 输入：{ operationId, sceneId, expectedFingerprint }；指纹 = 当前 entryScene 字段的规范化片段指纹。
   - sceneId 必须指向快照中存在的场景，否则 VALIDATION_FAILED（入口不存在会直接破坏模拟/预览启动，是硬错误）。
4. **project.inspect 扩展**
   - 新增 characters（id/name/avatar/declaration）与 entryScene、title 字段；assets 增加 avatars 数组（AssetEntry{kind:avatar, key, sourcePath, format, resolved}）。
5. **object.inspect 扩展**：支持 character:<id> 与 asset:avatar:<name>。
6. **project.validate 扩展**：characters 结构校验（error）；character.avatar 引用 unresolved → warning；entryScene 指向不存在场景 → error；台词 speaker 引用不存在的角色 → warning（placeholder 哲学，FORMAL 角色必须存在）。
7. **change.diff 扩展**：character 对象级差异（由 operation ledger 产生，八字段沿用 Wave 2）。
8. **object-index 扩展**：character:<id> 对象（semanticId 稳定）+ 因果边：text/choice 的 speaker → character:<id>；character → asset:avatar:<name>；entryScene → scene:<id>；反向 referencedBy 同步。

## 五、B. 对象身份、指纹与冲突行为

1. **character：稳定语义身份** character:<id>（id 即 game.config.characters 的键）；配置内不注入任何 UUID。
2. **avatar：只读语义身份** asset:avatar:<name>（文件 stem）。
3. **entryScene：单字段对象**，指纹 = 规范化 JSON 片段 SHA-256（「缺失」用空指纹表达）。
4. 错误语义沿用 Wave 2：指纹不符 OBJECT_REF_STALE、不存在 OBJECT_NOT_FOUND、多义 OBJECT_AMBIGUOUS、结构错误 validation error；单操作全有或全无，失败不改 workingFiles/workingRevision/ledger。
5. 事务冲突沿用 Wave 1/2：磁盘基线哈希不符 PROJECT_CHANGED_SINCE_BEGIN 等。

## 六、C. 因果关系（静态索引）

1. **台词/选择 speaker → character**：text block 的 speaker 字段 → character:<id>。
2. **character → asset:avatar:<name>**：characters[id].avatar → avatar 资源。
3. **entryScene → scene:<id>**：入口场景引用。
4. editor 因果区复用 Wave 1/2 机制：当前对象 / 直接引用 / 直接被引用 / observedImpact，点引用可下钻与跳转。

## 七、D. 证据分层与 FORMAL

1. **静态**：characters 结构、entryScene 存在性（error）、avatar resolved（warning），红灯/绿灯落在共享 validate 与 CLI 合同测试。
2. **运行**：共享 simulate 从 entryScene 启动，trace 证明目标场景运行且目标角色台词出现（speaker=<id>）。
3. **投影**：正式 preview 中 dialogue projection（speakerId/显示名）证明新角色台词真实显示（显示名来自 characters.name）。
4. **人工**：项目所有者编辑器验收（第十节）。

FORMAL 编排示例（fixture 内，Agent 全链）：
character.ensure nova（name=诺瓦，avatar=lynn）→ scene.patch 在目标场景追加 nova 的一句台词 → project.entry-scene.set 指向该场景 → project.validate 绿灯 → simulate/run-from 证明 nova 台词出现 → change.diff → change.commit → 正式 preview 投影断言（speakerId=nova、显示名=诺瓦）。

## 八、E. harness 纪律（沿用 Wave 2 写死约定）

- runner：packages/shell/e2e/project-config-wave-3.e2e.mjs，注册 e2e:authoring:wave3（node e2e/… workspace 相对路径）；--preflight / --diagnostic（≤3 次，每次新增量 artifact）/ 缺省唯一 FORMAL。
- 先 preflight（同 launcher/cwd/dist/入口/fixture），禁替身 server；DIAGNOSTIC 第 3 次失败 → 停止复审方法；诊断全绿且 runner 冻结提交后单次 FORMAL；artifact.runHead 必须等于冻结的 CODE_EVIDENCE_HEAD；失败 artifact 保留禁覆盖；browser/Vite child 精确清理。
- FORMAL 不得依赖 game.config 的旧 entryScene：显式断言 entryScene 已由 Agent 设置为目标场景，trace-start 的 sceneId 与之相等。

## 九、F. 文件白名单与禁止项

### 允许修改/新增

- packages/authoring/src/：contracts.ts、新 config-operations.ts（character.ensure/remove、entry-scene.set）、asset-catalog.ts（avatars 扩展）、object-index.ts（character/avatar 对象与因果）、validation.ts（结构/引用检查）、diff.ts（character ledger diff）、index.ts。
- packages/authoring/test/：新 config-operations / asset-catalog / object-index / validation 聚焦测试。
- packages/cli/src/authoring/：authoring-service.ts 注册新能力与命令；packages/cli/test/：新合同与纵向测试。
- packages/editor/src/：因果区/配置区展示扩展（复用既有机制，不新建面板）；packages/editor/test/：新聚焦测试。
- packages/shell/e2e/project-config-wave-3.e2e.mjs + packages/shell/package.json 脚本。
- 本任务书与新建 Wave 3 交付报告。

### 禁止修改/触碰

Core、Renderer、Host、Shell 生产代码（默认零改动）；存档 schema 与存档读写路径；growth.json 及其写入；Starter 原始内容；Wave 1/2 任务书与交付报告；长期路线台账；AGENTS.md；受保护文件；音频/性能/发行文件；assets 资源文件（只读枚举）。

## 十、G. 最小 fixture 与人工验收路径

1. fixture = Starter 隔离副本（game.config + content/**），创建前后核对原始 Starter 身份。
2. Agent 编排：创建角色 nova → 目标场景追加 nova 台词 → entryScene 指向该场景 → commit。
3. 人工验收（项目所有者 Chrome/Edge，只报告异常）：编辑器打开 fixture → 配置区/因果区看到新角色（点 nova 台词看 speaker→character 因果、下钻 avatar）→ 预览看到 nova 台词且显示名为「诺瓦」→ 微调角色名 → 保存 → 刷新重开仍在。

## 十一、H. 提交与停止点

- 顺序沿用 Wave 2 6.2：代码证据提交（记录 CODE_EVIDENCE_HEAD）→ 基于该 HEAD 取证 → FORMAL 后写 Ledger/交付报告 → 文档闭合提交；两次提交均不 push。
- 聚焦验证：文件级测试命令 + typecheck/build + node --check + preflight；禁止整包测试、verify:all、Electron、性能矩阵。
- 最终停止：

    STAGE_6_WAVE_3_IMPLEMENTED_LOCALLY
    READY_FOR_INDEPENDENT_MANAGER_REVIEW
    WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
    HUMAN_ACCEPTANCE_NOT_STARTED
    NOT_PUSHED_AFTER_STAGE_6_WAVE_3
    STAGE_6_WAVE_4_NOT_STARTED

随后由临时总经理独立复审；人工验收与 push 均需项目所有者另行明确授权。

## Execution Ledger

> 执行 AI 从 Task 0 开始按时间顺序追加；不得预填未运行结果，不得改写历史失败记录。