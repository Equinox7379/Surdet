import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AuthoringOperationError, type ChangeRecord, type ChangeRepository } from '@surdet/authoring';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function projectIdentity(rootIdentity: string): string {
  return crypto.createHash('sha256').update(rootIdentity).digest('hex').slice(0, 32);
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

function dataRoot(): string {
  const configured = process.env['SURDET_AGENT_DATA_DIR'];
  if (configured !== undefined && configured.trim().length > 0) return path.resolve(configured);
  const localAppData = process.env['LOCALAPPDATA'];
  return path.join(localAppData ?? path.join(os.homedir(), 'AppData', 'Local'), 'Surdet', 'agent-changes');
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export interface OpenChangeResult {
  store: NodeChangeStore;
  record: ChangeRecord;
}

/**
 * 文件系统变更仓库：事务和证据在项目目录之外持久化，允许每个 CLI 进程
 * 通过 changeId 重新打开同一事务。证据和 trace 均使用独立文件名，失败
 * 记录不会被后一次操作覆盖。
 */
export class NodeChangeStore implements ChangeRepository {
  private constructor(
    readonly rootDirectory: string,
    readonly rootIdentity: string,
    readonly projectDirectory: string,
  ) {}

  static async forProject(rootIdentity: string): Promise<NodeChangeStore> {
    const root = dataRoot();
    const projectDirectory = path.join(root, projectIdentity(rootIdentity));
    await fs.mkdir(projectDirectory, { recursive: true });
    return new NodeChangeStore(root, rootIdentity, projectDirectory);
  }

  /** R5：changeId 全局解析。legacy 进程级序号（chg_0001）可能在多个项目目录下存在同名
   *  journal——必须收集全部匹配后裁决：0 → not-found；1 → 打开；>1 → fail-loud
   *  （CHANGE_ID_AMBIGUOUS），禁止 first-match 静默选择错误项目的 context。 */
  static async openByChangeId(changeId: string): Promise<OpenChangeResult | null> {
    const root = dataRoot();
    const projects = await fs.readdir(root, { withFileTypes: true }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const matches: { projectDirectory: string; record: ChangeRecord }[] = [];
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const transaction = path.join(root, project.name, safeId(changeId), 'transaction.json');
      const record = await readJson<ChangeRecord>(transaction);
      if (record === null || record.changeId !== changeId) continue;
      matches.push({ projectDirectory: path.join(root, project.name), record });
    }
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new AuthoringOperationError(
        'CHANGE_ID_AMBIGUOUS',
        `变更事务 '${changeId}' 在 ${matches.length} 个项目中存在同名记录（${matches.map((m) => m.record.projectRootIdentity).join(' | ')}）——请为各项目隔离 SURDET_AGENT_DATA_DIR，或人工归档冲突的旧事务后重试`,
        { changeId, matchCount: matches.length, projectRootIdentities: matches.map((m) => m.record.projectRootIdentity) },
      );
    }
    const first = matches[0]!;
    return { store: new NodeChangeStore(root, first.record.projectRootIdentity, first.projectDirectory), record: first.record };
  }

  private changeDirectory(changeId: string): string {
    return path.join(this.projectDirectory, safeId(changeId));
  }

  private transactionFile(changeId: string): string {
    return path.join(this.changeDirectory(changeId), 'transaction.json');
  }

  async create(record: ChangeRecord): Promise<void> {
    if (record.projectRootIdentity !== this.rootIdentity) {
      throw new Error('change project identity mismatch');
    }
    const requested = record.changeId;
    let candidate = requested;
    for (;;) {
      const directory = this.changeDirectory(candidate);
      try {
        await fs.mkdir(directory, { recursive: false });
        record.changeId = candidate;
        await writeJson(path.join(directory, 'transaction.json'), record);
        await writeJson(path.join(directory, 'working-files.json'), {
          changeId: record.changeId,
          workingRevision: record.workingRevision,
          files: record.workingFiles,
        });
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        candidate = `${requested}_${crypto.randomUUID().slice(0, 12)}`;
      }
    }
  }

  async read(changeId: string): Promise<ChangeRecord | null> {
    const record = await readJson<ChangeRecord>(this.transactionFile(changeId));
    return record === null ? null : clone(record);
  }

  async write(record: ChangeRecord): Promise<void> {
    if (record.projectRootIdentity !== this.rootIdentity) throw new Error('change project identity mismatch');
    await writeJson(this.transactionFile(record.changeId), record);
    await writeJson(path.join(this.changeDirectory(record.changeId), 'working-files.json'), {
      changeId: record.changeId,
      workingRevision: record.workingRevision,
      files: record.workingFiles,
    });
  }

  async writeEvidence(changeId: string, evidenceId: string, value: unknown): Promise<void> {
    await writeJson(path.join(this.changeDirectory(changeId), 'evidence', `${safeId(evidenceId)}.json`), value);
  }

  async readEvidence(changeId: string, evidenceId: string): Promise<unknown | null> {
    return readJson(path.join(this.changeDirectory(changeId), 'evidence', `${safeId(evidenceId)}.json`));
  }

  async writeJournal(changeId: string, value: unknown): Promise<void> {
    const journalId = `${Date.now()}-${crypto.randomUUID()}`;
    await writeJson(path.join(this.changeDirectory(changeId), 'journals', `${journalId}.json`), value);
  }

  async writeDiff(changeId: string, value: unknown): Promise<void> {
    await writeJson(path.join(this.changeDirectory(changeId), 'diff.json'), value);
  }

  async writeTrace(changeId: string, traceId: string, value: unknown): Promise<void> {
    await writeJson(path.join(this.changeDirectory(changeId), 'traces', `${safeId(traceId)}.json`), value);
  }

  async readTrace(changeId: string, traceId: string): Promise<unknown | null> {
    return readJson(path.join(this.changeDirectory(changeId), 'traces', `${safeId(traceId)}.json`));
  }
}
