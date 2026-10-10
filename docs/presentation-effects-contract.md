# 演出后端与前端接入合同

当前交付：公开色彩调整纠错、旧世界 `dissolve` 与旧图生命周期。`rule` 遮罩素材、作者 `@filter`、时间轴转场尚未交付，不能按规划草案当作可用接口。Editor 表单由 Claude 完成；本批没有改可见界面。

## 溶解转场

```gal
@bg old_room
@show rin:normal smile @pos left
旧画面。
@bg new_room
@hide rin
@show mio:normal smile @pos right
@transition dissolve 800
新画面。
```

- Core 唯一登记 `BUILTIN_TRANSITION_NAMES`：fade、slide-left、slide-right、circle、dissolve；`BuiltinTransitionName`、Lint、Renderer 名称类型共用此表。未知名称报 T010，运行入口返回 false；不要在 Editor 另造名单。
- `@transition` 仍有两个位置参数（名称、时长）。缺省 fade/600ms，实际播放器把时长限制在1–10000ms。原四种效果行为保留，dissolve 不是 fade 的别名。
- 显示一句台词、选择或 `@wait` 时开始下一批。第一次背景、立绘、图层、构图或镜头修改之前截取旧世界；同批后续修改不再截取。转场结束也开始下一批。
- 旧图包含世界、粒子和世界染色，不含对白、菜单、设置、加载层或全屏 fade/flash。始终盖在新世界上方、界面下方，以透明度1→0溶解；活动转场中的舞台改动在旧图下方继续，不截第二张图。
- 未修改世界而调用 dissolve 是成功的无操作，不启动动画。到下个停顿仍未用到的旧图会释放。完成、取消、读档、回退和销毁均释放所拥有的旧纹理；不销毁宿主注册素材。
- 旧图本身不入档，dissolve 不拥有世界属性。中途存档保存当前新世界；读档/回退显示目标快照的世界，不恢复半透明旧画面。既有背景/表情交叉淡化快照规则不变。
- 减少动态立即显示新世界，不截取不需要的旧图。每批最多一张设计画布大小、resolution=1 的纹理；1280×720 RGBA理论像素数据3,686,400字节，不冒称等于驱动实际显存占用。
- `world.markStageBoundary()` 是新世界批次投影能力，由 Controller 在真实停顿调用，现行共享/Zero/LegacyStageAdapter 已接。手工直接使用 World 投影的宿主也应在这些停顿调用；仅支持旧的无截取舞台并不会因此伪造出旧画面。

## 公开色彩调整与擦除

`preferences.setPostProcess` 仍属于玩家侧公开调整，不是作者剧情滤镜。中性 saturation/brightness/contrast 都为1；三个矩阵按顺序叠加，contrast=0得到中灰，disabled 恢复原始画面。既有画质开关继续控制这组可选处理。

`@wipe` 的缺省时长统一为文档中的600ms，显式时长原样按现有规则消费。

## Claude 本批工作

在原有转场指令表单中读取 Core 名称表并增加“溶解”选项，名称/时长继续通过原编辑事务修改与保存。解释先修改背景/人物再转场的顺序；不要把文字或菜单混进旧图，不要自行添加旧图存档字段。遮罩图选择、rule参数及滤镜表单等后端合同下一批再接。可复用已提供的 reading/inline/preview/flow 合同并按各自 PR 接入，不需要 Owner 转话。
