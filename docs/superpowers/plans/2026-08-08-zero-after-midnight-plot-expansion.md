# Zero After Midnight Story Expansion Implementation Plan

> **For agentic workers:** This document is a story brief for a separate writing model. Do not modify engine APIs or assets while expanding the script unless the project owner explicitly asks for it.

**Goal:** Expand the existing mystery ADV from an abrupt route prototype into a 30–60 minute first playthrough with a clear protagonist/character setup, complete route consequences, and endings that retain ambiguity without feeling cut off.

**Architecture:** Preserve the existing `.gal` scene graph and the three route endings. Add a short prologue and connective dialogue before the current first phone call, then expand each route's final scene using the existing `@bg`, `@show`, `@hide`, `@choice`, `@set`, `@mod`, `@clear`, `@fadeout`, `@jump`, and `@end` contracts. The engine will later provide the shared black-screen `THE END` presentation after `sceneEnd`; the writing model must end each route cleanly at `@clear`/`@end`.

**Tech Stack:** Surdet `.gal` DSL, Chinese modern visual-novel dialogue, existing `zero-after-midnight` scenario/assets/configuration.

## Global Constraints

- Keep the title `零点之后` and the core premise: a missing girl, a 00:17 call, a second phone, North Harbor Passage, and the warning `别开灯`.
- Do not reveal with certainty whether the caller is the real 许知遥, a copy, a recording, a time loop, or a supernatural entity.
- Do not introduce combat, statistics-heavy gameplay, unrelated fantasy lore, or a new protagonist party.
- Keep existing variable names and meanings: `trust`, `evidence`, `panic`, `route`, `recordingSaved`, and `phoneOn`.
- Keep the three existing ending IDs: `silence_end`, `meeting_end`, and `testimony_end`.
- The first playthrough should target 30–60 minutes; route branches should feel substantial but not become a second game.
- Write natural Chinese ADV dialogue: short spoken turns, distinct voices, restrained exposition, and visual actions between dialogue blocks.
- Every route ending must contain immediate consequence, protagonist reaction, one final image/sound, and a deliberate last line before `@clear` and `@end`.

## Story Direction

### Core premise

Three days after 许知遥 disappears, the protagonist receives a call at exactly 00:17 from a number with no attribution. The caller sounds like her and knows private details, but warns him not to turn on the light and not to tell anyone. The investigation moves through a convenience store, 许知遥's old apartment, and the abandoned North Harbor Passage. A second phone contains calls made from the protagonist's own number.

The mystery is not “who is the monster?” but “which version of a person is allowed to count as real when memory, recordings, reflections, and voices can be copied?” The protagonist's choices determine whether he seeks proof, follows the voice, or attempts to sever contact.

### Prologue requirement

Add a 2–4 minute opening before the current 00:17 call. It must establish:

- The protagonist's name or self-description, current occupation/situation, and why he is awake during the rain.
- His prior relationship with 许知遥: they were close enough to share a private nickname and an old apartment memory, but their relationship had become distant before her disappearance.
- The fact that 许知遥 has been missing for three days, how the protagonist learned this, and why he has not simply left the search to the police.
- One concrete shared memory that later becomes evidence the caller should not know.
- A small visual/audio motif that can return at the ending: a convenience-store bell, a red sign, a recorded rain sound, or the 00:17 time display.
- The protagonist's emotional baseline: guilt, unresolved anger, or a promise he failed to keep. Choose one primary emotion and carry it through all routes.

Do not begin with a long biography. Use one present-time action, one object, one short memory, and then the phone call. The first scene should make the player understand why answering the call matters emotionally before the supernatural mystery begins.

## Route Outline

### Act I: The call and the convenience store

The protagonist receives the 00:17 call in a dark apartment. 许知遥 tells him not to turn on the light, asks whether his lights are off, and describes a convenience store with a red sign and a recurring bell. The first choices should establish `trust`, `evidence`, or `panic` without changing the main destination.

At the convenience store, the player must see that the physical evidence is contradictory: a door opens without a second set of footprints, a recording shows no visitor, or a reflection sees a wet girl that the protagonist cannot. End this act by pointing to the old apartment and the instruction not to bring a light.

### Act II: The apartment and the recording

The old apartment contains the looping recorder and a seven-second voice memo. Expand the scene so the protagonist and 许知遥 disagree about whether the voice is a recording, an imitation, or a memory. The `recordingSaved` choice must matter later in the testimony route, while `panic` changes the sensory intensity rather than creating a separate plot hole.

The act ends with the blurred subway map and the three-day-old unsent voice memo leading to North Harbor Passage.

### Act III: North Harbor Passage and the route split

The second phone shows calls from the protagonist's own number beginning three days earlier at 00:17. The reflection contains two versions of him. 许知遥 offers three paths: hand the phone to police, continue following the call, or shut everything down.

The route choice must feel like a character decision, not a menu label:

- `testimony`: choose verifiable evidence and let other people witness the case.
- `meeting`: choose direct contact and accept the risk of becoming part of the call.
- `silence`: choose withdrawal and attempt to stop the chain from spreading.

### Route A: Testimony

The protagonist submits the evidence at the police station, then goes to the rooftop after a message from an unknown number. The police record provides limited reality, but the evidence begins changing or disappearing. The expanded ending should answer what the protagonist gains by making the case public, while preserving the possibility that the public record itself has been copied.

Required ending beats:

1. Someone besides the protagonist has seen or received a piece of evidence.
2. The protagonist makes a conscious decision to keep, publish, or destroy the last copy.
3. The final phone call uses 许知遥's voice but contains a detail from the prologue that only the real girl should know.
4. End with a final image that can be read as either proof of survival or proof of imitation.

### Route B: Meeting

The protagonist follows the last train to the rooftop and encounters a figure that may be 许知遥. The call changes from her number to his own voice. Expand the emotional confrontation: he must name what he regrets about their past, and she must answer in a way that is intimate but not conclusive.

Required ending beats:

1. The protagonist sees a physical inconsistency in the figure or the rooftop.
2. He is offered one chance to confirm her identity, but the confirmation itself is unsafe.
3. The self-voiced call asks a question connected to the prologue.
4. The protagonist's response or refusal changes the immediate situation before the final sound/image.

The current line `我没有回答。` may remain as a thematic line, but it must be followed by a short consequence and a final image before the actual ending marker. It must not be the last content in the script by itself.

### Route C: Silence

The protagonist cuts power, damages or seals the second phone, waits through the night, and reaches dawn. Expand this route as a deliberate attempt to end the chain rather than a passive exit. The final scene should show what “silence” costs him and whether the anomaly has transferred to someone else.

Required ending beats:

1. The protagonist's chosen phone action (`phoneOn` true/false) has a visible consequence.
2. The next morning contains one ordinary detail that proves life continued.
3. A new person encounters the 00:17 motif, showing the danger is unresolved but not explaining it.
4. The protagonist must choose whether to turn, answer, or keep the light off; the choice can be textual and need not create a fourth route.

The current line `许知遥：别开灯。` should be treated as the climax of the silence route, not its complete ending. Add the protagonist's immediate reaction and one final visual/sound beat afterward.

## Expansion Requirements

- Add scene-level dialogue and actions rather than padding existing paragraphs with exposition.
- Give 许知遥 a recognizable speaking pattern: precise sensory descriptions, guarded intimacy, and occasional corrections of the protagonist's memory.
- Give the protagonist a recognizable speaking pattern: concrete observations first, emotional admission later; avoid making every line a rhetorical question.
- Use silence, phone vibration, rain, the bell, and changing timestamps as active dramatic beats.
- For each route, add at least one callback to the prologue and one callback to the first 00:17 call.
- Use existing asset keys when possible. If a new asset is necessary, list it separately with `bg`, `portrait`, `avatar`, `bgm`, `se`, or `voice` kind and a descriptive filename.
- Preserve all current labels and jump targets unless a change is necessary; if changing one, provide a complete mapping from old target to new target.
- Keep choices mechanically meaningful through the existing variables. Do not add a variable unless the reason, initial value, and all affected scenes are specified.
- End each route with `@clear <existing-ending-id>` followed by `@end`; do not add `@jump` after the ending marker. The host will later display the shared black `THE END` screen and return to the title page on `sceneEnd`.

## Deliverables From The Writing AI

1. A revised scene list with estimated play time for each scene.
2. Complete `.gal` text for the prologue, revised common scenes, and all three route endings.
3. A variable impact table showing every read/write of `trust`, `evidence`, `panic`, `recordingSaved`, and `phoneOn`.
4. An asset manifest listing only genuinely new backgrounds, portraits, audio, or avatars.
5. A short ending note for each route explaining the intended interpretation and the deliberately unresolved mystery.
6. A continuity checklist confirming that 00:17, the second phone, North Harbor Passage, the shared nickname, and `别开灯` remain consistent.

## Do Not Do

- Do not make 许知遥 secretly evil without groundwork.
- Do not explain the mystery as a dream, hallucination, or time travel in one paragraph.
- Do not kill the protagonist solely to manufacture a twist.
- Do not turn the three routes into “good/neutral/bad” moral labels; each should reveal a different cost of seeking truth.
- Do not finish immediately after a stylish final sentence. Add consequence, image, and a proper ending beat.
