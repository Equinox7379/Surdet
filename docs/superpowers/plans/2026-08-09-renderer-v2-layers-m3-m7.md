# Surdet Renderer v2 Layer Migration M3–M7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use parallel subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Dialogue, Menu, Gallery, SystemPanel, and World implementations from `PixiStage` into independently owned and tested Layers while preserving v2 and legacy behavior and proving resource stability after every extraction.

**Architecture:** Each Layer owns its Pixi containers, local state, callbacks, animations, and lifecycle scope. It receives `RenderAssetRegistry` and other narrow services through its constructor, exposes a typed port consumed by `RendererFacade`, and never imports another Layer. `PixiStage` delegates to the facade throughout the one-version compatibility window.

**Tech Stack:** TypeScript 5.7, PixiJS 8.19, Vitest 3, Playwright 1.49, Electron 43, Vite 6, npm workspaces.

## Global Constraints

- M0, M1, and M2 reports must be approved before M3 starts.
- Work in strict order M3 → M4 → M5 → M6 → M7. Stop after each report.
- Do not change public behavior, DSL, save format, host rules, asset naming, visual copy, key bindings, callbacks, or overlay semantics.
- A Layer must not import another Layer. Cross-layer show/hide decisions belong to `RendererFacade` or `PresentationController`.
- Each moved field has exactly one owner after its milestone. Delete the old field only after parity tests are green.
- Move implementation, not just method names. `PixiStage` may delegate but must not retain duplicate private bodies.
- Every Layer uses owner-scoped `RenderLifecycle`, `AsyncGeneration` where asynchronous, and the shared `RenderAssetRegistry`.
- Query methods return safe copies and create no persistent objects.
- Each milestone runs two consecutive 50-cycle batches and compares the stable resource snapshot.
- Only migration-blocking defects may be fixed, with a failing test first and a separate report entry.
- Never bulk-update screenshots. Every visual delta requires an explanation and approval.

---

## Shared Layer Port Shape

Every Layer implements this lifecycle surface in addition to its domain methods:

```ts
export interface RenderLayer {
  readonly owner: ResourceOwner;
  readonly needsUpdate: boolean;
  setFrameRequest(handler: FrameRequestHandler | null): void;
  update(deltaMs: number): void;
  reset(options?: ResetSessionOptions): void;
  dispose(): void;
}
```

Each concrete constructor receives only its dependencies. Example:

```ts
export interface DialogueLayerOptions {
  root: Container;
  width: number;
  height: number;
  assets: RenderAssetRegistry;
  lifecycle: RenderLifecycle;
  requestFrame: () => void;
  presentation: () => PresentationPreferences;
}
```

Do not introduce `LayerContext` containing the whole Runtime; that would recreate global coupling.

### Task 11: Enforce Layer import boundaries before extraction

**Files:**
- Create: `scripts/check-renderer-boundaries.mjs`
- Create: `scripts/test/renderer-boundaries.test.mjs`
- Modify: `package.json`
- Modify: `scripts/verify-all.mjs`

**Interfaces:**
- Produces: `checkRendererBoundaries(root): string[]`
- Produces: `npm run verify:renderer-boundaries`

- [ ] **Step 1: Write a RED fixture test**

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkRendererBoundaries } from '../check-renderer-boundaries.mjs';

test('rejects a Layer importing another Layer', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-layer-boundary-'));
  const dialogue = path.join(root, 'packages/renderer/src/layers/dialogue');
  fs.mkdirSync(dialogue, { recursive: true });
  fs.writeFileSync(path.join(dialogue, 'dialogue-layer.ts'), "import '../world/world-layer.js';\n");
  assert.deepEqual(checkRendererBoundaries(root), [
    'packages/renderer/src/layers/dialogue/dialogue-layer.ts imports another Layer: ../world/world-layer.js',
  ]);
});
```

- [ ] **Step 2: Run RED**

```powershell
node --test scripts/test/renderer-boundaries.test.mjs
```

- [ ] **Step 3: Implement the static boundary check**

Parse static/dynamic import specifiers in `packages/renderer/src/layers/**/*.ts`. Resolve the first directory under `layers`; reject an import whose target resolves under a different Layer directory. Also reject imports from `legacy/` and direct imports of example/game code.

Return sorted human-readable failures; CLI prints each and exits 1. Do not use regex to rewrite code.

- [ ] **Step 4: Add and run the gate**

```json
"verify:renderer-boundaries": "node --test scripts/test/renderer-boundaries.test.mjs && node scripts/check-renderer-boundaries.mjs"
```

Add one unique `renderer-boundaries` step to `verify-all.mjs`.

```powershell
npm run verify:renderer-boundaries
```

Expected: fixture test PASS; repository check PASS.

- [ ] **Step 5: Commit Task 11**

```powershell
git add -- scripts/check-renderer-boundaries.mjs scripts/test/renderer-boundaries.test.mjs scripts/verify-all.mjs package.json
git diff --cached --check
git commit -m "test(renderer): enforce Layer dependency boundaries"
```

## M3 — DialogueLayer

### Task 12: Freeze the Dialogue legacy contract

**Files:**
- Create: `packages/renderer/test/layers/dialogue-layer.test.ts`
- Create: `packages/renderer/test/legacy/legacy-dialogue-contract.test.ts`
- Read: `packages/renderer/src/pixi-stage.ts`
- Read: `packages/renderer/src/adv-renderer.ts`

**Interfaces:**
- Covers `DialogueCommands`, `DialogueQueries`, Controller dialogue state, and legacy Stage methods

- [ ] **Step 1: Write contract tests before moving code**

Use the existing Pixi test harness and assert observable states for:

```text
showText / speaker-null narration / repeated text
showChoices / highlight / hideChoices / onSelect
setAwaiting / continue pulse
showBacklog / search / scroll / voice replay / close callback
setNvlMode / appendNvlText / clearNvlText
showBanner chapter/tip and expiry
showCommandRail / update / hide / callback
hideInterface preserving world
setSpeakerProfiles / setActiveSpeaker / avatar lookup
resetSession and repeated destroy
```

Representative parity assertion:

```ts
it('legacy and v2 dialogue paths expose the same state', () => {
  legacy.showText('林恩', '同一句话');
  v2.commands.dialogue.showText('林恩', '同一句话');
  expect(observeDialogue(legacy)).toEqual(observeDialogue(v2));
});
```

- [ ] **Step 2: Run tests on the pre-extraction implementation**

```powershell
npm test -w @surdet/renderer -- dialogue-layer.test.ts legacy-dialogue-contract.test.ts pixi-stage.test.ts adv-renderer.test.ts
```

Expected: new tests PASS against current/facade behavior. If a test exposes an existing defect, classify it before changing source.

- [ ] **Step 3: Commit contract tests**

```powershell
git add -- packages/renderer/test/layers/dialogue-layer.test.ts packages/renderer/test/legacy/legacy-dialogue-contract.test.ts
git diff --cached --check
git commit -m "test(renderer): freeze dialogue projection contract"
```

### Task 13: Extract DialogueLayer implementation

**Files:**
- Create: `packages/renderer/src/layers/dialogue/dialogue-layer.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/runtime/renderer-facade.ts`
- Modify: `packages/renderer/src/runtime/create-renderer-runtime.ts`
- Modify: `packages/renderer/src/runtime/presentation-controller.ts`
- Modify: `packages/renderer/src/api/renderer-commands.ts`
- Modify: `packages/renderer/src/api/renderer-queries.ts`
- Modify: `packages/renderer/src/index.ts`
- Test: dialogue and legacy contract tests

**Interfaces:**
- Produces: `DialogueLayer`, `DialogueLayerOptions`
- Consumes: `RenderAssetRegistry`, `RenderLifecycle`, `PresentationPreferences`

- [ ] **Step 1: Create the Layer with explicit owned fields**

Move these field families from `PixiStage` and no others:

```text
speakerText, dialogText, lastShownSpeaker, lastShownDialog, speakerPlate,
dialogCharsPerLine, dialogPanel, dialogRubyLayer, rubyBasePool, rubyTextPool,
choiceLayer, choiceViews, choiceHighlight, choiceFadeRemain, choiceFadeDur,
continueIndicator, continuePhase, backlogEntriesLayer, backlogScroll,
backlogContentH, backlogLayer, backlogBuilt, nvlLayer, nvlLines,
nvlLineCounts, nvlActive, nvlCharsPerLine, bannerLayer, bannerText,
bannerBars, bannerTipBg, bannerRemain, bannerDur, commandRail,
commandRailItems, commandRailOnSelect, commandRailSuppressed,
commandRailWakeRemain, commandRailIdleAlpha, commandRailPointerWake,
speakerProfiles, activeSpeakerId, speakerAvatar, interfaceHidden,
onSelect, onBacklogClose
```

Do not move background, portrait Sprite, Gallery, menu, battle/map/shop/base, video, font registry, or world effect fields.

Implement all `DialogueCommands` and `DialogueQueries` directly. Use `assets.resolveAvatar()` and `assets.fontFamily()`; do not create local asset maps.

- [ ] **Step 2: Register every local resource**

All listeners, timers, fades, pools and display-object owners use lifecycle owner `dialogue`. `dispose()` calls `releaseOwner('dialogue')` after detaching the root. Pool diagnostics report bounded sizes.

- [ ] **Step 3: Replace Stage bodies with delegation**

Each moved public Stage method becomes one call, for example:

```ts
showText(speaker: string | null, value: string): void {
  this.#runtime.commands.dialogue.showText(speaker, value);
}
```

Do not leave the old private fields or rendering body in `PixiStage` after parity tests pass. `onSelect` and `onBacklogClose` legacy setters/getters delegate to Layer callback ports.

- [ ] **Step 4: Wire Controller only through commands/queries**

Presentation Controller must not import `DialogueLayer`. Replace Stage calls with `commands.dialogue` and state reads with `queries.dialogue`.

Facade implements `commands.dialogue.setActiveSpeaker(characterId)` as two explicit port calls: DialogueLayer updates speaker avatar/label state and WorldLayer updates portrait focus. Neither Layer imports the other.

- [ ] **Step 5: Run targeted, resource, boundary, and full gates**

```powershell
npm test -w @surdet/renderer -- dialogue-layer.test.ts legacy-dialogue-contract.test.ts adv-renderer.test.ts nvl.test.ts ruby-layout.test.ts backlog-search-controller.test.ts resource-cycles.test.ts
npm run verify:renderer-boundaries
npm run verify:all
```

Run two 50-cycle dialogue batches; expected stable snapshots equal and all dialogue resources return to baseline/pool cap.

- [ ] **Step 6: Compare deterministic visual states**

Compare ADV+Ruby, narration, choice, NVL, Backlog, Banner, Command Rail and hidden-interface states. Any delta requires a named diff artifact and approval; do not update baselines automatically.

- [ ] **Step 7: Commit and report M3**

Commit extraction as `refactor(renderer): extract dialogue layer`. Create `docs/ENGINE-RENDERER-V2-M3-DELIVERY-REPORT-2026-08-09.md`, commit it separately, and stop for approval.

## M4 — MenuLayer

### Task 14: Freeze and extract MenuLayer

**Files:**
- Create: `packages/renderer/src/layers/menu/menu-layer.ts`
- Create: `packages/renderer/test/layers/menu-layer.test.ts`
- Create: `packages/renderer/test/legacy/legacy-menu-contract.test.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/runtime/renderer-facade.ts`
- Modify: `packages/renderer/src/runtime/create-renderer-runtime.ts`
- Test: `packages/renderer/test/ui-views.test.ts`, `pixi-stage.test.ts`

**Interfaces:**
- Produces: `MenuLayer`, `MenuLayerOptions`
- Implements: `MenuCommands`, relevant `OverlayQueries`

- [ ] **Step 1: Add RED/characterization coverage**

Cover title item selection and disabled states, ending show/hide, system menu callbacks, settings row updates, save/load slot callbacks, mode switching, close behavior, repeated show/hide, reset and callback exceptions.

View models remain the existing types. Tests must prove MenuLayer never calls save/profile/settings storage directly.

- [ ] **Step 2: Run pre-extraction contract tests**

```powershell
npm test -w @surdet/renderer -- menu-layer.test.ts legacy-menu-contract.test.ts ui-views.test.ts pixi-stage.test.ts
```

- [ ] **Step 3: Move exact menu field families**

```text
titleLayer, titleHandler, endingLayer,
menuLayer, menuPanel, menuMotionRemain, menuMotionDur, menuMotionOffset,
menuHandlers, settingsLayer, settingsRows, settingsHandlers,
saveLoadLayer, saveLoadHandlers
```

Move methods `showTitle/hideTitle`, `showEnding/hideEnding`, `showSystemMenu/hideSystemMenu`, `showSettings/hideSettings`, `showSaveLoad/hideSaveLoad`. Do not move persistence, Profile, Interpreter or host state.

- [ ] **Step 4: Implement overlay coordination in Facade**

Facade records the active modal overlay as a discriminated union. Showing one menu overlay closes only the previously exclusive menu overlay according to current behavior. Query returns a copy:

```ts
export type MenuOverlayState =
  | { type: 'none' }
  | { type: 'title' }
  | { type: 'ending' }
  | { type: 'system-menu' }
  | { type: 'settings' }
  | { type: 'save-load'; mode: 'save' | 'load' };
```

`OverlayQueries.menu()` returns `MenuOverlayState`. Gallery and SystemPanel add separate query fields in M5/M6, so concurrent non-menu overlays are represented without widening this union. The Task 14 characterization test must prove that baseline menu overlays are mutually exclusive; if the baseline test disproves that contract, stop and request a design amendment before implementation.

- [ ] **Step 5: Delegate legacy methods and remove duplicate fields**

Old Stage methods call v2 once. MenuLayer registers owner `menu`; dispose and 50-cycle tests prove no listener/display-object growth.

- [ ] **Step 6: Run gates and visual checks**

```powershell
npm test -w @surdet/renderer -- menu-layer.test.ts legacy-menu-contract.test.ts ui-views.test.ts resource-cycles.test.ts
npm run verify:renderer-boundaries
npm run verify:all
```

Compare title, ending, system menu, settings, save and load deterministic states.

- [ ] **Step 7: Commit and report M4**

Commit `refactor(renderer): extract menu layer`; write/commit M4 report; stop for approval.

## M5 — GalleryLayer

### Task 15: Freeze and extract GalleryLayer

**Files:**
- Create: `packages/renderer/src/layers/gallery/gallery-layer.ts`
- Create: `packages/renderer/test/layers/gallery-layer.test.ts`
- Create: `packages/renderer/test/legacy/legacy-gallery-contract.test.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/runtime/renderer-facade.ts`
- Modify: `packages/renderer/src/runtime/create-renderer-runtime.ts`
- Test: `packages/renderer/test/gallery.test.ts`

**Interfaces:**
- Produces: `GalleryLayer`, `GalleryLayerOptions`
- Implements: `GalleryCommands`, Gallery portion of `OverlayQueries`

- [ ] **Step 1: Add direct contract tests**

Cover CG/music/text tabs, locked/unlocked view models, viewer open/close, music and text replay callbacks, close callback, repeated show/update/hide, reset, empty lists and callback exceptions. Assert Gallery receives already-filtered view models and does not import Core Gallery state.

- [ ] **Step 2: Move exact gallery ownership**

Move only:

```text
galleryLayer, galleryTab, galleryMode, galleryViews,
galleryOnPlayMusic, galleryOnReplayText, galleryOnClose, galleryViewerKey
```

Move `showGallery/hideGallery`. Retain `buildGalleryViews` in its focused module unless implementation ownership clearly requires a typed import; do not duplicate it.

- [ ] **Step 3: Delegate and prove resources**

Legacy Stage delegates. Lifecycle owner is `gallery`. Two 50-cycle batches must stabilize. Query returns tab/mode/viewer key as a safe value, not Containers.

- [ ] **Step 4: Run gates and visual checks**

```powershell
npm test -w @surdet/renderer -- gallery-layer.test.ts legacy-gallery-contract.test.ts gallery.test.ts resource-cycles.test.ts
npm run verify:renderer-boundaries
npm run verify:all
```

Compare CG grid/viewer, music list and text-replay list.

- [ ] **Step 5: Commit and report M5**

Commit `refactor(renderer): extract gallery layer`; write/commit M5 report; stop for approval.

## M6 — SystemPanelLayer

### Task 16: Freeze and extract SystemPanelLayer

**Files:**
- Create: `packages/renderer/src/layers/system-panel/system-panel-layer.ts`
- Create: `packages/renderer/test/layers/system-panel-layer.test.ts`
- Create: `packages/renderer/test/legacy/legacy-system-panel-contract.test.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/runtime/renderer-facade.ts`
- Modify: `packages/renderer/src/runtime/create-renderer-runtime.ts`
- Test: `packages/renderer/test/gallery.test.ts` (`buildBattleView`), existing UI view tests
- Test: `packages/host/test/system-router.test.ts`

**Interfaces:**
- Produces: `SystemPanelLayer`, `SystemPanelLayerOptions`
- Implements: `SystemPanelCommands`, system portion of `OverlayQueries`

- [ ] **Step 1: Add direct contracts before extraction**

Cover:

```text
battle view, unit/skill/target/move callbacks, hide/reset;
map nodes and travel/close callbacks;
shop inventory/buy/sell/close callbacks;
base command selection/close;
video normal end/error/skip/hide/late-end-after-hide;
callback exceptions and repeated show/hide.
```

Assert the Layer never imports Interpreter, VariableStore, Combat, Calendar, Shop or Host adapters.

- [ ] **Step 2: Move exact field families**

```text
battleLayer, battleHandlers, battleSelectedSkill,
mapLayer, mapHandlers,
shopLayer, shopHandlers,
baseLayer, baseHandlers,
activeVideo
```

Move `showBattle/hideBattle`, `showMap/hideMap`, `showShop/hideShop`, `showBaseCommands/hideBase`, `showVideo/hideVideo`.

- [ ] **Step 3: Make video cancellation explicit**

Use an `AsyncGeneration` owned by SystemPanelLayer. `hideVideo`, reset and dispose invalidate the token before detaching media. A late `ended`/`error` event must not invoke the old callback or recreate state. Cancellation is not sent to crash reporting.

- [ ] **Step 4: Delegate and run transactional/system gates**

```powershell
npm test -w @surdet/renderer -- system-panel-layer.test.ts legacy-system-panel-contract.test.ts gallery.test.ts resource-cycles.test.ts
npm test -w @surdet/host -- system-router.test.ts
npm test -w @surdet/core -- interpreter-save.test.ts variable-store.test.ts
npm run verify:renderer-boundaries
npm run verify:all
```

Two 50-cycle batches cover each panel. Run the starter system-boundary probe; expect `opened=true`, `hadRollback=true`, `rollbackBlocked=true`.

- [ ] **Step 5: Visual and behavior comparison**

Compare battle, map, shop, base and video overlay states. Confirm pause/resume, save/load and rollback restrictions remain host-owned and unchanged.

- [ ] **Step 6: Commit and report M6**

Commit `refactor(renderer): extract system panel layer`; write/commit M6 report; stop for approval.

## M7 — WorldLayer

### Task 17: Freeze the complete World/presentation contract

**Files:**
- Create: `packages/renderer/test/layers/world-layer.test.ts`
- Create: `packages/renderer/test/legacy/legacy-world-contract.test.ts`
- Modify only tests in this task

**Interfaces:**
- Covers `WorldCommands`, `WorldQueries`, presentation snapshot/restore and legacy world methods

- [ ] **Step 1: Characterize all world behavior**

Cover background null/key/replacement, portrait composite/character keys, active speaker dimming, move, fade, shake directions, transition known/unknown, flash, zoom, wipe, tint set/clear, particles start/stop, timeline frames, reduced-motion, quality/post-process, frame requests, thumbnail query, reset preserveWorld, clearPresentation, snapshot and restore validation.

Add a direct test proving invalid presentation restore does not partially mutate any world state.

- [ ] **Step 2: Run pre-extraction tests**

```powershell
npm test -w @surdet/renderer -- world-layer.test.ts legacy-world-contract.test.ts pixi-stage.test.ts world-effects-controller.test.ts transition-registry.test.ts timeline-player.test.ts post-process.test.ts
```

- [ ] **Step 3: Commit characterization tests**

Commit `test(renderer): freeze world presentation contract`.

### Task 18: Extract WorldLayer and transactional presentation restore

**Files:**
- Create: `packages/renderer/src/layers/world/world-layer.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/runtime/renderer-facade.ts`
- Modify: `packages/renderer/src/runtime/create-renderer-runtime.ts`
- Modify: `packages/renderer/src/api/renderer-commands.ts`
- Modify: `packages/renderer/src/api/renderer-queries.ts`
- Test: world contracts, PixiStage, effects, transitions, timeline, post-process

**Interfaces:**
- Produces: `WorldLayer`, `WorldLayerOptions`, `WorldPresentationSnapshot`
- Consumes: `RenderAssetRegistry`, `RenderLifecycle`, existing focused effect/transition/post-process modules

- [ ] **Step 1: Move exact world field families**

```text
bgLayer, portraitLayer, fadeOverlay, bgSprite, backgroundKey, bgTransition,
portraitSprites, portraitViews, portraitTweens,
worldLayer, screenLayer, flashOverlay, worldEffects,
flashRemain, flashDur, zoomFrom, zoomTo, zoomRemain, zoomDur,
cameraPanX, cameraPanY, wipeBar, wipeRemain, wipeDur,
tintOverlay, tintFrom, tintTo, tintRemain, tintDur,
particleLayer, particleKind, particlePreset, particles,
movTweens, timelineMoveStarts, timelineValueStarts,
timelinePanStarts, timelineTintStarts, colorMatrix,
quality, presentation, postProcess, thumbCache
```

Background/portrait texture maps and fonts must already live in `RenderAssetRegistry`; do not move them into WorldLayer.

- [ ] **Step 2: Move exact world methods**

Move visible implementations of:

```text
setBackground, setPortrait, removePortrait, setActiveSpeaker (World port half),
setFade, shake, transition, flash, zoom, updateEffects, wipe,
movePortrait, setTint, clearTint, startParticles, stopParticles,
applyTimelineFrame, setQuality/getQuality,
setPresentationPreferences/getPresentationPreferences,
setPostProcess/getPostProcess, captureThumbnail,
snapshotPresentation, restorePresentation, clearPresentation
```

`setSpeakerProfiles` remains Dialogue; World receives only active character ID and portrait data needed for dimming.

- [ ] **Step 3: Implement validate-before-commit restore**

Parse the complete snapshot into an immutable prepared structure; validate asset keys, numeric bounds, transition names, effect states and arrays before touching visible fields. Commit only after validation. If resource preparation fails, keep the previous snapshot and release prepared temporaries.

- [ ] **Step 4: Register/cancel world resources**

All tweens, particles, timeline callbacks and display ownership use lifecycle owner `world`. New background/portrait commands invalidate stale preparation tokens. A late asset resolution after reset/dispose cannot commit.

- [ ] **Step 5: Delegate legacy Stage and remove duplicate world bodies**

Stage public methods delegate once to v2. Remove moved private fields after contracts pass. `needsUpdate/update/setFrameRequest` aggregate World plus other Layers through Composition Root rather than polling hidden Stage fields.

- [ ] **Step 6: Run targeted and complete gates**

```powershell
npm test -w @surdet/renderer -- world-layer.test.ts legacy-world-contract.test.ts pixi-stage.test.ts world-effects-controller.test.ts transition-registry.test.ts timeline-player.test.ts post-process.test.ts resource-cycles.test.ts presentation-snapshot.test.ts
npm test -w surdet-starter -- vite-scene-hmr.test.ts rollback-runtime.test.ts
npm run verify:renderer-boundaries
npm run verify:all
```

Run two 50-cycle batches for backgrounds, portraits, transitions, particles and reset/dispose. Compare all world/reduced-motion visual states and the performance baseline.

- [ ] **Step 7: Commit and report M7**

Commit `refactor(renderer): extract world layer`. Write `docs/ENGINE-RENDERER-V2-M7-DELIVERY-REPORT-2026-08-09.md`, include exact residual responsibilities still in `PixiStage`, commit report, and stop for M8 approval.
