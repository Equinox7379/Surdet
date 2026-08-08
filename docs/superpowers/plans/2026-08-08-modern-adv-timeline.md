# Modern ADV Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, resumable multi-track ADV timeline system and use it to stage the starter opening with modern background, portrait, camera, and screen direction.

**Architecture:** `@surdet/core` owns the validated timeline model, typed `@timeline` instruction, lifecycle, and JSON-safe presentation hooks. `@surdet/renderer` owns frame-time interpolation and Pixi projection. Starter and editor load the same timeline JSON and pass it through the existing preview/package asset paths.

**Tech Stack:** TypeScript, Vitest, PixiJS, Vite `import.meta.glob`, existing EventBus/Interpreter/AdvStage contracts, JSON project assets.

## Global Constraints

- Preserve existing `@bg`, `@show`, `@hide`, `@mov`, `@zoom`, `@tint`, `@shake`, and `@particle` behavior.
- Keep `@surdet/core` independent from Pixi, DOM, Electron, and project filesystem APIs.
- Old projects without `content/timelines` and scripts without `@timeline` must remain valid.
- Timeline state saved in JSON must be finite, cloneable, and schema-versioned.
- Unknown track/action/easing values are diagnostics, not silent no-ops.
- Run `npm run typecheck`, `npm run test`, `npm run lint -w surdet-starter`, `npm run simulate -w surdet-starter`, `npm run build`, and `git diff --check` before delivery.

---

### Task 1: Core Timeline Model And Validation

**Files:**
- Create: `packages/core/src/timeline.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/timeline.test.ts`

**Interfaces:**
- Produces `TimelineDefinition`, `TimelineTrack`, `TimelineCue`, `TimelineCatalog`, `TimelineRegistry`, `validateTimeline`, and `TimelineDiagnostic` for compiler, runtime, CLI, editor, and renderer hosts.

- [ ] **Step 1: Write failing validation tests**

Add tests for a valid parallel definition, a duplicate ID, an unknown track/action, negative or overflowing cue timing, non-finite numeric payloads, and JSON-safe registry lookup.

```ts
it('accepts parallel tracks and preserves cue order', () => {
  const result = validateTimeline({
    version: 1, id: 'intro', durationMs: 900,
    tracks: [{ kind: 'background', cues: [{ atMs: 0, durationMs: 400, easing: 'outCubic', action: 'set', key: 'hall' }] }],
  });
  expect(result).toEqual([]);
});

it('rejects an overflowing cue and unknown action', () => {
  const result = validateTimeline({
    version: 1, id: 'bad', durationMs: 100,
    tracks: [{ kind: 'portrait', target: 'lynn:uniform', cues: [
      { atMs: 80, durationMs: 40, easing: 'linear', action: 'explode' },
    ] }],
  });
  expect(result.map((d) => d.code)).toEqual(['T006', 'T008']);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run `npm run test -- --run packages/core/test/timeline.test.ts`.
Expected: FAIL because `timeline.ts` and its exports do not exist.

- [ ] **Step 3: Implement the model and registry**

Define `TimelineDefinition { version: 1; id: string; durationMs: number; tracks: TimelineTrack[] }`, discriminated track kinds `background | portrait | camera | screen | particle | audio`, base cue fields `atMs`, `durationMs`, `easing`, `action`, and track payload fields used by the design. Export `TimelineRegistry` with `register(definition)`, `get(id)`, `has(id)`, and `all()`. Make `register` throw only after collecting validation diagnostics; keep diagnostics source-addressable with `code`, `message`, and optional `path`.

- [ ] **Step 4: Run focused tests and core typecheck**

Run `npm run test -- --run packages/core/test/timeline.test.ts` and `npm run typecheck`.
Expected: all timeline tests pass and no existing package reports a type error.

- [ ] **Step 5: Commit the isolated core model**

Run `git add packages/core/src/timeline.ts packages/core/src/index.ts packages/core/test/timeline.test.ts && git commit -m "feat(core): add validated ADV timeline model"`.

### Task 2: DSL Compiler And Interpreter Timeline Lifecycle

**Files:**
- Modify: `packages/core/src/dsl/ast.ts`
- Modify: `packages/core/src/dsl/compiler.ts`
- Modify: `packages/core/src/runtime/interpreter.ts`
- Modify: `packages/core/src/save/save-manager.ts`
- Modify: `packages/core/src/save/migrate.ts`
- Test: `packages/core/test/compiler.test.ts`
- Test: `packages/core/test/interpreter.test.ts`
- Test: `packages/core/test/interpreter-save.test.ts`

**Interfaces:**
- Consumes `TimelineRegistry` from Task 1.
- Produces `TimelineInstr { op: 'timeline'; id: string; blocking: boolean }`, `CoreEventMap.timeline`, and optional `PresentationSnapshotHooks` with `snapshot(): unknown` and `restore(snapshot: unknown): void`.

- [ ] **Step 1: Add failing compiler/runtime tests**

Cover `@timeline intro` and `@timeline intro @ blocking`, malformed IDs, event payloads, blocking status, `finishWait()`, and save/load forwarding of an optional presentation payload.

```ts
it('compiles blocking timeline modifier without changing legacy generic instructions', () => {
  const scene = compileScene('@scene demo\n@timeline intro @ blocking\n', 'demo.gal');
  expect(scene.instructions).toContainEqual(expect.objectContaining({ op: 'timeline', id: 'intro', blocking: true }));
});

it('emits timeline and waits only when blocking', () => {
  const events: unknown[] = [];
  bus.on('timeline', (p) => events.push(p));
  interp.start('demo');
  expect(events).toEqual([{ id: 'intro', blocking: true, durationMs: 900 }]);
  expect(interp.status).toBe('awaiting-timer');
  interp.finishWait();
  expect(interp.status).toBe('awaiting-advance');
});
```

- [ ] **Step 2: Run the focused tests to verify failure**

Run `npm run test -- --run packages/core/test/compiler.test.ts packages/core/test/interpreter.test.ts packages/core/test/interpreter-save.test.ts`.
Expected: FAIL because the AST, event map, and save hook do not yet recognize timelines.

- [ ] **Step 3: Implement typed compilation and lifecycle events**

Add `TimelineInstr` to the AST union and reserve `timeline` in the compiler. Parse the first argument as a dequoted ID and the bare `blocking` modifier as the boolean flag. Add a `timeline` event payload `{ id: string; blocking: boolean; definition?: TimelineDefinition }`. When a catalog is present, attach the registered definition and raise a source-located `RuntimeError` for a missing ID; when no catalog is present, emit the ID without a definition so old lightweight hosts remain compatible. Set `awaiting-timer` for blocking instructions and have `advance()`/`finishWait()` resume the interpreter exactly once.

Extend `SaveSnapshot` with optional `presentation?: { version: 1; payload: unknown }`, validate it with the existing JSON-safe guard, and keep schema migration backward compatible. Invoke `PresentationSnapshotHooks.snapshot` from `saveSnapshot()` and `restore` after `stateReset` before the saved instruction is re-driven.

- [ ] **Step 4: Run focused and legacy tests**

Run `npm run test -- --run packages/core/test/compiler.test.ts packages/core/test/interpreter.test.ts packages/core/test/interpreter-save.test.ts packages/core/test/save.test.ts`.
Expected: new tests pass and all existing interpreter/save behavior remains green.

- [ ] **Step 5: Commit the core runtime contract**

Run `git add packages/core/src/dsl/ast.ts packages/core/src/dsl/compiler.ts packages/core/src/runtime/interpreter.ts packages/core/src/save/save-manager.ts packages/core/src/save/migrate.ts packages/core/test/compiler.test.ts packages/core/test/interpreter.test.ts packages/core/test/interpreter-save.test.ts && git commit -m "feat(core): execute blocking ADV timelines"`.

### Task 3: Renderer Timeline Player And Stage Projection

**Files:**
- Create: `packages/renderer/src/timeline-player.ts`
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/adv-renderer.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Test: `packages/renderer/test/timeline-player.test.ts`
- Test: `packages/renderer/test/adv-renderer.test.ts`
- Test: `packages/renderer/test/pixi-stage.test.ts`

**Interfaces:**
- Consumes `TimelineDefinition` and `CoreEventMap.timeline` from Tasks 1-2.
- Produces `AdvStage.playTimeline(definition, blocking, onComplete)`, `skipTimeline()`, `snapshotPresentation()`, `restorePresentation(snapshot)`, and `clearPresentation()`.

- [ ] **Step 1: Write failing pure player tests**

Test cue ordering, equal-time parallel actions, easing endpoints, replacement of the same target field by a later cue, snapshot/restore cursor, and skip finalization.

```ts
it('emits equal-time cues together and reaches exact final values', () => {
  const player = new TimelinePlayer(definition);
  expect(player.advance(0).map((e) => e.kind)).toEqual(['background', 'portrait']);
  const last = player.advance(900);
  expect(last.at(-1)).toMatchObject({ progress: 1 });
  expect(player.done).toBe(true);
});
```

- [ ] **Step 2: Run focused renderer tests to verify failure**

Run `npm run test -- --run packages/renderer/test/timeline-player.test.ts`.
Expected: FAIL because the player and stage methods do not exist.

- [ ] **Step 3: Implement deterministic player and easing**

Implement `TimelinePlayer` with `advance(deltaMs)`, `skip()`, `snapshot()`, `restore(snapshot)`, `done`, and `events`. Clamp cursor to `[0, durationMs]`; evaluate `linear`, `inOutSine`, `outCubic`, and `inOutCubic`; emit normalized progress and cue payload without importing Pixi. A session ID must invalidate completion callbacks after `clearPresentation()` or restore.

- [ ] **Step 4: Connect AdvRenderer and PixiStage**

Subscribe to `timeline`, drive `TimelinePlayer.advance(deltaMs)` from the existing renderer update path, call the corresponding stage primitives, and call the interpreter wait completion callback once for blocking timelines. Add interpolation for background crossfade, portrait alpha/position/texture replacement, camera scale, screen tint/fade, and particles. Preserve existing direct instruction methods by routing them through the same transition helpers. The default timeline micro-motion must be opt-in through a cue; existing scenes receive no automatic animation.

- [ ] **Step 5: Add presentation snapshot and reset cleanup tests**

Assert that load/reset invalidates the old session callback, restores the active timeline cursor and static world, and that full skip applies final background/portrait/camera/screen state without leaving a ticker callback or stale audio handle.

- [ ] **Step 6: Run renderer tests and typecheck**

Run `npm run test -- --run packages/renderer/test/timeline-player.test.ts packages/renderer/test/adv-renderer.test.ts packages/renderer/test/pixi-stage.test.ts` and `npm run typecheck`.
Expected: all new and existing renderer tests pass.

- [ ] **Step 7: Commit renderer execution**

Run `git add packages/renderer/src/timeline-player.ts packages/renderer/src/types.ts packages/renderer/src/adv-renderer.ts packages/renderer/src/pixi-stage.ts packages/renderer/test/timeline-player.test.ts packages/renderer/test/adv-renderer.test.ts packages/renderer/test/pixi-stage.test.ts && git commit -m "feat(renderer): add resumable ADV timeline playback"`.

### Task 4: Starter Timeline Catalog And Opening Direction

**Files:**
- Create: `examples/starter/content/timelines/intro_arrival.json`
- Modify: `examples/starter/src/main.ts`
- Modify: `examples/starter/content/scenario/ch01_01.gal`
- Test: existing starter simulation fixtures and `packages/core/test/interpreter.test.ts`

**Interfaces:**
- Consumes the core catalog and renderer hooks from Tasks 1-3.
- Produces a starter catalog loaded by Vite in development and by the packaged asset path in production.

- [ ] **Step 1: Add the timeline asset and author the unchanged opening logic**

Create `intro_arrival.json` with the design's background, portrait, camera, and screen tracks. Add `@timeline intro_arrival @ blocking` before the first line, then use one non-blocking timeline for the expression/center move before the existing choice. Do not alter variables, choice labels, jumps, ending markers, or scene IDs.

- [ ] **Step 2: Wire starter discovery and presentation hooks**

Add `import.meta.glob('../content/timelines/**/*.json', { eager: true, import: 'default' })`, register every validated definition, pass the catalog to `Interpreter`, connect `snapshotPresentation`/`restorePresentation`, and make `resetSession`, title return, quick load, and full load call `clearPresentation` before replay. The production path must use the same relative asset key and not depend on an editor-only URL.

- [ ] **Step 3: Run starter simulation and typecheck**

Run `npm run simulate -w surdet-starter`, `npm run lint -w surdet-starter`, and `npm run typecheck`.
Expected: every existing path remains reachable, with no runtime error and no missing timeline diagnostic.

- [ ] **Step 4: Commit starter acceptance content**

Run `git add examples/starter/content/timelines/intro_arrival.json examples/starter/src/main.ts examples/starter/content/scenario/ch01_01.gal && git commit -m "feat(starter): stage modern ADV opening timeline"`.

### Task 5: Editor Preview Timeline Transfer And Resource Cleanup

**Files:**
- Modify: `packages/editor/src/panels/preview-panel.ts`
- Modify: `packages/editor/src/preview.ts`
- Modify: `packages/editor/src/project-io.ts`
- Modify: `packages/editor/src/state.ts`
- Test: `packages/editor/test/preview-scenes.test.ts`
- Test: `packages/editor/test/model-roundtrip.test.ts`

**Interfaces:**
- Consumes timeline JSON through the project directory handle and sends `timelines: TimelineDefinition[]` in the existing `surdet-preview-load` payload.
- Produces the same `TimelineRegistry` construction and `AdvRenderer` wiring used by starter.

- [ ] **Step 1: Add failing transfer and cleanup tests**

Test that timeline JSON is read from `content/timelines`, included in the load payload, invalid files produce diagnostics rather than aborting the preview, and reloading releases the previous asset/presentation resources.

- [ ] **Step 2: Extend the preview protocol**

Add `timelines?: unknown[]` to `LoadPayload`, read each timeline file with its relative path, and transfer validated definitions in the same message as scenes/assets. Keep missing `content/timelines` as an empty list.

- [ ] **Step 3: Rebuild preview runtime with the catalog**

On each preview load, validate/register the received definitions before `Interpreter.start`. Clear the old timeline runner and presentation state during the existing serialized load queue. Keep old messages without `timelines` valid.

- [ ] **Step 4: Run editor tests and build**

Run `npm run test -- --run packages/editor/test/preview-scenes.test.ts packages/editor/test/model-roundtrip.test.ts` and `npm run build`.
Expected: preview transfer tests pass and both editor entrypoints build.

- [ ] **Step 5: Commit editor integration**

Run `git add packages/editor/src/panels/preview-panel.ts packages/editor/src/preview.ts packages/editor/src/project-io.ts packages/editor/src/state.ts packages/editor/test/preview-scenes.test.ts packages/editor/test/model-roundtrip.test.ts && git commit -m "feat(editor): preview project ADV timelines"`.

### Task 6: Full Regression, Packaging, And Acceptance Handoff

**Files:**
- Modify: `docs/dsl-spec.md`
- Modify: `docs/AI-GUIDE.md`
- Create: `ACCEPTANCE-HANDOFF-ADV-TIMELINE.md`

- [ ] **Step 1: Document authoring and compatibility**

Document `@timeline <id> [@ blocking]`, the JSON track/cue fields, supported easing values, missing-asset fallback, and save/skip semantics. State that old projects remain valid and that timelines are optional.

- [ ] **Step 2: Run the full required verification**

Run:

```powershell
npm run typecheck
npm run test
npm run lint -w surdet-starter
npm run simulate -w surdet-starter
npm run build
git diff --check
```

Expected: all commands exit 0; the full test count does not decrease; starter simulation reports no runtime error.

- [ ] **Step 3: Run package smoke checks**

Run the existing shell E2E and Windows packaging verification from the handoff. Confirm the packaged app includes the timeline JSON and launches without a missing-module or missing-asset error.

- [ ] **Step 4: Write the handoff**

Record commits, test results, exact manual steps at 1280x720 and narrow width, save-during-blocking-timeline verification, and the intentional deferral of the drag-and-drop editor. Do not include unrelated untracked session files.

- [ ] **Step 5: Commit the documentation and handoff**

Run `git add docs/dsl-spec.md docs/AI-GUIDE.md ACCEPTANCE-HANDOFF-ADV-TIMELINE.md && git commit -m "docs: document ADV timeline authoring and acceptance"`.
