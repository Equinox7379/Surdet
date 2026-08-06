/**
 * 术语审计面板（E5-3 收尾项）：审计逻辑下沉 core（terminology-audit.ts）后与 CLI 同源共用。
 * 内容：称谓一致性（疑似笔误/称谓变体）+ 设定名词表违规（TERM_VARIANT），点击条目跳转场景/行。
 */
import { state, h } from '../state.js';
import { parseTerminology, auditSpeakers, auditTerminology } from '@surdet/core';
import type { AuditFinding } from '@surdet/core';

/** 跳转钩子由 main.ts 注入（与搜索结果/流程图导航同一 jumpToScene） */
let onJumpHook: (sceneKey: string, line: number) => void = () => {};
export function bindAuditHooks(opts: { onJump: (sceneKey: string, line: number) => void }): void {
  onJumpHook = opts.onJump;
}

/** finding.file（如 'sub/ch02.gal'）→ 场景 Map key（去扩展名；兼容子目录） */
function sceneKeyOfFile(file: string): string | null {
  const base = file.replace(/\.gal$/, '');
  if (state.scenes.has(base)) return base;
  for (const key of state.scenes.keys()) {
    if (key === base || key.endsWith('/' + base)) return key;
  }
  return null;
}

export function renderAuditPanel(container: HTMLElement): void {
  container.innerHTML = '';
  const compiled = state.lastValidation?.scenes;
  if (!compiled || compiled.size === 0) {
    container.appendChild(h('div', 'empty', '暂无编译产物：请先打开项目并等待校验完成。'));
    return;
  }

  // 说话人统计（称谓一致性检测的输入；与 CLI audit 同口径：首次出现位置作定位）
  const counts = new Map<string, number>();
  const firstSeen = new Map<string, { file: string; line: number }>();
  for (const scene of compiled.values()) {
    for (const instr of scene.instructions) {
      if (instr.op === 'text' && instr.speaker) {
        counts.set(instr.speaker, (counts.get(instr.speaker) ?? 0) + 1);
        if (!firstSeen.has(instr.speaker)) firstSeen.set(instr.speaker, { file: instr.file, line: instr.line });
      }
    }
  }

  const terms = parseTerminology(state.configFiles.terminology);
  const findings: AuditFinding[] = [
    ...auditSpeakers(counts, (s) => firstSeen.get(s) ?? { file: '', line: 0 }),
    ...auditTerminology(compiled, terms),
  ];

  const head = h('div', 'dim');
  head.style.padding = '0 0 10px';
  head.textContent = terms.length === 0
    ? `称谓 ${counts.size} 种 · 未配置 terminology.json（content/config/terminology.json，形状 { terms: [{canonical, variants[]}] }），名词表检查未启用`
    : `称谓 ${counts.size} 种 · 名词表 ${terms.length} 条 · 发现 ${findings.length} 项`;
  container.appendChild(head);

  if (findings.length === 0) {
    container.appendChild(h('div', 'empty', '未发现称谓/术语一致性问题。'));
    return;
  }
  for (const f of findings) {
    const item = h('div', `issue ${f.severity === 'info' ? 'info' : f.severity}`);
    const code = h('span', 'loc', `[${f.code}] `);
    const txt = h('span', undefined, f.text);
    item.append(code, txt);
    const key = sceneKeyOfFile(f.file);
    if (key) {
      item.title = '点击跳转到该行';
      item.onclick = () => onJumpHook(key, Math.max(0, f.line - 1));
    }
    container.appendChild(item);
  }
}
