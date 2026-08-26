STAGE_6_WAVE_5_CANDIDATE_COMPOSITION_VERIFIED — FORMAL_PASSED; EXTERNAL_AGENT_ACCEPTANCE_PASSED; ISOLATED_APPLY_PASSED; OWNER_ACCEPTANCE_PASSED; WAITING_FOR_INDEPENDENT_MANAGER_REVIEW; NOT_PUSHED; WAVE_6_NOT_STARTED

# Agent Candidate Comparison / Safe Composition Wave 5 交付报告

日期：2026-08-26
项目：Surdet
范围：不可变候选 capsule、对象级比较、依赖闭包、显式冲突解决、integration plan、安全重放、外部 Agent stage、隔离 apply 与 Owner 短验收

## 1. 结论与证据分层

### AUTOMATED_FACTS

本轮已经建立并验证：

- v2 composable capsule 保存可重放的规范输入、依赖 manifest 与来源身份；
- 多候选比较按对象结果、依赖闭包、冲突和相同结果子组给出确定性结果；
- A、D 对同一变量和同一场景的相同结果分别形成 identical subgroup，保留双方 provenance；
- C 对同一场景的不同结果进入显式冲突，选择 A 后 C 被排除而 D 的等价来源不丢失；
- B 的 timeline 依赖被 integration plan 自动纳入；
- plan、inspect、execute、恢复、fresh validation/simulation/runtime evidence 与 capsule 审计链可通过共享 authoring/CLI/MCP 合同完成；
- replacement FORMAL、真实外部 Agent stage、隔离 apply/resume 均通过；
- 原始 Starter 和 Surdet 仓库生产文件未被验收 fixture 操作修改。

### OWNER_REPORTED_VISUAL_FACTS

项目所有者原始反馈：

> Owner 人工验收通过：Alpha A 可见，C 不存在，Beta timeline 可见，打开、预览、保存正常。

该反馈是本轮唯一视觉和编辑器操作结论。执行 AI 与总经理没有代填画面、布局、交互手感或未来产品 UI 结论。

### REASONABLE_INFERENCES

现有证据支持：一个不了解 Surdet 源码的外部桌面 Agent，可以只依赖公开合同完成四个候选的比较、选择、规划、执行、验证和 capsule 封存；在项目所有者另行授权后，同一 integration change 能以原 plan 身份安全应用到隔离项目，并被现有 Editor 打开、预览和保存。

### UNVERIFIED_CLAIMS

- 本 Wave 没有实现候选比较产品 UI，也没有验证零基础用户对该未来 UI 的理解成本。
- 没有验证网络文件系统、多主机、分布式锁或云端协作。
- 没有进行性能资格化、Electron 发行矩阵、打包、部署或发行。
- 没有授权或开始 Wave 6。

## 2. Git 与代码证据身份

远端基线：

```text
REMOTE_MAIN=31b937638929fa8d09e575b120fd4b4681d9f7d2
```

本轮关键身份：

```text
DESIGN_HEAD=db49f53f49280908f98ef6e5be943c41a807b8a0
TASKBOOK_HEAD=31ed8f2d0e4aa2d0f3d272d1f31c32a4757ebcd0
FORMAL_CODE_EVIDENCE_HEAD=400f78d5201a6da3bd04e729588ec2e4860eed6d
FORMAL_DOCUMENT_HEAD=017d6686c94ac2c5cff43df633f579b96ea27506
ACCEPTANCE_PREP_CODE_HEAD=aa6b2ca926c218df620c220c7bd8d585f37f82ee
CURRENT_HEAD_BEFORE_DOCUMENT_CLOSURE=aa6b2ca926c218df620c220c7bd8d585f37f82ee
HEAD_REMOTE_AHEAD_BEHIND=22/0
```

主要实现链：

- `08ca65a` — v2 composable capsule manifests；
- `e96d0b1` / `645b07f` — 候选比较与至少两个候选的合同；
- `b830e27` — 不可变 integration plan；
- `2c25c2b` — replay/CAS/resume/commit gate；
- `0c8ab21` / `07dfeab` — CLI/registry/session/MCP 薄投影；
- `b0ae4d4` — provenance/freshness/失败审计；
- `c76f1c7` / `f9d8fee` — Windows lease publication 有界等待；
- `ccd167f` — 公开 selection contract；
- `9d05029` — Wave 5 聚合 runner；
- `400f78d` — A/D identical subset provenance 修复；
- `aa6b2ca` — acceptance-prep 的确定性准备与永久合同。

文档收口前，production/test/runner tracked 工作树干净、暂存区为空。本文档与任务书 Ledger 由本轮精确的 docs-only 闭合提交收口；提交身份必须在 commit 后从 Git 回读，因此本报告不预填哈希。没有 push。

## 3. 共享比较与安全合成语义

比较层按同一 `objectRef` 的规范结果分组。最终合同不再要求同一对象 bucket 中所有候选结果都相同，因而能表达：

```text
A scene result == D scene result
C scene result != A/D scene result
```

结果同时包含：

- A/D scene identical subgroup；
- A/C/D selection-required conflict；
- choose A 后排除 C；
- D 作为与 A 等价的来源继续保留 provenance；
- A/D 相同场景只 replay 一次。

相同规则也覆盖 `variable:flag.alpha`。B 的 `scene:wave5_beta` 依赖 `timeline:beta_opening`，计划自动把 timeline replay 排在 Beta scene 之前。没有行级拼接、workingFiles 复制、unified diff replay、兼容 fallback 或第二套比较器。

## 4. 聚焦验证与 aggregate 边界

最终 A/D 修复后的新鲜验证：

- Authoring focused：2 files / 26 tests PASS；
- Authoring full：27 files / 201 tests PASS；
- Authoring typecheck/build：PASS；
- Agent Port composition focused：1 file / 8 tests PASS；
- CLI full：30 files / 232 tests PASS；
- CLI typecheck/build：PASS；
- runner `node --check`：PASS；
- preflight：PASS，modern `2026-07-28`、legacy `2025-11-25`、26 capabilities、contract `2.0.0`、stdout purity、child cleanup 与 Starter unchanged。

证据边界必须保留：最终 A/D provenance 修复后没有再运行 `verify:all`，累计预算保持 `4/4`。上述 package 级验证、replacement FORMAL、外部 Agent、isolated apply 和 Owner 验收不等价于一份新鲜全仓库 aggregate gate。

## 5. Replacement FORMAL

独立复审否决了第一份只证明变量去重的 FORMAL。修复共享比较/计划语义并补充永久回归后，项目所有者只授权一次 replacement FORMAL。

```text
evidence=<local-path>
bytes=7400
sha256=5713E5B8ECC5AD31232537EF73D3937CA8BC0C4B7B5E1DFF14F496F553426E5B
identity=<local-path>
identityBytes=226
identitySha256=6053CAF3628256D717C6895D9DDB25B27555F26498C85B7302B06CB10D482322
status=PASSED
evidenceClass=FORMAL
runHead=400f78d5201a6da3bd04e729588ec2e4860eed6d
runnerSha256=09C1CE80ED7A3ADB7743C382DA4E9B3BAF5ADB972DBDF3A9A388B46F0FCA692F
milestones=18/18 PASSED
lastPassedNode=fresh-observe-and-disk-equivalence
firstFailedNode=null
errors=[]
childCleanupFailures=[]
activeLeaseDirectories=[]
```

FORMAL 明确证明 A/D variable group、A/D scene group、C exclusion、D provenance retention、每组单次 replay、fresh validation/simulation/Alpha/Beta traces、stage project unchanged、source candidates unchanged、Starter unchanged 和 formal fixture apply equivalence。

## 6. Acceptance-prep

初始 acceptance-prep 方法存在“空 data dir 也可能被写成 PREPARED”的设施缺口。项目所有者授权的 recovery 只修改 runner 和一份永久测试；RED→GREEN 后，唯一 replacement acceptance-prep 通过。

```text
root=<local-path>
project=<local-path>
dataDir=<local-path>
runHead=aa6b2ca926c218df620c220c7bd8d585f37f82ee
evidenceBytes=25966
evidenceSha256=2878848E31420AE3E63577A2B70520E2AAACC7E63222C9E99F28893A2DE7DF5A
identityBytes=201
identitySha256=1FA784E42B8C970C4FE3E49EF9869CA463EA384834C5E6010ED02C720B4D5E6E
sourceCandidates=4 sealed OPEN non-integration A/B/C/D
dataDirFileCount=38
integrationChangeCreated=false
externalAgentStarted=false
applyAuthorized=false
projectFixtureEqualsStarterAtPrep=true
originalStarterUnchanged=true
activeLeaseDirectories=[]
```

交接文件 `mcp-stage.json`、`apply-resume-template.json`、`candidate-refs.json`、`acceptance-instructions.md`、`evidence.json` 和 `identity.json` 均存在并通过磁盘身份核验。

## 7. 真实外部 Agent Stage 验收

外部 Agent 只使用指定 Surdet Agent Port，在 stage policy 下完成：

```text
comparisonFingerprint=c1335f8c57424d246ab027f44ee8c8978d128520a8c984a8ed95aa43826fbce9
planId=pln_2fa96183597f4a60c6dba289c3c3590e
planFingerprint=2fa96183597f4a60c6dba289c3c3590ecacb06aa0567693af5a371a4105860f2
executeOperationId=ext_agent_wave5_acceptance_exec_op_001
changeId=chg_0002_2e446b47-b382-434e-a70f-2a21bc4a067f
workingRevision=4
integrationStatus=READY
changeStatus=OPEN
projectMutation.occurred=false
```

验证与模拟为 fresh/passed；Alpha/Beta 两条 runtime trace 均通过；四条 replay receipt 保留 A、B、D 来源和等价 provenance，C 未进入 replay/diff。

Delivery capsule：

```text
path=<local-path>
bytes=22311
sha256=5BBAEE9D37FB410CD7763B4D2615DB02C3E1ADBCA74FFF5249A62672F6FE1DEB
```

报告中的成功调用总数写为 14，但枚举项目合计为 15。该差异被保留为报告计数边界；不以此证明或否定功能，磁盘 capsule、change record、fresh evidence 和 project mutation identity 均可独立读取。

## 8. 项目所有者授权的隔离 Apply/Resume

总经理使用独立桌面 runner 恢复 exact integration change，回读 plan identity 与 READY 状态，重新取得 fresh diff/validation/simulation/Alpha/Beta traces，随后调用既有 `change.commit`。全过程只针对 Desktop fixture。

```text
runner=<local-path>
runnerBytes=12543
runnerSha256=17961568C7841F1B0F9A5B2BC6A70306B52BE48C0AC96CAD72C543E3F28CE018
evidence=<local-path>
evidenceBytes=29132
evidenceSha256=86A4B0FE19B5B03E141CE6EA2F6EC7D8E31233F2EF2E7F592C979E787149731F
identityBytes=207
identitySha256=F8E25A9E2A21169E5C1DC2F325B80FDBD13DDDB009B91424152C7A386CC36768
projectRevisionBefore=d63c0e5c32cc9d8d7940a541a2f17d41e1cec7d5c1419e8ab44dce8e9d35ab6f
projectRevisionAfter=9273867ae00b2277644be5c80a76750ec054c47f03e644897956273b46499927
changeStatusAfter=COMMITTED
workingRevision=4
repositoryTouched=false
originalStarterUnchanged=true
errors=[]
childCleanupFailures=[]
activeLeaseDirectories=[]
```

实际变更文件精确为：

1. `content/scenario/wave5_alpha.gal`；
2. `content/scenario/wave5_beta.gal`；
3. `content/timelines/beta_opening.json`；
4. `game.config.json`。

外部 capsule 在 apply 前已明确标记 `game.config.json` 的 `unexpectedFormatChange=true`：新增 `flag.alpha` 的同时发生行尾规范化。这不是隐藏的全净格式结果；它仅发生在可丢弃的桌面 fixture，不修改仓库 Starter。

## 9. Owner 人工验收与验收后磁盘回读

总经理启动当前 Surdet 编辑器于 `http://127.0.0.1:4174/`，没有触碰已被其他项目占用的 4173。项目所有者使用隔离项目完成短验收并原样回复：

> Owner 人工验收通过：Alpha A 可见，C 不存在，Beta timeline 可见，打开、预览、保存正常。

验收后，编辑器服务已停止。磁盘重新回读：

```text
fixtureFiles=40
fixtureExpectedFiles=40
fixtureMismatchCount=0
starterFiles=37
starterExpectedFiles=37
starterMismatchCount=0
AlphaA=true
AlphaC=false
Beta=true
BetaTimeline=true
port4174Listener=none
```

关键文件身份：

| 文件 | bytes | SHA-256 |
|---|---:|---|
| `content/scenario/wave5_alpha.gal` | 59 | `A1B1EEA22100625DE7E2A8294DA4FA4E87A4DCED45E32AE5B310A411EFE057C9` |
| `content/scenario/wave5_beta.gal` | 88 | `74E64A7219BF8C9A2A19B8215FB109BA11124DAAA145CE05A8DD5E3F8C1C57C2` |
| `content/timelines/beta_opening.json` | 303 | `857D65E2FC34C6825910768E037E309FBFD1B76243C97ABD67B0ECA24FFD39BF` |
| `game.config.json` | 1625 | `FAE3B8D312925E1B01C6744178C394CD1A598E298D47C8340164EEA738D123CD` |

## 10. 未解决问题与下一停止点

本轮没有已知 Blocker 或 High 问题。保留以下边界：

- Medium evidence boundary：最终 A/D provenance 修复后没有重跑 `verify:all`，累计预算为 `4/4`；
- external report bookkeeping：工具调用总数文字与枚举相差 1；
- known format boundary：`game.config.json` 行尾规范化已被 capsule 标记并在 apply 前可见；
- product scope：没有候选比较 UI、没有内嵌 AI、没有 Wave 6。

最终文档收口状态：

```text
BRANCH=main
HEAD=aa6b2ca926c218df620c220c7bd8d585f37f82ee
REMOTE_MAIN=31b937638929fa8d09e575b120fd4b4681d9f7d2
HEAD_REMOTE_AHEAD_BEHIND=22/0
PRODUCTION_TEST_RUNNER_DIFF=none
STAGING=empty
DOCUMENT_CLOSURE_COMMIT=THIS_DOCS_ONLY_COMMIT; exact hash supplied by post-commit readback
PUSH=NOT_PERFORMED
DEPLOYMENT=NOT_PERFORMED
RELEASE=NOT_PERFORMED
WAVE_6=NOT_STARTED
NEXT_STOP=WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
```
