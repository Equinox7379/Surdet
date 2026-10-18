import { describe, expect, it } from 'vitest';
import { compileScene } from '../src/dsl/compiler.js';
import { parseInlineText, inlinePlainText } from '../src/inline-text.js';
import { Interpreter, type CoreEventMap } from '../src/runtime/interpreter.js';
import { EventBus } from '../src/runtime/event-bus.js';
import { SceneRegistry } from '../src/runtime/scene-registry.js';
import { VariableStore } from '../src/state/variable-store.js';
import { textTranslationIssue } from '../src/project-texts.js';
import { validateSceneVariables, type LintIssue } from '../src/scene-lint.js';
import { computeProjectStats } from '../src/project-stats.js';
import { auditTerminology } from '../src/terminology-audit.js';

describe('公开编译、运行和校验消费行内合同', () => {
  it('keeps colon narration and literal backslashes through interpolation and save replay', () => {
    const store = new VariableStore([{ name: 'time', type: 'string', initial: '23:15' }]);
    const registry = new SceneRegistry(), bus = new EventBus<CoreEventMap>(), interpreter = new Interpreter(store, bus, registry);
    registry.register(compileScene('记录\\：{time}，原文\\\\:路径\n下一句', 'paper.gal', 'paper'));
    const events: CoreEventMap['text'][] = [];
    bus.on('text', event => events.push(event));
    interpreter.start('paper');
    expect(events[0]!.speaker).toBeNull();
    expect(inlinePlainText(events[0]!.value)).toBe('记录：23:15，原文\\:路径');
    const saved = interpreter.saveSnapshot()!;
    interpreter.advance();
    interpreter.loadSnapshot(saved);
    expect(events[2]).toMatchObject({ speaker: null, value: events[0]!.value, wasRead: true });
  });
  it('编译定位到标记本身，含说话人与前导空格', () => {
    try { compileScene('  凛：  你好<size=3>世界</size>', 'intro.gal', 'intro'); throw new Error('must reject'); }
    catch (error) { expect(error).toMatchObject({ code: 'M004', pos: { file: 'intro.gal', line: 1, col: 9, range: { start: { line: 1, col: 9 }, end: { line: 1, col: 17 } } } }); }
    expect(compileScene('<b>啊：这是旁白</b>', 'intro.gal', 'intro').instructions[0]).toMatchObject({ op: 'text', speaker: null });
    expect(() => compileScene('@choice\n  等<w> -> @goto end\n@label end', 'i.gal', 'intro')).toThrow(/不支持停顿/);
  });
  it('运行时说话人原样，正文/选项变量不会注入标记，存读档仍从句首重放', () => {
    const store = new VariableStore([{ name: 'name', type: 'string', initial: '<b>凛</b>' }]);
    const registry = new SceneRegistry(), bus = new EventBus<CoreEventMap>(), interpreter = new Interpreter(store, bus, registry);
    registry.register(compileScene('{name}：<color=accent>你好{name}</color><w>再见\n@choice\n  <b>{name}</b> -> @goto end\n@label end\n结束', 'intro.gal', 'intro'));
    const events: CoreEventMap['text'][] = [], choices: CoreEventMap['choice'][] = [];
    bus.on('text', event => events.push(event)); bus.on('choice', event => choices.push(event));
    interpreter.start('intro');
    expect(events[0]!.speaker).toBe('<b>凛</b>');
    expect(inlinePlainText(events[0]!.value)).toBe('你好<b>凛</b>再见');
    expect(parseInlineText(events[0]!.value).controls).toHaveLength(1);
    const saved = interpreter.saveSnapshot()!; interpreter.advance();
    expect(inlinePlainText(choices[0]!.options[0]!.label, 'choice')).toBe('<b>凛</b>');
    interpreter.loadSnapshot(saved); expect(events[1]!.value).toBe(events[0]!.value);
  });
  it('译稿按实际字段校验，书名号无需特殊处理', () => {
    expect(textTranslationIssue('书', '《红楼梦》')).toBeUndefined();
    expect(textTranslationIssue('标题', '<b>不闭合', 'plain')).toBeUndefined();
    expect(textTranslationIssue('选择', '<w>', 'choice')).toMatch(/不支持/);
    expect(textTranslationIssue('正文{name}', '<b>{name}</b>')).toBeUndefined();
    expect(textTranslationIssue('正文', '<b>未闭合')).toMatch(/缺少/);
  });
  it('统计按可见字素，术语跨样式匹配，选项变量也校验', () => {
    const source = '<color=accent>旧</color>称👩‍🚀\n@choice\n  {缺失} -> @goto end\n@label end';
    const scene = compileScene(source, 'intro.gal', 'intro');
    expect(computeProjectStats({ scenes: [scene], entryScene: 'intro', sourceTextByScene: { intro: source } }).totalCharacters).toBe(3);
    expect(auditTerminology(new Map([['intro', scene]]), [{ canonical: '新称', variants: ['旧称'] }])).toHaveLength(1);
    const issues: LintIssue[] = []; validateSceneVariables(scene, new Set(), new Map(), new Set(), issues, true);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'V002', line: 3 }));
  });
});
