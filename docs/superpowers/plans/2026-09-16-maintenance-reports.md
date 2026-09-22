# 2026-09-16 维护报告合并修复

## 授权与基线

Owner 收到首份审查的重点核验后明确要求“你直接修就行了”，并交付第二份报告。本轮核实两份报告中的具体缺陷，按共同根因修复并验证，完成后沿持续授权普通提交、推送。报告中的建议不是既定设计；不凭严重度标签改动已有合同，不代签独立终审或 Owner 体验。

开工 HEAD：`0f198faa7bac7d061df3b392a27873628171b533`，分支 `main`，远端名 `surdet`。跟踪工作树与暂存区干净；已有未跟踪材料保留。保留 A 工作台、共享后端、正式游戏和存档。九月托管 CI、音频生产、发行与部署继续暂停。

报告来源：第一份 `SURDET-MAINTENANCE-REVIEW-0f198fa.md`（MiMo 会话目录），第二份 `<local-path>`。下文以 R1 的 H/M/L 编号、R2 的 F/U/M 编号区分，外部报告的实测不冒充本轮执行。

施工期间 Owner 补充第三份报告 `D:/surdet-review-20260916/SURDET-MAINTENANCE-REVIEW-0f198fa-2026-09-16.md`（下文 R3）。其基线仍为同一提交；报告观察到的在制品是本轮获授权修改。合并去重后继续核实；其命令式建议不另增产品合同。

Owner 随后交付第四份（最后一份）`D:/surdet-review/SURDET-MAINTENANCE-REVIEW-2026-09-16.md`（R4），并明确“提交要详细，我让云端 AI 认真审一审”。四份报告统一按上述基线核验。R3/R4 审查中看到的跟踪文件修改是本轮在制品，不另算来源不明改动。本轮未派子代理；主代理负责实现、核验与 Git。

## 修复落点与行为

以下按共同根因归并，不按重复 finding 数量累计成果。每组都是本次差异，未修项另列。

| 组 | 主要报告关联 | 最终修改与约束 |
| --- | --- | --- |
| 存档失败保全 | R1 H7/H9；R2 F01/F02；R3 H4/M28；R4 M1/L8/L10 | Shell 在触碰主档/备份前校验索引，准备新档与备份后发布，索引最后写；失败按实际已修改文件补偿，补偿失败同时保留原错。delete 同样先查索引、保留可恢复字节；legacy 查询排除保留的 index 文件。共享 Player 不再吞浏览器存储异常，自动存档有拒绝处理。没有宣称跨文件断电原子性。 |
| 当前对象与类型化正文 | R2 F03/F04；R4 H2/ML2 | 外部服务在变更租约内验证所有新 scene.patch 的完整 ref、类型、场景归属；成功 operationId 重试仍走原幂等。track/cue 指纹绑定整个时间轴及位置，拒绝相同内容对象后移后的旧选择。typed text 创建/插入/替换必须重解析为原 speaker/value，不能变成注释、DSL 或多行。选择组内部 insertAfter 明确拒绝，要求完整选择组操作；replaceText/replaceChoiceOption 保留缩进。 |
| 合法项目变体与组合 | R1 H1；R2 F07–F10 | diff 完整保留 U+2028/U+2029；variable.ensure 复用 BOM 配置解析并保留 BOM；角色迁移识别大小写 GAL 扩展名。变量/角色的字典键不套路径 ID 正则。嵌套时间轴在操作、产物指纹及封装中按真实路径唯一解析，不移动文件、不猜重复身份。组合与已封存重放保留原前置事实，未强加外部会话 revision。 |
| 恢复与普通提交 | R1 H2/H10/H17/M31；R2 F05；R3 H5/M13/M16 | 恢复请求身份只取稳定调用参数，成功恢复后可重试并读取原结果，仍拒绝不同 token。CLI 与 Agent 共用当前校验/模拟/运行证据门；恢复到来源前检查人类工作区。Node 项目写入复用既有 fsync；租约释放先停止并等待心跳，双失败保留双方错误。短暂 JSON 替换竞争有界重读，持续占用报可重试错误，真实坏记录仍拒绝。调用台账写失败时附原 invocationResult，不冒充原操作未发生。 |
| 素材导入与整理 | R1 H16–H18/M32；R3 M14；R4 H1/M5/M6 | 不存在的导入编号先返回 NOT_FOUND，不建立持久屏障；已登记损坏操作仍阻断。session.describe 纳入真实素材恢复屏障。原生 CLI 增加明确素材来源和数据根参数，数据根解析统一尊重显式参数、环境变量、平台默认顺序。整理恢复重查全部引用文件集合和字节，允许本操作已经发布的精确内容，不放过新增/外部改动。choice 行内资源引用复用 Core 分词规则改写。 |
| CLI 入口与诊断 | R2 F06；R3 H1/H2/M1/M3/M4/M7–M9；R4 H4/M2/M9/M10 | 原生命令路由从共享 registry 发现，--input 完整透传并保留 ref/trace 便捷参数；同时给 project/change 时核对项目身份；dispatcher 对全部 capability 执行原 policy。拒绝未知参数及非法模拟预算，零场景 lint 不报成功。CLI 校验接入素材目录并覆盖 public、背景/立绘及时间轴。时间轴诊断改用 TL001–TL010，避免与表达式 T 码混淆；同步 hint 和文档。未知字符串转义保留反斜杠，词法列号与空修饰符键修正。 |
| 运行状态与系统 | R1 H4/H23/H24/M23–M27；R3 M6/L2/L3；R4 MH4/M11/ML1/L1/L2 | 解释器运行错误进入 error 态，拒绝继续存档；一次性事件全部效果先通过原批量变量校验才标已消费。价格、日历 AP/周数、战斗 alive/HP、成长存档与关系事件树校验补齐。旧档缺少变量、宿主系统与成长数据时恢复对应初始状态；导出调用栈无引用泄漏，系统快照必须 JSON 安全。EventBus once 在回调前退订。choice 行内不支持的 switch/loop/video 明确 S010，不伪造已执行；空 clear ID 用当前场景。 |
| 玩家表现与宿主 | R1 H8/H19、M18–M20、L5/L6；R3 M23/M24/M31/L23；R4 H3/MH1/MH2/M7 | 等待指示器在唯一定位函数同时检查隐藏/NVL；读档清除隐藏与历史面板状态。视频开始监听在 Renderer 连接之前建立，避免同步跳过后被旧回调重新置忙；快捷读档回到 game/none 并清除旧面板投影。系统交互期间阻止会跳过玩法的保存/加载/菜单；恢复实际游玩时长。世界快照保留 speaker，时间轴恢复递增编号，回退不重复恢复同一表现快照。素材同 key 异步注册仅最新请求提交，生成纹理释放底层 source。共享 Player 的相关调用修复同步到 Zero 独立入口。 |
| Editor 草稿与身份 | R1 H6/H16/H22；R3 M18–M22；R4 M3/M4/ML4 | 场景删除清历史、改名迁移并更新历史中的引用，选择行内 jump/call 同步改写。显式同步成功重载前不丢崩溃备份/审阅草稿。迟到的名词表导入不作用到另一项目。时间轴先验证新内容再入历史，拖动核对当前对象/文本，离线删除不得退回句柄直删。阻塞自动恢复提供下载、重试与明确放弃入口；保存结果未查明时禁用放弃。素材搜索保留输入 DOM/焦点与缩略图会话；歧义场景定位拒绝猜测；超过 100 条诊断明确说明。 |
| 文档与工具 | R1 M13；R3 H8/M5/M32/M37/M39；R4 M8–M10/L11/L13/L14 | 架构图、工作区、模板/独立游戏边界按源码更新；移除权威示例中不受支持的行尾注释，补 ambience/transition 与诊断表。能力矩阵是索引而非测试通过证明，移除生产源码充当测试证据并拒绝该输入。矩阵比较规范化两侧行尾，仍拒绝内容差异；CLI 浏览器 artifacts 加入忽略。 |

具体复核入口：`packages/shell/src/save-store.ts`；`packages/cli/src/authoring/authoring-service.ts`；`packages/authoring/src/{operations,timeline-operations,transaction-recovery,validation}.ts`；`packages/cli/src/asset-import-authority/{record-store,asset-relocation-authority}.ts`；`packages/cli/src/authoring/{node-json-record,node-local-lease,human-workspace-store}.ts`；`packages/core/src/runtime/interpreter.ts`；`packages/host/src/{player-shell-controller,save-hooks}.ts`；`examples/shared/player/player.ts`；`packages/editor/src/{main,project-io}.ts`。

### 未照抄的建议与保留限制

1. **选择组内部插入（R4 H2）没有采用“只继承缩进”。** choice 的相邻选项仍会被插入的正文截断，缩进本身不能保证语义。现有完整选择组操作可明确完成该创作目标，本次拒绝会拆组的插入。
2. **引号不是所有参数通用的去壳语法（R1 H5/M30、R3 L22）。** Gallery 的字面 ID 和部分既有指令消费合同并不相同，既有 Wave 13 回归包含带引号的不同字面 ID。未统一去引号或修改已存内容；只修复表达式未知转义吞反斜杠和空 clear 的确切缺陷。
3. **idle 下 complete/fail 仍拒绝（R1 H14/L7）。** 这是操作状态合同；修复的是 busy close 错误被补偿掩盖，以及有意保留同一个覆盖层时投影/返回栈不一致。未把非法状态调用改为成功。
4. **“任意自定义 restore 回调抛错都能完整回滚”仍不成立（R1 H3、R3 M25/M26）。** 内建系统/变量/成长的已知无效快照提前校验；未知宿主回调仍由宿主负责，不新增第二套通用事务或在已发生任意外部副作用后声称无损补偿。架构文档已去掉超出保证的说法。
5. **人类工作区仍是现有 active/grace/expired 合同（R3 M12）。** 本次修复多进程 heartbeat 丢更新及恢复写入遗漏，未把过期 dirty 会话改成永久写锁；页内备份和旧基线拒绝仍存在。超过宽限期后不能承诺 Agent 永远等该窗口，也不宣称该报告提出的更强策略已实现。
6. **direct 变更不等同于 stage 候选（R1 M3、R3 M10、R4 ML3）。** 本次保证合法 stage 操作、封存与组合的相关修复；direct 的历史 manifest 推导、空变更可封装、unavailable reasons 完整性未重设计。比较总体 blocked 与只选合法独立单元的计划策略（R3 M11），以及调用方 actor 标记与服务器真实人类回执的区别（R3 L15），保留原合同；本次没有把这些争议项登记成缺陷已关闭。真实批准回执仍不可由 Agent 生成。
7. **MCP 外层输入拒绝与内部 envelope、无 change 的统一调用台账未改（R3 M15/M17/L16）。** SDK 会先拒绝普通不合 schema 的输入，素材写入已有独立持久 authority 记录；并不等于全部调用都进入 change invocation ledger。特殊 own key 在 SDK 投影前后的精确审计一致性未作新保证，没有为此削弱 SDK 校验。需独立复核这些公共合同的剩余差异，不能计入已修复清单。
8. **保留真实后续工作：** 多游戏打包的 appId/userData/安装与产物身份（R4 MH3），涉及发行和既有存档迁移，本批未改、未打包；32 图长调用超过客户端时限（R4 L5）未作吞吐/progress 改造；FNV 行指纹强度和 diff 中旧 fingerprint 字段命名未迁移。现已补外部旧引用检查，但不是 SHA 强度升级。
9. **列表坏数据保持 fail-loud。** 未把坏索引、坏 legacy/备份条目静默跳过或变成空列表（R3 M27）；显式备份 UI、全部动画中途存档/音频恢复、跨进程多游戏发行、所有自定义系统启动/重开语义不在本次通过声明内。Zero 仍为独立入口，未借维护合并整个播放器。
10. **工程建议不等于运行缺陷。** 现有源码契约测试仍只算静态检查；本次真实浏览器与磁盘回归单列。未扩大根 verify:all 到所有游戏、重写边界扫描器、升级依赖、统一全仓格式、变更性能阈值、替换包管理器，或改动已有未跟踪 pnpm 文件。CRLF 比较修正适用于每次检出，不需要为此追加全仓行尾改写。

本记录是本批实际修改与剩余项的交接，不是四份报告所有 H/M/L/D 条目的无条件关闭证明。其余维护建议和缺少复现的疑点保留原报告身份；云端可依据实际 diff 定向复核，不能将“报告作者确认”直接改记为本机实测。

## 本机验证

日志根：`<local-path>`。日志、临时项目、截图、依赖与构建产物不进入提交；下列计数是各次执行，存在重叠，**不相加为一次全仓全绿**。

| 执行范围 | 实际结果 | 原始日志 |
| --- | --- | --- |
| Core 全包 | 27 文件 / 385 项通过；末次同根因补旧档缺少成长后，interpreter-save + growth 61 项定向通过，类型检查/构建重做通过 | `core-complete.log`、`missing-growth-green.log`、`core-types-growth.log`、`core-build-growth.log` |
| Authoring 全包 | 44 文件 / 483 项通过，类型检查及构建通过 | `authoring-complete.log`、`authoring-types-complete.log` |
| Renderer 全包及后续受影响层 | 全包 54 文件 / 458 项通过；R4 边界补充后对白/表现控制器 28 项通过，最终类型检查/构建通过 | `renderer-suite-final.log`、`renderer-boundaries-last.log`、`renderer-types-final.log` |
| Host 全包 | 11 文件 / 93 项通过，类型检查与构建通过 | `host-last.log`、`host-types-complete.log`、`host-build-last.log` |
| Shell 全包（非 Electron 运行） | 23 文件 / 209 项通过，包含真实 FileSaveStore 磁盘失败补偿；类型检查/构建通过 | `shell-complete.log`、`shell-type-last.log`、`shell-build-final.log` |
| CLI 组合/配置/会话/安全/素材/lint | 7 文件 / 141 项通过；新鲜原生 CLI 子进程扩展 9 项另行通过；CLI 类型检查/构建通过 | `cli-complete.log`、`cli-native-final.log`、`cli-types-final.log`、`cli-build-last.log` |
| CLI 导入权威与项目存储 | 2 文件 / 51 项通过，调用级 testTimeout 30 秒，未改全局产品超时 | `import-authority-serial.log` |
| CLI 导入持久存储 | 1 文件 / 57 项通过，覆盖重启、回执缺失/损坏、符号链接、撤销隔离与屏障状态；同样使用该次 30 秒测试预算 | `import-storage-last.log` |
| Editor 单元/源码契约 | 首次 883 通过 / 1 旧钩子名称契约失败，修正后对应 3 文件 30 项通过；最后 project-io/timeline-model 83 项通过，Editor 类型检查/构建通过 | `editor-suite-final.log`、`editor-suite-recheck.log`、`editor-last-tests.log` |
| Editor 模块浏览器 | 55 项通过，真实 DOM；不是完整磁盘保存 | `editor-modules-current-3.log` |
| 完整 Editor 与真实磁盘 | 角色/变量/名词表联存、speaker 迁移、预览、失败打开保留草稿、同目录失败后继续保存与重开、显式同步失败保留备份通过；无未预期浏览器错误 | `editor-save-last.log` |
| Starter 实际玩家浏览器 | 7 条通过：快捷读档清隐藏/覆盖层、跳过视频释放输入、标题文字回放、保存失败保留与重试、自动存档失败与隐藏、坏档恢复、练习结束 | `starter-video.log` |
| 工具/文档 | 能力矩阵 4 项通过（含真实 CRLF 文件、内容漂移拒绝、生产源码证据拒绝），verify:docs 通过 | `matrix-last.log`、`docs-check.log` |
| 游戏调用方 | Starter、Zero 类型检查通过，Zero 新鲜 Vite 构建通过；既有大 chunk 提示保留。未把共享 Starter 浏览器验证算作 Zero 完整试玩 | `starter-types-complete.log`、`zero-types-complete.log`、`zero-build-final.log` |

可重复的主要入口：`npm run test -w <workspace> -- <tests>`、`npm run typecheck -w <workspace>`、`npm run build -w <workspace>`；完整 Editor 为 `node packages/editor/e2e/maintenance-save-load.e2e.mjs`，模块浏览器用现有 `v4-workbench` runner，Starter 为 `node packages/renderer/e2e/starter-regressions.e2e.mjs`。CLI 已有单 worker 脚本，磁盘较慢时本次仅在该次调用加 `--testTimeout=30000`。后续复核应先构建 Core/Authoring/CLI，避免 workspace 链接读到旧 dist。

### 红灯与复验说明

开工前主代理从当前源码隔离执行：R1 H1 的 U+2028/U+2029 差异截断、H6 的历史键复用、H7/R2 F02 的浏览器存储吞错，以及 H18 的选择内背景引用遗漏得到确认。H6 使用真实历史模块与内存状态；H7 使用提取的当前适配器与失败存储；H18 使用真实编译器和规划器、内存项目适配器。这些结果不等于完整浏览器或实际素材移动。

保留 `shell-save-red.log`、`authoring-text-red.log`、`recovery-workspace-red.log`、`relocation-recovery-red.log`、`record-race-red*.log`、`unknown-import-red.log`、`choice-insert-red.log`、`dialogue-anchor-red.log`、`hidden-state-red.log`、`missing-system-red.log`、`missing-growth-red.log`、`save-delete-red.log` 等。它们覆盖本轮新反例；部分早期夹具自身缺参数、错误标签或旧 hook，修正夹具后才进入实际验证，未将夹具失败冒充生产缺陷。

CLI 大组最初 187 项中 5 项超过默认 5 秒；导入权威/存储最初 100 项中 32 项超时。期间同时进行多个编译/浏览器/磁盘测试，且测试真实落盘。后续取消组间并发，复用原断言并给该次磁盘测试 30 秒预算后定向复验，不删除失败日志、不关闭 fsync、不放松生产检查。一次补测重复传入已有 maxWorkers 导致 runner 在测试前拒绝，原日志 `import-storage-serial.log` 保留，纠正调用后另写 `import-storage-last.log`。没有据此宣称所有 CLI 测试一次全绿。

末次类型检查曾发现新测试的严格类型与缩窄错误（不是生产编译错误），修正测试参数/分支缩窄后重做对应类型检查。Host 的 structuredClone 不依赖 DOM 类型库，使用受支持宿主的 globalThis 入口并通过新鲜构建。

真实页面图：Editor `temp/surdet-maintenance-save-load-KwDWrm/preview.png`；Starter `starter-video/{interface-restored,quickload-interface-restored,skipped-video-input}.png`。主代理查看实际图像，确认检查路径中的正文与操作带可见；不签整体视觉质量、Owner 体验、真实 IME/原生选择器或 Electron 发行验收。

### 外部审查遗留数据

R4 披露其探针写入平台默认 authority 数据区。本轮只读核对：`projects/fb30cfb8bd1891b6bae45ff13638d147cfa68a0fb9aa2f33012993e736229a44/project-identity.json` 明确绑定 `D:/surdet-review/cli/project-b`；`operation-33333333-3333-4333-8333-333333333333-workspace-invalid.json` 创建于 `2026-09-16T01:38:37.547Z`。这是审查隔离项目的既有屏障，未删除、未修改，也没有证据据此称正式作品被污染。新未知编号调用不再制造这类屏障；旧屏障没有被自动当作安全可删数据。

## 首批提交与当时停止点

提交前实时远端 main 仍为开工 `0f198faa7bac7d061df3b392a27873628171b533`；CI 工作流实时查询仍为 `disabled_manually`。本批按 Owner 持续授权普通提交并推送，提交说明按上述修复组、验证与限制展开，精确最终身份以包含本记录的 Git 提交为准；不自引用预先猜测的提交哈希。保留未跟踪资料，不改历史、不发布、不部署。

当前交付是**本机已实现并验证的维护修复，等待云端独立复审**。未修/未核实边界在上文列明，不代签四份外部报告全部关闭，也不重开已通过的旧 Wave 或增加 Owner 体验任务。

## 9750765 复审整改：替换后刷新失败的补偿（2026-09-16）

Owner 转交云端独立复审与 `Surdet_9750765_post_rename_recovery.patch`。复审结论为 **9750765 暂不通过，主体成果保留，唯一已确认的本批阻断是提交补偿漏掉已经替换的目标**。本机接续 HEAD 为 `97507651b5e52304dc7db617e9b7f1559717b3ea`，跟踪工作树及暂存区干净；按原授权核验、局部修复、详细普通提交并直接推送。本次未派子代理。

### 本机复现与修正

先只应用候选测试，重新构建尚未修正的 Authoring，再运行真实 `NodeProjectStorage` 与共享 `commitChange()`：11 项中 8 通过、3 失败。新文件与覆盖已有文件的目标句柄 `sync()` 在真实 rename 后注入一次 EIO，两者都返回 `COMMIT_FAILED_RECOVERED`，但文件树仍包含新字节；未知目标内容同样误报已恢复。红灯日志保留为 `post-rename-recovery/node-storage-red.log`，断言含原文件摘要分隔符 NUL，不是日志损坏。

生产修正仅在 `packages/authoring/src/change-session.ts`，采用已核对的候选方案：记录正在替换的 entry，失败后通过原 `exists/readText` 核对实际目标指纹。已是本次目标则纳入原逆序补偿；仍是原文，或新文件仍不存在，则不额外写入。无法识别或检查失败时保留该文件，进入原 `RECOVERY_FAILED` / `STALE`，并保留原提交错误。仅在恢复成功后清理剩余暂存材料，恢复失败留待原检查/显式恢复能力处理。

没有删除或放宽 `fsync`，没有新增事务状态、公开 API、后台重试或第二套恢复系统。未知目标不会被自动覆盖；补偿过程中再次刷新失败仍明确报告恢复失败，即使内存可读字节已回到原文，也不冒称落盘保证已恢复。这是正常异常返回路径的正确性修复，不扩大为断电原子性承诺。

### 定向验证结果

日志沿用原根目录下 `post-rename-recovery/`，临时磁盘项目在其 `temp/`。应用候选的 3 个回归，并补足检查接口失败、替换前失败及补偿刷新失败的相关边界；生产补丁未再扩大。

| 本轮执行 | 结果 | 日志 |
| --- | --- | --- |
| `node-project-storage.test.ts` | 15 项通过（7 项新增、8 项既有）。真实最终句柄 EIO 覆盖新建/覆盖及各自显式重试；未知内容不覆盖、exists/readText 失败保留证据、发布前无目标不多余改写、恢复时最终句柄再失败；包含 Windows 文件占用回归 | `node-storage-green.log` |
| Authoring `change-session / commit-recovery / transaction-recovery` | 3 文件 / 29 项通过，既有批准门、恢复幂等、提交与清理约束保留 | `authoring-regression.log` |
| CLI `agent-transaction-recovery / authoring-vertical-slice` | 2 文件 / 20 项通过；含真实 NodeChangeStore、服务恢复、fresh-process 重开和原生 CLI 正常提交纵向路径 | `cli-regression.log` |
| Authoring / CLI 类型检查与新鲜构建 | 均通过；先构建 Authoring 再让 CLI 消费本轮 dist | `authoring-typecheck.log`、`cli-typecheck.log`、`authoring-build.log`、`cli-build.log` |

上面三组是本轮实际执行，不与首批整包数字相加。新增最终句柄故障注入使用本机 Windows 的真实文件系统和 Node 存储，change repository 为内存夹具；既有服务回归另用真实持久仓库，不能把二者拼成“通过 MCP/Editor 注入了最终句柄失败”。本轮不重跑 Starter、Q1、历史 Wave、整体视觉或 Electron；旧结果仅按其原覆盖范围保留。

### 当前停止点

本机已复现并修正该阻断，定向验证通过；详细普通提交、推送后等待云端针对该边界复审，**不代签最终 PASS**。原未修项和范围冻结继续有效。CI 本轮实时查询仍为 `disabled_manually`，未启用托管运行、发行或部署；首次 Git 远端查询发生 TLS 握手失败，未改安全配置。最终提交/推送身份以 Git 实际回执为准，不为填写自身哈希另增文档提交。

## I-1：中断上传的显式恢复（2026-09-22 续接完成）

Owner 要求逐项修复补审问题；9 月 16 日因额度要求暂停，9 月 22 日明确继续。本轮只完成 I-1，从 `5b13bf869d269898db62eee613545be5aab4ecf0` 和原有 8 个修改文件续接，保留其他未跟踪材料。E-1 的 speaker 捕获接线与 M-1 的失败调用 operationId 台账尚未施工。

### 原因与实现

Agent 上传在持久 upload intent 写入后被终止，重启会留下恢复屏障。原 `inspect` 因暂存不完整报错；原 `recover` 又先查询并要求尚未产生的计划指纹，导致公开入口无法解除阻断。

共享能力契约现要求 `asset.import.recover` 的 `planFingerprint` 与 `manifestFingerprint` 二选一。对于可信且从未封存的中断上传，`inspect` 的结构化错误返回清单指纹与 `recoveryAction=discard-unpublished`。Agent 适配器在原 apply 权限、项目租约、工作区草稿和其他恢复参与者约束下，将显式放弃请求交给公共导入 authority；清理本清单拥有的暂存材料，复用原回滚状态转换并解除屏障，返回 `ROLLED_BACK`，随后可用新编号重新导入。

authority 从已验证 journal generation 链推导 `hasSealedPlan`，拒绝通过删除计划文件把旧封存操作伪装成未封存上传；计划、发布、成功回执或撤销回执存在时同样拒绝该恢复方式。错误指纹与无法确认归属的文件继续阻断，恢复再次中断可重试。未改变持久格式、生产租约时限或已封存发布的恢复行为；新路径不写项目素材，`ROLLED_BACK` 也不表示导入成功。`session.describe` 有素材恢复屏障时明确返回 `MANUAL_RECOVERY_REQUIRED`。

### 验证与范围

- 9 月 16 日保留的 `<local-path>` 记录新增回归修复前失败。`cli-regression.log` 的导入 authority、存储、HTTP 和 Agent 4 文件 / 138 项通过；最终 Authoring/CLI 类型检查与构建均通过，日志为 `authoring-types-final.log`、`authoring-build-2.log`、`cli-types-2.log`、`cli-build-2.log`。本次核对后复用仍有效的结果，不重复整组执行。
- 9 月 22 日补齐暂停前未完成的最终接口检查：`capability-registry.test.ts` 15 项、`agent-image-import.test.ts` 17 项全部通过。覆盖二选一 schema、权限/草稿保护、错误指纹、未知文件保全、旧封存计划缺失拒绝、恢复中断后的重试及恢复后正常提交。日志在 `<local-path>}.log`。
- 同目录 `verify-mcp.mjs` 通过真实 stdio MCP 启动本轮构建，在 upload intent 文件出现后只强杀该子进程。按现有 15 秒租约等待后重启，`inspect` 给出恢复指纹，`recover` 返回 `ROLLED_BACK`；相同请求重试结果稳定，屏障解除，新 operationId 可 stage 到 `READY` 并 commit 到 `COMMITTED`。磁盘确认仅新素材落入目标目录，字节与授权来源相同，原剧情和配置未改变。结果为 `mcp-gtbvtY/result.json` 的 `passed: true`；两个数据根和临时项目均在该隔离目录，未用平台默认数据区。
- `npm run verify:docs`、`git diff --check` 通过。检查了公共恢复方法的 Agent 与 Editor 调用方；本轮未扩展 Editor HTTP 契约、未更改旧 action 恢复请求。没有运行无关游戏、视觉或 Electron 矩阵。

提交前远端 main 仍为 `5b13bf8`，实时 CI 状态为 `disabled_manually`。按持续授权普通提交、推送后停止等待 I-1 独立复审，不把本机验证记成云端通过。I-2 的查询排队、I-3 的现有租约窗口及其他旧限制维持原结论，不在本轮改造。

## E-1 / M-1：补审剩余确认缺陷（2026-09-22）

Owner 在 I-1 的 `31af5a7` 推送后明确要求完成剩余修复，再提供严格全量审核指令；原逐项停止点被本次授权取代。本批处理 E-1 和 M-1，以及 E-1 同一焦点契约涉及的真实调用路径。没有启动新功能 Wave。

E-1 的生产控制器经 `createPresentationPorts` 调用 stage，绕过了 facade 已有的对白/世界焦点协调。现在该公共接线读取 Dialogue 的既有投影状态，在实际文本更新后同步 World 焦点，显式角色选择同样同步；未配置或未知角色按原映射得到空焦点。定向检查另确认 NVL 追加没有产生说话人身份，facade 和 Legacy 清空对白也遗漏世界焦点，因此一起补齐三条入口及 NVL 清页。读档时先重建 NVL 历史文本，再恢复保存的世界快照，避免历史行的说话人覆盖当前行焦点；Interpreter 随后正常重放当前行。未增加跨层依赖、状态机或新的存档字段。

M-1 在调用开始时保留字符串 operationId，成功后仍采用 dispatcher 的规范结果。语义失败、权限失败均能落下请求身份；无效的非字符串编号仍被原 schema 拒绝，不进入编号字段，也不产生成功操作记录或推进版本。保持台账不存原始输入正文的原合同。

### 本机验证

验证根为 `<local-path>`，临时项目、数据、截图和脚本不提交。

- 修复前：`speaker-red.log` 复现生产接线、NVL 和 facade 清空焦点遗漏；其中两个存档断言最初误读外层 envelope，修正为 `presentation.payload.stage` 后，`speaker-red-corrected.log` 再确认 ADV/NVL 保存焦点为空和 Legacy 清空遗漏，未把夹具错误计为生产缺陷。`ledger-red.log` 复现业务失败与 policy 失败均缺 operationId。
- 修复后：Renderer 8 文件 / 64 项通过（`renderer-regression.log`），覆盖生产 ports→controller→真实 Dialogue/World、双角色 alpha、旁白/未知角色、空文本、ADV/NVL 保存恢复、facade、Legacy 及相邻表现回归。CLI 4 文件 / 56 项通过（`cli-regression.log`），覆盖调用台账、胶囊、会话、权限与 MCP 投影。
- Renderer / CLI 类型检查及构建通过。新 Renderer 测试曾直接调用类型上可选的 clearText，补上明确存在的测试调用标记后类型检查通过，没有改断言或放宽生产类型。Zero 使用本轮 Renderer 新构建到隔离输出目录，保留既有大 chunk 提示。
- `verify-electron.mjs` 启动真实 Electron、新 userData 和本轮 Zero 构建，通过实际开始按钮与键盘推进到 `common_0017 / pc 18`；对白与世界 speaker 均为 `zhirao`，保存快照携带该值，切换旁白后载入恢复，两侧再次一致，无 pageerror。`electron-U0rM7c/result.json` 为 `passed: true`，实际截图已查看。双角色 alpha 与 NVL 由真实图层/解释器集成回归覆盖；本次 Electron 正式剧情仍只有一位角色，不将其记成多角色视觉实测或整部游戏体验验收。
- `verify-ledger.mjs` 通过真实 stdio MCP 创建隔离 change，发送失败旧引用操作并随后创建有效场景；服务退出后直接读取持久台账，失败条目保留原 operationId / 错误码且版本不推进，成功条目身份与版本正确，原项目字节未变。结果见 `ledger-WVBLVx/result.json`。
- Renderer 边界检查及其 3 项测试通过；能力文档一致性与 diff 检查通过。I-1 上一轮的接口与真实强杀恢复结果按原覆盖范围保留，不重复相加为一次全仓检查。

I-2 的排队和 I-3 的 15 秒租约等待不是新增数据损坏或独立死锁：inspect 确有协调写入，不能按纯只读请求绕过串行/租约。README 补入长调用期间先 describe、再查原操作的实际指引。M-2 的无 change 统一台账、失败未受理请求是否占用编号、长负载吞吐与超长 objectRef 等保留为合同/能力限制或待证实疑点，本次没有证据将它们计为已确认缺陷并擅自重做协议。下一轮全量审核应独立验证其实际影响，不能据本段豁免。

本批沿持续授权普通提交与推送，九月托管 CI 继续暂停。完成后交付固定提交基线的全量审核任务书，由外部 AI 独立审核；本机通过声明仅覆盖上述实际执行，不代签全引擎终审。
