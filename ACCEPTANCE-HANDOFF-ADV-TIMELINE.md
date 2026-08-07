# ADV 时间轴系统验收交接书

## 1. 批次目标

本批为“现代 ADV 演出基础”：将背景、立绘、镜头、屏幕处理、粒子和音频组织为可复用的多轨时间轴，并让 starter、编辑器预览和 Electron 发行包使用同一份时间轴定义。

本批不改变既有剧情分支、选择肢、存档槽位语义或旧项目的 DSL 合同。

## 2. 交付内容

- `packages/core/src/timeline.ts`：版本化 JSON 模型、校验、缓动和注册表。
- `@timeline <id>` 与 `@timeline <id> @ blocking`：非阻塞/可跳过的阻塞演出。
- `packages/renderer/src/timeline-player.ts`：可暂停、可快进、可恢复的纯逻辑时间轴播放器。
- `packages/renderer/src/pixi-stage.ts`：背景交叉淡化、立绘入场/移动/表情切换、镜头、淡入、调色和粒子投影。
- `examples/starter/content/timelines/`：原创开场时间轴示例。
- `packages/editor/src/preview.ts` 与 `preview-panel.ts`：预览加载、校验和重载清理。
- `docs/dsl-spec.md`、`docs/AI-GUIDE.md`：作者和 AI 可直接使用的时间轴说明。

## 3. 有意为之

1. 时间轴是可选层；没有 `content/timelines` 或没有 `@timeline` 的旧项目不需要迁移。
2. 本批提供稳定 JSON schema 和预览播放，暂不提供拖放式时间轴编辑器；后续 UI 可以复用同一 schema，不会再造一套运行时。
3. 缺失图片/音频沿用现有占位或静默回退策略，单个素材问题不应阻塞游戏启动。
4. 阻塞时间轴使用现有 `awaiting-timer` 生命周期，以保证普通点击、快进、自动播放和存档行为一致。
5. 读档恢复时间轴游标和静态 presentation snapshot，不重新执行早先剧情，也不让旧时间轴回调污染新场景。

## 4. 自动验证基线

执行目录：`<local-path> Project\surdet`

```text
npm run typecheck
npm run test
npm run lint -w surdet-starter
npm run simulate -w surdet-starter
npm run build
git diff --check
```

时间轴相关定向测试包含：schema 校验与注册、DSL 编译、阻塞生命周期、存档 presentation 快照、播放器插值/跳过/恢复、Pixi 投影、starter 时间轴加载、编辑器 postMessage 传输和坏 JSON 隔离。

## 5. 手动验收

由用户在 `http://127.0.0.1:5174/` 的编辑器预览或 starter 页面目检：

1. 刷新并开始游戏，首段应从黑场淡入背景，立绘按时间轴入场并发生表情/位置变化。
2. 开启快进或点击阻塞演出，时间轴应立即完成并继续对白。
3. 在演出中快速存档、读档，画面应恢复到存档时刻，不重复叠加旧立绘、背景或效果。
4. 在 1280×720、窄窗口和移动尺寸下，背景保持比例裁切，立绘和对白不溢出。
5. 编辑器预览重载后，旧时间轴和旧画面不残留；缺少时间轴目录的旧项目仍可正常播放。

## 6. 已知范围

- 时间轴定义由 JSON 编写，当前没有可视化轨道编辑器。
- 视觉观感仍以用户目检为最终标准；本批命令行验证不能替代素材、构图和动效的主观验收。
- Windows Electron 包含 starter 时间轴文件的最终检查需要在发行构建完成后执行。

## 7. 审阅报告格式

```text
【ADV 时间轴批次审阅报告】
自动验证：typecheck / test / lint / simulate / build / diff --check —— 逐项通过或失败
核心复核：schema、blocking、skip、save/load、旧项目兼容
宿主复核：starter 与编辑器是否使用同一时间轴定义，重载是否清理旧状态
问题清单：按 Major/Minor 列出文件与位置；没有则写“无”
手动验收：逐项记录实际结果
```
