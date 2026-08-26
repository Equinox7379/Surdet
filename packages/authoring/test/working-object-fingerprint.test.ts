import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  fingerprintWorkingObject,
  stableStringify,
  type TextHasher,
} from '../src/index.js';

const hasher: TextHasher = {
  sha256: async (text) => crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
};

const workingFiles: Record<string, string> = {
  'content/scenario/intro.gal': '@scene intro\n凛：开始。\n@end\n',
  'content/timelines/intro_opening.json': JSON.stringify({
    version: 1,
    id: 'intro_opening',
    durationMs: 1000,
    tracks: [],
  }),
  'game.config.json': JSON.stringify({
    entryScene: 'intro',
    variables: { 'flag.alpha': { type: 'string', initial: '' } },
    characters: { lynn: { name: '凛', avatar: 'lynn' } },
  }),
};

const cases = [
  ['scene:intro', 'present'],
  ['timeline:intro_opening', 'present'],
  ['variable:flag.alpha', 'present'],
  ['character:lynn', 'present'],
  ['config:characters', 'present'],
  ['config:entryScene', 'present'],
] as const;

describe('working object fingerprint resolver', () => {
  it.each(cases)('fingerprints %s as %s', async (objectRef, state) => {
    const result = await fingerprintWorkingObject(workingFiles, objectRef, hasher);
    expect(result.objectRef).toBe(objectRef);
    expect(result.state).toBe(state);
    expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives removals an explicit absent fingerprint', async () => {
    const result = await fingerprintWorkingObject(workingFiles, 'variable:removed', hasher);
    expect(result.state).toBe('absent');
    expect(result.fingerprint).toBe(await hasher.sha256(stableStringify({
      objectRef: 'variable:removed',
      state: 'absent',
    })));
  });

  it('fails loud for an unknown declared product', async () => {
    await expect(fingerprintWorkingObject(workingFiles, 'asset:bg/night', hasher))
      .rejects.toMatchObject({ code: 'COMPOSITION_REPLAY_FAILED' });
  });
});
