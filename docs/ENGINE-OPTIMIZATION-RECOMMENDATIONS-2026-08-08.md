# Surdet 引擎后续优化建议

## 一、提交本建议的背景

本建议基于 commit `3ecd43a`：该提交发布了审计整改成果和本次体验优化 Wave 1 计划。它不表示本计划 Task 1–13 已全部实现；后续实现必须按任务书逐项执行，并以各任务的阶段检查点、回归测试和正式包验收为准。

当前代码可以继续作为正式游戏开发基础，但下一阶段的主要矛盾已经从“功能有没有”转为：

- 多个游戏宿主接线重复；
- Renderer 核心类职责过重；
- 全局通关数据与普通存档边界不够清晰；
- README、交接文档和实际代码出现事实漂移；
- 工作树缺少明确的提交与临时产物治理规则。

以下建议只针对引擎通用能力，不针对某一部游戏做特判。

## 二、现状证据

### 1. 宿主接线重复

当前两个示例游戏的宿主入口：

- examples/starter/src/main.ts：约 1328 行
- examples/zero-after-midnight/src/main.ts：约 1399 行

两者都重复包含：

- system 事件分发；
- 日历、战斗、好感、事件、成就、商店接线；
- 宿主暂停/恢复剧情；
- 存档与系统快照往返；
- 标题、回想、菜单、快捷键；
- 周目通关记录与新周目继承。

当前没有 @surdet/host 或 createDefaultHost 公共层。引擎核心虽然提供了 headless 求解器，但每个项目仍需复制大量宿主流程代码。

### 2. Renderer 核心类过重

当前规模：

- packages/renderer/src/pixi-stage.ts：约 3502 行
- packages/renderer/src/adv-renderer.ts：约 784 行

PixiStage 同时负责：

- 背景、立绘、转场、粒子和调色；
- 对话框、Ruby、NVL、Backlog；
- 标题、系统菜单、存档界面、设置界面；
- 鉴赏、战斗、地图、商店、据点指令；
- 帧更新、对象生命周期和部分输入交互。

这不是当前运行时故障，但会显著增加后续改动的回归范围和测试成本。

### 3. 文档事实已经出现漂移

README 中仍有部分旧结论，例如：

- particle/mov/tint 仍被描述为未实现；
- 文本回想仍被描述为无 UI；
- 战斗移动仍被描述为未完成。

但当前代码、DSL 规范和测试已经证明：

- particle/mov/tint 已有 Renderer 实现和回归测试；
- 鉴赏界面已有文本 Tab 和场景重播入口；
- 战斗已有 1D 移动、移动消耗行动、AI 移动和快照字段。

这说明需要建立“代码能力矩阵 → README/DSL 文档”的同步机制。

### 4. 全局通关数据边界

普通 F5/F9 存档已经优先使用 Electron 的 surdetSave 桥，浏览器环境才回退到 localStorage。

但全局周目通关记录 surdet:clearRecord 当前直接使用 localStorage。这并非普通存档失效，而是缺少独立 Profile/Global State 存储接口：

- 普通存档属于 slot；
- 周目通关记录属于用户/游戏 Profile；
- 两者不应混成同一个槽位；
- 但两者都需要统一的原子写入、版本校验和备份策略。

### 5. 工作树治理

当前工作树包含大量已完成代码和未跟踪文档，同时还存在：

- .vite 缓存；
- shot_*.png 验收截图；
- shot*.mjs 临时浏览器脚本；
- 根目录 main.js、preload.js 临时产物；
- 编辑器日志和开发日志；
- AI 工具状态目录。

这些内容不应与引擎源码混在同一个提交批次中。

## 三、建议执行队列

### P0：文档和仓库治理

目标：先让仓库内容和实际能力一致，降低后续审计误报。

建议：

1. 建立 docs/capability-matrix.md，按“指令 / Core / Renderer / Editor / Host / Test / 文档状态”记录能力。
2. README 的“已实现”和“已知限制”全部以能力矩阵为依据。
3. 为过程交接文档增加归档规则，区分正式技术文档、验收证据、历史交接材料和 AI 会话记忆。
4. 将截图、日志、缓存、工具状态和根目录临时脚本纳入明确的 .gitignore 规则。
5. 在提交前增加仓库卫生检查，阻止 .log、.vite、截图和临时运行产物进入提交。

验收标准：

- README 不再与 DSL 规范、实际测试相互矛盾；
- git status 不再被工具产物长期污染；
- 新成员能区分当前能力和历史交接记录。

### P1：抽取 @surdet/host

目标：让游戏宿主从“复制整套接线”变成“配置通用宿主”。

建议新增独立 workspace：

~~~text
packages/host/
  src/create-host.ts
  src/system-router.ts
  src/save-hooks.ts
  src/profile-store.ts
  src/types.ts
  test/
~~~

建议 API 方向：

~~~ts
createDefaultHost({
  interpreter,
  renderer,
  stage,
  systems,
  saveStorage,
  profileStorage,
  featureFlags,
  callbacks,
});
~~~

设计边界：

- core 继续保持 headless，不依赖 Renderer 或 Electron；
- host 负责 system 事件路由、暂停/恢复、存档 hooks 和通用覆盖层流程；
- 游戏项目只提供配置、资源映射、剧情特有回调；
- 商店、战斗、地图等都通过可替换 adapter 接入；
- 不把 zero-after-midnight 的标题、场景、素材名写入通用层。

验收标准：

- starter 与正式游戏的 main.ts 显著缩短；
- 两个项目共用同一套 host 回归测试；
- 任一项目可以关闭 battle/calendar/shop 等可选能力；
- 存档、读档、system pause/resume 行为与当前版本一致。

### P1：拆分 Renderer UI 层

目标：保留 PixiStage 作为兼容外观，内部拆分职责。

建议分层：

~~~text
PixiStage facade
├── WorldLayer       背景、立绘、摄像机、转场、粒子、调色
├── DialogueLayer    对话框、Ruby、NVL、Backlog
├── MenuLayer        标题、系统菜单、设置、存档
├── GalleryLayer     CG、音乐、文本回想
├── SystemPanelLayer 战斗、地图、商店、据点指令
└── RenderLifecycle  ticker、FrameScheduler、资源释放
~~~

拆分原则：

- 第一阶段只搬迁实现，不改变公共 AdvStage 接口；
- 每个 Layer 都有独立的可测输入视图模型；
- 生命周期由统一的 ResourceLifecycle 管理；
- 所有动画继续服从 reduced-motion 和 FrameScheduler；
- 最后再考虑移除 Facade 内部兼容代码。

验收标准：

- pixi-stage.ts 降为装配与兼容转发；
- 战斗、回想、地图、商店可以独立测试；
- 资源销毁、补间解绑和对象池测试继续通过；
- 不增加重复的 ticker 或事件监听器。

### P1：增加 Profile 存储桥

目标：把全局通关记录从宿主直接写 localStorage，提升为可替换的 Profile 存储。

建议接口：

~~~ts
interface ProfileStorage {
  read(key: string): Promise<unknown | null>;
  write(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
~~~

Electron 实现落在 userData/profile/，浏览器实现保留 localStorage 回退。

建议纳入：

- 周目通关记录；
- 全局结局收集；
- 未来全局设置和用户偏好；
- 版本化迁移；
- 原子写入；
- 损坏数据回退。

验收标准：

- 普通 slot 存档和 Profile 数据边界清晰；
- Electron 与浏览器行为一致；
- Profile 损坏不会阻塞新游戏；
- 不读取或迁移用户已有真实存档，除非明确提供迁移版本。

### P2：战斗系统产品化

当前已经有 1D 移动和基础 AI，但仍缺少真正的阵型编辑体验。

后续可拆成三个独立里程碑：

1. BattleLayout 数据模型：明确位置、占位、阻挡和阵营边界；
2. 阵型编辑 UI：开战前拖拽/交换单位，保存为战斗开始快照；
3. 战斗阶段模型：布阵、行动、结算、回合结束等阶段明确化。

建议不要直接把“阵型编辑”塞进现有 PixiStage.showBattle，应先定义 headless 规则和快照格式。

### P2：演出与性能扩展

当前 particle/mov/tint 已实现，不应重复立项为缺陷。可考虑的下一层能力：

- 可注册转场；
- BGM 与环境音双层混音；
- 可配置 reduced-motion；
- 立绘差分层；
- 资源按需加载与预加载队列；
- 纹理和 Blob URL 的统一生命周期；
- 对演出帧耗时、资源命中率、加载失败率的可视化诊断。

所有新增演出功能必须同时具备：

- 自动化测试；
- reduced-motion 行为；
- 生命周期释放；
- 存档/读档投影策略；
- 正式包资源校验。

## 四、不建议当前立项的内容

以下内容目前不应作为“已存在缺陷”立项：

- particle/mov/tint 未实现；
- 文本回想完全没有 UI；
- 战斗完全没有移动；
- 普通 F5/F9 不使用 Electron 存档桥；
- 只因为 PixiStage 文件很大就立即重写全部渲染层；
- 只因为工作树很脏就直接批量删除文件。

它们中部分是旧文档误报，部分是产品增强项，部分是架构债务，性质不同，应分开管理。

## 五、建议总经理审批的优先顺序

建议顺序：

1. P0：能力矩阵、README 修正、仓库卫生规则；
2. P1：@surdet/host 宿主层抽取；
3. P1：Profile 存储桥；
4. P1：Renderer UI 分层；
5. P2：战斗阵型与阶段模型；
6. P2：演出扩展和更深的资源/性能优化。

总体判断：

> 当前引擎已经具备继续开发正式游戏的基础。下一阶段最值得投入的不是继续堆单点功能，而是把“宿主接线、渲染 UI、Profile 存储、文档事实”四条边界稳定下来，使后续每部游戏都能复用引擎能力，而不是复制上一部游戏的实现。
