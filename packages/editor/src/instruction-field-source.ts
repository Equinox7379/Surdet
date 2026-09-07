import { splitInstr } from './model.js';

interface SourceRange { start: number; end: number }

/**
 * Source ranges for one mounted instruction form, not another script model.
 * Token boundaries come from the shared Authoring parser. While a field is
 * being typed, its range is transformed by each accepted edit, so an unfinished
 * quote cannot absorb a neighbouring field or a modifier on the next keystroke.
 * Any out-of-band raw edit must create a new binding rather than reuse ranges.
 */
export class InstructionFieldSource {
  private expectedRaw: string;
  private ranges: Array<SourceRange | null>;
  private bodyEnd: number;

  constructor(raw: string, fieldCount: number, private readonly restFrom?: number) {
    if (!Number.isInteger(fieldCount) || fieldCount < 1
      || (restFrom !== undefined && restFrom !== fieldCount - 1)) {
      throw new Error('无效的指令字段布局');
    }
    const { name, args } = splitInstr(raw);
    const leading = raw.length - raw.trimStart().length;
    if (raw[leading] !== '@' || name.length === 0) throw new Error('当前行不是可编辑指令');
    let cursor = leading + name.length + 1;
    const tokens = args.map((token): SourceRange => {
      const start = raw.indexOf(token, cursor);
      if (start < cursor) throw new Error('无法定位共享解析器返回的指令参数');
      cursor = start + token.length;
      return { start, end: cursor };
    });
    this.expectedRaw = raw;
    this.bodyEnd = cursor;
    this.ranges = Array.from({ length: fieldCount }, (_, index) => {
      const token = tokens[index];
      return token === undefined ? null : {
        start: token.start,
        end: index === restFrom ? cursor : token.end,
      };
    });
  }

  value(raw: string, index: number): string {
    this.assertCurrent(raw, index);
    const range = this.ranges[index];
    return range ? raw.slice(range.start, range.end) : '';
  }

  /**
   * Replace only the edited source slice. Do not decode/re-quote expressions or
   * rebuild other arguments. Empty positional fields use the explicit empty
   * token ""; missing earlier positions get the same token rather than shifting
   * an existing argument into another position. The shared validator still owns
   * whether the resulting (possibly unfinished) instruction is valid.
   */
  replace(raw: string, index: number, value: string): string {
    this.assertCurrent(raw, index);
    if (/[\r\n]/.test(value)) throw new Error('指令字段只能编辑一行，请在原始行中检查输入');
    if (value === this.value(raw, index)) return raw;
    const replacement = value.trim().length === 0 && index !== this.restFrom ? '""' : value;
    const range = this.ranges[index];
    if (range === null) {
      // Append missing positions before the untouched whitespace/modifier tail.
      let next = raw;
      for (let field = 0; field <= index; field++) {
        if (this.ranges[field] !== null) continue;
        const content = field === index ? replacement : '""';
        const start = this.bodyEnd + 1;
        const suffix = next.slice(this.bodyEnd);
        const separator = suffix.startsWith('@') ? ' ' : '';
        next = `${next.slice(0, this.bodyEnd)} ${content}${separator}${suffix}`;
        this.ranges[field] = { start, end: start + content.length };
        this.bodyEnd = start + content.length;
      }
      this.expectedRaw = next;
      return next;
    }
    if (range === undefined) throw new Error('指令字段不存在');
    const next = raw.slice(0, range.start) + replacement + raw.slice(range.end);
    const delta = replacement.length - (range.end - range.start);
    this.ranges = this.ranges.map((other, otherIndex) => {
      if (otherIndex === index) return { start: range.start, end: range.start + replacement.length };
      if (other === null || other.start < range.end) return other;
      return { start: other.start + delta, end: other.end + delta };
    });
    this.bodyEnd += delta;
    this.expectedRaw = next;
    return next;
  }

  private assertCurrent(raw: string, index: number): void {
    if (raw !== this.expectedRaw) throw new Error('指令原文已变化，请重新打开当前场景后再编辑');
    if (!Number.isInteger(index) || index < 0 || index >= this.ranges.length) {
      throw new Error('指令字段不存在');
    }
  }
}
