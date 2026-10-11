import { KNOWN_INSTRUCTIONS } from './dsl/compiler.js';
import { decodeStageToken } from './stage.js';
import { isJsonSafeValue } from './save/save-manager.js';
import type { CompiledScene } from './dsl/ast.js';
import type { LintIssue } from './scene-lint.js';

export const PROJECT_PLUGIN_API = 1 as const;
export interface PluginParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  optional?: boolean;
}
export interface PluginInstruction {
  name: string;
  blocking: boolean;
  parameters: PluginParameter[];
  modifiers?: PluginParameter[];
}
export interface ProjectPluginDeclaration {
  id: string;
  entry: string;
  apiVersion: typeof PROJECT_PLUGIN_API;
  stateVersion?: number;
  instructions: PluginInstruction[];
}
export type PluginValues = Record<string, string | number | boolean>;
export type ProjectPluginSnapshots = Record<string, { version: number; value: unknown }>;
export interface ProjectPluginHooks {
  execute(plugin: ProjectPluginDeclaration, instruction: PluginInstruction, values: PluginValues): void;
  snapshot(): ProjectPluginSnapshots;
  /** Prepare without live writes; the returned commit only swaps already prepared state. */
  prepareRestore(snapshot: ProjectPluginSnapshots): () => void;
}
const identifier = /^[a-z][a-z0-9_]*$/;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (message: string): never => { throw new Error(`项目插件：${message}`); };
function fields(value: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`未知字段 ${key}`);
}
function parameters(value: unknown, label: string): PluginParameter[] {
  if (!Array.isArray(value)) fail(`${label} 必须是数组`);
  const names = new Set<string>();
  let optional = false;
  return (value as unknown[]).map(item => {
    if (!record(item)) fail(`${label} 参数必须是对象`);
    const p = item as Record<string, unknown>;
    fields(p, ['name', 'type', 'optional']);
    if (typeof p.name !== 'string' || !identifier.test(p.name) || names.has(p.name)) fail(`${label} 参数名非法或重复`);
    names.add(p.name as string);
    if (!['string', 'number', 'boolean'].includes(p.type as string)) fail(`${label} 参数类型不支持`);
    if (p.optional !== undefined && typeof p.optional !== 'boolean') fail(`${label} optional 必须是布尔值`);
    if (optional && p.optional !== true) fail(`${label} 可选参数后不能再放必填参数`);
    optional ||= p.optional === true;
    return { name: p.name as string, type: p.type as PluginParameter['type'], ...(p.optional === undefined ? {} : { optional: p.optional as boolean }) };
  });
}

/** Declaration is data, never permission to import/evaluate its entry. */
export function readProjectPlugins(config: { plugins?: unknown }): ProjectPluginDeclaration[] {
  if (config.plugins === undefined) return [];
  if (!Array.isArray(config.plugins)) fail('plugins 必须是数组');
  const ids = new Set<string>(), entries = new Set<string>(), instructions = new Set<string>();
  return (config.plugins as unknown[]).map(value => {
    if (!record(value)) fail('声明必须是对象');
    const d = value as Record<string, unknown>;
    fields(d, ['id', 'entry', 'apiVersion', 'stateVersion', 'instructions']);
    if (typeof d.id !== 'string' || !identifier.test(d.id) || ids.has(d.id)) fail('id 非法或重复');
    if (typeof d.entry !== 'string' || !/^plugins\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:js|ts)$/.test(d.entry)
      || entries.has(d.entry.toLowerCase())) fail('entry 必须是项目内唯一的 plugins/*.js 或 .ts 路径');
    if (d.apiVersion !== PROJECT_PLUGIN_API) fail(`插件 ${d.id} 不支持 API ${String(d.apiVersion)}`);
    if (d.stateVersion !== undefined && (!Number.isSafeInteger(d.stateVersion) || (d.stateVersion as number) < 1)) fail('stateVersion 必须是正整数');
    if (!Array.isArray(d.instructions)) fail('instructions 必须是数组');
    ids.add(d.id as string); entries.add((d.entry as string).toLowerCase());
    const parsed = (d.instructions as unknown[]).map(value => {
      if (!record(value)) fail('指令声明必须是对象');
      const i = value as Record<string, unknown>;
      fields(i, ['name', 'blocking', 'parameters', 'modifiers']);
      if (typeof i.name !== 'string' || !identifier.test(i.name) || KNOWN_INSTRUCTIONS.has(i.name) || instructions.has(i.name)) fail('指令名非法、重复或覆盖内置指令');
      if (typeof i.blocking !== 'boolean') fail('blocking 必须是布尔值');
      instructions.add(i.name as string);
      const positional = parameters(i.parameters, i.name as string);
      const modifiers = i.modifiers === undefined ? undefined : parameters(i.modifiers, `${i.name} modifiers`);
      if (modifiers?.some(p => positional.some(a => a.name === p.name))) fail('位置参数和修饰符名称不能重复');
      return { name: i.name as string, blocking: i.blocking as boolean, parameters: positional, ...(modifiers ? { modifiers } : {}) };
    });
    return { id: d.id as string, entry: d.entry as string, apiVersion: PROJECT_PLUGIN_API,
      ...(d.stateVersion === undefined ? {} : { stateVersion: d.stateVersion as number }), instructions: parsed };
  });
}

export function pluginInstructionValues(instruction: PluginInstruction, args: readonly string[], modifiers: ReadonlyMap<string, string>): PluginValues {
  if (args.length > instruction.parameters.length) fail(`@${instruction.name} 位置参数过多`);
  const values: PluginValues = {};
  const parse = (parameter: PluginParameter, raw: string | undefined) => {
    if (raw === undefined) { if (!parameter.optional) fail(`@${instruction.name} 缺少 ${parameter.name}`); return; }
    const text = decodeStageToken(raw);
    if (parameter.type === 'string') values[parameter.name] = text;
    else if (parameter.type === 'boolean') {
      if (text !== 'true' && text !== 'false') fail(`${parameter.name} 必须是 true 或 false`);
      values[parameter.name] = text === 'true';
    } else {
      if (!text.trim() || !Number.isFinite(Number(text))) fail(`${parameter.name} 必须是有限数值`);
      values[parameter.name] = Number(text);
    }
  };
  instruction.parameters.forEach((parameter, index) => parse(parameter, args[index]));
  for (const key of modifiers.keys()) if (!instruction.modifiers?.some(p => p.name === key)) fail(`@${instruction.name} 未声明修饰符 ${key}`);
  instruction.modifiers?.forEach(parameter => parse(parameter, modifiers.get(parameter.name)));
  return values;
}

export function validatePluginInstructions(scene: CompiledScene, plugins: readonly ProjectPluginDeclaration[], issues: LintIssue[]): void {
  const declared = new Map(plugins.flatMap(plugin => plugin.instructions.map(instruction => [instruction.name, instruction] as const)));
  for (const instruction of scene.instructions) {
    if (instruction.op !== 'instr') continue;
    const declaration = declared.get(instruction.name);
    if (!declaration) continue;
    try { pluginInstructionValues(declaration, instruction.args, instruction.modifiers); }
    catch (error) { issues.push({ severity: 'error', code: 'PLUGIN_ARGUMENT', text: error instanceof Error ? error.message : String(error),
      file: instruction.file, line: instruction.line, col: instruction.col, hint: '按项目插件声明的参数类型和数量修改指令。' }); }
  }
}

export function assertPluginSnapshots(value: unknown): asserts value is ProjectPluginSnapshots {
  if (!record(value) || !isJsonSafeValue(value)) fail('状态必须是 JSON 安全对象');
  for (const [id, item] of Object.entries(value as Record<string, unknown>)) {
    if (!identifier.test(id) || !record(item) || !Number.isSafeInteger(item.version) || (item.version as number) < 1 || !('value' in item)) fail(`状态 ${id} 必须有正整数 version 和 value`);
    fields(item as Record<string, unknown>, ['version', 'value']);
  }
}
