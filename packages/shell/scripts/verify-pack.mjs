/**
 * 发行完整性校验：把“构建成功”和“产物可启动”分成两个可诊断的门槛。
 * 该脚本只读检查，不修改 release 目录。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackage } from '@electron/asar';

const shellDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(shellDir, '..');
const repoDir = path.resolve(packageDir, '../..');
const releaseDir = path.join(packageDir, 'release');
const unpackedDir = path.join(releaseDir, 'win-unpacked');
const asarPath = path.join(unpackedDir, 'resources', 'app.asar');
const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

const requiredFiles = [
  'dist/main.js',
  'dist/preload.cjs',
  'game/index.html',
  'game/game.config.json',
  'node_modules/@surdet/core/package.json',
  'node_modules/@surdet/core/dist/index.js',
];

function fail(message) {
  console.error(`[pack-check] FAIL: ${message}`);
  process.exitCode = 1;
}

function checkFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`${label} 不存在：${filePath}`);
    return false;
  }
  return true;
}

function checkPreflight() {
  console.log('[pack-check] preflight: 检查待打包文件');
  const files = [
    ['dist/main.js', path.join(packageDir, 'dist', 'main.js')],
    ['dist/preload.cjs', path.join(packageDir, 'dist', 'preload.cjs')],
    ['game/index.html', path.join(packageDir, 'game', 'index.html')],
    ['game/game.config.json', path.join(packageDir, 'game', 'game.config.json')],
    ['node_modules/@surdet/core/package.json', path.join(repoDir, 'node_modules', '@surdet', 'core', 'package.json')],
    ['node_modules/@surdet/core/dist/index.js', path.join(repoDir, 'node_modules', '@surdet', 'core', 'dist', 'index.js')],
  ];
  for (const [label, filePath] of files) checkFile(filePath, label);
}

function checkArtifact() {
  console.log('[pack-check] artifact: 检查 Electron 发行产物');
  const version = typeof packageJson.version === 'string' ? packageJson.version : '';
  const portable = path.join(releaseDir, `SurdetGame-${version}.exe`);
  const installer = path.join(releaseDir, `SurdetGame-Setup-${version}.exe`);
  checkFile(portable, 'portable exe');
  checkFile(installer, 'NSIS 安装器');
  if (!checkFile(asarPath, 'app.asar')) return;

  let entries;
  try {
    entries = new Set(listPackage(asarPath).map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '')));
  } catch (error) {
    fail(`无法读取 app.asar：${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  for (const file of requiredFiles) {
    if (!entries.has(file)) fail(`app.asar 缺少 ${file}`);
  }
  if (process.exitCode !== 1) console.log(`[pack-check] PASS: app.asar 包含 ${requiredFiles.length} 项关键文件`);
}

const mode = process.argv[2];
if (mode === '--preflight') checkPreflight();
else if (mode === '--artifact') checkArtifact();
else {
  console.error('用法：node scripts/verify-pack.mjs --preflight|--artifact');
  process.exitCode = 2;
}
