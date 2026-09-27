/**
 * @surdet/core — Surdet 引擎内核
 *
 * 零依赖、headless 可运行。渲染层（@surdet/renderer）只负责把内核对外的投影画出来。
 */
export * from './state/types.js';
export * from './state/variable-store.js';
export * from './runtime/event-bus.js';
export * from './runtime/scene-registry.js';
export * from './runtime/scene-id.js';
export * from './runtime/random-source.js';
export * from './runtime/interpreter.js';
export * from './runtime/expr-eval.js';
export * from './runtime/read-tracker.js';
export * from './dsl/token.js';
export * from './dsl/ast.js';
export * from './dsl/expr-ast.js';
export * from './dsl/expr-parser.js';
export * from './dsl/lexer.js';
export * from './dsl/parser.js';
export * from './dsl/compiler.js';
export * from './save/save-manager.js';
export * from './save/migrate.js';
export * from './combat/combat.js';
export * from './calendar/calendar.js';
export * from './systems/affection.js';
export * from './systems/gallery.js';
export * from './systems/gallery-state.js';
export * from './systems/newgame-plus.js';
export * from './systems/clear-tracker.js';
export * from './systems/event-scheduler.js';
export * from './systems/growth.js';
export * from './systems/achievement.js';
export * from './scene-lint.js';
export * from './lint-hints.js';
export * from './terminology-audit.js';
export * from './systems/shop.js';
export * from './timeline.js';
export * from './localization.js';
export * from './project-stats.js';
export * from './project-fonts.js';
export * from './project-theme.js';
export * from './theme-tokens.js';
export * from './stage.js';
export { assertUniquePortraitBindings, parsePortraitFileName, projectPortraitOverrides, portraitSourcePaths, resolveProjectPortraits, type CharacterPortraits, type CharacterVisuals, type ProjectPortrait } from './project-portraits.js';
export { parsePortraitVisual, portraitVisualPaths, samplePortraitVisual, type PortraitVisualDefinition } from './portrait-visual.js';
