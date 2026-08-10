import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';

export const BUILD_EQUIVALENCE_SCHEMA_VERSION = 1;

const scriptPath = url.fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '../../..');
const roots = Object.freeze({
  shellDist: 'packages/shell/dist',
  starterDist: 'examples/starter/dist',
});
const requiredShellEntries = Object.freeze([
  'packages/shell/dist/main.js',
  'packages/shell/dist/preload.js',
]);
const requiredStarterEntries = Object.freeze(['examples/starter/dist/index.html']);
const sha256Pattern = /^[0-9a-f]{64}$/i;
const sourceShaPattern = /^[0-9a-f]{40}$/i;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function git(workspaceRoot, args) {
  return execFileSync('git', args, { cwd: workspaceRoot, encoding: 'utf8', shell: false });
}

function packageVersion(workspaceRoot, packageName) {
  try {
    const packagePath = path.join(workspaceRoot, 'node_modules', ...packageName.split('/'), 'package.json');
    return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function npmVersion() {
  try {
    const packagePath = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'package.json');
    return JSON.parse(fs.readFileSync(packagePath, 'utf8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function walkFiles(root, relativeRoot) {
  const absolute = path.join(root, relativeRoot);
  if (!fs.existsSync(absolute)) throw new Error(`构建目录不存在：${absolute}`);
  const files = [];
  const visit = (currentAbsolute, currentRelative) => {
    for (const entry of fs.readdirSync(currentAbsolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(currentAbsolute, entry.name);
      const relativePath = path.posix.join(currentRelative.replace(/\\/g, '/'), entry.name);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else if (entry.isFile()) files.push({ absolutePath, relativePath });
      else throw new Error(`构建目录包含非普通文件：${absolutePath}`);
    }
  };
  visit(absolute, relativeRoot.replace(/\\/g, '/'));
  return files;
}

function assertSha(value, label) {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) throw new Error(`${label} 必须是完整 64 位 SHA-256`);
}

function assertSourceSha(value, label) {
  if (typeof value !== 'string' || !sourceShaPattern.test(value)) throw new Error(`${label} 必须是完整 40 位 SHA`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} 必须是非空字符串`);
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${label} 必须是非空字符串数组`);
  }
}

function expectedBundleEntries(files, workspaceRoot) {
  const fileNames = new Set(files.map((file) => file.relativePath));
  for (const entry of [...requiredShellEntries, ...requiredStarterEntries]) {
    if (!fileNames.has(entry)) throw new Error(`缺少构建入口：${entry}`);
  }
  const indexPath = path.join(workspaceRoot, 'examples/starter/dist/index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const referenced = [...html.matchAll(/(?:src|href)=["']\/?(assets\/[^"']+)["']/g)]
    .map((match) => `examples/starter/dist/${match[1]}`)
    .filter((relativePath) => fileNames.has(relativePath));
  if (referenced.length === 0) throw new Error('starter index.html 没有引用可验证的 assets bundle entry');
  return [...requiredShellEntries, ...requiredStarterEntries, ...new Set(referenced)].sort();
}

export function collectBuildManifest(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const lockfilePath = path.join(root, 'package-lock.json');
  if (!fs.existsSync(lockfilePath)) throw new Error(`缺少 package-lock.json：${lockfilePath}`);
  const fileRecords = [...walkFiles(root, roots.shellDist), ...walkFiles(root, roots.starterDist)]
    .map(({ absolutePath, relativePath }) => ({
      relativePath,
      size: fs.statSync(absolutePath).size,
      sha256: sha256File(absolutePath),
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const entries = expectedBundleEntries(fileRecords, root);
  const byPath = new Map(fileRecords.map((file) => [file.relativePath, file.sha256]));
  return {
    schemaVersion: BUILD_EQUIVALENCE_SCHEMA_VERSION,
    artifactKind: 'renderer-build-manifest',
    sourceCommit: git(root, ['rev-parse', 'HEAD']).trim(),
    packageLockSha256: sha256File(lockfilePath),
    buildCommand: ['npm', 'run', 'build'],
    installCommand: ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    noMtime: true,
    worktreeStatus: git(root, ['status', '--porcelain', '--untracked-files=all']),
    environment: {
      node: process.version,
      npm: npmVersion(),
      electron: packageVersion(root, 'electron'),
      playwright: packageVersion(root, 'playwright'),
      os: `${os.platform()} ${os.release()}`,
      platform: process.platform,
      arch: process.arch,
      cpu: os.cpus()[0]?.model ?? 'unknown',
    },
    roots,
    files: fileRecords,
    bundleEntries: Object.fromEntries(entries.map((entry) => [entry, byPath.get(entry)])),
  };
}

function expectedPaths(value) {
  const files = value.files;
  const paths = files.map((file) => file.relativePath);
  if (new Set(paths).size !== paths.length) throw new Error('build manifest files.relativePath 不能重复');
  const sorted = [...paths].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(paths) !== JSON.stringify(sorted)) throw new Error('build manifest files 必须按 relativePath 排序');
  for (const relativePath of paths) {
    if (!relativePath.startsWith(`${roots.shellDist}/`) && !relativePath.startsWith(`${roots.starterDist}/`)) {
      throw new Error(`build manifest 文件越出 dist 根：${relativePath}`);
    }
    if (relativePath.includes('..') || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
      throw new Error(`build manifest relativePath 必须是安全 POSIX 路径：${relativePath}`);
    }
  }
  return new Set(paths);
}

export function validateBuildManifest(value, options = {}) {
  const requireClean = options.requireClean !== false;
  if (!isRecord(value) || value.schemaVersion !== BUILD_EQUIVALENCE_SCHEMA_VERSION) {
    throw new Error(`build manifest schemaVersion 必须为 ${BUILD_EQUIVALENCE_SCHEMA_VERSION}`);
  }
  if (value.artifactKind !== 'renderer-build-manifest') throw new Error('build manifest artifactKind 无效');
  assertSourceSha(value.sourceCommit, 'sourceCommit');
  assertSha(value.packageLockSha256, 'packageLockSha256');
  assertStringArray(value.buildCommand, 'buildCommand');
  assertStringArray(value.installCommand, 'installCommand');
  if (value.noMtime !== true) throw new Error('build manifest 必须声明 noMtime=true');
  if (typeof value.worktreeStatus !== 'string') throw new Error('worktreeStatus 必须是字符串');
  if (requireClean && value.worktreeStatus !== '') throw new Error(`构建 manifest 工作树不干净：${value.worktreeStatus}`);
  if (!isRecord(value.environment)) throw new Error('environment 必须是对象');
  for (const key of ['node', 'npm', 'electron', 'playwright', 'os', 'platform', 'arch', 'cpu']) assertNonEmptyString(value.environment[key], `environment.${key}`);
  if (JSON.stringify(value.roots) !== JSON.stringify(roots)) throw new Error('build manifest roots 不匹配');
  if (!Array.isArray(value.files) || value.files.length === 0) throw new Error('build manifest files 不能为空');
  const paths = expectedPaths(value);
  for (const [index, file] of value.files.entries()) {
    if (!isRecord(file)) throw new Error(`files[${index}] 必须是对象`);
    assertNonEmptyString(file.relativePath, `files[${index}].relativePath`);
    if (Object.hasOwn(file, 'mtimeMs') || Object.hasOwn(file, 'mtime')) throw new Error(`files[${index}] 不得包含 mtime`);
    if (!Number.isInteger(file.size) || file.size < 0) throw new Error(`files[${index}].size 必须是非负整数`);
    assertSha(file.sha256, `files[${index}].sha256`);
  }
  if (!isRecord(value.bundleEntries)) throw new Error('bundleEntries 必须是对象');
  for (const entry of [...requiredShellEntries, ...requiredStarterEntries]) {
    if (!paths.has(entry)) throw new Error(`bundleEntries 缺少 ${entry}`);
  }
  const starterBundleEntries = Object.keys(value.bundleEntries).filter((entry) => entry.startsWith(`${roots.starterDist}/assets/`));
  if (starterBundleEntries.length === 0) throw new Error('bundleEntries 缺少 starter assets bundle entry');
  const filesByPath = new Map(value.files.map((file) => [file.relativePath, file.sha256]));
  for (const [entry, sha] of Object.entries(value.bundleEntries)) {
    if (!paths.has(entry)) throw new Error(`bundleEntries 指向不存在文件：${entry}`);
    assertSha(sha, `bundleEntries.${entry}`);
    if (filesByPath.get(entry) !== sha) throw new Error(`bundleEntries.${entry} 与 files SHA 不一致`);
  }
  for (const entry of [...requiredShellEntries, ...requiredStarterEntries]) {
    if (!Object.hasOwn(value.bundleEntries, entry)) throw new Error(`bundleEntries 缺少 ${entry}`);
  }
  return value;
}

export function compareBuildManifests(baseline, current) {
  validateBuildManifest(baseline);
  validateBuildManifest(current);
  const differences = [];
  for (const key of ['sourceCommit', 'packageLockSha256', 'buildCommand', 'installCommand', 'noMtime', 'environment', 'roots']) {
    if (JSON.stringify(baseline[key]) !== JSON.stringify(current[key])) differences.push(`${key}: ${JSON.stringify(baseline[key])} !== ${JSON.stringify(current[key])}`);
  }
  const baselineFiles = new Map(baseline.files.map((file) => [file.relativePath, file]));
  const currentFiles = new Map(current.files.map((file) => [file.relativePath, file]));
  for (const relativePath of [...new Set([...baselineFiles.keys(), ...currentFiles.keys()])].sort()) {
    const left = baselineFiles.get(relativePath);
    const right = currentFiles.get(relativePath);
    if (!left || !right) {
      differences.push(`files[${relativePath}]: ${left ? 'present' : 'missing'} !== ${right ? 'present' : 'missing'}`);
      continue;
    }
    for (const key of ['size', 'sha256']) {
      if (left[key] !== right[key]) differences.push(`files[${relativePath}].${key}: ${left[key]} !== ${right[key]}`);
    }
  }
  const baselineEntries = baseline.bundleEntries;
  const currentEntries = current.bundleEntries;
  for (const entry of [...new Set([...Object.keys(baselineEntries), ...Object.keys(currentEntries)])].sort()) {
    if (baselineEntries[entry] !== currentEntries[entry]) differences.push(`bundleEntries.${entry}: ${baselineEntries[entry] ?? 'missing'} !== ${currentEntries[entry] ?? 'missing'}`);
  }
  return { equivalent: differences.length === 0, differences };
}

export function buildEquivalenceArtifact(baselineRoot, currentRoot) {
  const baseline = collectBuildManifest(baselineRoot);
  const current = collectBuildManifest(currentRoot);
  const comparison = compareBuildManifests(baseline, current);
  return {
    schemaVersion: 1,
    artifactKind: 'renderer-build-equivalence',
    generatedAt: new Date().toISOString(),
    baseline,
    current,
    comparison,
    qualified: comparison.equivalent,
  };
}

function parseArgs(argv) {
  const values = new Map();
  const allowed = new Set(['baseline-root', 'current-root', 'out']);
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
  const baselineRoot = path.resolve(values.get('baseline-root') ?? '');
  const currentRoot = path.resolve(values.get('current-root') ?? '');
  const outputPath = path.resolve(values.get('out') ?? path.join(repositoryRoot, 'docs', 'baselines', 'renderer-v4-build-equivalence-2026-08-10.json'));
  if (!values.has('baseline-root') || !values.has('current-root') || !values.has('out')) throw new Error('必须显式提供 --baseline-root、--current-root 和 --out');
  return { baselineRoot, currentRoot, outputPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  try {
    const { baselineRoot, currentRoot, outputPath } = parseArgs(process.argv.slice(2));
    const artifact = buildEquivalenceArtifact(baselineRoot, currentRoot);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(artifact.comparison, null, 2));
    if (!artifact.qualified) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
