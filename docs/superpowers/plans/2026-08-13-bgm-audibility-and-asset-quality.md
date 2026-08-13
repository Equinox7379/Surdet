# BGM Audibility Baseline and Asset Quality Wave 1 Implementation Plan

> **For agentic workers:** Execute this plan serially, one task at a time. Checkboxes are mandatory progress markers. Do not claim that an audio command succeeded merely because a Howler instance reports playing=true.

**Goal:** 将《零点之后》的十首 BGM 从“技术上启动但人耳几乎听不见”的状态提升到安全、可听的临时基线，并加入可重复的音频电平门禁；本轮不把占位正弦音伪装成正式音乐，正式音乐生产另行处理。

**Architecture:** 先用无新增依赖的 Node WAV 分析器对 BGM 的实际 PCM 样本做只读测量，建立可审计的响度/峰值基线；再对明确允许的十个 BGM 资产做离线、确定性的电平归一化，保持采样率、声道、时长和 WAV 结构不变。运行时 AudioManager、全局 BGM 音量和 Gallery 播放接线不再增加自动增益，避免用引擎补偿异常素材并影响未来正常音频。

**Tech Stack:** Node.js 20+ 内置 fs/path/crypto，TypeScript/Vitest，现有 npm workspace，WAV PCM-16 解析与样本级增益处理，现有 Electron Gallery 播放验收。

## Global Constraints

- 开工第一步重新读取 E:\surdet\AGENTS.md，并记录真实起始 git rev-parse HEAD、git status --short、git rev-list --left-right --count HEAD...surdet/main；不得假设计划生成时的 HEAD 仍然有效。
- 本轮获得总经理明确批准，允许修改并提交以下十个《零点之后》BGM WAV；除此之外不得修改任何音频、图片、字体、剧情、Gallery 配置或用户存档。
- 允许修改的 BGM 文件只有：blackout.wav、convenience_hum.wav、ending_meeting.wav、ending_silence.wav、ending_testimony.wav、investigation.wav、last_train.wav、midnight_rain.wav、old_room.wav、underground_signal.wav，全部位于 E:\surdet\examples\zero-after-midnight\content\assets\bgm。
- 不得修改 AudioManager 的默认 BGM 音量，不得在运行时对所有 BGM 统一加增益，不得增加按来源猜测的 fallback、第二张资源映射表、兼容层或新的音频状态机。
- 本轮目标是“可听的临时占位基线”，不是音乐艺术质量验收。十个文件仍可能是程序生成的占位正弦音；报告必须明确标记 INTERIM_AUDIBLE_PLACEHOLDER 和 AUDIO_QUALITY_NOT_FINAL，不得称为正式配乐、完成音频工程或音乐质量通过。
- 不得凭 Howler.playing()、snapshotPlayback.bgm、播放计数或 callback 计数单独声称玩家听见了声音。自动化只能证明播放链和资产电平；最终“人耳可听”必须由总经理部署后人工试听确认。
- 不得把原始低电平 BGM 证据删除或覆盖。修改前必须生成十个文件的路径、字节数、SHA-256、WAV 格式、样本率、声道、时长、RMS dBFS、峰值 dBFS 台账，作为不可变前置证据。
- 归一化必须是离线、确定性的样本处理：保持 WAV 容器、采样率、声道数、样本格式、样本数量和时长；不得重新采样、压缩成 MP3、改变循环长度、添加淡入淡出或改变音乐内容。
- 目标值固定为：归一化后每首 BGM 的 rmsDbfs >= -30 dBFS，目标 RMS 约 -23 dBFS，峰值不得超过 -1 dBFS；若某文件在峰值安全限制下无法达到门槛，必须停止并报告，不能削波或继续扩大增益。
- 不处理 se、voice、字体、图片或任何非 BGM 文件；不得用音效的响度去掩盖 BGM 缺陷。
- 先红后绿：先运行只读审计并取得十首 BGM 的低电平红灯，再进行归一化；不能先改文件再倒推红灯。
- 失败证据、旧哈希、原始审计 JSON、人工试听结果和任何 Howler 错误不得删除、筛选或改写。
- 保留这些受保护文件完全不变、未修改、未暂存、未提交、未删除、未移动：AGENTS.md、SESSION-HANDOFF.md、USER.md、docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md、docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md。
- 不得修改性能 artifact、性能比较器、性能门限、Wave 5A/5B/5C、M9、Editor CRLF/LF 测试或其他与本轮无关的历史失败。
- 不得执行 git push、--force、--force-with-lease、rebase、reset、amend、squash、cherry-pick、clean、正式打包、发行或部署；完成本轮代码/资产提交后停止等待独立复审和总经理人工试听。
- 若音频分析器、WAV 格式或实际电平与本计划不一致，必须停在当前 Task 报告证据，不得猜测性修改引擎或扩大素材范围。

## Locked File Map

本轮只允许创建或修改以下文件：

- Create: examples/zero-after-midnight/scripts/audio-audit.mjs — 无新增依赖的 PCM-16 WAV 分析、阈值审计和确定性归一化工具。
- Create: examples/zero-after-midnight/test/audio-assets.test.ts — 对十首 BGM 的格式、电平、峰值和不可变属性做测试。
- Modify: examples/zero-after-midnight/package.json — 添加 audio:audit、audio:normalize，并将音频聚焦测试纳入现有 test 脚本。
- Modify: examples/zero-after-midnight/content/assets/bgm/blackout.wav
- Modify: examples/zero-after-midnight/content/assets/bgm/convenience_hum.wav
- Modify: examples/zero-after-midnight/content/assets/bgm/ending_meeting.wav
- Modify: examples/zero-after-midnight/content/assets/bgm/ending_silence.wav
- Modify: examples/zero-after-midnight/content/assets/bgm/ending_testimony.wav
- Modify: examples/zero-after-midnight/content/assets/bgm/investigation.wav
- Modify: examples/zero-after-midnight/content/assets/bgm/last_train.wav
- Modify: examples/zero-after-midnight/content/assets/bgm/midnight_rain.wav
- Modify: examples/zero-after-midnight/content/assets/bgm/old_room.wav
- Modify: examples/zero-after-midnight/content/assets/bgm/underground_signal.wav
- Create: docs/baselines/zero-after-midnight-bgm-audibility-baseline-2026-08-13.json — 修改前后机器可读电平、格式、哈希和归一化参数台账。
- Create: docs/ENGINE-BGM-AUDIBILITY-WAVE-1-DELIVERY-REPORT-2026-08-13.md — 所有验证完成后最后生成的交付报告。
- Modify: docs/superpowers/plans/2026-08-13-bgm-audibility-and-asset-quality.md — 逐 Task 记录真实命令、红灯、绿灯、哈希和停止状态。

不得修改 packages/renderer/src/audio-manager.ts、packages/renderer/src/types.ts、examples/shared/resolved-audio.ts、examples/zero-after-midnight/src/main.ts 或 examples/starter/src/main.ts；上一轮 Gallery 播放接线已经完成，本轮问题是素材电平，不是播放 API。

---

## Execution Ledger

### Task 0 — completed: real baseline before any WAV write

- 已重新读取 `E:\surdet\AGENTS.md`、本计划全文和 Git 操作准则。
- 起始 `HEAD`：`7c4a0059204e927061a67b2005da0036d056409e`。
- 起始 `HEAD...surdet/main`：`0 0`。
- 起始 `git status --short` 仅有五个受保护未跟踪文件，以及本轮计划本身：
  `AGENTS.md`、`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`、`docs/superpowers/plans/2026-08-13-bgm-audibility-and-asset-quality.md`。
- 起始 `git diff --check`：退出码 `0`；`git ls-files '*.log'`：空。
- 锁定 BGM 目录恰有计划规定的十个 WAV，无额外或缺失项；十个文件当前均为 `5644878` 字节：`blackout.wav`、`convenience_hum.wav`、`ending_meeting.wav`、`ending_silence.wav`、`ending_testimony.wav`、`investigation.wav`、`last_train.wav`、`midnight_rain.wav`、`old_room.wav`、`underground_signal.wav`。
- 只读边界检查确认上一轮 Gallery 播放修复仍在：`AudioManager.playBgm(src, options?)`、`BgmPlaybackOptions.restart`、`ResolvedAudio` 唯一 URL 映射和 Zero/Starter Gallery `onPlayMusic` 均存在；本轮未修改 Renderer、ResolvedAudio、Starter 或 Zero 播放接线。
- Task 0 完成时没有写入、替换或重建任何 WAV；下一阶段入口为 Task 1，必须先写分析器/格式测试并取得红灯。


### Task 0: 读取规则并建立真实基线

**Files:**
- Read: E:\surdet\AGENTS.md
- Modify: docs/superpowers/plans/2026-08-13-bgm-audibility-and-asset-quality.md（只记录实际结果）

**Interfaces:**
- Consumes: 当前仓库、已推送的 Gallery 播放修复、十个 BGM WAV。
- Produces: 本轮真实起点、范围边界和无写入基线。

- [ ] **Step 1: 读取项目规则与 Git 状态**

运行：

~~~powershell
Get-Content -Raw E:\surdet\AGENTS.md
git rev-parse HEAD
git status --short
git rev-list --left-right --count HEAD...surdet/main
git diff --check
git ls-files '*.log'
~~~

把实际输出写入计划 Task 0。若 HEAD、远端关系或工作树与预期不同，不得清理或覆盖用户文件；先记录真实状态。

- [ ] **Step 2: 检查锁定资产集合**

运行：

~~~powershell
Get-ChildItem E:\surdet\examples\zero-after-midnight\content\assets\bgm -File | Sort-Object Name | Select-Object Name,Length
~~~

确认目录中用于本轮的确切十个 WAV；如果出现额外 BGM 或缺少任意锁定文件，记录并停止，不要自行扩大或缩小集合。

- [ ] **Step 3: 记录上一轮播放修复边界**

只读检查：

~~~powershell
rg -n "playBgm\(|restart|ResolvedAudio|onPlayMusic" packages/renderer/src examples/shared examples/zero-after-midnight/src examples/starter/src
~~~

确认本轮不再改播放 API、音量默认值或 Gallery callback。上一轮 GALLERY_CLICK_PATH_FIXED 作为前置能力保留，本轮只处理 BGM 资产可听性。

---

### Task 1: 先写审计器与格式红灯，再测量原始资产

**Files:**
- Create: examples/zero-after-midnight/scripts/audio-audit.mjs
- Create: examples/zero-after-midnight/test/audio-assets.test.ts
- Modify: examples/zero-after-midnight/package.json
- Modify: docs/superpowers/plans/2026-08-13-bgm-audibility-and-asset-quality.md

**Interfaces:**
- Consumes: 十个锁定 BGM WAV。
- Produces: analyzeWav(buffer)、analyzeWavFile(filePath)、auditBgmAssets(options) 和 normalizeWavPcm16(buffer, options) 四个可测试函数；命令行默认只读。

- [ ] **Step 1: 写最小格式解析测试，先取得红灯**

测试必须覆盖：

~~~ts
it('拒绝不是 RIFF/WAVE 的输入', () => {
  expect(() => analyzeWav(Buffer.from('bad'))).toThrow('WAV');
});
it('拒绝不是 PCM 16-bit 的 WAV', () => {
  expect(() => analyzeWav(nonPcmFixture)).toThrow('PCM 16');
});
it('正确计算 stereo PCM16 的样本数、时长、RMS 和峰值', () => {
  expect(analyzeWav(fixture)).toMatchObject({
    format: 'pcm_s16le',
    sampleRate: 44100,
    channels: 2,
    bitsPerSample: 16,
  });
});
~~~

先运行：

~~~powershell
npm run test -w zero-after-midnight -- audio-assets.test.ts
~~~

预期：新增测试先失败，因为 audio-audit.mjs 和导出函数尚不存在。不得跳过红灯直接写归一化文件。

- [ ] **Step 2: 实现无依赖的 WAV PCM16 分析器**

实现必须使用 Node 内置 fs、path，不添加新 npm 包。公开接口固定为：

~~~js
export function analyzeWav(buffer) {
  // 返回：
  // { format, sampleRate, channels, bitsPerSample,
  //   sampleCount, durationSec, rmsDbfs, peakDbfs,
  //   dataOffset, dataBytes }
}

export function analyzeWavFile(filePath) {
  return analyzeWav(readFileSync(filePath));
}
~~~

解析规则固定如下：

~~~text
1. 前 12 字节必须是 RIFF + little-endian fileSize + WAVE。
2. 遍历 RIFF chunks，找到 fmt 及 data；允许未知 chunk，但必须按 chunk size 跳过并处理偶数字节对齐。
3. fmt.audioFormat 必须为 1（PCM），bitsPerSample 必须为 16，channels 必须为 1 或 2，sampleRate 必须为正整数。
4. dataBytes 必须是 blockAlign 的整数倍；每个 int16 样本归一化为 sample / 32768。
5. peakDbfs = 20 * log10(maxAbs || Number.MIN_VALUE)。
6. rmsDbfs = 20 * log10(sqrt(sum(sample^2) / sampleCount) || Number.MIN_VALUE)。
7. durationSec = sampleCount / (sampleRate * channels)。
8. 任一结构不满足时抛出包含具体原因的 Error；不得静默接受坏文件。
~~~

- [ ] **Step 3: 加入只读命令和 package script**

audio-audit.mjs 的默认命令必须只读并输出 JSON；命令行接口固定为：

~~~text
node scripts/audio-audit.mjs --json
node scripts/audio-audit.mjs --fail-under-rms-dbfs -30
node scripts/audio-audit.mjs --normalize --target-rms-dbfs -23 --max-peak-dbfs -1
~~~

默认输入目录固定为 content/assets/bgm，只遍历扩展名为 .wav 且文件名在十项 allowlist 内的文件。--fail-under-rms-dbfs 只报告失败并以非零退出；不写文件。--normalize 在 Task 3 前不得执行。

examples/zero-after-midnight/package.json 添加：

~~~json
"audio:audit": "node scripts/audio-audit.mjs --json",
"audio:normalize": "node scripts/audio-audit.mjs --normalize --target-rms-dbfs -23 --max-peak-dbfs -1"
~~~

并把 test/audio-assets.test.ts 加入现有 test 脚本；不得删除原有 simulation、Player UI 测试。

- [ ] **Step 4: 运行原始资产红灯**

运行：

~~~powershell
npm run audio:audit -w zero-after-midnight -- --fail-under-rms-dbfs -30
npm run audio:audit -w zero-after-midnight -- --json > $env:TEMP\surdet-bgm-pre-normalization-2026-08-13.json
npm run test -w zero-after-midnight -- audio-assets.test.ts
~~~

预期：当前十首原始 BGM 全部因 rmsDbfs < -30 失败；报告/计划记录每首实际值、原始字节数和 SHA-256。若某首不失败，也必须如实记录，不得为了统一表格篡改阈值。

---

### Task 2: 为确定性归一化实现写红灯与安全不变量

**Files:**
- Modify: examples/zero-after-midnight/scripts/audio-audit.mjs
- Modify: examples/zero-after-midnight/test/audio-assets.test.ts
- Modify: examples/zero-after-midnight/package.json
- Modify: docs/superpowers/plans/2026-08-13-bgm-audibility-and-asset-quality.md

**Interfaces:**
- Consumes: Task 1 的原始审计结果。
- Produces: 只对已知 PCM16 WAV 做安全、确定性、可回退的样本增益计算；尚未替换正式资产。

- [ ] **Step 1: 写归一化安全红灯**

在测试中先加入：

~~~ts
it('目标电平计算不能超过峰值安全上限', () => {
  const result = normalizeWavPcm16(safeFixture, {
    targetRmsDbfs: -23,
    maxPeakDbfs: -1,
  });
  const before = analyzeWav(safeFixture);
  const after = analyzeWav(result);
  expect(after.peakDbfs).toBeLessThanOrEqual(-1);
  expect(after.rmsDbfs).toBeGreaterThanOrEqual(-30);
  expect(after.sampleRate).toBe(before.sampleRate);
  expect(after.channels).toBe(before.channels);
  expect(after.sampleCount).toBe(before.sampleCount);
});

it('无法在不削波的情况下达到最低电平时直接失败', () => {
  expect(() => normalizeWavPcm16(hotFixture, {
    targetRmsDbfs: -23,
    maxPeakDbfs: -1,
  })).toThrow('peak safety');
});
~~~

运行：

~~~powershell
npm run test -w zero-after-midnight -- audio-assets.test.ts
~~~

预期：新测试先红，直到归一化函数和峰值安全检查实现。

- [ ] **Step 2: 实现确定性增益算法**

公开接口固定为：

~~~js
export function normalizeWavPcm16(buffer, {
  targetRmsDbfs = -23,
  maxPeakDbfs = -1,
  minRmsDbfs = -30,
} = {}) {
  // 返回保持 WAV 结构和长度的 Buffer；不改变 fmt/data 之外的 chunk。
}
~~~

算法固定为：

~~~text
1. 先 analyzeWav(buffer)，只接受 PCM16。
2. desiredGain = 10 ^ ((targetRmsDbfs - before.rmsDbfs) / 20)。
3. peakLimitedGain = 10 ^ ((maxPeakDbfs - before.peakDbfs) / 20)。
4. gain = min(desiredGain, peakLimitedGain)。
5. 用四舍五入后的 int16(sample * gain) 写回 data chunk；值必须 clamp 到 [-32768, 32767]，但若 clamp 发生次数大于 0，必须抛出 peak safety 错误，不得静默削波。
6. 重新 analyzeWav(output)。若 output.rmsDbfs < minRmsDbfs 或 output.peakDbfs > maxPeakDbfs，抛出明确错误。
7. 输出长度、fmt chunk、sampleRate、channels、bitsPerSample、sampleCount 必须与输入完全一致。
~~~

不要使用动态压缩、限幅器、重采样、混响、EQ、淡入淡出或重新编码；这些属于后续音频工程，不属于本轮可听基线。

- [ ] **Step 3: 运行归一化绿灯但不写正式资产**

运行：

~~~powershell
npm run test -w zero-after-midnight -- audio-assets.test.ts
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { normalizeWavPcm16, analyzeWav } from './examples/zero-after-midnight/scripts/audio-audit.mjs'; const b=readFileSync('./examples/zero-after-midnight/content/assets/bgm/old_room.wav'); const a=normalizeWavPcm16(b); console.log(analyzeWav(a));"
~~~

预期：测试绿灯；试算输出的 RMS 不低于 -30 dBFS，峰值不高于 -1 dBFS，样本率/声道/样本数/时长不变；命令不得写入仓库。

---

### Task 3: 生成原始台账并替换十个临时 BGM 资产

**Files:**
- Modify: 十个锁定的 examples/zero-after-midnight/content/assets/bgm/*.wav
- Create: docs/baselines/zero-after-midnight-bgm-audibility-baseline-2026-08-13.json
- Modify: docs/superpowers/plans/2026-08-13-bgm-audibility-and-asset-quality.md

**Interfaces:**
- Consumes: Task 2 已绿灯的 normalizeWavPcm16。
- Produces: 十个保持格式不变、达到临时可听门槛的 BGM 文件和修改前后机器台账。

- [ ] **Step 1: 写入修改前不可变台账**

台账必须在写资产之前生成，包含每个文件：

~~~json
{
  "schemaVersion": 1,
  "status": "PRE_NORMALIZATION",
  "targetRmsDbfs": -23,
  "minRmsDbfs": -30,
  "maxPeakDbfs": -1,
  "files": [
    {
      "relativePath": "content/assets/bgm/old_room.wav",
      "bytes": 5644878,
      "sha256": "generated-from-disk",
      "format": "pcm_s16le",
      "sampleRate": 44100,
      "channels": 2,
      "bitsPerSample": 16,
      "sampleCount": 1411200,
      "durationSec": 32,
      "rmsDbfs": -52.5,
      "peakDbfs": -50.2
    }
  ]
}
~~~

哈希和数值必须由程序从磁盘生成，不得手填。写入后立即独立重新读取 JSON 并校验十项 allowlist、路径、字节数和 SHA 字段存在。

- [ ] **Step 2: 用 allowlist 和临时文件执行归一化**

执行：

~~~powershell
npm run audio:normalize -w zero-after-midnight
~~~

实现必须：

~~~text
1. 只处理十个 allowlist 路径，不接受用户输入的任意绝对路径。
2. 每个输出先写同目录唯一临时文件。
3. 对临时文件重新分析，确认格式/长度/电平/峰值全部通过。
4. 确认通过后才替换对应的目标 WAV；任一文件失败则停止，不继续下一个。
5. 替换后立即重新计算目标 SHA-256 和音频指标。
~~~

不得删除原始台账；Git 中原文件内容仍可通过前一提交恢复。不得产生 .bak、.tmp、日志、截图或其他未列入锁定文件图的仓库垃圾。

- [ ] **Step 3: 写入修改后台账并运行音频门禁**

在同一 JSON 中增加 postNormalization，每个文件包含修改后字节数、SHA、RMS、峰值和格式不变量比较：

~~~json
{
  "status": "INTERIM_AUDIBLE_PLACEHOLDER",
  "qualityStatus": "AUDIO_QUALITY_NOT_FINAL",
  "invariants": {
    "sampleRate": true,
    "channels": true,
    "bitsPerSample": true,
    "sampleCount": true,
    "durationSec": true
  },
  "postNormalization": [
    {
      "relativePath": "content/assets/bgm/old_room.wav",
      "rmsDbfs": -23.0,
      "peakDbfs": -20.7,
      "sha256": "generated-from-disk"
    }
  ]
}
~~~

运行：

~~~powershell
npm run audio:audit -w zero-after-midnight -- --fail-under-rms-dbfs -30
npm run test -w zero-after-midnight -- audio-assets.test.ts
~~~

预期：十首 BGM 全部达到 rmsDbfs >= -30，没有峰值越过 -1 dBFS，格式不变量全部为 true。若存在任一失败，停止在 Task 3，不构建、不部署、不提交“完成”报告。

---

### Task 4: 运行相关构建与回归，不把占位音伪装成正式音乐

**Files:**
- Modify: docs/superpowers/plans/2026-08-13-bgm-audibility-and-asset-quality.md

**Interfaces:**
- Consumes: 修改后的十个 BGM、审计脚本、音频台账。
- Produces: 与本轮资产变更直接相关的回归证据。

- [ ] **Step 1: 运行 Zero 直接门禁**

运行：

~~~powershell
npm run lint -w zero-after-midnight
npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000
node examples/zero-after-midnight/scripts/check-assets.mjs
npm run test -w zero-after-midnight
npm run typecheck -w zero-after-midnight
npm run build -w zero-after-midnight
~~~

预期：11 个场景 lint 为 0 errors/0 warnings；23/23 choice、3 结局、0 runtime errors；资产检查仍为 44 项；新增音频测试和原有 Player UI 测试通过；Zero typecheck/build 通过。

- [ ] **Step 2: 运行共享音频与 Shell 相关门禁**

运行：

~~~powershell
npm run test -w @surdet/renderer -- audio-manager.test.ts
npm run test -w @surdet/shell -- player-experience-gallery-music-e2e-contract.test.ts
npm run typecheck -w @surdet/renderer
npm run typecheck -w @surdet/shell
npm run build -w @surdet/core
npm run build -w @surdet/renderer
npm run build -w @surdet/host
npm run build -w @surdet/shell
~~~

本轮不应修改 Renderer/Host/Shell 源码；这些门禁用于确认资产变化没有破坏播放接线和构建边界。

- [ ] **Step 3: 如实处理全量 verify:all**

运行：

~~~powershell
npm run verify:all
~~~

如果仍然只在既有 packages/editor/test/model-roundtrip.test.ts 的 ch01_01.gal/ch02.gal CRLF/LF 逐字节断言失败，记录真实退出码 1 和失败摘要；不得修改 Editor 或 Starter 剧本来刷绿。只有当失败来自本轮音频文件、音频脚本或 Zero 门禁时，才阻断本轮并停止。

---

### Task 5: 重新部署并等待总经理人工试听

**Files:**
- Modify: docs/superpowers/plans/2026-08-13-bgm-audibility-and-asset-quality.md

**Interfaces:**
- Consumes: Task 3 归一化资产、Task 4 构建产物。
- Produces: 面向总经理的开发态部署，不代表发行。

- [ ] **Step 1: 先生成新的开发态 dist**

按顺序运行：

~~~powershell
npm run build -w @surdet/core
npm run build -w @surdet/renderer
npm run build -w @surdet/host
npm run build -w @surdet/shell
npm run build -w zero-after-midnight
~~~

确认存在：

~~~text
E:\surdet\packages\shell\dist\main.js
E:\surdet\packages\shell\dist\preload.cjs
E:\surdet\examples\zero-after-midnight\dist\index.html
E:\surdet\examples\zero-after-midnight\game.config.json
~~~

- [ ] **Step 2: 只做开发态部署**

启动 Electron 并明确加载：

~~~text
E:\surdet\examples\zero-after-midnight\dist
~~~

确认窗口标题为 零点之后 / AFTER MIDNIGHT，不是 Starter；不得执行 npm run pack、electron-builder、正式 EXE 打包或发行。

- [ ] **Step 3: 给总经理执行极简人工试听清单**

人工试听必须覆盖：

~~~text
A. 标题页 → 鉴赏 → 音乐 → 点一首已解锁 BGM，等待至少 5 秒；确认能听见连续声音。
B. 在鉴赏页点击第二首不同 BGM；确认声音内容切换且仍可听见。
C. 再点回第一首；确认能从头重新播放，不是无声或只显示“已播放”。
D. 新游戏 → 系统菜单 → 鉴赏 → 音乐；重复 A/B/C。
E. 关闭鉴赏回到标题/游戏；确认没有出现资源释放错误、黑屏、剧情推进或窗口关闭。
F. 在设置中确认主音量和 BGM 音量都不是 0；若用户设置被持久化为 0，先恢复默认再判断。
~~~

执行 AI 不得替总经理填写“听见/没听见”；只能记录路径、窗口状态、控制台错误和等待结果，最终听感由总经理确认。

---

### Task 6: 交付报告、提交并停止

**Files:**
- Create: docs/ENGINE-BGM-AUDIBILITY-WAVE-1-DELIVERY-REPORT-2026-08-13.md
- Modify: docs/superpowers/plans/2026-08-13-bgm-audibility-and-asset-quality.md

**Interfaces:**
- Consumes: Task 0–5 的真实命令、原始/修改后审计 JSON、十个 BGM 哈希、构建结果和总经理人工试听结果。
- Produces: 可独立复审的交付报告；不执行远端 push。

- [ ] **Step 1: 最后生成报告**

报告必须明确写出：

~~~text
用户症状：Gallery 音乐点击有鼠标反馈，但所有 BGM 人耳不可闻；正常游戏音效可闻。
已证实根因：十首 BGM 的原始 RMS/峰值远低于可听基线；不是 Gallery callback 或 URL 解析问题。
处理方式：离线 PCM16 样本增益归一化；未修改 AudioManager 默认增益；未修改音乐内容结构。
资产状态：INTERIM_AUDIBLE_PLACEHOLDER。
艺术质量：AUDIO_QUALITY_NOT_FINAL，程序正弦占位音仍需后续音频工程师替换。
自动门禁：实际命令、退出码和失败摘要。
人工听审：只能逐字记录总经理提供的结果，不可代填。
~~~

报告中的每个路径、字节数、SHA-256、RMS、峰值、样本率、声道和时长必须由磁盘重新读取；不得凭记忆填写。

- [ ] **Step 2: 运行交付验证**

报告生成后立即独立执行：

~~~powershell
Get-Item E:\surdet\docs\ENGINE-BGM-AUDIBILITY-WAVE-1-DELIVERY-REPORT-2026-08-13.md | Select-Object Length,FullName
Get-FileHash E:\surdet\docs\ENGINE-BGM-AUDIBILITY-WAVE-1-DELIVERY-REPORT-2026-08-13.md -Algorithm SHA256
Get-Item E:\surdet\docs\baselines\zero-after-midnight-bgm-audibility-baseline-2026-08-13.json | Select-Object Length,FullName
Get-FileHash E:\surdet\docs\baselines\zero-after-midnight-bgm-audibility-baseline-2026-08-13.json -Algorithm SHA256
~~~

再执行：

~~~powershell
git diff --check
git ls-files '*.log'
git status --short
git rev-parse HEAD
git rev-list --left-right --count HEAD...surdet/main
~~~

- [ ] **Step 3: 普通本地提交并停在复审**

只允许普通本地提交：

~~~powershell
git add examples/zero-after-midnight/scripts/audio-audit.mjs examples/zero-after-midnight/test/audio-assets.test.ts examples/zero-after-midnight/package.json examples/zero-after-midnight/content/assets/bgm/blackout.wav examples/zero-after-midnight/content/assets/bgm/convenience_hum.wav examples/zero-after-midnight/content/assets/bgm/ending_meeting.wav examples/zero-after-midnight/content/assets/bgm/ending_silence.wav examples/zero-after-midnight/content/assets/bgm/ending_testimony.wav examples/zero-after-midnight/content/assets/bgm/investigation.wav examples/zero-after-midnight/content/assets/bgm/last_train.wav examples/zero-after-midnight/content/assets/bgm/midnight_rain.wav examples/zero-after-midnight/content/assets/bgm/old_room.wav examples/zero-after-midnight/content/assets/bgm/underground_signal.wav docs/baselines/zero-after-midnight-bgm-audibility-baseline-2026-08-13.json
git commit -m "fix(audio): raise zero-after-midnight bgm audibility"

git add docs/ENGINE-BGM-AUDIBILITY-WAVE-1-DELIVERY-REPORT-2026-08-13.md docs/superpowers/plans/2026-08-13-bgm-audibility-and-asset-quality.md
git commit -m "docs(audio): record bgm audibility baseline"
~~~

提交后停止，不得 push。最终状态必须写为：

~~~text
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
~~~

## Completion Review Checklist

- [ ] 原始十首 BGM 的低电平事实有修改前字节数、SHA-256、RMS 和峰值证据。
- [ ] 原始红灯是在任何资产写入前取得的。
- [ ] 归一化只处理十个明确 BGM WAV，未处理 SE/voice/图片/字体。
- [ ] WAV 的采样率、声道、位深、样本数、时长和容器结构保持不变。
- [ ] 每首修改后 BGM 的 RMS 至少为 -30 dBFS，峰值不超过 -1 dBFS。
- [ ] 没有修改 AudioManager 默认 BGM 音量，也没有加入运行时全局增益。
- [ ] Gallery 同曲目重播修复仍保留，逻辑键到实际 URL 的映射未被替换。
- [ ] 自动化没有把 playing=true 单独当作听见声音。
- [ ] Zero lint/simulate/assets/test/typecheck/build 通过；无关 Editor EOL 失败如实保留。
- [ ] 开发态 Electron 使用最新本地构建，明确加载正式 Zero dist。
- [ ] 总经理人工试听结果逐字记录，未由执行 AI 代填。
- [ ] 报告和台账磁盘存在、大小/哈希重新读取，提交后停止在复审，未 push/发行。

### Task 1 — completed: PCM16 analyzer and original-asset red baseline

- 先写 `examples/zero-after-midnight/test/audio-assets.test.ts` 和 Zero `test` 脚本入口，再运行 `npm run test -w zero-after-midnight -- audio-assets.test.ts`；在分析器创建前得到合法红灯：`audio-audit.mjs` 模块不存在。该命令同时确认既有资产/场景预检通过（`assets ok: 44`、`verified 11 scenes and 3 endings`），原有 Player UI 测试 `22/22` 通过，新增套件加载失败。
- 实现 `examples/zero-after-midnight/scripts/audio-audit.mjs`，只使用 Node 内置 `fs`、`path`、`crypto`；支持 `analyzeWav`、`analyzeWavFile`、`auditBgmAssets`、`normalizeWavPcm16` 和 allowlist 约束的批量归一化。解析器实际遍历 RIFF chunk，处理未知奇数长度 chunk 的对齐，验证 PCM、16-bit、1/2 声道、sampleRate、blockAlign、data 非空/不越界，并扫描真实 int16 PCM 样本计算 RMS/peak/duration。
- 同一聚焦命令在分析器实现后转绿：新增音频测试 `4/4`，Zero 聚焦测试合计 `26/26` 通过。
- 增加只读/归一化脚本：`audio:audit` 与 `audio:normalize`；此阶段只执行审计，未执行 normalize，未写入任何 WAV。
- `npm run audio:audit -w zero-after-midnight -- --fail-under-rms-dbfs -30` 取得正式原始资产红灯，退出码 `1`；十首均低于阈值，实际 RMS 为 `-53.204559943882614` 至 `-53.19798824926366` dBFS，实际 peak 均约 `-50.22257122354151` dBFS。
- 原始只读 JSON 已保存到系统临时目录：`C:\Users\Equinox\AppData\Local\Temp\surdet-bgm-pre-normalization-2026-08-13.json`，字节数 `5114`，SHA-256 `B1C66EEE28C38726F7198EFBC88CC5AD43B6B983585898DF636ADEDADA7120B3`。其中完整记录十个文件的原始大小、SHA-256、PCM 格式、44.1kHz、双声道、16-bit、`2822400` samples、32 秒、data offset/bytes、RMS 和 peak。
- 原始十个 WAV 的文件大小均为 `5644878` 字节，原始 SHA-256 已由审计器从磁盘生成并保存在上述 JSON；任何 WAV 写入尚未发生。
- Task 1 下一阶段入口：Task 2。先添加确定性归一化安全测试并取得红灯；正式资产和原始台账仍不得写入或覆盖。

### Task 2 — completed: deterministic PCM16 normalization red → green

- 先将 `normalizeWavPcm16` 临时置为明确失败的未实现分支，运行 `npm run test -w zero-after-midnight -- audio-assets.test.ts` 取得合法红灯：新增归一化安全测试中 `safe normalization reaches target RMS` 与 `rejects clipping-prone normalization` 失败；聚焦套件其余既有测试通过。
- 恢复最小确定性实现后，用同一命令转绿：音频测试 `6/6`，Zero 聚焦总计 `28/28`；资产预检仍为 `assets ok: 44`，场景预检仍为 `verified 11 scenes and 3 endings`。
- 归一化实现仅对 PCM16 data chunk 的每个样本使用同一增益，目标 RMS `-23 dBFS`，峰值安全上限 `-1 dBFS`，包含四舍五入、int16 限幅保护、非预期 clipping 失败、容器/结构/采样率/声道/样本数/时长不变校验；批处理先在内存和同目录临时文件中验证全部十首，全部成功后才替换目标文件。
- 在写入正式 WAV 前执行 dry-run，仅分析内存结果；`old_room.wav` 归一化预览为 PCM16、44.1kHz、双声道、`2822400` samples、32 秒、RMS `-22.99999561996108 dBFS`、peak `-20.01804364598864 dBFS`，未写入正式资产。
- 本阶段仍未写入十个正式 WAV，未覆盖原始基线，下一入口为 Task 3：先生成并独立验证正式原始基线，再执行唯一一次正式资产归一化。

### Task 3 — completed: ten BGM assets normalized and re-audited

- 在任何 WAV 写入前生成正式基线 `docs/baselines/zero-after-midnight-bgm-audibility-baseline-2026-08-13.json`；写入前独立校验确认十首当前文件与原始临时审计逐字段一致。基线写入前状态为 `PRE_NORMALIZATION`，包含完整原始大小、SHA-256、PCM 指标；原始临时证据仍保留在系统临时目录，未被覆盖。
- 基线磁盘证据：`14920` bytes，SHA-256 `1BC6448D2E49018F154730A5A8C72B4971E9ED5CEA7E6219FC52348CFF630C9D`。基线随后保留原始 `files`，并追加 `postNormalization`、增益、clipping 和容器结构不变证据；最终状态为 `INTERIM_AUDIBLE_PLACEHOLDER` / `AUDIO_QUALITY_NOT_FINAL`。
- 仅执行一次 `npm run audio:normalize -w zero-after-midnight`，退出码 `0`；批处理在同目录临时文件中完成十首预验证后才替换正式文件。
- 归一化后 `npm run audio:audit -w zero-after-midnight -- --fail-under-rms-dbfs -30` 退出码 `0`，十首 `failed=[]`；后审计临时 JSON 为 `C:\Users\Equinox\AppData\Local\Temp\surdet-bgm-post-normalization-2026-08-13.json`，`5114` bytes，SHA-256 `16D7287476C7BB615EAC78B48F790136BD804D657C0AB60242951AACAE4C5E17`（该文件由磁盘重新计算）。
- 十首归一化后仍为 `5644878` bytes、44.1kHz、双声道、16-bit、`2822400` samples、32 秒、data offset `78`、data bytes `5644800`；RMS 范围 `-23.00002429025442` 至 `-22.999884650933694` dBFS，peak 范围 `-20.023357741986803` 至 `-20.01804364598864` dBFS，全部达到 `RMS >= -30` / `peak <= -1`，clipping `0`。
- 新增正式资产回归测试后，`npm run test -w zero-after-midnight -- audio-assets.test.ts` 退出码 `0`：音频测试 `7/7`，聚焦总计 `29/29`；`node --check examples/zero-after-midnight/scripts/audio-audit.mjs` 退出码 `0`。
- Task 3 下一阶段入口：Task 4。继续验证 Zero、Renderer、Shell 及 Gallery 播放边界；不得修改 AudioManager、ResolvedAudio 或 Gallery 接线。

### Task 4 — completed: affected-module gates and repository verification

- `npm run lint -w zero-after-midnight`：退出码 `0`；11 个场景、0 errors、0 warnings。
- `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000`：退出码 `0`；23/23 choice branches、3 个结局、运行时错误 `0`。
- `node examples/zero-after-midnight/scripts/check-assets.mjs`：退出码 `0`；`assets ok: 44`。
- `npm run test -w zero-after-midnight`：退出码 `0`；4 files、29/29 tests；其中音频资产测试 `7/7`。
- `npm run typecheck -w zero-after-midnight`、`npm run build -w zero-after-midnight`：均退出码 `0`。
- `npm run test -w @surdet/renderer -- audio-manager.test.ts`：退出码 `0`，21/21；`npm run test -w @surdet/shell -- player-experience-gallery-music-e2e-contract.test.ts`：退出码 `0`，3/3。
- `npm run typecheck -w @surdet/renderer`、`npm run typecheck -w @surdet/shell`、`npm run build -w @surdet/renderer`、`npm run build -w @surdet/shell`：均退出码 `0`；Shell preload 正常生成。
- `npm run verify:all`：按要求完整执行，退出码 `1`；失败仅为既有 Editor CRLF/LF 逐字节往返测试 `ch01_01.gal`、`ch02.gal`，与本轮十个 WAV、分析器和 Gallery 播放链无关。本轮未修改 Editor、Starter 剧本或换行测试；其余 verify:tools、renderer boundaries/legacy、types、Core/Host/Renderer/Shell/Starter/Zero 测试均通过，Renderer `49` files / `404` tests 通过。
- 生产层边界核对：`git diff --name-only` 仅包含十个 BGM WAV、Zero package、音频分析器/测试、BGM baseline 和本计划；未出现 `packages/renderer`、`packages/host`、`packages/shell`、`packages/core`、Starter 或 Editor 改动。AudioManager 默认音量、Gallery 播放接线和 ResolvedAudio 均未修改。
- Task 4 下一阶段入口：Task 5。按依赖顺序重新构建并启动正式 `examples/zero-after-midnight/dist` 开发态 Electron；只记录客观窗口状态，不代替人工听感判断。

### Task 5 — completed: formal Zero development deployment

- 按依赖顺序执行并全部退出码 `0`：`npm run build -w @surdet/core`、`npm run build -w @surdet/renderer`、`npm run build -w @surdet/host`、`npm run build -w @surdet/shell`、`npm run build -w zero-after-midnight`。
- 必要文件均存在：`packages/shell/dist/main.js`（13912 bytes）、`packages/shell/dist/preload.cjs`（2830 bytes）、`examples/zero-after-midnight/dist/index.html`（918 bytes）、`examples/zero-after-midnight/game.config.json`（1035 bytes）。
- 使用临时 `SURDET_E2E=1` / `SURDET_E2E_GAME_DIR` 启动开发态 Electron，未写入永久环境变量；正式入口为 `E:\surdet\examples\zero-after-midnight\dist`。PID `34472`，`HasExited=False`，窗口标题 `零点之后 / AFTER MIDNIGHT`，窗口留给总经理人工操作。
- 未执行 pack/electron-builder/EXE 发行；未关闭其他 Electron 窗口；未执行性能工作；未修改 AudioManager、Gallery 播放接线或任何运行时代码。
- Task 5 下一阶段入口：Task 6。生成交付报告、重新读取报告/基线大小与 SHA-256，完成本地提交，不 push，并停止等待独立复审。

### Task 6 — completed: delivery report, evidence re-read, and local closure

- 交付报告已真实创建：`docs/ENGINE-BGM-AUDIBILITY-WAVE-1-DELIVERY-REPORT-2026-08-13.md`，磁盘复核为 `13456` bytes，SHA-256 `D64D12FFB517E9D35F0DA18C4825B8001DD52E45AD8E147B9B1476CA3EC273B3`。
- 正式 baseline 已重新读取：`docs/baselines/zero-after-midnight-bgm-audibility-baseline-2026-08-13.json`，`14920` bytes，SHA-256 `1BC6448D2E49018F154730A5A8C72B4971E9ED5CEA7E6219FC52348CFF630C9D`。
- 代码/资产提交已完成：`565192adfa83499d837652b1f06b21f051822054`，提交前精确暂存清单仅含十首 WAV、音频分析器、音频测试、Zero package 和 baseline；未夹带计划、报告、构建产物、日志或受保护文件。
- 报告和本计划台账将作为第二个普通本地文档提交；该提交完成后的真实 HEAD、`HEAD...surdet/main` 和 `git status --short` 将在提交后只读复核，并在最终回报中给出。没有使用 amend/rebase/reset/squash，也不会 push。
- 最终保留状态：`BGM_AUDIBILITY_BASELINE_IMPLEMENTED`、`TEN_BGM_ASSETS_NORMALIZED`、`GALLERY_PLAYBACK_CHAIN_RETAINED`、`INTERIM_AUDIBLE_PLACEHOLDER`、`AUDIO_QUALITY_NOT_FINAL`、`MANUAL_AUDIO_REVIEW_PENDING`、`PERFORMANCE_WORK_DEFERRED`、`M9_NOT_STARTED`、`NOT_PUSHED`、`WAITING_FOR_INDEPENDENT_REVIEW`。
