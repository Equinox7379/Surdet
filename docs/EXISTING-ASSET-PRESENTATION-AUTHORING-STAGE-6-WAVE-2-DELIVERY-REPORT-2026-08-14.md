# Surdet Existing-Asset Presentation Authoring — Stage 6 Wave 2 交付报告

日期：2026-08-14（Asia/Shanghai）

本报告记录 Stage 6 Wave 2（既有资源驱动的场景演出纵向切片）的实现、聚焦验证、重新取证与最终 FORMAL 证据。它不代替项目所有者的人工验收，也不修改长期路线台账。

## 结论先行

- 共享 authoring 层新增只读 asset catalog 与类型化 timeline 写入能力；CLI 注册 `timeline.create`/`timeline.patch`/`project.assets`（能力面 14→17）；editor 复用同一真相并在因果区展示 timeline/track/cue/asset 对象与四向因果。
- 唯一 FORMAL 聚合已运行一次并通过：artifact `status=PASSED`、`evidenceClass=FORMAL`、`runHead` 与 CODE_EVIDENCE_HEAD 完全一致。
- FORMAL 证明：显式 `agent_probe/start` 启动（不依赖 game.config.entryScene）；触发 `agent_blackout` 前舞台干净（无 lynn、无 night_field、fadeAlpha=0）；播放后背景切换到 night_field、lynn（uniform/night）登场、fade 真实发生并回到 0；fade 轨迹用 rAF 帧采样证明（达到 1 → 中间值 → 回 0）。
- 资源门槛：night_field 与 lynn_uniform_night 在共享 catalog 中 `resolved=true`；CLI `project.assets` 与 `project.inspect.assets` 逐字段一致。
- 三次历史 DIAGNOSTIC 失败（上一预算）与一次新预算 DIAGNOSTIC 的 artifact 全部保留；失败根因（两次 harness 序列化缺陷、一次采样窗口缺陷）已修复并提交，治理按台账 4.80/4.81 收口。

## 1. 本轮范围与实际修改

### 1.1 共享层 @surdet/authoring

- 新增 `packages/authoring/src/asset-catalog.ts`：只读解析 `content/assets/bg/<key>.<ext>` 与 `content/assets/portrait/<role>_<outfit>_<expression>.<ext>`；受支持格式集合以仓库现有资源加载器事实为基线（svg/png/jpg/jpeg/webp/gif/avif）；`resolved` = 格式受支持。CLI 与 editor 只提供路径元数据，不读文件内容、不写资源。
- 新增 `packages/authoring/src/timeline-operations.ts`：`timeline.create`（timelineId === definition.id === file-stem 身份不变量、Wave 2 track/action 白名单、Core validateTimeline 前置校验）；`timeline.patch` 五种单 patch 原子操作（addTrack 验 timeline 指纹；removeTrack/insertCue 验 track 指纹；replaceCue/removeCue 验 cue 指纹；SHA-256 规范化 JSON 指纹，规范化规则由共享层唯一实现）。
- 扩展 `object-index.ts`：timeline/track/cue/asset 对象（track/cue 为 revision-scoped 位置序 ref）、四向因果边（scene @timeline 指令 → timeline → track/cue → asset，反向 referencedBy 完整）；`@timeline` 指令只取第一个参数为时间轴 ID。
- 扩展 `validation.ts`：对快照内每个 timeline 文件调用 Core `validateTimeline`（结构诊断进 error 信封）；资源引用（cue.key / track.target+expression）解析失败只报 warning（不拒绝、不阻止 commit）；`@timeline` 目标缺失报 `TIMELINE_MISSING` error（仅当快照确实包含时间轴集合时检查，避免 editor 内联校验误报）。
- 扩展 `diff.ts`：operation ledger 对象级 semantic diff（kind/operationId/objectBefore/objectAfter/fingerprintBefore/fingerprintAfter/directChange/potentialImpact/observedImpact）；track/cue 无持久语义 ID，不按数组位置猜身份。
- `contracts.ts`/`index.ts`：Wave 2 类型（AssetEntry/TimelineCreateInput/TimelinePatchInput/LedgerDiffEntry 等）与导出。

### 1.2 CLI（Node 薄适配）

- `authoring-service.ts`：注册 `timeline.create`/`timeline.patch`/`project.assets`；`object.inspect` 支持 `--change` 事务视图并为 timeline/track/cue 附当前 SHA-256 指纹；`project.inspect` 扩展 assets catalog；`project.validate` 注入共享 asset catalog；`project.simulate` 接受显式 `sceneId`（代理 entryScene，不复制第二套模拟器）。
- `authoring-command.ts`/`index.ts`：命令族 `timeline` 注册与 dispatch；`project simulate` 可选 `--input`；`object inspect` 传 `--change`。

### 1.3 editor（复用同一真相）

- `project-io.ts`：资产扫描记录 handle→项目相对路径（`recordAssetPath`/`assetPathForHandle`，WeakMap）。
- `authoring-project-storage.ts`：`listFiles` 枚举 `content/assets` 下 bg/portrait 路径元数据；快照仍排除资产（isSnapshotPath 不变）。
- `causal-selection.ts`：track/cue/asset 可读显示；`locateTimelineCuesForStageChange` 纯函数（从 stage 前后差异反查 show/set/fade cue）。
- `panels/preview-panel.ts`：@timeline 轨迹事件用前后 stage 差异定位具体 cue。`panels/right.ts`：时间轴对象展示轨道/Cue 子列表。

### 1.4 harness 与测试

- 新增 `packages/shell/e2e/agent-ready-presentation-wave-2.e2e.mjs`（--preflight/--diagnostic/缺省 FORMAL）；`packages/shell/package.json` 注册 `e2e:authoring:wave2`。
- authoring 五个聚焦测试（30 tests）、CLI 纵向测试（1 test）、editor 目录测试（4 tests）、CLI 合同测试（14→17 数字断言更新）。

## 2. 聚焦验证（真实运行，全部 exit 0）

```text
npm run test -w @surdet/authoring -- test/timeline-operations.test.ts test/asset-catalog.test.ts test/timeline-object-index.test.ts test/validation-timeline.test.ts test/diff-ledger.test.ts   → 5 files / 30 tests passed
npm run typecheck -w @surdet/authoring；npm run build -w @surdet/authoring                                    → exit 0
npm run test -w @surdet/cli -- test/authoring-presentation-wave2.test.ts                                     → 1/1 passed
npm run typecheck -w @surdet/cli；npm run build -w @surdet/cli                                              → exit 0
npm run test -w surdet-editor -- test/presentation-asset-catalog.test.ts                                    → 4/4 passed
npm run typecheck -w surdet-editor；npm run build -w surdet-editor                                          → exit 0（既有大 chunk warning 保留）
node --check packages/shell/e2e/agent-ready-presentation-wave-2.e2e.mjs                                     → exit 0
npm run test -w @surdet/cli -- test/authoring-contract.test.ts                                              → 2/2 passed（能力数断言 17）
npm run e2e:authoring:wave2 -w @surdet/shell -- --preflight                                                → PREFLIGHT_PASSED（runHead 与 CODE_EVIDENCE_HEAD 一致）
```

未运行整包 `npm run test -w <pkg>`、`verify:all`、Electron、性能矩阵、pack、部署、发行。

## 3. 提交与治理

代码证据链（未 push）：

```text
748458e feat(authoring): add presentation timeline authoring            （24 个白名单文件，+3087/-38）
dc7f93a test(authoring): fix wave 2 preview asset transfer              （DIAGNOSTIC 1 根因修复）
7dda6a7 test(authoring): poll preview messages in wave 2 runner         （DIAGNOSTIC 2 根因修复）
dcf2905 test(authoring): fix wave 2 fade sampling window                （方法修正 + CLI 合同 14→17；本报告取证基线）
```

CODE_EVIDENCE_HEAD = `dcf2905837e7da2ce80c4ae1a60d0b7ee379fc32`。此前三次 DIAGNOSTIC 的 `runHead` 滚动（748458e/dc7f93a/7dda6a7）不满足“固定 CODE_EVIDENCE_HEAD”契约，已按台账 4.80/4.81 收口：不以滚动修复伪装 frozen HEAD；自 `dcf2905` 起所有 DIAGNOSTIC/FORMAL 的 `artifact.runHead` 均等于 CODE_EVIDENCE_HEAD。

## 4. DIAGNOSTIC 证据（新预算）

- artifact：`<local-path>`
- `15958` bytes、SHA-256=`0348226AE1E983BB3CF9423BF1066245088E5B0F12F3221E5662EE0EACCDFF6A`
- `status=PASSED`、`evidenceClass=DIAGNOSTIC`、`runHead=dcf2905837e7da2ce80c4ae1a60d0b7ee379fc32`
- 41 帧 fade 采样：max=1、中间值 28 帧、最后 0；干净基线/第一帧/最终 stage 断言全过；错误通道全空。

## 5. FORMAL 证据（唯一一次）

命令：`npm run e2e:authoring:wave2 -w @surdet/shell`，实际 exit=`0`，只运行一次，未重跑。

- artifact：`<local-path>`
- `15368` bytes、SHA-256=`737FF06901BBB34084FB9078FFE3A617C72A6FC7A13565BCEF0544E2A751FCC2`
- `status=PASSED`、`evidenceClass=FORMAL`、`runHead=dcf2905837e7da2ce80c4ae1a60d0b7ee379fc32`（= CODE_EVIDENCE_HEAD）
- `targetSceneId=agent_probe`、`targetLabel=start`（preview trace-start 实测一致，不依赖 entryScene）
- 触发前：`stage.portraits` 不含 `lynn:uniform`、`stage.backgroundKey ≠ night_field`（实测空）、`stage.fadeAlpha === 0`
- 第一帧：`stage.fadeAlpha === 1`（容差 0.001）、`stage.backgroundKey === 'night_field'`
- 播放后：`backgroundKey === 'night_field'`；`stage.portraits` 含 `key === 'lynn:uniform'` 且 `view.expression === 'night'`；`fadeAlpha === 0`
- fade 轨迹（rAF 帧采样 37 帧）：达到 1（max=1）、至少一次 0<α<1（28 帧）、完成后回 0（last=0）
- 资源门槛：`night_field` 与 `lynn_uniform_night` `resolved === true`；`project.assets` 与 `project.inspect.assets` 逐字段一致
- 错误通道：pageErrors/consoleErrors/requestFailures/unhandledRejections/rendererErrors/releaseFailures 全空、unexpectedWindowClosed=false
- 清理：browserClosed=true、preview/preflight 端口空闲、preview child exit/close 均观察到
- 原始 Starter 身份未变（`originalStarter.unchanged=true`）

## 6. fixture 身份

- FORMAL fixture：`<local-path>`（25 个文件，无 `.surdet-*` 临时文件）
- `content/scenario/agent_probe.gal`：`72` bytes、SHA-256=`231C5AAD5865D0333C36B8E6DF24FBA3DA783B3EBA364E3A016496764417399A`
- `content/timelines/agent_blackout.json`：`952` bytes、SHA-256=`547D4E7F5AE797046FE46D2BBE8AA17A8F0FA0DE2C652382F2747F16C44B7AF7`

## 7. 历史失败证据保留

三份历史 FAILED artifact（8965/10986/15442 bytes）与一份新预算 DIAGNOSTIC PASSED artifact 全部保留、未覆盖、未复用；三个历史桌面 fixture 保留。

## 8. 未解决问题与非阻断遗留

- 人工验收未开始：需项目所有者另行授权后按任务书第七节路径（编辑器打开 fixture → 因果区 → 预览 → 反向定位 → 微调 cue → 保存重开）执行，执行 AI 不代填视觉/操作结论。
- push 未授权；Wave 3 未授权。
- 非阻断遗留（台账 4.81 第 6 条）：`%TEMP%` 下 59 个 `surdet-player-experience-wave-2-task*` 目录，最后写入时间均为 2026-08-11，来源是历史 Player Experience Wave 2 的 CLI 测试残留（早于本 Wave 三天），与本轮 Stage 6 Wave 2 无关；本轮未创建、未触碰，未清理（清理不在本任务书白名单）。
- 任务书 Execution Ledger 与长期路线台账的分工保持：本报告不修改长期路线台账。

## 建议由总经理登记的事实

1. Stage 6 Wave 2 实现与聚焦验证完成，代码证据链 `748458e → dc7f93a → 7dda6a7 → dcf2905`，CODE_EVIDENCE_HEAD=`dcf2905`，未 push。
2. 唯一 FORMAL 通过且 `artifact.runHead === CODE_EVIDENCE_HEAD`；DIAGNOSTIC/FORMAL artifact 身份见第 4/5 节。
3. CLI 能力面 14→17（project.assets、timeline.create、timeline.patch），`authoring-contract.test.ts` 已按 4.81 授权更新为 17。
4. 三次历史 DIAGNOSTIC 失败根因已闭环（transfer 序列化、谓词序列化、fade 采样窗口），治理按 4.80/4.81 收口，不以滚动 runHead 伪装 frozen HEAD。
5. 建议授权项目所有者人工验收（任务书第七节路径），人工通过后再由项目所有者另行决定 push。

## 最终状态

```text
STAGE_6_WAVE_2_IMPLEMENTED_LOCALLY
STAGE_6_WAVE_2_FORMAL_PASSED
FORMAL_AGGREGATE_RUNHEAD_MATCHES_CODE_EVIDENCE_HEAD
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED_AFTER_STAGE_6_WAVE_2
STAGE_6_WAVE_3_NOT_STARTED
```
