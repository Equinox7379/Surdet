# 未命名作品

这是空白 Surdet 项目，只有一个可运行的起始场景；没有示例角色、变量、背景或音频。默认菜单、存读档、阅读与返回标题仍由共享 Player 提供。

## 准备与运行

项目可以放在任意目录，不需要 Surdet 源码。玩家入口来自 `@surdet/player` 包；安装同批提供的 `@surdet/core`、`@surdet/renderer`、`@surdet/host`、`@surdet/player`、`@surdet/authoring`、`@surdet/cli` 包归档及项目声明的 Vite/TypeScript 依赖。不要假定这些包已经发布到公共 npm。

在引擎仓库内开发时复用 workspace 依赖；独立项目按包提供方的路径安装归档，例如 `npm install /提供方目录/surdet-core-0.1.0.tgz /提供方目录/surdet-renderer-0.1.0.tgz /提供方目录/surdet-host-0.1.0.tgz /提供方目录/surdet-player-0.1.0.tgz /提供方目录/surdet-authoring-0.1.0.tgz /提供方目录/surdet-cli-0.1.0.tgz`。全部相关归档在一次安装中提供，第三方依赖正常解析；保留安装锁与交接所需归档。已有可用依赖无需重装。

进入本项目后运行 `npm run dev` 预览，`npm run lint` 检查，`npm run simulate` 模拟，`npm run typecheck` 检查类型，`npm run build` 生成 Web 产物。`dist/` 可以由独立静态 HTTP 服务运行，不需要开发仓库或开发服务；不是要求双击 `file://`。

## 开始创作

- 在 `game.config.json` 配置标题、入口、角色和变量，在 `content/scenario/` 写剧本，普通创作不用修改 `src/main.ts`。
- 图片等资源放入 `content/assets/` 下对应类别目录；模板不引用不存在的资源。
- `package.json` 的名称是存档身份，展示标题可以另改。浏览器存档还取决于站点地址与浏览器数据环境。
- 点击或空格继续，Esc 打开菜单，F5/F9 快速存读，↑ 回退。初始场景结束后回到标题。
- 外部 AI 先读本项目自带的 [AGENTS.md](AGENTS.md)，使用 [MCP 连接示例](.mcp.json.example) 接入既有创作工具；确认差异与试玩后再授权写回，不直接覆盖来源。开始创作不需要另外取得引擎仓库的指南。
