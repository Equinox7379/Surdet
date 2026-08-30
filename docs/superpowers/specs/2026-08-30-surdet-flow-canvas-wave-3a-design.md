# Surdet Flow Canvas — Wave 3A Design

**Date:** 2026-08-30

**Status:** owner direction approved; planning and implementation authorized without an intermediate approval pause

**Parent design:** `docs/superpowers/specs/2026-08-30-surdet-frontend-editorial-workbench-redesign-design.md`

**Master taskbook / single Execution Ledger:** `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`

---

## 1. Decision

Wave 3 is split into two independently verifiable frontend waves:

- **Wave 3A — Flow Canvas:** rebuild the existing flow mode as a professional Chinese narrative-flow desk while preserving its real graph, edit and navigation behavior.
- **Wave 3B — Timeline Desk:** rebuild the existing full-page timeline editor after 3A closes, with its own correctness and interaction gates.

The proposed script-page timeline Dock is deliberately deferred. The current scene can reference zero, one or multiple timelines, while `state.currentTimeline` is only the globally opened timeline and is not an authoritative “current scene timeline”. Showing the first or previously opened timeline in a script Dock would be visually plausible but factually wrong.

Wave 3A is Editor-only. It changes flow presentation and accessibility, not graph construction, scene text semantics, project IO, file formats or shared engine behavior.

---

## 2. Product goal

The flow page should feel like a purposeful desktop authoring instrument rather than a generic SVG demo:

- a compact local header states the real task: **剧情流程**;
- real counts report visible nodes, connections and validation severity;
- the graph occupies the dominant surface;
- a restrained toolbar controls the existing viewport;
- a Chinese legend explains real node and connection types;
- the minimap remains a true projection of the current layout;
- ordinary users see Chinese content and action language first;
- stable IDs, DSL instructions and fingerprints remain available only as technical details.

The mature reference is used for hierarchy, density and desktop-workbench discipline. It is not copied pixel-for-pixel and is not a license to invent unavailable production metadata.

---

## 3. Confirmed current capability

### 3.1 Graph truth

- `state.lastValidation.scenes` and real configuration roots are the only flow inputs.
- Nodes are real scenes, in-scene labels and configuration entry points.
- Edges include sequential flow, in-scene goto, cross-scene jump, call, switch, loop, choice, condition and configuration entry.
- Choice text, condition expressions, labels and scene IDs come from compiled project data.
- Layout is derived in memory; node coordinates are not persisted project facts.

### 3.2 Existing interaction to preserve

- pointer pan and wheel zoom;
- viewport culling and minimap navigation;
- click-to-open real scenes and labels;
- drag-to-link through the existing `buildJumpLine` / scene text / dirty / history path;
- context-menu rename and delete through the existing reference-rewrite helpers;
- real validation error and warning counts;
- the real current scene from `state.current`.

### 3.3 Existing tests to preserve

- graph model tests for real node and edge semantics;
- flow edit tests for references, link construction, EOL and text boundaries;
- flow label tests for the real Starter projection.

Wave 3A must not weaken or rewrite these tests merely to accommodate the new DOM.

---

## 4. Architecture boundary

### 4.1 Single truth

The page may introduce a pure presentation projection, but it must not introduce:

- another graph store;
- another current scene;
- persisted graph coordinates;
- a second scene parser;
- a second history stack;
- a fake Inspector, preview runtime, timeline or causal graph.

All buttons must act on the existing viewport, graph and edit callbacks. Decorative controls with no behavior are forbidden.

### 4.2 Allowed presentation projection

A small `flow-presentation.ts` module may map stable internal kinds to Chinese display language:

- node kinds: 场景、段落标记、项目入口;
- edge kinds: 顺序、段内跳转、场景跳转、调用、分支、循环、选项、条件、配置入口;
- validation states: 错误、警告、正常;
- technical details: raw kind, scene ID, label name, DSL instruction and exact condition.

The projection may format existing facts. It may not infer chapter, duration, completion, review or runtime data.

### 4.3 Styling boundary

Use the existing editorial tokens:

- frame: `--editor-frame` / carbon blue-black;
- paper and raised paper surfaces;
- ink and muted ink;
- restrained steel-blue focus;
- warning and danger tokens only for real validation semantics.

The flow page must not add gradients, glows, glass, rainbow connections, decorative pills, oversized marketing typography, floating primary actions or selection rails. Current selection uses the full node surface, complete outline and explicit text / ARIA state.

---

## 5. Information architecture

### 5.1 Desktop

```text
┌────────────────────────── 剧情流程 / real status ──────────────────────────┐
│ 当前场景 · 节点数 · 连接数 · 错误/警告  [缩小] [放大] [适应画布] [回到当前] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                           real SVG graph                                    │
│                                                                             │
│  legend / help                                        real minimap          │
└─────────────────────────────────────────────────────────────────────────────┘
```

- The graph is the only flexible primary region.
- Header and toolbar remain in normal document flow and never cover nodes.
- Legend and minimap are compact supporting instruments, not card stacks.
- Context-menu actions remain near the pointer but are constrained inside the viewport.

### 5.2 Narrow widths and 200% zoom

- At 1024 pixels, status and toolbar may wrap into two rows; the graph retains reachable height.
- At 800 pixels, the legend may collapse behind a real disclosure button; the minimap remains reachable and does not cover the toolbar.
- At 200% browser zoom, no command becomes unreachable and the page itself does not gain an uncontrolled competing scroll surface.
- The flow viewport may scroll or pan internally; header and commands remain stable.

---

## 6. Human-language contract

Ordinary interface text is Chinese-first:

- `@label start` becomes `段落 start` in the main label;
- `if ...` becomes `条件：...`;
- `host` becomes `由项目配置触发`;
- a created link reports `已新增剧情跳转，可撤销`;
- deletion warning reports the number of affected story connections;
- empty states distinguish `尚未校验` from `当前项目没有可显示的剧情连接`.

Raw `.gal`, `@jump`, `@goto`, `@call`, error codes and stable IDs remain available under **技术信息**, not erased from the product.

This is not blanket translation of serialized values. Internal enums and written project text stay stable.

---

## 7. Interaction and accessibility contract

- Nodes expose `role="button"`, `tabindex="0"` and a meaningful Chinese `aria-label`.
- Click, Enter and Space use the same scene / label navigation callback.
- The node title must say `点击打开` rather than the current inaccurate `双击跳转`.
- Error and warning state use text / icon shape in addition to color.
- Toolbar buttons expose stable `data-flow-action` values and operate on the existing `view` object.
- `适应画布` computes from the already-laid-out nodes; it does not persist or replace layout state.
- `回到当前` centers the real node for `state.current` when it exists and reports an honest unavailable state when it does not.
- Context-menu rename / delete remain the original functions; keyboard access may open the same menu or invoke the same command path.
- Drag-to-link must continue to update the current scene text, dirty state and undo history exactly once.

---

## 8. Unsupported reference features

Wave 3A must not show the following because the current product has no authoritative facts for them:

- chapter hierarchy, chapter titles or chapter duration;
- scene duration, completion, pending-review or lock state;
- collaboration, version, comment and notification counts;
- manually saved graph positions;
- branch probability, runtime path coverage or condition truth;
- exact source lines or object references for every edge;
- per-node ownership, author or production state;
- a live preview duplicated inside the flow page.

If these capabilities are later added to the engine, they require their own data contract and tests before presentation.

---

## 9. Wave split rationale

Flow and timeline are both high-interaction surfaces, but they do not share an edit model. Combining them would make failures difficult to attribute and would hide several timeline correctness gaps behind visual work.

Wave 3B therefore starts only after 3A closes. It must first address:

- timeline-specific undo instead of accidentally undoing scene text;
- destructive track-type replacement and cue deletion behavior;
- hardcoded Starter asset defaults;
- CRLF / LF preservation;
- tick overlap and narrow-layout reachability;
- Chinese display mappings while preserving serialized English enum values.

The script-page Dock remains out of scope until zero / one / multiple scene-timeline association behavior and single-mount selection ownership are explicitly defined.

---

## 10. Acceptance

### Automated

- permanent RED proves the old flow lacks the required semantic shell, Chinese projection, complete selection state and accessible node interaction;
- focused flow tests pass without weakening graph/edit semantics;
- complete Editor test, typecheck and build pass;
- CSS contract proves no flow-specific gradient, glow, rainbow palette or colored left selection rail;
- browser runner loads a copied real Starter and proves real graph nodes, configuration entry, choice / condition connection, navigation, pan, zoom, minimap and link editing / undo;
- browser evidence covers 1920, 1440, 1280, 1024 and 800 widths plus 200% zoom;
- browser error, request, stderr, cleanup and port-residue channels are empty;
- original Starter bytes remain unchanged.

### Human-visible

- the page reads as a professional narrative-flow tool at first glance;
- Chinese task language dominates ordinary use;
- real technical identity remains discoverable without crowding the main surface;
- the graph, not a stack of cards, is visually primary;
- selected and invalid states are understandable without relying on a colored stripe.

### Stop boundary

After Wave 3A technical closure, stop for review. Do not push or begin Timeline 3B in the same code-evidence commit.
