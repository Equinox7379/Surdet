import { readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const gameRoot = fileURLToPath(new URL('../', import.meta.url));
const scenarioRoot = path.join(gameRoot, 'content/scenario');
const gallery = JSON.parse(readFileSync(path.join(gameRoot, 'content/config/gallery.json'), 'utf8')) as {
  cgs: { id: string; name: string; src?: string }[];
  music: { id: string; name: string; src?: string }[];
  texts: { id: string; name: string; scene: string; label?: string }[];
};
const gameConfig = JSON.parse(readFileSync(path.join(gameRoot, 'game.config.json'), 'utf8')) as {
  characters: Record<string, { avatar?: string }>;
};

const MUSIC_IDS = [
  'midnight_rain',
  'old_room',
  'convenience_hum',
  'underground_signal',
  'investigation',
  'last_train',
  'ending_testimony',
  'ending_meeting',
  'blackout',
  'ending_silence',
] as const;

const TEXT_IDS = [
  'prologue',
  'common_0017',
  'common_apartment',
  'common_convenience',
  'common_passage',
  'route_testimony_station',
  'route_testimony_rooftop',
  'route_meeting_train',
  'route_meeting_rooftop',
  'route_silence_blackout',
  'route_silence_dawn',
] as const;

const sceneLabels = new Map<string, Set<string>>();
const unlockIds = {
  cg: new Set<string>(),
  music: new Set<string>(),
  text: new Set<string>(),
};

for (const filename of readdirSync(scenarioRoot).filter((name) => name.endsWith('.gal'))) {
  const sceneId = filename.slice(0, -'.gal'.length);
  const source = readFileSync(path.join(scenarioRoot, filename), 'utf8');
  const labels = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    const label = line.match(/^@label\s+([^\s]+)\s*$/);
    if (label) labels.add(label[1]!);
    const unlock = line.match(/^@unlock_(cg|music|text)\s+([^\s]+)\s*$/);
    if (unlock) unlockIds[unlock[1] as 'cg' | 'music' | 'text'].add(unlock[2]!);
  }
  sceneLabels.set(sceneId, labels);
}

describe('Zero Gallery content contract', () => {
  it('uses only the approved Zero Gallery catalogue', () => {
    expect(gallery.cgs).toEqual([]);
    expect(gallery.music.map((entry) => entry.id)).toEqual(MUSIC_IDS);
    expect(gallery.texts.map((entry) => entry.id)).toEqual(TEXT_IDS);
    expect(JSON.stringify(gallery)).not.toMatch(/castle_hall|night_field|tense_01|ch01_01|ch01_02/);
  });

  it('maps 许知遥 to the existing zhirao avatar asset', () => {
    expect(gameConfig.characters.zhirao.avatar).toBe('zhirao');
  });

  it('gives every approved Gallery item one matching unlock instruction', () => {
    expect(unlockIds.music).toEqual(new Set(MUSIC_IDS));
    expect(unlockIds.text).toEqual(new Set(TEXT_IDS));
    expect(unlockIds.cg).toEqual(new Set());
  });

  it('keeps every text replay destination real', () => {
    expect(gallery.texts.find((entry) => entry.id === 'prologue')).toMatchObject({ scene: 'prologue' });
    for (const entry of gallery.texts.filter((item) => item.id !== 'prologue')) {
      expect(sceneLabels.get(entry.scene)?.has('start')).toBe(true);
      expect(entry.label).toBe('start');
    }
  });
});
