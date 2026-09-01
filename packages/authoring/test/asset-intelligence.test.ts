import { describe, expect, it } from 'vitest';
import type { ProjectAssetFileFact } from '../src/contracts.js';
import { buildProjectAssetIntelligence } from '../src/asset-intelligence.js';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { loadProjectSnapshot, type ProjectSnapshot } from '../src/project-snapshot.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

const galleryText = JSON.stringify({
  cgs: [{ id: 'memory_cg', name: '雨夜回忆', src: 'castle_hall' }],
  music: [{ id: 'memory_theme', name: '回忆主题', src: 'chapter_theme' }],
  texts: [{ id: 'memory_text', name: '序幕', scene: 'asset_probe', label: 'start' }],
});

const fixtureContents: Record<string, string> = {
  'game.config.json': JSON.stringify({
    entryScene: 'asset_probe',
    characters: { lynn: { name: '凛', avatar: 'lynn' } },
    variables: {},
  }),
  'content/config/gallery.json': galleryText,
  'content/scenario/asset_probe.gal': [
    '@scene asset_probe',
    '@label start',
    '@bg castle_hall',
    '@show lynn:uniform normal',
    '@bgm chapter_theme',
    '@ambience rain',
    '@se click',
    '@voice greeting',
    '@video opening',
    '@unlock_cg memory_cg',
    '@unlock_music memory_theme',
    '凛：素材引用场景。',
    '@bg missing_field',
    '@end',
  ].join('\n'),
  'content/timelines/asset_intro.json': JSON.stringify({
    version: 1,
    id: 'asset_intro',
    durationMs: 600,
    tracks: [
      { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'castle_hall' }] },
      { kind: 'portrait', target: 'lynn:uniform', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'show', expression: 'normal', position: 'left' }] },
    ],
  }),
};

const fixtureFacts: ProjectAssetFileFact[] = [
  { path: 'content/assets/ambience/rain.ogg', bytes: 101 },
  { path: 'content/assets/avatar/lynn.png', bytes: 102 },
  { path: 'content/assets/bg/alternate/castle_hall.png', bytes: 103 },
  { path: 'content/assets/bg/castle_hall.webp', bytes: 104 },
  { path: 'content/assets/bg/missing.bmp', bytes: 105 },
  { path: 'content/assets/bg/unused_backdrop.jpg' },
  { path: 'content/assets/custom/mystery.png', bytes: 106 },
  { path: 'content/assets/fonts/SourceHanSans-Regular.woff2', bytes: 107 },
  { path: 'content/assets/bgm/chapter_theme.mp3', bytes: 108 },
  { path: 'content/assets/portrait/lynn_uniform.png', bytes: 109 },
  { path: 'content/assets/portrait/lynn_uniform_normal.png', bytes: 110 },
  { path: 'content/assets/se/click.wav' },
  { path: 'content/assets/video/opening.mp4', bytes: 111 },
  { path: 'content/assets/voice/greeting.wav', bytes: 112 },
];

function storageFor(contents: Record<string, string>): ProjectStorage {
  return {
    rootIdentity: 'asset-intelligence-fixture',
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error('missing fixture file: ' + path);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

async function fixtureSnapshot(): Promise<ProjectSnapshot> {
  return loadProjectSnapshot(storageFor(fixtureContents), hasher);
}

async function snapshotFor(contents: Record<string, string>): Promise<ProjectSnapshot> {
  return loadProjectSnapshot(storageFor(contents), hasher);
}

function build(snapshot: ProjectSnapshot, facts: readonly ProjectAssetFileFact[]) {
  return buildProjectAssetIntelligence(snapshot, facts, { gallery: JSON.parse(galleryText) as unknown });
}

function asset(result: ReturnType<typeof buildProjectAssetIntelligence>, sourcePath: string) {
  const item = result.items.find((candidate) => candidate.sourcePath === sourcePath);
  expect(item, `missing asset item for ${sourcePath}`).toBeDefined();
  return item!;
}

describe('shared asset intelligence projection', () => {
  it('retains every physical kind, strict portrait identity, optional bytes, and stable file identities', async () => {
    const result = build(await fixtureSnapshot(), fixtureFacts);
    const physical = result.items.filter((item) => item.physical);

    expect(physical).toHaveLength(fixtureFacts.length);
    expect(new Set(physical.map((item) => item.kind))).toEqual(new Set([
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
    ]));
    expect(asset(result, 'content/assets/portrait/lynn_uniform_normal.png')).toMatchObject({
      assetId: 'file:content/assets/portrait/lynn_uniform_normal.png',
      kind: 'portrait',
      key: 'lynn:uniform',
      variant: 'normal',
      physical: true,
      bytes: 110,
    });
    expect(asset(result, 'content/assets/portrait/lynn_uniform.png').issues).toContain('ASSET_NAME_INVALID');
    expect(asset(result, 'content/assets/bg/castle_hall.webp').assetId).not.toBe(
      asset(result, 'content/assets/bg/alternate/castle_hall.png').assetId,
    );
    expect(asset(result, 'content/assets/bg/unused_backdrop.jpg').bytes).toBeUndefined();
    expect(result.items.map((item) => item.assetId)).toEqual([
      ...fixtureFacts.map((fact) => `file:${fact.path}`),
      'missing:background:missing_field',
    ].sort((left, right) => left.localeCompare(right)));
  });

  it('extracts direct scene, timeline, character, and gallery references with source locations', async () => {
    const result = build(await fixtureSnapshot(), fixtureFacts);
    const references = result.items.flatMap((item) => item.references);
    const sourceKinds = new Set(references.map((reference) => reference.sourceKind));
    expect(sourceKinds).toEqual(new Set(['scene', 'timeline', 'character', 'gallery']));

    expect(asset(result, 'content/assets/bg/castle_hall.webp').references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceKind: 'scene', sourcePath: 'content/scenario/asset_probe.gal', line: 3 }),
        expect.objectContaining({ sourceKind: 'timeline', sourcePath: 'content/timelines/asset_intro.json' }),
        expect.objectContaining({ sourceKind: 'gallery', sourcePath: 'content/config/gallery.json' }),
      ]),
    );
    expect(asset(result, 'content/assets/portrait/lynn_uniform_normal.png').references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceKind: 'scene', sourcePath: 'content/scenario/asset_probe.gal', line: 4 }),
        expect.objectContaining({ sourceKind: 'timeline', sourcePath: 'content/timelines/asset_intro.json' }),
      ]),
    );
    expect(asset(result, 'content/assets/avatar/lynn.png').references).toEqual([
      expect.objectContaining({
        sourceKind: 'character',
        sourcePath: 'game.config.json',
        objectRef: 'character:lynn',
      }),
    ]);
    expect(asset(result, 'content/assets/avatar/lynn.png').references[0]?.line).toBeUndefined();
    expect(
      asset(result, 'content/assets/bg/castle_hall.webp').references.find((reference) => reference.sourceKind === 'timeline')?.line,
    ).toBeUndefined();
    expect(asset(result, 'content/assets/bgm/chapter_theme.mp3').references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceKind: 'scene', sourcePath: 'content/scenario/asset_probe.gal', line: 5 }),
        expect.objectContaining({ sourceKind: 'gallery', sourcePath: 'content/config/gallery.json' }),
      ]),
    );
    expect(asset(result, 'content/assets/se/click.wav').references).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceKind: 'scene', line: 7 })]),
    );
    expect(asset(result, 'content/assets/voice/greeting.wav').references).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceKind: 'scene', line: 8 })]),
    );
    expect(asset(result, 'content/assets/video/opening.mp4').references).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceKind: 'scene', line: 9 })]),
    );
  });

  it('retains every gallery source when duplicate entry ids fan out from one unlock instruction', async () => {
    const snapshot = await snapshotFor({
      'game.config.json': JSON.stringify({ entryScene: 'gallery_probe', characters: {}, variables: {} }),
      'content/scenario/gallery_probe.gal': [
        '@scene gallery_probe',
        '@label start',
        '@unlock_cg shared_memory',
        '@end',
      ].join('\n'),
    });
    const gallery = {
      cgs: [
        { id: 'shared_memory', name: '回忆一', src: 'memory_one' },
        { id: 'shared_memory', name: '回忆二', src: 'memory_two' },
      ],
      music: [],
      texts: [],
    };
    const result = buildProjectAssetIntelligence(snapshot, [
      { path: 'content/assets/bg/memory_one.webp', bytes: 11 },
      { path: 'content/assets/bg/memory_two.webp', bytes: 12 },
    ], { gallery });

    const first = asset(result, 'content/assets/bg/memory_one.webp');
    const second = asset(result, 'content/assets/bg/memory_two.webp');
    for (const item of [first, second]) {
      expect(item.references).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceKind: 'gallery', objectRef: 'gallery:cgs:shared_memory' }),
        expect.objectContaining({ sourceKind: 'scene', line: 3 }),
      ]));
    }
    const galleryReferenceIds = [first, second]
      .flatMap((item) => item.references)
      .filter((reference) => reference.sourceKind === 'gallery')
      .map((reference) => reference.referenceId);
    expect(new Set(galleryReferenceIds).size).toBe(2);
  });

  it('keeps missing references synthetic and keeps same-key physical files visible', async () => {
    const result = build(await fixtureSnapshot(), fixtureFacts);
    const castleItems = result.items.filter((item) => item.physical && item.kind === 'background' && item.key === 'castle_hall');
    expect(castleItems).toHaveLength(2);
    expect(new Set(castleItems.map((item) => item.sourcePath))).toEqual(new Set([
      'content/assets/bg/castle_hall.webp',
      'content/assets/bg/alternate/castle_hall.png',
    ]));
    for (const item of castleItems) expect(item.issues).toContain('ASSET_KEY_DUPLICATE');

    const missing = result.items.find((item) => item.assetId === 'missing:background:missing_field');
    expect(missing).toMatchObject({
      kind: 'background',
      key: 'missing_field',
      physical: false,
      issues: ['ASSET_REFERENCE_MISSING'],
    });
    expect(missing?.sourcePath).toBeUndefined();
    expect(missing?.bytes).toBeUndefined();
    expect(missing?.references).toEqual([
      expect.objectContaining({ sourceKind: 'scene', sourcePath: 'content/scenario/asset_probe.gal', line: 13 }),
    ]);
  });

  it('reports distinct health issues and totals from physical facts only', async () => {
    const result = build(await fixtureSnapshot(), fixtureFacts);
    const issueCodes = result.issues.map((issue) => issue.code);
    expect(issueCodes).toContain('ASSET_REFERENCE_MISSING');
    expect(issueCodes).toContain('ASSET_KEY_DUPLICATE');
    expect(issueCodes).toContain('ASSET_NAME_INVALID');
    expect(issueCodes).toContain('ASSET_FORMAT_UNSUPPORTED');
    expect(issueCodes).toContain('ASSET_UNUSED');

    expect(result.summary).toMatchObject({
      fileCount: fixtureFacts.length,
      measuredFileCount: 12,
      measuredBytes: 1278,
      totalBytes: 1278,
      missingCount: 1,
      duplicateCount: 1,
      unsupportedCount: 1,
      invalidNameCount: 1,
    });
    expect(result.summary.referencedCount).toBeGreaterThan(0);
    expect(result.summary.unusedCount).toBeGreaterThan(0);
    expect(result.summary.byKind).toMatchObject({
      background: { files: 4 },
      portrait: { files: 2 },
      font: { files: 1 },
      other: { files: 1 },
    });
  });

  it('normalizes quoted runtime arguments and defaults omitted portrait expressions to normal', async () => {
    const snapshot = await snapshotFor({
      'game.config.json': JSON.stringify({ entryScene: 'quoted', characters: {}, variables: {} }),
      'content/scenario/quoted.gal': [
        '@scene quoted',
        '@bg "castle_hall"',
        '@show "lynn:uniform"',
        '@bgm "chapter_theme"',
        '@ambience "rain"',
        '@se "click"',
        '@voice "greeting"',
        '@video "opening"',
        '@end',
      ].join('\n'),
    });
    const facts: ProjectAssetFileFact[] = [
      { path: 'content/assets/bg/castle_hall.webp', bytes: 1 },
      { path: 'content/assets/portrait/lynn_uniform_normal.png', bytes: 1 },
      { path: 'content/assets/bgm/chapter_theme.mp3', bytes: 1 },
      { path: 'content/assets/ambience/rain.ogg', bytes: 1 },
      { path: 'content/assets/se/click.wav', bytes: 1 },
      { path: 'content/assets/voice/greeting.wav', bytes: 1 },
      { path: 'content/assets/video/opening.mp4', bytes: 1 },
    ];
    const result = buildProjectAssetIntelligence(snapshot, facts);

    expect(result.items.filter((item) => !item.physical)).toEqual([]);
    expect(result.summary.referencedCount).toBe(facts.length);
    expect(asset(result, 'content/assets/portrait/lynn_uniform_normal.png')).toMatchObject({
      key: 'lynn:uniform',
      variant: 'normal',
    });
  });

  it('treats quoted ambience off as the runtime stop command instead of a missing asset', async () => {
    const snapshot = await snapshotFor({
      'game.config.json': JSON.stringify({ entryScene: 'silence', characters: {}, variables: {} }),
      'content/scenario/silence.gal': [
        '@scene silence',
        '@ambience "off"',
        '@end',
      ].join('\n'),
    });
    const result = buildProjectAssetIntelligence(snapshot, []);

    expect(result.items).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('deduplicates repeated physical path facts before identities, issues, and byte totals are built', async () => {
    const snapshot = await fixtureSnapshot();
    const repeated = { path: 'content/assets/bg/only.webp', bytes: 23 } satisfies ProjectAssetFileFact;
    const result = buildProjectAssetIntelligence(snapshot, [repeated, repeated]);

    expect(result.items.filter((item) => item.assetId === 'file:content/assets/bg/only.webp')).toHaveLength(1);
    expect(result.summary.fileCount).toBe(1);
    expect(result.summary.totalBytes).toBe(23);
    expect(new Set(result.issues.map((issue) => issue.issueId)).size).toBe(result.issues.length);
  });

  it('is byte-stable when physical facts arrive in reverse enumeration order', async () => {
    const snapshot = await fixtureSnapshot();
    const forward = build(snapshot, fixtureFacts);
    const reverse = build(snapshot, [...fixtureFacts].reverse());
    expect(reverse).toEqual(forward);
  });
});
