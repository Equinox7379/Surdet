PRE_WAVE_4_RELIABILITY_R4_R6_BATCH_VERIFIED — R4_CONFIG_FAIL_LOUD_PASSED; R5_GENERIC_START_REENTRANCY_PASSED; R6_SCHEDULED_WHEN_LINT_PASSED; VERIFY_ALL_PASSED; WAITING_FOR_INDEPENDENT_FINAL_REVIEW; NOT_PUSHED; WAVE_4_PAUSED

# Pre-Wave 4 Reliability R4–R6 Batch Delivery Report

执行日期：2026-08-21
执行依据：`E:\surdet\docs\superpowers\plans\2026-08-21-pre-wave-4-reliability-r4-r6-closure-batch.md`
执行方式：Task 0 → Task 6 串行；R4、R5、R6 普通 lane 之间未等待额外经理复审。
当前结论：本地证据批次完成，提交后停止等待独立终审；不宣布 R4–R6 sweep CLOSED。

本文使用以下证据分类：

- **VERIFIED FACT**：本轮命令、磁盘读回、测试 artifact 或 Git 对象直接证明。
- **REASONABLE INFERENCE**：由已验证输出推导，但不是额外测试覆盖。
- **NOT VERIFIED / OUT OF SCOPE**：本轮明确没有验证，不能从本报告推导通过。

## 1. 授权范围与明确排除

### VERIFIED FACT

本轮只处理三个 reliability lane：

1. R4：共享 `game.config.json` 文档解析器；拒绝语法有效但顶层不是 object 的配置，并保持空配置行为。
2. R5：generic instruction callback 内调用 `start()` 时，保留目标 instruction zero，不吞掉目标第一条指令。
3. R6：`events[].when` 与 `scheduled[].when` 复用同一表达式提取和未声明变量 lint 规则。

允许的生产/测试落点严格限定于任务书列出的 Authoring、Editor、Core、CLI 文件；当前 R4–R6 任务书作为 R4 code commit 的附带任务书文件纳入提交。

本轮没有：

- 进入 Wave 4、R1–R3 修复或新的 A6 工作；
- 修改 Renderer、Host、Shell、Starter、Zero、content、assets、save schema、Electron 代码；
- 修改 package manifest、lockfile、依赖、构建配置、release metadata、长期路线台账、受保护文件或 handoff 文件；
- 增加 compatibility fallback、R5 `@clear` 特判、第二套配置 parser、第二次 CLI lint pass 或 Runtime 测试专用分支；
- 运行 Electron、FORMAL/DIAGNOSTIC 独立命令、性能、pack、部署、发行或 push。

`verify:all` 内部任务书允许的 Starter/Zero 节点曾执行；这不等同于独立 Starter simulate，也不改变上述范围。

## 2. Task 0 实时 Git 基线

### VERIFIED FACT

```ini
BRANCH = main
INITIAL_HEAD = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
INITIAL_PARENT = d079f3fcf4eded33836123c4caf3308285430526
REMOTE_MAIN = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
AHEAD_BEHIND_AT_START = 0/0
TRACKED_WORKTREE_AT_START = CLEAN
STAGING_AREA_AT_START = EMPTY
TRACKED_LOG_FILES_AT_START = NONE
```

Task 0 重新读取了 AGENTS、Fresh Gate、R1、R2、R3 任务书与交付报告，并确认 Fresh Gate 五个历史 artifact 仍存在且身份匹配。历史 artifact 只读，未被本批次覆盖。

Task 0 建立的临时证据根目录为：

```text
C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060
```

## 3. R4：配置文档 fail-loud

### 3.1 RED

### VERIFIED FACT

在生产实现之前，分别对 Authoring 与 Editor 执行一次目标测试，均为业务红灯而不是 harness 失败：

```text
npm run test -w @surdet/authoring -- project-snapshot.test.ts -t "rejects a syntactically valid non-object game.config.json" --reporter=json --outputFile="...\r4-authoring-red.json"
exit = 1
failure = promise resolved with snapshot instead of rejecting
artifact = 3 total; 0 passed; 1 failed; 2 skipped

npm run test -w surdet-editor -- config-edit.test.ts -t "applyVariablesToConfig rejects a non-object top-level config" --reporter=json --outputFile="...\r4-editor-red.json"
exit = 1
failure = expected throw did not occur for []
artifact = 30 total; 0 passed; 1 failed; 29 skipped
```

两份 RED artifact 均在生产改动前写入唯一临时根目录，并在本轮保持不变；没有 RED rerun。

### 3.2 最小实现与 GREEN

### VERIFIED FACT

R4 新增 `packages/authoring/src/config-document.ts`，统一负责 BOM stripping、JSON parse、顶层 record 检查和 `PROJECT_INVALID` 错误。它从 Authoring index 导出，并由以下调用方共享：

- `packages/authoring/src/project-snapshot.ts`；
- `packages/authoring/src/config-operations.ts`；
- `packages/editor/src/config-edit.ts`。

私有重复 `parseConfig` 已移除。缺失或空白 `game.config.json` 的 `{}` 行为保持不变；本轮没有扩展嵌套变量 schema 验证。

目标 GREEN 一次通过：

```text
Authoring targeted = exit 0; 3 total; 1 passed; 0 failed; 2 skipped
Editor targeted = exit 0; 30 total; 1 passed; 0 failed; 29 skipped
```

R4 所需相邻门也一次通过：Authoring full `20 files / 124 tests`，Authoring typecheck `exit 0`，Authoring build `exit 0`；Editor full `26 files / 173 tests`，Editor typecheck `exit 0`，Editor build `exit 0`。

### 3.3 R4 code commit

### VERIFIED FACT

```ini
R4_CODE_EVIDENCE_HEAD = 325fd0688a638fe52f59edfd9f798f5420dca347
R4_CODE_EVIDENCE_PARENT = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
R4_CODE_EVIDENCE_MESSAGE = fix(authoring): reject non-object project config
R4_CODE_SCOPE = EXACT_R4_WHITELIST_PLUS_TASKBOOK
```

该 commit 的 name-status 为：

```text
A docs/superpowers/plans/2026-08-21-pre-wave-4-reliability-r4-r6-closure-batch.md
A packages/authoring/src/config-document.ts
M packages/authoring/src/config-operations.ts
M packages/authoring/src/index.ts
M packages/authoring/src/project-snapshot.ts
M packages/authoring/test/project-snapshot.test.ts
M packages/editor/src/config-edit.ts
M packages/editor/test/config-edit.test.ts
```

## 4. R5：generic `start()` 重入控制流

### 4.1 RED

### VERIFIED FACT

在 Core 生产实现修改前，目标测试一次红灯：

```text
npm run test -w @surdet/core -- interpreter.test.ts -t "generic instruction callback start\(\) preserves target instruction zero" --reporter=json --outputFile="...\r5-core-red.json"
exit = 1
failure = actual first text 第二条; expected 第一条
artifact = 45 total; 0 passed; 1 failed; 44 skipped
```

该失败证明旧控制流在 generic callback 调用 `start()` 后跳过了目标 instruction zero。

### 4.2 最小实现与 GREEN

### VERIFIED FACT

只修改 `packages/core/src/runtime/interpreter.ts` 的 generic `case 'instr'`：

- callback 前清理 `resumeRequested`；
- 保留 host jump override 优先级并清理 override；
- callback 要求 resume 时直接继续目标 instruction zero；
- 普通路径才递增 `pc`；
- 没有增加 `@clear` 特判，也没有递归调用 `step()`。

GREEN 一次通过：

```text
exit = 0
artifact = 45 total; 1 passed; 0 failed; 44 skipped
```

Core full `24 files / 319 tests`、Core typecheck `exit 0`、Core build `exit 0` 均一次通过。

### 4.3 R5 code commit

### VERIFIED FACT

```ini
R5_CODE_EVIDENCE_HEAD = 67b7d915f1fd97c03fdca18ad5eb356b096771ef
R5_CODE_EVIDENCE_PARENT = 325fd0688a638fe52f59edfd9f798f5420dca347
R5_CODE_EVIDENCE_MESSAGE = fix(core): preserve generic start reentrancy
R5_CODE_SCOPE = EXACTLY_TWO_CORE_FILES
```

```text
M packages/core/src/runtime/interpreter.ts
M packages/core/test/interpreter.test.ts
```

## 5. R6：scheduled `when` lint

### 5.1 Runtime oracle 与 CLI RED

### VERIFIED FACT

先运行 Runtime oracle，确认未声明表达式在 Runtime 仍保持严格策略：

```text
r6-runtime-oracle.json = exit 0; 6 total; 1 passed; 0 failed; 5 skipped
```

随后在 CLI 生产实现之前，对 `scheduled[].when` 目标测试一次红灯：

```text
npm run test -w @surdet/cli -- lint.test.ts -t "events.json scheduled\[\]\.when uses the same undeclared-variable lint as events\[\]\.when" --reporter=json --outputFile="...\r6-cli-red.json"
exit = 1
failure = undeclared ghost expression produced 0 V002 issues
artifact = 68 total; 0 passed; 1 failed; 67 skipped
```

### 5.2 最小实现与 GREEN

### VERIFIED FACT

只修改 `packages/cli/src/lint.ts`：新增本地 `extractWhenExpressions(value)`，让 `events` registry 同时提取 `events` 与 `scheduled` 的 `when`，再复用现有 undeclared-variable lint。没有新增第二个 lint pass，也没有修改 Runtime。

首次 GREEN 文件被保留但不作为成功证据：

```text
r6-cli-green.json = exit 0; 68 total; 0 passed; 0 failed; 68 skipped
classification = HARNESS_INVALID
reason = filter contained an extra space; intended test did not run
```

依任务书允许的单次 harness correction，使用新文件名重新执行目标测试：

```text
r6-cli-green-harness-correction-1.json = exit 0; 68 total; 1 passed; 0 failed; 67 skipped
```

R6 CLI full `15 files / 138 tests`、CLI typecheck `exit 0`、CLI build `exit 0` 均一次通过。

### 5.3 R6 code commit

### VERIFIED FACT

```ini
R6_CODE_EVIDENCE_HEAD = ee4b198fa8d2922bff0b4fc5c732b678ef247474
R6_CODE_EVIDENCE_PARENT = 67b7d915f1fd97c03fdca18ad5eb356b096771ef
R6_CODE_EVIDENCE_MESSAGE = fix(cli): lint scheduled event conditions
R6_CODE_SCOPE = EXACTLY_TWO_CLI_FILES
```

```text
M packages/cli/src/lint.ts
M packages/cli/test/lint.test.ts
```

## 6. 聚焦、全量、类型检查与构建汇总

### VERIFIED FACT

| lane | focused/oracle | full suite | typecheck | build |
|---|---|---|---|---|
| R4 Authoring | PASS; 3 tests, 1 passed | PASS; 20 files / 124 tests | PASS; exit 0 | PASS; exit 0 |
| R4 Editor | PASS; 30 tests, 1 passed | PASS; 26 files / 173 tests | PASS; exit 0 | PASS; exit 0 |
| R5 Core | PASS; 45 tests, 1 passed | PASS; 24 files / 319 tests | PASS; exit 0 | PASS; exit 0 |
| R6 Runtime oracle | PASS; 6 tests, 1 passed | — | — | — |
| R6 CLI | PASS; 68 tests, 1 passed；RED 1 次 | PASS; 15 files / 138 tests | PASS; exit 0 | PASS; exit 0 |

所有上述 artifact、命令输出和退出结果均在 Task 1–4 时写入临时根目录，并在 Task 5.3 再次读取身份。没有覆盖既有 RED 或首次无效 GREEN 文件。

## 7. 单次 `verify:all` 聚合门

### VERIFIED FACT

实际执行一次：

```text
npm run verify:all 2>&1 | Tee-Object -FilePath C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r46-verify-all.txt
```

结果为 `exit 0`；脚本顺序到达最后的 `verify:diff-check`，无失败 node。日志中的验证节点结果如下：

| node | result |
|---|---|
| verify:tools | PASS; 10/10 |
| verify:renderer-boundaries | PASS; 3/3 |
| verify:renderer-legacy | PASS; 4/4 |
| verify:docs | PASS |
| verify:hygiene | PASS; 739 tracked paths |
| verify:types | PASS |
| workspace tests | PASS; Authoring 20/124, CLI 15/138, Core 24/319, Editor 26/173, Host 11/87, Renderer 49/406, Shell 22/195, Starter 4/7, Zero 4/29 |
| verify:starter-lint | PASS |
| verify:starter-simulate | PASS; aggregate-internal node |
| verify:formal | PASS; aggregate-internal node |
| verify:editor-build | PASS |
| verify:starter-build | PASS |
| verify:formal-build | PASS |
| verify:diff-check | PASS; line-ending warning only |

`verify:all` 日志中的 Zero 内容检查有 128 个既有 speaker warnings，Editor/Starter 构建有 chunk-size warnings；均未造成失败。`verify:all` 内部的 Starter/Zero 模拟和 formal/build 是任务书要求的单次 aggregate gate，不是本轮额外启动的 Wave 4、Electron 或发行流程。

### REASONABLE INFERENCE

由于 `scripts/verify-all.mjs` 在所有 sequential node 返回零后才完成，且日志完成于 `verify:diff-check`、没有非零 node，聚合门的 exit 0 与日志行为一致。没有另行重跑确认。

## 8. 精确 code commit 链与文件范围

### VERIFIED FACT

```text
27aca62d2c1759b3a9e1bde4b81a042e4b0861f5  (initial / remote main)
  └─ 325fd0688a638fe52f59edfd9f798f5420dca347  R4 code
       └─ 67b7d915f1fd97c03fdca18ad5eb356b096771ef  R5 code
            └─ ee4b198fa8d2922bff0b4fc5c732b678ef247474  R6 code
```

三笔 lane commit 的精确 scope 已在第 3、4、5 节列出；R4 commit 另含任务书，R5/R6 commit 均只含各自两份生产/测试文件。没有 amend、rebase、squash、reset 或历史改写。

本报告建立时的文档 closure commit 尚未产生；依据 identity protocol，本文不预填该 commit hash，也不写入自身 bytes/SHA。实际 closure HEAD 只在最终 handoff 的 post-commit readback 中报告。

## 9. Artifact 身份表

### VERIFIED FACT

以下绝对路径、bytes 和 SHA-256 均在 Task 5.3 从磁盘读取；manifest 本身随后也从磁盘读取。`r6-cli-green.json` 的身份保留为 harness-invalid，不被当作 GREEN。

| absolute artifact path | bytes | SHA-256 | status | evidence class |
|---|---:|---|---|---|
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-authoring-build.txt` | 67 | `D55466B76CB83A94BA909BD75B379DA45DBA67DF34F3B422EBB1C7C1B7591CD9` | PASS | build gate |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-authoring-full.txt` | 1289 | `2E79E49045692708829F65BF5579181CE322A82AF9500D82ABC969BFDBA8F2D0` | PASS | full suite |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-authoring-green.json` | 1421 | `DDAE33E380DAEDFA3DC0D498713D27BDFA5D8C453ECAA1D9BBE0817687F6D9DF` | PASS | GREEN |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-authoring-red.json` | 2291 | `2677469C6327E03BFEFA4C5CDC580F09436714C7A57059774E738489DDB4EA6E` | VALID RED | RED |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-authoring-typecheck.txt` | 74 | `9865692A8DB8F158B7672D8DCD9C5085FB930EAF5DF9D3082718C79EC5320F78` | PASS | typecheck |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-editor-build.txt` | 1998 | `91446F3ABB67D5C7B055EE14776C72E3B63E4FF0DFD8E8A82A0F43E39F07E005` | PASS | build gate |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-editor-full.txt` | 1549 | `4FDD379C1F5F0E9B8C5B417A677EF6C26E4BAAECD8AD6AE5EA647AC27DE8AA4F` | PASS | full suite |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-editor-green.json` | 9625 | `5363C3AC7CCDD1EB1456E3BE80F16E05D7AB2362E2E705FE3C156C3788D0C9F0` | PASS | GREEN |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-editor-red.json` | 10492 | `58EA6B0E7B9442CDEB71201084CFF9885C517921A72DF133D09A96F5E8A08389` | VALID RED | RED |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r4-editor-typecheck.txt` | 70 | `6C063F98A510A39EA4D645FDB790D9576ACDBEEA0A0B16E9335C0C373A538AD3` | PASS | typecheck |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r46-verify-all.txt` | 56494 | `EBAEF310BE95ED8B24ADA507B83E04A38E5B74F53F5398834BBF36886EA3EB1F` | PASS | aggregate gate |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r5-core-build.txt` | 62 | `0943F1AA4B29D9DA4EADBA76586FAC5B15FF29332FEBCDB4A810A8AF64AEED8D` | PASS | build gate |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r5-core-full.txt` | 3125 | `19DB72B9F16CE00FEFDD725F858A093F3F8F8F1A0B643D3B94D2E251BAA9FD10` | PASS | full suite |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r5-core-green.json` | 11414 | `7FDDE9B2B4B27022CF328C885E7EF52DBCE21EDCD1AB1661BE4E669FFF867C3F` | PASS | GREEN |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r5-core-red.json` | 12286 | `E72DDC901750BCB66228DC7E7B13C651F00902FE91B5726F4DBACF77B5EDA1BB` | VALID RED | RED |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r5-core-typecheck.txt` | 69 | `A18A84F9CE7D19E0E4C7B6261986CBBED38BC76378B22D4492897B461F0FA2DA` | PASS | typecheck |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r6-cli-build.txt` | 61 | `898D2AD82D33C86E701D8865F20A428CA48DB35240DD429FD8E62F480C2EA93E` | PASS | build gate |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r6-cli-full.txt` | 5121 | `E72BA3CCD7993E94F4A594D52DFDA0DF3A334C04C350E69DD2ECB6EB2B8919B9` | PASS | full suite |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r6-cli-green-harness-correction-1.json` | 17815 | `73BA96A446E99F0418998BDD53F59D51E090861493034489D6C1768974E55F38` | PASS | corrected GREEN |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r6-cli-green.json` | 17782 | `11BA3295078E5896274A52834CD2C2C72B39CFC71FB937F847ACF9D63CE79374` | HARNESS_INVALID | preserved invalid GREEN |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r6-cli-red.json` | 18683 | `849CD79050838EFDEFDA98E926B98B4EFC03E662E969724E6F2AD1DB8B74181D` | VALID RED | RED |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r6-cli-typecheck.txt` | 68 | `AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917` | PASS | typecheck |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r6-runtime-oracle.json` | 2807 | `DC06D24962985B26D24E374424B46A3585DAD93C26E164B97AC2128C9C53844C` | PASS | Runtime oracle |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-reliability-r4-r6-cfffc2ec527d4bbfa2e532111ddbf060\r46-artifact-manifest.txt` | 4271 | `E67DDD2556F4B17F406504E297F57B19C32F847F8BD4FB93FB1C3EBF22432DFC` | PASS | identity manifest for 23 artifacts |

Fresh Gate historical artifact readback, unchanged and not overwritten:

| absolute artifact path | bytes | SHA-256 | status |
|---|---:|---|---|
| `C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\a7-authoring-vitest.json` | 1811 | `6C7ACA4D7FD3ADCBA96B3F71C6D56002219A96F44939B960E3CA0748A2DE5974` | HISTORICAL read-only |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\a7-editor-vitest.json` | 1848 | `40A661374E12B59D660E99700E5A91DD958E829BBED7785EE3D1136CB98BFDB8` | HISTORICAL read-only |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\m1-generic-start-vitest.json` | 1900 | `B8CAEE1652AEC096969B7FCB24BF1B9A9CFB22E3E175C4AA7353C03E94B9BDF0` | HISTORICAL read-only |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\n4-runtime-oracle.json` | 2806 | `D117922A0625586DC51AB10F64A0B32CE886BD920D1CA3AC52A6A2D4CCD51B72` | HISTORICAL read-only |
| `C:\Users\Equinox\AppData\Local\Temp\surdet-pre-wave4-reliability-b8f61e117dcd4782974b19f5825230dd\n4-cli-lint.json` | 1865 | `39BACDA17AFF30AB1E5710D6CA4AD3AFC24FA2BD112B6A04AD56F314600793` | HISTORICAL read-only |

## 10. 未改动范围与禁止范围证明

### VERIFIED FACT

以初始 HEAD `27aca62d2c1759b3a9e1bde4b81a042e4b0861f5` 对 R6 code HEAD `ee4b198fa8d2922bff0b4fc5c732b678ef247474` 做 name-only 读回，结果仅为：

```text
docs/superpowers/plans/2026-08-21-pre-wave-4-reliability-r4-r6-closure-batch.md
packages/authoring/src/config-document.ts
packages/authoring/src/config-operations.ts
packages/authoring/src/index.ts
packages/authoring/src/project-snapshot.ts
packages/authoring/test/project-snapshot.test.ts
packages/cli/src/lint.ts
packages/cli/test/lint.test.ts
packages/core/src/runtime/interpreter.ts
packages/core/test/interpreter.test.ts
packages/editor/src/config-edit.ts
packages/editor/test/config-edit.test.ts
```

R4、R5、R6 三个 code commit 的 scope 与任务书 whitelist 一致。`git diff --check` 与 `git diff --cached --check` 均通过；tracked log 文件为 none。临时 artifact 均留在上述临时证据根目录，没有进入 Git。

没有发现 package manifest、lockfile、依赖、构建配置、release metadata、长期路线台账、Fresh Gate 原始证据、R1/R2/R3 文件、受保护文件或 Wave 4 文件被本批次修改。

## 11. 已知边界与不主张事项

### NOT VERIFIED / OUT OF SCOPE

- 本轮没有把所有非法嵌套配置形状扩展为完整 schema 校验；R4 只证明顶层非 object 的统一 fail-loud 契约。
- 本轮没有证明所有 interpreter callback reentrancy 形式；R5 只证明 generic instruction callback 调用 `start()` 时目标 instruction zero 不被跳过，并保持 host jump precedence。
- CLI lint 不执行 Runtime，也不保证所有 Runtime 条件语义；R6 只证明 scheduled `when` 复用未声明变量 lint。
- 没有做 Electron、真实玩家体验、发行、性能资格、部署、pack、Wave 4 acceptance 或远端 push 验收。
- 没有单独运行 Starter simulate；聚合命令中的内部节点不扩大本轮授权范围。

### REASONABLE INFERENCE

R4、R5、R6 的永久回归测试和相邻 workspace 门均已通过，说明本轮目标 finding 在当前代码链上具备直接测试证据；这不替代独立终审，也不构成整体 reliability sweep 或 Wave 4 放行。

## 12. Git 状态、push 与停止点

### VERIFIED FACT

报告创建时、docs closure commit 之前：

```ini
REPORT_CREATION_HEAD = ee4b198fa8d2922bff0b4fc5c732b678ef247474
REPORT_CREATION_PARENT = 67b7d915f1fd97c03fdca18ad5eb356b096771ef
REMOTE_MAIN = 27aca62d2c1759b3a9e1bde4b81a042e4b0861f5
AHEAD_BEHIND_BEFORE_DOCS_CLOSURE = 3/0
TRACKED_WORKTREE_BEFORE_DOCS_CLOSURE = TASKBOOK_ONLY_MODIFIED
STAGING_AREA_BEFORE_DOCS_CLOSURE = EMPTY
PUSH = NOT_PERFORMED
ARCHITECT_REVIEW = NOT_SEPARATELY_PERFORMED
ARCHITECT_PASS = NOT_CLAIMED
R4_R6_CLOSED = NO
WAVE_4 = PAUSED
NEXT_STOP = WAITING_FOR_INDEPENDENT_FINAL_REVIEW
```

以下未跟踪内容是 Task 0 已存在、且按范围纪律保留的治理/个人工作文件，不是本批次垃圾：

```text
.dsh/
.learnings/
AGENTS.md
SESSION-HANDOFF.md
USER.md
docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md
docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md
docs/handoff-20260813-165825.md
docs/handoff-20260813-170533-general-manager.md
docs/handoff-20260814-032328-temporary-execution-ai.md
docs/handoff-20260814-032328-temporary-general-manager.md
docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md
```

本报告不包含自身 bytes/SHA，也不包含尚未创建的 docs closure commit identity。最终 handoff 必须在 docs-only commit 后重新读取真实 HEAD、parent、remote、ahead/behind、tracked worktree 和 staging area。

## 13. 建议由总经理登记的事实

### VERIFIED FACT

```ini
R4_CONFIG_FAIL_LOUD = PASS
R5_GENERIC_START_REENTRANCY = PASS
R6_SCHEDULED_WHEN_LINT = PASS
R46_AGGREGATE_VERIFY_ALL = PASS
R4_CODE_EVIDENCE_HEAD = 325fd0688a638fe52f59edfd9f798f5420dca347
R5_CODE_EVIDENCE_HEAD = 67b7d915f1fd97c03fdca18ad5eb356b096771ef
R6_CODE_EVIDENCE_HEAD = ee4b198fa8d2922bff0b4fc5c732b678ef247474
R4_R6_CODE_CHAIN_PUSHED = NO
R4_R6_SWEEP_CLOSED = NO
ARCHITECT_PASS = NOT_CLAIMED
WAVE_4 = PAUSED
NEXT_STOP = WAITING_FOR_INDEPENDENT_FINAL_REVIEW
```

建议独立终审重点复核：三笔 code commit 的边界、R6 harness-invalid artifact 的分类、聚合日志末节点、临时 artifact manifest，以及 docs closure commit 后的最终 Git 身份。除上述文档交付外，本轮没有待执行的生产修复或额外 reliability lane。
