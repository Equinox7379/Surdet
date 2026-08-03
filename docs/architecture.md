# Surdet 架构

## 分层

```
┌─────────────────────────────────────────────────────────────┐
│  cli（surdet 命令）   new / lint / build / pack               │
├─────────────────────────────────────────────────────────────┤
│  shell（Electron）   窗口 + 打包（electron-builder）            │
├─────────────────────────────────────────────────────────────┤
│  renderer（PixiJS）  AdvRenderer → PixiStage / 音频           │
├─────────────────────────────────────────────────────────────┤
│  core（零依赖）      DSL 编译器 / 解释器 / 状态 / 存档 / 全家桶   │
└─────────────────────────────────────────────────────────────┘
```

**依赖方向**：core → renderer → shell → cli。core 零第三方依赖，headless 可运行可测。

## 数据流（一帧剧情如何跑起来）

```
.gal 剧本 ──compile──▶ CompiledScene（指令流 + 标签索引）
                              │
                              ▼
   game.config.json ─▶ VariableStore ─▶ Interpreter ──▶ EventBus
                                              │
              text/choice/instr/system/gallery 事件
                                              ▼
                                        AdvRenderer（状态机）
                                              │
                                        PixiStage（投影）
```

- `Interpreter` 逐条执行指令流；text/choice 阻塞，外部 `advance()`/`choose()` 推进；事件回调内可重入（迭代续跑，无递归栈溢出）。
- `AdvRenderer` 订阅事件驱动打字机/转场/选择肢，与 Pixi 解耦（可注入 fake stage 测试）。
- 错误定位贯穿三层：`文件:行:列` + 错误码 + 修复提示。

## 全家桶系统（M5，数据驱动）

| 系统 | 配置源 | 引擎侧 | 触发 |
|---|---|---|---|
| 地图日程 | calendar.json | `CalendarRunner` | `@calendar` → system 事件 |
| 回合战斗 | combat.json | `CombatSolver` | `@battle` → system 事件 |
| 后宫 | events.json | `AffectionSystem` | `@affection/@event` |
| 周目继承 | ngp 配置 | `NewGamePlus` | clear 判定 + 继承计算 |

**存档接线**：系统实例由宿主持有，宿主通过 `Interpreter` 的 `SystemHooks`（`snapshot`/`restore`）接入存档——`SaveSnapshot.systems` 携带 `calendar/combat/affection` 快照，随存档 JSON 往返。各系统快照必须 JSON 安全（无 Map/Set/函数）。

**演示接线（非闭环）**：`examples/starter` 演示了全家桶**实例接线与存档往返**——`@calendar`/`@battle`/`@affection`/`@event` 的 `system` 事件由 `src/main.ts` 驱动 `CalendarRunner`/`CombatSolver`/`AffectionSystem`/`NewGamePlus`，并经 `SystemHooks` 随存档保存/恢复（见 `content/config/*.json` 与 `ch02.gal`）。属**演示级**而非完整闭环：`calendar.enter()` 的 `eventId` 仅 `console.info` 不跳转事件场景、`@event` 的 `consumeEvent` 未先经 `availableEvents()` 校验、无回想 UI（详见 README"示例未闭环的宿主应用逻辑"）。

## 素材注入（渲染层）

`PixiStage` 默认对未注册 key 生成程序化占位素材；真实项目在 `init()` 后用 `registerBackground(key, url|Texture)` / `registerPortrait(charId, costume, expression, url|Texture)` 注入真实素材（URL 经 Pixi `Assets` 异步加载），注册后的 key 优先使用真实素材，其余仍回退占位。

## 存档契约

`SaveSnapshot` = 变量快照 + 场景定位（sceneId+pc）+ 已读标记 + 解锁状态 + 全家桶系统状态（`systems`，宿主经 `SystemHooks` 提供）。`SaveStorage` 接口可注入 localStorage / 文件系统。剧本 `@autosave`/`@savepoint` 由解释器发对应事件（载荷为完整快照，position 已前移到下一条指令，读档不会重跑存档点），宿主订阅后写入自动/手动槽位。

**桌面文件存档**：`@surdet/shell` 经 preload（`window.surdetSave`，sandbox 下用同步 IPC）暴露 `list/read/write/delete`，主进程用 `FileSaveStore`（`packages/shell/src/save-store.ts`）读写 `userData/saves/<slot>.json`（原子写 + 10MB 大小上限）；浏览器环境回退 localStorage（见 `examples/starter/src/main.ts`）。

> **读档时序约定**：`Interpreter.loadSnapshot` 先恢复变量/已读/解锁与全家桶系统状态（`SystemHooks.restore`），再 `#step()` 从恢复点重新执行指令流（text/choice 会重新发出事件驱动 UI 挂起）。宿主**必须在 UI 线程（非事件回调）调用** `loadSnapshot`——在 `text`/`choice` 等事件回调内调用会撞解释器的 `#stepping` 重入守卫。

> **sceneEnd 回调**：`@end` 触发 `sceneEnd` 事件时解释器正处事件回调上下文；回调内可调用 `start(sceneId)`（如"结局 → 返回标题"），经 `#resumeRequested` 延迟重启，不撞重入守卫。`loadSnapshot` 则不可在事件回调内调用。

## 场景结束

`Interpreter` 执行到 `@end`（或文件末尾自动追加的 end）时置 `ended` 并发 `sceneEnd` 事件（载荷 `{ sceneId }`），宿主可接结局演出/ED/返回标题画面。`sceneEnd` 回调内支持 `start()` 重启新场景。

## AI 产出游戏的工作流

```
surdet new mygame        # 脚手架 + workspace 注册
# 编辑 content/scenario/*.gal + game.config.json（见 docs/dsl-spec.md）
surdet lint mygame       # 静态校验：语法/引用/变量声明/跨场景跳转
npm run dev -w surdet-mygame   # 浏览器预览
surdet build mygame      # vite 构建
surdet pack [gameDir]    # electron-builder 打包 exe（缺省打包 starter；指定游戏目录打包该游戏）
```

## 关键设计约束

- **core 零依赖**：逻辑层不依赖 DOM/Node/console，宿主注入 logger/存储。
- **引号契约**：词法器引号感知切分但保留引号；表达式语境当字符串字面量，通用指令值由渲染层 `dequote`。
- **短路求值**：`&&`/`||` 只对实际求值侧做类型校验。
- **事件回调可重入**：`advance()/choose()` 在事件回调内通过 `#resumeRequested` 迭代续跑。
