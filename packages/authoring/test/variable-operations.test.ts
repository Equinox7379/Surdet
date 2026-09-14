import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import {
  InMemoryChangeRepository,
  beginChange,
  openChange,
  stableStringify,
} from '../src/change-session.js';
import { buildReplayStateBaseObjects } from '../src/composition-object-facts.js';
import { createCandidateOperationPrePersistHook } from '../src/candidate-composition-guard.js';
import { inspectCandidateCompositionReadiness } from '../src/candidate-readiness.js';
import { applyVariablePatchInitial } from '../src/variable-operations.js';

const hasher: TextHasher = {
  sha256: async (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
};

function fixtureStorage(configText: string): ProjectStorage {
  const contents: Record<string, string> = {
    'game.config.json': configText,
    'content/scenario/prologue.gal': '@scene prologue\n@end\n',
  };
  return {
    rootIdentity: 'variable-fixture',
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error(`missing fixture file: ${path}`);
      return { path, text, bytes: Buffer.byteLength(text, 'utf8'), sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

function configWithVariable(name: string, declaration: Record<string, unknown>): string {
  return `${JSON.stringify({
    entryScene: 'prologue',
    variables: {
      [name]: declaration,
      untouched: { type: 'string', initial: 'keep' },
    },
  }, null, 2)}\n`;
}

async function beginVariableChange(configText: string, options?: Parameters<typeof beginChange>[4]) {
  const storage = fixtureStorage(configText);
  const snapshot = await loadProjectSnapshot(storage, hasher);
  const repository = new InMemoryChangeRepository();
  const change = await beginChange(snapshot, repository, undefined, undefined, options);
  return { storage, snapshot, repository, change };
}

async function expectedFingerprint(declaration: Record<string, unknown>): Promise<string> {
  return hasher.sha256(stableStringify(declaration));
}

describe('variable.patch-initial', () => {
  it('updates only initial, preserves declaration fields and persists idempotently', async () => {
    const declaration = {
      type: 'number', initial: 2, readonly: true, min: 0, max: 10,
      description: 'keep this', unknownField: { enabled: true },
    };
    const source = configWithVariable('score', declaration);
    const { storage, repository, change } = await beginVariableChange(source);
    const input = {
      operationId: 'variable-initial-1', name: 'score',
      expectedFingerprint: await expectedFingerprint(declaration), initial: 7,
    };

    const result = await applyVariablePatchInitial(change, input, hasher);
    expect(result).toMatchObject({ name: 'score', objectRef: 'variable:score', fingerprint: expect.any(String) });
    expect(result.diffEntry).toMatchObject({
      kind: 'variable.patch-initial', operationId: input.operationId,
      objectBefore: 'variable:score', objectAfter: 'variable:score',
      fingerprintBefore: input.expectedFingerprint,
      directChange: { path: 'game.config.json', variable: 'score', field: 'initial', before: 2, after: 7 },
    });
    const working = JSON.parse(change.record.workingFiles['game.config.json']!) as Record<string, any>;
    expect(working.variables.score).toEqual({ ...declaration, initial: 7 });
    expect(working.variables.untouched).toEqual({ type: 'string', initial: 'keep' });
    expect(working.variables.score.readonly).toBe(true);
    expect((await storage.readText('game.config.json')).text).toBe(source);

    const reopened = openChange((await repository.read(change.record.changeId))!, repository);
    expect(await applyVariablePatchInitial(reopened, input, hasher)).toEqual(result);
    expect(reopened.record.workingRevision).toBe(1);
    expect(Object.keys(reopened.record.operations)).toEqual([input.operationId]);
    await expect(applyVariablePatchInitial(reopened, { ...input, initial: 8 }, hasher))
      .rejects.toMatchObject({ code: 'OPERATION_ID_CONFLICT' });
    await expect(applyVariablePatchInitial(reopened, {
      ...input, operationId: 'variable-initial-competing', initial: 8,
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(reopened.record.workingRevision).toBe(1);
  });

  it('rejects absent variables and stale fingerprints without creating or changing source data', async () => {
    const declaration = { type: 'string', initial: 'base' };
    const source = configWithVariable('present', declaration);
    const { storage, change } = await beginVariableChange(source);
    const beforeRecord = JSON.parse(JSON.stringify(change.record));

    await expect(applyVariablePatchInitial(change, {
      operationId: 'missing-variable', name: 'missing', expectedFingerprint: '0'.repeat(64), initial: 'new',
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND' });
    expect(change.record).toEqual(beforeRecord);
    expect((await storage.readText('game.config.json')).text).toBe(source);

    await expect(applyVariablePatchInitial(change, {
      operationId: 'stale-variable', name: 'present', expectedFingerprint: 'f'.repeat(64), initial: 'new',
    }, hasher)).rejects.toMatchObject({ code: 'OBJECT_REF_STALE' });
    expect(change.record).toEqual(beforeRecord);
    expect((await storage.readText('game.config.json')).text).toBe(source);
  });

  it.each([
    { label: 'number outside min', type: 'number', current: 2, initial: -1, code: 'VALIDATION_FAILED' },
    { label: 'wrong scalar type', type: 'number', current: 2, initial: '2', code: 'VALIDATION_FAILED' },
    { label: 'wrong array element type', type: 'number[]', current: [1], initial: [1, '2'], code: 'VALIDATION_FAILED' },
    { label: 'wrong object shape', type: 'object', current: { ok: true }, initial: [true], code: 'VALIDATION_FAILED' },
    { label: 'non-finite number', type: 'number', current: 2, initial: Number.NaN, code: 'INVALID_REQUEST' },
  ] as const)('rejects $label before any write', async ({ type, current, initial, code }) => {
    const declaration = { type, initial: current, ...(type === 'number' ? { min: 0, max: 10 } : {}) };
    const source = configWithVariable('checked', declaration);
    const { storage, change } = await beginVariableChange(source);
    const beforeRecord = JSON.parse(JSON.stringify(change.record));
    const fingerprint = await expectedFingerprint(declaration);

    await expect(applyVariablePatchInitial(change, {
      operationId: `reject-${type}-${code}`, name: 'checked', expectedFingerprint: fingerprint, initial,
    }, hasher)).rejects.toMatchObject({ code });
    expect(change.record).toEqual(beforeRecord);
    expect((await storage.readText('game.config.json')).text).toBe(source);
  });

  it('records a candidate replay precondition for the original declaration fingerprint', async () => {
    const declaration = { type: 'number', initial: 2, readonly: true, min: 0, max: 10 };
    const source = configWithVariable('score', declaration);
    const storage = fixtureStorage(source);
    const snapshot = await loadProjectSnapshot(storage, hasher);
    const repository = new InMemoryChangeRepository();
    const change = await beginChange(snapshot, repository, undefined, undefined, {
      composition: { mode: 'candidate', operationFactsVersion: '1.0.0', baseAssetRefs: [] },
      beforeOperationPersist: createCandidateOperationPrePersistHook({
        baseObjects: [], baseAssetRefs: [], baseReplayStates: await buildReplayStateBaseObjects(snapshot, hasher),
      }),
    });
    const input = {
      operationId: 'candidate-variable-initial', name: 'score',
      expectedFingerprint: await expectedFingerprint(declaration), initial: 6,
    };

    await applyVariablePatchInitial(change, input, hasher);
    const facts = change.record.operations[input.operationId]?.compositionFacts;
    expect(facts).toMatchObject({
      capabilityId: 'variable.patch-initial',
      primaryObject: 'variable:score',
      objectFingerprintBefore: input.expectedFingerprint,
      replayStatePreconditions: [{ objectRef: 'variable:score', expectedFingerprint: input.expectedFingerprint }],
      replayStateRequirements: [{ objectRef: 'variable:score', source: 'base', expectedFingerprint: input.expectedFingerprint }],
      producedObjects: [{ objectRef: 'variable:score', disposition: 'update' }],
    });
    expect(inspectCandidateCompositionReadiness(change.record)).toMatchObject({ status: 'ready', issueCount: 0 });
  });

  it('does not let an invalid source declaration bypass the existing Core validator', async () => {
    const declaration = { type: 'number', initial: 2, min: 10, max: 0 };
    const source = configWithVariable('invalid', declaration);
    const { storage, change } = await beginVariableChange(source);
    const beforeRecord = JSON.parse(JSON.stringify(change.record));

    await expect(applyVariablePatchInitial(change, {
      operationId: 'invalid-source', name: 'invalid', expectedFingerprint: await expectedFingerprint(declaration), initial: 5,
    }, hasher)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(change.record).toEqual(beforeRecord);
    expect((await storage.readText('game.config.json')).text).toBe(source);
  });
});
