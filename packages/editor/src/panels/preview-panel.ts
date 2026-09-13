/**
 * 预览面板（M6 E4，父窗口侧）：iframe 承载 preview.html 运行器，
 * 工具条提供"从场景开头/从标签播放"、快进开关、重新播放。
 * 预览源 = 编辑器内存中的剧本文本（未保存也能预览）；全量场景一并下发，
 * 跨场景 @jump 在预览内可正常跳转（多场景预览）。
 */
import { state, h, setStatus } from '../state.js';
import { parseScript } from '../model.js';
import { isPreviewSourcePath, normalizePreviewTraceMessage, previewSourceText,
  type RuntimeTraceEvent, type PreviewTraceMessage, type PreviewTraceEventMessage,
  type PreviewSourceFacts, type PreviewPublishInput } from '@surdet/authoring';
export { normalizePreviewTraceMessage, type PreviewTraceMessage, type PreviewTraceStartMessage,
  type PreviewTraceEventMessage, type PreviewTraceCompleteMessage } from '@surdet/authoring';
import { createEditorProjectStorage } from '../authoring-project-storage.js';
import { assetPathForHandle } from '../project-io.js';
import { editorPreviewPublisher, editorWorkspaceStatus } from '../editor-workspace.js';
import type { FontRole } from '@surdet/renderer';
import { normalizePreviewDiagnostic, type PreviewDiagnostic } from '../preview-diagnostics.js';
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

/** One actual runtime owner across script, standalone preview and result review. */
export function disposePreviewPanel(): void {
  previewPanelMountRevision += 1;
  const cleanup = activePreviewCleanup;
  activePreviewCleanup = null;
  notifyPreviewReady = null;
  notifyPreviewDiagnostic = null;
  notifyPreviewTrace = null;
  notifyPreviewSourceEdited = null;
  // Completed observations remain available when their source is opened.
  // Resource teardown must not erase the causal navigation's selected trace.
  cleanup?.();
}

export function refreshPreviewSourceState(): void { notifyPreviewSourceEdited?.(); }

function previewSourceKey(): string {
  return JSON.stringify({
    scene: state.current,
    scenes: [...state.scenes.entries()].map(([key, entry]) => [key, entry.id, entry.file, entry.text]),
    config: state.gameConfigText,
    configs: state.configFiles,
    timelines: state.timelines.map((entry) => [entry.file, entry.text]),
    assets: state.dirAssets.map((entry) => [entry.sourcePath, entry.key, entry.expr, entry.bytes, entry.lastModified]),
  });
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
  text: '显示台词',
  bg: '切换背景',
  portrait: '调整立绘',
  timeline: '播放演出',
  bgm: '播放背景音乐',
  se: '播放音效',
  voice: '播放语音',
  wait: '等待剧情时间',
};

/** 用户先读中文动作；内部 kind/op 只保留为次级技术信息。 */
export function projectPreviewTraceRow(message: PreviewTraceEventMessage): PreviewTraceRowProjection {
  const { kind, source } = message.event;
  const title = kind === 'instruction'
    ? INSTRUCTION_OP_LABELS[source.op] ?? TRACE_KIND_LABELS.instruction
    : TRACE_KIND_LABELS[kind] ?? '剧情事件';
  return {
    title,
    sourceLabel: `${source.sceneId} 场景 · 第 ${source.line} 行`,
    technicalLabel: `事件 ${message.sequence + 1} · ${kind} / ${source.op}`,
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
    obj = configText.trim() ? JSON.parse(configText) as Record<string, unknown> : {};
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
  backgrounds: { key: string; image: PreviewImage }[];
  portraits: { charId: string; costume: string; expression: string; image: PreviewImage }[];
  avatars: { key: string; image: PreviewImage }[];
  audio: { kind: 'bgm' | 'se' | 'voice'; key: string; file: PreviewImage }[];
}

interface SpeakerProfile {
  id: string;
  name: string;
  avatarKey?: string;
}

function parsePreviewSpeakerProfiles(configText: string): SpeakerProfile[] {
  try {
    const cfg = JSON.parse(configText) as Record<string, unknown>;
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

/** 按实际项目根隔离字体缓存；同名目录不能共享字体字节。 */
const previewFontsCache = new WeakMap<FileSystemDirectoryHandle, {
  key: string;
  fonts: Partial<Record<FontRole, PreviewFont>>;
}>();

/** 从项目目录读取 game.config.json 的字体角色文件；旧版 font 自动作为三个角色的来源。 */
async function readProjectFonts(): Promise<Partial<Record<FontRole, PreviewFont>>> {
  let cfg: Record<string, unknown>;
  try {
    cfg = state.gameConfigText.trim() ? JSON.parse(state.gameConfigText) as Record<string, unknown> : {};
  } catch {
    return {};
  }
  const root = state.dirHandle;
  if (!root) return {};
  const configured = cfg.fonts && typeof cfg.fonts === 'object'
    ? cfg.fonts as Partial<Record<FontRole, unknown>>
    : null;
  const legacy = typeof cfg.font === 'string' ? cfg.font : undefined;
  const paths: Partial<Record<FontRole, string>> = {};
  for (const role of ['body', 'title', 'ui'] as FontRole[]) {
    const path = configured && typeof configured[role] === 'string' ? configured[role] as string : legacy;
    if (path && path.length > 0) paths[role] = path;
  }
  if (Object.keys(paths).length === 0) return {};
  const MIME: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
  const files = new Map<FontRole, File>();
  const versions: string[] = [];
  try {
    for (const role of ['body', 'title', 'ui'] as FontRole[]) {
      const fontPath = paths[role];
      if (!fontPath) continue;
      const segs = fontPath.split('/').filter((s) => s.length > 0);
      const fname = segs.pop()!;
      let dir: FileSystemDirectoryHandle = root;
      for (const s of segs) dir = await dir.getDirectoryHandle(s);
      const file = await (await dir.getFileHandle(fname)).getFile();
      files.set(role, file);
      versions.push(`${role}:${fontPath}:${file.lastModified}:${file.size}`);
    }
    const key = versions.join('|');
    const cached = previewFontsCache.get(root);
    if (cached?.key === key) return cached.fonts;
    const result: Partial<Record<FontRole, PreviewFont>> = {};
    for (const [role, file] of files) {
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      result[role] = {
        buffer: await file.arrayBuffer(),
        mime: MIME[ext] ?? 'font/ttf',
        version: `${file.lastModified}:${file.size}`,
      };
    }
    previewFontsCache.set(root, { key, fonts: result });
    return result;
  } catch {
    previewFontsCache.delete(root);
    return {};
  }
}

/** 解析时间轴文本；单个坏文件隔离为 issue，合法定义继续进入预览。 */
export function parsePreviewTimelines(entries: readonly { id: string; text: string }[]): { definitions: unknown[]; issues: string[] } {
  const definitions: unknown[] = [];
  const issues: string[] = [];
  for (const entry of entries) {
    try {
      const value = JSON.parse(entry.text.replace(/^\uFEFF/, '')) as Record<string, unknown>;
      if (typeof value.id !== 'string' || value.id.trim().length === 0) {
        issues.push(`${entry.id}: 缺少时间轴 id`);
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

/** 读取项目目录中的背景和立绘字节。文件句柄不能跨 iframe 传递，只下发可结构化克隆的二进制数据。 */
async function readProjectImages(): Promise<PreviewAssets> {
  const backgrounds = new Map<string, { key: string; image: PreviewImage }>();
  const portraits = new Map<string, { charId: string; costume: string; expression: string; image: PreviewImage }>();
  const avatars = new Map<string, { key: string; image: PreviewImage }>();
  const audio = new Map<string, { kind: 'bgm' | 'se' | 'voice'; key: string; file: PreviewImage }>();
  for (const asset of state.dirAssets) {
    if (!asset.handle) continue;
    try {
      const file = await asset.handle.getFile();
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      const buffer = await file.arrayBuffer();
      const sourcePath = asset.sourcePath ?? assetPathForHandle(asset.handle);
      if (asset.kind === 'bgm' || asset.kind === 'se' || asset.kind === 'voice') {
        audio.set(`${asset.kind}:${asset.key}`, {
          kind: asset.kind,
          key: asset.key,
          file: { buffer, mime: file.type || AUDIO_MIME[ext] || 'application/octet-stream', sourcePath },
        });
        continue;
      }
      if (!asset.isImage || (asset.kind !== 'bg' && asset.kind !== 'portrait' && asset.kind !== 'avatar')) continue;
      const image = { buffer, mime: file.type || IMAGE_MIME[ext] || 'application/octet-stream', sourcePath };
      if (asset.kind === 'bg') {
        backgrounds.set(asset.key, { key: asset.key, image });
        continue;
      }
      if (asset.kind === 'avatar') {
        avatars.set(asset.key, { key: asset.key, image });
        continue;
      }
      const [charId, costume = 'normal'] = asset.key.split(':');
      const expression = asset.expr ?? 'normal';
      if (charId) portraits.set(`${asset.key}:${expression}`, { charId, costume, expression, image });
    } catch {
      // 单个损坏/失权素材不应阻断整个剧情预览；舞台会为缺失项保留占位回退。
    }
  }
  return { backgrounds: [...backgrounds.values()], portraits: [...portraits.values()], avatars: [...avatars.values()], audio: [...audio.values()] };
}

async function readProjectTimelines(): Promise<unknown[]> {
  return parsePreviewTimelines(state.timelines).definitions;
}

/** Hash the buffers actually sent to the iframe, before transferring their ownership. */
async function previewSourceFacts(assets: PreviewAssets): Promise<PreviewSourceFacts> {
  const storage = createEditorProjectStorage();
  const files = await Promise.all((await storage.listFiles()).filter(isPreviewSourcePath).map(async path => ({ path,
    sha256: await storage.sha256(previewSourceText(path, (await storage.readText(path)).text)) })));
  const buffers = [...assets.backgrounds.map(value => value.image), ...assets.portraits.map(value => value.image),
    ...assets.avatars.map(value => value.image), ...assets.audio.map(value => value.file)];
  const facts = await Promise.all(buffers.map(async value => {
    if (!value.sourcePath) throw new Error('无法核对预览素材来源，请重新加载项目。');
    const hash = await crypto.subtle.digest('SHA-256', value.buffer);
    return { path: value.sourcePath, sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
  }));
  return { files, assets: facts };
}

export interface PreviewPanelOptions {
  embedded?: boolean;
  onSourceStateChange?: () => void;
}

export function renderPreviewPanel(container: HTMLElement, options: PreviewPanelOptions = {}): void {
  if (!container.isConnected) return;
  disposePreviewPanel();
  state.previewTrace = [];
  state.selectedTraceStep = null;
  container.innerHTML = '';
  const mountRevision = ++previewPanelMountRevision;
  if (state.reviewWorkspace === null) state.previewChoices = null;
  currentPreviewTrace = [];
  const sc = state.current ? state.scenes.get(state.current) : undefined;

  const workspace = h('div', 'preview-workspace');
  workspace.setAttribute('data-preview-layout', options.embedded === true ? 'embedded' : 'standalone');
  const toolbar = h('header', 'preview-toolbar');
  const title = h('h2', 'preview-title', '剧情预览');
  toolbar.appendChild(title);
  const controls = h('div', 'preview-controls');
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

  const playBtn = h('button', 'preview-replay-action', '重新播放');
  playBtn.setAttribute('data-action', 'reload-preview');
  playBtn.setAttribute('data-action-scope', 'workspace');
  controls.appendChild(playBtn);
  toolbar.appendChild(controls);
  workspace.appendChild(toolbar);

  const stage = h('section', 'preview-stage');
  stage.setAttribute('aria-label', '剧情舞台');
  const frame = h('iframe', 'preview-frame');
  frame.src = './preview.html';
  frame.title = '剧情预览';
  stage.appendChild(frame);
  workspace.appendChild(stage);
  const diagnostics = h('div', 'preview-diagnostics');
  diagnostics.setAttribute('aria-live', 'polite');
  workspace.appendChild(diagnostics);
  const sourceState = h('p', 'preview-source-state', '尚未启动');
  sourceState.dataset.previewSourceState = 'idle';
  sourceState.setAttribute('aria-live', 'polite');
  workspace.appendChild(sourceState);
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
  activePreviewCleanup = () => { expectedTraceId = null; void invalidate('closed').catch(() => {}); frame.remove(); };
  notifyPreviewSourceEdited = () => {
    if (sourceState.dataset.previewSourceState !== 'stale' && publishedSource !== null && publishedSource !== previewSourceKey()) {
      sourceState.dataset.previewSourceState = 'stale';
      sourceState.textContent = '内容已修改；当前画面仍属于上一次运行，请重新播放。';
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
      const ref = locateObjectForTraceEvent({ event: message.event } satisfies CausalTraceEvent, state.authoringIndex ?? undefined);
      // @timeline 指令事件：用同一事件的前后 stage 快照差异反查具体 timeline cue（Wave 2 反向定位）。
      let selectedRef = ref;
      const instruction = ref === null ? undefined : state.authoringIndex?.byRef.get(ref);
      const timelineTarget = instruction?.references.find((candidate) => candidate.startsWith('timeline:'));
      if (source.op === 'timeline' && timelineTarget !== undefined && state.authoringIndex !== null) {
        const cueRefs = locateTimelineCuesForStageChange(
          message.presentationBefore,
          message.presentationAfter,
          state.authoringIndex,
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
        state.selectedObjectRef = selectedRef;
        dispatchPreviewTraceSelection({ event: message.event, objectRef: selectedRef, sequence: message.sequence });
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
    } else {
      traceCompleted = true;
    }
    currentPreviewTrace = [...currentPreviewTrace, current];
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
    diagnostics.textContent = `${diagnostic.level === 'error' ? '错误' : diagnostic.level === 'warning' ? '警告' : '状态'}：${diagnostic.message}${diagnostic.label ? `（@label ${diagnostic.label}）` : ''}`;
    diagnostics.className = `preview-diagnostics ${diagnostic.level}`;
  };
  /** 异步读取素材期间若用户重新选择播放入口，旧请求不得晚到覆盖新选择。 */
  let sendRevision = 0;
  const send = async (): Promise<void> => {
    const revision = ++sendRevision;
    if (!ready) return;
    try { await invalidate('reload'); }
    catch (error) {
      sourceState.textContent = `重新播放尚未开始，请重试：${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    if (revision !== sendRevision || mountRevision !== previewPanelMountRevision || !container.isConnected) return;
    expectedTraceId = null;
    const cur = state.current ? state.scenes.get(state.current) : undefined;
    if (!cur) {
      setStatus('预览：请先选择一个场景', false, 4000);
      return;
    }
    const requestRoot = state.dirHandle;
    const requestSceneKey = state.current;
    const requestScene = cur;
    const requestAssets = state.dirAssets;
    const requestSource = previewSourceKey();
    // 项目内嵌字体一并下发（预览首帧即用正确字体；缺失回退系统字体）
    const cachedFonts = await readProjectFonts();
    const fonts = clonePreviewFontsForTransfer(cachedFonts);
    const assets = await readProjectImages();
    const timelines = await readProjectTimelines();
    if (revision !== sendRevision || mountRevision !== previewPanelMountRevision || !container.isConnected) return;
    if (state.dirHandle !== requestRoot || state.current !== requestSceneKey
      || (requestSceneKey !== null && state.scenes.get(requestSceneKey) !== requestScene)
      || state.dirAssets !== requestAssets || previewSourceKey() !== requestSource) {
      sourceState.dataset.previewSourceState = 'stale';
      sourceState.textContent = '读取素材期间内容或项目发生变化，本次未启动，请重新播放。';
      return;
    }
    const traceId = `preview-${crypto.randomUUID()}`;
    let observationError: string | null = null;
    const publisher = editorPreviewPublisher(requestRoot);
    const status = editorWorkspaceStatus();
    if (publisher !== null && state.reviewWorkspace === null && state.previewTimelineId === null
      && !status.dirty && !status.saving && status.update === 'none') {
      const previewGeneration = ++publishedPreviewGeneration;
      try {
        const source = await previewSourceFacts(assets);
        if (revision !== sendRevision || mountRevision !== previewPanelMountRevision || previewSourceKey() !== requestSource) return;
        await publisher.publish({ action: 'begin', previewId: traceId, previewGeneration, sceneId: cur.id,
          ...(labelSel.value ? { label: labelSel.value } : {}), source,
          expectedProjectRevision: publisher.baseline.projectRevision,
          expectedCoordinationRevision: publisher.baseline.coordinationRevision });
        if (revision !== sendRevision || mountRevision !== previewPanelMountRevision || previewSourceKey() !== requestSource
          || state.dirHandle !== requestRoot || !container.isConnected) {
          await publisher.publish({ action: 'invalidate', previewGeneration, reason: 'source-changed' }).catch(() => {});
          return;
        }
        formal = { publisher, previewId: traceId, previewGeneration };
      } catch (error) {
        observationError = error instanceof Error ? error.message : String(error);
      }
    }
    if (revision !== sendRevision || mountRevision !== previewPanelMountRevision || previewSourceKey() !== requestSource
      || state.dirHandle !== requestRoot || !container.isConnected) return;
    const message = {
      type: 'surdet-preview-load',
      payload: {
        traceId,
        sceneId: cur.id,
        projectKey: state.dirName || 'untitled',
        // 全量场景下发：预览内跨场景 @jump 可正常跳转（多场景预览）
        scenes: collectPreviewScenes(state.scenes),
        speakerProfiles: parsePreviewSpeakerProfiles(state.gameConfigText),
        // 变量声明一并下发：真实剧本的 @set/@mod/@if 需要变量表（否则运行时错误卡死）
        variables: parsePreviewVariables(state.gameConfigText),
        // 编辑器管理的四套配置下发：预览轻宿主（日历/成长/成就/好感）；battle/shop 无配置仍占位
        configs: {
          calendar: state.configFiles.calendar ?? undefined,
          events: state.configFiles.events ?? undefined,
          growth: state.configFiles.growth ?? undefined,
          achievements: state.configFiles.achievements ?? undefined,
        },
        fonts: Object.keys(fonts).length > 0 ? fonts : undefined,
        assets,
        timelines: timelines.length > 0 ? timelines : undefined,
        timelinePreviewId: state.previewTimelineId ?? undefined,
        choices: state.previewChoices ?? undefined,
        startLabel: labelSel.value || undefined,
        fast: fastChk.checked,
      },
    };
    const transfer = [
      ...assets.backgrounds.map((a) => a.image.buffer),
      ...assets.portraits.map((a) => a.image.buffer),
      ...assets.avatars.map((a) => a.image.buffer),
      ...assets.audio.map((a) => a.file.buffer),
      ...Object.values(fonts).map((font) => font.buffer),
    ];
    const target = frame.contentWindow;
    if (!target) return;
    expectedTraceId = traceId;
    target.postMessage(message, '*', transfer);
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
    sourceState.textContent = observationError !== null ? `预览可继续，观察记录未能同步：${observationError}`
      : formal !== null ? '已载入保存的内容；Agent 可读取本次实际播放记录。'
      : '载入的是本次内存内容；运行结果以画面和实际轨迹为准。';
    options.onSourceStateChange?.();
  };

  // 从时间轴面板进入时，previewTimelineId 可能仍指向“直演”临时场景。
  // 一旦用户选择普通剧情入口，必须立刻退出直演模式；否则下拉框显示的入口
  // 与实际发送给 iframe 的运行场景不一致，表现为“有背景/立绘但永远没有台词”。
  labelSel.onchange = () => {
    state.previewTimelineId = null;
    void send();
  };

  notifyPreviewReady = (source) => {
    if (mountRevision !== previewPanelMountRevision || container.isConnected === false) return;
    if (!isCurrentPreviewFrameSource(source, frame.contentWindow)) return;
    ready = true;
    void send(); // 就绪即播放当前场景
  };
  bindPreviewReadyListenerOnce();

  playBtn.onclick = () => {
    // “重新播放”只重启当前预览入口。时间轴直演由 Timeline Desk 显式建立，
    // 重载不得悄悄降级成普通场景；只有上方入口选择器等明确导航动作才退出直演。
    void send();
  };
  fastChk.onchange = () => {
    frame.contentWindow?.postMessage({ type: 'surdet-preview-fast', fast: fastChk.checked }, '*');
  };

  if (!sc) {
    diagnostics.textContent = '请先在左侧选择一个场景，再回到这里播放预览。';
    diagnostics.className = 'preview-diagnostics info';
  }
}
