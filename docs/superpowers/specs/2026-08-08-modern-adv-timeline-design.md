# Modern ADV Timeline Design

## Purpose

Introduce a deterministic presentation timeline that makes Surdet scenes read as modern ADV direction rather than a sequence of isolated state changes. The system must make backgrounds, portraits, camera, screen treatment, particles, and audio progress together while preserving the existing DSL, headless execution, save/load, skip, and editor-preview contracts.

This work is an engine capability. The starter's opening scene is the first authored acceptance case, not a special-case renderer implementation.

## Goals

- Keep the existing `@bg`, `@show`, `@hide`, `@mov`, `@zoom`, `@tint`, `@shake`, `@flash`, and `@particle` instructions working unchanged.
- Add named, declarative timelines that can run multiple visual tracks in parallel.
- Make presentation state resumable across manual, quick, and automatic saves.
- Keep the core package independent from Pixi, DOM, Electron, and project filesystem APIs.
- Let the editor preview exactly the same timeline data as starter and packaged builds.
- Default to restrained, film-like easing and staging. No perpetual motion or forced effects on existing scripts.

## Non-goals for This Batch

- A drag-and-drop timeline editor. The editor will discover, validate, inspect, and preview timeline files first; its eventual track editor will reuse this schema.
- A general video compositor, skeletal animation system, or arbitrary JavaScript execution inside timelines.
- Replacing existing scene DSL or requiring old projects to add a timeline manifest.

## Authoring Model

Timeline definitions live in `content/timelines/<id>.json`. A `.gal` scene starts one with:

```gal
@timeline intro_arrival
@timeline intro_arrival @ blocking
```

The first form is non-blocking: narration can continue while the visual motion completes. The `@ blocking` form puts the interpreter into an interruptible presentation wait; normal advance and skip finish the timeline immediately, matching the current `@wait` convention.

The compiler gives `@timeline` a typed instruction instead of treating it as an opaque renderer directive. A project-level timeline catalog is supplied by the host to lint/simulation/runtime. Missing definitions yield a source-located diagnostic in lint and a runtime error only when the host did not provide a catalog (for compatibility with older lightweight hosts).

Example definition:

```json
{
  "version": 1,
  "id": "intro_arrival",
  "durationMs": 1800,
  "tracks": [
    {
      "kind": "background",
      "cues": [
        { "atMs": 0, "durationMs": 650, "easing": "outCubic", "action": "set", "key": "castle_hall" }
      ]
    },
    {
      "kind": "portrait",
      "target": "lynn:uniform",
      "cues": [
        { "atMs": 160, "durationMs": 480, "easing": "outCubic", "action": "show", "expression": "normal", "position": "left" },
        { "atMs": 1040, "durationMs": 420, "easing": "inOutCubic", "action": "move", "position": "center" }
      ]
    },
    {
      "kind": "camera",
      "cues": [
        { "atMs": 980, "durationMs": 820, "easing": "inOutSine", "action": "zoom", "scale": 1.035 }
      ]
    }
  ]
}
```

Every cue is declarative: `atMs`, `durationMs`, one supported easing, and a track-specific payload. Equal timestamps are parallel. Cues on the same target/field are ordered by source order; a later cue is authoritative from its start time. Definitions must have a nonnegative duration, non-overflowing cue range, known track/action pairs, finite numeric values, and unique IDs.

The first supported tracks are `background`, `portrait`, `camera`, `screen`, `particle`, and `audio`. `screen` covers fade, tint, flash, and wipe. `audio` covers BGM/SE/voice starts only; audio volume automation is intentionally deferred until persistence rules are proven.

## Runtime Architecture

`@surdet/core` owns the timeline schema, validation, catalog, typed instruction, and interpreter lifecycle events. It does not animate pixels. The interpreter emits a start event containing the fully validated definition and whether it blocks. It emits reset/restore events during new game, scene jump, title return, and load.

`@surdet/renderer` owns the frame clock and converts timeline cues into `AdvStage` actions. `PixiStage` applies each action to real display objects with consistent easing. It also exposes a serializable presentation snapshot and restore operation. The renderer is the only layer that knows about Pixi display state.

The host wires timeline completion to the interpreter in the same way it currently wires `@wait`: a blocking timeline completes or is skipped, then calls `Interpreter.finishWait()`. A monotonically increasing presentation session token makes callbacks from a pre-load or pre-jump timeline inert.

Existing direct visual instructions retain their current behavior. They pass through the same low-level transition primitives as timeline cues where applicable, so a manual `@mov` and a timeline portrait move share interpolation and cleanup rules.

## Save, Load, Pause, and Skip

The interpreter receives optional presentation snapshot/restore hooks. A save records an optional, versioned presentation payload without making core depend on renderer types. The payload contains:

- active timeline ID and cursor time for each running timeline;
- static world state: background key, visible portrait identities/views, camera, fade, tint, and particles;
- active transitions needed to continue from the cursor.

On load, the renderer first clears stale effects and restores the static world state, then reconstructs active timelines at their saved cursors. It does not replay unrelated earlier dialogue or audio. A save without the optional payload remains valid and follows the present fallback behavior.

Pausing freezes timeline cursor advancement. Skip completes blocking timelines and applies their final visual state before advancing the interpreter. Non-blocking timelines complete immediately when full skip is enabled, preventing stale transitions from leaking into a later scene. Auto mode never changes timeline speed.

## Editor and Asset Flow

Starter discovers `content/timelines/*.json` alongside existing assets. The editor sends those definitions through its established `postMessage` preview payload; no duplicate parser or browser-only format is introduced. The editor validates timeline JSON and reports file/track/cue locations. Blob URLs remain owned by the existing preview asset lifecycle and are released on project reload.

The initial editor UI provides a timeline list, validation diagnostics, source jump, and preview replay. A visual track editor is deliberately deferred: the stable JSON schema and same preview runner make that a UI addition rather than a second runtime.

## First Acceptance Content

The starter opening gets `intro_arrival`:

1. `castle_hall` crossfades in under the existing dark vignette.
2. Lynn enters from the left with a short, bottom-anchored fade/slide.
3. The first line begins after the visual arrival is readable.
4. Her expression switches with a crossfade, then she moves to center.
5. A subtle camera push and cool tint complete the beat before the existing choice.

No plot, variable, choice, or scene transition changes are allowed in this acceptance content.

## Error Handling and Compatibility

- Invalid timeline JSON never crashes project loading; lint/editor report a precise diagnostic and runtime disables only the affected timeline.
- Unknown assets retain the current placeholder fallback. Unknown track/action/easing values are validation errors, not silent no-ops.
- Old projects without `content/timelines` and scripts without `@timeline` are behaviorally unchanged.
- `resetSession`, title flow, reload, and load invalidate active runner callbacks before clearing display objects and audio.

## Verification

- Core tests: compile/validate the directive and catalog; blocking/non-blocking lifecycle; invalid definitions; compatibility without a catalog.
- Renderer tests: parallel cues, later-cue precedence, easing endpoint correctness, skip finalization, reset token invalidation, and snapshot/restore.
- Starter/editor tests: discovery and `postMessage` transfer of timeline JSON, reload cleanup, and missing-asset fallback.
- Required commands: `npm run typecheck`, `npm run test`, `npm run lint -w surdet-starter`, `npm run simulate -w surdet-starter`, `npm run build`, and `git diff --check`.
- Manual acceptance: user checks the starter/preview opening at 1280x720 and a narrow viewport; the staged arrival is smooth, the dialogue remains readable, choices and saves remain functional, and a save during the blocking arrival restores the same composition.

