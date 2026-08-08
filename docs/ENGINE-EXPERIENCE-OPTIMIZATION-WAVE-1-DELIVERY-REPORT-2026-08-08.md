# Engine Experience Optimization Wave 1 交付报告

日期：2026-08-08<br>
仓库：`E:\surdet`<br>
基线 HEAD：`3ecd43a0ad5829b0253141e9a5bd42db061ff1e4`<br>
分支：`main`<br>

## 结论

本文件是 Wave 1 的历史交付记录。原先“Task 0→13 已按顺序执行完成”的表述过于绝对，不能替代计划文件中的逐项勾选，也不能作为本次审计整改的验收依据。当前源码状态、重新执行的门禁、四项阻断项修正和计划勾选，以 [Wave 1 审计整改报告](ENGINE-EXPERIENCE-OPTIMIZATION-WAVE-1-REMEDIATION-REPORT-2026-08-08.md) 为准。

截至本次补正，重新验证了 Task 13 的回归、资源/性能、正式打包、隔离 EXE 和报告步骤；未重新推断未被当前证据覆盖的历史任务。

## 交付范围

- 文档事实与仓库卫生：能力矩阵生成/检查、临时产物卫生门禁、README 与当前能力同步。
- 引擎通用层：Profile 存储桥、可复用 `@surdet/host`、原子场景替换、项目统计 CLI。
- 渲染与体验：优先级素材加载、加载层、回退缓冲、转场注册表、震动阻尼、环境音声道、快捷键预设、Backlog 搜索。
- 开发工具：Vite 开发环境 `.gal` 热更新；编译失败保留旧场景，活动 PC 安全限制；正式包不包含文件监听器。
- 宿主接线：starter、`zero-after-midnight` 与 CLI 模板均使用统一能力边界，并保留游戏自己的标题、剧情、资源和系统配置。

本文件中的变更数量是历史快照，不代表当前工作树。当前精确 Git 统计见补正报告；`USER.md`、`SESSION-HANDOFF.md` 属于内部记忆文件，未纳入自动提交策略。

## 最终验证命令

以下命令是上一轮 Wave 1 整改的历史门禁快照，不代表本次最终补正后的数字；最终补正以 [最终整改报告](ENGINE-EXPERIENCE-OPTIMIZATION-WAVE-1-REMEDIATION-REPORT-2026-08-08.md) 为准：

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | PASS |
| `npm test` | PASS，754 tests |
| `npm run docs:capabilities:check` | PASS |
| `npm run verify:hygiene` | PASS，367 tracked paths |
| `npm run lint -w surdet-starter` | PASS，4 场景，0 错误，0 警告 |
| `npm run lint -w zero-after-midnight` | PASS，11 场景，0 错误，0 警告 |
| `npm run simulate -w zero-after-midnight` | PASS，24 paths、23/23 choice、39 save/load、3 endings、0 runtime errors |
| `node examples/zero-after-midnight/scripts/check-assets.mjs` | PASS，44 assets |
| `npm run verify:p1p2` | PASS |
| `npm run e2e -w @surdet/shell` | PASS，starter 画布/剧情/F5/F9/系统交互回归通过 |
| `git diff --check` | PASS |

模板入口还使用独立命令验证：

```text
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler \
  --lib ES2022,DOM --types vite/client --resolveJsonModule \
  packages/cli/templates/game/src/main.ts
```

该命令 PASS。直接在模板目录执行其原有 `tsconfig.json` 会因模板复制前的相对 `../../tsconfig.base.json` 路径不存在而失败；模板复制到 `games/<name>` 后相对路径成立，故未修改模板的复制契约。

## 资源与性能证据

- 正式 EXE 启动时加载进度单调递增，最终 `48/48`、`failed=0`。
- 标题加载后保留 `45` 个素材 Blob URL。
- 三个字体角色 `body/title/ui` 均实际加载。
- 正式游戏资产源清单为 50 个文件：24 个音频、5 个字体、21 个图像；正式 staging 也记录 50 个加密素材。
- 隔离 EXE 剧情运行采样 `maxUpdateMs=0.600ms`，低于 8ms 门槛；内置转场与性能预算测试通过。
- 回退缓冲容量固定为 50；最终 EXE 实测第一次 ArrowUp 从 `prologue:8` 回到 `prologue:7`，没有重建舞台、音频管理器、帧调度器或 Blob URL。
- `FrameScheduler` 的静态画面休眠逻辑、资源生命周期与音频缓存上限由 renderer 单测覆盖；正式运行没有观察到页面错误或控制台错误。

## 正式包证据

执行的是显式目标命令：

```powershell
$env:SURDET_GAME_DIR = (Resolve-Path 'examples/zero-after-midnight').Path
$env:SURDET_PACK_MODE = 'release'
Remove-Item Env:SURDET_ENCRYPT -ErrorAction SilentlyContinue
$env:SURDET_EXPECTED_GAME = 'zero-after-midnight'
$env:SURDET_EXPECTED_ENTRY = 'prologue'
npm run pack -w @surdet/shell
```

artifact verifier PASS，身份如下：

- game：`zero-after-midnight`
- title：`零点之后`
- version：`0.1.0`
- entryScene：`prologue`
- mode：`release`
- encrypted：`true`
- assetFiles：50
- `app.asar` 关键文件、身份和 SDAT2 素材校验：PASS

生成物位于 `packages/shell/release/`，包括 unpacked 目录、portable EXE 和 NSIS 安装器。

## 隔离 EXE 验收

使用新建的临时 `--user-data-dir` 启动 unpacked EXE，验收结果全部 PASS：

- 窗口标题：`零点之后 / AFTER MIDNIGHT`；画布存在。
- 加载完成、48/48、0 失败、进度单调、三字体角色、45 Blob URL。
- `prologue` 可进入 `awaiting-advance`。
- 两个文本检查点后回退一次成功，PC 从 8 回到 7。
- F5 创建 `index.json` 与 `quick.json`；F9 读档后仍在运行。
- Profile 写入/读取成功，写入位置为隔离目录的 `userData/profile`。
- 页面错误 0、控制台错误 0。

验收临时目录已在确认绝对路径位于预期临时根目录后删除；没有触碰用户真实存档目录。

## 过程中的问题与处理

初次隔离 EXE 验收发现回退栈顶重复当前检查点，第一次回退不会改变 PC。已在 starter、正式游戏和 CLI 模板统一修正为跳过当前检查点后取上一帧，并重新完成类型检查、全量测试、正式打包和 EXE 验收。该问题没有被忽略或以放宽阈值掩盖。

## 暂缓项目

按任务书，以下不属于本 Wave 1：立绘组合/差分层、Idle 动画、DSL REPL/LSP、纹理图集、Text/BitmapText 性能迁移、确定性回放、完整本地化、Plugin API v2、自定义字体导入、PixiStage 内部 Layer 迁移、战斗阵型编辑与战斗产品化。

## Git 与存档声明

本轮没有执行 `git commit`、`git push`、`git reset`、`git clean` 或工作树清理。现有用户修改、`USER.md`、`SESSION-HANDOFF.md` 和用户存档边界均保持不变。
