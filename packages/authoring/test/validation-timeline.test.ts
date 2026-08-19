import { describe, expect, it } from 'vitest';
import type { ProjectFile, ProjectStorage, TextHasher } from '../src/project-storage.js';
import { buildObjectIndex } from '../src/object-index.js';
import { loadProjectSnapshot } from '../src/project-snapshot.js';
import { validateSnapshot } from '../src/validation.js';
import { buildAssetCatalog } from '../src/asset-catalog.js';

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const hasher: TextHasher = { sha256: async (text) => digest(text) };

const catalog = buildAssetCatalog([
  'content/assets/bg/castle_hall.svg',
  'content/assets/bg/night_field.svg',
  'content/assets/portrait/lynn_uniform_normal.svg',
  'content/assets/portrait/lynn_uniform_night.svg',
]);

const agentProbeText = ['@scene agent_probe', '@label start', '@timeline agent_blackout @ blocking', '@end'].join('\n');

function storageFor(contents: Record<string, string>): ProjectStorage {
  return {
    rootIdentity: 'validation-fixture',
    listFiles: async () => Object.keys(contents),
    readText: async (path): Promise<ProjectFile> => {
      const text = contents[path];
      if (text === undefined) throw new Error('missing fixture file: ' + path);
      return { path, text, bytes: text.length, sha256: await hasher.sha256(text) };
    },
    exists: async (path) => path in contents,
  };
}

const goodTimeline = JSON.stringify({
  version: 1,
  id: 'agent_blackout',
  durationMs: 800,
  tracks: [
    { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'night_field' }] },
    { kind: 'portrait', target: 'lynn:uniform', cues: [{ atMs: 100, durationMs: 0, easing: 'linear', action: 'show', expression: 'night', position: 'left' }] },
  ],
});

describe('timeline validation wiring', () => {
  it('routes core validateTimeline diagnostics into the validation envelope as errors', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText,
      'content/timelines/agent_blackout.json': JSON.stringify({
        version: 2,
        id: 'agent_blackout',
        durationMs: 800,
        tracks: [{ kind: 'screen', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'fade', alpha: 5 }] }],
      }),
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    const timelineErrors = result.issues.filter((issue) => (
      issue.file === 'content/timelines/agent_blackout.json' && issue.severity === 'error'
    ));
    expect(timelineErrors.length).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });

  it('reports a missing timeline target as an error when timelines are part of the snapshot', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText.replace('agent_blackout @ blocking', 'missing_show @ blocking'),
      'content/timelines/agent_blackout.json': goodTimeline,
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    const missing = result.issues.find((issue) => issue.code === 'TIMELINE_MISSING');
    expect(missing).toBeDefined();
    expect(missing!.severity).toBe('error');
    expect(result.ok).toBe(false);
  });

  it('reports unresolved asset references as warnings that never block', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText,
      'content/timelines/agent_blackout.json': JSON.stringify({
        version: 1,
        id: 'agent_blackout',
        durationMs: 800,
        tracks: [
          { kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'missing_bg' }] },
          { kind: 'portrait', target: 'lynn:casual', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'show', expression: 'smile', position: 'left' }] },
        ],
      }),
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    const warnings = result.issues.filter((issue) => issue.severity === 'warning' && issue.code === 'ASSET_UNRESOLVED');
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    for (const warning of warnings) {
      expect(warning.objectRef).toBeDefined();
      expect(warning.action).toBeDefined();
    }
    expect(result.issues.every((issue) => issue.severity !== 'error')).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('passes a fully resolved wave 2 slice with only non-blocking noise', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText,
      'content/timelines/agent_blackout.json': goodTimeline,
    }), hasher);
    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    expect(result.issues.filter((issue) => issue.code === 'ASSET_UNRESOLVED')).toHaveLength(0);
    expect(result.ok).toBe(true);
  });
});

/* ============ Reliability Phase 2A（A1）：malformed timeline 不得让 validation crash ============ */

describe('malformed timeline structural safety (Phase 2A)', () => {
  const malformedCases = [
    {
      label: 'missing tracks',
      definition: JSON.stringify({ version: 1, id: 'agent_blackout', durationMs: 800 }),
    },
    {
      label: 'track missing cues',
      definition: JSON.stringify({ version: 1, id: 'agent_blackout', durationMs: 800, tracks: [{ kind: 'background' }] }),
    },
  ];

  it.each(malformedCases)('returns structured T005 diagnostics with assetCatalog instead of throwing ($label)', async ({ definition }) => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText,
      'content/timelines/agent_blackout.json': definition,
    }), hasher);

    let result: ReturnType<typeof validateSnapshot>;
    expect(() => {
      result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    }).not.toThrow();
    expect(result!.ok).toBe(false);
    const t005 = result!.issues.find((issue) => issue.code.startsWith('T0') && issue.file === 'content/timelines/agent_blackout.json');
    expect(t005).toBeDefined();
    expect(t005!.severity).toBe('error');
  });

  it('does not add TIMELINE_MISSING when a referenced timeline parses but is structurally invalid', async () => {
    // baseline 语义锁定：文件存在且 JSON parse 成功（即使结构非法）→ 不报 TIMELINE_MISSING（C1 probe）。
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText,
      'content/timelines/agent_blackout.json': JSON.stringify({ version: 1, id: 'agent_blackout', durationMs: 800 }),
    }), hasher);

    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    expect(result.issues.some((issue) => issue.code === 'TIMELINE_MISSING')).toBe(false);
    expect(result.issues.some((issue) => issue.file === 'content/timelines/agent_blackout.json' && issue.severity === 'error')).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('keeps TIMELINE_MISSING for a referenced timeline whose JSON fails to parse', async () => {
    // baseline 语义锁定：JSON parse 失败 → TIMELINE_JSON error，且引用处报 TIMELINE_MISSING（C2 probe）。
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText,
      'content/timelines/agent_blackout.json': '{"version": 1, not-json',
    }), hasher);

    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    expect(result.issues.some((issue) => issue.code === 'TIMELINE_JSON')).toBe(true);
    expect(result.issues.some((issue) => issue.code === 'TIMELINE_MISSING')).toBe(true);
    expect(result.ok).toBe(false);
  });
});

/* ============ Reliability Phase 2B（A2）：canonical timeline identity ============
 * 规则：filename stem == definition.id == typed authoring timelineId，唯一 canonical 身份。
 * mismatch 文件仍算 filename presence（不新增误导 MISSING），但绝不进入 usable/asset traversal。 */

const mismatchedTimeline = JSON.stringify({
  version: 1,
  id: 'other_show',
  durationMs: 800,
  // 资源 key 故意指向不存在的 bg：mismatch 文件不进入 asset traversal，因此不应产生 ASSET_UNRESOLVED。
  tracks: [{ kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: 'ghost_bg' }] }],
});

describe('canonical timeline identity (Phase 2B)', () => {
  it('CASE B: reports TIMELINE_ID_MISMATCH for a filename reference without adding misleading MISSING', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText, // 引用 agent_blackout（filename）
      'content/timelines/agent_blackout.json': mismatchedTimeline, // 内部 id=other_show
    }), hasher);

    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    const mismatch = result.issues.find((issue) => issue.code === 'TIMELINE_ID_MISMATCH');
    expect(mismatch).toBeDefined();
    expect(mismatch!.severity).toBe('error');
    expect(mismatch!.text).toContain("definition.id 'other_show'");
    expect(mismatch!.text).toContain("文件名派生 ID 'agent_blackout'");
    // 文件真实存在且 parse 成功：不得额外新增误导性 TIMELINE_MISSING。
    expect(result.issues.some((issue) => issue.code === 'TIMELINE_MISSING')).toBe(false);
    // mismatch 文件不进入 asset traversal：ghost_bg 不产生 ASSET_UNRESOLVED。
    expect(result.issues.some((issue) => issue.code === 'ASSET_UNRESOLVED' && issue.file === 'content/timelines/agent_blackout.json')).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('CASE C: internal-id reference gets MISMATCH plus TIMELINE_MISSING for the absent canonical file', async () => {
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText.replace('agent_blackout @ blocking', 'other_show @ blocking'),
      'content/timelines/agent_blackout.json': mismatchedTimeline,
    }), hasher);

    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    expect(result.issues.some((issue) => issue.code === 'TIMELINE_ID_MISMATCH')).toBe(true);
    const missing = result.issues.find((issue) => issue.code === 'TIMELINE_MISSING');
    expect(missing).toBeDefined();
    expect(missing!.text).toContain("'other_show'");
    expect(result.ok).toBe(false);
  });

  it('CASE D: duplicate internal ids across files produce MISMATCH plus TIMELINE_ID_DUPLICATE with both paths', async () => {
    const shared = (file: string) => JSON.stringify({
      version: 1,
      id: 'shared',
      durationMs: 800,
      tracks: [{ kind: 'background', cues: [{ atMs: 0, durationMs: 0, easing: 'linear', action: 'set', key: file === 'a.json' ? 'castle_hall' : 'night_field' }] }],
    });
    const snapshot = await loadProjectSnapshot(storageFor({
      'game.config.json': '{"entryScene":"agent_probe","variables":{}}',
      'content/scenario/agent_probe.gal': agentProbeText,
      'content/timelines/a.json': shared('a.json'),
      'content/timelines/b.json': shared('b.json'),
    }), hasher);

    const result = validateSnapshot(snapshot, buildObjectIndex(snapshot), { assetCatalog: catalog });
    // 两个文件都与各自 filename stem 不一致：各得一个 MISMATCH。
    expect(result.issues.filter((issue) => issue.code === 'TIMELINE_ID_MISMATCH')).toHaveLength(2);
    // 同时报告内部身份争夺：duplicate 诊断必须给出两个冲突文件路径。
    const duplicate = result.issues.find((issue) => issue.code === 'TIMELINE_ID_DUPLICATE');
    expect(duplicate).toBeDefined();
    expect(duplicate!.severity).toBe('error');
    expect(duplicate!.text).toContain("'shared'");
    expect(duplicate!.text).toContain('content/timelines/a.json');
    expect(duplicate!.text).toContain('content/timelines/b.json');
    expect(result.ok).toBe(false);
  });
});
