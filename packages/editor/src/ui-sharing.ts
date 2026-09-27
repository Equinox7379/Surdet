import { projectUiAssetKeys, projectUiVariableNames, readProjectUi, resolveProjectTheme, resolveProjectFontPaths, projectThemeAssetKeys, THEME_TOKEN_GROUPS, type ProjectUiDocument, type ProjectUiNode, type ProjectUiPageId } from '@surdet/core';
import { buildAssetCatalog, validateUiAssets } from '@surdet/authoring';

type Json = Record<string, unknown>;
export interface UiShare {
  format: 'surdet-ui'; version: 1; kind: 'theme' | 'fragment';
  config: Json;
  variables: Record<string, { type: string }>;
  assets: Array<{ path: string; base64: string }>;
}
export interface ShareAsset { path: string; read(): Promise<File> }
const THEME_FIELDS = [...THEME_TOKEN_GROUPS, 'dialogSkin', 'buttonSkin', 'dialogHeightRatio', 'dialogMarginX', 'dialogMarginBottom'];
// Match the existing asset authority's supported import formats, not every image a browser can display.
const SAFE_ASSET = /^content\/assets\/(bg\/[^/\\:]+\.(?:png|jpg|jpeg|webp)|fonts\/[^/\\:]+\.(?:woff2|ttf|otf))$/i;
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('共享文件必须是数据对象');
  return value as Json;
}
function keys(value: Json, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('共享文件包含不支持的字段');
}
function safePath(path: string): void {
  if (!SAFE_ASSET.test(path) || /[\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => part === '.' || part === '..'))
    throw new Error(`共享素材路径不受支持：${path}`);
}
function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('共享素材编码无效');
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
function imageKeys(config: Json): string[] {
  const player = object(config.player ?? {});
  return [...new Set([...projectUiAssetKeys(readProjectUi(config)), ...projectThemeAssetKeys(resolveProjectTheme(config)), player.titleLogo, player.titleBackground].filter((key): key is string => typeof key === 'string' && key.length > 0))];
}

/** Only supported presentation fields and their actual resources leave the project. */
export async function exportUiShare(config: Json, assets: ShareAsset[], fragment?: { page: ProjectUiPageId; node: ProjectUiNode }): Promise<UiShare> {
  const output: Json = {};
  if (fragment) output.ui = { version: 1, pages: { [fragment.page]: fragment.node } };
  else {
    if (config.ui) output.ui = config.ui;
    if (config.theme) output.theme = Object.fromEntries(Object.entries(object(config.theme)).filter(([key]) => THEME_FIELDS.includes(key)));
    const player = object(config.player ?? {});
    output.player = Object.fromEntries(['titleLogo', 'titleBackground'].filter(key => player[key] !== undefined).map(key => [key, player[key]]));
  }
  // The default UI font is also a dependency, even without explicit fontRole.
  if (!fragment) output.fonts = { ...resolveProjectFontPaths(config) };
  const variables = Object.fromEntries(projectUiVariableNames(output.ui as ProjectUiDocument ?? null).map(name => {
    const declaration = object(object(config.variables ?? {})[name]);
    return [name, { type: String(declaration.type) }];
  }));
  const checked = { ...output, variables: config.variables ?? {} };
  const catalog = buildAssetCatalog(assets.map(asset => asset.path));
  validateUiAssets(readProjectUi(checked), catalog);
  const selected = new Map<string, ShareAsset>();
  for (const key of imageKeys(checked)) {
    const matches = catalog.backgrounds.filter(asset => asset.key === key && asset.resolved);
    if (matches.length !== 1) throw new Error(`共享图片缺失或重名：${key}`);
    const source = assets.find(asset => asset.path === matches[0]!.sourcePath);
    if (!source) throw new Error(`共享图片不可读取：${key}`);
    selected.set(`content/assets/bg/${source.path.split('/').at(-1)}`, source);
  }
  for (const [role, path] of Object.entries(fragment ? {} : resolveProjectFontPaths(config))) {
    const source = assets.find(asset => asset.path === path);
    if (!source) throw new Error(`共享字体不可读取：${path}`);
    const target = `content/assets/fonts/${path.split('/').at(-1)}`;
    if (selected.has(target) && selected.get(target)!.path !== path) throw new Error(`共享字体文件重名：${target}`);
    selected.set(target, source); (output.fonts as Json)[role] = target;
  }
  const files: UiShare['assets'] = [];
  for (const [path, source] of selected) {
    safePath(path); files.push({ path, base64: encode(new Uint8Array(await (await source.read()).arrayBuffer())) });
  }
  return { format: 'surdet-ui', version: 1, kind: fragment ? 'fragment' : 'theme', config: output, variables, assets: files };
}

/** Validate the complete package before proposing a draft or staging any asset. */
export function readUiShare(text: string, destination: Json): UiShare {
  const raw = object(JSON.parse(text)); keys(raw, ['format', 'version', 'kind', 'config', 'variables', 'assets']);
  if (raw.format !== 'surdet-ui' || raw.version !== 1 || !['theme', 'fragment'].includes(String(raw.kind))) throw new Error('不支持的 UI 共享格式或版本');
  const config = object(raw.config); keys(config, ['ui', 'theme', 'player', 'fonts']);
  const variables = object(raw.variables);
  const declared = object(destination.variables ?? {});
  for (const [name, value] of Object.entries(variables)) {
    const declaration = object(value); keys(declaration, ['type']);
    if (!Object.hasOwn(declared, name) || object(declared[name]).type !== declaration.type) throw new Error(`请先声明同类型的目标变量：${name}`);
  }
  if (config.theme !== undefined) keys(object(config.theme), THEME_FIELDS);
  if (config.player !== undefined) {
    const player = object(config.player); keys(player, ['titleLogo', 'titleBackground']);
    for (const value of Object.values(player)) if (typeof value !== 'string') throw new Error('共享标题资源必须是素材键');
  }
  const fonts = object(config.fonts ?? {}); keys(fonts, ['body', 'title', 'ui']);
  for (const value of Object.values(fonts)) { if (typeof value !== 'string') throw new Error('共享字体路径无效'); safePath(value); if (!value.startsWith('content/assets/fonts/')) throw new Error('共享字体路径无效'); }
  const checked = { ...config, variables: declared };
  const ui = readProjectUi(checked); resolveProjectTheme(checked);
  const referenced = projectUiVariableNames(ui);
  if (referenced.some(name => !Object.hasOwn(variables, name)) || Object.keys(variables).some(name => !referenced.includes(name))) throw new Error('共享变量依赖与界面不一致');
  if (raw.kind === 'fragment' && (!ui || Object.keys(ui.pages).length !== 1 || config.theme !== undefined || config.player !== undefined || Object.keys(fonts).length > 0)) throw new Error('片段只能包含一个页面的组件，并继承目标主题/字体');
  if (!Array.isArray(raw.assets)) throw new Error('共享素材列表无效');
  const paths = new Set<string>();
  const neededImages = imageKeys(checked), neededFonts = new Set(Object.values(fonts));
  for (const value of raw.assets) {
    const file = object(value); keys(file, ['path', 'base64']);
    if (typeof file.path !== 'string' || typeof file.base64 !== 'string') throw new Error('共享素材数据无效');
    safePath(file.path);
    if (paths.has(file.path.toLowerCase())) throw new Error('共享素材路径重名');
    paths.add(file.path.toLowerCase()); decode(file.base64);
    const key = file.path.split('/').at(-1)!.replace(/\.[^.]+$/, '');
    if (!(file.path.startsWith('content/assets/bg/') ? neededImages.includes(key) : neededFonts.has(file.path))) throw new Error('共享包包含无关素材');
  }
  const catalog = buildAssetCatalog((raw.assets as UiShare['assets']).map(asset => asset.path));
  validateUiAssets(ui, catalog);
  for (const key of neededImages) if (catalog.backgrounds.filter(asset => asset.key === key).length !== 1) throw new Error(`共享图片依赖不完整：${key}`);
  for (const path of neededFonts) if (!paths.has(String(path).toLowerCase())) throw new Error(`共享字体依赖不完整：${path}`);
  return raw as unknown as UiShare;
}

/** Missing files enter the existing import workbench; differing existing resources are never overwritten. */
export async function missingUiShareAssets(share: UiShare, assets: ShareAsset[]): Promise<File[]> {
  const catalog = buildAssetCatalog(assets.map(asset => asset.path));
  const missing: File[] = [];
  for (const bundled of share.assets) {
    const bytes = decode(bundled.base64);
    const key = bundled.path.split('/').at(-1)!.replace(/\.[^.]+$/, '');
    const matches = bundled.path.startsWith('content/assets/bg/') ? catalog.backgrounds.filter(asset => asset.key === key) : [];
    if (matches.length > 1) throw new Error(`目标图片重名：${key}`);
    const existing = assets.find(asset => asset.path.toLowerCase() === (matches[0]?.sourcePath ?? bundled.path).toLowerCase());
    if (existing) {
      const current = new Uint8Array(await (await existing.read()).arrayBuffer());
      if (current.length !== bytes.length || current.some((value, index) => value !== bytes[index])) throw new Error(`目标素材内容冲突，未覆盖：${bundled.path}`);
    } else missing.push(new File([bytes], bundled.path.split('/').at(-1)!));
  }
  return missing;
}

export function copySharedFragment(node: ProjectUiNode, prefix: string): ProjectUiNode {
  return { ...node, id: `${prefix}_${node.id}`, ...(node.children ? { children: node.children.map(child => copySharedFragment(child, prefix)) } : {}) };
}
