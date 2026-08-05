import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Web 试玩包信息（纯函数可测；M7 支柱5） */
export function buildWebTrialInfo(game: string, version: string): Record<string, string> {
  return { engine: 'surdet', game, version, builtAt: new Date().toISOString() };
}

/** 版本补丁清单（纯函数可测）：随发布产物分发，供增量更新/版本公告消费 */
export function buildUpdateManifest(game: string, version: string, notes: string): Record<string, string> {
  return { engine: 'surdet', game, version, generatedAt: new Date().toISOString(), notes };
}

/**
 * surdet build [gameDir] [--web]：在游戏目录运行 vite 构建。
 * --web：构建产物 dist/ 即纯 Web 试玩包，写入 web-trial-info.json 并给出上传指引。
 */
export async function cmdBuild(projectDir: string, opts: { web?: boolean } = {}): Promise<number> {
  if (!fs.existsSync(path.join(projectDir, 'package.json'))) {
    console.error(`不是有效的游戏项目目录：${projectDir}（缺少 package.json）`);
    return 1;
  }
  try {
    execSync('npm run build', { cwd: projectDir, stdio: 'inherit' });
  } catch {
    return 1;
  }
  if (opts.web) {
    const distDir = path.join(projectDir, 'dist');
    if (!fs.existsSync(distDir)) {
      console.error(`构建产物目录不存在：${distDir}`);
      return 1;
    }
    let pkg: { name?: string; version?: string } = {};
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')) as { name?: string; version?: string };
    } catch { /* 信息缺失不阻断 */ }
    const info = buildWebTrialInfo(pkg.name ?? 'game', pkg.version ?? '0.0.0');
    fs.writeFileSync(path.join(distDir, 'web-trial-info.json'), JSON.stringify(info, null, 2) + '\n');
    console.info(`\n— Web 试玩包就绪：${distDir} —`);
    console.info('将该目录整体上传到任意静态托管（itch.io / TapTap 网页 / 官网 / Vercel）即可提供试玩。');
  }
  return 0;
}

/**
 * surdet manifest [gameDir]：生成 release/update-manifest.json（版本号 + 生成时间 + CHANGELOG 摘要）。
 */
export async function cmdManifest(projectDir: string): Promise<number> {
  if (!fs.existsSync(path.join(projectDir, 'package.json'))) {
    console.error(`不是有效的游戏项目目录：${projectDir}（缺少 package.json）`);
    return 1;
  }
  let pkg: { name?: string; version?: string } = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8')) as { name?: string; version?: string };
  } catch (err) {
    console.error(`package.json 解析失败：${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  let notes = '';
  try {
    const changelog = fs.readFileSync(path.join(projectDir, 'CHANGELOG.md'), 'utf8');
    notes = changelog.split(/\r?\n/).slice(0, 10).join('\n').slice(0, 500);
  } catch { /* 无 CHANGELOG 则 notes 为空 */ }
  const manifest = buildUpdateManifest(pkg.name ?? 'game', pkg.version ?? '0.0.0', notes);
  const releaseDir = path.join(projectDir, 'release');
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(path.join(releaseDir, 'update-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.info(`— update-manifest.json 已生成（${pkg.name ?? 'game'} v${pkg.version ?? '0.0.0'}）：${path.join(releaseDir, 'update-manifest.json')} —`);
  return 0;
}
