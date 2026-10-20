# U2：作品界面状态与进出场合同

Authoring **2.40.0**，仍为73项能力、`ui.version:1`和原`project.ui`/`project.ui.patch`事务。后端#81与前端#82分别交付数据/调度和Editor/Player接线，当前均未合入main。Windows浏览器已验证编辑保存重开及真实Player交互/进退场/重置/读档/减少动态；Electron、原生IME和本轮最终导出包尚未验。U1基础样式前端已随#80合入，不更换默认外观。

## 控件状态

节点`states`仅用于`button/toggle/slider/input`；正常状态使用原`style`，可选键`hover/focus/pressed/disabled`。

每个状态只允许U1字段`color/background/opacity/backgroundOpacity/backgroundGradient/backgroundImage/textShadows/shadows`，类型、范围、素材及清空语义沿用[U1合同](ui-style-contract.md)。不能改字体排版、边框尺寸、padding、圆角、坐标、绑定、动作、条件、身份或子节点，不接受CSS/URL/脚本。

- `resolveProjectUiInteractionStyle(node,config,interaction,explicitTheme?)`统一计算有效值，interaction使用`hovered/focused/pressed/disabled`布尔值。
- 顺序为基础style→hover→focus→pressed；disabled跳过hover/pressed，在focus后覆盖disabled。
- 最终disabled透明度已乘原有0.45一次，前端不可再乘，且对整节点组应用，不分别淡化底和文字。
- 省略继承前层；`backgroundImage:null`禁用该状态继承皮肤；空阴影数组清空；0保留。回到正常状态必须恢复基础外观，不能累积CSS。
- 键盘焦点标记独立存在，作者状态不能把它关闭。是否能执行仍由原enabledWhen、条目disabled和输入归属决定，透明度不是权限。
- 辅助生成按钮不是新增作者节点，本批不新增其状态配置；没填states的旧节点保持原表现。

## 根页面进出场

根节点可设`transition:{enter?,exit?}`，子节点不可设。每项字段如下：

| 字段 | 含义与范围 | 省略 |
| --- | --- | --- |
| durationMs | 必填，有限数0..1000毫秒 | 不适用 |
| opacity | 0..1 | 1 |
| x/y | -128..128设计像素，1280×720画布 | 0 |
| scale | 0.8..1.2，围绕页面中心 | 1 |
| easing | linear / ease-out / ease-in-out | ease-out |

enter从给定姿态到稳定`opacity=1,x=0,y=0,scale=1`，exit反向，只叠加在页面投影，不改变节点frame、阅读倍率或业务状态。

`resolveProjectUiMotion(root,'enter'|'exit',reduceMotion)`返回补齐的独立对象。没设、时长0或减少动态为真返回null；前端稳定显示或立即移除退出页。不添加剧情等待，不写入存档。ease-out为三次减速，ease-in-out为平滑三次插值，不宣称与CSS同名曲线逐像素等价。

## 读写与资源

- 原direct事务与修改保护不变。`page.set/node.insert`传完整节点；`node.update.patch.states`及`patch.transition`整体替换，不能丢未编辑状态/另一方向。patch字段为null删除整个字段；存储配置里的states/transition本身不能为null。
- `project.ui.value`保留原数据；交互节点`effectiveStates`分别返回hover/focus/pressed/disabled的单态结果，组合状态用Core算法。根节点`effectiveTransition`返回enter/exit完整对象或null，以玩家减少动态关闭为基准。
- 非法字段、非根动效、错误控件、缺图、坏切片在修改前拒绝，原草稿不变。无新能力编号、摘要、兼容格式或事务系统。
- 所有状态图片进入原素材用途、引用索引、改名移动、主题共享及导出。未悬停的资源也要保留；每张状态九宫格都检查真实尺寸。不把easing/状态名/布局元数据当素材，未知私有字段仍按原不透明引用规则处理。

## Renderer公共动画端口

从`@surdet/renderer`创建一个`ProjectUiMotionController`，传给`createRendererRuntime({projectUiMotion})`，Runtime接管其reset/dispose。所有页面共用该实例和既有FrameScheduler，不另开RAF、interval、WAAPI时钟或常驻循环。

```ts
const motion = new ProjectUiMotionController();
const runtime = await createRendererRuntime({ /* 保留原参数 */ projectUiMotion: motion });
const cancel = motion.play(pageKey, resolveProjectUiMotion(rootNode, 'enter', reducedMotion),
  'enter', pose => paintPagePose(pose), () => finishVisualOnly());
```

- `play(key,motion|null,direction,paint,complete?,cancelled?)`立即给起始姿态并返回该次取消函数；同key替换取消旧complete，旧cancel不能取消新播放。null/0时长同步终态和完成，不等待下一帧。
- `cancel(key)`取消当前key；`cancelAll()`用于换局/读档/上下文切换，均不触发complete。可选`cancelled`在取消、替换或销毁时同步通知该次投影，界面据此稳定开放页面并删除退出残影，不靠驱动空闲推断。取消前先移除旧播放；取消回调不得另建播放或执行业务动作。`finishAll()`用于中途开启减少动态：当前有效投影立即到终态。`dispose()`终止全部，之后play报错。
- 既有ticker在剧情暂停时只推进UI及原菜单投影，不推进世界；结束后休眠。Runtime成功resetSession取消旧播放，dispose和初始化失败释放实例。paint同步关闭/替换/销毁后旧complete无效；绘制或完成回调失败报告原错误并移除失败任务，保留该失败触发的下一帧请求，让其他UI和世界投影继续，不自动重试失败回调。
- complete只清理该次视觉投影，绝不能执行剧情推进、保存或解释器恢复；不是业务成功回执。

## Claude接线边界

1. `project-ui-dom.ts`以真实鼠标/键盘/禁用状态调用Core算法，按完整有效值刷新装饰，保留U1整组透明度、内容裁剪和原生控件规则，不重复皮肤或0.45。
2. `show`沿原Shell先提交页面/暂停/输入归属再开始入场；`hide`同步移除活跃登记，退出画面立即不可点击、不可Tab、不可被refresh重新启用，随后仅视觉退场。回调只移除对应旧元素。
3. 同页替换、快速开关、读档、新游戏、重新播放、销毁取消旧播放及退出残影；焦点恢复遵循原返回栈，不在迟到回调中抢焦点。
4. 共享Player只改`examples/shared/player/player.ts`中UI实例、Runtime options、createProjectUiDom options以及UI重置/阅读设置通知；保留Shell、Host、解释器和存档逻辑。stateReset同步取消旧动画和退出投影，减少动态变更立即finishAll，不加业务状态机。
5. 设计器增加四种状态切换、根页面动效字段、一次预览/停止；只改变画布表现，不触发玩家动作。保存、撤销重做、重开、原主题/片段闭环保留。
6. 技术示例不是默认美术；两作正式生成UI与U3另行交付。前端不自行扩字段或改后端。

## 验证边界

后端以Core算法、真实Agent Port读写/拒写、资源与切片、Renderer真实ticker的定向结果交付；帧测试替换GPU初始化，不冒称完整Windows动画通过。前端需补真实Editor/Player鼠标键盘、减少动态、快速切换/读档和实际画面；随后本机Windows复核。

10月Actions额度用尽，提交沿用[skip ci]，不触发/重跑CI，不降低旧断言。未执行不记通过。
