# Surdet Stage 6 / Wave 6 Human-Agent Review Workbench 交付报告

日期：2026-08-30
任务书：`docs/superpowers/plans/2026-08-26-human-agent-review-workbench-stage-6-wave-6.md`

## 1. 结论与停止状态

Wave 6 已在本地完成以下闭环：候选方案比较、人类决定回执、reviewed plan、隔离 stage、结果审阅、最终批准回执、隔离 apply，以及针对真实验收发现的可理解性、回执持久化、配置换行保留和保存按钮布局修复。

~~~text
STAGE_6_WAVE_6_HUMAN_AGENT_REVIEW_WORKBENCH_VERIFIED = YES
AUTOMATED_GATES_PASSED = YES_WITH_RECORDED_PARALLEL_CAPACITY_BOUNDARY
FORMAL_PASSED = YES
EXTERNAL_AGENT_ACCEPTANCE_PASSED = YES
OWNER_COMPARISON_ACCEPTANCE_PASSED = YES
DELEGATED_RESULT_TECHNICAL_ACCEPTANCE_PASSED = YES
ISOLATED_APPLY_PASSED = YES
ORIGINAL_STARTER_UNCHANGED = YES
REPOSITORY_PUSH = NOT_PERFORMED
WAVE_7 = NOT_STARTED
~~~

本结论不等价于发行、部署、正式游戏项目迁移或商业发布批准。仓库远端推送仍需项目所有者单独授权。

## 2. 已验证事实

- Authoring 统一拥有 working-object fingerprint、review projection、决定/批准回执校验、reviewed integration plan 与 approval-aware commit gate 的语义。
- CLI 通过 Node review store、Agent Port capability、不可变 review workspace 和隔离 preview fixture 提供机械投影；Agent 无写人类决定或批准回执的能力。
- Editor 能打开 comparison/result review workspace，以中文展示相同结果、冲突、依赖、来源与技术身份，并只在用户明确操作后写入 create-only 回执。
- A/D 的 `scene:wave5_alpha` 与 `variable:flag.alpha` 相同子组均保留双来源 provenance；C 的不同场景结果保持显式冲突并可被精确排除；B 的 `beta_opening` 通过依赖闭包隐式纳入。
- 决定与批准回执在关闭并重开后保持同一 ID、fingerprint、选择和只读状态；并发、stale、错误 review identity 与失败恢复均 fail-loud。
- `game.config.json` 的共享写入路径现在保留源文档 CRLF/LF 风格；真实隔离 apply 后的配置仍为 CRLF，未出现全文件换行噪音。
- “保存我的决定”操作区已回到正常文档流，不再 sticky/fixed 浮在审阅内容上。
- 最终 apply 只修改桌面隔离项目 `<local-path>`；仓库内原始 Starter 未变。

## 3. 项目所有者报告的视觉与交互事实

以下为项目所有者亲自操作 Editor 后提供的一手事实，不以自动化测试冒充：

- comparison 页面中的 A/C 差异内容可以辨认；相同结果能够展示多个来源。
- 保存决定后，重开能够读取原决定、保持原选择，相关控件只读。
- 保存按钮布局修复后位置正常，不再随视口悬浮遮挡内容。
- Owner comparison 验收结论为通过。

replacement result review 的最终批准由项目所有者明确委托给经理执行技术验收；没有伪造为 Owner 视觉验收。技术验收核对了 Alpha A、C 排除、Beta timeline、fresh evidence、配置 EOL、回执重开与项目不变性。

## 4. 尚未验证或不能外推的结论

- 未执行正式部署、发行打包、生产环境或商业发布验收。
- 未把隔离 apply 结果写入原始 Starter、仓库示例或任何真实游戏项目。
- 后期 UI 的视觉风格与“AI 感”仍需独立产品设计轮次；本 Wave 只修复可理解性和明确的按钮布局缺陷。
- 默认并行 `verify:all` 在后期恢复轮次出现过仅 timeout 的失败。严格串行 CLI 全量与相关聚焦门通过，支持并行容量争用判断，但尚未完成基础设施根因归因。因此不能把那次 recovery `verify:all` 改写为 PASS。
- 本报告不授权 push，也不自动启动 Wave 7。

## 5. 共享层、CLI 与 Editor 架构落点

### Authoring

- `packages/authoring/src/review-contracts.ts`：稳定 review/decision/approval 合同。
- `packages/authoring/src/review-projection.ts`：comparison/result 的共享人类可读投影。
- `packages/authoring/src/review-receipts.ts`：create-only 回执、fingerprint 与 freshness 校验。
- `packages/authoring/src/integration-plan.ts`、`integration-execution.ts`：reviewed plan、单次 replay 与 provenance 保留。
- `packages/authoring/src/change-session.ts`：批准检查先于 staging/journal/project replacement。
- `packages/authoring/src/config-document.ts`：共享配置解析及源 EOL 保留序列化。

### CLI / Agent Port

- `packages/cli/src/authoring/review-store.ts`：Node review workspace 与不可变 artifact。
- `packages/cli/src/authoring/review-service.ts`：prepare/inspect 与 approval-aware facade。
- `packages/cli/src/agent-port/session.ts`：review 等待状态、next actions 与策略过滤。
- `packages/cli/src/authoring/composition-service.ts`：只枚举合法 `chg_` change namespace，避免把 `reviews/` 当作 change。

### Renderer

- `packages/renderer/src/layers/dialogue/dialogue-layer.ts`：说话人优先按稳定 ID 解析，并只为不歧义的显示名建立别名；画面显示本地化角色名，未知或重名显示名不被猜测绑定。
- `packages/renderer/test/legacy/dialogue-layer.test.ts`：永久覆盖稳定 ID、唯一显示名、未知显示名、重名以及 ID/显示名冲突时 ID 优先。

### Editor

- `packages/editor/src/review-workspace.ts`：打开 review workspace、读取持久回执、写入 create-only 决定/批准。
- `packages/editor/src/review-panel.ts`：中文任务、相同来源、冲突选项、技术详情与只读回执呈现。
- `packages/editor/src/styles.css`：审阅布局和非悬浮保存操作区。

## 6. RED -> GREEN 与当前新鲜验证

Wave 6 主任务按 Task 1–10 建立并保留 RED/GREEN、DIAGNOSTIC 与 FORMAL 证据；所有失败 artifact 均保留。后续真实验收发现的修复也均先建立定向失败证据，再以永久测试闭合。

本次最终仓库收口的新鲜验证：

| 范围 | 结果 |
| --- | --- |
| Authoring EOL 聚焦 | 3 files / 48 tests PASS |
| Authoring 严格串行全量 | 30 files / 262 tests PASS |
| Authoring typecheck / build | PASS / PASS |
| CLI typecheck / build | PASS / PASS |
| Renderer speaker 聚焦（Recovery-9） | 2 files / 24 tests PASS |
| Renderer 全量（Recovery-9） | 50 files / 413 tests PASS |
| Renderer typecheck / build（Recovery-9） | PASS / PASS |
| Editor review 聚焦 | 4 files / 40 tests PASS |
| Editor 严格串行全量 | 33 files / 223 tests PASS |
| Editor typecheck / build | PASS / PASS |

主要后续修复提交：

- `e6ae69cbadbbae2ac941899a091e9de6bb9e8eda`：保留 result review 回执、绑定 approval fingerprint、重开只读。
- `faf874c0677f6c6a70b38c325ddf228ee46ee828`：让 Owner 能辨认相同来源与 A/C 内容差异。
- `f771848ccb23984d7810487d67a0c623122fa77b`：保留 `game.config.json` 原始换行风格。
- `b2a795e18a3ed97d724acec8c211bb2dc35eb686`：固定保存操作区布局并加入永久测试。

## 7. verify:all、DIAGNOSTIC 与 FORMAL 证据边界

- Task 9 唯一正式 `verify:all`：PASS；artifact 70,824 bytes，SHA-256 `06E9B2FB3C787C0AF936720643FCB8E6196C05626E09484B816BD85FEA8A489B`。
- 结果回执完整性修复后的唯一 recovery `verify:all`：FAIL，全部为默认并行环境 timeout；日志 49,433 bytes，SHA-256 `4D610AA792722BD1952B8EBDB4379C0BA1BCFE1434899117374D9A1F0414D680`。该事实保持失败，不用串行绿灯覆盖。
- 主 Wave 6 replacement FORMAL：22/22 PASS，`runHead=e6ae69cbadbbae2ac941899a091e9de6bb9e8eda`；evidence 308,338 bytes，SHA-256 `67F73D6CB80AEDA1683DDD2D572C91B04771FDFC92C74B36393CF790A859CFEF`；identity 222 bytes，SHA-256 `034A7869F9F04F5EE357611C1BF819D7F140B415E015C0C11AAC8D90B95610D5`。
- Owner 可理解性 focused FORMAL：11/11 PASS，`runHead=faf874c0677f6c6a70b38c325ddf228ee46ee828`；evidence 54,888 bytes，SHA-256 `7B78F7C0654C0251AC2FB5DAC40A109A2B71C5946B6CE93797D44111866A82D4`；identity 233 bytes，SHA-256 `E4715581AB06210CEC610342D1ED0D7BC5660AAE467D3E6F58468E64358CAC47`。
- 早期失败与超额 recovery 的治理事实、每份 artifact path/bytes/SHA、最后通过节点和首个失败节点，完整保留在 Execution Ledger；本报告不删减或重写历史红灯。

## 8. 外部 Agent、Owner 与 isolated apply

最终使用的 acceptance root：

`<local-path>`

关键事实：

- policy 为 `stage` 的外部 Agent comparison 阶段通过；没有 integration change、decision、plan、execute 或项目 mutation。
- Owner 决定保存、重开、原选择和只读控件通过人工验收。
- reviewed plan 为 `pln_c172eb603f9f593ab48542da850b4be5`；replacement integration change 为 `chg_0001_e2f5fd21-7564-4c2b-bdfd-6e3efd741532`。
- fresh result review 为 `review_result_c3899202a53a4a2baaec01fc1fe421cc`。
- fresh delegated approval 为 `approval_manager_refresh_ac9187a0-7ae9-43f3-90d2-3b974d2260a5`；approval receipt 1,479 bytes，SHA-256 `31C9476A8C9C27255EF5E109AD29383C24C5CDF91901070CB6890A1540DDDE07`。
- 隔离 apply 通过公共 apply-policy Agent Port 完成，提交四个项目文件：`wave5_alpha.gal`、`wave5_beta.gal`、`beta_opening.json`、`game.config.json`。
- apply evidence：`<local-path>`，8,660 bytes，SHA-256 `5E9C1CE81F799266A4F842B4146AC89EAA040F003637542041CD14B14DA42690`。
- apply identity：同目录 `identity.json`，211 bytes，SHA-256 `441555409C817F7037C4E65EB8771CCEE9DA90A8378DC5C255B639DCCB3F986F`。
- apply 后 fixture：40 files / 6,706,275 bytes / tree SHA-256 `33887C529073460E4185938573059E77761BC621236B7BFCE8C50599DBD3A17E`。
- 原始 Starter：37 files / 6,705,750 bytes / tree SHA-256 `8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6`，前后不变。

隔离 apply 前的三个 fail-closed 尝试均未修改项目：跨盘路径 guard 误判、diff evidence 刷新导致旧批准 stale、以及多传 schema 字段导致 MCP 边界拒绝。三份失败 artifact 均保留并记录在 Execution Ledger。

## 9. 文件与提交范围

Wave 6 主提交链：

| 身份 | 提交 |
| --- | --- |
| WORKING_FINGERPRINT_HEAD | `05784d387e5da1d01a3e1cd7eb80c1e5780ef048` |
| REVIEW_PROJECTION_HEAD | `23656e7dc47e0945c56d22dc1432463bf1dc8940` |
| REVIEW_DECISION_HEAD | `c98e4eadb5c681ec531b5f2e7c66ac5f9f219dc5` |
| REVIEW_APPROVAL_GATE_HEAD | `1223d7d2e0fbd553abd03e5eac21b5403985183b` |
| NODE_REVIEW_STORE_HEAD | `0a9084b0dfc39d8c9f6e1c0269c156672dddf146` |
| REVIEW_CAPABILITY_HEAD | `2e6fd6bc1ff38dc49fb07b973f764097aa9f7028` |
| EDITOR_REVIEW_WORKSPACE_HEAD | `d4b26c36dfa9f82a0b6e364ad7cf8ba782747ce1` |
| EDITOR_REVIEW_UI_HEAD | `deaf74a64024b91e46cc750822295e0f9c2ce739` |
| ORIGINAL_CODE_EVIDENCE_HEAD | `5f796620736a4264f1d65e5baec56f55f76685f8`（包含 Renderer 稳定说话人 ID 修复及永久测试） |
| RECEIPT_INTEGRITY_CODE_EVIDENCE_HEAD | `e6ae69cbadbbae2ac941899a091e9de6bb9e8eda` |
| OWNER_COMPREHENSIBILITY_HEAD | `faf874c0677f6c6a70b38c325ddf228ee46ee828` |
| CONFIG_EOL_HEAD | `f771848ccb23984d7810487d67a0c623122fa77b` |
| REVIEW_ACTION_LAYOUT_HEAD | `b2a795e18a3ed97d724acec8c211bb2dc35eb686` |

`FORMAL_RUN_HEAD` 分别绑定对应冻结代码证据：主 replacement FORMAL 绑定 `e6ae69c...`，可理解性 focused FORMAL 绑定 `faf874c...`。后续配置 EOL 与布局小修使用聚焦、串行全量、typecheck/build、真实 replacement stage/result/apply 与 Owner 视觉事实闭合，没有冒充为对旧 FORMAL 的重跑。

`DOCUMENT_CLOSURE_HEAD` 与 `FINAL_HEAD` 由提交后 Git/磁盘回读给出，不在包含自身的文档中预写不可自洽的提交哈希；权威值记录在任务书 post-commit Execution Ledger 与经理最终回报。

## 10. Git、remote 与 ahead/behind

文档创建前：

~~~text
BRANCH = main
HEAD = b2a795e18a3ed97d724acec8c211bb2dc35eb686
REMOTE_MAIN = f8943c293c4537b3867cc8eeea316b19bb4a0b40
AHEAD_BEHIND = 15/0
STAGING_AREA = EMPTY
PUSH = NOT_PERFORMED
~~~

受保护文件、历史 handoff、CLI artifacts、设计目录和无关未跟踪文件均未进入 Wave 6 提交。构建产物未被纳入提交。

## 11. 未解决问题与非阻断建议

1. 默认并行全仓门的 timeout 容量风险仍开放；建议在独立基础设施轮次测量 worker 数、进程创建与 I/O 压力，不在本 Wave 随意放宽测试 timeout。
2. Editor 的整体视觉风格与低门槛产品化仍有提升空间，但不属于本轮审阅语义与安全合同。
3. 本地 Editor 使用保留端口 `4175`；`4173` 留给相邻项目。端口约定应在后续开发脚本治理中固化，避免跨项目抢占。
4. 当前 acceptance root 是可删除的隔离验收资产，但本轮不执行清理，以保留审计证据。

## 12. 建议登记的项目事实

- Wave 6 的人类审阅底座已经能够让 Agent 生成专业、稳定、可验证的候选证据，同时让人类在 Editor 中做最终选择。
- 人类决定和最终批准是不可伪造、可重开、只读、受 freshness 与 identity 约束的持久回执。
- 相同结果不会丢失来源，冲突不会被静默吞掉，隐式依赖不会要求用户手工拼闭包。
- 真实隔离 apply 已证明最终选择能够落盘，同时保持源配置换行约定和原始 Starter 不变。
- Wave 7 只能在本轮文档闭合、经理复审和项目所有者后续授权之后开始。
