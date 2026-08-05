/**
 * 配置编辑纯逻辑（E3）：变量表（game.config.json variables）与成就表（achievements.json）
 * 的行模型 ⇄ JSON 双向转换与校验。UI 只管表格，落盘前全部经此处校验（编辑器不产出非法配置）。
 */
import { parseExpr, collectVars } from '@surdet/core';
import type { CompiledScene, GenericInstr, ChoiceInstr, CondJumpInstr, SetInstr, ModifyInstr, SwitchInstr, TextInstr } from '@surdet/core';

/* ============================ 变量表 ============================ */

export const VAR_TYPES = ['number', 'string', 'boolean', 'flag', 'string[]', 'number[]', 'object'] as const;

export interface VariableRow {
  name: string;
  type: string;
  /** initial/min/max 在表格中均为文本输入，保存时按类型解析 */
  initial: string;
  min: string;
  max: string;
  readonly: boolean;
  description: string;
}

/** game.config.json 原始对象 → 表格行（键序保持） */
export function parseVariablesToRows(raw: Record<string, unknown>): VariableRow[] {
  const vars = raw['variables'];
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return [];
  const rows: VariableRow[] = [];
  for (const [name, decl] of Object.entries(vars as Record<string, unknown>)) {
    if (!decl || typeof decl !== 'object') continue;
    const d = decl as Record<string, unknown>;
    rows.push({
      name,
      type: typeof d.type === 'string' ? d.type : 'number',
      initial: d.initial === undefined ? '' : JSON.stringify(d.initial),
      min: typeof d.min === 'number' ? String(d.min) : '',
      max: typeof d.max === 'number' ? String(d.max) : '',
      readonly: d.readonly === true,
      description: typeof d.description === 'string' ? d.description : '',
    });
  }
  return rows;
}

function parseInitial(type: string, raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = raw.trim();
  switch (type) {
    case 'number': {
      if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, error: `initial '${raw}' 不是合法数字` };
      return { ok: true, value: Number(t) };
    }
    case 'boolean':
    case 'flag': {
      if (t === 'true') return { ok: true, value: true };
      if (t === 'false') return { ok: true, value: false };
      return { ok: false, error: `initial '${raw}' 应为 true/false` };
    }
    case 'string':
      return { ok: true, value: t.replace(/^"|"$/g, '') };
    case 'string[]':
    case 'number[]':
    case 'object': {
      if (t === '') return { ok: true, value: type === 'object' ? {} : [] };
      try {
        return { ok: true, value: JSON.parse(t) };
      } catch {
        return { ok: false, error: `initial '${raw}' 不是合法 JSON` };
      }
    }
    default:
      return { ok: false, error: `未知类型 '${type}'` };
  }
}

/** 表格行 → variables 对象；返回错误列表（空 = 全部合法）。键序 = 行序（稳定 diff） */
export function rowsToVariables(rows: VariableRow[]): { variables: Record<string, unknown>; errors: string[] } {
  const variables: Record<string, unknown> = {};
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.name.trim();
    if (name.length === 0) {
      errors.push('存在未填名称的变量行');
      continue;
    }
    if (seen.has(name)) {
      errors.push(`变量 '${name}' 重复定义`);
      continue;
    }
    seen.add(name);
    if (!(VAR_TYPES as readonly string[]).includes(row.type)) {
      errors.push(`变量 '${name}' 类型非法：'${row.type}'（可选：${VAR_TYPES.join('/')}）`);
      continue;
    }
    const init = parseInitial(row.type, row.initial);
    if (!init.ok) {
      errors.push(`变量 '${name}' ${init.error}`);
      continue;
    }
    const decl: Record<string, unknown> = { type: row.type, initial: init.value };
    if (row.min.trim() !== '') {
      const n = Number(row.min);
      if (!Number.isFinite(n)) errors.push(`变量 '${name}' min 不是合法数字`);
      else decl.min = n;
    }
    if (row.max.trim() !== '') {
      const n = Number(row.max);
      if (!Number.isFinite(n)) errors.push(`变量 '${name}' max 不是合法数字`);
      else decl.max = n;
    }
    if (typeof decl.min === 'number' && typeof decl.max === 'number' && decl.min > decl.max) {
      errors.push(`变量 '${name}' min(${decl.min}) > max(${decl.max})`);
    }
    if (row.readonly) decl.readonly = true;
    if (row.description.trim() !== '') decl.description = row.description.trim();
    variables[name] = decl;
  }
  return { variables, errors };
}

/** 把新 variables 表合并回 game.config.json 文本（保留其余顶层键与 2 空格缩进；键序稳定） */
export function applyVariablesToConfig(originalText: string, variables: Record<string, unknown>): string {
  let obj: Record<string, unknown> = {};
  if (originalText.trim().length > 0) {
    obj = JSON.parse(originalText) as Record<string, unknown>;
  }
  obj['variables'] = variables;
  return JSON.stringify(obj, null, 2);
}

/* ============================ 成就表 ============================ */

export interface AchievementRow {
  id: string;
  name: string;
  description: string;
  when: string;
  hidden: boolean;
}

/** achievements.json（顶层数组）→ 表格行 */
export function parseAchievementsToRows(raw: unknown): AchievementRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: AchievementRow[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const d = a as Record<string, unknown>;
    rows.push({
      id: typeof d.id === 'string' ? d.id : '',
      name: typeof d.name === 'string' ? d.name : '',
      description: typeof d.description === 'string' ? d.description : '',
      when: typeof d.when === 'string' ? d.when : '',
      hidden: d.hidden === true,
    });
  }
  return rows;
}

/** 表格行 → achievements 数组；when 表达式用 core parseExpr 校验（与运行时同源）。
 *  条目键序固定 id/name/description/when/hidden，仅写非空字段（与 starter 现有文件风格一致） */
export function rowsToAchievements(rows: AchievementRow[]): { json: Record<string, unknown>[]; errors: string[] } {
  const json: Record<string, unknown>[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.id.trim();
    if (id.length === 0) {
      errors.push('存在未填 ID 的成就行');
      continue;
    }
    if (seen.has(id)) {
      errors.push(`成就 '${id}' 重复定义`);
      continue;
    }
    seen.add(id);
    if (row.when.trim() !== '') {
      try {
        parseExpr(row.when);
      } catch (err) {
        errors.push(`成就 '${id}' when 表达式语法错误：${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    const entry: Record<string, unknown> = { id, name: row.name };
    if (row.description.trim() !== '') entry.description = row.description.trim();
    if (row.when.trim() !== '') entry.when = row.when.trim();
    if (row.hidden) entry.hidden = true;
    json.push(entry);
  }
  return { json, errors };
}

/* ============================ 剧本变量引用收集（删除保护） ============================ */

const INTERP_RE = /\{([A-Za-z_][\w.]*)\}/g;

/** 收集剧本编译产物中引用的变量：变量名 → 引用它的场景 ID 集合。
 *  覆盖：@set/@mod 目标、@inc/@dec/@toggle/@flag/@unflag/@add_item 等状态指令、
 *  @if/choice 条件表达式、@switch 变量、台词 {变量} 插值 */
export function collectReferencedVars(scenes: Map<string, CompiledScene>): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  const add = (name: string, sceneId: string): void => {
    if (name.length === 0) return;
    if (!refs.has(name)) refs.set(name, new Set());
    refs.get(name)!.add(sceneId);
  };
  const addExpr = (expr: string, sceneId: string): void => {
    try {
      for (const v of collectVars(parseExpr(expr))) add(v, sceneId);
    } catch {
      /* 表达式非法由校验报，此处跳过 */
    }
  };
  const STATE_INSTRS = new Set(['inc', 'dec', 'toggle', 'flag', 'unflag', 'add_item', 'remove_item']);
  for (const [sceneId, scene] of scenes) {
    for (const instr of scene.instructions) {
      switch (instr.op) {
        case 'set': add((instr as SetInstr).varName, sceneId); addExpr((instr as SetInstr).expr, sceneId); break;
        case 'modify': add((instr as ModifyInstr).varName, sceneId); break;
        case 'condJump': addExpr((instr as CondJumpInstr).expr, sceneId); break;
        case 'switch': add((instr as SwitchInstr).varName, sceneId); break;
        case 'text': {
          const t = instr as TextInstr;
          for (const m of (t.value ?? '').matchAll(INTERP_RE)) add(m[1]!, sceneId);
          if (t.speaker) for (const m of t.speaker.matchAll(INTERP_RE)) add(m[1]!, sceneId);
          break;
        }
        case 'choice': {
          for (const opt of (instr as ChoiceInstr).options) {
            if (opt.when) addExpr(opt.when, sceneId);
          }
          break;
        }
        case 'instr': {
          const g = instr as GenericInstr;
          if (STATE_INSTRS.has(g.name) && g.args[0]) add(g.args[0], sceneId);
          if (g.name === 'has_item') {
            if (g.args[0]) add(g.args[0], sceneId);
            if (g.args[2]) add(g.args[2], sceneId);
          }
          if (g.name === 'check' && g.args[0]) addExpr(g.args.join(' '), sceneId);
          break;
        }
        default:
          break;
      }
    }
  }
  return refs;
}
