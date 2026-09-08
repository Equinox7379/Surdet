# 第一封信

一个可以直接游玩的 Surdet 新项目：标题、选择分支、存读档、记录、设置和返回标题已经接好。

在引擎仓库根目录执行 `npm install` 后，可以在本项目目录运行：

```sh
npm run dev
npm run lint
npm run simulate
npm run typecheck
npm run build
npm run preview
```

点击“开始游戏”，选择立即读信或留到船上。两条短分支会汇合，读完最后一句后回到标题；不会无止境循环。

## 操作

点击画面或空格继续；选项可以点击，也可使用方向键与 Enter。Esc 打开/关闭菜单，↑ 回退一句；F5 快速存档，F9 快速读档。菜单中还有普通存读档、文字记录、设置和返回标题。

浏览器进度保存在当前站点的本机存储；桌面版使用引擎已有的文件存档桥。刷新页面后可以从标题读取存档。

## 从哪里开始改

- `game.config.json`：标题、入口场景、变量、角色与字体配置。
- `content/scenario/*.gal`：剧情。场景 ID 与文件名一致。
- `content/assets/bg/`：背景；剧本 `@bg harbor` 对应 `harbor.png`。
- `src/main.ts`：标题副标题、结束后回标题的场景列表，以及素材发现规则。

玩家入口来自引擎仓库的 `examples/shared/player/player.ts`。这个项目位于 `games/<项目名>` 下，与 Starter 共用同一份入口实现；不用复制菜单、状态机或保存算法。构建时 Vite 会把所需代码打进本项目的产物。

需要立绘时，放入 `content/assets/portrait/<角色>_<服装>_<表情>.png`；例如 `lynn_coat_normal.png` 可以用 `@show lynn:coat normal @ right` 展示。需要音频时，再放入真实的 `bgm/`、`se/` 或 `voice/` 文件并在剧本引用。本模板没有指向不存在文件的音频指令。

地图、商店、战斗等可选系统的完整范例见 `examples/starter` 的“自由探索”。这个初始项目可以先专注于讲完一个故事，再按实际需要启用系统。

随附港口背景为本项目生成的原创示例素材。可以替换它，素材不会改变剧情或存档的实现方式。
