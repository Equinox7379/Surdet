/** Normalized input actions consumed by the presentation controller. */
export type RendererInputAction =
  | { type: 'advance' }
  | { type: 'choice.move'; delta: -1 | 1 }
  | { type: 'choice.select'; index: number }
  /** Zero-based position among the currently displayed choices, after conditions are applied. */
  | { type: 'choice.select-visible'; position: number }
  | { type: 'backlog.toggle' }
  | { type: 'backlog.scroll'; delta: number }
  | { type: 'auto.toggle' }
  | { type: 'skip.toggle'; scope: 'read' | 'all' }
  | { type: 'interface.toggle' }
  | { type: 'escape' };
