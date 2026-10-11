import { expect, it } from 'vitest';
import { gameIdentity } from '../src/game-identity.js';

it('isolates two game identities, independent of title/version/install folder', () => {
  expect(gameIdentity('surdet-game-a', 'D:/test')).not.toEqual(gameIdentity('surdet-game-b', 'D:/test'));
  expect(gameIdentity('surdet-game-a', 'D:/test')).toEqual(gameIdentity('surdet-game-a', 'D:/test'));
  expect(gameIdentity('surdet-game-a', 'D:/test').userData).toContain('surdet-game-a');
});
it.each(['../outside', 'Game', 'a/b', '', null])('rejects invalid persistent identity %s', id => {
  expect(() => gameIdentity(id, 'D:/test')).toThrow('稳定保存身份');
});
it('keeps the Windows application id within its 128-character limit', () => {
  expect(gameIdentity('a'.repeat(120), 'D:/test').appId.length).toBeLessThanOrEqual(128);
});
