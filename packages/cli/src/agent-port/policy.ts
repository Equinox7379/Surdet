import {
  AUTHORING_CAPABILITY_REGISTRY,
  type AutonomyPolicy,
  type AuthoringCapabilityId,
  type CapabilityDefinition,
} from '@surdet/authoring';

export const POLICY_ORDER: Record<AutonomyPolicy, number> = {
  observe: 0,
  stage: 1,
  apply: 2,
};

export function isCapabilityAllowed(
  policy: AutonomyPolicy,
  definition: CapabilityDefinition,
): boolean {
  return POLICY_ORDER[policy] >= POLICY_ORDER[definition.minimumPolicy];
}

export function allowedCapabilitiesForPolicy(policy: AutonomyPolicy): AuthoringCapabilityId[] {
  return AUTHORING_CAPABILITY_REGISTRY
    .filter((definition) => isCapabilityAllowed(policy, definition))
    .map((definition) => definition.id);
}
