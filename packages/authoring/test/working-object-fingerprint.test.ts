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
  it.each(['_score', '好感', '𠮷', 'score.value$'])('fingerprints supported configuration keys without treating them as paths (%s)', async name => {
    const files = { 'game.config.json': JSON.stringify({ variables: { [name]: { type: 'number', initial: 1 } }, characters: { [name]: { name: '凛' } } }) };
    for (const kind of ['variable', 'character']) {
      expect((await fingerprintWorkingObject(files, `${kind}:${name}`, hasher)).state).toBe('present');
    }
  });

  it('resolves the unique nested timeline and rejects duplicate identities', async () => {
    const text = workingFiles['content/timelines/intro_opening.json']!;
    const nested = { 'content/timelines/chapter/intro_opening.json': text };
    expect(await fingerprintWorkingObject(nested, 'timeline:intro_opening', hasher)).toEqual(await fingerprintWorkingObject(workingFiles, 'timeline:intro_opening', hasher));
    await expect(fingerprintWorkingObject({ ...nested, 'content/timelines/intro_opening.json': text }, 'timeline:intro_opening', hasher)).rejects.toMatchObject({ code: 'OBJECT_AMBIGUOUS' });
  });
  it('uses a nested scene path without changing semantic identity or inventing a root file', async () => {
    const text = workingFiles['content/scenario/intro.gal']!;
    const nested = { 'content/scenario/chapter/intro.gal': text };
    expect(await fingerprintWorkingObject(nested, 'scene:intro', hasher)).toEqual(await fingerprintWorkingObject(workingFiles, 'scene:intro', hasher));
    expect((await fingerprintWorkingObject(nested, 'scene:missing', hasher)).state).toBe('absent');
    await expect(fingerprintWorkingObject(nested, 'scene:chapter/intro', hasher)).rejects.toMatchObject({ code: 'COMPOSITION_REPLAY_FAILED' });
    expect(nested).toEqual({ 'content/scenario/chapter/intro.gal': text });
  });

  it.each(['content/scenario/intro.gal', 'content/scenario/a/intro.gal'])('rejects a second basename instead of preferring %s', async (firstPath) => {
    const files = { [firstPath]: '@scene intro\n@end\n', 'content/scenario/b/intro.gal': '@scene intro\n凛：另一个文件。\n@end\n' };
    await expect(fingerprintWorkingObject(files, 'scene:intro', hasher)).rejects.toMatchObject({ code: 'OBJECT_AMBIGUOUS' });
  });

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
