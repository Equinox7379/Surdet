import { describe, expect, it, vi } from 'vitest';
import type { ReviewDecisionPreview, ReviewTerminalCommand, ReviewTerminalSnapshot } from '@surdet/authoring';
import {
  createReviewTerminalClient,
  ReviewAuthorityClientError,
  type ReviewAuthorityBrowserConfig,
} from '../src/review-terminal-client.js';

const config: ReviewAuthorityBrowserConfig = {
  protocolVersion: '1.0.0',
  endpoint: '/__surdet/review-authority/v1',
  token: 'browser-test-token',
};
const describeInput = {
  projectIdentity: 'project-1',
  reviewId: 'review-1',
  reviewPayload: { bytes: 123, sha256: 'a'.repeat(64) },
};
const receipt = {
  receiptVersion: '1.0.0',
  decisionId: 'decision-1',
  reviewId: 'review-1',
  decisionFingerprint: 'b'.repeat(64),
};
const command: ReviewTerminalCommand = {
  protocolVersion: '1.0.0',
  requestId: 'request-1',
  ...describeInput,
  action: 'comparison-decision',
  receipt,
};
const openSnapshot: ReviewTerminalSnapshot = {
  protocolVersion: '1.0.0',
  projectIdentity: 'project-1',
  reviewId: 'review-1',
  state: 'open',
};
const writtenSnapshot: ReviewTerminalSnapshot = {
  ...openSnapshot,
  state: 'decision-written',
  record: {
    action: 'comparison-decision',
    file: 'decision.json',
    bytes: 200,
    sha256: 'c'.repeat(64),
    receipt,
  },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ReviewTerminalClient', () => {
  it('keeps a real busy response as a business error instead of reporting an invalid envelope', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ ok: false, error: {
      code: 'PROJECT_BUSY', message: '项目正在处理其他操作',
    } }, 400));
    const client = createReviewTerminalClient({ configuration: config, fetcher });
    await expect(client.describe(describeInput)).rejects.toMatchObject({ code: 'PROJECT_BUSY' });
  });

  it('uses the existing protected transport for readonly previews and rejects a reply for another decision', async () => {
    const input = { ...describeInput, decisionIntent: { mode: 'custom-mix' as const }, customSelection: { selectedUnitIds: [], conflictResolutions: [] } };
    const preview: ReviewDecisionPreview = {
      previewVersion: '1.0.0', reviewId: input.reviewId, reviewFingerprint: 'a'.repeat(64), comparisonFingerprint: 'b'.repeat(64), decisionIntent: input.decisionIntent,
      status: 'ready', selectedUnitIds: [], conflictResolutions: [], effectiveUnitIds: [], implicitInclusions: [], excludedUnitIds: [],
      planContentFingerprint: 'c'.repeat(64), dryRun: { status: 'passed', finalObjectFingerprints: {}, errors: [] }, previewFingerprint: 'd'.repeat(64),
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ ok: true, result: preview }))
      .mockResolvedValueOnce(response({ ok: true, result: { ...preview, reviewId: 'foreign-review' } }))
      .mockResolvedValueOnce(response({ ok: true, result: { ...preview, decisionIntent: { mode: 'adopt-candidate', candidate: { candidateId: 'a', ref: { changeId: 'change-a', capsuleId: 'capsule-a', artifactSha256: 'e'.repeat(64) } } } } }));
    const client = createReviewTerminalClient({ configuration: config, fetcher });
    await expect(client.previewDecision!(input)).resolves.toEqual(preview);
    expect(fetcher.mock.calls[0]![0]).toBe(`${config.endpoint}/preview-decision`);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'POST', body: JSON.stringify(input) });
    expect(new Headers(fetcher.mock.calls[0]![1]?.headers).get('X-Surdet-Review-Authority')).toBe(config.token);
    await expect(client.previewDecision!(input)).rejects.toMatchObject({ code: 'REVIEW_AUTHORITY_INVALID_RESPONSE' });
    await expect(client.previewDecision!(input)).rejects.toMatchObject({ code: 'REVIEW_AUTHORITY_INVALID_RESPONSE' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('reports unavailable without injected configuration and performs no fetch', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createReviewTerminalClient({ configuration: null, fetcher });
    await expect(client.status()).resolves.toBe('unavailable');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses exact same-origin routes and token headers for status, describe, and write', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ok: true, result: { protocolVersion: '1.0.0', status: 'available' } }))
      .mockResolvedValueOnce(response({ ok: true, result: openSnapshot }))
      .mockResolvedValueOnce(response({ ok: true, result: writtenSnapshot }));
    const client = createReviewTerminalClient({ configuration: config, fetcher });

    await expect(client.status()).resolves.toBe('available');
    await expect(client.describe(describeInput)).resolves.toEqual(openSnapshot);
    await expect(client.write(command)).resolves.toEqual(writtenSnapshot);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
      `${config.endpoint}/status`,
      `${config.endpoint}/describe`,
      `${config.endpoint}/write`,
    ]);
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init?.headers).get('X-Surdet-Review-Authority')).toBe(config.token);
    }
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify(describeInput) });
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify(command) });
  });

  it('rejects malformed success and error envelopes without trusting extra fields', async () => {
    const malformedSuccess = createReviewTerminalClient({
      configuration: config,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response({ ok: true, result: { ...openSnapshot, extra: true } })),
    });
    await expect(malformedSuccess.describe(describeInput)).rejects.toMatchObject({ code: 'REVIEW_AUTHORITY_INVALID_RESPONSE' });

    const malformedError = createReviewTerminalClient({
      configuration: config,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(response({
        ok: false,
        error: { code: 'REVIEW_BUSY', message: 'busy', details: { secret: true } },
      }, 409)),
    });
    await expect(malformedError.write(command)).rejects.toMatchObject({ code: 'REVIEW_AUTHORITY_INVALID_RESPONSE' });
  });

  it('preserves a structured business error when describe still reports open', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ok: false, error: { code: 'REVIEW_BUSY', message: '请稍候' } }, 409))
      .mockResolvedValueOnce(response({ ok: true, result: openSnapshot }));
    const client = createReviewTerminalClient({ configuration: config, fetcher });
    await expect(client.write(command)).rejects.toEqual(expect.objectContaining({
      code: 'REVIEW_BUSY',
      message: '请稍候',
    }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('resolves an uncertain write by describing the exact persisted receipt without minting another command', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('connection closed after commit'))
      .mockResolvedValueOnce(response({ ok: true, result: writtenSnapshot }));
    const client = createReviewTerminalClient({ configuration: config, fetcher });
    await expect(client.write(command)).resolves.toEqual(writtenSnapshot);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(command));
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(describeInput));
  });

  it('maps an unavailable or timed-out transport to one Chinese client error', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const client = createReviewTerminalClient({ configuration: config, fetcher, timeoutMs: 10 });
    const error = await client.describe(describeInput).then(() => null, (candidate: unknown) => candidate);
    expect(error).toBeInstanceOf(ReviewAuthorityClientError);
    expect(error).toMatchObject({
      code: 'REVIEW_AUTHORITY_UNAVAILABLE',
      message: '本机审阅服务未连接。',
    });
  });
});
