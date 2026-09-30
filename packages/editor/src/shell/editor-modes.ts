export type EditorModeId =
  | 'editor'
  | 'assets'
  | 'flow'
  | 'timeline'
  | 'config'
  | 'preview'
  | 'review'
  | 'stats'
  | 'history'
  | 'audit';

export type EditorModeGroupId = 'create' | 'check' | 'project';

export interface EditorModeGroupDefinition {
  id: EditorModeGroupId;
  label: string;
}

export interface EditorModeDefinition {
  id: EditorModeId;
  label: string;
  panelId: string;
  group: EditorModeGroupId;
}

export const EDITOR_MODE_GROUPS: readonly EditorModeGroupDefinition[] = [
  { id: 'create', label: '创作' },
  { id: 'check', label: '检查' },
  { id: 'project', label: '项目' },
] as const;

export const EDITOR_MODES: readonly EditorModeDefinition[] = [
  { id: 'editor', label: '剧本', panelId: 'editor-workspace', group: 'create' },
  { id: 'assets', label: '素材', panelId: 'asset-center-view', group: 'create' },
  { id: 'flow', label: '流程', panelId: 'flow-view', group: 'create' },
  { id: 'timeline', label: '时间轴', panelId: 'timeline-view', group: 'create' },
  { id: 'config', label: '配置', panelId: 'config-view', group: 'create' },
  { id: 'preview', label: '预览', panelId: 'preview-view', group: 'check' },
  { id: 'review', label: '审阅', panelId: 'review-view', group: 'check' },
  { id: 'stats', label: '统计', panelId: 'stats-view', group: 'project' },
  { id: 'history', label: '历史', panelId: 'history-view', group: 'project' },
  { id: 'audit', label: '审计', panelId: 'audit-view', group: 'project' },
] as const;

export function editorModeLabel(mode: EditorModeId): string {
  return EDITOR_MODES.find(({ id }) => id === mode)?.label ?? mode;
}
