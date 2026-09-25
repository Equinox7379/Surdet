import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

describe('desktop pack asset ownership', () => {
  it.each(['release', 'development'])('%s keeps the Web build intact and applies its media policy', (mode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-pack-test-'));
    const shell = path.join(root, 'shell'), game = path.join(root, 'game');
    fs.mkdirSync(path.join(shell, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(game, 'dist/assets'), { recursive: true });
    fs.mkdirSync(path.join(game, 'content/assets/bg'), { recursive: true });
    const media = Buffer.from('protected image bytes');
    const license = Buffer.from('\uFEFFCopyright fixture author\r\n许可原文。\r\n');
    fs.copyFileSync(new URL('../prepare-pack.mjs', import.meta.url), path.join(shell, 'prepare-pack.mjs'));
    fs.copyFileSync(new URL('../scripts/pack-policy.mjs', import.meta.url), path.join(shell, 'scripts/pack-policy.mjs'));
    fs.writeFileSync(path.join(game, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
    fs.writeFileSync(path.join(game, 'game.config.json'), JSON.stringify({ title: 'test', entryScene: 'start' }));
    fs.writeFileSync(path.join(game, 'content/assets/bg/room.png'), media);
    fs.writeFileSync(path.join(game, 'dist/assets/room-HASH.png'), media);
    fs.writeFileSync(path.join(game, 'dist/assets/app.js'), 'desktop uses asset IPC');
    fs.mkdirSync(path.join(game, 'content/assets/licenses'), { recursive: true });
    fs.writeFileSync(path.join(game, 'content/assets/licenses/LICENSE-font'), license);
    fs.writeFileSync(path.join(game, 'dist/assets/LICENSE-font-HASH'), license);
    fs.writeFileSync(path.join(game, 'dist/index.html'), '<script src="assets/app.js"></script>');
    try {
      const result = spawnSync(process.execPath, [path.join(shell, 'prepare-pack.mjs')], {
        env: { ...process.env, SURDET_GAME_DIR: game, SURDET_PACK_MODE: mode, SURDET_ENCRYPT: mode === 'release' ? '1' : '0' },
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      const staged = path.join(shell, '.pack-stage/game');
      expect(fs.readFileSync(path.join(game, 'dist/assets/room-HASH.png'))).toEqual(media);
      expect(fs.readFileSync(path.join(staged, 'assets/app.js'), 'utf8')).toBe('desktop uses asset IPC');
      // Companion text in the normal Web collection remains readable even
      // when desktop runtime copies are encrypted under the existing policy.
      expect(fs.readFileSync(path.join(staged, 'assets/LICENSE-font-HASH'))).toEqual(license);
      expect(fs.readFileSync(path.join(game, 'dist/assets/LICENSE-font-HASH'))).toEqual(license);
      expect(fs.existsSync(path.join(staged, 'assets/room-HASH.png'))).toBe(mode !== 'release');
      const packaged = fs.readFileSync(path.join(staged, 'content/assets/bg/room.png'));
      if (mode === 'release') {
        expect(packaged.subarray(0, 5).toString()).toBe('SDAT2');
        const key = Buffer.from(fs.readFileSync(path.join(staged, '.skey'), 'utf8'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, packaged.subarray(5, 17));
        decipher.setAuthTag(packaged.subarray(17, 33));
        expect(Buffer.concat([decipher.update(packaged.subarray(33)), decipher.final()])).toEqual(media);
      } else expect(packaged).toEqual(media);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
