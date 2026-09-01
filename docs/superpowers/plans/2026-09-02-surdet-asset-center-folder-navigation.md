# Surdet 素材中心目录导航实施计划

> **For agentic workers:** 在当前会话按任务顺序执行；Luna 仅在代码完成后按需进行只读复核，不负责提交或最终判断。

**Goal:** 在不增加素材事实源或写操作的前提下，为素材中心增加可组合、可访问、适配窄屏的只读目录导航。

**Architecture:** 新建一个无状态纯函数模块，从现有 `ProjectAssetItem.sourcePath` 生成安全目录选项、面包屑和路径匹配结果。素材中心把目录作为现有搜索/分类/状态/排序之外的第五个筛选轴，并在素材库标题区渲染位置选择器与面包屑。

**Tech Stack:** TypeScript、原生 DOM、CSS、Vitest。

## Global Constraints

- 生产代码只修改 `packages/editor`。
- 不修改 Authoring、CLI、Agent Port、导入 authority、项目文件、依赖或 lockfile。
- 不增加目录新建、改名、移动、删除、覆盖或磁盘扫描。
- 不增加第二套素材索引；目录事实仅来自当前 `ProjectAssetItem.sourcePath`。
- 普通用户文案使用中文；物理文件夹名作为用户数据原样显示。
- 不引入彩色选中竖线、卡片墙、悬浮操作条或新的设计 token。

---

### Task 1: 安全目录投影

**Files:**
- Create: `packages/editor/src/panels/asset-center-folders.ts`
- Create: `packages/editor/test/asset-center-folder-navigation.test.ts`

**Interfaces:**
- Produces: `buildAssetFolderOptions(items): AssetFolderOption[]`
- Produces: `assetMatchesFolder(item, folder): boolean`
- Produces: `assetFolderBreadcrumbs(folder): AssetFolderBreadcrumb[]`

- [ ] **Step 1: 建立失败合同**

覆盖安全根目录、嵌套目录、父级计数、稳定顺序、`bg`/`bg2` 边界、反斜杠规范化、绝对路径、`.`、`..`、无物理文件和重复路径。

- [ ] **Step 2: 运行聚焦 RED**

Run: `npm run test -w surdet-editor -- --run test/asset-center-folder-navigation.test.ts`

Expected: FAIL，因为纯目录模块尚不存在。

- [ ] **Step 3: 写最小纯实现**

核心接口：

```ts
export interface AssetFolderOption {
  path: string;
  label: string;
  depth: number;
  count: number;
}

export function assetMatchesFolder(
  item: ProjectAssetItem,
  folder: 'all' | string,
): boolean;
```

只有规范化后位于 `content/assets` 路径段边界内的物理素材进入目录投影。

- [ ] **Step 4: 运行聚焦 GREEN**

Expected: 新目录测试全部通过。

### Task 2: 目录筛选状态与组合语义

**Files:**
- Modify: `packages/editor/src/state.ts`
- Modify: `packages/editor/src/panels/asset-center.ts`
- Modify: `packages/editor/test/asset-center-filter.test.ts`

**Interfaces:**
- Consumes: `assetMatchesFolder()`
- Produces: `state.assetCenterFolder: 'all' | string`

- [ ] **Step 1: 扩展筛选测试**

证明目录可与查询、分类、状态和排序组合；切换到不存在的目录时在渲染入口恢复为 `all`；直接定位大文件或问题素材时清除目录限制。

- [ ] **Step 2: 运行聚焦 RED**

Run: `npm run test -w surdet-editor -- --run test/asset-center-filter.test.ts`

Expected: FAIL，因为现有筛选不读取目录状态。

- [ ] **Step 3: 接入目录轴**

把目录参数加入现有 `matchesAssetFilters()`，同时保证 `assetFacetCount()` 与实际素材列表使用同一目录约束。项目刷新后如目录选项消失，在读取筛选结果前恢复为 `all`。

- [ ] **Step 4: 运行聚焦 GREEN**

Expected: 筛选与目录测试全部通过。

### Task 3: 位置选择器、面包屑与响应式布局

**Files:**
- Modify: `packages/editor/src/panels/asset-center.ts`
- Modify: `packages/editor/src/styles/asset-center.css`
- Modify: `packages/editor/test/editor-asset-center-contract.test.ts`

**Interfaces:**
- Consumes: `buildAssetFolderOptions()`、`assetFolderBreadcrumbs()`
- Produces: `[data-asset-folder-control]` 与 `[data-asset-folder-crumb]`

- [ ] **Step 1: 建立 DOM/CSS RED**

要求中文“位置”标签、选择器、当前目录数据属性、逐级面包屑、`aria-current`、焦点恢复，以及 800px 下的纵向控件与可滚动面包屑。

- [ ] **Step 2: 运行聚焦 RED**

Run: `npm run test -w surdet-editor -- --run test/editor-asset-center-contract.test.ts`

Expected: FAIL，因为新控件尚不存在。

- [ ] **Step 3: 实现 UI**

位置选择器与排序并列在素材库标题区；当前目录存在时在标题下显示面包屑。改变目录后重新渲染并把焦点恢复到位置控件；点击面包屑后把焦点恢复到对应层级按钮。

- [ ] **Step 4: 运行聚焦 GREEN**

Expected: 三个素材中心聚焦文件全部通过。

### Task 4: 最终验证、复核与交付

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-project-roadmap-and-decision-ledger.md`（只追加最终事实，不提交）

- [ ] **Step 1: 运行最小充分验证**

Run:

```text
npm run test -w surdet-editor -- --run test/asset-center-folder-navigation.test.ts test/asset-center-filter.test.ts test/editor-asset-center-contract.test.ts
npm run typecheck -w surdet-editor
npm run build -w surdet-editor
```

- [ ] **Step 2: 实际浏览器检查**

在一个桌面尺寸和 800px 视口检查目录选择、面包屑、组合筛选、焦点与横向溢出；不保存截图证据包。

- [ ] **Step 3: Luna 只读复核**

仅在代码完成后检查路径边界、状态自愈、筛选组合与响应式可访问性。主代理核对实际 diff 并处理有效 finding。

- [ ] **Step 4: 精确提交并普通推送**

只暂存本计划列出的新规格、计划、Editor 生产与测试文件；不暂存长期台账和既有未跟踪路径。提交后 fetch，确认远端没有分叉，再普通 push。

## Execution Closure

- 纯目录合同 RED 为模块缺失；GREEN 为 4/4。
- 目录组合筛选 RED 准确暴露跨目录结果泄漏；最终三个素材中心聚焦文件 16/16 通过。
- Luna 只读复核发现项目切换时同名目录筛选可能残留；普通项目与演示项目均建立永久 RED，并通过两处最小状态重置修复为 2/2。
- Editor 全量 65 个文件、528 项测试通过；typecheck 与生产 build 通过。
- 隔离浏览器在 1440px 与 800px 验证目录选项、后代筛选、面包屑、焦点恢复和页面无横向溢出；未生成截图或证据包。
