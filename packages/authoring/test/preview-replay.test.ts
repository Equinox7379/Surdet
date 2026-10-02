import * as crypto from 'node:crypto';
import { expect, it } from 'vitest';
import { buildPreviewReplaySources, parsePreviewPlaybackCheckpoint, resolvePreviewReplayOption, samePreviewReplaySource } from '../src/preview-replay.js';

const hasher = { sha256: async (text: string) => crypto.createHash('sha256').update(text).digest('hex') };
const script = '@scene start\n@label mail\n@if trust > 0\n  @choice\n    送信 [if:trust > 1] -> @mod trust + 1 @goto done\n    等待 -> @goto done\n@endif\n@label done\n凛：到了。\n@end\n';
it('keeps source identity across unrelated line shifts but rejects changed branch conditions, options and invisible choices', async () => {
  const points = (await buildPreviewReplaySources([{ id: 'start', text: script }], hasher)).get('start')!;
  const choice = points.get(4)!;
  const saved = { source: choice.source, optionFingerprint: choice.options![0]!.fingerprint };
  expect(resolvePreviewReplayOption(choice, saved, [{ index: 0, label: '送信' }, { index: 1, label: '等待' }])).toBe(0);
  expect(resolvePreviewReplayOption(choice, saved, [{ index: 1, label: '等待' }])).toBeNull();
  const shifted = (await buildPreviewReplaySources([{ id: 'start', text: script.replace('@label mail', '// 旁注\n@label mail') }], hasher)).get('start')!;
  expect(samePreviewReplaySource(choice.source, shifted.get(5)!.source)).toBe(true);
  for (const changed of [script.replace('trust > 0', 'trust > 2'), script.replace('送信 [if:trust > 1]', '送信 [if:trust > 3]'), script.replace('@mod trust + 1', '@mod trust + 2')]) {
    const current = (await buildPreviewReplaySources([{ id: 'start', text: changed }], hasher)).get('start')!.get(4)!;
    expect(resolvePreviewReplayOption(current, saved, [{ index: 0, label: '送信' }, { index: 1, label: '等待' }])).toBeNull();
  }
});

it('includes preceding if/elif guards for a choice in else, and marks repeated unanchored sources ambiguous', async () => {
  const text = '@scene start\n@if trust > 1\n好。\n@else\n@choice\n  等待 -> @goto end\n@endif\n@label end\n到了。\n到了。\n@end\n';
  const first = (await buildPreviewReplaySources([{ id: 'start', text }], hasher)).get('start')!;
  const changed = (await buildPreviewReplaySources([{ id: 'start', text: text.replace('trust > 1', 'trust > 2') }], hasher)).get('start')!;
  expect(samePreviewReplaySource(first.get(5)!.source, changed.get(5)!.source)).toBe(false);
  expect(first.get(9)!.unique).toBe(false);
  expect(first.get(10)!.unique).toBe(false);
});

it('keeps equal text ambiguous only within its scene and anchor, including a large labelled scene', async () => {
  const lines = ['@scene start', '相同正文。', '相同正文。'];
  for (let index = 0; index < 5000; index++) lines.push(`@label point${index}`, '相同正文。');
  lines.push('@end');
  const sources = await buildPreviewReplaySources([{ id: 'start', text: lines.join('\n') }, { id: 'other', text: '@scene other\n相同正文。\n@end' }], hasher);
  const points = sources.get('start')!;
  expect(points.get(2)!.unique).toBe(false);
  expect(points.get(3)!.unique).toBe(false);
  expect([...points.values()].filter(point => point.source.anchor !== null).every(point => point.unique)).toBe(true);
  expect([...sources.get('other')!.values()].every(point => point.unique)).toBe(true);
});

it('accepts only replay identities and seed, never injected variables or an overlong/truncated path', () => {
  const source = { sceneId: 'start', kind: 'choice', anchor: null, fingerprint: 'a'.repeat(64) };
  const value = { seed: 7, sceneId: 'start', choices: [{ source, optionFingerprint: 'b'.repeat(64) }], target: source };
  expect(parsePreviewPlaybackCheckpoint(value)).toEqual(value);
  for (const invalid of [{ ...value, variables: { trust: 999 } }, { ...value, seed: -1 }, { ...value, seed: 2 ** 32 },
    { ...value, choices: Array(257).fill(value.choices[0]) }, { ...value, target: { ...source, kind: 'instruction' } }]) {
    expect(() => parsePreviewPlaybackCheckpoint(invalid)).toThrow('试玩续接路径格式无效');
  }
});
