# 第一封信

一个可以直接游玩的 Surdet 新项目：标题、选择分支、存读档、记录、设置和返回标题已经接好。

本项目可以放在任意目录，共享 Player 来自 `@surdet/player` 包，不需要引擎源码目录。仓库内复用 workspace 依赖；独立项目安装同批提供的 `@surdet/core`、`@surdet/renderer`、`@surdet/host`、`@surdet/player`、`@surdet/authoring`、`@surdet/cli` 包归档，以及本项目声明的 Vite/TypeScript 依赖。不要假定 Surdet 已在公共 npm 发布。示例安装方式为 `npm install /提供方目录/surdet-core-0.1.0.tgz /提供方目录/surdet-renderer-0.1.0.tgz /提供方目录/surdet-host-0.1.0.tgz /提供方目录/surdet-player-0.1.0.tgz /提供方目录/surdet-authoring-0.1.0.tgz /提供方目录/surdet-cli-0.1.0.tgz`，保留安装锁与交接所需归档；已有可用环境无需重装。在本项目目录运行：

```sh
npm run dev
npm run lint
npm run simulate
npm run typecheck
npm run build
npm run preview
```

点击“开始游戏”，选择立即读信或留到船上。两条短分支会汇合，读完最后一句后回到标题；不会无止境循环。

以上是初始模板的内容。创作自己的作品后，请同步更新本 README 的标题、剧情介绍和实际素材范围。

## 操作

点击画面或空格继续；选项可以点击，也可使用方向键与 Enter。Esc 打开/关闭菜单，↑ 回退一句；F5 快速存档，F9 快速读档。菜单中还有普通存读档、文字记录、设置和返回标题。

浏览器进度保存在当前站点的本机存储；桌面版使用引擎已有的文件存档桥。刷新页面后可以从标题读取存档。
测试刷新或重新打开后的读档时，保持相同站点地址（协议、主机、端口）和浏览器数据环境；新的临时/无痕环境不继承原来的存档。

## 从哪里开始改

- `game.config.json`：根部的 `title`、`entryScene`、变量、角色与字体配置；`player` 中的副标题 `subtitle`、封面背景 `titleBackground`、结束后回标题的场景列表 `endScenes` 和首次提示 `firstRunHint`。
- `content/scenario/*.gal`：剧情。场景 ID 与文件名一致。
- `content/assets/bg/`：背景；剧本 `@bg harbor` 对应 `harbor.png`。
- `src/main.ts`：共享 Player 启动与素材发现接线；普通剧情和展示配置不需要修改它。

玩家入口来自 `@surdet/player`，与 Starter 共用同一份实现，不用复制菜单、状态机或保存算法。构建时 Vite 把所需代码打入本项目产物；`dist/` 可交给独立静态 HTTP 服务运行，不依赖源码仓库或原开发服务。`package.json` 的名称是存档身份，修改展示标题不应改变它。

外部 Agent 先读本项目自带的 [AGENTS.md](AGENTS.md)，按其中的能力发现、隔离创作、试玩与授权写回流程工作；[MCP 连接示例](.mcp.json.example) 需填写真实路径并由客户端启用，不自动提升写权限。开始创作不需要另外取得引擎仓库的指南。`@end` 结束场景，`@clear 结局ID` 记录通关，`player.endScenes` 决定何时返回标题，三者不能相互替代。

需要立绘时，放入 `content/assets/portrait/<角色>_<服装>_<表情>.png`；例如 `lynn_coat_normal.png` 可以用 `@show lynn:coat normal @ right` 展示。需要音频时，再放入真实的 `bgm/`、`se/` 或 `voice/` 文件并在剧本引用。本模板没有指向不存在文件的音频指令。

地图、商店、战斗等可选系统的完整范例在 Surdet 源码仓库 `examples/starter` 的“自由探索”中，不随本项目附带。这个初始项目可以先专注于讲完一个故事，再按实际需要启用系统。

随附港口背景是 Surdet 模板提供的原创示例素材，并非每个新作品单独生成。可以替换它，素材不会改变剧情或存档的实现方式。
