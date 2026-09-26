import type { StageInspection, StageInspectionObject } from '@surdet/core';
import type { RendererRuntime } from '@surdet/renderer';
import type { PreviewRuntimeLifecycle } from './preview-runtime-lifecycle.js';

interface Adjustment {
  token: string;
  snapshot: unknown;
  paused: boolean;
  selected: string | null;
  axes: ('x' | 'y')[];
  pointer: { id: number; x: number; y: number; pose: { x: number; y: number } } | null;
}

/** Parent-controlled scratch adjustment. All source writes remain in the
 * authoring workspace; the iframe owns only the temporary visible projection. */
export function installStagePreviewBridge(runtime: RendererRuntime, lifecycle: PreviewRuntimeLifecycle<RendererRuntime>,
  onTentative: () => void): { reset(): void } {
  let adjustment: Adjustment | null = null;
  const inspect = (): StageInspection => {
    const value = runtime.queries.world.inspectStage?.();
    if (!value) throw new Error('当前预览未提供舞台对象查询');
    return value;
  };
  const post = (token: string, payload: Record<string, unknown>) => window.parent.postMessage({ type: 'surdet-stage-state', token, ...payload }, window.location.origin);
  const object = (id: string): StageInspectionObject => {
    const result = inspect().objects.find(object => object.id === id);
    if (!result) throw new Error('选定舞台对象已不存在');
    return result;
  };
  const apply = (id: string, values: Record<string, unknown>) => {
    const target = object(id);
    const modifiers = Object.fromEntries(Object.entries(values).map(([key, value]) => {
      if (!['x', 'y', 'scale', 'opacity', 'z', 'facing', 'baseHeight', 'anchorX', 'anchorY'].includes(key)
        || (key === 'facing' ? value !== 'left' && value !== 'right' : typeof value !== 'number' || !Number.isFinite(value))) throw new Error('临时舞台属性无效');
      return [key, String(value)];
    }));
    if (!Object.keys(modifiers).length) return;
    const command = runtime.commands.world.applyStage;
    if (!command) throw new Error('当前预览未提供舞台变换');
    command(target.kind === 'layer' ? { type: 'layer-pose', id: target.target, modifiers, durationMs: 0 }
      : { type: 'pose', target: target.target, modifiers, durationMs: 0 });
  };
  lifecycle.listen(window, 'message', (event: MessageEvent) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data.type !== 'string' || !data.type.startsWith('surdet-stage-') || typeof data.token !== 'string'
      || !/^[a-f0-9-]{36}$/.test(data.token)) return;
    try {
      if (data.type === 'surdet-stage-begin') {
        if (adjustment) throw new Error('请先取消当前舞台调整');
        const snapshot = runtime.controller.snapshotPresentation();
        const state = inspect();
        adjustment = { token: data.token, snapshot, paused: runtime.controller.presentationPaused === true, selected: null, axes: [], pointer: null };
        runtime.controller.setPresentationPaused?.(true); onTentative();
        post(data.token, { state, status: 'ready' }); return;
      }
      if (!adjustment || adjustment.token !== data.token) return;
      if (data.type === 'surdet-stage-cancel') {
        const saved = adjustment;
        runtime.controller.restorePresentation(saved.snapshot);
        runtime.controller.setPresentationPaused?.(saved.paused);
        adjustment = null;
        post(data.token, { status: 'cancelled' }); return;
      }
      if (data.type === 'surdet-stage-select') {
        if (typeof data.id !== 'string' || !Array.isArray(data.axes) || data.axes.some(axis => axis !== 'x' && axis !== 'y')) throw new Error('舞台选择无效');
        object(data.id); adjustment.selected = data.id; adjustment.axes = [...new Set(data.axes)] as ('x' | 'y')[]; adjustment.pointer = null;
        return;
      }
      if (data.type === 'surdet-stage-patch') {
        if (typeof data.id !== 'string' || data.id !== adjustment.selected || !data.values || typeof data.values !== 'object' || Array.isArray(data.values)) throw new Error('舞台调整目标已改变');
        apply(data.id, data.values as Record<string, unknown>);
        post(data.token, { status: 'adjusted', state: inspect(), changed: { id: data.id, values: data.values } });
      }
    } catch (error) { post(data.token, { status: 'error', error: error instanceof Error ? error.message : String(error) }); }
  });
  // Installed before the preview's ordinary advance listener.
  lifecycle.listen(runtime.canvas, 'pointerdown', event => {
    if (!adjustment) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.button !== 0 || !adjustment.selected || !adjustment.axes.length) return;
    const target = object(adjustment.selected);
    adjustment.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY,
      pose: { x: Number(target.pose.x), y: Number(target.pose.y) } };
    runtime.canvas.setPointerCapture(event.pointerId);
  }, { capture: true });
  lifecycle.listen(runtime.canvas, 'pointermove', event => {
    const current = adjustment;
    if (!current?.pointer || current.pointer.id !== event.pointerId || !current.selected) return;
    event.preventDefault(); event.stopImmediatePropagation();
    try {
      const state = inspect(), rect = runtime.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const values: Record<string, number> = {};
      if (current.axes.includes('x')) values.x = Math.max(-100000, Math.min(100000, current.pointer.pose.x + (event.clientX - current.pointer.x) * state.design.width / rect.width / state.camera.scale));
      if (current.axes.includes('y')) values.y = Math.max(-100000, Math.min(100000, current.pointer.pose.y + (event.clientY - current.pointer.y) * state.design.height / rect.height / state.camera.scale));
      apply(current.selected, values);
      post(current.token, { status: 'adjusted', state: inspect(), changed: { id: current.selected, values } });
    } catch (error) { post(current.token, { status: 'error', error: error instanceof Error ? error.message : String(error) }); }
  }, { capture: true });
  const release = (event: PointerEvent) => {
    if (!adjustment) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (adjustment.pointer?.id === event.pointerId) {
      adjustment.pointer = null;
      if (runtime.canvas.hasPointerCapture(event.pointerId)) runtime.canvas.releasePointerCapture(event.pointerId);
    }
  };
  lifecycle.listen(runtime.canvas, 'pointerup', release, { capture: true });
  lifecycle.listen(runtime.canvas, 'pointercancel', release, { capture: true });
  lifecycle.listen(window, 'keydown', event => {
    if (!adjustment) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      const saved = adjustment;
      try { runtime.controller.restorePresentation(saved.snapshot); runtime.controller.setPresentationPaused?.(saved.paused); adjustment = null; post(saved.token, { status: 'cancelled' }); }
      catch (error) { post(saved.token, { status: 'error', error: error instanceof Error ? error.message : String(error) }); }
    } else if (event.key === 'Enter') post(adjustment.token, { status: 'apply-requested' });
  }, { capture: true });
  return { reset() { adjustment = null; } };
}
