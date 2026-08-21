import { describe, expect, it } from 'vitest';
import {
  AUTHORING_CAPABILITY_IDS,
  AUTHORING_CAPABILITY_REGISTRY,
  assertCapabilityRegistry,
  nativeCapabilityToMcpTool,
} from '../src/index.js';

describe('authoring capability registry', () => {
  it('is the single complete 20-capability contract', () => {
    expect(AUTHORING_CAPABILITY_IDS).toHaveLength(20);
    expect(new Set(AUTHORING_CAPABILITY_IDS).size).toBe(20);
    expect(AUTHORING_CAPABILITY_IDS).toEqual([
      'capabilities.describe', 'project.inspect', 'project.assets', 'object.inspect',
      'change.begin', 'scene.create', 'scene.patch', 'variable.ensure',
      'character.ensure', 'character.remove', 'timeline.create', 'timeline.patch',
      'project.entry-scene.set', 'project.validate', 'project.simulate',
      'runtime.run-from', 'runtime.read-trace', 'change.diff', 'change.commit',
      'change.rollback',
    ]);
    expect(() => assertCapabilityRegistry(AUTHORING_CAPABILITY_REGISTRY)).not.toThrow();
  });

  it('maps native ids to unique stable MCP tool names', () => {
    const names = AUTHORING_CAPABILITY_IDS.map(nativeCapabilityToMcpTool);
    expect(new Set(names).size).toBe(20);
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
});
