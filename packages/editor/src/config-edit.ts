/**
 * 配置编辑纯逻辑（E3）：变量表（game.config.json variables）与成就表（achievements.json）
 * 的行模型 ⇄ JSON 双向转换与校验。UI 只管表格，落盘前全部经此处校验（编辑器不产出非法配置）。
 */
import { parseProjectConfigDocument } from '@surdet/authoring';
import { parseExpr, collectVars, validateVarDecl, type LintIssue } from '@surdet/core';
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
      if (t === '' || !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return { ok: false, error: `initial '${raw}' 不是合法数字` };
      return { ok: true, value: Number(t) };
    }
    case 'boolean':
    case 'flag': {
      if (t === 'true') return { ok: true, value: true };
      if (t === 'false') return { ok: true, value: false };
      return { ok: false, error: `initial '${raw}' 应为 true/false` };
    }
    case 'string': {
      if (!t.startsWith('"')) return { ok: true, value: raw };
      try {
        return { ok: true, value: JSON.parse(t) };
      } catch {
        return { ok: false, error: `initial '${raw}' 不是合法字符串` };
      }
    }
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
    if (row.readonly) decl.readonly = true;
    if (row.description.trim() !== '') decl.description = row.description.trim();
    const issues: LintIssue[] = [];
    if (!validateVarDecl('game.config.json', name, decl, issues)) {
      errors.push(...issues.map(issue => issue.text));
      continue;
    }
    Object.defineProperty(variables, name, { value: decl, enumerable: true, writable: true, configurable: true });
  }
  return { variables, errors };
}

/** 把新 variables 表合并回 game.config.json 文本（保留其余顶层键与 2 空格缩进；键序稳定） */
export function applyVariablesToConfig(originalText: string, variables: Record<string, unknown>): string {
  const obj = originalText.trim().length === 0
    ? {}
    : parseProjectConfigDocument(originalText);
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

/* ============================ E3 剩余：日历/事件/成长/鉴赏 共用助手 ============================ */

/** 行模型：文本列 string、勾选列 boolean（统一形状便于通用表格 UI） */
export type RowMap = Record<string, string | boolean>;

/** 值 → 行单元格：boolean 保留、对象 JSON 字符串化、其余 String、空值 '' */
function toCell(v: unknown): string | boolean {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** 列表字段 → 行数组（只取枚举的键；未枚举字段在保存时经原条目合并保留） */
function listToRows(raw: unknown, field: string, keys: string[]): RowMap[] {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(obj[field]) ? obj[field] : [];
  return list
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => {
      const row: RowMap = {};
      for (const k of keys) row[k] = toCell(e[k]);
      return row;
    });
}

function origList(raw: unknown, field: string): unknown[] {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return Array.isArray(obj[field]) ? obj[field] : [];
}

/** 行数组 → 列表条目：按主键（id/characterId）匹配原条目合并（保留未编辑字段），
 *  避免删行/中间插行时按索引合并导致未知字段错位（M4 批次审阅轮 Major 1 修复）；
 *  新增行（主键无匹配）或主键被改名时从空条目起步。
 *  numberKeys 由各配置字段契约显式提供；未列出的非 JSON 列一律按文本保存，
 *  避免标识、场景和表达式等数字样式文本被静默改型。 */
function applyRowsToList(
  origArr: unknown[], rows: RowMap[], knownKeys: string[], jsonKeys: string[], errors: string[], listLabel: string, primaryKey: string,
  numberKeys: readonly string[] = [],
): Record<string, unknown>[] {
  const claimed = new Set<unknown>(); // 一个原条目最多被一行认领（重复主键时后续行从空起步）
  const findOrig = (row: RowMap): Record<string, unknown> | null => {
    const key = String(row[primaryKey] ?? '').trim();
    if (key.length === 0) return null;
    for (const candidate of origArr) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || claimed.has(candidate)) continue;
      if (String((candidate as Record<string, unknown>)[primaryKey] ?? '').trim() === key) {
        claimed.add(candidate);
        return { ...(candidate as Record<string, unknown>) };
      }
    }
    return null;
  };
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const entry: Record<string, unknown> = findOrig(row) ?? {};
    for (const key of knownKeys) {
      const cell = row[key];
      if (cell === undefined) continue;
      if (typeof cell === 'boolean') { entry[key] = cell; continue; }
      const t = String(cell).trim();
      if (t === '') { delete entry[key]; continue; }
      if (jsonKeys.includes(key)) {
        try {
          entry[key] = JSON.parse(t);
        } catch {
          errors.push(`${listLabel} 第 ${i + 1} 行 ${key} 不是合法 JSON：${t}`);
        }
        continue;
      }
      if (numberKeys.includes(key)) {
        const n = Number(t);
        if (!Number.isFinite(n)) errors.push(`${listLabel} 第 ${i + 1} 行 ${key} 不是有限数字：${t}`);
        else entry[key] = n;
        continue;
      }
      entry[key] = t;
    }
    out.push(entry);
  }
  return out;
}

function checkUniqueId(rows: RowMap[], key: string, label: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const r of rows) {
    const id = String(r[key] ?? '').trim();
    if (id.length === 0) continue;
    if (seen.has(id)) errors.push(`${label} '${id}' 重复定义`);
    seen.add(id);
  }
}

function checkExprCell(cell: string | boolean | undefined, label: string, errors: string[]): void {
  if (typeof cell !== 'string') return;
  const t = cell.trim();
  if (t === '') return;
  try {
    parseExpr(t);
  } catch (err) {
    errors.push(`${label} 表达式语法错误：${err instanceof Error ? err.message : String(err)}`);
  }
}

/* ============================ calendar.json ============================ */

export const CALENDAR_NODE_KEYS = ['id', 'name', 'x', 'y', 'isBase', 'apCost', 'requires', 'visibleWhen', 'eventId'];
export const CALENDAR_CMD_KEYS = ['id', 'name', 'apCost', 'when', 'effects', 'perTurn'];
export const CALENDAR_SCALAR_KEYS = ['maxAp', 'maxTurns', 'dateTemplate', 'weeksPerMonth', 'onTurnStartEventId', 'onTurnEndEventId'];

export interface CalendarRows {
  scalars: Record<string, string>;
  nodes: RowMap[];
  baseCommands: RowMap[];
}

/** N1（Reliability Phase 3B）：calendar node 开放条件的 canonical 字段是 visibleWhen
 *  （Core CalendarRunner 与 CLI lint 只消费它）；旧 Editor 误写的 nodes[].when 是 Runtime
 *  从未读取的 legacy 字段。保存前对源条目（浅拷贝，原对象不动）做确定性正规化：
 *  - when-only / 与 visibleWhen 等值的冗余 → 迁移为 visibleWhen 并删除 when
 *    （旧 UI 该列即“开放条件”，历史 author intent 确定）；
 *  - 双字段冲突 → fail-loud（errors 阻止保存），禁止静默选择或猜测；
 *  - 正规化后的条目才交给 applyRowsToList，成功保存的节点绝不携带 when；
 *    unknown 字段照常经主键合并保留。baseCommands[].when 是合法独立字段，不在此列。 */
function normalizeCalendarSourceNodes(raw: unknown, errors: string[]): unknown[] {
  const orig = origList(raw, 'nodes').map((e) => ({ ...(e as Record<string, unknown>) }));
  for (const node of orig) {
    if (!('when' in node)) continue;
    const id = String(node['id'] ?? '');
    const canonical = typeof node['visibleWhen'] === 'string' ? (node['visibleWhen'] as string).trim() : '';
    const legacy = typeof node['when'] === 'string' ? (node['when'] as string).trim() : '';
    if (canonical !== '' && legacy !== '' && canonical !== legacy) {
      errors.push(`地图节点 '${id}' 同时存在冲突的 visibleWhen（'${canonical}'）与 legacy when（'${legacy}'）——请人工确认后仅保留一个条件`);
      continue;
    }
    if (canonical === '' && legacy !== '') node['visibleWhen'] = node['when'];
    delete node['when'];
  }
  return orig;
}

export function parseCalendarRows(raw: unknown): CalendarRows {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const scalars: Record<string, string> = {};
  for (const k of CALENDAR_SCALAR_KEYS) scalars[k] = String(toCell(obj[k]));
  // N1：legacy when-only 的历史值在 UI 呈现为 canonical visibleWhen（保存时经
  // normalizeCalendarSourceNodes 正规化删除 when）；双字段冲突由保存侧 fail-loud。
  const origNodes = Array.isArray(obj['nodes'])
    ? (obj['nodes'] as unknown[]).filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
    : [];
  const nodes = listToRows(raw, 'nodes', CALENDAR_NODE_KEYS).map((row, i) => {
    const legacy = origNodes[i];
    if (legacy !== undefined && String(row['visibleWhen'] ?? '').trim() === ''
      && typeof legacy['when'] === 'string' && (legacy['when'] as string).trim() !== '') {
      row['visibleWhen'] = legacy['when'];
    }
    return row;
  });
  return {
    scalars,
    nodes,
    baseCommands: listToRows(raw, 'baseCommands', CALENDAR_CMD_KEYS),
  };
}

export function rowsToCalendar(raw: unknown, rows: CalendarRows): { json: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const json: Record<string, unknown> = { ...obj };
  for (const k of CALENDAR_SCALAR_KEYS) {
    const t = (rows.scalars[k] ?? '').trim();
    if (t === '') { delete json[k]; continue; }
    if (k === 'dateTemplate' || k === 'onTurnStartEventId' || k === 'onTurnEndEventId') { json[k] = t; continue; }
    const n = Number(t);
    if (!Number.isFinite(n)) errors.push(`日历 ${k} 不是数字：${t}`);
    else json[k] = n;
  }
  json.nodes = applyRowsToList(normalizeCalendarSourceNodes(raw, errors), rows.nodes, CALENDAR_NODE_KEYS, ['requires'], errors, '地图节点', 'id', ['x', 'y', 'apCost']);
  json.baseCommands = applyRowsToList(origList(raw, 'baseCommands'), rows.baseCommands, CALENDAR_CMD_KEYS, ['effects'], errors, '据点指令', 'id', ['apCost', 'perTurn']);
  checkUniqueId(rows.nodes, 'id', '地图节点', errors);
  checkUniqueId(rows.baseCommands, 'id', '据点指令', errors);
  for (const r of rows.nodes) checkExprCell(r.visibleWhen, `地图节点 ${String(r.id ?? '')} 的 visibleWhen`, errors);
  for (const r of rows.baseCommands) checkExprCell(r.when, `据点指令 ${String(r.id ?? '')} 的 when`, errors);
  return { json, errors };
}

/* ============================ events.json ============================ */

export const EVENT_PROFILE_KEYS = ['characterId', 'variable', 'tiers'];
export const EVENT_KEYS = ['id', 'characterId', 'when', 'scene', 'once', 'priority', 'effects'];

export interface EventsRows {
  profiles: RowMap[];
  events: RowMap[];
  scheduled: RowMap[];
}

export function parseEventsRows(raw: unknown): EventsRows {
  return {
    profiles: listToRows(raw, 'profiles', EVENT_PROFILE_KEYS),
    events: listToRows(raw, 'events', EVENT_KEYS),
    scheduled: listToRows(raw, 'scheduled', EVENT_KEYS),
  };
}

export function rowsToEvents(raw: unknown, rows: EventsRows): { json: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const json: Record<string, unknown> = { ...obj };
  json.profiles = applyRowsToList(origList(raw, 'profiles'), rows.profiles, EVENT_PROFILE_KEYS, ['tiers'], errors, '好感 profile', 'characterId');
  json.events = applyRowsToList(origList(raw, 'events'), rows.events, EVENT_KEYS, ['effects'], errors, '事件', 'id', ['priority']);
  json.scheduled = applyRowsToList(origList(raw, 'scheduled'), rows.scheduled, EVENT_KEYS, ['effects'], errors, '日程事件', 'id', ['priority']);
  checkUniqueId(rows.events, 'id', '事件', errors);
  checkUniqueId(rows.scheduled, 'id', '日程事件', errors);
  for (const r of [...rows.events, ...rows.scheduled]) checkExprCell(r.when, `事件 ${String(r.id ?? '')} 的 when`, errors);
  return { json, errors };
}

/* ============================ growth.json ============================ */

export const GROWTH_PROFILE_KEYS = ['characterId', 'initialLevel', 'maxLevel', 'statGrowth', 'levelEvents'];

export interface GrowthRows {
  scalars: Record<string, string>;
  profiles: RowMap[];
}

export function parseGrowthRows(raw: unknown): GrowthRows {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const curve = (obj.curve && typeof obj.curve === 'object' ? obj.curve : {}) as Record<string, unknown>;
  return {
    scalars: { 'curve.base': String(curve.base ?? ''), 'curve.linear': String(curve.linear ?? '') },
    profiles: listToRows(raw, 'profiles', GROWTH_PROFILE_KEYS),
  };
}

export function rowsToGrowth(raw: unknown, rows: GrowthRows): { json: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const json: Record<string, unknown> = { ...obj };
  const origCurve = (obj.curve && typeof obj.curve === 'object' ? obj.curve : {}) as Record<string, unknown>;
  const curve: Record<string, unknown> = { ...origCurve };
  for (const k of ['base', 'linear'] as const) {
    const t = (rows.scalars[`curve.${k}`] ?? '').trim();
    if (t === '') { delete curve[k]; continue; }
    const n = Number(t);
    if (!Number.isFinite(n)) errors.push(`成长曲线 ${k} 不是数字：${t}`);
    else curve[k] = n;
  }
  json.curve = curve;
  json.profiles = applyRowsToList(origList(raw, 'profiles'), rows.profiles, GROWTH_PROFILE_KEYS, ['statGrowth', 'levelEvents'], errors, '成长 profile', 'characterId', ['initialLevel', 'maxLevel']);
  for (const p of json.profiles as Record<string, unknown>[]) {
    if (typeof p.initialLevel === 'number' && typeof p.maxLevel === 'number' && p.initialLevel > p.maxLevel) {
      errors.push(`成长 profile ${String(p.characterId ?? '')} initialLevel(${p.initialLevel}) > maxLevel(${p.maxLevel})`);
    }
    const le = p.levelEvents;
    if (le && typeof le === 'object' && !Array.isArray(le)) {
      for (const [lv, sc] of Object.entries(le as Record<string, unknown>)) {
        if (typeof sc !== 'string') errors.push(`成长 profile ${String(p.characterId ?? '')} levelEvents[${lv}] 场景必须是字符串`);
      }
    }
  }
  return { json, errors };
}

/* ============================ gallery.json ============================ */

export const GALLERY_CG_KEYS = ['id', 'name', 'src'];
export const GALLERY_TEXT_KEYS = ['id', 'name', 'scene', 'label'];

export interface GalleryRows {
  cgs: RowMap[];
  music: RowMap[];
  texts: RowMap[];
}

export function parseGalleryRows(raw: unknown): GalleryRows {
  return {
    cgs: listToRows(raw, 'cgs', GALLERY_CG_KEYS),
    music: listToRows(raw, 'music', GALLERY_CG_KEYS),
    texts: listToRows(raw, 'texts', GALLERY_TEXT_KEYS),
  };
}

export function rowsToGallery(raw: unknown, rows: GalleryRows): { json: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const json: Record<string, unknown> = { ...obj };
  json.cgs = applyRowsToList(origList(raw, 'cgs'), rows.cgs, GALLERY_CG_KEYS, [], errors, 'CG', 'id');
  json.music = applyRowsToList(origList(raw, 'music'), rows.music, GALLERY_CG_KEYS, [], errors, '鉴赏音乐', 'id');
  json.texts = applyRowsToList(origList(raw, 'texts'), rows.texts, GALLERY_TEXT_KEYS, [], errors, '回想', 'id');
  checkUniqueId(rows.cgs, 'id', 'CG', errors);
  checkUniqueId(rows.music, 'id', '鉴赏音乐', errors);
  checkUniqueId(rows.texts, 'id', '回想', errors);
  return { json, errors };
}

/* ============================ terminology.json ============================ */

export const TERMINOLOGY_KEYS = ['canonical', 'variants'];

export interface TerminologyTableRows {
  terms: RowMap[];
}

export function parseTerminologyRows(raw: unknown): TerminologyTableRows {
  return { terms: listToRows(raw, 'terms', TERMINOLOGY_KEYS) };
}

/** 行 → { terms: [...] }；校验：规范词唯一、variants 为合法 JSON 数组（与 core parseTerminology 同形状） */
export function rowsToTerminology(raw: unknown, rows: TerminologyTableRows): { json: Record<string, unknown>; errors: string[] } {
  const errors: string[] = [];
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const json: Record<string, unknown> = { ...obj };
  json.terms = applyRowsToList(origList(raw, 'terms'), rows.terms, TERMINOLOGY_KEYS, ['variants'], errors, '名词', 'canonical');
  const seen = new Set<string>();
  for (const r of rows.terms) {
    const c = String(r.canonical ?? '').trim();
    if (c.length === 0) continue;
    if (seen.has(c)) errors.push(`规范词 '${c}' 重复定义`);
    seen.add(c);
  }
  return { json, errors };
}

/** 名词表导入（JSON 文件 → 行模型）：形状容错与 parseTerminology 对齐，但导入要求更严——
 *  顶层必须是 { terms: [...] }，每条目必须有 canonical（variants 缺省按空数组）；
 *  非法形状返回错误描述（导入入口提示用）。重复 canonical 不在此拦截，留到保存校验统一报 */
export function normalizeTerminologyImport(raw: unknown): { terms: RowMap[] } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: '顶层必须是 { terms: [...] } 形状的 JSON 对象' };
  }
  const list = (raw as Record<string, unknown>).terms;
  if (!Array.isArray(list)) return { error: '缺少 terms 数组' };
  const terms: RowMap[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || typeof t !== 'object' || Array.isArray(t)) return { error: `terms[${i}] 不是对象` };
    const d = t as Record<string, unknown>;
    if (typeof d.canonical !== 'string' || d.canonical.trim().length === 0) {
      return { error: `terms[${i}] 缺少规范词 canonical` };
    }
    const variants = Array.isArray(d.variants) ? d.variants : [];
    const vs = variants.filter((v): v is string => typeof v === 'string');
    terms.push({ canonical: d.canonical, variants: JSON.stringify(vs) });
  }
  return { terms };
}
