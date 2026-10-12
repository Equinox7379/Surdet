import type { PluginParameter, ProjectPluginDeclaration } from '@surdet/core';
import { h } from '../state.js';
import { pluginEntryLimit, readPluginEntry, revokePlugin, trustPlugin, type PluginEntryFacts, type PluginStatus } from '../project-plugins.js';

export interface PreviewPluginsView {
  declarations: readonly ProjectPluginDeclaration[];
  /** Why the config's plugin list cannot be read, or null. */
  error: string | null;
  statuses: ReadonlyMap<string, PluginStatus>;
  /** Why this content runs no plugin code whatever was confirmed, or null. */
  blocked: string | null;
}

export interface PreviewPluginsSection {
  element: HTMLElement;
  show(view: PreviewPluginsView): void;
  /** The plugin reason the current run stopped for, or null once a new run starts. */
  setStop(message: string | null): void;
}

const TYPE_LABELS: Record<PluginParameter['type'], string> = { string: '文字', number: '数字', boolean: '是/否' };
const parameterText = (parameter: PluginParameter, prefix = ''): string =>
  `${prefix}${parameter.name}（${TYPE_LABELS[parameter.type]}${parameter.optional ? '，可省略' : ''}）`;

/** One instruction as an author writes it: positional parameters, then named options. */
export function pluginInstructionText(instruction: ProjectPluginDeclaration['instructions'][number]): string {
  const parts = [`@${instruction.name}`, ...instruction.parameters.map(parameter => parameterText(parameter)),
    ...(instruction.modifiers ?? []).map(modifier => parameterText(modifier, '@'))];
  return `${parts.join(' ')} — ${instruction.blocking ? '等插件界面完成后继续' : '立即完成'}`;
}

export function pluginStatusText(status: PluginStatus | undefined): string {
  switch (status?.kind) {
    case 'trusted': return `已启用：本次 Editor 会话运行这份代码（SHA-256 ${status.sha256.slice(0, 12)}…）。`;
    case 'changed': return '入口代码在确认后改变，已自动停用；请重新查看并确认。';
    case 'unsupported': return `已停用，无法在 Editor 试玩中运行：${status.reason}`;
    case 'unreadable': return `已停用：${status.reason}`;
    default: return '未启用：试玩到它的指令时会停下，不会运行代码。';
  }
}

const formatBytes = (bytes: number): string => bytes < 1024 ? `${bytes} 字节` : `${(bytes / 1024).toFixed(1)} KB`;

export function createPreviewPluginsSection(options: {
  /** The directory the person opened; trust is held for it only. */
  root(): FileSystemDirectoryHandle | null;
  /** Trust changed: the next run must reload the code. */
  onChange(): void;
}): PreviewPluginsSection {
  const element = h('details', 'preview-plugins');
  element.setAttribute('aria-label', '项目插件');
  const summary = h('summary', undefined, '项目插件');
  const note = h('p', 'preview-plugins-note',
    '作品配置里的插件声明只是说明，不会运行代码。只有你在这里查看并确认后，本次 Editor 会话才会在试玩中运行它。');
  const blockedNote = h('p', 'preview-plugins-note preview-plugins-blocked');
  const list = h('ul', 'preview-plugins-list');
  const stop = h('p', 'preview-plugins-stop');
  stop.setAttribute('role', 'status');
  element.append(summary, note, blockedNote, list, stop);
  element.hidden = true;
  let view: PreviewPluginsView = { declarations: [], error: null, statuses: new Map(), blocked: null };

  const render = (): void => {
    const { declarations, error, statuses, blocked } = view;
    element.hidden = declarations.length === 0 && error === null;
    const enabled = declarations.filter(item => statuses.get(item.id)?.kind === 'trusted').length;
    summary.textContent = error !== null ? '项目插件（声明无效）' : `项目插件（${declarations.length} 个 · 已启用 ${blocked ? 0 : enabled}）`;
    blockedNote.textContent = error !== null ? `插件声明无法读取：${error}` : blocked ?? '';
    blockedNote.hidden = blockedNote.textContent === '';
    list.replaceChildren(...declarations.map(declaration => {
      const status = statuses.get(declaration.id);
      const row = h('li', 'preview-plugin');
      row.dataset.pluginId = declaration.id;
      row.dataset.pluginStatus = status?.kind ?? 'off';
      const head = h('div', 'preview-plugin-head');
      head.append(h('strong', undefined, declaration.id), h('code', undefined, declaration.entry),
        h('span', undefined, `插件接口 ${declaration.apiVersion} · ${declaration.stateVersion === undefined ? '无保存状态' : `状态版本 ${declaration.stateVersion}`}`));
      const instructions = h('ul', 'preview-plugin-instructions');
      for (const instruction of declaration.instructions) instructions.append(h('li', undefined, pluginInstructionText(instruction)));
      const statusLine = h('p', 'preview-plugin-status', pluginStatusText(status));
      const actions = h('div', 'preview-plugin-actions');
      if (status?.kind === 'trusted') {
        const off = h('button', undefined, '停用'); off.type = 'button';
        off.setAttribute('aria-label', `停用插件 ${declaration.id}`);
        off.onclick = () => {
          const root = options.root();
          if (root) revokePlugin(root, declaration.id);
          options.onChange();
        };
        actions.append(off);
      } else {
        const on = h('button', undefined, '查看并启用…'); on.type = 'button';
        on.setAttribute('aria-label', `查看并启用插件 ${declaration.id}`);
        on.disabled = blocked !== null || options.root() === null;
        on.onclick = () => { void openTrustDialog(declaration); };
        actions.append(on);
      }
      row.append(head, instructions, statusLine, actions);
      return row;
    }));
  };

  const openTrustDialog = async (declaration: ProjectPluginDeclaration): Promise<void> => {
    const root = options.root();
    if (root === null) return;
    const dialog = h('dialog', 'v4-insert-dialog preview-plugin-dialog');
    dialog.setAttribute('aria-label', `启用项目插件 ${declaration.id}`);
    const status = h('p', 'preview-plugin-dialog-status', '正在读取入口文件…');
    status.setAttribute('role', 'status');
    dialog.append(h('h2', undefined, `启用项目插件「${declaration.id}」`), status);
    const cancel = h('button', 'v4-button', '取消'); cancel.type = 'button'; cancel.onclick = () => dialog.close();
    const footer = h('footer'); footer.append(cancel);
    dialog.addEventListener('close', () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();

    let facts: PluginEntryFacts;
    try { facts = await readPluginEntry(root, declaration.entry); }
    catch (error) {
      status.textContent = `入口 ${declaration.entry} 无法读取：${error instanceof Error ? error.message : String(error)}`;
      dialog.append(footer);
      return;
    }
    const limit = pluginEntryLimit(facts);
    status.textContent = limit === null ? '请确认你了解这段代码的来源和权限。' : `不能启用：${limit}`;
    const factList = h('dl', 'preview-plugin-facts');
    const fact = (term: string, value: string): void => { factList.append(h('dt', undefined, term), h('dd', undefined, value)); };
    fact('来源', `你打开的项目目录「${root.name}」中的 ${facts.entry}`);
    fact('代码', `${formatBytes(facts.bytes)} · SHA-256 ${facts.sha256}`);
    fact('依赖', facts.unlexable !== null ? '无法读取' : facts.dependencies.length ? facts.dependencies.join('、')
      : '代码中没有 import / export … from / import() 模块导入（单个 .js 模块）');
    fact('指令', declaration.instructions.map(instruction => `@${instruction.name}`).join('、'));
    fact('运行环境', '代码在 Editor 的试玩画面中运行，与 Editor 同源，拥有与 Editor 页面相同的权限：'
      + '可以访问试玩画面和 Editor 页面本身，以及 Editor 已获得的能力（例如项目目录的读写、桌面版提供给 Editor 的接口）。'
      + '这不是沙箱；它造成的副作用 Editor 无法撤销，也不能中止死循环。Editor 不会编译它、安装依赖，或在 Node / 桌面主进程中运行它。'
      + 'Editor 只检查代码里的模块导入写法；代码运行时自行取得并执行其他代码，不在这项检查之内。');
    fact('有效范围', '只在本次 Editor 会话、只对这个目录、只对上面这份代码内容有效；文件内容一变就自动停用，需要重新确认。'
      + '作品配置和智能体的请求都不能替你启用。只用于试玩「当前编辑内容」，所选版本、候选等其他内容不运行插件代码。');
    const code = h('details', 'preview-plugin-code');
    code.append(h('summary', undefined, `查看代码（${facts.source.split('\n').length} 行）`), h('pre', undefined, facts.source));
    dialog.append(factList, code, footer);
    if (limit !== null) return;
    const confirm = h('button', 'v4-button v4-primary', '确认运行这份代码'); confirm.type = 'button';
    confirm.onclick = () => {
      // The project may have been switched while the dialog was open.
      if (options.root() !== root) { status.textContent = '项目已切换，本次确认没有生效。'; confirm.disabled = true; return; }
      trustPlugin(root, declaration.id, facts.sha256);
      dialog.close();
      options.onChange();
    };
    footer.append(confirm);
    confirm.focus();
  };

  return {
    element,
    show(next) { view = next; render(); },
    setStop(message) {
      stop.textContent = message === null ? '' : `本次试玩因项目插件停止：${message}`;
      if (message !== null) element.open = true;
    },
  };
}
