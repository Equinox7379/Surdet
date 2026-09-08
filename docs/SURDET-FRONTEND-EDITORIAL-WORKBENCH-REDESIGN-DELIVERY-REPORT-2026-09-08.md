# Frontend Pass 10：最终视觉系统与可访问性收口

Editor Pass 10 的本地实现、真实页面、聚合与 Luna 复核均通过；已推送 `cec7dc4806b7998dc5618e666b701ec553c8271a` 的 CI 在末尾发现既有 Starter 退出竞态。Owner 随后要求 Starter 全面重做与立绘风格调整，相关实现和本地验证已完成，详见 [Starter 交付记录](SURDET-STARTER-MODERNIZATION-DELIVERY-REPORT-2026-09-08.md)。本文件随施工提交冻结，远端结果以该提交的 GitHub Checks 为准；云端独立终审 pending。原 Editor 基线为 `434c8da43e645e7e8bdd4b2035081cc1017e7868`，下文保留该子项的验证记录。

## 实际范围

Editor 子项的生产修改仅在样式与 HTML 入口，原状态、导航回调、保存、DSL/EOL、预览 runtime 和审阅 authority 保持。Owner 后续追加的 Starter 全面重做、共用玩家入口、新项目模板与公共战斗输入门禁见 [Starter 交付记录](SURDET-STARTER-MODERNIZATION-DELIVERY-REPORT-2026-09-08.md)。Host/Shell、Authoring/Core/CLI/Agent Port 生产、正式游戏、格式、依赖与 lockfile 仍未改。

旧 `src/styles.css` 与加载入口已删除。源码搜索与九模式实际 computed style 的启用/禁用对照确认：主列伸缩迁到 `app-shell.css`；box sizing、selection、滚动条、字体与空状态原语进入 `components.css`；搜索、素材悬浮预览、问题与因果的必要结构进入 `script-workspace.css`；时间轴原先依赖全局皮肤的控件改用该工作区的紧凑语义样式。场景、步骤、徽章与主要工作区的旧卡片/色条皮肤已由语义层接管；无生产消费者的 `.cfg-table` 删除。没有整体搬迁旧文件、新兼容层、旧 token 或新增 `!important`。

实际截图暴露并关闭两处局部问题：缩略图错误文字越界到上一行，新增浏览器位置断言 RED 后约束在自身缩略图中；预览 iframe 的根容器内边距使按 viewport 适配的 canvas 底部裁切，边界断言 RED 后将 Editor `preview.html` 根内边距移除。最终四视口等待真实 resize 结算后，canvas 四边均在 iframe 内，操作带完整。原 V4 的已批准布局、Renderer 实现和运行时接线保持。

## 页面与验证

- 最终视觉/导航聚焦合同 12 文件 / 100 项通过；旧层退出合同最初因文件与 token 形成 2 项预期 RED。
- 实际构建页面覆盖九模式及 1792×900、1280×800、960×720、390×844，导航 Enter/Space、单工作面与单预览、原保存重开、真实预览插值、源码插入/搜索定位/独立撤销保持。
- “添加剧情”真实 modal 的 Space、Tab、Escape 和焦点返回、独立焦点轮廓、窄屏面板、长中文/路径、dirty、invalid JSON、空审阅、禁用时间轴预览、图像 loading/ready/error、reduced-motion 已由真实页面验证。只读审阅终态由现有合同测试覆盖。
- 使用临时 Chromium 扩展的 `chrome.tabs.setZoom(2)`；本机可见窗口实际从 1792×1000 变为 896×500 CSS viewport，devicePixelRatio 同比加倍，editor/assets/review 可操作。不是 CSS transform 或 CDP page-scale。
- Host/Shell 六组消费 6 文件 / 69 项、V4 module 35/35 加实际输入焦点、素材导入浏览器 26/26、Shell build 均通过；最终完整 V4 页面运行包含两处新增几何断言并通过。Renderer 生产未改，按 Goal 复用 Pass 9 Windows A–G 证据，不本地重复；远端保留 Pass 8 玩家步骤。
- 最终 `npm run verify:all` 全部通过，日志 `verify-all-final.log`：Editor 76 文件 / 721 项，Renderer 54 / 439，Host 11 / 87，Shell 23 / 200；包含这些工作区的 typecheck，Renderer/Host/Editor build 及其余根门禁，Shell build 单独通过。前两次真实失败保留：默认高并发下 Authoring worker 通道关闭（本机 16GB/32 逻辑核且可用内存不足 1GB）；一份旧动作范围测试无条件读取已删除文件。Authoring 单 worker 306 项通过，最终测试仅在任务进程限制并发；旧测试改读实际审阅语义层，保留原动作范围断言，定向 10 项通过。失败后定向修正，再完成最终全绿；未重复运行已通过的最终聚合。

六张代表截图输出到任务外部目录 `D:\CodexTasks\surdet-pass10-20260908\review`；CI 继续用既有 `surdet-v4-ui` artifact。故障占位与验证错误来自明确隔离 fixture，未改用户项目或 Starter 内容。首红、诊断与后续结果保留在 D 盘任务目录。

## 验收边界

未参与实现的 `luna_worker` 独立读取完整 diff、旧层与迁移后的源码、合同和真实结果；完成两处视觉修复、动作范围测试读取源与六张最终图补审，未发现确认的实质阻断。主代理亲自检查源码、红绿结果与图片；Luna 未代跑浏览器或代签云端终审。

本地验证不代签云端终审或 Owner 体验。真实中文输入法、Windows 原生目录选择器、物理手柄和 Windows 系统 DPI 切换未实测。未打包、release、部署或改写 Git 历史；Frontend Pass 11、主线 Wave 7、音频及后续主题未开始。

原 CI 聚合、素材导入、写回、V4 module/built Editor 与预览均成功；最后玩家测试多出一条 `Renderer runtime has already been disposed`，原错误总数断言 `4 !== 3` 未放宽。本机以真实 battle/pass 后延迟目标文档响应 1600 ms 复现：beforeunload 销毁 runtime 后，650 ms 敌方回调继续 showBattle。Owner 追加 Starter 授权后，在共用 adapter 中增加 reset/dispose 回调失效，并在入口先销毁 Host 再销毁 Renderer；生命周期聚焦及真实延迟导航已红绿关闭。该范围阻断已解除，当前继续新版 Starter 总体验证和新提交 CI；整体停止点仍为等待云端独立终审。
