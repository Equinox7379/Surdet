# Surdet Flow Narrative Path Map — Wave 3A.1

**Status:** AUTHORIZED_BY_OWNER_FEEDBACK / IMPLEMENTATION_IN_PROGRESS  
**Date:** 2026-08-30  
**Risk:** B — Editor-only visual, layout and accessibility correction  
**Ledger authority:** `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`

---

## 1. Outcome

Replace the technically correct but visually awkward Flow graph with a human-readable **剧情路径地图**.

The page has one job: help a novice author answer, in reading order:

1. 从哪里开始；
2. 当前场景内部有哪些段落；
3. 哪个选择通向哪个分支；
4. 下一场景在哪里；
5. 哪些场景属于独立入口或尚未接入主流程。

It must not claim an author-declared canonical route because the current product has no such fact.

---

## 2. Confirmed problem

- The current layout stacks scene and label nodes independently by scene depth. Scene membership is visually weak.
- Host-entry nodes duplicate scene identity as large floating boxes.
- Choice text is rendered as a floating edge label such as `选项：沉默`, detached from both the choice point and its destination.
- Bézier routes cross nodes and labels and create a tangled reading order.
- Unconnected configured roots are pushed far below the main component without an explanatory region.
- Raw English label IDs dominate primary reading even though they are implementation identities.

These are presentation failures. The underlying graph and edit behavior remain valid.

---

## 3. Design contract

### 3.1 Subject and audience

- **Subject:** visual-novel narrative structure.
- **Audience:** writers and creators who may not know programming or graph terminology.
- **Primary vocabulary:** 场景、开场、分支、选择、条件、跳转、其他入口、技术信息.

### 3.2 Layout

```text
剧情路径地图

主流程
┌ 场景 ch01_01 ─────────────┐      ┌ 场景 ch01_02 ────────┐
│ 起始场景                  │      │ 开场                  │
│ 开场                      ├─────>│                       │
│ 选择“沉默”后              │      └───────────────────────┘
│ 选择“拔出剑”后 · 有条件    ├─────>┌ 场景 ch02 ───────────┐
│ 选择“转身离开”后          ├─────>│ 开场                  │
└───────────────────────────┘      └───────────────────────┘

其他入口
┌ 场景 ch03_turn_event ─────┐
│ 起始场景 · 警告 1          │
└───────────────────────────┘
```

- Scene membership is the dominant visual hierarchy: one scene frame contains its real scene node, labels and host-entry marker.
- The deterministic left-to-right projection is called `编辑视图中的主流程`, never an authoritative runtime or author-declared route.
- The configured entry scene begins the first component. Other configured roots or disconnected components appear under `其他入口` with an explicit heading.
- Scene frames use stable depth and source ordering. Layout must not depend on incidental object iteration.
- Connection routing is orthogonal and uses dedicated sequence, branch and return channels. Routes must not pass through node interiors.
- Fit bounds include scene frames, route channels and labels, not only node boxes.

### 3.3 Choice and condition language

- Do not render floating `选项：...` labels.
- When a choice edge lands on a label in the same scene, the destination row becomes `选择“真实选项文本”后`.
- A real condition is shown as a compact secondary marker such as `有条件`; its raw expression remains under technical detail/title.
- Cross-scene choices use an attached branch chip near the source route, containing only the real option text.
- No synthetic choice node is added to `FlowGraph.nodes`, node counts or edit identity.
- Presentation-only branch chips are not draggable, renamable, deletable or addressable as real nodes.

### 3.4 Visual language

- Retain the approved paper / ink / steel-blue application system.
- Scene frames are quiet structural containers, not generic elevated cards.
- No rainbow edges, gradient, glow, dotted demo board, colored selection rail or floating white label plates.
- Current, warning and error states continue to use border, surface, icon/text and ARIA—not color alone.

---

## 4. Truth and behavior boundaries

The existing `FlowGraph` remains the only graph truth:

- real nodes: `scene`, `label`, `host-entry`;
- real edges: `flow`, `goto`, `jump`, `call`, `switch`, `loop`, `choice`, `if`, `host`;
- no invented return edge, fallthrough edge, author-selected main path, path probability or coverage;
- no change to graph construction, compile output, scene text, EOL, history, undo, save or file format.

Must preserve:

- pointer and Enter / Space navigation to real nodes;
- real line-aware label navigation;
- drag-to-link through the existing `buildJumpLine -> appendLineToScene -> setSceneText` path;
- scene-only context menu rename/delete;
- pan, zoom, fit, current-scene centering, minimap and focus restoration;
- host-entry cannot become an editable jump source;
- existing graph model tests remain unchanged.

---

## 5. Authorized paths

### Production

- `packages/editor/src/panels/flow.ts`
- `packages/editor/src/flow-presentation.ts`
- `packages/editor/src/styles/flow-workspace.css`

### Permanent tests

- `packages/editor/test/flow-narrative-map-contract.test.ts`
- proportional updates to existing Flow presentation/layout tests only when the old visual contract is intentionally replaced.

### Browser evidence

- `packages/editor/e2e/editorial-flow-canvas-wave-3a.e2e.mjs`
- `packages/editor/test/editorial-flow-canvas-wave-3a-runner.test.mjs`

### Documentation

- this taskbook;
- the master Execution Ledger only.

Everything else requires an appended scope decision before edit.

---

## 6. Permanent RED

Establish failures against the current Wave 3A view for:

- scene frames contain every real node from that scene;
- entry scene is first; secondary configured/disconnected roots are explicitly separated;
- scene frames do not overlap;
- left-to-right scene depth is stable and includes every cross-scene real edge kind without declaring a canonical route;
- orthogonal routes and external channels do not cross node interiors;
- choice destination presentation uses real option text without `选项：`;
- conditional choice exposes human `有条件` plus raw technical expression;
- no presentation branch chip is counted or exposed as a real node;
- layout bounds include routes and scene frames;
- all prior navigation/edit/minimap behavior remains imported and callable.

RED must fail for missing narrative-map behavior, not syntax, fixture or environment.

---

## 7. Verification

Run proportionally:

1. new narrative-map contract plus existing Flow graph/edit/label/presentation/interaction contracts;
2. complete Editor test;
3. Editor typecheck and build;
4. `git diff --check`;
5. fresh isolated Chromium runner on a verified-free port other than 4173/4175;
6. real Starter picker path and unchanged Starter disk identity;
7. 1440, 1280, 1024 and 800 screenshots;
8. geometry assertions for scene containment, reading order, no overlap, attached choice language, orthogonal routes, fit/minimap and keyboard/pointer behavior;
9. empty browser, console, page, request, stderr and cleanup channels.

No `verify:all` is authorized for this Editor-only correction.

---

## 8. Commit and stop

- Ask an independent read-only reviewer to inspect exact diff and fresh evidence.
- Stage exact authorized paths only.
- Create one reviewed code commit and one docs-only closure commit if needed.
- Do not push.
- Stop before Timeline 3B, remote review, deployment or release.

