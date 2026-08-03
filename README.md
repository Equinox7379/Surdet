# Surdet Engine

成熟、数据驱动的桌面 GalGame 引擎。目标系统完整度对齐兰斯系列：ADV 演出 + 地图日程 + 回合战斗 + 后宫/好感 + 多周目 + 回想鉴赏，全部数据驱动，不做硬编码。

## 设计原则

- **内核与内容彻底分离**：游戏 = `DSL 剧本 + JSON 配置 + 素材`，任何 AI 照着规范即可产出可运行的游戏。
- **内核零依赖**（`@surdet/core`）：DSL 编译、状态、存档、战斗求解全部 headless 可运行、可直接单测。
- **渲染只是投影**：`@surdet/renderer`（PixiJS）只负责把内核状态画出来。
- **单语言栈**：全 TypeScript，Electron 壳打包成 Windows exe，AI 从构建到打包零摩擦。

## 仓库结构

```
packages/
  core/      引擎内核（零依赖，headless）
    dsl/      剧本语言：词法/语法/编译 → 指令流
    runtime/  解释器、场景路由、事件总线
    state/    类型安全变量/flag/好感度/道具
    save/     存档快照/多槽位/自动存档
    combat/   数据驱动回合战斗求解器
    calendar/ 地图日程/回合/行动力
    systems/  后宫树/回想鉴赏/周目继承
  renderer/  PixiJS 舞台（M3）
  shell/     Electron 壳（M3）
  cli/       surdet 命令：new/lint/build/pack（M6）
```

## 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | monorepo 脚手架 + 内核骨架 + 状态系统 + 测试基建 | ✅ |
| M1 | DSL 词法/语法/编译器 + 错误定位 + lint | ✅ |
| M2 | ADV 运行时（条件/选择/跳转） | ✅ |
| M3 | PixiJS 渲染层 + Electron 壳 + 音频 | ✅ |
| M4 | 存档完整化 + 回想/鉴赏 + 快进（跳全部模式） | ✅（CG/音乐解锁完整；文本回想为预留类型；按已读跳过的快进未接线） |
| M5 | 地图日程 + 战斗 + 后宫 + 周目继承 | ✅（引擎侧求解器完整；已接入存档快照，宿主接线驱动） |
| M6 | CLI 完整化 + 示例游戏（占位素材） | ✅ |
| M7 | 打包 exe + 文档定稿 | ✅ |

> 说明：M5 全家桶系统是"引擎侧数据驱动求解器 + `system` 事件 + 存档 hooks"，由宿主接线驱动。`examples/starter/src/main.ts` 已完整演示接线：`@calendar`/`@battle`/`@affection`/`@event` 驱动 `CalendarRunner`/`CombatSolver`/`AffectionSystem`/`NewGamePlus`，系统状态经 `SystemHooks` 随存档往返（见 `content/config/*.json` 与 `ch02.gal`）。

## 已实现

- **状态系统**：类型安全变量/flag、范围 clamp、readonly、存档快照、拒绝 Infinity/NaN、声明表深拷贝、get 防御性深拷贝
- **DSL 编译器**：词法（说话人前缀/指令/修饰符、引号感知参数、@label 严格校验）→ 语法（if/elif/else 链、choice 选项、标签）→ 指令流（if→condJump 回填、choice 选项块、goto 目标解析）
- **表达式语言**：算术/比较/逻辑/字符串拼接 + 递归下降解析 + **短路求值**（`&&`/`||` 只校验求值侧）
- **错误定位**：全部编译错误带 `文件:行:列` + 错误码 + 修复提示；BOM 容忍
- **surdet lint**：场景语法/结构/goto/jump/场景 ID 重复/**变量声明交叉校验（game.config.json）**/@scene 一致性/未知指令告警/**静态类型检查**（`@set` 类型匹配、条件必须 boolean、运算符操作数类型）
- **ADV 运行时**：`Interpreter` 逐条执行指令流，text/choice 阻塞模型（`advance()`/`choose()` 推进，事件回调内可重入）；if→condJump、跨场景 jump、choice 条件过滤、`{var}` 插值（`{{`/`}}` 转义）；`SceneRegistry` 场景注册与标签寻址
- **存档点指令**：`@autosave`/`@savepoint` 由解释器发对应事件（载荷为完整快照），宿主订阅写入槽位
- **渲染层**：`AdvRenderer`（事件驱动，可注入 fake stage 测试）+ `PixiStage`（背景/立绘/对话框/选择肢/黑场转场）+ `Typewriter`（打字机）+ `AudioManager`（howler）+ 程序化占位素材；`PixiStage.registerBackground/registerPortrait` 支持注入真实素材（URL 或 Texture，未注册 key 回退占位）
- **Electron 壳**：`@surdet/shell` 主进程加载示例游戏构建产物（contextIsolation + sandbox）+ preload 文件存档桥（`window.surdetSave`，打包 exe 存档落 `userData/saves/*.json`）
- **存档**：`SaveManager`（多槽位/快速/自动，`SaveStorage` 接口可注入 localStorage/文件）+ 快照含变量/定位/已读/解锁/**全家桶系统状态（`SystemHooks`）**
- **回想/快进**：`GalleryState`（@unlock_cg/@unlock_music）+ `ReadTracker`（已读标记，随存档持久化）+ 渲染层自动播放/快进模式
- **全家桶系统**（数据驱动）：`CalendarRunner`（回合/行动力/节点可达性）、`CombatSolver`（伤害公式/相克/冷却/射程，winCondition 三态 + restore，快照 JSON 安全）、`AffectionSystem`（好感阶段/事件树解锁）、`NewGamePlus`（clear 判定/继承计算）；`@battle/@calendar/@affection/@event` 指令发 `system` 事件由宿主驱动
- **CLI**：`surdet new <name>`（脚手架 + workspace 注册）/ `lint` / `build` / `pack`（M7）

## 已知限制 / 未实现（诚实清单）

- 规划中但**未实现**的指令（lint 给 W002 提示，避免静默无操作）：`@wipe/@shake/@zoom/@particle/@flash/@video/@mov/@tint/@wait`、`@title/@chapter/@tip/@note/@center/@nvl/@ruby`、`@call/@return/@loop/@random/@switch/@check`、`@add_item/@remove_item/@has_item`、`@clear`
- 鉴赏仅实现 **CG/音乐解锁**（`GalleryState`）；文本回想（`GalleryTextEntry`）为预留配置类型，回想界面未实现
- 快进为**跳全部模式**（瞬时显示 + 连续推进至选择肢，不区分已读/未读）；`ReadTracker` 已记录并随存档持久化，但**按已读跳过**的逻辑未接线
- 表达式语言为确定性纯函数子集（无数组下标/字符串方法/函数调用），有意为之——保证 AI 生成内容可 lint 可预测

## 运行

```bash
npm run build                        # 全量构建（含示例 vite 打包）
npm run dev -w surdet-starter        # 浏览器开发预览（http://localhost:5173）
npm run start -w @surdet/shell       # 桌面窗口（先 build）
```

## 文档

- DSL 语言规范与错误码表：`docs/dsl-spec.md`（AI 生成游戏的权威依据）
- 架构与数据流：`docs/architecture.md`
- 示例项目：`examples/starter/`（含 `game.config.json` 变量声明演示）

## 打包

```bash
npm run pack -w @surdet/shell    # electron-builder 打包 portable exe（release/SurdetGame-*.exe）
surdet pack                       # 等价 CLI 入口
```

## 开发命令

```bash
npm install
npm run typecheck   # 全部包类型检查
npm test            # 全部包单元测试
npm run build       # 全部包构建
```
