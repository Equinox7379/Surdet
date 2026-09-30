import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { HumanWorkspaceStore } from '../src/authoring/human-workspace-store.js';
import { NodeChangeStore } from '../src/authoring/node-change-store.js';
import { ProjectMutationNoticeStore } from '../src/authoring/project-mutation-notice-store.js';
import { openAgentPortSession } from '../src/agent-port/session.js';
import { sessionDescriptionSchema } from '../src/agent-port/server.js';
import { standardSchemaFromJson } from '../src/authoring/schema-validator.js';

const roots: string[] = [];
const workspaceSessionId = '7b617e40-f122-40dd-a582-9189dc3c04c8';
const browserSessionId = 'human-workspace-test';

function fileContents(root: string, relative = ''): Record<string, string> {
  if (!fs.existsSync(path.join(root, relative))) return {};
  return Object.fromEntries(fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .filter(entry => entry.name !== '.locks')
    .flatMap(entry => {
      const file = path.join(relative, entry.name);
      return entry.isDirectory()
        ? Object.entries(fileContents(root, file))
        : [[file, fs.readFileSync(path.join(root, file), 'utf8')]];
    }));
}

async function readyChange() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-human-commit-'));
  roots.push(fixture);
  const project = path.join(fixture, 'project');
  const dataRoot = path.join(fixture, 'data');
  fs.mkdirSync(path.join(project, 'content/scenario'), { recursive: true });
  fs.writeFileSync(path.join(project, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }));
  fs.writeFileSync(path.join(project, 'content/scenario/start.gal'), '@scene start\n凛：开始。\n@end\n');
  vi.stubEnv('SURDET_AGENT_DATA_DIR', dataRoot);
  const service = new AuthoringService();
  const { result: { changeId } } = await service.begin(project);
  await service.variableEnsure(changeId, { operationId: 'relay-variable', name: 'trust', type: 'number', initial: 0 });
  await service.validate(changeId);
  await service.simulate(changeId);
  await service.runFrom(changeId, { sceneId: 'start', choices: [], seed: 1 });
  return { service, changeId, project: fs.realpathSync(project), dataRoot, workspace: new HumanWorkspaceStore({ dataRoot }) };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Agent commit and real human workspace state', () => {
  it('describes the real workspace and blocks only commit without exposing private state', async () => {
    const { changeId, project, workspace } = await readyChange();
    await workspace.heartbeat(project, { workspaceSessionId, browserSessionId, workspaceGeneration: 1, availability: 'dirty', dirtyScopes: ['config'] });
    const session = await openAgentPortSession({ projectRoot: project, policy: 'apply', resumeChangeId: changeId });
    try {
      const described = await session.describe();
      expect(described.contractVersion).toBe('2.25.0');
      expect(described.humanWorkspace).toMatchObject({ availability: 'dirty', dirtyScopes: ['config'] });
      expect(described.capabilities.find(capability => capability.id === 'change.commit')?.availability).toBe('state-blocked');
      expect(described.capabilities.find(capability => capability.id === 'project.inspect')?.availability).toBe('available');
      expect(described.nextActions).toEqual(['session.describe']);
      const encoded = JSON.stringify(described);
      expect(encoded).not.toContain('browserSessionId');
      expect(encoded).not.toContain('workspaceSessionId');
      expect(encoded).not.toContain('projectRootIdentity');
      const schema = standardSchemaFromJson(sessionDescriptionSchema)['~standard'];
      expect((await schema.validate(described)).issues).toBeUndefined();
      expect((await schema.validate({ ...described, humanWorkspace: { ...described.humanWorkspace, draftText: 'private' } })).issues).toBeDefined();
    } finally {
      await session.close();
    }
  });

  it.each([
    { availability: 'dirty' as const, dirtyScopes: ['scene' as const], code: 'HUMAN_WORKSPACE_DIRTY' },
    { availability: 'busy' as const, busyReasons: ['saving' as const], code: 'HUMAN_WORKSPACE_BUSY' },
    { availability: 'blocked' as const, blockedReasons: ['autosave-recovery' as const], code: 'HUMAN_WORKSPACE_STATE_CORRUPT' },
  ])('rejects $availability without changing project, record, evidence, stage or journal', async ({ code, ...state }) => {
    const { service, changeId, project, dataRoot, workspace } = await readyChange();
    await workspace.heartbeat(project, { workspaceSessionId, browserSessionId, workspaceGeneration: 1, ...state });
    const projectBefore = fileContents(project);
    const dataBefore = fileContents(dataRoot);
    const recordBefore = (await NodeChangeStore.openByChangeId(changeId))!.record;

    await expect(service.commit(changeId)).rejects.toMatchObject({ code });

    expect(fileContents(project)).toEqual(projectBefore);
    expect(fileContents(dataRoot)).toEqual(dataBefore);
    expect((await NodeChangeStore.openByChangeId(changeId))!.record).toEqual(recordBefore);
    expect(recordBefore.status).toBe('OPEN');
    expect(await new ProjectMutationNoticeStore({ dataRoot }).readLatest(project)).toBeNull();
  });

  it('retries the same change after a human discards without changing the disk base', async () => {
    const { service, changeId, project, dataRoot, workspace } = await readyChange();
    await workspace.heartbeat(project, { workspaceSessionId, browserSessionId, workspaceGeneration: 1, availability: 'dirty', dirtyScopes: ['scene'] });
    await expect(service.commit(changeId)).rejects.toMatchObject({ code: 'HUMAN_WORKSPACE_DIRTY' });
    await workspace.heartbeat(project, { workspaceSessionId, browserSessionId, workspaceGeneration: 2, availability: 'clean' });
    const committed = await service.commit(changeId);
    expect(committed.result.status).toBe('COMMITTED');
    expect(await new ProjectMutationNoticeStore({ dataRoot }).readLatest(project)).toMatchObject({
      initiator: 'external-agent', changeId, changedPaths: ['game.config.json'],
      projectRevision: committed.projectRevision,
    });
  });

  it('returns successful commit with a safe warning when the notification cannot be written', async () => {
    const { service, changeId, project } = await readyChange();
    vi.spyOn(ProjectMutationNoticeStore.prototype, 'record').mockRejectedValue(new Error('private-path-or-token'));
    const committed = await service.commit(changeId);
    expect(committed.result).toMatchObject({ status: 'COMMITTED', coordination: { status: 'warning' } });
    expect(JSON.stringify(committed)).not.toContain('private-path-or-token');
    const after = fileContents(project);
    await expect(service.commit(changeId)).rejects.toMatchObject({ code: 'CHANGE_NOT_OPEN' });
    expect(fileContents(project)).toEqual(after);
  });
});
