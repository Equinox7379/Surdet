import { createStageWorkspace } from '../stage-workspace.js';
import { projectThemeAssetKeys, resolveProjectTheme, resolveProjectTitleLogo, type RuntimeDebugLocation } from '@surdet/core';
import { debugInstructionOptions, validDebugBreakpoints, normalizePreviewDebugState, type PreviewBreakpoint, type PreviewDebugState, type PreviewDebugCommand } from '../preview-debug.js';
import { describePreviewPath, normalizePreviewTargetState, type PreviewTargetRun, type PreviewTargetState } from '../preview-target.js';
import { createPreviewTargetSection, writableDeclarations } from './preview-target-section.js';
import '../styles/stage-workspace.css';
/**
 * 预览面板（M6 E4，父窗口侧）：iframe 承载 preview.html 运行器，
 * 工具条提供"从场景开头/从标签播放"、快进开关、重新播放。
 * 预览源 = 编辑器内存中的剧本文本（未保存也能预览）；全量场景一并下发，
 * 跨场景 @jump 在预览内可正常跳转（多场景预览）。
 */
import { state, h, setStatus } from '../state.js';
import { assertConfigSourcesReadable } from '../config-source.js';
import { parseScript } from '../model.js';
import { buildProjectAssetIntelligence, isPreviewSourcePath, loadProjectSnapshot, normalizePreviewTraceMessage, parseProjectConfigDocument, previewSourceText,
  type RuntimeTraceEvent, type PreviewTraceMessage, type PreviewTraceEventMessage,
  type ProjectSnapshot, type PreviewSourceFacts, type PreviewPublishInput, type PreviewContent, type PreviewContentOption, type PreviewContentTarget,
  type PreviewPathOptions, type PreviewPathReport } from '@surdet/authoring';
export { normalizePreviewTraceMessage, type PreviewTraceMessage, type PreviewTraceStartMessage,
  type PreviewTraceEventMessage, type PreviewTraceCompleteMessage } from '@surdet/authoring';
import { createEditorProjectStorage } from '../authoring-project-storage.js';
import { assetPathForHandle } from '../project-io.js';
import type { DirAsset } from '../assets.js';
import { editorPreviewPublisher, editorWorkspaceStatus } from '../editor-workspace.js';
import { inspectConfigDraftState, previewStageConfigText, previewThemeConfigText, previewUiConfigText, readUiConfigDraft, readStageConfigDraft, readThemeConfigDraft } from './config.js';
import { previewTextHash, projectPreviewContent } from '../preview-content.js';
import { previewCheckpointKey, readPreviewCheckpoint, writePreviewCheckpoint } from '../preview-checkpoints.js';
import { NO_READING_TRIAL, readingTrialScales, type ReadingTrial } from '../preview-reading-trial.js';
import type { FontRole } from '@surdet/renderer';
import { assertUniquePortraitBindings, portraitSourcePaths, resolveProjectPortraits, resolveProjectFontPaths, type PortraitVisualDefinition } from '@surdet/core';
import { normalizePreviewDiagnostic, type PreviewDiagnostic } from '../preview-diagnostics.js';
import { prepareStoryPreview, activateStoryPreview, appendStoryPreview, appendStoryPreviewError } from '../story-check.js';
import {
  dispatchPreviewTraceSelection,
  locateObjectForTraceEvent,
  locateTimelineCuesForStageChange,
  type CausalTraceEvent,
} from '../causal-selection.js';

/** 预览就绪监听器：模块级单例注册，避免反复进出预览标签页时监听器累积（M6 审阅轮 Minor 1） */
let previewReadyListenerBound = false;
let notifyPreviewReady: ((source: MessageEventSource | null) => void) | null = null;
let notifyPreviewDiagnostic: ((diagnostic: PreviewDiagnostic, source: MessageEventSource | null) => void) | null = null;
let notifyPreviewTrace: ((message: PreviewTraceMessage, source: MessageEventSource | null) => void) | null = null;
let previewPanelMountRevision = 0;
let publishedPreviewGeneration = 0;
let activePreviewCleanup: (() => void) | null = null;
let notifyPreviewSourceEdited: (() => void) | null = null;
let notifyPreviewDebug: ((message: PreviewDebugState, source: MessageEventSource | null) => void) | null = null;
let notifyPreviewTarget: ((message: PreviewTargetState, source: MessageEventSource | null) => void) | null = null;
let debugProjectRoot: typeof state.dirHandle | undefined;
let debugging = false;
let breakpoints: PreviewBreakpoint[] = [];
let debugContentKey = '';
/** Toolbar try-out of text size and motion; kept for this Editor session only. */
let readingTrial: ReadingTrial = NO_READING_TRIAL;

/** One actual runtime owner across script, standalone preview and result review. */
export function disposePreviewPanel(): void {
  previewPanelMountRevision += 1;
  const cleanup = activePreviewCleanup;
  activePreviewCleanup = null;
  notifyPreviewReady = null;
  notifyPreviewDiagnostic = null;
  notifyPreviewTrace = null;
  notifyPreviewSourceEdited = null;
  notifyPreviewDebug = null;
  notifyPreviewTarget = null;
  // Completed observations remain available when their source is opened.
  // Resource teardown must not erase the causal navigation's selected trace.
  cleanup?.();
}

export function refreshPreviewSourceState(): void { notifyPreviewSourceEdited?.(); }

/** 未绑定项目的内存预览使用本会话稳定键，避免用同名目录串用预览存档。 */
const transientPreviewProjectKey = `memory-session:${crypto.randomUUID()}`;

function previewSourceKey(): string {
  return JSON.stringify({
    scene: state.current,
    scenes: [...state.scenes.entries()].map(([key, entry]) => [key, entry.id, entry.file, entry.text]),
    config: state.gameConfigText,
    stageDraft: inspectConfigDraftState().dirtySections.includes('stage') ? readStageConfigDraft() : null,
    themeDraft: inspectConfigDraftState().dirtySections.includes('theme') ? readThemeConfigDraft() : null,
    uiDraft: inspectConfigDraftState().dirtySections.includes('ui') ? readUiConfigDraft() : null,
    configs: state.configFiles,
    configReadErrors: state.configReadErrors,
    timelines: state.timelines.map((entry) => [entry.file, entry.text]),
    assets: state.dirAssets.map((entry) => [entry.sourcePath, entry.key, entry.expr, entry.bytes, entry.lastModified]),
  });
}
function storyPreviewSourceKey(source = previewSourceKey()): string {
  const { scene: _scene, ...content } = JSON.parse(source);
  return JSON.stringify(content);
}
/** 父窗口只接受当前 iframe generation；旧预览的迟到消息必须丢弃。 */
export function acceptPreviewTraceMessage(message: PreviewTraceMessage | null, currentGeneration: number): PreviewTraceMessage | null {
  return message !== null && message.generation === currentGeneration ? message : null;
}

/** 所有 Preview bridge 消息都必须来自当前挂载 iframe。 */
export function isCurrentPreviewFrameSource(
  source: MessageEventSource | null,
  currentFrame: WindowProxy | null,
): boolean {
  return currentFrame !== null && source === currentFrame;
}

export interface PreviewTraceRowProjection {
  title: string;
  sourceLabel: string;
  technicalLabel: string;
}

const TRACE_KIND_LABELS: Record<RuntimeTraceEvent['kind'], string> = {
  instruction: '执行剧情指令',
  choice: '提供选择',
  state: '更新剧情状态',
  condition: '判断剧情条件',
  'control-flow': '切换剧情位置',
  'scene-end': '场景结束',
};

const INSTRUCTION_OP_LABELS: Readonly<Record<string, string>> = {
  instr: '执行剧情指令',
  label: '定位段落标记',
  text: '显示台词',
  bg: '切换背景',
  portrait: '调整立绘',
  timeline: '播放演出',
  bgm: '播放背景音乐',
  se: '播放音效',
  voice: '播放语音',
  wait: '等待剧情时间',
};

/** 界面使用中文动作；原始事件仍保留英文 kind/op 供工具读取。 */
export function projectPreviewTraceRow(message: PreviewTraceEventMessage): PreviewTraceRowProjection {
  const { kind, source } = message.event;
  const title = kind === 'instruction'
    ? INSTRUCTION_OP_LABELS[source.op] ?? TRACE_KIND_LABELS.instruction
    : TRACE_KIND_LABELS[kind] ?? '剧情事件';
  return {
    title,
    sourceLabel: `${source.sceneId} 场景 · 第 ${source.line} 行`,
    technicalLabel: `事件 ${message.sequence + 1} · ${TRACE_KIND_LABELS[kind] ?? '剧情事件'}`,
  };
}

let currentPreviewTrace: PreviewTraceMessage[] = [];

/** Task 7 展示用的当前预览轨迹快照；只返回当前 iframe 的浅拷贝。 */
export function getCurrentPreviewTrace(): readonly PreviewTraceMessage[] {
  return currentPreviewTrace.slice();
}

function bindPreviewReadyListenerOnce(): void {
  if (previewReadyListenerBound) return;
  previewReadyListenerBound = true;
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string } | null;
    if (d?.type === 'surdet-preview-ready') notifyPreviewReady?.(e.source);
    if (d?.type === 'surdet-preview-debug-state') {
      const debug = normalizePreviewDebugState(e.data);
      if (debug) notifyPreviewDebug?.(debug, e.source);
    }
    if (d?.type === 'surdet-preview-target-state') {
      const target = normalizePreviewTargetState(e.data);
      if (target) notifyPreviewTarget?.(target, e.source);
    }
    if (d?.type === 'surdet-preview-diagnostic') {
      const diagnostic = normalizePreviewDiagnostic((d as { diagnostic?: unknown }).diagnostic);
      if (diagnostic) notifyPreviewDiagnostic?.(diagnostic, e.source);
    }
    if (d?.type === 'surdet-preview-trace-start' || d?.type === 'surdet-preview-trace-event' || d?.type === 'surdet-preview-trace-complete') {
      const trace = normalizePreviewTraceMessage(e.data);
      if (trace) notifyPreviewTrace?.(trace, e.source);
    }
  });
}

/** 场景内的标签列表（"从标签播放"的跳转目标；纯函数可测） */
export function listLabels(text: string): string[] {
  const labels: string[] = [];
  for (const line of parseScript(text)) {
    if (line.kind === 'label') labels.push((line as { name: string }).name);
  }
  return labels;
}

/** 收集全量预览场景（内存文本，含未保存编辑；同 id 去重保留先到者；纯函数可测） */
export function collectPreviewScenes(scenes: Map<string, { id: string; text: string }>): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const sc of scenes.values()) {
    const id = sc.id.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text: sc.text });
  }
  return out;
}

/** 从 game.config.json 提取变量声明（预览运行时的 VariableStore 源；容错解析：非法/缺失返回空数组；纯函数可测）。
 *  没有它，真实剧本的 @set/@mod/@if/[if:] 在预览里会因变量未定义报运行时错误。 */
export function parsePreviewVariables(configText: string): Record<string, unknown>[] {
  let obj: Record<string, unknown>;
  try {
    obj = configText.trim() ? parseProjectConfigDocument(configText) : {};
  } catch {
    return [];
  }
  const vars = obj.variables;
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return [];
  const out: Record<string, unknown>[] = [];
  for (const [name, decl] of Object.entries(vars as Record<string, unknown>)) {
    if (!decl || typeof decl !== 'object' || Array.isArray(decl)) continue;
    out.push({ name, ...(decl as Record<string, unknown>) });
  }
  return out;
}

interface PreviewFont {
  buffer: ArrayBuffer;
  mime: string;
  /** 文件版本标识：替换同路径字体后不能命中旧缓存 */
  version: string;
  sourcePath?: string;
}

export function clonePreviewFontsForTransfer(
  fonts: Partial<Record<FontRole, PreviewFont>>,
): Partial<Record<FontRole, PreviewFont>> {
  const cloned: Partial<Record<FontRole, PreviewFont>> = {};
  for (const role of ['body', 'title', 'ui'] as FontRole[]) {
    const font = fonts[role];
    if (font === undefined) continue;
    cloned[role] = {
      ...font,
      buffer: font.buffer.slice(0),
    };
  }
  return cloned;
}

interface PreviewImage {
  buffer: ArrayBuffer;
  mime: string;
  sourcePath?: string;
}

interface PreviewAssets {
  videos: { key: string; file: PreviewImage }[];
  backgrounds: { key: string; image: PreviewImage }[];
  portraits: { charId: string; costume: string; expression: string; image: PreviewImage; configured?: true }[];
  visuals: { charId: string; costume: string; expression: string; definition: PortraitVisualDefinition; images: Record<string, PreviewImage> }[];
  avatars: { key: string; image: PreviewImage }[];
  rules: { key: string; image: PreviewImage }[];
  audio: { kind: 'bgm' | 'ambience' | 'se' | 'voice'; key: string; file: PreviewImage }[];
}

interface SpeakerProfile {
  id: string;
  name: string;
  avatarKey?: string;
}

function parsePreviewSpeakerProfiles(configText: string): SpeakerProfile[] {
  try {
    const cfg = parseProjectConfigDocument(configText);
    const chars = cfg.characters;
    if (!chars || typeof chars !== 'object' || Array.isArray(chars)) return [];
    return Object.entries(chars as Record<string, unknown>).flatMap(([id, raw]) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const item = raw as Record<string, unknown>;
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name) return [];
      const avatarKey = typeof item.avatar === 'string' ? item.avatar : id;
      return [{ id, name, ...(avatarKey ? { avatarKey } : {}) }];
    });
  } catch {
    return [];
  }
}

/** 从项目目录读取 game.config.json 的字体角色文件；旧版 font 自动作为三个角色的来源。 */
export async function readProjectFonts(configText: string, signal: AbortSignal, root: FileSystemDirectoryHandle | null): Promise<Partial<Record<FontRole, PreviewFont>>> {
  const cfg = configText.trim() ? parseProjectConfigDocument(configText) : {};
  if (!root) return {};
  const paths = resolveProjectFontPaths(cfg);
  if (Object.keys(paths).length === 0) return {};
  const MIME: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
  const result: Partial<Record<FontRole, PreviewFont>> = {};
  for (const role of ['body', 'title', 'ui'] as FontRole[]) {
    signal.throwIfAborted();
    const fontPath = paths[role];
    if (!fontPath) continue;
    const segs = fontPath.split('/').filter((s) => s.length > 0);
    const fname = segs.pop()!;
    let dir: FileSystemDirectoryHandle = root;
    try {
      for (const s of segs) { signal.throwIfAborted(); dir = await dir.getDirectoryHandle(s); }
      const file = await (await dir.getFileHandle(fname)).getFile();
      signal.throwIfAborted();
      // Metadata can survive replacement. Hash the bytes from this read before
      // the iframe decides whether its existing FontFace can be reused.
      const buffer = await file.arrayBuffer();
      signal.throwIfAborted();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      result[role] = { buffer, mime: MIME[ext] ?? 'font/ttf', sourcePath: fontPath,
        version: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
    }
    catch (error) { signal.throwIfAborted(); throw new Error(`字体读取失败：${fontPath}（${error instanceof Error ? error.message : String(error)}）`); }
  }
  return result;
}

/** 解析时间轴文本；单个坏文件隔离为 issue，合法定义继续进入预览。 */
export function parsePreviewTimelines(entries: readonly { id: string; text: string }[]): { definitions: unknown[]; issues: string[] } {
  const definitions: unknown[] = [];
  const issues: string[] = [];
  for (const entry of entries) {
    try {
      const value = JSON.parse(entry.text.replace(/^\uFEFF/, '')) as Record<string, unknown>;
      if (typeof value.id !== 'string' || value.id.trim().length === 0) {
        issues.push(`${entry.id}: 缺少时间轴标识`);
        continue;
      }
      definitions.push(value);
    } catch (err) {
      issues.push(`${entry.id}: JSON 解析失败（${err instanceof Error ? err.message : String(err)}）`);
    }
  }
  return { definitions, issues };
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
  gif: 'image/gif', avif: 'image/avif',
};
const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac',
};

/** Include all supplied scenes, timeline cues and configuration, not only the opening scene.
 * Keep the shared reference semantics; implicit speaker avatars are a preview runtime default. */
export function previewAssetPaths(snapshot: ProjectSnapshot, assets: readonly DirAsset[]): Set<string> {
  const facts = assets.flatMap(asset => {
    const path = asset.sourcePath ?? (asset.handle ? assetPathForHandle(asset.handle) : undefined);
    return path ? [{ path }] : [];
  });
  const index = buildProjectAssetIntelligence(snapshot, facts);
  const paths = new Set(index.items.filter(asset => asset.references.length > 0 && asset.sourcePath)
    .map(asset => asset.sourcePath!));
  const avatars = new Set(parsePreviewSpeakerProfiles(JSON.stringify(snapshot.config)).map(profile => profile.avatarKey));
  for (const asset of assets) if (asset.kind === 'avatar' && avatars.has(asset.key)) {
    const path = asset.sourcePath ?? (asset.handle ? assetPathForHandle(asset.handle) : undefined);
    if (path) paths.add(path);
  }
  return paths;
}

/** 读取项目目录中的背景和立绘字节。文件句柄不能跨 iframe 传递，只下发可结构化克隆的二进制数据。 */
export async function readProjectImages(configText: string, signal: AbortSignal, requiredPaths: ReadonlySet<string>, assetEntries: readonly DirAsset[]): Promise<PreviewAssets> {
  const backgrounds = new Map<string, { key: string; image: PreviewImage }>();
  const portraits = new Map<string, { charId: string; costume: string; expression: string; image: PreviewImage; configured?: true }>();
  const visualImages = new Map<string, PreviewImage>();
  const visuals: PreviewAssets['visuals'] = [];
  const avatars = new Map<string, { key: string; image: PreviewImage }>();
  const rules = new Map<string, { key: string; image: PreviewImage }>();
  const videos = new Map<string, { key: string; file: PreviewImage }>();
  const audio = new Map<string, { kind: 'bgm' | 'ambience' | 'se' | 'voice'; key: string; file: PreviewImage }>();
  const config = JSON.parse(configText.replace(/^\uFEFF/, '') || '{}');
  const bindings = resolveProjectPortraits(config, assetEntries.flatMap(asset => {
    const path = asset.sourcePath ?? (asset.handle ? assetPathForHandle(asset.handle) : undefined);
    return path === undefined ? [] : [path];
  }));
  assertUniquePortraitBindings(bindings);
  for (const asset of assetEntries) {
    signal.throwIfAborted();
    if (!asset.handle) continue;
    const sourcePath = asset.sourcePath ?? assetPathForHandle(asset.handle);
    if (!sourcePath || !requiredPaths.has(sourcePath) || asset.kind === 'font') continue;
    try {
      const file = await asset.handle.getFile();
      signal.throwIfAborted();
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      const buffer = await file.arrayBuffer();
      signal.throwIfAborted();
      if (asset.kind === 'video') {
        videos.set(asset.key, { key: asset.key, file: { buffer, mime: file.type || ({ mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg' }[ext]) || 'application/octet-stream', sourcePath } });
        continue;
      }
      if (asset.kind === 'bgm' || asset.kind === 'ambience' || asset.kind === 'se' || asset.kind === 'voice') {
        audio.set(`${asset.kind}:${asset.key}`, {
          kind: asset.kind,
          key: asset.key,
          file: { buffer, mime: file.type || AUDIO_MIME[ext] || 'application/octet-stream', sourcePath },
        });
        continue;
      }
      if (!asset.isImage || (asset.kind !== 'bg' && asset.kind !== 'rule' && asset.kind !== 'portrait' && asset.kind !== 'avatar')) continue;
      const image = { buffer, mime: file.type || IMAGE_MIME[ext] || 'application/octet-stream', sourcePath };
      if (asset.kind === 'bg') {
        backgrounds.set(asset.key, { key: asset.key, image });
        continue;
      }
      if (asset.kind === 'rule') {
        rules.set(asset.key, { key: asset.key, image });
        continue;
      }
      if (asset.kind === 'avatar') {
        avatars.set(asset.key, { key: asset.key, image });
        continue;
      }
      if (sourcePath) visualImages.set(sourcePath, image);
      for (const binding of bindings.filter(value => !value.visual && value.sourcePath === sourcePath)) {
        portraits.set(`${binding.role}:${binding.outfit}:${binding.expression}`, { charId: binding.role, costume: binding.outfit, expression: binding.expression, image,
          ...(binding.configured ? { configured: true } : {}) });
      }
    } catch (error) {
      signal.throwIfAborted();
      throw new Error(`素材读取失败：${sourcePath}（${error instanceof Error ? error.message : String(error)}）；恢复文件或权限后可重新播放。`);
    }
  }
  for (const binding of bindings) {
    if (!binding.configured && !portraitSourcePaths(binding).some(path => requiredPaths.has(path))) continue;
    if (binding.visual) {
      const images: Record<string, PreviewImage> = {};
      for (const path of portraitSourcePaths(binding)) {
        const image = visualImages.get(path);
        if (!image) throw new Error(`动态立绘文件不存在或不可读取：${path}`);
        images[path] = image;
      }
      visuals.push({ charId: binding.role, costume: binding.outfit, expression: binding.expression, definition: binding.visual, images });
      continue;
    }
    if (binding.configured && !portraits.has(`${binding.role}:${binding.outfit}:${binding.expression}`)) {
      throw new Error(`角色立绘文件不存在或不可读取：${binding.sourcePath}`);
    }
  }
  for (const key of [...projectThemeAssetKeys(resolveProjectTheme(config)), resolveProjectTitleLogo(config)].filter((key): key is string => Boolean(key))) {
    if (!backgrounds.has(key) || assetEntries.filter(asset => asset.kind === 'bg' && asset.key === key).length !== 1)
      throw new Error(`主题图片不存在、不唯一或不可读取：${key}`);
  }
  return { backgrounds: [...backgrounds.values()], portraits: [...portraits.values()], visuals, avatars: [...avatars.values()], rules: [...rules.values()], audio: [...audio.values()], videos: [...videos.values()] };
}

/** Fix one request's text, metadata and handles before the first resource await.
 * This is request-local data, not a cache; source-change guards still own publication. */
export function capturePreviewContent(projection?: Awaited<ReturnType<typeof projectPreviewContent>>) {
  const source = {
    ...state,
    scenes: new Map([...state.scenes].map(([key, scene]) => [key, { ...scene }])),
    timelines: state.timelines.map(timeline => ({ ...timeline })),
    dirAssets: state.dirAssets.map(asset => ({ ...asset })),
    configFiles: structuredClone(state.configFiles),
    configReadErrors: { ...state.configReadErrors },
    handles: { ...state.handles },
  };
  const sourceConfig = source.gameConfigText === '' && source.handles.gameConfig === null ? '{}' : source.gameConfigText;
  const configText = projection?.configText ?? previewUiConfigText(previewThemeConfigText(previewStageConfigText(sourceConfig)));
  return {
    root: source.dirHandle,
    assetEntries: source.dirAssets,
    storage: createEditorProjectStorage(source),
    snapshot: projection?.snapshot,
    configText,
    scenes: projection?.scenes ?? collectPreviewScenes(source.scenes),
    sourceScenes: projection?.scenes ?? [...source.scenes.values()],
    configs: projection?.configs ?? {
      calendar: source.configFiles.calendar ?? undefined,
      events: source.configFiles.events ?? undefined,
      growth: source.configFiles.growth ?? undefined,
      achievements: source.configFiles.achievements ?? undefined,
    },
    timelines: projection?.timelines ?? source.timelines,
    timelinePreviewId: projection === undefined ? source.previewTimelineId ?? undefined : undefined,
    choices: projection === undefined && source.previewChoices !== null ? { ...source.previewChoices } : undefined,
  };
}

/** The files this preview would play, for the shared path query: the same config, scenes, timelines and configs. */
export function previewQueryFiles(content: ReturnType<typeof capturePreviewContent>): Record<string, string> {
  const files: Record<string, string> = { 'game.config.json': content.configText };
  for (const scene of content.sourceScenes) files[scene.file.startsWith('content/scenario/') ? scene.file : `content/scenario/${scene.file}`] = scene.text;
  for (const timeline of content.timelines) {
    const file = 'file' in timeline ? String(timeline.file) : timeline.id;
    files[file.startsWith('content/timelines/') ? file : `content/timelines/${file}`] = timeline.text;
  }
  for (const [name, config] of Object.entries(content.configs)) if (config !== undefined) files[`content/config/${name}.json`] = JSON.stringify(config);
  return files;
}

/** Read only the captured request. It must not pick up another project's handles. */
export async function loadPreviewResources(content: ReturnType<typeof capturePreviewContent>, signal: AbortSignal) {
  signal.throwIfAborted();
  const snapshot = content.snapshot ?? await loadProjectSnapshot(content.storage, content.storage);
  signal.throwIfAborted();
  const requiredPaths = previewAssetPaths({ ...snapshot, config: parseProjectConfigDocument(content.configText) }, content.assetEntries);
  const cachedFonts = await readProjectFonts(content.configText, signal, content.root);
  const assets = await readProjectImages(content.configText, signal, requiredPaths, content.assetEntries);
  signal.throwIfAborted();
  return { cachedFonts, assets, timelineContent: parsePreviewTimelines(content.timelines) };
}

/** Hash the buffers actually sent to the iframe, before transferring their ownership. */
async function previewSourceFacts(assets: PreviewAssets, fonts: Partial<Record<FontRole, PreviewFont>>, storage: ReturnType<typeof createEditorProjectStorage>, content?: PreviewContent): Promise<PreviewSourceFacts> {
  const files = content === undefined
    ? await Promise.all((await storage.listFiles()).filter(isPreviewSourcePath).map(async path => ({ path,
      sha256: await storage.sha256(previewSourceText(path, (await storage.readText(path)).text)) })))
    : await Promise.all(Object.entries(content.files).filter(([path]) => isPreviewSourcePath(path)).map(async ([path, text]) => ({ path,
      sha256: await previewTextHash(previewSourceText(path, text)) })));
  const buffers = [...assets.backgrounds.map(value => value.image), ...assets.portraits.map(value => value.image),
    ...assets.visuals.flatMap(value => Object.values(value.images)),
    ...assets.avatars.map(value => value.image), ...assets.rules.map(value => value.image), ...assets.audio.map(value => value.file), ...assets.videos.map(value => value.file), ...Object.values(fonts)];
  const facts = await Promise.all(buffers.map(async value => {
    if (!value.sourcePath) throw new Error('无法核对预览素材来源，请重新加载项目。');
    const hash = await crypto.subtle.digest('SHA-256', value.buffer);
    return { path: value.sourcePath, sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
  }));
  const unique = new Map<string, { path: string; sha256: string }>();
  for (const fact of facts) {
    const prior = unique.get(fact.path);
    if (prior && prior.sha256 !== fact.sha256) throw new Error(`读取期间素材发生变化：${fact.path}`);
    unique.set(fact.path, fact);
  }
  return { files, assets: [...unique.values()] };
}

export interface PreviewPanelOptions {
  embedded?: boolean;
  onSourceStateChange?: () => void;
  onDebugSource?: (source: RuntimeDebugLocation) => void;
  /** "从这一行试玩": a one-based source line in the scene being edited. */
  target?: { sceneId: string; line: number };
}

/** A query result that reached its target, tied to the content it was found on. */
interface FoundTarget { report: PreviewPathReport; sourceKey: string; selected: PreviewContentTarget | null }

export function renderPreviewPanel(container: HTMLElement, options: PreviewPanelOptions = {}): void {
  if (!container.isConnected) return;
  disposePreviewPanel();
  state.previewTrace = [];
  state.selectedTraceStep = null;
  container.innerHTML = '';
  const mountRevision = ++previewPanelMountRevision;
  if (debugProjectRoot !== state.dirHandle) { debugProjectRoot = state.dirHandle; debugging = false; breakpoints = []; debugContentKey = ''; }
  let stageWorkbench: ReturnType<typeof createStageWorkspace> | undefined;
  if (state.reviewWorkspace === null) state.previewChoices = null;
  currentPreviewTrace = [];
  const sc = state.current ? state.scenes.get(state.current) : undefined;

  const workspace = h('div', 'preview-workspace');
  workspace.setAttribute('data-preview-layout', options.embedded === true ? 'embedded' : 'standalone');
  const toolbar = h('header', 'preview-toolbar');
  const title = h('h2', 'preview-title', '剧情预览');
  toolbar.appendChild(title);
  const controls = h('div', 'preview-controls');
  const reviewResult = state.reviewWorkspace?.projectHandle != null && state.reviewWorkspace.projectHandle === state.dirHandle
    ? state.reviewWorkspace : null;
  const reviewResultLabel = reviewResult === null ? null
    : `${reviewResult.fixtureChanged ? '审阅副本（已修改）' : state.reviewPreviewReadOnly ? '正式结果（只读）' : '审阅结果'}· ${reviewResult.identity.reviewId}`;
  let selectedTarget: PreviewContentTarget | null = null;
  let isolated: PreviewContent | undefined;
  let projected: Awaited<ReturnType<typeof projectPreviewContent>> | undefined;
  const sourceControl = h('label', 'preview-entry-control');
  sourceControl.appendChild(h('span', 'preview-control-label', '试玩内容'));
  const sourceSel = h('select');
  sourceSel.setAttribute('aria-label', '试玩内容');
  const memoryOption = h('option', undefined, reviewResultLabel ?? '当前编辑内容（含草稿）');
  memoryOption.value = '';
  sourceSel.appendChild(memoryOption);
  sourceSel.disabled = state.reviewWorkspace !== null;
  sourceControl.appendChild(sourceSel);
  controls.appendChild(sourceControl);
  const refreshSources = h('button', undefined, '刷新试玩列表');
  refreshSources.type = 'button';
  refreshSources.hidden = state.reviewWorkspace !== null;
  controls.appendChild(refreshSources);
  const sceneControl = h('label', 'preview-entry-control');
  sceneControl.appendChild(h('span', 'preview-control-label', '试玩场景'));
  const sceneSel = h('select');
  sceneSel.setAttribute('aria-label', '试玩场景');
  sceneControl.appendChild(sceneSel);
  sceneControl.hidden = true;
  controls.appendChild(sceneControl);
  let sourceOptions: PreviewContentOption[] = [];
  /** What a found start depends on: the content played, the editor text its line was picked in, and a selected version's revision. */
  const targetKey = (sceneId: string): string => JSON.stringify({ request: requestKey(),
    editing: [...state.scenes.values()].find(scene => scene.id === sceneId)?.text ?? null,
    content: selectedTarget === null ? null : isolated?.contentRevision ?? null });
  const targetStale = (found: FoundTarget): boolean => targetKey(found.report.target.sceneId) !== found.sourceKey;
  const requestKey = () => selectedTarget === null ? previewSourceKey() : JSON.stringify({ target: selectedTarget,
    scene: sceneSel.value, assets: state.dirAssets.map(asset => [asset.sourcePath, asset.key, asset.bytes, asset.lastModified]) });
  const entryControl = h('label', 'preview-entry-control');
  entryControl.appendChild(h('span', 'preview-control-label', '播放入口'));
  const labelSel = h('select');
  labelSel.setAttribute('aria-label', '播放入口');
  const fromStart = h('option', undefined, '从场景开头');
  fromStart.value = '';
  labelSel.appendChild(fromStart);
  if (sc) {
    for (const lb of listLabels(sc.text)) {
      const opt = h('option', undefined, `从段落标记 ${lb}`);
      opt.value = lb;
      labelSel.appendChild(opt);
    }
  }
  entryControl.appendChild(labelSel);
  controls.appendChild(entryControl);

  const fastWrap = h('label', 'preview-fast');
  const fastChk = h('input');
  fastChk.type = 'checkbox';
  fastChk.checked = true;
  fastWrap.append(fastChk, document.createTextNode(' 跳过逐字显示'));
  controls.appendChild(fastWrap);

  const trialControl = h('label', 'preview-entry-control preview-trial-control');
  trialControl.title = '只改变本次预览画面，不改作品配置，也不改玩家的设置';
  const trialScale = h('select');
  trialScale.setAttribute('aria-label', '试看文字大小');
  const scaleDefault = h('option', undefined, '字号按设置'); scaleDefault.value = '';
  trialScale.appendChild(scaleDefault);
  for (const scale of readingTrialScales()) {
    const option = h('option', undefined, `字号 ${Math.round(scale * 100)}%`); option.value = String(scale); trialScale.appendChild(option);
  }
  trialScale.value = readingTrial.textScale === null ? '' : String(readingTrial.textScale);
  const trialMotion = h('select');
  trialMotion.setAttribute('aria-label', '试看动态效果');
  for (const [value, label] of [['', '动态按设置'], ['reduce', '减少动态'], ['full', '正常动态']] as const) {
    const option = h('option', undefined, label); option.value = value; trialMotion.appendChild(option);
  }
  trialMotion.value = readingTrial.reducedMotion === null ? '' : readingTrial.reducedMotion ? 'reduce' : 'full';
  trialControl.append(h('span', 'preview-control-label', '临时试看'), trialScale, trialMotion);
  controls.appendChild(trialControl);
  const sendReadingTrial = (): void => { frame.contentWindow?.postMessage({ type: 'surdet-preview-reading-trial', ...readingTrial }, '*'); };
  trialScale.onchange = () => { readingTrial = { ...readingTrial, textScale: trialScale.value ? Number(trialScale.value) : null }; sendReadingTrial(); };
  trialMotion.onchange = () => { readingTrial = { ...readingTrial, reducedMotion: trialMotion.value ? trialMotion.value === 'reduce' : null }; sendReadingTrial(); };

  const playBtn = h('button', 'preview-replay-action preview-play-action', '重新播放');
  playBtn.setAttribute('data-action', 'reload-preview');
  playBtn.setAttribute('data-action-scope', 'workspace');
  controls.appendChild(playBtn);
  const resumeBtn = h('button', 'preview-replay-action', '回到上次位置');
  resumeBtn.type = 'button';
  const readingBtn = h('button', 'preview-replay-action', '检查当前排版');
  readingBtn.type = 'button';
  readingBtn.title = '检查当前已显示文字的字体缺字、越界与滚动；未播放章节不在检查范围内';
  readingBtn.onclick = () => frame.contentWindow?.postMessage({ type: 'surdet-preview-reading-check' }, '*');
  controls.appendChild(readingBtn);
  controls.appendChild(resumeBtn);
  const debugToggle = h('label', 'preview-fast'), debugCheck = h('input'); debugCheck.type = 'checkbox'; debugCheck.checked = debugging;
  debugCheck.setAttribute('aria-label', '启用调试（从入口重播）'); debugToggle.append(debugCheck, document.createTextNode(' 启用调试（从入口重播）'));
  controls.appendChild(debugToggle);
  toolbar.appendChild(controls);
  workspace.appendChild(toolbar);

  const stage = h('section', 'preview-stage');
  stage.setAttribute('aria-label', '剧情舞台');
  const frame = h('iframe', 'preview-frame');
  frame.src = './preview.html';
  frame.title = '剧情预览';
  stage.appendChild(frame);
  workspace.appendChild(stage);
  let targetDeclarations: Record<string, unknown>[] = [];
  try { targetDeclarations = parsePreviewVariables(capturePreviewContent().configText); } catch { /* The query reports an unreadable config itself. */ }
  const targetSection = options.target === undefined ? null : createPreviewTargetSection(options.target, writableDeclarations(targetDeclarations));
  if (targetSection) workspace.appendChild(targetSection.element);
  let targetWorker: Worker | null = null;
  let pendingTarget: FoundTarget | null = null;
  /** The trace of the run that is replaying a found path, if the current one is. */
  let targetTraceId: string | null = null;
  let targetLabel = '';
  /** The found start being loaded, and the one the current run replays. */
  let loadingTarget: FoundTarget | null = null;
  let runningTarget: FoundTarget | null = null;
  const diagnostics = h('div', 'preview-diagnostics');
  diagnostics.setAttribute('aria-live', 'polite');
  workspace.appendChild(diagnostics);
  const sourceState = h('p', 'preview-source-state', '尚未启动');
  sourceState.dataset.previewSourceState = 'idle';
  sourceState.setAttribute('aria-live', 'polite');
  workspace.appendChild(sourceState);
  const debugPanel = h('section', 'preview-debugger'); debugPanel.hidden = !debugging; debugPanel.setAttribute('aria-label', '真实调试');
  const debugActions = h('div', 'preview-controls');
  const pauseDebug = h('button', undefined, '暂停'), stepDebug = h('button', undefined, '单步'), continueDebug = h('button', undefined, '继续运行');
  const locateDebug = h('button', undefined, '打开当前源码');
  locateDebug.title = '离开本次预览，定位同版本源码；返回后需重新播放或沿原路径续接';
  for (const button of [pauseDebug, stepDebug, continueDebug, locateDebug]) { button.type = 'button'; button.disabled = true; debugActions.appendChild(button); }
  const debugStatus = h('p', undefined, '启用调试后重新播放，在实际指令执行前停住。'); debugStatus.setAttribute('aria-live', 'polite');
  const variableDetails = h('details'); variableDetails.open = true; variableDetails.appendChild(h('summary', undefined, '变量（只读）'));
  const debugVariables = h('pre', 'preview-debug-values'); variableDetails.appendChild(debugVariables);
  const debugCalls = h('p', 'preview-debug-calls');
  const breakpointControls = h('div', 'preview-controls'), breakpointScene = h('select'), breakpointStep = h('select'), addBreakpoint = h('button', undefined, '添加断点');
  breakpointScene.setAttribute('aria-label', '断点场景'); breakpointStep.setAttribute('aria-label', '断点步骤'); addBreakpoint.type = 'button';
  breakpointControls.append(breakpointScene, breakpointStep, addBreakpoint);
  const breakpointList = h('ul', 'preview-debug-breakpoints');
  debugPanel.append(debugActions, debugStatus, variableDetails, debugCalls, breakpointControls, breakpointList); workspace.appendChild(debugPanel);
  let debugState: PreviewDebugState | null = null;
  let debugSources: { id: string; text: string }[] = [];
  // A run replaying a found start is debuggable only while that start still matches the script, whether
  // or not the debug switch is on; any other run needs the switch.
  const debugFresh = (): boolean => (targetTraceId !== null && targetTraceId === expectedTraceId ? runningTarget !== null && !targetStale(runningTarget) : debugging)
    && publishedSource !== null && publishedSource === requestKey()
    && sourceState.dataset.previewSourceState === 'fresh' && currentTraceId === expectedTraceId && currentTraceGeneration >= 0;
  const sendDebug = (action: PreviewDebugCommand['action']): void => {
    if (!debugFresh()) { debugStatus.textContent = '当前内容或预览身份已变化，请重新播放后再调试。'; return; }
    const message: PreviewDebugCommand = { type: 'surdet-preview-debug-command', traceId: currentTraceId!, generation: currentTraceGeneration,
      action, ...(action === 'breakpoints' ? { breakpoints: validDebugBreakpoints(breakpoints, debugSources) } : {}) };
    frame.contentWindow?.postMessage(message, location.origin);
  };
  const refreshDebug = (): void => {
    const snapshot = debugState?.snapshot, fresh = debugFresh();
    pauseDebug.disabled = !fresh || !snapshot || snapshot.paused || !['awaiting-advance', 'awaiting-choice'].includes(snapshot.status);
    stepDebug.disabled = !fresh || !snapshot || !(snapshot.paused && snapshot.status === 'paused' || snapshot.status === 'awaiting-advance');
    continueDebug.disabled = !fresh || !snapshot || ['idle', 'ended', 'error'].includes(snapshot.status);
    locateDebug.disabled = !fresh || !snapshot?.current || !options.onDebugSource || selectedTarget !== null;
    addBreakpoint.disabled = !fresh || breakpointStep.options.length === 0;
  };
  const refreshBreakpoints = (): void => {
    const currentSources = selectedTarget === null ? collectPreviewScenes(state.scenes) : debugSources;
    const valid = validDebugBreakpoints(breakpoints, currentSources);
    breakpointList.replaceChildren();
    for (const point of breakpoints) {
      const row = h('li'); row.appendChild(document.createTextNode(`${point.sceneId} · ${point.caption}${valid.includes(point) ? '' : '（剧本已变，需重新确认）'} `));
      const remove = h('button', undefined, '移除'); remove.type = 'button'; remove.setAttribute('aria-label', `移除断点 ${point.sceneId} 第 ${point.line} 行`);
      remove.onclick = () => { breakpoints = breakpoints.filter(candidate => candidate !== point); refreshBreakpoints(); if (debugFresh()) sendDebug('breakpoints'); };
      row.appendChild(remove); breakpointList.appendChild(row);
    }
  };
  const refreshBreakpointSteps = (): void => {
    try {
      breakpointStep.replaceChildren(...debugInstructionOptions(debugSources, breakpointScene.value).map(point => {
        const option = h('option', undefined, point.caption); option.value = String(point.index); return option;
      }));
    } catch (error) { breakpointStep.replaceChildren(); debugStatus.textContent = error instanceof Error ? error.message : String(error); }
    refreshDebug();
  };
  breakpointScene.onchange = refreshBreakpointSteps;
  addBreakpoint.onclick = () => {
    if (!debugFresh()) return;
    const point = debugInstructionOptions(debugSources, breakpointScene.value).find(point => point.index === Number(breakpointStep.value));
    if (!point) return;
    breakpoints = [...breakpoints.filter(old => !(old.sceneId === point.sceneId && old.index === point.index)), point];
    refreshBreakpoints(); sendDebug('breakpoints');
  };
  pauseDebug.onclick = () => sendDebug('pause'); stepDebug.onclick = () => sendDebug('step'); continueDebug.onclick = () => sendDebug('continue');
  locateDebug.onclick = () => { if (debugFresh() && debugState?.snapshot.current && selectedTarget === null) options.onDebugSource?.(debugState.snapshot.current); };
  notifyPreviewDebug = (message, source) => {
    if (mountRevision !== previewPanelMountRevision || !container.isConnected || source !== frame.contentWindow
      || message.traceId !== expectedTraceId || message.traceId !== currentTraceId || message.generation !== currentTraceGeneration) return;
    debugState = message;
    const snapshot = message.snapshot, point = snapshot.current;
    const pauseReason = snapshot.reason === 'breakpoint' ? '断点' : snapshot.reason === 'step' ? '单步' : snapshot.reason === 'entry' ? '入口' : '手动';
    const status = snapshot.paused ? `已暂停（${pauseReason}）` : snapshot.status === 'paused' ? '宿主接管剧情' : snapshot.status === 'awaiting-choice' ? '等待真实选择' : snapshot.status === 'awaiting-timer' ? '等待计时或演出完成'
      : snapshot.status === 'awaiting-advance' ? '等待继续阅读' : snapshot.status === 'ended' ? '已结束' : snapshot.status === 'error' ? '运行失败' : '运行中';
    debugStatus.textContent = message.error ?? `${status}${point ? ` · ${point.sceneId} 第 ${point.line} 行 · 步骤 ${point.index + 1} · 剧本版本 ${point.sceneHash}` : ''}`;
    debugVariables.textContent = Object.entries(snapshot.variables).map(([name, value]) => `${name} = ${JSON.stringify(value)}`).join('\n') || '当前没有剧情变量。';
    debugCalls.textContent = snapshot.callStack.length ? `返回位置：${snapshot.callStack.map(point => `${point.sceneId} 第 ${point.line} 行`).join(' → ')}` : '调用栈为空。';
    refreshDebug();
  };
  let publishedSource: string | null = null;
  let expectedTraceId: string | null = null;
  type Publication = { publisher: NonNullable<ReturnType<typeof editorPreviewPublisher>>; previewId: string; previewGeneration: number };
  let formal: Publication | null = null;
  let pendingInvalidation: Publication | null = null;
  const invalidate = async (reason: Extract<PreviewPublishInput, { action: 'invalidate' }>['reason']): Promise<void> => {
    const previous = formal ?? pendingInvalidation;
    formal = null;
    if (previous === null) return;
    pendingInvalidation = previous;
    await previous.publisher.publish({ action: 'invalidate', previewGeneration: previous.previewGeneration, reason });
    if (pendingInvalidation === previous) pendingInvalidation = null;
  };
  const publishTrace = (message: PreviewTraceMessage): void => {
    const current = formal;
    if (current === null) return;
    void current.publisher.publish({ action: 'append', previewId: current.previewId,
      previewGeneration: current.previewGeneration, messages: [message] }).catch(error => {
      if (formal !== current) return;
      void invalidate('source-changed').catch(() => {});
      sourceState.textContent = `预览可继续，观察记录未能同步：${error instanceof Error ? error.message : String(error)}`;
    });
  };
  let sendRevision = 0;
  let loading: AbortController | null = null;
  let loadingSource: string | null = null;
  activePreviewCleanup = () => { loading?.abort(); targetWorker?.terminate(); targetWorker = null; stageWorkbench?.dispose(); expectedTraceId = null; void invalidate('closed').catch(() => {}); frame.remove(); };
  notifyPreviewSourceEdited = () => {
    // A selected version's request key does not cover the editor text; a found start does.
    if (sourceState.dataset.previewSourceState === 'loading' && loadingTarget !== null && targetStale(loadingTarget)) {
      loading?.abort();
      loadingTarget = null;
      sourceState.dataset.previewSourceState = 'stale';
      sourceState.textContent = '剧本已修改，找到的起点属于旧版本，本次未启动。';
      targetSection?.setStatus('剧本已修改，这次起点属于旧版本；请重新查找。', 'warning');
    }
    if (runningTarget !== null && targetTraceId !== null && targetTraceId === expectedTraceId && targetStale(runningTarget)) {
      targetSection?.setStatus('剧本已修改，这次起点属于旧版本；请重新查找。', 'warning');
      refreshDebug();
    }
    if (sourceState.dataset.previewSourceState === 'loading' && loadingSource !== null && loadingSource !== requestKey()) {
      loading?.abort();
      sourceState.dataset.previewSourceState = 'stale';
      sourceState.textContent = '读取期间内容已修改，本次未启动，请重新播放。';
    }
    if (sourceState.dataset.previewSourceState !== 'stale' && publishedSource !== null && publishedSource !== requestKey()) {
      sourceState.dataset.previewSourceState = 'stale';
      sourceState.textContent = '内容已修改；当前画面仍属于上一次运行，请重新播放。';
      refreshDebug(); refreshBreakpoints();
      void invalidate('source-changed').catch(() => {});
      options.onSourceStateChange?.();
    }
  };

  const traceBox = h('section', 'preview-causal-dock preview-trace');
  traceBox.id = 'preview-trace';
  const dockHeader = h('div', 'preview-causal-header');
  const dockHeading = h('div', 'preview-causal-heading');
  dockHeading.appendChild(h('h2', undefined, '因果记录'));
  const dockCount = h('span', 'preview-causal-count', '本次 0 条');
  dockHeading.appendChild(dockCount);
  dockHeader.appendChild(dockHeading);
  const dockToggle = h('button', 'preview-causal-toggle', '收起记录');
  dockToggle.type = 'button';
  dockToggle.setAttribute('data-action-scope', 'workspace');
  dockHeader.appendChild(dockToggle);
  traceBox.appendChild(dockHeader);
  const traceList = h('ol', 'preview-causal-list preview-trace-list');
  traceList.id = 'preview-causal-list';
  dockToggle.setAttribute('aria-controls', traceList.id);
  traceBox.appendChild(traceList);
  workspace.appendChild(traceBox);
  container.appendChild(workspace);

  const constrainedViewport = window.matchMedia?.('(max-width: 480px), (max-height: 700px)').matches === true;
  let dockExpanded = options.embedded !== true && !constrainedViewport;
  let lastFocusedSequence: number | null = null;
  let savedScrollTop = 0;

  const focusTraceSequence = (sequence: number): void => {
    const target = traceList.querySelector<HTMLButtonElement>(`[data-preview-trace-sequence="${sequence}"]`);
    target?.focus({ preventScroll: true });
  };

  const updateDockState = (): void => {
    traceList.hidden = !dockExpanded;
    dockToggle.setAttribute('aria-expanded', String(dockExpanded));
    dockToggle.textContent = dockExpanded ? '收起记录' : '展开记录';
  };

  dockToggle.onclick = () => {
    savedScrollTop = traceList.scrollTop;
    dockExpanded = !dockExpanded;
    updateDockState();
    if (dockExpanded && lastFocusedSequence !== null) {
      queueMicrotask(() => {
        traceList.scrollTop = savedScrollTop;
        focusTraceSequence(lastFocusedSequence!);
      });
    }
  };
  updateDockState();

  const renderTraceList = (): void => {
    const active = document.activeElement as HTMLElement | null | undefined;
    const activeSequence = active?.dataset?.['previewTraceSequence'];
    const restoreFocus = activeSequence !== undefined;
    if (activeSequence !== undefined) lastFocusedSequence = Number(activeSequence);
    savedScrollTop = traceList.scrollTop;
    traceList.innerHTML = '';
    const events = currentPreviewTrace.filter((message): message is PreviewTraceEventMessage => message.type === 'surdet-preview-trace-event');
    dockCount.textContent = `本次 ${events.length} 条`;
    if (events.length === 0) {
      const emptyItem = h('li', 'preview-causal-empty', '播放剧情后，这里会按顺序显示画面变化及其来源。');
      traceList.appendChild(emptyItem);
      return;
    }
    for (const message of events) {
      const source = message.event.source;
      const activeIndex = projected?.index ?? state.authoringIndex;
      const ref = locateObjectForTraceEvent({ event: message.event } satisfies CausalTraceEvent, activeIndex ?? undefined);
      // @timeline 指令事件：用同一事件的前后 stage 快照差异反查具体 timeline cue（Wave 2 反向定位）。
      let selectedRef = ref;
      const instruction = ref === null ? undefined : activeIndex?.byRef.get(ref);
      const timelineTarget = instruction?.references.find((candidate) => candidate.startsWith('timeline:'));
      if (source.op === 'timeline' && timelineTarget !== undefined && activeIndex !== null) {
        const cueRefs = locateTimelineCuesForStageChange(
          message.presentationBefore,
          message.presentationAfter,
          activeIndex,
          timelineTarget,
        );
        if (cueRefs.length > 0) selectedRef = cueRefs[0]!;
      }
      const row = projectPreviewTraceRow(message);
      const item = h('li', 'preview-causal-item');
      const button = h('button', message.sequence === state.selectedTraceStep ? 'preview-trace-event selected' : 'preview-trace-event');
      button.type = 'button';
      button.setAttribute('data-preview-trace-sequence', String(message.sequence));
      button.setAttribute('aria-pressed', String(message.sequence === state.selectedTraceStep));
      button.append(
        h('span', 'preview-trace-sequence', String(message.sequence + 1).padStart(2, '0')),
        h('span', 'preview-trace-summary', row.title),
        h('span', 'preview-trace-result', message.presentationApplied ? '画面已更新' : '剧情已推进'),
        h('span', 'preview-trace-source', row.sourceLabel),
        h('span', 'preview-trace-technical surdet-technical-text', row.technicalLabel),
      );
      button.title = selectedRef ?? '当前对象索引尚未定位该事件';
      button.onfocus = () => { lastFocusedSequence = message.sequence; };
      button.onclick = () => {
        state.selectedTraceStep = message.sequence;
        if (selectedTarget === null || selectedTarget.kind === 'saved-project') {
          state.selectedObjectRef = selectedRef;
          dispatchPreviewTraceSelection({ event: message.event, objectRef: selectedRef, sequence: message.sequence });
        } else {
          diagnostics.textContent = `${isolated?.title ?? '隔离内容'} · ${row.sourceLabel}：${instruction?.source?.raw ?? source.op}`;
        }
        renderTraceList();
      };
      item.appendChild(button);
      traceList.appendChild(item);
    }
    traceList.scrollTop = savedScrollTop;
    if (restoreFocus && lastFocusedSequence !== null) focusTraceSequence(lastFocusedSequence);
  };
  renderTraceList();

  let currentTraceId: string | null = null;
  let currentTraceGeneration = -1;
  let lastTraceSequence = -1;
  let traceCompleted = false;
  let activeCheckpointKey: string | null = null;
  let currentPlayback: import('@surdet/authoring').PreviewPlaybackCheckpoint | null = null;
  let stagePlayback: import('@surdet/authoring').PreviewPlaybackCheckpoint | null = null;
  notifyPreviewTrace = (message, source) => {
    if (mountRevision !== previewPanelMountRevision || container.isConnected === false) return;
    if (!isCurrentPreviewFrameSource(source, frame.contentWindow)) return;
    if (message.traceId !== expectedTraceId) return;
    if (message.type === 'surdet-preview-trace-start') {
      if (currentTraceGeneration >= 0 && message.generation < currentTraceGeneration) return;
      currentTraceGeneration = message.generation;
      currentTraceId = message.traceId;
      lastTraceSequence = -1;
      traceCompleted = false;
      currentPreviewTrace = [message];
      appendStoryPreview(message);
      state.previewTrace = [];
      state.selectedTraceStep = null;
      publishTrace(message);
      renderTraceList();
      return;
    }
    const current = acceptPreviewTraceMessage(message, currentTraceGeneration);
    if (current === null) return;
    if (current.traceId !== currentTraceId) return;
    if (traceCompleted) return;
    if (current.type === 'surdet-preview-trace-event') {
      if (current.sequence <= lastTraceSequence) return;
      lastTraceSequence = current.sequence;
      if (current.playback !== undefined) { currentPlayback = current.playback; writePreviewCheckpoint(activeCheckpointKey, current.playback); }
    } else {
      traceCompleted = true;
    }
    currentPreviewTrace = [...currentPreviewTrace, current];
    appendStoryPreview(current);
    publishTrace(current);
    if (current.type === 'surdet-preview-trace-event') state.previewTrace = [...state.previewTrace, current.event];
    renderTraceList();
  };

  let ready = false;
  let latestGeneration = 0;
  notifyPreviewDiagnostic = (diagnostic, source) => {
    if (mountRevision !== previewPanelMountRevision || container.isConnected === false) return;
    if (!isCurrentPreviewFrameSource(source, frame.contentWindow)) return;
    if (diagnostic.generation < latestGeneration) return;
    latestGeneration = diagnostic.generation;
    if (diagnostic.level === 'error' && expectedTraceId !== null && diagnostic.generation === currentTraceGeneration)
      appendStoryPreviewError(expectedTraceId, diagnostic.phase, diagnostic.message, diagnostic);
    if (diagnostic.level === 'error' && targetTraceId !== null && targetTraceId === expectedTraceId && diagnostic.generation === currentTraceGeneration)
      targetSection?.setStatus(`没有从这一行开始：${diagnostic.message}`, 'warning');
    diagnostics.textContent = `${diagnostic.level === 'error' ? '错误' : diagnostic.level === 'warning' ? '警告' : '状态'}：${diagnostic.message}${diagnostic.label ? `（@label ${diagnostic.label}）` : ''}`;
    diagnostics.className = `preview-diagnostics ${diagnostic.level}`;
  };
  /** 异步读取素材期间若用户重新选择播放入口，旧请求不得晚到覆盖新选择。 */
  const send = async (resume = false, capturedPlayback?: import('@surdet/authoring').PreviewPlaybackCheckpoint | null, target?: FoundTarget): Promise<void> => {
    if (target === undefined && (targetWorker !== null || targetTraceId !== null)) {
      stopTargetQuery();
      targetSection?.setStatus('已改为正常播放；需要时可重新查找。');
      targetSection?.setDetails([]);
    }
    pendingTarget = null;
    // Any new start supersedes the run that replayed an earlier found start.
    runningTarget = null;
    targetTraceId = null;
    loadingTarget = target ?? null;
    loading?.abort();
    const controller = new AbortController();
    loading = controller;
    loadingSource = null;
    const signal = controller.signal;
    const revision = ++sendRevision;
    if (!ready) return;
    try { await invalidate('reload'); }
    catch (error) {
      sourceState.textContent = `重新播放尚未开始，请重试：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    if (revision !== sendRevision || mountRevision !== previewPanelMountRevision || !container.isConnected) return;
    expectedTraceId = null;
    sourceState.dataset.previewSourceState = 'loading';
    debugState = null; refreshDebug();
    sourceState.textContent = '正在读取所选内容，旧画面尚未替换。';
    const requestRoot = state.dirHandle;
    const requestedTarget = selectedTarget;
    let publisher = editorPreviewPublisher(requestRoot);
    try {
      if (requestedTarget === null) assertConfigSourcesReadable();
      const loaded = requestedTarget === null ? undefined : await publisher?.content(requestedTarget);
      if (requestedTarget !== null && loaded === undefined) throw new Error('请从正常绑定项目入口打开，才能读取隔离试玩内容');
      const projection = loaded === undefined ? undefined : await projectPreviewContent(loaded);
      if (revision !== sendRevision || selectedTarget !== requestedTarget || state.dirHandle !== requestRoot || mountRevision !== previewPanelMountRevision) return;
      isolated = loaded;
      projected = projection;
    } catch (error) {
      if (signal.aborted || mountRevision !== previewPanelMountRevision) return;
      sourceState.dataset.previewSourceState = 'stale';
      sourceState.textContent = `所选内容未能加载；保留的旧画面不代表新版本：${error instanceof Error ? error.message : String(error)}`;
      if (target !== undefined) targetSection?.setStatus('所选内容未能重新读取，这次起点没有开始；请重新查找。', 'warning');
      return;
    }
    if (revision !== sendRevision || selectedTarget !== requestedTarget || state.dirHandle !== requestRoot || mountRevision !== previewPanelMountRevision) return;
    if (projected !== undefined) {
      const selectedScene = sceneSel.value;
      sceneSel.replaceChildren(...projected.scenes.map(scene => {
        const option = h('option', undefined, scene.id); option.value = scene.id; return option;
      }));
      sceneSel.value = projected.scenes.some(scene => scene.id === selectedScene) ? selectedScene
        : projected.entryScene ?? projected.scenes[0]?.id ?? '';
      sceneControl.hidden = false;
    } else sceneControl.hidden = true;
    // After the selected version is read again: a new revision or an edited line needs a new query.
    if (target !== undefined && (target.selected !== requestedTarget || targetStale(target))) {
      sourceState.dataset.previewSourceState = 'stale';
      sourceState.textContent = '剧本或所选内容已更新，找到的起点属于旧版本，本次未启动。';
      targetSection?.setStatus('剧本或所选内容已更新，这次起点属于旧版本；请重新查找。', 'warning');
      return;
    }
    const cur = target !== undefined ? (projected?.scenes ?? collectPreviewScenes(state.scenes)).find(scene => scene.id === target.report.entryScene)
      : projected?.scenes.find(scene => scene.id === sceneSel.value) ?? (requestedTarget === null && state.current ? state.scenes.get(state.current) : undefined);
    if (!cur) {
      setStatus('预览：请先选择一个场景', false, 4000);
      return;
    }
    // A found path starts at its own entry; it is not the toolbar entry's resumable position.
    const startLabel = target !== undefined ? target.report.entryLabel : labelSel.value || undefined;
    const key = target !== undefined ? null : previewCheckpointKey(isolated?.projectIdentity ?? editorWorkspaceStatus().latest?.projectIdentity,
      selectedTarget, cur.id, labelSel.value || undefined);
    const replay = resume ? capturedPlayback ?? readPreviewCheckpoint(key) : null;
    if (resume && replay === null) {
      sourceState.textContent = '这个内容与入口还没有可续接的实际试玩位置，请先正常播放。';
      sourceState.dataset.previewSourceState = 'stale';
      return;
    }
    const seed = target?.report.seed ?? replay?.seed ?? crypto.getRandomValues(new Uint32Array(1))[0]!;
    const requestSceneKey = state.current;
    const requestScene = state.current ? state.scenes.get(state.current) : undefined;
    const requestAssets = state.dirAssets;
    const requestSource = requestKey();
    const sameRequest = (): boolean => requestKey() === requestSource && (target === undefined || !targetStale(target));
    loadingSource = requestSource;
    // 使用本次选择的内容版本，不从编辑器原配置借用字体。
    let capturedContent: ReturnType<typeof capturePreviewContent>;
    let resources: Awaited<ReturnType<typeof loadPreviewResources>>;
    try {
      capturedContent = capturePreviewContent(projected);
      resources = await loadPreviewResources(capturedContent, signal);
    }
    catch (error) {
      if (signal.aborted || revision !== sendRevision || mountRevision !== previewPanelMountRevision || !container.isConnected) return;
      sourceState.dataset.previewSourceState = 'stale';
      sourceState.textContent = `预览未启动：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    const { cachedFonts, assets, timelineContent } = resources;
    const requestConfigText = capturedContent.configText;
    const fonts = clonePreviewFontsForTransfer(cachedFonts);
    if (projected !== undefined && timelineContent.issues.length) { sourceState.textContent = `所选版本的演出无法加载：${timelineContent.issues.join('；')}`; sourceState.dataset.previewSourceState = 'stale'; return; }
    const timelines = timelineContent.definitions;
    if (revision !== sendRevision || mountRevision !== previewPanelMountRevision || !container.isConnected) return;
    if (state.dirHandle !== requestRoot || state.current !== requestSceneKey
      || (requestSceneKey !== null && state.scenes.get(requestSceneKey) !== requestScene)
      || state.dirAssets !== requestAssets || !sameRequest()) {
      sourceState.dataset.previewSourceState = 'stale';
      sourceState.textContent = '读取素材期间内容或项目发生变化，本次未启动，请重新播放。';
      return;
    }
    const traceId = `preview-${crypto.randomUUID()}`;
    let observationError: string | null = null;
    // A save can finish while assets load, before requestSource is captured.
    // Publish with the current binding baseline after the content guards above,
    // not the publisher captured before those asynchronous reads.
    publisher = editorPreviewPublisher(requestRoot);
    const status = editorWorkspaceStatus();
    if (publisher !== null && state.reviewWorkspace === null && target?.report.mode !== 'test' && (isolated !== undefined || state.previewTimelineId === null)
      && ((!status.dirty && !inspectConfigDraftState().dirty) || (isolated !== undefined && isolated.target.kind !== 'saved-project')) && !status.saving && status.update === 'none') {
      const previewGeneration = ++publishedPreviewGeneration;
      try {
        const source = await previewSourceFacts(assets, cachedFonts, capturedContent.storage, isolated);
        if (revision !== sendRevision || mountRevision !== previewPanelMountRevision || !sameRequest()) return;
        await publisher.publish({ action: 'begin', previewId: traceId, previewGeneration, sceneId: cur.id,
          seed,
          ...(startLabel ? { label: startLabel } : {}), source,
          expectedProjectRevision: publisher.baseline.projectRevision,
          expectedCoordinationRevision: publisher.baseline.coordinationRevision,
          ...(isolated === undefined ? {} : { content: { target: isolated.target, contentRevision: isolated.contentRevision } }) });
        if (revision !== sendRevision || mountRevision !== previewPanelMountRevision || !sameRequest()
          || state.dirHandle !== requestRoot || !container.isConnected) {
          await publisher.publish({ action: 'invalidate', previewGeneration, reason: 'source-changed' }).catch(() => {});
          return;
        }
        formal = { publisher, previewId: traceId, previewGeneration };
      } catch (error) {
        observationError = error instanceof Error ? error.message : String(error);
      }
    }
    if (isolated !== undefined && formal === null && target?.report.mode !== 'test') {
      sourceState.dataset.previewSourceState = 'stale';
      sourceState.textContent = `隔离内容尚未开始试玩：${observationError ?? '工作区当前无法发布所选版本的观察，请等待当前操作结束'}`;
      return;
    }
    if (revision !== sendRevision || mountRevision !== previewPanelMountRevision || !sameRequest()
      || state.dirHandle !== requestRoot || !container.isConnected) return;
    const gameConfig = parseProjectConfigDocument(requestConfigText || '{}');
    debugSources = capturedContent.scenes;
    const nextDebugContentKey = JSON.stringify({ project: isolated?.projectIdentity ?? state.autosaveProjectId ?? transientPreviewProjectKey, target: selectedTarget });
    if (debugContentKey !== nextDebugContentKey) { breakpoints = []; debugContentKey = nextDebugContentKey; }
    const previousBreakpointScene = breakpointScene.value;
    breakpointScene.replaceChildren(...debugSources.map(scene => { const option = h('option', undefined, scene.id); option.value = scene.id; return option; }));
    breakpointScene.value = debugSources.some(scene => scene.id === previousBreakpointScene) ? previousBreakpointScene : cur.id;
    refreshBreakpointSteps(); refreshBreakpoints();
    const userBreakpoints = validDebugBreakpoints(breakpoints, debugSources);
    const position = target?.report.position ?? null;
    const run: PreviewTargetRun | undefined = target === undefined || position === null ? undefined : {
      mode: target.report.mode, breakpoint: { sceneId: position.sceneId, sceneHash: position.sceneHash, index: position.index },
      line: target.report.target.line, choices: [...target.report.choices], targetVisit: target.report.targetVisit,
      ...(target.report.mode === 'test' ? { variables: structuredClone(target.report.initialVariables) } : {}),
      afterBreakpoints: debugging ? userBreakpoints : [],
    };
    const message = {
      type: 'surdet-preview-load',
      payload: {
        stage: gameConfig.stage,
        gameConfig,
        traceId,
        seed,
        replay: replay ?? undefined,
        strictSource: isolated !== undefined,
        sceneId: cur.id,
        projectKey: isolated ? `${isolated.projectIdentity}:${JSON.stringify(isolated.target)}` : state.autosaveProjectId ?? transientPreviewProjectKey,
        // 全量场景下发：预览内跨场景 @jump 可正常跳转（多场景预览）
        scenes: capturedContent.scenes,
        speakerProfiles: parsePreviewSpeakerProfiles(requestConfigText),
        // 变量声明一并下发：真实剧本的 @set/@mod/@if 需要变量表（否则运行时错误卡死）
        variables: parsePreviewVariables(requestConfigText),
        // 编辑器管理的四套配置下发：预览轻宿主（日历/成长/成就/好感）；battle/shop 无配置仍占位
        configs: capturedContent.configs,
        fonts: Object.keys(fonts).length > 0 ? fonts : undefined,
        assets,
        timelines: timelines.length > 0 ? timelines : undefined,
        timelinePreviewId: run === undefined ? capturedContent.timelinePreviewId : undefined,
        choices: capturedContent.choices,
        startLabel,
        fast: fastChk.checked,
        // A found path pauses only at its temporary breakpoint; the user's own ones return once it is reached.
        debug: run === undefined ? { enabled: debugging, pauseOnStart: debugging && !resume, breakpoints: userBreakpoints }
          : { enabled: true, pauseOnStart: false, breakpoints: [run.breakpoint] },
        target: run,
      },
    };
    const transfer = [
      ...assets.backgrounds.map((a) => a.image.buffer),
      ...assets.portraits.map((a) => a.image.buffer),
      ...assets.visuals.flatMap(a => Object.values(a.images).map(image => image.buffer)),
      ...assets.avatars.map((a) => a.image.buffer),
      ...assets.rules.map((a) => a.image.buffer),
      ...assets.audio.map((a) => a.file.buffer),
      ...assets.videos.map((a) => a.file.buffer),
      ...Object.values(fonts).map((font) => font.buffer),
    ];
    const frameWindow = frame.contentWindow;
    if (!frameWindow) return;
    const sourceKey = storyPreviewSourceKey(requestSource);
    const previewRecord = await prepareStoryPreview({ traceId, owner: requestRoot, seed, working: isolated === undefined && reviewResult === null,
      scope: isolated === undefined ? reviewResult === null ? '当前编辑内容（含草稿）' : '固定审阅内容'
        : ({ 'saved-project': '已保存项目', 'working-change': '隔离工作变更', candidate: '封存候选', 'integration-result': '组合结果' } as const)[isolated.target.kind],
      sources: message.payload.scenes.map(scene => {
        const file = capturedContent.sourceScenes.find(source => source.id === scene.id)!.file;
        return { ...scene, file: file.startsWith('content/scenario/') ? file : `content/scenario/${file}` };
      }),
      contentKey: JSON.stringify({ scenes: message.payload.scenes, gameConfig, configs: message.payload.configs, timelines: message.payload.timelines }),
      isCurrent: () => state.dirHandle === requestRoot && storyPreviewSourceKey() === sourceKey,
    });
    if (target !== undefined && targetStale(target) && revision === sendRevision && mountRevision === previewPanelMountRevision) {
      void invalidate('source-changed').catch(() => {});
      sourceState.dataset.previewSourceState = 'stale';
      sourceState.textContent = '剧本或所选内容已更新，找到的起点属于旧版本，本次未启动。';
      targetSection?.setStatus('剧本或所选内容已更新，这次起点属于旧版本；请重新查找。', 'warning');
      return;
    }
    if (revision !== sendRevision || mountRevision !== previewPanelMountRevision || !sameRequest()
      || state.dirHandle !== requestRoot || !container.isConnected) return;
    stageWorkbench?.reset();
    currentPlayback = null;
    loadingTarget = null;
    runningTarget = run === undefined ? null : target!;
    targetTraceId = run === undefined ? null : traceId;
    targetLabel = run === undefined ? '' : `${target!.report.target.sceneId} 第 ${target!.report.target.line} 行`;
    debugPanel.hidden = !debugging && run === undefined;
    expectedTraceId = traceId;
    activeCheckpointKey = key;
    activateStoryPreview(previewRecord);
    frameWindow.postMessage(message, '*', [...new Set(transfer)]);
    // A rejected or superseded read has not begun a new run. Only a published
    // payload replaces the previous observations and their source selection.
    currentTraceId = null;
    currentTraceGeneration = -1;
    lastTraceSequence = -1;
    traceCompleted = false;
    currentPreviewTrace = [];
    state.previewTrace = [];
    state.selectedTraceStep = null;
    renderTraceList();
    publishedSource = requestSource;
    sourceState.dataset.previewSourceState = 'fresh';
    if (run !== undefined) targetSection?.setStatus(`正在按找到的路径前进到 ${targetLabel}…`);
    sourceState.textContent = run?.mode === 'test' ? '测试起点：临时初值只用于本次试玩，没有写回作品，也不作为正式试玩记录。'
      : observationError !== null ? `预览可继续，观察记录未能同步：${observationError}`
      : isolated !== undefined ? `${isolated.title}；未写回来源，智能体可读取本次实际播放记录。${isolated.target.kind === 'candidate' || isolated.target.kind === 'integration-result' ? '返修请切回原工作变更，完成后重新封装或组合。' : ''}`
      : formal !== null ? '已载入保存的内容；智能体可读取本次实际播放记录。'
      : reviewResultLabel !== null ? `${reviewResultLabel}；本页展示当前审阅结果及其实际轨迹。`
      : '正在播放编辑中的内容，包括未保存的修改。';
    options.onSourceStateChange?.();
  };

  stageWorkbench = createStageWorkspace({ frame,
    canInspect: () => currentTraceId !== null && sourceState.dataset.previewSourceState !== 'loading'
      && publishedSource !== null && publishedSource === requestKey() && mountRevision === previewPanelMountRevision,
    canEdit: () => selectedTarget === null && state.reviewWorkspace === null && !state.reviewPreviewReadOnly
      && publishedSource !== null && publishedSource === requestKey() && mountRevision === previewPanelMountRevision,
    canEditConfiguration: () => selectedTarget === null && state.reviewWorkspace === null && !state.reviewPreviewReadOnly
      && mountRevision === previewPanelMountRevision,
    onTentative: () => { stagePlayback = currentPlayback === null ? null : structuredClone(currentPlayback); expectedTraceId = null; void invalidate('source-changed').catch(() => {});
      sourceState.dataset.previewSourceState = 'tentative'; sourceState.textContent = '舞台临时调整中，不作为正式运行观察。'; },
    onSaved: () => { refreshPreviewSourceState(); options.onSourceStateChange?.(); },
    onReplay: () => { void send(true, stagePlayback); },
  });
  workspace.insertBefore(stageWorkbench.element, traceBox);

  // 从时间轴面板进入时，previewTimelineId 可能仍指向“直演”临时场景。
  // 一旦用户选择普通剧情入口，必须立刻退出直演模式；否则下拉框显示的入口
  // 与实际发送给 iframe 的运行场景不一致，表现为“有背景/立绘但永远没有台词”。
  labelSel.onchange = () => {
    state.previewTimelineId = null;
    void send();
  };
  const updateLabels = () => {
    const scenes = projected?.scenes ?? collectPreviewScenes(state.scenes);
    const text = scenes.find(scene => scene.id === sceneSel.value)?.text
      ?? (projected === undefined && state.current ? state.scenes.get(state.current)?.text : undefined);
    labelSel.replaceChildren(fromStart);
    if (text !== undefined) for (const label of listLabels(text)) {
      const option = h('option', undefined, `从段落标记 ${label}`); option.value = label; labelSel.appendChild(option);
    }
  };
  sceneSel.onchange = () => { updateLabels(); void send(); };
  sourceSel.onchange = () => {
    selectedTarget = sourceSel.value === '' ? null : sourceOptions[Number(sourceSel.value)]!.target;
    sceneSel.value = ''; labelSel.value = '';
    void send().then(updateLabels);
  };
  const sourcePublisher = editorPreviewPublisher(state.dirHandle);
  const loadSources = async () => {
    if (sourcePublisher === null || state.reviewWorkspace !== null) return;
    await sourcePublisher.sources().then(sources => {
      if (mountRevision !== previewPanelMountRevision || !container.isConnected) return;
      sourceOptions = sources;
      if (selectedTarget !== null && !sources.some(source => JSON.stringify(source.target) === JSON.stringify(selectedTarget))) {
        sourceOptions = [...sources, { target: selectedTarget, title: isolated?.title ?? '之前选择的内容（需重新核对）' }];
      }
      sourceSel.replaceChildren(memoryOption);
      for (const [index, source] of sourceOptions.entries()) {
        const option = h('option', undefined, source.title); option.value = String(index); sourceSel.appendChild(option);
      }
      sourceSel.value = selectedTarget === null ? '' : String(sourceOptions.findIndex(source => JSON.stringify(source.target) === JSON.stringify(selectedTarget)));
    }).catch(error => { diagnostics.textContent = `试玩内容列表读取失败：${error instanceof Error ? error.message : String(error)}`; });
  };
  refreshSources.onclick = () => { void loadSources(); };
  void loadSources();

  notifyPreviewTarget = (message, source) => {
    if (mountRevision !== previewPanelMountRevision || !container.isConnected || source !== frame.contentWindow
      || message.traceId !== expectedTraceId || message.traceId !== currentTraceId || message.traceId !== targetTraceId
      || message.generation !== currentTraceGeneration) return;
    if (runningTarget !== null && targetStale(runningTarget)) return; // The edit already marked this start as old.
    if (message.status === 'reached') {
      const again = message.visit !== undefined && message.visit > 1 ? `（第 ${message.visit} 次到达）` : '';
      targetSection?.setStatus(`已停在 ${targetLabel}之前${again}。这一行还没有执行，按“继续运行”执行它。`, 'reached');
    } else targetSection?.setStatus(`没有到达 ${targetLabel}：${message.message}`, 'warning');
  };
  function stopTargetQuery(): void { targetWorker?.terminate(); targetWorker = null; targetSection?.setBusy(false); }
  /** Run the shared query on exactly the content this preview plays; only a reached result starts. */
  const findTarget = (): void => {
    const request = options.target;
    if (!targetSection || !request) return;
    stopTargetQuery();
    pendingTarget = null;
    const selected = selectedTarget;
    let input: PreviewPathOptions, files: Record<string, string>, sourceKey: string;
    try {
      input = targetSection.request();
      if (selected === null) {
        if (state.current === null || state.scenes.get(state.current)?.id !== request.sceneId) throw new Error('当前场景已切换，请回到这个场景后重新选择行。');
        files = previewQueryFiles(capturePreviewContent());
      } else {
        // A selected version is used only when this scene is the text being edited; line numbers must agree.
        const chosen = projected?.scenes.find(scene => scene.id === request.sceneId);
        const editing = [...state.scenes.values()].find(scene => scene.id === request.sceneId);
        if (isolated === undefined || JSON.stringify(isolated.target) !== JSON.stringify(selected)) throw new Error('所选试玩内容还在载入，请稍后再查找。');
        if (chosen === undefined || editing === undefined || chosen.text !== editing.text)
          throw new Error('所选“试玩内容”里的这个场景与正在编辑的剧本不同，行号对不上；请把试玩内容切回当前编辑内容。');
        files = { ...isolated.files };
      }
      sourceKey = targetKey(request.sceneId);
    } catch (error) {
      targetSection.setStatus(error instanceof Error ? error.message : String(error), 'warning');
      targetSection.setDetails([]);
      return;
    }
    const worker = new Worker(new URL('../preview-path-worker.ts', import.meta.url), { type: 'module' });
    targetWorker = worker;
    targetSection.setBusy(true);
    targetSection.setStatus('正在用真实运行查找路径…');
    targetSection.setDetails([]);
    const settle = (): boolean => targetWorker === worker && mountRevision === previewPanelMountRevision && container.isConnected;
    worker.onmessage = (event: MessageEvent<{ result?: { report: PreviewPathReport }; error?: { message: string; code: string } }>) => {
      if (!settle()) return;
      stopTargetQuery();
      if (event.data.error) { targetSection.setStatus(`不能从这一行开始：${event.data.error.message}`, 'warning'); return; }
      const report = event.data.result!.report;
      if (selectedTarget !== selected || targetKey(request.sceneId) !== sourceKey) {
        targetSection.setStatus('查找期间剧本已修改，结果属于旧版本；请重新查找。', 'warning');
        return;
      }
      const summary = describePreviewPath(report);
      targetSection.setStatus(summary.title, report.status === 'reached' ? 'reached' : 'warning');
      targetSection.setDetails(summary.details);
      if (report.status !== 'reached' || report.position === null) return;
      pendingTarget = { report, sourceKey, selected };
      if (ready) void send(false, undefined, pendingTarget);
    };
    worker.onerror = (event) => {
      if (!settle()) return;
      stopTargetQuery();
      targetSection.setStatus(`查找没有完成：${event.message || '查找进程出错'}`, 'warning');
    };
    worker.postMessage({ input: { files }, options: input });
  };
  targetSection?.onFind(findTarget);
  targetSection?.onCancel(() => { stopTargetQuery(); targetSection.setStatus('已取消查找。'); });

  notifyPreviewReady = (source) => {
    if (mountRevision !== previewPanelMountRevision || container.isConnected === false) return;
    if (!isCurrentPreviewFrameSource(source, frame.contentWindow)) return;
    ready = true;
    // A fresh preview starts without a try-out; only an active one is sent again.
    if (readingTrial.textScale !== null || readingTrial.reducedMotion !== null) sendReadingTrial();
    // "从这一行试玩" starts only from a reached result, never from the toolbar entry.
    if (options.target === undefined) void send(); // 就绪即播放当前场景
    else if (pendingTarget !== null) void send(false, undefined, pendingTarget);
  };
  bindPreviewReadyListenerOnce();

  playBtn.onclick = () => {
    // “重新播放”只重启当前预览入口。时间轴直演由 Timeline Desk 显式建立，
    // 重载不得悄悄降级成普通场景；只有上方入口选择器等明确导航动作才退出直演。
    void send();
  };
  resumeBtn.onclick = () => { void send(true); };
  debugCheck.onchange = () => { debugging = debugCheck.checked; debugPanel.hidden = !debugging; void send(); };
  fastChk.onchange = () => {
    frame.contentWindow?.postMessage({ type: 'surdet-preview-fast', fast: fastChk.checked }, '*');
  };

  findTarget();
  if (!sc) {
    diagnostics.textContent = '请先在左侧选择一个场景，再回到这里播放预览。';
    diagnostics.className = 'preview-diagnostics info';
  }
}
