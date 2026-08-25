import type {
  AutonomyPolicy,
  CapabilityDefinition,
  IdempotencyClass,
  JsonSchema,
  SideEffectClass,
} from './capability-contract.js';

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

const evidenceFreshnessSchema = strictObject({
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
  directChange: jsonValueSchema,
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

const assetCatalogSchema = strictObject({
  backgrounds: arrayOf(assetEntrySchema),
  portraits: arrayOf(assetEntrySchema),
  avatars: arrayOf(assetEntrySchema),
}, ['backgrounds', 'portraits', 'avatars']);

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
  freshness: evidenceFreshnessSchema,
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
  freshness: evidenceFreshnessSchema,
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
  view: { const: 'working' },
  evidenceId: stringSchema,
  freshness: evidenceFreshnessSchema,
}, ['summary', 'semantic', 'files', 'view', 'evidenceId', 'freshness']);

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
  freshness: evidenceFreshnessSchema,
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

const definitions = {
  compositionCompare: {
    inputSchema: strictObject({
      candidateRefs: { ...arrayOf(strictObject({
        changeId: stringSchema,
        capsuleId: stringSchema,
        artifactSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      }, ['changeId', 'capsuleId', 'artifactSha256'])), minItems: 2, maxItems: 8 },
    }, ['candidateRefs']),
    outputSchema: strictObject({
      comparisonFingerprint: stringSchema,
      status: { enum: ['composable', 'review-only', 'blocked'] },
      candidates: arrayOf(jsonObjectSchema),
      identicalGroups: arrayOf(jsonObjectSchema),
      conflicts: arrayOf(jsonObjectSchema),
    }, ['comparisonFingerprint', 'status', 'candidates', 'identicalGroups', 'conflicts']),
    example: { input: {}, expectedResultShape: { comparisonFingerprint: 'cmp_...', status: 'composable', candidates: [], identicalGroups: [], conflicts: [] } },
  },
  compositionPlan: {
    inputSchema: strictObject({
      candidateRefs: { ...arrayOf(strictObject({
        changeId: stringSchema,
        capsuleId: stringSchema,
        artifactSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      }, ['changeId', 'capsuleId', 'artifactSha256'])), minItems: 2, maxItems: 8 },
      conflictResolutions: arrayOf(strictObject({
        conflictId: stringSchema,
        resolution: { enum: ['choose-unit', 'exclude-all', 'regenerate-candidate'] },
        chosenUnitId: stringSchema,
        actor: { enum: ['human', 'review-agent'] },
      }, ['conflictId', 'resolution', 'actor'])),
      reason: { type: 'string', maxLength: 500 },
    }, ['candidateRefs']),
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
    example: { input: {}, expectedResultShape: { rootIdentity: '...', revision: '...', scenes: [], variables: [], characters: [], assets: { backgrounds: [], portraits: [], avatars: [] }, objectCount: 0, referenceCount: 0 } },
  },
  assets: {
    inputSchema: emptyInputSchema,
    outputSchema: assetCatalogSchema,
    example: { input: {}, expectedResultShape: { backgrounds: [], portraits: [], avatars: [] } },
  },
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
    inputSchema: strictObject({ operationId: stringSchema, sceneId: stringSchema, patch: scenePatchSchema }, ['operationId', 'patch']),
    outputSchema: strictObject({ path: stringSchema, line: integerSchema, kind: stringSchema }, ['path', 'line', 'kind']),
    example: { input: { operationId: 'op_patch', patch: { kind: 'removeObject', target: 'scene:x/text:1@abc', expectedFingerprint: 'abc' } }, expectedResultShape: { path: 'content/scenario/x.gal', line: 1, kind: 'removeObject' } },
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
    outputSchema: strictObject({ view: { const: 'working' }, traceId: stringSchema, events: traceEventsSchema, count: integerSchema, seed: seedSchema, freshness: evidenceFreshnessSchema }, ['view', 'traceId', 'events', 'count', 'seed', 'freshness']),
    example: { input: { traceId: 'trace_...' }, expectedResultShape: { view: 'working', traceId: 'trace_...', events: [], count: 0, seed: 1592639710, freshness: { status: 'fresh', currentWorkingRevision: 1 } } },
  },
  diff: {
    inputSchema: emptyInputSchema,
    outputSchema: changeDiffResultSchema,
    example: { input: {}, expectedResultShape: { summary: { createdScenes: 0, modifiedScenes: 0, changedVariables: 0, warnings: [] }, semantic: [], files: [], view: 'working', evidenceId: 'diff_...', freshness: { status: 'fresh', currentWorkingRevision: 1 } } },
  },
  commit: {
    inputSchema: emptyInputSchema,
    outputSchema: strictObject({ changeId: stringSchema, status: { const: 'COMMITTED' }, files: stringArraySchema }, ['changeId', 'status', 'files']),
    example: { input: {}, expectedResultShape: { changeId: 'chg_...', status: 'COMMITTED', files: [] } },
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
} as const;

export const AUTHORING_CAPABILITY_IDS = [
  'capabilities.describe',
  'project.inspect',
  'project.assets',
  'object.inspect',
  'change.begin',
  'scene.create',
  'scene.patch',
  'variable.ensure',
  'character.ensure',
  'character.remove',
  'timeline.create',
  'timeline.patch',
  'project.entry-scene.set',
  'project.validate',
  'project.simulate',
  'runtime.run-from',
  'runtime.read-trace',
  'change.diff',
  'change.commit',
  'change.rollback',
  'change.recovery.inspect',
  'change.recovery.execute',
  'composition.compare',
  'composition.plan',
  'composition.inspect',
  'composition.execute',
] as const;

export type AuthoringCapabilityId = (typeof AUTHORING_CAPABILITY_IDS)[number];
export type AuthoringCapabilityDefinition = CapabilityDefinition<AuthoringCapabilityId>;

type DefinitionMetadata = {
  readonly title: string;
  readonly purpose: string;
  readonly minimumPolicy: AutonomyPolicy;
  readonly sideEffects: readonly SideEffectClass[];
  readonly idempotency: IdempotencyClass;
  /** Wave 5：true 仅限八项内容 mutation；其余（含 composition.*）必须 false。 */
  readonly composable: boolean;
  readonly preconditions: readonly string[];
  readonly possibleErrors: readonly string[];
  readonly repairRecipes: readonly string[];
};

/** 八项内容 mutation 白名单：composable=true 的唯一合法集合。 */
export const CONTENT_MUTATION_CAPABILITY_IDS = new Set<string>([
  'scene.create', 'scene.patch', 'variable.ensure', 'character.ensure',
  'character.remove', 'timeline.create', 'timeline.patch', 'project.entry-scene.set',
]);

const commonErrors = ['INVALID_REQUEST', 'PROJECT_INVALID', 'PROJECT_NOT_FOUND', 'POLICY_BLOCKED'] as const;
const readRepair = ['inspect the returned object or project facts before retrying'] as const;
const mutateRepair = ['inspect current object fingerprints, repair the request, then retry'] as const;

const metadata: Record<AuthoringCapabilityId, DefinitionMetadata> = {
  'capabilities.describe': { title: 'Describe capabilities', purpose: 'Return the shared authoring contract and available capability definitions.', minimumPolicy: 'observe', sideEffects: ['none'], idempotency: 'pure-read', composable: false, preconditions: [], possibleErrors: ['INVALID_REQUEST'], repairRecipes: readRepair },
  'project.inspect': { title: 'Inspect project', purpose: 'Read the canonical project object and revision view.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false, preconditions: ['project root must exist'], possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_INVALID'], repairRecipes: readRepair },
  'project.assets': { title: 'Inspect project assets', purpose: 'Read the shared background, portrait, and avatar catalog.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false, preconditions: ['project root must exist'], possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_INVALID'], repairRecipes: readRepair },
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
  'change.diff': { title: 'Diff change', purpose: 'Read file and operation-ledger differences for the active change.', minimumPolicy: 'observe', sideEffects: ['change-store-read', 'evidence-write'], idempotency: 'idempotent', composable: false, preconditions: ['active change must be readable'], possibleErrors: ['CHANGE_NOT_FOUND', 'CHANGE_NOT_OPEN'], repairRecipes: readRepair },
  'change.commit': { title: 'Commit change', purpose: 'Commit one validated staged change to the project.', minimumPolicy: 'apply', sideEffects: ['project-write', 'change-store-write'], idempotency: 'non-idempotent', composable: false, preconditions: ['active change is OPEN', 'fresh validation, simulation, and runtime evidence satisfy the commit contract'], possibleErrors: ['CHANGE_NOT_FOUND', 'CHANGE_NOT_OPEN', 'CHANGE_BUSY', 'PROJECT_BUSY', 'PROJECT_CHANGED_SINCE_BEGIN', 'VALIDATION_REQUIRED', 'VALIDATION_STALE', 'VALIDATION_FAILED', 'SIMULATION_REQUIRED', 'RUNTIME_EVIDENCE_REQUIRED', 'COMMIT_FAILED_RECOVERED', 'COMMIT_RECOVERY_FAILED'], repairRecipes: ['inspect session, project, diff, and recovery journal; manual recovery is required when commit recovery fails'] },
  'change.rollback': { title: 'Rollback change', purpose: 'Mark one open change rolled back without touching the project.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'idempotent', composable: false, preconditions: ['active change is OPEN'], possibleErrors: ['CHANGE_NOT_FOUND', 'CHANGE_NOT_OPEN'], repairRecipes: readRepair },
  'change.recovery.inspect': { title: 'Inspect change recovery', purpose: 'Read the current transaction journal, locks, project file identities, and the one safe recovery disposition.', minimumPolicy: 'observe', sideEffects: ['change-store-read', 'project-read'], idempotency: 'pure-read', composable: false, preconditions: ['active change must be readable'], possibleErrors: ['CHANGE_NOT_FOUND', 'CHANGE_BUSY', 'PROJECT_BUSY', 'LEASE_CORRUPT', 'CHANGE_STORE_CORRUPT', 'CHANGE_STORE_FORMAT_UNSUPPORTED', 'JOURNAL_CORRUPT', 'PROJECT_IDENTITY_MISMATCH'], repairRecipes: ['read the recovery inspection and use its disposition; manual states must not be guessed through'] },
  'change.recovery.execute': { title: 'Execute change recovery', purpose: 'Apply only the recovery action returned by a fresh recovery inspection.', minimumPolicy: 'apply', sideEffects: ['project-read', 'project-write', 'change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is readable', 'policy is apply', 'recoveryToken is fresh', 'disposition is not manual'], possibleErrors: ['CHANGE_NOT_FOUND', 'CHANGE_BUSY', 'PROJECT_BUSY', 'LEASE_CORRUPT', 'CHANGE_STORE_CORRUPT', 'CHANGE_STORE_FORMAT_UNSUPPORTED', 'JOURNAL_CORRUPT', 'RECOVERY_NOT_REQUIRED', 'RECOVERY_PLAN_STALE', 'RECOVERY_AMBIGUOUS', 'RECOVERY_EXECUTION_FAILED', 'PROJECT_IDENTITY_MISMATCH', 'OPERATION_ID_CONFLICT'], repairRecipes: ['run change.recovery.inspect again after any stale or lock error; never reuse a stale token'] },
  'composition.compare': { title: 'Compare candidates', purpose: 'Compare two to eight sealed delivery capsules into a deterministic conflict report without touching the project.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['two to eight sealed capsule refs on one project identity and base revision'], possibleErrors: [...commonErrors, 'CAPSULE_IDENTITY_MISMATCH', 'CANDIDATE_PROJECT_MISMATCH', 'CANDIDATE_BASE_MISMATCH', 'CANDIDATE_NOT_COMPOSABLE'], repairRecipes: ['re-seal the rejected capsules from a fresh project.inspect baseline', ...readRepair] },
  'composition.plan': { title: 'Plan integration', purpose: 'Resolve conflicts with explicit choices and seal a dry-run verified integration plan artifact.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read', 'change-store-write', 'evidence-write'], idempotency: 'idempotent', composable: false, preconditions: ['candidateRefs match a fresh comparison', 'every selection-required conflict has an explicit unit choice'], possibleErrors: [...commonErrors, 'COMPOSITION_DEPENDENCY_MISSING', 'COMPOSITION_CONFLICT_UNRESOLVED', 'COMPOSITION_PLAN_STALE'], repairRecipes: ['re-run composition.compare after any project movement, then re-plan'] },
  'composition.inspect': { title: 'Inspect composition plan', purpose: 'Read back one sealed plan artifact with its fingerprint and dry-run evidence.', minimumPolicy: 'observe', sideEffects: ['change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['planId and artifactSha256 identify a stored plan'], possibleErrors: ['INVALID_REQUEST', 'CHANGE_NOT_FOUND', 'PROJECT_IDENTITY_MISMATCH', 'CAPSULE_IDENTITY_MISMATCH'], repairRecipes: readRepair },
  'composition.execute': { title: 'Execute integration replay', purpose: 'Replay one sealed plan into an OPEN integration change with CAS progress, exact resume and a READY commit gate.', minimumPolicy: 'stage', sideEffects: ['project-read', 'change-store-write', 'evidence-write'], idempotency: 'idempotent', composable: false, preconditions: ['sealed plan is dry-run passed', 'project revision still matches the plan baseline'], possibleErrors: [...commonErrors, 'COMPOSITION_PLAN_STALE', 'COMPOSITION_PLAN_INVALID', 'COMPOSITION_REPLAY_FAILED', 'COMPOSITION_INCOMPLETE', 'CHANGE_NOT_OPEN'], repairRecipes: ['resume with the same executeOperationId; FAILED integrations only allow inspect/diff/rollback', ...mutateRepair] },
};

function definitionFor(id: AuthoringCapabilityId): AuthoringCapabilityDefinition {
  const item = metadata[id];
  const schema = definitions[id === 'capabilities.describe'
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
    possibleErrors: item.possibleErrors,
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
    if (definition.inputSchema['type'] !== 'object' || definition.inputSchema['additionalProperties'] !== false) {
      throw new Error(`${definition.id} inputSchema 必须是严格 object schema`);
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
