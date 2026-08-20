RELIABILITY_R3_WINDOWS_NON_TEARING_REPLACEMENT_VERIFIED — LOCKED_TARGET_RED_REPRODUCED; RENAME_ONLY_GREEN_PASSED; WINDOWS_REAL_PATH_PASSED; WAITING_FOR_INDEPENDENT_FINAL_REVIEW; NOT_PUSHED; WAVE_4_PAUSED

# Reliability R3：Windows Non-Tearing Rename Replacement

## 交付结论

本轮只处理 `N7-WINDOWS-REPLACEMENT`：删除 `NodeProjectStorage` 在 Windows rename 失败后对现有 target 执行的 `copyFile` 覆盖兜底，改为同目录 rename-only、固定预算的 Windows 暂时性错误 retry，以及失败时保留旧 target/staged 并 fail-loud。

真实 `win32` locked-target RED 已取得一次；rename-only helper 合同测试、真实 Windows GREEN、R3 两文件聚焦、CLI 全套、CLI typecheck/build 和唯一一次 `verify:all` 均通过。本轮没有 push，没有进入 R4～R6 或 Wave 4。

## Git 与范围基线

```text
R3_INITIAL_HEAD = 0c8358acfd7131709c97fd53014f2ffe30a78065
R3_INITIAL_PARENT = 7300659ed25c52818b4a0dd47e977a8028d892ea
REMOTE_MAIN_AT_START = 0c8358acfd7131709c97fd53014f2ffe30a78065
AHEAD_BEHIND_AT_START = 0/0
BRANCH = main
PLATFORM = win32
NODE = v24.15.0
ARCH = x64
R3_ROOT = <local-path>
```

本轮白名单修改为：

```text
packages/cli/src/authoring/node-file-replacement.ts       (new)
packages/cli/src/authoring/node-project-storage.ts        (modified)
packages/cli/test/node-file-replacement.test.ts           (new)
packages/cli/test/node-project-storage.test.ts            (modified)
docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md
docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md
```

没有修改 `@surdet/authoring` 的 `ProjectWriteStorage`、`commitChange()`、journal、ChangeRecord、CLI 公共 JSON envelope、Core、Renderer、Host、Shell、Editor、Starter、Zero、长期路线台账或受保护文件。`packages/authoring/src/change-session.ts` 在 Task 0 读取后没有 R3 工作树 diff。

Task 5 生成报告时尚未创建代码证据提交；Task 6 Step 3 会从磁盘读取该真实 HEAD，并在 docs-only closure 中补入代码提交身份。报告正文在文档闭合后只允许追加真实身份，不改变本轮技术结论。

## 旧实现与永久 RED

Task 0 读取确认旧实现为：

```text
fs.rename(staged, target)
  -> EEXIST / EPERM
  -> fs.copyFile(staged, target)
  -> fs.rm(staged)
```

Node 官方文档明确说明 `copyFile` 默认覆盖已存在的目标，并且不保证 copy 操作的原子性；因此该 fallback 不能作为现有 target 的 replacement contract。[Node `fsPromises.copyFile()` documentation](https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode)

Task 1 使用真实 Windows 文件句柄锁定 target，执行一次正式 RED：

```text
RED_COMMAND = npm run test -w @surdet/cli -- node-project-storage.test.ts -t "keeps complete old and staged bytes when a locked target blocks replacement" --reporter=json --outputFile=<local-path>
RED_EXIT = 1
RED_RUN_COUNT = 1
RED_FIRST_BUSINESS_FAILURE = promise resolved "undefined" instead of rejecting
RED_EXPECTED = reject with EPERM; target OLD; staged NEW
RED_ACTUAL = replaceFromStage resolved through the current fallback path
R3_RED = LOCKED_TARGET_COPY_FALLBACK_REPRODUCED
```

这是业务 RED，不是 import、fixture、语法、timeout 或 reporter 失败；同一真实锁路径在当前源码下命中了 rename 失败后的 copy fallback。失败证据未重跑、未覆盖、未删除。

## 最小实现

新增 `node-file-replacement.ts`，唯一职责是执行已经过 NodeProjectStorage 路径校验的同目录 staged/target rename：

```text
normal path: one rename, no delay
win32 + EACCES|EBUSY|EPERM: retry the same rename
retry delays: [10, 20, 40, 80, 160, 320, 640] ms
budget exhausted: throw original error
non-win32 or EIO|ENOENT|EEXIST: throw without retry
```

helper 没有 copy、delete、backup、项目读取、SHA、journal 或 target write 能力。Node 官方 `fsPromises.rename(oldPath, newPath)` API 只规定 rename 操作及其 Promise 完成边界；本轮没有把它扩大解释为断电持久化或跨进程线性化保证。[Node `fsPromises.rename()` documentation](https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath)

`node-project-storage.ts` 现在只执行：

```text
assertSafeTarget(relativePath, true)
assertSafeStage(stagedIdentity)
replaceFileByRename(staged, target)
```

`copyFile(staged, target)` 匹配数为 0。没有先删除 target，没有 target→backup→staged 多步交换，没有无限 retry，也没有在 replacement helper 内删除 staged。

Windows 原生 `ReplaceFileW` 是专门的 replace API，Microsoft 文档描述其会以 replacement file 取代 replaced file，并可选创建 backup；R3 没有引入 native bridge，因此不宣称 Node rename 等价于 `ReplaceFileW` 的全部属性。[Microsoft `ReplaceFileW` documentation](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)

## 确定性 helper 合同

`node-file-replacement.test.ts` 聚焦结果：

```text
HELPER_FOCUSED_COMMAND = npm run test -w @surdet/cli -- node-file-replacement.test.ts --reporter=verbose
HELPER_FOCUSED_EXIT = 0
HELPER_FOCUSED_RESULT = 1 file / 7 tests passed
```

永久断言覆盖：正常路径一次 rename；Windows 暂时性错误按固定 schedule 重试；预算耗尽抛出同一错误；`EIO`/`ENOENT`/`EEXIST` 不重试；非 Windows 的 `EPERM` 不重试。

## 真实 Windows GREEN

Task 3 真实 locked-target GREEN 只运行一次：

```text
GREEN_COMMAND = npm run test -w @surdet/cli -- node-project-storage.test.ts -t "keeps complete old and staged bytes when a locked target blocks replacement" --reporter=json --outputFile=<local-path>
GREEN_EXIT = 0
GREEN_RUN_COUNT = 1
GREEN_ASSERTIONS = 1 passed / 0 failed / 5 skipped
```

测试同时证明：锁定调用以 `EPERM` reject；target bytes 仍是完整 OLD；staged bytes 仍是完整 NEW；释放锁后使用同一个 staged identity 成功；target 变为完整 NEW；成功 rename 后 staged 路径消失。

## 验证结果

```text
R3_FOCUSED_TESTS = PASS; 2 files / 13 tests
CLI_FULL_TESTS = PASS; 15 files / 137 tests
CLI_TYPECHECK = PASS; exit 0
CLI_BUILD = PASS; exit 0
VERIFY_ALL = PASS; exit 0; exactly one run; final verify:diff-check PASS
```

唯一一次 `verify:all` 的节点计数为：tools 10/10、renderer boundaries 3/3、renderer legacy 4/4、hygiene 733 paths、Authoring 20/123、CLI 15/137、Core 24/318、Editor 26/172、Host 11/87、Renderer 49/406、Shell 22/195、Starter 4/7、Zero 4/29。Starter lint 为 0 errors/4 warnings，formal zero lint 为 0 errors/128 warnings；Starter/Zero simulate、Editor/Starter/formal build 和最终 diff-check 均通过。Starter simulate 仅作为本任务书允许的唯一 `verify:all` 内置节点执行，没有单独运行；没有运行 Electron、性能、pack、deploy 或 release。

## Artifact 身份

以下身份均从 `R3_ROOT` 磁盘回读：

| artifact | bytes | SHA-256 |
|---|---:|---|
| `<local-path>` | 61 | `898D2AD82D33C86E701D8865F20A428CA48DB35240DD429FD8E62F480C2EA93E` |
| `<local-path>` | 5118 | `B6359E5A5CD79959B85FB7C62573A3C8FA0483E4FB79D4BFE381B67F205209B1` |
| `<local-path>` | 68 | `AA9B845F5332715E037B76437B27F1A8980E8E2521A4F14A0C3494F7222AB917` |
| `<local-path>` | 2242 | `E7E76057FBB7AA20F7C8B196C4E06A41FCF2CAFE00199F925BD3D94BA9B5DE72` |
| `<local-path>` | 8 | `2095D5302E465922147E220C0389F7A923EA0C1509A23097F04B3C220798AEF8` |
| `<local-path>` | 2592 | `10F1BA1DAB417FAFE788B3F585083C450B4E525878A9CE08F8B35F13E11FBD3E` |
| `<local-path>` | 8 | `5DAE72A737750057776CC6551D222D7A5B70E71940B313CD2FC9A1ACA1F4A9F4` |
| `<local-path>` | 3140 | `E8DBCFE4B11BBE8B034165F2DE18E6E6F420944EF064188C4F15B9C1C8322E09` |
| `<local-path>` | 56624 | `E3E0F0AEEA8D39E2E6EE7AA1DEE5C2303F2D0FD8027CB59528F10B8F3593040D` |
```

RED artifact 被保留，所有输出均位于系统临时目录；没有向仓库写入临时测试、日志或动态 fixture。

## 已验证事实、工程结论与未声明边界

已验证事实：

- 真实 Windows locked-target 路径使旧 `rename` 调用失败并暴露当前 copy fallback；
- 新实现不再调用 `copyFile(staged, target)`；
- retry 只对 win32 + `EACCES|EBUSY|EPERM` 生效，schedule 固定且有界；
- retry 耗尽抛出原错误；
- locked-target GREEN 保留 OLD/NEW 完整 bytes，解锁后同一 staged identity 成功；
- `commitChange`、最终 SHA readback、journal 和 R2 生产文件没有被本轮修改。

合理工程结论：删除 byte-copy fallback 消除了 Surdet 主动造成 partial-copy target 的路径；bounded retry 提高短暂 Windows 锁冲突下的成功率，同时保持 fail-loud。

尚未验证或不声明：

- 不声明断电后目录项一定持久化；
- 不声明跨进程并发写线性化；
- 不声明 Node rename 等价于 `ReplaceFileW` 的全部属性；
- 不声明跨进程遗留 stage/backup 扫描；本实现不创建 backup；
- 不声明 repository post-commit persistence failure 已解决；
- 不声明 R3 解决其他 R4～R6 或 Wave 4 reliability finding。

## 停止状态

```text
R3_EXECUTION_RESULT = PASS_PENDING_INDEPENDENT_REVIEW
R3_IMPLEMENTATION = PASS
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_PERFORMED
R3_CLOSED = NO
NEXT_STOP = WAITING_FOR_INDEPENDENT_FINAL_REVIEW
```

历史记录：在 Task 6 代码提交完成、docs-only closure 尚未回读时，曾暂记“真实 HEAD 将在 Task 6 追加”；实际 R3 docs-only closure 身份已在下方记录。

## Task 6 代码证据提交身份

```text
R3_TASK_6_CODE_EVIDENCE = COMPLETED
R3_CODE_EVIDENCE_HEAD = 4d3e42468846c15310c244fb7f2660d77f68ca98
R3_CODE_EVIDENCE_PARENT = 0c8358acfd7131709c97fd53014f2ffe30a78065
R3_CODE_EVIDENCE_COMMIT_MESSAGE = fix(cli): remove tearing Windows replacement fallback
R3_CODE_EVIDENCE_SCOPE = EXACT_R3_CODE_WHITELIST_PLUS_TASKBOOK
R3_CODE_EVIDENCE_FILES = exactly:
  packages/cli/src/authoring/node-file-replacement.ts
  packages/cli/src/authoring/node-project-storage.ts
  packages/cli/test/node-file-replacement.test.ts
  packages/cli/test/node-project-storage.test.ts
  docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md
R3_REPORT_IN_CODE_COMMIT = NO
REMOTE_MAIN_AFTER_CODE_EVIDENCE = 0c8358acfd7131709c97fd53014f2ffe30a78065
AHEAD_BEHIND_AFTER_CODE_EVIDENCE = 1/0
R3_IMPLEMENTATION = PASS
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
PUSH = NOT_PERFORMED
NEXT_STOP = WAITING_FOR_INDEPENDENT_FINAL_REVIEW
```

本段记录代码证据提交已经从磁盘回读；本报告随后只作为 R3 文档收口的一部分提交，未重新运行测试或修改生产代码。

## R3-DOC-1 docs-only closure identity correction

```text
R3_DOC_1 = CLOSED
R3_DOCS_CLOSURE_COMMIT_HISTORICAL_VALUE = PENDING
R3_DOCUMENT_CLOSURE_HEAD = d079f3fcf4eded33836123c4caf3308285430526
R3_DOCUMENT_CLOSURE_PARENT = 4d3e42468846c15310c244fb7f2660d77f68ca98
R3_DOCUMENT_CLOSURE_MESSAGE = docs(cli): report R3 Windows replacement contract
R3_DOCUMENT_CLOSURE_SCOPE = EXACTLY:
  docs/superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md
  docs/RELIABILITY-R3-WINDOWS-NON-TEARING-REPLACEMENT-DELIVERY-REPORT-2026-08-21.md
R3_DOCUMENT_CLOSURE_REMOTE_MAIN = 0c8358acfd7131709c97fd53014f2ffe30a78065
R3_DOCUMENT_CLOSURE_AHEAD_BEHIND = 2/0
R3_DOCUMENT_CLOSURE_IDENTITY_READBACK = PASS
R3_DOCS_ONLY_CLOSURE_CORRECTION = PASS
R3_IMPLEMENTATION = PASS
R3_PRODUCTION_FILES_MODIFIED = NO
R3_TEST_FILES_MODIFIED = NO
TESTS_RERUN = NO
PUSH = NOT_PERFORMED
R3_CLOSED = NO
R4_TO_R6 = NOT_STARTED
WAVE_4 = PAUSED
NEXT_GATE = INDEPENDENT_FINAL_RECHECK
```

`PENDING` 仅是 docs-only correction 前的历史快照；本报告现在明确记录真实 R3 docs-only closure 提交身份。本轮只修正文档身份，不重跑测试、不修改生产代码。
