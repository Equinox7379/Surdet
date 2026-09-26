/** The renderer composition root adapts Core's pure project-data contract.
 * World receives this narrow policy, not an Interpreter, project or event bus. */
import {
  parseProjectStage, parseStageLayer, stagePoseFromModifiers, validateStagePose,
  validateStageFrame, stageConfigurationKey, validStageSource,
} from '@surdet/core';
export type { ProjectStage, StageCommand, StageLayerDefinition, StagePose, StageSource, StageInspection } from '@surdet/core';
export interface StageGeometryPolicy {
  parseProjectStage: typeof parseProjectStage;
  parseStageLayer: typeof parseStageLayer;
  stagePoseFromModifiers: typeof stagePoseFromModifiers;
  validateStagePose: typeof validateStagePose;
  validateStageFrame: typeof validateStageFrame;
  stageConfigurationKey: typeof stageConfigurationKey;
  validStageSource: typeof validStageSource;
}
export function createStageGeometryPolicy(): StageGeometryPolicy {
  return Object.freeze({ parseProjectStage, parseStageLayer, stagePoseFromModifiers,
    validateStagePose, validateStageFrame, stageConfigurationKey, validStageSource });
}
