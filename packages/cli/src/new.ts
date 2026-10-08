import fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '../templates/game');
const BLANK_TEMPLATE_DIR = path.resolve(__dirname, '../templates/blank');

export interface NewProjectOptions {
  /** Explicit project directory; does not register or modify an engine workspace. */
  directory?: string;
  template?: 'example' | 'blank';
  /** Engine workspace override for embedded callers/tests. */
  engineRoot?: string;
}

/** Preserve the source repository default without adopting an unrelated npm workspace. */
function findEngineRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: unknown; workspaces?: unknown };
        if (raw.name === 'surdet' && Array.isArray(raw.workspaces)) return dir;
      } catch {
        // 继续向上
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

function copyDir(from: string, to: string, skipContent = false): void {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skipContent && entry.name === 'content') continue;
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
 * New projects consume the packaged shared Player, never repository-relative code.
 * Explicit directories are independent; the existing repository default stays games/.
 */
export async function cmdNew(name: string, options: NewProjectOptions = {}): Promise<number> {
  if (!/^[a-z0-9_-]+$/.test(name)) {
    console.error(`无效的游戏名 '${name}'（仅小写字母/数字/-/_）`);
    return 1;
  }
  const template = options.template ?? 'example';
  if (template !== 'example' && template !== 'blank') {
    console.error(`未知模板 '${String(template)}'（example / blank）`);
    return 1;
  }
  if (options.directory !== undefined && options.directory.trim() === '') {
    console.error('项目目录不能为空');
    return 1;
  }
  const root = options.directory === undefined ? (options.engineRoot ?? findEngineRoot(__dirname)) : null;
  const target = options.directory !== undefined
    ? path.resolve(options.directory)
    : root ? path.join(root, 'games', name) : path.resolve(name);
  if (fs.existsSync(target)) {
    console.error(`目录已存在：${target}`);
    return 1;
  }
  let staging: string | undefined;
  let published = false;
  try {
    const rootPkgPath = root ? path.join(root, 'package.json') : undefined;
    const rootPkg = rootPkgPath
      ? JSON.parse(fs.readFileSync(rootPkgPath, 'utf8')) as { workspaces: string[] }
      : undefined;
    if (rootPkg && !Array.isArray(rootPkg.workspaces)) throw new Error('引擎根缺少 workspaces 数组');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    staging = fs.mkdtempSync(path.join(path.dirname(target), `.${name}-`));
    copyDir(TEMPLATE_DIR, staging, template === 'blank');
    if (template === 'blank') copyDir(BLANK_TEMPLATE_DIR, staging);
    const pkgPath = path.join(staging, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name: string };
    pkg.name = `surdet-${name}`;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    if (fs.existsSync(target)) throw new Error(`目录已存在：${target}`);
    fs.renameSync(staging, target);
    staging = undefined;
    published = true;
    if (rootPkg && rootPkgPath && !rootPkg.workspaces.includes('games/*')) {
      rootPkg.workspaces.push('games/*');
      fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
    }
  } catch (error) {
    console.error(`${published ? '完整项目已创建，但 workspace 注册失败' : '创建项目失败'}：${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    // Only this invocation's unpublished, uniquely named staging directory.
    if (staging !== undefined) fs.rmSync(staging, { recursive: true, force: true });
  }

  console.log(`✔ 已创建游戏项目：${target}`);
  console.log(`  模板：${template}；进入上述项目目录后：`);
  console.log('  1. 安装 README 所列的 Surdet 包和开发依赖（已有依赖无需重装）');
  console.log('  2. npm run dev    开发预览');
  console.log('  3. npm run lint   内容校验');
  console.log('  4. npm run build 构建独立 Web 产物；编辑 content/scenario/ 下的剧本');
  console.log('  AI 创作：先读项目 AGENTS.md；工具接入见 .mcp.json.example（默认隔离草稿）');
  return 0;
}
