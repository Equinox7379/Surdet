import { describe, expect, it } from 'vitest';
import type { ChangeRecord, TextHasher } from '../src/contracts.js';
import { stableStringify } from '../src/change-session.js';
import { buildCompositionManifest } from '../src/composition-manifest.js';
import type {
  ManifestObjectFacts,
  OperationInvocationFact,
} from '../src/composition-contracts.js';

const hasher: TextHasher = {
  sha256: async (text) => {
    // FNV-1a 32bit is sufficient for fixtures; production injects SHA-256.
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  },
};

function emptyRecord(): ChangeRecord {
  return {
    changeId: 'chg_wave5_fixture',
    formatVersion: 2,
    recordVersion: 1,
    projectRootIdentity: 'fixture-root',
    baseRevision: 'rev-base',
    workingRevision: 1,
    status: 'OPEN',
    baseFiles: {},
    baseContents: {},
    workingFiles: {},
    operations: {},
  };
}

const variableInput = {
  operationId: 'op_variable',
  name: 'agent.wave5.flag',
  type: 'int',
  initial: 0,
};

/** 旧式记录：operation 只有 requestHash/result；工作区也没有可反推的捷径。 */
function legacyRecord(): ChangeRecord {
  const record = emptyRecord();
  record.operations['op_old'] = { requestHash: 'hash-old', result: { ok: true } };
  return record;
}

function newRecord(): ChangeRecord {
  const record = emptyRecord();
  record.workingFiles['game.config.json'] = `${JSON.stringify({
    variables: {
      'agent.wave5.flag': { type: 'int', initial: 0 },
    },
  }, null, 2)}\n`;
  record.operations['op_variable'] = {
    requestHash: stableStringify(variableInput),
    normalizedInput: variableInput,
    result: { name: 'agent.wave5.flag', created: true },
  };
  return record;
}

async function successFact(operationId: string, requestHash: string): Promise<OperationInvocationFact> {
  return {
    capabilityId: 'variable.ensure',
    operationId,
    inputSha256: await hasher.sha256(requestHash),
    ok: true,
  };
}

function objectFacts(): ManifestObjectFacts {
  return {
    baseObjects: [],
    workingObjects: [
      { objectRef: 'variable:agent.wave5.flag', references: [] },
    ],
    baseAssetRefs: [],
    workingAssetRefs: [],
  };
}

describe('Wave 5 composition manifest sealing', () => {
  it('marks a legacy operation with only requestHash/result as unavailable MISSING_NORMALIZED_INPUT', async () => {
    const result = await buildCompositionManifest({
      record: legacyRecord(),
      projectIdentity: 'fixture-root',
      invocationFacts: [],
      semanticDiff: [],
      objectFacts: objectFacts(),
    }, hasher);
    expect(result.eligibility).toBe('unavailable');
    if (result.eligibility === 'ready') return;
    expect(result.reasons.map((reason) => reason.code)).toContain('MISSING_NORMALIZED_INPUT');
  });

  it('never reconstructs missing inputs from the semantic diff', async () => {
    const record = emptyRecord();
    record.operations['op_old'] = { requestHash: 'hash-old', result: { ok: true } };
    const result = await buildCompositionManifest({
      record,
      projectIdentity: 'fixture-root',
      invocationFacts: [
        { capabilityId: 'variable.ensure', operationId: 'op_old', inputSha256: 'hash-old-sha', ok: true },
      ],
      semanticDiff: [{
        kind: 'variable',
        objectAfter: 'variable:agent.wave5.flag',
        fingerprintAfter: 'cafe',
        operationId: 'op_old',
        directChange: { path: 'game.config.json' },
        potentialImpact: [],
        observedImpact: [],
      }],
      objectFacts: objectFacts(),
    }, hasher);
    expect(result.eligibility).toBe('unavailable');
    if (result.eligibility === 'ready') return;
    expect(result.reasons.map((reason) => reason.code)).toContain('MISSING_NORMALIZED_INPUT');
    expect(result.reasons.every((reason) => reason.code !== 'OBJECT_IDENTITY_UNAVAILABLE' || reason.operationId !== undefined)).toBe(true);
  });

  it('seals a deterministic manifest from a new record plus one unique successful invocation fact', async () => {
    const record = newRecord();
    const first = await buildCompositionManifest({
      record,
      projectIdentity: 'fixture-root',
      invocationFacts: [await successFact('op_variable', record.operations['op_variable']!.requestHash)],
      semanticDiff: [],
      objectFacts: objectFacts(),
    }, hasher);
    expect(first.eligibility).toBe('ready');
    if (first.eligibility !== 'ready') return;
    expect(first.manifest.manifestVersion).toBe('1.0.0');
    expect(first.manifest.projectIdentity).toBe('fixture-root');
    expect(first.manifest.sourceChangeId).toBe(record.changeId);
    expect(first.manifest.operations).toHaveLength(1);
    expect(first.manifest.operations[0]).toMatchObject({
      sequence: 0,
      capabilityId: 'variable.ensure',
      sourceOperationId: 'op_variable',
      primaryObject: 'variable:agent.wave5.flag',
    });
    expect(typeof first.manifest.manifestFingerprint).toBe('string');
    const second = await buildCompositionManifest({
      record,
      projectIdentity: 'fixture-root',
      invocationFacts: [await successFact('op_variable', record.operations['op_variable']!.requestHash)],
      semanticDiff: [],
      objectFacts: objectFacts(),
    }, hasher);
    expect(second.eligibility).toBe('ready');
    if (second.eligibility !== 'ready') return;
    expect(second.manifest).toEqual(first.manifest);
  });

  it('is unavailable when the successful invocation fact is missing or ambiguous', async () => {
    const record = newRecord();
    const requestHash = record.operations['op_variable']!.requestHash;
    const missing = await buildCompositionManifest({
      record,
      projectIdentity: 'fixture-root',
      invocationFacts: [],
      semanticDiff: [],
      objectFacts: objectFacts(),
    }, hasher);
    expect(missing.eligibility).toBe('unavailable');
    if (missing.eligibility !== 'ready') {
      expect(missing.reasons.map((reason) => reason.code)).toContain('INVOCATION_FACT_MISSING');
    }

    const ambiguous = await buildCompositionManifest({
      record,
      projectIdentity: 'fixture-root',
      invocationFacts: [
        await successFact('op_variable', requestHash),
        { capabilityId: 'character.ensure', operationId: 'op_variable', inputSha256: await hasher.sha256(requestHash), ok: true },
      ],
      semanticDiff: [],
      objectFacts: objectFacts(),
    }, hasher);
    expect(ambiguous.eligibility).toBe('unavailable');
    if (ambiguous.eligibility !== 'ready') {
      expect(ambiguous.reasons.map((reason) => reason.code)).toContain('INVOCATION_FACT_AMBIGUOUS');
    }
  });

  it('ignores failed invocations and never seals them into the manifest', async () => {
    const record = newRecord();
    const requestHash = record.operations['op_variable']!.requestHash;
    const onlyFailed = await buildCompositionManifest({
      record,
      projectIdentity: 'fixture-root',
      invocationFacts: [
        { capabilityId: 'variable.ensure', operationId: 'op_variable', inputSha256: await hasher.sha256(requestHash), ok: false },
      ],
      semanticDiff: [],
      objectFacts: objectFacts(),
    }, hasher);
    expect(onlyFailed.eligibility).toBe('unavailable');
    if (onlyFailed.eligibility !== 'ready') {
      expect(onlyFailed.reasons.map((reason) => reason.code)).toContain('INVOCATION_FACT_MISSING');
    }

    // 失败 invocation 只是噪声：不影响唯一成功 fact 的匹配，也不进入 manifest。
    const withFailedNoise = await buildCompositionManifest({
      record,
      projectIdentity: 'fixture-root',
      invocationFacts: [
        { capabilityId: 'scene.create', operationId: 'op_failed_elsewhere', inputSha256: 'deadbeef', ok: false },
        await successFact('op_variable', requestHash),
      ],
      semanticDiff: [],
      objectFacts: objectFacts(),
    }, hasher);
    expect(withFailedNoise.eligibility).toBe('ready');
    if (withFailedNoise.eligibility !== 'ready') return;
    expect(withFailedNoise.manifest.operations.map((operation) => operation.sourceOperationId)).toEqual(['op_variable']);
  });
});
