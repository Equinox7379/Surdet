import {
  DslError,
  pos,
  type AstBlock,
  type AstChoiceOption,
  type AstIfBranch,
  type AstIfBlock,
  type SceneAst,
} from './ast.js';
import { parseInlineInstructions } from './lexer.js';
import { validateExpr } from './expr-parser.js';
import { SourceError, rangeOfArguments, type SourcePos, type InstructionToken, type TextToken, type Token } from './token.js';

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

/** @if 嵌套深度上限，防止病态输入触发 JS 栈溢出（RangeError）而非可定位的 DslError */
const MAX_IF_NESTING = 200;
/** 单个 @if 的分支上限；legacy else 投影会为每个分支建立一层旧 AST。 */
const MAX_IF_BRANCHES = MAX_IF_NESTING;

/**
 * 语法分析器：Token 流 → SceneAst（嵌套块）。
 * 结构校验：@if/@elif/@else/@endif 配对；@choice 必须有缩进选项行。
 */
export class Parser {
  /** @if 嵌套深度（超限抛 S008 而非 RangeError） */
  #ifDepth = 0;

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
      out.push({ kind: 'instr', name, args: tok.args, argRanges: tok.argRanges, modifiers: tok.modifiers, pos: tok });
    }
    return out;
  }

  /**
   * 解析 if 链：@if expr ... (@elif expr ...)* (@else ...)? @endif。
   *
   * branches 保留源码中的每个分支与真实边界；then/else 继续提供旧的
   * 递归形状，compiler 和已有调用方无需改变控制流语义。
   */
  #parseIfChain(cursor: TokenCursor): AstIfBlock {
    this.#ifDepth++;
    try {
      const first = cursor.next() as InstructionToken; // @if
      if (this.#ifDepth > MAX_IF_NESTING) {
        throw new DslError('S008', `@if 嵌套过深（超过 ${MAX_IF_NESTING} 层），请拆分场景或改用跳转`, first);
      }

      const branches: AstIfBranch[] = [];
      let head = first;
      let kind: 'if' | 'elif' = 'if';
      let expr = this.#validateConditionExpression(head);
      let blocks = this.#parseIfBranchBlocks(cursor, ['else', 'elif', 'endif'], 0, head);

      for (;;) {
        const stopTok = cursor.peek();
        if (stopTok.type !== 'instruction'
          || (stopTok.name !== 'else' && stopTok.name !== 'elif' && stopTok.name !== 'endif')) {
          if (cursor.eof) {
            throw new DslError('S003', `@${head.name} 缺少 @endif`, head, 'if 块未闭合');
          }
          throw new DslError('S003', `@${head.name} 后面缺少 @else/@elif/@endif`, head);
        }

        branches.push(this.#makeIfBranch(kind, expr, blocks, head, stopTok));
        if (branches.length > MAX_IF_BRANCHES) {
          throw new DslError(
            'S008',
            `@if 分支过多（超过 ${MAX_IF_BRANCHES} 个），请拆分条件结构或改用跳转`,
            branches.at(-1)!.span.start,
          );
        }

        if (stopTok.name === 'endif') {
          cursor.next();
          return {
            kind: 'if',
            expr: this.#validateConditionExpression(first),
            then: branches[0]?.blocks ?? [],
            else: this.#legacyElse(branches.slice(1)),
            branches,
            pos: first,
            span: { start: first, end: stopTok },
          };
        }

        cursor.next();
        if (stopTok.name === 'else') {
          if (branches.length >= MAX_IF_BRANCHES) {
            throw new DslError(
              'S008',
              `@if 分支过多（超过 ${MAX_IF_BRANCHES} 个），请拆分条件结构或改用跳转`,
              stopTok,
            );
          }
          const elseBlocks = this.#parseIfBranchBlocks(cursor, ['endif'], branches.length, stopTok);
          const endif = cursor.peek();
          if (endif.type !== 'instruction' || endif.name !== 'endif') {
            this.#expectEndif(cursor, first);
          }
          branches.push(this.#makeIfBranch('else', null, elseBlocks, stopTok, endif));
          cursor.next(); // @endif
          return {
            kind: 'if',
            expr: this.#validateConditionExpression(first),
            then: branches[0]?.blocks ?? [],
            else: this.#legacyElse(branches.slice(1)),
            branches,
            pos: first,
            span: { start: first, end: endif },
          };
        }

        // @elif becomes the next explicit branch. Its body is parsed with the
        // same stop set, so nested if blocks remain owned by this branch.
        head = stopTok;
        if (branches.length >= MAX_IF_BRANCHES) {
          throw new DslError(
            'S008',
            `@if 分支过多（超过 ${MAX_IF_BRANCHES} 个），请拆分条件结构或改用跳转`,
            head,
          );
        }
        kind = 'elif';
        expr = this.#validateConditionExpression(head);
        blocks = this.#parseIfBranchBlocks(cursor, ['else', 'elif', 'endif'], branches.length, head);
      }
    } finally {
      this.#ifDepth--;
    }
  }

  #validateConditionExpression(head: InstructionToken): string {
    const expr = head.args.join(' ');
    if (expr.length === 0) {
      throw new DslError('S001', `@${head.name} 缺少条件表达式`, head);
    }
    try {
      validateExpr(expr);
    } catch {
      throw new DslError('S002', `@${head.name} 条件表达式语法错误：'${expr}'`, { ...head, range: rangeOfArguments(head.argRanges) });
    }
    return expr;
  }

  /**
   * 解析当前分支正文，并把同一条件链中此前的 @elif 数计入组合深度。
   * 旧 parser 把每个 @elif 递归为一层 if；这里保留同一深度边界，避免
   * 明确 branches 后让“长 elif 链 + 嵌套 if”绕过 S008，直到 compiler 栈溢出。
   */
  #parseIfBranchBlocks(
    cursor: TokenCursor,
    stops: readonly string[],
    branchIndex: number,
    head: InstructionToken,
  ): AstBlock[] {
    const chainDepth = this.#ifDepth;
    const combinedDepth = chainDepth + branchIndex;
    if (combinedDepth > MAX_IF_NESTING) {
      throw new DslError(
        'S008',
        `@if/@elif 组合嵌套过深（超过 ${MAX_IF_NESTING} 层），请拆分条件结构或改用跳转`,
        head,
      );
    }
    this.#ifDepth = combinedDepth;
    try {
      return this.#parseBlockList(cursor, stops);
    } finally {
      this.#ifDepth = chainDepth;
    }
  }

  #makeIfBranch(
    kind: 'if' | 'elif' | 'else',
    expr: string | null,
    blocks: AstBlock[],
    head: InstructionToken,
    boundary: Token,
  ): AstIfBranch {
    const bodyStart = { file: head.file, line: head.line + 1, col: 1 };
    return {
      kind,
      expr,
      blocks,
      span: { start: head, end: boundary },
      bodySpan: { start: bodyStart, end: boundary },
    };
  }

  /** 将显式分支投影回旧 compiler 使用的递归 else 结构。 */
  #legacyElse(branches: readonly AstIfBranch[]): AstBlock[] {
    const branch = branches[0];
    if (branch === undefined) return [];
    if (branch.kind === 'else') return branch.blocks;
    const nested: AstIfBlock = {
      kind: 'if',
      expr: branch.expr!,
      then: branch.blocks,
      else: this.#legacyElse(branches.slice(1)),
      branches: [...branches],
      pos: branch.span.start,
      span: { start: branch.span.start, end: branches.at(-1)!.span.end },
    };
    return [nested];
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
      let tok = cursor.peek();
      // Comments are transparent to the DSL parser, including between choice
      // options. Consuming them here keeps the whole option run in one AST
      // block; the authoring document retains the comment rows separately.
      while (tok.type === 'comment') {
        cursor.next();
        tok = cursor.peek();
      }
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
    return { kind: 'choice', options, pos: choiceTok, span: { start: choiceTok, end: cursor.peek() } };
  }

  #parseChoiceOption(textTok: TextToken): AstChoiceOption {
    const raw = textTok.raw.trimStart();
    const arrow = findChoiceArrow(raw, textTok);
    const arrowIdx = arrow?.index ?? -1;
    const arrowEnd = arrow?.end ?? -1;
    const labelPart = arrowIdx >= 0 ? raw.slice(0, arrowIdx) : raw;
    const inlinePart = arrowEnd >= 0 ? raw.slice(arrowEnd).trim() : '';
    const pos0 = pos(textTok.file, textTok.line, textTok.col);

    let when: string | null = null;
    let labelText = labelPart.trim();
    const whenMatch = findChoiceCondition(labelText, textTok);
    if (whenMatch) {
      when = whenMatch.value.trim();
      if (when.length === 0) {
        throw new DslError('S005', '选项条件为空（[if:expr]）', textTok);
      }
      try {
        validateExpr(when);
      } catch {
        const start = textTok.col + whenMatch.index + 4 + whenMatch.value.length - whenMatch.value.trimStart().length;
        throw new DslError('S002', `选项条件表达式语法错误：'${when}'`, { ...textTok,
          range: { start: { line: textTok.line, col: start }, end: { line: textTok.line, col: start + when.length } } });
      }
      labelText = labelText.slice(0, whenMatch.index).trim();
    }

    if (labelText.length === 0) {
      throw new DslError('S005', '选项文本为空', textTok);
    }

    if (arrowIdx >= 0 && (inlinePart.length === 0 || !inlinePart.startsWith('@'))) {
      throw new DslError(
        'S009',
        'choice 行内动作必须以 @ 开头',
        textTok,
        '箭头后应写成 -> @goto target 或其他以 @ 开头的行内动作',
      );
    }

    const inlineTokens = inlinePart.length > 0
      ? parseInlineInstructions(inlinePart, textTok.file, textTok.line,
        textTok.col + arrowEnd + raw.slice(arrowEnd).length - raw.slice(arrowEnd).trimStart().length)
      : [];

    const inline = inlineTokens.map((t) => ({
      name: t.name,
      args: t.args,
      argRanges: t.argRanges,
      modifiers: t.modifiers,
      // Keep the option-row anchor; the exact inline excerpt is separate.
      pos: { ...pos(t.file, t.line, textTok.col), range: t.range },
    }));

    // 提取跳转目标（goto/jump），从 inline 移除（编译器转为 JumpInstr）
    // 块指令（if/choice 等）不允许内联
    const BLOCK_INLINE = new Set(['if', 'elif', 'else', 'endif', 'choice']);
    let jump: AstChoiceOption['jump'] = null;
    let extraJumps = 0; // 选项内第二个及以后的 @goto/@jump 会被丢弃 → 编译器报 W008（审计修复：不再静默）
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
          jump = { kind: ins.name, target, range: rangeOfArguments(ins.argRanges) };
        } else {
          extraJumps += 1;
        }
        continue;
      }
      if (jump !== null) {
        throw new DslError('S010', `choice 跳转后不能再写 @${ins.name}`, ins.pos,
          '把需要执行的动作放在 @goto/@jump 之前，或移到目标标签下；引擎不会重排动作。');
      }
      rest.push(ins);
    }

    return {
      label: labelText,
      when,
      inline: rest,
      jump,
      extraJumps,
      pos: pos0,
      span: {
        start: pos0,
        // col is already offset by the line indent; raw.length includes that
        // indent, so the end column is the physical line length plus one.
        end: pos(textTok.file, textTok.line, textTok.raw.length + 1),
      },
    };
  }

}

/** 成对文案引号保护箭头和条件样式文字；未闭合引号仍按原有正文规则处理。 */
function choiceQuoteEnd(raw: string, start: number, limit: number): number {
  const char = raw[start];
  const closing = char === '“' ? '”' : char === '‘' ? '’' : char;
  if (!['"', "'", '“', '‘'].includes(char ?? '') || (char === "'" && /[a-z0-9]/i.test(raw[start - 1] ?? ''))) return start;
  for (let end = start + 1; end < limit; end++) {
    if (raw[end] === '\\') { end++; continue; }
    if (raw[end] === closing) return end;
  }
  return start;
}

function findChoiceCondition(label: string, source: SourcePos): { index: number; value: string } | null {
  // A prose quote cannot borrow a closing quote from the trailing expression.
  const conditionStart = [...label.matchAll(/\[if:/g)].find(match => choiceConditionEnd(label, match.index) === label.length - 1)?.index ?? label.length;
  for (let i = 0; i < label.length; i++) {
    const quotedEnd = choiceQuoteEnd(label, i, conditionStart);
    if (quotedEnd !== i) { i = quotedEnd; continue; }
    if (!label.startsWith('[if:', i)) continue;
    const end = choiceConditionEnd(label, i);
    if (end === -1) throw new DslError('S005', '选项条件缺少结束方括号 ]', source);
    if (label.slice(end + 1).trim() !== '') throw new DslError('S005', '选项条件必须放在文案末尾、动作箭头之前', source);
    return { index: i, value: label.slice(i + 4, end) };
  }
  return null;
}

function choiceConditionEnd(label: string, start: number): number {
  let quote: string | null = null;
  for (let end = start + 4; end < label.length; end++) {
    const char = label[end];
    if (quote) {
      if (char === '\\') end++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ']') return end;
  }
  return -1;
}

/** Locate the exact choice action boundary for parser and source-preserving authoring. */
export function findChoiceArrow(raw: string, source: SourcePos = pos('<choice>', 1, 1)): { index: number; end: number } | null {
  const hasActions = (end: number): boolean => {
    const actions = raw.slice(end).trim();
    if (!actions.startsWith('@')) return false;
    try { return parseInlineInstructions(actions, source.file, source.line, source.col + end).length > 0; }
    catch (error) { if (!(error instanceof SourceError)) throw error; return false; }
  };
  // Complete prose quotes keep precedence. Only infer an unmatched prose quote
  // when the ordinary boundary cannot produce a lexically complete action list.
  const ordinary = scanChoiceArrow(raw, raw.length);
  if (ordinary !== null && hasActions(ordinary.end)) return ordinary;
  let found: { index: number; end: number } | null = null;
  for (const match of raw.matchAll(/\s->(?=\s|$)/g)) {
    const index = match.index;
    const end = index + 3 + (index + 3 < raw.length ? 1 : 0);
    if (!hasActions(end)) continue;
    // Pair prose quotes only inside this possible label, not with quotes in
    // its condition or action arguments. Conditions keep their own grammar.
    const label = raw.slice(0, index);
    const condition = /\[if:(.+?)\]\s*$/.exec(label);
    if (scanChoiceArrow(raw, condition?.index ?? index)?.index !== index) continue;
    if (found !== null) {
      throw new DslError('S009', 'choice 文案与行内动作边界有歧义',
        pos(source.file, source.line, source.col + index + 1), '请闭合文案引号，或用中文引号明确文案范围。');
    }
    found = { index, end };
  }
  // Preserve no-action prose and the existing diagnostics for malformed actions.
  const result = found ?? ordinary;
  if (result === null) {
    const malformed = scanChoiceArrow(raw, raw.length, false);
    if (malformed && raw.slice(malformed.end).trimStart().startsWith('@')) {
      throw new DslError('S009', 'choice 动作箭头 -> 两侧必须留空白', source, '形如：选项文字 [if:条件] -> @goto target');
    }
  }
  return result;
}

function scanChoiceArrow(raw: string, labelEnd: number, requireSpaces = true): { index: number; end: number } | null {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let inCondition = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    if (inCondition) {
      if (quote !== null) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          quote = null;
        }
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ']') {
        inCondition = false;
      }
      continue;
    }
    if (raw.startsWith('[if:', i)) {
      inCondition = true;
      continue;
    }
    // Labels are prose: paired quotes protect literal arrows, while English
    // apostrophes and an unmatched quote remain ordinary label characters.
    const quotedEnd = choiceQuoteEnd(raw, i, labelEnd);
    if (quotedEnd !== i) { i = quotedEnd; continue; }
    if (char !== '-' || raw[i + 1] !== '>') continue;
    const before = i > 0 ? raw[i - 1]! : '';
    const after = raw[i + 2] ?? '';
    if (requireSpaces && (!/\s/.test(before) || (after !== '' && !/\s/.test(after)))) continue;
    return { index: i - (/\s/.test(before) ? 1 : 0), end: i + 2 + (/\s/.test(after) ? 1 : 0) };
  }
  return null;
}
