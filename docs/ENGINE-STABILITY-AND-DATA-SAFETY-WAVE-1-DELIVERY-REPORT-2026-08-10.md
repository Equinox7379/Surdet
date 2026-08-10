# Surdet 稳定性与数据安全 Bugfix Wave 1 交付报告

日期：2026-08-10
状态：`STABILITY_WAVE_1_IMPLEMENTED`

## 1. 结论与范围

本轮按任务书限定完成 D1–D5 五项稳定性与数据安全整改：

1. Core：SaveSnapshot 两阶段严格校验、迁移后再次校验及原子恢复。
2. Editor：`saveAll()` 的逐项失败隔离、脏状态保留和状态提示语义。
3. Renderer：CJK/Unicode 换行不拆 surrogate，边界数值输入不会进入死循环。
4. Renderer：`PresentationController` 销毁/释放时使视频回调失效，并保证活动视频只清理一次。
5. Shell：窗口状态有限性、工作区可见性、离屏恢复和超大尺寸收缩。

本轮没有进入 Renderer M9，没有进行性能优化、Q1–Q5 资格化试验或旧版正式 A/B，没有修改性能 artifact、性能门限、DSL、剧情脚本、存档格式和游戏规则，没有发行，也没有推送远端。

最终状态：

```text
STABILITY_WAVE_1_IMPLEMENTED
PERFORMANCE_WORK_DEFERRED
PERFORMANCE_MEASUREMENT_NOT_QUALIFIED_RETAINED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_REVIEW
```

## 2. Git 基线与交付边界

### 2.1 开工基线

```text
工作树：E:\surdet
开工 HEAD：8cdffd0a92977d2c591f2a8d39f4a8e922088a01
开工时 HEAD...surdet/main：0 0
```

开工时工作树只有四个既有保护文件的未跟踪状态：

```text
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
```

以上四个文件在本轮没有修改、暂存、提交、删除或移动。

### 2.2 代码整改提交

| 阶段 | 提交 | 完整 SHA |
| --- | --- | --- |
| D1 Core | `fix(core): validate migrated save snapshots` | `9afa1823ebf2010fe43d2a2bb1fae81cca2fae0c` |
| D2 Editor | `fix(editor): isolate save-all failures` | `3a645b3701a74b27617d494705a3e8acb459cf12` |
| D3 Renderer 文本 | `fix(renderer): preserve unicode during text wrapping` | `30a9c659c5ab605ef316097eae61aca6d0fa2449` |
| D4 Renderer 视频 | `fix(renderer): invalidate video callbacks on dispose` | `fb38dc044a8ca3499acd8546f206f53a1d49390b` |
| D5 Shell 窗口 | `fix(shell): recover offscreen window state` | `2fe2ed27451c65492eb0d6947cfc4c521672ff72` |
| D4 测试边界 | `test(renderer): keep lifecycle test on public ports` | `a250432353260d7ade147e5aa61b61e1a626dff4` |
| D4 测试类型契约 | `test(renderer): complete presentation port harness` | `a7397542c4a859780500cf99ba32e291ad30e1d0` |
| 交付报告 | 本文件的独立文档提交 | 提交后以 `git rev-parse HEAD` 为准 |

代码整改最终 HEAD（交付报告提交前）为：

```text
a7397542c4a859780500cf99ba32e291ad30e1d0
```

报告提交不改变代码整改内容；报告提交后的真实最终 HEAD 会在提交后再次核对并在最终回报中列出。

### 2.3 实际改动文件

相对于开工基线，代码整改实际涉及 14 个文件：

```text
packages/core/src/runtime/interpreter.ts
packages/core/src/save/save-manager.ts
packages/core/test/audit-fixes.test.ts
packages/core/test/interpreter-save.test.ts
packages/core/test/save.test.ts
packages/editor/src/project-io.ts
packages/editor/test/project-io.test.ts
packages/renderer/src/runtime/presentation-controller.ts
packages/renderer/src/text-wrap.ts
packages/renderer/test/lifecycle/presentation-dispose.test.ts
packages/renderer/test/text-wrap.test.ts
packages/shell/src/main.ts
packages/shell/src/window-state.ts
packages/shell/test/window-state.test.ts
```

交付报告是额外的文档文件，不属于上述运行时代码改动。构建生成目录均未纳入提交。

## 3. 分阶段整改记录

### D1 — Core SaveSnapshot 两阶段校验与迁移原子性

#### 修复前失败证据

生产代码修改前，Core 聚焦审计测试有 5 个失败：

- 三组严格快照校验没有拒绝畸形 `kind`、元数据/版本或新增字段结构；
- 迁移后的畸形快照先进入恢复流程，表现为后续 `gallery.restore(undefined)` 的 TypeError，并且已经产生迁移事件/状态影响；
- `systemHooks.validate` 失败时迁移事件先于系统校验发出，破坏了“校验成功后才产生可观察副作用”的顺序。

#### 根因与修复

- `assertValidSnapshot` 以前只在部分入口做深校验，迁移结果通过宽泛类型断言直接进入恢复。
- 现在明确分为 `legacy` 和 `current` 两个验证阶段；低版本快照先做旧格式结构校验，迁移到候选值后必须再做 current 严格校验。
- 只有候选值通过严格校验并通过 `systemHooks.validate` 后，才发出 `saveMigrated` 并恢复运行时状态。
- 校验支持 JSON 安全的普通对象和 `Object.create(null)`，不以不必要的原型要求拒绝合法数据；仍拒绝循环引用、非有限数和非法数组/对象结构。

#### 结果

```text
Core 聚焦：3 个文件，45/45
Core 全量：23 个文件，304/304
Core typecheck：通过
Core build：通过
```

### D2 — Editor `saveAll()` 失败隔离

#### 修复前失败证据

生产代码修改前，`project-io.test.ts` 有 6 个失败（演示项目无文件系统的既有测试本身已通过）：

- 新场景 `create` 失败会中止后续保存；
- 写入失败会中止后续项目项；
- `close` 失败会中止后续项目项；
- 删除失败没有正确保留待删队列；
- 删除失败仍可能触发 `onSaved`；
- 全部成功状态没有明确的“全部成功”反馈。

#### 根因与修复

- 保存流程原先以单条串行链处理多个待保存项，单项异常会阻断后续项，并可能把部分成功误报为整体成功。
- 现在每个删除、新场景、既有场景的 create/write/close 以及 timeline 操作独立捕获异常。
- 失败项继续保持 dirty；待删除项失败时保留在队列；只有无失败且没有剩余脏状态时才调用 `onSaved()`。
- 状态消息区分无改动、全部成功、部分成功和全部失败。

#### 结果

```text
Editor 聚焦 project-io：7/7
Editor 全量：21 个文件，142/142
Editor typecheck：通过
Editor build：通过
```

### D3 — Renderer Unicode/CJK 换行安全

#### 修复前失败证据

生产代码修改前，文本换行聚焦测试有 2 个失败：

- emoji 恰好位于换行边界时被 UTF-16 `slice` 拆成孤立 surrogate；
- 连续 emoji 换行时同样可能被拆分。

#### 根因与修复

- 换行实现以 JavaScript UTF-16 code unit 的索引和 `slice` 作为“一个字”的边界。
- 现在先用 `Array.from(text)` 按 Unicode code point 建立单位数组，再执行禁则和测量逻辑；输出通过 code point 数组拼接。
- `wrapCjkMeasure` 的 measure 回调也只会收到完整 code point 字符串，不会看到孤立 surrogate。
- 对 `0`、负数、小数、`Infinity` 和 `NaN` 做稳定、明确的边界处理；`NaN` 直接抛出 `RangeError`，空文本仍返回空数组。

#### 结果

```text
文本聚焦：17/17
Renderer 全量：47 个文件，334/334
Renderer typecheck：通过
Renderer build：通过
```

### D4 — PresentationController 视频销毁/释放

#### 修复前失败证据

生产代码修改前，视频生命周期聚焦测试有 3 个失败：

- `destroy()` 没有隐藏仍活动的视频；
- `dispose()` 没有隐藏仍活动的视频；
- 视频结束回调重复调用时，`onWaitEnd` 会被调用两次。

#### 根因与修复

- 旧逻辑只有 state reset/session reset 的失效令牌，没有将 disposed 状态和活动视频清理绑定到销毁路径。
- 现在控制器跟踪活动视频、wait session 和 disposed 状态；销毁/释放会递增会话令牌、清空等待期限、对活动视频调用一次 `hideVideo`，并拒绝旧回调。
- 正常视频回调有一次性完成保护；旧 session、disposed controller 和重复回调均不会再次结束等待。
- `needsUpdate`/`update` 在 disposed 状态下也不再请求帧。

#### 门禁整改记录

第一版测试虽然行为通过，但 `verify:renderer-legacy` 发现新增测试导入了 `AdvStage` legacy 类型；随后测试改为直接使用 `createPresentationPorts` 的结构化公开 Stage 端口。之后根级 typecheck 又发现 fake Stage 缺少 `setBackground`、`setPortrait`、`removePortrait` 三个必需端口；补齐无副作用 fake 方法后最终通过。两次门禁失败均被保留并修正，没有放宽检查器。

#### 结果

```text
D4 聚焦：4/4
Renderer 全量：47 个文件，334/334
Renderer typecheck：通过
Renderer build：通过
verify:renderer-legacy：通过
```

### D5 — Shell 窗口状态安全恢复

#### 失败先行与整改记录

修改生产前，新增聚焦测试先因预期的 `window-state` 模块不存在而失败。接入首版纯函数后暴露了两个测试期望值计算错误（主屏居中坐标应按实际尺寸计算），校正测试期望后通过。最终提交前又显式修正主屏排序，不能依赖 `getAllDisplays()` 的返回顺序。

另一次包级门禁中，Editor 构建与 Core 构建并行执行，Editor 短暂读取到了正在写入的 Core dist 文件并失败；随后串行重建 Core、单独重跑 Editor build 通过。该构建竞态不是源码失败，但已在记录中保留，最终门禁使用串行依赖路径。

#### 根因与修复

- 原 `loadWindowState` 只检查 width/height 为正数，未检查有限性、屏幕可见性或超大尺寸，也未使用 Electron 屏幕工作区。
- 新增纯函数 `resolveWindowState`，不读文件、不调用 Electron、不修改输入对象，便于覆盖边界测试。
- 主进程在 `app.whenReady()` 后读取 `screen.getPrimaryDisplay()` 和所有显示器的 `workArea`，显式把主屏排在输入第一位。
- x/y/width/height 必须为有限数字；尺寸非正或非法时回退默认值，过小尺寸不低于可用最小尺寸，超大尺寸按目标工作区收缩。
- 位置只要在任一工作区保持至少 64×64（或窗口自身尺寸）的可见交集就保留；完全离屏或只露出微小角落时回到主屏工作区中央。
- `fullScreen` 只在持久化值为布尔值时保留，保持全屏恢复语义。

#### 结果

```text
Shell 聚焦：8/8
Shell 全量：14 个文件，117/117
Shell typecheck：通过
Shell build：通过
```

## 4. 全量门禁结果

以下结果均来自当前代码最终 HEAD（报告提交前的 `a7397542c4a859780500cf99ba32e291ad30e1d0`），并在交付报告创建前完成：

| 门禁 | 结果 |
| --- | --- |
| `npm run verify:renderer-boundaries` | 通过；3/3 脚本测试，边界检查通过 |
| `npm run verify:renderer-legacy` | 通过；4/4 脚本测试，遗留 API 使用检查通过 |
| `npm run verify:tools` | 通过；10/10 |
| `npm run verify:hygiene` | 通过；跟踪集合 574 个路径 |
| Core/Renderer/Editor/Shell 全量测试 | 通过；304/304、334/334、142/142、117/117 |
| Core/Renderer/Editor/Shell 类型检查 | 通过 |
| Core/Renderer/Editor/Shell 构建 | 通过 |
| `npm run lint -w zero-after-midnight` | 通过；11 场景、0 errors、0 warnings |
| `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000` | 通过；23/23 choice、0 runtime errors |
| `node examples/zero-after-midnight/scripts/check-assets.mjs` | 通过；44 assets |
| `npm run typecheck -w zero-after-midnight` | 通过 |
| `npm run build -w zero-after-midnight` | 通过 |
| 根级 `npm run verify:all` | 通过，退出码 0 |
| `git diff --check` | 通过 |

根级 `verify:all` 还实际覆盖了 CLI、Host、Starter 和正式游戏的类型/测试/构建链路；其中根级工作区测试包括 CLI 7 文件/86 测试、Host 3 文件/18 测试，以及上述 Core、Editor、Renderer、Shell 测试。构建输出中的 Vite “Some chunks are larger than 500 kB” 是既有非阻断提示，本轮没有进行无证据的拆包、懒加载或性能调整。

## 5. 正式游戏验收

《零点之后》最终门禁保持：

```text
场景：11
lint：0 errors / 0 warnings
choice 分支：23/23
结局：3 个（testimony_end / meeting_end / silence_end）
资产：44
运行时错误：0
存档往返冒烟：39 次 save/load
typecheck：通过
build：通过
```

本轮没有修改《零点之后》的剧情脚本、场景流程、资源路径、资产注册表或游戏规则。

## 6. Git 最终核对（报告提交前）

```text
git rev-parse HEAD
a7397542c4a859780500cf99ba32e291ad30e1d0

git status --short
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md

git rev-list --left-right --count HEAD...surdet/main
7 0
```

四个保护文件仍保持未跟踪，未被纳入任何 Wave 1 提交。报告提交后应再次确认工作树只剩这四项，且不执行 push。

## 7. 未解决事项与明确冻结边界

- Renderer 性能测量资格仍未关闭，`PERFORMANCE_MEASUREMENT_NOT_QUALIFIED` 原结论保留。
- `sceneP95Ms` 等既有性能风险没有被本轮修改、重跑或掩盖。
- 没有重新采样 Q1–Q5，没有运行旧版正式 A/B，没有改变任何性能门限。
- 没有开始 M9，没有发行，没有重新打包正式加密包。
- 没有扩大到 DSL、存档格式、剧情、游戏规则、编辑器玩家功能或 Renderer 架构迁移。
- 本轮没有发现阻断 Wave 1 交付的剩余测试失败；Vite 大 chunk 提示属于已知非阻断构建建议，不在本轮无证据优化范围内。

## 8. 等待状态

报告提交后再次执行最终根级门禁和 Git 状态核对，随后停止，不推送远端，等待独立复审：

```text
STABILITY_WAVE_1_IMPLEMENTED
PERFORMANCE_WORK_DEFERRED
PERFORMANCE_MEASUREMENT_NOT_QUALIFIED_RETAINED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_REVIEW
```
