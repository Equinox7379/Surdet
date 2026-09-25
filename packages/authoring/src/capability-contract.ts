export const AUTHORING_CONTRACT_VERSION = '2.8.0' as const;
export const AUTHORING_ENVELOPE_SCHEMA_VERSION = '1.0.0' as const;
export const DELIVERY_CAPSULE_VERSION = '2.0.0' as const;

export type AutonomyPolicy = 'observe' | 'stage' | 'apply';
export type CapabilityAvailability = 'available' | 'policy-blocked' | 'state-blocked';
export type SideEffectClass =
  | 'none'
  | 'project-read'
  | 'authorized-source-read'
  | 'change-store-read'
  | 'change-store-write'
  | 'project-write'
  | 'runtime-process'
  | 'evidence-write';
export type IdempotencyClass = 'pure-read' | 'idempotent' | 'operation-id' | 'non-idempotent';
export type RetryDisposition =
  | 'same-request'
  | 'after-inspect'
  | 'after-refresh'
  | 'after-repair'
  | 'after-human-review'
  | 'new-change'
  | 'manual-recovery'
  | 'never';
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface EnvelopeContext {
  sessionId: string;
  capability: string;
  projectIdentity: string;
  projectRevision?: string;
  changeId?: string;
  workingRevision?: number;
  operationId?: string;
}

export interface EnvelopeRepairAction {
  capability?: string;
  reason: string;
  requiredFreshFacts?: string[];
  inputTemplate?: Readonly<Record<string, unknown>>;
  terminal?: boolean;
}

export interface EnvelopeErrorShape {
  code: string;
  category: string;
  message: string;
  details?: Record<string, unknown>;
  retryDisposition: RetryDisposition;
  repairActions: EnvelopeRepairAction[];
}

export type AuthoringEnvelope<T> =
  | (EnvelopeContext & {
      schemaVersion: typeof AUTHORING_ENVELOPE_SCHEMA_VERSION;
      contractVersion: typeof AUTHORING_CONTRACT_VERSION;
      ok: true;
      result: T;
    })
  | (EnvelopeContext & {
      schemaVersion: typeof AUTHORING_ENVELOPE_SCHEMA_VERSION;
      contractVersion: typeof AUTHORING_CONTRACT_VERSION;
      ok: false;
      error: EnvelopeErrorShape;
    });

export interface CapabilityDefinition<TId extends string = string> {
  id: TId;
  title: string;
  purpose: string;
  minimumPolicy: AutonomyPolicy;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  sideEffects: readonly SideEffectClass[];
  idempotency: IdempotencyClass;
  /** Wave 5：true 仅限八项内容 mutation capability；composition.* 编排能力必须为 false。 */
  composable: boolean;
  preconditions: readonly string[];
  possibleErrors: readonly string[];
  repairRecipes: readonly string[];
  minimalExample: {
    readonly input: Readonly<Record<string, unknown>>;
    readonly expectedResultShape: JsonSchema;
  };
}
