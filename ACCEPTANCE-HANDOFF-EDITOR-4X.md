# ACCEPTANCE-HANDOFF-EDITOR-4X：编辑器四增量收尾（审阅交接书）

> 本文档写给**审阅本批次的 AI**。请按下述基线复核交付内容，报告格式见文末。
> 批次：编辑器四增量一次性交付（SESSION-HANDOFF §9 已知限制清单第 3/4/5/6 项相关：审计一键加变体+名词表导入导出、日历画布三件套、配置 undo、预览多场景）。
> 本地提交：`e07711f` + 审阅轮修复 `2ec38cf` + 验收轮修复 `a7d69dc`（成就表快照遗漏）+ `b48ad66`（预览播放管线三连修）（已推送：远端 main tip `640f1df`）。
> **状态：已闭环**。审阅 1 条 Minor 已修；手动验收 5 条全部通过（2026-08-06，验收期间临时改动均已还原）。
> 审阅状态：已审，问题清单仅 1 条 Minor（连线编辑未拍撤销快照），已在 `2ec38cf` 修复。
> 验收轮修复：`a7d69dc` —— 成就表独立局部 mkInput 遗漏快照（用户反馈定位）；`b48ad66` —— 预览卡住：①boot() 缺帧驱动/点击接线（打字机永不推进）；②变量表未下发，真实剧本 @set/@if 抛运行时错误卡死；③运行时错误无 UI 反馈。均已修复并用真实四场景自动化终验通过（@else 分支/条件选项过滤/跨场景跳转/特效穿透/ended）。

---

## 1. 仓库状态

- 独立 Git 仓库 `E:\surdet`（分支 `main`），项目根不再带 `surdet/` 前缀。
- 远端 `surdet` remote main tip = `3d72ec0`（对应本地 `3b539c6`，NVL 批次）；本批次新增本地提交 `e07711f`。
- 工作树除未跟踪过程文档外干净。

## 2. 基线预期（审阅时复核）

| 检查 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **593** 过（core 269 / cli 78 / renderer 107 / shell 19 / editor **120**），0 failed |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功（editor 双入口 index.html + preview.html） |

## 3. 交付内容（四个增量，全部限于 packages/editor）

### 增量①：审计一键加变体 + 名词表导入导出

- `panels/audit-panel.ts`：新增 `computeSpeakerPairs(counts)` 纯函数（与 core `auditSpeakers` 同口径：编辑距离 1 / 前缀包含≤3 字；出现更多的一方作 canonical，平手取先出现者）。CONSIST_TYPO / CONSIST_HONORIFIC 条目附"＋名词表：'变体' → '规范词'"按钮，点击经 `onAddVariant` 钩子路由到配置页写盘入口（面板不直接依赖 config 模块，保持无环）。
- `panels/config.ts` 导出 `addTerminologyVariant(canonical, variant)`：找到/新建 canonical 条目 → variants 追加（幂等：已存在提示不重复加）→ 经既有 `rowsToTerminology` 校验 + `saveConfigFile` 写盘 terminology.json；共享配置行模型缓存与撤销栈。
- `panels/config.ts` 名词表区块新增"⤓ 导出 JSON / ⤒ 导入 JSON"：导出 = 内存行模型（含未保存编辑）经校验后下载 terminology.json；导入 = 文件解析经 `normalizeTerminologyImport` 校验后**替换内存行模型**（不自动写盘，提示"确认后点保存"）。
- `config-edit.ts` 新增 `normalizeTerminologyImport(raw)`：顶层必须 `{ terms: [...] }`、每条必须有非空 canonical、variants 过滤非字符串；非法形状返回中文错误描述（状态栏展示）。

### 增量②：日历画布三件套

`panels/calendar-map.ts`（纯函数均可测）：
- **重叠检测**：`findOverlaps(geoms)` AABB 判定（中心距 < 半宽和且 < NODE_H=40，贴边不算）；重叠节点红框（`#c86a6a`）+ 画布上方"⚠ N 对节点重叠"提示；拖开松手重渲染后自动消除。
- **箭头连线**：SVG `<defs><marker id="map-arrow">`；`edgePoint(from,to,w,h)` 把连线两端修剪到节点矩形边界（箭头不被节点遮盖；重合点防御除零）。
- **拖拽连线编辑**：节点右侧金色圆点（连接点）pointerdown 拖出临时虚线，松手命中另一节点矩形 → `addRequiresToRow` 写行模型 requires（JSON 数组，幂等去重）→ 重渲染；点击连线（附 12px 宽透明命中线）→ `removeRequiresFromRow` 删除该前置。节点拖拽移动时受影响连线实时跟随（`refreshLines`）。
- 签名变化：`renderCalendarMap(container, rows, onMoved, opts?: { onDragStart?; onBeforeEdit? })`（新参可选，旧调用兼容；`onBeforeEdit` 在连线增删变更前触发，保证 Ctrl+Z 可撤销——审阅轮 Minor 1 修复，`2ec38cf`）。

### 增量③：配置编辑撤销/重做

- `history.ts` 新增通用快照栈（纯逻辑可测）：`SnapshotHistory<T>` / `createSnapshotHistory` / `snapshotPush`（复用 COALESCE_MS 打字合并；SNAPSHOT_HISTORY_LIMIT=50）/ `snapshotUndo` / `snapshotRedo`（undo 后 lastPushAt 归零防合并）。
- `panels/config.ts`：配置行模型全量快照（七个区块缓存，null 保持"未载入"语义）；所有变更前拍快照——文本输入 coalesce=true 合并、结构操作（增删行/勾选/类型切换/拖拽开始/导入/一键加变体）coalesce=false。`configUndo()/configRedo()` 恢复快照 + 本地重建（rerenderConfig，**不走从盘重读**——M4 纪律）；状态栏提示"已撤销（未写盘，保存后生效）"。
- 进配置页从盘重读 = 基线更新：**清空撤销栈**（防撤销回上一轮内存态）。
- `main.ts`：撤销/重做按钮与 Ctrl+Z/Y/Shift+Z 按 `state.mainTab === 'config'` 路由到配置栈，其余标签页走剧本文本栈（两栈互不干扰）。

### 增量④：预览支持多场景跳转

- `panels/preview-panel.ts`：`collectPreviewScenes(scenes)` 纯函数（全量内存场景，含未保存编辑，同 id 去重保留先到者）；`parsePreviewVariables(configText)` 从 game.config.json 提取变量声明（容错解析）；postMessage payload 改为 `scenes + variables`。
- `preview.ts`（iframe runner）：全量场景逐一 `compileScene` 注册进 SceneRegistry（单场景失败报错定位到具体场景 ID）；入口场景不在场景集时明确报错；VariableStore 用下发变量表（`b48ad66` 后）；`@jump` 跨场景正常跳转；帧驱动/点击/空格推进接线；推进回调 guardRun 将运行时错误经 preview-error 覆盖层可见化。
- **协议破坏性变更**：父子窗口同批更新（同一提交），无兼容包袱。

### 测试（+20 组，editor 98 → 118）

- `test/history.test.ts` +5：快照栈合并/不合并/上限/undo-redo 往返/归零防合并。
- `test/calendar-map.test.ts` +4：findOverlaps（含贴边不算）、edgePoint、addRequiresToRow 幂等、removeRequiresFromRow 非法原文不改写。
- `test/terminology-import.test.ts`（新）4 组：合法形状/非字符串过滤/非法形状报错/空数组合法。
- `test/preview-scenes.test.ts`（新）3 组：收集顺序/去重剔除/listLabels 回归。
- `test/audit-pairs.test.ts`（新）4 组：笔误对方向/称谓对方向/平手与无关不配对/前缀差>3 不配对。

## 4. 有意为之（请勿误报）

1. **配置 undo 不写盘**：撤销只恢复内存行模型，磁盘文件不动，需再点保存才生效（与剧本文本 undo 语义一致：undo 管内存态，保存管落盘）。状态栏已明示。
2. **配置快照含未载入区块的 null**：恢复时保持 null（下次用到才从盘/内存源惰性解析），不是丢数据。
3. **一键加变体会连带保存名词表未保存的其它编辑**：addTerminologyVariant 走完整 rowsToTerminology + 写盘，与手动点"保存名词表"同路径——刻意选择"点即生效"的闭环语义。
4. **导入不自动写盘**：导入只替换内存行模型，必须另点保存（防误选文件直接毁盘；可撤销）。
5. **重叠检测只提示不阻止**：红框 + 提示，不限制拖拽落点（重叠可能是用户意图，如堆叠标注）。
6. **贴边（距离恰好等于半宽和/高）不算重叠**：`<` 不含等号，允许紧凑摆放。
7. **连线删除无确认弹窗**：点击连线即删，配置页 Ctrl+Z 可撤销（连线增删变更前均拍快照，`2ec38cf` 后声明即实现）；且 requires 只是表格 JSON 列的镜像。
8. **连接点拖出时源节点位置用渲染时快照**：连接拖拽与节点移动互斥（同一手势只做一件事），无陈旧坐标问题。
9. **预览变量表来自 game.config.json（内存态）**：预览仍不实例化全家桶宿主（@battle/@calendar 等 system 指令穿透占位横幅不变）；@if 分支按声明初始值走；未打开项目时变量表为空，含变量的剧本会经 preview-error 覆盖层报出具体错误（不再静默卡死）。
10. **preview 协议不做向后兼容**：父子同提交升级，仓库内无其它消费者。
11. **称谓对 canonical 方向按出现频次**：这是启发式（高频 = 规范），用户可在名词表里再改；一键加入后审计面板该条目依然存在（因为剧本里还在用变体），直到改写剧本或把变体当合法用法——这是 TERM_VARIANT 的语义，不是 bug。

## 5. 已知限制（本批未处理，用户知情）

- 配置 undo 不覆盖 game.config.json 的非 variables 顶层键（只覆盖七大区块行模型）。
- 日历画布重叠检测不给出自动避让建议。
- 预览内 @choice 带 `[if:变量]` 的条件选项按空变量表求值。
- 审计一键加变体仅覆盖称谓类条目（CONSIST_*）；TERM_VARIANT 条目本身已在名词表中，无"加"的动作。

## 6. 手动验收清单（待逐条问用户；需 Chrome/Edge + 打开游戏目录）

> 前置：浏览器打开编辑器（`npm run dev -w surdet-editor`），"打开游戏目录"选 examples/starter。

1. **一键加变体**：starter 剧本里临时把一个说话人写错一字（如"凛"→"冷"出现 1 次）保存后切审计标签页 → CONSIST_TYPO 条目上有"＋名词表"按钮 → 点击 → 状态栏提示已保存 → 配置页名词表出现新条目；验后还原剧本与 terminology.json。
2. **名词表导入导出**：配置页名词表区块"导出 JSON"下载文件 → 改一改 → "导入 JSON"选回 → 表格更新且提示未写盘 → Ctrl+Z 可撤销导入 → 点保存写盘。
3. **日历三件套**：配置页日历区块（starter calendar.json 有节点）：拖两个节点重叠看红框与提示；从节点右侧圆点拖到另一节点出现带箭头虚线（表格 requires 列同步）；点击连线删除；拖节点时连线跟随；**连线增删后 Ctrl+Z 能恢复/撤销（审阅轮 Minor 1 修复项，复验重点）**。
4. **配置 undo**：配置页改几个单元格/增删行 → Ctrl+Z 逐步撤销、Ctrl+Shift+Z/Ctrl+Y 重做 → 切到块编辑标签页 Ctrl+Z 不影响剧本栈；重新进配置页（切走再切回）撤销栈清空。
5. **预览多场景**：块编辑选 ch01_01 → 预览标签页播放 → 走到 @jump ch01_02 处能正常跳到第二场景继续播（旧行为是编译失败报错）。

## 7. 审阅报告格式（回传给开发方）

```
【编辑器四增量批次审阅报告】
基线复核：typecheck / test(591) / lint / simulate / build —— 逐项 通过/失败
交付复核：对照 §3 四增量逐项确认（含 20 组新测试是否真实锁定行为）
问题清单：[Major/Minor] 描述 + 文件:行号 + 复现步骤（没有就写"无"）
误报自查：本报告所有问题均已对照 §4"有意为之"排除设计取舍
```

## 8. 环境提示（给审阅 AI）

- Windows + pwsh；无 `tail/grep`，用 `Select-Object/-String`；git 用 `git --no-pager`。
- 终端中文 GBK 乱码是显示问题，判内容读文件。
- vitest 输出过滤 ANSI：`ForEach-Object { $_ -replace "`e\[[0-9;]*m", '' }`。
- 测试在 `E:\surdet` 下跑 `npm run test -w surdet-editor`（勿用 `npx vitest run -w`，会挂 watch）。
- 编辑器 dev：`npm run dev -w surdet-editor`（5174 起，被占自动顺延）。
