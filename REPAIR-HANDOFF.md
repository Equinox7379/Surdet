# Surdet 引擎 · 审计轮4 修理报告（交接书）

> 出具时间：2026-08-05 16:47 +08:00
> 背景：独立复审（范围 `6407a6f..HEAD`，11 提交，HEAD=`ab42cfe`）结论"有条件通过"。
> 审计轮4（整改）因前一个 AI 上下文不足中途停止。**本文档是自包含交接书**：
> 含已完成部分、剩余整改清单（含精确落点与建议方案）、验收基线。

---

## 0. 当前仓库状态（已核验，务必先复核）

- HEAD = `ab42cfe`（master），无新提交。
- 工作树仅 2 个文件被修改（**M1 的文档/编辑器半边，已完成且方向正确**）：
  - `docs/dsl-spec.md`：演出三件套（@particle/@mov/@tint）三行改为与实现一致的语法
  - `packages/editor/src/main.ts`：`INSTR_FIELDS` 中 particle/mov/tint 三条模板 labels 同步
- 其余文件零改动；`git diff` 全文如下：

```diff
diff --git a/surdet/docs/dsl-spec.md b/surdet/docs/dsl-spec.md
-| `@particle` | `@particle sakura` / `@particle sakura 5000` | ✅ | 粒子特效层（预设：sakura/snow/rain/embers/sparkles；可选持续毫秒，缺省持续到 `@particle stop`）；`@particle stop` 清除 |
-| `@mov` | `@mov lynn x 400 800` | ✅ | 立绘属性补间动画（角色 属性 目标值 [时长毫秒]；属性 x/y/alpha；缺省 400ms） |
-| `@tint` | `@tint #ff6600 800` | ✅ | 全屏调色叠加（颜色 hex + 过渡毫秒；`@tint none` 清除） |
+| `@particle` | `@particle sakura` | ✅ | 粒子特效层（预设：snow/rain/sakura/sparkle/fireflies）；`@particle off` 清除 |
+| `@mov` | `@mov lynn left` / `@mov lynn 400 600` | ✅ | 立绘位置平移（角色 位置 [时长毫秒]；位置 = left/center/right 或裸数字 X 坐标；缺省 400ms） |
+| `@tint` | `@tint #ff6600 0.3` / `@tint #ff6600 0.3 800` | ✅ | 全屏调色叠加（颜色 hex + 透明度 [过渡毫秒]；`@tint off` 清除） |

diff --git a/surdet/packages/editor/src/main.ts b/surdet/packages/editor/src/main.ts
-  particle: { labels: ['预设', '持续毫秒'] },
-  mov: { labels: ['角色', '属性', '目标值', '毫秒'] },
-  tint: { labels: ['颜色 hex', '毫秒'] },
+  particle: { labels: ['预设'] },
+  mov: { labels: ['角色', '位置', '毫秒'] },
+  tint: { labels: ['颜色 hex', '透明度', '毫秒'] },
```

- **处置建议**：这两处改动与实现逐字核对过（见 §1 依据），建议保留。如想全部推倒重来：
  `git checkout -- docs/dsl-spec.md packages/editor/src/main.ts`。
- 未跟踪文件 `REVIEW-HANDOFF.md`（复审任务书）、`memory/`、`USER.md`、`.opensquilla/`
  是工作过程文件，与引擎无关，不要打包进提交。

---

## 1. 已完成：M1（演出三件套三方对齐）——文档 + 编辑器侧

**方向**：以实现为准修文档与编辑器模板（报告建议的两个方向之一；starter 场景未使用
这三条指令，无存量兼容包袱，以实现为准是最小改动）。

**依据（已逐行核验）**：
- `packages/renderer/src/pixi-stage.ts` L67-73：`PARTICLE_PRESETS` = snow/rain/sakura/sparkle/fireflies
- `packages/renderer/src/adv-renderer.ts`：
  - L466-472 `@mov key pos [dur]`，pos = left/center/right/裸数字 X
  - L473-486 `@tint 颜色 透明度 [dur]`，清除只认 `off`
  - L487-493 `@particle 预设` / `@particle off`，无 duration 参数
- `packages/renderer/src/types.ts` L47-57：`movePortrait/setTint/clearTint/startParticles/stopParticles` 签名一致。

**M1 剩余（可选，报告 Suggestion 1）**：对照测试防再漂移。
建议位置：`packages/renderer/test/adv-renderer.test.ts` 已有 `FakeStage implements AdvStage`
（记录 calls 的 fake，现成模式可抄）。测试内容：编译 dsl-spec 表格里的三行示例
（`@particle sakura` / `@particle off` / `@mov lynn left` / `@mov lynn 400 600` /
`@tint #ff6600 0.3` / `@tint #ff6600 0.3 800` / `@tint off`），驱动 AdvRenderer，
断言 FakeStage 收到对应调用。**注意**：FakeStage 目前可能缺少 movePortrait/setTint/
clearTint/startParticles/stopParticles 的记录字段，需按现有 shakes/flashes/zooms
数组字段的模式补齐（都是可选方法，加上即可）。

---

## 2. 未完成：M2 —— EventScheduler 回合头尾闭环（最重要）

### 现状（已核实）
- `packages/core/src/systems/event-scheduler.ts`：EventScheduler 完整可用——
  `eligible()`（优先级降序稳定排序）/ `fire(id)` / `fireInto(id, store)`（effects 写回，
  number 增量、flag/string set）/ `dispatch(store)`（取最高优先级触发）/
  `isFired` / `snapshot(): { fired: string[] }` / `restore(snap)`。构造：
  `new EventScheduler(events: readonly ScheduledEventDef[], env: ExprEnv)`，
  `ScheduledEventDef = RelationshipEvent & { priority?: number }`。
- `packages/core/src/calendar/calendar.ts`：
  - `CalendarConfig.onTurnStartEventId?` / `onTurnEndEventId?` 字段**已存在**（L62-63）
  - `turnStartEventId` getter（L144-146）、`turnEndEventId` getter（L149-151）**已存在，零消费方**
- `examples/starter/src/main.ts`：
  - L170-183 `Interpreter` 构造的 `SystemHooks`：snapshot 收集
    calendar/combat/affection/achievements 四项，restore 对称恢复——**无 eventScheduler**
  - L253-295 `case 'calendar'`：`interp.pauseHost()` → `renderMap()` → `stage.showMap(...)`，
    onEnter 处理节点事件（`interp.hostJump(res.eventId)`，L286），
    **onEndTurn 回调（L291-294）只有 `calendar.advanceTurn(); interp.resumeHost();`**
- `examples/starter/content/config/calendar.json`：无 `onTurnStartEventId`/`onTurnEndEventId` 字段
- `examples/starter/content/config/events.json`：`events[]` 现有两条
  （ev_trust_30 / ev_trust_70，均 `once: true`，scene: ch01_01）
- `packages/core/src/save/save-manager.ts` L18：`SystemSnapshots.eventScheduler?: EventSchedulerSnapshot`
  **已预留**（注释标注"预留"，接线后应更新注释）
- `docs/architecture.md` L54 宣称已闭环（失实，M2 修复后即为事实，无需改文档）

### 建议方案（真实闭环，勿降级文档）
**关键陷阱（务必避开）**：回合头尾事件的 `scene` 字段若指向不存在的场景，
`interp.hostJump(sceneId)` 会经 `#registry.resolve` 抛错；若为此新建场景，
新场景没有 @jump/@call 入口会触发 W007，破坏 0 警告基线。
**推荐做法：复用现有场景**（如 ch01_02，它是回合流程场景且已被 ch01_01 引用、可达）。

1. `examples/starter/content/config/calendar.json` 加：
   `"onTurnStartEventId": "ev_turn_start"`、`"onTurnEndEventId": "ev_turn_end"`
2. `events.json` 的 `events[]` 追加两条调度事件（once: false 才能每回合触发；
   `ScheduledEventDef` 要求 RelationshipEvent 形状，`once` 是必填字段）：
   ```json
   { "id": "ev_turn_start", "characterId": "lynn", "when": "true", "scene": "ch01_02", "once": false, "priority": 1 },
   { "id": "ev_turn_end", "characterId": "lynn", "when": "true", "scene": "ch01_02", "once": false }
   ```
   注意：`when` 表达式必须合法布尔（`"true"` 可过 evalExprBoolean，但请实测；
   不行就用恒真条件如 `lynn.trust >= 0`）。这两条会进 AffectionSystem 的同一
   events 数组吗？**不要混用**——AffectionSystem 也消费 events.json 的 events[]
   （main.ts L154-158）。两个选择：(a) 给 events.json 加独立顶层数组
   `"scheduled": [...]`，starter 用它构造 EventScheduler；(b) 复用同一数组但
   AffectionSystem 对多余事件无副作用（它的 availableEvents 只在被查询时返回）。
   **推荐 (a)**：干净，互不污染；JSON 顶层加字段不需要改任何 TS 类型
   （starter 用 `eventsConfig.scheduled as ScheduledEventDef[]` 断言即可，
   参照 L155-156 的既有断言模式）。
3. `main.ts`：
   - import `EventScheduler`、`ScheduledEventDef`（core 已导出，index.ts L29）
   - 实例化：`const scheduler = new EventScheduler(eventsConfig.scheduled as ScheduledEventDef[], store);`
   - SystemHooks snapshot 加 `eventScheduler: scheduler.snapshot()`；
     restore 加 `if (s.eventScheduler) scheduler.restore(s.eventScheduler);`
   - `case 'calendar'`：打开地图（renderMap 首次调用前）先消费回合头事件：
     `const startId = calendar.turnStartEventId;` 若有，`const ev = scheduler.fire(startId);`
     （或 dispatch 按优先级取最高）→ `if (ev) interp.hostJump(ev.scene);`
     注意 hostJump 会 resumeHost 并跑场景，场景结束（sceneEnd 或 @end）后
     宿主需重新打开地图——参照现有"事件场景播完回地图"的处理路径；
     **最简稳妥方案**：头事件只在回合数>1 时跳演出，或仅应用 effects + 打日志，
     把"跳演出"留给尾事件。若嫌复杂，可让头事件只做 effects 结算不跳场景
     （fire 返回 ev 但宿主不调 hostJump），闭环语义依然成立（getter 被消费、
     fired 持久化）。但报告点名的是"回合头尾事件闭环"，至少一处真实 hostJump 更有说服力。
   - onEndTurn 回调（L291-294）：`advanceTurn()` 之前先消费尾事件：
     ```ts
     () => {
       const endId = calendar.turnEndEventId;
       let jumped = false;
       if (endId) {
         const ev = scheduler.fire(endId);
         if (ev) {
           // effects 由 fireInto 写回更省事：scheduler.fireInto(endId, store)
           interp.hostJump(ev.scene); // 场景结束后经 sceneEnd 回标题/续流（现有路径）
           jumped = true;
         }
       }
       calendar.advanceTurn();
       if (!jumped) interp.resumeHost();
     }
     ```
     注意顺序与状态机：hostJump 内部会清 hostPaused 并跑场景；若尾事件场景
     以 @jump 回 ch01_01/ch01_02（现有场景都这样收尾），剧情流自然续上，
     不需要 resumeHost。请实测这条路径（地图→尾事件场景→剧情续跑），
     确保无"暂停悬挂"或"地图覆盖层残留"（hideMap 时机见 pixi-stage.ts L1614）。
4. `save-manager.ts` L17-18 注释去掉"预留"字样。
5. **core 测试**（报告点名"补 core 测试"）：EventScheduler 自身测试已有
   （`packages/core/test/event-scheduler.test.ts`，4918 bytes，覆盖 eligible/fire/fired）。
   缺的是 **CalendarRunner getter 测试**：补 `packages/core/test/calendar.test.ts`——
   构造带 onTurnStartEventId/onTurnEndEventId 的 config，断言
   `turnStartEventId`/`turnEndEventId` getter 返回配置值；缺省配置返回 undefined。

---

## 3. 未完成：M3 —— level_5 成就不可达

### 现状（已核实）
- `examples/starter/content/config/achievements.json` L5：
  `{ "id": "level_5", ..., "hidden": false }` **无 when 字段**
- `main.ts` L683-697 `bus.on('growth')`：升级后 `checkAchievements()`（L695），
  但 `AchievementSystem.check()` 只判定带 when 的成就（achievement.ts 的 check 实现），
  level_5 永远无法解锁。注释 L695 声称"如 level_5"，与事实矛盾。
- `AchievementSystem.unlock(id)` 存在（achievement.ts L114），未知 ID 抛错，重复解锁 fresh=false。
- `growth.levelOf(characterId)` 存在（growth.ts L110 附近）。

### 建议方案（最小改动）
`main.ts` 的 `bus.on('growth')` 回调内，`checkAchievements()` 之前补显式解锁：
```ts
// 事件触发类成就：等级里程碑（无 when 字段，check() 不会命中）
try {
  for (const def of (achievementsConfig as AchievementDef[]).filter((d) => !d.when)) {
    // 或更简单：直接硬编码 level_5 规则
  }
} catch { ... }
```
**更直白的写法**（推荐，示例代码以清晰为先）：
```ts
if (growth.levelOf(p.characterId) >= 5) {
  try {
    const res = achievements.unlock('level_5');
    if (res.fresh) stage.showBanner(`成就解锁：${res.def.name}`, 'tip');
  } catch (err) { console.warn('[starter] level_5 unlock failed:', err); }
}
```
（banner 样式参照 L455 `stage.showBanner(..., 'tip')` 与 checkAchievements L705 的既有模式）

---

## 4. 未完成：五个 Minor

### Minor 1 —— 存档深校验不对称（save-manager.ts）
- 落点：`assertValidSnapshot`（save-manager.ts L108 起）。顶层 clears（L151-156）/
  growth（L157-173）已有深校验；systems 只有顶层对象形状兜底（L174-177，
  注释"审计修复：深度校验补全"但实际未补 systems 内部）。
- 修法：在 L177 之后对 `s.systems` 展开校验：
  - `achievements.unlocked`：string[]（参照 gallery.cgs 校验模式 L140-150）
  - `eventScheduler.fired`：string[]
  - `calendar.commandCounts`：Record<string, number>（值为 number 的对象；
    参照 growth.levels/experience 的校验模式 L162-171）
  - calendar 顶层（turn/ap/visited）旧有校验情况请先看 L108-150 全段再补
- 测试：`packages/core/test/save.test.ts` 的 `makeSnap()` 模式现成——
  构造 systems.achievements.unlocked 非数组等畸形快照，断言 assertValidSnapshot 抛错含原因。
  注意 restore 中途抛错的根因：achievement.ts L140 `restore` 里
  `[...new Set((snap.unlocked ?? []).filter(...))]`——unlocked 为非数组时 filter 抛错。

### Minor 2 —— dsl-spec L241 滞后
- 落点：`docs/dsl-spec.md` L241（"> lint 也会校验 content/config/*.json …"段落）。
- 修法：把 `calendar.json` 的覆盖说明补上 `baseCommands[].when`，
  achievements.json 补 `[].when`。实现已在 cli/src/lint.ts L342-350（baseCommands when）
  与 L380-389（achievements when），只改文档一行。

### Minor 3 —— 周目计数语义虚增（main.ts L668-680）
- 落点：`bus.on('clear')`（main.ts L669-680）。当前逻辑：每个**新结局**
  `rec.playthroughs += 1`（L673）。同一周目达成多结局时周目数虚增。
- 修法（二选一）：
  (a) playthroughs 语义改为"达成过结局的周目数"：只在
      `rec.endings.length === 0 || 距上次 clearedAt 跨过了新周目` 时 +1——
      starter 没有可靠的"周目边界"信号，实现复杂；
  (b) **推荐**：保持计数但改语义标注——字段改名/注释为"累计达成结局数"，
      日志 L678 改为 `结局 ${p.ending}（累计达成 ${rec.endings.length} 个结局）`，
      L749 `第 ${rec.playthroughs + 1} 周目` 的推算同步调整（那里用 playthroughs+1
      作为新周目序号，同样受虚增影响；若 (b) 则该处应改为别的计数源，
      或接受"以结局数近似周目数"并在注释声明）。
  **注意**：GlobalClearRecord 落 localStorage（key `surdet:clearRecord`），
  改字段名要考虑旧记录兼容（读出的旧 JSON 无新字段时兜底）。
  请阅读 clear-tracker.ts 注释确认设计意图后再定方案。

### Minor 4 —— statGrowth 静默跳过 + lint 无校验
- 落点 A：`packages/core/src/systems/growth.ts` L137-141：
  ```ts
  for (const [varName, delta] of Object.entries(profile.statGrowth ?? {})) {
    const cur = this.#store.get(varName);
    if (typeof cur === 'number') this.#store.modify(varName, delta);
  }
  ```
  未声明/非 number 静默跳过，与类注释"严格策略"矛盾。
  修法：改为抛错（`throw new Error(\`GrowthSystem: statGrowth 变量 '${varName}' 未声明或非 number\`)`）。
  **风险检查**：growth.test.ts 现有用例全部声明了 lynn.atk/lynn.hp（L13-16、L25、L139），
  改严格不会破坏现有测试；但要全仓 grep `statGrowth` 确认无其他依赖静默跳过的测试。
- 落点 B（lint 扩展，报告 Suggestion 3）：cli/src/lint.ts 的 CONFIG_EXPR_SCANS
  是表达式扫描表，**不适用于**"statGrowth 键必须已声明变量 / levelEvents 值必须存在场景"
  这两类校验（它们不是表达式）。需要在 lintProject 里新增独立校验段：
  - 读 growth.json（参照 readConfigJson，L447；runConfigLint 主流程 L438 附近），
    statGrowth 键 ∉ 声明变量表 → warning/error；
    levelEvents 值（场景 ID）∉ 已编译场景集合 → 报（J001 同族）。
  - 注意 lintProject 的 variables 集合（L48 loadVariables 返回）与 scenes 集合（L45）都现成。
  - 这条是"建议"级，工作量大，**可最后做或标注为后续任务**。

### Minor 5 —— 解释器指令不去引号（interpreter.ts）
- 落点：interpreter.ts 的 `#execGeneric`——`case 'clear'`（L783-790）与
  成就路径（L840-849 的 `case 'achievement'` 经 system 事件 args 直传宿主，
  宿主 main.ts L450-451 消费 p.args[0]/p.args[1]）。
- 现状：DSL lexer 会把 `@clear "ed1"` 的 `"ed1"` 作为带引号 token 传入 args；
  渲染层有通用 dequote（renderer/src/dequote.ts），但解释器侧消费的指令不过它。
- 修法（二选一）：
  (a) **core 内新增 dequote**：在 interpreter 侧对 @clear 的 arg0 与 system 事件
      args 统一去引号。注意 core 零依赖原则——不能 import renderer 的 dequote，
      需在 core 内实现一份（逻辑抄 renderer/src/dequote.ts，约 25 行）。
      落点建议：`case 'clear'` 的 ending 计算处 + `#execGeneric` 的 default/系统指令
      发射前对 args 映射 dequote。**影响面评估**：unlock_cg/unlock_music/unlock_text
      （L765-781）也用 arg0 原样——报告说"与既有 unlock_* 行为一致"，
      若统一在 #execGeneric 入口 dequote 所有 args，会同时改变 unlock_* 行为
      （引号 ID 从"原样写入 gallery"变成"去引号"）——这是修坑不是破坏，
      但需补/改对应测试；保守做法：只 dequote @clear 与 @achievement 的 args，
      其余不动，注释说明契约。
  (b) 只在 dsl-spec 声明"指令参数不要加引号"，代码不动——不推荐，坑仍在。
- 测试：interpreter.test.ts 补 `@clear "ed1"` 断言 clear 事件 ending === 'ed1'。

---

## 5. 报告 Suggestion 4（可选，不建议做）

starter `bus.on('text', () => checkAchievements())`（main.ts L713）每条文本全量扫描。
报告明说"当前体量无碍"。**建议保持现状**，不动。

---

## 6. 验收基线（全部修完后必须满足）

1. `typecheck` 全绿（五包 + editor；npm scripts 见各 package.json，root 有 workspace 脚本）。
2. 测试基线：**core 254 / cli 63 / renderer 14 / shell 80 / editor 19**（整改前实测值；
   新增测试只会增加，不得减少）。
3. `surdet lint` 对 examples/starter：**0 错误 0 警告**（W007 可达性陷阱见 §2）。
4. diff 审查：无新的文档/实现漂移；@particle/@mov/@tint 既有行为不变
   （实现侧本次不应改动——M1 以实现为准）。
5. M2 实测：地图回合流程中头/尾事件真实触发（至少一处 hostJump 进演出场景并能续回）。

## 7. 关键文件索引（省得重新考古）

| 用途 | 文件 |
|---|---|
| DSL 规范 | docs/dsl-spec.md（L74-76 演出三件套、L241 lint 说明） |
| 架构宣称 | docs/architecture.md L49、L54 |
| 调度器 | packages/core/src/systems/event-scheduler.ts（全文 104 行） |
| 日历 | packages/core/src/calendar/calendar.ts（L62-63 字段、L144-151 getter、L198 advanceTurn、L255-264 snapshot/restore） |
| 宿主接线 | examples/starter/src/main.ts（L150-183 系统实例+SystemHooks、L253-295 calendar 事件、L448-461 achievement、L669-680 clear、L683-697 growth、L701-713 checkAchievements） |
| 配置 | examples/starter/content/config/{calendar,events,growth,achievements}.json |
| 场景 | examples/starter/content/scenario/{ch01_01,ch01_02,ch02}.gal（仅 ch01_01/ch01_02/ch02 三场；ch01_02 被 ch01_01 引用、可达） |
| 存档校验 | packages/core/src/save/save-manager.ts（L13-23 SystemSnapshots、L108 assertValidSnapshot） |
| 解释器 | packages/core/src/runtime/interpreter.ts（L26-31 SystemHooks、L656-674 hostJump、L783-790 @clear、L840-849 系统指令转发） |
| 成就 | packages/core/src/systems/achievement.ts（L100 check、L114 unlock、L134-140 snapshot/restore） |
| 成长 | packages/core/src/systems/growth.ts（L110 levelOf、L122-154 gainExp、L137-141 statGrowth） |
| lint | packages/cli/src/lint.ts（L227-263 W006、L265-307 W007、L312-390 CONFIG_EXPR_SCANS、L438 runConfigLint、L447 readConfigJson） |
| 渲染契约 | packages/renderer/src/types.ts L47-57、adv-renderer.ts L466-493、pixi-stage.ts L67-73/L1563/L1614 |
| 测试模式 | packages/renderer/test/adv-renderer.test.ts（FakeStage）、packages/core/test/save.test.ts（makeSnap）、growth.test.ts |

---

## 8. 前一个 AI 的失败教训（请引以为戒）

- 不要反复漫游取证。所有落点已在 §7 索引齐，直接按 §1-§4 施工。
- M2 不要走"只打日志"的假闭环，也不要为头尾事件新建场景（W007 陷阱）。
- 每改一处跑一次相关包测试（`npm test -w @surdet/core` 等），不要攒到最后。
- 提交信息风格参照既有：`fix: 审计轮4 —— ...`（中文，说明改了什么+为什么）。
