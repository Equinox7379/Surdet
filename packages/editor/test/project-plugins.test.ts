import { describe, expect, it } from 'vitest';
import type { ProjectPluginDeclaration } from '@surdet/core';
import {
  pluginEntryDependencies, pluginEntryLimit, pluginStatuses, previewPluginSources, readPluginDeclarations, revokePlugin, trustPlugin, trustedPluginHash,
} from '../src/project-plugins.js';
import { previewTextHash } from '../src/preview-content.js';
import { pluginInstructionText, pluginStatusText } from '../src/panels/preview-plugins-section.js';

/** A directory handle over in-memory files, enough for the entry reads the Editor makes. */
function directory(files: Record<string, string>, name = 'project'): FileSystemDirectoryHandle {
  const at = (prefix: string): FileSystemDirectoryHandle => ({
    name,
    getDirectoryHandle: async (part: string) => {
      const next = `${prefix}${part}/`;
      if (!Object.keys(files).some(path => path.startsWith(next))) throw new Error(`没有目录 ${part}`);
      return at(next);
    },
    getFileHandle: async (part: string) => {
      const path = `${prefix}${part}`;
      if (!(path in files)) throw new Error(`没有文件 ${part}`);
      return { getFile: async () => new File([files[path]!], part) };
    },
  }) as unknown as FileSystemDirectoryHandle;
  return at('');
}

const letters: ProjectPluginDeclaration = {
  id: 'letters', entry: 'plugins/letters.js', apiVersion: 1, stateVersion: 1,
  instructions: [
    { name: 'letter_count', blocking: false, parameters: [{ name: 'amount', type: 'number' }] },
    { name: 'letter_panel', blocking: true, parameters: [], modifiers: [{ name: 'title', type: 'string', optional: true }] },
  ],
};
const ENTRY = 'export default () => ({ apiVersion: 1, instructions: {} });\n';

describe('plugin declarations', () => {
  it('reads the config list through Core and reports an invalid list as it is', () => {
    expect(readPluginDeclarations('{"title":"x"}')).toEqual({ declarations: [], error: null });
    expect(readPluginDeclarations(JSON.stringify({ plugins: [letters] })).declarations).toEqual([letters]);
    expect(readPluginDeclarations(JSON.stringify({ plugins: [{ ...letters, entry: '../evil.js' }] })).error).toMatch(/entry/);
  });
  it('describes instructions and states in the words an author reads', () => {
    expect(pluginInstructionText(letters.instructions[0]!)).toBe('@letter_count amount（数字） — 立即完成');
    expect(pluginInstructionText(letters.instructions[1]!)).toBe('@letter_panel @title（文字，可省略） — 等插件界面完成后继续');
    expect(pluginStatusText(undefined)).toMatch(/未启用/);
    expect(pluginStatusText({ kind: 'trusted', sha256: 'abcdef0123456789' })).toMatch(/abcdef012345…/);
    expect(pluginStatusText({ kind: 'changed' })).toMatch(/自动停用/);
  });
});

describe('entries the Editor preview can run', () => {
  it('finds imports, re-exports and dynamic imports, but not words in comments', () => {
    expect(pluginEntryDependencies(ENTRY)).toEqual([]);
    expect(pluginEntryDependencies([
      "import { a } from './a.js';", "import 'side-effect';", "export * from \"pixi.js\";",
      "const x = await import('./lazy.js');", '// import nope from "comment"', '/* import("block") */',
    ].join('\n'))).toEqual(['./a.js', 'side-effect', 'pixi.js', './lazy.js']);
    expect(pluginEntryDependencies('const m = await import(name);')).toEqual(['（运行时计算的模块路径）']);
  });
  it('refuses TypeScript and any dependency instead of compiling or installing', () => {
    expect(pluginEntryLimit('plugins/a.js', [])).toBeNull();
    expect(pluginEntryLimit('plugins/a.ts', [])).toMatch(/TypeScript.*不会自动编译/);
    expect(pluginEntryLimit('plugins/a.js', ['./b.js'])).toMatch(/\.\/b\.js/);
  });
});

describe('trust for one directory and one code text', () => {
  it('sends nothing until a person confirms, then exactly the confirmed text', async () => {
    const root = directory({ 'plugins/letters.js': ENTRY });
    expect(await previewPluginSources(root, [letters])).toEqual({ sources: [], statuses: new Map([['letters', { kind: 'off' }]]) });
    const sha256 = await previewTextHash(ENTRY);
    trustPlugin(root, 'letters', sha256);
    expect(pluginStatuses(root, [letters])).toEqual(new Map([['letters', { kind: 'trusted', sha256 }]]));
    expect(await previewPluginSources(root, [letters])).toEqual({
      sources: [{ id: 'letters', entry: 'plugins/letters.js', source: ENTRY }], statuses: new Map([['letters', { kind: 'trusted', sha256 }]]) });
    // Another directory with the same files holds no trust.
    expect((await previewPluginSources(directory({ 'plugins/letters.js': ENTRY }), [letters])).sources).toEqual([]);
    expect(trustedPluginHash(null, 'letters')).toBeNull();
  });
  it('withdraws trust when the code changes, and says why until confirmed again', async () => {
    const files = { 'plugins/letters.js': ENTRY };
    const root = directory(files);
    trustPlugin(root, 'letters', await previewTextHash(ENTRY));
    files['plugins/letters.js'] = `${ENTRY}// changed\n`;
    expect(await previewPluginSources(root, [letters])).toEqual({ sources: [], statuses: new Map([['letters', { kind: 'changed' }]]) });
    expect(trustedPluginHash(root, 'letters')).toBeNull();
    // Changing it back does not restore trust by itself.
    files['plugins/letters.js'] = ENTRY;
    expect((await previewPluginSources(root, [letters])).statuses.get('letters')).toEqual({ kind: 'changed' });
    trustPlugin(root, 'letters', await previewTextHash(ENTRY));
    expect((await previewPluginSources(root, [letters])).sources).toHaveLength(1);
    revokePlugin(root, 'letters');
    expect(pluginStatuses(root, [letters]).get('letters')).toEqual({ kind: 'off' });
  });
  it('withdraws trust from an entry that is missing or gained a dependency', async () => {
    const files: Record<string, string> = { 'plugins/letters.js': ENTRY };
    const root = directory(files);
    trustPlugin(root, 'letters', await previewTextHash(ENTRY));
    files['plugins/letters.js'] = `import './helper.js';\n${ENTRY}`;
    const unsupported = (await previewPluginSources(root, [letters])).statuses.get('letters');
    expect(unsupported).toMatchObject({ kind: 'unsupported' });
    trustPlugin(root, 'letters', await previewTextHash(ENTRY));
    delete files['plugins/letters.js'];
    const result = await previewPluginSources(root, [letters]);
    expect(result.sources).toEqual([]);
    expect(result.statuses.get('letters')).toMatchObject({ kind: 'unreadable', reason: expect.stringMatching(/plugins\/letters\.js 无法读取/) });
  });
});
