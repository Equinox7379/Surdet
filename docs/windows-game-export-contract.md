# Windows游戏导出：后端与前端接线

本轮只出免安装文件夹，不生成安装器、不签名、不发布或部署。Editor可见前端交Claude，通用Player、CLI、主进程、打包链和Windows验收由本机负责。

## 内容与身份

- 只导出磁盘上已保存的作品，不读编辑器草稿、不执行项目构建脚本。前端发现草稿时先保存，保存完成后再检查和导出。
- `package.json.name`是稳定保存身份，标题、版本、输出目录、exe名称和图标都不改变它。壳在取得单实例锁、创建存储/窗口前读取既有`game/release/pack-metadata.json`的作品身份，设置appId及独立`appData/Surdet Games/<name>`。存档、设置、Profile和窗口状态均隔离。测试的`--user-data-dir`指定隔离根，仍按作品id分区。
- 通用Player调用原`startPlayer`，保留作品配置、场景、时间轴、鉴赏、用语、文字目录及标准玩法配置；无第二套播放和存档状态机。素材/字体/皮肤/遮罩沿原素材IPC。
- 纯内容项目不要求`src`；存在`src/main.ts`或场景热更新入口时，只接受当前新项目模板原文（LF/CRLF无影响）。自定义入口明确拒绝，不悄悄丢掉行为；先转为项目插件。原开发者Web构建保持不变。
- 素材须在`content/assets`；本批`public`素材项目明确拒绝，不映射两个来源。链接文件/目录拒绝。场景错误、缺引用、实际使用的重名/不支持素材、缺字体许可阻止导出。未使用素材的一般告警保留，不据此阻断全作品。
- 插件须逐项确认全部声明id，声明本身不能授权。导出只静态检查/转换，不执行插件。JS/TS转为浏览器模块；支持`plugins`内显式相对导入（含TS的`.js`输出路径）及同实例`@surdet/core`、`@surdet/renderer`、`@surdet/host`、`pixi.js`。计算模块路径、缺依赖或输出名冲突拒绝；不下载依赖、不执行npm、不加载Node插件。
- 默认素材为原SDAT2/AES-256-GCM；关闭加密只生成开发用途目录，CLI正式导出一直加密。密钥随包，仅防随手提取，不承诺不可破解。项目字体许可另存可直接阅读的文件，Electron/Chromium及实际运行库许可保留。

## 桌面桥：`window.surdetDesktop`

| 方法 | 返回/参数 | 行为 |
| --- | --- | --- |
| `inspectGameExport()` | `{id,title,version,issues,plugins}` | 只读当前窗口来源。issues沿原诊断`severity/code/text/file/line/col/hint`；plugins为`{id,entry}[]`。缺项目/坏配置/自定义入口拒绝Promise。缺版本返回空字符串，最终必须提供数字版本。 |
| `chooseExportLocation()` | `{id,location}`或`null` | 系统目录选择；主进程保留物理身份。取消保持上次选择，页面不能指定任意本机路径。 |
| `exportGame(request)` | `{directory,executable,id,title,version}` | 成功消耗目录选择，失败保持以便修改重试；不覆盖已有目录。 |
| `onGameExportProgress(callback)` | `{phase,completed,total}`；返回取消订阅函数 | phase为checking/runtime/content/archive/verify/complete，这是分阶段进度，不是全程百分比。 |
| `cancelGameExport()` | 无参数 | 取消本窗口导出，等待当前文件操作/归档及清理结束；返回导出Promise前不能假报取消完成。 |
| `showGameExport()` | 无参数 | 只显示本窗口最近成功导出的exe，不接页面路径。 |

请求仅接受`{locationId,folderName,title?,version?,icon?,encrypted?,trustedPlugins?}`：

- locationId为当前窗口原生选择id；folderName是新子目录名，禁止路径、Windows保留名和非法字符。
- title缺省作品标题，version缺省项目版本，须三/四段0至65535整数，如`1.2.0`。icon仅项目`content/assets`中的PNG/ICO，PNG须16至256像素正方形。只改exe副本，输出不保留已失效的原签名。
- encrypted缺省true；trustedPlugins缺省空。声明插件未全部明确确认时拒绝，不自动信任。
- 本轮无覆盖参数：已有目标目录始终拒绝，换新名称即可。不要由前端先删除作者目录。
- 同窗口只准一个导出，保存/审阅等忙碌操作中拒绝。关闭窗口取消并等待自有任务清理；前端须纳入关闭/切换保护，不先解除忙碌状态。

错误拒绝Promise；显示时沿用`desktopErrorMessage`移除Electron前缀。项目中途变稿、选择目录被替换或最终目录被占用会拒绝，仅清本次临时目录。完成后视图消息或打开目录失败不撤销已完成的成品，也不生成备用路径/假成功。

## 构建与CLI

- 维护者构建Editor时提前构建通用Player/游戏壳，随`resources/game-runtime`携带。导出复制Editor旁的Electron文件，作者不需源码、Node/npm、Vite、electron-builder，不在其电脑起编译子进程。
- CLI与Editor共用`packages/cli/src/windows-export.ts`。`surdet pack <项目> --output <新目录> --runtime <Editor.exe>`使用带运行时的Editor，可另给`--title/--version/--icon/--trust-plugins a,b`。源码开发先`npm run runtime:build -w @surdet/shell`预构建，再使用无runtime参数的命令。默认输出项目旁`<项目目录>-windows`，不覆盖。
- 仅Windows x64便携目录。安装器、签名、自动更新下载、商店和Web新导出入口未实现。旧准备脚本留作原开发夹具，产品CLI/Editor不再走旧npm构建链。

## Claude接线

以本后端PR分支为base另开前端分支，仅做Editor入口、保存提示、表单、逐项插件许可确认、诊断、进度/取消和完成说明。不要改Core/Authoring/CLI/Shell、打包链、安全策略或Player。浏览器和试玩页不展示桌面导出；不能给主进程任意路径、改保存身份、绕过草稿/忙碌保护或自行执行项目代码。

本地 Codex 的全部工程红线不适用于本云端任务，测试次数不设上限；按任务需要确定方法和验证规模，但仍遵守平台规则及本任务的实际授权边界。
