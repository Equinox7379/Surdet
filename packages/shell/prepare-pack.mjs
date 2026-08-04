/**
 * 打包前准备：把目标游戏的构建产物复制到 shell/game/（electron-builder 打包进 asar）。
 * 游戏目录来自环境变量 SURDET_GAME_DIR（surdet pack [gameDir] 传入），缺省用 starter。
 * 素材（content/assets）默认做 AES-256-GCM 加密并写密钥到 game/.skey（SURDET_ENCRYPT=0 可关闭）。
 * 密钥随包分发（asar 内）：对"解包即得素材"形成实质障碍，但密钥本身可被提取——
 * 定位是防随手盗用的工程手段，非对抗逆向的密码学方案（诚实说明）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envGame = process.env.SURDET_GAME_DIR;
const gameDir = envGame && envGame.trim() !== ''
  ? path.resolve(envGame)
  : path.resolve(__dirname, '../../examples/starter');

const src = path.join(gameDir, 'dist');
const dest = path.join(__dirname, 'game');

if (!fs.existsSync(path.join(gameDir, 'package.json'))) {
  console.error(`[pack] 不是有效的游戏项目目录：${gameDir}`);
  process.exit(1);
}
if (!fs.existsSync(src)) {
  console.error(`[pack] 未找到游戏构建产物 ${src}，请先运行 surdet build`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

// 游戏配置（窗口标题等，shell 主进程直接读取，不走渲染层）
const cfgSrc = path.join(gameDir, 'game.config.json');
if (fs.existsSync(cfgSrc)) fs.copyFileSync(cfgSrc, path.join(dest, 'game.config.json'));

// ===== 素材：复制到 game/content/assets 并 AES-256-GCM 加密（SDAT2 封装） =====
const assetsSrc = path.join(gameDir, 'content', 'assets');
const assetsDest = path.join(dest, 'content', 'assets');
if (fs.existsSync(assetsSrc)) {
  fs.cpSync(assetsSrc, assetsDest, { recursive: true });
  if (process.env.SURDET_ENCRYPT === '0') {
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

console.log(`[pack] 已复制 ${gameDir}/dist → ${dest}`);
