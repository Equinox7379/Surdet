import { projectPortraitOverrides, readProjectStage, resolvePlayerTheme, resolveProjectFontPaths, stagePinnedSourcePaths, THEME_TOKEN_GROUPS, type CharacterVisuals } from '@surdet/core';
import { inspectStageConfig, applyStageConfigPatch, inspectThemeConfig, applyThemeConfigPatch, inspectPlayerConfig, applyPlayerConfigPatch, type PlayerConfigPatchInput, parseProjectConfigDocument } from '@surdet/authoring';
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
  stableStringify,
  validateSnapshot,
  type ChangeSession,
  type ChangeRecord,
  type ProjectFile,
  type ProjectStorage,
  type ProjectWriteStorage,
  type SpeakerMigrationImpact,
  type TextHasher,
} from '@surdet/authoring';
import { state, type SceneEntry, type TimelineEntry } from './state.js';
import { assertConfigSourcesReadable } from './config-source.js';
import { assetPathForHandle, readProjectSourceText, workingGameConfigText, writeFileHandle } from './project-io.js';

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
    assertConfigSourcesReadable(undefined, source);
    const result = new Map<string, string>();
    result.set('game.config.json', workingGameConfigText(source));
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
      const relative = asset.sourcePath ?? (asset.handle === null ? undefined : assetPathForHandle(asset.handle));
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
  /** Explicit local creation intent, never inferred from a missing old declaration. */
  create?: true;
  id: string;
  name: string;
  avatar: string;
  /** UI rows preserve incomplete input until save; omitted leaves the stored mapping untouched. */
  portraits?: { outfit: string; expression: string; sourcePath: string }[];
  /** Raw JSON draft; omitted preserves the existing visuals declaration. */
  visualsText?: string;
}

export interface CharacterTableCommitResult {
  changeId: string;
  /** 提交后的 game.config.json 全文。 */
  updatedText: string;
  /** 实际产生的 character.ensure 操作数。 */
  changed: number;
  /** 改名在同一事务内同步迁移的台词 speaker 引用（共享层返回的机器可读证据）。 */
  speakerMigrations: SpeakerMigrationImpact[];
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

/** 浏览器写侧存储：读真盘（供 commitChange 做基线冲突检测），staging 在内存，
 *  替换/恢复经 File System Access 句柄写回。支持 game.config.json 与既有场景文件
 *  （character.ensure 改名会在同一事务里同步迁移场景 speaker 令牌）。 */
class EditorWriteStorage implements ProjectWriteStorage {
  readonly rootIdentity: string;
  private readonly staged = new Map<string, string>();

  constructor(
    private readonly base: EditorProjectStorage,
    private readonly gameConfigHandle: FileSystemFileHandle,
    private readonly sceneHandles: Map<string, FileSystemFileHandle>,
  ) {
    this.rootIdentity = base.rootIdentity;
  }

  private handleFor(path: string): FileSystemFileHandle | undefined {
    if (path === CONFIG_PATH) return this.gameConfigHandle;
    return this.sceneHandles.get(path);
  }

  async listFiles(): Promise<string[]> {
    return this.base.listFiles();
  }

  async readText(filePath: string): Promise<ProjectFile> {
    const handle = this.handleFor(filePath);
    if (handle === undefined) return this.base.readText(filePath);
    const text = await readProjectSourceText(handle);
    return { path: filePath, text, bytes: bytesOf(text), sha256: await this.base.sha256(text) };
  }

  async exists(filePath: string): Promise<boolean> {
    if (filePath === CONFIG_PATH) return true;
    if (this.sceneHandles.has(filePath)) return true;
    return this.base.exists(filePath);
  }

  async stageText(path: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }> {
    const stagedIdentity = `${changeId}:${path}`;
    this.staged.set(stagedIdentity, text);
    return { stagedIdentity, sha256: await this.base.sha256(text) };
  }

  async replaceFromStage(path: string, stagedIdentity: string): Promise<void> {
    const handle = this.handleFor(path);
    if (handle === undefined) throw new Error(`编辑器写侧不支持该文件：${path}`);
    const text = this.staged.get(stagedIdentity);
    if (text === undefined) throw new Error(`staged 内容不存在：${path}`);
    await writeFileHandle(handle, text);
  }

  async restoreText(path: string, originalText: string): Promise<void> {
    const handle = this.handleFor(path);
    if (handle === undefined) throw new Error(`编辑器写侧不支持该文件：${path}`);
    await writeFileHandle(handle, originalText);
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
  const visualsById = new Map<string, CharacterVisuals | null>();
  for (const row of rows) {
    if (row.visualsText !== undefined) visualsById.set(row.id, parseCharacterVisualsDraft(row.id, row.visualsText));
  }
  const handle = state.handles.gameConfig;
  if (handle === null) {
    throw new AuthoringOperationError('PROJECT_NOT_FOUND', '未连接 game.config.json（演示项目不落盘）');
  }
  const submittedSceneTexts = new Map([...state.scenes.values()].map(scene => [scene, scene.text]));
  const base = createEditorProjectStorage();
  const snapshot = await loadProjectSnapshot(base, base);
  const session: ChangeSession = await beginChange(snapshot, new InMemoryChangeRepository());

  // 仅变化的角色资料产生 ensure；旧调用方省略 portraits 时保留原映射。
  const charactersValue = snapshot.config['characters'];
  const table = typeof charactersValue === 'object' && charactersValue !== null && !Array.isArray(charactersValue)
    ? charactersValue as Record<string, unknown>
    : {};
  const baselineOf = (id: string): { name: string; avatar: string; portraits: unknown; visuals: unknown } | undefined => {
    const raw = table[id];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    return {
      name: typeof record['name'] === 'string' ? record['name'] as string : '',
      avatar: typeof record['avatar'] === 'string' ? record['avatar'] as string : '',
      portraits: record['portraits'] ?? {},
      visuals: record['visuals'] ?? null,
    };
  };
  let fingerprint = await charactersFingerprint(snapshot.config, base);
  let changed = 0;
  const speakerMigrations: SpeakerMigrationImpact[] = [];
  const assetPaths = assetPathsFromFiles(await base.listFiles());
  const physicalAssets = buildAssetCatalog(assetPaths);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new AuthoringOperationError('VALIDATION_FAILED', '角色表含重复 ID');
  for (const row of rows) {
    const baseline = baselineOf(row.id);
    if (row.create === true && Object.prototype.hasOwnProperty.call(table, row.id)) {
      throw new AuthoringOperationError('OBJECT_PRECONDITION_FAILED', `新角色 ID 已存在：${row.id}`);
    }
    if (baseline === undefined && row.create !== true) {
      throw new AuthoringOperationError('OBJECT_NOT_FOUND', `原角色不存在，请重新读取项目，不会自动重建：${row.id}`);
    }
    const nameChanged = baseline === undefined || row.name !== baseline.name;
    const avatarChanged = baseline === undefined ? row.avatar !== '' : row.avatar !== baseline.avatar;
    const portraitEntries = new Map<string, Map<string, string>>();
    for (const portrait of row.portraits ?? []) {
      const expressions = portraitEntries.get(portrait.outfit) ?? new Map<string, string>();
      if (expressions.has(portrait.expression)) throw new AuthoringOperationError('VALIDATION_FAILED', `角色 ${row.id} 的服装/表情重复：${portrait.outfit} / ${portrait.expression}`);
      expressions.set(portrait.expression, portrait.sourcePath);
      portraitEntries.set(portrait.outfit, expressions);
    }
    const portraits = Object.fromEntries([...portraitEntries].map(([outfit, expressions]) => [outfit, Object.fromEntries(expressions)]));
    const portraitsChanged = row.portraits !== undefined && stableStringify(portraits) !== stableStringify(baseline?.portraits ?? {});
    const visuals = visualsById.get(row.id);
    const visualsChanged = row.visualsText !== undefined && stableStringify(visuals) !== stableStringify(baseline?.visuals ?? null);
    if (!nameChanged && !avatarChanged && !portraitsChanged && !visualsChanged) continue;
    const result = await applyCharacterEnsure(session, {
      operationId: `editor:character.ensure:${row.id}`,
      id: row.id,
      name: row.name,
      // avatar 未变时传 undefined（共享语义：保留原值），空串按 null（清除）
      ...(avatarChanged ? { avatar: row.avatar.trim().length === 0 ? null : row.avatar } : {}),
      ...(portraitsChanged ? { portraits: row.portraits!.length === 0 ? null : portraits } : {}),
      ...(visualsChanged ? { visuals: visuals! } : {}),
      expectedFingerprint: fingerprint,
    }, base, undefined, physicalAssets);
    fingerprint = result.fingerprint;
    changed += 1;
    if (result.speakerMigrations !== undefined) speakerMigrations.push(...result.speakerMigrations);
  }
  const workingText = session.record.workingFiles[CONFIG_PATH] ?? '';
  if (changed === 0) {
    return { changeId: session.record.changeId, updatedText: workingText, changed: 0, speakerMigrations };
  }

  // 共享校验门（与 CLI project.validate 同构）：对象索引 + 资产目录 + 快照校验，error 必须 = 0。
  const workingSnapshot = await loadProjectSnapshot(workingFilesStorage(session.record, base), base);
  const index = buildObjectIndex(workingSnapshot);
  const assetCatalog = buildAssetCatalog(assetPaths, workingSnapshot);
  const validation = validateSnapshot(workingSnapshot, index, { assetCatalog, timelineReferenceScope: 'complete' });
  const errors = validation.issues.filter((issue) => issue.severity === 'error');
  await recordValidation(session, {
    evidenceId: `editor:validation:${Date.now()}`,
    errors: errors.length,
  });
  if (errors.length > 0) {
    throw new AuthoringOperationError('VALIDATION_FAILED', `角色表校验未通过：${errors[0]!.code} ${errors[0]!.text}`);
  }

  // 场景句柄映射：character.ensure 改名迁移会在同一事务内改写场景 speaker 令牌。
  const sceneHandles = new Map<string, FileSystemFileHandle>();
  for (const scene of state.scenes.values()) {
    if (scene.handle !== null) sceneHandles.set(scenarioPath(scene), scene.handle);
  }
  const committed = await commitChange(session, new EditorWriteStorage(base, handle, sceneHandles));
  const updatedText = session.record.workingFiles[CONFIG_PATH]!;
  state.gameConfigText = updatedText;
  // 同步被迁移场景的 editor 内存态（磁盘已是新文本，内存不得停留旧 speaker）。
  for (const scene of state.scenes.values()) {
    const filePath = scenarioPath(scene);
    if (!committed.files.includes(filePath) || !submittedSceneTexts.has(scene)) continue;
    const migrated = session.record.workingFiles[filePath]!;
    const persistedSha256 = await base.sha256(migrated);
    if (scene.text === submittedSceneTexts.get(scene)) scene.text = migrated;
    scene.persistedSha256 = persistedSha256;
    scene.dirty = scene.text !== migrated;
  }
  return { changeId: session.record.changeId, updatedText, changed, speakerMigrations };
}

export function parseCharacterVisualsDraft(id: string, text: string): CharacterVisuals | null {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthoringOperationError('VALIDATION_FAILED', `角色 ${id} 的分层 / 帧动画 JSON 无效：${detail}`);
  }
  if (value === null) return null;
  try {
    projectPortraitOverrides({ characters: { [id]: { visuals: value } } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AuthoringOperationError('VALIDATION_FAILED', `角色 ${id} 的分层 / 帧动画定义无效：${detail}`);
  }
  return value as CharacterVisuals;
}


/** Narrow stage writer: the same source-preserving authoring transaction used
 * by the character table. Source application is explicit and direct-only. */
export async function commitStageConfiguration(stageValue: Record<string, unknown> | null, expectedConfigText: string): Promise<{ text: string; before: unknown; after: unknown }> {
  const root = state.dirHandle, handle = state.handles.gameConfig;
  const name = state.dirName;
  if (!root || !handle || state.reviewWorkspace !== null || state.reviewPreviewReadOnly || state.projectLoading)
    throw new Error('舞台配置只可保存到当前可写项目，不能改写审阅结果。');
  if (state.gameConfigText !== expectedConfigText) throw new Error('配置已经改变，请刷新舞台配置。');
  const beforeConfig = parseProjectConfigDocument(expectedConfigText || '{}');
  readProjectStage({ stage: stageValue });
  const editorStorage = createEditorProjectStorage();
  const snapshot = await loadProjectSnapshot(editorStorage, editorStorage);
  const pins = new Set(stagePinnedSourcePaths({ stage: stageValue }));
  const assetFiles = await Promise.all(state.dirAssets.flatMap(asset => {
    const sourcePath = asset.sourcePath ?? (asset.handle ? assetPathForHandle(asset.handle) : undefined);
    if (!sourcePath) return [];
    return [(async () => {
      if (!pins.has(sourcePath)) return { path: sourcePath, bytes: asset.bytes };
      if (!asset.handle) throw new Error(`校准素材不可读取：${sourcePath}`);
      const file = await asset.handle.getFile(), bytes = await file.arrayBuffer();
      const sha256 = hex(await crypto.subtle.digest('SHA-256', bytes));
      return { path: sourcePath, bytes: bytes.byteLength, sha256 };
    })()];
  }));
  if (state.dirHandle !== root || state.handles.gameConfig !== handle || state.dirName !== name || state.gameConfigText !== expectedConfigText) throw new Error('校准读取期间项目已变化。');
  const before = await inspectStageConfig(beforeConfig, editorStorage);
  const session = await beginChange(snapshot, new InMemoryChangeRepository());
  session.record.composition = { ...session.record.composition!, mode: 'direct' };
  // Replace only the supported stage object; omitted tables should not retain
  // an old value when the human explicitly edited the complete stage form.
  const patch = stageValue === null ? null : Object.fromEntries(['version', 'design', 'positions', 'distances', 'portraits', 'compositions']
    .map(key => [key, stageValue[key] ?? (key === 'version' ? 1 : null)]));
  const result = await applyStageConfigPatch(session, { operationId: crypto.randomUUID(), expectedFingerprint: before.fingerprint, patch }, editorStorage,
    buildAssetCatalog(assetFiles, snapshot, { gallery: state.configFiles.gallery }));
  const text = session.record.workingFiles['game.config.json']!;
  const validationStorage: ProjectStorage = { ...editorStorage,
    readText: async path => { if (path === 'game.config.json') return { path, text, bytes: bytesOf(text), sha256: await editorStorage.sha256(text) }; return editorStorage.readText(path); } };
  const changedSnapshot = await loadProjectSnapshot(validationStorage, editorStorage);
  const validation = validateSnapshot(changedSnapshot, buildObjectIndex(changedSnapshot), { assetCatalog: buildAssetCatalog(assetFiles, changedSnapshot, { gallery: state.configFiles.gallery }) });
  if (!validation.ok) throw new Error(validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.text).join('\n'));
  await recordValidation(session, { evidenceId: `editor-stage-${crypto.randomUUID()}`, errors: 0 });
  const sceneHandles = new Map<string, FileSystemFileHandle>();
  for (const scene of state.scenes.values()) if (scene.handle) sceneHandles.set(scenarioPath(scene), scene.handle);
  const committed = await commitChange(session, new EditorWriteStorage(editorStorage, handle, sceneHandles));
  const actual = committed.files.includes('game.config.json') ? session.record.workingFiles['game.config.json'] : undefined;
  if (actual === undefined) {
    if (text === expectedConfigText) return { text, before: before.value, after: result.stageConfig.value };
    throw new Error('舞台配置事务未返回已写入正文。');
  }
  if (state.dirHandle !== root || state.handles.gameConfig !== handle || state.dirName !== name) throw new Error('原项目配置已写入，但当前项目已切换；没有覆盖当前项目内存。');
  state.gameConfigText = actual;
  return { text: actual, before: before.value, after: result.stageConfig.value };
}

const EDITOR_THEME_FIELDS = [...THEME_TOKEN_GROUPS, 'dialogSkin', 'buttonSkin', 'dialogHeightRatio', 'dialogMarginX', 'dialogMarginBottom'] as const;
const editorThemeFieldSet = new Set<string>(EDITOR_THEME_FIELDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface ThemeEditorDraft {
  theme: Record<string, unknown> | null;
  titleLogo: string | null;
  playerConfig?: Pick<PlayerConfigPatchInput['patch'], 'font' | 'fonts' | 'titleBackground'>;
}

/** The JSON form owns only documented theme fields and player.titleLogo. */
export function parseThemeEditorDraft(text: string): ThemeEditorDraft {
  const raw: unknown = JSON.parse(text);
  if (!isRecord(raw)) throw new Error('主题配置必须是对象。');
  for (const key of Object.keys(raw)) {
    if (!['theme', 'titleLogo', 'font', 'fonts', 'titleBackground'].includes(key)) throw new Error(`主题草稿不支持字段：${key}`);
  }
  const theme = raw['theme'] ?? null;
  if (theme !== null && !isRecord(theme)) throw new Error('theme 必须是对象或 null。');
  const titleLogo = raw['titleLogo'] ?? null;
  if (titleLogo !== null && typeof titleLogo !== 'string') throw new Error('titleLogo 必须是字符串或 null。');
  const playerConfig: NonNullable<ThemeEditorDraft['playerConfig']> = {};
  for (const key of ['font', 'titleBackground'] as const) if (Object.hasOwn(raw, key)) {
    const value = raw[key];
    if (value !== null && typeof value !== 'string') throw new Error(`${key} 必须是字符串或 null。`);
    playerConfig[key] = value;
  }
  if (Object.hasOwn(raw, 'fonts')) {
    const value = raw['fonts'];
    if (value !== null && !isRecord(value)) throw new Error('fonts 必须是字体角色对象或 null。');
    if (isRecord(value)) for (const [role, path] of Object.entries(value)) {
      if (!['body', 'title', 'ui'].includes(role) || (path !== null && typeof path !== 'string')) throw new Error(`字体角色或路径无效：${role}`);
    }
    playerConfig.fonts = value as NonNullable<ThemeEditorDraft['playerConfig']>['fonts'];
  }
  return { theme, titleLogo, playerConfig };
}

/** Project a complete Editor draft while retaining source fields outside its ownership. */
export function projectThemeEditorDraft(config: Record<string, unknown>, draft: ThemeEditorDraft): Record<string, unknown> {
  if (draft.theme !== null && !isRecord(draft.theme)) throw new Error('theme 必须是对象或 null。');
  if (draft.titleLogo !== null && typeof draft.titleLogo !== 'string') throw new Error('titleLogo 必须是字符串或 null。');
  const projected = { ...config };
  if (draft.theme === null) {
    delete projected['theme'];
  } else {
    const sourceTheme = isRecord(config['theme']) ? config['theme'] : {};
    const nextTheme = { ...sourceTheme };
    for (const [key, value] of Object.entries(draft.theme)) {
      if (!editorThemeFieldSet.has(key) && (!Object.hasOwn(sourceTheme, key) || stableStringify(sourceTheme[key]) !== stableStringify(value))) {
        throw new Error(`主题字段 ${key} 不属于当前编辑器表单，请保留来源值。`);
      }
    }
    for (const key of EDITOR_THEME_FIELDS) {
      if (Object.hasOwn(draft.theme, key) && draft.theme[key] !== null) nextTheme[key] = draft.theme[key];
      else delete nextTheme[key];
    }
    if (Object.keys(nextTheme).length > 0) projected['theme'] = nextTheme;
    else delete projected['theme'];
  }
  const playerRaw = config['player'];
  if (playerRaw !== undefined && !isRecord(playerRaw)) throw new Error('game.config.json.player 必须是对象。');
  const player = isRecord(playerRaw) ? { ...playerRaw } : {};
  for (const field of ['font', 'fonts', 'titleBackground'] as const) if (Object.hasOwn(draft.playerConfig ?? {}, field)) {
    const value = draft.playerConfig![field];
    const target = field === 'titleBackground' ? player : projected;
    if (value === null) delete target[field];
    else if (field === 'fonts' && isRecord(value)) target[field] = Object.fromEntries(Object.entries(value).filter(([, path]) => path !== null));
    else target[field] = value;
  }
  if (draft.titleLogo === null) delete player['titleLogo'];
  else player['titleLogo'] = draft.titleLogo;
  if (Object.keys(player).length > 0) projected['player'] = player;
  else delete projected['player'];
  resolvePlayerTheme(projected);
  resolveProjectFontPaths(projected);
  return projected;
}

/** Narrow theme writer: translate a complete Editor form to shared field patches
 * in one direct transaction, preserving unrelated project fields. */
export async function commitThemeConfiguration(themeValue: Record<string, unknown> | null, titleLogo: string | null | undefined, expectedConfigText: string, playerConfig: ThemeEditorDraft['playerConfig'] = {}): Promise<{ text: string; before: unknown; after: unknown }> {
  const root = state.dirHandle, handle = state.handles.gameConfig;
  const name = state.dirName;
  if (!root || !handle || state.reviewWorkspace !== null || state.reviewPreviewReadOnly || state.projectLoading)
    throw new Error('主题配置只可保存到当前可写项目，不能改写审阅结果。');
  if (state.gameConfigText !== expectedConfigText) throw new Error('配置已经改变，请刷新主题配置。');
  const beforeConfig = parseProjectConfigDocument(expectedConfigText || '{}');
  const draft: ThemeEditorDraft = { theme: themeValue, playerConfig, titleLogo: titleLogo === undefined
    ? ((isRecord(beforeConfig['player']) && typeof beforeConfig['player']['titleLogo'] === 'string') ? beforeConfig['player']['titleLogo'] : null)
    : titleLogo };
  const projected = projectThemeEditorDraft(beforeConfig, draft);
  const editorStorage = createEditorProjectStorage();
  const snapshot = await loadProjectSnapshot(editorStorage, editorStorage);
  const assetFiles = state.dirAssets.flatMap(asset => {
    const sourcePath = asset.sourcePath ?? (asset.handle ? assetPathForHandle(asset.handle) : undefined);
    return sourcePath ? [{ path: sourcePath, bytes: asset.bytes }] : [];
  });
  if (state.dirHandle !== root || state.handles.gameConfig !== handle || state.dirName !== name || state.gameConfigText !== expectedConfigText) throw new Error('主题读取期间项目已变化。');
  const before = await inspectThemeConfig(beforeConfig, editorStorage);
  const session = await beginChange(snapshot, new InMemoryChangeRepository());
  session.record.composition = { ...session.record.composition!, mode: 'direct' };
  const patch: Record<string, unknown> = {};
  const sourceTheme = isRecord(beforeConfig['theme']) ? beforeConfig['theme'] : {};
  const nextTheme = isRecord(projected['theme']) ? projected['theme'] : null;
  if (nextTheme !== null) {
    for (const key of EDITOR_THEME_FIELDS) {
      const oldHas = Object.hasOwn(sourceTheme, key), nextHas = Object.hasOwn(nextTheme, key);
      if (oldHas !== nextHas || (oldHas && stableStringify(sourceTheme[key]) !== stableStringify(nextTheme[key]))) {
        patch[key] = nextHas ? nextTheme[key] : null;
      }
    }
  }
  const projectedLogo = draft.titleLogo;
  if (before.titleLogo !== projectedLogo) patch.titleLogo = projectedLogo;
  const catalog = buildAssetCatalog(assetFiles, snapshot, { gallery: state.configFiles.gallery });
  let playerChanged = false;
  if (Object.keys(playerConfig).length > 0) {
    const beforePlayer = await inspectPlayerConfig(beforeConfig, editorStorage);
    const playerPatch = { ...playerConfig };
    if (playerPatch.fonts !== undefined && playerPatch.fonts !== null) playerPatch.fonts = { body: null, title: null, ui: null, ...playerPatch.fonts };
    await applyPlayerConfigPatch(session, { operationId: crypto.randomUUID(), expectedFingerprint: beforePlayer.fingerprint, patch: playerPatch }, editorStorage, catalog);
    playerChanged = true;
  }
  let result;
  if (nextTheme === null && before.value !== null) {
    result = await applyThemeConfigPatch(session,
      { operationId: crypto.randomUUID(), expectedFingerprint: before.fingerprint, patch: null }, editorStorage, catalog);
  }
  if (Object.keys(patch).length > 0) {
    result = await applyThemeConfigPatch(session,
      { operationId: crypto.randomUUID(), expectedFingerprint: result?.themeConfig.fingerprint ?? before.fingerprint, patch }, editorStorage, catalog);
  }
  if (!result && !playerChanged) return { text: expectedConfigText, before: before.value, after: before.value };
  const afterTheme = result ? result.themeConfig.value : before.value;
  const text = session.record.workingFiles['game.config.json']!;
  const validationStorage: ProjectStorage = { ...editorStorage,
    readText: async path => { if (path === 'game.config.json') return { path, text, bytes: bytesOf(text), sha256: await editorStorage.sha256(text) }; return editorStorage.readText(path); } };
  const changedSnapshot = await loadProjectSnapshot(validationStorage, editorStorage);
  const validation = validateSnapshot(changedSnapshot, buildObjectIndex(changedSnapshot), { assetCatalog: buildAssetCatalog(assetFiles, changedSnapshot, { gallery: state.configFiles.gallery }) });
  if (!validation.ok) throw new Error(validation.issues.filter(issue => issue.severity === 'error').map(issue => issue.text).join('\n'));
  await recordValidation(session, { evidenceId: `editor-theme-${crypto.randomUUID()}`, errors: 0 });
  const sceneHandles = new Map<string, FileSystemFileHandle>();
  for (const scene of state.scenes.values()) if (scene.handle) sceneHandles.set(scenarioPath(scene), scene.handle);
  const committed = await commitChange(session, new EditorWriteStorage(editorStorage, handle, sceneHandles));
  const actual = committed.files.includes('game.config.json') ? session.record.workingFiles['game.config.json'] : undefined;
  if (actual === undefined) {
    if (text === expectedConfigText) return { text, before: before.value, after: afterTheme };
    throw new Error('主题配置事务未返回已写入正文。');
  }
  if (state.dirHandle !== root || state.handles.gameConfig !== handle || state.dirName !== name) throw new Error('原项目配置已写入，但当前项目已切换；没有覆盖当前项目内存。');
  state.gameConfigText = actual;
  return { text: actual, before: before.value, after: afterTheme };
}
