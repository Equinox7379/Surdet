# Surdet Editor 统一壳层与视觉层级底座任务书

> 日期：2026-09-02
> 设计依据：`docs/superpowers/specs/2026-09-02-surdet-editor-shell-hierarchy-foundation-design.md`
> 类型：纯前端、局部可回滚
> 停止边界：完成本轮后进入复核，不启动 Frontend Pass 5 或主线 Wave 7

## 目标

用现有状态和动作重建 Editor 的共同壳层：成熟的项目栏、分组工作区导航、中文优先排版和统一控件尺度。九个模式与所有既有行为必须保留。

## 任务 1：建立永久壳层合同

修改或新增：

- `packages/editor/test/editor-shell-navigation-contract.test.ts`
- `packages/editor/test/editor-visual-token-contract.test.ts`
- 必要时新增一份小型壳层层级合同测试

要求：

- 顶栏四个语义区域齐全；
- 快捷键使用独立 `<kbd>`；
- 导航按“创作 / 检查 / 项目”分组，但模式 ID 与顺序不变；
- 新排版、间距和控件尺度可直接验证；
- 禁止彩色单侧选中线、渐变、玻璃和胶囊默认样式。

先运行一次聚焦测试，确认旧实现不能满足新合同。

## 任务 2：重做 token 与通用控件

修改：

- `packages/editor/src/styles/tokens.css`
- `packages/editor/src/styles/components.css`

要求：

- 建立暖灰纸面、炭黑应用栏、低饱和陶土主动作；
- 建立中文可读字号与有限间距尺度；
- 常规控件高度不低于 38px；
- 保持焦点可见、禁用可辨、状态不用颜色作为唯一信号；
- 不修改任何业务选择器或事件。

## 任务 3：重做项目栏和模式导航

修改：

- `packages/editor/src/shell/app-shell.ts`
- `packages/editor/src/shell/editor-modes.ts`
- `packages/editor/src/styles/app-shell.css`

要求：

- 项目栏分为产品、上下文、命令、回执；
- 项目命令、编辑命令和保存命令形成可访问分组；
- 快捷键降级显示，不混入主文案；
- 模式导航形成三组，但继续走原 `onSelect`；
- 1440、1024、390 宽度均保持主命令可达；
- 不改 `main.ts` 中状态、保存、撤销或模式分发逻辑，除非仅为挂载语义所必需。

## 任务 4：聚焦验证和只读复核

运行一次：

- 壳层 / token / 集成工作台聚焦测试；
- Editor 全量测试；
- Editor typecheck；
- Editor build。

请 Luna 只读检查：

- 是否有行为回退或假状态；
- 是否仍有明显 AI 后台模板味；
- 是否存在窄窗口遮挡、不可达命令或单侧彩条。

只修直接相关问题，不扩到模式内部迁移。

## 任务 5：真实浏览器检查

在隔离端口打开真实 Editor：

- 1440×900 检查完整顶栏、命令分组、导航和一个已加载工作区；
- 390×844 检查堆叠、滚动、焦点与无横向遮挡；
- 至少实际切换九个模式并触发一次无副作用命令状态检查；
- 不保存截图包、trace 包或额外证据目录。

## 任务 6：收口

- 查看精确 diff，确认没有后端、依赖、项目格式或受保护文件变化；
- 精确暂存本任务文件；
- 普通提交，建议消息：`feat(editor): establish unified workbench hierarchy`；
- 普通 push；
- 读取本次 CI，普通红灯在同一目标内最小修复直到通过；
- 长期台账只追加一段简短结果；
- 不启动 Frontend Pass 5 或主线 Wave 7。

## 实施结果

- 项目栏已分为产品身份、当前上下文、全局命令和操作回执；原动作、禁用与保存状态投影保持。
- 九个模式保持原 ID、面板 ID 和顺序，并按创作、检查、项目形成可访问分组。
- 视觉底座改为暖灰纸面、炭黑壳层和低饱和陶土主动作，建立 13–25px 中文字号与有限间距尺度。
- 实际浏览器检查发现并修复两个壳层问题：空恢复区占用隐形整行，以及 1200–1280px 命令内容向左侵入上下文。
- 390px 窄屏的五个全局命令全部完整可见，远端模式可通过横向导航到达；1440px 无页面横向溢出。
- Luna 复核发现全局输入规则会压过时间轴紧凑控件和素材导入错误边框；该规则已撤回，共享尺度只作用于明确采用共享组件的控件。
- Editor 全量 68 files / 564 tests、typecheck 通过；最终聚焦 4 files / 22 tests 通过；最终构建输出至 D 盘并通过。
- Preview、Review、Stats、Audit 仍保留旧模式内部视觉，属于后续 Frontend Pass，不在本轮虚报为已迁移。
