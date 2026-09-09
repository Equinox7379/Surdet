# Wave 7：人机顺序接力

绑定同一项目的 Editor 与 Agent 共用工作区状态和短期项目写租约。打开 Editor、维持连接或查看项目不会长期占用项目写锁。

## 行为

- Authoring 合同为 `2.2.0`；envelope、capsule 和 Review 格式保持原版本。
- `session.describe` 返回工作区是否干净、繁忙、阻断或不存在，不返回草稿正文、文件句柄或绑定凭据。
- Agent 在项目写租约内、审批绑定与项目写入之前检查人类工作区。未保存修改会拒绝提交；丢弃草稿且磁盘未变后可重试同一 change。人类保存后，旧 change 按原有规则失效。
- 绑定 Editor 的文件发布经 Node authority 完成，校验读取时的项目基线和逐文件 SHA。过期写入不能绕回浏览器直接覆盖文件；发生冲突时保留草稿。
- 外部变更只显示提示。查看变化会比较完整文本基线并重新读取素材信息；显式同步才重载项目，保留仍有效的场景、时间轴、工作区和对象选择，并重建预览。
- 非绑定 Editor 保留原有本地编辑能力，显示“接力保护未接入”。

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
