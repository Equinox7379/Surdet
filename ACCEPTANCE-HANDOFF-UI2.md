# ACCEPTANCE-HANDOFF-UI2：UI 视觉翻新第二阶段——工作区卡片化（审阅交接书）

> 本文档写给**审阅本批次的 AI**。前置：第一阶段（ME 白蓝主题，UI1 交接书）已定稿，本阶段沿用同一套设计 token。
> 本地提交：`2bbd692`（未推送；与 UI1 三提交一起，审阅通过后按 commit-tree 移植流程推送，范围 `b4e90eb..HEAD`）。

---

## 1. 基线预期

| 检查 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **603** 过（editor 125 不变），0 failed |
| `npm run build` | 全部包构建成功 |

## 2. 交付内容（3 文件）

1. `packages/editor/src/panels/editor.ts`（块编辑区）：
   - 新增 `FLOW_CMDS`/`STAGE_CMDS` 指令分类集合 + `blockTone()`/`badgeTone()` 纯映射（行类型 → 色带类/徽章类）。
   - 块容器附加 `t-*` 类：台词 `t-text`（冷灰）/ 标签 `t-label`（琥珀）/ 流转指令 `t-flow`（蔚蓝）/ 演出指令 `t-stage`（青）/ 变量系统指令 `t-vars`（紫）/ 选项 `t-choice`（绿松）/ 注释空行 `t-dim`（淡出）。
   - 徽章从旧三分（text/label/flow/dim）扩为七分类，与色带同语义。
2. `packages/editor/src/panels/sidebar.ts`（场景侧栏）：场景卡片加 `scene-name`/`scene-meta` 结构；新增字数徽章（去空白字符数）；列表容器 `scene-list`。
3. `packages/editor/src/styles.css`：`.block` 基础加 3px 左色条位 + 七个 `t-*` 色条；`.badge.stage/.vars/.choice` 三个新徽章变体；`.scene-item` 卡片化（独立卡底/细边/阴影/悬浮右移/激活蔚蓝边）+ `.scene-meta` 字数徽章胶囊。

## 3. 有意为之（请勿误报）

1. **分类集合不求穷尽**：`STAGE_CMDS` 只列常见演出指令，未列入的指令落 `t-vars`（紫）——兜底语义是"系统/变量类"，不是 bug；新指令后续按需补集合。
2. **`elif`/`switch` 归流转、`loop` 归流转**：按"改变控制流"口径，与流程图边色语义一致。
3. **标签色用琥珀（#f0a53c）**：属 warn 语义色系（锚点/警示位），非棕色，符合无棕约束。
4. **字数徽章按去空白字符数**：粗粒度概览用途，不追求与统计页口径完全一致（统计页另有精确口径）。
5. **无新增测试**：`blockTone/badgeTone` 为纯映射但强视觉属性，随目检验收；既有 125 组测试全过（含 model/validate 回归）证明行解析链路无损。
6. **行为零改动**：所有 onclick/oninput 逻辑逐字未动，纯展示层增强。

## 4. 手动验收（用户目检）

1. 打开项目选一个场景，块编辑区每块左侧应有彩色色条：台词灰蓝、@bg/@bgm 青色、@jump/@if 蔚蓝、@set/@mod 紫色、@label 琥珀、选项绿松；
2. 左侧场景列表应为独立卡片，每卡右侧有"XX 字"徽章，当前场景蔚蓝描边；
3. 悬浮卡片应有轻微右移反馈；编辑某行后场景卡出现未保存点（已有功能，确认仍在）。

## 5. 审阅报告格式（回传给开发方）

```
【UI2 批次审阅报告】
基线复核：typecheck / test(603) / build —— 逐项 通过/失败
交付复核：对照 §2 三文件确认"行为零改动"（diff 逐文件）
问题清单：[Major/Minor] 描述 + 位置（没有就写"无"）
误报自查：已对照 §3"有意为之"排除设计取舍
```
