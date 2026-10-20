import type {
  AutonomyPolicy,
  CapabilityDefinition,
  IdempotencyClass,
  JsonSchema,
  SideEffectClass,
} from './capability-contract.js';
import { AGENT_IMAGE_MAX_FILES, AGENT_MEDIA_EXTENSIONS } from './agent-image-import.js';
import { REPLACEABLE_SCENE_INSTRUCTIONS } from './contracts.js';
import { TIMELINE_TRANSITION_ACTIONS } from '@surdet/core';

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
const readViewSchema: JsonSchema = { enum: ['project', 'working'], description: 'Explicit content source. Working requires an active change; it never falls back to project.' };
const readViewInputSchema = strictObject({ view: readViewSchema });
const sceneFragmentInputSchema = strictObject({
  fromLine: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 200 },
  expectedRevision: stringSchema, expectedWorkingRevision: { type: 'integer', minimum: 0 },
});
const sceneFragmentSchema = strictObject({
  revision: stringSchema, workingRevision: integerSchema,
  fromLine: integerSchema, totalLines: integerSchema, nextLine: integerSchema, truncated: booleanSchema,
  lines: arrayOf(strictObject({ line: integerSchema, text: stringSchema, eol: stringSchema, objectRefs: stringArraySchema }, ['line', 'text', 'eol', 'objectRefs'])),
}, ['revision', 'fromLine', 'totalLines', 'truncated', 'lines']);
const sceneContinuationSchema = strictObject({ sceneRef: stringSchema, revision: stringSchema, workingRevision: integerSchema }, ['sceneRef', 'revision', 'workingRevision']);
const importUuidSchema: JsonSchema = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' };
const importShaSchema: JsonSchema = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const importOperationSchema = strictObject({ operationId: importUuidSchema }, ['operationId']);
const importCommitSchema = strictObject({ operationId: importUuidSchema, planFingerprint: importShaSchema }, ['operationId', 'planFingerprint']);
const importRecoverSchema: JsonSchema = {
  ...strictObject({ operationId: importUuidSchema, planFingerprint: importShaSchema, manifestFingerprint: importShaSchema }, ['operationId']),
  oneOf: [{ required: ['planFingerprint'] }, { required: ['manifestFingerprint'] }],
};

// Capability results keep closed top-level fields. Dynamic variable/evidence
// values use a typed JSON-safe grammar, including Core's existing nested objects;
// declared variable types are still checked by the domain, not replaced by this schema.
const jsonValueSchema: JsonSchema = { $ref: '#/$defs/surdetJsonValue' };
const jsonValueDefinition: JsonSchema = {
  oneOf: [
    stringSchema,
    numberSchema,
    booleanSchema,
    nullSchema,
    arrayOf(jsonValueSchema),
    { type: 'object', additionalProperties: jsonValueSchema },
  ],
};

/** Root refs also cover existing nested object variables; unrelated contracts remain unchanged. */
function withJsonValueDefinition(schema: JsonSchema): JsonSchema {
  const usesValue = (value: unknown): boolean => value === jsonValueSchema
    || (value !== null && typeof value === 'object' && Object.values(value).some(usesValue));
  return usesValue(schema) ? { ...schema, $defs: { ...(schema.$defs as Record<string, JsonSchema> | undefined), surdetJsonValue: jsonValueDefinition } } : schema;
}

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
  when: { oneOf: [stringSchema, nullSchema] },
  effects: arrayOf(choiceEffectSchema),
  target: choiceTargetSchema,
}, ['label', 'target']);

const sceneChoiceBlockSchema = strictObject({
  kind: { const: 'choice' },
  options: arrayOf(choiceOptionSchema),
}, ['kind', 'options']);

// Scene blocks are recursive: a condition branch can contain another
// condition, choice, instruction, label, or text block. The public schemas
// keep the recursive nodes in the root $defs so the MCP/AJV validator can
// resolve them without a depth limit.
const sceneBlockRef: JsonSchema = { $ref: '#/$defs/sceneBlock' };

const sceneConditionBranchSchema: JsonSchema = {
  oneOf: [
    strictObject({
      kind: { const: 'if' },
      expr: stringSchema,
      blocks: { ...arrayOf(sceneBlockRef), minItems: 0 },
    }, ['kind', 'expr', 'blocks']),
    strictObject({
      kind: { const: 'elif' },
      expr: stringSchema,
      blocks: { ...arrayOf(sceneBlockRef), minItems: 0 },
    }, ['kind', 'expr', 'blocks']),
    strictObject({
      kind: { const: 'else' },
      blocks: { ...arrayOf(sceneBlockRef), minItems: 0 },
    }, ['kind', 'blocks']),
  ],
};

const sceneConditionBlockSchema: JsonSchema = strictObject({
  kind: { const: 'condition' },
  branches: { type: 'array', minItems: 1, items: { $ref: '#/$defs/sceneConditionBranch' } },
}, ['kind', 'branches']);

const sceneBlockSchema: JsonSchema = {
  oneOf: [
    sceneTextBlockSchema,
    sceneLabelBlockSchema,
    sceneInstructionBlockSchema,
    sceneChoiceBlockSchema,
    sceneConditionBlockSchema,
  ],
};

function conditionPatchBranchVariants(kind: 'if' | 'elif' | 'else'): JsonSchema[] {
  const properties: SchemaProperties = {
    kind: { const: kind },
    ...(kind === 'else' ? {} : { expr: stringSchema }),
    sourceBranch: stringSchema,
    blocks: arrayOf(sceneBlockRef),
  };
  const headerRequired = kind === 'else' ? ['kind'] : ['kind', 'expr'];
  return [
    strictObject(properties, [...headerRequired, 'sourceBranch', 'blocks']),
    { ...strictObject(properties, [...headerRequired, 'sourceBranch']), not: { required: ['blocks'] } },
    { ...strictObject(properties, [...headerRequired, 'blocks']), not: { required: ['sourceBranch'] } },
  ];
}

const sceneConditionPatchBranchSchema: JsonSchema = {
  oneOf: [
    ...conditionPatchBranchVariants('if'),
    ...conditionPatchBranchVariants('elif'),
    ...conditionPatchBranchVariants('else'),
  ],
};

const sceneConditionPatchSchema: JsonSchema = strictObject({
  kind: { const: 'condition' },
  branches: { type: 'array', minItems: 1, items: { $ref: '#/$defs/sceneConditionPatchBranch' } },
}, ['kind', 'branches']);

const scenePatchSchema: JsonSchema = {
  oneOf: [
    strictObject({ kind: { const: 'patchStageProperties' }, target: stringSchema, expectedFingerprint: stringSchema,
      instructionIndex: { type: 'integer', minimum: 0, description: 'Copy from the selected object.inspect details.stageInstructions entry; not a source line number. Inline choice rows may contain several entries.' }, values: { ...strictObject({
        x: { type: 'number', minimum: -100000, maximum: 100000 }, y: { type: 'number', minimum: -100000, maximum: 100000 },
        scale: { type: 'number', minimum: .01, maximum: 16 }, opacity: { type: 'number', minimum: 0, maximum: 1 },
        z: { type: 'integer', minimum: -32768, maximum: 32767 }, facing: { enum: ['left', 'right'] },
        baseHeight: { type: 'number', minimum: 1, maximum: 20000 }, anchorX: { type: 'number', minimum: 0, maximum: 1 }, anchorY: { type: 'number', minimum: 0, maximum: 1 },
      }), minProperties: 1 },
    }, ['kind', 'target', 'expectedFingerprint', 'instructionIndex', 'values']),
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
      kind: { const: 'insertBefore' },
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
      kind: { const: 'replaceChoiceGroup' },
      target: stringSchema,
      expectedFingerprint: stringSchema,
      choice: sceneChoiceBlockSchema,
    }, ['kind', 'target', 'expectedFingerprint', 'choice']),
    strictObject({
      kind: { const: 'replaceConditionBlock' },
      target: stringSchema,
      expectedFingerprint: stringSchema,
      condition: sceneConditionPatchSchema,
    }, ['kind', 'target', 'expectedFingerprint', 'condition']),
    strictObject({
      kind: { const: 'removeObject' },
      target: stringSchema,
      expectedFingerprint: stringSchema,
    }, ['kind', 'target', 'expectedFingerprint']),
    strictObject({
      kind: { const: 'renameLabel' }, target: stringSchema, expectedFingerprint: stringSchema, name: stringSchema,
    }, ['kind', 'target', 'expectedFingerprint', 'name']),
    strictObject({
      kind: { const: 'removeLabel' }, target: stringSchema, expectedFingerprint: stringSchema,
    }, ['kind', 'target', 'expectedFingerprint']),
  ],
};

const sceneSchemaDefinitions: Record<string, JsonSchema> = {
  sceneBlock: sceneBlockSchema,
  sceneConditionBranch: sceneConditionBranchSchema,
  sceneConditionPatchBranch: sceneConditionPatchBranchSchema,
};

const timelineCueSchema = strictObject({
  source: stringSchema,
  opacity: { type: 'number', minimum: 0, maximum: 1 },
  facing: { enum: ['left', 'right'] }, z: { type: 'integer', minimum: -32768, maximum: 32767 },
  baseHeight: { type: 'number', minimum: 1, maximum: 20000 },
  anchorX: { type: 'number', minimum: 0, maximum: 1 }, anchorY: { type: 'number', minimum: 0, maximum: 1 },
  distance: stringSchema, band: { enum: ['environment', 'foreground'] }, parallax: { type: 'number', minimum: 0, maximum: 2 },
  atMs: { type: 'integer', minimum: 0 },
  durationMs: { type: 'integer', minimum: 0 },
  easing: { enum: ['linear', 'inOutSine', 'outCubic', 'inOutCubic'] },
  action: { enum: ['pose', 'set', 'show', 'hide', 'move', 'expression', 'zoom', 'pan', 'shake', 'fade', 'tint', 'flash', 'wipe', ...TIMELINE_TRANSITION_ACTIONS, 'start', 'stop', 'bgm', 'se', 'voice'] },
  rule: { type: 'string', minLength: 1, description: 'screen rule cue only: exact prepared rule asset key' },
  soft: { type: 'number', minimum: 0, maximum: 1, default: 0.15 },
  reverse: { type: 'boolean', default: false },
  key: { type: 'string', description: 'background or audio cue: copy the matching project.assets usage.timeline; audio keys are channel-specific' },
  expression: { type: 'string', description: 'portrait cue only: copy project.assets.portraits[].expression for the selected timelineTarget' },
  position: stringSchema,
  alpha: { type: 'number', minimum: 0, maximum: 1 },
  scale: { type: 'number', exclusiveMinimum: 0, description: 'camera zoom cue only: positive scale' },
  x: { type: 'number', minimum: -100000, maximum: 100000, description: 'camera pan cue only' },
  y: { type: 'number', minimum: -100000, maximum: 100000, description: 'camera pan cue only' },
  strength: { type: 'number', minimum: 0, maximum: 64, description: 'camera shake cue only' },
  color: { type: 'number', minimum: 0, maximum: 16777215, description: 'screen tint cue only: 0xRRGGBB number' },
  kind: { type: 'string', description: 'particle start cue only: preset kind' },
}, ['atMs', 'durationMs', 'easing', 'action']);

const timelineTrackSchema = strictObject({
  kind: { enum: ['background', 'portrait', 'camera', 'screen', 'particle', 'audio', 'layer'] },
  target: { type: 'string', description: 'track target; for portrait copy project.assets.portraits[].timelineTarget' },
  cues: arrayOf(timelineCueSchema),
}, ['kind', 'cues']);

const timelineClipSchema = strictObject({ timelineId: stringSchema, atMs: { type: 'integer', minimum: 0, maximum: 600000 },
  repeat: { type: 'integer', minimum: 1, maximum: 100 }, gapMs: { type: 'integer', minimum: 0, maximum: 600000 }, targets: stringMapSchema,
}, ['timelineId', 'atMs']);
const timelineDefinitionSchema = strictObject({
  version: { enum: [1, 2] },
  clips: { ...arrayOf(timelineClipSchema), maxItems: 256 },
  id: stringSchema,
  durationMs: { type: 'integer', minimum: 0, maximum: 600000 },
  tracks: arrayOf(timelineTrackSchema),
}, ['version', 'id', 'durationMs', 'tracks']);

const timelinePatchSchema: JsonSchema = {
  oneOf: [
    strictObject({ kind: { const: 'setVersion' }, expectedFingerprint: stringSchema, version: { const: 2 } }, ['kind', 'expectedFingerprint', 'version']),
    strictObject({ kind: { const: 'setClips' }, expectedFingerprint: stringSchema, clips: { ...arrayOf(timelineClipSchema), maxItems: 256 } }, ['kind', 'expectedFingerprint', 'clips']),
    strictObject({
      kind: { const: 'addTrack' },
      expectedFingerprint: stringSchema,
      trackKind: { enum: ['background', 'portrait', 'camera', 'screen', 'particle', 'audio', 'layer'] },
      target: stringSchema,
    }, ['kind', 'expectedFingerprint', 'trackKind']),
    strictObject({
      kind: { const: 'setDuration' },
      expectedFingerprint: stringSchema,
      durationMs: { type: 'integer', minimum: 0, maximum: 600000 },
    }, ['kind', 'expectedFingerprint', 'durationMs']),
    strictObject({
      kind: { const: 'removeTrack' },
      expectedFingerprint: stringSchema,
      trackRef: stringSchema,
    }, ['kind', 'expectedFingerprint', 'trackRef']),
    strictObject({
      kind: { const: 'setTrackTarget' },
      expectedFingerprint: stringSchema,
      trackRef: stringSchema,
      target: { oneOf: [stringSchema, nullSchema] },
    }, ['kind', 'expectedFingerprint', 'trackRef', 'target']),
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
  kind: { enum: ['background', 'portrait', 'avatar', 'rule'] },
  key: stringSchema,
  timelineTarget: { type: 'string', description: 'canonical portrait track.target; copy this value instead of constructing it' },
  role: stringSchema,
  outfit: stringSchema,
  expression: stringSchema,
  configured: { const: true },
  overriddenSourcePaths: arrayOf(stringSchema),
  sourcePath: stringSchema,
  sourcePaths: arrayOf(stringSchema),
  visual: jsonObjectSchema,
  format: stringSchema,
  resolved: booleanSchema,
  usage: strictObject({
    scene: sceneInstructionBlockSchema,
    timeline: timelineTrackSchema,
  }, ['scene', 'timeline']),
}, ['kind', 'key', 'sourcePath', 'format', 'resolved']);

const projectAssetKindSchema = {
  enum: ['background', 'portrait', 'avatar', 'rule', 'music', 'ambience', 'sound-effect', 'voice', 'video', 'font', 'license', 'other'],
};
const projectAssetIssueCodeSchema = {
  enum: ['ASSET_REFERENCE_MISSING', 'ASSET_KEY_DUPLICATE', 'ASSET_NAME_INVALID', 'ASSET_FORMAT_UNSUPPORTED', 'ASSET_UNUSED'],
};
const projectAssetReferenceSchema = strictObject({
  referenceId: stringSchema,
  sourceKind: { enum: ['scene', 'timeline', 'character', 'gallery', 'config'] },
  sourceLabel: stringSchema,
  sourcePath: stringSchema,
  line: integerSchema,
  objectRef: stringSchema,
}, ['referenceId', 'sourceKind', 'sourceLabel', 'sourcePath']);
const projectAssetItemSchema = strictObject({
  sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
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
  usage: strictObject({ scene: sceneInstructionBlockSchema, timeline: timelineTrackSchema }, ['scene']),
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
  rule: projectAssetKindSummarySchema,
  music: projectAssetKindSummarySchema,
  ambience: projectAssetKindSummarySchema,
  'sound-effect': projectAssetKindSummarySchema,
  voice: projectAssetKindSummarySchema,
  video: projectAssetKindSummarySchema,
  font: projectAssetKindSummarySchema,
  license: projectAssetKindSummarySchema,
  other: projectAssetKindSummarySchema,
}, ['background', 'portrait', 'avatar', 'rule', 'music', 'ambience', 'sound-effect', 'voice', 'video', 'font', 'license', 'other']);
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
  view: readViewSchema,
  backgrounds: arrayOf(assetEntrySchema),
  portraits: arrayOf(assetEntrySchema),
  avatars: arrayOf(assetEntrySchema),
  rules: arrayOf(assetEntrySchema),
  intelligence: projectAssetIntelligenceSchema,
}, ['backgrounds', 'portraits', 'avatars', 'rules', 'intelligence']);

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
      'background', 'portrait', 'avatar', 'rule', 'music', 'ambience', 'sound-effect', 'voice', 'video', 'font', 'license', 'other',
    ].map((kind) => [kind, { files: 0, measuredFiles: 0 }])),
  },
  issues: [],
};

const fontRoleFields: SchemaProperties = { body: { type: ['string', 'null'] }, title: { type: ['string', 'null'] }, ui: { type: ['string', 'null'] } };
const galleryPolicyFields = { cgs: { enum: ['save', 'profile', null] }, music: { enum: ['save', 'profile', null] }, texts: { enum: ['save', 'profile', null] }, endings: { enum: ['save', 'profile', null] }, profiles: { enum: ['save', 'profile', null] }, terms: { enum: ['save', 'profile', null] } };
const galleryPolicyInspection = strictObject({ value: { oneOf: [strictObject(galleryPolicyFields), nullSchema] }, effective: strictObject({ cgs: { enum: ['save', 'profile'] }, music: { enum: ['save', 'profile'] }, texts: { enum: ['save', 'profile'] }, endings: { enum: ['save', 'profile'] }, profiles: { enum: ['save', 'profile'] }, terms: { enum: ['save', 'profile'] } }, ['cgs', 'music', 'texts', 'endings', 'profiles', 'terms']), fingerprint: stringSchema }, ['value', 'effective', 'fingerprint']);
const playerConfigFields: SchemaProperties = {
  title: { type: ['string', 'null'] }, subtitle: { type: ['string', 'null'] },
  titleBackground: { type: ['string', 'null'] }, titleLogo: { type: ['string', 'null'] },
  firstRunHint: { type: ['string', 'null'] },
  endScenes: { oneOf: [stringArraySchema, nullSchema] },
  font: { type: ['string', 'null'] },
  fonts: { oneOf: [strictObject(fontRoleFields, Object.keys(fontRoleFields)), nullSchema] },
};
const playerConfigSchema = strictObject({ values: strictObject(playerConfigFields, Object.keys(playerConfigFields)), fingerprint: stringSchema }, ['values', 'fingerprint']);

const themeConfigSchema = strictObject({
  value: { oneOf: [jsonObjectSchema, nullSchema] },
  effective: jsonObjectSchema,
  sources: jsonObjectSchema,
  titleLogo: { type: ['string', 'null'] },
  fingerprint: stringSchema,
}, ['value', 'effective', 'titleLogo', 'fingerprint']);

const uiColorSchema: JsonSchema = { type: 'integer', minimum: 0, maximum: 0xffffff };
const uiOpacitySchema: JsonSchema = { type: 'number', minimum: 0, maximum: 1 };
const uiInsetsFields = Object.fromEntries(['top', 'right', 'bottom', 'left'].map(key => [key, { type: 'number', minimum: 0, maximum: 65535 }])) as SchemaProperties;
const uiShadowSchema = strictObject({ x: { type: 'number', minimum: -4096, maximum: 4096 }, y: { type: 'number', minimum: -4096, maximum: 4096 },
  blur: { type: 'number', minimum: 0, maximum: 256 }, color: uiColorSchema, opacity: uiOpacitySchema }, ['x', 'y', 'blur', 'color', 'opacity']);
const uiStyleSchema = strictObject({
  color: uiColorSchema, background: uiColorSchema, opacity: uiOpacitySchema, backgroundOpacity: uiOpacitySchema,
  fontSize: { type: 'number', exclusiveMinimum: 0 }, align: { enum: ['left', 'center', 'right'] }, fontRole: { enum: ['body', 'title', 'ui'] },
  fontWeight: { enum: [100, 200, 300, 400, 500, 600, 700, 800, 900] }, lineHeight: { type: 'number', minimum: 0.5, maximum: 4 },
  letterSpacing: { type: 'number', minimum: -32, maximum: 128 },
  textShadows: { ...arrayOf(uiShadowSchema), maxItems: 4 }, shadows: { ...arrayOf(uiShadowSchema), maxItems: 4 },
  backgroundGradient: { oneOf: [strictObject({ from: uiColorSchema, to: uiColorSchema, angle: { type: 'number', minimum: 0, maximum: 360 } }, ['from', 'to', 'angle']), nullSchema] },
  backgroundImage: { oneOf: [strictObject({ asset: stringSchema, fit: { enum: ['stretch', 'contain', 'cover'] },
    slice: strictObject({ ...Object.fromEntries(Object.entries(uiInsetsFields).map(([key, value]) => [key, { ...value, type: 'integer' }])), fillCenter: booleanSchema }, ['top', 'right', 'bottom', 'left', 'fillCenter']),
  }, ['asset', 'fit']), nullSchema], description: 'Project background asset key only. Slicing requires stretch and actual source-image bounds; null disables the inherited button skin.' },
  border: { oneOf: [strictObject({ width: { type: 'number', minimum: 0, maximum: 256 }, color: uiColorSchema, opacity: uiOpacitySchema }, ['width', 'color', 'opacity']), nullSchema] },
  borderRadius: { type: 'number', minimum: 0, maximum: 65535 }, padding: strictObject(uiInsetsFields, ['top', 'right', 'bottom', 'left']),
  columns: { enum: [1, 2] }, imageFit: { enum: ['contain', 'cover', 'fill'] },
});
const uiStateStyleSchema = strictObject(Object.fromEntries(
  ['color', 'background', 'opacity', 'backgroundOpacity', 'backgroundGradient', 'backgroundImage', 'textShadows', 'shadows']
    .map(key => [key, (uiStyleSchema.properties as SchemaProperties)[key]!]),
));
const uiStatesSchema = strictObject(Object.fromEntries(['hover', 'focus', 'pressed', 'disabled'].map(key => [key, uiStateStyleSchema])));
const uiMotionSchema = strictObject({ durationMs: { type: 'number', minimum: 0, maximum: 1000 }, opacity: uiOpacitySchema,
  x: { type: 'number', minimum: -128, maximum: 128 }, y: { type: 'number', minimum: -128, maximum: 128 },
  scale: { type: 'number', minimum: 0.8, maximum: 1.2 }, easing: { enum: ['linear', 'ease-out', 'ease-in-out'] } }, ['durationMs']);
const uiTransitionSchema = strictObject({ enter: uiMotionSchema, exit: uiMotionSchema });
const uiNodeInputSchema: JsonSchema = { ...jsonObjectSchema, properties: { style: uiStyleSchema, states: uiStatesSchema, transition: uiTransitionSchema }, description: 'ProjectUiNode; Core validates node types, root-only transition, children and all nested styles. See docs/ui-style-contract.md and docs/ui-interaction-contract.md.' };
const uiInspectionSchema = strictObject({
  view: readViewSchema,
  value: { oneOf: [jsonObjectSchema, nullSchema] },
  defaultPages: stringArraySchema,
  nodes: arrayOf(strictObject({ page: stringSchema, id: stringSchema, type: stringSchema, parentId: { type: ['string', 'null'] },
    effectiveStyle: jsonObjectSchema, effectiveStates: jsonObjectSchema, effectiveTransition: jsonObjectSchema,
    rect: jsonObjectSchema, contentRect: jsonObjectSchema }, ['page', 'id', 'type', 'parentId', 'effectiveStyle', 'rect', 'contentRect'])),
  fingerprint: stringSchema,
}, ['value', 'defaultPages', 'nodes', 'fingerprint']);

const projectInspectionSchema = strictObject({
  plugins: arrayOf(strictObject({ id: stringSchema, entry: stringSchema, apiVersion: { const: 1 }, stateVersion: integerSchema,
    instructions: arrayOf(strictObject({ name: stringSchema, blocking: booleanSchema,
      parameters: arrayOf(strictObject({ name: stringSchema, type: { enum: ['string', 'number', 'boolean'] }, optional: booleanSchema }, ['name', 'type'])),
      modifiers: arrayOf(strictObject({ name: stringSchema, type: { enum: ['string', 'number', 'boolean'] }, optional: booleanSchema }, ['name', 'type'])) }, ['name', 'blocking', 'parameters'])) }, ['id', 'entry', 'apiVersion', 'instructions'])),
  playerConfig: playerConfigSchema,
  themeConfig: themeConfigSchema,
  stageConfig: strictObject({ value: { oneOf: [jsonObjectSchema, nullSchema] }, effective: { oneOf: [jsonObjectSchema, nullSchema] }, fingerprint: stringSchema }, ['value', 'effective', 'fingerprint']),
  view: readViewSchema,
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
  charactersFingerprint: { type: 'string', description: 'Current complete character table fingerprint for character.ensure/remove, including an empty table; follows view.' },
  assets: assetCatalogSchema,
  objectCount: integerSchema,
  referenceCount: integerSchema,
}, [
  'rootIdentity', 'revision', 'scenes', 'variables', 'characters', 'assets', 'objectCount', 'referenceCount',
]);

const objectInspectionSchema = strictObject({
  view: readViewSchema,
  fragment: sceneFragmentSchema,
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
  range: strictObject({
    start: strictObject({ line: { type: 'integer', minimum: 1 }, col: { type: 'integer', minimum: 1 } }, ['line', 'col']),
    end: strictObject({ line: { type: 'integer', minimum: 1 }, col: { type: 'integer', minimum: 1 } }, ['line', 'col']),
  }, ['start', 'end']),
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
  status: { enum: ['passed', 'failed', 'incomplete'] },
  termination: { enum: ['ended', 'error', 'pruned', 'budget-exhausted', 'requires-extension'] },
  prunedReason: { enum: ['state-signature', 'path-budget', 'step-budget'] },
  error: stringSchema,
}, ['choices', 'finalVariables', 'status', 'termination']);

const storyLocationSchema = strictObject({ sceneId: stringSchema, file: stringSchema, index: integerSchema,
  line: integerSchema, col: integerSchema, sourceVersion: stringSchema }, ['sceneId', 'file', 'index', 'line', 'col', 'sourceVersion']);
const storyCoverageSchema = strictObject({
  scenes: arrayOf(strictObject({ sceneId: stringSchema, file: stringSchema, sourceVersion: stringSchema, visited: booleanSchema,
    executedInstructions: integerSchema, totalInstructions: integerSchema }, ['sceneId', 'file', 'sourceVersion', 'visited', 'executedInstructions', 'totalInstructions'])),
  branches: arrayOf(strictObject({ location: storyLocationSchema, optionIndex: integerSchema, label: stringSchema,
    available: integerSchema, selected: integerSchema, conditionFalse: integerSchema, budgetStops: integerSchema,
    status: { enum: ['visited', 'unvisited', 'condition-not-met', 'budget-exhausted'] } },
    ['location', 'optionIndex', 'label', 'available', 'selected', 'conditionFalse', 'budgetStops', 'status'])),
  conditions: arrayOf(strictObject({ location: storyLocationSchema, expression: stringSchema, optionIndex: integerSchema,
    trueCount: integerSchema, falseCount: integerSchema }, ['location', 'expression', 'trueCount', 'falseCount'])),
  stops: arrayOf(strictObject({ kind: { enum: ['runtime-error', 'path-budget', 'step-budget', 'requires-extension'] },
    location: { oneOf: [storyLocationSchema, nullSchema] }, message: stringSchema }, ['kind', 'location', 'message'])),
  hostInstructions: arrayOf(storyLocationSchema),
}, ['scenes', 'branches', 'conditions', 'stops', 'hostInstructions']);

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
  coverage: storyCoverageSchema,
};

const simulationReportRequired = [
  'status', 'entryScene', 'pathsExplored', 'choiceBranches', 'paths', 'budgetExhausted',
  'runtimeErrors', 'endings', 'deadEndScenes', 'cyclesPruned', 'saveRoundtrips',
  'seed', 'coverage',
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
  condition: strictObject({ expression: stringSchema, result: booleanSchema, optionIndex: integerSchema }, ['expression', 'result']),
  controlFlow: strictObject({ from: stringSchema, to: stringSchema }, ['from', 'to']),
  choice: strictObject({ optionIndex: integerSchema, label: stringSchema }, ['optionIndex', 'label']),
}, ['kind', 'source']);

const traceEventsSchema = arrayOf(traceEventSchema);

const previewFileFactSchema = strictObject({ path: stringSchema, sha256: importShaSchema }, ['path', 'sha256']);
const previewContentTargetSchema = { oneOf: [
  strictObject({ kind: { const: 'saved-project' } }, ['kind']),
  strictObject({ kind: { const: 'working-change' }, changeId: stringSchema, workingRevision: integerSchema }, ['kind', 'changeId', 'workingRevision']),
  strictObject({ kind: { const: 'candidate' }, changeId: stringSchema, capsuleId: stringSchema, artifactSha256: importShaSchema }, ['kind', 'changeId', 'capsuleId', 'artifactSha256']),
  strictObject({ kind: { const: 'integration-result' }, changeId: stringSchema, planId: stringSchema, planFingerprint: importShaSchema, workingRevision: integerSchema }, ['kind', 'changeId', 'planId', 'planFingerprint', 'workingRevision']),
] };
const previewReplaySourceSchema = strictObject({ sceneId: stringSchema, kind: { enum: ['text', 'choice'] },
  anchor: { oneOf: [stringSchema, nullSchema] }, fingerprint: importShaSchema }, ['sceneId', 'kind', 'anchor', 'fingerprint']);
const previewSeedSchema = { type: 'integer', minimum: 0, maximum: 4294967295 };
const previewPlaybackSchema = strictObject({ seed: previewSeedSchema, sceneId: stringSchema, label: stringSchema,
  choices: { type: 'array', maxItems: 256, items: strictObject({ source: previewReplaySourceSchema, optionFingerprint: importShaSchema }, ['source', 'optionFingerprint']) },
  target: { oneOf: [previewReplaySourceSchema, nullSchema] },
  targetVisit: { type: 'integer', minimum: 1, maximum: 9007199254740991 },
}, ['seed', 'sceneId', 'choices', 'target']);
const previewObservationSchema = strictObject({
  previewId: stringSchema, previewGeneration: integerSchema, workspaceSessionId: stringSchema, projectIdentity: stringSchema,
  projectRevision: importShaSchema, coordinationRevision: importShaSchema, sceneId: stringSchema, label: stringSchema,
  startedAt: stringSchema, updatedAt: stringSchema, runtimeGeneration: { oneOf: [integerSchema, nullSchema] },
  state: { enum: ['starting', 'running', 'passed', 'failed'] }, firstError: stringSchema,
  source: strictObject({ files: arrayOf(previewFileFactSchema), assets: arrayOf(previewFileFactSchema) }, ['files', 'assets']),
  content: strictObject({ target: previewContentTargetSchema, contentRevision: importShaSchema }, ['target', 'contentRevision']),
  seed: previewSeedSchema,
  events: arrayOf(strictObject({ type: { const: 'surdet-preview-trace-event' }, traceId: stringSchema, generation: integerSchema,
    sequence: integerSchema, coreEmitted: { const: true }, presentationApplied: booleanSchema,
    presentationBefore: jsonObjectSchema, presentationAfter: jsonObjectSchema, event: traceEventSchema,
    playback: previewPlaybackSchema,
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
    removedScenes: integerSchema,
    changedVariables: integerSchema,
    warnings: stringArraySchema,
  }, ['createdScenes', 'modifiedScenes', 'changedVariables', 'warnings']),
  semantic: arrayOf(diffEntrySchema),
  files: arrayOf(strictObject({
    path: stringSchema,
    beforeSha256: stringSchema,
    afterSha256: stringSchema,
    changeType: { enum: ['created', 'modified', 'deleted'] },
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

const capabilityBriefSchema = strictObject({
  id: stringSchema, mcpTool: stringSchema, title: stringSchema, purpose: stringSchema,
  minimumPolicy: { enum: ['observe', 'stage', 'apply'] }, composable: booleanSchema,
  sideEffects: stringArraySchema, idempotency: stringSchema,
}, ['id', 'mcpTool', 'title', 'purpose', 'minimumPolicy', 'composable', 'sideEffects', 'idempotency']);

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

// Illustrative identities only: callers must copy both sealed references from
// their actual delivery capsules before invoking a composition capability.
const candidateRefsExample = [
  { changeId: 'copy-change-id-a', capsuleId: 'copy-capsule-id-a', artifactSha256: 'a'.repeat(64) },
  { changeId: 'copy-change-id-b', capsuleId: 'copy-capsule-id-b', artifactSha256: 'b'.repeat(64) },
];

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

const relocationDetailSchema = strictObject({
  request: jsonObjectSchema, operation: jsonObjectSchema, plan: jsonObjectSchema,
  receipt: { oneOf: [jsonObjectSchema, nullSchema] }, undoReceipt: { oneOf: [jsonObjectSchema, nullSchema] },
  coordination: jsonObjectSchema, catalog: assetCatalogSchema,
}, ['request', 'operation', 'plan', 'receipt', 'undoReceipt']);
const relocationIdentitySchema = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' } as const;
const relocationFingerprintSchema = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;

const historySummarySchema = strictObject({ checkpointId: importUuidSchema, label: stringSchema, createdAt: stringSchema,
  contentRevision: importShaSchema, projectRevision: importShaSchema, fingerprint: importShaSchema, fileCount: integerSchema },
['checkpointId', 'label', 'createdAt', 'contentRevision', 'projectRevision', 'fingerprint', 'fileCount']);
const historyFileSchema = strictObject({ path: stringSchema, currentSha256: { oneOf: [importShaSchema, nullSchema] },
  historicalSha256: { oneOf: [importShaSchema, nullSchema] }, currentText: { oneOf: [stringSchema, nullSchema] },
  historicalText: { oneOf: [stringSchema, nullSchema] } }, ['path', 'currentSha256', 'historicalSha256']);

const definitions = {
  history: {
    inputSchema: emptyInputSchema,
    outputSchema: strictObject({ contentRevision: importShaSchema, checkpoints: arrayOf(historySummarySchema) }, ['contentRevision', 'checkpoints']),
    example: { input: {}, expectedResultShape: { contentRevision: '...', checkpoints: [] } },
  },
  historyCheckpoint: {
    inputSchema: strictObject({ operationId: importUuidSchema, label: { type: 'string', minLength: 1, maxLength: 200 }, expectedContentRevision: importShaSchema }, ['operationId', 'label', 'expectedContentRevision']),
    outputSchema: historySummarySchema,
    example: { input: { operationId: '123e4567-e89b-42d3-a456-426614174000', label: '第一章定稿', expectedContentRevision: 'a'.repeat(64) }, expectedResultShape: { checkpointId: '...', fingerprint: '...' } },
  },
  historyCompare: {
    inputSchema: strictObject({ checkpointId: importUuidSchema, expectedFingerprint: importShaSchema, path: stringSchema, view: readViewSchema }, ['checkpointId']),
    outputSchema: strictObject({ checkpoint: historySummarySchema, contentRevision: importShaSchema, workingRevision: integerSchema, files: arrayOf(historyFileSchema) }, ['checkpoint', 'contentRevision', 'files']),
    example: { input: { checkpointId: '123e4567-e89b-42d3-a456-426614174000', view: 'working', path: 'content/scenario/main.gal' }, expectedResultShape: { checkpoint: {}, contentRevision: '...', files: [] } },
  },
  historyRestore: {
    inputSchema: strictObject({ operationId: stringSchema, checkpointId: importUuidSchema, expectedFingerprint: importShaSchema,
      expectedContentRevision: importShaSchema, expectedWorkingRevision: { type: 'integer', minimum: 0 }, paths: { ...stringArraySchema, minItems: 1, uniqueItems: true } },
    ['operationId', 'checkpointId', 'expectedFingerprint', 'expectedContentRevision', 'expectedWorkingRevision', 'paths']),
    outputSchema: strictObject({ checkpointId: importUuidSchema, paths: stringArraySchema }, ['checkpointId', 'paths']),
    example: { input: { operationId: 'restore-1', checkpointId: '123e4567-e89b-42d3-a456-426614174000', expectedFingerprint: 'a'.repeat(64), expectedContentRevision: 'b'.repeat(64), expectedWorkingRevision: 0, paths: ['content/scenario/main.gal'] }, expectedResultShape: { checkpointId: '...', paths: ['content/scenario/main.gal'] } },
  },
  assetRelocationReplace: {
    inputSchema: strictObject({ operationId: relocationIdentitySchema, targetPath: stringSchema,
      source: strictObject({ sourceId: stringSchema, path: stringSchema, sha256: relocationFingerprintSchema }, ['sourceId', 'path', 'sha256']),
    }, ['operationId', 'targetPath', 'source']),
    outputSchema: relocationDetailSchema,
    example: { input: { operationId: '11111111-1111-4111-8111-111111111111', targetPath: 'content/assets/bg/pier.png', source: { sourceId: 'authorized-source', path: 'pier-new.png', sha256: '0'.repeat(64) } }, expectedResultShape: { request: {}, operation: {}, plan: {}, receipt: null, undoReceipt: null } },
  },
  stageConfigPatch: {
    inputSchema: strictObject({ operationId: stringSchema, expectedFingerprint: stringSchema,
      patch: { oneOf: [strictObject({ version: { const: 1 },
        design: { oneOf: [strictObject({ width: { type: 'integer', minimum: 320, maximum: 7680 }, height: { type: 'integer', minimum: 240, maximum: 4320 } }, ['width', 'height']), nullSchema] },
        positions: { oneOf: [jsonObjectSchema, nullSchema] }, distances: { oneOf: [jsonObjectSchema, nullSchema] },
        portraits: { oneOf: [jsonObjectSchema, nullSchema] }, compositions: { oneOf: [jsonObjectSchema, nullSchema] },
      }), nullSchema] },
    }, ['operationId', 'expectedFingerprint', 'patch']),
    outputSchema: strictObject({ stageConfig: strictObject({ value: { oneOf: [jsonObjectSchema, nullSchema] }, effective: { oneOf: [jsonObjectSchema, nullSchema] }, fingerprint: stringSchema }, ['value', 'effective', 'fingerprint']), diffEntry: diffEntrySchema }, ['stageConfig', 'diffEntry']),
    example: { input: { operationId: 'op_stage', expectedFingerprint: 'copy-project-inspect-stageConfig-fingerprint', patch: { version: 1, design: { width: 1280, height: 720 } } }, expectedResultShape: { stageConfig: { value: {}, effective: {}, fingerprint: '...' }, diffEntry: {} } },
  },
  assetRelocationPlan: {
    inputSchema: strictObject({ operationId: relocationIdentitySchema,
      moves: { ...arrayOf(strictObject({ sourcePath: stringSchema, targetPath: stringSchema }, ['sourcePath', 'targetPath'])), minItems: 1, maxItems: 100 },
    }, ['operationId', 'moves']),
    outputSchema: relocationDetailSchema,
    example: { input: { operationId: '11111111-1111-4111-8111-111111111111', moves: [{ sourcePath: 'content/assets/bgm/night.wav', targetPath: 'content/assets/bgm/dawn.wav' }] }, expectedResultShape: { request: {}, operation: {}, plan: {}, receipt: null, undoReceipt: null } },
  },
  assetRelocationInspect: {
    inputSchema: strictObject({ operationId: relocationIdentitySchema }, ['operationId']),
    outputSchema: relocationDetailSchema,
    example: { input: { operationId: '11111111-1111-4111-8111-111111111111' }, expectedResultShape: { request: {}, operation: {}, plan: {}, receipt: null, undoReceipt: null } },
  },
  assetRelocationCommit: {
    inputSchema: strictObject({ operationId: relocationIdentitySchema, planFingerprint: relocationFingerprintSchema }, ['operationId', 'planFingerprint']),
    outputSchema: relocationDetailSchema,
    example: { input: { operationId: '11111111-1111-4111-8111-111111111111', planFingerprint: '0'.repeat(64) }, expectedResultShape: { request: {}, operation: {}, plan: {}, receipt: {}, undoReceipt: null } },
  },
  assetRelocationCancel: {
    inputSchema: strictObject({ operationId: relocationIdentitySchema, planFingerprint: relocationFingerprintSchema }, ['operationId', 'planFingerprint']),
    outputSchema: relocationDetailSchema,
    example: { input: { operationId: '11111111-1111-4111-8111-111111111111', planFingerprint: '0'.repeat(64) }, expectedResultShape: { request: {}, operation: {}, plan: {}, receipt: null, undoReceipt: null } },
  },
  assetRelocationRecover: {
    inputSchema: strictObject({ operationId: relocationIdentitySchema, planFingerprint: relocationFingerprintSchema, action: { enum: ['resume', 'rollback'] } }, ['operationId', 'planFingerprint', 'action']),
    outputSchema: relocationDetailSchema,
    example: { input: { operationId: '11111111-1111-4111-8111-111111111111', planFingerprint: '0'.repeat(64), action: 'rollback' }, expectedResultShape: { request: {}, operation: {}, plan: {}, receipt: null, undoReceipt: null } },
  },
  assetRelocationUndo: {
    inputSchema: strictObject({ operationId: relocationIdentitySchema, receiptId: stringSchema, receiptFingerprint: relocationFingerprintSchema }, ['operationId', 'receiptId', 'receiptFingerprint']),
    outputSchema: relocationDetailSchema,
    example: { input: { operationId: '11111111-1111-4111-8111-111111111111', receiptId: 'copy-the-real-receipt', receiptFingerprint: '0'.repeat(64) }, expectedResultShape: { request: {}, operation: {}, plan: {}, receipt: {}, undoReceipt: {} } },
  },
  scriptImportPreview: {
    inputSchema: strictObject({ view: readViewSchema, format: { enum: ['text', 'csv'] }, source: stringSchema,
      textColumn: { type: 'integer', minimum: 0 }, speakerColumn: { oneOf: [{ type: 'integer', minimum: 0 }, nullSchema] },
      header: booleanSchema, speakerMap: stringMapSchema }, ['format', 'source']),
    outputSchema: strictObject({ view: readViewSchema, ready: booleanSchema,
      columns: arrayOf(strictObject({ index: integerSchema, label: stringSchema }, ['index', 'label'])),
      mapping: strictObject({ textColumn: integerSchema, speakerColumn: integerSchema }),
      rows: arrayOf(strictObject({ line: integerSchema, speaker: stringSchema, value: stringSchema, sourceSpeaker: stringSchema, characterIds: stringArraySchema }, ['line', 'speaker', 'value', 'sourceSpeaker', 'characterIds'])),
      issues: arrayOf(strictObject({ line: integerSchema, severity: { enum: ['error', 'warning'] }, code: stringSchema, message: stringSchema }, ['line', 'severity', 'code', 'message'])),
      blocks: arrayOf(sceneTextBlockSchema) }, ['view', 'ready', 'columns', 'mapping', 'rows', 'issues', 'blocks']),
    example: { input: { view: 'project', format: 'csv', source: 'speaker,text\n旁白,雨停了。' },
      expectedResultShape: { view: 'project', ready: true, columns: [], mapping: {}, rows: [], issues: [], blocks: [{ kind: 'text', speaker: '旁白', value: '雨停了。' }] } },
  },
  gallery: {
    inputSchema: readViewInputSchema,
    outputSchema: strictObject({
      view: { enum: ['project', 'working'] },
      unlockPolicy: galleryPolicyInspection,
      texts: arrayOf(jsonObjectSchema),
      endings: arrayOf(jsonObjectSchema),
      profiles: arrayOf(jsonObjectSchema),
      terms: arrayOf(jsonObjectSchema),
      cgs: arrayOf(strictObject({ id: stringSchema, name: stringSchema, src: stringSchema, objectRef: stringSchema, fingerprint: stringSchema }, ['id', 'name', 'objectRef', 'fingerprint'])),
    }, ['view', 'cgs', 'texts', 'endings', 'profiles', 'terms', 'unlockPolicy']),
    example: { input: {}, expectedResultShape: { view: 'working', texts: [], endings: [], profiles: [], terms: [], unlockPolicy: { value: null, effective: { cgs: 'save', music: 'save', texts: 'save', endings: 'save', profiles: 'save', terms: 'save' }, fingerprint: '...' }, cgs: [{ id: 'night_cg', name: '夜色', src: 'night', objectRef: 'gallery:cgs:night_cg', fingerprint: '...' }] } },
  },
  galleryPolicyPatch: {
    inputSchema: strictObject({ operationId: stringSchema, expectedFingerprint: stringSchema, patch: { ...strictObject(galleryPolicyFields), minProperties: 1 } }, ['operationId', 'expectedFingerprint', 'patch']),
    outputSchema: strictObject({ unlockPolicy: galleryPolicyInspection, diffEntry: diffEntrySchema }, ['unlockPolicy', 'diffEntry']),
    example: { input: { operationId: 'op_collection', expectedFingerprint: '...', patch: { cgs: 'profile' } }, expectedResultShape: { unlockPolicy: { value: { cgs: 'profile' }, effective: { cgs: 'profile', music: 'save', texts: 'save', endings: 'save', profiles: 'save', terms: 'save' }, fingerprint: '...' }, diffEntry: {} } },
  },
  galleryTextCreate: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, name: stringSchema, scene: stringSchema, label: stringSchema, variables: jsonObjectSchema }, ['operationId', 'id', 'name', 'scene']),
    outputSchema: strictObject({ objectRef: stringSchema, fingerprint: stringSchema, entry: jsonObjectSchema, diffEntry: diffEntrySchema }, ['objectRef', 'fingerprint', 'entry', 'diffEntry']),
    example: { input: { operationId: 'op_replay', id: 'meeting', name: '重逢', scene: 'intro' }, expectedResultShape: { objectRef: 'gallery:texts:meeting', fingerprint: '...', entry: {}, diffEntry: {} } },
  },
  galleryTextPatch: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, expectedFingerprint: stringSchema,
      patch: { ...strictObject({ name: stringSchema, scene: stringSchema, label: { oneOf: [stringSchema, nullSchema] }, variables: { oneOf: [jsonObjectSchema, nullSchema] } }), minProperties: 1 },
    }, ['operationId', 'id', 'expectedFingerprint', 'patch']),
    outputSchema: strictObject({ objectRef: stringSchema, fingerprint: stringSchema, entry: jsonObjectSchema, diffEntry: diffEntrySchema }, ['objectRef', 'fingerprint', 'entry', 'diffEntry']),
    example: { input: { operationId: 'op_replay_name', id: 'meeting', expectedFingerprint: '...', patch: { name: '雨中重逢' } }, expectedResultShape: { objectRef: 'gallery:texts:meeting', fingerprint: '...', entry: {}, diffEntry: {} } },
  },
  galleryEndingCreate: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, name: stringSchema, description: stringSchema }, ['operationId', 'id', 'name']),
    outputSchema: strictObject({ objectRef: stringSchema, fingerprint: stringSchema, entry: jsonObjectSchema, diffEntry: diffEntrySchema }, ['objectRef', 'fingerprint', 'entry', 'diffEntry']),
    example: { input: { operationId: 'op_ending', id: 'home', name: '归途', description: '在雨停之前回到家。' }, expectedResultShape: { objectRef: 'gallery:endings:home', fingerprint: '...', entry: {}, diffEntry: {} } },
  },
  galleryEndingPatch: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, expectedFingerprint: stringSchema,
      patch: { ...strictObject({ name: stringSchema, description: { oneOf: [stringSchema, nullSchema] } }), minProperties: 1 },
    }, ['operationId', 'id', 'expectedFingerprint', 'patch']),
    outputSchema: strictObject({ objectRef: stringSchema, fingerprint: stringSchema, entry: jsonObjectSchema, diffEntry: diffEntrySchema }, ['objectRef', 'fingerprint', 'entry', 'diffEntry']),
    example: { input: { operationId: 'op_ending_name', id: 'home', expectedFingerprint: '...', patch: { name: '雨后的归途' } }, expectedResultShape: { objectRef: 'gallery:endings:home', fingerprint: '...', entry: {}, diffEntry: {} } },
  },
  galleryProfileCreate: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, character: stringSchema, title: stringSchema, description: stringSchema }, ['operationId', 'id', 'character']),
    outputSchema: strictObject({ objectRef: stringSchema, fingerprint: stringSchema, entry: jsonObjectSchema, diffEntry: diffEntrySchema }, ['objectRef', 'fingerprint', 'entry', 'diffEntry']),
    example: { input: { operationId: 'op_profile', id: 'intro', character: 'rin', description: '第一次见面时知道的资料。' }, expectedResultShape: { objectRef: 'gallery:profiles:intro', fingerprint: '...', entry: {}, diffEntry: {} } },
  },
  galleryProfilePatch: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, expectedFingerprint: stringSchema,
      patch: { ...strictObject({ character: stringSchema, title: { oneOf: [stringSchema, nullSchema] }, description: { oneOf: [stringSchema, nullSchema] } }), minProperties: 1 },
    }, ['operationId', 'id', 'expectedFingerprint', 'patch']),
    outputSchema: strictObject({ objectRef: stringSchema, fingerprint: stringSchema, entry: jsonObjectSchema, diffEntry: diffEntrySchema }, ['objectRef', 'fingerprint', 'entry', 'diffEntry']),
    example: { input: { operationId: 'op_profile_edit', id: 'intro', expectedFingerprint: '...', patch: { description: '已经修订的资料。' } }, expectedResultShape: { objectRef: 'gallery:profiles:intro', fingerprint: '...', entry: {}, diffEntry: {} } },
  },
  galleryTermCreate: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, canonical: stringSchema, description: stringSchema }, ['operationId', 'id', 'canonical']),
    outputSchema: strictObject({ objectRef: stringSchema, fingerprint: stringSchema, entry: jsonObjectSchema, diffEntry: diffEntrySchema }, ['objectRef', 'fingerprint', 'entry', 'diffEntry']),
    example: { input: { operationId: 'op_term', id: 'intro', canonical: '雾港', description: '第一次见面时知道的资料。' }, expectedResultShape: { objectRef: 'gallery:terms:intro', fingerprint: '...', entry: {}, diffEntry: {} } },
  },
  galleryTermPatch: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, expectedFingerprint: stringSchema,
      patch: { ...strictObject({ canonical: stringSchema, description: { oneOf: [stringSchema, nullSchema] } }), minProperties: 1 },
    }, ['operationId', 'id', 'expectedFingerprint', 'patch']),
    outputSchema: strictObject({ objectRef: stringSchema, fingerprint: stringSchema, entry: jsonObjectSchema, diffEntry: diffEntrySchema }, ['objectRef', 'fingerprint', 'entry', 'diffEntry']),
    example: { input: { operationId: 'op_term_edit', id: 'intro', expectedFingerprint: '...', patch: { description: '已经修订的资料。' } }, expectedResultShape: { objectRef: 'gallery:terms:intro', fingerprint: '...', entry: {}, diffEntry: {} } },
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
    example: { input: { candidateRefs: candidateRefsExample }, expectedResultShape: { comparisonVersion: '1.0.0', projectIdentity: '...', expectedProjectRevision: 'rev_...', status: 'composable', candidates: [], units: [], dependencyEdges: [], conflicts: [], identicalGroups: [], evidenceMatrix: [], comparisonFingerprint: '...' } },
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
    example: { input: { candidateRefs: candidateRefsExample, comparisonFingerprint: 'copy-current-comparison-fingerprint', selectedUnitIds: ['copy-selected-unit-id'] }, expectedResultShape: { planId: 'pln_...', planFingerprint: '...', artifactSha256: '...', dryRunStatus: 'passed' } },
  },
  compositionInspect: {
    inputSchema: strictObject({
      planId: stringSchema,
      artifactSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    }, ['planId', 'artifactSha256']),
    outputSchema: strictObject({
      plan: jsonObjectSchema,
    }, ['plan']),
    example: { input: { planId: 'copy-plan-id', artifactSha256: 'a'.repeat(64) }, expectedResultShape: { plan: {} } },
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
    example: { input: { planId: 'copy-plan-id', artifactSha256: 'a'.repeat(64), executeOperationId: 'integration-replay-1' }, expectedResultShape: { integrationChangeId: 'chg_...', status: 'READY', nextOperationIndex: 3, operationCount: 3 } },
  },
  describe: {
    inputSchema: strictObject({
      ids: { type: 'array', items: stringSchema, minItems: 1, uniqueItems: true, description: 'Select exact native capability IDs. Omit to include all; unknown IDs are rejected.' },
      detail: { enum: ['summary', 'full'], description: 'Defaults to full. Summary omits schemas, examples and repair details. Definitions do not grant permission; session.describe reports actual availability.' },
    }),
    outputSchema: strictObject({ contractVersion: stringSchema, capabilities: arrayOf({ oneOf: [capabilitySummarySchema, capabilityBriefSchema] }),
      inlineText: strictObject({ tags: arrayOf(strictObject({ name: stringSchema, paired: booleanSchema, value: { type: ['string', 'null'] }, label: stringSchema, example: stringSchema }, ['name', 'paired', 'value', 'label', 'example'])),
        ruby: { const: 'explicit-only' }, escape: stringSchema }, ['tags', 'ruby', 'escape']),
    }, ['contractVersion', 'capabilities', 'inlineText']),
    example: { input: {}, expectedResultShape: { contractVersion: '2.38.0', capabilities: [], inlineText: { tags: [], ruby: 'explicit-only', escape: '\\< for literal <; \\\\ for literal \\' } } },
  },
  inspect: {
    inputSchema: readViewInputSchema,
    outputSchema: projectInspectionSchema,
    example: { input: {}, expectedResultShape: { rootIdentity: '...', revision: '...', scenes: [], variables: [], characters: [], assets: { backgrounds: [], portraits: [], avatars: [], rules: [], intelligence: emptyAssetIntelligenceExample }, objectCount: 0, referenceCount: 0 } },
  },
  assets: {
    inputSchema: readViewInputSchema,
    outputSchema: assetCatalogSchema,
    example: { input: {}, expectedResultShape: { backgrounds: [], portraits: [], avatars: [], rules: [], intelligence: emptyAssetIntelligenceExample } },
  },
  assetSources: {
    inputSchema: strictObject({ sourceId: stringSchema, path: { type: 'string', description: 'Relative path returned here. Omit sourceId to discover startup-authorized roots; inspect a directory to list entries, then inspect a file for its SHA-256.' } }),
    outputSchema: strictObject({ roots: arrayOf(strictObject({ sourceId: stringSchema, name: stringSchema }, ['sourceId', 'name'])), supportedFormats: stringArraySchema, limits: jsonObjectSchema, validation: { const: 'container-header-or-utf8-text', description: 'Media container headers or bounded UTF-8 license text are checked. Decoding and playback must be tested in the target browser; no transcoding or legal certification. Extensionless LICENSE/LICENCE/COPYING/NOTICE/OFL names and hyphen/underscore suffixes are also accepted.' }, sourceId: stringSchema, entries: arrayOf(strictObject({ path: stringSchema, kind: { enum: ['file', 'directory'] } }, ['path', 'kind'])), file: strictObject({ path: stringSchema, bytes: integerSchema, sha256: importShaSchema }, ['path', 'bytes', 'sha256']) }, ['roots', 'supportedFormats', 'limits', 'validation']),
    example: { input: {}, expectedResultShape: { roots: [], supportedFormats: [...AGENT_MEDIA_EXTENSIONS], limits: {}, validation: 'container-header-or-utf8-text' } },
  },
  assetImportStage: {
    inputSchema: strictObject({ operationId: importUuidSchema, items: { type: 'array', minItems: 1, maxItems: AGENT_IMAGE_MAX_FILES, items: strictObject({ itemId: importUuidSchema, sourceId: stringSchema, sourcePath: stringSchema, sha256: importShaSchema, kind: { enum: ['background', 'portrait', 'avatar', 'rule', 'music', 'ambience', 'sound-effect', 'voice', 'video', 'font', 'license'] }, fileName: { type: 'string', description: 'Single filename, never a project path. Portrait: rin_uniform_smile.png (role_outfit_expression). Images PNG/JPEG/WebP; audio WAV/OGG/MP3; video MP4/WebM; fonts TTF/OTF/WOFF2. License: UTF-8 TXT/MD or extensionless LICENSE/LICENCE/COPYING/NOTICE/OFL (optional - or _ suffix), at most 1 MiB. Include the supplied license alongside its font in the same batch, using a distinct filename when needed. Copy SHA-256 from asset.sources and preserve the real extension. No decoding or legal certification.' } }, ['itemId', 'sourceId', 'sourcePath', 'sha256', 'kind', 'fileName']) } }, ['operationId', 'items']),
    outputSchema: importDetailSchema,
    example: { input: { operationId: '22222222-2222-4222-8222-222222222222', items: [{ itemId: '33333333-3333-4333-8333-333333333333', sourceId: 'source_from_asset_sources', sourcePath: 'night.png', sha256: 'a'.repeat(64), kind: 'background', fileName: 'night.png' }] }, expectedResultShape: importDetailExample },
  },
  assetImportInspect: { inputSchema: importOperationSchema, outputSchema: importDetailSchema, example: { input: { operationId: '22222222-2222-4222-8222-222222222222' }, expectedResultShape: importDetailExample } },
  assetImportCommit: { inputSchema: importCommitSchema, outputSchema: importDetailSchema, example: { input: { operationId: '22222222-2222-4222-8222-222222222222', planFingerprint: 'a'.repeat(64) }, expectedResultShape: importDetailExample } },
  assetImportRecover: { inputSchema: importRecoverSchema, outputSchema: importDetailSchema, example: { input: { operationId: '22222222-2222-4222-8222-222222222222', planFingerprint: 'a'.repeat(64) }, expectedResultShape: importDetailExample } },
  objectInspect: {
    inputSchema: strictObject({ objectRef: stringSchema, view: readViewSchema, fragment: {
      ...sceneFragmentInputSchema,
      description: 'Scene-only raw line page, default first line and 100 lines, max 200. Subsequent pages require expectedRevision from the first fragment, plus expectedWorkingRevision for working view. Changed versions reject the page; re-read from line 1.',
    } }, ['objectRef']),
    outputSchema: objectInspectionSchema,
    example: { input: { objectRef: 'scene:prologue' }, expectedResultShape: { kind: 'scene', objectRef: 'scene:prologue', references: [], referencedBy: [] } },
  },
  begin: {
    inputSchema: strictObject({
      intent: stringSchema,
      acceptanceCriteria: stringArraySchema,
      initiator: { enum: ['external-agent', 'human', 'automation'], description: 'who initiated this change' },
      compositionMode: { enum: ['direct', 'candidate'], description: 'Direct is an ordinary isolated draft, not source-write permission. Omission preserves stage=candidate / apply=direct. Mode persists on resume.' },
    }),
    outputSchema: strictObject({ changeId: stringSchema, baseRevision: stringSchema, workingRevision: integerSchema, compositionMode: { enum: ['direct', 'candidate'] } }, ['changeId', 'baseRevision', 'workingRevision']),
    example: { input: {}, expectedResultShape: { changeId: 'chg_...', baseRevision: '...', workingRevision: 0 } },
  },
  sceneCreate: {
    inputSchema: {
      ...strictObject({ operationId: stringSchema, sceneId: stringSchema, blocks: arrayOf(sceneBlockSchema) }, ['operationId', 'sceneId']),
      $defs: sceneSchemaDefinitions,
    },
    outputSchema: strictObject({ sceneId: stringSchema, path: stringSchema, continuation: sceneContinuationSchema }, ['sceneId', 'path']),
    example: { input: { operationId: 'op_scene', sceneId: 'agent_port_entry', blocks: [
      { kind: 'choice', options: [{ label: '继续', when: 'trust > 0', effects: [{ name: 'set', args: ['trust', '=', '1'] }], target: { kind: 'goto', value: 'next' } }] },
      { kind: 'label', name: 'next' },
      { kind: 'condition', branches: [{ kind: 'if', expr: 'trust > 0', blocks: [{ kind: 'text', value: '进入下一段。' }] }, { kind: 'else', blocks: [{ kind: 'text', value: '暂时停留。' }] }] },
    ] }, expectedResultShape: { sceneId: 'agent_port_entry', path: 'content/scenario/agent_port_entry.gal' } },
  },
  sceneRemove: {
    inputSchema: strictObject({ operationId: stringSchema, sceneId: stringSchema, expectedFingerprint: stringSchema }, ['operationId', 'sceneId', 'expectedFingerprint']),
    outputSchema: strictObject({ sceneId: stringSchema, path: stringSchema, removed: booleanSchema }, ['sceneId', 'path', 'removed']),
    example: { input: { operationId: 'remove-unused', sceneId: 'unused', expectedFingerprint: 'copy from object.inspect scene:unused, view:working' }, expectedResultShape: { sceneId: 'unused', path: 'content/scenario/unused.gal', removed: true } },
  },
  sceneRename: {
    inputSchema: strictObject({ operationId: stringSchema, sceneId: stringSchema, newSceneId: stringSchema, expectedFingerprint: stringSchema }, ['operationId', 'sceneId', 'newSceneId', 'expectedFingerprint']),
    outputSchema: strictObject({ previousSceneId: stringSchema, sceneId: stringSchema, previousPath: stringSchema, path: stringSchema, affectedPaths: stringArraySchema, continuation: sceneContinuationSchema, diffEntry: diffEntrySchema }, ['previousSceneId', 'sceneId', 'previousPath', 'path', 'affectedPaths', 'diffEntry']),
    example: { input: { operationId: 'rename-chapter', sceneId: 'draft', newSceneId: 'arrival', expectedFingerprint: 'copy from object.inspect scene:draft, view:working' }, expectedResultShape: { previousSceneId: 'draft', sceneId: 'arrival', previousPath: 'content/scenario/draft.gal', path: 'content/scenario/arrival.gal', affectedPaths: [], diffEntry: {} } },
  },
  sceneMove: {
    inputSchema: strictObject({ operationId: stringSchema, sceneId: stringSchema, directory: { type: 'string', description: 'Relative chapter directory inside content/scenario; empty string means root' }, expectedPath: stringSchema, expectedFingerprint: stringSchema }, ['operationId', 'sceneId', 'directory', 'expectedPath', 'expectedFingerprint']),
    outputSchema: strictObject({ sceneId: stringSchema, previousPath: stringSchema, path: stringSchema, affectedPaths: stringArraySchema, continuation: sceneContinuationSchema, diffEntry: diffEntrySchema }, ['sceneId', 'previousPath', 'path', 'affectedPaths', 'diffEntry']),
    example: { input: { operationId: 'move-chapter', sceneId: 'arrival', directory: '第一章/港口', expectedPath: 'content/scenario/arrival.gal', expectedFingerprint: 'copy from object.inspect scene:arrival, view:working' }, expectedResultShape: { sceneId: 'arrival', previousPath: 'content/scenario/arrival.gal', path: 'content/scenario/第一章/港口/arrival.gal', affectedPaths: [], diffEntry: {} } },
  },
  scenePatch: {
    inputSchema: { ...strictObject({ operationId: stringSchema, sceneId: stringSchema, patch: scenePatchSchema }, ['operationId', 'patch']),
      $defs: sceneSchemaDefinitions,
      description: `Patch one source object with its original fingerprint. replaceInstruction replaces one existing whitelisted single-line scene instruction in place using a complete instruction (omitted modifiers are removed); the whitelist is ${REPLACEABLE_SCENE_INSTRUCTIONS.join('、')}. Audio, video, flow-boundary, and structure directives stay outside this entry. replaceChoiceGroup atomically replaces the complete choice options; use choice.details.structure.fingerprint, which is distinct from the line fingerprint used by replaceChoiceOption/insertAfter. replaceConditionBlock atomically replaces one paired nested condition; branches determine order and add/delete branches, sourceBranch must be a current direct branch of the target, and omitting blocks preserves that branch body comments, indentation, and line endings byte-for-byte. New branches must provide blocks. Re-read object facts after edits; surrounding source outside the selected structure is preserved.`,
    },
    outputSchema: strictObject({ path: stringSchema, line: integerSchema, kind: stringSchema, continuation: sceneContinuationSchema, affectedScenes: stringArraySchema }, ['path', 'line', 'kind']),
    example: { input: { operationId: 'op_patch', patch: { kind: 'replaceChoiceGroup', target: 'scene:x/choice:2@12345678-abcdef12', expectedFingerprint: 'fedcba98', choice: { kind: 'choice', options: [
      { label: '左侧', when: 'trust > 0', effects: [{ name: 'set', args: ['route', '=', '"left"'] }], target: { kind: 'goto', value: 'left' } },
      { label: '右侧', target: { kind: 'jump', value: 'right' } },
    ] } } }, expectedResultShape: { path: 'content/scenario/x.gal', line: 2, kind: 'replaceChoiceGroup' } },
  },
  variableEnsure: {
    inputSchema: strictObject({ operationId: stringSchema, name: stringSchema, type: stringSchema, initial: jsonValueSchema, readonly: booleanSchema, min: numberSchema, max: numberSchema }, ['operationId', 'name', 'type', 'initial']),
    outputSchema: strictObject({ name: stringSchema, created: booleanSchema }, ['name', 'created']),
    example: { input: { operationId: 'op_variable', name: 'agent.route', type: 'string', initial: '' }, expectedResultShape: { name: 'agent.route', created: true } },
  },
  variablePatchInitial: {
    inputSchema: strictObject({ operationId: stringSchema, name: stringSchema, expectedFingerprint: stringSchema, initial: jsonValueSchema }, ['operationId', 'name', 'expectedFingerprint', 'initial']),
    outputSchema: strictObject({ name: stringSchema, objectRef: stringSchema, fingerprint: stringSchema, diffEntry: diffEntrySchema }, ['name', 'objectRef', 'fingerprint', 'diffEntry']),
    example: { input: { operationId: 'op_variable_initial', name: 'agent.route', expectedFingerprint: '...', initial: 'alternate' }, expectedResultShape: { name: 'agent.route', objectRef: 'variable:agent.route', fingerprint: '...', diffEntry: {} } },
  },
  characterEnsure: {
    inputSchema: strictObject({ operationId: stringSchema, id: stringSchema, name: stringSchema, avatar: { oneOf: [stringSchema, nullSchema] }, portraits: { oneOf: [{ type: 'object', additionalProperties: { type: 'object', additionalProperties: stringSchema } }, nullSchema], description: 'Direct only. Replace outfit -> expression -> exact project.assets portrait sourcePath. Omitted preserves, null removes mappings. Explicit slots override filename discovery; other slots retain discovery.' }, visuals: { oneOf: [jsonObjectSchema, nullSchema], description: 'Direct only. Replace outfit -> expression -> version 1 layered/sequence definition. Omitted preserves; null removes. All referenced portrait images must exist. Static portraits and visuals must not define the same slot.' }, expectedFingerprint: stringSchema }, ['operationId', 'id', 'name', 'expectedFingerprint']),
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
    example: { input: { operationId: 'op_timeline', timelineId: 'agent_port_intro', definition: { version: 1, id: 'agent_port_intro', durationMs: 1000, tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 300, easing: 'linear', action: 'fade', alpha: 0 }] }] } }, expectedResultShape: { timelineId: 'agent_port_intro', path: 'content/timelines/agent_port_intro.json', objectRef: 'timeline:agent_port_intro', fingerprint: '...', diffEntry: {} } },
  },
  timelinePatch: {
    inputSchema: strictObject({ operationId: stringSchema, timelineId: stringSchema, patch: timelinePatchSchema }, ['operationId', 'timelineId', 'patch']),
    outputSchema: strictObject({ timelineId: stringSchema, objectRef: stringSchema, fingerprint: stringSchema, diffEntry: diffEntrySchema }, ['timelineId', 'objectRef', 'fingerprint', 'diffEntry']),
    example: { input: { operationId: 'op_timeline_patch', timelineId: 'agent_port_intro', patch: { kind: 'setDuration', expectedFingerprint: '...', durationMs: 900 } }, expectedResultShape: { timelineId: 'agent_port_intro', objectRef: 'timeline:agent_port_intro', fingerprint: '...', diffEntry: {} } },
  },
  entrySceneSet: {
    inputSchema: strictObject({ operationId: stringSchema, sceneId: stringSchema, expectedFingerprint: stringSchema }, ['operationId', 'sceneId', 'expectedFingerprint']),
    outputSchema: strictObject({ sceneId: stringSchema, entryScene: stringSchema, fingerprint: stringSchema, diffEntry: diffEntrySchema }, ['sceneId', 'entryScene', 'fingerprint', 'diffEntry']),
    example: { input: { operationId: 'op_entry', sceneId: 'agent_port_entry', expectedFingerprint: '...' }, expectedResultShape: { sceneId: 'agent_port_entry', entryScene: 'agent_port_entry', fingerprint: '...', diffEntry: {} } },
  },
  playerConfigPatch: {
    inputSchema: strictObject({ operationId: stringSchema, expectedFingerprint: stringSchema,
      patch: { ...strictObject({ ...playerConfigFields, fonts: { oneOf: [strictObject(fontRoleFields), nullSchema] } }), minProperties: 1, description: 'Only supplied fields/roles change. Null removes a field/role; empty strings/arrays explicitly clear it. fonts replaces legacy font as a whole; missing roles use defaults. Font paths must be exact project.assets sourcePath. titleLogo is a background-asset key for the title wordmark. Read project.inspect.playerConfig in working view for values and fingerprint. Direct only; no candidate or integration writes.' },
    }, ['operationId', 'expectedFingerprint', 'patch']),
    outputSchema: strictObject({ playerConfig: playerConfigSchema, diffEntry: diffEntrySchema }, ['playerConfig', 'diffEntry']),
    example: { input: { operationId: 'op_player', expectedFingerprint: '...', patch: { subtitle: '新章节', firstRunHint: '' } }, expectedResultShape: { playerConfig: { fingerprint: '...', values: { title: null, subtitle: '新章节', titleBackground: null, titleLogo: null, endScenes: null, firstRunHint: '', font: null, fonts: null } }, diffEntry: {} } },
  },
  themeConfigPatch: {
    inputSchema: strictObject({ operationId: stringSchema, expectedFingerprint: stringSchema,
      patch: { oneOf: [
        { type: 'null', description: 'Removes the entire theme section (titleLogo is not affected).' },
        { ...jsonObjectSchema, minProperties: 1, description: 'Narrow theme patch. Token groups (colors/opacity/typography/spacing/radius) replace whole tables; null deletes a group. dialogSkin/buttonSkin set a background-asset key or null to clear. dialogHeightRatio/dialogMarginX/dialogMarginBottom set layout numbers or null to restore defaults. titleLogo sets/clears the player title wordmark key. Omitted fields retain. Direct only.' },
      ] },
    }, ['operationId', 'expectedFingerprint', 'patch']),
    outputSchema: strictObject({ themeConfig: themeConfigSchema, diffEntry: diffEntrySchema }, ['themeConfig', 'diffEntry']),
    example: { input: { operationId: 'op_theme', expectedFingerprint: '...', patch: { colors: { accent: 0x8b1e3f }, opacity: { panel: 0.88 }, titleLogo: 'title_logo' } }, expectedResultShape: { themeConfig: { value: {}, effective: { tokens: {}, skins: {}, layout: {} }, titleLogo: 'title_logo', fingerprint: '...' }, diffEntry: {} } },
  },
  texts: {
    inputSchema: strictObject({ view: readViewSchema, locale: stringSchema, format: { enum: ['json', 'csv', 'voice-csv'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 }, expectedRevision: stringSchema }),
    outputSchema: strictObject({ view: readViewSchema, revision: stringSchema, fingerprint: stringSchema, sourceLocale: { type: ['string', 'null'] }, locale: stringSchema,
      sources: arrayOf(jsonObjectSchema), entries: arrayOf(jsonObjectSchema), voiceAssets: arrayOf(jsonObjectSchema), sourceCount: integerSchema, entryCount: integerSchema, offset: integerSchema, hasMore: booleanSchema, csv: stringSchema },
    ['view', 'revision', 'fingerprint', 'sourceLocale', 'locale', 'sources', 'entries', 'sourceCount', 'entryCount', 'offset', 'hasMore']),
    example: { input: { view: 'working', locale: 'en' }, expectedResultShape: { view: 'working', revision: '...', fingerprint: '...', sourceLocale: null, locale: 'en', sources: [], entries: [], sourceCount: 0, entryCount: 0, offset: 0, hasMore: false } },
  },
  textsImportPreview: {
    inputSchema: strictObject({ view: readViewSchema, locale: stringSchema, csv: stringSchema }, ['locale', 'csv']),
    outputSchema: strictObject({ view: readViewSchema, ready: booleanSchema, revision: stringSchema, fingerprint: stringSchema, locale: stringSchema,
      rows: arrayOf(jsonObjectSchema), issues: arrayOf(jsonObjectSchema), previewFingerprint: stringSchema }, ['view', 'ready', 'revision', 'fingerprint', 'locale', 'rows', 'issues', 'previewFingerprint']),
    example: { input: { view: 'working', locale: 'en', csv: 'key,locale,sourceVersion,speaker,context,source,translation,status\n' }, expectedResultShape: { view: 'working', ready: true, revision: '...', fingerprint: '...', locale: 'en', rows: [], issues: [], previewFingerprint: '...' } },
  },
  textsPatch: {
    inputSchema: strictObject({ operationId: stringSchema, expectedRevision: stringSchema, expectedFingerprint: stringSchema, patch: { oneOf: [
      strictObject({ type: { const: 'bind' }, sourceLocale: stringSchema, bindings: { ...arrayOf(strictObject({ key: stringSchema, sourceId: stringSchema }, ['key', 'sourceId'])), minItems: 1, maxItems: 100 } }, ['type', 'sourceLocale', 'bindings']),
      strictObject({ type: { const: 'remove' }, keys: { ...stringArraySchema, minItems: 1, maxItems: 100 } }, ['type', 'keys']),
      strictObject({ type: { const: 'import' }, locale: stringSchema, csv: stringSchema, previewFingerprint: stringSchema }, ['type', 'locale', 'csv', 'previewFingerprint']),
    ] } }, ['operationId', 'expectedRevision', 'expectedFingerprint', 'patch']),
    outputSchema: strictObject({ keys: stringArraySchema, fingerprint: stringSchema, diffEntry: diffEntrySchema }, ['keys', 'fingerprint', 'diffEntry']),
    example: { input: { operationId: 'text-bind-1', expectedRevision: '...', expectedFingerprint: '...', patch: { type: 'bind', sourceLocale: 'zh-CN', bindings: [{ key: 'intro.greeting', sourceId: '["intro",null,0]' }] } }, expectedResultShape: { keys: ['intro.greeting'], fingerprint: '...', diffEntry: {} } },
  },
  ui: {
    inputSchema: readViewInputSchema,
    outputSchema: uiInspectionSchema,
    example: { input: { view: 'working' }, expectedResultShape: { view: 'working', value: null, defaultPages: ['title'], nodes: [], fingerprint: '...' } },
  },
  uiPatch: {
    inputSchema: strictObject({
      operationId: stringSchema, expectedFingerprint: stringSchema,
      patch: { oneOf: [
        strictObject({ type: { const: 'page.set' }, page: stringSchema, root: uiNodeInputSchema }, ['type', 'page', 'root']),
        strictObject({ type: { const: 'page.remove' }, page: stringSchema }, ['type', 'page']),
        strictObject({ type: { const: 'node.insert' }, page: stringSchema, parentId: stringSchema, index: integerSchema, node: uiNodeInputSchema }, ['type', 'page', 'parentId', 'index', 'node']),
        strictObject({ type: { const: 'node.update' }, page: stringSchema, id: stringSchema, patch: { ...jsonObjectSchema, properties: {
          style: { oneOf: [uiStyleSchema, nullSchema] }, states: { oneOf: [uiStatesSchema, nullSchema] }, transition: { oneOf: [uiTransitionSchema, nullSchema] },
        } } }, ['type', 'page', 'id', 'patch']),
        strictObject({ type: { const: 'node.remove' }, page: stringSchema, id: stringSchema }, ['type', 'page', 'id']),
        strictObject({ type: { const: 'node.copy' }, page: stringSchema, id: stringSchema, newId: stringSchema, index: integerSchema }, ['type', 'page', 'id', 'newId']),
        strictObject({ type: { const: 'node.reorder' }, page: stringSchema, id: stringSchema, index: integerSchema }, ['type', 'page', 'id', 'index']),
      ] },
    }, ['operationId', 'expectedFingerprint', 'patch']),
    outputSchema: strictObject({ ui: uiInspectionSchema, diffEntry: diffEntrySchema }, ['ui', 'diffEntry']),
    example: { input: { operationId: 'ui_condition_1', expectedFingerprint: '...', patch: { type: 'node.update', page: 'hud', id: 'trust-value', patch: { visibleWhen: 'trust >= 10' } } }, expectedResultShape: { ui: { view: 'working', value: {}, defaultPages: [], nodes: [], fingerprint: '...' }, diffEntry: {} } },
  },
  validate: {
    inputSchema: emptyInputSchema,
    outputSchema: validationOutputSchema,
    example: { input: {}, expectedResultShape: { view: 'project', ok: true, issues: [] } },
  },
  simulate: {
    inputSchema: strictObject({ sceneId: stringSchema, seed: seedSchema,
      maxPaths: { type: 'integer', minimum: 1, maximum: 2000, description: 'Default 500 paths. Exhaustion is incomplete, not passed.' },
      maxStepsPerPath: { type: 'integer', minimum: 1, maximum: 100000, description: 'Default 20000 steps per path. Use an explicit scene/path when the bounded budget is insufficient.' },
    }),
    outputSchema: simulationOutputSchema,
    example: { input: {}, expectedResultShape: { view: 'project', status: 'passed', report: { status: 'passed' } } },
  },
  previewPath: {
    inputSchema: strictObject({ view: { enum: ['project', 'working'] }, sceneId: stringSchema, line: { type: 'integer', minimum: 1 },
      mode: { enum: ['search', 'path', 'test'] }, choices: runtimeChoicesSchema, variables: { type: 'object', additionalProperties: jsonValueSchema },
      targetVisit: { type: 'integer', minimum: 1, maximum: 1000 }, seed: seedSchema,
      maxPaths: { type: 'integer', minimum: 1, maximum: 2000 }, maxStepsPerPath: { type: 'integer', minimum: 1, maximum: 100000 },
    }, ['sceneId', 'line']),
    outputSchema: strictObject({ view: { enum: ['project', 'working'] }, status: { enum: ['reached', 'unreachable', 'budget-exhausted', 'path-mismatch', 'host-boundary', 'runtime-error', 'requires-extension'] },
      mode: { enum: ['search', 'path', 'test'] }, entryScene: stringSchema, entryLabel: stringSchema, seed: seedSchema,
      initialVariables: { type: 'object', additionalProperties: jsonValueSchema }, finalVariables: { type: 'object', additionalProperties: jsonValueSchema },
      target: strictObject({ sceneId: stringSchema, requestedLine: integerSchema, line: integerSchema, index: integerSchema,
        kind: { enum: ['instruction', 'label-entry', 'choice-group', 'scene-entry'] } }, ['sceneId', 'requestedLine', 'line', 'index', 'kind']),
      choices: runtimeChoicesSchema, targetVisit: integerSchema, position: { oneOf: [jsonObjectSchema, nullSchema] }, pathsExplored: integerSchema, steps: integerSchema,
      partialStage: booleanSchema, message: stringSchema, runtimeErrors: arrayOf(strictObject({ scene: { type: ['string', 'null'] }, message: stringSchema }, ['scene', 'message'])), coverage: storyCoverageSchema,
    }, ['view', 'status', 'mode', 'entryScene', 'seed', 'initialVariables', 'finalVariables', 'target', 'choices', 'targetVisit', 'position', 'pathsExplored', 'steps', 'partialStage', 'message', 'runtimeErrors', 'coverage']),
    example: { input: { sceneId: 'intro', line: 1 }, expectedResultShape: { view: 'project', status: 'unreachable', mode: 'search', entryScene: 'intro', seed: 1592639710,
      initialVariables: {}, finalVariables: {}, target: { sceneId: 'intro', requestedLine: 1, line: 1, index: 0, kind: 'instruction' }, choices: [], targetVisit: 1,
      position: null, pathsExplored: 1, steps: 0, partialStage: false, message: '目标未到达', runtimeErrors: [], coverage: { scenes: [], branches: [], conditions: [], stops: [], hostInstructions: [] } } },
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
    outputSchema: strictObject({ view: { const: 'working' }, traceId: stringSchema, status: { enum: ['passed', 'failed', 'unknown'] }, traceWorkingRevision: integerSchema, events: traceEventsSchema, count: integerSchema, seed: seedSchema, freshness: EVIDENCE_FRESHNESS_SCHEMA }, ['view', 'traceId', 'events', 'count', 'seed', 'freshness']),
    example: { input: { traceId: 'trace_...' }, expectedResultShape: { view: 'working', traceId: 'trace_...', events: [], count: 0, seed: 1592639710, freshness: { status: 'fresh', currentWorkingRevision: 1 } } },
  },
  readPreview: {
    inputSchema: strictObject({ previewId: stringSchema, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }),
    outputSchema: strictObject({ view: { enum: ['saved-project', 'working-change', 'candidate', 'integration-result'] }, kind: { const: 'editor-preview' },
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
    example: { input: { candidateRefs: candidateRefsExample }, expectedResultShape: { reviewId: 'review_comparison_...', projection: {}, identity: {} } },
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
    example: { input: { planId: 'copy-plan-id', artifactSha256: 'a'.repeat(64), changeId: 'copy-integration-change-id' }, expectedResultShape: { reviewId: 'review_result_...', projection: {}, identity: {} } },
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
  'project.history',
  'project.history.checkpoint',
  'project.history.compare',
  'project.history.restore',
  'project.ui',
  'project.texts',
  'project.texts.import.preview',
  'project.texts.patch',
  'project.assets',
  'project.gallery',
  'script.import.preview',
  'asset.sources',
  'asset.import.stage',
  'asset.import.inspect',
  'asset.import.commit',
  'asset.import.recover',
  'asset.relocation.replace',
  'asset.relocation.plan',
  'asset.relocation.inspect',
  'asset.relocation.commit',
  'asset.relocation.cancel',
  'asset.relocation.recover',
  'asset.relocation.undo',
  'object.inspect',
  'change.begin',
  'scene.create',
  'scene.remove',
  'scene.rename',
  'scene.move',
  'scene.patch',
  'variable.ensure',
  'variable.patch-initial',
  'character.ensure',
  'character.remove',
  'timeline.create',
  'timeline.patch',
  'gallery.cg.create',
  'gallery.cg.patch',
  'gallery.policy.patch',
  'gallery.text.create',
  'gallery.text.patch',
  'gallery.ending.create',
  'gallery.ending.patch',
  'gallery.profile.create',
  'gallery.profile.patch',
  'gallery.term.create',
  'gallery.term.patch',
  'project.entry-scene.set',
  'project.player-config.patch',
  'project.stage-config.patch',
  'project.theme-config.patch',
  'project.ui.patch',
  'project.validate',
  'project.simulate',
  'project.preview-path',
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
  'variable.patch-initial',
  'character.remove', 'timeline.create', 'timeline.patch', 'project.entry-scene.set',
  'gallery.cg.create', 'gallery.cg.patch',
]);

const commonErrors = ['INVALID_REQUEST', 'PROJECT_INVALID', 'PROJECT_NOT_FOUND', 'POLICY_BLOCKED'] as const;
const readRepair = ['inspect the returned object or project facts before retrying'] as const;
const mutateRepair = [
  'inspect current object fingerprints, repair the request, then retry',
  'anonymous scene child refs bind the read snapshot revision; after a write changes that revision, inspect again before the next ref-based patch, even for another scene',
  'stage candidates require dependencies before persistence: follow issues.suggestedCapabilities, establish missing objects or choose resolved assets, then retry the same operationId and payload',
  'keep primary-object dependencies acyclic; the rejected second edge was not persisted; mutual empty skeletons do not resolve a cycle',
  'candidateReadiness describes persisted composition facts only, not validation or capsule readiness; legacy changes without operation facts require a new change',
] as const;

const imageImportErrors = ["IMPORT_OPERATION_NOT_FOUND","IMPORT_OPERATION_CONFLICT","IMPORT_PLAN_BLOCKED","IMPORT_PLAN_STALE","IMPORT_PROJECT_STALE","IMPORT_TARGET_UNSAFE","IMPORT_TARGET_EXISTS","IMPORT_RECOVERY_REQUIRED","IMPORT_LIMIT_EXCEEDED","IMPORT_UPLOAD_BUSY","IMPORT_UPLOAD_TIMEOUT","IMPORT_UPLOAD_MISMATCH","IMPORT_AUTHORITY_NOT_READY","IMPORT_FILESYSTEM_UNSUPPORTED","IMPORT_PUBLICATION_FAILED","IMPORT_IO_FAILED","ASSET_SOURCE_FORBIDDEN","ASSET_SOURCE_CHANGED","ASSET_IMAGE_INVALID","ASSET_MEDIA_INVALID","PROJECT_BUSY","HUMAN_WORKSPACE_DIRTY","HUMAN_WORKSPACE_BUSY","HUMAN_WORKSPACE_STATE_CORRUPT","SESSION_STATE_INVALID","POLICY_BLOCKED"] as const;

const metadata: Record<AuthoringCapabilityId, DefinitionMetadata> = {
  'project.history': { title: 'Read content history', purpose: 'List manually recorded saved content versions and the current saved contentRevision. Covers scenarios, timelines and supported content configs including achievements; excludes assets, package identity and engine files.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read'], idempotency: 'pure-read', composable: false, preconditions: [], possibleErrors: [...commonErrors, 'CHANGE_STORE_CORRUPT'], repairRecipes: readRepair },
  'project.history.checkpoint': { title: 'Record saved content version', purpose: 'Record exact saved text, including malformed source, under a manual label. Copy expectedContentRevision from project.history. Working drafts are never captured. This is not an asset-inclusive backup or validation evidence.', minimumPolicy: 'stage', sideEffects: ['project-read', 'change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['saved contentRevision is current'], possibleErrors: [...commonErrors, 'OBJECT_REF_STALE', 'OPERATION_ID_CONFLICT', 'CHANGE_STORE_CORRUPT'], repairRecipes: readRepair },
  'project.history.compare': { title: 'Compare content history', purpose: 'Compare one history version with explicit project or working content. Default is project. Omit path for file fingerprints; specify one path for full current/historical text. Copy checkpoint.fingerprint, contentRevision and workingRevision into restore.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['checkpoint exists; working view requires an active change'], possibleErrors: [...commonErrors, 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'CHANGE_STORE_CORRUPT'], repairRecipes: readRepair },
  'project.history.restore': { title: 'Restore content into direct draft', purpose: 'Merge explicitly selected historical files into the active direct draft after comparing working view. Keeps other files, never deletes current-only files, never restores approvals or save identities. Source stays unchanged until normal fresh validation, simulation, runtime and authorized change.commit.', minimumPolicy: 'stage', sideEffects: ['change-store-read', 'change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct', 'history and working fingerprints match the comparison'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_REF_STALE', 'OPERATION_ID_CONFLICT', 'CHANGE_STORE_CORRUPT'], repairRecipes: ['Begin a direct change, compare view=working, restore selected paths, inspect diff and validate/preview before committing.'] },
  'gallery.text.create': { title: 'Create story replay', purpose: 'Create one replay entry with scene, optional label and initial variable overrides over project defaults. Shared Player restores the origin after replay and blocks normal persistence. Direct only.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct', 'scene and label exist; overrides use declared variables and valid values'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'VALIDATION_FAILED', 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'gallery.text.patch': { title: 'Patch story replay', purpose: 'Update name/scene/label/variables on one replay. Null removes label or variable overrides; variables replaces the whole override object. Direct only.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct', 'copy current entry fingerprint from project.gallery.texts'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'gallery.ending.create': { title: 'Create ending entry', purpose: 'Declare ending-book metadata. Normal @clear with the same id unlocks it; missing endings policy stays save-scoped. Direct only.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'VALIDATION_FAILED', 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'gallery.ending.patch': { title: 'Patch ending entry', purpose: 'Edit ending name/description using the current project.gallery.endings fingerprint. Null description removes it. Never alters completion records. Direct only.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'gallery.profile.create': { title: 'Create profile dossier', purpose: 'Character dossier fragment, referencing a declared character. Direct only. Unlock with @unlock_profile id; defaults to save scope. Read project.gallery for current fingerprints. Null description or title removes it.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'gallery.profile.patch': { title: 'Patch profile dossier', purpose: 'Character dossier fragment, referencing a declared character. Direct only. Unlock with @unlock_profile id; defaults to save scope. Read project.gallery for current fingerprints. Null description or title removes it.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'gallery.term.create': { title: 'Create term dossier', purpose: 'Glossary explanation referencing a canonical term; registers a missing canonical in terminology.json without removing existing data. Direct only. Unlock with @unlock_term id; defaults to save scope. Read project.gallery for current fingerprints. Null description removes it.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'gallery.term.patch': { title: 'Patch term dossier', purpose: 'Glossary explanation referencing a canonical term; registers a missing canonical in terminology.json without removing existing data. Direct only. Unlock with @unlock_term id; defaults to save scope. Read project.gallery for current fingerprints. Null description removes it.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'gallery.policy.patch': { title: 'Patch gallery unlock policy', purpose: 'Opt CG, music, text replay, ending, character dossier or glossary entries into project-scoped permanent collections. Missing fields keep per-save semantics. Null removes one policy. Direct only; existing CG mutations retain candidate support.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct', 'copy working project.gallery.unlockPolicy.fingerprint'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Read project.gallery with view=working, inspect current policy and copy its fingerprint.', ...mutateRepair] },
  'project.texts': { title: 'Read text and voice catalog or export CSV', purpose: 'Read enrolled dialogue/choice, character/UI captions, terminology and dossier titles/descriptions with current source coordinates, translations, voiceStatus, spokenText and usable voiceAssets. JSON sources and entries are paged independently; carry expectedRevision on later pages. format=csv exports all enrolled translations; voice-csv exports all enrolled dialogue voice rows without pagination. Explicit source rebind is required after source changes. Shared Player consumes confirmed language text and voice bindings; missing or stale voice is silent.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false, preconditions: ['working view requires an active change'], possibleErrors: [...commonErrors, 'TEXT_CATALOG_INVALID', 'OBJECT_REF_STALE'], repairRecipes: ['Copy actual sourceId, revision and fingerprint into a direct operation. Restart paging after revision changes.', 'Preserve exported columns/source facts and spreadsheet apostrophe escaping. For voice CSV edit only voice/action: keep, bind or remove; use existing voiceAssets keys, never paths.'] },
  'project.texts.import.preview': { title: 'Preview translation or voice CSV import', purpose: 'Read-only complete-sheet difference and diagnostics. Reject missing/duplicate/unknown rows and changed source facts. Translation sheets check placeholders and Ruby. Voice sheets require explicit keep/bind/remove, confirmed language words and a unique supported physical voice asset; the preview binds current usable asset inventory. Does not write project files or generate audio.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false, preconditions: ['valid UTF-8 CSV text', 'translation locale differs from source locale; voice sheets may use source locale'], possibleErrors: [...commonErrors, 'TEXT_CATALOG_INVALID'], repairRecipes: ['Correct every issue and preview again. Use the ready previewFingerprint with the identical CSV/locale in project.texts.patch; re-preview after source, words or available assets change.'] },
  'project.texts.patch': { title: 'Bind texts or import reviewed translations/voices', purpose: 'Direct-only text catalog changes. bind explicitly enrolls/rebinds a stable key while retaining previous translations/voices; remove deletes selected keys; import requires a matching ready translation or voice preview. Voice bind confirms current words/sourceVersion, keep retains prior binding, remove explicitly unbinds one language. Writes only game.config.json in the isolated change, never script, audio bytes or player preference.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['OPEN direct, not integration', 'current revision and catalog fingerprint', 'import requires current ready preview'], possibleErrors: [...commonErrors, 'TEXT_CATALOG_INVALID', 'UNSUPPORTED_OPERATION', 'OBJECT_REF_STALE', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Re-read working catalog and explicitly confirm changed sources or recording words. Keep text keys, not old line numbers; never silently reconfirm stale recordings.', 'Validate and play the change before separately authorized source commit.'] },
  'asset.relocation.replace': { title: 'Prepare same-path asset replacement', purpose: 'Prepare a byte replacement of one existing, exact same-format project asset while retaining its key/path, original license and structured references. Read the permitted source bytes/hash from asset.sources. This is not a move, ordinary import overwrite, or source publication. The original relocation commit/recover/undo APIs apply the exact plan after separate apply permission. No change is reported for identical content.', minimumPolicy: 'stage', sideEffects: ['project-read', 'change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['no active story change', 'human workspaces clean', 'authorized local source and current SHA-256', 'exact existing target with supported unambiguous format'], possibleErrors: imageImportErrors, repairRecipes: ['Inspect the original operationId after interruption; do not prepare another replacement to hide uncertain state.', 'Changed targets and unowned files are preserved. Use the original receipts for recovery or undo.'] },
  'project.stage-config.patch': { title: 'Patch stage configuration', purpose: 'Configure design coordinates, named positions/distances, character calibration and compositions. Read project.inspect.stageConfig for current value/effective defaults and fingerprint. Supplied top-level tables replace; missing tables retain; null clears a table, and patch:null removes the stage opt-in. No model, arbitrary JSON, source write or candidate configuration mutation.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['OPEN direct, not integration', 'current working stageConfig fingerprint', 'all configured assets resolve'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Read the complete current table before replacing it. Use project assets keys, not display names or guessed paths.', 'Validate and preview the working draft before separately authorized apply.'] },
  'project.theme-config.patch': { title: 'Patch work theme configuration', purpose: 'Configure theme tokens (colors/opacity/typography/spacing/radius), dialog/button skins, basic layout and title wordmark. Read project.inspect.themeConfig for value/effective/fingerprint. Token groups replace as tables; null deletes a group. Skin and titleLogo keys reference project.assets backgrounds. patch:null removes theme (titleLogo unaffected). Direct only; default appearance is preserved when fields are omitted.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['OPEN direct, not integration', 'current working themeConfig fingerprint', 'all configured asset keys resolve'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Read project.inspect.themeConfig with view=working and copy the fingerprint. Omitted fields keep current values; null clears skins/layout/titleLogo or deletes a token group.', 'Use background asset keys from project.assets, not file paths or display names.'] },
  'project.ui': { title: 'Read work UI', purpose: 'Read game.config.json.ui from project or working view, including default pages, stable node IDs, pure variable conditions, readonly progress/array displays and the whole UI fingerprint.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false, preconditions: ['working view requires the active change'], possibleErrors: [...commonErrors, 'UI_INVALID'], repairRecipes: ['Use view=working before a direct UI patch and copy its fingerprint.'] },
  'project.ui.patch': { title: 'Patch work UI', purpose: 'Set/remove a page or insert/update/remove/copy/reorder a node in game.config.json.ui. Supports pure boolean visibleWhen/enabledWhen, progress, array list/count and reading-page variable-set literal actions. Direct only; validate and write the whole UI atomically.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['OPEN direct, not integration', 'current project.ui fingerprint', 'declared variables and unique supported image assets'], possibleErrors: [...commonErrors, 'UI_INVALID', 'UNSUPPORTED_OPERATION', 'OBJECT_REF_STALE', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Re-read project.ui(view=working), fix the requested node and retry with a current fingerprint.'] },
  'asset.relocation.plan': { title: 'Plan asset relocation', purpose: 'Prepare exact same-kind asset moves and structured reference edits using the existing authority. No source publication or replacement. Preserve explicit portrait slot restrictions. Review the full plan before apply.', minimumPolicy: 'stage', sideEffects: ['project-read', 'change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['no active story change', 'use exact project.assets sourcePath and an existing target directory', 'human workspace is clean'], possibleErrors: imageImportErrors, repairRecipes: ['Inspect this operationId after an uncertain result.', 'A blocked plan does not authorize deletion or overwrite. Correct the source problem, cancel the old plan and prepare a distinct operation.'] },
  'asset.relocation.inspect': { title: 'Inspect asset relocation', purpose: 'Read an existing authoritative plan, status and receipt. Does not publish source changes or confer permission to apply a plan.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read', 'change-store-write'], idempotency: 'idempotent', composable: false, preconditions: ['operationId identifies a plan in this project'], possibleErrors: imageImportErrors, repairRecipes: ['Continue using the same operationId, plan fingerprint and existing recovery state.'] },
  'asset.relocation.commit': { title: 'Commit asset relocation', purpose: 'Explicitly apply the exact prepared move/reference batch. Recheck source, bytes, readers and recovery barriers; no clobber of unrelated targets.', minimumPolicy: 'apply', sideEffects: ['project-write', 'change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['no active story change', 'human workspace is clean', 'plan fingerprint matches'], possibleErrors: imageImportErrors, repairRecipes: ['Inspect the original operation after response loss. Never repeat an unknown write using a new identifier.'] },
  'asset.relocation.cancel': { title: 'Cancel asset relocation plan', purpose: 'Cancel an unpublished plan and its owned preparation only. This is not an undo of published source files.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['no active story change', 'plan fingerprint matches', 'publication has not started'], possibleErrors: imageImportErrors, repairRecipes: ['Use explicit recovery for an interrupted publication, not cancel.'] },
  'asset.relocation.recover': { title: 'Recover asset relocation', purpose: 'Resume or roll back the original authoritative batch. Unknown or changed files remain protected; do not treat a recovery-required response as success.', minimumPolicy: 'apply', sideEffects: ['project-write', 'change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['no active story change', 'human workspace is clean', 'original plan fingerprint matches'], possibleErrors: imageImportErrors, repairRecipes: ['Inspect and retain original journal and backups; resolve missing external permissions without changing receipt identities.'] },
  'asset.relocation.undo': { title: 'Undo asset relocation', purpose: 'Restore all files and references owned by one completed relocation after checking the original receipt and every current file. It does not delete arbitrary unused assets.', minimumPolicy: 'apply', sideEffects: ['project-write', 'change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['no active story change', 'human workspace is clean', 'original receipt identity matches and current files have not drifted'], possibleErrors: imageImportErrors, repairRecipes: ['A changed target or edited source is preserved; never bypass undo preflight to force an old version.'] },
  'script.import.preview': { title: 'Preview script import', purpose: 'Read-only UTF-8 text or comma-separated CSV conversion. Review every row, warning and error; ready blocks contain dialogue only and can be copied to scene.create for a new draft. No file upload, instruction execution, character creation or source overwrite. CSV columns are zero-based; null speakerColumn explicitly means narration. speakerMap maps source names to chosen display names, including empty source/target for narration.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false, preconditions: ['source is decoded UTF-8 text supplied by the caller', 'working view requires the active change'], possibleErrors: ['INVALID_REQUEST', 'PROJECT_NOT_FOUND', 'PROJECT_INVALID', 'CHANGE_NOT_FOUND', 'PROJECT_IDENTITY_MISMATCH'], repairRecipes: ['Inspect returned columns and source line issues. Correct mappings or input, preview again, and only create a fresh scene when ready is true.', 'Use explicit view to select project or working character suggestions; never infer apply permission from a successful preview.'] },
  'scene.move': { title: 'Move scene to chapter', purpose: 'Move one unique scene to a relative chapter directory in a direct working change. Empty directory means content/scenario root. Keep the exact filename, scene ID, script bytes and references; pin a missing implicit entry to its former scene. No source publication, candidate composition or old-save migration.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct, not candidate/integration', 'copy source.path and full fingerprint from the same object.inspect view:working', 'target is different, unoccupied and inside content/scenario'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_NOT_FOUND', 'OBJECT_AMBIGUOUS', 'OBJECT_REF_STALE', 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Re-read the scene after moving; unchanged source text does not mean the previous path is current.', 'Review both paths and any entry configuration in change.diff, play the working draft, then use separately authorized apply.', ...mutateRepair] },
  'scene.rename': { title: 'Rename scene', purpose: 'Rename one unique scene inside a direct working change. Preserve its directory and source layout; rewrite actual jump/call/choice targets plus existing entry, endings, gallery replay, events, growth and calendar scene fields atomically. Return every affected path and the new continuation identity. Not a source write, candidate operation or old-save migration.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct, not candidate/integration', 'copy full scene fingerprint from object.inspect view:working', 'new ID is distinct and unoccupied, including case-insensitive filenames'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_NOT_FOUND', 'OBJECT_AMBIGUOUS', 'OBJECT_REF_STALE', 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Read the new sceneRef from continuation after renaming; old object refs must be refreshed.', 'Inspect affectedPaths/change.diff and play the working change before separately authorized apply.', 'Ambiguous quoted targets or malformed host configurations must be corrected before retry; no partial rewrite is persisted.', ...mutateRepair] },
  'scene.remove': { title: 'Remove scene', purpose: 'Remove one unreferenced scene from an isolated direct draft, never the source project immediately. Read scene:<id> with view:working for its full-file fingerprint. Refuse entry/end scenes, incoming jump/call/choice targets, gallery text replays and event/growth/calendar roots; no cascading edits. The normal diff, validation, capsule and authorized commit record and publish the deletion.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct, not candidate/integration', 'scene identity is unique and full-file fingerprint is current', 'no incoming references remain'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_NOT_FOUND', 'OBJECT_AMBIGUOUS', 'OBJECT_REF_STALE', 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Read object.inspect scene:<id> with view:working and copy fingerprint; do not compute or guess it.', 'Inspect error details.references and explicitly update callers/config first. Deletion never removes references for you.', ...mutateRepair] },
  'project.player-config.patch': { title: 'Patch player configuration', purpose: 'Patch finite display settings in game.config.json using project.inspect.playerConfig fingerprint. Explicit PlayerProject options override config, which overrides content-independent defaults. Ordinary direct drafts only; no arbitrary JSON or source editing.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: false, preconditions: ['active change is OPEN and direct', 'working playerConfig fingerprint is current', 'background and ending scene references exist'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['read project.inspect with view=working and copy playerConfig.fingerprint; null restores absence, empty values explicitly clear', ...mutateRepair] },
  'project.gallery': { title: 'Inspect gallery and story dossier entries', purpose: 'Read CG id/name/src, replay id/name/scene/label/variables, ending id/name/description, profile id/character/title/description, term id/canonical/description, unlock policy and current entry fingerprints from the active working change, or the bound project when no change is active. src is a project.assets background key; omitted src uses id.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['bound project or active change is readable'], possibleErrors: [...commonErrors, 'CHANGE_NOT_FOUND', 'OBJECT_AMBIGUOUS'], repairRecipes: readRepair },
  'gallery.cg.create': { title: 'Create CG entry', purpose: 'Add one CG without replacing gallery.json or changing other CG/music/text/unknown fields. Import images first, refresh project.assets, create CGs before scenes that unlock them with the existing unlock_cg instruction. Unlocks follow existing per-save rules.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'id is new', 'src or id names a resolved project.assets.backgrounds key'], possibleErrors: [...commonErrors, 'OBJECT_PRECONDITION_FAILED', 'OBJECT_AMBIGUOUS', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Read project.gallery before creating; configure CGs before adding @unlock_cg references with scene.create/scene.patch.', ...mutateRepair] },
  'gallery.cg.patch': { title: 'Patch CG entry', purpose: 'Update only one CG name/src using its current entry fingerprint. id remains stable. Omitted fields and unknown fields are preserved; src:null restores the existing id fallback. Distinct CGs compose independently; competing changes to the same CG require an explicit selection.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'copy expectedFingerprint from project.gallery or object.inspect of gallery:cgs:<id>'], possibleErrors: [...commonErrors, 'OBJECT_NOT_FOUND', 'OBJECT_AMBIGUOUS', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['Read the active change with project.gallery; retry with the current CG fingerprint after inspecting its fields.', ...mutateRepair] },
  'asset.sources': { title: "Inspect authorized asset sources", purpose: "Discover startup-authorized directories and inspect image, audio, video and font containers before staging. Container-header validation is not decoding or license certification. No downloads, transcoding or arbitrary paths.", minimumPolicy: 'observe', sideEffects: ["project-read", "authorized-source-read"], idempotency: 'pure-read', composable: false, preconditions: ["startup source directories explicitly granted"], possibleErrors: imageImportErrors, repairRecipes: ['After an uncertain response inspect the same operationId; do not create a replacement.', 'Import first, refresh project/assets facts, then start a story change.'] },
  'asset.import.stage': { title: "Stage assets", purpose: "Stage and seal an asset import using the existing import authority, without writing project files. Retry the same operationId; source requests stay immutable. Blocked targets may be corrected before sealing.", minimumPolicy: 'stage', sideEffects: ["project-read", "authorized-source-read", "change-store-write"], idempotency: 'operation-id', composable: false, preconditions: ["no active story change","source digests copied from asset.sources"], possibleErrors: imageImportErrors, repairRecipes: ['After an uncertain response inspect the same operationId; do not create a replacement.', 'Import first, refresh project/assets facts, then start a story change.'] },
  'asset.import.inspect': { title: "Inspect asset import", purpose: "Reconcile the durable progress of one asset import, including after restart or response loss. Never creates another operation.", minimumPolicy: 'observe', sideEffects: ["project-read","change-store-read","change-store-write"], idempotency: 'idempotent', composable: false, preconditions: ["operationId identifies an Agent asset import"], possibleErrors: imageImportErrors, repairRecipes: ['After an uncertain response inspect the same operationId; do not create a replacement.', 'Import first, refresh project/assets facts, then start a story change.'] },
  'asset.import.commit': { title: "Commit asset import", purpose: "Explicitly publish sealed assets without overwriting files. Then refresh project.assets/project.inspect before change.begin and use catalog keys for story authoring.", minimumPolicy: 'apply', sideEffects: ["project-write","change-store-write"], idempotency: 'operation-id', composable: false, preconditions: ["no active story change","bound workspaces absent or clean","sealed plan fingerprint matches"], possibleErrors: imageImportErrors, repairRecipes: ['After an uncertain response inspect the same operationId; do not create a replacement.', 'Import first, refresh project/assets facts, then start a story change.'] },
  'asset.import.recover': { title: "Recover asset import", purpose: "Recover sealed publication with planFingerprint, or discard an interrupted never-sealed upload using manifestFingerprint returned by inspect. A discarded upload returns ROLLED_BACK; start a fresh operationId. Does not expose asset undo, project deletion or relocation.", minimumPolicy: 'apply', sideEffects: ["project-write","change-store-write"], idempotency: 'operation-id', composable: false, preconditions: ["no active story change","bound workspaces absent or clean","same operationId and plan fingerprint, or the manifest fingerprint for a never-sealed upload"], possibleErrors: imageImportErrors, repairRecipes: ['After an uncertain response inspect the same operationId; do not create a replacement.', 'Import first, refresh project/assets facts, then start a story change.'] },
  'capabilities.describe': { title: 'Describe capabilities', purpose: 'Return the shared authoring contract and available capability definitions.', minimumPolicy: 'observe', sideEffects: ['none'], idempotency: 'pure-read', composable: false, preconditions: [], possibleErrors: ['INVALID_REQUEST'], repairRecipes: readRepair },
  'project.inspect': { title: 'Inspect project', purpose: 'Read the canonical project object and revision view. charactersFingerprint is the current complete table fingerprint for character.ensure/remove, including when there are no characters. Use view:working for draft edits.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false, preconditions: ['project root must exist'], possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_INVALID'], repairRecipes: readRepair },
  'project.assets': { title: 'Inspect project assets', purpose: 'Read physical asset metadata, references and health facts. Valid unambiguous backgrounds/portraits include usage.scene blocks for scene.create/patch and usage.timeline tracks for timeline.create. Copy these real-key examples, then choose timing/position; no file writes. Avatars are dialogue icons, not standing portraits. Missing usage never authorizes guessing a key; inspect intelligence.issues.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false, preconditions: ['project root must exist'], possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_INVALID'], repairRecipes: readRepair },
  'object.inspect': { title: 'Inspect object', purpose: 'Read one stable object reference, its fingerprint, and one-level childRefs for exact traversal.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['objectRef must identify one object'], possibleErrors: ['OBJECT_NOT_FOUND', 'OBJECT_AMBIGUOUS', 'OBJECT_REF_STALE'], repairRecipes: readRepair },
  'change.begin': { title: 'Begin change', purpose: 'Create an isolated authoring change from a fresh project snapshot.', minimumPolicy: 'stage', sideEffects: ['project-read', 'change-store-write'], idempotency: 'non-idempotent', composable: false, preconditions: ['project root must be stable', 'no conflicting active change'], possibleErrors: [...commonErrors, 'CHANGE_ID_AMBIGUOUS'], repairRecipes: ['inspect the project and session state before starting a new change'] },
  'scene.create': { title: 'Create scene', purpose: 'Create one typed scene document inside the active change. Append a final @end only when blocks do not already end with it; preserve intentional branch endings. @end does not record a clear: use @clear endingId at a collected ending. Blocks include choices with display conditions/effects/targets and recursively nested if/elif/else condition blocks; the Core parser and compiler validate every pairing.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'operationId is fresh or identical'], possibleErrors: [...commonErrors, 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['the minimal example requires a declared number variable trust with a positive initial value and a fresh scene id', "use instruction name 'timeline' with the timeline id in args[0]; never use 'timeline.play'", 'for nested condition creation provide blocks for every branch; use scene.patch only after object.inspect exposes a current structure fingerprint', ...mutateRepair] },
  'scene.patch': { title: 'Patch scene', purpose: 'Patch scene objects using current fingerprints. renameLabel/removeLabel require a direct draft, never candidate/integration; rename updates precise local/cross-scene targets and remove rejects used labels. affectedScenes lists all changed scenes. replaceChoiceGroup edits the complete choice group atomically; replaceConditionBlock edits one paired nested condition atomically and preserves omitted sourceBranch bodies byte-for-byte. The structural fingerprint in choice.details.structure or condition.details.structure is separate from the original line fingerprint used by existing row operations.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'target and every supplied sourceBranch reference the current working object index', 'expectedFingerprint is the complete structure fingerprint for choice/condition edits'], possibleErrors: [...commonErrors, 'UNSUPPORTED_OPERATION', 'OBJECT_NOT_FOUND', 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: ['the minimal example requires number trust, string route, scene x with a current choice and left label, and scene right; copy the current choice reference and structure fingerprint', "use instruction name 'timeline' with the timeline id in args[0]; never use 'timeline.play'", 'inspect the scene root, then inspect the complete choice or condition object and copy its structure fingerprint and direct childRefs', 'for replaceConditionBlock omit blocks only with a current direct sourceBranch to preserve its body; provide blocks for each new branch', ...mutateRepair] },
  'variable.ensure': { title: 'Ensure variable', purpose: 'Ensure one variable declaration without changing an equivalent declaration.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN'], possibleErrors: [...commonErrors, 'OBJECT_PRECONDITION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'variable.patch-initial': { title: 'Patch variable initial', purpose: 'Update only the initial value of one existing variable declaration using its complete declaration fingerprint. Name, type, readonly, range constraints, and unknown declaration fields are preserved; numeric range violations are rejected without clamping.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'variable declaration fingerprint is current'], possibleErrors: [...commonErrors, 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'character.ensure': { title: 'Ensure character', purpose: 'Create or update one character declaration. Read project.inspect(view:working).charactersFingerprint first, even for the first character in an empty project. id/name identify dialogue speakers; portrait role/outfit/expression identify standing artwork. Keep id equal to portrait role when they represent the same speaker.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'character table fingerprint is current'], possibleErrors: [...commonErrors, 'OBJECT_REF_STALE', 'OBJECT_AMBIGUOUS', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'character.remove': { title: 'Remove character', purpose: 'Remove one character declaration with a table fingerprint.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'character table fingerprint is current'], possibleErrors: [...commonErrors, 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'timeline.create': { title: 'Create timeline', purpose: 'Create one validated presentation timeline with background, portrait, camera, screen, particle or audio tracks. Audio actions are bgm, se and voice using prepared project media; copy project.assets intelligence item usage.timeline. Cue actions and parameters follow the shared Core validator; no audio production or new media permissions.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'definition passes the shared timeline whitelist and Core validation'], possibleErrors: [...commonErrors, 'VALIDATION_FAILED', 'UNSUPPORTED_OPERATION', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'timeline.patch': { title: 'Patch timeline', purpose: 'Patch one validated timeline duration, track target, track, or cue with its current full fingerprint. setDuration and setTrackTarget preserve every other field; replaceCue is a complete cue replacement. Audio tracks use channel-specific prepared bgm, se and voice assets and the same candidate dependencies; other tracks and unknown fields remain intact.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'timeline, track, or cue fingerprint is current'], possibleErrors: [...commonErrors, 'OBJECT_NOT_FOUND', 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'UNSUPPORTED_OPERATION', 'OPERATION_ID_CONFLICT'], repairRecipes: ['object.inspect the timeline and copy an exact trackRef from childRefs; inspect that track and copy an exact cueRef from childRefs', 'for setDuration use the full timeline fingerprint and keep every cue within the new duration; Core rejects overflow rather than truncating', 'for setTrackTarget copy the track fingerprint and use project.assets.portraits[].timelineTarget for portrait tracks; pass null to remove a target', ...mutateRepair] },
  'project.entry-scene.set': { title: 'Set entry scene', purpose: 'Set the project entry scene with an entry-field fingerprint.', minimumPolicy: 'stage', sideEffects: ['change-store-write'], idempotency: 'operation-id', composable: true, preconditions: ['active change is OPEN', 'target scene exists', 'entry fingerprint is current'], possibleErrors: [...commonErrors, 'OBJECT_REF_STALE', 'VALIDATION_FAILED', 'OPERATION_ID_CONFLICT'], repairRecipes: mutateRepair },
  'project.validate': { title: 'Validate project', purpose: 'Run shared validation and write fresh validation evidence.', minimumPolicy: 'observe', sideEffects: ['project-read', 'evidence-write'], idempotency: 'idempotent', composable: false, preconditions: ['project snapshot is readable'], possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_INVALID', 'CHANGE_NOT_FOUND'], repairRecipes: ['inspect the project or change before retrying validation'] },
  'project.simulate': { title: 'Simulate project', purpose: 'Run the shared deterministic simulation and write evidence. A passed status alone does not certify story completion: compare endings with all expected @clear IDs and inspect deadEndScenes for missing transitions or clears; player.endScenes only controls returning to title.', minimumPolicy: 'observe', sideEffects: ['project-read', 'evidence-write'], idempotency: 'idempotent', composable: false, preconditions: ['project snapshot is readable'], possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_INVALID', 'SIMULATION_INCOMPLETE', 'RUNTIME_FAILED'], repairRecipes: ['inspect validation and simulation evidence before retrying'] },
  'project.preview-path': { title: 'Find preview target path', purpose: 'Read the selected project or working snapshot and execute the real Core debugger to a source line. Search, explicit path and isolated test inputs never certify whole-project simulation or invent state past a host boundary.', minimumPolicy: 'observe', sideEffects: ['project-read'], idempotency: 'pure-read', composable: false, preconditions: ['project snapshot is readable', 'target source line has a real Core instruction'], possibleErrors: ['PROJECT_NOT_FOUND', 'PROJECT_INVALID', 'OBJECT_NOT_FOUND', 'INVALID_REQUEST', 'CHANGE_NOT_FOUND', 'PROJECT_IDENTITY_MISMATCH'], repairRecipes: ['Use sceneId and a one-based executable line from the current read view; comments and blanks are rejected.', 'Only test mode accepts temporary variables. Inspect actual coverage conditions, budget exhaustion, and host-boundary status before retrying.'] },
  'runtime.run-from': { title: 'Run from scene', purpose: 'Run one explicit deterministic runtime path and persist its trace.', minimumPolicy: 'stage', sideEffects: ['runtime-process', 'evidence-write'], idempotency: 'non-idempotent', composable: false, preconditions: ['active change is OPEN', 'scene and choices are explicit'], possibleErrors: ['RUNTIME_FAILED', 'RUNTIME_TIMED_OUT', 'PROJECT_INVALID'], repairRecipes: ['label is an optional in-scene @label name; omit label to run from the scene beginning', 'inspect the scene, validate, and retry with explicit choices'] },
  'runtime.read-trace': { title: 'Read runtime trace', purpose: 'Read a persisted runtime trace with an optional stable query.', minimumPolicy: 'observe', sideEffects: ['change-store-read'], idempotency: 'pure-read', composable: false, preconditions: ['traceId must identify a stored trace'], possibleErrors: ['PROJECT_NOT_FOUND', 'CHANGE_NOT_FOUND'], repairRecipes: readRepair },
  'runtime.read-preview': { title: 'Read actual Editor preview', purpose: 'Read actual bound-Editor preview events, presentation snapshots and source object refs for its selected saved project or isolated working change. Use the Editor 试玩内容 selector to play a working change before committing. Separate from Core explicit-path evidence and screenshots; never certifies pixels or approves/commits a change.', minimumPolicy: 'observe', sideEffects: ['project-read', 'change-store-read'], idempotency: 'pure-read', composable: false,
    preconditions: ['Open the normal bound Editor and select 试玩内容 to play the saved project, working change, sealed candidate or ready integration result; human drafts are not saved or discarded', 'Only status=current belongs to the selected version. Check observation.content for changeId, workingRevision or sealed identity, and observation.state for partial or completed runs. Repair a working change with existing authoring operations then reload. Sealed candidates/results are read-only: return to their source candidate change, edit and repackage/recompose; never modify sealed content or reuse old approval.', '回到上次位置 replays actual recorded choices and seed through the existing interpreter; if choice identity, condition or visibility changed, choose again at the real choice prompt'],
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

const schemaKeys = {
  'project.ui': 'ui',
  'project.ui.patch': 'uiPatch',
  'project.stage-config.patch': 'stageConfigPatch',
  'project.player-config.patch': 'playerConfigPatch',
  'project.theme-config.patch': 'themeConfigPatch',
  'asset.sources': 'assetSources',
  'project.history': 'history',
  'project.history.checkpoint': 'historyCheckpoint',
  'project.history.compare': 'historyCompare',
  'project.history.restore': 'historyRestore',
  'project.gallery': 'gallery',
  'script.import.preview': 'scriptImportPreview',
  'project.texts': 'texts',
  'project.texts.import.preview': 'textsImportPreview',
  'project.texts.patch': 'textsPatch',
  'gallery.cg.create': 'galleryCgCreate',
  'gallery.cg.patch': 'galleryCgPatch',
  'gallery.policy.patch': 'galleryPolicyPatch',
  'gallery.text.create': 'galleryTextCreate',
  'gallery.text.patch': 'galleryTextPatch',
  'gallery.ending.create': 'galleryEndingCreate',
  'gallery.ending.patch': 'galleryEndingPatch',
  'gallery.profile.create': 'galleryProfileCreate',
  'gallery.profile.patch': 'galleryProfilePatch',
  'gallery.term.create': 'galleryTermCreate',
  'gallery.term.patch': 'galleryTermPatch',
  'asset.relocation.replace': 'assetRelocationReplace',
  'asset.relocation.plan': 'assetRelocationPlan',
  'asset.relocation.inspect': 'assetRelocationInspect',
  'asset.relocation.commit': 'assetRelocationCommit',
  'asset.relocation.cancel': 'assetRelocationCancel',
  'asset.relocation.recover': 'assetRelocationRecover',
  'asset.relocation.undo': 'assetRelocationUndo',
  'asset.import.stage': 'assetImportStage',
  'asset.import.inspect': 'assetImportInspect',
  'asset.import.commit': 'assetImportCommit',
  'asset.import.recover': 'assetImportRecover',
  'capabilities.describe': 'describe',
  'project.inspect': 'inspect',
  'project.assets': 'assets',
  'object.inspect': 'objectInspect',
  'change.begin': 'begin',
  'scene.create': 'sceneCreate',
  'scene.remove': 'sceneRemove',
  'scene.rename': 'sceneRename',
  'scene.move': 'sceneMove',
  'scene.patch': 'scenePatch',
  'variable.ensure': 'variableEnsure',
  'variable.patch-initial': 'variablePatchInitial',
  'character.ensure': 'characterEnsure',
  'character.remove': 'characterRemove',
  'timeline.create': 'timelineCreate',
  'timeline.patch': 'timelinePatch',
  'project.entry-scene.set': 'entrySceneSet',
  'project.validate': 'validate',
  'project.simulate': 'simulate',
  'project.preview-path': 'previewPath',
  'runtime.run-from': 'runFrom',
  'runtime.read-trace': 'readTrace',
  'runtime.read-preview': 'readPreview',
  'change.diff': 'diff',
  'change.commit': 'commit',
  'change.rollback': 'rollback',
  'change.recovery.inspect': 'recoveryInspect',
  'composition.compare': 'compositionCompare',
  'composition.plan': 'compositionPlan',
  'composition.inspect': 'compositionInspect',
  'composition.execute': 'compositionExecute',
  'review.prepare-comparison': 'reviewPrepareComparison',
  'review.inspect-decision': 'reviewInspectDecision',
  'review.prepare-result': 'reviewPrepareResult',
  'review.inspect-approval': 'reviewInspectApproval',
  'change.recovery.execute': 'recoveryExecute',
} satisfies Record<AuthoringCapabilityId, keyof typeof definitions>;

function definitionFor(id: AuthoringCapabilityId): AuthoringCapabilityDefinition {
  const item = metadata[id];
  const schema = definitions[schemaKeys[id]];
  return {
    id,
    title: item.title,
    purpose: item.purpose,
    minimumPolicy: item.minimumPolicy,
    inputSchema: withJsonValueDefinition(schema.inputSchema),
    outputSchema: withJsonValueDefinition(schema.outputSchema),
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
