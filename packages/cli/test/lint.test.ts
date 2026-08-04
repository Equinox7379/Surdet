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

  it('@call 到不存在的场景报错（J001，与 @jump 同等校验）', () => {
    const dir = makeProject({
      'content/scenario/a.gal': `@call ghost_scene\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'J001' && i.text.includes('@call'))).toBe(true);
  });

  it('@call 到缺失标签报错（J002）', () => {
    const dir = makeProject({
      'content/scenario/a.gal': `@call b.missing\n`,
      'content/scenario/b.gal': `@label start\n凛：好。\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'J002')).toBe(true);
  });

  it('@call 目标场景/标签均存在时通过', () => {
    const dir = makeProject({
      'content/scenario/a.gal': `@call b.extra\n`,
      'content/scenario/b.gal': `@label extra\n凛：好。\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(true);
  });

  it('场景 ID 重复报错', () => {
    const dir = makeProject({
      'content/scenario/dup.gal': `@label a\n`,
      'content/scenario/sub/dup.gal': `@label b\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'LINT_DUP')).toBe(true);
    // 重复 ID 的文件不重复计入 sceneCount（唯一成功场景数）
    expect(r.sceneCount).toBe(1);
  });

  it('文本插值引用未声明变量报 V002（转义 {{ }} 不算）', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { trust: { type: 'number', initial: 0 } } }),
      'content/scenario/a.gal': `凛：{{字面}} {trust} {ghost_var} 结尾。\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(false);
    const v2 = r.issues.filter((i) => i.code === 'V002');
    expect(v2).toHaveLength(1);
    expect(v2[0]!.text).toContain('ghost_var');
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

  it('原规划指令（particle/mov/tint/clear）全部已实现，不再产生 W002', () => {
    const dir = makeProject({ 'content/scenario/a.gal': `@particle snow\n@mov lynn left\n@tint off\n@clear good_end\n` });
    const r = lintProject(dir);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.code === 'W002')).toBe(false);
    expect(r.issues.some((i) => i.code === 'W001')).toBe(false);
  });

  it('演出三件套（particle/mov/tint）已实现，不再产生 W002', () => {
    const dir = makeProject({ 'content/scenario/a.gal': `@particle snow\n@mov lynn left\n@tint 0xff8866 0.3\n` });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'W002')).toBe(false);
    expect(r.issues.some((i) => i.code === 'W001')).toBe(false);
  });

  it('R2 新实现的演出指令（wait/shake/flash/zoom）不再产生 W002', () => {
    const dir = makeProject({ 'content/scenario/a.gal': `@wait 1000\n@shake\n@flash\n@zoom 1.2\n` });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'W002')).toBe(false);
    expect(r.issues.some((i) => i.code === 'W001')).toBe(false);
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

  it('content/config 内 DSL 表达式校验：引用未声明变量报 V002，语法错误报 CONFIG_EXPR', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { trust: { type: 'number', initial: 0 } } }),
      'content/config/calendar.json': JSON.stringify({
        nodes: [{ id: 'a', name: 'A', x: 0, y: 0, apCost: 1, visibleWhen: 'ghost > 1' }],
      }),
      'content/config/combat.json': JSON.stringify({ damage: { base: 'atk * 2 - def' } }),
      'content/config/events.json': JSON.stringify({ events: [{ id: 'e', characterId: 'x', when: 'trust >= 5', scene: 'a', once: true }] }),
      'content/config/ngp.json': JSON.stringify({ clearCondition: '1 +' }),
    });
    const r = lintProject(dir);
    // calendar visibleWhen 引用未声明变量 → V002
    expect(r.issues.some((i) => i.code === 'V002' && i.text.includes('ghost'))).toBe(true);
    // combat 伤害公式内建 atk/def/power 不报未声明
    expect(r.issues.some((i) => i.code === 'V002' && i.text.includes('atk'))).toBe(false);
    // ngp clearCondition 语法错误 → CONFIG_EXPR
    expect(r.issues.some((i) => i.code === 'CONFIG_EXPR')).toBe(true);
    // events when 引用已声明变量 trust → 无 V002
    expect(r.issues.some((i) => i.code === 'V002' && i.text.includes('trust'))).toBe(false);
  });

  it('jump 到编译失败场景报 J003 而非误报 J001', () => {
    const dir = makeProject({
      'content/scenario/bad.gal': `@if x\nA\n`, // 未闭合 if → S003 编译失败
      'content/scenario/a.gal': `@jump bad\n`,
    });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'S003')).toBe(true); // 真正的编译错误仍在
    expect(r.issues.some((i) => i.code === 'J003')).toBe(true); // jump 提示目标编译失败
    expect(r.issues.some((i) => i.code === 'J001')).toBe(false); // 不再误报"目标不存在"
  });

  it('写入 readonly 变量报 V003（@set/@mod/@flag）', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({
        variables: {
          chapter: { type: 'number', initial: 1, readonly: true },
          trust: { type: 'number', initial: 0 },
        },
      }),
      'content/scenario/a.gal': `@set chapter = 2\n@mod chapter +1\n@flag chapter\n@inc chapter\n@mod trust +1\n`,
    });
    const r = lintProject(dir);
    const v3 = r.issues.filter((i) => i.code === 'V003');
    expect(v3).toHaveLength(4); // set/mod/flag/inc 各一次，trust 正常
    expect(r.issues.some((i) => i.code === 'V003' && i.text.includes('trust'))).toBe(false);
  });

  it('说话人前缀插值引用未声明变量报 V002', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({ variables: { heroName: { type: 'string', initial: '陆屿' } } }),
      'content/scenario/a.gal': `{heroName}：你好。\n{ghost}：再见。\n`,
    });
    const r = lintProject(dir);
    const v2 = r.issues.filter((i) => i.code === 'V002');
    expect(v2.some((i) => i.text.includes('ghost'))).toBe(true);
    expect(v2.some((i) => i.text.includes('heroName'))).toBe(false);
  });

  it('choice 后缩进对话被吞为选项：前缀与场景内说话人一致的选项行报 W004', () => {
    const dir = makeProject({
      'content/scenario/a.gal': `@choice\n  凛：这是缩进的普通对话\n  选项A -> @goto a\n@label a\n凛：真实对话。\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(true); // 警告不阻断
    expect(r.issues.some((i) => i.code === 'W004')).toBe(true);
  });

  it('choice 后缩进旁白（（...）无说话人前缀）被吞为选项也报 W004', () => {
    const dir = makeProject({
      'content/scenario/a.gal': `@choice\n  （她沉默了片刻。）\n  选项A -> @goto a\n@label a\n`,
    });
    const r = lintProject(dir);
    expect(r.ok).toBe(true);
    expect(r.issues.some((i) => i.code === 'W004')).toBe(true);
  });

  it('含冒号的合法选项（动词：内容）不误报 W004', () => {
    const dir = makeProject({
      'content/scenario/a.gal': `@choice\n  说实话：白鹭街，雾灾，还有安安 -> @goto a\n@label a\n凛：对话。\n`,
    });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'W004')).toBe(false);
  });

  it('未消费的指令修饰符报 W003（@show 未知修饰符 / 核心指令带修饰符）', () => {
    const dir = makeProject({
      'content/scenario/a.gal': `@bg castle @transition fade\n@show lynn @ zoom\n@show lynn @ left\n`,
    });
    const r = lintProject(dir);
    const w3 = r.issues.filter((i) => i.code === 'W003');
    expect(w3).toHaveLength(2); // @bg @transition + @show @zoom；@show @left 合法
    expect(w3.some((i) => i.text.includes('transition'))).toBe(true);
    expect(w3.some((i) => i.text.includes('zoom'))).toBe(true);
  });

  it('system 指令的修饰符是宿主参数通道，不报 W003', () => {
    const dir = makeProject({
      'content/scenario/a.gal': `@battle fight_01 @difficulty hard\n@calendar map_01 @season=winter\n@affection lynn @boost\n`,
    });
    const r = lintProject(dir);
    expect(r.issues.some((i) => i.code === 'W003')).toBe(false);
  });

  it('game.config.json 中 number 变量 min > max 报 VAR_DECL', () => {
    const dir = makeProject({
      'game.config.json': JSON.stringify({
        variables: {
          ok: { type: 'number', initial: 0, min: 0, max: 100 },
          bad: { type: 'number', initial: 0, min: 100, max: 0 },
        },
      }),
      'content/scenario/a.gal': `凛：好。\n`,
    });
    const r = lintProject(dir);
    const vd = r.issues.filter((i) => i.code === 'VAR_DECL');
    expect(vd.some((i) => i.text.includes('bad'))).toBe(true);
    expect(vd.some((i) => i.text.includes('ok'))).toBe(false);
  });
});
