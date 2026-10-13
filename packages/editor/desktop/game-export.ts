import fs from 'node:fs';
import path from 'node:path';
import { AuthoringOperationError } from '@surdet/authoring';
import { exportWindowsGame, inspectWindowsExport, type WindowsExportOptions } from '../../cli/dist/windows-export.js';
import type { SelectedProjectLocation } from './project-creation.js';
import type { ExportGameRequest } from './contracts.js';

export function desktopExportError(error: unknown, retry: string): unknown {
  if (error instanceof AuthoringOperationError && error.code === 'PROJECT_BUSY'
    && error.details?.manualRecoveryRequired !== true) {
    return new Error(`项目正在被其他操作使用，请稍后${retry}。`, { cause: error });
  }
  return error;
}

/** The renderer supplies a selection id; it cannot select a physical output path. */
export async function exportDesktopGame(projectRoot: string, selected: SelectedProjectLocation | null, raw: unknown,
  runtime: WindowsExportOptions['runtime'], signal: AbortSignal, onProgress: WindowsExportOptions['onProgress']) {
  if (!selected) throw new Error('请先选择导出位置。');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['locationId', 'folderName', 'title', 'version', 'icon', 'encrypted', 'trustedPlugins'].includes(key))) throw new Error('导出请求无效。');
  const request = raw as ExportGameRequest;
  if (request.locationId !== selected.id || typeof request.folderName !== 'string'
    || request.title !== undefined && typeof request.title !== 'string' || request.version !== undefined && typeof request.version !== 'string'
    || request.icon !== undefined && typeof request.icon !== 'string' || request.encrypted !== undefined && typeof request.encrypted !== 'boolean'
    || request.trustedPlugins !== undefined && (!Array.isArray(request.trustedPlugins) || request.trustedPlugins.some(id => typeof id !== 'string')))
    throw new Error('导出参数无效，请重新选择。');
  const stat = fs.lstatSync(selected.location, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== selected.device || stat.ino !== selected.inode || stat.birthtimeNs !== selected.createdNs
    || fs.realpathSync.native(selected.location) !== selected.location) throw new Error('导出位置已被替换，请重新选择。');
  return exportWindowsGame({ projectRoot, outputParent: selected.location, folderName: request.folderName, title: request.title,
    version: request.version, icon: request.icon, encrypted: request.encrypted, trustedPlugins: request.trustedPlugins, runtime, signal, onProgress });
}
export { inspectWindowsExport };
