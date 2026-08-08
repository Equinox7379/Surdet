# Surdet 编辑器「日历地图可视化摆放」验收交接书

> 本文档自包含：接手的审阅 AI 不需要额外上下文即可开始。
> 范围：本地 master 单个提交 `9b078ee`（4 文件 +213）。
> 此前所有批次（M1–M7、E3 全配置编辑器、术语面板及各审阅轮修复）均已通过审阅并推送远端，本轮不重复审。
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
  git -C "E:\surdet" show 9b078ee --stat
  ```

## 1. 回归基线（已实测全绿，复验应一致）

在 `E:\surdet` 下：

| 命令 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **558 过**：core 269 / cli 78 / renderer 97 / shell 19 / **editor 95**（+4 地图纯函数单测），只增不减 |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

## 2. 交付内容

- **`src/panels/calendar-map.ts`（新增）**：配置页日历区块的 SVG 地图画布。
  - 节点按行模型 x/y 摆放（800×520 逻辑画布，preserveAspectRatio=none 线性映射）；节点显示名称 + ID + 实时坐标副标；`isBase` 据点金色描边区分。
  - **拖拽摆放**：pointerdown 捕获 → pointermove 实时更新行模型 x/y 与节点位置（坐标钳制画布内、取整）→ pointerup 调 onMoved 触发区块重渲染，表格 x/y 输入框同步。
  - `requires` 前置关系画虚线连接（前置 → 本节点）。
  - 纯函数可测：`clampCoord`（钳制+取整+NaN 回下界）/ `mapNodeWidth`（按名长估算，最小 70）/ `readNodePos`（非法按 0）/ `readRequires`（JSON 数组容错）。
- **`src/panels/config.ts`**：日历区块在标量网格与节点表格之间插入"地图可视化"子区块，onMoved = rerenderConfig（沿用既有本地重建纪律）。
- **styles.css**：画布容器与 svg 样式（aspect-ratio 800/520、touch-action none 防移动端滚动干扰）。
- 测试 +4 组（13 断言）：钳制/宽度/坐标解析/requires 解析。

## 3. 有意为之（审阅时请勿误报为缺陷）

1. **拖拽松手才重渲染**：拖动过程只更新 SVG transform 与行模型，避免高频全区块重建；松手一次 rerender 同步表格。
2. **画布尺寸固定 800×520**：starter 坐标（最大 640×480）在此范围内；超界坐标保存合法但画布内被钳制显示（游戏运行时 CalendarRunner 的摆放不受编辑器画布约束）。
3. **x/y 与表格双向同步是"松手/重渲染时机"**：表格里手改 x/y 不会实时反映到画布，下次重渲染（增删行/保存/重进标签页）生效——刻意不接 oninput 重渲染（性能取舍）。
4. **连线无箭头**：requires 方向靠虚线+节点位置语义表达，未加 marker（简化；后续可加）。
5. **空节点表显示提示**而非空画布（无项目/未新增行时的引导文案）。

## 4. 已知限制（不算缺陷，列入后续）

1. 画布内不做节点重叠检测/自动避让。
2. requires 连线的目标不存在时静默跳过（表格侧 lint 已覆盖场景引用类问题，地图仅可视化存在的节点）。
3. 未提供"拖拽连线编辑 requires"（requires 仍在表格 JSON 列编辑）。

## 5. 手动验收清单（需浏览器 + File System Access）

自动化冒烟已过：日历区块含"地图可视化"子标题 + SVG 画布 + 空态提示、console 无 error。
以下需真人操作（`npm run dev -w surdet-editor` → 打开 `examples/starter` → "配置"标签 → 日历区块）：

1. [ ] 画布显示 3 个节点（据点/迷雾森林/城镇），位置与配置坐标一致（据点左下、森林中上、城镇右中）；据点为金色描边；迷雾森林与据点之间有一条虚线（requires map_01）
2. [ ] **拖拽**：按住"城镇"节点拖动 → 节点跟随鼠标、副标坐标实时变化、拖不出画布边界；松手后下方表格中 map_03 的 x/y 输入框变为新坐标
3. [ ] **保存往返**：拖动后点"保存日历配置" → 盘上 calendar.json 的 map_03 x/y 更新；把坐标改回（拖回去或表格填 640/360）再保存还原
4. [ ] 表格联动：在节点表格手改某节点 x/y 后点"＋ 新增行"（触发重渲染）→ 画布该节点位置跟随变化；删除新增行还原

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
- 编辑器 dev：`npm run dev -w surdet-editor`（vite，端口被占会顺延）。
