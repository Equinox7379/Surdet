import type { ProjectAssetItem } from '@surdet/authoring';

const ASSET_ROOT = 'content/assets';

export interface AssetFolderOption {
  path: string;
  label: string;
  depth: number;
  count: number;
}

export interface AssetFolderBreadcrumb {
  path: 'all' | string;
  label: string;
}

function safeSegments(path: string): string[] | null {
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return null;
  const segments = path.replaceAll('\\', '/').split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return null;
  return segments;
}

function normalizeFolder(folder: string): string | null {
  const segments = safeSegments(folder);
  if (!segments || segments[0] !== 'content' || segments[1] !== 'assets') return null;
  return segments.join('/');
}

function normalizedSourcePath(item: ProjectAssetItem): string | null {
  if (!item.physical || !item.sourcePath) return null;
  const segments = safeSegments(item.sourcePath);
  if (!segments || segments.length < 3 || segments[0] !== 'content' || segments[1] !== 'assets') return null;
  return segments.join('/');
}

function folderPathForItem(item: ProjectAssetItem): string | null {
  const sourcePath = normalizedSourcePath(item);
  if (!sourcePath) return null;
  return sourcePath.split('/').slice(0, -1).join('/');
}

function compareFolderPaths(left: string, right: string): number {
  const leftSegments = left.split('/').slice(2);
  const rightSegments = right.split('/').slice(2);
  const length = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = leftSegments[index]!.localeCompare(rightSegments[index]!, 'zh-CN');
    if (comparison !== 0) return comparison;
  }
  return leftSegments.length - rightSegments.length;
}

export function assetMatchesFolder(item: ProjectAssetItem, folder: 'all' | string): boolean {
  if (folder === 'all') return true;
  const normalizedFolder = normalizeFolder(folder);
  const sourcePath = normalizedSourcePath(item);
  if (!normalizedFolder || !sourcePath) return false;
  return sourcePath.startsWith(`${normalizedFolder}/`);
}

export function buildAssetFolderOptions(items: readonly ProjectAssetItem[]): AssetFolderOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const folder = folderPathForItem(item);
    if (!folder) continue;
    counts.set(ASSET_ROOT, (counts.get(ASSET_ROOT) ?? 0) + 1);
    const relativeSegments = folder.split('/').slice(2);
    for (let depth = 1; depth <= relativeSegments.length; depth += 1) {
      const path = `${ASSET_ROOT}/${relativeSegments.slice(0, depth).join('/')}`;
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }

  return [...counts]
    .map(([path, count]) => ({ path, count }))
    .sort((left, right) => compareFolderPaths(left.path, right.path))
    .map(({ path, count }) => ({
      path,
      count,
      label: path === ASSET_ROOT ? '素材根目录' : path.split('/').at(-1)!,
      depth: path === ASSET_ROOT ? 0 : path.split('/').length - 2,
    }));
}

export function assetFolderBreadcrumbs(folder: 'all' | string): AssetFolderBreadcrumb[] {
  const all: AssetFolderBreadcrumb = { path: 'all', label: '全部位置' };
  if (folder === 'all') return [all];
  const normalizedFolder = normalizeFolder(folder);
  if (!normalizedFolder) return [all];

  const breadcrumbs: AssetFolderBreadcrumb[] = [all, { path: ASSET_ROOT, label: '素材根目录' }];
  const relativeSegments = normalizedFolder.split('/').slice(2);
  for (let depth = 1; depth <= relativeSegments.length; depth += 1) {
    breadcrumbs.push({
      path: `${ASSET_ROOT}/${relativeSegments.slice(0, depth).join('/')}`,
      label: relativeSegments[depth - 1]!,
    });
  }
  return breadcrumbs;
}
