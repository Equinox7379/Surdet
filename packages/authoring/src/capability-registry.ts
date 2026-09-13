import type {
  AutonomyPolicy,
  CapabilityDefinition,
  IdempotencyClass,
  JsonSchema,
  SideEffectClass,
} from './capability-contract.js';
import { AGENT_IMAGE_MAX_FILES } from './agent-image-import.js';
import { REPLACEABLE_SCENE_INSTRUCTIONS } from './contracts.js';

const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema' as const;

type SchemaProperties = Record<string, JsonSchema>;

function strictObject(properties: SchemaProperties, required: readonly string[] = []): JsonSchema {
  return {
    $schema: JSON_SCHEMA_DRAFT,
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required.length > 0 ? { required: [...required] } : {}),
  };
}

function arrayOf(items: JsonSchema): JsonSchema {
  return { type: 'array', items };
}

const stringSchema: JsonSchema = { type: 'string' };
const numberSchema: JsonSchema = { type: 'number' };
const integerSchema: JsonSchema = { type: 'integer' };
const seedSchema: JsonSchema = { type: 'integer', minimum: 0, maximum: 4294967295 };
const booleanSchema: JsonSchema = { type: 'boolean' };
const nullSchema: JsonSchema = { type: 'null' };
const stringArraySchema: JsonSchema = arrayOf(stringSchema);
const emptyInputSchema = strictObject({});
const importUuidSchema: JsonSchema = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' };
const importShaSchema: JsonSchema = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const importOperationSchema = strictObject({ operationId: importUuidSchema }, ['operationId']);
const importCommitSchema = strictObject({ operationId: importUuidSchema, planFingerprint: importShaSchema }, ['operationId', 'planFingerprint']);

// The domain deliberately permits JSON values in variable initial values and
// operation evidence. Objects still reject undeclared top-level properties;
// their value shape is constrained to JSON values rather than being an open
// schema escape hatch.
const jsonValueSchema: JsonSchema = {
  oneOf: [
    stringSchema,
    numberSchema,
    booleanSchema,
    nullSchema,
    arrayOf({ oneOf: [stringSchema, numberSchema, booleanSchema, nullSchema] }),
    {
      type: 'object',
      patternProperties: {
        '^.*$': { oneOf: [stringSchema, numberSchema, booleanSchema, nullSchema, arrayOf(stringSchema)] },
      },
      additionalProperties: false,
    },
  ],
};

const jsonObjectSchema: JsonSchema = { type: 'object' };
const inspectionDetailsSchema: JsonSchema = {
  oneOf: [stringSchema, jsonObjectSchema],
};

export const EVIDENCE_FRESHNESS_SCHEMA: JsonSchema = strictObject({
  evidenceId: stringSchema,
  status: { enum: ['missing', 'fresh', 'stale', 'failed', 'incomplete'] },
  workingRevision: integerSchema,
  currentWorkingRevision: integerSchema,
}, ['status', 'currentWorkingRevision']);

const stringMapSchema: JsonSchema = {
  type: 'object',
  patternProperties: { '^.*$': stringSchema },
  additionalProperties: false,
};

const sceneTextBlockSchema = strictObject({
  kind: { const: 'text' },
  speaker: stringSchema,
  value: stringSchema,
}, ['kind', 'value']);

const sceneLabelBlockSchema = strictObject({
  kind: { const: 'label' },
  name: stringSchema,
}, ['kind', 'name']);

const sceneInstructionBlockSchema = strictObject({
  kind: { const: 'instruction' },
  name: {
    type: 'string',
    description: "DSL instruction name without '@'. To play a timeline use exactly 'timeline' (never 'timeline.play'); put the timeline id in args[0].",
    examples: ['timeline', 'set', 'jump'],
  },
  args: {
    type: 'array',
    items: stringSchema,
    description: "Instruction arguments without '@'. For name='timeline', args[0] is the exact timeline id.",
  },
  modifiers: stringMapSchema,
}, ['kind', 'name']);

const choiceEffectSchema = strictObject({
  name: stringSchema,
  args: stringArraySchema,
}, ['name', 'args']);

const choiceTargetSchema = strictObject({
  kind: { enum: ['goto', 'jump'] },
  value: stringSchema,
}, ['kind', 'value']);

const choiceOptionSchema = strictObject({
  label: stringSchema,
  when: stringSchema,
  effects: arrayOf(choiceEffectSchema),
  target: choiceTargetSchema,
}, ['label', 'target']);

const sceneChoiceBlockSchema = strictObject({
  kind: { const: 'choice' },
  options: arrayOf(choiceOptionSchema),
}, ['kind', 'options']);

const sceneBlockSchema: JsonSchema = {
  oneOf: [
    sceneTextBlockSchema,
    sceneLabelBlockSchema,
    sceneInstructionBlockSchema,
    sceneChoiceBlockSchema,
  ],
};

const scenePatchSchema: JsonSchema = {
  oneOf: [
    strictObject({
      kind: { const: 'replaceText' },
      target: stringSchema,
      expectedFingerprint: stringSchema,
      speaker: stringSchema,
      value: stringSchema,
    }, ['kind', 'target', 'expectedFingerprint', 'value']),
    strictObject({
      kind: { const: 'replaceInstruction' },
      target: { type: 'string', description: 'Copy the instruction objectRef from object.inspect or runtime.read-preview; sceneId, when provided, must match it.' },
      expectedFingerprint: stringSchema,
      instruction: strictObject({
        kind: { const: 'instruction' },
        name: { enum: [...REPLACEABLE_SCENE_INSTRUCTIONS] },
        args: stringArraySchema,
        modifiers: stringMapSchema,
      }, ['kind', 'name']),
    }, ['kind', 'target', 'expectedFingerprint', 'instruction']),
    strictObject({
      kind: { const: 'insertAfter' },
      anchor: stringSchema,
      expectedFingerprint: stringSchema,
      blocks: arrayOf(sceneBlockSchema),
    }, ['kind', 'anchor', 'expectedFingerprint', 'blocks']),
    strictObject({
      kind: { const: 'replaceChoiceOption' },
      target: stringSchema,
      expectedFingerprint: stringSchema,
      option: choiceOptionSchema,
    }, ['kind', 'target', 'expectedFingerprint', 'option']),
    strictObject({
      kind: { const: 'removeObject' },
      target: stringSchema,
      expectedFingerprint: stringSchema,
    }, ['kind', 'target', 'expectedFingerprint']),
  ],
};

const timelineCueSchema = strictObject({
  atMs: numberSchema,
  durationMs: numberSchema,
  easing: { enum: ['linear', 'inOutSine', 'outCubic', 'inOutCubic'] },
  action: stringSchema,
  key: { type: 'string', description: 'background set cue only: copy project.assets.backgrounds[].key' },
  expression: { type: 'string', description: 'portrait cue only: copy project.assets.portraits[].expression for the selected timelineTarget' },
  position: stringSchema,
  alpha: numberSchema,
}, ['atMs', 'durationMs', 'easing', 'action']);

const timelineTrackSchema = strictObject({
  kind: { enum: ['background', 'portrait', 'screen'] },
  target: { type: 'string', description: 'portrait track only: copy project.assets.portraits[].timelineTarget; omit for background and screen' },
  cues: arrayOf(timelineCueSchema),
}, ['kind', 'cues']);

const timelineDefinitionSchema = strictObject({
  version: { const: 1 },
  id: stringSchema,
  durationMs: numberSchema,
  tracks: arrayOf(timelineTrackSchema),
}, ['version', 'id', 'durationMs', 'tracks']);

const timelinePatchSchema: JsonSchema = {
  oneOf: [
    strictObject({
      kind: { const: 'addTrack' },
      expectedFingerprint: stringSchema,
      trackKind: { enum: ['background', 'portrait', 'screen'] },
      target: stringSchema,
    }, ['kind', 'expectedFingerprint', 'trackKind']),
    strictObject({
      kind: { const: 'removeTrack' },
      expectedFingerprint: stringSchema,
      trackRef: stringSchema,
    }, ['kind', 'expectedFingerprint', 'trackRef']),
    strictObject({
      kind: { const: 'insertCue' },
      expectedFingerprint: stringSchema,
      trackRef: stringSchema,
      cue: timelineCueSchema,
    }, ['kind', 'expectedFingerprint', 'trackRef', 'cue']),
    strictObject({
      kind: { const: 'replaceCue' },
      expectedFingerprint: stringSchema,
      cueRef: stringSchema,
      cue: timelineCueSchema,
    }, ['kind', 'expectedFingerprint', 'cueRef', 'cue']),
    strictObject({
      kind: { const: 'removeCue' },
      expectedFingerprint: stringSchema,
      cueRef: stringSchema,
    }, ['kind', 'expectedFingerprint', 'cueRef']),
  ],
};

const diffEntrySchema = strictObject({
  kind: stringSchema,
  operationId: stringSchema,
  objectBefore: stringSchema,
  objectAfter: stringSchema,
  fingerprintBefore: stringSchema,
  fingerprintAfter: stringSchema,
  // CG differences retain full entry metadata, including nested fields.
  directChange: { anyOf: [jsonValueSchema, jsonObjectSchema] },
  potentialImpact: arrayOf(jsonValueSchema),
  observedImpact: arrayOf(jsonValueSchema),
}, ['kind', 'operationId', 'directChange', 'potentialImpact', 'observedImpact']);

const assetEntrySchema = strictObject({
  kind: { enum: ['background', 'portrait', 'avatar'] },
  key: stringSchema,
  timelineTarget: { type: 'string', description: 'canonical portrait track.target; copy this value instead of constructing it' },
  role: stringSchema,
  outfit: stringSchema,
  expression: stringSchema,
  sourcePath: stringSchema,
  format: stringSchema,
  resolved: booleanSchema,
}, ['kind', 'key', 'sourcePath', 'format', 'resolved']);

const projectAssetKindSchema = {
  enum: ['background', 'portrait', 'avatar', 'music', 'ambience', 'sound-effect', 'voice', 'video', 'font', 'other'],
};
const projectAssetIssueCodeSchema = {
  enum: ['ASSET_REFERENCE_MISSING', 'ASSET_KEY_DUPLICATE', 'ASSET_NAME_INVALID', 'ASSET_FORMAT_UNSUPPORTED', 'ASSET_UNUSED'],
};
const projectAssetReferenceSchema = strictObject({
  referenceId: stringSchema,
  sourceKind: { enum: ['scene', 'timeline', 'character', 'gallery'] },
  sourceLabel: stringSchema,
  sourcePath: stringSchema,
  line: integerSchema,
  objectRef: stringSchema,
}, ['referenceId', 'sourceKind', 'sourceLabel', 'sourcePath']);
const projectAssetItemSchema = strictObject({
  assetId: stringSchema,
  kind: projectAssetKindSchema,
  key: stringSchema,
  sourcePath: stringSchema,
  format: stringSchema,
  bytes: integerSchema,
  variant: stringSchema,
  physical: booleanSchema,
  references: arrayOf(projectAssetReferenceSchema),
  issues: arrayOf(projectAssetIssueCodeSchema),
}, ['assetId', 'kind', 'key', 'physical', 'references', 'issues']);
const projectAssetIssueSchema = strictObject({
  issueId: stringSchema,
  code: projectAssetIssueCodeSchema,
  severity: { enum: ['warning', 'error'] },
  message: stringSchema,
  assetIds: arrayOf(stringSchema),
  referenceIds: arrayOf(stringSchema),
}, ['issueId', 'code', 'severity', 'message', 'assetIds', 'referenceIds']);
const projectAssetKindSummarySchema = strictObject({
  files: integerSchema,
  measuredFiles: integerSchema,
  bytes: integerSchema,
}, ['files', 'measuredFiles']);
const projectAssetByKindSchema = strictObject({
  background: projectAssetKindSummarySchema,
  portrait: projectAssetKindSummarySchema,
  avatar: projectAssetKindSummarySchema,
  music: projectAssetKindSummarySchema,
  ambience: projectAssetKindSummarySchema,
  'sound-effect': projectAssetKindSummarySchema,
  voice: projectAssetKindSummarySchema,
  video: projectAssetKindSummarySchema,
  font: projectAssetKindSummarySchema,
  other: projectAssetKindSummarySchema,
}, ['background', 'portrait', 'avatar', 'music', 'ambience', 'sound-effect', 'voice', 'video', 'font', 'other']);
const projectAssetSummarySchema = strictObject({
  fileCount: integerSchema,
  measuredFileCount: integerSchema,
  measuredBytes: integerSchema,
  totalBytes: integerSchema,
  referencedCount: integerSchema,
  unusedCount: integerSchema,
  missingCount: integerSchema,
  duplicateCount: integerSchema,
  unsupportedCount: integerSchema,
  invalidNameCount: integerSchema,
  byKind: projectAssetByKindSchema,
}, [
  'fileCount', 'measuredFileCount', 'measuredBytes', 'referencedCount', 'unusedCount', 'missingCount',
  'duplicateCount', 'unsupportedCount', 'invalidNameCount', 'byKind',
]);
const projectAssetIntelligenceSchema = strictObject({
  items: arrayOf(projectAssetItemSchema),
  summary: projectAssetSummarySchema,
  issues: arrayOf(projectAssetIssueSchema),
}, ['items', 'summary', 'issues']);

const assetCatalogSchema = strictObject({
  backgrounds: arrayOf(assetEntrySchema),
  portraits: arrayOf(assetEntrySchema),
  avatars: arrayOf(assetEntrySchema),
  intelligence: projectAssetIntelligenceSchema,
}, ['backgrounds', 'portraits', 'avatars', 'intelligence']);

const emptyAssetIntelligenceExample = {
  items: [],
  summary: {
    fileCount: 0,
    measuredFileCount: 0,
    measuredBytes: 0,
    referencedCount: 0,
    unusedCount: 0,
    missingCount: 0,
    duplicateCount: 0,
    unsupportedCount: 0,
    invalidNameCount: 0,
    byKind: Object.fromEntries([
      'background', 'portrait', 'avatar', 'music', 'ambience', 'sound-effect', 'voice', 'video', 'font', 'other',
    ].map((kind) => [kind, { files: 0, measuredFiles: 0 }])),
  },
  issues: [],
};

const projectInspectionSchema = strictObject({
  rootIdentity: stringSchema,
  revision: stringSchema,
  entryScene: stringSchema,
  title: stringSchema,
  scenes: arrayOf(strictObject({ id: stringSchema, path: stringSchema }, ['id', 'path'])),
  variables: arrayOf(strictObject({ name: stringSchema, declaration: jsonValueSchema }, ['name', 'declaration'])),
  characters: arrayOf(strictObject({
    id: stringSchema,
    name: stringSchema,
    avatar: stringSchema,
    declaration: jsonValueSchema,
  }, ['id', 'declaration'])),
  assets: assetCatalogSchema,
  objectCount: integerSchema,
  referenceCount: integerSchema,
}, [
  'rootIdentity', 'revision', 'scenes', 'variables', 'characters', 'assets', 'objectCount', 'referenceCount',
]);

const objectInspectionSchema = strictObject({
  kind: stringSchema,
  objectRef: stringSchema,
  semanticId: stringSchema,
  parentRef: stringSchema,
  source: strictObject({ path: stringSchema, line: integerSchema, col: integerSchema, raw: stringSchema }, ['path', 'line', 'col', 'raw']),
  details: inspectionDetailsSchema,
  fingerprint: stringSchema,
  references: stringArraySchema,
  referencedBy: stringArraySchema,
  childRefs: stringArraySchema,
}, ['kind', 'objectRef', 'references', 'referencedBy']);

const validationIssueSchema = strictObject({
  severity: { enum: ['error', 'warning'] },
  code: stringSchema,
  text: stringSchema,
  file: stringSchema,
  line: integerSchema,
  col: integerSchema,
  hint: stringSchema,
  objectRef: stringSchema,
  action: stringSchema,
}, ['severity', 'code', 'text', 'file', 'line', 'col', 'action']);

// validateSnapshot keeps its compiled-scene map on the working result. It is
// an empty JSON object on the MCP wire; keep that implementation field
// explicitly closed instead of weakening the whole working result schema.
const validationScenesSchema = strictObject({});

const validationProjectResultSchema = strictObject({
  view: { const: 'project' },
  ok: booleanSchema,
  issues: arrayOf(validationIssueSchema),
}, ['view', 'ok', 'issues']);

const validationWorkingResultSchema = strictObject({
  view: { const: 'working' },
  ok: booleanSchema,
  issues: arrayOf(validationIssueSchema),
  scenes: validationScenesSchema,
  evidenceId: stringSchema,
  freshness: EVIDENCE_FRESHNESS_SCHEMA,
}, ['view', 'ok', 'issues', 'scenes', 'evidenceId', 'freshness']);

const validationOutputSchema: JsonSchema = {
  oneOf: [validationProjectResultSchema, validationWorkingResultSchema],
};

const simulationPathSchema = strictObject({
  choices: arrayOf(integerSchema),
  finalVariables: jsonValueSchema,
  status: { enum: ['passed', 'failed'] },
  termination: { enum: ['ended', 'error', 'pruned', 'budget-exhausted'] },
  prunedReason: { enum: ['state-signature', 'path-budget'] },
  error: stringSchema,
}, ['choices', 'finalVariables', 'status', 'termination']);

const simulationReportProperties: SchemaProperties = {
  status: { enum: ['passed', 'failed', 'incomplete'] },
  entryScene: stringSchema,
  pathsExplored: integerSchema,
  choiceBranches: strictObject({ total: integerSchema, visited: integerSchema }, ['total', 'visited']),
  paths: arrayOf(simulationPathSchema),
  budgetExhausted: booleanSchema,
  runtimeErrors: arrayOf(strictObject({ scene: { oneOf: [stringSchema, nullSchema] }, message: stringSchema }, ['scene', 'message'])),
  endings: arrayOf(strictObject({ ending: stringSchema, times: integerSchema }, ['ending', 'times'])),
  deadEndScenes: stringArraySchema,
  cyclesPruned: integerSchema,
  saveRoundtrips: integerSchema,
  seed: seedSchema,
};

const simulationReportRequired = [
  'status', 'entryScene', 'pathsExplored', 'choiceBranches', 'paths', 'budgetExhausted',
  'runtimeErrors', 'endings', 'deadEndScenes', 'cyclesPruned', 'saveRoundtrips',
  'seed',
];

const simulationReportSchema = strictObject(simulationReportProperties, simulationReportRequired);

const simulationProjectResultSchema = strictObject({
  view: { const: 'project' },
  status: { enum: ['passed', 'failed', 'incomplete'] },
  report: simulationReportSchema,
}, ['view', 'status', 'report']);

const simulationWorkingResultSchema = strictObject({
  ...simulationReportProperties,
  view: { const: 'working' },
  report: simulationReportSchema,
  evidenceId: stringSchema,
  freshness: EVIDENCE_FRESHNESS_SCHEMA,
}, [...simulationReportRequired, 'view', 'report', 'evidenceId', 'freshness']);

const simulationOutputSchema: JsonSchema = {
  oneOf: [simulationProjectResultSchema, simulationWorkingResultSchema],
};

const runtimeChoicesSchema = arrayOf(integerSchema);
const traceQuerySchema = strictObject({
  kind: stringSchema,
  sceneId: stringSchema,
  op: stringSchema,
  variable: stringSchema,
});

const traceSourceSchema = strictObject({
  sceneId: stringSchema,
  index: integerSchema,
  op: stringSchema,
  file: stringSchema,
  line: integerSchema,
  col: integerSchema,
}, ['sceneId', 'index', 'op', 'file', 'line', 'col']);

const traceStateDeltaSchema = strictObject({
  variable: stringSchema,
  before: jsonValueSchema,
  after: jsonValueSchema,
}, ['variable']);

const traceEventSchema = strictObject({
  kind: { enum: ['instruction', 'choice', 'state', 'condition', 'control-flow', 'scene-end'] },
  source: traceSourceSchema,
  stateDelta: arrayOf(traceStateDeltaSchema),
  condition: strictObject({ expression: stringSchema, result: booleanSchema }, ['expression', 'result']),
  controlFlow: strictObject({ from: stringSchema, to: stringSchema }, ['from', 'to']),
  choice: strictObject({ optionIndex: integerSchema, label: stringSchema }, ['optionIndex', 'label']),
}, ['kind', 'source']);

const traceEventsSchema = arrayOf(traceEventSchema);

const previewFileFactSchema = strictObject({ path: stringSchema, sha256: importShaSchema }, ['path', 'sha256']);
const previewObservationSchema = strictObject({
  previewId: stringSchema, previewGeneration: integerSchema, workspaceSessionId: stringSchema, projectIdentity: stringSchema,
  projectRevision: importShaSchema, coordinationRevision: importShaSchema, sceneId: stringSchema, label: stringSchema,
  startedAt: stringSchema, updatedAt: stringSchema, runtimeGeneration: { oneOf: [integerSchema, nullSchema] },
  state: { enum: ['starting', 'running', 'passed', 'failed'] }, firstError: stringSchema,
  source: strictObject({ files: arrayOf(previewFileFactSchema), assets: arrayOf(previewFileFactSchema) }, ['files', 'assets']),
  events: arrayOf(strictObject({ type: { const: 'surdet-preview-trace-event' }, traceId: stringSchema, generation: integerSchema,
    sequence: integerSchema, coreEmitted: { const: true }, presentationApplied: booleanSchema,
    presentationBefore: jsonObjectSchema, presentationAfter: jsonObjectSchema, event: traceEventSchema,
    objectRef: { oneOf: [stringSchema, nullSchema] },
  }, ['type', 'traceId', 'generation', 'sequence', 'coreEmitted', 'presentationApplied', 'presentationBefore', 'presentationAfter', 'event', 'objectRef'])),
}, ['previewId', 'previewGeneration', 'workspaceSessionId', 'projectIdentity', 'projectRevision', 'coordinationRevision', 'sceneId',
  'startedAt', 'updatedAt', 'runtimeGeneration', 'state', 'source', 'events']);

export const CANDIDATE_COMPOSITION_READINESS_SCHEMA: JsonSchema = {
  ...strictObject({
    mode: { enum: ['candidate', 'direct', 'integration', 'legacy-unclassified'] },
    status: { enum: ['ready', 'blocked', 'not-applicable', 'legacy-unavailable'] },
    operationFactsVersion: { const: '1.0.0' },
    operationCount: { type: 'integer', minimum: 0 },
    issueCount: { type: 'integer', minimum: 0 },
    truncated: booleanSchema,
    issues: arrayOf(strictObject({
      code: { enum: ['OPERATION_SEQUENCE_INVALID', 'OPERATION_FACTS_MISSING', 'OPERATION_FACTS_INVALID', 'DEPENDENCY_IDENTITY_UNAVAILABLE', 'DEPENDENCY_CYCLE'] },
      operationId: stringSchema, message: stringSchema, objectRefs: stringArraySchema,
      cycle: strictObject({
        primaryObjects: stringArraySchema,
        edges: arrayOf(strictObject({
          fromPrimaryObject: stringSchema, toPrimaryObject: stringSchema, objectRef: stringSchema,
          consumerSequence: { type: 'integer', minimum: 0 }, producerSequence: { type: 'integer', minimum: 0 },
        }, ['fromPrimaryObject', 'toPrimaryObject', 'objectRef', 'consumerSequence', 'producerSequence'])),
      }, ['primaryObjects', 'edges']),
    }, ['code', 'message'])),
  }, ['mode', 'status', 'operationCount', 'issueCount', 'issues', 'truncated']),
  oneOf: [
    { properties: { mode: { const: 'candidate' }, status: { enum: ['ready', 'blocked'] } } },
    { properties: { mode: { enum: ['direct', 'integration'] }, status: { const: 'not-applicable' } } },
    { properties: { mode: { const: 'legacy-unclassified' }, status: { const: 'legacy-unavailable' } } },
  ],
};

const changeDiffProperties: SchemaProperties = {
  summary: strictObject({
    createdScenes: integerSchema,
    modifiedScenes: integerSchema,
    changedVariables: integerSchema,
    warnings: stringArraySchema,
  }, ['createdScenes', 'modifiedScenes', 'changedVariables', 'warnings']),
  semantic: arrayOf(diffEntrySchema),
  files: arrayOf(strictObject({
    path: stringSchema,
    beforeSha256: stringSchema,
    afterSha256: stringSchema,
    unifiedDiff: stringSchema,
    unexpectedFormatChange: booleanSchema,
  }, ['path', 'unifiedDiff', 'unexpectedFormatChange'])),
};

const changeDiffResultSchema = strictObject({
  ...changeDiffProperties,
  compositionReadiness: CANDIDATE_COMPOSITION_READINESS_SCHEMA,
  view: { const: 'working' },
  evidenceId: stringSchema,
  freshness: EVIDENCE_FRESHNESS_SCHEMA,
}, ['summary', 'semantic', 'files', 'compositionReadiness', 'view', 'evidenceId', 'freshness']);

const recoveryFileStateSchema = strictObject({
  path: stringSchema,
  state: { enum: ['original', 'target', 'absent-expected', 'unexpected'] },
  actualSha256: stringSchema,
}, ['path', 'state']);

const recoveryInspectionSchema = strictObject({
  changeId: stringSchema,
  recordState: { enum: ['readable', 'corrupt', 'unsupported'] },
  changeStatus: { enum: ['OPEN', 'COMMITTED', 'ROLLED_BACK', 'STALE'] },
  journalStatus: { enum: ['STAGING', 'REPLACING', 'RECOVERED', 'RECOVERY_FAILED', 'COMMITTED'] },
  lockState: { enum: ['free', 'owned', 'stale-candidate', 'corrupt', 'foreign-host'] },
  projectState: { enum: ['base', 'target', 'mixed-known', 'ambiguous'] },
  fileStates: arrayOf(recoveryFileStateSchema),
  disposition: { enum: ['NO_ACTION', 'REOPEN_OPEN', 'ROLL_BACK_TO_BASE', 'FINALIZE_COMMITTED', 'MANUAL_RECOVERY_REQUIRED'] },
  recoveryToken: stringSchema,
  manualRecoveryRequired: booleanSchema,
  reasons: stringArraySchema,
}, ['changeId', 'recordState', 'lockState', 'projectState', 'fileStates', 'disposition', 'manualRecoveryRequired', 'reasons']);

const recoveryExecuteResultSchema = strictObject({
  changeId: stringSchema,
  status: { enum: ['OPEN', 'COMMITTED'] },
  disposition: { enum: ['REOPEN_OPEN', 'ROLL_BACK_TO_BASE', 'FINALIZE_COMMITTED'] },
}, ['changeId', 'status', 'disposition']);

const runtimeRunFromResultSchema = strictObject({
  view: { const: 'working' },
  traceId: stringSchema,
  status: { const: 'passed' },
  sceneId: stringSchema,
  choices: runtimeChoicesSchema,
  finalVariables: jsonValueSchema,
  eventCount: integerSchema,
  seed: seedSchema,
  freshness: EVIDENCE_FRESHNESS_SCHEMA,
}, ['view', 'traceId', 'status', 'sceneId', 'choices', 'finalVariables', 'eventCount', 'seed', 'freshness']);

const capabilitySummarySchema = strictObject({
  id: stringSchema,
  mcpTool: stringSchema,
  title: stringSchema,
  purpose: stringSchema,
  minimumPolicy: { enum: ['observe', 'stage', 'apply'] },
  composable: { type: 'boolean' },
  inputSchema: jsonObjectSchema,
  outputSchema: jsonObjectSchema,
  sideEffects: stringArraySchema,
  idempotency: stringSchema,
  preconditions: stringArraySchema,
  possibleErrors: stringArraySchema,
  repairRecipes: stringArraySchema,
  minimalExample: strictObject({ input: jsonObjectSchema, expectedResultShape: jsonObjectSchema }, ['input', 'expectedResultShape']),
}, [
  'id', 'mcpTool', 'title', 'purpose', 'minimumPolicy', 'inputSchema', 'outputSchema', 'sideEffects',
  'idempotency', 'composable', 'preconditions', 'possibleErrors', 'repairRecipes', 'minimalExample',
]);

const candidateRefSchema = strictObject({
  changeId: stringSchema,
  capsuleId: stringSchema,
  artifactSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
}, ['changeId', 'capsuleId', 'artifactSha256']);

const candidateRefsSchema: JsonSchema = {
  ...arrayOf(candidateRefSchema),
  minItems: 2,
  maxItems: 8,
};

const conflictResolutionSchema = strictObject({
  conflictId: stringSchema,
  resolution: { enum: ['choose-unit', 'exclude-all', 'regenerate-candidate'] },
  chosenUnitId: stringSchema,
  actor: { enum: ['human', 'review-agent'] },
  reason: { type: 'string', maxLength: 500 },
}, ['conflictId', 'resolution', 'actor']);

const reviewDecisionInputSchema = strictObject({
  reviewId: stringSchema,
  decisionId: stringSchema,
  decisionFingerprint: { type: 'string', pattern: '^[0-9a-f]{64}$' },
}, ['reviewId', 'decisionId', 'decisionFingerprint']);

const approvalRefSchema = strictObject({
  resultReviewId: stringSchema,
  approvalId: stringSchema,
  approvalFingerprint: { type: 'string', pattern: '^[0-9a-f]{64}$' },
}, ['resultReviewId', 'approvalId', 'approvalFingerprint']);

const reviewWorkspaceIdentitySchema = strictObject({
  reviewVersion: { enum: ['1.0.0', '2.0.0'] },
  reviewId: stringSchema,
  kind: { enum: ['comparison', 'integration-result'] },
  projectIdentity: stringSchema,
  expectedProjectRevision: stringSchema,
  comparisonFingerprint: stringSchema,
  planFingerprint: stringSchema,
  integrationChangeId: stringSchema,
  workingRevision: integerSchema,
  payload: strictObject({
    relativePath: stringSchema,
    bytes: integerSchema,
    sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
  }, ['relativePath', 'bytes', 'sha256']),
}, ['reviewVersion', 'reviewId', 'kind', 'projectIdentity', 'expectedProjectRevision', 'comparisonFingerprint', 'payload']);

const preparedReviewResultSchema = strictObject({
  reviewId: stringSchema,
  projection: jsonObjectSchema,
  identity: reviewWorkspaceIdentitySchema,
  projectDirectory: stringSchema,
}, ['reviewId', 'projection', 'identity']);

const reviewBindingSchema = strictObject({
  reviewState: { const: 'human-reviewed' },
  reviewId: stringSchema,
  decisionId: stringSchema,
  decisionFingerprint: stringSchema,
}, ['reviewState', 'reviewId', 'decisionId', 'decisionFingerprint']);

const verifiedDecisionSchema = strictObject({
  receipt: jsonObjectSchema,
  selectedUnitIds: stringArraySchema,
  conflictResolutions: arrayOf(conflictResolutionSchema),
  review: reviewBindingSchema,
}, ['receipt', 'selectedUnitIds', 'conflictResolutions', 'review']);

const verifiedApprovalSchema = strictObject({
  receipt: jsonObjectSchema,
  bindingFingerprint: stringSchema,
}, ['receipt', 'bindingFingerprint']);

const verifiedReturnSchema = strictObject({
  receipt: jsonObjectSchema,
}, ['receipt']);

const importDetailSchema = strictObject({
  operation: jsonObjectSchema, manifest: jsonObjectSchema, stagedItems: arrayOf(jsonObjectSchema),
  plan: { oneOf: [jsonObjectSchema, nullSchema] }, receipt: { oneOf: [jsonObjectSchema, nullSchema] },
  undoReceipt: { oneOf: [jsonObjectSchema, nullSchema] }, catalog: assetCatalogSchema, coordination: jsonObjectSchema,
}, ['operation', 'manifest', 'stagedItems', 'plan', 'receipt', 'undoReceipt']);
const importDetailExample = { operation: { status: 'READY' }, manifest: {}, stagedItems: [], plan: {}, receipt: null, undoReceipt: null };

const definitions = {
  gallery: {
    inputSchema: emptyInputSchema,
    outputSchema: strictObject({
      view: { enum: ['project', 'working'] },
      cgs: arrayOf(strictObject({ id: stringSchema, name: stringSchema, src: stringSchema, objectRef: stringSchema, fingerprint: stringSchema }, ['id', 'name', 'objectRef', 'fingerprint'])),
    }, ['view', 'cgs']),
    example: { input: {}, expectedResultShape: { view: 'working', cgs: [{ id: 'night_cg', name: '夜色', src: 'night', objectRef: 'gallery:cgs:night_cg', fingerprint: '...' }] } },
  },
  galleryCgCreate: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, name: stringSchema, src: stringSchema }, ['operationId', 'id', 'name']),
    outputSchema: strictObject({ id: stringSchema, objectRef: stringSchema, fingerprint: stringSchema, entry: jsonObjectSchema, diffEntry: diffEntrySchema }, ['id', 'objectRef', 'fingerprint', 'entry', 'diffEntry']),
    example: { input: { operationId: 'op_cg', id: 'night_cg', name: '夜色', src: 'night' }, expectedResultShape: { id: 'night_cg', objectRef: 'gallery:cgs:night_cg', fingerprint: '...', entry: {}, diffEntry: {} } },
  },
  galleryCgPatch: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, expectedFingerprint: stringSchema,
      patch: { ...strictObject({ name: stringSchema, src: { oneOf: [stringSchema, nullSchema] } }, []), minProperties: 1 },
    }, ['operationId', 'id', 'expectedFingerprint', 'patch']),
    outputSchema: strictObject({ id: stringSchema, objectRef: stringSchema, fingerprint: stringSchema, entry: jsonObjectSchema, diffEntry: diffEntrySchema }, ['id', 'objectRef', 'fingerprint', 'entry', 'diffEntry']),
    example: { input: { operationId: 'op_cg_name', id: 'night_cg', expectedFingerprint: '...', patch: { name: '归途夜色' } }, expectedResultShape: { id: 'night_cg', objectRef: 'gallery:cgs:night_cg', fingerprint: '...', entry: {}, diffEntry: {} } },
  },
  compositionCompare: {
    inputSchema: strictObject({
      candidateRefs: { ...arrayOf(strictObject({
        changeId: stringSchema,
        capsuleId: stringSchema,
        artifactSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      }, ['changeId', 'capsuleId', 'artifactSha256'])), minItems: 2, maxItems: 8 },
    }, ['candidateRefs']),
    outputSchema: strictObject({
      comparisonVersion: { enum: ['1.0.0'] },
      projectIdentity: stringSchema,
      expectedProjectRevision: stringSchema,
      status: { enum: ['composable', 'review-only', 'blocked'] },
      candidates: arrayOf(strictObject({
        candidateId: stringSchema,
        eligibility: { enum: ['ready', 'unavailable'] },
      }, ['candidateId', 'eligibility'])),
      units: arrayOf(jsonObjectSchema),
      dependencyEdges: arrayOf(jsonObjectSchema),
      conflicts: arrayOf(jsonObjectSchema),
      identicalGroups: arrayOf(jsonObjectSchema),
      evidenceMatrix: arrayOf(jsonObjectSchema),
      comparisonFingerprint: stringSchema,
    }, ['comparisonVersion', 'projectIdentity', 'expectedProjectRevision', 'status', 'candidates', 'units', 'dependencyEdges', 'conflicts', 'identicalGroups', 'evidenceMatrix', 'comparisonFingerprint']),
    example: { input: {}, expectedResultShape: { comparisonVersion: '1.0.0', projectIdentity: '...', expectedProjectRevision: 'rev_...', status: 'composable', candidates: [], units: [], dependencyEdges: [], conflicts: [], identicalGroups: [], evidenceMatrix: [], comparisonFingerprint: '...' } },
  },
  compositionPlan: {
    inputSchema: {
      $schema: JSON_SCHEMA_DRAFT,
      oneOf: [
        strictObject({
          candidateRefs: candidateRefsSchema,
          comparisonFingerprint: stringSchema,
          selectedUnitIds: { ...arrayOf(stringSchema), minItems: 1 },
          conflictResolutions: arrayOf(conflictResolutionSchema),
          reason: { type: 'string', maxLength: 500 },
        }, ['candidateRefs', 'comparisonFingerprint', 'selectedUnitIds']),
        strictObject({
          candidateRefs: candidateRefsSchema,
          comparisonFingerprint: stringSchema,
          reviewDecision: reviewDecisionInputSchema,
        }, ['candidateRefs', 'comparisonFingerprint', 'reviewDecision']),
      ],
    },
    outputSchema: strictObject({
      planId: stringSchema,
      planFingerprint: stringSchema,
      artifactSha256: stringSchema,
      dryRunStatus: { enum: ['passed', 'failed'] },
    }, ['planId', 'planFingerprint', 'artifactSha256', 'dryRunStatus']),
    example: { input: {}, expectedResultShape: { planId: 'pln_...', planFingerprint: '...', artifactSha256: '...', dryRunStatus: 'passed' } },
  },
  compositionInspect: {
    inputSchema: strictObject({
      planId: stringSchema,
      artifactSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    }, ['planId', 'artifactSha256']),
    outputSchema: strictObject({
      plan: jsonObjectSchema,
    }, ['plan']),
    example: { input: {}, expectedResultShape: { plan: {} } },
  },
  compositionExecute: {
    inputSchema: strictObject({
      planId: stringSchema,
      artifactSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      executeOperationId: stringSchema,
    }, ['planId', 'artifactSha256', 'executeOperationId']),
    outputSchema: strictObject({
      integrationChangeId: stringSchema,
      status: { enum: ['REPLAYING', 'READY', 'FAILED'] },
      nextOperationIndex: integerSchema,
      operationCount: integerSchema,
    }, ['integrationChangeId', 'status', 'nextOperationIndex', 'operationCount']),
    example: { input: {}, expectedResultShape: { integrationChangeId: 'chg_...', status: 'READY', nextOperationIndex: 3, operationCount: 3 } },
  },
  describe: {
    inputSchema: emptyInputSchema,
    outputSchema: strictObject({ contractVersion: stringSchema, capabilities: arrayOf(capabilitySummarySchema) }, ['contractVersion', 'capabilities']),
    example: { input: {}, expectedResultShape: { contractVersion: '1.0.0', capabilities: [] } },
  },
  inspect: {
    inputSchema: emptyInputSchema,
    outputSchema: projectInspectionSchema,
    example: { input: {}, expectedResultShape: { rootIdentity: '...', revision: '...', scenes: [], variables: [], characters: [], assets: { backgrounds: [], portraits: [], avatars: [], intelligence: emptyAssetIntelligenceExample }, objectCount: 0, referenceCount: 0 } },
  },
  assets: {
    inputSchema: emptyInputSchema,
    outputSchema: assetCatalogSchema,
    example: { input: {}, expectedResultShape: { backgrounds: [], portraits: [], avatars: [], intelligence: emptyAssetIntelligenceExample } },
  },
  assetSources: {
    inputSchema: strictObject({ sourceId: stringSchema, path: { type: 'string', description: 'Relative path returned here. Omit sourceId to discover startup-authorized roots; inspect a directory to list entries, then inspect a file for its SHA-256.' } }),
    outputSchema: strictObject({ roots: arrayOf(strictObject({ sourceId: stringSchema, name: stringSchema }, ['sourceId', 'name'])), supportedFormats: stringArraySchema, limits: jsonObjectSchema, sourceId: stringSchema, entries: arrayOf(strictObject({ path: stringSchema, kind: { enum: ['file', 'directory'] } }, ['path', 'kind'])), file: strictObject({ path: stringSchema, bytes: integerSchema, sha256: importShaSchema }, ['path', 'bytes', 'sha256']) }, ['roots', 'supportedFormats', 'limits']),
    example: { input: {}, expectedResultShape: { roots: [], supportedFormats: ['png', 'jpg', 'jpeg', 'webp'], limits: {} } },
  },
  assetImportStage: {
    inputSchema: strictObject({ operationId: importUuidSchema, items: { type: 'array', minItems: 1, maxItems: AGENT_IMAGE_MAX_FILES, items: strictObject({ itemId: importUuidSchema, sourceId: stringSchema, sourcePath: stringSchema, sha256: importShaSchema, kind: { enum: ['background', 'portrait', 'avatar'] }, fileName: { type: 'string', description: 'Single filename. Background: night.png. Portrait: rin_uniform_smile.png (role_outfit_expression). Avatar: rin.png. Copy SHA-256 from asset.sources. Preserve the actual PNG/JPEG/WebP format; never a project path.' } }, ['itemId', 'sourceId', 'sourcePath', 'sha256', 'kind', 'fileName']) } }, ['operationId', 'items']),
    outputSchema: importDetailSchema,
    example: { input: { operationId: '22222222-2222-4222-8222-222222222222', items: [{ itemId: '33333333-3333-4333-8333-333333333333', sourceId: 'source_from_asset_sources', sourcePath: 'night.png', sha256: 'a'.repeat(64), kind: 'background', fileName: 'night.png' }] }, expectedResultShape: importDetailExample },
  },
  assetImportInspect: { inputSchema: importOperationSchema, outputSchema: importDetailSchema, example: { input: { operationId: '22222222-2222-4222-8222-222222222222' }, expectedResultShape: importDetailExample } },
  assetImportCommit: { inputSchema: importCommitSchema, outputSchema: importDetailSchema, example: { input: { operationId: '22222222-2222-4222-8222-222222222222', planFingerprint: 'a'.repeat(64) }, expectedResultShape: importDetailExample } },
  assetImportRecover: { inputSchema: importCommitSchema, outputSchema: importDetailSchema, example: { input: { operationId: '22222222-2222-4222-8222-222222222222', planFingerprint: 'a'.repeat(64) }, expectedResultShape: importDetailExample } },
  objectInspect: {
    inputSchema: strictObject({ objectRef: stringSchema }, ['objectRef']),
    outputSchema: objectInspectionSchema,
    example: { input: { objectRef: 'scene:prologue' }, expectedResultShape: { kind: 'scene', objectRef: 'scene:prologue', references: [], referencedBy: [] } },
  },
  begin: {
    inputSchema: strictObject({
      intent: stringSchema,
      acceptanceCriteria: stringArraySchema,
      initiator: { enum: ['external-agent', 'human', 'automation'], description: 'who initiated this change' },
    }),
    outputSchema: strictObject({ changeId: stringSchema, baseRevision: stringSchema, workingRevision: integerSchema }, ['changeId', 'baseRevision', 'workingRevision']),
    example: { input: {}, expectedResultShape: { changeId: 'chg_...', baseRevision: '...', workingRevision: 0 } },
  },
  sceneCreate: {
    inputSchema: strictObject({ operationId: stringSchema, sceneId: stringSchema, blocks: arrayOf(sceneBlockSchema) }, ['operationId', 'sceneId']),
    outputSchema: strictObject({ sceneId: stringSchema, path: stringSchema }, ['sceneId', 'path']),
    example: { input: { operationId: 'op_scene', sceneId: 'agent_port_entry' }, expectedResultShape: { sceneId: 'agent_port_entry', path: 'content/scenario/agent_port_entry.gal' } },
  },
  scenePatch: {
    inputSchema: { ...strictObject({ operationId: stringSchema, sceneId: stringSchema, patch: scenePatchSchema }, ['operationId', 'patch']),
      description: 'Patch one source object with its original fingerprint. replaceInstruction replaces one existing bg/show/hide/wait line in place using a complete instruction (omitted modifiers are removed). Arguments follow the existing instruction block DSL token convention; no newlines. Surrounding lines and comments are preserved. Re-read object facts after edits; never insert an overriding instruction to simulate replacement.',
    },
    outputSchema: strictObject({ path: stringSchema, line: integerSchema, kind: stringSchema }, ['path', 'line', 'kind']),
    example: { input: { operationId: 'op_patch', patch: { kind: 'replaceInstruction', target: 'scene:x/instruction:2@12345678-abcdef12', expectedFingerprint: 'abcdef12', instruction: { kind: 'instruction', name: 'show', args: ['lynn:coat', 'smile'], modifiers: { pos: 'right' } } } }, expectedResultShape: { path: 'content/scenario/x.gal', line: 2, kind: 'replaceInstruction' } },
  },
  variableEnsure: {
    inputSchema: strictObject({ operationId: stringSchema, name: stringSchema, type: stringSchema, initial: jsonValueSchema, readonly: booleanSchema, min: numberSchema, max: numberSchema }, ['operationId', 'name', 'type', 'initial']),
    outputSchema: strictObject({ name: stringSchema, created: booleanSchema }, ['name', 'created']),
    example: { input: { operationId: 'op_variable', name: 'agent.route', type: 'string', initial: '' }, expectedResultShape: { name: 'agent.route', created: true } },
  },
  characterEnsure: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, name: stringSchema, avatar: { oneOf: [stringSchema, nullSchema] }, expectedFingerprint: stringSchema }, ['operationId', 'id', 'name', 'expectedFingerprint']),
    outputSchema: strictObject({ id: stringSchema, created: booleanSchema, objectRef: stringSchema, fingerprint: stringSchema, diffEntry: diffEntrySchema, speakerMigrations: arrayOf(strictObject({ path: stringSchema, line: integerSchema, from: stringSchema, to: stringSchema }, ['path', 'line', 'from', 'to'])) }, ['id', 'objectRef', 'fingerprint', 'diffEntry']),
    example: { input: { operationId: 'op_character', id: 'agent_guide', name: '引路人', expectedFingerprint: '...' }, expectedResultShape: { id: 'agent_guide', objectRef: 'character:agent_guide', fingerprint: '...', diffEntry: {} } },
  },
  characterRemove: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, expectedFingerprint: stringSchema }, ['operationId', 'id', 'expectedFingerprint']),
    outputSchema: strictObject({ id: stringSchema, removed: booleanSchema, objectRef: stringSchema, fingerprint: stringSchema, diffEntry: diffEntrySchema }, ['id', 'objectRef', 'fingerprint', 'diffEntry']),
    example: { input: { operationId: 'op_character_remove', id: 'agent_guide', expectedFingerprint: '...' }, expectedResultShape: { id: 'agent_guide', objectRef: 'character:agent_guide', fingerprint: '...', diffEntry: {} } },
  },
  timelineCreate: {
    inputSchema: strictObject({ operationId: stringSchema, timelineId: stringSchema, definition: timelineDefinitionSchema }, ['operationId', 'timelineId', 'definition']),
    outputSchema: strictObject({ timelineId: stringSchema, path: stringSchema, objectRef: stringSchema, fingerprint: stringSchema, diffEntry: diffEntrySchema }, ['timelineId', 'path', 'objectRef', 'fingerprint', 'diffEntry']),
    example: { input: { operationId: 'op_timeline', timelineId: 'agent_port_intro', definition: { version: 1, id: 'agent_port_intro', durationMs: 1000, tracks: [] } }, expectedResultShape: { timelineId: 'agent_port_intro', path: 'content/timelines/agent_port_intro.json', objectRef: 'timeline:agent_port_intro', fingerprint: '...', diffEntry: {} } },
  },
  timelinePatch: {
    inputSchema: strictObject({ operationId: stringSchema, timelineId: stringSchema, patch: timelinePatchSchema }, ['operationId', 'timelineId', 'patch']),
    outputSchema: strictObject({ timelineId: stringSchema, objectRef: stringSchema, fingerprint: stringSchema, diffEntry: diffEntrySchema }, ['timelineId', 'objectRef', 'fingerprint', 'diffEntry']),
    example: { input: { operationId: 'op_timeline_patch', timelineId: 'agent_port_intro', patch: { kind: 'addTrack', expectedFingerprint: '...', trackKind: 'background' } }, expectedResultShape: { timelineId: 'agent_port_intro', objectRef: 'timeline:agent_port_intro', fingerprint: '...', diffEntry: {} } },
  },
  entrySceneSet: {
    inputSchema: strictObject({ operationId: stringSchema, sceneId: stringSchema, expectedFingerprint: stringSchema }, ['operationId', 'sceneId', 'expectedFingerprint']),
    outputSchema: strictObject({ sceneId: stringSchema, entryScene: stringSchema, fingerprint: stringSchema, diffEntry: diffEntrySchema }, ['sceneId', 'entryScene', 'fingerprint', 'diffEntry']),
    example: { input: { operationId: 'op_entry', sceneId: 'agent_port_entry', expectedFingerprint: '...' }, expectedResultShape: { sceneId: 'agent_port_entry', entryScene: 'agent_port_entry', fingerprint: '...', diffEntry: {} } },
  },
  validate: {
    inputSchema: emptyInputSchema,
    outputSchema: validationOutputSchema,
    example: { input: {}, expectedResultShape: { view: 'project', ok: true, issues: [] } },
  },
  simulate: {
    inputSchema: strictObject({ sceneId: stringSchema, seed: seedSchema }),
    outputSchema: simulationOutputSchema,
    example: { input: {}, expectedResultShape: { view: 'project', status: 'passed', report: { status: 'passed' } } },
  },
  runFrom: {
    inputSchema: strictObject({
      sceneId: { type: 'string', description: 'exact scene id to run' },
      label: { type: 'string', description: 'optional in-scene @label name; omit label to start at the beginning of sceneId; never pass a scene id or descriptive text here' },
      variables: jsonValueSchema,
      choices: runtimeChoicesSchema,
      maxSteps: integerSchema,
      seed: seedSchema,
    }, ['sceneId', 'choices']),
    outputSchema: runtimeRunFromResultSchema,
    example: { input: { sceneId: 'agent_port_entry', choices: [0] }, expectedResultShape: { view: 'working', traceId: 'trace_...', status: 'passed', sceneId: 'agent_port_entry', choices: [0], finalVariables: {}, eventCount: 1, freshness: { status: 'fresh', currentWorkingRevision: 1 } } },
  },
  readTrace: {
    inputSchema: strictObject({ traceId: stringSchema, query: traceQuerySchema }, ['traceId']),
    outputSchema: strictObject({ view: { const: 'working' }, traceId: stringSchema, events: traceEventsSchema, count: integerSchema, seed: seedSchema, freshness: EVIDENCE_FRESHNESS_SCHEMA }, ['view', 'traceId', 'events', 'count', 'seed', 'freshness']),
    example: { input: { traceId: 'trace_...' }, expectedResultShape: { view: 'working', traceId: 'trace_...', events: [], count: 0, seed: 1592639710, freshness: { status: 'fresh', currentWorkingRevision: 1 } } },
  },
  readPreview: {
    inputSchema: strictObject({ previewId: stringSchema, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }),
    outputSchema: strictObject({ view: { const: 'saved-project' }, kind: { const: 'editor-preview' },
      status: { enum: ['current', 'stale', 'unavailable', 'ambiguous'] }, reasons: stringArraySchema,
      observation: { oneOf: [previewObservationSchema, nullSchema] }, eventCount: integerSchema, hasMore: booleanSchema,
      availablePreviews: arrayOf(strictObject({ previewId: stringSchema, workspaceSessionId: stringSchema, sceneId: stringSchema }, ['previewId', 'workspaceSessionId', 'sceneId'])),
    }, ['view', 'kind', 'status', 'reasons', 'observation', 'eventCount', 'hasMore', 'availablePreviews']),
    example: { input: {}, expectedResultShape: { view: 'saved-project', kind: 'editor-preview', status: 'unavailable',
      reasons: ['no-active-saved-preview'], observation: null, eventCount: 0, hasMore: false, availablePreviews: [] } },
  },
  diff: {
    inputSchema: emptyInputSchema,
    outputSchema: changeDiffResultSchema,
    example: { input: {}, expectedResultShape: { summary: { createdScenes: 0, modifiedScenes: 0, changedVariables: 0, warnings: [] }, semantic: [], files: [], compositionReadiness: { mode: 'candidate', status: 'ready', operationFactsVersion: '1.0.0', operationCount: 1, issueCount: 0, issues: [], truncated: false }, view: 'working', evidenceId: 'diff_...', freshness: { status: 'fresh', currentWorkingRevision: 1 } } },
  },
  commit: {
    inputSchema: strictObject({ approvalRef: approvalRefSchema }),
    outputSchema: strictObject({ changeId: stringSchema, status: { const: 'COMMITTED' }, files: stringArraySchema, coordination: {
      oneOf: [
        strictObject({ status: { const: 'written' }, mutationSequence: { type: 'integer', minimum: 1 } }, ['status', 'mutationSequence']),
        strictObject({ status: { const: 'warning' }, reason: { const: 'coordination-unavailable' }, message: stringSchema }, ['status', 'reason', 'message']),
      ],
    } }, ['changeId', 'status', 'files']),
    example: { input: {}, expectedResultShape: { changeId: 'chg_...', status: 'COMMITTED', files: [], coordination: { status: 'written', mutationSequence: 1 } } },
  },
  rollback: {
    inputSchema: emptyInputSchema,
    outputSchema: strictObject({ changeId: stringSchema, status: { const: 'ROLLED_BACK' } }, ['changeId', 'status']),
    example: { input: {}, expectedResultShape: { changeId: 'chg_...', status: 'ROLLED_BACK' } },
  },
  recoveryInspect: {
    inputSchema: emptyInputSchema,
    outputSchema: recoveryInspectionSchema,
    example: { input: {}, expectedResultShape: { changeId: 'chg_...', recordState: 'readable', lockState: 'free', projectState: 'base', fileStates: [], disposition: 'NO_ACTION', manualRecoveryRequired: false, reasons: [] } },
  },
  recoveryExecute: {
    inputSchema: strictObject({ operationId: stringSchema, recoveryToken: stringSchema }, ['operationId', 'recoveryToken']),
    outputSchema: recoveryExecuteResultSchema,
    example: { input: { operationId: 'op_recovery', recoveryToken: '...' }, expectedResultShape: { changeId: 'chg_...', status: 'OPEN', disposition: 'REOPEN_OPEN' } },
  },
  reviewPrepareComparison: {
    inputSchema: strictObject({
      candidateRefs: candidateRefsSchema,
      creativeBrief: strictObject({
        title: { type: 'string', minLength: 1, maxLength: 256 },
        request: { type: 'string', minLength: 1, maxLength: 16000 },
        acceptanceCriteria: { type: 'array', maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 2000 } },
      }, ['request']),
    }, ['candidateRefs']),
    outputSchema: preparedReviewResultSchema,
    example: { input: { candidateRefs: [] }, expectedResultShape: { reviewId: 'review_comparison_...', projection: {}, identity: {} } },
  },
  reviewInspectDecision: {
    inputSchema: strictObject({ reviewId: stringSchema, decisionId: stringSchema }, ['reviewId']),
    outputSchema: verifiedDecisionSchema,
    example: { input: { reviewId: 'review_comparison_...' }, expectedResultShape: { receipt: {}, selectedUnitIds: [], conflictResolutions: [], review: { reviewState: 'human-reviewed' } } },
  },
  reviewPrepareResult: {
    inputSchema: strictObject({
      planId: stringSchema,
      artifactSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      changeId: stringSchema,
    }, ['planId', 'artifactSha256', 'changeId']),
    outputSchema: preparedReviewResultSchema,
    example: { input: { planId: 'pln_...', artifactSha256: '...', changeId: 'chg_...' }, expectedResultShape: { reviewId: 'review_result_...', projection: {}, identity: {} } },
  },
  reviewInspectApproval: {
    inputSchema: strictObject({ resultReviewId: stringSchema, approvalId: stringSchema }, ['resultReviewId']),
    outputSchema: { oneOf: [verifiedApprovalSchema, verifiedReturnSchema] },
    example: { input: { resultReviewId: 'review_result_...' }, expectedResultShape: { receipt: {} } },
  },
} as const;

export const AUTHORING_CAPABILITY_IDS = [
  'capabilities.describe',
  'project.inspect',
  'project.assets',
  'project.gallery',
  'asset.sources',
  'asset.import.stage',
  'asset.import.inspect',
  'asset.import.commit',
  'asset.import.recover',
  'object.inspect',
  'change.begin',
  'scene.create',
  'scene.patch',
  'variable.ensure',
  'character.ensure',
  'character.remove',
  'timeline.create',
  'timeline.patch',
  'gallery.cg.create',
  'gallery.cg.patch',
  'project.entry-scene.set',
  'project.validate',
  'project.simulate',
  'runtime.run-from',
  'runtime.read-trace',
  'runtime.read-preview',
  'change.diff',
  'change.commit',
  'change.rollback',
  'change.recovery.inspect',
  'change.recovery.execute',
  'composition.compare',
  'composition.plan',
  'composition.inspect',
  'composition.execute',
  'review.prepare-comparison',
  'review.inspect-decision',
  'review.prepare-result',
  'review.inspect-approval',
] as const;

export type AuthoringCapabilityId = (typeof AUTHORING_CAPABILITY_IDS)[number];
export type AuthoringCapabilityDefinition = CapabilityDefinition<AuthoringCapabilityId>;

type DefinitionMetadata = {
  readonly title: string;
  readonly purpose: string;
  readonly minimumPolicy: AutonomyPolicy;
  readonly sideEffects: readonly SideEffectClass[];
  readonly idempotency: IdempotencyClass;
  /** true 仅限共享内容 mutation 白名单；其余（含 composition.*）必须 false。 */
  readonly composable: boolean;
  readonly preconditions: readonly string[];
  readonly possibleErrors: readonly string[];
  readonly repairRecipes: readonly string[];
};

/** 内容 mutation 白名单：composable=true 的唯一合法集合。 */
export const CONTENT_MUTATION_CAPABILITY_IDS = new Set<string>([
  'scene.create', 'scene.patch', 'variable.ensure', 'character.ensure',
  'character.remove', 'timeline.create', 'timeline.patch', 'project.entry-scene.set',
  'gallery.cg.create', 'gallery.cg.patch',
]);

const commonErrors = ['INVALID_REQUEST', 'PROJECT_INVALID', 'PROJECT_NOT_FOUND', 'POLICY_BLOCKED'] as const;
const readRepair = ['inspect the returned object or project facts before retrying'] as const;
const mutateRepair = [
  'inspect current object fingerprints, repair the request, then retry',
  'stage candidates require dependencies before persistence: follow issues.suggestedCapabilities, establish missing objects or choose resolved assets, then retry the same operationId and payload',
  'keep primary-object dependencies acyclic; the rejected second edge was not persisted; mutual empty skeletons do not resolve a cycle',
  'candidateReadiness describes persisted composition facts only, not validation or capsule readiness; legacy changes without operation facts require a new change',
] as const;

const imageImportErrors = ["IMPORT_OPERATION_NOT_FOUND","IMPORT_OPERATION_CONFLICT","IMPORT_PLAN_BLOCKED","IMPORT_PLAN_STALE","IMPORT_PROJECT_STALE","IMPORT_TARGET_UNSAFE","IMPORT_TARGET_EXISTS","IMPORT_RECOVERY_REQUIRED","IMPORT_LIMIT_EXCEEDED","IMPORT_UPLOAD_BUSY","IMPORT_UPLOAD_TIMEOUT","IMPORT_UPLOAD_MISMATCH","IMPORT_AUTHORITY_NOT_READY","IMPORT_FILESYSTEM_UNSUPPORTED","IMPORT_PUBLICATION_FAILED","IMPORT_IO_FAILED","ASSET_SOURCE_FORBIDDEN","ASSET_SOURCE_CHANGED","ASSET_IMAGE_INVALID","PROJECT_BUSY","HUMAN_WORKSPACE_DIRTY","HUMAN_WORKSPACE_BUSY","HUMAN_WORKSPACE_STATE_CORRUPT","SESSION_STATE_INVALID","POLICY_BLOCKED"] as const;

const metadata: Record<AuthoringCapabilityId, DefinitionMetadata> = {
  'project.gallery': { title: 'Inspect CG gallery', purpose: 'Read CG id/name/src and per-entry fingerprints from the active working change, or the bound project when no change is active. src is a project.assets background key; omitted src uses id.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['bound project or active change is readable'], possibleErrors: [...commonErrors, 'CHANGE_NOT_FOUND', 'OBJECT_AMBIGUOUS'], repairRecipes: readRepair },
  'gallery.cg.create': { title: 'Create CG entry', purpose: 'Add one CG without replacing gallery.json or changing other CG/music/text/unknown fields. Import images first, refresh project.assets, create CGs before scenes that unlock them with the existing unlock_cg instruction. Unlocks follow existing per-save rules.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'id is new', 'src or id names a resolved project.assets.backgrounds key'], possibleErrors: [...commonErrors, 'OBJECT_PRECONDITION_FAILED', 'OBJECT_AMBIGUOUS', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Read project.gallery before creating; configure CGs before adding @unlock_cg references with scene.create/scene.patch.', ...mutateRepair] },
  'gallery.cg.patch': { title: 'Patch CG entry', purpose: 'Update only one CG name/src using its current entry fingerprint. id remains stable. Omitted fields and unknown fields are preserved; src:null restores the existing id fallback. Distinct CGs compose independently; competing changes to the same CG require an explicit selection.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'copy expectedFingerprint from project.gallery or object.inspect of gallery:cgs:<id>'], possibleErrors: [...commonErrors, 'OBJECT_NOT_FOUND', 'OBJECT_AMBIGUOUS', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Read the active change with project.gallery; retry with the current CG fingerprint after inspecting its fields.', ...mutateRepair] },
  'asset.sources': { title: "Inspect authorized image sources", purpose: "Discover startup-authorized directories and inspect PNG/JPEG/WebP files before staging. No downloads or arbitrary paths.", minimumPolicy: 'observe', sideEffects: ["project-read", "authorized-source-read"], idempotency: 'pure-read', composable: false, preconditions: ["startup source directories explicitly granted"], possibleErrors: imageImportErrors, repairRecipes: ['After an uncertain response inspect the same operationId; do not create a replacement.', 'Import first, refresh project/assets facts, then start a story change.'] },
  'asset.import.stage': { title: "Stage images", purpose: "Stage and seal an image import using the existing import authority, without writing project files. Retry the same operationId; source requests stay immutable. Blocked targets may be corrected before sealing.", minimumPolicy: 'stage', sideEffects: ["project-read", "authorized-source-read", "change-store-write"], idempotency: 'operation-id', composable: false, preconditions: ["no active story change","source digests copied from asset.sources"], possibleErrors: imageImportErrors, repairRecipes: ['After an uncertain response inspect the same operationId; do not create a replacement.', 'Import first, refresh project/assets facts, then start a story change.'] },
  'asset.import.inspect': { title: "Inspect image import", purpose: "Reconcile the durable progress of one image import, including after restart or response loss. Never creates another operation.", minimumPolicy: 'observe', sideEffects: ["project-read","change-store-read","change-store-write"], idempotency: 'idempotent', composable: false, preconditions: ["operationId identifies an Agent image import"], possibleErrors: imageImportErrors, repairRecipes: ['After an uncertain response inspect the same operationId; do not create a replacement.', 'Import first, refresh project/assets facts, then start a story change.'] },
  'asset.import.commit': { title: "Commit image import", purpose: "Explicitly publish sealed images without overwriting files. Then refresh project.assets/project.inspect before change.begin and use catalog keys for story authoring.", minimumPolicy: 'apply', sideEffects: ["project-write","change-store-write"], idempotency: 'operation-id', composable: false, preconditions: ["no active story change","bound workspaces absent or clean","sealed plan fingerprint matches"], possibleErrors: imageImportErrors, repairRecipes: ['After an uncertain response inspect the same operationId; do not create a replacement.', 'Import first, refresh project/assets facts, then start a story change.'] },
  'asset.import.recover': { title: "Recover image import", purpose: "Continue the existing import recovery. It may safely roll back incomplete publication; inspect the returned status, never assume COMMITTED. Does not expose asset undo, deletion or relocation.", minimumPolicy: 'apply', sideEffects: ["project-write","change-store-write"], idempotency: 'operation-id', composable: false, preconditions: ["no active story change","bound workspaces absent or clean","same operationId and plan fingerprint"], possibleErrors: imageImportErrors, repairRecipes: ['After an uncertain response inspect the same operationId; do not create a replacement.', 'Import first, refresh project/assets facts, then start a story change.'] },
  'capabilities.describe': { title: 'Describe capabilities', purpose: 'Return the shared authoring contract and available capability definitions.', minimumPolicy: 'observe', sideEffects: ['none'], idempotency: 'pure-read', composable: false, preconditions: [], possibleErrors: ['INVALID_REQUEST'], repairRecipes: readRepair },
  'project.inspect': { title: 'Inspect project', purpose: 'Read the canonical project object and revision view.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false, preconditions: ['project root must exist'], possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_INVALID'], repairRecipes: readRepair },
  'project.assets': { title: 'Inspect project assets', purpose: 'Read shared physical asset metadata, references, health facts, and the compatible background/portrait/avatar catalog.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false, preconditions: ['project root must exist'], possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_INVALID'], repairRecipes: readRepair },
  'object.inspect': { title: 'Inspect object', purpose: 'Read one stable object reference, its fingerprint, and one-level childRefs for exact traversal.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['objectRef must identify one object'], possibleErrors: ['OBJECT_NOT_FOUND', 'OBJECT_AMBIGUOUS', 'OBJECT_REF_STALE'], repairRecipes: readRepair },
  'change.begin': { title: 'Begin change', purpose: 'Create an isolated authoring change from a fresh project snapshot.', minimumPolicy: 'stage', sideEffects: ['project-read', 'change-store-write'], idempotency: 'non-idempotent', composable: false, preconditions: ['project root must be stable', 'no conflicting active change'], possibleErrors: [...commonErrors, 'CHANGE_ID_AMBIGUOUS'], repairRecipes: ['inspect the project and session state before starting a new change'] },
  'scene.create': { title: 'Create scene', purpose: 'Create one typed scene document inside the active change.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'operationId is fresh or identical'], possibleErrors: [...commonErrors, 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ["use instruction name 'timeline' with the timeline id in args[0]; never use 'timeline.play'", ...mutateRepair] },
  'scene.patch': { title: 'Patch scene', purpose: 'Patch one scene object using a current fingerprint.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'target fingerprint is current'], possibleErrors: [...commonErrors, 'OBJECT_NOT_FOUND', 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ["use instruction name 'timeline' with the timeline id in args[0]; never use 'timeline.play'", ...mutateRepair] },
  'variable.ensure': { title: 'Ensure variable', purpose: 'Ensure one variable declaration without changing an equivalent declaration.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN'], possibleErrors: [...commonErrors, 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'character.ensure': { title: 'Ensure character', purpose: 'Create or update one character declaration with a table fingerprint.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'character table fingerprint is current'], possibleErrors: [...commonErrors, 'OBJECT_REF_STALE', 'OBJECT_AMBIGUOUS', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'character.remove': { title: 'Remove character', purpose: 'Remove one character declaration with a table fingerprint.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'character table fingerprint is current'], possibleErrors: [...commonErrors, 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'timeline.create': { title: 'Create timeline', purpose: 'Create one validated Wave 2 presentation timeline.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'definition passes the shared timeline whitelist'], possibleErrors: [...commonErrors, 'VALIDATION_FAILED', 'UNSUPPORTED_OPERATION', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'timeline.patch': { title: 'Patch timeline', purpose: 'Patch one timeline track or cue using its current fingerprint.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'target fingerprint is current'], possibleErrors: [...commonErrors, 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['object.inspect the timeline and copy an exact trackRef from childRefs; inspect that track and copy an exact cueRef from childRefs', 'copy portrait target from project.assets.portraits[].timelineTarget', ...mutateRepair] },
  'project.entry-scene.set': { title: 'Set entry scene', purpose: 'Set the project entry scene with an entry-field fingerprint.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'target scene exists', 'entry fingerprint is current'], possibleErrors: [...commonErrors, 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'project.validate': { title: 'Validate project', purpose: 'Run shared validation and write fresh validation evidence.', minimumPolicy: 'observe', sideEffects: ['project-read', 'evidence-write'], idempotency: 'idempotent', composable: false, preconditions: ['project snapshot is readable'], possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_INVALID', 'CHANGE_NOT_FOUND'], repairRecipes: ['inspect the project or change before retrying validation'] },
  'project.simulate': { title: 'Simulate project', purpose: 'Run the shared deterministic simulation and write evidence.', minimumPolicy: 'observe', sideEffects: ['project-read', 'evidence-write'], idempotency: 'idempotent', composable: false, preconditions: ['project snapshot is readable'], possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_INVALID', 'SIMULATION_INCOMPLETE', 'RUNTIME_FAILED'], repairRecipes: ['inspect validation and simulation evidence before retrying'] },
  'runtime.run-from': { title: 'Run from scene', purpose: 'Run one explicit deterministic runtime path and persist its trace.', minimumPolicy: 'stage', sideEffects: ['runtime-process', 'evidence-write'], idempotency: 'non-idempotent', composable: false, preconditions: ['active change is OPEN', 'scene and choices are explicit'], possibleErrors: ['RUNTIME_FAILED', 'RUNTIME_TIMED_OUT', 'PROJECT_INVALID'], repairRecipes: ['label is an optional in-scene @label name; omit label to run from the scene beginning', 'inspect the scene, validate, and retry with explicit choices'] },
  'runtime.read-trace': { title: 'Read runtime trace', purpose: 'Read a persisted runtime trace with an optional stable query.', minimumPolicy: 'observe', sideEffects: ['change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['traceId must identify a stored trace'], possibleErrors: ['PROJECT_NOT_FOUND', 'CHANGE_NOT_FOUND'], repairRecipes: readRepair },
  'runtime.read-preview': { title: 'Read actual Editor preview', purpose: 'Read actual bound-Editor preview events, presentation snapshots and source object refs for the saved project. Separate from Core explicit-path evidence and from screenshots; never certifies pixels or approves/commits a change.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false,
    preconditions: ['Open the normal bound Editor on this saved project and actually play its preview; drafts are not published', 'Only status=current belongs to the current saved source; check observation.state for partial or completed runs'],
    possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_BUSY', 'PREVIEW_OBSERVATION_UNAVAILABLE', 'PREVIEW_OBSERVATION_STALE', 'PREVIEW_OBSERVATION_CORRUPT'],
    repairRecipes: ['Use the browser to play/reload the bound Editor preview. Do not infer visuals from runtime.run-from.', 'For ambiguous workspaces use an availablePreviews previewId; page with offset/limit while keeping that previewId.', 'Use observation.events objectRef with object.inspect and existing scene.patch/timeline.patch in an isolated change. Saved-project observations do not describe unsaved working changes. After an authorized commit synchronize the Editor, replay and read a new preview.'] },
  'change.diff': { title: 'Diff change', purpose: 'Read file and operation-ledger differences for the active change.', minimumPolicy: 'observe', sideEffects: ['change-store-read', 'evidence-write'], idempotency: 'idempotent', composable: false, preconditions: ['active change must be readable'], possibleErrors: ['CHANGE_NOT_FOUND', 'CHANGE_NOT_OPEN'], repairRecipes: readRepair },
  'change.commit': { title: 'Commit change', purpose: 'Commit one validated staged change to the project.', minimumPolicy: 'apply', sideEffects: ['project-write', 'change-store-write'], idempotency: 'non-idempotent', composable: false, preconditions: ['active change is OPEN', 'bound human workspaces are absent or clean', 'fresh validation, simulation, and runtime evidence satisfy the commit contract', 'integration changes require a fresh owner approval reference'], possibleErrors: ['CHANGE_NOT_FOUND', 'CHANGE_NOT_OPEN', 'CHANGE_BUSY', 'PROJECT_BUSY', 'PROJECT_CHANGED_SINCE_BEGIN', 'HUMAN_WORKSPACE_DIRTY', 'HUMAN_WORKSPACE_BUSY', 'HUMAN_WORKSPACE_STATE_CORRUPT', 'VALIDATION_REQUIRED', 'VALIDATION_STALE', 'VALIDATION_FAILED', 'SIMULATION_REQUIRED', 'RUNTIME_EVIDENCE_REQUIRED', 'REVIEW_APPROVAL_REQUIRED', 'REVIEW_APPROVAL_STALE', 'REVIEW_RETURNED', 'COMMIT_FAILED_RECOVERED', 'COMMIT_RECOVERY_FAILED'], repairRecipes: ['inspect session, project, diff, and recovery journal; manual recovery is required when commit recovery fails'] },
  'change.rollback': { title: 'Rollback change', purpose: 'Mark one open change rolled back without touching the project.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'idempotent', composable: false, preconditions: ['active change is OPEN'], possibleErrors: ['CHANGE_NOT_FOUND', 'CHANGE_NOT_OPEN'], repairRecipes: readRepair },
  'change.recovery.inspect': { title: 'Inspect change recovery', purpose: 'Read the current transaction journal, locks, project file identities, and the one safe recovery disposition.', minimumPolicy: 'observe', sideEffects: ['change-store-read', 'project-read'], idempotency: 'pure-read', composable: false, preconditions: ['active change must be readable'], possibleErrors: ['CHANGE_NOT_FOUND', 'CHANGE_BUSY', 'PROJECT_BUSY', 'LEASE_CORRUPT', 'CHANGE_STORE_CORRUPT', 'CHANGE_STORE_FORMAT_UNSUPPORTED', 'JOURNAL_CORRUPT', 'PROJECT_IDENTITY_MISMATCH'], repairRecipes: ['read the recovery inspection and use its disposition; manual states must not be guessed through'] },
  'change.recovery.execute': { title: 'Execute change recovery', purpose: 'Apply only the recovery action returned by a fresh recovery inspection.', minimumPolicy: 'apply', sideEffects: ['project-read', 'project-write', 'change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is readable', 'policy is apply', 'recoveryToken is fresh', 'disposition is not manual'], possibleErrors: ['CHANGE_NOT_FOUND', 'CHANGE_BUSY', 'PROJECT_BUSY', 'LEASE_CORRUPT', 'CHANGE_STORE_CORRUPT', 'CHANGE_STORE_FORMAT_UNSUPPORTED', 'JOURNAL_CORRUPT', 'RECOVERY_NOT_REQUIRED', 'RECOVERY_PLAN_STALE', 'RECOVERY_AMBIGUOUS', 'RECOVERY_EXECUTION_FAILED', 'PROJECT_IDENTITY_MISMATCH', 'OPERATION_ID_CONFLICT'], repairRecipes: ['run change.recovery.inspect again after any stale or lock error; never reuse a stale token'] },
  'composition.compare': { title: 'Compare candidates', purpose: 'Compare two to eight sealed delivery capsules into a deterministic conflict report without touching the project.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['two to eight sealed capsule refs on one project identity and base revision'], possibleErrors: [...commonErrors, 'CAPSULE_IDENTITY_MISMATCH', 'CANDIDATE_PROJECT_MISMATCH', 'CANDIDATE_BASE_MISMATCH', 'CANDIDATE_NOT_COMPOSABLE'], repairRecipes: ['re-seal the rejected capsules from a fresh project.inspect baseline', ...readRepair] },
  'composition.plan': { title: 'Plan integration', purpose: 'Resolve conflicts with explicit choices and seal a dry-run verified integration plan artifact.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read', 'change-store-write', 'evidence-write'], idempotency: 'idempotent', composable: false, preconditions: ['candidateRefs match a fresh comparison', 'every selection-required conflict has an explicit unit choice or a verified human decision'], possibleErrors: [...commonErrors, 'COMPOSITION_DEPENDENCY_MISSING', 'COMPOSITION_CONFLICT_UNRESOLVED', 'COMPOSITION_PLAN_STALE', 'REVIEW_NOT_FOUND', 'REVIEW_DECISION_REQUIRED', 'REVIEW_DECISION_INVALID', 'REVIEW_DECISION_STALE', 'REVIEW_RETURNED'], repairRecipes: ['re-run composition.compare after any project movement, then re-plan'] },
  'composition.inspect': { title: 'Inspect composition plan', purpose: 'Read back one sealed plan artifact with its fingerprint and dry-run evidence.', minimumPolicy: 'observe', sideEffects: ['change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['planId and artifactSha256 identify a stored plan'], possibleErrors: ['INVALID_REQUEST', 'CHANGE_NOT_FOUND', 'PROJECT_IDENTITY_MISMATCH', 'CAPSULE_IDENTITY_MISMATCH'], repairRecipes: readRepair },
  'composition.execute': { title: 'Execute integration replay', purpose: 'Replay one sealed plan into an OPEN integration change with CAS progress, exact resume and a READY commit gate.', minimumPolicy: 'stage', sideEffects: ['project-read', 'change-store-write', 'evidence-write'], idempotency: 'idempotent', composable: false, preconditions: ['sealed plan is dry-run passed', 'project revision still matches the plan baseline'], possibleErrors: [...commonErrors, 'COMPOSITION_PLAN_STALE', 'COMPOSITION_PLAN_INVALID', 'COMPOSITION_REPLAY_FAILED', 'COMPOSITION_INCOMPLETE', 'CHANGE_NOT_OPEN'], repairRecipes: ['resume with the same executeOperationId; FAILED integrations only allow inspect/diff/rollback', ...mutateRepair] },
  'review.prepare-comparison': { title: 'Prepare comparison review', purpose: 'Create an immutable human-review workspace from a fresh comparison.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read', 'change-store-write'], idempotency: 'non-idempotent', composable: false, preconditions: ['candidateRefs identify two to eight capsules on one fresh project baseline'], possibleErrors: [...commonErrors, 'CAPSULE_IDENTITY_MISMATCH', 'CANDIDATE_PROJECT_MISMATCH', 'CANDIDATE_BASE_MISMATCH', 'REVIEW_IDENTITY_MISMATCH'], repairRecipes: ['inspect the current project and candidate identities before preparing another review'] },
  'review.inspect-decision': { title: 'Inspect review decision', purpose: 'Read and verify an Editor comparison decision without creating human receipts.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['reviewId identifies a comparison workspace'], possibleErrors: ['REVIEW_NOT_FOUND', 'REVIEW_IDENTITY_MISMATCH', 'REVIEW_FORMAT_UNSUPPORTED', 'REVIEW_DECISION_REQUIRED', 'REVIEW_DECISION_INVALID', 'REVIEW_DECISION_STALE', 'REVIEW_RETURNED'], repairRecipes: ['wait for the owner decision in Editor; do not synthesize a decision in Agent Port'] },
  'review.prepare-result': { title: 'Prepare result review', purpose: 'Create an immutable result review and preview fixture from a READY integration change.', minimumPolicy: 'stage', sideEffects: ['project-read', 'change-store-read', 'change-store-write'], idempotency: 'non-idempotent', composable: false, preconditions: ['plan and integration change are READY with fresh evidence'], possibleErrors: ['REVIEW_NOT_FOUND', 'REVIEW_IDENTITY_MISMATCH', 'REVIEW_FORMAT_UNSUPPORTED', 'REVIEW_RESULT_NOT_READY', 'REVIEW_APPROVAL_STALE', 'REVIEW_FIXTURE_CHANGED'], repairRecipes: ['inspect the integration and fresh evidence before preparing the result review'] },
  'review.inspect-approval': { title: 'Inspect review approval', purpose: 'Read and verify the owner approval or return receipt for an integration result review.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['resultReviewId identifies an integration-result workspace'], possibleErrors: ['REVIEW_NOT_FOUND', 'REVIEW_IDENTITY_MISMATCH', 'REVIEW_FORMAT_UNSUPPORTED', 'REVIEW_RESULT_NOT_READY', 'REVIEW_APPROVAL_REQUIRED', 'REVIEW_APPROVAL_STALE', 'REVIEW_RETURNED'], repairRecipes: ['wait for the owner approval or return decision in Editor; do not synthesize a receipt'] },
};

function definitionFor(id: AuthoringCapabilityId): AuthoringCapabilityDefinition {
  const item = metadata[id];
  const schema = definitions[id === 'asset.sources' ? 'assetSources'
    : id === 'project.gallery' ? 'gallery'
    : id === 'gallery.cg.create' ? 'galleryCgCreate'
    : id === 'gallery.cg.patch' ? 'galleryCgPatch'
    : id === 'asset.import.stage' ? 'assetImportStage'
    : id === 'asset.import.inspect' ? 'assetImportInspect'
    : id === 'asset.import.commit' ? 'assetImportCommit'
    : id === 'asset.import.recover' ? 'assetImportRecover'
    : id === 'capabilities.describe'
    ? 'describe'
    : id === 'project.inspect'
      ? 'inspect'
      : id === 'project.assets'
        ? 'assets'
        : id === 'object.inspect'
          ? 'objectInspect'
          : id === 'change.begin'
            ? 'begin'
            : id === 'scene.create'
              ? 'sceneCreate'
              : id === 'scene.patch'
                ? 'scenePatch'
                : id === 'variable.ensure'
                  ? 'variableEnsure'
                  : id === 'character.ensure'
                    ? 'characterEnsure'
                    : id === 'character.remove'
                      ? 'characterRemove'
                      : id === 'timeline.create'
                        ? 'timelineCreate'
                        : id === 'timeline.patch'
                          ? 'timelinePatch'
                          : id === 'project.entry-scene.set'
                            ? 'entrySceneSet'
                            : id === 'project.validate'
                              ? 'validate'
                              : id === 'project.simulate'
                                ? 'simulate'
                                : id === 'runtime.run-from'
                                  ? 'runFrom'
                                  : id === 'runtime.read-trace'
                                    ? 'readTrace'
                                    : id === 'runtime.read-preview'
                                      ? 'readPreview'
                                    : id === 'change.diff'
                                      ? 'diff'
                                      : id === 'change.commit'
                                        ? 'commit'
                                        : id === 'change.rollback'
                                          ? 'rollback'
                                          : id === 'change.recovery.inspect'
                                            ? 'recoveryInspect'
                                            : id === 'composition.compare'
                                              ? 'compositionCompare'
                                              : id === 'composition.plan'
                                                ? 'compositionPlan'
                                                : id === 'composition.inspect'
                                                  ? 'compositionInspect'
                                                  : id === 'composition.execute'
                                                    ? 'compositionExecute'
                                                    : id === 'review.prepare-comparison'
                                                      ? 'reviewPrepareComparison'
                                                      : id === 'review.inspect-decision'
                                                        ? 'reviewInspectDecision'
                                                        : id === 'review.prepare-result'
                                                          ? 'reviewPrepareResult'
                                                          : id === 'review.inspect-approval'
                                                            ? 'reviewInspectApproval'
                                                            : id === 'change.recovery.execute'
                                                              ? 'recoveryExecute'
                                                              : 'compositionExecute'];
  return {
    id,
    title: item.title,
    purpose: item.purpose,
    minimumPolicy: item.minimumPolicy,
    inputSchema: schema.inputSchema,
    outputSchema: schema.outputSchema,
    sideEffects: item.sideEffects,
    idempotency: item.idempotency,
    composable: item.composable,
    preconditions: item.preconditions,
    possibleErrors: item.composable ? [...item.possibleErrors, 'CANDIDATE_DEPENDENCY_NOT_READY', 'CANDIDATE_DEPENDENCY_CYCLE', 'CANDIDATE_OPERATION_FACTS_REQUIRED'] : item.possibleErrors,
    repairRecipes: item.repairRecipes,
    minimalExample: {
      input: schema.example.input,
      expectedResultShape: schema.example.expectedResultShape,
    },
  };
}

export const AUTHORING_CAPABILITY_REGISTRY = AUTHORING_CAPABILITY_IDS.map(definitionFor) as readonly AuthoringCapabilityDefinition[];

export function nativeCapabilityToMcpTool(id: AuthoringCapabilityId): string {
  return `surdet_${id.replace(/[.-]/g, '_')}`;
}

export function getCapabilityDefinition(id: AuthoringCapabilityId): AuthoringCapabilityDefinition {
  const definition = AUTHORING_CAPABILITY_REGISTRY.find((item) => item.id === id);
  if (definition === undefined) throw new Error(`未知 authoring capability：${id}`);
  return definition;
}

function isStrictObjectSchema(schema: JsonSchema): boolean {
  return schema['type'] === 'object' && schema['additionalProperties'] === false;
}

function isStrictObjectOrUnionSchema(schema: JsonSchema): boolean {
  if (isStrictObjectSchema(schema)) return true;
  const variants = schema['oneOf'];
  return Array.isArray(variants)
    && variants.length > 0
    && variants.every((variant) => typeof variant === 'object' && variant !== null && isStrictObjectSchema(variant as JsonSchema));
}

export function assertCapabilityRegistry(definitions: readonly CapabilityDefinition[]): void {
  if (definitions.length !== AUTHORING_CAPABILITY_IDS.length) {
    throw new Error(`authoring registry 必须是 ${AUTHORING_CAPABILITY_IDS.length} 项，实际 ${definitions.length}`);
  }
  const expectedIds = new Set<string>(AUTHORING_CAPABILITY_IDS);
  const ids = new Set<string>();
  const tools = new Set<string>();
  for (const definition of definitions) {
    if (!expectedIds.has(definition.id)) throw new Error(`未知 capability id：${definition.id}`);
    if (ids.has(definition.id)) throw new Error(`重复 capability id：${definition.id}`);
    ids.add(definition.id);
    const tool = nativeCapabilityToMcpTool(definition.id as AuthoringCapabilityId);
    if (tools.has(tool)) throw new Error(`MCP tool name 碰撞：${tool}`);
    tools.add(tool);
    if (!isStrictObjectOrUnionSchema(definition.inputSchema)) {
      throw new Error(`${definition.id} inputSchema 必须是严格 object 或严格 object oneOf schema`);
    }
    if (!isStrictObjectOrUnionSchema(definition.outputSchema)) {
      throw new Error(`${definition.id} outputSchema 必须是严格 object 或严格 object oneOf schema`);
    }
    if (definition.sideEffects.length === 0 || definition.possibleErrors.length === 0 || definition.repairRecipes.length === 0) {
      throw new Error(`${definition.id} 必须声明副作用、错误和修复配方`);
    }
    if (definition.minimalExample.input === undefined || definition.minimalExample.expectedResultShape === undefined) {
      throw new Error(`${definition.id} 必须声明最小示例`);
    }
    // Wave 5：composable 白名单纪律。
    if (typeof definition.composable !== 'boolean') {
      throw new Error(`${definition.id} composable 必须是显式 boolean`);
    }
    const isContentMutation = CONTENT_MUTATION_CAPABILITY_IDS.has(definition.id);
    if (definition.composable !== isContentMutation) {
      throw new Error(`${definition.id} composable=${String(definition.composable)} 与白名单不符`);
    }
    if (definition.id.startsWith('composition.') && definition.composable) {
      throw new Error(`composition capability 不允许 composable=true：${definition.id}`);
    }
  }
  if (ids.size !== expectedIds.size) throw new Error('authoring registry 缺少 capability id');
}

assertCapabilityRegistry(AUTHORING_CAPABILITY_REGISTRY);
