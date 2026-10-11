# 项目插件后端合同（成熟化第 10 项）

本批 Authoring 合同为 2.38.0，公开能力仍为 73 项。普通 Gal 不需要插件配置。
本文件给项目代码作者和 Claude 前端接线使用，不是插件商城、恶意代码沙箱或原 P9 八项玩法的完工证明。

## 声明与权限分开

`game.config.json.plugins` 缺省为 `[]`。每项：

```json
{
  "id": "letters",
  "entry": "plugins/letters.js",
  "apiVersion": 1,
  "stateVersion": 1,
  "instructions": [
    { "name": "letter_count", "blocking": false, "parameters": [{ "name": "amount", "type": "number" }] },
    { "name": "letter_panel", "blocking": true, "parameters": [], "modifiers": [{ "name": "title", "type": "string", "optional": true }] }
  ]
}
```

id、指令名、参数名使用小写字母开头的字母/数字/下划线。entry 必须在 `plugins/` 下，不接受绝对路径、URL、点段、查询串或 Windows 大小写重复入口。不能覆盖内置指令，也不能让两个插件声明同一个指令。位置参数按顺序；命名修饰符按名称；类型为 string/有限 number/boolean（仅 true/false）。带引号的 DSL 参数按 Core 实际规则解码。

声明 **不是执行许可**。没有 `enabled`、`trusted` 字段，也没有内容 Agent 注册/信任/代码写入能力。`project.inspect.plugins` 返回声明、参数和状态版本；`capabilities.describe` 的公开读取 Schema 描述同一形状。`project.validate` / `surdet lint` 检查参数；CLI 还检查入口文件存在，均不导入代码。

显式受信任宿主提供 `ProjectPluginLoadOptions = { trustedIds, loadEntry(entry), onFailure? }`。只调用获准 id 的 loader；缺失入口、API 不一致、未声明注册项、缺 handler 或状态声明不一致均明确拒绝。Player 的 `PlayerProject.plugins` 接受这个选项，普通 config 不能提供它。加载器属于宿主代码，由该宿主负责把入口解析成浏览器可执行模块；不提供隐藏的 Node 执行、自动安装依赖或运行构建脚本的通道。

## 单一运行入口

`@surdet/host` 的 `ProjectPluginHost.load(declarations, options)` 返回宿主。默认导出工厂函数返回：

```js
export default () => ({
  apiVersion: 1,
  state: {
    initial: 0,
    validate(value) { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('计数状态无效'); }
  },
  instructions: {
    letter_count({ amount }, context) {
      const next = context.getState() + amount;
      context.setState(next);
      context.setVariable('letterCount', next);
    },
    async letter_panel(values, context) {
      // 展示项目自己的面板，等待玩家真实完成后 Promise 才 resolve。
      // 在 context.signal 的 abort 中关闭面板、移除监听；不要直接推进 Interpreter。
    }
  },
  dispose() { /* 释放工厂持有的资源；最多调用一次 */ }
});
```

创建原 `createDefaultHost` 时，将 `plugins.adapters()` 加到既有 adapters；之后 `plugins.bind(interpreter, store, host, runtime?, rendererPluginHost?)`。无渲染需求的宿主可以省略后两项。共享 Player 已完成上述接线。

上例须在作品变量表显式声明 `letterCount: { "type": "number", "initial": 0 }`。可执行入口可直接写浏览器 ESM `.js`；TypeScript 入口由提供该能力的宿主模块加载器编译，不能把原始 `.ts` 字符串当作浏览器模块执行。Editor前端应沿现有用户选定目录的读取能力准备模块，不扩Node/Electron桥权限；暂不支持的加载方式明确拒绝，不自动安装编译器或忽略依赖失败。

`context` 提供 `getVariable/setVariable/getState/setState`、原生取消信号的窄接口和可选 RendererRuntime。JSON 状态读写隔离复制；变量使用原 VariableStore 类型和只读保护。指令结束、读档、重置或销毁后，原 context 不能继续修改状态。回调仍是受信任代码，不能据此承诺撤销其任意全局副作用。

- 非阻塞指令必须同步完成；返回 Promise 会停止剧情，不暗中启动后台写入。
- 阻塞指令复用原 system adapter 的单活动对象和 pause/resume/fail 生命周期；Promise 完成才续播，完成前不能存为可续接快照。完成后先释放当前操作，再执行下一指令，因此紧接 `@autosave` 也可工作。
- 异常进入 error，不绕过失败指令继续；普通恢复/调试不能把它当作完成。
- 禁用或未信任的插件不导入；到达所需指令时 `PLUGIN_REQUIRED`，停下且不能生成存档。无头模拟不执行项目代码，返回 incomplete / requires-extension；显式路径失败，目标路径返回 requires-extension，不伪造后续变量、结局或通过证据。

## 状态与恢复

state 存在时声明正整数 `stateVersion`；无状态插件不声明。可选 `state.save(state)` 生成保存值，`state.restore(saved)` 返回恢复后的 JSON 值。两者与 validate 均是 **纯 codec**，不得修改当前游戏、渲染器或持有全局状态；宿主不靠任意插件的“试恢复”来保证事务。

Core 快照增加可选 `plugins: { [id]: { version, value } }`，仍沿原 SaveManager/Player/回退路径。恢复先检查全部所需插件、精确状态版本并生成所有候选 JSON 值，再交换状态；这阶段失败不写当前变量/游标/插件状态。不存在版本别名、自动迁移或忽略坏插件状态的分支。缺少保存项的已启用状态插件回到声明初值，这是新游戏/无该插件状态的明确语义，不继承当前局。

错误消息前缀：PLUGIN_REQUIRED（未启用/缺插件）、PLUGIN_MISSING（入口加载失败）、PLUGIN_API（模块合同）、PLUGIN_STATE（状态）、PLUGIN_VERSION（版本）、PLUGIN_BUSY（交互中）、PLUGIN_EXECUTION（执行）、PLUGIN_INACTIVE（旧操作）。当前 Core 错误带源码位置；前端应显示具体原因，不替作者猜修法。

## 渲染扩展

定义可带 `rendererPlugin`（id 与声明一致），沿原帧插件宿主注册；可带 `setupRenderer(runtime)`，返回同步释放函数。

- `runtime.commands.world.registerTransition(transition)` 直接注册实际 WorldEffectsController.registry；重复名称/覆盖内置转场拒绝，返回注销函数。使用原 `world.transition(name, ms)` 启动，沿原世界帧、减少动态、恢复时结束半程及销毁规则。不新增第二个转场时钟；自定义指令可以调用此接口，不把任意名称放入内置 `@transition` 语法。
- `registerFilter(id, pixiFilter)` 注册实际舞台后处理；`setFilterActive(id, bool)` 启停。使用宿主同版本、同模块实例的 Pixi 依赖，避免插件另带一套 GPU 程序缓存。成功注册后舞台拥有 Filter，注销/销毁只释放一次；重复 id 或复用同一 Filter 拒绝。开启项随演出快照保存；读档遇未注册项在改变画面前拒绝。只影响世界，不染系统菜单和对白 UI。
- 保留原帧回调 API；项目插件回调抛异常会停用回调并停止剧情，`onFailure(error)`/`host.failure` 提供具体原因，Player关自动并提示。这不是中止死循环或恶意代码隔离。暂不做文字效果注册。

CLI pack 在调用既有打包器前检查声明/API/入口是否存在，不执行插件工厂。获信任宿主通过自己的正常模块加载器引用已启用入口，沿现有 Vite 构建链收集；本批 **没有执行 G4 打包、安装或最终导出验收**，也没有新增自动打包器。

## Claude 前端接线范围

1. 从配置和 `project.inspect.plugins` 展示插件列表、参数、入口、API/状态版本。打开/编辑项目不能自动执行代码。
2. 在真实人类明确确认后才给预览宿主 trustedIds；说明来源、入口、依赖、运行环境及同源全局能力。信任仅对用户确认的当前项目/代码成立，不把配置中的字符串或 Agent 请求当作同意。不要宣称 iframe 安全隔离，也不改 iframe/CSP/权限。
3. 预览使用同一 Core 声明、同一 ProjectPluginHost 和原 system router，不另写插件解释器。未启用指令、损坏入口、恢复失败显示具体停止原因；清除该次成功续接/审阅证据，不用占位文字继续。
4. 运行 context 的 abort 清理项目面板；切项目、读档、关闭预览统一 dispose。设置、目录或源码编辑本身不等于信任。
5. 不改后端合同或自行加 compatibility/hash。接线后须有一个真实面板和一个可保存状态的小互动，以及禁用/坏版本/失败恢复反例。完整 Editor、原生 IME、打包版及正式审批仍按实际范围另验。

当前后端树 Editor 消费方类型检查还未通过：原演出批四处 `rule` 素材分类缺项仍待其前端接线；本批 `panels/story-check-panel.ts` 停止原因名称表需新增 `requires-extension: '需要扩展，未运行'`。这些前端映射不由本机改动，也不改记已通过；Claude 的前端 PR 应把它们一并按实际合同接通。

本地 Codex 的全部工程红线不适用于本云端任务，测试次数不设上限；按任务需要确定方法和验证规模，但仍遵守平台规则及本任务的实际授权边界。
