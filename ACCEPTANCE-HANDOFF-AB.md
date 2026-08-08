# ACCEPTANCE-HANDOFF-AB：A 组打磨 + B 预览轻宿主（审阅交接书）

> 本文档写给**审阅本批次的 AI**。请按下述基线复核交付内容，报告格式见文末。
> 批次：用户点单"A 组三个小打磨项 + B 预览全家桶轻宿主"（SESSION-HANDOFF §9 对话框断行项随之关闭）。
> 本地提交：`b4e90eb`（已推送：远端 main tip `86841ff`）。
> **状态：已闭环**。审阅通过；手动验收 4 条全部通过（2026-08-06，验收残留已自行还原，工作树干净）。

---

## 1. 仓库状态

- 独立 Git 仓库 `E:\surdet`（分支 `main`），项目根不再带 `surdet/` 前缀。
- 远端 `surdet` remote main tip = `640f1df`（对应本地 `b48ad66`）；本批次新增本地提交 `b4e90eb`。
- 工作树除未跟踪过程文档外干净。

## 2. 基线预期（审阅时复核）

| 检查 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **603** 过（core 269 / cli 78 / renderer **112**（107+5）/ shell 19 / editor **125**（120+5）），0 failed |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

## 3. 交付内容（四个增量）

### A1：编辑器崩溃保险

- `src/autosave.ts`（新模块，纯逻辑可测）：
  - `buildAutosave(dirName, scenes, now)`：仅收 dirty 场景（干净内容磁盘已有）；无 dirty 返回 null。
  - `parseAutosave(raw)`：形状校验解析，坏 JSON/非法形状一律按无快照处理不抛错；条目级容错（坏条目跳过）。
  - `pickRecoverable(payload, dirName, scenes)`：同项目 + 快照文本与当前内存不同才算可恢复。
  - `writeAutosave/readAutosave/clearAutosave`：localStorage 薄封装，隐私模式/超限静默降级。
  - `AUTOSAVE_INTERVAL_MS = 30_000`（崩溃最多丢半分钟编辑）。
- `src/main.ts`：模块级 `setInterval` 定时快照（有 dirty 写备份，全干净清旧备份）；`tryAutosaveRecover()` 在恢复确认后写回场景文本（置脏）+ renderAll/runValidate/renderSidebar。
- `src/project-io.ts`：`bindProjectIoHooks` 新增可选钩子 `onProjectLoaded`（openProject/loadDemoProject 末尾触发恢复检查）与 `onSaved`（saveAll 末尾清除备份；演示项目脏标记保留时下一轮定时快照自动重建）。

### A2：对话框像素级断行

- `renderer/src/text-wrap.ts`：`wrapCjkMeasure(text, maxWidth, measure)` —— 与 `wrapCjk` 完全相同的禁则规则（行首禁则悬挂/行尾禁则前移/连续符不拆/无损往返），但行容量用宿主传入的 `measure` 真实测量宽度贪心求最长前缀；单字超宽强制独占一行防死循环。
- `renderer/src/pixi-stage.ts`：模块级惰性 `dialogMeasureCtx`（`document.createElement('canvas').getContext('2d')`，非浏览器环境 null）；`#wrapDialogText(plain)` 优先像素测量（font = 对话框当前 fontSize + fontFamily，含 registerFont 后的自定义字体），无测量环境降级字数估算（`#dialogCharsPerLine` 口径保留为降级路径）。
- 覆盖范围：**仅对话框**。NVL/Backlog 维持字数口径（字号小、段落短，误差不可感；避免测量开销）。

### A3：配置撤销补顶层键口径

- `panels/config.ts`：`ConfigSnapshot` 增加 `gameConfigText` 字段；`takeConfigSnapshot` 一并捕获 `state.gameConfigText`；`restoreConfigSnapshot` 恢复之（仅内存态回退，磁盘不回滚，与行模型 undo 同语义）。

### B：预览接全家桶轻宿主

- `panels/preview-panel.ts`：`send()` payload 追加 `configs: { calendar, events, growth, achievements }`（来自 `state.configFiles`，编辑器管理的四套）。
- `preview.ts`（iframe runner）：
  - 模块级 `store/registry` 引用 + 系统实例（calendar/growth/achievements/affection/scheduler），每次 `load` 按 configs 重建，构造注入 VariableStore；`tryBuild` 形状容错（非法配置 → null 走占位横幅）。
  - `bus.on('system')` 分流：`@calendar` 完整交互（pauseHost → showMap(buildMapView) → 节点点击 enter（eventId 场景存在则 hostJump 演出）→ 结束回合 advanceTurn + 回合尾事件调度（带演出场景则快照挂起 + hostJump，sceneEnd 后 loadSnapshot 续跑，同 starter 语义）；回合头事件 effects 结算）；`@achievement unlock` 解锁横幅；`@affection` 阶段横幅；`@event` 好感消耗；其余（`@battle`/`@shop` 等）占位横幅（配置不在编辑器管理范围）。
  - `bus.on('growth')`：升级横幅 + levelEvents 场景跳转（场景存在才跳）。
  - `surdetPreviewDebug` 探针追加 `calendar` 字段。
- **据点指令面板（showBaseCommands）不在预览范围**：据点节点按普通节点 enter（轻宿主取舍）。

### 测试（+9 组，603 总）

- `renderer/test/text-wrap.test.ts` +5：等宽测量与字数版逐字一致（含禁则样本）/变宽无损往返/窄 ASCII 容字/禁则悬挂/单字超宽防死循环。
- `editor/test/autosave.test.ts`（新）+4：仅收 dirty/全干净 null、形状校验与坏条目容错、恢复判定（同项目且文本不同）、跨项目/无快照/场景消失不恢复。

## 4. 有意为之（请勿误报）

1. **A1 只备份 dirty 场景**：干净内容磁盘已有；恢复提示仅在快照文本≠当前内存时出现（重开项目磁盘读回的内容与崩溃前内存一致时不打扰）。
2. **A1 定时 30s 是折中**：更短收益递减；恢复询问用原生 `window.confirm`（与变量删除保护同风格），不做花哨 UI。
3. **A1 恢复后不自动进 undo 栈**：直接写回文本置脏（恢复是"载入"语义，不是"编辑"语义）。
4. **A2 仅对话框**：NVL/Backlog 保持字数口径是刻意取舍（见 §3）；`#dialogCharsPerLine` 保留未删（降级路径使用）。
5. **A2 行首禁则悬挂可超宽**：与字数版同口径（排印惯例），测量版同样允许。
6. **A3 撤销不回滚磁盘**：变量保存是即时写盘的，undo 只退内存态，再保存才落盘——与行模型语义一致，状态栏有"未写盘，保存后生效"提示。
7. **B 不含 battle/shop/ngp**：这三套配置（combat.json/shop.json/ngp.json）不在编辑器 configFiles 管理范围，预览里继续占位横幅；不是遗漏。
8. **B 据点指令面板省略**：轻宿主取舍，据点按普通节点 enter。
9. **B 迷雾森林首回合不可见**：`visibleNodes()` 的引擎语义（requires 未解锁），与 starter 真实运行一致，非预览 bug。
10. **B 预览内挂起状态字面量是 `'paused'`**（配合解释器私有 hostPaused 标志），不存在 `'paused-host'` 字面量。
11. **预览轻宿主系统随每次播放重建**：多次播放状态不延续（每次 `load` 全新 VariableStore/系统实例），符合"预览"语义。

## 5. 已知限制（本批未处理，用户知情）

- A1 备份粒度 30s：崩溃丢最多半分钟编辑；配置页编辑（行模型）不在备份范围（只备份场景文本）。
- A2 测量用 2D canvas 字体度量，与 Pixi WebGL 渲染存在理论亚像素差异（断行决策级别不可感）。
- B 预览无存档：日历/好感等系统状态随每次播放重置；战斗/商店仍占位。

## 6. 手动验收清单（待逐条问用户）

> 前置：编辑器 `npm run dev -w surdet-editor`，打开 examples/starter。

1. **崩溃保险**：随便改一行剧本（不保存），等约 35 秒；F5 刷新页面 → 重新打开游戏目录 → 应弹出恢复询问（列出场景名与备份时间）→ 确认后改动回来了；再点「保存全部」后刷新重开，不再弹询问。
2. **像素断行**：预览 ch01_01 播放几句台词，对话框折行正常、无标点挂行首（与之前观感一致，中英混排更准）。
3. **预览日历轻宿主**：预览 ch01_01 走到选择肢随便选 → 跳 ch01_02 → 自动跳 ch02 → 出现**日历地图面板**（回合/AP/节点/结束回合按钮）：能点节点（AP 够时进入扣 AP）、点"结束回合"推进回合，最后剧情回到对话继续。
4. **A3（低感知，选验）**：配置页变量表点"保存变量表"后 Ctrl+Z，内存表格回退（状态栏提示"未写盘"）。

## 7. 审阅报告格式（回传给开发方）

```
【AB 批次审阅报告】
基线复核：typecheck / test(603) / lint / simulate / build —— 逐项 通过/失败
交付复核：对照 §3 四增量逐项确认（含 9 组新测试是否真实锁定行为）
问题清单：[Major/Minor] 描述 + 文件:行号 + 复现步骤（没有就写"无"）
误报自查：本报告所有问题均已对照 §4"有意为之"排除设计取舍
```

## 8. 环境提示（给审阅 AI）

- Windows + pwsh；无 `tail/grep`，用 `Select-Object/-String`；git 用 `git --no-pager`。
- 终端中文 GBK 乱码是显示问题，判内容读文件。
- vitest 输出过滤 ANSI：`ForEach-Object { $_ -replace "`e\[[0-9;]*m", '' }`。
- 测试在 `E:\surdet` 下跑（勿用 `npx vitest run -w`，会挂 watch）。
- 编辑器 dev：`npm run dev -w surdet-editor`（5174 起，被占自动顺延）；调试探针 `window.surdetEditorDebug` / iframe 内 `window.surdetPreviewDebug`。
