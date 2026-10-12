import { afterEach, expect, it, vi } from 'vitest';
import { PreviewObservationService } from '../src/authoring/preview-observation-service.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';
import { HumanWorkspaceStore } from '../src/authoring/human-workspace-store.js';
import { loadProjectCoordinationBaseline } from '../src/authoring/project-coordination-baseline.js';
import type { PreviewBeginInput, PreviewObservation } from '@surdet/authoring';

vi.mock('../src/authoring/project-coordination-baseline.js', () => ({ loadProjectCoordinationBaseline: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

const revision = 'a'.repeat(64), sessionId = '11111111-1111-4111-8111-111111111111';
const browserId = 'test-browser', root = 'D:/preview-plugin-fixture';
const begin: PreviewBeginInput = { action: 'begin', previewId: `preview-${sessionId}`, previewGeneration: 1,
  sceneId: 'intro', expectedProjectRevision: revision, expectedCoordinationRevision: revision, source: { files: [], assets: [] } };
function fixture(hasPlugins: boolean, previous: boolean) {
  const config = hasPlugins ? { plugins: [{ id: 'counter', entry: 'plugins/counter.js', apiVersion: 1,
    instructions: [{ name: 'count', blocking: false, parameters: [] }] }] } : {};
  const storage = { listFiles: async () => ['game.config.json'], readText: async () => ({ path: 'game.config.json', text: JSON.stringify(config) }) };
  vi.spyOn(NodeProjectStorage, 'open').mockResolvedValue(storage as unknown as NodeProjectStorage);
  const workspace = { workspaceSessionId: sessionId, browserSessionId: browserId, workspaceGeneration: 1,
    availability: 'clean', connection: 'active', loadedProjectRevision: revision, loadedCoordinationRevision: revision };
  const workspaces = { inspect: async () => ({ observations: [workspace] }), readSession: async () => workspace };
  const service = new PreviewObservationService('D:/preview-plugin-data', workspaces as unknown as HumanWorkspaceStore);
  const observed: PreviewObservation = { previewId: begin.previewId, previewGeneration: 1, workspaceSessionId: sessionId,
    projectIdentity: 'test-project', projectRevision: revision, coordinationRevision: revision, sceneId: 'intro',
    startedAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), runtimeGeneration: 1,
    state: 'passed', source: begin.source, events: [] };
  const record = { formatVersion: 1, projectIdentity: 'test-project', workspaceSessionId: sessionId, browserSessionId: browserId,
    workspaceGeneration: 1, previewGeneration: 1, invalidated: null, assetPaths: [], observation: observed };
  // The stored-record boundary supplies an older observation; public publish/read still perform
  // their real source eligibility checks. No checksums are calculated or compared by this fixture.
  vi.spyOn(service as unknown as { readStored(): Promise<unknown> }, 'readStored').mockResolvedValue(previous ? record : null);
  vi.spyOn(service as unknown as { diskSource(): Promise<unknown> }, 'diskSource').mockResolvedValue({ source: begin.source, assetPaths: [] });
  vi.mocked(loadProjectCoordinationBaseline).mockResolvedValue({ projectRevision: revision, coordinationRevision: revision } as Awaited<ReturnType<typeof loadProjectCoordinationBaseline>>);
  return service;
}

it.each([false, true])('rejects plugin-backed formal begin, including a retry of an older observation (%s)', async previous => {
  const service = fixture(true, previous);
  await expect(service.publish(root, sessionId, browserId, begin)).rejects.toMatchObject({
    code: 'PREVIEW_OBSERVATION_UNAVAILABLE', message: expect.stringContaining('项目插件'),
  });
});
it('does not append to an older formal observation whose plugin source cannot be verified', async () => {
  const service = fixture(true, true);
  await expect(service.publish(root, sessionId, browserId, { action: 'append', previewId: begin.previewId, previewGeneration: 1,
    messages: [{ type: 'surdet-preview-trace-complete', traceId: begin.previewId, generation: 1, status: 'passed', eventCount: 0 }] }))
    .rejects.toMatchObject({ code: 'PREVIEW_OBSERVATION_UNAVAILABLE' });
});
it('does not return an older plugin-backed passed observation as current evidence', async () => {
  const service = fixture(true, true);
  const result = await service.read(root);
  expect(result.status).toBe('stale');
  expect(result.reasons).toContain('PREVIEW_OBSERVATION_UNAVAILABLE');
});
it('keeps the normal source validation path reachable for a project without plugins', async () => {
  const service = fixture(false, false);
  vi.mocked(loadProjectCoordinationBaseline).mockRejectedValue(new Error('normal source validation reached'));
  await expect(service.publish(root, sessionId, browserId, begin)).rejects.toThrow('normal source validation reached');
});
