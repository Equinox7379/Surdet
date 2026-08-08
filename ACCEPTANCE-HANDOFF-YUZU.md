# ACCEPTANCE-HANDOFF-YUZU：ADV 千恋万花式精致化（字体 + 无框 ADV + 居中选项 + 标题精修）（审阅交接书）

> 本文档写给**审阅本批次的 AI**。前置：先读 `SESSION-HANDOFF.md`（超级仓库/copy-edit-copy/审阅流程铁律）。
> 起因：用户反馈"夜色蔚蓝"后预览仍有 RPG Maker 味，拍板对标千恋万花（柚子社）：**现代黑体 + 无框 ADV + 选择肢居中 + 标题再精致化**。
> 本地提交 4 个（未推送）：`74428a6`（字体管线）+ `fb9a21f`（无框 ADV）+ `9bf3c1b`（选择肢居中）+ `764eab3`（标题精修）。推送时移植范围 `440062f..HEAD`。
> **状态：开发完毕，待审阅**。

---

## 1. 基线预期

| 检查 | 预期 |
|---|---|
| `npm run typecheck` | 全 workspace 0 error |
| `npm run test` | **603** 过（core 269 / cli 78 / renderer 112 / shell 19 / editor 125），0 failed |
| `npm run lint -w surdet-starter` | 4 场景 0 错 0 警 |
| `npm run simulate -w surdet-starter` | demo_end 可达、运行时错误 0、退出码 0 |
| `npm run build` | 全部包构建成功 |

开发期已全绿（五件套逐项实跑）。

## 2. 交付内容（4 提交）

### 提交一 `74428a6` 字体管线全接通（6 文件，含字体资产）
- `renderer/src/pixi-stage.ts`：`registerFont` 补 `#bannerText` 覆盖（长驻文本全覆盖；选择肢/标题/Backlog/NVL 等动态文本创建晚于字体加载，走 `TextStyle.defaultTextStyle` 自动生效）。
- `examples/starter/src/main.ts`：字体加载从 fire-and-forget 改 **await**（标题首帧即用正确字体，不再系统字闪变）；新增 `resolveFontUrl()` 对齐 loadAssets 双路口径（打包环境经 `window.surdetAsset` 主进程读取 → Blob URL；浏览器 dev 走 `import.meta.glob` fonts URL）；缺失打 warn 静默回退。
- `examples/starter/game.config.json`：新增 `"font": "content/assets/fonts/MiSans-Regular.otf"`。
- `examples/starter/content/assets/fonts/MiSans-Regular.otf`：**新增 6.3MB 字体资产**（小米 MiSans Regular，免费可商用，随 starter 入库保证克隆即所见）。
- `editor/src/panels/preview-panel.ts`：新增 `readProjectFont()`——解析 game.config 的 font 字段，File System Access 逐级句柄读取项目内字体文件（模块级缓存，key=项目目录+路径），以 `{ buffer: ArrayBuffer, mime }` 随 `surdet-preview-load` payload 下发；`send()` 改 async。
- `editor/src/preview.ts`：`LoadPayload` 增 `font` 字段；`load()` 改 async，先于剧情启动 `registerFont`（Blob URL 缓存：同字体不重复注册、换字体回收旧 URL）。
- 验证：浏览器冒烟 `document.fonts` 确认 `SurdetGameFont` status=loaded，标题/对话全程 MiSans 渲染，无 error；**字体缺失回退已实测**（临时移除字体文件强刷 → console warn「未找到字体文件，回退系统字体」、`document.fonts` 为空、游戏正常推进无 error，验后已还原）。

### 提交二 `fb9a21f` 无框 ADV 形态（pixi-stage.ts）
- `#drawDialogPanel()` 改为仅 `clear()` 不绘制：玻璃底/描边/强调线全撤；`#dialogPanel` 对象与全部可见性逻辑链路保留（冒烟确认 Graphics 指令数 0、bounds 0×0）。
- 正文/ruby 基字 dropShadow 加强（alpha 0.35→0.45、色深 0x04070d）作无框可读性兜底。
- 名牌改小薄片：字号 26→22、半透明深底 alpha 0.55、细圆角 6、去蔚蓝描边，贴正文区左上；显隐三态（空说话人/NVL/H 键）逻辑不变。
- 正文/名牌/ruby 层下移贴近底边（h-195→h-140）；行距 46、断行链路（wrapCjk/wrapCjkMeasure/字数容量）零改动。

### 提交三 `9bf3c1b` 选择肢居中（pixi-stage.ts）
- `#layout()`：选项列从对话框上方左对齐（x=90, h-320 起）改为画面中央纵列——每卡按自身宽度水平居中（w/2），纵列中心 h*0.42、步长 60。卡片样式/数字序号/蔚蓝描边/左侧强调条/键盘高亮交互全部保留。
- 轻入场淡入：`showChoices` 置 alpha 0 + `#choiceFadeRemain`，`updateEffects` 内逐卡错峰（第 i 张延 i*80ms，各 280ms 渐显）——既有 ticker 链路驱动，未新建 ticker。冒烟确认两卡中心 640±1px、alpha 归 1、键盘 ↑↓ 高亮正常。

### 提交四 `764eab3` 标题画面再精致化（pixi-stage.ts）
- 标题 logo 感：字号 60→64、字距 8→14；强调线 300×2 → 420×1、alpha 0.85→0.55；副标题加字距 4。
- 菜单弱化：字号 26→22、字距 6；悬停从"竖条+右移"改为文字下方 140px 细线滑入（无位移）。
- 轻径向暗角：5 层同心椭圆 stroke 叠 alpha 近似（不引 canvas 纹理）。

## 3. 有意为之（请勿误报）

1. **玻璃对话框被撤**：夜色蔚蓝批刚做的玻璃形态，本批按用户新决定迭代为无框（对标柚子社）——方向迭代，非返工事故；`#dialogPanel` 与可见性链路刻意保留不重构。
2. **dropShadow 是单层不是双层**：计划书写双层，但本 pixi 版本 `TextStyleOptions.dropShadow` 类型仅 `boolean | Partial<TextDropShadow>`（TS 实锤），收敛为单层加强参数。
3. **字体二进制入库**（6.3MB otf）：starter 是"克隆即所见"的验收基准项目，字体是画面的一部分；MiSans 授权允许再分发与商用。
4. **编辑器预览 postMessage 每次下发字体 ArrayBuffer**（数 MB 结构化克隆）：本地宿主成本可接受；宿主侧有模块级读取缓存，重复播放不重复读盘；不用 transferable 是为了保住缓存 buffer 不被 detach。
5. **预览字体识别键 = byteLength|mime**：同项目反复播放不重复注册；极端情况（同字节数同 mime 的不同字体文件）不会重注册——边缘场景，刻意接受。
6. **标题悬停无位移**：上一批的"竖条+右移"按本批设计改"下方细线"，更含蓄；右移逻辑刻意移除。
7. **选择肢淡入依赖 updateEffects**：无 ticker 接线的宿主卡片会停在 alpha 0——两个既有宿主（starter/编辑器预览）均已接线，可接受。
8. **无新增单元测试**：本批全为视觉层与宿主接线；既有 603 组测试全过即回归证明（含 pixi-stage 素材注入 6 组 headless、nvl 排布 10 组）。

## 4. 已知限制

- starter 剧本 `@bgm tense_01` 无音频素材的 Howler warn 早于本批存在，未处理。
- MiSans 单字重，加粗为合成粗体（faux bold）；要更精致可后续加 Medium 字重双载。
- 无框模式在真实亮色素材上的可读性靠单层阴影兜底，未做自动检测/暗 scrim（计划书口径：目检觉得不可读再补）。
- NVL/Backlog/各系统覆盖层维持夜色蔚蓝口径，本批未动。

## 5. 手动验收（用户亲眼看，这次字体效果一眼可判）

宿主：`npm run dev -w surdet-starter`（localhost:5173，dev server 开发期一直开着）。

1. **字体（核心）**：强刷后标题、对话正文、说话人、选择肢、横幅应全部是 MiSans 黑体（干净现代感，非系统微软雅黑）；console 应有「[starter] 自定义字体已加载」info。
2. **编辑器预览字体**：编辑器打开 starter 项目（打开目录需真人手势，自动化代替不了）→ 预览标签播放——预览里的字体也应是 MiSans（不是系统字）。
3. **无框 ADV**：对话时底部无任何矩形面板/描边，冷白正文带柔和阴影浮在背景上；说话人名字在一个很小很淡的深色薄片里；右下角仍有呼吸小光点。
4. **选择肢**：推进到拔剑/沉默——两张卡片位于**画面正中央**纵列，出现时有逐张淡入；键盘 ↑↓ 高亮、数字键/点击可选。
5. **标题画面**：大字距大标题、下方一条很长很细的淡蓝线、菜单字较小字距宽、画面四周轻微暗角；悬停菜单项时其下方出现短细蓝线（文字不动）。
6. **回归抽查**：打字机/Ctrl 快进/存读档（缩略图）/L 键 Backlog/H 键赏画/指示器光点；读档回同场景背景不变。
7. **字体缺失回退**（可选）：临时把 game.config.json 的 font 字段删掉刷新——应打 warn 并用系统字正常游戏，不白屏（验后恢复）。

## 6. 审阅报告格式（回传给开发方）

```
【YUZU 批次审阅报告】
基线复核：typecheck / test(603) / lint / simulate / build —— 逐项 通过/失败
交付复核：对照 §2 四提交逐提交 diff；确认断行链路（text-wrap.ts）零改动、素材注入路径未动、NVL 排布参数未动
管线核查：字体缺失回退路径存在（starter warn / 预览 null）；预览 postMessage 协议向后兼容（font 缺省可播）
问题清单：[Major/Minor] 描述 + 位置（没有就写"无"）
误报自查：已对照 §3"有意为之"排除设计取舍
```

## 7. 环境提示（给审阅 AI）

- 仓库根目录为 `E:\surdet`；git 路径不带 `surdet/` 前缀。
- Windows + pwsh：终端中文常 GBK 乱码（文件内容是好的），判断用文件读取；过滤 ANSI 先 `-replace "`e\[[0-9;]*m", ''`。
- 测试命令用 `npm run test`（勿用 `npx vitest run`，会挂 watch）。
- 浏览器冒烟：starter localhost:5173；编辑器 `npm run dev -w surdet-editor`（5174 起）。
