# Surdet 文档索引

日常阅读只需从下面选择一个入口。当前任务状态集中在长期台账，能力清单由现有元数据生成，旧阶段材料通过 Git 历史查询。

## 创作与开发

| 需要做什么 | 阅读入口 |
| --- | --- |
| 安装、启动、创建或试玩项目 | [仓库 README](../README.md)、[Starter 指南](../examples/starter/README.md) |
| 给外部 Agent 建立创作上下文 | [AI-GUIDE](AI-GUIDE.md)、[剧本提示词](ai-writing-prompt.md) |
| 核对剧本语法和实际支持能力 | [DSL 规范](dsl-spec.md)、[能力矩阵](capability-matrix.md) |
| 理解模块、公共边界和运行链 | [架构说明](architecture.md) |
| 核对未实现能力和验证边界 | [当前限制](known-limitations.md) |
| 人类与 Agent 在同一项目接力 | [接力与草稿保护](human-agent-relay-wave-7.md) |
| 迁移已有运行消费方 | [Renderer 迁移](renderer-v2-migration.md)、[Player Shell 迁移](player-shell-migration.md) |

`capabilities.json` 与能力矩阵由现有 `npm run docs:capabilities` 流程维护；不要手工复制第二份能力清单。各作品、模板、资产和字体的说明继续放在所属目录，许可证保留原位。

## 项目状态与记录

- [长期路线与决策台账](superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md)：当前状态、长期决策、授权边界和下一阶段方向。
- [默认完整创作路径实施计划](superpowers/plans/2026-09-23-default-authoring-path.md)：本阶段任务、依赖、合同、验收及施工进度。
- [最近维护记录](superpowers/plans/2026-09-16-maintenance-reports.md)：9 月 16–23 日修复的编号、实现、首红、复验与保留边界。
- [历史资料索引](archive/README.md)：旧阶段任务书、设计稿、交付报告和精简前完整台账。

## 必须保留的技术资料

- `baselines/`：测试与 runner 使用的冻结 JSON，包括失败与诊断记录，不当作过时报告清除。
- `examples/`：迁移文档需要实际 typecheck 的源码样例。
- [Renderer 性能资格化计划](superpowers/plans/2026-08-10-renderer-performance-measurement-qualification.md)与[性能协议](superpowers/specs/2026-08-10-renderer-performance-measurement-v4-protocol.md)：仍被自动化直接读取，保留既有路径和内容。
- [Player Shell 独立设计取舍](competitive-research/2026-08-11-surdet-player-shell-clean-room-decisions.md)与[《零点之后》设计](superpowers/specs/2026-08-07-zero-after-midnight-design.md)：保留作品与设计来源边界；历史目标不等于新增施工授权。

本次整理仅针对受版本控制的工程文档。`USER.md`、`SESSION-HANDOFF.md`、Owner 指定的美术方向资料、个人便笺及未跟踪 handoff/临时材料均保持原样。
