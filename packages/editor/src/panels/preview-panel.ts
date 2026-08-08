/**
 * 预览面板（M6 E4，父窗口侧）：iframe 承载 preview.html 运行器，
 * 工具条提供"从场景开头/从标签播放"、快进开关、重新播放。
 * 预览源 = 编辑器内存中的剧本文本（未保存也能预览）；全量场景一并下发，
 * 跨场景 @jump 在预览内可正常跳转（多场景预览）。
 */
import { state, h, setStatus } from '../state.js';
import { parseScript } from '../model.js';
import type { FontRole } from '@surdet/renderer';

/** 预览就绪监听器：模块级单例注册，避免反复进出预览标签页时监听器累积（M6 审阅轮 Minor 1） */
let previewReadyListenerBound = false;
let notifyPreviewReady: (() => void) | null = null;

function bindPreviewReadyListenerOnce(): void {
  if (previewReadyListenerBound) return;
  previewReadyListenerBound = true;
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as { type?: string } | null;
    if (d?.type === 'surdet-preview-ready') notifyPreviewReady?.();
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

  let ready = false;
  const send = async (): Promise<void> => {
    if (!ready) return;
    const cur = state.current ? state.scenes.get(state.current) : undefined;
    if (!cur) {
      setStatus('预览：请先选择一个场景', false, 4000);
      return;
    }
    // 项目内嵌字体一并下发（预览首帧即用正确字体；缺失回退系统字体）
    const fonts = await readProjectFonts();
    const assets = await readProjectImages();
    const timelines = await readProjectTimelines();
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
