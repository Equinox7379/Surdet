import fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEMPLATES_ROOT = path.resolve(__dirname, '../templates');

export interface NewProjectOptions {
  /** Explicit project directory; does not register or modify an engine workspace. */
  directory?: string;
  template?: 'example' | 'blank';
  /** Engine workspace override for embedded callers/tests. */
  engineRoot?: string;
  /** Bundled desktop resources; not a command-line or renderer-selected path. */
  templatesRoot?: string;
  /** Display title, independent of the stable package/save identity. */
  title?: string;
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
export function createProject(name: string, options: NewProjectOptions = {}): { directory: string; template: 'example' | 'blank' } {
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Error(`无效的游戏名 '${name}'（仅小写字母/数字/-/_）`);
  }
  const template = options.template ?? 'example';
  if (template !== 'example' && template !== 'blank') {
    throw new Error(`未知模板 '${String(template)}'（example / blank）`);
  }
  if (options.directory !== undefined && options.directory.trim() === '') {
    throw new Error('项目目录不能为空');
  }
  if (options.title !== undefined && (typeof options.title !== 'string' || !options.title.trim() || options.title.length > 200)) throw new Error('作品标题不能为空或超过200字。');
  const root = options.directory === undefined ? (options.engineRoot ?? findEngineRoot(__dirname)) : null;
  const target = options.directory !== undefined
    ? path.resolve(options.directory)
    : root ? path.join(root, 'games', name) : path.resolve(name);
  if (fs.existsSync(target)) {
    throw new Error(`目录已存在：${target}`);
  }
  let staging: string | undefined;
  let published = false;
  try {
    const rootPkgPath = root ? path.join(root, 'package.json') : undefined;
    const initialRootPkg = rootPkgPath
      ? JSON.parse(fs.readFileSync(rootPkgPath, 'utf8')) as { workspaces: string[] }
      : undefined;
    if (initialRootPkg && !Array.isArray(initialRootPkg.workspaces)) throw new Error('引擎根缺少 workspaces 数组');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    staging = fs.mkdtempSync(path.join(path.dirname(target), `.${name}-`));
    const templates = options.templatesRoot ?? DEFAULT_TEMPLATES_ROOT;
    copyDir(path.join(templates, 'game'), staging, template === 'blank');
    if (template === 'blank') copyDir(path.join(templates, 'blank'), staging);
    const pkgPath = path.join(staging, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name: string };
    pkg.name = `surdet-${name}`;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    if (options.title !== undefined) {
      const configPath = path.join(staging, 'game.config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.title = options.title.trim();
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    }
    if (fs.existsSync(target)) throw new Error(`目录已存在：${target}`);
    fs.renameSync(staging, target);
    staging = undefined;
    published = true;
    if (rootPkgPath) {
      // Copying a template can be slow; register against the current workspace,
      // not the package document observed before copying started.
      const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8')) as { workspaces: string[] };
      if (!Array.isArray(rootPkg.workspaces)) throw new Error('引擎根缺少 workspaces 数组');
      if (!rootPkg.workspaces.includes('games/*')) {
        rootPkg.workspaces.push('games/*');
        fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n');
      }
    }
  } catch (error) {
    throw new Error(`${published ? '完整项目已创建，但 workspace 注册失败' : '创建项目失败'}：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    // Only this invocation's unpublished, uniquely named staging directory.
    if (staging !== undefined) fs.rmSync(staging, { recursive: true, force: true });
  }
  return { directory: target, template };
}

/** Existing CLI entry: generation is shared with the desktop, console output stays here. */
export async function cmdNew(name: string, options: NewProjectOptions = {}): Promise<number> {
  let created: ReturnType<typeof createProject>;
  try { created = createProject(name, options); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); return 1; }
  const { directory: target, template } = created;
  console.log(`✔ 已创建游戏项目：${target}`);
  console.log(`  模板：${template}；进入上述项目目录后：`);
  console.log('  1. 安装 README 所列的 Surdet 包和开发依赖（已有依赖无需重装）');
  console.log('  2. npm run dev    开发预览');
  console.log('  3. npm run lint   内容校验');
  console.log('  4. npm run build 构建独立 Web 产物；编辑 content/scenario/ 下的剧本');
  console.log('  AI 创作：先读项目 AGENTS.md；工具接入见 .mcp.json.example（默认隔离草稿）');
  return 0;
}
