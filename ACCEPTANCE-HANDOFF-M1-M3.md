# Surdet 编辑器升级 · M1–M3 验收交接书

> 本文档自包含：接手的验收 AI 不需要任何额外上下文即可开始验收。
> 验收范围：本地 master 的 3 个新提交（M1/M2/M3），基线为远端 main 内容等价的 `f44bca9`。
> 你的任务：**独立验收并出报告**。默认只报告不修复；若发现小问题想顺手修，必须在报告中逐项列明改动。

---

## 0. 仓库与提交状态（务必先复核）

- **仓库路径**：`E:\surdet`（Windows，shell 为 PowerShell）。
  ⚠️ 当前为独立 Git 仓库：项目根为 `E:\surdet`；`git` 命令的相对路径不带 `surdet/` 前缀。
- **远端**：`surdet` → `https://github.com/Equinox7379/Surdet.git`，默认分支 `main`，引擎在仓库根。
  ⚠️ 本地 master 与远端 main **历史无关**（无公共祖先），但内容关系为"远端 main 树 == 本地某提交的 surdet/ 子树"。
  **请勿执行任何 push / force / rebase / reset**。推送由仓库主人按移植流程自行处理。
- **待验收提交**（本地 master，均未推送，旧 → 新）：

| 提交 | 里程碑 | 内容 |
|---|---|---|
| `a6eb14e` | M1 | E0 编辑器架构拆分 + E1a 只读导航流程图 + `collectConfigSceneRoots` 下沉 core |
| `548a135` | M2 | `surdet simulate` 无头自动模拟（CLI + starter 脚本 + CI 门禁） |
| `de646a8` | M3 | E1b 交互编辑流程图（拖拽建跳转 + 右键重命名/删除） |

- 复核命令：
  ```powershell
  git -C "E:\surdet" log --oneline -5
  git -C "E:\surdet" status --short | Select-String "surdet/"
  ```
  预期：HEAD = `de646a8`；工作树对 `surdet/` 内**无已修改未提交**文件（未跟踪的过程文档
  `surdet/REVIEW-HANDOFF.md` / `REPAIR-HANDOFF.md` / `EDITOR-AND-DIFFERENTIATION-PLAN.md` / `memory/` 等属正常，不属于验收对象）。

---

## 1. 回归基线（每个验收阶段都必须保持全绿）

在 `E:\surdet` 下执行：

| 命令 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **488 过**：core 264 / cli 73 / renderer 83 / shell 19 / editor 49，只增不减 |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | 结局可达 `demo_end`、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

⚠️ CLI 测试通过 `@surdet/core` 的 **dist** 解析：若你改动了 core 源码，先 `npm run build -w @surdet/core` 再跑 cli 测试，否则会误报"函数不存在"。

---

## 2. M1 验收：E0 架构拆分 + E1a 只读流程图（`a6eb14e`）

### 2.1 E0 拆分（行为不变的纯搬移）

原 `packages/editor/src/main.ts`（约 950 行，实测 946 个换行；验收轮 Minor1 订正）拆为：

| 文件 | 职责 |
|---|---|
| `src/state.ts` | 全局 state（新增 `configFiles`、`mainTab` 字段）+ `h()`/`setStatus()` 助手 |
| `src/project-io.ts` | openProject/readScenarioDir/saveAll/exportScene/loadDemoProject；**新增读取 `content/config/{events,growth,calendar}.json` 进 `state.configFiles`** |
| `src/history.ts` | undo/redo/setCurrentText + 纯函数 `pushEdit`；常量 HISTORY_LIMIT=200、COALESCE_MS=600 |
| `src/panels/sidebar.ts` `editor.ts` `issues.ts` `right.ts` | 四个面板（校验编排含 Worker 管理在 issues.ts） |
| `src/main.ts` | 仅装配（钩子注入）+ 标签页路由 + 快捷键 + beforeunload |

**模块间无环**：跨模块联动一律走 `bind*Hooks` 钩子注入（main.ts 装配）。验收点：
- [ ] 阅读 `main.ts` 确认只剩装配与路由；各面板不互相 import 成环（issues→sidebar/editor/right 单向；flow→history/sidebar 单向）。
- [ ] **零失真契约**：`npm run test -w surdet-editor` 中 `model-roundtrip.test.ts` 对真实 starter 4 个剧本做 parse→serialize 逐字节往返（含 CRLF 保持）。
- [ ] history 语义：`history.test.ts` 10 个用例覆盖 600ms 打字合并（滑动锚点）、200 条上限丢最旧、undo 后 redo 栈清空、多场景历史栈隔离。

### 2.2 E1a 只读导航流程图

- 图模型：`src/graph/build.ts`（纯函数）+ `test/graph.test.ts`（7 用例）。
  节点三类 `scene/label/host-entry`；边九类 `flow/goto/jump/call/switch/loop/choice/if/host`。
- 视图：`src/panels/flow.ts`——BFS 分层泳道布局、滚轮缩放（光标为中心）、拖拽平移、**视口裁剪**（视口外不建 DOM）、
  单击场景节点切块编辑、双击 label 节点跳转并滚动到对应行、当前场景高亮、error 红描边 / warning 黄角标、宿主入口虚框。
- **同源纪律**：宿主入口来自 core 的 `collectConfigSceneRoots`（`packages/core/src/scene-lint.ts`，自 CLI 下沉），
  CLI 的 W007 可达根与编辑器流程图共用同一实现（`test/config-scene-roots.test.ts` 4 用例）。

**自动化验收**：
```powershell
npm run test -w surdet-editor   # 含 graph/build 与 roundtrip
npm run test -w @surdet/core    # 含 config-scene-roots
```

**手动验收**（浏览器，无法自动化——File System Access 需用户手势）：
```powershell
npm run dev -w surdet-editor    # 打开 http://localhost:5174/
```
- [ ] 点"打开游戏目录"选 `examples/starter` → 切到"流程图"标签：应看到 4 个场景泳道 +
      宿主入口虚框（`⚙ ch03_turn_event` 等，来自 events.json `scheduled[].scene`/growth.json `levelEvents`）。
- [ ] ch01_01 的 3 个 choice 选项显示为 3 条带选项文本的边（其中 `转身离开` 边带 `[if:hasSword]`）。
- [ ] 滚轮缩放/背景拖拽平移流畅；单击场景节点切回块编辑；双击 label 节点跳转到对应 @label 行。
- [ ] 人为制造一个语法错误（如删掉某个 `@endif`）→ 对应场景节点出现红色描边。

---

## 3. M2 验收：`surdet simulate` 无头模拟（`548a135`）

实现：`packages/cli/src/simulate.ts`（DFS 全分支枚举 + `(定位,变量)` 状态签名剪枝 + choice 分支 visited 去重；
choice 分支经 saveSnapshot/loadSnapshot 走真实存档机制=存档往返冒烟）；CLI 接线在 `src/index.ts`；
7 个单测在 `test/simulate.test.ts`；CI 门禁在 `.github/workflows/ci.yml`（Simulate starter 步骤）。

**验收**：
```powershell
npm run simulate -w surdet-starter
```
- [ ] 报告含：4 场景、结局可达 `demo_end`、运行时错误 0、存档往返 save/load 次数 > 0；退出码 0。
- [ ] **如实性检查**：不带 `--assume battleWon=true` 直接 `node packages/cli/dist/index.js simulate examples/starter`
      → `demo_end` 应**不可达**（battleWon 只有战斗宿主能置位，这是如实报告而非缺陷）；
      choice 分支覆盖 2/3（第 3 选项被 `[if:hasSword]` 过滤，且 ch01_01 开场 `@set hasSword = false`，simulate 无法到达——如实）。
- [ ] `--json` 输出合法 JSON（`--json` 可被脚本/CI 消费）。
- [ ] 单测覆盖：全分支遍历、死路检测、循环剪枝收敛、无挂起点死循环步数兜底、@exp 无 GrowthSystem 时报运行时错误、--assume 注入、缺 entryScene 报错。

### 有意为之（勿误报）
- simulate **穿透** system 指令（@battle/@calendar 无宿主时只是事件，继续推进）；与 audit 的 dryRun（遇 system 即停）互补。
- `deadEndScenes` 是"结束但该段未触发 @clear"的场景列表——宿主事件场景（如 ch03_turn_event 若被进入）出现在此列表属正常，报告文案已注明"人工甄别"。
- 路径预算缺省 500、单路径步数缺省 20000，均可 `--max-paths/--max-steps` 调整。

---

## 4. M3 验收：E1b 交互编辑流程图（`de646a8`）

实现：`src/panels/flow.ts`（拖拽状态机 + 右键菜单 + `renameScene`/`deleteScene`）；
`src/history.ts` 新增 `setSceneText`（跨场景写入、独立撤销点）；12 个纯函数单测在 `test/flow-edit.test.ts`。

**自动化验收**：`npm run test -w surdet-editor`（rewriteSceneRefs 不误伤台词/相似前缀 ID、CRLF 保持、
countSceneRefs、buildJumpLine 四种组合、appendLineToScene 换行风格）。

**手动验收**（浏览器打开 starter）：
- [ ] **拖拽建链**：流程图里按住某节点拖到另一节点（超过 6px 阈值才判定拖拽，否则是点击）→
      状态栏提示"已在 'xxx' 末尾插入 @jump …"；切回块编辑验证源场景末尾多了该行；Ctrl+Z 可撤销。
      同场景拖到 label → 插入 `@goto 标签`；跨场景 → `@jump 场景[.标签]`。
- [ ] **重命名**：右键场景节点 → 重命名为新名字 → 全项目 @jump/@call 引用同步改写（含 `场景.标签` 形式）、
      `@scene` 声明行同步、侧栏/流程图即时刷新；平坦路径（content/scenario 直属）旧盘上文件被删除、
      保存时创建新名文件；子目录场景应提示"手动重命名盘上文件"。
- [ ] **删除**：删除被引用的场景 → 弹确认框显示引用处数；确认后场景从内存移除、平坦路径盘上文件删除；
      删除入口场景后 `state.current` 回退到其他场景。
- [ ] 拖拽结束后不应触发节点的点击导航（suppressClick 逻辑）。

### 有意为之（勿误报）
- 重命名**不写其他场景的盘上文件**：引用改写发生在内存并置脏标记，统一由"保存全部"落盘（编辑器既有语义）；
  被重命名场景自身句柄置空，保存时按新名创建。
- 重命名合法性：禁止空格/点号（点号破坏 `sceneId.label` 寻址，同 lint SCENE_ID 规则）。
- 插入走 `setSceneText`（不合并撤销点），与打字热路径的 coalesce 语义区分。
- 拖拽/右键的 DOM 级行为无单测（环境限制），验收以手工为准；文本变换正确性已由单测锁定。
- **重命名/删除是结构性操作，不入撤销栈**（仅拖拽建链经 `setSceneText` 可 Ctrl+Z 撤销）；删除有 confirm 引用检查防御，属设计选择。

---

## 5. 全局设计决策（复审时请勿误报为缺陷）

1. **钩子注入保持模块无环**：history/project-io/sidebar/flow 均不反向 import main，联动经 `bind*Hooks` 装配。
2. **Worker 回包新增 scenes**：`validate-worker.ts` 现在把编译产物一并回传（Map 可被 structuredClone），
   流程图从编译产物提取、不重新解析源码；同步回退路径同样携带。
3. **`state.fsSupported` 加了 node 守卫**（`typeof window !== 'undefined'`）：仅为让 state.ts 可被 node 测试导入，浏览器行为不变。
4. **simulate 与 CI 的 `--assume battleWon=true`**：战斗结果属宿主域，simulate 用 assume 注入模拟"玩家赢了"，
   这是验收姿势不是作弊；不带 assume 的如实输出同样正确。
5. **流程图 `if` 边**：仅当 @if 编译出的 condJump 目标恰为某 @label 时画条件边（标签级可表达）；指向指令流中间的
   condJump 不画边——属有意简化。
6. **editor 包不引 UI 框架**（保持 vanilla TS + DOM + SVG），图表自实现——方案总则，勿建议引入 React/D3。
7. 过程文档（REVIEW-HANDOFF/REPAIR-HANDOFF/EDITOR-AND-DIFFERENTIATION-PLAN/memory/）**不进提交**，未跟踪属正常。

---

## 6. 已知限制（不算缺陷，可列入后续）

> **验收轮修复记录**：首轮验收的 Minor2（renameScene 的 @scene 正则未锁定行首）与 Minor3（宿主入口节点顶部越界贴边）
> 已在验收轮提交中修复：正则补 `^` 锚定 + `m` 标志；布局对负坐标整体下移保护（`layoutFlowGraph` 尾部，附回归单测）。

- E1a/E1b 的拖拽与右键菜单无自动化测试（File System Access + 指针事件环境限制）。
- 编辑器 W007 检查（validate.ts）暂未消费配置驱动根：打开 starter 时 ch03_turn_event 可能被编辑器标 W007
  （CLI 不会）——修复方案是 validate.ts 接入 `collectConfigSceneRoots`，需要编辑器先加载 config（已完成加载，属后续小改）。
- 流程图未做"场景外 @loop 死循环"的静态提示（simulate 侧已覆盖运行时检测）。
- 重命名不同步 game.config.json 的 `entryScene`（该文件在编辑器内目前只读展示）。

---

## 7. 报告输出格式（必须遵守）

```
## 验收结论
（一句话：通过 / 有条件通过 / 需整改）

## 基线复验
（第 1 节五条命令的实际执行结果）

## 问题清单（Critical/Major/Minor 分级）
每条：文件:行号 + 现象 + 复现步骤；不确定的标"存疑，未复现"

## 手动验收记录
（第 2/3/4 节手动项逐项 ✅/❌/未验证；无法在环境内完成的注明原因）

## 已确认无问题项
（对本文档各验收点逐项回应）
```

规则：不要 push/force/rebase；不要提交任何 commit；修改文件前必须在报告中标注（默认只读验收）。

## 8. 环境提示

- Windows + PowerShell：无 `tail`/`grep`，用 `Select-Object`/`Select-String`；git 用 `git --no-pager`。
- Node ≥ 20，依赖已安装；无需 `npm install`。
- 编辑器 dev：`npm run dev -w surdet-editor`（vite，端口 5174 起）。
- 浏览器自动化受限：dev 环境支持 File System Access，**没有“加载演示项目”按钮**（那是无 FS API 环境的兜底），
  打开真实目录需要用户手势，自动化无法代劳——手动项请如实标注。

---

## 9. 后续打磨清单（验收轮用户确认，仅记录不阻塞）

1. **流程图进一步降噪**（用户：“现在还行，记入后续清单”）：当前贝塞尔曲线布线已将交叉/重叠压到可接受，
   如需进一步提升可读性，可考虑：正交折线布线（orthogonal routing）、泳道容器背景框、
   按边类型分层级显示/过滤开关。属较大重构，单独立项。
2. 编辑器 W007 接入 `collectConfigSceneRoots`（见 §6，config 已加载，属小改）。
3. 重命名同步 game.config.json 的 entryScene（见 §6）。
4. 拖拽/右键菜单/点击导航的自动化测试（需浏览器环境，可配合 Playwright）。
5. 验收轮修复提交（未列入原 M1–M3 范围，均为验收反馈驱动）：边标签可读性/错位根因（3 轮）、
   右键菜单失效、点击导航失效、状态栏提示驻留、高亮收窄、连线降噪。
