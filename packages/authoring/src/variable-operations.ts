import { VariableStore, type VarDeclaration, type VarValue } from '@surdet/core';
import {
  AuthoringOperationError,
  runOperation,
  stableStringify,
  type ChangeSession,
} from './change-session.js';
import { parseProjectConfigDocument, serializeProjectConfigDocument } from './config-document.js';
import type { LedgerDiffEntry, TextHasher, VariablePatchInitialInput } from './contracts.js';
import { buildVariableOperationCompositionDraft, compositionTextHasher } from './operation-composition-facts.js';

const CONFIG_PATH = 'game.config.json';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coreDeclaration(
  name: string,
  existing: Record<string, unknown>,
  initial: unknown,
): VarDeclaration {
  return {
    name,
    type: existing['type'] as VarDeclaration['type'],
    initial: initial as VarValue,
    ...(existing['readonly'] === undefined ? {} : { readonly: existing['readonly'] as boolean }),
    ...(existing['min'] === undefined ? {} : { min: existing['min'] as number }),
    ...(existing['max'] === undefined ? {} : { max: existing['max'] as number }),
  };
}

function validateInitial(name: string, existing: Record<string, unknown>, initial: unknown): void {
  try {
    // VariableStore is the single runtime type/JSON-safety authority. Its
    // constructor intentionally leaves declaration initial values unclamped;
    // the authoring contract rejects numeric range violations explicitly.
    new VariableStore([coreDeclaration(name, existing, initial)]);
  } catch (error) {
    throw new AuthoringOperationError(
      'VALIDATION_FAILED',
      `变量 '${name}' 的初值不符合 Core 类型规则：${error instanceof Error ? error.message : String(error)}`,
      { name, type: existing['type'] },
    );
  }

  if (existing['type'] !== 'number' || typeof initial !== 'number') return;
  const min = existing['min'];
  const max = existing['max'];
  if (typeof min === 'number' && initial < min) {
    throw new AuthoringOperationError('VALIDATION_FAILED', `变量 '${name}' 的初值 ${initial} 小于 min ${min}；authoring 不会自动 clamp`);
  }
  if (typeof max === 'number' && initial > max) {
    throw new AuthoringOperationError('VALIDATION_FAILED', `变量 '${name}' 的初值 ${initial} 大于 max ${max}；authoring 不会自动 clamp`);
  }
}

export interface VariablePatchInitialResult {
  name: string;
  objectRef: string;
  fingerprint: string;
  diffEntry: LedgerDiffEntry;
}

export async function applyVariablePatchInitial(
  change: ChangeSession,
  input: VariablePatchInitialInput,
  hasher: TextHasher = compositionTextHasher,
): Promise<VariablePatchInitialResult> {
  return runOperation<VariablePatchInitialResult>(change, input, async (record) => {
    const source = record.workingFiles[CONFIG_PATH] ?? '{}';
    const config = parseProjectConfigDocument(source);
    const variablesValue = config['variables'];
    if (variablesValue === undefined) {
      throw new AuthoringOperationError('OBJECT_NOT_FOUND', `变量不存在：${input.name}`);
    }
    if (!isRecord(variablesValue)) {
      throw new AuthoringOperationError('PROJECT_INVALID', 'game.config.json.variables 必须是对象');
    }
    if (!Object.prototype.hasOwnProperty.call(variablesValue, input.name)) {
      throw new AuthoringOperationError('OBJECT_NOT_FOUND', `变量不存在：${input.name}`);
    }
    const existingValue = variablesValue[input.name];
    if (!isRecord(existingValue)) {
      throw new AuthoringOperationError('PROJECT_INVALID', `变量声明不是对象：${input.name}`);
    }

    const fingerprintBefore = await hasher.sha256(stableStringify(existingValue));
    if (input.expectedFingerprint !== fingerprintBefore) {
      throw new AuthoringOperationError('OBJECT_REF_STALE', `变量指纹不匹配：${input.name}`);
    }
    validateInitial(input.name, existingValue, input.initial);

    const nextDeclaration = { ...existingValue, initial: input.initial };
    const fingerprint = await hasher.sha256(stableStringify(nextDeclaration));
    const objectRef = `variable:${input.name}`;
    const diffEntry: LedgerDiffEntry = {
      kind: 'variable.patch-initial',
      operationId: input.operationId,
      objectBefore: objectRef,
      objectAfter: objectRef,
      fingerprintBefore,
      fingerprintAfter: fingerprint,
      directChange: {
        path: CONFIG_PATH,
        variable: input.name,
        field: 'initial',
        before: existingValue['initial'],
        after: input.initial,
      },
      potentialImpact: [],
      observedImpact: [],
    };
    const nextConfig = {
      ...config,
      variables: { ...variablesValue, [input.name]: nextDeclaration },
    };
    return {
      result: { name: input.name, objectRef, fingerprint, diffEntry },
      compositionDraft: await buildVariableOperationCompositionDraft({
        capabilityId: 'variable.patch-initial',
        name: input.name,
        declaration: nextDeclaration,
        existing: existingValue,
        hasher,
      }),
      workingFiles: {
        ...record.workingFiles,
        [CONFIG_PATH]: serializeProjectConfigDocument(nextConfig, source),
      },
    };
  });
}
