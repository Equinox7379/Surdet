# Surdet 编辑器「E3 剩余配置编辑器」验收交接书（日历/成长/事件/鉴赏）

> 本文档自包含：接手的审阅 AI 不需要额外上下文即可开始。
> 范围：本地 master 单个提交 `ee6337a`（6 文件 +696/−60），补齐计划 Part A·E3 的剩余四项。
> 此前里程碑（M1–M7 及各审阅轮修复，含 E3 第一批"变量表+成就"）均已通过审阅并推送远端，本轮不重复审。
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
  git -C "E:\surdet" show ee6337a --stat
  ```

## 1. 回归基线（已实测全绿，复验应一致）

在 `E:\surdet` 下：

| 命令 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **548 过**：core 264 / cli 78 / renderer 97 / shell 19 / **editor 90**（+9 配置往返/拦截单测），只增不减 |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

## 2. 交付内容

### 四大新编辑器（配置标签页新增区块，变量表/成就表原有不动）

- **日历/地图日程（calendar.json）**：标量网格（maxAp/maxTurns/weeksPerMonth/dateTemplate/onTurnStartEventId/onTurnEndEventId）+ 地图节点表（id/name/x/y/据点勾选/AP 消耗/前置节点 JSON/开放条件 when/关联事件）+ 据点指令表（id/name/AP/when/效果 JSON/每回合次数上限）。
- **角色成长（growth.json）**：曲线标量（curve.base/curve.linear）+ profiles 表（角色 ID/初始等级/等级上限/每级属性成长 JSON/等级事件 JSON：等级→场景）。
- **事件（events.json）**：好感 profiles 表（角色/变量/阶段 tiers JSON）+ 条件事件表 + 日程事件表（共用列：id/角色/when/场景/仅一次勾选/优先级/效果 JSON）。
- **鉴赏（gallery.json）**：CG 表 + 鉴赏音乐表（id/name/src）+ 回想表（id/name/回放场景/回放标签）。

### 实现要点

- **纯逻辑**（`src/config-edit.ts` +9 组 parse/rowsTo 函数 + 共用助手）：
  - 行模型 ⇄ JSON 往返；**保存时与原条目合并，未枚举字段原样保留**（`custom: 'keep-me'` 有单测锁定）；
  - 数字列自动还原 number、JSON 列（requires/effects/tiers/statGrowth/levelEvents）按 JSON 解析、空单元格=删除字段；
  - 校验：各表 ID 唯一、when 表达式经 core `parseExpr` 同源语法校验、标量数字校验、growth initialLevel≤maxLevel、levelEvents 值必须字符串。
- **UI**（`src/panels/config.ts` 重写）：通用对象表格（文本/复选/JSON 三种列型 + 增删行**本地重建**，沿用 M4 审阅轮 Major 1 的 rerender 纪律）+ 标量网格；六区块各自"保存 XX"按钮。
- **写盘**：`state.handles` 扩展至全部 content/config 五文件（openProject 捕获句柄）；保存 2 空格缩进 + 末尾换行；句柄缺失时尝试 `getFileHandle(create)`，仍无则诚实拒绝（演示项目不落盘）；**进入配置页即从盘上重读全部源文件**（外部修改即时可见）。

## 3. 有意为之（审阅时请勿误报为缺陷）

1. **复杂字段用 JSON 文本列**（effects/tiers/statGrowth/levelEvents/requires）：键值不定、嵌套自由，表格化会失真；JSON 文本 + 保存时解析校验是刻意的最小失真方案。
2. **未知字段保留**：编辑器只枚举常用列，其余字段经原条目合并写回——不吞用户自定义配置。
3. **空单元格 = 删除该字段**：与"字段缺省即引擎默认值"一致（如 nodes 无 when = 始终开放）。
4. **数字自动还原规则**：匹配 `^-?\d+(\.\d+)?$` 的单元格转 number，其余保持字符串——id 含纯数字字符串（如 `"01"`）会被转成 1，已知取舍（配置 ID 惯例不用前导零数字）。
5. **日历节点 x/y 为数字输入**：未做可视化拖拽摆放（见 §4）。
6. **成长曲线无数值预览**：只编辑 base/linear 两个系数，曲线形状由引擎 `growthForLevel` 消费。

## 4. 已知限制（不算缺陷，列入后续）

1. 日历节点无坐标可视化（地图预览/拖拽摆放）——E2 素材面板的延伸方向。
2. 配置编辑不进编辑器 history（Ctrl+Z 不覆盖配置改动；保存前可用"重进标签页"恢复盘上态）。
3. events.json 的 effects 与日历 effects 均为 JSON 文本，未做变量名联想（成就 when 有 datalist，此处未接）。
4. ngp.json / shop.json / combat.json 三个全家桶配置未做编辑器（使用频率低，手改 JSON 即可）。

## 5. 手动验收清单（需浏览器 + File System Access）

自动化冒烟已过：六区块结构/新增行/console 无 error（无项目状态）。
以下需真人操作（`npm run dev -w surdet-editor` → 打开 `examples/starter`）：

1. [ ] 配置标签页六区块全部渲染，starter 数据正确回填（日历 3 节点/3 据点指令、成长 1 profile、事件 2+2、鉴赏 2CG/1 音乐/2 回想）
2. [ ] **日历**：新增一个地图节点（如 map_04）→ 保存 → 盘上 calendar.json 出现新节点且其余内容不变；跑 `node packages/cli/dist/index.js lint examples/starter` 仍 0 错；随后删除该节点再保存还原
3. [ ] **校验拦截**：把某据点指令的 when 改成 `trust >=`（坏表达式）→ 保存被拒并提示语法错误；把 maxAp 改成 `abc` → 同样被拒；改回
4. [ ] **成长**：把 curve.base 改成 20 → 保存 → 盘上 growth.json 更新 → 改回 10 保存还原
5. [ ] **事件**：在日程事件表把某条 once 勾选切换 → 保存 → 盘上对应布尔翻转 → 还原
6. [ ] **鉴赏**：新增一条 CG（id 与已有重复）→ 保存被拒提示重复；改成新 id 保存成功 → 删除还原
7. [ ] 外部修改可见：配置页开着时用文本编辑器改 gallery.json 某名字 → 重进配置标签页应见新值

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
