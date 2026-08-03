import { DslError, type AstBlock, type CompiledScene, type CondJumpInstr, type DslDiagnostic, type DslInstr, type GenericInstr, type JumpInstr, type ModifyInstr, type SceneAst, type SetInstr } from './ast.js';
import { validateExpr } from './expr-parser.js';
import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import type { SourcePos } from './token.js';

/**
 * 指令白名单（lint/编译期校验用），分两档：
 *  - IMPLEMENTED：引擎已实现并被解释器/渲染层消费的指令。
 *  - PLANNED：已声明语法但尚未实现的指令，使用会产生 W002 告警（当前无效果），
 *    避免内容作者写出"静默无操作"的剧本。
 * KNOWN = IMPLEMENTED ∪ PLANNED，供外部做"是否已知指令"判断。
 */
export const IMPLEMENTED_INSTRUCTIONS: ReadonlySet<string> = new Set([
  // 演出（渲染层消费）
  'bg', 'show', 'hide', 'voice', 'bgm', 'se', 'fadein', 'fadeout',
  // 状态（解释器直改 store）
  'set', 'mod', 'inc', 'dec', 'toggle', 'flag', 'unflag',
  'unlock_cg', 'unlock_music',
  // 大系统指令（解释器转发 system 事件，由宿主消费）
  'battle', 'calendar', 'shop', 'item', 'affection', 'event',
  // 存档点（解释器发 autosave/savepoint 事件，由宿主写入槽位）
  'autosave', 'savepoint',
  // 流程/结构
  'goto', 'jump', 'end', 'scene', 'if', 'elif', 'else', 'endif', 'choice', 'label',
]);

/** 已声明但未实现的指令（lint 给 W002 警告，避免静默无操作） */
export const PLANNED_INSTRUCTIONS: ReadonlySet<string> = new Set([
  // 演出
  'wipe', 'shake', 'zoom', 'particle', 'flash', 'video', 'mov', 'tint', 'wait',
  // 文本/排版
  'title', 'chapter', 'tip', 'note', 'center', 'nvl', 'ruby',
  // 流程
  'call', 'return', 'loop', 'random', 'switch', 'check',
  // 状态
  'add_item', 'remove_item', 'has_item',
  // 系统
  'clear',
]);

/** 全部已知指令（implemented + planned），供外部判断指令是否被识别 */
export const KNOWN_INSTRUCTIONS: ReadonlySet<string> = new Set([
  ...IMPLEMENTED_INSTRUCTIONS,
  ...PLANNED_INSTRUCTIONS,
]);

/** 指令发射器：维护指令数组、标签索引、待回填跳转 */
class Emitter {
  instructions: DslInstr[] = [];
  labels = new Map<string, number>();
  diagnostics: DslDiagnostic[] = [];
  /** 等待 goto 目标解析的 goto 指令 */
  #pendingGotos: JumpInstr[] = [];

  emit<I extends DslInstr>(instr: I): number {
    instr.index = this.instructions.length;
    this.instructions.push(instr);
    return instr.index;
  }

  addDiagnostic(d: DslDiagnostic): void {
    this.diagnostics.push(d);
  }

  trackGoto(instr: JumpInstr): void {
    this.#pendingGotos.push(instr);
  }

  /** 全部指令发射完成后解析 goto 目标 */
  resolveGotos(): void {
    for (const j of this.#pendingGotos) {
      if (j.kind !== 'goto' || j.target.length === 0) continue;
      const targetIndex = this.labels.get(j.target);
      if (targetIndex === undefined) {
        throw new DslError('C002', `跳转目标标签 '@label ${j.target}' 不存在`, j, '检查拼写或补充 @label');
      }
      j.gotoIndex = targetIndex;
    }
  }
}

/**
 * 场景编译器：.gal 源码 → CompiledScene。
 * 组合 lexer + parser + 展平 + 静态校验（if 结构、表达式语法、goto 目标、choice 选项）。
 * 支持通过 extraInstructions 声明自定义指令（消 W001 告警）。
 */
export class SceneCompiler {
  /** 已实现指令 ∪ 自定义指令（planned 指令不在此集合，另行告警） */
  #known = new Set(IMPLEMENTED_INSTRUCTIONS);

  constructor(extraInstructions: Iterable<string> = []) {
    for (const name of extraInstructions) this.#known.add(name);
  }

  compile(source: string, file: string, sceneId: string): CompiledScene {
    const lexer = new Lexer();
    const tokens = lexer.tokenize(source, file);
    const parser = new Parser();
    const ast = parser.parse(tokens, sceneId);
    const emitter = new Emitter();

    this.#emitBlocks(emitter, ast.blocks);

    const endLine = source.split(/\r?\n/).length;
    emitter.emit<DslInstr>({ op: 'end', index: -1, file, line: endLine, col: 1 });
    emitter.resolveGotos();

    return {
      sceneId,
      instructions: emitter.instructions,
      labels: new Map(emitter.labels),
      diagnostics: emitter.diagnostics,
    };
  }

  #emitBlocks(emitter: Emitter, blocks: readonly AstBlock[]): void {
    for (const block of blocks) this.#emitBlock(emitter, block);
  }

  #emitBlock(emitter: Emitter, block: AstBlock): void {
    switch (block.kind) {
      case 'label': {
        if (emitter.labels.has(block.name)) {
          throw new DslError('C001', `标签 '@label ${block.name}' 重复定义`, block.pos);
        }
        emitter.labels.set(block.name, emitter.emit<DslInstr>({
          op: 'label', name: block.name, index: -1,
          file: block.pos.file, line: block.pos.line, col: block.pos.col,
        }));
        return;
      }
      case 'text': {
        emitter.emit<DslInstr>({
          op: 'text', speaker: block.speaker, value: block.value, index: -1,
          file: block.pos.file, line: block.pos.line, col: block.pos.col,
        });
        return;
      }
      case 'instr': {
        this.#emitStandaloneInstruction(emitter, block);
        return;
      }
      case 'if': {
        this.#emitIf(emitter, block);
        return;
      }
      case 'choice': {
        this.#emitChoice(emitter, block);
        return;
      }
    }
  }

  /** 顶层（非内联）指令 */
  #emitStandaloneInstruction(emitter: Emitter, block: Extract<AstBlock, { kind: 'instr' }>): void {
    const { name, args, modifiers, pos: p } = block;

    if (name === 'set') {
      emitter.emit(this.#buildSetInstr(block));
      return;
    }
    if (name === 'mod') {
      emitter.emit(this.#buildModifyInstr(block));
      return;
    }
    if (name === 'goto') {
      const target = args.join(' ');
      if (target.length === 0) {
        throw new DslError('S006', '@goto 缺少跳转目标标签', p, '形如 @goto labelName');
      }
      const j = this.#makeGoto(target, p);
      emitter.emit(j);
      emitter.trackGoto(j);
      return;
    }
    if (name === 'jump') {
      const target = args.join(' ');
      if (target.length === 0) {
        throw new DslError('S006', '@jump 缺少跳转目标场景', p, '形如 @jump sceneId.label 或 @jump sceneId');
      }
      emitter.emit<DslInstr>({ op: 'jump', kind: 'jump', target, gotoIndex: null, index: -1, file: p.file, line: p.line, col: p.col });
      return;
    }
    if (name === 'end') {
      // 用户显式 @end 与编译器自动追加的结束指令同构，解释器遇 end 即停，双 end 无害
      emitter.emit<DslInstr>({ op: 'end', index: -1, file: p.file, line: p.line, col: p.col });
      return;
    }
    if (name === 'if' || name === 'elif' || name === 'else' || name === 'endif') {
      // parser 已保证结构正确，此处兜底
      throw new DslError('S003', `@${name} 位置非法`, p);
    }

    this.#warnUnknown(emitter, name, p);
    emitter.emit(this.#makeGeneric(name, args, modifiers, p));
  }

  /** @if 编译：condJump + then + (jump + else) */
  #emitIf(emitter: Emitter, block: Extract<AstBlock, { kind: 'if' }>): void {
    const { expr, then, else: elseBlocks, pos: p } = block;

    const condIdx = emitter.emit<DslInstr>({
      op: 'condJump', expr, target: 0, index: -1,
      file: p.file, line: p.line, col: p.col,
    });

    this.#emitBlocks(emitter, then);

    let elseStart = emitter.instructions.length;
    let jumpIdx: number | null = null;

    if (elseBlocks.length > 0) {
      const j = this.#makeGoto('', p);
      jumpIdx = emitter.emit<DslInstr>(j);
      elseStart = emitter.instructions.length;
      this.#emitBlocks(emitter, elseBlocks);
    }

    const endif = emitter.instructions.length;
    (emitter.instructions[condIdx] as CondJumpInstr).target = elseStart;
    if (jumpIdx !== null) {
      (emitter.instructions[jumpIdx] as JumpInstr).gotoIndex = endif;
    }
  }

  /** @choice 编译：choice 指令 + 各选项指令块 */
  #emitChoice(emitter: Emitter, block: Extract<AstBlock, { kind: 'choice' }>): void {
    const { options, pos: p } = block;

    const choiceIdx = emitter.emit<DslInstr>({
      op: 'choice', options: [], afterIndex: -1, index: -1,
      file: p.file, line: p.line, col: p.col,
    });

    const compiledOptions: { label: string; when: string | null; blockStart: number; pos: SourcePos }[] = [];
    const pendingAfter = new Map<number, JumpInstr>();

    for (const opt of options) {
      compiledOptions.push({
        label: opt.label,
        when: opt.when,
        blockStart: emitter.instructions.length,
        pos: opt.pos,
      });

      for (const ins of opt.inline) {
        this.#emitInlineInstruction(emitter, ins);
      }

      // 显式跳转目标（parser 从 inline 提取）→ 生成跳转指令
      if (opt.jump) {
        if (opt.jump.kind === 'goto') {
          const j = this.#makeGoto(opt.jump.target, opt.pos);
          emitter.emit<DslInstr>(j);
          emitter.trackGoto(j);
        } else {
          emitter.emit<DslInstr>({
            op: 'jump', kind: 'jump', target: opt.jump.target, gotoIndex: null, index: -1,
            file: opt.pos.file, line: opt.pos.line, col: opt.pos.col,
          });
        }
      } else {
        // 无显式跳转 → 执行完效果后落到 choice 之后
        const j = this.#makeGoto('', opt.pos);
        pendingAfter.set(emitter.emit<DslInstr>(j), j);
      }
    }

    const choiceAfter = emitter.instructions.length;
    for (const j of pendingAfter.values()) j.gotoIndex = choiceAfter;

    const choiceInstr = emitter.instructions[choiceIdx];
    if (choiceInstr && choiceInstr.op === 'choice') {
      choiceInstr.options = compiledOptions;
      choiceInstr.afterIndex = choiceAfter;
    }
  }

  /** 内联指令（choice 选项内的 @set/@mod/@goto/@jump/其他） */
  #emitInlineInstruction(
    emitter: Emitter,
    ins: { name: string; args: string[]; modifiers: Map<string, string>; pos: SourcePos },
  ): void {
    const { name, args, modifiers, pos: p } = ins;

    if (name === 'set') {
      emitter.emit(this.#buildSetInstr({ kind: 'instr', name, args, modifiers, pos: p }));
      return;
    }
    if (name === 'mod') {
      emitter.emit(this.#buildModifyInstr({ kind: 'instr', name, args, modifiers, pos: p }));
      return;
    }
    if (name === 'goto') {
      const target = args.join(' ');
      const j = this.#makeGoto(target, p);
      emitter.emit(j);
      emitter.trackGoto(j);
      return;
    }
    if (name === 'jump') {
      const target = args.join(' ');
      emitter.emit<DslInstr>({ op: 'jump', kind: 'jump', target, gotoIndex: null, index: -1, file: p.file, line: p.line, col: p.col });
      return;
    }
    if (name === 'end') {
      emitter.emit<DslInstr>({ op: 'end', index: -1, file: p.file, line: p.line, col: p.col });
      return;
    }
    this.#warnUnknown(emitter, name, p);
    emitter.emit(this.#makeGeneric(name, args, modifiers, p));
  }

  /** 解析 @set var [=|:=|+=|-=] expr */
  #buildSetInstr(block: Extract<AstBlock, { kind: 'instr' }>): SetInstr {
    const { args, pos: p } = block;
    const ops = ['=', ':=', '+=', '-='] as const;
    if (args.length < 3) {
      throw new DslError('C004', '@set 用法：@set 变量 = 表达式', p, '形如 @set lynnTrust = 5');
    }
    const op = ops.find((o) => args[1] === o);
    if (!op) {
      throw new DslError('C004', `@set 运算符必须是 = := += -=，得到 '${args[1]}'`, p);
    }
    const varName = args[0]!;
    const expr = args.slice(2).join(' ');
    try {
      validateExpr(expr);
    } catch {
      throw new DslError('C005', `@set 表达式语法错误：'${expr}'`, p);
    }
    return { op: 'set', varName, setOp: op, expr, index: -1, file: p.file, line: p.line, col: p.col };
  }

  /** 解析 @mod var +delta */
  #buildModifyInstr(block: Extract<AstBlock, { kind: 'instr' }>): ModifyInstr {
    const { args, pos: p } = block;
    if (args.length < 2) {
      throw new DslError('C006', '@mod 用法：@mod 变量 增量', p, '形如 @mod lynnTrust +3');
    }
    const delta = Number(args[1]);
    if (!Number.isFinite(delta)) {
      throw new DslError('C006', `@mod 增量非法：'${args[1]}'`, p);
    }
    return { op: 'modify', varName: args[0]!, delta, index: -1, file: p.file, line: p.line, col: p.col };
  }

  #makeGoto(target: string, p: SourcePos): JumpInstr {
    return { op: 'jump', kind: 'goto', target, gotoIndex: null, index: -1, file: p.file, line: p.line, col: p.col };
  }

  #makeGeneric(name: string, args: string[], modifiers: Map<string, string>, p: SourcePos): GenericInstr {
    return { op: 'instr', name, args, modifiers, index: -1, file: p.file, line: p.line, col: p.col };
  }

  /** 未知指令告警（拼写错误兜底；自定义指令可通过 SceneCompiler 构造消音）。
   *  已实现指令静默；规划中但未实现的指令给 W002（提示当前无效果）；完全未知给 W001。 */
  #warnUnknown(emitter: Emitter, name: string, p: SourcePos): void {
    if (this.#known.has(name)) return;
    if (PLANNED_INSTRUCTIONS.has(name)) {
      emitter.addDiagnostic({
        code: 'W002',
        file: p.file,
        line: p.line,
        col: p.col,
        message: `指令 '@${name}' 已声明但尚未实现（当前无任何效果）`,
        hint: '该指令将在后续版本实现，请勿在剧本中依赖其行为',
      });
      return;
    }
    emitter.addDiagnostic({
      code: 'W001',
      file: p.file,
      line: p.line,
      col: p.col,
      message: `未知指令 '@${name}'`,
      hint: '检查拼写，或在 game.config.json 的 customInstructions 中声明自定义指令',
    });
  }
}

/** 便捷函数：编译单个场景源码 */
export function compileScene(
  source: string,
  file: string,
  sceneId: string,
  extraInstructions?: Iterable<string>,
): CompiledScene {
  return new SceneCompiler(extraInstructions).compile(source, file, sceneId);
}

/** 便捷函数：仅做语法/结构校验（lint 用），合法返回诊断数组，非法抛 DslError */
export function validateScene(
  source: string,
  file: string,
  sceneId: string,
  extraInstructions?: Iterable<string>,
): DslDiagnostic[] {
  return new SceneCompiler(extraInstructions).compile(source, file, sceneId).diagnostics;
}

export type { SceneAst, SourcePos };
