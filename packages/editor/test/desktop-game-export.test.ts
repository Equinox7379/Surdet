import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthoringOperationError } from '@surdet/authoring';
import { selectProjectLocation } from '../desktop/project-creation.js';
import { desktopExportError, exportDesktopGame } from '../desktop/game-export.js';
import { exportWindowsGame } from '../../cli/dist/windows-export.js';
vi.mock('../../cli/dist/windows-export.js', () => ({ exportWindowsGame: vi.fn(async () => ({ directory: 'output', executable: 'output/game.exe' })), inspectWindowsExport: vi.fn() }));
const roots: string[] = [];
afterEach(() => { vi.clearAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-export-grant-')); roots.push(root); return root; }
const runtime = { directory: 'runtime', executable: 'editor.exe', gameRuntime: 'game-runtime', templates: 'templates' };
it.each(['点击“重新检查”', '重新导出'])('translates a retryable project lock using its code: %s', retry => {
  const original = new AuthoringOperationError('PROJECT_BUSY', 'internal detail', { manualRecoveryRequired: false });
  const shown = desktopExportError(original, retry);
  expect(shown).toBeInstanceOf(Error);
  expect((shown as Error).message).toBe(`项目正在被其他操作使用，请稍后${retry}。`);
  expect((shown as Error).cause).toBe(original);
});
it('preserves manual recovery and other errors instead of guessing from their message', () => {
  for (const error of [
    new AuthoringOperationError('PROJECT_BUSY', '需要人工恢复', { manualRecoveryRequired: true }),
    new AuthoringOperationError('LEASE_CORRUPT', 'PROJECT_BUSY: 资源正由其他 lease 持有'),
    new Error('PROJECT_BUSY: 资源正由其他 lease 持有'),
    'PROJECT_BUSY',
  ]) expect(desktopExportError(error, '重新导出')).toBe(error);
});
it('passes only the current native selection to the export core', async () => {
  const root = fixture(), selected = selectProjectLocation(root), controller = new AbortController();
  await exportDesktopGame('project', selected, { locationId: selected.id, folderName: '成品', trustedPlugins: ['count'] }, runtime, controller.signal, undefined);
  expect(exportWindowsGame).toHaveBeenCalledWith(expect.objectContaining({ outputParent: selected.location, projectRoot: 'project', trustedPlugins: ['count'], signal: controller.signal }));
});
it.each([{ locationId: 'fake', folderName: 'out' }, { locationId: '', folderName: 'out', outputParent: 'C:/other' }, { locationId: '', folderName: 'out', trustedPlugins: [7] }])('rejects forged or malformed requests before writing %j', async request => {
  const root = fixture(), selected = selectProjectLocation(root);
  await expect(exportDesktopGame('project', selected, request, runtime, new AbortController().signal, undefined)).rejects.toThrow();
  expect(exportWindowsGame).not.toHaveBeenCalled(); expect(fs.readdirSync(root)).toEqual([]);
});
it('does not retain authority when the selected parent was replaced', async () => {
  const root = fixture(), parent = path.join(root, 'selected'); fs.mkdirSync(parent);
  const selected = selectProjectLocation(parent); fs.renameSync(parent, path.join(root, 'old')); fs.mkdirSync(parent);
  await expect(exportDesktopGame('project', selected, { locationId: selected.id, folderName: 'out' }, runtime, new AbortController().signal, undefined)).rejects.toThrow('已被替换');
  expect(exportWindowsGame).not.toHaveBeenCalled();
});
