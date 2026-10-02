/**
 * 错误码修复建议表（M5 支柱1：AI 创作闭环）。
 * 每条 hint 写给 AI/作者看：精确、可操作、直接给出修复动作。
 * `surdet lint --json` 输出携带 hint，构成"写剧本 → lint → 按 hint 修复 → 再 lint"的自我修正循环接口。
 */

export const LINT_CODE_HINTS: Record<string, string> = {
  /* ---- 词法（L） ---- */
  L001: '指令名缺失或 @ 后跟空白：指令必须形如 @指令名 参数，@ 后紧跟指令名，不要有空格。',
  L002: '修饰符缺键名：修饰符必须形如 @键=值 或 @键，@ 后必须有键名。',
  L003: '@label 用法错误：标签行必须恰为 "@label 标签名"，标签名不能为空、不含空格。',
  L004: '参数引号未闭合：引号包裹的参数必须成对闭合，检查是否漏了结尾引号。',

  /* ---- 语法结构（S） ---- */
  S001: '@if/@elif 后缺条件表达式：补上布尔表达式，如 @if lynn.trust >= 10。',
  S002: '条件表达式语法错误：检查运算符/括号/引号配对，表达式文法见 dsl-spec "表达式语言" 一节。',
  S003: '@if/@elif/@else/@endif 配对错误：每个 @if 必须有对应 @endif，@elif/@else 只能出现在两者之间。',
  S004: '@choice 缺少缩进选项行：@choice 下一行起必须有缩进的选项行（形如 "  选项文本 -> @goto 标签"）。',
  S005: '选项文本/条件为空：选项行必须有可见文本；[if:...] 条件不能为空表达式。',
  S006: '@goto/@jump/@call 缺目标：补上目标标签（@goto 标签）或场景（@jump 场景[.标签]）。',
  S007: 'choice 选项内不允许块指令：选项 -> 之后只允许内联单行指令（@set/@mod/@goto/@jump 等），不能嵌 @if/@choice。',
  S008: '@if 嵌套过深（>200 层）：拆分条件结构，通常是 @endif 漏写导致解析吞并。',
  S009: 'choice 行内动作必须以 @ 开头，如 "-> @goto target"；若提示文案边界有歧义，请闭合文案引号或改用中文引号。',
  S010: 'choice 行内不支持 @switch/@loop/@video；跳转到独立标签后在正文中使用。',

  /* ---- 编译（C） ---- */
  C001: '标签重复定义：同一场景内 @label 名必须唯一，给重复的标签改名。',
  C002: '@goto 目标标签不存在：在本场景补 @label 该标签，或改成已存在的标签名（检查拼写）。',
  C003: '（预留错误码）',
  C004: '@set 用法错误：形如 @set 变量 = 表达式（运算符可为 = / := / += / -=）。',
  C005: '@set 右值表达式语法错误：检查表达式文法（运算符/括号/引号），见 dsl-spec "表达式语言"。',
  C006: '@mod 增量非法：形如 @mod 变量 +3 / @mod 变量 -2，增量必须是带符号整数。',
  C007: '@wait 用法错误：形如 @wait 800，参数为正整数毫秒（1..600000）。',
  C008: '@switch 需要变量名与 值:标签 条目，例如 @switch chapter 1:c1 2:c2。',
  C009: '@video 缺少素材键，例如 @video op_01。',
  C010: '@timeline 只接受一个时间轴 ID 与可选 @ blocking，不要附加行尾注释或额外位置参数。',

  /* ---- 跨场景（J） ---- */
  J001: '@jump/@call 目标场景不存在：场景 ID = content/scenario 下文件名去扩展名；创建该场景文件或改正拼写。',
  J002: '目标场景中不存在该标签：在目标场景补 @label 该标签，或改正标签拼写。',
  J003: '目标场景存在但编译失败：先修复目标场景自身的语法/结构错误，本错误会自动消失。',
  J004: '@switch 分支目标标签不存在：在本场景补 @label 该标签，或改正分支标签拼写。',

  /* ---- Gallery 内容完整性（Wave 6） ---- */
  G001: 'gallery.json 结构非法：cgs/music 必须为数组；每项须有非空 id/name，text 须有 scene，src/label 若提供必须为非空字符串。',
  G002: 'gallery.json 同一分类内存在重复 id：保留一个唯一 ID，并让对应 @unlock_* 使用该唯一 ID。',
  G003: 'Gallery 素材键不存在：CG 的 src/id 必须对应 content/assets/bg/<key>.*，音乐必须对应 content/assets/bgm/<key>.*；改正键或在独立素材任务中导入资产。',
  G004: '文本回想目标场景不存在：把 gallery.json texts[].scene 改为 content/scenario 下真实场景 ID，或先修复该场景。',
  G005: '文本回想标签不存在：移除可选 label 以从场景开头回放，或改为目标场景真实的 @label。',
  G006: '@unlock_cg/@unlock_music/@unlock_text/@unlock_profile/@unlock_term 没有对应的 gallery.json 条目：补齐同分类 id 或修正解锁指令参数。',
  G007: 'Gallery 条目永远不会解锁：在合适的剧情到达点加入对应 @unlock_*，或删除尚未拥有内容的条目。',
  G008: '角色头像配置无效：characters.<id>.avatar 必须是 content/assets/avatar 中真实存在的非空素材键。',

  /* ---- 变量（V） ---- */
  V001: '赋值/修改目标变量未声明：在 game.config.json 的 variables 表声明该变量（含 type 与 initial）。',
  V002: '表达式引用了未声明变量：在 game.config.json 的 variables 表声明该变量；若为系统内建变量请核对拼写。',
  V003: '写入了 readonly 变量：去掉声明中的 readonly: true，或改用其他变量承接写入。',
  VAR_DECL: 'game.config.json 变量声明形状非法：每条须为 { type, initial }，type 限 number/string/boolean/flag/string[]/number[]/object，initial 须与 type 匹配。',

  /* ---- 静态类型（T） ---- */
  T001: '@set 值类型与声明类型不匹配：调整右值类型或修改变量声明 type（+=/-= 仅用于 number）。',
  T002: '条件表达式静态类型不是 boolean：条件应产出布尔值（比较/逻辑运算），不要用数值/字符串表达式。',
  T003: '运算符操作数类型明显不符：如数值变量与字符串比较、数值与布尔做 &&；修正操作数或补充类型转换逻辑。',
  T010: '@transition 类型未知：使用已支持的 fade、slide-left、slide-right 或 circle。',
  TL001: '时间轴 JSON 顶层必须是对象。',
  TL002: '时间轴 version 必须为 1 或 2；使用 clips 时须为 2。',
  TL003: '时间轴 id 仅用字母、数字、下划线、点号或短横线，且与文件名一致。',
  TL004: '时间轴总时长 durationMs 必须为 0..600000 的整数毫秒。',
  TL005: 'tracks 必须是数组；仅 version 2 且含非空 clips 时可为空。每个轨道包含 cues 数组，轨道与节点必须是对象。',
  TL006: '时间轴节点起点与时长必须为非负整数，结束时间不能超过总时长。',
  TL007: '时间轴轨道或缓动不受支持；按时间轴类型表选择 kind/easing。',
  TL008: '时间轴动作与轨道类型不匹配；按该轨道的动作表修改 action。',
  TL009: '时间轴动作参数不合法；按诊断中的字段路径修正目标、素材、数值范围或粒子预设。',
  TL010: '时间轴 id 重复；不同文件必须使用不同 id。',
  TL011: 'clips 需要 version 2，最多 256 项；按字段路径检查片段 ID、时间、重复次数与 targets 映射。',
  TL012: '片段无法展开：检查缺失引用、循环/过深嵌套、展开数量、超出父时间轴或目标映射冲突。',

  /* ---- 警告（W） ---- */
  W001: '未知指令：若是拼写错误请改正；若是自定义指令，在 game.config.json 的 customInstructions 数组声明以消音。',
  W002: '该指令已声明但尚未实现（当前无任何效果）：不要依赖其行为，或改用已实现的等价指令。',
  W003: '指令修饰符未被引擎消费（会被静默丢弃）：@show 支持舞台姿态、@instance 和位置修饰符；大系统指令修饰符为宿主参数通道除外。',
  W004: '选项文本带说话人冒号前缀：疑似把缩进的对话行误写进了 @choice 选项区——choice 后的正文行绝不能缩进。',
  W005: '@choice 全部选项都带 [if:...] 条件：运行时可能全部不满足而静默跳过选择，建议保留一个无条件兜底选项。',
  W006: '标签从未被任何 @goto/@loop/@switch/@jump/@call 引用：疑似残留，删除或补上引用。',
  W007: '场景从入口场景不可达：补一条通往该场景的 @jump/@call；若为配置驱动的宿主入口场景（events/growth/calendar 配置引用）可忽略。',
  W008: 'choice 选项内含多个 @goto/@jump：仅第一个生效，其余被丢弃——删掉多余的跳转指令。',

  /* ---- 其他 ---- */
  SCENE_ID: '@scene 声明与文件名不一致或场景 ID 含点号：@scene 后的 ID 必须等于文件名去扩展名；点号会破坏 sceneId.label 寻址，请重命名文件。',
  LINT_DUP: '场景 ID 重复：场景 ID = 文件名去扩展名且必须全局唯一（子目录同名文件也算冲突），给其中一个文件改名。',
  LINT: '剧本编译失败（通用）：按错误消息中的 文件:行:列 定位修复。',
  CONFIG: 'game.config.json 或 content/config/*.json 缺失/解析失败：检查 JSON 语法（多余逗号/缺引号最常见）。',
  CONFIG_EXPR: 'content/config/*.json 内 DSL 表达式语法错误：按 dsl-spec "表达式语言" 修正该表达式。',
  NO_CONFIG: '未找到 game.config.json：创建它并声明 variables（否则变量校验被跳过）。',
  EMPTY_VARIABLES: 'variables 表为空；剧本和配置用到的变量都应在 variables 表声明。',

  /* ---- 内容审计（audit） ---- */
  BRANCH_THIN: '空心分支：分支内无实质剧情推进（无文本/无状态变化），补充内容或删除该分支。',
  CONSIST_HONORIFIC: '称谓不一致：同一角色的称呼在剧本中出现多种写法，统一为 terminology.json 约定称谓。',
  CONSIST_TYPO: '疑似名词笔误：与 terminology.json 名词表编辑距离相近，按名词表统一写法。',
  NO_EXIT: '场景无出口：场景既无 @jump/@call/@end 后承接也非结局场景，补跳转或确认是否为死路。',
  TERM_VARIANT: '名词变体：设定名词出现非标准变体，按 terminology.json 统一。',
};

/** 取错误码的修复建议（未知错误码返回通用指引） */
export function hintForCode(code: string): string {
  return LINT_CODE_HINTS[code] ?? '按错误消息中的 文件:行:列 定位，参照 docs/dsl-spec.md 错误码表修复。';
}

/** 为一组 issues 补齐 hint 字段（已有 hint 的不覆盖） */
export function attachHints(issues: { code: string; hint?: string }[]): void {
  for (const issue of issues) {
    if (!issue.hint) issue.hint = hintForCode(issue.code);
  }
}
