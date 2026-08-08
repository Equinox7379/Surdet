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
  editor/    可视化剧本编辑器（M8）
```

## 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M0 | monorepo 脚手架 + 内核骨架 + 状态系统 + 测试基建 | ✅ |
| M1 | DSL 词法/语法/编译器 + 错误定位 + lint | ✅ |
| M2 | ADV 运行时（条件/选择/跳转） | ✅ |
| M3 | PixiJS 渲染层 + Electron 壳 + 音频 | ✅ |
| M4 | 存档完整化 + 回想/鉴赏 + 快进（已读跳过，遇未读即停） | ✅（CG/音乐/文本回想 UI） |
| M5 | 地图日程 + 战斗 + 后宫 + 周目继承 | ✅（引擎侧求解器完整；已接入存档快照，宿主接线驱动） |
| M6 | CLI 完整化 + 示例游戏（占位素材） | ✅ |
| M7 | 打包 exe + 文档定稿 | ✅ |

> 说明：M5 全家桶系统是"引擎侧数据驱动求解器 + `system` 事件 + 存档 hooks"，由宿主接线驱动。`examples/starter/src/main.ts` 演示了系统实例接线与存档往返：`@calendar`/`@battle`/`@affection`/`@event` 驱动 `CalendarRunner`/`CombatSolver`/`AffectionSystem`/`NewGamePlus`，系统状态经 `SystemHooks` 随存档保存/恢复（见 `content/config/*.json` 与 `ch02.gal`）。**示例未闭环的宿主应用逻辑**：`calendar.enter()` 的 `eventId` 仅记录不跳转场景、`ngp.unlockGallery` 未在 UI 消费、`@event` 的 `consumeEvent` 不校验 `when`（宿主应先用 `AffectionSystem.availableEvents()` 取可触发事件再消费）——这些属具体游戏逻辑，引擎只提供求解器与数据契约。

当前能力与证据索引见 [Capability Matrix](docs/capability-matrix.md)。README 只保留产品概览；能力状态以该矩阵及其测试路径为准。

## 已实现

- **状态系统**：类型安全变量/flag、范围 clamp、readonly、存档快照、拒绝 Infinity/NaN、声明表深拷贝、get 防御性深拷贝、**object 变量 JSON 安全递归校验**（拒绝 undefined/函数/NaN 等存档序列化会静默丢失的值）；标量 `@mod/@inc/@dec/@toggle` 走免拷贝热路径
- **DSL 编译器**：词法（说话人前缀/指令/修饰符、引号感知参数、@label 严格校验）→ 语法（if/elif/else 链、choice 选项、标签）→ 指令流（if→condJump 回填、choice 选项块、goto 目标解析）
- **表达式语言**：算术/比较/逻辑/字符串拼接 + 递归下降解析 + **短路求值**（`&&`/`||` 只校验求值侧）；**AST 缓存**避免热路径重复解析；变量名支持增补平面字符（\p{L}）
- **错误定位**：全部编译错误带 `文件:行:列` + 错误码 + 修复提示；BOM 容忍
- **surdet lint**：场景语法/结构/goto/jump/**@call 跨场景目标校验（J001/J002/J003）**/场景 ID 重复/**变量声明交叉校验（game.config.json）**/@scene 一致性/未知指令告警/**静态类型检查**（`@set` 类型匹配、条件必须 boolean、运算符操作数类型）
- **ADV 运行时**：`Interpreter` 逐条执行指令流，text/choice 阻塞模型（`advance()`/`choose()` 推进，事件回调内可重入）；if→condJump、跨场景 jump、**`@call/@return` 子场景调用（调用栈随存档持久化，嵌套上限 64）**、choice 条件过滤、`{var}` 插值（`{{`/`}}` 转义）；`SceneRegistry` 场景注册与标签寻址
- **存档点指令**：`@autosave`/`@savepoint` 由解释器发对应事件（载荷为完整快照），宿主订阅写入槽位
- **渲染层**：`AdvRenderer`（事件驱动，可注入 fake stage 测试）+ `PixiStage`（背景/立绘/对话框/选择肢/黑场转场、**高 DPI 渲染与窗口等比自适应 `fitWindow`**、**半透明对话框面板 + ▼ 点击等待指示器（呼吸浮动）**、**Backlog 文字记录覆盖层（L 键开关，CJK 软换行，点击任意处关闭）**）+ `Typewriter`（打字机，速度运行时可调）+ `AudioManager`（howler：**主音量×分轨音量、BGM 交叉淡入淡出、全停、语音状态查询**）+ 程序化占位素材；`PixiStage.registerBackground/registerPortrait` 支持注入真实素材（URL 或 Texture，未注册 key 回退占位；destroy 不误销毁注入纹理）
- **ADV 播放体验**：自动播放**停留时长**（基础 + 按文本长度，运行时可调）**且等语音播完再推进**；快进**遇未读即停、遇选择肢自动退出**（不会越过选择）
- **宿主暂停**：`Interpreter.pauseHost()/resumeHost()`——宿主接管剧情期间（如交互式战斗）冻结指令流，`advance()` 暂停中静默无效；starter 的 `@battle` 据此实现"战斗结束前剧情不越位"；另提供 `window.surdetDebug` 调试钩子（interp/renderer/stage/store/settings/combat）
- **CSP 兼容**：PixiStage.init 在禁 unsafe-eval 的严格 CSP 环境（Electron 加固壳/内嵌 webview）**自动加载 `pixi.js/unsafe-eval` 垫片并重试**，不再直接崩溃
- **完整指令集**：`@wait`（阻塞等待）、`@video`（阻塞视频，缺失自动跳过）、`@wipe/@shake/@flash/@zoom`（转场与特效）、`@title/@chapter/@center`（大字横幅）、`@tip/@note`（角标提示）、`@nvl on/off/clear`（全屏小说模式）、**ruby 注音**（台词内 `基础字《注音》` 渲染为振假名）、`@switch`（值:标签 多路跳转）、`@loop`（回跳循环）、`@check`（剧本断言）、`@random`（区间随机整数）、`@add_item/@remove_item/@has_item`（string[] 道具）
- **游戏外壳 UI（starter）**：标题画面（开始/读档/鉴赏/设置/退出）、系统菜单（Esc/右键：存读档/设置/文字记录/鉴赏/回标题）、多槽位存读档界面（6 槽 + 快速/自动，时间戳/章节预览）、大地图交互 UI（节点点选/行动力/结束回合，节点事件场景经 `hostJump` 跳入）、战斗技能选择条（普攻/技能+冷却展示）
- **素材管线**：`content/assets/` 约定目录（`bg/<key>.png`、`portrait/<角色>_<服装>_<表情>.png`、`bgm|se|voice/<key>.音频`）启动时批量注册；浏览器开发走 vite URL，打包 exe 经主进程素材桥读取（自动解密）
- **打包与分发**：`surdet pack` 一键出 **portable exe + NSIS 安装器**（可选安装目录/快捷方式）；素材打包时 XOR 混淆（`.skey` 密钥随包，防随手解包提取的障碍层，非密码学强度）；窗口标题读游戏 `game.config.json` 的 `title` 字段
- **桌面体验与稳定性**：Alt+Enter/F11 全屏、隐藏菜单栏、**单实例锁**（双开自动聚焦已有窗口，防互写存档）、**窗口状态记忆**（位置/尺寸/全屏跨会话恢复）、会话日志落 `userData/logs/session.log`、主进程未捕获异常错误框、渲染层错误覆盖层（不白屏）、存档 `.bak` 备份（主档损坏自动回退上一版）
- **操作体验**：Space/Enter 推进、方向键+数字键选择肢（带键盘高亮）、Ctrl 按住临时快进、`X` 全部跳过模式（不区分已读）、PageUp/PageDown/滚轮翻 Backlog、存档卡片**缩略图（舞台截图）+ 游戏时长**、立绘切换**交叉淡化**、选项 hover 高亮
- **商店系统**：`ShopSystem`（商品配置 + 金币校验 + 道具入袋，求解器 headless 可测）+ `PixiStage.showShop` 覆盖层 + `@shop [金币变量] [道具变量]` 指令（缺省 gold/bag）
- **文本回想**：`@unlock_text` 解锁 + 鉴赏第三 tab（`gallery.json` 的 `texts` 配 scene/label）+ 点击跳回场景重播
- **战斗进化**：敌方 AI（`suggestAction`：攻击最低血量目标→接近→跳过）、1D 移动阶段（`moveUnit`/◀▶ 按钮，移动消耗行动）、技能选择条、`moved` 随快照持久化
- **lint 强化**：J004 `@switch` 标签存在性、W006 未使用标签、W007 场景可达性（`game.config.json` 的 `entryScene` 为起点）
- **自我迭代第二梯队（AI 生产线）**：① `surdet audit` 内容审计与无头验收——称谓一致性（编辑距离笔误/称谓变体）、设定名词表（`content/config/terminology.json` 规范词/变体扫描）、空心分支（BRANCH_THIN）与无出口场景、每场景节奏报告（行数/字数/阅读时长）、**无头试跑**（解释器从 entryScene 自动推进：文本→推进、选择肢→第一项、@wait→立即结束、遇系统指令停止；运行时错误即验收失败）；② `docs/ai-writing-prompt.md` AI 写作标准模板（DSL 速查 + 硬性规则 + 验收闸门，lint/audit 全绿才算完成）；③ 编辑器场景拓扑图（BFS 分层 SVG，jump/call 边可视化，节点点击切换场景）
- **自我迭代第一梯队**：① 编辑器撤销/重做栈（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z，打字合并撤销点、每场景独立历史、上限 200）+ 校验 Worker 化（全项目校验移出主线程，异常自动回退同步实现，seq 对齐丢弃过期结果——大型项目编辑不再卡顿）；② Playwright + Electron E2E 自动通关回归（`npm run e2e -w @surdet/shell`：真实 Electron 壳启动 → 画布点击开局 → 键盘推进剧情/选择肢确认 → F5/F9 存读档回路 → 推进至系统交互层或结局，退出码即回归结论）；③ 存档 schema 迁移管线（`core/save/migrate`：旧档读档时按迁移表逐级升到当前版本，断链回退兼容加载，广播 `saveMigrated` 事件）
- **独立审计修复批次**：读档状态重置事件 `stateReset`（渲染层作废 @wait/@video 计时、宿主关闭覆盖层，修复 @wait 期间读档必崩）；`loadSnapshot` 清理 `hostPaused`（战斗/地图/商店中读档不再冻结）；`hostJump` 在 text/choice/wait/video 回调内重入全部正确续跑；场景级 lint 检查下沉 `core/scene-lint` 由 CLI 与编辑器共用（消除双源漂移，编辑器接入 customInstructions/变量/类型/修饰符全套检查；范围说明：场景级同源，`content/config/*.json` 表达式校验与 EMPTY_VARIABLES/NO_CONFIG 提示为 CLI 独有）；编辑器新建场景真实落盘 content/scenario、场景 key 改相对路径（子目录同名 LINT_DUP 显式报错）、零失真保持 CRLF 与半角冒号、关页脏保护；`VariableStore.restore` 默认拒写 readonly；存档槽位名单射编码；战斗技能归属/行动阵营/快照内容校验；存档深度校验补全（callStack/gallery/systems）；素材读取移除旧 XOR 回退；SE/语音音量播放中即时生效；存档缩略图纹理 LRU
- **可视化剧本编辑器**（`packages/editor`，`npm run dev -w surdet-editor` → http://localhost:5174）：File System Access 打开游戏目录（Chrome/Edge）→ 场景列表/新建/脏标记 → **块式可视化编辑**（台词/标签/指令类型化控件 + 原始行双通道，raw 行为事实来源零失真）→ **实时校验**（复用引擎编译器：语法错误、跨场景 jump/call 目标、@switch 标签、未用标签、可达性）→ Ctrl+S 保存回目录；右侧面板含校验结果（点击跳转定位）、变量表（game.config.json）、场景引用图谱；无 FS API 环境提供内存演示项目 + .gal 下载导出兜底
- **Backlog 文字记录**：`Backlog` 环形缓冲（默认 200 条，超容量淘汰最旧）由 `AdvRenderer` 自动记录每行文本；`PixiStage.showBacklog` 覆盖层展示（会话级，不随存档持久化）
- **设置系统**：`SettingsStore`/`GameSettings`（文本速度/自动播放停留/主音量与分轨音量）：load 时与默认值合并并 clamp（损坏数据不破坏运行时），存储后端可注入；Electron 壳落 `userData/settings.json`（原子写），浏览器回退 localStorage；starter 中 `[`/`]` 调文本速度即时持久化、`L` 开文字记录
- **演出指令**：`@wait`（解释器阻塞挂起 `awaiting-timer`，宿主计时回调 `finishWait()` 恢复，玩家点击可跳过；存档定位回退到 wait 指令，读档重新计时）、`@shake`（画面震动，振幅线性衰减）、`@flash`（白闪）、`@zoom`（世界层缩放，画面中心锚点）；渲染层新增 world 层承载背景/立绘变换
- **鉴赏（回想）UI**：`buildGalleryViews` 纯函数视图模型（配置 gallery.json × GalleryState 解锁状态）+ `PixiStage.showGallery` 覆盖层（CG/音乐 tab、未解锁显示 ???、CG 全屏回看、音乐点击播放）；starter `G` 键开关，解锁状态随存档持久化
- **设置图形面板**：`PixiStage.showSettings` + `SETTING_STEPS`/`stepSetting` 步进器（◀ ▶ 调整、越界 clamp、改值即时投影生效并持久化）；starter `O` 键开关
- **战斗交互式 UI**：`buildBattleView` 视图模型 + `PixiStage.showBattle`（阵营分列/血条/点击攻击/跳过行动/行动消息栏）；starter 的 `@battle` 由自动求解改为交互式回合（行动方首个存活单位出击，优先冷却就绪技能）
- **Electron 壳**：`@surdet/shell` 主进程加载示例游戏构建产物（contextIsolation + sandbox）+ preload 四桥（`surdetSave` 存档 / `surdetSettings` 设置 / `surdetApp` 退出·全屏·日志 / `surdetAsset` 素材解密读取，全部**异步 invoke IPC + sender 校验**）；打包 exe 存档落 `userData/saves/*.json` + `index.json` 元信息索引
- **存档**：`SaveManager`（多槽位/快速/自动，**全异步 API**，`SaveStorage` 接口可注入 localStorage/文件，支持可选 `listMeta` 元信息索引免全量读档）+ 快照含变量/定位/已读/解锁/**全家桶系统状态（`SystemHooks`）**；定位带**场景源码哈希**，读档时剧本已变更会发 `saveMismatch` 事件告警（schema v3）
- **回想/快进**：`GalleryState`（@unlock_cg/@unlock_music）+ `ReadTracker`（已读标记，随存档持久化）+ 渲染层自动播放/快进模式（**已读行瞬时跳过，遇未读行自动退出快进**正常播放；快进为**单帧时间预算批量推进**，长段已读文本不受帧率限制）
- **全家桶系统**（数据驱动）：`CalendarRunner`（回合/行动力/节点可达性）、`CombatSolver`（伤害公式/相克/冷却/射程，winCondition 三态 + restore，快照 JSON 安全；**僵局检测 `actingTeamStalemate` + `pass()` 出口**保证 maxTurns 在互打不到时仍生效；**默认禁止攻击同阵营**（`friendlyFire` 可开启友伤），命中判定严格开区间 `rng() < hit`（hit=0 恒 miss / hit=1 恒命中））、`AffectionSystem`（好感阶段/事件树解锁）、`NewGamePlus`（clear 判定/继承计算）；`@battle/@calendar/@affection/@event` 指令发 `system` 事件由宿主驱动
- **CLI**：`surdet new <name>`（脚手架 + workspace 注册）/ `lint` / `build` / `pack`（M7）

## 已知限制 / 未实现（诚实清单）

- 规划中但**未实现**的通用能力：战斗阵型编辑；具体状态与证据见能力矩阵。运行时 rollback、独立环境音、转场注册表已经在本轮交付；场景热重载仅限 Vite 开发预览，正式包不启用文件监听。
- 素材加密为 **AES-256-GCM**（打包时逐文件加密，`SDAT2` 魔数 + iv + authTag，篡改即解密失败）：密钥随包分发（asar 内），对"解包即得素材"形成实质障碍，但密钥本身可被提取——定位是防随手盗用的工程手段，非对抗逆向的方案
- 素材目录为空时全部走程序化占位（渐变背景/简笔立绘/静默音频）：把真实素材按约定放入 `content/assets/` 即自动生效，无需改代码
- 鉴赏已实现 **CG/音乐/文本回想解锁 + 鉴赏界面**（starter `G` 键，条目由 `gallery.json` 配置）；战斗 UI 已含技能选择/跳过/血条/行动消息，且支持 1D 移动与基础敌方 AI；阵型编辑和多位置布局仍未做
- **战斗中存档**：暂停点位于 `@battle` 之后，读档不会重开战斗界面（战斗系统状态经 `SystemHooks` 恢复，剧情继续）；如需"读档重打"可将战斗结算移入场景分支
- 快进为**已读跳过 + 遇未读即停**模式：已读行瞬时显示并连续推进，遇未读文本自动退出快进按打字机正常播放，**遇选择肢同样自动退出**；已读标记（`ReadTracker`）随存档持久化，读档后快进行为一致
- Backlog 为**会话级**记录（读档后从当前会话重新积累），不做跨存档历史；鉴赏界面与设置图形面板已实现，设置也可经 API/键位调整并持久化
- 表达式语言为确定性纯函数子集（无数组下标/字符串方法/函数调用），有意为之——保证 AI 生成内容可 lint 可预测
- **存档调用栈**：`@call/@return` 的调用栈随存档持久化（`SaveSnapshot.callStack`，schema v2）；v1 旧档无此字段按空栈加载，向后兼容
- **存档一致性**：schema v3 起定位携带场景源码哈希（`SavePosition.sceneHash`）；读档时当前场景哈希不一致发 `saveMismatch` 事件（仍照常加载，宿主可提示玩家）。v2 旧档无哈希字段跳过校验，向后兼容
- **DSL 引号转义**：`"…"`/`'…'` 内支持 `\"`/`\'`/`\\` 转义（表达式语境与通用指令值均还原）

## 运行

```bash
npm run build                        # 全量构建（含示例 vite 打包）
npm run dev -w surdet-starter        # 浏览器开发预览（http://localhost:5173）
npm run dev -w surdet-editor         # 可视化剧本编辑器（http://localhost:5174，Chrome/Edge 打开游戏目录）
npm run e2e -w @surdet/shell         # E2E 自动通关回归（Playwright 驱动真实 Electron，需先 npm run build）
npx surdet audit examples/starter    # AI 生产线验收：内容审计 + 无头试跑（--no-run 跳过试跑）
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
