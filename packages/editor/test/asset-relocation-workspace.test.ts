import { describe, expect, it } from 'vitest';
import {
  createAssetRelocationWorkspace,
  type AssetRelocationSource,
} from '../src/asset-relocation-workspace.js';
import type {
  AssetRelocationDetail,
  AssetRelocationFileEvidence,
} from '../src/asset-import-client.js';

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '22222222-2222-4222-8222-222222222222';
const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const UNDO_RECEIPT_ID = '44444444-4444-4444-8444-444444444444';
const SHA256 = 'a'.repeat(64);

function source(overrides: Partial<AssetRelocationSource> = {}): AssetRelocationSource {
  return {
    assetId: 'file:content/assets/background/old.png',
    sourcePath: 'content/assets/background/old.png',
    kind: 'background',
    targetDirectory: 'content/assets/background',
    fileName: 'old.png',
    ...overrides,
  };
}

function evidence(sha256 = SHA256): AssetRelocationFileEvidence {
  return {
    device: '1',
    inode: '2',
    birthtimeNs: '3',
    size: 5,
    mtimeNs: '4',
    sha256,
  };
}

function detail(
  selected: AssetRelocationSource,
  status: 'PLANNED' | 'COMMITTED' | 'UNDONE' = 'PLANNED',
  planStatus: 'ready' | 'blocked' = 'ready',
): AssetRelocationDetail {
  const targetPath = `${selected.targetDirectory}/${selected.fileName}`;
  const moveId = 'relocation-move-test';
  const move = { sourcePath: selected.sourcePath, targetPath };
  const receipt = status === 'COMMITTED' || status === 'UNDONE'
    ? {
      schemaVersion: 1 as const,
      receiptId: RECEIPT_ID,
      receiptFingerprint: 'b'.repeat(64),
      operationId: OPERATION_ID,
      planId: PLAN_ID,
      planFingerprint: 'c'.repeat(64),
      projectIdentity: 'd'.repeat(64),
      sourcePath: selected.sourcePath,
      targetPath,
      targetIdentity: evidence('e'.repeat(64)),
      moves: [{ moveId, ...move, targetIdentity: evidence('e'.repeat(64)) }],
      textFiles: [{ path: 'src/scene.gal', sha256: 'f'.repeat(64), identity: evidence('f'.repeat(64)) }],
      committedAt: '2026-09-02T00:00:00.000Z',
    }
    : null;
  return {
    request: { operationId: OPERATION_ID, sourcePath: selected.sourcePath, targetPath, moves: [move] },
    operation: {
      operationId: OPERATION_ID,
      status,
      sourcePath: selected.sourcePath,
      targetPath,
      moves: [move],
      updatedAt: '2026-09-02T00:00:00.000Z',
      manualRecoveryRequired: false,
    },
    plan: {
      schemaVersion: 1,
      operationId: OPERATION_ID,
      planId: PLAN_ID,
      planFingerprint: 'c'.repeat(64),
      status: planStatus,
      source: {
        path: selected.sourcePath,
        directory: 'content/assets/background',
        fileName: 'old.png',
        kind: 'background',
        key: 'old',
        format: 'png',
        invalidName: false,
      },
      target: {
        path: targetPath,
        directory: selected.targetDirectory,
        fileName: selected.fileName,
        kind: selected.kind,
        key: selected.fileName.replace(/\.[^.]+$/u, ''),
        format: 'png',
        invalidName: false,
      },
      moves: [{
        moveId,
        source: {
          path: selected.sourcePath,
          directory: 'content/assets/background',
          fileName: 'old.png',
          kind: 'background',
          key: 'old',
          format: 'png',
          invalidName: false,
        },
        target: {
          path: targetPath,
          directory: selected.targetDirectory,
          fileName: selected.fileName,
          kind: selected.kind,
          key: selected.fileName.replace(/\.[^.]+$/u, ''),
          format: 'png',
          invalidName: false,
        },
      }],
      affectedAssetCount: planStatus === 'ready' ? 1 : 0,
      affectedReferenceCount: planStatus === 'ready' ? 2 : 0,
      affectedFileCount: planStatus === 'ready' ? 1 : 0,
      referenceChanges: [],
      blockers: planStatus === 'blocked' ? [{
        code: 'ASSET_RELOCATION_TARGET_EXISTS' as const,
        message: '目标文件已存在',
      }] : [],
    },
    receipt,
    undoReceipt: status === 'UNDONE'
      ? {
        schemaVersion: 1,
        undoReceiptId: UNDO_RECEIPT_ID,
        undoReceiptFingerprint: '1'.repeat(64),
        operationId: OPERATION_ID,
        receiptId: RECEIPT_ID,
        sourcePath: selected.sourcePath,
        targetPath,
        sourceIdentity: evidence('2'.repeat(64)),
        moves: [{ moveId, ...move, sourceIdentity: evidence('2'.repeat(64)) }],
        restoredTextFiles: [{ path: 'src/scene.gal', sha256: SHA256, identity: evidence(SHA256) }],
        undoneAt: '2026-09-02T00:01:00.000Z',
      }
      : null,
    allowedActions: status === 'PLANNED' ? ['commit', 'cancel'] : status === 'COMMITTED' ? ['resume', 'undo'] : [],
  };
}

describe('Editor asset relocation workspace', () => {
  it('invalidates a prior plan when the selected asset target changes', () => {
    const workspace = createAssetRelocationWorkspace();
    const selected = source();
    workspace.begin(selected);
    workspace.setDetail(detail(selected, 'PLANNED', 'ready'));
    expect(workspace.snapshot().detail?.plan.status).toBe('ready');

    workspace.updateTarget({ targetDirectory: 'content/assets/background/chapters', fileName: 'renamed.png' });

    expect(workspace.snapshot()).toMatchObject({
      source: selected,
      targetDirectory: 'content/assets/background/chapters',
      fileName: 'renamed.png',
      detail: null,
    });
    workspace.dispose();
  });

  it('projects blocked and ready plans without turning a blocker into an executable result', () => {
    const workspace = createAssetRelocationWorkspace();
    const selected = source();
    workspace.begin(selected);

    workspace.setDetail(detail(selected, 'PLANNED', 'blocked'));
    expect(workspace.snapshot().detail?.plan).toMatchObject({ status: 'blocked', blockers: [{ code: 'ASSET_RELOCATION_TARGET_EXISTS' }] });

    workspace.setDetail(detail(selected, 'PLANNED', 'ready'));
    expect(workspace.snapshot().detail?.plan).toMatchObject({ status: 'ready', affectedReferenceCount: 2 });
    workspace.dispose();
  });

  it('ignores target edits while busy and accepts them again after the write lock clears', () => {
    const workspace = createAssetRelocationWorkspace();
    const selected = source();
    workspace.begin(selected);
    workspace.setDetail(detail(selected));
    workspace.setBusy(true);
    workspace.updateTarget({ fileName: 'ignored.png' });
    expect(workspace.snapshot()).toMatchObject({ fileName: 'old.png', detail: expect.any(Object), busy: true });

    workspace.setBusy(false);
    workspace.updateTarget({ fileName: 'accepted.png' });
    expect(workspace.snapshot()).toMatchObject({ fileName: 'accepted.png', detail: null, busy: false });
    workspace.dispose();
  });

  it('isolates a new selection and reset from stale details and messages', () => {
    const workspace = createAssetRelocationWorkspace();
    const first = source();
    const second = source({
      assetId: 'file:content/assets/portrait/lynn.png',
      sourcePath: 'content/assets/portrait/lynn.png',
      kind: 'portrait',
      targetDirectory: 'content/assets/portrait',
      fileName: 'lynn.png',
    });
    workspace.begin(first);
    workspace.setDetail(detail(first));
    workspace.setMessage('旧计划');

    workspace.begin(second);
    expect(workspace.snapshot()).toMatchObject({ source: second, detail: null, message: null });

    workspace.setMessage('新提示');
    workspace.reset();
    expect(workspace.snapshot()).toEqual({
      mode: 'idle',
      batchEditing: false,
      source: null,
      selection: [],
      batchKind: null,
      visibleAssetIds: [],
      targetDirectory: '',
      fileName: '',
      fileNames: {},
      plan: null,
      detail: null,
      receipt: null,
      undoReceipt: null,
      busy: false,
      message: null,
    });
    workspace.dispose();
  });

  it('rejects detail with mismatched source or operation identity without polluting the current result', () => {
    const workspace = createAssetRelocationWorkspace();
    const selected = source();
    const matching = detail(selected);
    workspace.begin(selected);
    workspace.setDetail(matching);

    workspace.setDetail(detail(source({ sourcePath: 'content/assets/background/other.png' })));
    expect(workspace.snapshot().detail?.request.sourcePath).toBe(selected.sourcePath);

    const wrongOperation = detail(selected);
    wrongOperation.operation.operationId = '55555555-5555-4555-8555-555555555555';
    workspace.setDetail(wrongOperation);
    expect(workspace.snapshot().detail?.operation.operationId).toBe(OPERATION_ID);
    workspace.dispose();
  });

  it('reads committed and undone receipt state back as independent deep projections', () => {
    const workspace = createAssetRelocationWorkspace();
    const selected = source();
    workspace.begin(selected);
    const committed = detail(selected, 'COMMITTED');
    workspace.setDetail(committed);
    expect(workspace.snapshot().detail).toMatchObject({
      operation: { status: 'COMMITTED' },
      receipt: { receiptId: RECEIPT_ID, textFiles: [{ path: 'src/scene.gal' }] },
      undoReceipt: null,
    });

    const firstProjection = workspace.snapshot();
    firstProjection.detail!.receipt!.targetIdentity.sha256 = '0'.repeat(64);
    firstProjection.detail!.receipt!.textFiles[0]!.identity.sha256 = '0'.repeat(64);
    expect(workspace.snapshot().detail!.receipt!.targetIdentity.sha256).toBe('e'.repeat(64));
    expect(workspace.snapshot().detail!.receipt!.textFiles[0]!.identity.sha256).toBe('f'.repeat(64));

    workspace.setDetail(detail(selected, 'UNDONE'));
    expect(workspace.snapshot().detail).toMatchObject({
      operation: { status: 'UNDONE' },
      receipt: { receiptId: RECEIPT_ID },
      undoReceipt: { undoReceiptId: UNDO_RECEIPT_ID, restoredTextFiles: [{ path: 'src/scene.gal' }] },
    });
    workspace.dispose();
  });
});
