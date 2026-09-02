# Surdet 预览舞台与因果记录区 Frontend Pass 5 设计规格

> 日期：2026-09-02
> 阶段：Post-Wave-6 / Pre-Wave-7 前端重构内部批次 Frontend Pass 5
> 前置：Editor 统一壳层与视觉层级底座 `1990483` 已推送并通过 CI
> 边界：Editor 预览工作区；不启动 Frontend Pass 6，不启动主线 Wave 7

## 1. 结论

本轮把“预览”从一个 iframe 上下堆着按钮和技术标签的旧页面，重建为明确的桌面回放工作台：剧情舞台始终是最大、最稳定的主区域；播放入口与速度是上方少量控制；因果记录位于底部独立、可折叠的普通文档流区域。

这一轮不是新增第二套预览器，也不是重写 Renderer。它继续使用现有唯一 iframe、唯一 `PreviewRuntimeLifecycle`、唯一 `RendererRuntime`、现有轨迹消息、现有因果定位回调和现有 Review 消费事实。重构只改变 Editor 侧的可见结构、中文投影和必要的生命周期防串线。

## 2. 用户与页面唯一任务

主要用户是正在编辑剧情、希望立即确认“画面发生了什么、又是由哪一行剧情造成”的创作者。

页面唯一任务是：从当前剧情入口播放，然后在不挤压舞台的前提下查看并定位这次播放的因果记录。

因此视觉优先级固定为：

1. 当前剧情舞台；
2. 播放与入口控制；
3. 当前状态或错误；
4. 可按需展开的因果记录；
5. 技术 ID、事件类型和源码位置。

## 3. 已确认的真实问题

- 舞台、诊断和因果记录只是纵向堆叠，缺少“主舞台 / 次级证据”的稳定层级；
- 因果记录使用小号等宽文字按钮横向换行，像调试标签而不是连续可读记录；
- 轨迹不可折叠，事件变多时会持续占据舞台下方空间；
- 播放入口缺少稳定可见的中文标签，`@label` 和事件英文类型直接暴露为主要文案；
- 轨迹重绘会移除当前焦点，键盘用户无法稳定连续查看；
- 旧 iframe 的迟到 `ready` 或 `diagnostic` 消息没有和当前 iframe 来源绑定，可能污染新面板；
- reload 在编译失败时没有立即清空旧 `interp`、`store`、`registry` 和轻宿主引用，调试探针仍可能公开上一轮会话。

## 4. 产品与架构不变量

### 4.1 单一运行事实

- 一个挂载中的 Preview host 只允许一个 iframe；
- iframe 内继续只创建一个 `PreviewRuntimeLifecycle` 和一个 `RendererRuntime`；
- Dock 不拥有 runtime、iframe、trace 或因果选择状态；
- 不创建 script-mode 第二预览窗口或 context peek；
- 不复制 `state.previewTrace`、`state.selectedTraceStep`、`state.selectedObjectRef` 或 Review 使用的轨迹事实。

### 4.2 消息隔离

- `ready`、`diagnostic`、`trace-start`、`trace-event`、`trace-complete` 全部只接受当前 iframe 的 `contentWindow`；
- trace 继续要求当前 generation 与当前 traceId；
- 重复 complete、重复或倒序 event 不得追加到当前可见记录；
- 面板卸载或切换后，旧 iframe 的迟到消息不得回写新面板。

### 4.3 reload 失败安全

- 新 load 开始时先使旧解释器、变量表、场景注册表和轻宿主系统引用失效；
- 同一个 RendererRuntime 可以继续复用，但失败 load 后不得继续推进上一轮剧情；
- 失败仍通过现有诊断与错误展示通道呈现，不新增恢复体系。

### 4.4 既有行为保持

- “重新播放”（原“播放 / 重载”行为）、剧情入口、快进、时间轴直演、全量场景跳转和字体/素材 transfer 保持原路径；
- 因果行点击继续调用 `dispatchPreviewTraceSelection`；
- Script 与 Timeline 的对象定位及焦点跳转保持；
- Review 继续读取同一个 `state.previewTrace`；
- `preview.html` 的 Canvas 继续双轴居中，保持宽高比且不被拉伸。

## 5. 信息架构与 DOM

```text
┌──────────────────────────────────────────────────────────────┐
│ 剧情预览  [播放入口：场景开头 ▼] [跳过逐字显示 □] [重新播放] │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                      唯一剧情舞台                            │
│                   iframe / Gal Canvas                        │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ 当前状态：预览已启动                                         │
├──────────────────────────────────────────────────────────────┤
│ 因果记录 · 本次 8 条                         [收起记录]       │
├──────────────────────────────────────────────────────────────┤
│ 01  显示台词         凛：……                    场景第 12 行   │
│ 02  切换背景         雨夜站台                  场景第 13 行   │
│ 03  提供选项         2 个选择                  场景第 16 行   │
└──────────────────────────────────────────────────────────────┘
```

结构要求：

- `#preview-view[data-editor-panel="preview"]` 是稳定面板锚点；
- `.preview-workspace` 使用明确的 `toolbar / stage / status / dock` 四行网格；
- `.preview-stage` 承载唯一 iframe，并使用 `minmax(0, 1fr)` 获得最大剩余高度；
- `.preview-causal-dock` 位于正常文档流，不 fixed、不 sticky、不悬浮；
- Dock 标题按钮使用 `aria-expanded` 与 `aria-controls`；
- 展开内容拥有独立纵向滚动，折叠后只留下标题行；
- 轨迹行使用连续列表，不使用卡片墙、胶囊、彩色单侧线或渐变。

## 6. 中文投影

面向用户的第一行必须使用可读中文，不直接把内部 enum 当主标题：

- `instruction` → “执行剧情指令”；常见 `text`、`bg`、`portrait`、`timeline` 等 op 可进一步写为“显示台词”“切换背景”“调整立绘”“播放演出”；
- `choice` → “提供选择”；
- `state` → “更新剧情状态”；
- `condition` → “判断剧情条件”；
- `control-flow` → “切换剧情位置”；
- `scene-end` → “场景结束”；
- 未知类型 → “剧情事件”。

场景 ID、行号、原始 kind/op 和对象引用保留为次级技术信息，可用于定位与排障，但不与中文摘要争夺主视觉。

## 7. 视觉方案

### 7.1 延续统一底座

不新增颜色系统，继续使用现有 `--surdet-*` token：

- 炭黑应用壳；
- 暖灰纸面内容区；
- 近黑正文与中性灰辅助信息；
- 低饱和陶土色只用于主动作和焦点；
- 成功、警告、危险色仅表达真实状态。

### 7.2 排版

- 工作区标题与控制 14–17px；
- 轨迹主摘要 14–15px，技术来源 13px；
- 只有原始 kind/op/ID 使用等宽字体；
- 不使用全大写英文标题或装饰性文案。

### 7.3 本页识别特征

本页的唯一识别特征是“最大化回放舞台 + 底部连续因果记录”，像成熟剪辑/调试工作台而不是后台卡片页。所有其他元素保持克制，不再添加装饰。

## 8. 响应式与键盘合同

- 1440×900：控制条单行，舞台占主要高度，Dock 展开时不改变其自身上限；
- 1280×800：控制条可自然换行，舞台仍大于 Dock；
- 800px 及以下：入口标签与控件形成两行，不发生页面横向溢出；
- 390×844：模式导航仍可到达，预览控制完整可触控，Dock 行不截断关键中文；
- Dock 可通过键盘展开/收起；收起后焦点留在开关，恢复后可回到之前聚焦的轨迹行；
- 轨迹刷新保留 Dock 滚动位置；若原聚焦 sequence 仍存在则恢复焦点且不强制滚动页面；
- `prefers-reduced-motion` 下不依赖动画传达状态。

## 9. 文件边界

允许：

- 新增 `packages/editor/src/styles/preview-workspace.css`；
- 修改 `packages/editor/index.html` 加载该样式；
- 修改 `packages/editor/src/main.ts` 仅补稳定面板锚点；
- 修改 `packages/editor/src/panels/preview-panel.ts` 的 DOM、中文投影、UI-only Dock 状态和消息来源隔离；
- 修改 `packages/editor/src/preview.ts` 仅使失败 reload 不公开旧会话；
- 修改直接相关 Preview 测试与本规格、任务书；
- 最终向既有长期台账追加一段简短结果。

禁止：

- 新建通用 `workbench-dock.ts`；当前只有一个真实调用方，不做预防性抽象；
- 修改 Authoring、Core、CLI、Renderer、Host 或 Shell 生产代码；
- 修改项目格式、存档、审阅、Agent Port、MCP、保存、apply 或 commit 语义；
- 创建第二 iframe、第二 runtime、第二 trace projection 或持久化 Dock 偏好；
- 把 Review、Stats、Audit 或主线 Wave 7 混入本轮；
- 新增依赖、lockfile 变化、截图包、trace 包、哈希清单或复杂恢复门禁。

## 10. 验收

- `#preview-view` 有明确 Preview 面板语义；
- 舞台在展开和收起 Dock 时都是页面最大区域，Canvas 不拉伸；
- Dock 在普通流中可键盘收起/恢复，列表独立滚动；
- 因果行使用中文摘要，技术信息降级，点击仍定位原对象；
- 错误来源 iframe 的 ready/diagnostic/trace 被拒绝；旧 generation/traceId、重复完成与乱序 event 不污染当前记录；
- reload 失败后 `surdetPreviewDebug.interp` 不再公开上一轮解释器；
- 聚焦 Preview 测试、Editor 全量、typecheck、build 通过；
- 1440×900、1280×800 与 390×844 真实浏览器检查无横向溢出、舞台被挤压或不可达控制；
- Luna 只读复审无 BLOCKER/HIGH；
- 精确普通提交、普通 push，远端 CI 通过。
