# Surdet 内容创作指南（给外部 AI 助手）

本指南面向编写剧情、配置与演出的内容作者。默认使用正式 Agent Port 工具，在隔离草稿中修改、验证和试玩；不需要先读引擎源码、长期台账或重新接线播放器。已有项目保持原位，新项目使用现有模板。

## 0. 准备项目与会话

环境已可用时不要重装依赖或全量重建。由获授权的执行者创建新项目、启动会话；已绑定会话直接进入能力发现。

```powershell
node packages/cli/dist/index.js new <游戏名>
node packages/cli/dist/agent-port/main.js --project <项目目录> --policy stage
npm run dev:project -w surdet-editor -- --project <项目目录绝对路径>
```

最后一项在需要编辑器/真实试玩时使用，不替代 Agent Port。完整启动与绑定说明见 [README](../README.md#外部-agent-创作)。缺失构建时沿 README 的依赖顺序准备，不让内容作者自行改造工具链。

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

### 删除不再使用的场景

先读取 `object.inspect({ "objectRef": "scene:unused", "view": "working" })` 的完整场景 `fingerprint`，再调用 `scene.remove`（MCP：`surdet_scene_remove`）：

```json
{ "operationId": "remove-unused-scene", "sceneId": "unused", "expectedFingerprint": "复制刚读到的场景 fingerprint" }
```

仅支持 OPEN 的普通 direct 草稿，stage 不会因此获得来源写权限；candidate/integration 会在修改前拒绝。它删除按场景 ID 唯一定位的整个文件（含子目录、`.GAL`），不是 removeObject 删除一行，也不会伪造已删除对象的续接引用。

入口、player.endScenes、其他场景的 jump/call/选择项、文本回想以及事件/成长/日历配置仍有引用时，错误的 `details.references` 会列出来源，不能强制或级联删除。先明确调整调用者及配置，再重读并删除；清理模板时通常先修改 entryScene 和 player.endScenes。没有公开修改入口的配置由人类按正常编辑流程处理，不在已有草稿外偷偷改来源。失败不修改草稿；相同 operationId 和相同请求可以安全重试。

删除随后进入正常 change.diff、validate、simulate、真实试玩、封存和获授权的 apply 提交。差异中的文件标记 `changeType: "deleted"`、不提供 afterSha256，并计入 `summary.removedScenes`；不能把删除当成覆盖为空文件。提交中断仍走已有 change.recovery.inspect/execute；遇到外部重建或改写的未知文件，保留内容并停止自动恢复。事件和日历配置现已纳入快照版本检查，旧草稿若因此报告来源变化，应保留旧记录并重新读取项目，不强行改基线。

### 项目展示配置

`project.inspect` 的 `playerConfig` 返回有限字段的 `values` 与修改所需 `fingerprint`。`title` 存在 game.config.json 根部，`subtitle`、`titleBackground`、`endScenes`、`firstRunHint` 存在其 `player` 对象中；无需打开或修改 src/main.ts。

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

Editor 会阻止改名或删除仍被 `player.endScenes` 引用的场景，并指出配置来源。先通过上述配置入口调整结束场景引用，再进行场景操作；本轮不自动改写结束数组。

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

- 背景：复制所选 backgrounds 条目的 usage.scene；它是 `bg` 指令。
- 立绘登场或换表情：在 portraits 中选同一 timelineTarget 的不同 expression，分别使用其 usage.scene（`show`）。再次 show 同一角色/服装会更新表情；默认居中，可将 modifiers.pos 改为 left/right/center。不是每说一句话都重新 show。
- 头像不是立绘：avatars 用于角色的对话头像，不能拿来作为 show 的目标。角色表中的 id/name 管台词身份与显示名，立绘的 role/outfit/expression 管图像；需要说话焦点对应时，让角色 id 与素材 role 对应。新增/改名先读取 `project.inspect({ "view": "working" })` 的 charactersFingerprint 并传给 character.ensure.expectedFingerprint；角色表为空也能读取，不为换表情改角色名。
- usage 是最小用法，不是预设审美或动画：时间轴 cue 默认 atMs=0、durationMs=0、easing=linear。需要渐入就主动设时长；整条时间轴 durationMs 必须覆盖所有 cue 的 atMs+durationMs。没有 usage 的条目先查 intelligence.issues；不能只凭 resolved=true 忽略同名冲突、非法名称或不支持格式。已有音频沿原路径保留，本轮不新增音频生产。

一个简单顺序是：**背景 → 正常表情登场 → 一句台词 → 微笑表情 → 一句台词 → 隐藏角色**。使用读取返回的两个 usage.scene 对象，并将台词写为 `{ "kind": "text", "speaker": "实际角色 ID 或显示名", "value": "正文" }`。隐藏用 `{ "kind": "instruction", "name": "hide", "args": ["实际 role"] }`，不是 timelineTarget。普通表情切换直接用场景指令即可，不必为了两句台词建立时间轴。

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

### 项目缺少图片时：先导入，再开剧情草稿

没有足够素材时明确说明缺什么，不把“只用一个背景”说成用户默认要求，也不凭空写出素材键。复用已有图片或新增美术由实际授权决定；本流程不下载、生成图片或新增音频。

1. 获授权的执行者启动 Agent Port 时追加 `--asset-source <图片目录绝对路径>`；可多次指定。stage 可以暂存，但发布图片需要明确的 apply 会话。已开剧情草稿时先完成/处理原草稿，不擅自丢弃它来导入。
2. `asset.sources({})` 取得 roots 的 sourceId，再用 `{ "sourceId": "返回的 ID", "path": "目录内相对图片路径" }` 取得 file.sha256。当前导入支持 PNG/JPEG/WebP；摘要从公开读取复制，不自己猜，也不传任意本机路径。
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

轨道类型：`background`、`portrait`、`camera`、`screen`、`particle`、`audio`。cue 使用 `atMs`、`durationMs`、`action`，动作字段按轨道类型填写；缓动支持 `linear`、`inOutSine`、`outCubic`、`inOutCubic`。先用 `@timeline intro_arrival` 做非阻塞演出；需要演出完成后才继续台词时使用 `@ blocking`。保存、读档和快进会处理时间轴游标与最终状态，禁止在脚本中手动重复补一遍同样的演出。

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
