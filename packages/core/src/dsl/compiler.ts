import { stageCommandFromInstruction, decodeStageToken } from '../stage.js';
import { DslError, type AstBlock, type CompiledScene, type CondJumpInstr, type DslDiagnostic, type DslInstr, type GenericInstr, type JumpInstr, type ModifyInstr, type SceneAst, type SetInstr, type SwitchInstr, type TimelineInstr, type VideoInstr, type WaitInstr } from './ast.js';
import { validateExpr } from './expr-parser.js';
import { Lexer } from './lexer.js';
import { Parser } from './parser.js';
import { parseInlineText, type InlineTextContext } from '../inline-text.js';
import { rangeOfArguments, type SourcePos, type SourceRange } from './token.js';
import { parseStoryFilter } from '../story-filter.js';
import { parseRuleTransition } from '../transition.js';

/**
 * 指令白名单（lint/编译期校验用），分两档：
 *  - IMPLEMENTED：引擎已实现并被解释器/渲染层消费的指令。
 *  - PLANNED：已声明语法但尚未实现的指令，使用会产生 W002 告警（当前无效果），
 *    避免内容作者写出"静默无操作"的剧本。
 * KNOWN = IMPLEMENTED ∪ PLANNED，供外部做"是否已知指令"判断。
 */
export const IMPLEMENTED_INSTRUCTIONS: ReadonlySet<string> = new Set([
  // 演出（渲染层消费）
  'bg', 'show', 'hide', 'pose', 'layer', 'stage', 'voice', 'bgm', 'se', 'fadein', 'fadeout',
  'shake', 'flash', 'zoom', 'wipe', 'transition', 'ambience',
  'particle', 'mov', 'tint', 'filter',
  'title', 'chapter', 'tip', 'note', 'center', 'nvl',
  // 周目（解释器记录 ClearTracker + 发 clear 事件，宿主接全局通关记录）
  'clear',
  // 角色成长（解释器驱动 GrowthSystem，升级属性增量写回变量仓库，发 growth 事件）
  'exp',
  // 阻塞等待/视频（解释器挂起 awaiting-timer，宿主计时/播放结束驱动恢复）
  'wait', 'video',
  'timeline',
  // 流程控制（解释器执行）
  'switch', 'loop', 'check', 'random',
  // 道具（解释器直改 string[] 变量）
  'add_item', 'remove_item', 'has_item',
  // 状态（解释器直改 store）
  'set', 'mod', 'inc', 'dec', 'toggle', 'flag', 'unflag',
  'unlock_cg', 'unlock_music', 'unlock_text', 'unlock_profile', 'unlock_term',
  // 大系统指令（解释器转发 system 事件，由宿主消费）
  'battle', 'calendar', 'shop', 'item', 'affection', 'event',
  // 成就（解释器转发 system 事件，宿主 AchievementSystem 处理 unlock/check）
  'achievement',
  // 存档点（解释器发 autosave/savepoint 事件，由宿主写入槽位）
  'autosave', 'savepoint',
  // 流程/结构
  'goto', 'jump', 'call', 'return', 'end', 'scene', 'if', 'elif', 'else', 'endif', 'choice', 'label',
]);

/** 已声明但未实现的指令（lint 给 W002 警告，避免静默无操作） */
export const PLANNED_INSTRUCTIONS: ReadonlySet<string> = new Set([
  // 当前全部已知指令均已实现；保留空集供后续声明未实现指令用
]);

/** @wait 毫秒上限（10 分钟；超长等待几乎必为配置错误，且阻塞期间玩家体验冻结） */
const MAX_WAIT_MS = 600_000;

/** 全部已知指令（implemented + planned），供外部判断指令是否被识别 */
export const KNOWN_INSTRUCTIONS: ReadonlySet<string> = new Set([
  ...IMPLEMENTED_INSTRUCTIONS,
  ...PLANNED_INSTRUCTIONS,
]);

/** 场景源码内容哈希（FNV-1a 32 位）：存档定位以指令索引为准，剧本编辑会使旧存档
 *  的 pc 漂移；把源码哈希随存档保存，读档时比对即可发现"存档与剧本版本不一致"。 */
function hashSource(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 指令发射器：维护指令数组、标签索引、待回填跳转 */
class Emitter {
  constructor(readonly sourceLines: readonly string[]) {}
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
    const emitter = new Emitter(source.split(/\r\n|\n|\r/));
    // Specialized instructions lose their modifier maps when lowered to bytecode.
    for (const token of tokens) if (token.type === 'instruction') {
      this.#warnLoweredModifiers(emitter, token.name, token.modifiers, token);
    }

    this.#emitBlocks(emitter, ast.blocks);

    const endLine = source.split(/\r\n|\n|\r/).length;
    emitter.emit<DslInstr>({ op: 'end', index: -1, file, line: endLine, col: 1 });
    emitter.resolveGotos();

    return {
      sceneId,
      instructions: emitter.instructions,
      labels: new Map(emitter.labels),
      diagnostics: emitter.diagnostics,
      sceneHash: hashSource(source),
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
        this.#checkInlineText(emitter, block.value, block.pos, 'dialogue', block.speaker === null ? 0 : block.speaker.length + 1);
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

  /** 行内标记的位置仍指向原文件，不指向去标记后的显示文字。 */
  #checkInlineText(emitter: Emitter, text: string, pos: SourcePos, context: InlineTextContext, prefix = 0): void {
    const line = emitter.sourceLines[pos.line - 1] ?? '';
    const start = line.indexOf(text, pos.col - 1 + prefix);
    for (const issue of parseInlineText(text, context).issues) {
      const col = (start >= 0 ? start : pos.col - 1) + issue.start + 1;
      const location = { file: pos.file, line: pos.line, col, range: { start: { line: pos.line, col }, end: { line: pos.line, col: col + issue.end - issue.start } } };
      if (issue.severity === 'error') throw new DslError(issue.code, issue.message, location);
      emitter.addDiagnostic({ ...location, code: issue.code, message: issue.message });
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
    if (name === 'wait') {
      emitter.emit(this.#buildWaitInstr(args, p, block.argRanges?.[0]));
      return;
    }
    if (name === 'timeline') {
      emitter.emit(this.#buildTimelineInstr(args, modifiers, p));
      return;
    }
    if (name === 'video') {
      const src = args[0];
      if (src === undefined || src.length === 0) {
        throw new DslError('C009', '@video 缺少素材键', p, '形如 @video op_01');
      }
      emitter.emit<DslInstr>({ op: 'video', src, index: -1, file: p.file, line: p.line, col: p.col });
      return;
    }
    if (name === 'switch') {
      emitter.emit(this.#buildSwitchInstr(args, p, block.argRanges));
      return;
    }
    if (name === 'loop') {
      // @loop label = 回跳标签（循环体 = label 到 @loop 之间；内部须有挂起点或条件出口，
      // 无挂起点的死循环由解释器 MAX_SYNC_STEPS 兜底报错）
      const target = args.join(' ');
      if (target.length === 0) {
        throw new DslError('S006', '@loop 缺少跳转目标标签', p, '形如 @loop labelName');
      }
      const j = this.#makeGoto(target, p, rangeOfArguments(block.argRanges));
      emitter.emit(j);
      emitter.trackGoto(j);
      return;
    }
    if (name === 'goto') {
      const target = args.join(' ');
      if (target.length === 0) {
        throw new DslError('S006', '@goto 缺少跳转目标标签', p, '形如 @goto labelName');
      }
      const j = this.#makeGoto(target, p, rangeOfArguments(block.argRanges));
      emitter.emit(j);
      emitter.trackGoto(j);
      return;
    }
    if (name === 'jump') {
      const target = args.join(' ');
      if (target.length === 0) {
        throw new DslError('S006', '@jump 缺少跳转目标场景', p, '形如 @jump sceneId.label 或 @jump sceneId');
      }
      emitter.emit<DslInstr>({ op: 'jump', kind: 'jump', target, gotoIndex: null, index: -1, file: p.file, line: p.line, col: p.col, range: rangeOfArguments(block.argRanges) });
      return;
    }
    if (name === 'end') {
      // 用户显式 @end 与编译器自动追加的结束指令同构，解释器遇 end 即停，双 end 无害
      emitter.emit<DslInstr>({ op: 'end', index: -1, file: p.file, line: p.line, col: p.col });
      return;
    }
    if (name === 'call') {
      const target = args.join(' ');
      if (target.length === 0) {
        throw new DslError('S006', '@call 缺少调用目标场景', p, '形如 @call sceneId.label 或 @call sceneId');
      }
      emitter.emit<DslInstr>({ op: 'call', target, index: -1, file: p.file, line: p.line, col: p.col, range: rangeOfArguments(block.argRanges) });
      return;
    }
    if (name === 'return') {
      // @return 编译为 end 指令：运行时若调用栈非空则返回调用方，栈空则结束场景
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
      this.#checkInlineText(emitter, opt.label, opt.pos, 'choice');
      // W008：选项内多个 @goto/@jump 只保留第一个（审计修复：显式告警，不再静默丢弃）
      if ((opt.extraJumps ?? 0) > 0) {
        emitter.addDiagnostic({
          code: 'W008',
          file: opt.pos.file,
          line: opt.pos.line,
          col: opt.pos.col,
          message: `choice 选项 '${opt.label}' 含 ${(opt.extraJumps ?? 0) + 1} 个跳转，仅第一个生效，其余被丢弃`,
          hint: '一个选项只应有一个 @goto/@jump',
        });
      }
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
          const j = this.#makeGoto(opt.jump.target, opt.pos, opt.jump.range);
          emitter.emit<DslInstr>(j);
          emitter.trackGoto(j);
        } else {
          emitter.emit<DslInstr>({
            op: 'jump', kind: 'jump', target: opt.jump.target, gotoIndex: null, index: -1,
            file: opt.pos.file, line: opt.pos.line, col: opt.pos.col,
            range: opt.jump.range,
          });
        }
      } else {
        // 无显式跳转 → 执行完效果后落到 choice 之后
        const j = this.#makeGoto('', opt.pos);
        pendingAfter.set(emitter.emit<DslInstr>(j), j);
      }
    }

    // 全部选项都带条件：运行时可能全部被过滤 → 剧情静默跳过 choice（高风险结构，提醒作者）
    if (options.length > 0 && options.every((o) => o.when !== null)) {
      emitter.addDiagnostic({
        code: 'W005',
        file: p.file,
        line: p.line,
        col: p.col,
        ...(p.range ? { range: p.range } : {}),
        message: '@choice 全部选项均带条件（[if:expr]），运行时可能被全部过滤而静默跳过选择',
        hint: '建议至少保留一个无条件选项作为兜底',
      });
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
    ins: { name: string; args: string[]; argRanges?: SourceRange[]; modifiers: Map<string, string>; pos: SourcePos },
  ): void {
    const { name, args, modifiers, pos: p } = ins;

    if (name === 'switch' || name === 'loop' || name === 'video') {
      throw new DslError('S010', `@${name} 不支持作为 choice 行内动作`, p, '跳转到独立标签，在标签下使用该指令');
    }

    if (name === 'wait') {
      emitter.emit(this.#buildWaitInstr(args, p, ins.argRanges?.[0]));
      return;
    }
    if (name === 'timeline') {
      emitter.emit(this.#buildTimelineInstr(args, modifiers, p));
      return;
    }
    if (name === 'set') {
      emitter.emit(this.#buildSetInstr({ kind: 'instr', name, args, argRanges: ins.argRanges, modifiers, pos: p }));
      return;
    }
    if (name === 'mod') {
      emitter.emit(this.#buildModifyInstr({ kind: 'instr', name, args, argRanges: ins.argRanges, modifiers, pos: p }));
      return;
    }
    if (name === 'goto') {
      const target = args.join(' ');
      if (target.length === 0) {
        // 与顶层 @goto 一致：空目标编译期即抛错，不拖到运行期"未解析的 goto 目标"
        throw new DslError('S006', '@goto 缺少跳转目标标签', p, '形如 @goto labelName');
      }
      const j = this.#makeGoto(target, p, rangeOfArguments(ins.argRanges));
      emitter.emit(j);
      emitter.trackGoto(j);
      return;
    }
    if (name === 'jump') {
      const target = args.join(' ');
      if (target.length === 0) {
        throw new DslError('S006', '@jump 缺少跳转目标场景', p, '形如 @jump sceneId.label 或 @jump sceneId');
      }
      emitter.emit<DslInstr>({ op: 'jump', kind: 'jump', target, gotoIndex: null, index: -1, file: p.file, line: p.line, col: p.col, range: rangeOfArguments(ins.argRanges) });
      return;
    }
    if (name === 'end') {
      emitter.emit<DslInstr>({ op: 'end', index: -1, file: p.file, line: p.line, col: p.col });
      return;
    }
    if (name === 'call') {
      const target = args.join(' ');
      if (target.length === 0) {
        throw new DslError('S006', '@call 缺少调用目标场景', p, '形如 @call sceneId.label 或 @call sceneId');
      }
      emitter.emit<DslInstr>({ op: 'call', target, index: -1, file: p.file, line: p.line, col: p.col, range: rangeOfArguments(ins.argRanges) });
      return;
    }
    if (name === 'return') {
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
      throw new DslError('C004', `@set 运算符必须是 = := += -=，得到 '${args[1]}'`, { ...p, range: block.argRanges?.[1] });
    }
    const varName = args[0]!;
    const expr = args.slice(2).join(' ');
    try {
      validateExpr(expr);
    } catch {
      throw new DslError('C005', `@set 表达式语法错误：'${expr}'`, { ...p, range: rangeOfArguments(block.argRanges, 2) });
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
      throw new DslError('C006', `@mod 增量非法：'${args[1]}'`, { ...p, range: block.argRanges?.[1] });
    }
    return { op: 'modify', varName: args[0]!, delta, index: -1, file: p.file, line: p.line, col: p.col };
  }

  /** 解析 @wait ms：正整数毫秒，上限 10 分钟（防病态配置长时间冻结剧情推进） */
  #buildWaitInstr(args: string[], p: SourcePos, argumentRange?: SourceRange): WaitInstr {
    const raw = args[0];
    const ms = raw === undefined ? NaN : Number(raw);
    if (!Number.isInteger(ms) || ms <= 0 || ms > MAX_WAIT_MS) {
      throw new DslError(
        'C007',
        `@wait 用法：@wait <毫秒>（正整数，1..${MAX_WAIT_MS}），得到 '${raw ?? ''}'`,
        argumentRange ? { ...p, range: argumentRange } : p,
        '形如 @wait 800',
      );
    }
    return { op: 'wait', ms, index: -1, file: p.file, line: p.line, col: p.col };
  }

  /** 解析 @timeline id [@ blocking]；时间轴本体由宿主项目目录提供。 */
  #buildTimelineInstr(args: string[], modifiers: Map<string, string>, p: SourcePos): TimelineInstr {
    const id = args[0];
    if (id === undefined || id.length === 0 || args.length > 1) {
      throw new DslError('C010', '@timeline 用法：@timeline <id> [@ blocking]', p, '形如 @timeline intro_arrival @ blocking');
    }
    const blockingValue = modifiers.get('blocking');
    const blocking = modifiers.has('blocking') && (blockingValue === '' || blockingValue === 'true' || blockingValue === '1');
    if (modifiers.has('blocking') && !blocking) {
      throw new DslError('C010', `@timeline blocking 修饰符值非法：'${blockingValue}'`, p, '形如 @timeline intro_arrival @ blocking');
    }
    return { op: 'timeline', id, blocking, index: -1, file: p.file, line: p.line, col: p.col };
  }

  /** 解析 @switch varName v1:label1 v2:label2 ...（值与标签均不可为空） */
  #buildSwitchInstr(args: string[], p: SourcePos, argRanges?: SourceRange[]): SwitchInstr {
    if (args.length < 2) {
      throw new DslError('C008', '@switch 用法：@switch 变量名 值1:标签1 值2:标签2 ...', p, '形如 @switch chapter 1:c1 2:c2');
    }
    const varName = args[0]!;
    const cases: SwitchInstr['cases'] = [];
    for (let i = 1; i < args.length; i++) {
      const raw = args[i]!;
      const argumentRange = argRanges?.[i];
      const ci = raw.indexOf(':');
      if (ci <= 0 || ci === raw.length - 1) {
        throw new DslError('C008', `@switch 条目 '${raw}' 格式非法（应为 值:标签）`, { ...p, range: argumentRange });
      }
      cases.push({ value: raw.slice(0, ci), label: raw.slice(ci + 1), ...(argumentRange ? { range: {
        start: { line: argumentRange.start.line, col: argumentRange.start.col + ci + 1 }, end: argumentRange.end,
      } } : {}) });
    }
    return { op: 'switch', varName, cases, index: -1, file: p.file, line: p.line, col: p.col };
  }

  #makeGoto(target: string, p: SourcePos, range?: SourceRange): JumpInstr {
    return { op: 'jump', kind: 'goto', target, gotoIndex: null, index: -1, file: p.file, line: p.line, col: p.col, ...(range ? { range } : {}) };
  }

  #makeGeneric(name: string, args: string[], modifiers: Map<string, string>, p: SourcePos): GenericInstr {
    if (name === 'check') {
      const expr = args.join(' ');
      try { validateExpr(expr); }
      catch { throw new DslError('C005', `@check 条件表达式语法错误：'${expr}'`, p, '形如 @check trust >= 0'); }
    }
    if (name === 'transition' && decodeStageToken(args[0] ?? '') === 'rule') {
      try { parseRuleTransition(new Map([...modifiers].map(([key, value]) => [key, decodeStageToken(value)]))); }
      catch (error) { throw new DslError('TRANSITION_INVALID', error instanceof Error ? error.message : String(error), p); }
    }
    if (name === 'filter') {
      try { parseStoryFilter(args.map(decodeStageToken)); }
      catch (error) { throw new DslError('FILTER_INVALID', error instanceof Error ? error.message : String(error), p); }
    }
    if (['pose', 'layer', 'stage'].includes(name)) {
      try { stageCommandFromInstruction(name, args.map(decodeStageToken), new Map([...modifiers].map(([key, value]) => [key, decodeStageToken(value)]))); }
      catch (error) { throw new DslError('STAGE_INVALID', error instanceof Error ? error.message : String(error), p); }
    }
    return { op: 'instr', name, args, modifiers, index: -1, file: p.file, line: p.line, col: p.col };
  }

  #warnLoweredModifiers(emitter: Emitter, name: string, modifiers: Map<string, string>, p: SourcePos): void {
    if (!['set', 'mod', 'wait', 'timeline', 'video', 'switch', 'loop', 'goto', 'jump', 'call', 'return', 'end', 'if', 'elif', 'else', 'endif', 'choice'].includes(name)) return;
    for (const key of modifiers.keys()) {
      if (name === 'timeline' && key === 'blocking') continue;
      emitter.addDiagnostic({ code: 'W003', file: p.file, line: p.line, col: p.col,
        ...(p.range ? { range: p.range } : {}),
        message: `指令 '@${name}' 的修饰符 '@${key}' 未被引擎消费`, hint: '移除没有效果的修饰符，按该指令支持的参数写法填写。' });
    }
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
        ...(p.range ? { range: p.range } : {}),
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
      ...(p.range ? { range: p.range } : {}),
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
