# Surdet Editorial Script Workspace — Wave 2 Design

**Date:** 2026-08-30

**Status:** Approved by owner direction; implementation authorized without an additional review pause

**Parent design:** `docs/superpowers/specs/2026-08-30-surdet-frontend-editorial-workbench-redesign-design.md`

**Parent taskbook:** `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md`

---

## 1. Decision

Wave 2 will rebuild the script mode as a mature **narrative continuity desk**:

- a real scene / asset outline on the left;
- one continuous manuscript in the center;
- current-object, validation and causal context on the right;
- a horizontal mode strip above the workspace so the left edge belongs to project content, not global navigation;
- deterministic narrowing at 1280 and 1024 pixels;
- no second scene selection, object selection, preview runtime, timeline state or authoring state.

The approved mature desktop reference is a hierarchy and workflow benchmark. It is not a license to fabricate chapter names, durations, production status, collaboration, versions, comments, character values or other unavailable facts.

Wave 2 is frontend-only. It preserves all existing script editing, history, search, asset insertion, project IO, validation and causal behavior.

---

## 2. Why the Wave 1 shell must change again

Wave 1 proved the application frame, eight-mode navigation, project context and save projection. Its vertical mode rail is technically sound, but it consumes the exact horizontal space needed by the scene outline, manuscript and Inspector. Keeping it would force four competing columns at 1440 pixels and would make the reference-level workbench structurally impossible.

Therefore Wave 2 deliberately revises one Wave 1 visual decision:

- the eight modes move to a horizontal strip below the project bar;
- the semantic `EDITOR_MODES`, callback, stable panel IDs and keyboard focus contract stay unchanged;
- this is a CSS / shell-layout correction, not a navigation or business-state rewrite.

This is not a failure of Wave 1. The owner has now supplied a stronger final-workbench benchmark, and the new evidence changes the best layout decision.

---

## 3. Confirmed current capabilities

### 3.1 Scene and manuscript truth

- `state.scenes` is the only loaded scene collection.
- `state.current` is the only current scene identity.
- a scene contains only its real id, file, text, EOL, dirty flag and optional handle.
- `parseScript()` projects ordered `.gal` text into editable line models.
- every edit ultimately goes through the existing history path and writes back to the same scene entry.

### 3.2 Object selection truth

- `state.selectedObjectRef` is the only selected authoring object.
- `state.authoringIndex` resolves the current scene line to a shared object reference.
- the existing `surdet-authoring-selection` event refreshes manuscript selection, timeline linkage and the causal panel.
- Wave 2 must not introduce a private `selectedBlock`, `selectedRow` or Inspector-only selection.

### 3.3 Asset truth

- `buildAssetInventory()` is the only asset inventory projection.
- it combines real directory entries, `gallery.json` and compiled script usage.
- insert, copy and image-hover preview already exist and must remain on their current callback paths.
- referenced and unreferenced assets are both real and must remain visible.

### 3.4 Context truth

- validation issues come from `state.lastValidation`.
- scene edges come from `state.lastEdges`.
- causal object details come from the shared authoring index, selected object and preview trace.
- variables come from the loaded `game.config.json` text.

### 3.5 Existing behavior to preserve

- text, label, instruction, choice and raw-line editing;
- line insert, delete, move up and move down;
- search, regex search and replace-all;
- undo, redo, dirty state, save and partial-save failure;
- scene creation and project loading;
- asset insertion, key copy and real image hover preview;
- issue-to-scene jump, search-to-line jump and causal selection;
- validation scheduling and authoring-index rebuilding.

---

## 4. Unsupported reference features

Wave 2 must omit the following because Surdet does not currently expose reliable facts for them:

- chapter names, chapter hierarchy and human-authored scene titles;
- scene, chapter or project duration;
- complete / in progress / pending review / locked production states;
- save timestamps, version numbers, collaborators, comments and notifications;
- character position, emotion, affinity, attention, goals or recent state changes;
- audio duration, camera duration and estimated play time;
- a second live preview iframe inside script mode;
- a duplicate timeline editor or causal state.

Real relative directories may group scene paths, but the UI must call them folders or paths, not chapters. Real character counts may be shown, but they must not be presented as duration estimates.

---

## 5. Approaches considered

### Approach A — Narrative continuity desk (selected)

Left outline, central continuous manuscript and right context share one current scene. It uses existing data and callbacks and provides the closest safe approximation to the mature reference.

### Approach B — Three-column storyboard table (rejected)

Splitting the manuscript into narrative, dialogue and interaction columns looks similar to the reference, but `.gal` is one ordered stream. A table would create cross-column ordering ambiguity, make move / insert / undo behavior harder to understand and risk a second projection becoming editable truth.

### Approach C — Manuscript-only focus mode (used only as responsive fallback)

This is the safest narrow layout but is too sparse as the main desktop experience. Wave 2 uses it only when 1024-pixel space cannot safely hold all context.

---

## 6. Information architecture

### 6.1 Desktop, 1440 pixels and above

```text
┌──────────────────────────────── Project bar ────────────────────────────────┐
├──────────────────────────────── Mode strip ─────────────────────────────────┤
│ Scene / Asset outline │ Continuous manuscript               │ Context       │
│ real folders          │ search + scene heading              │ current fact  │
│ real dirty/count      │ ordered editable lines              │ validation    │
│ real asset usage      │ technical details disclosed         │ causal/ref    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- The manuscript is the only flexible `minmax(0, 1fr)` primary column.
- Outline and context widths are bounded.
- Each region owns its own heading and one scroll surface.
- The page itself never becomes a competing long scroll surface.

### 6.2 1280 pixels

- all three regions remain available;
- outline and context become narrower;
- secondary text truncates with full accessible titles;
- technical disclosures remain closed by default.

### 6.3 1024 pixels

- outline plus manuscript remain visible by default;
- context is hidden in normal flow and opened by a keyboard-operable `上下文` button;
- opening context replaces the outline auxiliary column instead of overlaying the manuscript;
- `aria-controls` and `aria-expanded` communicate the state;
- no `position: fixed` or absolute drawer may cover editing content.

---

## 7. Visual direction

### 7.1 Subject

This is a narrative authoring desk for writers and visual-novel designers. Its visual language comes from a script supervisor's continuity sheet, not a SaaS dashboard.

### 7.2 Palette

Wave 2 continues the committed semantic tokens:

- Frame Ink `#162832` — project chrome;
- Paper `#F6F7F5` — application ground;
- Sheet `#FFFFFF` — manuscript surface;
- Graphite `#1A1E21` — primary text;
- Rule `#D7DBDC` — structural boundaries;
- Slate Blue `#315B78` — actions and focus only;
- Muted Selection `#E1E8E5` — selected whole surfaces;
- state colors only when they encode a real success, warning or danger fact.

No gradient, glow, glass, decorative shadow, universal pill or colored status rail is allowed.

### 7.3 Typography

- UI: `Segoe UI`, `Microsoft YaHei UI`, `PingFang SC`, sans-serif;
- manuscript prose: `Noto Serif CJK SC`, `Source Han Serif SC`, `Songti SC`, with the UI stack as fallback;
- technical details: `Cascadia Mono`, `Sarasa Mono SC`, `Consolas`, monospace.

The serif role is limited to story content. Controls, labels and states remain direct sans-serif Chinese.

### 7.4 Signature

The memorable element is the **continuity sheet**:

- stable neutral line-number gutter;
- line-type label that names real script semantics;
- story content arranged as one readable sequence;
- line operations quiet until focus or hover;
- raw text and object identity under `技术信息` disclosure;
- current line uses full-surface fill, full boundary and explicit `当前段`, never a colored left bar.

---

## 8. Component design

### 8.1 Horizontal mode strip

- reuse `renderModeNavigation()` and `EDITOR_MODES` unchanged;
- preserve button semantics, `aria-current` and panel IDs;
- change only layout, spacing and active treatment;
- ensure the strip remains horizontally scrollable below 1024 without hiding modes.

### 8.2 `authoring-workbench.ts`

This new module is a pure DOM topology builder. It may:

- create the outline, manuscript, context and future-dock semantic regions;
- return stable containers used by `main.ts`;
- own only ephemeral open / closed presentation state for auxiliary panels;
- expose buttons and ARIA for responsive region reveal.

It must not import or mutate Editor business state, project IO, history, preview, timeline or validation.

### 8.3 Scene / asset outline

- scene and asset modes use native tab semantics;
- scene rows are buttons with `data-scene-id` and `aria-selected`;
- real relative directories may form folder groups;
- each scene shows a real id / path, dirty state and real character count;
- assets show real type, key, source, usage and existing actions;
- selection uses complete surface treatment, text and ARIA, never a left rail.

### 8.4 Continuous manuscript

- the manuscript root is an `article` with the current real scene id;
- every line keeps `.block[data-line][data-object-ref]` compatibility;
- each line is keyboard focusable and selectable with click, Enter or Space;
- line number and type are visible but quiet;
- text, instruction and choice fields continue using the existing edit callbacks;
- raw text and object reference live under `details > summary` labelled `技术信息`;
- operations retain exact behavior and become visible on focus / hover.

### 8.5 Context Inspector

- starts with a real current-scene summary: path, character count and dirty state;
- current object, position, references and causal evidence come from existing projections;
- validation remains a distinct section;
- global variables and topology are labelled as project context, not current-object facts;
- technical IDs remain available but subordinate.

### 8.6 Search and jump

- search and replace stay in the manuscript toolbar;
- all scene changes route through one composition-root coordinator;
- switching scene clears an object reference from the previous scene;
- search or issue jump selects the real destination object reference when available;
- visual selection may never be applied without updating semantic selection.

### 8.7 Future Dock boundary

Wave 2 creates a stable semantic dock region only if it has real content. It must not create a timeline, preview or causal imitation. Wave 3 and Wave 5 may later move or reuse the one real timeline / preview projection into that region.

---

## 9. Error, empty and partial states

- no project: explain how to open a project; do not show fake manuscript rows;
- no scene: provide `新建场景` as the next action;
- no assets: state the three real scan sources;
- missing previewable file: say `暂无可预览文件` instead of generating artwork;
- validation missing: say `尚未校验`;
- invalid config: preserve the existing parse-failure message;
- partial save: keep the project-bar partial failure state and dirty facts;
- narrow layout: keep editing possible even when context is collapsed.

---

## 10. Single-selection invariants

1. `state.current` is the only current scene.
2. `state.selectedObjectRef` is the only current authoring object.
3. Scene selection from outline, search and issue navigation uses one coordinator.
4. Changing scene clears an object reference from the previous scene before rendering.
5. Jumping to a line writes the resolved destination object reference before marking it current.
6. Outline, manuscript and Inspector project these facts; none owns a private copy.
7. Preview and timeline modes remain single-instance and are not mounted in script mode during Wave 2.

---

## 11. Accessibility

- native buttons for scene rows and region toggles;
- native tabs for scenes / assets;
- `aria-selected`, `aria-current`, `aria-controls` and `aria-expanded` reflect actual state;
- manuscript lines are keyboard reachable and respond to Enter / Space;
- selected state is not color-only;
- focus ring remains 2 pixels and visible on every surface;
- 200% browser zoom retains the manuscript task and reachable auxiliary regions;
- reduced-motion mode removes nonessential transitions.

---

## 12. Testing strategy

### 12.1 Permanent contracts

- integrated region topology and responsive controls;
- scene / asset tabs and accessible rows;
- continuous manuscript semantics and technical disclosure;
- one current scene and one selected object across navigation routes;
- no active colored left rails in scene, asset or manuscript selectors;
- no duplicate iframe, trace or timeline editor in script mode.

### 12.2 Existing semantic regression

- asset inventory and insert-line helpers;
- presentation asset catalog;
- search and replace;
- history and model round-trip;
- project IO;
- causal selection;
- global versus workspace action scope.

### 12.3 Browser fixture runner

A test-only runner will inject an isolated copy of `examples/starter` through a fake File System Access boundary. It will not add a production fixture loader. It must prove:

- project identity and real scene count;
- 1440, 1280 and 1024 geometry;
- scene selection consistency;
- search-to-line semantic selection;
- edit, undo and dirty state;
- referenced / unreferenced asset visibility and insert behavior;
- no horizontal page overflow;
- no second preview iframe, trace projection or timeline editor;
- screenshots and evidence written outside the repository.

### 12.4 Required gates

- focused Wave 2 contracts;
- adjacent semantic tests;
- complete Editor suite;
- Editor typecheck;
- Editor build;
- the test-only real-fixture browser runner;
- local independent diff review.

`verify:all` is not required because this wave changes only Editor frontend code and tests.

---

## 13. Scope

### Authorized

- `packages/editor` production, test and test-only E2E files needed by this design;
- this Wave 2 design and taskbook;
- append-only facts in the current frontend-redesign master taskbook Execution Ledger.

### Forbidden

- `packages/authoring`, `packages/core`, `packages/cli`, `packages/host`, `packages/shell` production code;
- Starter or game content;
- dependencies and lockfile;
- preview, timeline or causal business semantics;
- backend fields created only to populate the reference layout;
- protected and pre-existing untracked files;
- push, deployment or release.

---

## 14. Completion criteria

Wave 2 is complete only when:

- script mode is a real three-region authoring desk at desktop widths;
- the manuscript is visibly continuous and remains the primary region;
- horizontal mode navigation releases the left edge for project content;
- scene / asset / manuscript selection has no colored left rail;
- scene and object selection are semantically synchronized;
- all editing, history, search, asset and project IO behavior remains green;
- the real Starter fixture passes browser interaction and geometry checks;
- no unsupported reference fact is displayed;
- no duplicate preview or timeline state exists;
- code and docs are precisely committed;
- the master Execution Ledger records confirmed facts, inferences, unverified items and the Wave 3 stop boundary;
- no push has occurred.
