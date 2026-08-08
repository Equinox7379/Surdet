import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const sourcePath = path.join(ROOT, 'docs', 'capabilities.json');
const targetPath = path.join(ROOT, 'docs', 'capability-matrix.md');
const allowedKinds = new Set(['dsl', 'system', 'ui', 'tooling']);
const allowedStatuses = new Set(['implemented', 'n/a', 'planned']);
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const mode = process.argv[2] ?? '--write';

if (!['--write', '--check'].includes(mode)) {
  console.error('用法：node scripts/render-capability-matrix.mjs [--write|--check]');
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const records = input?.capabilities;
    if (!Array.isArray(records)) throw new Error('capabilities 必须是数组');

    const ids = new Set();
    for (const [index, record] of records.entries()) {
      if (!record || typeof record !== 'object') throw new Error(`第 ${index + 1} 条能力记录不是对象`);
      if (typeof record.id !== 'string' || !idPattern.test(record.id)) {
        throw new Error(`能力 ID 必须是唯一 kebab-case：第 ${index + 1} 条`);
      }
      if (ids.has(record.id)) throw new Error(`能力 ID 重复：${record.id}`);
      ids.add(record.id);
      if (!allowedKinds.has(record.kind)) throw new Error(`未知能力 kind：${record.id}`);
      for (const field of ['core', 'renderer', 'editor', 'host']) {
        if (!allowedStatuses.has(record[field])) throw new Error(`未知 ${field} 状态：${record.id}`);
      }
      if (!Array.isArray(record.tests) || !Array.isArray(record.docs)) {
        throw new Error(`tests/docs 必须是数组：${record.id}`);
      }
      if ([record.core, record.renderer, record.editor, record.host].includes('implemented') && record.tests.length === 0) {
        throw new Error(`implemented 能力必须提供非空测试证据：${record.id}`);
      }
    }

    const sorted = [...records].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
    const status = (value) => ({ implemented: '✅', planned: '🛠️', 'n/a': '—' })[value];
    const evidence = (values) => values.length === 0 ? '—' : values.map((value) => `\`${value}\``).join('<br>');
    const lines = [
      '# Surdet 能力矩阵',
      '',
      '> 本文件由 `docs/capabilities.json` 生成。请修改 JSON 后运行 `npm run docs:capabilities`，不要手工编辑本文件。',
      '',
      '| 能力 | 类型 | Core | Renderer | Editor | Host | 测试证据 | 文档证据 | 当前限制 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const record of sorted) {
      lines.push('| `' + record.id + '` | ' + record.kind + ' | ' + status(record.core) + ' | ' + status(record.renderer) + ' | ' + status(record.editor) + ' | ' + status(record.host) + ' | ' + evidence(record.tests) + ' | ' + evidence(record.docs) + ' | ' + (record.limitation ?? '—') + ' |');
    }
    lines.push('', '状态含义：✅ 已有代码与测试证据；🛠️ 已列入计划但尚未作为当前能力交付；— 不适用。', '');
    const output = lines.join('\n');

    if (mode === '--check') {
      let current;
      try {
        current = fs.readFileSync(targetPath, 'utf8');
      } catch {
        console.error(`能力矩阵不存在或不可读：${path.relative(ROOT, targetPath)}`);
        process.exitCode = 1;
      }
      if (current !== undefined && current !== output) {
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
