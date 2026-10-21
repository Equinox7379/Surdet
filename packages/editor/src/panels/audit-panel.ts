/**
 * 文字一致性检查：审计逻辑与 CLI 共用 Core；本面板只负责人类可读呈现与现有跳转/名词表动作。
 */
import { state, h, setStatus } from '../state.js';
import { isValidationCurrent } from './issues.js';
import { parseTerminology, auditSpeakers, auditTerminology, levenshtein } from '@surdet/core';
import type { AuditFinding } from '@surdet/core';

let onJumpHook: (sceneKey: string, line: number) => void = () => {};
let onAddVariantHook: (canonical: string, variant: string) => void = () => {};
export function bindAuditHooks(opts: {
  onJump: (sceneKey: string, line: number) => void;
  onAddVariant?: (canonical: string, variant: string) => void;
}): void {
  onJumpHook = opts.onJump;
  onAddVariantHook = opts.onAddVariant ?? (() => {});
}

export interface SpeakerPair { a: string; b: string; canonical: string; variant: string }

export function computeSpeakerPairs(counts: Map<string, number>): SpeakerPair[] {
  const pairs: SpeakerPair[] = [];
  const names = [...counts.keys()];
  const orient = (a: string, b: string): { canonical: string; variant: string } => {
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

function pairForFinding(finding: AuditFinding, pairs: SpeakerPair[]): SpeakerPair | undefined {
  if (finding.code !== 'CONSIST_TYPO' && finding.code !== 'CONSIST_HONORIFIC') return undefined;
  return pairs.find((pair) => finding.text.includes(`'${pair.a}'`) && finding.text.includes(`'${pair.b}'`));
}

function sceneKeyOfFile(file: string): string | null {
  const normalized = file
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^content\/scenario\//, '')
    .replace(/\.gal$/i, '');
  if (state.scenes.has(normalized)) return normalized;
  const matches = [...state.scenes.keys()].filter((key) => (
    key.endsWith('/' + normalized) || normalized.endsWith('/' + key)
  ));
  return matches.length === 1 ? matches[0]! : null;
}

function findingLabel(finding: AuditFinding): string {
  if (finding.code === 'CONSIST_TYPO') return '疑似角色名笔误';
  if (finding.code === 'CONSIST_HONORIFIC') return '称谓变体待确认';
  if (finding.code === 'TERM_VARIANT') return '设定用词未统一';
  return '文字一致性问题';
}

function findingText(finding: AuditFinding): string {
  if (finding.code !== 'TERM_VARIANT') return finding.text;
  const marker = finding.text.indexOf('使用了名词变体');
  return marker >= 0 ? finding.text.slice(marker) : finding.text;
}

function appendHeading(workspace: HTMLElement): void {
  const heading = h('header', 'project-health-heading');
  heading.appendChild(h('h1', undefined, '文字一致性检查'));
  workspace.appendChild(heading);
}

/** The same finding often repeats across lines; show it once with every location. */
function groupFindings(findings: readonly AuditFinding[]): AuditFinding[][] {
  const groups = new Map<string, AuditFinding[]>();
  for (const finding of findings) {
    const key = `${finding.code}\0${findingText(finding)}`;
    const group = groups.get(key);
    if (group) group.push(finding); else groups.set(key, [finding]);
  }
  return [...groups.values()];
}

function appendFinding(parent: HTMLElement, findings: readonly AuditFinding[], pairs: SpeakerPair[], validation: NonNullable<typeof state.lastValidation>): void {
  const finding = findings[0]!;
  const grouped = findings.length > 1;
  const record = h('article', grouped ? 'project-health-record project-health-record--grouped' : 'project-health-record');
  record.setAttribute('data-audit-finding', finding.code);

  const copy = h('div', 'project-health-record-copy');
  const kind = h('p', 'project-health-record-kind', findingLabel(finding));
  if (grouped) kind.append(h('span', 'project-health-record-count', `${findings.length} 处`));
  copy.append(kind, h('p', 'project-health-record-text', findingText(finding)));
  record.appendChild(copy);

  const actions = h('div', 'project-health-record-actions');
  for (const item of findings) {
    const sceneKey = sceneKeyOfFile(item.file);
    if (!sceneKey) continue;
    const sceneName = state.scenes.get(sceneKey)?.id ?? sceneKey;
    const jump = h('button', 'project-health-secondary-action', grouped ? `${sceneName} · 第 ${item.line} 行` : `打开场景 · 第 ${item.line} 行`);
    jump.type = 'button';
    if (grouped) jump.setAttribute('aria-label', `打开场景 ${sceneName} · 第 ${item.line} 行`);
    jump.setAttribute('data-audit-jump', `${sceneKey}:${item.line}`);
    jump.onclick = () => {
      if (!isValidationCurrent() || state.lastValidation !== validation) {
        setStatus('内容已修改，请等待重新校验后再定位', false, 4000);
        return;
      }
      onJumpHook(sceneKey, Math.max(0, item.line - 1));
    };
    actions.appendChild(jump);
  }

  const pair = pairForFinding(finding, pairs);
  if (pair) {
    const add = h('button', 'project-health-secondary-action', `把“${pair.variant}”收进“${pair.canonical}”的名词表`);
    add.type = 'button';
    add.setAttribute('data-audit-add-variant', `${pair.canonical}:${pair.variant}`);
    add.onclick = () => onAddVariantHook(pair.canonical, pair.variant);
    actions.appendChild(add);
  }
  if (actions.children.length > 0) record.appendChild(actions);

  const technical = h('details', 'project-health-technical project-health-record-technical');
  technical.setAttribute('data-audit-technical', '');
  technical.appendChild(h('summary', undefined, '查看技术信息'));
  const facts = h('dl', 'project-health-technical-list');
  const rows: Array<[string, string]> = grouped
    ? [['问题代码', finding.code], ['来源位置', findings.map((item) => `${item.file || '未知'}:${item.line}`).join('\n')]]
    : [['问题代码', finding.code], ['来源文件', finding.file || '未知'], ['来源行', String(finding.line)]];
  for (const [label, value] of rows) {
    const row = h('div');
    row.append(h('dt', undefined, label), h('dd', undefined, value));
    facts.appendChild(row);
  }
  technical.appendChild(facts);
  record.appendChild(technical);
  parent.appendChild(record);
}

export function renderAuditPanel(container: HTMLElement): void {
  container.innerHTML = '';
  container.setAttribute('data-editor-panel', 'audit');
  container.setAttribute('data-editor-region', 'text-audit');
  const workspace = h('div', 'project-health-workspace text-audit-workspace');
  appendHeading(workspace);
  container.appendChild(workspace);

  const validation = state.lastValidation;
  if (!validation || !isValidationCurrent()) {
    const empty = h('section', 'project-health-empty');
    empty.setAttribute('data-audit-state', validation ? 'stale' : 'waiting');
    empty.append(
      h('h2', undefined, validation ? '内容已修改，正在等待重新校验' : '正在等待项目校验'),
      h('p', undefined, '校验完成后会列出需要确认的称谓和设定用词。'),
    );
    workspace.appendChild(empty);
    return;
  }
  const validationErrors = validation.issues.filter((issue) => issue.severity === 'error');
  const compiled = validation.scenes;
  if (compiled.size === 0) {
    const empty = h('section', 'project-health-empty');
    const incomplete = validationErrors.length > 0;
    empty.setAttribute('data-audit-state', incomplete ? 'incomplete' : 'empty');
    empty.append(
      h('h2', undefined, incomplete ? '检查不完整' : '没有可检查的场景'),
      h('p', undefined, incomplete
        ? `有 ${validationErrors.length} 个剧本错误尚未通过校验。请先修复错误，再确认整个项目的一致性。`
        : '项目中还没有已通过校验的场景。新增或打开场景后，本页会自动更新。'),
    );
    workspace.appendChild(empty);
    return;
  }

  const counts = new Map<string, number>();
  const firstSeen = new Map<string, { file: string; line: number }>();
  for (const scene of compiled.values()) {
    for (const instruction of scene.instructions) {
      if (instruction.op === 'text' && instruction.speaker) {
        counts.set(instruction.speaker, (counts.get(instruction.speaker) ?? 0) + 1);
        if (!firstSeen.has(instruction.speaker)) {
          firstSeen.set(instruction.speaker, { file: instruction.file, line: instruction.line });
        }
      }
    }
  }

  const terms = parseTerminology(state.configFiles.terminology);
  const pairs = computeSpeakerPairs(counts);
  const findings: AuditFinding[] = [
    ...auditSpeakers(counts, (speaker) => firstSeen.get(speaker) ?? { file: '', line: 0 }),
    ...auditTerminology(compiled, terms),
  ];
  const incomplete = validationErrors.length > 0;

  const overview = h('section', 'project-health-audit-overview');
  overview.setAttribute('data-audit-state', incomplete ? 'incomplete' : findings.length > 0 ? 'attention' : 'clear');
  const title = incomplete
    ? '检查不完整'
    : findings.length > 0
      ? `发现 ${findings.length} 项需要查看`
      : '当前未发现一致性问题';
  overview.appendChild(h('h2', undefined, title));
  overview.appendChild(h('p', 'project-health-audit-counts', `说话人 ${counts.size} 种 · 名词条目 ${terms.length} 条 · 当前发现 ${findings.length} 项`));
  if (incomplete) {
    overview.appendChild(h('p', 'project-health-coverage-warning', `有 ${validationErrors.length} 个剧本错误尚未通过校验。以下结果只来自已成功校验的场景，不能代表整个项目。`));
  } else if (terms.length === 0) {
    overview.appendChild(h('p', undefined, state.configFiles.terminology == null
      ? '尚未启用名词表，当前只检查角色称谓。'
      : '当前名词表没有条目，暂只检查角色称谓。'));
  }
  workspace.appendChild(overview);

  if (findings.length === 0) {
    // A clear result is already the overview's title; only an incomplete check needs a second word.
    if (incomplete) {
      const empty = h('section', 'project-health-empty project-health-audit-empty');
      empty.append(
        h('h2', undefined, '已校验部分暂未发现问题'),
        h('p', undefined, '请先修复剩余剧本错误，再确认整个项目的一致性。'),
      );
      workspace.appendChild(empty);
    }
  } else {
    const attention = findings.filter((finding) => finding.severity !== 'info');
    const confirmation = findings.filter((finding) => finding.severity === 'info');
    for (const [titleText, group] of [['建议处理', attention], ['请确认', confirmation]] as const) {
      if (group.length === 0) continue;
      const section = h('section', 'project-health-section project-health-audit-group');
      const heading = h('div', 'project-health-section-heading');
      heading.append(h('h2', undefined, titleText), h('span', undefined, `${group.length} 项`));
      section.appendChild(heading);
      for (const same of groupFindings(group)) appendFinding(section, same, pairs, validation);
      workspace.appendChild(section);
    }
  }

  const scope = h('details', 'project-health-technical project-health-audit-scope');
  scope.append(
    h('summary', undefined, '名词表与检查范围'),
    h('p', undefined, '角色称谓检查始终可用。设定用词检查读取 content/config/terminology.json。'),
    h('p', undefined, '技术形状：{ terms: [{ canonical, variants[] }] }'),
  );
  workspace.appendChild(scope);
}
