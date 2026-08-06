/**
 * 预览运行器（M6 E4）：iframe 内嵌精简 runner —— core 编译 + Interpreter + AdvRenderer + PixiStage。
 * 预览源 = 编辑器内存中的剧本文本（未保存也能预览，postMessage 传入）；
 * 全量场景注册进 SceneRegistry，跨场景 @jump 在预览内可正常跳转（多场景预览）。
 *
 * postMessage 协议（父窗口 → 预览）：
 *  { type: 'surdet-preview-load', payload: { sceneId, scenes: [{id,text}], startLabel?, fast? } } → 编译并播放
 *  { type: 'surdet-preview-fast', fast: boolean }                                  → 切换打字速度
 * 预览就绪后向父窗口回 { type: 'surdet-preview-ready' }。
 *
 * system 类指令（@battle/@calendar/@shop…）在预览模式无宿主：解释器直接穿透，
 * 预览侧显示"宿主指令占位"横幅并继续（与设计一致：预览不实例化全家桶宿主）。
 */
import { compileScene, EventBus, Interpreter, SceneRegistry, VariableStore } from '@surdet/core';
import type { CoreEventMap, VarDeclaration } from '@surdet/core';
import { AdvRenderer, Backlog, PixiStage, Typewriter } from '@surdet/renderer';

interface SceneSrc { id: string; text: string }

interface LoadPayload {
  sceneId: string;
  scenes: SceneSrc[];
  /** game.config.json 变量声明（父窗口提取后下发；缺省按空表） */
  variables?: Record<string, unknown>[];
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

/** 解释器推进守卫：运行时错误（变量未定义等）可见化，不静默卡死 */
function guardRun(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    showError(`预览运行时错误：${err instanceof Error ? err.message : String(err)}`);
  }
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
    onAdvance: () => guardRun(() => interp?.advance()),
    onSelect: (i) => guardRun(() => interp?.choose(i)),
    onWaitEnd: () => guardRun(() => interp?.finishWait()),
  });
  renderer.subscribe(bus);
  // 帧驱动 + 输入接线（宿主模板标准两行；此前遗漏导致打字机永不推进、点击无响应）
  stage.app!.ticker.add((ticker) => renderer?.update(ticker.deltaMS));
  stage.app!.canvas.addEventListener('pointerdown', () => {
    const s = interp?.status;
    if (s === 'awaiting-advance' || s === 'awaiting-timer') renderer?.advance();
  });
  // 键盘推进（Space/Enter，对齐 starter 键位习惯）
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const s = interp?.status;
      if (s === 'awaiting-advance' || s === 'awaiting-timer') renderer?.advance();
    }
  });
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
    // 全量场景编译入注册表（逐场景捕获错误，报出具体哪个场景编译失败）
    for (const s of p.scenes ?? []) {
      try {
        registry.register(compileScene(s.text, `${s.id}.gal`, s.id));
      } catch (err) {
        throw new Error(`场景 ${s.id} 编译失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!registry.has(p.sceneId)) {
      throw new Error(`入口场景 '${p.sceneId}' 不在预览场景集中`);
    }
    // 变量表来自 game.config.json（父窗口下发）：真实剧本的 @set/@mod/@if 需要它
    interp = new Interpreter(new VariableStore((p.variables ?? []) as unknown as VarDeclaration[]), bus, registry);
    if (typeof p.fast === 'boolean') renderer?.setTextSpeed(p.fast ? FAST_CPS : NORMAL_CPS);
    interp.start(p.sceneId, p.startLabel);
  } catch (err) {
    showError(`预览失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  const d = e.data as { type?: string; payload?: LoadPayload; fast?: boolean } | null;
  if (!d || typeof d.type !== 'string') return;
  if (d.type === 'surdet-preview-load' && d.payload) load(d.payload);
  if (d.type === 'surdet-preview-fast') renderer?.setTextSpeed(d.fast ? FAST_CPS : NORMAL_CPS);
});

// 调试探针（对齐 starter surdetDebug / 编辑器 surdetEditorDebug 惯例）：验收/自动化直接观察预览运行态
(window as unknown as Record<string, unknown>).surdetPreviewDebug = {
  get interp(): Interpreter | null { return interp; },
  get renderer(): AdvRenderer | null { return renderer; },
  get stage(): PixiStage | null { return stage; },
};

void boot();
