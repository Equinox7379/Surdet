/**
 * 预览运行器（M6 E4）：iframe 内嵌精简 runner —— core 编译 + Interpreter + AdvRenderer + PixiStage。
 * 预览源 = 编辑器内存中的剧本文本（未保存也能预览，postMessage 传入）。
 *
 * postMessage 协议（父窗口 → 预览）：
 *  { type: 'surdet-preview-load', payload: { sceneId, text, startLabel?, fast? } } → 编译并播放
 *  { type: 'surdet-preview-fast', fast: boolean }                                  → 切换打字速度
 * 预览就绪后向父窗口回 { type: 'surdet-preview-ready' }。
 *
 * system 类指令（@battle/@calendar/@shop…）在预览模式无宿主：解释器直接穿透，
 * 预览侧显示"宿主指令占位"横幅并继续（与设计一致：预览不实例化全家桶宿主）。
 */
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore } from '@surdet/core';
import type { CoreEventMap } from '@surdet/core';
import { AdvRenderer, Backlog, PixiStage, Typewriter } from '@surdet/renderer';

interface LoadPayload {
  sceneId: string;
  text: string;
  startLabel?: string;
  fast?: boolean;
}

/** 快进速度：每秒 1000 字（近似瞬时）；常规 30 字/秒 */
const FAST_CPS = 1000;
const NORMAL_CPS = 30;

let stage: PixiStage | null = null;
let renderer: AdvRenderer | null = null;
let bus: EventBus<CoreEventMap> | null = null;
let interp: Interpreter | null = null;

function showError(msg: string): void {
  const root = document.getElementById('preview-root');
  if (!root) return;
  let el = document.getElementById('preview-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'preview-error';
    root.appendChild(el);
  }
  el.textContent = msg;
}

function clearError(): void {
  document.getElementById('preview-error')?.remove();
}

async function boot(): Promise<void> {
  stage = new PixiStage();
  await stage.init();
  const root = document.getElementById('preview-root');
  if (root) root.appendChild(stage.app!.canvas);
  bus = new EventBus<CoreEventMap>();
  renderer = new AdvRenderer(stage, undefined, {
    typewriter: new Typewriter({ charsPerSecond: FAST_CPS }),
    backlog: new Backlog(),
    onAdvance: () => interp?.advance(),
    onSelect: (i) => interp?.choose(i),
    onWaitEnd: () => interp?.finishWait(),
  });
  renderer.subscribe(bus);
  // 宿主指令占位：预览无宿主，解释器穿透 system 事件；横幅提示后继续
  bus.on('system', (p) => {
    stage?.showBanner?.(`[宿主指令占位] @${p.type}（预览模式穿透）`, 'tip');
  });
  window.parent.postMessage({ type: 'surdet-preview-ready' }, '*');
}

function load(p: LoadPayload): void {
  if (!bus || !stage) return;
  clearError();
  try {
    const registry = new SceneRegistry();
    registry.register(compileScene(p.text, 'preview.gal', p.sceneId));
    interp = new Interpreter(new VariableStore([]), bus, registry);
    if (typeof p.fast === 'boolean') renderer?.setTextSpeed(p.fast ? FAST_CPS : NORMAL_CPS);
    interp.start(p.sceneId, p.startLabel);
  } catch (err) {
    showError(`预览编译失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { type?: string; payload?: LoadPayload; fast?: boolean } | null;
  if (!d || typeof d.type !== 'string') return;
  if (d.type === 'surdet-preview-load' && d.payload) load(d.payload);
  if (d.type === 'surdet-preview-fast') renderer?.setTextSpeed(d.fast ? FAST_CPS : NORMAL_CPS);
});

void boot();
