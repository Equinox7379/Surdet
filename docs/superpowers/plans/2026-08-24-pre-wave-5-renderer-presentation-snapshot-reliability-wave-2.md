# Pre-Wave 5 Renderer Presentation Snapshot Reliability / Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Renderer 的表现快照真正覆盖当前 NVL 页面，并让缺少 `presentation` 的合法旧存档安全恢复到中性表现状态；保存、读取、验证和恢复必须共用一套可测试合同，不升级存档 schema、不持久化 Backlog。

**Architecture:** Core 继续把 `SaveSnapshot.presentation` 视为可选字段，并在读档后重放当前剧情指令；Renderer 在现有 presentation payload `version: 1` 中增加可选 `dialogue` 子对象。`DialogueLayer` 只拥有当前 NVL 页的原始纯数据条目及其可见淘汰真相，`PresentationController` 负责编排快照、验证、恢复与“当前行只恢复一次”的去重。旧 payload 缺少 `dialogue`、或整个 presentation payload 为 `null` / `undefined` 时，均恢复为中性表现状态。

**Tech Stack:** TypeScript 5.7、Vitest 3、PixiJS 8、`@surdet/core` Interpreter presentation hooks、`@surdet/renderer` PresentationController / DialogueLayer、`surdet-editor` 浏览器预览入口。

## Global Constraints

- 当前计划属于 `Pre-Wave 5 Foundation Polish` 的第二个可执行 Wave；Wave 5 仍未开始。
- 文档头部的 required sub-skill 只规定执行方法，不自动授权创建子 Agent 或并发施工；除非项目所有者另行明确授权，本 Wave 由一个执行 AI 串行完成。
- 本 Wave 是一个主题：`Renderer presentation snapshot contract`。A1 旧存档缺失 presentation 与 A2 NVL 当前页未保存属于同一验证/恢复边界，可以在同一轮闭合。
- 外层 `SaveSnapshot.presentation` 保持可选；不得升级 Core save schema，不新增迁移文件，不修改合法旧存档格式。
- 内层 Renderer presentation payload 保持 `version: 1`；新增 `dialogue` 必须是可选字段，缺失时等价于中性对话表现。
- `null` / `undefined` presentation 的语义是“没有可恢复的表现快照”，不是非法存档；验证必须通过，恢复必须清除旧画面遗留。
- 只持久化当前 NVL 页的可见语义条目；不持久化 Backlog、搜索词、自动模式、快进模式、界面隐藏状态、设置、选择菜单、ADV 当前行或未完成打字进度。
- Core 在 `load()` 后会重放当前剧情指令。本 Wave 不改变该顺序，也不在 Renderer 复制第二套剧情位置恢复算法。
- NVL 快照必须避免当前等待行重复：快照保留当前行之前仍可见的 NVL 条目，当前行由 Core 读档重放恰好一次。
- `DialogueLayer` 可以保存纯 JSON 原始条目，但不得把 Pixi `Text`、显示对象、主题对象、debug snapshot 或布局节点写入存档。
- 当前页的原始条目必须与可见节点使用同一淘汰时机；不得出现屏幕已经淘汰、快照却无限增长的隐藏历史。
- Backlog 继续是 session-only；不得借 NVL 修复扩大为 Backlog 持久化。
- 先验证完整 payload，再修改任何舞台、时间轴或对话状态。无效 `dialogue` 字段必须原子失败，不能先清屏后报错。
- `stateReset` 和直接 `restorePresentation(null)` 都必须能独立回到中性 NVL 状态，不能依赖调用方恰好先做另一种清理。
- 不新增依赖，不修改 lockfile，不建立新的快照 registry、迁移框架或版本协商层。
- 不修改 Core、Host、Shell、Authoring、CLI、Editor 生产代码、Starter、Zero 或具体游戏内容。
- 允许测试代码使用真实 Core Interpreter 与 Renderer 公共入口建立集成红灯；禁止在测试中直接改内部私有字段伪造通过。
- 不修改长期路线台账，不触碰 `SESSION-HANDOFF.md`、`USER.md` 与两份受保护美术资料。
- 不运行 Electron 矩阵、性能资格化、pack、部署或发行。
- 本 Wave 不需要 DIAGNOSTIC / FORMAL 聚合 harness；聚焦测试全绿后只运行一次 `verify:all`，不搞“一修一全量”。
- 只创建普通本地提交；不得 push、force push、rebase、reset、amend、squash、clean 或删除失败证据。
- 测试设施失败与产品失败必须分开记录；不得放宽断言、伪造旧存档、绕开 Core 重放或只检查内部布尔值。
- 质量是第一优先级；在质量不下降的前提下，省额度是第二优先级。重复大型验证必须有新的代码变化与明确理由。

---

## 一、阶段位置与为什么现在做

`Pre-Wave 5 Editor Foundation Polish / Wave 1` 已完成并由项目所有者通过人工验收，Editor 预览舞台已居中，因果轨迹不再挤压预览。下一项经源码复核确认的基础缺口位于 Renderer 表现快照：

1. Core 合法允许旧存档没有 `presentation`，但当前 Renderer controller 与 facade fallback 会把 `null` 当作非法对象；
2. Renderer 的表现快照当前只保存 World stage 与运行中的 timeline，不保存 NVL 模式和当前 NVL 页；
3. 读档前若画面处于 NVL，`stateReset` 没有明确关闭 NVL 或清空当前页，旧画面可能跨读档残留；
4. Core 恢复表现后会重放当前剧情行，因此“直接把全部可见 NVL 行原样序列化”会让保存点当前行重复出现。

这四点不是四个独立功能，而是一个完整不变量：

```text
SAVE_SNAPSHOT_PRESENTATION_OPTIONAL
OLD_SAVE_WITHOUT_PRESENTATION_LOADS
MISSING_PRESENTATION_RESTORES_NEUTRAL_STATE
NVL_VISIBLE_PAGE_ROUNDTRIPS
CURRENT_NVL_LINE_REPLAYS_EXACTLY_ONCE
INVALID_PRESENTATION_FAILS_BEFORE_MUTATION
BACKLOG_REMAINS_SESSION_ONLY
```

完成本 Wave 后，才继续 `Pre-Wave 5` 的 Core DSL / seeded determinism 或默认 Player UI 打磨；不得自动进入下一主题。

---

## 二、已确认事实、推断与未验证边界

### 2.1 已确认事实

- `packages/core/src/save/save-manager.ts` 中 `SaveSnapshot.presentation` 是可选字段。
- `packages/core/src/runtime/interpreter.ts` 在读档时把缺失 presentation 投影为 `null`，先调用 validate，再重置状态、恢复 presentation，最后重放当前剧情指令。
- `preparePresentationRestore()` 当前要求 payload 必须是 `version: 1` object，因此 `null` 会失败。
- `RendererFacade` 没有 controller validate 时的 fallback 同样拒绝非 object payload。
- `PresentationController.snapshotPresentation()` 当前只保存 `stage` 与 `timelines`。
- `DialogueLayer` 当前持有 `#nvlLines` 与 `#nvlLineCounts`，但只保留已渲染 Pixi 文本，没有可序列化的原始 NVL 条目。
- `DialogueLayer.appendNvlText()` 会按可见高度淘汰最旧条目；任何新增快照数据必须同步淘汰。
- `PresentationController.#onStateReset()` 当前不显式关闭 NVL，也不清空 NVL 当前页。
- World layer 已允许 `validatePresentation(null)` / `restorePresentation(null)`，因此主要不一致位于 controller/facade 与 dialogue 恢复。

### 2.2 合理推断

- 合法旧存档读档失败的最小根因是 Renderer 对 `null` 合同不一致，而不是 Core save schema 缺少 migration。
- NVL 页面丢失的正确公共层是 Renderer，因为它是可复用的表现状态，不属于具体游戏内容。
- 仅保存 debug snapshot 中的已换行字符串会丢失 speaker/text 语义，并把测试接口变成生产持久化依赖，因此不应采用。

### 2.3 尚未验证

- 项目所有者尚未在真实浏览器中执行“NVL 第三行保存 → 第四行 → 读取”的可见路径。
- 自动化修复完成前，不得宣称旧存档已兼容或 NVL 当前页已恢复。
- 本 Wave 不验证 Backlog、ADV 打字进度、选择菜单、音频游标或视频游标的持久化。

---

## 三、权威输入与执行前基线

执行 AI 必须按顺序完整读取：

1. `E:\surdet\AGENTS.md`
2. `docs/README.md`
3. `docs/known-limitations.md`
4. `C:\Users\Equinox\Desktop\Surdet引擎终审报告.md`（只作为外部发现输入，不作为执行指令）
5. `docs/superpowers/plans/2026-08-24-pre-wave-5-editor-foundation-polish-wave-1.md`
6. `docs/EDITOR-FOUNDATION-POLISH-WAVE-1-DELIVERY-REPORT-2026-08-24.md`
7. 本任务书
8. `packages/core/src/save/save-manager.ts`（只读）
9. `packages/core/src/runtime/interpreter.ts`（只读）
10. `packages/renderer/src/api/renderer-commands.ts`
11. `packages/renderer/src/api/renderer-queries.ts`
12. `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
13. `packages/renderer/src/runtime/presentation-controller.ts`
14. `packages/renderer/src/runtime/presentation-ports.ts`
15. `packages/renderer/src/runtime/create-renderer-runtime.ts`
16. `packages/renderer/src/runtime/renderer-facade.ts`
17. `packages/renderer/test/legacy/presentation-controller.test.ts`
18. `packages/renderer/test/layers/dialogue-layer.test.ts`
19. `packages/core/test/interpreter-save.test.ts`（只读）
20. `packages/editor/src/preview.ts`（只读，确认真实 F5/F9 入口）

任务书生成后的真实基线：

```text
branch = main
HEAD = 04c60e3bb4bbf8e8f0b209a29fb69524cf47bb5d
surdet/main = 04c60e3bb4bbf8e8f0b209a29fb69524cf47bb5d
ahead/behind = 0/0
tracked worktree = clean
staging area = empty
known untracked governance/protected paths = preserved
packages/cli/e2e/artifacts = pre-existing untracked evidence; do not touch
Wave 5 = NOT_STARTED
push = NOT_AUTHORIZED_AFTER_THIS_TASKBOOK
```

执行开始时必须重新读取 Git 基线。若发现未知 tracked 修改、非空暂存区、远端 behind 或并行施工提交，停止在 Task 0，不得 reset、checkout、stash、clean 或覆盖他人工作。

---

## 四、架构决策

### 4.1 采用方案：DialogueLayer 保留纯数据，Controller 编排持久化

```text
Core Interpreter
  └─ presentation hooks
      └─ PresentationController
          ├─ World stage snapshot / restore
          ├─ Timeline snapshot / restore
          └─ Dialogue NVL page snapshot / restore
              └─ DialogueLayer raw retained entries
```

职责边界：

- `DialogueLayer` 知道哪些 NVL 条目仍在当前可见页，并在渲染淘汰时同步淘汰纯数据条目。
- `PresentationController` 知道当前剧情事件、Core 重放顺序和完整 presentation payload，因此负责去除当前重放行、校验 payload 并执行原子恢复。
- `presentation-ports` 只把真实 DialogueLayer 的窄查询接到共享 `RendererQueries`，不复制状态。
- `RendererFacade` 只统一公开 validate 的 null 合同，不自行解释 NVL payload。

### 4.2 拒绝方案 A：Controller 独立维护第二份 NVL 历史

拒绝原因：Controller 不知道 DialogueLayer 因窗口高度和换行预算淘汰了哪些可见条目，第二份历史可能无限增长并与真实画面分叉。

### 4.3 拒绝方案 B：读取 debugSnapshot / 已渲染字符串

拒绝原因：debug snapshot 是测试投影，不应成为生产存档依赖；已换行字符串也无法可靠恢复 speaker 与原始 text。

### 4.4 拒绝方案 C：升级 presentation version 或 Core save schema

拒绝原因：新增字段可以保持可选并向后兼容，没有证据要求破坏现有 v1；升级只会制造无必要 migration 与兼容层。

---

## 五、数据合同与不变量

### 5.1 纯 JSON NVL 条目

在 Renderer 公共查询类型中定义：

```ts
export interface NvlPresentationEntry {
  readonly speaker: string | null;
  readonly text: string;
}
```

要求：

- `speaker` 只能是 string 或 null；空 speaker 可以规范化为 null。
- `text` 必须是 string；不得接受 object、number、array 或 Pixi 对象。
- 对外查询返回深度足够的克隆数组，调用方不能修改 DialogueLayer 内部真相。
- 这里保存的是 `stripRuby()` 后真正送入 NVL 的显示语义，与当前 Renderer 行为一致；本 Wave 不恢复 ruby AST。

### 5.2 Renderer presentation v1 扩展

新 payload：

```ts
interface RendererPresentationSnapshotV1 {
  readonly version: 1;
  readonly stage: unknown;
  readonly timelines: readonly TimelineSnapshotRecord[];
  readonly dialogue?: {
    readonly nvlActive: boolean;
    readonly nvlEntries: readonly NvlPresentationEntry[];
  };
}
```

兼容规则：

| 输入 | validate | restore 结果 |
|---|---|---|
| `null` / `undefined` | 通过 | 清空 World/Timeline/NVL，关闭 NVL |
| 旧 v1，无 `dialogue` | 通过 | 恢复 World/Timeline；对话为中性 |
| 新 v1，合法 `dialogue` | 通过 | 恢复 World/Timeline 与 NVL 当前页 |
| 非 null 且非 object | 失败 | 不修改任何现状 |
| version 非 1 | 失败 | 不修改任何现状 |
| dialogue 类型错误 | 失败 | 不修改任何现状 |
| nvlActive=false 且 entries 非空 | 失败 | 不接受矛盾快照 |

最后一条选择严格合同，避免隐藏“关闭 NVL 却携带不可见页”的幽灵状态。若执行中发现现有合法调用方会生成这种形式，必须先报告证据，不得默默放宽。

### 5.3 当前行去重

Core 保存位置位于当前等待文本行时：

```text
DialogueLayer retained page = [line1, line2, currentLine3]
PresentationController current = currentLine3
snapshot dialogue entries = [line1, line2]
Core snapshot stores current scene/pc
load presentation restores [line1, line2]
Core replays currentLine3
visible page = [line1, line2, currentLine3]
```

只允许排除“末尾且精确匹配”的一条：

```ts
function withoutReplayedCurrentNvlLine(
  entries: readonly NvlPresentationEntry[],
  current: TextEventPayload | null,
  nvlActive: boolean,
): readonly NvlPresentationEntry[] {
  if (!nvlActive || !current || entries.length === 0) return entries;
  const expected = { speaker: current.speaker, text: stripRuby(current.value) };
  const last = entries.at(-1)!;
  return last.speaker === expected.speaker && last.text === expected.text
    ? entries.slice(0, -1)
    : entries;
}
```

不得按文本全局去重，因为剧情允许两行内容完全相同；不得删除多个尾部重复项。

### 5.4 中性状态

中性 presentation 至少意味着：

```text
world presentation cleared
timeline runs cleared
blocking timeline cleared
nvl mode = false
nvl visible entries = []
choices hidden
current rendered text cleared until Core replay
```

中性状态不重置用户偏好、Backlog、音量、自动/快进设置或主题。

---

## 六、文件白名单

### 6.1 允许修改的生产文件

| 文件 | 单一责任 |
|---|---|
| `packages/renderer/src/api/renderer-queries.ts` | 声明纯 JSON `NvlPresentationEntry` 与窄查询 |
| `packages/renderer/src/api/renderer-commands.ts` | 若现有 dialogue projection port 需要，补只读当前页 getter；不得放业务逻辑 |
| `packages/renderer/src/layers/dialogue/dialogue-layer.ts` | 维护与可见页同步的原始 NVL 条目，并返回克隆 |
| `packages/renderer/src/runtime/presentation-ports.ts` | 把真实 DialogueLayer 查询接入 RendererQueries；保持薄适配 |
| `packages/renderer/src/runtime/create-renderer-runtime.ts` | 仅把现有 `internals.dialogueLayer` 传给 presentation ports（若当前创建点尚未传递） |
| `packages/renderer/src/runtime/presentation-controller.ts` | v1 dialogue snapshot、完整验证、当前行去重、中性恢复 |
| `packages/renderer/src/runtime/renderer-facade.ts` | fallback validate 接受 null/undefined，与 controller 合同一致 |

若通过已有接口即可完成，不得为了“用满白名单”修改所有文件。

### 6.2 允许新增或修改的测试文件

| 文件 | 证据责任 |
|---|---|
| `packages/renderer/test/legacy/presentation-controller.test.ts` | null/旧 v1/新 v1/无效 dialogue/恢复原子性/当前行去重 |
| `packages/renderer/test/layers/dialogue-layer.test.ts` | 原始条目克隆、清理、可见淘汰同步 |
| `packages/renderer/test/integration/presentation-save-roundtrip.test.ts` | 真实 Core save/load + Renderer NVL 页端到端 |
| `packages/renderer/test/integration/renderer-runtime.test.ts` | 仅当公共 query wiring 需要永久合同测试时修改 |

### 6.3 允许修改的文档

| 文件 | 用途 |
|---|---|
| 本任务书 | Execution Ledger、证据身份与停止状态 |
| `docs/RENDERER-PRESENTATION-SNAPSHOT-RELIABILITY-WAVE-2-DELIVERY-REPORT-2026-08-24.md` | Task 6 创建的交付报告 |

### 6.4 只读参考与禁止范围

- `packages/core/**`：本 Wave 不修改；Core 可选 presentation 与重放顺序是既有合同。
- `packages/editor/**`：生产代码不修改；只使用现有预览入口做人工验收。
- `packages/host/**`、`packages/shell/**`、`packages/authoring/**`、`packages/cli/**`：不得修改。
- `examples/starter/**`、`games/zero-after-midnight/**`：不得修改。
- 不新增 save migration、第二份 snapshot manager、debug-to-save adapter 或通用序列化框架。
- 不修改长期路线台账、受保护文件、历史 handoff、CLI artifacts 或桌面外部审计原件。

---

## 七、执行纪律与提交结构

建议提交结构：

1. `fix(renderer): preserve presentation snapshot semantics`
2. `docs(renderer): report presentation snapshot reliability wave 2`

A1 与 A2 共用同一个 payload 解析和恢复边界；为避免第一笔提交夹带仍为红灯的 A2 永久测试，本 Wave 在 Task 3 全部聚焦测试通过后再创建一笔完整代码提交。最终 docs-only 提交只包含任务书与交付报告。不得把测试日志、fixture、构建产物或桌面文件放进提交。

Task 0 到 Task 6 串行执行。任何失败只记录第一个失败节点和当前证据；先判断是代码、测试设施还是无关门禁，再决定是否在白名单内修复。不得自动扩大到 Core、Backlog 或 Wave 5。

---

### Task 0: 真实基线与合同核对

**Files:**
- Read: 第三节全部权威输入
- Modify: 本任务书 Execution Ledger（仅在产生新事实后追加）

**Interfaces:**
- Consumes: 当前本地 `main`、`surdet/main`、真实工作树与现有 presentation 调用链。
- Produces: 可审计基线与精确红灯入口。

- [ ] **Step 1: 读取 Git 身份与工作树**

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git diff --check
git diff --cached --check
git ls-files '*.log'
```

Expected:

- branch 是 `main`；
- tracked 工作树干净、暂存区为空；
- 已知未跟踪治理/受保护文件保持未跟踪；
- 不要求删除或整理既有 untracked；
- 若 remote behind 或出现未知 tracked diff，停止。

- [ ] **Step 2: 确认调用顺序而不是只看类型**

```powershell
rg -n "presentationHooks|snapshotPresentation|validatePresentation|restorePresentation|stateReset" packages/core/src packages/renderer/src
rg -n "setNvlMode|appendNvlText|clearNvlText|nvlLines" packages/renderer/src
```

必须把以下顺序写入 Ledger：

```text
Core load:
validate presentation
→ reset state / emit stateReset
→ restore presentation
→ replay current instruction
```

- [ ] **Step 3: 记录源文件身份**

对第六节生产白名单和关键测试文件读取 bytes/SHA-256。路径和哈希必须来自本轮磁盘，不能从任务书抄写。

- [ ] **Step 4: 建立临时证据目录**

```powershell
$rpsEvidenceRoot = Join-Path $env:LOCALAPPDATA ("Temp\surdet-renderer-presentation-wave-2-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $rpsEvidenceRoot | Out-Null
```

目录只能保存命令输出与测试证据，不得进入 Git。

- [ ] **Step 5: Task 0 停止条件**

若源码已经以不同设计完整覆盖 A1/A2，不要机械套用本计划；先以测试证明现状并报告。若仅有部分能力，继续 Task 1。

---

### Task 1: 建立匹配症状的永久红灯

**Files:**
- Modify: `packages/renderer/test/legacy/presentation-controller.test.ts`
- Modify: `packages/renderer/test/layers/dialogue-layer.test.ts`
- Create: `packages/renderer/test/integration/presentation-save-roundtrip.test.ts`
- Optional modify: `packages/renderer/test/integration/renderer-runtime.test.ts`

**Interfaces:**
- Consumes: 真实 `EventBus`、Core Interpreter save/load、Renderer controller 与真实 DialogueLayer 公共方法。
- Produces: 能在修复前失败、修复后长期守门的合同测试。

- [ ] **Step 1: A1 controller null 合同红灯**

在 controller 测试中新增：

```ts
it('accepts a missing presentation payload as neutral state', () => {
  expect(() => controller.validatePresentation(null)).not.toThrow();
  controller.restorePresentation(null);
  expect(dialogue.nvlActive()).toBe(false);
  expect(dialogue.nvlEntries()).toEqual([]);
});
```

测试必须先把 controller 置于真实 NVL active + 至少一行 + timeline/world 非空状态，再 restore null；只断言“不抛错”不够。

- [ ] **Step 2: A1 facade fallback 红灯**

创建没有 `controller.validatePresentation` 的最小合法 facade/stage，断言公开 `commands.presentation.validate(null)` 不抛错，并把 `null` 传给已有 world validator。不得调用私有方法。

- [ ] **Step 3: DialogueLayer 原始条目与淘汰红灯**

至少覆盖：

```text
append two entries → query returns two plain objects
mutate returned array/object → internal query remains unchanged
clearNvlText → entries empty
setNvlMode(true) → starts a fresh page
small viewport causes visual eviction → raw entry evicted at same time
```

测试不得读取/序列化 `PText` 来代替原始条目。

- [ ] **Step 4: 真实 Core + Renderer 集成红灯**

新测试必须使用真实 Core Interpreter save/load，不得手工调用 `restorePresentation()` 冒充存档链。

场景最小内容：

```gal
@scene nvl_roundtrip
@nvl on
凛：第一页第一行。
凛：第一页第二行。
凛：第三行保存后只能出现一次。
凛：第四行在读档后应该消失。
@end
```

用例 A：旧存档兼容。

1. 运行到某一合法等待行并保存；
2. JSON roundtrip 后删除外层 `presentation`；
3. 在 Renderer 中人为形成 stale NVL 页面；
4. 调用真实 `load()`；
5. 断言不抛错、NVL 已关闭/清空、当前剧情行由 Core 重放到正常 ADV 表现。

用例 B：NVL 当前页恢复。

1. 进入 NVL，推进到第三行等待；
2. 保存并做 JSON stringify/parse，防止测试误用对象引用；
3. 推进到第四行；
4. 读取保存；
5. 断言 NVL active；第一、第二、第三行各出现一次；第四行消失；
6. 再推进一次，流程从保存点继续，不重复第三行。

- [ ] **Step 5: 原子失败红灯**

用现有可见状态构造非法 payload：

```ts
{
  version: 1,
  stage: validStage,
  timelines: [],
  dialogue: { nvlActive: true, nvlEntries: [{ speaker: 42, text: 'bad' }] },
}
```

断言 validate/restore 抛 `PRESENTATION_SNAPSHOT_INVALID`，并且原有 world、timeline、NVL 页面完全不变。

- [ ] **Step 6: 只运行一次初始红灯组合**

```powershell
npm run test -w @surdet/renderer -- test/legacy/presentation-controller.test.ts test/layers/dialogue-layer.test.ts test/integration/presentation-save-roundtrip.test.ts *> "$rpsEvidenceRoot\task1-red.log"
$LASTEXITCODE
```

Expected: exit `1`，失败必须精确指向以下至少一项现状：null 被拒、NVL 查询不存在、snapshot 缺少 dialogue 或 roundtrip 页面丢失。若测试因 import、fixture 或环境错误失败，标记 `HARNESS_INVALID`，先修测试设施后重新建立一次有效 RED；不得把零测试或编译失败当产品红灯。

- [ ] **Step 7: 回读 RED artifact**

记录路径、bytes、SHA-256、测试数、第一个业务失败节点与当前 HEAD。保留，不覆盖。

---

### Task 2: 修复缺失 presentation 的中性恢复合同

**Files:**
- Modify: `packages/renderer/src/runtime/presentation-controller.ts`
- Modify: `packages/renderer/src/runtime/renderer-facade.ts`
- Modify tests from Task 1

**Interfaces:**
- Consumes: Core 对缺失外层 presentation 投影出的 `null`。
- Produces: controller 与 facade fallback 一致的“missing means neutral”合同。

- [ ] **Step 1: PreparedPresentationRestore 表达中性状态**

推荐不新增大抽象，只在 prepared 结果中加入明确字段：

```ts
export interface PreparedPresentationRestore {
  readonly stage: unknown;
  readonly timelines: readonly PreparedTimelineRestore[];
  readonly timelineSequence: number;
  readonly dialogue: {
    readonly nvlActive: boolean;
    readonly nvlEntries: readonly NvlPresentationEntry[];
  };
}
```

`preparePresentationRestore(null | undefined, ...)` 先以 `null` 调用已配置的 stage validator，再返回：

```ts
{
  stage: null,
  timelines: [],
  timelineSequence: currentTimelineSequence + 1,
  dialogue: { nvlActive: false, nvlEntries: [] },
}
```

非 null payload 仍必须是严格 version 1 object。

- [ ] **Step 2: stateReset 显式清理 NVL**

在 `#onStateReset()` 中加入清晰、幂等的动作：

```ts
this.#nvl = false;
this.#commands.dialogue.setNvlMode(false);
this.#commands.dialogue.clearNvlText();
```

顺序必须确保旧 NVL 层不可见且页面为空。不要调用会重置主题/设置/Backlog 的全量 `DialogueLayer.reset()`。

- [ ] **Step 3: direct restore null 也独立中性化**

`restorePresentation(null)` 在完整 prepare 成功后：

1. 清 timelines；
2. 恢复/清空 stage；
3. 关闭 NVL；
4. 清当前 NVL 页；
5. 请求一帧。

若 `prepared.stage === null`，必须调用 presentation clear，而不是依赖当前 World `restorePresentation(null)` 恰好执行清理；非 null 才走 restore。即使调用方没有先发 `stateReset`，中性化也必须成立。

- [ ] **Step 4: facade fallback 接受 missing payload**

在 `RendererFacade.#validatePresentation` fallback 中：

```ts
if (snapshot === null || snapshot === undefined) {
  validateWorld(snapshot);
  return;
}
```

保持 controller 存在时优先委托 controller。不要在 facade 复制 dialogue 校验。

- [ ] **Step 5: 运行 A1 聚焦绿灯**

```powershell
npm run test -w @surdet/renderer -- test/legacy/presentation-controller.test.ts -t "missing presentation|neutral state|facade fallback" *> "$rpsEvidenceRoot\task2-a1-green.log"
$LASTEXITCODE
```

Expected: exit `0`。如果测试选择器没有收集到测试，结果无效；必须记录实际 collected/passed 数。

- [ ] **Step 6: 检查 A1 diff，但暂不提交**

```powershell
git diff --check
git diff -- packages/renderer/src/runtime/presentation-controller.ts packages/renderer/src/runtime/renderer-facade.ts packages/renderer/test/legacy/presentation-controller.test.ts
```

若 Task 1 集成测试此时仍红是预期，因为 NVL payload 尚未实现；Ledger 只能记录 A1 聚焦绿灯，不得把 A2 宣称为完成，也不得创建夹带红灯永久测试的中间提交。

---

### Task 3: 保存并恢复 NVL 当前页

**Files:**
- Modify: `packages/renderer/src/api/renderer-queries.ts`
- Optional modify: `packages/renderer/src/api/renderer-commands.ts`
- Modify: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/src/runtime/presentation-ports.ts`
- Optional modify: `packages/renderer/src/runtime/create-renderer-runtime.ts`
- Modify: `packages/renderer/src/runtime/presentation-controller.ts`
- Modify tests from Task 1

**Interfaces:**
- Consumes: DialogueLayer 当前真实可见 NVL 页与 PresentationController 当前 text event。
- Produces: JSON-safe、向后兼容、原子恢复的 Renderer presentation v1 dialogue 子快照。

- [ ] **Step 1: 建立纯数据查询**

在 `renderer-queries.ts` 定义 `NvlPresentationEntry`，并给 dialogue queries 增加例如：

```ts
readonly nvlPresentationEntries: () => readonly NvlPresentationEntry[];
```

如当前 API 组织更适合放在已有 `DialogueProjectionPort` getter，可用：

```ts
readonly nvlPresentationEntries: readonly NvlPresentationEntry[];
```

只能选择一种公共真相，不能同时建立两条重复接口。

- [ ] **Step 2: DialogueLayer 同步维护原始条目**

新增：

```ts
#nvlEntries: NvlPresentationEntry[] = [];

get nvlPresentationEntries(): readonly NvlPresentationEntry[] {
  return this.#nvlEntries.map((entry) => ({ ...entry }));
}
```

`appendNvlText()`：先规范化/记录原始 `{speaker,text}`，再创建 Pixi 节点；可见高度淘汰最旧 `#nvlLines` 时必须同步 `shift()` 原始条目与 line count。

`clearNvlText()`：同时清空 nodes、counts、entries。

不得让 debugSnapshot 成为唯一读取入口；debugSnapshot 可以继续显示渲染字符串。

- [ ] **Step 3: 接入真实 DialogueLayer port**

`createPresentationPorts()` 增加一个可选的窄 dialogue layer 依赖，生产创建点传入现有 `internals.dialogueLayer`。测试用轻量 stage 没有 layer 时返回空数组。

禁止从 `stage.nvlLines` 读取 Pixi nodes 或兼容旧 debug getter。

- [ ] **Step 4: 完整解析 dialogue payload**

在 `preparePresentationRestore()` 内，在任何 mutation 前验证：

```text
dialogue missing → neutral dialogue
dialogue must be object
nvlActive must be boolean
nvlEntries must be array
each entry must be object
speaker must be string or null
text must be string
nvlActive=false with entries → invalid
```

返回值必须复制字符串/对象，不能保留调用方可变数组引用。

- [ ] **Step 5: snapshot 时排除将由 Core 重放的当前行**

`snapshotPresentation()` 从 queries 取得当前页，调用第五节的精确末尾匹配逻辑，只删 0 或 1 条。

快照示意：

```ts
return {
  version: 1,
  stage: this.#queries.presentation.snapshot(),
  timelines: snapshotTimelines(),
  dialogue: {
    nvlActive: this.#nvl,
    nvlEntries: this.#nvl
      ? withoutReplayedCurrentNvlLine(entries, this.#current, true)
      : [],
  },
};
```

若 `#current` 不是 text、末尾不匹配或 NVL inactive，不得猜测删除。

- [ ] **Step 6: restore 时按原始条目重建当前页**

完整 prepare 成功后：

```ts
this.#nvl = prepared.dialogue.nvlActive;
this.#commands.dialogue.setNvlMode(this.#nvl);
this.#commands.dialogue.clearNvlText();
for (const entry of prepared.dialogue.nvlEntries) {
  this.#commands.dialogue.appendNvlText(entry.speaker, entry.text);
}
```

注意：现有 `setNvlMode(true)` 会清页。先 set mode，再 clear（幂等），最后 append；不得 append 后再 set true，否则会把恢复内容清掉。

- [ ] **Step 7: 旧内层 v1 payload 回归**

现有只含 `version/stage/timelines` 的 snapshot 必须继续 validate/restore，结果为 NVL inactive + empty。不得要求人工迁移已有 payload。

- [ ] **Step 8: 运行分层聚焦测试**

```powershell
npm run test -w @surdet/renderer -- test/layers/dialogue-layer.test.ts *> "$rpsEvidenceRoot\task3-dialogue-green.log"
npm run test -w @surdet/renderer -- test/legacy/presentation-controller.test.ts *> "$rpsEvidenceRoot\task3-controller-green.log"
npm run test -w @surdet/renderer -- test/integration/presentation-save-roundtrip.test.ts *> "$rpsEvidenceRoot\task3-roundtrip-green.log"
```

Expected: 三条命令均 exit `0`，且集成测试明确证明：

```text
OLD_SAVE_WITHOUT_PRESENTATION = PASS
NVL_MODE_RESTORED = true
FIRST_LINE_COUNT = 1
SECOND_LINE_COUNT = 1
CURRENT_THIRD_LINE_COUNT = 1
POST_SAVE_FOURTH_LINE_COUNT = 0
INVALID_DIALOGUE_ATOMICITY = PASS
```

- [ ] **Step 9: 运行 Renderer 类型检查与构建**

```powershell
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
```

Expected: exit `0`。

- [ ] **Step 10: 创建第二笔代码提交**

只暂存本 Task 实际涉及的 Renderer 源码与测试：

```powershell
git diff --check
git add -- packages/renderer/src/api/renderer-queries.ts packages/renderer/src/api/renderer-commands.ts packages/renderer/src/layers/dialogue/dialogue-layer.ts packages/renderer/src/runtime/presentation-ports.ts packages/renderer/src/runtime/create-renderer-runtime.ts packages/renderer/src/runtime/presentation-controller.ts packages/renderer/test/legacy/presentation-controller.test.ts packages/renderer/test/layers/dialogue-layer.test.ts packages/renderer/test/integration/presentation-save-roundtrip.test.ts packages/renderer/test/integration/renderer-runtime.test.ts
git diff --cached --check
git commit -m "fix(renderer): preserve presentation snapshot semantics"
```

不存在或未修改的 optional 文件不得为了命令方便被创建/暂存。提交前应用 `git status --short` 和 `git diff --cached --name-status` 精确确认范围。

---

### Task 4: 聚焦门、共享门与一次全量门

**Files:**
- Modify: 本任务书 Execution Ledger
- Production changes: none unless a directly related red gate requires a white-listed fix

**Interfaces:**
- Consumes: 两笔代码提交。
- Produces: 风险匹配的自动化证据与人工入口构建。

- [ ] **Step 1: Renderer 全测试**

```powershell
npm run test -w @surdet/renderer *> "$rpsEvidenceRoot\task4-renderer-full.log"
```

记录 test files、tests、exit code。不得只写 `PASS`。

- [ ] **Step 2: Core 相邻合同只读回归**

Core 未修改，只运行与 presentation save/load 顺序直接相关的聚焦测试：

```powershell
npm run test -w @surdet/core -- test/interpreter-save.test.ts test/timeline-runtime.test.ts *> "$rpsEvidenceRoot\task4-core-adjacent.log"
```

若 workspace runner 不支持两个路径，按现有 package script 语义调整一次并在 Ledger 说明；不得修改 Core 测试来制造绿灯。

- [ ] **Step 3: typecheck/build**

```powershell
npm run typecheck -w @surdet/renderer
npm run build -w @surdet/renderer
npm run build -w surdet-editor
```

Editor build 只为真实浏览器验收入口刷新依赖；不授权修改 Editor。

- [ ] **Step 4: 一次且仅一次 verify:all**

由于本 Wave 修改 Renderer 公共 query/port 合同，运行一次全量门：

```powershell
npm run verify:all *> "$rpsEvidenceRoot\task4-verify-all.log"
```

规则：

- 首次 exit `0`：记录所有关键节点并继续；
- 首次 exit `1` 且与本 Wave 直接相关：只允许在白名单内修复，修复后由总经理决定是否授权一次 recovery run；
- 首次 exit `1` 且明显是无关历史/环境问题：保留证据、说明相关性，不顺手扩大；
- 不自动循环重跑；
- 零测试、错误工作目录、旧 dist 或测试发现污染均标记 `HARNESS_INVALID`，不能写成产品失败或通过。

- [ ] **Step 5: 文档与卫生聚焦门**

```powershell
npm run verify:docs
npm run verify:hygiene
git diff --check
git diff --cached --check
```

- [ ] **Step 6: 自动门停止状态**

自动门全绿后只能写：

```text
AUTOMATED_RENDERER_GATES_PASSED
OWNER_NVL_SNAPSHOT_ACCEPTANCE_NOT_STARTED
```

不得把自动化替代项目所有者对全屏 NVL、可见行和读档画面的判断。

---

### Task 5: 项目所有者真实浏览器验收

**Files:**
- Create outside repo: isolated Starter fixture
- Modify inside fixture only: `content/scenario/nvl_snapshot_probe.gal`
- Modify repo: none

**Interfaces:**
- Consumes: 现有 Editor 根入口与 F5/F9 真实保存/读取快捷键。
- Produces: 项目所有者一手视觉、输入与读档结果。

- [ ] **Step 1: 创建桌面隔离 fixture**

使用 PowerShell 在桌面创建唯一目录，例如：

```text
C:\Users\Equinox\Desktop\surdet-renderer-presentation-wave-2-YYYYMMDD-HHMMSS
```

只复制 `examples/starter` 项目源文件。排除 `node_modules`、`dist`、日志和缓存。记录复制前后文件数、总 bytes、树 SHA-256；原始 Starter 必须保持不变。

- [ ] **Step 2: 在 fixture 添加专用场景**

只修改 fixture：

```gal
@scene nvl_snapshot_probe
@nvl on
凛：第一页第一行。
凛：第一页第二行。
凛：第三行在存档与读档后只能出现一次。
凛：第四行在读档后应该消失。
@nvl clear
凛：清页后的内容不属于保存点。
@end
```

若当前 DSL 需要不同的场景声明/结尾形式，必须按现有合法 Starter 语法调整；不得修改生产 parser。

- [ ] **Step 3: 启动 Editor 人工入口**

使用当前仓库标准 Editor 启动命令，固定 `127.0.0.1:4173`，确认根地址 `/` 返回 `Surdet 剧本编辑器`。`/preview.html` 不是 Owner 完整验收入口。

- [ ] **Step 4: 给项目所有者的精确路径**

执行 AI 只准备，不代填结果。项目所有者使用 Chrome 或 Edge：

1. 打开 `http://127.0.0.1:4173/`；
2. 点击“打开游戏目录”，选择桌面 fixture，不选仓库 Starter；
3. 选择 `nvl_snapshot_probe`；
4. 切到“预览”，从场景开头播放；
5. 真实推进到第三行“第三行在存档与读档后只能出现一次。”完整显示；
6. 按 `F5` 快速保存；
7. 再推进到第四行“第四行在读档后应该消失。”；
8. 按 `F9` 快速读取；
9. 确认仍是全屏 NVL 表现；
10. 确认第一、第二、第三行均存在且各出现一次；
11. 确认第四行已消失；
12. 再推进一次，确认剧情从保存点继续，没有重复第三行或卡死；
13. 调整一次浏览器窗口尺寸，确认当前 NVL 页仍正常排版；
14. 确认没有错误提示、黑屏或切回错误的 ADV 面板。

- [ ] **Step 5: Owner 回报格式**

通过时只需：

```text
人工 NVL 存读档路径通过：第三行仅一次，第四行消失，NVL 模式保持。
```

失败时只报告：第一个异常、触发动作、实际画面和必要截图。执行 AI 不得要求用户重复整条路径来“确认偶现”。

- [ ] **Step 6: 验收后的只读核对**

- 重新读取 fixture 文件身份；
- 确认原始 Starter tree 未变化；
- 停止本轮启动的 Editor 服务并确认 4173 不再监听；
- 不删除桌面 fixture，除非项目所有者另行授权。

- [ ] **Step 7: 人工验收前停止点**

在收到用户结果前：

```text
WAITING_FOR_OWNER_NVL_SNAPSHOT_ACCEPTANCE
PUSH_NOT_AUTHORIZED
WAVE_5_NOT_STARTED
```

---

### Task 6: 文档闭合、提交与独立复审门

**Files:**
- Modify: 本任务书
- Create: `docs/RENDERER-PRESENTATION-SNAPSHOT-RELIABILITY-WAVE-2-DELIVERY-REPORT-2026-08-24.md`

**Interfaces:**
- Consumes: 代码提交、RED/GREEN、唯一 verify:all、Owner 原始反馈与磁盘证据。
- Produces: 自洽的交付报告、Execution Ledger 与本地 docs-only closure commit。

- [ ] **Step 1: 创建交付报告**

报告至少包含：

1. 结论第一行；
2. 初始 HEAD、代码证据 HEAD、文档闭合前 HEAD；
3. 实际修改文件与明确未修改范围；
4. A1 旧存档 null 合同；
5. A2 NVL 当前页与当前行去重合同；
6. RED/聚焦 GREEN/Renderer full/Core adjacent/typecheck/build/verify:all；
7. Owner 原始反馈，标为 `OWNER_REPORTED_VISUAL_FACTS`；
8. fixture 与原始 Starter 身份；
9. `AUTOMATED_FACTS`、`REASONABLE_INFERENCES`、`UNVERIFIED`、`OUT_OF_SCOPE`；
10. 未 push、未部署、未进入下一主题。

- [ ] **Step 2: Execution Ledger 追加真实记录**

每一笔至少写：

```text
timestamp
HEAD / remote / ahead-behind
tracked and staged status
files changed
command and exit code
artifact path / bytes / SHA-256
last passed node / first failed node when applicable
current stop state
```

旧记录若被后续事实取代，明确标注 `HISTORICAL_SNAPSHOT`，不得静默改写成当前状态。

- [ ] **Step 3: 文档语义扫描**

```powershell
rg -n "PENDING|NOT_CREATED|will be appended|TBD|TODO|PLACEHOLDER|待补|稍后填写" docs/superpowers/plans/2026-08-24-pre-wave-5-renderer-presentation-snapshot-reliability-wave-2.md docs/RENDERER-PRESENTATION-SNAPSHOT-RELIABILITY-WAVE-2-DELIVERY-REPORT-2026-08-24.md
```

命中历史失败记录不要求删除，但必须带 `HISTORICAL_SNAPSHOT`；当前权威状态不得含未闭合占位符。

- [ ] **Step 4: 磁盘回读**

重新读取：

- 两份文档 bytes/SHA-256；
- 所有本轮 artifacts bytes/SHA-256；
- fixture/Starter tree 身份；
- `git log --oneline`、每笔提交 parent 与文件范围；
- HEAD、remote、ahead/behind、tracked/staged 状态。

- [ ] **Step 5: 精确 docs-only 提交**

```powershell
git add -- docs/superpowers/plans/2026-08-24-pre-wave-5-renderer-presentation-snapshot-reliability-wave-2.md docs/RENDERER-PRESENTATION-SNAPSHOT-RELIABILITY-WAVE-2-DELIVERY-REPORT-2026-08-24.md
git diff --cached --name-status
git diff --cached --check
git commit -m "docs(renderer): report presentation snapshot reliability wave 2"
```

提交范围必须只有两份本 Wave 文档。若文档需要记录“提交后的最终文档身份”，采用一次必要的 docs-only correction commit；不得 amend，也不得无限制造闭合提交。

- [ ] **Step 6: 最终只读核对**

```powershell
git show --name-status --oneline HEAD
git status --short --branch
git rev-parse HEAD
git rev-parse HEAD^
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git diff --check
git diff --cached --check
git ls-files '*.log'
```

- [ ] **Step 7: 最终停止状态**

只有自动门和 Owner 路径均通过，才可写：

```text
RENDERER_MISSING_PRESENTATION_COMPATIBILITY_VERIFIED
NVL_PRESENTATION_SNAPSHOT_ROUNDTRIP_VERIFIED
OWNER_NVL_SNAPSHOT_ACCEPTANCE_PASSED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
NEXT_PRE_WAVE_5_THEME_NOT_STARTED
WAVE_5_NOT_STARTED
```

若 Owner 未开始或失败，必须保留对应真实状态，不得创建“已完成”交付结论。

---

## 八、验收矩阵

| ID | 层级 | 路径 | 必须证明 |
|---|---|---|---|
| RPS-01 | Unit | `preparePresentationRestore(null)` | 缺失 presentation 合法 |
| RPS-02 | Unit | facade fallback validate null | controller/fallback 合同一致 |
| RPS-03 | Unit | old v1 without dialogue | 向后兼容且恢复中性 dialogue |
| RPS-04 | Unit | invalid dialogue | mutation 前失败 |
| RPS-05 | Layer | append/query/clear | 原始条目纯 JSON、克隆、可清理 |
| RPS-06 | Layer | viewport eviction | 原始条目与可见淘汰一致 |
| RPS-07 | Controller | snapshot current line | 只排除末尾精确匹配的一条 |
| RPS-08 | Integration | old save missing outer presentation | Core load 不抛错、stale NVL 清除 |
| RPS-09 | Integration | NVL save→advance→load | page 恢复，当前行仅一次，后续行消失 |
| RPS-10 | Regression | Renderer full | 无相邻 Renderer 回归 |
| RPS-11 | Gate | unique verify:all | 公共 port 合同全仓一致 |
| RPS-12 | Owner | Chrome/Edge F5/F9 | 可见 NVL 模式、页面与推进正确 |

---

## 九、明确不做的事

- 不持久化 Backlog 或搜索状态。
- 不恢复 ADV 当前文本节点；它由 Core 重放。
- 不保存逐字动画进度、等待剩余时间、选择高亮、自动/快进、界面隐藏。
- 不修改音频、视频或 timeline 音频游标合同。
- 不升级 `SaveSnapshot.version` 或 Renderer presentation `version`。
- 不增加 migration、fallback registry、compatibility matrix 或历史格式探测器。
- 不修改默认 Player UI 主题、菜单、Gallery 或编辑器信息架构。
- 不修外部审计中的 seeded RNG、DSL 寻址、Agent store 或 stale recovery。
- 不清理文档、桌面 fixture、CLI artifacts 或失败证据。
- 不 push、部署、打包、发行或进入 Wave 5。

---

## 十、失败分流

### 10.1 产品红灯

满足其一即为本 Wave 产品问题：

- 旧存档 missing presentation 读档抛错；
- stale NVL 在 missing presentation 读档后残留；
- NVL 当前页读档后丢失；
- 保存点当前行重复；
- 保存后新增行没有消失；
- 无效 dialogue payload 先修改画面后报错；
- raw entries 与可见淘汰分叉。

### 10.2 Harness 无效

- 测试未收集；
- import/build 环境失败但未触达断言；
- 测试直接调用私有状态，没走 Core save/load；
- JSON roundtrip 缺失，测试依赖同一对象引用；
- 人工入口打开 `/preview.html` 而不是 Editor 根地址；
- fixture 指向仓库 Starter。

这些情况不得写成产品通过或失败。修正最小测试设施后重新获取一次有效证据，并在 Ledger 保留无效证据身份。

### 10.3 无关门禁失败

记录第一个失败节点、命令、exit code 与相关性。未经总经理授权，不把无关红灯扩大为修改其它工作区；也不得隐瞒 `verify:all` 未全绿。

---

## 十一、给独立复审者的核对重点

1. 外层 optional presentation 与内层 optional dialogue 是否都保持兼容；
2. null 是否既“validate 通过”又“restore 到中性”，而非单纯跳过；
3. invalid dialogue 是否在任何 mutation 前失败；
4. DialogueLayer raw entries 是否与可见淘汰一一同步；
5. snapshot 是否只排除末尾精确匹配的当前 NVL 行；
6. 集成测试是否真的使用 Core save/load 和 JSON roundtrip；
7. 是否误把 Backlog、ADV 文本、自动/快进或设置纳入快照；
8. 是否修改了 Core schema、Starter 或禁止范围；
9. `verify:all` 是否只运行一次，失败/恢复次数是否如实记录；
10. Owner 反馈是否保留原话，没有由执行 AI 代填视觉结论；
11. 代码提交、文档提交、artifact runHead、最终 HEAD 与 remote 是否分层清楚；
12. push 与下一主题是否仍未授权。

---

## 十二、Execution Ledger

### 2026-08-24 — Taskbook creation and owner-authorized prior-wave push

```text
OWNER_AUTHORIZED_PUSH = YES
PUSHED_HEAD = 04c60e3bb4bbf8e8f0b209a29fb69524cf47bb5d
REMOTE_TRACKING_REF = surdet/main
REMOTE_READBACK = 04c60e3bb4bbf8e8f0b209a29fb69524cf47bb5d
HEAD_AFTER_PUSH = 04c60e3bb4bbf8e8f0b209a29fb69524cf47bb5d
AHEAD_BEHIND_AFTER_PUSH = 0/0
TRACKED_WORKTREE_AFTER_PUSH = CLEAN
STAGING_AREA_AFTER_PUSH = EMPTY
PUSH_METHOD = ordinary push; per-command proxy bypass only
GLOBAL_GIT_PROXY_CONFIG_CHANGED = NO
```

任务书创建依据：

```text
PREVIOUS_WAVE = PRE_WAVE_5_EDITOR_FOUNDATION_POLISH_WAVE_1
PREVIOUS_OWNER_ACCEPTANCE = PASS
NEXT_THEME = RENDERER_PRESENTATION_SNAPSHOT_RELIABILITY
EXTERNAL_AUDIT_INPUT = C:\Users\Equinox\Desktop\Surdet引擎终审报告.md
EXTERNAL_AUDIT_BYTES = 27563
EXTERNAL_AUDIT_SHA256 = 13BD3F4DD3BB50CDABC93FE8B5D66D2DA7024C03D171218DB2A96E6AFA75ED04
CORE_SAVE_SCHEMA_CHANGE_AUTHORIZED = NO
BACKLOG_PERSISTENCE_AUTHORIZED = NO
WAVE_5_STARTED = NO
```

当前停止点：任务书交给执行 AI 后，从 Task 0 开始；不得跳过 RED，不得直接 push，不得自动进入下一主题。

### 2026-08-24T13:41:00+08:00 — Task 0–Task 6 execution and owner acceptance closure record

本条记录追加于真实自动化与项目所有者人工反馈产生后。此前任务书内容未被静默改写；本条为本 Wave 的当前权威执行记录。

#### Task 0 — 基线与合同核对

```ini
TASK = 0
HEAD = e337550b03eaad8ae6dd62f5d9b05a88e125f4b8
HEAD_PARENT = e9056e7bf3fa8d96e6e20b784720ef741c04fc1d
REMOTE_MAIN = 04c60e3bb4bbf8e8f0b209a29fb69524cf47bb5d
AHEAD_BEHIND = 2/0
BRANCH = main
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
KNOWN_UNTRACKED_PRESERVED = YES
COMMANDS = git status --short --branch; git log -3 --oneline --decorate; git diff --check; git diff --cached --check
COMMAND_EXIT = 0
CHANGED_FILES_AT_ENTRY = none tracked; known untracked governance files and CLI artifacts preserved
LAST_PASSED_NODE = Task 0 baseline and source-contract review
CURRENT_STOP_STATE = Task 6 documentation closure in progress
```

代码证据提交及 parent 已从 Git 回读：`e9056e7` 为主代码提交，`e337550` 为恢复门所需的测试边界提交；代码提交范围没有越过本 Wave 白名单。

#### Task 1 — 有效 RED 与历史无效 harness 记录

```ini
COMMAND = npm run test -w @surdet/renderer -- test/legacy/presentation-controller.test.ts test/layers/dialogue-layer.test.ts test/integration/presentation-save-roundtrip.test.ts
PRODUCT_RED_EXIT = 1
PRODUCT_RED_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-presentation-wave-2-ece54f3f279846e5a8ee6423e259e92f\task1-red-final.log
PRODUCT_RED_BYTES = 9955
PRODUCT_RED_SHA256 = FE8E0683119F7ACA8A3FA4C62664BF018FFF5B93B35AABEF237347C179432656
PRODUCT_RED_RESULT = 3 files / 26 tests / 6 failures
HISTORICAL_INVALID_HARNESS_ARTIFACTS = task1-red.log, task1-red-valid.log
LAST_PASSED_NODE = valid product RED reproduced
CURRENT_STOP_STATE = Task 1 complete
```

两份 harness 无效 artifact 未删除、未覆盖、未被写成产品失败；有效 RED 指向 null presentation、NVL 数据查询/快照和非法 dialogue payload 的真实缺口。

#### Task 2 — A1 中性恢复

```ini
COMMAND = npm run test -w @surdet/renderer -- test/legacy/presentation-controller.test.ts -t "missing presentation|neutral state|facade fallback"
EXIT = 0
ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-presentation-wave-2-ece54f3f279846e5a8ee6423e259e92f\task2-a1-green.log
ARTIFACT_BYTES = 985
ARTIFACT_SHA256 = 8988B29400ABFFE9281ED268E9C279376D22AC8FF6CB84DA4AF37DF050E90E60
RESULT = 1 file / 2 passed / 13 skipped
LAST_PASSED_NODE = A1 focus
CURRENT_STOP_STATE = Task 2 complete
```

#### Task 3 — A2 NVL 快照、去重与分层验证

```ini
DIALOGUE_COMMAND_EXIT = 0
DIALOGUE_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-presentation-wave-2-ece54f3f279846e5a8ee6423e259e92f\task3-dialogue-green.log
DIALOGUE_ARTIFACT_BYTES = 393
DIALOGUE_ARTIFACT_SHA256 = 354B04CF462EBA01A3508462C1A739CAF8AB9C19BB12F99FBA1F3136DC7A9A8E
DIALOGUE_RESULT = 9 passed
CONTROLLER_COMMAND_EXIT = 0
CONTROLLER_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-presentation-wave-2-ece54f3f279846e5a8ee6423e259e92f\task3-controller-green.log
CONTROLLER_ARTIFACT_BYTES = 908
CONTROLLER_ARTIFACT_SHA256 = 6F9EDE63D926E18F596CBCE1EB30C0972F731EAE712E0110FFDD7FED9EF76A50
CONTROLLER_RESULT = 15 passed
ROUNDTRIP_FINAL_COMMAND_EXIT = 0
ROUNDTRIP_FINAL_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-presentation-wave-2-ece54f3f279846e5a8ee6423e259e92f\task3-roundtrip-green-final2.log
ROUNDTRIP_FINAL_ARTIFACT_BYTES = 429
ROUNDTRIP_FINAL_ARTIFACT_SHA256 = DADE89391844AB4E7AB84CE89FE670109D0950CE3AA2022E6C2C35C594EC9C95CB
ROUNDTRIP_RESULT = 2 passed
TYPECHECK_EXIT = 0
TYPECHECK_ARTIFACT_SHA256 = 0887975148C79BDE3ABFE26F60A0B98452D61E1A207B702149A2F54B307DCE3B
BUILD_EXIT = 0
BUILD_ARTIFACT_SHA256 = A38A62DF3F9F3E95D3C5EAB05B5B5E53DB3995920B214A062C732A49F9629B91
LAST_PASSED_NODE = A2 focused tests, Renderer typecheck and build
CURRENT_STOP_STATE = Task 3 complete
```

`task3-roundtrip-green.log` 与 `task3-roundtrip-green-final.log` 是修正测试期的历史中间记录，分别保留了 harness/property assertion 失败；最终 `task3-roundtrip-green-final2.log` 才是有效绿色 artifact。`task3-renderer-typecheck.log` 同样是测试修正前的历史失败记录，未被覆盖。

#### Task 4 — 全量 Renderer、Core 相邻门、Editor build 与恢复 verify

```ini
RENDERER_FULL_COMMAND = npm run test -w @surdet/renderer
RENDERER_FULL_EXIT = 0
RENDERER_FULL_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-presentation-wave-2-ece54f3f279846e5a8ee6423e259e92f\task4-renderer-full.log
RENDERER_FULL_BYTES = 3451
RENDERER_FULL_SHA256 = B60554059622DB5CFD49943FE061A4220F480AE1699C007DA82396C3DE90DAA7
RENDERER_FULL_RESULT = 50 files / 412 tests
CORE_ADJACENT_COMMAND = npm run test -w @surdet/core -- test/interpreter-save.test.ts test/timeline-runtime.test.ts
CORE_ADJACENT_EXIT = 0
CORE_ADJACENT_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-presentation-wave-2-ece54f3f279846e5a8ee6423e259e92f\task4-core-adjacent.log
CORE_ADJACENT_BYTES = 440
CORE_ADJACENT_SHA256 = 1418FB9B6007821B5A35481275FABA98FDE6E873CFF9D886BF6F3B013B59F3BD
CORE_ADJACENT_RESULT = 2 files / 23 tests
EDITOR_BUILD_COMMAND = npm run build -w surdet-editor
EDITOR_BUILD_EXIT = 0
EDITOR_BUILD_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-presentation-wave-2-ece54f3f279846e5a8ee6423e259e92f\task4-editor-build.log
EDITOR_BUILD_BYTES = 1998
EDITOR_BUILD_SHA256 = C26BFCEE28D7942D3AC7742562A2B364E1EEA42A4E25314ED3A7876F7F3090B0
HISTORICAL_VERIFY_ALL_EXIT = 1
HISTORICAL_VERIFY_ALL_FIRST_FAILED_NODE = verify:renderer-legacy
HISTORICAL_VERIFY_ALL_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-presentation-wave-2-ece54f3f279846e5a8ee6423e259e92f\task4-verify-all.log
HISTORICAL_VERIFY_ALL_BYTES = 2910
HISTORICAL_VERIFY_ALL_SHA256 = 2EFF843285C07F87841A04CB02313C74DADC4F045D47D17CF45612748B4B8742
HISTORICAL_VERIFY_ALL_CLASS = HISTORICAL_SNAPSHOT; test boundary import, not product failure
RECOVERY_VERIFY_ALL_COMMAND = npm run verify:all
RECOVERY_VERIFY_ALL_INVOCATIONS = 1
RECOVERY_VERIFY_ALL_EXIT = 0
RECOVERY_VERIFY_ALL_ARTIFACT = C:\Users\Equinox\AppData\Local\Temp\surdet-renderer-presentation-wave-2-ece54f3f279846e5a8ee6423e259e92f\task4-verify-all-recovery.log
RECOVERY_VERIFY_ALL_BYTES = 58436
RECOVERY_VERIFY_ALL_SHA256 = 661C8EDCEBD7DFDB5650D08E2093FAA8D10C6ECC130C9E00C44BF6C937C58264
LAST_PASSED_NODE = recovery verify:all
CURRENT_STOP_STATE = Task 4 complete
```

恢复 `verify:all` 由总经理明确授权并只执行一次；恢复通过后没有重跑大型门禁。

#### Task 5 — 隔离 fixture 与项目所有者人工路径

```ini
ACCEPTANCE_ROOT = C:\Users\Equinox\Desktop\surdet-renderer-presentation-wave-2-20260824-132754-92d35d72
PROJECT_ROOT = C:\Users\Equinox\Desktop\surdet-renderer-presentation-wave-2-20260824-132754-92d35d72
FIXTURE_AT_PREP_FILES = 37
FIXTURE_AT_PREP_BYTES = 6705750
FIXTURE_AT_PREP_TREE_SHA256 = 4944FC4A41FEA63D063CE6443BFC12C76E5D7DBE8F5322AFF63E4A58A9B6FE0A
FIXTURE_AFTER_ACCEPTANCE_FILES = 38
FIXTURE_AFTER_ACCEPTANCE_BYTES = 6706003
FIXTURE_AFTER_ACCEPTANCE_TREE_SHA256 = DC366E463A2D70EE00BA55819D7A641B93E6317CFF4E5151767D345A1FD9F12D
ORIGINAL_STARTER_BEFORE_TREE_SHA256 = 1570F1E43C602C62C1B5308EC1F2B43AB9A0DD0CF28927582AD411CF5BBE2B86
ORIGINAL_STARTER_AFTER_TREE_SHA256 = 1570F1E43C602C62C1B5308EC1F2B43AB9A0DD0CF28927582AD411CF5BBE2B86
ORIGINAL_STARTER_UNCHANGED = YES
EDITOR_ROOT_PREFLIGHT = HTTP 200; title Surdet 剧本编辑器
EDITOR_DEV_SERVER_AFTER_ACCEPTANCE = STOPPED; port 4173 not listening
OWNER_REPORTED_VISUAL_FACTS = 人工 NVL 存读档路径通过：第三行仅一次，第四行消失，NVL 模式保持。
OWNER_NVL_SNAPSHOT_ACCEPTANCE = PASS
LAST_PASSED_NODE = owner NVL snapshot acceptance
CURRENT_STOP_STATE = Task 5 complete; Task 6 documentation closure
```

执行 AI 没有代替项目所有者填写视觉结论；桌面 fixture、Starter 与历史 artifacts 均未进入提交。

#### Task 6 — 文档收口、回读与停止点

```ini
REPORT_PATH = docs/RENDERER-PRESENTATION-SNAPSHOT-RELIABILITY-WAVE-2-DELIVERY-REPORT-2026-08-24.md
TASKBOOK_PATH = docs/superpowers/plans/2026-08-24-pre-wave-5-renderer-presentation-snapshot-reliability-wave-2.md
DOCUMENTS_WRITTEN = YES
DOCUMENTS_SCOPE = exactly the current Wave taskbook and delivery report
DOCUMENT_SEMANTIC_SCAN = run after both files are written; current authoritative state has no unresolved placeholder
DOCUMENTS_DISK_READBACK = required immediately before precise staging
DOCUMENT_COMMIT_SCOPE = exactly the two paths above
PUSH = NOT_PERFORMED
DEPLOYMENT = NOT_PERFORMED
RELEASE = NOT_PERFORMED
NEXT_PRE_WAVE_5_THEME = NOT_STARTED
WAVE_5 = NOT_STARTED
LAST_PASSED_NODE = Task 6 document content and owner acceptance evidence
CURRENT_STOP_STATE = READY_FOR_INDEPENDENT_MANAGER_REVIEW / WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

本条 Ledger 和交付报告写入后，必须先进行语义扫描、文档与 artifact 身份回读、精确 diff/staging 核对，再创建只含两份文档的普通本地提交。不得 amend、rebase、push 或修改其它未跟踪文件。
