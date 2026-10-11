export const DESKTOP_ORIGIN = 'surdet-editor://app';
export interface DirectoryGrant { token: string; name: string; identity: string }
export type DirectoryContent = { kind: 'directory'; entries: Array<{ name: string; kind: 'directory' | 'file' }> };
export type FileContent = { kind: 'file'; bytes: Uint8Array; lastModified: number };
export interface RecentProjectSummary { id: string; name: string; location: string; openedAt: number }
export interface ProjectCreationLocation { id: string; location: string }
export interface CreateProjectRequest { locationId: string; name: string; template: 'blank' | 'example' }
export interface ExportGameRequest { locationId: string; folderName: string; title?: string; version?: string; icon?: string; encrypted?: boolean; trustedPlugins?: string[] }
export interface ExportGameProgress { phase: 'checking' | 'runtime' | 'content' | 'archive' | 'verify' | 'complete'; completed: number; total: number }
export interface ExportGameInspection { id: string; title: string; version: string; issues: Array<{ severity: string; code: string; text: string; file: string; line: number; col: number; hint?: string }>; plugins: Array<{ id: string; entry: string }> }
export interface ExportGameResult { directory: string; executable: string; id: string; title: string; version: string }
export interface DesktopBridge {
  inspectGameExport(): Promise<ExportGameInspection>;
  chooseExportLocation(): Promise<ProjectCreationLocation | null>;
  exportGame(request: ExportGameRequest): Promise<ExportGameResult>;
  cancelGameExport(): Promise<void>;
  showGameExport(): Promise<void>;
  onGameExportProgress(callback: (progress: ExportGameProgress) => void): () => void;
  context(): Promise<DirectoryGrant | null>;
  openProject(): Promise<void>;
  chooseProjectLocation(): Promise<ProjectCreationLocation | null>;
  createProject(request: CreateProjectRequest): Promise<void>;
  recentProjects(): Promise<RecentProjectSummary[]>;
  openRecentProject(id: string): Promise<void>;
  pickDirectory(): Promise<DirectoryGrant | null>;
  read(token: string, path: string): Promise<DirectoryContent | FileContent>;
  reportUnloadState(busy: boolean): void;
}
