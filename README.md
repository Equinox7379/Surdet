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

需要 Node.js 20 或更高版本。

```powershell
npm install
npm run build
```

启动示例游戏：

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

`observe` 只读，`stage` 只写隔离 change，`apply` 必须显式恢复一个已经审核的 change。MCP 只投影共享 authoring 合同，不维护第二套业务语义。

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
| `examples/starter` | 最小示例项目与集成入口 |

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
- `seed` 已进入部分证据合同，但 `@random` 仍使用 `Math.random()`；在独立可靠性任务完成前，不宣称全链路 seeded determinism。
- 性能 baseline 是特定历史环境的资格化证据，不代表任意设备上的通用性能承诺。
- 发布、部署和远端 push 都是独立授权门，不由测试通过自动触发。
