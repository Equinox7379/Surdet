import { compileScene, type RuntimeBreakpoint, type RuntimeDebugLocation, type RuntimeDebugSnapshot } from '@surdet/core';

export interface PreviewBreakpoint extends RuntimeBreakpoint { line: number; caption: string }
export interface PreviewDebugCommand {
  type: 'surdet-preview-debug-command'; traceId: string; generation: number;
  action: 'pause' | 'step' | 'continue' | 'breakpoints'; breakpoints?: RuntimeBreakpoint[];
}
export interface PreviewDebugState {
  type: 'surdet-preview-debug-state'; traceId: string; generation: number; snapshot: RuntimeDebugSnapshot; error?: string;
}

/** Compile only for source identity/selection; execution remains owned by the actual Interpreter. */
export function debugInstructionOptions(scenes: readonly { id: string; text: string }[], sceneId: string): PreviewBreakpoint[] {
  const source = scenes.find(scene => scene.id === sceneId);
  if (!source) return [];
  const scene = compileScene(source.text, `${sceneId}.gal`, sceneId), lines = source.text.split(/\r?\n/);
  return scene.instructions.map(instruction => ({ sceneId, sceneHash: scene.sceneHash!, index: instruction.index, line: instruction.line,
    caption: `第 ${instruction.line} 行 · 步骤 ${instruction.index + 1}：${(lines[instruction.line - 1] ?? instruction.op).trim().slice(0, 70)}` }));
}

export function validDebugBreakpoints(points: readonly PreviewBreakpoint[], scenes: readonly { id: string; text: string }[]): PreviewBreakpoint[] {
  return points.filter(point => {
    try { return debugInstructionOptions(scenes, point.sceneId).some(current => current.sceneHash === point.sceneHash && current.index === point.index); }
    catch { return false; } // An uncompiled working draft cannot confirm an old breakpoint.
  });
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const breakpoint = (value: unknown): value is RuntimeBreakpoint => record(value) && typeof value.sceneId === 'string'
  && typeof value.sceneHash === 'string' && Number.isSafeInteger(value.index) && Number(value.index) >= 0;
const location = (value: unknown): value is RuntimeDebugLocation => breakpoint(value) && record(value)
  && typeof value.op === 'string' && typeof value.file === 'string' && Number.isSafeInteger(value.line) && Number(value.line) > 0
  && Number.isSafeInteger(value.col) && Number(value.col) > 0;

export function parsePreviewDebugCommand(value: unknown, traceId: string, generation: number): PreviewDebugCommand | null {
  if (!record(value) || value.type !== 'surdet-preview-debug-command' || value.traceId !== traceId || value.generation !== generation
    || typeof value.action !== 'string' || !['pause', 'step', 'continue', 'breakpoints'].includes(value.action)) return null;
  if (value.action === 'breakpoints' && (!Array.isArray(value.breakpoints) || !value.breakpoints.every(breakpoint))) return null;
  return value as unknown as PreviewDebugCommand;
}

export function normalizePreviewDebugState(value: unknown): PreviewDebugState | null {
  if (!record(value) || value.type !== 'surdet-preview-debug-state' || typeof value.traceId !== 'string' || !Number.isSafeInteger(value.generation)
    || !record(value.snapshot) || (value.error !== undefined && typeof value.error !== 'string')) return null;
  const state = value.snapshot;
  if (typeof state.enabled !== 'boolean' || typeof state.paused !== 'boolean'
    || typeof state.status !== 'string' || !['idle', 'running', 'awaiting-advance', 'awaiting-choice', 'awaiting-timer', 'paused', 'ended', 'error'].includes(state.status)
    || (state.reason !== null && (typeof state.reason !== 'string' || !['entry', 'step', 'breakpoint', 'manual'].includes(state.reason)))
    || (state.current !== null && !location(state.current)) || (state.next !== null && !location(state.next))
    || !record(state.variables) || !Array.isArray(state.callStack) || !state.callStack.every(location)) return null;
  return value as unknown as PreviewDebugState;
}
