#!/usr/bin/env node
/**
 * surdet CLI：new / lint / stats / build / pack / audit / simulate。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintProject } from './lint.js';
import { cmdNew } from './new.js';
import { cmdBuild, cmdManifest } from './build.js';
import { cmdAudit } from './audit.js';
import { cmdSimulate } from './simulate.js';
import { cmdPack } from './pack.js';
import { statsCommand } from './stats.js';
import { authoringCommand } from './authoring-command.js';
import { AUTHORING_CAPABILITY_REGISTRY } from '@surdet/authoring';

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

function projectArguments(command: string, args: string[]): { positional: string[]; options: Map<string, string> } {
  const flags: Record<string, string[]> = { new: ['--directory', '--template'], lint: ['--json'], stats: ['--json'], audit: ['--no-run'],
    build: ['--web'], manifest: [], pack: ['--output', '--title', '--version', '--icon', '--trust-plugins', '--runtime'], simulate: ['--json', '--assume', '--seed', '--max-paths', '--max-steps'] };
  const values = new Set(['--assume', '--seed', '--max-paths', '--max-steps', '--directory', '--template', '--output', '--title', '--version', '--icon', '--trust-plugins', '--runtime']);
  const options = new Map<string, string>();
  const positional: string[] = [];
  let literal = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!literal && argument === '--') { literal = true; continue; }
    if (!literal && argument.startsWith('-')) {
      if (!flags[command]?.includes(argument)) throw new Error(`${command} 不支持参数 ${argument}`);
      if (values.has(argument)) {
        const value = args[++index];
        if (value === undefined || value.startsWith('--')) throw new Error(`${argument} 缺少参数值`);
        if (command === 'new' && options.has(argument)) throw new Error(`${argument} 不能重复指定`);
        options.set(argument, value);
      }
    } else positional.push(argument);
  }
  if (positional.length > 1 || positional.some(value => value.trim() === '')) throw new Error(`${command} 需要一个有效的项目目录或名称`);
  return { positional, options };
}

const HELP = `Surdet Engine CLI v${VERSION}

用法:
  surdet --version         输出版本
  surdet --help            显示帮助
  surdet new <name>        创建新游戏（源码仓库默认 games/<name>，独立 CLI 默认当前目录/<name>）
      --directory <dir>    指定独立项目目录，不修改引擎 workspace
      --template <type>    example（默认）或 blank（空白）
  surdet lint [dir]        校验游戏内容（剧本语法/结构/引用完整性）
      --json               输出机器可读 JSON（含每条问题的 hint 修复建议，AI 自我修正循环用）
  surdet stats [dir]       输出项目文本/分支/结局/可达性/素材统计
      --json               只输出有效 JSON
  surdet audit [dir]       AI 生产线验收：内容审计（称谓/名词表/空心分支/节奏）+ 无头试跑
      --no-run             只做内容审计，跳过无头试跑
  surdet simulate [dir]    无头自动模拟：全分支遍历 + 结局可达性 + 死路检测 + 存档往返冒烟
      --max-paths N        路径预算（缺省 500）
      --max-steps N        单路径步数上限（缺省 20000）
      --seed N              evidence 随机 seed（缺省 1592639710）
      --assume k=v         开局变量注入（可重复，如 --assume battleWon=true）
      --json               输出机器可读 JSON 报告
  surdet build [dir]       构建游戏（vite）
      --web               同时产出 Web 试玩包信息（dist/ 可直接上传静态托管）
  surdet manifest [dir]    生成版本补丁清单 release/update-manifest.json
  surdet pack <dir>        使用预制运行时导出Windows免安装文件夹（无需先构建作品）
      --output <dir>       新输出文件夹，不覆盖已有目录
      --title <title>      显示标题，不改变项目的存档身份
      --version <version>  Windows数字版本；缺省使用package.json.version
      --icon <path>        项目content/assets内的PNG或ICO
      --trust-plugins <ids> 明确信任的插件id，以逗号分隔
      --runtime <exe>      提供含game-runtime的Editor运行文件；源码开发使用预构建Shell运行时
  surdet capabilities describe --json
  surdet project|object|change|scene|script|variable|character|timeline|gallery|runtime|composition|review|asset ... --json
      --input <file|->      按 capabilities describe 返回的 schema 传入完整 JSON
      --asset-source <dir>  本次 CLI 调用授权读取的绝对素材目录（可重复）
      --asset-import-data-root <dir>  与 Editor/MCP 共用的素材操作数据目录
      原生 authoring 命令按本机操作者的 apply 权限执行；MCP 权限由启动 policy 限制。
`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args[0] === '--version' || args[0] === '-v') {
    process.stdout.write(`surdet v${VERSION}\n`);
    return 0;
  }

  const cmd = args[0];

  if (cmd !== undefined && AUTHORING_CAPABILITY_REGISTRY.some(capability => capability.id.split('.')[0] === cmd)) {
    return await authoringCommand(args);
  }
  const { positional, options } = projectArguments(cmd ?? '', args.slice(1));

  switch (cmd) {
    case 'new': {
      const name = positional[0];
      if (!name) {
        process.stderr.write('用法：surdet new <游戏名>\n');
        return 1;
      }
      const template = options.get('--template');
      if (template !== undefined && template !== 'example' && template !== 'blank') {
        throw new Error(`未知模板 '${template}'（example / blank）`);
      }
      return await cmdNew(name, { directory: options.get('--directory'), template });
    }

    case 'audit': {
      const projectDir = path.resolve(positional[0] ?? process.cwd());
      return await cmdAudit(projectDir, { noRun: args.includes('--no-run') });
    }

    case 'simulate': {
      const projectDir = path.resolve(positional[0] ?? process.cwd());
      return await cmdSimulate(projectDir, args.slice(1));
    }

    case 'lint': {
      const jsonOut = args.includes('--json');
      const projectDir = path.resolve(positional[0] ?? process.cwd());
      const result = lintProject(projectDir);

      if (jsonOut) {
        // 机器可读输出（M5 支柱1）：结构稳定 { ok, sceneCount, issues[{severity,code,text,hint,file,line,col}] }
        process.stdout.write(JSON.stringify({ ok: result.ok, sceneCount: result.sceneCount, issues: result.issues }, null, 2) + '\n');
        return result.ok ? 0 : 1;
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

    case 'stats': {
      const jsonOut = args.includes('--json');
      return await statsCommand(path.resolve(positional[0] ?? process.cwd()), { json: jsonOut });
    }

    case 'build': {
      const webOut = args.includes('--web');
      const projectDir = path.resolve(positional[0] ?? process.cwd());
      return await cmdBuild(projectDir, { web: webOut });
    }

    case 'manifest': {
      const projectDir = path.resolve(positional[0] ?? process.cwd());
      return await cmdManifest(projectDir);
    }

    case 'pack': {
      return await cmdPack(positional[0], undefined, options);
    }

    default:
      process.stderr.write(`surdet: 未知命令 '${cmd}'（用 --help 查看用法）\n`);
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`surdet: 内部错误：${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
