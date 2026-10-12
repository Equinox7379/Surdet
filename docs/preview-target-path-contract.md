# 从源行试玩：后端与Claude接入合同

成熟化规划第6项后端，依赖文字/记录PR #10，交付于PR #11（当时合同2.33.0）；当前合同2.34.0，共73能力。只读`project.preview-path`（MCP `surdet_project_preview_path`）没有改变。Editor界面尚未交付，继续由Claude负责。

## 目标与三种起点

输入`sceneId`和一基`line`，`view`为project或working，缺省project；working需要当前change。错误场景为OBJECT_NOT_FOUND，空行/注释/无可执行位置为INVALID_REQUEST，不猜下一句。标签停在Core实际标签步骤，选项行停在父choice执行前；target.kind为instruction、label-entry、choice-group或scene-entry，requestedLine保留请求位置，line/index说明实际步骤。

- `search`（缺省）：按声明初值、固定seed从项目入口探索真实选择；不接受预设choices、临时variables或重复访问次数。
- `path`：同一入口和seed，按choices的实际option index重播；不按渲染文案选项。缺选择或当前不可见为path-mismatch。targetVisit缺省1，循环可指定第2次等访问；输出choices是到达前实际使用的前缀。
- `test`：从目标之前最近标签或目标场景开头开始，variables为临时初值，Core检查声明名称/类型；可提供choices和targetVisit。partialStage=true，起点之前的背景、立绘、BGM没有重建。必须创建干净的预览会话，不能在已播放的舞台上只改pc、残留旧BGM来冒充这个起点。不会修改config或草稿。

seed缺省1592639710，0有效。maxPaths缺省500、范围1–2000；maxStepsPerPath缺省20000、范围1–100000；预算计算真实调试/选择/等待推进，分支重放调试步也计入。targetVisit范围1–1000。查询复用Core调试、快照和时间轴注册，不写正式存档、Profile、simulation/validation证据或latestSimulation，也不授予批准/写回资格。

## 输出与失败

结果含view、mode、entryScene、可选entryLabel、seed、initialVariables、target、choices、targetVisit、position、finalVariables、pathsExplored、steps、partialStage、message、runtimeErrors和coverage。外层携带现有projectRevision及workingRevision事实。position为Core已有debugSnapshot.current定位的原样投影，不新增摘要设施。目标尚未执行，不能宣称已看过目标正文或执行了目标效果。

| status | 含义 |
| --- | --- |
| reached | 真正到达目标执行前，position非空，变量为暂停点值 |
| unreachable | 按本次初值、seed和完整已探索路径未到达；实测条件见coverage，不猜任意false条件是目标唯一原因 |
| budget-exhausted | 路径或推进预算用尽，无法裁决不可达 |
| path-mismatch | 显式路径缺选择或选择当前不可见 |
| host-boundary | 到达需要真实宿主接管的指令，停止；不伪造战斗/日程后续状态 |
| runtime-error | 运行错误阻止核验，见runtimeErrors |

未到达时position=null；finalVariables只是最后实际运行状态，不是目标初值。某分支真正到达时可以reached，别的失败分支仍留在runtimeErrors。本结果只证明一条路，不代签作品完整覆盖。

## Claude接线

1. 从当前源稿取实际位置和视图，只有reached结果启用这条起点。前两种复用已有预览的seed、真实选择与来源有效性保护；test在新会话中将initialVariables合入声明初值，初始化空舞台/音频，不写来源。
2. 用现有Core.configureDebugger将position设为临时断点，真实执行entryScene/entryLabel和choices，目标处暂停，“继续”再执行目标。不拷贝finalVariables加直接跳转。沿用Core现有断点版本保护；来源修改、校验过期或路径来源失配就重读/重查，不定位旧行。云端可按前端任务补充来源核对，本机不新增哈希/指纹校验。
3. 用option index、targetVisit和实际断点共同定位循环，保留现有预览隔离、Renderer等待、宿主接管。旧PreviewReplayController只记录text/choice；任意指令起点接本次Core定位，不硬塞旧text字段，不另造解释器。
4. 界面显示本次起点和partialStage说明，用message/coverage说明预算、宿主边界和隐藏选择。空行/注释明确不可执行，选项行提示先停整组选项。

本机定向测试三模式、条件、预算、循环、宿主边界与真实MCP。Windows真实共享Player对照跨场景、选择、背景、立绘、BGM、变量；测试初值在干净实例中使用、源config不变。详细结果在唯一任务台账；Editor界面、旧路径失效提示和原生用户输入在Claude交付后另做Windows复核。
