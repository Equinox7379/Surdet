/**
 * Timeline canonical identity（Reliability Phase 2B / A2）。
 *
 * Surdet 中一个时间轴文件唯一合法的 semantic ID 是文件名 stem
 * （content/timelines/foo.json → foo），且必须与 definition.id 一致——
 * 与 typed authoring 既有不变量 timelineId === definition.id === file stem 同源。
 * validation 与 runtime loader（buildTimelineRegistry）共享本实现，
 * 禁止各自复制派生算法，禁止 alias / fallback 双真相。
 */

import { AuthoringOperationError } from './change-session.js';

/** Resolve existing files without inventing a flat path or picking a duplicate. */
export function resolveUniqueTimelinePath(files: Readonly<Record<string, string>>, id: string): string | undefined {
  const paths = Object.keys(files).filter(path => path.startsWith('content/timelines/')
    && path.endsWith('.json') && timelineIdFromPath(path) === id);
  if (paths.length > 1) throw new AuthoringOperationError('OBJECT_AMBIGUOUS', `时间轴身份 timeline:${id} 对应多个文件：${paths.sort().join('、')}`);
  return paths[0];
}

/** 从项目路径派生 canonical timeline ID（filename stem）的唯一实现。 */
export function timelineIdFromPath(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.endsWith('.json') ? base.slice(0, -'.json'.length) : base;
}

export interface TimelineIdentityConflict {
  path: string;
  /** 文件名派生的 canonical ID。 */
  expectedId: string;
  /** definition 内声明的实际 ID。 */
  actualId: string;
}

/**
 * canonical 身份冲突检测：definition.id 为字符串且与文件名派生 ID 不一致时返回冲突详情。
 * id 缺失/非字符串时返回 null——那是结构问题（由 validateTimeline 的 T0xx 诊断），
 * 不做低质量的 undefined !== filename 比较。
 */
export function timelineIdentityConflict(path: string, definition: unknown): TimelineIdentityConflict | null {
  const record = typeof definition === 'object' && definition !== null && !Array.isArray(definition)
    ? definition as { id?: unknown }
    : null;
  const actualId = record?.['id'];
  if (typeof actualId !== 'string') return null;
  const expectedId = timelineIdFromPath(path);
  return actualId === expectedId ? null : { path, expectedId, actualId };
}

/** validation 诊断与 runtime fail-loud 共用的冲突文案（含文件路径与两个 ID）。 */
export function timelineIdentityMismatchMessage(conflict: TimelineIdentityConflict): string {
  return `${conflict.path}: timeline definition.id '${conflict.actualId}' 与文件名派生 ID '${conflict.expectedId}' 不一致`;
}
