# P1/P2 Engine Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan task-by-task with a fresh verification gate after every task.

**Goal:** Finish every P1 and P2 item in the Surdet engine roadmap as reusable engine infrastructure, then verify the formal ADV game, editor, shell packaging, and CLI workflows from `E:\surdet`.

**Architecture:** Keep `@surdet/core` headless and platform-independent. Put runtime budgets, plugins, localization, post-processing, and diagnostics behind typed interfaces in `@surdet/renderer`; keep editor preview adapters in `surdet-editor`; keep update/crash/release services in `@surdet/shell` and manifest generation in `@surdet/cli`. Every optional feature has an explicit disabled/fallback path and a pure-logic test seam.

**Tech Stack:** TypeScript 5, PixiJS 8, Vite, Vitest, Electron 43, electron-builder, Playwright, Node 20.

## Global Constraints

- All commands run from `E:\surdet`.
- No game-specific renderer branches; formal game changes are validation fixtures only.
- Static frames must keep using `FrameScheduler`; active typing, transitions, particles, audio, and UI overlays must remain time-driven.
- Optional P2 features must work offline and must not block game startup.
- Do not add Live2D/Spine or external update/crash SDK dependencies.
- Every new public interface gets a unit test and an integration smoke path.

---

### Task 1: Establish performance budgets and diagnostics

**Files:**
- Create: `packages/renderer/src/performance.ts`
- Modify: `packages/renderer/src/frame-scheduler.ts`
- Modify: `packages/renderer/src/index.ts`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Test: `packages/renderer/test/performance.test.ts`

**Interfaces:**
- Produce `RenderPerformanceBudget`, `RenderPerformanceSample`, `RenderPerformanceSnapshot`, and `RenderPerformanceMonitor`.
- `FrameScheduler` accepts an optional monitor and records active-frame update time, dropped/slow frames, and idle state transitions.
- The monitor never throws and never controls gameplay.

- [ ] Add deterministic rolling-window aggregation with a default 8 ms update budget, configurable sample window, and low-end preset.
- [ ] Add tests for empty windows, slow frames, reset, and disabled monitoring.
- [ ] Wire formal-game `window.__surdetDiagnostics` to expose a JSON snapshot without changing game logic.
- [ ] Run `npm test -w @surdet/renderer` and `npm run typecheck -w @surdet/renderer`.

### Task 2: Finish runtime resource and quality controls

**Files:**
- Create: `packages/renderer/src/quality.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/audio-manager.ts`
- Modify: `packages/renderer/src/types.ts`
- Test: `packages/renderer/test/quality.test.ts`
- Test: `packages/renderer/test/pixi-stage.test.ts`

**Interfaces:**
- Produce `RenderQuality`, `RenderQualityPolicy`, and `ResourceBudgetSnapshot`.
- `PixiStage.setQuality()` clamps particle count, effect density, and texture scale without changing scene semantics.
- `AudioManager` exposes active sound count and bounded crossfade state for diagnostics.

- [ ] Add high/balanced/low quality policies and a manual override.
- [ ] Cap particle instances and transient effect allocations; verify low quality still completes fade/tint/wipe/move cues.
- [ ] Verify registered host textures, loaded URL textures, Blob URLs, fonts, and audio handles have explicit owner/release paths.
- [ ] Add long-session resource accounting tests using fake textures/audio.
- [ ] Run renderer tests and a 1,000-frame synthetic low-quality update test.

### Task 3: Close modern ADV performance and presentation gaps

**Files:**
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/timeline-player.ts`
- Modify: `packages/renderer/src/transitions.ts`
- Modify: `packages/renderer/src/types.ts`
- Test: `packages/renderer/test/timeline-player.test.ts`
- Test: `packages/renderer/test/presentation-budget.test.ts`

**Interfaces:**
- Produce a typed `AtmospherePreset` and `PresentationBudget` API.
- Preserve existing direct `@fade`, `@tint`, `@wipe`, `@shake`, `@flash`, `@zoom`, `@mov`, and particle behavior.

- [ ] Add bounded atmosphere presets for rain, snow, sakura, sparkle, and fireflies with deterministic seed support for tests.
- [ ] Add reduced-motion and low-quality behavior that preserves final visual state while shortening/interpolating effects safely.
- [ ] Add camera/portrait/transition final-state tests, including interrupted cue replacement and save/restore.
- [ ] Verify no automatic motion is injected into existing scenes unless explicitly configured.

### Task 4: Finish editor preview recovery, diagnostics, and local refresh

**Files:**
- Modify: `packages/editor/src/preview.ts`
- Modify: `packages/editor/src/panels/preview-panel.ts`
- Modify: `packages/editor/src/state.ts`
- Create: `packages/editor/src/preview-diagnostics.ts`
- Test: `packages/editor/test/preview-diagnostics.test.ts`
- Test: `packages/editor/test/preview-scenes.test.ts`

**Interfaces:**
- Produce source-addressable `PreviewDiagnostic` records with scene ID, line, column, phase, severity, and message.
- Add preview protocol messages `surdet-preview-diagnostic`, `surdet-preview-refresh`, and `surdet-preview-ready`.

- [ ] Convert compile/runtime/asset failures into diagnostics instead of iframe-only console errors.
- [ ] Add reload generation tokens so stale preview messages/assets cannot mutate the current session.
- [ ] Add local refresh for the active scene and full reload for project/config changes; always release old Pixi textures, audio, fonts, and Blob URLs.
- [ ] Add tests for stale generation rejection, source line mapping, malformed timeline diagnostics, and failed asset recovery.
- [ ] Run editor tests and a browser smoke script against `http://localhost:5174`.

### Task 5: Add engine localization primitives and extract UI strings

**Files:**
- Create: `packages/core/src/localization.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/renderer/src/localization.ts`
- Modify: `packages/renderer/src/ui-views.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Create: `packages/renderer/src/locales/zh-CN.json`
- Create: `packages/renderer/src/locales/en-US.json`
- Create: `packages/renderer/test/localization.test.ts`
- Modify: `packages/shell/src/preload.ts`
- Modify: `packages/shell/src/main.ts`

**Interfaces:**
- Produce `LocaleCode`, `MessageCatalog`, `Translator`, and `LocaleStore` with fallback to `zh-CN` and then message ID.
- No renderer/core module reads browser globals to resolve locale.

- [ ] Add placeholder interpolation, plural fallback, malformed catalog handling, and locale persistence.
- [ ] Extract renderer system-menu, save/load, settings, gallery, title, ending, and diagnostic labels.
- [ ] Add shell `settings.locale` persistence and preload bridge without blocking startup.
- [ ] Add tests for fallback, interpolation, persisted locale, and missing keys.

### Task 6: Add renderer and shell plugin/host extension APIs

**Files:**
- Create: `packages/renderer/src/plugin-host.ts`
- Modify: `packages/renderer/src/index.ts`
- Modify: `packages/renderer/src/adv-renderer.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/types.ts`
- Create: `packages/renderer/test/plugin-host.test.ts`
- Modify: `packages/shell/src/main.ts`
- Modify: `packages/shell/src/preload.ts`

**Interfaces:**
- Produce `SurdetPlugin`, `PluginContext`, `RendererPluginHost`, and `ShellPluginHost`.
- Plugins can register renderer instruction handlers, stage overlays, lifecycle hooks, diagnostics, and shell IPC handlers only through explicit registration.

- [ ] Add deterministic plugin ordering, duplicate ID rejection, disposal, and failure isolation.
- [ ] Expose plugin registration from hosts without granting raw Node/fs access to renderer plugins.
- [ ] Add tests for ordering, duplicate IDs, plugin failure isolation, disposal, and inactive plugin behavior.

### Task 7: Complete release manifest, offline update service, and crash reporting

**Files:**
- Create: `packages/shell/src/release-service.ts`
- Create: `packages/shell/src/crash-reporter.ts`
- Modify: `packages/shell/src/main.ts`
- Modify: `packages/shell/src/preload.ts`
- Modify: `packages/shell/package.json`
- Modify: `packages/cli/src/build.ts`
- Test: `packages/shell/test/release-service.test.ts`
- Test: `packages/shell/test/crash-reporter.test.ts`
- Test: `packages/cli/test/web-manifest.test.ts`
- Modify: `packages/shell/scripts/verify-pack.mjs`

**Interfaces:**
- Produce schema-versioned `ReleaseManifest`, `UpdateCheckResult`, `CrashReport`, and `CrashReporter`.
- Update checks are opt-in, timeout-bounded, signature/hash-aware when metadata exists, and never block launch.

- [ ] Extend CLI manifests with platform, artifact URL, SHA-256, size, release notes, and minimum engine version while keeping old fields compatible.
- [ ] Implement offline/local manifest reading, HTTP timeout, invalid-manifest rejection, and no-network startup behavior.
- [ ] Implement bounded crash report queue in `userData/crash-reports`, redaction of paths/args, size cap, and explicit export/delete APIs.
- [ ] Wire `uncaughtException`, `unhandledRejection`, and renderer crash events into the reporter without recursive crashes.
- [ ] Add preflight verification for manifest and crash-report schemas.

### Task 8: Add optional shader/post-processing with low-end fallback

**Files:**
- Create: `packages/renderer/src/post-process.ts`
- Modify: `packages/renderer/src/pixi-stage.ts`
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/src/index.ts`
- Create: `packages/renderer/test/post-process.test.ts`
- Modify: `packages/renderer/test/pixi-stage.test.ts`

**Interfaces:**
- Produce `PostProcessMode`, `PostProcessOptions`, and `PostProcessController`.
- Supported modes: `off`, `vignette`, `film-grain`, and `color-grade`; default is `off`.

- [ ] Implement post-process as a single optional Pixi filter stack with intensity clamping and no per-frame allocations.
- [ ] Make unsupported WebGL/WebGPU/filter environments fall back to `off` without throwing.
- [ ] Make quality policy disable post-processing automatically on low quality.
- [ ] Add fake-renderer tests for enable/disable, intensity clamp, reset, and fallback.

### Task 9: Final release and formal-game acceptance

**Files:**
- Modify: `README.md`
- Modify: `docs/AI-GUIDE.md`
- Modify: `docs/PROJECT-PATH-MIGRATION-2026-08-08.md`
- Create: `scripts/verify-p1-p2.mjs`
- Test: `scripts/verify-p1-p2.mjs`

- [ ] Run `npm run typecheck --workspaces --if-present`.
- [ ] Run `npm test` and `npm run build`.
- [ ] Run formal-game `lint`, `simulate`, `test`, and `build`.
- [ ] Run shell `pack` preflight, portable/NSIS packaging when the environment permits, and `e2e`.
- [ ] Run path, resource, locale, plugin, update, crash, and post-process audits.
- [ ] Update docs with actual commands and explicit disabled/offline behavior.
