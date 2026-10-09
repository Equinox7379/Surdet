# 用 Surdet 创作这个项目

本目录是游戏作品，不是引擎源码。先读本文件和 [README](README.md)，沿用默认 Player/UI；普通剧情、美术引用和展示配置不修改 `src/main.ts`、引擎包或 `node_modules`。当前任务的明确要求优先，已有内容先读取再改。

## 接上创作工具

1. 使用 Node 24 或更新版本，按 README 准备同批 Surdet 包和项目依赖；已有可用环境不要重装，不假定公共 npm 已发布这些包。
2. 如果客户端已经提供 `surdet_*` 工具，先调用 `surdet_session_describe({})` 核对作品、权限和活动草稿，不重复启动第二个服务。
3. 尚未接入时，使用 [MCP 配置示例](.mcp.json.example)。把 `<SURDET_CLI_DIR>` 替换为已安装的 `@surdet/cli` 包目录，把 `<PROJECT_DIR>` 替换为本游戏根目录，均使用绝对路径。可在项目目录运行 `node -p "require.resolve('@surdet/cli/package.json')"` 定位包，再去掉末尾的 `package.json`；找不到时先完成依赖准备。JSON 路径建议用 `/`，含空格路径仍作为一个数组元素，不另加引号。
4. 示例使用常见的 `mcpServers` 格式，不会自动启用。按客户端的 MCP 设置导入；不支持此格式的客户端填写相同命令 `node` 和参数数组。客户端须能找到 Node，否则将 `command` 改为本机 Node 可执行文件的绝对路径。服务通过标准输入/输出通信，不是浏览器网址，也不是 `surdet agent mcp` 子命令。

示例固定 `--policy stage`：可以写隔离草稿，不能写回来源。不要为了绕过报错自行改成 `apply`。需要从项目外导入素材时，由操作者在参数数组末尾追加 `"--asset-source", "<已授权素材目录的绝对路径>"`，多个来源可重复追加。工具不可用时说明缺少的接入条件，不能假称已调用工具或偷偷覆盖来源文件。

## 最短创作流程

1. **先发现。** `surdet_session_describe({})` 后调用 `surdet_capabilities_describe({"detail":"summary"})`。只为本次要用的能力取完整合同，例如 `{"ids":["scene.create","scene.patch","object.inspect"],"detail":"full"}`。这里的 ID 用点号，实际 MCP 工具名用下划线；按返回的 `mcpTool`、输入 schema、示例和修复提示调用，不靠猜测。能力目录不代表当前会话有权限。
2. **读当前内容。** 用 `project.inspect`、`project.assets`、`object.inspect` 等公开入口。来源用 `view:"project"`；已有草稿用 `view:"working"`。先看入口、变量、角色、素材，再按需读取场景及子对象，不假定模板一定有某个角色或背景。
3. **在同一草稿创作。** 没有活动草稿才 `change.begin`，普通作品明确 `compositionMode:"direct"`（不是启动参数，也不表示拥有写回权限）。修改用 `scene.create`、`scene.patch`、`variable.ensure` 等已有能力；读取返回的对象引用与修改前提原样使用，不自行生成。变量、角色与素材依赖先准备，再写引用。
4. **定向验证与返修。** 对活动草稿调用 `project.validate`、`project.simulate`；需要具体路线时用 `runtime.run-from` 指定场景、选择和变量，失败轨迹用 `runtime.read-trace` 读取。模拟预算耗尽或路线没覆盖不能记为通过。根据错误 `code/details/repairActions` 修正后继续原草稿，不为每次返修另建一个。
5. **看差异和真实画面。** `change.diff` 后，在已安装、绑定本项目的 Surdet Editor 中选择同一个 `working-change` 试玩。普通 `npm run dev` 读取已落盘的来源，不会自动显示隔离草稿；模拟、文字轨迹也不是画面验收。没有 Editor 或浏览器操作条件时如实说明未试玩，不伪造截图或验收结论。
6. **按权限交付。** `delivery.capsule` 可封装草稿事实，但普通 direct 胶囊不可组合，也不是批准结果或已写回游戏。只有操作者明确授权并在 `apply` 会话中，经现有证据检查后 `change.commit` 才能写回；候选组合的 integration 仍须原人类批准。交付后同步 README 的真实剧情、素材、启动方式和未完成项。

### 第一笔普通草稿示例

下列 JSON 是 MCP 请求，不是剧本文本。先确认没有活动草稿：

```json
{
  "name": "surdet_change_begin",
  "arguments": {
    "intent": "创作原创短篇的开场",
    "acceptanceCriteria": ["开场可运行，现有内容不被覆盖"],
    "initiator": "external-agent",
    "compositionMode": "direct"
  }
}
```

再创建一个不依赖图片、角色或变量的新场景；若 `opening` 已存在，应读取后修改或选择新的场景 ID，不覆盖它。此例不自动修改项目入口，`scene.create` 会补上结束指令：

```json
{
  "name": "surdet_scene_create",
  "arguments": {
    "operationId": "create-opening",
    "sceneId": "opening",
    "blocks": [
      { "kind": "text", "value": "雨停了，窗外传来脚步声。" },
      { "kind": "label", "name": "arrival" },
      { "kind": "text", "value": "门外的人没有敲门。" }
    ]
  }
}
```

### 遇错与中断后继续

- 普通创作中，一次确定操作使用一个 `operationId`。结果未知时先核对原操作状态，重试同一请求保留原编号；内容不同的新操作使用新编号，不靠换编号重复写入。素材导入等专门流程按其公开恢复合同处理。
- 修改后重新读取受影响对象；匿名行引用会随版本变化失效。优先沿返回的 `continuation.sceneRef` 重新取得子对象，不猜行号、不移除现有过期保护。
- 在项目已有创作记录中保存项目位置、`changeId`、当前进度和未验证项；没有记录时只建一份简短记录。重启服务时在原参数末尾追加 `--resume-change <changeId>`，使用原项目路径和原 Agent 数据目录；再查 `session.describe`，不要把草稿当丢失后重做。
- 获准写回时由操作者将启动策略改为 `apply`，并用同一个 `--resume-change` 续接；不要手工复制草稿绕过提交检查。保留失败回执，不自行删除锁或恢复材料。

## 内容位置与常见语义

- `content/scenario/<场景ID>.gal`：剧本，以 `@scene <场景ID>` 开始；普通行是旁白，`说话人：台词` 是对白。`@label 名称` 定义标签，`@goto 名称` 在本场景跳转，跨场景用 `@jump 场景ID.标签`；具体参数按公开能力示例编排。
- `game.config.json`：标题、入口、变量、角色、`player` 展示字段和 `theme` 外观。先 `project.inspect` 读取，再使用对应窄字段操作；不要把配置改动写进 Player 启动代码。
- `content/assets/`：图片、声音、字体等资源。实际 key 和立绘标识从 `project.assets` 读取；外部素材用既有 `asset.sources` / `asset.import.*` 流程，来源目录必须由操作者授权。素材导入写回与剧情草稿是两件事，先完成导入再新建剧情草稿，不引用不存在的文件。每项素材保留来源和许可，不擅自生成或替换任务未授权的资源。
- `@end` 结束场景，`@clear 结局ID` 记录通关，`player.endScenes` 决定何时回标题，三者不相互替代。`package.json` 的名称是存档身份，不因改展示标题而随意修改。

## 写回后的运行与交付

在本游戏目录使用 README 中的 `npm run lint` / `npm run simulate` 检查已保存内容，`npm run dev` 实际试玩；需要交付 Web 产物时 `npm run build`，通过 HTTP 服务访问 `dist/`。仅完成构建不等于已经试玩或验证桌面包。

按本次改动检查相关路线、演出与存读档；刷新或重开验证读档时保持同一站点地址和浏览器数据环境。交付写清：项目路径、`changeId`、当前是草稿还是已写回、实际通过与未验证的内容。不要把启动服务、模拟成功或胶囊生成说成完整游戏已验收。
