import type { PreviewPathOptions } from '@surdet/authoring';
import { h } from '../state.js';
import { PREVIEW_TARGET_MODES, parseOptionIndices, parseTargetVariables, type PreviewTargetMode, type TargetVariableField } from '../preview-target.js';

export interface PreviewTargetSection {
  element: HTMLElement;
  /** The query input for the current form; throws a readable message for invalid fields. */
  request(): PreviewPathOptions;
  setBusy(busy: boolean): void;
  setStatus(text: string, tone?: 'info' | 'reached' | 'warning'): void;
  setDetails(lines: readonly string[]): void;
  onFind(handler: () => void): void;
  onCancel(handler: () => void): void;
}

/** Declared variables a test start may set; read-only engine values stay out. */
export function writableDeclarations(declarations: readonly Record<string, unknown>[]): { name: string; type: string; initial: unknown }[] {
  return declarations.filter(item => typeof item.name === 'string' && typeof item.type === 'string' && item.readonly !== true)
    .map(item => ({ name: item.name as string, type: item.type as string, initial: item.initial }));
}

export function createPreviewTargetSection(target: { sceneId: string; line: number }, declarations: readonly { name: string; type: string; initial: unknown }[]): PreviewTargetSection {
  const element = h('section', 'preview-target');
  element.setAttribute('aria-label', '从这一行试玩');
  const header = h('header', 'preview-target-header');
  header.append(h('h3', undefined, '从这一行试玩'), h('span', 'preview-target-where', `${target.sceneId} · 第 ${target.line} 行`));

  const form = h('div', 'preview-target-form');
  const modeLabel = h('label', 'preview-target-field');
  const mode = h('select');
  mode.setAttribute('aria-label', '起点方式');
  for (const item of PREVIEW_TARGET_MODES) { const option = h('option', undefined, item.label); option.value = item.mode; mode.append(option); }
  modeLabel.append(h('span', undefined, '起点方式'), mode);
  const hint = h('p', 'preview-target-hint');

  const choicesLabel = h('label', 'preview-target-field');
  const choices = h('input');
  choices.setAttribute('aria-label', '选项序号');
  choices.placeholder = '例如 0, 1';
  choices.title = '每次选择用的实际选项序号，从 0 开始；不按显示文字匹配';
  choicesLabel.append(h('span', undefined, '选项序号'), choices);
  const visitLabel = h('label', 'preview-target-field');
  const visit = h('input');
  visit.type = 'number'; visit.min = '1'; visit.max = '1000'; visit.step = '1'; visit.value = '1';
  visit.setAttribute('aria-label', '第几次到达');
  visitLabel.append(h('span', undefined, '第几次到达'), visit);

  const budget = h('details', 'preview-target-budget');
  budget.append(h('summary', undefined, '查找预算'));
  const number = (label: string, value: number, max: number) => {
    const wrap = h('label', 'preview-target-field'), input = h('input');
    input.type = 'number'; input.min = '1'; input.max = String(max); input.step = '1'; input.value = String(value);
    input.setAttribute('aria-label', label); wrap.append(h('span', undefined, label), input); budget.append(wrap); return input;
  };
  const maxPaths = number('最多路径', 500, 2000), maxSteps = number('每条路径推进', 20_000, 100_000);

  const variables = h('fieldset', 'preview-target-variables');
  variables.append(h('legend', undefined, '临时初值'));
  variables.append(h('p', 'preview-target-hint', declarations.length
    ? '只用于本次试玩，不写回作品；留空则用作品初值。' : '作品没有可设置的变量。'));
  const fields: { input: HTMLInputElement | HTMLSelectElement; field: Omit<TargetVariableField, 'value'> }[] = [];
  for (const declaration of declarations) {
    const row = h('label', 'preview-target-field');
    let input: HTMLInputElement | HTMLSelectElement;
    if (declaration.type === 'boolean' || declaration.type === 'flag') {
      input = h('select');
      for (const [value, label] of [['', `按初值（${declaration.initial === true ? '开启' : '关闭'}）`], ['true', '开启'], ['false', '关闭']] as const) {
        const option = h('option', undefined, label); option.value = value; input.append(option);
      }
    } else {
      input = h('input');
      if (declaration.type === 'number') input.type = 'number';
      input.placeholder = JSON.stringify(declaration.initial) ?? '';
    }
    input.setAttribute('aria-label', `临时初值 ${declaration.name}`);
    row.append(h('span', undefined, declaration.name), input);
    variables.append(row);
    fields.push({ input, field: declaration });
  }

  const actions = h('div', 'preview-target-actions');
  const find = h('button', 'preview-target-find', '查找并试玩'); find.type = 'button';
  const cancel = h('button', undefined, '取消查找'); cancel.type = 'button'; cancel.hidden = true;
  actions.append(find, cancel);
  form.append(modeLabel, choicesLabel, visitLabel, actions, hint, budget, variables);

  const status = h('p', 'preview-target-status');
  status.setAttribute('role', 'status');
  const details = h('ul', 'preview-target-details');
  element.append(header, form, status, details);

  const refresh = (): void => {
    const current = mode.value as PreviewTargetMode;
    hint.textContent = PREVIEW_TARGET_MODES.find(item => item.mode === current)?.hint ?? '';
    choicesLabel.hidden = current === 'search';
    visitLabel.hidden = current === 'search';
    budget.hidden = current !== 'search';
    variables.hidden = current !== 'test';
  };
  mode.onchange = refresh;
  refresh();

  return {
    element,
    request: () => {
      const current = mode.value as PreviewTargetMode;
      const options: PreviewPathOptions = { sceneId: target.sceneId, line: target.line, mode: current };
      if (current === 'search') {
        const paths = Number(maxPaths.value), steps = Number(maxSteps.value);
        if (!Number.isSafeInteger(paths) || paths < 1 || paths > 2000 || !Number.isSafeInteger(steps) || steps < 1 || steps > 100_000)
          throw new Error('最多路径须为 1 到 2000，每条路径推进须为 1 到 100000 的整数。');
        return { ...options, maxPaths: paths, maxStepsPerPath: steps };
      }
      const times = Number(visit.value);
      if (!Number.isSafeInteger(times) || times < 1 || times > 1000) throw new Error('第几次到达须为 1 到 1000 的整数。');
      return { ...options, choices: parseOptionIndices(choices.value), targetVisit: times,
        ...(current === 'test' ? { variables: parseTargetVariables(fields.map(({ input, field }) => ({ ...field, value: input.value }))) } : {}) };
    },
    setBusy: (busy) => { find.disabled = busy; cancel.hidden = !busy; mode.disabled = busy; },
    setStatus: (text, tone = 'info') => { status.textContent = text; status.dataset.tone = tone; },
    setDetails: (lines) => { details.replaceChildren(...lines.map(line => h('li', undefined, line))); },
    onFind: (handler) => { find.onclick = handler; },
    onCancel: (handler) => { cancel.onclick = handler; },
  };
}
