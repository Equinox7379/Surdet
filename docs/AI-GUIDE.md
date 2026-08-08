# Surdet 游戏制作指南（给 AI 助手）

本文档是让一个 AI 助手以 **Surdet 引擎**为基础制作 GalGame 的完整操作手册。把本文件路径连同你的游戏需求一起交给 AI 即可。

## 0. 引擎位置与必读文件

引擎根目录：`E:\surdet`

按顺序阅读以下文件再动手：

1. `README.md` — 引擎能力总览、开发/构建命令
2. `docs/dsl-spec.md` — **DSL 剧本语言规范**（行类型、指令集、表达式、错误码表）★权威依据
3. `docs/architecture.md` — 引擎分层与数据流（了解内容如何被引擎消费）
4. `examples/starter/` — 可运行的完整示例（剧本/配置/入口），先看它的 `content/scenario/*.gal` 和 `game.config.json`
5. `packages/cli/templates/game/` — `surdet new` 生成的脚手架模板

## 1. 标准工作流

```bash
cd "E:\surdet"

# 0) 引擎已构建。若首次/改动过源码，先全量构建：
npm install
npm run build

# 1) 创建游戏脚手架（games/<name>，自动注册 workspace）
node packages/cli/dist/index.js new <游戏名>        # 或 npm run build -w @surdet/cli 后用 surdet new

# 2) 编写内容：编辑 content/scenario/*.gal（剧本）+ game.config.json（变量表）

# 3) 静态校验（必须 0 错误；错误带 文件:行:列 + 错误码 + 修复建议 hint）
node packages/cli/dist/index.js lint <游戏目录>
node packages/cli/dist/index.js lint <游戏目录> --json   # 机器可读 JSON（AI 自我修正循环用，见 §5）
node packages/cli/dist/index.js stats <游戏目录> --json  # 项目统计（只输出有效 JSON）

# 4) 预览（浏览器 http://localhost:5173）
npm run dev -w surdet-<游戏名>

# 5) 构建
node packages/cli/dist/index.js build <游戏目录>

# 6) 打包 exe（缺省 starter；指定游戏：surdet pack games/<name>）
node packages/cli/dist/index.js pack <游戏目录>
```

通用宿主接线：`@surdet/host` 提供 `createDefaultHost`、`connectSystemRouter`、`createSystemHooks` 和 Profile 存储。新游戏只需通过 adapter 注入自己的系统实例、配置、标题/资源回调；不要复制 starter 或正式游戏的整套 `bus.on('system')` 接线，也不要把具体场景 ID、素材 key 或结局文案写进 host 包。游戏侧可维护自己的 `system-adapters.ts`，公共 host 只负责路由与生命周期。

```ts
const host = createDefaultHost({
  interpreter,
  renderer,
  stage,
  adapters: [
    { id: 'battle', open: (payload, context) => { /* 游戏自己的战斗规则 */ context.resume(); } },
  ],
});
connectSystemRouter(bus, host);
```

交互式 adapter 在 `open` 前由 host 自动暂停解释器；结束时调用 `context.resume()`，失败时调用 `context.fail(error)`。需要存档的系统通过 `createSystemHooks` 提供 `snapshot/validate/restore`，所有参与恢复的 adapter 会先完成校验，再发生任何状态写入。

时间轴演出是可选能力。若需要让背景、立绘、镜头和屏幕效果同时运动，在 `content/timelines/` 放置 JSON，并在 `.gal` 中用 `@timeline <id>` 引用。旧项目可以继续只使用传统演出指令。

传统转场与震动也可直接写入场景：

```gal
@transition fade 600          # fade / slide-left / slide-right / circle
@shake horizontal 400 12      # 方向：both / horizontal / vertical / diagonal
@ambience rain_window 800     # 独立于 BGM 的环境音循环声道
@ambience off 500
```

`@transition` 的时长会限制在 1..10000ms；未知转场名会被 CLI lint 和编辑器判为错误，不会静默降级。`@shake` 的省略方向写法仍兼容：`@shake 400 8`。环境音最多同时播放一条，与 BGM、SE、语音分轨独立，音量设置项为“环境音量”。

开发预览支持 `.gal` 场景热更新：每个 Vite 游戏把 `import.meta.glob('../content/scenario/**/*.gal', { query: '?raw', import: 'default' })` 放在独立的 `scene-hmr-boundary.ts` 自接受模块中，主入口不自接受，避免重建 PixiStage、AudioManager、FrameScheduler 等长期实例。Vite 开发服务器收到剧本变更后会重新编译并原子替换场景注册表；若当前正停在该场景，会按新指令流限制 PC 并重放当前状态。编译失败、场景 ID 不一致时保留旧场景并在控制台报告。该能力只存在于 `import.meta.hot` 开发分支，正式构建不启动文件监听器，也不会改变正式包的运行时行为。

## 2. DSL 速查

```
# 场景文件 content/scenario/ch01_01.gal（场景 ID = 文件名去扩展名）

@scene ch01_01          # 声明场景（须与文件名一致）
@bg castle              # 背景
@bgm tense_01           # 音乐
@timeline intro_arrival @ blocking  # 播放多轨开场，完成前暂停剧情

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
7. **每次改完剧本必须跑 lint 到 0 错误再交付**。错误信息带 `文件:行:列` + 错误码 + 可操作的修复建议（hint），按 §5 自我修正循环处理。
8. **类型自洽**：`@set` 右值类型须与变量声明匹配（`@set x = "a"` 但 x 声明为 number 会报 T001）；`@if`/`[if:]` 条件必须结果为 boolean；数字/字符串别混用比较与逻辑运算符（T002/T003）。字符串字面量必须带引号。
9. **字符串内引号**：表达式字符串字面量只支持 `\n` `\t` `\\` 转义，**不支持 `\"`**——`"say "hi""` 会在词法层提前闭合引号导致解析错误。字符串内容里需要引号时，改用另一种引号包裹（如 `'say "hi"'`）或调整措辞。

## 5. 自我修正循环（AI 质量闭环）

Surdet 的 lint 是 AI 创作的**奖励信号**：写剧本/配置 → lint → 按 `hint` 修复 → 再 lint，直到 0 错误。

```bash
# 机器可读输出：{ ok, sceneCount, issues: [{severity, code, text, hint, file, line, col}] }
node packages/cli/dist/index.js lint <游戏目录> --json
```

循环规则：

1. 解析 `issues` 数组，逐条按 `hint` 修复——hint 是可操作指令（声明哪个变量、补哪个标签、建哪个文件、改哪处拼写）。
2. 每修一批重跑 lint，直到 `ok: true`；不要累积大量未验证改动一次性提交。
3. 警告（severity=warning）不阻断，但 W004/W005（choice 陷阱）与 W007（不可达场景）应逐条处理或说明保留理由。

交付前再加两道更深的验证（把"玩到第三章才崩"提前到交付前）：

```bash
# 无头自动模拟：全分支遍历 + 结局可达性 + 死路检测 + 运行时错误收集 + 存档往返冒烟
node packages/cli/dist/index.js simulate <游戏目录>
# 内容审计：称谓一致性/名词表/空心分支/节奏 + 无头试跑
node packages/cli/dist/index.js audit <游戏目录>
```

**交付硬门槛**：`lint --json` 的 ok=true + `simulate` 退出码 0 且"运行时错误：0"。宿主才能置位的变量（如战斗结果）可用 `simulate --assume 变量=值` 注入模拟。

## 6. 验收标准

- `surdet lint <游戏目录>` 输出 0 错误（警告可接受但尽量消除）；`--json` 输出 `ok: true`
- `surdet simulate <游戏目录>` 退出码 0、运行时错误 0、关键结局可达
- `npm run dev -w surdet-<游戏名>` 能打开，剧情从头到尾可推进（含选择肢、分支、存档 F5/F9、快进 S、自动 A）
- 交付物：修改后的 `games/<name>/` 目录 + 一份剧情路线/变量清单说明

## 7. 全家桶系统（可选，数据驱动）

需要地图日程/回合战斗/后宫/周目继承时，用对应的 System 类（`CalendarRunner` / `CombatSolver` / `AffectionSystem` / `NewGamePlus`），剧本里用 `@calendar` / `@battle` / `@affection` / `@event` 指令触发（发 `system` 事件由宿主驱动），配置与用法见 `packages/core/src/calendar|combat|systems/` 的类型定义与 `docs/architecture.md`。若只做纯 ADV，可完全跳过。
