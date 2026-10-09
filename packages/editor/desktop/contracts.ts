export const DESKTOP_ORIGIN = 'surdet-editor://app';
export interface DirectoryGrant { token: string; name: string; identity: string }
export type DirectoryContent = { kind: 'directory'; entries: Array<{ name: string; kind: 'directory' | 'file' }> };
export type FileContent = { kind: 'file'; bytes: Uint8Array; lastModified: number };
export interface RecentProjectSummary { id: string; name: string; location: string; openedAt: number }
export interface DesktopBridge {
  context(): Promise<DirectoryGrant | null>;
  openProject(): Promise<void>;
  recentProjects(): Promise<RecentProjectSummary[]>;
  openRecentProject(id: string): Promise<void>;
  pickDirectory(): Promise<DirectoryGrant | null>;
  read(token: string, path: string): Promise<DirectoryContent | FileContent>;
  reportUnloadState(busy: boolean): void;
}
