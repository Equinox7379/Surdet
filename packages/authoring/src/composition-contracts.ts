import type { ChangeStatus } from './contracts.js';

/** 5.1 JSON 与记录操作 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

/** 可进入确定性重放的八项内容 mutation；registry composable 白名单与之严格一致。 */
export type ComposableCapabilityId =
  | 'scene.create'
  | 'scene.patch'
  | 'variable.ensure'
  | 'character.ensure'
  | 'character.remove'
  | 'timeline.create'
  | 'timeline.patch'
  | 'project.entry-scene.set';

/** operation ledger 记录；normalizedInput 仅新记录拥有，旧记录只读保留。 */
export interface RecordedOperation {
  requestHash: string;
  normalizedInput?: JsonValue;
  result: unknown;
}

export const COMPOSABLE_CAPABILITY_IDS: readonly ComposableCapabilityId[] = [
  'scene.create',
  'scene.patch',
  'variable.ensure',
  'character.ensure',
  'character.remove',
  'timeline.create',
  'timeline.patch',
  'project.entry-scene.set',
];

/** 5.2 Manifest 与对象关系 */
export interface ObjectRequirement {
  objectRef: string;
  source: 'base' | 'candidate';
  candidateOperationSequence?: number;
  expectedFingerprint?: string;
}

export interface ObjectProduction {
  objectRef: string;
  disposition: 'create' | 'update' | 'remove';
  finalFingerprint?: string;
}

export interface CompositionOperation {
  sequence: number;
  capabilityId: ComposableCapabilityId;
  sourceOperationId: string;
  normalizedInput: JsonValue;
  inputSha256: string;
  primaryObject: string;
  objectFingerprintBefore?: string;
  objectFingerprintAfter?: string;
  requiredObjects: ObjectRequirement[];
  producedObjects: ObjectProduction[];
}

export interface CompositionManifest {
  manifestVersion: '1.0.0';
  projectIdentity: string;
  baseProjectRevision: string;
  sourceChangeId: string;
  sourceWorkingRevision: number;
  operations: CompositionOperation[];
  manifestFingerprint: string;
}

export interface CompositionIneligibility {
  code:
    | 'LEGACY_CAPSULE'
    | 'MISSING_NORMALIZED_INPUT'
    | 'INVOCATION_FACT_MISSING'
    | 'INVOCATION_FACT_AMBIGUOUS'
    | 'UNSUPPORTED_CAPABILITY'
    | 'OBJECT_IDENTITY_UNAVAILABLE'
    | 'DEPENDENCY_IDENTITY_UNAVAILABLE';
  operationId?: string;
  message: string;
}

export interface ManifestObjectFact {
  objectRef: string;
  references: string[];
  fingerprint?: string;
}

export interface ManifestObjectFacts {
  baseObjects: ManifestObjectFact[];
  workingObjects: ManifestObjectFact[];
  baseAssetRefs: string[];
  workingAssetRefs: string[];
}

/** CLI 将 invocation ledger 投影成的最小结构；@surdet/authoring 不导入 Node 或 MCP 类型。 */
export interface OperationInvocationFact {
  capabilityId: string;
  operationId: string;
  inputSha256: string;
  ok: boolean;
}

/** 5.3 Capsule v2 组合投影 */
export interface CapsuleCompositionProjection {
  eligibility: 'ready' | 'unavailable';
  reasons: CompositionIneligibility[];
  manifest?: CompositionManifest;
}
