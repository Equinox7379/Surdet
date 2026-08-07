/**
 * Electron sandbox preload 的编译入口。
 * Shell 主进程保持 ESM，但 Electron 43 对 sandbox preload 按 CommonJS 加载，
 * 因此将同一份已类型检查的 TS 源码编译为 .cjs，避免 package.json 的 type=module 误解析。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const sourcePath = path.join(packageDir, 'src', 'preload.ts');
const outputPath = path.join(packageDir, 'dist', 'preload.cjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const result = ts.transpileModule(source, {
  fileName: sourcePath,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    sourceMap: true,
    inlineSources: true,
  },
});

fs.writeFileSync(outputPath, result.outputText, 'utf8');
fs.writeFileSync(`${outputPath}.map`, result.sourceMapText ?? '', 'utf8');
console.log(`[shell] 已生成 sandbox preload：${path.relative(packageDir, outputPath)}`);
