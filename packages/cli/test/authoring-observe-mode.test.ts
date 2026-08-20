import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuthoringService } from '../src/authoring/authoring-service.js';

describe('authoring observe mode', () => {
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
      expect(after).toEqual(before);

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
