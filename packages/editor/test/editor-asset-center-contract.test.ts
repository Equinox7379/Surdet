import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const editorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEditorFile(relativePath: string): string {
  const absolutePath = path.resolve(editorRoot, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
}

function ruleBodiesMatching(css: string, selectorPattern: RegExp): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => selectorPattern.test(match[1] ?? ''))
    .map((match) => match[2] ?? '');
}

const modeSource = readEditorFile('src/shell/editor-modes.ts');
const mainSource = readEditorFile('src/main.ts');
const stateSource = readEditorFile('src/state.ts');
const projectIoSource = readEditorFile('src/project-io.ts');
const centerSource = readEditorFile('src/panels/asset-center.ts');
const relocationWorkspaceSource = readEditorFile('src/asset-relocation-workspace.ts');
const folderSource = readEditorFile('src/panels/asset-center-folders.ts');
const thumbnailSource = readEditorFile('src/panels/asset-center-thumbnails.ts');
const sidebarAssetSource = readEditorFile('src/panels/assets.ts');
const centerCss = readEditorFile('src/styles/asset-center.css');
const indexSource = readEditorFile('index.html');

describe('editor Asset Center contract', () => {
  it('adds a first-class mode between Script and Flow and consumes shared intelligence', () => {
    expect(modeSource, 'editor modes source must exist').toContain('EditorModeId');
    const modeList = modeSource.match(/EDITOR_MODES[\s\S]*?as const/)?.[0] ?? '';
    expect(modeList).toMatch(/id:\s*'editor'[\s\S]*id:\s*'assets'[\s\S]*id:\s*'flow'/);
    expect(modeList).toMatch(/id:\s*'assets'\s*,\s*label:\s*'素材'\s*,\s*panelId:\s*'asset-center-view'/);
    expect(mainSource).toMatch(/state\.mainTab\s*===\s*'assets'/);
    expect(mainSource).toMatch(/renderAssetCenter/);
    expect(mainSource).toMatch(/asset-center-view/);
    expect(stateSource).toMatch(/assetIntelligence/);
    expect(stateSource).toMatch(/ProjectAssetIntelligence/);
    expect(centerSource).toMatch(/assetIntelligence/);
    expect(sidebarAssetSource).toMatch(/assetIntelligence/);
  });

  it('keeps the primary vocabulary Chinese and exposes complete categories and filters', () => {
    expect(centerSource, 'Asset Center panel must exist').toContain('asset-center');
    const primaryCopy = `${centerSource}\n${folderSource}\n${centerCss}`;
    for (const label of [
      '背景', '立绘', '头像', '音乐', '环境音', '音效', '语音', '视频', '字体', '其他',
      '已引用', '未引用', '引用缺失', '同名冲突', '命名异常', '格式待确认',
      '空间占用', '大文件', '项目状态', '项目路径', '名称', '文件大小', '引用数量', '需要处理', '需处理素材',
      '未引用单独统计，不计入需处理素材',
      '位置', '全部位置', '素材根目录',
    ]) {
      expect(primaryCopy, `missing Chinese Asset Center label: ${label}`).toContain(label);
    }
    expect(centerSource).toMatch(/search|搜索/i);
    expect(centerSource).toMatch(/status|状态/);
    expect(centerSource).toMatch(/kind|类别|分类/);
    expect(centerSource).toMatch(/filter|筛选/);
  });

  it('freezes Agent-readable asset identity, status, source locations, and keyboard selection', () => {
    expect(centerSource).toMatch(/data-asset-id|dataset\.assetId/);
    expect(centerSource).toMatch(/data-asset-kind|dataset\.assetKind/);
    expect(centerSource).toMatch(/data-asset-status|dataset\.assetStatus/);
    expect(centerSource).toMatch(/data-source-path|dataset\.sourcePath/);
    expect(centerSource).toMatch(/data-source-line|dataset\.sourceLine/);
    expect(centerSource).toMatch(/data-object-ref|dataset\.objectRef/);
    expect(centerSource).toMatch(/aria-selected/);
    expect(centerSource).toMatch(/keydown|role['\"]\s*,\s*['\"]option/);
    expect(centerSource).toMatch(/Enter|Space|button/);
    expect(centerSource).toMatch(/requestAnimationFrame[\s\S]*assetId[\s\S]*\.focus\(\)/);
    expect(centerSource).toMatch(/asset-center-(?:rail|library|inspector)/);
    expect(centerSource).toMatch(/dataset\.assetQuery/);
    expect(centerSource).toMatch(/dataset\.assetKindFilter/);
    expect(centerSource).toMatch(/dataset\.assetStatusFilter/);
    expect(centerSource).toMatch(/dataset\.assetSort/);
    expect(centerSource).toMatch(/dataset\.assetFolder/);
    expect(centerSource).toMatch(/dataset\.assetViewSwitch/);
    expect(centerSource).toMatch(/dataset\.assetInsight(?:Id|Kind|Status)/);
    expect(centerSource).toContain('asset-center-item-path');
    expect(centerSource).toMatch(/aria-controls[\s\S]*asset-center-library-items/);
    expect(centerSource).toMatch(/aria-pressed/);
    expect(centerSource).toMatch(/dataset\.visibleCount/);
    expect(centerSource).toMatch(/dataset\.fileCount/);
  });

  it('provides accessible folder navigation without another asset index', () => {
    expect(folderSource).toMatch(/buildAssetFolderOptions/);
    expect(folderSource).toMatch(/assetFolderBreadcrumbs/);
    expect(folderSource).toMatch(/assetMatchesFolder/);
    expect(folderSource).toMatch(/content\/assets/);
    expect(centerSource).toMatch(/buildAssetFolderOptions/);
    expect(centerSource).toMatch(/assetFolderBreadcrumbs/);
    expect(centerSource).toMatch(/data-asset-folder-control|dataset\.assetFolderControl/);
    expect(centerSource).toMatch(/data-asset-folder-crumb|dataset\.assetFolderCrumb/);
    expect(centerSource).toMatch(/aria-current/);
    expect(centerSource).toMatch(/requestAnimationFrame[\s\S]*asset-folder[\s\S]*\.focus\(\)/);
    expect(stateSource).toMatch(/assetCenterFolder/);
    expect(centerCss).toMatch(/asset-center-folder-controls/);
    expect(centerCss).toMatch(/asset-center-folder-breadcrumbs/);
    expect(centerCss).toMatch(/@media\s*\([^)]*max-width\s*:\s*800px\)[\s\S]*asset-center-folder-controls/i);
  });

  it('turns grid mode into a lifecycle-safe visual library while list mode stays dense', () => {
    expect(thumbnailSource).toMatch(/beginAssetThumbnailSession/);
    expect(thumbnailSource).toMatch(/disposeAssetCenterThumbnails/);
    expect(centerSource).toMatch(/asset-center-thumbnail/);
    expect(centerSource).toMatch(/aria-hidden/);
    const thumbnailSessionStart = centerSource.indexOf('const thumbnailSession = beginAssetThumbnailSession();');
    const libraryStart = centerSource.indexOf("const library = h('section', `asset-center-library ${effectiveAssetView}`);");
    const thumbnailMount = centerSource.indexOf('thumbnailSession.mount', thumbnailSessionStart);
    expect(thumbnailSessionStart).toBeGreaterThanOrEqual(0);
    expect(libraryStart).toBeGreaterThan(thumbnailSessionStart);
    expect(thumbnailMount).toBeGreaterThan(libraryStart);
    expect(centerSource.slice(thumbnailSessionStart, thumbnailMount)).not.toMatch(/effectiveAssetView\s*===\s*['"]grid['"]/);
    expect(mainSource).toMatch(/disposeAssetCenterThumbnails/);
    expect(centerCss).toMatch(/asset-center-library\.grid[\s\S]*asset-center-thumbnail/);
    expect(centerCss).toMatch(/aspect-ratio\s*:\s*16\s*\/\s*9/);
    expect(centerCss).toMatch(/asset-thumbnail-fit=['"]cover['"][\s\S]*object-fit\s*:\s*cover/);
    expect(centerCss).toMatch(/asset-thumbnail-fit=['"]contain['"][\s\S]*object-fit\s*:\s*contain/);
    expect(centerCss).not.toMatch(/asset-center-thumbnail[\s\S]{0,300}(?:linear|radial)-gradient\s*\(/i);
  });

  it('uses a persistent inspector and a technical disclosure instead of hover-only evidence', () => {
    expect(centerSource).toMatch(/asset-center-inspector/);
    expect(centerSource).toMatch(/selected|selection/);
    expect(centerSource).toMatch(/details|技术信息/);
    expect(centerSource).toMatch(/技术信息/);
    expect(centerSource).toMatch(/preview|预览/);
    expect(centerSource).toMatch(/reference|引用/);
    expect(centerSource).not.toMatch(/mouseenter/);
    expect(centerSource).not.toMatch(/style\.(?:left|top|right|bottom|transform)\s*=/);
    expect(centerSource).not.toMatch(/assetCenterSelectedId\s*===\s*null\s*&&\s*filtered\.length/);
    expect(centerSource).toMatch(/image\.onerror/);
    expect(centerSource).toMatch(/audio\.onerror/);
    expect(centerSource).toMatch(/video\.onerror/);
  });

  it('keeps preview object URLs bounded and avoids decorative selection treatments', () => {
    expect(centerSource).toMatch(/URL\.createObjectURL/);
    expect(centerSource).toMatch(/URL\.revokeObjectURL/);
    expect(centerSource).toMatch(/dispose|cleanup|beforeunload|selection|selected/i);

    expect(centerCss, 'Asset Center stylesheet must exist').toContain('asset-center');
    const selectedRules = ruleBodiesMatching(centerCss, /(?:aria-selected|selected|active|current)/i).join('\n');
    expect(selectedRules).not.toMatch(/border-(?:left|inline-start|top)\s*:/i);
    expect(centerCss).not.toMatch(/border-(?:left|inline-start)\s*:/i);
    expect(centerCss).not.toMatch(/(?:linear|radial)-gradient\s*\(/i);
    expect(centerCss).not.toMatch(/backdrop-filter\s*:/i);
    expect(centerCss).not.toMatch(/filter\s*:\s*blur\s*\(/i);
    expect(centerCss).not.toMatch(/box-shadow\s*:[^;]*\binset\b/i);
  });

  it('anchors the wide, 1024, and 800 layouts and loads its stylesheet after shared layers', () => {
    expect(centerCss).toMatch(/asset-center-(?:shell|rail|library|inspector)/);
    expect(centerCss).toMatch(/asset-center-insights[\s\S]*grid-template-columns/);
    expect(centerCss).toMatch(/\.asset-center\s*\{[\s\S]*overflow-y:\s*auto/);
    expect(centerCss).not.toContain('--surdet-space-20');
    // The base three-region layout is the 1440px desktop contract.
    expect(centerCss).toMatch(/asset-center-shell[\s\S]*grid-template-columns/);
    expect(centerCss).toMatch(/@media\s*\([^)]*max-width\s*:\s*1024px\)/i);
    expect(centerCss).toMatch(/@media\s*\([^)]*max-width\s*:\s*800px\)/i);
    expect(indexSource).toMatch(/styles\/asset-center\.css/);
    expect(indexSource.indexOf('styles/asset-center.css')).toBeGreaterThan(indexSource.indexOf('styles/script-workspace.css'));
    expect(indexSource.indexOf('styles/asset-center.css')).toBeGreaterThan(indexSource.indexOf('styles/components.css'));
  });

  it('keeps the compact Script sidebar as a shared-truth insertion surface', () => {
    expect(sidebarAssetSource).toMatch(/assetIntelligence/);
    expect(sidebarAssetSource).toMatch(/insert-asset/);
    expect(sidebarAssetSource).toMatch(/copy-asset-key/);
    expect(sidebarAssetSource).toMatch(/avatar/);
    expect(sidebarAssetSource).toMatch(/ambience/);
  });

  it('keeps reference-aware relocation inside the persistent inspector with a shared write freeze', () => {
    const relocationSource = `${centerSource}\n${mainSource}\n${projectIoSource}\n${relocationWorkspaceSource}`;
    for (const copy of [
      '整理素材', '移动或重命名', '检查影响', '移动并更新', '修改目标', '撤销本次整理',
      '场景', '时间轴', '角色配置', '鉴赏配置', '素材整理进行中',
    ]) expect(relocationSource).toContain(copy);
    expect(centerSource).toMatch(/renderRelocation[\s\S]*asset-center-references/);
    expect(centerSource).toMatch(/background[\s\S]*portrait[\s\S]*avatar/);
    for (const marker of ['relocationPlan', 'relocationCommit', 'relocationResume', 'relocationUndo', 'reloadCurrentProjectFromHandle']) {
      expect(mainSource).toContain(marker);
    }
    expect(mainSource).toMatch(/reconcileAssetRelocationMutation[\s\S]*relocationResume/);
    expect(mainSource).toMatch(/undoAssetRelocation[\s\S]*releaseOnError:\s*false/);
    expect(centerSource).toMatch(/TERMINAL_RELOCATION_STATUSES[\s\S]*ROLLED_BACK[\s\S]*CANCELLED/);
    expect(centerSource).toMatch(/renderRelocationStatus[\s\S]*继续恢复[\s\S]*安全回退/);
    expect(centerSource).toMatch(/renderDetachedRelocation[\s\S]*renderRelocationStatus/);
    expect(centerSource).toMatch(/关闭提示/);
    expect(mainSource).toMatch(/COMMITTED[\s\S]*UNDONE[\s\S]*ROLLED_BACK[\s\S]*CANCELLED/);
    expect(stateSource).toMatch(/projectWriteLock[\s\S]*asset-relocation/);
    expect(projectIoSource).toMatch(/assertProjectWriteUnlocked[\s\S]*writeFileHandle/);
    expect(projectIoSource).toMatch(/reloadCurrentProjectFromHandle/);
    expect(projectIoSource).toMatch(/reloadCurrentProjectFromHandle[\s\S]*notifyProjectLoaded:\s*false/);
    expect(centerCss).toMatch(/@media\s*\([^)]*max-width\s*:\s*800px\)[\s\S]*asset-relocation-actions/i);
    expect(centerCss).not.toMatch(/asset-relocation[^{}]*\{[^}]*border-(?:left|inline-start)\s*:/i);
  });

  it('supports one human-readable batch selection and relocation workspace without nested controls', () => {
    const relocationSource = `${centerSource}\n${mainSource}\n${relocationWorkspaceSource}`;
    for (const copy of [
      '批量整理', '已选', '整理所选', '退出选择', '统一放到', '逐项调整文件名',
      '检查整批影响', '退出批量整理', '撤销整批整理',
    ]) expect(relocationSource).toContain(copy);
    expect(centerSource).toMatch(/checkbox\.type\s*=\s*['"]checkbox['"]/);
    expect(centerSource).toMatch(/asset-center-item-selecting/);
    expect(centerSource).toMatch(/asset-center-detail-button/);
    expect(centerSource).toMatch(/batchSelecting[\s\S]*h\(['"]div['"],\s*['"]asset-center-item asset-center-item-selecting/);
    expect(centerSource).toMatch(/checkbox\.onchange[\s\S]*onSelectBatchItem/);
    expect(centerSource).toMatch(/workspace\.mode\s*!==\s*['"]batch['"][\s\S]*renderRelocation/);
    expect(centerSource).toMatch(/effectiveAssetView[\s\S]*['"]list['"]/);
    expect(centerSource).toMatch(/restoreAssetRowControl[\s\S]*input\[type=/);
    expect(centerSource).toMatch(/onSetVisibleBatchItems/);
    expect(mainSource).toMatch(/relocationPlan\([\s\S]*moves:\s*requestedMoves/);
    expect(mainSource).toMatch(/batchRelocationMoves/);
    expect(mainSource).toMatch(/setBatchDetail/);
    expect(relocationWorkspaceSource).toMatch(/mode:\s*['"]idle['"]\s*\|\s*['"]single['"]\s*\|\s*['"]batch['"]/);
    const batchRules = ruleBodiesMatching(centerCss, /asset-(?:center|relocation)-batch/i).join('\n');
    expect(batchRules).not.toMatch(/position\s*:\s*(?:fixed|sticky)/i);
    expect(centerCss).toMatch(/@media\s*\([^)]*max-width\s*:\s*800px\)[\s\S]*asset-relocation-batch-row/i);
    expect(centerCss).not.toMatch(/asset-(?:center|relocation)-batch[^{}]*\{[^}]*border-(?:left|inline-start)\s*:/i);
  });
});
