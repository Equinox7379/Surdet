/**
 * 制作统计面板（M6 E5-2，UI）：汇总卡片 + 分场景表格。
 */
import { state, h } from '../state.js';
import { computeProjectStats } from '../stats.js';

export function renderStatsPanel(container: HTMLElement): void {
  container.innerHTML = '';
  const entries = [...state.scenes.values()].map((sc) => ({ id: sc.id, text: sc.text }));
  const stats = computeProjectStats(entries);

  const cards = h('div', 'stats-cards');
  const card = (label: string, value: string): HTMLElement => {
    const c = h('div', 'stats-card');
    c.appendChild(h('div', 'stats-value', value));
    c.appendChild(h('div', 'stats-label', label));
    return c;
  };
  cards.append(
    card('场景数', String(stats.scenes)),
    card('总字数', String(stats.totalChars)),
    card('台词行', `${stats.dialogueLines}（旁白 ${stats.narrationLines}）`),
    card('选择肢', String(stats.choices)),
    card('结局数（@clear）', String(stats.endings)),
    card('CG 解锁', String(stats.cgUnlocks)),
    card('预估通关', `${stats.estMinutes} 分钟`),
  );
  container.appendChild(cards);

  const table = h('table', 'cfg-table');
  const thead = h('thead');
  const hr = h('tr');
  for (const col of ['场景', '字数', '台词行', '选择肢']) hr.appendChild(h('th', undefined, col));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = h('tbody');
  for (const per of stats.perScene) {
    const tr = h('tr');
    const tdId = h('td', undefined, per.id);
    tr.appendChild(tdId);
    tr.appendChild(h('td', undefined, String(per.chars)));
    tr.appendChild(h('td', undefined, String(per.dialogueLines)));
    tr.appendChild(h('td', undefined, String(per.choices)));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  container.appendChild(table);

  container.appendChild(h('div', 'dim', '预估通关时长按 30 字/秒阅读速度 + @wait 累计 + 转场各 400ms 估算。'));
}
