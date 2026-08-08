# Surdet 引擎审核修复报告（交接文档）

> 日期：2026-08-04（两轮修复：首轮审核修复 + 反审清单闭环）
> 范围：`E:\surdet`（git 仓库 `Default Project` 下的 `surdet/` 子目录）
> 状态：**全部修改已落地并通过验证，但尚未提交**（工作区有 24 个文件的未暂存改动，`git diff` 可见全量细节）。
> 验证结果：`npm run test` 全绿（cli 48 + core 169 + renderer 36 + shell 9 = **262 项通过**），`npm run typecheck` 全包通过。

---

## 〇、给接手者的三条必读

1. **改动未提交**。建议按下文"建议的提交拆分"分组提交，便于回溯。
2. **所有修复遵守既有设计原则**：内核零依赖、避免静默无操作（W002/W003 哲学）、防御性拷贝、向后兼容旧档。没有引入新依赖。
3. 候选修复清单中曾有一个引用**不存在的文件** `adv-renderer-proxy.ts` 的方案，已**不采纳**（该文件在仓库中不存在）。

---

## 一、P0 正确性/死锁类修复

### 1.1 战斗无限死锁（`packages/core/src/combat/combat.ts`）

**问题**：回合制战斗无移动阶段。当双方单位互不在攻击射程内（如两个近战单位相距过远）时，任何一方都无法产生合法 `act()`，但回合也不会推进——`maxTurns` 超时判定永远不触发，战斗无限死锁，宿主 AI 侧会卡死。

**修复**：新增三个成员，为宿主提供僵局检测与跳过出口：

```ts
/** 该单位是否存在可攻击的敌方目标（普攻射程内，或冷却就绪的 'long' 技能） */
canAttackAny(unitUid: string): boolean

/** 当前行动方是否无任何可用攻击（僵局检测） */
get actingTeamStalemate(): boolean

/** 跳过行动：回合照常推进（#lastAction=null + #advance()），保证 maxTurns 在僵局下依然生效 */
pass(): void
```

**宿主契约（重要）**：引擎不自动 pass。宿主驱动战斗的循环应写成：

```
if (solver.actingTeamStalemate) solver.pass(); else solver.act(...)
```

**顺带加固**：`act()` 中冷却判定原为 `attacker.cooldowns.get(skillId!)! > 0`——首次 `get` 返回 `undefined`，靠 `undefined > 0 === false` 的 JS 巧合才正确。已改为显式的 `skillId && skill && (attacker.cooldowns.get(skillId) ?? 0) > 0`。

### 1.2 `@call/@return` 子场景调用：从"声明未实现"到完整落地

原状：DSL 规范文档标注 ⚠️ 未实现，lint 报 W002，写了也没效果。现完整实现四层：

| 层 | 文件 | 改动 |
|---|---|---|
| AST | `dsl/ast.ts` | 新增 `CallInstr { op: 'call'; target: string }` |
| 编译器 | `dsl/compiler.ts` | `call`/`return` 从 `PLANNED_INSTRUCTIONS` 移入 `IMPLEMENTED_INSTRUCTIONS`（不再报 W002）；`@call <target>` 缺目标抛 `DslError S006`；`@return` 编译为 `end` 指令（运行时按调用栈区分"返回"还是"结束"） |
| 解释器 | `runtime/interpreter.ts` | 新增 `#callStack: SavePosition[]`；`call` 分支校验深度后压入返回点 `{sceneId, pc: 当前+1}` 并 resolve 跳转；`end` 分支先 pop 调用栈——非空则返回调用方继续执行（**不发 sceneEnd**），栈空才真正结束并发 `sceneEnd` |
| 存档 | 见 1.3 | 调用栈随存档持久化 |

**语义要点**：
- 目标支持 `sceneId` 或 `sceneId.label`（复用 `SceneRegistry.resolve`）。
- 子场景**自然结束**（文末自动 end）与显式 `@return` 行为一致：都返回调用方。
- 嵌套上限 `MAX_CALL_DEPTH = 64`，超限抛带提示的 RuntimeError（"检查子场景是否互相 @call 且缺少挂起点"）；死循环兜底仍由既有 `MAX_SYNC_STEPS = 100_000` 保证。
- `start()`（重启场景）会清空调用栈，防止残留。
- 文档 `docs/dsl-spec.md` 已同步：`@call/@return` 行从 ⚠️ 改为 ✅。

### 1.3 存档 schema 版本守卫 + 调用栈持久化（`save/save-manager.ts`、`interpreter.ts`）

**问题**：原实现无 schema 版本字段，引擎升级导致存档结构变化时旧档会静默错乱。

**修复**：
- `SAVE_SCHEMA_VERSION` 1 → **2**。`loadSnapshot` 遇 `schemaVersion > 2` 抛清晰错误（"引擎升级导致的旧档不兼容，请迁移或回退"）；旧档无该字段视为 0，按兼容处理。
- `SaveSnapshot` 新增可选字段 `callStack?: SavePosition[]`（栈顶在末尾）。`saveSnapshot` 写入；`loadSnapshot` 恢复；**v1 旧档无此字段按空栈加载**，完全向后兼容。
- `MemoryStorage.read` 返回深拷贝（与 write 对称的读隔离）：外部篡改读档结果不再污染存储。
- 测试同步：`interpreter-save.test.ts` 中 `schemaVersion` 断言 1 → 2。

---

## 二、P1 安全/健壮性修复

### 2.1 Electron 窗口导航加固（`packages/shell/src/main.ts`）

**问题**：游戏窗口内容可被导航到任意外部地址；一旦加载恶意页面，即可复用同一窗口的存档 IPC（`assertTrustedSender` 只校验 `file://`，导航后攻击者帧即满足条件），构成钓鱼 + 存档窃取面。

**修复**（在 `createWindow` 内、`loadFile` 前注册）：

```ts
// 非 file:// 导航一律拦截；http(s) 链接转系统浏览器
win.webContents.on('will-navigate', (event, url) => {
  if (!url.startsWith('file://')) {
    event.preventDefault();
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
  }
});
// window.open 弹窗全部拒绝（游戏无合法新窗口需求），http(s) 转系统浏览器
win.webContents.setWindowOpenHandler(({ url }) => {
  if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
  return { action: 'deny' };
});
```

### 2.2 Pixi 纹理/Sprite 泄漏（`packages/renderer/src/pixi-stage.ts`）

**问题**：`setBackground` 换背景、`removePortrait` 移除立绘时只从容器 `removeChild`，不 `destroy()`——Sprite 及其事件监听泄漏；整个舞台也没有销毁入口。

**修复**：
- `setBackground`/`removePortrait` 中被移除的 sprite 调用 `.destroy()`（**纹理不随 sprite 销毁**，纹理由缓存共享）。
- 新增 `PixiStage.destroy()`：释放选项视图、程序化背景/立绘纹理缓存、全部立绘 sprite、`app.destroy(true, { children: true })`。**宿主经 `registerBackground/registerPortrait` 注入的纹理不在此销毁**（生命周期归宿主/Pixi Assets 缓存），文档注释中已写明边界。

### 2.3 说话人误判 URL scheme（`packages/core/src/dsl/lexer.ts`）

**问题**：`extractSpeaker` 把首个冒号前的短前缀当说话人。文本行以 `https://…` 开头时，`https` 会被切成说话人。

**修复**：冒号后紧跟 `/` 时拒绝提取（一行守卫）：

```ts
if (trimmed[idx + 1] === '/') return null; // URL scheme（https://…）不当作说话人
```

### 2.4 表达式解析器死代码清理（`packages/core/src/dsl/expr-parser.ts`）

**问题**：`parseNumber` 的正则 `/^[+-]?\d+(\.\d+)?/` 中 `[+-]?` 不可达——一元正负号已在上游 `parseUnary` 消费。

**修复**：改为 `/^\d+(\.\d+)?/` 并加注释说明。纯清理，无行为变化。

---

## 三、P2 体验修复

### 3.1 快进"遇未读即停"（`interpreter.ts` + `packages/renderer/src/adv-renderer.ts`）

**问题**：原快进模式无脑连续推进，从未播放过的新文本也一闪而过，玩家错过内容。

**修复（两端契约）**：

- **解释器端**：`text` 事件载荷新增 `wasRead: boolean`。关键是**先查后标记**——`const wasRead = readTracker.has(key)` 在 `mark(key)` **之前**求值，所以 `false` 严格表示"本次是首次播放"。
- **渲染器端**：`#onText` 开头一行守卫：

```ts
if (this.#skipMode && p.wasRead === false) this.#skipMode = false;
```

已读行继续瞬时跳过；遇到未读行自动退出快进，按正常打字机显示并等待玩家。

- **向后兼容**：旧载荷缺 `wasRead`（`undefined`）时不触发停止（只在严格 `=== false` 时停），保持旧行为。

### 3.2 文档同步（`docs/dsl-spec.md`）

`@call/@return` 行更新为 ✅，注明：压入返回点、`@return` 或自然结束回到调用处下一行、调用栈随存档持久化、嵌套上限 64。

---

## 四、第二轮：反审清单闭环（P1 立绘 key 契约 + lint 缺口 + 测试补网 + 文档滞后）

首轮修复后收到 7 项反审问题，全部已闭环。

### 4.1 🔴 P1：`@hide` 与 `@show` 立绘 key 契约不一致（静默演出 bug）

**问题**：`@show lynn:armor despair @ left` 以完整 key `lynn:armor` 注册 sprite，而文档规范写法 `@hide lynn`（dsl-spec.md L57）查不到 `lynn:armor`——立绘永不消失。只有不带服装的 `@show lynn normal` 才碰巧有效。

**修复**（采纳推荐方案：按 charId 前缀匹配移除）：

- `pixi-stage.ts` `removePortrait(key)`：key 精确命中时单条移除；否则按 `key === k || k.startsWith(key + ':')` 前缀匹配移除该角色的**全部立绘**。两种写法（完整 `角色:服装` 与纯 `角色`）均有效，幂等。
- `types.ts` `removePortrait` 接口注释写明双 key 契约。
- 渲染层（`adv-renderer.ts`）**不改**：`@hide` 原样转发参数，匹配职责归 `PixiStage`（分层不越界）。

**新增测试**：
- `pixi-stage.test.ts`：纯角色 ID 移除该角色全部立绘、不碰其他角色、重复调用幂等、完整 key 精确移除仍支持。
- `adv-renderer.test.ts`：`@hide lynn`（规范写法）原样转发给 stage，防回归契约。

### 4.2 🟠 P2：`@call` 跨场景目标零静态校验 → lint 并入 J001/J002/J003

**问题**：`@jump` 有完整存在性校验，`@call` 编译期/lint 均不校验——拼错要运行到 `SceneRegistry.resolve` 才抛错，拖慢"AI 批量生成剧本"的错误发现周期。

**修复**（`cli/src/lint.ts`）：跨场景校验循环中 `instr.op === 'call'` 并入 `validateJumpTarget`（与 `@jump` 共用，错误文案带指令标签区分）；函数签名改为结构类型 `{ target, file, line, col }` 接收 `JumpInstr | CallInstr`。

**新增测试**（`cli/test/lint.test.ts` +3 用例）：`@call` 到不存在场景报 J001（文案含 `@call`）、到缺失标签报 J002、目标均存在时通过。

**文档**：`docs/dsl-spec.md` 错误码表 J001/J003 描述更新为 `@jump/@call`。

### 4.3 🟠 P2：choice 内联 `@goto` 空目标不校验 → 编译期抛 S006

**问题**：顶层 `@goto` 空目标抛 S006，但内联分支（choice 选项）不检查——`选项A -> @goto` 编译成空 target，运行时报"未解析的 goto 目标"，lint 也抓不到。

**修复**（`core/src/dsl/compiler.ts` `#emitInlineInstruction`）：内联 `@goto`/`@jump` 空目标与顶层一致抛 `DslError S006`。

**新增测试**（`core/test/compiler.test.ts`）：内联 `@goto`/`@jump` 空目标编译期抛 S006。

**文档**：`docs/dsl-spec.md` S006 描述更新为 `@goto/@jump/@call 缺目标（含 choice 选项内联写法）`。

### 4.4 🟠 P2：新增运行时保护补回归测试（combat 三 API + MAX_CALL_DEPTH）

**问题**：`canAttackAny/actingTeamStalemate/pass()` 与 `@call` 嵌套深度守卫（实测运行时行为正确）均无测试覆盖。

**修复**：
- `core/test/combat.test.ts` +2 用例：① 僵局检测与 pass()——开局双方紧贴布阵（`start()` 把敌方置于我方人数位），手动拉远距离构造射程僵局：`actingTeamStalemate` 为 true、`pass()` 推进回合且 maxTurns 超时判定生效、结束后 `pass()` 抛错；② `canAttackAny` 三分支：普攻射程内 true、超程无技能 false、超程但冷却就绪的 `long` 技能 true（技能冷却后 false）。
- `core/test/interpreter.test.ts` +1 用例：场景 a/b 互相 `@call`，同步递归压栈到 64 层干净抛 RuntimeError（非栈溢出）。

### 4.5 🟡 P3：文档滞后修复（README + dsl-spec）

- `README.md` L62 "未实现指令"清单移除已实现的 `@call/@return`；里程碑 M4、已实现清单同步快进"已读跳过 + 遇未读即停"、`@call/@return`、僵局出口、lint `@call` 校验、存档调用栈（schema v2）。
- `docs/dsl-spec.md` 快进章节由"跳全部、不区分已读/未读"改为"已读跳过 + 遇未读即停"实际行为。

### 4.6 🟡 P3：存档点末条指令边缘行为 → 注释声明（不 clamp）

`@autosave/@savepoint` 的 `position.pc + 1` 若指令恰为场景末条（非文本）会指向自动追加的 end——读档直接触发 sceneEnd。评估后**语义合理**（场景确实已走完），选择加注释声明边缘行为而非 clamp（clamp 会掩盖真实的结构问题）。`interpreter.ts` 两处已注明。

### 4.7 🟡 P3：FileSaveStore 读隔离与 MemoryStorage 对齐

`shell/src/save-store.ts` `read` 改为返回 `JSON.parse(JSON.stringify(raw))` 深拷贝（文件场景每次本就重读磁盘，成本可忽略），与 MemoryStorage 读隔离契约一致。

**新增测试**（`shell/test/save-store.test.ts`）：篡改 read 返回值不影响后续读取。

### 4.8 🟡 P3：starter 战斗接入僵局出口（原遗留项已闭环）

`examples/starter/src/main.ts` `runAutoBattle` 按 1.1 宿主契约补 `actingTeamStalemate → pass()` 分支（带注释说明死锁机理）。starter 的 `combat.json`（近战贴身）本不触发僵局，此举为示范宿主契约的正确写法。

---

## 五、新增/修改的测试（两轮合计）

| 文件 | 新增用例 |
|---|---|
| `core/test/interpreter.test.ts`（+76 行） | ① `@call` 子场景返回调用方继续执行、不发 sceneEnd；② 纯 `sceneId` 目标 + 自然结束也返回；③ **嵌套深度超限（MAX_CALL_DEPTH=64）干净抛错**；④ 调用栈随存档持久化往返 |
| `core/test/compiler.test.ts`（+21 行） | `@call`/`@return` 编译产物正确且无 W002；`sceneId.label` 目标；**内联 @goto/@jump 空目标抛 S006** |
| `core/test/combat.test.ts`（+70 行） | **僵局检测 + pass() + maxTurns 生效**；**canAttackAny 三分支（射程内/超程无技能/超程 long 技能冷却）** |
| `core/test/interpreter-save.test.ts` | `schemaVersion` 断言 1 → 2（2 处） |
| `renderer/test/adv-renderer.test.ts`（+49 行） | 快进遇未读即停 + 旧载荷兼容；**@hide 纯角色 ID 契约转发** |
| `renderer/test/pixi-stage.test.ts`（+16 行） | **removePortrait 纯角色 ID 前缀匹配移除 + 幂等 + 完整 key 精确移除** |
| `cli/test/lint.test.ts`（+28 行） | **@call 跨场景 J001/J002 校验 + 合法目标通过** |
| `shell/test/save-store.test.ts`（+11 行） | **read 读隔离深拷贝** |

---

## 六、验证方式（接手者复现命令）

在项目根（`E:\surdet`）执行（Windows PowerShell 环境）：

```powershell
npm run test        # 全 workspace：cli 48 + core 169 + renderer 36 + shell 9 = 262，全部通过
npm run typecheck   # 全包 tsc --noEmit 通过
git diff --stat     # 查看 24 文件 +494/−35 的改动清单
```

---

## 七、完整改动文件清单（24 个文件，+494/−35）

**源码（14）**：
- `packages/core/src/combat/combat.ts`（+37/−1）：僵局检测 + pass() + 冷却断言加固
- `packages/core/src/dsl/ast.ts`（+7）：CallInstr
- `packages/core/src/dsl/compiler.ts`（+36/−2）：@call/@return 编译 + 内联 @goto/@jump 空目标 S006
- `packages/core/src/dsl/lexer.ts`（+4/−1）：URL scheme 守卫
- `packages/core/src/dsl/expr-parser.ts`（+3/−1）：死代码清理
- `packages/core/src/runtime/interpreter.ts`（+45/−1）：调用栈运行时 + wasRead + 存档接线 + 存档点边缘注释
- `packages/core/src/save/save-manager.ts`（+11/−3）：schema v2 + callStack 字段 + 读隔离
- `packages/cli/src/lint.ts`（+15/−1）：@call 并入跨场景 J001/J002/J003 校验
- `packages/renderer/src/adv-renderer.ts`（+3）：遇未读即停
- `packages/renderer/src/pixi-stage.ts`（+34/−1）：sprite 销毁 + destroy() + removePortrait 前缀匹配
- `packages/renderer/src/types.ts`（+4/−1）：removePortrait 双 key 契约注释
- `packages/shell/src/main.ts`（+15/−1）：导航加固
- `packages/shell/src/save-store.ts`（+5/−1）：read 读隔离深拷贝
- `examples/starter/src/main.ts`（+7）：runAutoBattle 接入僵局出口

**测试（8）**：`interpreter.test.ts`、`interpreter-save.test.ts`、`compiler.test.ts`、`combat.test.ts`、`adv-renderer.test.ts`、`pixi-stage.test.ts`、`lint.test.ts`、`save-store.test.ts`

**文档（2）**：`docs/dsl-spec.md`、`README.md`

---

## 八、建议的提交拆分（未提交，供参考）

1. `fix(combat): 僵局检测与 pass() 出口 + 冷却断言加固 + 回归测试`
2. `feat(dsl): @call/@return 子场景调用（编译 + 运行时 + 存档 v2 持久化）`
3. `fix(save): schema 版本守卫 + MemoryStorage/FileSaveStore 读隔离`
4. `fix(shell): 窗口导航/弹窗加固`
5. `fix(renderer): Pixi 纹理释放 + 快进遇未读即停 + @hide 前缀匹配契约`
6. `fix(dsl): 说话人 URL 误判 + 表达式死代码清理 + 内联空目标 S006`
7. `fix(lint): @call 跨场景目标静态校验（J001/J002/J003）`
8. `docs: dsl-spec/README 快进与 @call 状态同步 + starter 僵局接线`

## 九、已知遗留（本次未改，供后续评估）

- 快进的"已读"判定基于**会话内** ReadTracker（随存档持久化为字符串数组），跨进程读档后依然有效；但**开发期编辑剧本会改变指令索引**导致已读标记错位（`read-tracker.ts` 注释已声明属预期行为）。若后续引入行级稳定 key（如文本哈希）可改善。
- `PixiStage.destroy()` 尚未在 `examples/starter/src/main.ts` 接入（starter 无退出重置场景）；宿主如实现热重置应调用它。
- `@autosave/@savepoint` 位于场景末条时读档直接触发 sceneEnd（已注释声明，语义合理；若产品上希望"读档回到末条文本前"再评估 clamp 方案）。


## 十、独立第三方审计修复批次（外部只读审核驱动）

外部 AI 独立审核定位 1 Critical + 5 Major + 多项 Minor，全部修复并补回归测试：

- **C1 @wait/@video 挂起期间读档必崩** → 新增 `stateReset` 内核事件（loadSnapshot 时广播）；AdvRenderer 订阅后作废等待计时并递增 wait/video 会话号，残留结束回调不再触发 `finishWait()` 状态失配；starter 订阅后关闭全部覆盖层。
- **M1 战斗/地图/商店中读档永久冻结** → `loadSnapshot` 清理 `#hostPaused`/`#jumpOverride`（对齐 start() 行为）。
- **M2 hostJump 回调重入只覆盖 instr 分支** → text/choice/wait/video/sceneEnd 全部挂起分支消费 `#jumpOverride`，回调内跳转后续跑不再冻结。
- **M3 编辑器新建场景"下载冒充保存"** → 保存根目录句柄，新场景经 File System Access 真实写入 content/scenario/；无目录环境诚实提示且保留脏标记。
- **M4 编辑器子目录同名场景静默覆盖** → 场景 key 改相对路径（各占一条），basename 冲突由 LINT_DUP 显式报错。
- **M5 编辑器校验与 CLI lint 双源漂移** → 场景级校验（变量/类型/readonly/修饰符/choice 嗅探/跨场景目标/@switch/配置解析）整体下沉 `@surdet/core` 的 `scene-lint` 模块，CLI 与编辑器共用同一实现；编辑器接入 customInstructions 与全套变量检查。
- **Minor 批量**：VariableStore.restore 默认拒写 readonly（读档显式 allowReadonly）；存档槽位名单射编码（a/b 与 a_b 不再碰撞）；战斗技能归属/行动阵营/快照 HP 与阵营校验；存档深度校验补全 callStack 元素/gallery 元素类型/systems 形状，shell 主进程复用 core 版本（删除弱版重复实现）；素材读取移除旧 XOR 回退（明文素材不再被误 XOR 成乱码）；SE/语音音量对播放中实例即时生效；存档缩略图纹理 LRU（上限 16）；choice 选项多跳转 W008 显式告警（不再静默丢弃）；编辑器零失真增强（CRLF 换行与半角冒号保持、beforeunload 脏保护）；starter 致命错误层可点击关闭、敌方回合点击守卫、入口场景取自 game.config.json。

修复后测试基线：**367 个测试全过**（cli 49 + core 211 + editor 14 + renderer 74 + shell 19），全量 typecheck 与 build 零错误。新增回归测试 `packages/core/test/audit-fixes.test.ts`（11 例）覆盖 C1/M1/M2 复现链与各 Minor 行为。

复核补漏（第二轮）：编辑器 updateLine eol 漏传修复；issue 点击跳转适配相对路径 key（子目录场景恢复跳转）；存档槽位旧编码回退读（含下划线存量槽位兼容，write 后隐式迁移）；loadSnapshot position=null 退化路径状态重置闭合；PixiStage.hideVideo 移除残留 @video 画面；渲染层 C1 逻辑单测 3 例沉入 adv-renderer.test.ts；缩略图缓存改真 LRU（命中重排）；README 注明场景级同源范围（配置级校验为 CLI 独有）。

终审补漏（第三轮）：FileSaveStore legacy 迁移闭合——write 迁移后清理旧编码文件（含 .bak）、delete 同步删除 legacy 文件、listMeta 索引路径合并未迁移 legacy 槽位，消除僵尸存档复活与列表漏项（补 3 条回归测试）；prepare-pack/preload 两处 XOR 过时注释更正为 AES-256-GCM。

自我迭代 第一梯队（本轮）：① 编辑器撤销/重做栈（打字合并、每场景独立历史）+ 校验 Worker 化（移出主线程、seq 对齐、异常同步回退）；② Playwright+Electron E2E 自动通关回归（画布点击开局→键盘推进→选择肢→F5/F9 存读档回路→系统交互层，30 步到 ch02 全 PASS）；③ 存档 schema 迁移管线（core/save/migrate，旧档逐级升级、断链回退、saveMigrated 事件）。测试基线：**373 全过**（cli 49 + core 217 + editor 14 + renderer 74 + shell 19），typecheck/build 零错误，E2E 退出码 0。

自我迭代 第二梯队（AI 生产线，本轮）：① surdet audit 命令——称谓一致性（CONSIST_TYPO/CONSIST_HONORIFIC）、设定名词表（TERM_VARIANT，content/config/terminology.json）、空心分支（BRANCH_THIN）与无出口场景（NO_EXIT）、节奏报告、无头试跑验收（文本自动推进/选择肢取第一项/@wait 立即结束/系统指令停止/运行时错误即失败）；② docs/ai-writing-prompt.md AI 写作标准模板（DSL 速查+硬性规则+验收闸门）；③ 编辑器场景拓扑图（BFS 分层 SVG、节点点击切场景）。starter 实测：抓到 3 个真实空心分支，试跑 13 步推进到 ch02 系统指令。测试基线：**386 全过**（cli 62 + core 217 + editor 14 + renderer 74 + shell 19），typecheck/build 零错误。
