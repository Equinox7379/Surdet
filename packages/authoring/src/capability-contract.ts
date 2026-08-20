export const AUTHORING_CONTRACT_VERSION = '1.0.0' as const;
export const AUTHORING_ENVELOPE_SCHEMA_VERSION = '1.0.0' as const;
export const DELIVERY_CAPSULE_VERSION = '1.0.0' as const;

export type AutonomyPolicy = 'observe' | 'stage' | 'apply';
export type CapabilityAvailability = 'available' | 'policy-blocked' | 'state-blocked';
export type SideEffectClass =
  | 'none'
  | 'project-read'
  | 'change-store-read'
  | 'change-store-write'
  | 'project-write'
  | 'runtime-process'
  | 'evidence-write';
export type IdempotencyClass = 'pure-read' | 'idempotent' | 'operation-id' | 'non-idempotent';
export type RetryDisposition =
  | 'same-request'
  | 'after-inspect'
  | 'after-repair'
  | 'new-change'
  | 'manual-recovery'
  | 'never';
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface CapabilityDefinition<TId extends string = string> {
  id: TId;
  title: string;
  purpose: string;
  minimumPolicy: AutonomyPolicy;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  sideEffects: readonly SideEffectClass[];
  idempotency: IdempotencyClass;
  preconditions: readonly string[];
  possibleErrors: readonly string[];
  repairRecipes: readonly string[];
  minimalExample: {
    readonly input: Readonly<Record<string, unknown>>;
    readonly expectedResultShape: JsonSchema;
  };
}
