# Surdet 编辑器 M5 验收交接书（支柱1 AI 创作闭环 + 支柱4 中文排版）

> 本文档自包含：接手的审阅 AI 不需要额外上下文即可开始。
> 范围：本地 master 两个提交——`889d935`（M4 审阅轮修复：配置表增删行本地重建 + 断循环依赖 + 文案修正 + 还原 3 个 starter 剧本残留）与 `008e878`（M5 本体）。
> M4 主体 `a5881fd` 已通过上一轮审阅（见 `ACCEPTANCE-HANDOFF-M4.md`），本轮不重复审。
> 任务：**独立审阅并出报告**。默认只报告不修复；顺手修小问题必须在报告中逐项列明。

---

## 0. 仓库与提交状态（务必先复核）

- **仓库路径**：`E:\surdet`（Windows，PowerShell）。
  ⚠️ 当前为独立 Git 仓库：项目根为 `E:\surdet`；git 相对路径不带 `surdet/` 前缀。
- **远端**：`surdet` → `https://github.com/Equinox7379/Surdet.git`（main，引擎在根）。
  本地 master 与远端 main 历史无关，推送走 commit-tree 移植流程（仓库主人自理）。
  **请勿 push / force / rebase / reset。**
- **待审提交**（未推送）：
  ```powershell
  git -C "E:\surdet" log --oneline -3
  # 008e878  feat: M5 ——（本轮主体）
  # 889d935  fix: M4 审阅轮修复——（上轮遗留修复）
  git -C "E:\surdet" show 008e878 --stat
  ```

## 1. 回归基线（已实测全绿，复验应一致）

在 `E:\surdet` 下：

| 命令 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **518 过**：core 264 / cli 75 / renderer 90 / shell 19 / editor 70（M5 前 509，+9：hint 2 + 断行禁则 7），只增不减 |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

## 2. M5 交付内容

### 支柱 1：AI 创作闭环（把 lint 变成 AI 的奖励信号）

- **`packages/core/src/lint-hints.ts`（新增）**：`LINT_CODE_HINTS` 集中式错误码修复建议表，覆盖引擎实际产出的**全部错误码**（L001-L004 / S001-S008 / C001-C009 / J001-J004 / V001-V003 / VAR_DECL / T001-T003 / W001-W008 / SCENE_ID / LINT_DUP / LINT / CONFIG / CONFIG_EXPR / NO_CONFIG / EMPTY_VARIABLES / audit 五码）；`hintForCode`（未知码给通用指引）；`attachHints`（批量补齐，已有 hint 不覆盖）。`LintIssue` 增加可选 `hint?: string` 字段（scene-lint.ts），core index 导出。
- **CLI**：`lintProject` 收尾调用 `attachHints`；`surdet lint --json` 输出 `{ ok, sceneCount, issues: [{severity, code, text, hint, file, line, col}] }`，退出码 = 有 error 则 1；**人类可读的文本输出格式不变**（hint 只随 JSON 走，不改变既有终端输出）。
- **`docs/AI-GUIDE.md` v2**：工作流加 `--json` 用法；新增 **§5 自我修正循环**（循环规则 + simulate/audit 深验证 + 交付硬门槛）；原 §5/§6 顺延为 §6/§7；验收标准加 `--json ok=true` 与 simulate 退出码 0。
- 测试：`cli/test/lint.test.ts` +2（每条问题带 hint + JSON 形状稳定）。

### 支柱 4：中文排版

- **`packages/renderer/src/text-wrap.ts`（新增）**：`wrapCjk(text, perLine)` 断行禁则——
  行首禁则字（，。！？：；、）】》」』”…—～ 及半角标点）收进上一行行尾（悬挂 1~2 字）；
  行尾禁则字（（【《「『〈“‘ 及半角开括号）推到下一行；……/—— 连续符不拆行；
  **无损往返**（所有行拼接 === 原文）。renderer index 导出。
- **接入点**（pixi-stage.ts）：
  - 对话框：`wordWrap: true` 移除，改预断行 `wrapCjk(plain, #dialogCharsPerLine).join('\n')`；每行容量构造时按 `floor((1280-160)/26)` 估算；
  - Backlog：定长 40 字 slice 替换为 `wrapCjk` 软换行。
- **自定义字体**（`PixiStage.registerFont(url, family?, timeoutMs=3000)`）：FontFace 加载 + 3 秒超时竞赛；成功 → `document.fonts.add` + `TextStyle.defaultTextStyle.fontFamily`（Pixi v8 官方模式）+ 长驻文本对象（对话框/说话人）直接改样式；失败/超时 **console.warn 静默回退系统字体，不白屏**。starter 接线：`game.config.json` 可选 `font` 字段指向项目内嵌 woff2，加载不阻塞启动（starter 未配置 = 默认字体）。
- 测试：`renderer/test/text-wrap.test.ts` +7（失败用例先行：裸断行会挂标点/拆省略号，wrapCjk 必须避免；行长/无损/边界）。

## 3. 有意为之（审阅时请勿误报为缺陷）

1. **对话框断行从 Pixi wordWrap（像素精确）改为按字数估算预断行（CJK 假设）**：中文场景下 CJK 字宽≈字号成立；ASCII 为主的混排行会有轻微宽度误差——中文市场引擎的刻意取舍。
2. **行首禁则采用"悬挂"形态**：禁则字收进行尾，允许该行超宽 1~2 字（排印惯例），测试按容量+2 余量断言。
3. **hint 不改人类终端输出**：只有 `--json` 携带 hint，文本输出格式与 M5 前完全一致（避免改变既有验收口径）。
4. **字体加载异步不阻塞启动**：先渲染后到位也能生效（长驻对象直接改样式 + defaultTextStyle 覆盖后续新建文本）；加载失败只告警。
5. **NVL 模式与 ruby 注音路径未接禁则**：NVL 与 ruby 合成层走各自排版（ruby 横向布局本无换行）；NVL 禁则列入后续。
6. `LINT_CODE_HINTS` 的 C003 标注“（预留错误码）”——引擎目前不产出该码，hint 为占位（C007 属 @wait 用法错误，已给实 hint，M5 审阅轮修正）。

## 4. 已知限制（不算缺陷，列入后续）

1. 对话框断行为字数估算，ASCII -heavy 段落行宽轻微误差（见 §3-1）。
2. 字体加载晚于首批文本时，已创建的一次性文本（如已打开的 Backlog）不回溯换字体，重开即生效。
3. starter 无真实 woff2 文件（机制就位，等项目放字体）；字体验收为可选项。
4. audit 五码 hint 已覆盖，但 audit 命令本身无 --json（后续可加）。

## 5. 手动验收清单（需浏览器/终端，自动化无法完全代劳）

1. [ ] `node packages/cli/dist/index.js lint examples/starter --json` → 输出合法 JSON、`ok: true`、`issues: []`
2. [ ] hint 实感：临时在 starter 某剧本加一行 `@goto ghost`，跑 `lint --json`，确认该条 issue 带可操作的 `hint`（提示补 @label）；改回
3. [ ] 打开 starter（`npm run dev -w surdet-editor` + 打开 examples/starter 目录）：长台词对话框换行处**标点不挂行首**（starter 台词较短，可临时把某句台词加长到换行验证，改回）
4. [ ] Backlog（游戏内 L 键或编辑器外无法触发——可在块编辑多敲几句长台词后看编辑器外运行效果；此项可标"未验证，理由"）
5. [ ] 字体回退：starter 未配置 font，页面正常显示默认字体、无白屏、console 无 error
6. [ ] （可选）找一个免费可商用 woff2 放入 `content/assets/fonts/`，game.config.json 加 `"font": "content/assets/fonts/xxx.woff2"`，确认对话文本换字体且 console 打印"自定义字体已加载"

## 6. 报告输出格式（必须遵守）

```
## 审阅结论
（一句话：通过 / 有条件通过 / 需整改）

## 基线复验
（第 1 节五条命令的实际执行结果）

## 问题清单（Critical/Major/Minor 分级）
每条：文件:行号 + 现象 + 复现步骤；不确定的标"存疑，未复现"

## 手动验收记录
（第 5 节逐项 ✅/❌/未验证；无法在环境内完成的注明原因）

## 已确认无问题项
（对本文档第 2、3 节各点逐项回应）
```

规则：不要 push/force/rebase；不要提交 commit；修改文件前必须在报告中标注（默认只读审阅）。

## 7. 环境提示

- Windows + PowerShell：无 `tail`/`grep`，用 `Select-Object`/`Select-String`；git 用 `git --no-pager`。
- Node ≥ 20，依赖已安装，无需 `npm install`。
- CLI 测试依赖 core 的 dist：改动 core 源码先 `npm run build -w @surdet/core` 再跑 cli 测试。
- 编辑器 dev：`npm run dev -w surdet-editor`（vite，端口被占会顺延）。
