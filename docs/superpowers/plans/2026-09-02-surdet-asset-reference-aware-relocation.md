# Surdet 引用感知素材整理实施任务书

> 主代理持续施工直到功能、验证、普通提交、普通推送和远端 CI 完成。Luna 仅做只读或边界清楚的辅助审阅；主代理负责架构、关键代码、整合、Git 和完成判断。

**目标：** 在素材中心完成单个背景、立绘或头像的同类目录移动/重命名，并在写入前展示影响、同步更新所有已支持静态引用、提供回执与安全撤销。

**架构：** Authoring 新增纯规划器；CLI 在现有素材权限运行时内新增独立 relocation 操作，共用项目绑定、项目身份、项目锁和恢复屏障；Editor 在素材详情区提供中文“编辑目标—检查影响—确认—回执/撤销”流程，并在 authority 写入后完整重读当前目录。

**技术栈：** TypeScript、现有 Authoring snapshot/asset intelligence、Node 文件系统、现有 Vite 本机 authority、Editor 原生 DOM、Vitest、现有真实浏览器 runner。

## 全局约束

- 本轮可控临时目录、npm 缓存和浏览器输出全部写入 `D:\surdet-tasks\asset-reference-move-rename-1`。
- 第一版只支持背景、立绘、头像；单素材；同类别已有目录；扩展名不变；不覆盖。
- 不处理批量、跨类别、转码、删除、音频、视频、字体、other、动态引用和插件私有引用。
- 不新建 daemon、数据库、第二套项目锁、第二套素材索引或通用事务平台。
- 产品需要的计划指纹、文件前置身份、最小 journal 和回执用于避免部分写入，不扩张成证据包或流程工程。
- Editor 主文案使用自然中文；不新增渐变、玻璃、彩色左竖线、胶囊墙、悬浮操作或卡片墙。
- 保留现有未跟踪文件；长期台账保持未跟踪、只追加简短结论；禁止宽泛暂存。
- 每个任务先跑最小 RED，再做最小 GREEN；最后只做一次最相关的工作区检查和一次真实浏览器路径，不重复全仓库门禁。

---

## Task 1：共享引用改写规划器

**文件：**

- 新增 `packages/authoring/src/asset-relocation.ts`
- 修改 `packages/authoring/src/contracts.ts`
- 修改 `packages/authoring/src/asset-intelligence.ts`
- 修改 `packages/authoring/src/scene-document.ts`
- 修改 `packages/authoring/src/index.ts`
- 新增 `packages/authoring/test/asset-relocation.test.ts`

### 合同

- [ ] 导出 `describeProjectAssetPath(path)`，与素材智能使用同一分类和立绘命名事实源，不复制目录到 kind 的映射。
- [ ] 导出可保持引号、缩进和行尾的单个指令参数替换 helper。
- [ ] 定义公开 `ProjectAssetRelocationPlan`、source/target descriptor、reference change、blocker 和 internal text change 类型。
- [ ] 规划输入显式包含 snapshot、物理素材 facts、gallery 原始文件、其他需检查的文本配置、sourcePath、targetPath 和 hasher。

### RED

- [ ] 背景重命名同时改写 `.gal @bg`、background timeline `cue.key` 与 `gallery.cgs[].src`。
- [ ] `gallery.cgs[].src` 缺省且 `id` 命中旧背景键时保持 ID 不变并产生明确 fallback blocker。
- [ ] 立绘重命名同时改写 `.gal @show` 的 key/表情及 timeline `target`/`expression`。
- [ ] `@show lynn` 与缺省 expression 按运行时 `normal` 默认值识别并改写，不漏掉裸角色形式。
- [ ] `@hide/@mov role:outfit` 与 portrait timeline 的 show/expression/move/hide target 全部改写；裸 role 在 role 改名时产生歧义 blocker。
- [ ] 头像重命名改写 `game.config.json characters.*.avatar`。
- [ ] JSON 只替换目标字符串 token，保留原格式和 CRLF/LF；场景保留原引号、缩进和 EOL。
- [ ] 同目录纯移动且语义键不变时没有文本变化，但仍产生物理整理计划。
- [ ] 非三类素材、跨类别、改扩展名、无效立绘名、目标存在、重复新键、无操作均阻断。
- [ ] 未知指令/JSON 字段中的完整旧 key、旧 path 或旧 filename 产生 opaque blocker；普通台词中的相同文字不误报。
- [ ] `title_bg` 允许保持语义键的目录移动、禁止语义重命名；项目 `src/scripts/test/tests` 代码、JSON 和素材校验脚本的精确旧字符串进入 opaque blocker。
- [ ] 计划输出按稳定顺序展示引用数、文件数、分组明细和明确中文 blocker。

### GREEN

- [ ] 实现一套共享分类事实与纯规划器，不进行任何磁盘写入。
- [ ] 计划指纹只覆盖会影响提交语义的规范字段；同输入得到同计划，不包含绝对路径。
- [ ] 运行一次 Authoring 聚焦测试、typecheck、build。
- [ ] 精确提交：`feat(authoring): plan reference-aware asset relocation`

---

## Task 2：CLI relocation 存储、互斥与可恢复写入

**文件：**

- 新增 `packages/cli/src/asset-import-authority/asset-relocation-store.ts`
- 新增 `packages/cli/src/asset-import-authority/asset-relocation-authority.ts`
- 新增 `packages/cli/src/asset-import-authority/mutation-coordinator.ts`
- 修改 `packages/cli/src/asset-import-authority/authority.ts`
- 修改 `packages/cli/src/asset-import-authority/filesystem.ts`
- 修改 `packages/cli/src/asset-import-authority/record-store.ts`
- 修改 `packages/cli/src/asset-import-authority/types.ts`
- 新增 `packages/cli/test/asset-relocation-authority.test.ts`

### 合同

- [ ] import 和 relocation 共用一个进程内 project mutation coordinator，不能并发写同一项目。
- [ ] 增加统一素材写入 gate；import create/upload/plan/seal/commit/cancel/undo、relocation plan/commit/cancel/undo、绑定确认与启动发现等全部状态写入口都同时检查两类 pending/recovery；恢复入口只清理既有操作且仍发现两类状态。
- [ ] relocation store 位于现有 project namespace；项目内同卷工作区为 `.surdet/asset-relocation/<operationId>`。
- [ ] store 保存 request、公开 plan、全部扫描文本基线、待写文本的旧副本与新身份、source/backup/target 文件身份、逐步 journal、receipt/undo receipt；不保存与产品恢复无关的证据材料。
- [ ] relocation 使用现有 recovery barrier；存在 import 或 relocation 未恢复写入时，另一种素材写操作也被阻断。

### RED

- [ ] 成功路径：源消失、目标存在、场景/时间轴/config/gallery 同步更新、回执可读。
- [ ] 计划之后源文件、目标位置或任一已扫描文本（包括不需要改写的文件）变化，首次写入前重新扫描并返回 stale，项目零变化。
- [ ] 普通写入错误会恢复旧源和旧文本，不留下半完成状态。
- [ ] 在素材移动 intent、素材目标完成、文本替换 intent 后模拟进程终止；重建 authority 后只能继续完成或进入显式恢复阻断。
- [ ] undo 在所有完成后内容未变时恢复源和旧文本；任一 touched file 变化时首个写入前整批拒绝。
- [ ] 终态回执缺失、journal 不一致或工作区身份异常必须 fail-loud。
- [ ] 每个文本替换前再次 CAS；回退只覆盖仍匹配本操作输出的文件，外部修改触发 recovery barrier 而不是被回滚覆盖。
- [ ] source→backup 与 backup→target 每一步前再次核对三条路径身份；目标以不覆盖方式独占发布，竞争触发 recovery barrier。

### GREEN

- [ ] 复用现有项目根身份、安全相对路径、文件身份、耐久 JSON 写入与 barrier 原语。
- [ ] 提交顺序：准备文本 → journal → 移动素材 → 原子替换文本 → 回读核验 → 回执。
- [ ] 启动发现 reconciliation 覆盖 relocation；列表能看到未终结操作和最近回执。
- [ ] 运行一次 CLI relocation 聚焦测试、相邻 import authority 测试、typecheck、build。
- [ ] 精确提交：`feat(cli): relocate referenced project assets safely`

---

## Task 3：HTTP 边界与 Editor 客户端

**文件：**

- 修改 `packages/cli/src/asset-import-authority/http-handler.ts`
- 修改 `packages/cli/src/asset-import-authority/vite-plugin.ts`
- 修改 `packages/cli/test/asset-import-authority-http.test.ts`
- 修改 `packages/editor/src/asset-import-client.ts`
- 修改 `packages/editor/test/asset-import-client.test.ts`

### HTTP 合同

- [ ] 在现有 base path 下增加 relocation plan/query/commit/recover/undo 路由；不增加第二个 token 或第二次项目绑定。
- [ ] plan 请求只接受 operationId、sourcePath、targetDirectory、fileName；严格拒绝未知字段、绝对路径和控制字符。
- [ ] commit/recover/undo 需要同一浏览器绑定与短期 operation token。
- [ ] 公开错误区分 blocked、stale、target exists、recovery required、undo changed，不返回本机绝对路径或内部工作区。
- [ ] status/list 发现同时返回 import 与 relocation 的待处理操作、最近回执及统一 recovery barrier。
- [ ] binding/status/list 保留 import 与 relocation 两套不同摘要数组和严格形状；relocation 不伪装成带 itemCount/fileCount 的 import 操作。

### Client 合同

- [ ] 在现有已绑定 client/session 上增加 relocation 方法与严格解析；不能新建拿不到 binding token 的旁路 client，也不能重复绑定项目。
- [ ] 客户端严格校验公开 plan、detail、receipt 和 undo receipt 形状。
- [ ] 主错误文案为中文；原始技术代码仅作为可展开详情。
- [ ] 超时、取消、切换项目和过期响应不污染新项目状态。

### 验证

- [ ] 先建立未授权、错误项目、非法请求和成功返回 RED，再实现 GREEN。
- [ ] 运行一次 CLI HTTP 与 Editor client 聚焦测试、两侧 typecheck/build。
- [ ] 精确提交：`feat(editor): connect asset relocation authority`

---

## Task 4：素材详情内联工作流与全页面写入冻结

**文件：**

- 新增 `packages/editor/src/asset-relocation-workspace.ts`
- 修改 `packages/editor/src/panels/asset-center.ts`
- 修改 `packages/editor/src/main.ts`
- 修改 `packages/editor/src/state.ts`
- 修改 `packages/editor/src/project-io.ts`
- 修改 `packages/editor/src/styles/asset-center.css`
- 新增 `packages/editor/test/asset-relocation-workspace.test.ts`
- 修改 `packages/editor/test/editor-asset-center-contract.test.ts`

### UI 合同

- [ ] 仅物理、唯一、支持类别且项目已保存的素材显示可用“整理素材”入口。
- [ ] 表单使用同类已有目录下拉、最终文件名输入和清楚的旧路径 → 新路径摘要。
- [ ] “检查影响”不写项目；可执行计划显示“移动并更新 N 处引用”；阻断计划不显示可提交主操作。
- [ ] 引用影响按场景、时间轴、角色配置、鉴赏配置分组，默认摘要、可展开详情。
- [ ] 成功区显示新位置、更新数量、“查看新位置”和“撤销本次整理”。
- [ ] 不使用列表行内按钮、浮动确认、彩色左竖线、渐变、玻璃或新卡片墙。
- [ ] 800px 窄窗口表单与结果纵向排列，无页面级横向溢出。

### 写入冻结与重载

- [ ] `state.projectWriteLock`（或等价单一状态）成为本页面所有常规写盘入口的共享保护；`saveAll`、`writeFileHandle`、配置保存与 asset import commit 都服从它。
- [ ] 锁定时顶栏和相关按钮表现为不可用，并显示“素材整理进行中”。
- [ ] 切换项目、切换选择或取消会使旧 plan 作废；执行中的提交不可由第二次点击并发触发。
- [ ] 新增不弹目录选择器的当前目录完整重载：game config、gallery、场景、时间轴、素材和共享索引全部更新，旧编辑历史清除。
- [ ] 重载后回到素材中心并选中目标 assetId。

### 验证

- [ ] 建立 workspace 状态与 DOM 合同 RED，再实现 GREEN。
- [ ] 运行一次 Editor relocation + Asset Center 聚焦测试、相邻 import workbench 测试、typecheck、build。
- [ ] 精确提交：`feat(editor): organize referenced assets`

---

## Task 5：真实浏览器闭环

**文件：**

- 修改 `packages/editor/e2e/asset-import-authority.e2e.mjs`
- 修改 `packages/editor/test/asset-import-authority-runner.test.mjs`

### 场景

- [ ] 在 D 盘新建隔离项目副本，使用真实 `dev:project` authority，不触碰仓库 Starter。
- [ ] 打开素材中心，选择一个被场景、时间轴和 gallery 共同引用的背景。
- [ ] 改名并检查影响，确认页面展示正确引用数和文件分组。
- [ ] 提交后源路径消失、目标存在；Editor 完整重载后仍停在素材中心并选中新素材。
- [ ] 打开场景/预览证明更新后的引用可用。
- [ ] 撤销后旧路径和旧引用恢复，目标消失。
- [ ] 另覆盖一个 target exists 阻断，证明项目零变化。
- [ ] 浏览器控制台、页面错误、请求失败和残留进程为空；不保存截图或视频清单。

### 验证

- [ ] Runner 合同 RED→GREEN。
- [ ] 一次真实浏览器运行通过。
- [ ] 精确提交：`test(editor): verify reference-aware asset relocation`

---

## Task 6：独立 Luna 审阅与修正

- [ ] Luna A 只读审查 Authoring 引用改写，找漏改、误改和 EOL/引号问题。
- [ ] Luna B 只读审查 CLI 中断恢复、互斥和 undo 首写前阻断。
- [ ] Luna C 只读审查 Editor 人类可理解性、中文、写入冻结与完整重载。
- [ ] 主代理逐条核对，只修真实问题；不为审阅意见扩大范围或新建平台。
- [ ] 对修正运行一次最相关聚焦验证并精确提交。

---

## Task 7：最终检查、推送与远端 CI

- [ ] 运行 Authoring、CLI、Editor 受影响聚焦测试。
- [ ] 运行三个受影响工作区的 typecheck/build。
- [ ] 运行一次真实素材 authority 浏览器闭环。
- [ ] 检查 `git diff --check`、tracked 范围和 staging；不碰 966 个既有未跟踪项。
- [ ] 确认没有把日志、截图、临时目录或长期台账加入提交。
- [ ] 普通 push 当前 `main` 到 `surdet/main`。
- [ ] 等待这一 push 的一次远端 CI；普通红灯直接定位、最小修复、提交并继续普通 push。
- [ ] 在未跟踪长期台账追加：阶段目标、真实完成能力、验证、最终提交/CI、仍明确留在后续的音频/视频/字体与批量边界。

## 完成停止点

只有以下全部成立才结束本轮：

- 背景、立绘、头像的单素材引用感知移动/重命名在真实浏览器可用；
- 影响预览、阻断、提交、完整重载、回执和撤销闭环成立；
- 项目未保存内容和后续编辑不会被覆盖；
- 聚焦验证与远端 CI 通过；
- 普通提交与推送完成；
- 长期台账已简短更新；
- 没有启动批量整理、其他素材类别或下一轮前端重构。
