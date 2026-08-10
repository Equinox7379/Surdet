import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as url from 'node:url';

const scriptPath = url.fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '../../..');
const sourceRelativePath = 'examples/starter/src/main.ts';

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function git(workspaceRoot, args) {
  return execFileSync('git', args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    shell: false,
  });
}

function transformSource(source) {
  if (source.includes('__surdetMenuDiagnosticMeasure')) {
    throw new Error('统一菜单诊断探针已经存在，拒绝重复插桩');
  }
  const normalized = source.replace(/\r\n/g, '\n');
  const titleStart = normalized.indexOf('async function titleSelect');
  const titleEnd = normalized.indexOf('\n  if (import.meta.hot', titleStart);
  if (titleStart < 0 || titleEnd < 0) {
    throw new Error('找不到 titleSelect 插桩锚点');
  }
  const titleBlock = normalized.slice(titleStart, titleEnd);
  const titleCase = titleBlock.match(/(\n\s*case 'settings':\n\s*settingsOpen = true;\n)\s*refreshSettingsPanel\(\);\n(\s*break;)/);
  if (!titleCase) {
    throw new Error('找不到标题设置分支插桩锚点');
  }
  const replacedTitleBlock = titleBlock.replace(
    titleCase[0],
    titleCase[1] + '        __surdetMenuDiagnosticMeasure();\n' + titleCase[2],
  );
  let transformed = normalized.slice(0, titleStart) + replacedTitleBlock + normalized.slice(titleEnd);

  const helperAnchor = '  function refreshSettingsPanel(): void {';
  const helperIndex = transformed.indexOf(helperAnchor);
  if (helperIndex < 0) {
    throw new Error('找不到 refreshSettingsPanel 插桩锚点');
  }
  const helper = [
    '  function __surdetMenuDiagnosticMeasure(): void {',
    '    const __surdetMenuStartedAt = performance.now();',
    '    refreshSettingsPanel();',
    '    const __surdetMenuEndedAt = performance.now();',
    '    const __surdetMenuDebug = (window as unknown as { __surdetDebug?: Record<string, unknown> }).__surdetDebug;',
    '    if (__surdetMenuDebug) {',
    '      __surdetMenuDebug.menuDiagnostic = Object.freeze({',
    '        projectionCommitMs: __surdetMenuEndedAt - __surdetMenuStartedAt,',
    '      });',
    '    }',
    '  }',
    '',
  ].join('\n');
  transformed = transformed.slice(0, helperIndex) + helper + transformed.slice(helperIndex);
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
  return transformed.replace(/\n/g, lineEnding);
}

export function applyMenuDiagnosticInstrumentation(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const sourcePath = path.join(root, sourceRelativePath);
  if (!fs.existsSync(sourcePath)) throw new Error('插桩源文件不存在：' + sourcePath);

  const beforeStatus = git(root, ['status', '--porcelain', '--untracked-files=all']).trim();
  if (beforeStatus !== '') {
    throw new Error('插桩要求干净 checkout，当前状态为：\n' + beforeStatus);
  }
  const originalCommit = git(root, ['rev-parse', 'HEAD']).trim();
  const source = fs.readFileSync(sourcePath, 'utf8');
  const transformed = transformSource(source);
  fs.writeFileSync(sourcePath, transformed, 'utf8');

  let diffCheck = true;
  try {
    git(root, ['diff', '--check']);
  } catch (error) {
    diffCheck = false;
    throw error;
  }
  const sourceDiff = git(root, ['diff', '--binary', '--', sourceRelativePath]);
  const fullDiff = git(root, ['diff', '--binary']);
  const changedPaths = git(root, ['diff', '--name-only'])
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const afterStatus = git(root, ['status', '--porcelain', '--untracked-files=all'])
    .split(/\r?\n/)
    .map((value) => value.trimEnd())
    .filter(Boolean);
  if (changedPaths.length !== 1 || changedPaths[0] !== sourceRelativePath) {
    throw new Error('统一探针之外存在 tracked 源码差异：' + JSON.stringify(changedPaths));
  }
  if (fullDiff !== sourceDiff) {
    throw new Error('完整 diff 与统一探针 diff 不一致');
  }
  if (afterStatus.length !== 1 || !afterStatus[0].endsWith(sourceRelativePath)) {
    throw new Error('插桩后工作树存在统一探针之外的差异：' + JSON.stringify(afterStatus));
  }

  return {
    originalCommit,
    instrumentationScriptPath: path.relative(repositoryRoot, scriptPath).replace(/\\/g, '/'),
    instrumentationScriptSha256: sha256File(scriptPath),
    appliedDiffCheck: diffCheck,
    instrumentedPaths: changedPaths,
    instrumentationDiffSha256: sha256Bytes(Buffer.from(sourceDiff, 'utf8')),
    fullDiffSha256: sha256Bytes(Buffer.from(fullDiff, 'utf8')),
    onlyUnifiedInstrumentationDiff: true,
    beforeStatus,
    afterStatus,
    lockfileSha256: sha256File(path.join(root, 'package-lock.json')),
    node: process.version,
    platform: os.platform(),
    arch: process.arch,
  };
}

function parseArgs(argv) {
  let root = null;
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== '--root' && argument !== '--out') throw new Error('未知参数：' + argument);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('参数缺少值：' + argument);
    if (argument === '--root') {
      if (root !== null) throw new Error('参数只能出现一次：--root');
      root = value;
    } else {
      if (out !== null) throw new Error('参数只能出现一次：--out');
      out = value;
    }
    index += 1;
  }
  if (root === null) throw new Error('缺少必需参数：--root <workspace>');
  return { root, out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(scriptPath)) {
  try {
    const { root, out } = parseArgs(process.argv.slice(2));
    const result = applyMenuDiagnosticInstrumentation(root);
    if (out) {
      const outputPath = path.resolve(out);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
