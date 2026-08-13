# 《零点之后》BGM 可听性与资产质量 Wave 1 交付报告

日期：2026-08-13  
范围：仅限《零点之后》十首 BGM 的离线 PCM16 电平分析、确定性归一化和相关验证。  
状态：`BGM_AUDIBILITY_BASELINE_IMPLEMENTED`  
质量标记：`INTERIM_AUDIBLE_PLACEHOLDER` / `AUDIO_QUALITY_NOT_FINAL` / `MANUAL_AUDIO_REVIEW_PENDING`

## 1. 结论先行

用户反馈是：Gallery 音乐条目有点击反馈，但 BGM 人耳不可闻；正常剧情中的音效可以播放。本轮只处理已确认的十个 BGM WAV 的实际 PCM 电平，没有继续修改 Gallery 播放逻辑，也没有修改 AudioManager、ResolvedAudio 或任何运行时全局增益。

只读原始审计显示，十首文件的 RMS 全部约为 `-53.20 dBFS`，峰值约为 `-50.22 dBFS`，低于本轮固定的 `RMS >= -30 dBFS` 门槛。这是本轮已验证的资产电平问题；本轮没有重新诊断或改写播放链。

离线处理对每个 PCM16 data chunk 的每个样本应用同一确定性增益，目标 RMS 约 `-23 dBFS`，峰值安全上限 `-1 dBFS`。处理保留采样率、声道、位深、样本数、时长、data chunk 位置和容器外字节；没有重采样、重新压缩、添加效果、改变循环长度或生成新音乐内容。

十首文件仍可能是程序生成的正弦占位音。本报告只证明“达到可听电平的机器底线”，不证明正式音乐制作质量，也不代替人耳试听。执行 AI 没有填写“听见了”或“人工试听通过”。

## 2. Git 起点与范围

- 真实起始 HEAD：`7c4a0059204e927061a67b2005da0036d056409e`
- 起始 `HEAD...surdet/main`：`0 0`
- 起始工作树：五个受保护未跟踪文件加本轮计划文件；没有 tracked 修改。
- 代码/资产提交：`565192adfa83499d837652b1f06b21f051822054` — `fix(audio): raise zero-after-midnight bgm audibility`
- 报告生成时 HEAD：`565192adfa83499d837652b1f06b21f051822054`
- 报告生成时 `HEAD...surdet/main`：`1 0`
- 文档收口提交：将在本报告和计划台账一并创建普通本地提交；提交后的真实 HEAD 以该提交后的 Git 复核和最终回报为准，未预先伪写自引用 SHA。
- 本轮没有 push；没有 force push、rebase、reset、amend、squash 或历史改写。

实际变更范围为：

- `examples/zero-after-midnight/scripts/audio-audit.mjs`
- `examples/zero-after-midnight/test/audio-assets.test.ts`
- `examples/zero-after-midnight/package.json`
- `examples/zero-after-midnight/content/assets/bgm/blackout.wav`
- `examples/zero-after-midnight/content/assets/bgm/convenience_hum.wav`
- `examples/zero-after-midnight/content/assets/bgm/ending_meeting.wav`
- `examples/zero-after-midnight/content/assets/bgm/ending_silence.wav`
- `examples/zero-after-midnight/content/assets/bgm/ending_testimony.wav`
- `examples/zero-after-midnight/content/assets/bgm/investigation.wav`
- `examples/zero-after-midnight/content/assets/bgm/last_train.wav`
- `examples/zero-after-midnight/content/assets/bgm/midnight_rain.wav`
- `examples/zero-after-midnight/content/assets/bgm/old_room.wav`
- `examples/zero-after-midnight/content/assets/bgm/underground_signal.wav`
- `docs/baselines/zero-after-midnight-bgm-audibility-baseline-2026-08-13.json`
- 本报告和本轮计划台账。

没有修改：

- `packages/renderer/src/**`，包括 AudioManager；
- `examples/shared/resolved-audio.ts`；
- Gallery 播放映射、`playBgm` 接线和同曲目重播语义；
- Core、Host、Shell、Editor、Starter 运行时代码；
- 图片、字体、SE、voice、剧情、DSL、存档格式；
- 性能 artifact、比较器、门限和 M9 相关内容。

## 3. 原始证据与红灯

原始审计在任何正式 WAV 写入前完成：

- 临时原始 JSON：`C:\Users\Equinox\AppData\Local\Temp\surdet-bgm-pre-normalization-2026-08-13.json`
- 字节数：`5114`
- SHA-256：`B1C66EEE28C38726F7198EFBC88CC5AD43B6B983585898DF636ADEDADA7120B3`
- `npm run audio:audit -w zero-after-midnight -- --fail-under-rms-dbfs -30` 原始退出码：`1`
- 十首均低于 `-30 dBFS`；原始 RMS 范围：`-53.204559943882614` 至 `-53.19798824926366 dBFS`；原始 peak 均为 `-50.22257122354151 dBFS`。
- 原始十首每个文件均为 `5644878` bytes；原始 SHA 和全部 PCM 指标保存在正式 baseline 的 `files` 数组中。

在分析器创建前，`npm run test -w zero-after-midnight -- audio-assets.test.ts` 先因 `audio-audit.mjs` 不存在而合法红灯；分析器实现后同一聚焦命令转绿。归一化安全测试也先以明确的 `normalize not implemented` 红灯验证，再恢复最小实现并转绿。

## 4. 机器可读基线

正式台账：

`E:\surdet\docs\baselines\zero-after-midnight-bgm-audibility-baseline-2026-08-13.json`

磁盘复核值：

- 字节数：`14920`
- SHA-256：`1BC6448D2E49018F154730A5A8C72B4971E9ED5CEA7E6219FC52348CFF630C9D`
- 保留原始 `files`，未删除原始哈希和指标；另有 `postNormalization`、目标值、增益、clipping 和结构不变量。
- 最终 JSON 状态：`INTERIM_AUDIBLE_PLACEHOLDER`
- 质量状态：`AUDIO_QUALITY_NOT_FINAL`

后审计临时 JSON：

- 路径：`C:\Users\Equinox\AppData\Local\Temp\surdet-bgm-post-normalization-2026-08-13.json`
- 字节数：`5114`
- SHA-256：`16D7287476C7BB615EAC78B48F790136BD804D657C0AB60242951AACAE4C5E17`

## 5. 十首 BGM 修改前后指标

所有十首的结构指标均一致：`44100 Hz`、`2` 声道、`16-bit PCM`、`2822400` samples、`32 s`、data offset `78`、data bytes `5644800`；修改前后文件大小均为 `5644878` bytes；`clippingSamples=0`、`structurePreserved=true`、`containerOutsideDataUnchanged=true`。

| 文件 | 原始 SHA-256 | 新 SHA-256 | 原 RMS / 新 RMS (dBFS) | 原 peak / 新 peak (dBFS) | 样本级增益 |
|---|---|---|---:|---:|---:|
| `blackout.wav` | `8A11DAAFE02E7E459D272FD8012B3D7F34EA428107CF623C1E34893155A1B9AB` | `B3C0E19C1BA47B426C52D717780690C65B5E594746A67BDE2AE2C92671903C50` | `-53.204479570573284 / -22.99999695254987` | `-50.22257122354151 / -20.01804364598864` | `32.37605868053973x` |
| `convenience_hum.wav` | `A07C25D0B84764F327E723FA5BE4E8560FFD5FBCEE2EF7EAF0C190B47D5AE702` | `96803E4C1012F46FF342B97E90222FB4708772EEEA70CD13BED967F59483AEE3` | `-53.20450765310704 / -23.00002429025442` | `-50.22257122354151 / -20.01804364598864` | `32.376163356430006x` |
| `ending_meeting.wav` | `8CA532382FC748469F095128C054741C9573CCC783E0347CBF937BFB4F07EA2A` | `FE4F20A815EA984A72C8A688B1C8E88152ABB2851A7CB59E9C748AF72B08DD1B` | `-53.19798824926366 / -22.999909240093043` | `-50.22257122354151 / -20.023357741986803` | `32.35187176404787x` |
| `ending_silence.wav` | `9B3CD231B7AA41E9E760EB19BF3A715DA090165F7E1D17C9D6706CBF983C9664` | `9B116E6376E38DBE318135A006605D8F69C8E8DD4BD7DBC929A1EB138CE4CCB2` | `-53.20447174432573 / -22.999987966605246` | `-50.22257122354151 / -20.01804364598864` | `32.37602950875118x` |
| `ending_testimony.wav` | `33695F860DDE3B13885C396162D928C277670D3D98D1E4C0956F172D9F6BAB31` | `4D26C15C79C03D1F89CCD92CE4C056C8D61F3CD1775B5D27A853E71C7FFD5CAF` | `-53.20450765310704 / -23.00002429025442` | `-50.22257122354151 / -20.01804364598864` | `32.376163356430006x` |
| `investigation.wav` | `DC8A96517386E2C04B370E570FAC668A36FB6F2F20307E3488D7150845D2DB51` | `765C1A015FDFC188EF0B620F7F2FD9F7F6538C3948C2AC4146D3DBA01AFDBCAC` | `-53.204479570573284 / -22.99999695254987` | `-50.22257122354151 / -20.01804364598864` | `32.37605868053973x` |
| `last_train.wav` | `A55BBCD100E254132E05BE2F71B4CE098A4FE7B0146A6FCFDB3FBE1DD2726CE5` | `188BFD84B185104FA861F278F04787C2534178227E67C9905E24116D394DDA50` | `-53.204369275493576 / -22.999884650933694` | `-50.22257122354151 / -20.01804364598864` | `32.37564756579505x` |
| `midnight_rain.wav` | `50E3B8E92A10EE59FDC1C466A17B1F84B36D1EEB8E7A64613E2DA5FE6DD6CB82` | `92A3C3F4DA055F639B5742EC34B4EC6AA1A351A2046A912CEE36F6FD356E2229` | `-53.204479570573284 / -22.99999695254987` | `-50.22257122354151 / -20.01804364598864` | `32.37605868053973x` |
| `old_room.wav` | `F1660F478344058CFB54C98F4E7E2B96FDC2E0EEF0C3A0CB4C7DFD69EF9D6FBB` | `115C4984C8866F728543EF86258738973EFAAB2E36A7207035C12221278D2CE4` | `-53.20398570060759 / -22.99999561996108` | `-50.22257122354151 / -20.01804364598864` | `32.37421786640433x` |
| `underground_signal.wav` | `9A44F86724D0F6185E18A756B4ABFC2675568A1B4569A32487D9D41D291ADCD8` | `0BD59C8E128CE29F058C1E572E05995225AF6F44EF430C17CD099AAE767ECE71` | `-53.204559943882614 / -22.999965854404092` | `-50.22257122354151 / -20.01804364598864` | `32.37635826793113x` |

后审计 RMS 范围为 `-23.00002429025442` 至 `-22.999884650933694 dBFS`；后审计 peak 范围为 `-20.023357741986803` 至 `-20.01804364598864 dBFS`。十首均满足 RMS 门槛，且峰值远低于 `-1 dBFS` 安全上限。

## 6. 命令与结果

### 红灯→绿灯

- 初始 `npm run test -w zero-after-midnight -- audio-assets.test.ts`：红灯，分析器模块不存在；随后同一命令转绿，新增格式测试 `4/4`，聚焦总计 `26/26`。
- `npm run audio:audit -w zero-after-midnight -- --fail-under-rms-dbfs -30`（原始资产）：红灯，退出码 `1`，十首全部低于 `-30 dBFS`。
- 归一化安全测试临时使用明确未实现分支：同一 Zero 音频聚焦测试红灯；恢复实现后同一测试转绿，音频测试 `6/6`，聚焦总计 `28/28`。
- `npm run audio:normalize -w zero-after-midnight`：退出码 `0`，十首批处理完成，未出现 clipping。
- `npm run audio:audit -w zero-after-midnight -- --fail-under-rms-dbfs -30`（归一化后）：退出码 `0`，`failed=[]`。

### Zero / Renderer / Shell

- `npm run lint -w zero-after-midnight`：`0`，11 场景、0 errors、0 warnings。
- `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000`：`0`，23/23 分支、3 结局、0 运行时错误。
- `node examples/zero-after-midnight/scripts/check-assets.mjs`：`0`，44 assets。
- `npm run test -w zero-after-midnight`：`0`，4 files、29/29 tests。
- `npm run typecheck -w zero-after-midnight`：`0`。
- `npm run build -w zero-after-midnight`：`0`。
- `npm run test -w @surdet/renderer -- audio-manager.test.ts`：`0`，21/21。
- `npm run test -w @surdet/shell -- player-experience-gallery-music-e2e-contract.test.ts`：`0`，3/3。
- Renderer/Shell typecheck：均 `0`。
- Renderer/Shell build：均 `0`；sandbox preload 已生成。

### 全量门禁

- `npm run verify:all`：退出码 `1`。
- 失败仅在既有 `packages/editor/test/model-roundtrip.test.ts`：`ch01_01.gal`、`ch02.gal` 的 CRLF/LF 逐字节往返断言失败；本轮没有修改 Editor、Starter 剧本或换行测试。该既有失败不是由十个 WAV、音频分析器、Zero 资产检查或 Gallery 接线引起。
- `git diff --check`：通过。
- `git ls-files '*.log'`：空。

## 7. Gallery 播放链边界

本轮没有修改：

- `AudioManager` 默认 BGM 音量；
- `ResolvedAudio` 逻辑音乐键到实际 URL 的解析；
- Gallery 的 `onPlayMusic` 接线；
- Gallery 同曲目 `restart` 语义；
- 任何运行时全局增益、fallback、兼容层或第二套音频状态机。

Renderer 音频聚焦测试 `21/21`、Shell Gallery 音频契约 `3/3` 和 Zero Gallery 播放测试均通过；因此本轮保留上一轮播放闭环，但没有把 `playing=true`、snapshot 或 callback 当成人耳听见声音的证明。

## 8. 开发态部署与人工试听清单

已完成客观部署检查：

- 构建顺序：`@surdet/core` → `@surdet/renderer` → `@surdet/host` → `@surdet/shell` → `zero-after-midnight`，全部退出码 `0`。
- 实际游戏入口：`E:\surdet\examples\zero-after-midnight\dist`。
- Electron：`E:\surdet\node_modules\electron\dist\electron.exe`。
- PID：`34472`。
- `HasExited=False`。
- 窗口标题：`零点之后 / AFTER MIDNIGHT`。
- 未加载 `examples/starter/dist`。
- 未执行 `npm run pack`、electron-builder 或正式发行打包。

请总经理手动执行并记录结果：

A. 标题页 → 鉴赏 → 音乐 → 点击一首已解锁 BGM，连续听至少 5 秒；  
B. 点击第二首已解锁 BGM，确认能够切换；  
C. 回到第一首，确认能够重新播放；  
D. 进入游戏内鉴赏页重复 A–C；  
E. 关闭鉴赏页，确认无黑屏、无 `resource release failed`、无剧情推进、无窗口关闭；  
F. 确认系统主音量和 BGM 音量均不是 0。

当前人工状态只能写：`MANUAL_AUDIO_REVIEW_PENDING`。执行 AI 没有代填“听见了”或“人工试听通过”。

## 9. 最终边界与停止状态

- 未修改 AudioManager、Gallery 播放逻辑、ResolvedAudio、Core、Host、Shell 运行时代码。
- 未修改图片、字体、SE、voice、剧情、DSL、存档格式、性能 artifact、性能门限或 M9。
- 未执行正式性能资格化、旧版正式 A/B、pack、electron-builder 或发行。
- 未 push；等待独立工程复审和总经理人工试听。
- 受保护文件 `AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md` 均未修改、未暂存、未提交、未删除、未移动。

最终状态：

```text
BGM_AUDIBILITY_BASELINE_IMPLEMENTED
TEN_BGM_ASSETS_NORMALIZED
GALLERY_PLAYBACK_CHAIN_RETAINED
INTERIM_AUDIBLE_PLACEHOLDER
AUDIO_QUALITY_NOT_FINAL
MANUAL_AUDIO_REVIEW_PENDING
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_INDEPENDENT_REVIEW
```
