/**
 * 预览面板（M6 E4，父窗口侧）：iframe 承载 preview.html 运行器，
 * 工具条提供"从场景开头/从标签播放"、快进开关、重新播放。
 * 预览源 = 编辑器内存中的剧本文本（未保存也能预览）；全量场景一并下发，
 * 跨场景 @jump 在预览内可正常跳转（多场景预览）。
 */
import { state, h, setStatus } from '../state.js';
import { parseScript } from '../model.js';

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
  const send = (): void => {
    if (!ready) return;
    const cur = state.current ? state.scenes.get(state.current) : undefined;
    if (!cur) {
      setStatus('预览：请先选择一个场景', false, 4000);
      return;
    }
    frame.contentWindow?.postMessage({
      type: 'surdet-preview-load',
      payload: {
        sceneId: cur.id,
        // 全量场景下发：预览内跨场景 @jump 可正常跳转（多场景预览）
        scenes: collectPreviewScenes(state.scenes),
        startLabel: labelSel.value || undefined,
        fast: fastChk.checked,
      },
    }, '*');
  };

  notifyPreviewReady = () => {
    ready = true;
    send(); // 就绪即播放当前场景
  };
  bindPreviewReadyListenerOnce();

  playBtn.onclick = send;
  fastChk.onchange = () => {
    frame.contentWindow?.postMessage({ type: 'surdet-preview-fast', fast: fastChk.checked }, '*');
  };

  if (!sc) {
    container.appendChild(h('div', 'empty', '请先在左侧选择一个场景，再回到本标签页播放预览。'));
  }
}
