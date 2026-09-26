import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileScene } from '@surdet/core';
import { beginChange, InMemoryChangeRepository } from '../src/change-session.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { buildAssetCatalog } from '../src/asset-catalog.js';
import { buildObjectIndex } from '../src/object-index.js';
import { applyScenePatch } from '../src/operations.js';
import { applyStageConfigPatch, inspectStageConfig } from '../src/stage-operations.js';
import { validateProjectStageContent } from '../src/stage-validation.js';
import { patchStageSourceLine } from '../src/stage-source-patch.js';
import { planProjectAssetRelocation, fingerprintProjectAssetRelocationInventory, fingerprintProjectAssetRelocationOpaqueScan, type ProjectAssetRelocationPlanInput } from '../src/asset-relocation.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const hasher = { sha256: async (text: string) => hash(text) };
const original = '@scene start\n@show rin:coat normal @x=320 @custom="keep @sign"\n正文。\n@end\n';
async function fixture(config: Record<string, unknown> = {}, source = original, timelines: Record<string, string> = {}) {
  const files = { 'game.config.json': JSON.stringify({ entryScene: 'start', variables: {}, characters: { rin: { name: '凛' } }, ...config }),
    'content/scenario/start.gal': source, ...timelines };
  const storage = { rootIdentity: 'stage-fixture', listFiles: async () => Object.keys(files), exists: async (path: string) => path in files,
    readText: async (path: string) => { const text = files[path as keyof typeof files]!; return { path, text, bytes: Buffer.byteLength(text), sha256: hash(text) }; } };
  const snapshot = await loadProjectSnapshot(storage, hasher);
  const change = await beginChange(snapshot, new InMemoryChangeRepository());
  change.record.composition = { ...change.record.composition!, mode: 'direct' };
  return { snapshot, change, files };
}

describe('stage source, config, references and validation share authoring facts', () => {
  it('edits only selected modifiers and preserves unknown fields, quote contents, whitespace and CRLF', () => {
    const raw = '  @show rin:coat normal @x=320 @custom="keep @sign"  ';
    const text = '@scene start\r\n' + raw + '\r\n正文。\r\n@end\r\n';
    const instruction = compileScene(text, 'start.gal', 'start').instructions.find(value => value.op === 'instr' && value.name === 'show')!;
    const result = patchStageSourceLine(text, 'start.gal', 'start', 2, raw, instruction.index, { x: 512, scale: 1.25 });
    expect(result).toBe('  @show rin:coat normal @x=512 @custom="keep @sign" @scale=1.25  ');
    expect(() => patchStageSourceLine(text, 'start.gal', 'start', 2, raw, instruction.index, { scale: -1 })).toThrow();
  });
  it('locates the second pose after a quoted choice arrow without editing the first pose or voice', () => {
    const raw = '  走向码头 [if:" -> " == " -> "] -> @pose rin:coat x=100 @voice quiet @pose rin:coat y=600 @goto done';
    const text = '@scene start\n@choice\n' + raw + '\n@label done\n正文。\n@end\n';
    const poses = compileScene(text, 'start.gal', 'start').instructions.filter(value => value.op === 'instr' && value.name === 'pose');
    expect(poses).toHaveLength(2);
    expect(patchStageSourceLine(text, 'start.gal', 'start', 3, raw, poses[1]!.index, { y: 680 }))
      .toBe(raw.replace('@pose rin:coat y=600', '@pose rin:coat y=680'));
  });
  it('applies the exact shared scene.patch and rejects a stale retry without changing any other line', async () => {
    const f = await fixture();
    const object = buildObjectIndex(f.snapshot).objects.find(value => value.kind === 'instruction' && value.source?.line === 2)!;
    const instruction = f.snapshot.scenes[0]!.compiled.instructions.find(value => value.op === 'instr' && value.name === 'show')!;
    const request = { operationId: 'stage-edit', sceneId: 'start', patch: { kind: 'patchStageProperties' as const,
      target: object.objectRef, expectedFingerprint: object.fingerprint!, instructionIndex: instruction.index, values: { x: 700 } } };
    await applyScenePatch(f.change, request, hasher);
    expect(f.change.record.workingFiles['content/scenario/start.gal']).toBe(original.replace('@x=320', '@x=700'));
    const result = structuredClone(f.change.record);
    await applyScenePatch(f.change, request, hasher); expect(f.change.record).toEqual(result);
    await expect(applyScenePatch(f.change, { ...request, operationId: 'stale-edit' }, hasher)).rejects.toMatchObject({ code: 'OBJECT_PRECONDITION_FAILED' });
    expect(f.change.record).toEqual(result);
  });
  it('publishes stage config current/effective values and refuses candidate configuration mutation before persistence', async () => {
    const f = await fixture(); const before = await inspectStageConfig(f.snapshot.config, hasher);
    expect(before.value).toBeNull(); expect(before.effective).toBeNull();
    const request = { operationId: 'config-stage', expectedFingerprint: before.fingerprint, patch: { version: 1, positions: { pier: { x: 500, y: 690 } } } };
    f.change.record.composition!.mode = 'candidate'; const untouched = structuredClone(f.change.record);
    await expect(applyStageConfigPatch(f.change, request, hasher, buildAssetCatalog([], f.snapshot))).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
    expect(f.change.record).toEqual(untouched);
    f.change.record.composition!.mode = 'direct';
    const result = await applyStageConfigPatch(f.change, request, hasher, buildAssetCatalog([], f.snapshot));
    expect(result.stageConfig.effective?.positions.pier).toEqual({ x: 500, y: 690 });
    expect(JSON.parse(f.change.record.workingFiles['game.config.json']!).characters).toEqual({ rin: { name: '凛' } });
  });
  it('rejects stale image bytes even when the logical source path and dimensions remain identical', async () => {
    const path = 'content/assets/portrait/rin_coat_normal.png';
    const f = await fixture({ stage: { version: 1, portraits: { 'rin:coat': { sources: { normal: { path, sha256: 'a'.repeat(64), width: 400, height: 700 } },
      expressions: { normal: { x: 0, y: 0, width: 400, height: 700 } } } } } });
    const catalog = buildAssetCatalog([{ path, bytes: 400, sha256: 'b'.repeat(64) }], f.snapshot);
    expect(validateProjectStageContent(f.snapshot, catalog).some(value => value.code === 'STAGE_CALIBRATION_STALE')).toBe(true);
  });
  it('collects and atomically rewrites composition, scene/choice layer, and timeline layer references', async () => {
    const src = '@scene start\n@layer sky dock\n@choice\n  保留台词 [if:" -> " == " -> "] -> @layer far dock @goto done\n@label done\n正文。\n@end\n';
    const timeline = JSON.stringify({ version: 2, id: 'intro', durationMs: 0, tracks: [{ kind: 'layer', target: 'far', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'show', key: 'dock' }] }] });
    const f = await fixture({ stage: { version: 1, compositions: { dock: { background: 'dock', layers: [{ id: 'dock', key: 'dock' }] } } } }, src, { 'content/timelines/intro.json': timeline });
    const assets = [{ path: 'content/assets/bg/dock.png', bytes: 50, sha256: 'a'.repeat(64) }];
    const planned = await planFixture({ operationId: 'stage-move', project: f.snapshot, assetFiles: assets,
      sourcePath: assets[0]!.path, targetPath: 'content/assets/bg/night.png', assetDirectories: ['content/assets/bg'] }, hasher);
    expect(planned.plan.status, JSON.stringify(planned.plan.blockers)).toBe('ready');
    const changed = Object.fromEntries(planned.textChanges.map(value => [value.path, value.afterText]));
    expect(changed['content/scenario/start.gal']).toBe(src.replaceAll(' dock', ' night'));
    const config = JSON.parse(changed['game.config.json']!);
    expect(config.stage.compositions.dock).toMatchObject({ background: 'night', layers: [{ id: 'dock', key: 'night' }] });
    expect(JSON.parse(changed['content/timelines/intro.json']!).tracks[0].cues[0].key).toBe('night');
  });
  it('moves a calibrated portrait path while preserving its binding, rectangle, digest and unrelated values', async () => {
    const sourcePath = 'content/assets/portrait/rin_coat_normal.png', targetPath = 'content/assets/portrait/sub/rin_coat_normal.png';
    const pin = { path: sourcePath, sha256: 'a'.repeat(64), width: 400, height: 700 };
    const f = await fixture({ stage: { version: 1, portraits: { 'rin:coat': { sources: { normal: pin }, expressions: { normal: { x: 10, y: 20, width: 200, height: 500 } } } } } });
    const plan = await planFixture({ operationId: 'calibration-move', project: f.snapshot,
      assetFiles: [{ path: sourcePath, bytes: 400, sha256: pin.sha256 }], sourcePath, targetPath,
      assetDirectories: ['content/assets/portrait', 'content/assets/portrait/sub'] }, hasher);
    expect(plan.plan.status, JSON.stringify(plan.plan.blockers)).toBe('ready');
    const after = JSON.parse(plan.textChanges.find(value => value.path === 'game.config.json')!.afterText);
    expect(after.stage.portraits['rin:coat'].sources.normal).toEqual({ ...pin, path: targetPath });
    expect(after.stage.portraits['rin:coat'].expressions.normal).toEqual({ x: 10, y: 20, width: 200, height: 500 });
  });
});

async function planFixture(value: { operationId: string; project: Awaited<ReturnType<typeof fixture>>['snapshot']; assetFiles: { path: string; bytes: number; sha256: string }[]; sourcePath: string; targetPath: string; assetDirectories: string[] }, _hasher: typeof hasher) {
  const roots = (['src', 'scripts', 'test', 'tests'] as const).map(root => ({ root, state: 'missing' as const, filePaths: [] }));
  const input: ProjectAssetRelocationPlanInput = { operationId: value.operationId, snapshot: value.project, sourcePath: value.sourcePath, targetPath: value.targetPath,
    assetFiles: value.assetFiles, assetDirectories: value.assetDirectories, galleryFile: null, opaqueFiles: [], scanCoverage: { gallery: 'absent', opaqueRoots: roots,
      opaqueInventoryFingerprint: await fingerprintProjectAssetRelocationOpaqueScan(roots, [], hasher) },
    binaryBaseline: { source: { path: value.sourcePath, device: '1', inode: '2', birthtimeNs: '3', size: value.assetFiles[0]!.bytes, mtimeNs: '4', sha256: value.assetFiles[0]!.sha256 },
      target: { path: value.targetPath, state: 'absent' }, targetDirectory: { path: value.targetPath.slice(0, value.targetPath.lastIndexOf('/')), device: '1', inode: '5', birthtimeNs: '6', mtimeNs: '7' },
      assetInventoryFingerprint: await fingerprintProjectAssetRelocationInventory(value.assetFiles, hasher) } };
  return planProjectAssetRelocation(input, hasher);
}


it('relocates explicit timeline portrait resources without renaming their display instance', async () => {
  const sourcePath = 'content/assets/portrait/rin_coat_normal.png', targetPath = 'content/assets/portrait/new_coat_smile.png';
  const definition = { version: 2, id: 'shot', durationMs: 1, tracks: [{ kind: 'portrait', target: 'left-actor', cues: [
    { action: 'show', atMs: 0, durationMs: 0, easing: 'linear', source: 'rin:coat', expression: 'normal', x: 200 },
    { action: 'pose', atMs: 0, durationMs: 1, easing: 'linear', x: 500 },
  ] }] };
  const f = await fixture({}, '@scene start\n正文。\n@end\n', { 'content/timelines/shot.json': JSON.stringify(definition) });
  const planned = await planFixture({ operationId: 'explicit-source', project: f.snapshot, assetFiles: [{ path: sourcePath, bytes: 1, sha256: 'a'.repeat(64) }],
    sourcePath, targetPath, assetDirectories: ['content/assets/portrait'] }, hasher);
  expect(planned.plan.status, JSON.stringify(planned.plan.blockers)).toBe('ready');
  const changed = JSON.parse(planned.textChanges.find(file => file.path.endsWith('/shot.json'))!.afterText);
  expect(changed.tracks[0].target).toBe('left-actor');
  expect(changed.tracks[0].cues[0]).toMatchObject({ source: 'new:coat', expression: 'smile', x: 200 });
  expect(changed.tracks[0].cues[1]).toEqual(definition.tracks[0]!.cues[1]);
});
