import { describe, expect, it } from 'vitest';
import {
  AUTHORING_CAPABILITY_IDS,
  AUTHORING_CAPABILITY_REGISTRY,
 assertCapabilityRegistry,
 nativeCapabilityToMcpTool,
 getCapabilityDefinition,
  type AuthoringCapabilityId,
} from '../src/index.js';
describe('authoring capability registry', () => {
  it('is the single complete 62-capability contract', () => {
    expect(AUTHORING_CAPABILITY_IDS).toHaveLength(62);
    expect(new Set(AUTHORING_CAPABILITY_IDS).size).toBe(62);
    expect(AUTHORING_CAPABILITY_IDS).toEqual([
      'capabilities.describe', 'project.inspect', 'project.ui', 'project.texts', 'project.texts.import.preview', 'project.texts.patch', 'project.assets', 'project.gallery', 'script.import.preview',
      'asset.sources', 'asset.import.stage', 'asset.import.inspect', 'asset.import.commit', 'asset.import.recover', 'asset.relocation.replace', 'asset.relocation.plan', 'asset.relocation.inspect', 'asset.relocation.commit', 'asset.relocation.cancel', 'asset.relocation.recover', 'asset.relocation.undo', 'object.inspect',
      'change.begin', 'scene.create', 'scene.remove', 'scene.rename', 'scene.move', 'scene.patch', 'variable.ensure', 'variable.patch-initial',
      'character.ensure', 'character.remove', 'timeline.create', 'timeline.patch',
      'gallery.cg.create', 'gallery.cg.patch', 'gallery.policy.patch', 'gallery.text.create', 'gallery.text.patch',
      'project.entry-scene.set', 'project.player-config.patch', 'project.stage-config.patch', 'project.theme-config.patch', 'project.ui.patch', 'project.validate', 'project.simulate',
      'runtime.run-from', 'runtime.read-trace', 'runtime.read-preview', 'change.diff', 'change.commit',
      'change.rollback', 'change.recovery.inspect', 'change.recovery.execute',
      'composition.compare', 'composition.plan', 'composition.inspect', 'composition.execute',
      'review.prepare-comparison', 'review.inspect-decision', 'review.prepare-result', 'review.inspect-approval',
    ]);
    expect(() => assertCapabilityRegistry(AUTHORING_CAPABILITY_REGISTRY)).not.toThrow();
  });

  it('advertises change and project lease conflicts for change.commit', () => {
    const commit = AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'change.commit');
    expect(commit?.possibleErrors).toEqual(expect.arrayContaining(['CHANGE_BUSY', 'PROJECT_BUSY']));
  });

  it('maps native ids to unique stable MCP tool names', () => {
    const names = AUTHORING_CAPABILITY_IDS.map(nativeCapabilityToMcpTool);
    expect(new Set(names).size).toBe(62);
    expect(nativeCapabilityToMcpTool('project.entry-scene.set'))
      .toBe('surdet_project_entry_scene_set');
    expect(nativeCapabilityToMcpTool('runtime.run-from'))
      .toBe('surdet_runtime_run_from');
  });

  it('requires strict schemas, side effects, errors, repairs and examples', () => {
    for (const definition of AUTHORING_CAPABILITY_REGISTRY) {
      const inputSchemas = definition.id === 'composition.plan'
        ? (definition.inputSchema.oneOf as Array<Record<string, unknown>>)
        : [definition.inputSchema];
      for (const inputSchema of inputSchemas) {
        expect(inputSchema.type).toBe('object');
        expect(inputSchema.additionalProperties).toBe(false);
      }
      expect(definition.outputSchema).toBeTruthy();
      expect(definition.sideEffects.length).toBeGreaterThan(0);
      expect(definition.possibleErrors.length).toBeGreaterThan(0);
      expect(definition.repairRecipes.length).toBeGreaterThan(0);
      expect(definition.minimalExample.input).toEqual(expect.any(Object));
      expect(definition.minimalExample.expectedResultShape).toEqual(expect.any(Object));
    }
  });

  it('publishes the exact change initiator enum and timeline self-repair hints', () => {
    const begin = AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'change.begin')!;
    const beginProperties = begin.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(beginProperties['initiator']?.['enum']).toEqual(['external-agent', 'human', 'automation']);

    const assets = AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'project.assets')!;
    const assetProperties = (((assets.outputSchema.properties as any).portraits.items as any).properties) as Record<string, unknown>;
    expect(assetProperties).toHaveProperty('timelineTarget');

    const inspect = AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'object.inspect')!;
    expect(inspect.outputSchema.properties).toHaveProperty('childRefs');

    const timelinePatch = AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'timeline.patch')!;
    expect(timelinePatch.repairRecipes.join(' ')).toContain('childRefs');
  });

  it('publishes exact timeline instruction and run-from label semantics', () => {
    const sceneCreate = AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'scene.create')!;
    const blockAlternatives = (((sceneCreate.inputSchema.properties as any).blocks.items as any).oneOf) as any[];
    const instruction = blockAlternatives.find((schema) => schema.properties?.kind?.const === 'instruction');
    expect(instruction.properties.name.description).toContain("exactly 'timeline'");
    expect(instruction.properties.name.description).toContain("never 'timeline.play'");
    expect(instruction.properties.name.examples).toContain('timeline');

    const runFrom = AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'runtime.run-from')!;
    const label = (runFrom.inputSchema.properties as any).label;
    expect(label.description).toContain('in-scene @label');
    expect(label.description).toContain('omit');
    expect(runFrom.repairRecipes.join(' ')).toContain('omit label');
  });

  it('publishes recursive condition blocks and atomic structure patch contracts', () => {
    const create = getCapabilityDefinition('scene.create');
    const createSchema = create.inputSchema as Record<string, any>;
    const alternatives = (createSchema.properties.blocks.items.oneOf as Array<Record<string, any>>);
    const condition = alternatives.find((schema) => schema.properties?.kind?.const === 'condition');
    expect(condition).toBeDefined();
    expect(condition?.properties.branches).toMatchObject({ type: 'array', minItems: 1, items: { $ref: '#/$defs/sceneConditionBranch' } });
    expect(createSchema.$defs.sceneConditionBranch.oneOf).toHaveLength(3);
    expect(createSchema.$defs.sceneConditionBranch.oneOf[0].properties.blocks.items).toEqual({ $ref: '#/$defs/sceneBlock' });

    const patch = getCapabilityDefinition('scene.patch').inputSchema as Record<string, any>;
    const variants = patch.properties.patch.oneOf as Array<Record<string, any>>;
    expect(variants.map((variant) => variant.properties.kind.const)).toEqual([
      'patchStageProperties', 'replaceText', 'replaceInstruction', 'insertAfter', 'replaceChoiceOption',
      'replaceChoiceGroup', 'replaceConditionBlock', 'removeObject', 'renameLabel', 'removeLabel',
    ]);
    const choice = variants.find((variant) => variant.properties.kind.const === 'replaceChoiceGroup')!;
    expect(choice.properties.choice.properties.kind.const).toBe('choice');
    const conditionPatch = variants.find((variant) => variant.properties.kind.const === 'replaceConditionBlock')!;
    expect(conditionPatch.properties.condition.properties.branches.items)
      .toEqual({ $ref: '#/$defs/sceneConditionPatchBranch' });
    expect(patch.$defs.sceneConditionPatchBranch.oneOf).toHaveLength(9);
  });

  it('publishes supported visual/audio timeline schemas and patch variants', () => {
    const create = getCapabilityDefinition('timeline.create');
    const definition = create.inputSchema.properties as Record<string, any>;
    const timeline = definition.definition as Record<string, any>;
    expect(timeline.properties.durationMs).toMatchObject({ type: 'integer', minimum: 0, maximum: 600000 });
    expect(timeline.properties.tracks).toMatchObject({ type: 'array' });
    expect(timeline.properties.version.enum).toEqual([1, 2]);
    expect(timeline.properties.clips).toMatchObject({ type: 'array', maxItems: 256 });
    const track = timeline.properties.tracks.items as Record<string, any>;
    expect(track.properties.kind.enum).toEqual(['background', 'portrait', 'camera', 'screen', 'particle', 'audio', 'layer']);
    const cue = track.properties.cues.items as Record<string, any>;
    expect(cue.properties.action.enum).toEqual([
      'pose', 'set', 'show', 'hide', 'move', 'expression', 'zoom', 'pan', 'shake',
      'fade', 'tint', 'flash', 'wipe', 'start', 'stop', 'bgm', 'se', 'voice',
    ]);
    expect(cue.properties).toEqual(expect.objectContaining({
      key: expect.any(Object), expression: expect.any(Object), position: expect.any(Object),
      alpha: expect.any(Object), scale: expect.any(Object), x: expect.any(Object),
      y: expect.any(Object), strength: expect.any(Object), color: expect.any(Object), kind: expect.any(Object),
    }));

    const patch = getCapabilityDefinition('timeline.patch').inputSchema.properties as Record<string, any>;
    const variants = patch.patch.oneOf as Array<Record<string, any>>;
    expect(variants.map((variant) => variant.properties.kind.const)).toEqual([
      'setVersion', 'setClips', 'addTrack', 'setDuration', 'removeTrack', 'setTrackTarget', 'insertCue', 'replaceCue', 'removeCue',
    ]);
    expect(variants.find((variant) => variant.properties.kind.const === 'setDuration')?.properties.durationMs)
      .toMatchObject({ type: 'integer', minimum: 0, maximum: 600000 });
    expect(variants.find((variant) => variant.properties.kind.const === 'setTrackTarget')?.properties.target)
      .toEqual({ oneOf: [{ type: 'string' }, { type: 'null' }] });
    expect(getCapabilityDefinition('timeline.patch').possibleErrors).toContain('UNSUPPORTED_OPERATION');
  });

  it('publishes strict recovery inspect/execute schemas and apply policy', () => {
    const registry = AUTHORING_CAPABILITY_REGISTRY as unknown as ReadonlyArray<Record<string, any>>;
    const inspect = registry.find((definition) => definition.id === 'change.recovery.inspect');
    const execute = registry.find((definition) => definition.id === 'change.recovery.execute');
    expect(inspect).toBeDefined();
    expect(execute).toBeDefined();
    expect(inspect).toMatchObject({ minimumPolicy: 'observe', idempotency: 'pure-read', sideEffects: ['change-store-read', 'project-read'] });
    expect(inspect!.inputSchema).toMatchObject({ type: 'object', additionalProperties: false, properties: {} });
    expect((inspect!.outputSchema.properties as Record<string, unknown>).disposition).toMatchObject({ enum: ['NO_ACTION', 'REOPEN_OPEN', 'ROLL_BACK_TO_BASE', 'FINALIZE_COMMITTED', 'MANUAL_RECOVERY_REQUIRED'] });
    expect(execute).toMatchObject({ minimumPolicy: 'apply', idempotency: 'operation-id', sideEffects: ['project-read', 'project-write', 'change-store-write'] });
    expect(execute!.inputSchema).toMatchObject({ type: 'object', additionalProperties: false, required: ['operationId', 'recoveryToken'] });
  });
});

describe('wave 5 composition capabilities', () => {
  it('retains the four composition entries in the complete registry', () => {
    expect(AUTHORING_CAPABILITY_IDS).toHaveLength(62);
    expect(getCapabilityDefinition('composition.compare').minimumPolicy).toBe('observe');
    expect(getCapabilityDefinition('composition.plan').sideEffects).toContain('change-store-write');
    expect(getCapabilityDefinition('composition.execute').minimumPolicy).toBe('stage');
    expect(getCapabilityDefinition('composition.inspect').minimumPolicy).toBe('observe');
  });

  it('marks only the eleven content mutations composable; composition.* must be false', () => {
    const composableWhitelist = new Set([
      'scene.create', 'scene.patch', 'variable.ensure', 'variable.patch-initial', 'character.ensure',
      'character.remove', 'timeline.create', 'timeline.patch', 'project.entry-scene.set',
      'gallery.cg.create', 'gallery.cg.patch',
    ]);
    for (const definition of AUTHORING_CAPABILITY_REGISTRY) {
      expect(typeof definition.composable).toBe('boolean');
      if (composableWhitelist.has(definition.id)) {
        expect(definition.composable, definition.id).toBe(true);
      } else {
        expect(definition.composable, definition.id).toBe(false);
      }
    }
    for (const id of ['composition.compare', 'composition.plan', 'composition.inspect', 'composition.execute'] as const) {
      expect(getCapabilityDefinition(id).composable).toBe(false);
    }
  });

  it('keeps definitions metadata-only: no handler, prompt, workflow or model keys', () => {
    const forbidden = ['handler', 'prompt', 'workflow', 'model', 'examplesLibrary'];
    for (const definition of AUTHORING_CAPABILITY_REGISTRY) {
      for (const key of Object.keys(definition)) {
        expect(forbidden.includes(key), `${definition.id}.${key}`).toBe(false);
      }
    }
  });

  it('publishes strict schemas for the four composition capabilities', () => {
    const cases: Array<{ id: Parameters<typeof getCapabilityDefinition>[0]; inputKeys: string[]; forbiddenInputKeys: string[] }> = [
      {
        id: 'composition.compare',
        inputKeys: ['candidateRefs'],
        forbiddenInputKeys: [],
      },
      {
        id: 'composition.plan',
        inputKeys: ['candidateRefs', 'conflictResolutions', 'reason'],
        forbiddenInputKeys: ['replayOperations', 'normalizedInput'],
      },
      {
        id: 'composition.execute',
        inputKeys: ['planId', 'artifactSha256', 'executeOperationId'],
        forbiddenInputKeys: ['changeId', 'projectRoot'],
      },
      {
        id: 'composition.inspect',
        inputKeys: ['planId', 'artifactSha256'],
        forbiddenInputKeys: [],
      },
   ];
   for (const { id, inputKeys, forbiddenInputKeys } of cases) {
     const definition = getCapabilityDefinition(id);
      const schemas = id === 'composition.plan'
        ? (definition.inputSchema['oneOf'] as Array<Record<string, any>>)
        : [definition.inputSchema as Record<string, any>];
      expect(schemas.length).toBeGreaterThan(0);
     for (const key of inputKeys) {
        expect(
          schemas.some((schema) => (schema.properties as Record<string, unknown> | undefined)?.[key] !== undefined),
          id + '.input.' + key,
        ).toBe(true);
     }
     for (const key of forbiddenInputKeys) {
        expect(
          schemas.every((schema) => (schema.properties as Record<string, unknown> | undefined)?.[key] === undefined),
          id + ' must not expose ' + key,
        ).toBe(true);
     }
      for (const schema of schemas) expect(schema.additionalProperties).toBe(false);
     expect(definition.outputSchema['additionalProperties']).toBe(false);
    }
    // candidates 数组上下界与 artifact SHA 形状
    const compare = getCapabilityDefinition('composition.compare');
    const candidateRefs = ((compare.inputSchema['properties'] as Record<string, unknown>)['candidateRefs'] ?? {}) as Record<string, unknown>;
    expect(candidateRefs['minItems']).toBe(2);
    expect(candidateRefs['maxItems']).toBe(8);
    const execute = getCapabilityDefinition('composition.execute');
    const sha = ((execute.inputSchema['properties'] as Record<string, unknown>)['artifactSha256'] ?? {}) as Record<string, unknown>;
    expect(String(sha['pattern'])).toContain('{64}');
  });
});

describe('wave 6 human review capabilities', () => {
  it('publishes exactly the four human-review capabilities without agent receipt inputs', () => {
    const expected = [
      ['review.prepare-comparison', ['candidateRefs', 'creativeBrief']],
      ['review.inspect-decision', ['reviewId', 'decisionId']],
      ['review.prepare-result', ['planId', 'artifactSha256', 'changeId']],
      ['review.inspect-approval', ['resultReviewId', 'approvalId']],
    ] as const;
    expect(AUTHORING_CAPABILITY_IDS.slice(-4)).toEqual(expected.map(([id]) => id));

    for (const [id, keys] of expected) {
      const definition = getCapabilityDefinition(id as AuthoringCapabilityId);
      const inputProperties = definition.inputSchema.properties as Record<string, unknown>;
      expect(Object.keys(inputProperties).sort(), id + '.input.keys').toEqual([...keys].sort());
      expect(definition.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      const outputSchemas = Array.isArray(definition.outputSchema.oneOf)
        ? definition.outputSchema.oneOf as Array<Record<string, unknown>>
        : [definition.outputSchema];
      for (const outputSchema of outputSchemas) {
        expect(outputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      }
      for (const forbidden of ['receipt', 'actor', 'path', 'absolutePath', 'files', 'content']) {
        expect(inputProperties[forbidden], id + '.forbidden.' + forbidden).toBeUndefined();
      }
      expect(definition.composable, id).toBe(false);
    }
  });

  it('uses a strict direct-or-reviewed composition plan union', () => {
    const plan = getCapabilityDefinition('composition.plan').inputSchema;
    const branches = plan.oneOf as Array<Record<string, any>>;
    expect(branches).toHaveLength(2);
    for (const branch of branches) {
      expect(branch).toMatchObject({ type: 'object', additionalProperties: false });
    }
    expect(branches[0]?.properties).toEqual(expect.objectContaining({
      candidateRefs: expect.any(Object),
      comparisonFingerprint: expect.any(Object),
      selectedUnitIds: expect.any(Object),
      conflictResolutions: expect.any(Object),
    }));
    expect(branches[1]?.properties).toEqual(expect.objectContaining({
      candidateRefs: expect.any(Object),
      comparisonFingerprint: expect.any(Object),
      reviewDecision: expect.any(Object),
    }));
    expect((branches[1]?.properties as Record<string, unknown>)['selectedUnitIds']).toBeUndefined();
    expect((branches[1]?.properties as Record<string, unknown>)['actor']).toBeUndefined();
    expect((branches[1]?.properties as Record<string, unknown>)['replayOperations']).toBeUndefined();
  });
});
