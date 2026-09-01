import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assetDropFiles,
  assetDropHasFiles,
  assetFileTypeLabel,
} from '../src/panels/asset-import-workbench.js';

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

const workbenchSource = readEditorFile('src/panels/asset-import-workbench.ts');
const centerSource = readEditorFile('src/panels/asset-center.ts');
const mainSource = readEditorFile('src/main.ts');
const stateSource = readEditorFile('src/state.ts');
const workbenchCss = readEditorFile('src/styles/asset-import.css');
const indexSource = readEditorFile('index.html');

const categoryLabels = ['背景', '立绘', '头像', '音乐', '环境音', '音效', '语音', '视频', '字体', '其他'];

interface FakeDropItem {
  kind: 'file' | 'string';
  getAsFile(): File | null;
  webkitGetAsEntry?: () => { isDirectory: boolean } | null;
}

function fakeTransfer(
  items: FakeDropItem[],
  files: File[] = [],
  types: string[] = items.some((item) => item.kind === 'file') ? ['Files'] : ['text/plain'],
): Pick<DataTransfer, 'items' | 'files' | 'types'> {
  return {
    items: items as unknown as DataTransferItemList,
    files: files as unknown as FileList,
    types,
  };
}

describe('Editor 中文素材导入工作台合同', () => {
  it('extracts only ordinary files from a drop payload', () => {
    const image = new File(['image'], 'harbor.png', { type: 'image/png' });
    const fileItem: FakeDropItem = { kind: 'file', getAsFile: () => image };
    const textItem: FakeDropItem = { kind: 'string', getAsFile: () => null };
    const directoryItem: FakeDropItem = {
      kind: 'file',
      getAsFile: () => image,
      webkitGetAsEntry: () => ({ isDirectory: true }),
    };

    expect(assetDropHasFiles(fakeTransfer([fileItem]))).toBe(true);
    expect(assetDropFiles(fakeTransfer([textItem, fileItem, directoryItem]))).toEqual([image]);
    expect(assetDropHasFiles(fakeTransfer([textItem]))).toBe(false);
    expect(assetDropFiles(fakeTransfer([textItem]))).toEqual([]);
    expect(assetDropHasFiles(fakeTransfer([directoryItem]))).toBe(false);
    expect(assetDropFiles(fakeTransfer([directoryItem]))).toEqual([]);
  });

  it('falls back to the FileList when a browser exposes no DataTransfer items', () => {
    const sound = new File(['sound'], 'rain.wav', { type: 'audio/wav' });

    expect(assetDropHasFiles(fakeTransfer([], [sound], ['Files']))).toBe(true);
    expect(assetDropFiles(fakeTransfer([], [sound], ['Files']))).toEqual([sound]);
  });

  it('uses Chinese file-family labels in the human-facing draft list', () => {
    expect(assetFileTypeLabel(new File(['image'], 'harbor.png', { type: 'image/png' }))).toBe('图片');
    expect(assetFileTypeLabel(new File(['sound'], 'rain.wav', { type: 'audio/wav' }))).toBe('音频');
    expect(assetFileTypeLabel(new File(['video'], 'opening.webm', { type: 'video/webm' }))).toBe('视频');
    expect(assetFileTypeLabel(new File(['font'], 'story.woff2', { type: 'font/woff2' }))).toBe('字体');
    expect(assetFileTypeLabel(new File(['data'], 'story.bin', { type: 'application/octet-stream' }))).toBe('文件');
  });

  it('mounts a stable in-place 导入素材 entry inside the existing Asset Center', () => {
    expect(centerSource, 'Asset Center panel must exist').toContain('asset-center');
    expect(centerSource).toContain('导入素材');
    expect(centerSource).toMatch(/asset-import-(?:workbench|open|entry)/);
    expect(mainSource).toMatch(/renderAssetCenter/);
    expect(mainSource).toMatch(/asset-import/);
  });

  it('uses a three-row workbench with a normal, non-floating action row', () => {
    expect(workbenchSource, 'import workbench module must exist').toContain('asset-import-workbench');
    expect(workbenchSource).toMatch(/导入素材/);
    expect(workbenchCss, 'import workbench stylesheet must exist').toContain('asset-import-workbench');
    expect(workbenchCss).toMatch(/grid-template-rows\s*:/);
    expect(workbenchCss).toMatch(/asset-import-(?:header|content|actions)/);
    expect(workbenchCss).toMatch(/minmax\([^)]*1fr/);

    const actionRules = ruleBodiesMatching(workbenchCss, /asset-import-(?:actions|action-row)/i).join('\n');
    expect(actionRules).not.toMatch(/position\s*:\s*(?:fixed|sticky)/i);
    expect(workbenchSource).not.toMatch(/position\s*:\s*(?:fixed|sticky)/i);
  });

  it('reuses the file picker as a clear, non-floating drop surface', () => {
    expect(workbenchSource).toMatch(/ondragenter|addEventListener\(\s*['"]dragenter/);
    expect(workbenchSource).toMatch(/ondragover|addEventListener\(\s*['"]dragover/);
    expect(workbenchSource).toMatch(/ondragleave|addEventListener\(\s*['"]dragleave/);
    expect(workbenchSource).toMatch(/ondrop|addEventListener\(\s*['"]drop/);
    expect(workbenchSource).toContain('选择文件，或拖到这里');
    expect(workbenchSource).toContain('松开即可加入待导入列表');
    expect(workbenchSource).toContain('当前导入已开始，暂时不能加入文件');
    expect(workbenchSource).toContain('这里只接受本机文件');
    expect(workbenchSource).toMatch(/setAttribute\(\s*['"]aria-live['"]\s*,\s*['"]polite['"]\s*\)/);
    expect(workbenchSource).toMatch(/dataTransfer/);
    expect(workbenchSource).toMatch(/onSelectFiles/);
    expect(workbenchCss).toMatch(/asset-import-picker\[data-drop-state=['"]ready['"]\]/);
    expect(workbenchCss).toMatch(/asset-import-picker\[data-drop-state=['"]blocked['"]\]/);
    expect(workbenchCss).not.toMatch(/asset-import-picker[^{}]*\{[^}]*(?:linear|radial)-gradient/i);
  });

  it('blocks browser navigation for rejected and locked drops and keeps the confirmation visible', () => {
    const dragOverBody = workbenchSource.match(/pickerLabel\.ondragover = \(event\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
    const dropBody = workbenchSource.match(/pickerLabel\.ondrop = \(event\) => \{([\s\S]*?)\n  \};/)?.[1] ?? '';
    expect(dragOverBody.trimStart().startsWith('event.preventDefault();')).toBe(true);
    expect(dropBody.trimStart().startsWith('event.preventDefault();')).toBe(true);
    expect(workbenchSource).toContain('const filesLocked = hooks.busy === true || value.activeOperation !== null;');
    expect(mainSource).toMatch(/return assetImportActionRunning\s*\|\|\s*assetImportWorkspace\.snapshot\(\)\.activeOperation !== null/);
    expect(mainSource).toContain('已加入 ${added.length} 个文件，请继续检查分类和名称');
    expect(workbenchSource).toContain('最终确认前不会写入项目素材目录');
    expect(workbenchSource).not.toContain('文件只保留在当前页面，取消后不会写入项目。');
    expect(workbenchSource).toContain('请先关闭当前结果，再开始下一次导入');
    expect(workbenchSource).toContain('if (pickerLabel.dataset.dropState !== state)');
    expect(workbenchSource).toContain('if (dropStatus.textContent !== message)');
  });

  it('marks every file-name correction issue invalid and keeps terminal receipts read-only', () => {
    for (const code of [
      'IMPORT_NAME_INVALID',
      'IMPORT_TARGET_UNSAFE',
      'IMPORT_TARGET_DUPLICATE_IN_BATCH',
      'IMPORT_TARGET_EXISTS',
      'IMPORT_PORTRAIT_NAME_INVALID',
    ]) expect(workbenchSource).toContain(code);
    expect(workbenchSource).toMatch(/name\.setAttribute\(['"]aria-invalid['"],\s*String\(issues\.some/);
    expect(workbenchSource).toMatch(/const fieldsLocked = hooks\.busy === true \|\| \(value\.activeOperation !== null\s*&& value\.activeOperation\.operation\.status !== ['"]STAGED['"]\)/);
    expect(workbenchSource).toMatch(/operationIsTerminal\(projection\.activeOperation\)[\s\S]{0,160}\? ['"]关闭['"]/);
  });

  it('keeps the file region independently scrollable and preserves the same layout at narrow widths', () => {
    const scrollRules = ruleBodiesMatching(workbenchCss, /asset-import-(?:content|files|file-list)/i).join('\n');
    expect(scrollRules).toMatch(/overflow(?:-y)?\s*:\s*(?:auto|scroll)/i);
    expect(workbenchCss).toMatch(/@media\s*\([^)]*max-width\s*:\s*1024px\)/i);
    expect(workbenchCss).toMatch(/@media\s*\([^)]*max-width\s*:\s*800px\)/i);
    expect(workbenchCss).toMatch(/grid-template-columns\s*:/);
    expect(workbenchCss).not.toMatch(/(?:linear|radial)-gradient\s*\(/i);
    expect(workbenchCss).not.toMatch(/backdrop-filter\s*:/i);
    expect(workbenchCss).not.toMatch(/filter\s*:\s*blur\s*\(/i);
  });

  it('freezes all ten human-facing categories and editable destination mapping', () => {
    for (const label of categoryLabels) expect(workbenchSource, `missing category label: ${label}`).toContain(label);
    expect(workbenchSource).toMatch(/background/);
    expect(workbenchSource).toMatch(/sound-effect/);
    expect(workbenchSource).toMatch(/asset-import-(?:category|kind)/i);
    expect(workbenchSource).toMatch(/<input|createElement\(['"]input|type\s*=\s*['"]text/i);
    expect(workbenchSource).toMatch(/fileName|最终名称|文件名/);
    expect(workbenchSource).toMatch(/目标位置|targetPath|素材\s*[/／]\s*背景/);
    expect(workbenchSource).toMatch(/sourceName|源文件|原文件/);
  });

  it('blocks collisions without offering overwrite and explains safe correction', () => {
    expect(workbenchSource).toMatch(/不会覆盖|不覆盖|同名/);
    expect(workbenchSource).toMatch(/重新命名|更换名称|修改名称|安全/);
    const overwriteControls = [
      /button[^\n]{0,160}覆盖/u,
      /按钮[^\n]{0,80}覆盖/u,
      /['"]覆盖['"]\s*[,)]/u,
      /textContent\s*=\s*['"][^'"]*覆盖/u,
    ];
    for (const pattern of overwriteControls) expect(workbenchSource).not.toMatch(pattern);
    expect(workbenchSource).toMatch(/IMPORT_TARGET_EXISTS|IMPORT_NAME_INVALID|IMPORT_TARGET_UNSAFE|冲突/);
  });

  it('shows receipt, progress, cancel, and conservative undo semantics in Chinese', () => {
    for (const copy of [
      '准备导入',
      '正在上传',
      '正在写入项目',
      '导入完成',
      '导入已撤销',
      '取消导入',
      '查看已导入素材',
      '最近导入',
      '查看导入回执',
      '撤销本次导入',
      '撤销会把这些文件移出素材库，并由 Surdet 保留恢复副本；不会改动后来修改过的文件。',
      '已撤销，恢复副本仍由 Surdet 保留。',
    ]) expect(workbenchSource, `missing user-facing copy: ${copy}`).toContain(copy);
    expect(workbenchSource).toMatch(/receipt|回执/);
    expect(workbenchSource).toMatch(/progress|进度/);
    expect(workbenchSource).toMatch(/cancel|取消/);
    expect(workbenchSource).toMatch(/undo|撤销/);
    expect(workbenchSource).not.toMatch(/提交成功|成功导入|toast[^\n]*success/i);
  });

  it('provides list semantics, native controls, field errors, and a polite live region', () => {
    expect(workbenchSource).toMatch(/role\s*[:=]\s*['"]list['"]|setAttribute\(['"]role['"]\s*,\s*['"]list['"]\)/i);
    expect(workbenchSource).toMatch(/role\s*[:=]\s*['"]listitem['"]|setAttribute\(['"]role['"]\s*,\s*['"]listitem['"]\)/i);
    expect(workbenchSource).toMatch(/aria-live\s*[:=]\s*['"]polite['"]|setAttribute\(['"]aria-live['"]\s*,\s*['"]polite['"]\)/i);
    expect(workbenchSource).toMatch(/aria-describedby/);
    expect(workbenchSource).toMatch(/aria-invalid/);
    expect(workbenchSource).toMatch(/label|<label/i);
    expect(workbenchSource).toMatch(/button|select|input/);
    expect(workbenchSource).toMatch(/keydown|Enter|Space/);
  });

  it('keeps machine identity out of primary copy and refreshes the existing asset truth after commit', () => {
    expect(workbenchSource).toMatch(/data-[a-z-]*(?:asset|item|operation|target)/i);
    expect(workbenchSource).toMatch(/details|技术信息/);
    expect(workbenchSource).toMatch(/refreshProjectAssetIntelligence|scheduleAuthoringIndexRebuild|assetIntelligence/);
    expect(mainSource).toMatch(/assetImport|asset-import|refreshProjectAssetIntelligence/);
    expect(mainSource).toMatch(/assetImportActionSequence/);
    expect(mainSource).toMatch(/assetImportCancelRequested/);
    expect(mainSource).toMatch(/assetImportActionIsCurrent/);
    expect(mainSource).toMatch(/context\.client/);
    expect(mainSource).toMatch(/projectRoot\s*===\s*state\.dirHandle/);
    expect(stateSource).toMatch(/assetImport|asset-import/);
    expect(workbenchSource).not.toMatch(/absoluteProjectPath|dataRoot|bindingToken|operationToken/);
  });

  it('keeps recovery, stale target, and upload cancellation paths reachable', () => {
    for (const status of ['READY', 'PUBLISHING', 'ROLLING_BACK', 'UNDOING', 'RECOVERY_REQUIRED']) {
      expect(`${workbenchSource}\n${mainSource}`, `missing recovery state: ${status}`).toContain(status);
    }
    expect(workbenchSource).toMatch(/category\.disabled\s*=\s*fieldsLocked/);
    expect(workbenchSource).toMatch(/name\.disabled\s*=\s*fieldsLocked/);
    expect(mainSource).toMatch(/plan\(operationId,\s*\{\s*targets:\s*currentAssetImportTargets\(\)/);
    expect(mainSource).toMatch(/finishRequestedAssetImportCancellation/);
    expect(mainSource).toMatch(/context\.client\.cancel/);
  });

  it('never lets a historical receipt replace an active draft or operation', () => {
    expect(workbenchSource).toMatch(
      /projection\.activeOperation === null\s*&& projection\.draftItems\.length === 0\s*&& projection\.recentReceipts\.length > 0/,
    );
  });

  it('loads the dedicated stylesheet after the existing Asset Center stylesheet', () => {
    expect(indexSource).toMatch(/styles\/asset-center\.css/);
    expect(indexSource).toMatch(/styles\/asset-import\.css/);
    expect(indexSource.indexOf('styles/asset-import.css')).toBeGreaterThan(indexSource.indexOf('styles/asset-center.css'));
  });
});
