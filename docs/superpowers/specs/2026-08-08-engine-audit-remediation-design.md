# Surdet 引擎审计整改设计规格

> 日期：2026-08-08
> 输入：`C:\Users\Equinox\Desktop\尊敬的总经理大人请过目.md` v3.2
> 执行模式：一名执行 AI 串行完成全部任务
> 本文只定义设计、边界和验收，不授权提交、推送、删除存档或清理工作树。

## 1. 目标

在不引入游戏特例、不破坏既有存档兼容性、不清理用户未提交改动的前提下，完成审计确认的 5 项 P1 与 10 项 P2 整改，并用《零点之后》的最终 Electron 发行包证明修复有效。

本轮优先解决：

1. 正式发行误打为 starter。
2. 损坏系统快照在读档中途造成部分状态恢复。
3. 商店购买异常时出现部分写入。
4. 立绘补间、Ruby 文本和音频缓存的生命周期问题。
5. 已确认的类型、持久化和 CLI 审计可靠性问题。

## 2. 范围

### 2.1 纳入实施

- P1：G12、F2、F3、F1、S1。
- P2：S2、G2、S8、S11、S4、S7、F4、F5、G8、G9。
- S4 采用“先测量、后决策”：只有基准超过本文阈值才修改 I/O 架构。

### 2.2 明确不纳入

- 加固/技术债：S9、S5、S12、F7、G11、CQ4。
- 非缺陷项：GA1、P3、G7、S10、G1、G6。
- 商业能力规划：新增转场、宏、热重载、脚本加密、回退、科学计数法、扩展转义、可种子 RNG、构建缓存等。
- 《零点之后》的剧情、美术、数值和平衡调整。
- 与整改无关的重构、依赖升级和格式化。

## 3. 全局安全边界

- 仓库固定为 `E:\surdet`，Node.js 要求 `>=20`，Windows PowerShell 环境。
- 当前工作树含大量既有未提交改动。禁止 `git reset --hard`、`git clean -fd`、`git checkout -- .` 和批量覆盖。
- 禁止删除或迁移 `userData` 中的存档、设置和日志。
- 默认不 commit、不 push；只有项目所有者明确授权后才能执行。
- 修改代码必须使用补丁方式，并在每个任务后重新读取目标文件确认落盘。
- 引擎层只接受通用能力；不得把 `zero-after-midnight`、`prologue` 或正式游戏标题硬编码进 core、renderer、shell 通用逻辑。
- 正式发行必须保持素材加密。`SURDET_PACK_MODE=release`（缺省值）下检测到 `SURDET_ENCRYPT=0` 必须直接失败，不能仅依赖操作者清理环境变量。

## 4. 总体执行架构

单一执行 AI 按以下顺序串行工作：

1. 冻结基线与建立测试证据。
2. 修复发行目标安全。
3. 修复存档与商店状态正确性。
4. 修复立绘与 Ruby 渲染生命周期。
5. 重构音频缓存与声道生命周期。
6. 处理剩余 P2 和 S4 性能门。
7. 执行全仓门禁、正式打包和真实程序启动验收。

任务之间不得跨阶段混改。每个阶段必须先通过局部测试，再进入下一阶段；最终门禁失败时，回到首次引入失败的阶段修复。

## 5. 组件设计

### 5.1 发行目标安全（G12）

#### 目标

任何打包操作都必须明确知道目标游戏，且产物能够证明自己来自该目标。不能再依赖“未传参数时默认 starter”。

#### 设计

- `surdet pack <gameDir>` 要求位置参数存在；缺失时返回非零退出码并打印明确用法。
- `packages/shell/prepare-pack.mjs` 要求非空 `SURDET_GAME_DIR`；直接运行 shell 打包但未设置该变量时立即失败。
- `prepare-pack.mjs` 不再删除或重建 `packages/shell/game`。新的唯一 staging 根目录为 `packages/shell/.pack-stage`，electron-builder 通过 `from: .pack-stage/game`、`to: game` 把它映射为 app.asar 内的 `game/`。
- `.pack-stage` 首次创建时写入根标记 `.surdet-staging-root.json`。后续清理前必须同时验证：解析后的绝对路径严格等于 `packages/shell/.pack-stage`，且根标记包含 `{ "engine": "surdet", "purpose": "pack-staging" }`。任一条件不满足即失败，禁止递归删除。
- 既有 `packages/shell/game` 保持原样且不再参与打包；执行 AI 不删除、不移动其中内容。`.pack-stage` 加入仓库 `.gitignore`。
- `prepare-pack.mjs` 在复制目标游戏后生成 `.pack-stage/game/release/pack-metadata.json`，结构固定为：

```ts
interface PackMetadata {
  engine: 'surdet';
  game: string;
  version: string;
  title: string;
  entryScene: string;
  sourceDirName: string;
  assetFiles: string[];
  mode: 'release' | 'development';
  encrypted: boolean;
}
```

- `game`、`version` 来自目标游戏 `package.json`；`title`、`entryScene` 来自目标 `game.config.json`；`assetFiles` 是目标 `content/assets` 的排序后相对路径清单。
- `verify-pack.mjs --preflight` 校验 `.pack-stage/game` 内配置、manifest 和 metadata 三者身份一致。
- `verify-pack.mjs --artifact` 从 app.asar 读取 metadata、配置和 manifest，校验三者一致，并核对 metadata 中全部素材均存在于 app.asar。
- 校验器保持通用，不硬编码正式游戏名称。发行命令通过环境变量声明期望值：

```text
SURDET_EXPECTED_GAME=zero-after-midnight
SURDET_EXPECTED_ENTRY=prologue
```

- 当期望值存在时必须精确匹配；不匹配直接阻止发行。标题不作为命令行必填值，但必须是非空字符串且 staged/artifact 一致。
- `SURDET_PACK_MODE` 只接受 `release` 或 `development`，缺省为 `release`。release 模式检测到 `SURDET_ENCRYPT=0` 必须在任何 staging 写入前失败；metadata 必须记录 `mode: 'release'`、`encrypted: true`，preflight 和 artifact 再次核验。
- development 模式可显式配合 `SURDET_ENCRYPT=0` 生成本地调试 staging，但 `verify-pack --artifact` 缺省拒绝 development/plaintext metadata；只有显式调试校验参数才能读取它，不能把它当正式产物通过。

#### 错误处理

- 目标目录缺失、配置解析失败、字段缺失、metadata 不一致、素材清单不一致、release 模式关闭加密、staging 根标记异常均返回退出码 1。
- 校验失败不得继续调用 electron-builder。

### 5.2 存档深校验（F2）

#### 目标

所有系统快照在任何状态恢复前一次性完成结构校验，损坏数据不得造成变量、已读集、鉴赏、成长或系统状态的部分恢复。

#### 设计

- 在 `assertValidSnapshot` 内补充 `systems.combat` 和 `systems.affection` 深校验。
- combat 至少校验：`units` 数组、每个单位的必需标量字段、`skills` 字符串数组、`cooldowns` 有限数值表、`turn` 有限正数、`actingTeam` 字符串、`winner` 为字符串或 null、`finished` 布尔值、可选 `moved` 字符串数组。
- affection 校验：`consumed` 字符串数组；可选 `everConsumed` 字符串数组，以保留旧档兼容。
- 所有 number 字段必须为有限数；不能只判断 `typeof number`。
- `assertValidSnapshot` 是唯一入口验证来源；shell 与解释器继续复用它，不复制第二套验证器。
- `CombatSolver.restore` 仍保留与配置相关的语义校验，例如阵营是否合法、HP 是否在范围内。入口结构校验不替代系统语义校验。

#### 失败语义

结构错误必须在 `loadSnapshot` 的任何 restore 调用前抛出统一的“存档结构非法”错误；失败后所有运行时状态保持调用前不变。

### 5.3 商店原子写入（F3）

#### 目标

一次购买要么同时更新金币和背包，要么完全不更新。

#### 设计

- 在 `VariableStore` 增加批量原子接口：

```ts
setMany(updates: readonly { name: string; value: VarValue }[]): void
```

- `setMany` 第一阶段对所有变量执行：已声明、非 readonly、类型合法、数值约束可计算；将强制转换后的值保存在临时数组中。
- 只有第一阶段全部成功后，第二阶段才写入 `#values`。
- 同一批次出现重复变量名时拒绝执行，避免提交顺序产生歧义。
- `ShopSystem.buy` 先读取并验证金币、背包和商品，再构造下一状态，最后通过一次 `setMany` 提交。
- 重复购买的既有契约保持不变：金币照扣，背包仍去重。

### 5.4 立绘补间生命周期（F1）

#### 目标

移除立绘后，不再有任何补间持有或更新被销毁的 Sprite。

#### 设计

- `removePortrait` 先确定将移除的角色 key 和 Sprite 集合。
- 删除与这些 Sprite 相关的 `#movTweens`。
- 删除 `old` 或 `neu` 命中这些 Sprite 的 `#portraitTweens`。
- 对交叉淡化补间中的另一个孤儿 Sprite：若已不在 `#portraitSprites` 且仍挂在容器上，则从容器移除并销毁。
- 使用 `Set<Sprite>` 去重，确保每个 Sprite 最多销毁一次。
- `resetSession` 和 `destroy` 保持最终兜底清理，但不能依赖它们修复正常 `@hide` 路径。

### 5.5 Ruby 布局与对象复用（F4/F5）

#### 目标

Ruby 文本遵守对话框宽度和 CJK 禁则规则，同时避免每次文字更新都销毁并重建全部 Pixi Text。

#### 设计

- 在 `packages/renderer/src/ruby-layout.ts` 新建纯布局模块，不依赖 DOM 或 Pixi。
- 输入和输出接口固定为：

```ts
interface RubyMeasure {
  base(text: string): number;
  ruby(text: string): number;
}

interface RubyGlyphLayout {
  base: string;
  ruby?: string;
  x: number;
  y: number;
  width: number;
  line: number;
}

function layoutRuby(
  segments: readonly RubySegment[],
  maxWidth: number,
  measure: RubyMeasure,
  lineHeight: number,
): RubyGlyphLayout[]
```

- 布局以 Ruby segment 为最小不可拆单位；无 Ruby 的长 segment 按现有 CJK 禁则逻辑拆分。带 Ruby 的 base 与注音必须同处一行。
- 单个带 Ruby segment 自身超过最大宽度时允许独占一行，不截断、不死循环。
- `PixiStage` 维护 base/ruby 两组 `PText` 对象池。需要 N 个对象时复用前 N 个，隐藏多余对象；只在池容量不足时创建新对象。
- `resetSession` 可隐藏并保留池；`destroy` 必须销毁整个池。
- 未闭合 Ruby 标记继续走纯文本路径；完成标记后切换到 Ruby 布局。

### 5.6 音频缓存与声道生命周期（S1/S2/G2）

#### 目标

同一源文件跨声道播放互不干扰，长会话的缓存和声道记录保持有界。

#### 设计

- 用组合键区分缓存：

```ts
type AudioChannel = 'bgm' | 'se' | 'voice';
type AudioCacheEntry = {
  key: string;
  src: string;
  channel: AudioChannel;
  howl: Howl;
  lastUsed: number;
};
```

- cache key 固定为 `${channel}\u0000${src}`，BGM、SE、voice 不共享 Howl。
- 用单一 `Map<string, AudioCacheEntry>` 取代互相漂移的 `#cache` 与 `#channels` 双 Map。
- 分声道缓存上限固定为：BGM 8、SE 32、voice 8。数字是内存保护上限，不是预加载数量。
- 每次创建或播放更新单调递增的 `lastUsed`。
- 超限时只淘汰 `howl.playing() === false` 且不是当前 `#bgm`/`#voice` 的最久未使用条目；淘汰调用 `unload()`。
- 若所有候选都在播放，本次允许暂时超限；在音频结束、停止或下一次播放时再次收敛。
- Howl 的 `end` 和 `stop` 事件都必须触发淘汰收敛；事件回调只能清理和收敛当前条目，不得误删同源但不同声道的条目。
- `stopAll` 停止全部播放并清空活动引用，但保留可复用缓存；随后执行一次淘汰收敛。
- `dispose` 停止、卸载并清空全部条目及格式表。
- Blob URL 的格式注册继续按原始 `src` 查询，不改现有 MIME/format 修复。

### 5.7 剩余 P2

#### S7：递归变量类型

- 将运行时允许的 JSON 安全嵌套结构表达为递归类型，但不放宽现有运行时规则：

```ts
export type VarPrimitive = string | number | boolean;
export type VarValue = VarPrimitive | VarValue[] | { [key: string]: VarValue };
```

- `null` 当前不属于 `VariableStore` object 合法值，本轮不新增 null 支持。
- 各声明类型仍由 `assertType` 限制：`string[]` 和 `number[]` 不因递归类型而接受混合数组。
- 同步修改 `cloneValue` 的对象容器类型与递归返回类型，禁止继续把嵌套值强制转换为 `VarPrimitive`；克隆后的静态类型必须与新的递归 `VarValue` 一致。

#### S8：减少道具数组复制

- `add_item` 和 `remove_item` 只读使用 `getRef`，构造新数组后调用 `set`；不得原地修改 `getRef` 返回值。
- 保持外部 `get()` 的防御性拷贝契约不变。

#### S11：窗口状态原子写入

- 抽取 shell 内部 `writeJsonAtomic(file, data)`，采用同目录 `.tmp` 写入后 rename。
- 设置和窗口状态共同使用该函数，避免两套实现漂移。
- 写失败继续不阻断退出，但不得留下半截正式 JSON 文件。

#### S4：同步 I/O 性能门

- `FileSaveStore.MAX_SAVE_BYTES` 当前为 10 MiB，基准必须经过真实存档 API 且不得绕开大小限制；测试档位固定为 1 MiB、5 MiB、9 MiB。
- 每档分别运行 `write/read/listMeta` 20 次，使用独立临时目录，记录 p50/p95，并在结束后只清理该临时目录。
- Windows 本机验收阈值：9 MiB 单次 write 或 read 的 p95 超过 50 ms，才进入异步 I/O 改造。
- 未超过阈值时只保留基准测试和结果，不改 `FileSaveStore` API。
- 超过阈值时另起独立设计，不在本轮临时把同步类改成异步，避免 IPC、备份和索引语义被连带破坏。

#### G8/G9：CLI 审计可靠性

- 删除 `opt.blockStart + 32` 魔数；搜索上界使用该 choice 的 `afterIndex`。
- 遇到会结束当前选项块的 label/jump/end/choice 时停止搜索。
- `cmdAudit` 在理论上不应出现的二次编译失败时必须输出文件、错误消息并返回非零状态，不能静默跳过场景后生成不完整审计。

## 6. 测试策略

### 6.1 TDD 规则

每个功能任务必须先增加能够在旧实现上失败的测试，确认失败原因与目标缺陷一致，再写最小实现。禁止先改代码、后补一个无法证明回归的测试。

### 6.2 局部测试映射

| 任务 | 测试位置 | 必测行为 |
|---|---|---|
| G12 | `packages/cli/test`、`packages/shell/test` 或脚本级 fixture | 无目标失败、身份不匹配失败、release 明文失败、staging 无合法标记时拒绝清理、正确目标通过、artifact metadata 一致 |
| F2 | `packages/core/test/save.test.ts`、`interpreter-save.test.ts` | 畸形 combat/affection 被入口拒绝、失败前后状态不变、旧 affection 快照兼容 |
| F3 | `packages/core/test/shop.test.ts`、`variable-store.test.ts` | 任一更新非法则两项均不变、成功提交、重复 key 拒绝 |
| F1 | `packages/renderer/test/pixi-stage.test.ts` | 交叉淡化/移动中 hide，后续帧不访问已销毁 Sprite、无悬空补间 |
| F4/F5 | `packages/renderer/test/ruby-layout.test.ts`、`pixi-stage.test.ts` | 多行布局、禁则、超宽 segment、对象池复用、destroy 释放 |
| S1/S2/G2 | `packages/renderer/test/audio-manager.test.ts` | 跨声道隔离、LRU 上限、活动实例保护、onend/onstop 后收敛且不误删其他声道、dispose 全释放 |
| S7/S8 | `packages/core/test/variable-store.test.ts`、`interpreter.test.ts` | 递归对象类型与 cloneValue 一致、非法值拒绝、道具指令行为不变且不修改内部引用 |
| S11 | `packages/shell/test` | tmp→rename、失败回退、设置与窗口状态共用原子写工具 |
| S4 | `packages/shell/test` 或独立 benchmark 脚本 | 固定大小、固定轮次、输出 p50/p95、无用户目录写入 |
| G8/G9 | `packages/cli/test/audit.test.ts` | 32 条之后的 goto 仍能分析、编译异常可见且命令失败 |

### 6.3 全量验收

代码阶段完成后必须执行：

```powershell
Set-Location E:\surdet
npm run typecheck
npm test
npm run lint -w surdet-starter
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight
node examples/zero-after-midnight/scripts/check-assets.mjs
npm run verify:p1p2
npm run e2e -w @surdet/shell
```

正式发行阶段必须显式执行：

```powershell
Set-Location E:\surdet
npm run build -w zero-after-midnight
$env:SURDET_GAME_DIR = 'E:\surdet\examples\zero-after-midnight'
$env:SURDET_EXPECTED_GAME = 'zero-after-midnight'
$env:SURDET_EXPECTED_ENTRY = 'prologue'
$env:SURDET_PACK_MODE = 'release'
Remove-Item Env:SURDET_ENCRYPT -ErrorAction SilentlyContinue
npm run pack -w @surdet/shell
node packages/shell/scripts/verify-pack.mjs --artifact
```

最后启动：

```powershell
& 'E:\surdet\packages\shell\release\win-unpacked\Surdet Game.exe'
```

真实运行必须确认：标题为《零点之后》、入口为 prologue、无默认占位素材、图片/字体/音频无加载错误、快速存档和快速读档成功。

## 7. 完成定义

只有同时满足以下条件，执行 AI 才能宣布完成：

1. 5 项 P1 均有旧实现失败、新实现通过的自动测试。
2. 10 项 P2 均已实现，或 S4 基准低于阈值并以数据关闭。
3. 全量验收命令全部退出码为 0。
4. 正式包身份、入口、素材清单和 app.asar 校验通过。
5. 真实解包程序完成启动、首场景、素材、音频、字体、快速存读档验证。
6. 没有删除或覆盖既有未提交文件，没有改动用户存档，没有提交或推送。
7. 交付报告列出改动文件、命令结果、发行产物绝对路径、遗留风险和 S4 基准数据。

## 8. 明确否决条件

以下任一情况发生，本轮不得验收：

- 未指定游戏目标仍能打包成功。
- 校验器只检查“文件存在”，不能证明包内游戏身份。
- release 模式允许 `SURDET_ENCRYPT=0`，或正式 artifact metadata 不是 `mode: release`、`encrypted: true`。
- 打包流程递归删除 `packages/shell/game`，或在未验证专用 staging 根路径与标记时执行递归删除。
- 损坏快照在任何 restore 已发生后才报错。
- 商店失败路径仍会改变金币或背包之一。
- 活动会话音频缓存无界增长，或跨声道共享 Howl。
- Ruby 长文本仍越界，或每次更新仍销毁全部文本对象。
- 只通过开发预览，未验证最终 Electron 发行包。
- 为通过测试而硬编码《零点之后》的游戏 ID、入口或标题。
