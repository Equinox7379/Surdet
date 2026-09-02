# Surdet 引用感知批量素材整理实施任务书

> 主代理持续施工到功能、最小充分验证、普通提交、普通推送和远端 CI 完成。Luna 只承担边界清楚的只读审阅或低风险辅助；不得再创建子代理；架构、关键事务、整合、Git 和完成判断由主代理负责。

**目标：** 在素材中心完成同类素材多选、整批影响预览、逻辑原子提交、恢复、回执重开与整批撤销；支持安全的移动链和路径交换，并保持单素材整理可用。

**架构：** Authoring 一次扫描项目并规划稳定的 `moves[]`；CLI 把一个批次作为一个 relocation operation，复用现有 store、项目 lease、写入 gate 和 recovery barrier，以“全部源先备份、全部目标后发布、文本一次改写”完成整批事务；Editor 在现有素材中心提供多选和同页批量工作台，不新增服务或第二套客户端。

**临时目录：** `D:\surdet-tasks\asset-batch-relocation-1`

## 全局约束

- 可控的 TEMP、TMP、npm 缓存、浏览器输出和测试临时文件全部写入任务目录，不写 C 盘。
- 只支持背景、立绘或头像；单批同类；已有目录；扩展名不变；不覆盖批次外文件。
- 链和交换通过“全部源先进入独立备份”实现；不建立通用图算法或规则平台。
- 一批只有一个 operation、journal、receipt 和 undo receipt；不存在部分成功回执或跳过问题项。
- 单素材整理改为一个元素的批次，生产代码只保留一条执行路径。
- 不新增 daemon、数据库、项目锁、素材索引、恢复体系或兼容平台。
- UI 使用中文和正常文档流；不新增卡片墙、渐变、玻璃、彩色单侧竖线、胶囊墙或悬浮确认按钮。
- 保留既有未跟踪与受保护文件；只精确暂存当前任务文件；不做宽泛仓库清理。
- 测试按最小充分原则：每层一次能触发缺口的 RED、一次聚焦 GREEN、一次真实浏览器路径，最后观察一次远端 CI，不重复完整套件。

---

## Task 1：共享批量规划合同

**文件：**

- 修改 `packages/authoring/src/contracts.ts`
- 修改 `packages/authoring/src/asset-relocation.ts`
- 修改 `packages/authoring/src/index.ts`
- 修改 `packages/authoring/test/asset-relocation.test.ts`

**步骤：**

1. 在现有聚焦测试中先增加 RED：两个背景同批移动只扫描一次且引用同时改写；A↔B 不发生顺序污染；重复源、重复目标、批次外目标占用整批阻断；混类阻断。
2. 增加批量输入与公开计划类型：稳定的 `moves[]`、逐项 descriptor、聚合计数、可关联多源的 blocker。
3. 把单项 planner 拆成“规范化移动映射 + 一次项目扫描 + 一次文本投影”；现有单项入口只包装一个元素批次。
4. 目标占用判断使用整批源集合：批次内源路径可作为目标，批次外占用才阻断。
5. 文本解析基于原始内容和不可变映射表，禁止串行套用替换结果。
6. 保留不透明引用防线与扫描基线；plan fingerprint 纳入完整移动图。
7. 跑 Authoring 聚焦测试、typecheck 与 build 一次。

**完成条件：** 规划结果与选择顺序无关；链/交换、阻断和引用改写在纯函数层可确定复现；单项旧测试继续通过同一实现。

---

## Task 2：立绘完整组与批次语义

**文件：**

- 修改 `packages/authoring/src/asset-relocation.ts`
- 修改 `packages/authoring/test/asset-relocation.test.ts`

**步骤：**

1. 先增加 RED：完整立绘组统一改角色/服装可执行；少选一个表情、目标组不一致或产生重复表情时阻断。
2. 构建旧组成员集合与批次映射，只有全部物理成员被一致覆盖时解除组歧义。
3. 裸角色、裸 outfit 与 timeline target 只在完整组一致映射时改写。
4. 覆盖目录移动但语义键不变、重复语义键重命名阻断和保留表情唯一性的测试。
5. 跑该文件聚焦测试一次。

**完成条件：** 批量能力不会把原有 fail-closed 立绘边界变成猜测改写。

---

## Task 3：批次持久化合同

**文件：**

- 修改 `packages/cli/src/asset-import-authority/types.ts`
- 修改 `packages/cli/src/asset-import-authority/asset-relocation-store.ts`
- 修改 `packages/cli/test/asset-import-authority-storage.test.ts`
- 修改 `packages/cli/test/asset-relocation-authority.test.ts`

**步骤：**

1. 先增加 RED：一条记录含多个 move baseline、逐项 binary state、稳定备份路径与一个 receipt/undo receipt；损坏或缺项 fail-loud。
2. 将新记录升级为批次 schema，binary 相关字段改为稳定排序数组；每项备份路径为 operation 工作区内确定性索引文件。
3. journal 保留单一全局状态与 recoveryPhase，每项只保存执行进度和身份。
4. receipt/undo receipt 投影完整 `moves[]` 与逐项目标/恢复身份，文本文件仍按路径去重。
5. 旧已完成记录仅允许只读摘要；旧非终结记录保持恢复阻断，不做自动迁移或重新提交。
6. 跑 store 与 authority 聚焦测试一次。

**完成条件：** 磁盘记录能在没有进程内记忆时表达整个批次，且任何部分损坏不会被当作可提交状态。

---

## Task 4：批次提交、回退、恢复与撤销

**文件：**

- 修改 `packages/cli/src/asset-import-authority/asset-relocation-authority.ts`
- 修改 `packages/cli/src/asset-import-authority/filesystem.ts`（仅确有必要时）
- 修改 `packages/cli/src/asset-import-authority/mutation-coordinator.ts`（仅测试暴露直接缺口时）
- 修改 `packages/cli/test/asset-relocation-authority.test.ts`
- 修改相邻 import/relocation 并发测试（仅现有边界需要同步时）

**步骤：**

1. 增加 RED：两个素材同批提交、A↔B、第二项故障整批回退、第二项计划后变更零写、第二项结果变化导致整批撤销零写。
2. 计划阶段一次捕获全部源、目标目录、库存、扫描文本和不透明根基线。
3. commit 只进入一次 `run('asset-relocation', ...)` 临界区；首次项目写入前完成整批全量预检。
4. 按稳定顺序先完成全部 source→backup，再完成全部 backup→target，随后处理去重后的文本列表。
5. 每一步先写 intent，动作后回读并写完成状态；所有项目与文本验证完成后才写一个 COMMITTED 回执。
6. rollback/recover 按逐项状态恢复整个批次；发现外部内容时进入现有 recovery barrier，不覆盖。
7. undo 在任何写入前全量核对所有目标和文本，随后反向恢复整个批次。
8. 验证 import、第二个 relocation 和页面普通保存冻结仍与批次互斥，不产生自锁。
9. 跑 CLI authority 与相邻并发/安全聚焦测试、typecheck 与 build 一次。

**完成条件：** 多文件操作提供逻辑原子性和可恢复性；不会生成部分成功回执，不会覆盖外部变化。

---

## Task 5：HTTP 与 Editor 客户端

**文件：**

- 修改 `packages/cli/src/asset-import-authority/http-handler.ts`
- 修改 `packages/cli/test/asset-import-authority-http.test.ts`
- 修改 `packages/editor/src/asset-import-client.ts`
- 修改 `packages/editor/test/asset-import-client.test.ts`

**步骤：**

1. 增加严格请求 RED：plan 接收一个 `moves[]`，拒绝空数组、超过 100 项、未知字段、重复 path 和绝对路径；commit/recover/undo 仍针对一个 operation。
2. 保留现有 `/relocations` 路由和 token/binding/project identity，不新增 per-item endpoint。
3. 服务端在进入 planner 前规范化并稳定排序，客户端严格解析批量 plan、detail、summary、receipt 与 undo receipt。
4. 公开响应只包含项目相对路径和人类所需字段，不泄露工作区或绝对路径。
5. 保持单素材调用通过一个元素的 `moves[]` 工作。
6. 跑 HTTP/client 聚焦测试一次。

**完成条件：** 浏览器与本机 authority 之间仍是一条有界、严格、可理解的合同。

---

## Task 6：Editor 批量工作区状态

**文件：**

- 修改 `packages/editor/src/asset-relocation-workspace.ts`
- 修改 `packages/editor/test/asset-relocation-workspace.test.ts`
- 新增 `packages/editor/test/asset-relocation-workspace-batch.test.ts`
- 修改 `packages/editor/src/main.ts`
- 修改 `packages/editor/src/project-io.ts` 或相邻写入协调文件（仅现有冻结必须同步时）

**步骤：**

1. 增加 RED：选择去重、跨筛选保留、首项锁定类别、项目切换清空、目标变化作废 plan、busy 期间冻结、终态动作正确。
2. 扩展现有 workspace 为批次状态：selection、共同目标目录、逐项目标文件名、plan、detail、receipt、recovery 与 message。
3. 单素材详情入口构造一个元素选择，继续进入同一工作区。
4. 主流程只发一次 plan/commit/recover/undo 请求；成功后完整重读项目并恢复素材中心位置。
5. 复用现有 `projectWriteLock: 'asset-relocation'`，规划到终态期间冻结页面其他写入。
6. 跑 workspace/main 相邻聚焦测试与 Editor typecheck 一次。

**完成条件：** UI 状态不会因筛选、重渲染、项目切换或旧计划残留而提交错误批次。

---

## Task 7：素材中心批量交互

**文件：**

- 修改 `packages/editor/src/panels/asset-center.ts`
- 修改 `packages/editor/src/styles/asset-center.css`
- 修改 `packages/editor/test/editor-asset-center-contract.test.ts`
- 修改必要的相邻 Editor 视图测试

**步骤：**

1. 增加 RED：多选入口、原生 checkbox、独立详情按钮、同类锁定、已选摘要、逐项调整、整批摘要、阻断和结果区。
2. 将批量模式中的物理素材项改为行容器，checkbox 与“查看详情”并列，禁止交互控件嵌套。
3. 把“批量整理”与“已选 N 项 / 整理所选 / 退出选择”放在素材库页内标题行；不做贴底悬浮条。
4. 同页工作台提供共同目标目录、默认保留文件名和折叠的逐项文件名调整。
5. 影响预览先显示聚合句，再显示紧凑逐项列表和分组引用；任一 blocker 隐藏提交动作。
6. 执行期间设置 `aria-busy`、`aria-live`，禁用会让计划失效的交互；重渲染后恢复焦点。
7. 800px 下纵向排列、路径换行、按钮满宽，无页面横向滚动。
8. 跑 Editor 视图聚焦测试与 build 一次。

**完成条件：** 人类能看懂“选了什么、会去哪、会改什么、为何不能执行”，且页面不退化成卡片墙或管理后台。

---

## Task 8：真实浏览器闭环

**文件：**

- 修改 `packages/editor/e2e/asset-import-authority.e2e.mjs`
- 修改 `packages/editor/test/asset-import-authority-runner.test.mjs`
- 修改必要的浏览器夹具，限定在现有任务临时目录

**步骤：**

1. 扩展现有真实 authority runner，不新建第二套浏览器 harness。
2. 用隔离项目准备两个被场景引用的背景，选择它们并交换最终文件名。
3. 断言预览显示两个素材、正确引用计数和单次提交动作。
4. 提交后重载项目，验证两个目标文件和对应场景引用按原始映射交换，预览仍能运行。
5. 重开一个批次回执，执行一次整批撤销，验证文件与引用全部恢复。
6. 额外在 800px 检查无横向溢出、批量动作仍可达；不生成截图清单或证据包。
7. 跑 runner contract 和真实浏览器命令各一次。

**完成条件：** 浏览器真实路径证明不是只有纯函数和 DOM 测试通过。

---

## Task 9：独立审阅、收口与远端

**文件：**

- 修改 `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`（保持未跟踪、只追加简短结论）
- 仅修复审阅或 CI 揭示的本任务直接缺陷

**步骤：**

1. 请 Luna 只读审阅 Authoring 映射、CLI 整批事务和 Editor 人类交互；明确不得创建子代理、不得 Git 写入、不得扩大范围或建立工程化证据。
2. 主代理核对所有真实 diff，修复直接缺陷并运行最相关聚焦验证；不机械重复完整套件。
3. 检查桌面和 800px 真实页面，确认主层级、键盘可达和无横向溢出。
4. 精确暂存本任务文件，创建少量按职责划分的普通提交；不纳入长期台账与既有未跟踪文件。
5. 普通 push 当前 `main`，等待一次远端 CI；若普通红灯与本任务相关，直接最小修复、验证、提交和再次普通 push。
6. 在长期台账追加一段：完成能力、验证、最终提交/远端状态与明确未开始项。

**完成条件：** 本地功能、聚焦验证、真实浏览器、普通 push 与远端 CI 闭环；仓库无意外 tracked 改动；后续阶段未被顺手启动。
