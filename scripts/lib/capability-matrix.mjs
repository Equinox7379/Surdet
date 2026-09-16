import fs from 'node:fs';
import path from 'node:path';

const allowedKinds = new Set(['dsl', 'system', 'ui', 'tooling']);
const allowedStatuses = new Set(['implemented', 'n/a', 'planned']);
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateEvidencePath(root, capabilityId, kind, value) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${capabilityId} 的 ${kind} 证据必须是非空相对路径`);
  }

  const normalized = value.replaceAll('\\', '/');
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || normalized.split('/').includes('..')) {
    throw new Error(`${capabilityId} 的 ${kind} 证据不是安全相对路径：${value}`);
  }

  if (!fs.existsSync(path.join(root, value))) {
    throw new Error(`${capabilityId} 的 ${kind} 证据 ${value} 不存在`);
  }
  if (kind === 'test' && !/\.(?:test|spec|e2e)\.[cm]?[jt]sx?$/.test(normalized)) {
    throw new Error(`${capabilityId} 的测试证据必须指向测试文件，不能用生产源码代替：${value}`);
  }
}

export function validateCapabilityDocument(input, root) {
  if (input?.version !== 1) throw new Error('capabilities version 必须为 1');
  if (!Array.isArray(input.capabilities)) throw new Error('capabilities 必须是数组');

  const ids = new Set();
  for (const [index, record] of input.capabilities.entries()) {
    if (!record || typeof record !== 'object') {
      throw new Error(`第 ${index + 1} 条能力记录不是对象`);
    }
    if (typeof record.id !== 'string' || !idPattern.test(record.id) || ids.has(record.id)) {
      throw new Error(`能力 ID 必须是唯一 kebab-case：第 ${index + 1} 条`);
    }
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
    for (const value of record.tests) validateEvidencePath(root, record.id, 'test', value);
    for (const value of record.docs) validateEvidencePath(root, record.id, 'docs', value);
  }
}

export function renderCapabilityMatrix(input) {
  const sorted = [...input.capabilities].sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const status = (value) => ({ implemented: '✅', planned: '🛠️', 'n/a': '—' })[value];
  const evidence = (values) => values.length === 0 ? '—' : values.map((value) => `\`${value}\``).join('<br>');
  const lines = [
    '# Surdet 能力矩阵',
    '',
    '> 本文件由 `docs/capabilities.json` 生成。请修改 JSON 后运行 `npm run docs:capabilities`，不要手工编辑本文件。',
    '> 下表是已登记能力的实现与测试索引，不是一次运行的通过证明，也不穷尽全部 Agent 能力；正式创作入口以 capabilities.describe 为准。',
    '',
    '| 能力 | 类型 | Core | Renderer | Editor | Host | 测试证据 | 文档证据 | 当前限制 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const record of sorted) {
    lines.push('| `' + record.id + '` | ' + record.kind + ' | ' + status(record.core) + ' | ' + status(record.renderer) + ' | ' + status(record.editor) + ' | ' + status(record.host) + ' | ' + evidence(record.tests) + ' | ' + evidence(record.docs) + ' | ' + (record.limitation ?? '—') + ' |');
  }
  lines.push('', '状态含义：✅ 已有代码与测试证据；🛠️ 已列入计划但尚未作为当前能力交付；— 不适用。', '');
  return lines.join('\n');
}
