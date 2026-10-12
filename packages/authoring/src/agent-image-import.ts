/** Public asset intake contract. Filesystem access belongs to the local adapter.
 * Existing image-named exports remain the same public request/limit contract. */
export const AGENT_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
export const AGENT_MEDIA_EXTENSIONS = [...AGENT_IMAGE_EXTENSIONS, 'wav', 'ogg', 'mp3', 'mp4', 'webm', 'ttf', 'otf', 'woff2', 'txt', 'md'] as const;
export const AGENT_IMAGE_MAX_BYTES = 32 * 1024 * 1024;
export const AGENT_IMAGE_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
export const AGENT_IMAGE_MAX_FILES = 32;
export const AGENT_LICENSE_MAX_BYTES = 1024 * 1024;

export interface AgentImageImportItem {
  itemId: string;
  sourceId: string;
  sourcePath: string;
  sha256: string;
  kind: 'background' | 'portrait' | 'avatar' | 'rule' | 'music' | 'ambience' | 'sound-effect' | 'voice' | 'video' | 'font' | 'license';
  fileName: string;
}

export interface AgentImageStageRequest {
  operationId: string;
  items: AgentImageImportItem[];
}

export interface AgentImageCommitRequest {
  operationId: string;
  planFingerprint: string;
}
