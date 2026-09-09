import * as http from 'node:http';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { ProjectMutationNoticeStore } from '../src/authoring/project-mutation-notice-store.js';
import { ProjectMutationLeaseContext } from '../src/editor-workspace-authority/project-mutation-lease-context.js';
import { AssetProjectMutationCoordinator } from '../src/asset-import-authority/mutation-coordinator.js';
import {
  ASSET_IMPORT_AUTHORITY_BASE_PATH,
  ASSET_IMPORT_AUTHORITY_BINDING_HEADER,
  ASSET_IMPORT_AUTHORITY_TOKEN_HEADER,
} from '../src/asset-import-authority/http-handler.js';
import { assetImportAuthorityVitePlugin } from '../src/asset-import-authority/vite-plugin.js';

const roots: string[] = [];
const tempRoot = process.env['SURDET_TEST_TEMP_ROOT'] ?? process.env['TEMP'] ?? process.env['TMP'] ?? os.tmpdir();

async function fixture(): Promise<{ root: string; projectRoot: string; sharedDataRoot: string; recordsDataRoot: string }> {
  const root = await mkdtemp(path.join(tempRoot!, 'surdet-asset-project-lease-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const sharedDataRoot = path.join(root, 'shared-data');
  const recordsDataRoot = path.join(root, 'asset-records');
  await mkdir(projectRoot, { recursive: true });
  return { root, projectRoot, sharedDataRoot, recordsDataRoot };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('asset import project mutation lease wiring', () => {
  it('holds the shared project lease across readiness and work, then releases it', async () => {
    const value = await fixture();
    const canonicalRoot = await realpath(value.projectRoot);
    const manager = new NodeLocalLeaseManager(value.sharedDataRoot);
    const context = await ProjectMutationLeaseContext.open(canonicalRoot, manager);
    const coordinator = new AssetProjectMutationCoordinator(context);
    let readinessHeld = false;
    let workHeld = false;
    coordinator.register('asset-import', async () => {
      await context.assertHeld();
      readinessHeld = true;
    });

    await coordinator.run('asset-relocation', async () => {
      await context.assertHeld();
      workHeld = true;
    });

    expect(readinessHeld).toBe(true);
    expect(workHeld).toBe(true);
    expect((await manager.inspect('project', canonicalRoot)).state).toBe('free');
  });

  it('starts the Vite authority with the shared project lease free', async () => {
    const value = await fixture();
    const previousDataRoot = process.env['SURDET_AGENT_DATA_DIR'];
    process.env['SURDET_AGENT_DATA_DIR'] = value.sharedDataRoot;
    const plugin = assetImportAuthorityVitePlugin({
      projectRoot: value.projectRoot,
      dataRoot: value.recordsDataRoot,
    });
    const httpServer = http.createServer();
    try {
      plugin.configureServer({
        middlewares: { use() {} },
        httpServer,
      });
      await plugin.api.ready();
      const canonicalRoot = await realpath(value.projectRoot);
      const manager = new NodeLocalLeaseManager(value.sharedDataRoot);
      expect((await manager.inspect('project', canonicalRoot)).state).toBe('free');
    } finally {
      await plugin.closeBundle();
      httpServer.close();
      if (previousDataRoot === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
      else process.env['SURDET_AGENT_DATA_DIR'] = previousDataRoot;
    }
  });

  it('records a scene mutation notice after an unbound scene commit and does not repeat it', async () => {
    const value = await fixture();
    const scenarioDirectory = path.join(value.projectRoot, 'content', 'scenario');
    await mkdir(scenarioDirectory, { recursive: true });
    await writeFile(path.join(scenarioDirectory, 'start.gal'), '@scene start\n@end\n');
    const previousDataRoot = process.env['SURDET_AGENT_DATA_DIR'];
    process.env['SURDET_AGENT_DATA_DIR'] = value.sharedDataRoot;
    const plugin = assetImportAuthorityVitePlugin({
      projectRoot: value.projectRoot,
      dataRoot: value.recordsDataRoot,
    });
    let middleware: ((request: http.IncomingMessage, response: http.ServerResponse, next: (error?: unknown) => void) => void) | undefined;
    const server = http.createServer((request, response) => {
      middleware?.(request, response, () => { response.statusCode = 404; response.end(); });
    });
    try {
      plugin.configureServer({
        middlewares: { use(handler) { middleware = handler; } },
        httpServer: server,
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('missing address');
      const origin = `http://127.0.0.1:${address.port}`;
      await plugin.api.ready();
      const injected = plugin.transformIndexHtml.handler('<html><head></head></html>', {
        path: '/index.html',
        server,
      });
      const token = /"token":"([^"]+)"/.exec(injected)?.[1];
      if (token === undefined) throw new Error('missing authority token');
      const request = async (route: string, body: unknown, extraHeaders: Record<string, string> = {}) => {
        const response = await fetch(`${origin}${route}`, {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/json',
            [ASSET_IMPORT_AUTHORITY_TOKEN_HEADER]: token,
            ...extraHeaders,
          },
          body: JSON.stringify(body),
        });
        return { response, body: await response.json() as { ok: boolean; data: any } };
      };
      const browserSessionId = 'browser-scene-notice';
      const challenge = await request(`${ASSET_IMPORT_AUTHORITY_BASE_PATH}/binding/challenges`, { browserSessionId });
      expect(challenge.response.status).toBe(200);
      const probePath = path.join(value.projectRoot, ...(challenge.body.data.relativeProbePath as string).split('/'));
      const nonce = JSON.parse(await readFile(probePath, 'utf8')).nonce as string;
      const confirmed = await request(
        `${ASSET_IMPORT_AUTHORITY_BASE_PATH}/binding/challenges/${challenge.body.data.challengeId}/confirm`,
        { browserSessionId, nonce },
      );
      expect(confirmed.response.status).toBe(200);
      const bindingToken = confirmed.body.data.bindingToken as string;
      const operationId = '55555555-5555-4555-8555-555555555555';
      const planned = await request(`${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/plan`, {
        operationId,
        kind: 'delete',
        sourcePath: 'content/scenario/start.gal',
      }, { [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken });
      expect(planned.response.status).toBe(200);
      const requestId = '66666666-6666-4666-8666-666666666666';
      const commitBody = {
        requestId,
        plans: [{ operationId, planFingerprint: planned.body.data.planFingerprint }],
        writes: [],
      };
      const committed = await request(`${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/commit`, commitBody, {
        [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken,
      });
      expect(committed.response.status).toBe(200);
      expect(committed.body.data.status).toBe('COMMITTED');
      const notices = new ProjectMutationNoticeStore({ dataRoot: value.sharedDataRoot });
      const first = await notices.readLatest(value.projectRoot);
      expect(first).toMatchObject({
        initiator: 'scene-authority',
        operationId: requestId,
        changedPaths: ['content/scenario/start.gal'],
      });

      const replay = await request(`${ASSET_IMPORT_AUTHORITY_BASE_PATH}/scenes/commit`, commitBody, {
        [ASSET_IMPORT_AUTHORITY_BINDING_HEADER]: bindingToken,
      });
      expect(replay.response.status).toBe(200);
      const second = await notices.readLatest(value.projectRoot);
      expect(second?.sequence).toBe(first?.sequence);
    } finally {
      await plugin.closeBundle();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousDataRoot === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
      else process.env['SURDET_AGENT_DATA_DIR'] = previousDataRoot;
    }
  });
});
