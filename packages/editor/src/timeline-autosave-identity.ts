import { timelineIdFromPath, timelinePathFor } from '@surdet/authoring';

export interface TimelineAutosaveDocument {
  id: string;
  file: string;
  text: string;
  eol: '\r\n' | '\n';
}

export interface TimelineAutosaveIdentity {
  stableId: string;
  file: string;
  fileId: string;
  definitionId: string | null;
  parseError: string | null;
  canonical: boolean;
}

export type TimelineAutosaveNormalizeResult =
  | { ok: true; entry: TimelineAutosaveDocument }
  | { ok: false; error: string };

interface ParsedTimelineRecord {
  record: Record<string, unknown> | null;
  error: string | null;
}

function parseTimelineRecord(text: string): ParsedTimelineRecord {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    return { record: null, error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { record: null, error: '时间轴正文必须是 JSON 对象' };
  }
  return { record: value as Record<string, unknown>, error: null };
}

function normalizedRelativeFile(file: string): string | null {
  const normalized = file.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || !normalized.endsWith('.json')) return null;
  const parts = normalized.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) return null;
  return normalized;
}

export function inspectTimelineAutosaveIdentity(
  entry: TimelineAutosaveDocument,
): TimelineAutosaveIdentity {
  const fileId = timelineIdFromPath(entry.file);
  const parsed = parseTimelineRecord(entry.text);
  const rawDefinitionId = parsed.record?.['id'];
  const definitionId = typeof rawDefinitionId === 'string' && rawDefinitionId.length > 0
    ? rawDefinitionId
    : null;
  return {
    stableId: entry.id,
    file: entry.file,
    fileId,
    definitionId,
    parseError: parsed.error,
    canonical: parsed.error === null
      && definitionId !== null
      && entry.id === fileId
      && entry.id === definitionId,
  };
}

export function normalizeTimelineAutosaveDocument(
  source: TimelineAutosaveDocument,
  targetId: string,
  targetFile?: string,
): TimelineAutosaveNormalizeResult {
  let canonicalProjectPath: string;
  try {
    canonicalProjectPath = timelinePathFor(targetId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const defaultFile = canonicalProjectPath.slice('content/timelines/'.length);
  const file = normalizedRelativeFile(targetFile ?? defaultFile);
  if (file === null || timelineIdFromPath(file) !== targetId) {
    return { ok: false, error: `时间轴文件必须以规范 ID '${targetId}' 命名` };
  }

  const parsed = parseTimelineRecord(source.text);
  if (parsed.record === null) return { ok: false, error: parsed.error ?? '时间轴正文无法解析' };

  const nextRecord = { ...parsed.record, id: targetId };
  const lf = `${JSON.stringify(nextRecord, null, 2)}\n`;
  const text = source.eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
  const entry: TimelineAutosaveDocument = { id: targetId, file, text, eol: source.eol };
  if (!inspectTimelineAutosaveIdentity(entry).canonical) {
    return { ok: false, error: '规范化后的时间轴身份仍不一致' };
  }
  return { ok: true, entry };
}
