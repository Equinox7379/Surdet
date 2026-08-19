import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectFile } from '@surdet/authoring';

/** FNV-1a 32 位文本摘要：CLI 侧 ProjectFile 构造（scene/config/timeline）共用的内容摘要，
 *  与 lint / legacy simulate 的 snapshot revision 输入同源。 */
export function authoringDigest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function scanTimelineDir(dir: string, prefix: string, out: ProjectFile[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 无 timelines 目录：空集合（complete scope 下由引用检查负责报告缺失）
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      scanTimelineDir(path.join(dir, entry.name), `${prefix}${entry.name}/`, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      const text = fs.readFileSync(path.join(dir, entry.name), 'utf8').replace(/^\uFEFF/, '');
      out.push({ path: `content/timelines/${prefix}${entry.name}`, text, bytes: Buffer.byteLength(text, 'utf8'), sha256: authoringDigest(text) });
    }
  }
}

/** 递归枚举 <root>/content/timelines 下的 .json（遵守 ProjectSnapshot 的 isSnapshotPath
 *  契约：'content/timelines/' 前缀 + .json 扩展名大小写不敏感），返回 forward-slash 项目相对
 *  路径的 ProjectFile——timelineIdFromPath / A2 canonical identity 依赖该路径形态。
 *  lint（A3）与 legacy simulate（R4-A）共享本实现，禁止各自复制发现规则。 */
export function collectTimelineFiles(root: string): ProjectFile[] {
  const out: ProjectFile[] = [];
  scanTimelineDir(path.join(root, 'content/timelines'), '', out);
  return out;
}
