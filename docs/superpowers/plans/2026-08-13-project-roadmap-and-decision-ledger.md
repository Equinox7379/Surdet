# Surdet 项目路线与总经理决策台账

> 本文件是 Surdet 的长期路线、范围边界和阶段顺序台账。它不是某一轮代码施工计划，也不替代当轮任务书；当新任务开始时，执行 AI 必须先读取本文件、仓库根目录 `AGENTS.md` 和最近一份相关交付报告。
>
> 最近登记：**2026-09-12**。本文件的唯一当前事实快照为[第 9.8 节](#current-state)，当前协作与授权口径见[第 9.6 节](#current-cooperation)，本次纳入版本控制的授权见第 9.21 节。页首与第 6.1 节只提供入口，不再分别维护会漂移的 HEAD 和下一步。原 2026-08-26 页首摘要已完整保留在第 6.2 节历史归档。
>
> 维护原则：施工主代理依 Owner 当前授权维护这一本台账的实际进度和已批准决定，区分本地验证、CI、云端终审与 Owner 体验判断。**项目所有者保留产品方向、阶段转换、重大取舍及最终体验的决定权。** Owner 于 2026-09-11 明确将本台账纳入 Git 与普通 push 范围；后续随获准的仓库变更维护，不再保持 local-only，也不得代签云端终审。原维护原则同原页首摘要一并保留在第 6.2 节。
>
> 阅读时先看第 9.8 节和本轮明确指令，再按任务读取相应历史。旧段落中的“当前”“唯一下一步”“未授权”“未推送”均属于其登记时点；未被更改的产品边界继续有效，但不得把已被后续决定取代的状态重新生效。

## 一、项目最高路线

Surdet 首先服务项目所有者自己的创作和游玩体验，不以赶发行、兼容所有假想用户、追求理论零风险或堆积审计文档为目标。

最高路线只有一句话：

> **先确保底层真实路径可靠，再逐渐扩展新功能。**

这里的“底层可靠”是指真实玩家路径中的状态、数据、资源、输入和恢复行为不被污染；不是要求在没有真实风险的地方建立发行级或金融系统级防御。

## 二、已经确认的长期原则

> **2026-09-07 适用说明：** 本节保留最初登记的原则。复用优先、真实证据、保护用户数据等未变；旧的逐次子代理审批、默认提交即停、普通红灯停止和 Git 授权口径，以第 9.6 节登记的现行合作方式及当轮 Goal 为准，不按早期文字累计额外门禁。

### 2.0 总经理指令的持久化与 AI 调度纪律（2026-08-13 追加）

- **引擎施工永远优先。** 未完成的引擎底层可靠性、状态边界、存档/读档、恢复、资源生命周期和可视化编辑器路线，不得被音乐、美术、性能、文档研究或任何无关建议抢占。
- **音频生产冻结。** 当前 BGM 仍是难听的临时正弦占位；除非总经理在未来明确下达“开始音频生产”指令，不得主动建议、规划、审查、生成、归一化、替换或提交音乐/音频资产。
- **不得擅自启动子代理、并行研究或高消耗流程。** 即使存在可用额度或并发能力，也必须由总经理明确逐项指定要启动的任务、目的和范围后才能启动。没有这种逐项授权时，只处理当前已经授权的执行 AI 交付复审或总经理直接提出的问题。
- **每次总经理确认路线、优先级、暂停项或禁止项后，主经理 AI 必须在开始下一项施工或派发任务前，将该决定写入本台账的当前事实或明确约束；不得只依赖对话上下文、口头承诺或临时记忆。**
- 新对话、上下文压缩或任何任务恢复时，必须先读取 `AGENTS.md`、本台账和最新相关交付报告；若三者与最近总经理指令冲突，以最近总经理明确指令为准，并先更新本台账再制作任务书。

### 2.1 实现原则

1. 不保留无必要的向后兼容。过时的内部路径可以直接删除；不得仅凭想象添加兼容层、migration 或 fallback。涉及仍在支持范围内的存档、用户数据、已发布公共接口或正式游戏时，必须由当轮任务书明确兼容范围。
2. 选择满足当前需求的最简单实现。不做预防性抽象，不增加没有当前调用方的配置层，不为假设中的未来需求制造间接层。
3. 先跑通最小端到端版本，再逐步增加能力。不要为了尚未完成的复杂度拆掉已经能运行的路径；每次扩展都保留一个可验证、可回退的工作基线。
4. 组件保持模块化和关注点分离。输入、状态、渲染、资源、存档、音频和内容配置不应互相偷取内部实现；跨层协作通过明确公共契约完成。
5. 优先使用成熟、有人维护的库。引入前检查许可证、平台兼容性、维护状态和实际体积；没有明确理由，不自行重写已有能力。
6. 先检查项目已有依赖、工具和公共模块能做什么，再决定是否新增包或自己实现。
7. 对已经有证据的稳定边界做长期架构决策，不接受“先这样、以后再换”的临时债务；同时不在证据不足时提前设计未来复杂度。
8. 需要借鉴时，先观察成熟产品和已验证模式，提取工作流、信息架构和工程原则；不复制受保护代码、品牌或资产，不让无关调研阻断当前任务。

### 2.2 证据与验收原则

- 项目所有者亲自操作正式游戏得到的现象是一手缺陷证据。自动化暂时没有复现时，先检查入口、真实输入和可见画面是否被测试遗漏，不能直接否定玩家反馈。
- 自动化测试不能替代视觉、声音和操作手感的最终判断。`playing=true`、回调计数、内部快照或页面无错误，都不能单独证明人耳听见、画面好看或操作舒服。
- “已修复”“已通过”“已完成”必须有本轮真实命令、测试输出、文件或 artifact 支撑。失败证据不能为了变绿而删除、覆盖、筛选或改写。
- 测试强度必须与风险匹配：文档修改不需要发行级矩阵；局部低风险修复不自动升级为全仓库性能资格化；跨层存档、资源生命周期和公共契约才需要相应的状态不变量与集成路径。
- 一次只处理一个主题。稳定性、性能、资产、音频、剧情、编辑器和文档治理不得在同一轮无边界混合。

### 2.3 施工与 Git 原则

- 执行 AI 每轮先读取 `AGENTS.md`、本台账和当轮任务书，记录真实 HEAD、工作树和远端关系。
- 默认先做局部、可解释、易回滚的实现；遇到阻断就停在阻断点，不猜测性扩大范围。
- 未经总经理明确授权，不 push、不 force push、不发行、不重新打包正式 EXE、不修改历史、不清理用户文件。
- 执行 AI 本地提交后默认停在 `WAITING_FOR_REVIEW`；总经理独立复审后，才决定是否普通 push、部署或进入下一主题。
- 受保护文件保持原样：`SESSION-HANDOFF.md`、`USER.md`、`docs/SURDET-ART-DIRECTION-UPDATE-BRIEF-2026-08-09.md`、`docs/SURDET-ART-DIRECTOR-HANDOFF-2026-08-09.md`。当前仓库还存在外部环境新增的未跟踪 `AGENTS.md`，不得擅自修改或删除。

## 三、确认过的长期优先级

> **2026-09-07 编号说明：** 下文是最初的阶段路线，其中“阶段 6：音频、美术与演出扩展”不等同于第 4.49 节之后采用的 `Stage 6 / Agent-friendly authoring`。早期内容完整性 Wave、Pre-Wave 5 可靠性批次、主线 Wave 和 Frontend Pass 各有上下文。当前主线与前端进度只见第 9.8 节；不能从编号相同推导音频解冻、阶段已完成或施工已授权。

以下顺序是项目路线，不是要求一次性把所有阶段都做完。每一项完成后都必须由总经理根据真实体验决定是否进入下一项。

### 阶段 0：已完成 Wave 6 内容完整性收口

Wave 6 已完成并已进入远端，包含通用 Gallery 内容校验、《零点之后》Gallery 图接线、Starter 悬空音乐声明清理和相关门禁。它不等于音频艺术质量完成，也不等于可视化编辑器完成。

### 阶段 1：Core 数据一致性

优先确认和必要时修复：

- 状态快照的严格校验与二阶段恢复；
- 非法快照不能污染运行时状态；
- 变量、时间轴、表现快照和剧情位置的一致性；
- 失败恢复不产生半提交状态；
- save/load 往返和边界数据的公共契约。

已有的稳定性 Wave 1 修复可以作为现状证据，但不能因为历史测试全绿就跳过针对真实玩家路径的抽查。若没有新的症状，下一轮应先做定向复审或小范围补强，不要无证据重写 Core。

#### 已完成的阶段 1 首个限定任务

总经理已批准先执行：

`docs/superpowers/plans/2026-08-13-core-data-consistency-wave-1.md`

该任务只处理两项源码已确认的 Core 事务一致性问题：

1. `GrowthSystem.gainExp()` 多级升级在后续 `statGrowth` 配置无效时可能留下先前属性的部分写入；
2. `SaveManager.save()` 未对最终盖章快照做 current-schema 写前校验，可能把结构非法的快照交给通用存储后端。

任务不处理存档 `.bak`、Shell 存储故障、回退黑屏、音频生产、编辑器、性能或发行。实施后必须停在独立复审，不自动进入阶段 2。

### 阶段 2：Shell 失败数据可靠性

优先确认和必要时修复：

- 存档写入、读取、删除、列举和索引失败的错误传播；
- 失败时 UI session、overlay、command rail 和页面可见状态的回滚；
- 异步 pending 期间重复点击的消费和重试语义；
- 宿主存储适配器与公共 PlayerUiSession 的边界；
- 不把失败静默吞掉，也不把错误变成错误的成功状态。

Wave 2/3/4/5C 已经落地了多项公共修复，但以后继续施工时仍必须以真实调用链为准，不复制第二套状态机，不为不存在的调用方添加抽象。

### 阶段 3：存档、备份与显式恢复边界

在 Core 与 Shell 的基础可靠性确认后，再集中处理：

- 存档备份和恢复的明确用户动作；
- 恢复前后的 UI、世界、表现和音频状态清理；
- 回退、读档、返回标题和切换场景之间的状态边界；
- 失败后可重试且不重复提交；
- 旧状态不会残留到新会话。

这一阶段特别关注真实玩家报告过的回退黑屏、幽灵选择、读档后资源残留等问题。自动化必须验证真实可见投影和真实输入，不得只验证内部字段。

### 阶段 4：阶段性确认地基稳定

在继续扩展功能前进行一次适度的综合确认：

- Core、Shell、Renderer 的受影响聚焦门禁；
- 《零点之后》真实路径的存档、读档、回退、标题返回、Gallery 和场景切换；
- 只做与真实风险匹配的少量 Electron 路径，不重复无意义的大型矩阵；
- 明确列出仍未解决的体验问题和证据缺口。

这一步的目的是确认“已经足够稳定，可以继续做创作工具”，不是追求理论上的绝对无缺陷。

### 阶段 5：逐步推进可视化编辑器

可视化编辑器是重要产品主线，优先级高于音频生产、性能资格化和文档大整理。推进方式：

1. 先让编辑器能稳定读取、编辑和预览当前已有的场景、资源、角色、对话、选择和 Gallery 数据。
2. 先跑通一个最小端到端编辑—预览—保存流程，再逐步加入时间轴、演出、资产管理和调试能力。
3. 借鉴 `C:\Users\Equinox\Downloads\Studio-1.9.7-win` 等成熟项目的工作流和信息架构，不复制其代码、品牌或资产。
4. 先以真实创作体验为验收标准：项目所有者实际操作后指出卡点，再决定下一项改进。
5. 不为未使用的插件系统、多人协作、云同步或复杂配置层预先建框架。

### 阶段 6：音频、美术与演出扩展

只有底层和编辑器达到足够稳定后，再推进：

- 音频工程师岗位与真实 BGM/SE 重建；
- 艺术总监的资产规范、白边清理、尺寸和风格一致性；
- 演出、镜头、转场、循环点、ducking 和可视化调参；
- 通过项目所有者逐项试听、观看和操作确认。

当前音频状态必须准确记录为：

```text
BGM_WAVE_1_AUDIBILITY_DONE_LOCALLY
BGM_AUDIBLE_CONFIRMED_BY_OWNER
AUDIO_QUALITY_REJECTED_AS_HUMMING_PLACEHOLDER
INTERIM_AUDIBLE_PLACEHOLDER
AUDIO_PRODUCTION_DEFERRED
```

这表示十个 BGM 的“听得见”技术底线已经建立，但音乐仍是难听的程序正弦占位音。不得继续调引擎增益来掩盖它，也不得把 Wave 1 宣称为正式音乐完成。当前本地还有三个音频提交，尚未 push；在决定如何整合前，不启动新的音频生产工作，也不擅自丢弃这些提交。

### 阶段 7：性能、发行、Legacy 与文档治理最后处理

以下事项都放在功能和创作体验之后：

- 性能测量资格化和性能优化：当前实机体验流畅，除非出现可重复的真实性能问题，否则不让性能工作阻塞功能路线。
- 正式发行、EXE 打包和发布门禁：在功能、资产和音频达到项目所有者满意后再做。
- Legacy/兼容窗口收尾：只在真实支持范围和迁移边界确定后处理，不为假想用户保留兼容层。
- 文档治理和仓库大整理：最后集中处理。历史报告、计划、证据和基线如何归档，必须先确认硬编码引用、CI 门禁和实际使用关系，不做无证据的大规模移动。

## 四、历史事实快照与逐次裁决（自 2026-08-13 起）

> **2026-09-07 标注：** 本节各小节原文保留。这里的等待、失败、暂停、角色和授权是当时事实；后继修复与路线以相应后文及第九节为准。原章名为“四、当前事实快照（2026-08-13）”，不再用它指代今天的项目状态。

### 4.1 已完成并已推送

- Wave 6 Gallery 内容完整性：已完成。
- Gallery 音乐播放闭环的公共修复：已完成并已推送。
- Wave 5B 的选择枝居中、继续指示器避让、Backlog 标题颜色：已完成并已通过项目所有者人工确认。
- Wave 5A/5C 的回退、恢复和相关防御性边界：已有修复与证据，但真实黑屏根因曾被谨慎标记为未完全确认；后续不得使用过度声明。

### 4.2 历史基线与前次阻断（2026-08-13 16:46 核对；已由 4.20 supersede）

```text
HEAD = 7b37fc93bd339230840317526a9de70b9a2df9f2
surdet/main = 7c4a0059204e927061a67b2005da0036d056409e
HEAD...surdet/main = 16 0
```

当前唯一施工主题是阶段 3 的“存档备份与显式恢复 Wave 1”。已完成并本地提交：

- Task 1 / Core 公开备份契约：`7dd2aa0f3ee34532d3c92409c02ebe56eb805207`；
- Task 2 / Shell、IPC、Host 显式恢复接线：`9a592c75f6a0958107ba5fb0192edadcfadb369e`；
- Task 3 / Renderer 与《零点之后》“恢复备份并读取”动作：`86cc43c85d5f1d8178d1549563bec7a710bb68f5`。

Task 4 的一次最小真实 Electron 恢复路径经过三项最小 harness 修正：`f9c92b217f5d7526e2b48ba2015f5ad49007a1da`（通过可见 command rail 操作存读档）、`ad23e20aae809f2f04c98407751d552830ce0620`（通过真实玩家按键打开存档菜单）与 `2144d3c6fb90d7e2e486433920aefc5d74246c63`（等待真实玩家游戏事务空闲再断言）。随后当前执行会话在未提交 runner 上补齐了 Wave 4 的资源就绪、双帧呈现和 overlay 参数传递，并完成了一次正式路径运行：菜单、保存、覆盖、读档页和“恢复备份并读取”动作均到达，错误通道为空；但一次 `Space` 只完成文字呈现，第一次保存前后位置都为 `prologue:7`，因此不能证明备份内容发生了有效回退。当前阻断已从“菜单入口”收窄为“推进语义 harness”，不把 harness 问题冒充为产品恢复缺陷。

Task 5 的前一版阻断式交付是历史状态，文档提交为 `7b37fc93bd339230840317526a9de70b9a2df9f2`。当时正式 Electron 尚未证明“第二次保存位置不同后，恢复备份确实回到第一次保存位置”；该状态已由 4.20 的新鲜一次性验证事实 supersede。

前次正式路径 artifact 为 `C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-IqXjre\save-backup-restore.json`，磁盘实测 `1,108` bytes、SHA-256 `7BFB2D75D6FCBFBBB764322015A73738A176A6BD8F00E675DAB25E65F8A041B5`，运行时 `runHead=7b37fc93bd339230840317526a9de70b9a2df9f2`；资源 `48/48` 完成，page/console/request/unhandled/renderer/release 错误均为 `0`。该历史 artifact 状态是 `FAILED`，失败唯一为“第二次保存前剧情位置已变化”。

此前三个 BGM Wave 1 本地提交仍是当前提交链祖先：

- `565192ad`：提高十首 BGM 的 PCM 电平；
- `2fed326`：记录音频基线；
- `2f82ea3`：报告格式收口。

项目所有者确认“有声音但持续嗡嗡声”；这些仍是未接受的程序占位音资产，音频生产继续冻结。

### 4.3 当前下一步（以 4.21 为准）

当前不启动新的音乐任务，不启动性能资格化，不启动文档整理，不进入发行，也不启动阶段 4。

一次性正式 Electron 自动化路径已经总经理独立复审批准。当前停止在**等待项目所有者明确授权部署**；未经授权不部署，也不开始人工验收。任务书为：

`docs/superpowers/plans/2026-08-13-save-backup-and-explicit-recovery-wave-1.md`

该任务的 runner 语义整改、唯一一次正式路径和独立复审均已完成；自动化证据证明第一次保存位置、不同的覆盖前位置、真实恢复按钮动作和恢复回第一位置。仍未进行项目所有者人工 11 步验收，也未获部署、push 或阶段 4 授权；不处理音频、性能、编辑器、文档治理或发行。

### 4.4 Push 禁令与本地提交处理（历史边界；已由 4.25 supersede）

当前禁止 push，原因有两个，缺一不可：

1. 正式 Electron 自动化路径已通过总经理独立复审，但仍需项目所有者明确授权部署并完成人工验收；本轮尚无部署授权；
2. 本地提交链仍含三个未经项目所有者接受的 BGM 占位音频提交。

在未来任何普通 push 前，必须先由项目所有者明确决定这三项音频提交的处置；不得 rebase、reset、amend、squash 或重写历史。未取得该决定和明确 push 授权前，不得借底层修复、备份恢复或编辑器任务夹带推送音频资产。

### 4.5 已登记的人工验收草案与提醒义务

GLM 只读产物：

`C:\Users\Equinox\Desktop\SURDET-FOUNDATION-PLAYER-ACCEPTANCE-DRAFT-2026-08-13-glm52.md`

该草案提供 11 步、约 10–15 分钟的“基础玩家验收”清单；它没有运行 Electron、没有修改仓库，也没有提出代码变更。其固定基准是 `2da191cfee3fbec6a506831f49f2c70220c429a0`，因此不是当前工作树或下一轮完成后的最终验收结论。

**强制提醒点：** 当前“存档备份与显式恢复 Wave 1”完成并经独立复审后，必须在部署指令中写明该轮最终被测代码 HEAD，并请求项目所有者按该草案的 11 步进行手动验收。桌面草案本身是外部只读研究产物，未经项目所有者明确授权不得覆盖或改写。项目所有者只需报告出现异常的步骤、操作路径、可见现象和截图；未报告异常不等于自动批准 push 或发行。

### 4.6 已确认的后续顺序（不得插队）

1. **已完成：阶段 3 / 存档备份与显式恢复 Wave 1 的正式自动化证据独立复审。** 一次正式 Electron 路径已证明不同位置保存与显式恢复回第一位置；总经理已独立核对 runner 提交、artifact、计划、报告和真实 Git 状态并批准自动化路径。该批准不等于人工验收通过，也不授权阶段 4。
2. **当前：人工验收准备（等待项目所有者明确部署授权）。** 只有项目所有者明确授权部署后，部署指令才写明最终被测 HEAD，并以 GLM 11 步草案作为操作清单交由项目所有者实测；不改写桌面草案。项目所有者只需报告异常步骤、操作和可见现象，不必逐项填写通过。若有异常，只围绕实际异常开一个局部修复任务；若无异常，才由总经理决定是否进入第 3 步。
3. **阶段 4 / 地基阶段性确认。** 只确认已经做过的存档、读档、恢复、回退、返回标题、场景切换、Gallery 和资源释放边界能协同工作；采用受影响测试加少量真实玩家路径，不新增功能、不做大矩阵。
4. **本地提交与远端闭环决策。** 在任何普通 push 前，先由项目所有者决定三项 BGM 占位音频提交是保留还是以新的反向提交撤销；只有内容范围干净且得到明确授权，才允许普通 push。该步骤不是发行。
5. **阶段 5 / 现有可视化编辑器的可信手验收与局部修复。** 现有编辑器已经具备项目打开、场景与配置浏览、块编辑、未保存预览、保存回盘、撤销/重做和崩溃恢复。先由项目所有者走“改一句台词 → 预览 → 保存 → 重开仍存在”这条现成闭环；只有该实际操作暴露问题时，才开局部修复任务。不得误判为需要从零重造项目浏览、场景编辑、预览或保存能力。
6. **可视化编辑器的定向扩展。** 在第 5 步已可信手且项目所有者提出真实创作需求后，再按痛点逐项扩展角色/Gallery/资产管理、演出或调试；战斗、商店、周目配置可视化、桌面化、多人协作、云同步和插件系统均不提前做。
7. **阶段 6 / 音频、美术和演出。** 只在引擎与编辑器达到够用状态后开始。音频必须是替换程序占位音为真实资产的生产工作，不再做单纯音量调节；美术与演出同样以项目所有者试听、观看、操作为验收。
8. **最后：性能、发行、Legacy 和文档治理。** 性能只在出现可重复的真实卡顿时介入；正式发行只在项目所有者满意后介入；仓库文档整理必须最后做，先检查 CI/脚本硬编码引用，再移动或归档。

任何新任务都必须从这份顺序中选择一个主题；不得跳过第 2 步的人类验收，不得把第 7 或第 8 步提前到引擎或编辑器之前。

### 4.7 编辑器研究结论（不是当前任务）

桌面上存在同主题的并行只读研究报告；不在当前台账中指定“正式版”，也不把它们当作当前源码或交付验收依据。文档治理留到项目最后统一处理。

唯一保留的路线结论：**现有编辑器已经具备“改台词 → 预览 → 保存 → 重开确认”的基础；阶段 5 先由项目所有者实操，只有真实卡点才开局部修复，不从零重造编辑器，也不提前做战斗/商店/周目编辑、桌面化、协作、云同步或插件系统。** Studio 观察只可借鉴工作流和信息架构，不得复制其代码、品牌或资产。

### 4.8 复用优先决策（项目所有者明确确认）

后续所有引擎、编辑器和工具任务遵循“**能复用就复用，不重复造轮子**”的固定顺序：

1. 先查 Surdet 当前已有包、公共模块、CLI 和编辑器是否已经具备该能力；
2. 再查成熟、维护活跃、许可证兼容且体积/平台可接受的开源库；
3. 再借鉴成熟产品已经验证的交互工作流与信息架构；
4. 只有前三项都不能满足当前明确需求时，才写最小自研实现。

“照搬”只适用于许可证允许的开源依赖、开源实现或本项目已有代码，并必须保留许可证与归属信息；对 Studio 等商业软件，只可观察和借鉴工作流，不得复制其代码、品牌、素材、二进制或受保护设计资产。不得为了展示原创性重写已有稳定能力，也不得为了假想未来需求引入大型新框架。

### 4.9 项目经理主动收口规则（项目所有者明确确认）

项目所有者提供新事实、执行报告、实机反馈或路线偏好后，项目经理必须自行完成所有安全且明显的后续动作：判断其对当前主题的影响、核对必要证据、立即更新本台账和当轮台账、调整后续顺序，并给出下一步可复制指令；不得要求项目所有者逐句提醒“记台账”“继续”“给任务书”。

每次执行 AI 到达等待复审节点时，固定流程为：**独立复审 → 记录结论与证据边界 → 明确批准/驳回/限定整改 → 更新台账 → 给出下一条行动指令**。该流程不需要项目所有者再次催促。

只有以下事项必须等待项目所有者明确授权：push、删除或大规模移动文件、发行/打包/部署、明显超出当前路线的新大主题、不可逆数据操作、外部付费或高成本运行。除此之外，项目经理应主动完成项目内安全的收口工作。

### 4.10 底层引擎候选缺口审计（2026-08-13；不改变当前施工）

只读报告已核对：`C:\Users\Equinox\Desktop\SURDET-ENGINE-NEXT-CANDIDATES-AUDIT-2026-08-13.md`，`23,811` bytes，SHA-256：`35C708E0740EDA58F10DA8CF6795DC2127943220E21189EAA50928DE15C85E65`。报告基准为历史快照 `7cc7a3283de10f357226669f1f303eaf032b8171`；当前“存档备份与显式恢复 Wave 1”已在 Task 4，故不得打断或平行启动候选项。

审计候选的当前处理决定：

1. **回退 perform() 失败后表现/解释器不一致：延期，不开工。** 源码失败分支存在，但没有当前真实红灯；项目所有者此前已对 Wave 5C 部署报告“成功通过”。除非黑屏、空世界或回退失败重新出现，否则不得为理论失败路径再改回退代码。
2. **listMeta phantom meta：登记为当前 Wave 1 的复审检查项。** 当前备份恢复任务本来就涉及主档、备份和 index 的一致性；复审时必须确认最终实现是否已证明“索引存在但主档缺失”不会向玩家呈现可读存档。若没有覆盖，才作为后续单独的小型 Shell/存档一致性任务候选，不在本轮中途插入。
3. **write 后 index 失败的索引漂移：登记为当前 Wave 1 的复审检查项。** 当前任务已要求恢复事务的主档/index 失败行为；复审时核对其测试是否覆盖该相邻不变量。若未覆盖且无可见错误，优先补最小测试，不先重构生产写入链。
4. **SaveManager.load 再做结构校验：明确不做。** 唯一真实消费者已在解释器入口校验；这是没有当前玩家后果的理论性重复防御。
5. **Profile 损坏静默为新玩家：延期。** 这是现有宽容设计的产品选择；无真实玩家案例、无项目所有者关于“显形提示还是静默恢复”的决定前，不改公共 ProfileStorage 契约。

当前唯一行动仍是完成并复审“存档备份与显式恢复 Wave 1”，随后按既定 11 步人工验收。该审计只提供未来候选顺序，不授权任何额外施工。

### 4.11 Stage 3 恢复边界只读地图（2026-08-13；已登记，不扩大当前 Wave）

只读报告已核对：`C:\Users\Equinox\Desktop\SURDET-STAGE3-RECOVERY-BOUNDARY-MAP-2026-08-13.md`，`34,616` bytes，SHA-256：`516F8E637FC82908B9E294653299F4C23558FFE32456FD4AD1CBB8966F733690`。该报告固定审计快照是历史提交 `2da191cfee3fbec6a506831f49f2c70220c429a0`，不是当前施工 HEAD；其报告的 Wave 1 指的是当时仅修复 `FileSaveStore.list()` 假空结果的 Shell 失败数据可靠性 Wave 1。

报告对 R1–R7 的分类应如实保留：

1. **R1：主档损坏时 `.bak` 没有玩家主动恢复入口**，高影响、合理风险，不是已复现生产 Bug；
2. **R2：`loadSnapshot` 在异常 Presentation restore 时可能半提交**、**R3：autosave 写失败可能走 fatal 覆盖层**，均有源码路径但没有真实玩家复现；
3. **R4：浏览器开发回退吞存储错误**，是仅浏览器开发路径的已证实缺陷；
4. **R5：跨场景回退表现残留**、**R6：turnResumeSnap 异常后静默停滞**，均为尚未证实假说；
5. **R7：槽位文件与索引跨文件写入后列表元数据陈旧**，是无数据丢失的低影响合理风险。

**当前决策：** R1 已被项目所有者明确批准为当前 Stage 3 “存档备份与显式恢复 Wave 1”的目标，不能因为报告在更早时提出“先等待真实坏档案例”的研究性前置门而中止。当前 Wave 仍必须保持“不自动回退、玩家明确点击恢复、失败不污染主档/index/UI”的边界，并以受控故障测试和后续人工验收验证；它不能宣称真实玩家坏档已经发生过。

R2–R7 不进入当前 Wave：R2 不在无真实红灯时重写恢复事务；R3 不在本轮加入 autosave 队列或全局错误架构；R4 仅在未来确有浏览器开发需求时做游戏层局部修复；R5/R6 等待真实症状；R7 保留为当前 Wave 复审时的只读检查项，确认“索引记录存在而主档不存在”不会显示为可读存档即可。报告中关于旧 `2da191c` 快照的文档祖先/索引异常只属历史快照事实，不得当作当前 Git 状态问题。

该报告在登记当时没有授权任何新施工，也没有改变第 4.2 的当前 HEAD、当时 Stage 3 仍待独立复审、`NOT_PUSHED` 与“音频生产冻结”状态；当前复审与限定整改授权以后文 4.16 为准。

### 4.12 每轮对话后的台账维护自检（项目所有者明确确认）

每轮与项目所有者的对话结束前，项目经理必须主动判断本轮是否产生了需要进入长期路线、当前事实、范围边界、暂停项、停止状态或下一步顺序的新信息。

- 如果本轮没有产生项目事实或路线变化，可以不改台账，但必须在内部完成一次“无需更新”的判断；不能因为没有代码提交就机械改写文件。
- 如果本轮产生了新事实、交付报告、实机反馈、任务批准/否决、模型分工、范围调整或新的停止条件，必须先更新台账，再给出下一步；不得只依赖聊天上下文。
- 每次更新台账后，必须完整复查：当前 `HEAD`、`surdet/main` 和 ahead/behind；引用文件是否存在、字节数和 SHA-256 是否匹配；任务状态与提交链是否一致；阶段顺序、音频冻结、禁止 push、禁止越界施工和停止状态是否互相一致；Markdown 标题/代码块/旧表述是否存在结构性错误。
- 复查未通过时，不得把台账称为“已同步”或把下一步交给执行 AI；先修正台账，再报告真实状态。台账本身长期保持未暂存、未提交，除非项目所有者另行授权。

### 4.13 执行 AI 交接（2026-08-13）

项目所有者决定停止使用上一任执行 AI，并由下一任执行 AI 接手。交接文件为 `docs/handoff-20260813-165825.md`，磁盘实测 `13,105` bytes，SHA-256：`294E178603F57EDA90B479F49BD4592CB558F81E6A07DBB8FAD999320D6D16E0`；它以旧执行 AI 第一人称记录当前 Stage 3 的实现提交、正式 Electron harness 阻断、四份失败 artifact、禁止范围和接手后的唯一任务。

执行 AI 更换不改变路线与授权：下一任只能先独立复审并收口 `FORMAL_ELECTRON_SAVE_RESTORE_BLOCKED_BY_HARNESS_MENU_ENTRY`，不得自动进入阶段 4、编辑器、音频、性能、文档治理或 push。交接文件不能覆盖 `AGENTS.md`、本台账、当前任务书、交付报告或项目所有者的最新指令；接任者必须重新读取真实 Git 状态后再施工。

### 4.14 总经理 AI 交接（2026-08-13）

项目所有者决定更换上一任总经理 AI。总经理交接文件为 `docs/handoff-20260813-170533-general-manager.md`，磁盘实测 `17,924` bytes，SHA-256：`AD5958F0870BA917A49FAD9D583FB7723A21732BC1B95B287B6CC91FC8D03DFD`。

该文件从上一任总经理视角记录：项目所有者的沟通和验收偏好、引擎优先路线、音频冻结、当前 16 个未推送提交的组成、Stage 3 的实现与 E2E harness 阻断、后续固定顺序、外部审计的使用边界、不得重复的管理失误，以及下一任总经理接手后的第一项职责。

总经理更换不改变任何施工授权、Git 状态或停止点。下一任总经理必须先读取 `AGENTS.md`、本台账、总经理交接书、执行 AI 交接书和当前 Stage 3 报告，然后自行独立复审 E2E 菜单入口阻断；不得把复审责任交给项目所有者，也不得擅自启动子代理、音频、性能、编辑器、文档治理、push 或部署。

交接文件生成期间，共享工作树于 2026-08-13 17:07 出现非总经理会话写入的 `packages/shell/e2e/save-backup-restore.e2e.mjs` 未提交修改（约 `44 insertions / 7 deletions`）。该 diff 正在增加资产完成等待、输入后双帧呈现等待、运行时 HEAD 和 artifact 身份字段，方向与当前复审线索一致，但尚未提交、尚未验证、归属待确认。接任者必须先确认是否仍有活跃执行会话拥有它；在此之前不得覆盖、暂存、提交或宣称通过。

### 4.15 Stage 3 E2E 独立复审新证据（2026-08-13 17:11）

当前执行会话已确认并拥有上述 runner 修改，未暂存、未提交。磁盘上的 `node --check`、5 个工作区 build、`git diff --check` 均通过；随后只运行了一次 `node packages/shell/e2e/save-backup-restore.e2e.mjs`。该次运行通过了正式窗口标题、48/48 资源加载、标题→新游戏、PlayerShell idle、真实 Escape 打开 `system-menu`、保存、覆盖、读档页、独立恢复按钮命中、恢复动作和恢复后的正常读档关闭；但第一次保存位置、覆盖前位置和恢复后位置均为 `prologue:7`，`第二次保存前剧情位置已变化` 断言失败。

这份证据只证明菜单入口 harness 已被修正到能走到恢复动作，不证明 `.bak` 内容真的把旧位置恢复回来。当前停止状态必须记录为 `FORMAL_ELECTRON_SAVE_RESTORE_BLOCKED_BY_HARNESS_ADVANCE_SEMANTICS`；本轮不再重跑，不改生产恢复逻辑，不进入人工验收、阶段 4、编辑器或其他主题。

### 4.16 总经理独立复审结论与限定整改授权（2026-08-13 17:22）

总经理已独立核对真实 `HEAD`、远端关系、工作树、runner/计划/交付报告 diff、新鲜 artifact 与五份 artifact 的磁盘字节数和 SHA-256。结论为：**有条件批准本轮 E2E harness 修正；不批准 Stage 3 正式 Electron 路径通过。** 新鲜 artifact 的 `status=FAILED`、`runHead=7b37fc93bd339230840317526a9de70b9a2df9f2`、资源 `48/48`、六类错误通道为空以及三个位置均为 `prologue:7` 均与交付报告一致；磁盘 `node --check packages/shell/e2e/save-backup-restore.e2e.mjs`、`git diff --check` 已重新执行并通过。

当前只授权一个极小后续动作：只在 `packages/shell/e2e/save-backup-restore.e2e.mjs` 复用 `player-experience-wave-4.e2e.mjs` 已有的“最多四次真实键盘输入，直到公开剧情位置变化”语义；禁止修改 Core、Renderer、Host、Zero 生产逻辑。修正后先做语法检查与必要的 Shell/Zero 构建，再只运行一次完整正式恢复路径。若路径通过，必须证明第一次保存位置与覆盖前位置不同、备份存在、恢复按钮真实显示并命中、恢复后位置等于第一次保存位置、错误通道为空；若失败，保留新 artifact 并停止，不得循环挑绿或猜测性修改生产逻辑。

本轮复审没有批准部署、人工 11 步验收、阶段 4、编辑器、音频、性能、发行或 push。runner、计划和交付报告仍未暂存、未提交；长期路线台账继续保持未跟踪、未暂存、未提交。

### 4.17 项目所有者重新确认的总经理与执行纪律（2026-08-13 17:25）

项目所有者转达上一任总经理的完整管理嘱托并明确要求新任总经理记住。该嘱托与本台账现有路线一致，不改变当前 Stage 3 限定整改授权；以下内容作为长期管理约束继续生效：

1. 正式《零点之后》的真实玩家现象是一手证据；自动化未复现时先审计测试入口、等待、可见画面、真实输入和截图读回，但不因一次现象猜测性修改生产代码。固定顺序是“真实路径记录 → 最小复现 → 区分公共引擎问题与游戏内容问题 → 正确层修复 → 匹配症状的自动化 → 人工实机复测”。
2. “增加防护”“协议未复现”“单元测试通过”“内部状态变化”“按钮可点击”“音量达标”都不得分别冒充“玩家 Bug 已修复”“根因已排除”“正式 Electron 路径通过”“画面已刷新”“功能完成”或“音乐听感合格”。报告必须区分已验证事实、合理推断、尚未验证假说、阻断点和需要谁确认。
3. 执行 AI 每轮固定按 Task 0–6 纪律工作：读取权威材料与真实基线；建立最小红灯或记录玩家复现；最小范围修复；运行匹配风险的聚焦测试、类型检查、构建和真实路径；更新 Execution Ledger 与交付报告；从磁盘重新读取 HEAD、工作树、路径、字节数和 SHA-256；最后停在 `WAITING_FOR_REVIEW`。没有实际运行的命令不得写成通过。
4. 新事实必须及时进入当轮任务台账和长期路线台账，并记录时间、HEAD、远端关系、工作树、实际修改、实际命令、artifact/哈希、状态、未解决问题和停止点。报告、计划、台账和真实 Git 必须一致；任何过时文件必须明确标记为历史资料，不得继续伪装成当前权威状态，也不得为形式完整反复制造无意义文档提交。
5. 总经理负责认可玩家复现、批准下一 Task/Wave、push、部署、打包、发行、接受有限结论和调整长期优先级；执行 AI 只在授权范围内施工、提供真实证据、保持公共层边界，不代替项目所有者填写视觉、声音和手感结论，并在停止点等待复审。
6. 长期路线继续保持：先让底层真实可靠，再逐步扩展现有编辑器与创作能力；音频继续冻结，性能、发行、Legacy 和文档治理继续延期；不为假想用户增加无必要兼容层，也不为理论风险无限扩大测试和防御。宁可明确写“尚未确认”，也不得用与症状不匹配的漂亮报告宣布完成。

### 4.18 台账写权限分离（项目所有者明确确认；2026-08-13 17:31）

> **2026-09-07 衔接：** 下方为原权限记录。当前由项目所有者委托的云端负责人维护路线与已核实结论；执行者不得自行改路线。项目所有者要求把云端修订稿原样同步到同一路径时，按第 9.9 节执行，不把机械同步误解成执行者获准独立裁决或将台账加入 Git。

从本条生效起，施工事实记录权与项目路线裁决权严格分离：

- **执行 AI 可以且必须修改当轮任务书中的 `Execution Ledger` 和当轮交付报告。** 它负责记录开工时间、基线 HEAD、远端关系、工作树、实际修改、红灯、绿灯、命令结果、提交、artifact、字节数、SHA-256、阻断点、未证明事项和停止状态。
- **执行 AI不得修改本文件 `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`。** 本文件对执行 AI 是只读权威资料；不得编辑、覆盖、暂存、提交、删除或移动。执行 AI 若认为长期状态需要变化，只能在交付报告末尾列出“建议由总经理登记的事实”，不得自行把建议、实现状态或测试结果升级为阶段批准、路线变化或下一主题授权。
- **长期路线台账只由总经理在独立复审后修改。** 总经理负责把已核实的执行事实、项目所有者反馈、批准/否决、冻结项、人工验收条件、下一步顺序以及 push/部署/发行边界写入本文件，并保持它未跟踪、未暂存、未提交，除非项目所有者另行明确授权。
- 这一权限分离立即适用于当前 Stage 3：执行 AI 可以继续更新 `2026-08-13-save-backup-and-explicit-recovery-wave-1.md` 和对应交付报告，但不得再更新本长期台账。此前已经由执行 AI 写入的事实不自动失效；其后续真实性由总经理复审和本台账后续记录负责。

### 4.19 Stage 3 并行执行动态快照（2026-08-13 17:33；尚待最终报告和独立复审）

在总经理记录 4.18 权限分离期间，共享工作树由执行 AI推进到新的本地提交：`fc82f5cebcdfb84438d10a3b9b6616664e82ba49`（`test(shell): use semantic advance for backup restore e2e`）。该提交只包含 `packages/shell/e2e/save-backup-restore.e2e.mjs`，当前相对 `surdet/main` 为 `17 0`；当轮任务计划和交付报告仍有未提交修改，长期路线台账继续未跟踪。

磁盘已出现 `C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-l5qflh\save-backup-restore.json`，实测 `1,097` bytes、SHA-256 `D078476A7379FDFBD80F7147DAABFD8D7BB54068837CB07704B94D9385BC692F`。其内容记录 `status=PASSED`、`runHead=fc82f5cebcdfb84438d10a3b9b6616664e82ba49`、资源 `48/48`、恢复目标可见、位置 `prologue:7 → prologue:8 → prologue:7`、六类错误通道为空。以上是磁盘动态事实，不等于总经理已批准 Stage 3 完成。

当前正确停止边界是：等待执行 AI 完成当轮任务台账与交付报告、停止在 `WAITING_FOR_REVIEW` 并提交完整报告；随后由总经理独立核对提交、diff、命令证据和 artifact，再决定是否批准部署进入项目所有者的 11 步人工验收。当前仍未批准部署、人工验收、阶段 4、编辑器、音频、性能、发行或 push。执行 AI 从收到 4.18 权限指令起不得再修改本长期台账。

### 4.20 Stage 3 正式 Electron 路径第一次文档收口（2026-08-13 17:35；历史中间快照）

依据总经理本轮“成功后更新长期路线台账”的明确命令，登记以下已经从命令输出和磁盘重新读取的事实：

- 本轮唯一代码修改文件是 `packages/shell/e2e/save-backup-restore.e2e.mjs`；没有修改 Core、Renderer、Host、Shell 生产代码或 Zero 生产代码，没有触碰存档 schema、migration、兼容层、音频、美术、Gallery、回退黑屏、Ghost Choice、编辑器、性能、发行或部署。
- runner 先通过 `node --check`、`git diff --check`、`npm run build -w @surdet/shell` 和 `npm run build -w zero-after-midnight`，随后精确暂存 runner 并创建普通本地提交：`fc82f5cebcdfb84438d10a3b9b6616664e82ba49`（`test(shell): use semantic advance for backup restore e2e`）。
- 提交后只运行了一次 `node packages/shell/e2e/save-backup-restore.e2e.mjs`，使用正式 `E:\surdet\examples\zero-after-midnight\dist` 和独立临时 `userData`。正式资源 `total=48`、`completed=48`、`failed=0`；恢复目标公开可见并由真实鼠标动作命中；page、console、request、unhandled、renderer、release 六类错误通道均为空。
- 新鲜 artifact 为 `C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-l5qflh\save-backup-restore.json`，磁盘实测 `1,097` bytes，SHA-256 `D078476A7379FDFBD80F7147DAABFD8D7BB54068837CB07704B94D9385BC692F`，`status=PASSED`，`runHead=fc82f5cebcdfb84438d10a3b9b6616664e82ba49`。
- 公开位置证据为 `firstSavePosition=prologue:7`、`secondSavePosition=prologue:8`、`restoredPosition=prologue:7`；恢复后位置与覆盖前位置不同。由此正式自动化路径状态更新为 `FORMAL_ELECTRON_SAVE_RESTORE_VERIFIED`，并非人工视觉、声音或手感验收结论。
- 当前 `CODE_EVIDENCE_HEAD=fc82f5cebcdfb84438d10a3b9b6616664e82ba49`，`ARTIFACT_HEAD=fc82f5cebcdfb84438d10a3b9b6616664e82ba49`，两者一致；文档收口提交后重新读取的 `DOCUMENT_CLOSURE_HEAD=13feb42e76a8f6d02b6040c2ffcc37d67b9fb9fb`。
- 文档收口后的真实 Git 基线为：分支 `main`；`HEAD=13feb42e76a8f6d02b6040c2ffcc37d67b9fb9fb`；`surdet/main=7c4a0059204e927061a67b2005da0036d056409e`；`git rev-list --left-right --count HEAD...surdet/main = 18 0`；`git diff --check` exit `0`；`git ls-files '*.log'` 为空。工作树只有既有未跟踪的 AGENTS、交接/艺术文件、handoff 文件和本长期路线台账，计划/报告已提交且无未提交 tracked diff。
- 文档收口后重新读取：任务计划 `12,943` bytes，SHA-256 `234548926AE2199108ABA09863A973C82024000CB95981801BB260472AADBC8A`；交付报告 `12,045` bytes，SHA-256 `D54C449573923596F3ED4E6B2C02D4A53B636594F1D448EAC009A2E20A5215DA`；新鲜 artifact `1,097` bytes，SHA-256 `D078476A7379FDFBD80F7147DAABFD8D7BB54068837CB07704B94D9385BC692F`。
- 尚未解决/尚未证明：项目所有者人工 11 步实机验收、视觉/声音/手感结论、部署结果、远端 push 结果。当前不把自动化通过写成人工通过，不进入阶段 4。
- 当前停止点：`WAITING_FOR_REVIEW` / `NOT_PUSHED` / `NOT_DEPLOYED` / `STAGE_4_NOT_STARTED`。长期路线台账仍未跟踪、未暂存、未提交。

### 4.21 Stage 3 正式 Electron 自动化独立复审结论（2026-08-13 17:47）

结论：**批准 Stage 3“存档备份与显式恢复 Wave 1”的正式 Electron 自动化路径；尚未批准人工验收、部署、阶段 4 或 push。**

- 真实 Git：分支 `main`；`HEAD=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；`surdet/main=7c4a0059204e927061a67b2005da0036d056409e`；`HEAD...surdet/main=19 0`；tracked 工作树干净，暂存区为空，`git diff --check` 通过，tracked `.log` 为 `0`。
- 代码证据提交：`fc82f5cebcdfb84438d10a3b9b6616664e82ba49`，只修改 `packages/shell/e2e/save-backup-restore.e2e.mjs`；磁盘 `node --check` 新鲜通过，没有生产代码修改。
- artifact：`C:\Users\Equinox\AppData\Local\Temp\surdet-save-backup-restore-l5qflh\save-backup-restore.json`，磁盘实测 `1,097` bytes、SHA-256 `D078476A7379FDFBD80F7147DAABFD8D7BB54068837CB07704B94D9385BC692F`；`status=PASSED`、`runHead=fc82f5cebcdfb84438d10a3b9b6616664e82ba49`、资源 `48/48`、恢复目标可见、位置 `prologue:7 → prologue:8 → prologue:7`、六类错误通道和 `failures` 均为空。
- 最终任务计划为 `13,711` bytes、SHA-256 `D87E82F571DE2940A17CCCED85632A969574B4B3997CD560A0F9A714D2854A6F`；最终交付报告为 `13,934` bytes、SHA-256 `D7E9AC50035FCE4DC4BD231E3D787133ADE8E2FACBF71F58C109BFB1B46A97B7`；文档均明确区分自动化通过与人工验收尚未开始。
- 本地出现两次同名文档提交：`13feb42e76a8f6d02b6040c2ffcc37d67b9fb9fb` 是执行 AI在收到最新台账权限指令前的第一次收口；`5994ec7bd64b2106da6e47cd86e88fb4df82ed01` 只对同一任务计划和交付报告补齐治理措辞并成为最终 `DOCUMENT_CLOSURE_HEAD`。两次提交均只包含这两份 Stage 3 文档，没有夹带生产代码或长期路线台账。该重复不理想但不影响证据，不为整理历史执行 rebase、squash 或 amend。
- 五份历史失败 artifact 均仍存在且字节数、SHA-256 与报告一致；没有删除或覆盖失败证据。执行 AI在收到权限分离指令后没有继续修改、回滚、暂存或提交本长期路线台账。

当前下一步需要项目所有者的新明确授权：把最终被测代码/文档基线部署为正式《零点之后》供人工验收，并按 `C:\Users\Equinox\Desktop\SURDET-FOUNDATION-PLAYER-ACCEPTANCE-DRAFT-2026-08-13-glm52.md` 的 11 步实测。项目所有者只需报告异常，不必逐项报告通过。未经该授权，不部署、不进入人工验收、不开始阶段 4。

### 4.22 项目所有者沟通偏好（2026-08-13 17:47）

项目所有者明确希望总经理沟通更温柔。总经理应先承担技术判断、复审和台账收口，再用平和、简明、没有压迫感的语言告诉项目所有者结论与下一步；不把日志、测试矩阵或架构裁决推回给项目所有者。需要人工验收时，只请求其报告异常步骤、操作路径、可见现象和必要截图，不要求逐项证明“通过”，也不用冷硬流程措辞增加负担。温柔不等于降低证据标准：不确定仍诚实写明，不用安慰性措辞掩盖风险。

### 4.23 项目所有者批准部署并开始人工验收（2026-08-13 17:51）

项目所有者明确授权：“可以部署，开始人工验收”。总经理据此批准把已经独立复审通过的本地基线部署为正式《零点之后》开发版 Electron 窗口，供项目所有者按桌面上的 11 步清单实机体验。

- 部署基线：分支 `main`；`HEAD=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；`surdet/main=7c4a0059204e927061a67b2005da0036d056409e`；`HEAD...surdet/main=19 0`。代码与自动化 artifact 的证据提交仍为 `fc82f5cebcdfb84438d10a3b9b6616664e82ba49`。
- 授权动作仅包括：按依赖顺序构建 Core、Renderer、Host、Shell 和 `zero-after-midnight`，检查正式 dist 入口，再启动一个可见的 Electron 开发部署窗口；人工验收清单为 `C:\Users\Equinox\Desktop\SURDET-FOUNDATION-PLAYER-ACCEPTANCE-DRAFT-2026-08-13-glm52.md`。
- 项目所有者只需报告异常步骤、触发动作、实际现象和必要截图，不必逐项报告通过。视觉、声音和手感结论仍由项目所有者本人判断；当前临时程序占位音的艺术质量不属于本轮通过条件，只确认是否可听见这一技术基线。
- 本授权不包括 push、force push、正式打包、发行、阶段 4、编辑器扩展、音频生产、性能资格化、Legacy 或文档治理。人工验收结果返回前，不宣布 Stage 3 最终完成，也不自动进入下一主题。

授权登记时状态为：`DEPLOYMENT_AUTHORIZED_BY_OWNER` / `DEPLOYMENT_IN_PROGRESS` / `HUMAN_ACCEPTANCE_PENDING` / `NOT_PUSHED` / `STAGE_4_NOT_STARTED`。部署实际结果将在同一条目后续追加，失败时保留现象并停止，不用生产代码猜测性修补。

部署实际结果（2026-08-13 17:53）：

- 在 `HEAD=5994ec7bd64b2106da6e47cd86e88fb4df82ed01` 上按顺序实际运行 `npm run build -w @surdet/core`、`@surdet/renderer`、`@surdet/host`、`@surdet/shell` 和 `zero-after-midnight`，五项均 exit `0`。没有运行 `verify:all`、性能资格化、多轮 Electron E2E、pack 或发行流程。
- 部署入口已从磁盘确认：`packages/shell/dist/main.js` 为 `14,191` bytes、SHA-256 `03CB6EEB1931BF70BF887641E4B4F503DDD4E9610BE3C6191A3E83C7638B3DD5`；`packages/shell/dist/preload.cjs` 为 `2,998` bytes、SHA-256 `2E7CA3B93E1B331C5899E704AFE41B70D3DBAF679FB10762BAD0CE6A27F6C10C`；`examples/zero-after-midnight/dist/index.html` 为 `918` bytes、SHA-256 `7F70132114CD3EFA31E84323355527D7DE36D2DAE4AAD1FDCF38C9D10F076997`。Zero 当前 Vite 输出把配置与内容接入构建资源，`dist` 根目录没有单独复制 `game.config.json`；Shell 的正式开发注入仍以源目录作为 `sourceRoot`，这与已验证路径一致，不是本轮新增红灯。
- 使用临时进程环境 `SURDET_E2E=1` 和绝对 `SURDET_E2E_GAME_DIR=E:\surdet\examples\zero-after-midnight\dist` 启动可见 Electron 开发部署；启动前没有其他 Electron 进程。主窗口 PID 为 `18104`，磁盘进程路径为 `E:\surdet\node_modules\electron\dist\electron.exe`，可见窗口标题已读取为 `零点之后 / AFTER MIDNIGHT`，确认没有误开 Starter。
- 窗口保持打开供项目所有者人工体验。当前状态更新为 `DEPLOYED_FOR_HUMAN_ACCEPTANCE` / `HUMAN_ACCEPTANCE_IN_PROGRESS`。这是开发部署和窗口身份确认，不代替项目所有者的视觉、声音、交互、存读档和恢复体验结论。
- **强制提醒点：** 项目所有者完成体验或报告第一个异常后，总经理必须立即登记真实路径和现象，先判断是否影响 Stage 3，再决定复现或下一步；在收到人工结果前不得宣布本阶段最终完成、不得进入阶段 4，也不得 push、打包或发行。

### 4.24 Stage 3 人工验收通过与阶段收口（2026-08-13 17:56）

项目所有者在正式《零点之后》开发部署窗口中完成桌面验收清单的 11 步路径后，明确反馈：“非常好，全部顺利通过”。该反馈作为本轮视觉、声音技术基线、交互手感以及真实玩家路径的一手验收证据，覆盖启动与标题、新游戏、文本推进、选择、回退、存档、读档与空槽、快速存读档、返回标题、Gallery 和场景切换。验收窗口随后已正常退出；没有报告黑屏、幽灵选择、存读档异常、恢复异常、资源残留、输入卡住或其他可见问题。

据此，Stage 3“存档备份与显式恢复 Wave 1”完成以下闭环：公共生产实现与聚焦测试通过；正式 Electron 自动化以真实输入证明 `prologue:7 → prologue:8 → prologue:7` 的备份恢复语义；总经理独立复审批准；项目所有者 11 步人工验收全部通过。当前可以将该 Wave 标记为 `STAGE_3_COMPLETED` / `HUMAN_ACCEPTANCE_PASSED_BY_OWNER`，但这不代表整个项目已经发行就绪，也不改变占位 BGM 的艺术质量已被否决和音频生产冻结状态。

既定路线的下一步是 **Stage 4：阶段性确认地基稳定**。Stage 4 应是一轮适度的综合确认，而不是重复 11 步人工验收或建立大型测试矩阵：复用当前人工通过事实，补齐 Core、Renderer、Host、Shell 的受影响聚焦门禁和少量真实 Electron 证据，整理仍未解决的体验问题与证据缺口，以判断是否足够稳定进入 Stage 5 可视化编辑器最小创作闭环。没有新红灯时不修改生产代码。

以下是 4.24 登记当时的历史停止状态，已由后文 4.25 的项目所有者新授权 supersede：当时尚未授权 Stage 4 开工、制作任务书或派发执行 AI，也未授权 push；当时停止点为 `STAGE_4_AUTHORIZATION_PENDING_OWNER`。打包、发行、音频生产、性能资格化和文档治理至今仍未授权。

### 4.25 项目所有者批准普通 push 与 Stage 4 任务书（2026-08-13 17:56）

项目所有者明确决定：“要不还是 push 吧，以后再替换音频就行”，并同时下达“批准进入 Stage 4，请制作任务书”。该决定解除 4.4 针对当前提交链的 push 阻断，并取代 4.24 的 Stage 4 待授权状态。

- **普通 push 授权：** 允许把当前 `main` 上相对 `surdet/main` 领先的 19 个既有本地提交整体推送到远端 `surdet/main`。项目所有者明确接受其中三个 BGM Wave 1 提交作为临时可听占位音进入远端，未来通过新的普通提交替换音频；不得把这些占位音写成艺术质量通过或正式音乐完成。
- push 前必须先执行只读/非改史预检：核对分支、HEAD、tracking remote、远端 URL、工作树、暂存区、19 个提交及文件范围，并 fetch 确认远端没有新增提交。只允许 fast-forward 普通 push；若远端变化、需要 rebase/merge/force、出现未归属 tracked 修改或目标不是 `surdet/main`，立即停止并报告，不自行改史。
- 未跟踪的 `AGENTS.md`、受保护文件、handoff 和本长期路线台账不进入 push；不得为 push 暂存或提交它们。该授权不包括 force push、rebase、reset、amend、squash、删除、打包、部署或发行。
- **Stage 4 授权：** 总经理现在制作 `docs/superpowers/plans/2026-08-13-foundation-stability-stage-4.md`，任务只做阶段性地基稳定确认：复用刚完成的 11 步人工通过事实，执行受影响聚焦门禁和极少量正式 Electron 路径，整理证据缺口；没有新红灯时不修改生产代码。
- Stage 4 不启动音频生产、编辑器功能、性能资格化、发行、Legacy 或文档治理，不重复 11 步人工验收，不建立大型测试矩阵。执行 AI必须更新该任务书的 `Execution Ledger` 和对应交付报告，但不得修改本长期路线台账；完成本地普通提交后停在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`，不得再次自行 push。

授权登记当时的历史中间状态为：`PUSH_AUTHORIZED_BY_OWNER` / `PUSH_PREFLIGHT_PENDING` / `STAGE_4_AUTHORIZED` / `STAGE_4_TASK_BOOK_IN_PROGRESS`。该中间状态已由下方 push 与任务书实际结果 supersede。

普通 push 实际结果（2026-08-13 18:00）：

- push 前执行 `git fetch surdet main` 后，`HEAD=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`、`surdet/main=7c4a0059204e927061a67b2005da0036d056409e`、`HEAD...surdet/main=19 0`；`git merge-base --is-ancestor surdet/main HEAD` exit `0`，证明目标是纯 fast-forward。
- 19 个提交及 41 个文件的范围已逐项读取；十首 BGM WAV、音频审计/基线、Core 数据一致性、Shell 失败传播、Stage 3 显式恢复、E2E harness 与对应计划/报告均与授权范围一致。tracked 工作树和暂存区为空；未跟踪的 `AGENTS.md`、受保护文件、handoff 和本长期路线台账未被暂存或提交。
- 实际执行 `git push surdet main:main` 成功，远端输出为 `7c4a005..5994ec7  main -> main`。随后再次 fetch 并读取：本地 `HEAD` 与 `surdet/main` 均为 `5994ec7bd64b2106da6e47cd86e88fb4df82ed01`，ahead/behind 为 `0 0`；`git diff --check` 与 `git diff --cached --check` 均通过。
- 没有 force push、rebase、reset、amend、squash、merge、删除、打包、部署或发行。当前远端闭环状态为 `PUSH_COMPLETED` / `LOCAL_REMOTE_SYNCED`。占位音频只作为临时可听基线进入远端，未来必须用新的普通提交替换，不回写历史。

Stage 4 任务书实际结果（2026-08-13 18:04）：

- 已创建 `docs/superpowers/plans/2026-08-13-foundation-stability-stage-4.md`，磁盘实测 `18,524` bytes、SHA-256 `7C906CF2B7BDFE4C0447602A409F8F11CE281318A1C5AC29B3B682AC4BFDDFBB`，共 `415` 行，Markdown fence 数为偶数 `44`，placeholder 扫描为空，`git diff --check` 通过。
- 任务书将 Stage 4 固定为只读验证与证据收口：五组跨层聚焦测试、一次 Zero 内容模拟、五工作区 typecheck、Wave 4 runner 语法/合同，以及只运行一次正式 Electron `--case F`。Case F 失败时保留 artifact 并立即停止，不改生产代码、不改测试或 harness、不循环重跑。
- Stage 3 显式恢复 artifact 与项目所有者 11 步人工验收作为既有证据复用，不重复运行显式恢复 E2E，也不要求项目所有者再次人工验收。没有新红灯时，本轮只允许修改 Stage 4 任务书和对应交付报告。
- 任务书禁止 `verify:all`、性能/多轮 Electron 矩阵、Wave 5A 大截图协议、音频生产、编辑器施工、pack、发行和本轮结束后的 push。执行 AI只能在完成后创建一个计划+报告的普通本地文档提交，并停在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`；是否批准 Stage 5 仍由总经理决定。
- 当前任务书保持未跟踪、未暂存、未提交，等待执行 AI接手后按 Task 0–6 更新并在最后与交付报告共同提交。长期路线台账继续由总经理单独维护，不进入该提交。

### 4.26 Push 后 GitHub Actions 账单阻断诊断（2026-08-13 18:07）

项目所有者收到 `CL:ALL jobs have failed` 邮件并担心 push 未成功。总经理已通过本地 Git、`git fetch`、GitHub CLI run/job/check-run API 独立核对：**push 已成功；失败的是 push 后触发但未能启动的 GitHub Actions job。**

- 远端身份：本地 `HEAD` 与 `surdet/main` 均为 `5994ec7bd64b2106da6e47cd86e88fb4df82ed01`，ahead/behind `0 0`。GitHub run `31689141731` 的 `headSha` 也是同一提交，直接证明远端已收到本次 push。
- 当前 run：`https://github.com/Equinox7379/Surdet/actions/runs/31689141731`；workflow `CI`；job `verify`；job id `94412149899`；状态 `failure`。job 从 `2026-08-13T10:00:12Z` 到 `10:00:15Z` 即结束，`steps=[]`、`runner_id=0`、runner 名称为空，`gh run view --log` 与 `--log-failed` 均返回 `log not found`。
- GitHub check annotation 原文为：`The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings`。这表示 checkout、Node setup、`npm ci`、`npm run verify:all` 和 P1/P2 policy 一个都没有执行。
- 上一远端基线 `7c4a0059204e927061a67b2005da0036d056409e` 的 run `31669830498`、job `94351976181` 也具有相同 `steps=[]` 和同一账单 annotation，证明该阻断早于本次 19 提交 push，不是这些提交新引入的代码回归。
- 结论严格区分为：`PUSH_COMPLETED` / `REMOTE_COMMIT_PRESENT` / `GITHUB_ACTIONS_NOT_STARTED_DUE_TO_BILLING` / `NO_REMOTE_TEST_RESULT`。不得写成“push 失败”或“CI 测试发现代码失败”。
- 当前不修改 workflow、不重跑、不再次 push，也不要求项目所有者处理代码。若希望恢复 GitHub 自动检查，需要项目所有者在 GitHub `Settings → Billing & plans` 处理付款方式或提高 Actions spending limit；这是账户设置，不属于代码施工。Stage 4 已计划的本地聚焦测试仍可继续，并会提供当前代码的实际验证证据。
- 项目所有者随后确认：Actions 额度确已耗尽，额度主要服务于经常通过 GitHub Actions 更新到公网的网站；Surdet 引擎项目当前不涉及该公网更新链。总经理据此裁决：不要求为 Surdet 立即充值、提高额度、修改 workflow 或补跑远端 CI；本次红叉登记为已知外部基础设施限制，不是 Stage 4 阻断。未来若 Surdet 进入正式发行或把远端 CI重新设为强制门禁，再单独恢复 Actions 额度并取得一轮真实远端结果。

### 4.27 Stage 4 地基稳定性独立复审结论（2026-08-13 18:24）

总经理已独立读取 Stage 4 任务书、交付报告、真实 Git 提交和磁盘 artifact，并批准本轮“阶段性确认地基稳定”的证据收口。该批准只覆盖 Stage 4 的本地验证结论，不自动批准 Stage 5、编辑器施工、部署、发行或任何新的主题。

- **提交与范围核对：** 当前分支为 `main`；Stage 4 文档提交 `a4789271860fa6b82f91803253b2ab2d7ddfe333`（`docs(engine): record foundation stability stage 4`）只新增 `docs/superpowers/plans/2026-08-13-foundation-stability-stage-4.md` 和 `docs/ENGINE-FOUNDATION-STABILITY-STAGE-4-DELIVERY-REPORT-2026-08-13.md` 两份文档，共 667 行；没有生产代码、测试、runner、harness、配置、资产或其他主题文件变动。该提交尚未 push，当前相对 `surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01` 为 `1 0`。
- **本地验证事实：** 五组 Core/Renderer/Host/Shell/Zero 聚焦测试共 `23` 个文件、`233` 个测试全部 exit `0`；Zero `simulate` exit `0`；五个受影响工作区 typecheck 全部 exit `0`；Wave 4 runner 语法检查与合同测试全部 exit `0`。这些命令均由执行 AI 在本轮实际运行，报告没有把未运行的全仓库门禁或远端 CI 写成通过。
- **正式 Electron 证据：** 按任务书只运行一次 `node packages/shell/e2e/player-experience-wave-4.e2e.mjs --case F`，exit `0`。artifact `C:\Users\Equinox\AppData\Local\Temp\surdet-player-experience-wave-4-V3KqS8\player-experience-wave-4-1786615968531.json` 磁盘实测 `60,488` bytes、SHA-256 `929E9552A34456AF2194B01C05C2D47A0A1D27947BF028A60BD7E0D6FC83A339`，`status=PASSED`，`head=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；资源 `48/48`，六类错误通道为空，窗口未异常关闭。公开位置证据为 `prologue:7 → common_0017:18`，读档后两次均回到 `common_0017:18`，并完成两轮世界状态扰动与回读。
- **证据边界：** Stage 3 的正式存档备份恢复 artifact 已重新核对且仍为 `status=PASSED`；项目所有者此前完成的 11 步人工验收作为既有事实复用，没有在 Stage 4 重复要求人工验收。Stage 4 证明的是当前底层稳定性证据达到进入下一阶段的门槛，不等于编辑器创作闭环已经完成，也不等于远端 CI 有新结果。远端 Actions 仍受 4.26 所记账单/额度限制，未作为本轮本地结论的替代物。
- **文档磁盘身份：** Stage 4 任务书 `28,379` bytes，SHA-256 `A5126A7547DD6A557778BB693C6AA31BD1EA37B2011419EA9E458CEFF822C7F9`；交付报告 `12,402` bytes，SHA-256 `3319C31545C60DD1EAF02E81603BF8A54FCEEBC2E29D1DE415B34887BC5EBD6B`。两份文件与提交内容一致，`git diff --check`、暂存区检查和 tracked `.log` 检查均通过；工作树只保留既有未跟踪文件和本长期路线台账。
- **当前裁决与停止点：** `STAGE_4_FOUNDATION_STABILITY_VERIFIED` / `MANAGER_REVIEW_APPROVED` / `STAGE_5_NOT_STARTED` / `STAGE_5_AUTHORIZATION_PENDING_OWNER` / `NOT_PUSHED_AFTER_STAGE_4`。下一步只有在项目所有者明确授权后，才制作并执行 Stage 5 现有可视化编辑器最小创作闭环任务书；在此之前不 push 当前 Stage 4 文档提交，不进入编辑器施工。

### 4.28 项目所有者批准 Stage 5 任务书（2026-08-13 18:29）

项目所有者明确回复“批准”，确认进入路线中既定的 Stage 5：**现有可视化编辑器的可信手验收与局部修复**。本次授权的目标严格限定为验证现有“改一句台词 → 预览 → 保存 → 重开仍存在”最小创作闭环；不从零重造编辑器，不提前扩展角色/Gallery/资产管理、时间轴演出、调试、协作、云同步或插件系统。

- 总经理先制作任务书 `docs/superpowers/plans/2026-08-13-editor-minimum-authoring-loop-stage-5.md`，并由执行 AI按其中 Task 0–6 执行。任务书要求先读取权威材料和真实基线，先跑现有编辑器聚焦测试、typecheck 和 build，再准备隔离的临时项目供项目所有者实机走最小闭环。
- 默认只做验证和证据收口，不修改生产代码。只有项目所有者实际路径暴露出可重复问题，执行 AI才可在 `packages/editor` 内建立匹配红灯并做最小局部修复；不得因为自动化没有覆盖视觉/手感就猜测性改 Core、Renderer、Host、Shell 或 Zero。
- 执行 AI必须把真实路径、可见现象、磁盘保存结果、重开后的内容和任何失败证据写入当轮任务台账与交付报告；不得把“编辑器能启动”或“内部状态变了”写成创作闭环通过。完成本轮后创建普通本地提交并停止在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`，不得自行 push、部署、打包或进入下一主题。

本次授权登记后的状态为：`STAGE_5_AUTHORIZED` / `STAGE_5_TASK_BOOK_IN_PROGRESS` / `STAGE_5_EXECUTION_NOT_STARTED` / `NOT_PUSHED_AFTER_STAGE_4`。Stage 4 文档提交仍保持本地领先远端 1 个提交，暂不推送；长期路线台账继续由总经理维护，未跟踪、未暂存、未提交。

### 4.29 Stage 5 任务书制作完成（2026-08-13 18:35）

总经理已按 4.28 授权制作 Stage 5 任务书，文件为 `docs/superpowers/plans/2026-08-13-editor-minimum-authoring-loop-stage-5.md`。任务书只覆盖现有编辑器的“改一句台词 → 预览 → 保存 → 重开仍存在”闭环：先运行编辑器现有聚焦测试、typecheck 和 build，再用 `%TEMP%` 隔离的 Starter 副本供项目所有者在 Chrome/Edge 中真实操作；没有玩家异常时不改代码。

- 任务书已从磁盘重新读取：`19,359` bytes，SHA-256 `A501C778838C37D5A933613A7894605B3FCEFF9DAAB21D4B58579E3B3884AFB3`；包含 Task 0–6、文件白名单/禁区、真实浏览器步骤、磁盘字节数与 SHA-256 证据要求、人工验收边界和本地提交停止状态；placeholder 扫描为空，`git diff --check` 通过。
- 执行 AI 可以更新该任务书的 Execution Ledger 和对应交付报告；只有项目所有者报告可重复异常时，才可在 `packages/editor/src/**` 与 `packages/editor/test/**` 内做最小局部修复。执行 AI不得修改本长期路线台账，不得触碰 Core/Renderer/Host/Shell/Zero，不得创建新 E2E harness，不得 push、部署、打包或进入 Stage 6。
- 当前未派发执行 AI，未启动编辑器服务器，未创建隔离 fixture，未进行 Stage 5 测试或人工验收。本阶段仍是任务书已就绪而非功能已通过。

本条目将状态更新为：`STAGE_5_AUTHORIZED` / `STAGE_5_TASK_BOOK_READY` / `STAGE_5_EXECUTION_NOT_STARTED` / `NOT_PUSHED_AFTER_STAGE_4`。下一停止点是把任务书交给执行 AI；执行 AI 完成本地提交后必须停在独立复审，不能自行推进 Stage 6。

### 4.30 Stage 5 执行到达项目所有者真实浏览器验收停止点（2026-08-13 18:50）

总经理已独立核对执行 AI 当前任务书 Execution Ledger、真实 Git 基线、隔离 fixture、预览服务器和现有测试红灯。结论：**不批准 Stage 5 完成；批准保持在项目所有者真实浏览器验收等待点。** 当前没有 editor 源文件、editor 测试、Core、Renderer、Host、Shell、Zero 或原始 Starter 内容的修改，没有提交，也没有 push。

- **基线与范围：** 分支 `main`；`HEAD=a4789271860fa6b82f91803253b2ab2d7ddfe333`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`1 0`；tracked 工作树无既有修改，暂存区为空，tracked `.log` 为 `0`。Stage 5 任务书已由执行 AI追加真实 Execution Ledger，但仍是未跟踪文件；磁盘实测 `26,929` bytes、SHA-256 `08152C293B96FFD98AF89DAF020110CC9A5FD98756F160047C79CDB15D5488E9`。交付报告尚未创建，符合“人工结果前不写最终报告”的停止要求。
- **Task 2 证据：** 执行 AI实际运行 editor test、typecheck、build；typecheck 与 build 报告为 exit `0`，build 仅报告已知 preview bundle 大小提示（没有调整性能门限）。editor 全量测试报告为 exit `1`：21 个测试文件中 20 个通过、1 个失败；142 个测试中 140 个通过、2 个失败，失败集中在 `packages/editor/test/model-roundtrip.test.ts` 的 `ch01_01.gal` 与 `ch02.gal`。总经理又独立重跑该聚焦测试，得到同样 exit `1` 和同样两项失败：实际 Starter 文件包含混合 LF/CRLF，而当前 `parseScript → serializeScript(lines, 单一 eol)` 无法保持逐字节换行布局。该红灯已如实保留，尚未被擅自修复，也不能被 typecheck/build 绿灯掩盖。
- **隔离 fixture 与服务器：** fixture `C:\Users\Equinox\AppData\Local\Temp\surdet-editor-stage5-dfea8432e17f412e9fe0259b9d74945d` 共 `23` 个文件，未复制 `node_modules`、`dist`、`src` 或 `test`；目标文件初始为 `1,035` bytes，SHA-256 `713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`，探针不存在。总经理从磁盘重新读取，确认隔离目标与原始 `E:\surdet\examples\starter\content\scenario\ch01_01.gal` 当前字节数与 SHA-256 完全一致，原始 Starter 未被写入。预览服务器 PID `45380` 仍在运行，`http://127.0.0.1:4173/` 返回 `200`，标题为 `Surdet 剧本编辑器`，监听绑定为本机地址；日志仍保留在 fixture 外的临时目录。
- **证据边界：** 当前只证明入口可访问、项目副本未污染、编辑器的静态构建可用，以及存在一个既有模型换行红灯；尚未证明真实浏览器里探针文字显示、保存状态、磁盘写入或刷新重开后的持久化。HTTP `200` 和服务器存活不能替代真实页面操作；模型换行红灯也不能直接推断预览或保存闭环必然失败，但在 Stage 5 完成复审时必须继续明确列出。
- **当前唯一动作：** 项目所有者在 Chrome/Edge 打开 `http://127.0.0.1:4173/`，选择上述隔离 fixture，完成任务书 Task 4 的“改一句台词 → 预览看到探针 → 保存并核对磁盘 → 刷新重开仍看到探针”路径。只需报告第一个异常；不要选择原始 `E:\surdet\examples\starter`。在收到真实结果前，执行 AI不得进入 Task 5、不得写最终交付报告、不得提交、不得 push，也不得把测试或服务器通过写成 Stage 5 完成。

本条目将当前状态更新为：`STAGE_5_AUTHORIZED` / `HUMAN_ACCEPTANCE_PENDING_OWNER` / `NOT_PUSHED_AFTER_STAGE_5` / `STAGE_6_NOT_STARTED`。4.29 的“任务书已就绪、尚未执行”是历史中间状态，由本条目 supersede。

### 4.31 Stage 5 人工验收 fixture 改放桌面（2026-08-13 18:58）

项目所有者反馈：系统临时目录中的隔离项目在浏览器目录选择器中打不开。总经理没有删除或覆盖原临时 fixture，而是将其完整复制到用户桌面上的普通目录，供同一个本机编辑器服务器继续进行真实验收。

- 新 fixture：`C:\Users\Equinox\Desktop\surdet-editor-stage5-fixture-20260813-185752`。
- 新 fixture 共 `23` 个文件，未复制 `node_modules`、`dist`、`src` 或 `test`；目标 `content\scenario\ch01_01.gal` 磁盘实测 `1,035` bytes，SHA-256 `713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`，探针仍不存在。
- 新 fixture 与旧临时 fixture 的目标文件字节序列一致；旧临时 fixture 保留不动，原始 `E:\surdet\examples\starter` 仍未写入。此次只是验收资料搬到用户可访问位置，没有修改仓库、编辑器代码、测试、提交或 push。
- 项目所有者下一步应在 Chrome/Edge 的目录选择器中选择新桌面目录，不再选择 `C:\Users\Equinox\AppData\Local\Temp\surdet-editor-stage5-dfea8432e17f412e9fe0259b9d74945d`。本机服务器 `http://127.0.0.1:4173/` 不变。

当前状态保持：`STAGE_5_AUTHORIZED` / `HUMAN_ACCEPTANCE_PENDING_OWNER` / `NOT_PUSHED_AFTER_STAGE_5` / `STAGE_6_NOT_STARTED`。

### 4.32 项目所有者完成 Stage 5 真实浏览器验收（2026-08-13 19:02）

项目所有者在桌面隔离 fixture 中完成了 Stage 5 Task 4 的完整真实路径，并明确反馈：“正常，完全没问题，验收通过咯”。该反馈是本轮编辑器视觉、预览、保存、刷新重开和真实创作体验的一手证据。

- 实际路径为：打开本机编辑器 → 选择桌面隔离项目 → 选中 `ch01_01` → 通过块编辑追加 `[STAGE5-EDITOR-PROBE]` → 在真实“剧情预览”画面看到探针 → 保存 → 刷新并重新打开同一项目 → 再次看到探针且无未保存异常。
- 总经理随后从磁盘重新读取桌面 fixture：`C:\Users\Equinox\Desktop\surdet-editor-stage5-fixture-20260813-185752\content\scenario\ch01_01.gal`，实测 `1,061` bytes、SHA-256 `D72F524173C351867C8A350BE8FB21EFE091D7BB44159FE4737933FEDD1311AE`，探针存在；原始 `E:\surdet\examples\starter\content\scenario\ch01_01.gal` 仍为 `1,035` bytes、SHA-256 `713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0`，探针不存在。由此确认写入发生在隔离副本，不是原始 Starter。
- 这次人工通过不抹掉 Task 2 已知的 `model-roundtrip.test.ts` 两项换行红灯；该红灯仍须在最终 Stage 5 报告中单独列为“已知但未在本轮修复的测试事实”，不能被写成全量测试通过，也不能反过来否定项目所有者已经看到并重开保留的创作结果。
- 当前还没有最终交付报告和 Stage 5 本地提交。下一步只允许执行 AI完成 Task 6：更新任务书 Execution Ledger、创建交付报告、写入上述人工路径和磁盘身份，精确提交任务书+报告，随后停止等待独立复审。不得借此修复换行红灯、修改其他生产代码、push、部署或进入 Stage 6。

当前状态更新为：`STAGE_5_AUTHORIZED` / `HUMAN_ACCEPTANCE_PASSED_BY_OWNER` / `STAGE_5_FINAL_REPORT_PENDING` / `NOT_PUSHED_AFTER_STAGE_5` / `STAGE_6_NOT_STARTED`。

### 4.33 Stage 5 交付物独立复审：主体证据通过，任务台账需补一次提交后回读（2026-08-13 19:12）

总经理已独立核对 Stage 5 任务书、交付报告、桌面 fixture、真实 Git 提交范围和磁盘身份。主体结论成立：项目所有者的真实编辑—预览—保存—刷新重开路径已通过，交付报告中的提交、路径、字节数和 SHA-256 均能在磁盘上复现。

- **已确认：** `HEAD=af2603a9d9afbaebfcdec5a2c570cf998e6e0353`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`2 0`；提交 `af2603a9d9afbaebfcdec5a2c570cf998e6e0353` 只包含 Stage 5 任务书和交付报告两份文档。两份文档磁盘身份分别为任务书 `30,852` bytes / `C7579D7FBB7545E34A5C476DE9276FA4BBE8537A86E74C05359D50CD461CBC1E`，报告 `8,072` bytes / `47F2807F698977F8A1E988168FFCAB9168B566D398E5EF92197D0926AE570A85`。桌面 fixture 保存文件仍为 `1,061` bytes / `D72F524173C351867C8A350BE8FB21EFE091D7BB44159FE4737933FEDD1311AE`，原始 Starter 仍未写入。
- **唯一不一致：** 已提交的 Stage 5 任务书 Execution Ledger 末尾仍写着“Task 6 — Steps 1–2 completed; Steps 3–4 pending commit”，但同一提交和交付报告已经表明 Task 6 的文档提交成功、最终 HEAD 已变为 `af2603a9d9afbaebfcdec5a2c570cf998e6e0353`。这属于提交后任务台账没有补写最终回读事实，不是生产代码问题，也不否定项目所有者的人工验收；但在台账、报告、Git 必须一致的规则下，不能直接把 Stage 5 正式收口写成无条件完成。
- **修正范围：** 只允许执行 AI对 Stage 5 任务书追加一笔“Task 6 Steps 3–4 completed after commit”记录，包含提交后 `git log --oneline -1`、HEAD、远端关系、工作树、暂存区、两份文档字节数/SHA-256 和最终停止状态；创建一个新的普通本地文档提交即可，不得 amend、rebase、squash、push、修改 editor/Core/Renderer/Host/Shell/Zero、重跑人工路径或重新挑选测试红灯。

当前状态暂更新为：`STAGE_5_HUMAN_ACCEPTANCE_VERIFIED` / `STAGE_5_LEDGER_CORRECTION_REQUIRED` / `WAITING_FOR_EXECUTION_AI_DOCUMENT_CORRECTION` / `NOT_PUSHED_AFTER_STAGE_5` / `STAGE_6_NOT_STARTED`。修正提交经总经理重新读取确认后，才能把状态更新为 `STAGE_5_MINIMUM_AUTHORING_LOOP_VERIFIED` / `MANAGER_REVIEW_APPROVED`。

### 4.34 Stage 5 最终独立复审通过（2026-08-13 19:20）

总经理已重新读取任务书和交付报告，核对新文档提交、提交范围、提交后 Execution Ledger、桌面 fixture 以及原始 Starter。此前 4.33 指出的唯一不一致已经由新的普通本地文档提交补齐，Stage 5 正式收口通过。

- **文档更正提交：** `725d510e2af66127f81df1fbde2cfb0d6ab35b16`（`docs(editor): close stage 5 execution ledger`）只修改 `docs/superpowers/plans/2026-08-13-editor-minimum-authoring-loop-stage-5.md`；提交后真实 `HEAD=725d510e2af66127f81df1fbde2cfb0d6ab35b16`，`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`，ahead/behind=`3 0`。任务书 Execution Ledger 已追加提交后 `git log`、HEAD、远端关系、工作树、暂存区、检查命令、文档身份和最终停止状态，报告正文未被改写。
- **最终文档身份：** Stage 5 任务书 `32,667` bytes、SHA-256 `BCAE0EB3A069E62DB6ACE15A88745FF58670C0AB2D19AE70CA9205B5568616C8`；Stage 5 交付报告 `8,072` bytes、SHA-256 `47F2807F698977F8A1E988168FFCAB9168B566D398E5EF92197D0926AE570A85`。两份文件均从磁盘重新读取，提交范围与报告一致。
- **人工闭环与范围：** 项目所有者真实看到探针、保存并刷新重开后仍看到探针；桌面 fixture `1,061` bytes / SHA-256 `D72F524173C351867C8A350BE8FB21EFE091D7BB44159FE4737933FEDD1311AE`，原始 Starter `1,035` bytes / SHA-256 `713414BD2F14C7AF159989115902B3D2067BEB30E428077900D98461D87193E0` 且未写入。没有 editor/Core/Renderer/Host/Shell/Zero 源码或测试修改。
- **未解决边界：** `model-roundtrip.test.ts` 中两个混合 LF/CRLF 逐字节红灯仍然如实保留；它不被写成全量测试通过，也不否定本次已经完成的人工创作闭环。该红灯若未来需要处理，必须另开明确主题，不夹带在本轮 Stage 5 收口中。
- **下一步边界：** 不自动 push、不部署、不进入 Stage 6，也不自动扩大编辑器功能。后续只有在项目所有者提出新的真实创作痛点并明确授权后，才制作下一份定向编辑器任务书；没有新的真实需求时，保持停止即可。

最终状态更新为：`STAGE_5_MINIMUM_AUTHORING_LOOP_VERIFIED` / `HUMAN_ACCEPTANCE_PASSED_BY_OWNER` / `MANAGER_REVIEW_APPROVED` / `NOT_PUSHED_AFTER_STAGE_5` / `STAGE_6_NOT_STARTED`。

### 4.35 项目所有者授权 Stage 5 编辑器架构扩展与必要重构（2026-08-13 19:32）

项目所有者明确要求：以 `C:\Users\Equinox\Downloads\Studio-1.9.7-win` 这一成熟项目为参照，开始 Surdet 编辑器的下一步，并允许“大幅扩展甚至重构编辑器”。该决定满足 4.34 所要求的新编辑器方向与明确授权，当前主线继续属于 **Stage 5 可视化编辑器定向扩展**，不进入 Stage 6。

- **当前目标：** 从成熟项目中提取经过验证的创作工作流、信息架构、模块边界和交互模式，把 Surdet 已有的场景编辑、流程图、时间轴、配置、预览、统计、审计与资产能力演进为更完整、更可持续的创作工作台。允许重构的前提是解决当前扩展所需的真实结构问题，并持续保留已经人工通过的“编辑 → 预览 → 保存 → 重开”闭环；不以视觉相似或文件数量增加作为完成标准。
- **参照项目的初步磁盘事实：** 目标是 LetsGal Studio `1.9.7` 的 Windows Electron 分发包；`resources\app.asar` 根 `package.json` 声明包名 `@avgplus/engine`、版本 `1.9.7`、许可证字段 `MIT`，更新配置指向 `avg-plus/light-engine`。当前公开仓库地址未能从网络取得，分发包内也未发现项目根 `LICENSE` 或源码 source map；因此在官方源码与归属文件重新核实前，只允许观察和借鉴工作流、信息架构、公开 SDK 契约与依赖选择，不直接复制打包后的压缩代码、品牌、素材或 UI 资产。
- **已确认的参照方向：** 成熟项目把创作入口分为剧本、资产、叙事地图、个性化、发布和设置，并在资产中心继续区分角色、场景、BGM、音效和配音；其依赖与打包结构还显示 CodeMirror、Zustand、ELK、Fuse、后台任务、资产扫描和公开扩展 SDK 等明确模块。以上仅是参照事实，不等于 Surdet 必须照搬全部模块、插件系统、云协作、市场或发行能力。
- **Surdet 当前结构事实：** `packages/editor` 已经拥有场景编辑、流程图、时间轴、配置、预览、统计、审计、素材扫描、撤销/重做与自动恢复，但共享状态集中在单一 `state`，`preview.ts`、`flow.ts`、`config.ts` 等文件已达到数百行。下一轮设计必须先确定应用壳层、项目文档模型、命令/历史、工作区导航和面板生命周期等边界，再决定首个可交付子项目；不得在现有全局状态上无边界继续堆面板。
- **设计门与施工边界：** 当前只授权只读审计、路线登记和编辑器设计。总经理必须先把这一大主题拆成可独立验收的子项目，提出 2–3 种演进方案，并取得项目所有者对设计的明确批准；设计批准前不得修改 `packages/editor/src/**`、测试、Core、Renderer、Host、Shell 或 Zero，不得预先创建插件、云同步、多人协作、市场或正式发布系统。
- **Git 与阶段边界：** 当前分支 `main`；`HEAD=725d510e2af66127f81df1fbde2cfb0d6ab35b16`；`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`；ahead/behind=`3 0`。既有三个 Stage 4/5 文档提交仍未 push。本项授权不包含 push、部署、打包、发行、改史或清理工作树；长期路线台账继续未跟踪、未暂存、未提交。

当前状态更新为：`STAGE_5_EDITOR_ARCHITECTURE_EXPANSION_AUTHORIZED` / `REFERENCE_STUDIO_AUDIT_IN_PROGRESS` / `EDITOR_DESIGN_APPROVAL_PENDING_OWNER` / `EDITOR_REFACTOR_IMPLEMENTATION_NOT_STARTED` / `NOT_PUSHED_AFTER_STAGE_5` / `STAGE_6_NOT_STARTED`。

### 4.36 编辑器产品定位：吸收优点、强化自身、目标超越（2026-08-13 19:36）

项目所有者进一步明确：Surdet 的目标不是制作一个“像 LetsGal Studio 的引擎”。如果最终产品只是相似或复刻，直接使用现成项目即可，从头建设 Surdet 就失去了意义。参照项目的作用是暴露成熟产品已经解决的问题和可借鉴的方法，而不是规定 Surdet 的产品形态。

这一定位立即成为后续编辑器设计与验收的最高产品标准：

1. **借鉴采用拆解式，不采用模仿式。** 对每个参照能力分别回答“它解决了什么创作问题、为什么有效、Surdet 是否已有更好的基础、怎样转化成符合 Surdet 的实现”，不得以导航名称、页面布局、视觉语言或功能列表相似作为目标。
2. **Surdet 的既有优势必须被巩固。** 设计不得牺牲已经验证的真实运行时预览、数据驱动内容、公开剧情位置与状态可观察性、存档/恢复可靠性、Core/Renderer/Host/Shell 公共边界、文本格式可读性以及项目所有者直接创作和游玩的体验。
3. **超越必须落在可验证的创作结果。** 未来任务必须提出参照项目之外或优于参照项目的明确价值，例如同一份正式游戏数据直接驱动编辑和预览、错误可定位到创作对象、修改影响可视化、跨场景状态与资源引用可追踪、预览结果与正式运行时一致，以及从创作动作到可玩结果的路径更短。不得只用“功能更多”“界面更漂亮”或“架构更复杂”宣称超越。
4. **产品身份保持独立。** 不沿用参照项目的品牌、术语体系、视觉构图、导航分组或扩展市场思路；任何采用的模式都必须重新根据 Surdet 的内容模型和项目所有者工作流命名、组织和验证。
5. **重新设计当前方案。** 4.35 中列出的参照模块仅作为审计材料；总经理此前提出的 A/B/C 首轮选项不再作为待选方案。下一步应先定义 Surdet 独有的编辑器价值主张和首个“明显优于现状且不依赖模仿”的创作闭环，再提出新的 2–3 条演进路线供项目所有者批准。

当前状态补充为：`EDITOR_PRODUCT_DIRECTION_SURPASS_NOT_CLONE` / `SURDET_ADVANTAGES_MUST_BE_PRESERVED_AND_STRENGTHENED` / `REFERENCE_FEATURE_PARITY_NOT_A_SUCCESS_CRITERION`。设计批准、生产施工、push、部署、打包、发行和 Stage 6 边界不变。

### 4.37 项目所有者批准编辑器第一竞争支柱（2026-08-13 19:38）

项目所有者明确认可把 Surdet 编辑器的第一竞争支柱确定为：**编辑内容、正式运行时预览、状态因果和影响诊断完全连成一体，让创作者随时知道“我正在改什么、游戏里会发生什么、它还影响了哪里”。**

该认可把 4.36 的产品定位转化为后续设计的固定北极星：

- 编辑器中的场景、台词、指令、选择、变量、时间轴、角色和资源必须被视为可定位、可关联的创作对象，而不只是彼此分离的页面或文件。
- 预览必须尽可能使用正式 Surdet 运行语义和同一份当前创作数据，并允许从选定对象或剧情位置快速进入；不得另造与正式游戏逐渐漂移的简化运行时。
- 运行结果、错误、状态变化和引用影响必须能够返回对应创作对象，形成“编辑 → 运行 → 观察 → 定位 → 再编辑”的短闭环。
- “优于参照项目”的第一组证据应是创作路径更短、运行语义更一致、问题定位更准确、影响关系更透明；功能数量、视觉相似和大型插件架构不构成证据。
- 后续任何架构重构都必须说明它怎样服务这条闭环，并持续保护 Stage 5 已人工通过的保存与重开可靠性。不能服务这一支柱的重构不进入首轮。

当前状态补充为：`EDITOR_NORTH_STAR_APPROVED_BY_OWNER` / `AUTHORING_RUNTIME_CAUSALITY_LOOP_IS_PRIMARY`。下一步继续澄清首个创作入口和最小可交付纵向切片；设计规格仍未批准，生产实现仍未开始。

### 4.38 项目所有者批准“双向因果创作台”设计方向（2026-08-13 19:47）

项目所有者明确回复“批准双向因果创作台”，据此正式批准以下产品结构：

- **主认知中心：** 当前创作对象。台词、选择、指令、变量、角色、资源和时间轴节点均应拥有可定位身份与上下文。
- **双向定位：** 创作者可以从创作对象启动正式 Surdet 运行时，也可以在正式画面中选择台词、选择、角色立绘或背景等运行结果，反向回到产生它的创作对象。
- **随对象呈现的因果信息：** 当前状态、进入条件、状态写入、跳转目标、资源引用和受影响内容围绕当前对象呈现，不被拆散成互不相关的功能页面。
- **同源运行语义：** 编辑器预览继续使用正式 Surdet 数据与运行语义，不另造逐渐漂移的简化预览状态机；Stage 5 已人工通过的编辑、保存和重开闭环必须保留。
- **独立产品身份：** 该方向不采用 LetsGal Studio 的页面分类、导航名称或视觉布局作为骨架；成熟参照只提供问题与方法样本，Surdet 的产品结构由“创作对象 ⇄ 正式运行时 ⇄ 状态因果与影响范围”产生。
- **首个纵向切片方向：** 优先围绕台词与选择证明对象定位、从对象运行、画面反向选择、状态/影响呈现、未保存数据预览以及可靠保存重开。最终范围仍须在设计规格中收敛，不能在本条授权下直接扩大为一次重写全部编辑器。

项目所有者同时反馈第一版三方案网页“文字全挤在一起，看不清布局”。该反馈作为设计工具的真实可用性问题登记：后续可视化必须一次只展示一个主要方案，使用更大字号、明确分区、较少文字和清晰动线；不得把三套完整桌面工作台压缩在同一屏内，也不得把看不清误判为项目所有者未理解产品设计。

当前状态更新为：`BIDIRECTIONAL_CAUSAL_AUTHORING_WORKBENCH_APPROVED` / `DETAILED_EDITOR_LAYOUT_DESIGN_IN_PROGRESS` / `VISUAL_COMPANION_READABILITY_CORRECTION_REQUIRED` / `EDITOR_REFACTOR_IMPLEMENTATION_NOT_STARTED`。本批准仍不授权执行 AI修改生产代码；必须完成分段设计、书面规格和项目所有者复核后才能制作实施任务书。

### 4.39 项目所有者恢复 Surdet 原始使命：AI 原生全自动 Galgame 生产（2026-08-13 19:53）

项目所有者明确补充：Surdet 最开始就是为了让 AI 能够全自动制作 Galgame 而设计，这一原始使命必须在本轮编辑器大幅扩展中成为产品优势。同时，项目所有者注意到成熟参照项目支持原生扩展市场，希望 Surdet 吸收其中“能力可开放、可组合”的优点，但仍不得变成该项目的模仿品。

总经理据此作出以下产品边界：

1. **AI 原生自动生产成为第二竞争支柱，与双向因果创作台并列。** Surdet 不把 AI 限定为聊天框、文案生成器或单个按钮；AI 应能读取项目的结构化事实，通过正式公共能力规划并执行创作任务，运行真实预览，读取诊断，修正结果，最后交付可审查、可回退、可游玩的项目变化。
2. **人类与 AI 必须使用同一套创作能力。** 场景、台词、选择、变量、角色、资源、时间轴、预览、校验、保存与构建能力需要形成明确、类型化、可发现的命令/工具契约。人类通过工作台操作，AI 通过机器可调用接口操作；两者最终进入同一事务、历史、校验和正式运行语义，禁止为 AI复制第二套隐蔽编辑逻辑。
3. **全自动不等于无约束写文件。** AI 的每次生产应形成计划、变更集、来源/理由、影响分析、自动校验、真实运行证据和可回退检查点；失败不得半写入或把项目留在不可理解状态。项目所有者可以设定“自动执行”“关键节点批准”或“只提出方案”的不同自治级别，但底层能力保持一致。
4. **扩展能力先于扩展市场。** 成熟项目的原生扩展市场证明能力开放与组合具有价值，但当前不建设商店、账号、下载、评分、远端分发或第三方生态。首轮只设计稳定的内部能力目录与工具契约；只有 Surdet 自身和 AI生产链出现至少两个真实扩展调用方后，再决定是否形成公开扩展 SDK。市场属于更晚的产品/分发主题，不能抢占当前编辑器核心。
5. **Surdet 的独特闭环扩展为：** `创作意图 → AI/人类共同规划 → 类型化创作操作 → 正式运行时验证 → 状态与影响诊断 → 自动或人工修正 → 可审查交付`。这比参照项目的模块或市场数量更能构成代际差异，后续设计必须用完整纵向任务证明，而不是只声明“支持 AI”。
6. **当前布局反馈边界：** 项目所有者对修正版主工作台反馈“还行吧”，属于方向可接受但不是最终布局批准。下一版设计必须把 AI 生产会话、计划/变更审查和运行诊断融入双向因果创作台之后，再请求布局批准；不得把 AI塞成独立侧栏聊天框。

当前状态补充为：`AI_NATIVE_AUTONOMOUS_GALGAME_PRODUCTION_IS_CORE_MISSION` / `HUMAN_AND_AI_SHARE_TYPED_AUTHORING_CAPABILITIES` / `EXTENSION_CAPABILITY_BEFORE_EXTENSION_MARKET` / `REVISED_AI_NATIVE_WORKBENCH_DESIGN_REQUIRED`。设计规格、生产施工、公开扩展 SDK、扩展市场、push、部署、打包、发行和 Stage 6 均未获授权。

### 4.40 项目所有者批准首个 AI 原生可玩短章纵向切片（2026-08-13 19:55）

项目所有者明确批准把 Surdet 的第一个 AI 原生证明目标固定为：**从一段自然语言创作意图，全自动生成、正式运行、诊断、修正并交付一个带选择与状态变化的可玩短章。**

这一目标是产品与架构的纵向验收切片，不是要求首轮生成完整长篇游戏。后续设计规格必须同时覆盖：

1. 项目所有者输入一段包含场景、人物关系、情绪、选择与后果的自然语言创作意图；
2. AI 将意图转化为可审查生产计划和明确创作对象清单，而不是直接无说明地批量写文件；
3. AI 通过与人类工作台共用的类型化能力创建或修改场景、台词、选择、变量、跳转及必要的现有资源引用；
4. 所有修改先形成隔离、可比较、可回退的变更集，并通过统一事务与保存边界落盘；
5. AI 从新短章的指定对象进入正式 Surdet 运行时，至少验证两个选择分支、状态变化、跳转目标和错误通道；
6. 若发现可自动判断的结构、引用、可达性或运行错误，AI在同一生产会话中修正并重新验证；不得用放宽断言或伪造运行结果宣称通过；
7. 最终交付必须包含创作摘要、对象级变更、影响分析、实际运行证据、仍需项目所有者判断的视觉/节奏/情绪事项以及单一可回退检查点；
8. 项目所有者能够在双向因果创作台中打开生成短章、查看任一对象、从正式画面反向定位源头，并亲自游玩验收；
9. 刷新与重开后内容仍然存在，现有可读项目格式和 Stage 5 保存闭环不得被替换为 AI 专属黑箱格式。

首轮默认不包含从零生成正式美术、音乐、配音、扩展市场、云协作、自动发行或整部长篇作品；可使用现有资产或明确占位引用验证结构和运行闭环。以上延期项不能被包装为首个纵向切片已经完成，也不能抢占类型化创作能力、事务、正式运行验证和可追溯交付的地基。

当前状态更新为：`AI_PLAYABLE_CHAPTER_VERTICAL_SLICE_APPROVED_BY_OWNER` / `AI_PRODUCTION_SESSION_DESIGN_IN_PROGRESS` / `AI_VERTICAL_SLICE_IMPLEMENTATION_NOT_STARTED`。下一步是完成 AI 生产会话与双向因果创作台的交互布局设计，再定义能力目录、事务、运行验证与交付契约；未经完整设计规格批准，不进入代码施工。

### 4.41 项目所有者澄清：外部电脑端 Agent 使用 Surdet，非引擎内置 AI（2026-08-13 19:59）

项目所有者明确纠正此前产品解释：目标不是在 Surdet 编辑器内部内置模型、聊天侧栏或 AI 生产会话；目标是让电脑端的外部 Agent 能够利用 Surdet 引擎全自动制作 Galgame。Surdet 的优势应表述为 **Agent 友好、机器可操作、证据可验证**，而不是“内置 AI”。

该澄清立即取代 4.39、4.40 中关于“AI 生产会话属于编辑器页面”的解释，但不取消已经批准的自动生成可玩短章纵向目标。正确边界更新为：

1. **外部 Agent 负责智能。** 需求理解、规划、迭代策略、模型选择和自主循环均发生在 Surdet 之外，可由 Codex、Claude Code 或其他电脑端 Agent 完成。Surdet 不捆绑模型供应商、不管理模型账号、不实现聊天产品，也不要求联网才能进行普通人工创作和游戏运行。
2. **Surdet 提供 Agent 创作契约。** 引擎和编辑器应暴露稳定、类型化、机器可发现的项目读取、对象查询、创作命令、事务、影响分析、验证、正式运行、轨迹读取、保存与回退能力。外部 Agent 使用这些正式能力，不依赖屏幕坐标点击、不解析易变 DOM、不直接无约束改写文件。
3. **人类 UI 与 Agent 接口共享同一内核。** 双向因果创作台仍是项目所有者的人工创作与验收界面；Agent 通过无界面或可脚本化入口使用相同对象模型、命令、事务、历史、校验和正式运行语义。禁止为 Agent复制第二套编辑器状态机或简化运行时。
4. **接口优先稳定语义，不绑定单一传输协议。** 首轮先定义与进程无关的 Agent Capability Contract；可以用结构化 CLI/JSON 作为最小可靠入口，并保留以后增加本地工具协议适配器的空间。不得在证据不足时把 MCP、HTTP 服务、插件市场或特定 Agent SDK写死为唯一架构。
5. **首个纵向目标的正确执行者：** 外部电脑端 Agent 接收自然语言意图，调用 Surdet 的机器接口创建带选择和状态变化的短章，启动正式运行验证两个分支，读取诊断后修正，并输出可审查变更与回退点。Surdet 负责确定性能力和证据，外部 Agent 负责智能编排。
6. **扩展市场边界保持不变。** Agent 友好的能力目录未来可自然成为扩展 SDK 基础，但当前不开发商店、账号、远端分发或市场界面。先证明外部 Agent 能稳定完成真实创作闭环，再评估公开扩展生态。
7. **可视化设计纠正：** `AI 生产会话 × 双向因果创作台` 网页是被本条澄清否决的中间概念，不作为批准设计。后续网页只展示人类双向因果创作台，以及外部 Agent 如何通过独立机器接口在后台改变同一项目；不得再把 AI 生产流程塞进编辑器产品导航。

当前状态更新为：`EXTERNAL_DESKTOP_AGENT_IS_AUTOMATION_EXECUTOR` / `EMBEDDED_AI_IS_NOT_SURDET_PRODUCT_DIRECTION` / `AGENT_FRIENDLY_ENGINE_IS_CORE_ADVANTAGE` / `AGENT_CAPABILITY_CONTRACT_DESIGN_REQUIRED` / `INTERNAL_AI_SESSION_CONCEPT_SUPERSEDED`。4.40 的 `AI_PRODUCTION_SESSION_DESIGN_IN_PROGRESS` 状态终止；首个可玩短章纵向目标保留，但必须改用外部 Agent 架构重新设计。生产施工、公开扩展 SDK、扩展市场、push、部署、打包、发行和 Stage 6 均未获授权。

### 4.42 项目所有者批准外部 Agent Capability Contract 架构（2026-08-13 20:02）

项目所有者明确确认以下架构方向：**Surdet 不内置 AI；外部桌面 Agent 通过稳定的本地能力契约操作 Surdet；结构化 CLI/JSON 作为第一可靠入口，MCP 或其他 Agent 协议以后作为薄适配层。**

该批准固定以下设计不变量：

1. **单一共享创作内核：** 人类编辑器、CLI、自动化脚本和未来协议适配器必须调用同一对象模型、类型化命令、事务、历史、校验、影响分析和正式运行能力；不得各自直接实现一套保存、预览或状态逻辑。
2. **传输与语义分离：** Agent Capability Contract 定义能力名称、输入、输出、错误、权限、事务和证据；CLI/JSON 是第一传输形式，不得把命令行参数细节反向污染创作领域模型。未来 MCP、本地服务或 SDK 只翻译协议，不复制业务实现。
3. **确定性机器接口：** 所有 Agent 主路径命令必须提供稳定 JSON 输出、明确退出码、对象身份、错误码、变更集身份和证据路径；不得要求 Agent 从彩色终端文本、GUI 提示、DOM 或屏幕坐标推断结果。
4. **外部 Agent 自主编排：** Surdet 不负责自然语言理解、模型选择或生产策略；外部 Agent 自行组合“检查项目 → 开始变更 → 调用创作能力 → 校验 → 正式运行 → 读取轨迹 → 修正 → 提交/回退”。
5. **人类可接管：** Agent 创建的对象和变更必须能立即被双向因果创作台打开、解释、编辑和正式运行；项目所有者无需使用 Agent 专属页面或黑箱格式才能检查成果。
6. **首轮范围：** 设计并实现可玩短章纵向切片真正需要的最小能力集合，不一次性承诺通用插件生态、远端服务、完整 MCP server、自动发行或所有创作对象。新能力应从真实短章任务自然扩展。

当前状态更新为：`EXTERNAL_AGENT_CAPABILITY_CONTRACT_APPROVED_BY_OWNER` / `STRUCTURED_CLI_JSON_IS_FIRST_AGENT_ENTRY` / `FUTURE_AGENT_PROTOCOLS_ARE_THIN_ADAPTERS` / `SHARED_AUTHORING_KERNEL_DESIGN_IN_PROGRESS`。下一步继续分段批准系统架构、最小能力目录、事务/证据模型和人工工作台关系；完整规格批准前不进入生产施工。

### 4.43 项目所有者批准外部 Agent 与 Surdet 的系统分层（2026-08-13 20:05）

项目所有者确认“系统边界正确”，正式批准以下五层关系：使用者与编排者层、入口适配层、Agent Capability Contract、共享创作内核、正式运行与项目文件证据基础。外部 Agent 负责编排，人类编辑器和结构化 CLI/JSON 使用同一创作内核，正式 Surdet 运行时负责最终技术证据。

批准后进行的首轮只读能力盘点确认 Surdet 已有可复用基础，而非从零建设：

- `packages/cli` 已有 `lint --json`、`simulate --json`、`audit`、`stats --json`、`build`、`pack`、`new` 等入口；其中 lint 的机器输出已包含稳定问题字段与修复 hint，simulate 已能无头探索选择分支、读取运行错误和状态路径。
- `packages/core` 已有 DSL 编译、SceneRegistry、Interpreter、变量存储、时间轴、场景校验、项目统计和运行时快照等公共能力。
- `packages/editor` 已有项目读取/保存、对象文本模型、流程图、变量引用分析、资产引用分析、时间轴、预览诊断、撤销/重做与自动恢复，但其中部分能力仍直接耦合浏览器状态或编辑器全局 `state`，尚不能直接供 CLI 与外部 Agent 复用。
- CLI 与编辑器已经共享部分 Core lint 能力，这是后续“单一共享内核”的正确现有方向；首轮重构应优先提取真实短章纵向切片需要的项目对象查询、类型化修改、事务/差异和从对象运行能力，不重写已有 lint、simulate 或正式运行系统。

当前状态更新为：`EXTERNAL_AGENT_SYSTEM_BOUNDARIES_APPROVED_BY_OWNER` / `EXISTING_AGENT_FRIENDLY_FOUNDATIONS_CONFIRMED` / `MINIMUM_AGENT_CAPABILITY_CATALOG_DESIGN_IN_PROGRESS`。下一设计门是批准首个可玩短章所需的最小能力目录；未批准前不修改 CLI、Core、editor 或正式运行时生产代码。

### 4.44 项目所有者批准最小 Agent 能力目录并停止网页示意（2026-08-13 20:09）

项目所有者确认首个可玩短章纵向切片采用以下 14 项最小能力；这些名称描述稳定能力边界，不等同于必须立即创建 14 个独立命令或模块：

- 发现与读取：`capabilities.describe`、`project.inspect`、`object.inspect`；
- 隔离创作：`change.begin`、`scene.create`、`scene.patch`、`variable.ensure`；
- 校验与运行证据：`project.validate`、`project.simulate`、`runtime.runFrom`、`runtime.readTrace`；
- 复核与交付：`change.diff`、`change.commit`、`change.rollback`。

该目录坚持“先复用、再提取、最后补缺”的实现边界：

- 复用 CLI 现有 `lint --json`、`simulate --json`、统计能力以及 Core 的编译器、解释器、变量与场景模型；
- 从 editor 现有对象读取、引用分析、预览诊断和保存能力中提取真正可共享的创作内核，禁止复制第二套编辑器状态机；
- 只新增当前纵向切片不可缺少的能力描述、隔离变更事务、结构化差异与证据读取，不提前建设扩展市场、完整 MCP 服务、远端协作或自动发行。

项目所有者同时要求后续不再生成网页示意，以节省额度并避免拥挤难读。此后产品与架构设计只使用清晰、可复制的中文文字；先前 `.superpowers/brainstorm` 中的本机示意资料保留为忽略文件，不删除、不暂存、不提交，临时可视化服务关闭。该决定只改变设计呈现方式，不改变已经批准的产品方向或能力边界。

当前状态更新为：`MINIMUM_AGENT_CAPABILITY_CATALOG_APPROVED_BY_OWNER` / `TEXT_ONLY_DESIGN_CONTINUATION_REQUESTED` / `VISUAL_COMPANION_STOPPED_BY_OWNER_REQUEST` / `OBJECT_IDENTITY_TRANSACTION_EVIDENCE_DESIGN_NEXT`。`AI_VERTICAL_SLICE_IMPLEMENTATION_NOT_STARTED` 与 `EDITOR_REFACTOR_IMPLEMENTATION_NOT_STARTED` 继续有效；下一步先用文字完成对象身份、事务、差异和运行证据设计，完整设计规格获批并形成任务书前不进入生产施工。

### 4.45 项目所有者批准“语义身份 + 修订期对象引用”（2026-08-13 20:14）

项目所有者明确选择并批准对象身份方案一。Surdet 的对象身份原则确定如下：

- 场景、标签、变量、时间轴和素材等命名对象使用人类可读、可长期保持的语义身份；
- 台词、选择项和匿名指令等对象由 `object.inspect` 返回只在当前项目修订或变更事务内有效的精确 `objectRef`；外部 Agent 不自行猜测或拼接匿名引用；
- 任何类型化修改必须同时校验基础修订、对象引用和原内容指纹；引用过期、目标不存在、目标不唯一或原内容不符时必须明确失败，禁止模糊匹配、静默重定位或“尽量修改”；
- 修改成功后返回新修订与新的对象引用；事务提交后，外部 Agent 必须重新读取需要继续操作的匿名对象；
- 不在每条 `.gal` 内容中写入永久 UUID，不引入易漂移的隐藏旁路身份索引；保持项目文件对人类清楚、开放、可直接编辑和可审查；
- 编辑器选择、CLI 查询和运行轨迹后续统一映射到同一种对象引用，使“创作对象 → 状态影响 → 玩家可见结果”和反向定位使用同一身份语言。

这一原则同时服务人类可接管、Agent 精确修改与双向因果创作台，不建立 Agent 专属项目格式。当前状态更新为：`SEMANTIC_AND_REVISION_SCOPED_OBJECT_IDENTITY_APPROVED` / `NO_PERSISTENT_UUID_POLLUTION` / `NO_FUZZY_AGENT_PATCHING` / `ISOLATED_CHANGE_TRANSACTION_DESIGN_NEXT`。生产实现仍未开始；下一设计门是变更事务的隔离、冲突、校验与提交语义。

### 4.46 项目所有者批准 Surdet 原生隔离变更事务（2026-08-13 20:17）

项目所有者正式批准 Surdet 原生隔离事务作为外部 Agent 写入项目的基础，不以 Git worktree、直接写盘后撤销或永久旁路文件替代。批准的不变量如下：

- `change.begin` 以项目真实文件内容建立 `baseRevision` 与隔离工作版本；事务内的 `scene.create`、`scene.patch`、`variable.ensure` 等写操作在 `change.commit` 成功前不得修改真实项目文件；
- 每次写操作携带 `operationId`，完全相同的重试返回原结果，同一 `operationId` 对应不同负载时明确失败；单次类型化操作要么全部成功，要么不推进 `workingRevision`；
- 校验、模拟、正式运行和差异均针对明确的 `changeId` 与 `workingRevision`；提交至少要求同一最新工作修订的新鲜 `project.validate` 且 error 为零，warning 如实返回；
- `project.simulate` 与 `runtime.runFrom` 不成为所有小修改的统一硬门槛，但“自动制作可玩短章”纵向切片的交付流程必须在提交前执行它们；
- `change.commit` 前重新读取涉及文件并核对基线；任何磁盘冲突均返回 `PROJECT_CHANGED_SINCE_BEGIN`，不得写入项目、自动合并或模糊重定位；首轮由 Agent 读取差异、回滚旧事务并基于最新项目重新开始；
- 多文件提交先写入并验证同目录临时文件，使用短期恢复记录完成替换；任一步失败必须恢复已经替换的目标，不得留下场景与配置只成功一半的项目；短期恢复记录不承担永久对象身份；
- `change.commit` 仅表示把已验证事务应用到 Surdet 项目文件，绝不等同于 Git commit，也不自动暂存、提交、建分支、push 或修改 Git 历史；
- `change.rollback` 只丢弃尚未提交的隔离工作版本，不覆盖真实项目文件；状态保持最小：`OPEN → COMMITTED | ROLLED_BACK | STALE`，不建立嵌套事务、自动 rebase、协同编辑锁或事务分支树；
- 首个纵向切片明确不声称解决“浏览器编辑器中存在未保存缓冲区，同时外部 Agent 写同一项目”的协同编辑；首轮要求 Agent 使用隔离项目副本或没有未保存人工修改的项目，后续由共享事务内核与人类工作台接线解决。

当前状态更新为：`NATIVE_ISOLATED_CHANGE_TRANSACTION_APPROVED` / `AGENT_WRITES_DO_NOT_TOUCH_PROJECT_BEFORE_COMMIT` / `CONTENT_HASH_CONFLICT_REJECTION_REQUIRED` / `SURDET_CHANGE_COMMIT_IS_NOT_GIT_COMMIT` / `STRUCTURED_DIFF_AND_RUNTIME_EVIDENCE_DESIGN_NEXT`。生产实现仍未开始；下一设计门是差异如何同时服务人类与 Agent，以及正式运行证据怎样串起创作对象、状态变化与玩家可见结果。

### 4.47 项目所有者批准统一结构化因果证据模型（2026-08-13 20:21）

项目所有者正式批准以统一结构化因果证据连接创作对象、编译指令、控制流、状态变化、运行时事件、演出应用和玩家可见候选结果，不以汇总日志或截图录像作为首轮基础模型。批准的边界如下：

- `change.diff` 同时提供人类摘要、机器权威的结构化语义差异和原始文件文本差异；三层必须互相一致，异常格式变化不得被摘要掩盖；
- 直接修改、静态可能影响和运行时已观察影响使用不同字段表达，禁止把引用图推断写成已运行事实；
- 证据分为四级：静态校验、Core 模拟路径、正式运行与 Presentation 应用、项目所有者真实观察；自动化不得填写或冒充项目所有者观察层；
- `project.validate` 复用现有 lint 的稳定问题字段并补充对象引用与事务身份；`project.simulate` 复用现有解释器分支遍历、状态结果、分支覆盖、死路和快照能力；
- `runtime.runFrom` 驱动共享的正式运行链，首轮记录台词、选择、输入、变量变化、条件结果、控制流、基础演出状态、结束与错误；明确区分 `CORE_EMITTED` 与 `PRESENTATION_APPLIED`，后者仍不得自动宣称画面正确或人工验收通过；
- 所有差异、校验、模拟和轨迹使用统一证据信封，绑定 `schemaVersion`、`evidenceId`、引擎身份、项目修订、`changeId`、`workingRevision`、状态及 artifact 路径/字节数/SHA-256；每次运行生成新身份，失败证据不得被后续成功结果覆盖；
- `runtime.readTrace` 支持按对象、场景、变量、选择、演出效果和错误双向查询，使人类与 Agent 能从创作对象追到运行结果，也能从运行结果反查来源和成立条件；
- 跨进程事务与证据首轮使用项目目录之外的本机 Surdet 应用数据目录和普通 JSON/工作文件，不污染项目、不引入数据库、云服务或永久旁路对象索引；
- 首轮不处理音频质量、自动审美评分、截图像素矩阵、性能资格化、扩展市场、云证据、实时协作、自动 Git 操作或自动人工验收结论。

当前状态更新为：`UNIFIED_STRUCTURED_CAUSAL_EVIDENCE_APPROVED` / `STATIC_SIMULATED_PRESENTATION_AND_HUMAN_EVIDENCE_SEPARATED` / `FAILED_EVIDENCE_MUST_BE_PRESERVED` / `BIDIRECTIONAL_TRACE_QUERY_REQUIRED` / `SHARED_AUTHORING_KERNEL_COMPONENT_DESIGN_NEXT`。生产实现仍未开始；下一设计门是共享创作内核如何划分组件，以及外部 Agent、CLI、人类编辑器和正式运行时如何只通过这些公共边界协作。

### 4.48 项目所有者批准单一 `@surdet/authoring` 共享创作内核（2026-08-13 20:24）

项目所有者正式批准新增一个、且首轮只新增一个公共创作工作区 `@surdet/authoring`。批准的组件与依赖边界如下：

- `@surdet/core` 保持纯运行语义层，继续负责 DSL、编译、解释器、变量、快照、lint、统计与运行事件；不得承担文件系统、Agent 事务、artifact、Git、DOM、CLI 或内置模型职责；
- `@surdet/authoring` 依赖 Core，内聚项目快照、对象索引、隔离变更会话、类型化创作操作、校验/模拟门面、三层差异和统一证据；Core 不得反向依赖 authoring；
- authoring 通过小型 `ProjectStorage`、事务存储和正式运行证据接口访问平台能力，不直接调用 Node `fs`、浏览器目录选择、localStorage、Electron IPC 或 Git；
- `@surdet/cli` 提供 Node 文件系统与本机事务目录适配、参数解析、稳定 JSON 和退出码；不得保留另一套对象、事务、差异或校验真相；
- `@surdet/editor` 提供 File System Access 与人类界面适配，逐步使用同一项目快照、对象引用、差异和轨迹；保留原始文本编辑，不变成 CLI 皮肤或 Agent 对话界面；
- Core/Renderer/Host/Shell 继续正式运行职责，运行证据适配器只观察 Core 发出、Presentation 应用和错误事实，不复制渲染逻辑或直接篡改内部状态制造绿灯；
- 现有 editor 不整体推倒；只沿首个纵向切片逐步提取已存在的读取、引用、预览诊断和保存能力，保持 Stage 5 已验证闭环；
- 首轮不再拆 `protocol`、`evidence`、`transactions`、`agent-sdk` 或 `mcp` 等额外包；只有未来真实出现独立发布或第三个调用方后才重新评估；
- 人类与 Agent 使用同一创作内核但保持不同体验：人类操作双向因果创作台，外部 Agent 使用能力合同；Surdet 不内置 AI 模型或 AI 专属项目格式。

当前状态更新为：`SINGLE_SHARED_AUTHORING_KERNEL_APPROVED` / `CORE_REMAINS_RUNTIME_PURE` / `CLI_AND_EDITOR_USE_SHARED_AUTHORING_TRUTH` / `NO_PREMATURE_PROTOCOL_PACKAGE_SPLIT` / `FIRST_IMPLEMENTATION_VERTICAL_SLICE_DESIGN_NEXT`。生产实现仍未开始；下一设计门是首个真正施工的纵向切片具体交付哪些对象、命令、正式路径和人工结果。

### 4.49 项目所有者批准 Stage 6 Wave 1 外部 Agent 友好创作纵向切片（2026-08-13 20:27）

项目所有者正式认可首个施工纵向切片及其阶段定位。该轮命名为 `Stage 6 Wave 1 — Agent-Ready Authoring Vertical Slice / 外部 Agent 友好创作纵向切片`，不属于内置 AI、编辑器换皮或通用平台建设。批准的目标与边界如下：

- 外部桌面 Agent 在 Starter 的全新隔离副本中，完全通过 Surdet 结构化能力创建一个至少包含两个场景、一个双选项选择、一个实际声明并改变的状态变量、两条状态结果不同的路径以及汇合或明确结束出口的可玩短章；
- 自然语言理解、规划与修正由外部 Agent 完成；Surdet 不调用模型，只提供能力发现、项目/对象读取、隔离事务、类型化修改、校验、模拟、正式运行证据、差异、提交和回滚；
- 首轮对象范围限于场景、标签、台词、选择/选项、基础指令、变量、条件、跳转以及已有背景/立绘引用；不扩展素材生成、音频、Gallery、大系统可视化、完整时间轴、插件市场或发行；
- 14 项能力均在该真实链路中提供完成纵向目标所需的最小语义，不提前建设万能 CRUD 或任意文本补丁；
- 隔离事务中必须故意建立一次最小结构化红灯（例如不存在的标签目标），证明真实项目未被修改、错误可被 Agent 精确理解并通过正式能力修正；
- 编辑器首轮使用共享项目快照和对象索引，增加紧凑可折叠的最小因果检查，并打通“选择创作对象过滤预览轨迹 / 选择轨迹事件反向定位创作对象”；不得整体推翻 Stage 5 已验证的编辑—预览—保存—重开闭环；
- 自动证据至少证明事务隔离、红灯修正、校验零 error、双分支模拟覆盖 `2/2`、不同状态结果、正式运行轨迹、三层差异、原子提交、原始 Starter 不变以及无自动 Git 操作；
- 项目所有者人工验收编辑器接管、内容可读可改、双向因果定位、真实预览双路径、保存与重开，以及最终视觉和操作感受；自动化不得代填；
- 首轮不使用《零点之后》、原始 Starter 或用户正式项目作为施工靶场，只使用全新隔离副本。

当前状态更新为：`STAGE_6_WAVE_1_SCOPE_APPROVED_BY_OWNER` / `AGENT_READY_AUTHORING_VERTICAL_SLICE_APPROVED` / `ISOLATED_STARTER_FIXTURE_REQUIRED` / `MINIMUM_CAUSAL_EDITOR_BRIDGE_REQUIRED` / `STAGE_6_IMPLEMENTATION_NOT_STARTED` / `ERROR_TEST_AND_ACCEPTANCE_DESIGN_NEXT`。完整设计规格与实施任务书尚未形成，因此该批准不授权执行 AI 立即修改生产代码。

### 4.50 项目所有者批准 Stage 6 Wave 1 完整设计（2026-08-13 20:31）

项目所有者正式批准最后一节错误处理、验证强度和人工验收设计，至此 Stage 6 Wave 1 的产品与架构设计全部通过。新增批准边界如下：

- 采用统一成功/失败 JSON 信封、稳定错误代码和无噪声 `--json` 输出；结构化能力不得要求 Agent 解析自然语言日志；
- 单次操作失败不得推进工作修订；校验、模拟、运行、冲突、提交恢复均有明确状态与可执行修复动作；模拟预算或超时只可标记 `incomplete`/`timed_out`，不得冒充通过；
- 多文件提交恢复失败是最高严重等级，必须立即停止、保留 journal 与文件身份、等待独立复审；
- 所有项目写入必须解析并限制在真实项目根目录，首轮不暴露任意路径、任意命令、任意删除或移动能力；运行输入、文件遍历、差异与证据尽可能确定性；
- Stage 5 已知的混合 LF/CRLF `model-roundtrip` 红灯在本阶段成为事务无损写入的相关前置条件，必须在共享序列化/EOL 保持边界做最小正确处理，不批量归一化用户文件、不放宽测试；
- 测试采用 authoring 单元、JSON 合同、事务故障注入、外部 Agent 红灯到绿灯、一次覆盖双分支的正式运行 harness、受影响工作区验证及最终一次 `verify:all`；不追加性能资格化、多轮 Electron、打包或发行；
- 独立经理复审通过后，项目所有者使用桌面隔离 fixture 完成编辑器接管、最小因果检查、轨迹反向定位、双分支真实预览以及编辑—保存—刷新重开的人工验收；自动化不得代填；
- 执行 AI 完成本地实现与提交后停止在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`，不得自动 push、进入 Wave 2、修改《零点之后》、启动音频、扩展市场、打包或发行。

当前状态更新为：`STAGE_6_WAVE_1_COMPLETE_DESIGN_APPROVED_BY_OWNER` / `ERROR_TEST_AND_HUMAN_ACCEPTANCE_MODEL_APPROVED` / `DESIGN_SPEC_WRITING_IN_PROGRESS` / `STAGE_6_IMPLEMENTATION_NOT_STARTED`。下一步只整理、校验并本地提交正式设计规格供项目所有者文件复核；项目所有者复核规格后才允许生成详细实施任务书，实施任务书再次获批前不得修改生产代码。

### 4.51 Stage 6 Wave 1 正式设计规格已提交并等待文件复核（2026-08-13 20:34）

完整设计已整理为：

```text
docs/superpowers/specs/2026-08-13-agent-ready-authoring-vertical-slice-design.md
bytes = 26657
sha256 = 36D4DDFE23BA228779983E3660BF2B6CDA06B2BB8E40E8F1A200ECAE9F22DB95
```

提交前自检确认：共 `693` 行、Markdown 围栏 `40` 个且闭合、`TBD/TODO/FIXME/XXX/待定` 等占位符为 `0`；设计明确保持外部 Agent、不内置 AI、不实现扩展市场/MCP/音频/性能/发行、不自动 push，并声明没有未决产品选择。

普通本地提交已从 Git 重新读取：

```text
commit = 0cad5757b6217e446e4655803f07758e503f3578
message = docs(authoring): design agent-ready vertical slice
commit files = 仅新增上述设计规格
branch = main
surdet/main = 5994ec7bd64b2106da6e47cd86e88fb4df82ed01
HEAD...surdet/main = 4 0
```

提交后 tracked 工作树和暂存区干净；只保留既有未跟踪 AGENTS、受保护文件、handoff 与本长期路线台账。没有生产代码、测试、Starter、《零点之后》或临时网页文件进入提交；没有 push、部署、打包或开始 Stage 6 实现。

当前状态更新为：`STAGE_6_WAVE_1_DESIGN_SPEC_COMMITTED` / `WAITING_FOR_OWNER_SPEC_FILE_REVIEW` / `WRITING_PLANS_NOT_STARTED` / `STAGE_6_IMPLEMENTATION_NOT_STARTED` / `NOT_PUSHED_AFTER_DESIGN_SPEC`。下一步由项目所有者复核规格文件；只有明确批准该文件后，才进入 `writing-plans` 生成详细实施任务书。

### 4.52 项目所有者批准正式规格并授权编写实施任务书（2026-08-13 20:35）

项目所有者明确回复“规格批准”，因此 `docs/superpowers/specs/2026-08-13-agent-ready-authoring-vertical-slice-design.md` 的文件复核门已通过。当前获准动作仅为使用 `writing-plans` 编写 Stage 6 Wave 1 详细实施任务书；不等同于授权当前经理 AI 修改生产代码或直接开始施工。

任务书必须以真实仓库结构为依据，明确：文件职责、公共接口、逐步红灯/绿灯、命令与预期结果、事务和正式运行 artifact、提交边界、人工验收强制提醒点及最终独立复审停止状态。任务书完成后应单独本地提交并交由项目所有者决定执行方式；不得自动创建子 AI、push、部署、打包、发行或进入 Wave 2。

当前状态更新为：`OWNER_SPEC_FILE_REVIEW_PASSED` / `WRITING_PLANS_AUTHORIZED` / `STAGE_6_WAVE_1_IMPLEMENTATION_PLAN_IN_PROGRESS` / `STAGE_6_IMPLEMENTATION_NOT_STARTED` / `NOT_PUSHED_AFTER_DESIGN_SPEC`。

### 4.53 Stage 6 Wave 1 详细实施任务书完成并本地提交（2026-08-13 20:49）

已按 `writing-plans` 完成并自审：

```text
path = docs/superpowers/plans/2026-08-13-agent-ready-authoring-vertical-slice-stage-6-wave-1.md
bytes = 53572
sha256 = 0FDE41A68C64D1055086EB1ED94F3603348692B5F209D74710C803406C1C1531
Markdown fences = 136（闭合）
placeholder scan = 0
```

任务书以已批准规格和真实仓库结构为依据，明确了：单一 `@surdet/authoring` 公共内核、逐行 EOL 无损文档、修订期对象引用、项目外隔离事务、14 项结构化 CLI/JSON 能力、共享校验/模拟/三层差异、Core 与正式 Presentation 因果证据、编辑器最小双向因果桥、唯一纵向 harness、桌面人工 fixture、逐 Task 红灯/绿灯、提交边界与最终独立复审停止点。它明确禁止内置 AI、扩展市场/MCP、音频、性能、发行、Wave 2、子 AI 和未经授权的远端操作插队。

普通本地提交已从 Git 重新读取：

```text
commit = 297fb92bc6ba1257c774dddfba753151508642ca
message = docs(authoring): plan agent-ready vertical slice
commit files = 仅新增上述 Stage 6 Wave 1 任务书
branch = main
surdet/main = 5994ec7bd64b2106da6e47cd86e88fb4df82ed01
HEAD...surdet/main = 5 0
git diff --check = exit 0
git diff --cached --check = exit 0
tracked *.log = 无
```

提交后 tracked 工作树和暂存区干净；既有未跟踪 AGENTS、受保护文件、handoff 与本长期路线台账没有进入提交。没有修改生产代码、测试、Starter 或《零点之后》；没有 push、部署、打包、发行或开始 Stage 6 实现。

当前状态更新为：`STAGE_6_WAVE_1_IMPLEMENTATION_PLAN_COMMITTED` / `WAITING_FOR_OWNER_EXECUTION_CHOICE` / `STAGE_6_IMPLEMENTATION_NOT_STARTED` / `NOT_PUSHED_AFTER_IMPLEMENTATION_PLAN`。推荐把任务书交给现有执行 AI，从 Task 0 串行施工；若改由当前会话执行，仍需项目所有者明确授权。

### 4.54 Stage 6 Wave 1 执行 AI 推进至 Task 6（2026-08-13 22:01）

项目所有者报告执行 AI 已推进到 Task 6，并表达对其大量施工工作的认可。总经理随后只读核对了真实 Git、当前任务书 Execution Ledger 和交付报告状态，没有触碰执行 AI 的在途生产文件。

已从磁盘与 Git 独立确认：

```text
branch = main
HEAD = 06e15b5c0db35fe8dbedd225180bb234a3fd2fe4
surdet/main = 5994ec7bd64b2106da6e47cd86e88fb4df82ed01
HEAD...surdet/main = 12 0
latest commit = feat(cli): expose agent authoring capabilities
delivery report = 尚未创建
tracked in-progress = 当前 Stage 6 Wave 1 任务书追加记录
untracked in-progress = packages/editor/test/preview-causal-trace.test.ts
staging area = empty
git diff --check = exit 0
git diff --cached --check = exit 0
tracked *.log = 无
```

任务书 Execution Ledger 显示 Task 1～Task 5 已分别完成本地提交，涉及无损场景文档、项目快照与对象索引、原生隔离事务、共享校验/模拟/差异/Core trace，以及 14 项 CLI/JSON 能力。相对实施任务书提交，当前已提交变化总计 `45 files changed, 3880 insertions, 446 deletions`；排除任务书自身的执行记录后，生产代码与测试等为 `44` 个文件、`3744` 行新增、`404` 行删除。用户所说“4000 多行代码”可视为对整体施工规模的近似描述，但行数不作为正确性或完成证据。

当前 Task 6 的第一份 `preview-causal-trace.test.ts` 已在工作树出现，说明正式 preview/Renderer Presentation 因果消息合同正在施工。尚未独立复核其红灯、实现、绿灯、提交或正式 Presentation artifact；因此只能记录为进展，不能宣称 Task 6、Stage 6 Wave 1 或人工体验已经通过。

当前状态更新为：`STAGE_6_WAVE_1_TASKS_1_TO_5_COMMITTED_LOCALLY` / `STAGE_6_WAVE_1_TASK_6_IN_PROGRESS` / `DELIVERY_REPORT_NOT_CREATED` / `INDEPENDENT_MANAGER_REVIEW_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED_AFTER_STAGE_6_WORK`。下一停止点仍是执行 AI 完成 Task 6～Task 9 后停在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`，由总经理审查真实 diff、测试、artifact 和 fixture；不因代码行数或工作量提前放宽验收。

### 4.55 Task 8 聚合失败独立复审：有条件批准失败收口（2026-08-13 22:40）

执行 AI 按约定只运行一次 `node packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`，在 `project.validate.red` 失败后保留证据、停止后续路径，没有循环重跑、删证据、改 runner 挑绿、进入 Task 9 或代填人工验收。总经理对报告、真实提交、源码边界、磁盘 artifact 与聚焦测试进行了独立复核。

已确认事实：

```text
branch = main
HEAD = 77b467c81a9caa7b36900a93d830e15868edd41f
surdet/main = 5994ec7bd64b2106da6e47cd86e88fb4df82ed01
HEAD...surdet/main = 16 0
Task 8 harness commit = 73c4b1f848b57d8b037696c7ade95667fd04e994
Task 8 ledger closure = 77b467c81a9caa7b36900a93d830e15868edd41f
tracked worktree = clean
staging area = empty
git diff --check = exit 0
git diff --cached --check = exit 0
tracked *.log = 无
```

失败 artifact 从磁盘重新读取：

```text
path = C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-yTB3Ek\agent-ready-authoring-wave-1.json
bytes = 6513
sha256 = A9CE9274C80C2DE38579FFA5951DAF2EA33241EA8196F35F907306A45A166D08
status = FAILED
runHead = e06e2bd704538ad3203b9ea2927d04956803095a
lastPassedNode = change.write-operations-before-red
firstFailedNode = project.validate.red
```

根因边界已独立确认：Task 5 已验证的可修复红灯使用跨场景 `@jump agent.missing`，该输入能通过单场景编译，再由共享项目校验返回带 `objectRef`/`action` 的 `J002`。Task 8 harness 改用了本场景 `@goto missing_label`；Core 编译器按既有语义必须在进入项目校验前返回 `C002`，CLI 因而包装为 `PROJECT_INVALID`。所以本次失败是 harness 选择了错误的红灯构造，不是 Core、CLI、Renderer、恢复链或编辑器正式预览已被证明失败，也不应通过放宽断言或修改生产错误边界解决。

新鲜聚焦复核结果：`node --check` runner exit `0`；CLI 公开纵向测试 `1/1` 通过；Task 6/7 的 preview causal trace、双向选择和内存项目存储测试 `5/5` 通过。它们证明相关局部合同仍成立，但不能替代尚未走到的聚合正式 preview/Renderer 双路径。

另有一个证据身份缺口：失败运行发生时 runner 尚未提交，因此 artifact `runHead=e06e2bd...` 只能标识运行前 HEAD，不能单独标识当时未提交的 runner 内容。虽然执行 AI 随后提交且报告称未再修改 runner，下一次有效聚合证据仍必须先提交最小 runner 修正，再运行一次新的唯一聚合路径，使新 artifact 的 `runHead` 精确包含被测 runner。

复审结论：`CONDITIONALLY_APPROVED_FAILURE_CLOSURE` / `STAGE_6_WAVE_1_NOT_VERIFIED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED`。唯一建议的下一轮是只修改 Task 8 runner 与当前任务书：把故意红灯从本地 `goto` 改为跨场景/显式场景标签 `jump`，用自检先建立红灯，修正后先提交 runner，再做规定构建并只运行一次新的聚合路径。当前仍等待项目所有者明确授权，不自动施工。

### 4.56 第二次聚合失败独立复审：确认共享 authoring choice effect 序列化缺陷（2026-08-13 23:08）

项目所有者授权的最小红灯构造修正已按纪律完成：runner 自检先红后绿，修正后的 runner 与任务书先提交为 `cb4f7243097815158c036a5a5c8b3514db9c9251`，随后五个受影响工作区构建通过，再只运行一次新的聚合路径。新运行没有复用或覆盖旧 artifact/fixture，失败后没有重跑、放宽断言或猜测性修改生产代码。

总经理独立确认：

```text
branch = main
HEAD = a143b0592ec9151b28913a94ae41e8b3b2e28aa2
surdet/main = 5994ec7bd64b2106da6e47cd86e88fb4df82ed01
HEAD...surdet/main = 19 0
CODE_EVIDENCE_HEAD = cb4f7243097815158c036a5a5c8b3514db9c9251
tracked worktree = clean
staging area = empty
git diff --check = exit 0
git diff --cached --check = exit 0
tracked *.log = 无
```

新失败 artifact 已从磁盘复现：

```text
path = C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-0DWIaf\agent-ready-authoring-wave-1.json
bytes = 6696
sha256 = BB5593ECC024499EEBCB492FCA601F2CFA6F5DC4185F121F1532C7513FE0CD36
status = FAILED
runHead = cb4f7243097815158c036a5a5c8b3514db9c9251
redEvidenceId = validation_1786632695167_54870d14-3f91-4aea-b6a6-cc73106c907a
greenEvidenceId = validation_1786632695766_780b8770-0aa0-4e4c-b34e-3da8ab4d3f74
choiceCoverage = 2/2
lastPassedNode = project.simulate-2-of-2
firstFailedNode = runtime.run-from.A-and-B
```

这次 `runHead` 与包含被测 runner 的提交完全一致，上次的证据身份缺口已经关闭。新 fixture 在 commit 前保持不变，原始 Starter 身份未变；旧失败 artifact 和两个桌面 fixture 均保留。preview 仍未启动，因此空错误通道不构成 Presentation 通过证据。

根因已由源码、working-files、simulation evidence 和 runtime trace 交叉确认。共享 authoring 的 `renderChoiceOption()` 当前生成：

```text
路径 A @set trust = 1 -> @goto path_a
```

但 Core DSL parser 只把 ` -> ` 后面的文本解析为内联指令，箭头前全部属于可见 label。于是磁盘事务中的 choice label 和 runtime trace 均为 `路径 A @set trust = 1`，运行指令流只有跳转，没有 `@set` 或 `stateDelta(trust)`；simulation evidence 的两条路径也均为 `trust=0`。手写正确 DSL 的现有测试使用：

```text
路径 A -> @set trust = 1 @goto path_a
```

并能得到 `trust=-1/1`。因此这是 `packages/authoring/src/operations.ts` 的真实公共生产缺陷，不是 runner、Core Interpreter、CLI `runtime.run-from`、Renderer 或 editor 已被证明错误。Task 5 CLI 测试只断言 `2/2` 分支覆盖和提交字符串，没有断言类型化 choice effect 的最终状态，因此未捕获该缺陷。

复审结论：`CONDITIONALLY_APPROVED_SECOND_FAILURE_CLOSURE` / `AUTHORING_CHOICE_EFFECT_SERIALIZATION_BUG_CONFIRMED` / `STAGE_6_WAVE_1_NOT_VERIFIED` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED`。唯一建议下一轮是最小修复共享 `renderChoiceOption()`，补 authoring 精确序列化红灯和 CLI 类型化创建后的 A/B 最终状态红灯，同步 runner 的正确原文/指纹自检；先提交修复及测试，再做规定构建并只运行一次新的聚合路径。当前等待项目所有者明确授权，不自动施工。

### 4.57 第三次聚合失败独立复审：choice 修复有效，确认缺失父目录的 Node 存储边界缺陷（2026-08-13 23:30）

项目所有者授权的共享 authoring choice effect 最小修复已经完成。生产修复及聚焦测试提交为 `d857a39be99f82e78e1b83d9b1044034a5e62da7`；总经理独立确认该提交只包含当前任务书、`packages/authoring/src/operations.ts`、authoring/CLI 聚焦测试和 Task 8 runner。随后执行 AI 按纪律只运行一次新的聚合路径，失败后没有重跑、放宽断言、修改 Core/Renderer/editor 或删除旧证据。

总经理独立回读当前状态：

```text
branch = main
HEAD = 0f394d7fe0518b4df39439c9cd6cb264f377dd09
surdet/main = 5994ec7bd64b2106da6e47cd86e88fb4df82ed01
HEAD...surdet/main = 22 0
CODE_EVIDENCE_HEAD = d857a39be99f82e78e1b83d9b1044034a5e62da7
tracked worktree = clean
staging area = empty
tracked *.log = 无
```

新的失败 artifact 已从磁盘重新读取：

```text
path = C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-O8WYtZ\agent-ready-authoring-wave-1.json
bytes = 7000
sha256 = 454DA0A408C00DB559339DCE052AF901BEFAD39B2DB3CCB09C192D8EA432413D
status = FAILED
runHead = d857a39be99f82e78e1b83d9b1044034a5e62da7
redEvidenceId = validation_1786634426782_ea893c94-8659-4769-afd1-4423484e0704
greenEvidenceId = validation_1786634427384_c445d3c8-cebe-41c3-a3c4-4ed0ebbba18a
choiceCoverage = 2/2
state outcomes = trust -1 / trust 1
lastPassedNode = change.diff
firstFailedNode = change.commit
error = COMMIT_FAILED_RECOVERED
message = 提交前 staging 失败：路径不在项目根目录内：content/scenario/agent_support.gal
```

这证明 4.56 的 choice effect 缺陷已被有效修正：authoring 精确序列化、CLI A/B 类型化最终状态及新聚合证据都得到 `trust=-1/1`，运行已越过此前的 `runtime.run-from.A-and-B` 失败点。总经理新鲜复核也得到 `@surdet/authoring` 10 个测试文件、16 个测试全部通过，CLI 公开纵向测试 `1/1` 通过，runner 语法检查通过；这些聚焦绿灯不能替代尚未完成的 commit/preview/Renderer 聚合证据。

新 fixture `C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786634424882-d3d525bb6b13` 有合法项目根和 `content`，但按 Task 8 的真实 `scene.create` 语义故意不预建 `content/scenario`；失败后该目录和目标场景均不存在，说明 commit 恢复保护没有误写项目。源码复核确认 `packages/cli/src/authoring/node-project-storage.ts` 对缺失目标允许继续，却紧接着用 `realpath()` 要求父目录已经存在；于是把“项目根内合法但尚未创建的父目录”错误映射成 `PATH_OUTSIDE_PROJECT`。现有 CLI 纵向测试预先执行了 `mkdir(content/scenario)`，因此没有覆盖这一生产适配器边界。

这是 Node 项目存储适配器对新文件/新目录提交的真实公共缺陷，不是 harness、choice 序列化、Core、Renderer、editor 或游戏内容已被证明错误。下一轮必须以安全路径不变量为先：仅在 `change.commit` staging 阶段创建项目根内缺失的父目录；逐段拒绝 symlink/junction 和越界；失败恢复不得遗留目标文件、临时文件或本轮新建的空目录；不得简单使用未经逐段验证的递归 `mkdir`，也不得让 runner 预建目录来掩盖生产缺陷。

复审结论：`CONDITIONALLY_APPROVED_THIRD_FAILURE_CLOSURE` / `AUTHORING_CHOICE_EFFECT_FIX_VERIFIED` / `NODE_PROJECT_STORAGE_MISSING_PARENT_BUG_CONFIRMED` / `STAGE_6_WAVE_1_NOT_VERIFIED` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED`。唯一建议下一轮是最小修复 Node 项目存储的安全父目录创建与失败清理，补真实文件系统红灯；先提交修复和测试，再执行规定构建并只运行一次新的聚合路径。当前等待项目所有者明确授权，不自动施工。

### 4.58 第四次聚合失败独立复审：Node 存储修复有效，正式 preview 被 Stage 5 遗留服务占用（2026-08-13 23:59）

NodeProjectStorage 缺失父目录的最小修复已经完成。总经理独立确认生产提交 `a4ff12ec88bc99d8efa0cf98328cd7c453fd03a6` 只包含当前任务书、`packages/cli/src/authoring/node-project-storage.ts` 和新增真实文件系统测试；失败收口提交 `1bd80f9adf0a7206be2e8fb549496cacc8de0548` 只修改当前任务书。当前 tracked 工作树与暂存区干净，既有未跟踪治理/交接文件和本长期路线台账未进入提交，未 push。

实现复审未发现范围扩大：缺失父目录只允许在 `stageText()` staging 临界区逐段创建；现有父路径逐段执行 `lstat`/`realpath`/根边界校验；绝对路径、`..`、普通文件父级和 junction 被拒绝；临时文件仍与目标同目录；失败清理只尝试删除本轮新建且仍为空的目录，不递归删除预存目录或用户文件。公共 `ProjectWriteStorage` 合同、Core、authoring 公共生产代码、Renderer、editor、runner、Starter 和游戏内容均未修改。

总经理新鲜复核得到：CLI 的 `node-project-storage.test.ts` 与 `authoring-vertical-slice.test.ts` 共 `2` 个文件、`6` 个测试全部通过；CLI typecheck exit `0`；runner `node --check` exit `0`。前三份失败 artifact 的磁盘大小和 SHA-256 仍与历史记录完全一致，未被覆盖。

第四份失败 artifact 已从磁盘重新读取：

```text
path = C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-19zWJG\agent-ready-authoring-wave-1.json
bytes = 6930
sha256 = CF88B5F74C04C48207A9EBC25CFD316DB5AC1128B37DD484A66CE16DF73A89E3
status = FAILED
runHead = a4ff12ec88bc99d8efa0cf98328cd7c453fd03a6
choiceCoverage = 2/2
stateOutcomes = [-1, 1]
lastPassedNode = change.commit
firstFailedNode = editor.preview.server
preview = null
```

新 fixture `C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786636298921-51a12819c92f` 已实际产生 `21` 个文件；`content/scenario/agent_support.gal` 为 `60` bytes、SHA-256=`F79C9B2A8305E2C208A9C7485ACE23599983C75FB4B6A0AE3CF85AE0E8167CD9`，`game.config.json` 为 `1619` bytes、SHA-256=`BE77454A4A928C1ABC042BE531B29619667AB9F4ACE169467FDF71FB2A63F92B`，没有 `.surdet-*` 临时文件。这是正式公共能力链对 Node 存储修复的有效写盘证据；Node 缺失父目录缺陷不再是当前阻断点。

端口根因也已独立确认，不是未知系统服务：`127.0.0.1:4173` 的监听 PID `45380` 创建于 `2026-08-13 18:46:07`，真实命令行为 `node E:\surdet\packages\editor\node_modules\...\vite\bin\vite.js preview --host 127.0.0.1 --port=4173`，正是 Stage 5 人工验收时启动并保留的旧 Surdet editor preview。runner 拒绝抢占或关闭已有进程符合安全纪律；本次失败不要求修改生产代码或 harness。

正式 editor preview 尚未启动，因此空 page/console/request/renderer 错误通道不能算 Presentation 通过，Stage 6 Wave 1 仍未完成。下一动作必须等待项目所有者授权：行动前重新核对端口所有者仍是上述精确 PID/命令/创建时间，只关闭该旧 Surdet preview；若身份变化则不得关闭。确认端口释放后，不改代码、不改 runner、不重复构建，基于当前已提交 HEAD 执行一次新的唯一聚合路径。失败保留新 artifact 并停止；成功才继续 Task 8 Step 8 和 Task 9，仍不得代填人工验收或自动 push。

复审结论：`APPROVED_NODE_PROJECT_STORAGE_FIX` / `CONDITIONALLY_APPROVED_FOURTH_FAILURE_CLOSURE` / `NODE_PROJECT_STORAGE_FIX_VERIFIED_IN_AGGREGATE_COMMIT` / `EDITOR_PREVIEW_BLOCKED_BY_STALE_STAGE_5_SERVER` / `STAGE_6_WAVE_1_NOT_VERIFIED` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED`。当前等待项目所有者批准精确关闭旧 preview 服务和一次新聚合尝试，不自动执行。

### 4.59 第五次聚合失败独立复审：正式 preview 可加载，确认 runner 的 iframe 等待与失败清理竞态（2026-08-14 00:21）

项目所有者授权的旧服务关闭与单次聚合尝试已按纪律执行。执行 AI 在关闭前重新核对地址、PID、父 PID、创建时间、可执行文件和命令行，只停止已确认属于 Stage 5 的 PID `45380`；关闭后确认 PID 消失、4173 无监听且 URL 不可访问。随后未修改代码、测试或 runner，只运行一次新聚合；运行创建了全新 fixture 和 artifact，没有复用或覆盖前四份失败证据。

总经理独立回读当前状态：

```text
branch = main
HEAD = a355de5e96d00021dd636ca4754d1ec4d244f7a6
surdet/main = 5994ec7bd64b2106da6e47cd86e88fb4df82ed01
HEAD...surdet/main = 25 0
tracked worktree = clean
staging area = empty
latest commit = docs(authoring): record preview retry failure
latest commit files = 仅当前 Stage 6 Wave 1 任务书
```

第五份失败 artifact 已从磁盘重新读取：

```text
path = C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-rSVS8l\agent-ready-authoring-wave-1.json
bytes = 6796
sha256 = 8492595E5FBD2315CD634411224BC2D474E5D6C1AEAA263BD52A81E248D7FEF5
status = FAILED
runHead = 1bd80f9adf0a7206be2e8fb549496cacc8de0548
choiceCoverage = 2/2
stateOutcomes = [-1, 1]
lastPassedNode = editor.preview.server
firstFailedNode = editor.preview.renderer.paths.A-B
error = 正式 preview.html iframe 未加载
traceIds = []
preview = null
```

新 fixture `C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786637399319-8fd7d9a4b435` 有 `21` 个文件、没有 `.surdet-*` 临时文件；`agent_support.gal` 与 `game.config.json` 的身份仍分别为 `60/F79C9B2A...` 和 `1619/BE77454A...`。这再次证明 authoring、choice、CLI 事务与 Node 存储提交路径没有回归。第四份 artifact 仍为 `6930/CF88B5F7...`，前三份历史 artifact 也保持未覆盖。失败后经精确身份核对只停止本轮残留 runner PID `35324` 和 preview PID `6172`；当前 4173 无监听。

源码复核确认第一个 harness 缺陷：`page.goto(parentUrl, { waitUntil: 'domcontentloaded' })` 只保证父页 DOM 已就绪，随后 `runFormalPreview()` 立即用 `page.frames().find(frame.url().endsWith('/preview.html'))` 做一次性查找，没有等待 iframe 导航。正常的 iframe 异步加载稍慢时，frame 此刻仍为 `about:blank`/空 URL，于是被立即误判。

总经理在隔离的 `127.0.0.1:4174` 上用同一正式 editor dist 做了不写项目、不运行聚合的最小诊断，并人为加入普通的 `250ms` iframe 响应延迟。父页 `DOMContentLoaded` 后立即读取时，frame URL 列表为父页和空字符串、`immediateFound=false`；等待 iframe 导航后，URL 正确变为 `/preview.html`，正式 canvas 成功加载，标题为 `Surdet 预览`。诊断结束后 browser 与 4174 server 均关闭，4173/4174 无残留监听。这证明当前第一失败是 runner 等待语义竞态，不是 editor preview 或 Renderer 生产逻辑已被证明失败。

源码还确认第二个独立 harness 缺陷：失败发生在 browser 创建之后时，catch/finally 没有关闭 `previewBrowser`；preview server 通过 npm 包装进程启动，finally 仅 `child.kill()` 且不等待实际 Vite 子进程退出。因而 FAILED artifact 已在约十秒内落盘，Node 命令仍被 Playwright/Vite 句柄保持至外部工具约 124 秒超时，随后需要精确清理残留 runner/server。下一轮必须同时修正失败生命周期；否则即使 iframe 等待修正，后续任一失败仍可能挂住命令和遗留服务。

正确的最小修正只落在 Task 8 runner：先等待 `#stage6-preview-frame` 附着并导航到正式 `/preview.html`，再取得 frame、等待 canvas 和 `surdet-preview-ready`；不得用固定 sleep。失败/成功退出时必须按所有权关闭 Playwright browser，并可靠终止/等待本轮启动的 preview 服务；成功进入 Task 8 Step 8 时才按原计划显式保留人工入口。必须先补 runner 自检或独立聚焦红灯证明延迟 iframe 不再误判、失败路径不会残留 browser/server，再提交 runner 与任务书，运行语法/自检和规定构建，最后只运行一次新聚合。

复审结论：`CONDITIONALLY_APPROVED_FIFTH_FAILURE_CLOSURE` / `FORMAL_EDITOR_PREVIEW_LOADABLE_IN_ISOLATED_DIAGNOSTIC` / `HARNESS_IFRAME_WAIT_RACE_CONFIRMED` / `HARNESS_FAILURE_CLEANUP_LEAK_CONFIRMED` / `STAGE_6_WAVE_1_NOT_VERIFIED` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED`。当前等待项目所有者授权 runner 最小修正，不自动施工或重跑。

### 4.60 第六次聚合失败独立复审：iframe/清理修正有效，确认正式 Vite 工作目录接线错误（2026-08-14 00:51）

项目所有者授权的 Task 8 runner iframe 等待与失败清理最小修正已完成。总经理独立确认 runner 证据提交 `d193ad790ac7f60202f6489e4773edb05c52579c` 只包含当前任务书和 `packages/shell/e2e/agent-ready-authoring-wave-1.e2e.mjs`；失败收口提交 `01def6d4f2d508eb452bb1ecb1a5866a8bc5eaeb` 只修改当前任务书。tracked 工作树与暂存区干净，未 push，长期路线台账和受保护文件未进入提交。

上一轮修正本身有效：正式等待已改为 iframe attached → `contentFrame()` → pathname 精确 `/preview.html` → canvas → `surdet-preview-ready`；失败清理现在关闭 browser、终止并等待本轮精确 child，命令自然 exit `1`，没有再出现外部 124 秒 timeout。总经理在最终落盘 runner 上新鲜运行 `--preview-harness-self-check`，得到 `PREVIEW_HARNESS_SELF_CHECK_PASSED`、`browserDisconnected=true`、`childExited=true`，结束后 4174 无监听。执行 AI 的正式失败后复核也确认 4173/4174、runner、Vite 和本轮 Chromium 均无残留，不需要外部 `Stop-Process`。

第六份失败 artifact 已从磁盘重新读取：

```text
path = C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-XiRkyp\agent-ready-authoring-wave-1.json
bytes = 7069
sha256 = C22C3A8895B313CAADE3F7D52D131D831E080E0822A4F39BC033A4F44C5DB8BE
status = FAILED
runHead = d193ad790ac7f60202f6489e4773edb05c52579c
choiceCoverage = 2/2
stateOutcomes = [-1, 1]
lastPassedNode = change.commit
firstFailedNode = editor.preview.server
error = The directory "dist" does not exist. Did you build your project?
traceIds = []
preview = null
```

新 fixture `C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786639517792-5bc8a2a4f998` 有 `21` 个文件、`content/scenario` 已提交且没有 `.surdet-*`；目标场景和配置身份仍为 `60/F79C9B2A...` 与 `1619/BE77454A...`。六份 FAILED artifact 的路径、字节数和 SHA-256 均从磁盘重新读取并保持未覆盖。由此再次确认 choice、CLI 双分支、事务、NodeProjectStorage 和 `change.commit` 没有回归；正式 editor preview 尚未启动，空错误通道不构成 Presentation 证据。

源码根因明确位于 runner 接线：正式 Vite CLI 路径正确指向 `packages/editor/node_modules/vite/bin/vite.js`，editor 构建产物也真实存在于 `packages/editor/dist`；但 `startPreviewServer()` 的 spawn 仍使用 `cwd=repoRoot`，Vite 因而在 `E:\surdet\dist` 查找产物并失败。当前 `editorDist` 常量已存在但没有被使用。

现有自检没有捕获它，是因为 `--preview-harness-self-check` 启动的是 runner 内另造的最小 Node HTTP server `startHarnessSelfCheckServer()`，并不调用正式 `startPreviewServer()` 或 Vite CLI。它有效验证了 iframe 等待与清理，却无法验证正式 launcher 的 CLI、cwd、dist、HTTP title 或真实静态资源入口。

总经理在隔离 4174 端口以不写项目、不运行聚合的方式直接复核同一正式 Vite CLI：将 `cwd` 设置为 `E:\surdet\packages\editor` 后，`/preview.html` 返回 HTTP `200`，标题匹配 `Surdet 预览`，精确 child 能正常终止且端口无残留。这证明下一修正应为 runner 工作目录接线，不是 editor、Renderer、Core 或构建产物缺失。

唯一建议下一轮：在 runner 定义 `editorRoot`，让正式 Vite spawn 使用该工作目录，并让 `--preview-harness-self-check` 复用同一个正式 `startPreviewServer(4174)`，删除或停止使用绕过正式 launcher 的最小 HTTP server；自检前先构建 editor 并显式核对 `editorDist/preview.html`。提交 runner 与任务书后只做 runner 语法/两类自检和 editor 构建，不重复无关 Core/authoring/CLI/Renderer 构建，然后只运行一次新聚合。不得通过 `--outDir`、fallback cwd、复制 dist 或额外 server 路径掩盖工作区接线错误。

复审结论：`CONDITIONALLY_APPROVED_SIXTH_FAILURE_CLOSURE` / `HARNESS_IFRAME_WAIT_FIX_VERIFIED` / `HARNESS_FAILURE_CLEANUP_FIX_VERIFIED` / `HARNESS_VITE_CWD_BUG_CONFIRMED` / `FORMAL_EDITOR_PREVIEW_NOT_REACHED` / `STAGE_6_WAVE_1_NOT_VERIFIED` / `TASK_8_STEP_8_NOT_STARTED` / `TASK_9_NOT_STARTED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED`。当前等待项目所有者授权一次 runner 工作目录与正式 launcher 自检覆盖的最小收口，不自动施工或重跑。

### 4.61 项目所有者反馈串行正式重试不可接受；区分 harness 诊断稳定化与最终正式取证（2026-08-14 00:55）

项目所有者明确反馈，当前“只修一个已知 harness 问题 → 只允许一次正式聚合 → 在下一个 harness 问题处停止 → 再写报告和提交”的节奏像无休止轮回，已经造成明显时间浪费。该反馈成立：正式证据的单次性原本用于防止筛选结果和掩盖失败，不应被误用为禁止测试设施在开发期反复调试。把尚未稳定的测量设施每次运行都提升为正式验收，只会连续生产无效的失败 artifact 和文档收口，并不能更快证明产品能力。

总经理修正后采用两级证据：

1. `DIAGNOSTIC` 仅用于稳定 Task 8 runner。范围冻结为当前 runner 与当前任务书，生产代码、Core、Renderer、Host、editor 业务逻辑、authoring、CLI 和 Zero 均不得借机修改。允许在同一施工轮内修正 runner 后重复运行完整 A/B 预览诊断链，不要求每次尝试单独提交或写一份正式交付报告；每次失败仍使用唯一临时路径保存，不得覆盖，但只需在该轮结束时汇总最后通过节点、第一个失败节点和必要 artifact 身份。
2. `FORMAL` 才是 Stage 6 Wave 1 的正式聚合证据。只有完整诊断链已经证明 A/B 两条公开路径、可见 Presentation、trace/evidence 和失败清理全部通过，且 runner 已作为固定证据 HEAD 提交后，才允许在全新 fixture 上运行一次正式聚合。诊断绿灯不得冒充正式通过，正式失败也不得被诊断结果覆盖。

诊断施工必须有边界，不能变成另一种无限循环：一个施工轮最多执行五次完整诊断聚合；如果同一阻断连续出现两次、证据指向生产缺陷、需要越过文件白名单，或五次后仍未全绿，立即停止并交总经理复审。已知的 Vite `cwd` 修正和让 self-check 复用正式 launcher 应先完成；随后直接验证完整 editor preview A/B 链，而不是继续为每个局部节点建立另一套替身 server。诊断全绿后统一运行语法、自检、editor 构建等聚焦验证，只创建一次 runner/任务书提交，再做一次新鲜正式聚合。

这项治理纠偏不等于批准 Stage 6 Wave 1、Task 9 或人工验收，也不允许 push、部署、打包、发行、音频、性能、扩展市场或 Wave 2。它只是取消低效的“一个 harness 小修对应一次正式取证和一次文档提交”，恢复测试设施应有的开发—稳定—冻结—正式取证顺序。

当前状态：`OWNER_FEEDBACK_SERIAL_FORMAL_RETRY_LOOP_TOO_COSTLY` / `NO_MORE_ONE_FIX_ONE_FORMAL_RUN` / `HARNESS_DIAGNOSTIC_STABILIZATION_RECOMMENDED` / `FORMAL_SINGLE_RUN_RESERVED_FOR_FINAL_EVIDENCE` / `STAGE_6_WAVE_1_NOT_VERIFIED` / `WAITING_FOR_OWNER_BOUNDED_HARNESS_STABILIZATION_AUTHORIZATION` / `NOT_PUSHED`。

### 4.62 总经理承认“正式取证前置预检缺失”是流程责任，建立跨主题防复发规则（2026-08-14 00:59）

项目所有者进一步指出：当前问题之所以令人疲惫，不只是失败次数多，而是总经理明明可以从错误形态提前看出更便宜、更可靠的验证方式，却仍按旧规约把每个小修正直接送进一次昂贵的正式聚合。该批评成立。`editor.preview.server` 在正式取证前暴露 Vite `cwd`、`dist` 或 launcher 接线问题，本来就应由低成本的同入口预检捕获；把它留给正式聚合才发现，是验证顺序设计错误。

从本条起，适用于后续所有 harness、跨层集成和真实路径任务的硬规则为：

1. **正式证据前必须先做入口一致性预检。** 预检必须调用与正式路径相同的 launcher、相同的工作目录、相同的构建产物和相同的公开入口；不接受另造一个能通过的替身 server、不同 cwd、不同 HTML 或只测内部函数的自检。
2. **先验证便宜而确定的边界，再消耗正式轮次。** 顺序固定为：文件/目录与 build 产物 → launcher 启动和退出 → HTTP/页面入口 → iframe/DOM/Presentation → A/B 公开路径与 evidence → 失败清理 → 最后才是正式聚合。任何前置边界未验证，不得把正式聚合当作“探路”。
3. **“单次正式运行”只约束最终证据，不约束开发期诊断。** harness 尚未稳定时，允许在任务白名单和有界次数内反复跑完整诊断；正式 artifact、正式报告和提交收口留到诊断全绿之后统一完成。
4. **看到确定性接线错误时先停下来重排验证，不继续机械执行旧流程。** 执行 AI 报告中的“只运行一次”若会让一个可在本地几秒确认的路径错误变成正式失败，应由总经理立即改写任务书，而不是把纪律理解为必须浪费一次正式轮次。
5. **每轮施工前增加“方法选择检查”。** 总经理必须明确写出：当前要证明的命题是什么、哪一步是最低成本的反证、正式运行是否真的必要、当前自检是否复用正式入口。无法回答时先调查，不开始大成本运行。

这不是放宽质量标准，而是把质量证据放到正确的层级：诊断负责发现和修正，正式运行负责冻结后的可信证明。当前状态追加：`PROCESS_FAILURE_ACKNOWLEDGED_BY_MANAGER` / `PREFLIGHT_BEFORE_FORMAL_EVIDENCE_REQUIRED` / `SHARED_FORMAL_LAUNCHER_SELF_CHECK_REQUIRED` / `METHOD_SELECTION_REVIEW_REQUIRED`。

### 4.63 质量第一，额度效率第二（2026-08-14 01:04）

项目所有者明确决定：**质量始终是第一优先级；只要质量不受影响，节省模型额度就是仅次于质量的第二优先级。**

该原则要求总经理和执行 AI：

1. 优先采用能证明同一命题的最低成本方法，先做定向读取、聚焦验证和入口一致性预检，再决定是否需要扩大上下文、测试或模型强度。
2. 不重复转述已知报告，不为同一事实反复生成长文档，不在已有证据足够时继续追加无收益的测试、哈希、矩阵或解释。
3. 日常复审、台账、任务书和低风险修改默认使用足够完成任务的轻量方式；只有高风险架构判断、跨层生产缺陷、数据安全或不可逆操作确有需要时，才提高推理和验证成本。
4. 可并行或复用已有结果时减少重复读取与重复运行；但不得以节省额度为理由跳过真实 HEAD/工作树核对、必要红灯绿灯、正式玩家路径、数据安全检查或项目所有者的视觉/声音/手感验收。
5. 每次建议高成本动作前说明它新增证明什么；若不能指出新的质量收益，就不执行。

当前状态追加：`QUALITY_IS_HIGHEST_PRIORITY` / `TOKEN_EFFICIENCY_IS_SECOND_PRIORITY_WHEN_QUALITY_UNCHANGED` / `NO_COST_WITHOUT_INCREMENTAL_EVIDENCE`。

### 4.64 Stage 6 Wave 1 FORMAL 证据有条件批准；确认 Starter 类型红灯与人工入口 URL 错位（2026-08-14 01:32）

总经理按磁盘与 Git 独立复审后确认：

- runner 证据提交 `b9d9703e1c442cb927b59fd53026638a4345680d` 只修改当前任务书与 Task 8 runner；文档提交 `b88d45a2b8af0d59bd79a5de82983de04cd710d0` 只新增交付报告并更新当前任务书。最终 tracked 工作树和暂存区干净，未 push。
- FORMAL artifact `C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-1-EdIstQ\agent-ready-authoring-wave-1.json` 从磁盘重新读取为 `7591` bytes、SHA-256=`77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0`、`status=PASSED`、`evidenceClass=FORMAL`、`runHead=b9d9703e1c442cb927b59fd53026638a4345680d`。A 使用真实键盘得到 `Agent 路径 A 后续台词。` 与 `trust=1`；B 使用真实鼠标得到 `Agent 路径 B 后续台词。` 与 `trust=-1`；coverage=`2/2`，六类错误通道为空。当前磁盘 runner blob 与 FORMAL runHead 中 runner blob 一致，`node --check` exit=`0`。
- 三次有界 DIAGNOSTIC 的磁盘枚举与报告一致：两次独立失败后一次 PASSED，随后只有一份 `evidenceClass=FORMAL` 的新 artifact。由此批准“Task 8 harness 已稳定”和“FORMAL A/B editor preview 纵向路径已通过”，但不把它写成人工验收通过。
- `npm run typecheck -w surdet-starter` 已由总经理新鲜复现 exit=`2`：`examples/starter/src/surdet-window.d.ts` 中 `window.surdetSave` 只有 `list/read/write/delete/listMeta`，而公共 `ElectronSaveBridge` 与 Shell preload 已包含 `listBackupMeta/restoreBackup`。这是 Stage 3 后遗留的 Starter 公共类型声明同步缺口，不是 Stage 6 A/B Presentation 失败，但它真实阻断 Task 9 全仓门禁，必须最小修正后才能宣布 Task 9 收口。
- 当前 PID `36436` 的 Vite server 仍监听 4173；`http://127.0.0.1:4173/preview.html` 返回标题 `Surdet 预览`，只适用于聚合 preview。16 步人工清单需要打开项目、选择 fixture、对象/轨迹双向定位、编辑、保存和重开，正确入口是 `http://127.0.0.1:4173/`，已实测 HTTP 200、标题 `Surdet 剧本编辑器`。当前交付报告把 `/preview.html` 写成人工入口，必须在邀请项目所有者验收前更正。

复审结论：有条件批准 Stage 6 Wave 1 的实现与 FORMAL 自动化证据；不批准 Task 9 全仓门禁通过，不开始人工验收，不进入 Wave 2。下一步只建议一个最小收口主题：补齐 Starter 的两项类型声明，先让 Starter typecheck 变绿，再只运行一次 `verify:all`；同时把任务书与交付报告中的人工入口改为 editor 根地址。不得重跑 FORMAL 聚合，不修改 Core/Host/Shell runtime，不扩大到其它主题。

当前状态追加：`CONDITIONALLY_APPROVED_STAGE_6_WAVE_1_FORMAL_DELIVERY` / `FORMAL_AGENT_READY_A_B_PRESENTATION_VERIFIED` / `STARTER_SAVE_BRIDGE_DECLARATION_STALE_CONFIRMED` / `TASK_9_VERIFY_ALL_NOT_GREEN` / `HUMAN_ACCEPTANCE_ENTRY_MUST_USE_EDITOR_ROOT` / `HUMAN_ACCEPTANCE_DEFERRED_FOR_MINIMAL_CLOSURE` / `WAITING_FOR_OWNER_STARTER_TYPE_AND_DOC_CLOSURE_AUTHORIZATION`。

### 4.65 Starter 类型收口批准；确认 Stage 6 共享模拟丢失 GrowthSystem 接线（2026-08-14 01:49）

执行 AI 的最小收口提交 `43964488196d685c1efe31bfcd4483651b22c12c` 经独立复核只修改 Starter 类型声明、当前任务书和当前交付报告；三份文件的磁盘字节数与 SHA-256 均匹配报告，tracked 工作树与暂存区干净，未 push。总经理新鲜运行 `npm run typecheck -w surdet-starter` 得到 exit=`0`，因此批准 `STARTER_SAVE_BRIDGE_DECLARATION_ALIGNED`。人工入口文档也已正确区分 editor 根地址 `/` 与 FORMAL preview `/preview.html`，当前 PID `36436` 的 4173 服务仍可访问。

新的 `npm run simulate -w surdet-starter` 已独立复现 exit=`1`，错误为 `ch02.gal:14:1 @exp 需要宿主注入 GrowthSystem`。历史与源码对比确认：Starter 的 `@exp` 和 `growth.json` 自 2026-08-05 起已存在；Stage 6 之前的 CLI simulate 会读取 `content/config/growth.json`、构造 `GrowthSystem` 并注入 `Interpreter`。Stage 6 提交 `e1e3129 feat(authoring): add validation simulation and evidence` 把 CLI simulate 重构成共享 authoring 模拟薄包装时删除了该接线，而当前 `ProjectSnapshot` 也排除了 `content/config/growth.json`，`@surdet/authoring` 的 `runtimeFor()` 只构造无 GrowthSystem 的 Interpreter。由此认定该红灯是 Stage 6 的共享模拟能力回退，不能删除 Starter 的 `@exp`、伪造初始变量、忽略 runtime error 或只在 CLI 复制第二套模拟器来掩盖。

正确公共层落点是 `@surdet/authoring`：让项目快照包含当前真实需要的 growth 配置，由共享 simulation runtime 解析并构造 Core `GrowthSystem`，从而同时服务 CLI 旧外观、外部 Agent 的 `project.simulate` 和未来 editor 调用；CLI 只负责把 Node 文件系统中的 growth 配置纳入同一快照，不重新拥有系统语义。无 growth.json 的项目仍应保持当前严格行为：若剧本使用 `@exp`，继续报告缺少 GrowthSystem，而不是建立 fallback。

为避免再次出现“修一个节点、正式门禁再暴露下一个节点”的低效循环，本轮修复完成后必须先聚焦验证 Starter simulate，再分别预检 `verify:all` 中其后的 `verify:formal`、editor build、Starter build 和 Zero build；这些后续节点全部通过后，才运行一次最终 `verify:all`。若任一预检失败，在同一有界诊断轮内按范围判断，不能把 `verify:all` 当探路工具。FORMAL A/B 聚合不受该 CLI 共享模拟修复影响，不重跑。

当前结论：批准 Starter 类型与入口文档收口；不批准 Task 9 全仓门禁通过，不开始人工验收，不进入 Wave 2。当前状态追加：`STARTER_SAVE_BRIDGE_DECLARATION_ALIGNMENT_APPROVED` / `STAGE_6_SHARED_SIMULATION_GROWTH_REGRESSION_CONFIRMED` / `SHARED_AUTHORING_GROWTH_RUNTIME_FIX_REQUIRED` / `VERIFY_REMAINDER_PREFLIGHT_REQUIRED` / `HUMAN_ACCEPTANCE_DEFERRED_FOR_STAGE_6_REGRESSION_FIX` / `WAITING_FOR_OWNER_SHARED_GROWTH_SIMULATION_FIX_AUTHORIZATION`。

### 4.66 GrowthSystem 修复批准；独立复审发现共享模拟路径证据为零的语义缺陷（2026-08-14 02:15）

执行 AI 的共享 GrowthSystem 修复提交 `d8b20de25d190edcd2c246254bce288a942d888e` 与文档闭合提交 `823b19af744d8ea59c5ba640eea0d6b46482624a` 经独立复核范围正确：公共语义落在 `@surdet/authoring`，CLI 只做 Node 配置适配，Starter/Core/Renderer/Host/Shell/editor/Zero 和 FORMAL runner 未修改。任务书与交付报告磁盘身份匹配；最终 HEAD 上 authoring 2 files/7 tests、CLI 1 file/8 tests和 Starter simulate 均新鲜 exit=`0`；既有 FORMAL artifact 仍为 `7591` bytes、SHA-256=`77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0`、`status=PASSED`、`runHead=b9d9703e1c442cb927b59fd53026638a4345680d`。因此批准 `STAGE_6_SHARED_GROWTH_SIMULATION_RESTORED`，并接受本轮唯一 `verify:all` 确实 exit=`0` 的事实。

但最终落盘命令 `npm run simulate -w surdet-starter` 同时输出：路径探索 `0`、choice 覆盖 `2/3`、状态签名剪枝 `7` 次、存档往返 `25` 次、结局 `demo_end` 达成 `12` 次、运行时错误 `0`。直接读取结构化 `simulateProject()` 结果也确认 `pathsExplored=0`。该证据不可能同时为真：已经探索 choice、完成多次快照往返并触发结局的模拟不能报告零条探索路径。

源码根因位于 Stage 6 提交 `e1e3129` 引入的共享 `@surdet/authoring` simulation：`paths` 只在 ended/idle/error 时追加，状态签名重复分支执行 `cyclesPruned++` 后直接返回，不记录结果；CLI 又用 `report.paths.length` 作为 `pathsExplored`。同时 `maxPaths` 也以终止结果数而非实际开始探索的根/choice 分支计数，导致路径预算契约在循环/剪枝项目上失真。既有循环测试只断言 `pathsExplored < 10`，错误地允许 `0`，所以 `verify:all` 绿灯没有发现语义缺陷。

这直接影响 Stage 6 的核心产品承诺：外部 Agent 读取 `project.simulate` 时必须得到可信的覆盖、状态结果、场景出口和预算证据。修复应继续落在共享 authoring simulation，而不是只改 CLI 显示：分离“实际开始探索的路径/分支计数”与“终止路径结果数组”；根路径与每次真正进入的 choice 分支都应按明确规则计数并用于预算；状态签名剪枝必须在报告中留下非失败、可解释的路径结果或明确剪枝结果，不能悄悄消失。CLI 只映射共享计数。需要新增循环 Starter 等价测试，禁止 `pathsExplored=0` 与可达结局并存，并验证低预算确实按探索数停止。

复审结论：有条件批准 GrowthSystem 修复与 `verify:all` 命令通过事实；不批准 Stage 6 Wave 1 最终完成，不开始 16 步人工验收，不进入 Wave 2。下一步只授权共享模拟路径计数/剪枝证据最小收口；不修改 GrowthSystem、Starter、FORMAL、editor 或其它系统，不再次重复前置大矩阵。当前状态追加：`SHARED_GROWTH_SIMULATION_FIX_APPROVED` / `VERIFY_ALL_EXIT_ZERO_CONFIRMED` / `SHARED_SIMULATION_ZERO_PATH_EVIDENCE_BUG_CONFIRMED` / `AGENT_SIMULATION_EVIDENCE_NOT_YET_TRUSTWORTHY` / `HUMAN_ACCEPTANCE_DEFERRED_FOR_PATH_EVIDENCE_FIX` / `WAITING_FOR_OWNER_SHARED_PATH_EVIDENCE_FIX_AUTHORIZATION`。

### 4.67 共享模拟路径证据修复批准；Stage 6 Wave 1 进入项目所有者人工验收（2026-08-14 02:35）

执行 AI 的实现提交 `9ca3a2f050969fe5bd02996b31dc212ac7662e4b` 与文档闭合提交 `55a514d24cf32124b2c9b67652884bf0d0283c25` 已通过总经理独立复审。实现提交只修改共享 authoring simulation、CLI 薄映射及其合同测试和本轮文档；闭合提交只修改任务书与交付报告。Core、Renderer、Host、Shell、editor、Zero、Starter、GrowthSystem 接线、FORMAL/DIAGNOSTIC runner、长期路线台账和受保护文件均未进入这两笔提交。

共享语义现已把“实际开始探索的根/choice 分支数”与“路径结果数组”分开：根路径计数为 `1`，每个实际进入的 choice 分支在进入前计数，`maxPaths` 使用共享 `pathsExplored`；状态签名剪枝与预算剪枝分别保留 `termination=pruned` / `prunedReason=state-signature` 和 `termination=budget-exhausted` / `prunedReason=path-budget` 的显式非失败结果。CLI 直接映射 `report.pathsExplored`，没有第二套模拟器。独立新鲜验证为：authoring simulation `6/6`、CLI simulate `9/9`、Starter simulate 均 exit=`0`；Starter 输出探索 `13` 条、状态签名剪枝 `7` 次、choice 覆盖 `2/3`、存档往返 `25` 次、`demo_end` 可达 `12` 次、运行时错误 `0`。本轮执行 AI 报告的唯一 `verify:all` exit=`0` 与任务文档记录一致，予以接受，不再重复高成本全仓门禁。

既有 FORMAL artifact 只读复核仍为 `7591` bytes、SHA-256=`77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0`、`status=PASSED`、`evidenceClass=FORMAL`、`runHead=b9d9703e1c442cb927b59fd53026638a4345680d`，未重跑或覆盖。人工入口 `http://127.0.0.1:4173/` 返回 HTTP `200`、标题为“Surdet 剧本编辑器”，监听 PID=`36436`；隔离项目 `C:\Users\Equinox\Desktop\surdet-stage6-agent-fixture-1786641370693-4e4e09d75522` 存在，并包含 `agent_support.gal`、`ch01_01.gal` 和 `game.config.json`。

复审结论：批准 `STAGE_6_SHARED_SIMULATION_PATH_EVIDENCE_RESTORED`、`STARTER_SIMULATION_PATH_COUNT_TRUSTWORTHY`、`TASK_9_VERIFY_ALL_PASSED` 与 `FORMAL_AGGREGATE_REMAINS_VALID`；Stage 6 Wave 1 的自动化与工程证据已达到人工验收入口。现在授权项目所有者使用真实 Chrome/Edge 完成任务书中的 16 步路径；执行 AI 不得代填视觉、交互、保存或重开结论。

**强制提醒点：** 项目所有者现在必须打开编辑器根地址 `/`，选择上述桌面隔离项目，确认双场景、无 UUID 噪声、对话与 choice 的双向因果定位、A/B 两条真实预览结果、手工编辑、保存和刷新重开的持久化闭环。若全程正常，只需报告“Stage 6 Wave 1 人工验收通过”；若异常，只报告第一个异常、触发动作、实际现象与必要截图。在收到结果前不得宣布 Stage 6 Wave 1 最终完成、不得进入 Wave 2、不得 push、部署、音频、性能或发行。

### 4.68 项目所有者人工路径部分通过；Stage 6 Wave 1 被因果桥真实红灯阻断（2026-08-14 03:01）

项目所有者已使用真实 Chrome/Edge、编辑器根地址和桌面隔离 fixture 完成授权的 16 步路径。已通过的事实包括：正确打开项目、两个 Agent 场景存在、`.gal` 无持久 UUID 污染、路径 A/B 显示不同可见台词、手工修改能在保存前进入真实预览、保存成功、刷新重开后修改仍在且无脏标记。以上人类路径结果与既有 FORMAL A/B Renderer 证据、共享模拟及保存证据一致，继续有效。

人工验收同时发现两个真实因果桥问题。其一，右侧因果区缺少明确“当前对象”标签，只显示内部 revision-scoped objectRef；路径 A/B 分别显示 `scene:ch01_01/choice-option:5@e3a34dd6-e7122dd0` 与 `scene:ch01_01/choice-option:6@e3a34dd6-4bc5d719`，但没有显示选项实际引用的变量 `trust` 与目标标签 `path_a` / `path_b`。只读源码确认共享 `@surdet/authoring` object-index 对 choice-option 仅以正则识别 `->` 后立即出现的 `@goto/@jump`，不能处理当前真实形状 `-> @set trust = ... @goto path_*`，因此同时漏掉 effect 和最终跳转关系；editor `right.ts` 也只输出裸 objectRef，未提供可读“当前对象”说明。

其二，项目所有者点击“因果轨迹”下所有事件均不会切回块编辑或定位对象。只读源码已确认这是确定性装配错误：preview panel 对 `document` 执行 `dispatchEvent('surdet-preview-trace-select')`，main 却在 `window` 上监听；该 `CustomEvent` 默认不冒泡，因此事件永远到不了监听器。现有 editor 测试只验证 `filterTraceByObject` / `locateObjectForTraceEvent` 纯函数，没有覆盖真实 DOM 发出—监听—切页—定位链，故自动化绿灯没有发现该问题。

经理结论：`PARTIAL_HUMAN_ACCEPTANCE_PASSED`，但不批准 `STAGE_6_WAVE_1_HUMAN_ACCEPTANCE_PASSED` 或整轮完成。下一步只处理一个有界因果桥修复：公共 authoring object-index 解析 choice effects 与最终跳转，editor 因果面板显示可读当前对象和直接关系，统一轨迹事件的 DOM 目标并补足聚焦装配测试；不修改 Starter fixture 内容来绕过解析，不复制第二套对象索引，不重跑 FORMAL、`verify:all`、性能或其它大矩阵。修复后只要求项目所有者复测失败的第 5、6、8 步，不重复已通过的打开、A/B、编辑、保存与重开路径。当前状态追加：`STAGE_6_WAVE_1_PARTIAL_HUMAN_ACCEPTANCE_PASSED` / `CAUSAL_OBJECT_RELATIONS_MISSING` / `CAUSAL_TRACE_REVERSE_SELECTION_BROKEN` / `STAGE_6_WAVE_1_HUMAN_ACCEPTANCE_BLOCKED` / `STAGE_6_WAVE_2_NOT_STARTED` / `NOT_PUSHED`。

### 4.69 因果桥最小修复完成聚焦验证；等待项目所有者三点复测（2026-08-14 03:13）

项目所有者已授权主经理 AI 亲自施工。共享 `@surdet/authoring` object-index 不再用仅识别箭头后立即 goto/jump 的局部正则，而是复用 Core `parseInlineInstructions` 提取 choice effects 与第一个有效跳转；项目所有者真实桌面 fixture 的路径 A 现在索引为 `[variable:trust,label:ch01_01.path_a]`，路径 B 为 `[variable:trust,label:ch01_01.path_b]`。editor 因果区新增“当前对象”、可读对象名、场景/行号和次要内部 objectRef，直接引用显示为“变量 trust”“标签 path_a（ch01_01）”等；preview/main 通过同一个事件桥在同一 `window` 目标发出与监听轨迹选择，不再存在 document/window 断链。

与人工症状匹配的红灯已先运行：authoring 新关系断言真实得到空数组并失败；editor 事件桥与可读对象说明因尚不存在而失败。修复后 authoring 3 files/6 tests、editor 3 files/7 tests 全绿，两个工作区 typecheck/build 均 exit=`0`；新 editor bundle 已由保留的 PID `36436` 在 4173 根入口提供，HTTP `200`、标题“Surdet 剧本编辑器”。本轮没有 FORMAL/DIAGNOSTIC、`verify:all`、Electron、性能、pack、部署或发行。

当前自动化证明共享关系与 DOM 事件通道已对齐，但不能代替项目所有者确认画面跳转和可读性。创建精确本地提交后，强制提醒项目所有者只复测：点击普通台词能看到明确“当前对象”；路径 A/B 能看到 `trust + path_a/path_b`；运行任一路径后点击因果轨迹事件能切回块编辑并选中相应对象。其余已经通过的 A/B 可见画面、编辑、保存和重开不再重复。当前状态：`STAGE_6_CAUSAL_BRIDGE_FIX_IMPLEMENTED` / `FOCUSED_TESTS_TYPECHECK_BUILDS_PASSED` / `HUMAN_CAUSAL_BRIDGE_RETEST_PENDING` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_STARTED`。

### 4.70 Stage 6 Wave 1 人工验收通过；启动最长六天的临时 AI 接班（2026-08-14 03:23）

项目所有者已按要求只复测此前失败的因果桥三点，并明确反馈“非常顺利”。据此确认：右侧因果区能够显示可读“当前对象”；路径 A/B 能分别显示 `trust + path_a` 与 `trust + path_b` 的直接关系；点击因果轨迹事件能够返回块编辑并定位相应对象。结合 4.68 已通过的项目打开、双场景、无 UUID 噪声、A/B 不同可见文本、保存前真实预览、保存及刷新重开的路径，Stage 6 Wave 1 项目所有者人工验收现已完整通过。

因果桥代码证据提交为 `dd54667a6f6024e98979417f388aa6c2180d7e3a fix(editor): restore causal authoring bridge`；提交后文档闭合为 `3da114754c37e83e624649e2391c7f03acc12e0f docs(editor): close causal bridge ledger`。当前分支 `main`，`surdet/main=5994ec7bd64b2106da6e47cd86e88fb4df82ed01`，ahead/behind=`36 0`。未执行 push；本地提交链显著领先远端，任何普通 push 前仍必须由项目所有者明确授权并核对整条拟推送范围，不能只因 Wave 1 人工验收通过就自动推送。

项目所有者同时决定：由于当前 Codex 额度即将耗尽，临时转由 DeepSeek V4 的“总经理 AI + 执行 AI”双角色接班，最晚六天后交还 Codex；在额度尚存期间，Codex 可以复审临时团队交付，项目所有者若不满意可立即撤换。临时接班是执行载体变化，不是路线、产品方向、Git 权限或阶段授权变化。临时总经理必须独立复审当前 HEAD 与本轮闭合，再向项目所有者提出唯一下一步；临时执行 AI 未收到书面任务前只可做只读 Task 0。两者都不得自行进入 Stage 6 Wave 2、push、部署、打包、发行、音频、性能、扩展市场或其它主题。

已生成两份角色专用交接书：

- `docs/handoff-20260814-032328-temporary-general-manager.md`
- `docs/handoff-20260814-032328-temporary-execution-ai.md`

当前状态追加：`STAGE_6_WAVE_1_HUMAN_ACCEPTANCE_PASSED_BY_OWNER` / `CAUSAL_BRIDGE_HUMAN_RETEST_PASSED` / `STAGE_6_WAVE_1_READY_FOR_FINAL_MANAGER_CLOSURE` / `TEMPORARY_DEEPSEEK_MANAGER_AND_EXECUTOR_HANDOFF_PREPARED` / `TEMPORARY_HANDOFF_MAX_SIX_DAYS` / `CODEX_RETURN_REQUIRED_NO_LATER_THAN_2026_08_20` / `NOT_PUSHED` / `STAGE_6_WAVE_2_NOT_AUTHORIZED`。

### 4.71 已验收基线完成普通 push；临时接班仍不得扩大权限（2026-08-14 03:28）

项目所有者明确要求先 push，以便 DeepSeek V4 临时团队施工失误时可以回退。经理在推送前重新检查了远端，没有发现新提交；使用普通 `git push surdet main:main`，未使用 force push。远端返回：`5994ec7..3da1147 main -> main`；随后 `git ls-remote surdet refs/heads/main` 实测为 `3da114754c37e83e624649e2391c7f03acc12e0f`，与本地 `HEAD` 完全一致，ahead/behind=`0 0`。

本次 push 只包含已经提交的本地历史，未包含工作树中尚未提交的 Stage 6 最终闭合文档、长期路线台账、临时总经理/执行 AI 交接书、受保护文件、`.learnings/` 或 `.dsh` 临时附件。推送后的稳定回退锚点是 `3da114754c37e83e624649e2391c7f03acc12e0f`；这些未提交治理文件继续保留在本地，未经单独授权不得清理、暂存或提交。

当前状态追加：`PUSH_COMPLETED_FOR_VERIFIED_BASELINE` / `REMOTE_MAIN_AT_3DA1147` / `LOCAL_REMOTE_SYNCED` / `STAGE_6_WAVE_1_HUMAN_ACCEPTANCE_PASSED_BY_OWNER` / `STAGE_6_WAVE_2_NOT_AUTHORIZED` / `TEMPORARY_HANDOFF_MAX_SIX_DAYS`。

### 4.72 临时总经理独立复审批准；临时执行 AI Task 0 合规（2026-08-14 03:47）

DeepSeek V4 临时总经理按交接书完成了 A 级只读复审，明确结论为“批准 Stage 6 Wave 1 最终闭合”。其复核覆盖 Git 身份、`dd54667` 代码证据提交、`3da1147` 文档闭合提交、既有 FORMAL artifact、桌面 fixture 与当前两份 tracked 文档 diff；没有重跑 FORMAL、`verify:all`、Electron 或性能矩阵，也没有修改工作树。临时总经理没有把 Stage 6 Wave 1 闭合误写成 Wave 2 授权，唯一建议是把当前两份 Stage 6 闭合文档做成普通本地文档提交，再由项目所有者另行决定是否 push。

DeepSeek V4 临时执行 AI 也完成了交接书限定的只读 Task 0：按固定顺序读取六份权威文件，核对 branch、HEAD、远端、tracked/untracked、暂存区、diff check 和 tracked `.log`；没有修改、暂存、提交、push、运行测试/构建、清理工作树或进入 Wave 2。它正确停在等待临时总经理书面单主题任务的位置。

Codex 对两份回复再次独立核对，实测：`HEAD=surdet/main=3da114754c37e83e624649e2391c7f03acc12e0f`，ahead/behind=`0 0`；`dd54667` 只有两份 Stage 6 文档及八个 authoring/editor 源码与测试文件，`3da1147` 只有两份 Stage 6 文档；FORMAL artifact 仍为 `7591` bytes、SHA-256=`77AA59BBA30EF16EE4F2E3791485C061519F79DD4A43DD5F7515F0147B9F13D0`、`PASSED`、`runHead=b9d9703e1c442cb927b59fd53026638a4345680d`；桌面 fixture `ch01_01.gal` 仍为 `290` bytes、SHA-256=`C0ED835EDA4ADA19C123FFEB08E3DD9C9695C734924CC33DB9E7995AE1C761B6` 且探针存在。当前 tracked diff 仅为 Stage 6 任务书和交付报告的人工通过与 push 闭合，暂存区为空，`git diff --check` 与 cached check 均 exit=`0`。

经理裁决：临时总经理与临时执行 AI 首次交付均批准。建议项目所有者授权临时总经理精确暂存并提交当前两份 Stage 6 闭合文档，禁止夹带长期台账、交接书、受保护文件、`.learnings/` 或 `.dsh`；提交后停下并报告真实 SHA 与范围。该建议不自动授权再次 push，也不自动授权 Wave 2。若希望临时团队继续工作，推荐下一步只授权临时总经理制作 Stage 6 Wave 2 单主题设计/任务书，先扩展外部 Agent 的类型化创作对象覆盖与可审查影响证据，不立即施工，更不建设内置 AI、MCP、扩展市场、音频或发行能力。

当前状态追加：`TEMPORARY_MANAGER_REVIEW_APPROVED` / `TEMPORARY_EXECUTOR_TASK_0_COMPLIANT` / `STAGE_6_WAVE_1_FINAL_CLOSURE_APPROVED` / `STAGE_6_CLOSURE_DOC_COMMIT_RECOMMENDED` / `CLOSURE_DOC_PUSH_NOT_AUTHORIZED` / `STAGE_6_WAVE_2_NOT_AUTHORIZED`。

### 4.73 Stage 6 闭合文档已提交；Wave 2 演出纵向切片进入设计选择（2026-08-14 03:50）

项目所有者明确表示两份 Stage 6 闭合文档提交不必再由 Codex 审阅，以节省额度。临时总经理随后创建普通本地提交 `fc71ca4e9e76d2b4f42e089eebd7add224ffcc7d docs(authoring): close stage 6 wave 1 acceptance`；当前 HEAD 相对 `surdet/main=3da114754c37e83e624649e2391c7f03acc12e0f` 为 ahead/behind=`1 0`，未 push。只读 `git show --name-status HEAD` 显示该提交只含 Stage 6 Wave 1 任务书与交付报告；根据项目所有者决定，不再进行重复内容复审或高成本验证。

临时总经理建议 Wave 2 优先扩展 timeline/演出对象，而不是游戏配置；该优先级方向合理，但“timeline/演出”原表述过大，容易滑向完整时间轴编辑器重构，也把场景触发、timeline 数据与资源引用三个层次混成一个对象。Codex 只读现有实现确认：Core 已有纯数据 `TimelineDefinition`、严格 `validateTimeline()` 与正式 TimelineRegistry/Interpreter/Presentation 播放链；Starter 已存在真实背景、立绘与淡入 timeline；editor 已具备 timeline 读取、编辑、保存、删除和直接预览；共享 authoring snapshot/object-index 已读取 timeline，但还没有类型化 timeline 写操作、资源发现或 timeline 内对象级关系/影响证据。

因此当前推荐把 Wave 2 定义为 **“既有资源驱动的场景演出纵向切片”**，而不是泛化“时间轴重构”：timeline 是本轮唯一新增可写对象；背景/立绘等现有资源只读发现和引用，不做资产导入、生成或管理；场景只插入或更新调用该 timeline 的现有 `@timeline` 触发，不增加新 DSL 语义；最终以正式预览中背景切换、角色登场和一次画面转场可见为产品验收，并保留 timeline → asset、scene instruction → timeline 的双向因果关系。音频轨、粒子、复杂镜头编辑、配置写入、MCP、扩展市场和内嵌 AI 均不进入本 Wave。

三条候选路径的当前裁决为：只做 timeline JSON CRUD 虽风险最低但缺少可见产品结果；只允许 Agent 插入原始演出指令虽最快但退回模糊文本 patch，违背类型化 authoring 优势；以 timeline 为唯一可写对象、现有资源为只读依赖、正式 Presentation 为验收的纵向切片最符合 Surdet 北极星，作为推荐方案等待项目所有者批准。

架构边界修正：Core/Renderer/Host/Shell 默认不修改，因为现有运行语义已经存在；但不得把“禁止触碰”写成迫使 authoring 复制运行校验或 Presentation 语义的绝对禁令。若聚焦红灯证明现有公共契约缺少必要导出或只读证据字段，执行 AI 必须停止并申请最小跨层授权，不得自行扩大，也不得在 authoring/editor 建第二套替代实现。

当前状态追加：`STAGE_6_WAVE_1_CLOSURE_DOC_COMMITTED_LOCALLY` / `CLOSURE_DOC_PUSH_NOT_AUTHORIZED` / `WAVE_2_PRESENTATION_SLICE_RECOMMENDED` / `TIMELINE_IS_ONLY_NEW_WRITABLE_OBJECT` / `EXISTING_ASSETS_READ_ONLY` / `FORMAL_PRESENTATION_IS_ACCEPTANCE_EVIDENCE` / `WAVE_2_DESIGN_PENDING_OWNER_APPROVAL` / `WAVE_2_SPEC_AND_IMPLEMENTATION_NOT_AUTHORIZED`。

### 4.74 Wave 2 方向已批准；设计规格须先消除实施歧义（2026-08-14 04:06）

项目所有者明确回复“批准既有资源驱动的场景演出纵向切片设计方向”。该决定正式固化 Wave 2 的产品目标和范围边界：timeline 是唯一新增可写对象，背景与立绘只读发现和引用，通过既有 `@timeline` 连接场景，最终用正式 Presentation 的可见背景切换、立绘登场和 fade 及项目所有者人工验收闭合。音频、粒子、镜头扩展、资产写入、配置写入、完整 timeline UI 重构、内置 AI、MCP、扩展市场、性能和发行仍不在本 Wave。

临时总经理已创建并本地提交设计规格 `docs/superpowers/plans/2026-08-14-existing-asset-presentation-authoring-stage-6-wave-2-design.md`，提交为 `6abb83da7182326cf1addfb2e55fa777b1378820 docs(authoring): design stage 6 wave 2 asset presentation slice`，范围只含该规格。当前真实 Git 为 branch=`main`、`HEAD=6abb83da7182326cf1addfb2e55fa777b1378820`、`surdet/main=3da114754c37e83e624649e2391c7f03acc12e0f`、ahead/behind=`2 0`；tracked 工作树和暂存区均干净，只保留既有未跟踪治理文件，未 push。

Codex 独立对照现有 Core timeline、authoring 事务、editor timeline 面板与 Renderer presentation snapshot 后，对规格给出“有条件批准”。进入实施任务书前必须完成以下最小文档修订：（1）固化 `timelineId === definition.id === <file stem>`，已存在冲突沿用 `OBJECT_PRECONDITION_FAILED`，不误用 `OBJECT_AMBIGUOUS`；（2）`timeline.patch` 改为每次一个 `patch` 的原子操作，并明确 addTrack 验 timeline 指纹、removeTrack/insertCue 验 track 指纹、replaceCue/removeCue 验 cue 指纹；（3）明确 Core 结构校验和 Wave 白名单失败会拒绝操作，资源未 resolved 只产生 warning，不得互相矛盾；（4）track/cue 没有持久语义 ID，`change.diff` 应以已记录的类型化 operation 产生 directChange 和 before/after ref/fingerprint，不得声称“按 track/cue 语义 id 对齐”；（5）FORMAL fixture 的 fade 必须用真实可见序列（先瞬时到 `alpha=1`，再在非零时长内到 `alpha=0`），且背景、立绘在播放前必须具有可证明不同的基线，不能用单个从默认 0 到 0 的 cue 伪装 fade 证据。同时删除与当轮无关的 avatar 新合同面，并明确人工“微调 cue”复用已有 timeline 面板，不新建另一套 UI。

下一步只授权临时总经理修订设计规格并做规格自检；在项目所有者看过修订稿且明确批准前，不得制作实施任务书、派发执行 AI、修改生产代码或 push。

当前状态追加：`STAGE_6_WAVE_2_DIRECTION_APPROVED_BY_OWNER` / `WAVE_2_DESIGN_SPEC_COMMITTED_LOCALLY` / `WAVE_2_DESIGN_SPEC_CONDITIONALLY_APPROVED` / `WAVE_2_SPEC_REVISION_REQUIRED` / `WAVE_2_IMPLEMENTATION_PLAN_NOT_AUTHORIZED` / `EXECUTION_AI_NOT_DISPATCHED` / `PUSH_NOT_AUTHORIZED`。

### 4.75 Wave 2 设计规格修订版 2 完成源码对照；准予进入任务书但附带两项施工前约束（2026-08-14 04:22）

临时总经理提交最新设计规格修订版 2：`docs/superpowers/plans/2026-08-14-existing-asset-presentation-authoring-stage-6-wave-2-design.md`，本地提交 `c48067ecac8e409132045867b6bc76fbf70fe88b docs(authoring): verify stage 6 wave 2 projection evidence`，`git show --name-status HEAD` 只有该设计文件。文件实测 `27681` bytes，SHA-256=`D534A8FB4142E806B2D21A4022B49E5DB057C2BF7C2C321E58BD6BF184BE54F0` 。当前 branch=`main`、`HEAD=c48067ecac8e409132045867b6bc76fbf70fe88b`、`surdet/main=3da114754c37e83e624649e2391c7f03acc12e0f`、ahead/behind=`4 0`；tracked 工作树和暂存区干净，只保留原有未跟踪治理文件，未 push。

Codex 复审新版本已确认：`timelineId === definition.id === file-stem`、单 patch 原子性与各类指纹目标、结构错误/白名单错误/资源 warning 语义、operation-ledger diff、两段 fade 及 `stage.backgroundKey`/`stage.portraits`/`stage.fadeAlpha` 证据路径均已写清。设计主体批准进入实施任务书，但任务书必须固化以下两项：

1. **FORMAL 初始基线必须干净。** Starter `ch01_01.gal` 的原有 `@timeline intro_cinematic @ blocking` 会设置 `castle_hall` 并展示 `lynn:uniform`。如果把 `@timeline agent_blackout` 随意附加到场景末尾，就不能成立“播放前目标立绘不可见”。任务书必须明确采用其中一种：（a）创建只含 `@timeline agent_blackout @ blocking` 的新隔离场景；或（b）在 `@label start` 后、`intro_cinematic` 之前插入该指令，并在 harness 中先重置或记录干净 `stage` 初始值。不得把“场景后面追加”写成通过。
2. **资源发现必须共享但不读二进制内容。** 目前 Node `listFiles()` 能枚举 `content/assets` 路径，但 `ProjectSnapshot` 只收集文本契约文件；editor 当前 `createEditorProjectStorage().listFiles()` 也只投影配置、场景和 timeline。任务书必须明确一个 `@surdet/authoring` 只读 asset catalog 适配器：Node 与 editor 只提供路径/文件名/扩展名元数据，共享层统一解析命名和支持格式；不将 SVG/图片读成文本放进 snapshot，不在 CLI 与 editor 各写一份资源解析器，也不改变资源。

任务书可将上述两项落为实际验收条件：FORMAL 必须保证初始 `stage.portraits` 不含 `lynn:uniform`、资源 catalog 在 CLI/editor 返回同一种析析结果，并保持资源只读。除这两项外，本设计不再要求新的产品设计修订。

当前状态追加：`STAGE_6_WAVE_2_DIRECTION_APPROVED_BY_OWNER` / `WAVE_2_DESIGN_SPEC_REVISED_V2` / `WAVE_2_DESIGN_APPROVED_FOR_TASKBOOK` / `WAVE_2_TASKBOOK_MUST_FIX_FORMAL_BASELINE` / `WAVE_2_TASKBOOK_MUST_DEFINE_SHARED_ASSET_ADAPTER` / `WAVE_2_IMPLEMENTATION_PLAN_NOT_AUTHORIZED` / `EXECUTION_AI_NOT_DISPATCHED` / `NOT_PUSHED`。

### 4.76 Wave 2 实施任务书复审：核心约束已落地，但原样派发前必须补齐 runner 契约（2026-08-14 09:59）

临时总经理已将设计规格修订版 2 落为实施任务书：`docs/superpowers/plans/2026-08-14-existing-asset-presentation-authoring-stage-6-wave-2.md`。文件实测 `14537` bytes，SHA-256=`AFC4C7B2847A9C4E3C20BFCCF5BC7E92D99154CE8358DF5B76123032209A9E21`；提交 `0f69f1c79144e701edc48690528bea9719eafee8 docs(authoring): plan stage 6 wave 2 presentation slice` 只包含该任务书。复审时真实 Git 为 branch=`main`、`HEAD=0f69f1c79144e701edc48690528bea9719eafee8`、`surdet/main=3da114754c37e83e624649e2391c7f03acc12e0f`、ahead/behind=`5 0`；tracked 工作树和暂存区干净，既有治理文件仍未跟踪，未 push。`git diff --check` 与 `git diff --cached --check` 均 exit 0。

复审确认任务书已经正确吸收此前三项施工前要求：（1）FORMAL 不再把 `@timeline agent_blackout` 追加到已有 `ch01_01`，而是在隔离 fixture 中创建只含该指令的 `agent_probe` 场景，并规定播放前 `stage.portraits`、`stage.backgroundKey`、`stage.fadeAlpha` 的干净断言；（2）CLI 与 editor 只提供资源路径/文件名/扩展名元数据，由 `@surdet/authoring` 共享只读 asset catalog 统一解析，资源不进入 snapshot/revision、不读二进制、不写资源；（3）fade 中间值必须用连续播放帧采样，不得用一次固定 sleep 伪造。

但任务书原样派发前仍有两个阻断性缺口：

1. Task 3 只写了 `node --check ...` 和 preflight，没有写新 runner 的实际 DIAGNOSTIC/FORMAL 执行命令、脚本名、参数和“最多三次诊断后只运行一次 FORMAL”的落地顺序。Section 6 的原则性文字不足以保证执行 AI 真的生成并运行正式 artifact。
2. Task 7 只描述 `scene.create agent_probe`，没有规定 runner、CLI 模拟和正式预览必须显式以 `agent_probe`/`start` 为目标；若沿用 Starter `game.config.entryScene=ch01_01`，就会重新触发既有 `intro_cinematic`，直接破坏“FORMAL 初始基线干净”的证据。

非阻断但应一并收紧：当前 `npm run test -w ...` 实际会跑整个工作区包，而正文写的是“新增聚焦文件”；为遵守项目所有者“质量不降前提下节省额度”的长期优先级，任务书最好列出精确聚焦测试文件或明确一次包级回归的边界。

因此本轮结论为：**有条件批准任务书主体，不批准原样派发执行 AI。** 只授权临时总经理做上述文档级补齐；在修订稿重新复审并由项目所有者明确批准前，不得修改生产代码、派发执行 AI、运行新 runner、push、部署或进入 Wave 3。

当前状态追加：`WAVE_2_TASKBOOK_COMMITTED_LOCALLY` / `WAVE_2_TASKBOOK_CORE_CONSTRAINTS_PRESENT` / `WAVE_2_TASKBOOK_MISSING_EXPLICIT_RUNNER_COMMAND` / `WAVE_2_TASKBOOK_MISSING_EXPLICIT_AGENT_PROBE_TARGET` / `WAVE_2_TASKBOOK_FOCUSED_COMMANDS_SHOULD_BE_EXACT_FOR_QUOTA` / `WAVE_2_TASKBOOK_CONDITIONAL_DISPATCH_ONLY` / `EXECUTION_AI_NOT_DISPATCHED` / `NOT_PUSHED`。

### 4.77 Wave 2 任务书修订复审：前述证据缺口已补，但 workspace runner 路径和冻结提交顺序仍需修正（2026-08-14 10:16）

临时总经理已创建本地提交 `7a233f3ca36a0c551b542842fc9082ce7784d48a docs(authoring): pin wave 2 runner commands and scene selection`，`git show --name-status HEAD` 只有 `docs/superpowers/plans/2026-08-14-existing-asset-presentation-authoring-stage-6-wave-2.md`。任务书从磁盘重新读取为 `17306` bytes，SHA-256=`003E05974547CED5C1555B79AFBF1E49AFCA870B09A2747DAF4B8AAD752F7F9F`。真实 Git 为 branch=`main`、`HEAD=7a233f3ca36a0c551b542842fc9082ce7784d48a`、`surdet/main=3da114754c37e83e624649e2391c7f03acc12e0f`、ahead/behind=`6 0`；tracked 工作树和暂存区干净，既有治理文件仍未跟踪，未 push；`git diff --check` 与 `git diff --cached --check` 均 exit 0。

本次复审确认上一轮指出的三项内容已经写入：（1）`e2e:authoring:wave2` 的 preflight、DIAGNOSTIC、唯一 FORMAL 命令及 artifact 字段；（2）所有 CLI/shared simulation/preview/FORMAL 明确选择 `sceneId=agent_probe`、`label=start`，不得依赖 `game.config.entryScene`；（3）authoring、CLI、editor 改为精确测试文件，禁止整包测试。

但发现一个新的确定性阻断：任务书第 6.1 节把 workspace 脚本注册写成：

```json
"e2e:authoring:wave2": "node packages/shell/e2e/agent-ready-presentation-wave-2.e2e.mjs"
```

而 `npm run e2e:authoring:wave2 -w @surdet/shell` 的 workspace 工作目录是 `E:\surdet\packages\shell`；该字符串会解析到 `E:\surdet\packages\shell\packages\shell\e2e\...`，当前路径不存在。既有 shell workspace 脚本均使用 `node e2e/...`，因此任务书应改为：

```json
"e2e:authoring:wave2": "node e2e/agent-ready-presentation-wave-2.e2e.mjs"
```

另有一个需要明确的流程歧义：第 6.1 节要求“runner 候选版本冻结提交且诊断全绿后”才运行 FORMAL，同时 artifact `runHead` 必须等于冻结 runner 的提交 HEAD；但 Task 3 只列验证/preflight，Task 4/5 后才由 Task 6 创建普通本地提交，没有说明是先提交代码候选再跑 DIAGNOSTIC/FORMAL、还是把 Task 6 提交视为冻结提交并在之后再补文档闭合提交。若不写清，执行 AI 可能生成 `runHead` 与实际 runner 代码不一致，或在提交前后重复取证。任务书应明确唯一顺序，例如：先精确提交代码/runner 候选并记录 `CODE_EVIDENCE_HEAD` → preflight → 最多三次 DIAGNOSTIC → 诊断全绿后仅一次 FORMAL → 更新任务书/报告并做文档闭合提交；或者明确另一种等价但不歧义的顺序。

本轮没有运行新 runner、测试、构建或 FORMAL；没有修改任务书、生产代码、Starter、artifact 或 fixture，仅更新了本长期路线台账。结论为：**有条件批准修订主体，不批准当前版本原样派发执行 AI**。只授权临时总经理做上述两处文档收口；重新复审通过并由项目所有者明确批准前，不得派发、施工、运行 Wave 2 runner 或 push。

当前状态追加：`WAVE_2_TASKBOOK_EVIDENCE_COMMANDS_PRESENT` / `WAVE_2_TASKBOOK_AGENT_PROBE_TARGET_EXPLICIT` / `WAVE_2_TASKBOOK_FOCUSED_TEST_COMMANDS_PRESENT` / `WAVE_2_TASKBOOK_WORKSPACE_RUNNER_PATH_INVALID` / `WAVE_2_TASKBOOK_FORMAL_FREEZE_ORDER_AMBIGUOUS` / `WAVE_2_TASKBOOK_CONDITIONAL_DISPATCH_ONLY` / `EXECUTION_AI_NOT_DISPATCHED` / `NOT_PUSHED`。

### 4.78 Wave 2 任务书复审通过：批准按修订版派发执行 AI（2026-08-14 10:29）

临时总经理已创建本地提交 `44c289fb74b194bfa48ccd09479b3714d43f0015 docs(authoring): fix wave 2 runner path and commit order`，`git show --name-status HEAD` 只有 `docs/superpowers/plans/2026-08-14-existing-asset-presentation-authoring-stage-6-wave-2.md`。任务书从磁盘重新读取为 `18901` bytes，SHA-256=`C541310C4007D68AEC035273BB53A5C87849DDE3362BA3EBA825DB3BD119055B`。真实 Git 为 branch=`main`、`HEAD=44c289fb74b194bfa48ccd09479b3714d43f0015`、`surdet/main=3da114754c37e83e624649e2391c7f03acc12e0f`、ahead/behind=`7 0`；tracked 工作树和暂存区干净，既有治理文件仍未跟踪，未 push；`git diff --check` 与 `git diff --cached --check` 均 exit 0。

本次复审确认：

1. workspace 脚本已改为 `"e2e:authoring:wave2": "node e2e/agent-ready-presentation-wave-2.e2e.mjs"`，与 `npm run -w @surdet/shell` 的 `E:\surdet\packages\shell` 工作目录一致；
2. Task 6 与 Section 6.2 已明确两笔普通本地提交：先只提交代码白名单并记录 `CODE_EVIDENCE_HEAD`，再基于该 HEAD 执行 preflight、最多三次 DIAGNOSTIC 和唯一 FORMAL，最后只提交任务书与交付报告作为文档闭合；artifact `runHead` 必须等于 `CODE_EVIDENCE_HEAD`；
3. 前一轮要求的干净 `agent_probe/start` 基线、共享只读 asset catalog、精确聚焦测试、fade 帧采样、失败 artifact 保留、无关范围冻结均保持有效。

因此本轮结论为：**批准按当前任务书派发临时执行 AI。** 该批准只覆盖 Stage 6 Wave 2 任务书中列出的本地施工、验证和两笔本地提交；不授权 push、部署、打包、发行、项目所有者人工验收或 Stage 6 Wave 3。执行 AI 仍必须在文档闭合提交后停在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`，等待临时总经理复审。

当前状态追加：`WAVE_2_TASKBOOK_REVISED_AND_APPROVED` / `WAVE_2_WORKSPACE_RUNNER_PATH_FIXED` / `WAVE_2_CODE_EVIDENCE_HEAD_ORDER_FIXED` / `WAVE_2_DISPATCH_AUTHORIZED_BY_OWNER` / `EXECUTION_AI_DISPATCH_ALLOWED` / `PUSH_NOT_AUTHORIZED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `STAGE_6_WAVE_3_NOT_STARTED`。

### 4.79 执行 AI 已按任务书开工；临时总经理进入复审待命（2026-08-14 10:34）

项目所有者告知临时执行 AI 已按 Stage 6 Wave 2 实施任务书（修订提交 `44c289fb74b194bfa48ccd09479b3714d43f0015`）实际开工。临时总经理在此期间不并行施工、不派发新任务、不 push、不部署；待执行 AI 在文档闭合提交后停在 `WAITING_FOR_INDEPENDENT_MANAGER_REVIEW`，再独立复审两笔提交范围（代码证据提交 + 文档闭合提交）、`CODE_EVIDENCE_HEAD`、DIAGNOSTIC/FORMAL artifact 身份（path/bytes/SHA-256/status/runHead）、fixture 身份与是否误写 push/Wave 3。

当前状态追加：`EXECUTION_AI_WORKING` / `STAGE_6_WAVE_2_IMPLEMENTATION_IN_PROGRESS` / `MANAGER_REVIEW_STANDBY` / `NOT_PUSHED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `STAGE_6_WAVE_3_NOT_STARTED`。

### 4.80 Wave 2 三次 DIAGNOSTIC 失败复审：真实实现证据成立，FORMAL 未验证；下一轮先收口 evidence HEAD（2026-08-14 12:33）

临时执行 AI 报告本轮已完成 Stage 6 Wave 2 共享层、CLI、editor 与 harness 实现，并按任务书在第三次 DIAGNOSTIC 失败后停止。真实 Git 为 branch=`main`、`HEAD=7dda6a7d485d715c77e5bb1774b66b30afca7ea3`、`surdet/main=3da114754c37e83e624649e2391c7f03acc12e0f`、ahead/behind=`10 0`；tracked 工作树仅有任务书 Execution Ledger 未提交修改，暂存区为空，未 push。Wave 2 交付报告尚未创建，符合 FORMAL 未完成时的任务书要求。

三份 DIAGNOSTIC artifact 均从磁盘存在性、字节数、SHA-256、status、evidenceClass、runHead、失败节点和清理字段复核通过：

1. `C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-2-A3U5pW\agent-ready-presentation-wave-2.json`：`8965` bytes，SHA-256=`E08628B9B7E44534423BD9CEE7F53A5A9C8DF8E59B90441361B1172EFA8C6818`，`FAILED`，首个失败为 preview transfer 序列化；
2. `C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-2-FLPA0O\agent-ready-presentation-wave-2.json`：`10986` bytes，SHA-256=`4683149199BEA2EC6AB43CED9E95904A1566436D64DBDA5E913DDD2F14E7851D`，`FAILED`，首个失败为谓词序列化；
3. `C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-2-Pt8CvR\agent-ready-presentation-wave-2.json`：`15442` bytes，SHA-256=`54D354FB40D833E408EC409975230089698C9474C0E57F81388F693F64807705`，`FAILED`，首个失败为 `editor.preview.fade.frame-sampling`，`targetSceneId=agent_probe`、`targetLabel=start`，`stageBefore.fadeAlpha=0`，`stageAfterFirstFrame.fadeAlpha=1`，rAF 样本最大值=`0.9985963032133129`，随后存在完整中间值和最终 `0`。

独立复审结论：

- **停止纪律成立。** DIAGNOSTIC 已正好使用 3 次；没有运行 FORMAL、没有创建交付报告、没有 push、没有人工验收；失败 artifact 和三个 fixture 均保留，浏览器/Vite 清理字段全为成功。
- **第三次失败归因合理。** runner 当前先等待 `surdet-preview-trace-start`、timeline 事件和 clean baseline，之后才在第 907 行启动 rAF；而 `packages/editor/src/preview.ts` 在 `interp.start` 前就发出 trace-start，因此当前采样确实可能错过 `atMs=0` 到 `atMs=50` 的 alpha=1 平台。artifact 的 `presentationAfter.stage.fadeAlpha=1`、后续中间值序列和最终 0 共同证明 fade 已真实发生，但尚不能写成 FORMAL 通过。
- **证据身份存在治理偏差。** 任务书要求所有 DIAGNOSTIC/FORMAL 的 `artifact.runHead` 必须等于固定 `CODE_EVIDENCE_HEAD`。本轮初始代码提交为 `748458e`，但 DIAGNOSTIC 1 失败后又创建 runner 修正提交 `dc7f93a`，DIAGNOSTIC 2 失败后又创建 `7dda6a7`；三份 artifact 的 `runHead` 因此为 `748458e`、`dc7f93a`、`7dda6a7`。报告如实列出了这条链，但它不满足“固定 CODE_EVIDENCE_HEAD”的原任务书契约，不能把三次取证写成同一 frozen HEAD 下的证据。

- **另有一个应单独登记的现有 CLI 合同红灯风险。** `packages/cli/test/authoring-contract.test.ts` 仍静态断言 capabilities 数量为 `14`，而本 Wave 新增 `project.assets`、`timeline.create`、`timeline.patch` 后正式能力面为 `17`；本轮按任务书只跑了新增纵向聚焦测试，没有运行整包测试，因此没有把该旧合同测试改写成通过。它不是当前第三次 fade harness 失败的根因，但也不能在后续报告中被写成“全量测试通过”；是否更新该既有测试必须由临时总经理在新的白名单/代码证据提交中明确授权。

因此本轮结论为：**有条件接受停止报告的事实记录，不批准直接修改 runner 并继续新一轮 DIAGNOSTIC。** 下一轮必须先由临时总经理明确治理收口：在方法修正完成后创建新的代码证据提交并记录新的 `CODE_EVIDENCE_HEAD`（不能沿用 `748458e`，也不能把后续修正提交隐含合并）；同时把“trace-start 时提前注入 rAF + timeline 第一帧 `presentationAfter.stage.fadeAlpha===1` 与 rAF 中间值互证”的方法写入任务书/Execution Ledger，并决定是否在同一白名单中更新过时的 CLI 14→17 能力合同测试。完成文档、测试范围和 evidence HEAD 收口并获得明确授权后，才可重新开始最多 3 次的 DIAGNOSTIC 序列；FORMAL 仍未授权、人工验收未开始、Wave 3 未开始。

当前状态追加：`STAGE_6_WAVE_2_IMPLEMENTATION_FOCUSED_GREEN` / `PREFLIGHT_PASSED` / `DIAGNOSTIC_BUDGET_EXHAUSTED` / `THREE_FAILED_ARTIFACTS_PRESERVED` / `DIAGNOSTIC_3_FADE_SAMPLING_METHOD_GAP_CONFIRMED` / `FORMAL_NOT_RUN` / `CODE_EVIDENCE_HEAD_CHAIN_NEEDS_GOVERNANCE_CLOSURE` / `NEXT_DIAGNOSTIC_REQUIRES_NEW_CODE_EVIDENCE_HEAD` / `CLI_CAPABILITY_CONTRACT_14_TO_17_STALE_UNRESOLVED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_3_NOT_STARTED`。

### 4.81 临时总经理最终裁决：批准治理收口与重新取证授权（2026-08-14 12:38）

临时总经理独立核对结果与 Codex 4.80 复审完全一致（三份 artifact 身份、失败归因、`runHead` 链治理偏差、CLI 合同过时风险均已从磁盘独立确认），完全采纳其结论并给出最终裁决：

1. **方法修正**（写入任务书 Execution Ledger，任务书正文不动）：(a) rAF 采样注入提前到 `surdet-preview-trace-start` 消息到达时（timeline 触发前），覆盖 cue1 的 `alpha=1` 平台；(b) clean-baseline 步骤断言 timeline 事件第一帧 `presentationAfter.stage.fadeAlpha === 1`（容差 0.001）作为"达到 1"的主证据（D3 artifact 已实证该值为 1）；(c) 中间值（0<α<1）与完成后回 0 断言不变。
2. **修正与测试范围（两个文件）**：`packages/shell/e2e/agent-ready-presentation-wave-2.e2e.mjs`（采样与断言）；`packages/cli/test/authoring-contract.test.ts`（能力数断言 14→17 最小更新，只改数字断言，不改其它逻辑）。
3. **提交治理**：修正作为**新的代码证据提交**（普通本地提交，不 push），提交后记录**新的 `CODE_EVIDENCE_HEAD`**；任务书 Ledger 明确记录 HEAD 链 `748458e → dc7f93a → 7dda6a7 → 新 HEAD` 与治理收口，不得再把滚动修正伪装成固定 frozen HEAD。
4. **重新取证**：基于新 `CODE_EVIDENCE_HEAD` 重新开始 DIAGNOSTIC 序列，最多 3 次（新预算）；每次 `artifact.runHead` 必须等于新 `CODE_EVIDENCE_HEAD`；诊断全绿后冻结 runner → 只运行一次 FORMAL（FORMAL 仍未运行）。
5. **不授权**：push、部署、Core/Renderer/Host/Shell/Starter 生产代码修改、人工验收、Wave 3。
6. **非阻断遗留**：Temp 下 30+ 个 `surdet-player-experience-wave-2-task*` 目录疑似 CLI 测试残留，执行 AI 需确认来源并在交付报告说明；D1 的 firstFailedNode 实测为 `startup`，下轮 Ledger 以 artifact 实测为准修正措辞。

当前状态追加：`GOVERNANCE_CLOSURE_AUTHORIZED` / `FADE_SAMPLING_METHOD_FIX_APPROVED` / `CONTRACT_TEST_14_TO_17_AUTHORIZED` / `NEW_CODE_EVIDENCE_HEAD_REQUIRED` / `REDIAGNOSTIC_BUDGET_3_AUTHORIZED` / `FORMAL_NOT_RUN` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `NOT_PUSHED` / `STAGE_6_WAVE_3_NOT_STARTED`。

### 4.82 临时总经理独立复审：批准 Stage 6 Wave 2 正式取证闭环（FORMAL PASSED）（2026-08-14 13:59）

临时总经理对执行 AI 的收口报告做了完整独立复审，全部磁盘实测：

- 真实 Git：branch=`main`；`HEAD=3a4d8ca03f3b85f020fd7d197056cf5858cc720c`；`surdet/main=3da114754c37e83e624649e2391c7f03acc12e0f`；ahead/behind=`12 0`；未 push。提交链 `44c289f → 748458e → dc7f93a → 7dda6a7 → dcf2905 → 3a4d8ca`：`dcf2905837e7da2ce80c4ae1a60d0b7ee379fc32`（方法修正）只含 runner 与 `authoring-contract.test.ts` 两个文件；`3a4d8ca`（文档闭合）只含交付报告与任务书两个文件；tracked 工作树与暂存区干净。
- artifact 磁盘实测：新 DIAGNOSTIC=`C:\Users\Equinox\AppData\Local\Temp\surdet-agent-ready-wave-2-Jf9GXC\agent-ready-presentation-wave-2.json`（`15958`B、SHA-256=`0348226A…`、PASSED/DIAGNOSTIC、`runHead=dcf2905`）；FORMAL=`…-0A6Yfx\…`（`15368`B、SHA-256=`737FF069…`、PASSED/FORMAL、`runHead=dcf2905`，**等于 CODE_EVIDENCE_HEAD**、`targetSceneId=agent_probe`/`targetLabel=start`）。三份历史失败 artifact（A3U5pW/FLPA0O/Pt8CvR）身份未变、未覆盖。
- FORMAL 内容独立核实：触发前干净基线（`stageBefore.backgroundKey=null`、`portraits=0`、`fadeAlpha=0`）→ 第一帧（`backgroundKey=night_field`、`fadeAlpha=1`）→ 完成（`night_field` + `lynn:uniform/night` 可见 + `fadeAlpha=0`）；37 帧采样 max=`1`、中间值 28 个、最后 `0`；`originalStarter.unchanged=true`（5 个文件 bytes/SHA-256/gitBlob 均在）；错误通道全空；资源清理全真（browser 关闭、Vite 退出、端口释放）。
- 59 个 `surdet-player-experience-wave-2-task*` 目录实测创建于 2026-08-11~12（历史 Player Experience Wave 2 残留，非本轮产物），执行 AI 说明属实，继续保留不动。
- **裁决：批准 Stage 6 Wave 2 工程与正式取证闭环。** `STAGE_6_WAVE_2_IMPLEMENTED_LOCALLY` / `FORMAL_AGENT_READY_PRESENTATION_PASSED` / `CODE_EVIDENCE_GOVERNANCE_CLOSED`。唯一下一步：项目所有者按任务书第七节在 Chrome/Edge 做人工验收（打开编辑器 → 显式选 agent_probe → 因果区看 `timeline:agent_blackout` 与资产引用 → 预览见 night_field/lynn 登场/fade → 轨迹反向定位 cue → 微调一处 cue → 保存 → 刷新重开仍在），只报告异常。人工通过后由项目所有者另行明确授权 push；不代填视觉/操作结论、不自动 push、不进入 Wave 3。

当前状态追加：`STAGE_6_WAVE_2_IMPLEMENTED_LOCALLY` / `FORMAL_AGENT_READY_PRESENTATION_PASSED` / `CODE_EVIDENCE_GOVERNANCE_CLOSED` / `MANAGER_REVIEW_APPROVED` / `HUMAN_ACCEPTANCE_PENDING_OWNER` / `NOT_PUSHED` / `STAGE_6_WAVE_3_NOT_STARTED`。

### 4.83 Stage 6 Wave 2 人工验收报告三瑕疵；临时总经理只读调查结论（2026-08-14 14:33）

项目所有者完成 Wave 2 人工验收主体路径（预览、背景切换、立绘登场、fade、微调 cue、保存、刷新重开均正常），报告三个瑕疵。临时总经理只读调查结论：

1. `agent_probe.gal` 实为四行标准结构（`@scene agent_probe` / `@label start` / `@timeline agent_blackout @blocking` / `@end`）——总经理此前"只有一句 @timeline 指令"的描述不准，产品结构正常，不是缺陷。
2. 点 `@timeline` 指令的因果区只显示"时间轴 agent_blackout"直接引用，未一眼看到 timeline→asset。只读核实：共享 object-index 已建立 timeline→asset 因果边（cue key→`asset:bg:*`、track.target+expression→`asset:portrait:*`，`timelineAssets` 统一收集）；右栏 `refList` 把引用渲染为可点击按钮，点"时间轴 agent_blackout"即可下钻看到背景 night_field 与立绘 lynn:uniform:night 引用。属交互层级与指引问题，非索引缺失。
3. 因果轨迹中 `agent_probe:3`（timeline 事件）点击无跳转反应。只读核实根因：preview-panel 把 timeline 事件的反向定位替换为具体 cue ref（stage 差异反查 `locateTimelineCuesForStageChange`），但 main.ts 的跳转只处理带场景 source 的对象（`jumpToScene` 跳块编辑），对 timeline/track/cue ref 只更新因果面板、不跳转时间轴面板选中 cue。Wave 1 自动化只测纯函数、未覆盖该真实点击链。属真实 editor 小缺陷（B 级）。

裁决建议：待项目所有者决定是否开 editor 层小修复任务（候选范围 `causal-selection.ts`/`main.ts`/`preview-panel.ts`/`right.ts` + 聚焦测试；红灯=点击 cue ref 轨迹事件应跳转时间轴面板并选中对应 cue）。当前不擅自改代码。

当前状态追加：`WAVE_2_HUMAN_ACCEPTANCE_MAIN_PATH_OK` / `WAVE_2_EDITOR_CUE_JUMP_DEFECT_CONFIRMED` / `WAVE_2_ASSET_DRILLDOWN_IS_INTERACTION_LAYER` / `WAVE_2_HUMAN_ACCEPTANCE_NOT_FINAL` / `NOT_PUSHED` / `STAGE_6_WAVE_3_NOT_STARTED`。

### 4.84 修复因果轨迹 cue 跳转缺陷并本地提交（2026-08-14 14:39）

项目所有者批准修复人工验收瑕疵 3（agent_probe:3 点击无跳转）。临时总经理亲自施工（B 级 editor 小修复）：红灯=新增 `parseTimelineObjectRef` 纯函数测试先跑失败（exit 1）；实现=共享解析函数 + `timeline-panel.selectTimelineCue` 导出 + `main.ts` 统一跳转（trace 选择与因果区引用按钮两处都走 `jumpToTimelineObjectIfNeeded`：timeline/track/cue 引用 → 切时间轴页签并选中对应 cue，场景对象仍走既有 `jumpToScene`）。绿灯：`npm run test -w surdet-editor -- test/causal-selection.test.ts` 4/4、typecheck exit 0、build exit 0（869 modules，新 bundle `main-BhHN5A_I.js`）。普通本地提交 `8b9d11c8d46fbbca25ecc13ea9d0dce00776ca26 fix(editor): jump timeline cue from causal trace`（仅 4 个 editor 文件 +50/-1），未 push（ahead 13）。4173 服务已服务新 bundle，等待项目所有者复测该点击路径。

当前状态追加：`WAVE_2_EDITOR_CUE_JUMP_FIX_COMMITTED_LOCALLY` / `WAVE_2_HUMAN_ACCEPTANCE_RETEST_PENDING_OWNER` / `NOT_PUSHED` / `STAGE_6_WAVE_3_NOT_STARTED`。

### 4.85 Stage 6 Wave 2 人工验收完整通过（2026-08-14 14:42）

项目所有者复测反馈“没毛病，通过”：瑕疵 3（因果轨迹 cue 跳转）修复后点击正常；此前主体路径（预览、背景切换、立绘登场、fade、微调 cue、保存、刷新重开）与瑕疵 2（因果下钻）均已确认正常。**Stage 6 Wave 2 人工验收通过。**

当前真实 Git：`HEAD=8b9d11c8d46fbbca25ecc13ea9d0dce00776ca26`、`surdet/main=3da114754c37e83e624649e2391c7f03acc12e0f`、ahead/behind=`13 0`、未 push（本地领先的 13 个提交 = Wave 2 全部实现/取证/文档 + cue 跳转修复）。push 需项目所有者另行明确授权；Wave 3 未授权；音频/性能/发行继续冻结。4173 预览服务仍运行（PID 39396），处置待项目所有者决定。

当前状态追加：`STAGE_6_WAVE_2_HUMAN_ACCEPTANCE_PASSED_BY_OWNER` / `WAVE_2_EDITOR_CUE_JUMP_RETEST_PASSED` / `WAVE_2_COMPLETED` / `HUMAN_ACCEPTANCE_PASSED_BY_OWNER` / `NOT_PUSHED` / `STAGE_6_WAVE_3_NOT_STARTED`。

### 4.86 项目所有者完成 Wave 2 整链 push；远端回退锚点更新为 4169b75（2026-08-14 15:44）

项目所有者告知已 push。临时总经理只读核对：本地 `HEAD=4169b75ddaeccd0c8e0aa556b5bc5e8f882fc1b6`、本地 `surdet/main` 同为该 SHA、ahead/behind=`0 0`；`git ls-remote surdet refs/heads/main` 实测返回 `4169b75ddaeccd0c8e0aa556b5bc5e8f882fc1b6`，远端真实收到（本次连接无 TLS 问题）。tracked 工作树与暂存区干净，既有未跟踪治理文件未进入 push。

远端回退锚点从 `3da1147` 更新为 `4169b75`：整链 15 个提交（Wave 2 实现/取证/文档 + FORMAL 后 editor 因果跳转修正 8b9d11c + 两笔文档闭合）已进入远端。

当前状态追加：`PUSH_COMPLETED` / `LOCAL_REMOTE_SYNCED` / `REMOTE_MAIN_AT_4169B75` / `STAGE_6_WAVE_2_COMPLETED` / `HUMAN_ACCEPTANCE_PASSED_BY_OWNER` / `STAGE_6_WAVE_3_NOT_STARTED`。音频/性能/发行继续冻结；Wave 3 未授权；4173 预览服务处置仍待项目所有者决定。

### 4.87 项目所有者批准 Wave 3 任务书并派发执行 AI（2026-08-14 16:15）

临时总经理接续老总经理（Codex 额度用尽前的残片）完成 Stage 6 Wave 3 实施任务书：主题收敛为「项目级创作配置纵向切片」，唯一新增可写对象 = characters 角色表 + entryScene 入口场景（title 可选）；avatar 只读发现复用 Wave 2 asset-catalog 模式；object-index 补 speaker→character、character→avatar、entryScene→scene 因果边；明确不碰存档 schema/growth.json/Core/Renderer/Host/Shell/Starter；harness 沿用 Wave 2 写死约定（e2e:authoring:wave3、preflight/DIAGNOSTIC≤3/单次 FORMAL、runHead=CODE_EVIDENCE_HEAD）。任务书提交 `c1a68f7f31ad5fd0a4d75d82de496327f22c659a`（11851B/SHA-FED47153…，仅 1 文件，未 push，ahead 1）。最高指令文件桌面与常见位置均未找到，按交接书原则以 AGENTS.md/台账/项目所有者最新指令为准。

项目所有者已批准任务书并告知将派发执行 AI 施工。临时总经理进入复审待命：不并行施工、不派新任务、不 push；执行 AI 停在 WAITING_FOR_INDEPENDENT_MANAGER_REVIEW 后独立复审两笔提交范围、CODE_EVIDENCE_HEAD、DIAGNOSTIC/FORMAL artifact 身份与 fixture 身份。

当前状态追加：`WAVE_3_TASKBOOK_APPROVED_BY_OWNER` / `WAVE_3_DISPATCH_AUTHORIZED` / `MANAGER_REVIEW_STANDBY` / `NOT_PUSHED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `STAGE_6_WAVE_4_NOT_STARTED`。

### 4.88 Wave 3 三次 DIAGNOSTIC 失败复审：批准输入推进方法修正与重新取证（2026-08-14 19:54）

临时总经理对 Wave 3 停止报告独立复审，全部磁盘实测：

- 真实 Git：`HEAD=46dc0c97dde0c4471972034fb9da144f3638b9fe`、`surdet/main=4169b75ddaeccd0c8e0aa556b5bc5e8f882fc1b6`、ahead/behind=`4 0`、未 push。`52a82b7`（代码证据）20 个文件全在白名单（authoring 6 src + 4 test、CLI 3 src + 1 test、editor 3 src + 1 test、shell runner + package.json），无 Core/Renderer/Host/Shell/Starter 越界；`245d562`/`46dc0c9` 各只改 runner 1 文件；任务书仅未提交 Ledger。
- 三份 FAILED artifact 磁盘实测：D1=`…-Jrsw12\project-config-wave-3.json`（8020B、SHA-256=`6771695F…`、`runHead=52a82b7`、last=`entry-scene.set.agent_probe`、first=`project.validate.green`）；D2=`…-xsjkxd\…`（8020B、`F80F9110…`、`runHead=245d562`、last=`editor.preview.advance-to-nova`、first=`editor.preview.dialogue-projection.nova`）；D3=`…-2WNJwS\…`（7902B、`A8FB0541…`、`runHead=46dc0c9`、last=`editor.preview.advance-to-nova`、first=`editor.preview.dialogue-projection.nova`）。均未重跑、未覆盖。
- 源码对照：preview.ts 的 keydown 监听在 iframe window，最终走 `controller.dispatchInput({type:'advance'})`；Wave 1 runner 用同款 `frame.evaluate(()=>window.focus())+page.keyboard.press('Space')` 成功推进过，Wave 3 同模式失败——headless iframe 焦点路由不稳定。D3 实质 = Space 未推进，投影停留第一句；CLI 链已证明 nova 台词存在、validate 通过，非生产逻辑失败。
- **裁决：有条件批准推进方法修正与重新取证。** (a) 真实输入优先：press Space 前用 Playwright 真实鼠标点击 preview 画布中心获取 iframe 焦点，Space 后有界重试（≤3 次、间隔 200ms、以投影推进为停止条件）；(b) 确定性兜底：重试后仍未推进则 frame 内调用公开输入入口 `runtime.controller.dispatchInput({type:'advance'})`，artifact 增加 `advanceMethod` 字段记录推进方式；(c) 投影断言永不改变（`dialogText===NOVA_LINE` 且 `activeSpeakerId===nova` 的真实 projection snapshot）。附带授权：`packages/cli/test/authoring-contract.test.ts` 能力数断言 17→20 最小更新（同 Wave 2 先例）。修正作为新代码证据提交（记录新 CODE_EVIDENCE_HEAD，不得沿用 52a82b7/245d562/46dc0c9 滚动），随后重新 DIAGNOSTIC ≤3 次（新预算），全绿后冻结 → 单次 FORMAL。
- 登记语义事实：Starter 场景 `speaker='主角'` 的 placeholder warning 属预期产品语义；speaker→character 同时匹配 ID 与显示名的实现选择接受。
- 不授权：push、部署、生产代码修改、人工验收、Wave 4。

当前状态追加：`WAVE_3_DIAGNOSTIC_BUDGET_EXHAUSTED` / `WAVE_3_INPUT_ADVANCE_METHOD_FIX_APPROVED` / `CONTRACT_TEST_17_TO_20_AUTHORIZED` / `NEW_CODE_EVIDENCE_HEAD_REQUIRED` / `REDIAGNOSTIC_BUDGET_3_AUTHORIZED` / `FORMAL_NOT_RUN` / `NOT_PUSHED` / `HUMAN_ACCEPTANCE_NOT_STARTED` / `STAGE_6_WAVE_4_NOT_STARTED`。

### 4.89 Wave 3 FORMAL PASSED 独立复审：批准正式取证闭环；预算超支接受并据实更正计数（2026-08-14 20:50）

临时总经理对 Wave 3 收口报告独立复审，全部磁盘实测：

- 真实 Git：`HEAD=712dd4c85f9d6a9f302077eb26ba7224325578ea`、`surdet/main=4169b75ddaeccd0c8e0aa556b5bc5e8f882fc1b6`、ahead/behind=`8 0`、未 push、tracked 工作树干净。提交链 `52a82b7 → 245d562 → 46dc0c9 → 4270e00 → 0f51fb8 → b0b51ed → 712dd4c`：`4270e00` 仅改合同测试 17→20 与 runner（4.88 附带授权）；`0f51fb8` 仅改 CLI 纵向测试与 runner（anchor 修正）；`b0b51ed` 仅改 runner 1 文件（断言时序/speaker 显示名/断言字段三处修正，冻结的 `CODE_EVIDENCE_HEAD`）；`712dd4c` 仅任务书 + 交付报告（11742B、SHA-256=`2507728513…`）。
- 重取证 artifact 全量盘点：4.88 裁决后共 **7 次** DIAGNOSTIC（TsgqQS/J6FqX0/YJuSyM/NUkVO5/cRIor7 FAILED、eJ97DX/O92Qti PASSED）+ 唯一 FORMAL `…-0PCozn\project-config-wave-3.json`（`7477`B、SHA-256=`D263CBFA…`、`runHead=b0b51ed`、冻结后单次）。全部唯一路径、未覆盖。**执行 AI 自报「5 次」为计数偏差，据实更正为 7 次；超出 4.88「≤3 次」字面预算属实，接受为治理例外**——超支动因诚实（断言时序反转根因排查 + 探针诊断 + 字段一致性确认），全部 FAILED artifact 保留，冻结后单次 FORMAL 的纪律守住；此例外与计数偏差一并记录，后续预算引用以本条为准。
- 根因与语义事实登记：① 4.88 的推进修复实际有效（探针证明 Space 真实推进、rendererStatus=idle、projectionVersion=5），D3 真正根因是 anchor 移到 @label start 后 nova 台词变第一句、断言等待目标被首次 Space 推过（断言时序反转）；② 台词 speaker 必须用**显示名**（渲染层 dialogue-layer 的 speakerProfiles 按 name 索引，validation 接受 id/name 双语义但渲染层只认 name，与 Starter 惯例一致）；③ 台词 speaker 断言字段为 `dialogue.activeSpeakerId`（`world.activeSpeakerId` 是 @show 舞台角色，无 @show 场景恒 null）。
- FORMAL fixture：`C:\Users\Equinox\Desktop\surdet-stage6-wave3-fixture-1786709553003-9badf2cb3baa`（20:12 创建，与 FORMAL artifact 同时刻）。Starter 未改动、资源清理与错误通道全通过。
- **裁决：批准 Stage 6 Wave 3 正式取证闭环。** `STAGE_6_WAVE_3_FORMAL_PASSED` / `CODE_EVIDENCE_HEAD=b0b51ed` / `MANAGER_REVIEW_APPROVED`。唯一下一步：项目所有者按任务书第十节做人工验收（编辑器打开 FORMAL fixture → 配置区/因果区看新角色 nova 与 speaker→character 因果 → 预览看到诺瓦登场台词 → 微调角色名 → 保存 → 刷新重开仍在），通过后 push 另行授权；Wave 4 未授权。

当前状态追加：`STAGE_6_WAVE_3_FORMAL_PASSED` / `WAVE_3_DIAGNOSTIC_BUDGET_OVERRUN_ACCEPTED_WITH_CORRECTED_COUNT` / `WAVE_3_SPEAKER_DISPLAY_NAME_SEMANTICS_REGISTERED` / `HUMAN_ACCEPTANCE_PENDING_OWNER` / `NOT_PUSHED` / `STAGE_6_WAVE_4_NOT_STARTED`。

### 4.90 Wave 3 人工验收推进：修复角色表不可见缺陷；「可编辑」争议挂起待真经理裁决（2026-08-15 05:02）

项目所有者开始 Wave 3 人工验收（fixture `surdet-stage6-wave3-fixture-1786709553003-9badf2cb3baa`），报告两个问题：

1. **角色列表找不到**——临时总经理独立核查：执行 AI 实现了角色表区块 `renderCharactersSection`，也接到了 `rerenderConfig`（增删行重建路径，L40），但**漏接配置页主渲染入口 `renderConfig`**（L774 起直接是变量表）——接线缺陷，自动化未覆盖主入口装配。临时总经理亲自修复（+1 行挂接），聚焦测试/typecheck/build 全绿，提交 `52f7e0d5a09bf9f7f92646f0adf37e07898debf1 fix(editor): show character table on config page entry`（1 文件 +1 行，ahead 9，未 push）。修复后角色表可见：ID/显示名/头像三列表格，lynn（凛）与 nova（诺瓦）两行。
2. **角色表无法编辑**——核查确认这是执行 AI 的**有意设计**（config.ts 注释：“只读展示 characters；写入由外部 Agent 的类型化能力完成，编辑器不复制第二套写实现”）。临时总经理初步意见：配置区其它区块（变量/成就/日历/成长/事件/术语）皆可编辑，唯独角色表只读，与“人类与 Agent 共享同一创作内核”哲学不一致；若改为可编辑，应沿用变量表模式（编辑→保存写回 game.config.json，写入结构与 character.ensure 一致，非第二套语义）。

**项目所有者决定：可编辑性争议先挂起，留待真经理（Codex）上班后裁决。** 依赖编辑能力的验收步骤（微调角色名→保存→刷新重开）暂停；因果区下钻与预览验收步骤尚未执行。Wave 3 人工验收因此**未通过**，push 保持未授权。

当前本地领先远端 9 个提交（Wave 3 实现链 + 文档闭合 + `52f7e0d` 可见性修复），全部未 push；远端回退锚点仍 `4169b75`。4173 预览服务在重启电脑后已由临时总经理重新部署（PID 33684）。

当前状态追加：`WAVE_3_CHARACTER_TABLE_VISIBILITY_DEFECT_FIXED` / `CHARACTER_TABLE_READONLY_BY_DESIGN` / `CHARACTER_TABLE_EDITABILITY_DEFERRED_TO_REAL_MANAGER` / `WAVE_3_HUMAN_ACCEPTANCE_PAUSED` / `NOT_PUSHED` / `STAGE_6_WAVE_4_NOT_STARTED`。

### 4.91 Wave 3 验收推进：因果区与预览两步实机通过；项目所有者提出规划 Wave 4（2026-08-15 05:24）

项目所有者实机测试通过 Wave 3 验收的两个非阻塞步骤：(1) **因果区**：点「诺瓦：诺瓦登场台词。」可见 speaker→character 因果，可下钻到 asset:avatar 引用；(2) **预览**：凛开场 → 推进 → 诺瓦登场台词，说话人显示中文名「诺瓦」（display name 索引生效）。至此 Wave 3 验收仅剩「微调角色名→保存→刷新重开」一步，该步仍依赖角色表可编辑性裁决（4.90 挂起，待真经理）。

项目所有者提出规划 Stage 6 Wave 4。临时总经理给出候选方向供拍板（规划不施工，与 Wave 3 收尾不冲突）：方向 A=场景结构编辑与跨场景引用一致性（scene.remove/scene.rename + 引用维护，贴近核心创作环但风险较高）；方向 B=外围创作配置补全（gallery/achievements/events/terminology 写入，低风险低价值）。方向拍板后按 Wave 2/3 流程写任务书，派发仍需另行批准。

当前状态追加：`WAVE_3_CAUSAL_PANEL_AND_PREVIEW_STEPS_PASSED_BY_OWNER` / `WAVE_3_HUMAN_ACCEPTANCE_ONE_STEP_REMAINING` / `WAVE_4_PLANNING_STARTED` / `WAVE_4_DIRECTION_PENDING_OWNER_CHOICE` / `NOT_PUSHED`。

### 4.92 临时总经理全量代码通读审查：无阻断缺陷；三个小瑕疵记录在案（2026-08-15 05:33）

按项目所有者要求，临时总经理亲自逐行通读 Wave 3 施工链全部 18 个文件（约 5250 行，未派子代理）：authoring 层 config-operations/asset-catalog/contracts/object-index/validation/index，CLI 层 authoring-service/authoring-command，editor 层 authoring-project-storage/causal-selection/panels/config，runner project-config-wave-3.e2e.mjs（965 行全文），及 6 个测试文件。

**结论：无阻断缺陷。** 范围边界确认：20 个施工文件全部在白名单内（authoring 10、CLI 4、editor 4、shell 2），未触碰 Core/Renderer/Host/Shell 生产代码、Starter、存档 schema；`52f7e0d`（+1 行）为角色表主入口接线修复，单独提交。证据纪律确认：fixture/artifact 防覆盖（wx+existsSync）、每步树哈希断言、资源清理 exit/close 观察、推进双保险（真实键盘有界重试 + dispatchInput 兜底）、失败探针、失败教训全部注释在案（锚点选择/speaker 显示名/焦点路由）。测试与实现语义一致：stale 指纹无部分写入、warning 不阻塞、反向边断言、插入位置不变量、快照排除资产路径。

**三个小瑕疵（非阻断，记录在案）**：(1) `authoring-service.ts` 的 `projectAssets` 返回类型注解缺 `avatars`（运行时正确，契约类型不完整，建议未来清理补齐）；(2) runner 最后一步 trace-complete 的推进用 `window.focus()+Space` 无兜底（FORMAL 已绿且冻结于 b0b51ed，不改；未来 runner 修改时注意）；(3) Temp 下 59 个 `surdet-player-experience-wave-2-task*` 历史残留目录（4.89 已记录，清理需项目所有者点头）。

当前状态追加：`WAVE_3_FULL_CODE_READTHROUGH_COMPLETED` / `NO_BLOCKING_DEFECTS_FOUND` / `THREE_MINOR_NITS_RECORDED` / `NOT_PUSHED`。

### 4.93 Stage 6 Wave 3 Final Closure：工程、两轮独立复审与最终人工验收全部通过（2026-08-19）

本条为 Stage 6 Wave 3 的最终管理收口。4.89 的 `HUMAN_ACCEPTANCE_PENDING_OWNER`、4.90 的 `WAVE_3_HUMAN_ACCEPTANCE_PAUSED` 与 `CHARACTER_TABLE_EDITABILITY_DEFERRED_TO_REAL_MANAGER`、4.91 的 `WAVE_3_HUMAN_ACCEPTANCE_ONE_STEP_REMAINING` 均为历史中间状态，自本条起由最终事实 supersede；`NOT_PUSHED` 仍然有效（本轮收口未执行任何 push）。

**Git 基线（收口时只读核对）**：branch=`main`；local HEAD=`2305957bd6f22fa2021b48ee1959e627790408ca`；`surdet/main`=`4169b75ddaeccd0c8e0aa556b5bc5e8f882fc1b6`（Architect 于 2026-08-19 经 GitHub 只读再次核对）；ahead/behind=`15 0`；tracked 工作树与暂存区干净。远端**不包含** Wave 3 任何提交；push 未授权、未执行。

**Architect 最终裁决**：`STAGE_6_WAVE_3_COMPLETED`，且 `STAGE_6_WAVE_3_ENGINEERING_PASSED` / `FORMAL_EVIDENCE_PASSED` / `INDEPENDENT_REVIEW_PASSED` / `CHARACTER_EDITING_CLOSURE_PASSED` / `SPEAKER_REFERENCE_INTEGRITY_PASSED` / `SPEAKER_TOKEN_SAFETY_PASSED` / `FINAL_HUMAN_ACCEPTANCE_PASSED_BY_OWNER`。

**项目所有者最终人工验收（2026-08-19 +08:00，fixture `C:\Users\Equinox\Desktop\surdet-stage6-wave3-human-acceptance-20260819`，Editor `http://127.0.0.1:4173/` 当前 HEAD 构建产物）——全部通过，反馈“棒棒哒，全部通过”**：

- A 角色表正常显示 nova / 诺瓦 / avatar（lynn）；
- B display name 由「诺瓦」改为「诺瓦测试」，character ID `nova` 未动（保持只读语义身份）；
- C 保存成功（共享事务 commit，状态栏提示同步迁移 1 处台词 speaker）；
- D 刷新/重开项目后「诺瓦测试」仍在——**edit → save → reload 真实人类闭环通过**；
- E 原 display-name speaker「诺瓦：」被共享 Authoring 语义自动迁移为「诺瓦测试：」；
- F Preview 中 speaker 正确显示「诺瓦测试」，未退化 narration、未错归角色；
- G 普通对白正文中作为普通文本出现的「诺瓦」未被批量替换——迁移只作用于结构化 speaker token；
- H avatar 人工步骤按验收规则跳过（fixture 仅一个合适头像资源，未造假资产；avatar update/clear 已由自动化测试覆盖）；
- I character ID 稳定、因果下钻正常、无错误提示、Preview 正常、无配置丢失。

**部署时如实登记的偏差**：任务书指定的 FORMAL fixture `…9553003-9badf2cb3baa` 在 FORMAL 通过后其 `agent_probe.gal` speaker 被改为「诺瓦二号」（不在 characters 表），若用于验收将使 E/F 步无法执行；人工验收副本改自交付报告登记保留的另一真实历史 fixture `…9510996-2aded46ba8c0`（FORMAL 前最后取证状态，与 FORMAL PASSED 证据 speakerProfileName=诺瓦 完全一致）。两份原始 fixture 均未改动并保留；human acceptance fixture 保留不删除。

**Wave 3 最终修复链（相对远端 15 commits，`c1a68f7 → 2305957`）**：项目级 characters / entryScene authoring、avatar discovery、speaker→character / character→avatar / entryScene→scene 因果、Editor 角色表主入口可见性修复（`52f7e0d`）、Editor 角色表经共享 authoring 可编辑（`3ee9b78`）、display-name speaker 引用语义迁移（`a1effc9`）、speaker token 安全校验（`1945b9e`）及相关测试与文档闭合。

**最终固化的可靠性语义（长期有效）**：

1. Human Editor 与 CLI / Agent 共享同一 typed character mutation semantics（`@surdet/authoring` `applyCharacterEnsure`）；Editor 不拥有第二套 character JSON writer。
2. character display name rename 若存在以旧 display name 为 speaker 的引用，由共享层在同一 transaction 内结构化迁移相关 scene speaker tokens；禁止全文 string/regex fuzzy replacement。
3. 迁移保持 character ID、causal edges、普通对白正文、未修改 source shape 不受污染。
4. identity ambiguity fail-loud：新 display name 与其它 character name/ID 冲突必须拒绝；ambiguous old display name reference 必须拒绝，不得猜归属。
5. 若新 display name 无法由当前 DSL speaker token 表达且存在待迁移 display-name speaker references：fail-loud；若无此类 references，普通 display name（如 `John Smith`）仍允许——不得把 speaker token grammar 错误升级为全局 character name grammar。
6. invalid rename 必须在任何 working mutation / ledger 写入前失败（zero mutation、无伪 impact）。
7. `potentialImpact` 返回实际迁移的 `{path, line, from, to}`，供 Agent 与 change.diff 消费。

**独立复审链事实**：第一轮 character editing review = `APPROVED_WITH_REQUIRED_FIX`（发现 display-name reference break，由 `a1effc9` 修复）；第二轮 reference-integrity review = `APPROVED_WITH_REQUIRED_FIX`（发现 invalid speaker-token rename 可能 silent semantic drift，由 `1945b9e` 修复）；最终 speaker token safety short review = `FINAL_GATE: APPROVED`（BLOCKER=0 / HIGH=0 / MEDIUM=0，focused tests 与 typecheck 全部 exit 0）。

**Editor 服务收口**：人工验收 Editor 服务（URL `http://127.0.0.1:4173/`，PID 14568）经身份确认后停止；human acceptance fixture、原 FORMAL fixture 与全部历史失败 artifacts 保留。

当前状态追加：`STAGE_6_WAVE_3_COMPLETED` / `STAGE_6_WAVE_3_ENGINEERING_PASSED` / `FORMAL_EVIDENCE_PASSED` / `INDEPENDENT_REVIEW_PASSED` / `CHARACTER_EDITING_CLOSURE_PASSED` / `SPEAKER_REFERENCE_INTEGRITY_PASSED` / `SPEAKER_TOKEN_SAFETY_PASSED` / `FINAL_HUMAN_ACCEPTANCE_PASSED_BY_OWNER` / `NOT_PUSHED` / `STAGE_6_WAVE_4_NOT_STARTED`。

### 4.94 Wave 3 与后续可靠性修复进入远端基线（2026-08-19～20）

4.93 记录的 Wave 3 最终验收结论保持有效。当前 Git 提交拓扑进一步证明：`surdet/main=e04c22409572b8481ccd13c1244e4e08add588df`，该本地追踪的远端基线完整包含 Wave 3 提交链 `c1a68f7 → 2305957`，以及其后的可靠性修复；因此 4.93 中 `NOT_PUSHED` 仅是当时收口瞬间的历史状态，不再是当前事实。

本次接手复核没有执行 fetch/pull/push。实时 `git ls-remote surdet refs/heads/main` 因本机 Schannel `SEC_E_NO_CREDENTIALS` 失败，故当前“远端基线”以已存在的本地追踪指针 `surdet/main=e04c224` 和可验证提交拓扑为依据，不伪装成 2026-08-20 本轮新鲜 GitHub 网络回读。

当前正式回退锚点登记为：

```text
LOCAL_TRACKING_REMOTE_BASELINE = e04c22409572b8481ccd13c1244e4e08add588df
BASELINE_COMMIT = fix(authoring): align URL speaker parsing with core
WAVE_3_INCLUDED_IN_BASELINE = YES
A5_INCLUDED_IN_BASELINE = NO
LIVE_REMOTE_QUERY_THIS_REVIEW = UNAVAILABLE_SCHANNEL_NO_CREDENTIALS
```

### 4.95 Wave 3 后可靠性过渡项已闭合并进入基线（2026-08-19～20）

Wave 3 后至 `e04c224` 的可靠性过渡提交均已位于 `surdet/main` 的本地追踪基线。它们不是 Wave 4，也不改变 Stage 6 的产品方向：

- headless timeline 加载、模拟运行时失败分类、畸形 timeline 校验、canonical timeline 身份、引用作用域与 legacy simulate 接线：`9a63d37`、`78c5972`、`ce1a05c`、`835d742`、`ace5972`、`dddb51f`；当前登记为已闭合、已进入基线；
- 跨项目 change identity 隔离：`9f5a101cfdd8f654362b4a45401b235cf26cc740`；防止不同项目的事务身份混用，登记为 `CLOSED / PUSHED`；
- Calendar 节点条件字段统一为 `visibleWhen`：`7ebe7f26aa96268bcc66ea8dc64d1adf4145343c`；只在显式 Editor Save 时规范化 legacy `when`，双字段冲突 fail-loud，不改 Core 的合法 `baseCommands[].when`，登记为 `CLOSED / PUSHED`；
- Core 与 Authoring 的 URL speaker 解析语义统一：`e04c22409572b8481ccd13c1244e4e08add588df`；Authoring 复用 Core 公开 `extractSpeaker`，关闭 URL 被误判为 speaker、错误角色边及 rename 污染，登记为 `CLOSED / PUSHED`。

已接受但不阻断当前路线的低优先级备注：Calendar helper 级冲突序列化合同仍可将来加固、CLI 诊断略有重复；`extractSpeaker` 公共 API 目前依赖调用者先做 `trimStart`，配对合同测试的 normalization 与生产 normalization 形式相近。它们均不是已证明的当前活动缺陷，不得插队 A5。

### 4.96 A5 新鲜复现与严重度裁决：存档槽位文件名碰撞（2026-08-20）

当前唯一活动可靠性主题为 `3B-A5 / SAVE SLOT FILENAME COLLISION`，主文件为 `packages/shell/src/save-store.ts`。新鲜复现已在远端基线 `e04c224` 上完成并由 Architect 接受，不因执行者更换而重复。

旧 L1 `sanitizeSlot()` 使用可变长十六进制转义且允许十六进制字面量直出，转义边界不唯一。已证明的最小碰撞为：

```text
logical A = "存"   (U+5B58)
logical B = "[58"  (U+005B U+0035 U+0038)
legacy L1(A) = _x5b58
legacy L1(B) = _x5b58
```

真实 `FileSaveStore` 复现证明同一物理文件会导致静默覆盖、错误槽位读取、逻辑列表折叠、索引键碰撞、删除影响另一逻辑槽位、备份所有权别名以及恢复目标歧义。默认 Starter / Zero UI 目前只使用固定安全槽位 ID，不直接暴露该输入，但公共 engine / host / shell API 接受任意 `slot:string`，且没有上游校验阻断。由于它能静默破坏玩家存档、备份和恢复所有权，严重度定为：

```text
A5_REPRODUCTION = PROVEN
A5_SEVERITY = HIGH
A5_FIX_REQUIRED = YES
```

修复约束已固化：保留 Unicode 与任意 JavaScript 字符串（包括孤立 UTF-16 surrogate）；不做 Unicode normalization；新 canonical 物理命名空间必须与 legacy L1/L0 值域机械不相交；编码需确定、可逆、对大小写不敏感 Windows 文件系统仍无碰撞；存量存档只做 lazy compatibility，不批量迁移、不因 read 自动重写；所有 legacy/canonical main 与 `.bak` 必须以 `snapshot.meta.id` 独立验证所有权，不符即 fail-loud；`list()`/`listMeta()` 只暴露逻辑 ID；canonical 与 legacy 同一逻辑槽位只列一次且 canonical 优先。

A5 与 A6 严格分离：A5 只处理槽位身份与所有权；`FileSaveStore` 主档/索引跨文件事务原子性属于 A6，未经新鲜复现与单独授权不得夹带。

### 4.97 A5 两笔本地修复、已通过部分与 R2 唯一阻断（2026-08-20）

当前本地 A5 提交链已从 Git 独立确认：

```text
e04c22409572b8481ccd13c1244e4e08add588df
  -> 61ac100a70ab99b5761abfb5d151902a2e108347
  -> bbefcf02ce34e7da4d100f5240ae69728c09aba9  (HEAD)
```

`61ac100` 实现 versioned canonical 存储身份、严格 decoder、legacy L1/L0 懒兼容、所有权验证、canonical 写入/备份/恢复目标、逻辑列表/索引、历史碰撞回归与单射/命名空间 oracle。`bbefcf0` 随后关闭两项真实跟进缺陷：

1. canonical 文件名解码出的逻辑 owner 与 `snapshot.meta.id` 不一致时，`list()` / `listMeta()` / `listBackupMeta()` 现在 fail-loud，不再暴露 `read()` 无法读取的幻影槽位或备份；
2. `index.json` 使用 null-prototype record，`__proto__`、`constructor`、`prototype`、`toString`、空字符串及 Unicode ID 均作为普通自有键处理，不再触发原型访问器或静默丢键。

本次总经理接手复核新鲜运行：

```text
npm run test -w @surdet/shell -- test/save-store-canonical-encoding.test.ts test/save-store-slot-collision.test.ts test/save-store.test.ts
  = exit 0; 3 files / 54 tests passed
npm run build -w @surdet/shell
  = exit 0
```

这些绿灯只证明当前两笔提交已有合同成立，不等于 A5 通过。源码复核确认剩余 R2 blocker 真实存在：当前 canonical 文法仅让 `[a-z0-9_-]` 直出，大写 ASCII 每字符编码为 `~` + 4 位十六进制，约 1→5 膨胀；而旧安全字母表为 `[A-Za-z0-9-]`，包含大写字母。现有“普通安全 ASCII 不爆长”测试只覆盖小写样例，未覆盖 `A`、`Save`、`SAVE`、`QuickSave1` 或长大写/混合大小写 ID。

因此当前 Architect gate 保持：

```text
A5_ARCHITECT_REVIEW = NEEDS_FIX
SAFE_ASCII_LENGTH_REGRESSION_AVOIDED = NOT_ESTABLISHED
PRIMARY_REPAIR = LOCALLY_IMPLEMENTED
FIRST_FOLLOWUP_REPAIR = LOCALLY_IMPLEMENTED
R2_COMPACTNESS_REPAIR = PENDING
A5_INDEPENDENT_REVIEW = NOT_STARTED
A5_PUSH = NOT_STARTED / NOT_AUTHORIZED
```

R2 是唯一获准的下一施工主题：先核对上述两笔提交基线；新增大写/混合大小写安全 ASCII compactness 红灯和具体长度不变量；做最小 encoding-only 修正；重跑单射、大小写折叠唯一性、canonical/legacy 值域不交、所有权、prototype-safe index、legacy compatibility 聚焦合同；再跑 Shell build 与完整 Shell test；如需修复必须新建普通本地提交，不 amend、不 push。不得借 R2 修改 A6 事务语义。

### 4.98 Codex 总经理重新接手与 Wave 4 硬停止点（2026-08-20）

项目所有者于 2026-08-20 把临时经理草拟的可靠性/治理材料交回 Codex 总经理审核，并授权在核对无误后直接写入长期路线台账。Codex 已独立核对 AGENTS、现有长期台账、Wave 3 任务书/交付报告、真实 Git、A5 两笔提交范围、关键源码与聚焦测试；本条及 4.94～4.97 是对草稿的校正整合，不建立第二份 superseding ledger。

当前角色边界保持：项目所有者决定 push 与阶段转换；Codex GPT 总经理管理项目路线与 Wave 门；ChatGPT Architect/Reviewer 裁决可靠性 finding、严重度与证据门；当前指定 Operator 为 Codex 上的 Lunamax，只在书面单主题授权内施工；独立 Reviewer 只在 Architect PASS 后进行最终只读复核。执行 AI 不拥有长期路线台账写权限，只能在交付报告末尾提出“建议由总经理登记的事实”。

Wave 4 维持硬停止：A5 R2 完成并不自动等于 A5 CLOSED；必须依次经过 Architect PASS、独立 Reviewer APPROVED、项目所有者明确 push 授权与远端回读。随后项目所有者重新咨询总经理、获得新的 Wave 4 方向与任务书授权后，才可规划或实施 Wave 4。当前不得把 A6、generic instr/start reentrancy、tint snapshot restoration、`scheduled[].when` lint、Editor/CLI reachability、Windows copy fallback、扩展市场、音频、性能或发行混入 A5。

当前状态追加：`STAGE_6_WAVE_3_COMPLETED_AND_IN_REMOTE_TRACKING_BASELINE` / `A5_REPRODUCTION_PROVEN_HIGH` / `A5_PRIMARY_AND_FIRST_FOLLOWUP_LOCAL` / `A5_R2_COMPACTNESS_REPAIR_PENDING` / `A5_ARCHITECT_REVIEW_NEEDS_FIX` / `A5_INDEPENDENT_REVIEW_NOT_STARTED` / `A5_NOT_PUSHED` / `WAVE_4_NOT_STARTED_HARD_STOP`。

### 4.99 A5 两笔未终审提交被项目所有者误触普通 push（2026-08-20 14:22）

项目所有者误把此前保留的 `cd E:\surdet` / `git push surdet main` 指令当作当前指令执行。总经理随即要求停止其它 Git 操作并只读核对。真实结果：

```text
branch = main
HEAD = bbefcf02ce34e7da4d100f5240ae69728c09aba9
surdet/main = bbefcf02ce34e7da4d100f5240ae69728c09aba9
ahead/behind = 0 0
remote-tracking reflog = 2026-08-20 14:22:47 +08:00 update by push
previous remote-tracking baseline = e04c22409572b8481ccd13c1244e4e08add588df
push type = ordinary fast-forward push
force push / history rewrite = NO
protected or untracked governance files included = NO
```

进入远端的新增范围只有 A5 两笔既有提交：`61ac100`（4 个 Shell 源码/测试文件）与 `bbefcf0`（2 个 Shell 源码/测试文件）。这两笔提交的既有合同在 4.97 的新鲜聚焦复核中为 54/54 tests + Shell build 通过，但 A5 仍未满足 R2 compactness gate，不能因为 push 发生就改写为 Architect PASS、Independent APPROVED 或 CLOSED。

总经理当前处置裁决：**不自动 force push、reset、rebase 或 revert。** force push 会重写共享历史；普通 revert 会重新引入已证明为 High 的静默槽位碰撞。除非项目所有者之后明确要求恢复远端旧基线，当前风险更低的路径是在 `bbefcf0` 上冻结部署/发行与 Wave 4，尽快完成唯一剩余 R2 encoding-only 修复，再依次补 Architect、独立 Reviewer 与后续普通 push 门。此次误 push 是治理偏差，不是数据丢失事故。

当前状态追加：`A5_PREMATURE_ORDINARY_PUSH_OCCURRED` / `REMOTE_MAIN_AT_BBEFCF0` / `NO_HISTORY_REWRITE` / `NO_PROTECTED_FILES_PUSHED` / `A5_R2_STILL_REQUIRED` / `A5_ARCHITECT_REVIEW_NEEDS_FIX` / `DEPLOYMENT_AND_RELEASE_FROZEN` / `WAVE_4_HARD_STOP`。

### 4.100 项目所有者批准长期“三层协作模式”（2026-08-20）

项目所有者明确决定长期采用以下协作制度，不再把总经理、可靠性 Architect 与执行施工混在同一个对话中：

1. **Codex GPT 总经理负责大方向。** 总经理根据项目真实状态主动决定下一 Wave 的推荐方向、阶段顺序、范围边界和停止条件；负责生成每个 Wave 的总任务书，并在重大路线变化、Wave 交接和最终阶段闭合时回到项目级视角复核。项目所有者不需要先替总经理提出完整技术方案。
2. **网页版 GPT 5.6 SOL 负责日常 Architect / Reviewer 工作。** 它在总任务书和总经理路线内处理 finding 裁决、严重度、最小 repair directive、方法审查、Operator 报告复核和独立复审前置门；可以消耗较充足额度阅读源码与证据，但不得自行改变 Wave 方向、扩大总任务范围、授权 push/发行或取代项目所有者的视觉、声音和手感判断。
3. **执行 AI 负责实现与证据。** 它按单主题指令施工，建立红灯、做最小修复、运行与风险匹配的测试、创建普通本地提交并返回证据；不得写长期路线台账、不得自行宣布 finding/Wave CLOSED、不得 push、部署、发行或开始下一主题。
4. **项目所有者保留最终主权。** 项目所有者负责真实体验结论、是否接受产品方向、push、部署、发行及重大优先级变更；可以否决或改写总经理方向。未经项目所有者明确授权，任何 AI 都不得执行远端或发行操作。

长期工作流固定为：

```text
项目所有者体验与目标
  → Codex 总经理确定 Wave 方向与总任务书
  → 网页版 GPT 5.6 SOL 在任务书内担任 Architect / Reviewer
  → 执行 AI 单主题施工、测试、本地提交、报告
  → 网页版 GPT 做日常证据门复审
  → Codex 在 Wave 方向、重大架构变化或最终闭合门重新接管
  → 项目所有者完成人工体验判断并决定 push / 下一 Wave
```

成本与质量原则保持：质量是最高优先级；质量不受影响时，优先把长源码通读、重复证据核对和局部 repair review 交给额度充足的网页版 GPT 与执行 AI，Codex 额度集中用于产品方向、架构裁决、总任务书和关键复审。不得为了消耗额度制造任务、无界增加测试或重复已接受的 fresh reproduction。

该制度从当前 A5 R2 起生效，但不改变 A5 的既有门：Lunamax 只执行 R2；网页版 GPT 完成 Architect 复审；A5 通过并获项目所有者 push 授权后，Codex 才正式决定 Wave 4 大方向并制作总任务书。当前不提前启动 Wave 4。

制度登记期间只读检测到 Lunamax 已开始 R2：`packages/shell/test/save-store-canonical-encoding.test.ts` 新增 `[A-Za-z0-9-]` compactness 合同及 `A`、`Save`、`SAVE`、`QuickSave1`、长大写/混合大小写样例，`packages/shell/src/save-store.ts` 同时出现在途修改；两文件均未暂存。该状态属于授权内 Operator 施工，总经理不并行编辑、不抢占、不代替其报告结果，等待其完成红绿灯、Shell 门禁和新本地提交后再进入网页版 GPT Architect 复审。

当前状态追加：`LONG_TERM_THREE_LAYER_COLLABORATION_APPROVED` / `CODEX_OWNS_WAVE_DIRECTION_AND_MASTER_TASKBOOK` / `WEB_GPT_5_6_SOL_OWNS_DAILY_ARCHITECT_REVIEW` / `EXECUTION_AI_OWNS_IMPLEMENTATION_AND_EVIDENCE` / `OWNER_RETAINS_EXPERIENCE_AND_REMOTE_AUTHORITY` / `WAVE_4_DIRECTION_TO_BE_DECIDED_BY_CODEX_AFTER_A5_GATE`。

### 4.101 总经理批准两个专职审核角色，采用风险分层而非全任务双审（2026-08-20）

项目所有者提出增加两个审核 AI，把日常小审核从总经理与网页版 GPT Architect 手中分流。总经理审阅《SURDET REVIEW GOVERNANCE EXPANSION PROPOSAL》后批准新增角色，但裁决为**风险分层双审核体系**，不让所有微小修复机械经过两次重复审查。

#### Local Audit Reviewer / 本地事实审核者（永久默认角色）

本角色必须能够直接读取本机仓库与未推送提交，核心问题只有：“Operator 报告与磁盘真实状态是否一致？”默认只读，可核对 branch/HEAD/祖先/ahead-behind、tracked/staged/untracked、完整 diff、白名单、实现与回归测试、artifact、测试命令及受保护文件状态。它不得修改代码或测试，不得 stage/commit/push/pull/merge/rebase/reset/clean/stash/amend，也不得自行修复发现的问题或宣布 finding CLOSED。

Local Audit 是所有有本地提交的 Operator 工作的默认事实门，但验证强度仍按任务风险：文档和 Low 小修只核对 diff、身份与任务指定聚焦检查；不得因为获得本地访问就无条件重跑完整测试、Electron 或大型矩阵。若发现偏差，只返回 `PASS / FAIL + 精确证据`，由 Architect 统一裁决。

#### Independent Senior Reviewer / 独立高级审核者（高风险独立挑战角色）

本角色与 Operator、Local Audit、Architect 使用独立对话和独立推理上下文，核心问题是：“即使实现与报告一致，这个方案是否仍遗漏架构、语义、兼容、边界或测试模型问题？”它默认只读，不得直接施工或向 Operator 多头派令。

Independent Senior Review 对以下工作强制：High finding、静默数据破坏、存档/恢复/迁移/兼容、关键事务、公共语义真相、重大跨层架构和 Wave 级关键交付。对 Medium 由 Architect 按语义/兼容风险决定；对 Low、普通文档和局部 UI 小修默认不启用，项目所有者可随时额外要求。

#### 审核路由与防止“委员会循环”

```text
LOW / 小型局部修复：
Operator → Local Audit → Architect PASS/NEEDS_FIX → Owner push gate

MEDIUM：
Operator → Local Audit → Architect →（按风险可选 Independent Senior）→ Owner push gate

HIGH / A5 / 重大 Wave：
Operator → Local Audit → Architect PASS → Independent Senior APPROVED → General Manager/Owner gate → push
```

审核者不得直接要求 Operator 修改。所有发现先交 Architect 合并、去重、定级，Architect 一次性发出一份单主题整改指令；Operator 修复后，Local Audit 默认只复核变化增量与此前失败节点，除非改动影响原合同才扩大。每个提交默认一次 Local Audit；Independent Senior 只在 Architect PASS 后做一次最终挑战，禁止“一条低级意见一次修复一次全量重审”的循环。

两类审核 AI 均不拥有长期路线台账写权限，只能提供“建议由总经理登记的事实”。General Manager 仍决定 Wave 方向与总任务书；网页版 GPT 5.6 SOL Architect 仍是局部技术裁决者；执行 AI 仍是唯一施工者；项目所有者仍独占 push、部署、发行和最终体验结论。

为降低项目所有者的转发负担，审核链采用**单一收口包**：Operator、Local Audit 与 Architect 的完整报告在审核链内部依次传递；High/重大任务最终由 Independent Senior Reviewer 在报告末尾生成一份 `MANAGER_HANDOFF_PACKET`，项目所有者只需把这一份汇总交给 Codex 总经理。Low/Medium 未启用独立终审时，由 Architect 生成同格式收口包。总经理仅在汇总存在矛盾、缺少关键身份或需要争议仲裁时，才要求补交某一份原始报告；默认不得让项目所有者搬运四份长报告。

#### A5 首次应用

Lunamax 已创建 R2 本地提交：

```text
64a3f3216150a4eb8c46d7926fff1de02252c561
fix(shell): compact canonical uppercase slot encoding
changed files = packages/shell/src/save-store.ts; packages/shell/test/save-store-canonical-encoding.test.ts
local ahead/behind = 1 0
tracked/staged = clean / empty
R2 pushed = NO
```

该提交当前只证明“提交存在且范围表面符合白名单”；Operator 完整 RED/GREEN、oracle、Shell build/test 报告尚未交回，因此不写成 R2 PASS。按新制度，下一步先由新 Local Audit Reviewer 只读核对真实提交与报告；通过后交网页版 GPT Architect；A5 为 High，Architect PASS 后必须再交 Independent Senior Reviewer，最后才由项目所有者决定 R2 push。误 push 进入远端的 `61ac100`/`bbefcf0` 事实不变。

当前状态追加：`LOCAL_AUDIT_REVIEWER_ROLE_APPROVED` / `INDEPENDENT_SENIOR_REVIEWER_ROLE_REESTABLISHED` / `RISK_TIERED_REVIEW_POLICY_APPROVED` / `LOCAL_AUDIT_DEFAULT_FOR_OPERATOR_COMMITS` / `INDEPENDENT_REVIEW_MANDATORY_FOR_HIGH_AND_WAVE_CRITICAL` / `REVIEWERS_READ_ONLY_NO_DIRECT_REPAIR` / `ARCHITECT_CONSOLIDATES_ALL_FINDINGS` / `A5_R2_LOCAL_COMMIT_64A3F32_AWAITING_OPERATOR_REPORT_AND_LOCAL_AUDIT`。

### 4.102 Independent Final Reviewer 职责合并（2026-08-20）

项目所有者确认：原 `Local Audit Reviewer / 小镜` 的职责并入 `Independent Senior Reviewer / 小衡`；自本条起，小衡是 Surdet 唯一独立终审角色，名称为 `Independent Final Reviewer`。小镜不再作为独立审核节点运行。

小衡同时负责：

- Local Audit 验真：真实 `HEAD`、parent、remote main、ahead/behind、tracked worktree、staged 状态、受保护未跟踪文件、提交真实性与变更范围；
- 测试证据核验：focused tests、full tests、build、数量与产品合同对应关系；
- Independent Senior / Final Reliability Challenge：主动挑战 alias、collision、平台文件系统语义、兼容性、隐藏状态不一致、Architect 合同遗漏与范围越界。

小衡保持只读权限，不修改代码或测试，不 stage/commit/push/merge/release，不改变 Wave 方向，也不取代 Architect、Codex 或项目所有者。小衡可以在终审报告中提出明确修复要求并给出 `NEEDS_FIX`；若涉及合同解释、严重度或范围争议，再交 Architect 作技术裁决。

High/A5 新审核顺序改为：

```text
Lunamax Operator
  → Operator Final Report
  → Architect PASS
  → 小衡 Independent Final Reviewer
       （Local Audit + Independent Review + Final Gate）
  → 项目所有者 push 决策
```

本规则不改变 A5 的 High 严重度、A6/Wave 4 硬停止或项目所有者对 push 的独占授权。当前 `A5_R2` 仍须在收到本轮 Operator Final Report 后，才能由小衡执行合并后的最终复审。

当前状态追加：`LOCAL_AUDIT_ROLE_MERGED_INTO_INDEPENDENT_FINAL_REVIEWER` / `XIAOHENG_IS_SOLE_INDEPENDENT_FINAL_REVIEWER` / `A5_FINAL_GATE = OPERATOR_REPORT → ARCHITECT_PASS → INDEPENDENT_FINAL_REVIEW（含 LOCAL_AUDIT）→ OWNER_PUSH_DECISION` / `PUSH_AUTHORIZED = NO`。

### 4.103 A5 R2 Architect、小衡终审与总经理独立复核通过（2026-08-20）

项目所有者提交了小衡生成的单一收口包。原小镜 Local Audit 已由小衡合并执行，结论为 `LOCAL_AUDIT_RESULT = PASS`；网页版 GPT Architect 结论为 `ARCHITECT_REVIEW = PASS`；小衡对 Windows 大小写不敏感路径、canonical 主档/备份、所有相关入口、ownership、legacy lazy compatibility、backup/restore、index key 安全和原文件不变性完成独立挑战，结论为 `INDEPENDENT_FINAL_REVIEW_RESULT = PASS`。未发现新的 A5 R2 Blocker、High 或 Medium。

Codex 总经理随后只读复核真实 Git 与最终落盘文件，并新鲜运行与风险匹配的门禁。真实状态为：branch=`main`；HEAD=`0b14ca14ff16b275efe1a3578ade37dbbb2994ec`；parent=`4604a6a973d77daa41ce1df5fd60e2fd5d4574e3`；`surdet/main=bbefcf02ce34e7da4d100f5240ae69728c09aba9`；`git ls-remote surdet refs/heads/main` 也实时返回同一 `bbefcf0`；ahead/behind=`3 0`；tracked 工作树干净；暂存区为空。未推送范围不是单独一笔，而是：

```text
64a3f32 fix(shell): compact canonical uppercase slot encoding
4604a6a fix(shell): enforce canonical save slot decoder
0b14ca1 fix(shell): reject canonical filename case variants
```

`surdet/main..HEAD` 三笔合计仍只修改 `packages/shell/src/save-store.ts` 与 `packages/shell/test/save-store-canonical-encoding.test.ts`，没有 A6、Wave 4、受保护文件或其他生产范围。总经理新鲜运行 `npm run test -w @surdet/shell`，结果 `22/22` test files、`195/195` tests 通过；运行 `npm run build -w @surdet/shell`，exit `0`。小衡提出的“将额外 Windows 组合探针固化为正式回归”登记为 Low 可选加固，不阻断本轮，也不得借此开启新的无界测试任务。

总经理裁决：**批准 A5 R2 技术与审核门，批准进入项目所有者普通 push 决策。** 当前仍未取得项目所有者对本次 push 的明确授权，因此不执行 push；A5 尚未 CLOSED。若项目所有者授权，必须普通 push 当前 `main`，随后回读远端 HEAD=`0b14ca14ff16b275efe1a3578ade37dbbb2994ec` 与 ahead/behind=`0 0`，再登记 A5 CLOSED。A6 与 Wave 4 仍未授权、未开始。

当前状态追加：`A5_R2_IMPLEMENTATION_PASSED` / `A5_ARCHITECT_REVIEW_PASSED` / `A5_INDEPENDENT_FINAL_REVIEW_PASSED` / `A5_GENERAL_MANAGER_REVIEW_APPROVED` / `A5_READY_FOR_OWNER_PUSH_DECISION` / `A5_OWNER_PUSH_AUTHORIZATION_PENDING` / `A5_NOT_CLOSED` / `A6_NOT_AUTHORIZED` / `WAVE_4_NOT_STARTED_HARD_STOP`。

### 4.104 项目所有者授权普通 push，A5 正式关闭（2026-08-20）

项目所有者明确回复“批准 push”。总经理在操作前确认 branch=`main`、local HEAD=`0b14ca14ff16b275efe1a3578ade37dbbb2994ec`、实时远端 main=`bbefcf02ce34e7da4d100f5240ae69728c09aba9`、tracked 工作树干净、暂存区为空，且身份与 4.103 已批准范围完全一致。随后只执行普通命令：

```text
git push surdet main:main
```

GitHub 返回 `bbefcf0..0b14ca1  main -> main`。push 后立即回读：local HEAD=`0b14ca14ff16b275efe1a3578ade37dbbb2994ec`；本地追踪 `surdet/main` 同一 SHA；`git ls-remote surdet refs/heads/main` 实时返回同一 SHA；ahead/behind=`0 0`。未使用 force push、历史改写、部署、打包或发行；未跟踪的台账、AGENTS、受保护文件、handoff 与 `.learnings` 均未进入 push。

总经理裁决：`3B-A5 / SAVE SLOT FILENAME COLLISION` 已完成实现、Architect 复审、小衡终审、总经理复核、项目所有者授权、普通 push 与远端回读的完整闭环，状态改为 **A5 CLOSED / PUSHED**。这不自动授权 A6 或 Wave 4；下一步停在项目所有者与总经理重新确定 Wave 4 大方向和总任务书。

当前状态追加：`A5_CLOSED` / `A5_PUSHED_AT_0B14CA1` / `REMOTE_MAIN_CONFIRMED_0B14CA1` / `AHEAD_BEHIND_0_0` / `NO_FORCE_PUSH` / `NO_PROTECTED_FILES_PUSHED` / `A6_NOT_AUTHORIZED` / `WAVE_4_NOT_STARTED_AWAITING_OWNER_AND_GENERAL_MANAGER_DIRECTION`。

### 4.105 项目所有者重新确认 AI 友好使命并授权 Wave 4 多方案设计（2026-08-20）

项目所有者再次明确：Surdet 的梦想与长期产品身份，是成为一个真正对 AI 友好的 Galgame 引擎。这里的 AI 友好继续严格解释为：**外部电脑端 Agent 能通过稳定、类型化、可发现、可验证的 Surdet 公共能力制作游戏；Surdet 本身不内置模型、不复制第二套 AI 专用创作逻辑。** 人类与 Agent 仍须共用 `@surdet/authoring` 的事务、对象身份、校验、因果证据、预览与提交语义。

在 Wave 1～3 已分别打通场景/变量、既有资源演出、角色/入口配置之后，项目所有者授权总经理进入 Wave 4 产品方向设计，并要求像此前一样先提出多个差异明确的候选方案再由其选择。总经理据真实能力面（当前 `capabilities.describe` 主要返回 20 个能力名称，已有 inspect/change/scene/variable/character/timeline/validate/simulate/runtime/diff/commit/rollback）提出三类候选：

1. **外部 Agent 本地工具桥与自描述能力合同**：让新 Agent 不读源码、不依赖超长提示词，也能发现输入 schema、前置条件、错误与修复动作，并通过安全本地协议调用现有共享能力；
2. **全项目因果审计与自主修正证据闭环**：把已有 validate/simulate/trace/diff 提升为可按对象、分支、结局和资源检查完成度的项目级审计；
3. **受控资产接入与来源链**：让外部 Agent 把外部生成或已有的图像资产经类型、哈希、命名、冲突与来源校验安全纳入项目，再由既有 timeline/scene 能力引用。

三者当前均只是待选设计方向，不是获准施工范围。总经理初步推荐第一项，因为它最直接兑现“外部 Agent 友好而非引擎内置 AI”，并能让 Wave 1～3 已有能力真正被不同桌面 Agent 低上下文、低误用地调用；项目所有者选择前不创建生产提交、不进入 implementation、不自动启动 MCP/扩展市场、资产生产、音频、性能或发行。

当前状态追加：`AI_FRIENDLY_EXTERNAL_DESKTOP_AGENT_MISSION_REAFFIRMED` / `NO_EMBEDDED_AI_MODEL` / `HUMAN_AND_AGENT_SHARE_AUTHORING_KERNEL` / `WAVE_4_MULTI_OPTION_DESIGN_AUTHORIZED` / `WAVE_4_DIRECTION_SELECTION_PENDING_OWNER` / `WAVE_4_SPEC_NOT_STARTED` / `WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED`。

### 4.106 项目所有者选择 Wave 4 A：Surdet Agent Port（2026-08-20）

项目所有者明确回复“选 A”，正式确定 Wave 4 的产品方向为 **Surdet Agent Port / 自描述创作端口**。本 Wave 的核心成功标准是：外部电脑端 Agent 只获得项目目录与创作意图，不需要阅读 Surdet 源码或携带超长专用提示词，就能通过机器可发现的正式合同理解并安全调用 Wave 1～3 已有 authoring 能力，完成隔离修改、校验、模拟、正式运行证据、修正、diff 与项目提交。

本选择固定以下边界：Surdet 不内置模型、不承担自然语言推理、不复制 AI 专用写入路径；Agent Port 只暴露 `@surdet/authoring` 的共享语义；不得开放任意 Shell、任意文件访问、自动 Git、push、云服务、扩展市场、音频生产或资产生成。对外传输协议、能力 schema、自主级别、会话与项目根绑定、错误修复合同、交付胶囊以及首个真实外部 Agent 验收路径，仍须在分段设计中逐项获得项目所有者确认。

当前授权仅覆盖 Wave 4 详细设计与规格形成，不授权修改生产代码、测试、依赖、配置或创建实现提交。下一设计门为首版对外连接方式：采用标准本地 Agent 工具协议薄适配、Surdet 原生 stdio JSON，或首轮同时提供两者；总经理核对当前标准事实后提出推荐，由项目所有者选择。

当前状态追加：`WAVE_4_DIRECTION_SELECTED_AGENT_PORT` / `EXTERNAL_AGENT_SELF_DESCRIBING_AUTHORING_PORT_APPROVED` / `NO_EMBEDDED_MODEL_OR_AI_WRITER` / `TRANSPORT_DESIGN_PENDING_OWNER` / `WAVE_4_DESIGN_IN_PROGRESS` / `WAVE_4_SPEC_NOT_WRITTEN` / `WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED`。

### 4.107 项目所有者因疑似模型服务质量异常暂停 Wave 4（2026-08-20）

项目所有者报告：当前网络上出现 OpenAI 服务异常及模型路由变化的说法，其个人体验也怀疑当前对话没有处于预期的 5.6 SOL 状态。该外部服务传闻本轮没有独立核验，因此台账不把“已发生模型降级”写成已验证事实；但项目所有者对当前决策质量缺乏信心本身足以构成暂停理由。

项目所有者明确要求“先暂停，等恢复后重新讨论 Wave 4”。自本条起：停止 Wave 4 的方案比较、Agent Port 连接架构、正式设计规格、实施任务书与任何施工；不继续消耗额度调查服务状态。4.106 的 Agent Port 选择与随后提出的 A1“Surdet 原生合同 + MCP 薄适配”只作为本次中断前的历史讨论材料，恢复时可以重新采用、修改或否决，不视为不可撤销的最终产品决定。

暂停期间不得让 Architect、执行 AI 或小衡自行延续 Wave 4，也不得以“已选 A”为由创建代码、测试、依赖、配置、设计文档或提交。A6、音频、性能、发行、扩展市场和其他延期主题同样不自动解冻。唯一恢复条件是项目所有者明确表示模型状态已恢复并要求重新讨论 Wave 4；恢复后总经理须重新读取真实仓库与台账，从产品方向层重新提出或确认候选方案。

当前状态追加：`WAVE_4_PAUSED_BY_OWNER` / `MODEL_SERVICE_QUALITY_CONCERN_REPORTED_NOT_INDEPENDENTLY_VERIFIED` / `AGENT_PORT_AND_A1_RETAINED_AS_NON_BINDING_HISTORY` / `WAVE_4_DIRECTION_TO_BE_REOPENED_ON_RESUME` / `NO_SPEC_NO_TASKBOOK_NO_IMPLEMENTATION` / `WAITING_FOR_OWNER_RESUME`。

### 4.108 项目所有者恢复 Wave 4 并选择 A1 原生合同 + MCP stdio 薄适配（2026-08-20）

项目所有者判断当前客户端不受此前疑似网页端/聊天模式服务异常影响，并明确要求“继续，接着刚才的进度走”，由此满足 4.107 的恢复条件。该判断作为项目所有者的使用体验记录，不扩写为对 OpenAI 全局服务状态的独立技术结论。

项目所有者正式选择 A1，固定 Wave 4 Agent Port 的第一项架构决策：

- `@surdet/authoring` 及其共享合同仍是 Surdet 领域语义的唯一真相；能力名称、输入/输出结构、事务要求、错误/修复语义、对象身份与证据身份不得只存在于 MCP 层；
- 首轮新增本机 MCP `stdio` 薄适配，把共享能力合同映射为标准工具发现与调用；不监听 HTTP 端口、不建设远端鉴权、账号、云服务或市场；
- CLI 与 Editor 继续复用同一原生合同；MCP adapter 不复制第二套 validation、transaction、runtime、diff 或 commit 逻辑；
- Surdet 不调用模型，不把 prompts/sampling/chat 作为创作内核职责；自然语言理解与规划仍由外部桌面 Agent 完成；
- MCP 只是首个标准对外适配器，不成为 Surdet 项目格式或长期领域模型，未来增加其他适配器时不要求改写 authoring 内核。

A1 的选择仍只授权详细设计，不授权新增依赖、包、生产代码、测试或配置。下一设计门是 Port 的项目边界：每个 stdio 进程是否只绑定一个启动时显式指定的项目根，或允许一个进程管理多个已注册项目；该选择将决定路径安全、会话身份、change store 与证据隔离方式。

当前状态追加：`WAVE_4_RESUMED_BY_OWNER` / `WAVE_4_A1_SELECTED` / `AUTHORING_CONTRACT_IS_SINGLE_SOURCE_OF_TRUTH` / `LOCAL_MCP_STDIO_THIN_ADAPTER_APPROVED` / `NO_HTTP_CLOUD_OR_EMBEDDED_MODEL` / `PROJECT_ROOT_BINDING_DESIGN_PENDING` / `WAVE_4_DESIGN_IN_PROGRESS` / `WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED`。

### 4.109 项目所有者选择 A1.1：每个 Agent Port 进程绑定一个项目根（2026-08-20）

项目所有者明确选择 `A1.1`。Wave 4 首版的项目隔离边界固定为：一个本地 MCP stdio Port 进程在启动时接收并验证一个显式项目根，整个进程生命周期只服务该项目；工具调用不再接受任意 `projectRoot`，切换项目必须结束当前进程并以另一个项目根重新启动。

由此固定以下不变量：

- 初始化时解析真实绝对项目根，确认合法 Surdet 项目并记录项目身份、初始 project revision、engine/contract version；
- 所有 inspect、transaction、operation、validate、simulate、runtime、trace、diff、commit 与 evidence 都隐式绑定该项目身份；
- change store、operation idempotency、artifact 与 evidence 路径必须按项目身份隔离，拒绝跨项目 changeId/objectRef/evidenceId；
- 工具 schema 不暴露任意项目路径、任意文件路径或工作目录参数；项目根外文件、Shell、Git 与网络仍不属于 Agent Port 能力；
- 切换项目通过结束并重新启动 Port 完成，不为首轮建设多项目注册表、路由、热切换、跨项目事务或共享会话。

A1.1 只完成项目边界设计，不授权实现。下一设计门为自治权限档位：观察、隔离施工与通过门禁后的项目提交应怎样由启动策略控制，既保留全自动创作能力，又不让 Agent 获得 Git/push 或项目根外权限。

当前状态追加：`WAVE_4_A1_1_SINGLE_PROJECT_PORT_SELECTED` / `ONE_PROCESS_ONE_PROJECT_ROOT` / `NO_PROJECT_PATH_IN_TOOL_CALLS` / `CROSS_PROJECT_IDENTITIES_REJECTED` / `PROJECT_SWITCH_BY_PROCESS_RESTART` / `AUTONOMY_POLICY_DESIGN_PENDING` / `WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED`。

### 4.110 项目所有者选择 P1：observe / stage / apply 三档自治权限（2026-08-20）

项目所有者明确选择 `P1`。Agent Port 首版必须支持三档由启动者选择、进程生命周期内不可由 Agent 提升的权限策略：

- `observe`：允许项目/对象/资产检查、校验、模拟和既有证据读取；禁止建立可写事务和任何项目写入；
- `stage`：允许在项目外的 Surdet change store 建立隔离事务，执行类型化修改、校验、模拟、正式运行证据和 diff；禁止 `change.commit` 写回真实项目；
- `apply`：拥有 stage 能力，并允许在共享 authoring 的新鲜基线、事务、校验和恢复门全部满足时执行 `change.commit`；不满足即 fail-loud，不能降级为部分写入。

三档均不授予 Shell、任意文件路径、Git commit、stage、branch、push、部署、网络或项目根外写权限。启动参数或受信本机配置决定权限；MCP 工具调用不能修改策略。切换权限必须结束当前 Port 并重新启动，使外部 Agent 无法通过一次普通工具调用从 observe/stage 升级到 apply。

P1 同时保护两种真实工作流：项目所有者可以用 stage 审查 Agent 的完整隔离交付，也可以在受控 fixture 或明确授权项目上用 apply 证明全自动创作；不得为了安全把 Surdet 永久限制为只能提出方案，也不得为了自动化取消项目所有者的批准边界。

当前状态追加：`WAVE_4_P1_THREE_AUTONOMY_PROFILES_SELECTED` / `OBSERVE_STAGE_APPLY` / `POLICY_FIXED_FOR_PROCESS_LIFETIME` / `AGENT_CANNOT_SELF_ELEVATE` / `APPLY_STILL_NO_GIT_PUSH_OR_SHELL` / `MCP_TOOL_SHAPE_DESIGN_PENDING` / `WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED`。

### 4.111 项目所有者选择 T1：每项能力对应独立类型化 MCP 工具（2026-08-20）

项目所有者明确选择 `T1`。Agent Port 不采用万能 `surdet_call`，也不把不同动作塞进大型 action 联合工具；共享 authoring registry 中的每项正式能力映射为一个名称稳定、输入/输出 schema 精确、权限和副作用明确的 MCP 工具，例如 project.inspect、scene.patch、project.validate、runtime.run-from、change.diff 与 change.commit 各自独立。

工具设计固定以下原则：

- 工具 schema 机械来源于 Surdet 原生合同，不在 MCP adapter 手写第二套易漂移类型；
- 每个工具声明用途、输入、结构化输出、所需自治档位、是否只读、是否幂等、事务/修订前置条件、可能错误代码与确定性修复提示；
- `tools/list` 只暴露当前 P1 档位实际可调用的工具；另有只读 session 描述明确报告 observe/stage/apply、项目身份、合同版本和因权限未开放的能力，使“不可调用”与“不存在”可区分；
- 工具命名使用稳定 Surdet 前缀与领域动作，不能借 MCP 重命名现有领域语义或让 CLI/Editor 追随 adapter 命名；
- 工具调用直接委托现有 AuthoringService/共享内核，不建立第二套 dispatcher、validation、transaction、runtime 或 commit。

T1 当前只决定工具形态，不授权生产实现。下一设计门为 Wave 4 范围宽度：首轮是严格封装、自描述并真实证明现有 Wave 1～3 能力，还是同时新增项目审计或资产接入能力。

当前状态追加：`WAVE_4_T1_TYPED_TOOL_PER_CAPABILITY_SELECTED` / `NO_UNIVERSAL_SURDET_CALL` / `SCHEMAS_DERIVED_FROM_NATIVE_CONTRACT` / `PERMISSION_FILTERED_TOOL_DISCOVERY` / `SESSION_DESCRIPTION_REQUIRED` / `WAVE_4_SCOPE_WIDTH_DESIGN_PENDING` / `WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED`。

### 4.112 项目所有者选择 S1：Wave 4 只打通现有能力的 Agent Port（2026-08-20）

项目所有者明确选择 `S1`，并要求稳扎稳打。Wave 4 首轮范围固定为：自描述、权限过滤并通过本地 MCP stdio 暴露 Wave 1～3 已有的正式 authoring 能力，增加 Port 自身必需的 session 描述与统一交付胶囊，然后以真实外部桌面 Agent 纵向路径证明这些能力可以被低上下文、无源码知识地安全使用。

本 Wave 不新增项目级审计算法、资产导入/生成/移动、二进制事务、新内容对象、新 DSL、音频、市场、云或自动 Git。后续全项目因果审计与受控资产接入仍属于明确的未来候选，不被否决；它们必须建立在 Agent Port 已真实可用的基线上，不能反过来阻断当前端口纵向切片。

为避免“只做协议壳”而没有产品证据，S1 仍必须证明：新 Agent 能发现工具与 schema，按当前 P1 权限工作，建立隔离事务，完成已有场景/变量/角色/timeline/入口配置创作链，理解并修正至少一个确定性红灯，运行 validate/simulate/runtime/trace，读取对象级 diff，并在 apply 档位满足门禁后提交项目；stage 档位则必须证明相同变更在不触碰真实项目的情况下可形成完整交付胶囊。

当前状态追加：`WAVE_4_S1_EXISTING_CAPABILITIES_ONLY_SELECTED` / `NO_NEW_AUTHORING_DOMAIN_OBJECTS` / `NO_PROJECT_AUDIT_OR_ASSET_IMPORT_IN_WAVE_4` / `SESSION_AND_DELIVERY_CAPSULE_ARE_PORT_INFRASTRUCTURE` / `REAL_EXTERNAL_AGENT_VERTICAL_PROOF_REQUIRED` / `ARCHITECTURE_SECTION_DESIGN_NEXT` / `WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED`。

### 4.113 项目所有者批准 Wave 4 第一节组件边界（2026-08-20）

项目所有者明确认可 Wave 4 第一节架构设计。组件边界固定为：

- `@surdet/authoring` 新增协议无关的 capability registry，成为能力 ID、输入/输出 schema、权限、副作用、事务前置、错误与修复语义的唯一领域合同；不得依赖 MCP、stdio、Node 文件系统或模型；
- `@surdet/cli` 保留现有 `AuthoringService`、`NodeProjectStorage` 与 `NodeChangeStore`，在隔离目录内增加 MCP adapter，并通过第二个 Node 可执行入口 `surdet-agent-port` 启动；首轮不新建 `authoring-node`、`agent-sdk` 或其他预防性工作区；
- MCP adapter 仅负责 stdio 生命周期、P1 policy gate、T1 工具注册、schema 校验和原生结果到 MCP structuredContent 的机械映射；禁止解析 Gal、复制事务/校验/模拟/runtime/commit、执行 CLI 子进程或把错误伪装成成功；
- 调用链固定为 `外部 Agent → MCP stdio → session/policy → typed tool → AuthoringService → @surdet/authoring → Node storage/change store → structured result`；
- Wave 4 不修改 Editor 产品界面或 Core/Renderer/Host/Shell 生产逻辑。人工验收通过现有 Editor 打开 Agent Port 产出的普通隔离 fixture，证明没有 AI 专属旁路格式。

该架构优先复用当前已验证的 Node 执行链，不为形式上的分层搬动大量代码；只有未来出现真实独立发布或第三种 Node host 调用需求时才重新评估拆包。

当前状态追加：`WAVE_4_ARCHITECTURE_SECTION_1_APPROVED` / `AUTHORING_OWNS_PROTOCOL_NEUTRAL_REGISTRY` / `CLI_HOSTS_SURDET_AGENT_PORT` / `MCP_ADAPTER_TRANSLATION_ONLY` / `NO_NEW_WORKSPACE_BY_DEFAULT` / `EDITOR_AND_RUNTIME_PRODUCTION_UNCHANGED` / `SELF_DESCRIBING_CONTRACT_SECTION_NEXT` / `WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED`。

### 4.114 项目所有者批准 Wave 4 第二节自描述合同与错误修复模型（2026-08-20）

项目所有者明确认可第二节设计。共享 capability registry 的每项定义必须包含稳定 ID、标题/用途、最低自治档位、输入/输出 schema、副作用、幂等性、事务/修订前置、可能错误、确定性修复配方与最小合法示例；同一 registry 驱动 MCP 工具发现和参数校验、`capabilities.describe`、CLI 帮助/能力文档与合同测试，禁止继续维护多份漂移清单。

成功 envelope 固定携带 `schemaVersion`、独立的 `contractVersion`、session/capability/project revision，以及适用时的 changeId、workingRevision、operationId 与结构化 result。失败 envelope 保留真实错误代码、类别、消息与 details，并以 `retryDisposition = same-request | after-inspect | after-repair | new-change | manual-recovery | never` 精确替代含糊的 retriable 布尔值；`repairActions` 必须指向正式 Surdet 工具和所需新鲜事实。

确定性修复示例固定为：stale object 先 inspect 再携新指纹重试；validation required 先 validate；validation failed 按 issues 的 objectRef/action 修复；项目基线变化必须开始新 change；commit recovery failed 禁止自动重试并保留 journal 等待人工处理。Surdet 只描述引擎可证明的工程修复，不生成剧情、美术或审美选择。

`contractVersion` 与 MCP protocol version 分离；首轮不支持时初始化 fail-loud，不增加旧字段双写、静默 fallback 或猜测性兼容。

当前状态追加：`WAVE_4_SELF_DESCRIBING_CONTRACT_SECTION_2_APPROVED` / `ONE_CAPABILITY_REGISTRY_DRIVES_MCP_CLI_DOCS_TESTS` / `UNIFIED_SUCCESS_AND_FAILURE_ENVELOPES` / `STRUCTURED_RETRY_DISPOSITION_AND_REPAIR_ACTIONS` / `NO_CREATIVE_DECISIONS_IN_ENGINE_REPAIR_HINTS` / `SESSION_LIFECYCLE_SECTION_NEXT` / `WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED`。

### 4.115 项目所有者批准 Wave 4 第三节会话生命周期并授权完成整份设计（2026-08-20）

项目所有者明确认可第三节，并要求总经理“直接推到底”，不再为剩余设计小节逐段停顿。这里的“推到底”仅指一次性完成 Wave 4 Agent Port 的详细产品与架构设计、写入正式设计规格、自审并创建普通本地设计文档提交；它不表示 Git push，也不授权生产代码、测试、依赖或配置施工。

会话生命周期固定为：一个 `surdet-agent-port` 进程以显式项目根与不可提升的 `observe | stage | apply` 策略启动；一个进程最多绑定一个活动 change；MCP 调用中的项目根和 changeId 由会话机械注入，不允许 Agent 任意改写。`stage` 形成的 OPEN change 只有在项目所有者重启 Port、显式选择 `apply` 并传入 `--resume-change <changeId>` 后才能提交；`observe` 可以只读恢复 change 用于检查。进程退出不得自动 commit 或 rollback，OPEN change 必须持久保留并由后续显式 resume 继续。

首版不增加协作锁、自动合并、并行调度或隐藏重放：不同 Agent 可以基于相同项目修订各自建立隔离 change，但先提交者改变项目 revision 后，后提交者必须收到既有 `PROJECT_CHANGED_SINCE_BEGIN` / stale 类错误并重新 inspect、建立新 change，不得静默合并。

项目所有者同时授权总经理在已批准的 A1/A1.1/P1/T1/S1 边界内完成权限矩阵、工具投影、交付胶囊、安全边界、错误传播、自动化取证、真实外部 Agent 验收及停止条件设计，并形成正式规格。完成后只需一次文件级复核；项目所有者批准规格之后，才可另行制作总任务书。总任务书、实现、FORMAL、人工验收、push、部署、发行和 Wave 5 均仍未授权。

当前状态追加：`WAVE_4_SESSION_LIFECYCLE_SECTION_3_APPROVED` / `ONE_PROCESS_ONE_PROJECT_ONE_ACTIVE_CHANGE` / `STAGE_TO_APPLY_REQUIRES_OWNER_RESTART_AND_EXPLICIT_RESUME` / `NO_AUTO_COMMIT_OR_ROLLBACK_ON_EXIT` / `NO_LOCK_OR_AUTO_MERGE_IN_WAVE_4` / `GENERAL_MANAGER_AUTHORIZED_TO_COMPLETE_FULL_DESIGN_SPEC` / `DESIGN_DOCUMENT_LOCAL_COMMIT_ONLY` / `WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED`。

### 4.116 Wave 4 Agent Port 正式设计规格完成并创建本地提交（2026-08-20）

总经理已在 A1/A1.1/P1/T1/S1 和已批准三节的边界内，一次性完成权限矩阵、类型化工具投影、单项目/单活动 change 生命周期、统一 envelope 与确定性 repair action、交付胶囊、stdio/路径/commit 安全边界、确定性 MCP FORMAL、低上下文真实外部 Agent 验收、项目所有者 Editor/预览验收、风险与延期项设计，并写入：

`docs/superpowers/specs/2026-08-20-surdet-agent-port-stage-6-wave-4-design.md`

自审确认：设计没有新增 authoring 领域对象、资产导入、项目审计算法、Editor 改版、Core/Renderer/Host/Shell 生产修改、内嵌模型、Shell/Git/网络能力、音频、市场或 Wave 5；FORMAL 使用确定性 MCP 客户端，真实外部 Agent 与项目所有者人工体验分别保留独立证据门。

规格已形成普通本地提交 `4af0d91ea59acc1a6de890df9481a345b503234c`（`docs(authoring): design wave 4 agent port`），提交范围经回读只有上述一份新增设计文档。提交后 HEAD 领先 `surdet/main` 一笔，tracked 工作树干净、暂存区为空；实时远端 `refs/heads/main` 仍为 `0b14ca14ff16b275efe1a3578ade37dbbb2994ec`。长期路线台账仍为未跟踪治理文件，没有进入提交。

当前唯一下一步是项目所有者对正式规格做一次文件级复核。只有项目所有者明确批准规格后，总经理才可调用 writing-plans 方法制作 Wave 4 总任务书；任务书完成后仍需项目所有者另行授权施工。当前不得实现、运行 FORMAL、邀请人工验收、push 或进入 Wave 5。

当前状态追加：`WAVE_4_AGENT_PORT_DESIGN_SPEC_COMPLETED` / `DESIGN_COMMIT_4AF0D91_LOCAL_ONLY` / `WAITING_FOR_OWNER_FILE_LEVEL_REVIEW` / `IMPLEMENTATION_TASKBOOK_NOT_CREATED` / `WAVE_4_IMPLEMENTATION_NOT_AUTHORIZED` / `NOT_PUSHED_AFTER_WAVE_4_DESIGN` / `WAVE_5_NOT_STARTED`。

### 4.117 项目所有者批准 Wave 4 正式规格并授权制作总任务书（2026-08-20）

项目所有者明确回复“Wave 4 规格批准，请制作总任务书”，因此正式批准 `docs/superpowers/specs/2026-08-20-surdet-agent-port-stage-6-wave-4-design.md` 中的 A1/A1.1/P1/T1/S1、单项目会话、权限矩阵、类型化工具、统一错误修复、交付胶囊、安全边界、确定性 FORMAL、真实外部 Agent 与项目所有者人工验收设计。

本轮授权仅允许总经理依据已批准规格和新鲜源码盘点，使用 writing-plans 方法制作一份可直接交给日常 Architect 与执行 AI 的详细 Wave 4 总任务书，并完成自审、磁盘身份回读与普通本地文档提交。项目所有者要求一次性写到底，不为任务书小节中途停顿。

该授权不等于开始实现：执行 AI 不得在任务书完成前修改生产代码、测试、依赖或配置；任务书完成后仍须由项目所有者另行明确批准施工。FORMAL、真实外部 Agent 验收、Editor 人工验收、push、部署、发行、Wave 5、A6、音频、性能和扩展市场均未由本条授权。

当前状态追加：`WAVE_4_DESIGN_SPEC_APPROVED_BY_OWNER` / `MASTER_IMPLEMENTATION_TASKBOOK_AUTHORING_AUTHORIZED` / `WRITING_PLANS_METHOD_REQUIRED` / `TASKBOOK_LOCAL_COMMIT_ONLY` / `WAVE_4_IMPLEMENTATION_STILL_NOT_AUTHORIZED` / `FORMAL_NOT_STARTED` / `NOT_PUSHED_AFTER_WAVE_4_DESIGN` / `WAVE_5_NOT_STARTED`。

### 4.118 Wave 4 Agent Port 总任务书完成并创建本地提交（2026-08-20）

总经理已依据项目所有者批准的正式规格、真实源码盘点和官方 MCP v2 当前事实，完成：

`docs/superpowers/plans/2026-08-20-surdet-agent-port-stage-6-wave-4.md`

任务书共 13 个 Task（Task 0～12）与 91 个可勾选步骤，覆盖协议无关 registry、统一错误/repair/envelope、observe 真只读路径、原生 CLI 共用 dispatcher、稳定 project identity、单项目 session/P1 policy/显式 resume、T1 MCP stdio、invocation ledger、无自引用交付胶囊、安全反测、确定性真实 stdio runner、有界 DIAGNOSTIC/唯一 FORMAL、真实外部 Agent、项目所有者 Editor/预览验收、最终文档闭合和独立 push 门。

自审按 writing-plans 要求完成：规格 24 节均有对应 Task；不存在空测试体、TBD/TODO/FIXME 或模糊“稍后实现”；修正了 registry 类型循环、result-only output schema 与 envelope 不匹配、projectRevision/workingRevision 混淆、胶囊自哈希悖论、Task 6 提前计算胶囊工具、apply evidence freshness 门等设计落地细节。

任务书已形成普通本地提交 `6b9a931c2bf164aaa8a5b49ccdd36258db6c5ef9`（`docs(authoring): plan wave 4 agent port`），提交范围经回读只有上述一份新增任务书。磁盘身份：89,434 bytes，SHA-256=`78586DA4EB6B2941DD7A2D9B6BA5A19744D4607D502022EEB86B37FE2268A9F5`。提交后 HEAD 领先 `surdet/main` 两笔，tracked 工作树干净、暂存区为空；长期路线台账保持未跟踪，未进入提交。

当前唯一下一决策是项目所有者是否批准按该总任务书开始实施。批准后应先交日常 Architect 做 Task 0/Task 1 边界预检，再由一个执行 AI 串行施工；文档头部的 agentic sub-skill 提示不自动授权创建子 AI。当前仍不得施工、运行 FORMAL、push、部署、发行或进入 Wave 5。

当前状态追加：`WAVE_4_MASTER_TASKBOOK_COMPLETED` / `TASKBOOK_COMMIT_6B9A931_LOCAL_ONLY` / `WAITING_FOR_OWNER_IMPLEMENTATION_AUTHORIZATION` / `WAVE_4_IMPLEMENTATION_NOT_STARTED` / `FORMAL_NOT_STARTED` / `NOT_PUSHED_AFTER_WAVE_4_TASKBOOK` / `WAVE_5_NOT_STARTED`。

### 4.119 项目所有者批准“先扫清屋子再迎客”并授权前置 Reliability Fresh Gate 任务书（2026-08-20）

项目所有者把一份针对当前远端基线 `0b14ca14ff16b275efe1a3578ade37dbbb2994ec` 的跨层源码审计交由总经理独立复核。总经理只读核对确认：`SIM-STATE-1`、generic event callback 内 `start()` 重入、`scheduled[].when` CLI lint、非法 `game.config.json` 顶层形状、Renderer tint restore、post-replacement commit bookkeeping、Windows `copyFile` fallback 与 Editor/CLI W007 parity 均有实际源码依据；其中动态行为与最终严重度仍须按类型取得 Fresh Gate，不把源码推断冒充已复现缺陷。

总经理裁决：Wave 4 Agent Port 的正式设计与总任务书不作废，但 implementation 在开始前暂停。优先验证会直接影响 Agent Port `project.simulate`、runtime evidence、apply commit 与项目配置可信度的六项：`SIM-STATE-1`、`TX-COMMIT-POSTREPLACE`、`N7-WINDOWS-REPLACEMENT`、`A7-INVALID-CONFIG`、`M1-GENERIC-START-REENTRANCY`、`N4-SCHEDULED-WHEN-LINT`。M2 tint 与 N9 W007 继续保留为后置 backlog，不混入本前置 Gate。

项目所有者明确回复“我同意，请您制定任务书吧，wave4不急，反正您任务书都写好了，接下来先扫清屋子再迎客”，因此授权总经理使用 writing-plans 方法制作 Fresh Gate 任务书。该授权只覆盖计划文档、自审、长期台账登记和普通本地文档提交；不自动授权动态 Gate、生产修复、Wave 4、push、部署或发行。

当前状态追加：`CLEAN_HOUSE_BEFORE_WAVE_4_APPROVED_BY_OWNER` / `WAVE_4_DESIGN_AND_TASKBOOK_RETAINED` / `WAVE_4_IMPLEMENTATION_PAUSED_BEFORE_START` / `PRE_WAVE_4_RELIABILITY_FRESH_GATE_TASKBOOK_AUTHORIZED` / `PRODUCTION_FIXES_NOT_AUTHORIZED` / `NOT_PUSHED`。

### 4.120 Pre-Wave 4 Reliability Fresh Gate 任务书完成并创建本地提交（2026-08-20）

总经理完成：

`docs/superpowers/plans/2026-08-20-pre-wave-4-reliability-fresh-gate.md`

任务书共 10 个 Task（Task 0～9）与 38 个可勾选步骤。它把五项动态候选拆成使用正确合同断言的单次 Vitest 红灯，把 N7 固定为 Windows 当前源码与 Node 官方 `copyFile` 非原子性合同 Gate；临时诊断测试逐项创建、取证、磁盘回读后机械删除，最终不得进入提交。任何红灯只证明 finding，不在本轮修复；Fresh Gate 结束后仍须由总经理按 R1～R6 分别制作修复任务书。

自审确认：六项前置 finding 均有精确文件、fixture、断言、命令、预期首个失败节点、artifact 和分类规则；M2/N9 的后置边界明确；不存在空测试体、TBD/TODO/FIXME、概率性 crash 循环或全仓高成本门禁。任务书明确禁止修改生产源码、现有正式测试、Wave 4 文件、Starter、受保护文件和长期台账，禁止提交临时红灯或 push。

任务书已形成普通本地提交 `23c24f85a4de44ce7f6e6dd0f69f6f75dd03b47b`（`docs(reliability): plan pre-wave-4 fresh gates`），提交范围经回读只有上述一份新增任务书。提交前磁盘身份：41,487 bytes，SHA-256=`6C6D2D99748F9FA02662F4ABA00A7F6D096D15339BB609AF16314698A8382A3D`。提交后 HEAD 领先 `surdet/main` 三笔，tracked 工作树干净、暂存区为空；长期路线台账保持未跟踪，未进入提交。

当前唯一下一决策是项目所有者是否批准执行该 Fresh Gate Task 0～9。未获授权前不创建临时测试、不运行红灯、不写交付报告、不开始任何生产修复；Wave 4 implementation 继续暂停。

当前状态追加：`PRE_WAVE_4_RELIABILITY_FRESH_GATE_TASKBOOK_COMPLETED` / `FRESH_GATE_TASKBOOK_COMMIT_23C24F8_LOCAL_ONLY` / `WAITING_FOR_OWNER_FRESH_GATE_EXECUTION_AUTHORIZATION` / `PRODUCTION_FIXES_NOT_STARTED` / `WAVE_4_IMPLEMENTATION_PAUSED` / `NOT_PUSHED`。

## 五、任务书生成与恢复协议

> **2026-09-07 适用说明：** 本节原始协议保留；恢复时必须先读第 9.8 节的当前快照和第 9.6 节的现行协作规则，再按目标读取相关任务书、报告和真实源码。已能取得的本机或远端事实由具备访问条件的 AI 自行核对，不要求 Owner 整理。下方“文件白名单”在新 Goal 中解释为预计定位文件与风险边界，不阻止同步同目标相关测试、夹具、配置和文档；旧的固定轮次、哈希收口或普通失败停止条件不自动延续。

任何新任务书必须包含：

1. 本台账中它所属的阶段和为什么现在做；
2. 明确的用户症状或可验证的工程目标；
3. 公共层落点与不应修改的游戏层边界；
4. 文件白名单和禁止触碰范围；
5. 与风险匹配的红灯、绿灯和人工复核；
6. 明确哪些历史问题与本轮无关；
7. 本轮结束时的提交、push、部署和停止状态。

当上下文被压缩或开启新对话时，恢复顺序固定为：

1. 读取仓库根目录 `AGENTS.md`；
2. 读取本文件；
3. 读取最新的相关任务书和交付报告；
4. 只读确认真实 `HEAD`、`surdet/main`、工作树和是否存在并行施工；
5. 再向项目所有者报告当前阶段、已经完成的内容、未完成内容和唯一建议的下一步。

历史报告不能覆盖本台账中的当前路线；新一轮用户明确指令可以改变路线，但必须在新的任务书中记录“为什么改变、改变了哪一项、哪些旧计划因此暂停”。

## 六、当前停止点与历史归档

### 6.1 当前权威停止点（统一入口，2026-09-07 修订）

**当前阶段、已关闭目标、验证暂缓和下一步，统一读取[第 9.8 节](#current-state)。** 本节不再复制一份提交号和状态表。下一轮维护时更新该唯一快照，并在第九节补记实质变化；不得只在末尾追加而让页首或本入口继续指向过时快照。

2026-09-08 已收到 Owner 对 Frontend Pass 8 的明确施工及普通 commit/push 授权，见第 9.10 节；普通问题在同一 Goal 内闭合。历史仅修订台账的授权不再是本轮停止点。

### 6.2 历史状态词汇归档（仅供追溯，不代表当前状态）

下文保留原文，不再作为当前授权来源。原归档中“必须读取 6.1”的表述，现在应理解为先通过上方 6.1 进入第 9.8 节；不能据历史状态块恢复旧 HEAD、旧角色、旧等待门或已关闭 finding。

#### 6.2.1 原 2026-08-20 停止点

> 原小节标题：6.1 当前权威停止点（2026-08-20；以下 supersede 本节后方历史状态词汇）。其中“以下 supersede”的效力只属于当时历史截面，不覆盖此后的第八、九节。

```text
BRANCH = main
HEAD = 23c24f85a4de44ce7f6e6dd0f69f6f75dd03b47b
LOCAL_TRACKING_SURDET_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
LIVE_REMOTE_MAIN = 0b14ca14ff16b275efe1a3578ade37dbbb2994ec
HEAD_AHEAD_BEHIND = 3 0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY

STAGE_6_WAVE_3 = COMPLETED / HUMAN_ACCEPTANCE_PASSED / INCLUDED_IN_TRACKED_REMOTE_BASELINE
CURRENT_ACTIVE_FINDING = NONE
A5_REPRODUCTION = PROVEN
A5_SEVERITY = HIGH
A5_PRIMARY_REPAIR = PREMATURELY PUSHED COMMIT 61ac100
A5_FIRST_FOLLOWUP = PREMATURELY PUSHED COMMIT bbefcf0
A5_R2_CHAIN = 64a3f32 → 4604a6a → 0b14ca1 / PUSHED
A5_R2_IMPLEMENTATION = PASSED
A5_ARCHITECT_REVIEW = PASS
A5_INDEPENDENT_FINAL_REVIEW = PASS
A5_GENERAL_MANAGER_REVIEW = APPROVED
A5_OWNER_PUSH_AUTHORIZATION = GRANTED AND EXECUTED
A5_REMOTE_STATE = COMPLETE AT 0b14ca1 / LIVE REMOTE READBACK CONFIRMED
A5_CLOSED = YES
A5_DEPLOYMENT_RELEASE_USE = NOT PERFORMED

ONLY_AUTHORIZED_NEXT_ACTION = OWNER REVIEWS AND DECIDES WHETHER TO AUTHORIZE PRE-WAVE-4 RELIABILITY FRESH GATE TASK 0
A6_AND_OTHER_FINDINGS = SIX PRE-WAVE-4 FINDINGS SELECTED FOR FRESH GATE / EXECUTION AUTHORIZATION PENDING
PRE_WAVE_4_RELIABILITY_GATE = MASTER TASKBOOK COMPLETED AT 23C24F8 / NO DYNAMIC GATE RUN / NO PRODUCTION FIX
WAVE_4 = A1/A1.1/P1/T1/S1 AGENT PORT DESIGN APPROVED / MASTER TASKBOOK COMPLETED / IMPLEMENTATION PAUSED BEFORE START
WAVE_4_DESIGN_COMMIT = 4af0d91ea59acc1a6de890df9481a345b503234c / LOCAL ONLY / NOT PUSHED
WAVE_4_TASKBOOK_COMMIT = 6b9a931c2bf164aaa8a5b49ccdd36258db6c5ef9 / LOCAL ONLY / NOT PUSHED
PRE_WAVE_4_RELIABILITY_TASKBOOK_COMMIT = 23c24f85a4de44ce7f6e6dd0f69f6f75dd03b47b / LOCAL ONLY / NOT PUSHED
AUDIO_PRODUCTION = FROZEN
PERFORMANCE_RELEASE_LEGACY_DOC_GOVERNANCE = DEFERRED

LONG_TERM_COLLABORATION = THREE-LAYER MODE APPROVED
CODEX_ROLE = WAVE DIRECTION / ARCHITECTURE BOUNDARY / MASTER TASKBOOK / MAJOR GATES
WEB_GPT_5_6_SOL_ROLE = DAILY ARCHITECT / REVIEWER WITHIN MASTER TASKBOOK
EXECUTION_AI_ROLE = IMPLEMENTATION / TESTS / LOCAL COMMIT / EVIDENCE
OWNER_ROLE = EXPERIENCE JUDGMENT / PUSH / DEPLOYMENT / RELEASE / FINAL PRIORITY AUTHORITY

LOCAL_AUDIT_REVIEWER = MERGED INTO XIAOHENG / NO LONGER A SEPARATE ROLE
INDEPENDENT_FINAL_REVIEWER = XIAOHENG / LOCAL AUDIT + FINAL RELIABILITY CHALLENGE / PASS FOR A5 R2
A5_NEXT_GATE = NONE / CLOSED
```

下一顺序固定为：`项目所有者从 Wave 4 候选方向中选择 → 总经理分段设计并取得确认 → 写入正式设计规格 → 项目所有者复核规格 → 总经理制作总任务书 → 项目所有者明确批准 → 才交日常 Architect 与执行 AI 落地`。A5 关闭与 Wave 4 方案讨论均不自动授权施工、A6、音频、性能、发行或其他延期主题。

#### 6.2.2 原 2026-08-26 页首摘要与维护原则

以下两段逐字保留，作为页首修订前的历史记录，不作为当前 Git 或 Wave 状态。

> 最后事实核对：2026-08-26（Asia/Shanghai；分支 `main`，local HEAD=`b6532739c6a80adb2d9bfd3b4865e76e3c38d8d4`，本地追踪 `surdet/main=f8943c293c4537b3867cc8eeea316b19bb4a0b40`，ahead/behind=`2 0`。Wave 5 replacement FORMAL、真实外部 Agent stage、isolated apply/resume、项目所有者短验收、独立终审和普通 push 均已完成；远端已以 `f8943c2` 为 Wave 5 闭合基线。Wave 6 的 A/A1/P1 产品裁决、设计规格和详细总任务书均已完成本地提交；项目所有者已授权执行 AI 从 Task 0 开始串行施工，但不授权越过任务书中的 Owner gate、push、部署、发行或 Wave 7。设计与任务书仍未 push。本长期路线台账保持未跟踪、未暂存、未提交。）
>
> 维护原则：只记录已经由项目总经理确认的路线、优先级、停止条件和事实状态。未经总经理明确批准，不得把“建议”“可能的未来工作”写成“已批准任务”。

#### 6.2.3 原历史状态词汇及说明

以下大段状态词汇保留用于历史审计；其中与 6.1 冲突的 `NOT_PUSHED`、旧 Wave 停止点、旧远端 HEAD、旧人工验收状态均已被 4.93～4.98 与 6.1 supersede，不得再作为当前执行依据。

```text
SAVE_BACKUP_AND_EXPLICIT_RECOVERY_WAVE_1_IMPLEMENTED
FORMAL_ELECTRON_SAVE_RESTORE_VERIFIED
MANAGER_REVIEW_APPROVED
DEPLOYMENT_AUTHORIZED_BY_OWNER
DEPLOYED_FOR_HUMAN_ACCEPTANCE
HUMAN_ACCEPTANCE_PASSED_BY_OWNER
STAGE_3_COMPLETED
BGM_WAVE_1_INTERIM_PLACEHOLDER_PUSHED
BGM_AUDIBLE_CONFIRMED
AUDIO_QUALITY_REJECTED
AUDIO_PRODUCTION_DEFERRED
PERFORMANCE_DEFERRED
DOCUMENT_GOVERNANCE_DEFERRED
M9_NOT_STARTED
PUSH_COMPLETED
LOCAL_REMOTE_SYNCED
TEMPORARY_MANAGER_REVIEW_APPROVED
TEMPORARY_EXECUTOR_TASK_0_COMPLIANT
STAGE_6_WAVE_1_FINAL_CLOSURE_APPROVED
STAGE_6_CLOSURE_DOC_COMMIT_RECOMMENDED
CLOSURE_DOC_PUSH_NOT_AUTHORIZED
STAGE_6_WAVE_1_CLOSURE_DOC_COMMITTED_LOCALLY
WAVE_2_PRESENTATION_SLICE_RECOMMENDED
TIMELINE_IS_ONLY_NEW_WRITABLE_OBJECT
EXISTING_ASSETS_READ_ONLY
FORMAL_PRESENTATION_IS_ACCEPTANCE_EVIDENCE
STAGE_6_WAVE_2_DIRECTION_APPROVED_BY_OWNER
WAVE_2_DESIGN_SPEC_COMMITTED_LOCALLY
WAVE_2_DESIGN_SPEC_CONDITIONALLY_APPROVED
WAVE_2_SPEC_REVISION_REQUIRED
WAVE_2_DESIGN_SPEC_REVISED_V2
WAVE_2_DESIGN_APPROVED_FOR_TASKBOOK
WAVE_2_TASKBOOK_COMMITTED_LOCALLY
WAVE_2_TASKBOOK_CORE_CONSTRAINTS_PRESENT
WAVE_2_TASKBOOK_MISSING_EXPLICIT_RUNNER_COMMAND
WAVE_2_TASKBOOK_MISSING_EXPLICIT_AGENT_PROBE_TARGET
WAVE_2_TASKBOOK_FOCUSED_COMMANDS_SHOULD_BE_EXACT_FOR_QUOTA
WAVE_2_TASKBOOK_CONDITIONAL_DISPATCH_ONLY
WAVE_2_TASKBOOK_EVIDENCE_COMMANDS_PRESENT
WAVE_2_TASKBOOK_AGENT_PROBE_TARGET_EXPLICIT
WAVE_2_TASKBOOK_FOCUSED_TEST_COMMANDS_PRESENT
WAVE_2_TASKBOOK_WORKSPACE_RUNNER_PATH_INVALID
WAVE_2_TASKBOOK_FORMAL_FREEZE_ORDER_AMBIGUOUS
WAVE_2_TASKBOOK_REVISED_AND_APPROVED
WAVE_2_WORKSPACE_RUNNER_PATH_FIXED
WAVE_2_CODE_EVIDENCE_HEAD_ORDER_FIXED
WAVE_2_DISPATCH_AUTHORIZED_BY_OWNER
EXECUTION_AI_DISPATCH_ALLOWED
WAVE_2_IMPLEMENTATION_PLAN_NOT_AUTHORIZED
EXECUTION_AI_NOT_DISPATCHED
PUSH_NOT_AUTHORIZED
HUMAN_ACCEPTANCE_NOT_STARTED
STAGE_6_WAVE_3_NOT_STARTED
STAGE_6_WAVE_2_IMPLEMENTATION_FOCUSED_GREEN
PREFLIGHT_PASSED
DIAGNOSTIC_BUDGET_EXHAUSTED
THREE_FAILED_ARTIFACTS_PRESERVED
DIAGNOSTIC_3_FADE_SAMPLING_METHOD_GAP_CONFIRMED
FORMAL_NOT_RUN
CODE_EVIDENCE_HEAD_CHAIN_NEEDS_GOVERNANCE_CLOSURE
NEXT_DIAGNOSTIC_REQUIRES_NEW_CODE_EVIDENCE_HEAD
CLI_CAPABILITY_CONTRACT_14_TO_17_STALE_UNRESOLVED
PUSH_NOT_AUTHORIZED
REMOTE_COMMIT_PRESENT
GITHUB_ACTIONS_NOT_STARTED_DUE_TO_BILLING
NO_REMOTE_CI_TEST_RESULT
REMOTE_CI_NOT_REQUIRED_FOR_CURRENT_STAGE
DEVELOPMENT_DEPLOYMENT_COMPLETED
STAGE_4_FOUNDATION_STABILITY_VERIFIED
NOT_PUSHED_AFTER_STAGE_4
STAGE_5_AUTHORIZED
STAGE_5_MINIMUM_AUTHORING_LOOP_VERIFIED
HUMAN_ACCEPTANCE_PASSED_BY_OWNER
MANAGER_REVIEW_APPROVED
STAGE_5_EDITOR_ARCHITECTURE_EXPANSION_AUTHORIZED
REFERENCE_STUDIO_AUDIT_IN_PROGRESS
EDITOR_PRODUCT_DIRECTION_SURPASS_NOT_CLONE
SURDET_ADVANTAGES_MUST_BE_PRESERVED_AND_STRENGTHENED
REFERENCE_FEATURE_PARITY_NOT_A_SUCCESS_CRITERION
EDITOR_NORTH_STAR_APPROVED_BY_OWNER
AUTHORING_RUNTIME_CAUSALITY_LOOP_IS_PRIMARY
BIDIRECTIONAL_CAUSAL_AUTHORING_WORKBENCH_APPROVED
DETAILED_EDITOR_LAYOUT_DESIGN_IN_PROGRESS
VISUAL_COMPANION_READABILITY_CORRECTION_REQUIRED
AI_NATIVE_AUTONOMOUS_GALGAME_PRODUCTION_IS_CORE_MISSION
HUMAN_AND_AI_SHARE_TYPED_AUTHORING_CAPABILITIES
EXTENSION_CAPABILITY_BEFORE_EXTENSION_MARKET
REVISED_AI_NATIVE_WORKBENCH_DESIGN_REQUIRED
AI_PLAYABLE_CHAPTER_VERTICAL_SLICE_APPROVED_BY_OWNER
EXTERNAL_DESKTOP_AGENT_IS_AUTOMATION_EXECUTOR
EMBEDDED_AI_IS_NOT_SURDET_PRODUCT_DIRECTION
AGENT_FRIENDLY_ENGINE_IS_CORE_ADVANTAGE
AGENT_CAPABILITY_CONTRACT_DESIGN_REQUIRED
INTERNAL_AI_SESSION_CONCEPT_SUPERSEDED
EXTERNAL_AGENT_CAPABILITY_CONTRACT_APPROVED_BY_OWNER
STRUCTURED_CLI_JSON_IS_FIRST_AGENT_ENTRY
FUTURE_AGENT_PROTOCOLS_ARE_THIN_ADAPTERS
SHARED_AUTHORING_KERNEL_DESIGN_IN_PROGRESS
EXTERNAL_AGENT_SYSTEM_BOUNDARIES_APPROVED_BY_OWNER
EXISTING_AGENT_FRIENDLY_FOUNDATIONS_CONFIRMED
MINIMUM_AGENT_CAPABILITY_CATALOG_APPROVED_BY_OWNER
TEXT_ONLY_DESIGN_CONTINUATION_REQUESTED
VISUAL_COMPANION_STOPPED_BY_OWNER_REQUEST
OBJECT_IDENTITY_TRANSACTION_EVIDENCE_DESIGN_NEXT
SEMANTIC_AND_REVISION_SCOPED_OBJECT_IDENTITY_APPROVED
NO_PERSISTENT_UUID_POLLUTION
NO_FUZZY_AGENT_PATCHING
ISOLATED_CHANGE_TRANSACTION_DESIGN_NEXT
NATIVE_ISOLATED_CHANGE_TRANSACTION_APPROVED
AGENT_WRITES_DO_NOT_TOUCH_PROJECT_BEFORE_COMMIT
CONTENT_HASH_CONFLICT_REJECTION_REQUIRED
SURDET_CHANGE_COMMIT_IS_NOT_GIT_COMMIT
STRUCTURED_DIFF_AND_RUNTIME_EVIDENCE_DESIGN_NEXT
UNIFIED_STRUCTURED_CAUSAL_EVIDENCE_APPROVED
STATIC_SIMULATED_PRESENTATION_AND_HUMAN_EVIDENCE_SEPARATED
FAILED_EVIDENCE_MUST_BE_PRESERVED
BIDIRECTIONAL_TRACE_QUERY_REQUIRED
SHARED_AUTHORING_KERNEL_COMPONENT_DESIGN_NEXT
SINGLE_SHARED_AUTHORING_KERNEL_APPROVED
CORE_REMAINS_RUNTIME_PURE
CLI_AND_EDITOR_USE_SHARED_AUTHORING_TRUTH
NO_PREMATURE_PROTOCOL_PACKAGE_SPLIT
FIRST_IMPLEMENTATION_VERTICAL_SLICE_DESIGN_NEXT
STAGE_6_WAVE_1_SCOPE_APPROVED_BY_OWNER
AGENT_READY_AUTHORING_VERTICAL_SLICE_APPROVED
ISOLATED_STARTER_FIXTURE_REQUIRED
MINIMUM_CAUSAL_EDITOR_BRIDGE_REQUIRED
STAGE_6_WAVE_1_COMPLETE_DESIGN_APPROVED_BY_OWNER
ERROR_TEST_AND_HUMAN_ACCEPTANCE_MODEL_APPROVED
STAGE_6_WAVE_1_DESIGN_SPEC_COMMITTED
OWNER_SPEC_FILE_REVIEW_PASSED
WRITING_PLANS_AUTHORIZED
NOT_PUSHED_AFTER_DESIGN_SPEC
STAGE_6_WAVE_1_IMPLEMENTATION_PLAN_COMMITTED
NOT_PUSHED_AFTER_IMPLEMENTATION_PLAN
STAGE_6_WAVE_1_TASKS_1_TO_7_COMMITTED_LOCALLY
TASK_8_FIRST_AGGREGATE_FAILED_AT_PROJECT_VALIDATE_RED
TASK_8_SECOND_AGGREGATE_FAILED_AT_RUNTIME_RUN_FROM_A
CONDITIONALLY_APPROVED_SECOND_FAILURE_CLOSURE
AUTHORING_CHOICE_EFFECT_SERIALIZATION_BUG_CONFIRMED
AUTHORING_CHOICE_EFFECT_FIX_VERIFIED
CONDITIONALLY_APPROVED_THIRD_FAILURE_CLOSURE
NODE_PROJECT_STORAGE_MISSING_PARENT_BUG_CONFIRMED
APPROVED_NODE_PROJECT_STORAGE_FIX
NODE_PROJECT_STORAGE_FIX_VERIFIED_IN_AGGREGATE_COMMIT
CONDITIONALLY_APPROVED_FOURTH_FAILURE_CLOSURE
EDITOR_PREVIEW_BLOCKED_BY_STALE_STAGE_5_SERVER
CONDITIONALLY_APPROVED_FIFTH_FAILURE_CLOSURE
FORMAL_EDITOR_PREVIEW_LOADABLE_IN_ISOLATED_DIAGNOSTIC
HARNESS_IFRAME_WAIT_RACE_CONFIRMED
HARNESS_FAILURE_CLEANUP_LEAK_CONFIRMED
CONDITIONALLY_APPROVED_SIXTH_FAILURE_CLOSURE
HARNESS_IFRAME_WAIT_FIX_VERIFIED
HARNESS_FAILURE_CLEANUP_FIX_VERIFIED
HARNESS_VITE_CWD_BUG_CONFIRMED
FORMAL_EDITOR_PREVIEW_NOT_REACHED
STAGE_6_WAVE_1_NOT_VERIFIED
OWNER_FEEDBACK_SERIAL_FORMAL_RETRY_LOOP_TOO_COSTLY
NO_MORE_ONE_FIX_ONE_FORMAL_RUN
HARNESS_DIAGNOSTIC_STABILIZATION_RECOMMENDED
FORMAL_SINGLE_RUN_RESERVED_FOR_FINAL_EVIDENCE
WAITING_FOR_OWNER_BOUNDED_HARNESS_STABILIZATION_AUTHORIZATION
PROCESS_FAILURE_ACKNOWLEDGED_BY_MANAGER
PREFLIGHT_BEFORE_FORMAL_EVIDENCE_REQUIRED
SHARED_FORMAL_LAUNCHER_SELF_CHECK_REQUIRED
METHOD_SELECTION_REVIEW_REQUIRED
QUALITY_IS_HIGHEST_PRIORITY
TOKEN_EFFICIENCY_IS_SECOND_PRIORITY_WHEN_QUALITY_UNCHANGED
NO_COST_WITHOUT_INCREMENTAL_EVIDENCE
CONDITIONALLY_APPROVED_STAGE_6_WAVE_1_FORMAL_DELIVERY
FORMAL_AGENT_READY_A_B_PRESENTATION_VERIFIED
STARTER_SAVE_BRIDGE_DECLARATION_STALE_CONFIRMED
TASK_9_VERIFY_ALL_NOT_GREEN
HUMAN_ACCEPTANCE_ENTRY_MUST_USE_EDITOR_ROOT
HUMAN_ACCEPTANCE_DEFERRED_FOR_MINIMAL_CLOSURE
WAITING_FOR_OWNER_STARTER_TYPE_AND_DOC_CLOSURE_AUTHORIZATION
STARTER_SAVE_BRIDGE_DECLARATION_ALIGNMENT_APPROVED
STAGE_6_SHARED_SIMULATION_GROWTH_REGRESSION_CONFIRMED
SHARED_AUTHORING_GROWTH_RUNTIME_FIX_REQUIRED
VERIFY_REMAINDER_PREFLIGHT_REQUIRED
HUMAN_ACCEPTANCE_DEFERRED_FOR_STAGE_6_REGRESSION_FIX
WAITING_FOR_OWNER_SHARED_GROWTH_SIMULATION_FIX_AUTHORIZATION
SHARED_GROWTH_SIMULATION_FIX_APPROVED
VERIFY_ALL_EXIT_ZERO_CONFIRMED
SHARED_SIMULATION_ZERO_PATH_EVIDENCE_BUG_CONFIRMED
AGENT_SIMULATION_EVIDENCE_NOT_YET_TRUSTWORTHY
HUMAN_ACCEPTANCE_DEFERRED_FOR_PATH_EVIDENCE_FIX
WAITING_FOR_OWNER_SHARED_PATH_EVIDENCE_FIX_AUTHORIZATION
STAGE_6_SHARED_SIMULATION_PATH_EVIDENCE_RESTORED
STARTER_SIMULATION_PATH_COUNT_TRUSTWORTHY
TASK_9_VERIFY_ALL_PASSED
FORMAL_AGGREGATE_REMAINS_VALID
STAGE_6_WAVE_1_ENGINEERING_EVIDENCE_APPROVED
MANAGER_REVIEW_APPROVED
HUMAN_ACCEPTANCE_AUTHORIZED
HUMAN_ACCEPTANCE_PENDING_OWNER
STAGE_6_WAVE_1_PARTIAL_HUMAN_ACCEPTANCE_PASSED
CAUSAL_OBJECT_RELATIONS_MISSING
CAUSAL_TRACE_REVERSE_SELECTION_BROKEN
STAGE_6_WAVE_1_HUMAN_ACCEPTANCE_BLOCKED
WAITING_FOR_OWNER_CAUSAL_BRIDGE_FIX_AUTHORIZATION
STAGE_6_CAUSAL_BRIDGE_FIX_IMPLEMENTED
FOCUSED_TESTS_TYPECHECK_BUILDS_PASSED
HUMAN_CAUSAL_BRIDGE_RETEST_PENDING
STAGE_6_WAVE_1_HUMAN_ACCEPTANCE_PASSED_BY_OWNER
CAUSAL_BRIDGE_HUMAN_RETEST_PASSED
STAGE_6_WAVE_1_READY_FOR_FINAL_MANAGER_CLOSURE
TEMPORARY_DEEPSEEK_MANAGER_AND_EXECUTOR_HANDOFF_PREPARED
TEMPORARY_HANDOFF_MAX_SIX_DAYS
CODEX_RETURN_REQUIRED_NO_LATER_THAN_2026_08_20
STAGE_6_WAVE_2_NOT_AUTHORIZED
PUSH_COMPLETED_FOR_VERIFIED_BASELINE
REMOTE_MAIN_AT_3DA1147
LOCAL_REMOTE_SYNCED
DELIVERY_REPORT_NOT_CREATED
TASK_8_STEP_8_NOT_STARTED
TASK_9_NOT_STARTED
HUMAN_ACCEPTANCE_NOT_STARTED
NOT_PUSHED_AFTER_STAGE_6_WORK
AI_VERTICAL_SLICE_IMPLEMENTATION_BLOCKED_BY_UNSTABLE_TASK8_HARNESS
EDITOR_CAUSAL_BRIDGE_IMPLEMENTED_LOCALLY_NOT_FORMALLY_AGGREGATE_VERIFIED
NOT_PUSHED_AFTER_STAGE_5
STAGE_6_WAVE_2_NOT_STARTED
```

历史说明：上方旧段落曾在 Wave 2 DIAGNOSTIC 阶段作为当前摘要使用，其内容已由 4.82～4.98 和 6.1 完整 supersede。当前执行者必须读取 6.1，不得把旧 `3da1147`、Wave 2 FORMAL 未运行或 Wave 3 未授权等历史词汇恢复为现状。本台账本身仍只记录路线与裁决，不自动授权任何执行 AI 开始新主题。

## 七、复审时使用的简短结论模板

> **2026-09-07 适用说明：** 下方问题仍可帮助区分事实与授权，但不是要求每次输出七项长报告。按第 9.6 节提供足够支持结论的简短说明即可；Owner 已明确暂缓的验证不应重新变成其待办，近期通过结论也不因缺少历史格式的报告而重开。

以后任何 AI 交付报告都必须先回答：

```text
1. 这轮属于本台账的哪个阶段？
2. 它解决的是哪个真实症状或明确契约？
3. 哪些公共层文件被修改，哪些游戏层文件没有修改？
4. 自动化证明了什么，尚未证明什么？
5. 项目所有者还需要亲自验证什么？
6. 是否 push、部署、发行或进入下一阶段？
7. 下一步是否需要新的明确授权？
```

如果报告无法回答以上问题，就只能标记为调查或诊断，不能标记为完成。

## 2026-08-14 Stage 6 Wave 2 人工验收与 push 门禁复核

项目所有者已确认 Stage 6 Wave 2 的真实人工验收通过。只读复核发现，人工验收之后又新增了本地提交 `8b9d11c8d46fbbca25ecc13ea9d0dce00776ca26`（`fix(editor): jump timeline cue from causal trace`），只涉及 editor 因果轨迹跳转及其回归测试；当前分支为 `main`，HEAD=`8b9d11c8d46fbbca25ecc13ea9d0dce00776ca26`，本地追踪的 `surdet/main`=`3da114754c37e83e624649e2391c7f03acc12e0f`，ahead/behind=`13/0`，tracked 工作树干净。

当前 Wave 2 任务书与交付报告仍以文档闭合 HEAD `3a4d8ca`、自动化代码证据 HEAD `dcf2905` 为权威，并保留 `HUMAN_ACCEPTANCE_NOT_STARTED`；尚未记录 `8b9d11c` 的 post-FORMAL editor 修正与项目所有者人工通过。因此暂不 push，先要求执行 AI 做一次最小文档闭合：保留 FORMAL artifact 的 `runHead=dcf2905` 身份，另行记录 `8b9d11c` 为 post-FORMAL editor 修正及人工验收基线，精确提交任务书与交付报告（必要时补充该修正的聚焦验证），再进行独立复审。该文档收口未完成前，不得把当前 13 笔本地提交直接推送到远端。

本轮只读尝试 `git ls-remote surdet refs/heads/main` 时因本机 TLS 握手失败，尚未取得实时远端确认；实际 push 前仍须先完成文档收口，并重新 fetch/核对远端关系。没有执行 push、force push、部署、重跑 FORMAL 或修改生产逻辑。

## 2026-08-14 Stage 6 Wave 2 文档闭合完成与 push 复核

执行 AI 已完成上一笔复核要求的两处纯文档修正，并创建普通本地提交 `4169b75ddaeccd0c8e0aa556b5bc5e8f882fc1b6`（`docs(authoring): finalize wave 2 acceptance wording`），提交范围仅为 Wave 2 任务书与交付报告。任务书/报告现已明确区分：FORMAL 自动化证据基线为 `dcf2905`，FORMAL 后 editor 修正与项目所有者人工通过基线为 `8b9d11c`，当前状态为 `STAGE_6_WAVE_2_HUMAN_ACCEPTANCE_PASSED_BY_OWNER`、`NOT_PUSHED_AFTER_STAGE_6_WAVE_2`、`STAGE_6_WAVE_3_NOT_STARTED`。

独立复核结果：当前 HEAD=`4169b75ddaeccd0c8e0aa556b5bc5e8f882fc1b6`，本地追踪 `surdet/main`=`3da114754c37e83e624649e2391c7f03acc12e0f`，ahead/behind=`15/0`；tracked 工作树与暂存区干净，最新提交仅含两份文档，`git diff --check` 与 `git diff --cached --check` 通过，tracked `*.log` 无输出。实时 `git ls-remote surdet refs/heads/main` 成功并返回 `3da114754c37e83e624649e2391c7f03acc12e0f`，与本地追踪指针一致。

复核结论：**批准项目所有者 push 当前 `main` 到 `surdet/main`**。本次未执行 push；不得 force push、部署、打包、发行或启动 Wave 3。推送后应只读回读远端 HEAD 与本地 HEAD 是否一致，再决定下一主题。

## 八、2026-08-24 起的路线与交付追加（历史记录）

> **2026-09-07 标注：** 原章名为“八、2026-08-24 Pre-Wave 5 当前权威路线追加”。下方逐次决定及状态原文保留，各节按自己的时间和主题解释；最新状态由第 9.8 节汇总。第 8.18 的强制 Luna 满载已被第 8.20 撤销，不能只截取较早一条执行。

> 本节是 2026-08-24 的当前权威状态。凡与本节冲突的旧 HEAD、ahead/behind、`NOT_PUSHED`、Wave 未授权或停止状态，仅视为历史快照；旧记录继续保留用于追溯，不得据此覆盖本节事实。

### 8.1 Evidence Trustworthiness Wave 3 已闭合并进入远端基线

项目所有者已批准并完成 Pre-Wave 5 Evidence Trustworthiness Wave 3 的普通 push。该轮闭合后的远端基线为：

```text
branch = main
WAVE_3_REMOTE_BASELINE = 00255f64916d412f20b57ba0954eea8c7b63b26e
PRE_WAVE_5_EVIDENCE_TRUSTWORTHINESS_WAVE_3_VERIFIED
WAVE_3_PUSH_COMPLETED
```

本项只确认 Wave 3 已完成、已推送并成为后续工作的回退锚点；不把它扩写为 Wave 4 已开始或 Wave 5 已授权。

### 8.2 项目所有者选择方案 3A：桌面本地多 Agent 事务管理器

项目所有者在 Pre-Wave 5 下一主题的多方案讨论中选择方案 3，并进一步批准 3A。当前产品方向是：让多个外部桌面 Agent 能在同一台电脑上，通过 Surdet 的共享 authoring 合同安全地并行观察、暂存、审查、恢复和提交创作变更；不在引擎内部内嵌 AI，也不把 MCP 适配层变成第二套业务真相。

本轮已确认的核心边界：

- 只解决同机、本地文件系统、多个 Node/MCP/CLI 进程的协作；
- Change Store V2 使用 append-only record snapshot，并以 `recordVersion` 做 CAS；
- 使用 change lease 与 project lease，固定获取顺序为 change → project；
- 恢复必须通过显式 `change.recovery.inspect` / `change.recovery.execute` 完成；
- 不自动恢复，不引入分布式锁、网络锁、CRDT/OT，不修改存档格式；
- 不以“未来可能需要”为理由制造大型抽象层；
- 实施开始前必须由两个真实独立进程复现匹配症状的 RED。若无法得到真实 RED，必须停止复审方法，不得靠单进程 mock、延时放大或猜测性生产修改伪造问题。

### 8.3 Wave 4 设计规格与总任务书已完成，本地等待执行

已创建并提交：

1. 设计规格：
   `docs/superpowers/specs/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4-design.md`
   - 设计提交：`1c4002f`（`docs(authoring): design local multi-agent transactions`）
   - 格式规范化提交：`6c6f812`（`docs(authoring): normalize transaction design formatting`）
   - 当前磁盘身份：31,368 bytes；SHA-256 `F81003510C836C3F14B5FBAAB016B1071A498EB142A7F57560FFE25E7047EB7C`
2. 总任务书：
   `docs/superpowers/plans/2026-08-24-pre-wave-5-agent-transaction-recovery-wave-4.md`
   - 任务书提交：`526a0fc`（`docs(authoring): plan local multi-agent transactions`）
   - 当前磁盘身份：63,775 bytes；SHA-256 `4CC99638CF8EB6310AC84D8EE3A835F50614C686CD0579C6A3239A91282B8691`

任务书覆盖 Task 0～Task 11，并把实现、真实双进程 RED、恢复语义、CLI/MCP 薄适配、聚焦验证、单次聚合门禁、人工验收与文档闭合分别设置了停止条件。新执行 AI 可以读取简短项目介绍，但必须以 `AGENTS.md`、本节、设计规格、总任务书和现场 Git 状态为准，不得凭聊天摘要自行扩大范围。

截至本次台账追加前的真实 Git 基线：

```text
branch = main
HEAD = 526a0fcb68870ec8dc881a7d5a9d133a9615d3ae
HEAD_PARENT = 6c6f812aa757b0074ebf51a05306aa5b4e6bf063
surdet/main = 00255f64916d412f20b57ba0954eea8c7b63b26e
HEAD...surdet/main = 3 0
tracked worktree = clean
staging area = empty
production code changes = none
push after Wave 4 design/taskbook = not performed
Wave 4 implementation = not started
Wave 5 = not started
```

本台账文件继续由总经理维护。本次只追加已确认的路线、证据身份和停止点；不将台账暂存或提交，不替执行 AI 宣称施工已开始。下一权威动作是：项目所有者把 Wave 4 总任务书交给新的执行 AI，由其从 Task 0 读取真实基线开始；到任务书规定的停止门后再进行独立复审。

```text
PRE_WAVE_5_WAVE_3_CLOSED_AND_PUSHED
PRE_WAVE_5_WAVE_4_DIRECTION_3A_APPROVED
WAVE_4_DESIGN_SPEC_COMPLETED
WAVE_4_MASTER_TASKBOOK_COMPLETED
WAVE_4_IMPLEMENTATION_NOT_STARTED
WAVE_4_DESIGN_AND_TASKBOOK_NOT_PUSHED
WAVE_5_NOT_STARTED
WAITING_FOR_EXECUTION_AI_TASK_0
```

### 8.4 Agent Transaction Recovery Wave 4 已完成本地自动化闭环

项目所有者改为由总经理直接接管本轮施工与收口。Task 1 的真实双进程 RED 已证明旧实现存在“两个 child 都返回成功、最终 working change 丢失一个成功结果”的 last-write-wins 问题。当前实现已加入 Change Store V2/CAS、change/project 本地 lease、project commit 串行化、四态显式恢复，以及 Agent Port 的 `change.recovery.inspect` / `change.recovery.execute` 公开合同。

最终自动化事实：

```text
CODE_EVIDENCE_HEAD = 6c3a10230968d6abd8b0da7ca30308b7c95f6c4d
DOCUMENT_CLOSURE_HEAD = 7e0e72589f85ba8afe7cd2aab54f52efbdc53a54
POST_CLOSURE_FORMAT_HEAD = 31b937638929fa8d09e575b120fd4b4681d9f7d2
surdet/main = 00255f64916d412f20b57ba0954eea8c7b63b26e
HEAD...surdet/main = 24 0
```

- Authoring 全量：23 files / 153 tests，PASS；
- CLI 全量：27 files / 205 tests，PASS；
- 唯一 Task 10 `verify:all`：exit 0，抵达 `verify:diff-check`；
- 唯一 FORMAL：`PASSED`，`artifact.runHead === CODE_EVIDENCE_HEAD`；
- 同 change 两项跨进程 mutation 均保留，recordVersion 序列为 0→1→2；
- 不同 change 的 commit 请求窗口重叠，winner=`COMMITTED`，loser 首次 `PROJECT_BUSY`，按 `session.describe` 刷新后最终 `PROJECT_CHANGED_SINCE_BEGIN` / `STALE`；
- live/orphan/foreign-host/corrupt lease 边界全部通过；
- STAGING、REPLACING、COMMITTED journal 与 unexpected bytes 四态恢复通过；
- FORMAL 错误通道为空，14/14 子进程退出，timer/lock 清理完成，活动 lease 为 0，原始 Starter 未变化。

FORMAL artifact：

```text
evidence = C:\Users\Equinox\AppData\Local\Temp\surdet-agent-transaction-wave4-bEOuOl\formal\evidence.json
bytes = 101963
sha256 = 29503F3C718633840ED40CB2DF987F2C19C0D92BB9551F62B4746A847EFDB2D3
identity bytes = 218
identity sha256 = 7B4E4ADDB6BC7A8D7A9DF584CC34360D81645AB7CA920CD2781CA4B21E07BCC1
status = PASSED
evidenceClass = FORMAL
runHead = 6c3a10230968d6abd8b0da7ca30308b7c95f6c4d
```

最终任务书为 100,565 bytes、SHA-256 `414BFE1881F7F319650C75477635DF8B6A6C6505C00EFE995BBF9C5B901EECC6`；交付报告为 9,269 bytes、SHA-256 `07664646DF2E7FC1101846580794C84D6AE597FD6FCB684C92218A16F6D60A6F`。

本轮没有 push、部署、发行或进入 Wave 5。长期台账仍按治理约定保持未跟踪、未暂存、未提交；此处只记录项目所有者要求的当前权威事实。下一停止点为独立经理复审与项目所有者 push 决策。

```text
PRE_WAVE_5_AGENT_TRANSACTION_RECOVERY_WAVE_4_VERIFIED
READY_FOR_INDEPENDENT_MANAGER_REVIEW
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
WAVE_5_NOT_STARTED
```

### 8.5 Agent Transaction Recovery Wave 4 已推送成为远端基线

项目所有者明确授权普通 push。推送前通过实时 `ls-remote` 与 fetch 确认远端 `main` 仍为 `00255f64916d412f20b57ba0954eea8c7b63b26e`，该远端提交是本地 HEAD 的祖先，tracked 工作树干净、暂存区为空。本轮未执行 rebase、amend、squash、force push 或历史改写。

Git 全局代理仍指向已失效的 `127.0.0.1:10090`；本次仅对 fetch/ls-remote/push 命令临时使用当前监听的 `127.0.0.1:7890`，没有修改用户的永久 Git 配置。

普通 push 成功后已立即重新读取远端：

```text
branch = main
HEAD = 31b937638929fa8d09e575b120fd4b4681d9f7d2
REMOTE_LIVE = 31b937638929fa8d09e575b120fd4b4681d9f7d2
surdet/main = 31b937638929fa8d09e575b120fd4b4681d9f7d2
HEAD...surdet/main = 0 0
PUSH = COMPLETED
```

Wave 4 当前远端权威状态为 `PRE_WAVE_5_AGENT_TRANSACTION_RECOVERY_WAVE_4_VERIFIED_AND_PUSHED`。本次 push 不自动授权 Wave 5；下一步应先由总经理确定 Wave 5 的产品方向与最小纵向切片，再制作新设计规格和任务书。长期台账继续保持未跟踪、未暂存、未提交。

```text
PRE_WAVE_5_AGENT_TRANSACTION_RECOVERY_WAVE_4_VERIFIED_AND_PUSHED
REMOTE_BASELINE_ESTABLISHED
WAVE_5_NOT_STARTED
WAITING_FOR_WAVE_5_DIRECTION_DECISION
```

### 8.6 Agent Candidate Comparison / Safe Composition Wave 5 完成真实闭环

项目所有者批准的 B2 路线已经完成本轮最小纵向切片：外部 Agent 可以读取多个不可变候选 capsule，比较依赖闭包和对象结果，显式选择候选与冲突解决方案，生成可审查 integration plan，并在新的 integration change 中安全重放；Surdet 不内嵌模型，MCP 继续只是共享 authoring 合同的薄适配。

本轮独立复审曾发现 FORMAL 假阳性：A、D 对同一场景产生相同结果，C 产生不同结果时，旧比较算法没有形成 A/D 子组，导致 D 的场景 provenance 丢失。该问题已在共享层修复并补入永久合同；替换 FORMAL 证明 A/D 变量和场景两个 identical subgroup 均保留双来源 provenance、各只重放一次，C 被排除，B 的 timeline 依赖被纳入。

当前关键自动化身份：

```text
FORMAL_CODE_EVIDENCE_HEAD = 400f78d5201a6da3bd04e729588ec2e4860eed6d
FORMAL = PASSED
FORMAL_ARTIFACT_BYTES = 7400
FORMAL_ARTIFACT_SHA256 = 5713E5B8ECC5AD31232537EF73D3937CA8BC0C4B7B5E1DFF14F496F553426E5B
FORMAL_RUN_HEAD = 400f78d5201a6da3bd04e729588ec2e4860eed6d
ACCEPTANCE_PREP_CODE_HEAD = aa6b2ca926c218df620c220c7bd8d585f37f82ee
ACCEPTANCE_PREP = PREPARED
```

真实外部 Agent 在桌面隔离项目上完成 stage 验收：A/D 相同变量与相同场景的 provenance 均保留，C 被排除，B 的既有资源 timeline 被隐式纳入，fresh validation/simulation/Alpha/Beta traces 全部通过，delivery capsule 已创建，真实项目没有被修改。随后项目所有者明确授权 isolated apply/resume；integration change `chg_0002_2e446b47-b382-434e-a70f-2a21bc4a067f` 从 `READY / OPEN` 以相同 plan 身份提交到桌面 fixture，最终为 `COMMITTED`，只改变两个场景、一个 timeline 和 `game.config.json`，原始 Starter 保持不变。

项目所有者的原始人工反馈为：

> Owner 人工验收通过：Alpha A 可见，C 不存在，Beta timeline 可见，打开、预览、保存正常。

人工保存后再次逐文件回读：桌面 fixture 与 apply 后证据仍是 40 文件、零差异；原始 Starter 仍是 37 文件、零差异。该人工通过只覆盖可见内容和编辑器打开/预览/保存，不代表本 Wave 实现了候选比较产品 UI。

仍须保留的证据边界：最终 A/D provenance 修复后没有再次运行 `verify:all`，累计预算保持 `4/4`；package 测试、replacement FORMAL、真实外部 Agent、isolated apply 和 Owner 人工路径不能被改写成一份新鲜全仓库门禁。外部 Agent 报告中的工具调用总数文字与枚举相差 1，属于非阻断报告计数问题，不影响磁盘 capsule、change record 和 fresh evidence。`game.config.json` 的语义变量新增伴随行尾规范化，capsule 已明确标记 `unexpectedFormatChange=true`，不得在后续报告中隐去。

当前 Git 与停止点：

```text
branch = main
HEAD = f8943c293c4537b3867cc8eeea316b19bb4a0b40
surdet/main = 31b937638929fa8d09e575b120fd4b4681d9f7d2
HEAD...surdet/main = 23 0
production/test/runner tracked diff = none
staging area = empty
Wave 5 documentation closure = f8943c293c4537b3867cc8eeea316b19bb4a0b40
push = not performed
Wave 6 = not started
```

```text
STAGE_6_WAVE_5_CANDIDATE_COMPOSITION_VERIFIED
FORMAL_PASSED
EXTERNAL_AGENT_ACCEPTANCE_PASSED
ISOLATED_APPLY_PASSED
OWNER_ACCEPTANCE_PASSED
WAITING_FOR_INDEPENDENT_MANAGER_REVIEW
NOT_PUSHED
WAVE_6_NOT_STARTED
```

### 8.7 Wave 5 远端闭合；Wave 6 人类审阅台方向与规格完成

项目所有者已授权普通 push。推送完成后现场回读确认：

```text
branch = main
HEAD = f8943c293c4537b3867cc8eeea316b19bb4a0b40
surdet/main = f8943c293c4537b3867cc8eeea316b19bb4a0b40
HEAD...surdet/main = 0 0
tracked worktree = clean
staging area = empty
push = completed
```

因此 Wave 5 的 replacement FORMAL、真实外部 Agent stage、isolated apply/resume、Owner 人工验收与独立终审结论已经进入远端历史。仍然保留一个诚实边界：最终 A/D provenance 修复后没有再次运行 `verify:all`，累计预算为 `4/4`；这不否定已通过的定向合同、FORMAL 和真实路径，但后续不得把它改写成“最终修复后新鲜全仓库门禁通过”。

项目所有者随后批准 Wave 6 方向，并完成以下三项产品裁决：

1. **A：人类友好的 Agent 候选审阅与因果交接台。** Wave 6 不在引擎内嵌模型，而是把 Wave 5 的机器候选比较与安全合成能力变成人类可理解、可裁决、可预览的审阅闭环；
2. **A1：以审阅任务为主。** Editor 默认围绕“目标—候选—冲突—结果—证据—下一步”组织，对象比较与因果关系作为下钻，不复制目标开源引擎的界面或工作流；
3. **P1：冲突逐项裁决，最终计划整体批准。** 安全相同组默认可见并纳入，selection-required 冲突逐项由用户决定；实际 stage 结果预览后，用户只对完整计划做一次最终批准或退回。

已创建并完成自审的设计规格：

```text
path = docs/superpowers/specs/2026-08-26-human-agent-review-workbench-stage-6-wave-6-design.md
DESIGN_HEAD = 017f7201926a17adbe9a876c3e1500f209c1e9e5
DESIGN_PARENT = f8943c293c4537b3867cc8eeea316b19bb4a0b40
commit = docs(authoring): design wave 6 review workbench
commit scope = only the Wave 6 design specification
verify:docs = pass
push = not performed
```

规格固定的公共边界是：`@surdet/authoring` 继续拥有 comparison、plan、review projection、receipt validation 与 working-object fingerprint 的共享真相；CLI/Agent Port 只做 Node/MCP 薄适配；Editor 提供中文优先的人类审阅、因果下钻、实际 stage 预览与决定/批准回执。Agent Port 不提供写入人类回执的能力，旧的直接 plan 输入不能满足 owner-reviewed integration apply gate。

Wave 5 终审中暴露但未构成 Wave 5 阻断的 working fingerprint 一般性边界，已明确成为 Wave 6 实施的前置收口：scene、timeline、variable、character、`config:characters` 与 `config:entryScene` 必须使用一个共享 resolver 做 dry-run 与 READY 回读；未知已声明产物必须 fail-loud，不能静默跳过。

当前真实 Git 状态：

```text
branch = main
HEAD = 017f7201926a17adbe9a876c3e1500f209c1e9e5
HEAD_PARENT = f8943c293c4537b3867cc8eeea316b19bb4a0b40
surdet/main = f8943c293c4537b3867cc8eeea316b19bb4a0b40
HEAD...surdet/main = 1 0
tracked worktree = clean
staging area = empty
Wave 6 implementation taskbook = not created
Wave 6 implementation = not authorized
Wave 6 design push = not performed
```

本台账仍由总经理维护，继续保持未跟踪、未暂存、未提交。下一权威动作只有一个：项目所有者逐文件审阅并批准 Wave 6 设计规格；批准后总经理才使用 `writing-plans` 制作详细总任务书。规格完成不自动授权施工、FORMAL、外部 Agent 验收、apply、push、部署、发行或 Wave 7。

```text
STAGE_6_WAVE_5_CLOSED_AND_PUSHED
STAGE_6_WAVE_6_DIRECTION_A_SELECTED
REVIEW_TASK_WORKBENCH_A1_SELECTED
CONFLICT_LEVEL_DECISION_AND_PLAN_LEVEL_APPROVAL_P1_SELECTED
WAVE_6_DESIGN_SPEC_COMPLETED
WAITING_FOR_OWNER_FILE_LEVEL_REVIEW
WAVE_6_IMPLEMENTATION_TASKBOOK_NOT_CREATED
WAVE_6_IMPLEMENTATION_NOT_AUTHORIZED
NOT_PUSHED_AFTER_WAVE_6_DESIGN
```

### 8.8 Wave 6 规格获批；详细总任务书完成

项目所有者已经明确批准 `Stage 6 Wave 6：人类审阅与因果交接台` 设计规格，并授权总经理制作非常详细的实施总任务书。该授权只覆盖任务书设计与本地文档提交，不自动授权生产施工、FORMAL、真实外部 Agent、isolated apply、push、部署、发行或 Wave 7。

总任务书已按 `writing-plans` 方法完成，并在写入前逐项映射当前源码的 authoring、CLI/Agent Port、Editor、Change Store 与测试入口。它固定了：

1. A / A1 / P1 的两阶段人类门：冲突逐项裁决，真实 stage 结果整体批准；
2. 一个共享 working-object fingerprint resolver，覆盖 scene、timeline、variable、character、`config:characters` 与 `config:entryScene`；
3. 不可变 comparison/result review workspace、决定/批准回执、create-only 身份、相对路径和 stale 规则；
4. Editor 中文优先审阅台、技术详情折叠、现有对象/因果下钻、实际 stage fixture 预览、居中画面与独立滚动；
5. Agent Port 只读消费人类回执，不能创建、覆盖或代填回执；MCP 继续是共享 authoring 合同的薄投影；
6. integration commit 在任何 staging/journal 写入前校验批准，普通非 integration change 不受影响；
7. Task 0–12 串行施工、RED→GREEN、唯一 `verify:all`、最多三次 DIAGNOSTIC、冻结 HEAD 后唯一 FORMAL、真实外部 Agent 两阶段停顿、两次 Owner 人工门和另行授权的 isolated apply；
8. 质量第一、质量不下降时节省额度第二，禁止一修一 FORMAL、概率性压力和无边界重跑。

任务书磁盘与 Git 身份：

```text
path = docs/superpowers/plans/2026-08-26-human-agent-review-workbench-stage-6-wave-6.md
bytes = 102640
sha256 = D470CC2FBA114108B5F2642C247C967452947682342C4DB60E038C8DE3DFC7CE
lines = 2701
commit = b6532739c6a80adb2d9bfd3b4865e76e3c38d8d4
commit message = docs(authoring): plan wave 6 review workbench
commit scope = only the Wave 6 implementation taskbook
verify:docs = pass
placeholder scan = clean
trailing whitespace scan = clean
push = not performed
```

创建任务书后的真实 Git 状态：

```text
branch = main
HEAD = b6532739c6a80adb2d9bfd3b4865e76e3c38d8d4
HEAD_PARENT = 017f7201926a17adbe9a876c3e1500f209c1e9e5
surdet/main = f8943c293c4537b3867cc8eeea316b19bb4a0b40
HEAD...surdet/main = 2 0
tracked worktree = clean
staging area = empty
Wave 6 implementation = not started
Wave 6 implementation authorization = not granted
```

本台账继续保持未跟踪、未暂存、未提交。下一道门是项目所有者审阅并明确批准 Wave 6 总任务书；只有收到该授权后，执行 AI 才能从 Task 0 开始串行施工。

```text
STAGE_6_WAVE_6_DESIGN_APPROVED
STAGE_6_WAVE_6_MASTER_TASKBOOK_COMPLETED
WAVE_6_IMPLEMENTATION_NOT_STARTED
WAITING_FOR_OWNER_IMPLEMENTATION_AUTHORIZATION
NOT_PUSHED_AFTER_WAVE_6_TASKBOOK
```

### 8.9 Wave 6 执行 AI 施工授权

项目所有者明确决定由执行 AI 依据已完成的 Wave 6 总任务书施工。授权范围是从 Task 0 开始，按 Task 0–10 的依赖和停止规则串行推进；不是逐个 Task 再申请普通施工许可，但任何任务书明列的失败停止条件仍然立即生效。

以下门仍未授权且不能被本次开工决定隐含跨越：

- acceptance-prep；
- 真实外部 Agent 验收；
- Owner Comparison 与 Owner Result 人工验收；
- isolated apply/resume；
- push、部署、发行与 Wave 7。

执行 AI 不得创建子 Agent 或并行施工，不得让自身报告代替总经理独立终审。施工结果交回总经理时，必须包含真实 HEAD/remote/ahead-behind、提交范围、实际命令结果、artifact 身份、失败预算、工作树和下一停止点。

```text
WAVE_6_MASTER_TASKBOOK_APPROVED
WAVE_6_EXECUTION_AI_AUTHORIZED_FROM_TASK_0
TASK_0_TO_TASK_10_SERIAL_EXECUTION_AUTHORIZED
OWNER_GATED_TASK_11_NOT_AUTHORIZED
PUSH_NOT_AUTHORIZED
WAVE_7_NOT_STARTED
```

### 8.10 Stage 6 Wave 6 本地闭合；Wave 7 未启动；Editor 打磨属于 Pre-Wave-7 支线

项目所有者要求重新核对主线 Wave 顺序，并明确指出：刚完成的是整个 Surdet 项目的 **Stage 6 Wave 6**，不能把后续前端重构内部批次误报成新的主线 Wave。

主线已核对为：

1. Wave 1：Agent-ready 类型化创作纵向切片；
2. Wave 2：既有资源驱动的演出创作；
3. Wave 3：项目级创作配置；
4. Wave 4：Agent Port 与事务、并发、恢复可靠性；
5. Wave 5：候选比较与安全合成；
6. Wave 6：人类审阅与因果交接台；
7. Wave 7：尚未设计、尚未授权、尚未开始。

Wave 6 已完成本地完整闭环并通过独立终审。最终本地闭合提交为：

```text
WAVE_6_FINAL_LOCAL_HEAD = 62d8ac98e116ed78d40abdc9c6bb5f63c533b6fc
WAVE_6_FINAL_PARENT = 673dc6cb2f31f4d546c49007925d0794370c277e
COMMIT = docs(authoring): close wave 6 manager review
REMOTE_MAIN = f8943c293c4537b3867cc8eeea316b19bb4a0b40
WAVE_6_HEAD...REMOTE = ahead 19 / behind 0
PUSH = NOT_PERFORMED
WAVE_7 = NOT_STARTED
```

已确认的 Wave 6 闭环包括：共享人类审阅语义、不可变 comparison/result review workspace、决定与最终批准回执、Agent Port 薄投影、Editor 中文审阅台、真实 stage 预览、replacement FORMAL、外部 Agent comparison stage、Owner comparison acceptance、委托的 result technical acceptance、isolated apply、配置 EOL 保留修复、原始 Starter 不变和最终独立经理 PASS。默认并行 `verify:all` 的容量/timeout 根因仍是已记录的非阻断证据边界，不能改写成最终新鲜全仓库 PASS。

Wave 6 闭合后，项目所有者另行批准了 Editor 基础体验重构。该工作当前只属于：

```text
POST_WAVE_6_EDITOR_FOUNDATION_POLISH
PRE_WAVE_7
FRONTEND_PASS_IN_PROGRESS
MAINLINE_WAVE_7_NOT_DESIGNED
MAINLINE_WAVE_7_NOT_AUTHORIZED
MAINLINE_WAVE_7_NOT_STARTED
```

`docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md` 中历史使用的 `Wave 1–10` 是该前端支线的内部批次编号。为防止再次与主线混淆，自本条起统一称为 `Frontend Pass 1–10`；既有文件名和历史提交不改写。当前正在施工的是 `Frontend Pass 3A.1` 剧情路径地图纠偏，它不得被解释成主线 Wave 3 或 Wave 7。

本长期路线台账继续保持未跟踪、未暂存、未提交。当前 Editor 支线仍不授权 push、部署、发行或进入主线 Wave 7；Wave 7 方向必须由项目所有者在前端支线闭合后另行决定。

```text
STAGE_6_WAVE_6_VERIFIED_LOCALLY
WAVE_6_PUSH_NOT_PERFORMED
POST_WAVE_6_PRE_WAVE_7_EDITOR_POLISH_IN_PROGRESS
FRONTEND_WAVE_LABELS_RENAMED_TO_FRONTEND_PASS_FOR_CLARITY
WAVE_7_NOT_DESIGNED
WAVE_7_NOT_AUTHORIZED
WAVE_7_NOT_STARTED
```

Frontend Pass 3A.1 已在本地完成可扩展剧情路径地图的代码与浏览器闭环：默认聚焦路径限制同屏复杂度，全局概览只显示场景层，技术模式保留完整真实投影；同目标跳转共享主干，返回边使用紧凑标记，缺端点连接公开报告。代码证据提交为 `161f8dbe76361a731bf09a1b5dccb88b81140d47`，文档闭合提交为 `42be0fc`；Editor 45 files / 311 tests、typecheck、build 和 Chromium 27/27 通过，Starter 未变化，独立复审 PASS。该结论只代表 Pre-Wave-7 Editor 支线的本地技术闭环，Owner 最终视觉复验仍未进行，push 未执行，主线 Wave 7 仍未设计、授权或启动。

### 8.11 已验证历史完成普通 push；Frontend Pass 3B 进入文档设计

项目所有者认可 3A.1 改善并明确授权普通 push。推送前实时 GitHub `main=f8943c293c4537b3867cc8eeea316b19bb4a0b40`，确认是本地 `42be0fcd2f614f032b8a539475c039c7f4ebd66f` 的祖先；普通 push 成功后，本地 HEAD、实时远端与 `surdet/main` 均为 `42be0fcd2f614f032b8a539475c039c7f4ebd66f`，ahead/behind=`0/0`。未使用 rebase、amend、force push 或历史改写，未跟踪治理文件仍未进入远端。

项目所有者同时授权开启 `Frontend Pass 3B：Timeline Desk` 任务书。该项仍是 Post-Wave-6 / Pre-Wave-7 Editor 支线，不是主线 Wave 7。只读审计已确认时间轴页存在独立正确性问题：Ctrl/Cmd+Z 误走剧本历史、首次编辑规范化 CRLF、破坏性操作不可恢复、timeline 未进入崩溃备份、默认资源写死 Starter、编辑后 validation/index 可能陈旧、短时间轴刻度重复重叠。设计决定为先完成 Editor-only 可靠性基础，再重构全页 Timeline Desk；剧本页 Dock 继续延期，零/一/多关联仅作为未来实施前置合同记录，本轮不创建无生产调用方的投影模块。

当前状态：`FRONTEND_PASS_3B_DESIGN_AND_TASKBOOK_IN_PROGRESS` / `PRODUCTION_NOT_STARTED` / `NEXT_PUSH_NOT_AUTHORIZED` / `MAINLINE_WAVE_7_NOT_DESIGNED` / `MAINLINE_WAVE_7_NOT_AUTHORIZED` / `MAINLINE_WAVE_7_NOT_STARTED`。

3B 设计与任务书随后经过三轮独立只读复审并最终 PASS。复审实际纠正了证据冻结顺序、history/panel 循环边界、多项删除墓碑、撤销删除后磁盘待删取消、待删 ID 保留与旧 history 清理、Timeline 不支持 `ambience`、未落盘新时间轴的崩溃恢复、角色立绘 target/cue 原子提交等具体问题；同时删除了没有当前生产调用方的 scene-association 模块计划。最终无剩余 BLOCKER/HIGH/MEDIUM/LOW，仍只完成文档规划，没有开始 3B 生产施工、第二次 push、Frontend Pass 4 或主线 Wave 7。

### 8.12 Frontend Pass 4 人工视觉通过；三道独立修复门与首个新增能力目标获批

项目所有者在 2026-08-31 明确报告：Configuration Ledger 完成彩色边线退出、顶部装饰线移除、中文优先和字体/间距放大后，人工审阅通过。该人工结论绑定最新 Pass 4 代码证据 `6ab44b419cc51f2e46f04b21f0ccedf25a5f491f`；任务书闭合提交为 `e238b23a782cad7e8b342879ae60f34a2c2968d4`。本地 Editor 52 files / 378 tests、typecheck、build、`verify:docs` 与差异检查通过；用户没有在该条反馈中单独报告 800px 窄屏或日历拖拽/撤销路径，因此这些操作不被代填为 Owner 证据。

当前 Git 事实：

```text
LOCAL_HEAD = e238b23a782cad7e8b342879ae60f34a2c2968d4
REMOTE_TRACKING_MAIN = bca72247d0dc76983330367be0f38043036a0fca
AHEAD_BEHIND = 4/0
TRACKED_WORKTREE = CLEAN
STAGING_AREA = EMPTY
PUSH = NOT_AUTHORIZED
```

远端审核员对 `bca72247d0dc76983330367be0f38043036a0fca` 的审查经本地只读复核后，以下三项被项目所有者明确批准为三道**相互独立、串行执行**的修复门，不得混成一次大提交：

1. `CI_PORTABILITY_RESTORE`：修复干净 Ubuntu checkout 中 Renderer v2 文档样例的 workspace 包解析，以及 Renderer v4 测试硬编码 `E:/surdet` 的跨平台路径；不得跳过测试或降低断言。远端 CI 真正恢复仍需要未来单独的 push 授权。
2. `TIMELINE_AUTOSAVE_IDENTITY_FAIL_CLOSED`：恢复时间轴时必须同时匹配稳定 ID、文件路径和定义内部 ID；same-file/different-ID、same-ID/different-file 或内部 ID 不一致均进入显式冲突，不得覆盖旧 handle 后再保存错文件。
3. `REVIEW_TERMINAL_ATOMICITY`：comparison decision 与 integration-result 终态回执必须具备跨窗口、跨 Editor 实例和跨 Node 进程的唯一写入语义。单独改成 `terminal.json` 或只加浏览器 Web Lock 不足以约束独立 Node 进程；本门必须先完成唯一仲裁者/单写者合同设计，再做 RED→GREEN 实现，不复制第二套业务真相。

修复门的默认顺序固定为：先恢复 CI 信号，再修时间轴恢复身份，最后完成高风险审阅终态原子性。每门单独设计、测试、提交和复审；前门失败即停止，不能用后门工作掩盖。三门授权不包含 push、发布、部署、主线 Wave 7 或插件市场。

三道修复门完成 reviewed closure 后，项目所有者批准的**第一个新增产品能力目标**为：

```text
FIRST_NEW_CAPABILITY_TARGET = ASSET_CENTER
```

素材中心必须优先复用现有项目扫描、`project.assets`、Editor 素材侧栏、校验和 Authoring 单一语义真相，面向人类与 Agent 共同提供中文分类、预览、稳定 key、引用位置、缺失/重复/游离资源、完整性和包体积事实；不得先建插件市场、云同步、第二套资产索引或发布平台。该目标批准的是产品方向，不等于已批准未经规格审阅的生产实现；仍需按“调研→方案→规格→任务书→施工”推进。

#### LetsGal Studio 1.9.7 可见能力盘点与借鉴边界

项目所有者提供 `D:\Studio-1.9.7-win` 和真实项目截图，并授权只读操控。已实际查看并恢复原工作页，未安装扩展、未构建、未保存设置、未编辑项目。当前版本**可见入口**已盘点：

- 剧本：章节/片段目录、卡片/纯文本/Ren'Py/JSON 视图、导入剧本、实时预览、多语言、语音匹配；
- 资产：角色、场景、BGM、音效、语音、图片/音频/视频/字体/粒子/UI/过渡等目录，引用/游离/强制打包/排除、资源完整性、包体积与资源详情；
- 叙事图：变量管理、分支选项、章节/片段关系、调用/返回和条件连线；
- 项目个性化：基础信息、画面渲染、个性化、输入按键、游戏系统和项目扩展；
- 扩展工坊：玩法系统、界面组件、编辑器增强、工具集成和游戏流程管理分类，可见 QTE、SLG、场景交互/物品栏、文字统计、术语辞典、手机界面等扩展；
- 发布：PC 桌面端、Web 测试目标、移动端预告、版本/图标、资源摘要、构建步骤和构建历史；
- Studio 设置：账户、画面、快捷键、Tab 菜单、系统、AI、维护任务、版本更新、条款与关于；
- AI 设置：OpenAI Provider、Base URL、API Key、模型拉取以及文档导入识别提示；安装包中还可见本地 Whisper 模型。故不得把“LetsGal 完全没有 AI”写成事实。当前仅能确认未观察到 Surdet 已验证的 Agent Port、候选合成、证据审阅和安全 apply 工作流，也未验证 LetsGal 能端到端生成完整游戏。

以上是对当前安装版本可见产品面的完整盘点，不等于每个扩展、隐藏入口、网络服务和执行行为都已逐项验收。Surdet 只借鉴工作流、信息架构、字号和密度原则，不复制 LetsGal 的代码、品牌、素材、插件实现、红黑皮肤或受保护设计资产。

项目所有者同时确认长期前端原则：普通用户层尽可能使用自然中文；内部 ID、JSON key、英文枚举、错误码和文件路径只在高级信息或专业源码模式出现。Agent 通过语义 DOM、`data-*`、结构化数据、Authoring 合同和源码读取专业字段，不得为了方便 Agent 把英文技术字段平铺给普通用户。页面层级由真实任务优先级、字号、留白和不同区域权重建立，禁止用同尺寸容器机械填满画面。

```text
FRONTEND_PASS_4_OWNER_VISUAL_ACCEPTANCE = PASS
THREE_INDEPENDENT_REPAIR_GATES = AUTHORIZED
REPAIR_GATE_ORDER = CI_PORTABILITY -> TIMELINE_IDENTITY -> REVIEW_TERMINAL_ATOMICITY
FIRST_NEW_CAPABILITY = ASSET_CENTER
LETSGAL_VISIBLE_FEATURE_INVENTORY = RECORDED_WITH_BOUNDARY
PUSH_NOT_AUTHORIZED
FRONTEND_PASS_5_NOT_STARTED
MAINLINE_WAVE_7_NOT_DESIGNED
MAINLINE_WAVE_7_NOT_AUTHORIZED
MAINLINE_WAVE_7_NOT_STARTED
```

### 8.13 总经理与受控施工 Agent 的长期分工

项目所有者在 2026-08-31 明确批准：主对话 Agent 继续承担 Surdet 总经理职责；边界清晰、文件归属明确、可局部验证的施工任务，默认可以交给 `luna_worker` 子代理执行，避免项目所有者继续充当多个 AI 之间的传话筒。关键部分仍由总经理亲自施工或亲自完成最后整合。

该分工不等于把子代理报告当作独立证据，也不把“多开 Agent”本身当成进度。所有子代理共享同一工作树并属于同一代理树，因此不能替代远端审核员、干净 checkout CI、正式环境或项目所有者人工验收。长期执行边界固定如下：

1. 总经理保留规格与任务书、范围裁决、风险分级、公共契约、跨层架构、存档/恢复/并发/原子性、破坏性或远端操作、最终 diff 审阅、验证、提交、完成声明与停止点裁决；
2. `luna_worker` 只接独立且有明确所有权的局部实现、测试夹具、机械迁移、文档整理、日志归纳和聚焦验证；任务消息必须声明可修改文件、禁止范围、是否允许测试和是否允许提交；
3. 多个施工 Agent 不得编辑重叠文件，不得回滚他人修改，不得擅自扩展白名单、修改门限、删除证据、暂存、提交、push、部署或宣布整轮完成；
4. 总经理必须把子代理产出视为待审候选：重新读取实际 diff 与邻近上下文，核对范围，并亲自运行与风险匹配的最终验证；
5. 对公共接口、Agent Port/Authoring 单一语义真相、存读档、事务租约、终态回执、正式发行和高风险数据路径，默认由总经理亲自开工；只有可安全拆出的辅助测试或只读调查才交给子代理；
6. 只有出现真实可并行的新信息增益时才启用子代理，不为了“看起来并行”拆分工作。

当前 `CI_PORTABILITY_RESTORE_GATE_RECOVERY_1` 按此规则执行：过时的 review-open 静态测试锚点属于测试文件内的局部修正，可交给一个 `luna_worker`；串行容量鉴别、replacement `verify:all`、最终范围审阅、提交和门禁裁决仍由总经理亲自完成。

```text
PRIMARY_ROLE = GENERAL_MANAGER
BOUNDED_IMPLEMENTATION_DEFAULT = LUNA_WORKER_ALLOWED
CRITICAL_ARCHITECTURE_AND_FINAL_VERIFICATION = PRIMARY_AGENT_OWNED
SUBAGENT_REPORT_IS_INDEPENDENT_REVIEW = NO
OWNER_AS_AI_MESSENGER = NOT_REQUIRED
```

### 8.14 第一修复门 CI_PORTABILITY_RESTORE 本地闭合

`CI_PORTABILITY_RESTORE` 已按独立任务书完成 RED→GREEN、一次失败聚合门的如实保留、受控恢复、精确代码提交和 docs-only 复审收口。代码证据为 `d32c9cf939b17b874ff9c934d3c5cf82e7aaeb7a`，任务书收口为 `0adcc01973098f36ee33597cacaf62b94cb7cdd8`；相对 `surdet/main=bca72247d0dc76983330367be0f38043036a0fca`，本地 ahead/behind=`6/0`，tracked 工作树干净，staging 为空，未 push。

修复内容仅限 root tooling 与测试上下文：Renderer v2 文档样例通过 test-only TypeScript project 直接解析 Core/Renderer 源码，不依赖 clean checkout 中不存在的 `dist`；Renderer v4 qualification test 从 `import.meta.url` 推导仓库根，不再固定 `E:/surdet`。Frontend Pass 4 后过时的 review-open 静态测试锚点也在恢复中按原语义修正，仍严格证明 `await open → renderAll → success status`。

证据链保留首次 `verify:all` 的四个 CLI 默认并行 timeout 及一条过时 Node 静态合同失败；随后四文件串行 `20/20`、CLI 串行全量 `274/274`，唯一 replacement `verify:all` 在不修改默认命令、超时或生产代码的前提下通过。复审无 BLOCKER/HIGH/MEDIUM/LOW。该结论仍只属于 Windows 本地；真实 Ubuntu clean-checkout CI 必须等待未来明确授权的普通 push 后由远端工作流证明。

三门顺序因此推进到第二门 `TIMELINE_AUTOSAVE_IDENTITY_FAIL_CLOSED`。该门只获准开始只读调查、方案、规格、任务书及随后按批准合同施工；第三门、素材中心、Frontend Pass 5 和主线 Wave 7 均未启动。

```text
CI_PORTABILITY_RESTORE_LOCAL_REVIEWED_CLOSURE = PASS
CI_PORTABILITY_CODE_EVIDENCE_HEAD = d32c9cf939b17b874ff9c934d3c5cf82e7aaeb7a
CI_PORTABILITY_FINAL_HEAD = 0adcc01973098f36ee33597cacaf62b94cb7cdd8
REMOTE_UBUNTU_CI_NOT_REVERIFIED = TRUE
TIMELINE_AUTOSAVE_IDENTITY_FAIL_CLOSED = DESIGN_IN_PROGRESS
REVIEW_TERMINAL_ATOMICITY_NOT_STARTED = TRUE
ASSET_CENTER_NOT_STARTED = TRUE
PUSH_NOT_PERFORMED = TRUE
```

### 8.15 第二修复门 TIMELINE_AUTOSAVE_IDENTITY_FAIL_CLOSED 本地闭合

第二修复门已按项目所有者选择的 Approach A 完成：自动恢复只接受可证明的 canonical 三元身份；稳定 ID、timeline-root-relative 文件、JSON 内部 ID 或正文/EOL 任一不一致时均 fail-closed，不再把恢复正文挂到旧 handle 后写错文件。普通未保存编辑与冲突证据分别保存在 `timelines` 与可选 `timelineConflicts`，冲突桶跨重启只重建待处理记录，绝不自动应用。

人类修复面提供中文 `替换当前时间轴`、`另存为新时间轴`、`下载自动备份`、`放弃此备份` 与 `稍后处理`。Replace Current 会重找唯一目标、校验 stale/ambiguous、先完整规范化再推入一个 undo 快照，只改 text/EOL/dirty 并保留 ID/file/handle；Save As New 复用 Authoring `timelinePathFor`，拒绝当前与 pending delete/restore 的 ID/file/internal-ID 冲突，成功时只插入一条 canonical dirty null-handle 记录。Save All 仍是唯一文件系统写入者。

代码与文档身份：

- 设计规格：`22f70addc0696ed5c81e335930dd6748d9da1980`；
- 总任务书：`7d30380d1d4701801284b64c0882f19f60419331`；
- 冲突证据分桶设计更正：`ba0641f`；
- fail-closed correctness core：`c5512834ca19c9868db39c37cb85d926e514d7cb`；
- guided repair UI：`fb56b460d82f6f72a87f218542edd3a1ddfbebb3`；
- 独立经理复审修正：`26bee5dcb5860196d0ade048d9e71622c7d447a0`；
- docs-only 收口：`4e46697`。

最终验证必须按身份解释：唯一 `verify:all` 在 `fb56b46` 完整通过，但随后只读次级审查发现并由总经理独立确认两项问题——不安全/非规范备份路径可能仅凭 basename 被误判 canonical，以及不可规范化的 Replace 按钮仍可用。两项均建立永久 RED（`65/76`、11 项准确失败）并修复为 `76/76`；最终代码证据 `26bee5d` 的新鲜聚焦为 `5 files / 102 tests`，Editor 全量 `55 files / 446 tests`，typecheck 与 build 均 PASS。由于任务书只允许一次聚合门，未把 `fb56b46` 的聚合通过伪装成 final-HEAD 证据，也未擅自运行第二次 `verify:all`。总经理对最终修正 diff、提交范围和次级发现逐项复核后无剩余 BLOCKER/HIGH/MEDIUM/LOW。

当前结论只代表 Windows 本地代码与自动化 reviewed closure。真实 crash-conflict 浏览器/Owner 人工验收未运行，远端 Ubuntu clean-checkout CI 未重新验证，未 push。三门顺序可以在新的独立规格/任务书中推进到 `REVIEW_TERMINAL_ATOMICITY`，但本轮没有启动第三门；素材中心、Frontend Pass 5 与主线 Wave 7 同样未开始。

```text
TIMELINE_AUTOSAVE_IDENTITY_FAIL_CLOSED_LOCAL_REVIEWED_CLOSURE = PASS
TIMELINE_AUTOSAVE_CODE_EVIDENCE_HEAD = 26bee5dcb5860196d0ade048d9e71622c7d447a0
TIMELINE_AUTOSAVE_FINAL_DOCS_HEAD = 4e46697
VERIFY_ALL_PASSED_HEAD = fb56b460d82f6f72a87f218542edd3a1ddfbebb3
VERIFY_ALL_FINAL_HEAD_MATCH = NO
FINAL_EDITOR_FOCUSED = 5 files / 102 tests PASS
FINAL_EDITOR_FULL = 55 files / 446 tests PASS
FINAL_EDITOR_TYPECHECK = PASS
FINAL_EDITOR_BUILD = PASS
OWNER_CONFLICT_UI_ACCEPTANCE = NOT_RUN
REMOTE_UBUNTU_CI_NOT_REVERIFIED = TRUE
REVIEW_TERMINAL_ATOMICITY_NOT_STARTED = TRUE
ASSET_CENTER_NOT_STARTED = TRUE
FRONTEND_PASS_5_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
PUSH_NOT_PERFORMED = TRUE
```

### 8.16 第三修复门 REVIEW_TERMINAL_ATOMICITY 本地闭合

第三修复门完成“单一终态盖章者”边界：比较决定、结果批准与退回继续使用原有三类回执文件，但所有本机写入统一经过同一个 Node Review Authority，并由 review 范围的跨进程 lease 串行化。Editor 只通过同源、短期 token 的本机 Authority 客户端提交人类决定；静态 Editor 保持只读，Agent Port 继续不暴露任何人类终态写能力。跨进程、跨浏览器、幂等重试、相反结果竞争、损坏双终态、payload 身份、项目/Starter 不变与进程/lease 清理均由固定 FORMAL runner 证明。

首次 FORMAL 在 `6a7a868` 上完成 15/15 里程碑，但因 Chromium 为两个预期 Authority 409 响应输出原生资源错误而在聚合证据合同失败；旧 artifact 与失败状态原样保留。恢复没有按字符串忽略控制台，而是建立“真实响应 envelope + 精确请求身份 + 页面标签 + 完整 URL + 原生 409 文案”的一对一证明合同，错误路由、状态、业务码、请求、重复事件和非预期控制台仍阻断。恢复后的 FORMAL 在 `31042cb` 上 15/15 PASS。

随后默认 CLI 文件并行门暴露 13 个 5/15 秒超时及三个伴随的缺失记录/change/lease 签名；严格串行诊断 39/39、319/319 全绿，三项伴随错误均未复现。该失败没有被改写为通过。最终决策是不增加 timeout、不改生产代码，仅把 I/O 与子进程密集的 CLI 工作区 correctness gate 固定为一个文件 worker；测试内部显式 `Promise.all`、多进程和 lease 并发合同仍保留。永久策略合同 RED 2/3、GREEN 3/3；默认原命令 replacement 全量 39/39、319/319 PASS。

最终代码证据为 `1fe0abda714fd5f3888ddcc0cd4628a15dbbc90c`，docs-only 收口为 `251ac8e`，收口状态词更正为 `ed623dc`。新 HEAD FORMAL 15/15 PASS；Authoring 31/31 文件、266/266 测试，CLI 39/39、319/319，Editor 57/57、469/469；三工作区 typecheck/build 全绿。唯一 `verify:all` PASS，日志 72524 bytes、SHA-256 `353C14A84C22A3F48BB9151D16B72DD189D6C7346C25564A31732F249C1B729B`；Starter 模拟 259 条路径、23/23 分支、367 次存档往返、三个结局可达、运行时错误为 0。`verify:docs`、845 路径 tracked hygiene 与双 diff check 均 PASS。两轮 bounded Luna 最终审计均无 HIGH/BLOCKER。

该闭合仍不等于远端 Ubuntu CI、部署或项目所有者手动跨窗口压力验收。素材中心被确认是三个修复门之后的第一个新增功能，但本门没有启动素材中心、Frontend Pass 5 或主线 Wave 7。普通 push 已由项目所有者授权，当前仅等待最终远端同步核对。

```text
REVIEW_TERMINAL_ATOMICITY_LOCAL_REVIEWED_CLOSURE = PASS
REVIEW_TERMINAL_ATOMICITY_CODE_EVIDENCE_HEAD = 1fe0abda714fd5f3888ddcc0cd4628a15dbbc90c
REVIEW_TERMINAL_ATOMICITY_DOCS_HEAD = ed623dc
FINAL_FORMAL = 15/15 PASS
FINAL_AUTHORING = 31 files / 266 tests PASS
FINAL_CLI = 39 files / 319 tests PASS
FINAL_EDITOR = 57 files / 469 tests PASS
VERIFY_ALL = PASS
REMOTE_UBUNTU_CI_NOT_REVERIFIED = TRUE
OWNER_REAL_CONCURRENCY_ACCEPTANCE = NOT_RUN
ASSET_CENTER_NOT_STARTED = TRUE
FRONTEND_PASS_5_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
PUSH = AUTHORIZED_PENDING_REMOTE_SYNC
```

普通 push 已完成：本地 `main`、本地 remote-tracking `surdet/main` 与 GitHub `refs/heads/main` 均精确为 `fcb3216f8adf376ea9120ac1bb7bde99bc7711c1`，ahead/behind=`0/0`。使用普通 fast-forward push；未 force、未改写历史、未部署。长期台账继续保持 untracked/unstaged，不混入远端提交。

```text
PUSH = PERFORMED
REMOTE_MAIN = fcb3216f8adf376ea9120ac1bb7bde99bc7711c1
AHEAD_BEHIND = 0/0
FORCE_PUSH = NOT_PERFORMED
DEPLOYMENT = NOT_PERFORMED
```

普通 push 已完成：本地 `main`、本地 remote-tracking `surdet/main` 与 GitHub `refs/heads/main` 均精确为 `ed623dc9b10fad5d971fa1f963a626a578207f82`，ahead/behind=`0/0`。使用普通 fast-forward push；未 force、未改写历史、未部署。长期台账继续按既定治理保持 untracked/unstaged，不混入远端提交。

```text
PUSH = PERFORMED
REMOTE_MAIN = ed623dc9b10fad5d971fa1f963a626a578207f82
AHEAD_BEHIND = 0/0
FORCE_PUSH = NOT_PERFORMED
DEPLOYMENT = NOT_PERFORMED
```

### 8.17 第一个新增功能：ASSET_CENTER_READ_ONLY_INTELLIGENCE 本地闭合

三个稳定性修复门完成后，首个新增功能按既定顺序落为只读素材中心。该轮没有复刻 LetsGal 的代码、品牌或资产，而是借鉴成熟创作工具的工作流：独立中文 `素材` 工作区、左侧分类与状态筛选、中部可扫描素材清单/网格、右侧固定详情与预览，并把既有脚本侧栏压缩为同一事实源的快速入口。

底层建立单一 Authoring 物理素材事实投影：范围严格为 `content/assets`，身份为项目相对物理路径，统一提供类型、大小、引用、缺失、重复、不安全命名、不支持格式和未使用状态；CLI 与 Agent 只读取结构化元数据。Editor 没有另建第二份索引，旧 `gallery.json` 解锁插入仍是受保留的界面动作适配器。素材创建、导入、改名、移动、删除、覆盖、转码与项目写入全部没有启动。

独立 Luna 审查发现并推动修复了带引号参数、`@ambience "off"`、默认 portrait expression、重复物理事实、重复 gallery ID、多来源解锁、虚假行号、统计 schema 漂移、异步悬浮预览串位、键盘焦点与 runner 假阳性等问题。最终三个审查面均为 BLOCKER 0 / HIGH 0；历史失败 artifacts 全部保留。

最终代码证据 `475500def90bac0a3a9b92f8b13e84cbad1bafaf`：Authoring 32 files / 275 tests、CLI 40 / 324、Editor 60 / 476，三工作区 typecheck/build 全绿；唯一 `verify:all` PASS，日志 74,964 bytes、SHA-256 `778E74B4724B6A4B7E7178153C7EDB86855F300C32652E8C674BEAE7A2557762`。唯一 FORMAL 26/26 PASS，evidence 87,903 bytes、SHA-256 `7CD30F59BA70066F2AC721FCA03246EFFEDEE32F81F862D8FAB868502A5E9B06`；浏览器、协议、请求、清理、端口和 Object URL 生命周期均闭合，项目 fixture 与原始 Starter 均未变化。

docs-only 收口为 `fcb3216`。剩余非阻断项不得混写为已完成：旧 `public/` 兼容扫描需要独立迁移门；人类可读的中文素材显示名尚无正式元数据合同；极窄 TOCTOU 与写后还原检测只有在实测需要时再增强。下一推荐新增门为 `ASSET_CENTER_IMPORT_LIFECYCLE`：先设计受控导入收件箱、冲突预览、引用安全和可撤销提交，再考虑改名/移动/删除；该门尚未启动，也不自动获得破坏性素材写权限。Frontend Pass 5 与主线 Wave 7 同样未启动。

```text
ASSET_CENTER_READ_ONLY_INTELLIGENCE_LOCAL_REVIEWED_CLOSURE = PASS
ASSET_CENTER_CODE_EVIDENCE_HEAD = 475500def90bac0a3a9b92f8b13e84cbad1bafaf
ASSET_CENTER_DOCS_HEAD = fcb3216
FINAL_AUTHORING = 32 files / 275 tests PASS
FINAL_CLI = 40 files / 324 tests PASS
FINAL_EDITOR = 60 files / 476 tests PASS
VERIFY_ALL = PASS
FORMAL = 26/26 PASS
PROJECT_MUTATION = NO
ORIGINAL_STARTER_UNCHANGED = YES
ASSET_CENTER_IMPORT_LIFECYCLE = NOT_STARTED
FRONTEND_PASS_5_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
PUSH = AUTHORIZED_PENDING_REMOTE_SYNC
```

### 8.18 素材中心第二阶段导入链路闭合；项目所有者恢复唯一终审权

素材中心第二阶段已经完成并推送：Editor 提供中文、无覆盖的项目素材导入工作台；CLI authority 负责项目绑定、分阶段上传、冲突预览、显式确认、独占发布、失败恢复与整批撤销。独立审查指出的记录节点类型、终态回执、目录耐久、撤销副本、并发绑定、令牌期限、重启发现和浏览器证据缺口均已在后继提交中关闭。`39391af` 的远端 CI 完整通过全仓库验证和真实素材导入浏览器流程；随后 `963450d` 只删除九个无引用旧文件并按项目所有者的精简要求跳过重复 CI。本地与远端 `main` 已同步。

项目所有者明确重申：项目所有者是产品体验、阶段转换与最终验收的唯一裁决者；远端或子代理审查只提供辅助 finding，不拥有批准权，也不得让已经由项目所有者决定继续的正常施工停摆。当前工作方式同时固定为反过度工程化：不新建证据包、哈希清单、复杂恢复平台、重复全量门禁或冗长审计链；默认采用最小实现和一次最相关验证。

项目所有者同时要求：在有实际施工或审查工作时持续使用平台允许的最大 Luna 并发。当前平台最多允许四个并发席位且包含主代理，因此执行口径为“主代理 + 三个 `luna_worker`”持续满载，直至本轮工作完成；不得用非 Luna 代理补足数量，也不得为了凑并发制造无意义任务。

下一步回到产品建设，继续素材中心第三阶段。应优先选择能让大型项目长期管理素材、同时不破坏现有引用和导入链路的最小成熟能力；不启动插件市场、云同步、发布平台或第二套素材事实源。

```text
ASSET_CENTER_IMPORT_LIFECYCLE = CLOSED_AND_PUSHED
ASSET_IMPORT_REMOTE_CI = PASS
OWNER_IS_FINAL_ACCEPTANCE_AUTHORITY = TRUE
EXTERNAL_REVIEW = ADVISORY_ONLY
ANTI_OVERENGINEERING = REQUIRED
LUNA_CONCURRENCY = PLATFORM_MAXIMUM (ROOT + 3 LUNA_WORKERS)
ASSET_CENTER_PHASE_3 = IN_DESIGN_AND_IMPLEMENTATION
FRONTEND_PASS_5_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.19 素材中心第三阶段首个增量：大型项目洞察与导航

素材中心第三阶段的首个增量已经实现并推送。`43e5547` 仅修改五个 Editor 文件，在既有 Authoring 素材事实投影之上增加中文排序、按类别显示空间占用、定位大文件、按问题直接筛选、素材路径展示，以及重绘后的键盘焦点恢复；没有增加第二套素材索引，也没有启动覆盖、改名、移动、删除、转码或其他素材写操作。

本地聚焦验证为 2 个文件 / 10 个测试通过，Editor typecheck 与 build 通过。首次远端 CI 在既有 Starter HMR 测试中暴露真实时间竞态：1050ms 的开场时间轴尚未结束，测试便捕获 250ms 基线，随后把立绘自然出现误判为 HMR 变更。`e520c00` 仅在该测试首次取样前等待开场投影稳定；对应聚焦测试通过，后继 CI `33538498856` 完整通过 `verify:all`、真实素材导入浏览器流程与 P1/P2 策略。

当前仅能认定“第三阶段首个增量已交付”，不能认定整个第三阶段完成。项目所有者尚未对这次新增界面做最终人工视觉验收；Luna 与自动化只提供施工辅助和机器证据，不替代项目所有者裁决。Frontend Pass 5 与主线 Wave 7 均未启动。

```text
ASSET_CENTER_PHASE_3_FIRST_INCREMENT = PUSHED
ASSET_CENTER_INSIGHTS = SORTING + STORAGE + LARGE_FILES + ISSUE_NAVIGATION
ASSET_WRITE_BEHAVIOR = NOT_ADDED
REMOTE_CI_33538498856 = PASS
OWNER_VISUAL_ACCEPTANCE = NOT_STARTED
ASSET_CENTER_PHASE_3 = IN_PROGRESS
FRONTEND_PASS_5_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.20 前端重构窗口与 Luna 按需协作

项目所有者撤销此前“施工期间持续占满 Luna 并发”的要求。自本条起，Luna 只在存在边界清楚、互不重叠且确有信息增益的局部实现或只读复核时按需调用；推荐节奏是由总经理完成关键代码后，交 Luna 做独立只读审查，同时总经理推进不依赖该审查的下一项工作。不得为了并发数量制造任务。架构、关键实现、最终整合、完成判断、提交与 push 仍由总经理负责。

项目所有者希望未来对当前偏表格化、类似 Excel 的 Editor 前端做更完整的视觉重构，并已另行准备反 AI 前端工具包。当前不立即插入大规模重构：先把素材中心 Phase 3 收束到稳定功能边界，再在 Frontend Pass 5 之前设置一次统一视觉系统与信息架构整理窗口。该窗口优先调整应用骨架、排版尺度、留白、视觉层级、内容分组和交互组件，并保持现有功能与后端合同不变；反 AI 工具包届时作为设计约束和审查辅助使用，不自动取得改动业务语义的权限。

```text
LUNA_CONCURRENCY = ON_DEMAND
FORCED_LUNA_CONCURRENCY = REVOKED
PRIMARY_AGENT_OWNS_ARCHITECTURE_AND_FINAL_DECISION = TRUE
FRONTEND_REFACTOR_TARGET_WINDOW = AFTER_ASSET_CENTER_PHASE_3_BEFORE_FRONTEND_PASS_5
FRONTEND_REFACTOR_SCOPE = VISUAL_SYSTEM_AND_INFORMATION_ARCHITECTURE
BACKEND_AND_EXISTING_BEHAVIOR = PRESERVE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.21 素材中心第三阶段第二个增量：只读文件夹导航；工程化约束更正

素材中心第三阶段第二个增量已经实现并推送。Editor 直接使用现有 `ProjectAssetItem.sourcePath` 构建只读位置选择与面包屑导航；目录范围会与搜索、分类、状态和排序共同生效，切换普通项目或演示项目时清除旧目录状态。缺失引用不被伪造为物理目录，路径校验拒绝绝对路径、越级片段和非 `content/assets` 来源。该实现没有增加第二套素材索引，也没有新增创建、改名、移动、删除、覆盖、转码或后端写入能力。

聚焦素材中心验证 16/16、项目切换状态验证 2/2、Editor 全量 65 个文件 / 528 项测试、typecheck 与 build 均通过。实际浏览器在 1440px 与 800px 下确认后代目录筛选、面包屑、焦点恢复和无页面横向溢出。Luna 只读复核发现的跨项目同名目录状态残留已由永久测试与两处最小重置关闭。三个相关提交已普通快进推送至远端 `main`，最终功能提交为 `cbf6269`。远端 CI `33544194558` 在干净环境中完成全仓库验证、真实素材导入浏览器流程与 P1/P2 策略，结论为 PASS。

项目所有者同时更正此前的绝对“禁止工程化”口径：适度工程化可以采用，但必须明确说明它解决的真实风险、现有简单方案为何不足，以及长期维护成本为何值得。不能回答这三点的机制不得引入；不得为了流程外观、模型偏好或抽象完整性而增加清单、证据体系、恢复平台、重复门禁或未来式架构。本次文件夹导航没有出现值得扩大工程复杂度的理由，因此保持单一事实源与最小 Editor 实现。

当前仍只能认定 Phase 3 第二个增量已交付，不能宣称素材中心 Phase 3 整体完成。Frontend Pass 5、统一前端视觉重构窗口与主线 Wave 7 均未启动。

```text
ASSET_CENTER_PHASE_3_SECOND_INCREMENT = PUSHED
ASSET_FOLDER_NAVIGATION = READ_ONLY_SOURCE_PATH_PROJECTION
ASSET_WRITE_BEHAVIOR = NOT_ADDED
SECOND_ASSET_INDEX = NOT_ADDED
REMOTE_CI_33544194558 = PASS
ENGINEERING = ALLOWED_WHEN_REAL_RISK_AND_MAINTENANCE_VALUE_ARE_EXPLICIT
OVERENGINEERING_WITHOUT_JUSTIFICATION = PROHIBITED
ASSET_CENTER_PHASE_3 = IN_PROGRESS
FRONTEND_PASS_5_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.22 素材中心第三阶段第三个增量：真实视觉缩略图

素材中心网格已经从纯文字卡片升级为真实视觉素材浏览：背景、立绘与头像直接读取既有文件句柄生成缩略图；背景与头像采用填充裁切，立绘保留完整画面；音频、字体、视频、缺失文件和不可读取图片使用克制的中文占位，不伪造素材预览。列表模式继续保持紧凑，并且不会为了缩略图读取二进制文件。该增量没有修改素材、没有新增后端写入，也没有建立第二套素材索引。

大型项目如果一次性读取全部图片，会带来真实的磁盘 I/O 与内存压力，因此本轮采用单一、可销毁的视口加载会话；它只在网格模式存在，离开页面或重绘时会终止旧请求并释放临时图片地址。没有引入缓存、数据库、清单、后台任务或恢复平台。永久运行时测试覆盖了迟到读取不得写回旧页面，以及成功、失败和销毁路径的资源释放。

本地定向验证为 4 个文件 / 23 项测试通过；生产实现冻结时 Editor 全量 66 个文件 / 534 项测试、typecheck 与 build 通过。一次实际浏览器检查确认真实缩略图、图片适配、中文占位、筛选后的身份一致、资源释放，以及 800px 无页面横向溢出。Luna 复核无阻断或高风险问题；仓库卫生审查没有找到既无引用又可安全删除的 tracked 文件，因此本轮没有为了“显得干净”删除仍有消费者的 runner 或模块。

相关提交已经普通快进推送至远端 `main`，最终修正提交为 `bc69f68`。首次 CI 准确发现测试代码在严格类型检查下的数组索引警告；一行修正后，新 CI `33547820429` 完整通过全仓库验证、真实素材导入浏览器流程与 P1/P2 策略。当前只完成 Phase 3 的第三个独立增量，不能据此宣称整个素材中心第三阶段完成。统一前端视觉重构窗口仍安排在 Phase 3 收束之后、Frontend Pass 5 之前；主线 Wave 7 未启动。

```text
ASSET_CENTER_PHASE_3_THIRD_INCREMENT = VISUAL_THUMBNAILS_PUSHED
ASSET_THUMBNAILS = REAL_IMAGE_HANDLES_IN_GRID_ONLY
ASSET_LIST_BINARY_READS = NONE
ASSET_WRITE_BEHAVIOR = NOT_ADDED
SECOND_ASSET_INDEX = NOT_ADDED
REPOSITORY_HYGIENE_DELETIONS = NONE_SAFE_FOUND
REMOTE_CI_33547820429 = PASS
ASSET_CENTER_PHASE_3 = IN_PROGRESS
FRONTEND_PASS_5_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.23 素材中心 Phase 3 收口选择；引用感知移动/重命名留作下一阶段

项目所有者确认下一增量先完成现有导入规格已经承诺、但 Editor 尚未落地的“拖放普通文件进入导入工作台”。该能力必须复用既有文件选择、草稿、冲突检查、显式确认、导入 authority、回执和撤销链；不得建立第二套导入逻辑，也不得修改后端或项目格式。完成这一小而真实的入口缺口后，素材中心 Phase 3 可以收口，再进入此前约定的统一前端视觉重构窗口。

项目所有者同时明确希望未来实现引用感知的素材移动与重命名。该能力会跨越物理文件和剧情、时间轴、角色、字体等引用，价值很高但不适合混入本轮；它被固定为独立下一阶段，需要单独设计中文影响预览、冲突边界、写入 authority 与失败恢复。当前不得提前实现、伪装为普通文件移动或用浏览器直写绕过现有安全边界。

```text
ASSET_CENTER_PHASE_3_CLOSURE_INCREMENT = DRAG_AND_DROP_IMPORT_APPROVED
DRAG_DROP_IMPORT = REUSE_EXISTING_AUTHORITY_ONLY
BACKEND_OR_PROJECT_FORMAT_CHANGE = NOT_ALLOWED
REFERENCE_AWARE_MOVE_RENAME = NEXT_INDEPENDENT_PHASE
FRONTEND_REFACTOR_WINDOW = AFTER_PHASE_3_CLOSURE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.24 素材中心 Phase 3 完成：拖放复用既有导入链

素材中心 Phase 3 的收口增量已经实现并推送。用户现在可以把多个普通本机文件拖到现有导入工作台，文件选择入口仍然保留；拖放只负责把浏览器 `File` 交给原有 `onSelectFiles`，后续草稿、分类、命名、冲突检查、显式确认、authority 写入、回执、重开与整批撤销仍是原来的唯一链路。没有修改后端、项目格式或现有素材，也没有建立第二套导入系统。

Luna 只读审查发现并推动关闭了几个真实边缘问题：链接、文本、目录和锁定状态现在会阻止浏览器默认打开/跳转；目录不会误显示为可接收；完成或取消结果仍在工作台时，文件与目标字段保持只读；成功接收提示可跨同步重绘保留；主界面文件族改为中文；连续 `dragover` 不再反复写入播报区域，所有需要改文件名的错误都会同步 `aria-invalid`。最终两轮 Luna 复核无剩余 BLOCKER/HIGH/MEDIUM/LOW。

本地最终聚焦为 3 个文件 / 39 项测试通过，Editor typecheck 与 build 通过；真实浏览器素材导入 runner 16/16 通过。六个普通提交已经快进推送到 `main`，最终提交为 `36b2aba`；远端 CI `33552823143` 完整通过全仓库验证、真实素材导入流程与 P1/P2 策略。

至此，素材中心 Phase 3 的大型项目洞察、只读文件夹导航、真实视觉缩略图和自然拖放导入入口全部交付。下一项素材管理写能力仍是独立的“引用感知移动/重命名”，不得退化成浏览器直接移动文件；统一前端视觉重构窗口仍按既定路线位于 Phase 3 之后、Frontend Pass 5 之前。两者都未在本轮启动。

```text
ASSET_CENTER_PHASE_3_DRAG_DROP_IMPORT = CLOSED_AND_PUSHED
ASSET_CENTER_PHASE_3 = COMPLETE
FINAL_COMMIT = 36b2aba
REMOTE_CI = 33552823143 PASS
BACKEND_OR_PROJECT_FORMAT_CHANGE = NONE
SECOND_IMPORT_PIPELINE = NONE
FRONTEND_REFACTOR_WINDOW = READY_FOR_SEPARATE_PLANNING
REFERENCE_AWARE_MOVE_RENAME = NEXT_ASSET_MANAGEMENT_PHASE_NOT_STARTED
FRONTEND_PASS_5_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.25 引用感知的单素材移动与重命名完成

素材中心已经具备第一项安全整理能力：用户可以对背景、立绘和头像执行同类别的单素材移动或重命名。Editor 会先用中文展示目标位置、受影响引用和阻断原因；确认后，由既有 CLI 写入 authority 统一移动二进制文件并更新剧情、时间轴、角色或鉴赏配置中的精确引用。完成后可重开回执、继续恢复或整笔撤销，项目切换与普通保存也与该写操作共用同一写入边界。没有增加第二套素材索引，也没有改变项目格式。

Luna 独立复核发现并推动关闭了恢复入口不可达、终态按钮残留、内部重载重复绑定、写入时序竞争、浏览器未处理异常漏检等真实问题。最终本地 Authoring 11/11、CLI 124/124、Editor 132/132，相关 typecheck/build 全部通过；真实浏览器完成 21/21，覆盖目标冲突、影响预览、移动后真实预览、重载和撤销还原。远端 CI 前两轮分别发现 Linux 临时目录变量差异和 lease 正常释放时的并发读取竞态；两者均以最小永久回归修正。最终提交 `971e722` 的 CI `33573696580` 通过全仓库验证、真实素材导入 authority 浏览器流程与 P1/P2 策略。

本阶段只交付单素材、同类别移动或重命名。批量整理、跨类别转换、删除素材，以及音频、视频、字体和其他文件的引用重写仍未启动；项目所有者此前选择的批量方案 C 保留为下一独立素材阶段，不自动获得施工授权。统一前端视觉重构窗口仍可单独规划，主线 Wave 7 未启动。

```text
REFERENCE_AWARE_SINGLE_ASSET_RELOCATION = CLOSED_AND_PUSHED
SUPPORTED_KINDS = BACKGROUND + PORTRAIT + AVATAR
REFERENCE_PREVIEW_AND_EXACT_REWRITE = PASS
RECOVERY_AND_UNDO = PASS
REAL_BROWSER = 21/21 PASS
FINAL_COMMIT = 971e722
REMOTE_CI_33573696580 = PASS
BATCH_RELOCATION_OPTION_C = NEXT_INDEPENDENT_ASSET_PHASE_NOT_STARTED
FRONTEND_REFACTOR_WINDOW = READY_FOR_SEPARATE_PLANNING
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.26 引用感知批量素材整理完成

素材中心现在可以一次选择 2 至 100 个同类背景、立绘或头像，统一移动目录并逐项调整文件名。整批操作由一个计划、一个 journal、一个回执和一次撤销完成，支持链式改名与 A/B 路径交换；所有可靠识别的剧情、时间轴、角色和鉴赏引用会同时更新，任一阻断都不会产生部分成功。

Editor 使用原生复选框和独立详情按钮，批量模式固定为紧凑列表，不暴露单素材整理入口；影响摘要、逐项文件名、中文阻断原因、执行结果和撤销动作都处于普通文档流。800px 窄窗口无横向溢出，键盘焦点、跨筛选选择和项目重载后的回执状态均保持正确。

Luna 三路复核推动关闭了同运行时身份歧义、立绘组跨角色映射、内部占位符死循环、源/目标身份竞争、目标目录替换、文本安全发布、回执窗口及中断恢复等真实问题，最终均无产品级 BLOCKER/HIGH。本地最终验证为 Authoring 22/22、CLI authority 25/25、Editor 聚焦 39/39、runner contract 11/11、真实浏览器 26/26；相关 typecheck/build 通过。八个普通提交已快进推送到远端 `main`，最终提交 `1370f04`；CI `33582402820` 的全仓库验证、真实素材导入 authority 浏览器流程与 P1/P2 策略全部通过。

通用 Node 文件接口无法对完全不合作的外部进程提供绝对的系统调用级 CAS；当前实现采用项目 lease、完整身份复核、独占发布和可恢复保留文件，把可实现的覆盖风险降到明确边界内，不虚构绝对保证。跨类别转换、删除素材、通用自动归档规则、Frontend Pass 5 与主线 Wave 7 均未启动。

```text
REFERENCE_AWARE_BATCH_ASSET_ORGANIZATION = COMPLETE_AND_PUSHED
BATCH_SIZE = 2_TO_100_SAME_KIND
CHAIN_AND_SWAP = SUPPORTED
SINGLE_PLAN_JOURNAL_RECEIPT_UNDO = YES
REAL_BROWSER = 26/26 PASS
FINAL_COMMIT = 1370f04
REMOTE_CI_33582402820 = PASS
FRONTEND_PASS_5_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.27 Editor 统一壳层与视觉层级底座完成

素材中心 Phase 3 与引用感知整理完成后，既定的 Frontend Pass 5 前统一视觉窗口已经兑现。Editor 项目栏现在把产品身份、当前项目、当前工作、全局命令和操作回执分层展示；九个真实模式保持原 ID、面板 ID 和回调，同时按“创作 / 检查 / 项目”形成中文可访问分组。共同视觉基线改为暖灰纸面、炭黑应用栏和低饱和陶土主动作，字号、间距、焦点和控件尺度由现有三层样式职责统一管理，没有建立第二套状态或动作系统。

真实浏览器检查推动关闭了两个自动合同原先遗漏的问题：空的时间轴恢复宿主不再占用隐形整行，1200–1280px 顶栏不再让命令内容向左侵入项目上下文。390px 下五个全局命令均完整可达；Luna 还发现并促使撤回了会压过时间轴紧凑控件和素材导入错误边框的全局输入强制规则。最终 Editor 全量 68 files / 564 tests、typecheck、D 盘构建和壳层聚焦 22/22 通过。

提交 `1990483` 已普通快进推送到远端 `main`；CI `33585224477` 的全仓库验证、真实素材导入 authority 浏览器流程与 P1/P2 策略全部通过。Preview、Review、Stats、Audit 的旧模式内部视觉仍按原顺序留给 Frontend Pass 5–7，本轮没有虚报为全 Editor 迁移完成；主线 Wave 7 仍未启动。

```text
EDITOR_SHELL_HIERARCHY_FOUNDATION = COMPLETE_AND_PUSHED
NINE_MODE_IDENTITY_AND_CALLBACKS = PRESERVED
DESKTOP_1440_AND_MOBILE_390 = CHECKED
EDITOR_FULL = 564/564 PASS
FINAL_COMMIT = 1990483
REMOTE_CI_33585224477 = PASS
NEXT_FRONTEND_INCREMENT = PASS_5_PREVIEW_STAGE_AND_CAUSAL_DOCK
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.28 Frontend Pass 5：预览舞台与因果记录区完成

Editor 预览页已经从旧的纵向调试堆叠重建为“播放控制—剧情舞台—状态—因果记录”工作台。唯一 iframe、`PreviewRuntimeLifecycle`、`RendererRuntime`、轨迹消息和因果选择状态保持不变；ready、diagnostic 与 trace 现在只接受当前挂载 iframe，旧面板迟到消息不会串入新页面。新 reload 开始前会失效旧解释器和轻宿主引用，失败后也不会继续暴露上一轮或半完成会话。

剧情舞台占据剩余主空间；因果记录处于普通文档流，可收起并独立滚动，中文动作与来源优先显示，内部 kind/op 只保留为次级技术信息。Review 结果页继续复用同一 Preview 渲染器并使用嵌入布局。390×844 默认收起记录，列表即使手动展开也限制为 96px；桌面与窄屏均无页面横向溢出，没有重新引入卡片墙、彩色单侧线或浮空动作。

本地最终相关验证为 50 项通过，Wave 3B runner 合同 11/11，Editor 全量 572/572，typecheck 与 D 盘构建通过。实际浏览器覆盖 1440×900、1280×800、390×844；三路 Luna 复核推动关闭旧 E2E 文案、未知事件中文回退、旧蓝色按钮和窄屏舞台压缩，最终无 BLOCKER/HIGH。提交 `1e0f551` 已普通快进推送到远端 `main`；CI `33588685535` 的全仓库验证、真实素材导入 authority 浏览器流程与 P1/P2 策略全部通过。

本轮浏览器视觉检查没有打开真实项目，因此没有用浏览器生成真实轨迹；来源隔离、顺序去重、完成边界、轨迹定位与时间轴重播由聚焦测试和既有 E2E runner 合同覆盖。项目所有者尚未对本轮新 Preview 做最终人工视觉验收。下一前端增量固定为 Frontend Pass 6 的 Review 校对工作台；主线 Wave 7 仍未启动。

```text
FRONTEND_PASS_5_PREVIEW_STAGE = COMPLETE_AND_PUSHED
SINGLE_PREVIEW_RUNTIME_AND_TRACE_SOURCE = PRESERVED
STALE_IFRAME_AND_FAILED_RELOAD_GUARDS = PASS
DESKTOP_1440_1280_AND_MOBILE_390 = CHECKED
EDITOR_FULL = 572/572 PASS
FINAL_COMMIT = 1e0f551
REMOTE_CI_33588685535 = PASS
OWNER_VISUAL_ACCEPTANCE = NOT_STARTED
NEXT_FRONTEND_INCREMENT = PASS_6_REVIEW_PROOFREADING_WORKBENCH
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.29 Frontend Pass 6：Review 人类校对工作台完成

Editor 审阅页已经从技术报告和卡片堆叠重建为任务优先的校对工作台。候选比较现在先说明任务目标，再依次展示需要决定的冲突、保存动作、自动纳入的相同结果和系统补全依赖；选择会立即显示，安全组可直接排除或恢复，两个冲突共享同一单元时也不会串组选中。结果审阅改为“可批准结论—正式预览—批准或退回—变更摘要—证据与观察—技术详情”，计划 ID、指纹、原始差异和回执身份默认折叠。回执、Authority、pending、fixture、freshness 与唯一嵌入 Preview 的原有边界未改，后端、Authoring、CLI 和项目格式均未修改。

Review 已迁入独立样式层，使用既有 Surdet 字体、间距和纸面色 token；旧彩色单侧线、胶囊状态、浮空动作和嵌套卡片墙退出。1440×900、1280×800 和 390×844 的实际浏览器结构检查均无横向溢出，保存动作与安全组开关可见，技术详情默认收起。Luna 三路复核发现并推动关闭了折叠区内不可见开关、安全组部分选择误判、跨冲突选中串组和不确定终态提示矛盾，修复后二次复核全部 PASS。

本地 Review 聚焦 79/79，通过 Luna 修正后相关回归 35/35；Editor 全量 579/579、typecheck 与 D 盘 build 通过。提交 `8cd83b0` 已普通快进推送到远端 `main`；CI `33592683102` 的全仓库验证、真实素材导入 authority 浏览器流程与 P1/P2 策略全部通过。浏览器视觉检查使用代表性 Review 结构，没有打开新的真实 review workspace，因此真实回执写入与 embedded Preview 行为仍由既有 Wave 6 合同和本轮 Review 测试覆盖；项目所有者尚未进行本轮最终视觉验收。Frontend Pass 7 与主线 Wave 7 均未启动。

```text
FRONTEND_PASS_6_REVIEW_PROOFREADING_WORKBENCH = COMPLETE_AND_PUSHED
HUMAN_TASK_ORDER_AND_CHINESE_LABELS = PASS
RECEIPT_AUTHORITY_PENDING_AND_PREVIEW_CONTRACTS = PRESERVED
DESKTOP_1440_1280_AND_MOBILE_390 = CHECKED
FINAL_COMMIT = 8cd83b0
REMOTE_CI_33592683102 = PASS
OWNER_VISUAL_ACCEPTANCE = NOT_STARTED
FRONTEND_PASS_7_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.30 Frontend Pass 7：项目概览与文字一致性检查完成

Editor 的“统计”和“审计”已经重建为同一套项目体检工作区。统计页不再铺设指标卡片墙，而是以预估通关时长、连续作品摘要和可定位的场景明细表组织现有数据；审计页改为中文优先的文字一致性检查，按“建议处理 / 请确认”分组，跳转与术语补录均使用真实按钮，技术代码、文件与行号默认收进详情。空项目、编译失败、部分编译和完整无问题不再共用容易误导的成功外观。

本轮还关闭了几个与页面可信度直接相关的项目切换边界：切换项目会清除旧校验、关系和配置会话，迟到的 Worker 或配置读取不能写回新项目，项目加载期间旧审计动作也不能污染新项目。没有修改 Authoring、CLI、Core、Renderer、项目格式或审计算法。

本地聚焦验证最终 76/76，Editor 全量 71 个文件 / 589 项测试、typecheck 与 D 盘 build 均通过；1440×900 与 390×844 的空状态实际浏览器检查无横向溢出。三路 Luna 最终只读复核均 PASS。提交 `6c80829` 已普通快进推送至远端 `main`；CI `33596601614` 的全仓库验证、真实素材导入浏览器流程与 P1/P2 策略全部通过。浏览器没有打开真实项目，因此真实项目的统计表与问题跳转视觉仍由聚焦行为测试覆盖，项目所有者人工视觉验收尚未进行。

Frontend Pass 1–7 的 Editor 主模式内部迁移至此完成。下一项按已批准的前端总计划进入 Frontend Pass 8：Renderer 玩家界面与主题边界；它仍属于 Post-Wave-6 / Pre-Wave-7 前端支线，不是主线 Wave 7。

```text
FRONTEND_PASS_7_PROJECT_HEALTH_AND_AUDIT = COMPLETE_AND_PUSHED
PROJECT_SWITCH_STALE_STATE_GUARDS = PASS
DESKTOP_1440_AND_MOBILE_390_EMPTY_STATES = CHECKED
FINAL_COMMIT = 6c80829
REMOTE_CI_33596601614 = PASS
OWNER_VISUAL_ACCEPTANCE = NOT_STARTED
NEXT_FRONTEND_INCREMENT = PASS_8_RENDERER_PLAYER_INTERFACE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 8.31 嵌套场景改名与删除的数据边界完成

> **2026-09-07 衔接：** 本节记的是 `33f0122` 时点。后续第 9.1 已增加窄场景 authority 和自动备份事务组；不能把本节当时“未恢复改名/删除意图”的限制抄成后继修复之后仍未关闭的 finding。本节原验证范围保持不变。

Frontend Pass 7 收口后的数据边界复核发现，Editor 虽然能递归读取 `content/scenario` 下的嵌套场景，旧改名与删除实现却没有保留真实相对目录：改名可能把新文件写到场景根目录，删除子目录场景也只移出内存，重开项目后旧文件会重新出现。本轮已经把场景物理路径纳入文件身份，并将改名与删除统一为“先进入待保存状态，再由保存全部写盘”。改名固定先在原目录写成新文件，成功后才删除旧文件；写入或清理失败都会保留旧文件或待处理状态，不能伪装成保存成功。

Luna 三路只读复核进一步找出了 Windows 大小写别名可能自删、待删路径被同名新场景复用、保存与改名并发、重复 sceneId 批量改错引用、流程图宿主入口或歧义目标仍可建链，以及操作后旧编辑稿和项目栏未刷新等风险。当前实现已经逐项收住：场景写操作串行；物理路径按 Windows 大小写不敏感比较；待删路径、现有目标和仅大小写改名全部拒绝；流程图只有源和目标都能唯一定位时才允许建链，宿主入口不可编辑；项目入口或事件、成长、日历配置仍引用场景时先阻止改名或删除；场景目录提供精确路径的原生“改名”“删除”按钮；操作完成后统一刷新当前编辑区与保存状态。存在待保存的场景改名或删除时，主动切换项目和演示项目会被阻止。

本地最终聚焦验证为 5 个文件 / 93 项测试通过，Editor 全量 72 个文件 / 608 项测试、typecheck 与 D 盘生产 build 均通过。两路 Luna 复核确认原先报告的产品级风险全部关闭；第三路只保留一个明确的非本轮扩展项：现有自动备份格式不会在浏览器崩溃后恢复尚未点击“保存全部”的改名或删除意图。本轮没有扩建恢复格式；保存前不会删除旧磁盘文件，关页与主动切换均有保护，因此原始文件安全，但未保存操作仍按未保存内容处理。

设计规格与任务书已经随提交 `33f0122` 普通快进推送到远端 `main`。CI `33602352122` 的全仓库验证、真实素材导入浏览器流程与 P1/P2 策略全部通过。测试仅使用内存文件句柄，没有改动真实用户项目。本轮按项目所有者要求到此停止；Frontend Pass 8 与主线 Wave 7 均未启动。

```text
NESTED_SCENE_PATH_LIFECYCLE = COMPLETE_AND_PUSHED
RENAME_SAVE_ORDER = WRITE_NEW_THEN_DELETE_OLD
DELETE_AND_RENAME_PENDING_STATE = PRESERVED_ON_FAILURE
WINDOWS_CASE_ALIAS_AND_PATH_REUSE = BLOCKED
FLOW_AMBIGUITY_AND_HOST_ENTRY_WRITES = BLOCKED
EDITOR_FULL = 608/608 PASS
FINAL_COMMIT = 33f0122
REMOTE_CI_33602352122 = PASS
AUTOSAVE_PENDING_SCENE_INTENT_RECOVERY = NOT_EXPANDED
FRONTEND_PASS_8_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

## 九、数据安全修复与近期接续登记

> 第 9.1 节是原台账末条记录，原文保留。第 9.2 节起为 **2026-09-07 经 Owner 授权的接续补记**，依据本次对话的明确决定、已完成的云端终审报告和本轮只读远端核对；不是重新执行这些历史测试。唯一当前快照见第 9.8 节。

### 9.1 独立审核数据安全修复完成

针对远端独立审核确认的五个数据边界，本轮已完成定向修复：历史素材整理记录不再冻结项目的后续合法编辑，取消在清理已知工作区后才记录终态，规划先落外部记录再物化工作区；场景新建、改名、引用改写和删除统一通过窄的本机场景生命周期 authority，在共享项目租约下使用独占发布、文件节点身份与可重放记录，不再由浏览器覆盖式创建或按路径盲删。

场景提交正文会在首次发送前冻结，响应丢失只能原样重放；服务回执、项目路径集和写后磁盘回读全部匹配后才会清理 dirty 与待处理状态。改名目标、引用改写和旧路径删除已进入同一自动备份事务组，成员不全时整组封存，不再恢复成“引用指向不存在新场景”。启动收束上次保存时，恢复协程与原项目、原 client 和 generation 绑定；恢复前页面保持只读，失败则保留原备份，旧协程不能串入新项目，新编辑也不会被磁盘回读覆盖。

本地最终验证为 CLI 聚焦 65/65、CLI 全量 490/490、Editor 全量 640/640、CLI/Editor typecheck 和 build 通过，真实素材导入浏览器流程 26/26 通过，跟踪文件卫生检查通过。Luna 独立只读复核覆盖素材整理、场景事务、流程图入口与启动自动恢复，未留下可复现且存在更安全最小修复的 BLOCKER/HIGH/MEDIUM。Node 公共文件 API 无法对恶意进程在单个系统调用前替换路径提供绝对 CAS，本轮没有虚构这种保证；正常外部编辑和同步竞争已会失败关闭。

提交 `2dfea98` 已普通快进推送到远端 `main`。CI `33634418550` 用时 6 分 58 秒，全仓验证、真实素材导入 authority 浏览器流程和 P1/P2 策略全部通过。既有未跟踪文件和受保护文件均未进入提交；Frontend Pass 8 与主线 Wave 7 未启动。

```text
AUDITED_DATA_SAFETY_REPAIRS = COMPLETE_AND_PUSHED
RELOCATION_HISTORY_AND_CANCEL_ORDER = PASS
SCENE_CREATE_RENAME_DELETE_AUTHORITY = PASS
SCENE_AUTOSAVE_TRANSACTION_RECOVERY = PASS
STARTUP_RECOVERY_PROJECT_ISOLATION = PASS
CLI_FULL = 490/490 PASS
EDITOR_FULL = 640/640 PASS
REAL_BROWSER = 26/26 PASS
FINAL_COMMIT = 2dfea98
REMOTE_CI_33634418550 = PASS
FRONTEND_PASS_8_NOT_STARTED = TRUE
MAINLINE_WAVE_7_NOT_STARTED = TRUE
```

### 9.2 云端接任、事实来源与本次补记边界（2026-09-07）

Owner 德冥已正式委托当前云端 AI 承担 Surdet 长期方案负责人、经理、Architect / Reviewer / Gatekeeper 的实质职责。产品方向仍是第 4.37–4.48 节及后续裁决确定的“双向因果创作台 + 外部 Agent 友好引擎”：外部 Agent 负责智能编排，Surdet 提供低上下文、可发现、类型化、可验证且可恢复的公共创作能力；人类能看懂、决定并继续编辑同一个普通项目。不内置模型、聊天产品或通用 Agent 调度平台，不以《零点之后》的单一项目替代引擎路线。

本次补记使用 Owner 上传的完整原台账，并衔接《SURDET_AGENT_FRIENDLY_CLOUD_HANDOFF_2026-09-05.md》《Surdet_B01_Final_Audit_2026-09-07.md》《Surdet_V4_Independent_Audit_2026-09-07.md》《Surdet_V4_Final_Closure_Audit_2026-09-07.md》及本次对话已明确的授权、设计认可和暂缓决定。相关终审在各自当轮亲读过源码、差异、测试及对应 CI；本次维护复用其有界结论，不宣称又运行了一遍历史测试或完整审核。

本轮只读刷新 GitHub `refs/heads/main`，仍为 `c94601c976ccf804c3fb5d989a94674245031f5f`。这是远端事实；未直接访问 Windows 当前工作树、本地 HEAD、remote-tracking 指针、暂存区、端口、原始 Luna 会话或历史临时目录，不能把它们填成“本轮已独立核实”。原文件第 9.1 的 CLI 490/490 是其本地报告口径；同提交 `33634418550` 的远端日志，按既有云端终审与交接记录为 **489 passed、1 skipped**。两者分开记载，不改写历史本地报告，也不把跳过项说成执行通过。

当前实现边界也继续保留：人类和 Agent 共享领域语义，不等于所有 Editor 写盘已经迁到同一个 authority。场景新建、改名、删除保存批次有其窄本机边界；普通既有正文、时间轴和配置仍应按各自真实调用链判断。Editor 已有的素材 HTTP 能力不自动等于 Agent Port 已公开相应 MCP capability。

### 9.3 B01 指令字段无损写回修复完成并通过独立终审（2026-09-07 补记）

B01 是实际生产 Editor 的局部可靠性修复，不是一次全后端重构。原故障为修改指令字段时丢掉位置等 modifier，以及连续修改多个字段时因捕获旧参数而恢复早先值。正式提交为 `abdb7bad6999dccc013f35a5ce49ea5be3e609c9`，前一基线为 `2dfea98cd17840cfd8239379b98101fc76596059`；普通 push 后完成云端独立终审，结论 **PASS / B01 CLOSED**。

生产变化仅为 `packages/editor/src/instruction-field-source.ts` 与 `packages/editor/src/panels/editor.ts`。实现利用既有共享参数解析和原文片段，只替换被编辑字段，保留无关参数、modifier、引号、缩进、空白与换行；完整表达式不被改成字符串参数。写回保留精确场景与对象身份、行数、原文及行类别校验，仍经原来的 `updateLine → setCurrentText` 和每场景历史，不建立全项目快照或第二套剧本模型。第 29 个用例还覆盖前一行 choice 改变导致当前行重新分类时的旧控件拒绝。

[对应 CI 34099588615](https://github.com/Equinox7379/Surdet/actions/runs/34099588615) 的 verify Job 为 `101670715356`。已读日志记录 Editor 74 个文件 / 684 项通过、Authoring 306 项通过、CLI 489 项通过 / 1 项跳过；Agent 工具与输出合同 11 项已包含在 CLI 中，不另加总。指令写回 Chromium 29/29 及实际输入/焦点检查、既有素材导入浏览器 26/26、类型、构建及策略检查通过。相同模块用例在不同测试环境执行，不包装为翻倍的独立场景。

施工方报告合成项目经隔离文件桥保存重开正确、实际预览显示“分数是 15。”及 Luna 通过；B01 当轮云端未直接取得那次 Windows 运行与 Luna 原始过程，仍按本地报告记载，不冒充当轮远端完整应用验收。后续 V4 的完整应用 CI 是新的独立证据，见第 9.5 节。B01 不再追加施工，也不能因后续前端集成无故重开。

### 9.4 Frontend Pass 7.5 / V4 设计获批与首次正式落地（2026-09-07 补记）

Owner 在独立样稿迭代后明确认可 V4，确定它为本轮 Frontend Pass 7.5 的设计基线。`V4` 是这组设计样稿及落地目标的名称，不是整个引擎版本，不是主线 Wave 4，也不等于 Renderer 的同名历史 API 或前端 Pass 8。旧的“停止网页示意”属于第 4.44 节当时设计阶段的决定，已被本轮 Owner 明确要求制作并批准样稿的指令取代，不得据此否定本轮视觉授权。

批准的剧本主工作面为左侧场景与素材、中央对白原位输入和紧凑演出编排、右侧上方画面与下方当前对象检查器。编排、稿件、源码承接同一份内容和正确场景历史。素材中心保留已认可的三栏关系，空间分析与大文件排行放在统计页；流程、时间轴、配置、预览、审阅、统计和审计继续各自承担真实任务。全部九模式的现有能力、中文入口、对象引用、键盘和窄屏可达性不因视觉清爽而删减。成熟项目只用于观察工作方式，不复制品牌、代码或素材。

正式落地依据云端生产适配与功能保留对照，不以独立 HTML 的示例数据、简化解析、内存服务或独立历史覆盖生产编辑器。人类可视化控件复用 B01、共享 Authoring 及既有保存、素材、配置、审阅和运行器入口。编辑排布与实际运行画面分开表达；不会因静态排布看起来正确就宣布所有分支的运行状态正确，也没有据此批准任意语句精准回放、任意画布拖动或自动配音等新能力。

首次正式落地提交为 `34c73c79273cb31bbe919f5ae010f1347d7f5001`，[CI 34116785667](https://github.com/Equinox7379/Surdet/actions/runs/34116785667) 成功。但云端首次终审保留主体实现与已检查的真实视觉，同时确认 F01 源码新增弹窗草稿丢失、F02 搜索等定位落到隐藏编排行两处缺口，因此当时裁决为 **暂不最终收口**。这两处在云端提供的适配起点也有遗漏，不能全部归责施工方，更不能把首次 CI 绿色改写成当时已经无条件通过。

### 9.5 V4 两项缺口关闭，正式落地 Goal 收口（2026-09-07）

修复提交 `c94601c976ccf804c3fb5d989a94674245031f5f` 是 `34c73c79273cb31bbe919f5ae010f1347d7f5001` 的直接后继，标题为 `fix(editor): preserve source drafts and visible navigation`。实际只改四个文件：`packages/editor/src/v4/script-workbench.ts`、`packages/editor/src/main.ts`、`packages/editor/test/support/v4-workbench-cases.ts`、`packages/editor/e2e/v4-app.e2e.mjs`。没有 CSS、依赖、Core、Authoring、Agent 合同或写盘 authority 的新改动。

**F01 关闭。** 源码视图打开新增弹窗前，先确认当前显示与已接受源文一致，按光标确定插入点并在操作边界刷新隐藏 B01 行绑定。结构操作继续校验当前编辑资格、已知源文、行数、原始行、行类型以及变更期间源文是否变化。只有写回被接受才关闭弹窗；拒绝、异常或无变更时保留草稿，拒绝用例同时确认正文和历史不变。源码编辑与新增可分别撤销，空文档和 choice 完整组插入有对应验证。

**F02 关闭。** 统一跳转仍负责精确场景与共享对象引用，再由 `revealScriptV4Line()` 定位当前可见视图。源码框按原生 textarea 的 LF 和 UTF-16 偏移选中物理行，处理内外滚动；窄屏先显露编辑工作面。编排与稿件继续定位可见行。导航不改正文、不制造历史、不重启预览。旧绑定保护未削弱。

云端终审已亲读实际差异、生产代码和测试，核对[CI 34122728946](https://github.com/Equinox7379/Surdet/actions/runs/34122728946) 的 `head_sha`、checkout 与 verify Job `101744247591`，并读取完整日志和同一次 CI 的页面制品。环境为 Ubuntu 24.04.4、Node 24.20.0、Chromium，不是 Windows 原生运行。本段登记既有终审事实，本次台账更新不重复构建、测试或下载截图。

| 已核实的执行项 | 对应结果及边界 |
| --- | --- |
| Editor Vitest | 75 个文件 / 716 项通过，不等于 716 条完整应用浏览器路径。 |
| B01 Chromium | 29/29，原写回与输入/焦点回归继续成立。 |
| V4 生产模块 Chromium | 35/35，原 27 项与新增 8 项均保留。 |
| 素材导入 authority 浏览器 | 26/26，完成至进程清理。 |
| 完整应用操作链 | 表情/位置修改、原保存入口、隔离文件桥重开、真实运行器“分数是 15。”插值；另含源码修改、光标插入、真实搜索结果点击、精确选中和两次独立撤销。 |
| 工作面与输入 | 九模式在 1792×900、1280×800、390×844 下的既有检查，以及 960px 目录、移动面板、长对白与合成 composition 检查通过。 |
| CLI 与综合检查 | CLI 489 passed / 1 skipped；Verify all 与 P1/P2 policy 执行成功。不同层级不重复加总。 |

同提交 `surdet-v4-ui` 制品 `10019041970` 的三张实际截图为 1792×900 的剧本、素材、配置常规页面，云端已查看并保留 V4 视觉结论。它们不是源码选中或窄屏截图；长行窄可视区定位由 Chromium 生产模块坐标断言支持，完整应用搜索链在桌面尺寸执行，不能扩大为所有设备、字体或缩放组合实测。合成输入事件不等于原生中文输入法，文件桥也不等于原生目录选择器。

最终裁决为 **PASS / F01 CLOSED / F02 CLOSED / FRONTEND PASS 7.5 V4 GOAL CLOSED**，撤销第 9.4 节当时的暂不收口状态。V4 与 B01 无当前已确认、需要继续阻断的遗留项，不重做九页或反复补门。Owner 的设计认可、云端对实际页面的判断、施工方本地/Luna 报告、真实 CI 和尚未实测项继续分开记录，不倒填为 Owner 已亲自操作全部生产场景。通过范围是已约定的 V4 Goal，不是整个引擎或全部前端计划完成。

<a id="current-cooperation"></a>

### 9.6 当前协作、证据与权限口径（2026-09-07 登记，2026-09-11 更新）

本节将 Owner 后续明确的云端优先协同要求接回同一本台账。它更新早期角色、流程与默认授权的适用方式，不回写旧记录曾发生的事实，也不取消已有产品语义与安全边界。

**Owner 与云端职责。** Owner 保留产品方向、重大取舍、阶段转换、视觉/声音/手感及发布的最终决定权。云端承担长期方案负责人、主要设计/实现准备者与远端独立审核者职责；云端能可靠完成的研究、源码分析、信息架构、视觉方案、关键代码、补丁、测试和验收判断先由云端完成，不能以本地更方便为由整体下放。本机私有数据、Windows 环境、真实工作区及凭据、实际 commit 与获准 push 等客观需要本地条件的剩余工作，才交施工 AI。

**独立判断。** 技术判断以 Owner 真实目标、项目既有契约和当前源码、数据及运行事实为准。云端任务书、整改包和评审意见可能遗漏；本地执行者仍须独立核对相关调用方和实际行为，在同一已授权目标内主动修正不符合项目事实的方案，不把自身职责限制为机械落盘。Owner 明确设定的范围、只读要求和外部动作授权继续有效。

**完整 Goal。** 新施工任务书须写入 Owner 当前要求的完整 Goal 持续授权约定，说明目标、允许与禁止范围、云端已完成工作、本地剩余工作的客观原因、Git 权限与完成标准。普通编译、类型、测试、CI、选择器、夹具、路径、旧测试同步及同目标遗漏由施工 AI 在同一 Goal 内诊断、修复、验证和收口，不再采用首红即停、每次小修重新授权、单次提交上限或僵硬文件白名单。必要的重大产品选择仍可先确认；新增依赖、公共接口、架构边界、部署范围或影响其他项目时先判断是否超出 Goal。真正停止条件是原始数据可能受损、密钥或隐私可能泄露、无关程序可能被伤害、必须执行不可逆操作、远端冲突无法安全处理或必要权限客观缺失。

**权限按本轮区分。** 纯审核默认只读，不写仓库、不提交、不推送、不合并、不发布、不改设置。已明确授权施工 Goal 的正常 commit 和普通 push 可在该目标内持续执行，不逐次向 Owner 申请；但 B01、V4 或其他历史任务的权限不自动覆盖新目标。Surdet 的 `change.commit` 仍只是领域项目写回，不是 Git commit，更不授予 Agent Git/push 权限。人类决定与批准回执也不能由 Agent 自签。

**Luna 与独立复核。** 按当前 AGENTS，本地审核、复核、验收和质量判断由主代理亲自完成，不派 Luna 审核或收口。Luna 仅可承担边界明确、确实节省时间的独立并行执行任务，且不得再创建子代理；历史 Q24 的专项例外不推广为长期授权。云端读取远端真实代码、差异、测试和 exact-head CI，必要时读实际页面；施工报告不替代这些事实，也不能扮演另一个身份伪造独立审查。历史角色名称不累加为当前必经委员会。

**适度工程化与有界审核。** 正常 diff、一次相关验证、必要的单份备份、普通 commit/push 可以使用；默认不要求文件哈希、Manifest、证据 ZIP、Git Bundle、双 Worktree、多层提交重建、重复全量门禁、复杂分支和无关平台改造。额外保障仅在直接降低当前真实风险且收益大于维护成本时采用。引擎既有 fingerprints、lease、CAS、journal、capsule、精确引用和回执属于产品边界，不能因工作流精简而无依据删除。没有新证据不重开已关闭 finding；日志警告、历史猜测或未覆盖事项不自动升级为产品阻断。

**沟通与记录。** 先给结论，用自然中文说明重要依据和下一步。云端主动维护路线及有界审核结论，施工方维护必要执行事实；Owner 不负责跑终端、整理证据、比较代码或盯 CI。施工结束只需简短告知实际完成、提交、CI 与客观未实测项，云端自行读取后复核。台账只追加重要批准、否决、收口、范围或暂停变化，不记录每次无实质变化的对话，也不为维护而制造额外文档提交。

本节明确取代旧文中不一致的操作要求：第 2.0 的逐项子代理许可、第 2.3 与 4.17 的默认提交即停、第 4.12 的每次维护强制哈希、第 4.100–4.102 的固定历史角色链及其 push 节奏，以及其他旧任务的普通失败停止与窄白名单。第 8.18 强制 Luna 满载早已撤销；协作以当前 AGENTS 和 Owner 明确要求为准。执行者不得自行裁决产品路线，但可依授权维护真实进度；台账默认不入 Git 的旧约定已由第 9.21 节的明确授权取代。最新 Owner 明确指令仍可改变上述安排。

### 9.7 验证暂缓、前端路线衔接与未授权范围（2026-09-07）

Owner 已明确决定：**Windows 原生目录选择器与真实中文输入法暂时不测，以后再说。** 两项状态为“未实测 / Owner 暂缓”，不是通过，也不是当前活动阻断。不据此拖住 B01 或 V4 收口，不在下一份常规任务中再次催测；将来由 Owner 重启，或新目标确实触及相应输入/文件入口并需要新的取舍时，再明确是否恢复验证。

本次完成的是 Frontend Pass 7.5 / V4 Editor 九工作面，不是整个前端支线。第 8.30 已确定后续方向为 **Frontend Pass 8：Renderer 玩家界面与主题边界**；接续时先核对当前源码、真实玩家页面与该目标的实际差距，保留已具备的能力和已通过的回归，不从零重造玩家界面。编辑器能运行预览，不等于 ADV/NVL、菜单、历史、设置、画廊及加载等玩家侧界面已经完成本轮视觉迁移。

原前端总计划 `docs/superpowers/plans/2026-08-30-surdet-frontend-editorial-workbench-redesign.md` 后续还列有 Pass 9 的 Host/Shell 消费端回归与 Pass 10 的一致性、可访问性及整体收口。其具体条目以新任务时的实际源码、既有证据和明确目标核对；本次只登记该文档的既有路线，不宣称它们已开始或全部未实现，也不因旧复选框未勾而机械追加重复测试。旧计划的施工限制不压过第 9.6 节与未来当轮 Goal。

云端此前提出“先做一部短篇作为下一阶段”的建议没有取得 Owner 对替代路线的批准，且已经在用户追问后纠正。早期 Wave 1、Wave 5 已有短章与外部 Agent/人类接手的相关验证，不能把它们当作从未发生。作品以后可以成为新的创作目标或必要验证，但当前不替换前端路线，不顺手修改正式《零点之后》或解除音频生产冻结。

主线仍在 **Stage 6 Wave 6 之后、Wave 7 之前**；Wave 7 未设计、未授权、未开始。音频资产生产仍冻结，性能在真实可复现问题出现时再评估，发行、Legacy 和大规模文档治理仍不插队；这次单文件台账维护不是仓库大整理。插件市场、云同步、通用 Agent 平台、跨主机自动接管、公开 SDK 扩张和新发行链均没有从 B01/V4 通过中取得授权。**当前这次请求只授权台账修订，不是 Pass 8 生产开工指令。**

<a id="current-state"></a>

### 9.8 唯一当前事实快照与停止点（2026-09-14）

此处是页首与第 6.1 节共同指向的当前窗口。旧记录用于理解历史，不覆盖本节。台账版本由本文件所在 Git 提交确定；下表的代码与 CI 基线不因后续纯文档提交而自动改写。读取更新后的 main 时，应核对实际新增差异，不把既有 PASS 自动盖到未知提交上。

| 项目 | 当前已知事实与边界 |
| --- | --- |
| 活动仓库 / 分支 | `Equinox7379/Surdet` / `main`。 |
| 本轮开工时已核实的实现基线 | Wave 14 开工时本地与远端 main 均为 `c891d00c1f6933280b504490b2103e94d8762a23`；tracked 工作树干净，既有未跟踪材料保留。九月托管 CI 暂停，既有结果按各自范围保留。 |
| 最后云端与 Owner 验收 | Owner 最新转交云端对 `c891d00 → 0be2425 → 48275c9` 的复核：Wave 14 主体成立，public 素材观测遗漏需补齐，尚未最终 PASS。本地已完成该处修复和相关验证，等待补修独立复核。Wave 13、此前维护与 Wave 11 / Wave 12 已通过结论及 Wave 10 的 Owner 体验通过保留；其余未发生的 Owner 体验不代签，也不作为开发停止点。 |
| 对应已核实 CI | `fd1fc6e` 的完整 CI 已通过。来源修复 `744b18c` 的 [run 34684432841](https://github.com/Equinox7379/Surdet/actions/runs/34684432841) 中，Electron、全量检查、资源导入、实际 Editor 预览与 Starter 回归通过，Pass 8 因测试过早读取尚未就绪的战斗画布而失败。`a09190d` 的定向修正已通过本地完整 Pass 8。Owner 明确本月暂停 CI；仓库 CI 工作流已核实为 `disabled_manually`，普通推送继续交付代码，旧 CI 失败记录保留。详情统一见 Wave 9 Execution Ledger。 |
| 既有数据安全修复 | 第 9.1 节五项修复继续关闭；A5 等已关闭历史不恢复成活动 finding。 |
| B01 | `abdb7ba` 已推送并通过终审，不重开。 |
| Editor 前端 | Pass 1–7 既有迁移保留；Pass 7.5 / V4 已批准并完成正式落地。 |
| V4 设计基线 | 九工作面与可视化混合编排保留；不无故重开风格探索或丢弃原有业务能力。 |
| 整个前端路线 | Frontend Pass 1–10 已由本轮收到的云端终审裁决关闭；B01、V4、F01/F02 保持关闭。另行暂停的按钮改版不因此获得认可或重启。 |
| 当前活动目标 | Wave 14 真实预览观测与定点返修的 public 素材补修：依据已有两个素材根补齐发布与目录事实检查。范围、实现及验证统一见 [Wave 14 执行记录](2026-09-13-wave14-preview-observation.md)。场景指令原位替换保留为后续建议，本轮不启动。 |
| 主线阶段 | Wave 14 实现 `0be2425` 及授权记录已推送至 `48275c9`。本次 public 补修已完成：预览观测测试整份 7 项、Authoring / CLI 类型检查和构建、public 背景与立绘真实浏览器发布均通过；按本轮授权普通推送后待定向复核。具体首红和证据边界见 [Wave 14 执行记录](2026-09-13-wave14-preview-observation.md)。Wave 13 及已关闭维护成果保留，不重开全仓维护、Q1 或旧整套验收。 |
| 暂缓验证 | 原生 Windows 目录选择器、真实中文输入法均未实测，由 Owner 暂缓，不作为当前门槛。 |
| 已解决问题与保留边界 | Wave 9 已接通整案 / 混合选择、三源事实与封存最终正文、保存前只读权威预览、v2 回执、正式计划及实际结果说明；旧 v1 可读取。Q1 的历史协助过程保留；新的独立候选与 Owner 选案反馈见本轮任务书。原生目录选择器与中文输入法的暂缓范围没有改变。 |
| 本机状态 | `E:\surdet` / `main`；Wave 14 复用现有依赖与服务脚本，测试项目放在 D 盘。主代理负责实现、整合、检查、视觉判断与 Git，Luna 只执行有界独立内容返修。既有未跟踪资料和受保护文件保留；实际本地提交以 Git 为准。Wave 11 原窗口草稿未能读取的限制保留。 |
| 当前授权与停止点 | Owner 要求核实 Wave 14 方向后开工，并于 2026-09-14 本地交付后明确追加“推送”；本轮普通实现、相关验证、提交和 push 均已获授权，不改写历史。推送后停止等待独立复核，不安排 Owner 人工验收，不代签体验或云端终审。九月 CI 继续暂停；无音频、发行、界面重做、截图服务器、新运行器、回想/成就接口或下一波。 |
| 台账交付状态 | 本文件纳入仓库版本控制，后续云端与本地读取同一路径。旧的 local-only、未跟踪和禁止提交表述保留为历史事实，不再作为本台账的当前限制。 |

Wave 8 的实现、fresh Agent 边界、逐次云端整改及 Electron CI 修复统一见 [Wave 8 交付报告](../../SURDET-CANDIDATE-COMPOSITION-READINESS-STAGE-6-WAVE-8-DELIVERY-REPORT-2026-09-10.md)。第 9.20 节的 Q1 过程与当时停止点保留为历史；Wave 9 结果以任务书 Execution Ledger 为准。Wave 13 与仓库维护已关闭，Wave 14 的当前执行事实按上表链接续接。

### 9.9 本次修订方式、本机同步与后续维护

> 本节记录 2026-09-07 的同步约定。其机械落盘限制随后由第 9.10 节与当前协作口径更新；本台账不入 Git 的限制已由第 9.21 节 Owner 明确授权取代。下文保留当时事实。

Owner 本轮明确要求由云端修改台账。本次交付是原 `2026-08-13-project-roadmap-and-decision-ledger.md` 的完整修订副本，不是第二本权威台账。原 3,334 行中的历史条目正文、旧结果和限制保留；只调整过时的页首与章级入口、归档原停止点，并增加有日期的适用说明和第 9.2–9.9 节补记。没有把历史 FAILED 改成 PASSED，没有把旧“未推送”抹成从未存在，也没有把后续 Owner 设计认可倒填为早期各轮人工实测。

第 8.16 后两条不同远端快照的排列歧义继续视为历史记录问题。本次没有重新查证那两个旧提交的祖先关系，不据文档排布推断 Git 曾倒退、误推或发生数据事故，也不编造修订后的历史时间线。当前远端身份以第 9.8 节本次真实读取为准。文件内历史哈希、路径和制品记录保留原样，不要求为这次维护重新访问旧临时目录、核验历史哈希或生成证据包。

本机唯一目标路径仍为 `E:\surdet\docs\superpowers\plans\2026-08-13-project-roadmap-and-decision-ledger.md`。Owner 把本修订稿交给施工 AI 要求同步时，执行者只负责把云端确定的完整文本落到同一路径，不自行另改产品路线、扩大授权或创建另一份长期台账；这不与第 4.18 禁止其自行裁决路线的边界冲突。若本机已出现本上传版本没有的新条目，先保留这些内容，不能盲目覆盖；能证明不冲突的追加可保留，存在路线或状态冲突则由云端合并判断，不要求 Owner 手工比较。

本次同步不修改 `AGENTS.md`、`USER.md`、交接书、其他项目、生产源码、测试或 CI；不把台账加入 Git，不新建 commit、push、merge 或 release，也不为纯文档落盘运行整仓构建和测试。若本机文件实际已被跟踪，不用 `git rm`、改史或忽略规则去“恢复未跟踪”；保留现场并说明与约定的差异。本地同步完成之前，不能声称云端已经修改 Windows 文件。原上传件在当前对话中保留，修订副本与之分开存放仅为交付，不建立并行权威来源。

今后实质变更先写入这一本台账，再更新第 9.8 节当前窗口及必要入口；一般新增事实可另接第 9.10 节及后续条目。云端负责内容与有界裁决，只有确实需要本机写入时才交执行者机械同步。无新事实不机械加条目，不重复粘贴完整报告，不为台账制造提交后再提交的收口循环。原文件、现行合作约定和后续用户指令不一致时，由云端明确标注差异后修订，不能静默替换来源。

### 9.10 长期台账维护职责调整与 Frontend Pass 8 接续（2026-09-08）

Owner 本轮明确要求新施工 AI 接替前任，先读附件五份交接文件、适用 AGENTS 与原台账，并直接继续 Frontend Pass 8。执行主代理负责本机同一本台账的真实进度维护；此授权取代第 4.18 与第 9.9 中只准经理写入或执行者仅机械同步的旧限制，不授予产品路线裁决、云端终审或 Owner 人工验收签字权。

B01、Editor V4、F01/F02 已关闭，不重做；Windows 原生目录选择器与真实中文输入法维持“未实测 / Owner 暂缓”。本轮固定方案来自 `Surdet_Pass8_New_Operator_Package_2026-09-07.zip`：保留原 RendererRuntime、Host/Shell 存读档及项目主题覆盖，完成 ADV/NVL、选项、菜单、历史、存读档、设置、系统面板、画廊和加载的活动层适配；不启动主线 Wave 7。

开工亲读本机 `main` / `c94601c976ccf804c3fb5d989a94674245031f5f` 和 remote URL，已跟踪文件及暂存区无改动，台账未跟踪。附件补丁程序自测 9/9，`--check` 匹配现行主题，尚未代表生产适配、完整回归或真实页面通过。当前状态为“开工 / 实施中 / 待云端复核”。普通编译、夹具、测试及 CI 问题在同一 Goal 内解决；已授权普通提交与推送，禁止改史、合并、发布、部署。

本轮中途 Owner 明确要求“这次不要用 luna 子代理了，用你的 astra 子代理，开最高”。已停用本轮 Luna，改用 `gpt-6-astra` / `ultra`；这是仅本轮明确覆盖原 Luna-only 约定，不改写历史复核身份。独立复核与云端终审仍分别记录。

随后 Owner 在额度重置后明确要求继续同一目标、保留上下文，并恢复“以后只能调用 luna 子代理”。Astra 已停止，保留它中断前的未完成改动，由 Luna 接续 gallery/system/loading 的有界实施；本轮最终独立复核使用未参与实施的 Luna。先前 Astra 中间工作不冒充已完成的 Luna 复核或云端终审。

### 9.11 Frontend Pass 8 本机实现与有界验证（2026-09-08）

实际改动落在 Renderer 活动 Dialogue/Menu/Gallery/SystemPanel/Loading 层、主题及 Stage 的内置 Pixi 可访问性接线，另补 Starter 既有 backlog 关闭回调和存档列表失败提示。保留同一 RendererRuntime、解释器、Host/Shell 存读档、原选择索引、项目主题输入和生命周期；没有用参考 HTML 或新运行器替代生产路径。设置沿用真实的即时步进回调，存档覆盖/备份恢复用取消优先确认后调用原事务入口；没有捏造不存在的设置暂存、音乐条目或恢复 API。

本机完整 Renderer 回归为 54 文件 / 438 项通过；之后发现 NVL mask 在尚无文本引用时被画为白块，已建立真实红灯并改为永久文本容器持有遮罩，受影响对白/NVL 3 文件 / 24 项（含新增 1 项）通过。修后 Renderer typecheck/build 通过；Starter typecheck 与相关 Host/Shell 7 文件 / 81 项通过。旧失败输出不改写为通过，最终全部计数以本次提交 CI 为准。

真实 Chromium 使用原 Starter 入口、解释器及 UI，隔离 FileSaveStore 文件桥完成保存、零写入取消、覆盖、读取原位置与受控损坏拒绝；指针、键盘与模拟 GamepadPoller 选择到同一真实分支。实际 ADV/NVL、超长文字滚动且解释器位置不变、菜单快捷键隔离、操作带聚焦时 F5 原快捷键、设置即时持久化、历史搜索/退出、画廊锁定与返回、商店购买/禁用、地图/据点/战斗路径通过。视口 1440×900、1280×720、800×600 及真实 Chromium 200% 页面缩放通过。测试使用临时 scenario/theme 输入，未覆盖原项目内容或用户存档；损坏案例只产生预期的 3 条错误报告。重绘后等待当前可访问节点及休息成功消息，避免旧 DOM 池节点被测试提前操作。

三张最新实际截图位于 `D:\CodexTasks\surdet-pass8-20260908\01-reading.png`、`02-settings.png`、`03-save-load.png`，主代理检查真实截图并修复了前述白块；参考样稿不算生产证据。CI 新增同一玩家 E2E 并保留这三张截图，原 Verify all、素材导入、B01/V4 与策略步骤保持。相对输出路径已统一解析为绝对路径，避免 CI 下 Chromium 扩展路径失效。

未参与实现的 Luna 独立复核发现并复核关闭了非 modal 吞 F5 快捷键、菜单相同数值字号错误归类及面板透明度不重绘两项问题；另独立检查并测试 NVL 遮罩修正 24/24，无该范围阻断。Luna 64 项定向测试与 build 通过，不冒充其另开浏览器或云端终审。普通主题覆盖已验证；极端 `uiSize=100` 的系统菜单自动重排未验证，当前固定行高不支持该极端排版保证。

本轮未测真实硬件手柄、原生 Electron 文件对话框/目录选择器或真实中文输入法，后两项维持 Owner 暂缓。FileSaveStore 桥不等于 Electron IPC 真机验证；本地视觉不等于 Owner 最终手感或云端终审。B01/V4/F01/F02 继续关闭，不扩大到下一主题；终审状态为 **待云端独立终审**。

已按授权普通提交并推送 `b408fd34df6d097a76752c48c190823954a826b3`（24 文件，活动玩家层、测试与 CI）。首轮 CI `34181011096` 的既有全仓及浏览器步骤通过，新增玩家步骤因干净 checkout 未生成 `packages/shell/dist/save-store.js` 而失败；真实失败保留。当前全仓脚本不构建 Shell，因此补充明确前置 `npm run build -w @surdet/shell`，本机构建通过，Luna 独立确认前置顺序与原有检查保留。修正仅为 CI 一文件，普通提交/推送 `13c07b19272f91cb496a20d01eb7f13097bbc467`；远端 HEAD 已核实一致。新 CI `34181420605` / verify Job `101921132485` 正在执行，最终结果待此处更新。台账、截图、日志、附件和原有未跟踪内容均未加入提交。

随后 CI `34181420605` 全仓、既有浏览器和策略步骤通过，玩家步骤运行三分多钟尚未结束，主代理为取日志将其取消。取消后的日志表明文件存档/选择与 NVL/设置已陆续通过，不能把它定性为已证实的死锁或产品失败；主代理此前停止偏早。该次 Renderer 为 54 文件 / 439 项通过。新增的独立 Playwright 测试缺少总体等待边界，因此提交 `7d3a88f841cefd30d69fe8febe1c557d9c56ffb5` 只增加每操作/导航 60 秒及 CI 玩家步骤 15 分钟上限，全部行为断言保留。本机完整 E2E 再次通过，普通推送后新 CI `34182090646` 正在核实；本轮不靠反复取消或无限等待宣称通过。

**最终实际结果：本轮施工完成，待云端独立终审。** `7d3a88f841cefd30d69fe8febe1c557d9c56ffb5` 的 CI `34182090646` / verify Job `101923064998` 全部成功；已亲读 checkout SHA、完整日志与结果。Renderer 54 文件 / **439 项通过**；Verify all、既有素材导入/B01/V4 完整应用、策略检查和新增 Pass 8 玩家路径全部成功。玩家步骤约 6 分 8 秒完成，日志逐项证实真实文件存读档、零写入取消、受控损坏拒绝、原分支输入一致性、ADV/NVL/历史/设置/画廊、三视口、真实 Chromium 200% 缩放、项目主题、系统面板及长文滚动不推进解释器，末行真实写入数为 3。手柄仍为模拟 GamepadPoller，文件桥仍非原生 Electron 选择器；不扩大验证层级。

同次 CI `surdet-pass8-player` 制品 `10039485989` 成功上传且日志明确 3 个文件，分别为阅读、设置、存读档；可由云端在[本次 CI](https://github.com/Equinox7379/Surdet/actions/runs/34182090646)独立取得。主代理已查看本机最新三图，以及前次同生产源码 Linux CI 的阅读图；没有宣称另行下载查看本次最终制品的全部图片。Luna 最后复核确认新增四行时间上限不削弱断言。最终本机与远端 HEAD 一致，已跟踪工作树和暂存区无改动，原台账及既有未跟踪文件保留。三次均为普通 commit/push，无改史、merge、发布或部署；不代签云端终审，不重开 B01/V4/F01/F02，不启动下一主题。

### 9.12 Owner 认可、本地预览与目标更正（2026-09-08）

Owner 回复“pass”，并明确要求本地部署供其查看。已基于同一 `7d3a88f` 重新构建原 Starter 玩家，构建通过；使用原内容与运行器，不注入 E2E 场景或文件桥。构建预览服务监听 `127.0.0.1:4173`，启动时 PID `72540`，HTTP 200、页面标题 `Surdet Starter` 已核实，保留服务供 Owner 体验。日志位于 `D:\CodexTasks\surdet-pass8-20260908\local-preview-20260908-120102.out.log` 及对应 `.err.log`。本条记录 Owner 的明确认可和本机预览授权，不补造云端独立审核过程或 Owner 尚未进行的交互验收；无新的源码修改、commit/push 或公网部署。

Owner 随后明确更正：要看的是**剧情编辑器**。前段启动 Starter 是执行者理解错误，不能当成 Owner 对玩家预览的指定。已按现有编辑器 Action 启动 `surdet-editor`，地址 `http://127.0.0.1:5173/`；实际浏览器标签已从 Starter 切换为“Surdet 剧本编辑器”，可见项目命令、剧本/素材/流程/时间轴/配置等工作区，当前未打开项目。仅停止本任务创建的旧 4173 玩家服务，保留编辑器供 Owner 操作；未修改源码或替用户选择、修改项目。

### 9.13 Pass 8 云端 PASS 与 Pass 9 Windows 消费验证（2026-09-08）

Owner 本轮明确转达 Pass 8 云端独立终审 PASS，并授权执行附件 `Surdet_Pass9_Host_Shell_Consumer_Goal_2026-09-08.zip` 的完整 Goal。通过基线为 `7d3a88f841cefd30d69fe8febe1c557d9c56ffb5`，对应 CI `34182090646`；本机 HEAD 与新鲜 `ls-remote` 均相同，已跟踪文件与暂存区无改动，既有未跟踪内容保留。前文 Pass 8“待终审”是历史状态，不重开 B01/V4/F01/F02。

Pass 9 只核对原 Host PlayerShell、Electron Shell、preload IPC、FileSaveStore 与正式《零点之后》dist 的消费链。默认 Host/Shell 生产不改；云端候选只修改既有 A–F runner 的 Case F 主题断言、增加同一 userData 真实关闭重开读档 Case G、一个 package script 和一个永久合同测试。普通缺口在同一 Goal 内处理，正常 commit 与普通 push 已批准；台账仍不进 Git，不代签 Pass 9 云端终审。原生目录选择器、真实中文输入法继续暂缓，不要求 Owner 人工补测。

开工五组既有消费测试已实际通过：5 文件 / 64 项。候选包预审发现追加 Case G 后聚合计数仍按六项比较，会导致 7 项全绿仍误报失败，应用时按真实 Case 数最小修正；尚未宣称候选补丁或 Windows Electron 路径通过。附件、日志、截图、临时 userData 均放 D 盘任务目录，不提交。

**本地实施与验证已完成。** 实际只修改 `packages/shell/e2e/player-shell-wave-3.e2e.mjs`、`packages/shell/package.json`，新增 `packages/shell/test/frontend-pass9-electron-contract.test.ts`。Case F 从当前运行项目捕获默认主题再恢复，保留碰撞色与资源断言；Case G 走正式游戏控件、原 Host PlayerShell、Shell preload IPC 与 FileSaveStore，不提前伪造存档。补齐候选 harness 的真实进程退出等待、关闭失败传播、关闭阶段错误审计和七项聚合计数；失败证据保留。没有修改 Host/Shell 或其他层生产代码，没有修改 Starter、模板、正式作品内容、格式、依赖或发布链。

本机验证：五组原消费合同 5 文件 / 64 项通过；Host 全部测试 11 文件 / 87 项、Shell 全部测试 23 文件 / 200 项通过，新增永久合同测试实际收集 5 项（含执行真实关闭函数的异常/退出行为测试）；Host/Shell typecheck 通过。Core、Renderer、Host、Shell 与《零点之后》构建通过。最终 G 保存点加强后新增合同 5 项复测通过，Windows Electron A–G 最终 7/7 通过；此前两轮 A–G 亦通过且证据保留，最后一轮用于核验非初始保存点及实际槽位文件，不把旧轮结果冒充最终实现。

最终 Windows Electron 证据：`D:\CodexTasks\surdet-pass9-20260908\temp\surdet-player-shell-wave-3-4c4gKG\task7-player-shell-wave-3-matrix.json`；各例真实加载正式《零点之后》48 项资产。G 初始位置 `prologue:7 / ebffa63a`，真实鼠标推进后保存位置、磁盘槽位 `meta.id=1` 及第二进程读回位置均为 `prologue:8 / ebffa63a`。第一进程 PID `73548` 完整退出后才启动 PID `14032`，两者 `app.getPath('userData')` 相同、各一个窗口，均 `exitCode=0`；标题“读取存档”与槽位按钮通过可访问 DOM 的 Enter 各激活一次，默认六槽无 override、单画布、返回栈清空，设置经系统菜单返回游戏。两会话 page/console/request/unhandled/release/异常关闭错误为空。截图与全部临时存档留在该 D 盘目录；主代理已查看实际截图。原 renderer 输入消费测试与真实 DOM 激活证据共同核对单次消费，不把 DOM 点击计数冒充 IPC 调用计数。

Luna 使用 `luna_worker` 独立读取原源码、实际 diff 与本机证据，完成主审和最后非初始保存点/实际落盘增量补审，结论无阻断；Luna 未代跑 Windows Electron、未改文件、未处理 Git。主代理亲自核对源码、结果及范围，按授权创建普通提交 `434c8da43e645e7e8bdd4b2035081cc1017e7868`（`test(shell): verify Pass 8 desktop consumers`）并普通 push 至 `surdet/main`。对应 CI `34190136367` / verify Job `101946336167` 于 2026-09-08 13:38（北京时间）全部成功；head_sha 与 checkout 精确一致。完整日志保存于 `D:\CodexTasks\surdet-pass9-20260908\ci-34190136367.log`，已亲读新增合同 5 项、Host 87 项、Shell 200 项、全部 Editor 浏览器步骤及最后 Pass 8 玩家回归成功。玩家步骤实际耗时约 11 分 18 秒，本轮正常等待完成，没有取消或盲目重跑。CI 成功后远端 SHA 再次核实相同，8 个本轮 Electron 进程均不再存活，已跟踪工作树与暂存区无改动。

本轮真实 Electron IPC 已验证；真实中文输入法与原生目录选择器继续由 Owner 暂缓，物理手柄未实测。没有打包、发布、部署或启动 Pass 10/Wave 7。**Pass 9 本地 Goal 完成，当前停止在待云端独立终审**；没有代签云端 PASS 或 Owner 体验通过，台账保持本机未跟踪、未暂存、未提交。

### 9.14 Pass 9 云端关闭与 Pass 10 开工（2026-09-08）

Owner 提供 `Surdet_Frontend_Pass10_Construction_Package_2026-09-08.zip` 并明确“开工”。包内云端裁决载明已独立读取 Pass 9 远端源码、实际三文件 diff、永久合同与 exact-head CI，结论 `PASS_9_CLOUD_INDEPENDENT_REVIEW_PASSED` / `FRONTEND_PASS_9_CLOSED`。本机已重新核实 `main`、remote `surdet` URL、HEAD 与 fetch 后远端均为 `434c8da43e645e7e8bdd4b2035081cc1017e7868`，ahead/behind 为 0/0；已跟踪工作树与暂存区无改动，既有未跟踪内容保留。

Pass 10 目标固定为删除 Editor `src/styles.css` 旧兼容主题与入口，迁移仍活动的最小结构规则，完成九模式四视口、键盘/焦点/内容压力/真实 200% 浏览器 zoom 与有界最终回归。Renderer 生产默认不改，只有直接真实 finding 才修并补本地 Pass 8 与 Windows A–G；Host/Shell 生产不改。已授权普通 commit/push 与 CI 红灯同 Goal 闭合；Luna 不参与实现，在最终独立复核。原生目录选择器、真实中文输入法、物理手柄和 Windows 系统 DPI 切换仍未实测/不在本轮门槛。禁止扩展 Starter/模板、Authoring/Core/CLI/格式/依赖/正式内容、主线 Wave 7、音频、打包发布部署。台账不进 Git，当前 `FRONTEND_PASS_10_IN_PROGRESS`。

生产前永久合同形成 2 项预期 RED（旧文件/旧 token），随后三合同 16 项及扩展的 12 文件 / 100 项 GREEN。通过源码消费者与九模式禁用旧样式前后的 computed style 对照，确认主列 flex、搜索、共享空状态、素材悬浮预览与部分时间轴控件仍依赖旧层；必要规则迁入原 app-shell/components/script/timeline 语义层。场景/步骤旧卡片等已被迁移规则取代；`.cfg-table` 无生产 TypeScript 消费者，直接删除。旧 `src/styles.css` 文件与 HTML 入口均移除，未新建兼容层或新增 `!important`，Renderer/Host/Shell 及业务 TypeScript 未改。

真实 built Editor 已通过九模式四视口、原保存/重开/预览、源码编辑/插入/搜索/独立撤销、modal Space/Tab/Escape 与焦点恢复、窄屏面板、长中文/路径、invalid JSON、图像 loading/ready/error、错误文字与禁用预览、reduced-motion。本机可见 Chromium 的实际 `chrome.tabs.setZoom(2)` 从 1792×1000 / DPR≈1 变为 896×500 / DPR≈2，剧本、素材、审阅可操作；初次缩放断言因浮点 DPR 严格等于 2 而超时，已按同比与小容差核验真实结果，不使用 page-scale。截图又暴露列表缩略图错误文字越界到上一行，新增真实位置断言 RED 后，以 asset-center 局部样式约束，定向 GREEN。新增测试最初对空项目撤销禁用、aria-controls 必须指向外 wrapper 的错误假设已按原合同纠正，未为迎合测试改业务行为。

Host/Shell 六组消费测试 6 文件 / 69 项通过，V4 mounted module 35/35 加真实输入焦点通过。首次聚合运行在 Authoring worker 出现 `ERR_IPC_CHANNEL_CLOSED`；当时本机为 16GB/32 逻辑 CPU、可用物理内存不足 1GB。单 worker 定向 Authoring 34 文件 / 306 项通过，因此仅在任务进程限制 Vitest fork/thread 并发。随后完整日志还确认 Editor 的 `editor-action-scope-contract.test.ts` 在收集时无条件读取已删除的 legacy 文件而 ENOENT；此前“其余全部通过”的中间判断不成立。该测试已改读实际 review/V4 语义样式，保留 workspace 动作不能 fixed/sticky/bottom/inset 的原断言；与最终样式合同 2 文件 / 10 项 GREEN。原失败日志保留，当前不提前登记聚合成功。Luna 已完成源码独立复核无确认阻断，未参与实现；提交、push、CI 与最终截图复核尚待收口。

最终页面又通过预览截图定位 Editor `preview.html` 的根 padding 使按 iframe viewport 适配的 canvas 底部被裁切；增加真实四边界 RED 后，仅移除该内边距，定向及四视口最终 GREEN。`v4-final-preview-settled.log` 为最终完整浏览器成功结果，保留原业务链、画布边界、九模式四尺寸与可见 200% zoom。六张最终图已刷新并由主代理与 Luna 检查；素材占位越界和预览裁切均关闭。素材导入浏览器 26/26 PASS；Luna 对完整源码、两处视觉修复、测试读取源与最终图片补审无确认阻断，未代跑测试/浏览器。

最终 `npm run verify:all` 已全部通过，日志 `D:\CodexTasks\surdet-pass10-20260908\verify-all-final.log`：Editor 76 文件 / 721 项、Renderer 54 / 439、Host 11 / 87、Shell 23 / 200；所含工作区 typecheck、Renderer/Host/Editor build 与根门禁均通过，Shell build 另行通过。前两次失败后的第三次为最终成功运行，未重复已成功的最终聚合。生产改动仍仅 Editor CSS/HTML，Renderer/Host/Shell 及业务 TypeScript 无变化；不本地重复 Pass 9 A–G。报告、前端 Task 10/Execution Ledger 与索引已按真实结果更新。当前进入普通提交/push/对应 CI，尚不登记云端 PASS。

Luna 最终文档/门禁补审无阻断，确认计数、前两次失败与第三次成功、实际范围和未测项一致。主代理核对暂存集只有 16 个本轮文件，仓库卫生检查 941 路径通过、暂存/未暂存 diff 检查通过；原台账与截图未入 Git。已创建普通提交 `cec7dc4806b7998dc5618e666b701ec553c8271a`（`feat(editor): close frontend visual system`）并普通 push 至 `surdet/main`，新鲜远端 SHA 一致。随后 CI 结果见下一段。Renderer/Host/Shell、Authoring/Core/CLI、Starter/正式内容/模板、格式和依赖均无本轮改动。

CI `34227911701` / job `102066486987` 最终 failure：Verify all、素材导入、写回、V4 mounted/built Editor、截图保留及 P1/P2 均 success，最后 Pass 8 actual player 失败。原前三条损坏存档错误符合预期，新增第四条为 `[starter] 宿主 adapter 失败： Renderer runtime has already been disposed`；原错误总数断言 `4 !== 3` 保持。实际错误发生在 battle 点击跳过后导航 long；Starter 的 650 ms 敌方回调不失效，beforeunload 销毁 Renderer 但未 dispose Host。本机通过真实入口、原生键盘和目标文档延迟 1600 ms 定向复现相同错误，日志 `D:\CodexTasks\surdet-pass10-20260908\battle-navigation-probe.log`。Luna 独立源码/CI 诊断一致：真实既有生命周期竞态，不能等一段时间、过滤错误或盲目重跑掩盖。

当时准备的最小方案是修 Starter battle 回调失效与入口 Host 退出接线，具体记录在 `D:\CodexTasks\surdet-pass10-20260908\starter-lifecycle-scope-request.md`。当时 Goal §4.2 与 §7.2 排除 Starter，故未擅改；随后 Owner 的新要求已覆盖该范围门，见第 9.15 节。所有失败证据保留。CI 的 `surdet-v4-ui` artifact `10056754016` 对应同一 cec7dc4，含 6 张截图；主代理检查其中素材占位、预览和 200% zoom，与本机最终结果一致。

### 9.15 Owner 要求 Starter 全面重做（2026-09-08）

Owner 先要求“顺手改一下 starter，那个示例游戏太古老了，现在必须优化”，随后强调“一定要彻底大改”以及旧示例限制引擎上限。主代理已按新授权继续，不再等待 Starter 范围确认；本轮纳入新的原创短篇《雾港来信》、完整选择与三结局、独立的可选玩法入口、现代视觉素材、首轮引导、作者文档和新项目模板的可玩基线。仍复用原 Core/Renderer/Host/Shell，不另外实现玩家状态机、输入或保存算法。

退出竞态先形成 battle 单元 3 RED/1 GREEN，修正后正常敌方动作、reset/dispose 旧回调失效及重开隔离 4 项通过；与退出资源顺序等共 3 文件/9 项通过。真实 battle/pass→beforeunload→延迟目标文档 1600 ms 的浏览器路径由同错误复现转为零错误。原完整玩家入口、系统 adapter 与资源 owner 提取到 `examples/shared/player/`，Starter 与 `surdet new` 模板共用；模板原有空菜单、空存档 provider 和直接进剧情已替换为真实公共入口。提取后类型检查及聚焦合同已通过，后续完整验证尚在进行。

旧 SVG 和旧演出中确有现行资产回归依赖的内容已冻结到 Editor 专用测试 fixture，校验原文一致后从产品中移除，保持原导入/重命名/撤销断言。最初一版港口、邮局、灯塔、人物与头像由内置图像工具生成；当时假透明的表情变体未采用。后续 Owner 要求立绘重做，最终结果见下节，不能把此处早期素材状态当作最终交付。

### 9.16 Starter、立绘与整体本地收口（2026-09-09）

Owner 要求参照《零点之后》女主的二维画法，否定首个候选后已重新生成常态、犹豫、释然三张同角色立绘。Owner 明确授权“允许本地抠图”，故仅清理背景并写入真实 alpha，保留人物 RGB；头像从同一常态图截取。三种表情已接入剧情，实际全部结局通过；最新图片位于 D 盘 `starter-anime-final-clean`。正式《零点之后》源图只读，未覆盖。Luna 独立查看原 PNG、深浅底与最终实图，未发现白边、棋盘格或角色一致性阻断；未代签 Owner 风格认可。

除退出竞态外，真实 RED/GREEN 关闭新游戏日程残留、标题回想不能继续、schema 不兼容读档过早完成事务、敌方延迟回合可操纵和演练尚未完成便解锁成就。公共 BattleView 增加可选 inputEnabled，所有玩家动作在敌方或结束时禁用；左右移动使用不同读屏名称。Starter 和新模板共用 examples/shared/player，未创建第二套玩家状态机。

最终本地完整 `verify:all` 成功（`verify-all-modern-starter-quiet.log`）：九工作区 278 文件 / 2618 项，原测试时限、任务进程单 worker，所含类型/内容/构建/根门禁全部通过。之前的超时、两处过时 fixture 引用和手工 CLI 遗漏 passWithNoTests 的真实失败保留；未提高仓库时限或降低断言。该绿灯后立绘/GAL 表情与方向名称的增量完成 Starter 构建/五条实际玩家路径、面板 10 项和原生按钮名称补验。

Starter 五条实际流程、三项新增复核回归、真实 cmdNew 项目的类型/构建/两分支/菜单保存/刷新标题读档、完整 Pass 8 玩家及文件桥均通过。Windows 原生 Electron A–G 七项全绿，G 共用 userData、两个实际进程均正常退出，原生键盘从标题读回落盘的 prologue:8；总八进程退出正常。素材导入 26/26 和 built Editor 九模式四视口/键盘/真实 200% zoom 通过。内容模拟 40 路径、52 次存档往返、三结局、零运行错误；普通 lint 0 错误 / 9 个已说明警告。Luna 对源码、红绿结果、夹具、新素材与最终页面集中复核，无本轮确认阻断。

Core 对缺失场景存档的事务边界未在本轮修改或验收；schema 不兼容重试成功不能扩大为所有损坏存档均已处理。Host/Shell、Core/Authoring/CLI 生产、正式游戏、格式、依赖和 lockfile 未改；无发行、部署、新阶段或 Owner 体验代签。此台账仍未跟踪、未暂存、未提交。

最终文档校验、暂存 diff 检查通过，精确暂存 99 个本轮路径；保护文件、原台账、截图、日志、临时项目均未暂存。主代理创建普通提交 `c4022647a87b0ca10dc6e76b8c6ebcac94b8eb91`（feat(starter): modernize narrative demo and shared player），普通 push 至 surdet/main，新鲜 ls-remote 与本机一致。新提交 CI 待核实。Starter 本地预览已重启并核实 HTTP 200，地址 `http://127.0.0.1:5176/`，已请求在当前任务右侧展示；不冒称隐藏任务的面板已经可见。

c402264 的 CI run 34290107053 / job 102274529586 在 Starter Vite HMR 的非法编辑诊断等待处超时，其余八工作区通过。原测试本机通过，不能据此推翻 CI；独立 Vite 探针证实原位写入的中间文本可被 raw fetch 读到。仅修改测试：完整写入 pending 后 rename 发布，每次合法编辑等待 compileScene 算出的准确 hash，非法源预先断言拒绝；原所有资源/导航/位置/错误断言和时限不变。主代理与 Luna 定向实际浏览器均通过，Starter typecheck 与文档检查通过，无生产 HMR 修改。普通补充提交 `702a558ca8ac4f564474204b5baa66d1dd8f1a9e` 已推送并核实远端一致；新 CI run 34291433466 / job 102278617638 执行中。

### 9.17 UI 暂停与 Pass 10 热更新队列修复（2026-09-09）

Owner 曾提供 UI.png 并授权补齐基础 UI。完成首版后，Owner 明确反馈“底下的按钮太大”，要求“暂时不管，先把 pass10 弄完”。基础 UI 工作立即暂停；七个已改追踪文件、新 player-chrome.ts、基于702a558的完整补丁及说明存入 `D:/CodexTasks/surdet-pass10-20260908/ui-draft-paused-20260909`。主仓库仅反向应用本任务 UI 补丁并移走本任务新 helper，没有 reset/checkout/改史或覆盖其他人文件；该草稿未提交、未推送、未获视觉认可。Renderer/Starter 已按已验证基线重新构建。

702a558 的 CI 34291433466 仍在 HMR 非法编辑诊断处失败。真实探针排除了非法源未到达：完整非法文本实际被 fetch 并拒绝，问题是每次 boundary 事件都把七场景逐个读取，前轮无关请求拖住后轮。每请求1.5秒的真实慢请求路径重现相同等待失败；新真实解释器/注册表测试在9秒预算内仍停留第一版形成RED。共享开发 HMR 改成同轮并发读取/编译、按事件与候选顺序应用，逐项隔离错误；读取/编译拒绝保留旧场景，应用阶段失败单独报告，不宣称Core事务回滚。

新队列测试GREEN，真实Vite/Chromium每请求1.5秒的完整原HMR测试GREEN（`hmr-slow-browser-green.log`，测试41.53s）。UI恢复后，Renderer/Starter构建、Starter类型检查、原真实HMR+新队列2文件/2项再次通过（`pass10-hmr-final-green.log`，原HMR33.138s、队列65ms）。Luna独立核对正常顺序/错误隔离；旧registry替换后恢复失败的Core边界未扩围，日志已区分。原等待时限与行为断言没有放宽。

主代理仅暂存HMR模块、新测试和报告三文件，普通提交 `e72c2996b486e90e62d7f5aefea853504b952815`（fix(player): avoid scene hot-reload scan backlog）并push至surdet/main，远端SHA一致。新CI run34295450006正在核实；当前只等待该轮完整门禁，不恢复基础UI工作、不扩展其他主题、不代签云端终审。

上述 CI 34295450006 / job 102290967395 最终由新 Starter 聚合步骤的 10 分钟上限终止；全量验证为 279 文件 / 2618 项通过、1 项 Windows 专用用例平台跳过，真实 Vite HMR 34.685s、新队列 17ms 均通过。素材导入、写回、V4 模块、built Editor/真实 zoom 与 P1/P2 全部 success。Starter 首个脚本五条路径全部 PASS，耗时约 10m12s，后续复核回归/新项目脚本及 Pass 8 尚未执行。原失败和完整日志保留为 ci-34295450006-failed.log、ci-34295450006.log。

Owner 明确要求尽快收口、减少工程化；本地不重复通过的检查、不扩大生产修改。主代理仅把新增 Starter 聚合步骤的外部执行预算 10→20 分钟，并在报告说明；Luna 只读原始 19 行失败日志、workflow 和三脚本入口，确认属于编排预算问题，无断言失败证据。普通两文件提交 `2978c985cd66f3b6a6921ec6d0f341aa820978cf`（ci: budget the full Starter player verification）已 push，远端 SHA 相同。最终 CI run 34296944553 执行中，UI 继续暂停，停止点仍为待云端独立终审。

Owner 随后要求立即按最新全局 AGENTS.md 执行。主代理已完整读取现行文件，采用最低必要工作范围，后续不再派 Luna 审核/复核/验收或最终收口；这一最新明确要求覆盖此前的强制 Luna 收口约定，既有有效结果保留。

2978c98 的 CI 34296944553 最终在 practice-completion 等待超时，前面的五条实玩、回想与不兼容版本重试均通过。主代理读取原失败日志及 CI 的 practice-completion-failure.png，画面已进入战斗结束后的对白；旧回合循环在读取 battle 与等待按钮之间可能结束。仅将循环改为等待“战斗结束或玩家按钮可操作”，结束后继续原有 trained/选项消失断言，保留等待上限和全部行为断言。现有三项 Starter 回归全部通过（starter-final-race.log），未改生产代码、未追加测试/环境或 Luna 复核。普通两文件提交 `44f6d958e882ba2a447b58c1bdf405b9fbe5e0f6`（test(starter): observe battle completion between turns）已 push，实际远端一致；新 CI run 34299089595 执行中。

按 Owner 最新全局规则，主代理进一步撤出本轮自行加入 CI 的重复完整剧情与新项目流程：保留所有原有门禁，新增 Starter 步骤仅运行三项真实缺陷回归，刚失败的演练仍必须在远端通过。五条剧情实玩复用 2978c98 的远端通过结果，新项目复用当前生产源码本地类型/构建/两分支/存读档通过结果，完整 verify:starter 命令仍可按需执行。普通两文件提交 `de64c349844f5643904921704c4a8060cd9502f7`（ci: reuse verified Starter flows and retain focused regressions）已 push，远端一致；旧 run 34299089595 已申请取消，新 run 34299600696 执行中。此举不放宽行为断言，不跳过本次失败的检查，不新增门禁或生产改动。

**最终收口：施工完成，待云端独立终审。** de64c349844f5643904921704c4a8060cd9502f7 的 CI 34299600696 / job 102303501893 于 2026-09-09 01:55:01 UTC 全部 success。主代理读取实际 checkout SHA、完整日志和步骤结果：9 工作区 279 文件 / 2618 项通过、1 项平台跳过；真实 HMR 32.556s、新队列 15ms；素材导入 26/26、Editor 九模式四视口/键盘焦点/真实 200% zoom、三项 Starter 回归（含 practice-completion）及完整 Pass 8 玩家/文件桥均通过。Pass 8 包含真实保存/取消/覆盖/读取、菜单/鉴赏/回退、三视口、损坏存档、200% zoom、系统玩法和长文本，完成实际写盘 3 次。原日志保留为 ci-34299600696.log；没有再跑额外本地检查。最终 Git 现场确认本机/远端相同、追踪工作树及暂存区干净，原未跟踪内容保留。本台账仍未跟踪、未暂存、未提交；UI 草稿继续暂停，无发布、部署或新阶段，也不代签 Owner 或云端 PASS。

### 9.18 Pass 10 云端关闭与 Wave 7 正式开工（2026-09-09）

Owner 提供 `Surdet_Wave7_Production_Goal_2026-09-09.zip`，要求“看看如何，没问题就开工”。主代理读取 Goal、完整设计规格、接线蓝图、验收矩阵及 Pass 10 独立终审报告，确认 R2 已补齐绑定范围、短期持锁、完整基线变化与零推进重试规则；Pass 10 的明确后继裁决为 PASS / Frontend Pass 1–10 CLOSED，不再沿用此前 pending。当前本机与实际远端 main 均为 de64c349844f5643904921704c4a8060cd9502f7，开工追踪文件和暂存区干净，既有未跟踪资料保留。

包内 Luna 独立复核要求属于旧约定，按用户最新 AGENTS 由主代理亲自复核。仅将配置草稿检测交给 luna_worker 独立并行实现，主代理同时负责后端提交保护、租约和绑定工作区接线；不让 Luna 复核或收口。foundation 脚本已完整阅读，默认只读 READY 后应用：6 个既有锚点和 17 个候选文件；基础 Authoring 聚焦检查与构建通过。候选还不是完整 Wave 7，保存失联后的锁释放/状态结算边界将先定向验证并修正，不能照搬后直接宣布完成。

当前状态：`WAVE_7_PRODUCTION_IN_PROGRESS`。本轮按包内完整闭环施工，允许普通 commit/push，真实 Flow A–D 使用隔离副本；原始 Starter、《零点之后》、用户项目、暂停 UI、格式和依赖保留。未授权按钮、音频、打包、发布、部署或 Wave 8。台账保持未跟踪、未暂存、未提交。

**2026-09-09 生产完成补记：** Authoring 2.2 工作区合同、Agent 零推进提交前置检查、共享短期项目写租约、Node 文件发布与过期写入隔离、Editor 完整草稿投影、旧基线保存保护、完整变化范围与显式同步均已接入。修正了字符表保存期间新输入被旧快照覆盖的真实缺陷。主代理亲自复核；Luna 仅执行独立的配置草稿、共享租约/通知和项目栏实现，不登记 `LUNA_REVIEW_PASSED`。

正式 runner 输出 `D:\CodexTasks\surdet-wave7-20260909\wave7-relay-green.log`，隔离项目为 `surdet-wave7-D336Wu`，A–D 全部通过，原始 Starter 字节保持，页面无异常，子进程与项目租约正确释放。预期网络结果仅为旧基线保存 409 及已移除预览的导航取消。早期失败记录保留；预览图片异常已定位为测试桥接把 PNG/WebP 错报 MIME，修正桥接后真实港口背景、人物与 awaiting 状态通过，未修改 Renderer 或预览生产代码。

完整 `verify:all` 通过（2673 项工作区测试，含 Authoring 312、CLI 516、Editor 746），资产 authority 浏览器 26/26 和 V4 保存/重开/预览/真实 200% 缩放回归通过。结果分别保留于同一 D 盘目录的 `wave7-verify-all.log`、`wave7-asset-browser.log`、`wave7-v4-browser.log`；交付说明为 `docs/human-agent-relay-wave-7.md`。

普通提交与推送：`ecc5fdaa5678869bf89def3062477196b71a6196`（`feat(authoring): coordinate human and agent project writes`），远端 main 已再次核实一致。[CI 34349483414](https://github.com/Equinox7379/Surdet/actions/runs/34349483414) 全部 success，headSha 精确相同。最终状态为 `WAVE_7_LOCAL_IMPLEMENTATION_COMPLETE`、`WAVE_7_FLOW_A_TO_D_PASSED`、`EXACT_HEAD_CI_SUCCESS`、`WAITING_FOR_CLOUD_INDEPENDENT_REVIEW`。追踪工作树与暂存区干净；本台账仍未跟踪、未暂存、未提交。云端尚未裁决，不启动 Wave 8。

用户在等待 CI 时提供 `D:\9.09\surdet-audit-report.md` 及修订版，主代理只读核对关键结论，没有据报告启动施工。内存夹具完整执行角色改名与重新校验，@foo 将台词变为指令（仅 W001 警告），//foo 将台词变为注释（无诊断），两者对白数均从 1 变为 0；记录为未修正确性缺陷。Electron 原生点击验证不足成立。修订版已撤回“路径导致换机器必挂”并明确绑定接力保护有效；“缩略图未实现”仍不准确，当前 Player 有采集和传递、MenuLayer 有绘制分支，实际截图未显示应作为显示问题定位。综合审核不是 Wave 7 云端 PASS，也不授权清理文件、修改权限或扩大本轮范围。

### 9.19 外部审核确认问题的定向修复（2026-09-09）

用户随后明确授权“你自己修吧”。本轮拒绝会把台词改写为 DSL 指令/注释的角色显示名；纠正胶囊工具的 readOnlyHint 和 README 的 apply/observe 说明；修复异步缩略图纹理不刷新、尺寸失真及截图包含存档菜单；将既有 Electron runner 改成隔离 userData、真实鼠标开局、数字键选择和 F5/F9 文件存读档，并接入一条 Windows CI。没有增加人类审批门、依赖、通用框架或修改游戏内容。

本地 89 项相关测试、四工作区类型检查和相关构建通过。角色改名两个事务反例、胶囊标注、缩略图尺寸和排除菜单均先见红灯再修复；完整 Pass 8 浏览器回归通过，最终缩略图实际显示剧情画面。Electron 已真实走到 ending_unanswered（69 步、3 次选择），存读档验证先推进再恢复到保存位置，页面与控制台无错误。结果在 `D:\CodexTasks\surdet-audit-fixes-20260909`，截图和日志不入 Git。

普通提交 3c07805 为 11 文件局部修复。新增 Windows CI 的首次运行在开局点击后超时，日志已保留；d5bc381 仅调整窗口聚焦、等待素材完成和失败画面留存，本地再次通过。旧 CI 34356284127 已取消剩余工作，当前等待 [34357210411](https://github.com/Equinox7379/Surdet/actions/runs/34357210411)，不把本地通过代替远端结论。

后续实测：d5bc381 的远端日志确认聚焦、11/11 素材就绪及真实点击开局均通过，实际失败点是 Windows 虚拟桌面的 page.screenshot 超时，失败截图也未能生成。0e4968c 将画面采集保留在本地（已有实际截图验收），CI 完整保留鼠标、数字键、F5/F9、推进后恢复保存位置、结局和页面/控制台错误断言；同时撤回无法产出的 CI 截图上传步骤。CI 模式本地通过，Windows 原生 job 102488183310 在 [34358206772](https://github.com/Equinox7379/Surdet/actions/runs/34358206772) 已 success，当前继续等待同一提交的 Ubuntu 玩家回归。旧失败日志保留；没有改写历史、放宽输入断言或恢复调试入口回退。

**最终交付：** 0e4968c3bd8f26df31c6a5b1b9747d7b5b06e586 的 [CI 34358206772](https://github.com/Equinox7379/Surdet/actions/runs/34358206772) 全部 success，Windows 原生与 Ubuntu 两个 job 均已完成。远端 main ref 与本机相同，追踪/暂存干净，原未跟踪资料保留。已修本轮确认的四组问题，停止等待复审；没有把尚未复现的报告条目或新的体验功能列为已完成。

### 9.20 Q1 新鲜外部 Agent 创作资格化（2026-09-10，按发生顺序）

Owner 明确要求执行桌面附件 `Surdet_Q1_Qualification_Package.zip`。已读 START_HERE、GOAL、QUALIFICATION_SPEC、CREATIVE_BRIEF、操作手册、人类 Gate、矩阵、台账说明及本机适用 AGENTS。附件 `LEDGER_UPDATE.md` 声明 Wave 7 在 0e4968c 云端终审 PASS；本轮据其更新阶段，不伪称亲读不存在于包内的完整审计报告。Q1 只资格化已有 2.2.0 合同，不开发 Wave 8、不改正式作品和原 Starter，不启动按钮、音频、发行、部署。

已按附带准备脚本生成 `D:\CodexTasks\surdet-q1-fresh-agent-20260910\run`，含隔离 project、agent-data、独立 A/B 提示词及 41 文件基线。主代理仅执行 MCP 连接、tools/list 和 session.describe 连通检查，真实 stage policy / contract 2.2.0 / envelope 1.0.0 返回成功，30 个 stage 工具可列出，change.commit 被 policy 禁止，无 active change。连接检查会话已关闭；它不是 Candidate A/B。隔离项目与原始 Starter 分别对同一基线检查，均无新增、删除或修改。

当前任务及内置子代理未暴露 Surdet MCP；子代理创建参数也不能删除 Shell/文件工具或单独连接本地 MCP，因此仅 fork_turns=none 与提示词禁止不能满足 Q02。现有 Desktop Codex CLI 0.153.4 可另行启动外部会话，但当前 AGENTS 明确只在用户要求 CLI 工作时执行模型任务；本轮只读查询入口、help/features/MCP 列表，未运行 CLI 模型、未改全局配置。拟由主代理获本轮专用 CLI 授权后继续核验进程内工具白名单，再启动两个隔离会话；未核实限制生效前不启动候选。

当前资格分类 `QUALIFICATION_BLOCKED_BY_EXTERNAL_AGENT_ENVIRONMENT`。A/B capsule、Owner 比较决定、最终批准、apply、显式同步、一句续写、fresh observe、Electron 两结局均客观未完成。无生产代码修改，无新 commit/push，无 Q1 新 CI；既有 0e4968c CI 绿灯不冒充 Q1 通过。主代理维护台账，Owner 不承担命令、证据整理或 CI 工作。

**Owner 随后明确允许 CLI，继续 Q1。** 主代理通过本机 Codex 0.153.4 的独立进程与临时会话接入原 Surdet MCP；每个候选有独立客户端目录、空工作环境、无继承会话和角色外知识，复用当前账户登录但不复制凭据到项目。启动前使用仅本机接收、不会调用模型的请求检查，确认没有文件/Shell/浏览器/其他 MCP/多代理/skills 工具，没有全局 AGENTS 或历史上下文。业务工具恰为 30 个 Surdet stage 工具；客户端附带的 MCP 资源访问和提问辅助入口不提供文件系统。模型沿用 Luna 限定为 gpt-5.6-luna / max；仅关闭该次客户端的通用工具暴露，未修改 Surdet 合同或全局配置。

A 的真实 fresh 会话为 `01a08909-1978-75b0-8ccc-c06ab5bb8314`，B 为 `01a08909-1978-75c3-b86f-d557886912eb`，各自先调用 session.describe、capabilities.describe，再自主 inspect。主代理只提供各自原始渲染简报并观察工具记录，没有代填创作 payload。实际工具记录分别保存在任务外 `run/reports/candidate-a.jsonl` 和 `candidate-b.jsonl`；后续等待各自 capsule 后复用原 Review。

**首次候选揭示真实合同缺项。** 两位候选都取得运行通过证据，在修订阶段反复收到要求重新读取 fingerprint 的错误；实际 object.inspect 对匿名台词未返回 fingerprint，而 scene.patch schema 强制 required。B 最后猜出 objectRef 尾部值后成功修改了一次，这不补齐公开返回缺项；没有把它隐去或声称所有可能调用都失败。主代理结束这两次修复前尝试，记录保留为 `candidate-a-before-fingerprint-fix.jsonl` / `candidate-b-before-fingerprint-fix.jsonl`；原 Starter 与隔离 project 再对同一基线检查均零差异。

生产仅在 `packages/authoring/src/object-index.ts` 的台词、指令（含选择块）和选择项对象补回已有行指纹；不改计算方式、写入门或合同版本。Luna 工作者仅在已有 `packages/cli/test/agent-port-tools.test.ts` 编写行为测试，主代理亲自检查并运行：旧 dist 下 1 失败 / 8 通过，失败明确是 inspect.fingerprint 缺失；构建修复后 9/9 通过，覆盖成功修改、旧指纹拒绝和修订号/内容不变。另有 Authoring 8 项聚焦回归、Authoring/CLI 类型及构建通过。提交 `08f136daae609f251566cadbb8cead22c3d812b8` 已正常 push，CI 34428895352 进行中。

修后 A 会话 `01a0891c-0a81-7b33-be3c-8df90328be43`、B 会话 `01a0891c-0a81-7290-a830-f6a85cb4ae02` 均从无历史上下文重新启动；只保留原简报与最新代码 HEAD 元数据，没有把失败记录或源码解释带给候选。原项目字节基线与资源控制变量保持不变。

**第二组候选揭示胶囊依赖事实缺项。** 两者通过 validation/runtime，并依据公开错误继续核对 project.assets，仍因真实已解析背景和立绘未曾被基线时间轴引用而得到 composition unavailable。原记录完整保留为 `candidate-a-before-asset-fix.jsonl` / `candidate-b-before-asset-fix.jsonl`。主代理在 delivery capsule 的事实投影中纳入现有共享素材目录，不新增资源或放宽缺失资源；依赖拒绝信息同时列出缺失身份和既有操作顺序要求。Luna 只负责两个测试的独立编写，主代理修正其负例遗漏的 position 与类型窄化后亲自验证：胶囊 8/8、manifest 5/5、Authoring/CLI 类型与构建通过。真实候选记录是本次缺陷红灯；不声称新增测试曾在旧源码完整运行。

普通提交 `6cbb6af33a32dd6160a7cbcdbe340d57d9ec4dc7` 已 push。既有 Windows Electron CI 停在开始游戏后等待，本机同尺寸真实鼠标点击可正常开始；本次只在原流程补首次 pointerdown 与失败时页面/窗口状态，不添加调试开局回退、不放宽断言。6cbb6af 的 CI 34431294987 正在运行。第三组 fresh A/B 为 `01a0893d-9173-7ff1-9f9e-174f93e5a9b4` / `01a0893d-9173-7df1-919b-9b128094943d`，仍只获得原始创作简报和最新 HEAD，未继承前次失败或操作者 payload。启动前隔离项目再次与 41 文件基线零差异。

**最终 stage 候选与人类比较 Gate。** B 在原独立会话观察双路线后再次修订，最终 change `chg_0001_f25493af-f19e-456f-94d4-5b46cfdc4575` / capsule `1221793d-ac45-479c-9113-4effb2b8363d` / artifactSha256 `0a1aada504fa3f6a0abe7454398e743499db9ed9c82df088957a80d02d1caa5a`。A 的客户端曾拒绝草稿 rollback；仅为该次隔离 stage 客户端设置此工具的授权并重新核对隔离后，新 A `01a08947-73ab-7720-92a3-595cde7fc641` 自行撤销旧草稿、按公开错误要求重建、运行双路线并修订。最终 change `chg_0002_bd92b3fd-456e-4040-bad8-acf97b4dc4fe` / capsule `36c036fa-096d-494f-b4aa-17d56ea4401e` / artifactSha256 `7fc0696284ab7d45ccd4d50a3143c498814ed8ed50392007e84ec1e5f3060ca4`。两份均 ready、validation/simulation/runtime fresh、projectMutation false；A 实测 454 字 / 4 场景，B 815 字 / 3 场景，无禁用幕后词。最终 stage-final 与 source-starter-after-stage 都对 41 文件单一基线零差异。两候选进程已正常关闭，原失败记录及中间胶囊保留。

主代理仅通过公开 composition.compare / review.prepare-comparison 建立 `review_comparison_a1aef192b41849d496f60703fbab701e`，已打开真实 Review 页面并检查可见画面，页面/控制台/请求错误均为空。该页面按稳定身份排序，因此**页面方案 A 是温暖版，页面方案 B 是冷峻版**，与候选启动字母相反；已向 Owner 说明，未更改来源或代选。当前 `OWNER_COMPARISON_DECISION_PENDING`，尚无 decision.json。6cbb6af 的 CI 34431294987 已全部 success，远端 main ref 再核为同一 SHA，追踪/暂存干净。Q1 总体未完成，不代填后续批准、同步、对白续写、Electron 双结局或云端结论；Luna 依现行规则仅编写测试，主代理承担边界检查。

**实际人类决定与第三处缺陷。** Owner 表示不易理解比较页；主代理解释并推荐温暖版。Owner 明确“采用温暖版，帮我选好”后，主代理按其决定预填五处选择，Owner 本人点击“保存我的决定”。decisionId `dcb15375-7fdb-4432-82bd-c74f05594b13`，decisionFingerprint `52801def07188be7dedc024886e6108ae70ddd0c990e79fba7ee277d9e2efbcc9`。因此本次为有协助的 Review，不能算未经解释即可理解。其真实决定首次 dry-run 在入口操作失败：相同 entryScene.set 合并保留了冷峻来源的依赖，却选择温暖内容。主代理仅修 integration-plan 的相同操作来源选择、依赖闭包和重新排序，并补真实行为回归；同一 Owner 决定修前失败、修后通过，Authoring 四文件 58 项、类型与构建通过。正常提交推送 `f68dbcc387b80510bd9c4502b65fb1e552556035`，exact-head CI 34434073628 两个平台均 success。

**批准、apply 与接力。** 修后 plan `pln_94dcc3719e7eae979df9438228f3baa0` / fingerprint `ac0c1eaee94033ed8ccb0d6d2cea0328e149e60e91872877de5ee1d53e844e8c` 重放八项温暖来源操作成功，integration change `chg_0001_3f1578e1-ad6e-4e82-a600-c0668d452587`，validation/simulation/runtime 全新鲜，双 trace 为 `trace_1789011477832_21e855d7-aa82-42b0-b900-cc1da9256619` / `trace_1789011477971_de8f8dfb-3383-428d-8f2b-11a7c885c052`。Owner 本人点击结果批准，result review `review_result_f89a78fbae1a4f9da8f5fb3316c24014`，approvalId `approval_1789011857335`，fingerprint `9027d7262d5d8a244b5552382ed130ff590fb39074c72f00a9cd207117390dad0`。apply 前 Editor clean、workspace/base/approval 匹配；提交后预览仍为旧内容，显示待同步。主代理按既有流程查看差异并点击显式同步，原场景、标签、对象、时间轴选择保持，旧预览释放、新预览就绪。

**人类一句续写与 fresh observe。** Owner 本人把入口第 3 行 `player：凛，先别急，我们一起看。` 改为 `player：我是可爱的小宝贝！` 并保存，实际磁盘仅此一行变化；重开 Editor 后文本仍在、工作区 clean。新 observe CLI 会话 `01a08979-b36e-77b2-bab6-0c4402289033` 仅有五个公开只读工具，未提供新台词；自行沿公开引用读取完整入口、新台词和 ref `scene:qualification_entry/text:3@225be67c-d36c8bec`，project revision `225be67c7c9d9d7960b0a45756fd9687ec38907f3b33c4f789ea20f72a0b3247`。从批准快照重建的旧引用 `scene:qualification_entry/text:3@8dd4c000-06d122f4` 被当前 object.inspect 以 OBJECT_NOT_FOUND 拒绝；明确这是快照重建，未伪称编辑前已采集该 ref。

**真实玩家结果与边界。** 原隔离 project 构建通过；真实 Electron 三次启动中，实际鼠标开始、数字键选项、F5/F9 存读档，两个结局 ended 且 route 分别 1/-1；同一玩家目录关闭进程重开，文件存档一致并恢复 end_open/pc3。两背景、三表情和中间 fade 帧均观察到，两结局关键截图已目视检查。Electron page/console/request 错误为空，进程日志只有正常调试器退出提示；Editor 唯一 request 异常是重载释放 preview.html 时的 ERR_ABORTED。Editor 纯文本诊断另有原 Starter 未使用/不可达条目及一条未纳入素材目录导致的 avatar 提示；正式 Authoring validation 零问题、实际资源已加载，不声称 Editor 全警告清零。附带静态 helper 原不识别合法 @blocking=true，按 Core 已有语法修正本次提取的 helper 后通过，首失败保留；未为它改生产语法。人工输入法、按钮、音频、发行和部署不扩展。

**Owner 对独立创作的纠正。** 可玩结果打开后，Owner 原话为“还行吧，只是我的目标是让agent顺利创作，可是你调整了好几次它们才成功”。前述结果因此只称经修复和引导的全链路通过，不登记完整资格 PASS。主代理在不改提示词内容、不改生产代码的前提下，用相同 41 文件 Starter 基线准备独立 `cold-start` 项目（保留已有 Owner 成品）；重核仅 30 个 Surdet stage 工具和无源码/历史上下文后，启动全新 A `01a08988-bc86-7a43-a22e-7f6ef8b1f6b6`、B `01a08988-bc86-7e80-9219-100cba81956d`。本轮不发送纠错提示、不代操作、不根据结果替换候选；允许 Agent 自己消费公开错误并修复。无干预成功与是否顺畅分别据实际失败/修复记录判断。

**f68dbcc 无干预尝试未获整体通过。** 两名 Agent 各一个自然结束的 turn，无任何操作者 follow-up：A 用 449.920 秒 / 63 调用 / 10 失败，最终 capsule `5f28f1b0-0c2a-4ec2-aef0-1974b31d0048` composition ready，3 场景 / 523 字；B 用 457.844 秒 / 62 调用 / 23 失败，最终 capsule `6b01b96d-dd55-47b7-b122-bec988301aa1` composition unavailable（创建入口时前向引用尚未建立的场景），4 场景 / 697 字。两者各有新鲜双路线 runtime，但 B 最终未说明不可组合。原生 stage 对同一基线仍零差异。工具失败分别含 8 / 17 次 object.inspect 猜测引用，实际场景查询没有 childRefs；公开 metadata 却承诺一层子引用，所以这是既有可发现性缺陷，不能仅归咎 Agent。

**场景遍历修复与题目遗漏。** 最小修复在 object-index 复用已有 parentRef / childRefs，把场景内台词、指令、label，以及 choice 内选项公开为一层可遍历引用；不新增工具或语法。现有 MCP 指纹测试改为从场景正常遍历取得台词，不再借校验警告取得匿名引用，并保留修改后重查和旧指纹拒绝；修前明确缺 childRefs 失败，修后 MCP 9/9、Authoring 17/17、两包类型与构建通过。提交 `47fd2fa07cf6502f74cca19403f3c1a7bc30c741` 已普通 push，CI 34437384064 运行中。另确认原始候选题只要求交胶囊，漏写矩阵 Q07 的 ready 条件；新提示仅补此自然交付标准和如实报告未完成，不添加顺序、参数、历史经验或修复答案。原提示和失败原始记录保留为 cold-start 下 `*-before-scene-traversal-fix.*`，不是把它们改写为成功。复用未改变的同一隔离项目，启动全新 A `01a08995-78ca-7ce2-83d7-1a6b4bcdbdb5` / B `01a08995-78ca-7e43-bfe5-dd07d0ba091c`，均无操作者续问。

**最终独立完成与停止点。** 上述两名 fresh Agent 各收到一条用户题目，各自然结束一个 turn，全部业务调用均为 Surdet MCP，无操作者中途纠错、代操作或修源码。A 用 420.274 秒，78 调用 / 2 失败 / 1 次自行 rollback，最终 change `chg_0002_8a20d0d5-3a1c-485e-adc4-179432d7d706` / capsule `38de6984-fddd-4b82-9f19-24c1f3f9bcaa` / sha `629db9440a18a75fcdf5797c5432c760b99894234ffac5460f64ee9278ff086e`，4 场景 / 776 字 / 2 背景 / 2 表情。B 用 520.654 秒，96 调用 / 6 失败 / 2 次自行 rollback，最终 change `chg_0003_68cd0f75-d7cd-4863-bf30-382bebe58392` / capsule `81dd97b8-0144-4782-afc5-0701f36afaef` / sha `22cd4ebfcbdabc020943b397d0f68b2735dde828080f244dd188259a7c944c5e`，4 场景 / 862 字 / 3 背景 / 3 表情。两者均 composition ready、working revision 8、validation 零错误、simulation passed，最终双路线实际变量分别 1/-1，证据均 fresh；三轨 timeline、非零 fade、blocking 调用、真实运行观察后的修订均存在。精确 trace ID 及字段在 `D:\CodexTasks\surdet-q1-fresh-agent-20260910\cold-start\reports\independent-final-summary.json`。

stage 后同一 41 文件基线零差异，两名客户端正常退出，临时登录链接已清理。公开 composition.compare 接受两份 ready 胶囊，返回 review-only，六项均为预期的 OBJECT_RESULTS_DIVERGE / selection-required，无 blocking finding；comparison fingerprint `58a6cabd6bb5e4696bdab4280a0e17f412e58ca6a67734fddb8d755f6ee3aff0`。原 Owner 温暖版的选择、批准、续写和玩家路径保持为原成果；新冷启动只补充最终代码的独立 stage 资格，不伪称 Owner 再次选择或批准了新候选。最新 CI 34437384064 精确对应 47fd2fa，Windows / Ubuntu 全部 success，本机与远端 main 同 SHA、追踪/暂存干净。最终登记技术资格 PASS，但保留依赖顺序引起的自主返工和原 Review 有协助的实际限制；停止在待云端独立终审，Wave 8、按钮、音频、发行与部署均未启动。

**Q24 专项只读复核补齐（2026-09-10）。** Owner 确认产品资格与上述证据复用，并明确要求补 Q24。现场全局 AGENTS 实际禁止 Luna 审核，并非强制 Luna 收口；本轮按 Owner 新的精确授权作单次例外，没有改规则。全新 `luna_worker / q24_readonly_review` 未参与此前实现或测试编写，独立检查最终 A/B 原始 JSONL、工具白名单与客户端配置、最终胶囊及实际项目基线，裁决 PASS（有明确证据边界，无阻断）。实际各一个 ephemeral 非 resumed 会话、一个初始 userMessage/turn，无人工 follow-up；A 78 / B 96 次业务调用均为 Surdet MCP，stage policy，未发现源码、Shell、文件、Git、浏览器或其他 MCP 旁路。最终 patch 后的 validation/simulation/runtime 均归属各自最终 change / revision 8，两份 ready payload 的实际字节数/SHA 与原始引用一致；41 文件 stage 只读核对无新增、删除或修改。

主代理复核初始题目、调用范围、实际 payload 身份和 evidence 状态，与独立结论一致，并再核本机/远端/CI attempt 1 为 47fd2fa / success。保留两项边界：较早白名单探针不等于最终 provider 请求的完整转储或 OS 隔离证明；B 最终 objectDiff.freshness=missing，但 Q14 所需 validation/simulation/runtime 全 fresh，不阻断 Q24，不为补齐展示而重跑。完整 Q24 结论与原始日志行号已补入同一份 `D:\CodexTasks\surdet-q1-fresh-agent-20260910\run\reports\QUALIFICATION_RESULT.md`，未生成新审核报告。此次只更新结果与原台账，无代码修改、测试/构建/Agent/Electron 重跑、提交或 push。产品资格 PASS_WITH_RECORDED_FRICTION、LUNA_REVIEW_PASSED，停止等待云端正式签署收口。

### 9.21 Wave 8 闭合与台账纳入版本控制（2026-09-11）

Owner 已确认 Wave 8 R2 源码复审通过，批准普通 push，并在后续 Electron 测试脚本修复、对应 HEAD 的 CI 两个平台均通过后再次确认 PASS。当前状态、代码基线和 CI 链接已同步至第 9.8 节，具体实现及失败记录复用既有 Wave 8 交付报告，不在本台账复制第二份验证报告。

Owner 随后明确要求“把台账也加入 push 范围，push 上去”，本文件从本地未跟踪资料转为仓库跟踪文件，沿用原路径和历史内容，取消其 local-only 限制。此次只同步事实与现行协作边界并提交推送台账，未修改生产代码、测试或 CI 配置，也未启动 Wave 9。未来阶段转换仍由 Owner 决定，普通 push 权限按相应目标的明确授权执行。

### 9.22 Wave 11 保存决定后准备真实结果（2026-09-13）

Owner 明确授权完整 Goal：整案与混合均从已保存并核验的决定出发，通过正常绑定项目入口准备、自动打开和试玩真实结果，再接上 Wave 10 批准、明确写回、加载及继续编辑。普通实现、同目标遗漏修复、本地验证、普通提交与推送均获授权；不要求 Owner 代跑命令或故障注入。九月托管 CI 继续暂停，其他排除项不变。

本地实现与相关验证完成。准备进度持久保存并复用原计划、integration 与结果；整案和混合真实浏览器均从仅有候选与比较审阅开始，贯通编辑保存与重开，并验证草稿保护、响应丢失、刷新、来源错误。另以真实后台进程退出验证原结果续接。主代理修复了该调用链中显式数据目录遗漏、关闭结果被重新创建、READY 内容核对和中断发布问题；实际结果、证据边界及复验入口统一维护在 [Wave 11 执行记录](2026-09-13-stage-6-wave-11-result-preparation.md)，不在本台账复制测试清单。

代码及两份记录按授权交付至 `surdet/main`，精确提交与同步状态以 Git 为准；不把本地测试批准计入 Owner 体验，不代签云端终审。当前停止点为等待云端独立复审及 Owner 正常体验，Wave 10 已验收成果保留，下一波未启动。

### 9.23 Wave 11 分支运行遗漏的定向修复（2026-09-13）

Owner 转交新云端对 `741c971` 的首轮只读源码复审，结论为暂不通过：准备服务向 `runFrom` 传入空选择序列，遇到实际选择项会停在运行步骤。该意见最初为源码契约判断；本地主代理随后以含选择项的真实服务夹具复现，未把先前线性入口的测试通过当成分支验证。

沿用 Wave 11 完整 Goal 与普通修复、验证、提交推送授权，准备服务改为核对并读取当前组合当前版本的持久模拟证据，只将正常结束路径的入口、选择序列和种子传给原运行器。保留严格选择校验、原决定、剧情、计划与结果身份；未复制组合逻辑或绕过运行检查。

含循环、两个选择项和出口的定向测试，以及整案和混合真实页面全链路均通过；验证模拟证据中断续接、运行响应丢失后的复用、草稿保护和明确写回。结果与失败边界统一记在 [Wave 11 执行记录](2026-09-13-stage-6-wave-11-result-preparation.md) 末节。修复按授权普通提交推送后等待云端复核受影响部分；不代签 Wave 11 Owner 体验，九月 CI 保持暂停，Wave 10 和其他排除项不变。

### 9.24 Wave 11 保存失败反馈与代理接管（2026-09-13）

Owner 在开始实际体验后报告保存失败，并明确要求代理自己操作、不再进行任何人工操作。主代理沿原 Goal 接管相关修复与全程验证，确认问题来自只读结果预览经普通导航被当作可编辑项目，修复来源同步入口及同源重载错误。实现、实际复现、验证和原窗口草稿的可访问性限制只维护在 [Wave 11 执行记录](2026-09-13-stage-6-wave-11-result-preparation.md) 的本次反馈节；该记录不等同于 Owner 体验通过。普通提交与推送授权持续有效，交付后等待云端复核受影响部分，CI 与其他排除项不变。

云端随后认可 `1607d39` 的主修复，指出审计页名词表按钮仍可向只读结果写入。主代理应用 Owner 转交的一行补丁，并以同一真实结果完成失败复现、回源保存与重开；详细结果只维护在上述执行记录的“审计页回源遗漏补齐”节。按原授权普通提交推送，其他已关闭结论不重开，不把代理验证登记为 Owner 体验通过。

### 9.25 Wave 12 外部 Agent 受控图像接入（2026-09-13）

Owner 在转交云端的候选方向后要求直接开工：复用现有素材导入服务，让外部 Agent 从明确授权的位置接入已准备好的背景、立绘和头像，再通过公开标识完成剧情编排、实际运行和保存重开。采用先导入素材、再刷新事实并创建剧情变更的顺序，不替换封存候选，不承诺图片与剧情跨事务原子提交。

实现和真实验证统一维护在 [Wave 12 执行记录](2026-09-13-stage-6-wave-12-agent-image-import.md)，主代理负责质量判断与 Git 操作。独立 Agent 仅在隔离项目中执行真实创作，不承担审核或最终验收。Owner 无必做人工步骤；本轮不扩展到生图供应商、音频、视频、发行、界面重做或下一波。

Owner 随后授权普通推送，首版 `4387bca` 已推送。云端复审指出 Agent 恢复可继续中断撤销、恢复发布漏查实时运行标识冲突；主代理在真实服务和磁盘上先复现两项失败，再应用两处局部修正，并验证自身已发布文件、成功回执及正常回滚不受误伤。相关检查通过，详细结果只维护在原 Wave 12 执行记录。沿用同目标普通提交与推送授权，交付后仅等待云端定向复核，不重新启动整套验收。
