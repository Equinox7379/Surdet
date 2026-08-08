# Surdet 编辑器「名词表编辑区块」验收交接书（术语审计闭环收尾）

> 本文档自包含：接手的审阅 AI 不需要额外上下文即可开始。
> 范围：本地 master 单个提交 `e1fd433`（5 文件 +98/−6）。
> 此前所有批次（M1–M7、E3 全配置编辑器、术语审计面板、日历地图及各审阅轮修复）均已通过审阅并推送远端，本轮不重复审。
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
  git -C "E:\surdet" show e1fd433 --stat
  ```

## 1. 回归基线（已实测全绿，复验应一致）

在 `E:\surdet` 下：

| 命令 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **561 过**：core 269 / cli 78 / renderer 97 / shell 19 / **editor 98**（+3 名词表单测），只增不减 |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

## 2. 交付内容

- **纯逻辑**（`src/config-edit.ts`）：`parseTerminologyRows` / `rowsToTerminology`（canonical/variants 两列；variants 为 JSON 数组文本列，保存时解析；按 canonical 主键合并原条目保留未知字段；校验：规范词唯一 + variants 合法 JSON）。输出形状 `{ terms: [...] }` 与 core `parseTerminology`（审计面板/CLI 消费方）完全同形状。
- **UI**（`src/panels/config.ts`）：配置页第 7 区块"名词表（terminology.json）"——双列通用表格 + 新增/删除行（本地重建纪律）+ "保存名词表"按钮；区块说明注明与审计标签页的联动关系。
- **IO**：`state.handles.terminology` 新增；openProject 加载 terminology.json 时捕获写盘句柄；`saveConfigFile` 支持 terminology（句柄缺失时 `getFileHandle(create)` 自动创建文件）；**进入配置页重读源文件的循环纳入 terminology**（外部修改即时可见，与其他六文件一致）。
- **闭环语义**：名词表保存后，审计标签页的 TERM_VARIANT 检测（core auditTerminology，读 state.configFiles.terminology）随下次校验/重进标签页即时生效——"审计发现违规 → 配置页改名词表 → 审计复查"不再需要手编 JSON。
- 测试 +3 组：往返一致（variants JSON 还原）、拦截（规范词重复/坏 JSON）、空配置容错（null → 空 terms 可保存，支持首次创建文件场景）。

## 3. 有意为之（审阅时请勿误报为缺陷）

1. **复用 E3 既有纪律**：行模型 RowMap、本地重建 rerender、按主键合并（M4 批次审阅轮 Major 1 修复后的语义）、2 空格缩进写盘——无新机制。
2. **starter 无 terminology.json**：首次保存走 `getFileHandle(create)` 创建文件（手动验收第 2 项覆盖）；未保存前审计面板显示"未配置"提示不变。
3. **空 canonical 行不报"重复"但会写入**：canonical 为空的行会产出 `{variants: [...]}` 条目（core parseTerminology 解析时因 canonical 非字符串而跳过，无运行时影响）——与 E3 各表"空单元格=字段删除"口径一致，未单独加"canonical 必填"拦截（保持表格容错风格）。
4. **审计联动是"保存后生效"而非输入即生效**：审计面板数据源是 state.configFiles.terminology（保存时回写），未保存的表格草稿不影响审计——与所有配置区块口径一致。

## 4. 已知限制（不算缺陷，列入后续）

1. variants 列无"从审计条目一键添加变体"联动（可后续加：审计条目右键→加入名词表）。
2. 名词表无导入/导出（手改 JSON 与表格双向可见，已够用）。

## 5. 手动验收清单（需浏览器 + File System Access）

自动化冒烟已过：第 7 区块结构/新增行/console 无 error。
以下需真人操作（`npm run dev -w surdet-editor` → 打开 `examples/starter` → "配置"标签滚到底部）：

1. [ ] 名词表区块渲染：说明文字 + 规范词/变体两列表格 + 新增行 + 保存按钮（starter 无该文件，表格为空）
2. [ ] **首次创建**：新增一行，规范词填 `石中剑`、变体填 `["那把剑"]` → 保存 → 状态栏提示已保存；`examples/starter/content/config/terminology.json` **从无到有**生成，内容为 `{ "terms": [{ "canonical": "石中剑", "variants": ["那把剑"] }] }`
3. [ ] **闭环联动**：在 ch01_01 加一句 `凛：那把剑在发光。` → 审计标签出现 TERM_VARIANT（规范词"石中剑"）；把名词表那行删掉再保存 → 审计条目消失（重进审计标签）；清理测试句
4. [ ] **校验拦截**：新增两行都填规范词 `石中剑` → 保存被拒提示重复；某行变体填 `{bad` → 保存被拒提示 JSON 错误
5. [ ] 测完删除 terminology.json 还原（或保留随意，不污染剧本即可）

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
