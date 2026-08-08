# Surdet 编辑器 M4 验收交接书（E2 素材面板 + E3 配置编辑器第一批）

> 本文档自包含：接手的审阅 AI 不需要额外上下文即可开始。
> 范围：本地 master 单个提交 `a5881fd`（M4），基于 `360b6d0`（M1–M3 验收轮收尾）。
> 任务：**独立审阅并出报告**。默认只报告不修复；若要顺手修小问题，必须在报告中逐项列明改动。
> 前情：M1–M3（编辑器架构拆分 + 流程图 + simulate）已通过人工逐项验收，其交接书见 `ACCEPTANCE-HANDOFF-M1-M3.md`。

---

## 0. 仓库与提交状态（务必先复核）

- **仓库路径**：`E:\surdet`（Windows，PowerShell）。
  ⚠️ 当前为独立 Git 仓库：项目根为 `E:\surdet`；git 相对路径不带 `surdet/` 前缀。
- **远端**：`surdet` → `https://github.com/Equinox7379/Surdet.git`（默认分支 main，引擎在仓库根）。
  本地 master 与远端 main 历史无关（无公共祖先），推送走 commit-tree 移植流程（仓库主人自理）。
  **请勿 push / force / rebase / reset。**
- **待审提交**：`a5881fd`（未推送）。复核：
  ```powershell
  git -C "E:\surdet" log --oneline -3
  git -C "E:\surdet" show a5881fd --stat
  ```

## 1. 回归基线（已实测全绿，复验应一致）

在 `E:\surdet` 下：

| 命令 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **509 过**：core 264 / cli 73 / renderer 83 / shell 19 / **editor 70**（M4 前 52，+18 纯逻辑单测），只增不减 |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

## 2. M4 交付内容

### E2 素材面板（计划 Part A·E2）

- **纯逻辑** `src/assets.ts`：三源汇总 `buildAssetInventory`——
  1. `dir`：`content/assets/**` 与 `public/**` 目录扫描（顶层目录定类型 bg/portrait/bgm/se/voice/video；立绘文件名 `角色_服装_表情.ext` → key `角色:服装` + 表情）；
  2. `gallery`：gallery.json 的 cgs/music/texts（id + src 资源引用）；
  3. `script`：最近一次校验的编译产物中素材类指令参数（@bg/@bgm/@se/@voice/@video/@show + @unlock_* 关联 gallery src 间接使用）。
  来源优先级 dir > gallery > script；同 key 合并 usedBy 与表情集合。`insertLineForAsset` 按类型生成插入行。
- **UI** `src/panels/assets.ts` + 侧栏新增"场景 | 素材"标签页（`src/panels/sidebar.ts`）：
  分组清单（类型图标+中文标签）、引用统计（0 引用标灰"未引用"）、"插入"（当前场景末尾追加指令行，**走 history 可 Ctrl+Z 撤销**）、"复制"（拷 key）、
  bg/portrait/cg 条目 hover 缩略图（有盘上文件 → 真实预览；无文件 → 占位色块 + 说明，**与运行时占位素材哲学一致**）。
- **IO** `src/project-io.ts`：openProject 新增 achievements/gallery 配置读取、`state.handles`（gameConfig/achievements 写盘句柄）、素材目录扫描（无目录静默跳过）。

### E3 配置编辑器第一批（计划 Part A·E3 第 1、2 项）

- **纯逻辑** `src/config-edit.ts`：
  - 变量表：`parseVariablesToRows` / `rowsToVariables`（重复名/非法 initial/min>max/非法类型 全拦截）/ `applyVariablesToConfig`（保留其余顶层键、2 空格缩进、键序=行序）；
  - 成就表：`parseAchievementsToRows` / `rowsToAchievements`（id 唯一性 + when 表达式经 core `parseExpr` **同源语法校验**；空字段不写回，键序 id/name/description/when/hidden 与 starter 现有文件风格一致）；
  - 删除保护：`collectReferencedVars` 收集剧本编译产物引用的变量（@set/@mod/@inc/@dec/@toggle/@flag/@add_item/@switch/@if/choice when/台词插值），返回 变量 → 引用场景集合。
- **UI** `src/panels/config.ts` + 主区新增"配置"标签页（`src/main.ts`）：
  - 变量表编辑器：表格增删行、类型下拉、min/max/readonly/description；保存前全量校验，**删除被剧本引用的变量时弹确认框并列出引用场景**；
  - 成就编辑器：表格增删行、when 输入带变量名下拉提示（datalist，来自变量表）、hidden 开关；
  - **打开配置页即从盘上重读源文件**（外部用文本编辑器改了文件，重进标签页即可见；无文件监听器，见已知限制）；
  - 写盘：2 空格缩进 + 末尾换行；无目录连接（演示项目）时保存入口给出诚实提示，不冒充已保存。

### 测试（+18，全部纯逻辑可 headless 跑）

- `test/assets.test.ts`（8）：三源汇总/来源优先级/引用统计/0 引用条目/各类型插入行/立绘文件名解析/目录约定；
- `test/config-edit.test.ts`（10）：变量往返（含 min/max/readonly/description）、顶层键与缩进保持、五类非法输入拦截、flag/数组 initial 解析、成就往返/when 语法错误/重复空 ID、引用收集覆盖与空场景。

## 3. 有意为之（审阅时请勿误报为缺陷）

1. **编辑器不强制素材文件存在**：starter 没有 content/assets 实体文件，素材清单照样从 gallery.json + 剧本用法推导；hover 预览显示占位色块属预期。
2. **素材插入走 history**：`setSceneText` 独立撤销点，与打字热路径的 coalesce 区分；插入目标为**当前选中场景末尾**。
3. **删除保护的引用来源是最近一次校验产物**：剧本有未保存改动时校验有 300ms 防抖窗口，引用判定可能略滞后——可接受（确认框本身是兜底）。
4. **成就 when 只做语法校验，不做变量声明校验**：声明级校验交给保存后的 `surdet lint`（CONFIG_EXPR_SCANS 已覆盖 achievements when，审计轮2 成果），编辑器不重复实现第二份 lint。
5. **JSON 键序 = 表格行序**：稳定 diff 的刻意选择；重排行序会改变文件键序（不是 bug）。
6. **配置页每次进入重读盘上文件**：这是"文件外部被改动时重新加载"的实现方式（无 watcher）。
7. 变量 initial 在表格里是**文本输入**，按类型解析（number 数字/flag 真假/string[]/object 走 JSON）——文本形态是刻意的表格简化。

## 4. 已知限制（不算缺陷，列入后续）

1. E3 剩余编辑器未做：calendar（节点/baseCommands/回合头尾事件）、growth（曲线/profiles）、events（profiles/events/scheduled）、gallery——后续批次。
2. 立绘选择器简化为素材面板的立绘条目 + 表情集合展示（计划 E2 第 2 项的候选集来源 = 目录扫描 + 剧本用法），未做独立 @show 对话框。
3. 素材预览仅限图片类（bg/portrait/cg hover）；音频试听未做。
4. 配置文件无 watcher，靠重进标签页重读。
5. 素材面板的“插入”不感知光标所在行（固定追加场景末尾；行级插入可在块编辑界面直接改）。
6. 同 key 跨来源合并时类型取先处理来源（dir > gallery > script）：starter 的 `@bgm tense_01` 与 gallery 鉴赏音乐同 key，合并后归在“鉴赏音乐”组而非“音乐”组——合并逻辑符合设计优先级，但分组观感属后续可打磨项。

## 5. 手动验收清单（需浏览器 + File System Access，自动化无法代劳）

`npm run dev -w surdet-editor` → 打开返回地址 → "打开游戏目录"选 `examples/starter`。

**E2 素材面板**
- [ ] 侧栏切到“素材”标签：应按类型分组显示——背景（castle_hall、night_field）、语音（lynn_despair_01）、CG（cg_hall）、鉴赏音乐（tense_01）、回想（t_first）；starter 剧本无 @show，**无立绘条目属预期**；注意 `@bgm tense_01` 与 gallery 鉴赏音乐同 key，按来源优先级合并为一条归在“鉴赏音乐”组（见已知限制 6）
- [ ] 引用统计正确：如 castle_hall 显示被 ch01_01 引用；tense_01 被 ch01_01 引用；0 引用条目（如有）标灰
- [ ] 选中任一场景后点 castle_hall 的"插入" → 当前场景末尾出现 `@bg castle_hall`，状态栏提示驻留 4 秒，**Ctrl+Z 可撤销**
- [ ] 点"复制" → 剪贴板得到 key
- [ ] hover 背景条目 → 出现预览浮层，starter 无盘上文件故显示**占位色块 + 说明**（预期行为）

**E3 配置编辑器**
- [ ] 主区切到"配置"标签：变量表应列出 starter 全部变量（lynn.trust/hasSword/battleWon/cleared/lynn.atk/lynn.hp 等），成就表列出 5 条成就
- [ ] 变量表新增一行 `testVar`（number，initial 0）→ 保存 → 状态栏提示已保存；打开盘上 game.config.json 确认新增字段、2 空格缩进、其余键未动；跑 `node packages/cli/dist/index.js lint examples/starter` 仍 0 错 0 警；随后删除 testVar 再保存（无引用应直接删成功）
- [ ] 删除保护：删除被引用变量（如 lynn.trust）→ 应弹确认框列出引用它的场景清单，取消后变量仍在
- [ ] 变量校验拦截：把某变量 min 改成大于 max（或 initial 填 `xyz`）→ 保存被拒，状态栏显示具体错误（驻留 6 秒）
- [ ] 成就表新增一条 `test_ach`（when 填 `gold > 3` 之类**未声明变量**也可保存——语法合法；保存后跑 lint 应报 V002，这正是"保存后 lint 兜底"的设计；删掉该条恢复）
- [ ] 成就 when 语法错误拦截：新增成就 when 填 `trust >=` → 保存被拒并提示语法错误
- [ ] 外部修改可见：配置页开着时，用文本编辑器给 achievements.json 手动加一条/改个名字，回到编辑器**重新点一次"配置"标签**，应看到盘上最新内容

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
- 编辑器 dev：`npm run dev -w surdet-editor`（vite，端口 5174 起）。
- dev 环境支持 File System Access，**没有"加载演示项目"按钮**；打开真实目录需要用户手势，自动化无法代劳——手动项如实标注。
- CLI 测试依赖 core 的 dist：若改动 core 源码，先 `npm run build -w @surdet/core` 再跑 cli 测试。
