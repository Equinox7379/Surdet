# 潮痕未干

一封迟到三年的信，把林汀带回了即将关闭的海边邮局。潮汐记录、未寄出的回信，以及旧友迟迟没有说出口的话，指向同一场风暴。

这是一部围绕悬疑与人物关系展开的中文视觉小说，主体由全新上下文的外部 AI 通过 Surdet 公开创作接口制作，经主代理审读、反馈修订和实际试玩。七个场景、三处选择、两个完整结局；选择影响人物信任、证据与最后的决定。

单条完整路线的可见正文约 7,700～7,900 字，正常初读预计 25～35 分钟。时长是估算，随阅读和选择速度变化；没有用强制等待补足时长。

## 游玩

在已安装依赖的 Surdet 仓库根目录运行：

```sh
npm run dev -w surdet-tide-mark
```

打开终端显示的本机地址，点击“开始游戏”。

- 点击画面或空格：继续对白；方向键与 Enter：选择选项。
- Esc：打开或关闭菜单；↑：回看上一句。
- 菜单中可以存档、读档、查看记录、调整设置和返回标题。
- F5 / F9：快速存档 / 快速读档。

进度保存在当前浏览器、当前站点的本机存储中；使用相同地址重开后可在标题页读取存档。

## 继续创作

在 Surdet Editor 中打开本目录即可继续编辑。剧情位于 `content/scenario`，角色和变量在 `game.config.json`，演出位于 `content/timelines`。

Player 入口复用仓库的 `examples/shared/player/player.ts`，菜单、输入和存读档使用同一份引擎实现。

```sh
npm run lint -w surdet-tide-mark
npm run typecheck -w surdet-tide-mark
npm run build -w surdet-tide-mark
```

## 素材来源

背景、立绘和头像复用 `examples/starter/content/assets` 的既有生成图像，来源和制作说明见该目录的 README 与 PROMPTS。所有人物均为虚构；同一组立绘仅用于同一角色。本项目没有新增图像或音频生产。
