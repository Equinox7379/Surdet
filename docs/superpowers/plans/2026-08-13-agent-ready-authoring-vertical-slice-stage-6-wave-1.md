# Surdet Stage 6 Wave 1 Agent-Ready Authoring Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create subagents or parallel workers unless the project owner separately authorizes their exact scope.

**Goal:** 建立外部桌面 Agent 可通过 Surdet 公共能力安全制作、验证、提交一个双分支可玩短章，并让项目所有者在现有编辑器中理解、反向定位、预览和接管该成果。

**Architecture:** 新增单一 `@surdet/authoring` 工作区，依赖纯运行语义层 `@surdet/core`，内聚无损项目快照、对象索引、隔离事务、类型化创作操作、校验/模拟、三层差异和证据。`@surdet/cli` 提供 Node 文件系统、事务目录与稳定 JSON 适配；`surdet-editor` 提供 File System Access 与最小双向因果界面；正式 Core/Renderer 运行链产生运行与 Presentation 应用证据，不建立第二套运行时。

**Tech Stack:** TypeScript 5.7、ESM、Node.js ≥20、Vitest 3、Vite 6、Playwright 1.49、Electron 43、现有 `@surdet/core` / `@surdet/renderer` / `@surdet/host` / `@surdet/shell`。

## Global Constraints

- 先完整读取 `E:\surdet\AGENTS.md`、长期路线台账、本计划、批准规格和 Stage 5 最新任务/报告，再核对真实 Git 基线。
- 外部桌面 Agent 负责自然语言理解和编排；Surdet 不内置模型、聊天页、提示词管理或 Agent 专属项目格式。
- 只新增一个公共工作区 `@surdet/authoring`；不得提前拆 `protocol`、`evidence`、`transactions`、`agent-sdk` 或 `mcp` 包。
- `@surdet/core` 保持纯运行语义，不依赖 authoring、CLI、editor、Node 文件系统、DOM 或 Git。
- 命名对象使用语义身份；匿名对象使用修订期 `objectRef`；禁止永久 UUID 污染、永久旁路索引和模糊 patch。
- 所有 Agent 写入默认进入原生隔离事务；`change.commit` 前不得修改真实项目文件。
- `change.commit` 不是 Git commit；未经项目所有者明确授权，不得 push、部署、打包、发行、rebase、reset、amend、squash 或进入 Wave 2。
- 不修改《零点之后》、原始 `examples/starter` 内容、音频、美术、Gallery、性能门限、发行配置或受保护文件。
- Stage 5 的混合 LF/CRLF 红灯是本轮无损写入的相关前置条件；禁止批量归一化、放宽断言或隐藏全文件格式变化。
- 自动证据必须区分静态校验、Core 模拟、正式 Presentation 应用与项目所有者人工观察；自动化不得填写人工通过。
- 失败 evidence/artifact 不得被后续成功运行覆盖；不得循环重跑聚合正式路径。
- 执行 AI 不修改、暂存或提交长期路线台账；每个 Task 的事实只追加到本计划 `Execution Ledger`，最终报告增加“建议由总经理登记的事实”。
- 每项 Task 只暂存该 Task 白名单文件与本计划；不夹带 AGENTS、受保护文件、handoff、长期台账、日志、临时 fixture、构建产物或其他既有未跟踪文件。
- 每次提交前运行 `git diff --check` 与 `git diff --cached --check`，并用 `git diff --cached --name-status` 核对精确范围。
- 所有人工 fixture 放在桌面易选择路径；所有自动故障 fixture 与 artifact 放在仓库外临时/本机应用数据目录。

---

## 0. 权威文件与真实基线

### 必读文件

- `E:\surdet\AGENTS.md`
- `E:\surdet\docs\superpowers\plans\2026-08-13-project-roadmap-and-decision-ledger.md`
- `E:\surdet\docs\superpowers\specs\2026-08-13-agent-ready-authoring-vertical-slice-design.md`
- `E:\surdet\docs\superpowers\plans\2026-08-13-editor-minimum-authoring-loop-stage-5.md`
- `E:\surdet\docs\EDITOR-MINIMUM-AUTHORING-LOOP-STAGE-5-DELIVERY-REPORT-2026-08-13.md`
- 本计划

### 计划编写时的只读基线

```text
branch = main
HEAD = 0cad5757b6217e446e4655803f07758e503f3578
surdet/main = 5994ec7bd64b2106da6e47cd86e88fb4df82ed01
HEAD...surdet/main = 4 0
tracked worktree = clean
staging area = empty
```

该基线只说明任务书创建时的事实。执行时必须重新读取，禁止复制本段充当新鲜证据。

## 1. 文件结构与职责

### 新增 `packages/authoring`

- `packages/authoring/package.json`：工作区身份、脚本和 Core 依赖。
- `packages/authoring/tsconfig.json`：源码与测试类型检查。
- `packages/authoring/tsconfig.build.json`：只构建 `src` 到 `dist`。
- `packages/authoring/src/contracts.ts`：能力信封、错误代码、对象/事务/证据公共类型。
- `packages/authoring/src/scene-document.ts`：逐行保留 EOL 的无损场景文档与类型化 block 序列化。
- `packages/authoring/src/project-storage.ts`：平台无关项目存储、哈希与事务仓储窄接口。
- `packages/authoring/src/project-snapshot.ts`：项目文件读取、规范路径、项目修订和只读快照。
- `packages/authoring/src/object-index.ts`：语义身份、修订期对象引用、引用与源位置索引。
- `packages/authoring/src/change-session.ts`：事务状态、幂等 operation、工作修订和冲突检查。
- `packages/authoring/src/operations.ts`：`scene.create`、`scene.patch`、`variable.ensure` 类型化操作。
- `packages/authoring/src/validation.ts`：共享项目校验门面。
- `packages/authoring/src/simulation.ts`：共享分支模拟与确定性显式路径运行。
- `packages/authoring/src/evidence.ts`：统一证据信封、artifact 身份和失败保留。
- `packages/authoring/src/diff.ts`：人类摘要、语义差异和原始文件差异。
- `packages/authoring/src/runtime-trace.ts`：Core 轨迹归一化、状态因果与查询。
- `packages/authoring/src/index.ts`：唯一公共导出面。
- `packages/authoring/test/*.test.ts`：各模块聚焦契约。

### CLI 适配

- `packages/cli/src/authoring/node-project-storage.ts`：安全 Node 项目文件适配器。
- `packages/cli/src/authoring/node-change-store.ts`：本机 Surdet 数据目录中的跨进程事务与 evidence 存储。
- `packages/cli/src/authoring/authoring-service.ts`：能力名到共享内核调用的薄路由。
- `packages/cli/src/authoring-command.ts`：CLI 参数/JSON 输入、stdout/stderr 与退出码。
- `packages/cli/src/index.ts`：注册 `capabilities/project/object/change/scene/variable/runtime` 命令族。
- `packages/cli/src/lint.ts`、`packages/cli/src/simulate.ts`：保留旧 CLI 外观，但改为共享 authoring 校验/模拟的薄包装。
- `packages/cli/test/authoring-contract.test.ts`：14 项能力 JSON 合同与无噪声输出。
- `packages/cli/test/authoring-vertical-slice.test.ts`：公共 CLI 红灯到绿灯事务链。

### Core 与正式运行证据

- `packages/core/src/runtime/interpreter.ts`：发出只读、结构化的运行因果事件，不改变现有游戏语义。
- `packages/core/test/interpreter-trace.test.ts`：状态变化、选择和跳转轨迹。
- `packages/editor/src/preview.ts`：把 Core 事件与 Presentation snapshot 配对，并发送父窗口轨迹事件。
- `packages/editor/src/panels/preview-panel.ts`：接收并保存当前预览 trace。
- `packages/editor/test/preview-causal-trace.test.ts`：预览消息合同与 Presentation 应用证据。

### 编辑器最小双向因果桥

- `packages/editor/src/model.ts`：改为从 `@surdet/authoring` 重导出共享场景文档 API。
- `packages/editor/src/validate.ts`：改为共享 authoring 校验的适配器，不保留第二套项目校验真相。
- `packages/editor/src/state.ts`：当前 `selectedObjectRef`、当前 trace 与反向定位请求。
- `packages/editor/src/panels/editor.ts`：块选择映射到对象引用并接受轨迹反向定位。
- `packages/editor/src/panels/right.ts`：紧凑可折叠因果检查区。
- `packages/editor/src/panels/preview-panel.ts`：轨迹列表、对象过滤与事件点击回跳。
- `packages/editor/src/main.ts`：装配对象选择和反向跳转钩子。
- `packages/editor/src/styles.css`：最小因果区和选择态样式。
- `packages/editor/test/causal-selection.test.ts`：对象 ↔ trace 双向选择纯逻辑测试。

### 聚合路径与交付

- `packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`：唯一聚合纵向 harness；通过公共 CLI 建 fixture，再驱动正式 editor preview/Renderer 路径跑两分支并写 artifact。
- `docs/AUTHORING-AGENT-READY-VERTICAL-SLICE-STAGE-6-WAVE-1-DELIVERY-REPORT-2026-08-13.md`：最终真实交付报告。
- 本计划：Execution Ledger、命令、提交和停止状态。

---

### Task 0: 重新建立真实基线并冻结范围

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md`

**Interfaces:**
- Consumes: 本计划第 0 节列出的权威文件。
- Produces: 新鲜 Git/测试基线和本轮唯一有效 Execution Ledger 起点。

- [x] **Step 1: 完整读取权威文件和执行技能**

Run:

```powershell
Get-Content -LiteralPath E:\surdet\AGENTS.md -Raw
Get-Content -LiteralPath E:\surdet\docs\superpowers\plans\2026-08-13-project-roadmap-and-decision-ledger.md -Raw
Get-Content -LiteralPath E:\surdet\docs\superpowers\specs\2026-08-13-agent-ready-authoring-vertical-slice-design.md -Raw
Get-Content -LiteralPath E:\surdet\docs\superpowers\plans\2026-08-13-editor-minimum-authoring-loop-stage-5.md -Raw
Get-Content -LiteralPath E:\surdet\docs\EDITOR-MINIMUM-AUTHORING-LOOP-STAGE-5-DELIVERY-REPORT-2026-08-13.md -Raw
Get-Content -LiteralPath E:\surdet\docs\superpowers\plans\2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md -Raw
```

Expected: 六份文件均能完整读取；执行 AI 能复述当前唯一主题、禁止项和最终停止点。

- [x] **Step 2: 重新读取 Git 身份和现有修改归属**

Run:

```powershell
git branch --show-current
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git status --short --untracked-files=all
git diff --check
git diff --cached --check
git ls-files '*.log'
git log -8 --oneline
```

Expected: 记录真实结果，不要求必须等于计划编写基线；若出现未知 tracked 修改或暂存内容，停止并报告，不 reset/checkout/清理。

- [x] **Step 3: 重新建立 Stage 5 EOL 红灯**

Run:

```powershell
npm run test -w surdet-editor -- test/model-roundtrip.test.ts
```

Expected before Task 1 implementation: exit `1`；只允许 `ch01_01.gal` 与 `ch02.gal` 的混合 EOL 逐字节断言失败。若失败集合不同，记录新鲜结果并在继续前判断相关性。

- [x] **Step 4: 在本计划末尾追加 Task 0 Execution Ledger**

必须写入：时间、branch、HEAD、远端关系、tracked/未跟踪状态、Stage 5 红灯实际数量、实际运行命令、当前停止状态和下一步。不得修改长期路线台账。

- [x] **Step 5: 提交基线记录**

```powershell
git add -- docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md
git diff --cached --check
git diff --cached --name-status
git commit -m "docs(authoring): record stage 6 wave 1 baseline"
```

Expected: 提交只修改本计划；不 push。

---

### Task 1: 建立 `@surdet/authoring` 与逐行 EOL 无损场景文档

**Files:**
- Create: `packages/authoring/package.json`
- Create: `packages/authoring/tsconfig.json`
- Create: `packages/authoring/tsconfig.build.json`
- Create: `packages/authoring/src/contracts.ts`
- Create: `packages/authoring/src/scene-document.ts`
- Create: `packages/authoring/src/index.ts`
- Create: `packages/authoring/test/scene-document.test.ts`
- Modify: `packages/editor/src/model.ts`
- Modify: `packages/editor/test/model-roundtrip.test.ts`
- Modify: `packages/editor/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: current plan ledger

**Interfaces:**
- Consumes: `LineModel`、`parseLine`、`parseScript`、`serializeScript`、rebuild helpers 的现有 editor 行为。
- Produces: `SceneDocumentLine`、`parseSceneDocument(text)`、`serializeSceneDocument(lines, defaultEol)`、`replaceLine`、`insertLinesAfter`；editor 的旧导入名继续由 `model.ts` 重导出，但实现真相只有 authoring 一份。

- [x] **Step 1: 写 authoring package 与 EOL 红灯测试**

`packages/authoring/package.json` 必须是：

```json
{
  "name": "@surdet/authoring",
  "version": "0.1.0",
  "description": "Surdet shared authoring kernel: project objects, isolated changes and causal evidence",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@surdet/core": "0.1.0"
  }
}
```

测试至少包含以下精确断言：

```ts
import { describe, expect, it } from 'vitest';
import { insertLinesAfter, parseSceneDocument, serializeSceneDocument } from '../src/scene-document.js';

describe('scene document EOL identity', () => {
  it('roundtrips mixed LF/CRLF byte-for-byte', () => {
    const source = '@scene mixed\r\n凛：第一行\n凛：第二行\r\n@end';
    expect(serializeSceneDocument(parseSceneDocument(source), '\n')).toBe(source);
  });

  it('inserts with the anchor EOL without changing unrelated delimiters', () => {
    const source = '@scene mixed\r\n凛：第一行\n@end';
    const next = insertLinesAfter(parseSceneDocument(source), 1, [{ kind: 'text', speaker: '凛', value: '新增', raw: '凛：新增' }]);
    expect(serializeSceneDocument(next, '\n')).toBe('@scene mixed\r\n凛：第一行\n凛：新增\n@end');
  });
});
```

- [x] **Step 2: 运行红灯**

Run:

```powershell
npm run test -w @surdet/authoring -- test/scene-document.test.ts
```

Expected: FAIL；package 或 `scene-document` 导出尚不存在。

- [x] **Step 3: 实现逐行终止符模型**

公共类型必须保留原始行与该行终止符，而不是只记录文件主 EOL：

```ts
export type SceneEol = '\r\n' | '\n' | '\r' | '';

export type SceneDocumentLine =
  | { kind: 'blank'; raw: string; eol: SceneEol }
  | { kind: 'comment'; raw: string; eol: SceneEol }
  | { kind: 'label'; name: string; raw: string; eol: SceneEol }
  | { kind: 'choice-option'; raw: string; eol: SceneEol }
  | { kind: 'text'; speaker: string; value: string; sep: string; raw: string; eol: SceneEol }
  | { kind: 'instr'; name: string; raw: string; eol: SceneEol };
```

实现规则：

```ts
export function parseSceneDocument(text: string): SceneDocumentLine[] {
  if (text === '') return [parseSceneLine('', '', '')];
  const chunks = text.match(/.*?(?:\r\n|\n|\r|$)/g)?.filter((chunk) => chunk.length > 0) ?? [];
  const out: SceneDocumentLine[] = [];
  let previous = '';
  for (const chunk of chunks) {
    const match = /(\r\n|\n|\r)$/.exec(chunk);
    const eol = (match?.[1] ?? '') as SceneEol;
    const raw = eol ? chunk.slice(0, -eol.length) : chunk;
    const line = parseSceneLine(raw, previous, eol);
    out.push(line);
    previous = line.kind === 'instr' && line.name === 'choice' ? 'choice' : line.kind;
  }
  return out;
}

export function serializeSceneDocument(lines: readonly SceneDocumentLine[], defaultEol: Exclude<SceneEol, ''> = '\n'): string {
  return lines.map((line, index) => line.raw + (line.eol || (index < lines.length - 1 ? defaultEol : ''))).join('');
}
```

`parseSceneLine(raw, previousKind, eol = '')` 的第三参数必须有默认值，以兼容 editor 现有双参数调用。插入 helper 必须在不改无关行终止符的前提下，为原末行补上邻近/default EOL，并让新末行保持 `eol=''`。

- [x] **Step 4: 让 editor `model.ts` 成为兼容重导出**

保留现有 import 名，避免一次性改所有面板：

```ts
export {
  parseSceneLine as parseLine,
  parseSceneDocument as parseScript,
  serializeSceneDocument as serializeScript,
  rebuildTextRaw,
  rebuildLabelRaw,
  splitInstruction as splitInstr,
  rebuildInstructionRaw as rebuildInstrRaw,
} from '@surdet/authoring';
export type { SceneDocumentLine as LineModel } from '@surdet/authoring';
```

同步修改 editor 创建新行的字面量，显式给出 `eol`，不得使用类型断言绕过。

- [x] **Step 5: 更新工作区依赖与锁文件**

根 `build`、`test`、`typecheck` 中确保 authoring 在 Core 之后、CLI/editor 之前；editor 增加 `@surdet/authoring: 0.1.0`。

Run:

```powershell
npm install --package-lock-only --ignore-scripts
```

Expected: lockfile 出现 `packages/authoring` 与 `node_modules/@surdet/authoring` workspace link，不新增第三方运行依赖。

- [x] **Step 6: 运行绿灯**

```powershell
npm run test -w @surdet/authoring -- test/scene-document.test.ts
npm run test -w surdet-editor -- test/model.test.ts test/model-roundtrip.test.ts
npm run typecheck -w @surdet/authoring
npm run typecheck -w surdet-editor
npm run build -w @surdet/authoring
npm run build -w surdet-editor
```

Expected: 全部 exit `0`；此前两个混合 EOL 红灯转绿；原始 Starter 文件 Git 身份不变。

- [x] **Step 7: 更新 Execution Ledger 并提交**

Commit message:

```text
feat(authoring): add lossless scene documents
```

提交范围只能包含本 Task 文件和本计划。

---

### Task 2: 项目快照、修订与对象索引

**Files:**
- Create: `packages/authoring/src/project-storage.ts`
- Create: `packages/authoring/src/project-snapshot.ts`
- Create: `packages/authoring/src/object-index.ts`
- Create: `packages/authoring/test/project-snapshot.test.ts`
- Create: `packages/authoring/test/object-index.test.ts`
- Modify: `packages/authoring/src/contracts.ts`
- Modify: `packages/authoring/src/index.ts`
- Modify: current plan ledger

**Interfaces:**
- Consumes: `parseSceneDocument`、Core `compileScene`、调用方注入的 `sha256(text)`。
- Produces: `ProjectStorage`、`ProjectSnapshot`、`loadProjectSnapshot`、`buildObjectIndex`、`inspectProject`、`inspectObject`。

- [x] **Step 1: 写快照与对象引用红灯**

测试必须证明文件顺序不影响修订、命名对象身份可读、匿名引用绑定修订、重复文本仍得到不同引用：

```ts
it('gives duplicate dialogue lines distinct revision-scoped refs', async () => {
  const snapshot = await fixtureSnapshot({
    'game.config.json': '{"entryScene":"prologue","variables":{}}',
    'content/scenario/prologue.gal': '@scene prologue\n凛：一样\n凛：一样\n@end',
  });
  const index = await buildObjectIndex(snapshot);
  const texts = index.objects.filter((object) => object.kind === 'text');
  expect(texts).toHaveLength(2);
  expect(texts[0]!.objectRef).not.toBe(texts[1]!.objectRef);
  expect(texts.every((object) => object.objectRef.includes(snapshot.revision.slice(0, 8)))).toBe(true);
});
```

- [x] **Step 2: 运行红灯**

```powershell
npm run test -w @surdet/authoring -- test/project-snapshot.test.ts test/object-index.test.ts
```

Expected: FAIL；模块未实现。

- [x] **Step 3: 定义平台无关存储和快照类型**

使用以下窄接口，不在 authoring import `node:*` 或 DOM：

```ts
export interface ProjectFile {
  path: string;
  text: string;
  bytes: number;
  sha256: string;
}

export interface ProjectStorage {
  readonly rootIdentity: string;
  listFiles(): Promise<string[]>;
  readText(path: string): Promise<ProjectFile>;
  exists(path: string): Promise<boolean>;
}

export interface TextHasher {
  sha256(text: string): Promise<string>;
}
```

`loadProjectSnapshot` 只接受规范 `/` 相对路径，稳定排序后读取 `game.config.json`、`content/scenario/**/*.gal`、`content/timelines/**/*.json` 和已识别素材键；项目修订基于 `path + NUL + file.sha256` 的稳定串再哈希，不含时间戳和绝对路径。

- [x] **Step 4: 实现对象索引**

公共对象至少包含：

```ts
export interface AuthoringObject {
  kind: 'scene' | 'label' | 'text' | 'choice' | 'choice-option' | 'instruction' | 'variable' | 'timeline' | 'asset';
  semanticId?: string;
  objectRef: string;
  parentRef?: string;
  source?: { path: string; line: number; col: number; raw: string };
  references: string[];
  referencedBy: string[];
}
```

规则：场景/标签/变量/时间轴/素材用语义 ID；匿名对象引用含项目修订短码、规范路径、对象种类、行位置和原内容短指纹。`inspectObject` 对不存在返回 `OBJECT_NOT_FOUND`，候选多于一个返回 `OBJECT_AMBIGUOUS`，绝不挑第一个猜测。

- [x] **Step 5: 运行绿灯**

```powershell
npm run test -w @surdet/authoring -- test/project-snapshot.test.ts test/object-index.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
```

Expected: exit `0`。

- [x] **Step 6: 更新 Execution Ledger 并提交**

Commit message:

```text
feat(authoring): index project objects
```

---

### Task 3: 原生隔离事务、类型化操作与恢复 journal

**Files:**
- Create: `packages/authoring/src/change-session.ts`
- Create: `packages/authoring/src/operations.ts`
- Create: `packages/authoring/test/change-session.test.ts`
- Create: `packages/authoring/test/operations.test.ts`
- Create: `packages/authoring/test/commit-recovery.test.ts`
- Modify: `packages/authoring/src/contracts.ts`
- Modify: `packages/authoring/src/project-storage.ts`
- Modify: `packages/authoring/src/index.ts`
- Modify: current plan ledger

**Interfaces:**
- Consumes: `ProjectSnapshot`、`ObjectIndex`、无损场景文档。
- Produces: `ChangeRepository`、`beginChange`、`applySceneCreate`、`applyScenePatch`、`ensureVariable`、`commitChange`、`rollbackChange`。

- [x] **Step 1: 写事务状态与幂等红灯**

至少包含：

```ts
it('replays identical operationId but rejects a different payload', async () => {
  const change = await beginFixtureChange();
  const input = createSceneInput('op-create', 'branch_a');
  const first = await applySceneCreate(change, input);
  const replay = await applySceneCreate(change, input);
  expect(replay).toEqual(first);
  await expect(applySceneCreate(change, { ...input, sceneId: 'branch_b' }))
    .rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
});
```

并故障注入：提交第二个文件替换失败，第一个文件必须恢复；恢复也失败时返回 `COMMIT_RECOVERY_FAILED` 并保留 journal。

- [x] **Step 2: 运行红灯**

```powershell
npm run test -w @surdet/authoring -- test/change-session.test.ts test/operations.test.ts test/commit-recovery.test.ts
```

Expected: FAIL。

- [x] **Step 3: 定义事务与仓储接口**

```ts
export type ChangeStatus = 'OPEN' | 'COMMITTED' | 'ROLLED_BACK' | 'STALE';

export interface ChangeRecord {
  changeId: string;
  projectRootIdentity: string;
  baseRevision: string;
  workingRevision: number;
  status: ChangeStatus;
  baseFiles: Record<string, { sha256: string }>;
  workingFiles: Record<string, string>;
  operations: Record<string, { requestHash: string; result: unknown }>;
  latestValidation?: { workingRevision: number; evidenceId: string; errors: number };
}

export interface ChangeRepository {
  create(record: ChangeRecord): Promise<void>;
  read(changeId: string): Promise<ChangeRecord | null>;
  write(record: ChangeRecord): Promise<void>;
  writeEvidence(changeId: string, evidenceId: string, value: unknown): Promise<void>;
  readEvidence(changeId: string, evidenceId: string): Promise<unknown | null>;
  writeJournal(changeId: string, value: unknown): Promise<void>;
}

export interface ProjectWriteStorage extends ProjectStorage {
  stageText(path: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }>;
  replaceFromStage(path: string, stagedIdentity: string): Promise<void>;
  restoreText(path: string, originalText: string): Promise<void>;
  removeStage(stagedIdentity: string): Promise<void>;
}
```

`ProjectWriteStorage` 是提交器唯一允许使用的写入口。`stageText` 只能在 `change.commit` 已通过新鲜校验和冲突检查之后调用；它在目标文件同目录创建随机命名临时文件并回读 SHA，再逐文件原子替换。`stagedIdentity` 是仓储生成的不透明值，调用方不得传任意绝对路径。恢复 journal 必须记录每个文件的原 SHA、目标 SHA、临时文件身份、是否已替换和是否已恢复。`change.begin` 至 commit 调用前，项目目录内不得出现 staging 或任何其他写入。

- [x] **Step 4: 实现最小类型化 block 输入**

```ts
export type SceneBlockInput =
  | { kind: 'text'; speaker?: string; value: string }
  | { kind: 'label'; name: string }
  | { kind: 'instruction'; name: string; args?: string[]; modifiers?: Record<string, string> }
  | { kind: 'choice'; options: { label: string; when?: string; effects?: { name: string; args: string[] }[]; target: { kind: 'goto' | 'jump'; value: string } }[] };

export type ScenePatchOperation =
  | { kind: 'replaceText'; target: string; expectedFingerprint: string; speaker?: string; value: string }
  | { kind: 'insertAfter'; anchor: string; expectedFingerprint: string; blocks: SceneBlockInput[] }
  | { kind: 'replaceChoiceOption'; target: string; expectedFingerprint: string; option: Extract<SceneBlockInput, { kind: 'choice' }>['options'][number] }
  | { kind: 'removeObject'; target: string; expectedFingerprint: string };
```

`scene.create` 只接受合法场景 ID；`variable.ensure` 只写 `game.config.json.variables`，相同合同幂等，不同类型/初值返回 `OBJECT_PRECONDITION_FAILED`。

- [x] **Step 5: 实现提交检查和恢复**

提交前必须：当前状态 OPEN、最新校验绑定当前修订且 error=0、重读所有受影响文件哈希。任何冲突将事务标记 STALE 且写入数为 0。替换过程中每一步更新 journal；成功后回读最终 SHA，才标记 COMMITTED。

- [x] **Step 6: 运行绿灯**

```powershell
npm run test -w @surdet/authoring -- test/change-session.test.ts test/operations.test.ts test/commit-recovery.test.ts
npm run typecheck -w @surdet/authoring
npm run build -w @surdet/authoring
```

- [x] **Step 7: 更新 Execution Ledger 并提交**

Commit message:

```text
feat(authoring): add isolated change transactions
```

---

### Task 4: 共享校验、模拟、三层差异与 Core 因果轨迹

**Files:**
- Create: `packages/authoring/src/validation.ts`
- Create: `packages/authoring/src/simulation.ts`
- Create: `packages/authoring/src/evidence.ts`
- Create: `packages/authoring/src/diff.ts`
- Create: `packages/authoring/src/runtime-trace.ts`
- Create: `packages/authoring/test/validation.test.ts`
- Create: `packages/authoring/test/simulation.test.ts`
- Create: `packages/authoring/test/diff.test.ts`
- Create: `packages/authoring/test/runtime-trace.test.ts`
- Create: `packages/core/test/interpreter-trace.test.ts`
- Modify: `packages/core/src/runtime/interpreter.ts`
- Modify: `packages/cli/src/lint.ts`
- Modify: `packages/cli/src/simulate.ts`
- Modify: `packages/editor/src/validate.ts`
- Modify: `packages/authoring/src/index.ts`
- Modify: current plan ledger

**Interfaces:**
- Consumes: Core 编译/解释器/scene-lint、ProjectSnapshot、ObjectIndex、ChangeRecord。
- Produces: `validateSnapshot`、`simulateSnapshot`、`runExplicitPath`、`createChangeDiff`、`queryTrace`、Core `runtimeTrace` event。

- [x] **Step 1: 写共享校验与模拟红灯**

红灯 fixture 必须包含不存在标签：

```ts
expect(result.issues).toContainEqual(expect.objectContaining({
  severity: 'error',
  code: 'J002',
  objectRef: expect.stringContaining('choice-option'),
  action: expect.stringContaining('创建或修正标签'),
}));
```

模拟绿灯 fixture 必须断言：

```ts
expect(report.status).toBe('passed');
expect(report.choiceBranches).toEqual({ total: 2, visited: 2 });
expect(report.paths.map((path) => path.finalVariables.trust).sort()).toEqual([-1, 1]);
```

预算耗尽必须为 `incomplete`，不能 `passed`。

这里的 `J002` 是现有 Core 场景校验 issue code，不是能力信封的错误 code；能力调用本身成功，但 `result.issues` 含语义错误。不得另造第二套“标签不存在”校验编号。

- [x] **Step 2: 写 Core 因果事件红灯**

`interpreter-trace.test.ts` 必须断言选择、变量差异、条件和跳转源位置：

```ts
expect(events).toContainEqual(expect.objectContaining({
  kind: 'state',
  source: expect.objectContaining({ sceneId: 'prologue', op: 'set' }),
  stateDelta: [{ variable: 'trust', before: 0, after: 1 }],
}));
expect(events).toContainEqual(expect.objectContaining({
  kind: 'control-flow',
  controlFlow: expect.objectContaining({ to: 'label:prologue.trust' }),
}));
```

- [x] **Step 3: 运行红灯**

```powershell
npm run test -w @surdet/core -- test/interpreter-trace.test.ts
npm run test -w @surdet/authoring -- test/validation.test.ts test/simulation.test.ts test/diff.test.ts test/runtime-trace.test.ts
```

- [x] **Step 4: 在 Core 增加只读 trace 事件**

扩展 `CoreEventMap`：

```ts
export interface RuntimeTraceEventPayload {
  kind: 'instruction' | 'choice' | 'state' | 'condition' | 'control-flow' | 'scene-end';
  source: { sceneId: string; index: number; op: string; file: string; line: number; col: number };
  stateDelta?: { variable: string; before: VarValue | undefined; after: VarValue | undefined }[];
  condition?: { expression: string; result: boolean };
  controlFlow?: { from: string; to: string };
  choice?: { optionIndex: number; label: string };
}

export interface CoreEventMap extends EventMap {
  runtimeTrace: RuntimeTraceEventPayload;
  // 保留所有既有事件
}
```

trace 必须观察既有语义，不改变 pc、状态或事件顺序；同一输入下顺序稳定。

- [x] **Step 5: 实现共享校验并迁移旧入口**

`validateSnapshot` 复用 Core 检查并补充 `objectRef`/`action`；CLI `lintProject` 与 editor `validateProject` 改为薄适配。对仍只存在 Node 的 Gallery/配置文件扫描，通过 snapshot 数据输入共享纯函数，CLI 不保留第二套结果真相。

- [x] **Step 6: 实现模拟、显式路径运行和证据信封**

```ts
export interface EvidenceEnvelope<T> {
  schemaVersion: 1;
  evidenceId: string;
  capability: string;
  status: 'passed' | 'failed' | 'incomplete' | 'timed_out';
  engineIdentity: { version: string; gitHead: string };
  projectRevision: string;
  changeId?: string;
  workingRevision?: number;
  createdAt: string;
  result: T;
  artifact?: { path: string; bytes: number; sha256: string };
}
```

`runExplicitPath` 接受场景/标签、初始变量、显式选择序列和可选 seed；不得自行猜选项。

- [x] **Step 7: 实现三层差异与影响分层**

返回：

```ts
export interface ChangeDiff {
  summary: { createdScenes: number; modifiedScenes: number; changedVariables: number; warnings: string[] };
  semantic: { kind: string; objectBefore?: string; objectAfter?: string; operationId: string; directChange: unknown; potentialImpact: unknown[]; observedImpact: unknown[] }[];
  files: { path: string; beforeSha256?: string; afterSha256?: string; unifiedDiff: string; unexpectedFormatChange: boolean }[];
}
```

只改一条台词却改动无关行终止符时，测试必须得到 `unexpectedFormatChange=true` 并阻断提交。

- [x] **Step 8: 运行绿灯和旧入口回归**

```powershell
npm run test -w @surdet/core -- test/interpreter.test.ts test/interpreter-trace.test.ts
npm run test -w @surdet/authoring
npm run test -w @surdet/cli -- test/lint.test.ts test/simulate.test.ts
npm run test -w surdet-editor -- test/validate.test.ts
npm run typecheck -w @surdet/core
npm run typecheck -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run typecheck -w surdet-editor
```

- [x] **Step 9: 更新 Execution Ledger 并提交**

Commit message:

```text
feat(authoring): add validation simulation and evidence
```

---

### Task 5: 结构化 CLI/JSON 与跨进程事务目录

**Files:**
- Create: `packages/cli/src/authoring/node-project-storage.ts`
- Create: `packages/cli/src/authoring/node-change-store.ts`
- Create: `packages/cli/src/authoring/authoring-service.ts`
- Create: `packages/cli/src/authoring-command.ts`
- Create: `packages/cli/test/authoring-contract.test.ts`
- Create: `packages/cli/test/authoring-vertical-slice.test.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/package.json`
- Modify: `package-lock.json`
- Modify: current plan ledger

**Interfaces:**
- Consumes: 全部 14 项 authoring 公共能力。
- Produces: 稳定 CLI 命令、单 JSON stdout、Node 存储和本机事务证据目录。

- [x] **Step 1: 写 CLI 合同红灯**

测试通过 spawn 构建后的 CLI，不直接 import 内部 service；至少断言：

```ts
const result = runCli(['capabilities', 'describe', '--json']);
expect(result.status).toBe(0);
expect(() => JSON.parse(result.stdout)).not.toThrow();
expect(result.stdout.trim().startsWith('{')).toBe(true);
expect(result.stdout.trim().endsWith('}')).toBe(true);
expect(result.stderr).toBe('');
expect(JSON.parse(result.stdout).result.capabilities).toHaveLength(14);
```

错误路径必须 stdout 为错误信封，stderr 只在 `--debug` 出现内部堆栈。

- [x] **Step 2: 运行红灯**

```powershell
npm run build -w @surdet/core
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
npm run test -w @surdet/cli -- test/authoring-contract.test.ts
```

Expected: FAIL；authoring 命令尚未注册。

- [x] **Step 3: 实现安全 NodeProjectStorage**

要求：

```ts
export class NodeProjectStorage implements ProjectWriteStorage {
  constructor(readonly rootIdentity: string, private readonly rootRealPath: string) {}
  static async open(projectRoot: string): Promise<NodeProjectStorage>;
  listFiles(): Promise<string[]>;
  readText(relativePath: string): Promise<ProjectFile>;
  exists(relativePath: string): Promise<boolean>;
  stageText(relativePath: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }>;
  replaceFromStage(relativePath: string, stagedIdentity: string): Promise<void>;
  restoreText(relativePath: string, originalText: string): Promise<void>;
  removeStage(stagedIdentity: string): Promise<void>;
}
```

所有路径使用 `realpath`、`path.resolve` 和 `path.relative` 验证仍在根目录；拒绝 `..`、绝对路径、junction/symlink 逃逸并返回 `PATH_OUTSIDE_PROJECT`。`stageText` 只在 commit 临界区于目标同目录创建 `.surdet-<changeId>-<nonce>.tmp`；提交成功或完整恢复成功后清理本次临时文件。恢复失败时立即停止写入，在项目外保留 journal、文件身份和失败 evidence，并在错误结果中列出尚存临时文件供人工处理，不得静默清理或继续尝试。

- [x] **Step 4: 实现 NodeChangeStore**

默认根目录：

```text
%LOCALAPPDATA%\Surdet\agent-changes\<project-identity>\<changeId>
```

仅测试允许通过 `SURDET_AGENT_DATA_DIR` 指向仓库外临时目录。每次 evidence 使用独立文件名，禁止固定 `latest.json` 覆盖失败证据。

- [x] **Step 5: 注册 14 项命令**

先在 `@surdet/authoring` 定义并由 CLI 原样序列化统一信封：

```ts
export interface CapabilitySuccess<T> {
  schemaVersion: 1;
  capability: string;
  ok: true;
  operationId?: string;
  projectRevision: string;
  changeId?: string;
  workingRevision?: number;
  result: T;
}

export interface CapabilityFailure {
  schemaVersion: 1;
  capability: string;
  ok: false;
  operationId?: string;
  projectRevision?: string;
  changeId?: string;
  workingRevision?: number;
  error: {
    code: 'CAPABILITY_UNAVAILABLE' | 'INVALID_REQUEST' | 'UNSUPPORTED_OBJECT_KIND' | 'UNSUPPORTED_OPERATION' |
      'PROJECT_NOT_FOUND' | 'PROJECT_INVALID' | 'PATH_OUTSIDE_PROJECT' | 'OBJECT_NOT_FOUND' |
      'OBJECT_AMBIGUOUS' | 'OBJECT_REF_STALE' | 'OBJECT_PRECONDITION_FAILED' | 'CHANGE_NOT_FOUND' |
      'CHANGE_NOT_OPEN' | 'OPERATION_ID_CONFLICT' | 'PROJECT_CHANGED_SINCE_BEGIN' |
      'VALIDATION_REQUIRED' | 'VALIDATION_STALE' | 'VALIDATION_FAILED' | 'SIMULATION_INCOMPLETE' |
      'RUNTIME_FAILED' | 'RUNTIME_TIMED_OUT' | 'COMMIT_FAILED_RECOVERED' | 'COMMIT_RECOVERY_FAILED';
    category: 'request' | 'not-found' | 'conflict' | 'validation' | 'runtime' | 'commit';
    message: string;
    retriable: boolean;
    action: string;
    objectRef?: string;
  };
}
```

成功 exit `0`；合同/校验/冲突失败使用稳定非零 exit code，但 stdout 仍只输出一个 `CapabilityFailure` JSON。未使用 `--json` 时保留现有 CLI 的人类文本外观。

命令外观固定为：

```text
surdet capabilities describe --json
surdet project inspect --project <root> --json
surdet object inspect --project <root> --ref <ref> --json
surdet change begin --project <root> --json
surdet scene create --change <id> --input <json-file> --json
surdet scene patch --change <id> --input <json-file> --json
surdet variable ensure --change <id> --input <json-file> --json
surdet project validate --change <id> --json
surdet project simulate --change <id> --json
surdet runtime run-from --change <id> --input <json-file> --json
surdet runtime read-trace --change <id> --trace <id> --query <json-file> --json
surdet change diff --change <id> --json
surdet change commit --change <id> --json
surdet change rollback --change <id> --json
```

写请求只接受 JSON 文件或 stdin，禁止把复杂剧情内容塞进 shell 参数。`capabilities.describe` 的能力列表和错误代码从真实注册表生成。

- [x] **Step 6: 建立红灯到绿灯 CLI 集成测试**

测试必须：开始事务 → 创建带坏标签的短章 → validate 返回 error/objectRef/action → 使用 `scene.patch` 修正 → validate 绿灯 → simulate `2/2` → diff → commit。提交前 fixture 文件 SHA 不变；提交后只预期文件变化。

- [x] **Step 7: 运行绿灯**

```powershell
npm run test -w @surdet/cli -- test/authoring-contract.test.ts test/authoring-vertical-slice.test.ts
npm run typecheck -w @surdet/cli
npm run build -w @surdet/cli
```

- [x] **Step 8: 更新 Execution Ledger 并提交**

Commit message:

```text
feat(cli): expose agent authoring capabilities
```

---

### Task 6: 正式 preview/Renderer 的 Presentation 应用证据

**Files:**
- Modify: `packages/editor/src/preview.ts`
- Modify: `packages/editor/src/panels/preview-panel.ts`
- Create: `packages/editor/test/preview-causal-trace.test.ts`
- Modify: `packages/editor/package.json`
- Modify: `package-lock.json`
- Modify: current plan ledger

**Interfaces:**
- Consumes: Core `runtimeTrace`、authoring `RuntimeTraceEvent`/`EvidenceEnvelope`、Renderer `queries.presentation.snapshot()`。
- Produces: `surdet-preview-trace-start`、`surdet-preview-trace-event`、`surdet-preview-trace-complete` 父窗口消息。

- [x] **Step 1: 写消息合同红灯**

```ts
expect(previewSource).toContain("type: 'surdet-preview-trace-event'");
expect(previewSource).toContain('coreEmitted: true');
expect(previewSource).toContain('presentationApplied');
expect(previewSource).toContain('queries.presentation.snapshot()');
```

纯归一化测试还要证明旧 generation 的事件被父窗口丢弃。

- [x] **Step 2: 运行红灯**

```powershell
npm run test -w surdet-editor -- test/preview-causal-trace.test.ts
```

- [x] **Step 3: 实现 preview 轨迹适配器**

每次 load 创建新 `traceId`；Core trace 事件到达时记录源对象/位置、state/control-flow，并在 Renderer 处理同一同步事件后读取 presentation snapshot。演出项必须分别记录：

```ts
{
  coreEmitted: true,
  presentationApplied: boolean,
  presentationBefore: unknown,
  presentationAfter: unknown
}
```

不得把 `presentationApplied` 自动转换成人工可见通过。编译/运行错误发送 complete status `failed`，保留最后事件与第一错误。

- [x] **Step 4: 父窗口保存当前 trace**

`preview-panel.ts` 只接收当前 iframe source 和当前 generation 的事件；切换/重载时新 trace 不覆盖旧失败 trace 的 artifact，由聚合 harness 负责持久化。UI 只保存当前预览 trace 供 Task 7 展示。

- [x] **Step 5: 运行绿灯**

```powershell
npm run test -w surdet-editor -- test/preview-causal-trace.test.ts test/preview-runtime-contract.test.ts test/preview-runtime-lifecycle.test.ts
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

- [x] **Step 6: 更新 Execution Ledger 并提交**

Commit message:

```text
feat(authoring): trace formal runtime causality
```

---

### Task 7: 编辑器最小双向因果桥

**Files:**
- Create: `packages/editor/src/causal-selection.ts`
- Create: `packages/editor/src/authoring-project-storage.ts`
- Create: `packages/editor/test/causal-selection.test.ts`
- Create: `packages/editor/test/authoring-project-storage.test.ts`
- Modify: `packages/editor/src/state.ts`
- Modify: `packages/editor/src/panels/editor.ts`
- Modify: `packages/editor/src/panels/right.ts`
- Modify: `packages/editor/src/panels/preview-panel.ts`
- Modify: `packages/editor/src/main.ts`
- Modify: `packages/editor/src/styles.css`
- Modify: current plan ledger

**Interfaces:**
- Consumes: authoring `ProjectStorage` / ObjectIndex、当前 editor 内存项目、当前 preview trace。
- Produces: `selectAuthoringObject(ref)`、`filterTraceByObject(ref, trace)`、`locateObjectForTraceEvent(event)`、紧凑因果区与双向跳转。

- [x] **Step 1: 写双向选择红灯**

```ts
it('filters trace by selected object and locates source from a trace event', () => {
  const selected = 'scene:prologue/text:2@abcd';
  const trace = [
    { step: 1, sourceRef: selected, kind: 'text' },
    { step: 2, sourceRef: 'scene:prologue/choice:1@efgh', kind: 'choice' },
  ];
  expect(filterTraceByObject(selected, trace)).toEqual([trace[0]]);
  expect(locateObjectForTraceEvent(trace[1])).toBe('scene:prologue/choice:1@efgh');
});
```

- [x] **Step 2: 运行红灯**

```powershell
npm run test -w surdet-editor -- test/causal-selection.test.ts
```

- [x] **Step 3: 接入共享对象索引**

实现 `createEditorProjectStorage(state)`：把当前内存中的 `game.config.json`、`content/scenario/<scene.file>`、`content/timelines/<timeline.file>` 和已载入配置文件映射为只读 `ProjectStorage`，SHA 使用 Web Crypto；必须读取包含尚未保存编辑的内存文本，不能为了建索引重新从磁盘覆盖 dirty 内容。项目打开、场景文本改变和校验完成后，以防抖单飞方式重建当前 authoring snapshot/index；旧异步结果不得覆盖较新的编辑修订。`state` 增加：

```ts
selectedObjectRef: null as string | null,
authoringIndex: null as ObjectIndex | null,
previewTrace: [] as RuntimeTraceEvent[],
selectedTraceStep: null as number | null,
```

不得在 editor 内生成另一种对象 ID。

- [x] **Step 4: 块选择映射对象引用**

每个 `.block` 设置 `data-object-ref`；点击空白/台词/标签/指令/选择项时更新选择态并刷新右栏。轨迹反向定位使用 index 的 source path + line，调用现有 `jumpToScene`，不复制导航逻辑。

- [x] **Step 5: 实现紧凑因果检查区**

右栏新增可折叠“因果”区，只显示：当前对象、直接引用、直接被引用、`potentialImpact`、当前 trace 的 `observedImpact`。无 trace 时明确显示“尚无本次预览观察证据”，不得用静态推断冒充观察。

- [x] **Step 6: 实现轨迹过滤与回跳**

预览面板在现有 diagnostics 下方显示当前 trace 的紧凑事件列表；选中对象时过滤；点击事件切回块编辑并定位对象。页面布局不得新增全屏大图或 AI 对话栏。

- [x] **Step 7: 运行绿灯与 Stage 5 回归**

```powershell
npm run test -w surdet-editor -- test/causal-selection.test.ts test/authoring-project-storage.test.ts test/model-roundtrip.test.ts test/preview-scenes.test.ts test/project-io.test.ts test/validate.test.ts
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

Expected: 全部 exit `0`；Stage 5 编辑—预览—保存—重开所依赖的路径未被移除。

- [x] **Step 8: 更新 Execution Ledger 并提交**

Commit message:

```text
feat(editor): add causal authoring bridge
```

---

### Task 8: 唯一聚合纵向 harness 与桌面人工 fixture

**Files:**
- Create: `packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`
- Modify: `packages/shell/package.json`
- Modify: current plan ledger
- Runtime-only, do not commit: desktop fixture and temporary artifact directory

**Interfaces:**
- Consumes: 构建后的 14 项 CLI、editor preview、Core/Presentation trace。
- Produces: 一个不可覆盖的 Stage 6 Wave 1 artifact、桌面人工 fixture 和聚合 pass/fail 退出码。

- [x] **Step 1: 写 harness 静态红灯测试或自检入口**

harness 必须在启动时验证：原始 Starter 场景/config 哈希、运行 HEAD、目标桌面 fixture 不存在、artifact 目录唯一。不得删除已存在的同名目录；使用时间戳/随机后缀创建新目录。

- [x] **Step 2: 实现公开能力链**

harness 只能 spawn 构建后的 `surdet` CLI，按下列顺序：

```text
capabilities.describe
project.inspect
change.begin
variable.ensure
scene.create（包含故意坏标签）
project.validate（预期红灯）
object.inspect
scene.patch（修正标签）
project.validate（绿灯）
project.simulate（2/2）
runtime.runFrom（路径 A）
runtime.runFrom（路径 B）
runtime.readTrace
change.diff
change.commit
```

不得 import authoring 内部函数绕过 CLI。

- [x] **Step 3: 验证红灯期间与提交前不写盘**

在 begin、故意红灯、修正后绿灯、diff 后分别重新读取 fixture 文件树哈希；都必须等于 begin 前。只有 commit 成功后才允许变化。

- [x] **Step 4: 驱动正式 editor preview/Renderer 两条路径**

构建 editor 后启动仅绑定 `127.0.0.1` 的 Vite preview。Playwright 直接打开正式 `preview.html`，由父测试页通过公开 `postMessage` 加载已提交 fixture 场景；使用真实键盘/鼠标选择两个选项，分别得到 trace A/B。必须验证：

```text
路径 A/B 后续文本不同
trust 结果分别为 1 和 -1
Core runtimeTrace 存在
基础演出至少一项 coreEmitted=true
同一演出 presentationApplied=true
pageErrors/consoleErrors/requestFailures/unhandledRejections/rendererErrors/releaseFailures 全为空
```

- [x] **Step 5: 写唯一 artifact**

artifact 至少包含：

```json
{
  "schemaVersion": 1,
  "status": "PASSED",
  "runHead": "...",
  "projectRevision": "...",
  "changeId": "...",
  "workingRevision": 0,
  "redEvidenceId": "...",
  "greenEvidenceId": "...",
  "traceIds": ["...", "..."],
  "choiceCoverage": { "total": 2, "visited": 2 },
  "stateOutcomes": [-1, 1],
  "originalStarter": { "unchanged": true },
  "errors": [],
  "lastPassedNode": "...",
  "firstFailedNode": null
}
```

写完后从磁盘重新读取路径、bytes 和 SHA-256。失败时 status=`FAILED`，保留 artifact，不重跑、不覆盖。

- [x] **Step 6: 先跑语法检查与受影响构建**

```powershell
node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs
npm run build -w @surdet/core
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
npm run build -w @surdet/renderer
npm run build -w surdet-editor
```

- [x] **Step 7: 聚合 harness 只运行一次**

```powershell
node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs
```

Expected: exit `0` 且 artifact status=`PASSED`。若失败，记录最后通过节点和第一失败节点，停止在 `WAITING_FOR_REVIEW`；不得循环重跑，不得自动修改生产代码猜测修复。

- [x] **Step 8: 准备桌面人工验收入口但不代替项目所有者执行**

复用 harness 创建的桌面 fixture。fixture 只能复制 Starter 的 `game.config.json` 与 `content/**`，不得复制 `node_modules`、`dist`、`src`、`test` 或仓库 Git 元数据；创建前后都要重新核对原始 Starter 哈希。FORMAL runner 的正式 preview 入口固定为 `/preview.html`；该入口只用于正式预览证据，不是完整编辑器人工验收入口。随后启动：

```powershell
npm run preview -w surdet-editor -- --host 127.0.0.1 --port 4173
```

只确认 HTTP 200、页面标题和 fixture 路径可访问；不把服务器可访问写成人工通过。项目所有者执行 16 步人工验收时必须在 Chrome/Edge 打开 editor 根地址 `http://127.0.0.1:4173/`（标题应为 `Surdet 剧本编辑器`）；不得把 `/preview.html` 写成完整编辑器人工验收入口。将两个 URL、PID、fixture 路径和 16 步人工验收清单写入报告与计划强制提醒点。

- [x] **Step 9: 更新 Execution Ledger 并提交 harness**

Commit message:

```text
test(authoring): verify agent-ready vertical slice
```

不得提交 fixture、artifact、日志、`dist` 或本机事务目录。

---

### Task 9: 最终聚焦验证、一次全仓门禁、交付报告与停止

**Files:**
- Create: `docs/AUTHORING-AGENT-READY-VERTICAL-SLICE-STAGE-6-WAVE-1-DELIVERY-REPORT-2026-08-13.md`
- Modify: current plan ledger

**Interfaces:**
- Consumes: Tasks 1–8 的提交、测试、artifact 和桌面 fixture。
- Produces: 可独立复审的最终报告、本地文档收口提交和人工验收强制提醒。

- [x] **Step 1: 运行聚焦工作区测试**

```powershell
npm run test -w @surdet/core
npm run test -w @surdet/authoring
npm run test -w @surdet/cli
npm run test -w surdet-editor
npm run test -w @surdet/renderer
npm run test -w @surdet/shell
```

Expected: 全部 exit `0`。不得再出现 Stage 5 的两个 EOL 红灯。

- [x] **Step 2: 运行 typecheck 与 build**

```powershell
npm run typecheck -w @surdet/core
npm run typecheck -w @surdet/authoring
npm run typecheck -w @surdet/cli
npm run typecheck -w @surdet/renderer
npm run typecheck -w @surdet/host
npm run typecheck -w @surdet/shell
npm run typecheck -w surdet-editor
npm run build -w @surdet/core
npm run build -w @surdet/authoring
npm run build -w @surdet/cli
npm run build -w @surdet/renderer
npm run build -w @surdet/host
npm run build -w @surdet/shell
npm run build -w surdet-editor
```

- [x] **Step 3: 最终只运行一次全仓门禁**

```powershell
npm run verify:all
```

Expected: exit `0`。若失败，只记录一次结果并判断与本轮关系；不得循环运行。不要运行性能资格化、多轮 Electron、pack 或发行。

- [x] **Step 4: 从磁盘重新读取所有关键证据**

必须重新读取：

- artifact path/bytes/SHA-256/status/runHead/projectRevision/changeId/traceIds；
- 桌面 fixture 目标场景与 config bytes/SHA-256；
- 原始 Starter 对应文件 bytes/SHA-256 与 Git blob；
- `git rev-parse HEAD`、`surdet/main`、ahead/behind；
- `git status`、tracked log、diff checks；
- Tasks 1–8 的真实提交与文件范围。

- [x] **Step 5: 写交付报告**

报告必须区分：

```text
已验证事实
合理推断
尚未验证（项目所有者视觉/操作）
失败证据与保留位置
本轮修改范围
实际命令及退出码
提交身份
NOT_PUSHED
STAGE_6_WAVE_2_NOT_STARTED
```

末尾必须有“建议由总经理登记的事实”，不得修改长期路线台账。

- [x] **Step 6: 写人工验收强制提醒点**

明确要求项目所有者使用 Chrome/Edge 与桌面 fixture 完成：

```text
1. 打开本机 editor URL
2. 选择桌面 fixture
3. 确认两个 Agent 场景存在
4. 确认 .gal 无 UUID 噪声
5. 选择台词查看直接因果
6. 选择选项查看变量变化与跳转
7. 运行路径 A
8. 点击轨迹事件反向定位对象
9. 运行路径 B
10. 确认不同后续文本
11. 手工修改一句台词
12. 预览修改
13. 保存全部
14. 刷新编辑器
15. 重开同一 fixture
16. 确认修改仍在且无脏标记
```

- [x] **Step 7: 精确暂存最终文档并提交**

```powershell
git add -- docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md docs/AUTHORING-AGENT-READY-VERTICAL-SLICE-STAGE-6-WAVE-1-DELIVERY-REPORT-2026-08-13.md
git diff --cached --check
git diff --cached --name-status
git commit -m "docs(authoring): report stage 6 wave 1 delivery"
```

- [x] **Step 8: 提交后最终回读并停止**

```powershell
git log -1 --oneline
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git show --name-status --format=fuller HEAD
git diff --check
git diff --cached --check
git ls-files '*.log'
git status --short --branch
```

最终状态必须是：

```text
STAGE_6_WAVE_1_IMPLEMENTED_LOCALLY
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED_AFTER_STAGE_6_WAVE_1
STAGE_6_WAVE_2_NOT_STARTED
```

执行 AI 在此停止。不得自行邀请项目所有者验收；先由总经理独立复审提交、diff、命令、artifact 和 fixture 身份。

---

## Execution Ledger

> 执行 AI 从 Task 0 开始按时间顺序追加。每笔必须包含：时间、HEAD/远端关系、工作树、本 Task 实际修改文件、实际命令与退出码、红灯/绿灯、artifact、提交、当前状态、未解决问题和下一停止点。不得预先填写未运行的结果，不得改写历史失败记录。

### Plan creation — completed by manager AI (2026-08-13)

- 项目所有者已批准正式设计规格并授权编写实施任务书。
- 本计划依据真实仓库文件映射创建；生产实现尚未开始。
- 计划规定执行 AI 不修改长期路线台账，不创建子 AI，不 push，不进入 Wave 2。
- 下一步：项目所有者选择由现有执行 AI 按计划施工，或另行授权当前会话执行；任何执行均从 Task 0 重新核对真实基线开始。

### Task 0 — Steps 1–4 completed; Step 5 pending commit (2026-08-13 20:56 +08:00)

- 已按任务书完整读取六份权威文件，并已读取并遵守本轮可用的 Git、交付物磁盘核验和完成前验证规范。当前唯一主题为 Stage 6 Wave 1 外部 Agent 友好创作纵向切片；不创建子 AI、不并行施工、不修改长期路线台账，不进入 Wave 2，不邀请项目所有者人工验收。
- Task 0 新鲜 Git 基线实际结果：branch=`main`；`HEAD=297fb92bc6ba1257c774dddfba753151508642ca`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；`HEAD...surdet/main=5 0`。tracked 工作树和暂存区均无修改；`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出。
- `git status --short --untracked-files=all` 只列出既有未跟踪文件：`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两份艺术交接文件、`docs/handoff-20260813-165825.md`、`docs/handoff-20260813-170533-general-manager.md` 和长期路线台账；没有未知 tracked 修改或暂存内容，本轮不触碰这些文件。
- 已按任务书运行 `npm run test -w surdet-editor -- test/model-roundtrip.test.ts`，exit `1`。Vitest 实际为 1 个测试文件、6 个测试：4 passed、2 failed；失败仅为 `ch01_01.gal` 和 `ch02.gal` 的混合 CRLF/LF `parse → serialize` 逐字节断言，`ch01_02.gal`、`ch03_turn_event.gal` 及 CRLF 专项通过。红灯证据按原始命令输出保留；未重跑、未放宽、未删除。
- 本 Task 0 截至本记录没有修改任何生产代码、测试、Starter、《零点之后》、Core/Renderer/Host/Shell、编辑器或 CLI 文件；当前实际修改文件仅本计划。当前状态：`TASK_0_BASELINE_RECORDED` / `STAGE_5_EOL_RED_REPRODUCED` / `TASK_0_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：只暂存本计划，核对缓存 diff 后创建 `docs(authoring): record stage 6 wave 1 baseline` 普通本地提交。

### Task 0 — Step 5 completed after commit (2026-08-13 20:57 +08:00)

- 已精确暂存本计划；`git diff --cached --check` exit `0`；`git diff --cached --name-status` 仅为 `M docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md`。已创建任务书规定的普通本地提交：`3152470bfe055806311fce3f00ca1df50e7c4c0f docs(authoring): record stage 6 wave 1 baseline`。
- 提交后立即真实回读：`git log --oneline -1`=`3152470 docs(authoring): record stage 6 wave 1 baseline`；`git rev-parse HEAD`=`3152470bfe055806311fce3f00ca1df50e7c4c0f`。该提交只包含本计划，未 push。
- 本条提交后 Ledger 收口记录本身导致当前 tracked 工作树仅有本计划未提交修改，暂存区为空；既有未跟踪文件集合不变；下一 Task 将在本计划白名单内一并固化这条真实提交记录，不 amend、不改写 Task 0 提交。
- Task 0 最终事实状态：`TASK_0_COMPLETED_LOCALLY` / `STAGE_5_EOL_RED_REPRODUCED` / `NOT_PUSHED`。下一停止点：Task 1 先建立并运行 authoring EOL 红灯，随后只做最小无损实现。

### Task 1 — Steps 1–6 completed; Step 7 pending commit (2026-08-13 20:59–21:05 +08:00)

- 已先写并运行任务书规定的 authoring EOL 红灯：`npm run test -w @surdet/authoring -- test/scene-document.test.ts` 首次 exit `1`，1 个测试文件未收集测试，失败原因是预期的 `../src/scene-document.js` 尚不存在；没有把该红灯改写成通过。
- 已在最小范围实现逐行 EOL 文档：新增 `packages/authoring/package.json`、`tsconfig.json`、`tsconfig.build.json`、`src/contracts.ts`、`src/scene-document.ts`、`src/index.ts` 和 `test/scene-document.test.ts`；editor `src/model.ts` 改为兼容重导出，`src/panels/editor.ts` 为新行及原始行编辑保留 EOL，`packages/editor/package.json` 增加共享依赖，根 `package.json` 调整 Core → authoring → CLI/editor 顺序，`package-lock.json` 记录 workspace link。没有修改 `packages/editor/test/model-roundtrip.test.ts`，其现有断言作为回归红灯直接转绿。
- `npm install --package-lock-only --ignore-scripts` exit `0`；随后首次执行任务书绿灯序列时，authoring 测试已通过但 editor 测试/typecheck/build 因本机 `node_modules` 尚未出现 `@surdet/authoring` workspace link 而失败。该接线失败已保留；执行一次 `npm install --ignore-scripts` exit `0`（新增 1 个 workspace link，npm 输出的 audit warning 未引入本轮代码变更），再按同一绿灯序列重跑，全部 exit `0`。
- 最终绿灯事实：`npm run test -w @surdet/authoring -- test/scene-document.test.ts` 为 1 文件/2 测试通过；`npm run test -w surdet-editor -- test/model.test.ts test/model-roundtrip.test.ts` 为 2 文件/13 测试通过，包含原先 `ch01_01.gal`、`ch02.gal` 两个混合 EOL 断言；`npm run typecheck -w @surdet/authoring`、`npm run typecheck -w surdet-editor` 均 exit `0`；两个 build 均 exit `0`。editor Vite 构建为 855 modules transformed，保留既有 preview 592.90 kB / gzip 175.41 kB 大 chunk warning，未修改性能门限。
- Task 1 没有修改 Core、Renderer、Host、Shell、CLI、Starter、《零点之后》或任何测试文件；原始 Starter 未被写入。当前实际修改文件为上述 authoring 文件、根/ editor 包清单、锁文件、`packages/editor/src/model.ts`、`packages/editor/src/panels/editor.ts` 和本计划。当前状态：`TASK_1_GREEN_LOCALLY` / `STAGE_5_EOL_RED_FIXED_IN_SHARED_AUTHORING_LAYER` / `TASK_1_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：只暂存 Task 1 文件白名单与本计划，核对缓存 diff 后创建 `feat(authoring): add lossless scene documents`。

### Task 1 — Step 7 completed after commit (2026-08-13 21:05 +08:00)

- 已按 Task 1 白名单精确暂存并核对：`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git diff --cached --name-status` 仅包含本计划、根 `package.json`/`package-lock.json`、editor 包清单与模型/面板、以及 `packages/authoring` 的 7 个新文件。已创建普通本地提交：`5e5520eb1a416cc1e54768beee47f19f5537c880 feat(authoring): add lossless scene documents`。
- 提交后立即真实回读：`git log --oneline -1`=`5e5520e feat(authoring): add lossless scene documents`；`git rev-parse HEAD`=`5e5520eb1a416cc1e54768beee47f19f5537c880`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`7 0`。`git diff --check`、`git diff --cached --check` 均 exit `0`；tracked 工作树和暂存区为空；`git ls-files '*.log'` 无输出；既有未跟踪文件保持原样，未 push。
- 本条记录没有改写 Task 1 提交；Task 1 最终状态：`TASK_1_COMPLETED_LOCALLY` / `STAGE_5_EOL_RED_FIXED_IN_SHARED_AUTHORING_LAYER` / `NOT_PUSHED`。下一停止点：Task 2 先建立项目快照、修订和对象索引红灯。

### Task 2 — Steps 1–5 completed; Step 6 pending commit (2026-08-13 21:07–21:11 +08:00)

- 已先写并运行任务书规定的红灯：`npm run test -w @surdet/authoring -- test/project-snapshot.test.ts test/object-index.test.ts` 首次 exit `1`；2 个测试文件均因 `project-snapshot.js`/`object-index.js` 尚未存在而无法收集测试，未把缺失模块误写成业务通过。
- 已实现平台无关 `ProjectStorage`/`ProjectFile`/`TextHasher`、规范项目路径过滤、稳定排序读取、Core `compileScene` 快照、`path + NUL + sha256` 修订计算、配置/变量/时间轴摘要、语义对象与修订期匿名 `objectRef`、引用/被引用关系、`inspectProject` 和 `inspectObject`。authoring 未 import Node `fs`、DOM 或 Git。
- Task 2 受影响文件仅为：新增 `packages/authoring/src/project-storage.ts`、`src/project-snapshot.ts`、`src/object-index.ts`、`test/project-snapshot.test.ts`、`test/object-index.test.ts`；修改 `src/contracts.ts`、`src/index.ts` 和本计划。没有修改 Core、CLI、editor、Renderer、Host、Shell、Starter、《零点之后》或长期路线台账。
- 首次绿灯序列中两个测试已通过（2 个文件/2 个测试），但 typecheck/build 暴露 3 个类型问题：场景文档类型未从 `scene-document.ts` 导出，以及无 `noUncheckedIndexedAccess` 防护的目标索引；已做对应的最小类型导出和空值收敛修正。随后按同一聚焦序列重跑：`npm run test -w @surdet/authoring -- test/project-snapshot.test.ts test/object-index.test.ts` exit `0`；`npm run typecheck -w @surdet/authoring` exit `0`；`npm run build -w @surdet/authoring` exit `0`。
- 当前状态：`TASK_2_GREEN_LOCALLY` / `PROJECT_REVISION_ORDER_STABLE` / `REVISION_SCOPED_OBJECT_REFS_VERIFIED` / `TASK_2_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：只暂存 Task 2 文件白名单与本计划，核对缓存 diff 后创建 `feat(authoring): index project objects`。

### Task 2 — post-commit type-boundary closure (2026-08-13 21:11 +08:00)

- 已创建任务书规定的主提交并立即回读：`git log --oneline -1`=`7885326 feat(authoring): index project objects`；`git rev-parse HEAD`=`78853268148f8a09963dbb576862d9ab20ae75e9`；提交范围为本计划、Task 2 的 authoring 快照/索引/存储文件和两份测试。
- 提交后复核发现 `project-snapshot.ts` 与 `object-index.ts` 仍需要把类型直接收敛到公共 `contracts.ts`，避免依赖 Task 1 文件的类型重导出；已撤回 `scene-document.ts` 的非必要空行/出口改动，重新执行 Task 2 聚焦测试、typecheck、build，均 exit `0`。这两处纯类型导入修正属于 Task 2 白名单，当前待做一个不改写主提交的普通本地闭合提交。
- 主提交后真实关系：`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`8 0`；`git diff --check` 和 `git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出；tracked 工作树当前只剩上述两个 Task 2 类型导入修改，暂存区为空；既有未跟踪受保护文件、handoff 和长期路线台账未触碰。
- 当前状态：`TASK_2_MAIN_COMMIT_RECORDED` / `TASK_2_TYPE_BOUNDARY_VERIFIED` / `TASK_2_CLOSURE_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：只暂存两个 Task 2 类型导入文件与本计划，创建普通本地闭合提交，然后进入 Task 3。

### Task 2 — closure commit completed (2026-08-13 21:12 +08:00)

- 已精确暂存并提交两个 Task 2 类型导入修正与本计划：`d4895fb179948fa684e6575aff1d2bf1b90b2166 fix(authoring): close project snapshot type boundary`。提交后立即回读 `git log --oneline -1`=`d4895fb fix(authoring): close project snapshot type boundary`、`git rev-parse HEAD`=`d4895fb179948fa684e6575aff1d2bf1b90b2166`；`git show --name-status HEAD` 仅为本计划、`src/object-index.ts`、`src/project-snapshot.ts`。
- 提交后真实 Git 状态：`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`9 0`；tracked 工作树和暂存区为空；`git diff --check`、`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出；既有未跟踪文件保持原样，未 push。
- Task 2 最终停止状态：`TASK_2_COMPLETED_LOCALLY` / `PROJECT_REVISION_ORDER_STABLE` / `REVISION_SCOPED_OBJECT_REFS_VERIFIED` / `NOT_PUSHED`。下一停止点：Task 3 先建立原生隔离事务、operationId 幂等和恢复 journal 红灯。

### Task 3 — Steps 1–6 completed; Step 7 pending commit (2026-08-13 21:16–21:21 +08:00)

- 已先运行任务书规定的事务红灯：`npm run test -w @surdet/authoring -- test/change-session.test.ts test/operations.test.ts test/commit-recovery.test.ts` exit `1`；3 个测试文件因 `change-session.js`/`operations.js` 尚不存在而无法收集测试。红灯期间没有真实项目文件写入。
- 已实现 `ChangeRecord`、`ChangeRepository`、`ProjectWriteStorage`、`ChangeSession`、内存仓储、`change.begin`/rollback/commit、operationId 幂等和负载冲突、`scene.create`、`scene.patch` 的类型化 block/精确指纹前置条件、`variable.ensure`、新鲜校验门槛、磁盘基线冲突检查、同目录 staging、逐文件 journal、原子替换和恢复失败停止。新增文件恢复使用可选 `removePath`，旧文件仍只通过 `restoreText` 恢复；没有引入任意路径、任意文本 patch 或第二套对象状态机。
- Task 3 只修改 `packages/authoring/src/change-session.ts`、`src/operations.ts`、`src/contracts.ts`、`src/project-storage.ts`、`src/index.ts`，以及 `test/change-session.test.ts`、`test/operations.test.ts`、`test/commit-recovery.test.ts` 和本计划。测试全部使用内存/故障注入存储；没有修改、暂存或写入真实项目、Starter、《零点之后》或其他工作区。
- 首次绿灯序列中 3 个文件/5 个测试已通过，但 typecheck/build 暴露 3 个本轮类型问题：`SceneDocumentLine` 应从公共合同导入、scene.create 草稿的可选 `sep` 需物化、`ensureVariable` 的布尔结果需显式泛型；均已做最小修正。随后按同一聚焦序列重跑：3 个文件/5 个测试 exit `0`；`npm run typecheck -w @surdet/authoring` exit `0`；`npm run build -w @surdet/authoring` exit `0`。
- 故障注入事实：第二文件替换失败时第一文件恢复且返回 `COMMIT_FAILED_RECOVERED`；恢复再失败时事务变为 `STALE`，journal 保留并返回 `COMMIT_RECOVERY_FAILED`；operationId 相同负载重放不增加工作修订，不同负载返回 `OPERATION_ID_CONFLICT`。
- 当前状态：`TASK_3_GREEN_LOCALLY` / `ISOLATED_WRITE_BEFORE_COMMIT_VERIFIED` / `ATOMIC_RECOVERY_BOUNDARY_VERIFIED` / `TASK_3_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：只暂存 Task 3 文件白名单与本计划，核对缓存 diff 后创建 `feat(authoring): add isolated change transactions`。

### Task 3 — Step 7 completed after commit (2026-08-13 21:20 +08:00)

- 已按 Task 3 白名单精确暂存并通过 `git diff --check`、`git diff --cached --check`；`git diff --cached --name-status` 仅包含本计划、Task 3 的 authoring 合同/存储/事务/操作文件及三份测试。已创建普通本地提交：`132a5b3017988e3d49627537ec600f21bce72aa2 feat(authoring): add isolated change transactions`。
- 提交后立即真实回读：`git log --oneline -1`=`132a5b3 feat(authoring): add isolated change transactions`；`git rev-parse HEAD`=`132a5b3017988e3d49627537ec600f21bce72aa2`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`10 0`。提交后 tracked 工作树和暂存区为空；`git diff --check`、`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出；未 push。
- Task 3 最终状态：`TASK_3_COMPLETED_LOCALLY` / `ISOLATED_WRITE_BEFORE_COMMIT_VERIFIED` / `ATOMIC_RECOVERY_BOUNDARY_VERIFIED` / `NOT_PUSHED`。下一停止点：Task 4 先建立共享校验、双分支模拟、三层差异和 Core runtime trace 红灯。

### Task 4 — Steps 1–8 completed; Step 9 pending commit (2026-08-13 21:25–21:39 +08:00)

- 已先写并运行任务书规定的两个红灯：`npm run test -w @surdet/core -- test/interpreter-trace.test.ts` 首次 exit `1`，新 trace 测试收到空事件数组；`npm run test -w @surdet/authoring -- test/validation.test.ts test/simulation.test.ts test/diff.test.ts test/runtime-trace.test.ts` 首次 exit `1`，4 个测试套件因 `validation.js`、`simulation.js`、`diff.js`、`runtime-trace.js` 尚不存在而无法收集。红灯输出已保留，未重跑挑绿。
- 已在 Core 解释器公共事件面增加只读 `runtimeTrace`：包含 instruction、choice、state、condition、control-flow、scene-end 及源文件位置；状态差异从指令执行前后快照计算，跳转目标、条件结果和选择索引只观察既有语义，不写入状态、不改变 pc、不改变既有事件顺序。新增 `packages/core/test/interpreter-trace.test.ts` 覆盖 `@set` 状态因果、选择和 `@goto` 标签目标。
- 已新增共享 authoring 模块：`src/validation.ts`（复用 Core scene-lint 并补 objectRef/action）、`src/simulation.ts`（全分支预算、循环剪枝、save/load 往返和显式选择路径）、`src/evidence.ts`（EvidenceEnvelope）、`src/diff.ts`（semantic/file/format 三层差异）和 `src/runtime-trace.ts`（轨迹归一化与查询），并从 `src/index.ts` 唯一导出。新测试为 4 个文件、6 个测试。
- CLI `lintProject` 已改为把成功编译场景转换为 ProjectSnapshot，调用 authoring 共享校验；Node 专属的配置扩展、growth、Gallery、W006/W007 仍留在适配层。CLI `simulateProject` 已改为只负责本机目录读取与历史报告映射，实际分支运行统一走 authoring/Core。editor `validateProject` 已改为共享校验适配并保留编辑器专属重复 ID、未使用标签和可达性提示。没有增加第二套解释器、模拟器或标签错误编号。
- 已执行 Task 4 红灯后的聚焦绿灯与旧入口回归：`npm run test -w @surdet/core -- test/interpreter.test.ts test/interpreter-trace.test.ts` exit `0`，2 个文件/45 个测试通过；`npm run test -w @surdet/authoring` exit `0`，10 个文件/15 个测试通过；`npm run test -w @surdet/cli -- test/lint.test.ts test/simulate.test.ts` exit `0`，2 个文件/61 个测试通过；`npm run test -w surdet-editor -- test/validate.test.ts` exit `0`，1 个文件/7 个测试通过。
- `npm run typecheck -w @surdet/core`、`@surdet/authoring`、`@surdet/cli`、`surdet-editor` 均 exit `0`；`npm run build -w @surdet/core`、`@surdet/authoring`、`@surdet/cli`、`surdet-editor` 均 exit `0`。editor build 保留既有 preview chunk 约 592.90 kB 的 warning，未修改性能门限。
- 本 Task 实际修改文件为：本计划；`packages/core/src/runtime/interpreter.ts`、`packages/core/test/interpreter-trace.test.ts`；`packages/authoring/src/index.ts`、`src/validation.ts`、`src/simulation.ts`、`src/evidence.ts`、`src/diff.ts`、`src/runtime-trace.ts` 及 4 份对应测试；`packages/cli/src/lint.ts`、`packages/cli/src/simulate.ts`；`packages/editor/src/validate.ts`。没有修改 Core 其他生产模块、Renderer、Host、Shell、Zero、Starter、长期路线台账或受保护文件；没有 artifact、日志、Electron 路径或人工验收。
- Task 4 提交前新鲜 Git 事实：branch=`main`；`HEAD=132a5b3017988e3d49627537ec600f21bce72aa2`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`10 0`；tracked 工作树为本计划及上列 Task 4 文件，暂存区为空；`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出。既有未跟踪 `AGENTS.md`、受保护文件、handoff 和长期路线台账集合未触碰。
- 当前状态：`TASK_4_GREEN_LOCALLY` / `RUNTIME_TRACE_READ_ONLY_VERIFIED` / `SHARED_VALIDATION_SIMULATION_AND_DIFF_VERIFIED` / `TASK_4_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：只暂存本 Task 白名单与本计划，核对缓存 diff 后创建 `feat(authoring): add validation simulation and evidence` 普通本地提交；提交后立即回读真实 HEAD，再进入 Task 5。

### Task 4 — Step 9 completed after commit (2026-08-13 21:40 +08:00)

- 已按 Task 4 白名单精确暂存并通过 `git diff --cached --check`；`git diff --cached --name-status` 仅包含本计划、Task 4 authoring 模块/测试、Core trace、CLI lint/simulate 和 editor validate。已创建普通本地提交：`e1e3129c50a3db4a1cab2280e091b5529b81a4f7 feat(authoring): add validation simulation and evidence`。
- 提交后立即真实回读：`git log --oneline -1`=`e1e3129 feat(authoring): add validation simulation and evidence`；`git rev-parse HEAD`=`e1e3129c50a3db4a1cab2280e091b5529b81a4f7`；`git show --name-status HEAD` 与上述 Task 4 白名单一致；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`11 0`。
- 提交后 tracked 工作树和暂存区为空；`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出；既有未跟踪受保护文件、handoff 和长期路线台账仍未触碰；未 push。
- Task 4 最终状态：`TASK_4_COMPLETED_LOCALLY` / `RUNTIME_TRACE_READ_ONLY_VERIFIED` / `SHARED_VALIDATION_SIMULATION_AND_DIFF_VERIFIED` / `NOT_PUSHED`。本条台账记录尚未提交，将在 Task 5 只携带当前任务书进入下一次精确提交，不 amend、不改写 Task 4 提交。下一停止点：Task 5 先建立结构化 CLI/JSON 与跨进程事务目录红灯。

### Task 5 — Steps 1–8 completed; commit pending (2026-08-13 21:50–21:56 +08:00)

- 已先建立并实际运行 CLI 合同红灯：`npm run build -w @surdet/core` exit `0`、`npm run build -w @surdet/authoring` exit `0`、`npm run build -w @surdet/cli` exit `0`，随后 `npm run test -w @surdet/cli -- test/authoring-contract.test.ts` 首次 exit `1`。红灯实际为 1 个测试文件/2 个测试失败：`capabilities describe` 得到非零状态且错误信封为空，缺失原因是 authoring 命令尚未注册；错误输出未被改写成通过。
- 已在 Task 5 白名单内完成最小实现：`packages/cli/src/authoring/node-project-storage.ts` 通过 realpath/path.resolve/path.relative 校验项目边界、拒绝 symlink/junction 逃逸、同目录随机暂存和安全替换；`packages/cli/src/authoring/node-change-store.ts` 将 transaction、working-files、独立 evidence、journal、diff 和 trace 保存在项目外事务目录；`packages/cli/src/authoring/authoring-service.ts` 以既有 authoring/Core 能力串接全部 14 项能力；`packages/cli/src/authoring-command.ts` 输出单一 JSON 信封、稳定错误代码和默认无 stderr 的调试边界；`packages/cli/src/index.ts` 注册固定命令前缀；CLI 包清单及 `package-lock.json` 增加 `@surdet/authoring` workspace 依赖。没有修改 `packages/authoring` 公共实现、Core、Renderer、Host、Shell、editor、Zero 或长期路线台账。
- `npm install --package-lock-only --ignore-scripts` exit `0`；npm 报告的 audit warning 未触发本轮代码变更。红灯后的合同绿灯 `npm run build -w @surdet/cli` exit `0`、`npm run test -w @surdet/cli -- test/authoring-contract.test.ts` exit `0`，为 1 个文件/2 个测试通过；错误路径 stdout 为 `PROJECT_NOT_FOUND` 失败信封且默认 stderr 为空。
- Task 5 垂直切片实际通过 `npm run test -w @surdet/cli -- test/authoring-contract.test.ts test/authoring-vertical-slice.test.ts`：2 个文件/3 个测试通过。spawn 的正式 CLI 实际完成 begin → variable.ensure → scene.create（坏跳转）→ validate 返回 J002/objectRef/action → scene.patch → validate 绿灯 → simulate `choiceBranches={total:2,visited:2}` → diff → commit；提交前临时项目文件保持原 SHA 且未产生 agent.gal，提交后仅预期 config 与新场景变化，原 prologue 不变。测试项目和 `SURDET_AGENT_DATA_DIR` 均为仓库外临时目录，没有写入真实项目。
- 按 Task 5 Step 7 实际运行：`npm run typecheck -w @surdet/cli` exit `0`；`npm run build -w @surdet/cli` exit `0`。当前无 Electron artifact、人工验收或发行产物；本轮不运行聚合正式路径，下一 Task 仍按任务书另行建立自己的红灯。
- 提交前新鲜 Git 事实：branch=`main`；`HEAD=e1e3129c50a3db4a1cab2280e091b5529b81a4f7`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`11 0`；`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出。tracked 未提交文件仅为本计划、Task 5 白名单中的 `package-lock.json`、CLI 包清单、CLI index 和四个新 authoring/测试文件；暂存区为空；既有未跟踪受保护文件、handoff 和长期路线台账未触碰。
- Task 5 当前状态：`TASK_5_GREEN_LOCALLY` / `CLI_JSON_CONTRACT_VERIFIED` / `CROSS_PROCESS_CHANGE_AND_COMMIT_VERIFIED` / `TASK_5_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：只暂存本 Task 白名单与本计划，核对缓存范围和 `git diff --cached --check` 后创建 `feat(cli): expose agent authoring capabilities` 普通本地提交；提交后立即回读真实 HEAD，再追加提交后事实并进入 Task 6。

### Task 5 — Step 8 completed after commit (2026-08-13 21:57 +08:00)

- 已按 Task 5 白名单精确暂存并通过 `git diff --check`、`git diff --cached --check`；`git diff --cached --name-status` 仅包含本计划、`package-lock.json`、`packages/cli/package.json`、`packages/cli/src/index.ts`、四个 CLI authoring 源文件和两份 CLI 合同/垂直切片测试。已创建任务书规定的普通本地提交：`06e15b5c0db35fe8dbedd225180bb234a3fd2fe4 feat(cli): expose agent authoring capabilities`。
- 提交后立即真实回读：`git log --oneline -1`=`06e15b5 feat(cli): expose agent authoring capabilities`；`git rev-parse HEAD`=`06e15b5c0db35fe8dbedd225180bb234a3fd2fe4`；`git show --name-status HEAD` 仅显示上述 10 个 Task 5 文件；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`12 0`。
- 提交后真实工作树：tracked 工作树和暂存区均为空；`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出。既有未跟踪的 `AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两份艺术交接文件、两份 handoff 和长期路线台账仍未触碰、未暂存、未提交；未 push。
- Task 5 最终状态：`TASK_5_COMPLETED_LOCALLY` / `CLI_JSON_CONTRACT_VERIFIED` / `CROSS_PROCESS_CHANGE_AND_COMMIT_VERIFIED` / `NOT_PUSHED`。本条记录将在下一 Task 的精确提交中固化，不 amend、不改写 Task 5 提交。下一停止点：Task 6 先按任务书建立 preview causal-trace 消息合同红灯，不邀请项目所有者人工验收。

### Task 6 — Steps 1–6 completed; commit pending (2026-08-13 21:59–22:03 +08:00)

- 已先建立并实际运行消息合同红灯：`npm run test -w surdet-editor -- test/preview-causal-trace.test.ts` 首次 exit `1`；1 个测试文件/2 个测试均失败，原因分别是 `preview.ts` 尚未声明 `surdet-preview-trace-start/event/complete` 合同，以及父窗口归一化/旧 generation 丢弃函数尚不存在。红灯保持原始失败事实，未把 source assertion 或运行时导入错误改写成通过。
- 已在 Task 6 白名单内实现 preview 轨迹适配：每次 load 生成新的 `traceId` 和 generation，Core `runtimeTrace` 记录 source/位置及事件；通过 microtask 在 Renderer 同步处理后读取 `queries.presentation.snapshot()`，逐事件发送 `coreEmitted: true`、`presentationApplied`、`presentationBefore`、`presentationAfter`；编译/运行错误保留第一错误和最后事件并发送 failed complete；自然 `sceneEnd` 才发送 passed complete，避免首次 load 后提前宣称运行完成。没有修改 Core、Renderer、Host、Shell、authoring 公共实现、Zero、长期路线台账或受保护文件。
- `preview-panel.ts` 新增三类消息的结构化归一化、当前 generation/source 过滤、当前预览 trace 保存和 Task 7 读取入口；旧 generation 迟到事件直接丢弃，不覆盖当前 trace，也没有把 `presentationApplied` 转换成人工可见通过。新增 `packages/editor/test/preview-causal-trace.test.ts` 覆盖消息合同和旧 generation 丢弃。
- 按 Task 6 Step 5 实际运行：`npm run test -w surdet-editor -- test/preview-causal-trace.test.ts test/preview-runtime-contract.test.ts test/preview-runtime-lifecycle.test.ts` exit `0`，3 个文件/4 个测试通过；`npm run typecheck -w surdet-editor` exit `0`；`npm run build -w surdet-editor` exit `0`，865 modules transformed，preview chunk 约 `594.54 kB` 的既有大 chunk warning 保留，未修改性能门限。没有运行 Electron、聚合正式路径或人工验收。
- Task 6 本轮实际修改文件为：本计划、`packages/editor/src/preview.ts`、`packages/editor/src/panels/preview-panel.ts`、`packages/editor/test/preview-causal-trace.test.ts`；`packages/editor/package.json` 与 `package-lock.json` 本轮不需要变更，现有 `@surdet/authoring` 依赖已满足类型导入。
- Task 6 提交前新鲜 Git 事实：branch=`main`；`HEAD=06e15b5c0db35fe8dbedd225180bb234a3fd2fe4`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`12 0`；`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出。tracked 未提交文件仅为本计划、两份 preview 源文件和 Task 6 测试；暂存区为空；既有未跟踪受保护文件、handoff 和长期路线台账未触碰。
- Task 6 当前状态：`TASK_6_GREEN_LOCALLY` / `PREVIEW_CORE_PRESENTATION_TRACE_VERIFIED` / `STALE_GENERATION_REJECTION_VERIFIED` / `TASK_6_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：只暂存 Task 6 白名单与本计划，核对缓存范围和 `git diff --cached --check` 后创建 `feat(authoring): trace formal runtime causality` 普通本地提交；提交后立即回读真实 HEAD，再追加提交后事实并进入 Task 7。

### Task 6 — Step 6 completed after commit (2026-08-13 22:04 +08:00)

- 已按 Task 6 白名单精确暂存并通过 `git diff --check`、`git diff --cached --check`；`git diff --cached --name-status` 仅包含本计划、`packages/editor/src/preview.ts`、`packages/editor/src/panels/preview-panel.ts` 和 `packages/editor/test/preview-causal-trace.test.ts`。已创建任务书规定的普通本地提交：`70daa389bd0e125a2d53c7ef6cdd9d8e4bb50044 feat(authoring): trace formal runtime causality`。
- 提交后立即真实回读：`git log --oneline -1`=`70daa38 feat(authoring): trace formal runtime causality`；`git rev-parse HEAD`=`70daa389bd0e125a2d53c7ef6cdd9d8e4bb50044`；`git show --name-status HEAD` 仅显示上述 4 个文件；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`13 0`。
- 提交后真实工作树：tracked 工作树和暂存区均为空；`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出。既有未跟踪的 `AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两份艺术交接文件、两份 handoff 和长期路线台账仍未触碰、未暂存、未提交；未 push。
- Task 6 最终状态：`TASK_6_COMPLETED_LOCALLY` / `PREVIEW_CORE_PRESENTATION_TRACE_VERIFIED` / `STALE_GENERATION_REJECTION_VERIFIED` / `NOT_PUSHED`。本条记录将在下一 Task 的精确提交中固化，不 amend、不改写 Task 6 提交。下一停止点：Task 7 先建立编辑器最小双向因果桥红灯，不邀请项目所有者人工验收。

### Task 7 — Steps 1–8 completed; commit pending (2026-08-13 22:05–22:12 +08:00)

- 已先建立并实际运行双向选择红灯：`npm run test -w surdet-editor -- test/causal-selection.test.ts` 首次 exit `1`，测试套件因 `../src/causal-selection.js` 尚不存在而无法收集；没有把缺失模块误写成业务通过。
- 已实现 `packages/editor/src/causal-selection.ts` 的 `selectAuthoringObject`、按共享 objectRef 过滤 trace、按 source/path/line 反查对象；新增 `packages/editor/src/authoring-project-storage.ts`，以 Web Crypto SHA-256 将当前 state 内存（包括 dirty 场景、game.config、timeline 和已载入配置）映射为只读 ProjectStorage，并由共享 `loadProjectSnapshot`/`buildObjectIndex` 建索引。没有从磁盘覆盖 dirty 文本，没有在 editor 生成第二种对象 ID。
- `state.ts` 增加任务书规定的 selectedObjectRef、authoringIndex、previewTrace、selectedTraceStep；`main.ts` 接入防抖单飞索引重建和 revision 丢弃旧结果，项目打开、编辑/配置/流程变更及校验入口均触发重建。`editor.ts` 为每个 `.block` 设置共享 `data-object-ref` 并支持点击选择；`right.ts` 增加紧凑因果区，分开显示直接引用、直接被引用、potentialImpact 和仅来自本次 preview 的 observedImpact；无 trace 明确显示“尚无本次预览观察证据”。
- `preview-panel.ts` 在现有 diagnostics 下方保存当前 trace 事件列表，按 selected object 过滤/定位并通过既有 `jumpToScene` 事件桥回块编辑；`styles.css` 只增加紧凑因果/轨迹样式，没有全屏图或 AI 对话栏。新增 `causal-selection.test.ts`、`authoring-project-storage.test.ts`。
- 按 Task 7 Step 7 实际运行：`npm run test -w surdet-editor -- test/causal-selection.test.ts test/authoring-project-storage.test.ts test/model-roundtrip.test.ts test/preview-scenes.test.ts test/project-io.test.ts test/validate.test.ts` exit `0`，6 个文件/29 个测试通过；`npm run typecheck -w surdet-editor` exit `0`；`npm run build -w surdet-editor` exit `0`，867 modules transformed，preview chunk `594.54 kB` / gzip `175.92 kB` 的既有 warning 保留，未修改性能门限。Stage 5 编辑—预览—保存—重开相关回归未被移除。
- Task 7 本轮实际修改文件为：本计划、`packages/editor/src/causal-selection.ts`、`src/authoring-project-storage.ts`、`src/state.ts`、`src/main.ts`、`src/panels/editor.ts`、`src/panels/right.ts`、`src/panels/preview-panel.ts`、`src/styles.css`、`test/causal-selection.test.ts`、`test/authoring-project-storage.test.ts`；没有修改 Core/Renderer/Host/Shell/Zero、CLI、长期路线台账或受保护文件。
- Task 7 提交前新鲜 Git 事实：branch=`main`；`HEAD=70daa389bd0e125a2d53c7ef6cdd9d8e4bb50044`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`13 0`；`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出。tracked 未提交文件仅为本计划和上述 Task 7 白名单；暂存区为空；既有未跟踪受保护文件、handoff 和长期路线台账未触碰。
- Task 7 当前状态：`TASK_7_GREEN_LOCALLY` / `SHARED_OBJECT_INDEX_IN_MEMORY_VERIFIED` / `BIDIRECTIONAL_CAUSAL_SELECTION_VERIFIED` / `STAGE_5_EDITOR_REGRESSION_GREEN` / `TASK_7_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：只暂存 Task 7 白名单与本计划，核对缓存范围和 `git diff --cached --check` 后创建 `feat(editor): add causal authoring bridge` 普通本地提交；提交后立即回读真实 HEAD，再追加提交后事实并进入 Task 8。

### Task 7 — Step 8 completed after commit (2026-08-13 22:13 +08:00)

- 已按 Task 7 白名单精确提交：`git log --oneline -1`=`e06e2bd feat(editor): add causal authoring bridge`；提交后真实 `HEAD=e06e2bd704538ad3203b9ea2927d04956803095a`；`git show --name-status HEAD` 仅包含本计划、`packages/editor/src/authoring-project-storage.ts`、`src/causal-selection.ts`、`src/main.ts`、`src/panels/editor.ts`、`src/panels/preview-panel.ts`、`src/panels/right.ts`、`src/state.ts`、`src/styles.css`、`test/authoring-project-storage.test.ts` 和 `test/causal-selection.test.ts`。
- 提交后真实远端关系：`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；`git rev-list --left-right --count HEAD...surdet/main`=`14 0`。`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出；tracked 工作树和暂存区均为空。`git status --short --untracked-files=all` 仅保留既有未跟踪的 `AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、两份艺术交接文件、两份 handoff 和长期路线台账，未触碰、未暂存、未提交，未 push。
- Task 7 最终状态：`TASK_7_COMPLETED_LOCALLY` / `SHARED_OBJECT_INDEX_IN_MEMORY_VERIFIED` / `BIDIRECTIONAL_CAUSAL_SELECTION_VERIFIED` / `STAGE_5_EDITOR_REGRESSION_GREEN` / `NOT_PUSHED`。下一停止点：先完整读取 Task 8 与 Task 9 的实施范围，再按 Task 8 规定建立唯一聚合纵向 harness 红灯；不邀请项目所有者人工验收。

### Task 8 — Step 1 completed; Steps 2–9 pending (2026-08-13 22:30 +08:00)

- 已先写并运行 Task 8 规定的 harness 自检红灯：`node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --self-check` 初次 exit `1`，真实错误为 `HARNESS_SELF_CHECK_NOT_IMPLEMENTED`；红灯没有被改写成通过。随后完成同一入口的最小自检实现，重新运行 `node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` exit `0`，以及 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --self-check` exit `0`；自检真实读取 Starter scene/config、运行 HEAD、唯一桌面 fixture 目标和唯一 artifact 路径，未创建 fixture、未写入原始 Starter。
- Task 8 当前实现文件为新建 `packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` 与修改 `packages/shell/package.json`；尚未运行 CLI 能力链、正式 editor preview/Renderer 双路径、artifact、受影响构建或聚合 harness。自检输出的本轮候选 fixture 与 artifact 均位于桌面/系统临时目录且尚不存在，未纳入 Git。
- 本记录前新鲜 Git 事实：`HEAD=e06e2bd704538ad3203b9ea2927d04956803095a`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`14 0`；`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出。tracked 未提交文件仅为本计划、`packages/shell/package.json` 和上述 harness；暂存区为空；既有受保护文件、handoff 和长期路线台账保持未跟踪、未触碰、未暂存、未提交。
- 当前状态：`TASK_8_SELF_CHECK_RED_REPRODUCED_AND_ENTRY_READY` / `TASK_8_IMPLEMENTATION_IN_PROGRESS` / `NOT_PUSHED`。下一停止点：先按 Task 8 Step 6 运行 `node --check` 与 Core、Authoring、CLI、Renderer、Editor 五个受影响 build，然后只按 Step 7 执行一次聚合 harness；不提前运行正式路径，不循环重跑，不邀请人工验收。

### Task 8 — Steps 1–6 completed; Steps 7–9 pending (2026-08-13 22:31 +08:00)

- 已完成 Task 8 Step 6 规定的实际检查：`node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` exit `0`；`npm run build -w @surdet/core` exit `0`；`npm run build -w @surdet/authoring` exit `0`；`npm run build -w @surdet/cli` exit `0`；`npm run build -w @surdet/renderer` exit `0`；`npm run build -w surdet-editor` exit `0`。Editor 产出 `867 modules transformed`，preview chunk `594.54 kB` / gzip `175.92 kB` 的既有 warning 保留，未修改性能门限。
- Harness 已实现 Task 8 Step 2–5 所需逻辑但尚未实际执行聚合路径：只 spawn built CLI 的 14 项能力顺序、事务期间 fixture 文件树不变、commit 后唯一预期文件变化、正式 editor `preview.html` 的公开 `postMessage`、真实键盘/鼠标两条路径、错误通道和不可覆盖 artifact；没有直接 import authoring 内部函数，没有写入原始 Starter。
- 当前状态：`TASK_8_BUILD_GREEN` / `AGGREGATE_HARNESS_NOT_YET_RUN` / `NOT_PUSHED`。下一停止点：按任务书只运行一次 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`；成功则从磁盘回读唯一 artifact 与桌面 fixture，失败则保留 FAILED artifact、记录最后通过节点/第一失败节点并停止，不重跑。

### Task 8 — Step 7 completed with failure; Steps 8–9 stopped (2026-08-13 22:32 +08:00)

### Task 8 — Step 9 completed after commit (2026-08-13 22:33 +08:00)

- 已精确暂存并提交 Task 8 白名单与本计划：`git diff --cached --check` exit `0`；`git diff --cached --name-status` 仅为本计划、`packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` 和 `packages/shell/package.json`；普通本地提交为 `73c4b1f848b57d8b037696c7ade95667fd04e994 test(authoring): verify agent-ready vertical slice`。
- 提交后立即真实回读：`git log --oneline -1`=`73c4b1f test(authoring): verify agent-ready vertical slice`；`git rev-parse HEAD`=`73c4b1f848b57d8b037696c7ade95667fd04e994`；`git show --name-status HEAD` 与上述三文件范围一致；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`15 0`；`git diff --check` exit `0`；`git diff --cached --check` exit `0`；`git ls-files '*.log'` 无输出。tracked 工作树和暂存区均为空；既有受保护文件、handoff 和长期路线台账仍未跟踪、未触碰、未暂存、未提交；未 push。
- Task 8 最终停止事实：失败 artifact 与桌面 fixture 保留；没有 `change.commit`、没有正式 preview server、没有人工验收、没有 Task 9 全仓门禁、没有 Stage 6 Wave 1 PASSED 结论。此条记录本身在当前普通提交之后追加，下一停止点是只提交本条台账收口后停止等待总经理复审，不 amend、不重跑、不修改 runner。

- 已按任务书只运行一次聚合命令：`node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，exit `1`。没有重跑、没有切换路径、没有挑绿、没有修改生产代码或 runner。最后一个通过节点为 `change.write-operations-before-red`；第一个失败节点为 `project.validate.red`。
- 失败真实现象：任务要求的故意坏标签路径没有返回可继续使用的 `project.validate` 成功信封（其中 `result.ok=false`、`J002`、`objectRef`、`action`），而是在快照编译阶段由 CLI 返回 exit `1` 的失败信封：`error.code=PROJECT_INVALID`，消息为 `content/scenario/ch01_01.gal:4:3: 跳转目标标签 '@label missing_label' 不存在 ... [C002]`。因此 `redEvidenceId=null`、`greenEvidenceId=null`、`traceIds=[]`，没有到达 patch、green validation、simulate、runtime trace、diff、commit 或正式 editor preview；这只能证明当前聚合 harness 的红灯语义与现有 CLI 错误边界不匹配，不能归因于生产恢复或 editor/Renderer 功能。
- 失败 artifact 已保留且禁止覆盖：`<local-path>`；从磁盘重新读取 `status=FAILED`、`bytes=6513`、`sha256=A9CE9274C80C2DE38579FFA5951DAF2EA33241EA8196F35F907306A45A166D08`；artifact `runHead=e06e2bd704538ad3203b9ea2927d04956803095a`、`changeId=chg_0001`、`workingRevision=0`、`lastPassedNode=change.write-operations-before-red`、`firstFailedNode=project.validate.red`。
- 桌面 fixture 已保留但未被事务提交：`<local-path>`。artifact 与磁盘回读均证明 `beforeBegin=afterBegin=afterSceneCreateBeforeRed=6f414fa1280b75a43436e5fa2a92527dd0ff7e56391a551b42258a05effab08a`；fixture 没有 `content/scenario` 写入，未创建 `node_modules`、`dist`、`src`、`test` 或 Git 元数据；没有 preview server、人工入口或 PASSED artifact。
- 原始 Starter 身份仍未变化：`game.config.json` bytes=`1623`、SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4`、Git blob=`86ad869719dbb3cfcc065ced9c637a49b3ce6179`；`content/scenario/ch01_01.gal` bytes=`1035`、SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`、Git blob=`50b253ef3b683b4d848d7795b8142ab72fd7a690`。artifact 的全部 preview 错误通道仍为空，但这不是 preview 通过证据，因为 preview 尚未启动。
- Task 8 失败收口前状态：`TASK_8_AGGREGATE_FAILED_AT_PROJECT_VALIDATE_RED` / `HARNESS_RED_SEMANTICS_MISMATCH_UNRESOLVED` / `WAITING_FOR_REVIEW` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。Task 8 Step 8（人工入口）和 Task 9（聚焦测试、verify:all、最终报告）均停止；下一停止点：等待总经理独立复审失败 artifact、CLI 错误边界和当前 diff，另行决定是否授权一个新的最小 harness 红灯语义整改；本轮不修改、不重跑。

### Task 8 harness red-construction correction — Task 1 red reproduced (2026-08-13 22:48 +08:00)

- 已重新读取本轮权威文件、Stage 6 规格、Stage 5 任务/报告和 Task 8 历史失败记录；本轮仍只处理 Task 8 harness 红灯构造，不修改 Core、authoring、CLI、editor、Renderer、Host、Shell 其他文件、Zero、Starter、长期路线台账或受保护文件。旧失败 artifact `<local-path>` 已从磁盘确认仍为 `6513` bytes、SHA-256=`A9CE9274C80C2DE38579FFA5951DAF2EA33241EA8196F35F907306A45A166D08`、`status=FAILED`、`runHead=e06e2bd704538ad3203b9ea2927d04956803095a`、最后通过 `change.write-operations-before-red`、首个失败 `project.validate.red`；旧桌面 fixture `<local-path>` 保留未动。
- 在当前 runner 仅扩展 `--self-check`，新增合同要求：故意红灯 option 必须为 `target.kind=jump`、`target.value=ch01_01.missing_label`，其序列化必须为 `路径 A @set trust = 1 -> @jump ch01_01.missing_label`。当时 runner 的真实 fixture 仍为 `target={kind:'goto',value:'missing_label'}`，因此按授权先运行 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --self-check`，真实 exit=`1`；错误为 `self-check 故意红灯必须使用 project-level jump：{"kind":"goto","value":"missing_label"}`。这证明当前 goto fixture 与要求的共享项目校验 J002 红灯合同不符，未运行聚合 harness、未创建/覆盖旧 artifact 或旧 fixture。

### Task 8 harness red-construction correction — Tasks 2–3 completed (2026-08-13 22:49 +08:00)

- 已按授权只修正故意红灯构造：`badSceneBlocks()` 的第一个选项从 `target={kind:'goto',value:'missing_label'}` 改为 `target={kind:'jump',value:'ch01_01.missing_label'}`；`scene.patch` 使用的 `badRaw` 从 `路径 A @set trust = 1 -> @goto missing_label` 同步改为 `路径 A @set trust = 1 -> @jump ch01_01.missing_label`。有效选项仍为既有本地 `target={kind:'goto',value:'path_a'}`；没有改动其他场景、选择、变量、正式 preview、错误通道或 artifact 断言。
- Task 3 聚焦绿灯实际结果：`node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` exit=`0`；`node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --self-check` exit=`0`，输出 `status=SELF_CHECK_PASSED`，运行时 `runHead=77b467c81a9caa7b36900a93d830e15868edd41f`。该 self-check 只验证 Starter 身份、运行 HEAD、唯一 fixture/artifact 候选和 project-level jump 合同，没有创建 fixture、没有运行聚合 harness、没有覆盖旧 artifact 或旧 fixture。
- 本条完成时真实 Git：branch=`main`；`HEAD=77b467c81a9caa7b36900a93d830e15868edd41f`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`16 0`；tracked 未提交文件仅为 `packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` 与本计划，暂存区为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；tracked `*.log` 无输出。当前状态：`TASK_8_RED_CONSTRUCTION_CORRECTED` / `TASK_8_SELF_CHECK_GREEN` / `TASK_8_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：Task 4 只暂存 runner 与本计划，核对精确范围后创建 `test(authoring): use project-level validation red path` 普通本地提交；在该提交前不得运行完整聚合 harness。

### Task 8 harness red-construction correction — Task 4 committed (2026-08-13 22:50 +08:00)

- 已精确暂存并核对 `git diff --check`、`git diff --cached --check`；`git diff --cached --name-status` 只有 `M docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md` 与 `M packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`。没有夹带长期路线台账、受保护文件、artifact、fixture、日志或其他文件。
- 已创建普通本地提交：`git log --oneline -1`=`cb4f724 test(authoring): use project-level validation red path`；提交后立即重新读取 `git rev-parse HEAD`=`cb4f7243097815158c036a5a5c8b3514db9c9251`。`git show --name-status HEAD` 只有上述两个文件。该提交记为 `CODE_EVIDENCE_HEAD=cb4f7243097815158c036a5a5c8b3514db9c9251`；没有 amend、rebase、squash 或 push。
- 提交后真实 Git：branch=`main`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`17 0`；tracked 工作树和暂存区均为空；当前未跟踪集合仍只有既有 AGENTS、受保护文件、handoff 与长期路线台账；`git diff --check`、`git diff --cached --check` 均 exit=`0`；tracked `*.log` 无输出。
- 当前状态：`TASK_8_RED_CONSTRUCTION_CORRECTION_COMMITTED` / `CODE_EVIDENCE_HEAD=cb4f7243097815158c036a5a5c8b3514db9c9251` / `TASK_8_BUILD_PENDING` / `NOT_PUSHED`。下一停止点：按原 Task 8 Step 6 运行 Core、authoring、CLI、Renderer、editor 五个构建；任一构建失败即停止，不运行聚合 harness。

### Task 8 harness red-construction correction — Task 5 builds completed (2026-08-13 22:51 +08:00)

- 按原 Task 8 Step 6 实际运行并全部通过：`npm run build -w @surdet/core` exit=`0`；`npm run build -w @surdet/authoring` exit=`0`；`npm run build -w @surdet/cli` exit=`0`；`npm run build -w @surdet/renderer` exit=`0`；`npm run build -w surdet-editor` exit=`0`。editor Vite 构建实际为 `867 modules transformed`，`preview-o7BB25T4.js` 为 `594.54 kB`（gzip `175.92 kB`），仅保留既有大 chunk warning；没有修改性能门限或其他生产逻辑。
- 本条构建基于已提交的 runner `CODE_EVIDENCE_HEAD=cb4f7243097815158c036a5a5c8b3514db9c9251`；本轮实际修改仍只有指定 runner 与本计划，构建未写入 Git tracked 源码。未运行完整聚合 harness，未创建或覆盖旧失败 artifact/fixture，未启动正式 preview 或人工验收。
- 当前状态：`TASK_8_BUILD_GREEN` / `AGGREGATE_HARNESS_PENDING_SINGLE_RUN` / `CODE_EVIDENCE_HEAD=cb4f7243097815158c036a5a5c8b3514db9c9251` / `NOT_PUSHED`。下一停止点：只运行一次 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，使用 runner 自动生成的新桌面 fixture 与新 artifact；失败则保留并回读新 FAILED artifact 后停止，成功才可继续原 Task 8 Step 8/Task 9。

### Task 8 harness red-construction correction — Task 6 aggregate failed (2026-08-13 22:52–22:54 +08:00)

- 按授权只运行一次新的聚合命令：`node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，真实 exit=`1`；没有重跑、没有切换 case、没有修改生产逻辑或 runner。新运行自动生成的桌面 fixture 为 `<local-path>`，新 artifact 为 `<local-path>`。
- 新 artifact 已从磁盘重新读取：`bytes=6696`；SHA-256=`BB5593ECC024499EEBCB492FCA601F2CFA6F5DC4185F121F1532C7513FE0CD36`；`status=FAILED`；`runHead=cb4f7243097815158c036a5a5c8b3514db9c9251`，与 Task 4 的 `CODE_EVIDENCE_HEAD` 完全一致；`projectRevision=43dead89a25afb8134db105ebf2f11b8523aca2b9c4c69f53ef05e7d22f1a39c`；`changeId=chg_0001`；`workingRevision=0`；`redEvidenceId=validation_1786632695167_54870d14-3f91-4aea-b6a6-cc73106c907a`；`greenEvidenceId=validation_1786632695766_780b8770-0aa0-4e4c-b34e-3da8ab4d3f74`；`traceIds=[]`；`cliTraceIds=[]`。
- 新聚合最后一个通过节点为 `project.simulate-2-of-2`，首个失败节点为 `runtime.run-from.A-and-B`。失败错误是正式 CLI `runtime.run-from` 返回路径 A `choices=[0]`、`status=passed` 但 `finalVariables.trust=0`，runner 断言期望 `trust=1`，因此未到达路径 B 的正式运行证据、`change.diff`/`change.commit` 后的 preview、Renderer Presentation 应用或人工入口。该证据只确认当前聚合在正式运行输入/结果合同处失败；没有足够证据把它归因于 Core、authoring、CLI、Renderer、editor 或其他生产逻辑，故本轮不修改任何生产文件、不放宽断言。
- 新 artifact 的其余事实：`choiceCoverage={total:2,visited:2}`；`stateOutcomes=[]`；preview=`null`；error channels 中 `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 均为空，`unexpectedWindowClosed=false`。事务尚未 `change.commit`，新 fixture 仍为未提交的 Starter 副本；磁盘树哈希 `beforeBegin=afterBegin=afterSceneCreateBeforeRed=afterRedValidation=afterGreenValidation=6f414fa1280b75a43436e5fa2a92527dd0ff7e56391a551b42258a05effab08a`，未创建 `content/scenario` 写入。旧 FAILED artifact 与旧桌面 fixture 均未删除、未覆盖、未复用。
- 原始 Starter 复核未变：`game.config.json` bytes=`1623`、SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4`、Git blob=`86ad869719dbb3cfcc065ced9c637a49b3ce6179`；`content/scenario/ch01_01.gal` bytes=`1035`、SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`、Git blob=`50b253ef3b683b4d848d7795b8142ab72fd7a690`。
- 失败收口时真实 Git：branch=`main`；`HEAD=cb4f7243097815158c036a5a5c8b3514db9c9251`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`17 0`；tracked 未提交修改仅为本计划的本次 Execution Ledger 追加，暂存区为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；tracked `*.log` 无输出；没有 push。当前停止状态：`TASK_8_AGGREGATE_FAILED_AT_RUNTIME_RUN_FROM_A` / `WAITING_FOR_REVIEW` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。下一步等待总经理独立复审，不再运行任何聚合路径。

### Second Task 8 aggregate failure closure — Task 0 baseline re-established (2026-08-13 23:13 +08:00)

- 已重新完整读取 `E:\surdet\AGENTS.md`、长期路线台账、Stage 6 Wave 1 正式设计规格、Stage 5 最新任务书与交付报告、当前 Stage 6 Wave 1 任务书，并读取本轮 Git/交付物/完成前验证规范。当前唯一主题是已经确认的共享 `@surdet/authoring` choice effect 序列化缺陷；不创建子 AI、不并行施工、不修改长期路线台账、不进入 Wave 2，不邀请项目所有者人工验收。
- Task 0 新鲜 Git 基线：branch=`main`；`HEAD=a143b0592ec9151b28913a94ae41e8b3b2e28aa2`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`19 0`。tracked 工作树和暂存区均为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；tracked `*.log` 无输出。`git status --short --untracked-files=all` 仅列出既有未跟踪的 `AGENTS.md`、受保护文件、两份 handoff、两份艺术文件和长期路线台账；本轮不触碰这些文件。
- 两份历史失败 artifact 已从磁盘重新读取且未删除、覆盖或复用：第一次 `<local-path>` 为 `status=FAILED`、`bytes=6513`、SHA-256=`A9CE9274C80C2DE38579FFA5951DAF2EA33241EA8196F35F907306A45A166D08`、`runHead=e06e2bd704538ad3203b9ea2927d04956803095a`、最后通过 `change.write-operations-before-red`、首个失败 `project.validate.red`；第二次 `<local-path>` 为 `status=FAILED`、`bytes=6696`、SHA-256=`BB5593ECC024499EEBCB492FCA601F2CFA6F5DC4185F121F1532C7513FE0CD36`、`runHead=cb4f7243097815158c036a5a5c8b3514db9c9251`、最后通过 `project.simulate-2-of-2`、首个失败 `runtime.run-from.A-and-B`；第二次 artifact 的 red/green evidence ID 均存在。
- 本 Task 0 没有修改生产代码、测试、Starter、《零点之后》、Core、Renderer、Host、CLI、editor 或 Shell runner；本计划的本条 Execution Ledger 是当前唯一工作树变化。当前状态：`TASK_0_BASELINE_REESTABLISHED` / `AUTHORING_CHOICE_EFFECT_SERIALIZATION_BUG_CONFIRMED` / `TASK_1_RED_PENDING` / `NOT_PUSHED`。下一停止点：Task 1 只在 `packages/authoring/test/operations.test.ts` 建立精确 choice effect 序列化红灯，并先运行指定测试得到 exit=`1`。

### Second Task 8 aggregate failure closure — Task 1 serialization red reproduced (2026-08-13 23:14 +08:00)

- 已在 `packages/authoring/test/operations.test.ts` 增加类型化 choice effect 序列化测试：通过 `applySceneCreate` 创建 `trust` number/initial `0`、两个选项、A=`set trust = 1`/`goto path_a`、B=`set trust = -1`/`goto path_b`；精确要求 working file 包含 `路径 A -> @set trust = 1 @goto path_a` 与 `路径 B -> @set trust = -1 @goto path_b`，并精确排除两种旧错误形态。
- 按授权先运行 `npm run test -w @surdet/authoring -- test/operations.test.ts`，真实 exit=`1`。Vitest 实际为 `1` 个测试文件、`3` 个测试：`2 passed`、`1 failed`；唯一失败为新 choice effect 序列化测试，实际 working file 仍产生 `路径 A @set trust = 1 -> @goto path_a` 与 `路径 B @set trust = -1 -> @goto path_b`，未得到正确箭头后指令顺序。该红灯直接命中 `renderChoiceOption()` 的已确认症状；没有改动生产代码、没有运行 CLI 测试、没有运行构建或聚合路径。
- 本条完成时真实 Git：branch=`main`；`HEAD=a143b0592ec9151b28913a94ae41e8b3b2e28aa2`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`19 0`；tracked 未提交修改为本计划与 `packages/authoring/test/operations.test.ts`，暂存区为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；tracked `*.log` 无输出。当前状态：`TASK_1_SERIALIZATION_RED_REPRODUCED` / `TASK_2_CLI_RUNTIME_RED_PENDING` / `AUTHORING_CHOICE_EFFECT_SERIALIZATION_BUG_CONFIRMED` / `NOT_PUSHED`。下一停止点：Task 2 先更新 CLI vertical-slice 测试的正确 expectedFingerprint 与 A/B runtime trust/stateDelta 红灯，再运行当前代码上的 CLI 测试。

### Second Task 8 aggregate failure closure — Task 2 CLI contract red reproduced (2026-08-13 23:15 +08:00)

- 已更新 `packages/cli/test/authoring-vertical-slice.test.ts`：choice patch 的 `expectedFingerprint` 使用正确 DSL 原文 `正向 -> @set trust = 1 @jump agent.missing`；测试不再只断言 `choiceBranches=2/2`，并加入正式 CLI `runtime run-from` A/B、不同 `traceId`、`runtime.read-trace` 的 trust `stateDelta` 以及 `finalVariables.trust=1/-1` 断言。没有把预期值改为 `0`。
- 按授权在生产修复前运行 `npm run test -w @surdet/cli -- test/authoring-vertical-slice.test.ts`，真实 exit=`1`。Vitest 实际为 `1` 个测试文件、`1` 个测试失败；首个失败在 `authoring-vertical-slice.test.ts:101` 的 `scene.patch` status 断言，当前 CLI 生成的 choice 原文仍是错误旧形态，因而与已更新为正确 DSL 的 fingerprint 不匹配；测试没有到达新增的 runtime A/B 与 trace stateDelta 断言。该结果如实记录为 Task 2 红灯，不能写成 CLI runtime A/B 已经被本轮测试实际运行；第二次聚合 artifact 已经独立提供正式 runtime `trust=0` 的症状证据。
- 本条完成时真实 Git：branch=`main`；`HEAD=a143b0592ec9151b28913a94ae41e8b3b2e28aa2`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`19 0`；tracked 未提交修改为本计划、`packages/authoring/test/operations.test.ts` 和 `packages/cli/test/authoring-vertical-slice.test.ts`，暂存区为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；tracked `*.log` 无输出。当前状态：`TASK_2_SERIALIZATION_RUNTIME_CONTRACT_RED_REPRODUCED` / `TASK_3_SHARED_SERIALIZATION_FIX_PENDING` / `AUTHORING_CHOICE_EFFECT_SERIALIZATION_BUG_CONFIRMED` / `NOT_PUSHED`。下一停止点：Task 3 只修改 `packages/authoring/src/operations.ts` 的 `renderChoiceOption()`，固定输出为 label、可选条件、箭头、effects、target。

### Second Task 8 aggregate failure closure — Task 3 minimal shared serialization fix (2026-08-13 23:16 +08:00)

- 只修改 `packages/authoring/src/operations.ts` 的 `renderChoiceOption()`：先输出两个空格和 label、可选 `[if:...]`、` ->`，再按输入顺序输出 effects，最后输出 target；无 effect 时仍输出 `label -> @target`，没有修改 Core parser、Interpreter、contracts、simulation、CLI 生产代码或兼容/fallback。
- 本 Task 3 未提前宣称绿灯；聚焦绿灯统一在 Task 5 按授权命令运行。当前已执行的 `git diff --check` 与 `git diff --cached --check` 均 exit=`0`，暂存区仍为空。

### Second Task 8 aggregate failure closure — Task 4 runner contract synchronized (2026-08-13 23:16 +08:00)

- 已将 runner 的故意红灯 `badRaw` 同步为 `路径 A -> @set trust = 1 @jump ch01_01.missing_label`，并将 `--self-check` 的序列化合同同步为同一正确 DSL；有效绿灯路径保持 `路径 A -> @set trust = 1 @goto path_a` 的类型化输入，不修改其他错误通道、正式 preview 或 artifact 断言。
- 已运行 grep 检查 runner 与活跃 authoring/CLI 测试中的错误旧形态。结果仅命中 `packages/authoring/test/operations.test.ts` 中两条明确的 `expect(...).not.toContain(...)` negative assertion；runner、CLI 活跃合同和其他非 negative assertion 没有旧形态命中，`rg` 实际 exit=`0`。本条没有运行完整聚合路径。
- 本条完成时真实 Git：branch=`main`；`HEAD=a143b0592ec9151b28913a94ae41e8b3b2e28aa2`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`19 0`；tracked 未提交修改为本计划、`packages/authoring/src/operations.ts`、`packages/authoring/test/operations.test.ts`、`packages/cli/test/authoring-vertical-slice.test.ts` 和 `packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，暂存区为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；tracked `*.log` 无输出。当前状态：`TASK_3_FIX_APPLIED` / `TASK_4_RUNNER_CONTRACT_SYNCHRONIZED` / `TASK_5_FOCUSED_GREEN_PENDING` / `NOT_PUSHED`。下一停止点：Task 5 串行运行指定 authoring/CLI 聚焦测试、typecheck、build、runner node-check/self-check；任一失败即停止，不提交、不运行聚合路径。

### Second Task 8 aggregate failure closure — Task 5 focused green completed (2026-08-13 23:17–23:19 +08:00)

- authoring 聚焦测试 `npm run test -w @surdet/authoring -- test/operations.test.ts test/simulation.test.ts` exit=`0`：`2` 个文件、`6` 个测试全部通过；`npm run typecheck -w @surdet/authoring` exit=`0`；`npm run build -w @surdet/authoring` exit=`0`。
- CLI 聚焦门禁 `npm run build -w @surdet/cli` exit=`0`；`npm run test -w @surdet/cli -- test/authoring-vertical-slice.test.ts` exit=`0`：`1` 个文件、`1` 个测试通过；该测试实际证明 `choiceBranches=2/2`、CLI runtime A/B 的 `trust=1/-1`、不同 traceId 和两条 trust stateDelta；`npm run typecheck -w @surdet/cli` exit=`0`。
- runner `node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` 首次 exit=`0`，但首次 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --self-check` exit=`1`，实际暴露 self-check 内部序列化 helper 仍按旧顺序拼接。随后在 Task 4 runner 白名单内只同步该 helper 的 label/条件/箭头/effects/target 顺序；没有运行聚合路径。修正后重新运行 `node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` exit=`0`；重新运行 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --self-check` exit=`0`，输出 `status=SELF_CHECK_PASSED`，候选 fixture/artifact 均为唯一且尚不存在，`runHead=a143b0592ec9151b28913a94ae41e8b3b2e28aa2`。
- 本 Task 5 未运行完整聚合路径；未修改 Core、Renderer、Host、CLI 生产源码、editor、Starter、《零点之后》或长期路线台账。当前状态：`TASK_5_FOCUSED_GREEN` / `CLI_TRUST_STATE_DELTA_VERIFIED` / `RUNNER_SELF_CHECK_GREEN` / `TASK_6_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：Task 6 只精确暂存本轮白名单文件与本计划，核对缓存范围和检查命令后创建 `fix(authoring): serialize choice effects as instructions` 普通本地提交；提交前不得运行聚合路径。

### Second Task 8 aggregate failure closure — Task 6 fix committed (2026-08-13 23:19 +08:00)

- 已精确暂存并核对本轮五个白名单文件：`docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md`、`packages/authoring/src/operations.ts`、`packages/authoring/test/operations.test.ts`、`packages/cli/test/authoring-vertical-slice.test.ts`、`packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`；`git diff --check`、`git diff --cached --check` 均 exit=`0`；`git diff --cached --name-status` 只有上述五个文件，没有夹带长期路线台账、受保护文件、artifact、fixture、日志或构建产物。
- 已创建普通本地提交：`git log --oneline -1`=`d857a39 fix(authoring): serialize choice effects as instructions`；提交后立即重新读取 `git rev-parse HEAD`=`d857a39be99f82e78e1b83d9b1044034a5e62da7`；`git show --name-status HEAD` 只有上述五个文件。该提交记为新的 `CODE_EVIDENCE_HEAD=d857a39be99f82e78e1b83d9b1044034a5e62da7`；没有 amend、rebase、squash 或 push。
- 提交后真实 Git：branch=`main`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`20 0`；tracked 工作树和暂存区为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；tracked `*.log` 无输出；既有未跟踪治理/交接文件保持未触碰。当前状态：`TASK_6_FIX_COMMITTED` / `CODE_EVIDENCE_HEAD=d857a39be99f82e78e1b83d9b1044034a5e62da7` / `TASK_7_BUILD_PENDING` / `NOT_PUSHED`。下一停止点：Task 7 基于该已提交 HEAD 运行 Core、authoring、CLI、Renderer、editor 五个构建；任一失败即停止，不运行聚合路径。

### Second Task 8 aggregate failure closure — Task 7 submitted-head builds completed (2026-08-13 23:19–23:20 +08:00)

- 基于已提交 `CODE_EVIDENCE_HEAD=d857a39be99f82e78e1b83d9b1044034a5e62da7` 实际运行并全部通过：`npm run build -w @surdet/core` exit=`0`；`npm run build -w @surdet/authoring` exit=`0`；`npm run build -w @surdet/cli` exit=`0`；`npm run build -w @surdet/renderer` exit=`0`；`npm run build -w surdet-editor` exit=`0`。
- editor 构建实际为 `867 modules transformed`，`preview-o7BB25T4.js`=`594.54 kB`、gzip=`175.92 kB`；保留既有大 chunk warning，没有修改性能门限。构建没有修改 Git tracked 源码；没有运行 `verify:all`、性能矩阵、pack、electron-builder 或多轮 Electron。
- 本条完成时当前计划仍有待记录的 Task 6/7 Execution Ledger 修改，代码提交身份没有变化；本轮没有运行聚合路径、没有创建/覆盖任何新 artifact 或 fixture。当前状态：`TASK_7_BUILD_GREEN` / `AGGREGATE_HARNESS_PENDING_SINGLE_RUN` / `CODE_EVIDENCE_HEAD=d857a39be99f82e78e1b83d9b1044034a5e62da7` / `NOT_PUSHED`。下一停止点：Task 8 只运行一次 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，必须生成全新的 artifact/fixture；失败则回读新 FAILED artifact 后停止，不修改、不重跑。

### Second Task 8 aggregate failure closure — Task 8 single aggregate failed at change.commit (2026-08-13 23:20 +08:00)

- 按授权只运行一次新的聚合命令 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，真实 exit=`1`；runner 使用全新桌面 fixture `<local-path>` 和全新 artifact `<local-path>`，没有复用、删除或覆盖前两次失败 evidence/fixture，没有重跑、挑绿或修改代码。
- 新 artifact 已从磁盘重新读取：`status=FAILED`；`bytes=7000`；SHA-256=`454DA0A408C00DB559339DCE052AF901BEFAD39B2DB3CCB09C192D8EA432413D`；`runHead=d857a39be99f82e78e1b83d9b1044034a5e62da7`，与 Task 6 的 `CODE_EVIDENCE_HEAD` 完全一致；`projectRevision=43dead89a25afb8134db105ebf2f11b8523aca2b9c4c69f53ef05e7d22f1a39c`；`changeId=chg_0001`；`workingRevision=0`；`redEvidenceId=validation_1786634426782_ea893c94-8659-4769-afd1-4423484e0704`；`greenEvidenceId=validation_1786634427384_c445d3c8-cebe-41c3-a3c4-4ed0ebbba18a`；`cliTraceIds` 为 `trace_1786634427867_0742b7cd-7b35-491b-88c5-88868cba1458` 与 `trace_1786634428067_c603fd33-e6d2-46e5-9c8b-d70598892f5b`；`choiceCoverage=2/2`；`stateOutcomes=[-1,1]`；editor `traceIds=[]`；`preview=null`。
- 最后通过节点为 `change.diff`，首个失败节点为 `change.commit`。正式 CLI 红灯、修正后的 project validation、green validation、2/2 模拟、runtime A/B、不同 CLI trace、trust 状态结果和三层 diff 均已实际到达；提交失败后没有到达成功的 `change.commit`、正式 editor preview/Renderer Presentation、Presentation 应用证据、后续文本对比或人工入口。
- 第一个失败节点的真实错误为 CLI 返回 `code=COMMIT_FAILED_RECOVERED`，消息：`提交前 staging 失败：AuthoringOperationError: 路径不在项目根目录内：content/scenario/agent_support.gal`。本轮不把它归因于尚未到达的 editor/Renderer/人工路径，不修改 Core、authoring、CLI 生产源码或 runner，不放宽任何断言。
- 新 fixture 从磁盘重新读取为 `19` 个文件；`content/scenario`、`node_modules`、`dist`、`src`、`test` 均不存在；`game.config.json` 为 `1623` bytes、SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4`；外部回读文件树 SHA-256=`95731AAFB4F1C87EAD227DFD2A99F9E07BC97A0C4072BCF8D4C0FF852026D3C7`。artifact 的 `beforeBegin`、`afterBegin`、`afterSceneCreateBeforeRed`、`afterRedValidation`、`afterGreenValidation`、`afterDiff` 内部树哈希均为 `6f414fa1280b75a43436e5fa2a92527dd0ff7e56391a551b42258a05effab08a`；没有证据表明 `change.commit` 成功写入项目。
- 新 artifact 的错误通道均为空：`pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 均为 `0`，`unexpectedWindowClosed=false`；这是因为正式 editor preview 尚未启动，不是 Presentation 通过证据。原始 Starter 仍未变化：`game.config.json` `1623` bytes / SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4` / Git blob=`86ad869719dbb3cfcc065ced9c637a49b3ce6179`；`content/scenario/ch01_01.gal` `1035` bytes / SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0` / Git blob=`50b253ef3b683b4d848d7795b8142ab72fd7a690`。
- 前两份失败 artifact 与前两份旧桌面 fixture 均保持存在、未删除、未覆盖、未复用；本轮不进入原 Task 8 Step 8，不运行 Task 9，不创建 Stage 6 Wave 1 交付报告，不邀请人工验收。当前状态：`TASK_8_AGGREGATE_FAILED_AT_CHANGE_COMMIT` / `WAITING_FOR_REVIEW` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。下一停止点：只提交本条真实失败台账记录后，等待独立复审，不再修改、不重跑。

### Third Task 8 failure closure — Task 0 baseline re-established for NodeProjectStorage parent creation (2026-08-13 23:39 +08:00)

- 已重新完整读取本轮要求的 `E:\surdet\AGENTS.md`、长期路线台账、Stage 6 Wave 1 设计规格、当前 Stage 6 Wave 1 任务书、Stage 5 最新任务书和 Stage 5 交付报告；并重新读取三份历史 FAILED artifact 的 JSON 内容与磁盘身份。当前唯一主题是 `NodeProjectStorage` 在合法缺失父目录 staging 时的最小路径安全修复；不处理已验证的 choice effect 序列化修复，不创建子 AI、不并行施工、不修改长期路线台账、不进入 Wave 2，不邀请项目所有者人工验收。
- 新鲜 Git 基线：branch=`main`；`HEAD=0f394d7fe0518b4df39439c9cd6cb264f377dd09`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`22 0`。`git status --short --untracked-files=all` 仅列出既有未跟踪的 `AGENTS.md`、受保护文件、handoff 文件和长期路线台账；tracked 工作树与暂存区均无修改；`git diff --check`、`git diff --cached --check` 均 exit=`0`；`git ls-files '*.log'` 无输出；最近提交包含 `0f394d7 docs(authoring): clarify task 8 fixture closure`、`77d0bd5 docs(authoring): record task 8 commit failure` 和 `d857a39 fix(authoring): serialize choice effects as instructions`。
- 三份失败 artifact 均从磁盘重新读取且保留未动：第一次 `<local-path>` 为 `6513` bytes、SHA-256=`A9CE9274C80C2DE38579FFA5951DAF2EA33241EA8196F35F907306A45A166D08`、`status=FAILED`、`runHead=e06e2bd704538ad3203b9ea2927d04956803095a`、最后通过 `change.write-operations-before-red`、首个失败 `project.validate.red`；第二次 `<local-path>` 为 `6696` bytes、SHA-256=`BB5593ECC024499EEBCB492FCA601F2CFA6F5DC4185F121F1532C7513FE0CD36`、`status=FAILED`、`runHead=cb4f7243097815158c036a5a5c8b3514db9c9251`、最后通过 `project.simulate-2-of-2`、首个失败 `runtime.run-from.A-and-B`、choice coverage=`2/2`；第三次 `<local-path>` 为 `7000` bytes、SHA-256=`454DA0A408C00DB559339DCE052AF901BEFAD39B2DB3CCB09C192D8EA432413D`、`status=FAILED`、`runHead=d857a39be99f82e78e1b83d9b1044034a5e62da7`、最后通过 `change.diff`、首个失败 `change.commit`、choice coverage=`2/2`、state outcomes=`[-1,1]`。第三次失败的真实提交错误为合法新文件 `content/scenario/agent_support.gal` 的缺失父目录被错误映射为 `PATH_OUTSIDE_PROJECT`。
- 三个历史桌面 fixture 均从磁盘确认仍存在、各有 `19` 个文件且没有 `content/scenario`；没有删除、覆盖或复用。原始 Starter 仍为 `game.config.json` `1623` bytes / SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4` / Git blob=`86ad869719dbb3cfcc065ced9c637a49b3ce6179`，以及 `content/scenario/ch01_01.gal` `1035` bytes / SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0` / Git blob=`50b253ef3b683b4d848d7795b8142ab72fd7a690`。
- 已只读检查当前 `packages/cli/src/authoring/node-project-storage.ts`、`packages/authoring/src/change-session.ts`、`packages/authoring/src/project-storage.ts`、`packages/cli/src/authoring/authoring-service.ts`、`packages/authoring/test/commit-recovery.test.ts`、`packages/cli/test/authoring-vertical-slice.test.ts` 和 CLI/root package scripts。确认现有 `assertSafeParent()` 对不存在 parent 直接调用 `realpath()` 并返回 `PATH_OUTSIDE_PROJECT`；本轮将保持 `ProjectWriteStorage` 接口、事务边界和错误代码不变，仅在 Node 存储适配器补齐 staging 时的安全父目录创建与失败清理。
- 本 Task 0 未修改生产代码、测试、Starter、《零点之后》、Core、Renderer、Host、CLI 其他文件、editor、Shell runner、长期路线台账或受保护文件；截至本记录计划文件尚未提交的变化仅为本条 Ledger。当前状态：`TASK_0_BASELINE_REESTABLISHED` / `NODE_PROJECT_STORAGE_MISSING_PARENT_BUG_CONFIRMED` / `TASK_1_RED_PENDING` / `NOT_PUSHED`。下一停止点：只在 `packages/cli/test/node-project-storage.test.ts` 建立真实文件系统红灯，证明缺失父目录合法 staging/commit 当前失败并命中该症状；先运行规定聚焦红灯，不运行聚合 harness。

### Third Task 8 failure closure — Task 1 red reproduced (2026-08-13 23:40 +08:00)

- 已新增唯一红灯测试 `packages/cli/test/node-project-storage.test.ts`，在仓库外真实临时目录中创建 `content`、故意不创建 `content/scenario`，然后调用 `NodeProjectStorage.stageText('content/scenario/agent_support.gal', ...)` 并继续真实 `replaceFromStage` 提交路径；测试先确认提交前目标父目录和目标文件均不存在，并要求合法新文件最终成功落盘。
- 按 Task 1 规定实际运行 `npm run test -w @surdet/cli -- test/node-project-storage.test.ts`，exit=`1`；Vitest=`v3.2.7`，1 个测试文件/1 个测试失败。首个失败节点为 `stageText`，真实错误为 `AuthoringOperationError` code=`PATH_OUTSIDE_PROJECT`，堆栈落在 `node-project-storage.ts:83` 的 `assertSafeParent()` 对缺失父目录调用 `realpath()` 后的错误映射；没有运行聚合 harness、没有运行其他测试、没有修改生产代码。
- 本 Task 1 实际修改文件：仅新增 `packages/cli/test/node-project-storage.test.ts` 与本计划；临时测试目录在测试 finally 中清理，仓库原始 Starter、历史 artifact/fixture、长期路线台账和受保护文件未触碰。当前状态：`TASK_1_RED_REPRODUCED` / `MISSING_PARENT_PATH_ERROR_CONFIRMED` / `TASK_2_MINIMAL_STORAGE_FIX_PENDING` / `NOT_PUSHED`。下一停止点：只修改 `packages/cli/src/authoring/node-project-storage.ts`，实现 staging 时逐段安全创建缺失父目录及失败清理；随后运行 Task 3 的真实文件系统 A–D 聚焦测试前，不放宽断言、不运行聚合路径。

### Third Task 8 failure closure — Tasks 2–3 completed (2026-08-13 23:41–23:48 +08:00)

- 仅修改 `packages/cli/src/authoring/node-project-storage.ts`：`resolveRelative` 额外拒绝平台绝对路径；`assertSafeParent` 逐段 lstat/realpath 校验并仅在 `stageText` 临界区用非递归 `mkdir` 创建缺失父目录；现有目录、非目录、symlink/junction、真实路径变化和根外路径均保持稳定 `PATH_OUTSIDE_PROJECT` 拒绝。保留同目录 `.surdet-<change>-<uuid>.tmp` staging、写后回读/哈希校验和现有 `ProjectWriteStorage` 接口。
- 新增 staging 目录归属与待清理集合：stage 失败立即删除临时文件并从最深层开始只删除空目录；commit/recovery 的 `removeStage` 在所有相关 staging 清理时重试空目录；目录含用户/目标文件、预存目录、符号链接或根目录本身时绝不递归删除或删除目录。`removePath` 不提前删除父目录，避免 recovery 后续清理 staging 身份时丢失安全父路径。
- Task 3 真实文件系统 A–D 已在 `packages/cli/test/node-project-storage.test.ts` 实现：A 合法缺失父目录的 staging→replace；B 通过真实 `beginChange`/`rollbackChange` 验证 commit 前项目树未变；C 验证 `..`、绝对路径、junction 和普通文件父级均返回 `PATH_OUTSIDE_PROJECT`，并确认项目外 sentinel 未写入；D 用真实 Node 存储和第二次 replace 故障注入验证 `COMMIT_FAILED_RECOVERED` 后只清理本轮新建空目录/临时文件，保留预存 `content` 目录、配置文件和项目外 sentinel。
- 已运行 `npm run test -w @surdet/cli -- test/node-project-storage.test.ts`，exit=`0`；Vitest=`v3.2.7`，1 个测试文件/5 个测试全部通过。此前 Task 1 红灯的同一命令 exit=`1` 及 `PATH_OUTSIDE_PROJECT` 失败事实保留在上一笔 Ledger；没有运行聚合 harness，没有修改 authoring/Core/Renderer/Host/editor/Shell runner/Zero/Starter 或长期路线台账。
- 本条完成时实际修改文件为：`packages/cli/src/authoring/node-project-storage.ts`、新增 `packages/cli/test/node-project-storage.test.ts` 和本计划；当前状态：`TASK_3_REAL_FILESYSTEM_GREEN` / `SAFE_MISSING_PARENT_STAGING_VERIFIED` / `COMMIT_FAILURE_PARENT_CLEANUP_VERIFIED` / `TASK_4_FOCUSED_GATES_PENDING` / `NOT_PUSHED`。下一停止点：按任务书串行运行 CLI 两组聚焦测试、CLI typecheck/build、runner `node --check` 与 `--self-check`，随后检查 diff；任一失败即停止，不运行聚合 harness。

### Third Task 8 failure closure — Task 4 focused gates completed (2026-08-13 23:48–23:49 +08:00)

- 已运行 `npm run test -w @surdet/cli -- test/node-project-storage.test.ts test/authoring-vertical-slice.test.ts`，exit=`0`；Vitest=`v3.2.7`，2 个测试文件/6 个测试全部通过，其中 NodeProjectStorage A–D 为 5 个测试，既有 CLI vertical slice 为 1 个测试。
- 已运行 `npm run typecheck -w @surdet/cli`，exit=`0`；`npm run build -w @surdet/cli`，exit=`0`；`node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，exit=`0`；`node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --self-check`，exit=`0`，输出 `status=SELF_CHECK_PASSED`、`runHead=0f394d7fe0518b4df39439c9cd6cb264f377dd09`。self-check 给出的桌面 fixture/artifact 候选均从磁盘确认不存在，没有创建或覆盖任何 artifact/fixture。
- `git diff --check`、`git diff --cached --check`、`git ls-files '*.log'` 均完成；前两者无错误，后者无输出。当前真实 Git：branch=`main`；`HEAD=0f394d7fe0518b4df39439c9cd6cb264f377dd09`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`22 0`；tracked 未提交文件仅为本计划与 `packages/cli/src/authoring/node-project-storage.ts`，新增测试为 `packages/cli/test/node-project-storage.test.ts`；暂存区为空；既有未跟踪治理/交接文件和长期路线台账未触碰。
- Task 4 没有运行完整聚合 harness，没有修改 Core、authoring、Renderer、Host、editor、Shell runner、Zero、Starter、长期路线台账或受保护文件。当前状态：`TASK_4_FOCUSED_GATES_GREEN` / `NODE_PROJECT_STORAGE_FIX_READY_TO_COMMIT` / `AGGREGATE_HARNESS_PENDING_SINGLE_RUN` / `NOT_PUSHED`。下一停止点：只暂存本计划、NodeProjectStorage 生产文件和新测试文件，核对精确范围后创建普通本地修复提交；提交后再按授权只运行一次新聚合路径。

### Third Task 8 failure closure — Task 5 fix committed (2026-08-13 23:50 +08:00)

- 已精确暂存并核对 `git diff --cached --check` exit=`0`、`git diff --cached --name-status`；缓存区只有 `docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md`、`packages/cli/src/authoring/node-project-storage.ts` 和 `packages/cli/test/node-project-storage.test.ts`。没有夹带长期路线台账、受保护文件、历史 artifact/fixture、日志、构建产物或其他工作区。
- 已创建普通本地提交：`git log --oneline -1`=`a4ff12e fix(cli): create safe parents for staged authoring files`；提交后立即重新读取 `git rev-parse HEAD`=`a4ff12ec88bc99d8efa0cf98328cd7c453fd03a6`；`git show --name-status HEAD` 只有上述三个文件。该提交记为新的 `CODE_EVIDENCE_HEAD`；未 amend、rebase、squash 或 push。
- 提交后真实 Git：branch=`main`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`23 0`；tracked 工作树和暂存区为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；`git ls-files '*.log'` 无输出；既有未跟踪 AGENTS、受保护文件、handoff 文件和长期路线台账保持原样。
- 当前状态：`TASK_5_NODE_PROJECT_STORAGE_FIX_COMMITTED` / `CODE_EVIDENCE_HEAD=a4ff12ec88bc99d8efa0cf98328cd7c453fd03a6` / `TASK_6_BUILD_PENDING` / `AGGREGATE_HARNESS_PENDING_SINGLE_RUN` / `NOT_PUSHED`。下一停止点：以该提交 HEAD 为身份运行任务书规定的 Core、authoring、CLI、Renderer、editor 五个 build；全部通过后才允许运行唯一一次新的聚合路径。

### Third Task 8 failure closure — Task 6 submitted-head builds completed (2026-08-13 23:50–23:51 +08:00)

- 基于已提交 `CODE_EVIDENCE_HEAD=a4ff12ec88bc99d8efa0cf98328cd7c453fd03a6` 实际运行并全部通过：`npm run build -w @surdet/core` exit=`0`；`npm run build -w @surdet/authoring` exit=`0`；`npm run build -w @surdet/cli` exit=`0`；`npm run build -w @surdet/renderer` exit=`0`；`npm run build -w surdet-editor` exit=`0`。
- editor 构建实际为 Vite `6.4.3`、`867 modules transformed`，`preview-o7BB25T4.js`=`594.54 kB`、gzip=`175.92 kB`；保留既有大 chunk warning，未修改性能门限。构建没有产生 tracked 源码变化；没有运行 verify:all、性能矩阵、pack、electron-builder、多轮 Electron 或人工验收。
- 构建后真实 Git 仍为 `HEAD=a4ff12ec88bc99d8efa0cf98328cd7c453fd03a6`；tracked 工作树仅有本计划本条 Ledger 修改，暂存区为空；`git diff --check`、`git diff --cached --check` 无错误；`git ls-files '*.log'` 无输出。当前状态：`TASK_6_BUILD_GREEN` / `CODE_EVIDENCE_HEAD=a4ff12ec88bc99d8efa0cf98328cd7c453fd03a6` / `AGGREGATE_HARNESS_READY_SINGLE_RUN` / `NOT_PUSHED`。下一停止点：只运行一次新的 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`；必须使用全新 fixture/artifact，失败则保留并回读新 FAILED artifact 后停止，不修改、不重跑。

### Third Task 8 failure closure — Task 7 single aggregate failed at editor preview server (2026-08-13 23:51–23:52 +08:00)

- 已按授权只运行一次 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，exit=`1`；runner 使用全新桌面 fixture `<local-path>` 和全新 artifact `<local-path>`，没有复用、删除或覆盖此前三份 FAILED artifact/fixture，没有重跑、挑绿或修改代码。
- 新 artifact 已从磁盘重新读取：`status=FAILED`；`bytes=6930`；SHA-256=`CF88B5F74C04C48207A9EBC25CFD316DB5AC1128B37DD484A66CE16DF73A89E3`；`runHead=a4ff12ec88bc99d8efa0cf98328cd7c453fd03a6`，与本轮 Task 5 的 `CODE_EVIDENCE_HEAD` 完全一致；`projectRevision=43dead89a25afb8134db105ebf2f11b8523aca2b9c4c69f53ef05e7d22f1a39c`；`changeId=chg_0001`；`workingRevision=0`；`redEvidenceId=validation_1786636300831_bfea1cbc-46b1-4ff0-9f3f-40f89cd2d349`；`greenEvidenceId=validation_1786636301373_d2272eb0-af32-44e6-ba3e-8377f4423ab8`；CLI `traceIds` 为 `trace_1786636301812_830f00b5-f6b2-4bf6-9751-9d30e368c466` 与 `trace_1786636302005_65fdfcf9-7f62-412e-81f6-3e59a491a7f6`；`choiceCoverage=2/2`；`stateOutcomes=[-1,1]`；正式 editor `traceIds=[]`、`preview=null`。
- 最后一个通过节点为 `change.commit`；首个失败节点为 `editor.preview.server`。失败真实错误是 runner 发现 `127.0.0.1:4173` 已有可访问服务，拒绝占用或关闭：`127.0.0.1:4173 已有可访问服务，拒绝占用或关闭现有进程：http://127.0.0.1:4173/preview.html`。只读端口检查确认监听 PID=`45380`；没有关闭、杀死或修改该现有服务。由于正式 preview 尚未启动，本轮没有 Core/Presentation editor trace、画面证据或人工验收结论。
- 新 fixture 已从磁盘重新读取为 `21` 个文件，`content/scenario` 已存在且没有 `.surdet-*` 临时文件；提交后 `content/scenario/agent_support.gal` 为 `60` bytes、SHA-256=`F79C9B2A8305E2C208A9C7485ACE23599983C75FB4B6A0AE3CF85AE0E8167CD9`；`game.config.json` 为 `1619` bytes、SHA-256=`BE77454A4A928C1ABC042BE531B29619667AB9F4ACE169467FDF71FB2A63F92B`。artifact `treeHashes.afterCommit=bd00fcaefc697e4931665566b7c916a1a80dc4e820d85de294ff82b67cedd441`；提交前各树哈希均为 `6f414fa1280b75a43436e5fa2a92527dd0ff7e56391a551b42258a05effab08a`。这直接证明本轮 NodeProjectStorage 缺失父目录已进入真实聚合 `change.commit` 并完成写盘，但不能把整个 Stage 6 纵向路径写成通过。
- artifact `errors` 只包含上述 preview server 错误；`errorChannels.pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 均为空，`unexpectedWindowClosed=false`，但这些不是 preview 通过证据，因为 preview 尚未启动。原始 Starter 仍未变化：`game.config.json` `1623` bytes / SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4` / Git blob=`86ad869719dbb3cfcc065ced9c637a49b3ce6179`；`content/scenario/ch01_01.gal` `1035` bytes / SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0` / Git blob=`50b253ef3b683b4d848d7795b8142ab72fd7a690`。前三份 FAILED artifact 复核身份保持不变：`6513/A9CE9274...`、`6696/BB5593...`、`7000/454DA0...`，均未覆盖。
- 本轮不进入原 Task 8 Step 8、不运行 Task 9、不创建 Stage 6 Wave 1 交付报告、不邀请项目所有者人工验收，不修改 runner 或任何生产逻辑。当前真实 Git：branch=`main`；`HEAD=a4ff12ec88bc99d8efa0cf98328cd7c453fd03a6`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`23 0`；tracked 工作树仅有本计划本条 Ledger 修改，暂存区为空；`git diff --check`、`git diff --cached --check` 无错误；`git ls-files '*.log'` 无输出；未 push。
- 当前停止状态：`TASK_7_AGGREGATE_FAILED_AT_EDITOR_PREVIEW_SERVER` / `NODE_PROJECT_STORAGE_COMMIT_REACHED` / `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。下一停止点：只提交本条任务书失败收口记录，等待总经理独立复审；不重跑、不关闭现有 4173 服务、不扩展到其他主题。

### Fourth Task 8 failure closure — precise Stage 5 preview shutdown and single retry failed at iframe load (2026-08-14 00:08–00:15 +08:00)

- 本轮授权动作严格限定为：确认并关闭已经独立确认属于 Stage 5 的旧 Surdet editor preview，然后进行一次新的 Stage 6 Wave 1 聚合尝试；没有修改 NodeProjectStorage、authoring、Core、Renderer、editor、Shell runner、Zero、Starter、长期路线台账或受保护文件。Task 0 重新读取的真实 Git 基线为：branch=`main`；`HEAD=1bd80f9adf0a7206be2e8fb549496cacc8de0548`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`24 0`；tracked 工作树和暂存区均为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；`git ls-files '*.log'` 无输出。未跟踪集合仍只有既有 AGENTS、受保护文件、handoff/艺术文件和长期路线台账。
- 旧第四份 FAILED artifact 在本轮动作前重新读取且身份未变：`<local-path>`，`bytes=6930`，SHA-256=`CF88B5F74C04C48207A9EBC25CFD316DB5AC1128B37DD484A66CE16DF73A89E3`，`status=FAILED`，`lastPassedNode=change.commit`，`firstFailedNode=editor.preview.server`。前三份 FAILED artifact 也继续保留，未删除、未覆盖、未复用。
- Task 1 只读核对得到六项身份全部一致：监听地址=`127.0.0.1:4173`；PID=`45380`；ParentProcessId=`41680`；创建时间=`2026-08-13 18:46:07`；ExecutablePath=`C:\Program Files\nodejs\node.exe`；命令行明确包含 `E:\surdet\packages\editor`、Vite `preview`、`--host 127.0.0.1`、`--port=4173`。随后只执行一次授权命令 `Stop-Process -Id 45380`，exit=`0`。停止后 PID 不存在、4173 无监听、HTTP 请求被拒绝；剩余 Node 进程为既有 MCP/dsh 进程，没有停止其他 Node/Vite 服务。
- Task 3 实际结果全部 exit=`0`：`node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`；`node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --self-check`（输出 `status=SELF_CHECK_PASSED`，候选 `runHead=1bd80f9adf0a7206be2e8fb549496cacc8de0548`，仅确认唯一候选路径，未创建 fixture/artifact）；`git diff --check`；`git diff --cached --check`；`git ls-files '*.log'`（无输出）。本轮没有重复五工作区 build。
- Task 4 聚合命令 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` 只启动了一次。工具执行窗口报告 `exit=124`，原始命令运行约 `124.1s` 后超时；没有第二次运行、续跑或切换路径。该单次运行已经写出新的 FAILED artifact，不能把工具超时写成通过或把未观测到的 runner 退出码改写成其它值。
- 新 artifact 已从磁盘重新读取：`<local-path>`；`bytes=6796`；SHA-256=`8492595E5FBD2315CD634411224BC2D474E5D6C1AEAA263BD52A81E248D7FEF5`；`status=FAILED`；`runHead=1bd80f9adf0a7206be2e8fb549496cacc8de0548`，与本轮真实 retry HEAD 完全一致；`projectRevision=43dead89a25afb8134db105ebf2f11b8523aca2b9c4c69f53ef05e7d22f1a39c`；`changeId=chg_0001`；`workingRevision=0`；`redEvidenceId=validation_1786637401398_6570e20d-1618-4b3f-a88e-58b018974e96`；`greenEvidenceId=validation_1786637402064_a59b8d6c-5b8c-41fd-8622-10969742058a`；CLI `traceIds` 为 `trace_1786637402521_5a96becd-e7bd-47c8-81ea-b99f68b9b6f5` 和 `trace_1786637402706_91f351e1-5ada-4b84-812d-56beca7f56ae`；editor `traceIds=[]`；`choiceCoverage=2/2`；`stateOutcomes=[-1,1]`；`preview=null`。
- 新聚合最后通过节点为 `editor.preview.server`，首个失败节点为 `editor.preview.renderer.paths.A-B`。artifact 记录的真实错误为 `正式 preview.html iframe 未加载`。因此本轮证明了旧 Stage 5 服务关闭后，新的正式 preview server 已启动并通过了 server 节点，但没有证明正式 `preview.html` iframe、Renderer Presentation、两条 editor 预览路径或画面证据；空的 page/console/request/unhandled/renderer/release error channels 和 `unexpectedWindowClosed=false` 不能替代这些证据。
- 新桌面 fixture 为全新路径 `<local-path>`，磁盘共 `21` 个文件，没有 `.surdet-*` 临时文件。提交后 `content/scenario/agent_support.gal` 为 `60` bytes、SHA-256=`F79C9B2A8305E2C208A9C7485ACE23599983C75FB4B6A0AE3CF85AE0E8167CD9`；`game.config.json` 为 `1619` bytes、SHA-256=`BE77454A4A928C1ABC042BE531B29619667AB9F4ACE169467FDF71FB2A63F92B`。artifact 的初始 fixture tree hash 为 `6f414fa1280b75a43436e5fa2a92527dd0ff7e56391a551b42258a05effab08a`，`afterCommit` 为 `bd00fcaefc697e4931665566b7c916a1a80dc4e820d85de294ff82b67cedd441`；旧 fixture 和旧 artifact 均未复用或覆盖。
- 原始 Starter 本轮重新读取仍未改变：`examples/starter/content/scenario/ch01_01.gal` 为 `1035` bytes、SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`、Git blob=`50b253ef3b683b4d848d7795b8142ab72fd7a690`；`game.config.json` 为 `1623` bytes、SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4`、Git blob=`86ad869719dbb3cfcc065ced9c637a49b3ce6179`，artifact 的 `originalStarter.unchanged=true`。
- 因为执行窗口超时后本轮 runner 仍残留，已根据磁盘读取到的本轮精确命令行只停止 runner PID=`35324`（`Stop-Process -Id 35324`，exit=`0`），再确认其启动的本轮 Vite preview PID=`6172`、命令行为 `E:\surdet\packages\editor` 的 `vite preview --host 127.0.0.1 --port=4173` 后停止该 PID（`Stop-Process -Id 6172`，exit=`0`）。最终复核：PID `35324`/`6172` 均不存在；4173 无监听；`http://127.0.0.1:4173/` 不可访问；没有残留 runner 或本轮 editor preview 进程。
- 本轮没有进入原 Task 8 Step 8、没有运行 Task 9、没有创建 Stage 6 Wave 1 交付报告、没有邀请项目所有者人工验收，也没有运行任何其它聚合路径。当前停止状态：`TASK_8_AGGREGATE_FAILED_AT_EDITOR_PREVIEW_IFRAME` / `EDITOR_PREVIEW_IFRAME_NOT_LOADED` / `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。下一停止点：只提交本条真实任务书失败收口记录，等待总经理独立复审；不修改代码、不重跑、不进入人工验收或 Wave 2。

### Fifth Task 8 failure closure — Task 0 baseline for iframe wait and cleanup fix (2026-08-14 00:31 +08:00)

- 已重新完整读取本轮授权要求、`E:\surdet\AGENTS.md`、长期路线台账、Stage 6 Wave 1 正式设计规格、Stage 5 最新任务书与交付报告、当前 Stage 6 Wave 1 任务书，以及第五次和第四次 FAILED artifact 的原始 JSON。当前唯一主题是 Task 8 runner 的正式 preview iframe 条件等待与失败生命周期清理；不创建子 AI、不并行施工、不修改长期路线台账、不进入 Wave 2、不邀请项目所有者人工验收。
- Task 0 新鲜 Git 基线实际结果：branch=`main`；`HEAD=a355de5e96d00021dd636ca4754d1ec4d244f7a6`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；`git rev-list --left-right --count HEAD...surdet/main`=`25 0`。`git status --short --untracked-files=all` 仅列出既有未跟踪 `AGENTS.md`、受保护文件、handoff/艺术文件和长期路线台账；tracked 工作树与暂存区没有未知修改；`git diff --check`、`git diff --cached --check` 均 exit=`0`；`git ls-files '*.log'` 无输出；最近提交为 `a355de5 docs(authoring): record preview retry failure`。
- Task 0 运行时资源核对：`127.0.0.1:4173` 当前无监听；历史本轮精确清理对象 PID `35324`、`6172` 和 Stage 5 旧 preview PID `45380` 均不存在；没有发现需要关闭的未知 4173 服务。五份历史 FAILED artifact 均存在且未覆盖：`yTB3Ek`=`6513` bytes / `A9CE9274C80C2DE38579FFA5951DAF2EA33241EA8196F35F907306A45A166D08` / last=`change.write-operations-before-red` / first=`project.validate.red`；`0DWIaf`=`6696` / `BB5593ECC024499EEBCB492FCA601F2CFA6F5DC4185F121F1532C7513FE0CD36` / last=`project.simulate-2-of-2` / first=`runtime.run-from.A-and-B`；`O8WYtZ`=`7000` / `454DA0A408C00DB559339DCE052AF901BEFAD39B2DB3CCB09C192D8EA432413D` / last=`change.diff` / first=`change.commit`；`19zWJG`=`6930` / `CF88B5F74C04C48207A9EBC25CFD316DB5AC1128B37DD484A66CE16DF73A89E3` / last=`change.commit` / first=`editor.preview.server`；`rSVS8l`=`6796` / `8492595E5FBD2315CD634411224BC2D474E5D6C1AEAA263BD52A81E248D7FEF5` / last=`editor.preview.server` / first=`editor.preview.renderer.paths.A-B`。
- 第五次失败的固定证据保持：正式 preview 在隔离诊断中可加载，但 runner 的一次性 `page.frames().find(...)` 在 iframe 尚为 `about:blank`/空 URL 时误判；失败发生在 browser 创建后，现有清理也未可靠关闭 browser 或等待 npm 包装的 Vite 子进程退出。该事实作为本轮红灯基础，不重新运行聚合路径重造失败。当前状态：`TASK_0_BASELINE_REESTABLISHED` / `HARNESS_IFRAME_WAIT_RACE_CONFIRMED` / `HARNESS_FAILURE_CLEANUP_LEAK_CONFIRMED` / `TASK_1_LEDGER_RECORDED` / `NOT_PUSHED`。下一停止点：只读检查 runner 的 preview、spawn、artifact 和 finally 代码，随后实现任务书授权的最小 helper 与清理修正。

### Fifth Task 8 failure closure — Tasks 1–3 focused harness checks (2026-08-14 00:31–00:42 +08:00)

- Task 1 的既有第五次 FAILED artifact 已作为本轮红灯证据，不重新运行正式聚合重造失败。只读源码确认第一失败点是 `runFormalPreview()` 对 `page.frames().find(frame.url().endsWith('/preview.html'))` 的一次性查找；独立失败证据还确认 browser 和 npm 包装 Vite 子进程的失败生命周期未可靠收口。
- Task 2 只修改 `packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`：新增 `waitForFormalPreviewFrame(page, timeoutMs)`，按 iframe attached → `contentFrame()` → URL pathname 精确 `/preview.html` → canvas → `surdet-preview-ready` 顺序使用 Playwright 条件等待；正式路径只使用该 helper，不直接打开 preview 页面、不放宽 Presentation 断言、不使用一次性 `page.frames().find`。正式 preview 改为当前 Node 直接 spawn 仓库内 `packages/editor/node_modules/vite/bin/vite.js`，端口启动前确认 4173 空闲；runner 保存本轮 child 的 exit/close 事实，browser 与本轮 exact child 由统一 cleanup 拥有，失败时请求终止并等待 close，超时返回包含 PID 的结构化 `PREVIEW_CLEANUP_FAILED`。成功仅在 `editor.preview.manual-entry` 后保留实际 Vite child 供人工入口，未添加 fallback、配置开关、第二状态机或生产逻辑。
- Task 3 新增 `--preview-harness-self-check`，只使用 4174 和仓库外的最小诊断 server，不创建 Stage 6 fixture、正式 artifact、CLI transaction 或占用 4173；父页在 DOMContentLoaded 后延迟约 250ms 设置 iframe src，self-check 直接调用最终 `waitForFormalPreviewFrame`，验证初始空/`about:blank` URL、最终 `/preview.html`、canvas 和 `surdet-preview-ready`。随后在 browser/server 已启动后故意抛出 `PREVIEW_HARNESS_SELF_CHECK_DELIBERATE_FAILURE`，通过同一 cleanup 验证 browser 断开、owned child exit/close、4174 释放和 Node 自然返回。
- 首次实现后的聚焦失败如实保留：`node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` exit=`0`；首次 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --preview-harness-self-check` exit=`1`，真实原因是自检误依赖当时尚不存在的 `packages/editor/dist`，owned preview child 以 `The directory "dist" does not exist` exit=`1` 退出；没有创建 fixture/artifact，也没有运行正式聚合。随后只在 runner 白名单内把 self-check server 改为 4174 上由当前 Node 直接拥有的最小诊断 HTTP child，不改变正式 Vite 路径或断言。
- 修正后的聚焦绿灯实际结果：`node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` exit=`0`；`node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --preview-harness-self-check` exit=`0`，输出 `PREVIEW_HARNESS_SELF_CHECK_PASSED`、`framePathname=/preview.html`、`delayedNavigation=true`、`browserDisconnected=true`、`childExited=true`、`port=4174`；既有 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --self-check` exit=`0`，输出 `SELF_CHECK_PASSED`，仅核对当前 HEAD 和唯一 fixture/artifact 候选，未创建正式 fixture/artifact。
- 聚焦门禁实际结果：`git diff --check` exit=`0`；`git diff --cached --check` exit=`0`；`git ls-files '*.log'` 无输出。完成后 `127.0.0.1:4173`、`127.0.0.1:4174` 均无监听；本轮 runner/Vite/Playwright Chromium 无残留；五份历史 FAILED artifact 仍分别为 `6513/A9CE9274C80C2DE38579FFA5951DAF2EA33241EA8196F35F907306A45A166D08`、`6696/BB5593ECC024499EEBCB492FCA601F2CFA6F5DC4185F121F1532C7513FE0CD36`、`7000/454DA0A408C00DB559339DCE052AF901BEFAD39B2DB3CCB09C192D8EA432413D`、`6930/CF88B5F74C04C48207A9EBC25CFD316DB5AC1128B37DD484A66CE16DF73A89E3`、`6796/8492595E5FBD2315CD634411224BC2D474E5D6C1AEAA263BD52A81E248D7FEF5`，均未删除、覆盖或复用。
- 本轮截至此处没有运行五工作区构建或正式聚合 harness，没有生成新的正式 artifact/fixture，没有修改 Core、Renderer、Host、CLI、authoring、editor、Zero、Starter、长期路线台账或受保护文件。当前状态：`TASK_3_FOCUSED_GREEN` / `FORMAL_IFRAME_CONDITION_WAIT_VERIFIED` / `FAILURE_BROWSER_AND_CHILD_CLEANUP_VERIFIED` / `TASK_4_COMMIT_PENDING` / `NOT_PUSHED`。下一停止点：只精确暂存 runner 与当前任务书，核对 cached check/name-status 后创建授权的普通本地提交；提交前不运行正式聚合。

### Fifth Task 8 failure closure — Task 4 runner evidence commit completed (2026-08-14 00:43 +08:00)

- 已精确暂存并核对：`git diff --cached --name-status` 仅为 `M docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md` 与 `M packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`；`git diff --cached --check` exit=`0`；`git diff --check` exit=`0`。没有夹带长期路线台账、AGENTS、受保护文件、handoff、fixture、artifact、日志或构建产物。
- 已创建普通本地提交：`git log --oneline -1`=`d193ad7 test(authoring): wait for formal preview iframe`；提交后重新读取的真实 `HEAD=d193ad790ac7f60202f6489e4773edb05c52579c`；`git show --name-status HEAD` 仅显示上述两个文件。该提交为新的 `RUNNER_EVIDENCE_HEAD`；没有 amend、rebase、squash 或 push。
- 提交后真实 Git：branch=`main`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`26 0`；tracked 工作树和暂存区均为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；`git ls-files '*.log'` 无输出；已知未跟踪治理/交接文件仍未触碰。当前状态：`TASK_4_RUNNER_EVIDENCE_COMMITTED` / `RUNNER_EVIDENCE_HEAD=d193ad790ac7f60202f6489e4773edb05c52579c` / `TASK_5_SUBMITTED_HEAD_CHECKS_PENDING` / `NOT_PUSHED`。下一停止点：基于该真实 HEAD 重新运行 node check、既有 self-check、新 preview harness self-check，再按顺序运行五个指定 workspace build；全部通过前不运行正式聚合。

### Fifth Task 8 failure closure — Task 5 submitted-head checks and builds completed (2026-08-14 00:44–00:47 +08:00)

- 基于已提交 `RUNNER_EVIDENCE_HEAD=d193ad790ac7f60202f6489e4773edb05c52579c` 重新运行并通过：`node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` exit=`0`；`node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --self-check` exit=`0`，输出 `SELF_CHECK_PASSED` 且 runHead 等于 `d193ad790ac7f60202f6489e4773edb05c52579c`；`node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --preview-harness-self-check` exit=`0`，输出 `PREVIEW_HARNESS_SELF_CHECK_PASSED`、延迟 iframe `/preview.html`、canvas、ready、browser disconnect、child exit/close 和 4174 cleanup 事实。三项均未创建正式 fixture 或 artifact。
- 五个受影响工作区构建按任务书串行运行并全部 exit=`0`：`npm run build -w @surdet/core`；`npm run build -w @surdet/authoring`；`npm run build -w @surdet/cli`；`npm run build -w @surdet/renderer`；`npm run build -w surdet-editor`。editor build 为 Vite `6.4.3`、`867 modules transformed`，`preview.html`=`0.76 kB`，preview chunk=`594.54 kB`、gzip=`175.92 kB`；既有大 chunk warning 原样保留，不修改性能门限。没有运行 `verify:all`、性能矩阵、pack、electron-builder 或多轮 Electron。
- 提交后构建没有产生 tracked 代码变更；当前唯一 tracked 在途修改仍是本任务书本条 Execution Ledger，暂存区为空；本轮代码提交身份保持 `HEAD=d193ad790ac7f60202f6489e4773edb05c52579c`，远端 `surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`，ahead/behind=`26 0`。正式聚合运行前下一次只读核对确认 4173/4174 无监听、没有本轮 runner/Vite/Chromium 残留，旧五份 FAILED artifact 身份不变。
- 当前状态：`TASK_5_SUBMITTED_HEAD_CHECKS_GREEN` / `FIVE_WORKSPACE_BUILDS_GREEN` / `RUNNER_EVIDENCE_HEAD=d193ad790ac7f60202f6489e4773edb05c52579c` / `TASK_6_SINGLE_AGGREGATE_AUTHORIZED` / `NOT_PUSHED`。下一停止点：确认端口、进程、旧 artifact 与 Starter 身份后，只运行一次新的正式聚合路径；成功才进入原 Task 8 Step 8/9，失败则保留新 artifact、记录首个失败并停止，不重跑。

### Fifth Task 8 failure closure — Task 6 single aggregate failed at formal preview server (2026-08-14 00:47 +08:00)

- 按授权只运行一次正式命令 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，工具实际 exit=`1`；没有重跑、续跑、切换 case、修改 runner 或修改生产逻辑。新的唯一桌面 fixture 为 `<local-path>`；新的唯一 FAILED artifact 为 `<local-path>`。
- 新 artifact 已从磁盘重新读取：`bytes=7069`；SHA-256=`C22C3A8895B313CAADE3F7D52D131D831E080E0822A4F39BC033A4F44C5DB8BE`；`status=FAILED`；`runHead=d193ad790ac7f60202f6489e4773edb05c52579c`，与 Task 4 提交后的 `RUNNER_EVIDENCE_HEAD` 完全一致；`projectRevision=43dead89a25afb8134db105ebf2f11b8523aca2b9c4c69f53ef05e7d22f1a39c`；`changeId=chg_0001`；`workingRevision=0`；`redEvidenceId=validation_1786639519311_267d6425-fe8f-4e0e-9a27-351689544129`；`greenEvidenceId=validation_1786639519797_95dfa270-d5f1-4d6d-ae7a-7e8e07f889a1`；CLI `traceIds`=`trace_1786639520142_e5b59022-41ae-4593-9ba4-9b1a9e10f196`、`trace_1786639520306_7f3b5987-1131-428a-95c8-5e4afa55fead`；editor `traceIds=[]`；`choiceCoverage=2/2`；`stateOutcomes=[-1,1]`；`preview=null`。
- 最后通过节点为 `change.commit`；首个失败节点为 `editor.preview.server`。真实错误为：正式 runner 直接 spawn Vite CLI 时把工作目录设为仓库根，Vite 按当前目录查找 `dist`，返回 `The directory "dist" does not exist. Did you build your project?` 并 exit=`1`。这是当前 runner 的工作目录接线错误；正式 editor preview/Renderer Presentation 尚未启动，因此不能归因于 editor、Renderer 或 Core，也不能宣称 iframe 等待修正已经通过正式路径。按授权本轮不再修改或重跑。
- 新 fixture 从磁盘复核为 `21` 个文件，`content/scenario` 已存在且没有 `.surdet-*` 临时文件；artifact `treeHashes.beforeBegin`、`afterBegin`、`afterSceneCreateBeforeRed`、`afterRedValidation`、`afterGreenValidation`、`afterDiff` 均为 `6f414fa1280b75a43436e5fa2a92527dd0ff7e56391a551b42258a05effab08a`，`afterCommit=bd00fcaefc697e4931665566b7c916a1a80dc4e820d85de294ff82b67cedd441`。这证明事务/选择 effect/Node 存储已到达本轮 `change.commit`，但不证明正式 preview。
- artifact 的错误通道 `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 均为空，`unexpectedWindowClosed=false`；由于 preview 尚未启动，这些不是 Presentation 通过证据。新 artifact 与本次新 fixture 均保留，不删除、不覆盖、不复用；五份历史 FAILED artifact 身份保持不变。原始 Starter 仍未改变：`game.config.json`=`1623` bytes / SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4`；`content/scenario/ch01_01.gal`=`1035` bytes / SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`。
- 失败后清理复核：4173、4174 均无监听；本轮 runner、Vite child 和 Playwright Chromium 无残留；没有执行任何外部 Stop-Process。任务书仍只存在本条计划未提交修改，runner 提交 `d193ad790ac7f60202f6489e4773edb05c52579c` 未改写；当前 HEAD=`d193ad790ac7f60202f6489e4773edb05c52579c`，`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`，ahead/behind=`26 0`；tracked 工作树只有本任务书 Ledger，暂存区为空；`git diff --check`、`git diff --cached --check` exit=`0`；`git ls-files '*.log'` 无输出。
- 本轮没有进入原 Task 8 Step 8、没有运行 Task 9、没有创建 Stage 6 Wave 1 交付报告、没有邀请项目所有者人工验收，不进入 Wave 2。当前停止状态：`TASK_6_AGGREGATE_FAILED_AT_EDITOR_PREVIEW_SERVER` / `FORMAL_PREVIEW_NOT_REACHED` / `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。下一停止点：只提交本条失败收口计划记录，等待独立复审；不修改 runner、不重跑聚合、不扩展主题。

### Task 8 bounded harness diagnostic stabilization — DIAGNOSTIC 全绿，FORMAL 待提交后唯一运行（2026-08-14 01:13 +08:00）

- 本轮重新建立的真实基线为：branch=`main`；`HEAD=01def6d4f2d508eb452bb1ecb1a5866a8bc5eaeb`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`27 0`。开始施工前 tracked 工作树与暂存区均无在途修改；`git diff --check` exit=`0`；`git diff --cached --check` exit=`0`；`git ls-files '*.log'` 无输出。长期路线台账、AGENTS、受保护文件、handoff、历史 artifact/fixture 均未修改、未暂存、未提交。六份历史正式 FAILED artifact 均保留，未删除、覆盖或复用。
- 本轮严格只修改 `packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` 与本任务书 Execution Ledger；没有修改 Core、Renderer、Host、editor 生产代码、authoring、CLI、Zero、Starter、长期路线台账或受保护文件。诊断与正式证据明确分离：本轮尚未运行 FORMAL 聚合；所有以下运行均使用新隔离 fixture、新 artifact，artifact 明确写入 `evidenceClass=DIAGNOSTIC`。
- Diagnostic 1 实际命令 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --diagnostic` exit=`1`。新 artifact=`<local-path>`；从磁盘读取 `bytes=7130`、SHA-256=`68D58D5E9682834F2F5CE3172F77BEB0CCEE347A32FEE091044132BDF2F9E0CC`、`evidenceClass=DIAGNOSTIC`、`runHead=01def6d4f2d508eb452bb1ecb1a5866a8bc5eaeb`、fixture=`<local-path>`。最后通过节点=`editor.preview.server`；首个失败节点=`editor.preview.renderer.paths.A-B`；真实错误为选择后公开 Renderer 已进入 `awaiting`，runner 却在发送下一次真实输入前等待 `surdet-preview-trace-complete`，导致等待超时。artifact 记录 browser 已关闭、Vite child exit/close 已观察、4173/4174 均释放。
- Diagnostic 2 实际命令同上 exit=`1`。新 artifact=`<local-path>`；从磁盘读取 `bytes=7127`、SHA-256=`3f187e335e358a086f8015dd52463c5c2737086d31bc59f13853ef32465d36a9`、`evidenceClass=DIAGNOSTIC`、`runHead=01def6d4f2d508eb452bb1ecb1a5866a8bc5eaeb`、fixture=`<local-path>`。最后通过节点=`editor.preview.server`；首个失败节点=`editor.preview.renderer.paths.A-B`；真实错误为 A 分支没有 `presentationApplied=true`。只读证据显示 runner fixture 没有改变公开 Presentation snapshot 的场景指令；随后仅在 runner fixture 构造中复用 Starter 已有 `night_field` 资源加入公开 `@bg` instruction，没有修改生产逻辑。artifact 记录 browser、Vite child 和两端口均已清理。
- Diagnostic 3 实际命令同上 exit=`0`，为本轮唯一完整 DIAGNOSTIC 全绿。新 artifact=`<local-path>`；从磁盘读取 `bytes=7592`、SHA-256=`68E53EF08185CEE9F4C1E9195B45C63DBCB8195ADD0C08DEB539A52DAE20642A`；`status=PASSED`；`evidenceClass=DIAGNOSTIC`；`runHead=01def6d4f2d508eb452bb1ecb1a5866a8bc5eaeb`；`projectRevision=43dead89a25afb8134db105ebf2f11b8523aca2b9c4c69f53ef05e7d22f1a39c`；`changeId=chg_0001`；`workingRevision=0`；`redEvidenceId=validation_1786640948916_987d6bef-5840-49e7-9e14-7bfb0627be5d`；`greenEvidenceId=validation_1786640949529_9efcc703-bd53-42e2-8f0e-eb61da11496e`。CLI traceIds=`trace_1786640949881_21895d84-9d58-4d35-a542-506314becd5e`、`trace_1786640950048_fcb170d9-684d-4b0b-8e51-0015c2c90942`；正式 preview traceIds=`preview-1786640951987-5978602b-8ba4-4b5b-a749-c55068dbba1f`、`preview-1786640952459-98e08d8f-c416-4e2b-ba90-c5108f88a8dd`；choice coverage=`2/2`；stateOutcomes=`[-1,1]`。A 分支通过真实键盘输入得到可见文本 `Agent 路径 A 后续台词。`、trust=`1`；B 分支通过真实鼠标点击第二个 choice 得到可见文本 `Agent 路径 B 后续台词。`、trust=`-1`；两条路径均有正式 Presentation 应用证据。`pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 均为 `[]`；`unexpectedWindowClosed=false`；`resourceCleanup.browserClosed=true`、`previewChildExitObserved=true`、`previewChildCloseObserved=true`、`previewServerReleased=true`、`previewServerRetained=false`、`previewPortFree=true`、`harnessSelfCheckPortFree=true`。最后通过节点=`editor.preview.manual-entry`，首个失败节点为空。
- Diagnostic 3 fixture=`<local-path>`。从磁盘重新读取的关键身份：`content/scenario/agent_support.gal`=`60` bytes / SHA-256=`F79C9B2A8305E2C208A9C7485ACE23599983C75FB4B6A0AE3CF85AE0E8167CD9`；`content/scenario/ch01_01.gal`=`270` bytes / SHA-256=`7F8661943B2A13D397A2D84EB848E4D36D0949A8B8C0A39220EC70036B90D794`；`game.config.json`=`1619` bytes / SHA-256=`BE77454A4A928C1ABC042BE531B29619667AB9F4ACE169467FDF71FB2A63F92B`；fixture tree SHA-256=`F1FAAE3691476879280FF0B5875F2DA42746A4862B6A6C2C12BBF1D2F6371973`，afterCommit 相同。原始 `examples/starter` 未变化：`game.config.json`=`1623` bytes / SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4`；`content/scenario/ch01_01.gal`=`1035` bytes / SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`。
- DIAGNOSTIC 全绿后实际运行并通过：`node --check packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` exit=`0`；`node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs --preview-harness-self-check` exit=`0`，输出 `PREVIEW_HARNESS_SELF_CHECK_PASSED`、`framePathname=/preview.html`、`delayedNavigation=true`、`browserDisconnected=true`、`childExited=true`、`port=4174`，且该入口复用了正式 Vite launcher、`packages/editor` cwd 与 `packages/editor/dist/preview.html`；`npm run build -w surdet-editor` exit=`0`；聚焦 preview contract tests `preview-causal-trace.test.ts`、`preview-runtime-contract.test.ts`、`preview-runtime-lifecycle.test.ts` 共 `3` files / `4` tests 全部通过；`npm run typecheck -w surdet-editor` exit=`0`；`git diff --check` exit=`0`。editor build 的既有大 chunk warning 被原样保留，没有修改性能门限。
- 诊断结束后只读资源复核确认 `127.0.0.1:4173`、`127.0.0.1:4174` 均无监听；本轮 runner、Vite child、Playwright Chromium 无残留。三次 DIAGNOSTIC 均使用唯一 fixture/artifact；失败证据保留，未覆盖任何历史正式 FAILED artifact。当前状态为：`DIAGNOSTIC_HARNESS_STABLE` / `FORMAL_NOT_YET_RUN` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。
- 本条 Ledger 与 runner 一并精确暂存；下一步仅执行 `git diff --cached --check`、`git diff --cached --name-status`，确认暂存区只有上述两个文件后创建普通本地提交 `test(authoring): stabilize preview diagnostic harness`。提交后必须立即重新读取真实 `git log --oneline -1`、`git rev-parse HEAD`、`git show --name-status HEAD`，将该 HEAD 作为新的 `CODE_EVIDENCE_HEAD`；不得 amend、rebase、squash 或 push。提交成功后才允许创建全新 FORMAL fixture/artifact，并只运行一次正式聚合；在此之前不运行 FORMAL。

### Task 8/9 formal closure — FORMAL 通过，Task 9 verify:all 在 Starter typecheck 阻断（2026-08-14 01:26 +08:00）

- 基于 `CODE_EVIDENCE_HEAD=b9d9703e1c442cb927b59fd53026638a4345680d`，唯一一次正式命令 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs` exit=`0`。新的 FORMAL artifact 为 `<local-path>`；从磁盘重新读取 `bytes=7591`、SHA-256=`77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0`、`status=PASSED`、`evidenceClass=FORMAL`、`runHead=b9d9703e1c442cb927b59fd53026638a4345680d`。`redEvidenceId=validation_1786641372228_70db929f-3567-409d-9571-fe9c7dad2cda`；`greenEvidenceId=validation_1786641372763_6f3bfc3a-35a5-4a31-a36e-a3dcb291e882`；preview traceIds=`preview-1786641375189-9f24e3ca-32d8-45df-8f97-ea102cd45670`、`preview-1786641375591-79cda540-8a7a-4e49-a6e6-251bf22060d4`；CLI traceIds=`trace_1786641373123_3e3e4549-644a-4170-a365-4a41ccf26f49`、`trace_1786641373284_ed70f639-5f28-437b-9f9a-0ffeb4ec0e08`；`choiceCoverage=2/2`；`stateOutcomes=[-1,1]`。A 使用真实键盘得到可见 `Agent 路径 A 后续台词。`、trust=`1`；B 使用真实鼠标得到可见 `Agent 路径 B 后续台词。`、trust=`-1`。runner 在 PASSED 前断言 Core runtime trace、`coreEmitted=true` 和同一演出的 `presentationApplied=true`；六项错误通道为空，`unexpectedWindowClosed=false`。
- FORMAL fixture 为 `<local-path>`，fixture tree SHA-256=`F1FAAE3691476879280FF0B5875F2DA42746A4862B6A6C2C12BBF1D2F6371973`。从磁盘重新读取 `content/scenario/ch01_01.gal`=`270` bytes / SHA-256=`7F8661943B2A13D397A2D84EB848E4D36D0949A8B8C0A39220EC70036B90D794`；`game.config.json`=`1619` bytes / SHA-256=`BE77454A4A928C1ABC042BE531B29619667AB9F4ACE169467FDF71FB2A63F92B`。原始 Starter 仍未修改：scenario=`1035` bytes / SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`；config=`1623` bytes / SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4`；artifact `originalStarter.unchanged=true`。此前六份正式 FAILED artifact 与本轮三份 DIAGNOSTIC artifact 均保留，未覆盖、删除或复用。
- FORMAL artifact 的成功清理字段为 `browserClosed=true`、`previewServerRetained=true`、`harnessSelfCheckPortFree=true`、`previewPortFree=false`。runner 退出后的只读检查发现 retained child 实际已退出、4173 已释放；没有把 artifact 字段写成仍存活的进程事实。随后按 Task 8 Step 8 执行 `npm run preview -w surdet-editor -- --host 127.0.0.1 --port 4173`，实际 listener PID=`36436`，URL=`http://127.0.0.1:4173/preview.html`，HTTP=`200`，页面标题=`Surdet 预览`，命令行指向 `E:\surdet\packages\editor\node_modules\vite\bin\vite.js preview --host 127.0.0.1 --port 4173`。该入口仅供项目所有者人工验收准备，不是人工通过证据。
- Task 9 Step 1 已实际运行且全部 exit=`0`：Core=`24 files/317 tests`；authoring=`10/16`；CLI=`11/103`；editor=`24/147`；Renderer=`49/406`；Shell=`20/156`。Task 9 Step 2 的 14 个实际 npm 子命令（Core、authoring、CLI、Renderer、Host、Shell、editor 各 typecheck/build）均 exit=`0`；外层 PowerShell 编排器另有 `$args` 保留变量造成的数组索引警告，不是 npm 子命令失败。
- Task 9 Step 3 只运行一次 `npm run verify:all`，真实 exit=`1`。`verify:tools`、Renderer boundaries/legacy、docs、hygiene 通过；首个失败节点=`verify:types` 的 `examples/starter` typecheck，真实错误为 `src/main.ts(394,33)` 的 save bridge 缺少 `listBackupMeta`、`restoreBackup`，不匹配 `ElectronSaveBridge`。本轮没有修改 Starter、Shell 生产代码或 save bridge，没有放宽断言，没有重跑。该失败属于当前最终全仓门禁阻断，不得把 Task 9 全仓验证写成通过。
- Task 9 Step 4–6 已完成：交付报告已创建为 `docs/AUTHORING-AGENT-READY-VERTICAL-SLICE-STAGE-6-WAVE-1-DELIVERY-REPORT-2026-08-13.md`；创建后从磁盘读取 `bytes=15244`、SHA-256=`44A8FC771AD7EB39789F9B9C73D231E02B17B9343AA321D50A3D5D410BFB47A8`。报告区分 FORMAL 自动化事实、verify:all 失败、人工验收未开始、强制 16 步提醒和未解决问题。追加本条前任务书从磁盘读取 `bytes=172302`、SHA-256=`085287AA31113BC0B9AEB22BBB5FFCB731AD09CDF02B265BFA01466E7DA6E518`；追加本条后任务书身份必须在提交前再次从磁盘读取，不把自记录前哈希冒写成最终哈希。
- 当前真实 Git（文档提交前）：branch=`main`；`HEAD=b9d9703e1c442cb927b59fd53026638a4345680d`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`28 0`；tracked 在途文件为本任务书和新交付报告，暂存区为空；`git diff --check` exit=`0`；`git diff --cached --check` exit=`0`；`git ls-files '*.log'` 无输出。下一步只精确暂存上述两个文档，核对 cached 范围后创建普通文档提交 `docs(authoring): report stage 6 wave 1 delivery`；不暂存 fixture、artifact、日志、构建产物、长期路线台账、AGENTS、受保护文件或 handoff，不 push。
 - 当前停止状态：`STAGE_6_WAVE_1_IMPLEMENTED_LOCALLY` / `FORMAL_AGGREGATE_PASSED` / `TASK_9_VERIFY_ALL_BLOCKED_AT_STARTER_TYPECHECK` / `READY_FOR_INDEPENDENT_MANAGER_REVIEW` / `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED_AFTER_STAGE_6_WAVE_1` / `STAGE_6_WAVE_2_NOT_STARTED`。总经理独立复审前不邀请项目所有者验收，不进入 Wave 2，不对 Starter 类型边界自行修复。

### Starter save bridge declaration and Task 9 verify:all retry — stopped at starter simulation (2026-08-14 01:41 +08:00)

- 本轮是总经理批准的单一低风险收口主题。Task 0 重新读取 `E:\surdet\AGENTS.md`、长期路线台账、当前 Stage 6 Wave 1 任务书和交付报告；真实 Git 基线为：branch=`main`；`HEAD=b88d45a2b8af0d59bd79a5de82983de04cd710d0`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`29 0`。tracked 工作树没有未知修改，暂存区为空；既有未跟踪治理文件、受保护文件、handoff 和长期路线台账均未触碰；4173 listener 为 PID=`36436`，本轮未停止、未重启。
- 修改前只运行一次 `npm run typecheck -w surdet-starter`，exit=`1`；真实红灯为 `examples/starter/src/main.ts(394,33)` 的 `ElectronSaveBridge` 缺少 `listBackupMeta`、`restoreBackup`。
- 最小修正只修改 `examples/starter/src/surdet-window.d.ts`，复用已有 `SaveSlotMeta`，补充 `listBackupMeta(): Promise<SaveSlotMeta[]>` 与 `restoreBackup(slot: string): Promise<void>`；没有修改 Starter runtime/main.ts、内容、配置、资产、Shell runtime 或 `createElectronSaveStorage`，没有增加 fallback、兼容层、类型断言或 `any`。
- 修正后 `npm run typecheck -w surdet-starter` exit=`0`。
- 沿用当前 4173 服务完成只读人工入口地址核对：`http://127.0.0.1:4173/` 返回 HTTP `200`、标题=`Surdet 剧本编辑器`；`http://127.0.0.1:4173/preview.html` 返回 HTTP `200`、标题=`Surdet 预览`。FORMAL runner 使用 `/preview.html`；项目所有者的 16 步人工验收必须从 editor 根地址 `/` 开始，`/preview.html` 不是完整编辑器人工验收入口；人工状态仍为 `HUMAN_ACCEPTANCE_NOT_STARTED`，执行 AI 未代填结果。
- 按本轮授权只重新运行一次 `npm run verify:all`，真实 exit=`1`。`verify:tools`、Renderer boundaries/legacy、docs、hygiene、`verify:types`（含 Starter typecheck）、`verify:tests` 和 `verify:starter-lint` 均通过；最后一个通过节点=`verify:starter-lint`，第一个失败节点=`verify:starter-simulate`。真实输出显示 `examples/starter` 的 `ch02.gal:14:1` 在 `@exp` 处需要宿主注入 `GrowthSystem`，命令因此停止；没有重跑、没有切换 case、没有修改其它文件，也没有把该失败归因于本次声明修正。
- 既有 FORMAL artifact 身份保持不变：`<local-path>`，`bytes=7591`，SHA-256=`77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0`，`status=PASSED`，`evidenceClass=FORMAL`，`runHead=b9d9703e1c442cb927b59fd53026638a4345680d`；本轮未重跑、未覆盖、未修改该 artifact 或任何历史失败 evidence/fixture。
- 本条完成时真实 Git：tracked 在途文件为 `examples/starter/src/surdet-window.d.ts`、本计划和交付报告；暂存区为空；`git diff --check` 与 `git diff --cached --check` 均 exit=`0`；`git ls-files '*.log'` 无输出；4173 listener 仍为 PID=`36436`。当前停止状态：`STAGE_6_WAVE_1_FORMAL_AGGREGATE_PASSED` / `STARTER_SAVE_BRIDGE_DECLARATION_ALIGNED` / `TASK_9_VERIFY_ALL_FAILED_AT_STARTER_SIMULATE` / `READY_FOR_INDEPENDENT_MANAGER_REVIEW` / `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。下一停止点：只精确暂存本轮允许的 Starter 类型声明、本计划和交付报告，创建 `fix(starter): align save bridge declaration` 普通本地提交；不 push、不部署、不打包、不发行、不进入 Wave 2。

### Shared authoring GrowthSystem rollback — Task 0–9 closure before commit (2026-08-14 01:49–02:08 +08:00)

- 本轮重新读取并遵守 `E:\surdet\AGENTS.md`、长期路线台账、Stage 6 设计规格、当前 Stage 6 Wave 1 任务书、Stage 5 最新任务书和 Stage 5 交付报告；长期路线台账保持未跟踪、未修改、未暂存、未提交。当前唯一主题是恢复共享 authoring 模拟运行时的 `GrowthSystem` 接线，不进入其他 Stage 6/Wave 2 主题。
- Task 0 新鲜基线：branch=`main`；`HEAD=43964488196d685c1efe31bfcd4483651b22c12c`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`30 0`；tracked 工作树干净、暂存区为空；既有 `.learnings`、AGENTS、受保护文件、handoff 和长期路线台账均为原有未跟踪文件，未触碰；4173 listener 为 PID=`36436`，未停止或重启。
- 当前真实红灯：只运行一次 `npm run simulate -w surdet-starter`，exit=`1`；`examples/starter/content/scenario/ch02.gal:14:1` 的 `@exp` 报 `需要宿主注入 GrowthSystem（解释器构造参数或 setGrowth）`，重复错误通道如命令输出所示。没有运行 `verify:all` 重造该红灯。
- 最小实现只修改以下七个代码/测试文件：`packages/authoring/src/project-storage.ts`、`packages/authoring/src/project-snapshot.ts`、`packages/authoring/src/simulation.ts`、`packages/authoring/test/project-snapshot.test.ts`、`packages/authoring/test/simulation.test.ts`、`packages/cli/src/simulate.ts`、`packages/cli/test/simulate.test.ts`。快照纳入 `content/config/growth.json` 与 revision；共享 `runtimeFor` 创建并注入 Core `GrowthSystem`；`simulateSnapshot` 与 `runExplicitPath` 共用该运行时；CLI 只读取并传递 growth 配置；无 growth 配置时 `@exp` 仍严格失败。未修改 Core、Renderer、Host、Shell、editor、Zero、Starter 内容/配置/资产、存档格式、FORMAL/DIAGNOSTIC runner 或 artifact。
- authoring 聚焦测试 `npm run test -w @surdet/authoring -- test/project-snapshot.test.ts test/simulation.test.ts` exit=`0`：2 个文件、7 个测试通过。
- CLI 聚焦测试首次在 authoring dist 尚未刷新时 exit=`1`，真实现象是 CLI 读到旧 workspace dist 后仍报告缺少 `GrowthSystem`；随后 `npm run build -w @surdet/authoring` exit=`0`，同一 `npm run test -w @surdet/cli -- test/simulate.test.ts` 重新运行 exit=`0`：1 个文件、8 个测试通过。该首次结果记录为构建接线前置问题，没有通过放宽断言或新增 fallback 处理。
- `npm run typecheck -w @surdet/authoring`、`npm run build -w @surdet/authoring`、`npm run typecheck -w @surdet/cli`、`npm run build -w @surdet/cli` 均实际 exit=`0`。
- `npm run simulate -w surdet-starter` 修复后实际 exit=`0`；正式 Starter 4 场景加载，运行时错误=`0`。`git diff --quiet -- examples/starter` exit=`0`；Starter `content/config/growth.json` 为 `313` bytes / SHA-256=`5470F286FF88F315EA735AA4A7F66FB5C4F04F2AF9A0E72E0BE28A69092BF5A0`，`content/scenario/ch02.gal` 为 `872` bytes / SHA-256=`4B34D54B2F984D19D23BC8688DD50DBF02ADC53359E00DF4B4B7141E8B2E7760`。
- 前置门禁均通过：`npm run verify:formal`、`npm run build -w surdet-editor`、`npm run build -w surdet-starter`、`npm run build -w zero-after-midnight`、`git diff --check` 均 exit=`0`。editor/Starter/Zero 构建仅产生 ignored build output，没有 tracked 源码变化。
- 本轮唯一一次新的 `npm run verify:all` 实际 exit=`0`，通过 `verify:tools`、Renderer boundaries/legacy、docs、hygiene、types、tests、Starter lint/simulate 及其余工作区门禁；没有运行 FORMAL/DIAGNOSTIC 聚合、Electron 矩阵、性能资格化、pack、部署或发行。
- 既有 FORMAL artifact 从磁盘重新读取且身份保持不变：`<local-path>`；`bytes=7591`；SHA-256=`77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0`；`status=PASSED`；`evidenceClass=FORMAL`；`runHead=b9d9703e1c442cb927b59fd53026638a4345680d`。本轮没有重跑、覆盖或修改它，也没有修改任何历史 FAILED/DIAGNOSTIC artifact 或桌面 fixture。
- 本轮报告在追加本条计划记录前从磁盘读取为 `E:\surdet\docs\AUTHORING-AGENT-READY-VERTICAL-SLICE-STAGE-6-WAVE-1-DELIVERY-REPORT-2026-08-13.md`，`bytes=23842`，SHA-256=`88ACD53FE0C6C757DFF491EF5E37313C3B54DBFEF02D8D792B04D4B5B9A5D474`。计划最终字节数/哈希将在本条追加后、提交前重新读取，不引用旧值。
- 当前文档提交前真实状态：tracked 在途文件仅为本计划、本报告和上述七个代码/测试文件；暂存区为空；`git diff --check`=`0`；`git diff --cached --check`=`0`；`git ls-files '*.log'` 无输出；4173 listener PID=`36436`；未 push。当前状态：`STAGE_6_SHARED_GROWTH_SIMULATION_RESTORED` / `STARTER_SIMULATE_PASSED` / `TASK_9_VERIFY_ALL_PASSED` / `FORMAL_AGGREGATE_REMAINS_VALID` / `READY_FOR_INDEPENDENT_MANAGER_REVIEW` / `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。下一停止点：精确暂存本轮七个代码/测试文件、本计划和本报告，核对范围后创建普通本地提交 `fix(authoring): preserve growth simulation semantics`；提交后立即重新读取真实 HEAD、提交文件范围、文档/Starter/artifact 身份和工作树，不 push、不邀请人工验收、不进入 Wave 2。

### Shared authoring GrowthSystem rollback — post-commit closure (2026-08-14 02:09 +08:00)

- 上述九个允许文件已精确暂存并创建普通本地提交；提交后立即回读：`git log --oneline -1`=`d8b20de fix(authoring): preserve growth simulation semantics`；`git rev-parse HEAD`=`d8b20de25d190edcd2c246254bce288a942d888e`；`git rev-parse surdet/main`=`5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`31 0`。
- `git show --name-status HEAD` 只有本轮七个 authoring/CLI 源码与测试文件、当前 Stage 6 Wave 1 任务书和交付报告；没有夹带长期路线台账、AGENTS、受保护文件、handoff、fixture、artifact、日志或构建产物。提交后 tracked 工作树和暂存区均为空；既有未跟踪治理文件保持原样；`git diff --check`=`0`；`git diff --cached --check`=`0`；`git ls-files '*.log'` 无输出。
- 提交后重新读取的既有 FORMAL artifact 仍为 `<local-path>`，`7591` bytes，SHA-256=`77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0`，`status=PASSED`，`evidenceClass=FORMAL`，`runHead=b9d9703e1c442cb927b59fd53026638a4345680d`；Starter `growth.json` 与 `ch02.gal` 身份保持为前条记录的 `313`/`5470F286FF88F315EA735AA4A7F66FB5C4F04F2AF9A0E72E0BE28A69092BF5A0` 和 `872`/`4B34D54B2F984D19D23BC8688DD50DBF02ADC53359E00DF4B4B7141E8B2E7760`。
- 首轮修复提交后、本文档闭合追加前，交付报告为 `23842` bytes / SHA-256=`88ACD53FE0C6C757DFF491EF5E37313C3B54DBFEF02D8D792B04D4B5B9A5D474`，任务书为 `187571` bytes / SHA-256=`E2870F1F7627D58B5656E554DC4AAB1672B67363048B1433AE0E4399F57C6D8B`；本次闭合追加后的交付报告已从磁盘读取为 `25050` bytes / SHA-256=`7198A5031C3A2F405DDE1625E8068D7AEADA9346702FA8EF531905DBF128D03C`。任务书最终文件身份将在本次追加后、提交前重新读取，不引用旧值作为最终值。
- 4173 listener 仍为 PID=`36436`，没有停止或重启；没有重跑任何测试、verify:all、FORMAL/DIAGNOSTIC 聚合或 Electron 路径；没有 push、部署、打包、发行、人工验收或进入 Wave 2。最终状态：`STAGE_6_SHARED_GROWTH_SIMULATION_RESTORED` / `STARTER_SIMULATE_PASSED` / `TASK_9_VERIFY_ALL_PASSED` / `FORMAL_AGGREGATE_REMAINS_VALID` / `READY_FOR_INDEPENDENT_MANAGER_REVIEW` / `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。

### Shared authoring simulation path evidence closure — Task 0–9 verification (2026-08-14 02:26 +08:00)

- 本轮只处理共享 `simulateSnapshot` 的路径计数、状态签名剪枝和 CLI 映射证据；没有重访 GrowthSystem、FORMAL/DIAGNOSTIC、Task 8 runner 或 Wave 2。开始前从磁盘重新确认：branch=`main`；`HEAD=823b19af744d8ea59c5ba640eea0d6b46482624a`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`32 0`；tracked 工作树干净、暂存区为空；4173 listener=`127.0.0.1:4173`, PID=`36436`。长期路线台账、AGENTS、受保护文件、handoff、artifact、fixture 和 Starter 均未修改。
- Task 1 红灯先实际运行一次 `npm run simulate -w surdet-starter`，exit=`0`，但真实输出为 `路径：探索 0 条（预算 500）；状态签名剪枝 7 次循环`、`choice 分支覆盖：2/3`、`存档往返冒烟：25 次 save/load`、`结局可达：demo_end（12 次）`、`运行时错误：0`。该结果直接证明 CLI 以 `paths.length` 作为路径计数时，在循环被剪枝后丢失了“已探索路径”证据；没有把这个矛盾归因于 Starter 或 Core。
- 先增加最小红灯测试，再只修改授权范围内的四个源码/测试文件。红灯命令 `npm run test -w @surdet/authoring -- test/simulation.test.ts` exit=`1`，1 file / 6 tests 中 3 tests failed：新断言的 `pathsExplored` 均为 `undefined`。实现现在在共享 `SimulationReport` 暴露 `pathsExplored`；根路径计数为 1；每个实际 choice branch 在进入前计数；`maxPaths` 只依据 `pathsExplored`；超预算在进入分支前停止并设置 `budgetExhausted`；状态签名循环生成 `status=passed`、`termination=pruned`、`prunedReason=state-signature` 的显式结果；超预算生成 `termination=budget-exhausted` 的非错误结果。CLI 直接映射 `report.pathsExplored`，没有复制第二套模拟器或放宽业务断言。
- 允许修改且实际修改的代码/测试只有：`packages/authoring/src/simulation.ts`、`packages/authoring/test/simulation.test.ts`、`packages/cli/src/simulate.ts`、`packages/cli/test/simulate.test.ts`。没有修改 `packages/core`、GrowthSystem 文件或接线、`project-storage.ts`、`project-snapshot.ts`、Renderer、Host、Shell、editor、Zero、Starter、Task 8 runner、artifact、fixture、长期路线台账或受保护文件。
- 聚焦绿灯实际通过：`npm run test -w @surdet/authoring -- test/simulation.test.ts` exit=`0`（1 file / 6 tests）；`npm run typecheck -w @surdet/authoring` exit=`0`；`npm run build -w @surdet/authoring` exit=`0`；`npm run test -w @surdet/cli -- test/simulate.test.ts` exit=`0`（1 file / 9 tests）；`npm run typecheck -w @surdet/cli` exit=`0`；`npm run build -w @surdet/cli` exit=`0`。
- Starter 正式共享模拟命令 `npm run simulate -w surdet-starter` 修正后 exit=`0`，真实输出为：`pathsExplored=13`（命令显示“探索 13 条”）、`cyclesPruned=7`、`choice 分支覆盖=2/3`、`saveRoundtrips=25`、`demo_end` 可达 12 次、`runtimeErrors=0`。`git diff --quiet -- examples/starter` exit=`0`；原始 Starter 未修改。
- 按授权只运行一次 `npm run verify:all`，实际 exit=`0`。tools、边界/legacy、docs、hygiene、所有 workspace typecheck/build、全量 tests、Starter lint/simulate 和 diff-check 均通过；没有重新运行 FORMAL/DIAGNOSTIC 聚合、Electron、多轮矩阵、性能、pack、部署或发行。该 `verify:all` 是本轮唯一一次。
- 既有 FORMAL artifact 未重新运行、未覆盖、未改写：`<local-path>`；从磁盘确认 `bytes=7591`、SHA-256=`77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0`、`status=PASSED`、`evidenceClass=FORMAL`、`runHead=b9d9703e1c442cb927b59fd53026638a4345680d`。4173 listener 保持运行，未停止或重启。
- 文档追加后从磁盘重新读取：交付报告 `bytes=29750`、SHA-256=`8B651D3B408C2988D724F9F99E00E1000B3E4A588E78FBD8C761648742B9F418`；任务书在本条自记录完成后仍需重新读取最终身份。当前暂存区为空；`git diff --check`、`git diff --cached --check` 均为 exit=`0`；`git ls-files '*.log'` 无输出；没有 push。下一停止点：只精确暂存四个代码/测试文件、本计划和本交付报告，核对范围并创建 `fix(authoring): preserve simulation path evidence` 普通本地提交；提交后再做只读 Git/文件/证据身份闭合，不重跑已完成验证。
