# Renderer V4 性能测量资格化最终限定整改报告

**日期**：2026-08-10  
**整改性质**：严格限定的工具卫生与资格聚合整改；不是重新测量、不是性能优化、不是 M9、不是正式发行。  
**整改起点 HEAD**：`34367148e57ad821d838495d496cb7aeeeb3ac3f`  
**代码整改提交**：`a39501b1fe64364110c013a1a377d115146af1bc`  
**本报告创建前 evidence HEAD**：`6e276952ca32fb834b3fc166b1961635ae722b37`（报告自身提交不嵌入自身 SHA）  
**最终状态**：`PERFORMANCE_MEASUREMENT_NOT_QUALIFIED` / `DELIVERY_REMEDIATION_COMPLETED` / `RELEASE_BLOCKED` / `WAITING_FOR_REVIEW`

## 1. 执行边界

本轮严格遵守总经理任务书：

- 不重新采样 Q1–Q5，不修改、重建或覆盖五个既有 Q artifact；
- 不运行旧正式 v3 A/B，不修改任何 1.10/1.15、10%/25% 或角色互换门限；
- 不修改 Renderer/Starter 生产运行时代码、DSL、存档格式、游戏规则、编辑器行为或正式资产；
- 不进行缓存、懒加载、阈值调整或其他无证据性能优化；
- 不 push、force push、发行或开始 M9；
- 不修改、暂存、提交、删除或移动 `USER.md`、`SESSION-HANDOFF.md` 以及两份 art director 保护文档。

本轮只做两类工作：

1. 将已确认导致 tracked hygiene 失败的 20 个 stage6 `.log` 从 Git index 移除，保留本地历史证据；
2. 对已经存在的 Q1–Q5 artifact 增加独立、显式、可复核的聚合 validator 和三态 CLI。

## 2. 整改前事实与日志卫生

在写任何实现前，于 `2026-08-10T20:42:38.2748082+08:00`、HEAD `34367148e57ad821d838495d496cb7aeeeb3ac3f` 运行：

```text
npm run verify:all
exitCode=1
failure=verify:hygiene --tracked
trackedStage6LogCount=20
```

精确命中的 20 个 Git 路径为：

```text
docs/baselines/renderer-v4-stage6-boundaries-2026-08-10.log
docs/baselines/renderer-v4-stage6-boundaries-final-2026-08-10.log
docs/baselines/renderer-v4-stage6-e2e-renderer-v2-2026-08-10.log
docs/baselines/renderer-v4-stage6-e2e-shell-2026-08-10.log
docs/baselines/renderer-v4-stage6-legacy-2026-08-10.log
docs/baselines/renderer-v4-stage6-legacy-corrected-2026-08-10.log
docs/baselines/renderer-v4-stage6-renderer-test-2026-08-10.log
docs/baselines/renderer-v4-stage6-shell-test-2026-08-10.log
docs/baselines/renderer-v4-stage6-shell-test-final-2026-08-10.log
docs/baselines/renderer-v4-stage6-v4-tests-2026-08-10.log
docs/baselines/renderer-v4-stage6-v4-tests-final-2026-08-10.log
docs/baselines/renderer-v4-stage6-verifier-corrected-2026-08-10.log
docs/baselines/renderer-v4-stage6-verifier-wrapper-failure-2026-08-10.log
docs/baselines/renderer-v4-stage6-verify-all-2026-08-10.log
docs/baselines/renderer-v4-stage6-verify-tools-2026-08-10.log
docs/baselines/renderer-v4-stage6-zero-assets-2026-08-10.log
docs/baselines/renderer-v4-stage6-zero-build-2026-08-10.log
docs/baselines/renderer-v4-stage6-zero-lint-2026-08-10.log
docs/baselines/renderer-v4-stage6-zero-simulate-2026-08-10.log
docs/baselines/renderer-v4-stage6-zero-typecheck-2026-08-10.log
```

处理方式是从 `git ls-files 'docs/baselines/renderer-v4-stage6-*.log'` 得到精确路径，逐个 `git rm --cached`。没有使用通配符删除文件，没有修改 `.log` 忽略规则，没有递归清理目录。清理后：tracked 数量为 0，本地日志数量为 20，缺失数量为 0，`npm run verify:hygiene` 通过。

日志索引卫生记录提交：`13970fcfb66d03a865cbac7890b1dea9cf88fa6c`。

## 3. 冻结的聚合协议、Schema 与统计规则

本轮先将以下规则写入持久化计划，再生成任何摘要：

- 聚合协议 ID：`renderer-v4-aggregate-qualification-2026-08-10`；
- 摘要 Schema：`renderer-v4-qualification-summary`，`schemaVersion=1`；
- 固定权威输出：`docs/baselines/renderer-v4-qualification-summary-2026-08-10.json`；
- 输入必须显式、恰好一次提供 `--q1`、`--q2`、`--q3`、`--q4`、`--q5` 和 `--output`；禁止目录扫描、latest 推断和环境变量隐式输入；
- Q 映射固定为 Q1=`q1-007-a-b`、Q2=`q2-007-b-a`、Q3=`q3-f7-a-b`、Q4=`q4-f7-b-a`、Q5=`q5-f7-same-root`；
- 先复用原单 artifact validator，再验证组映射、A/B 角色标签交换、Q5 same-root、commit/build/health、raw/warmup 数量和输入文件 SHA；
- 角色互换使用全部 12 个 `RENDERER_V4_METRIC_NAMES`，固定公式为：

```text
abs(median(sort(forward.v4.paired[metric].pairedLogRatios))
  + median(sort(reverse.v4.paired[metric].pairedLogRatios)))
```

- 门限严格复用 `RENDERER_V4_PRIMARY_LIMITS.roleSwapMedianLogDrift = log(1.10)`；不创建新门限，不把 `pairedMedianRatio` 变成主门；
- 聚合只允许 `candidate-qualified` 或 `not-qualified`；五组都合格、两组角色互换全通过、build/health/结构全部通过时才可输出前者；
- CLI 退出码固定为：合法且合格 `0`，合法但不合格 `2`，参数/路径/JSON/Schema/结构/程序错误 `1`；
- 输出固定写入 `resampled=false`，不包含任何新采样数据。

计划附录提交与日志卫生一起保存；原 v4 协议的 Schema v4、样本数、warmup、统计门限和 Q 数据冻结事实没有被改写。

## 4. 测试先行与实现

### 4.1 先红后绿

首先创建 `packages/shell/test/renderer-v4-qualification-summary.test.mjs`，立即运行：

```text
npm test -w @surdet/shell -- renderer-v4-qualification-summary.test.mjs
```

结果为失败：聚合生产模块尚不存在，测试在模块加载阶段报 `Cannot find module '../e2e/renderer-v4-qualification-summary.mjs'`。该红灯先于生产实现被保留。

### 4.2 实现范围

实际新增/修改：

- `packages/shell/e2e/renderer-v4-qualification-summary.mjs`
  - 显式参数解析；
  - 原 artifact validator 复用；
  - A/B 标签交换和 Q5 same-root 验证；
  - 输入 SHA-256 与规范化路径记录；
  - 全 12 指标角色互换统计；
  - summary Schema 验证、源 artifact 重算验证和 `resampled=false`；
  - output 路径边界校验及三态 CLI。
- `packages/shell/e2e/renderer-baseline-v4-verify.mjs`
  - 合法 `candidate-qualified` 返回 0；
  - 合法 `not-qualified` 返回 2；
  - 解析/路径/内容/程序错误返回 1。
- `packages/shell/test/renderer-v4-qualification-summary.test.mjs`
  - 11 项聚合/CLI 回归测试。
- `scripts/test/renderer-v4-qualification.test.mjs`
  - 将聚合工具和固定摘要纳入根级工具卫生/协议静态验证。

代码实现提交：`a39501b1fe64364110c013a1a377d115146af1bc`。

测试覆盖了：缺失/未知/重复参数、缺少输入、无效 artifact、组错位、Q5 非同根、output 越界、角色漂移恰好/低于/高于门限、候选 fixture exit 0、真实 Q exit 2、单 artifact 三态退出、输入 SHA 匹配和 Q artifact 不变。

## 5. 既有 Q artifact 的只读聚合结果

五个 Q 文件没有被写入、重排、重建或替换。五个单 artifact verifier 的结果均为：`valid=true`、`status=not-qualified`、退出码 `2`。

| Q | artifact SHA-256 | 状态 |
| --- | --- | --- |
| Q1 `renderer-v4-q1-007-a-b-2026-08-10.json` | `6A92E21F11D45F534D0CA50800E3B6F689CC2870A9EA216E045CA9E0C97C9B44` | `valid=true / not-qualified` |
| Q2 `renderer-v4-q2-007-b-a-2026-08-10.json` | `F64CC356AD7C5AD5A2C916AA4B23A8C4A9DC68E16918AB8EE26E90F26AE524C1` | `valid=true / not-qualified` |
| Q3 `renderer-v4-q3-f7-a-b-2026-08-10.json` | `20E7C58890AE4FD22FC16419B34F4332B4F3F0A7CF69C1824DB6DAAC34577B2A` | `valid=true / not-qualified` |
| Q4 `renderer-v4-q4-f7-b-a-2026-08-10.json` | `4AD04969D67378EE5CBAB3DF9F6D7E2F744D3558435785AA619324D897FEDA2D` | `valid=true / not-qualified` |
| Q5 `renderer-v4-q5-f7-same-root-2026-08-10.json` | `EEEC84A622F89D837A68EF42ACB0F7792193F57FB7AA294031D07F103A9A3A71` | `valid=true / not-qualified` |

聚合摘要机器验证结果：

```text
summary=docs/baselines/renderer-v4-qualification-summary-2026-08-10.json
summarySha256=31554a17096f2544aff373a715583cf9e343230c9dcc41b6a4ee38a961b79fe6
generatedAt=2026-08-10T12:57:53.388Z
schemaVersion=1
resampled=false
rawLaunches=200
warmups=10
q1q2RoleSwap=passed
q3q4RoleSwap=failed
aggregateStatus=not-qualified
aggregateExit=2
```

摘要失败原因原样保留：五组 artifact 自身均为 `not-qualified`；Q3/Q4 的 `menuOpenP95Ms`、`sceneP95Ms`、`hostFirstWindowToDebugMs`、`hostDebugToAssetDoneMs`、`pageAssetLoadMs` 角色互换漂移超过 `log(1.10)`。没有通过挑选轮次、删除异常值或 paired median 覆盖这些失败。

Stage 5 / holdout 提交事实保持分离：Stage 4 最终执行器提交为 `b8f53e5c18a98815ed42239220cfa289aec6ee00`，Stage 5 五组 holdout 记录提交为 `6d6df999f4d9fe940306869193fe6c479e306087`。本轮只读取后者产生的五个固定 JSON。

## 6. 最终门禁

在本报告创建前的 evidence HEAD `6e276952ca32fb834b3fc166b1961635ae722b37` 上：

| 门禁 | 结果 |
| --- | --- |
| V4/聚合聚焦测试 | 5 files / 58 passed |
| Shell 全量 | 13 files / 109 passed |
| Renderer 全量 | 46 files / 325 passed |
| `npm run verify:tools` | 10/10 passed |
| `npm run verify:renderer-boundaries` | 3/3 + scanner passed |
| `npm run verify:renderer-legacy` | 4/4 + scanner passed |
| `npm run verify:hygiene` | 通过；最终 tracked paths=569 |
| `npm run verify:all` | 退出码 0 |
| 《零点之后》 | lint 0 error/0 warning；simulate 23/23、3 结局、运行时错误 0；44 assets；typecheck/build 通过 |
| 五个显式 artifact verifier | 5/5 `valid=true/not-qualified`，退出码 `2` |
| `git diff --check` | 通过 |

没有运行重新采样、旧正式 v3 A/B、发行打包、push 或 force push。

## 7. Git、保护文件与收尾

从整改起点到 evidence HEAD 的真实提交差异为 27 个文件、`1329 insertions / 1954 deletions`。删除统计来自 20 个 tracked stage6 日志索引项；这些日志本地副本保留。主工作树在最终检查时只剩四个受保护未跟踪文件：

```text
?? SESSION-HANDOFF.md
?? USER.md
?? docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
?? docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
```

报告、聚合摘要和持久化计划路径：

- [原资格化交付报告](E:/surdet/docs/ENGINE-RENDERER-PERFORMANCE-MEASUREMENT-QUALIFICATION-REPORT-2026-08-10.md)
- [本最终整改报告](E:/surdet/docs/ENGINE-RENDERER-PERFORMANCE-MEASUREMENT-QUALIFICATION-FINAL-REMEDIATION-REPORT-2026-08-10.md)
- [持久化执行计划](E:/surdet/docs/superpowers/plans/2026-08-10-renderer-performance-measurement-qualification.md)
- [聚合摘要](E:/surdet/docs/baselines/renderer-v4-qualification-summary-2026-08-10.json)

本报告自身 commit SHA 不写入自身内容，避免自引用；最终交付回报将列出真实最终 HEAD、ahead/behind、报告/计划/摘要 SHA-256 和最后一次 `verify:all` / `git diff --check`。

## 8. 停止状态

```text
PERFORMANCE_MEASUREMENT_NOT_QUALIFIED
DELIVERY_REMEDIATION_COMPLETED
RELEASE_BLOCKED
WAITING_FOR_REVIEW
push=false
forcePush=false
release=false
m9Started=false
resampled=false
```
