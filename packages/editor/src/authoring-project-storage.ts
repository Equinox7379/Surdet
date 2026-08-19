import {
  AuthoringOperationError,
  InMemoryChangeRepository,
  applyCharacterEnsure,
  assetPathsFromFiles,
  beginChange,
  buildAssetCatalog,
  buildObjectIndex,
  charactersFingerprint,
  commitChange,
  loadProjectSnapshot,
  recordValidation,
  validateSnapshot,
  type ChangeSession,
  type ChangeRecord,
  type ProjectFile,
  type ProjectStorage,
  type ProjectWriteStorage,
  type TextHasher,
} from '@surdet/authoring';
import { state, type SceneEntry, type TimelineEntry } from './state.js';
import { assetPathForHandle, writeFileHandle } from './project-io.js';

export interface EditorProjectStorage extends ProjectStorage, TextHasher {}

function bytesOf(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function scenarioPath(scene: SceneEntry): string {
  return scene.file.startsWith('content/scenario/') ? scene.file : `content/scenario/${scene.file}`;
}

function timelinePath(timeline: TimelineEntry): string {
  return timeline.file.startsWith('content/timelines/') ? timeline.file : `content/timelines/${timeline.file}`;
}

function configText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * 把 editor 当前内存投影为 authoring 只读存储。读取始终来自 state，
 * 因此 dirty 场景在建 snapshot/index 前不会被磁盘内容覆盖。
 */
export function createEditorProjectStorage(source = state): EditorProjectStorage {
  const files = (): Map<string, string> => {
    const result = new Map<string, string>();
    result.set('game.config.json', source.gameConfigText);
    for (const scene of source.scenes.values()) result.set(scenarioPath(scene), scene.text);
    for (const timeline of source.timelines) result.set(timelinePath(timeline), timeline.text);
    for (const [name, value] of Object.entries(source.configFiles)) {
      if (value !== null) result.set(`content/config/${name}.json`, configText(value));
    }
    return result;
  };
  /** 资产路径元数据：只枚举 content/assets 下的 bg/portrait/avatar 文件路径，不读文件内容。 */
  const assetPaths = (): string[] => {
    const paths: string[] = [];
    for (const asset of source.dirAssets) {
      if (asset.kind !== 'bg' && asset.kind !== 'portrait' && asset.kind !== 'avatar') continue;
      const relative = asset.handle === null ? undefined : assetPathForHandle(asset.handle);
      if (relative === undefined || !relative.startsWith('content/assets/')) continue;
      paths.push(relative);
    }
    return paths;
  };
  const sha256 = async (text: string): Promise<string> => {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return hex(digest);
  };
  return {
    rootIdentity: `editor:${source.dirName || 'untitled'}`,
    sha256,
    async listFiles(): Promise<string[]> {
      return [...new Set([...files().keys(), ...assetPaths()])].sort((a, b) => a.localeCompare(b));
    },
    async readText(filePath: string): Promise<ProjectFile> {
      const text = files().get(filePath);
      if (text === undefined) throw new Error(`项目内存文件不存在：${filePath}`);
      return { path: filePath, text, bytes: bytesOf(text), sha256: await sha256(text) };
    },
    async exists(filePath: string): Promise<boolean> {
      return files().has(filePath);
    },
  };
}

/** 以当前 editor 内存为唯一输入构建共享 authoring snapshot。 */
export async function loadEditorProjectSnapshot(): Promise<Awaited<ReturnType<typeof loadProjectSnapshot>>> {
  const storage = createEditorProjectStorage();
  return loadProjectSnapshot(storage, storage);
}

/* ================= Wave 3 closure：角色表经共享 character.ensure 语义写盘 =================
 * Editor 只做两件事：把 UI 行模型翻译成 CharacterEnsureInput，把 game.config.json 的
 * 落盘适配成 ProjectWriteStorage。指纹门控、事务、校验、冲突检测全部由 @surdet/authoring
 * 拥有——与 CLI / Agent 走同一 semantic truth，编辑器不复制第二套写实现。 */

/** 角色表编辑行（UI 行模型；avatar 空串 = 清除，与共享操作 null 语义对应）。 */
export interface CharacterTableEditRow {
  id: string;
  name: string;
  avatar: string;
}

export interface CharacterTableCommitResult {
  changeId: string;
  /** 提交后的 game.config.json 全文。 */
  updatedText: string;
  /** 实际产生的 character.ensure 操作数。 */
  changed: number;
}

const CONFIG_PATH = 'game.config.json';

/** 事务 workingFiles → 只读 ProjectStorage（与 CLI authoring-service 的 WorkingProjectStorage 同构）。 */
function workingFilesStorage(record: ChangeRecord, base: EditorProjectStorage): ProjectStorage {
  return {
    rootIdentity: record.projectRootIdentity,
    async listFiles(): Promise<string[]> {
      return Object.keys(record.workingFiles).sort((a, b) => a.localeCompare(b));
    },
    async readText(filePath: string): Promise<ProjectFile> {
      const text = record.workingFiles[filePath];
      if (text === undefined) throw new Error(`事务文件不存在：${filePath}`);
      return { path: filePath, text, bytes: bytesOf(text), sha256: await base.sha256(text) };
    },
    async exists(filePath: string): Promise<boolean> {
      return Object.prototype.hasOwnProperty.call(record.workingFiles, filePath);
    },
  };
}

/** game.config.json 的浏览器写侧存储：读真盘（供 commitChange 做基线冲突检测），
 *  staging 在内存，替换/恢复经 File System Access 句柄写回。本轮只写既有 game.config.json。 */
class GameConfigWriteStorage implements ProjectWriteStorage {
  readonly rootIdentity: string;
  private readonly staged = new Map<string, string>();

  constructor(
    private readonly base: EditorProjectStorage,
    private readonly handle: FileSystemFileHandle,
  ) {
    this.rootIdentity = base.rootIdentity;
  }

  async listFiles(): Promise<string[]> {
    return this.base.listFiles();
  }

  async readText(filePath: string): Promise<ProjectFile> {
    if (filePath !== CONFIG_PATH) return this.base.readText(filePath);
    const text = await (await this.handle.getFile()).text();
    return { path: filePath, text, bytes: bytesOf(text), sha256: await this.base.sha256(text) };
  }

  async exists(filePath: string): Promise<boolean> {
    if (filePath !== CONFIG_PATH) return this.base.exists(filePath);
    return true;
  }

  async stageText(path: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }> {
    const stagedIdentity = `${changeId}:${path}`;
    this.staged.set(stagedIdentity, text);
    return { stagedIdentity, sha256: await this.base.sha256(text) };
  }

  async replaceFromStage(path: string, stagedIdentity: string): Promise<void> {
    const text = this.staged.get(stagedIdentity);
    if (text === undefined) throw new Error(`staged 内容不存在：${path}`);
    await writeFileHandle(this.handle, text);
  }

  async restoreText(path: string, originalText: string): Promise<void> {
    if (path !== CONFIG_PATH) throw new Error(`编辑器写侧只支持 ${CONFIG_PATH}：${path}`);
    await writeFileHandle(this.handle, originalText);
  }

  async removeStage(stagedIdentity: string): Promise<void> {
    this.staged.delete(stagedIdentity);
  }
}

/** 把角色表编辑行经共享 authoring 事务提交到 game.config.json。
 *  链路：editor 内存快照 → beginChange → 逐角色 character.ensure（指纹链式传递）→
 *  validateSnapshot + recordValidation → commitChange（磁盘基线冲突检测 + stage/替换/恢复）。
 *  失败（指纹不符 / 校验 error / 磁盘基线变化）一律 fail-loud 抛 AuthoringOperationError，不落盘。 */
export async function commitCharacterTable(rows: readonly CharacterTableEditRow[]): Promise<CharacterTableCommitResult> {
  const handle = state.handles.gameConfig;
  if (handle === null) {
    throw new AuthoringOperationError('PROJECT_NOT_FOUND', '未连接 game.config.json（演示项目不落盘）');
  }
  const base = createEditorProjectStorage();
  const snapshot = await loadProjectSnapshot(base, base);
  const session: ChangeSession = await beginChange(snapshot, new InMemoryChangeRepository());

  // 差异行：name 或 avatar 相对当前内存基线变化的角色才产生 ensure 操作；未触碰字段保持原样。
  const charactersValue = snapshot.config['characters'];
  const table = typeof charactersValue === 'object' && charactersValue !== null && !Array.isArray(charactersValue)
    ? charactersValue as Record<string, unknown>
    : {};
  const baselineOf = (id: string): { name: string; avatar: string } | undefined => {
    const raw = table[id];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    return {
      name: typeof record['name'] === 'string' ? record['name'] as string : '',
      avatar: typeof record['avatar'] === 'string' ? record['avatar'] as string : '',
    };
  };
  let fingerprint = await charactersFingerprint(snapshot.config, base);
  let changed = 0;
  for (const row of rows) {
    const baseline = baselineOf(row.id);
    if (baseline === undefined) {
      throw new AuthoringOperationError('OBJECT_NOT_FOUND', `角色不存在：${row.id}`);
    }
    const nameChanged = row.name !== baseline.name;
    const avatarChanged = row.avatar !== baseline.avatar;
    if (!nameChanged && !avatarChanged) continue;
    const result = await applyCharacterEnsure(session, {
      operationId: `editor:character.ensure:${row.id}`,
      id: row.id,
      name: row.name,
      // avatar 未变时传 undefined（共享语义：保留原值），空串按 null（清除）
      ...(avatarChanged ? { avatar: row.avatar.trim().length === 0 ? null : row.avatar } : {}),
      expectedFingerprint: fingerprint,
    }, base);
    fingerprint = result.fingerprint;
    changed += 1;
  }
  const workingText = session.record.workingFiles[CONFIG_PATH] ?? '';
  if (changed === 0) {
    return { changeId: session.record.changeId, updatedText: workingText, changed: 0 };
  }

  // 共享校验门（与 CLI project.validate 同构）：对象索引 + 资产目录 + 快照校验，error 必须 = 0。
  const workingSnapshot = await loadProjectSnapshot(workingFilesStorage(session.record, base), base);
  const index = buildObjectIndex(workingSnapshot);
  const assetCatalog = buildAssetCatalog(assetPathsFromFiles(await base.listFiles()));
  const validation = validateSnapshot(workingSnapshot, index, { assetCatalog });
  const errors = validation.issues.filter((issue) => issue.severity === 'error');
  await recordValidation(session, {
    evidenceId: `editor:validation:${Date.now()}`,
    errors: errors.length,
  });
  if (errors.length > 0) {
    throw new AuthoringOperationError('VALIDATION_FAILED', `角色表校验未通过：${errors[0]!.code} ${errors[0]!.text}`);
  }

  await commitChange(session, new GameConfigWriteStorage(base, handle));
  const updatedText = session.record.workingFiles[CONFIG_PATH]!;
  state.gameConfigText = updatedText;
  return { changeId: session.record.changeId, updatedText, changed };
}
