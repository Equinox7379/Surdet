import { assertUniquePortraitBindings, parseProjectStage, portraitSourcePaths, readProjectStage, resolveProjectPortraits, samplePortraitVisual } from '@surdet/core';
import { parseProjectConfigDocument } from '@surdet/authoring';
import { state } from './state.js';
import { assetPathForHandle, runProjectWriteOperation } from './project-io.js';
import { readStageConfigDraft, editStageConfigDraft, reloadStageConfigDraft, saveStageConfigDraftUnlocked, configUndo, configRedo } from './panels/config.js';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element;
};
const digest = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Human-confirmed visible-frame calibration. No alpha scanning, automatic
 * cropping, secret source access or whole-project JSON overwrite. */
export function createStageCalibrationPanel(onSaved: () => void, isEditable: () => boolean = () => true): { element: HTMLElement; refreshDraft(): void; dispose(): void } {
  const root = node('details'); root.className = 'stage-configuration';
  root.append(node('summary', '舞台配置与图片校准'));
  const status = node('p'); status.setAttribute('role', 'status');
  const form = node('textarea'); form.rows = 13; form.spellcheck = false; form.setAttribute('aria-label', '舞台配置 JSON');
  const technical = node('details'); technical.append(node('summary', '位置、距离与构图配置'),
    node('p', '只编辑 stage 对象。positions 为命名坐标，distances 为命名倍率，compositions 为背景和图层。其他项目字段保持原样。'), form);
  let configText = state.gameConfigText, projectRoot = state.dirHandle, projectName = state.dirName, disposed = false, busy = false;
  let bitmap: ImageBitmap | null = null;
  let loaded: { path: string; sha256: string; width: number; height: number; role: string; outfit: string; expression: string; fileHandle: FileSystemFileHandle;
    parts: { handle: FileSystemFileHandle; sha256: string }[] } | null = null;
  let readSequence = 0;
  const canUse = () => isEditable() && !disposed && root.isConnected && !root.closest('[inert]') && state.pendingSceneCommit == null && !state.projectLoading && !state.reviewWorkspace && !state.reviewPreviewReadOnly
    && state.dirHandle === projectRoot && state.dirName === projectName && !state.projectWriteLock;
  const readValue = (): Record<string, any> => {
    form.value = readStageConfigDraft();
    const value: unknown = JSON.parse(form.value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('舞台配置须是对象；关闭舞台使用下方关闭按钮。');
    parseProjectStage(value); return value as Record<string, any>;
  };
  const loadConfig = () => {
    projectRoot = state.dirHandle; projectName = state.dirName; configText = state.gameConfigText;
    form.value = readStageConfigDraft();
  };
  try { loadConfig(); } catch (error) { status.textContent = String(error); }
  const controls = node('div'); controls.className = 'config-scalars';
  const button = (label: string, action: () => void | Promise<void>) => {
    const b = node('button', label); b.type = 'button'; b.onclick = () => { if (canUse() && !busy) void Promise.resolve(action()).catch(error => { status.textContent = error instanceof Error ? error.message : String(error); }); }; return b;
  };
  form.oninput = () => { if (canUse() && !busy) editStageConfigDraft(form.value, true); };
  const setDraft = (value: Record<string, unknown> | null) => {
    const text = JSON.stringify(value, null, 2); editStageConfigDraft(text); form.value = text;
  };
  const save = async () => {
    if (!canUse()) throw new Error('项目已切换或只读，未写入配置。');
    busy = true;
    try {
      const result = await runProjectWriteOperation(saveStageConfigDraftUnlocked);
      if (disposed) return;
      configText = result.text; form.value = readStageConfigDraft();
      status.textContent = '舞台配置已通过共享事务保存。重新播放后使用新配置。'; onSaved();
    } finally { busy = false; }
  };
  controls.append(button('读取当前配置', () => { form.value = reloadStageConfigDraft(); status.textContent = '已读取当前项目配置，其他草稿保留。'; }),
    button('保存舞台配置', save),
    button('撤销配置编辑', () => { configUndo(); form.value = readStageConfigDraft(); status.textContent = '已撤销草稿编辑；保存后才改变项目文件。'; }),
    button('重做配置编辑', () => { configRedo(); form.value = readStageConfigDraft(); }),
    button('关闭新舞台配置', () => { if (window.confirm('仅在草稿中移除 stage 配置，不删除图片或剧情。保存后生效。')) setDraft(null); }));
  root.append(status, controls, technical);

  const presets = node('details'); presets.append(node('summary', '添加位置或距离方案'));
  const positionName = node('input'); positionName.placeholder = '位置名称'; positionName.setAttribute('aria-label', '新舞台位置名称');
  const x = node('input'), y = node('input'); x.type = y.type = 'number'; x.value = '640'; y.value = '720'; x.setAttribute('aria-label', '位置横坐标'); y.setAttribute('aria-label', '位置纵坐标');
  const distanceName = node('input'), distance = node('input'); distanceName.placeholder = '距离名称'; distanceName.setAttribute('aria-label', '新舞台距离名称'); distance.type = 'number'; distance.step = '.01'; distance.min = '.01'; distance.value = '1'; distance.setAttribute('aria-label', '距离倍率');
  presets.append(positionName, x, y, button('加入位置草稿', () => {
    const value = readValue(), id = positionName.value.trim(); if (!id) throw new Error('请填写位置名称。');
    value.positions = { ...value.positions, [id]: { x: Number(x.value), y: Number(y.value) } }; parseProjectStage(value); setDraft(value); status.textContent = '位置已加入配置草稿，尚未保存。';
  }), distanceName, distance, button('加入距离草稿', () => {
    const value = readValue(), id = distanceName.value.trim(); if (!id) throw new Error('请填写距离名称。');
    value.distances = { ...value.distances, [id]: Number(distance.value) }; parseProjectStage(value); setDraft(value); status.textContent = '距离已加入配置草稿，尚未保存。';
  }));
  root.append(presets);

  const calibration = node('details'); calibration.append(node('summary', '角色图片可见范围与锚点'));
  const select = node('select'); select.setAttribute('aria-label', '校准的角色服装表情');
  const imageInfo = node('p'); const canvas = node('canvas'); canvas.className = 'stage-calibration-image'; canvas.width = 560; canvas.height = 420;
  const fields = node('div'); fields.className = 'config-scalars';
  const inputs: Record<string, HTMLInputElement> = {};
  for (const [key, label, value, step] of [['x', '范围 X', 0, '1'], ['y', '范围 Y', 0, '1'], ['width', '可见宽度', 1, '1'], ['height', '可见高度', 1, '1'], ['baseHeight', '舞台基准身高', 648, '1'], ['anchorX', '水平锚点', .5, '.01'], ['anchorY', '垂直锚点', 1, '.01']] as const) {
    const labelElement = node('label', label); const input = node('input'); input.type = 'number'; input.value = String(value); input.step = step; input.setAttribute('aria-label', label);
    inputs[key] = input; labelElement.append(input); fields.append(labelElement); input.oninput = () => draw();
  }
  const draw = () => {
    const context = canvas.getContext('2d'); if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!bitmap || !loaded) return;
    const scale = Math.min(560 / bitmap.width, 420 / bitmap.height);
    context.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
    const v = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, Number(input.value)]));
    context.lineWidth = 2; context.strokeStyle = '#146d81'; context.strokeRect(v.x! * scale, v.y! * scale, v.width! * scale, v.height! * scale);
    const ax = (v.x! + v.width! * v.anchorX!) * scale, ay = (v.y! + v.height! * v.anchorY!) * scale;
    context.beginPath(); context.moveTo(ax - 7, ay); context.lineTo(ax + 7, ay); context.moveTo(ax, ay - 7); context.lineTo(ax, ay + 7); context.stroke();
  };
  let bindings: ReturnType<typeof resolveProjectPortraits> = [];
  const refresh = () => {
    const config = parseProjectConfigDocument(state.gameConfigText || '{}');
    bindings = resolveProjectPortraits(config, state.dirAssets.flatMap(asset => { const path = asset.sourcePath ?? (asset.handle ? assetPathForHandle(asset.handle) : undefined); return path ? [path] : []; }));
    select.replaceChildren(); bindings.forEach((binding, index) => { const option = node('option', `${binding.role}:${binding.outfit} · ${binding.expression}`); option.value = String(index); select.append(option); });
  };
  const readImage = async () => {
    if (!canUse()) return;
    assertUniquePortraitBindings(bindings);
    const sequence = ++readSequence, binding = bindings[Number(select.value)]; if (!binding) throw new Error('当前项目没有可校准角色图片。');
    const asset = state.dirAssets.find(asset => (asset.sourcePath ?? (asset.handle ? assetPathForHandle(asset.handle) : undefined)) === binding.sourcePath);
    if (!asset?.handle) throw new Error('角色图片缺少实际读取句柄。');
    const file = await asset.handle.getFile(), bytes = await file.arrayBuffer();
    const sha256 = await digest(bytes);
    let image = await createImageBitmap(new Blob([bytes], { type: file.type }));
    const parts = [{ handle: asset.handle, sha256 }];
    if (binding.visual) {
      const composed = document.createElement('canvas'); composed.width = image.width; composed.height = image.height;
      const context = composed.getContext('2d')!, visible = samplePortraitVisual(binding.visual, 0, false, false).images;
      const images = new Map([[binding.sourcePath, image]]);
      try {
        for (const path of portraitSourcePaths(binding)) {
          if (path === binding.sourcePath) continue;
          const handle = state.dirAssets.find(item => (item.sourcePath ?? (item.handle ? assetPathForHandle(item.handle) : undefined)) === path)?.handle;
          if (!handle) throw new Error(`缺少动态立绘图片：${path}`);
          const file = await handle.getFile(), bytes = await file.arrayBuffer();
          parts.push({ handle, sha256: await digest(bytes) });
          const decoded = await createImageBitmap(new Blob([bytes], { type: file.type })); images.set(path, decoded);
          if (decoded.width !== image.width || decoded.height !== image.height) throw new Error(`动态立绘画布尺寸不同：${path}`);
        }
        for (const path of visible) context.drawImage(images.get(path)!, 0, 0);
        image = await createImageBitmap(composed);
      } finally { for (const part of images.values()) part.close(); }
    }
    if (!canUse() || sequence !== readSequence) { image.close(); return; }
    bitmap?.close(); bitmap = image;
    loaded = { path: binding.sourcePath, sha256, width: image.width, height: image.height, role: binding.role, outfit: binding.outfit, expression: binding.expression, fileHandle: asset.handle, parts };
    const profile = readProjectStage({ stage: readValue() })?.portraits[`${binding.role}:${binding.outfit}`];
    const frame = profile?.expressions[binding.expression] ?? { x: 0, y: 0, width: image.width, height: image.height };
    for (const [key, value] of Object.entries({ ...frame, baseHeight: profile?.height ?? 648, anchorX: profile?.anchorX ?? .5, anchorY: profile?.anchorY ?? 1 })) inputs[key]!.value = String(value);
    imageInfo.textContent = `${binding.sourcePath} · ${image.width} × ${image.height}${binding.visual ? ' · 显示默认组合，请为所有变体保留足够范围' : ''}`; draw();
  };
  select.onchange = () => { loaded = null; bitmap?.close(); bitmap = null; draw(); };
  calibration.append(node('p', '在图上拖出可见范围，或填写像素坐标。十字为锚点；不自动猜测透明边距。'), select,
    button('刷新角色列表', () => refresh()), button('读取实际图片', readImage), imageInfo, canvas, fields,
    button('确认图片校准并加入草稿', async () => {
      const captured = loaded; if (!captured) throw new Error('请先读取实际图片。');
      for (const part of captured.parts) {
        const current = await (await part.handle.getFile()).arrayBuffer();
        if (!canUse() || loaded !== captured || await digest(current) !== part.sha256) throw new Error('图片或项目已变化，请重新读取后校准。');
      }
      const value = readValue(), target = `${captured.role}:${captured.outfit}`;
      const v = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, Number(input.value)]));
      if (v.x! < 0 || v.y! < 0 || v.width! <= 0 || v.height! <= 0 || v.x! + v.width! > captured.width || v.y! + v.height! > captured.height) throw new Error('可见范围超出实际图片。');
      const previous = value.portraits?.[target] ?? {};
      value.portraits = { ...value.portraits, [target]: { ...previous, height: v.baseHeight, anchorX: v.anchorX, anchorY: v.anchorY,
        expressions: { ...previous.expressions, [captured.expression]: { x: v.x, y: v.y, width: v.width, height: v.height } },
        sources: { ...previous.sources, [captured.expression]: { path: captured.path, sha256: captured.sha256, width: captured.width, height: captured.height } } } };
      parseProjectStage(value); setDraft(value); status.textContent = '校准已加入舞台草稿。保存舞台配置或保存全部后才会写入项目。';
    }));
  let drag: { x: number; y: number } | null = null;
  const pixel = (event: PointerEvent) => { const rect = canvas.getBoundingClientRect(), scale = bitmap ? Math.min(560 / bitmap.width, 420 / bitmap.height) : 1;
    return { x: Math.round((event.clientX - rect.left) * canvas.width / rect.width / scale), y: Math.round((event.clientY - rect.top) * canvas.height / rect.height / scale) }; };
  canvas.onpointerdown = event => { if (!canUse() || !loaded || event.button !== 0) return; drag = pixel(event); canvas.setPointerCapture(event.pointerId); };
  canvas.onpointermove = event => {
    if (!drag || !loaded) return; const end = pixel(event);
    const left = Math.max(0, Math.min(loaded.width - 1, Math.min(drag.x, end.x))), top = Math.max(0, Math.min(loaded.height - 1, Math.min(drag.y, end.y)));
    inputs.x!.value = String(left); inputs.y!.value = String(top); inputs.width!.value = String(Math.max(1, Math.min(loaded.width - left, Math.abs(end.x - drag.x)))); inputs.height!.value = String(Math.max(1, Math.min(loaded.height - top, Math.abs(end.y - drag.y)))); draw();
  };
  canvas.onpointerup = canvas.onpointercancel = () => { drag = null; };
  try { refresh(); } catch { /* An explicit refresh/read surfaces invalid project data. */ }
  root.append(calibration);
  return { element: root, refreshDraft() { form.value = readStageConfigDraft(); }, dispose() { disposed = true; readSequence++; bitmap?.close(); bitmap = null; } };
}
