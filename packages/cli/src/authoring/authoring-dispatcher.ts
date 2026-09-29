import type { StageConfigPatchInput } from '@surdet/authoring';
import {
  AuthoringOperationError,
  getCapabilityDefinition,
  type AutonomyPolicy,
  type AuthoringCapabilityId,
  type ChangeIntentMetadata,
} from '@surdet/authoring';
import { AuthoringService, type ServiceResult } from './authoring-service.js';
import { validateCapabilityInput } from './schema-validator.js';
import type { AuthorizedImageSource } from './agent-image-import-service.js';
import { isCapabilityAllowed } from '../agent-port/policy.js';

export interface InvocationContext {
  sessionId: string;
  policy: AutonomyPolicy;
  projectRoot?: string;
  activeChangeId?: string;
  assetSources?: readonly AuthorizedImageSource[];
  assetImportDataRoot?: string;
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

function readChange(context: InvocationContext, input: Record<string, unknown>, defaultWorking: boolean): string | undefined {
  if (input['view'] === 'working') return requireChange(context);
  if (input['view'] === 'project') return undefined;
  return defaultWorking ? context.activeChangeId : undefined;
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
  if (!isCapabilityAllowed(context.policy, definition)) throw new AuthoringOperationError('POLICY_BLOCKED', `当前 policy 不允许 ${capability}`);
  switch (capability) {
    case 'capabilities.describe':
      return { value: await service.describeCapabilities(payload as { ids?: string[]; detail?: 'summary' | 'full' }) };
    case 'project.inspect':
      return { value: await service.inspectProject(requireProject(context), readChange(context, payload, false)) };
    case 'project.ui':
      return { value: await service.projectUi(requireProject(context), readChange(context, payload, false)) };
    case 'project.texts':
      return { value: await service.projectTexts(requireProject(context), payload, readChange(context, payload, false)) };
    case 'project.texts.import.preview':
      return { value: await service.textsImportPreview(requireProject(context), payload as unknown as Parameters<AuthoringService['textsImportPreview']>[1], readChange(context, payload, false)) };
    case 'project.texts.patch':
      return { value: await service.textsPatch(requireChange(context), payload as unknown as Parameters<AuthoringService['textsPatch']>[1]), operationId: operationIdFrom(payload) };
    case 'project.assets':
      return { value: await service.projectAssets(requireProject(context), readChange(context, payload, false)) };
    case 'project.gallery':
      return { value: await service.projectGallery(requireProject(context), readChange(context, payload, true)) };
    case 'script.import.preview':
      return { value: await service.scriptImportPreview(requireProject(context), payload as unknown as Parameters<AuthoringService['scriptImportPreview']>[1], readChange(context, payload, true)) };
    case 'asset.sources':
    case 'asset.import.stage':
    case 'asset.import.inspect':
    case 'asset.import.commit':
    case 'asset.relocation.replace':
    case 'asset.relocation.plan':
    case 'asset.relocation.inspect':
    case 'asset.relocation.commit':
    case 'asset.relocation.cancel':
    case 'asset.relocation.recover':
    case 'asset.relocation.undo':
    case 'asset.import.recover': {
      if (context.activeChangeId !== undefined && capability !== 'asset.sources' && capability !== 'asset.import.inspect' && capability !== 'asset.relocation.inspect') {
        throw new AuthoringOperationError('SESSION_STATE_INVALID', '先完成素材导入、重新读取项目，再创建剧情 change；已有 change 时不能导入素材。');
      }
      return { value: await service.invokeImageImport(requireProject(context), capability, payload, context.assetSources ?? [], context.assetImportDataRoot), operationId: operationIdFrom(payload) };
    }
    case 'object.inspect':
      return {
        value: await service.inspectObject(
          requireProject(context),
          payload['objectRef'] as string,
          readChange(context, payload, true),
          payload['fragment'] as Parameters<AuthoringService['inspectObject']>[3],
        ),
      };
    case 'change.begin':
      return { value: await service.begin(requireProject(context), {
        ...(payload['intent'] === undefined ? {} : { intent: payload['intent'] as string }),
        ...(payload['acceptanceCriteria'] === undefined ? {} : { acceptanceCriteria: payload['acceptanceCriteria'] as string[] }),
        ...(payload['initiator'] === undefined ? {} : { initiator: payload['initiator'] as ChangeIntentMetadata['initiator'] }),
      }, { compositionMode: (payload['compositionMode'] as 'direct' | 'candidate' | undefined) ?? (context.policy === 'stage' ? 'candidate' : 'direct') }) };
    case 'scene.create':
      return { value: await service.sceneCreate(requireChange(context), payload as unknown as Parameters<AuthoringService['sceneCreate']>[1]), operationId: operationIdFrom(payload) };
    case 'scene.remove':
      return { value: await service.sceneRemove(requireChange(context), payload as unknown as Parameters<AuthoringService['sceneRemove']>[1]), operationId: operationIdFrom(payload) };
    case 'scene.patch':
      return { value: await service.scenePatch(requireChange(context), payload as unknown as Parameters<AuthoringService['scenePatch']>[1]), operationId: operationIdFrom(payload) };
    case 'scene.rename':
      return { value: await service.sceneRename(requireChange(context), payload as unknown as Parameters<AuthoringService['sceneRename']>[1]), operationId: operationIdFrom(payload) };
    case 'scene.move':
      return { value: await service.sceneMove(requireChange(context), payload as unknown as Parameters<AuthoringService['sceneMove']>[1]), operationId: operationIdFrom(payload) };
    case 'variable.ensure':
      return { value: await service.variableEnsure(requireChange(context), payload as unknown as Parameters<AuthoringService['variableEnsure']>[1]), operationId: operationIdFrom(payload) };
    case 'variable.patch-initial':
      return { value: await service.variablePatchInitial(requireChange(context), payload as unknown as Parameters<AuthoringService['variablePatchInitial']>[1]), operationId: operationIdFrom(payload) };
    case 'character.ensure':
      return { value: await service.characterEnsure(requireChange(context), payload as unknown as Parameters<AuthoringService['characterEnsure']>[1]), operationId: operationIdFrom(payload) };
    case 'gallery.cg.create':
      return { value: await service.galleryCgCreate(requireChange(context), payload as unknown as Parameters<AuthoringService['galleryCgCreate']>[1]), operationId: operationIdFrom(payload) };
    case 'gallery.cg.patch':
      return { value: await service.galleryCgPatch(requireChange(context), payload as unknown as Parameters<AuthoringService['galleryCgPatch']>[1]), operationId: operationIdFrom(payload) };
    case 'character.remove':
      return { value: await service.characterRemove(requireChange(context), payload as unknown as Parameters<AuthoringService['characterRemove']>[1]), operationId: operationIdFrom(payload) };
    case 'timeline.create':
      return { value: await service.timelineCreate(requireChange(context), payload as unknown as Parameters<AuthoringService['timelineCreate']>[1]), operationId: operationIdFrom(payload) };
    case 'timeline.patch':
      return { value: await service.timelinePatch(requireChange(context), payload as unknown as Parameters<AuthoringService['timelinePatch']>[1]), operationId: operationIdFrom(payload) };
    case 'project.entry-scene.set':
      return { value: await service.entrySceneSet(requireChange(context), payload as unknown as Parameters<AuthoringService['entrySceneSet']>[1]), operationId: operationIdFrom(payload) };
    case 'project.stage-config.patch':
      return { value: await service.stageConfigPatch(requireChange(context), payload as unknown as Parameters<AuthoringService['stageConfigPatch']>[1]), operationId: operationIdFrom(payload) };
    case 'project.player-config.patch':
      return { value: await service.playerConfigPatch(requireChange(context), payload as unknown as Parameters<AuthoringService['playerConfigPatch']>[1]), operationId: operationIdFrom(payload) };
    case 'project.theme-config.patch':
      return { value: await service.themeConfigPatch(requireChange(context), payload as unknown as Parameters<AuthoringService['themeConfigPatch']>[1]), operationId: operationIdFrom(payload) };
    case 'project.ui.patch':
      return { value: await service.uiPatch(requireChange(context), payload as unknown as Parameters<AuthoringService['uiPatch']>[1]), operationId: operationIdFrom(payload) };
    case 'project.validate':
      return context.activeChangeId === undefined
        ? { value: await service.validateProject(requireProject(context)) }
        : { value: await service.validate(context.activeChangeId) };
    case 'project.simulate': {
      const sceneId = typeof payload['sceneId'] === 'string' ? payload['sceneId'] : undefined;
      const seed = typeof payload['seed'] === 'number' ? payload['seed'] : undefined;
      const input = { ...(sceneId === undefined ? {} : { sceneId }), ...(seed === undefined ? {} : { seed }),
        ...(payload['maxPaths'] === undefined ? {} : { maxPaths: payload['maxPaths'] as number }),
        ...(payload['maxStepsPerPath'] === undefined ? {} : { maxStepsPerPath: payload['maxStepsPerPath'] as number }),
      };
      return context.activeChangeId === undefined
        ? { value: await service.simulateProject(requireProject(context), Object.keys(input).length === 0 ? undefined : input) }
        : { value: await service.simulate(context.activeChangeId, Object.keys(input).length === 0 ? undefined : input) };
    }
    case 'runtime.run-from':
      return { value: await service.runFrom(requireChange(context), payload) };
    case 'runtime.read-preview':
      return { value: await service.readPreview(requireProject(context), payload) };
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
      return {
        value: await service.commit(
          requireChange(context),
          payload['approvalRef'] as Parameters<AuthoringService['commit']>[1],
        ),
      };
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
    case 'review.prepare-comparison':
      return {
        value: await service.prepareComparisonReview(
          requireProject(context),
          payload as Parameters<AuthoringService['prepareComparisonReview']>[1],
        ),
      };
    case 'review.inspect-decision':
      return {
        value: await service.inspectReviewDecision(
          requireProject(context),
          payload as Parameters<AuthoringService['inspectReviewDecision']>[1],
        ),
      };
    case 'review.prepare-result':
      return {
        value: await service.prepareResultReview(
          requireProject(context),
          payload as Parameters<AuthoringService['prepareResultReview']>[1],
        ),
      };
    case 'review.inspect-approval':
      return {
        value: await service.inspectApprovalReview(
          requireProject(context),
          payload as Parameters<AuthoringService['inspectApprovalReview']>[1],
        ),
      };
  }
}
