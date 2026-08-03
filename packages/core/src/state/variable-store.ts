import type { VarDeclaration, VarPrimitive, VarValue, VarType } from './types.js';

export type { VarDeclaration, VarPrimitive, VarValue, VarType } from './types.js';

/**
 * 类型安全的变量仓库。
 *
 * - 变量必须先声明后使用；未声明访问/赋值抛错（带变量名）。
 * - set 时按声明类型做运行时校验，类型不符抛错。
 * - number 类型越界自动 clamp 到 [min, max]。
 * - readonly 变量禁止 set/modify。
 * - snapshot/restore 供存档系统做全量快照。
 */
export class VariableStore {
  #values = new Map<string, VarValue>();
  #decls = new Map<string, VarDeclaration>();

  constructor(declarations: readonly VarDeclaration[] = []) {
    for (const decl of declarations) this.declare(decl);
  }

  /** 声明一个变量，重复声明抛错 */
  declare(decl: VarDeclaration): void {
    if (this.#decls.has(decl.name)) {
      throw new Error(`Variable '${decl.name}' is already declared`);
    }
    if (decl.type === 'number' && decl.min !== undefined && decl.max !== undefined && decl.min > decl.max) {
      throw new Error(`Variable '${decl.name}': min (${decl.min}) > max (${decl.max})，clamp 约束非法`);
    }
    assertType(decl.initial, decl, 'initial');
    this.#decls.set(decl.name, { ...decl });
    this.#values.set(decl.name, cloneValue(decl.initial));
  }

  /** 变量是否已声明 */
  has(name: string): boolean {
    return this.#decls.has(name);
  }

  /** 读取变量（泛型，注意类型安全由声明保证）。
   *  数组/对象返回防御性拷贝，防止外部绕过 set 直接修改内部状态。 */
  get<T extends VarValue = VarValue>(name: string): T {
    this.#assertDeclared(name);
    return cloneValue(this.#values.get(name)!) as T;
  }

  /** 表达式求值器兼容读取（实现 runtime/expr-eval 的 ExprEnv 结构）。
   *  未声明变量返回 undefined（由求值器报"变量未定义"）。 */
  getVariable(name: string): VarValue | undefined {
    return this.has(name) ? this.get(name) : undefined;
  }

  /** 读取 number（运行时校验类型） */
  getNumber(name: string): number {
    return checkPrimitive(this.get(name), name, 'number');
  }

  /** 读取 string（运行时校验类型） */
  getString(name: string): string {
    return checkPrimitive(this.get(name), name, 'string');
  }

  /** 读取 boolean（运行时校验类型） */
  getBoolean(name: string): boolean {
    return checkPrimitive(this.get(name), name, 'boolean');
  }

  /** 设置变量值（类型校验 + number 范围 clamp + readonly 拦截） */
  set(name: string, value: VarValue): void {
    const decl = this.#requireWritable(name);
    assertType(value, decl, 'value');
    this.#values.set(name, coerce(decl, value));
  }

  /** number 变量增减 delta（float/delta 均可） */
  modify(name: string, delta: number): void {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      throw new Error(`modify('${name}'): delta must be a finite number, got ${String(delta)}`);
    }
    const current = this.getNumber(name);
    this.set(name, current + delta);
  }

  /** number 变量 +1 */
  inc(name: string): void {
    this.modify(name, 1);
  }

  /** number 变量 -1 */
  dec(name: string): void {
    this.modify(name, -1);
  }

  /** boolean/flag 变量取反 */
  toggle(name: string): void {
    const decl = this.#requireWritable(name);
    if (decl.type !== 'boolean' && decl.type !== 'flag') {
      throw new Error(`toggle('${name}'): variable type is '${decl.type}', expected boolean/flag`);
    }
    this.set(name, !this.getBoolean(name));
  }

  /** 全部变量表副本（供工具/存档元信息），深拷贝防止外部篡改 */
  declarations(): ReadonlyArray<VarDeclaration> {
    return [...this.#decls.values()].map((d) => ({
      ...d,
      initial: cloneValue(d.initial),
    }));
  }

  /** 全量快照（存档用），返回可序列化对象 */
  snapshot(): Record<string, VarValue> {
    const out: Record<string, VarValue> = {};
    for (const [k, v] of this.#values) out[k] = cloneValue(v);
    return out;
  }

  /**
   * 从快照恢复。不存在的变量忽略；存在但类型不匹配抛错。
   * 恢复时重新施加范围 clamp，防止篡改存档破坏数值约束。
   */
  restore(data: Record<string, VarValue>): void {
    for (const [key, value] of Object.entries(data)) {
      const decl = this.#decls.get(key);
      if (!decl) continue;
      assertType(value, decl, 'snapshot');
      this.#values.set(key, coerce(decl, value));
    }
  }

  #assertDeclared(name: string): void {
    if (!this.#decls.has(name)) {
      throw new Error(`Undefined variable '${name}' (declare it in game.config.json)`);
    }
  }

  #requireWritable(name: string): VarDeclaration {
    this.#assertDeclared(name);
    const decl = this.#decls.get(name)!;
    if (decl.readonly) {
      throw new Error(`Variable '${name}' is readonly`);
    }
    return decl;
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function assertType(value: VarValue, decl: VarDeclaration, where: string): void {
  const bad = (expected: string) => {
    throw new TypeError(
      `Variable '${decl.name}' (${where}): expected ${expected}, got ${describeValue(value)}`,
    );
  };
  switch (decl.type) {
    case 'string':
      if (typeof value !== 'string') bad('string');
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) bad('finite number');
      break;
    case 'boolean':
    case 'flag':
      if (typeof value !== 'boolean') bad('boolean');
      break;
    case 'string[]':
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) bad('string[]');
      break;
    case 'number[]':
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
        bad('number[]');
      }
      break;
    case 'object':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) bad('object');
      break;
    default:
      throw new Error(`Variable '${decl.name}': unknown declared type '${decl.type as string}'`);
  }
}

function coerce(decl: VarDeclaration, value: VarValue): VarValue {
  if (decl.type === 'number' && typeof value === 'number') {
    let n = value;
    if (decl.min !== undefined) n = Math.max(decl.min, n);
    if (decl.max !== undefined) n = Math.min(decl.max, n);
    return n;
  }
  return cloneValue(value);
}

function checkPrimitive<T extends VarPrimitive>(
  value: VarValue,
  name: string,
  expected: 'string' | 'number' | 'boolean',
): T {
  if (typeof value !== expected) {
    throw new TypeError(
      `Variable '${name}': expected ${expected}, got ${describeValue(value)}`,
    );
  }
  return value as T;
}

function cloneValue(value: VarValue): VarValue {
  if (Array.isArray(value)) return value.map((v) => cloneValue(v)) as VarValue;
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, VarPrimitive> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = cloneValue(v) as VarPrimitive;
    }
    return out;
  }
  return value;
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (value === null) return 'null';
  if (typeof value === 'number' && !Number.isFinite(value)) return `number ${String(value)}`;
  return `${typeof value}${typeof value === 'object' ? '' : ` ${JSON.stringify(value)}`}`;
}
