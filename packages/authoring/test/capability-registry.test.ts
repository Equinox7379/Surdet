import { describe, expect, it } from 'vitest';
import {
  AUTHORING_CAPABILITY_IDS,
  AUTHORING_CAPABILITY_REGISTRY,
  assertCapabilityRegistry,
  nativeCapabilityToMcpTool,
} from '../src/index.js';

describe('authoring capability registry', () => {
  it('is the single complete 22-capability contract', () => {
    expect(AUTHORING_CAPABILITY_IDS).toHaveLength(22);
    expect(new Set(AUTHORING_CAPABILITY_IDS).size).toBe(22);
    expect(AUTHORING_CAPABILITY_IDS).toEqual([
      'capabilities.describe', 'project.inspect', 'project.assets', 'object.inspect',
      'change.begin', 'scene.create', 'scene.patch', 'variable.ensure',
      'character.ensure', 'character.remove', 'timeline.create', 'timeline.patch',
      'project.entry-scene.set', 'project.validate', 'project.simulate',
      'runtime.run-from', 'runtime.read-trace', 'change.diff', 'change.commit',
      'change.rollback', 'change.recovery.inspect', 'change.recovery.execute',
    ]);
    expect(() => assertCapabilityRegistry(AUTHORING_CAPABILITY_REGISTRY)).not.toThrow();
  });

  it('advertises change and project lease conflicts for change.commit', () => {
    const commit = AUTHORING_CAPABILITY_REGISTRY.find((definition) => definition.id === 'change.commit');
    expect(commit?.possibleErrors).toEqual(expect.arrayContaining(['CHANGE_BUSY', 'PROJECT_BUSY']));
  });

  it('maps native ids to unique stable MCP tool names', () => {
    const names = AUTHORING_CAPABILITY_IDS.map(nativeCapabilityToMcpTool);
    expect(new Set(names).size).toBe(22);
    expect(nativeCapabilityToMcpTool('project.entry-scene.set'))
      .toBe('surdet_project_entry_scene_set');
    expect(nativeCapabilityToMcpTool('runtime.run-from'))
      .toBe('surdet_runtime_run_from');
  });

  it('requires strict schemas, side effects, errors, repairs and examples', () => {
    for (const definition of AUTHORING_CAPABILITY_REGISTRY) {
      expect(definition.inputSchema.type).toBe('object');
      expect(definition.inputSchema.additionalProperties).toBe(false);
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
