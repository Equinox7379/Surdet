# Surdet 场景路径安全生命周期任务书

日期：2026-09-02
目标：修复嵌套场景重命名/删除的保存与重开边界，完成后停止
设计依据：`docs/superpowers/specs/2026-09-02-surdet-scene-path-safe-lifecycle-design.md`

## Task 0：基线与红灯

- 核对当前分支、远端同步状态和既有未跟踪文件，创建 D 盘任务临时目录。
- 在 `project-io.test.ts` 建立嵌套重命名/删除保存合同：保持目录、先写后删、失败留待处理。
- 在 Flow/Sidebar 测试建立精确 scene key、歧义拒绝和原生按钮合同。
- 只运行一次最小聚焦测试，确认旧实现准确失败。

## Task 1：路径安全保存

修改：

- `packages/editor/src/state.ts`
- `packages/editor/src/project-io.ts`
- `packages/editor/src/main.ts`

要求：

- 增加最小的场景待删除状态；项目切换时清空。
- 从 `SceneEntry.file` 解析并校验 `content/scenario` 下相对路径。
- null handle 场景按真实相对目录创建，不再固定写根目录。
- 保存新场景完成后，才处理对应旧路径；失败保留记录与 dirty 状态。
- dirty、关页保护、项目栏和保存结果包含场景待删除。

## Task 2：精确场景操作

修改：

- `packages/editor/src/panels/flow.ts`
- `packages/editor/src/panels/sidebar.ts`
- `packages/editor/src/main.ts`

要求：

- rename/delete 内部以 scene key 为目标。
- 流程图从 sceneId 解析唯一 key；零个或多个匹配都拒绝写入。
- 重命名保持原目录并登记旧文件；不得立即删除磁盘文件。
- 删除登记精确路径，真正删除交给“保存全部”。
- 未保存的连续重命名/重命名后删除明确阻止。
- 项目入口或宿主配置仍引用目标场景时拒绝操作，避免留下已知悬空配置。
- 拒绝大小写别名、待删路径复用与现有目标覆盖；重复 sceneId 时不得批量改写含糊引用。
- 保存、重命名和删除串行执行；存在待保存场景操作时不得静默切换项目。
- 场景目录提供原生“重命名”“删除”按钮并复用同一操作。

## Task 3：视觉与可访问性

修改：

- `packages/editor/src/styles/script-workspace.css`

要求：

- 场景行仍以场景选择为主，动作作为次级文字按钮。
- 不增加彩色单侧线、胶囊、浮空动作或卡片墙。
- 长路径可截断并保留 title；窄屏不产生页面横向溢出。
- 键盘 focus 清楚，按钮不能仅在鼠标 hover 时可达。

## Task 4：验证与交付

- 运行 Flow/Sidebar/Project IO 最相关测试。
- 运行 Editor typecheck 与一次生产 build，所有可控输出写到 D 盘。
- 使用隔离内存文件句柄完成一条“嵌套改名 → 保存 → 重读”和“嵌套删除 → 保存 → 重读”行为检查；不触碰用户项目。
- 让 Luna 只读复核数据顺序、歧义边界和未保存投影。
- 检查最终 diff，只提交本任务文件；创建普通提交并普通 push。
- 查看推送后的 CI；普通红灯在同一任务内最小修复。
- 将结果简短追加到长期路线台账，台账继续保持未跟踪。
- 到此停止，不启动 Frontend Pass 8 或主线 Wave 7。
