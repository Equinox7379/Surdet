# 引擎审查整改交付报告

## 一、报告结论

本轮已严格按照《引擎审查整改设计规格》及执行计划，串行完成 Task 0 至 Task 11。

本轮确认的 P1、P2 工程问题已经完成修复，并通过单元测试、类型检查、项目级回归、模拟运行、Shell E2E、正式加密打包和真实程序启动验收。

本报告可作为本轮整改工作的交付依据。

## 二、执行范围

本轮处理内容如下：

| 任务 | 对应问题 | 完成内容 |
| --- | --- | --- |
| Task 1–2 | G12 | 正式游戏打包目标保护、身份校验、入口校验、素材校验、加密发行包流程 |
| Task 3 | F2 | 存档中 combat、affection 等深层结构校验 |
| Task 4 | F3 | 商店购买操作原子化，异常时不再先扣金币 |
| Task 5 | F1 | 立绘销毁前解绑补间，避免补间继续操作已销毁对象 |
| Task 6 | F4、F5 | Ruby 排版、超长文本处理、Ruby 对象池复用 |
| Task 7 | S1、S2、G2 | 音频按频道隔离缓存、容量上限、LRU 淘汰、活动音频保护 |
| Task 8 | S7、S8 | 递归变量值克隆、物品引用隔离、存档恢复安全性 |
| Task 9 | S11、S4 | 原子 JSON 写入、崩溃恢复路径、存档读写基准测试 |
| Task 10 | G8、G9 | 审计分支完整扫描、编译错误可见化和失败退出 |
| Task 11 | 全量验收 | 全量回归、正式打包、真实 EXE 启动与隔离存档验收 |

## 三、主要修改位置

核心修改集中在以下文件：

- packages/core/src/save/save-manager.ts
- packages/core/src/state/types.ts
- packages/core/src/state/variable-store.ts
- packages/core/src/runtime/interpreter.ts
- packages/core/src/systems/shop.ts
- packages/renderer/src/pixi-stage.ts
- packages/renderer/src/audio-manager.ts
- packages/renderer/src/ruby-layout.ts
- packages/shell/prepare-pack.mjs
- packages/shell/scripts/verify-pack.mjs
- packages/shell/src/json-file.ts
- packages/cli/src/audit.ts

对应测试也已同步补充，覆盖异常输入、资源销毁、缓存淘汰、深层快照、原子写入、审计分支和正式包身份等场景。

## 四、验证结果

以下检查均已通过：

~~~text
npm run typecheck                         PASS
npm test                                  PASS
npm run lint -w surdet-starter            PASS
npm run lint -w zero-after-midnight       PASS
npm run simulate -w zero-after-midnight   PASS
node examples/zero-after-midnight/scripts/check-assets.mjs PASS
npm run verify:p1p2                       PASS
npm run e2e -w @surdet/shell              PASS
git diff --check                          PASS
~~~

测试总数：702 个全部通过。

正式游戏模拟结果：

- 24 条路径完成模拟
- 23/23 个选择分支通过
- 39 次存档/读档场景通过
- 3 个结局均可达
- 运行时错误：0
- 素材检查：44 项源素材通过

存档基准测试中，9 MiB 数据的读写 p95 均低于 50ms，因此保留现有同步存储接口，没有为了理论上的异步后端改动公共 API。

## 五、正式发行包验收

正式包目标已明确锁定为：

~~~text
游戏：zero-after-midnight
版本：0.1.0
入口：prologue
模式：release
加密：开启
标题：零点之后 / AFTER MIDNIGHT
~~~

正式发行文件：

- [便携版 SurdetGame-0.1.0.exe](E:/surdet/packages/shell/release/SurdetGame-0.1.0.exe)
- [安装版 SurdetGame-Setup-0.1.0.exe](E:/surdet/packages/shell/release/SurdetGame-Setup-0.1.0.exe)
- [未封装启动验收版 Surdet Game.exe](E:/surdet/packages/shell/release/win-unpacked/Surdet%20Game.exe)

正式包已通过：

- 包内游戏身份校验
- entryScene 校验
- 正式游戏标题校验
- 关键场景校验
- 素材存在性校验
- SDAT2 加密格式校验
- app.asar 关键文件校验

明文正式打包测试已按要求执行，系统正确拒绝生成明文 release 包，且拒绝时没有改写现有暂存内容。

## 六、真实程序启动验收

使用正式构建出的 EXE 进行实际启动验收，结果如下：

- 窗口标题正确显示为“零点之后 / AFTER MIDNIGHT”
- 画布正常创建
- 检测到 45 个实际素材 Blob URL
- 24 条音频条目加载完成
- body、title、ui 三套字体加载完成
- 正常进入 prologue
- 状态进入 awaiting-advance
- 隔离环境内 F5 快速保存成功
- 隔离环境内 F9 快速读取成功
- 运行期间没有页面错误或控制台错误

F5/F9 验收使用独立临时用户目录完成，未读取、覆盖或修改用户现有存档。

## 七、工作树与交付边界

本轮遵守以下限制：

- 未执行 commit
- 未执行 push
- 未执行 git reset、git checkout 或其他强制清理
- 未删除用户文件
- 未修改用户存档
- 保留了工作树中原有的其他改动

最终工作树检查通过。检查输出中的 CRLF 提示属于 Git 换行格式提示，不是代码错误。

## 八、已知非阻塞提示

正式构建过程中出现 Vite 关于单个 chunk 大于 500 KiB 的提示。该提示未导致构建、运行、打包或验收失败，暂不作为本轮整改缺陷。

## 九、相关依据

- 设计规格：docs/superpowers/specs/2026-08-08-engine-audit-remediation-design.md
- 执行计划：docs/superpowers/plans/2026-08-08-engine-audit-remediation.md
- 打包入口：packages/shell/prepare-pack.mjs
- 包体校验：packages/shell/scripts/verify-pack.mjs

## 十、交付结论

本轮整改已经完成计划范围内的工程实现和验收。引擎核心安全性、资源生命周期、文本排版、音频缓存、存档耐久性、审计完整性以及正式发行包误发防护均已落实到代码和自动化测试中。

建议总经理审核本报告及对应执行计划，将本轮状态标记为：

> 有条件通过整改，允许进入后续产品验收与发行准备阶段。
