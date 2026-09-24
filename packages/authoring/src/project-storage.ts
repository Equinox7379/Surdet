import type { ProjectFile, ProjectStorage, TextHasher } from './contracts.js';

export type { ProjectFile, ProjectStorage, ProjectWriteStorage, TextHasher } from './contracts.js';

export function normalizeProjectPath(path: string): string {
  if (path.length === 0 || path.includes('\0') || path.includes('\\') || path.startsWith('/')) {
    throw new Error(`PATH_OUTSIDE_PROJECT: ${path}`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`PATH_OUTSIDE_PROJECT: ${path}`);
  }
  return path;
}

export function isSnapshotPath(path: string): boolean {
  return path === 'game.config.json'
    || path === 'content/config/growth.json'
    || path === 'content/config/gallery.json'
    || path === 'content/config/events.json'
    || path === 'content/config/calendar.json'
    || (path.startsWith('content/scenario/') && path.toLowerCase().endsWith('.gal'))
    || (path.startsWith('content/timelines/') && path.toLowerCase().endsWith('.json'));
}
