/**
 * 发行完整性校验：把“构建成功”和“产物可启动”分成两个可诊断的门槛。
 * 该脚本只读检查，不修改 release 目录。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile, listPackage } from '@electron/asar';

const shellDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(shellDir, '..');
const repoDir = path.resolve(packageDir, '../..');
const releaseDir = path.join(packageDir, 'release');
const unpackedDir = path.join(releaseDir, 'win-unpacked');
const asarPath = path.join(unpackedDir, 'resources', 'app.asar');
const stageRoot = path.join(packageDir, '.pack-stage');
const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));

const requiredFiles = [
  'dist/main.js',
  'dist/preload.cjs',
  'game/index.html',
  'game/game.config.json',
  'game/release/update-manifest.json',
  'game/release/pack-metadata.json',
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

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, base));
    else files.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return files;
}

function parseJsonBuffer(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    fail(`${label} JSON 无效：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function readJsonFile(filePath, label) {
  try {
    return parseJsonBuffer(fs.readFileSync(filePath), label);
  } catch (error) {
    fail(`${label} 无法读取：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function readAsarJson(asarPathValue, entry, label) {
  try {
    // @electron/asar resolves archive paths with the host separator on Windows;
    // normalize the slash-based logical path before extraction.
    return parseJsonBuffer(extractFile(asarPathValue, path.normalize(entry)), label);
  } catch (error) {
    fail(`${label} 无法从 app.asar 读取：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function verifyIdentity(metadata, config, manifest, { requireRelease = false } = {}) {
  if (metadata?.engine !== 'surdet') fail('pack metadata.engine 必须为 surdet');
  if (typeof metadata?.game !== 'string' || metadata.game !== manifest?.game) {
    fail('metadata 与 manifest 游戏 ID 不一致');
  }
  if (typeof metadata?.version !== 'string' || metadata.version !== manifest?.version) {
    fail('metadata 与 manifest 版本不一致');
  }
  if (metadata?.entryScene !== config?.entryScene) fail('metadata 与配置入口场景不一致');
  if (metadata?.title !== config?.title) fail('metadata 与配置标题不一致');
  if (metadata?.mode !== 'release' && metadata?.mode !== 'development') {
    fail('pack metadata.mode 必须为 release 或 development');
  }
  if (typeof metadata?.encrypted !== 'boolean') fail('pack metadata.encrypted 必须为 boolean');
  if (metadata?.mode === 'release' && metadata.encrypted !== true) {
    fail('release 包必须启用素材加密');
  }
  if (requireRelease && (metadata?.mode !== 'release' || metadata?.encrypted !== true)) {
    fail('正式 artifact 必须是 mode=release 且 encrypted=true');
  }
  const expectedGame = process.env.SURDET_EXPECTED_GAME;
  const expectedEntry = process.env.SURDET_EXPECTED_ENTRY;
  if (expectedGame && metadata?.game !== expectedGame) fail(`游戏 ID 不匹配：期望 ${expectedGame}`);
  if (expectedEntry && metadata?.entryScene !== expectedEntry) fail(`入口不匹配：期望 ${expectedEntry}`);
}

function normalizedAssetFiles(metadata) {
  if (!Array.isArray(metadata?.assetFiles) || !metadata.assetFiles.every((file) => typeof file === 'string')) {
    fail('pack metadata.assetFiles 必须是字符串数组');
    return [];
  }
  const unique = new Set(metadata.assetFiles);
  if (unique.size !== metadata.assetFiles.length) fail('pack metadata.assetFiles 不得包含重复路径');
  if (metadata.assetFiles.some((file) => file.length === 0 || path.posix.isAbsolute(file) || file.split('/').includes('..'))) {
    fail('pack metadata.assetFiles 含非法相对路径');
  }
  return [...unique];
}

function verifyStagedAssets(root, metadata) {
  const assetDir = path.join(root, 'game', 'content', 'assets');
  const actual = new Set(listFiles(assetDir));
  const declared = new Set(normalizedAssetFiles(metadata));
  const missing = [...declared].filter((file) => !actual.has(file));
  const extra = [...actual].filter((file) => !declared.has(file));
  if (missing.length > 0) fail(`staging 缺少 metadata 声明的素材：${missing.slice(0, 5).join(', ')}`);
  if (extra.length > 0) fail(`staging 存在未列入 metadata 的素材：${extra.slice(0, 5).join(', ')}`);
  if (metadata.encrypted === true && declared.size > 0) {
    if (!fs.existsSync(path.join(root, 'game', '.skey'))) fail('加密 staging 缺少素材解密密钥 game/.skey');
    for (const file of declared) {
      const bytes = fs.readFileSync(path.join(assetDir, ...file.split('/')));
      if (bytes.subarray(0, 5).toString() !== 'SDAT2') fail(`素材未使用 SDAT2 加密：${file}`);
    }
  }
}

function verifyArtifactAssets(asarPathValue, metadata, entries) {
  const declared = new Set(normalizedAssetFiles(metadata));
  for (const file of declared) {
    const entry = `game/content/assets/${file}`;
    if (!entries.has(entry)) fail(`app.asar 缺少 metadata 声明的素材：${entry}`);
    if (metadata.encrypted === true) {
      try {
        if (extractFile(asarPathValue, path.normalize(entry)).subarray(0, 5).toString() !== 'SDAT2') {
          fail(`app.asar 中素材未使用 SDAT2 加密：${entry}`);
        }
      } catch (error) {
        fail(`无法读取 app.asar 素材 ${entry}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (metadata.encrypted === true && declared.size > 0 && !entries.has('game/.skey')) {
    fail('app.asar 缺少素材解密密钥 game/.skey');
  }
}

function checkPreflight() {
  console.log('[pack-check] preflight: 检查待打包文件');
  const files = [
    ['dist/main.js', path.join(packageDir, 'dist', 'main.js')],
    ['dist/preload.cjs', path.join(packageDir, 'dist', 'preload.cjs')],
    ['game/index.html', path.join(stageRoot, 'game', 'index.html')],
    ['game/game.config.json', path.join(stageRoot, 'game', 'game.config.json')],
    ['game/release/update-manifest.json', path.join(stageRoot, 'game', 'release', 'update-manifest.json')],
    ['game/release/pack-metadata.json', path.join(stageRoot, 'game', 'release', 'pack-metadata.json')],
    ['node_modules/@surdet/core/package.json', path.join(repoDir, 'node_modules', '@surdet', 'core', 'package.json')],
    ['node_modules/@surdet/core/dist/index.js', path.join(repoDir, 'node_modules', '@surdet', 'core', 'dist', 'index.js')],
  ];
  for (const [label, filePath] of files) checkFile(filePath, label);
  const metadata = readJsonFile(path.join(stageRoot, 'game', 'release', 'pack-metadata.json'), 'pack metadata');
  const config = readJsonFile(path.join(stageRoot, 'game', 'game.config.json'), 'game config');
  const manifest = readJsonFile(path.join(stageRoot, 'game', 'release', 'update-manifest.json'), 'update manifest');
  if (metadata && config && manifest) {
    verifyIdentity(metadata, config, manifest);
    verifyStagedAssets(stageRoot, metadata);
  }
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
  const metadata = readAsarJson(asarPath, 'game/release/pack-metadata.json', 'pack metadata');
  const config = readAsarJson(asarPath, 'game/game.config.json', 'game config');
  const manifest = readAsarJson(asarPath, 'game/release/update-manifest.json', 'update manifest');
  if (metadata && config && manifest) {
    verifyIdentity(metadata, config, manifest, { requireRelease: true });
    verifyArtifactAssets(asarPath, metadata, entries);
  }
  if (process.exitCode !== 1) console.log(`[pack-check] PASS: app.asar 包含 ${requiredFiles.length} 项关键文件，身份与素材校验通过`);
}

const mode = process.argv[2];
if (mode === '--preflight') checkPreflight();
else if (mode === '--artifact') checkArtifact();
else {
  console.error('用法：node scripts/verify-pack.mjs --preflight|--artifact');
  process.exitCode = 2;
}
