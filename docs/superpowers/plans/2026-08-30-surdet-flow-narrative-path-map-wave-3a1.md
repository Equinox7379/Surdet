# Surdet Flow Narrative Path Map — Wave 3A.1

**Status:** CODE_AND_BROWSER_VERIFIED / OWNER_VISUAL_RETEST_PENDING / WAITING_FOR_REVIEW
**Date:** 2026-08-30
**Risk:** B — Editor-only visual, layout and accessibility correction
**Ledger authority:** `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`
**Project phase:** POST_WAVE_6 / PRE_WAVE_7_EDITOR_POLISH; historical local alias `Frontend Pass 3A.1`, not mainline Wave 3

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
- `packages/editor/src/flow-narrative-layout.ts`
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

---

## 9. Owner-approved long-form scaling extension

### 9.1 Confirmed design correction

- A single infinite canvas cannot remain readable for arbitrarily long stories. Wave 3A.1 must bound the default visible complexity instead of promising that the full technical graph will always look simple.
- The current Starter screenshot duplicates three attached choice relationships and three jumps to one destination in the same corridor. The owner approved replacing this ladder with attached option rows plus one shared merge bus.
- `ch02.gal` contains the real `@jump ch01_01.start` return. The business edge stays intact, while the readable default must express it as a compact `↩ 返回 ch01_01` marker instead of a canvas-wide return route.
- The product has no authoritative chapter hierarchy. This correction must not invent chapters, production states, probabilities or route importance.

### 9.2 Three presentation levels

#### 聚焦路径 — default

- Focus scene = current Editor scene when available, otherwise configured entry scene.
- Expand the focus scene with its real scene/label nodes and attached option wording.
- Show only forward one-hop neighbours: at most 3 direct predecessors and 4 direct successors in stable source order. Together with the focus scene, the default shows at most 8 real scene frames.
- Backward/return edges do not pull distant scenes into the focus neighbourhood.
- If a side exceeds its cap, show an honest count and a `在全局概览中查看` action; never silently imply that all neighbours are visible.
- Neighbour scenes are compact; only the focus scene exposes internal beats.

#### 全局概览 — on demand

- Show every real scene as a compact scene card without internal label rows.
- Aggregate cross-scene routes by source scene and destination scene. Same-destination outcomes share a single corridor bus.
- Keep search, current-scene centring and minimap navigation. Do not claim that global overview is a canonical play order.

#### 技术连接 — on demand

- Preserve the complete projectable node/edge projection for debugging and Agent inspection.
- Raw stable IDs, attached choice edges, source-order edges, duplicate edges and full return routes appear only here.
- Two raw edges whose endpoints are absent from the current projection remain reported as unprojectable; the UI must not fabricate endpoints.

### 9.3 Readable route rules

- Same-scene choice edges are presentation-hidden by default because the destination row already contains the exact option text.
- Two or more readable cross-scene routes from one scene to one destination share one merge corridor: short source stubs, one vertical bus and one outgoing trunk. Every underlying `FlowEdge` remains inspectable.
- A cross-scene edge whose destination is at the same or an earlier layout depth becomes a compact return marker in readable modes. Its full route remains available in technical mode.
- Hidden technical routes must not consume readable corridor lanes, change readable geometry or expand default fit bounds.
- No presentation-only bus, overflow summary or return marker may be counted as a real graph node.

### 9.4 Interfaces

```ts
export type FlowMapMode = 'focus' | 'overview';

export interface NarrativeLayoutOptions {
  mode: FlowMapMode;
  focusSceneId?: string;
  technical: boolean;
  maxPredecessors?: number;
  maxSuccessors?: number;
}

export interface NarrativeReturnMarker {
  edge: FlowEdge;
  sourceSceneId: string;
  targetSceneId: string;
  label: string;
}

export interface NarrativeFocusOverflow {
  predecessorCount: number;
  successorCount: number;
}
```

`buildNarrativeFlowLayout(graph, entryScene, options?)` keeps the existing two-argument call valid. `FlowGraph` remains the only business graph.

### 9.5 Execution tasks

- [x] **Task A — Permanent scale RED:** add contracts for maximum eight focus frames, stable neighbour selection, compact neighbours, global scene-only overview, choice-line suppression, same-target merge geometry and return-marker preservation.
- [x] **Task B — Pure layout GREEN:** implement optional presentation mode/options, focus overflow data, compact scene projection, merge buses and return markers in `flow-narrative-layout.ts` only.
- [x] **Task C — Human controls GREEN:** add `聚焦路径` / `全局概览` controls, overflow disclosure, readable return markers and stable focus restoration in `panels/flow.ts`; keep technical disclosure separate.
- [x] **Task D — Regression:** run the new contracts, existing Flow graph/edit/label/presentation/interaction contracts, complete Editor tests, typecheck and build.
- [x] **Task E — Browser evidence:** replace the current artifact with fresh isolated 1920/1440/1280/1024/800 evidence covering default focus, global overview, technical mode, merge bus, return marker, minimap, keyboard/pointer navigation, link/undo and unchanged Starter.
- [x] **Task F — Closure:** independent read-only review, exact code commit, append-only taskbook/master-ledger closure and stop before Timeline 3B.

No backend, shared-engine, graph-builder, dependency, file-format, Starter, deployment or push authority is added by this extension.

---

## 10. Execution closure — 2026-08-31

### Confirmed facts

- Planning/numbering correction commit: `c8f41b8e668fdf501997573159e953c44b868a41`, message `docs(editor): scale flow map for long stories`, exact scope = this taskbook plus the master Frontend Execution Ledger.
- Code evidence commit: `161f8dbe76361a731bf09a1b5dccb88b81140d47`, parent `c8f41b8e668fdf501997573159e953c44b868a41`, message `feat(editor): add scalable narrative path map`, exact scope = four Editor production files, four permanent product contracts, one browser runner and one runner contract.
- No Authoring, Core, CLI, FlowGraph builder, Renderer, Host, Shell, project format, DSL, dependency, lockfile or Starter production path is in the code commit.
- `buildNarrativeFlowLayout(graph, entryScene)` remains the complete technical projection. The optional third argument produces bounded focus or compact overview projections without changing `FlowGraph`.
- Default focus shows at most eight real scene frames. The focus scene exposes its real beats; direct neighbours remain compact; excess predecessor/successor counts are visible and link to global overview.
- Same-scene choice routes are technical-only because exact option wording is attached to the destination row. Same-source/same-destination jumps retain distinct `FlowEdge` identities while sharing a presentation trunk.
- Readable overview uses compact scene cards. Same-depth backward, earlier-depth and later-component-to-earlier-scene jumps become `↩ 返回目标` markers; technical mode preserves the full real route.
- Missing source/target edges are retained in `unprojectableEdges`; the technical explanation publicly reports `另有 2 条连接因端点缺失未显示` for the Starter rather than relying only on runner subtraction.
- Technical details are in normal document flow and cannot overlay the minimap. Focus, overview and technical modes keep independent pan/zoom state and auto-fit on mode change.

### RED → GREEN

- Initial long-form scale RED: `flow-narrative-map-contract.test.ts` = 20 tests / 15 pass / 5 fail. Failures precisely covered missing focus bounds, return marker, overview projection, attached-choice suppression and shared trunk.
- Return/unprojectable RED: 22 tests / 20 pass / 2 fail. Failures precisely covered same-depth/cross-component return classification and missing-endpoint reporting.
- Final permanent Flow contracts: 22/22 PASS.
- UI contracts: `editor-flow-workspace-contract.test.ts` 9/9 and `editor-flow-interaction-contract.test.ts` 11/11 PASS.
- Browser runner contract: 10/10 PASS; syntax check PASS.

### Technical gates

- Complete Editor tests: 45 files / 311 tests PASS.
- Editor typecheck: PASS.
- Editor production build: PASS; existing Vite `>500 kB` chunk advisory remains informational.
- Working and staged diff checks: PASS for the authorized scope.

### Browser evidence

```text
artifactRoot = C:\Users\Equinox\AppData\Local\Temp\surdet-editorial-flow-canvas-wave3a-WnTuWj
evidence.json = 185146 bytes; sha256 ACB842963F0DD52990BF8CF4DB0813377E0E91A44CA98E045BDCDA49336F1C8A
identity.json = 613 bytes; sha256 A15042CE7D64AC82E29C8DC8EC715B0E7421E21778003F58716E88C082B84D28
status = PASSED
milestones = 27 / 27 PASSED
originalStarterUnchanged = true
consoleErrors/pageErrors/requestFailures/stderrLines/cleanupFailures = 0
isolatedPort = 4211; portReleased = true
screenshots = 8
```

Key screenshot identities:

- focus 1440: `flow-1440.png`, 61007 bytes, SHA-256 `1F012E663C106FB3ACCE8222D49F838274BD1F0C88E6C6D16750BBC47A2613F7`;
- focus 800: `flow-800.png`, 57528 bytes, SHA-256 `868AB8305BAEAF15790DB85769E018930FB6A85D17F94E3937837E69EAE45B30`;
- global overview: `flow-global-overview.png`, 58829 bytes, SHA-256 `591035672D681628EDC0D42921B8FCD375EDB20C40109EB619C67F2B68F1645C`;
- technical: `flow-technical-connections.png`, 84316 bytes, SHA-256 `89942A2F066715388340064B6B48F3556C51DBBB9A03FE231821228153254EE4`.

### Independent review and evidence boundary

- First independent review found two HIGH items: same-depth/cross-component returns and UI-visible missing-endpoint reporting. Both received permanent RED, production correction and fresh browser evidence.
- Replacement independent review: `INDEPENDENT_REVIEW = PASS`; BLOCKER/HIGH/MEDIUM/LOW = none.
- Automated and independent evidence does not substitute for the Owner's final subjective visual retest. `OWNER_VISUAL_RETEST = NOT_STARTED`.

### Git and stop boundary

```text
CODE_EVIDENCE_HEAD = 161f8dbe76361a731bf09a1b5dccb88b81140d47
REMOTE_MAIN = f8943c293c4537b3867cc8eeea316b19bb4a0b40
PUSH = NOT_PERFORMED
MAINLINE_WAVE_7 = NOT_DESIGNED / NOT_AUTHORIZED / NOT_STARTED
NEXT = WAITING_FOR_OWNER_VISUAL_RETEST_AND_REVIEW_DECISION
```

The long-term project ledger remains untracked and unstaged. No screenshot, browser artifact, protected file or unrelated untracked path entered either commit.
