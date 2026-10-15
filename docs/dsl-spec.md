# Surdet DSL 规范 v0.1

剧本语言（`.gal` 文件）规范。本文件是 AI 生成游戏的权威依据。

## 目录约定

```
<project>/
  game.config.json          游戏配置（变量声明表等）
  content/scenario/**/*.gal 剧本（场景 ID = 文件名去扩展名，如 ch01_01.gal → ch01_01）
  content/config/           角色/战斗/日程等配置（M5 起）
  assets/{images,audio,video,fonts}/
```

## 行类型

| 形态 | 含义 |
|---|---|
| `凛：你来了。` | 文本行：`说话人：内容`。支持中/英文冒号；前缀不含空白、非纯数字 |
| `旁白内容` | 无说话人的旁白 |
| `@label name` | 标签（跳转锚点），全行必须恰为 `@label name` |
| `@instr 参数... @mod 值...` | 指令行 |
| `// 注释` | 注释（丢弃） |
| 空行 | 忽略 |

指令行内 `@` 是修饰符分隔符；参数与修饰符值可用 `"…"` 或 `'…'` 包裹，内部空格与 `@` 不会被拆分。

**引号转义**：引号内支持反斜杠转义——`\"` 可在 `"…"` 值内包含字面双引号（`\'`、`\\` 同理）。
表达式语境由表达式解析器还原转义；通用指令值由渲染层去引号时还原（如 `@bg "a\"b"` → key `a"b`）。

**引号契约**：词法器只做引号感知切分，**保留引号字符**。消费方约定：
- 表达式语境（`@if`/`@set` 右值/`[if:...]`）：引号即字符串字面量定界符（`@set msg = "a b"` → 值 `a b`）。
- 通用指令值（`@bg`/`@show`/修饰符）：由运行时统一去引号。收藏解锁和成长角色等由 Core 消费的 ID 也还原引号与转义；表达式中的引号仍由表达式解析器处理。
- 道具指令 `@add_item` / `@remove_item` / `@has_item` 保持已有存档合同：按词法器保留的完整参数匹配 `string[]` 中的道具，不自动去掉引号或转义。例如 `@add_item bag "long sword"` 保存的字符串包含两端双引号，后续查询和移除须使用相同写法；不等同于单引号写法或表达式值 `long sword`。推荐使用不需引号的稳定道具标识；本轮未迁移旧背包数据。

## 文本插值

`{变量名}` 在运行时替换为变量值。例：`我是{heroName}。`
字面花括号用双写转义：`{{` → `{`、`}}` → `}`（例：`输出 {{变量}} 原文` → `输出 {变量} 原文`）。未声明变量的 `{var}` 保留原文。

**说话人位置同样支持插值**：`{heroName}：你来了。` 会把说话人前缀 `{heroName}` 替换为变量值（如 `陆屿：你来了。`）。lint 会对文本值与说话人位置的插值变量都做声明校验（V002）。

## 表达式语言

用于 `@if`、`@set` 右值、`choice` 选项条件 `[if:...]`。

- 运算符（优先级从低到高）：`||`、`&&`、`== !=`、`< <= > >=`、`+ -`、`* /`、一元 `! - +`、括号 `( )`
- 字面量：数字、`"字符串"`/`'字符串'`（支持 `\n` `\t` `\\` 转义）、`true`/`false`、变量（可含点号命名空间：`lynn.trust`）
- `+` 两侧任一为字符串则拼接；一元 `+` 无语义（`+x ≡ x`）；`&&`/`||` 短路求值，未求值侧不做类型校验
- 例：`hasSword && lynn.trust >= 10`

## 指令集

> 实现状态列：✅ = 已实现并有运行时行为；⚠️ = 已声明语法但**尚未实现**（lint 报 W002，当前无任何效果，请勿依赖）。完整清单见 `packages/core/src/dsl/compiler.ts` 的 `IMPLEMENTED_INSTRUCTIONS` / `PLANNED_INSTRUCTIONS`。

### 演出
| 指令 | 示例 | 状态 | 说明 |
|---|---|---|---|
| `@bg` | `@bg castle_hall.day` | ✅ | 切换背景 |
| `@show` | `@show lynn:armor despair @ left` | ✅ | 显示立绘（角色:服装 表情）。旧位置语义保留；新舞台支持 `@pos`、`@distance`、`@x/@y`、`@scale`、`@facing`、`@opacity`、`@z` 和 `@instance`，显式值覆盖预设。未知修饰符仍报 W003 |
| `@pose` | `@pose lynn:armor 600 @x=780 @scale=1.2` | ✅ | 独立角色变换，时长可省略，默认立即生效；不移动相机，省略的属性保留 |
| `@layer` | `@layer rail rail_image @band=foreground @parallax=1.2` | ✅ | 显示独立环境/前景图层；`@layer rail @off` 移除，`@pose layer:rail 600 @x=80` 修改姿态 |
| `@stage` | `@stage dock` | ✅ | 使用项目 `stage.compositions` 的构图；背景/图层省略保留、null/空数组明确清除，人物和相机按 keepActors/resetCamera 处理 |
| `@hide` | `@hide lynn` | ✅ | 隐藏立绘 |
| `@voice` | `@voice lynn_001` | ✅ | 播放语音 |
| `@bgm` / `@se` | `@bgm tense_01` | ✅ | 音乐 / 音效 |
| `@fadein/@fadeout` | `@fadeout 400` | ✅ | 转场（毫秒） |
| `@wait` | `@wait 800` | ✅ | 阻塞等待（毫秒，正整数，上限 600000）；玩家点击可跳过，读档重新计时 |
| `@shake` | `@shake 400 8` | ✅ | 画面震动（时长毫秒，振幅像素；均可省略，缺省 400/8） |
| `@flash` | `@flash 250` | ✅ | 白闪（时长毫秒，缺省 400） |
| `@zoom` | `@zoom 1.2 600` | ✅ | 世界层缩放（目标倍率 0.25..4，过渡时长毫秒；`@zoom 1` 复位） |
| `@wipe` | `@wipe 600` | ✅ | 擦除转场：黑色竖条自左向右扫过画面（时长毫秒，缺省 600） |
| `@video` | `@video op_01` | ✅ | 阻塞视频：覆盖全屏播放，播完/出错/玩家点击跳过自动恢复剧情；素材缺失自动跳过不阻塞 |
| `@title/@chapter/@center` | `@chapter 第一章 坠落` | ✅ | 居中大字横幅（参数连成文本，约 2.2 秒淡出） |
| `@tip/@note` | `@tip 提示：右键打开菜单` | ✅ | 右上角小字提示横幅（约 1.8 秒淡出） |
| `@nvl` | `@nvl` / `@nvl off` / `@nvl clear` | ✅ | NVL 全屏小说模式：开启后文本整行追加到全屏文本页（不走打字机）；`off` 回到 ADV 对话框；`clear` 清空页面 |
| ruby 注音（文本标记） | `凛：这个<ruby=せかい>世界</ruby>…` | ✅ | 只识别显式标签；裸《》为普通书名号，不兼容旧隐式注音。主文字不嵌套标签、不跨行 |
| 行内样式与节奏 | `<em>重点</em><wave>轻声</wave><w=500><w><speed=0.5>慢慢说</speed><nw>` | ✅ | 固定标签b/i/color/size/speed/w/ruby/em/shake/wave/nw，不是HTML；nw仅句末，选项不支持节奏/动画，NVL/文字记录保留静态样式。见[行内文字合同](inline-text-contract.md) |
| `@particle` | `@particle sakura` | ✅ | 粒子特效层（预设：snow/rain/sakura/sparkle/fireflies）；`@particle off` 清除 |
| `@mov` | `@mov lynn left` / `@mov lynn 400 600` | ✅ | 立绘位置平移（角色 位置 [时长毫秒]；位置 = left/center/right 或裸数字 X 坐标；缺省 400ms） |
| `@tint` | `@tint #ff6600 0.3` / `@tint #ff6600 0.3 800` | ✅ | 全屏调色叠加（颜色 hex + 透明度 [过渡毫秒]；`@tint off` 清除） |
| `@timeline` | `@timeline intro_arrival @ blocking` | ✅ | 播放 `content/timelines/<id>.json` 中的多轨演出；默认非阻塞，追加 `@ blocking` 后等待演出完成 |
| `@ambience` | `@ambience rain` / `@ambience off` | ✅ | 播放或停止独立环境音轨，与 BGM 分开 |
| `@transition` | `@bg harbor` 后 `@transition dissolve 800` | ✅ | 支持 fade、slide-left、slide-right、circle、dissolve；dissolve 混合上一停顿后首次修改之前的旧世界与新世界，不含对白/UI。未修改则不演出，中途读档/回退视为完成。见[演出合同](presentation-effects-contract.md) |
| `@filter` | `@filter grayscale 600` / `@filter off 400` | ✅ | 作者世界滤镜blur/grayscale/sepia/vignette/off，缺省立即、时长0–600000ms；状态/剩余过渡随存档与回退，低画质不关闭剧情颜色，不影响对白和菜单。见[演出合同](presentation-effects-contract.md) |

### 时间轴演出

版本 1 保持原合同。版本 2 增加角色 `pose`、图层轨道及可复用 `clips`；片段有限重复、引用、目标重绑定与展开预算由 Core 验证。项目舞台坐标、图片校准、指令覆盖规则及 v2 示例见 [AI 指南：舞台创作](AI-GUIDE.md)。这些能力经共享 Player、Editor 与 Authoring 消费，不要求修改游戏入口源码。

时间轴是可选的 JSON 演出层，不替换现有 `@bg`、`@show`、`@mov` 等指令。场景使用时间轴前，在项目中创建同名文件：

```text
content/timelines/intro_arrival.json
```

最小结构如下：

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

可用轨道为 `background`、`portrait`、`camera`、`screen`、`particle`、`audio`。每个 cue 至少包含 `atMs`、`durationMs`、`action`；具体动作和字段以 `packages/core/src/timeline.ts` 的类型定义为准。支持的缓动为 `linear`、`inOutSine`、`outCubic`、`inOutCubic`。

其中 `camera` 支持 `zoom`（`scale` 取 0.25..4）、`pan`（`x`/`y` 为 -2000..2000 像素偏移）和 `shake`（`strength` 为 0..64）；`screen` 支持 `fade`、`tint`、`flash`、`wipe`，tint 会同时补间颜色与透明度。编辑器时间轴中，拖动 cue 中段调整开始时间，拖动右端调整时长，cue 内曲线展示当前缓动。

在 `.gal` 中：

```gal
// 播放演出，同时继续解释剧情
@timeline intro_arrival
// 演出完成前暂停剧情，可点击/快进完成
@timeline intro_arrival @ blocking
```

时间轴缺少素材时沿用渲染器的占位回退，不会阻塞启动；非法 JSON 会被 lint/编辑器报告并隔离。保存与读档会记录正在播放的时间轴游标，读档后从保存位置恢复，不重复重播已经完成的演出。旧项目不含 `content/timelines` 时行为完全不变。

### 流程
| 指令 | 示例 | 状态 | 说明 |
|---|---|---|---|
| `@goto` | `@goto labelName` | ✅ | 场景内跳转（目标必须是本场景标签） |
| `@jump` | `@jump ch01_02.start` | ✅ | 跨场景跳转（`sceneId` 或 `sceneId.label`） |
| `@call/@return` | `@call ch01_02.extra` | ✅ | 调用子场景（`sceneId` 或 `sceneId.label`）：压入返回点，`@return` 或子场景自然结束回到调用处下一行；调用栈随存档持久化，嵌套上限 64 |
| `@if/@elif/@else/@endif` | `@if x > 1` … | ✅ | 条件块，必须配对 |
| `@choice` | 见下 | ✅ | 选择肢 |
| `@switch` | `@switch chapter 1:c1 2:c2` | ✅ | 按变量值跳转 `值:标签`（数值变量与可转数值条目做数值比较，其余按字符串）；无匹配落到下一条；目标标签不存在为运行时错误 |
| `@loop` | `@loop body` | ✅ | 回跳标签（循环体 = 标签到 `@loop` 之间）；循环内必须有挂起点（文本/选择/等待）或条件出口，无挂起点的死循环由解释器步数上限兜底报错 |

### 状态
| 指令 | 示例 | 状态 | 说明 |
|---|---|---|---|
| `@set` | `@set lynn.trust = 5` | ✅ | 赋值（`=`/`:=`/`+=`/`-=`） |
| `@mod` | `@mod lynn.trust +3` | ✅ | 数值增减 |
| `@inc/@dec/@toggle/@flag/@unflag` | — | ✅ | 便捷操作 |
| `@check` | `@check trust >= 0` | ✅ | 剧本断言：条件为假立即抛运行时错误（尽早暴露剧本逻辑缺陷） |
| `@random` | `@random dice 1 6` | ✅ | 写入 [min, max] 闭区间随机整数到变量 |
| `@add_item/@remove_item` | `@add_item items key` | ✅ | string[] 变量去重追加 / 移除（道具系统基础） |
| `@has_item` | `@has_item items key hasKey` | ✅ | 来源必须声明为 string[]，按完整道具ID匹配，结果写入可写的 boolean/flag 变量 |

### 系统（M4/M5）
| 指令 | 状态 | 说明 |
|---|---|---|
| `@battle` / `@calendar` / `@affection` / `@event` / `@shop` / `@item` | ✅ | 发 `system` 事件，由宿主驱动对应 System 类（`@shop`/`@item` 引擎无内置实现，需宿主自理） |
| `@unlock_cg` / `@unlock_music` / `@unlock_text` | ✅ | 解锁图片 / 音乐 / 剧情回想；texts 在 gallery.json 配 scene/label，共享 Player 隔离回放并返回原进度，不写正式存档或永久收藏。缺省解锁随剧情存档，永久收藏须显式开启。 |
| `@unlock_profile` / `@unlock_term` | ✅ | 分别解锁 gallery.json.profiles 人物片段 / terms 用语解释，例如 `@unlock_profile rin.first`、`@unlock_term harbor`。ID 可加双引号；列表在解锁前遮蔽名称、标题和说明，缺省随档，可单独开启永久收藏。 |
| `@shop` | ✅ | 打开商店覆盖层（宿主 ShopSystem 结算）；参数 = 金币变量 道具变量，缺省 `gold bag` |
| `@scene` | ✅ | 声明性指令：仅用于与文件名推导的场景 ID 做一致性校验（lint SCENE_ID），运行时解释器不消费、无效果 |
| `@end` | ✅ | 场景结束（可省略，引擎自动追加） |
| `@clear` | ✅ | 周目通关记录：`@clear [结局ID]`（缺省结局标识 = 当前场景 ID）。解释器记录 ClearTracker + 广播 `clear` 事件（`{ ending, fresh }`），宿主接全局通关记录与 NGP 继承；结局收集随存档持久化 |
| `@exp` | ✅ | 角色成长：`@exp 角色ID 经验值`。解释器驱动 GrowthSystem（宿主注入配置）：累积经验→判升级（可连升多级）→升级属性增量写回变量仓库→广播 `growth` 事件（含 passedLevels 供 levelEvents 跳转）；等级/经验随存档持久化。单次最多连升 10,000 级；超过时拒绝整次增量，可拆分增量或配置 maxLevel。经验总量/升级阈值必须有限，等级必须在安全整数范围；失败保留原属性、等级和经验 |
| `@achievement` | ✅ | 成就事件触发：`@achievement unlock 成就ID`。发 `system` 事件由宿主 AchievementSystem 处理（when 条件成就由宿主调 check() 批量判定；幂等，重复解锁 fresh=false） |

### 存档点（已实现）
| 指令 | 示例 | 说明 |
|---|---|---|
| `@autosave` | `@autosave` | 触发 `autosave` 事件（载荷为当前完整存档快照，position 已前移到下一条指令），由宿主写入自动存档槽位 |
| `@savepoint` | `@savepoint` | 触发 `savepoint` 事件（载荷同上，kind=manual），由宿主写入手动检查点 |

渲染层/宿主需订阅对应事件（`EventBus`）执行实际写入；不订阅则指令无可见效果。
**宿主应使用事件载荷中的快照**（position 已做 +1 偏移）；若在回调内自行调用 `interpreter.saveSnapshot()`，其 position 指向存档点指令自身，读档会重放一次存档点指令（幂等但多余）。

## choice 选择肢

```galaxy
@choice
  选项A -> @goto label_a
  选项B [if:hasSword] -> @mod lynn.trust +2 @goto label_b
  选项C
@label label_a
凛：你选了 A。
```

- 选项行必须缩进（空格/Tab）
- `[if:表达式]` 为可选显示条件，必须闭合且非空，位于文案末尾、动作箭头之前。错位或未闭合时报告错误，不静默当作普通文字。
- `->` 两侧留空白，后跟内联指令（`@set/@mod/@goto/@jump` 等）；无跳转则继续 choice 之后。需要执行的动作放在 `@goto/@jump` 之前，跳转后再写动作会报错，不会替作者重排顺序。
- 标签文案中成对的单/双引号（含中文 `“…”`、`‘…’`）保护内部 ` -> ` 与 `[if:...]` 样式文字，例如 `选 "同意 -> 继续" 这项 -> @goto label_a`；引号内反斜杠转义不会提前闭合，标签原文保留。英文单词后的撇号（如 `Don't`、`James'`）仍按普通文字处理。中文引号仅在此作为文案标点，不是表达式字符串定界符。
- 成对文案引号优先；未闭合的文案引号仍可作为普通文字，如 `未闭合的 "文案 -> @bg "night" @jump accepted`。文案不能借用条件或动作参数的引号闭合；若推断未闭合文案时存在多个合法动作边界，则报带位置的 `S009`，请闭合文案引号或改用中文引号，不会静默把整段动作显示给玩家。
- 内联不允许块指令（`@if/@choice` 等）

> ⚠️ **缩进正文陷阱**：`@choice` 之后**所有**缩进的文本行都会被当作选项，直到遇到第一个非缩进行。
> `@choice` 之后的正文（对话/旁白）**绝不能以空白缩进开头**——否则会被静默吞成选项文本、剧情结构损坏且无报错。
> lint 会对此类含说话人冒号前缀的选项行发 W004 警告（如 `凛：这是缩进的对话`）。
>
> ⚠️ **全条件选项陷阱**：若所有选项都带 `[if:expr]`，运行时可能全部不满足——剧情会**静默跳过**整个选择。
> 编译器对此发 W005 警告；建议始终保留至少一个无条件选项作为兜底。

## 快进/自动播放

- 快进（skip）= **已读跳过 + 遇未读即停**：已读行（`ReadTracker` 有标记）瞬时显示并连续推进；遇到从未播放过的文本时自动退出快进，按正常打字机显示并等待玩家。
- 已读标记（`ReadTracker`）随存档持久化（`saveSnapshot.readSet`），读档后快进行为与读档前一致。
- 自动播放（auto）：文本显示完成后自动推进。

## 变量声明（game.config.json）

所有变量在使用前必须在 `game.config.json` 的 `variables` 表声明，类型安全由引擎强制：

```json
{
  "variables": {
    "lynn.trust": { "type": "number", "initial": 0, "min": 0, "max": 100 },
    "hasSword": { "type": "flag", "initial": false },
    "heroName": { "type": "string", "initial": "雷恩" },
    "items": { "type": "string[]", "initial": [] }
  }
}
```

类型：`string` `number` `boolean` `flag` `string[]` `number[]` `object`。number 的声明初值必须满足 `min <= initial <= max`（省略的边界不限制），越界声明明确拒绝；后续赋值和恢复仍对越界值自动 clamp。`readonly: true` 禁止普通写入。

### 自定义指令

`KNOWN_INSTRUCTIONS` 白名单外的指令会触发 W001 告警（拼写错误兜底）。**自定义指令**（如引擎扩展、游戏专属指令）在 `game.config.json` 声明消音：

```json
{
  "customInstructions": ["mypower", "special_cg"]
}
```

## 校验命令

```bash
node packages/cli/dist/index.js lint <projectDir>
```

输出带 `文件:行:列`、错误码与修复提示。

## 错误码表

### 词法（L）
| 码 | 含义 |
|---|---|
| L001 | 指令名缺失或 `@` 后跟空白 |
| L002 | 修饰符缺键名 |
| L003 | `@label` 用法错误 |
| L004 | 参数引号未闭合 |

### 语法结构（S）
| 码 | 含义 |
|---|---|
| S001 | `@if` 缺条件表达式 |
| S002 | 条件表达式语法错误 |
| S003 | `@if/@else/@endif` 配对错误（未闭合 / 游离） |
| S004 | `@choice` 缺少缩进选项行 |
| S005 | 选项文本/条件为空 |
| S006 | `@goto/@jump/@call` 缺目标（含 choice 选项内联写法） |
| S007 | choice 选项内不允许块指令 |
| S008 | `@if` 嵌套过深（超过 200 层，防止栈溢出） |
| S009 | 选择项箭头缺少两侧空白、动作缺少 `@`，或文案引号导致动作边界有歧义 |
| S010 | choice 行内不支持 `@switch`、`@loop`、`@video`，或在 `@goto/@jump` 后仍有动作 |

### 编译（C）
| 码 | 含义 |
|---|---|
| C001 | 标签重复定义 |
| C002 | goto 目标标签不存在 |
| C003 | （预留） |
| C004 | `@set` 用法错误 |
| C005 | `@set` 表达式语法错误 |
| C006 | `@mod` 增量非法 |
| C007 | `@wait` 毫秒参数非法 |
| C008 | `@switch` 变量与值:标签条目非法 |
| C009 | `@video` 缺少素材键 |
| C010 | `@timeline` 参数或 blocking 修饰符非法 |

### 跨场景（J）
| 码 | 含义 |
|---|---|
| J001 | `@jump/@call` 目标场景不存在 |
| J002 | 目标场景缺指定标签 |
| J003 | `@jump/@call` 目标场景存在但编译失败（先修复其语法/结构错误） |

### 变量（V）
| 码 | 含义 |
|---|---|
| V001 | 赋值/修改目标变量未声明 |
| V002 | 表达式引用未声明变量（含文本插值 `{var}`） |
| V003 | 写入 readonly 变量（`@set`/`@mod`/`@inc`/`@dec`/`@toggle`/`@flag`/`@unflag`） |
| VAR_DECL | game.config.json 变量声明形状非法（type 拼错 / 缺 initial / 类型不匹配） |

### 静态类型（T，lint 推断）
| 码 | 含义 |
|---|---|
| T001 | `@set` 值类型与目标变量声明类型不匹配（`+=/-=` 要求 number）、`@mod` 目标非 number，或 `@has_item` 来源/结果类型不符 |
| T002 | 条件表达式（`@if`/`choice [if:]`）静态类型非 boolean |
| T003 | 运算符操作数类型明显不符（如 `trust > "a"`、`trust && flag`） |
| T010 | 未知转场名称 |

### 时间轴 JSON（TL）

时间轴诊断独立于剧本表达式错误，使用 `TL001`–`TL012`（原时间轴 `T001`–`T010` 已更正），字段校验附带 JSON 字段路径。

| 码 | 含义 |
|---|---|
| TL001 | 顶层不是对象 |
| TL002 | version 不是 1 或 2 |
| TL003 | id 不合法 |
| TL004 | 总时长不是 0..600000 的整数毫秒 |
| TL005 | tracks/cues 或其元素结构错误；仅 version 2 含非空 clips 时允许空 tracks |
| TL006 | 节点时间非法或超出总时长 |
| TL007 | 轨道类型或缓动不支持 |
| TL008 | 动作不属于该轨道 |
| TL009 | 动作参数非法 |
| TL010 | 重复时间轴 id |
| TL011 | clips 格式、字段或范围非法；需要 version 2，最多 256 项 |
| TL012 | 片段引用缺失、成环/过深、展开数量超限、超出父时长或目标映射冲突 |

静态类型推断基于 `game.config.json` 的声明表与字面量；无法确定类型时跳过（不误报）。运行时类型校验仍由 `VariableStore`/求值器兜底。

> lint 也会校验 `content/config/*.json` 内的 DSL 表达式：`calendar.json` 的 `nodes[].visibleWhen` 与 `baseCommands[].when`、`events.json` 的 `events[].when`、`achievements.json` 的 `[].when`、`ngp.json` 的 `clearCondition`（引用未声明变量报 V002）；`combat.json` 的伤害公式使用内建变量 `atk`/`def`/`power`。语法错误报 `CONFIG_EXPR`。此外 `growth.json` 的 `statGrowth` 键必须已声明变量（V002）、`levelEvents` 场景必须存在（J001）。

### 其他
| 码 | 含义 |
|---|---|
| W001 | 未知指令（拼写错误兜底；可经 customInstructions 消音） |
| W002 | 规划中但未实现的指令（当前无效果，勿依赖） |
| W003 | 指令修饰符未被引擎消费（`@show` 支持 `@pos/@left/@right/@center`，其余静默丢弃；`@battle/@calendar/@affection/@event/@shop/@item` 的修饰符是宿主参数通道，交付宿主消费，不报此警告） |
| W004 | 选项文本含说话人冒号前缀，疑似缩进正文被误判为选项 |
| W005 | `@choice` 全部选项均带 `[if:expr]` 条件：运行时可能被全部过滤而静默跳过选择（建议保留无条件兜底选项） |
| W006 | 标签从未被任何 `@goto/@loop/@switch/@jump/@call` 引用（疑似残留） |
| W007 | 场景从入口场景不可达（需在 game.config.json 配置 `entryScene` 才启用检查） |
| W008 | choice 选项内含多个 `@goto/@jump`：仅第一个生效，其余被丢弃 |
| J004 | `@switch` 跳转目标标签不存在（目标必须是本场景标签） |
| SCENE_ID | `@scene` 声明与文件名不一致 / 场景 ID 含点号（破坏 `@jump` 寻址） |
| LINT_DUP | 场景 ID 重复 |
| CONFIG | game.config.json / content/config/*.json 缺失或解析失败 |
| CONFIG_EXPR | content/config/*.json 内 DSL 表达式语法错误 |
| NO_CONFIG | 未找到 game.config.json（警告，不阻断） |
| EMPTY_VARIABLES | variables 表为空（警告）；剧本和配置中的变量引用仍须声明 |
