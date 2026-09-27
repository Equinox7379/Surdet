import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuthoringService } from '../src/authoring/authoring-service.js';
import { NodeLocalLeaseManager } from '../src/authoring/node-local-lease.js';
import { NodeProjectStorage } from '../src/authoring/node-project-storage.js';

function makeRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeRoot(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

function writeFile(root: string, relativePath: string, contents: string | Uint8Array): string {
  const absolute = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
  return absolute;
}

describe('NodeProjectStorage asset file facts', () => {
  it('excludes only the asset-import workspace while keeping other .surdet files visible', async () => {
    const root = makeRoot('surdet-node-asset-import-exclusion-');
    const dataRoot = makeRoot('surdet-node-asset-import-exclusion-data-');
    try {
      writeFile(root, 'game.config.json', JSON.stringify({
        entryScene: 'asset_probe',
        characters: { lynn: { name: '凛', avatar: 'lynn' } },
        variables: {},
      }));
      writeFile(root, 'content/scenario/asset_probe.gal', '@scene asset_probe\n凛：你好。\n@end\n');
      writeFile(root, 'content/assets/bg/kept.png', new Uint8Array([1, 2, 3]));
      writeFile(root, '.surdet/other.json', '{"keep":true}');
      writeFile(root, '.surdet/asset-import/op-001/staged/internal-sentinel.bin', new Uint8Array([9, 8, 7]));

      const storage = await NodeProjectStorage.open(root);
      await expect(storage.listFiles()).resolves.toEqual([
        '.surdet/other.json',
        'content/assets/bg/kept.png',
        'content/scenario/asset_probe.gal',
        'game.config.json',
      ]);

      const service = new AuthoringService(undefined, new NodeLocalLeaseManager(dataRoot));
      const assets = await service.projectAssets(root);
      expect(assets.result.intelligence.items.map((item) => item.sourcePath)).not.toContain(
        '.surdet/asset-import/op-001/staged/internal-sentinel.bin',
      );
      expect(JSON.stringify(assets.result)).not.toContain('internal-sentinel');
      expect(assets.result.intelligence.items.find((item) => item.key === 'kept')?.bytes).toBe(3);
    } finally {
      removeRoot(root);
      removeRoot(dataRoot);
    }
  });

  it('returns sorted, de-duplicated metadata for nested regular files and preserves zero bytes', async () => {
    const root = makeRoot('surdet-node-asset-facts-');
    try {
      writeFile(root, 'content/assets/bg/z-last.webp', new Uint8Array([1, 2, 3, 4]));
      writeFile(root, 'content/assets/bg/nested/a-first.png', new Uint8Array([5, 6]));
      writeFile(root, 'content/assets/bg/empty.png', new Uint8Array());
      const storage = await NodeProjectStorage.open(root);

      const facts = await storage.inspectFileFacts([
        'content/assets/bg/z-last.webp',
        'content/assets/bg/nested/a-first.png',
        'content/assets/bg/empty.png',
        'content/assets/bg/z-last.webp',
      ]);

      expect(facts.map((fact) => fact.path)).toEqual([
        'content/assets/bg/empty.png',
        'content/assets/bg/nested/a-first.png',
        'content/assets/bg/z-last.webp',
      ]);
      expect(facts.find((fact) => fact.path.endsWith('/empty.png'))).toEqual({
        path: 'content/assets/bg/empty.png',
        bytes: 0,
      });
      expect(facts.find((fact) => fact.path.endsWith('/nested/a-first.png'))?.bytes).toBe(2);
      expect(facts.every((fact) => Object.keys(fact).sort().join(',') === 'bytes,path')).toBe(true);
      expect(JSON.stringify(facts)).not.toContain('contents');
      expect(JSON.stringify(facts)).not.toContain('base64');
    } finally {
      removeRoot(root);
    }
  });

  it('fails loudly when an enumerated file disappears before facts are read', async () => {
    const root = makeRoot('surdet-node-asset-facts-missing-');
    try {
      const target = writeFile(root, 'content/assets/bg/disappeared.webp', new Uint8Array([1, 2]));
      const storage = await NodeProjectStorage.open(root);
      fs.unlinkSync(target);
      await expect(storage.inspectFileFacts(['content/assets/bg/disappeared.webp']))
        .rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    } finally {
      removeRoot(root);
    }
  });

  it('rejects traversal and absolute paths without touching files outside the project', async () => {
    const root = makeRoot('surdet-node-asset-facts-paths-');
    const outside = makeRoot('surdet-node-asset-facts-outside-');
    const sentinel = writeFile(outside, 'sentinel.bin', new Uint8Array([9, 8, 7]));
    try {
      const storage = await NodeProjectStorage.open(root);
      await expect(storage.inspectFileFacts(['../escape.webp']))
        .rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
      await expect(storage.inspectFileFacts([path.join(outside, 'absolute.webp')]))
        .rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
      expect(fs.readFileSync(sentinel)).toEqual(Buffer.from([9, 8, 7]));
    } finally {
      removeRoot(root);
      removeRoot(outside);
    }
  });

  it('rejects a real symlink or junction escape when the host can create one', async () => {
    const root = makeRoot('surdet-node-asset-facts-link-');
    const outside = makeRoot('surdet-node-asset-facts-link-outside-');
    const link = path.join(root, 'content', 'assets', 'linked');
    try {
      writeFile(outside, 'escape.webp', new Uint8Array([1]));
      const storage = await NodeProjectStorage.open(root);
      let created = false;
      try {
        fs.mkdirSync(path.dirname(link), { recursive: true });
        fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
        created = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!['EACCES', 'EPERM', 'ENOTSUP', 'UNKNOWN'].includes(code ?? '')) throw error;
      }

      if (created) {
        await expect(storage.inspectFileFacts(['content/assets/linked/escape.webp']))
          .rejects.toMatchObject({ code: 'PATH_OUTSIDE_PROJECT' });
      }
    } finally {
      if (fs.existsSync(link)) fs.unlinkSync(link);
      removeRoot(root);
      removeRoot(outside);
    }
  });
});

describe('AuthoringService asset projection', () => {
  it('keeps catalog contents equal and their enclosing views explicit without absolute root leakage', async () => {
    const root = makeRoot('surdet-node-asset-service-');
    const dataRoot = makeRoot('surdet-node-asset-service-data-');
    try {
      writeFile(root, 'game.config.json', JSON.stringify({
        entryScene: 'asset_probe',
        characters: { lynn: { name: '凛', avatar: 'lynn' } },
        variables: {},
      }));
      writeFile(root, 'content/scenario/asset_probe.gal', '@scene asset_probe\n@bg used_backdrop\n凛：你好。\n@end\n');
      writeFile(root, 'content/assets/bg/used_backdrop.png', new Uint8Array([1, 2, 3]));
      writeFile(root, 'content/assets/bg/unused_backdrop.jpg', new Uint8Array([4, 5]));
      const service = new AuthoringService(undefined, new NodeLocalLeaseManager(dataRoot));

      const assets = await service.projectAssets(root);
      const inspected = await service.inspectProject(root);
      const { view, ...catalog } = assets.result;
      expect(view).toBe('project'); expect(inspected.result.view).toBe(view);
      expect(inspected.result.assets).toEqual(catalog);
      expect(JSON.stringify(assets.result)).not.toContain(root);
      expect(JSON.stringify(inspected.result.assets)).not.toContain(root);
      for (const item of assets.result.intelligence.items) {
        expect(item.sourcePath === undefined || !path.isAbsolute(item.sourcePath)).toBe(true);
      }
      expect(assets.result.intelligence.items.find((item) => item.key === 'used_backdrop')?.bytes).toBe(3);
    } finally {
      removeRoot(root);
      removeRoot(dataRoot);
    }
  });
});
