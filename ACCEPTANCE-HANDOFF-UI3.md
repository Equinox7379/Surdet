# ACCEPTANCE-HANDOFF-UI3：UI 视觉翻新第三阶段——流程图精致化（审阅交接书）

> 本文档写给**审阅本批次的 AI**。前置：UI1（ME 白蓝主题）/UI2（工作区卡片化）已定稿，本阶段沿用同一套设计 token。
> 本地提交：`5c308f5` + 目检修复 `9b99e47`（拖拽平移误选中文字 → #flow-view 补 user-select: none）（已推送：远端 main tip `a5f6a7d`）。
> **状态：已闭环**。用户目检通过（含拖拽修复复验），已移植推送。

---

## 1. 基线预期

| 检查 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **603** 过（editor 125 不变），0 failed |
| `npm run build` | 全部包构建成功 |

## 2. 交付内容（2 文件）

1. `packages/editor/src/panels/flow.ts`：
   - `buildFlowDefs()`：9 种边类型各一个同色箭头 `<marker id="flow-arrow-<kind>">`（orient auto-start-reverse，refX 8.5 使箭头贴线尾不戳进节点）+ `flow-grid` 点阵 pattern（26px 网格、1.3px 圆点 #d3deeb）。
   - `drawEdge()` 增加 `marker-end` 引用——既有的三次贝塞尔曲线（edgeGeometry 早在 M3 前就实现了曲线，本批补上方向可读性）。
   - `renderFlow()`：defs 挂到 svg；world 内底层铺 -4000..8000 的网格 rect（随平移缩放同步）；末尾调用 `buildMinimap()`。
   - `buildMinimap()`：右下角缩略 svg（最宽 180px 等比），全节点矩形概览（当前场景蔚蓝 #0f8ff3，其余 #b3c9e2）+ 当前视口投影框；pointerdown 把对应世界坐标居中并重渲染（点击导航先行，框内拖拽平移留作可选增强）。
2. `packages/editor/src/styles.css`：`.flow-minimap` 定位样式（absolute 右下、半透明白底、细边圆角阴影）；`.flow-menu` 无逻辑改动仅行宽整理。

## 3. 有意为之（请勿误报）

1. **贝塞尔曲线非本批新增**：edgeGeometry 的 C 曲线在 M3 前已存在（跨列/回边/同泳道鼓出），本批补的是箭头、网格、小地图；UI2 交接书"第三阶段贝塞尔化"的表述以本说明为准。
2. **同泳道顺序流仍是直线（L）**：刻意保留（相邻单元短直线更清晰），同样带箭头。
3. **网格随缩放改变点密度**：pattern 用 userSpaceOnUse 跟随 world 变换，缩到很小点变密/放大变疏是预期观感（蓝图感），未做屏幕空间恒定密度。
4. **小地图点击是"居中"不是"精确框选"**：点哪居中哪；视口框只读展示。拖拽视口框平移留作后续可选。
5. **marker id 全局唯一性**：同一时刻只有一个流程图 svg 实例（重渲染先清容器），`flow-arrow-*` id 不会冲突。
6. **无新增测试**：defs/minimap 为纯 DOM 构建逻辑，随目检验收；既有 flow-edit/flow-labels/graph 共 20 组测试全过，证明布局/建链/几何链路无损。
7. **行为零改动**：平移/缩放/点击导航/拖拽建链/右键菜单的既有监听全部未动，仅新增视觉层与一个独立的小地图监听（stopPropagation 不干扰画布 pan）。

## 4. 手动验收（用户目检，需打开项目）

1. 打开 starter，切「流程图」：画布应有淡蓝点阵网格背景；所有连线末端有彩色箭头（顺着线色）；
2. 右下角出现小地图：节点缩略 + 蔚蓝视口框；点击小地图另一处，主画布应跳过去居中；
3. 滚轮缩放/拖拽平移/拖节点建链/右键菜单等既有操作应全部正常（回归确认）；
4. 当前场景在小地图里应为蔚蓝高亮。

## 5. 审阅报告格式（回传给开发方）

```
【UI3 批次审阅报告】
基线复核：typecheck / test(603) / build —— 逐项 通过/失败
交付复核：对照 §2 两文件确认"既有交互零改动"（diff 逐文件）
问题清单：[Major/Minor] 描述 + 位置（没有就写"无"）
误报自查：已对照 §3"有意为之"排除设计取舍
```
