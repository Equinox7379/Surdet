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
- 当前省略模式的 stage change 使用候选组合限制，不支持依赖环；普通隔离模式解耦尚未交付。不要删检查、改源文件或自行提权绕过限制。
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

1. **读取事实。** 用 `project.inspect`、`project.assets`、`project.gallery` 获取入口、变量、角色与素材。四个读取入口（含 object.inspect）始终显式传 `view: "project"` 或 `view: "working"`；working 必须有 active change。旧省略参数调用保留原范围：inspect/assets 读来源、object/gallery 优先工作版本，不应混用。用场景的 `childRefs` 或正文片段返回的 objectRefs 取得子对象，再 object.inspect 获取当前指纹。
2. **建立隔离变更。** 无 active change 时调用 `change.begin`，写明 intent、acceptanceCriteria 和 `initiator: "external-agent"`。续接已有草稿时保留其身份，不为每个修正新建 change。
3. **先满足依赖，再修改内容。** 变量用 `variable.ensure` 声明，角色/时间轴等沿各自能力处理；素材 key 来自公开目录。调用 scene.create/scene.patch，操作编号标识一次确定操作，收到未知结果时先核对原编号，不换编号盲重试。
4. **验证工作版本。** 调用 `project.validate`、`project.simulate`；用 `runtime.run-from` 指定起点、选择与变量走关键路径。label 仅指真实场景标签，从场景开头运行就省略。已有 trace 可用 `runtime.read-trace` 查询，画面观测用 `runtime.read-preview`。
5. **修正后继续。** 读取错误 code/details/repairActions，修正输入或重新取得事实。修改后重读对象；旧匿名引用和指纹不是稳定地址。不能将运行失败、预算不足或未覆盖路线称为成功。
6. **查看与交付。** 用 `change.diff` 查看差异，在编辑器明确选中该 working-change 试玩，再继续原 change 返修。stage 交付草稿/胶囊不会自动写回项目；经授权的 apply 才能提交，integration 仍需原人类批准。胶囊固定的是封存事实，更新后的工作画面不能冒充封存版本。

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

### 读取正文与续页

调用 `object.inspect`：`{ "objectRef": "scene:first_chapter", "view": "working", "fragment": { "limit": 100 } }`。片段包含原始文本、行尾、行号、实际对象引用及版本；每页最多 200 行。若有 nextLine，续页必须传 `fromLine: nextLine`、`expectedRevision: fragment.revision`，working 还要传 `expectedWorkingRevision: fragment.workingRevision`。版本变化会拒绝续页，应从首页重读，不能拼接两次版本。

scene.create/scene.patch 的 `continuation` 是当前工作版本的父场景入口。操作原结果中的 path/line 属于原回执，尤其旧 operationId 重试时不保证仍是当前行号；用 continuation.sceneRef 重读再修改。删除对象不会得到伪造的替代引用。

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
```

### 时间轴 JSON 速查

文件路径：`content/timelines/<id>.json`。`id` 必须与文件名和 `@timeline` 参数一致。

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
