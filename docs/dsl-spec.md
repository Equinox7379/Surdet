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

**引号契约**：词法器只做引号感知切分，**保留引号字符**。消费方约定：
- 表达式语境（`@if`/`@set` 右值/`[if:...]`）：引号即字符串字面量定界符（`@set msg = "a b"` → 值 `a b`）。
- 通用指令值（`@bg`/`@show`/修饰符）：由运行时统一去引号。渲染层（M2/M3）实现该契约。

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
| `@show` | `@show lynn:armor despair @ left` | ✅ | 显示立绘（角色:服装 表情）。位置修饰符：`@pos=值` 优先于裸 `@ left`/`@ right`/`@ center`；其余修饰符（如 `@ effect`）渲染层未消费，lint 报 W003 |
| `@hide` | `@hide lynn` | ✅ | 隐藏立绘 |
| `@voice` | `@voice lynn_001` | ✅ | 播放语音 |
| `@bgm` / `@se` | `@bgm tense_01` | ✅ | 音乐 / 音效 |
| `@fadein/@fadeout` | `@fadeout 400` | ✅ | 转场（毫秒） |
| `@wipe/@shake/@zoom/@flash/@particle/@video/@mov/@tint/@wait` | — | ⚠️ | 更多演出指令（未实现） |

### 流程
| 指令 | 示例 | 状态 | 说明 |
|---|---|---|---|
| `@goto` | `@goto labelName` | ✅ | 场景内跳转（目标必须是本场景标签） |
| `@jump` | `@jump ch01_02.start` | ✅ | 跨场景跳转（`sceneId` 或 `sceneId.label`） |
| `@call/@return` | — | ⚠️ | 调用子场景（未实现） |
| `@if/@elif/@else/@endif` | `@if x > 1` … | ✅ | 条件块，必须配对 |
| `@choice` | 见下 | ✅ | 选择肢 |

### 状态
| 指令 | 示例 | 状态 | 说明 |
|---|---|---|---|
| `@set` | `@set lynn.trust = 5` | ✅ | 赋值（`=`/`:=`/`+=`/`-=`） |
| `@mod` | `@mod lynn.trust +3` | ✅ | 数值增减 |
| `@inc/@dec/@toggle/@flag/@unflag` | — | ✅ | 便捷操作 |
| `@check` | — | ⚠️ | 便捷操作（未实现） |

### 系统（M4/M5）
| 指令 | 状态 | 说明 |
|---|---|---|
| `@battle` / `@calendar` / `@affection` / `@event` / `@shop` / `@item` | ✅ | 发 `system` 事件，由宿主驱动对应 System 类（`@shop`/`@item` 引擎无内置实现，需宿主自理） |
| `@unlock_cg` / `@unlock_music` | ✅ | 解锁 CG / 音乐（回想鉴赏） |
| `@scene` | ✅ | 声明性指令：仅用于与文件名推导的场景 ID 做一致性校验（lint SCENE_ID），运行时解释器不消费、无效果 |
| `@end` | ✅ | 场景结束（可省略，引擎自动追加） |
| `@clear` | ⚠️ | 周目结束（未实现） |

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
- `[if:表达式]` 为可选显示条件
- `->` 后跟内联指令（`@set/@mod/@goto/@jump` 等）；无跳转则继续 choice 之后
- 内联不允许块指令（`@if/@choice` 等）

> ⚠️ **缩进正文陷阱**：`@choice` 之后**所有**缩进的文本行都会被当作选项，直到遇到第一个非缩进行。
> `@choice` 之后的正文（对话/旁白）**绝不能以空白缩进开头**——否则会被静默吞成选项文本、剧情结构损坏且无报错。
> lint 会对此类含说话人冒号前缀的选项行发 W004 警告（如 `凛：这是缩进的对话`）。

## 快进/自动播放

- 快进（skip）= **跳全部**模式：瞬时显示文本 + 连续推进至选择肢。不区分已读/未读。
- 已读标记（`ReadTracker`）随存档持久化，供 M5 周目继承等场景消费。
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

类型：`string` `number` `boolean` `flag` `string[]` `number[]` `object`。number 越界自动 clamp；`readonly: true` 禁止写入。

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
| S006 | `@goto/@jump` 缺目标 |
| S007 | choice 选项内不允许块指令 |
| S008 | `@if` 嵌套过深（超过 200 层，防止栈溢出） |

### 编译（C）
| 码 | 含义 |
|---|---|
| C001 | 标签重复定义 |
| C002 | goto 目标标签不存在 |
| C003 | （预留） |
| C004 | `@set` 用法错误 |
| C005 | `@set` 表达式语法错误 |
| C006 | `@mod` 增量非法 |

### 跨场景（J）
| 码 | 含义 |
|---|---|
| J001 | `@jump` 目标场景不存在 |
| J002 | 目标场景缺指定标签 |
| J003 | `@jump` 目标场景存在但编译失败（先修复其语法/结构错误） |

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
| T001 | `@set` 值类型与目标变量声明类型不匹配（`+=/-=` 要求 number） |
| T002 | 条件表达式（`@if`/`choice [if:]`）静态类型非 boolean |
| T003 | 运算符操作数类型明显不符（如 `trust > "a"`、`trust && flag`） |

静态类型推断基于 `game.config.json` 的声明表与字面量；无法确定类型时跳过（不误报）。运行时类型校验仍由 `VariableStore`/求值器兜底。

> lint 也会校验 `content/config/*.json` 内的 DSL 表达式：`calendar.json` 的 `visibleWhen`、`events.json` 的 `when`、`ngp.json` 的 `clearCondition`（引用未声明变量报 V002）；`combat.json` 的伤害公式使用内建变量 `atk`/`def`/`power`。语法错误报 `CONFIG_EXPR`。

### 其他
| 码 | 含义 |
|---|---|
| W001 | 未知指令（拼写错误兜底；可经 customInstructions 消音） |
| W002 | 规划中但未实现的指令（当前无效果，勿依赖） |
| W003 | 指令修饰符未被引擎消费（`@show` 支持 `@pos/@left/@right/@center`，其余静默丢弃；`@battle/@calendar/@affection/@event/@shop/@item` 的修饰符是宿主参数通道，交付宿主消费，不报此警告） |
| W004 | 选项文本含说话人冒号前缀，疑似缩进正文被误判为选项 |
| SCENE_ID | `@scene` 声明与文件名不一致 / 场景 ID 含点号（破坏 `@jump` 寻址） |
| LINT_DUP | 场景 ID 重复 |
| CONFIG | game.config.json / content/config/*.json 缺失或解析失败 |
| CONFIG_EXPR | content/config/*.json 内 DSL 表达式语法错误 |
| NO_CONFIG | 未找到 game.config.json（警告，不阻断） |
| EMPTY_VARIABLES | variables 表为空，变量校验被跳过（警告） |
