/**
 * 预览面板（M6 E4，父窗口侧）：iframe 承载 preview.html 运行器，
 * 工具条提供"从场景开头/从标签播放"、快进开关、重新播放。
 * 预览源 = 编辑器内存中的剧本文本（未保存也能预览）；全量场景一并下发，
 * 跨场景 @jump 在预览内可正常跳转（多场景预览）。
 */
import { state, h, setStatus } from '../state.js';
import { parseScript } from '../model.js';
import type { EvidenceEnvelope, RuntimeTraceEvent } from '@surdet/authoring';
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
let notifyPreviewReady: (() => void) | null = null;
let notifyPreviewDiagnostic: ((diagnostic: PreviewDiagnostic) => void) | null = null;
let notifyPreviewTrace: ((message: PreviewTraceMessage, source: MessageEventSource | null) => void) | null = null;

export interface PreviewTraceStartMessage {
  type: 'surdet-preview-trace-start';
  traceId: string;
  generation: number;
  sceneId: string;
  label?: string;
}

export interface PreviewTraceEventMessage {
  type: 'surdet-preview-trace-event';
  traceId: string;
  generation: number;
  sequence: number;
  coreEmitted: true;
  presentationApplied: boolean;
  presentationBefore: unknown;
  presentationAfter: unknown;
  event: RuntimeTraceEvent;
}

export interface PreviewTraceCompleteMessage {
  type: 'surdet-preview-trace-complete';
  traceId: string;
  generation: number;
  status: 'passed' | 'failed';
  eventCount: number;
  firstError?: string;
  lastEvent?: RuntimeTraceEvent;
}

export type PreviewTraceMessage = PreviewTraceStartMessage | PreviewTraceEventMessage | PreviewTraceCompleteMessage;

/** 与 authoring EvidenceEnvelope 的 result 形状保持兼容，供后续正式证据接线使用。 */
export type PreviewTraceEvidence = EvidenceEnvelope<{
  traceId: string;
  generation: number;
  eventCount: number;
  firstError?: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRuntimeTraceEvent(value: unknown): value is RuntimeTraceEvent {
  if (!isRecord(value) || !isRecord(value['source'])) return false;
  const source = value['source'];
  return typeof value['kind'] === 'string'
    && typeof source['sceneId'] === 'string'
    && Number.isInteger(source['index'])
    && typeof source['op'] === 'string'
    && typeof source['file'] === 'string'
    && Number.isInteger(source['line'])
    && Number.isInteger(source['col']);
}

/** 只接受预览 iframe 输出的三类结构化轨迹消息；不把内部状态当成人工验收。 */
export function normalizePreviewTraceMessage(value: unknown): PreviewTraceMessage | null {
  if (!isRecord(value) || typeof value['type'] !== 'string' || typeof value['traceId'] !== 'string'
    || value['traceId'].trim().length === 0 || !Number.isInteger(value['generation']) || (value['generation'] as number) < 0) {
    return null;
  }
  const type = value['type'];
  const traceId = value['traceId'];
  const generation = value['generation'] as number;
  if (type === 'surdet-preview-trace-start') {
    if (typeof value['sceneId'] !== 'string' || value['sceneId'].trim().length === 0) return null;
    return {
      type,
      traceId,
      generation,
      sceneId: value['sceneId'],
      ...(typeof value['label'] === 'string' ? { label: value['label'] } : {}),
    };
  }
  if (type === 'surdet-preview-trace-event') {
    if (!Number.isInteger(value['sequence']) || value['sequence'] as number < 0
      || value['coreEmitted'] !== true || typeof value['presentationApplied'] !== 'boolean'
      || !('presentationBefore' in value) || !('presentationAfter' in value)
      || !isRuntimeTraceEvent(value['event'])) return null;
    return {
      type,
      traceId,
      generation,
      sequence: value['sequence'] as number,
      coreEmitted: true,
      presentationApplied: value['presentationApplied'],
      presentationBefore: value['presentationBefore'],
      presentationAfter: value['presentationAfter'],
      event: value['event'],
    };
  }
  if (type === 'surdet-preview-trace-complete') {
    if (!['passed', 'failed'].includes(String(value['status'])) || !Number.isInteger(value['eventCount'])
      || (value['eventCount'] as number) < 0 || (value['lastEvent'] !== undefined && !isRuntimeTraceEvent(value['lastEvent']))) return null;
    return {
      type,
      traceId,
      generation,
      status: value['status'] as 'passed' | 'failed',
      eventCount: value['eventCount'] as number,
      ...(typeof value['firstError'] === 'string' ? { firstError: value['firstError'] } : {}),
      ...(value['lastEvent'] === undefined ? {} : { lastEvent: value['lastEvent'] }),
    };
  }
  return null;
}

/** 父窗口只接受当前 iframe generation；旧预览的迟到消息必须丢弃。 */
export function acceptPreviewTraceMessage(message: PreviewTraceMessage | null, currentGeneration: number): PreviewTraceMessage | null {
  return message !== null && message.generation === currentGeneration ? message : null;
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
    if (d?.type === 'surdet-preview-ready') notifyPreviewReady?.();
    if (d?.type === 'surdet-preview-diagnostic') {
      const diagnostic = normalizePreviewDiagnostic((d as { diagnostic?: unknown }).diagnostic);
      if (diagnostic) notifyPreviewDiagnostic?.(diagnostic);
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

/** 预览字体缓存（避免每次点播放重读字体；key = 项目目录 + 角色路径 + 文件版本） */
let previewFontsCacheKey = '';
let previewFontsCache: Partial<Record<FontRole, PreviewFont>> = {};

/** 从项目目录读取 game.config.json 的字体角色文件；旧版 font 自动作为三个角色的来源。 */
async function readProjectFonts(): Promise<Partial<Record<FontRole, PreviewFont>>> {
  let cfg: Record<string, unknown>;
  try {
    cfg = state.gameConfigText.trim() ? JSON.parse(state.gameConfigText) as Record<string, unknown> : {};
  } catch {
    return {};
  }
  if (!state.dirHandle) return {};
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
      let dir: FileSystemDirectoryHandle = state.dirHandle;
      for (const s of segs) dir = await dir.getDirectoryHandle(s);
      const file = await (await dir.getFileHandle(fname)).getFile();
      files.set(role, file);
      versions.push(`${role}:${fontPath}:${file.lastModified}:${file.size}`);
    }
    const key = `${state.dirName}|${versions.join('|')}`;
    if (key === previewFontsCacheKey) return previewFontsCache;
    const result: Partial<Record<FontRole, PreviewFont>> = {};
    for (const [role, file] of files) {
      const ext = (file.name.split('.').pop() ?? '').toLowerCase();
      result[role] = {
        buffer: await file.arrayBuffer(),
        mime: MIME[ext] ?? 'font/ttf',
        version: `${file.lastModified}:${file.size}`,
      };
    }
    previewFontsCacheKey = key;
    previewFontsCache = result;
    return result;
  } catch {
    previewFontsCacheKey = '';
    previewFontsCache = {};
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
      if (asset.kind === 'bgm' || asset.kind === 'se' || asset.kind === 'voice') {
        audio.set(`${asset.kind}:${asset.key}`, {
          kind: asset.kind,
          key: asset.key,
          file: { buffer, mime: file.type || AUDIO_MIME[ext] || 'application/octet-stream' },
        });
        continue;
      }
      if (!asset.isImage || (asset.kind !== 'bg' && asset.kind !== 'portrait' && asset.kind !== 'avatar')) continue;
      const image = { buffer, mime: file.type || IMAGE_MIME[ext] || 'application/octet-stream' };
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

export function renderPreviewPanel(container: HTMLElement): void {
  container.innerHTML = '';
  if (state.reviewWorkspace === null) state.previewChoices = null;
  currentPreviewTrace = [];
  const sc = state.current ? state.scenes.get(state.current) : undefined;

  const toolbar = h('div', 'preview-toolbar');
  const labelSel = h('select');
  const fromStart = h('option', undefined, '从场景开头');
  fromStart.value = '';
  labelSel.appendChild(fromStart);
  if (sc) {
    for (const lb of listLabels(sc.text)) {
      const opt = h('option', undefined, `从 @label ${lb}`);
      opt.value = lb;
      labelSel.appendChild(opt);
    }
  }
  toolbar.appendChild(labelSel);

  const fastWrap = h('label', 'preview-fast');
  const fastChk = h('input');
  fastChk.type = 'checkbox';
  fastChk.checked = true;
  fastWrap.append(fastChk, document.createTextNode(' 快进速度（跳过打字机）'));
  toolbar.appendChild(fastWrap);

  const playBtn = h('button', 'primary', '▶ 播放 / 重载');
  toolbar.appendChild(playBtn);
  container.appendChild(toolbar);

  const frame = h('iframe', 'preview-frame');
  frame.src = './preview.html';
  frame.title = '剧情预览';
  container.appendChild(frame);
  const diagnostics = h('div', 'preview-diagnostics');
  diagnostics.setAttribute('aria-live', 'polite');
  container.appendChild(diagnostics);
  const traceBox = h('div', 'preview-trace');
  traceBox.id = 'preview-trace';
  traceBox.appendChild(h('h3', undefined, '因果轨迹'));
  const traceList = h('div', 'preview-trace-list');
  traceBox.appendChild(traceList);
  container.appendChild(traceBox);

  const renderTraceList = (): void => {
    traceList.innerHTML = '';
    const events = currentPreviewTrace.filter((message): message is PreviewTraceEventMessage => message.type === 'surdet-preview-trace-event');
    if (events.length === 0) {
      traceList.appendChild(h('div', 'empty', '尚无本次预览观察证据'));
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
      const button = h('button', message.sequence === state.selectedTraceStep ? 'preview-trace-event selected' : 'preview-trace-event');
      button.textContent = `#${message.sequence} ${message.event.kind} · ${source.sceneId}:${source.line}${message.presentationApplied ? ' · 演出已应用' : ''}`;
      button.title = selectedRef ?? '当前对象索引尚未定位该事件';
      button.onclick = () => {
        state.selectedTraceStep = message.sequence;
        state.selectedObjectRef = selectedRef;
        dispatchPreviewTraceSelection({ event: message.event, objectRef: selectedRef, sequence: message.sequence });
        renderTraceList();
      };
      traceList.appendChild(button);
    }
  };
  renderTraceList();

  let currentTraceId: string | null = null;
  let currentTraceGeneration = -1;
  notifyPreviewTrace = (message, source) => {
    if (source !== frame.contentWindow) return;
    if (message.type === 'surdet-preview-trace-start') {
      if (currentTraceGeneration >= 0 && message.generation < currentTraceGeneration) return;
      currentTraceGeneration = message.generation;
      currentTraceId = message.traceId;
      currentPreviewTrace = [message];
      state.previewTrace = [];
      state.selectedTraceStep = null;
      renderTraceList();
      return;
    }
    const current = acceptPreviewTraceMessage(message, currentTraceGeneration);
    if (current === null) return;
    if (current.traceId !== currentTraceId) return;
    currentPreviewTrace = [...currentPreviewTrace, current];
    if (current.type === 'surdet-preview-trace-event') state.previewTrace = [...state.previewTrace, current.event];
    renderTraceList();
  };

  let ready = false;
  let latestGeneration = 0;
  notifyPreviewDiagnostic = (diagnostic) => {
    if (diagnostic.generation < latestGeneration) return;
    latestGeneration = diagnostic.generation;
    diagnostics.textContent = `${diagnostic.level === 'error' ? '错误' : diagnostic.level === 'warning' ? '警告' : '状态'}：${diagnostic.message}${diagnostic.label ? `（@label ${diagnostic.label}）` : ''}`;
    diagnostics.className = `preview-diagnostics ${diagnostic.level}`;
  };
  /** 异步读取素材期间若用户重新选择播放入口，旧请求不得晚到覆盖新选择。 */
  let sendRevision = 0;
  const send = async (): Promise<void> => {
    const revision = ++sendRevision;
    currentTraceId = null;
    currentTraceGeneration = -1;
    currentPreviewTrace = [];
    state.previewTrace = [];
    state.selectedTraceStep = null;
    renderTraceList();
    if (!ready) return;
    const cur = state.current ? state.scenes.get(state.current) : undefined;
    if (!cur) {
      setStatus('预览：请先选择一个场景', false, 4000);
      return;
    }
    // 项目内嵌字体一并下发（预览首帧即用正确字体；缺失回退系统字体）
    const cachedFonts = await readProjectFonts();
    const fonts = clonePreviewFontsForTransfer(cachedFonts);
    const assets = await readProjectImages();
    const timelines = await readProjectTimelines();
    if (revision !== sendRevision) return;
    const message = {
      type: 'surdet-preview-load',
      payload: {
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
    frame.contentWindow?.postMessage(message, '*', transfer);
  };

  // 从时间轴面板进入时，previewTimelineId 可能仍指向“直演”临时场景。
  // 一旦用户选择普通剧情入口，必须立刻退出直演模式；否则下拉框显示的入口
  // 与实际发送给 iframe 的运行场景不一致，表现为“有背景/立绘但永远没有台词”。
  labelSel.onchange = () => {
    state.previewTimelineId = null;
    void send();
  };

  notifyPreviewReady = () => {
    ready = true;
    void send(); // 就绪即播放当前场景
  };
  bindPreviewReadyListenerOnce();

  playBtn.onclick = () => {
    state.previewTimelineId = null;
    void send();
  };
  fastChk.onchange = () => {
    frame.contentWindow?.postMessage({ type: 'surdet-preview-fast', fast: fastChk.checked }, '*');
  };

  if (!sc) {
    container.appendChild(h('div', 'empty', '请先在左侧选择一个场景，再回到本标签页播放预览。'));
  }
}
