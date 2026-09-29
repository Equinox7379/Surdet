import type { StageInspection, StageInspectionObject, StageSource } from '@surdet/core';
import { validStageSource } from '@surdet/core';
import { state } from './state.js';
import { applyStageSourceEdit, assertStageEditCurrent, captureStageEditBaseline, sourceForStageProperty, stageSourceLabel,
  type StageEditBaseline, type StageEditValues } from './stage-editing.js';
import { createStageCalibrationPanel } from './stage-calibration-panel.js';
import { readStageConfigDraft, editStageConfigDraft } from './panels/config.js';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element;
};
const sourceKey = (source: StageSource | null) => JSON.stringify(source);
const PROPERTY_NAMES: Record<string, string> = { x: '横坐标', y: '纵坐标', scale: '缩放', opacity: '透明度', z: '层内顺序', facing: '朝向' };

export function createStageWorkspace(options: {
  frame: HTMLIFrameElement;
  canEdit(): boolean;
  canInspect?(): boolean;
  canEditConfiguration?(): boolean;
  onTentative(): void;
  onSaved(): void;
  onReplay(): void;
}): { element: HTMLElement; reset(): void; dispose(): void } {
  const root = el('details'); root.className = 'stage-adjustment-workspace';
  root.append(el('summary', '舞台对象与演出调整'));
  const status = el('p', '暂停当前预览后选择对象。调整只作用于临时画面，应用来源后才进入编辑草稿。'); status.setAttribute('role', 'status');
  const actions = el('div'); actions.className = 'preview-controls';
  const begin = el('button', '暂停并读取舞台'), cancel = el('button', '取消调整'), apply = el('button', '应用到选定来源');
  for (const button of [begin, cancel, apply]) button.type = 'button';
  actions.append(begin, cancel, apply);
  const objectList = el('select'); objectList.setAttribute('aria-label', '舞台对象列表');
  const sourceList = el('select'); sourceList.setAttribute('aria-label', '要修改的舞台属性来源');
  const provenance = el('p');
  const fields = el('div'); fields.className = 'config-scalars';
  const clipConfirm = el('input'); clipConfirm.type = 'checkbox';
  const clipLabel = el('label', '确认修改片段定义，这会影响其全部引用'); clipLabel.prepend(clipConfirm);
  const upgrade = el('input'); upgrade.type = 'checkbox';
  const upgradeLabel = el('label', '需要时将所选旧时间轴升级为版本 2'); upgradeLabel.prepend(upgrade);
  root.append(status, actions, el('p', '对象列表包括透明、重叠和画面外的对象；拖动选中的对象时，只接管当前来源的横、纵坐标。'), objectList, sourceList, provenance, fields, clipLabel, upgradeLabel);
  let token: string | null = null, baseline: StageEditBaseline | null = null, inspection: StageInspection | null = null;
  let selected: StageInspectionObject | null = null, source: StageSource | null = null;
  let sources: StageSource[] = [], values: StageEditValues = {}, disposed = false, busy = false;
  const controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const post = (type: string, data: Record<string, unknown> = {}) => { if (token) options.frame.contentWindow?.postMessage({ type, token, ...data }, window.location.origin); };
  const editable = () => !disposed && root.isConnected && !root.closest('[inert]') && options.canEdit() && !state.projectWriteLock && !state.projectLoading && state.pendingSceneCommit == null;
  const sync = () => {
    begin.disabled = busy || token !== null;
    cancel.disabled = busy || token === null;
    apply.disabled = busy || !token || !source || !Object.keys(values).length || !editable();
    apply.textContent = source?.kind === 'composition' ? '应用到构图草稿' : '应用到选定来源';
    clipLabel.hidden = source?.kind !== 'timeline' || !source.instances?.length;
    upgradeLabel.hidden = source?.kind !== 'timeline';
    objectList.disabled = sourceList.disabled = busy || !token || Object.keys(values).length > 0;
  };
  const chooseSource = () => {
    source = sources[Number(sourceList.value)] ?? null; fields.replaceChildren(); controls.clear(); values = {};
    if (!selected) { sync(); return; }
    const target = selected;
    provenance.textContent = [...new Set(['x', 'y', 'scale', 'opacity', 'z', ...(target.kind === 'portrait' ? ['facing'] : [])].map(property => `${PROPERTY_NAMES[property]}：${stageSourceLabel(sourceForStageProperty(target, property))}`))].join('；');
    for (const property of ['x', 'y', 'scale', 'opacity', 'z', ...(target.kind === 'portrait' ? ['facing'] : [])]) {
      const label = el('label', PROPERTY_NAMES[property]);
      let control: HTMLInputElement | HTMLSelectElement;
      if (property === 'facing') {
        const select = el('select'); for (const [value, name] of [['right', '向右'], ['left', '向左']]) { const option = el('option', name); option.value = value!; select.append(option); } control = select;
      } else { const input = el('input'); input.type = 'number'; input.step = ['scale', 'opacity'].includes(property) ? '.01' : '1'; control = input; }
      control.value = String(target.pose[property as keyof typeof target.pose] ?? (property === 'facing' ? 'right' : 0));
      control.setAttribute('aria-label', `舞台${label.textContent}`);
      control.disabled = !editable() || !source || sourceKey(sourceForStageProperty(target, property)) !== sourceKey(source);
      control.onchange = () => {
        if (!editable() || control.disabled || !control.isConnected || selected !== target || !token) return;
        const value = property === 'facing' ? control.value : Number(control.value);
        (values as Record<string, string | number>)[property] = value;
        post('surdet-stage-patch', { id: target.id, values: { [property]: value } }); sync();
      };
      controls.set(property, control); label.append(control); fields.append(label);
    }
    const axes = ['x', 'y'].filter(property => editable() && sourceKey(sourceForStageProperty(target, property)) === sourceKey(source));
    post('surdet-stage-select', { id: target.id, axes }); sync();
  };
  const chooseObject = () => {
    selected = inspection?.objects.find(object => object.id === objectList.value) ?? null;
    sourceList.replaceChildren(); sources = [];
    if (selected) for (const property of ['x', 'y', 'scale', 'opacity', 'z', 'facing']) {
      const origin = sourceForStageProperty(selected, property);
      if (origin && !sources.some(source => sourceKey(source) === sourceKey(origin))) sources.push(origin);
    }
    sources.forEach((source, index) => { const option = el('option', stageSourceLabel(source)); option.value = String(index); sourceList.append(option); });
    chooseSource();
  };
  objectList.onchange = chooseObject; sourceList.onchange = chooseSource;
  const reset = () => { token = null; baseline = null; inspection = null; selected = null; source = null; values = {}; sources = []; fields.replaceChildren(); objectList.replaceChildren(); sourceList.replaceChildren(); sync(); };
  begin.onclick = () => {
    if (disposed || busy || token || !root.isConnected) return;
    if (options.canInspect && !options.canInspect()) { status.textContent = '请等待当前预览载入完成后再读取舞台。'; return; }
    baseline = captureStageEditBaseline(); token = crypto.randomUUID();
    status.textContent = '正在读取当前画面与真实属性来源…'; options.onTentative(); post('surdet-stage-begin'); sync();
  };
  cancel.onclick = () => { if (!busy) post('surdet-stage-cancel'); };
  apply.onclick = async () => {
    if (!editable() || busy || !token || !source || !baseline || !Object.keys(values).length) return;
    const origin = source, capture = baseline, currentToken = token;
    busy = true; sync();
    try {
      if (origin.kind === 'composition') {
        assertStageEditCurrent(capture);
        if (!selected || selected.kind !== 'layer') throw new Error('请选择实际构图图层。');
        const stage = JSON.parse(readStageConfigDraft());
        const layer = stage?.compositions?.[origin.id]?.layers?.find((layer: { id: string }) => layer.id === selected!.target);
        if (!layer || state.gameConfigText !== capture.configText) throw new Error('构图来源已经变化。');
        Object.assign(layer, values);
        editStageConfigDraft(JSON.stringify(stage, null, 2));
        calibration.refreshDraft();
      } else await applyStageSourceEdit(capture, origin, values, { allowVersionUpgrade: upgrade.checked, allowClipDefinition: clipConfirm.checked });
      if (token !== currentToken || disposed) return;
      post('surdet-stage-cancel'); reset();
      status.textContent = origin.kind === 'composition' ? '构图已加入配置草稿，可撤销；保存后重新播放生效。' : '已写入所选来源的编辑草稿，可使用原撤销功能；尚未保存到项目文件。';
      if (origin.kind !== 'composition') options.onReplay();
    } catch (error) { status.textContent = `${error instanceof Error ? error.message : String(error)} 试改数值仍保留。`; }
    finally { busy = false; sync(); }
  };
  const receive = (event: MessageEvent) => {
    if (disposed || !root.isConnected || event.source !== options.frame.contentWindow || event.origin !== window.location.origin) return;
    const message = event.data as Record<string, any> | null;
    if (!message || message.type !== 'surdet-stage-state' || message.token !== token || !token) return;
    if (message.status === 'apply-requested') { if (!apply.disabled) apply.click(); return; }
    if (message.status === 'error') { status.textContent = String(message.error); return; }
    if (message.status === 'cancelled') { reset(); status.textContent = '临时画面已恢复，未改动来源；重新播放可恢复正式观察记录。'; return; }
    if (!message.state || !Array.isArray(message.state.objects)) return;
    if (message.status === 'ready') {
      const next = message.state as StageInspection;
      if (next.objects.some(object => !object.id || !object.pose || object.source && !validStageSource(object.source))) return;
      inspection = next; objectList.replaceChildren();
      next.objects.forEach(object => { const option = el('option', `${object.kind === 'portrait' ? '角色' : '图层'} ${object.target}${object.pose.opacity === 0 ? '（透明）' : ''}`); option.value = object.id; objectList.append(option); });
      chooseObject();
      status.textContent = editable() ? '演出时钟已暂停。数值和拖动只调整临时画面；选择准确来源后再应用。' : '只读查看当前对象，不能回写此来源。';
    } else if (message.status === 'adjusted' && selected && message.changed?.id === selected.id) {
      // Keep origins from the unmodified snapshot. A temporary pose claim is
      // never relabelled as an authored instruction or a formal observation.
      for (const [key, value] of Object.entries(message.changed.values ?? {})) {
        if (!controls.has(key) || controls.get(key)!.disabled) continue;
        (values as Record<string, unknown>)[key] = value; controls.get(key)!.value = String(value);
      }
      status.textContent = '临时调整，尚未应用来源。'; sync();
    }
  };
  root.addEventListener('keydown', event => {
    if (!token || busy || !editable()) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel.click(); }
    else if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type === 'number') {
      event.preventDefault(); event.stopPropagation(); event.target.dispatchEvent(new Event('change'));
      if (!apply.disabled) apply.click();
    }
  });
  window.addEventListener('message', receive);
  const calibration = createStageCalibrationPanel(options.onSaved, () => token === null && (options.canEditConfiguration?.() ?? editable()));
  root.append(calibration.element);
  sync();
  return { element: root, reset, dispose() { if (token) post('surdet-stage-cancel'); disposed = true; window.removeEventListener('message', receive); calibration.dispose(); reset(); } };
}
