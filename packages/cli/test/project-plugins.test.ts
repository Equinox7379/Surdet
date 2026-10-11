import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { lintProject } from '../src/lint.js';
import { inspectWindowsExport } from '../src/windows-export.js';
import { cmdSimulate, simulateProject } from '../src/simulate.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { AUTHORING_CAPABILITY_REGISTRY, normalizeAuthoringError } from '@surdet/authoring';
import { standardSchemaFromJson } from '../src/authoring/schema-validator.js';

function project(source = '@counter 2\n之后。') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-plugin-'));
  fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"plugin-test"}');
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ title: '插件测试', entryScene: 'intro', variables: {}, plugins: [{ id: 'counter', entry: 'plugins/counter.js', apiVersion: 1,
    instructions: [{ name: 'counter', blocking: false, parameters: [{ name: 'value', type: 'number' }] }] }] }));
  fs.writeFileSync(path.join(root, 'content/scenario/intro.gal'), source);
  return root;
}
it('checks declarations/entries before build without evaluating code, and validates actual arguments', async () => {
  const root = project('@counter nope\n之后。');
  try {
    expect(lintProject(root).issues.map(i => i.code)).toContain('PLUGIN_MISSING');
    expect(lintProject(root).issues.map(i => i.code)).toContain('PLUGIN_ARGUMENT');
    expect((await inspectWindowsExport(root, path.resolve('templates'))).issues.map(i => i.code)).toContain('PLUGIN_MISSING');
    fs.mkdirSync(path.join(root, 'plugins')); fs.writeFileSync(path.join(root, 'plugins/counter.js'), 'throw new Error("must not evaluate for checks");');
    expect(lintProject(root).issues.some(i => i.code === 'PLUGIN_MISSING')).toBe(false);
    expect((await inspectWindowsExport(root, path.resolve('templates'))).issues.some(i => i.code === 'PLUGIN_MISSING')).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
it('returns incomplete and a nonzero CLI result for a required extension, retaining structured evidence', async () => {
  const root = project(), stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    expect(simulateProject(root)).toMatchObject({ status: 'incomplete', endings: [], coverage: { stops: [{ kind: 'requires-extension' }] } });
    expect(await cmdSimulate(root, ['--json'])).toBe(1);
    expect(JSON.parse(String(stdout.mock.calls.at(-1)![0])).status).toBe('incomplete');
  } finally { stdout.mockRestore(); fs.rmSync(root, { recursive: true, force: true }); }
});
it('exposes declaration/parameter schema through public inspect and refuses simulation approval evidence', async () => {
  const root = project();
  try {
    const service = new AuthoringService();
    const inspection = await service.inspectProject(root);
    expect(inspection.result.plugins[0]).toMatchObject({ id: 'counter', instructions: [{ name: 'counter', blocking: false }] });
    const capability = AUTHORING_CAPABILITY_REGISTRY.find(c => c.id === 'project.inspect')!;
    expect((await standardSchemaFromJson(capability.outputSchema)['~standard'].validate(inspection.result)).issues).toBeUndefined();
    await expect(service.simulateProject(root)).rejects.toMatchObject({ code: 'SIMULATION_INCOMPLETE', message: expect.stringContaining('需要扩展'),
      details: { report: { status: 'incomplete', paths: [{ termination: 'requires-extension' }] } } });
    try { await service.simulateProject(root); } catch (error) {
      const normalized = normalizeAuthoringError(error);
      expect(normalized.retryDisposition).toBe('never'); expect(normalized.repairActions[0]?.reason).toContain('增加模拟预算不能解决');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
