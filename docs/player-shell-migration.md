# Player Shell Foundation Wave 3 迁移指南

本文面向游戏宿主、Starter、`《零点之后》` 和 CLI 模板维护者。Wave 3 把玩家菜单、覆盖层返回关系、操作中状态和 Renderer 主题接线收敛到 `@surdet/host` 与 `@surdet/renderer` 的公共接口。游戏项目仍负责内容、视图数据、存储适配和业务回调，但不再复制一套菜单状态机。

## 1. 迁移原则

旧项目常见的手工编排是：入口文件分别维护 `systemMenuOpen`、`saveLoadOpen`、`settingsOpen`、`galleryOpen` 等布尔值，在每个回调中决定关闭哪个面板、恢复哪条命令栏，再把同一组状态分别传给 PixiStage 和宿主。

Wave 3 的目标是把这组协调责任交给 Host：

```text
游戏内容/存储/业务回调
              │
              ▼
@surdet/host PlayerShellController
              │  open / close / operation / input / reset
              ▼
固定六槽 Registry ───────► Renderer v2 commands
              │                         │
              ▼                         ▼
       PlayerUiSession              Pixi Layer 投影
```

新入口只应创建一个 `PlayerShellController`，并通过 `createRendererPlayerShellSlots()` 接入 Renderer v2。不要在游戏项目重新创建 `PlayerUiSession` 的同义状态机，不要把 Host 源码复制到游戏目录，也不要让新代码直接依赖 `PixiStage`、`AdvRenderer`、具体 Layer 或 Pixi 对象。

## 2. 最小接线

游戏提供六类视图工厂和回调；Host helper 负责生成固定的默认槽注册表：

```ts
import {
  createPlayerShellController,
  createRendererPlayerShellSlots,
  createPlayerUiSession,
} from '@surdet/host';
import { createRendererTheme } from '@surdet/renderer';

const slots = createRendererPlayerShellSlots({
  renderer: { commands, queries },
  views: {
    title: () => ({ view: titleView, onSelect: titleSelect }),
    systemMenu: () => ({ items: systemMenuItems, onSelect: selectSystemMenu, onClose: closeSystemMenu }),
    saveLoad: (request) => buildSaveLoadView(request.mode),
    settings: () => buildSettingsView(),
    gallery: () => buildGalleryView(),
    backlog: () => buildBacklogView(),
  },
});

const playerShell = createPlayerShellController({
  slots,
  session: createPlayerUiSession({ base: 'title' }),
  onError: reportPlayerShellError,
});

commands.preferences.setTheme(createRendererTheme());
```

`commands` 具有副作用，`queries` 只读。游戏的键盘、鼠标或宿主快捷键先转成 Controller 的语义命令；不要从查询结果反推并维护第二份布尔状态。

## 3. 固定六槽、default 和 override

注册表顺序和 ID 固定为：

| UI 槽 | 默认 Provider | 作用 |
| --- | --- | --- |
| `title` | `renderer.menu.title` | 标题根界面 |
| `system-menu` | `renderer.menu.system-menu` | 游戏内系统菜单 |
| `save-load` | `renderer.menu.save-load` | 存档/读档 UI 投影 |
| `settings` | `renderer.menu.settings` | 设置面板 |
| `gallery` | `renderer.gallery` | 鉴赏覆盖层 |
| `backlog` | `renderer.dialogue.backlog` | 文字记录覆盖层 |

所有六个 default Provider 都必须存在；漏槽在构造时抛出 `PLAYER_SHELL_SLOT_DEFAULTS_INVALID`。`overrides` 是按槽的显式替换，只能替换已知 ID；未知 ID 或非法 Provider 抛出 `PLAYER_SHELL_SLOT_UNKNOWN` / `PLAYER_SHELL_SLOT_DEFAULTS_INVALID`。不提供 override 仍然必须得到六个可工作的 Renderer-backed defaults。公开 `queries.slots()` 只返回冻结的绑定快照，不暴露 Provider、Layer 或 Pixi 引用。

## 4. 来源、返回栈和关闭语义

每次打开都带有来源上下文，Controller 在调用 Provider 前验证来源和当前状态：

| 请求 | 合法来源 |
| --- | --- |
| `title` | `title` / `game` |
| `system-menu` | `game` |
| `save-load` | `title` / `game` / `system-menu` |
| `settings` | `title` / `game` / `system-menu` |
| `gallery` | `title` / `game` |
| `backlog` | `game` |

从根页面打开覆盖层使用 `openOverlay()`，它把当前 frame 压入 `returnStack`；从活动覆盖层打开子界面使用 `pushOverlay()`，例如：

```text
game / none
  └─ open system-menu  → game / system-menu
       └─ push settings → game / settings
```

关闭 settings 后，Controller 先收敛当前 settings 状态，再恢复 `game / system-menu` 的 session frame，并重新投影父槽；再次关闭 system-menu 才回到 `game / none`。这条父槽重投影是引擎行为，游戏不应自己猜测“上一个页面”并手动复制一份菜单状态。

保存/读档操作另外受 `operation` 状态保护：`beginOperation('saving' | 'loading')` 记录完整起点，成功由 `completeOperation()` 收敛到目标上下文，失败由 `failOperation(error)` 恢复原始 base、overlay、returnStack、interfaceHidden 和 videoActive，并把原始错误交给 `onError`。错误不得被静默吞掉。

`PlayerInputGate` 负责一次指针消费；菜单关闭、无效槽位和 busy 操作不得绕过这条输入门。查询 `snapshot()`、`slots()`、`canAdvance()`、`canRollback()` 都是只读操作。

## 5. Theme override

Renderer 主题由 `RendererTheme` 定义。`createRendererTheme()` 返回冻结的默认 token；调用 `commands.preferences.setTheme(patch)` 时，Renderer 会验证、复制并冻结新主题，再把同一个意图投影到 Dialogue、Menu、Gallery、SystemPanel 和 Loading 五类 Layer。

```ts
commands.preferences.setTheme({
  colors: { accent: 0x47c8ff },
});

const theme = queries.preferences.theme(); // 只读快照
```

不要直接修改返回对象、Layer 私有字段或 Pixi Text/Graphics。主题更新应保持已有资源 owner、监听器、补间和显示对象数量；相同主题更新必须幂等。主题 token 只描述 Renderer 的视觉参数，不改变 DSL、存档格式、剧情、游戏规则或玩家输入语义。

## 6. 错误码和错误边界

Host Player Shell 的稳定错误码包括：

- `PLAYER_UI_INVALID_TRANSITION`：当前 session 不允许该状态转移；
- `PLAYER_SHELL_SOURCE_INVALID`：slot/source/base/overlay 组合不合法；
- `PLAYER_SHELL_SLOT_UNKNOWN`：未知槽位或未知 override；
- `PLAYER_SHELL_SLOT_DEFAULTS_INVALID`：六个 default 不完整或 Provider 形状非法；
- `PLAYER_SHELL_SLOT_FAILED`：Provider 的 open/close 抛错，原始异常保存在 `cause`。

Provider 失败时 Controller 必须恢复旧 session；存档/读档异步失败必须通过 `failOperation(error)` 进入宿主错误边界。应用层可以记录或展示错误，但不能把 rejected Promise 改成“成功”、把错误降级成 warning，或用延时掩盖状态不一致。

## 7. UI 槽不是存档槽

`PlayerShell` 的 `save-load` 是一个 UI Provider 槽，表示“当前正在显示存档/读档界面”；它不是存档数据的 slot ID，也不替代 `SaveManager` 的 `1`、`2`、quick、auto 等存档槽。

正确分层是：

```text
PlayerShell request { slot: 'save-load', mode: 'save' | 'load' }
      │
      ▼
游戏的 SaveStorage / SaveManager
      │
      ▼
数据槽位 id（例如 '1'、'quick'、'auto'）
```

UI Provider 只负责展示和转发选择；存档格式、快照版本、数据槽位和存储错误仍属于现有存档系统。本轮没有修改 `SaveSnapshot`、`SAVE_SCHEMA_VERSION` 或剧情规则。

## 8. 一版兼容窗口

当前 major 保留 `PixiStage`、`AdvRenderer` 和 `AdvStage` 的兼容适配，用于旧消费者和 legacy 回归。它们不应出现在新生产接线中；新游戏、Starter、编辑器预览和 CLI 模板都应消费 Runtime v2 与 Player Shell 公共接口。

兼容窗口关闭前必须同时满足：生产路径 legacy usage 扫描保持 0、正式消费者全部迁移、兼容/存档/演出恢复/资源循环/Electron 测试不再依赖旧构造，并在发布说明中给出完整迁移周期。未满足这些条件时不要删除旧导出，也不要增加逐调用 deprecation 噪声。Wave 3 没有开始 M9、性能优化、资产扫描、可视化编辑器或正式发行工作。
