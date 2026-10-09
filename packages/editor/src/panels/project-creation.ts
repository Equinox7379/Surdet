// Desktop start page: create a new project from a bundled template.
// The main process owns the folder and the template files; this page only
// holds the opaque location id it was handed and the title the person typed.
import type { CreateProjectRequest, DesktopBridge, ProjectCreationLocation } from '../../desktop/contracts.js';
import { h } from '../state.js';
import { desktopErrorMessage } from '../desktop.js';

export type ProjectTemplate = CreateProjectRequest['template'];
type CreationBridge = Pick<DesktopBridge, 'chooseProjectLocation' | 'createProject'>;
type Message = { text: string; tone: 'info' | 'error' | 'success' };

export interface ProjectCreationState {
  name: string;
  template: ProjectTemplate;
  location: ProjectCreationLocation | null;
  busy: 'choosing' | 'creating' | null;
  message: Message | null;
}

/** Same limit the main process applies after trimming; the main process stays the authority on every rule. */
export const PROJECT_NAME_MAX_LENGTH = 120;
// A complete project already exists on disk when this is the reason; its location id is spent.
const CREATED_BUT_NOT_OPENED = /^项目已创建在/;

export function createProjectCreation(bridge: CreationBridge, onChange: () => void) {
  const state: ProjectCreationState = { name: '', template: 'example', location: null, busy: null, message: null };
  const update = (patch: Partial<ProjectCreationState>) => { Object.assign(state, patch); onChange(); };
  return {
    state,
    canCreate: () => state.busy === null && state.location !== null && state.name.trim().length > 0,
    setName(name: string) { state.name = name; if (state.message?.tone !== 'info') state.message = null; onChange(); },
    setTemplate(template: ProjectTemplate) { update({ template }); },
    async chooseLocation(): Promise<void> {
      if (state.busy !== null) return;
      update({ busy: 'choosing', message: null });
      try {
        // null means cancelled (or another folder dialog was already open): keep the previous choice.
        const location = await bridge.chooseProjectLocation();
        update({ busy: null, ...(location ? { location } : {}) });
      } catch (error) {
        update({ busy: null, message: { text: desktopErrorMessage(error, '无法选择保存位置'), tone: 'error' } });
      }
    },
    async create(): Promise<void> {
      if (state.busy !== null || state.location === null || state.name.trim().length === 0) return;
      const name = state.name.trim();
      update({ busy: 'creating', message: { text: `正在创建「${name}」…`, tone: 'info' } });
      try {
        await bridge.createProject({ locationId: state.location.id, name, template: state.template });
        // The new project opens in its own window and this start page usually closes with it.
        // A successful creation spends the location id, so another project needs a new choice.
        update({ busy: null, location: null, name: '', message: { text: `已创建「${name}」，正在新窗口中打开。`, tone: 'success' } });
      } catch (error) {
        const text = desktopErrorMessage(error, '无法创建项目');
        update({ busy: null, ...(CREATED_BUT_NOT_OPENED.test(text) ? { location: null } : {}), message: { text, tone: 'error' } });
      }
    },
  };
}

export type ProjectCreation = ReturnType<typeof createProjectCreation>;

const TEMPLATES: ReadonlyArray<{ value: ProjectTemplate; title: string; description: string }> = [
  { value: 'example', title: '示例项目', description: '《第一封信》：港口开场的可玩短篇，含分支、存读档和设置' },
  { value: 'blank', title: '空白项目', description: '只有基础配置和一个起始场景' },
];

/** Where the new folder will go, for display only; the request carries the location id. */
function targetPreview(location: ProjectCreationLocation, name: string): string {
  const separator = location.location.includes('\\') ? '\\' : '/';
  return `${location.location.replace(/[\\/]+$/, '')}${separator}${name.trim()}`;
}

/** The form keeps its controls across updates so typing and focus are never interrupted. */
export function renderProjectCreation(creation: ProjectCreation, onClose: () => void): { root: HTMLElement; refresh: () => void } {
  const root = h('section', 'editor-welcome-create');
  root.setAttribute('aria-label', '新建项目');
  const back = h('button', 'editor-welcome-create-back', '返回');
  back.type = 'button';
  back.onclick = onClose;
  const header = h('div', 'editor-welcome-create-header');
  header.append(h('h2', undefined, '新建项目'), back);

  const form = h('form', 'editor-welcome-create-form');
  form.noValidate = true;

  const nameField = h('div', 'editor-welcome-create-field');
  const nameLabel = h('label', undefined, '项目名称');
  const nameInput = h('input');
  nameInput.id = 'new-project-name';
  nameLabel.htmlFor = nameInput.id;
  nameInput.type = 'text';
  nameInput.maxLength = PROJECT_NAME_MAX_LENGTH;
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.placeholder = '例如：雾港来信';
  nameInput.value = creation.state.name;
  nameInput.oninput = () => creation.setName(nameInput.value);
  const nameHint = h('small', undefined, '作品标题，也是新文件夹的名称。');
  nameField.append(nameLabel, nameInput, nameHint);

  const templates = h('fieldset', 'editor-welcome-create-templates');
  templates.append(h('legend', undefined, '从哪里开始'));
  const radios: HTMLInputElement[] = [];
  for (const template of TEMPLATES) {
    const option = h('label', 'editor-welcome-create-template');
    const radio = h('input');
    radio.type = 'radio';
    radio.name = 'new-project-template';
    radio.value = template.value;
    radio.onchange = () => { if (radio.checked) creation.setTemplate(template.value); };
    radios.push(radio);
    const text = h('span');
    text.append(h('strong', undefined, template.title), h('small', undefined, template.description));
    option.append(radio, text);
    templates.append(option);
  }

  const locationField = h('div', 'editor-welcome-create-field');
  const locationLabel = h('span', 'editor-welcome-create-label', '保存位置');
  const locationRow = h('div', 'editor-welcome-create-location');
  const locationText = h('span', 'editor-welcome-create-path');
  const choose = h('button', 'editor-welcome-create-choose');
  choose.type = 'button';
  choose.onclick = () => { void creation.chooseLocation(); };
  locationRow.append(locationText, choose);
  const locationHint = h('small');
  locationField.append(locationLabel, locationRow, locationHint);

  const message = h('p', 'editor-welcome-create-message');
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const submit = h('button', 'editor-welcome-create-submit', '创建并打开');
  submit.type = 'submit';
  const footer = h('div', 'editor-welcome-create-actions');
  footer.append(submit);
  form.append(nameField, templates, locationField, message, footer);
  form.onsubmit = (event) => { event.preventDefault(); void creation.create(); };
  // Escape while composing Chinese or Japanese text only cancels the composition.
  root.onkeydown = (event) => { if (event.key === 'Escape' && !event.isComposing && creation.state.busy === null) { event.preventDefault(); onClose(); } };
  root.append(header, form);

  const refresh = () => {
    const { state } = creation;
    const busy = state.busy !== null;
    if (nameInput.value !== state.name) nameInput.value = state.name;
    nameInput.disabled = state.busy === 'creating';
    for (const radio of radios) { radio.checked = radio.value === state.template; radio.disabled = state.busy === 'creating'; }
    locationText.textContent = state.location?.location ?? '尚未选择';
    locationText.title = state.location?.location ?? '';
    locationText.classList.toggle('is-empty', state.location === null);
    choose.textContent = state.busy === 'choosing' ? '正在选择…' : state.location ? '更换位置…' : '选择位置…';
    choose.disabled = busy;
    locationHint.textContent = state.location && state.name.trim()
      ? `将新建文件夹：${targetPreview(state.location, state.name)}`
      : '项目会建在所选文件夹下的一个新文件夹里；已有同名文件夹时不会覆盖。';
    message.textContent = state.message?.text ?? '';
    message.dataset['tone'] = state.message?.tone ?? '';
    message.hidden = state.message === null;
    submit.textContent = state.busy === 'creating' ? '正在创建…' : '创建并打开';
    submit.disabled = !creation.canCreate();
    back.disabled = busy;
    root.setAttribute('aria-busy', String(busy));
  };
  refresh();
  return { root, refresh };
}
