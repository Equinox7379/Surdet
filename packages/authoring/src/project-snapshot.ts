import { compileScene, type CompiledScene, type GrowthConfig } from '@surdet/core';
import { parseProjectConfigDocument } from './config-document.js';
import { parseSceneDocument } from './scene-document.js';
import type { SceneDocumentLine } from './contracts.js';
import type { ProjectFile, ProjectStorage, TextHasher } from './project-storage.js';
import { isSnapshotPath, normalizeProjectPath } from './project-storage.js';

export interface ProjectSnapshotScene {
  id: string;
  path: string;
  file: ProjectFile;
  document: SceneDocumentLine[];
  compiled: CompiledScene;
}

export interface ProjectSnapshot {
  rootIdentity: string;
  revision: string;
  files: ProjectFile[];
  configFile: ProjectFile | null;
  config: Record<string, unknown>;
  growthFile?: ProjectFile | null;
  growthConfig?: GrowthConfig | null;
  entryScene?: string;
  variables: Record<string, unknown>;
  scenes: ProjectSnapshotScene[];
  timelines: ProjectFile[];
}

function sceneIdFromPath(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.slice(0, -'.gal'.length);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function loadProjectSnapshot(storage: ProjectStorage, hasher: TextHasher): Promise<ProjectSnapshot> {
  const listed = await storage.listFiles();
  const paths = [...new Set(listed.map(normalizeProjectPath).filter(isSnapshotPath))].sort((a, b) => a.localeCompare(b));
  const files = await Promise.all(paths.map((path) => storage.readText(path)));
  const canonicalFiles = files.map((file, index) => ({ ...file, path: paths[index]! }));
  const revisionInput = canonicalFiles.map((file) => `${file.path}\0${file.sha256}`).join('\n');
  const revision = await hasher.sha256(revisionInput);
  const configFile = canonicalFiles.find((file) => file.path === 'game.config.json') ?? null;
  const growthFile = canonicalFiles.find((file) => file.path === 'content/config/growth.json') ?? null;
  let config: Record<string, unknown> = {};
  if (configFile !== null && configFile.text.trim().length > 0) {
    config = parseProjectConfigDocument(configFile.text);
  }
  const growthConfig = growthFile === null || growthFile.text.trim().length === 0
    ? null
    : JSON.parse(growthFile.text) as GrowthConfig;
  const customInstructions = Array.isArray(config['customInstructions'])
    ? config['customInstructions'].filter((value): value is string => typeof value === 'string')
    : [];
  const scenes = canonicalFiles
    .filter((file) => file.path.startsWith('content/scenario/') && file.path.toLowerCase().endsWith('.gal'))
    .map((file) => {
      const id = sceneIdFromPath(file.path);
      return {
        id,
        path: file.path,
        file,
        document: parseSceneDocument(file.text),
        compiled: compileScene(file.text, file.path, id, customInstructions),
      } satisfies ProjectSnapshotScene;
    });
  const variables = asRecord(config['variables']);
  return {
    rootIdentity: storage.rootIdentity,
    revision,
    files: canonicalFiles,
    configFile,
    config,
    growthFile,
    growthConfig,
    ...(typeof config['entryScene'] === 'string' && config['entryScene'].length > 0
      ? { entryScene: config['entryScene'] }
      : {}),
    variables,
    scenes,
    timelines: canonicalFiles.filter((file) => file.path.startsWith('content/timelines/')),
  };
}
