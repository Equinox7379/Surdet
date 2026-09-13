import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../check-repo-hygiene.mjs', import.meta.url));

for (const mode of ['--tracked', '--staged']) {
  for (const [filename, expected] of [['trace.log', 1], ['调试 记录.log', 1], ['正常 文件.md', 0]]) {
    test(`hygiene ${mode} reads the literal Git path ${filename}`, () => {
      const root = mkdtempSync(path.join(tmpdir(), 'surdet-hygiene-'));
      try {
        const git = (...args) => {
          const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
          assert.equal(result.status, 0, result.stderr || result.error?.message);
        };
        git('init', '--quiet');
        writeFileSync(path.join(root, filename), 'fixture\n');
        git('add', '--', filename);
        const result = spawnSync(process.execPath, [script, mode], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, expected, result.stdout + result.stderr);
        if (expected === 1) assert.ok(result.stderr.includes(filename), result.stderr);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
