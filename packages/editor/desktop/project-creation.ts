import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import * as path from 'node:path';
import { createProject } from '../../cli/dist/new.js';
import type { CreateProjectRequest, ProjectCreationLocation } from './contracts.js';

/** Only the main process retains physical directory facts; the renderer gets id/location. */
export interface SelectedProjectLocation extends ProjectCreationLocation {
  device: bigint;
  inode: bigint;
  createdNs: bigint;
}

export function selectProjectLocation(directory: string): SelectedProjectLocation {
  const location = fs.realpathSync.native(directory);
  const stat = fs.statSync(location, { bigint: true });
  if (!stat.isDirectory()) throw new Error('请选择保存新项目的文件夹。');
  return { id: randomUUID(), location, device: stat.dev, inode: stat.ino, createdNs: stat.birthtimeNs };
}

/** Creates one new child folder of the current window's native selection, never an arbitrary path. */
export function createDesktopProject(selected: SelectedProjectLocation | null, raw: unknown, templatesRoot: string): string {
  if (selected === null) throw new Error('请先选择新项目的保存位置。');
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)
    || Object.keys(raw).length !== 3 || Object.keys(raw).some(key => !['locationId', 'name', 'template'].includes(key))) throw new Error('创建项目的请求无效。');
  const request = raw as CreateProjectRequest;
  if (request.locationId !== selected.id) throw new Error('保存位置已变化，请重新选择。');
  if (request.template !== 'blank' && request.template !== 'example') throw new Error('请选择空白项目或示例项目。');
  if (typeof request.name !== 'string') throw new Error('请输入项目名称。');
  const name = request.name.trim();
  if (!name || name.length > 120 || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) || /[. ]$/.test(name)
    || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) throw new Error('项目名称须为1至120字，且不能使用Windows保留名称或文件夹不支持的字符。');
  let stat;
  try { stat = fs.lstatSync(selected.location, { bigint: true }); }
  catch { throw new Error('保存位置已不可用，请重新选择。'); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== selected.device || stat.ino !== selected.inode || stat.birthtimeNs !== selected.createdNs
    || fs.realpathSync.native(selected.location) !== selected.location) throw new Error('保存位置已被替换，请重新选择。');
  const directory = path.join(selected.location, name);
  if (fs.lstatSync(directory, { throwIfNoEntry: false })) throw new Error(`文件夹「${name}」已存在，请换一个项目名称。`);
  // Package name is the persistent save identity, not a transliteration of the display title.
  return createProject(`game-${randomUUID()}`, { directory, template: request.template, title: name, templatesRoot }).directory;
}
