import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createCipheriv } from 'node:crypto';
import * as asar from '@electron/asar';
import * as ResEdit from 'resedit';
import ts from 'typescript';
import { compileScene, sourceErrorIssue, SourceError, readProjectPlugins, type LintIssue } from '@surdet/core';
import { lintProject } from './lint.js';
import { AuthoringService } from './authoring/authoring-service.js';

export interface WindowsExportOptions {
  projectRoot: string;
  outputParent: string;
  folderName: string;
  title?: string;
  version?: string;
  /** Project-relative PNG/ICO; never an arbitrary renderer-provided local file. */
  icon?: string;
  encrypted?: boolean;
  /** Explicit permission for each declared project plugin, not config.enabled. */
  trustedPlugins?: string[];
  runtime: { directory: string; executable: string; gameRuntime: string; templates: string };
  signal?: AbortSignal;
  onProgress?: (progress: WindowsExportProgress) => void;
}
export interface WindowsExportProgress { phase: 'checking' | 'runtime' | 'content' | 'archive' | 'verify' | 'complete'; completed: number; total: number }
export interface WindowsExportInspection { id: string; title: string; version: string; issues: LintIssue[]; plugins: { id: string; entry: string }[] }
export interface WindowsExportResult { directory: string; executable: string; id: string; title: string; version: string }

const safeChild = (name: string): boolean => !!name && name.length <= 120 && !/[<>:"/\\|?*\x00-\x1f\x7f]/.test(name)
  && !/[. ]$/.test(name) && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name);
const json = (bytes: Uint8Array) => JSON.parse(Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, ''));
const knownImports = new Set(['@surdet/core', '@surdet/renderer', '@surdet/host', 'pixi.js']);
function inside(root: string, file: string): boolean {
  const rel = path.relative(root, file);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
async function exists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Reject links before lint or copying; no project build scripts are evaluated. */
async function projectFiles(root: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const walk = async (file: string): Promise<void> => {
    const full = path.join(root, file), stat = await fs.lstat(full);
    if (stat.isSymbolicLink()) throw new Error(`导出不接受链接文件或目录：${file}`);
    if (!inside(root, await fs.realpath(full))) throw new Error(`导出文件超出项目：${file}`);
    if (stat.isDirectory()) for (const child of (await fs.readdir(full)).sort()) await walk(`${file}/${child}`);
    else if (stat.isFile()) files.set(file, await fs.readFile(full));
    else throw new Error(`不能导出此文件：${file}`);
  };
  for (const file of ['package.json', 'game.config.json', 'content', 'public', 'plugins', 'src/main.ts', 'src/scene-hmr-boundary.ts'])
    if (await exists(path.join(root, file))) await walk(file);
  return files;
}

async function readExportProject(root: string, templates: string) {
  const files = await projectFiles(root);
  if (!files.has('package.json') || !files.has('game.config.json')) throw new Error('项目缺少package.json或game.config.json。');
  const pkg = json(files.get('package.json')!), config = json(files.get('game.config.json')!);
  if (typeof pkg.name !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,119}$/.test(pkg.name) || !safeChild(pkg.name)) throw new Error('项目名称不能作为稳定的Windows存档身份，请修正package.json.name。');
  if (typeof config.title !== 'string' || !config.title.trim()) throw new Error('作品标题不能为空。');
  if (typeof config.entryScene !== 'string' || !config.entryScene) throw new Error('作品缺少入口场景。');
  // A customized entry cannot silently lose its theme, systems or arbitrary code.
  for (const entry of ['src/main.ts', 'src/scene-hmr-boundary.ts']) if (files.has(entry)) {
    const canonical = await fs.readFile(path.join(templates, 'game', entry), 'utf8');
    if (files.get(entry)!.toString('utf8').replaceAll('\r\n', '\n').trim() !== canonical.replaceAll('\r\n', '\n').trim())
      throw new Error(`项目改过${entry}，不能用通用入口导出。请将自定义行为移入声明的项目插件；原开发者Web构建不变。`);
  }
  const plugins = readProjectPlugins(config);
  const lint = lintProject(root);
  const issues = lint.issues;
  // Compile with precisely the generic Player's declared handlers. A historical
  // customInstructions list is not a loader or permission to execute an extension.
  const instructions = plugins.flatMap(plugin => plugin.instructions.map(instruction => instruction.name));
  for (const [file, bytes] of files) if (/^content\/scenario\/.*\.gal$/i.test(file)) {
    try {
      const compiled = compileScene(bytes.toString('utf8'), file, path.posix.basename(file).replace(/\.gal$/i, ''), instructions);
      for (const diagnostic of compiled.diagnostics) if (diagnostic.code === 'W001' || diagnostic.code === 'W002')
        issues.push({ severity: 'error', code: 'EXPORT_UNAVAILABLE_INSTRUCTION', file, line: diagnostic.line, col: diagnostic.col,
          text: `${diagnostic.message}；通用运行时没有对应的已实现或声明插件处理器。` });
    }
    catch (error) { issues.push(error instanceof SourceError ? sourceErrorIssue(error, file)
      : { severity: 'error', code: 'EXPORT_COMPILE', file, line: 0, col: 0, text: error instanceof Error ? error.message : String(error) }); }
  }
  // Reuse the public asset analysis for voice/music/fonts/UI and actual aliases.
  // The lint result already reports parse errors; do not obscure them with an
  // attempted asset snapshot of an unparseable scene.
  if (!issues.some(issue => issue.severity === 'error')) {
    const assets = (await new AuthoringService().projectAssets(root)).result.intelligence;
    for (const issue of assets.issues) if (issue.code !== 'ASSET_UNUSED') issues.push({ severity: issue.severity === 'error' || issue.referenceIds.length > 0 ? 'error' : 'warning', code: issue.code,
      file: 'content/assets', line: 0, col: 0, text: issue.message });
  }
  if (lint.sceneCount === 0) issues.push({ severity: 'error', code: 'EXPORT_EMPTY', file: 'content/scenario', line: 0, col: 0, text: '项目没有可导出的场景。' });
  for (const file of files.keys()) if (/^content\/assets\/fonts\/.*\.(woff2?|ttf|otf)$/i.test(file)) {
    const directory = path.posix.dirname(file);
    if (![...files.keys()].some(other => path.posix.dirname(other) === directory && /(?:license|licence|ofl|notice|copying)/i.test(path.posix.basename(other))))
      issues.push({ severity: 'error', code: 'FONT_LICENSE', file, line: 0, col: 0, text: '字体目录缺少许可或来源说明，请先补齐字体分发许可。' });
  }
  return { files, pkg, config, plugins, issues };
}

export async function inspectWindowsExport(projectRoot: string, templates: string): Promise<WindowsExportInspection> {
  const project = await readExportProject(await fs.realpath(projectRoot), templates);
  return { id: project.pkg.name, title: project.config.title, version: typeof project.pkg.version === 'string' ? project.pkg.version : '', issues: project.issues,
    plugins: project.plugins.map(({ id, entry }) => ({ id, entry })) };
}

function pluginJavascript(file: string, bytes: Buffer, files: Map<string, Buffer>): string {
  const source = bytes.toString('utf8'), parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const checkImport = (node: ts.Expression) => {
    if (!ts.isStringLiteralLike(node)) throw new Error(`插件${file}含动态计算的模块路径，请使用显式相对导入。`);
    const specifier = node.text;
    if (knownImports.has(specifier)) return;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error(`插件${file}依赖未随运行时提供的模块：${specifier}`);
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    const emitted = resolved.replace(/\.ts$/, '.js');
    if (!resolved.startsWith('plugins/') || !/\.(js|ts)$/.test(resolved)
      || ![...files.keys()].some(source => source.replace(/\.ts$/, '.js') === emitted)) throw new Error(`插件${file}导入目标不存在或超出plugins目录：${specifier}`);
    if (specifier.endsWith('.ts')) replacements.push({ start: node.getStart(parsed), end: node.end, text: JSON.stringify(specifier.replace(/\.ts$/, '.js')) });
  };
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) checkImport(node.moduleSpecifier);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (!node.arguments[0]) throw new Error(`插件${file}含无效导入`);
      checkImport(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  let rewritten = source;
  for (const edit of replacements.sort((a, b) => b.start - a.start)) rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
  const result = ts.transpileModule(rewritten, { fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true } });
  if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw new Error(`插件${file}不能转换成浏览器模块。`);
  return result.outputText;
}

function executableResources(bytes: Buffer, title: string, version: string, executable: string, icon?: Buffer): Buffer {
  // Rebranding produces an unsigned game, never a falsely retained Electron signature.
  const binary = ResEdit.NtExecutable.from(bytes, { ignoreCert: true }), resources = ResEdit.NtExecutableResource.from(binary);
  const info = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)[0] ?? ResEdit.Resource.VersionInfo.createEmpty();
  info.setFileVersion(version); info.setProductVersion(version);
  info.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: title, ProductName: title, InternalName: executable,
    OriginalFilename: executable, CompanyName: '', LegalCopyright: '' });
  info.outputToResourceEntries(resources.entries);
  if (icon) {
    const icons = icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? (() => { const width = icon.readUInt32BE(16), height = icon.readUInt32BE(20);
        if (width < 16 || width > 256 || width !== height) throw new Error('PNG图标必须是16至256像素的正方形。');
        return [new ResEdit.Data.RawIconItem(icon, width, height, 32)]; })()
      : ResEdit.Data.IconFile.from(icon).icons.map(item => item.data);
    if (icons.length === 0) throw new Error('图标文件没有可用图像。');
    for (const group of ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries))
      ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
  }
  resources.outputResource(binary);
  return Buffer.from(binary.generate());
}

/** Portable Windows folder; all writes go to one owned staging directory. */
export async function exportWindowsGame(options: WindowsExportOptions): Promise<WindowsExportResult> {
  const checkCancel = () => options.signal?.throwIfAborted();
  const progress = (phase: WindowsExportProgress['phase'], completed = 0, total = 1) => {
    checkCancel(); options.onProgress?.({ phase, completed, total }); checkCancel();
  };
  progress('checking');
  if (!safeChild(options.folderName)) throw new Error('输出文件夹名称不能使用Windows保留名称或非法字符。');
  const root = await fs.realpath(options.projectRoot), parent = await fs.realpath(options.outputParent);
  const parentFacts = await fs.stat(parent, { bigint: true });
  if (!parentFacts.isDirectory()) throw new Error('请选择可写的导出文件夹，不能使用文件作为导出位置。');
  const checkParent = async () => {
    const current = await fs.lstat(parent, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== parentFacts.dev || current.ino !== parentFacts.ino || current.birthtimeNs !== parentFacts.birthtimeNs)
      throw new Error('导出位置已被替换，请重新选择。');
  };
  if (inside(root, parent)) throw new Error('输出位置不能在项目内部。');
  const output = path.join(parent, options.folderName);
  if (await exists(output)) throw new Error('输出文件夹已存在；不会覆盖已有文件，请换一个文件夹名称。');
  const project = await readExportProject(root, options.runtime.templates);
  const blockers = project.issues.filter(issue => issue.severity === 'error' || /(?:ASSET_UNRESOLVED|ASSET_MISSING)/.test(issue.code));
  if (blockers.length) throw new Error(`导出检查未通过：${blockers.map(issue => `${issue.file}:${issue.line} ${issue.text}`).join('\n')}`);
  const title = options.title?.trim() ?? project.config.title;
  if (!title || title.length > 200 || /[\x00-\x1f]/.test(title)) throw new Error('作品标题须为1至200字。');
  const version = options.version ?? project.pkg.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version) || version.split('.').some(value => +value > 65535)) throw new Error('Windows版本须为0至65535的三段或四段数字。');
  const trusted = options.trustedPlugins ?? [];
  if (trusted.length !== new Set(trusted).size || trusted.some(id => !project.plugins.some(plugin => plugin.id === id))
    || project.plugins.some(plugin => !trusted.includes(plugin.id))) throw new Error('请明确确认全部已声明插件后再导出；声明本身不授权执行代码。');
  const files = project.files;
  if ([...files.keys()].some(file => file.startsWith('public/'))) throw new Error('通用导出只接受content/assets素材，请将public素材移入标准素材目录并更新引用。');
  const icon = options.icon === undefined ? undefined : files.get(options.icon);
  if (options.icon !== undefined && (!icon || !/^content\/assets\/.*\.(png|ico)$/i.test(options.icon))) throw new Error('图标须是项目content/assets内的PNG或ICO文件。');
  const executable = `${safeChild(title) ? title : project.pkg.name}.exe`;
  // Resource editing is only applied to the copy, never to the Editor itself.
  const exe = executableResources(await fs.readFile(path.join(options.runtime.directory, options.runtime.executable)), title, version, executable, icon);
  const pluginFiles = new Map<string, string>();
  for (const [file, bytes] of files) if (/^plugins\/.*\.(js|ts)$/.test(file)) {
    const destination = file.replace(/\.ts$/, '.js');
    if (pluginFiles.has(destination)) throw new Error(`插件输出文件名冲突：${destination}`);
    pluginFiles.set(destination, pluginJavascript(file, bytes, files));
  }
  let staging: string | undefined;
  let stagingIdentity: Awaited<ReturnType<typeof fs.lstat>> | undefined;
  try {
    checkCancel();
    await checkParent();
    staging = await fs.mkdtemp(path.join(parent, '.surdet-export-'));
    stagingIdentity = await fs.lstat(staging);
    const bundle = path.join(staging, 'app'), portable = path.join(staging, 'portable');
    await fs.mkdir(portable);
    progress('runtime');
    for (const entry of await fs.readdir(options.runtime.directory, { withFileTypes: true })) {
      if (entry.name === 'locales' || entry.isFile() && /\.(dll|pak|dat|bin|json)$|^LICENSE(?:\.electron\.txt|S\.chromium\.html)?$/.test(entry.name))
        await fs.cp(path.join(options.runtime.directory, entry.name), path.join(portable, entry.name), { recursive: true });
      checkCancel();
    }
    await fs.writeFile(path.join(portable, executable), exe);
    await fs.mkdir(path.join(portable, 'resources'));
    await fs.cp(options.runtime.gameRuntime, bundle, { recursive: true });
    const game = path.join(bundle, 'game');
    const config = { ...project.config, title };
    const scenes: Record<string, string> = {}, timelines: Record<string, unknown> = {}, assets: string[] = [];
    const configs: Record<string, unknown> = {};
    const encrypted = options.encrypted ?? true, key = encrypted ? randomBytes(32) : undefined;
    progress('content', 0, files.size);
    let completed = 0;
    for (const [file, bytes] of files) {
      if (/^content\/scenario\/.*\.gal$/i.test(file)) scenes[file] = bytes.toString('utf8');
      if (/^content\/timelines\/.*\.json$/i.test(file)) timelines[file] = json(bytes);
      if (/^content\/config\/[^/]+\.json$/i.test(file)) configs[path.posix.basename(file, '.json')] = json(bytes);
      if (file.startsWith('content/')) {
        const destination = path.join(game, file); await fs.mkdir(path.dirname(destination), { recursive: true });
        if (file.startsWith('content/assets/')) {
          const rel = file.slice('content/assets/'.length); assets.push(rel);
          if (/(?:license|licence|ofl|notice|copying)/i.test(path.posix.basename(file))) {
            const license = path.join(portable, 'licenses/project', rel);
            await fs.mkdir(path.dirname(license), { recursive: true }); await fs.writeFile(license, bytes);
          }
          if (key) {
            const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
            const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
            await fs.writeFile(destination, Buffer.concat([Buffer.from('SDAT2'), iv, cipher.getAuthTag(), data]));
          } else await fs.writeFile(destination, bytes);
        } else await fs.writeFile(destination, bytes);
      }
      progress('content', ++completed, files.size);
    }
    for (const [file, source] of pluginFiles) {
      await fs.mkdir(path.dirname(path.join(game, file)), { recursive: true }); await fs.writeFile(path.join(game, file), source);
    }
    if (key) await fs.writeFile(path.join(game, '.skey'), key.toString('hex'));
    const systems = { calendar: configs.calendar, combat: configs.combat, affection: configs.events, ngp: configs.ngp,
      shop: configs.shop, growth: configs.growth, achievements: configs.achievements,
      scheduledEvents: (configs.events as { scheduled?: unknown } | undefined)?.scheduled };
    const manifest = { id: project.pkg.name, config, scenes, timelines, assets, gallery: configs.gallery, terminology: configs.terminology, systems, trustedPlugins: trusted };
    await fs.writeFile(path.join(game, 'content-manifest.json'), JSON.stringify(manifest));
    await fs.writeFile(path.join(game, 'game.config.json'), JSON.stringify(config));
    await fs.mkdir(path.join(game, 'release'), { recursive: true });
    await fs.writeFile(path.join(game, 'release/update-manifest.json'), JSON.stringify({ engine: 'surdet', game: project.pkg.name, version, channel: 'stable', notes: '' }));
    await fs.writeFile(path.join(game, 'release/pack-metadata.json'), JSON.stringify({ engine: 'surdet', game: project.pkg.name,
      version, title, entryScene: config.entryScene, sourceDirName: path.basename(root), assetFiles: [...assets].sort(), mode: encrypted ? 'release' : 'development', encrypted }));
    await fs.writeFile(path.join(bundle, 'package.json'), JSON.stringify({ name: project.pkg.name, version, productName: title, main: 'main.mjs', type: 'module', license: 'MIT' }));
    progress('archive');
    const archive = path.join(portable, 'resources/app.asar');
    await asar.createPackage(bundle, archive);
    progress('verify');
    const packaged = json(asar.extractFile(archive, 'package.json'));
    if (packaged.name !== project.pkg.name || packaged.version !== version) throw new Error('导出产物缺少作品身份。');
    for (const file of ['main.mjs', 'preload.cjs', 'game/index.html', 'game/content-manifest.json', ...assets.map(asset => `game/content/assets/${asset}`), ...pluginFiles.keys()].map(file => file.startsWith('plugins/') ? `game/${file}` : file))
      asar.statFile(archive, path.normalize(file));
    // A concurrent edit is not silently exported as a mix of two saved versions.
    const current = await projectFiles(root);
    if (current.size !== files.size || [...files].some(([file, bytes]) => !current.get(file)?.equals(bytes))) throw new Error('项目在导出期间被修改，请保存后重新导出。');
    checkCancel();
    await checkParent();
    if (await exists(output)) throw new Error('输出位置已被占用，不会覆盖。');
    await fs.rename(portable, output);
    // Publication is complete; a view closing now cannot cancel or undo the folder.
    try { options.onProgress?.({ phase: 'complete', completed: 1, total: 1 }); } catch { /* A notification is not the export result. */ }
    return { directory: output, executable: path.join(output, executable), id: project.pkg.name, title, version };
  } finally {
    // mkdtemp belongs to this invocation and is always an immediate child of parent.
    if (staging && path.dirname(staging) === parent && path.basename(staging).startsWith('.surdet-export-')) {
      const current = await fs.lstat(staging).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; });
      if (current && !current.isSymbolicLink() && current.dev === stagingIdentity?.dev && current.ino === stagingIdentity.ino && current.birthtimeMs === stagingIdentity.birthtimeMs)
        await fs.rm(staging, { recursive: true, force: true });
    }
  }
}
