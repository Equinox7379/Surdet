import * as crypto from 'node:crypto';
import {
  loadProjectSnapshot,
  type ProjectStorage,
  type TextHasher,
} from '@surdet/authoring';

export interface ProjectCoordinationFileFact {
  path: string;
  sha256: string;
}

export interface ProjectCoordinationBaseline {
  /** Canonical @surdet/authoring snapshot revision. */
  projectRevision: string;
  /**
   * Broader exact-text revision used by the Editor relay. It includes
   * game.config.json, all JSON files below content/config, scenario and timeline text.
   */
  coordinationRevision: string;
  files: ProjectCoordinationFileFact[];
}

export function isCoordinationTextPath(path: string): boolean {
  return path === 'game.config.json'
    || (path.startsWith('content/config/') && path.toLowerCase().endsWith('.json'))
    || (path.startsWith('content/scenario/') && path.toLowerCase().endsWith('.gal'))
    || (path.startsWith('content/timelines/') && path.toLowerCase().endsWith('.json'));
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

export async function loadProjectCoordinationBaseline(
  storage: ProjectStorage,
  hasher: TextHasher = { sha256: async (text) => sha256(text) },
): Promise<ProjectCoordinationBaseline> {
  const paths = [...new Set((await storage.listFiles()).filter(isCoordinationTextPath))]
    .sort((left, right) => left.localeCompare(right));
  const files = await Promise.all(paths.map((path) => storage.readText(path)));
  const canonical = files
    .map((file, index) => ({ path: paths[index]!, sha256: file.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const coordinationRevision = await hasher.sha256(
    canonical.map((file) => `${file.path}\0${file.sha256}`).join('\n'),
  );
  const project = await loadProjectSnapshot(storage, hasher);
  return {
    projectRevision: project.revision,
    coordinationRevision,
    files: canonical,
  };
}
