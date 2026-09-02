# Surdet 项目概览与文字审计 Frontend Pass 7 实施任务书

> 主代理连续施工并负责设计、集成、Git 与最终判断；Luna 只做边界清楚的只读复核，不得创建子代理。

**Goal:** 把 Editor 的统计页和审计页重构为中文优先、层次清楚、键盘可达的项目体检工作区，同时保持全部现有数据、导航和名词表写入边界。

**Architecture:** 两个稳定模式继续独立渲染；面板只重排现有投影并接入现有 `jumpToScene()`。一份专属 CSS 负责两页视觉，旧 Stats/Audit 全局规则退出；Core、CLI、项目格式和审计算法不变。

**Tech Stack:** TypeScript、命令式 DOM、CSS Grid/Flex、Vite 6、Vitest 3；不新增依赖。

## Global Constraints

- 本任务是 Post-Wave-6 / Pre-Wave-7 的 Frontend Pass 7，不是主线 Wave 7。
- 不修改 Core、Authoring、CLI、Agent Port、项目文件或审计严重度。
- 不新增健康分、趋势、更新时间、完成率或其他不存在的数据。
- 用户可见内容中文优先；code、路径、JSON 形状默认折叠。
- 不使用彩色单侧线、渐变、玻璃、胶囊、阴影卡片墙、悬浮位移或 floating/sticky 主操作。
- 所有可控临时文件、缓存和构建写入 `D:\surdet-tasks\project-health-audit-pass-7`。
- 最小充分验证；不建立证据包、重复全量测试或新浏览器平台。
- 精确暂存，不使用 `git add .`/`-A`；完成后普通提交、普通 push 并跟进 CI。

## 预计文件

- Create: `packages/editor/src/styles/project-health-workspace.css`
- Create: `packages/editor/test/project-health-workspace-layout.test.ts`
- Create: `packages/editor/test/project-health-panels.test.ts`
- Modify: `packages/editor/index.html`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/src/project-io.ts`
- Modify: `packages/editor/src/panels/issues.ts`
- Modify: `packages/editor/src/panels/config.ts`
- Modify: `packages/editor/src/panels/stats-panel.ts`
- Modify: `packages/editor/src/panels/audit-panel.ts`
- Modify: `packages/editor/src/styles.css`
- Modify: `packages/editor/test/project-io.test.ts`
- Create: 本设计规格与本任务书。

直接相关文件若经真实 RED 证明必须同步，可在同一 Goal 内最小修改并在收口时说明。

---

## Task 1: 建立 Pass 7 RED

- [ ] 新增布局合同，断言专属 CSS 已加载、两个稳定 panel identity、连续层级、响应式、表格滚动和禁止视觉。
- [ ] 新增面板 DOM 合同，断言统计空态/摘要/场景按钮/坏剧本故障态和审计中文类型/技术折叠/独立按钮/部分编译警示。
- [ ] 运行一次聚焦 RED；只允许因新 DOM/CSS 尚未实现而失败。

## Task 2: 重构项目概览

- [ ] 在 `stats-panel.ts` 新增 `bindStatsHooks()`，只把场景按钮接到现有跳转入口。
- [ ] 用标题、主要结论和连续事实组替代七张卡片。
- [ ] 为零场景提供真实空态，不平铺零值。
- [ ] 把逐场景数据放入有 caption/scope 的滚动表格，场景名使用真实 button。
- [ ] 把估算口径改为中文并放入默认收起的“计算说明”。
- [ ] 捕获统计编译失败，显示中文不可用状态；原始错误仅进入折叠技术信息，不让主渲染链空白。
- [ ] 运行统计面板 GREEN。

## Task 3: 重构文字一致性检查

- [ ] 保留现有 counts、terms、pairs 和 Core findings 计算。
- [ ] 在没有编译产物时仍显示页面标题和方向明确的空态。
- [ ] 把 findings 按“建议处理 / 请确认”分组，显示中文问题类型。
- [ ] 检查 `lastValidation.issues`；存在编译错误时标记“检查不完整”，局部零发现不得冒充全项目通过。
- [ ] 项目替换前失效旧校验回包并清空配置行缓存；校验完成时只刷新当前已打开的审计页。
- [ ] 用独立“打开场景” button 替代可点击 `div.issue`；保留准确的零基行跳转。
- [ ] 把名词表写入操作改为独立中文按钮，继续走现有 hook。
- [ ] 把 code、路径、行号和名词表 JSON 说明移入原生折叠详情。
- [ ] 运行审计面板 GREEN，并保持 `computeSpeakerPairs` 测试全绿。

## Task 4: 专属视觉与响应式

- [ ] 新建 `project-health-workspace.css`，只使用现有 `--surdet-*` token。
- [ ] 统计使用主要结论 + 定义列表，不出现 KPI 卡片墙、阴影或 hover lift。
- [ ] 审计使用连续记录行和完整焦点面，不出现彩色单侧线或嵌套点击区域。
- [ ] 1024/720/480 三档保证层级、操作和表格滚动；页面本身不横向溢出。
- [ ] 从 `styles.css` 删除仅属于 Stats/Audit 的旧规则；不动 Script 工作区作用域规则。
- [ ] 运行布局 GREEN。

## Task 5: 最小充分收口

- [ ] 运行一次 Pass 7 聚焦测试：新合同、`stats.test.ts`、`audit-pairs.test.ts`、shell navigation contract。
- [ ] 运行一次 Editor 全量、一次 typecheck、一次输出到 D 盘的 build。
- [ ] 实际浏览器检查 1440×900 与 390×844：中文层级、键盘按钮、技术默认折叠、表格滚动和页面无横向溢出。
- [ ] Luna 只读复核数据/写入边界、可达性/中文层级和回归范围；主代理只修直接相关 BLOCKER/HIGH。
- [ ] 精确核对 diff，普通提交 `feat(editor): rebuild project health workspace`，普通 push 并跟进同提交 CI。
- [ ] 在既有长期路线台账追加 Pass 7 实现与下一边界；台账保持未跟踪，不创建新台账。

## 完成条件

- Stats/Audit 旧卡片墙、彩色左线、鼠标专用跳转和默认技术噪音退出；
- 场景统计与审计定位均可通过键盘操作；
- 现有统计真相、Core 审计、名词表写入和主导航保持；
- 桌面与窄屏实际检查通过；
- 最小测试、Editor 全量、typecheck/build 与 Luna 复核通过；
- 精确提交已推送且 CI 绿色；
- 主线 Wave 7 未启动。
