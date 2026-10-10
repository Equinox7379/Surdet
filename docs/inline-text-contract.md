# 行内文字与文字记录：后端及前端接入合同

基于2026-10-10成熟化规划。Owner批准显式`<ruby=读音>基础字</ruby>`，裸《》恢复普通书名号，不保留旧注音兼容；文字记录进入表现快照，Spine/Live2D一起暂缓。第一批PR #8，阅读辅助PR #9，第二批标签与文字记录后端叠在阅读辅助之上；前端依次接入，不引入HTML。

## 已实现的文字语义

Core导出`INLINE_TEXT_TAGS`作为唯一标签表：`b`、`i`、`color`、`size`、`speed`、`w`、`ruby`、`em`、`shake`、`wave`、`nw`。显式Ruby与共享解析一同接入，不再让两种注音语法并存。

- `color`：`#RGB`、`#RRGGBB`或`text/textMuted/accent/accentSoft/danger`；`size`为0.5–2倍率，`speed`为0.1–10倍率。`b/i/color/size/speed`成对且严格嵌套；内层倍率相对玩家设置，不与外层倍率连乘。
- `<w=1…10000>`按帧时间停顿，菜单/文字记录/显式暂停期间冻结；`<w>`等待一次点击或回车，继续同一句、不切断语音。打字中点击只揭示到下一处`<w>`，途中定时停顿跳过；快进跳过全部停顿。自动阅读按上一段可见字数停留后解除`<w>`，句末仍遵守语音等待。
- Ruby的主文字作为一个可见单元整组揭示；主文字需同一行，内部不再嵌套标签，样式放在ruby外层。旧`世界《せかい》`现在按字面显示全部字符。
- `\<`表示字面尖括号，`\\`表示字面反斜杠。其他反斜杠不特殊处理；`>_<`、`<3`、`a < b`与`<<标题>>`原样显示。
- `<em>重点</em>`显示着重号，可与Ruby组合；`<shake>震惊</shake>`和`<wave>轻声</wave>`逐字投影，由既有帧循环推进。菜单暂停冻结，快进或减少动态时静止，不增加独立ticker。
- `<nw>`只能位于句末且在所有成对标签外；整句打完后下一帧自动推进，不等待配音/朗读，不绕过句中`<w>`。停顿解除后继续到句末；快进按既有全句跳过规则。NVL不执行停顿、变速、自动继续或逐字动画。
- 选项支持样式、着重号和Ruby，不支持`w/speed/nw/shake/wave`。说话人、指令参数及配置名称不解析标签。NVL与默认文字记录保留静态样式；自定义界面仍得到明文，另有可选`markup`供受控渲染，不能把它当HTML。
- 切换语言按可见单元比例保留进度，清除旧停顿；存读档/回退仍按现有规则从当前句首重新播放。标签不占打字时间，不污染明文字数、朗读台词或无障碍名称。

## Core公开读取接口

`parseInlineText(source, context = 'dialogue')`接收`dialogue | choice | speaker`，返回：

| 字段 | 含义 |
| --- | --- |
| `source` | 未改动的输入原文 |
| `units` | 可见字素/注音组；`text`、`start/end`、`style`及可选`ruby`；样式含bold/italic/color/size/speed/emphasis及effect:shake或wave |
| `tags` | 已识别标签的`name/closing/start/end/value?`，可直接用于高亮 |
| `controls` | `kind:pause|wait|no-wait`，`at`为可见单元边界，`durationMs?`及`start/end` |
| `plainText` | 可见文字，不含样式和节奏标记 |
| `issues` | M001警告、M002–M006错误，含中文message和`start/end`；M006为nw位置错误 |
| `hasMarkup` | 识别过已登记标签（即使该标签错误），不是“渲染成功”标记 |

所有`start/end`均为原输入字符串的UTF-16偏移，起点含、终点不含。Ruby单元覆盖完整标签与主文字；转义单元范围覆盖源转义。不要将译文或变量替换后的范围定位到源稿。编译诊断已换算成原文件一基行列`range`；继续使用PR3的校验时效保护。

错误的已登记标签使运行时整句按字面显示，不执行该句节奏；编译/公开校验则拒绝M002–M006。未知标签警告M001并按字面显示，不认HTML或脚本。字段不解析标签时调用方保持普通文字，不套这个解析器。

`inlinePlainText(source, context?)`和`inlineTextLength(source, context?)`用于标记原文的明文投影与可见字素计数；**不要再次解析已经投影为纯文字的变量值/文字记录**。`textGraphemeCount(plain)`只计纯文字。静态统计仍保持既有“台词字数”口径，不把动态变量内容猜成运行时值，选择项数量独立统计。

`interpolateInlineText`先识别模板中的真实标签，再替换普通文字中的变量；`<{tag}>`也不能由变量拼成标签。普通说话人仍走原来的`interpolate`。普通文本/CSV导入会转义尖括号与反斜杠；主动编写DSL或`scene.patch`的正文可以包含标签。

Authoring合同2.32.0，能力仍为72项。`capabilities.describe.result.inlineText`包含`tags`、`ruby:explicit-only`和转义说明；无需增加一个标签写入工具。CLI/MCP/Editor必须使用同批依赖。译稿CSV保留原文标记；配音CSV的待录台词投影为明文，绑定仍固定原始台词，不把明文冒充源文。

## Renderer接线

`showText(speaker, value, visibleUnits?)`现在传**完整标记字符串**与可见单元数量；不传数量表示整句显示。不要再传截断标签的字符串。整句先排版，进度只改变可见文字；句中等待仍处于typing而非剧情advance状态。投影`dialogText`始终为当前可见纯文字，Ruby不再返回空串。

## 文字记录与NVL的保存合同

`inlineStaticText(source)`移除w/speed/nw/shake/wave的开闭标签，保留b/i/color/size/em/ruby和字面文字。非法标记整句转义为静态字面。`BacklogEntry`仍有`speaker:string|null`、`text:string`和可选`voice:string`，新增可选`markup:string`；`text`是明文，`markup`是静态标记源文，两者必须显示同样正文。普通条目不必存markup，返回条目不可变。NVL的`appendNvlText(speaker,text,markup?)`遵守同一明文/静态源文分工。

完整最多200条保存在`presentation.payload.dialogue.backlog`，顺序从旧到新；`backlogReplayCurrent:boolean`表示当前文本已经入历史，恢复后Core重放当前句时仅跳过一次追加。选择、等待处保存为false，下一句照常记录。回退恢复当时完整内容，不能只截断条数。Schema顶层仍v3、表现快照仍v1，本轮没有迁移层；缺记录字段代表无历史，不带入读档前历史，若Core需要重放当前句，它成为恢复后的第一条。字段存在但非法则在Core修改状态前拒绝。

新游戏清空旧记录；Host回退在目标校验前通过`resetSession({preserveReadingHistory:true})`保留当前历史，成功后替换为目标记录；一般新会话重置缺省清空。历史保留原语言、显示名和语音键，切语言不重译旧历史。默认记录仍显示最近120条；持久化完整200条。NVL/记录静态渲染不执行节奏或动画；自定义DOM可以消费明文，格式展示需Claude用Core受控解析接入。

## Claude前端范围

在本后端PR分支上开独立前端分支/PR，不直接修改后端分支，不合并其他PR。仅处理Editor交互与必要的展示接线，不改Core/Renderer/Authoring语法或状态机，也不重新美化Player：

1. 用Core标签表做正文标签补全、高亮和选中包裹；源稿、原生输入法/选区与撤销仍为事实源，未聚焦展示可用解析后的单元，文字必须用textContent/受控样式，不把原文当innerHTML。
2. 问题面板消费M类诊断及现有精确range。只给唯一可判定且新校验仍有效的修复，不猜作者意图。
3. 接入Core明文计数、跨标签搜索和提示；修改/替换必须映射回原文区间，不替换进标签参数，不改说话人的普通文字语义。分割台词不能从标签中间切断。
4. `preview-replay-runtime.ts`按已固定来源+选项index续接；渲染后的label会插值/含样式，不能再拿它和源文相等比较。Authoring同合同已改，旧来源失效/条件不可见仍拒绝。
5. 后端已给自定义选择列表提供明文label、保留index，默认Player渲染直接复用本轮运行内核，不在Editor另造预览文字效果。

本机Windows Chromium已通过真实共享Player的样式/显式注音、同句等待、继续、快进、等待点存读档与选择输入定向验证；完整过程见本机任务台账。这不代签Editor前端、独立桌面包或冻结性能资格化验收，不得据单测关闭旧sceneP95Ms红灯。后端与前端合入前，日常Editor仍使用已交付的PR #7版本。
