import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '../templates/game');

/** 从 cli 位置向上查找引擎根（含 workspaces 字段的 package.json 所在目录） */
function findEngineRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown };
        if (Array.isArray(raw.workspaces)) return dir;
      } catch {
        // 继续向上
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

function copyDir(from: string, to: string): void {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

/**
 * surdet new <name>：在引擎仓库 games/ 下创建游戏脚手架并注册 workspace。
 * engineRoot 用于测试注入（默认从 cli 位置向上查找）。
 */
export async function cmdNew(name: string, engineRoot?: string): Promise<number> {
  if (!/^[a-z0-9_-]+$/.test(name)) {
    console.error(`无效的游戏名 '${name}'（仅小写字母/数字/-/_）`);
    return 1;
  }
  const root = engineRoot ?? findEngineRoot(__dirname);
  if (!root) {
    console.error('未找到引擎根目录（须在 Surdet 仓库内运行）');
    return 1;
  }
  const target = path.join(root, 'games', name);
  if (fs.existsSync(target)) {
    console.error(`目录已存在：${target}`);
    return 1;
  }
  fs.mkdirSync(target, { recursive: true });
  copyDir(TEMPLATE_DIR, target);

  // 改写包名
  const pkgPath = path.join(target, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name: string };
  pkg.name = `surdet-${name}`;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  // 注册 workspace（games/*）
  const rootPkgPath = path.join(root, 'package.json');
  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8')) as { workspaces: string[] };
  if (!rootPkg.workspaces.includes('games/*')) {
    rootPkg.workspaces.push('games/*');
    fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
  }

  console.log(`✔ 已创建游戏项目：${target}`);
  console.log('  接下来：');
  console.log('  1. npm install');
  console.log(`  2. npm run dev -w surdet-${name}    开发预览`);
  console.log(`  3. npm run lint -w surdet-${name}   内容校验`);
  console.log('  4. 编辑 content/scenario/ 下的剧本即可制作游戏');
  return 0;
}
