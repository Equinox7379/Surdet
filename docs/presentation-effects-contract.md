# 演出后端与前端接入合同

当前交付：公开色彩调整纠错、旧世界 `dissolve` / `rule` 与旧图生命周期、四种作者 `@filter`、遮罩素材链。时间轴转场尚未交付，不能按规划草案当作可用接口。Editor 表单由 Claude 完成；本批没有改可见界面。公开创作合同2.36.0（73能力）。

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

- Core 唯一登记 `BUILTIN_TRANSITION_NAMES`：fade、slide-left、slide-right、circle、dissolve、rule；`BuiltinTransitionName`、Lint、Renderer 名称类型共用此表。未知名称报 T010，运行入口返回 false；不要在 Editor 另造名单。
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

## 灰度遮罩转场

```gal
@bg new_room
@transition rule 800 @rule="百叶窗 遮罩" @soft=.15 @reverse=false
新画面。
```

- `rule` 名称固定；`@rule` 必须是遮罩素材键，`@soft` 为0–1（默认.15），0为硬边，`@reverse` 不提供为false，裸开关为true，也接受true/false/1/0。`parseRuleTransition` 是Core唯一参数解析函数，消费已经解码的修饰符；编译错误码TRANSITION_INVALID，未知修饰符仍提示W003。不允许选项箭头后的扁平指令串携带这些修饰符，请使用选项下的普通缩进指令块。
- `content/assets/rule/` 的PNG/JPEG/WebP/GIF/AVIF/SVG按文件名（不含扩展名）成为遮罩键。必须唯一、物理存在且格式受支持；`project.assets.rules`返回图片事实，`intelligence`公开rule分类、引用和可复制的`usage.scene`，没有虚构时间轴示例。Agent素材导入、HTTP素材导入及改名/整理复用原事务，kind=rule；改名只更新实际transition.rule参数，不改正文、注释和同名背景。
- `project.validate`/CLI lint缺少、重名或不支持的遮罩报RULE_ASSET_UNRESOLVED错误；候选新增或修改先检查`asset:rule:键`，封存仍走原依赖链。素材存在不代表成功解码，实际Player加载验证单独进行。运行遇到未加载遮罩会提示并使用原fade；没有舞台修改的rule和dissolve一样是成功无操作。活动遮罩被释放时转场结束、显示新世界并给出日志。
- 公共接线：`commands.assets.registerRule(key, source, format?)`、`commands.world.transition('rule', duration, {rule,soft,reverse})`。Renderer借用注册遮罩，只拥有旧世界纹理和滤镜；纹理刷新不保留已释放旧source。共享Player和Zero已按rule目录注册，既有素材收集规则覆盖该目录。Editor试玩仍须由Claude补加载，不会因本机后端完成自动具备。
- 低亮度遮罩区域先显示新世界，白色区域最后；reverse反转此顺序，soft控制揭示边缘。仅过滤旧世界覆盖图，不处理对白/菜单。沿用dissolve的捕获批次、最多一张旧图、释放、读档/回退结束画面及减少动态规则，不增加存档字段或兼容分支。
- 提供GLSL和WGSL实现。Windows当前实际Player的WebGL像素路径、沿用Starter禁unsafe-eval的CSP均已验证，没有放宽生产安全策略；本机浏览器没有可用WebGPU adapter，WGSL实际设备执行未验证，不以类型检查代签。

## 作者滤镜

`@filter 名称 [时长毫秒]`；Core唯一`STORY_FILTER_NAMES`为blur（模糊）、grayscale（灰度）、sepia（怀旧）、vignette（暗角）、off（清除）。缺省时长0、立即应用；显式0–600000ms，未知名称、越界/非有限时长或多余位置参数在Core编译前拒绝，错误码FILTER_INVALID。修饰符不参与此指令，按现有W003提示未消费。

```gal
@filter grayscale 600
回忆中的街道。
@filter off 400
现在的街道。
```

- Renderer公开`world.setStoryFilter(name, durationMs=0)`，支持的正式宿主都已接线。没有这项能力的自定义宿主显式报错，不模拟成功或偷偷当作旧指令。
- 四种效果互斥为目标状态，换效果时原强度降为0、新强度升为1，过渡中可以同时有两个效果。颜色/模糊只处理背景、人物、独立图层所在的worldContainer，不处理对白、菜单、全屏fade/flash；暗角在世界染色上方、旧图下方、UI外。
- 与玩家侧`PostProcessSettings`独立。关闭玩家色彩调整不会关作者滤镜；low画质保留灰度、怀旧、暗角，模糊保持可见但quality降为1。减少动态立即显示目标滤镜。
- `presentation.payload.stage.storyFilters`（Core完整存档位置）包含`values:{blur,grayscale,sepia,vignette}`，每项0–1；过渡时另有`motion:{target:同形四值,duration,remain}`。快照以当前强度为起点、只保存剩余时长，恢复后不会再次计入已经经过的进度；没有该字段表示没有作者滤镜，不表示保留当前滤镜。恢复和验证仍走完整演出事务，不添加存档版本分支或迁移层。
- 坏强度/过渡在预检阶段拒绝，现有世界与滤镜不变。新游戏和清舞台清除作者滤镜；菜单暂停冻结这条World帧链；销毁释放自有Blur/ColorMatrix资源与单张暗角纹理，不销毁作品素材。
- `scene.patch`原insert/replaceInstruction可编排filter；无新写盘路径。候选事实仍走原通道，完整游戏渲染与视觉验收不是simulate通过可以代签。

## Claude 本批工作

在原有转场指令表单中读取 Core 名称表并增加“溶解”“遮罩”选项，名称/时长继续通过原编辑事务修改与保存。rule从`project.assets.rules`选择已解析图片，写回rule/soft/reverse修饰符；素材中心、导入、缩略图及统计的有限分类补“转场遮罩”，Editor试玩资源加载调用registerRule。四处Record字典须补rule：asset-center-thumbnails.ts:16、asset-center.ts:22、asset-import-workbench.ts:10/138；不需后端改名别名或新写盘通道。解释先修改背景/人物再转场的顺序；不要把文字或菜单混进旧图，不要自行添加旧图存档字段。filter表单读取STORY_FILTER_NAMES，用上述中文名称显示，写回DSL英文值；第二位置参数写时长，不是强度，off同样支持过渡。可复用已提供的 reading/inline/preview/flow 合同并按各自 PR 接入，不需要 Owner 转话。
