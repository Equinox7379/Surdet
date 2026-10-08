# Wave 7：人机顺序接力

绑定同一项目的 Editor 与 Agent 共用工作区状态和短期项目写租约。打开 Editor、维持连接或查看项目不会长期占用项目写锁。

## 行为

- 本文的 Wave 7 初版基于 Authoring `2.2.0`；当前创作合同版本见 [AI-GUIDE](AI-GUIDE.md)。下述工作区读取入口不增加 Agent Port 能力，也不改变 Review 格式。
- `session.describe` 返回工作区是否干净、繁忙、阻断或不存在，不返回草稿正文、文件句柄或绑定凭据。
- Agent 在项目写租约内、审批绑定与项目写入之前检查人类工作区。未保存修改会拒绝提交；丢弃草稿且磁盘未变后可重试同一 change。人类保存后，旧 change 按原有规则失效。
- 绑定 Editor 的文件发布经 Node authority 完成，校验读取时的项目基线和逐文件 SHA。过期写入不能绕回浏览器直接覆盖文件；发生冲突时保留草稿。
- 外部变更只显示提示。查看变化会比较完整文本基线并重新读取素材信息；显式同步才重载项目，保留仍有效的场景、时间轴、工作区和对象选择，并重建预览。
- 非绑定 Editor 保留原有本地编辑能力，显示“接力保护未接入”。

## 当前项目的审阅任务发现（后端接口）

这两个只读入口挂在已有项目绑定服务，Windows 桌面宿主也沿用同一服务；本单元不增加界面、角标或自动打开行为。只能读取当前绑定项目在现有 Agent 数据目录内的正式审阅工作区，普通 direct 草稿/胶囊不会因此成为正式候选或批准结果。

前端先完成既有项目绑定与 workspace heartbeat。请求仍为同源 JSON，携带现有 `x-surdet-asset-import-authority` 与 `x-surdet-project-binding` 请求头；不能把这里的读取权限当作审阅决定、批准或写回权限。

| POST 路径（前缀 `/__surdet/project-asset-import/v1/workspace/`） | 请求 | 成功 `data` |
| --- | --- | --- |
| `review-tasks` | 当前工作区状态 | `{ projectIdentity, tasks, pendingCount }` |
| `review-content` | 当前工作区状态，加 `request: { reviewId, kind, path }` | 沿用 `PreparedReviewContent`：目录 `{ kind: "directory", entries: [{ name, kind }] }`；文件 `{ kind: "file", base64 }` |

当前工作区状态的必需字段为 `workspaceSessionId`、`browserSessionId`、`workspaceGeneration`、`availability`、`dirtyScopes`、`busyReasons`、`blockedReasons`；后三个数组在为空时也必须提供。`loadedProjectRevision`、`loadedCoordinationRevision` 沿用既有可选字段。请求不接受项目路径、项目身份或额外字段，由服务端绑定决定范围；也不需要为这些读取申请写租约。

每个 `tasks` 条目为 `{ reviewId, kind, status, receiptFiles, errorCode? }`，按 `reviewId` 排序：

- `kind` 是 `comparison` 或 `integration-result`；身份元数据无法读取时为 `null`。
- `status: "pending"` 表示元数据/正文文件存在，且尚无终态回执文件；**不保证正文可通过正式审阅校验或来源基线仍然新鲜**。`pendingCount` 仅统计这些条目。
- `status: "receipt-present"` 只表示存在对应的回执文件，**不表示回执有效、已经批准或完成写回**。`receiptFiles` 列出实际文件名，正式状态仍由原审阅终态服务核对。
- `status: "unavailable"` 保留损坏、缺文件、身份不符或链接目录对应的条目，附 `errorCode`，不会让一个坏条目隐藏其他健康任务。不要将其伪装成“无待审任务”或自动删除。

没有审阅目录时返回空列表，不创建目录。刷新会重新读取目录，不维护第二份长期索引，不自动迁移已移动项目的记录。列表只作发现线索，不替代当前工作版本、正式封存结果和批准链的原有区别。

读取内容时，`kind` 只能是 `file` 或 `directory`；`path` 是审阅根目录下的相对路径，读取根目录使用 `kind: "directory", path: ""`。入口复用现有审阅内容白名单：身份、对应的审阅正文/回执，以及结果审阅的 `result/project`；不能读取任意本机文件、跨项目目录或链接目标。前端可以据此接到现有只读审阅文件读取器，随后仍走原审阅加载、终态核对、切换和关窗保护，不能绕过草稿/未明回执保护自动切换任务。

失败沿用 `{ ok: false, error: { code, messageKey, retryDisposition, ... } }`：绑定或来源不匹配为 403；字段或路径无效为 400；审阅/文件已移走为 404；工作区会话过期、审阅身份不符为 409。读取会话失效时停止复用旧会话，不改用任意目录读取。前端须在切换项目/工作区后丢弃迟到响应；重新进入审阅时再次读取，不把发现列表当作内容快照。

## 主要落点

- `packages/authoring/src/human-workspace-contract.ts`：公共状态合同。
- `packages/cli/src/authoring/`：工作区记录、提交前置检查、协调基线和变更通知。
- `packages/cli/src/editor-workspace-authority/`：短期写租约和受保护的文件发布。
- `packages/cli/src/asset-import-authority/`：沿用绑定 HTTP 权限边界，接入资产、迁移与场景操作的共享租约。
- `packages/editor/src/editor-workspace.ts`、`project-io.ts`、`main.ts`：完整草稿状态、保存保护、外部变化和显式同步。

## 真实接力验证

先使用仓库现有构建，再运行：

```sh
node packages/cli/e2e/human-agent-relay-wave-7.e2e.mjs
```

Runner 复制现代 Starter 到系统临时目录，复用现有 Review 与 Agent Port 工具，使用同一协调数据目录。Windows 可为本次进程将 `TEMP`、`TMP` 指向 D 盘。原始 Starter 和正式项目不作为写入目标。

覆盖四条流程：

1. 两候选比较、人工批准、Agent 提交、显式同步、人类保存、Agent 重新读取。
2. 人类草稿阻断 Agent；项目和 change 既有记录不推进；显式丢弃后重试同一 change。
3. 人类保存使旧 change 失效；Agent 重新检查并创建新 change 后成功。
4. Agent 通过干净检查后再发生人类输入；Agent 完成提交，而 Editor 旧基线保存被拒绝，双方内容均保留。

Runner 检查页面异常、HTTP 和进程清理。预期网络结果仅包括第 4 条的 `workspace/begin` 409，以及已移除预览 iframe 的导航取消；其他失败不作忽略。提交拒绝允许既有 invocation 审计追加，不允许审批绑定、stage、journal 或项目数据推进。

回归使用现有 Authoring、CLI、Editor 测试、资产 authority 与 V4 浏览器 runner，以及根级 `verify:all`。当前约定禁止 Luna 审核和收口，由主代理亲自复核；完成后停在等待云端独立终审。
