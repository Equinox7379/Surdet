# Surdet 游戏制作指南（给 AI 助手）

本文档是让一个 AI 助手以 **Surdet 引擎**为基础制作 GalGame 的完整操作手册。把本文件路径连同你的游戏需求一起交给 AI 即可。

## 0. 引擎位置与必读文件

引擎根目录：`C:\Users\Equinox\Documents\Default Project\surdet`

按顺序阅读以下文件再动手：

1. `README.md` — 引擎能力总览、开发/构建命令
2. `docs/dsl-spec.md` — **DSL 剧本语言规范**（行类型、指令集、表达式、错误码表）★权威依据
3. `docs/architecture.md` — 引擎分层与数据流（了解内容如何被引擎消费）
4. `examples/starter/` — 可运行的完整示例（剧本/配置/入口），先看它的 `content/scenario/*.gal` 和 `game.config.json`
5. `packages/cli/templates/game/` — `surdet new` 生成的脚手架模板

## 1. 标准工作流

```bash
cd "C:\Users\Equinox\Documents\Default Project\surdet"

# 0) 引擎已构建。若首次/改动过源码，先全量构建：
npm install
npm run build

# 1) 创建游戏脚手架（games/<name>，自动注册 workspace）
node packages/cli/dist/index.js new <游戏名>        # 或 npm run build -w @surdet/cli 后用 surdet new

# 2) 编写内容：编辑 content/scenario/*.gal（剧本）+ game.config.json（变量表）

# 3) 静态校验（必须 0 错误，错误带 文件:行:列 + 错误码）
node packages/cli/dist/index.js lint <游戏目录>

# 4) 预览（浏览器 http://localhost:5173）
npm run dev -w surdet-<游戏名>

# 5) 构建
node packages/cli/dist/index.js build <游戏目录>

# 6) 打包 exe（缺省 starter；指定游戏：surdet pack games/<name>）
node packages/cli/dist/index.js pack <游戏目录>
```

## 2. DSL 速查

```
# 场景文件 content/scenario/ch01_01.gal（场景 ID = 文件名去扩展名）

@scene ch01_01          # 声明场景（须与文件名一致）
@bg castle              # 背景
@bgm tense_01           # 音乐

@label start            # 标签（跳转锚点）
凛：你来了。            # 说话人：内容（中/英文冒号）
主角：这是哪？
（旁白）                # 无说话人文本

@set lynn.trust = 0     # 赋值（= / := / += / -=）
@mod lynn.trust +3      # 数值增减
@flag hasSword          # 置 flag 为 true
@if lynn.trust >= 30    # 条件分支（表达式：算术/比较/&&/||/!/括号）
凛：好感到了。
@else
凛：还不够。
@endif

@choice                 # 选择肢（选项行必须缩进）
  拔剑 -> @goto sword   # 选中后跳本场景标签
  表白 [if:lynn.trust >= 50] -> @mod lynn.trust +5 @jump ch02.start
  沉默
@label sword
凛：你拔剑了。
@end                    # 场景结束（可省略，引擎自动补）

@jump ch02.start        # 跨场景跳转：sceneId 或 sceneId.label
@unlock_cg cg_end       # 解锁 CG（回想鉴赏）
@autosave               # 存档点：触发 autosave 事件，宿主写入自动存档槽位
```

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
  "customInstructions": ["mypower"]   // 可选：声明自定义指令消 W001 告警
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
7. **每次改完剧本必须跑 lint 到 0 错误再交付**。错误信息带 `文件:行:列` + 错误码，按 `docs/dsl-spec.md` 的错误码表定位修复。
8. **类型自洽**：`@set` 右值类型须与变量声明匹配（`@set x = "a"` 但 x 声明为 number 会报 T001）；`@if`/`[if:]` 条件必须结果为 boolean；数字/字符串别混用比较与逻辑运算符（T002/T003）。字符串字面量必须带引号。
9. **字符串内引号**：表达式字符串字面量只支持 `\n` `\t` `\\` 转义，**不支持 `\"`**——`"say "hi""` 会在词法层提前闭合引号导致解析错误。字符串内容里需要引号时，改用另一种引号包裹（如 `'say "hi"'`）或调整措辞。

## 5. 验收标准

- `surdet lint <游戏目录>` 输出 0 错误（警告可接受但尽量消除）
- `npm run dev -w surdet-<游戏名>` 能打开，剧情从头到尾可推进（含选择肢、分支、存档 F5/F9、快进 S、自动 A）
- 交付物：修改后的 `games/<name>/` 目录 + 一份剧情路线/变量清单说明

## 6. 全家桶系统（可选，数据驱动）

需要地图日程/回合战斗/后宫/周目继承时，用对应的 System 类（`CalendarRunner` / `CombatSolver` / `AffectionSystem` / `NewGamePlus`），剧本里用 `@calendar` / `@battle` / `@affection` / `@event` 指令触发（发 `system` 事件由宿主驱动），配置与用法见 `packages/core/src/calendar|combat|systems/` 的类型定义与 `docs/architecture.md`。若只做纯 ADV，可完全跳过。
