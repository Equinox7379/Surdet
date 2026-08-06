/**
 * 术语一致性审计（M6 后批次：自 cli/audit.ts 下沉 core，编辑器术语面板与 CLI 共用同一实现）。
 *  - 称谓一致性：说话人疑似笔误（编辑距离 1）与称谓变体（前缀包含）检测
 *  - 设定名词表：terminology.json 声明规范词/变体，扫描文本/选项中的违规使用
 * 纯函数，不依赖 fs/CLI；解析形状容错（非法条目跳过而非抛错）。
 */
import type { CompiledScene } from './dsl/ast.js';

export interface AuditFinding {
  severity: 'error' | 'warning' | 'info';
  code: string;
  text: string;
  file: string;
  line: number;
}

export interface TerminologyTerm {
  canonical: string;
  variants: string[];
}

/** 编辑距离（称谓笔误检测用；说话人长度小，O(n*m) 足够） */
export function levenshtein(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** 称谓一致性：疑似笔误（距离 1）告警；前缀包含（如 凛/凛大人）提示确认 */
export function auditSpeakers(speakerCounts: Map<string, number>, fileOf: (speaker: string) => { file: string; line: number }): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const names = [...speakerCounts.keys()];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!;
      const b = names[j]!;
      const pos = fileOf(a);
      if (levenshtein(a, b) === 1) {
        findings.push({
          severity: 'warning',
          code: 'CONSIST_TYPO',
          text: `说话人 '${a}' 与 '${b}' 仅一字符之差（${speakerCounts.get(a)} 处 / ${speakerCounts.get(b)} 处），疑似笔误导致同一角色被拆成两人`,
          file: pos.file,
          line: pos.line,
        });
      } else if (a.length >= 1 && b.startsWith(a) && b.length - a.length <= 3) {
        findings.push({
          severity: 'info',
          code: 'CONSIST_HONORIFIC',
          text: `说话人 '${a}' 与 '${b}' 是称谓变体关系，引擎视为两个不同角色（若为同一人不同称呼请确认是演出意图）`,
          file: pos.file,
          line: pos.line,
        });
      } else if (b.length >= 1 && a.startsWith(b) && a.length - b.length <= 3) {
        findings.push({
          severity: 'info',
          code: 'CONSIST_HONORIFIC',
          text: `说话人 '${b}' 与 '${a}' 是称谓变体关系，引擎视为两个不同角色（若为同一人不同称呼请确认是演出意图）`,
          file: pos.file,
          line: pos.line,
        });
      }
    }
  }
  return findings;
}

/** 设定名词表扫描：文本/说话人/选项文本中出现变体 → 建议规范词 */
export function auditTerminology(compiled: Map<string, CompiledScene>, terms: TerminologyTerm[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const term of terms) {
    for (const variant of term.variants) {
      if (variant.length === 0) continue;
      for (const scene of compiled.values()) {
        for (const instr of scene.instructions) {
          const spots: { text: string; file: string; line: number }[] = [];
          if (instr.op === 'text') spots.push({ text: `${instr.speaker ?? ''} ${instr.value}`, file: instr.file, line: instr.line });
          if (instr.op === 'choice') {
            for (const opt of instr.options) spots.push({ text: opt.label, file: opt.pos.file, line: opt.pos.line });
          }
          for (const spot of spots) {
            if (spot.text.includes(variant)) {
              findings.push({
                severity: 'warning',
                code: 'TERM_VARIANT',
                text: `${spot.file}:${spot.line}: 使用了名词变体 '${variant}'，设定规范词为 '${term.canonical}'`,
                file: spot.file,
                line: spot.line,
              });
            }
          }
        }
      }
    }
  }
  return findings;
}

/** 解析 terminology.json 原始对象（形状容错：非法条目跳过；非数组/非对象返回空表） */
export function parseTerminology(raw: unknown): TerminologyTerm[] {
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as Record<string, unknown>).terms;
  if (!Array.isArray(list)) return [];
  const terms: TerminologyTerm[] = [];
  for (const t of list) {
    if (typeof t !== 'object' || t === null) continue;
    const tt = t as Record<string, unknown>;
    if (typeof tt['canonical'] !== 'string' || !Array.isArray(tt['variants'])) continue;
    terms.push({ canonical: tt['canonical'], variants: tt['variants'].filter((v): v is string => typeof v === 'string') });
  }
  return terms;
}
