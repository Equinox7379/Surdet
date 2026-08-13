# Surdet Player Experience Wave 6 — Gallery Content Integrity 交付报告

## 1. 结论与范围

Wave 6 的自动化内容完整性工作已完成，当前只请求独立复审，不请求 push、部署、打包或发行。

本轮完成了三件彼此独立的工作：

1. 在通用 `@surdet/cli` `surdet lint` 边界增加 Gallery 内容完整性校验，覆盖 `G001`–`G008`；
2. 按锁定清单修复《零点之后》的声明式 Gallery 配置、真实场景解锁图和 `zhirao` 头像键；
3. 按经理书面单点授权，移除 Starter 既有的悬空 `tense_01` Gallery 音乐声明及其三处剧情引用，使通用校验对 Starter 也能诚实通过。

没有修改 Renderer、Host、Shell、Editor、Core 运行时、存档格式、DSL 语法、性能体系、Wave 5B、剧情文本、图像资产或音频资产。没有进行 Electron 矩阵或人工视觉验收；本报告只证明静态内容完整性和比例适当的构建/模拟门禁。

## 2. 玩家价值

完成后，Gallery 配置不再把 Starter 的大厅、夜路、紧张时刻或不存在的文本场景呈现为《零点之后》的内容。音乐和文本回想条目都有真实的当前项目来源和剧情解锁点；没有为了填充 CG 列表而伪造或冒充普通背景的 CG 资产。`许知遥` 的已有头像文件通过声明式 `avatar` 键接入现有头像管线。

## 3. 通用 CLI 工具落点

新增的 `packages/cli/src/gallery-config-lint.ts` 是可复用、同步、确定性的纯校验模块。它只读取项目声明、已编译场景、场景标签和项目资产目录，并向现有 issues 数组追加问题；不访问 Renderer/Pixi、用户数据、Electron 或任何游戏专用名称。

`packages/cli/src/lint.ts` 作为组合根在现有 hint 附加之前调用该模块。`packages/core/src/lint-hints.ts` 增加了 `G001`–`G008` 的可操作修复提示。

校验语义如下：

| 代码 | 校验内容 |
|---|---|
| `G001` | Gallery JSON 结构、数组、条目字段和可选字段类型 |
| `G002` | 同一分类内的重复 ID |
| `G003` | CG/music 源键对应的 `bg`/`bgm` 素材 stem |
| `G004` | 文本回想目标场景存在性 |
| `G005` | 可选文本回想标签存在性 |
| `G006` | 实际编译场景中的 `@unlock_*` 参数与 Gallery 条目匹配 |
| `G007` | 每个配置条目至少有一个适当分类的实际解锁点 |
| `G008` | 已显式配置的角色头像键对应真实 avatar 素材 |

素材索引使用文件 stem，不硬编码 `.png`、`.wav` 或 `.mp3` 扩展名。缺少可选头像配置不会报错；显式配置了无效头像键才会报 `G008`。

## 4. 《零点之后》的精确映射

### Gallery 配置

- `cgs` 保持严格的空数组 `[]`；本轮没有创建 CG，也没有把普通背景冒充 CG。
- 音乐 ID 共 10 个，顺序和配置为：
  `midnight_rain`、`old_room`、`convenience_hum`、`underground_signal`、`investigation`、`last_train`、`ending_testimony`、`ending_meeting`、`blackout`、`ending_silence`。
- 文本 ID 共 11 个，顺序和配置为：
  `prologue`、`common_0017`、`common_apartment`、`common_convenience`、`common_passage`、`route_testimony_station`、`route_testimony_rooftop`、`route_meeting_train`、`route_meeting_rooftop`、`route_silence_blackout`、`route_silence_dawn`。
- `prologue` 文本回想保留从场景开头回放，不增加虚构的 `start` 标签；其他十个文本回想均指向对应场景的真实 `start` 标签。

### 真实 unlock 图

实际源文件中存在 22 条 unlock 指令：

- 文本 11 条：
  - `prologue.gal` — `@unlock_text prologue`
  - `common_0017.gal` — `@unlock_text common_0017`
  - `common_apartment.gal` — `@unlock_text common_apartment`
  - `common_convenience.gal` — `@unlock_text common_convenience`
  - `common_passage.gal` — `@unlock_text common_passage`
  - `route_testimony_station.gal` — `@unlock_text route_testimony_station`
  - `route_testimony_rooftop.gal` — `@unlock_text route_testimony_rooftop`
  - `route_meeting_train.gal` — `@unlock_text route_meeting_train`
  - `route_meeting_rooftop.gal` — `@unlock_text route_meeting_rooftop`
  - `route_silence_blackout.gal` — `@unlock_text route_silence_blackout`
  - `route_silence_dawn.gal` — `@unlock_text route_silence_dawn`
- 音乐 11 条：
  - `prologue.gal` — `@unlock_music midnight_rain`
  - `common_0017.gal` — `@unlock_music midnight_rain`
  - `common_apartment.gal` — `@unlock_music old_room`
  - `common_convenience.gal` — `@unlock_music convenience_hum`
  - `common_passage.gal` — `@unlock_music underground_signal`
  - `route_testimony_station.gal` — `@unlock_music investigation`
  - `route_testimony_rooftop.gal` — `@unlock_music ending_testimony`
  - `route_meeting_train.gal` — `@unlock_music last_train`
  - `route_meeting_rooftop.gal` — `@unlock_music ending_meeting`
  - `route_silence_blackout.gal` — `@unlock_music blackout`
  - `route_silence_dawn.gal` — `@unlock_music ending_silence`
- CG unlock 为 0 条。`midnight_rain` 出现在两个真实来源场景是有意设计；运行时 GalleryState 会按 ID 去重。

### 头像

仅修改了 `examples/zero-after-midnight/game.config.json` 中的声明：

```json
"zhirao": {
  "name": "许知遥",
  "avatar": "zhirao"
}
```

`examples/zero-after-midnight/content/assets/avatar/zhirao.png` 未修改。最终只读 SHA-256 为：

```text
87344B6E86657483E1F7968C208DA67D60AB59BBFE249225BBC72DD74776649D
```

## 5. Starter 限定收口

### 原始红灯

Task 3 第一次运行 `npm run lint -w surdet-starter` 时，通用校验正确报告：

```text
✗ Gallery music 条目 'tense_01' 的素材键 'tense_01' 不存在于 content/assets/bgm
—— 4 个场景，1 个错误，0 个警告 ——
```

只读检查确认 `examples/starter/content/assets/bgm` 不存在，Starter 没有 `tense_01` 音频文件。这个问题是既有声明错误，不是 CLI 回归，也不是音乐功能优化。

经书面授权，原计划对 Starter 的“不修改”规则仅针对以下三个文件作了单点例外。只做了四处精确删除：

1. `examples/starter/content/config/gallery.json`：将 `music` 改为空数组 `[]`，保留 `cgs` 与 `texts` 原样；
2. `examples/starter/content/scenario/ch01_01.gal`：删除 `@bgm tense_01`；
3. `examples/starter/content/scenario/ch01_01.gal`：删除 `@unlock_music tense_01`；
4. `examples/starter/content/scenario/ch02.gal`：删除 `@bgm tense_01`。

没有生成、复制、合成、下载、重命名、替换或伪造任何音频；没有修改 Starter 的其他资产、CG、文本、背景、头像或字体。

### 同一命令绿灯

授权后重新运行同一命令：

```text
npm run lint -w surdet-starter
```

退出码 `0`，结果为 `4` 个场景、`0` errors、`0` warnings。之后 `rg -n "tense_01" examples/starter/content` 无匹配。

Starter 修复提交：

```text
8a6a455591471078985d91e0f6bee102c9be7dae fix(starter): remove missing gallery music reference
```

## 6. 红灯 → 绿灯证据

### Task 1：通用 CLI Gallery 校验

- 修复前：`npm exec --workspace @surdet/cli vitest -- run test/gallery-config-lint.test.ts` 退出 `1`；8 项中 7 项失败，说明旧 lint 没有 G001–G008 行为。有效 fixture 通过，证明测试夹具可运行。
- 修复后：同一命令退出 `0`；1 文件、8 tests 通过。
- CLI 全量回归：`npm run test -w @surdet/cli` 退出 `0`；8 文件、95 tests 通过。
- Core typecheck/build 和 CLI typecheck/build 均在本轮对应门禁中退出 `0`。CLI typecheck 曾在第一次运行中暴露新模块对可选 `src/label` 的 `unknown` 类型收窄问题；完成显式窄化后重新运行退出 `0`，没有放宽断言或吞掉错误。

### Task 2：《零点之后》真实 Gallery 图

- 修复前：`npx vitest run test/gallery-content-contract.test.ts` 退出 `1`；4 项全部失败，实际暴露 Starter 残留、缺头像声明、缺 unlock 源和不可用文本目录。
- 修复后：同一命令退出 `0`；1 文件、4 tests 通过。
- 修复后 CLI lint 退出 `0`；11 场景、0 errors、0 warnings。
- 修复后模拟退出 `0`；23/23 choice、3 endings、39 次 save/load smoke、runtime errors `0`。

### Task 3：消费者门禁与限定收口

- 第一次 Task 3 的 Starter lint 真实退出 `1`，保留为上面的原始红灯证据。
- 书面授权后，Starter lint 同命令退出 `0`，Starter typecheck/build 也退出 `0`。
- 随后 Zero lint、simulate、assets、typecheck、build 均退出 `0`。
- 没有把历史计划结果冒充为本轮授权后的新鲜结果；报告下表按阶段区分。

## 7. 实际命令与结果

| 阶段 | 命令 | 结果 |
|---|---|---|
| Task 0 基线 | `npm run build -w @surdet/core` | exit `0` |
| Task 0 基线 | `npm run build -w @surdet/cli` | exit `0` |
| Task 0 基线 | `npm run lint -w zero-after-midnight` | exit `0`，11 场景，0/0；旧工具缺口 |
| Task 0 基线 | `node examples/zero-after-midnight/scripts/check-assets.mjs` | exit `0`，44 assets |
| Task 0 基线 | `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000` | exit `0`，23/23，3 endings，0 runtime errors |
| Task 0 基线 | `npm run test -w @surdet/cli` | exit `0`，7 files / 87 tests |
| Task 1 red | `npm exec --workspace @surdet/cli vitest -- run test/gallery-config-lint.test.ts` | exit `1`，7/8 failed |
| Task 1 green | 同上 | exit `0`，8/8 passed |
| Task 1 | `npm run test -w @surdet/cli` | exit `0`，8 files / 95 tests |
| Task 1 | `npm run typecheck -w @surdet/core` | exit `0` |
| Task 1 | `npm run build -w @surdet/core` | exit `0` |
| Task 1 | `npm run typecheck -w @surdet/cli` | 最终 exit `0` |
| Task 1 | `npm run build -w @surdet/cli` | exit `0` |
| Task 2 red | `npx vitest run test/gallery-content-contract.test.ts`（Zero 工作区） | exit `1`，4/4 failed |
| Task 2 green | 同上 | exit `0`，4/4 passed |
| Task 2 | `npm run build -w @surdet/cli` | exit `0` |
| Task 2 | `npm run lint -w zero-after-midnight` | exit `0`，11 场景，0/0 |
| Task 2 | `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000` | exit `0`，23/23，3 endings，39 save/load，0 runtime errors |
| Task 3 首次 | `npm run test -w @surdet/cli` | exit `0`，8 files / 95 tests |
| Task 3 首次 | Core/CLI typecheck/build 四条命令 | 均 exit `0` |
| Task 3 首次 | `npm run lint -w surdet-starter` | exit `1`，既有 `tense_01` G003 |
| 授权后 | `npm run lint -w surdet-starter` | exit `0`，4 场景，0/0 |
| 授权后 | `npm run typecheck -w surdet-starter` | exit `0` |
| 授权后 | `npm run build -w surdet-starter` | exit `0`，864 modules transformed |
| 授权后 | `npm run lint -w zero-after-midnight` | exit `0`，11 场景，0/0 |
| 授权后 | `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000` | exit `0`，23/23，3 endings，39 save/load，0 runtime errors |
| 授权后 | `node examples/zero-after-midnight/scripts/check-assets.mjs` | exit `0`，44 assets |
| 授权后 | `npm run typecheck -w zero-after-midnight` | exit `0` |
| 授权后 | `npm run build -w zero-after-midnight` | exit `0`，907 modules transformed；仅有既有 chunk-size advisory |
| 直接核对 | Zero 残留 `rg` | 无匹配，exit `1` |
| 直接核对 | Zero unlock `rg` | 22 行：11 text、11 music、0 CG |
| 直接核对 | `Get-FileHash .../avatar/zhirao.png -Algorithm SHA256` | SHA-256 `87344B6E86657483E1F7968C208DA67D60AB59BBFE249225BBC72DD74776649D` |
| 直接核对 | Starter `tense_01` `rg` | 无匹配，exit `1` |

`rg` 无匹配时的退出码 `1` 是命令的正常 no-match 结果，不是门禁失败。

## 8. 保留的项目事实和明确排除项

当前自动化内容检查保持：

- Zero 场景数：11；
- choice 分支：23/23；
- 结局：3；
- 项目资产检查：44；
- Zero 模拟运行时错误：0；
- Starter lint：4 场景、0 errors、0 warnings。

本轮明确没有：

- 创建或更改 CG；
- 创建、更换或导入音频；
- 修改美术、头像图片、字体或其他资产；
- 修改 Renderer、Host、Shell、Editor、Core runtime、存档、DSL、剧情流程或游戏规则；
- 修改性能 artifact、比较器、阈值或执行性能测量；
- 修改 Wave 5B；
- 创建 Electron/Shell runner、截图矩阵或视觉 artifact；
- 进行人工玩家视觉验收；
- 进行文档治理或无关重构；
- 部署、打包、发行、push 或进入 M9。

## 9. 独立部署后人工玩家检查清单

本清单只供后续获得独立授权的开发态部署使用，本轮没有执行部署。开始前应确认窗口标题为 `零点之后 / AFTER MIDNIGHT`，入口是 `E:\surdet\examples\zero-after-midnight\dist` 而不是 Starter，并从全新游戏开始以避免旧存档残留 Gallery 解锁状态。

1. **从标题页打开鉴赏。** 三个标签和关闭操作响应正常；不出现 `大厅重逢`、`夜路同行`、`紧张时刻`、`大厅初遇` 或 `夜路同行` 等历史 Starter 条目。
2. **首场解锁。** 正常推进开场后，游戏内 Gallery 出现 `午夜来电` 和 `午夜雨声`；选择后进入/播放真实 Zero 内容，不出现错误对话框、卡死或意外返回标题。
3. **真实标题而非 Starter 标题。** 进入 common route 后重新打开 Gallery，内容应描述 Zero 的地点或故事，如 `红色笔记`、`雨夜便利店`、`地下通道`、`旧屋`、`便利店白噪`；不得指向不存在的 `ch01_01`/`ch01_02` 内容。
4. **文本回想来源。** 选择已解锁文本，进入对应现有场景，不报告缺失场景/标签；正常返回后游戏会话仍可用。
5. **头像接线。** 到达许知遥说话的台词时，在当前表现设计需要头像的区域通过正常头像管线显示她的已有头像；这是配置接线检查，不是重绘请求。
6. **不虚构 CG。** CG 标签可以为空，这是本轮正确结果；应保持稳定、可关闭，不出现 Castle/field 占位图或 broken-image。
7. **Wave 5B 回归点。** 选择按钮保持居中，Backlog 标题可读为白色，命令栏与继续指示器不重叠。

## 10. Git 与停止边界

Task 0 起始 HEAD：

```text
7fb3cdef7551225c11ce96f19663ada205d10e82
```

本轮普通本地提交链：

1. `7d8b7fcadaabe45513b06d0927ce4512c33abe49` — `feat(cli): validate gallery content integrity`
2. `a86682b15b786df7cd5bb0339db89d542b6f18e6` — `feat(zero): wire valid gallery content`
3. `8a6a455591471078985d91e0f6bee102c9be7dae` — `fix(starter): remove missing gallery music reference`

当前代码/内容 HEAD（第三个文档提交之前）为：

```text
8a6a455591471078985d91e0f6bee102c9be7dae
```

它相对 `surdet/main` 为 `3 0`。本报告与计划将由任务书授权的唯一第三个普通文档提交 `docs(engine): record wave 6 gallery integrity` 一起落盘；文档提交的真实 SHA 只在提交后由 `git rev-parse HEAD` 读取，不在提交前虚构。

提交前工作树除本计划的台账修改外没有其他 tracked 改动，并保留以下五个受保护未跟踪文件，均未修改、暂存、提交、删除或移动：

```text
?? AGENTS.md
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
```

最终文档提交后只执行任务书要求的只读 Git 复核；不 push、不部署、不打包、不发行、不做性能工作、不进入 M9，并停止在 `WAITING_FOR_REVIEW`。本轮没有完成视觉玩家验证，后续需要单独授权的开发态部署和人工检查。

## 11. 状态

```text
PLAYER_EXPERIENCE_WAVE_6_GALLERY_CONTENT_INTEGRITY_IMPLEMENTED
CLI_GALLERY_CONTRACT_VALIDATION_VERIFIED
ZERO_GALLERY_STARTER_RESIDUE_REMOVED
ZERO_GALLERY_UNLOCK_GRAPH_VERIFIED
ZHIRAO_AVATAR_CONFIGURATION_VERIFIED
STARTER_MISSING_GALLERY_MUSIC_REFERENCE_REMOVED
STARTER_GALLERY_LINT_VERIFIED
NO_CG_ASSETS_FABRICATED
NO_AUDIO_ASSETS_CHANGED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
NOT_DEPLOYED
WAITING_FOR_REVIEW
```
