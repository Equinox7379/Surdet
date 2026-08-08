import type { Interpreter, SystemHooks } from '@surdet/core';
import type { AdvRenderer, AdvStage } from '@surdet/renderer';

export interface ProfileStorage {
  read<T = unknown>(key: string): Promise<T | null>;
  write(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface ProfileEnvelope<T = unknown> {
  schemaVersion: 1;
  updatedAt: string;
  value: T;
}

export interface BrowserKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface HostSystemContext {
  pause(): void;
  resume(): void;
  fail(error: unknown): void;
}

export type HostSystemBoundaryPhase = 'enter' | 'complete' | 'fail' | 'reset' | 'dispose';

export interface HostSystemAdapter<TPayload = unknown> {
  readonly id: string;
  open(payload: TPayload, context: HostSystemContext): void | Promise<void>;
  reset?(): void;
  dispose?(): void;
}

export interface DefaultHostOptions {
  interpreter: Interpreter;
  renderer: AdvRenderer;
  stage: AdvStage;
  adapters?: readonly HostSystemAdapter[];
  onError?: (error: unknown) => void;
  onSystemBoundary?: (phase: HostSystemBoundaryPhase) => void;
  onStateReset?: () => void;
}

export interface DefaultHostController {
  routeSystem(id: string, payload: unknown): Promise<boolean>;
  reset(): void;
  dispose(): void;
}

export interface HostStateAdapter {
  readonly id: string;
  snapshot(): unknown;
  validate(value: unknown): void;
  restore(value: unknown): void;
}

export type HostSystemHooks = SystemHooks;
