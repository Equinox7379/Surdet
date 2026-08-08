/** Normalized input actions consumed by the presentation controller. */
export type RendererInputAction =
  | { type: 'advance' }
  | { type: 'choice.move'; delta: -1 | 1 }
  | { type: 'choice.select'; index: number }
  | { type: 'backlog.toggle' }
  | { type: 'backlog.scroll'; delta: number }
  | { type: 'auto.toggle' }
  | { type: 'skip.toggle'; scope: 'read' | 'all' }
  | { type: 'interface.toggle' }
  | { type: 'escape' };
