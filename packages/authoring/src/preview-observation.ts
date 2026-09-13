import { AuthoringOperationError, stableStringify } from './change-session.js';
import { normalizeProjectPath } from './project-storage.js';
import type { RuntimeTraceEvent } from './runtime-trace.js';

/** The existing Editor iframe protocol, shared with its bound observation relay. */
export interface PreviewTraceStartMessage {
  type: 'surdet-preview-trace-start'; traceId: string; generation: number; sceneId: string; label?: string;
}
export interface PreviewTraceEventMessage {
  type: 'surdet-preview-trace-event'; traceId: string; generation: number; sequence: number;
  coreEmitted: true; presentationApplied: boolean; presentationBefore: unknown; presentationAfter: unknown;
  event: RuntimeTraceEvent;
}
export interface PreviewTraceCompleteMessage {
  type: 'surdet-preview-trace-complete'; traceId: string; generation: number; status: 'passed' | 'failed';
  eventCount: number; firstError?: string; lastEvent?: RuntimeTraceEvent;
}
export type PreviewTraceMessage = PreviewTraceStartMessage | PreviewTraceEventMessage | PreviewTraceCompleteMessage;

export const PREVIEW_CONFIG_PATHS = ['calendar', 'events', 'growth', 'achievements'].map(name => `content/config/${name}.json`);
export const PREVIEW_MAX_EVENTS = 2_000;
export interface PreviewFileFact { path: string; sha256: string }
export interface PreviewSourceFacts { files: PreviewFileFact[]; assets: PreviewFileFact[] }
export interface PreviewBeginInput {
  action: 'begin'; previewId: string; previewGeneration: number; sceneId: string; label?: string;
  expectedProjectRevision: string; expectedCoordinationRevision: string; source: PreviewSourceFacts;
}
export type PreviewPublishInput = PreviewBeginInput
  | { action: 'append'; previewId: string; previewGeneration: number; messages: PreviewTraceMessage[] }
  | { action: 'invalidate'; previewGeneration: number; reason: 'reload' | 'source-changed' | 'closed' };
export interface PreviewPublishAck { previewId: string | null; previewGeneration: number }
export interface PreviewObservedEvent extends PreviewTraceEventMessage { objectRef: string | null }
export interface PreviewObservation {
  previewId: string; previewGeneration: number; workspaceSessionId: string; projectIdentity: string;
  projectRevision: string; coordinationRevision: string; sceneId: string; label?: string;
  startedAt: string; updatedAt: string; runtimeGeneration: number | null;
  state: 'starting' | 'running' | 'passed' | 'failed'; firstError?: string;
  source: PreviewSourceFacts; events: PreviewObservedEvent[];
}
export interface PreviewReadInput { previewId?: string; offset?: number; limit?: number }
export interface PreviewReadResult {
  view: 'saved-project'; kind: 'editor-preview'; status: 'current' | 'stale' | 'unavailable' | 'ambiguous';
  reasons: string[]; observation: PreviewObservation | null; eventCount: number; hasMore: boolean;
  availablePreviews: { previewId: string; workspaceSessionId: string; sceneId: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isRuntimeTraceEvent(value: unknown): value is RuntimeTraceEvent {
  if (!isRecord(value) || !isRecord(value['source'])) return false;
  const source = value['source'];
  return typeof value['kind'] === 'string' && typeof source['sceneId'] === 'string'
    && Number.isInteger(source['index']) && typeof source['op'] === 'string'
    && typeof source['file'] === 'string' && Number.isInteger(source['line']) && Number.isInteger(source['col']);
}

export function normalizePreviewTraceMessage(value: unknown): PreviewTraceMessage | null {
  if (!isRecord(value) || typeof value['type'] !== 'string' || typeof value['traceId'] !== 'string'
    || !value['traceId'].trim() || !Number.isSafeInteger(value['generation']) || (value['generation'] as number) < 0) return null;
  const type = value['type']; const traceId = value['traceId']; const generation = value['generation'] as number;
  if (type === 'surdet-preview-trace-start') {
    if (typeof value['sceneId'] !== 'string' || !value['sceneId'].trim()) return null;
    return { type, traceId, generation, sceneId: value['sceneId'], ...(typeof value['label'] === 'string' ? { label: value['label'] } : {}) };
  }
  if (type === 'surdet-preview-trace-event') {
    if (!Number.isSafeInteger(value['sequence']) || (value['sequence'] as number) < 0 || value['coreEmitted'] !== true
      || typeof value['presentationApplied'] !== 'boolean' || !('presentationBefore' in value) || !('presentationAfter' in value)
      || !isRuntimeTraceEvent(value['event'])) return null;
    return { type, traceId, generation, sequence: value['sequence'] as number, coreEmitted: true,
      presentationApplied: value['presentationApplied'], presentationBefore: value['presentationBefore'],
      presentationAfter: value['presentationAfter'], event: value['event'] };
  }
  if (type === 'surdet-preview-trace-complete') {
    if (!['passed', 'failed'].includes(String(value['status'])) || !Number.isSafeInteger(value['eventCount'])
      || (value['eventCount'] as number) < 0 || (value['lastEvent'] !== undefined && !isRuntimeTraceEvent(value['lastEvent']))) return null;
    return { type, traceId, generation, status: value['status'] as 'passed' | 'failed', eventCount: value['eventCount'] as number,
      ...(typeof value['firstError'] === 'string' ? { firstError: value['firstError'] } : {}),
      ...(value['lastEvent'] === undefined ? {} : { lastEvent: value['lastEvent'] }) };
  }
  return null;
}

export function isPreviewSourcePath(path: string): boolean {
  return path === 'game.config.json' || PREVIEW_CONFIG_PATHS.includes(path)
    || (path.startsWith('content/scenario/') && path.toLowerCase().endsWith('.gal'))
    || (path.startsWith('content/timelines/') && path.toLowerCase().endsWith('.json'));
}

/** Editor config buffers are parsed JSON; compare their actual values, not indentation. */
export function previewSourceText(path: string, text: string): string {
  return path.toLowerCase().endsWith('.json') ? stableStringify(JSON.parse(text.replace(/^\uFEFF/, ''))) : text;
}

function invalid(message: string): never { throw new AuthoringOperationError('INVALID_REQUEST', message); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some(key => !keys.includes(key))) return invalid('预览观察请求字段无效');
  return value;
}
const SHA = /^[0-9a-f]{64}$/;
const PREVIEW_ID = /^preview-[0-9a-f-]{36}$/;
function facts(value: unknown, assets: boolean): PreviewFileFact[] {
  if (!Array.isArray(value) || value.length > 20_000) return invalid('预览来源清单无效');
  const seen = new Set<string>();
  return value.map(item => {
    const fact = exact(item, ['path', 'sha256']);
    if (typeof fact.path !== 'string' || typeof fact.sha256 !== 'string' || !SHA.test(fact.sha256)) return invalid('预览来源指纹无效');
    try { normalizeProjectPath(fact.path); } catch { return invalid('预览来源路径无效'); }
    if (seen.has(fact.path) || (assets ? !fact.path.startsWith('content/assets/') : !isPreviewSourcePath(fact.path))) return invalid('预览来源路径重复或不受支持');
    seen.add(fact.path);
    return { path: fact.path, sha256: fact.sha256 };
  });
}

export function parsePreviewPublishInput(value: unknown): PreviewPublishInput {
  if (!isRecord(value)) return invalid('预览观察请求不是对象');
  if (!Number.isSafeInteger(value.previewGeneration) || (value.previewGeneration as number) < 1) return invalid('预览代次无效');
  const previewGeneration = value.previewGeneration as number;
  if (value.action === 'invalidate') {
    exact(value, ['action', 'previewGeneration', 'reason']);
    if (!['reload', 'source-changed', 'closed'].includes(String(value.reason))) return invalid('预览失效原因无效');
    return { action: 'invalidate', previewGeneration, reason: value.reason as 'reload' | 'source-changed' | 'closed' };
  }
  if (typeof value.previewId !== 'string' || !PREVIEW_ID.test(value.previewId)) return invalid('预览身份无效');
  if (value.action === 'append') {
    exact(value, ['action', 'previewGeneration', 'previewId', 'messages']);
    if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 32) return invalid('预览消息批次无效');
    const messages = value.messages.map(normalizePreviewTraceMessage);
    if (messages.some(message => message === null)) return invalid('预览轨迹消息无效');
    return { action: 'append', previewGeneration, previewId: value.previewId, messages: messages as PreviewTraceMessage[] };
  }
  if (value.action !== 'begin') return invalid('未知预览观察操作');
  exact(value, ['action', 'previewId', 'previewGeneration', 'sceneId', 'label', 'expectedProjectRevision', 'expectedCoordinationRevision', 'source']);
  if (typeof value.sceneId !== 'string' || !value.sceneId.trim() || (value.label !== undefined && typeof value.label !== 'string')
    || typeof value.expectedProjectRevision !== 'string' || !SHA.test(value.expectedProjectRevision)
    || typeof value.expectedCoordinationRevision !== 'string' || !SHA.test(value.expectedCoordinationRevision)) return invalid('预览入口或内容版本无效');
  const source = exact(value.source, ['files', 'assets']);
  return { action: 'begin', previewId: value.previewId, previewGeneration, sceneId: value.sceneId,
    expectedProjectRevision: value.expectedProjectRevision, expectedCoordinationRevision: value.expectedCoordinationRevision,
    ...(value.label === undefined ? {} : { label: value.label as string }), source: { files: facts(source.files, false), assets: facts(source.assets, true) } };
}
