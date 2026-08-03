import { DslError, pos, type AstBlock, type AstChoiceOption, type SceneAst } from './ast.js';
import { parseInlineInstructions } from './lexer.js';
import { validateExpr } from './expr-parser.js';
import type { InstructionToken, TextToken, Token } from './token.js';

/** token 游标 */
class TokenCursor {
  #tokens: Token[];
  #i = 0;

  constructor(tokens: Token[]) {
    this.#tokens = tokens;
  }

  get eof(): boolean {
    return this.#tokens[this.#i]?.type === 'eof';
  }

  peek(): Token {
    return this.#tokens[this.#i]!;
  }

  next(): Token {
    const t = this.#tokens[this.#i]!;
    if (t.type !== 'eof') this.#i++;
    return t;
  }
}

/**
 * 语法分析器：Token 流 → SceneAst（嵌套块）。
 * 结构校验：@if/@elif/@else/@endif 配对；@choice 必须有缩进选项行。
 */
export class Parser {
  parse(tokens: Token[], sceneId: string): SceneAst {
    const cursor = new TokenCursor(tokens);
    const blocks = this.#parseBlockList(cursor, []);
    return { sceneId, blocks };
  }

  /** 解析块序列，遇到 stops 中的指令名则停止（不消费），交给上层处理 */
  #parseBlockList(cursor: TokenCursor, stops: readonly string[]): AstBlock[] {
    const out: AstBlock[] = [];
    for (;;) {
      if (cursor.eof) break;
      const tok = cursor.peek();

      if (tok.type === 'comment') {
        cursor.next();
        continue;
      }

      if (tok.type === 'label') {
        cursor.next();
        out.push({ kind: 'label', name: tok.name, pos: tok });
        continue;
      }

      if (tok.type === 'text') {
        cursor.next();
        out.push({ kind: 'text', speaker: tok.speaker, value: tok.value, pos: tok });
        continue;
      }

      if (tok.type === 'eof') break;

      // instruction
      const name = tok.name;
      if (stops.includes(name)) break;

      if (name === 'if') {
        out.push(this.#parseIfChain(cursor));
        continue;
      }
      if (name === 'elif') {
        throw new DslError('S003', '@elif 不在 @if 块内', tok, '缺少对应的 @if');
      }
      if (name === 'choice') {
        out.push(this.#parseChoice(cursor));
        continue;
      }
      if (name === 'else' || name === 'endif') {
        throw new DslError(
          'S003',
          `@${name} 不在 @if 块内`,
          tok,
          '缺少对应的 @if',
        );
      }

      cursor.next();
      out.push({ kind: 'instr', name, args: tok.args, modifiers: tok.modifiers, pos: tok });
    }
    return out;
  }

  /**
   * 解析 if 链：@if expr ... (@elif expr ...)* (@else ...)? @endif
   * elif 分支递归复用本方法（nested 为 else 中的嵌套 if）。
   */
  #parseIfChain(cursor: TokenCursor): AstBlock {
    const head = cursor.next() as InstructionToken; // @if 或 @elif
    const expr = head.args.join(' ');
    if (expr.length === 0) {
      throw new DslError('S001', `@${head.name} 缺少条件表达式`, head);
    }
    try {
      validateExpr(expr);
    } catch {
      throw new DslError('S002', `@${head.name} 条件表达式语法错误：'${expr}'`, head);
    }

    const then = this.#parseBlockList(cursor, ['else', 'elif', 'endif']);
    const stopTok = cursor.peek();

    if (stopTok.type === 'instruction' && stopTok.name === 'else') {
      cursor.next();
      const elseBlocks = this.#parseBlockList(cursor, ['endif']);
      this.#expectEndif(cursor, head);
      return { kind: 'if', expr, then, else: elseBlocks, pos: head };
    }

    if (stopTok.type === 'instruction' && stopTok.name === 'elif') {
      const nested = this.#parseIfChain(cursor);
      return { kind: 'if', expr, then, else: [nested], pos: head };
    }

    if (stopTok.type === 'instruction' && stopTok.name === 'endif') {
      cursor.next();
      return { kind: 'if', expr, then, else: [], pos: head };
    }

    if (cursor.eof) {
      throw new DslError('S003', `@${head.name} 缺少 @endif`, head, 'if 块未闭合');
    }
    throw new DslError('S003', `@${head.name} 后面缺少 @else/@elif/@endif`, head);
  }

  #expectEndif(cursor: TokenCursor, ifTok: Token): void {
    const tok = cursor.peek();
    if (tok.type === 'instruction' && tok.name === 'endif') {
      cursor.next();
      return;
    }
    if (cursor.eof) {
      throw new DslError('S003', '@if 缺少 @endif', ifTok, 'if 块未闭合');
    }
    throw new DslError('S003', '@else 后缺少 @endif', tok);
  }

  /** 解析 @choice 及其缩进选项行 */
  #parseChoice(cursor: TokenCursor): AstBlock {
    const choiceTok = cursor.next();
    const options: AstChoiceOption[] = [];

    for (;;) {
      const tok = cursor.peek();
      if (tok.type !== 'text') break;
      if (!/^\s/.test(tok.raw)) break;
      cursor.next();
      options.push(this.#parseChoiceOption(tok));
    }

    if (options.length === 0) {
      throw new DslError(
        'S004',
        '@choice 缺少选项',
        choiceTok,
        '选项行必须以空格/Tab 缩进，形如：选项文本 [if:expr] -> @goto label',
      );
    }
    return { kind: 'choice', options, pos: choiceTok };
  }

  #parseChoiceOption(textTok: TextToken): AstChoiceOption {
    const raw = textTok.raw.trimStart();
    const arrowIdx = raw.indexOf(' -> ');
    const labelPart = arrowIdx >= 0 ? raw.slice(0, arrowIdx) : raw;
    const inlinePart = arrowIdx >= 0 ? raw.slice(arrowIdx + 4).trim() : '';
    const pos0 = pos(textTok.file, textTok.line, textTok.col);

    let when: string | null = null;
    let labelText = labelPart.trim();
    const whenMatch = /\[if:(.+?)\]\s*$/.exec(labelText);
    if (whenMatch) {
      when = whenMatch[1]!.trim();
      if (when.length === 0) {
        throw new DslError('S005', '选项条件为空（[if:expr]）', textTok);
      }
      try {
        validateExpr(when);
      } catch {
        throw new DslError('S002', `选项条件表达式语法错误：'${when}'`, textTok);
      }
      labelText = labelText.slice(0, whenMatch.index).trim();
    }

    if (labelText.length === 0) {
      throw new DslError('S005', '选项文本为空', textTok);
    }

    const inlineTokens = inlinePart.length > 0
      ? parseInlineInstructions(inlinePart, textTok.file, textTok.line, textTok.col)
      : [];

    const inline = inlineTokens.map((t) => ({
      name: t.name,
      args: t.args,
      modifiers: t.modifiers,
      pos: pos(t.file, t.line, t.col),
    }));

    // 提取跳转目标（goto/jump），从 inline 移除（编译器转为 JumpInstr）
    // 块指令（if/choice 等）不允许内联
    const BLOCK_INLINE = new Set(['if', 'elif', 'else', 'endif', 'choice']);
    let jump: { kind: 'goto' | 'jump'; target: string } | null = null;
    const rest: typeof inline = [];
    for (const ins of inline) {
      if (BLOCK_INLINE.has(ins.name)) {
        throw new DslError(
          'S007',
          `choice 选项内不允许 @${ins.name}（块指令不能内联）`,
          ins.pos,
          '如需条件分支请用 [if:expr] 或把逻辑移到独立场景',
        );
      }
      if (ins.name === 'goto' || ins.name === 'jump') {
        if (jump === null) {
          const target = ins.args.join(' ');
          if (target.length === 0) {
            throw new DslError('S006', `@${ins.name} 缺少跳转目标`, ins.pos);
          }
          jump = { kind: ins.name, target };
        }
        continue;
      }
      rest.push(ins);
    }

    return { label: labelText, when, inline: rest, jump, pos: pos0 };
  }
}
