# Surdet 文档索引

本目录只保留三类内容：当前技术事实、当前/近期任务证据、仍被自动化使用的机器基线。已经闭合且不再指导施工的旧报告和旧任务书由 Git 历史保存，不继续占据日常阅读入口。

## 从这里开始

| 目的 | 文档 |
|---|---|
| 理解当前架构 | [architecture.md](architecture.md) |
| 编写或生成剧本 | [dsl-spec.md](dsl-spec.md) |
| 查看实现能力与验证入口 | [capability-matrix.md](capability-matrix.md) |
| 查看尚未实现或尚未资格化的边界 | [known-limitations.md](known-limitations.md) |
| 给外部 Agent 建立创作上下文 | [AI-GUIDE.md](AI-GUIDE.md) |
| 使用 AI 剧本模板 | [ai-writing-prompt.md](ai-writing-prompt.md) |
| 迁移 Renderer 消费方 | [renderer-v2-migration.md](renderer-v2-migration.md) |
| 迁移 Player Shell | [player-shell-migration.md](player-shell-migration.md) |
| 查看前端最终收口 | [Frontend Pass 10 交付报告](SURDET-FRONTEND-EDITORIAL-WORKBENCH-REDESIGN-DELIVERY-REPORT-2026-09-08.md) |
| 使用现代 Starter 与新项目 | [Starter 重做记录](SURDET-STARTER-MODERNIZATION-DELIVERY-REPORT-2026-09-08.md) |

`capabilities.json` 是能力矩阵的机器可读来源，由 `npm run docs:capabilities` 生成；不要手工维护第二份能力真相。

## 当前阶段

主线 Stage 6 Wave 6 已闭合；Editor V4、Frontend Pass 8 玩家界面与 Pass 9 Windows Electron 消费验证已通过云端终审。当前 Frontend Pass 10 负责退出 Editor 旧兼容样式、九模式一致性与可访问性收口，并按 Owner 后续授权全面重做 Starter 和新项目模板，结果见上方两份记录；不以本地验证代签云端终审或 Owner 体验。主线 Wave 7、发行与部署未开始。下列 Wave 4 文档保留为该阶段的既有证据。

- [Wave 4 设计规格](superpowers/specs/2026-08-20-surdet-agent-port-stage-6-wave-4-design.md)
- [Wave 4 总任务书与 Execution Ledger](superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md)
- [Wave 4 交付报告](SURDET-AGENT-PORT-STAGE-6-WAVE-4-DELIVERY-REPORT-2026-08-20.md)

## 最近的 Authoring 演进

- [Wave 1：Agent-ready authoring vertical slice](superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md)
- [Wave 1 交付报告](AUTHORING-AGENT-READY-VERTICAL-SLICE-STAGE-6-WAVE-1-DELIVERY-REPORT-2026-08-13.md)
- [Wave 2：既有资源驱动的场景演出](superpowers/plans/2026-08-14-existing-asset-presentation-authoring-stage-6-wave-2.md)
- [Wave 2 交付报告](EXISTING-ASSET-PRESENTATION-AUTHORING-STAGE-6-WAVE-2-DELIVERY-REPORT-2026-08-14.md)
- [Wave 3：项目级配置 authoring](superpowers/plans/2026-08-14-project-level-authoring-config-stage-6-wave-3.md)
- [Wave 3 交付报告](PROJECT-LEVEL-AUTHORING-CONFIG-STAGE-6-WAVE-3-DELIVERY-REPORT-2026-08-14.md)

## Pre-Wave 4 可靠性证据

- [Fresh Gate](superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md)
- [R1：Simulation control-flow identity](superpowers/plans/2026-08-20-reliability-r1-simulation-control-flow-identity.md)
- [R2：Post-replacement commit contract](superpowers/plans/2026-08-20-reliability-r2-post-replacement-commit-contract.md)
- [R3：Windows non-tearing replacement](superpowers/plans/2026-08-21-reliability-r3-windows-non-tearing-replacement.md)
- [R4–R6 批次收口](superpowers/plans/2026-08-21-pre-wave-4-reliability-r4-r6-closure-batch.md)

对应交付报告保留在 `docs/` 根目录，便于对照代码证据提交与文档闭合提交。

## 机器证据

- `baselines/`：Renderer 与特定资格化协议使用的冻结 JSON。部分路径被测试和 runner 直接引用，不应当作普通文档删除或改名。
- `examples/`：文档中需要实际 typecheck 的代码样例。
- `capabilities.json`：由共享 capability metadata 生成的机器入口。

## 长期台账与受保护资料

长期路线与决策台账保持其既有本地治理状态，本轮文档降噪没有修改、移动、暂存或提交它。`USER.md`、`SESSION-HANDOFF.md`、美术方向资料和历史 handoff 同样不属于日常技术文档清理范围。

## 历史资料如何恢复

本轮移除的是已经闭合的旧交付报告、旧任务书和工作笔记；没有重写 Git 历史。需要审计时可以使用文件名或提交日期在 Git 历史中读取原文。不要为了“看起来完整”把全部历史报告重新复制回当前树。

文档治理规则见 [archive/README.md](archive/README.md)。
