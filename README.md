# Surdet

Surdet 是一个数据驱动的桌面 Galgame 引擎，也是一套面向外部电脑 Agent 的可验证创作工具链。

Surdet is a data-driven visual novel engine with a shared authoring toolkit for people and external AI agents. It provides a visual editor, a player runtime, and permission-scoped CLI/MCP tools without requiring a built-in AI model. Windows is the current supported validation target.

它的目标不是在引擎里内置某个 AI 模型，而是让人类、CLI、编辑器和不同能力层级的桌面 Agent 共享同一套 authoring 合同：同样的对象、校验、模拟、运行证据、差异和事务边界。Agent 可以发现能力、在隔离 change 中创作并交付胶囊；真正写入项目仍由项目所有者授权。

## 核心能力

- **剧本与运行时**：类型化变量、分支/调用/标签、存档快照、可定位错误和确定性模拟证据。
- **表现层**：独立人物姿态、可校准舞台、多层场景与视差、可复用时间轴片段，以及转场、对话、选择肢、Gallery、设置和桌面 Player Shell。
- **创作层**：共享 `@surdet/authoring` 语义、CLI、可视化 Editor、对象级差异和因果影响。
- **Agent Port**：机器可读 capability registry、MCP 薄适配、observe/stage/apply 权限、fresh evidence 与 delivery capsule。
- **可靠性边界**：原子项目变更、恢复日志、Windows 非撕裂替换、存档备份与显式恢复。

## 快速开始

需要 Node.js 24 或更高版本，与根目录 `package.json` 的要求一致。

当前主要验证 Windows 上的编辑器、桌面游戏和 Chrome/Edge 浏览器路径，不承诺其他操作系统已经验收。

```powershell
npm install
npm run build
```

启动示例游戏《雾港来信》（三结局短篇，附可选的自由探索）：

```powershell
npm run dev -w surdet-starter
```

启动独立 Windows 编辑器（首次先完成上面的工作区构建）：

```powershell
npm run desktop:build -w surdet-editor
npm run desktop -w surdet-editor
```

本地可运行目录可用 `npm run desktop:pack -w surdet-editor` 生成，位于 `packages/editor/release/editor/win-unpacked/`。保留整个目录，双击其中的 `Surdet Editor.exe`；使用者不需要另装 Node、启动服务或打开浏览器。应用中选择游戏项目即可编辑、保存和试玩；打开其他项目使用独立窗口，同一项目重复打开会回到已有窗口。关闭有未保存修改的窗口会询问，正在保存或恢复时不能强行关闭。重启会重新打开上次的项目，并沿用现有剧本/时间轴自动备份恢复机制（不承诺所有配置草稿都有自动备份）。

这是桌面首个可用版本，沿用当前界面；未签名、未作为正式安装包发行。前端重新设计另行进行。已有浏览器开发入口继续保留：

```powershell
npm run dev -w surdet-editor
```

在 Chrome 或 Edge 中打开编辑器地址，再选择一个 Surdet 项目目录。请优先使用项目副本完成试验，不要直接拿唯一的正式项目做第一次操作。

## 外部 Agent 创作

先构建 Authoring 与 CLI：

```powershell
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
```

Agent Port 的正式入口为：

```powershell
node packages/cli/dist/agent-port/main.js --project <项目目录> --policy stage
```

接入外部已准备好的素材时，启动参数可追加 `--asset-source <素材目录绝对路径>`（可重复）。只开放这些实际目录内的普通文件，不接受任意路径、链接跳转或下载地址。`--asset-import-data-root <导入数据目录>` 指向现有素材 authority 的独立数据区；与绑定同一项目的 Editor 使用相同目录。未显式传入时沿用 `SURDET_EDITOR_ASSET_IMPORT_DATA_ROOT`，再缺省则使用本机原素材 authority 默认数据区。

Agent 通过 `asset.sources` 发现授权来源、列目录并读取文件摘要，随后用 `asset.import.stage` 暂存和封存导入。支持 PNG/JPEG/WebP 图片、WAV/OGG/MP3 声音、MP4/WebM 视频、TTF/OTF/WOFF2 字体及 UTF-8 许可证/说明；每文件最多 32 MiB、每批 32 项且合计不超过 128 MiB，许可文本另限 1 MiB。入口检查文件格式，不保证任意编码均可在目标环境播放。立绘自动发现继续使用 `角色_服装_表情`，实际编排标识以 `project.assets` 返回的 `key`、`timelineTarget`、`expression` 为准。详细格式、用法与限制见 [AI 指南](docs/AI-GUIDE.md)。

`stage` 不写项目，`asset.import.commit` 和 `asset.import.recover` 需要启动时明确选择 `--policy apply`，并遵守现有项目锁与草稿保护。收到不确定响应后，用 `asset.import.inspect` 查询原 `operationId`：可继续的上传重试原暂存请求；若进程中断留下上传恢复屏障，检查错误中的 `recoveryAction=discard-unpublished`，用原 `operationId` 与返回的 `manifestFingerprint` 调用 `asset.import.recover`，安全放弃该次未封存上传，收到 `ROLLED_BACK` 后再用新编号导入。该恢复不会写项目素材，无法确认归属的暂存文件仍保留并报错。已封存的来源和目标不可替换；发布中断继续用原 `planFingerprint` 恢复，返回 `ROLLED_BACK` 不等于导入成功。修正未封存计划的文件名可以使用同一操作编号。导入完成后先重新读取项目和素材事实，再 `change.begin` 创建剧情变更；不把导入塞入现有候选，也不开放任意素材删除。

现有素材移动/改名用 `asset.relocation.plan`，同路径内容替换用 `asset.relocation.replace`；先核对计划和实际引用，再在 apply 会话发布。它们复用已有整理事务、恢复和撤销，不借导入覆盖旧文件，不进入剧情 change；Editor 素材详情提供同一入口。

客户端超时不表示服务端已经停止。`asset.import.inspect` 包含持久状态协调，仍需同会话排队和项目租约；长调用期间可先用不经过该调用队列的 `session.describe` 查看会话与租约状态，再查询原操作。进程退出后，现有 15 秒租约窗口内可能返回 `PROJECT_BUSY`，窗口结束后再查询、按结果恢复；不要因等待创建替代编号或手动删除锁、恢复屏障。

图像导入后，可以用 `project.gallery` 读取 CG 条目及当前指纹，在隔离 change 中调用 `gallery.cg.create` 新增条目，或用 `gallery.cg.patch` 逐条修改 `name` / `src`。`src` 使用 `project.assets.backgrounds[].key`；省略时使用 CG 的 `id`，修改时传 `src: null` 恢复这一规则。其他 CG、音乐、文本回想及未修改字段会保留，不提供删除或 ID 改名。

在剧情中使用 `@unlock_cg <id>` 解锁对应条目。候选应先建立 CG，再编排引用它的剧情；不同条目可组合，同一条目的不同修改需要明确选择。CG 解锁遵循既有存读档状态，不是跨周目永久收集。`surdet new` 的播放器会读取可选的 `content/config/gallery.json`，不需要另外接入鉴赏界面。

推荐工作流：

```text
能力发现
→ 建立隔离 change
→ 类型化创作
→ validation / simulation / runtime trace
→ object diff / causal impact
→ delivery capsule
→ 人类复核
→ 另行授权 apply
```

`observe` 不修改项目文件；恢复 change 后的校验与模拟可以在 change store 追加证据。`stage` 只写隔离 change。`apply` 是启动时由操作者授予的项目写权限：普通 change 可在该会话创建或通过 `--resume-change` 恢复，并在证据门通过后提交；integration change 还必须有最终人类批准回执。推荐按上面的流程先复核，再另行启动 apply。MCP 只投影共享 authoring 合同，不维护第二套业务语义。

要试玩尚未写回的工作变更，用绑定项目的 Editor 入口启动，再在页面打开同一个项目目录：

```powershell
npm run dev:project -w surdet-editor -- --project <项目目录绝对路径>
```

Editor 和 Agent Port 必须绑定同一个项目；若自定义了 `SURDET_AGENT_DATA_DIR`，两者也应使用同一个目录。进入“预览”，从“试玩内容”选择工作变更、封存候选或组合结果；列表未更新时点击“刷新试玩列表”。工作变更可以在原 change 中继续修改，再点击“重新播放”加载当前版本；封存候选和组合结果按各自封存身份打开。

播放后通过公开 `runtime.read-preview` 能力读取实际观察，先核对返回的内容身份、版本和 `status`，再定位返修对象。观察中的运行和表现事实不能替代截图。页面的“回到上次位置”沿已记录的真实选择重新播放；选择或目标不再匹配时会停下，需正常重选。试玩不批准、不写回，也不会保存或丢弃来源草稿。

当前 Authoring 合同为 `2.35.0`（73 项能力），direct 草稿支持 `gallery.policy.patch` 明确开启图片/音乐/回想/结局/人物/用语的跨周目收藏、`gallery.text.create` / `gallery.text.patch` 配置安全回想入口与初始变量、`gallery.ending.create` / `gallery.ending.patch` 编写结局册名称与说明、`gallery.profile.create/patch` / `gallery.term.create/patch` 编写逐段解锁的人物档案与用语辞典、`scene.rename` 同步改名引用、`scene.move` 按章节整理、`project.player-config.patch` 配置字体/字标、`project.theme-config.patch` 配置作品主题、`project.ui` / `project.ui.patch` 读取和修改作品界面，以及 `character.ensure.portraits` 绑定静态立绘、`character.ensure.visuals` 配置分层立绘与逐帧动画；字体许可证可作为 `license` 与素材同批导入。Editor 的「界面设计」可视化接管同一配置并试玩未保存稿；普通项目无需修改启动源码。完整差异与获授权写回仍走原事务。新 stage 候选会在操作写入前检查缺失依赖和对象单元互引环：按错误中的 `issues` 先建立被引用对象或选择基线已解析素材，再重试；互相创建空场景不能解除互引环。`session.describe.candidateReadiness` 与 `change.diff.compositionReadiness` 只说明已记录的组合事实是否完整，不替代最终 validation、simulation、runtime 和 delivery capsule 检查。旧变更缺少操作时点事实时须新建候选，已封存的 v2 capsule 继续可读。

Editor「统计」中的剧情检查可检查当前剧本和时间轴草稿，列出实际访问、条件结果、预算停止与运行错误，并按对应内容版本跳回源稿。真实试玩记录与自动模拟分别显示；手动诊断导出只包含版本、位置和计数，不包含剧情正文、变量值、原始错误详情或画面快照。`project.simulate` 同样返回结构化 `coverage`，失败与预算耗尽时保留在错误的 `details.report`；这不是无限全路径证明，也不替代真实试玩。

作品界面可按剧情变量显示/隐藏或禁用组件，以只读数值条呈现好感、体力等状态，以数组列表/数量呈现随身物品，并用有限赋值按钮开关小面板。Editor 和公开工具共用同一配置；轻交互不额外执行剧情，状态沿普通存档恢复，不另建物品系统。用法见 [AI 创作指南](docs/AI-GUIDE.md)。

多语言作品使用同一文本目录和 CSV 流程登记正文、选项、人物显示名、自定义界面文字及词条，并按对白键与语言关联已有配音。共享 Player 在「设置 → 显示与输入 → 作品语言」切换语言，保持剧情进度；偏好随设备保存，读档沿用当前语言。缺译文显示原文，缺失/过期配音允许无声阅读，不猜对应。Editor「文本与译稿」可导出、预览和确认配音清单，直接试玩已保存内容；具体范围及改稿规则见 [AI 创作指南](docs/AI-GUIDE.md#文本目录与译稿-csv)。

新舞台通过 `project.inspect.stageConfig` 读取、`project.stage-config.patch` 在 direct 草稿修改；旧项目不必启用。人物姿态、环境图层和有限复用片段走原场景/时间轴能力；candidate 可引用基线配置，但不能伴随改写舞台配置。Editor 临时摆放确认后才进入普通草稿，校准/构图参与原撤销与保存全部，工作预览消费未保存版本，不将临时画面冒充封存结果。

已有纯文本/CSV 稿件可先通过只读 `script.import.preview` 映射列与角色、核对逐行问题，再用原 `scene.create` 创建新草稿；Editor 的“导入剧本”与其共享同一转换，不覆盖原场景、不执行导入文字中的指令。批量搜索替换先预览全部差异，确认后仍走原撤销与保存。

## 工作区

| 工作区 | 职责 |
|---|---|
| `packages/core` | DSL、解释器、状态与存档公共语义 |
| `packages/authoring` | 项目快照、类型化操作、校验、模拟与事务 |
| `packages/cli` | Node 适配、命令行与 Agent Port |
| `packages/renderer` | 表现运行时与渲染命令/查询 |
| `packages/host` | Player Shell 与宿主协调 |
| `packages/shell` | Electron、文件存储与发行壳 |
| `packages/editor` | 可视化创作界面 |
| `examples/starter` | 《雾港来信》示例游戏与可选系统玩法 |
| `examples/zero-after-midnight` | 《零点之后》，保留独立玩家入口的正式游戏 |
| `games/*` | 独立游戏工作区，目前包含 `tide-mark` |

`examples/shared` 提供 `@surdet/player` 工作区，直接编译 Starter 与新项目共用的 Player 源码，不复制菜单或存档实现。新项目通过包入口引用，旧作品的源码引用保持可用。

新建时默认保留源码仓库内的 `games/<name>` 路径；`surdet new <name> --directory <独立目录> --template blank` 可创建空白独立项目，省略模板则为短篇示例。独立 CLI 在没有引擎仓库时默认创建当前目录下的 `<name>`，不把其他 npm workspace 当成引擎。项目自带类型配置；共享运行时从声明的包版本读取。当前可使用本地 `npm pack` 归档安装 Core、Renderer、Host、Player、Authoring、CLI，再执行项目自身的检查/构建；这不代表这些包已经公开发布，也不等于 P10 作者发行版完成。构建的 `dist/` 用独立静态 HTTP 服务运行，不要求原开发服务。

## 验证

日常修改按风险选择聚焦测试。跨工作区收口时使用：

```powershell
npm run verify:all
```

常用聚焦命令：

```powershell
npm run test -w @surdet/authoring
npm run test -w @surdet/cli
npm run typecheck -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run verify:docs
npm run verify:editor-save-load
```

测试绿灯不能替代玩家对画面、声音和交互手感的判断。

## 文档入口

从 [文档索引](docs/README.md) 开始。最常用的权威资料是：

- [DSL 规范](docs/dsl-spec.md)
- [架构说明](docs/architecture.md)
- [能力矩阵](docs/capability-matrix.md)
- [当前限制](docs/known-limitations.md)
- [Agent 创作指南](docs/AI-GUIDE.md)
- [Renderer v2 迁移指南](docs/renderer-v2-migration.md)
- [当前路线与决策台账](docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md)

历史交付报告和已经闭合的旧任务书不再堆放在当前文档树中；需要审计时从[历史资料索引](docs/archive/README.md)进入固定版本原文。

## 当前边界

- Surdet 面向外部 Agent，不在引擎内部绑定或托管模型。
- 音频生产不是当前主线；真实听感仍由项目所有者判断。
- `@random` 使用解释器的随机源；带 `seed` 的模拟与显式路径运行可复用该种子。实际播放器、外部系统和自定义回调是否可重放，仍应按各自接线验证。
- 性能 baseline 是特定历史环境的资格化证据，不代表任意设备上的通用性能承诺。
- 发布、部署和远端 push 都是独立授权门，不由测试通过自动触发。

## 许可证与开源准备

Surdet 自有引擎源码及技术文档采用 [MIT 许可证](LICENSE)。第三方依赖和作品的剧情、图片、音频、视频、字体等分别遵循自己的授权，不自动适用引擎许可；详见[第三方与素材说明](THIRD_PARTY_NOTICES.md)。使用引擎不要求作者将自己的游戏一并开源。

目前处于开源准备阶段，正式公开安排在前端优化完成之后；不把开发中的演示素材、既有测试通过或本机可运行等同于正式发行完成。
