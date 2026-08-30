export type EditorModeId =
  | 'editor'
  | 'flow'
  | 'timeline'
  | 'config'
  | 'preview'
  | 'review'
  | 'stats'
  | 'audit';

export interface EditorModeDefinition {
  id: EditorModeId;
  label: string;
  panelId: string;
}

export const EDITOR_MODES: readonly EditorModeDefinition[] = [
  { id: 'editor', label: '剧本', panelId: 'editor-workspace' },
  { id: 'flow', label: '流程', panelId: 'flow-view' },
  { id: 'timeline', label: '时间轴', panelId: 'timeline-view' },
  { id: 'config', label: '配置', panelId: 'config-view' },
  { id: 'preview', label: '预览', panelId: 'preview-view' },
  { id: 'review', label: '审阅', panelId: 'review-view' },
  { id: 'stats', label: '统计', panelId: 'stats-view' },
  { id: 'audit', label: '审计', panelId: 'audit-view' },
] as const;

export function editorModeLabel(mode: EditorModeId): string {
  return EDITOR_MODES.find(({ id }) => id === mode)?.label ?? mode;
}
