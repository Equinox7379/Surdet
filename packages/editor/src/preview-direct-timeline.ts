export const DIRECT_TIMELINE_PREVIEW_SCENE_ID = 'surdet_timeline_preview';

export function createDirectTimelinePreviewScene(timelineId: string): { id: string; text: string } {
  return {
    id: DIRECT_TIMELINE_PREVIEW_SCENE_ID,
    text: `@scene ${DIRECT_TIMELINE_PREVIEW_SCENE_ID}\n@timeline ${timelineId} @ blocking\n@end`,
  };
}
