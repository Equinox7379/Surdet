import { describe, expect, it } from 'vitest';
import {
  createAssetRelocationWorkspace,
  type AssetRelocationSource,
} from '../src/asset-relocation-workspace.js';

type BatchAssetKind = AssetRelocationSource['kind'];

interface BatchRelocationMove {
  moveId: string;
  assetId: string;
  sourcePath: string;
  targetPath: string;
}

interface BatchRelocationPlan {
  operationId: string;
  status: 'ready' | 'blocked';
  moves: BatchRelocationMove[];
  affectedAssetCount: number;
  affectedReferenceCount: number;
  affectedFileCount: number;
  blockers: string[];
}

interface BatchRelocationReceipt {
  receiptId: string;
  operationId: string;
  moves: BatchRelocationMove[];
}

interface BatchRelocationUndoReceipt {
  undoReceiptId: string;
  operationId: string;
  receiptId: string;
  moves: BatchRelocationMove[];
}

interface BatchRelocationDetail {
  operation: {
    operationId: string;
    status: 'PLANNED' | 'COMMITTED' | 'UNDONE' | 'ROLLED_BACK' | 'CANCELLED';
  };
  plan: BatchRelocationPlan | null;
  receipt: BatchRelocationReceipt | null;
  undoReceipt: BatchRelocationUndoReceipt | null;
}

interface BatchWorkspaceProjection {
  mode: 'idle' | 'single' | 'batch';
  batchEditing: boolean;
  selection: AssetRelocationSource[];
  batchKind: BatchAssetKind | null;
  visibleAssetIds: string[];
  targetDirectory: string;
  fileNames: Record<string, string>;
  plan: BatchRelocationPlan | null;
  detail: BatchRelocationDetail | null;
  receipt: BatchRelocationReceipt | null;
  undoReceipt: BatchRelocationUndoReceipt | null;
  busy: boolean;
  message: string | null;
}

/**
 * Task 6 permanent RED contract. The cast keeps this test runnable before the
 * production workspace grows the batch surface; production code remains
 * untouched until these invariants are implemented.
 */
interface BatchRelocationWorkspace {
  snapshot(): BatchWorkspaceProjection;
  beginBatch(): void;
  openBatchEditor(): void;
  select(source: AssetRelocationSource): void;
  setVisibleAssetIds(assetIds: readonly string[]): void;
  updateBatchTarget(update: { targetDirectory?: string; assetId?: string; fileName?: string }): void;
  setBatchPlan(plan: BatchRelocationPlan | null): void;
  setBatchDetail(detail: BatchRelocationDetail | null): void;
  reset(): void;
  dispose(): void;
}

const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const RECEIPT_ID = '22222222-2222-4222-8222-222222222222';
const UNDO_RECEIPT_ID = '33333333-3333-4333-8333-333333333333';

const BACKGROUND_A: AssetRelocationSource = {
  assetId: 'file:content/assets/background/harbor-a.png',
  sourcePath: 'content/assets/background/harbor-a.png',
  kind: 'background',
  targetDirectory: 'content/assets/background/archive',
  fileName: 'harbor-a.png',
};

const BACKGROUND_B: AssetRelocationSource = {
  assetId: 'file:content/assets/background/harbor-b.png',
  sourcePath: 'content/assets/background/harbor-b.png',
  kind: 'background',
  targetDirectory: 'content/assets/background/archive',
  fileName: 'harbor-b.png',
};

const PORTRAIT_A: AssetRelocationSource = {
  assetId: 'file:content/assets/portrait/lynn.png',
  sourcePath: 'content/assets/portrait/lynn.png',
  kind: 'portrait',
  targetDirectory: 'content/assets/portrait/archive',
  fileName: 'lynn.png',
};

function createBatchWorkspace(): BatchRelocationWorkspace {
  return createAssetRelocationWorkspace() as unknown as BatchRelocationWorkspace;
}

function move(source: AssetRelocationSource, fileName = source.fileName): BatchRelocationMove {
  return {
    moveId: `move:${source.assetId}`,
    assetId: source.assetId,
    sourcePath: source.sourcePath,
    targetPath: `${source.targetDirectory}/${fileName}`,
  };
}

function readyPlan(): BatchRelocationPlan {
  return {
    operationId: OPERATION_ID,
    status: 'ready',
    moves: [move(BACKGROUND_A), move(BACKGROUND_B)],
    affectedAssetCount: 2,
    affectedReferenceCount: 4,
    affectedFileCount: 2,
    blockers: [],
  };
}

function committedDetail(
  status: BatchRelocationDetail['operation']['status'],
  plan = readyPlan(),
): BatchRelocationDetail {
  const receipt: BatchRelocationReceipt = {
    receiptId: RECEIPT_ID,
    operationId: OPERATION_ID,
    moves: plan.moves.map((item) => ({ ...item })),
  };
  return {
    operation: { operationId: OPERATION_ID, status },
    plan,
    receipt: status === 'COMMITTED' || status === 'UNDONE' ? receipt : null,
    undoReceipt: status === 'UNDONE'
      ? {
        undoReceiptId: UNDO_RECEIPT_ID,
        operationId: OPERATION_ID,
        receiptId: RECEIPT_ID,
        moves: plan.moves.map((item) => ({ ...item })),
      }
      : null,
  };
}

describe('Editor batch asset relocation workspace', () => {
  it('deduplicates selected assets by stable asset identity', () => {
    const workspace = createBatchWorkspace();
    workspace.beginBatch();
    workspace.select(BACKGROUND_A);
    workspace.select(BACKGROUND_A);
    workspace.select(BACKGROUND_B);
    workspace.openBatchEditor();

    expect(workspace.snapshot().selection.map((item) => item.assetId)).toEqual([
      BACKGROUND_A.assetId,
      BACKGROUND_B.assetId,
    ]);
    workspace.dispose();
  });

  it('locks the batch category to the first selected asset', () => {
    const workspace = createBatchWorkspace();
    workspace.beginBatch();
    workspace.select(BACKGROUND_A);
    workspace.select(PORTRAIT_A);

    expect(workspace.snapshot()).toMatchObject({
      batchKind: 'background',
      selection: [BACKGROUND_A],
    });
    workspace.dispose();
  });

  it('keeps selection when visible assets change across filters', () => {
    const workspace = createBatchWorkspace();
    workspace.beginBatch();
    workspace.select(BACKGROUND_A);
    workspace.select(BACKGROUND_B);

    workspace.setVisibleAssetIds([BACKGROUND_A.assetId]);
    workspace.setVisibleAssetIds([BACKGROUND_B.assetId]);

    expect(workspace.snapshot().selection.map((item) => item.assetId).sort()).toEqual([
      BACKGROUND_A.assetId,
      BACKGROUND_B.assetId,
    ].sort());
    expect(workspace.snapshot().visibleAssetIds).toEqual([BACKGROUND_B.assetId]);
    workspace.dispose();
  });

  it('invalidates the whole batch plan when a shared or per-item target changes', () => {
    const workspace = createBatchWorkspace();
    workspace.beginBatch();
    workspace.select(BACKGROUND_A);
    workspace.select(BACKGROUND_B);
    workspace.setBatchPlan(readyPlan());
    expect(workspace.snapshot().plan?.status).toBe('ready');

    workspace.updateBatchTarget({ targetDirectory: 'content/assets/background/chapter-01' });
    expect(workspace.snapshot().plan).toBeNull();

    workspace.setBatchPlan(readyPlan());
    workspace.updateBatchTarget({ assetId: BACKGROUND_B.assetId, fileName: 'harbor-renamed.png' });
    expect(workspace.snapshot().plan).toBeNull();
    workspace.dispose();
  });

  it('clears selection, targets, plans and receipts on project reset and batch exit', () => {
    const workspace = createBatchWorkspace();
    workspace.beginBatch();
    workspace.select(BACKGROUND_A);
    workspace.setBatchPlan(readyPlan());
    workspace.setBatchDetail(committedDetail('COMMITTED'));
    workspace.reset();

    expect(workspace.snapshot()).toMatchObject({
      mode: 'idle',
      batchEditing: false,
      selection: [],
      batchKind: null,
      targetDirectory: '',
      fileNames: {},
      plan: null,
      detail: null,
      receipt: null,
      undoReceipt: null,
      busy: false,
      message: null,
    });

    workspace.beginBatch();
    workspace.select(BACKGROUND_B);
    workspace.reset();
    expect(workspace.snapshot().selection).toEqual([]);
    workspace.dispose();
  });

  it('projects one batch receipt and one batch undo receipt for the whole operation', () => {
    const workspace = createBatchWorkspace();
    workspace.beginBatch();
    workspace.select(BACKGROUND_A);
    workspace.select(BACKGROUND_B);
    const plan = readyPlan();

    workspace.setBatchDetail(committedDetail('COMMITTED', plan));
    expect(workspace.snapshot()).toMatchObject({
      detail: { operation: { operationId: OPERATION_ID, status: 'COMMITTED' } },
      receipt: { receiptId: RECEIPT_ID, operationId: OPERATION_ID, moves: [{ assetId: BACKGROUND_A.assetId }, { assetId: BACKGROUND_B.assetId }] },
      undoReceipt: null,
    });

    workspace.setBatchDetail(committedDetail('UNDONE', plan));
    expect(workspace.snapshot()).toMatchObject({
      detail: { operation: { operationId: OPERATION_ID, status: 'UNDONE' } },
      receipt: { receiptId: RECEIPT_ID, moves: [{ assetId: BACKGROUND_A.assetId }, { assetId: BACKGROUND_B.assetId }] },
      undoReceipt: { undoReceiptId: UNDO_RECEIPT_ID, receiptId: RECEIPT_ID, operationId: OPERATION_ID },
    });
    workspace.dispose();
  });
});
