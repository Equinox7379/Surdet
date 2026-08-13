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
