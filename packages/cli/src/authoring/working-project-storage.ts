import * as crypto from 'node:crypto';
import { AuthoringOperationError, type ProjectFile, type ProjectStorage } from '@surdet/authoring';

export type ChangeRecordView = 'working' | 'base';

/**
 * 把 ChangeRecord 的文件内容投影为只读 ProjectStorage：
 * - view='working'（默认）：workingFiles，用于 working snapshot / object facts；
 * - view='base'：baseContents，用于基线 snapshot / base object facts。
 * 纯内存适配器；list/read/exists 不产生任何磁盘写入。
 */
export class ChangeRecordProjectStorage implements ProjectStorage {
  readonly rootIdentity: string;

  private readonly files: Record<string, string>;

  constructor(record: { projectRootIdentity: string; workingFiles: Record<string, string>; baseContents: Record<string, string> }, view: ChangeRecordView = 'working') {
    this.rootIdentity = record.projectRootIdentity;
    this.files = view === 'base' ? record.baseContents : record.workingFiles;
  }

  async listFiles(): Promise<string[]> {
    return Object.keys(this.files).sort((a, b) => a.localeCompare(b));
  }

  async readText(filePath: string): Promise<ProjectFile> {
    const text = this.files[filePath];
    if (text === undefined) throw new AuthoringOperationError('PROJECT_NOT_FOUND', `事务文件不存在：${filePath}`);
    const bytes = Buffer.byteLength(text, 'utf8');
    return {
      path: filePath,
      text,
      bytes,
      sha256: crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'),
    };
  }

  async exists(filePath: string): Promise<boolean> {
    return Object.prototype.hasOwnProperty.call(this.files, filePath);
  }
}
