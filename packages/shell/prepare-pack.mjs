/**
 * 打包前准备：把目标游戏的构建产物复制到受保护的 .pack-stage/game/（electron-builder 打包进 asar）。
 * 游戏目录必须来自环境变量 SURDET_GAME_DIR；release 模式强制素材 AES-256-GCM 加密。
 * 密钥随包分发（asar 内）：对"解包即得素材"形成实质障碍，但密钥本身可被提取——
 * 定位是防随手盗用的工程手段，非对抗逆向的密码学方案（诚实说明）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildPackMetadata, resolvePackPolicy } from './scripts/pack-policy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let policy;
try {
  policy = resolvePackPolicy(process.env, __dirname);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const { gameDir, stageRoot, mode, encrypted } = policy;

const src = path.join(gameDir, 'dist');
const dest = path.join(stageRoot, 'game');

const markerPath = path.join(stageRoot, '.surdet-staging-root.json');
const marker = { engine: 'surdet', purpose: 'pack-staging' };

if (fs.existsSync(stageRoot)) {
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    existing = null;
  }
  if (existing?.engine !== marker.engine || existing?.purpose !== marker.purpose) {
    throw new Error(`[pack] staging 根缺少合法标记，拒绝清理：${stageRoot}`);
  }
  for (const name of fs.readdirSync(stageRoot)) {
    if (name !== '.surdet-staging-root.json') {
      fs.rmSync(path.join(stageRoot, name), { recursive: true, force: true });
    }
  }
} else {
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n');
}

if (!fs.existsSync(path.join(gameDir, 'package.json'))) {
  console.error(`[pack] 不是有效的游戏项目目录：${gameDir}`);
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error(`[pack] 未找到游戏构建产物 ${src}，请先运行 surdet build`);
  process.exit(1);
}

fs.cpSync(src, dest, { recursive: true });

// 游戏配置（窗口标题等，shell 主进程直接读取，不走渲染层）
const cfgSrc = path.join(gameDir, 'game.config.json');
if (!fs.existsSync(cfgSrc)) throw new Error(`[pack] 未找到游戏配置 ${cfgSrc}`);
const config = JSON.parse(fs.readFileSync(cfgSrc, 'utf8'));
if (typeof config.title !== 'string' || config.title.trim() === '') {
  throw new Error('[pack] game.config.json.title 必须是非空字符串');
}
if (typeof config.entryScene !== 'string' || config.entryScene.trim() === '') {
  throw new Error('[pack] game.config.json.entryScene 必须是非空字符串');
}
fs.copyFileSync(cfgSrc, path.join(dest, 'game.config.json'));

// 发布清单随游戏一起进入包内：壳可在离线环境读取并显示当前版本状态。
const pkg = JSON.parse(fs.readFileSync(path.join(gameDir, 'package.json'), 'utf8'));
if (typeof pkg.name !== 'string' || pkg.name.trim() === '') throw new Error('[pack] package.json.name 必须是非空字符串');
if (typeof pkg.version !== 'string' || pkg.version.trim() === '') throw new Error('[pack] package.json.version 必须是非空字符串');
const manifestSrc = path.join(gameDir, 'release', 'update-manifest.json');
const manifestDest = path.join(dest, 'release', 'update-manifest.json');
fs.mkdirSync(path.dirname(manifestDest), { recursive: true });
if (fs.existsSync(manifestSrc)) {
  fs.copyFileSync(manifestSrc, manifestDest);
} else {
  fs.writeFileSync(manifestDest, JSON.stringify({
    engine: 'surdet',
    game: typeof pkg.name === 'string' ? pkg.name : 'game',
    version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    generatedAt: new Date().toISOString(),
    notes: '',
    channel: 'stable',
  }, null, 2) + '\n');
}

// ===== 素材：复制到 game/content/assets 并 AES-256-GCM 加密（SDAT2 封装） =====
const assetsSrc = path.join(gameDir, 'content', 'assets');
const assetsDest = path.join(dest, 'content', 'assets');
if (fs.existsSync(assetsSrc)) {
  fs.cpSync(assetsSrc, assetsDest, { recursive: true });
  if (!encrypted) {
    console.log('[pack] 素材未混淆（SURDET_ENCRYPT=0）');
  } else {
    const key = crypto.randomBytes(32);
    const files = [];
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else files.push(full);
      }
    };
    walk(assetsDest);
    for (const f of files) {
      const data = fs.readFileSync(f);
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(data), cipher.final()]);
      // 格式：'SDAT2' 魔数 + iv(12) + authTag(16) + 密文（GCM 自带完整性校验，篡改即解密失败）
      fs.writeFileSync(f, Buffer.concat([Buffer.from('SDAT2'), iv, cipher.getAuthTag(), enc]));
    }
    fs.writeFileSync(path.join(dest, '.skey'), key.toString('hex'));
    console.log(`[pack] 已 AES-256-GCM 加密 ${files.length} 个素材文件（密钥写入 game/.skey）`);
  }
} else {
  console.log('[pack] 无 content/assets 目录，跳过素材（游戏使用程序化占位素材）');
}

const listFiles = (dir, base = dir) => {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) files.push(...listFiles(full, base));
    else files.push(path.relative(base, full).replace(/\\/g, '/'));
  }
  return files;
};
const metadata = buildPackMetadata({
  game: pkg.name,
  version: pkg.version,
  title: config.title,
  entryScene: config.entryScene,
  sourceDirName: path.basename(gameDir),
  assetFiles: listFiles(assetsDest),
  mode,
  encrypted,
});
const metadataDest = path.join(dest, 'release', 'pack-metadata.json');
fs.writeFileSync(metadataDest, JSON.stringify(metadata, null, 2) + '\n');

console.log(`[pack] 已复制 ${gameDir}/dist → ${dest}`);
console.log(`[pack] 目标：${metadata.game} ${metadata.version}，入口：${metadata.entryScene}，素材：${metadata.assetFiles.length}，加密：${String(metadata.encrypted)}`);
