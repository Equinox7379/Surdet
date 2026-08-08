import * as fs from 'node:fs';

export type JsonFileOps = Pick<typeof fs, 'writeFileSync' | 'renameSync' | 'existsSync' | 'unlinkSync'>;

export function writeJsonAtomic(filePath: string, value: unknown, ops: JsonFileOps = fs): void {
  const tmp = `${filePath}.tmp`;
  ops.writeFileSync(tmp, JSON.stringify(value));
  try {
    ops.renameSync(tmp, filePath);
  } catch (error) {
    try {
      if (ops.existsSync(tmp)) ops.unlinkSync(tmp);
    } catch {
      // Preserve the original rename error even if cleanup is unavailable.
    }
    throw error;
  }
}
