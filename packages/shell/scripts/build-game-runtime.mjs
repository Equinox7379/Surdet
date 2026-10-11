import { build } from 'vite';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildGameRuntime(output = path.join(root, 'game-runtime')) {
  const ui = await build({ configFile: false, root: path.join(root, 'runtime'), base: './',
    build: { outDir: path.join(output, 'game'), emptyOutDir: true, target: 'es2022',
      rollupOptions: { input: { page: path.join(root, 'runtime/index.html'),
        core: path.join(root, 'runtime/core.ts'), renderer: path.join(root, 'runtime/renderer.ts'),
        host: path.join(root, 'runtime/host.ts'), pixi: path.join(root, 'runtime/pixi.ts') },
        preserveEntrySignatures: 'strict', output: { entryFileNames: 'runtime/[name].js', chunkFileNames: 'runtime/[name].js', assetFileNames: 'runtime/[name][extname]' } } } });
  const host = await build({ configFile: false, root, resolve: { conditions: ['node'] },
    build: { target: 'node24', outDir: output, emptyOutDir: false, minify: false,
      lib: { entry: path.join(root, 'src/main.ts'), formats: ['es'], fileName: () => 'main.mjs' },
      rollupOptions: { external: id => id === 'electron' || id.startsWith('node:') || builtinModules.includes(id) } } });
  const html = await fs.readFile(path.join(output, 'game/index.html'), 'utf8');
  const imports = { '@surdet/core': './runtime/core.js', '@surdet/renderer': './runtime/renderer.js', '@surdet/host': './runtime/host.js', 'pixi.js': './runtime/pixi.js' };
  await fs.writeFile(path.join(output, 'game/index.html'), html.replace('<!--IMPORT_MAP-->', `<script type="importmap">${JSON.stringify({ imports })}</script>`));
  await fs.writeFile(path.join(output, 'preload.cjs'), ts.transpileModule(await fs.readFile(path.join(root, 'src/preload.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText);
  await fs.copyFile(path.join(root, '../../LICENSE'), path.join(output, 'LICENSE'));
  await fs.copyFile(path.join(root, '../../THIRD_PARTY_NOTICES.md'), path.join(output, 'THIRD_PARTY_NOTICES.md'));
  // Only licenses of libraries actually shipped in the runtime.
  const dependencies = new Set();
  for (const result of [ui, host].flat()) for (const chunk of result.output ?? []) if (chunk.type === 'chunk') {
    for (const id of Object.keys(chunk.modules)) {
      const match = id.replaceAll('\\', '/').replace(/^\0/, '').match(/^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//);
      if (match) dependencies.add(match[1]);
    }
  }
  for (const directory of dependencies) {
    const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    const dest = path.join(output, 'licenses', metadata.name);
    await fs.mkdir(dest, { recursive: true });
    for (const name of (await fs.readdir(directory)).filter(name => /^(license|licence|notice|copying|readme)(\.|$)/i.test(name)))
      await fs.cp(path.join(directory, name), path.join(dest, name), { recursive: true });
    await fs.copyFile(path.join(directory, 'package.json'), path.join(dest, 'package.json'));
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildGameRuntime(process.argv[2]);
