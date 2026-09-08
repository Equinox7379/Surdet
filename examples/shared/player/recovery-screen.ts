/** A failed start offers a retry without asking players to erase their saves. */
export function showPlayerRecovery(reason: unknown): void {
  console.error('[player] 启动或运行失败：', reason);
  let panel = document.getElementById('surdet-fatal');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'surdet-fatal';
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'surdet-fatal-title');
    Object.assign(panel.style, {
      position: 'fixed', inset: '0', zIndex: '2000', background: '#142b37', color: '#ebf2f5',
      display: 'grid', alignContent: 'center', justifyItems: 'start', gap: '20px',
      padding: 'clamp(24px, 8vw, 120px)', font: '18px/1.65 sans-serif',
    });
    const heading = document.createElement('h1');
    heading.id = 'surdet-fatal-title';
    heading.textContent = '这一页暂时没能打开';
    const description = document.createElement('p');
    description.textContent = '可以重新加载后再试。已保存的进度会保留。';
    const retry = document.createElement('button');
    retry.textContent = '重新加载';
    Object.assign(retry.style, { padding: '12px 24px', font: 'inherit', background: '#ddbe84', color: '#142b37', border: '0', borderRadius: '4px', cursor: 'pointer' });
    retry.addEventListener('click', () => window.location.reload());
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '查看错误详情';
    const message = document.createElement('pre');
    message.id = 'surdet-fatal-detail';
    Object.assign(message.style, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: '80ch', fontSize: '14px' });
    details.append(summary, message);
    panel.append(heading, description, retry, details);
    document.body.appendChild(panel);
    retry.focus();
  }
  const detail = document.getElementById('surdet-fatal-detail');
  if (detail) detail.textContent = reason instanceof Error ? reason.message : String(reason);
}
