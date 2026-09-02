import type { CompiledScene } from '@surdet/core';
import type { RecordedOperation } from './composition-contracts.js';
import type { IntegrationMetadata } from './integration-execution.js';

export type SceneEol = '\r\n' | '\n' | '\r' | '';

export type SceneDocumentLine =
  | { kind: 'blank'; raw: string; eol: SceneEol }
  | { kind: 'comment'; raw: string; eol: SceneEol }
  | { kind: 'label'; name: string; raw: string; eol: SceneEol }
  | { kind: 'choice-option'; raw: string; eol: SceneEol }
  | { kind: 'text'; speaker: string; value: string; sep: string; raw: string; eol: SceneEol }
  | { kind: 'instr'; name: string; raw: string; eol: SceneEol };

export type SceneDocumentLineInput =
  | { kind: 'blank'; raw: string; eol?: SceneEol }
  | { kind: 'comment'; raw: string; eol?: SceneEol }
  | { kind: 'label'; name: string; raw: string; eol?: SceneEol }
  | { kind: 'choice-option'; raw: string; eol?: SceneEol }
  | { kind: 'text'; speaker: string; value: string; sep?: string; raw: string; eol?: SceneEol }
  | { kind: 'instr'; name: string; raw: string; eol?: SceneEol };

export interface ProjectFile {
  path: string;
  text: string;
  bytes: number;
  sha256: string;
}

export interface TextHasher {
  sha256(text: string): Promise<string>;
}

export interface ProjectStorage {
  readonly rootIdentity: string;
  listFiles(): Promise<string[]>;
  readText(path: string): Promise<ProjectFile>;
  exists(path: string): Promise<boolean>;
}

export interface AuthoringObject {
  kind: 'scene' | 'label' | 'text' | 'choice' | 'choice-option' | 'instruction' | 'variable' | 'timeline' | 'track' | 'cue' | 'asset' | 'character' | 'entry-scene';
  semanticId?: string;
  objectRef: string;
  parentRef?: string;
  source?: { path: string; line: number; col: number; raw: string };
  references: string[];
  referencedBy: string[];
  /** 可直接继续 inspect 的一层子对象引用；用于 Agent 无猜测地遍历结构化对象。 */
  childRefs?: string[];
  /** 对象结构（timeline 为 definition；track/cue 为对应 JSON 片段；asset 为 catalog 条目或 null）。 */
  details?: unknown;
  /** SHA-256 规范化 JSON 指纹（timeline/track/cue；由 hasher 注入方填充）。 */
  fingerprint?: string;
}

export type ChangeStatus = 'OPEN' | 'COMMITTED' | 'ROLLED_BACK' | 'STALE';

export type CommitJournalStatus = 'STAGING' | 'REPLACING' | 'RECOVERED' | 'RECOVERY_FAILED' | 'COMMITTED';

export interface CommitJournalEntry {
  path: string;
  originalSha256?: string;
  targetSha256: string;
  stagedIdentity: string;
  replaced: boolean;
  restored: boolean;
}

export interface CommitJournal {
  formatVersion: 2;
  journalVersion: number;
  changeId: string;
  recordVersionAtCommitStart: number;
  projectRevisionAtCommitStart: string;
  status: CommitJournalStatus;
  files: CommitJournalEntry[];
}

export type RecoveryDisposition =
  | 'NO_ACTION'
  | 'REOPEN_OPEN'
  | 'ROLL_BACK_TO_BASE'
  | 'FINALIZE_COMMITTED'
  | 'MANUAL_RECOVERY_REQUIRED';

export interface RecoveryInspection {
  changeId: string;
  recordState: 'readable' | 'corrupt' | 'unsupported';
  changeStatus?: ChangeStatus;
  journalStatus?: CommitJournalStatus;
  lockState: 'free' | 'owned' | 'stale-candidate' | 'corrupt' | 'foreign-host';
  projectState: 'base' | 'target' | 'mixed-known' | 'ambiguous';
  fileStates: Array<{
    path: string;
    state: 'original' | 'target' | 'absent-expected' | 'unexpected';
    actualSha256?: string;
  }>;
  disposition: RecoveryDisposition;
  recoveryToken?: string;
  manualRecoveryRequired: boolean;
  reasons: string[];
}

export interface ChangeIntentMetadata {
  intent?: string;
  acceptanceCriteria?: string[];
  initiator?: 'external-agent' | 'human' | 'automation';
}

export interface EvidenceFreshness {
  evidenceId?: string;
  status: 'missing' | 'fresh' | 'stale' | 'failed' | 'incomplete';
  workingRevision?: number;
  currentWorkingRevision?: number;
}

export interface ChangeWritePrecondition {
  expectedRecordVersion: number;
  expectedStatus?: ChangeStatus;
}

export interface ChangeRecord {
  changeId: string;
  formatVersion: 2;
  recordVersion: number;
  projectRootIdentity: string;
  baseRevision: string;
  workingRevision: number;
  status: ChangeStatus;
  baseFiles: Record<string, { sha256: string }>;
  baseContents: Record<string, string>;
  workingFiles: Record<string, string>;
  operations: Record<string, RecordedOperation>;
  /** Wave 5：integration change 的执行元数据；普通 change 为 undefined，旧记录不迁移。 */
  integration?: IntegrationMetadata;
  latestValidation?: { workingRevision: number; evidenceId: string; errors: number };
  intent?: ChangeIntentMetadata;
  latestSimulation?: {
    workingRevision: number;
    evidenceId: string;
    status: 'passed' | 'failed' | 'incomplete';
  };
  runtimeTraces?: {
    traceId: string;
    workingRevision: number;
    status: 'passed' | 'failed';
  }[];
  latestDiff?: {
    workingRevision: number;
    evidenceId: string;
  };
}

export interface ChangeRepository {
  create(record: ChangeRecord): Promise<void>;
  read(changeId: string): Promise<ChangeRecord | null>;
  write(record: ChangeRecord, precondition: ChangeWritePrecondition): Promise<void>;
  writeEvidence(changeId: string, evidenceId: string, value: unknown): Promise<void>;
  readEvidence(changeId: string, evidenceId: string): Promise<unknown | null>;
  writeJournal(changeId: string, value: unknown): Promise<void>;
  readLatestJournal(changeId: string): Promise<unknown | null>;
}

export interface ProjectWriteStorage extends ProjectStorage {
  stageText(path: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }>;
  replaceFromStage(path: string, stagedIdentity: string): Promise<void>;
  restoreText(path: string, originalText: string): Promise<void>;
  removeStage(stagedIdentity: string): Promise<void>;
  /** Optional audit hook used to prove approval was checked before staging. */
  onCommitEvent?(event: 'approval-checked'): void | Promise<void>;
  /** 新文件恢复时的可选删除能力；旧文件恢复仍只使用 restoreText。 */
  removePath?(path: string): Promise<void>;
}

export type SceneBlockInput =
  | { kind: 'text'; speaker?: string; value: string }
  | { kind: 'label'; name: string }
  | { kind: 'instruction'; name: string; args?: string[]; modifiers?: Record<string, string> }
  | { kind: 'choice'; options: { label: string; when?: string; effects?: { name: string; args: string[] }[]; target: { kind: 'goto' | 'jump'; value: string } }[] };

export type ScenePatchOperation =
  | { kind: 'replaceText'; target: string; expectedFingerprint: string; speaker?: string; value: string }
  | { kind: 'insertAfter'; anchor: string; expectedFingerprint: string; blocks: SceneBlockInput[] }
  | { kind: 'replaceChoiceOption'; target: string; expectedFingerprint: string; option: Extract<SceneBlockInput, { kind: 'choice' }>['options'][number] }
  | { kind: 'removeObject'; target: string; expectedFingerprint: string };

export interface SceneCreateInput {
  operationId: string;
  sceneId: string;
  blocks?: SceneBlockInput[];
}

export interface ScenePatchInput {
  operationId: string;
  sceneId?: string;
  patch: ScenePatchOperation;
}

export interface VariableEnsureInput {
  operationId: string;
  name: string;
  type: string;
  initial: unknown;
  readonly?: boolean;
  min?: number;
  max?: number;
}

/** Stage 6 Wave 2：本 Wave 唯一允许写入的 track kind。 */
export type Wave2TrackKind = 'background' | 'portrait' | 'screen';

/** Stage 6 Wave 2：本 Wave 唯一允许写入的 action（background.set / portrait.* / screen.fade）。 */
export type Wave2Action = 'set' | 'show' | 'hide' | 'move' | 'expression' | 'fade';

export interface TimelineCueInput {
  atMs: number;
  durationMs: number;
  easing: string;
  action: Wave2Action;
  key?: string;
  expression?: string;
  position?: string;
  alpha?: number;
}

export interface TimelineCreateInput {
  operationId: string;
  timelineId: string;
  definition: unknown;
}

export type TimelinePatchOperation =
  | { kind: 'addTrack'; expectedFingerprint: string; trackKind: Wave2TrackKind; target?: string }
  | { kind: 'removeTrack'; expectedFingerprint: string; trackRef: string }
  | { kind: 'insertCue'; expectedFingerprint: string; trackRef: string; cue: TimelineCueInput }
  | { kind: 'replaceCue'; expectedFingerprint: string; cueRef: string; cue: TimelineCueInput }
  | { kind: 'removeCue'; expectedFingerprint: string; cueRef: string };

export interface TimelinePatchInput {
  operationId: string;
  timelineId: string;
  patch: TimelinePatchOperation;
}

/** 只读资源发现条目（共享 asset catalog 统一解析）。 */
export interface AssetEntry {
  kind: 'background' | 'portrait' | 'avatar';
  key: string;
  /** 可直接复制到 timeline portrait track.target 的规范值；仅 portrait 提供。 */
  timelineTarget?: string;
  role?: string;
  outfit?: string;
  expression?: string;
  sourcePath: string;
  format: string;
  resolved: boolean;
}

/** 素材中心共享类型；稳定英文值供 Agent/DOM 使用，Editor 负责显示自然中文。 */
export type ProjectAssetKind =
  | 'background'
  | 'portrait'
  | 'avatar'
  | 'music'
  | 'ambience'
  | 'sound-effect'
  | 'voice'
  | 'video'
  | 'font'
  | 'other';

/** 适配器提供的只读物理文件事实；不包含文件内容或本机绝对路径。 */
export interface ProjectAssetFileFact {
  path: string;
  bytes?: number;
  /** relocation 只要求源文件提供；普通素材清单可以省略。 */
  sha256?: string;
}

/** 单个物理素材路径解析出的稳定语义；Authoring 与写入 authority 必须共用。 */
export interface ProjectAssetPathDescriptor {
  path: string;
  directory: string;
  fileName: string;
  kind: ProjectAssetKind;
  key: string;
  format: string;
  variant?: string;
  invalidName: boolean;
}

export type ProjectAssetReferenceSource = 'scene' | 'timeline' | 'character' | 'gallery';

export interface ProjectAssetReference {
  referenceId: string;
  sourceKind: ProjectAssetReferenceSource;
  sourceLabel: string;
  sourcePath: string;
  line?: number;
  objectRef?: string;
}

export type ProjectAssetIssueCode =
  | 'ASSET_REFERENCE_MISSING'
  | 'ASSET_KEY_DUPLICATE'
  | 'ASSET_NAME_INVALID'
  | 'ASSET_FORMAT_UNSUPPORTED'
  | 'ASSET_UNUSED';

export interface ProjectAssetIssue {
  issueId: string;
  code: ProjectAssetIssueCode;
  severity: 'warning' | 'error';
  message: string;
  assetIds: string[];
  referenceIds: string[];
}

export interface ProjectAssetItem {
  /** 物理文件使用 `file:<project-relative-path>`；缺失引用使用稳定 `missing:<kind>:<key>`。 */
  assetId: string;
  kind: ProjectAssetKind;
  key: string;
  sourcePath?: string;
  format?: string;
  bytes?: number;
  /** 立绘表情等同一语义 key 下的物理变体。 */
  variant?: string;
  physical: boolean;
  references: ProjectAssetReference[];
  issues: ProjectAssetIssueCode[];
}

export interface ProjectAssetKindSummary {
  files: number;
  measuredFiles: number;
  /** 至少有一个文件提供字节事实时存在；未知不等于 0。 */
  bytes?: number;
}

export interface ProjectAssetSummary {
  fileCount: number;
  measuredFileCount: number;
  measuredBytes: number;
  /** 与设计合同兼容的已测量字节总数；无任何测量事实时省略。 */
  totalBytes?: number;
  referencedCount: number;
  unusedCount: number;
  missingCount: number;
  duplicateCount: number;
  unsupportedCount: number;
  invalidNameCount: number;
  byKind: Record<ProjectAssetKind, ProjectAssetKindSummary>;
}

export interface ProjectAssetIntelligence {
  items: ProjectAssetItem[];
  summary: ProjectAssetSummary;
  issues: ProjectAssetIssue[];
}

export type ProjectAssetRelocationBlockerCode =
  | 'ASSET_RELOCATION_BATCH_EMPTY'
  | 'ASSET_RELOCATION_BATCH_LIMIT'
  | 'ASSET_RELOCATION_DUPLICATE_SOURCE'
  | 'ASSET_RELOCATION_DUPLICATE_TARGET'
  | 'ASSET_RELOCATION_BATCH_KIND_MISMATCH'
  | 'ASSET_RELOCATION_SOURCE_NOT_FOUND'
  | 'ASSET_RELOCATION_SOURCE_AMBIGUOUS'
  | 'ASSET_RELOCATION_UNSUPPORTED_KIND'
  | 'ASSET_RELOCATION_TARGET_UNSAFE'
  | 'ASSET_RELOCATION_SCAN_INCOMPLETE'
  | 'ASSET_RELOCATION_TARGET_NAME_INVALID'
  | 'ASSET_RELOCATION_TARGET_DIRECTORY_MISSING'
  | 'ASSET_RELOCATION_TARGET_KIND_MISMATCH'
  | 'ASSET_RELOCATION_EXTENSION_CHANGED'
  | 'ASSET_RELOCATION_TARGET_EXISTS'
  | 'ASSET_RELOCATION_TARGET_KEY_DUPLICATE'
  | 'ASSET_RELOCATION_PORTRAIT_NAME_INVALID'
  | 'ASSET_RELOCATION_RESERVED_KEY'
  | 'ASSET_RELOCATION_OPAQUE_REFERENCE'
  | 'ASSET_RELOCATION_AMBIGUOUS_GROUP_REFERENCE'
  | 'ASSET_RELOCATION_NO_CHANGE';

export interface ProjectAssetRelocationBlocker {
  code: ProjectAssetRelocationBlockerCode;
  message: string;
  moveIds?: string[];
  sourcePath?: string;
  line?: number;
}

export interface ProjectAssetRelocationReferenceChange {
  referenceId: string;
  moveIds?: string[];
  sourceKind: ProjectAssetReferenceSource;
  sourceLabel: string;
  sourcePath: string;
  line?: number;
  field: string;
  before: string;
  after: string;
}

export interface ProjectAssetRelocationPlan {
  schemaVersion: 1;
  operationId: string;
  planId: string;
  planFingerprint: string;
  projectRevision: string;
  status: 'ready' | 'blocked';
  source: ProjectAssetPathDescriptor | null;
  target: ProjectAssetPathDescriptor | null;
  affectedReferenceCount: number;
  affectedFileCount: number;
  referenceChanges: ProjectAssetRelocationReferenceChange[];
  blockers: ProjectAssetRelocationBlocker[];
}

export interface ProjectAssetRelocationMove {
  moveId: string;
  source: ProjectAssetPathDescriptor;
  target: ProjectAssetPathDescriptor;
}

export interface ProjectAssetRelocationBatchPlan {
  schemaVersion: 2;
  operationId: string;
  planId: string;
  planFingerprint: string;
  projectRevision: string;
  status: 'ready' | 'blocked';
  moves: ProjectAssetRelocationMove[];
  affectedAssetCount: number;
  affectedReferenceCount: number;
  affectedFileCount: number;
  referenceChanges: ProjectAssetRelocationReferenceChange[];
  blockers: ProjectAssetRelocationBlocker[];
}

export interface ProjectAssetRelocationScannedFile {
  path: string;
  sha256: string;
}

/** Adapter 在计划时读取的真实二进制/父目录基线；纳入计划指纹但不投影给 Editor。 */
export interface ProjectAssetRelocationBinaryBaseline {
  source: {
    path: string;
    device: string;
    inode: string;
    birthtimeNs: string;
    size: number;
    mtimeNs: string;
    sha256: string;
  };
  target: { path: string; state: 'absent' | 'exists' };
  targetDirectory: {
    path: string;
    device: string;
    inode: string;
    birthtimeNs: string;
    mtimeNs: string;
  };
  assetInventoryFingerprint: string;
}

/** CLI authority 专用的内部文本准备结果；Editor 只接收公开 plan。 */
export interface ProjectAssetRelocationTextChange {
  path: string;
  beforeSha256: string;
  afterSha256: string;
  beforeText: string;
  afterText: string;
}

export interface ProjectAssetCatalog {
  backgrounds: AssetEntry[];
  portraits: AssetEntry[];
  avatars: AssetEntry[];
  intelligence: ProjectAssetIntelligence;
}

/** Stage 6 Wave 3：项目级创作配置写操作输入。 */
export interface CharacterEnsureInput {
  operationId: string;
  id: string;
  name: string;
  /** undefined=保留原值；null=移除；字符串=设置。 */
  avatar?: string | null;
  /** 当前角色表（characters 字段）规范化 JSON 片段的 SHA-256；角色表缺失时 = 空对象指纹。 */
  expectedFingerprint: string;
}

export interface CharacterRemoveInput {
  operationId: string;
  id: string;
  expectedFingerprint: string;
}

export interface EntrySceneSetInput {
  operationId: string;
  sceneId: string;
  /** 当前 entryScene 字段规范化 JSON 片段指纹；缺失时 = 空指纹。 */
  expectedFingerprint: string;
}

/** operation ledger 产生的对象级 diff 条目（track/cue 无持久语义 ID，不按数组位置猜身份）。 */
export interface LedgerDiffEntry {
  kind: string;
  operationId: string;
  objectBefore?: string;
  objectAfter?: string;
  fingerprintBefore?: string;
  fingerprintAfter?: string;
  directChange: unknown;
  potentialImpact: unknown[];
  observedImpact: unknown[];
}
