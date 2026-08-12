# Surdet Player Experience Wave 5B — Layout Polish 交付报告

## 结论

本轮完成了三项公共 Renderer `DialogueLayer` 视觉收口：

1. 选择枝整体以逻辑画布 `1280×720` 的几何中心 `(640,360)` 为基准；
2. 对话等待小光点在命令栏可见时移动到命令栏左侧安全区，隐藏时回到底部等待区；
3. Backlog “文字记录（滚轮/PageUp/PageDown 滚动 · 点击任意处关闭）”标题使用白色主题 token `colors.text`。

生产改动只落在：

- `packages/renderer/src/layers/dialogue/dialogue-layer.ts`

测试改动只落在：

- `packages/renderer/test/layers/dialogue-layer.test.ts`

未修改 Host、Core、Shell、CLI、Starter、Zero 业务代码、回退/恢复、性能体系、资产、音频、剧情、DSL、存档格式或文档治理。

## 红灯 → 绿灯证据

测试先行记录如下：

- 初次加入真实 Pixi 几何和主题断言后，聚焦文件 `8` 项中 `3` 项失败：
  - 选择组中心相对 `y=360` 的误差为 `70` logical pixels；
  - 小光点与命令栏实际 bounds 相交；
  - 标题实际 fill 为 `461847`（`textOnAccent`），目标 `colors.text` 为 `15922943`。
- 补齐 Node 测试环境中既有的 Canvas/document stub 后，失败原因保持为上述三个产品合同，而非 harness 缺陷。
- Task 1 修复后：选择枝聚焦测试转绿；同文件为 `6 passed / 2 remaining failures`。
- Task 2、Task 3 修复后：
  - `npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts`
  - `8/8` 通过。

精确断言包括：

- 1/2/3 项选择的真实 holder bounds 组中心误差不超过 `1` logical pixel；水平中心误差不超过 `1`；相邻卡片间距为 `12`；均在 `1280×720` 范围内；pointerdown 索引不变；无额外 ticker/listener，选择淡入仍保留一个 tween。
- 命令栏可见时，小光点不与真实命令栏 bounds 相交，按圆半径 `9` 计算的可见水平间隔不少于 `9`；命令栏隐藏时回到 `(1212,674)`；极端宽度没有安全空间时隐藏；脉动不改变 x，y 仅在锚点上下 `3` 内变化；重复重建不增加 children、ticker、listener、tween 或 dialogue display owner。
- Backlog 标题文本、`y=30`、viewport mask、viewportTop、正文滚动和 overlay 层级均保持；标题绑定为 `{ fill: 'text' }`，主题切换后仍跟随新的 `colors.text`；不存在旧的 `Ctrl+F 搜索` 固定提示。

## 具体实现

### 选择枝

`DialogueLayer.layout()` 使用真实 label 高度加既有卡片 padding 推导每张卡片高度，使用固定局部间距 `gap=12`，以 `(height-totalHeight)/2` 计算组顶部，再保持原有水平居中、顺序、pointer 回调、hover 和淡入逻辑。

### 小光点

新增仅供 `DialogueLayer` 使用的私有命令栏矩形和小光点锚点状态。命令栏可见时，圆心置于命令栏左边界外安全位置；考虑 Pixi 描边的可见 bounds 后使用 `rail.left - 19`，仍满足至少左移 `18` 的合同并保留至少 `9` 的可见间隔。命令栏隐藏时恢复 `x = width - 68`、`y = height - 46`。没有新增 ticker、timer、公共配置或第二套命令栏布局算法。

### Backlog 标题

标题初始化从 `textOnAccent` 改为 `this.#theme.colors.text`，主题投影从 `{ fill: 'textOnAccent' }` 改为 `{ fill: 'text' }`；标题坐标、文案、mask、viewport 和滚动逻辑未改动。

## 门禁结果

以下命令均在本轮实际执行并退出码 `0`：

| 命令 | 结果 |
|---|---|
| `npm run test -w @surdet/renderer -- --run test/layers/dialogue-layer.test.ts` | `8/8` |
| `npm run test -w @surdet/renderer` | `49` files / `403` passed |
| `npm run typecheck -w @surdet/renderer` | 通过 |
| `npm run build -w @surdet/renderer` | 通过 |
| `npm run typecheck -w zero-after-midnight` | 通过 |
| `npm run build -w zero-after-midnight` | 通过 |
| `npm run lint -w zero-after-midnight` | `11` 场景，`0` errors，`0` warnings |
| `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000` | `23/23` choice，`3` endings，runtime errors `0` |
| `node examples/zero-after-midnight/scripts/check-assets.mjs` | `assets ok: 44` |
| `git diff --check` | 通过 |
| `git ls-files '*.log'` | 空 |

本轮按当前附件授权没有执行 `npm run verify:all`、性能比较/资格化、Wave 5C Electron 诊断、新 Shell runner 或大型截图矩阵；这些不是本轮局部公共 Renderer 修复的必要门禁。

## Git 与停止边界

实现提交链：

1. `4ee8a5d3717cb037b7f92beb861d3fbd1d413bf8` — `feat(renderer): center dialogue choices`
2. `7f5cf6c5e238bf91b1ef49ff6b248ccedb067b35` — `fix(renderer): polish dialogue layout`

报告生成前的实现 HEAD 为 `7f5cf6c5e238bf91b1ef49ff6b248ccedb067b35`，当时相对 `surdet/main` 为 `2 0`；本报告和计划台账的普通文档提交完成后，以终端复核输出作为最终文档闭环 HEAD、ahead/behind 和工作树事实，并在交付回复中重新读取本报告与计划文件的字节数和 SHA-256。

本轮：

- 未 push；
- 未部署；
- 未打包 EXE；
- 未发行；
- 未进入 M9；
- 未处理性能；
- 未触碰五个受保护文件：`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`；
- 未进行 Electron 人工视觉验收；等待总经理审阅后再另行部署。

状态：

```text
PLAYER_EXPERIENCE_WAVE_5B_LAYOUT_POLISH_COMPLETE
CHOICE_CENTERING_VERIFIED
CONTINUE_INDICATOR_DECONFLICTED
BACKLOG_TITLE_WHITE_VERIFIED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
NOT_DEPLOYED
WAVE_5B_MANUAL_VISUAL_VALIDATION_PENDING
WAITING_FOR_REVIEW
```
