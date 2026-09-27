# Surdet 内容创作指南（给外部 AI 助手）

本指南面向编写剧情、配置与演出的内容作者。默认使用正式 Agent Port 工具，在隔离草稿中修改、验证和试玩；不需要先读引擎源码、长期台账或重新接线播放器。已有项目保持原位，新项目使用现有模板。

本批公开创作合同为 **2.16.0**，新增素材整理／原位替换及有限舞台配置能力。客户端、Core、Authoring、Renderer、CLI 与 Editor 应使用同批构建，不能只复制新界面接旧 authority。

## 0. 准备项目与会话

环境已可用时不要重装依赖或全量重建。由获授权的执行者创建新项目、启动会话；已绑定会话直接进入能力发现。

```powershell
node packages/cli/dist/index.js new <游戏名>
node packages/cli/dist/agent-port/main.js --project <项目目录> --policy stage
npm run dev:project -w surdet-editor -- --project <项目目录绝对路径>
```

最后一项在需要编辑器/真实试玩时使用，不替代 Agent Port。完整启动与绑定说明见 [README](../README.md#外部-agent-创作)。缺失构建时沿 README 的依赖顺序准备，不让内容作者自行改造工具链。

新项目可追加 `--directory <项目目录>` 指定独立位置，`--template blank` 选空白模板，默认 `example` 带短篇示例。两者都用 `@surdet/player`，无需把项目放进源码仓库或复制播放器。独立环境须先由执行者准备项目 README 所列的同批 Surdet 包与开发依赖；不要假定公共 npm 已发布这些包。安装后可用 `surdet` 与 `surdet-agent-port`，无需源码相对路径；Editor 现阶段仍按上面的已有启动入口，独立作者安装版另属后续阶段。

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
- `runtime.run-from` 已产生事件但失败时，使用错误 `details.traceId`，并按 `runtime.read-trace` 的
  `repairActions.inputTemplate` 读取失败前轨迹。结果含 `status`（`passed`、`failed` 或 `unknown`）及 `traceWorkingRevision`；老记录可能缺少后者。
  freshness 描述相对当前版本；失败轨迹绝不能当作 `passed` 证据。若运行在产生轨迹前失败且没有轨迹，不要伪造 `traceId`。
- `INVALID_REQUEST` 属于 after-repair：修正输入后再继续，不原样重试。MCP SDK 可能在工具执行前按 schema 拒绝请求，仅返回协议错误文本；按字段路径和 schema 修正，不假装有业务回执。
  执行结果未知时查询原操作编号，不换编号重复写。

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

`project.inspect` 的 `playerConfig` 返回有限字段的 `values` 与修改所需 `fingerprint`。`title`、旧式 `font`、字体角色表 `fonts` 存在 game.config.json 根部，`subtitle`、`titleBackground`、`endScenes`、`firstRunHint` 存在其 `player` 对象中；无需打开或修改 src/main.ts。

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

Editor 的合法场景改名会同步已知引用及 `player.endScenes` 等结束配置：改名先更新工作稿，点击“保存全部”后一起写入。删除仍被引用的场景会被拒绝并指出来源，应先调整引用；异常配置也不会绕过检查。

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
