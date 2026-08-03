/**
 * 打包前准备：把目标游戏的构建产物复制到 shell/game/（electron-builder 打包进 asar）。
 * 游戏目录来自环境变量 SURDET_GAME_DIR（surdet pack [gameDir] 传入），缺省用 starter。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
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
console.log(`[pack] 已复制 ${gameDir}/dist → ${dest}`);
