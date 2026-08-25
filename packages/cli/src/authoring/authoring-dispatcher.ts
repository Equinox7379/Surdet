import {
  AuthoringOperationError,
  getCapabilityDefinition,
  type AutonomyPolicy,
  type AuthoringCapabilityId,
  type ChangeIntentMetadata,
} from '@surdet/authoring';
import { AuthoringService, type ServiceResult } from './authoring-service.js';
import { validateCapabilityInput } from './schema-validator.js';

export interface InvocationContext {
  sessionId: string;
  policy: AutonomyPolicy;
  projectRoot?: string;
  activeChangeId?: string;
}

export interface DispatchResult {
  value: ServiceResult<unknown>;
  operationId?: string;
}

function requireProject(context: InvocationContext): string {
  if (context.projectRoot === undefined || context.projectRoot.length === 0) {
    throw new AuthoringOperationError('INVALID_REQUEST', '该 capability 需要显式 projectRoot context');
  }
  return context.projectRoot;
}

function requireChange(context: InvocationContext): string {
  if (context.activeChangeId === undefined || context.activeChangeId.length === 0) {
    throw new AuthoringOperationError('CHANGE_NOT_FOUND', '该 capability 需要 active change context');
  }
  return context.activeChangeId;
}

function operationIdFrom(input: Record<string, unknown>): string | undefined {
  return typeof input['operationId'] === 'string' ? input['operationId'] : undefined;
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AuthoringOperationError('INVALID_REQUEST', `${key} 必须是非空字符串`);
  }
  return value;
}

export async function dispatchAuthoringCapability(
  context: InvocationContext,
  capability: AuthoringCapabilityId,
  input: unknown,
  service = new AuthoringService(),
): Promise<DispatchResult> {
  const definition = (() => {
    try {
      return getCapabilityDefinition(capability);
    } catch {
      throw new AuthoringOperationError('CAPABILITY_UNAVAILABLE', `未知 authoring capability：${capability}`);
    }
  })();
  const payload = await validateCapabilityInput(definition.inputSchema, input);
  switch (capability) {
    case 'capabilities.describe':
      return { value: await service.describeCapabilities() };
    case 'project.inspect':
      return { value: await service.inspectProject(requireProject(context)) };
    case 'project.assets':
      return { value: await service.projectAssets(requireProject(context)) };
    case 'object.inspect':
      return {
        value: await service.inspectObject(
          requireProject(context),
          payload['objectRef'] as string,
          context.activeChangeId,
        ),
      };
    case 'change.begin':
      return { value: await service.begin(requireProject(context), payload as ChangeIntentMetadata) };
    case 'scene.create':
      return { value: await service.sceneCreate(requireChange(context), payload as unknown as Parameters<AuthoringService['sceneCreate']>[1]), operationId: operationIdFrom(payload) };
    case 'scene.patch':
      return { value: await service.scenePatch(requireChange(context), payload as unknown as Parameters<AuthoringService['scenePatch']>[1]), operationId: operationIdFrom(payload) };
    case 'variable.ensure':
      return { value: await service.variableEnsure(requireChange(context), payload as unknown as Parameters<AuthoringService['variableEnsure']>[1]), operationId: operationIdFrom(payload) };
    case 'character.ensure':
      return { value: await service.characterEnsure(requireChange(context), payload as unknown as Parameters<AuthoringService['characterEnsure']>[1]), operationId: operationIdFrom(payload) };
    case 'character.remove':
      return { value: await service.characterRemove(requireChange(context), payload as unknown as Parameters<AuthoringService['characterRemove']>[1]), operationId: operationIdFrom(payload) };
    case 'timeline.create':
      return { value: await service.timelineCreate(requireChange(context), payload as unknown as Parameters<AuthoringService['timelineCreate']>[1]), operationId: operationIdFrom(payload) };
    case 'timeline.patch':
      return { value: await service.timelinePatch(requireChange(context), payload as unknown as Parameters<AuthoringService['timelinePatch']>[1]), operationId: operationIdFrom(payload) };
    case 'project.entry-scene.set':
      return { value: await service.entrySceneSet(requireChange(context), payload as unknown as Parameters<AuthoringService['entrySceneSet']>[1]), operationId: operationIdFrom(payload) };
    case 'project.validate':
      return context.activeChangeId === undefined
        ? { value: await service.validateProject(requireProject(context)) }
        : { value: await service.validate(context.activeChangeId) };
    case 'project.simulate': {
      const sceneId = typeof payload['sceneId'] === 'string' ? payload['sceneId'] : undefined;
      const seed = typeof payload['seed'] === 'number' ? payload['seed'] : undefined;
      const input = { ...(sceneId === undefined ? {} : { sceneId }), ...(seed === undefined ? {} : { seed }) };
      return context.activeChangeId === undefined
        ? { value: await service.simulateProject(requireProject(context), Object.keys(input).length === 0 ? undefined : input) }
        : { value: await service.simulate(context.activeChangeId, Object.keys(input).length === 0 ? undefined : input) };
    }
    case 'runtime.run-from':
      return { value: await service.runFrom(requireChange(context), payload) };
    case 'runtime.read-trace':
      return {
        value: await service.readTrace(
          requireChange(context),
          payload['traceId'] as string,
          (payload['query'] ?? {}) as Parameters<AuthoringService['readTrace']>[2],
        ),
      };
    case 'change.diff':
      return { value: await service.diff(requireChange(context)) };
    case 'change.commit':
      return { value: await service.commit(requireChange(context)) };
    case 'change.rollback':
      return { value: await service.rollback(requireChange(context)) };
    case 'change.recovery.inspect':
      return { value: await service.inspectRecovery(requireChange(context)) };
    case 'change.recovery.execute': {
      const operationId = requireString(payload, 'operationId');
      return {
        value: await service.executeRecovery(requireChange(context), {
          operationId,
          recoveryToken: requireString(payload, 'recoveryToken'),
        }),
        operationId,
      };
    }
    // Wave 5：composition.* 薄投影——依赖、冲突、plan、replay 一律在 CompositionService 内计算。
    case 'composition.compare':
      return { value: await service.compareComposition(requireProject(context), payload) };
    case 'composition.plan':
      return { value: await service.planComposition(requireProject(context), payload) };
    case 'composition.inspect':
      return { value: await service.inspectComposition(requireProject(context), payload) };
    case 'composition.execute':
      return {
        value: await service.executeComposition(
          requireProject(context),
          context.activeChangeId,
          payload,
        ),
        operationId: operationIdFrom(payload),
      };
  }
}
