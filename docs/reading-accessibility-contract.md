# 阅读辅助：后端与前端接入

Owner于2026-10-10允许本机在Claude额度恢复前继续后端。此批基于行内标签后端，不代签Claude设置页/Editor接入，不覆盖日常桌面包。

## 唯一设置表

Core导出`GAME_SETTING_DEFINITIONS`、`GameSettings`、`DEFAULT_GAME_SETTINGS`和`normalizeGameSettings`。表包含类型、缺省、范围、中文名称、所属页、是否允许作品UI修改；数值控件另含步长。Renderer现有设置存储/步进、Core作品UI验证都消费该表。Editor名单待Claude改为读取此表。

| 字段 | 保存值 | 缺省与行为 |
| --- | --- | --- |
| `textScale` | 0.8–1.4 | 1。对白/NVL/记录/默认选项正文为作品字号×玩家倍率×行内size；系统菜单与名字栏不放大。 |
| `dialogueOpacity` | null或0–1 | null跟随作品主题，0明确透明。ADV与名字底板用指定值，NVL底板按作品基准比例变化。 |
| `reducedMotion` | boolean | 没有设备记录时采用系统prefers-reduced-motion；明确保存的true/false优先，不实时跟随系统变动。 |
| `readAloud` | boolean | false。用本地系统语音朗读没有配音的可见台词，不请求网络或生成素材。 |

设置属于设备，不进剧情变量、Profile或存档。存储成功后才投影；失败保留最后确认值。坏类型使用缺省、数值限幅；null/0/false不能用真假判断合并。原设置范围与只读字段保留，不开放任意字段写入。

`createSettingsRows(settings)`提供数值项与布尔行，项目语言仍由宿主提供；`stepSetting(..., dialogueDefault)`从真实作品底板值开始步进透明度。两种现有Player已经接上同一套后端。

## 渲染与朗读

- `commands.preferences.setReadingPreferences({textScale, dialogueOpacity})`只改阅读投影，不改作品主题；重复调用不累乘，重新应用作品主题仍保留设备偏好。
- `commands.preferences.setPresentationPreferences({reducedMotion})`已接World和Dialogue。flash无白色帧、shake无位移，转场/淡入淡出完成；时间轴只完成当前视觉插值，不跳过剧情时钟、音频与事件顺序。关闭开关后已完成的视觉cue不倒退，后续新cue恢复正常动效。粒子/动态立绘冻结，不丢场景内容。
- 选项/提示立即可见，继续指示不晃动；提示仍按原时间消失。关闭减少动态不再留下永久为零的transitionScale。
- `controller.setReadAloud(enabled, locale, volume)`控制朗读；共享`applyReadingSettings(settings,commands,controller,locale)`已接两个Player。开启后从下一句开始，主音量×语音音量作用于下一句；有配音优先，不在配音失败后猜测替代。
- 下一句、快进、菜单/记录、读档/重置、销毁取消朗读；同句w不切断。自动阅读等朗读结束或明确报错解除等待；迟到回调不干扰新句。菜单关闭不重播整句。
- 缺少本地语音最多等2秒语音列表事件，随后提示不可用并释放等待。只用localService语音。Windows现行打包Electron已实测本机中文语音start/end；静音能力检查不代签人耳音质。

## Claude前端范围

1. 设置页按表呈现四项；布尔为开关，透明度保留“跟随作品”。复用SettingsStore成功后投影，不另造存储。
2. UI设计器设置名单从Core表派生。作品slider绑定textScale/dialogueOpacity，toggle绑定reducedMotion/readAloud；类型不符Core拒绝，现有作品自定义控件已实测读写。
3. Editor预览提供字号/减少动态临时试看，用上述Renderer命令，不能改作品配置或玩家设备设置。
4. 完全自定义DOM正文/选项需适配阅读倍率，Canvas变化不会自动修改任意作者DOM布局；系统界面不缩放。请验证键盘焦点、滚动和宽窄窗口。
5. 本批可见UI接入面包括Renderer的`project-ui-dom.ts`；Core/Renderer状态语义、朗读服务、Player宿主数据接线由本机负责，不重写第二套。

NVL/记录样式、记录入档和文字动画仍是下一批。没有本地全仓或正式性能资格化，实际定向结果见原台账。
