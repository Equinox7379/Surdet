import { describe, expect, it } from 'vitest';
import { buildProjectAssetImportPlan, destinationDirectoryForAssetKind } from '../src/asset-import.js';
import type {
  BuildProjectAssetImportPlanInput,
  ProjectAssetImportStagedItem,
  ProjectAssetImportTargetFact,
  ProjectAssetImportTargetRequest,
} from '../src/asset-import.js';
import type { ProjectAssetKind, TextHasher } from '../src/contracts.js';

const hasher: TextHasher = {
  sha256: async (text) => {
    let hash = 0x811c9dc5;
    for (const codePoint of text) {
      hash ^= codePoint.codePointAt(0)!;
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  },
};

const PROJECT = 'project-import-test';
const OPERATION = 'op-import-test';
const MANIFEST = 'manifest-import-test';

const kinds: readonly ProjectAssetKind[] = [
  'background',
  'portrait',
  'avatar',
  'music',
  'ambience',
  'sound-effect',
  'voice',
  'video',
  'font',
  'other',
];

const fileNames: Record<ProjectAssetKind, string> = {
  background: '城门-夜景.PNG',
  portrait: '凛_冬装_微笑.webp',
  avatar: '头像-凛.png',
  music: '序章主题.OGG',
  ambience: '雨声.WAV',
  'sound-effect': '脚步.MP3',
  voice: '凛的台词.M4A',
  video: '片头.webm',
  font: '霞鹜文楷.woff2',
  other: '界面图.svg',
};

function staged(itemId: string, sourceName = `${itemId}.bin`): ProjectAssetImportStagedItem {
  return {
    operationId: OPERATION,
    itemId,
    sourceName,
    bytes: itemId.length * 10,
    sha256: `sha-${itemId}`,
    stagedItemFingerprint: `stage-${itemId}`,
  };
}

function target(itemId: string, kind: ProjectAssetKind, fileName: string): ProjectAssetImportTargetRequest {
  return { itemId, kind, fileName };
}

function targetPath(kind: ProjectAssetKind, fileName: string): string {
  return `content/assets/${destinationDirectoryForAssetKind(kind)}/${fileName.normalize('NFC')}`;
}

function absentFacts(targets: readonly ProjectAssetImportTargetRequest[]): ProjectAssetImportTargetFact[] {
  return targets.map((entry) => ({ path: targetPath(entry.kind, entry.fileName), state: 'absent' }));
}

function inputFor(
  stagedItems: ProjectAssetImportStagedItem[],
  targets: ProjectAssetImportTargetRequest[],
  facts: ProjectAssetImportTargetFact[] = absentFacts(targets),
): BuildProjectAssetImportPlanInput {
  return { projectIdentity: PROJECT, manifestFingerprint: MANIFEST, stagedItems, targets, targetFacts: facts };
}

describe('project asset import planner', () => {
  it('maps every asset kind to its canonical directory and normalizes NFC names', async () => {
    const targets = kinds.map((kind, index) => target(`item-${index}`, kind, fileNames[kind]));
    const result = await buildProjectAssetImportPlan(
      inputFor(targets.map((entry) => staged(entry.itemId)), targets),
      hasher,
    );

    expect(result.status).toBe('ready');
    expect(result.schemaVersion).toBe(1);
    expect(result.manifestFingerprint).toBe(MANIFEST);
    expect(result.issues).toEqual([]);
    expect(result.items).toHaveLength(kinds.length);
    expect(result.totalBytes).toBeGreaterThan(0);
    for (const kind of kinds) {
      const item = result.items.find((entry) => entry.kind === kind);
      expect(item).toBeDefined();
      expect(item!.targetPath).toBe(targetPath(kind, fileNames[kind]));
      expect(item!.issues).toEqual([]);
    }

    const decomposed = 'e\u0301toile.png';
    const normalized = await buildProjectAssetImportPlan(
      inputFor([staged('nfc', '源文件.png')], [target('nfc', 'background', decomposed)]),
      hasher,
    );
    expect(normalized.items[0]!.fileName).toBe(decomposed.normalize('NFC'));
    expect(normalized.items[0]!.targetPath).toContain('étoile.png');
  });

  it('returns deterministic ordering and a stable plan identity independent of input order', async () => {
    const targets = [
      target('z-item', 'background', '同名-Z.png'),
      target('a-item', 'music', '同名-A.mp3'),
      target('m-item', 'font', '字体.woff2'),
    ];
    const stagedItems = targets.map((entry) => staged(entry.itemId));
    const first = await buildProjectAssetImportPlan(inputFor(stagedItems, targets), hasher);
    const second = await buildProjectAssetImportPlan(
      inputFor([...stagedItems].reverse(), [...targets].reverse()),
      hasher,
    );

    expect(second.items).toEqual(first.items);
    expect(second.issues).toEqual(first.issues);
    expect(second.totalBytes).toBe(first.totalBytes);
    expect(second.planFingerprint).toBe(first.planFingerprint);
    expect(second.planId).toBe(`pln_${first.planFingerprint.slice(0, 32)}`);
  });

  it('blocks unsafe names, unsupported formats, and invalid portrait names without inventing a replacement', async () => {
    const targets = [
      target('reserved', 'background', 'CON.png'),
      target('superscript', 'background', 'LPT¹.png'),
      target('separator', 'background', 'nested/escape.png'),
      target('trailing', 'background', 'trailing. '),
      target('unsupported', 'music', 'cover.png'),
      target('portrait', 'portrait', '凛_冬装.png'),
    ];
    const result = await buildProjectAssetImportPlan(inputFor(targets.map((entry) => staged(entry.itemId)), targets, []), hasher);

    expect(result.status).toBe('blocked');
    expect(result.items.find((entry) => entry.itemId === 'reserved')!.issues).toContain('IMPORT_NAME_INVALID');
    expect(result.items.find((entry) => entry.itemId === 'superscript')!.issues).toContain('IMPORT_NAME_INVALID');
    expect(result.items.find((entry) => entry.itemId === 'separator')!.issues).toContain('IMPORT_NAME_INVALID');
    expect(result.items.find((entry) => entry.itemId === 'trailing')!.issues).toContain('IMPORT_NAME_INVALID');
    expect(result.items.find((entry) => entry.itemId === 'unsupported')!.issues).toContain('IMPORT_FORMAT_UNSUPPORTED');
    expect(result.items.find((entry) => entry.itemId === 'portrait')!.issues).toContain('IMPORT_PORTRAIT_NAME_INVALID');
    expect(result.items.every((entry) => !entry.fileName.includes('(1)'))).toBe(true);
  });

  it('blocks case-fold collisions in the batch and against existing or ambiguous target facts', async () => {
    const duplicateTargets = [
      target('first', 'background', 'Castle.png'),
      target('second', 'background', 'castle.PNG'),
      target('third', 'background', '另一个.png'),
    ];
    const facts: ProjectAssetImportTargetFact[] = [
      { path: 'content/assets/bg/另一个.png', state: 'exists-file' },
      { path: 'content/assets/bg/另一个.PNG', state: 'exists-directory' },
      { path: 'content/assets/bg/unused.png', state: 'absent' },
    ];
    const result = await buildProjectAssetImportPlan(
      inputFor(duplicateTargets.map((entry) => staged(entry.itemId)), duplicateTargets, facts),
      hasher,
    );

    expect(result.status).toBe('blocked');
    expect(result.items.find((entry) => entry.itemId === 'first')!.issues).toContain('IMPORT_TARGET_DUPLICATE_IN_BATCH');
    expect(result.items.find((entry) => entry.itemId === 'second')!.issues).toContain('IMPORT_TARGET_DUPLICATE_IN_BATCH');
    expect(result.items.find((entry) => entry.itemId === 'third')!.issues).toContain('IMPORT_TARGET_EXISTS');
    expect(result.items.find((entry) => entry.itemId === 'third')!.issues).toContain('IMPORT_TARGET_UNSAFE');
    expect(result.issues).toEqual(expect.arrayContaining([
      'IMPORT_TARGET_DUPLICATE_IN_BATCH',
      'IMPORT_TARGET_EXISTS',
      'IMPORT_TARGET_UNSAFE',
    ]));
  });

  it('requires one and only one target for every staged item', async () => {
    await expect(buildProjectAssetImportPlan(
      inputFor(
        [staged('first'), staged('second')],
        [target('first', 'background', 'first.png')],
      ),
      hasher,
    )).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
