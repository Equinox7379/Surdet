import type { CompiledScene } from '@surdet/core';
import type { ChangeCompositionMetadata, RecordedOperation } from './composition-contracts.js';
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
  kind: 'scene' | 'label' | 'text' | 'choice' | 'choice-option' | 'condition' | 'condition-branch' | 'instruction' | 'variable' | 'timeline' | 'track' | 'cue' | 'asset' | 'character' | 'entry-scene' | 'gallery-cg';
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
  /** 场景为完整源码文件 SHA-256；timeline/track/cue 等为对应对象的规范化指纹。 */
  fingerprint?: string;
}

export type ChangeStatus = 'OPEN' | 'COMMITTED' | 'ROLLED_BACK' | 'STALE';

export interface GalleryCgCreateInput {
  operationId: string;
  id: string;
  name: string;
  /** Resolved background key from project.assets; omitted means id. */
  src?: string;
}

export interface GalleryCgPatchInput {
  operationId: string;
  id: string;
  expectedFingerprint: string;
  /** Only supplied fields change. null removes src, restoring the existing id fallback. */
  patch: { name?: string; src?: string | null };
}

export type CommitJournalStatus = 'STAGING' | 'REPLACING' | 'RECOVERED' | 'RECOVERY_FAILED' | 'COMMITTED';

export type CommitJournalEntry = {
  path: string;
  replaced: boolean;
  restored: boolean;
} & ({ kind?: 'write'; originalSha256?: string; targetSha256: string; stagedIdentity: string }
  | { kind: 'delete'; originalSha256: string; targetSha256?: never; stagedIdentity?: never });

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
  composition?: ChangeCompositionMetadata;
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
  /** 删除提交及新文件恢复；旧文件恢复使用 restoreText。 */
  removePath?(path: string): Promise<void>;
}

export interface SceneChoiceEffectInput {
  name: string;
  args: string[];
}

export interface SceneChoiceTargetInput {
  kind: 'goto' | 'jump';
  value: string;
}

export interface SceneChoiceOptionInput {
  label: string;
  /** 缺省或 null 表示无显示条件。 */
  when?: string | null;
  effects?: SceneChoiceEffectInput[];
  target: SceneChoiceTargetInput;
}

export interface SceneConditionBranchInput {
  kind: 'if' | 'elif' | 'else';
  /** if/elif 必填；else 不带表达式。 */
  expr?: string;
  blocks: SceneBlockInput[];
}

export interface SceneConditionPatchBranchInput {
  kind: 'if' | 'elif' | 'else';
  /** if/elif 必填；else 不带表达式。 */
  expr?: string;
  /** 复用当前目标条件块的直接分支；不能引用其他条件块。 */
  sourceBranch?: string;
  /** 提供时替换该分支正文；省略且有 sourceBranch 时逐字保留原正文。 */
  blocks?: SceneBlockInput[];
}

export interface SceneConditionBlockInput {
  kind: 'condition';
  branches: SceneConditionBranchInput[];
}

export type SceneBlockInput =
  | { kind: 'text'; speaker?: string; value: string }
  | { kind: 'label'; name: string }
  | { kind: 'instruction'; name: string; args?: string[]; modifiers?: Record<string, string> }
  | { kind: 'choice'; options: SceneChoiceOptionInput[] }
  | SceneConditionBlockInput;

/** 单行可替换的场景指令；结构入口、音频/视频及 call/return 等流程边界不在此列。 */
export const REPLACEABLE_SCENE_INSTRUCTIONS = [
  'bg', 'show', 'hide', 'wait',
  'set', 'mod', 'goto', 'jump',
  'fadein', 'fadeout', 'shake', 'flash', 'zoom', 'wipe', 'transition',
  'particle', 'mov', 'tint', 'title', 'chapter', 'tip', 'note', 'center', 'nvl', 'timeline',
] as const;

export type ScenePatchOperation =
  | { kind: 'renameLabel'; target: string; expectedFingerprint: string; name: string }
  | { kind: 'removeLabel'; target: string; expectedFingerprint: string }
  | { kind: 'replaceText'; target: string; expectedFingerprint: string; speaker?: string; value: string }
  | { kind: 'replaceInstruction'; target: string; expectedFingerprint: string; instruction: Extract<SceneBlockInput, { kind: 'instruction' }> & { name: typeof REPLACEABLE_SCENE_INSTRUCTIONS[number] } }
  | { kind: 'insertAfter'; anchor: string; expectedFingerprint: string; blocks: SceneBlockInput[] }
  | { kind: 'replaceChoiceOption'; target: string; expectedFingerprint: string; option: SceneChoiceOptionInput }
  | { kind: 'replaceChoiceGroup'; target: string; expectedFingerprint: string; choice: Extract<SceneBlockInput, { kind: 'choice' }> }
  | { kind: 'replaceConditionBlock'; target: string; expectedFingerprint: string; condition: { kind: 'condition'; branches: SceneConditionPatchBranchInput[] } }
  | { kind: 'removeObject'; target: string; expectedFingerprint: string };

export interface SceneCreateInput {
  operationId: string;
  sceneId: string;
  blocks?: SceneBlockInput[];
}

export interface SceneRemoveInput {
  operationId: string;
  sceneId: string;
  expectedFingerprint: string;
}

export interface SceneRenameInput {
  operationId: string;
  sceneId: string;
  newSceneId: string;
  expectedFingerprint: string;
}

export interface SceneMoveInput {
  operationId: string;
  sceneId: string;
  /** Copy source.path and fingerprint from the same working object.inspect. */
  expectedPath: string;
  expectedFingerprint: string;
  /** Relative to content/scenario; empty string moves back to the root. */
  directory: string;
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

export interface VariablePatchInitialInput {
  operationId: string;
  name: string;
  expectedFingerprint: string;
  initial: unknown;
}

/** Stage 6 Wave 2：可由 authoring 时间轴入口写入的非音频 track kind。 */
export type Wave2TrackKind = 'background' | 'portrait' | 'camera' | 'screen' | 'particle';

/** Stage 6 Wave 2：可由 authoring 时间轴入口写入的非音频 action。 */
export type Wave2Action =
  | 'set'
  | 'show'
  | 'hide'
  | 'move'
  | 'expression'
  | 'zoom'
  | 'pan'
  | 'shake'
  | 'fade'
  | 'tint'
  | 'flash'
  | 'wipe'
  | 'start'
  | 'stop';

export interface TimelineCueInput {
  atMs: number;
  durationMs: number;
  easing: string;
  action: Wave2Action;
  key?: string;
  expression?: string;
  position?: string;
  alpha?: number;
  scale?: number;
  x?: number;
  y?: number;
  strength?: number;
  color?: number;
  kind?: string;
}

export interface TimelineCreateInput {
  operationId: string;
  timelineId: string;
  definition: unknown;
}

export type TimelinePatchOperation =
  | { kind: 'addTrack'; expectedFingerprint: string; trackKind: Wave2TrackKind; target?: string }
  | { kind: 'removeTrack'; expectedFingerprint: string; trackRef: string }
  | { kind: 'setDuration'; expectedFingerprint: string; durationMs: number }
  | { kind: 'setTrackTarget'; expectedFingerprint: string; trackRef: string; target: string | null }
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
  /** Minimal examples using this exact asset. Absent for ambiguous/invalid assets and avatars. */
  usage?: {
    scene: Extract<SceneBlockInput, { kind: 'instruction' }>;
    timeline: { kind: 'background' | 'portrait'; target?: string; cues: TimelineCueInput[] };
  };
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

export type ProjectAssetReferenceSource = 'scene' | 'timeline' | 'character' | 'gallery' | 'config';

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
  /** 单素材详情兼容投影；批次超过一项时为 null。 */
  source: ProjectAssetPathDescriptor | null;
  target: ProjectAssetPathDescriptor | null;
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
