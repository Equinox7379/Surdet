import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuthoringService } from '../src/authoring/authoring-service.js';

describe('authoring observe mode', () => {
  it('uses working content for asset references and rejects another project change on every read', async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-read-views-'));
    const roots = ['one', 'two'].map((name) => path.join(fixture, name));
    for (const root of roots) {
      fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
      fs.mkdirSync(path.join(root, 'content/assets/bg'), { recursive: true });
      fs.writeFileSync(path.join(root, 'game.config.json'), '{"entryScene":"start","variables":{}}');
      fs.writeFileSync(path.join(root, 'content/scenario/start.gal'), '@scene start\n@end\n');
      fs.writeFileSync(path.join(root, 'content/assets/bg/night.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    }
    const previousDataDir = process.env['SURDET_AGENT_DATA_DIR'];
    process.env['SURDET_AGENT_DATA_DIR'] = path.join(fixture, 'data');
    try {
      const service = new AuthoringService();
      const root = roots[0]!;
      const other = roots[1]!;
      const { result: { changeId } } = await service.begin(root);
      await service.sceneCreate(changeId, { operationId: 'background-reference', sceneId: 'night_scene', blocks: [{ kind: 'instruction', name: 'bg', args: ['night'] }] });
      const project = await service.projectAssets(root);
      const working = await service.projectAssets(root, changeId);
      expect(project.result.intelligence.items.find((item) => item.key === 'night')?.references).toHaveLength(0);
      expect(working.result.intelligence.items.find((item) => item.key === 'night')?.references.length).toBeGreaterThan(0);
      const inspected = await service.inspectProject(root, changeId);
      expect(inspected.result.assets).toMatchObject({ intelligence: working.result.intelligence });
      expect(working).toMatchObject({ changeId, workingRevision: inspected.workingRevision });
      await service.galleryCgCreate(changeId, { operationId: 'gallery-reference', id: 'night', name: '夜晚' });
      expect((await service.projectGallery(root, changeId)).result.cgs).toHaveLength(1);
      expect((await service.projectGallery(root)).result.cgs).toHaveLength(0);
      for (const read of [
        () => service.projectAssets(other, changeId), () => service.inspectProject(other, changeId),
        () => service.projectGallery(other, changeId), () => service.inspectObject(other, 'scene:start', changeId),
      ]) await expect(read()).rejects.toMatchObject({ code: 'PROJECT_IDENTITY_MISMATCH' });
    } finally {
      if (previousDataDir === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
      else process.env['SURDET_AGENT_DATA_DIR'] = previousDataDir;
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('validates and simulates a project snapshot without creating a change', async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-authoring-observe-'));
    const agentDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-authoring-observe-data-'));
    fs.mkdirSync(path.join(projectRoot, 'content/scenario'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'game.config.json'), JSON.stringify({ entryScene: 'ch01_01', variables: {} }), 'utf8');
    fs.writeFileSync(path.join(projectRoot, 'content/scenario/ch01_01.gal'), '@scene ch01_01\n凛：开场。\n@end\n', 'utf8');
    const previousDataDir = process.env['SURDET_AGENT_DATA_DIR'];
    process.env['SURDET_AGENT_DATA_DIR'] = agentDataDir;
    try {
      const before = fs.readdirSync(agentDataDir, { recursive: true });
      const service = new AuthoringService();
      const validation = await service.validateProject(projectRoot);
      const simulation = await service.simulateProject(projectRoot, { sceneId: 'ch01_01' });
      const after = fs.readdirSync(agentDataDir, { recursive: true });
      expect(validation.result.view).toBe('project');
      expect(simulation.result.view).toBe('project');
      const nonLeaseEntries = after.filter((entry) => !String(entry).replaceAll('\\', '/').startsWith('.locks'));
      expect(nonLeaseEntries).toEqual(before);
      expect(fs.readdirSync(path.join(agentDataDir, '.locks', 'projects'))).toEqual([]);
      expect(fs.existsSync(path.join(agentDataDir, '.locks', 'changes'))).toBe(false);

      const begun = await service.begin(projectRoot);
      const baseRevision = begun.projectRevision;
      const changed = await service.variableEnsure(begun.result.changeId, {
        operationId: 'observe-mode-variable',
        name: 'agent.route',
        type: 'string',
        initial: '',
      });
      expect(changed.projectRevision).toBe(baseRevision);
      expect(changed.workingRevision).toBeGreaterThan(0);
      expect(changed.workingSnapshotRevision).not.toBe(baseRevision);
      expect(fs.readFileSync(path.join(projectRoot, 'game.config.json'), 'utf8'))
        .not.toContain('agent.route');
    } finally {
      if (previousDataDir === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
      else process.env['SURDET_AGENT_DATA_DIR'] = previousDataDir;
    }
  });
});
