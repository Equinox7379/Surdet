/**
 * 术语审计面板（E5-3 收尾项）：审计逻辑下沉 core（terminology-audit.ts）后与 CLI 同源共用。
 * 内容：称谓一致性（疑似笔误/称谓变体）+ 设定名词表违规（TERM_VARIANT），点击条目跳转场景/行；
 * 称谓问题条目附“＋名词表”按钮，一键把变体收进 terminology.json（审计闭环）。
 */
import { state, h } from '../state.js';
import { parseTerminology, auditSpeakers, auditTerminology, levenshtein } from '@surdet/core';
import type { AuditFinding } from '@surdet/core';

/** 跳转钩子由 main.ts 注入（与搜索结果/流程图导航同一 jumpToScene）；
 *  onAddVariant：一键加变体到名词表（路由到配置页 addTerminologyVariant，避免面板直依赖 config 模块） */
let onJumpHook: (sceneKey: string, line: number) => void = () => {};
let onAddVariantHook: (canonical: string, variant: string) => void = () => {};
export function bindAuditHooks(opts: {
  onJump: (sceneKey: string, line: number) => void;
  onAddVariant?: (canonical: string, variant: string) => void;
}): void {
  onJumpHook = opts.onJump;
  onAddVariantHook = opts.onAddVariant ?? (() => {});
}

/** 称谓对（结构化）：canonical = 出现更多的一方，variant = 较少的一方（疑似笔误/变体） */
export interface SpeakerPair { a: string; b: string; canonical: string; variant: string }

/** 从说话人计数表提取可收编名词表的称谓对（与 core auditSpeakers 同口径：编辑距离 1 / 前缀包含≤ 3 字） */
export function computeSpeakerPairs(counts: Map<string, number>): SpeakerPair[] {
  const pairs: SpeakerPair[] = [];
  const names = [...counts.keys()];
  const orient = (a: string, b: string): { canonical: string; variant: string } => {
    // 出现更多的一方作规范词；平手时取先出现者（names 顺序 = Map 插入序）
    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    return cb < ca ? { canonical: a, variant: b } : cb > ca ? { canonical: b, variant: a } : { canonical: a, variant: b };
  };
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!;
      const b = names[j]!;
      if (levenshtein(a, b) === 1) {
        pairs.push({ a, b, ...orient(a, b) });
      } else if ((a.length >= 1 && b.startsWith(a) && b.length - a.length <= 3)
        || (b.length >= 1 && a.startsWith(b) && a.length - b.length <= 3)) {
        pairs.push({ a, b, ...orient(a, b) });
      }
    }
  }
  return pairs;
}

/** 把 CONSIST_* finding 匹配回称谓对（finding.text 内嵌两个带引号的名字） */
function pairForFinding(f: AuditFinding, pairs: SpeakerPair[]): SpeakerPair | undefined {
  if (f.code !== 'CONSIST_TYPO' && f.code !== 'CONSIST_HONORIFIC') return undefined;
  return pairs.find((p) => f.text.includes(`'${p.a}'`) && f.text.includes(`'${p.b}'`));
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
  const pairs = computeSpeakerPairs(counts);
  const findings: AuditFinding[] = [
    ...auditSpeakers(counts, (s) => firstSeen.get(s) ?? { file: '', line: 0 }),
    ...auditTerminology(compiled, terms),
  ];

  const head = h('div', 'dim');
  head.style.padding = '0 0 10px';
  const hasTermFile = state.configFiles.terminology != null;
  head.textContent = terms.length === 0
    ? (hasTermFile
        ? `称谓 ${counts.size} 种 · terminology.json 存在但名词表为空，名词表检查未启用`
        : `称谓 ${counts.size} 种 · 未配置 terminology.json（content/config/terminology.json，形状 { terms: [{canonical, variants[]}] }），名词表检查未启用`)
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
    // 称谓问题条目：一键把变体收进名词表（之后剧本里再用变体会被 TERM_VARIANT 检出）
    const pair = pairForFinding(f, pairs);
    if (pair) {
      const addBtn = h('button', undefined, `＋名词表：'${pair.variant}' → '${pair.canonical}'`);
      addBtn.title = `把 '${pair.variant}' 作为变体加入规范词 '${pair.canonical}' 的名词条目（写入 terminology.json）`;
      addBtn.style.marginLeft = '8px';
      addBtn.onclick = (e) => {
        e.stopPropagation(); // 不触发条目跳转
        onAddVariantHook(pair.canonical, pair.variant);
      };
      item.appendChild(addBtn);
    }
    container.appendChild(item);
  }
}
