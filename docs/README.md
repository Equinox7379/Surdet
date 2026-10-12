# Surdet 文档索引

日常阅读只需从下面选择一个入口。当前任务状态集中在长期台账，能力清单由现有元数据生成，旧阶段材料通过 Git 历史查询。

## 创作与开发

行内文字、文字记录后端及Claude前端接入：[行内文字合同](inline-text-contract.md)。
阅读辅助后端及Claude设置页接入：[阅读辅助合同](reading-accessibility-contract.md)。
从源行试玩后端及Claude工作台接入：[目标路径合同](preview-target-path-contract.md)。
流程图结构化操作后端及Claude连线接入：[流程编辑合同](flow-operations-contract.md)。
旧画面溶解后端及Claude转场表单接入：[演出合同](presentation-effects-contract.md)。
项目插件后端及Claude信任/预览接入：[项目插件合同](project-plugins-contract.md)。
Windows免安装导出后端及Claude导出界面接入：[Windows导出合同](windows-game-export-contract.md)。

| 需要做什么 | 阅读入口 |
| --- | --- |
| 用 Editor 从零做作品（中文作者指南与完整教程） | [作者指南](guide/README.md) |
| 安装、启动、创建或试玩项目 | [仓库 README](../README.md)、[Starter 指南](../examples/starter/README.md) |
| 接入桌面“新建项目”界面 | [桌面创建项目接口](desktop-project-creation.md) |
| 给外部 Agent 建立创作上下文 | [AI-GUIDE](AI-GUIDE.md)、[剧本提示词](ai-writing-prompt.md) |
| 核对剧本语法和实际支持能力 | [DSL 规范](dsl-spec.md)、[能力矩阵](capability-matrix.md) |
| 理解模块、公共边界和运行链 | [架构说明](architecture.md) |
| 核对未实现能力和验证边界 | [当前限制](known-limitations.md) |
| 核对引擎许可与作品素材范围 | [MIT 许可证](../LICENSE)、[第三方与素材说明](../THIRD_PARTY_NOTICES.md) |
| 人类与 Agent 在同一项目接力 | [接力与草稿保护](human-agent-relay-wave-7.md) |
| 迁移已有运行消费方 | [Renderer 迁移](renderer-v2-migration.md)、[Player Shell 迁移](player-shell-migration.md) |

`capabilities.json` 与能力矩阵描述渲染及运行支持情况，由现有 `npm run docs:capabilities` 流程维护；创作工具（如 scene.create）的合同通过 Agent Port 的 `capabilities.describe` 读取，见 AI-GUIDE。不要手工复制第二份能力清单。各作品、模板、资产和字体的说明继续放在所属目录，许可证保留原位。

## 项目状态与记录

- [长期路线与决策台账](superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md)：当前状态、长期决策、授权边界和下一阶段方向。
- [完整创作引擎总规划](superpowers/plans/2026-09-25-complete-creation-engine-roadmap.md)：完整 Gal 制作终态、LetsGal 对照取舍、能力覆盖、阶段依赖、验收和压缩后续接入口；规划审核与施工状态在文内维护。
- [引擎成熟化功能规划](superpowers/plans/2026-10-10-engine-maturity-feature-plan.md)：九项功能的现状、方案、分工与待决问题；Owner已授权不等前端继续可独立推进的后端，分阶段状态以原台账为准。
- [历史资料索引](archive/README.md)：已结束的默认创作路径、9 月维护、旧阶段任务书、设计稿和完整施工流水，沿固定 Git 版本查阅，不在本地重复堆积。

## 必须保留的技术资料

- `baselines/`：测试与 runner 使用的冻结 JSON，包括失败与诊断记录，不当作过时报告清除。
- `examples/`：迁移文档需要实际 typecheck 的源码样例。
- [Renderer 性能资格化计划](superpowers/plans/2026-08-10-renderer-performance-measurement-qualification.md)与[性能协议](superpowers/specs/2026-08-10-renderer-performance-measurement-v4-protocol.md)：仍被自动化直接读取，保留既有路径和内容。
- [Player Shell 独立设计取舍](competitive-research/2026-08-11-surdet-player-shell-clean-room-decisions.md)与[《零点之后》设计](superpowers/specs/2026-08-07-zero-after-midnight-design.md)：保留作品与设计来源边界；历史目标不等于新增施工授权。

本次整理仅针对受版本控制的工程文档。`USER.md`、`SESSION-HANDOFF.md`、Owner 指定的美术方向资料、个人便笺及未跟踪 handoff/临时材料均保持原样。
