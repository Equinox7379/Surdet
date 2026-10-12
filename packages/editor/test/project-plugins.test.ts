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
  const DATA = 'data:text/javascript,export default 42';
  const found = (source: string) => pluginEntryDependencies(source).dependencies;
  it('finds import() in every call form, including a trailing comma and a second argument (31-REV-01)', () => {
    expect(found(`await import('${DATA}');`)).toEqual([DATA]);
    expect(found(`await import('${DATA}',);`)).toEqual([DATA]);
    expect(found(`await import('${DATA}', {});`)).toEqual([DATA]);
    expect(found(`await import('${DATA}' , { with: { type: 'json' } } );`)).toEqual([DATA]);
    expect(found(`await import(\n  '${DATA}',\n  {},\n);`)).toEqual([DATA]);
    expect(found('await import(/* where */ "./lazy.js");')).toEqual(['./lazy.js']);
    expect(found('const s = `${await import("./in-template.js")}`;')).toEqual(['./in-template.js']);
    // A specifier the source computes is still a load.
    expect(found('await import(name);')).toEqual(['（运行时计算的模块路径）']);
    expect(found('await import(`./${name}.js`);')).toEqual(['（运行时计算的模块路径）']);
  });
  it('finds static imports and re-exports, with or without attributes', () => {
    expect(found([
      "import { a } from './a.js';", "import 'side-effect';", 'import data from "./d.json" with { type: "json" };',
      "export * from 'pixi.js';", "export { b } from './b.js';", "import './a.js';",
    ].join('\n'))).toEqual(['./a.js', 'side-effect', './d.json', 'pixi.js', './b.js']);
  });
  it('does not count text that only looks like an import', () => {
    expect(found(ENTRY)).toEqual([]);
    expect(found([
      "// import('./line-comment.js')", "/* import x from './block-comment.js' */",
      `const a = "import('./double.js')", b = 'import y from "./single.js"', c = \`import('./template.js')\`;`,
      "const r = /import\\('.\\/regex.js'\\)/;", "const o = { import(x) { return x; } }; o.import('./member.js');",
      'export default [a, b, c, r, o, import.meta.url];',
    ].join('\n'))).toEqual([]);
  });
  it('refuses an entry the lexer cannot read, TypeScript, and any dependency, instead of guessing', () => {
    expect(pluginEntryDependencies("const s = 'unterminated").unlexable).toMatch(/Parse error/);
    const facts = (entry: string, source: string) => ({ entry, ...pluginEntryDependencies(source) });
    expect(pluginEntryLimit(facts('plugins/a.js', ENTRY))).toBeNull();
    expect(pluginEntryLimit(facts('plugins/a.ts', ENTRY))).toMatch(/TypeScript.*不会自动编译/);
    expect(pluginEntryLimit(facts('plugins/a.js', `await import('${DATA}', {});`))).toMatch(/入口引用了 data:text\/javascript/);
    expect(pluginEntryLimit(facts('plugins/a.js', 'export default (;'))).toMatch(/无法按 JavaScript 模块读取.*因此不运行/);
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
