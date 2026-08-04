#!/usr/bin/env node
/**
 * surdet CLI：new / lint / build / pack。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintProject } from './lint.js';
import { cmdNew } from './new.js';
import { cmdBuild } from './build.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 版本号从 cli 包 package.json 读取（dist 位于 packages/cli/dist，../package.json 即包清单）；
 *  读取失败回退 unknown，避免发版时忘记同步硬编码版本。 */
function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
const VERSION = readVersion();

const HELP = `Surdet Engine CLI v${VERSION}

用法:
  surdet --version         输出版本
  surdet --help            显示帮助
  surdet new <name>        创建新游戏脚手架（games/<name>）
  surdet lint [dir]        校验游戏内容（剧本语法/结构/引用完整性）
  surdet build [dir]       构建游戏（vite）
  surdet pack              打包 Windows exe（M7）
`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`surdet v${VERSION}\n`);
    return 0;
  }

  const cmd = args[0];

  switch (cmd) {
    case 'new': {
      const name = args[1];
      if (!name) {
        process.stderr.write('用法：surdet new <游戏名>\n');
        return 1;
      }
      return await cmdNew(name);
    }

    case 'lint': {
      const projectDir = path.resolve(args[1] ?? process.cwd());
      const result = lintProject(projectDir);

      const errors = result.issues.filter((i) => i.severity === 'error');
      const warnings = result.issues.filter((i) => i.severity === 'warning');

      for (const issue of result.issues) {
        const badge = issue.severity === 'error' ? '✗' : '⚠';
        process.stdout.write(`${badge} ${issue.text}\n`);
      }

      if (result.sceneCount === 0) {
        process.stdout.write(`未找到剧本（content/scenario 下无 .gal 文件）：${path.join(projectDir, 'content/scenario')}\n`);
        return 1;
      }

      process.stdout.write(
        `—— ${result.sceneCount} 个场景，${errors.length} 个错误，${warnings.length} 个警告 ——\n`,
      );
      return errors.length === 0 ? 0 : 1;
    }

    case 'build': {
      const projectDir = path.resolve(args[1] ?? process.cwd());
      return await cmdBuild(projectDir);
    }

    case 'pack': {
      // 打包指定游戏（缺省 starter）：surdet pack [gameDir]
      const gameDir = args[1] ? path.resolve(args[1]) : '';
      // __dirname = packages/cli/dist → 上溯两级到仓库根的 packages/shell
      const shellDir = path.resolve(__dirname, '../../shell');
      try {
        const { execSync } = await import('node:child_process');
        execSync('npm run pack', {
          cwd: shellDir,
          stdio: 'inherit',
          env: { ...process.env, SURDET_GAME_DIR: gameDir },
        });
        return 0;
      } catch {
        return 1;
      }
    }

    default:
      process.stderr.write(`surdet: 未知命令 '${cmd}'（用 --help 查看用法）\n`);
      return 1;
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    process.stderr.write(`surdet: 内部错误：${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
