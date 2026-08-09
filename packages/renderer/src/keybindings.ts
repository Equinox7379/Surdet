import type { RendererInputAction } from './api/renderer-input.js';

/** 可由宿主路由的游戏动作；不持久化任意用户输入的键字符串。 */
export type GameAction = 'advance' | 'auto' | 'skip' | 'backlog' | 'menu' | 'quickSave' | 'quickLoad' | 'rollback' | 'hideUi';
export type KeyPreset = 'standard' | 'left-handed';

type BindingMap = Readonly<Record<GameAction, readonly string[]>>;

const STANDARD: BindingMap = {
  advance: ['Space', 'Enter'],
  auto: ['KeyA'],
  skip: ['KeyS'],
  backlog: ['KeyL'],
  menu: ['Escape'],
  quickSave: ['F5'],
  quickLoad: ['F9'],
  rollback: ['ArrowUp'],
  hideUi: ['KeyH'],
};

const LEFT_HANDED: BindingMap = {
  advance: ['Space', 'Enter'],
  auto: ['KeyJ'],
  skip: ['KeyK'],
  backlog: ['KeyI'],
  menu: ['Escape'],
  quickSave: ['F5'],
  quickLoad: ['F9'],
  rollback: ['KeyU'],
  hideUi: ['KeyY'],
};

export function bindingsForPreset(preset: KeyPreset): BindingMap {
  return preset === 'left-handed' ? LEFT_HANDED : STANDARD;
}

export function actionForKeyboardEvent(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'metaKey'>,
  preset: KeyPreset,
): GameAction | null {
  // Never steal browser/system chords (Ctrl+F search is handled explicitly by
  // the Backlog host path before calling this mapper).
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  const bindings = bindingsForPreset(preset);
  for (const action of Object.keys(bindings) as GameAction[]) {
    if (bindings[action].includes(event.code)) return action;
  }
  return null;
}

/** Convert only Renderer-owned host actions; menu/save/load/rollback stay with the host. */
export function rendererInputForGameAction(action: GameAction): RendererInputAction | null {
  switch (action) {
    case 'advance': return { type: 'advance' };
    case 'auto': return { type: 'auto.toggle' };
    case 'skip': return { type: 'skip.toggle', scope: 'read' };
    case 'backlog': return { type: 'backlog.toggle' };
    case 'hideUi': return { type: 'interface.toggle' };
    default: return null;
  }
}
