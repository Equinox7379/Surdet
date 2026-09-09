import { normalizeProjectPath } from '@surdet/authoring';

export interface ProjectDiskFileFact {
  path: string;
  sha256: string;
}

export interface ProjectDiskBaseline {
  projectRevision: string;
  coordinationRevision: string;
  files: ProjectDiskFileFact[];
}

export interface ProjectDiskChangeSet {
  created: string[];
  modified: string[];
  deleted: string[];
  all: string[];
}

const SHA256 = /^[0-9a-f]{64}$/;

function canonicalMap(baseline: ProjectDiskBaseline): Map<string, string> {
  if (!SHA256.test(baseline.projectRevision)
    || !SHA256.test(baseline.coordinationRevision)) {
    throw new Error('projectRevision 与 coordinationRevision 必须是 SHA-256');
  }
  const result = new Map<string, string>();
  for (const file of baseline.files) {
    const path = normalizeProjectPath(file.path);
    if (!SHA256.test(file.sha256)) throw new Error(`文件 SHA-256 无效：${path}`);
    if (result.has(path)) throw new Error(`磁盘基线存在重复路径：${path}`);
    result.set(path, file.sha256);
  }
  return result;
}

/**
 * Full disk-baseline diff. It deliberately ignores latest mutation notice
 * changedPaths, because several external commits may occur before the Editor
 * polls the latest notice.
 */
export function diffProjectDiskBaselines(
  before: ProjectDiskBaseline,
  after: ProjectDiskBaseline,
): ProjectDiskChangeSet {
  const left = canonicalMap(before);
  const right = canonicalMap(after);
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  for (const path of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    if (!left.has(path)) created.push(path);
    else if (!right.has(path)) deleted.push(path);
    else if (left.get(path) !== right.get(path)) modified.push(path);
  }
  return {
    created,
    modified,
    deleted,
    all: [...created, ...modified, ...deleted].sort(),
  };
}

export function expectedShaFor(
  baseline: ProjectDiskBaseline,
  path: string,
): string | null {
  return canonicalMap(baseline).get(normalizeProjectPath(path)) ?? null;
}

export function assertDiskFileMatchesBaseline(
  expected: string | null,
  actual: string | null,
  path: string,
): void {
  if (expected === actual) return;
  const error = new Error(`项目已被外部更新，未覆盖你的草稿：${normalizeProjectPath(path)}`);
  error.name = 'EditorProjectBaselineChangedError';
  throw error;
}
