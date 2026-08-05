#!/usr/bin/env node
/**
 * surdet CLI：new / lint / build / pack / audit / simulate。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintProject } from './lint.js';
import { cmdNew } from './new.js';
import { cmdBuild } from './build.js';
import { cmdAudit } from './audit.js';
import { cmdSimulate } from './simulate.js';

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

/** 参数值识别：--assume k=v 的值位置不可能是项目目录（防止误当作位置参数） */
function isFlagValue(args: string[], a: string): boolean {
  const i = args.indexOf(a);
  return i > 0 && (args[i - 1] === '--assume' || args[i - 1] === '--max-paths' || args[i - 1] === '--max-steps');
}

const HELP = `Surdet Engine CLI v${VERSION}

用法:
  surdet --version         输出版本
  surdet --help            显示帮助
  surdet new <name>        创建新游戏脚手架（games/<name>）
  surdet lint [dir]        校验游戏内容（剧本语法/结构/引用完整性）
      --json               输出机器可读 JSON（含每条问题的 hint 修复建议，AI 自我修正循环用）
  surdet audit [dir]       AI 生产线验收：内容审计（称谓/名词表/空心分支/节奏）+ 无头试跑
      --no-run             只做内容审计，跳过无头试跑
  surdet simulate [dir]    无头自动模拟：全分支遍历 + 结局可达性 + 死路检测 + 存档往返冒烟
      --max-paths N        路径预算（缺省 500）
      --max-steps N        单路径步数上限（缺省 20000）
      --assume k=v         开局变量注入（可重复，如 --assume battleWon=true）
      --json               输出机器可读 JSON 报告
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

    case 'audit': {
      const rest = args.slice(1).filter((a) => !a.startsWith('--'));
      const projectDir = path.resolve(rest[0] ?? process.cwd());
      return await cmdAudit(projectDir, { noRun: args.includes('--no-run') });
    }

    case 'simulate': {
      const rest = args.slice(1).filter((a) => !a.startsWith('--') && !isFlagValue(args, a));
      const projectDir = path.resolve(rest[0] ?? process.cwd());
      return await cmdSimulate(projectDir, args.slice(1));
    }

    case 'lint': {
      const jsonOut = args.includes('--json');
      const rest = args.slice(1).filter((a) => a !== '--json');
      const projectDir = path.resolve(rest[0] ?? process.cwd());
      const result = lintProject(projectDir);

      if (jsonOut) {
        // 机器可读输出（M5 支柱1）：结构稳定 { ok, sceneCount, issues[{severity,code,text,hint,file,line,col}] }
        process.stdout.write(JSON.stringify({ ok: result.ok, sceneCount: result.sceneCount, issues: result.issues }, null, 2) + '\n');
        return result.issues.some((i) => i.severity === 'error') ? 1 : 0;
      }

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
