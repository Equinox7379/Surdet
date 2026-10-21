import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import { findPreviewPath, runExplicitPath } from '@surdet/authoring';
import { planFlowEdit, type FlowEditPlan } from '../src/flow-operations.js';
import { storySnapshot } from '../src/story-check.js';
import { buildFlowGraph, labelNodeId } from '../src/graph/build.js';

const source = '@scene intro\n@label a\nA\n@label b\nB\n@loop a\n';
function project(intro = source): Record<string, string> {
  return {
    'game.config.json': JSON.stringify({ entryScene: 'intro', variables: { visited: { type: 'number', initial: 0 } } }),
    'content/scenario/intro.gal': intro,
    'content/scenario/home.gal': '@scene home\n@label door\n@set visited = 7\nHome\n@end\n',
  };
}
function proposed(files: Record<string, string>, plan: FlowEditPlan): Record<string, string> {
  return { ...files, ...Object.fromEntries(plan.files.map(file => [file.path, file.after])) };
}
async function run(files: Record<string, string>, choices: number[] = []) {
  return runExplicitPath(await storySnapshot({ files }), { sceneId: 'intro', label: 'b', choices, maxSteps: 40 });
}

describe('literal @loop flow editing through Core and Authoring', () => {
  it('starts from a genuine Core local jump and a visible loop edge at the original source line', async () => {
    const compiled = compileScene(source, 'content/scenario/intro.gal', 'intro');
    expect(compiled.instructions.find(instruction => instruction.line === 6)).toMatchObject({ op: 'jump', kind: 'goto', target: 'a' });
    const graph = buildFlowGraph(new Map([['intro', compiled]]));
    expect(graph.edges).toContainEqual({ from: labelNodeId('intro', 'b'), to: labelNodeId('intro', 'a'), kind: 'loop', line: 6 });
    expect(await run(project())).toMatchObject({ status: 'failed', finalVariables: { visited: 0 }, error: expect.stringContaining('步数超过') });
  });

  it.each(['', '@end\n'])('connects before the literal loop and any following exit (%j)', async tail => {
    const files = project(source + tail), before = structuredClone(files);
    const plan = await planFlowEdit(files, { kind: 'connect', from: { sceneId: 'intro', label: 'b' }, to: { sceneId: 'home' } });
    expect(plan.files[0]!.after).toBe((source + tail).replace('@loop a', '@jump home\n@loop a'));
    expect(plan.summary).toContain('@loop 之前');
    expect(await run(proposed(files, plan))).toMatchObject({ status: 'passed', finalVariables: { visited: 7 } });
    expect(files).toEqual(before);
  });

  it('places a usable choice before the literal loop', async () => {
    const files = project(), before = structuredClone(files);
    const plan = await planFlowEdit(files, { kind: 'branch', from: { sceneId: 'intro', label: 'b' },
      options: [{ label: 'Home', to: { sceneId: 'home' } }] });
    expect(plan.files[0]!.after).toBe(source.replace('@loop a', '@choice\n  Home -> @jump home\n@loop a'));
    expect(await run(proposed(files, plan), [0])).toMatchObject({ status: 'passed', finalVariables: { visited: 7 } });
    expect(files).toEqual(before);
  });

  it('connects to a newly created scene before the literal loop', async () => {
    const files = project(), before = structuredClone(files);
    const plan = await planFlowEdit(files, { kind: 'create', from: { sceneId: 'intro', label: 'b' }, sceneId: 'new_scene' });
    expect(plan.files.find(file => file.sceneId === 'intro')!.after).toBe(source.replace('@loop a', '@jump new_scene\n@loop a'));
    const next = proposed(files, plan);
    expect(findPreviewPath(await storySnapshot({ files: next }), { sceneId: 'new_scene', line: 2, maxPaths: 20, maxStepsPerPath: 40 }).status).toBe('reached');
    expect(await run(next)).toMatchObject({ status: 'passed' });
    expect(files).toEqual(before);
  });

  it.each([{ sceneId: 'intro', label: 'done' }, { sceneId: 'home' }, { sceneId: 'home', label: 'door' }])('retargets the real literal loop to %j', async to => {
    const intro = source + '@label done\n@set visited = 2\n@end\n';
    const files = project(intro), before = structuredClone(files);
    const plan = await planFlowEdit(files, { kind: 'retarget', edge: { sceneId: 'intro', line: 6, kind: 'loop' }, to });
    const target = to.sceneId === 'intro' ? '@goto done' : `@jump home${to.label ? '.door' : ''}`;
    expect(plan.files[0]!.after).toBe(intro.replace('@loop a', target));
    expect(await run(proposed(files, plan))).toMatchObject({ status: 'passed', finalVariables: { visited: to.sceneId === 'intro' ? 2 : 7 } });
    expect(files).toEqual(before);
  });

  it('keeps backward @goto graph-loop edges retargetable', async () => {
    const intro = source.replace('@loop a', '@goto a');
    const files = project(intro);
    const plan = await planFlowEdit(files, { kind: 'retarget', edge: { sceneId: 'intro', line: 6, kind: 'loop' }, to: { sceneId: 'home' } });
    expect(plan.files[0]!.after).toBe(intro.replace('@goto a', '@jump home'));
    expect(await run(proposed(files, plan))).toMatchObject({ status: 'passed', finalVariables: { visited: 7 } });
  });

  it('still removes a literal loop without changing the caller files', async () => {
    const files = project(), before = structuredClone(files);
    const plan = await planFlowEdit(files, { kind: 'remove', edge: { sceneId: 'intro', line: 6, kind: 'loop' } });
    expect(plan.files[0]!.after).toBe(source.replace('@loop a\n', ''));
    expect(await run(proposed(files, plan))).toMatchObject({ status: 'passed' });
    expect(files).toEqual(before);
  });

  it('does not mistake a literal loop nested in a condition for the top-level segment exit', async () => {
    const intro = source.replace('@loop a', '@if visited > 0\n@loop a\n@endif');
    const files = project(intro);
    const plan = await planFlowEdit(files, { kind: 'connect', from: { sceneId: 'intro', label: 'b' }, to: { sceneId: 'home' } });
    expect(plan.files[0]!.after).toBe(intro + '@jump home\n');
    expect(await run(proposed(files, plan))).toMatchObject({ status: 'passed', finalVariables: { visited: 7 } });
  });

  it('preserves CRLF, indentation and trailing spaces when retargeting literal loop', async () => {
    const intro = source.replace('@loop a', '  @loop a  ').replaceAll('\n', '\r\n');
    const files = project(intro);
    const plan = await planFlowEdit(files, { kind: 'retarget', edge: { sceneId: 'intro', line: 6, kind: 'loop' }, to: { sceneId: 'home' } });
    expect(plan.files[0]!.after).toBe(intro.replace('@loop a', '@jump home'));
    expect(await run(proposed(files, plan))).toMatchObject({ status: 'passed', finalVariables: { visited: 7 } });
  });

  it('retains round-trip refusal for a loop whose internal spacing cannot be preserved', async () => {
    const files = project(source.replace('@loop a', '@loop    a')), before = structuredClone(files);
    await expect(planFlowEdit(files, { kind: 'retarget', edge: { sceneId: 'intro', line: 6, kind: 'loop' }, to: { sceneId: 'home' } }))
      .rejects.toThrow(/无法原样保留/);
    expect(files).toEqual(before);
  });
});
