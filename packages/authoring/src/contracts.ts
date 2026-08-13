import type { CompiledScene } from '@surdet/core';

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
  kind: 'scene' | 'label' | 'text' | 'choice' | 'choice-option' | 'instruction' | 'variable' | 'timeline' | 'asset';
  semanticId?: string;
  objectRef: string;
  parentRef?: string;
  source?: { path: string; line: number; col: number; raw: string };
  references: string[];
  referencedBy: string[];
}

export type ChangeStatus = 'OPEN' | 'COMMITTED' | 'ROLLED_BACK' | 'STALE';

export interface ChangeRecord {
  changeId: string;
  projectRootIdentity: string;
  baseRevision: string;
  workingRevision: number;
  status: ChangeStatus;
  baseFiles: Record<string, { sha256: string }>;
  baseContents: Record<string, string>;
  workingFiles: Record<string, string>;
  operations: Record<string, { requestHash: string; result: unknown }>;
  latestValidation?: { workingRevision: number; evidenceId: string; errors: number };
}

export interface ChangeRepository {
  create(record: ChangeRecord): Promise<void>;
  read(changeId: string): Promise<ChangeRecord | null>;
  write(record: ChangeRecord): Promise<void>;
  writeEvidence(changeId: string, evidenceId: string, value: unknown): Promise<void>;
  readEvidence(changeId: string, evidenceId: string): Promise<unknown | null>;
  writeJournal(changeId: string, value: unknown): Promise<void>;
}

export interface ProjectWriteStorage extends ProjectStorage {
  stageText(path: string, text: string, changeId: string): Promise<{ stagedIdentity: string; sha256: string }>;
  replaceFromStage(path: string, stagedIdentity: string): Promise<void>;
  restoreText(path: string, originalText: string): Promise<void>;
  removeStage(stagedIdentity: string): Promise<void>;
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
