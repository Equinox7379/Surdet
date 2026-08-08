/** P1/P2 引擎发布门禁：不修改项目，只执行类型、单测、正式样例和产物检查。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function run(command, args) {
  console.log(`[verify] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const required = [
  'packages/renderer/src/performance.ts',
  'packages/renderer/src/quality.ts',
  'packages/renderer/src/presentation.ts',
  'packages/renderer/src/plugin-host.ts',
  'packages/renderer/src/post-process.ts',
  'packages/editor/src/preview-diagnostics.ts',
  'packages/shell/src/release-service.ts',
  'packages/shell/src/crash-reporter.ts',
];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`[verify] 缺少 ${file}`);
    process.exit(1);
  }
}

run('npm', ['run', 'typecheck']);
run('npm', ['test']);
run('npm', ['run', 'lint', '-w', 'zero-after-midnight']);
run('npm', ['run', 'simulate', '-w', 'zero-after-midnight']);
run('npm', ['test', '-w', 'zero-after-midnight']);
run('npm', ['run', 'build', '-w', 'surdet-editor']);
run('npm', ['run', 'build', '-w', 'zero-after-midnight']);
run('npm', ['run', 'build', '-w', 'surdet-starter']);
run('git', ['diff', '--check']);
console.log('[verify] P1/P2 引擎门禁通过');
