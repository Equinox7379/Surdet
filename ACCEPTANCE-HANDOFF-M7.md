# Surdet 引擎 M7 验收交接书（支柱5 一键商业化第一批：手柄 / Web 试玩 / 版本清单）

> 本文档自包含：接手的审阅 AI 不需要额外上下文即可开始。
> 范围：本地 master 单个提交 `d9a1eef`（M7 本体，7 文件 +312/−5）。
> 此前里程碑（M1–M6 及各审阅轮修复）均已通过审阅并推送远端，本轮不重复审。
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
  git -C "E:\surdet" show d9a1eef --stat
  ```

## 1. 回归基线（已实测全绿，复验应一致）

在 `E:\surdet` 下：

| 命令 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **539 过**：core 264 / **cli 78**（+3）/ renderer 97（+7 手柄）/ shell 19 / editor 81，只增不减 |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

## 2. M7 交付内容

### 手柄支持（Gamepad API）

- **`packages/renderer/src/gamepad.ts`（新增）**：
  - `diffGamepad(prev, cur)` 纯函数边沿检测（标准布局）：A(0)=advance · B(1)=cancel · Start(9)=menu · LB(4)/RB(5)=shoulderLeft/Right · 十字键(12-15)与左摇杆轴(0/1，阈值 ±0.5，十字键优先)=方向；按键与方向均为"按下瞬间"触发，按住不重复。
  - `GamepadPoller`：rAF 轮询第一个已连接手柄，diff 出动作回调；无手柄/非浏览器环境 start() 无操作。
- **starter 接线**（`examples/starter/src/main.ts`）：advance=推进/确认选项（与 Space/Enter 同口径）；cancel/menu=系统菜单（与 Esc 同口径）；up/down=选择肢导航（与方向键同口径）；RB 开快进 / LB 关快进。
- 测试 +7：边沿触发/按住不重复/松开无动作、B/Start/LB/RB 映射、十字键换向、摇杆阈值与死区、十字键优先、同帧多键、snapshotOf。

### Web 试玩导出

- `surdet build <游戏目录> --web`：vite 构建后在 `dist/` 写入 `web-trial-info.json`（engine/game/version/builtAt）并打印静态托管上传指引（itch.io / TapTap 网页 / 官网 / Vercel）。starter 的 dist 本就是纯 Web 产物，--web 只做信息落盘 + 指引（无额外打包层）。

### 版本补丁清单

- `surdet manifest <游戏目录>`：读 package.json 的 name/version + CHANGELOG.md 前 10 行（≤500 字）摘要，生成 `<游戏目录>/release/update-manifest.json`（engine/game/version/generatedAt/notes）。
- 纯函数 `buildWebTrialInfo` / `buildUpdateManifest` 均导出并有单测（+3）。

## 3. 有意为之（审阅时请勿误报为缺陷）

1. **手柄方向"按住不重复"**：选择肢导航按一次移一格，需要连移就多按（与键盘方向键行为一致）；未做按住自动重复。
2. **手柄轮询常驻 rAF**：未连接手柄时每帧仅一次 getGamepads()，开销可忽略；未做按需唤醒（简化实现）。
3. **RB/LB 是"开/关"快进而非"按住临时快进"**：手柄无长按住语义歧义，选择开关式（与 Ctrl 按住临时快进刻意区分，注释已标）。
4. **build --web 不产 zip/压缩包**：只落盘 info 文件 + 指引；打包格式交给托管平台（Node 无内建 zip，避免引第三方依赖）。
5. **manifest 的 notes 取 CHANGELOG 前 10 行原文**：不做 markdown 解析（够用即止）。
6. **预览/编辑器未接手柄**：手柄面向成品游戏运行时（starter），编辑器是开发工具不在本轮范围。

## 4. 已知限制（不算缺陷，列入后续）

1. 手柄按键映射不可自定义（标准布局写死；后续可加设置面板重映射）。
2. update-manifest 未与 Electron autoUpdater 联动（shell 打包产物接入 autoUpdater 是后续项；当前清单供人工分发/公告消费）。
3. Web 试玩未做体积压缩/资源 CDN 优化（starter 体量小，暂不需要）。

## 5. 手动验收清单（需真人/真实设备）

自动化已覆盖纯逻辑（7+3 单测）；以下为设备相关项：

1. [ ] **手柄实机**：连接任一手柄（浏览器手柄需用户手势激活，先按一下任意键），打开 starter 运行：A 推进台词、出现选择肢时十字键上下移动高亮、A 确认、B/Start 打开菜单、RB 快进、LB 关快进
2. [ ] **无手柄不影响**：不连手柄时游戏行为与 M6 完全一致（GamepadPoller 静默）
3. [ ] **Web 试玩**：`node packages/cli/dist/index.js build examples/starter --web` → 退出码 0、`examples/starter/dist/web-trial-info.json` 存在且字段齐全、终端打印上传指引
4. [ ] **版本清单**：`node packages/cli/dist/index.js manifest examples/starter` → `examples/starter/release/update-manifest.json` 生成、version 与 package.json 一致
5. [ ] 帮助文本：`node packages/cli/dist/index.js --help` 含 build --web 与 manifest 两行

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
- starter 运行：`npm run dev -w surdet-starter`（vite）。
