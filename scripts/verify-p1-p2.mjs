/** P1/P2 引擎策略门禁：只检查发布所需的关键文件存在性。 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

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
console.log('[verify] P1/P2 policy 通过');
