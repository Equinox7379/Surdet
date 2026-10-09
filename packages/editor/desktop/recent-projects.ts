import { createHash } from 'node:crypto';
import type { RecentProjectSummary } from './contracts.js';

/**
 * Recent projects are directories the person already chose in the native picker.
 * The renderer only ever receives an opaque id; opening resolves that id here, so a
 * page can never ask the main process to open an arbitrary path.
 */
export interface RecentProject { path: string; name: string; openedAt: number }
export const RECENT_PROJECT_LIMIT = 8;

// Same case folding as the directory identity: Windows paths are case-insensitive.
const key = (projectPath: string): string => projectPath.toLowerCase();

export function recentProjectId(projectPath: string): string {
  return createHash('sha256').update(key(projectPath)).digest('hex').slice(0, 24);
}

export function parseRecentProjects(raw: unknown): RecentProject[] {
  const entries = (raw as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const result: RecentProject[] = [];
  for (const entry of entries as Array<Partial<RecentProject> | null>) {
    if (typeof entry?.path !== 'string' || entry.path.length === 0 || entry.path.length > 4096) continue;
    if (typeof entry.name !== 'string' || typeof entry.openedAt !== 'number' || !Number.isFinite(entry.openedAt)) continue;
    if (seen.has(key(entry.path))) continue;
    seen.add(key(entry.path));
    result.push({ path: entry.path, name: entry.name, openedAt: entry.openedAt });
    if (result.length === RECENT_PROJECT_LIMIT) break;
  }
  return result;
}

export function withRecentProject(list: readonly RecentProject[], project: RecentProject): RecentProject[] {
  return [project, ...list.filter((entry) => key(entry.path) !== key(project.path))].slice(0, RECENT_PROJECT_LIMIT);
}

export function findRecentProject(list: readonly RecentProject[], id: unknown): RecentProject | undefined {
  if (typeof id !== 'string') return undefined;
  return list.find((entry) => recentProjectId(entry.path) === id);
}

export function summarizeRecentProjects(list: readonly RecentProject[]): RecentProjectSummary[] {
  return list.map((entry) => ({ id: recentProjectId(entry.path), name: entry.name, location: entry.path, openedAt: entry.openedAt }));
}
