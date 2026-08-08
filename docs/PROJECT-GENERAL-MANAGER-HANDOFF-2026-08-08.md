# Surdet 项目总经理交接文档

> 版本：2026-08-08
> 项目：Surdet 引擎 +《零点之后》正式游戏
> 角色定位：本文件交给“项目总经理/总负责人”专家使用。总经理负责管理和决策，Codex 继续负责执行，不发生角色替代。

## 1. 这份交接的核心约定

你承担的是项目总经理（General Manager / Project Lead）的工作，不是取代 Codex。

职责关系如下：

| 角色 | 核心职责 | 不应越权的事项 |
|---|---|---|
| 用户 / 项目所有者 | 确认最终方向、范围、预算、发行和重大取舍 | 不需要亲自跟进每个技术细节 |
| 项目总经理专家 | 把用户目标转成优先级、里程碑、验收标准和任务；审查风险；决定先做什么、何时算完成 | 不应绕过执行流程私自改变用户目标或把未验证的结果宣布为完成 |
| Codex 执行者 | 查代码、定位问题、修改实现、补测试、运行验证、构建发行包、整理交付证据 | 不自行改变产品方向、扩大范围、提交/推送或删除用户数据 |

一句话工作模型：

> 总经理决定“为什么做、做什么、先做什么、做到什么程度”；Codex 负责“怎么查、怎么改、怎么测、怎么交付”。

总经理可以要求 Codex 重新调查、补测试、回滚某个方案、拆分任务或改变优先级；但所有执行结果必须以落盘文件和实际验证为准。

## 2. 接管后的工作协议

### 2.1 总经理给 Codex 的任务格式

每个任务尽量包含以下内容：

```text
目标：
背景/用户价值：
范围：
明确不做什么：
验收标准：
优先级：P0 / P1 / P2 / P3
是否允许改动发行包/存档/用户数据：
是否允许提交或推送：默认否
```

如果目标已经明确，Codex 应直接执行；只有缺少会改变范围、数据安全或发行结果的关键选择时，才向用户提问。

### 2.2 Codex 的交付格式

每次执行结束必须汇报：

1. 结论：完成、部分完成或被什么阻塞。
2. 改动：文件和行为变化。
3. 验证：实际运行过的命令及结果。
4. 风险：仍存在的非阻断提示、未验证项和下一步建议。
5. 产物：发行包、报告或其他文件的绝对路径。

总经理应根据验收标准审核交付，而不是仅依据“代码已修改”或工具回执。

## 3. 项目概况

Surdet 是 TypeScript monorepo 形式的数据驱动桌面 GalGame / ADV 引擎，目标是支持商业化 Electron 桌面发行，同时保留浏览器开发预览和可视化剧本编辑器。

核心原则：

- 剧情由 `.gal` DSL 驱动。
- 日历、战斗、商店、成长、成就、事件调度、周目等系统由配置和引擎驱动。
- 引擎不得为了某一部游戏写入不可复用的游戏特例。
- 渲染层负责表现，核心层保持 headless，Electron 壳负责文件、存档、发行和安全边界。

### 3.1 实际路径与环境

- 仓库：`E:\surdet`
- 操作系统：Windows
- Shell：PowerShell
- Node：要求 `>=20`
- Git 当前分支：`main`
- 当前 HEAD：`2a28b17 feat(starter): stage cinematic opening direction`
- 当前工作树存在大量既有未提交改动；接手时不得执行 `git reset --hard`、`git clean -fd` 或批量覆盖。

旧交接文档可能记录了不同的分支、提交、测试数或路径。它们只能作为历史材料，当前源代码、当前测试和用户最新指令优先。

### 3.2 包结构

| 路径 | 职责 |
|---|---|
| `packages/core` | DSL 编译、表达式、解释器、存档、变量和玩法系统；无 DOM |
| `packages/cli` | `surdet new/lint/build/simulate/pack` 命令 |
| `packages/renderer` | PixiJS 舞台、ADV 渲染、文本、菜单、音频、设置和演出 |
| `packages/shell` | Electron 主进程、preload、IPC、加密素材、发行打包 |
| `packages/editor` | 浏览器端可视化编辑器和 iframe 预览运行器 |
| `examples/starter` | 引擎验收样例，不是正式游戏 |
| `examples/zero-after-midnight` | 当前正式游戏《零点之后》 |

## 4. 当前产品重点

正式游戏是：

```text
E:\surdet\examples\zero-after-midnight
```

`examples/starter` 仅用于验证引擎能力、编辑器接线和 Electron E2E，不应被误当成正式发行内容。

《零点之后》当前基线：

- 11 个场景。
- 23/23 个选择分支覆盖。
- 3 个可达结局：`testimony_end`、`meeting_end`、`silence_end`。
- 无头模拟覆盖 24 条路径、39 次存档往返冒烟。
- 正式素材目录包含背景、立绘、头像、字体、BGM 和 SE；发布时经 AES-256-GCM 封装为 `SDAT2`。

## 5. 最近资产事故及其结论

### 5.1 用户看到的症状

发行版里出现默认图片、背景/立绘/菜单和对白表现不一致，曾经还出现黑屏、卡在立绘或切换起始位置后恢复等现象。

### 5.2 已确认的真实根因

资产文件没有被删除，也没有被替换成 starter 资产。问题发生在运行时资源链路：

1. `packages/shell` 将加密素材解密后通过 `surdetAsset` IPC 返回字节。
2. 游戏把字节转成没有文件扩展名的 `blob:` URL。
3. Pixi 无法自动判断 PNG/SVG 解析器，加载失败后使用程序化占位纹理。
4. HTML CSP 又拦截了 `blob:` 的图片、字体和 `fetch(blob:)` 读取。
5. Howler 对无扩展名 Blob 音频无法选择 codec，音频会静默失败。

### 5.3 已完成的修复

- `packages/renderer/src/pixi-stage.ts`：根据 MIME/扩展名显式选择 `loadTextures` / `loadSVG`。
- `packages/renderer/src/audio-manager.ts`：增加 Blob 音频源格式注册，并将格式传给 Howler；释放时清理格式表。
- `examples/zero-after-midnight/index.html`、`examples/starter/index.html`：允许 `blob:` 图片、字体、音频和连接。
- `examples/zero-after-midnight/src/main.ts`、`examples/starter/src/main.ts`：注册图片 MIME、音频格式和正式游戏日志前缀。
- `packages/editor/src/preview.ts`：预览图片和音频同样传递 MIME/格式。
- `examples/zero-after-midnight/scripts/check-assets.mjs`：增加逐行扫描剧本资产引用和配置头像键的检查。
- `packages/shell/scripts/verify-pack.mjs`：增加 app.asar 内素材完整性和 `.skey` 检查。

### 5.4 发行版实际验证结果

最终发行版真实启动时已验证：

- 45 个 Blob 素材保持有效。
- 3 个字体角色全部加载。
- 24 个音频条目完成注册。
- `prologue` 正常进入 `awaiting-advance`。
- 快速存档、快速读档均成功。
- 无 Pixi 解析错误、CSP 错误、Howler 无 codec 错误、字体失败或页面异常。

## 6. 发行产物与打包规则

当前发行文件：

- 便携版：`E:\surdet\packages\shell\release\SurdetGame-0.1.0.exe`
- 安装版：`E:\surdet\packages\shell\release\SurdetGame-Setup-0.1.0.exe`
- 解包目录：`E:\surdet\packages\shell\release\win-unpacked`

《零点之后》打包必须显式指定游戏目录：

```powershell
Set-Location E:\surdet
npm run build -w zero-after-midnight
$env:SURDET_GAME_DIR = 'E:\surdet\examples\zero-after-midnight'
npm run pack -w @surdet/shell
```

不指定 `SURDET_GAME_DIR` 时，打包脚本默认使用 `examples/starter`。这是当前最重要的操作风险之一；任何正式发行前都必须检查：

- 窗口标题为“零点之后 / AFTER MIDNIGHT”。
- `game/game.config.json` 的 `entryScene` 为 `prologue`。
- `game/release/update-manifest.json` 的游戏名为 `zero-after-midnight`。
- app.asar 内不存在 starter 的场景、配置或资产残留。
- `game/content/assets` 文件均进入 app.asar，且加密包存在 `game/.skey`。

仅用于本地调试时可以使用 `SURDET_ENCRYPT=0`；正式包不得关闭素材加密。

## 7. 验收门禁

仓库根目录执行：

```powershell
npm run typecheck
npm test
npm run lint -w surdet-starter
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight
node examples/zero-after-midnight/scripts/check-assets.mjs
npm run verify:p1p2
npm run e2e -w @surdet/shell
```

正式发行还必须执行：

```powershell
$env:SURDET_GAME_DIR = 'E:\surdet\examples\zero-after-midnight'
npm run pack -w @surdet/shell
node packages/shell/scripts/verify-pack.mjs --artifact
```

最后必须用 `packages/shell/release/win-unpacked/Surdet Game.exe` 实际启动，而不是只看 Vite build 成功。

## 8. 质量标准与否决条件

以下任一条件成立，项目总经理不得宣布本轮完成：

- 正式游戏启动后出现默认占位图片或资产加载失败日志。
- 发行包实际运行的是 starter，而不是《零点之后》。
- 任一场景无法由 `surdet simulate` 到达，或出现运行时错误、死路、预算耗尽。
- 测试、类型检查、lint、E2E 或 app.asar 校验失败。
- 修改了资产、存档、发行文件或用户数据，但没有明确记录影响范围。
- 只验证开发预览，没有验证最终 Electron 发行包。
- 将工具回执、旧交接文档或“应该已经写入”的内容当成事实，而没有读取磁盘复核。

当前构建仍可能出现 Vite 的“chunk 大于 500KB”体积提示；它不是运行错误，已通过真实发行版启动和帧耗时验证。若要处理，应作为独立的性能拆包任务，不要为了消除提示而随意改变加载顺序。

## 9. 文件与数据安全规则

- 不得删除 `E:\surdet` 下用户已有的未提交文件。
- 不得删除 `userData` 中的存档、设置和日志，除非用户明确授权并确认目标。
- 不得用 `git reset --hard`、`git checkout -- .` 或 `git clean -fd` 清理工作树。
- 代码修改使用 `apply_patch`，并在修改后直接读取目标文件确认落盘。
- 只有用户明确要求时才 commit / push；默认不提交、不推送。
- 发布包可重建，但正式游戏源素材和存档不可用发布包反向替代。

## 10. 推荐的任务管理方式

项目总经理应维护一个短而明确的待办队列：

| 优先级 | 含义 | 例子 |
|---|---|---|
| P0 | 阻止启动、资产、存档或发行 | 黑屏、默认资产、发行包串项目 |
| P1 | 破坏核心引擎能力或正式游戏主流程 | 场景不可达、系统状态丢失、存档损坏 |
| P2 | 可感知质量或工程效率问题 | 编辑器预览不一致、资源泄漏、诊断缺失 |
| P3 | 优化和扩展 | 拆包、视觉微调、额外工具和文档 |

推荐下一步不是继续改样品外观，而是：

1. 把“正式游戏发行包资源回归”固化为自动化检查，避免资产问题复发。
2. 继续按引擎路线图审查通用能力，不向《零点之后》写入游戏特例。
3. 对编辑器预览、正式 Electron 壳和浏览器开发环境做同一资产管线的回归矩阵。
4. 再开始新的玩法或美术扩展前，先由总经理确认范围和验收标准。

## 11. 项目总经理接管后的第一轮动作

1. 阅读本文件，并将本文件视为当前角色分工和项目状态的基线。
2. 要求 Codex 运行 §7 的快速门禁；如果环境或代码已变化，以新结果覆盖本文件中的旧状态。
3. 建立不超过 5 项的当前待办，明确每项的优先级和“完成定义”。
4. 将所有用户新要求分成：引擎通用能力、正式游戏内容、编辑器、发行运维四类。
5. 对任何涉及资产、存档、发行和删除的动作先设安全边界，再交给 Codex 执行。

## 12. 给 Codex 执行者的固定指令

总经理可以直接使用下面的模板：

```text
你继续作为执行者处理本任务。
项目总经理已确定：<目标>
本轮优先级：<P0/P1/P2/P3>
允许范围：<文件/包/游戏>
禁止范围：<不要改什么/不要删除什么>
验收标准：<可执行的命令或行为>
请先给出短计划，然后直接修改、测试、复核并交付。
不要提交或推送，除非我明确授权。
```

Codex 的默认行为仍是：先证据、后判断；先修根因、后补表象；先验证落盘文件、后汇报完成。

## 13. 交接结论

当前不存在已复现的正式发行资产阻断问题；《零点之后》发行版已经以真实素材通过启动、首场景、音频格式、字体、存档和发行包检查。

本文件的目的不是让总经理取代 Codex，而是让总经理承担项目判断、协调和验收，让 Codex 专注于技术调查、实现和验证。两者配合时，用户只需要确认方向和重大取舍，不需要重复充当项目经理或技术执行者。
