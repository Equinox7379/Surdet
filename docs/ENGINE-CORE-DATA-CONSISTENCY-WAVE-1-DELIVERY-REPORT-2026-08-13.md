# Surdet Core 数据一致性 Wave 1 交付报告

日期：2026-08-13

最终状态：`CORE_DATA_CONSISTENCY_WAVE_1_IMPLEMENTED`

## 1. 范围与结论

本轮只处理两个已经由源码和回归测试确认的 Core 数据一致性缺陷：

1. `GrowthSystem.gainExp()` 在一次经验导致多级升级时，原实现会在逐级循环内通过 `VariableStore.modify()` 写入属性；如果后续 `statGrowth` 目标无效，先前属性可能已经改变，而等级和经验尚未提交。本轮改为先准备完整属性批次，再使用现有 `VariableStore.setMany()` 原子提交，最后写入 Growth 的等级和经验 map。
2. `SaveManager.save()` 原实现会生成盖章快照并直接调用 `SaveStorage.write()`，没有在后端写入前用 current schema 校验最终候选。本轮在生成真实 slot 元信息、时间戳和 schemaVersion 后，对该最终候选调用 `assertValidSnapshot(stamped, 'current')`，通过后才深拷贝并写入。

本轮没有修改：

- `packages/core/src/runtime/interpreter.ts`；
- `packages/core/src/save/migrate.ts`；
- `packages/core/src/state/variable-store.ts`；
- `SaveStorage` 接口；
- 存档 schema 版本；
- Shell、Host、Renderer、Editor 或任何 examples；
- 剧情、DSL、素材、Gallery、音频、性能 artifact、性能门限和 M9。

没有新增 migration、fallback、备份、补偿存储、状态机、回滚容器、异步队列或依赖。

## 2. Growth 原子提交

### 2.1 修复前红灯

在修改生产代码前，新增四个失败回归：

- 后续 `statGrowth` 目标未声明；
- 后续目标不是 number；
- 后续目标为 readonly；
- 后续增量不是有限 number。

运行：

```text
npm run test -w @surdet/core -- test/growth.test.ts
```

真实结果：退出码 `1`，20 tests 中 `4 failed / 16 passed`。四个失败都显示同一事实：`lynn.atk` 已从 `5` 改为 `7`，随后才因后续配置错误抛出；Growth 的等级/经验仍未提交。这构成了真实的部分写入红灯，而不是只检查错误消息的证明性测试。

### 2.2 最小修复与绿灯

修改文件：

- `packages/core/src/systems/growth.ts`
- `packages/core/test/growth.test.ts`

`gainExp()` 当前提交顺序为：

1. 在局部 `level`、`xp` 和 `passed` 中计算经验与所有可升级等级；
2. `#prepareStatGrowthUpdates()` 读取并验证全部 `statGrowth` 目标，检查声明、number 类型、有限增量和有限最终值，不写入任何状态；
3. 调用既有 `VariableStore.setMany(updates)`，由 VariableStore 完成整批声明、类型、readonly、clamp 校验和一次性提交；
4. `setMany()` 成功后才写入 `#levels` 与 `#experience`。

没有新增 VariableStore API，也没有在 GrowthSystem 中实现第二套回滚容器。

同一聚焦命令修复后：

- 退出码 `0`；
- Growth 测试 `20/20`；
- 四种非法配置均保持变量快照、等级和经验快照完全不变；
- 合法多级升级仍为 `levelBefore=1`、`levelAfter=3`、`levelsGained=2`、`passedLevels=[2,3]`；
- clamp 后属性仍为 `lynn.atk=7`、`lynn.hp=40`；
- Growth 快照仍为 `levels.lynn=3`、`experience.lynn=5`。

Task 1 提交：

```text
37407241dca76454c897460781383aa07edd7d9a
fix(core): make growth grants atomic
```

## 3. SaveManager 写前校验

### 3.1 修复前红灯

在修改生产代码前，新增 `RecordingStorage` 和三条边界回归。运行：

```text
npm run test -w @surdet/core -- test/save.test.ts
```

真实结果：退出码 `1`，25 tests 中 `2 failed / 23 passed`：

- 非 JSON 安全变量测试错误地 resolved，说明原实现会把非法快照送到 RecordingStorage；
- 非法 Gallery 测试错误地 resolved，说明原实现会继续写入并可能覆盖既有有效槽位；
- 合法快照盖章为真实 slot/current schema 的测试在修复前已通过，证明红灯准确指向缺失的写前校验。

### 3.2 最小修复与绿灯

修改文件：

- `packages/core/src/save/save-manager.ts`
- `packages/core/test/save.test.ts`

`SaveManager.save()` 现在先生成最终 `stamped` 候选，其中包含：

- 调用方指定的真实 slot ID；
- `updatedAt`；
- 缺失时生成的 `createdAt`；
- `SAVE_SCHEMA_VERSION`（当前为 `3`）。

随后严格执行：

```ts
assertValidSnapshot(stamped, 'current');
await this.#storage.write(slot, deepClone(stamped));
```

不存在 try/catch、fallback、备份、迁移或兼容层。非法候选在后端调用前抛出，因此不会写入或覆盖旧槽位；合法输入仍以真实 slot `real-slot` 和 schema `3` 写入。

同一聚焦命令修复后：

- 退出码 `0`；
- Save 测试 `25/25`；
- RecordingStorage 非法 JSON 的 `writes=[]`；
- 非法 Gallery 不改变已有有效槽位；
- 合法快照先盖章再写入的断言通过。

Task 2 提交：

```text
8b7350ee8a2bde843b4fd892be3fe7b6bf9d9735
fix(core): reject invalid snapshots before save writes
```

## 4. 验证结果

以下均为本轮实际命令结果：

| 命令 | 结果 |
|---|---|
| `npm run test -w @surdet/core -- test/growth.test.ts`（修复后） | 退出码 `0`，20/20 |
| `npm run test -w @surdet/core -- test/save.test.ts`（修复后） | 退出码 `0`，25/25 |
| `npm run test -w @surdet/core` | 退出码 `0`，23 files、313/313 |
| `npm run typecheck -w @surdet/core` | 退出码 `0` |
| `npm run build -w @surdet/core` | 退出码 `0` |
| `npm run simulate -w zero-after-midnight -- --max-paths 500 --max-steps 20000` | 退出码 `0`，23/23 branches、3 endings、39 save/load smoke、0 runtime errors |
| `git diff --check` | 退出码 `0` |
| `git ls-files '*.log'` | 空 |

`npm run verify:all` 没有作为本轮门禁运行，符合 Core 计划要求。仓库已知的 Editor CRLF/LF 逐字节往返问题没有被修改，也没有为了本轮刷绿而运行或扩大到 Editor/Starter。

正式 Zero 模拟证明了 Core 修改后的一个真实消费者路径仍可运行，包括 11 个场景、23/23 choice 分支、3 个结局、39 次 save/load 冒烟和 0 runtime errors。没有执行 Electron 或人工玩家测试，因为本轮不涉及 Shell/Renderer UI 或发行边界。

## 5. Git 与停止点

- 真实起始 HEAD：`2f82ea32adfacbb2aab5cba8230f9d58113b7d2b`。
- Growth 实现提交：`37407241dca76454c897460781383aa07edd7d9a`。
- Save 实现提交：`8b7350ee8a2bde843b4fd892be3fe7b6bf9d9735`。
- 文档收口前 HEAD：`8b7350ee8a2bde843b4fd892be3fe7b6bf9d9735`。
- 文档收口提交完成后的最终 HEAD 和 `HEAD...surdet/main` 由紧随其后的只读 Git 复核确定，并在最终交付回报中报告；本报告不预先填写不存在的自引用 commit SHA。
- 文档收口只允许暂存本报告与 `docs/superpowers/plans/2026-08-13-core-data-consistency-wave-1.md`；项目路线台账、BGM Wave 1 文件、受保护文件和构建产物均未暂存。
- 未 push、未部署、未打包、未发行、未进入 Shell 失败数据可靠性、未进入备份恢复、未处理音频生产、未处理性能、未进入 M9。

## 6. 后续边界

本轮不授权开始下一阶段。长期路线台账中下一个候选主题是阶段 2 的 Shell 失败数据可靠性；`.bak` 显式恢复属于阶段 3 的独立议题。两者都需要总经理新的明确批准和独立任务书，不能由本报告自动启动。

最终状态：

```text
CORE_DATA_CONSISTENCY_WAVE_1_IMPLEMENTED
GROWTH_ATOMICITY_VERIFIED
SAVE_WRITE_VALIDATION_VERIFIED
ZERO_SAVE_LOAD_CONSUMER_PATH_VERIFIED
SHELL_DATA_RELIABILITY_NOT_STARTED
BACKUP_RECOVERY_NOT_STARTED
AUDIO_PRODUCTION_DEFERRED
PERFORMANCE_WORK_DEFERRED
M9_NOT_STARTED
NOT_PUSHED
WAITING_FOR_INDEPENDENT_REVIEW
```
