# Gallery 音乐播放修复交付报告

日期：2026-08-13
范围：只处理 Gallery 已解锁音乐条目的实际播放闭环；不进入 Wave 5B、M9、性能工作或发行流程。

## 结论摘要

本轮已经用正式《零点之后》dist 和真实 Electron 鼠标路径确认并修复 Gallery 音乐播放问题：

- `TITLE_GALLERY_AUDIO_VERIFIED`：标题 → 鉴赏 → 音乐，两首已解锁音乐均实际播放；
- `GAME_GALLERY_AUDIO_VERIFIED`：新游戏 → 系统菜单 → 鉴赏 → 音乐，两首已解锁音乐均实际播放；
- `NORMAL_BGM_SEMANTICS_RETAINED`：普通剧情 `playBgm(src)` 的同源 no-op 仍保持；
- `GALLERY_MUSIC_PLAYBACK_IMPLEMENTED`：Gallery callback 使用显式预览重播语义；
- `VERIFY_ALL_BLOCKED_BY_UNRELATED_EDITOR_EOL_TEST`：`npm run verify:all` 本轮退出码为 1，阻断点是未被本轮修改的 Editor CRLF/LF 往返测试，不是音频播放测试或生产音频代码失败。

本报告不把 `verify:all` 的失败改写为通过，也不把 `snapshotPlayback.bgm` 单独当作“已经发声”的证据。

## 用户问题与合法红灯

用户提供的可复现现象是：正常剧情推进时 BGM/音效可以播放；进入“鉴赏 → 音乐”后点击已解锁音乐条目没有实际播放。任务要求同时验证标题来源和游戏内来源。

Task 1 使用正式入口 `E:\surdet\examples\zero-after-midnight\dist`，每条路径使用独立 Electron 和独立临时 userData，通过真实 `page.mouse.click()` 点击公开的 `gallery:music:<id>` 目标；没有调用 `titleSelect()`、Gallery callback 或调试 action 冒充玩家输入。

修复前权威红灯 artifact：

- 路径：`<local-path>`
- 大小：47987 字节
- SHA-256：`9D324BCAC27CC51383DF2740195F073692C413AD23717D5A265D508D7C3372FB`
- artifact HEAD：`423671b72e703f7eb7a74f81d77e17081eab2d93`
- 标题来源和游戏来源各完成 `old_room`、`midnight_rain` 两次真实点击；callback 均到达，逻辑键均解析到实际 Blob URL，`bgmPlaying=true` 且 Howler 错误为空。
- `old_room` 点击的 `bgmPlayCount` 均为 `5 → 5`，普通同源 `playBgm()` 提前返回；`midnight_rain` 为 `5 → 6`，因此不是所有 Gallery 播放都失败。

唯一有证据支持的主分类是：

```text
SAME_SOURCE_NOOP
```

这排除了：

- `CALLBACK_NOT_REACHED`：四次 callback 均到达；
- `SOURCE_NOT_RESOLVED`：四次请求均有 `resolvedSource`，并与 AudioManager 的实际 source 一致；
- `HOWLER_PLAYBACK_FAILED`：没有 load/play error，且不同曲目实际播放成功。

Task 1 的另一份前置 harness 失败 artifact 也保留在：

`<local-path>`
大小 `11080` 字节，SHA-256 `D6B04A89BCA4B76AA886E7336467DC5604B6FF3A74543A239A780000F5C15FDC`。它只因初版推进预算不足停在剧情推进阶段，未被当作产品红灯。

## 根因与公共层修复

根因是 Gallery 点击路径已经到达 callback，音频逻辑键也已经通过 `ResolvedAudio` 解析到已加载 URL；但 callback 调用普通 `AudioManager.playBgm()` 时，目标曲目恰好等于当前 BGM，公共方法的既有同源 no-op 直接返回。因此 callback、source 解析和 Howler 本身都没有失败，只有 Gallery 预览缺少“即使同源也从头重播”的明确语义。

实际修改：

- `packages/renderer/src/types.ts`：新增 `BgmPlaybackOptions { restart?: boolean }`；增加只读 BGM 实际播放诊断类型；`AudioHandle.playBgm()` 接受可选预览选项。
- `packages/renderer/src/audio-manager.ts`：保留默认同源 no-op；当且仅当 `restart: true` 且 source 相同，停止当前 Howl 并从起点重新播放，不启动普通切歌的旧曲淡出定时器；诊断记录真实播放状态、playCount 和 Howler 原始错误摘要。
- `examples/shared/resolved-audio.ts`：继续用唯一 URL 映射把逻辑键解析为已加载 source，并透传 `restart`；同步提供只读 BGM 诊断。
- `examples/zero-after-midnight/src/main.ts`：Zero Gallery callback 使用 `audio.playBgm(source, { restart: true })`，并仅增加用于正式证据的只读诊断字段和 interaction target。
- `examples/starter/src/main.ts`：Starter Gallery callback 同步使用显式预览重播语义。
- 相应测试、窗口诊断类型、Shell contract/runner 和 Zero 接线测试同步更新。

未修改 `GalleryLayer`，因为红灯已经证明点击事件正常到达；未修改 AudioManager 之外的音频状态机。

## 红灯 → 绿灯证据

Task 2 先写测试，再实现：

1. 修复前 `npm run test -w @surdet/renderer -- audio-manager.test.ts`：21 项中 20 通过、1 项失败；`restart: true` 没有新增 play/stop，普通同源 no-op 测试仍通过。
2. 实现后同一命令：Renderer audio-manager `21/21` 通过。
3. `npm run test -w zero-after-midnight -- gallery-music-playback.test.ts`：资产/场景预检通过，Zero Player UI 与 Gallery 接线测试合计 `22/22` 通过。
4. `npm run test -w @surdet/renderer -- layers/gallery-layer.test.ts`：`15/15` 通过。
5. `npm run typecheck -w @surdet/renderer`、`npm run typecheck -w zero-after-midnight`、`npm run typecheck -w surdet-starter`：均退出码 0。

Task 2 代码提交：

`647f4fafdcd33cb3020533740e8f99a7f3c4219c`
`fix(engine): close gallery music playback loop`

## 正式 Electron 双路径验收

Task 3 先按顺序构建 `@surdet/core`、`@surdet/renderer`、`@surdet/host`、`@surdet/shell`、`zero-after-midnight`，五条构建命令均退出码 0。随后只执行一次新的正式命令：

```text
npm run e2e:gallery-music -w @surdet/shell
```

正式入口：

`E:\surdet\examples\zero-after-midnight\dist`

权威成功 artifact：

- 路径：`<local-path>`
- 大小：47957 字节
- SHA-256：`CB3C9D246B3F561D2C1E8328D452A712BD52574637080924F532FC864A4BFB62`
- `status=PASSED`
- artifact HEAD：`647f4fafdcd33cb3020533740e8f99a7f3c4219c`
- `actualSessions=2`，`actualClicks=4`
- 两个 case 均为 `ok=true`，共 `4/4` 音乐点击实际成功；`8/8` 截图文件存在，独立校验截图字节数和 SHA-256 全部匹配。

标题来源：

- `标题 → 鉴赏 → 音乐`：`old_room` 的播放计数 `5 → 6`，`midnight_rain` 为 `6 → 7`；
- `bgmPlaying=true`，逻辑键与实际 source 均匹配，Howler 错误为空。

游戏内来源：

- `新游戏 → 系统菜单 → 鉴赏 → 音乐`：`old_room` 的播放计数 `5 → 6`，`midnight_rain` 为 `6 → 7`；
- `bgmPlaying=true`，逻辑键与实际 source 均匹配，Howler 错误为空。

两条路径均保持 Gallery 打开、剧情位置不变、Gallery 解锁状态不变。artifact 汇总的 `pageErrors`、`consoleErrors`、`requestFailures`、`unhandledRejections`、`rendererErrors`、`releaseFailures` 和 `unexpectedWindowClosed` 全部为 0。

## 全量门禁记录

`npm run verify:all` 本轮真实退出码为 `1`。已通过的阶段包括：verify:tools、Renderer boundaries、Renderer legacy、docs、hygiene、完整 typecheck/build 前置，以及 Core/Renderer/Host/Shell/Starter/Zero 的相关全量测试。失败发生在 `surdet-editor`：

- 测试文件：`packages/editor/test/model-roundtrip.test.ts`
- 结果：21 个文件中 20 通过，142 项中 140 通过；仅 `ch01_01.gal`、`ch02.gal` 两项失败；
- 失败内容：starter 剧本逐字节 CRLF/LF 往返差异；
- 只读核对 `git diff HEAD~1 --name-only -- examples/starter/content/scenario packages/editor/test/model-roundtrip.test.ts` 无输出，本轮没有修改这些剧情或 Editor 文件；
- 按严格范围没有修改 Editor、剧情或换行格式，也没有重跑挑选绿色结果。

这意味着：Gallery 音频功能的直接门禁和正式 Electron 验收通过，但本轮不能诚实地写成“全仓 verify:all 通过”。该无关门禁失败保留给独立复审判断。

其他最终只读检查：

- `git diff --check`：退出码 0；
- `git ls-files '*.log'`：空；
- 未创建或跟踪日志、截图、dist 或临时 artifact。

## Git、范围与停止状态

- 起始 HEAD：`423671b72e703f7eb7a74f81d77e17081eab2d93`；起始 `HEAD...surdet/main=0 0`；
- CODE_EVIDENCE_HEAD：`647f4fafdcd33cb3020533740e8f99a7f3c4219c`；
- 文档提交前当前 HEAD：`647f4fafdcd33cb3020533740e8f99a7f3c4219c`；
- 文档提交前 `HEAD...surdet/main=1 0`；文档提交后最终 HEAD 和同步计数以提交后真实 `git rev-parse`/`git rev-list` 输出为准；
- 受保护未跟踪文件保持未触碰：`AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`；
- 未 push、未部署、未重新打包、未发行；
- 未进入 Wave 5B 或 M9；
- 未修改音频文件、Gallery 配置、剧情、DSL、存档、性能 artifact、性能门限、比较器、视觉布局或其他 Wave。

当前状态：

```text
GALLERY_MUSIC_PLAYBACK_IMPLEMENTED
TITLE_GALLERY_AUDIO_VERIFIED
GAME_GALLERY_AUDIO_VERIFIED
NORMAL_BGM_SEMANTICS_RETAINED
VERIFY_ALL_BLOCKED_BY_UNRELATED_EDITOR_EOL_TEST
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_INDEPENDENT_REVIEW
```
