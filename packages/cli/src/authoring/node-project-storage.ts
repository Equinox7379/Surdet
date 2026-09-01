import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AuthoringOperationError,
  normalizeProjectPath,
  type ProjectAssetFileFact,
  type ProjectFile,
  type ProjectWriteStorage,
} from '@surdet/authoring';
import { replaceFileByRename } from './node-file-replacement.js';

function sha256(value: Uint8Array | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function pathError(value: string): AuthoringOperationError {
  return new AuthoringOperationError('PATH_OUTSIDE_PROJECT', `路径不在项目根目录内：${value}`);
}

function safeStageName(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Node 文件系统适配器；所有相对路径先做项目根和 symlink/junction 校验。 */
export class NodeProjectStorage implements ProjectWriteStorage {
  private readonly stagedParents = new Map<string, string[]>();
  private readonly pendingCreatedParents = new Set<string>();

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

  private resolveRelative(relativePath: string): string {
    try {
      normalizeProjectPath(relativePath);
      if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) throw new Error('absolute path');
    } catch {
      throw pathError(relativePath);
    }
    const candidate = path.resolve(this.rootRealPath, ...relativePath.split('/'));
    if (!isInside(this.rootRealPath, candidate)) throw pathError(relativePath);
    return candidate;
  }

  private async assertSafeTarget(relativePath: string, allowMissing = false): Promise<string> {
    const candidate = this.resolveRelative(relativePath);
    try {
      await this.assertSafeParent(path.dirname(candidate), relativePath, { allowMissing });
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink() || !stat.isFile()) throw pathError(relativePath);
      const real = await fs.realpath(candidate);
      if (!isInside(this.rootRealPath, real) || !samePath(real, candidate)) throw pathError(relativePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissing) {
        return candidate;
      }
      if (error instanceof AuthoringOperationError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AuthoringOperationError('PROJECT_NOT_FOUND', `项目文件不存在：${relativePath}`);
      throw pathError(relativePath);
    }
    return candidate;
  }

  private async assertSafeParent(
    parent: string,
    original: string,
    options: { allowMissing?: boolean; createMissing?: boolean } = {},
    createdParents: string[] = [],
  ): Promise<string> {
    if (!isInside(this.rootRealPath, parent)) throw pathError(original);
    const relative = path.relative(this.rootRealPath, parent);
    const segments = relative.length === 0 ? [] : relative.split(path.sep);
    let current = this.rootRealPath;

    for (const segment of segments) {
      current = path.join(current, segment);
      let stat: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        stat = await fs.lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw pathError(original);
        if (!options.createMissing) {
          if (options.allowMissing) return parent;
          throw pathError(original);
        }
        try {
          await fs.mkdir(current);
          createdParents.push(current);
        } catch (mkdirError) {
          if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw pathError(original);
        }
        stat = await fs.lstat(current).catch(() => { throw pathError(original); });
      }

      if (stat.isSymbolicLink() || !stat.isDirectory()) throw pathError(original);
      let real: string;
      try {
        real = await fs.realpath(current);
      } catch {
        throw pathError(original);
      }
      if (!isInside(this.rootRealPath, real) || !samePath(real, current)) throw pathError(original);
    }
    return current;
  }

  private async assertSafeStage(stagedIdentity: string): Promise<string> {
    const candidate = path.resolve(stagedIdentity);
    if (!isInside(this.rootRealPath, candidate) || !path.basename(candidate).startsWith('.surdet-')) {
      throw pathError(stagedIdentity);
    }
    await this.assertSafeParent(path.dirname(candidate), stagedIdentity);
    try {
      const stat = await fs.lstat(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) throw pathError(stagedIdentity);
      const real = await fs.realpath(candidate);
      if (!isInside(this.rootRealPath, real) || !samePath(real, candidate)) throw pathError(stagedIdentity);
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
        if (entry.isDirectory() && relative === '.surdet/asset-import') continue;
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

  /** 只读文件元数据；不返回内容，且复用项目根/符号链接安全检查。 */
  async inspectFileFacts(relativePaths: readonly string[]): Promise<ProjectAssetFileFact[]> {
    const paths = [...new Set(relativePaths)].sort((left, right) => left.localeCompare(right));
    return Promise.all(paths.map(async (relativePath) => {
      const absolute = await this.assertSafeTarget(relativePath);
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) throw pathError(relativePath);
      return { path: normalizeProjectPath(relativePath), bytes: stat.size };
    }));
  }

  async readText(relativePath: string): Promise<ProjectFile> {
    const absolute = await this.assertSafeTarget(relativePath);
    const bytes = await fs.readFile(absolute);
    const text = bytes.toString('utf8');
    return { path: relativePath, text, bytes: bytes.byteLength, sha256: sha256(bytes) };
  }

  async exists(relativePath: string): Promise<boolean> {
    const candidate = this.resolveRelative(relativePath);
    try {
      await this.assertSafeTarget(relativePath, true);
      try {
        const stat = await fs.lstat(candidate);
        return stat.isFile() && !stat.isSymbolicLink();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    } catch (error) {
      if (error instanceof AuthoringOperationError && error.code === 'PROJECT_NOT_FOUND') return false;
      throw error;
    }
  }

  async stageText(relativePath: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }> {
    const createdParents: string[] = [];
    let stagedIdentity: string | undefined;
    try {
      const target = await this.assertSafeTarget(relativePath, true);
      const parent = await this.assertSafeParent(path.dirname(target), relativePath, { createMissing: true }, createdParents);
      stagedIdentity = path.join(parent, `.surdet-${safeStageName(changeId)}-${crypto.randomUUID()}.tmp`);
      const bytes = Buffer.from(text, 'utf8');
      await fs.writeFile(stagedIdentity, bytes, { flag: 'wx' });
      await this.assertSafeStage(stagedIdentity);
      const reread = await fs.readFile(stagedIdentity);
      const digest = sha256(reread);
      if (digest !== sha256(bytes)) throw new Error(`暂存文件身份不匹配：${relativePath}`);
      this.stagedParents.set(stagedIdentity, [...createdParents]);
      for (const directory of createdParents) this.pendingCreatedParents.add(directory);
      return { stagedIdentity, sha256: digest };
    } catch (error) {
      if (stagedIdentity !== undefined) await fs.rm(stagedIdentity, { force: true }).catch(() => undefined);
      await this.cleanupDirectories(createdParents);
      throw error;
    }
  }

  async replaceFromStage(relativePath: string, stagedIdentity: string): Promise<void> {
    const target = await this.assertSafeTarget(relativePath, true);
    const staged = await this.assertSafeStage(stagedIdentity);
    await replaceFileByRename(staged, target);
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
    const createdParents = this.stagedParents.get(stagedIdentity);
    this.stagedParents.delete(stagedIdentity);
    if (createdParents !== undefined) {
      for (const directory of createdParents) this.pendingCreatedParents.add(directory);
    }
    await this.cleanupPendingDirectories();
  }

  async removePath(relativePath: string): Promise<void> {
    const target = await this.assertSafeTarget(relativePath);
    await fs.rm(target, { force: true });
  }

  private async cleanupDirectories(directories: readonly string[]): Promise<void> {
    const unique = [...new Set(directories)].sort((left, right) => {
      const depth = (value: string) => value.split(path.sep).length;
      return depth(right) - depth(left);
    });
    for (const directory of unique) {
      if (!isInside(this.rootRealPath, directory) || samePath(this.rootRealPath, directory)) continue;
      let stat: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        stat = await fs.lstat(directory);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
      let real: string;
      try {
        real = await fs.realpath(directory);
      } catch {
        continue;
      }
      if (!isInside(this.rootRealPath, real) || !samePath(real, directory)) continue;
      let entries: string[];
      try {
        entries = await fs.readdir(directory);
      } catch {
        continue;
      }
      if (entries.length !== 0) continue;
      try {
        await fs.rmdir(directory);
      } catch {
        // A race or a newly-created user entry leaves the directory in place.
      }
    }
  }

  private async cleanupPendingDirectories(): Promise<void> {
    const directories = [...this.pendingCreatedParents].sort((left, right) => {
      const depth = (value: string) => value.split(path.sep).length;
      return depth(right) - depth(left);
    });
    for (const directory of directories) {
      if (!isInside(this.rootRealPath, directory) || samePath(this.rootRealPath, directory)) {
        this.pendingCreatedParents.delete(directory);
        continue;
      }
      let stat: Awaited<ReturnType<typeof fs.lstat>>;
      try {
        stat = await fs.lstat(directory);
      } catch {
        this.pendingCreatedParents.delete(directory);
        continue;
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        this.pendingCreatedParents.delete(directory);
        continue;
      }
      let real: string;
      try {
        real = await fs.realpath(directory);
      } catch {
        this.pendingCreatedParents.delete(directory);
        continue;
      }
      if (!isInside(this.rootRealPath, real) || !samePath(real, directory)) {
        this.pendingCreatedParents.delete(directory);
        continue;
      }
      let entries: string[];
      try {
        entries = await fs.readdir(directory);
      } catch {
        continue;
      }
      if (entries.length === 0) {
        try {
          await fs.rmdir(directory);
          this.pendingCreatedParents.delete(directory);
        } catch {
          // Keep it pending when another staged file still owns the directory.
        }
      } else if (!entries.some((entry) => entry.startsWith('.surdet-'))) {
        // A committed or user file now occupies the directory; never remove it later.
        this.pendingCreatedParents.delete(directory);
      }
    }
  }
}
