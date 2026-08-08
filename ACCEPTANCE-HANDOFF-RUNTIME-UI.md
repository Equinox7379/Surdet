# ACCEPTANCE-HANDOFF-RUNTIME-UI：游戏运行时画面现代化「夜色蔚蓝」（审阅交接书）

> 本文档写给**审阅本批次的 AI**。前置：先读 `SESSION-HANDOFF.md`（超级仓库/copy-edit-copy/审阅流程铁律）与本批计划书 `PLAN-RUNTIME-UI.md`（用户已拍板方向与范围）。
> 本地提交 3 个（未推送）：`44e86a4`（对话戏核心）+ `a3c2ee7`（氛围件）+ `946fa9c`(微调件+暖色清零)。推送时移植范围 `9b99e47..HEAD`。
> **状态：开发完毕，待审阅**。

---

## 1. 基线预期

| 检查 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **603** 过（core 269 / cli 78 / renderer 112 / shell 19 / editor 125，只增不减），0 failed |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

开发期已全绿（五件套逐项实跑）。

## 2. 交付内容（1 文件：`packages/renderer/src/pixi-stage.ts`，3 提交）

**不改 DSL、不改 core、不改编辑器、不改 text-wrap.ts**（硬约束）。新增模块级调色板常量 `NIGHT_AZURE`（夜色蔚蓝全色板，文件顶部）。

### 提交一 `44e86a4` 对话戏核心（PLAN §3）
- **对话框玻璃化**：`#drawDialogPanel()` 新方法替代构造器内单次绘制——深蓝黑两段半透明 fill 叠加近似纵向渐变（上 `0x0c1424` α0.68，下半手工 arc 路径深色层 `0x0a0f1c` α0.5）+ 1px 冷蓝细描边 `0x9fd4ff` α0.25 + 顶沿 2px 蔚蓝强调线 `0x5ac8ff` α0.8；圆角 14→10。面板几何（40, h-210, w-80, 180）不变，可见性逻辑零改动。
- **说话人名牌**：新增 `#speakerPlate` Graphics + `#drawSpeakerPlate()`——深蓝圆角胶囊（`0x123a5c` α0.92 + 蔚蓝 1px 细边），骑在对话框上沿偏左（x=44, y=h-236），宽度随说话人文本自适应；空说话人/NVL 模式/隐藏界面（H 键）三态自动隐藏（showText/hideInterface/setNvlMode 三处接线）；`#speakerText` 裸文字改冷白 `0xeaf6ff`，位置上移进名牌。
- **排版升级**：正文 lineHeight 38→46、fill 冷白 `0xf2f6ff` + Pixi v8 原生 `dropShadow`（极淡：α0.35/blur 6/distance 2）；ruby 注音基字同口径。断行链路（`#wrapDialogText`/wrapCjkMeasure/字数容量）**一字未动**。
- **选择肢卡片化**：`showChoices` 重写为卡片视图对象 `{ holder, bg, bar, label }`；玻璃卡片底 `0x0d1526` α0.66 + 细描边 `0x3d5a80`，悬停/键盘高亮统一走 `#drawChoiceCard(view, selected)`：蔚蓝描边 1.5px + 左侧 3.5px 强调条 + 文本加粗提亮；序号角标（`1.`/`2.`）并入标签文本；`setChoiceHighlight` 同步重绘卡片（原来只改文本色）。布局坐标/点击回调/`#clearChoices` 销毁链行为不变。

### 提交二 `a3c2ee7` 氛围件（PLAN §4）
- **占位背景升级**：`makeBackgroundTexture` 重写——key 哈希定色相（冷色带 190°..310°）三段纵向渐变 + canvas 径向暗角 + 1400 粒微噪点。噪点用新增 `seededRandom()`（mulberry32，种子 = key 哈希），**不用 Math.random**，"同 key 稳定同图"契约不变；`#bgTextureCache` 键契约与真实素材注入路径（`#registeredBgs`）未动。
- **标题画面重做**：深黑蓝底 `0x060a14`；大字距（letterSpacing 8）冷白标题 + 标题下 300px 蔚蓝强调线 + 淡灰蓝副标题；菜单纵列悬停：左侧 4px 蔚蓝高亮条滑入 + 文字提亮加粗 + 微右移 10px（pointerover/out 配对）。
- **章节横幅电影化**：chapter 变体上下 90px 黑边 letterbox（新增 `#bannerBars`，tip 时隐藏）+ letterSpacing 10 大字距冷白；tip 变体右上小胶囊玻璃底板（新增 `#bannerTipBg`，随文本宽高自适应绘制）。`#updateTransient` 横幅 alpha 从"仅末 400ms 淡出"升级为"首 300ms 淡入 + 末 400ms 淡出"。

### 提交三 `946fa9c` 微调件 + 暖色清零（PLAN §5 + §2 硬约束①）
- **继续指示器**：暖色 ▼ 三角 → 蔚蓝呼吸小光点（外圈柔光 r9 α0.22 + 内圈亮点 r4.5）；`updateContinuePulse` 改为 alpha 呼吸（0.7±0.28）+ 轻浮动（±3px），动画仍由既有 ticker 链路驱动，未新建 ticker。**顺手修复祖传 bug**：历史代码只驱动 y、x 从未赋值，指示器一直贴画面左缘——现定位 `x = w-68`（对话框右下）。
- **NVL 页**：底色换玻璃口径 `0x0c1424` α0.78，正文冷白；**排版参数（行高 28/间隙 6/超底边淘汰/起始 y=60）一字未动**（nvl.test.ts 10 组断言锁定）。
- **Backlog**：深蓝玻璃底 `0x070d1a` α0.92，标题冷白、说话人蔚蓝、正文冷蓝白 `0xd6e2f5`；滚动/语音重播/关闭逻辑未动。
- **系统覆盖层暖色清零**：鉴赏 tab/设置面板/战斗（回合头/阵营/技能条/跳过）/存读档/大地图（日期/可进入节点/结束回合）/商店（标题/购买）/据点（标题/执行）全部 `0xffe8c8` 替换为蔚蓝强调或冷白标题。**文件内 `0xffe8c8` 计数 = 0**（可 grep 复核）。

## 3. 有意为之（请勿误报）

1. **渐变是两段 fill 叠加近似，不是真 gradient fill**：计划书 §8 明确拍板此口径（Pixi v8 真渐变成本高）；对话框玻璃底两层、标题/Backlog 单色底均为刻意简化。
2. **选择肢入场动画未做**：计划书标注"可选，别上花活"，刻意省略。
3. **序号角标并入标签文本**（`1. 选项`）而非独立角标元素：减少一层节点，点击热区/高亮逻辑与既有 `onSelect(opt.index)` 完全兼容。
4. **金币黄 `0xffd77a` 与战斗血条红绿保留**：功能/语义色（计划书 §2 硬约束②），不算装饰暖色。
5. **占位背景色相限定冷色带（190°..310°）**：哈希 mod 120 + 190 偏移，刻意牺牲"全色相多样性"换夜色蔚蓝气质统一；同 key 依然稳定同色同图。
6. **标题画面悬停高亮条是 pointerover/out 切换可见性**，非补间动画：与"别上花活"口径一致。
7. **指示器 x 定位修复属顺带发现**：原代码 x 从未赋值（git 历史可查 `9b99e47` 版 `continueIndicator` 相关行），非本批引入的回归；现定位右缘 68px 处。
8. **横幅淡入改变 alpha 初始值**（1→0 起步）：若宿主在横幅期间读档/跳场景，行为与原先一致（remain 归零即隐藏），无状态泄漏。
9. **无新增单元测试**：本批全为视觉层；计划书 §6.3 明确"随目检"。既有 renderer 112 组测试（含 pixi-stage 素材注入 6 组 headless 断言、nvl 排布 10 组）全过即回归证明。占位背景同 key 契约靠 seededRandom 构造保证（确定性函数，可单测但未测——若审阅认为必要可补）。
10. **系统覆盖层（鉴赏/战斗/商店等）配色改动超出计划书 §3-§5 枚举范围**：为兑现 §2 硬约束①"清除 0xffe8c8 遗产"而全域清零，仅改颜色常量、零布局零逻辑改动。

## 4. 已知限制

- starter 剧本 `@bgm tense_01` 无对应音频素材，进入游戏时 Howler 打一条 warn（`No file extension was found...`）——**早于本批存在**（音频 0 条目的占位行为），与画面改动无关。
- 占位背景样式变更不影响纹理缓存键，但**验收时请强刷页面**（旧 canvas 纹理在缓存里直到刷新）。
- NVL/Backlog 的断行仍是字数口径（wrapCjk），像素测量只在对话框——沿用 AB 批取舍，本批未动。

## 5. 手动验收（用户在预览里亲眼看，一条一条问）

> 宿主二选一：`npm run dev -w surdet-starter`（localhost:5173）或编辑器预览标签。下面步骤按 starter 写。

1. **对话框观感**：开始游戏，推进 ch01_01——底部对话框应为深蓝玻璃质感（隐约透出背景）、有细描边和顶沿一条亮蓝细线；说话人"凛"在左上角深蓝名牌里；正文行距比原来宽、白字带轻微投影。
2. **选择肢**：推进到选项（拔剑/沉默）——两张深蓝卡片带数字序号；键盘 ↑↓ 切换时高亮卡片有亮蓝描边和左侧竖条；数字键 1/2 直接可选；鼠标悬停同样高亮；点击后剧情正常继续。
3. **占位背景**：背景应为冷色调（蓝/青/紫）渐变、四周比中央暗、带细微噪点；**回标题再进游戏 / 读档回同一场景，背景应与之前完全一致**（不闪不变）。
4. **标题画面**：刷新页面回标题——深黑蓝底、大字距冷白标题、标题下一条亮蓝细线；鼠标悬停菜单项时左侧出现亮蓝竖条、文字提亮右移。
5. **章节横幅**：starter 现剧本无 @chapter/@tip 常驻调用，需临时剧本验证——新建临时 .gal 加 `@title 测试横幅` / `@tip 小提示` 并临时改 game.config.json `entryScene`，验后**必须还原 entryScene 并删除临时场景**（交接纪律）；预期：title 变体上下黑边 + 大字距渐显渐隐，tip 变体右上小胶囊。
6. **NVL 与 Backlog**：NVL 同样需临时剧本 `@nvl`（验后还原）；Backlog 按 **L** 键——深蓝底、标题冷白、说话人亮蓝；滚轮可滚、点击任意处关闭。
7. **回归抽查**：打字机逐字显示正常；Ctrl 快进正常；F5 存档/读档正常（缩略图可见）；H 键隐藏界面赏画、再 H 恢复；指示器为右下角呼吸小光点（不再是三角、不再贴左缘）。

## 6. 审阅报告格式（回传给开发方）

```
【RUNTIME-UI 批次审阅报告】
基线复核：typecheck / test(603) / lint / simulate / build —— 逐项 通过/失败
交付复核：对照 §2 三提交确认"不改 DSL/core/编辑器/text-wrap，断行逻辑零改动"（diff 逐提交）
硬约束核查：grep 0xffe8c8 计数为 0；wrapCjk/wrapCjkMeasure 文件 diff 为空；registerBackground/registerPortrait 路径未动
问题清单：[Major/Minor] 描述 + 位置（没有就写"无"）
误报自查：已对照 §3"有意为之"排除设计取舍
```

## 7. 环境提示（给审阅 AI）

- 仓库根目录为 `E:\surdet`；git 路径不带 `surdet/` 前缀。
- Windows + pwsh：终端中文常 GBK 乱码（文件内容是好的），判断用文件读取；过滤 ANSI 先 `-replace "`e\[[0-9;]*m", ''`。
- 测试命令用 `npm run test`（勿用 `npx vitest run`，会挂 watch）。
- 浏览器冒烟可用 Browser 子代理访问 localhost:5173（starter dev）。
