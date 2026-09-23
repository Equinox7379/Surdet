import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  fingerprintProjectAssetRelocationInventory,
  fingerprintProjectAssetRelocationOpaqueScan,
  planProjectAssetRelocationBatch,
  planProjectAssetRelocation,
  type ProjectAssetRelocationBatchPlanInput,
  type ProjectAssetRelocationPlanInput,
  type ProjectAssetRelocationOpaqueRootScan,
} from '../src/asset-relocation.js';
import type { ProjectAssetFileFact, ProjectFile, ProjectStorage, TextHasher } from '../src/contracts.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';

const hasher: TextHasher = {
  sha256: async (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
};

it('素材改名更新选择项内的实际指令，保留选项、引号内 @ 与行尾', async () => {
  const input = await makeInput({
    files: {
      'game.config.json': JSON.stringify({ entryScene: 'start' }),
      'content/scenario/start.gal': '@scene start\r\n@choice\r\n  night 选项 -> @bg night  @custom "mail@night" @goto end\r\n@label end\r\n@end\r\n',
    },
    assets: [{ path: 'content/assets/bg/night.png', bytes: 1 }],
    sourcePath: 'content/assets/bg/night.png', targetPath: 'content/assets/bg/dawn.png',
  });
  const plan = await planProjectAssetRelocation(input, hasher);
  expect(plan.plan.blockers).toEqual([]);
  expect(plan.textChanges).toEqual(expect.arrayContaining([expect.objectContaining({
    path: 'content/scenario/start.gal',
    afterText: '@scene start\r\n@choice\r\n  night 选项 -> @bg dawn  @custom "mail@night" @goto end\r\n@label end\r\n@end\r\n',
  })]));
});

function projectFile(path: string, text: string): ProjectFile {
  return {
    path,
    text,
    bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

function storageFor(contents: Record<string, string>): ProjectStorage {
  return {
    rootIdentity: 'asset-relocation-fixture',
    listFiles: async () => Object.keys(contents),
    readText: async (path) => {
      const text = contents[path];
      if (text === undefined) throw new Error(`missing fixture ${path}`);
      return projectFile(path, text);
    },
    exists: async (path) => path in contents,
  };
}

async function makeInput(options: {
  files: Record<string, string>;
  assets: ProjectAssetFileFact[];
  sourcePath: string;
  targetPath: string;
  galleryText?: string;
  opaqueFiles?: Record<string, string>;
  assetDirectories?: string[];
}): Promise<ProjectAssetRelocationPlanInput> {
  const snapshot = await loadProjectSnapshot(storageFor(options.files), hasher);
  const sourceBytes = options.assets.find((asset) => asset.path === options.sourcePath)?.bytes ?? 1;
  const assetFiles = options.assets.map((asset) => asset.path === options.sourcePath
    ? { ...asset, sha256: 'a'.repeat(64) }
    : asset);
  const opaqueFiles = Object.entries(options.opaqueFiles ?? {}).map(([path, text]) => projectFile(path, text));
  const opaqueRoots: ProjectAssetRelocationOpaqueRootScan[] = (['src', 'scripts', 'test', 'tests'] as const)
    .map((root) => ({
      root,
      state: 'scanned',
      filePaths: opaqueFiles.filter((file) => file.path.startsWith(`${root}/`)).map((file) => file.path),
    }));
  return {
    operationId: '11111111-1111-4111-8111-111111111111',
    snapshot,
    assetFiles,
    assetDirectories: options.assetDirectories ?? [
      'content/assets/bg',
      'content/assets/bg/chapter-one',
      'content/assets/portrait',
      'content/assets/portrait/cast',
      'content/assets/avatar',
      'content/assets/avatar/cast',
    ],
    sourcePath: options.sourcePath,
    targetPath: options.targetPath,
    galleryFile: options.galleryText === undefined
      ? null
      : projectFile('content/config/gallery.json', options.galleryText),
    opaqueFiles,
    scanCoverage: {
      gallery: options.galleryText === undefined ? 'absent' : 'included',
      opaqueRoots,
      opaqueInventoryFingerprint: await fingerprintProjectAssetRelocationOpaqueScan(opaqueRoots, opaqueFiles, hasher),
    },
    binaryBaseline: {
      source: {
        path: options.sourcePath,
        device: '1',
        inode: '2',
        birthtimeNs: '3',
        size: sourceBytes,
        mtimeNs: '4',
        sha256: 'a'.repeat(64),
      },
      target: { path: options.targetPath, state: 'absent' },
      targetDirectory: {
        path: options.targetPath.slice(0, options.targetPath.lastIndexOf('/')),
        device: '1',
        inode: '5',
        birthtimeNs: '6',
        mtimeNs: '7',
      },
      assetInventoryFingerprint: await fingerprintProjectAssetRelocationInventory(assetFiles, hasher),
    },
  };
}

async function makeBatchInput(options: {
  files: Record<string, string>;
  assets: readonly ProjectAssetFileFact[];
  items: readonly { itemId: string; sourcePath: string; targetPath: string }[];
  galleryText?: string;
  opaqueFiles?: Record<string, string>;
  assetDirectories?: string[];
}): Promise<ProjectAssetRelocationBatchPlanInput> {
  const snapshot = await loadProjectSnapshot(storageFor(options.files), hasher);
  const sourcePaths = new Set(options.items.map((item) => item.sourcePath));
  const assetFiles = options.assets.map((asset) => sourcePaths.has(asset.path)
    ? { ...asset, sha256: 'a'.repeat(64) }
    : asset);
  const opaqueFiles = Object.entries(options.opaqueFiles ?? {}).map(([path, text]) => projectFile(path, text));
  const opaqueRoots: ProjectAssetRelocationOpaqueRootScan[] = (['src', 'scripts', 'test', 'tests'] as const)
    .map((root) => ({
      root,
      state: 'scanned',
      filePaths: opaqueFiles.filter((file) => file.path.startsWith(`${root}/`)).map((file) => file.path),
    }));
  const sourceOrder = [...sourcePaths].sort();
  const directoryOrder = [...new Set(options.items.map((item) => item.targetPath.slice(0, item.targetPath.lastIndexOf('/'))))]
    .sort();
  const assetInventoryFingerprint = await fingerprintProjectAssetRelocationInventory(assetFiles, hasher);
  const items = options.items.map((item) => {
    const sourceBytes = options.assets.find((asset) => asset.path === item.sourcePath)?.bytes ?? 1;
    const sourceOrdinal = sourceOrder.indexOf(item.sourcePath) + 2;
    const targetDirectoryPath = item.targetPath.slice(0, item.targetPath.lastIndexOf('/'));
    const directoryOrdinal = directoryOrder.indexOf(targetDirectoryPath) + 100;
    return {
      itemId: item.itemId,
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
      binaryBaseline: {
        source: {
          path: item.sourcePath,
          device: '1',
          inode: String(sourceOrdinal),
          birthtimeNs: String(sourceOrdinal + 10),
          size: sourceBytes,
          mtimeNs: String(sourceOrdinal + 20),
          sha256: 'a'.repeat(64),
        },
        target: {
          path: item.targetPath,
          state: options.assets.some((asset) => asset.path === item.targetPath) ? 'exists' as const : 'absent' as const,
        },
        targetDirectory: {
          path: targetDirectoryPath,
          device: '1',
          inode: String(directoryOrdinal),
          birthtimeNs: String(directoryOrdinal + 10),
          mtimeNs: String(directoryOrdinal + 20),
        },
        assetInventoryFingerprint,
      },
    };
  });
  return {
    operationId: '11111111-1111-4111-8111-111111111111',
    snapshot,
    assetFiles,
    assetDirectories: options.assetDirectories ?? [
      'content/assets/bg',
      'content/assets/bg/chapter-one',
      'content/assets/bg/one',
      'content/assets/bg/two',
      'content/assets/portrait',
      'content/assets/portrait/cast',
      'content/assets/avatar',
      'content/assets/avatar/cast',
    ],
    items,
    galleryFile: options.galleryText === undefined
      ? null
      : projectFile('content/config/gallery.json', options.galleryText),
    opaqueFiles,
    scanCoverage: {
      gallery: options.galleryText === undefined ? 'absent' : 'included',
      opaqueRoots,
      opaqueInventoryFingerprint: await fingerprintProjectAssetRelocationOpaqueScan(opaqueRoots, opaqueFiles, hasher),
    },
  };
}

function changedText(
  result: Awaited<ReturnType<typeof planProjectAssetRelocation>>,
  path: string,
): string {
  const change = result.textChanges.find((candidate) => candidate.path === path);
  expect(change, `missing text change ${path}`).toBeDefined();
  return change!.afterText;
}

function changedBatchText(
  result: { textChanges: Array<{ path: string; afterText: string }> },
  path: string,
): string {
  const changes = result.textChanges.filter((candidate) => candidate.path === path);
  expect(changes, `missing text change ${path}`).toHaveLength(1);
  return changes[0]!.afterText;
}

describe('reference-aware project asset relocation planner', () => {
  it('renames a background across a quoted CRLF scene, timeline, and explicit gallery source', async () => {
    const scene = '@scene rain\r\n  @bg "castle_hall"\r\n@unlock_cg memory\r\n@end\r\n';
    const timeline = '{\r\n  "version": 1,\r\n  "id": "rain",\r\n  "durationMs": 200,\r\n  "tracks": [{ "kind": "background", "cues": [{ "atMs": 0, "durationMs": 0, "easing": "linear", "action": "set", "key": "castle_hall" }] }]\r\n}\r\n';
    const gallery = '{\r\n  "cgs": [{ "id": "memory", "name": "雨夜", "src": "castle_hall" }],\r\n  "music": []\r\n}\r\n';
    const config = '\uFEFF{"entryScene":"rain","characters":{},"variables":{},"player":{"titleBackground":"castle_hall","subtitle":"castle_hall","endScenes":["castle_hall"],"firstRunHint":"castle_hall","custom":42}}\r\n';
    const input = await makeInput({
      files: {
        'game.config.json': config,
        'content/scenario/rain.gal': scene,
        'content/timelines/rain.json': timeline,
      },
      assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 10 }],
      sourcePath: 'content/assets/bg/castle_hall.webp',
      targetPath: 'content/assets/bg/chapter-one/rain_platform.webp',
      galleryText: gallery,
    });

    const result = await planProjectAssetRelocation(input, hasher);

    expect(result.plan).toMatchObject({
      status: 'ready',
      affectedReferenceCount: 4,
      affectedFileCount: 4,
      source: { kind: 'background', key: 'castle_hall' },
      target: { kind: 'background', key: 'rain_platform' },
      blockers: [],
    });
    expect(changedText(result, 'content/scenario/rain.gal')).toBe(scene.replace('"castle_hall"', '"rain_platform"'));
    expect(changedText(result, 'content/timelines/rain.json')).toBe(timeline.replace('"castle_hall"', '"rain_platform"'));
    expect(changedText(result, 'content/config/gallery.json')).toBe(gallery.replace('"castle_hall"', '"rain_platform"'));
    expect(changedText(result, 'game.config.json')).toBe(config.replace('"titleBackground":"castle_hall"', '"titleBackground":"rain_platform"'));
    expect(result.scannedFiles.map((file) => file.path)).toEqual([
      'content/config/gallery.json',
      'content/scenario/rain.gal',
      'content/timelines/rain.json',
      'game.config.json',
    ]);
  });

  it('normalizes default portrait semantics and rewrites show, full hide/mov, and every portrait timeline target', async () => {
    const scene = [
      '@scene portrait_probe',
      '@show lynn @ left',
      '@hide lynn:normal',
      '@mov lynn:normal left 200',
      '@end',
      '',
    ].join('\n');
    const timeline = JSON.stringify({
      version: 1,
      id: 'portrait_probe',
      durationMs: 500,
      tracks: [{
        kind: 'portrait',
        target: 'lynn:normal',
        cues: [
          { atMs: 0, durationMs: 0, easing: 'linear', action: 'show', expression: 'normal', position: 'left' },
          { atMs: 100, durationMs: 100, easing: 'linear', action: 'move', position: 'right' },
          { atMs: 300, durationMs: 0, easing: 'linear', action: 'hide' },
        ],
      }],
    }, null, 2) + '\n';
    const input = await makeInput({
      files: {
        'game.config.json': '{"entryScene":"portrait_probe","characters":{"lynn":{"name":"凛"}},"variables":{}}\n',
        'content/scenario/portrait_probe.gal': scene,
        'content/timelines/portrait_probe.json': timeline,
      },
      assets: [{ path: 'content/assets/portrait/lynn_normal_normal.png', bytes: 10 }],
      sourcePath: 'content/assets/portrait/lynn_normal_normal.png',
      targetPath: 'content/assets/portrait/cast/rin_casual_smile.png',
    });

    const result = await planProjectAssetRelocation(input, hasher);
    expect(result.plan.status).toBe('ready');
    expect(result.plan.source).toMatchObject({ kind: 'portrait', key: 'lynn:normal', variant: 'normal' });
    expect(result.plan.target).toMatchObject({ kind: 'portrait', key: 'rin:casual', variant: 'smile' });
    expect(changedText(result, 'content/scenario/portrait_probe.gal')).toBe([
      '@scene portrait_probe',
      '@show rin:casual smile @ left',
      '@hide rin:casual',
      '@mov rin:casual left 200',
      '@end',
      '',
    ].join('\n'));
    expect(changedText(result, 'content/timelines/portrait_probe.json')).toBe(
      timeline.replace('"target": "lynn:normal"', '"target": "rin:casual"')
        .replace('"expression": "normal"', '"expression": "smile"'),
    );
  });

  it('blocks a portrait expression rename when a timeline cue has no string expression', async () => {
    for (const expression of [undefined, null, 1] as const) {
      const input = await makeInput({
        files: {
          'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
          'content/scenario/start.gal': '@scene start\n@end\n',
          'content/timelines/portrait.json': JSON.stringify({
            version: 1,
            id: 'portrait',
            durationMs: 100,
            tracks: [{
              kind: 'portrait',
              target: 'lynn:normal',
              cues: [{
                atMs: 0,
                durationMs: 0,
                easing: 'linear',
                action: 'show',
                position: 'left',
                ...(expression === undefined ? {} : { expression }),
              }],
            }],
          }),
        },
        assets: [{ path: 'content/assets/portrait/lynn_normal_normal.png', bytes: 10 }],
        sourcePath: 'content/assets/portrait/lynn_normal_normal.png',
        targetPath: 'content/assets/portrait/lynn_normal_smile.png',
      });

      const result = await planProjectAssetRelocation(input, hasher);
      expect(result.plan.status, String(expression)).toBe('blocked');
      expect(result.plan.blockers.map((blocker) => blocker.code), String(expression))
        .toContain('ASSET_RELOCATION_OPAQUE_REFERENCE');
      expect(result.textChanges, String(expression)).toEqual([]);
    }
  });

  it('blocks an old asset token used as an unknown JSON object key', async () => {
    const input = await makeInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{},"assetAliases":{"castle_hall":"legacy"}}\n',
        'content/scenario/start.gal': '@scene start\n@end\n',
      },
      assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
      sourcePath: 'content/assets/bg/castle_hall.webp',
      targetPath: 'content/assets/bg/chapter-one/rain.webp',
    });

    const result = await planProjectAssetRelocation(input, hasher);
    expect(result.plan.status).toBe('blocked');
    expect(result.plan.blockers.map((blocker) => blocker.code)).toContain('ASSET_RELOCATION_OPAQUE_REFERENCE');
    expect(result.textChanges).toEqual([]);
  });

  it('rewrites character avatar references without reformatting game.config.json', async () => {
    const config = '{\r\n\t"entryScene": "start",\r\n\t"characters": {"lynn": {"name": "凛", "avatar": "lynn"}},\r\n\t"variables": {}\r\n}\r\n';
    const input = await makeInput({
      files: {
        'game.config.json': config,
        'content/scenario/start.gal': '@scene start\r\n@end\r\n',
      },
      assets: [{ path: 'content/assets/avatar/lynn.png', bytes: 10 }],
      sourcePath: 'content/assets/avatar/lynn.png',
      targetPath: 'content/assets/avatar/cast/rin.png',
    });

    const result = await planProjectAssetRelocation(input, hasher);
    expect(result.plan.status).toBe('ready');
    expect(changedText(result, 'game.config.json')).toBe(config.replace('"avatar": "lynn"', '"avatar": "rin"'));
  });

  it('allows a same-key directory move without text changes', async () => {
    const input = await makeInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@bg castle_hall\n@end\n',
      },
      assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 10 }],
      sourcePath: 'content/assets/bg/castle_hall.webp',
      targetPath: 'content/assets/bg/chapter-one/castle_hall.webp',
    });

    const result = await planProjectAssetRelocation(input, hasher);
    expect(result.plan.status).toBe('ready');
    expect(result.plan.affectedReferenceCount).toBe(0);
    expect(result.textChanges).toEqual([]);
  });

  it('blocks reserved, fallback, ambiguous group, opaque code, and unsafe target cases', async () => {
    const baseFiles = {
      'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
      'content/scenario/start.gal': '@scene start\n@hide lynn\n@end\n',
    };
    const cases = [
      {
        name: 'reserved title key',
        sourcePath: 'content/assets/bg/title_bg.png',
        targetPath: 'content/assets/bg/title_new.png',
        assets: [{ path: 'content/assets/bg/title_bg.png', bytes: 1 }],
        galleryText: undefined,
        opaqueFiles: undefined,
        code: 'ASSET_RELOCATION_RESERVED_KEY',
      },
      {
        name: 'ordinary background cannot take the reserved title key',
        sourcePath: 'content/assets/bg/castle_hall.png',
        targetPath: 'content/assets/bg/title_bg.png',
        assets: [{ path: 'content/assets/bg/castle_hall.png', bytes: 1 }],
        galleryText: undefined,
        opaqueFiles: undefined,
        code: 'ASSET_RELOCATION_RESERVED_KEY',
      },
      {
        name: 'implicit gallery fallback',
        sourcePath: 'content/assets/bg/memory.png',
        targetPath: 'content/assets/bg/memory_new.png',
        assets: [{ path: 'content/assets/bg/memory.png', bytes: 1 }],
        galleryText: '{"cgs":[{"id":"memory","name":"回忆"}]}\n',
        opaqueFiles: undefined,
        code: 'ASSET_RELOCATION_OPAQUE_REFERENCE',
      },
      {
        name: 'bare portrait group changes role',
        sourcePath: 'content/assets/portrait/lynn_uniform_normal.png',
        targetPath: 'content/assets/portrait/rin_uniform_normal.png',
        assets: [{ path: 'content/assets/portrait/lynn_uniform_normal.png', bytes: 1 }],
        galleryText: undefined,
        opaqueFiles: undefined,
        code: 'ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE',
      },
      {
        name: 'portrait key change would split sibling expressions',
        sourcePath: 'content/assets/portrait/lynn_uniform_normal.png',
        targetPath: 'content/assets/portrait/rin_uniform_normal.png',
        assets: [
          { path: 'content/assets/portrait/lynn_uniform_normal.png', bytes: 1 },
          { path: 'content/assets/portrait/lynn_uniform_smile.png', bytes: 1 },
        ],
        galleryText: undefined,
        opaqueFiles: undefined,
        code: 'ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE',
      },
      {
        name: 'malformed source portrait identity',
        sourcePath: 'content/assets/portrait/lynn_uniform.png',
        targetPath: 'content/assets/portrait/lynn_uniform_normal.png',
        assets: [{ path: 'content/assets/portrait/lynn_uniform.png', bytes: 1 }],
        galleryText: undefined,
        opaqueFiles: undefined,
        code: 'ASSET_RELOCATION_PORTRAIT_NAME_INVALID',
      },
      {
        name: 'project script pins the path',
        sourcePath: 'content/assets/bg/castle_hall.webp',
        targetPath: 'content/assets/bg/chapter-one/castle_hall.webp',
        assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
        galleryText: undefined,
        opaqueFiles: { 'scripts/check-assets.mjs': "const required = ['content/assets/bg/castle_hall.webp'];\n" },
        code: 'ASSET_RELOCATION_OPAQUE_REFERENCE',
      },
      {
        name: 'project script constructs the runtime key',
        sourcePath: 'content/assets/bg/castle_hall.webp',
        targetPath: 'content/assets/bg/chapter-one/castle_hall.webp',
        assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
        galleryText: undefined,
        opaqueFiles: { 'src/asset-key.ts': "export const key = 'castle_' + 'hall';\n" },
        code: 'ASSET_RELOCATION_OPAQUE_REFERENCE',
      },
      {
        name: 'project script escapes the runtime key',
        sourcePath: 'content/assets/bg/castle_hall.webp',
        targetPath: 'content/assets/bg/chapter-one/castle_hall.webp',
        assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
        galleryText: undefined,
        opaqueFiles: { 'src/escaped-key.ts': 'export const key = "castle\\u005fhall";\n' },
        code: 'ASSET_RELOCATION_OPAQUE_REFERENCE',
      },
      {
        name: 'extension change',
        sourcePath: 'content/assets/bg/castle_hall.webp',
        targetPath: 'content/assets/bg/castle_hall.png',
        assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
        galleryText: undefined,
        opaqueFiles: undefined,
        code: 'ASSET_RELOCATION_EXTENSION_CHANGED',
      },
      {
        name: 'windows reserved filename',
        sourcePath: 'content/assets/bg/castle_hall.webp',
        targetPath: 'content/assets/bg/CON.foo.webp',
        assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
        galleryText: undefined,
        opaqueFiles: undefined,
        code: 'ASSET_RELOCATION_TARGET_NAME_INVALID',
      },
      {
        name: 'filename without a stem',
        sourcePath: 'content/assets/bg/castle_hall.webp',
        targetPath: 'content/assets/bg/.webp',
        assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
        galleryText: undefined,
        opaqueFiles: undefined,
        code: 'ASSET_RELOCATION_TARGET_NAME_INVALID',
      },
      {
        name: 'extended windows reserved filename',
        sourcePath: 'content/assets/bg/castle_hall.webp',
        targetPath: 'content/assets/bg/COM¹.webp',
        assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
        galleryText: undefined,
        opaqueFiles: undefined,
        code: 'ASSET_RELOCATION_TARGET_NAME_INVALID',
      },
      {
        name: 'target exists',
        sourcePath: 'content/assets/bg/castle_hall.webp',
        targetPath: 'content/assets/bg/chapter-one/rain.webp',
        assets: [
          { path: 'content/assets/bg/castle_hall.webp', bytes: 1 },
          { path: 'content/assets/bg/chapter-one/rain.webp', bytes: 2 },
        ],
        galleryText: undefined,
        opaqueFiles: undefined,
        code: 'ASSET_RELOCATION_TARGET_EXISTS',
      },
    ] as const;

    for (const item of cases) {
      const input = await makeInput({
        files: baseFiles,
        assets: [...item.assets],
        sourcePath: item.sourcePath,
        targetPath: item.targetPath,
        ...(item.galleryText === undefined ? {} : { galleryText: item.galleryText }),
        ...(item.opaqueFiles === undefined ? {} : { opaqueFiles: item.opaqueFiles }),
      });
      const result = await planProjectAssetRelocation(input, hasher);
      expect(result.plan.status, item.name).toBe('blocked');
      expect(result.plan.blockers.map((blocker) => blocker.code), item.name).toContain(item.code);
      expect(result.textChanges, item.name).toEqual([]);
    }
  });

  it('fails closed when the adapter does not prove the full gallery and project-code scan scope', async () => {
    const input = await makeInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@bg castle_hall\n@end\n',
      },
      assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
      sourcePath: 'content/assets/bg/castle_hall.webp',
      targetPath: 'content/assets/bg/chapter-one/rain.webp',
    });
    input.scanCoverage = { ...input.scanCoverage, gallery: 'included' };

    const result = await planProjectAssetRelocation(input, hasher);
    expect(result.plan.status).toBe('blocked');
    expect(result.plan.blockers.map((blocker) => blocker.code)).toContain('ASSET_RELOCATION_SCAN_INCOMPLETE');
  });

  it('recomputes the asset inventory fingerprint and verifies the source content fact', async () => {
    const input = await makeInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@end\n',
      },
      assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
      sourcePath: 'content/assets/bg/castle_hall.webp',
      targetPath: 'content/assets/bg/chapter-one/rain.webp',
    });
    input.binaryBaseline.assetInventoryFingerprint = 'f'.repeat(64);
    input.binaryBaseline.source.sha256 = 'e'.repeat(64);

    const result = await planProjectAssetRelocation(input, hasher);
    expect(result.plan.status).toBe('blocked');
    expect(result.plan.blockers.map((blocker) => blocker.code)).toContain('ASSET_RELOCATION_SCAN_INCOMPLETE');
    expect(result.textChanges).toEqual([]);
  });

  it('rejects an opaque file list that is not covered by the root scan and a gallery payload at the wrong path', async () => {
    const input = await makeInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@bg castle_hall\n@end\n',
      },
      assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
      sourcePath: 'content/assets/bg/castle_hall.webp',
      targetPath: 'content/assets/bg/chapter-one/rain.webp',
      opaqueFiles: { 'scripts/check-assets.mjs': 'export const ok = true;\n' },
    });
    input.scanCoverage = {
      ...input.scanCoverage,
      opaqueRoots: input.scanCoverage.opaqueRoots.map((root) => ({ ...root, filePaths: [] })),
    };
    input.galleryFile = projectFile('content/config/not-gallery.json', '{"cgs":[]}\n');
    input.scanCoverage.gallery = 'included';

    const result = await planProjectAssetRelocation(input, hasher);
    expect(result.plan.status).toBe('blocked');
    expect(result.plan.blockers.map((blocker) => blocker.code)).toContain('ASSET_RELOCATION_SCAN_INCOMPLETE');
    expect(result.textChanges).toEqual([]);
  });

  it('blocks duplicate JSON keys and exact old tokens in custom instruction modifiers', async () => {
    const input = await makeInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@custom @asset="castle_hall"\n@end\n',
      },
      assets: [{ path: 'content/assets/bg/castle_hall.webp', bytes: 1 }],
      sourcePath: 'content/assets/bg/castle_hall.webp',
      targetPath: 'content/assets/bg/chapter-one/rain.webp',
    });

    const result = await planProjectAssetRelocation(input, hasher);
    expect(result.plan.status).toBe('blocked');
    expect(result.plan.blockers.filter((blocker) => blocker.code === 'ASSET_RELOCATION_OPAQUE_REFERENCE')).toHaveLength(2);
  });

  it('plans two backgrounds as one batch, merges one text file, and is stable under input order', async () => {
    const files = {
      'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
      'content/scenario/start.gal': '@scene start\n@bg old_a\n@bg old_b\n@end\n',
    };
    const assets = [
      { path: 'content/assets/bg/old_a.webp', bytes: 10 },
      { path: 'content/assets/bg/old_b.webp', bytes: 20 },
    ];
    const items = [
      { itemId: 'background-a', sourcePath: 'content/assets/bg/old_a.webp', targetPath: 'content/assets/bg/chapter-one/new_a.webp' },
      { itemId: 'background-b', sourcePath: 'content/assets/bg/old_b.webp', targetPath: 'content/assets/bg/chapter-one/new_b.webp' },
    ];
    const first = await planProjectAssetRelocationBatch(await makeBatchInput({ files, assets, items }), hasher);
    const reversed = await planProjectAssetRelocationBatch(await makeBatchInput({ files, assets, items: [...items].reverse() }), hasher);

    expect(first.plan).toMatchObject({
      status: 'ready',
      affectedReferenceCount: 2,
      affectedFileCount: 1,
      blockers: [],
    });
    expect(first.textChanges.filter((change) => change.path === 'content/scenario/start.gal')).toHaveLength(1);
    expect(changedBatchText(first, 'content/scenario/start.gal')).toBe(
      '@scene start\n@bg new_a\n@bg new_b\n@end\n',
    );
    expect(reversed.plan).toEqual(first.plan);
    expect(reversed.textChanges).toEqual(first.textChanges);
  });

  it('treats a batch source-to-target mapping as simultaneous for swaps without cascading', async () => {
    const result = await planProjectAssetRelocationBatch(await makeBatchInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@bg a\n@bg b\n@end\n',
      },
      assets: [
        { path: 'content/assets/bg/a.webp', bytes: 10 },
        { path: 'content/assets/bg/b.webp', bytes: 20 },
      ],
      items: [
        { itemId: 'a-to-b', sourcePath: 'content/assets/bg/a.webp', targetPath: 'content/assets/bg/b.webp' },
        { itemId: 'b-to-a', sourcePath: 'content/assets/bg/b.webp', targetPath: 'content/assets/bg/a.webp' },
      ],
    }), hasher);

    expect(result.plan.status).toBe('ready');
    expect(changedBatchText(result, 'content/scenario/start.gal')).toBe(
      '@scene start\n@bg b\n@bg a\n@end\n',
    );
  });

  it.each([
    {
      name: 'duplicate source',
      assets: [{ path: 'content/assets/bg/a.webp', bytes: 10 }],
      items: [
        { itemId: 'a-to-one', sourcePath: 'content/assets/bg/a.webp', targetPath: 'content/assets/bg/one.webp' },
        { itemId: 'a-to-two', sourcePath: 'content/assets/bg/a.webp', targetPath: 'content/assets/bg/two.webp' },
      ],
      code: 'ASSET_RELOCATION_DUPLICATE_SOURCE',
    },
    {
      name: 'duplicate target',
      assets: [
        { path: 'content/assets/bg/a.webp', bytes: 10 },
        { path: 'content/assets/bg/b.webp', bytes: 20 },
      ],
      items: [
        { itemId: 'a-to-same', sourcePath: 'content/assets/bg/a.webp', targetPath: 'content/assets/bg/one.webp' },
        { itemId: 'b-to-same', sourcePath: 'content/assets/bg/b.webp', targetPath: 'content/assets/bg/one.webp' },
      ],
      code: 'ASSET_RELOCATION_DUPLICATE_TARGET',
    },
    {
      name: 'unselected target exists',
      assets: [
        { path: 'content/assets/bg/a.webp', bytes: 10 },
        { path: 'content/assets/bg/b.webp', bytes: 20 },
      ],
      items: [
        { itemId: 'a-to-b', sourcePath: 'content/assets/bg/a.webp', targetPath: 'content/assets/bg/b.webp' },
      ],
      code: 'ASSET_RELOCATION_TARGET_EXISTS',
    },
  ] as const)('blocks $name in a relocation batch', async ({ assets, items, code }) => {
    const result = await planProjectAssetRelocationBatch(await makeBatchInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@end\n',
      },
      assets,
      items: [...items],
    }), hasher);

    expect(result.plan.status).toBe('blocked');
    expect(result.plan.blockers.map((blocker) => blocker.code)).toContain(code);
    expect(result.textChanges).toEqual([]);
  });

  it('requires a complete portrait group when a batch changes its role or outfit key', async () => {
    const files = {
      'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
      'content/scenario/start.gal': '@scene start\n@show lynn:uniform normal\n@show lynn:uniform smile\n@end\n',
    };
    const assets = [
      { path: 'content/assets/portrait/lynn_uniform_normal.png', bytes: 10 },
      { path: 'content/assets/portrait/lynn_uniform_smile.png', bytes: 20 },
    ];
    const completeItems = [
      { itemId: 'portrait-normal', sourcePath: 'content/assets/portrait/lynn_uniform_normal.png', targetPath: 'content/assets/portrait/cast/rin_uniform_normal.png' },
      { itemId: 'portrait-smile', sourcePath: 'content/assets/portrait/lynn_uniform_smile.png', targetPath: 'content/assets/portrait/cast/rin_uniform_smile.png' },
    ];
    const complete = await planProjectAssetRelocationBatch(await makeBatchInput({ files, assets, items: completeItems }), hasher);
    expect(complete.plan.status).toBe('ready');
    expect(changedBatchText(complete, 'content/scenario/start.gal')).toBe(
      '@scene start\n@show rin:uniform normal\n@show rin:uniform smile\n@end\n',
    );

    const incomplete = await planProjectAssetRelocationBatch(await makeBatchInput({
      files,
      assets,
      items: [completeItems[0]!],
    }), hasher);
    expect(incomplete.plan.status).toBe('blocked');
    expect(incomplete.plan.blockers.map((blocker) => blocker.code))
      .toContain('ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE');
    expect(incomplete.textChanges).toEqual([]);
  });

  it('blocks distinct physical sources that share one runtime asset identity', async () => {
    const result = await planProjectAssetRelocationBatch(await makeBatchInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@bg scene\n@end\n',
      },
      assets: [
        { path: 'content/assets/bg/chapter-one/scene.webp', bytes: 10 },
        { path: 'content/assets/bg/chapter-two/scene.webp', bytes: 20 },
      ],
      assetDirectories: ['content/assets/bg/chapter-one', 'content/assets/bg/chapter-two'],
      items: [
        { itemId: 'first-scene', sourcePath: 'content/assets/bg/chapter-one/scene.webp', targetPath: 'content/assets/bg/chapter-one/first.webp' },
        { itemId: 'second-scene', sourcePath: 'content/assets/bg/chapter-two/scene.webp', targetPath: 'content/assets/bg/chapter-two/second.webp' },
      ],
    }), hasher);

    expect(result.plan.status).toBe('blocked');
    expect(result.plan.blockers.map((blocker) => blocker.code)).toContain('ASSET_RELOCATION_SOURCE_AMBIGUOUS');
    expect(result.textChanges).toEqual([]);
  });

  it('blocks a complete portrait role when its outfits map to different target roles', async () => {
    const result = await planProjectAssetRelocationBatch(await makeBatchInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@hide lynn\n@show lynn:uniform normal\n@show lynn:casual normal\n@end\n',
      },
      assets: [
        { path: 'content/assets/portrait/lynn_uniform_normal.png', bytes: 10 },
        { path: 'content/assets/portrait/lynn_casual_normal.png', bytes: 20 },
      ],
      items: [
        { itemId: 'uniform', sourcePath: 'content/assets/portrait/lynn_uniform_normal.png', targetPath: 'content/assets/portrait/cast/rin_uniform_normal.png' },
        { itemId: 'casual', sourcePath: 'content/assets/portrait/lynn_casual_normal.png', targetPath: 'content/assets/portrait/cast/sora_casual_normal.png' },
      ],
    }), hasher);

    expect(result.plan.status).toBe('blocked');
    expect(result.plan.blockers.map((blocker) => blocker.code))
      .toContain('ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE');
    expect(result.textChanges).toEqual([]);
  });

  it('chooses internal placeholders that cannot collide with real runtime keys', async () => {
    const result = await planProjectAssetRelocationBatch(await makeBatchInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@bg a\n@bg surdetbatch111111110\n@end\n',
      },
      assets: [
        { path: 'content/assets/bg/a.webp', bytes: 10 },
        { path: 'content/assets/bg/surdetbatch111111110.webp', bytes: 20 },
      ],
      items: [
        { itemId: 'ordinary', sourcePath: 'content/assets/bg/a.webp', targetPath: 'content/assets/bg/x.webp' },
        { itemId: 'reserved-looking', sourcePath: 'content/assets/bg/surdetbatch111111110.webp', targetPath: 'content/assets/bg/y.webp' },
      ],
    }), hasher);

    expect(result.plan.status).toBe('ready');
    expect(changedBatchText(result, 'content/scenario/start.gal')).toBe(
      '@scene start\n@bg x\n@bg y\n@end\n',
    );
  });

  it('does not loop when ordinary project text contains a short portrait placeholder fragment', async () => {
    const result = await planProjectAssetRelocationBatch(await makeBatchInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@show lynn:uniform normal\nlynn: foo0\n@end\n',
      },
      assets: [
        { path: 'content/assets/portrait/lynn_uniform_normal.png', bytes: 10 },
      ],
      items: [
        {
          itemId: 'portrait-normal',
          sourcePath: 'content/assets/portrait/lynn_uniform_normal.png',
          targetPath: 'content/assets/portrait/rin_uniform_normal.png',
        },
      ],
    }), hasher);

    expect(result.plan.status).toBe('ready');
    expect(changedBatchText(result, 'content/scenario/start.gal')).toBe(
      '@scene start\n@show rin:uniform normal\nlynn: foo0\n@end\n',
    );
  });

  it('turns an invalid inventory path into a fail-closed batch plan instead of throwing', async () => {
    const input = await makeBatchInput({
      files: {
        'game.config.json': '{"entryScene":"start","characters":{},"variables":{}}\n',
        'content/scenario/start.gal': '@scene start\n@bg a\n@end\n',
      },
      assets: [{ path: 'content/assets/bg/a.webp', bytes: 10 }],
      items: [{ itemId: 'a', sourcePath: 'content/assets/bg/a.webp', targetPath: 'content/assets/bg/x.webp' }],
    });
    (input.assetFiles as ProjectAssetFileFact[]).push({ path: '..\\outside.webp', bytes: 1 });

    const result = await planProjectAssetRelocationBatch(input, hasher);
    expect(result.plan.status).toBe('blocked');
    expect(result.plan.blockers.map((blocker) => blocker.code)).toContain('ASSET_RELOCATION_SCAN_INCOMPLETE');
    expect(result.textChanges).toEqual([]);
  });
});
