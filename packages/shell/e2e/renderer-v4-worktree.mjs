import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const QUALIFICATION_TEMP_ROOT = 'C:\\Users\\Equinox\\AppData\\Local\\Temp\\surdet-renderer-v4-qualification-2026-08-10';
export const QUALIFICATION_GROUP_ORDER = Object.freeze([
  'q1-007-a-b',
  'q2-007-b-a',
  'q3-f7-a-b',
  'q4-f7-b-a',
  'q5-f7-same-root',
]);

const OLD_COMMIT = '007438b569ec95350fdc9d7882ad49f55bbb7968';
const CURRENT_COMMIT = 'f7f4522adb297d8b97b6ba0b0824b5db6a8aaf59';

function git(repositoryRoot, args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', shell: false });
}

function uniqueRoots(matrix) {
  const result = [];
  const seen = new Set();
  for (const group of matrix) {
    for (const role of ['baseline', 'current']) {
      const descriptor = group[role];
      if (seen.has(descriptor.root)) continue;
      seen.add(descriptor.root);
      result.push({ group: group.id, ...descriptor });
    }
  }
  return result;
}

export function validateQualificationPath(candidate, parent) {
  const parentPath = path.resolve(parent);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(parentPath, candidatePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || candidatePath.includes('*')) {
    throw new Error(`worktree 路径必须是临时根目录内的精确路径：${candidatePath}`);
  }
  return candidatePath;
}

export function validateRepositoryRoot(candidate, expectedRoot) {
  const expectedPath = path.resolve(expectedRoot);
  const candidatePath = path.resolve(candidate);
  const relative = path.relative(expectedPath, candidatePath);
  if (relative.startsWith('..') || path.isAbsolute(relative) || candidatePath.includes('*')) {
    throw new Error(`repository-root 必须是工作区根目录或其内部路径：${candidatePath}`);
  }
  return candidatePath;
}

export function buildQualificationMatrix(tempRoot = QUALIFICATION_TEMP_ROOT) {
  const root = path.resolve(tempRoot);
  const descriptor = (id, label, commit, role) => ({
    group: id,
    label,
    commit,
    role,
    root: path.join(root, `${id}-${label.toLowerCase()}`),
  });
  const matrix = [
    { id: 'q1-007-a-b', artifact: 'docs/baselines/renderer-v4-q1-007-a-b-2026-08-10.json', baseline: descriptor('q1-007-a-b', 'A', OLD_COMMIT, 'baseline'), current: descriptor('q1-007-a-b', 'B', OLD_COMMIT, 'current') },
    { id: 'q2-007-b-a', artifact: 'docs/baselines/renderer-v4-q2-007-b-a-2026-08-10.json', baseline: descriptor('q2-007-b-a', 'B', OLD_COMMIT, 'baseline'), current: descriptor('q2-007-b-a', 'A', OLD_COMMIT, 'current') },
    { id: 'q3-f7-a-b', artifact: 'docs/baselines/renderer-v4-q3-f7-a-b-2026-08-10.json', baseline: descriptor('q3-f7-a-b', 'A', CURRENT_COMMIT, 'baseline'), current: descriptor('q3-f7-a-b', 'B', CURRENT_COMMIT, 'current') },
    { id: 'q4-f7-b-a', artifact: 'docs/baselines/renderer-v4-q4-f7-b-a-2026-08-10.json', baseline: descriptor('q4-f7-b-a', 'B', CURRENT_COMMIT, 'baseline'), current: descriptor('q4-f7-b-a', 'A', CURRENT_COMMIT, 'current') },
    {
      id: 'q5-f7-same-root',
      artifact: 'docs/baselines/renderer-v4-q5-f7-same-root-2026-08-10.json',
      baseline: { ...descriptor('q5-f7-same-root', 'same-root', CURRENT_COMMIT, 'baseline'), root: path.join(root, 'q5-f7-same-root') },
      current: { ...descriptor('q5-f7-same-root', 'same-root', CURRENT_COMMIT, 'current'), root: path.join(root, 'q5-f7-same-root') },
    },
  ];
  if (matrix.map((group) => group.id).join('|') !== QUALIFICATION_GROUP_ORDER.join('|')) throw new Error('固定 Q 组顺序被改变');
  for (const group of matrix) {
    for (const role of ['baseline', 'current']) validateQualificationPath(group[role].root, root);
  }
  return matrix;
}

export function parseRendererV4QualificationArgs(argv) {
  const values = new Map();
  const allowed = new Set(['repository-root', 'temp-root', 'artifact-dir']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--') || !allowed.has(argument.slice(2))) throw new Error(`未知参数：${argument}`);
    const name = argument.slice(2);
    if (values.has(name)) throw new Error(`参数只能出现一次：--${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：--${name}`);
    values.set(name, value);
    index += 1;
  }
  for (const name of ['repository-root', 'temp-root', 'artifact-dir']) if (!values.has(name)) throw new Error(`缺少必需参数：--${name}`);
  const repositoryRoot = path.resolve(values.get('repository-root'));
  const tempRoot = path.resolve(values.get('temp-root'));
  const artifactDir = path.resolve(values.get('artifact-dir'));
  if (repositoryRoot === tempRoot || repositoryRoot === artifactDir) throw new Error('repository-root、temp-root、artifact-dir 必须是不同路径');
  return { repositoryRoot, tempRoot, artifactDir };
}

export function createQualificationWorktrees(group, repositoryRoot, tempRoot = QUALIFICATION_TEMP_ROOT) {
  if (!group || !group.id) throw new Error('缺少 Q group');
  const root = path.resolve(tempRoot);
  const descriptors = uniqueRoots([group]);
  for (const descriptor of descriptors) {
    const worktreePath = validateQualificationPath(descriptor.root, root);
    if (fs.existsSync(worktreePath)) throw new Error(`拒绝覆盖已存在的资格 worktree：${worktreePath}`);
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    git(repositoryRoot, ['worktree', 'add', '--detach', worktreePath, descriptor.commit]);
  }
  return descriptors.map((descriptor) => ({
    ...descriptor,
    createdAt: new Date().toISOString(),
    stage: 'created',
    artifact: group.artifact,
    dirty: git(descriptor.root, ['status', '--porcelain', '--untracked-files=all']).trim(),
    removed: false,
    cleaned: false,
  }));
}

export function buildCleanupManifest(matrix, options = {}) {
  const stage = options.stage ?? 'unknown';
  const artifact = options.artifact ?? null;
  const worktrees = uniqueRoots(matrix).map((descriptor) => ({
    path: path.resolve(descriptor.root),
    commit: descriptor.commit,
    group: descriptor.group,
    roles: matrix
      .filter((group) => group.baseline.root === descriptor.root || group.current.root === descriptor.root)
      .flatMap((group) => ['baseline', 'current'].filter((role) => group[role].root === descriptor.root).map((role) => ({ group: group.id, role, label: group[role].label }))),
    createdAt: null,
    stage,
    artifact,
    dirty: null,
    removed: false,
    cleaned: false,
  }));
  return {
    schemaVersion: 1,
    artifactKind: 'renderer-v4-qualification-cleanup',
    tempRoot: path.resolve(options.tempRoot ?? QUALIFICATION_TEMP_ROOT),
    worktrees,
  };
}
