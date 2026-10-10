# Surdet 内容创作指南（给外部 AI 助手）

本指南面向编写剧情、配置与演出的内容作者。默认使用正式 Agent Port 工具，在隔离草稿中修改、验证和试玩；不需要先读引擎源码、长期台账或重新接线播放器。已有项目保持原位，新项目使用现有模板。

本批公开创作合同为 **2.32.0**（72 项公开能力），`project.simulate` 新增源位置与版本关联的 `coverage`，失败和预算耗尽的部分报告保留在错误 `details.report`；保留作品界面变量条件、只读数值条、数组列表/数量、有限赋值按钮，以及人物档案、用语辞典、结局册、可选永久收藏、多语言、已有配音、主题、分层立绘、逐帧动画与素材整理能力。客户端、Core、Authoring、Renderer、CLI 与 Editor 应使用同批构建，不能只复制新界面接旧 authority。

## 0. 准备项目与会话

本批行内文字：`capabilities.describe.result.inlineText.tags`提供实际支持表，使用既有`scene.patch`编写。示例：`凛：<em><color=accent>等一下</color></em><w=500>……<w>继续。`。ADV支持`w/speed/nw/shake/wave`，`nw`仅句末；选项只用样式/注音，NVL和文字记录保留静态样式。注音写`<ruby=せかい>世界</ruby>`，旧`世界《せかい》`现在是普通文字，不作兼容解释。需要字面尖括号时按[行内文字合同](inline-text-contract.md)转义。标签错误通过M类诊断和精确范围修正；变量填入的内容不会成为标签。文字记录完整最多200条进入表现快照，存读档/回退不重复当前句；Editor补全/高亮仍由前端独立接入，不能把后端可用等同于前端已交付。

环境已可用时不要重装依赖或全量重建。由获授权的执行者创建新项目、启动会话；已绑定会话直接进入能力发现。

```powershell
node packages/cli/dist/index.js new <游戏名>
node packages/cli/dist/agent-port/main.js --project <项目目录> --policy stage
npm run dev:project -w surdet-editor -- --project <项目目录绝对路径>
```

最后一项在需要编辑器/真实试玩时使用，不替代 Agent Port。完整启动与绑定说明见 [README](../README.md#外部-agent-创作)。缺失构建时沿 README 的依赖顺序准备，不让内容作者自行改造工具链。

新项目可追加 `--directory <项目目录>` 指定独立位置，`--template blank` 选空白模板，默认 `example` 带短篇示例。两者都用 `@surdet/player`，并自带 `AGENTS.md` 和 `.mcp.json.example`，独立作者可从项目内说明开始，不需要取得本指南或复制播放器。连接示例须填写真实 CLI 包和项目路径，再由 MCP 客户端启用，默认 `stage`。独立环境须先由执行者准备项目 README 所列的同批 Surdet 包与开发依赖；不要假定公共 npm 已发布这些包。安装后可用 `surdet` 与 `surdet-agent-port`，无需源码相对路径；Editor 可使用已有独立 Windows 应用或上面的源码启动入口，不随游戏依赖自动安装。

- `observe` 只读；`stage` 可编辑隔离 change、验证和试玩，但不写回来源；`apply` 必须由获授权者明确启动，仍受草稿、租约与提交保护约束。
- 普通章节在 change.begin 显式传 `compositionMode: "direct"`，可在隔离草稿中编写剧情回访；direct 不是来源写权限。要参与候选组合时显式选 `candidate`，继续受依赖与环检查保护。省略字段仍保留 stage→candidate、apply→direct 的旧默认值；恢复会话沿用记录模式，不随新 policy 改变。
- 普通内容创作复用共享 Player，不复制菜单、存档或渲染器。需要开发自定义宿主时才阅读 [架构](architecture.md)、[Renderer 接线](renderer-v2-migration.md)与 [Player Shell 接线](player-shell-migration.md)；内容任务不需要这些前置知识。
- 安装包、部署与音频/美术生产各按实际授权处理，不因章节完成自动执行。

## 1. 发现 → 编写 → 验证 → 返修 → 交付

以下是工具名及 arguments，不是要写进剧本的文字。先调用 `surdet_session_describe({})` 获取当前项目、权限、active change 与 nextActions，再查看能力摘要：

```json
{ "detail": "summary" }
```

把上面参数交给 `surdet_capabilities_describe`；随后只取本次要用的完整合同，例如：

```json
{ "ids": ["scene.create", "scene.patch", "object.inspect"], "detail": "full" }
```

ID 是原生名称，不是 MCP 工具名。省略参数仍返回完整列表。描述含 schemas、前置条件、错误修复办法和最小示例；摘要只是目录，不代表能力在当前权限/状态下可用。以 `session.describe` 与工具实际返回为准。

`docs/capabilities.json` 是渲染与运行支持矩阵，不是创作工具目录；查 scene.create 等工具合同时使用上述 `capabilities.describe`。

1. **读取事实。** 用 `project.inspect`、`project.assets`、`project.gallery` 获取入口、变量、角色与素材。四个读取入口（含 object.inspect）始终显式传 `view: "project"` 或 `view: "working"`；working 必须有 active change。旧省略参数调用保留原范围：inspect/assets 读来源、object/gallery 优先工作版本，不应混用。用场景的 `childRefs` 或正文片段返回的 objectRefs 取得子对象，再 object.inspect 获取当前指纹。
2. **建立隔离变更。** 无 active change 时调用 `change.begin`，普通章节传 `compositionMode: "direct"`，写明 intent、acceptanceCriteria 和 `initiator: "external-agent"`。续接已有草稿时用启动参数 `--resume-change <changeId>` 保留其身份，不为每个修正新建 change。
3. **先满足依赖，再修改内容。** 变量用 `variable.ensure` 声明，角色/时间轴等沿各自能力处理；素材 key 来自公开目录。调用 scene.create/scene.patch，操作编号标识一次确定操作，收到未知结果时先核对原编号，不换编号盲重试。
4. **验证工作版本。** 调用 `project.validate`、`project.simulate`；用 `runtime.run-from` 指定起点、选择与变量走关键路径。label 仅指真实场景标签，从场景开头运行就省略。已有 trace 可用 `runtime.read-trace` 查询，画面观测用 `runtime.read-preview`。
5. **修正后继续。** 读取错误 code/details/repairActions，修正输入或重新取得事实。修改后重读对象；旧匿名引用和指纹不是稳定地址。不能将运行失败、预算不足或未覆盖路线称为成功。
6. **查看与交付。** 用 `change.diff` 查看差异，在编辑器明确选中该 working-change 试玩，再继续原 change 返修。stage 交付草稿/胶囊不会自动写回项目；经授权的 apply 才能提交，integration 仍需原人类批准。胶囊固定的是封存事实，更新后的工作画面不能冒充封存版本。新作品交付时更新项目 README 的标题、剧情介绍、启动方式与实际素材范围，不沿用不再符合内容的模板说明。

### 保存内容版本与安全恢复

`project.history`（MCP：`surdet_project_history`）列出手动记录的已保存版本及当前 `contentRevision`。需要记下一个版本时，调用 `project.history.checkpoint`，传新的 UUID `operationId`、`label` 与读取的 `expectedContentRevision`；同一请求重试保留原编号。记录仅包含已保存的剧本、时间轴、game.config.json 和受支持的内容配置（含成就），不包含图片、声音、package/save 身份、引擎源码或活动批准。未保存草稿不会被混入版本；版本存在也不表示它通过质量检查。

恢复时先 `change.begin({compositionMode:"direct"})`，再调用 `project.history.compare({checkpointId,view:"working"})` 查看文件差异。指定单个 `path` 可读取完整当前/历史文本。把返回的 `checkpoint.fingerprint`、`contentRevision`、`workingRevision` 分别作为 `project.history.restore` 的 `expectedFingerprint`、`expectedContentRevision`、`expectedWorkingRevision`，同时传 `checkpointId`、稳定的 `operationId` 和明确选定的 `paths`。恢复只合并这些历史文件，保留其他当前文件，不删除历史中缺少的文件。版本失配须重新比较；candidate/integration 在修改前拒绝。当前配置损坏时，普通 direct 草稿仍可建立并恢复有效历史配置。

恢复后继续用原 `change.diff`、验证、模拟、运行和 Editor 的 working-change 试玩；经授权的 apply 才能 `change.commit`。普通胶囊仍不可组合或代替批准。历史里的素材引用不会找回已删除的素材，必须核对实际资源。很早的 direct 草稿若未捕获成就文件基线，会要求新建草稿后恢复该文件。

Editor 的“历史”使用同一版本库：填写名称记录已保存版，选择版本和一个有差异的文件，核对两侧全文后点击“恢复这个文件为草稿”。先处理当前未保存修改；既有文件恢复沿原撤销/重做，再用“保存全部”写回。找回已删除的文件作为普通新建草稿处理，保存后不会通过撤销偷偷删除文件。整份配置恢复在保存或撤销前保持为完整文本草稿，避免窄字段表单覆盖未知字段。外部修改须先同步；损坏的历史记录会保留并明确报错。内容文件须能无损读取为 UTF-8；语法错误仍可记录，非法编码需先修正。版本库位于现有 Agent 数据目录的项目命名空间，换机器/移动项目不会自动迁移，不是包含素材的完整交接包。

### 从已有文字或表格导入剧本

调用 `script.import.preview`（MCP：`surdet_script_import_preview`），传 `format: "text"` 或 `"csv"`、已按 UTF-8 解码的 `source` 和明确的 `view`。这是只读转换，不需要 apply，也不读取任意本机文件。working 会使用当前草稿的角色资料，不会退回来源。

- CSV 默认第一行是表头；`header: false` 表示无表头。`textColumn` / `speakerColumn` 是从 **0** 开始的列号，重复表头应按列号选；`speakerColumn: null` 明确不使用说话人列。只有唯一的常见列名会自动识别。
- 返回 `columns`、逐条 `rows`、原文件行号、角色匹配建议和 `issues`。引号包裹的多行台词会拆为同一说话人的连续台词；未映射列不导入并明确提示。`speakerMap` 将原说话人映射到选定的显示名，空键表示原旁白、空值表示改为旁白；不会自动新增或改名项目角色。
- 先解决错误并核对提示，只有 `ready: true` 才会给出可用 `blocks`。复制这些 blocks 给原 `scene.create`，使用新的 sceneId 和 operationId，创建普通隔离草稿，再沿原验证、试玩、返修与授权写回流程完成。相同 sceneId 不会覆盖已有场景。
- 导入只生成台词，不执行源文字中的 `@jump`、`@set` 或注释。无法原样表示的行会拒绝；若确实需要显示这类文字，可明确映射一个合法说话人再预览。需要编排指令时另用原 typed instruction 能力，不把导入当作运行任意脚本的入口。

Editor 的“项目内容 → 导入剧本”使用同一规则，可选择 UTF-8 文件或粘贴文字、映射列与说话人、预览后新建未保存场景。批量查找替换也先展示全部受影响场景与逐行差异，确认后才改草稿；正文或范围过期须重新预览。

### 预算与失败后继续

- `project.simulate` 的 `maxPaths` 为正整数 `1..2000`（默认 `500`），`maxStepsPerPath` 为正整数 `1..100000`（默认 `20000`）。
  任一预算耗尽都表示 `incomplete`，不能当作通过。公开错误中的 `repairActions.inputTemplate` 可给出有界重试输入；到上限后应缩小场景或明确要跑的路径，不能无界增加预算。
- 模拟结果的 `coverage` 含场景访问、原始选项编号、条件成立/不成立次数、预算停止与错误位置；位置带 `file/line/col/index/sourceVersion`。成功的来源项目结果在 `report.coverage`，工作变更结果在 `coverage`；运行失败或预算耗尽保留于错误 `details.report.coverage`。`condition-not-met` 仅表示本次初值下尚未满足，`unvisited` 不证明不可达；条件计数包括 Core 实际恢复分支快照时的求值，不是玩家游玩次数。初值、随机种子和有界预算不能证明所有变量状态下的全路径。
- Editor「统计」可检查当前剧本/时间轴草稿；配置表单有未保存草稿时先保存或撤销，不能悄悄按旧配置检查。旧内容记录仍可查看或导出，但不能跳到已修改的新稿。真实试玩记录另列，隔离内容不会冒充当前编辑稿；下载诊断不含正文、变量值、原始错误详情或画面快照，不自动上传。该检查不增加 candidate、integration 或 apply 权限，不替代正常交付证据。
- `runtime.run-from` 已产生事件但失败时，使用错误 `details.traceId`，并按 `runtime.read-trace` 的
  `repairActions.inputTemplate` 读取失败前轨迹。结果含 `status`（`passed`、`failed` 或 `unknown`）及 `traceWorkingRevision`；老记录可能缺少后者。
  freshness 描述相对当前版本；失败轨迹绝不能当作 `passed` 证据。若运行在产生轨迹前失败且没有轨迹，不要伪造 `traceId`。
- `INVALID_REQUEST` 属于 after-repair：修正输入后再继续，不原样重试。MCP SDK 可能在工具执行前按 schema 拒绝请求，仅返回协议错误文本；按字段路径和 schema 修正，不假装有业务回执。
  执行结果未知时查询原操作编号，不换编号重复写。

### 诊断范围与前端接入（2.30.0）

`project.validate` 的 `issues[]`、CLI `lint --json` 的问题列表、Editor `validateProject` 的 `Issue` 共用可选 `range`。`file/line/col/code/text/hint` 保留原有含义；`line/col` 是定位锚点，`range` 可以只覆盖该指令中出错的参数，不要求两者起点相同。例如第二行的 `@call start.missing`：

```json
{
  "file": "content/scenario/start.gal",
  "line": 2,
  "col": 1,
  "range": { "start": { "line": 2, "col": 7 }, "end": { "line": 2, "col": 20 } }
}
```

- `start/end` 的行、列均从 **1** 开始，范围为 **包含起点、不包含终点**。列按原输入的 JavaScript UTF-16 码元计数：Tab 算 1，常见补充平面 emoji 算 2；保留实际缩进和 BOM，不按显示宽度或去空格后的文本计算。支持 LF、CRLF、CR 换行，换行符不计入所在行的列。
- 目前从词法/语法事实提供 `goto/loop` 及跨场景 `jump/call` 目标（含受支持的选项内动作）、`switch` 标签、重复标签、未知指令、未闭合引号和部分参数/结构错误的范围。缺少参数时可以标记所属指令；只有文件级信息或无可靠范围时**省略 `range`**，不要制造零坐标、猜选项位置或解析中文错误文案。
- 若编译失败发生在生成校验列表之前，原失败回执的外层错误码不变，`error.details.diagnostic` 提供同形的错误码、文本、位置、可选范围与提示。它仍是失败，不转换成空列表或成功。
- 范围只属于**产生它的输入文本**。Agent 消费时保留现有返回的项目/工作版本上下文，稿件变动后重新校验；失败回执的会话版本不保证代表本次失败文件的版本，须重新读取当前内容，不能直接据此编辑。不要把历史 evidence 的范围套用到当前草稿。
- Editor 的数据层会在编辑调度时立即使旧校验失效，Worker/主线程迟到结果不会在等待新校验期间冒充当前结果；旧问题条目的点击也会被拒绝。前端接高亮时使用 `isValidationCurrent()`（`panels/issues.ts`），并随下一次编辑清除旧高亮，不只从 `state.lastValidation` 读取旧列表。切换到新校验后，不复用旧条目的点击闭包。

本接口只提供定位事实，不提供自动改稿或审批权限；普通界面仍可使用原行定位。精确文本选中/高亮的视觉交互由前端接入，本后端改动不表示界面已经实现。

### 正确使用公开示例

示例中的 `...`、匿名对象引用与指纹是占位符，必须替换为公开读取返回的真实值，不能猜测。注册表的两个场景示例有以下依赖：

- **scene.create：** 先声明 number 变量 `trust`，运行示例时给正数初值（如 2），使条件选项可见；新场景 ID 必须未占用。示例自身定义 `next` 标签，选择后将 trust 设为 1。
- **scene.patch：** 准备含 choice 和 `left` 标签的场景 x、目标场景 right，以及 number 变量 trust 和 string 变量 route。从 `scene:x` 的 childRefs 查找 choice；用该对象的 `details.structure.fingerprint` 替换整组选择的指纹。不要误用单行指纹。左选项赋字符串 `"left"` 后到本场景标签，右选项跳到 right 场景。
- `set` 的 args 必须包含运算符；数字例为 `["trust", "=", "1"]`，字符串例为 `["route", "=", "\"left\""]`。DSL 表达式的字符串引号也是参数内容，不能省略。

如只需普通正文，可使用这个不依赖角色、变量或素材的新场景输入：

```json
{
  "operationId": "create-first-chapter",
  "sceneId": "first_chapter",
  "blocks": [
    { "kind": "text", "value": "雨停了，窗外传来脚步声。" },
    { "kind": "label", "name": "ending" },
    { "kind": "text", "value": "这一章到此结束。" }
  ]
}
```

创建后从 `scene:first_chapter` 读取真实子对象并试玩。是否设为项目入口、是否替换已有内容，按创作要求决定，不擅自覆盖同名场景。

scene.create 自动补齐文档末尾的 `@end`；blocks 已以该指令收尾时不会再追加。分支中有意放置的 `@end` 会保留，不做全文去重。这只是场景结束，不会自动记录通关。

### 读取正文与续页

调用 `object.inspect`：`{ "objectRef": "scene:first_chapter", "view": "working", "fragment": { "limit": 100 } }`。片段包含原始文本、行尾、行号、实际对象引用及版本；每页最多 200 行。若有 nextLine，续页必须传 `fromLine: nextLine`、`expectedRevision: fragment.revision`，working 还要传 `expectedWorkingRevision: fragment.workingRevision`。版本变化会拒绝续页，应从首页重读，不能拼接两次版本。

scene.create/scene.patch 的 `continuation` 是当前工作版本的父场景入口。操作原结果中的 path/line 属于原回执，尤其旧 operationId 重试时不保证仍是当前行号；用 continuation.sceneRef 重读再修改。删除对象不会得到伪造的替代引用。

匿名子对象引用绑定读取时的项目/工作版本；写操作改变版本后，即使目标在另一场景、文字没变，也不要复用之前缓存的引用。连续使用匿名引用做 patch 时，每次成功后先重读再取得下一处引用/指纹；收到过期错误就刷新，不猜新引用或绕过保护。这不意味着无对象引用的独立操作（如创建不同场景）也必须每次 inspect。

标签先读取 `label:场景.标签` 的指纹，再用 scene.patch 的 `renameLabel`（含 name）或 `removeLabel`。这两个变体仅限 direct：改名同时更新实际本地/跨场景引用，返回 affectedScenes；删除仍被引用的标签会拒绝并列出调用位置。普通胶囊不可组合或进入正式候选/结果审批；审读使用 change.diff、working-change 试玩及原草稿续接，不把新工作版本当作旧胶囊画面。

Editor 选中标签后使用“改名并更新引用”，会同步正文调用、回想入口和已有撤销历史中的身份；引用仍存在时，行删除和步骤菜单删除都会拒绝。改名只改草稿，“保存全部”才同批写入关联场景与回想配置。新场景先保存再改名标签；标签改名与场景移动/改名分别保存。身份改名不作为普通台词撤销点，后续撤销正文不会带回旧标签名；无引用标签的删除仍可正常撤销。直接改源码属于手工编辑，不自动执行引用迁移。

### 改名场景并续接原草稿

在 OPEN 的 direct 草稿中，先读取 `object.inspect({ "objectRef": "scene:draft", "view": "working" })` 的完整场景指纹，再调用 `scene.rename`（MCP：`surdet_scene_rename`）：

```json
{ "operationId": "rename-draft", "sceneId": "draft", "newSceneId": "arrival", "expectedFingerprint": "复制刚读到的场景 fingerprint" }
```

它保留场景所在目录及行尾，更新真正的 jump/call/选择目标、入口/结束场景、文本回想、事件/成长/日历的既有场景字段；正文里的同名字串和其他未知配置字段不替换。返回 `affectedPaths` 和 `continuation.sceneRef`，用新入口重新读取对象再返修。缺省入口会明确固定为改名前的语义入口，避免文件排序改变开场。新 ID 不得与已有场景重名或仅改变大小写；无法安全判定的引用先报错，业务记录和正文不半写。

candidate/integration 明确拒绝该跨文件操作，既有候选创建/修改能力保留。stage 不写回来源，继续按差异、校验、模拟、真实试玩及获授权 apply 提交。相同 operationId 的重试返回原改名回执；若该目标随后再次改名或删除，回执不伪造当前 continuation，应重新读取项目事实。场景改名不是旧玩家存档的迁移，不据此承诺内容升级后旧档仍能定位。

### 按章节整理场景目录

只整理位置、不改剧情身份时，在 OPEN direct 草稿使用 `scene.move`（MCP：`surdet_scene_move`）。先从同一次 `object.inspect({ "objectRef": "scene:arrival", "view": "working" })` 复制 `source.path` 与完整 `fingerprint`：

```json
{ "operationId": "move-arrival", "sceneId": "arrival", "directory": "第一章/港口", "expectedPath": "content/scenario/arrival.gal", "expectedFingerprint": "复制刚读到的场景 fingerprint" }
```

`directory` 相对 `content/scenario`；空字符串表示回到根目录，允许中文、空格与多级目录，不允许绝对路径、`..`、系统保留名称、被项目扫描忽略的目录或已有路径别名冲突。移动保留文件名（含后缀大小写）、场景 ID、正文、行尾及所有跳转/配置引用；没有明确入口时，同次操作把移动前的隐式入口写入配置，避免章节排序改变开场。

结果列出 `previousPath/path/affectedPaths`，进入原 `change.diff`、working-change 试玩与获授权的 apply 提交，不立即改来源文件。候选/integration 在业务写入前拒绝，不能混进候选合成。位置已变化时，即使正文指纹相同也必须重读；相同 operationId 重试只返回原回执，后来又移动或删除的旧目标不伪造 continuation。移动后的匿名子引用也应重新读取。该入口不提供跨版本玩家存档迁移保证。

磁盘上的空目录或仅含说明文件的目录不在剧情快照中，提交时仍检查实际目录名；例如磁盘 `Chapter` 与请求 `chapter` 不一致时拒绝并保留原文件。使用真实大小写修正草稿位置后重新验证再提交，不绕过检查或删除用户目录；同稿可先移回根目录，再移入实际章节。

人类接管时可在编辑器左侧场景行选择“移动”，输入章节目录（留空回根）。点击后先保留为未保存草稿，“保存全部”才创建目录并移动文件；缺省开场随同一保存批次固定，正文历史和自动备份随新路径继续。同一已落盘场景有未保存移动时先完成保存，再改名、再次移动或删除；保存中断按原批次重试，不另行手改磁盘。等待界面结束保存再关闭项目。

### 删除不再使用的场景

先读取 `object.inspect({ "objectRef": "scene:unused", "view": "working" })` 的完整场景 `fingerprint`，再调用 `scene.remove`（MCP：`surdet_scene_remove`）：

```json
{ "operationId": "remove-unused-scene", "sceneId": "unused", "expectedFingerprint": "复制刚读到的场景 fingerprint" }
```

仅支持 OPEN 的普通 direct 草稿，stage 不会因此获得来源写权限；candidate/integration 会在修改前拒绝。它删除按场景 ID 唯一定位的整个文件（含子目录、`.GAL`），不是 removeObject 删除一行，也不会伪造已删除对象的续接引用。

入口、player.endScenes、其他场景的 jump/call/选择项、文本回想以及事件/成长/日历配置仍有引用时，错误的 `details.references` 会列出来源，不能强制或级联删除。先明确调整调用者及配置，再重读并删除；清理模板时通常先修改 entryScene 和 player.endScenes。没有公开修改入口的配置由人类按正常编辑流程处理，不在已有草稿外偷偷改来源。失败不修改草稿；相同 operationId 和相同请求可以安全重试。

删除随后进入正常 change.diff、validate、simulate、真实试玩、封存和获授权的 apply 提交。差异中的文件标记 `changeType: "deleted"`、不提供 afterSha256，并计入 `summary.removedScenes`；不能把删除当成覆盖为空文件。提交中断仍走已有 change.recovery.inspect/execute；遇到外部重建或改写的未知文件，保留内容并停止自动恢复。事件和日历配置现已纳入快照版本检查，旧草稿若因此报告来源变化，应保留旧记录并重新读取项目，不强行改基线。

### 项目展示配置

`project.inspect` 的 `playerConfig` 返回有限字段的 `values` 与修改所需 `fingerprint`。`title`、旧式 `font`、字体角色表 `fonts` 存在 game.config.json 根部，`subtitle`、`titleBackground`、`titleLogo`、`endScenes`、`firstRunHint` 存在其 `player` 对象中；无需打开或修改 src/main.ts。

普通 direct 草稿先以 `view: "working"` 读取，再调用 `project.player-config.patch`（MCP：`surdet_project_player_config_patch`），提供 operationId、刚读到的 expectedFingerprint 及 patch。只写要改的字段；旧指纹会被拒绝，成功后重新读取。该操作不支持 candidate/integration。

```json
{
  "operationId": "chapter-display",
  "expectedFingerprint": "替换为公开读取返回的指纹",
  "patch": {
    "title": "风停之后",
    "subtitle": "一封信，两段航程",
    "titleBackground": "post_office",
    "endScenes": ["end_a", "end_b"],
    "firstRunHint": ""
  }
}
```

示例背景必须已出现在 project.assets，两个结局场景也必须已建立。读取中的 null 表示字段未提供；patch 的 null 移除该字段，空字符串/空数组则明确清空。消费优先级为显式 PlayerProject 参数 > game.config.json > 不依赖具体作品的默认行为；显式参数消费者不受新配置覆盖。标题改变不会改变 package name 所确定的存档身份。标签改名也同步文本回想 texts[].label；素材改名同步配置标题背景，其他字段保持原值。

字体复制 `project.assets.intelligence.items` 中 `kind: "font"` 的完整 `sourcePath`，不是 basename 或素材短键。例如 `patch: { fonts: { body: "content/assets/fonts/正文.TTF", title: "", ui: null } }`：body 换字体、title 明确使用默认字体、ui 删除该角色配置，未提供的角色保持原值。`fonts` 对象整体优先于旧 `font`，缺省/空角色不会从旧 font 继承；`fonts: {}` 表示建立/保留角色表，`fonts: null` 才删除整表并恢复旧 font 或默认行为。未知配置字段仍保留，读取的角色 null 表示未提供。路径区分目录与大小写；不同目录同名字体不是重复键。字体目录同时列出每个角色的实际引用。

字体修改只支持 direct；candidate 场景引用基线字体路径并记录有效角色配置的重放指纹，不得伴随写配置。未封存旧草稿若缺少新增字体事实，须保留原记录并新建候选，不能补写历史；已封存胶囊不改写。隔离工作版本试玩读取未写回的配置，坏字体明确显示文件与失败原因并记失败；Player 会报告失败并使用默认字体，不能把回退当作字体加载成功。字体许可原件随附方式见下文素材导入。

**阅读排版检查：** 字体成功加载不代表覆盖所有字形。Editor「预览 → 检查当前排版」检查当前已显示的文字；逐字显示结束后再检查完整段落。`FONT_MISSING_GLYPHS` 列出配置字体缺字及 Unicode 编号，系统回退有画面不算配置字体通过；`FONT_COVERAGE_UNAVAILABLE` 表示系统字体或覆盖表不可读取，不能当作零缺字。`TEXT_OVERFLOW` 是横向/节点内部溢出，`TEXT_CLIPPED` 表示自定义文字/按钮的实际文字片段被画面或上层 hidden/clip 区域裁切，不以空白节点边界代替文字边界；滚动容器先取其可见片段，不把可滚到的内容直接判成裁切。`TEXT_SCROLL` 仅表示 ADV/NVL/选项需要滚动，不是丢字。检查不判断其他节点遮挡、所有控件或未播放章节，没有警告不等于全作品所有文字均可读。没有画布的环境明确返回 `TEXT_MEASUREMENT_UNAVAILABLE`。

既有 Renderer `queries.diagnostics.projectionSnapshot().dialogue.readingDiagnostics` 返回原生正文/名字/选项/NVL 的实际投影检查。Editor 只读 `surdetPreviewDebug.readingDiagnostics` 额外给出当前步骤 `source`、`typing` 和 `issues`；`source` 是当前阅读位置，不是 NVL 所有旧段或仍显示的上一句各自的来源。既有 `runtime.read-preview` 的 `presentationBefore/After.projection.dialogue.readingDiagnostics` 保留**事件发生时**的快照，打字中的快照不是整句终态。完整作品 UI 请用「试玩草稿」或 Player，`window.__surdetDebug.readingDiagnostics` 合并当前原生层与自定义文字/按钮的检查，`ui:页面.组件ID` 定位真实节点；已被自定义 UI 替代的原生层不重复报错。检查不遍历未播放剧情，不验证复杂文字塑形质量、所有系统回退字体或不可见分页，不能据此声称全作品排版已通过。

### 作品主题与外观配置

`project.inspect` 的 `themeConfig` 返回 `value`（game.config.json.theme 原文，未提供为 null）、`effective`（解析后的 token/皮肤/布局）、`titleLogo` 与修改所需 `fingerprint`。主题 token 组（`colors`/`opacity`/`typography`/`spacing`/`radius`）与 Renderer 主题同构；`dialogSkin`/`buttonSkin` 引用背景素材键作为对话框/按钮皮肤；`dialogHeightRatio`/`dialogMarginX`/`dialogMarginBottom` 控制基础布局；`titleLogo` 在 `player` 对象中设置标题字标素材键。

普通 direct 草稿先以 `view: "working"` 读取，再调用 `project.theme-config.patch`（MCP：`surdet_project_theme_config_patch`）。token 分组整表替换，null 删除该组；皮肤/字标键设字符串或 null 清除；布局数值设数或 null 恢复默认。`patch: null` 删除整个 theme 段（不影响 titleLogo）。省略字段保持当前值。

`effective.tokens` 补齐与 Renderer 相同的默认值；`sources` 逐字段标明 `project` 或 `default`，不冒称已知宿主传入的显式覆盖。有效 token 名称可直接从该读取结果取得，未知 token、非法色值/透明度/负数在写入前拒绝。`dialogHeightRatio` 为屏高比例（大于 0 且不大于 1，保留至少 188 引擎单位的阅读区），`dialogMarginX` 为左右外边距，`dialogMarginBottom` 为底部留白；过大的边距在目标画面中限制到仍可阅读的范围。布局 null 保留既有自适应默认。皮肤按目标框尺寸缩放，按钮皮肤覆盖标题、系统菜单、设置/存读档及剧情选项，不提供九宫格或自由组件画布。

Player 的显式主题字段只覆盖相应项目字段，不会因只显式设置一个颜色而丢掉其余作品配置；显式空皮肤键可禁用项目皮肤。主题和字标图片必须真实加载成功，缺失或解码失败会明确报错，不把默认画面回退当作成功。Editor 默认提供中文主题表单，按颜色、字号、字体、皮肤与布局编辑，留空恢复对应默认；“高级：原始配置”仍可编辑同一份 JSON 草稿，包含 theme/titleLogo，以及可选的 font/fonts/titleBackground：theme 内删除已支持字段即恢复默认，后三项省略时保持原值、null 清除；fonts 对象是完整角色表。保存仍复用对应的主题/展示配置操作与同一事务。未完成的表单输入也保留为草稿，校验不通过时不能用旧值假装保存成功。未保存预览、撤销/重做与保存重开使用同一配置，未知来源字段保留。界面上的中文名称不改变脚本、配置键或 Agent 合同。

```json
{
  "operationId": "work-theme",
  "expectedFingerprint": "替换为公开读取返回的指纹",
  "patch": {
    "colors": { "accent": 9117247, "panel": 2760479, "text": 16115411 },
    "opacity": { "panel": 0.88 },
    "typography": { "bodySize": 30 },
    "dialogHeightRatio": 0.32,
    "titleLogo": "title_logo"
  }
}
```

主题引用的素材键必须已出现在 project.assets 的 backgrounds 中。修改只支持 direct；candidate/integration 在修改前拒绝。`config:theme` 已纳入组合基线指纹、候选重放前置与封存依赖检查。缺省不提供 theme 字段时保持已接受的默认外观；显式 PlayerProject 参数优先于 game.config.json，再到引擎默认。Editor 的"主题外观"配置区可读取、修改和保存同一配置。

### 作品界面与人类接管

不定制时沿用默认 UI。需要定制时，先用 `project.ui({view:"working"})`（MCP：`surdet_project_ui`）读取 value/defaultPages/nodes/fingerprint，再用 `project.ui.patch`（MCP：`surdet_project_ui_patch`）修改。文档位于 `game.config.json.ui`，结构 `{version:1,pages:{...}}`；省略页面即使用默认界面。

页面：title、system-menu、save-load、settings、gallery、backlog、dialogue、choices、toolbar、hud。固定组件：container、image、text、button、toggle、slider、progress、input、scroll、tabs、content。每个节点有全作品唯一的 id、type 和 `frame:{x,y,width,height,anchorX?,anchorY?}`。设计坐标为 1280×720，节点原点＝父级原点＋x/y－anchor×本节点宽高；锚点范围0..1，默认0，尺寸须为正。兄弟顺序即叠放顺序；tabs 子项用 tab 命名分组。

`text` 支持 `{kind:"literal",value:"文字"}`、`{kind:"variable",name:"已声明变量"}`、`{kind:"setting",name:"textSpeedCps"}`，以及 `{kind:"data",field:...}`：title 的 title/subtitle，dialogue 的 speaker/dialogue，save-load 的 mode，公共内容条目的 id/label/description/value/date。文字不执行表达式、JS 或 HTML。数组变量可加 `format:"list"`（以“、”连接）或 `format:"count"`（数量），只读变量也可显示；不复制物品状态。image.asset 为唯一的项目背景素材键；style 可设 color/background/opacity/fontSize/align/fontRole（body/title/ui）。

任意节点可加 `visibleWhen:"panelOpen && trust >= 10"`，交互控件另可加 `enabledWhen:"trust >= 10"`。条件使用 Core 原有纯表达式，所有变量必须已声明、操作数类型正确、结果为布尔；不能调用 JS 或修改状态。空条件应省略，`node.update` 传 null 可清除该条件。运行时除零等错误会隐藏出错页面并显示原因，正常剧情仍可继续，条件恢复后页面重新显示。

`progress` 使用 `binding:{kind:"variable",name:"energy"}` 读取数值变量，包括 readonly；范围沿变量 min/max（省略时为 0/100，max 必须大于 min）。条形比例只截到范围内，不修改实际值；它不是滑条。

toggle/slider/input 的 `binding:{kind:"variable"|"setting",name}` 必须匹配类型并遵守只读约束。输入框只绑定可写字符串变量，开关绑定 flag/boolean 或 skipStrategy，滑条绑定数值。可调整设置：textSpeedCps、autoBaseDelayMs、masterVolume、bgmVolume、ambienceVolume、seVolume、voiceVolume、skipStrategy；范围仍由原 Player 设置控制。

按钮 action 为有限操作：start/continue/back/close/advance/rollback/auto/skip/hide；`{kind:"open",page:"settings"}`；存读档页须明确 `{kind:"open",page:"save-load",mode:"save"|"load"}`。save/load 可带槽位 id，不带时打开列表；choice/gallery-item 使用当前条目或明确 id；setting-step 使用 name 和 direction: ±1。content.source 为 save-slots/backlog/gallery-cgs/gallery-music/gallery-texts/choices/settings，须放在对应页面，子节点可读取当前条目。原保存确认、暂停、返回及失败恢复继续有效。

阅读页（hud/dialogue/choices/toolbar）按钮可用 `{kind:"variable-set",name:"panelOpen",value:true}`，只向已声明的可写数值/字符串/开关赋同类型字面值，数值沿原 VariableStore 范围处理；不支持数组赋值、脚本或任意运算。正常游戏中的变量控件与此按钮只在正文/选项阅读暂停点写入，菜单、视频、定时等待及存读档事务期间拒绝，事务完成或失败后可重试；旧标题页姓名输入仍按原入口工作。隐藏、禁用的控件不执行操作，点击不代替剧情推进，作品控件中的 Ctrl+A 不启动剧情快进。变量仍随普通存档恢复、新游戏重置。

修改支持 page.set/page.remove、node.insert/node.update/node.remove/node.copy/node.reorder。更新节点只传所需字段，frame/style 等子对象整项替换；复制需提供 newId，后代也产生新 ID。例如：

```json
{
  "operationId": "revise-title",
  "expectedFingerprint": "刚读取的 fingerprint",
  "patch": { "type": "node.update", "page": "title", "id": "title-heading",
    "patch": { "text": { "kind": "literal", "value": "潮汐画笺" } } }
}
```

UI 写入仅支持 direct，candidate/integration 在业务修改前拒绝。旧指纹、非法动作/绑定/引用不写内容；候选可读取基线 UI，并封存 config:ui 与实际图片、变量及配置字体依赖。仍须正常 diff、校验、模拟、试玩与获授权写回。

Editor「配置 → 界面设计」可接管同一文档，选中、拖动/缩放、精确输入几何、对齐、重排、复制、撤销/重做、恢复单页默认并保存。「试玩草稿」将未保存的舞台/主题/UI 投影交给普通共享 Player 的独立测试上下文，不写正式作品进度；普通剧本预览不代替完整 UI 试玩。

本地 `surdet-ui` JSON 支持导出作品主题或所选片段。主题含支持的主题字段、页面、字体及必要图片；片段只带组件和图片，继承目标作品主题/字体。共享资源与现有素材 authority 同范围：PNG/JPEG/WebP、TTF/OTF/WOFF2，其他格式明确拒绝。包内不含剧情、存档、变量初始值、未知项目字段或绝对来源路径。目标须已有同名同类型变量；片段导入同类页面并产生新 ID。相同字节资源可复用，内容冲突拒绝覆盖。缺失资源先加入素材导入待选区，确认导入后再次导入共享文件生成草稿；authority 不可用时不绕过写入边界。草稿保存才写盘，素材依原回执撤销。分享许可与许可证原文仍按既有素材流程处理。

Editor 的合法场景改名会同步已知引用及 `player.endScenes` 等结束配置：改名先更新工作稿，点击“保存全部”后一起写入。删除仍被引用的场景会被拒绝并指出来源，应先调整引用；异常配置也不会绕过检查。

### 文本目录与译稿 CSV

正文、选项、人物显示名、自定义界面字面文字、名词表规范词，以及人物档案的片段标题/说明和用语解释可按需登记到 `game.config.json.textCatalog`，不改剧本，也不自动为每行创建永久 ID。共享 Player 直接消费已确认译稿，不生成翻译或配音。

1. `project.texts({view:"working",locale:"en"})` 读取当前来源和已登记键。复制 **result.revision**、`fingerprint` 和真实 `sources[].sourceId`，不要用外层的来源项目版本或猜行号。JSON 的 sources/entries 分别按同一 offset/limit 分页；后续页必须携带首个 result.revision 作为 expectedRevision，变化则从头重读。
2. 在 direct 草稿调用 `project.texts.patch`，传 `operationId / expectedRevision / expectedFingerprint`，patch 为 `{type:"bind",sourceLocale:"zh-CN",bindings:[{key:"intro.greeting",sourceId:"复制读取值"}]}`。同一键可显式重新绑定；交换多个键的来源必须同批提交。候选/integration 在修改前拒绝。
3. `project.texts({view:"working",locale:"en",format:"csv"})` 完整导出已登记的键，不传分页参数。只编辑 `translation` 列，保留 key、locale、sourceVersion、speaker、context、source；status 只供阅读。
4. `project.texts.import.preview({view:"working",locale:"en",csv:"完整CSV文字"})` 返回逐行差异和问题。必须 ready=true，再把相同 CSV、locale、previewFingerprint 放入 `{type:"import",...}` patch，使用预览返回的 revision/fingerprint。预览后修改 CSV 或源项目，需要重新预览。
5. 沿原 `project.validate → project.simulate → runtime.run-from → change.diff → 封装/获授权 commit` 完成。目录修改不授予来源写权限，不跳过正常交付检查。

CSV 支持 UTF-8 BOM、双引号转义、逗号和字段内换行；导出对公式前缀或原有首撇号添加一层 `'` 转义，回导还原这一层，不把内容当公式执行。缺行、重复/未知键、旧源文、变量占位符不一致或错误 Ruby 会整批拒绝。空译文表示未翻译，不能用空单元格清除已有译文；仅在明确要删除对应关系及其全部译稿时使用 `{type:"remove",keys:[...]}`。

**改稿规则：** 文本键是固定身份，sourceId 的段内序号只是当前已确认场景版本的坐标。场景正文 SHA-256 变化后，旧目录保持不变并显示 needs-rebind；不得按当前行号、全文相似度或序号直接认定原键属于下一句。先对照旧源文与当前 sources，显式重新绑定原键。绑定确认后，文本/说话人改变会标 needs-translation，原译文仍保留；未改变的文字可以继续使用旧译文。目录不参与存档位置迁移。

**其他文本来源：** `sources[].kind` 除 `dialogue/choice` 外，还包括 `character/ui/term/gallery`。展示字段以 `objectRef` 定位：`character:角色标识`、`ui:组件标识`、`term:规范词`；UI 分页标题另带 `field:"tab"`。剧情资料使用 `gallery:profiles:资料标识` / `gallery:terms:词条标识`，另带 `field:"title"` / `field:"description"`；人物名和规范词仍复用原 character/term 来源。始终复制公开读取的 sourceId，不自行拼接。字段改文、组件改名或词条改名后须显式重新绑定；旧译稿保留并报告失配。`content/config/terminology.json` 纳入项目快照、工作预览及候选重放的只读依赖。词条翻译只影响名词表/辞典显示，不全文替换正文中的同名文字。

**播放与试玩：** 在默认「设置 → 显示与输入 → 作品语言」选择源语言或目录中已有译文／配音的语言；自定义界面可用 `{kind:"setting",name:"locale"}` 读取偏好、`setting-step` 操作循环切换，名词表列表用 gallery 组件的 `content.source:"terms"`。偏好独立持久化，不随剧情存档恢复。语言切换刷新当前等待阅读的台词/选项，不执行剧情；变量插值发生在选定语言后，条件、原选项索引、角色标识与跳转不变。历史记录保留当时阅读的正文和人物显示名，NVL 已读旧段的正文保留原语言，当前段刷新。缺失、过期、来源变化的译文回退原文并给出诊断。编辑器可点「试玩已确认译稿」，使用独立测试进度；未确认 CSV 不参与播放。默认系统按钮仍为中文，不翻译路径、变量名、标签或任意运行数据。已有自定义启动器如需词条，按当前模板向 `startPlayer` 传入 `terminology`；旧启动器省略时不显示词条。

Editor「配置 → 文本与译稿」使用同一操作：读取目录→填写文本键/选择来源→加入绑定清单→绑定清单并保存。导出译稿表格只下载目录内容，不覆盖编辑框、绑定清单或导入预览；“下载当前工作稿”按原样下载编辑框内容。“载入已保存译稿”用于从目录开始编辑，替换已有文字须确认，可撤销；载入的工作稿仍须预览差异并明确导入。CSV 也可复制或选择文件导入。未确认 CSV 与待绑定清单都复用配置草稿、撤销/重做和项目切换保护，面板重建或重读目录不丢清单；保存全部不会自动批准绑定或导入。绑定保留核对时的项目版本和目录指纹，版本变化时保留旧清单并要求逐项重新核对、加入，不静默套用旧坐标。登记前先保存剧本。改名同步场景/标签引用，但仍需确认新场景版本；删除仍被目录引用的场景/标签会拒绝。

**关联已有配音：** 先登记对白、确认目标语言译文，并把获准声音文件放入 `content/assets/voice/`；源语言不需要译文。`project.texts` JSON 返回可用 `voiceAssets` 素材键，以及每条的 `spokenText / voiceStatus / voices`。不要填本机路径或 URL。

1. `project.texts({view:"working",locale:"ja",format:"voice-csv"})` 或 Editor“导出配音清单”完整导出已登记对白，不分页、不包含选项和展示字段。
2. 保留表头 `key,locale,sourceVersion,speaker,context,source,text,voice,action,status` 和来源事实，只编辑 `voice / action`。`text` 是当前确认的待录台词，改译文仍用译稿表。`keep` 原样保留；`bind` 明确确认该录音对应当前台词；`remove` 同时清空 voice，解除这一语言的配音。空白不是隐式删除，未改行也须保留。
3. 复用 `project.texts.import.preview` 和 `{type:"import",locale,csv,previewFingerprint}`。预览核对完整清单、台词版本及唯一受支持的 voice 素材；目录、CSV 或可用素材清单变化后重新预览。仍为 direct-only，最后正常校验、试玩、diff 与获授权写回。Editor 在原编辑框选择 CSV、预览、确认保存，保存全部不会代替确认。

`voices[语言]` 保存 `{asset,sourceVersion,text}`。改译文保留旧录音并标 `needs-recording`，来源变化须先重新绑定文本键。素材改名精确更新语音键，不改台词/确认版本；引用纳入素材诊断与候选依赖。`ready`／“已确认”仅表示绑定与素材元数据有效，不代表文件可解码、录音语义或听感已经人工验收。

作品语言与数值设置保存成功后才生效；失败时保留最后已保存值并提示，不把临时内存值冒充持久化成功。连续步进按成功值依序计算，离开或关闭播放器后，晚到的设置回调不再刷新原画面。

有目录配音的对白按当前语言选择；缺失/过期时不借另一语言或旁边的 `@voice`，但阅读可继续。完全无目录配音的行沿用显式 `@voice`。自动模式等待语音加载和结束；音频失败报告诊断并解除等待，手动推进、快进、切场、重置停旧语音。菜单暂停故事语音；回看重播当时的配音，不改剧情，离开即停。语言切换重选当前句声音，菜单内排队、返回后起播，不重写旧历史。读档按当前语言从句首播放，不保存采样级声音位置。只管理已有录音，不生成、转码或审核声音内容。

### 场景结束、通关记录与回到标题

- `@end` 结束当前场景，不等于通关，也不会填充模拟结果的 endings。
- `@clear ending_a` 记录结局 `ending_a`，随后仍会继续执行；在需要计入通关的终点放在 `@end` 前。普通章节结束不用强行记录通关。
- `player.endScenes` 指定哪些场景结束后由共享 Player 返回标题，不会替你执行 `@clear`；它存的是场景 ID，可以与通关结局 ID 不同。

```gal
@scene ending_a
旁白：这一程到这里结束。
@clear ending_a
@end
```

多结局作品验收时，除确认模拟未报错、未耗尽预算，还要核对 `endings` 是否包含所有预期结局，逐项检查 `deadEndScenes` 是否为遗漏的跳转或通关指令。`status: "passed"` 只表示运行检查通过，不替代这些作品目标；最后仍须真实试玩。浏览器存读档检查应复用同一站点地址和浏览器数据环境，新建临时/无痕环境看不到旧档不等于存档丢失。

### 从已有素材做一段有演出的剧情

先读取 `project.assets({ "view": "working" })`（未建草稿时用 project）。背景和立绘的可用条目带有 `usage.scene` 与 `usage.timeline`：前者是可直接放进 scene.create 的 blocks 或 scene.patch 的 insertAfter.blocks 的指令对象，后者是可放进 timeline.create 的 definition.tracks 的轨道。示例已经使用当前项目的真实键，并处理场景参数的引号，不要把 sourcePath 当成素材键，也不要去掉示例 args 内的引号。

声音和视频从 `intelligence.items` 选择：可用条目也带 `usage.scene`；音乐、音效、语音还提供 `usage.timeline`，可用原 timeline.create/patch 创建和返修 audio 轨道。当前 audio actions 为 bgm/se/voice；环境音与视频只有场景用法，不编造对应轨道。示例是素材接线，不代表媒体已经解码或节奏已经合适。重名、缺失、非法名称和当前未接入格式不会获得示例；环境音保留字 off 表示停止，不用于播放同名文件。

候选的场景、选项内指令和时间轴会记录声音／视频的分声道依赖，只接受 change.begin 时已解析的项目媒体；新文件须先完成素材导入，再开始候选。即使同名，bgm/ambience/se/voice 仍是不同资源。直接 URL 或无项目来源的媒体不会被冒认为基线素材；已有 direct 用法不因此取得候选资格。已封存旧胶囊不重写，旧草稿若缺少现在需要的媒体事实，应保留原记录并重新建立候选，不能手改事实强行封装。

- 背景：复制所选 backgrounds 条目的 usage.scene；它是 `bg` 指令。
- 立绘登场或换表情：在 portraits 中选同一 timelineTarget 的不同 expression，分别使用其 usage.scene（`show`）。再次 show 同一角色/服装会更新表情；默认居中，可将 modifiers.pos 改为 left/right/center。不是每说一句话都重新 show。
- 头像不是立绘：avatars 用于角色的对话头像，不能拿来作为 show 的目标。角色表中的 id/name 管台词身份与显示名，立绘的 role/outfit/expression 管图像；需要说话焦点对应时，让角色 id 与素材 role 对应。新增/改名先读取 `project.inspect({ "view": "working" })` 的 charactersFingerprint 并传给 character.ensure.expectedFingerprint；角色表为空也能读取，不为换表情改角色名。
- usage 是最小用法，不是预设审美或动画：时间轴 cue 默认 atMs=0、durationMs=0、easing=linear。需要渐入就主动设时长；整条时间轴 durationMs 必须覆盖所有 cue 的 atMs+durationMs。没有 usage 的条目先查 intelligence.issues；不能只凭 resolved=true 忽略同名冲突、非法名称或不支持格式。已有音频沿原路径保留，本轮不新增音频生产。

一个简单顺序是：**背景 → 正常表情登场 → 一句台词 → 微笑表情 → 一句台词 → 隐藏角色**。使用读取返回的两个 usage.scene 对象，并将台词写为 `{ "kind": "text", "speaker": "实际角色 ID 或显示名", "value": "正文" }`。隐藏用 `{ "kind": "instruction", "name": "hide", "args": ["实际 role"] }`，不是 timelineTarget。普通表情切换直接用场景指令即可，不必为了两句台词建立时间轴。

角色资料沿用 `character.ensure`：`name` 是默认显示名，`avatar` 是 avatars 中的实际键。需要让某个服装／表情使用另一张立绘时，direct 草稿可传 `portraits: { "coat": { "smile": "content/assets/portrait/实际角色_实际服装_实际表情.png" } }`；路径必须复制当前目录返回的完整 sourcePath。这会替换该角色的整份显式映射，省略 portraits 保留原值，传 null 清除映射并恢复文件名发现。未配置的槽仍按“角色_服装_表情”发现；配置了却缺文件或解码失败会明确报错，不静默改用旧图。`project.inspect` 的 characters[].declaration 与 charactersFingerprint 提供当前值和修改指纹；修改后重新读取 `project.assets(view:working)`，configured 和 overriddenSourcePaths 会标出显式绑定及其覆盖的原文件，usage 使用最终逻辑键。未知角色字段保留。

自动发现只接受恰好三段、各段非空的“角色_服装_表情”文件名；`rin_coat_smile_v2.png` 之类备份名仍可诊断或显式绑定，但不会截断成 smile 覆盖原图。同一槽存在多个合法图片时，试玩与成品会明确报绑定冲突，快捷选图也不猜其中一张；先在角色资料中明确绑定，或整理冲突文件。

**分层立绘与帧动画。** 在 direct 草稿中用 `character.ensure.visuals` 设置 `服装 → 表情 → 定义`，继续携带 `charactersFingerprint`。`portraits` 仍只接受静态图片路径；同一槽不能同时存在两种显式配置。省略 visuals 保留旧值，null 删除整份动态映射，对象替换整份映射。`project.inspect` 的角色 declaration 可读取定义；`project.assets` 返回 visual、全部 sourcePaths、resolved 与原有 usage。先导入全部图片，再编辑定义，最后使用原 `@show 角色:服装 表情` 或时间轴 show。

两种定义示例（图片路径必须换成项目目录的真实 sourcePath）：

```json
{
  "coat": {
    "blink": {
      "version": 1, "kind": "sequence", "loop": true,
      "frames": [
        { "image": "content/assets/portrait/rin_parts_open.png", "durationMs": 2400 },
        { "image": "content/assets/portrait/rin_parts_closed.png", "durationMs": 120 }
      ]
    },
    "talk": {
      "version": 1, "kind": "layered",
      "layers": [
        { "id": "body", "images": { "normal": "content/assets/portrait/rin_parts_body.png" }, "default": "normal" },
        { "id": "mouth", "images": { "closed": "content/assets/portrait/rin_parts_mouthclosed.png", "open": "content/assets/portrait/rin_parts_mouthopen.png" }, "default": "closed",
          "speaking": { "loop": true, "frames": [{ "variant": "closed", "durationMs": 100 }, { "variant": "open", "durationMs": 120 }] } }
      ]
    }
  }
}
```

图片须为相同尺寸的完整画布；分层部件在该画布上对齐，空白区域透明。layers 顺序从后到前，每层只显示一个变体；default 必须存在，idle 为待机序列，speaking 只在当前角色的台词打字时使用（无 speaking 时沿用 idle）。这不是音素级语音口型。说话状态切换重启分层序列时钟，普通帧动画不受说话状态重启影响。每段 1–256 帧，每帧为正整数毫秒、总长不超过 10 分钟；最多 16 层、每层 64 变体。loop:false 完成后保持最后一帧。

暂停冻结进度；快进将单次片段收至末帧、循环片段暂用默认画面；减少动态效果使用第一帧／默认部件。存档记录图片内容身份和动画位置；任何帧缺失、画布不一致或存档图片身份不符均拒绝，不悄悄回退到首图。舞台移动、镜像、缩放、透明度及表情过渡作用于整个组合。校准页显示默认组合，作者须为其他帧／变体留足可见范围。

Editor 角色表的“分层 / 帧动画”提供 JSON 草稿及引用已导入图片的起始示例；保存、撤销／重做沿用角色表。快捷选图与排布显示默认组合，真实动画在试玩中查看。素材目录会追踪每个部件，包括未选中的变体；整理图片同步修改定义路径。candidate 可使用基线已完整解析的动态槽，配置依赖按现有 manifest 冻结；本阶段不允许 candidate 修改 visuals，不回填旧胶囊，也不把胶囊声明成素材二进制归档。

人类可在 Editor“配置 → 角色”填写 ID 和显示名，点击“添加角色”建立首个或新的未保存角色；“取消新增”只撤销该草稿，不删除已有角色。仍须保存角色表才写入文件，原角色缺失不会被误当成新增。随后可展开服装／表情绑定，添加一行、填写服装与表情、从项目立绘中选图，再点“保存角色表”或“保存全部”。编辑支持原配置撤销，未保存不写磁盘；移除绑定只恢复该槽的自动发现，不删除图片。重复槽、不完整字段和不存在的图片会拒绝保存，保留草稿供修正。

Player、Editor 的工作稿试玩读取对应版本的角色资料。候选可以使用基线映射并核对 config:portraits 状态，但禁止修改 portraits 或删除带映射的角色；原 name/avatar 候选操作仍可用。映射与物理素材分别保留各自依赖，先导入再建候选。原安全素材移动会同步更新映射的完整路径；涉及显式槽本身的服装／表情语义改名会要求先调整资料，不以全文替换猜测。

需要背景/人物/镜头同时变化时，再创建时间轴：从 usage.timeline 复制背景和立绘轨道，按需要改位置与时长，也可增加镜头轨道。下例只有镜头，不依赖某个示例素材：

```json
{
  "operationId": "create-arrival", "timelineId": "arrival",
  "definition": {
    "version": 1, "id": "arrival", "durationMs": 800,
    "tracks": [{ "kind": "camera", "cues": [
      { "atMs": 0, "durationMs": 800, "easing": "inOutSine", "action": "pan", "x": -24, "y": 0 }
    ] }]
  }
}
```

传给 `timeline.create` 后，在剧情 blocks 的可达位置插入 `{ "kind": "instruction", "name": "timeline", "args": ["arrival"], "modifiers": { "blocking": "" } }`。省略 blocking 就与台词并行；名字是 timeline，不是 timeline.play。不必把时间轴效果再用场景指令重复执行一次。

返修原演出：inspect `timeline:arrival`，从 childRefs 逐层取得轨道、cue 的引用和当前指纹；timeline.patch 的 replaceCue 要传完整 cue，而不是仅改过的字段。成功后重读再继续；旧指纹拒绝时不要猜数组序号。背景/表情写错，用场景对象的当前引用和指纹调用 scene.patch 的 replaceInstruction；场景内单行指纹与时间轴指纹不能混用。

验证不仅是 simulate passed：在 working-change 真正看到背景、人物、至少一次表情切换和预期演出后，再检查返修后的版本、保存重开和结局。runtime.run-from 只提供运行事件，不证明图像可见或演出好看。保留默认 UI，不改 src/main.ts 来绕过内容工具。

### 项目缺少素材时：先导入，再开剧情草稿

没有足够素材时明确说明缺什么，不把“只用一个背景”说成用户默认要求，也不凭空写出素材键。复用或制作素材由实际授权决定；本流程只导入已经准备好的文件，不下载、生成美术或制作音频。

1. 获授权的执行者启动 Agent Port 时追加 `--asset-source <素材目录绝对路径>`；可多次指定。stage 可以暂存，但发布素材需要明确的 apply 会话。已开剧情草稿时先完成/处理原草稿，不擅自丢弃它来导入。
2. `asset.sources({})` 取得 roots 的 sourceId，再用 `{ "sourceId": "返回的 ID", "path": "目录内相对素材路径" }` 取得 file.sha256。导入接收 PNG/JPEG/WebP、WAV/OGG/MP3、MP4/WebM、TTF/OTF/WOFF2，以及许可证/说明 TXT、MD 和无扩展名的 LICENSE/LICENCE/COPYING/NOTICE/OFL（可带连字符或下划线后缀）。摘要从公开读取复制，不自己猜，也不传任意本机路径。返回 `validation: "container-header-or-utf8-text"`：媒体只检查容器头，说明文件检查非空 UTF-8、无二进制控制字符且不超过 1 MiB；不证明目标浏览器解码、播放或字体加载成功，不转码或认证许可。
3. 调用 `asset.import.stage`，例如下方结构。operationId 和 itemId 使用本次新建的 UUID；对同一请求重试保持原编号与内容。

```json
{
  "operationId": "本次导入 UUID",
  "items": [{
    "itemId": "本张图片 UUID", "sourceId": "roots 返回的 ID",
    "sourcePath": "目录内相对图片路径", "sha256": "file.sha256",
    "kind": "portrait", "fileName": "rin_coat_smile.png"
  }]
}
```

4. 在 apply 会话用原 operationId 和返回的 plan.planFingerprint 调用 `asset.import.commit`；不覆盖同名文件。portrait 文件名遵守 role_outfit_expression 三段规则，背景 kind 用 background。不同表情各导入一张，不能将一张图改名冒充多个表情。
5. 重新读取 project.assets/project.inspect，确认发布后能找到新素材，再 change.begin。后续仍走普通草稿、验证与获授权写回。响应丢失先 asset.import.inspect 原 operationId，需要恢复时按回执使用 asset.import.recover，不换号重复发布。

声音分别使用 `music`（bgm）、`ambience`、`sound-effect`（se）、`voice`，视频使用 `video`，字体使用 `font`；`fileName` 只填保留原格式的单个文件名，不填目录。每文件最多 32 MiB、每批 32 项且总计 128 MiB，许可证/说明单文件另限 1 MiB。新媒体发布后可在 `project.assets.intelligence.items` 查看物理路径、用途和引用。声音键按四个声道独立解析，`@bgm`、`@ambience`、`@se`、`@voice` 使用各自的真实键，含空格时用引号包住；普通 Player 与 Editor 试玩均可使用环境音。导入回执不是运行验收；视频使用 `@video "真实素材键"`，会阻塞至结束或点击跳过；Player 与 Editor 都从项目素材解析，不要改入口文件手接 URL。坏视频会报告具体文件与原因，Editor 试玩会记为失败；不能以剧情仍能继续就称该视频通过。字体使用上文“项目展示配置”的公开读写；素材整理与替换使用下节的原 authority；不得仅凭媒体已列出或入包就承诺全部平台可播或已取得分发许可。

字体与随附的许可证/说明放在同一个 `asset.import.stage.items` 批次：字体项用 `kind: "font"`，原许可文件项用 `kind: "license"`，其余来源、摘要、操作身份和封存步骤相同；许可项写入 `content/assets/licenses/`，保留原字节（包括 BOM/换行），不改写或生成替代许可。文件名冲突应在封存前明确指定不冲突的名称，不能覆盖已有文件。来源未提供许可时不要编造，需由作品作者确认素材授权。

公开目录会识别 licenses 目录及现有 font/fonts 目录内的许可说明，不把它们算成未使用媒体，也不提供剧本插入指令。正常 Web 构建会收集这些原文并使用构建文件名；新模板与内置示例使用 `build.rollupOptions.output.assetFileNames: "assets/[name]-[hash][extname]"`，无扩展名文件不会生成末尾的点。已有自定义 Vite 配置也须保留这一命名规则，或使用原本具有 TXT/MD 扩展名的许可文件；不要删除许可来消除构建问题。最终交付应核对构建目录确有原文，导入成功不等于取得商业使用许可。

### 整理现有素材与原位替换

两种操作继续使用已有素材整理事务，不进入剧情 change，也不借普通导入覆盖旧文件。先保存／处理所有人类草稿，结束未确认的写入；权限或恢复状态不满足时读取原操作状态，不绕过保护。

**移动或改名**：调用 `asset.relocation.plan`，传新 UUID 的 `operationId` 与 `moves: [{ sourcePath, targetPath }]`。路径必须取当前素材目录，目标须在同类已有目录，扩展名不改变，不覆盖其他文件。支持现有背景、立绘、头像、四类声音、视频、字体及许可证。计划列出实际场景、选择项行内指令、时间轴、角色映射、字体／鉴赏／舞台配置引用；不明自定义引用或重名会阻止发布，不以全文替换猜测语义。许可文件只移动原字节，没有剧本播放指令。显式角色槽本身的语义改名仍先调整角色资料。

角色姿态目标可使用 `portrait:角色:服装`，整理时保留该前缀并改写自动实例的实际目标。自定义 `@instance`（选择项内写 `instance=...`）、显式来源的时间轴实例或片段 `targets` 重绑定若与改名前后的素材身份／角色组重叠，计划会拒绝猜测；先明确区分实例 ID 与素材键，再重新计划。无重叠的显式实例仍可整理；仅改变物理目录、不改变素材键的移动不受此语义改名限制。

**只替换文件内容**：保持现有路径、键及引用，先经 `asset.sources` 读取已授权目录中的新文件和 SHA-256，再调用：

```json
{
  "operationId": "本次新 UUID",
  "targetPath": "project.assets 返回的现有 sourcePath",
  "source": { "sourceId": "授权来源 ID", "path": "来源目录内新文件路径", "sha256": "刚读取的摘要" }
}
```

以上参数交给 `asset.relocation.replace`，不是 `asset.import.stage`。新旧文件须为相同且入口已支持的格式；本次不转码，不用 SVG 等未通过来源格式校验的文件冒充受支持替换。单文件最多 32 MiB，许可文本另受 1 MiB 的现有来源校验限制。计划 `replacement` 包含 `beforeSha256`、`afterSha256`、`bytes`、`sourceId`、`sourcePath`、`noChange` 和现有引用。原文件此时不变；摘要相同会明确 no-change，不换文件身份。替换图片不会自动认可旧校准，旧校准摘要不同须重新读取并确认。

两种计划均用 `asset.relocation.commit({operationId, planFingerprint})` 发布，需要 apply 权限。查询用 `asset.relocation.inspect`；计划未发布可 `cancel`；中断用 `recover({operationId, action:"resume"|"rollback"})`；成功后用原 `receiptId` 与 `receiptFingerprint` 调 `undo`。相同操作号不得绑定不同来源或计划。发布、恢复、撤销都会重验原件、准备文件、备份和路径身份；发现第三方新内容时保留它并报告阻断。终态历史仍可读取，不代表旧回执能覆盖后来合法修改。

Editor 在原素材详情使用“移动或重命名”“替换文件内容”，核对摘要／影响后显式确认。完成后重新读取项目，原键应显示新内容；替换使用原整理历史和撤销入口。没有另一个隐藏写入通道，也不自动修改许可证或通知其他人。

### 独立人物、环境图层与可复用演出

先 `project.inspect({view:"working"})` 读取 `stageConfig` 的 `value`、`effective` 与 `fingerprint`。未配置 `stage` 的旧项目仍保留旧显示默认值。需要新舞台时，在 OPEN direct 草稿用 `project.stage-config.patch({operationId, expectedFingerprint, patch})`；candidate／integration 禁止改变该配置，但可引用封存时的配置和素材。`patch:null` 明确关闭新配置；省略的顶层字段保留，命名表整体替换，不把深层部分对象误当成合并。

`stage` 版本为 1，可配置 `design:{width,height}`、`positions:{名称:{x,y}}`、`distances:{名称:倍率}`、`portraits` 和 `compositions`。坐标使用设计舞台像素，与浏览器显示缩放分离。位置／距离是预设，显式 x/y/scale 覆盖其对应值。校准按 `portraits["角色:服装"]` 设置基准 `height`、`anchorX/anchorY` 和 `expressions[表情]:{x,y,width,height}`；范围只用于归一化锚点和可见身高，**不裁掉图片、不扫描透明通道、不重写原图**。`sources[表情]:{path,sha256,width,height}` 固定作者实际确认的图片；同名同尺寸的新字节也会触发重新校准要求。

```text
@show rin:coat normal @pos=left @scale=1.1 @facing=left @opacity=.8 @z=2
@pose rin:coat 600 @x=780 @scale=1.25 @easing=inOutSine
@layer rail "项目背景键" @band=foreground @parallax=1.2
@pose layer:rail 400 @opacity=.5
@layer rail @off
@stage pier
```

例中的角色和图片键必须先在项目中存在，`pier` 也须先声明。`@pose` 不会移动全局镜头；只给 x 不夺取 scale、opacity 等其他属性。`show` 在同一实例换表情时保留已有姿态；用 `@instance=实例名` 可区分显示实例与角色资源。`@bg` 不会偷偷清除角色／前景。构图 `background` 省略表示保留，null 表示清除；`layers` 省略保留，空数组清除；`keepActors` 默认为 true，`resetCamera` 默认为 false。

舞台从后至前是背景、environment、人物、foreground，z 只在本区域排序，不能跨到 UI。layer 的 parallax 控制平移差异。新数值非有限、透明度越界、零／负缩放、非法命名距离或缺失资源都应先修正，不依赖运行时悄悄夹取。

精确返修用 `scene.patch` 的 `patchStageProperties`：先读取当前指令或选择项对象的 `objectRef`、`fingerprint` 与 `details.stageInstructions`，按名称、参数选中实际指令，再复制其 `instructionIndex`。同一选择项可能有多个舞台指令；不要把源码行号当成编译位置。编辑器中的舞台配置、校准和构图修改进入同一配置草稿，参与未保存保护、保存全部及配置撤销/重做；保存前不改变项目文件。

时间轴 **version 2** 增加 portrait 的 `pose`，layer 的 `show/hide/pose`，以及 `clips`。原 version 1 保留旧动作合同。例：先以原 `timeline.create` 建立 leaf，再建立含引用的 parent，不复制 leaf 的轨道：

```json
{
  "version": 2, "id": "parent", "durationMs": 2300, "tracks": [],
  "clips": [{ "timelineId": "leaf", "atMs": 100, "repeat": 2, "gapMs": 100,
    "targets": { "rin:coat": "left-instance" } }]
}
```

leaf 在本例中最长 1000 ms。repeat 为 1..100；引用深度最多 16、每定义最多 256 个 clip、展开预算 10000，总时长最多 600000 ms。缺失、成环、越界、无法区分类型或碰撞的目标映射会拒绝。`targets` 改的是舞台实例，原立绘资源由 cue 的 source 保留；不能把映射后的实例当成素材键。版本升级和片段修改仍走 `timeline.patch` 的 `setVersion`／`setClips`，需要刚读取的完整时间轴指纹。引用定义和传递子定义都纳入操作时点的依赖与重放指纹，不能只凭根 JSON 未变沿用旧候选。

独立变换的竞争以属性为单位，后开始者接管同一对象的同一属性；不同属性可并行。完整一次性最终投影、演出时钟及中段展示快照由现有 Controller／TimelinePlayer／World 管理。读档前先验证展示载荷、来源与校准，不从头重播已经触发的瞬时音效。不把单纯事件轨迹当作真实像素或听感证明。

### 在 Editor 调整当前画面

在原剧情预览展开“舞台对象与演出调整”，点击“暂停并读取舞台”。对象列表包含透明、重叠、画面外对象；先选择对象和要改的**属性来源**，再输入数值或拖动。未属于当前来源的属性不会被顺手回写。临时画面不改变源文件、不作为正式观察。

Esc 或“取消调整”恢复暂存前画面；数值框 Enter 或“应用到选定来源”才写入对应来源。场景指令／选择项行内动作经原 scene.patch 路径，时间轴经原 timeline.patch，产生一个原有历史点；仍须正常保存草稿。项目切换、源版本改变、待确认保存、只读结果都拒绝迟到回写并保留试改值。应用后使用已记录的 seed、选择和播放位置重新执行，而非从另一条随机路线冒充原画面。引用片段修改须明确确认修改的是定义，会影响它的全部调用。

“舞台配置与图片校准”单独读取实际图片、人工填写／拖选可见范围、确认后加入草稿，再显式保存配置。配置经原写入事务保存，提供本面板的明确撤销；不与普通角色移动草稿混为同一写入。参考图／测试截图不是 Owner 美术验收；正式作品仍需使用自己的已授权资源检查。

### 在 Editor 调试真实剧情

在「预览」勾选「启用调试（从入口重播）」，真实解释器会在入口指令执行前暂停。选择断点场景与实际步骤，点击「添加断点」；「单步」只执行一条 Core 指令，「继续运行」恢复原剧情。变量与跨场景调用的返回位置只读，不提供调试改值。等待、视频和阻塞演出仍按原完成回调，选项须真实选择，单步不会代选或跳过等待；系统菜单、存读档、设置或文字记录打开时先返回正文再操作。

断点绑定当前剧本版本；修改后旧断点标为失配，须重新选择并确认，不按新行号自动挪用。「打开当前源码」只定位同版本的普通编辑内容，并离开本次预览；返回后重新播放或沿原路径续接，不宣称保留离开的运行实例。关闭调试恢复普通播放。本功能目前在 Editor 剧情预览提供，不是新增 Agent Port 调试控制，也不将未执行的暂停位置冒充已执行轨迹。

### 可选的跨周目收藏

仍使用 `content/config/gallery.json` 与 `@unlock_cg` / `@unlock_music`。未提供 `unlockPolicy` 时解锁只随剧情存档，不会偷偷改为永久收藏。需要永久保留时：

1. 在普通 direct 草稿中读 `project.gallery({view:"working"})`，取得 `unlockPolicy.value`（缺省为 null）、`effective` 与 `fingerprint`。
2. 调用 `gallery.policy.patch`，例如 `{operationId:"collection-policy",expectedFingerprint:"读取的指纹",patch:{cgs:"profile",music:"profile",texts:"profile",endings:"profile",profiles:"profile",terms:"profile"}}`。六类可以单独设为 `save` / `profile`；某字段设 null 恢复缺省，省略不改。candidate/integration 修改前拒绝，旧指纹拒绝；正常差异、试玩及获授权写回流程不变。
3. Editor「配置 → 鉴赏」的中文保留方式与同一合同对应，可「试玩收藏草稿」，也可保存后重新打开检查。试玩收藏只存在内存，不写正式玩家记录。默认鉴赏与自定义 `gallery-cgs/gallery-music/gallery-texts/gallery-endings/gallery-profiles/gallery-terms` 读取同一有效解锁结果。

永久记录按作品 package name 隔离，只有正常游玩中已登记条目的解锁指令会增加记录。读旧档不撤销永久收藏，也不将旧档批量导入；新游戏清空本局解锁、保留永久部分。关闭开关或移除条目不会删除历史收藏 ID；恢复相同 ID 可以再次显示，所以不要把旧 ID 改用于无关内容。浏览器数据仍受该设备、浏览器来源和存储权限限制，不是云同步。损坏/失败会提示并保留原记录，不冒充永久保存成功。回想中的解锁不写入永久记录。

### 安全剧情回想

在普通 direct 草稿使用 `gallery.text.create({operationId:"replay-create",id:"meeting",name:"雨后重逢",scene:"reunion",label:"entry",variables:{好感:10}})` 建立条目；scene/label 必须存在。省略 label 从场景开头进入，省略 variables 使用项目初值。初始变量不继承玩家当前状态，必须已声明、类型与范围正确；它是作者设置的初始条件，因此允许赋予 readonly 声明初值。

修改前读 `project.gallery({view:"working"})`，复制对应 `texts[]` 的 fingerprint，再用 `gallery.text.patch({operationId:"replay-edit",id:"meeting",expectedFingerprint:"读取值",patch:{name:"新的标题",variables:{好感:20}}})`。patch 只接受 name/scene/label/variables；variables 整体替换，label/variables 设 null 移除，未知字段与其他条目保留。两个写入口都在 candidate/integration 落盘前拒绝。候选场景可以引用已登记回想；回想配置是候选封存的读取依赖，变更后须重新核对，不能直接放开候选写入口。

在正常剧情中用 `@unlock_text meeting` 解锁，缺少解锁点会被项目校验拒绝。需要跨周目保留时显式设置 `unlockPolicy.texts:"profile"`。Editor「配置 → 鉴赏」可填写“初始变量（JSON）”、修改回想保留方式并试玩当前草稿。保存检查已保存的目标场景，试玩检查当前场景草稿；无效输入不覆盖原配置。

共享 Player（Starter 和新项目）从标题或普通正文/选项暂停点进入回想，提供“结束回想”；自然结束或脚本错误也返回原鉴赏上下文。回想不写正常手动/快速/自动档、不读正常存档、不增加永久收藏与正式通关次数；回想耗时不计入原进度。返回按正式读档语义恢复当前句/选项、变量、已读、解锁、系统和舞台，并恢复原文字记录；不承诺逐字打字位置或保留原回退栈。演出等待、视频、系统事务期间不能进入。若恢复失败，保留检查点并显示重试，不允许继续覆盖正式存档。独立自定义宿主的旧 hostJump 回调不自动获得上述保证，需采用共享 Player 或自行接入同等隔离与恢复合同。

### 结局册

在 direct 草稿调用 `gallery.ending.create({operationId:"ending-create",id:"home",name:"雨后归途",description:"在最后一班电车到站前重逢。"})` 登记结局；名称、说明由 `gallery.json.endings` 保存。正常剧情中的 `@clear home` 达成同名结局；未填写参数的既有 `@clear` 仍使用场景标识。旧作品不必为所有通关记录补写结局条目，列表与进度只统计已登记的条目。

修改时先读 `project.gallery({view:"working"})`，使用 `endings[]` 中的 fingerprint 调用 `gallery.ending.patch({operationId:"ending-edit",id:"home",expectedFingerprint:"读取值",patch:{name:"新的结局名称",description:null}})`。只允许 name/description，description 设 null 移除；不改 ID、不改玩家达成记录，未知字段保留。两种新写入口都在 candidate/integration 修改前拒绝。候选场景/时间轴封存结局配置读取依赖；配置变化后不能沿旧基线重放。

本局达成事实沿用存档内的 `clears.endings`，未设置 `unlockPolicy.endings` 时随存档恢复，新游戏清空本局记录。只有显式设置 `endings:"profile"`，正常游玩才会增加当前作品永久收藏；不从旧存档或旧全局通关记录批量导入。回想与 Editor 试玩不写正式收藏，原有通关次数及新周目继承系统不变。

Editor「配置 → 鉴赏 → 结局册」可以编写、保存并试玩当前草稿。默认鉴赏的“结局”页显示已收集数量；自定义鉴赏页使用 `source:"gallery-endings"` 读取同一只读列表，使用 `{kind:"data",field:"ending-progress"}` 显示进度。名称/说明在解锁前被遮蔽；结局条目只供阅读，不会点击后跳入剧情。

### 人物档案与用语辞典

沿用 `content/config/gallery.json`，人物片段在 `profiles` 中引用 `game.config.json.characters` 的角色标识，词条在 `terms` 中引用 `terminology.json` 的规范词。姓名、规范词不另复制；同一角色可以有多个独立解锁的资料片段。

在 direct 草稿中先建立角色，再调用 `gallery.profile.create({operationId:"profile-first",id:"rin.first",character:"rin",title:"初见",description:"在末班电车的站台遇见了她。"})`。调用 `gallery.term.create({operationId:"term-harbor",id:"harbor",canonical:"雾港",description:"北方海岸的小城。"})` 创建词条；缺少规范词时会在同一事务内追加 `{canonical:"雾港",variants:[]}`，保留原名词表的其他内容。不删除原规范词、不全文替换剧情。

先读 `project.gallery({view:"working"})`，从 `profiles[]` / `terms[]` 复制条目 fingerprint。再调用 `gallery.profile.patch({operationId:"profile-edit",id:"rin.first",expectedFingerprint:"读取值",patch:{title:"新的标题",description:null}})`，或 `gallery.term.patch({operationId:"term-edit",id:"harbor",expectedFingerprint:"读取值",patch:{description:"更新的解释"}})`。人物只改 character/title/description，用语只改 canonical/description；title/description 设 null 移除，省略不改。缺少角色、旧指纹、重复 ID 或类型不符会拒绝并保留原稿；四种写入口均在 candidate/integration 修改前拒绝，不提供删除或 ID 改名。

正常剧情使用 `@unlock_profile rin.first` / `@unlock_term harbor` 解锁（标识包含空格时可加双引号）。所有资料须有实际解锁点，指令不得引用缺失条目；候选先准备已保存的资料，场景/时间轴读取并封存 `config:galleryDossiers`，资料变化后重新核对基线。仍被人物资料引用的角色不能删除。

默认鉴赏的“人物”“词典”页与自定义 `gallery-profiles` / `gallery-terms` 使用同一只读列表、译稿和解锁遮蔽；解锁前不显示真实名称、标题或解释。`profile-progress` / `term-progress` 显示已收集数量。不点击后跳入剧情。已有 `source:"terms"` 在未声明 gallery.terms 时仍显示原规范词列表；声明后改用同一受解锁控制的用语辞典，不泄露隐藏名称。

缺省资料进度随存档，旧档缺字段按空，新游戏清空本局。只有显式设置 `unlockPolicy.profiles/terms:"profile"` 才增加本作品永久记录；读旧档不撤销永久部分，回想与 Editor 试玩不写正式收藏。Editor「配置 → 鉴赏」可以编辑两类条目、保存重开及“试玩收藏草稿”；先在角色表/名词表保存被引用对象。名词表删除仍被辞典使用的规范词会拒绝。未保存标题、解释和策略可在独立试玩中生效，关闭试玩保留草稿，不覆盖来源。资料标题/解释沿原文本目录登记、CSV 预览/导入播放；修改后过期译稿回退原文。

## 2. DSL 速查

注释必须独占一行，以 `//` 开头；行尾的 `#` 或 `//` 不具有注释语义。选项箭头两侧留空格。

```gal
// 场景文件 content/scenario/ch01_01.gal（场景 ID = 文件名去扩展名）
@scene ch01_01
@bg castle
@bgm tense_01
// 播放多轨开场，完成前暂停剧情
@timeline intro_arrival @ blocking

@label start
凛：你来了。
主角：这是哪？
（旁白）

@set lynn.trust = 0
@mod lynn.trust +3
@flag hasSword
@if lynn.trust >= 30
凛：好感到了。
@else
凛：还不够。
@endif

// 选择组的选项行必须缩进
@choice
  拔剑 -> @goto sword
  表白 [if:lynn.trust >= 50] -> @mod lynn.trust +5 @jump ch02.start
  沉默
@label sword
凛：你拔剑了。
@end

// 以下为独立指令示例：实际创作时放在可达位置
@jump ch02.start
@unlock_cg cg_end
@autosave
@clear ending_a
```

### 时间轴 JSON 速查

文件路径：`content/timelines/<id>.json`。`id` 必须与文件名和 `@timeline` 参数一致。

以下只展示格式，castle_night、lynn:uniform 和 normal 不是所有项目都有的素材。实际创作优先复制上方 project.assets 的 usage.timeline，再调整节奏，不原样猜用这些名称。

```json
{
  "version": 1,
  "id": "intro_arrival",
  "durationMs": 1800,
  "tracks": [
    {
      "kind": "background",
      "cues": [
        { "atMs": 0, "durationMs": 900, "easing": "outCubic", "action": "set", "key": "castle_night" }
      ]
    },
    {
      "kind": "portrait",
      "target": "lynn:uniform",
      "cues": [
        { "atMs": 300, "durationMs": 700, "easing": "outCubic", "action": "show", "expression": "normal", "position": "left" }
      ]
    }
  ]
}
```

版本 1 轨道类型：`background`、`portrait`、`camera`、`screen`、`particle`、`audio`；版本 2 另含 `layer`，详见上文独立舞台与引用片段。cue 使用 `atMs`、`durationMs`、`action`，动作字段按轨道类型填写；缓动支持 `linear`、`inOutSine`、`outCubic`、`inOutCubic`。先用 `@timeline intro_arrival` 做非阻塞演出；需要演出完成后才继续台词时使用 `@ blocking`。保存、读档和快进会处理时间轴游标与最终状态，禁止在脚本中手动重复补一遍同样的演出。

镜头轨道支持 `zoom`（`scale` 0.25..4）、`pan`（`x`/`y` 为像素偏移）和 `shake`（`strength` 0..64）；屏幕轨道支持 `fade`、`tint`、`flash`、`wipe`。`tint` 的颜色和透明度会随 cue 缓动同步变化。编辑器中 cue 中段控制开始时间，右端控制时长，曲线用于确认缓动形状。

表达式变量插值：`我是{heroName}。` 运行时替换为变量值。

## 3. game.config.json（变量声明表）

**所有变量必须先声明才能使用**（lint 强制，类型安全由引擎保证）：

```json
{
  "title": "我的游戏",
  "version": "0.1.0",
  "variables": {
    "heroName": { "type": "string", "initial": "雷恩" },
    "lynn.trust": { "type": "number", "initial": 0, "min": 0, "max": 100 },
    "hasSword": { "type": "flag", "initial": false },
    "items": { "type": "string[]", "initial": [] },
    "chapter": { "type": "number", "initial": 1, "readonly": true }
  },
  "customInstructions": ["mypower"]
}
```

类型：`string` / `number` / `boolean` / `flag` / `string[]` / `number[]` / `object`。number 越界自动 clamp；`readonly: true` 禁止写入。

## 4. AI 易错清单（务必遵守）

1. **引号契约**：`@if name == "雷恩"` 里字符串必须带引号（表达式字面量）；而 `@bg "my bg.png"` 这类**通用指令值**的引号仅用于保护空格/`@`，渲染层会自动去引号——通用值不要依赖引号语义。
2. **变量先声明**：剧本里每个变量（含 `lynn.trust` 这种点号命名）都必须在 `game.config.json` 的 `variables` 声明，否则 lint 报 V001/V002。
3. **choice 选项行必须缩进**（空格/Tab），否则 S004。选项条件用 `[if:表达式]`，内联动作用 `-> @set/@mod/@goto/@jump`，不允许内联 `@if/@choice`（S007）。
4. **`@goto` 目标必须是本场景标签；`@jump` 目标是已实现的场景**（`sceneId` 或 `sceneId.label`），否则 C002/J001/J002。
5. `@label name` 整行只能有标签名（L003）；`@if/@else/@endif` 必须配对（S003）。
6. 每个 `.gal` 文件的**场景 ID 全局唯一**（= 文件名），`@scene` 声明须与文件名一致（SCENE_ID）；**文件名不能含点号**（会破坏 `@jump` 的 sceneId.label 寻址）。
7. **每次改完剧本必须跑 lint 到 0 错误再交付**。错误信息带 `文件:行:列` + 错误码 + 可操作的修复建议（hint），按第 1 节在实际工作版本中返修。
8. **类型自洽**：`@set` 右值类型须与变量声明匹配（`@set x = "a"` 但 x 声明为 number 会报 T001）；`@if`/`[if:]` 条件必须结果为 boolean；数字/字符串别混用比较与逻辑运算符（T002/T003）。字符串字面量必须带引号。
9. **表达式字符串**：支持 `\n`、`\t`、`\\`、`\"`、`\'`；未知转义保留原反斜杠。路径中的反斜杠建议明确写成 `\\`，防止 `\n`/`\t` 被解释为换行/制表符。也可用另一种引号包裹，如 `'say "hi"'`。通用指令的素材标识以公开目录返回值为准，不套用表达式字符串转义规则。

## 5. 检查范围与交付

Agent Port 变更使用第 1 节的工作版本验证；磁盘上的 lint/simulate 只检查已经写入来源项目的内容，不能证明隔离草稿通过。只对实际修改范围和关键路线做足够检查，不把有限预算模拟称作无限全路径证明。

手工文件作者或已授权写回后，可复用现有命令：

```powershell
node packages/cli/dist/index.js lint <项目目录> --json
node packages/cli/dist/index.js simulate <项目目录>
node packages/cli/dist/index.js build <项目目录>
```

交付说明包含改动内容、关键选择/结局、实际验证与尚未覆盖部分即可，不为每个接口另建报告。真实播放器需要检查剧情推进、可见演出、必要存读档及重开；技术检查不代替剧本、美术、声音或玩家手感判断。

高级玩法只在需求明确时考虑，见 [架构说明](architecture.md)；纯 ADV 不需要额外系统或自定义宿主。
