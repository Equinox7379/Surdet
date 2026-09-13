/** Public image intake contract. Filesystem access belongs to the local adapter. */
export const AGENT_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
export const AGENT_IMAGE_MAX_BYTES = 32 * 1024 * 1024;
export const AGENT_IMAGE_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
export const AGENT_IMAGE_MAX_FILES = 32;

export interface AgentImageImportItem {
  itemId: string;
  sourceId: string;
  sourcePath: string;
  sha256: string;
  kind: 'background' | 'portrait' | 'avatar';
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
