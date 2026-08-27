import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { AuthoringOperationError } from '@surdet/authoring';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchAuthoringCapability, type InvocationContext } from '../src/authoring/authoring-dispatcher.js';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { createAgentPortServer } from '../src/agent-port/server.js';
import { AgentPortSession, openAgentPortSession } from '../src/agent-port/session.js';

const temporaryRoots: string[] = [];

function makeProject(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-review-' + name + '-'));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, 'content', 'scenario'), { recursive: true });
  fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }), 'utf8');
  fs.writeFileSync(path.join(root, 'content', 'scenario', 'start.gal'), '@scene start\n凛：开始。\n@end\n', 'utf8');
  return root;
}

function invocationContext(root: string, policy: 'observe' | 'stage' | 'apply', activeChangeId?: string): InvocationContext {
  return {
    sessionId: 'review-test',
    policy,
    projectRoot: root,
    ...(activeChangeId === undefined ? {} : { activeChangeId }),
  };
}

describe('Wave 6 Agent Port review capabilities', () => {
  afterEach(() => {
    delete process.env['SURDET_AGENT_DATA_DIR'];
    for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it('routes reviewed plan input and forwards approvalRef without interpreting receipts', async () => {
    const root = makeProject('dispatcher');
    const approvalRef = {
      resultReviewId: 'review_result_1',
      approvalId: 'approval_1',
      approvalFingerprint: 'c'.repeat(64),
    };
    const service = {
      planComposition: vi.fn(async (_projectRoot: string, input: Record<string, unknown>) => ({
        projectIdentity: 'project',
        projectRevision: 'revision',
        result: { planId: 'plan-reviewed', received: input },
      })),
      commit: vi.fn(async (changeId: string, received: unknown) => ({
        projectIdentity: 'project',
        projectRevision: 'revision',
        changeId,
        result: { changeId, status: 'COMMITTED', files: [], received },
      })),
    } as unknown as AuthoringService;
    const reviewedInput = {
      candidateRefs: [{
        changeId: 'change-1',
        capsuleId: 'capsule-1',
        artifactSha256: 'a'.repeat(64),
      }, {
        changeId: 'change-2',
        capsuleId: 'capsule-2',
        artifactSha256: 'b'.repeat(64),
      }],
      comparisonFingerprint: 'b'.repeat(64),
      reviewDecision: {
        reviewId: 'review_comparison_1',
        decisionId: 'decision_1',
        decisionFingerprint: 'd'.repeat(64),
      },
    };

    await dispatchAuthoringCapability(
      invocationContext(root, 'stage'),
      'composition.plan',
      reviewedInput,
      service,
    );
    expect(service.planComposition).toHaveBeenCalledWith(root, reviewedInput);

    await dispatchAuthoringCapability(
      invocationContext(root, 'apply', 'change-integration'),
      'change.commit',
      { approvalRef },
      service,
    );
    expect(service.commit).toHaveBeenCalledWith('change-integration', approvalRef);
  });

  it('routes review inspection failures through the review error catalog', async () => {
    const root = makeProject('inspection');
    process.env['SURDET_AGENT_DATA_DIR'] = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-review-data-'));
    temporaryRoots.push(process.env['SURDET_AGENT_DATA_DIR']);
    await expect(dispatchAuthoringCapability(
      invocationContext(root, 'observe'),
      'review.inspect-decision',
      { reviewId: 'review_missing' },
      new AuthoringService(),
    )).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' });
  });

  it('returns structured after-human-review envelopes without retrying the same request', async () => {
    const root = makeProject('envelope');
    const service = {
      inspectReviewDecision: vi.fn(async () => {
        throw new AuthoringOperationError('REVIEW_DECISION_REQUIRED', '等待项目所有者决定');
      }),
      inspectApprovalReview: vi.fn(async () => {
        throw new AuthoringOperationError('REVIEW_APPROVAL_REQUIRED', '等待项目所有者批准');
      }),
    } as unknown as AuthoringService;
    const session = new AgentPortSession(
      'review-envelope',
      root,
      'project-identity',
      'observe',
      'project-revision',
      'envelope',
      '2026-08-27T00:00:00.000Z',
      false,
      undefined,
      service,
    );

    const decision = await session.invoke('review.inspect-decision', { reviewId: 'review_waiting' });
    expect(decision).toMatchObject({
      ok: false,
      error: {
        code: 'REVIEW_DECISION_REQUIRED',
        retryDisposition: 'after-human-review',
        repairActions: expect.any(Array),
      },
    });
    const approval = await session.invoke('review.inspect-approval', { resultReviewId: 'review_result_waiting' });
    expect(approval).toMatchObject({
      ok: false,
      error: {
        code: 'REVIEW_APPROVAL_REQUIRED',
        retryDisposition: 'after-human-review',
        repairActions: expect.any(Array),
      },
    });
    await session.close();
  });

  it('projects all four review readers and no agent-side receipt writers to MCP', async () => {
    const root = makeProject('mcp');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-agent-review-data-'));
    temporaryRoots.push(data);
    process.env['SURDET_AGENT_DATA_DIR'] = data;
    const session = await openAgentPortSession({ projectRoot: root, policy: 'stage' });
    const server = createAgentPortServer(session);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'agent-review-test', version: '0.1.0' });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining([
        'surdet_review_prepare_comparison',
        'surdet_review_inspect_decision',
        'surdet_review_prepare_result',
        'surdet_review_inspect_approval',
      ]));
      expect(names).not.toContain('surdet_review_write_decision');
      expect(names).not.toContain('surdet_review_approve');
    } finally {
      await client.close();
      await server.close();
      await session.close();
    }
  });
});
