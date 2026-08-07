# Zero After Midnight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build 《零点之后》 as a 55–70 minute modern urban mystery ADV using the existing Surdet editor and DSL.

**Architecture:** Create an independent `examples/zero-after-midnight` workspace by reusing the current `examples/starter` shell, including its title, save/load, command rail, asset Blob registration, and cleanup behavior. Write four shared `.gal` scenes and six route scenes; the underground passage selects a route explicitly, while variables only change clues and ending text.

**Tech Stack:** TypeScript, Vite, PixiJS, `@surdet/core`, `@surdet/renderer`, Surdet `.gal`, PNG, WAV, Surdet CLI.

## Global Constraints

- Single route: 55–70 minutes; all three routes: roughly 2.5–3 hours.
- Use steel-blue rainy-night visuals with occasional muted sodium warmth.
- Use 11 original `1920x1080` backgrounds, 8 transparent portraits for Xu Zhiyao, and one static dialogue avatar.
- Keep `examples/starter` unchanged and add no engine system, DSL instruction, full voice, battle, calendar, mini-game, or real-time phone UI.
- Preserve current save/load, keyboard, right-click, gamepad, command rail, and missing-asset fallback behavior.
- Commit each independently testable task; never stage existing handoff files, screenshots, or `.superpowers` files.

---

### Task 1: Scaffold The Game Workspace

**Files:**
- Modify: `C:/Users/Equinox/Documents/Default Project/surdet/package.json`
- Modify: `C:/Users/Equinox/Documents/Default Project/surdet/package-lock.json`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/{package.json,game.config.json,index.html,vite.config.ts,tsconfig.json}`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/src/main.ts`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/config/*.json`

**Interfaces:** Consume the full starter runtime shell. Produce workspace package `zero-after-midnight`, whose configured entry scene is `common_0017`.

- [ ] Copy the starter `src/main.ts`, HTML, Vite config, TypeScript config, and required config JSON files; omit its fantasy scenarios and media. Retain the runtime shell so the new game inherits title, menu, setting, save, preview, and Blob cleanup paths.
- [ ] Add `examples/zero-after-midnight` to root workspaces. Set package scripts to `dev: vite`, `build: vite build`, `lint: surdet lint .`, `simulate: surdet simulate . --max-paths 500 --max-steps 20000`, `test: node scripts/verify-simulation.mjs`, and `typecheck: tsc -p tsconfig.json --noEmit`.
- [ ] Set `index.html` title to `零点之后 / AFTER MIDNIGHT` and preserve the starter CSP, especially `media-src 'self' data: blob:`.
- [ ] Run `npm install --package-lock-only`, `npm run typecheck -w zero-after-midnight`, and `npm run build -w zero-after-midnight`. Both checks must pass before story work.
- [ ] Commit with `feat: scaffold zero after midnight game workspace`.

### Task 2: Define Story Data And The Shared Investigation

**Files:**
- Modify: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/game.config.json`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/scenario/common_0017.gal`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/scenario/common_convenience.gal`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/scenario/common_apartment.gal`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/scenario/common_passage.gal`

**Interfaces:** `game.config.json` is the sole variable declaration source. Map only `zhirao` to display name `许知遥` and avatar key `zhirao`; protagonist and narrator remain unmapped pure dialogue speakers.

- [ ] Configure title `零点之后`, `entryScene` `common_0017`, and variables: numeric `trust` (0–6), `evidence` (0–8), `panic` (0–6); string `route` initially `none`; flags `recordingSaved` and `phoneOn` initially false and true respectively.
- [ ] Write `common_0017` (8 minutes): `apartment_night`, `midnight_rain`, `phone_ring`, then `@show zhirao:commute calm @ center`; include 35+ dialogue lines, one evidence choice, one trust choice, `@autosave`, and jump to `common_convenience.start`.
- [ ] Write `common_convenience` (9 minutes): use `convenience_exterior`, `convenience_interior`, `convenience_hum`, `store_bell`, `rain_window`, and `phone_ring`. Its three choices are “观察监控” (+evidence), “相信她的说法” (+trust), and “挂断电话” (+panic); all labels rejoin `common_apartment.start`.
- [ ] Write `common_apartment` (9 minutes): use `old_apartment_corridor`, `old_apartment_room`, `old_room`, `tape_click`, and `voice_static`; one choice sets `recordingSaved = true`, the other increases panic, and an explicit `@if recordingSaved`/`@else` provides coherent clues before jumping to `common_passage.start`.
- [ ] Write `common_passage` (9 minutes): use `underground_passage`, `underground_signal`, `fluorescent`, `subway_pass`, and `phone_ring`; autosave immediately before three explicit actions. Set route string and jump exactly to `route_testimony_station.start`, `route_meeting_train.start`, or `route_silence_blackout.start`.
- [ ] Keep 260–320 Chinese dialogue lines across common scenes; make a visual beat every 8–14 lines with background, portrait, `@mov`, `@hide`, tint, or sound, and keep every single line below 80 Chinese characters.
- [ ] Run `npm run lint -w zero-after-midnight`; commit with `feat: write shared zero after midnight investigation`.

### Task 3: Write The Three Route Pairs

**Files:**
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/scenario/route_testimony_{station,rooftop}.gal`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/scenario/route_meeting_{train,rooftop}.gal`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/scenario/route_silence_{blackout,dawn}.gal`

**Interfaces:** Consume the variables declared in Task 2. Produce exactly `testimony_end`, `meeting_end`, and `silence_end` through `@clear` then `@end`.

- [ ] 证词线: `route_testimony_station` uses `police_archive`, `investigation`, `scanner`, `printer`, and `siren`. With `evidence >= 3`, show a complete evidence chain; otherwise show a credible but incomplete report. Its recording choice rejoins the rooftop. `route_testimony_rooftop` uses `rooftop_rain`, `ending_testimony`, `wind`, and `phone_ring`, then calls `@clear testimony_end`.
- [ ] 赴约线: `route_meeting_train` uses `last_train`, `last_train` BGM, `subway_pass`, and `phone_ring`. With `trust >= 3`, reveal a genuine plea inside the imitation; otherwise retain uncertainty. `route_meeting_rooftop` uses `rooftop_rain`, `ending_meeting`, `wind`, `voice_static`, and `phone_ring`, then calls `@clear meeting_end` after revealing the protagonist's phone as caller source.
- [ ] 静音线: `route_silence_blackout` uses `apartment_blackout`, `blackout`, `power_cut`, `phone_ring`, and `door_lock`; destroying or sealing the second phone changes panic but rejoins dawn. `route_silence_dawn` uses `dawn_street`, `ending_silence`, `city_morning`, and `phone_ring`; `panic >= 3` makes the final auditory description unreliable, then it calls `@clear silence_end`.
- [ ] Write 150–200 Chinese dialogue lines per route. Each route needs two location scenes, two route-only sound cues, a branch that changes a later line, and a final portrait/fade transition. Do not share an ending scene file or only swap the last paragraph.
- [ ] Run `npm run lint -w zero-after-midnight` and `npm run simulate -w zero-after-midnight -- --json --max-paths 500 --max-steps 20000`. Require empty `runtimeErrors` and `deadEndScenes`, false `budgetExhausted`, all three ending IDs, and `saveRoundtrips > 0`.
- [ ] Commit with `feat: add zero after midnight branching routes`.

### Task 4: Generate And Register Original Media

**Files:**
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/assets/bg/{apartment_night,apartment_blackout,convenience_exterior,convenience_interior,old_apartment_corridor,old_apartment_room,underground_passage,police_archive,last_train,rooftop_rain,dawn_street}.png`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/assets/portrait/zhirao_commute_{calm,hesitant,smile,wet,alert,panic,distant,signal}.png`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/assets/avatar/zhirao.png`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/scripts/check-assets.mjs`

**Interfaces:** The existing asset loader maps filename stems to background keys, `<character>_<costume>_<expression>` to portraits, and avatar filename to speaker profile key; no renderer change is required.

- [ ] Before generating raster media, read and use the imagegen skill. Generate each background at `1920x1080` with the shared brief “original contemporary Chinese city, realistic modern visual novel background, cinematic 16:9, steel-blue rainy night, no characters, no text, no logo, no watermark, no recognizable landmark”; inspect the full image and a 1280x720 cover crop.
- [ ] Generate all portraits using a fixed original character bible: 24-year-old East Asian woman, chin-length near-black hair and side fringe, slate-blue commuter coat, gray knit top, restrained modern visual novel bust, transparent background, bottom anchor. Keep face, crop, hair, and clothes fixed; `signal` uses opacity, cold shift, and slight displacement only.
- [ ] Create only `avatar/zhirao.png` as neutral square crop because `SpeakerProfile.avatarKey` is static in the current renderer.
- [ ] Implement `check-assets.mjs` with explicit arrays for all 11 backgrounds, 8 portraits, 1 avatar, 10 BGM, and 14 SE. It prints each missing relative path and exits 1; otherwise prints the exact count and exits 0.
- [ ] Run `node scripts/check-assets.mjs` and `npm run build -w zero-after-midnight`; commit with `feat: add zero after midnight visual assets`.

### Task 5: Create Original Audio And Deterministic Verification

**Files:**
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/scripts/generate-audio.mjs`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/assets/bgm/*.wav`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/content/assets/se/*.wav`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/scripts/verify-simulation.mjs`
- Create: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/README.md`

**Interfaces:** Existing `@bgm` and `@se` keys resolve via `ResolvedAudio`; the verification script consumes CLI JSON simulator output.

- [ ] Implement deterministic PCM16 WAV creation using Node built-ins: 44.1 kHz 45–90 second low-volume drones/noise beds for BGM and sub-two-second envelopes for SE. Write only explicit files under the two game audio directories.
- [ ] Generate BGM keys `midnight_rain`, `convenience_hum`, `old_room`, `underground_signal`, `investigation`, `last_train`, `blackout`, `ending_testimony`, `ending_meeting`, and `ending_silence`; generate SE keys `phone_ring`, `store_bell`, `rain_window`, `tape_click`, `voice_static`, `fluorescent`, `subway_pass`, `scanner`, `printer`, `siren`, `wind`, `power_cut`, `door_lock`, and `city_morning`.
- [ ] Place `@bgm` once per location mood and `@se` only at physical/telephonic events. Use `@fadeout 350` before finale changes and rely on the existing 350 ms BGM crossfade. Do not place an SE on every dialogue line.
- [ ] Implement `verify-simulation.mjs`: resolve paths from `fileURLToPath(import.meta.url)`, invoke `packages/cli/dist/index.js simulate <gameDir> --json --max-paths 500 --max-steps 20000`, parse JSON, require all ending IDs, no runtime errors, no dead ends, and no path budget exhaustion; then invoke `check-assets.mjs` and propagate failure.
- [ ] README documents `npm run dev`, `lint`, `simulate`, `test`, `build`, the route decision in `common_passage`, and that starter is an independent engine sample.
- [ ] Run `npm run build -w @surdet/cli`, `npm test -w zero-after-midnight`, and `git diff --check`; commit with `test: verify zero after midnight routes and assets`.

### Task 6: Browser Acceptance And Delivery

**Files:**
- Modify only for a concrete acceptance defect: `C:/Users/Equinox/Documents/Default Project/surdet/examples/zero-after-midnight/src/main.ts` or the directly responsible renderer file.

**Interfaces:** Consume the completed game package and preserve all existing controls and preview behavior.

- [ ] Run root checks: `npm run typecheck`, `npm run test`, `npm run lint -w zero-after-midnight`, `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000`, `npm run build -w zero-after-midnight`, `npm run build`, and `git diff --check`. Every command must exit 0.
- [ ] Start `npm run dev -w zero-after-midnight`; play three fresh runs, selecting every action at the underground passage. Confirm route backgrounds, BGM, portraits, autosaves, and ending IDs. Reload before each route and confirm no old BGM, SE, background, portrait, or Blob URL remains.
- [ ] Use Playwright screenshots at `1280x720`, 900-pixel width, and `390x844`. Confirm cover-cropped background, bottom-anchored portrait, transparent dialogue, thin centered choices, and pointer-revealed command rail outside the text safe area.
- [ ] Verify Space/Enter, arrows/numbers, Ctrl/S, A, L, H, F5/F9, O, Escape/right-click, and gamepad advance/menu/choice behavior. Save/load must not alter route or variables.
- [ ] Stage only the new game, required workspace/lock changes, and a directly necessary fix. Commit final corrections with `feat: deliver zero after midnight visual novel`.

## Plan Self-Review

- The plan covers story duration, explicit route split, variables, original visuals, original audio, editor reuse, fallback, all-route simulation, and responsive/manual acceptance.
- Scene IDs, variable names, asset keys, route names, ending IDs, and workspace name are consistent across all tasks.
- No new engine capability is required; any renderer modification is limited to an acceptance defect.
