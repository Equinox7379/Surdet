# U1：作品界面样式后端合同

Authoring 2.39.0，公开能力仍为 73 项。延续 `game.config.json.ui.version = 1`、`project.ui` 和 `project.ui.patch`，没有新样式语言或任意 CSS 入口。

**U1数据、几何、读写、资源链与前端绘制已随#58/#80合入。** 技术示例不等于默认美术定稿；U2状态和页面动效另见[交互合同](ui-interaction-contract.md)，其前端仍待接入。

## 读取与写入

- `project.ui({view:"project"|"working"})` 返回原始 `value`、默认页面、节点和原有修改依据。`nodes[]` 新增 `effectiveStyle`、`rect`、`contentRect`；坐标均为 1280×720 设计空间，相对父内容框定位。
- `effectiveStyle` 给出当前作品主题下的缺省值，原始 `value` 保留字段是否省略、明确清空和数值 0 的区别。`fontWeight/lineHeight/padding` 的有效值可为 null，意为保留既有控件的浏览器默认行为，并非 0。
- 继续使用 page.set/remove、node.insert/update/remove/copy/reorder。`node.update.patch.style` **整体替换**该节点的 style，不是逐字段合并；先读 working 再修改，未打算改的字段保留。`patch.style:null` 删除整个 style，恢复继承。
- direct 才可写，candidate/integration 在业务修改前拒绝。旧修改依据、非法值、未知字段、缺失/重名图片、图片读取失败或切片越界均在操作落盘前拒绝。复用既有事务和操作编号，不新增身份、摘要或兼容层。
- `project.ui` 是配置读取，不是图片解码证明。`project.validate`、CLI lint 及 Windows 导出前检查会读取当前切片图片的真实字节；静态 Editor 校验仍只有提供给它的文件事实，不能代替这些物理检查。

## `ProjectUiNode.style` 字段

现有 color/background/opacity/fontSize/align/fontRole 保留原义。新增字段全部可省略：

| 字段 | 合同 | 明确清空或特殊值 |
| --- | --- | --- |
| fontWeight | 100、200…900 的整百字重 | 删除字段恢复控件默认 |
| lineHeight | 0.5..4，字号的倍率 | 删除字段恢复默认；非像素值 |
| letterSpacing | -32..128，设计像素 | 0 为无附加字距 |
| textShadows | 最多 4 项 `{x,y,blur,color,opacity}` | `[]` 无文字阴影 |
| backgroundOpacity | 0..1，只影响背景颜色/渐变/图片三层 | 0 为透明背景，正文仍可见 |
| backgroundGradient | `{from,to,angle}`，两个 RGB 整数颜色；angle 0..360 | null 无渐变；0 度向上，顺时针 |
| backgroundImage | `{asset,fit,slice?}`，asset 是项目背景素材键 | null 禁用继承的按钮皮肤 |
| border | `{width,color,opacity}`；宽 0..256 | null 无边框；宽/透明度 0 有效 |
| borderRadius | 0..65535，设计像素 | 0 为直角 |
| padding | `{top,right,bottom,left}`，四边都必须提供，非负设计像素 | 四个 0 清空作者内边距 |
| shadows | 最多 4 项 `{x,y,blur,color,opacity}` | `[]` 无框体阴影 |
| columns | 沿用 #79 的 content 列数：1 或 2 | 省略为单列；只适用于 content |
| imageFit | 沿用 #79 的图片内容缩放：contain/cover/fill | 省略为 contain；只适用于 image，与装饰背景的 fit 独立 |

RGB 为 0..0xffffff 整数，透明度为 0..1；阴影 x/y 为 -4096..4096，blur 为 0..256。所有数值须有限。padding 各边上限 65535；边框及内边距不能吃掉整个内容框。渐变固定两色，没有任意 stops、CSS 字符串、URL 或脚本。

背景叠放从下到上：颜色 → 渐变 → 图片。`backgroundOpacity` 一起作用于这三层，`opacity` 作用于整个节点。配置图片不得是网络地址或任意文件路径。普通图片 fit 为 stretch/contain/cover，contain/cover 居中；image 节点自身的 `asset` 仍是内容图，与装饰背景分开。

### 九宫格

```json
{
  "backgroundImage": {
    "asset": "对话框",
    "fit": "stretch",
    "slice": { "top": 16, "right": 24, "bottom": 16, "left": 24, "fillCenter": true }
  }
}
```

- slice 只适用于 stretch，四边是**实际图片的原图整数像素**，不是设计画布或屏幕像素。必须显式给 fillCenter。
- 左右之和严格小于原图宽，上下之和严格小于原图高，必须留下中心区域。调用方不得把配置自报的宽高当作实图尺寸。
- Authoring 用 `image-size` 从项目安全读取器提供的字节读取尺寸；JPEG 按 EXIF 方向调整宽高。多个候选尺寸无法确定主图时明确拒绝切片，不挑最大图片猜测。此检查不等于完整图片解码或画面验收；解码失败仍由原资源加载链报错。
- `projectUiNineSlice(actualSize,targetRect,slice)` 返回每块的 source/target 矩形。小目标以同一个系数缩小四边，使边角不交叉、不产生负宽高；fillCenter=false 时没有中心块。整体画布缩放在这之后做一次。

## 默认值与前端消费顺序

`resolveProjectUiStyle(node,config,explicitPlayerTheme?)` 复用 `resolvePlayerTheme`：引擎默认 → 作品主题 → Player 显式主题字段 → 节点 style。不能用 truthy 判断覆盖：0、null 和 [] 都有明确含义。节点不继承父节点 style；沿用既有节点定位和全局字体角色表。

- 原有默认：文字色 theme.text；字号 theme.uiSize、字体角色 ui；正文行高 1.45；按钮字重 600、surface 底色、1px line 色边框、theme.radius.md 圆角，以及主题 buttonSkin。未指定的新阴影/渐变为空、字距 0。
- progress 轨道有效值与 Player 既有绘制一致：surface 底色、theme.radius.sm 圆角；作者显式背景色和圆角（包括0）优先。前端不再另造一套轨道默认值。
- `effectiveStyle` 的 null 字重/行高/内边距保留旧控件行为，不把它硬编码成新的 400/0；本批不擅改旧页面。
- 玩家文字倍率在作者字号与行内字号确定后应用一次，仍只影响阅读正文/选项，不放大系统页或名字栏。行内样式继续由 Core 解析，不展平成纯文字，不重复执行文字记录中的停顿/动画。
- U1 没有动画字段，不能从阴影/渐变自行生成动画；已有减少动态设置继续优先于后续前端动效。
- `projectUiRect` 给出布局/交互外框，装饰阴影不能扩大点击区。`projectUiContentRect` 扣掉**显式作者**边框/内边距；`projectUiChildrenRect(rect,type,style)` 再扣 tabs 的 38px 标题栏。UI 检查返回的是这组作者内容坐标，不宣称测到了未设置 padding 的原生控件内部文字边界。
- 新前端须让绘制、子节点放置、裁剪、滚动及输入命中共用同一内容框，避免 CSS padding 和坐标公式重复扣除。没有新样式时保留原排版；不得把 nullable 原生默认当成新排版数值。

## 素材、分享和导出

`projectUiAssetKeys` 收集图片节点与任意深度的 style.backgroundImage；重复键去重，null 不产生引用。素材目录能列出具体节点用途，索引有反向引用，改名只改实际 asset 参数，不全文替换正文、节点 ID 或相同字样。

候选仍不能修改 UI，但场景/时间轴候选必须记录基线 UI、主题、标题背景/字标、字体等既有实际依赖。缺图在候选操作持久化前拒绝；不能只在最终播放时才发现。

已有 `surdet-ui` 本地分享保留新 style 与实际图片；片段继续继承目标作品的主题/字体，整套主题保留原字体依赖规则。九宫格在分享输出及包读取时按随包图片校验；字体角色、翻译对象 ID、文字记录字段、保存格式和分享格式版本未改变。

Windows 导出仍走现有内容收集/配置写入，没有第二套样式清单。定向归档病例可证明配置和图片进入 app.asar，不等于打包 Player 已实现 U1 绘制。

## 本批验证与接手边界

主代理验证 Core 有限数据与几何、公开 Agent Port 读写/失败原子性、Editor 共享保存事务、素材引用/改名及候选依赖、分享包、Windows 导出前拒绝和归档内容。具体命令与结果在原任务台账和 PR，未做本地全仓回归或泛化冒烟。

Claude 后续从本后端 PR 分支接 UI：有限控件、样式有效值/恢复继承、DOM/Renderer 实际绘制、九宫格与小尺寸、字体倍率、默认外观不变、键盘与滚动，以及同一配置保存/重开/分享/试玩。不要改字段名、资产合同或权限，也不要提前做 U2 状态/动画。完成后由本机核对 Windows 实际画面。

本地 Codex 的全部工程红线不适用于本云端任务，测试次数不设上限；按任务需要确定方法和验证规模，但仍遵守平台规则及本任务的实际授权边界。
