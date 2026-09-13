import { spawnSync } from 'node:child_process';
import process from 'node:process';

const mode = process.argv[2];
if (!['--tracked', '--staged'].includes(mode) || process.argv.length !== 3) {
  console.error('用法：node scripts/check-repo-hygiene.mjs --tracked|--staged');
  process.exitCode = 2;
} else {
  const args = mode === '--tracked'
    ? ['ls-files', '-z']
    : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'];
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error) {
    console.error(`无法读取 Git 路径：${result.error.message}`);
    process.exitCode = 1;
  } else if (result.status !== 0) {
    console.error((result.stderr || '').trim() || `git ${args.join(' ')} 执行失败`);
    process.exitCode = 1;
  } else {
    const forbidden = [
      /(^|\/)\.vite\//,
      /(^|\/)(\.opensquilla|\.superpowers|memory)\//,
      /(^|\/).*\.log$/i,
      /^shot.*\.(png|mjs)$/i,
      /^(main\.js|preload\.js)$/i,
    ];
    const paths = result.stdout.split('\0').filter(Boolean);
    const rejected = paths.filter((value) => forbidden.some((pattern) => pattern.test(value)));
    if (rejected.length > 0) {
      console.error(`仓库卫生检查失败（${mode}）：发现禁止路径`);
      for (const value of rejected) console.error(`- ${value}`);
      process.exitCode = 1;
    } else {
      console.log(`仓库卫生检查通过（${mode}）：${paths.length} 个路径`);
    }
  }
}
