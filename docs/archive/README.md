# 历史资料索引

已完成或被后续实现取代的阶段文档不再复制保存在当前目录。Git 历史保留原文、失败经过与当时结论；本页只提供查找入口，不维护另一套当前状态。

## 2026-09-23 文档整理基线

固定提交：`389c5edfe988c1146f648079633c8987b2200dda`。这是精简前已经推送的版本，以下链接不会随 main 更新而漂移。

| 要查的材料 | 整理前原文 |
| --- | --- |
| 完整旧台账与逐次决策 | [原长期台账](https://github.com/Equinox7379/Surdet/blob/389c5edfe988c1146f648079633c8987b2200dda/docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md) |
| 各阶段任务书、实施与验收经过 | [历史 plans 目录](https://github.com/Equinox7379/Surdet/tree/389c5edfe988c1146f648079633c8987b2200dda/docs/superpowers/plans) |
| 各阶段设计规格 | [历史 specs 目录](https://github.com/Equinox7379/Surdet/tree/389c5edfe988c1146f648079633c8987b2200dda/docs/superpowers/specs) |
| Wave / Frontend / 可靠性修复交付报告 | [历史 docs 目录](https://github.com/Equinox7379/Surdet/tree/389c5edfe988c1146f648079633c8987b2200dda/docs) |
| 早期 ACCEPTANCE / REVIEW / REPAIR 交接书 | [历史仓库根目录](https://github.com/Equinox7379/Surdet/tree/389c5edfe988c1146f648079633c8987b2200dda) |

本次从当前树移除了 117 份阶段资料；完整文件清单由整理提交的删除差异提供，不另抄一份清单。较早已移除的文档仍可沿其原路径历史查找，未重写 Git 历史。

在本地只读查看某一份原文：

```powershell
git show 389c5edfe988c1146f648079633c8987b2200dda:docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md
```

旧文档中的“当前”“未授权”“等待复审”“尚未开工”仅代表当时状态。现在的结论以[精简后的长期台账](../superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md)、适用的 AGENTS 和 Owner 当前要求为准。归档不将原失败改写为成功，也不表示本次重新验收了每项历史功能。

## 今后保留什么

- 当前使用指南、公共合同和真实技术限制；
- 简短的当前台账与最近仍需复核或续接的执行记录；
- 自动化实际读取的规范、baseline、样例及许可证；
- Owner 明确保留的作品设定、美术资料和治理文件。

已闭合任务优先沿 Git 历史查阅，不继续在工作区积累多套计划、执行报告和交接副本。不自动整理未跟踪材料，不清除原始日志、截图、数据库或恢复屏障；它们不是本次文档精简的目标。
