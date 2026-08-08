# Surdet 编辑器升级与引擎差异化方案（执行任务书）

> 本文档自包含：接手的 AI 不需要任何额外上下文即可开工。
> 目标：① 把剧本编辑器升级为商业化级制作工具；② 确立 Surdet 引擎的独特定位，避免成为 TyranoBuilder/Ren'Py/NaniNovel 的换皮。
> 目标市场：**仅中文市场**，不做国际化、不做英文文档。
> **修订 v2**：修正初稿 3 处事实错误（E2 素材来源、E5 验收数字、E1 共享函数提取），补入 E4 渲染路线决策、simulate 剪枝策略、schema 边界；E1 拆为两阶段；**移除全部 Steam 相关内容**（不上架 Steam）。

---

## 0. 现状基线（开工前必读，已核验）

**仓库**：`E:\surdet`（Windows，PowerShell）
**HEAD**：`f44bca9`（审计轮4 已提交），工作树干净。
**包结构**（npm workspaces monorepo，TypeScript）：

| 包 | 路径 | 职责 |
|---|---|---|
| `@surdet/core` | `packages/core` | DSL 词法/语法/编译、表达式、解释器、存档、玩法系统（纯逻辑、headless、零 DOM） |
| `@surdet/cli` | `packages/cli` | `new` / `lint` / `build` / `pack` / `audit` 命令 |
| `@surdet/renderer` | `packages/renderer` | PixiJS 8 渲染层（ADV 渲染器、Backlog、设置、UI 视图、音频） |
| `@surdet/shell` | `packages/shell` | Electron 壳 + AES-256-GCM 素材加密打包 |
| `surdet-editor` | `packages/editor` | 浏览器端可视化剧本编辑器（本方案 Part A 的主战场） |
| `surdet-starter` | `examples/starter` | 全系统接线示例游戏 |

**回归基线（每个阶段完成时必须全绿）**：
- `npm run typecheck`：全 workspace 0 error
- `npm run test`：442 过（core 260 / cli 66 / renderer 83 / shell 19 / editor 14），只增不减
- `node packages/cli/dist/index.js lint examples/starter`：4 场景 0 错 0 警

**编辑器现状（精确）**：
- `packages/editor/src/main.ts`（约 870 行，monolithic）：File System Access 打开目录 → 场景列表侧栏 → 块式行编辑 → 实时校验 → 保存回目录；含 undo/redo（HISTORY_LIMIT=200、COALESCE_MS=600）、指令模板 `INSTR_FIELDS`、场景拓扑 SVG 小图（`updateGraph`，BFS 分层、只读、不可交互）、引用边列表、变量 chips。
- `packages/editor/src/model.ts`：**零失真行模型**——raw 行是唯一事实来源，类型化字段只是编辑糖，`serializeScript` 逐行直出，保存不改 CRLF/LF。**这是编辑器的核心资产，任何重构不得破坏此契约。**
- `packages/editor/src/validate.ts`：项目级校验，与 CLI 同源（复用 `@surdet/core` 的 scene-lint 共享实现），产出 issues + 编译产物。
- `packages/editor/src/validate-worker.ts`：Web Worker 校验。
- `packages/editor/package.json`：仅依赖 `@surdet/core` + vite，无 UI 框架。
- 无 File System Access 的环境有内存演示项目 + 下载导出兜底。

**DSL 指令集**（编辑器模板须覆盖）：见 `docs/dsl-spec.md`——演出（bg/show/hide/voice/bgm/se/fade/wait/shake/flash/zoom/wipe/video/title/tip/nvl/particle/mov/tint）、流程（goto/jump/call/return/if/choice/switch/loop）、状态（set/mod/inc/dec/toggle/flag/unflag/check/random/add_item/remove_item/has_item）、系统（battle/calendar/affection/event/shop/item/unlock_*/clear/exp/achievement）、存档点（autosave/savepoint）。

**已有但容易被忽视的差异化资产**：
- `packages/cli/src/audit.ts` + `content/config/terminology.json`：**剧情审计**（设定名词表一致性扫描）已存在——竞品全都没有，Part B 会放大它。
- `docs/AI-GUIDE.md`：引擎从第一天就为 AI 协作设计（交给 AI 一个文件路径即可让它做游戏）。
- core 完全 headless：解释器可在无 DOM 环境跑完整个游戏——这是"自动通关测试"（Part B 支柱 2）的地基。

---

## Part A · 编辑器升级方案（六个阶段）

### 总原则

1. **零失真不可破坏**：所有新功能建立在 `model.ts` 的 raw-is-truth 契约上；任何编辑操作的往返测试（parse → serialize → 逐字节相等）必须进测试。
2. **不引入 UI 框架**：保持 vanilla TS + DOM（现有代码风格），图表用 SVG。若某阶段确需引入依赖，先在该阶段开头说明理由并选最小依赖。
3. **同源校验**：编辑器校验永远复用 `@surdet/core` 导出，不允许在编辑器里重写 lint 逻辑（防双源漂移，这是引擎的既定架构纪律）。
4. **每阶段独立可交付**：阶段末尾给出验收命令；允许在任一阶段后停下来发布。

---

### E0 架构拆分（先行，其余阶段的地基）

**问题**：main.ts 约 850 行单文件，继续加功能会失控。

**任务**：
1. 将 main.ts 拆为：
   - `state.ts`：全局 state 对象 + SceneEntry 类型
   - `project-io.ts`：openProject / readScenarioDir / saveAll / exportScene / loadDemoProject
   - `history.ts`：undo/redo/setCurrentText（保留 200 条上限与 600ms coalesce 语义）
   - `panels/sidebar.ts`（场景列表）、`panels/editor.ts`（块编辑区 + INSTR_FIELDS 渲染）、`panels/issues.ts`、`panels/right.ts`（变量 chips + 拓扑图 + 引用列表）
   - `main.ts` 只剩装配与事件路由
2. 拆分是**纯搬移**：不改行为、不重命名导出语义、不动 CSS 类名。
3. 拆分后立即补第一批单元测试（editor 当前 14 个测试全在 model 层）：为 `history.ts` 补 coalesce/上限边界测试。

**验收**：typecheck 绿；editor 14+ 测试全过；手动打开 starter 目录，编辑→保存→`git diff` 确认字节级无意外改动（换行符保持）。

---

### E1 场景流程图（旗舰功能，商业化刚需；拆两阶段交付）

**现状**：`updateGraph` 是只读的 SVG 缩略图，节点=场景，边=jump/call，BFS 分层，无交互。
**目标**：独立的"流程图视图"标签页，节点下钻到**标签级**，可交互导航与编辑。

**设计**：

1. **图数据模型**（新文件 `graph/build.ts`，纯函数、可单测）：
   - 节点两类：SceneNode（场景入口）、LabelNode（`@label`）；从 validate.ts 已有的编译产物（`CompiledScene.instructions` + `labels`）提取，**不重新解析**。
   - 边四类：`jump`（跨场景，实线）、`call`（虚线，有返回）、`goto/switch/loop`（场景内，同色系细线）、`choice`（**每个选项一条边，边标签=选项文本**，条件 `[if:...]` 显示在边上）。
   - `@if/@elif/@else` 分支：每个分支的首个跳转边带条件表达式标签。
   - 配置驱动入口（events.json `scheduled[].scene`/`events[].scene`、growth.json `levelEvents`、calendar.json `eventId`）画成特殊"宿主入口"虚框——与 CLI `collectConfigSceneRoots` 同源。**E1 前置子任务（独立可验收）**：把 `collectConfigSceneRoots` 从 `packages/cli/src/lint.ts`（当前未导出）下沉到 `@surdet/core`（参照 scene-lint 下沉先例），CLI 改为从 core 导入，编辑器直接复用；下沉时为该函数补单测，避免第三份实现。
2. **布局**：保留 BFS 分层算法打底，层内用简单的中位数法减少交叉；节点尺寸自适应文本。SVG 渲染，支持平移/滚轮缩放（transform 矩阵，自实现约 60 行，不引第三方图表库）。
3. **交互（按阶段拆分）**：
   - **E1a（只读导航版）**：单击节点 → 切到该场景的块编辑视图（已有场景切换逻辑）；双击标签节点 → 跳转并滚动到该 `@label` 行；当前场景高亮；有 error 的节点红色描边、warning 黄色角标（数据来自 issues 列表）。
   - **E1b（交互编辑版）**：从节点的出边锚点拖到另一节点 → 在源场景末尾插入 `@jump 目标场景.标签`（插入走 history，可 undo）；拖到同场景标签插入 `@goto`；右键节点：重命名场景文件 / 删除场景（带引用检查：有入边时警告）。
4. **规模目标**：100 场景 / 800 标签内流畅（渲染用虚拟化：视口外节点不建 DOM）。

**测试**：`graph/build.ts` 的图构建单测（choice 多边、条件标签、call 返回边）；拖拽插入用 DOM 事件模拟测 insertLine 结果。

**验收（E1a）**：starter 打开流程图，ch01_01 的三个 choice 选项显示为三条带文本的边；ch02 的 `@calendar` 宿主入口可见；collectConfigSceneRoots 下沉后 cli 与编辑器取到的宿主入口根集合一致。
**验收（E1b）**：拖拽新建一条 jump 后 lint 无新错误；删除有入边的场景时给出警告且不产生悬挂引用。

---

### E2 素材面板

**现状**：编辑器对素材一无所知；`@bg castle_hall` 里的 key 只是字符串。
**约定**：starter 的素材注册由 `loadAssets()` 经 vite glob 扫描 `content/assets/**` 完成（文件名即 key；目录约定：`bg/`、`portrait/<角色>_<服装>_<表情>`、`bgm|se|voice/`），占位素材程序化生成，**没有静态 key→URL 映射表可扫**。因此编辑器不强制素材文件存在，但要列出已知 key。

**任务**：
1. 左栏新增"素材"标签页，三个区块：
   - **已知 key 清单**：扫描项目 `content/assets/` 目录树（按目录约定推导 key 与类型）+ `content/config/gallery.json`（cgs/music/texts 的 src 字段）+ 剧本中素材类指令参数的候选集，列出全部已知素材 key，带类型图标（背景/立绘/音乐/音效/语音/视频）。
   - **剧本使用统计**：每个 key 被哪些场景引用（复用 validate 编译产物扫描指令参数），0 引用的标灰（提示"声明未用"）。
   - **插入辅助**：点击 key → 在当前光标行插入对应指令（`@bg`/`@show`/`@bgm`/`@se`/`@voice`/`@unlock_cg`…按素材类型），或复制 key。
2. **立绘选择器**：`@show` 的插入对话框解析已有 `角色:服装 表情` 用法（扫描现有剧本中的 @show 参数建立候选集，不发明新格式）。
3. 预览：若项目目录里存在真实图片（`content/assets/**` 或 `public/**`，两个位置都扫），hover 显示缩略图；不存在则显示占位色块 + key 名（与运行时占位素材哲学一致）。

**测试**：素材清单构建（从 fixture 项目）、插入指令生成的行文本正确性。

**验收**：starter 里能看到 `castle_hall`/`night_field`/`tense_01` 等 key 及引用计数；点击 `castle_hall` 插入 `@bg castle_hall`。

---

### E3 配置可视化编辑（全家桶 JSON 的表单化）

**现状**：game.config.json 在编辑器里只是右侧只读 chips；其余配置（achievements/calendar/growth/events/shop/ngp/gallery）完全不可视。
**原则**：配置编辑器是**表单 ⇄ JSON 双向**，保存时写回对应文件；schema 校验复用 CLI lint 已有规则（能报的错都报，不允许编辑器产出 CLI lint 不过的配置）。

**任务**（按优先级排序，可分多次交付）：
1. **变量表编辑器**（game.config.json `variables`）：表格增删行——名称/类型(number/flag/string/string[])/initial/min/max/readonly/description；保存前跑 `parseVariableConfig` 校验；被剧本引用中的变量禁止直接删除（列引用处）。
2. **成就编辑器**（achievements.json）：表格 + when 表达式输入（带变量名下拉提示）+ hidden 开关；校验 when 语法（复用 expr 解析）。
3. **日历编辑器**（calendar.json）：节点表格（含坐标小画布拖拽定位——直接操作 x/y）、baseCommands 表格、回合头尾事件 ID。
4. **成长编辑器**（growth.json）：曲线参数 + profiles（statGrowth 键从变量表下拉选择，levelEvents 场景从场景列表下拉）。
5. **事件编辑器**（events.json）：profiles/tiers + events + scheduled（priority 数字列）。
6. **鉴赏编辑器**（gallery.json）：cgs/music/texts 表格，texts 的 scene/label 从场景+标签下拉。

**通用要求**：每个编辑器打开时读文件、关闭/保存时写文件；JSON 写出保持 2 空格缩进、键序稳定（减少 diff 噪音）；文件在外部被改动时重新加载并提示。

**测试**：表单 → JSON → 表单往返一致性；非法输入被 schema 校验拦截。

**验收**：在编辑器里新增一个成就 + 一个变量，保存后 `node packages/cli/dist/index.js lint examples/starter` 仍 0 错 0 警。

---

### E4 内嵌实时预览

**现状**：编辑与运行完全分离（改剧本要切到 `npm run dev -w surdet-starter`）。
**目标**：编辑器内一键预览当前场景。

**设计**：
1. 预览面板 = iframe 内嵌一个精简 runner：`@surdet/core`（编译+解释器）+ `@surdet/renderer`（AdvRenderer + **真实 PixiStage**）。**渲染路线决策（已定）：预览使用真实 PixiStage，不做 DOM 降级舞台**——编辑器的既定纪律是同源校验/零漂移，第二套渲染实现必然与运行时漂移；Pixi 的 WebGL 要求在浏览器编辑器环境不成问题，本地工具不敏感产物体积。renderer 已是独立包，iframe 里直接 import 其 ESM 产物。
2. 预览源 = **编辑器内存中的剧本文本**（未保存也能预览）：把 state.scenes 的当前文本序列化后传给 iframe（postMessage），iframe 内 `compileScene` 即时编译。
3. 行为：从当前场景头部开始播放；工具条提供"从当前行"（找最近的上方 @label，没有就从头）、步进速度开关（跳过打字机动画）、占位素材开关。
4. 素材缺失处理与运行时一致（占位色块），预览不依赖真实素材文件。
5. **边界**：system 类指令（@battle/@calendar/@shop…）在预览里显示为"宿主指令占位卡片"并继续——预览不实例化全家桶宿主（明确写进文档，不追求预览全系统）。

**测试**：iframe 消息协议的单测（序列化载荷往返）；预览编译失败时把错误渲染为面板内 issue 视图。

**验收**：编辑 ch01_01 某行台词 → 预览立即可见新台词，无需保存。

---

### E5 打磨与制作统计

1. **跨场景搜索/替换**：全文搜索（正则可选），替换走 history（整体可 undo）；替换后自动重跑校验。
2. **制作统计面板**：总字数/每场景字数、台词数、选择肢数量、预估游戏时长（字数 ÷ 默认文本速度 + wait/转场累加）、结局数（@clear 计数）、CG 收集率（unlock_cg 数 ÷ gallery 总数）。——制作人向投资人/发行报进度时直接用这张表，商业化加分项。
3. **角色一致性面板**：把 CLI `audit`（terminology.json）搬进编辑器侧栏——违规用词列表，点击定位行。
4. **场景模板**：新建场景对话框提供模板（纯对话 / 选择分支 / 战斗演出 / 结局），模板内容是带注释的 .gal 片段。
5. **快捷键**：Ctrl+S 保存全部 / Ctrl+Z/Y 撤销重做（已有逻辑绑定）/ Ctrl+F 搜索 / Ctrl+P 预览。

**验收**：starter 统计面板显示合理数字（4 场景、3 个 choice 选项、1 个结局、2 个 CG）；terminology 违规列表与 CLI audit 输出一致。

---

## Part B · 引擎独特性方案：不做换皮，做"AI 时代的视觉小说引擎"

### 竞品坐标系（中文市场视角）

| 引擎 | 定位 | 弱点（= Surdet 的机会） |
|---|---|---|
| TyranoBuilder | 日本/中国同人主流，可视化编辑 | 脚本语言陈旧、无类型检查、系统扩展靠 JS 手写、对 AI 不友好 |
| Ren'Py | 英文社区标准，Python 脚本 | 中文社区弱、学习曲线陡、无中文化排版深度 |
| NaniNovel（Unity） | 商业团队用 | 重、贵、绑定 Unity、剧本与代码耦合 |
| 自研引擎 | 大厂内部 | 不对外、无生态 |

### 一句话定位

**Surdet = 为 AI 协作而生的数据驱动视觉小说引擎**：剧本是带类型检查的 DSL，玩法系统是 JSON，质量由 lint 和自动模拟兜底——人写、AI 写、人机合写都是一等公民。

竞品没有一个把"AI 可写、机器可验"当架构目标。这是真差异化，不是营销话术——它已经体现在 AI-GUIDE.md、dsl-spec 的错误码体系、lint 的 hint 机制上。以下五个支柱把它做实。

### 支柱 1：AI 创作闭环（把 lint 变成 AI 的奖励信号）

已有：`docs/AI-GUIDE.md`、dsl-spec 错误码表、LintIssue 带 hint 字段。
补强：
1. `surdet lint --json`：机器可读输出（错误码 + 文件行列 + hint），AI 拿到即可自我修正。这是 AI 创作工具链的接口标准。
2. 每条错误码配"修复建议"文案（hint 字段补齐率 100%），文案写给 AI 看（精确、可操作）。
3. `docs/AI-GUIDE.md` 增加"自我修正循环"章节：AI 写剧本 → lint → 按错误码修复 → 再 lint，直到 0 错。
4. 术语审计（audit/terminology.json）升级为 AI 可用的"设定一致性 API"：AI 长篇创作最易写崩设定名词，这是杀手级护栏。
**验收**：用任意大模型按 AI-GUIDE 从零做一个 3 场景小游戏，全程只喂文档，产出 lint 0 错。

### 支柱 2：Headless 自动模拟测试（竞品全都没有的杀手级功能）

core 完全 headless = 可以无渲染跑完整个游戏。新增 `surdet simulate`：
1. **自动遍历**：解释器驱动全部场景，choice 按策略选择（全分支枚举 + 随机模式），文本/wait 自动快进。**探索约束（防状态爆炸，必须实现）**：路径数上限（缺省 500，`--max-paths` 可调）；按 `(场景, pc, 变量签名哈希)` 状态签名做已访问剪枝；单条路径步数上限复用解释器既有步数守卫——`@loop` 死循环无需自实现检测，直接收集该 RuntimeError 归入"死路/死循环"报告项。
2. **产出报告**：
   - 分支覆盖率（走过多少 choice 分支 / 总数）
   - 结局可达性（每个 @clear 是否可达、从入口的最短路径）
   - 死路检测（无出口的场景、永真循环）
   - 运行时错误收集（@check 断言失败、未定义变量、类型错误）——把"玩到第三章才崩"提前到 CI
   - 预估通关时长（按文本速度累计）
3. **存档往返冒烟**：模拟途中每 N 步自动存/读档，验证快照一致性（防止新系统接入破坏存档）。
4. 接入 starter：`npm run simulate` 作为示例；CI 里当回归门禁。
**验收**：对 starter 运行，输出 3 场景全覆盖、demo_end 结局可达、0 运行时错误；人为制造一个死路场景，simulate 必须报出来。

### 支柱 3：全家桶数据驱动（把"系统靠代码"变成"系统靠 JSON"）

已有：calendar/combat/shop/growth/achievement/affection/event-scheduler 全配置驱动 + SystemHooks 存档接线。
补强：
1. `docs/systems-cookbook.md`：每个系统一份"配方"——最小配置、完整配置、宿主接线代码片段、常见坑。这是竞品文档没有的深度。
2. 每个系统的 JSON schema 文件化（`packages/cli/schemas/*.json`），lint 直接消费 schema 报形状错误。**边界：schema 只管形状**——语义规则（min≤max、V002/J001 等跨文件引用检查、表达式合法性）保留在现有代码校验，不迁移，防校验能力倒退。
3. `surdet new --preset full`：脚手架直接带全家桶示例配置（现在只有最小模板）。
**验收**：新人按 cookbook 在 1 小时内给空项目接出商店+成就两个系统，不写一行 TS。

### 支柱 4：中文排版深度（中文市场的基本盘）

1. **断行禁则**：逗号/句号/后引号不挂行首，前引号不挂行尾，省略号/破折号不被拆开——在 Typewriter/Backlog 的断行逻辑里实现（先写失败用例测试再改）。
2. **自定义字体**：支持项目内嵌 woff2（游戏常用商用中文字体授权复杂，引擎必须允许自带字体文件），渲染层 FontFace 加载 + 回退。
3. **ruby 注音**已有，补竖排？——不做（明确排除：不做日文竖排，中文市场不需要）。
4. 全角标点排版微调：对话框内标点悬挂（行末逗号视觉悬挂）。
**验收**：构造含"。」「……——"的极端文本，截图对比断行正确；字体加载失败回退系统字体不白屏。

### 支柱 5：一键商业化交付（把"能跑"变成"能卖"）

**目标**：把"能跑"变成"能交付发行"。已有：Electron 壳 + AES-256-GCM 素材加密 pack。
补强（按中国市场实际发行需求；**不含 Steam 对接，不上架 Steam**）：
1. **手柄支持**：UI 导航 + 推进/快进/存档界面手柄化（Gamepad API），桌面发行与类主机体验的基本需求。
2. **Web 试玩导出**：`surdet build --web` 产出可挂 TapTap/itch 的纯 Web 包（renderer 本就浏览器可跑，补素材打包与入口模板）。
3. **版本补丁**：pack 产物带版本号 + 增量更新清单（Electron autoUpdater 或手动补丁包），长篇游戏发售后热修刚需。
**验收**：打出的 exe 素材无法被 7zip 直接读出明文；手柄能完整走完"标题→新游戏→推进→存档→读档"；Web 包在 Chrome 跑通 starter。

### 明确不做（防止范围蔓延）

- 国际化框架、英文文档、RTL、日文竖排（市场定位是中国）
- Live2D/Spine（独立评估，不在本方案；若做，属于渲染层后端扩展，另起任务书）
- 移动端打包（iOS/Android 版号与市场成本高，先做桌面+Web）

---

## Part C · 路线图与优先级

| 里程碑 | 内容 | 产出 |
|---|---|---|
| M1（2-3 周） | E0 架构拆分 + E1a 只读导航流程图（含 collectConfigSceneRoots 下沉 core） | 编辑器可用的导航流程图 |
| M2（2 周） | 支柱 2 simulate | `surdet simulate` + starter 报告样例 |
| M3（2 周） | E1b 交互编辑流程图（拖拽建 jump / 右键重命名删除） | 流程图编辑闭环 |
| M4（2 周） | E2 素材面板 + E3 变量/成就编辑器 | 配置可视化第一批 |
| M5（2 周） | 支柱 1 AI 闭环（lint --json + hint 100%）+ 支柱 4 排版 | AI-GUIDE v2 + 断行测试 |
| M6（2 周） | E4 内嵌预览 + E5 统计 | 编辑器制作闭环完整 |
| M7（2 周） | 支柱 5 手柄 / Web 试玩 / 版本补丁 | 可发行状态 |
| 持续 | 支柱 3 cookbook、E3 剩余配置编辑器 | 文档与表单补全 |

**执行纪律**：
1. 每个阶段结束跑基线三件套（typecheck / 442 测试 / starter lint 0 警），只增不减。
2. commit 信息用中文，格式跟随现有仓库风格（`fix:` / `feat:` / `docs:` 前缀 + 一句话说明 + 分号列要点）。
3. 不新建与本方案无关的文件；过程文档（如复审任务书）不进提交。
4. 遇架构级抉择（是否引入依赖、是否动 core 导出面），在 PR 描述里写明取舍理由。

**给接手 AI 的第一条指令**：从 E0 开始。先 `git log --oneline -3` 与 `git status` 确认基线，再读 `packages/editor/src/` 全部四个源文件，然后按 E0 清单拆分，拆完立即跑基线三件套再继续。
