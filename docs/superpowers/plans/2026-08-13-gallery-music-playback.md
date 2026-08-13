# Gallery Music Playback Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan serially, one task at a time. Checkboxes are mandatory progress markers. Do not skip the first red reproduction or claim the player issue is fixed from unit tests alone.

**Goal:** 修复《零点之后》标题页和游戏内“鉴赏 → 音乐”中，点击已解锁音乐后没有实际播放的问题，并把“鉴赏预览播放”与普通剧情 BGM 的行为明确分开。

**Architecture:** `GalleryLayer` 继续只负责展示条目和发出 `onPlayMusic(id, src)` 事件，不直接拥有音频资源。公共音频层负责把逻辑音乐键解析为已加载的真实 URL，并提供明确的“预览时重新播放”语义；Zero 和 Starter 的入口只负责把 Gallery 点击接到这条公共能力。测试必须覆盖真实鼠标点击、标题来源和游戏来源，不能只调用调试回调或 `titleSelect()`。

**Tech Stack:** TypeScript, Vitest, Howler, Vite, Electron, Playwright, 现有 `@surdet/renderer` / `examples/shared` 音频接线。

## Global Constraints

- 开工第一步重新读取 `E:\surdet\AGENTS.md`，并记录真实起始 `HEAD`、`git status --short` 和 `git rev-list --left-right --count HEAD...surdet/main`；不得假设计划生成时的 HEAD 仍然有效。
- 用户的一手证据是本轮缺陷依据：正常剧情推进中的 BGM/音效可听见，但标题页或游戏内“鉴赏 → 音乐”点击已解锁条目不播放。不得因为旧的静态 Gallery 校验通过就否定此反馈。
- 本轮只处理“Gallery 音乐点击播放闭环”。不得修改音频文件、音频生成质量、音频时长、采样率、循环点、ducking、音量默认值、性能体系、存档格式、剧情、DSL、Gallery 解锁数据、视觉布局、Wave 5A/5B/5C、M9 或文档治理。
- 不得新增依赖、兼容层、migration、无证据 fallback、第二套音频状态机或独立的 Gallery 播放系统。先使用已有 `AudioManager`、`AudioHandle`、`ResolvedAudio` 和 Gallery callback。
- 优先把可复用缺陷修在公共音频契约或公共接线层；只有红灯证明 Renderer 事件没有发出时，才允许改 `GalleryLayer`。
- 普通剧情 BGM 的默认语义保持不变：同一源的普通 `playBgm()` 调用仍然可以 no-op；只有 Gallery 预览明确要求“点击就重新播放”时才使用显式 restart 语义。
- 不得把逻辑键当作真实文件 URL 直接交给 Howler。`midnight_rain` 等逻辑键必须经过现有 `audioUrls` 映射，映射结果是已注册格式的 Blob/文件 URL。
- 保留这些用户文件完全不变、未暂存、未提交、未删除、未移动：`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`。
- 不得删除、覆盖、筛选或改写失败 artifact、控制台错误、Howler load/play 错误或用户复现证据。
- 采用 TDD：聚焦红灯 → 最小实现 → 同一命令绿灯 → 相邻回归。不得用等待时间、重跑直到绿色或放宽断言制造假绿。
- 本轮只允许普通本地提交，完成后停止等待独立复审；未经总经理另行授权不得 push、部署、重新打包或发行。

## Locked File Map

除计划台账和最终交付报告外，本轮允许创建或修改的文件只有以下这些：

- Modify: `packages/renderer/src/audio-manager.ts` — BGM 预览重播的公共实现，以及仅供诊断使用的当前 BGM 播放状态查询（若红灯需要）。
- Modify: `packages/renderer/src/types.ts` — `AudioHandle.playBgm` 的可选预览重播参数（如 Task 2 的红灯证明需要该公共参数）。
- Modify: `packages/renderer/test/audio-manager.test.ts` — 普通 BGM no-op、显式预览重播、真实播放状态聚焦测试。
- Modify: `examples/shared/resolved-audio.ts` — 保持逻辑键到真实 URL 的映射，并透传预览重播参数。
- Create: `examples/zero-after-midnight/test/gallery-music-playback.test.ts` — Zero 的逻辑键映射和 Gallery 播放接线测试。
- Modify: `examples/zero-after-midnight/package.json` — 将新增聚焦测试加入现有 Zero test 脚本，不改变其他脚本含义。
- Modify: `examples/zero-after-midnight/src/main.ts` — Gallery 回调使用公共预览播放语义；添加最小只读音频诊断和真实音乐行的测试目标，不改变正式游戏内容。
- Modify: `examples/zero-after-midnight/src/surdet-window.d.ts` — 为新增只读诊断字段补充类型。
- Modify: `examples/starter/src/main.ts` — 若公共 `AudioHandle` 签名改变，保持 Starter 的 Gallery 接线与 Zero 一致；不得修改 Starter 内容资产。
- Create: `packages/shell/e2e/player-experience-gallery-music.e2e.mjs` — 标题页和游戏内 Gallery 的真实 Electron 鼠标验证。
- Create: `packages/shell/test/player-experience-gallery-music-e2e-contract.test.ts` — runner 的静态契约测试。
- Modify: `packages/shell/package.json` — 添加一个明确的 Gallery 音乐 E2E 命令，不改动既有 Wave 命令。
- Create: `docs/ENGINE-GALLERY-MUSIC-PLAYBACK-DELIVERY-REPORT-2026-08-13.md` — 仅在所有实现门禁通过后创建。
- Modify: `docs/superpowers/plans/2026-08-13-gallery-music-playback.md` — 记录每个 Task 的真实红灯、绿灯、命令和停止状态。

如果红灯证明问题只在游戏入口的回调接线，禁止顺手修改 `packages/renderer/src/layers/gallery/gallery-layer.ts`、`gallery.json` 或任何音频资源；只有红灯明确显示 unlocked row 没有触发 callback 时才可申请扩大文件范围并先停下来报告。

---

### Task 0: 建立真实基线并核对运行入口

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-gallery-music-playback.md`（只记录实际结果）

**Interfaces:**
- Consumes: 当前工作树、现有 Zero dist、现有 Renderer/Shell 音频实现。
- Produces: 本轮真实基线和缺陷复现前提；不产生生产代码改动。

- [ ] **Step 1: 读取项目规则和 Git 基线**

运行：

```powershell
Get-Content -Raw E:\surdet\AGENTS.md
git rev-parse HEAD
git status --short
git rev-list --left-right --count HEAD...surdet/main
```

把输出原样摘要写入计划 Task 0。若发现受保护文件或其他用户修改，不得清理、reset 或 checkout 覆盖它们。

- [ ] **Step 2: 运行与本轮直接相关的基线门禁**

运行：

```powershell
npm run test -w @surdet/renderer
npm run test -w @surdet/shell
npm run build -w @surdet/renderer
npm run build -w @surdet/shell
npm run build -w zero-after-midnight
git diff --check
```

预期：基线命令全部退出码 `0`。若已有失败，记录失败并先判断是否与 Gallery 音频有关，不得把无关历史红灯冒充本轮红灯。

- [ ] **Step 3: 只读核对逻辑键与实际素材**

运行：

```powershell
Get-Content -Raw examples/zero-after-midnight/content/config/gallery.json
Get-ChildItem examples/zero-after-midnight/content/assets/bgm -File | Select-Object Name,Length
rg -n "onPlayMusic|audio\.playBgm|audioUrls\.set|setSourceFormat" examples/zero-after-midnight/src/main.ts examples/shared/resolved-audio.ts packages/renderer/src/audio-manager.ts
```

确认 `midnight_rain`、`old_room` 等 Gallery `src` 与真实 `.wav` stem 一一对应；本步骤不修改配置或资产。

- [ ] **Step 4: 提交基线结论，不提交代码**

计划台账必须明确写出：正常剧情音频已由用户实机确认可听见；Gallery 音乐点击尚未闭环；Wave 6 静态 Gallery 内容校验不等于实际播放验证；Task 1 尚未开始。

---

### Task 1: 用真实鼠标路径建立合法红灯

**Files:**
- Create: `packages/shell/e2e/player-experience-gallery-music.e2e.mjs`
- Create: `packages/shell/test/player-experience-gallery-music-e2e-contract.test.ts`
- Modify: `packages/shell/package.json`
- Modify: `examples/zero-after-midnight/src/main.ts`（仅添加最小只读诊断/音乐行目标）
- Modify: `examples/zero-after-midnight/src/surdet-window.d.ts`
- Modify: `docs/superpowers/plans/2026-08-13-gallery-music-playback.md`

**Interfaces:**
- Consumes: 真实《零点之后》dist、现有 `__surdetDebug.interactionTargets`、Canvas 鼠标输入、`AudioManager.snapshotPlayback()`。
- Produces: 能区分“点击未到达”“逻辑键未解析”“Howl 未开始播放”“同源 no-op”的最小 artifact。

- [ ] **Step 1: 先写 runner 静态契约红灯**

runner 必须满足以下可检查文本契约：

```text
入口必须是 E:\surdet\examples\zero-after-midnight\dist
必须创建独立 Electron 进程和独立临时 userData
必须通过 page.mouse.click() 或等价真实鼠标事件点击
不得调用 window.__surdetDebug.titleSelect() 代替 Gallery 条目点击
必须分别覆盖 标题 → 鉴赏 → 音乐 和 新游戏 → 系统菜单 → 鉴赏 → 音乐
必须记录 before/after audioPlayback、点击坐标、目标音乐 ID、source、页面/控制台/请求/未处理异常
```

契约测试使用 `readFileSync` 读取 runner，并逐项断言以上字符串或等价 AST/正则存在；先运行：

```powershell
npm run test -w @surdet/shell -- player-experience-gallery-music-e2e-contract.test.ts
```

预期：测试先以红灯开始，因为 runner 尚未包含全部真实路径。

- [ ] **Step 2: 添加最小诊断字段，不改变正式播放逻辑**

在 `examples/zero-after-midnight/src/main.ts` 的现有 `__surdetDebug` 对象中只添加只读字段：

```ts
get audioPlayback() {
  const snapshot = audio.snapshotPlayback?.() ?? { bgm: null, ambience: null };
  return {
    ...snapshot,
    bgmPlaying: audioManager.isBgmPlaying(),
  };
},
```

同时在 `debugInteractionTargets()` 的 Gallery music 分支中，为每一个 unlocked 条目按现有 `GalleryLayer` 坐标生成 `gallery:music:<id>` 目标；目标只是测试定位证据，实际点击仍必须调用 `page.mouse.click()`，不能直接调用回调。未解锁条目不得生成可点击目标。

在 `surdet-window.d.ts` 中给 `audioPlayback` 增加只读结构类型。不要把 Howl、Blob URL、真实 Layer 或资源对象暴露到窗口。

- [ ] **Step 3: 写并运行正式红灯 runner**

runner 运行两个 case，每个 case 都按以下实际鼠标路径执行：

```text
Case A: 标题 → 鉴赏 → 音乐 → 点击 old_room → 点击 midnight_rain
Case B: 标题 → 新游戏 → 等待剧情音频加载 → 系统菜单 → 鉴赏 → 音乐 → 点击 old_room → 点击 midnight_rain
```

每次点击前读取 `audioPlayback`，点击后等待 `audioPlayback.bgm === 目标逻辑键` 且 `audioPlayback.bgmPlaying === true`；同时记录 `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors` 和 `releaseFailures`。如果第一首恰好等于进入 Gallery 前的当前 BGM，第二首不同曲目仍必须验证。

运行：

```powershell
npm run e2e:gallery-music -w @surdet/shell
```

预期：在未修复生产逻辑的当前 HEAD 上，至少有一个真实 case 失败，并保留完整 artifact；失败必须来自音频播放断言，不能来自页面启动、错误的 dist、坐标错误或 runner 自身异常。若两案意外全部通过，立即停止并把“当前实现已通过真实播放验证”的证据报告出来，不得猜测性改代码。

- [ ] **Step 4: 记录红灯分类**

按 artifact 的事实把问题归入唯一主类：

```text
CALLBACK_NOT_REACHED       = 点击后 callback 计数未增加
SOURCE_NOT_RESOLVED        = callback 触发但 audioPlayback.bgm 不是目标键，或 Howler 收到逻辑键而非已加载 URL
SAME_SOURCE_NOOP            = 目标键等于当前 BGM，普通 playBgm 提前返回且没有重新播放
HOWLER_PLAYBACK_FAILED      = 目标键与 URL 已正确，但 bgmPlaying=false 或有 load/play error
```

不得把多个未经证据支持的分类同时写成根因。计划 Task 1 完成后必须停在复审点，等待确认红灯分类是否与用户现象一致。

---

### Task 2: 为已证实的分类写最小单元红灯并实现公共修复

**Files:**
- Modify: `packages/renderer/src/audio-manager.ts`
- Modify: `packages/renderer/src/types.ts`
- Modify: `packages/renderer/test/audio-manager.test.ts`
- Modify: `examples/shared/resolved-audio.ts`
- Create/Modify: `examples/zero-after-midnight/test/gallery-music-playback.test.ts`
- Modify: `examples/zero-after-midnight/package.json`
- Modify: `examples/zero-after-midnight/src/main.ts`
- Modify: `examples/starter/src/main.ts`（仅当公共签名需要同步）
- Modify: `docs/superpowers/plans/2026-08-13-gallery-music-playback.md`

**Interfaces:**
- Consumes: Task 1 唯一主类和原始 artifact。
- Produces: 一个可复用、可解释的 Gallery 预览播放契约；剧情普通 BGM 行为保持原样。

- [ ] **Step 1: 根据 Task 1 分类写精确的聚焦红灯**

若分类为 `SAME_SOURCE_NOOP`，在 `packages/renderer/test/audio-manager.test.ts` 先加入以下行为测试：

```ts
it('Gallery 预览对当前正在播放的同一 BGM 也会重新播放', () => {
  const am = new AudioManager();
  am.playBgm('midnight_rain.wav');
  const firstPlayCount = mockPlay.mock.calls.length;
  am.playBgm('midnight_rain.wav', { restart: true });
  expect(mockPlay.mock.calls.length).toBe(firstPlayCount + 1);
  expect(mockStop).toHaveBeenCalled();
});
```

并保留原有普通语义测试：

```ts
it('普通 playBgm 对相同来源仍然不重复启动', () => {
  const am = new AudioManager();
  am.playBgm('midnight_rain.wav');
  const firstPlayCount = mockPlay.mock.calls.length;
  am.playBgm('midnight_rain.wav');
  expect(mockPlay.mock.calls.length).toBe(firstPlayCount);
});
```

若分类为 `SOURCE_NOT_RESOLVED`，在 Zero 测试中使用实际逻辑键和一个可观察 fake AudioManager，断言 `ResolvedAudio` 把 `midnight_rain` 解析为 `blob:midnight_rain.wav` 之类的映射值，而不是把逻辑键原样传给底层；先让该断言在当前实现下失败。

若分类为 `CALLBACK_NOT_REACHED`，先只为 `GalleryLayer` unlocked music row 添加真实 pointerdown 红灯，断言回调接收 `(id, src)`；不得先改音频管理器。

若分类为 `HOWLER_PLAYBACK_FAILED`，先在 AudioManager fake 中覆盖 `loaderror` / `playerror`，让测试能区分“已请求播放”和“已成功播放”，并保留原始错误；不得用 `bgm` 快照字段冒充已发声。

- [ ] **Step 2: 运行同一聚焦命令确认红灯**

运行与分类对应的实际命令，例如：

```powershell
npm run test -w @surdet/renderer -- audio-manager.test.ts
npm run test -w zero-after-midnight -- gallery-music-playback.test.ts
```

预期：新增断言在修复前失败，失败信息直接指出同源 no-op、逻辑键未解析、回调未触发或 Howler 错误。若红灯不是这些原因，停止并更新计划，不得继续猜测。

- [ ] **Step 3: 实现最小公共修复**

当且仅当红灯为 `SAME_SOURCE_NOOP` 时，使用以下契约，不改变普通剧情调用：

```ts
export interface BgmPlaybackOptions {
  readonly restart?: boolean;
}

playBgm(src: string | null, options?: BgmPlaybackOptions): void {
  if (!options?.restart && src === this.#bgmKey) return;
  // restart=true 且 src 与当前 BGM 相同：停止当前 Howl、保持同一缓存项，
  // 重新从起点播放，不启动旧曲淡出定时器，也不改变普通切歌语义。
}
```

`AudioHandle`、`NULL_AUDIO`、`ResolvedAudio` 和两个示例入口必须同步接受并透传 `options`。Zero/Starter 的 Gallery callback 使用：

```ts
audio.playBgm(src ?? id, { restart: true });
```

当且仅当红灯为 `SOURCE_NOT_RESOLVED` 时，修正 `ResolvedAudio` 与 `loadAssets` 的同一 source key 规范；不得新增第二张 URL 表，也不得把未知逻辑键静默 fallback 成网络路径。

当且仅当红灯为 `CALLBACK_NOT_REACHED` 时，修正 `GalleryLayer` 的 hit target 或内容重建生命周期，并保持 `onPlayMusic(id, src)` 公共签名不变。

当且仅当红灯为 `HOWLER_PLAYBACK_FAILED` 时，修正现有 `setSourceFormat`/Howler 配置或把真实 `loaderror`/`playerror` 通过既有错误通道记录；不得吞掉失败，也不得把 `snapshotPlayback` 作为成功播放证明。

- [ ] **Step 4: 运行聚焦绿灯和相邻回归**

至少运行：

```powershell
npm run test -w @surdet/renderer -- audio-manager.test.ts
npm run test -w zero-after-midnight -- gallery-music-playback.test.ts
npm run test -w @surdet/renderer -- layers/gallery-layer.test.ts
npm run typecheck -w @surdet/renderer
npm run typecheck -w zero-after-midnight
npm run typecheck -w surdet-starter
```

预期：新增红灯全部转绿；普通剧情 BGM 的同源 no-op、切歌淡出、A→B→A 代际保护和音频快照测试仍然通过。

---

### Task 3: 真实 Electron 标题/游戏双路径验收

**Files:**
- Modify: `packages/shell/e2e/player-experience-gallery-music.e2e.mjs`
- Modify: `packages/shell/test/player-experience-gallery-music-e2e-contract.test.ts`
- Modify: `packages/shell/package.json`
- Modify: `docs/superpowers/plans/2026-08-13-gallery-music-playback.md`

**Interfaces:**
- Consumes: Task 2 绿灯的公共音频契约和正式 Zero dist。
- Produces: 一份绑定当前实现 HEAD 的真实玩家播放 artifact。

- [ ] **Step 1: 重建正式游戏和 Shell**

按依赖顺序运行：

```powershell
npm run build -w @surdet/core
npm run build -w @surdet/renderer
npm run build -w @surdet/host
npm run build -w @surdet/shell
npm run build -w zero-after-midnight
```

runner 必须记录实际 `git rev-parse HEAD`、正式入口 `E:\surdet\examples\zero-after-midnight\dist`、Electron 版本、Node 版本和 lockfile SHA；不得复用旧 dist 或旧 artifact。

- [ ] **Step 2: 运行一次双路径正式验证**

运行：

```powershell
npm run e2e:gallery-music -w @surdet/shell
```

必须通过真实 `page.mouse.click()` 覆盖：

```text
标题 → 鉴赏 → 音乐 → 点击 old_room → 点击 midnight_rain
新游戏 → 系统菜单 → 鉴赏 → 音乐 → 点击 old_room → 点击 midnight_rain
```

每次点击的验收条件：

```text
audioPlayback.bgm == 目标逻辑键
audioPlayback.bgmPlaying == true
pageErrors == []
consoleErrors == []
requestFailures == []
unhandledRejections == []
rendererErrors == []
releaseFailures == []
```

同时验证：点击音乐条目不会推进剧情、不会关闭 Gallery、不会修改 Gallery 解锁状态；点击当前已播放曲目时也会重新开始播放，而不是悄悄 no-op。

- [ ] **Step 3: 保留失败与成功证据**

artifact 至少包含：`schemaVersion`、`head`、`sourceRoot`、`distRoot`、两个 case 的真实点击坐标、目标 ID、before/after 音频诊断、播放错误、窗口错误数组和退出状态。成功 artifact 的 `head` 必须等于本次构建/运行时 HEAD；失败 artifact 不得删除。

---

### Task 4: 与项目门禁匹配的最终验证与交付

**Files:**
- Create: `docs/ENGINE-GALLERY-MUSIC-PLAYBACK-DELIVERY-REPORT-2026-08-13.md`
- Modify: `docs/superpowers/plans/2026-08-13-gallery-music-playback.md`

**Interfaces:**
- Consumes: Task 0 基线、Task 1 红灯 artifact、Task 2 测试/构建结果、Task 3 正式 Electron artifact。
- Produces: 可独立复审的交付报告；不自动 push 或部署。

- [ ] **Step 1: 运行最终比例验证**

由于本轮改动涉及 Renderer 公共音频接口、共享解析器和两个示例入口，运行：

```powershell
npm run verify:all
npm run e2e:gallery-music -w @surdet/shell
git diff --check
git ls-files '*.log'
```

预期：`verify:all` 退出码 `0`；Gallery 音乐双路径 E2E 退出码 `0`；`git diff --check` 通过；tracked `.log` 数量为 `0`。不得重新运行性能资格化、旧版 A/B、M9 或发行流程。

- [ ] **Step 2: 写交付报告中的事实结论**

报告必须逐项写清：

```text
用户复现：正常剧情有音频，Gallery 点击无音频
红灯分类及证据：CALLBACK_NOT_REACHED / SOURCE_NOT_RESOLVED / SAME_SOURCE_NOOP / HOWLER_PLAYBACK_FAILED 中唯一一项
公共层落点：AudioManager / AudioHandle / ResolvedAudio / GalleryLayer / Zero 接线中的实际修改项
普通剧情 BGM 语义：是否保持同源 no-op
Gallery 预览语义：点击已播放曲目是否重新播放
标题来源和游戏来源：是否都通过真实鼠标路径
音频资产：未修改
性能、存档、剧情、视觉、Wave 5、M9：未触碰
```

不得把“`snapshotPlayback.bgm` 改变”单独写成“已经听见声音”；必须同时有 `bgmPlaying` 或 Howler 成功事件证据。

- [ ] **Step 3: 提交并停止**

按主题分成普通本地提交：

```powershell
git add packages/renderer/src/audio-manager.ts packages/renderer/src/types.ts packages/renderer/test/audio-manager.test.ts examples/shared/resolved-audio.ts examples/zero-after-midnight/test/gallery-music-playback.test.ts examples/zero-after-midnight/package.json examples/zero-after-midnight/src/main.ts examples/zero-after-midnight/src/surdet-window.d.ts examples/starter/src/main.ts packages/shell/e2e/player-experience-gallery-music.e2e.mjs packages/shell/test/player-experience-gallery-music-e2e-contract.test.ts packages/shell/package.json
git commit -m "fix(engine): close gallery music playback loop"

git add docs/ENGINE-GALLERY-MUSIC-PLAYBACK-DELIVERY-REPORT-2026-08-13.md docs/superpowers/plans/2026-08-13-gallery-music-playback.md
git commit -m "docs(engine): record gallery music playback closure"
```

提交前再次运行：

```powershell
git status --short
git rev-parse HEAD
git rev-list --left-right --count HEAD...surdet/main
```

最终状态必须为：

```text
GALLERY_MUSIC_PLAYBACK_IMPLEMENTED
TITLE_GALLERY_AUDIO_VERIFIED
GAME_GALLERY_AUDIO_VERIFIED
NORMAL_BGM_SEMANTICS_RETAINED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_INDEPENDENT_REVIEW
```

不得执行 `git push`、`npm run pack`、`electron-builder`、正式发行或部署。完成后把报告路径、artifact 路径、SHA、测试输出和 Git 状态交给总经理复审。

## Completion Review Checklist

- [ ] 用户报告的“正常剧情有声音、Gallery 点击无声音”被真实 Electron 路径复现并形成红灯。
- [ ] 红灯归因只有一个证据支持的主类，没有把猜测写成根因。
- [ ] Gallery 点击使用真实鼠标事件，覆盖标题来源和游戏来源。
- [ ] 逻辑音乐键解析到实际已加载音频 URL，并保留格式信息。
- [ ] 点击同一首已播放 BGM 时，Gallery 预览不会被普通同源 no-op 静默吞掉。
- [ ] 普通剧情 BGM 的已有同源 no-op、切歌淡出和缓存/代际回归仍通过。
- [ ] 无页面错误、控制台错误、请求失败、未处理拒绝、RendererError 或资源释放错误。
- [ ] 没有修改任何音频资产或音频生成流程。
- [ ] `npm run verify:all`、聚焦测试、typecheck、build 和 Gallery 双路径 E2E 都按本轮事实执行并记录。
- [ ] 仅普通本地提交，未 push、未部署、未打包、未发行，停止等待独立复审。

---

## Execution Ledger

> 本台账只记录本次真实命令与磁盘证据；失败 artifact 保留在系统临时目录，不以重跑覆盖。

### Task 0 — completed

- 规则已重新读取：`E:\surdet\AGENTS.md`。
- 起始 `HEAD`: `423671b72e703f7eb7a74f81d77e17081eab2d93`。
- 起始分支：`main`。
- 起始 `HEAD...surdet/main`: `0 0`。
- 起始工作树：五个受保护未跟踪文件，加本任务书 `docs/superpowers/plans/2026-08-13-gallery-music-playback.md`；无 tracked 修改。
- 起始 `git diff --check`: 退出码 `0`；`git ls-files '*.log'` 为空。
- 基线命令：`npm run test -w @surdet/renderer` → `49` 文件 / `403` 测试通过；`npm run test -w @surdet/shell` → `19` 文件 / `148` 测试通过；Renderer/Shell/Zero 相关构建均退出码 `0`。
- 只读素材核对：`gallery.json` 中 `midnight_rain`、`old_room` 等音乐 `src` 与 `content/assets/bgm/*.wav` stem 一一对应；音频资产未修改。
- 基线结论：用户已确认正常剧情 BGM/音效可听见；Gallery 音乐点击闭环未通过；Wave 6 静态内容完整性不等于实际播放验证。

### Task 1 — completed with valid red evidence

- 先运行静态 contract：初始结果 `1 passed / 2 failed`，失败原因是 runner 尚未具备正式 Zero/独立 userData/真实鼠标双来源和播放证据契约；未在此阶段改 AudioManager 播放逻辑。
- 同一 contract 在补齐 runner 后为 `3/3 passed`；`node --check packages/shell/e2e/player-experience-gallery-music.e2e.mjs` 退出码 `0`。
- 第一次动态执行因推进预算不足停在 `common_convenience:19`、`0` 次点击，作为 harness 前置失败保留：`<local-path>`，大小 `11080` 字节，SHA-256 `D6B04A89BCA4B76AA886E7336467DC5604B6FF3A74543A239A780000F5C15FDC`。
- 修正 runner 的真实推进预算后，正式命令 `npm run e2e:gallery-music -w @surdet/shell` 完成两个独立 Electron session、四次真实音乐行点击和八张截图，并生成合法产品红灯 artifact：`<local-path>`，大小 `47987` 字节，SHA-256 `9D324BCAC27CC51383DF2740195F073692C413AD23717D5A265D508D7C3372FB`。
- 动态 artifact `head` 为 `423671b72e703f7eb7a74f81d77e17081eab2d93`；正式入口为 `E:\surdet\examples\zero-after-midnight\dist`；两 case 均无 page/console/request/unhandled/renderer/release 错误，窗口未异常关闭。
- 标题来源 `标题 → 鉴赏 → 音乐` 与游戏来源 `新游戏 → 系统菜单 → 鉴赏 → 音乐` 均通过真实 `page.mouse.click()` 进入并点击 `old_room`、`midnight_rain`。
- 唯一主分类：`SAME_SOURCE_NOOP`。两 case 的 `old_room` 点击均 callbackReached=`true`、sourceResolved=`true`、实际 Blob URL 与当前 BGM source 相等、`bgmPlaying=true`，但 `bgmPlayCount` 均保持 `5 → 5`；同一 case 的 `midnight_rain` 为 `5 → 6` 且实际播放成功。证据排除了 `CALLBACK_NOT_REACHED`、`SOURCE_NOT_RESOLVED` 和 `HOWLER_PLAYBACK_FAILED`。
- 下一阶段入口：Task 2，先为 `playBgm(..., { restart: true })` 写聚焦红灯；不得把普通剧情同源 no-op 改掉。

### Task 2 — completed: explicit Gallery preview restart

- 先运行 `npm run test -w @surdet/renderer -- audio-manager.test.ts`：新增同源预览重播测试为合法红灯，`21` 项中 `20` 通过、`1` 失败；普通同源 no-op 回归仍通过。失败表现为 `restart: true` 没有新增 Howler `play`/`stop`。
- 按唯一红灯分类实现最小公共契约：`BgmPlaybackOptions.restart` 仅在显式预览语义下绕过同源 no-op；普通 `playBgm(src)`、切歌淡出及代际保护逻辑不变。`AudioManager` 增加只读真实 BGM 播放状态、累计 playCount 与 Howler load/play 错误摘要，供正式证据区分“请求播放”和“实际播放”。
- 同一测试修复后转绿：`npm run test -w @surdet/renderer -- audio-manager.test.ts` → `21/21`。
- 新增 Zero `ResolvedAudio` 逻辑键映射与 restart 透传测试；`npm run test -w zero-after-midnight -- gallery-music-playback.test.ts` → simulation `assets ok: 44`、`verified 11 scenes and 3 endings`，Vitest `22/22` 通过（包含既有 Player UI 测试）。
- 相邻回归：`npm run test -w @surdet/renderer -- layers/gallery-layer.test.ts` → `15/15`；`npm run typecheck -w @surdet/renderer`、`npm run typecheck -w zero-after-midnight`、`npm run typecheck -w surdet-starter` 均退出码 `0`；Renderer build 退出码 `0`。
- 期间一次在 Renderer build 之前直接执行 Zero typecheck，因 workspace 仍读取旧 renderer 声明而报告缺少 `BgmPlaybackOptions`，随后按依赖顺序先完成 Renderer typecheck/build，再次执行 Zero/Starter typecheck 均通过；该输出是构建顺序前置条件，不是生产实现红灯。
- 实际修改落点：`packages/renderer/src/types.ts`、`packages/renderer/src/audio-manager.ts`、`packages/renderer/test/audio-manager.test.ts`、`examples/shared/resolved-audio.ts`、`examples/zero-after-midnight/src/main.ts`、`examples/zero-after-midnight/src/surdet-window.d.ts`、`examples/zero-after-midnight/test/gallery-music-playback.test.ts`、`examples/zero-after-midnight/package.json`、`examples/starter/src/main.ts`。未修改 GalleryLayer、音频资产、Gallery 配置、剧情、DSL、存档或性能体系。
- Task 2 代码提交：`647f4fa`（`fix(engine): close gallery music playback loop`）；`git log -1 --oneline --decorate` 已确认真实 HEAD 为 `647f4fa`。
- 下一阶段入口：Task 3。必须先形成包含上述实现与 Task 1 runner/contract 的普通代码提交，再按固定顺序重建正式 Zero/Shell，并只运行一次新的双路径 Electron 验收。

### Task 3 — completed: formal title/game Electron playback evidence

- Task 3 前按依赖顺序重建：`npm run build -w @surdet/core`、`@surdet/renderer`、`@surdet/host`、`@surdet/shell`、`zero-after-midnight`，五条命令均退出码 `0`；Shell preload 重新生成，Zero Vite `907` modules 构建成功，仅有既有 chunk-size warning。
- 唯一一次新的正式命令 `npm run e2e:gallery-music -w @surdet/shell` 退出码 `0`。runner 重新构建五个工作区、使用正式入口 `E:\surdet\examples\zero-after-midnight\dist`、两个独立 Electron session 和独立 userData；没有使用 Starter dist、旧 artifact 或旧截图。
- 权威 artifact：`<local-path>`，磁盘大小 `47957` 字节，SHA-256 `CB3C9D246B3F561D2C1E8328D452A712BD52574637080924F532FC864A4BFB62`；artifact `status=PASSED`，`head=647f4fafdcd33cb3020533740e8f99a7f3c4219c`。
- 两个 case 均完整通过：标题来源 `标题 → 鉴赏 → 音乐`、游戏来源 `新游戏 → 系统菜单 → 鉴赏 → 音乐`；各点击 `old_room` 与 `midnight_rain`，合计 `4/4` 实际音乐点击成功、`8/8` 截图记录存在且独立校验字节数/SHA-256 全匹配。
- `old_room` 同源预览在两条路径中均从 `bgmPlayCount 5 → 6`、`bgmPlaying=true`，证明当前正在播放曲目会真正重播；`midnight_rain` 均从 `6 → 7` 且 `bgmPlaying=true`。每次 callbackReached/sourceResolved/actualPlayback 均为 true；ResolvedAudio 的逻辑键均解析为已加载 Blob URL，并与 AudioManager 实际 source 一致。
- 正式 artifact 的 pageErrors、consoleErrors、requestFailures、unhandledRejections、rendererErrors、releaseFailures 和 unexpectedWindowClosed 全部为 `0`；四次点击的 Howler 错误数组均为空；Gallery 保持打开，剧情位置未变化。
- 下一阶段入口：Task 4。保留 Task 1 两份失败 artifact 与 Task 3 权威成功 artifact，不覆盖任何历史证据。

### Task 4 — completed with an unrelated repository gate blocker

- 已运行 `npm run verify:all` 一次。verify:tools、renderer-boundaries、renderer-legacy、docs、hygiene、全量 typecheck/build 前置和本轮相关 Renderer/Host/Shell/Starter/Zero 测试均通过；但全仓测试在既有 `surdet-editor` 的 `test/model-roundtrip.test.ts` 失败：`ch01_01.gal`、`ch02.gal` 两项 CRLF/LF 逐字节往返断言失败，Editor 为 `20` 文件 `140/142` 通过。命令真实退出码为 `1`。
- 该失败不涉及本轮音频文件、Gallery、AudioManager 或示例接线；只读 `git diff HEAD~1 --name-only -- examples/starter/content/scenario packages/editor/test/model-roundtrip.test.ts` 无输出，受影响剧本和 Editor 测试未被本轮修改。按范围纪律未修复、未放宽该无关断言。
- `git diff --check` 退出码 `0`；`git ls-files '*.log'` 为空；全量门禁失败证据保留，不以重跑或筛选覆盖。
- Task 4 交付状态：播放功能的聚焦、类型、构建和正式 Electron 双路径均通过；全仓 `verify:all` 暂为 `VERIFY_ALL_BLOCKED_BY_UNRELATED_EDITOR_EOL_TEST`，需独立复审确认是否按既有仓库基线处理。没有 push、部署、打包、发行、M9、性能或其他范围外修改。
- 下一阶段入口：生成交付报告，进行一次仅文档的普通本地提交；停止在 `WAITING_FOR_INDEPENDENT_REVIEW`。
