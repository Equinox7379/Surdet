import { build } from 'vite';
import ts from 'typescript';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'desktop-dist');
const ui = await build({ root, configFile: path.join(root, 'vite.config.ts') });
const host = await build({
  configFile: false, root, resolve: { conditions: ['node'] },
  build: { target: 'node24', outDir: output, emptyOutDir: true, minify: false,
    lib: { entry: path.join(root, 'desktop/main.ts'), formats: ['es'], fileName: () => 'main.mjs' },
    rollupOptions: { external: id => id === 'electron' || id.startsWith('node:') || builtinModules.includes(id) },
  },
});
// Keep the licenses of code actually bundled in the app, not the whole toolchain.
const packageRoots = new Set();
for (const result of [ui, host].flat()) for (const chunk of result.output ?? []) {
  if (chunk.type !== 'chunk') continue;
  for (const id of Object.keys(chunk.modules)) {
    const normalized = id.replaceAll('\\', '/').replace(/^\0/, '');
    const match = normalized.match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (match) packageRoots.add(match[1]);
  }
}
for (const directory of packageRoots) {
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const destination = path.join(output, 'licenses', metadata.name);
  const licenses = (await fs.readdir(directory)).filter(name => /^(license|licence|notice|copying)(\.|$)/i.test(name));
  await fs.mkdir(destination, { recursive: true });
  for (const name of licenses) await fs.cp(path.join(directory, name), path.join(destination, name), { recursive: true });
  await fs.copyFile(path.join(directory, 'package.json'), path.join(destination, 'package.json'));
  if (licenses.length === 0) {
    // Some published packages only carry their license declaration in README/metadata.
    for (const name of (await fs.readdir(directory)).filter(name => /^readme(\.|$)/i.test(name))) await fs.copyFile(path.join(directory, name), path.join(destination, name));
    console.warn(`保留依赖的许可声明与来源（包内无独立许可正文）：${metadata.name}`);
  }
}
const preload = ts.transpileModule(await fs.readFile(path.join(root, 'desktop/preload.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, isolatedModules: true },
}).outputText;
await fs.writeFile(path.join(output, 'preload.cjs'), preload);
await fs.cp(path.join(root, 'dist'), path.join(output, 'ui'), { recursive: true });
await fs.cp(path.join(root, '../cli/templates'), path.join(output, 'templates'), { recursive: true });
await fs.copyFile(path.join(root, '../cli/NOTICE.md'), path.join(output, 'templates/NOTICE.md'));
await fs.copyFile(path.join(root, '../../LICENSE'), path.join(output, 'LICENSE'));
await fs.copyFile(path.join(root, '../../THIRD_PARTY_NOTICES.md'), path.join(output, 'THIRD_PARTY_NOTICES.md'));
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
await fs.writeFile(path.join(output, 'package.json'), JSON.stringify({ name: 'surdet-editor-desktop', productName: 'Surdet Editor', version: metadata.version, private: true, license: 'MIT', type: 'module', main: 'main.mjs', author: 'Equinox7379', description: 'Surdet Windows 桌面创作编辑器' }, null, 2));
