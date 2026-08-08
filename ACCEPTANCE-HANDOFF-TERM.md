# Surdet 编辑器「术语一致性面板」验收交接书（audit 下沉 core + 编辑器审计标签页）

> 本文档自包含：接手的审阅 AI 不需要额外上下文即可开始。
> 范围：本地 master 单个提交 `3200e51`（9 文件 +289/−116）。
> 此前里程碑（M1–M7、E3 全部配置编辑器及各审阅轮修复）均已通过审阅并推送远端，本轮不重复审。
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
  git -C "E:\surdet" show 3200e51 --stat
  ```

## 1. 回归基线（已实测全绿，复验应一致）

在 `E:\surdet` 下：

| 命令 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **554 过**：**core 269**（+5 术语单测）/ cli 78（不变，re-export 兼容）/ renderer 97 / shell 19 / editor 91，只增不减 |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

## 2. 交付内容

### audit 术语逻辑下沉 core（分层纪律修复：编辑器不再需要依赖 cli）

- **`packages/core/src/terminology-audit.ts`（新增）**：`AuditFinding`/`TerminologyTerm` 类型 + `levenshtein` + `auditSpeakers`（称谓笔误/称谓变体）+ `auditTerminology`（名词表变体扫描）+ `parseTerminology`（形状容错解析，自 CLI loadTerminology 提炼的纯逻辑）。core index 导出。
- **`packages/cli/src/audit.ts`**：删去下沉的 108 行定义，改从 `@surdet/core` 导入并 **re-export 保持既有导入路径兼容**（cli 既有测试不改一行仍全过）；`loadTerminology` 委托 `parseTerminology`，"terms 非数组"的告警文案保留。

### 编辑器审计标签页（主区第 6 个标签"审计"）

- **`src/panels/audit-panel.ts`（新增）**：
  - 数据源 = 最近一次校验的编译产物（与编辑器其余视图同源，实时跟随编辑）；
  - 称谓一致性：说话人统计 + 首次出现位置定位，一字符之差报 CONSIST_TYPO（warning），前缀称谓报 CONSIST_HONORIFIC（info）；
  - 名词表违规：读 `content/config/terminology.json`（openProject 已加载入 state.configFiles.terminology，可选文件），变体出现于台词/选项 → TERM_VARIANT；
  - 未配置 terminology.json 时面板明示形状说明并只做称谓检查（starter 即此状态）；
  - **条目可点击**：`finding.file`（如 `ch01_01.gal`）映射回场景 key（兼容子目录），跳转经与搜索/流程图同一 `jumpToScene` 入口，滚动定位 + 高亮。
- `state.ts` mainTab 增加 'audit'；`main.ts` 标签与分支、bindAuditHooks；styles 增加 `#audit-view` 与 `.issue.info`。

## 3. 有意为之（审阅时请勿误报为缺陷）

1. **CLI 保留 re-export**：`audit.ts` 重导出下沉函数是为不改既有 cli 测试与调用方的兼容层，不是残留重复实现（实现只在 core 一份）。
2. **面板数据随校验防抖滞后 ≤300ms**：与删除保护同口径（编辑后校验完成前看到的是上一版编译产物）。
3. **starter 无 terminology.json**：面板显示"名词表检查未启用"提示属预期，非缺陷；手动验收第 3 项会临时创建一个。
4. **CONSIST_HONORIFIC 为 info 级**：称谓变体可能是演出意图，仅提示不告警（与 CLI audit 原语义一致）。
5. **审计只读**：面板不提供"一键修复"，替换走已有的跨场景搜索/替换（撤销粒度一致）。

## 4. 已知限制（不算缺陷，列入后续）

1. 名词表无编辑器编辑入口（手改 terminology.json；配置编辑器后续可加第 7 区块）。
2. 称谓检测阈值写死（距离 1 / 前缀差 ≤3 字），与 CLI 同源不可单独调。
3. 审计面板未接入 lint issues 统一列表（两套展示并存：issues 面板管编译/引用，审计面板管内容一致性——刻意分工）。

## 5. 手动验收清单（需浏览器 + File System Access）

自动化冒烟已过：6 标签存在、审计标签空载提示、console 无 error。
以下需真人操作（`npm run dev -w surdet-editor` → 打开 `examples/starter`）：

1. [ ] 打开 starter → "审计"标签 → 应显示"称谓 N 种 · 未配置 terminology.json…"，starter 说话人（凛/主角等）无笔误时应显示"未发现称谓/术语一致性问题"
2. [ ] **称谓笔误实感**：在 ch01_01 临时加一句 `凜：测试。`（凜，异体字）→ 等校验完切审计标签 → 应出现 CONSIST_TYPO 条目；**点击该条目** → 跳到 ch01_01 对应行并高亮；删掉测试句
3. [ ] **名词表实感**：在 `examples/starter/content/config/` 新建 `terminology.json`：
   ```json
   { "terms": [ { "canonical": "石中剑", "variants": ["那把剑"] } ] }
   ```
   在 ch01_01 加一句 `凛：那把剑在发光。` → 审计标签应出现 TERM_VARIANT 条目（提示规范词"石中剑"），点击可跳转；测完删句子和 terminology.json
4. [ ] CLI 对照：`node packages/cli/dist/index.js audit examples/starter --no-run` 在无 terminology.json 时行为与改动前一致（称谓检查正常，无 terms 告警不阻断）

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
