# Pre-Wave 5 Editor Foundation Polish / Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复 Editor 测试门的可信度，修复重复预览时字体缓存被 detach 的确定性缺陷，并把 Gal 预览舞台稳定地放在预览主工作区中央，形成可由项目所有者直接验收的编辑器基础体验。

**Architecture:** 本 Wave 只修改 `surdet-editor`。资产目录继续复用 `@surdet/authoring` 的共享真相；字体修复只在父窗口发送边界克隆可转移字节，不改变预览协议；舞台居中只调整 Editor preview document 的布局，不修改 Renderer、游戏画面坐标系或目标宽高比。可靠性修复、布局修复和人工验收分别留独立提交与证据边界。

**Tech Stack:** TypeScript 5.7、Vite 6、Vitest 3、浏览器 File System Access API、`postMessage` transferable `ArrayBuffer`、现有 `surdet-editor` preview iframe。

## Global Constraints

- 当前计划是 `Pre-Wave 5 Foundation Polish` 的第一个可执行 Wave；Wave 5 仍未开始。
- 文档头部的 required sub-skill 只说明执行方法，不构成创建子 Agent 或并发施工授权；除非项目所有者另行明确授权，本 Wave 由一个执行 AI 串行完成。
- 本 Wave 只允许修改 `packages/editor/` 与本任务书/本轮交付报告；不得修改 Core、Renderer、Host、Shell、Authoring、CLI、Starter、Zero 生产代码。
- 不修改 `@surdet/authoring` 的资产对象结构；`timelineTarget` 已是共享合同，Editor 测试必须跟随真实合同。
- 不新增第二套资产目录、字体缓存、预览运行时或舞台缩放算法。
- 预览舞台居中是硬性布局不变量：相对于预览主工作区水平和垂直居中；禁止左上角锚定。
- 预览必须保持游戏画面的固有宽高比；禁止拉伸、非预期裁切或通过修改 Renderer 内部坐标解决布局问题。
- 工具栏、诊断区和因果轨迹位于舞台外围；它们不得成为画布坐标系的一部分，也不得把舞台固定推向左侧。
- 默认使用浏览器原生 `max-width` / `max-height` contain 语义；不引入缩放库、不新增 Canvas 包装框架。
- 字体缓存仍按项目目录、路径、`lastModified` 与 bytes 缓存；只克隆发送副本，缓存本体必须在任意次数播放后保持未 detach。
- 所有代码 Task 先建立或运行匹配症状的红灯，再做最小绿灯；不得先改实现再补永远不会失败的测试。
- 不重写现有 Editor 信息架构，不在本 Wave 增加 AI 面板、提案收件箱、默认游戏主题、转场、Backlog 持久化、时间轴撤销或新创作对象。
- 不删除根目录截图、临时脚本、CLI artifacts 或任何用户文件；文档/垃圾清理由项目所有者另行授权。
- 不修改长期路线台账，不触碰 `SESSION-HANDOFF.md`、`USER.md` 与两份受保护美术资料。
- 不运行 Electron 矩阵、性能资格化、pack、部署或发行。
- 允许聚焦测试、Editor 全量测试、Editor typecheck/build 与一次真实浏览器入口；不要求 `verify:all`，除非出现明确跨工作区影响证据并取得总经理追加授权。
- 只创建普通本地提交；不得 push、force push、rebase、reset、amend、squash、clean 或删除失败证据。
- 测试设施失败必须与产品失败分开记录；不得通过放宽断言、延长无关超时或修改生产协议制造绿灯。
- 质量是第一优先级；在质量不下降的前提下，省额度是第二优先级。禁止无界重复运行同一大型门禁。

---

## 一、阶段位置与后续边界

本计划吸收 `<local-path>��擎终审报告.md` 中已经由当前源码复核的 Editor 发现，但该桌面报告只是输入证据，不是执行指令或仓库权威文件。

`Pre-Wave 5 Foundation Polish` 后续主题按以下顺序另写独立任务书，本 Wave 不自动进入：

1. Renderer presentation / NVL 存档快照兼容；
2. Core DSL、场景寻址与 seeded determinism；
3. Agent change-store 原子持久化与 STALE 恢复语义；
4. 默认 Galgame Player UI 主题和菜单/Backlog 视觉统一；
5. 人类待审变更与因果交接台（原 Wave 5 产品方向）。

这样做不是降低基础打磨目标，而是防止 Editor、Renderer、Core、CLI 五个风险域重新混在一个不可归因的施工轮里。

---

## 二、权威输入与执行前基线

执行 AI 必须按顺序完整读取：

1. `E:\surdet\AGENTS.md`
2. `docs/README.md`
3. `docs/known-limitations.md`
4. `docs/superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md`
5. 本任务书
6. `packages/editor/package.json`
7. `packages/editor/preview.html`
8. `packages/editor/src/panels/preview-panel.ts`
9. `packages/editor/src/styles.css`
10. `packages/editor/test/presentation-asset-catalog.test.ts`
11. `packages/editor/test/preview-runtime-contract.test.ts`
12. `packages/authoring/src/asset-catalog.ts`（只读，用于确认共享合同）

任务书生成时的真实基线：

```text
branch = main
HEAD = f0e67ec03600292b6b281b37f40d2d6098398245
surdet/main = f0e67ec03600292b6b281b37f40d2d6098398245
ahead/behind = 0/0
tracked worktree = clean
staging area = empty
known untracked governance/protected paths = preserved
packages/cli/e2e/artifacts = pre-existing untracked evidence; do not touch
Wave 5 = NOT_STARTED
push = NOT_AUTHORIZED
```

任务书生成时新鲜复现：

```text
npm run test -w surdet-editor -- test/presentation-asset-catalog.test.ts
exit = 1
test files = 1 failed
tests = 1 failed / 3 passed
first failure = expected portrait catalog entry omitted timelineTarget: lynn:uniform
```

执行开始时必须重新读取 Git 基线。若出现未记录的 tracked 修改、非空暂存区、并行施工提交或远端 behind，停止在 Task 0；不得 reset、checkout、stash、clean 或覆盖他人修改。

---

## 三、文件结构与责任锁定

### 3.1 计划修改

| 文件 | 单一责任 |
|---|---|
| `packages/editor/test/presentation-asset-catalog.test.ts` | 让 Editor 的共享资产目录合同跟随 `timelineTarget` 真实字段 |
| `packages/editor/src/panels/preview-panel.ts` | 在 `postMessage` 边界克隆字体发送副本，保护缓存本体 |
| `packages/editor/preview.html` | 定义 iframe 内 Gal 舞台的居中、contain 与深色留白布局 |
| `packages/editor/test/preview-font-transfer.test.ts` | 证明多次发送不会 detach 缓存字体，发送副本仍可 transfer |
| `packages/editor/test/preview-stage-layout.test.ts` | 锁定 preview document 的居中与宽高比布局合同 |
| `docs/superpowers/plans/2026-08-24-pre-wave-5-editor-foundation-polish-wave-1.md` | Execution Ledger 与停止状态 |
| `docs/EDITOR-FOUNDATION-POLISH-WAVE-1-DELIVERY-REPORT-2026-08-24.md` | 人工验收后创建的最终交付报告 |

### 3.2 只读参考

| 文件 | 原因 |
|---|---|
| `packages/authoring/src/asset-catalog.ts` | `timelineTarget` 的共享领域来源 |
| `packages/editor/src/preview.ts` | 确认 preview root/canvas 挂载方式，不在本 Wave 修改运行时 |
| `packages/editor/src/styles.css` | 确认 iframe 已占据预览主工作区，不用改成第二套页面布局 |
| `packages/editor/test/preview-runtime-contract.test.ts` | 复用源码合同测试风格 |

### 3.3 明确禁止

- 不修改 `packages/renderer/**` 来“顺便美化”游戏 UI；默认 Player UI 另立 Wave。
- 不修改 `packages/core/**`、`packages/authoring/**`、`packages/cli/**`。
- 不新增依赖或修改 lockfile。
- 不把 `preview.html` 复制为第二个 preview 入口。
- 不把 Canvas 固定为某个像素尺寸；必须适配不同预览主工作区。
- 不让父页面通过内部 Renderer 状态直接驱动画面。
- 不把人工视觉验收写成自动化通过。

---

## 四、布局与交互不变量

### 4.1 预览主工作区

```text
Editor preview tab
├─ toolbar（场景入口 / 快进 / 播放）
├─ iframe，占据剩余主工作区
│  └─ preview-root，100% × 100%
│     └─ Gal canvas，水平 + 垂直居中，contain，保持固有宽高比
├─ diagnostics
└─ causal trace
```

### 4.2 必须成立

```text
PREVIEW_STAGE_CENTERING_REQUIRED
LEFT_OR_TOP_ALIGNED_STAGE_FORBIDDEN
ASPECT_RATIO_PRESERVED
NO_STRETCH
NO_UNINTENDED_CROP
SYMMETRIC_UNUSED_SPACE
CONTROLS_OUTSIDE_STAGE_COORDINATES
REPEATED_PREVIEW_FONT_CACHE_INTACT
```

“居中”是相对于 iframe 的预览主工作区，不是相对于包含 Editor 左右侧栏的整个浏览器窗口。宽窗口、窄窗口和高窗口下，都应在剩余预览区域重新居中。

---

### Task 0: 真实基线与范围门

**Files:**
- Read: 本任务书第二节列出的权威输入
- Modify: none

**Interfaces:**
- Consumes: 当前本地 `main` 与 `surdet/main`。
- Produces: 可审计的执行基线；后续 Task 不得沿用任务书生成时的旧状态。

- [ ] **Step 1: 读取 Git 身份**

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git diff --check
git diff --cached --check
git ls-files '*.log'
```

Expected：branch 为 `main`；tracked 工作树无修改；暂存区为空；已知未跟踪治理/受保护路径保留；不得假定 HEAD 仍等于任务书基线。

- [ ] **Step 2: 核对任务范围文件**

```powershell
git diff --name-status
git diff --cached --name-status
git status --short -- packages/editor docs/superpowers/plans/2026-08-24-pre-wave-5-editor-foundation-polish-wave-1.md
```

Expected：除本任务书自身可能为未跟踪文件外，没有并行 Editor 施工。

- [ ] **Step 3: 记录 Task 0 Ledger**

在本文末尾 `Execution Ledger` 追加真实 HEAD、tracking ref、ahead/behind、工作树、暂存区、已知未跟踪路径和本轮授权范围。禁止写入尚未运行的命令结果。

---

### Task 1: 恢复 Editor 资产目录测试门

**Files:**
- Modify: `packages/editor/test/presentation-asset-catalog.test.ts:34-44`
- Read: `packages/authoring/src/asset-catalog.ts:44-72`

**Interfaces:**
- Consumes: `buildAssetCatalog(paths): ProjectAssetCatalog` 的共享 portrait 条目。
- Produces: Editor 与 Authoring 对 `timelineTarget` 字段完全一致的合同测试。

- [ ] **Step 1: 运行现有红灯**

```powershell
npm run test -w surdet-editor -- test/presentation-asset-catalog.test.ts
```

Expected：exit `1`；唯一失败显示 actual 多出：

```text
timelineTarget: "lynn:uniform"
```

若失败原因不同，停止；不得按报告猜测修改。

- [ ] **Step 2: 对齐真实共享合同**

将 portrait 期望对象改为：

```ts
expect(lynn).toEqual({
  kind: 'portrait',
  key: 'lynn:uniform',
  role: 'lynn',
  outfit: 'uniform',
  expression: 'night',
  timelineTarget: 'lynn:uniform',
  sourcePath: 'content/assets/portrait/lynn_uniform_night.svg',
  format: 'svg',
  resolved: true,
});
```

禁止从实际值动态生成 expected；该测试必须继续锁定字段级合同。

- [ ] **Step 3: 运行绿灯**

```powershell
npm run test -w surdet-editor -- test/presentation-asset-catalog.test.ts
```

Expected：1 file / 4 tests passed，exit `0`。

- [ ] **Step 4: 创建独立本地提交**

```powershell
git add -- packages/editor/test/presentation-asset-catalog.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "test(editor): align presentation asset contract"
```

Expected：提交只包含一个 Editor 测试文件；不得夹带任务书、生产代码或未跟踪文件。

---

### Task 2: 保护重复预览的字体缓存

**Files:**
- Modify: `packages/editor/src/panels/preview-panel.ts:203-208,246-301,503-540`
- Create: `packages/editor/test/preview-font-transfer.test.ts`

**Interfaces:**
- Consumes: `Partial<Record<FontRole, PreviewFont>>` 缓存。
- Produces: `clonePreviewFontsForTransfer(fonts)`，每次返回新的可 transfer buffer，且不改变输入缓存。

- [ ] **Step 1: 写缓存 detach 红灯**

创建 `packages/editor/test/preview-font-transfer.test.ts`：

```ts
import { describe, expect, it } from 'vitest';
import { clonePreviewFontsForTransfer } from '../src/panels/preview-panel.js';

describe('preview font transfer boundary', () => {
  it('keeps cached buffers reusable across repeated transferable sends', () => {
    const cached = {
      body: {
        buffer: new Uint8Array([1, 2, 3, 4]).buffer,
        mime: 'font/woff2',
        version: '1:4',
      },
    } as const;

    const first = clonePreviewFontsForTransfer(cached);
    expect(first.body?.buffer).not.toBe(cached.body.buffer);
    expect(first.body?.buffer.byteLength).toBe(4);

    structuredClone(first, { transfer: [first.body!.buffer] });
    expect(first.body?.buffer.byteLength).toBe(0);
    expect(cached.body.buffer.byteLength).toBe(4);

    const second = clonePreviewFontsForTransfer(cached);
    expect(second.body?.buffer.byteLength).toBe(4);
    expect([...new Uint8Array(second.body!.buffer)]).toEqual([1, 2, 3, 4]);
  });
});
```

- [ ] **Step 2: 运行红灯**

```powershell
npm run test -w surdet-editor -- test/preview-font-transfer.test.ts
```

Expected：exit `1`，原因是 `clonePreviewFontsForTransfer` 尚未导出。

- [ ] **Step 3: 实现唯一发送边界克隆**

在 `preview-panel.ts` 中导出：

```ts
export function clonePreviewFontsForTransfer(
  fonts: Partial<Record<FontRole, PreviewFont>>,
): Partial<Record<FontRole, PreviewFont>> {
  const cloned: Partial<Record<FontRole, PreviewFont>> = {};
  for (const role of ['body', 'title', 'ui'] as FontRole[]) {
    const font = fonts[role];
    if (font === undefined) continue;
    cloned[role] = {
      ...font,
      buffer: font.buffer.slice(0),
    };
  }
  return cloned;
}
```

在 `send()` 中只替换字体读取边界：

```ts
const cachedFonts = await readProjectFonts();
const fonts = clonePreviewFontsForTransfer(cachedFonts);
```

其余 message 与 transfer list 保持现有语义。禁止克隆图片/音频缓存、改用 base64、取消 transfer 或每次重新读取磁盘字体。

- [ ] **Step 4: 运行聚焦绿灯**

```powershell
npm run test -w surdet-editor -- test/preview-font-transfer.test.ts test/preview-runtime-contract.test.ts
```

Expected：两个文件全部通过，exit `0`。

- [ ] **Step 5: 创建独立本地提交**

```powershell
git add -- packages/editor/src/panels/preview-panel.ts packages/editor/test/preview-font-transfer.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "fix(editor): preserve preview font cache"
```

Expected：只包含字体发送边界和对应测试。

---

### Task 3: 让 Gal 预览舞台在主工作区居中

**Files:**
- Modify: `packages/editor/preview.html:6-14`
- Create: `packages/editor/test/preview-stage-layout.test.ts`
- Read: `packages/editor/src/styles.css:342-354`

**Interfaces:**
- Consumes: `preview.ts` 向 `#preview-root` append 的 Renderer canvas。
- Produces: iframe 内基于 CSS Grid 的居中 contain 布局，不改变 canvas 内部像素坐标。

- [ ] **Step 1: 写布局合同红灯**

创建 `packages/editor/test/preview-stage-layout.test.ts`：

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const previewHtml = readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../preview.html',
), 'utf8');

describe('preview stage layout contract', () => {
  it('centers the Gal canvas in both axes without stretching it', () => {
    expect(previewHtml).toMatch(/html,\s*body\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
    expect(previewHtml).toMatch(/#preview-root\s*\{[^}]*display:\s*grid[^}]*place-items:\s*center/s);
    expect(previewHtml).toMatch(/#preview-root\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
    expect(previewHtml).toMatch(/#preview-root canvas\s*\{[^}]*width:\s*auto[^}]*height:\s*auto/s);
    expect(previewHtml).toMatch(/#preview-root canvas\s*\{[^}]*max-width:\s*100%[^}]*max-height:\s*100%/s);
    expect(previewHtml).not.toMatch(/#preview-root canvas\s*\{[^}]*width:\s*100%/s);
  });
});
```

- [ ] **Step 2: 运行红灯**

```powershell
npm run test -w surdet-editor -- test/preview-stage-layout.test.ts
```

Expected：exit `1`；当前 `#preview-root canvas` 使用 `width: 100%`，且 root 没有双轴居中。

- [ ] **Step 3: 实现最小居中布局**

将 `preview.html` 内联样式改为：

```html
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #0d0f16; }
  #preview-root {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    padding: 16px;
  }
  #preview-root canvas {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
  }
  #preview-error { color: #ff8080; font: 13px/1.6 "Microsoft YaHei", sans-serif; padding: 8px 12px; white-space: pre-wrap; }
</style>
```

禁止用 `margin-left`、固定 `left/top`、JavaScript 轮询尺寸或修改 Renderer 分辨率达成视觉居中。

- [ ] **Step 4: 运行布局绿灯和相邻合同**

```powershell
npm run test -w surdet-editor -- test/preview-stage-layout.test.ts test/preview-runtime-contract.test.ts test/preview-runtime-lifecycle.test.ts
```

Expected：全部通过，exit `0`。

- [ ] **Step 5: 创建独立本地提交**

```powershell
git add -- packages/editor/preview.html packages/editor/test/preview-stage-layout.test.ts
git diff --cached --check
git diff --cached --name-status
git commit -m "style(editor): center preview stage"
```

Expected：只包含 preview document 布局和合同测试。

---

### Task 4: Editor 聚合验证与真实浏览器入口

**Files:**
- Modify: none
- Create outside repository: 隔离 Starter fixture、必要的人工验收截图

**Interfaces:**
- Consumes: Task 1–3 的三个本地提交。
- Produces: 自动化绿灯与项目所有者可执行的单次人工路径。

- [ ] **Step 1: 运行 Editor 全量测试**

```powershell
npm run test -w surdet-editor
```

Expected：全部 Editor test files/tests 通过，exit `0`；不得继续出现 `timelineTarget` 红灯。

若出现与本轮无关的失败，只记录第一个失败节点并分析相关性；不得循环重跑整包。

- [ ] **Step 2: 运行类型检查与构建**

```powershell
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

Expected：均 exit `0`。既有 Vite chunk >500 kB 警告不是本 Wave 阻断，不修改性能门限。

- [ ] **Step 3: 核对范围和卫生**

```powershell
git diff --check
git diff --cached --check
git status --short --branch
git log --oneline -4
git ls-files '*.log'
```

Expected：tracked 工作树干净、暂存区为空；Task 1–3 各自提交范围精确；现有未跟踪治理/受保护文件没有进入提交。

- [ ] **Step 4: 创建隔离人工 fixture**

使用 PowerShell 在桌面创建新的时间戳目录，只复制 `examples/starter` 的项目内容；不得选择或写入原始 Starter。记录：

```text
fixtureRoot
file count
total bytes
tree SHA-256 or per-file manifest identity
original Starter unchanged identity
```

禁止删除或复用历史 acceptance fixture；本轮 fixture 必须有独立名称。

- [ ] **Step 5: 启动一个 Editor 预览服务**

```powershell
npm run dev -w surdet-editor -- --host 127.0.0.1 --port 4173
```

Expected：根地址返回 `200`，页面标题为 `Surdet 剧本编辑器`。如果 4173 已被占用，先只读确认进程身份；不得杀死不属于本任务的进程。

- [ ] **Step 6: 停止并邀请项目所有者人工验收**

执行 AI 不得代填。必须向项目所有者提供 URL、fixtureRoot 和以下清单：

1. 用 Chrome 或 Edge 打开 Editor 根地址；
2. 打开本轮桌面隔离 fixture，不要选择 `E:\surdet\examples\starter`；
3. 选择一个含项目字体、背景和立绘的现有场景；
4. 切换“预览”，从场景开头播放；
5. 确认 Gal 舞台在预览主工作区水平和垂直居中，不靠左、不贴顶；
6. 调整浏览器为宽窗口、窄窗口和较高窗口，确认舞台始终重新居中；
7. 确认画面宽高比不变，没有拉伸或非预期裁切；
8. 确认工具栏、诊断和因果轨迹位于舞台外围，不覆盖或推偏舞台；
9. 连续点击“播放 / 重载”至少两次，确认第二次仍使用正确字体且无字体加载错误；
10. 确认真实文本、背景、立绘、输入和剧情推进正常；
11. 刷新 Editor、重新打开同一 fixture，再次预览，确认居中和字体仍正常；
12. 确认原始 Starter 未修改。

当前停止状态必须是：

```text
EDITOR_FOUNDATION_POLISH_IMPLEMENTED
AUTOMATED_EDITOR_GATES_PASSED
HUMAN_ACCEPTANCE_PENDING_OWNER
NOT_PUSHED
WAVE_5_NOT_STARTED
```

出现异常时只接受项目所有者报告的第一个异常、触发动作、实际画面和必要截图；不得立即猜测修改。

---

### Task 5: 人工通过后的最终文档闭合

**Files:**
- Modify: `docs/superpowers/plans/2026-08-24-pre-wave-5-editor-foundation-polish-wave-1.md`
- Create: `docs/EDITOR-FOUNDATION-POLISH-WAVE-1-DELIVERY-REPORT-2026-08-24.md`

**Interfaces:**
- Consumes: 项目所有者明确“全部通过”或首个失败反馈。
- Produces: 可独立复审的代码证据 HEAD、人工结论、fixture 身份和最终本地文档提交。

- [ ] **Step 1: 只读回读最终事实**

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse surdet/main
git rev-list --left-right --count HEAD...surdet/main
git diff --check
git diff --cached --check
git ls-files '*.log'
```

重新读取 fixture 和原 Starter manifest；重新读取任务书、报告路径、bytes 与 SHA-256。

- [ ] **Step 2: 写报告时严格分层**

报告必须明确区分：

```text
AUTOMATED_FACTS
OWNER_REPORTED_VISUAL_FACTS
UNVERIFIED_INFERENCES
OUT_OF_SCOPE_FINDINGS
```

若人工全部通过，才允许写：

```text
EDITOR_FOUNDATION_POLISH_WAVE_1_VERIFIED
PREVIEW_STAGE_CENTERING_PASSED_BY_OWNER
REPEATED_PREVIEW_FONT_PATH_PASSED_BY_OWNER
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
WAVE_5_NOT_STARTED
```

若失败，不得使用上述通过状态。

- [ ] **Step 3: 扫描文档占位和历史状态**

```powershell
rg -n "TBD|TODO|will be appended|PENDING|NOT_STARTED|NOT_AUTHORIZED" `
  docs/superpowers/plans/2026-08-24-pre-wave-5-editor-foundation-polish-wave-1.md `
  docs/EDITOR-FOUNDATION-POLISH-WAVE-1-DELIVERY-REPORT-2026-08-24.md
```

Expected：只保留明确标注为历史快照或真实未完成门的字段；不得让报告头部仍显示旧失败状态。

- [ ] **Step 4: 运行文档与范围门**

```powershell
npm run verify:docs
npm run verify:hygiene
git diff --check
```

Expected：全部 exit `0`。

- [ ] **Step 5: 创建唯一文档闭合提交**

```powershell
git add -- `
  docs/superpowers/plans/2026-08-24-pre-wave-5-editor-foundation-polish-wave-1.md `
  docs/EDITOR-FOUNDATION-POLISH-WAVE-1-DELIVERY-REPORT-2026-08-24.md
git diff --cached --check
git diff --cached --name-status
git commit -m "docs(editor): report foundation polish wave 1"
```

Expected：只包含两份本 Wave 文档。文档不自指记录自身最终 SHA；提交后 bytes/SHA-256 在聊天交接中从磁盘报告，避免制造 docs-only correction 循环。

- [ ] **Step 6: 停在独立复审与 push 门之前**

```text
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
PUSH_NOT_AUTHORIZED
DEFAULT_PLAYER_UI_POLISH_NOT_STARTED
WAVE_5_NOT_STARTED
```

不得自动进入 Renderer 默认主题、Core seeded RNG、CLI 事务可靠性、Wave 5 或 push。

---

## 五、失败策略与成本纪律

1. 每个聚焦红灯只需一次；若失败原因匹配，立即施工，不重复证明同一红灯。
2. Task 1–3 各自聚焦绿灯通过后再运行一次 Editor 全套；不在每个 Task 后运行整包。
3. 不运行 `verify:all`；若 Editor 改动意外影响其他 workspace，先报告证据，由总经理决定是否升级门禁。
4. 浏览器人工路径由项目所有者执行一次；自动化不得替代布局、字体观感和操作手感。
5. 任何一次失败都保留输出；不得删除、覆盖或筛选失败证据。
6. 若 CSS 自动合同通过但项目所有者仍看到舞台偏左，以玩家一手画面为准，先检查真实 iframe 尺寸、Canvas computed style 和截图，再决定是否修复。
7. 不为了居中引入 ResizeObserver、Canvas 重建或 Renderer resize，除非 CSS contain 在真实浏览器中被证明不足，并由总经理追加授权。

---

## 六、独立复审清单

独立复审者只读核对：

- Task 1 是否只对齐 `timelineTarget`，没有删除字段或放宽全等断言；
- 字体缓存本体在 transfer 后是否保持 `byteLength > 0`；
- 第二次发送是否来自缓存克隆，而不是磁盘重读或 base64 fallback；
- preview root 是否真实双轴居中；
- canvas 是否 `width:auto; height:auto; max-width:100%; max-height:100%`；
- 是否没有修改 Renderer 坐标、分辨率或游戏内容；
- Editor 全套、typecheck、build 是否实际运行并通过；
- 项目所有者人工反馈是否逐字如实记录；
- 原 Starter 是否未修改；
- 提交范围、HEAD、tracking ref、ahead/behind、工作树和文档身份是否相互一致；
- 是否未 push、未进入后续基础 Wave 或 Wave 5。

---

## 七、Execution Ledger

> 执行 AI 只追加真实发生的事实。每笔至少记录：时间、HEAD、tracking ref、ahead/behind、tracked/staged 状态、修改文件、实际命令/exit code、artifact 或 fixture 身份、当前停止状态。不得预填通过结果。

### 2026-08-24 总经理任务书生成记录

```ini
PLAN_STATUS = READY_FOR_EXECUTION
PLANNING_HEAD = f0e67ec03600292b6b281b37f40d2d6098398245
PLANNING_REMOTE_TRACKING_REF = f0e67ec03600292b6b281b37f40d2d6098398245
PLANNING_AHEAD_BEHIND = 0/0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
KNOWN_UNTRACKED = PRESERVED
EDITOR_CATALOG_RED = REPRODUCED; 1 failed / 3 passed
PRODUCTION_CHANGES = NONE
TEST_CHANGES = NONE
PUSH = NOT_AUTHORIZED
WAVE_5 = NOT_STARTED
NEXT = EXECUTION_AI_TASK_0
```

### 2026-08-24 Task 0 fresh execution baseline

```ini
TASK_0_EXECUTION_TIME = 2026-08-24 12:11:18 +08:00
TASK_0_AUTHORIZATION = USER_AUTHORIZED_TASKBOOK_EXECUTION
TASK_0_BRANCH = main
TASK_0_HEAD = f0e67ec03600292b6b281b37f40d2d6098398245
TASK_0_HEAD_PARENT = e9ffeb739e0e42634d364d742586cfc018d379dc
TASK_0_SURDET_MAIN = f0e67ec03600292b6b281b37f40d2d6098398245
TASK_0_HEAD_DOT_SURDET_MAIN = 0/0
TASK_0_TRACKED_WORKTREE = CLEAN
TASK_0_STAGING_AREA = EMPTY
TASK_0_DIFF_CHECK = PASS
TASK_0_CACHED_DIFF_CHECK = PASS
TASK_0_TRACKED_LOG_FILES = NONE
TASK_0_EDITOR_SCOPE_STATUS = NO_PARALLEL_EDITOR_CHANGES
TASK_0_KNOWN_UNTRACKED_GOVERNANCE = PRESERVED
TASK_0_CLI_ARTIFACTS = PRE_EXISTING_UNTRACKED_PRESERVED
TASK_0_TASKBOOK_STATUS = UNTRACKED_BEFORE_TASK_0; MODIFIED_ONLY_BY_TASK_0_LEDGER
TASK_0_ALLOWED_MODIFICATION_SCOPE = packages/editor/**; current taskbook; current delivery report after owner acceptance
TASK_0_FORBIDDEN_SCOPE = Core; Renderer; Host; Shell; Authoring; CLI; Starter; Zero; roadmap; protected files; historical artifacts
TASK_0_IMPLEMENTATION_STARTED = NO
TASK_0_PUSH = NOT_AUTHORIZED
TASK_0_WAVE_5 = NOT_STARTED
TASK_0_STATUS = TASK_0_BASELINE_CONFIRMED
TASK_0_NEXT = TASK_1_ASSET_CATALOG_CONTRACT
```

### 2026-08-24 Task 1–4 execution evidence

```ini
TASK_1_EXECUTION_TIME = 2026-08-24 12:17:20 +08:00
TASK_1_RED_COMMAND = npm run test -w surdet-editor -- test/presentation-asset-catalog.test.ts
TASK_1_RED_EXIT = 1
TASK_1_RED_FIRST_FAILURE = portrait catalog expected omitted timelineTarget; received timelineTarget=lynn:uniform
TASK_1_GREEN_COMMAND = npm run test -w surdet-editor -- test/presentation-asset-catalog.test.ts
TASK_1_GREEN_EXIT = 0
TASK_1_GREEN_RESULT = 1 file / 4 tests passed
TASK_1_COMMIT = 9e6d841216a1e6cd2e2ecc1d7c51d062bfbcc665
TASK_1_COMMIT_PARENT = f0e67ec03600292b6b281b37f40d2d6098398245
TASK_1_COMMIT_SCOPE = packages/editor/test/presentation-asset-catalog.test.ts
TASK_1_STATUS = PASS

TASK_2_EXECUTION_TIME = 2026-08-24 12:17:20 +08:00
TASK_2_RED_COMMAND = npm run test -w surdet-editor -- test/preview-font-transfer.test.ts
TASK_2_RED_EXIT = 1
TASK_2_RED_FIRST_FAILURE = clonePreviewFontsForTransfer is not a function
TASK_2_GREEN_COMMAND = npm run test -w surdet-editor -- test/preview-font-transfer.test.ts test/preview-runtime-contract.test.ts
TASK_2_GREEN_EXIT = 0
TASK_2_GREEN_RESULT = 2 files / 2 tests passed
TASK_2_COMMIT = 9e025fbd41620dfcf503f802291d048d5d6f3916
TASK_2_COMMIT_PARENT = 9e6d841216a1e6cd2e2ecc1d7c51d062bfbcc665
TASK_2_COMMIT_SCOPE = packages/editor/src/panels/preview-panel.ts; packages/editor/test/preview-font-transfer.test.ts
TASK_2_STATUS = PASS

TASK_3_EXECUTION_TIME = 2026-08-24 12:17:20 +08:00
TASK_3_RED_COMMAND = npm run test -w surdet-editor -- test/preview-stage-layout.test.ts
TASK_3_RED_EXIT = 1
TASK_3_RED_FIRST_FAILURE = preview document lacked full-size root, grid centering and contain declarations
TASK_3_GREEN_FIRST_ATTEMPT = exit 1; test negative matcher falsely matched required max-width:100% substring
TASK_3_GREEN_TEST_FIX = declaration-boundary matcher only; production layout semantics unchanged
TASK_3_GREEN_COMMAND = npm run test -w surdet-editor -- test/preview-stage-layout.test.ts test/preview-runtime-contract.test.ts test/preview-runtime-lifecycle.test.ts
TASK_3_GREEN_EXIT = 0
TASK_3_GREEN_RESULT = 3 files / 3 tests passed
TASK_3_COMMIT = ad0b266cb4b8f2874d5d842bd5bebb87ca080da7
TASK_3_COMMIT_PARENT = 9e025fbd41620dfcf503f802291d048d5d6f3916
TASK_3_COMMIT_SCOPE = packages/editor/preview.html; packages/editor/test/preview-stage-layout.test.ts
TASK_3_STATUS = PASS

TASK_4_EXECUTION_TIME = 2026-08-24 12:17:20 +08:00
TASK_4_EDITOR_FULL_TEST_COMMAND = npm run test -w surdet-editor
TASK_4_EDITOR_FULL_TEST_EXIT = 0
TASK_4_EDITOR_FULL_TEST_RESULT = 28 files / 175 tests passed
TASK_4_TYPECHECK_COMMAND = npm run typecheck -w surdet-editor
TASK_4_TYPECHECK_EXIT = 0
TASK_4_BUILD_COMMAND = npm run build -w surdet-editor
TASK_4_BUILD_EXIT = 0
TASK_4_BUILD_WARNING = Vite chunk >500 kB warning only; performance threshold unchanged
TASK_4_DIFF_CHECK = PASS; exit=0
TASK_4_CACHED_DIFF_CHECK = PASS; exit=0
TASK_4_TRACKED_WORKTREE_AFTER_CODE = CLEAN
TASK_4_STAGING_AFTER_CODE = EMPTY
TASK_4_COMMIT_CHAIN = 9e6d841; 9e025fb; ad0b266
TASK_4_FORBIDDEN_WORKSPACES_MODIFIED = NO

TASK_4_FIXTURE_ROOT = <local-path>
TASK_4_FIXTURE_FILE_COUNT = 37
TASK_4_FIXTURE_BYTES = 6705750
TASK_4_FIXTURE_TREE_SHA256 = 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6
TASK_4_ORIGINAL_STARTER_FILE_COUNT = 37
TASK_4_ORIGINAL_STARTER_BYTES = 6705750
TASK_4_ORIGINAL_STARTER_TREE_SHA256 = 8218643BB2224C652EF86D896CCF2B09D7D0B1C72E8D5D47FF968A5CFEB74EE6
TASK_4_FIXTURE_COMMON_MISMATCH_COUNT = 0
TASK_4_FIXTURE_ONLY_COUNT = 0
TASK_4_FIXTURE_EQUALS_STARTER = YES
TASK_4_ORIGINAL_STARTER_UNCHANGED = YES
TASK_4_FIXTURE_OUTSIDE_REPOSITORY = YES
TASK_4_FIXTURE_ON_DESKTOP = YES
TASK_4_HISTORICAL_ARTIFACTS = PRESERVED_NOT_TOUCHED

TASK_4_DEV_COMMAND = npm run dev -w surdet-editor -- --host 127.0.0.1 --port 4173
TASK_4_DEV_STATUS = RUNNING_FOR_OWNER_ACCEPTANCE
TASK_4_DEV_URL = http://127.0.0.1:4173/
TASK_4_DEV_HTTP_STATUS = 200
TASK_4_DEV_TITLE = Surdet 剧本编辑器
TASK_4_OWNER_VISUAL_CONCLUSIONS = NOT_FILLED_BY_EXECUTION_AI
TASK_4_STATUS = HUMAN_ACCEPTANCE_PENDING_OWNER
TASK_5 = NOT_STARTED
PUSH = NOT_PERFORMED
WAVE_5 = NOT_STARTED
NEXT = HUMAN_ACCEPTANCE_PENDING_OWNER
```

### 2026-08-24 Task 5 owner acceptance and closure preparation

```ini
TASK_5_EXECUTION_TIME = 2026-08-24 12:26:53 +08:00
TASK_5_OWNER_FEEDBACK = 人工验收通过
TASK_5_OWNER_FEEDBACK_RESULT = PASS
TASK_5_OWNER_FEEDBACK_SCOPE = 任务书规定的 12 步真实浏览器验收路径
TASK_5_EXECUTION_AI_VISUAL_CONCLUSIONS = NOT_SUBSTITUTED
TASK_5_FIXTURE_ROOT = <local-path>
TASK_5_FIXTURE_READBACK_SCOPE = project source files excluding pre-existing dist/ and node_modules/
TASK_5_FIXTURE_READBACK_FILE_COUNT = 37
TASK_5_FIXTURE_READBACK_BYTES = 6705750
TASK_5_FIXTURE_READBACK_COMMON_MISMATCH_COUNT = 0
TASK_5_FIXTURE_READBACK_ONLY_COUNT = 0
TASK_5_PROJECT_FIXTURE_EQUALS_STARTER = YES
TASK_5_ORIGINAL_STARTER_UNCHANGED = YES
TASK_5_RAW_RECURSIVE_FIXTURE_AND_STARTER = both 114 files / 27692340 bytes; 0 content mismatches
TASK_5_CODE_EVIDENCE_HEAD = ad0b266cb4b8f2874d5d842bd5bebb87ca080da7
TASK_5_REPORT_PATH = docs/EDITOR-FOUNDATION-POLISH-WAVE-1-DELIVERY-REPORT-2026-08-24.md
TASK_5_REPORT_CREATED = YES
TASK_5_DOCUMENT_PLACEHOLDER_SCAN = PASS_WITH_EXPLICIT_HISTORICAL_AND_OUT_OF_SCOPE_STATES
TASK_5_VERIFY_DOCS = PASS; exit=0
TASK_5_VERIFY_HYGIENE = PASS; exit=0; 696 tracked paths
TASK_5_DIFF_CHECK = PASS; exit=0
TASK_5_STATUS = PASS
TASK_5_FINAL_STOP = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
PUSH = NOT_PERFORMED
WAVE_5 = NOT_STARTED
NEXT = WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```

### 2026-08-24 Owner-observed preview trace layout reopening

```ini
TRACE_REOPEN_TIME = 2026-08-24 12:41:12 +08:00
TRACE_REOPENED_BY_OWNER_FEEDBACK = YES
TRACE_REOPEN_REASON = OWNER_OBSERVED_PREVIEW_TRACE_LAYOUT_SHIFT
PREVIOUS_TASK_5_CLOSURE = REOPENED
PREVIOUS_OWNER_ACCEPTANCE = PASS_RETAINED
PREVIOUS_FONT_RESOURCE_CENTERING_AND_PLOT_CONCLUSIONS = RETAINED
TRACE_DATA_PRESERVED = YES
TRACE_EVENTS_TRUNCATED = NO
TRACE_RED_COMMAND = npm run test -w surdet-editor -- test/preview-stage-layout.test.ts
TRACE_RED_EXIT = 1
TRACE_RED_RESULT = 1 failed / 1 passed; stable trace layout contract absent
TRACE_GREEN_COMMAND = npm run test -w surdet-editor -- test/preview-stage-layout.test.ts test/preview-runtime-contract.test.ts test/preview-runtime-lifecycle.test.ts
TRACE_GREEN_EXIT = 0
TRACE_GREEN_RESULT = 3 files / 4 tests passed
TRACE_EDITOR_FULL_TEST_COMMAND = npm run test -w surdet-editor
TRACE_EDITOR_FULL_TEST_EXIT = 0
TRACE_EDITOR_FULL_TEST_RESULT = 28 files / 176 tests passed
TRACE_EDITOR_TYPECHECK_COMMAND = npm run typecheck -w surdet-editor
TRACE_EDITOR_TYPECHECK_EXIT = 0
TRACE_EDITOR_BUILD_COMMAND = npm run build -w surdet-editor
TRACE_EDITOR_BUILD_EXIT = 0
TRACE_EDITOR_BUILD_WARNING = existing Vite chunk >500 kB warning only
TRACE_VERIFY_DOCS = PASS; exit=0
TRACE_VERIFY_HYGIENE = PASS; exit=0; 698 tracked paths
TRACE_DIFF_CHECK = PASS; exit=0
TRACE_CACHED_DIFF_CHECK = PASS; exit=0
TRACE_CODE_EVIDENCE_HEAD = a3e59f081e559b3f9b15889edea104e91b810c07
TRACE_CODE_EVIDENCE_SCOPE = packages/editor/src/styles.css; packages/editor/test/preview-stage-layout.test.ts
TRACE_PRODUCTION_TRACE_DATA_CHANGED = NO
TRACE_EVENT_RENDERING_CHANGED = NO
TRACE_OWNER_RETEST = NOT_YET_PERFORMED
TRACE_FINAL_CLOSURE = NOT_CLAIMED
TRACE_STATUS = WAITING_FOR_OWNER_TRACE_LAYOUT_RETEST
PUSH = NOT_PERFORMED
WAVE_5 = NOT_STARTED
NEXT = WAITING_FOR_OWNER_TRACE_LAYOUT_RETEST
```
