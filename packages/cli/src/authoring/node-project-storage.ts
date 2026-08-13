import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AuthoringOperationError,
  normalizeProjectPath,
  type ProjectFile,
  type ProjectWriteStorage,
} from '@surdet/authoring';

function sha256(value: Uint8Array | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function pathError(value: string): AuthoringOperationError {
  return new AuthoringOperationError('PATH_OUTSIDE_PROJECT', `路径不在项目根目录内：${value}`);
}

function safeStageName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Node 文件系统适配器；所有相对路径先做项目根和 symlink/junction 校验。 */
export class NodeProjectStorage implements ProjectWriteStorage {
  constructor(readonly rootIdentity: string, private readonly rootRealPath: string) {}

  static async open(projectRoot: string): Promise<NodeProjectStorage> {
    let real: string;
    try {
      real = await fs.realpath(projectRoot);
      const stat = await fs.stat(real);
      if (!stat.isDirectory()) throw new Error('not a directory');
    } catch (error) {
      throw new AuthoringOperationError('PROJECT_NOT_FOUND', `项目目录不可用：${projectRoot}（${String(error)}）`);
    }
    return new NodeProjectStorage(real, real);
  }

  private resolveRelative(relativePath: string, allowMissing = false): string {
    try {
      normalizeProjectPath(relativePath);
    } catch {
      throw pathError(relativePath);
    }
    const candidate = path.resolve(this.rootRealPath, ...relativePath.split('/'));
    if (!isInside(this.rootRealPath, candidate)) throw pathError(relativePath);
    return candidate;
  }

  private async assertSafeTarget(relativePath: string, allowMissing = false): Promise<string> {
    const candidate = this.resolveRelative(relativePath, allowMissing);
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) throw pathError(relativePath);
      const real = await fs.realpath(candidate);
      if (!isInside(this.rootRealPath, real)) throw pathError(relativePath);
      if (!stat.isFile() && !allowMissing) throw pathError(relativePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissing) {
        const parent = await this.assertSafeParent(path.dirname(candidate), relativePath);
        return path.join(parent, path.basename(candidate));
      }
      if (error instanceof AuthoringOperationError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AuthoringOperationError('PROJECT_NOT_FOUND', `项目文件不存在：${relativePath}`);
      throw pathError(relativePath);
    }
    return candidate;
  }

  private async assertSafeParent(parent: string, original: string): Promise<string> {
    if (!isInside(this.rootRealPath, parent)) throw pathError(original);
    try {
      const real = await fs.realpath(parent);
      if (!isInside(this.rootRealPath, real)) throw pathError(original);
      return real;
    } catch (error) {
      if (error instanceof AuthoringOperationError) throw error;
      throw pathError(original);
    }
  }

  private async assertSafeStage(stagedIdentity: string): Promise<string> {
    const candidate = path.resolve(stagedIdentity);
    if (!isInside(this.rootRealPath, candidate) || !path.basename(candidate).startsWith('.surdet-')) {
      throw pathError(stagedIdentity);
    }
    try {
      const stat = await fs.lstat(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) throw pathError(stagedIdentity);
      const real = await fs.realpath(candidate);
      if (!isInside(this.rootRealPath, real)) throw pathError(stagedIdentity);
    } catch (error) {
      if (error instanceof AuthoringOperationError) throw error;
      throw new AuthoringOperationError('PROJECT_NOT_FOUND', `暂存文件不存在：${stagedIdentity}`);
    }
    return candidate;
  }

  async listFiles(): Promise<string[]> {
    const result: string[] = [];
    const ignored = new Set(['.git', 'node_modules', 'dist']);
    const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.surdet-') || ignored.has(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        const relative = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
        if (entry.isSymbolicLink()) {
          const real = await fs.realpath(absolute).catch(() => '');
          if (!real || !isInside(this.rootRealPath, real)) throw pathError(relative);
          throw pathError(relative);
        }
        if (entry.isDirectory()) await walk(absolute, relative);
        else if (entry.isFile()) result.push(relative);
      }
    };
    await walk(this.rootRealPath, '');
    return result.sort((a, b) => a.localeCompare(b));
  }

  async readText(relativePath: string): Promise<ProjectFile> {
    const absolute = await this.assertSafeTarget(relativePath);
    const bytes = await fs.readFile(absolute);
    const text = bytes.toString('utf8');
    return { path: relativePath, text, bytes: bytes.byteLength, sha256: sha256(bytes) };
  }

  async exists(relativePath: string): Promise<boolean> {
    const candidate = this.resolveRelative(relativePath, true);
    try {
      await this.assertSafeTarget(relativePath);
      return true;
    } catch (error) {
      if (error instanceof AuthoringOperationError && error.code === 'PROJECT_NOT_FOUND') return false;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      if (!isInside(this.rootRealPath, candidate)) throw pathError(relativePath);
      return false;
    }
  }

  async stageText(relativePath: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }> {
    const target = await this.assertSafeTarget(relativePath, true);
    const parent = await this.assertSafeParent(path.dirname(target), relativePath);
    const stagedIdentity = path.join(parent, `.surdet-${safeStageName(changeId)}-${crypto.randomUUID()}.tmp`);
    const bytes = Buffer.from(text, 'utf8');
    try {
      await fs.writeFile(stagedIdentity, bytes, { flag: 'wx' });
      const reread = await fs.readFile(stagedIdentity);
      const digest = sha256(reread);
      if (digest !== sha256(bytes)) throw new Error(`暂存文件身份不匹配：${relativePath}`);
      return { stagedIdentity, sha256: digest };
    } catch (error) {
      await fs.rm(stagedIdentity, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async replaceFromStage(relativePath: string, stagedIdentity: string): Promise<void> {
    const target = await this.assertSafeTarget(relativePath, true);
    const staged = await this.assertSafeStage(stagedIdentity);
    try {
      await fs.rename(staged, target);
    } catch (error) {
      // Windows 不允许 rename 覆盖现有文件；仍保持同目录、已校验暂存文件的替换边界。
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      await fs.copyFile(staged, target);
      await fs.rm(staged, { force: true });
    }
  }

  async restoreText(relativePath: string, originalText: string): Promise<void> {
    const staged = await this.stageText(relativePath, originalText, 'restore');
    try {
      await this.replaceFromStage(relativePath, staged.stagedIdentity);
    } finally {
      await this.removeStage(staged.stagedIdentity);
    }
  }

  async removeStage(stagedIdentity: string): Promise<void> {
    const staged = await this.assertSafeStage(stagedIdentity).catch((error) => {
      if (error instanceof AuthoringOperationError && error.code === 'PROJECT_NOT_FOUND') return null;
      throw error;
    });
    if (staged !== null) await fs.rm(staged, { force: true });
  }

  async removePath(relativePath: string): Promise<void> {
    const target = await this.assertSafeTarget(relativePath);
    await fs.rm(target, { force: true });
  }
}
