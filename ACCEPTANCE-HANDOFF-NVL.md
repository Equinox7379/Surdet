# ACCEPTANCE-HANDOFF-NVL：NVL 页断行禁则（审阅交接书）

> 本文档写给**审阅本批次的 AI**。请按下述基线复核交付内容，报告格式见文末。
> 批次：NVL 断行禁则（SESSION-HANDOFF §9 已知限制清单第 1 项，工作量最小的候选增量）。
> 本地提交：`3b539c6`（已推送：远端 main tip `3d72ec0`）。
> **状态：已闭环**。审阅通过；手动验收 5 条全部通过（2026-08-06，临时场景 nvl_check 验收后已还原删除）。

---

## 1. 仓库状态

- 独立 Git 仓库 `E:\surdet`（分支 `main`），项目根不再带 `surdet/` 前缀。
- 远端 `surdet` remote main tip = `2b72c7c`（对应本地 `4adba45`）；本批次新增本地提交 `3b539c6`，范围 `4adba45..3b539c6`。
- 工作树除未跟踪过程文档外干净（`git status --short` 应只见 `??` 过程文档）。

## 2. 基线预期（审阅时复核）

| 检查 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **571** 过（core 269 / cli 78 / renderer **107**（97+新 10）/ shell 19 / editor 98），0 failed |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

## 3. 交付内容

**背景**：M5 支柱4（CJK 断行禁则 `wrapCjk`）已接对话框与 Backlog，NVL 全屏小说页一直走 Pixi `wordWrap` 裸断行——禁则标点（，。？！等）会挂行首、开引号会挂行尾、`……` 会被拆行。

**改动文件（仅 2 个）**：

1. `packages/renderer/src/pixi-stage.ts`：
   - 新增字段 `#nvlLineCounts`（与 `#nvlLines` 平行的每条折行数账本）、`#nvlCharsPerLine`（构造时按 `floor((w-160)/20)` 估算，口径与对话框 `#dialogCharsPerLine` 一致，默认 1280 宽 → 56 字/行）。
   - `appendNvlText`：移除 `wordWrap/wordWrapWidth`，改为 `wrapCjk(raw, #nvlCharsPerLine).join('\n')` 预断行；说话人前缀照旧先拼进原文再折行（前缀自然落首行）。
   - 排布：旧定步长 `60 + i*35`（假定每条单行，多行条目视觉重叠）→ 按实际折行数累计 y（行高 28 + 条目间隙 6，起点 y=60）。
   - 淘汰：旧"固定 18 条"→ 按累计行高超过 `h-120`（上下各留 60 边距）淘汰最旧，保底至少留当前条；默认 720 高 → 单线条目上限 17 条。
   - 新增只读 getter `nvlLines`（测试断言句柄）。
   - `clearNvlText` 同步清空 `#nvlLineCounts`（行高账不残留）。
2. `packages/renderer/test/nvl.test.ts`（新增，10 组）：
   - 禁则类 6 组：无损往返（120 字折 3 行）/句号不挂行首（悬挂收进上行）/`……` 不拆/前引号不留行尾（推下一行）/说话人前缀随折行无损/混合标点长文任意折行首字非禁则标点。
   - 布局类 4 组：多行条目占高计入排布（第二条 y = 60+3*28+6 = 150，旧实现会重叠在 95）/超底边淘汰最旧且头条回顶边、末条底不越 `h-60`/长短混排按行高而非条数淘汰/`clearNvlText` 后行高账归零、再追加从顶边开始。

## 4. 有意为之（请勿误报）

1. **每行容量是字数估算非像素测量**：与对话框/Backlog 同口径（M5 定下的排印纪律，SESSION-HANDOFF §9 已声明"对话框断行是字数估算"）。ASCII-heavy 段落会有轻微宽度误差，属已知限制延续，不是本批回归。
2. **行高常量 28 / 间隙 6 硬编码**：NVL 字号 20 固定（无字号设置项），28 ≥ Pixi fontSize 20 实际行高（约 24~25），留行间距；`#nvlTotalHeight` 与排布循环共用同一口径，未抽公共常量是刻意的短代码取舍。
3. **淘汰上限从 18 条变 17 条（纯短句场景）**：按行高预算 600px 计算的自然结果，非疏漏；长条目场景下旧策略会溢出屏幕，新策略不会。
4. **说话人前缀与正文合并折行**：沿用旧行为（前缀拼进原文），与 Backlog"前缀仅首行"口径一致；未做悬挂缩进，属后续可选增量。
5. **`nvlLines` 只读 getter 是新增公开 API**：刻意暴露给测试与宿主巡检；返回内部数组引用（readonly 类型约束），调用方不应改写。
6. **starter 无 @nvl 剧本**：全仓 `@nvl` 仅文档提及，故 simulate/lint 基线不涉及 NVL 路径；NVL 覆盖全部在 renderer 单测层。
7. **adv-renderer 的 NVL 入口（`appendNvlText?.(p.speaker, stripRuby(p.value))`）未动**：ruby 剥离在折行前完成，折行对 ruby 无感。

## 5. 已知限制（本批未处理，用户知情）

- NVL 字号不可配置（20 固定），行高估算随之固定。
- 字数估算断行在 ASCII-heavy 文本有轻微宽度误差（同对话框）。
- 多行条目无悬挂缩进（说话人前缀后的折行顶格）。

## 6. 手动验收清单（待逐条问用户）

> NVL 需真实画面目检；starter 无 @nvl 剧本，验收时加临时场景，验后还原。

1. **长句折行无标点挂行首**：临时剧本写一条 60 字以上、第 56/57 字附近带逗号或句号的台词（`@nvl` 开启后说），确认折行第二行开头不是逗号/句号。
2. **省略号不被拆开**：写一条让 `……` 恰好横跨折行点的台词，确认 `……` 完整在同一行。
3. **多行条目不重叠**：连续 2~3 条长台词，确认上下条目之间不叠字，行距均匀。
4. **滚动淘汰**：连说 20 条以上台词，确认最旧的从页顶消失、页面不溢出屏幕底边。
5. **`@nvl clear` / `@nvl off` 复开**：清页后再说台词，从页顶重新排布，无残留空隙。

## 7. 审阅报告格式（回传给开发方）

```
【NVL 批次审阅报告】
基线复核：typecheck / test(571) / lint / simulate / build —— 逐项 通过/失败
交付复核：对照 §3 逐文件确认（含 nvl.test.ts 10 组断言是否真实锁定禁则行为）
问题清单：[Major/Minor] 描述 + 文件:行号 + 复现步骤（没有就写"无"）
误报自查：本报告所有问题均已对照 §4"有意为之"排除设计取舍
```

## 8. 环境提示（给审阅 AI）

- Windows + pwsh；无 `tail/grep`，用 `Select-Object/-String`；git 用 `git --no-pager`。
- 终端中文 GBK 乱码是显示问题，判内容读文件。
- vitest 输出过滤 ANSI：`ForEach-Object { $_ -replace "`e\[[0-9;]*m", '' }`。
- 测试在 `E:\surdet` 下跑 `npm run test -w @surdet/renderer`（勿用 `npx vitest run -w`，会挂 watch）。
- nvl.test.ts 纯 node 可跑（PixiStage 构造与 PText 构造不触发 WebGL/DOM）。
