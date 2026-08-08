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

  /** 读取内部引用（不拷贝）。仅供"承诺只读"的内部热路径使用
   *  （表达式求值器 / 文本插值）：求值器为纯函数、插值只做 String 转换，
   *  均不修改容器值，省去每字符/每条件求值一次的深拷贝开销。
   *  对外 API 与任何可能保存返回值的场景必须用 get（防御性拷贝）。 */
  getRef(name: string): VarValue {
    this.#assertDeclared(name);
    return this.#values.get(name)!;
  }

  /** 表达式求值器兼容读取（实现 runtime/expr-eval 的 ExprEnv 结构）。
   *  未声明变量返回 undefined（由求值器报"变量未定义"）。走 getRef 免拷贝热路径。 */
  getVariable(name: string): VarValue | undefined {
    return this.has(name) ? this.getRef(name) : undefined;
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

  /** 批量原子设置：先完成整批校验与转换，再一次性提交，避免部分状态写入。 */
  setMany(updates: readonly { name: string; value: VarValue }[]): void {
    const seen = new Set<string>();
    const prepared: Array<readonly [string, VarValue]> = [];
    for (const { name, value } of updates) {
      if (seen.has(name)) throw new Error(`setMany: 重复变量 '${name}'`);
      seen.add(name);
      const decl = this.#requireWritable(name);
      assertType(value, decl, 'value');
      prepared.push([name, coerce(decl, value)] as const);
    }
    for (const [name, value] of prepared) this.#values.set(name, value);
  }

  /** number 变量增减 delta（float/delta 均可）。
   *  标量热路径：number 变量直接原地改值 + clamp，免 get/set 的防御性拷贝往返
   *  （@mod/@inc/@dec 是剧本最高频的状态操作）。非 number 走旧路径报类型错误。 */
  modify(name: string, delta: number): void {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      throw new Error(`modify('${name}'): delta must be a finite number, got ${String(delta)}`);
    }
    const decl = this.#requireWritable(name);
    if (decl.type !== 'number') {
      this.set(name, this.getNumber(name) + delta); // 触发与旧实现一致的类型错误
      return;
    }
    let n = (this.#values.get(name) as number) + delta;
    if (decl.min !== undefined) n = Math.max(decl.min, n);
    if (decl.max !== undefined) n = Math.min(decl.max, n);
    this.#values.set(name, n);
  }

  /** number 变量 +1 */
  inc(name: string): void {
    this.modify(name, 1);
  }

  /** number 变量 -1 */
  dec(name: string): void {
    this.modify(name, -1);
  }

  /** boolean/flag 变量取反（标量热路径：原地取反，免 get/set 拷贝往返） */
  toggle(name: string): void {
    const decl = this.#requireWritable(name);
    if (decl.type !== 'boolean' && decl.type !== 'flag') {
      throw new Error(`toggle('${name}'): variable type is '${decl.type}', expected boolean/flag`);
    }
    this.#values.set(name, !(this.#values.get(name) as boolean));
  }

  /** 重置全部变量为声明初值（新游戏开始；readonly 一并重置——周目初始状态由声明表定义） */
  reset(): void {
    for (const [name, decl] of this.#decls) {
      this.#values.set(name, cloneValue(decl.initial));
    }
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
   * readonly 变量默认跳过（系统专属、防篡改）；读档等可信恢复传 allowReadonly: true（审计修复）。
   */
  restore(data: Record<string, VarValue>, opts?: { allowReadonly?: boolean }): void {
    for (const [key, value] of Object.entries(data)) {
      const decl = this.#decls.get(key);
      if (!decl) continue;
      if (decl.readonly && opts?.allowReadonly !== true) continue;
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
    case 'object': {
      // object 契约为任意 JSON 安全嵌套结构；递归拒绝非 JSON 安全值（undefined/函数/嵌套容器非法值）。
      // 否则 undefined 等会在 JSON.stringify 存档时被静默丢弃 → 读档数据缺失。
      if (typeof value !== 'object' || value === null || Array.isArray(value)) bad('object');
      assertJsonValue(value, decl, where, '$');
      break;
    }
    default:
      throw new Error(`Variable '${decl.name}': unknown declared type '${decl.type as string}'`);
  }
}

/** 递归校验 object 变量值为 JSON 安全结构（string/有限 number/boolean/数组/嵌套对象）。
 *  存档经 JSON 序列化往返，undefined/函数/NaN/Infinity 会被丢弃或变成 null，必须在写入前拦截。 */
function assertJsonValue(value: unknown, decl: VarDeclaration, where: string, pathStr: string): void {
  if (typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `Variable '${decl.name}' (${where}): object 属性 '${pathStr}' 必须为有限 number，得到 ${String(value)}`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonValue(v, decl, where, `${pathStr}[${i}]`));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      assertJsonValue(v, decl, where, `${pathStr}.${k}`);
    }
    return;
  }
  throw new TypeError(
    `Variable '${decl.name}' (${where}): object 属性 '${pathStr}' 不是 JSON 安全值（undefined/函数等会在存档序列化时静默丢失），得到 ${describeValue(value)}`,
  );
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
  if (Array.isArray(value)) return value.map(cloneValue);
  if (typeof value === 'object' && value !== null) {
    const out: { [key: string]: VarValue } = {};
    for (const [key, nested] of Object.entries(value)) out[key] = cloneValue(nested);
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
