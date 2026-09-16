# Surdet

Surdet 是一个数据驱动的桌面 Galgame 引擎，也是一套面向外部电脑 Agent 的可验证创作工具链。

它的目标不是在引擎里内置某个 AI 模型，而是让人类、CLI、编辑器和不同能力层级的桌面 Agent 共享同一套 authoring 合同：同样的对象、校验、模拟、运行证据、差异和事务边界。Agent 可以发现能力、在隔离 change 中创作并交付胶囊；真正写入项目仍由项目所有者授权。

## 核心能力

- **剧本与运行时**：类型化变量、分支/调用/标签、存档快照、可定位错误和确定性模拟证据。
- **表现层**：背景、立绘、时间轴、转场、对话、选择肢、Gallery、设置和桌面 Player Shell。
- **创作层**：共享 `@surdet/authoring` 语义、CLI、可视化 Editor、对象级差异和因果影响。
- **Agent Port**：机器可读 capability registry、MCP 薄适配、observe/stage/apply 权限、fresh evidence 与 delivery capsule。
- **可靠性边界**：原子项目变更、恢复日志、Windows 非撕裂替换、存档备份与显式恢复。

## 快速开始

需要 Node.js 24 或更高版本，与根目录 `package.json` 的要求一致。

```powershell
npm install
npm run build
```

启动示例游戏《雾港来信》（三结局短篇，附可选的自由探索）：

```powershell
npm run dev -w surdet-starter
```

启动可视化编辑器：

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

接入外部已准备好的图片时，启动参数可追加 `--asset-source <图片目录绝对路径>`（可重复）。只开放这些实际目录内的普通文件，不接受任意路径、链接跳转或下载地址。`--asset-import-data-root <导入数据目录>` 指向现有素材 authority 的独立数据区；与绑定同一项目的 Editor 使用相同目录。未显式传入时沿用 `SURDET_EDITOR_ASSET_IMPORT_DATA_ROOT`，再缺省则使用本机原素材 authority 默认数据区。

Agent 通过 `asset.sources` 发现授权来源、列目录并读取文件摘要，随后用 `asset.import.stage` 暂存和封存导入。首版支持 PNG、JPEG、WebP 的背景、立绘、头像，单张最多 32 MiB、每次最多 32 张且合计不超过 128 MiB。立绘命名继续使用 `角色_服装_表情`，实际编排标识以 `project.assets` 返回的 `key`、`timelineTarget`、`expression` 为准。

`stage` 不写项目，`asset.import.commit` 和 `asset.import.recover` 需要启动时明确选择 `--policy apply`，并遵守现有项目锁与草稿保护。收到不确定响应后，用 `asset.import.inspect` 查询原 `operationId`：未完成上传可重试原暂存请求；已封存的来源和目标不可替换；发布中断用原计划指纹恢复，返回 `ROLLED_BACK` 不等于导入成功。修正未封存计划的文件名可以使用同一操作编号。导入完成后先重新读取项目和素材事实，再 `change.begin` 创建剧情变更；不把导入塞入现有候选，也不开放素材删除、移动或撤销。

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

当前 Authoring 合同为 `2.4.0`。新 stage 候选会在操作写入前检查缺失依赖和对象单元互引环：按错误中的 `issues` 先建立被引用对象或选择基线已解析素材，再重试；互相创建空场景不能解除互引环。`session.describe.candidateReadiness` 与 `change.diff.compositionReadiness` 只说明已记录的组合事实是否完整，不替代最终 validation、simulation、runtime 和 delivery capsule 检查。旧变更缺少操作时点事实时须新建候选，已封存的 v2 capsule 继续可读。

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

`examples/shared/player` 是 Starter 与新项目模板共用的源码目录，不是独立 npm 工作区。

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

历史交付报告和已经闭合的旧任务书不再堆放在当前文档树中；需要审计时从 Git 历史读取。

## 当前边界

- Surdet 面向外部 Agent，不在引擎内部绑定或托管模型。
- 音频生产不是当前主线；真实听感仍由项目所有者判断。
- `@random` 使用解释器的随机源；带 `seed` 的模拟与显式路径运行可复用该种子。实际播放器、外部系统和自定义回调是否可重放，仍应按各自接线验证。
- 性能 baseline 是特定历史环境的资格化证据，不代表任意设备上的通用性能承诺。
- 发布、部署和远端 push 都是独立授权门，不由测试通过自动触发。
