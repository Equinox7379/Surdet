/**
 * 项目概览：继续使用共享统计真相，只重排为人类可读的制作概览。
 */
import { state, h } from '../state.js';
import { computeProjectStats } from '../stats.js';

let onJumpHook: (sceneKey: string) => void = () => {};

export function bindStatsHooks(opts: { onJump: (sceneKey: string) => void }): void {
  onJumpHook = opts.onJump;
}

function appendHeading(workspace: HTMLElement): void {
  const heading = h('header', 'project-health-heading');
  heading.appendChild(h('h1', undefined, '项目概览'));
  workspace.appendChild(heading);
}

function appendEmpty(workspace: HTMLElement): void {
  const empty = h('section', 'project-health-empty');
  empty.setAttribute('data-stats-state', 'empty');
  empty.append(
    h('h2', undefined, '还没有可统计的场景'),
    h('p', undefined, '新建场景后，字数、选项和结局会汇总在这里。'),
  );
  workspace.appendChild(empty);
}

function appendFailure(workspace: HTMLElement, error: unknown): void {
  const failure = h('section', 'project-health-empty project-health-error');
  failure.setAttribute('data-stats-state', 'unavailable');
  failure.append(
    h('h2', undefined, '暂时无法生成项目概览'),
    h('p', undefined, '有场景尚未通过剧本校验。请先修复错误，再回来查看完整统计。'),
  );
  const technical = h('details', 'project-health-technical');
  technical.setAttribute('data-stats-technical', '');
  technical.append(
    h('summary', undefined, '查看技术信息'),
    h('pre', undefined, error instanceof Error ? error.message : String(error)),
  );
  failure.appendChild(technical);
  workspace.appendChild(failure);
}

function appendFactGroup(parent: HTMLElement, title: string, facts: ReadonlyArray<readonly [string, string, string]>): void {
  const group = h('section', 'project-health-fact-group');
  group.appendChild(h('h2', undefined, title));
  const list = h('dl', 'project-health-fact-list');
  for (const [key, label, value] of facts) {
    const row = h('div', 'project-health-fact');
    row.setAttribute('data-stat-key', key);
    row.append(h('dt', undefined, label), h('dd', undefined, value));
    list.appendChild(row);
  }
  group.appendChild(list);
  parent.appendChild(group);
}

export function renderStatsPanel(container: HTMLElement): void {
  container.innerHTML = '';
  container.setAttribute('data-editor-panel', 'stats');
  container.setAttribute('data-editor-region', 'project-overview');
  const workspace = h('div', 'project-health-workspace project-overview-workspace');
  appendHeading(workspace);
  container.appendChild(workspace);

  const entries = [...state.scenes.entries()].map(([key, scene]) => ({ key, id: scene.id, text: scene.text }));
  if (entries.length === 0) {
    appendEmpty(workspace);
    return;
  }

  let stats;
  try {
    stats = computeProjectStats(entries);
  } catch (error) {
    appendFailure(workspace, error);
    return;
  }

  const overview = h('section', 'project-health-overview');
  const lead = h('div', 'project-health-lead');
  lead.setAttribute('data-stat-key', 'estimated-duration');
  lead.append(
    h('p', 'project-health-lead-label', '预估通关时长'),
    h('p', 'project-health-lead-value', `${stats.estMinutes} 分钟`),
    h('p', 'project-health-lead-note', '按字数和演出时长估算'),
  );
  overview.appendChild(lead);

  const facts = h('div', 'project-health-facts');
  appendFactGroup(facts, '内容规模', [
    ['scene-count', '场景', `${stats.scenes} 个`],
    ['character-count', '文字', `${stats.totalChars} 字`],
  ]);
  appendFactGroup(facts, '文本构成', [
    ['dialogue-lines', '角色台词', `${stats.dialogueLines} 行`],
    ['narration-lines', '旁白', `${stats.narrationLines} 行`],
  ]);
  appendFactGroup(facts, '互动结构', [
    ['choice-count', '选项', `${stats.choices} 个`],
    ['ending-count', '结局标记', `${stats.endings} 个`],
  ]);
  appendFactGroup(facts, '解锁内容', [
    ['cg-count', '画廊解锁', `${stats.cgUnlocks} 项`],
  ]);
  overview.appendChild(facts);
  workspace.appendChild(overview);

  const scenesSection = h('section', 'project-health-section project-health-scenes');
  const sectionHeading = h('div', 'project-health-section-heading');
  sectionHeading.append(
    h('h2', undefined, '按场景查看'),
    h('span', undefined, `${stats.perScene.length} 个场景`),
  );
  scenesSection.appendChild(sectionHeading);

  const tableScroll = h('div', 'project-health-table-scroll');
  const table = h('table', 'project-health-table');
  table.appendChild(h('caption', undefined, '每个场景的文字与互动概况'));
  const thead = h('thead');
  const headerRow = h('tr');
  for (const label of ['场景', '字数', '台词行', '选项']) {
    const th = h('th', undefined, label);
    th.setAttribute('scope', 'col');
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = h('tbody');
  stats.perScene.forEach((per, index) => {
    const entry = entries[index];
    const row = h('tr');
    const sceneCell = h('td', 'project-health-scene-cell');
    const jump = h('button', 'project-health-scene-link', per.id);
    const sceneKey = entry?.key ?? per.id;
    jump.type = 'button';
    jump.setAttribute('data-scene-jump', sceneKey);
    jump.title = `打开场景 ${per.id}`;
    jump.onclick = () => onJumpHook(sceneKey);
    sceneCell.appendChild(jump);
    row.append(
      sceneCell,
      h('td', undefined, String(per.chars)),
      h('td', undefined, String(per.dialogueLines)),
      h('td', undefined, String(per.choices)),
    );
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  tableScroll.appendChild(table);
  scenesSection.appendChild(tableScroll);
  workspace.appendChild(scenesSection);

  const method = h('details', 'project-health-technical project-health-method');
  method.append(
    h('summary', undefined, '计算说明'),
    h('p', undefined, '阅读时间按每秒 30 字估算，并计入剧本中的等待与转场时间。结局数来自明确的结局标记，画廊解锁按内容键去重。'),
  );
  workspace.appendChild(method);
}
