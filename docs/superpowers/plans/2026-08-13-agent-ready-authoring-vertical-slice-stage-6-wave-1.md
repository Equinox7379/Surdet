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

- [ ] **Step 2: 实现公开能力链**

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

- [ ] **Step 3: 验证红灯期间与提交前不写盘**

在 begin、故意红灯、修正后绿灯、diff 后分别重新读取 fixture 文件树哈希；都必须等于 begin 前。只有 commit 成功后才允许变化。

- [ ] **Step 4: 驱动正式 editor preview/Renderer 两条路径**

构建 editor 后启动仅绑定 `127.0.0.1` 的 Vite preview。Playwright 直接打开正式 `preview.html`，由父测试页通过公开 `postMessage` 加载已提交 fixture 场景；使用真实键盘/鼠标选择两个选项，分别得到 trace A/B。必须验证：

```text
路径 A/B 后续文本不同
trust 结果分别为 1 和 -1
Core runtimeTrace 存在
基础演出至少一项 coreEmitted=true
同一演出 presentationApplied=true
pageErrors/consoleErrors/requestFailures/unhandledRejections/rendererErrors/releaseFailures 全为空
```

- [ ] **Step 5: 写唯一 artifact**

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

- [ ] **Step 8: 准备桌面人工验收入口但不代替项目所有者执行**

复用 harness 创建的桌面 fixture。fixture 只能复制 Starter 的 `game.config.json` 与 `content/**`，不得复制 `node_modules`、`dist`、`src`、`test` 或仓库 Git 元数据；创建前后都要重新核对原始 Starter 哈希。随后启动：

```powershell
npm run preview -w surdet-editor -- --host 127.0.0.1 --port 4173
```

只确认 HTTP 200、页面标题和 fixture 路径可访问；不把服务器可访问写成人工通过。将 URL、PID、fixture 路径和 16 步人工验收清单写入报告与计划强制提醒点。

- [ ] **Step 9: 更新 Execution Ledger 并提交 harness**

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

- [ ] **Step 1: 运行聚焦工作区测试**

```powershell
npm run test -w @surdet/core
npm run test -w @surdet/authoring
npm run test -w @surdet/cli
npm run test -w surdet-editor
npm run test -w @surdet/renderer
npm run test -w @surdet/shell
```

Expected: 全部 exit `0`。不得再出现 Stage 5 的两个 EOL 红灯。

- [ ] **Step 2: 运行 typecheck 与 build**

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

- [ ] **Step 3: 最终只运行一次全仓门禁**

```powershell
npm run verify:all
```

Expected: exit `0`。若失败，只记录一次结果并判断与本轮关系；不得循环运行。不要运行性能资格化、多轮 Electron、pack 或发行。

- [ ] **Step 4: 从磁盘重新读取所有关键证据**

必须重新读取：

- artifact path/bytes/SHA-256/status/runHead/projectRevision/changeId/traceIds；
- 桌面 fixture 目标场景与 config bytes/SHA-256；
- 原始 Starter 对应文件 bytes/SHA-256 与 Git blob；
- `git rev-parse HEAD`、`surdet/main`、ahead/behind；
- `git status`、tracked log、diff checks；
- Tasks 1–8 的真实提交与文件范围。

- [ ] **Step 5: 写交付报告**

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

- [ ] **Step 6: 写人工验收强制提醒点**

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

- [ ] **Step 7: 精确暂存最终文档并提交**

```powershell
git add -- docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md docs/AUTHORING-AGENT-READY-VERTICAL-SLICE-STAGE-6-WAVE-1-DELIVERY-REPORT-2026-08-13.md
git diff --cached --check
git diff --cached --name-status
git commit -m "docs(authoring): report stage 6 wave 1 delivery"
```

- [ ] **Step 8: 提交后最终回读并停止**

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
- 失败 artifact 已保留且禁止覆盖：`C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-yTB3Ek\agent-ready-authoring-wave-1.json`；从磁盘重新读取 `status=FAILED`、`bytes=6513`、`sha256=A9CE9274C80C2DE38579FFA5951DAF2EA33241EA8196F35F907306A45A166D08`；artifact `runHead=e06e2bd704538ad3203b9ea2927d04956803095a`、`changeId=chg_0001`、`workingRevision=0`、`lastPassedNode=change.write-operations-before-red`、`firstFailedNode=project.validate.red`。
- 桌面 fixture 已保留但未被事务提交：`C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786631494344-20a8ef48a582`。artifact 与磁盘回读均证明 `beforeBegin=afterBegin=afterSceneCreateBeforeRed=6f414fa1280b75a43436e5fa2a92527dd0ff7e56391a551b42258a05effab08a`；fixture 没有 `content/scenario` 写入，未创建 `node_modules`、`dist`、`src`、`test` 或 Git 元数据；没有 preview server、人工入口或 PASSED artifact。
- 原始 Starter 身份仍未变化：`game.config.json` bytes=`1623`、SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4`、Git blob=`86ad869719dbb3cfcc065ced9c637a49b3ce6179`；`content/scenario/ch01_01.gal` bytes=`1035`、SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`、Git blob=`50b253ef3b683b4d848d7795b8142ab72fd7a690`。artifact 的全部 preview 错误通道仍为空，但这不是 preview 通过证据，因为 preview 尚未启动。
- Task 8 失败收口前状态：`TASK_8_AGGREGATE_FAILED_AT_PROJECT_VALIDATE_RED` / `HARNESS_RED_SEMANTICS_MISMATCH_UNRESOLVED` / `WAITING_FOR_REVIEW` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。Task 8 Step 8（人工入口）和 Task 9（聚焦测试、verify:all、最终报告）均停止；下一停止点：等待总经理独立复审失败 artifact、CLI 错误边界和当前 diff，另行决定是否授权一个新的最小 harness 红灯语义整改；本轮不修改、不重跑。

### Task 8 harness red-construction correction — Task 1 red reproduced (2026-08-13 22:48 +08:00)

- 已重新读取本轮权威文件、Stage 6 规格、Stage 5 任务/报告和 Task 8 历史失败记录；本轮仍只处理 Task 8 harness 红灯构造，不修改 Core、authoring、CLI、editor、Renderer、Host、Shell 其他文件、Zero、Starter、长期路线台账或受保护文件。旧失败 artifact `C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-yTB3Ek\agent-ready-authoring-wave-1.json` 已从磁盘确认仍为 `6513` bytes、SHA-256=`A9CE9274C80C2DE38579FFA5951DAF2EA33241EA8196F35F907306A45A166D08`、`status=FAILED`、`runHead=e06e2bd704538ad3203b9ea2927d04956803095a`、最后通过 `change.write-operations-before-red`、首个失败 `project.validate.red`；旧桌面 fixture `C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786631494344-20a8ef48a582` 保留未动。
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

- 按授权只运行一次新的聚合命令：`node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，真实 exit=`1`；没有重跑、没有切换 case、没有修改生产逻辑或 runner。新运行自动生成的桌面 fixture 为 `C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786632693445-8c1eeb7782f5`，新 artifact 为 `C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-0DWIaf\agent-ready-authoring-wave-1.json`。
- 新 artifact 已从磁盘重新读取：`bytes=6696`；SHA-256=`BB5593ECC024499EEBCB492FCA601F2CFA6F5DC4185F121F1532C7513FE0CD36`；`status=FAILED`；`runHead=cb4f7243097815158c036a5a5c8b3514db9c9251`，与 Task 4 的 `CODE_EVIDENCE_HEAD` 完全一致；`projectRevision=43dead89a25afb8134db105ebf2f11b8523aca2b9c4c69f53ef05e7d22f1a39c`；`changeId=chg_0001`；`workingRevision=0`；`redEvidenceId=validation_1786632695167_54870d14-3f91-4aea-b6a6-cc73106c907a`；`greenEvidenceId=validation_1786632695766_780b8770-0aa0-4e4c-b34e-3da8ab4d3f74`；`traceIds=[]`；`cliTraceIds=[]`。
- 新聚合最后一个通过节点为 `project.simulate-2-of-2`，首个失败节点为 `runtime.run-from.A-and-B`。失败错误是正式 CLI `runtime.run-from` 返回路径 A `choices=[0]`、`status=passed` 但 `finalVariables.trust=0`，runner 断言期望 `trust=1`，因此未到达路径 B 的正式运行证据、`change.diff`/`change.commit` 后的 preview、Renderer Presentation 应用或人工入口。该证据只确认当前聚合在正式运行输入/结果合同处失败；没有足够证据把它归因于 Core、authoring、CLI、Renderer、editor 或其他生产逻辑，故本轮不修改任何生产文件、不放宽断言。
- 新 artifact 的其余事实：`choiceCoverage={total:2,visited:2}`；`stateOutcomes=[]`；preview=`null`；error channels 中 `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 均为空，`unexpectedWindowClosed=false`。事务尚未 `change.commit`，新 fixture 仍为未提交的 Starter 副本；磁盘树哈希 `beforeBegin=afterBegin=afterSceneCreateBeforeRed=afterRedValidation=afterGreenValidation=6f414fa1280b75a43436e5fa2a92527dd0ff7e56391a551b42258a05effab08a`，未创建 `content/scenario` 写入。旧 FAILED artifact 与旧桌面 fixture 均未删除、未覆盖、未复用。
- 原始 Starter 复核未变：`game.config.json` bytes=`1623`、SHA-256=`6700EECADE602051B3CD6F9458D2B5B7EDE71BCBA706BF1F4E6AB21849ADE3A4`、Git blob=`86ad869719dbb3cfcc065ced9c637a49b3ce6179`；`content/scenario/ch01_01.gal` bytes=`1035`、SHA-256=`713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`、Git blob=`50b253ef3b683b4d848d7795b8142ab72fd7a690`。
- 失败收口时真实 Git：branch=`main`；`HEAD=cb4f7243097815158c036a5a5c8b3514db9c9251`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`17 0`；tracked 未提交修改仅为本计划的本次 Execution Ledger 追加，暂存区为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；tracked `*.log` 无输出；没有 push。当前停止状态：`TASK_8_AGGREGATE_FAILED_AT_RUNTIME_RUN_FROM_A` / `WAITING_FOR_REVIEW` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。下一步等待总经理独立复审，不再运行任何聚合路径。

### Second Task 8 aggregate failure closure — Task 0 baseline re-established (2026-08-13 23:13 +08:00)

- 已重新完整读取 `E:\surdet\AGENTS.md`、长期路线台账、Stage 6 Wave 1 正式设计规格、Stage 5 最新任务书与交付报告、当前 Stage 6 Wave 1 任务书，并读取本轮 Git/交付物/完成前验证规范。当前唯一主题是已经确认的共享 `@surdet/authoring` choice effect 序列化缺陷；不创建子 AI、不并行施工、不修改长期路线台账、不进入 Wave 2，不邀请项目所有者人工验收。
- Task 0 新鲜 Git 基线：branch=`main`；`HEAD=a143b0592ec9151b28913a94ae41e8b3b2e28aa2`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`19 0`。tracked 工作树和暂存区均为空；`git diff --check`、`git diff --cached --check` 均 exit=`0`；tracked `*.log` 无输出。`git status --short --untracked-files=all` 仅列出既有未跟踪的 `AGENTS.md`、受保护文件、两份 handoff、两份艺术文件和长期路线台账；本轮不触碰这些文件。
- 两份历史失败 artifact 已从磁盘重新读取且未删除、覆盖或复用：第一次 `C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-yTB3Ek\agent-ready-authoring-wave-1.json` 为 `status=FAILED`、`bytes=6513`、SHA-256=`A9CE9274C80C2DE38579FFA5951DAF2EA33241EA8196F35F907306A45A166D08`、`runHead=e06e2bd704538ad3203b9ea2927d04956803095a`、最后通过 `change.write-operations-before-red`、首个失败 `project.validate.red`；第二次 `C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-0DWIaf\agent-ready-authoring-wave-1.json` 为 `status=FAILED`、`bytes=6696`、SHA-256=`BB5593ECC024499EEBCB492FCA601F2CFA6F5DC4185F121F1532C7513FE0CD36`、`runHead=cb4f7243097815158c036a5a5c8b3514db9c9251`、最后通过 `project.simulate-2-of-2`、首个失败 `runtime.run-from.A-and-B`；第二次 artifact 的 red/green evidence ID 均存在。
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
