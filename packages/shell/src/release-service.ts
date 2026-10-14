import * as fs from 'node:fs';

export interface ReleaseManifest {
  engine: 'surdet';
  game: string;
  version: string;
  generatedAt: string;
  notes: string;
  channel?: string;
  downloadUrl?: string;
  sha256?: string;
}

export interface ReleaseCheckResult {
  status: 'update-available' | 'up-to-date' | 'invalid';
  currentVersion: string;
  manifest?: ReleaseManifest;
  message?: string;
}

function parseVersion(value: string): number[] | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/.exec(value.trim());
  if (!match) return null;
  const parts = [match[1], match[2] ?? '0', match[3] ?? '0', match[4] ?? '0'].map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

export function parseReleaseManifest(value: unknown): ReleaseManifest | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.engine !== 'surdet' || typeof raw.game !== 'string' || typeof raw.version !== 'string' || typeof raw.generatedAt !== 'string' || typeof raw.notes !== 'string') return null;
  return {
    engine: 'surdet', game: raw.game, version: raw.version, generatedAt: raw.generatedAt, notes: raw.notes,
    ...(typeof raw.channel === 'string' ? { channel: raw.channel } : {}),
    ...(typeof raw.downloadUrl === 'string' ? { downloadUrl: raw.downloadUrl } : {}),
    ...(typeof raw.sha256 === 'string' ? { sha256: raw.sha256 } : {}),
  };
}

export function readReleaseManifest(filePath: string): ReleaseManifest | null {
  try { return parseReleaseManifest(JSON.parse(fs.readFileSync(filePath, 'utf8'))); } catch { return null; }
}

export async function checkReleaseManifest(
  manifestPath: string,
  currentVersion: string,
): Promise<ReleaseCheckResult> {
  const manifest = readReleaseManifest(manifestPath);
  if (!manifest) return { status: 'invalid', currentVersion, message: '版本清单无效或不存在' };
  if (!parseVersion(manifest.version) || !parseVersion(currentVersion)) {
    return { status: 'invalid', currentVersion, manifest, message: '版本号无效，无法比较更新' };
  }
  return isNewerVersion(manifest.version, currentVersion)
    ? { status: 'update-available', currentVersion, manifest }
    : { status: 'up-to-date', currentVersion, manifest };
}
