import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { renderCapabilityMatrix, validateCapabilityDocument } from './lib/capability-matrix.mjs';

const ROOT = process.cwd();
const sourcePath = path.join(ROOT, 'docs', 'capabilities.json');
const targetPath = path.join(ROOT, 'docs', 'capability-matrix.md');
const mode = process.argv[2] ?? '--write';

if (!['--write', '--check'].includes(mode)) {
  console.error('用法：node scripts/render-capability-matrix.mjs [--write|--check]');
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    validateCapabilityDocument(input, ROOT);
    const output = renderCapabilityMatrix(input);

    if (mode === '--check') {
      let current;
      try {
        current = fs.readFileSync(targetPath, 'utf8');
      } catch {
        console.error(`能力矩阵不存在或不可读：${path.relative(ROOT, targetPath)}`);
        process.exitCode = 1;
      }
      if (current !== undefined && current.replace(/\r\n/g, '\n') !== output.replace(/\r\n/g, '\n')) {
        console.error(`能力矩阵已漂移，请运行 npm run docs:capabilities：${path.relative(ROOT, targetPath)}`);
        process.exitCode = 1;
      }
    } else {
      const tempPath = `${targetPath}.${process.pid}.tmp`;
      fs.writeFileSync(tempPath, output, 'utf8');
      try {
        fs.renameSync(tempPath, targetPath);
      } catch (error) {
        if (fs.existsSync(targetPath)) fs.rmSync(targetPath);
        fs.renameSync(tempPath, targetPath);
      }
      console.log(`已生成 ${path.relative(ROOT, targetPath)}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
