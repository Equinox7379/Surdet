# Surdet 编辑器 M6 验收交接书（E4 内嵌预览 + E5 制作工具）

> 本文档自包含：接手的审阅 AI 不需要额外上下文即可开始。
> 范围：本地 master 单个提交 `2f6d1b1`（M6 本体，16 文件 +740/−19）。
> 此前里程碑（M1–M5 及其审阅轮修复）均已通过审阅并推送远端，本轮不重复审。
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
  git -C "E:\surdet" log --oneline -2
  git -C "E:\surdet" show 2f6d1b1 --stat
  ```

## 1. 回归基线（已实测全绿，复验应一致）

在 `E:\surdet` 下：

| 命令 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **529 过**：core 264 / cli 75 / renderer 90 / shell 19 / **editor 81**（M6 前 70，+11：搜索 6 + 统计/标签列表 5），只增不减 |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功；**editor dist 产出 index.html + preview.html 两个入口** |

## 2. M6 交付内容

### E4 内嵌实时预览（主区新增"预览"标签页）

- **`packages/editor/preview.html` + `src/preview.ts`（新增）**：iframe 内精简 runner——core 编译 + Interpreter + AdvRenderer + PixiStage（真实渲染栈，与运行时无漂移）。vite 多页面构建（`vite.config.ts` rollupOptions.input 双入口）。
- **postMessage 协议**：父窗口 → 预览 `{type:'surdet-preview-load', payload:{sceneId, text, startLabel?, fast?}}` 与 `{type:'surdet-preview-fast', fast}`；预览就绪回 `surdet-preview-ready`。**预览源 = 编辑器内存中的当前场景文本（未保存也能预览）**。
- **预览工具条**（`src/panels/preview-panel.ts`）：从场景开头 / 从 @label 播放（下拉，`listLabels` 纯函数可测）、快进开关（1000 字/秒近似瞬时 vs 30 字/秒）、▶ 播放/重载。
- **宿主指令占位**：`@battle/@calendar/@shop…` 在预览无宿主，解释器直接穿透，预览侧显示"[宿主指令占位] @xxx（预览模式穿透）"横幅并继续（与计划一致：预览不实例化全家桶宿主）。
- 预览编译失败在 iframe 内显示错误文本（`#preview-error`），不影响编辑器本体。

### E5 制作工具

- **跨场景搜索/替换**（`src/search.ts` 纯逻辑 + `src/panels/search-panel.ts` UI，块编辑标签页内搜索栏）：
  文本/正则双模式（文本模式自动转义正则字符）、逐行匹配带 `场景:行号` 定位、点击结果跳转场景并滚动到行、上限 500 条防 UI 拖垮；
  **全部替换走 history**（`setSceneText` 每场景一个独立撤销点，可 Ctrl+Z 逐场景撤销），替换后自动重调度校验。
- **制作统计面板**（`src/stats.ts` 纯逻辑 + `src/panels/stats-panel.ts`，主区"统计"标签页）：
  场景数/总字数/台词行/旁白/选择肢/结局数（@clear）/CG 解锁去重/@wait 累计/预估通关时长（30 字/秒 + wait + 转场各 400ms 估算）+ 分场景表格。
- **新建场景模板**（`src/panels/sidebar.ts`）：新建场景时第二道 prompt 选模板：0 空白 / 1 纯对话 / 2 选择分支 / 3 演出制作 / 4 结局（带注释的 .gal 片段，`{id}` 占位替换）。
- **快捷键**：Ctrl+F 聚焦搜索（自动切块编辑标签页）、Ctrl+P 预览标签页（Ctrl+S/Z/Y 原有）。
- **依赖与构建**：editor 新增 `@surdet/renderer` 依赖（预览复用真实渲染栈）；`package-lock.json` 已同步。
- 测试 +11：搜索（buildMatcher 转义/非法正则、跨场景匹配/正则/截断、替换计数）+ 统计（全指标、预估时长、空项目）+ listLabels。

## 3. 有意为之（审阅时请勿误报为缺陷）

1. **预览用真实 PixiStage 而非 DOM 降级舞台**：与运行时零漂移优先于轻量；代价是预览 iframe 需要 WebGL（现代浏览器均可）。
2. **预览穿透宿主指令**：预览不实例化全家桶宿主（计划原文），横幅占位后继续；不做宿主模拟。
3. **替换的撤销粒度 = 每场景一个撤销点**（非全局单点）：多场景替换需逐场景 Ctrl+Z，状态栏已明示。
4. **预估时长是估算**：30 字/秒缺省速度 + @wait 累计 + 转场各 400ms；不含选择/交互等待（面板脚注已注明）。
5. **搜索结果上限 500 / 展示 200**：防超大项目拖垮 UI，超限时提示总数。
6. **E5-3 术语一致性面板本轮未做**：audit 逻辑在 cli 包，搬进编辑器需先下沉 core（分层纪律），单独立项列入后续（见 §4）。

## 4. 已知限制（不算缺陷，列入后续）

1. 术语一致性面板（E5-3）未做，需 audit 下沉 core 后实施。
2. 预览不支持多场景跨场景跳转链路（@jump 到未传入的场景会编译失败显示错误）——预览定位为单场景快速验证。
3. 预览不加载项目素材（占位素材），字体/素材真实效果以 `npm run dev` 完整运行为准。
4. 统计的 CG 收集率只统计 @unlock_cg 出现数，未与 gallery.json 总数做比（后续可加）。

## 5. 手动验收清单（需浏览器，已做过自动化冒烟的标注了）

冒烟已过（自动化）：5 个标签页存在、搜索栏就位、统计卡片空载正常、预览工具条+iframe 正常、console 无 error。
以下需真人操作（`npm run dev -w surdet-editor` → 打开 `examples/starter`）：

1. [ ] **预览播放**：选中 ch01_01 → "预览"标签 → iframe 内应看到对话框+台词快进播放；切"从 @label answer_sword"再播放，应从该标签后开始
2. [ ] 预览中遇到 `@shop/@battle` 时应看到"[宿主指令占位]"横幅后继续
3. [ ] **搜索**：块编辑搜索栏输入"凛"→ 搜索 → 结果列表带 `场景:行号`；点击某条 → 跳到对应场景并滚动高亮该行
4. [ ] **替换可撤销**：搜索某词（如"凛"改成"测试"）→ 全部替换 → 状态栏提示替换数 → 在受影响场景 Ctrl+Z → 该场景恢复原文
5. [ ] **统计**：打开 starter 后"统计"标签 → 场景数 4、字数/台词/选择肢/结局数非零且与剧本一致（ch02 有 1 个 @clear → 结局数 ≥1）
6. [ ] **场景模板**：新建场景输入名字后弹模板选择；选 2（选择分支）→ 生成的场景含 @choice + 两个 @label；删掉测试场景
7. [ ] 快捷键：Ctrl+F 聚焦搜索框、Ctrl+P 切预览

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
- Node ≥ 20，依赖已安装（editor 新增 renderer 依赖已 `npm install` 同步），无需再装。
- CLI 测试依赖 core 的 dist：改动 core 源码先 `npm run build -w @surdet/core` 再跑 cli 测试。
- 编辑器 dev：`npm run dev -w surdet-editor`（vite，端口被占会顺延）。
