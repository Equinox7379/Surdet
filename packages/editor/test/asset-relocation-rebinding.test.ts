import { readFileSync } from 'node:fs';
import { transpileModule, ScriptTarget } from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { PROJECT_ASSET_RELOCATION_KINDS } from '@surdet/authoring';
import type { AssetRelocationDetail } from '../src/asset-import-client.js';
import { createAssetRelocationWorkspace } from '../src/asset-relocation-workspace.js';

// Execute the actual binding assembly without importing main's application shell.
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const start = main.indexOf('    const pendingRelocation = binding.pendingRelocations[0];');
const end = main.indexOf('\n  } catch (error) {', start);
if (start < 0 || end < 0) throw new Error('Pending relocation binding assembly not found');
const assembly = transpileModule(main.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
const rebind = new Function('binding', 'assetRelocationWorkspace', 'client', 'generation', 'assetImportGeneration', 'assetImportClient', 'state', 'root', 'PROJECT_ASSET_RELOCATION_KINDS', 'refreshProjectBarProjection', `return (async () => {${assembly}})();`);

function pendingDetail(kind: string, count: number, inPlace = false): AssetRelocationDetail {
  const moves = Array.from({ length: count }, (_, index) => {
    const source = { kind, path: `content/assets/${kind}/old-${index}.dat`, directory: `content/assets/${kind}`, fileName: `old-${index}.dat`, key: `old-${index}`, format: 'dat', invalidName: false };
    const target = inPlace ? { ...source } : { ...source, directory: `content/assets/${kind}/sorted`, path: `content/assets/${kind}/sorted/new-${index}.dat`, fileName: `new-${index}.dat`, key: `new-${index}` };
    return { moveId: `move-${index}`, source, target };
  });
  return {
    operation: { operationId: 'pending', status: 'RECOVERY_REQUIRED' },
    request: { operationId: 'pending', sourcePath: moves[0]!.source.path, targetPath: moves[0]!.target.path, moves: moves.map(move => ({ sourcePath: move.source.path, targetPath: move.target.path })) },
    plan: { source: moves[0]!.source, target: moves[0]!.target, moves },
    receipt: null, undoReceipt: null, allowedActions: ['resume', 'recover'],
  } as unknown as AssetRelocationDetail;
}

function harness(detail: AssetRelocationDetail) {
  const workspace = createAssetRelocationWorkspace();
  const root = {};
  const state = { dirHandle: root, projectWriteLock: null as string | null };
  const client = { relocationQuery: vi.fn(async () => detail) };
  const refresh = vi.fn();
  const run = (pending = true, currentGeneration = 1) => rebind({ pendingRelocations: pending ? [detail.operation] : [] }, workspace, client, 1, currentGeneration, client, state, root, PROJECT_ASSET_RELOCATION_KINDS, refresh) as Promise<void>;
  return { workspace, state, client, refresh, run };
}

describe('A017 pending relocation rebind assembly', () => {
  it.each(PROJECT_ASSET_RELOCATION_KINDS)('restores the single %s source, target, detail and recovery controls', async kind => {
    const detail = pendingDetail(kind, 1);
    const h = harness(detail); await h.run();
    expect(h.workspace.snapshot()).toMatchObject({ mode: 'single', source: { kind, sourcePath: detail.plan.source!.path }, targetDirectory: detail.plan.target!.directory, fileName: detail.plan.target!.fileName, detail, message: expect.any(String) });
    expect(h.workspace.snapshot().detail!.allowedActions).toEqual(['resume', 'recover']);
    expect(h.state.projectWriteLock).toBe('asset-relocation'); expect(h.refresh).toHaveBeenCalledOnce();
  });

  it.each(PROJECT_ASSET_RELOCATION_KINDS)('restores every same-kind %s batch move and the recovery detail', async kind => {
    const detail = pendingDetail(kind, 2);
    const h = harness(detail); await h.run();
    const projection = h.workspace.snapshot();
    expect(projection).toMatchObject({ mode: 'batch', batchEditing: true, batchKind: kind, detail });
    expect(projection.selection).toEqual(detail.plan.moves.map(move => ({ assetId: `file:${move.source.path}`, sourcePath: move.source.path, kind, targetDirectory: move.target.directory, fileName: move.target.fileName })));
    expect(h.state.projectWriteLock).toBe('asset-relocation'); expect(h.refresh).toHaveBeenCalledOnce();
  });

  it('preserves an in-place target and leaves an existing workspace or stale binding untouched', async () => {
    const detail = pendingDetail('music', 1, true);
    const h = harness(detail); await h.run();
    expect(h.workspace.snapshot().targetDirectory).toBe(detail.plan.source!.directory);
    expect(h.workspace.snapshot().fileName).toBe(detail.plan.source!.fileName);
    await h.run(); expect(h.client.relocationQuery).toHaveBeenCalledOnce();
    const stale = harness(detail); await stale.run(true, 2);
    expect(stale.workspace.snapshot().mode).toBe('idle'); expect(stale.state.projectWriteLock).toBeNull();
    const empty = harness(detail); await empty.run(false);
    expect(empty.client.relocationQuery).not.toHaveBeenCalled();
  });
});
