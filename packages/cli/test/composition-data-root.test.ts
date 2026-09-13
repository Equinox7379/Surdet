import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { compositionServiceForProject, loadIntegrationProvenance } from '../src/authoring/composition-service.js';
import { createReviewApplyFixture } from './helpers/review-apply-fixture.js';

const roots: string[] = [];
const priorRoot = process.env['SURDET_AGENT_DATA_DIR'];
afterEach(async () => {
  if (priorRoot === undefined) delete process.env['SURDET_AGENT_DATA_DIR'];
  else process.env['SURDET_AGENT_DATA_DIR'] = priorRoot;
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

it('resumes the same integration in the explicit data root, leaving the default root untouched', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'surdet-composition-root-'));
  roots.push(root);
  const fixture = await createReviewApplyFixture(root, false);
  const unrelatedRoot = path.join(root, 'unrelated-default');
  process.env['SURDET_AGENT_DATA_DIR'] = unrelatedRoot;
  const service = await compositionServiceForProject(fixture.projectRoot, fixture.dataRoot);
  const final = fixture.result.projection.finalResult!;
  const sidecar = JSON.parse(await fs.readFile(path.join(service.store.projectDirectory,
    'composition-plans', final.planId, 'identity.json'), 'utf8'));
  const resumed = await service.executePlan({ planId: final.planId,
    artifactSha256: sidecar.sha256, executeOperationId: 'execute-fixture' });
  expect(resumed.changeId).toBe(final.integrationChangeId);
  const { plan } = await service.store.readPlan(final.planId, sidecar.sha256);
  const source = { planId: plan.planId, planFingerprint: plan.planFingerprint };
  await expect(loadIntegrationProvenance(fixture.projectRoot, source, fixture.dataRoot))
    .resolves.toEqual({ available: true, plan });
  await expect(loadIntegrationProvenance(fixture.projectRoot, { ...source, planId: '../escape' }, fixture.dataRoot))
    .resolves.toEqual({ available: false, reason: 'COMPOSITION_PLAN_INVALID' });
  await expect(loadIntegrationProvenance(fixture.projectRoot, { ...source, planFingerprint: 'wrong' }, fixture.dataRoot))
    .resolves.toEqual({ available: false, reason: 'COMPOSITION_PLAN_INVALID' });
  const payloadPath = path.join(service.store.projectDirectory, 'composition-plans', plan.planId, 'payload.json');
  await fs.appendFile(payloadPath, '\n');
  await expect(loadIntegrationProvenance(fixture.projectRoot, source, fixture.dataRoot))
    .resolves.toEqual({ available: false, reason: 'COMPOSITION_PLAN_INVALID' });
  expect(await fs.stat(unrelatedRoot).then(() => true, () => false)).toBe(false);
});
