import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { lintProject } from '../src/lint.js';

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-lint-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
  }
  return dir;
}

describe('lintProject', () => {
  it('合法项目通过', () => {
    const dir = makeProject({
      'content/scenario/ch01_01.gal': `@label start\n凛：你好。\n@jump ch01_02\n`,
      'content/scenario/ch01_02.gal': `@label start\n凛：你好。\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(true);
    expect(r.sceneCount).toBe(2);
  });

  it('if 未闭合的语法错误定位到文件与代码', () => {
    const dir = makeProject({
      'content/scenario/bad.gal': `@if x\nA\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.severity === 'error');
    expect(err).toBeTruthy();
    expect(err!.code).toBe('S003');
    expect(err!.file).toContain('bad.gal');
  });

  it('表达式语法错误（set 右值非法）', () => {
    const dir = makeProject({
      'content/scenario/bad.gal': `@set x = 1 +\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'C005')).toBe(true);
  });

  it('本场景 goto 未定义标签报错', () => {
    const dir = makeProject({
      'content/scenario/a.gal': `@goto ghost\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'C002')).toBe(true);
  });

  it('跨场景跳转到不存在的场景报错（J001）', () => {
    const dir = makeProject({
      'content/scenario/a.gal': `@jump ghost_scene\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'J001')).toBe(true);
  });

  it('跨场景跳转到缺失标签报错（J002）', () => {
    const dir = makeProject({
      'content/scenario/a.gal': `@jump b.missing\n`,
      'content/scenario/b.gal': `@label start\n凛：好。\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'J002')).toBe(true);
  });

  it('场景 ID 重复报错', () => {
    const dir = makeProject({
      'content/scenario/dup.gal': `@label a\n`,
      'content/scenario/sub/dup.gal': `@label b\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'LINT_DUP')).toBe(true);
  });

  it('赋值目标变量未声明报 V001', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { trust: { type: 'number', initial: 0 } } }),
      'content/scenario/a.gal': `@set ghost = 5\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'V001')).toBe(true);
  });

  it('表达式引用未声明变量报 V002', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { trust: { type: 'number', initial: 0 } } }),
      'content/scenario/a.gal': `@if ghost > 1\nA\n@endif\n@set x = trust + ghost\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    const v2 = r.issues.filter((i) => i.code === 'V002');
    expect(v2.length).toBeGreaterThanOrEqual(2);
  });

  it('choice 选项条件引用未声明变量报 V002', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { trust: { type: 'number', initial: 0 } } }),
      'content/scenario/a.gal': `@choice\n  A [if:ghost] -> @goto a\n@label a\n`,
    });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'V002')).toBe(true);
  });

  it('缺 game.config.json 给 NO_CONFIG 警告（不阻断）', () => {
    const dir = makeProject({ 'content/scenario/a.gal': `@label a\n` });
    const r = lintProject(dir);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.code === 'NO_CONFIG')).toBe(true);
  });

  it('LexError 结构化定位过 lint（code/行列）', () => {
    const dir = makeProject({ 'content/scenario/a.gal': `@ show x\n` });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    const err = r.issues.find((i) => i.severity === 'error');
    expect(err!.code).toBe('L001');
    expect(err!.line).toBe(1);
    expect(err!.col).toBeGreaterThan(0);
  });

  it('@scene 与文件名不一致报 SCENE_ID', () => {
    const dir = makeProject({ 'content/scenario/a.gal': `@scene ch99\n` });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'SCENE_ID')).toBe(true);
  });

  it('未知指令产生 W001 警告', () => {
    const dir = makeProject({ 'content/scenario/a.gal': `@choise abc\n` });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'W001' && i.severity === 'warning')).toBe(true);
  });

  it('规划中未实现的指令产生 W002 警告', () => {
    const dir = makeProject({ 'content/scenario/a.gal': `@wait 1000\n` });
    const r = lintProject(dir);
    expect(r.ok).toBe(true); // 警告不阻断
    expect(r.issues.some((i) => i.code === 'W002' && i.severity === 'warning')).toBe(true);
  });

  it('变量全声明且合法时无变量错误', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({
        variables: { trust: { type: 'number', initial: 0 }, hasSword: { type: 'flag', initial: false } },
      }),
      'content/scenario/a.gal': `@set trust = 5\n@mod trust +1\n@if trust > 3 && hasSword\nA\n@endif\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(true);
  });

  it('变量声明 type 拼错报 VAR_DECL', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { x: { type: 'numb3r', initial: 0 } } }),
      'content/scenario/a.gal': `@label a\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'VAR_DECL')).toBe(true);
  });

  it('变量声明缺 initial 报 VAR_DECL', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { y: { type: 'number' } } }),
      'content/scenario/a.gal': `@label a\n`,
    });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'VAR_DECL')).toBe(true);
  });

  it('变量声明 initial 与 type 不匹配报 VAR_DECL', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { z: { type: 'number', initial: 'abc' } } }),
      'content/scenario/a.gal': `@label a\n`,
    });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'VAR_DECL')).toBe(true);
  });

  it('variables 空表发 EMPTY_VARIABLES 警告且不校验变量', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: {} }),
      'content/scenario/a.gal': `@set ghost = 1\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.code === 'EMPTY_VARIABLES' && i.severity === 'warning')).toBe(true);
  });

  it('customInstructions 声明后未知指令不再告警', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ customInstructions: ['mypower'], variables: {} }),
      'content/scenario/a.gal': `@mypower abc\n`,
    });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'W001')).toBe(false);
  });

  it('V002 对重复变量只报一次（去重）', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { trust: { type: 'number', initial: 0 } } }),
      'content/scenario/a.gal': `@if ghost > ghost\nA\n@endif\n`,
    });
    const r = lintProject(dir);
    const v2 = r.issues.filter((i) => i.code === 'V002');
    expect(v2).toHaveLength(1);
  });

  it('choice 选项 when 引用未声明变量定位到选项行', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { trust: { type: 'number', initial: 0 } } }),
      'content/scenario/a.gal': `@label a\n凛：x\n@choice\n  A [if:ghost] -> @goto a\n@label b\n`,
    });
    const r = lintProject(dir);
    const v2 = r.issues.find((i) => i.code === 'V002');
    expect(v2).toBeTruthy();
    expect(v2!.line).toBe(4); // 选项行
  });

  it('直改 store 指令（inc/dec/toggle/flag/unflag）目标变量未声明报 V001', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { trust: { type: 'number', initial: 0 } } }),
      'content/scenario/a.gal': `@inc ghostA\n@dec ghostB\n@toggle ghostC\n@flag ghostD\n@unflag ghostE\n@inc trust\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    const v1 = r.issues.filter((i) => i.code === 'V001');
    expect(v1).toHaveLength(5); // ghostA..E，trust 已声明
  });

  it('@autosave/@savepoint 已是实现指令，不再产生 W002', () => {
    const dir = makeProject({ 'content/scenario/a.gal': `@autosave\n@savepoint\n` });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'W002')).toBe(false);
  });

  it('@set 类型不匹配报 T001（= 与 += 均检查）', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({
        variables: { trust: { type: 'number', initial: 0 }, name: { type: 'string', initial: '' } },
      }),
      'content/scenario/a.gal': `@set trust = "abc"\n@set trust += "abc"\n@set name = 1\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.filter((i) => i.code === 'T001')).toHaveLength(3);
  });

  it('条件表达式静态类型非 boolean 报 T002', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { trust: { type: 'number', initial: 0 } } }),
      'content/scenario/a.gal': `@if trust + 1\nA\n@endif\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'T002')).toBe(true);
  });

  it('运算符操作数类型明显不符报 T003', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({
        variables: { trust: { type: 'number', initial: 0 }, hasSword: { type: 'flag', initial: false } },
      }),
      'content/scenario/a.gal': `@if trust > "abc"\nA\n@endif\n@if trust && hasSword\nB\n@endif\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    const t3 = r.issues.filter((i) => i.code === 'T003');
    expect(t3).toHaveLength(2); // '>' 字符串操作数 + '&&' 数字操作数
  });

  it('静态类型合法的项目不产生 T 系列错误', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({
        variables: {
          trust: { type: 'number', initial: 0 },
          name: { type: 'string', initial: 'x' },
          hasSword: { type: 'flag', initial: false },
          flagV: { type: 'flag', initial: false },
          msg: { type: 'string', initial: '' },
        },
      }),
      'content/scenario/a.gal':
        `@set trust = 5\n@set name = "a" + trust\n@set flagV = trust > 3\n` +
        `@set msg = "x" + hasSword\n@if trust > 3 && hasSword\nA\n@endif\n@set trust += 1\n`,
    });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code.startsWith('T'))).toBe(false);
  });

  it('string + boolean 合法拼接不报 T003；number + boolean 报 T003', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({
        variables: { hasSword: { type: 'flag', initial: false }, msg: { type: 'string', initial: '' } },
      }),
      'content/scenario/a.gal': `@set msg = "x" + hasSword\n@set trust = 1 + hasSword\n`,
    });
    const r = lintProject(dir);
    // "x" + hasSword 合法；1 + hasSword 报 T003 且 msg 是 string（第二个 set 的 trust 未声明 → V001）
    expect(r.issues.some((i) => i.code === 'T003')).toBe(true);
  });

  it('场景 ID 含点号报 SCENE_ID（破坏 @jump 寻址）', () => {
    const dir = makeProject({
      'content/scenario/a.b.gal': `@scene a.b\n凛：好。\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'SCENE_ID')).toBe(true);
  });
});
