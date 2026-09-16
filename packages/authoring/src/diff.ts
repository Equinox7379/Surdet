export interface ChangeDiffFile {
  path: string;
  beforeSha256?: string;
  afterSha256?: string;
  unifiedDiff: string;
  unexpectedFormatChange: boolean;
}

export interface ChangeDiff {
  summary: { createdScenes: number; modifiedScenes: number; changedVariables: number; warnings: string[] };
  semantic: {
    kind: string;
    objectBefore?: string;
    objectAfter?: string;
    fingerprintBefore?: string;
    fingerprintAfter?: string;
    operationId: string;
    directChange: unknown;
    potentialImpact: unknown[];
    observedImpact: unknown[];
  }[];
  files: ChangeDiffFile[];
}

export interface ChangeDiffInput {
  operationId: string;
  before: { path: string; text: string; sha256?: string };
  after: { path: string; text: string; sha256?: string };
  directChange: unknown;
  potentialImpact: unknown[];
  observedImpact: unknown[];
  kind?: string;
  objectBefore?: string;
  objectAfter?: string;
}

function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function lines(text: string): { raw: string; eol: string }[] {
  const chunks = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter((chunk) => chunk.length > 0) ?? [];
  return chunks.map((chunk) => {
    const match = /(\r\n|\n|\r)$/.exec(chunk);
    const eol = match?.[1] ?? '';
    return { raw: eol.length > 0 ? chunk.slice(0, -eol.length) : chunk, eol };
  });
}

function unifiedDiff(path: string, before: string, after: string): string {
  const left = lines(before).map((line) => line.raw);
  const right = lines(after).map((line) => line.raw);
  const out = [`--- ${path}`, `+++ ${path}`];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const a = left[index];
    const b = right[index];
    if (a === b && a !== undefined) out.push(` ${a}`);
    else {
      if (a !== undefined) out.push(`-${a}`);
      if (b !== undefined) out.push(`+${b}`);
    }
  }
  return out.join('\n');
}

function hasFormatOnlyLineChange(before: string, after: string): boolean {
  const left = lines(before);
  const right = lines(after);
  return left.some((line, index) => {
    const other = right[index];
    return other !== undefined && line.raw === other.raw && line.eol !== other.eol;
  });
}

function isLedgerDiffEntry(value: unknown): value is {
  kind: string;
  operationId: string;
  directChange: unknown;
  potentialImpact: unknown[];
  observedImpact: unknown[];
  objectBefore?: string;
  objectAfter?: string;
  fingerprintBefore?: string;
  fingerprintAfter?: string;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record['kind'] === 'string'
    && typeof record['operationId'] === 'string'
    && 'directChange' in record
    && Array.isArray(record['potentialImpact'])
    && Array.isArray(record['observedImpact']);
}

/**
 * 从已成功执行的类型化 operation ledger 产生对象级 semantic diff。
 * timeline 按稳定语义 ID 对齐；track/cue 没有持久语义 ID，diff 只来自 ledger 记录，
 * 不按 JSON 数组位置猜测身份、不做模糊树匹配。
 */
export function buildOperationLedgerDiff(record: {
  operations: Record<string, { requestHash: string; result: unknown; sequence?: number }>;
}): ChangeDiff['semantic'] {
  const entries: ChangeDiff['semantic'] = [];
  const operationEntries = Object.entries(record.operations).filter(([, operation]) => {
    const result = operation.result;
    return typeof result === 'object' && result !== null
      && isLedgerDiffEntry((result as Record<string, unknown>)['diffEntry']);
  });
  const orderedEntries = operationEntries.every(([, operation]) => Number.isInteger(operation.sequence))
    ? operationEntries.slice().sort((a, b) => a[1].sequence! - b[1].sequence!)
    : operationEntries;
  for (const [operationId, operation] of orderedEntries) {
    const result = operation.result;
    if (typeof result !== 'object' || result === null) continue;
    const diffEntry = (result as Record<string, unknown>)['diffEntry'];
    if (!isLedgerDiffEntry(diffEntry)) continue;
    entries.push({
      kind: diffEntry.kind,
      ...(diffEntry.objectBefore === undefined ? {} : { objectBefore: diffEntry.objectBefore }),
      ...(diffEntry.objectAfter === undefined ? {} : { objectAfter: diffEntry.objectAfter }),
      ...(diffEntry.fingerprintBefore === undefined ? {} : { fingerprintBefore: diffEntry.fingerprintBefore }),
      ...(diffEntry.fingerprintAfter === undefined ? {} : { fingerprintAfter: diffEntry.fingerprintAfter }),
      operationId: diffEntry.operationId,
      directChange: diffEntry.directChange,
      potentialImpact: diffEntry.potentialImpact,
      observedImpact: diffEntry.observedImpact,
    });
  }
  return entries;
}

export function createChangeDiff(input: ChangeDiffInput): ChangeDiff {
  const unexpectedFormatChange = hasFormatOnlyLineChange(input.before.text, input.after.text);
  const file: ChangeDiffFile = {
    path: input.after.path,
    beforeSha256: input.before.sha256 ?? digest(input.before.text),
    afterSha256: input.after.sha256 ?? digest(input.after.text),
    unifiedDiff: unifiedDiff(input.after.path, input.before.text, input.after.text),
    unexpectedFormatChange,
  };
  const warnings = unexpectedFormatChange ? ['检测到与语义修改无关的行终止符变化'] : [];
  return {
    summary: {
      createdScenes: 0,
      modifiedScenes: input.after.path.endsWith('.gal') ? 1 : 0,
      changedVariables: 0,
      warnings,
    },
    semantic: [{
      kind: input.kind ?? 'unknown',
      ...(input.objectBefore === undefined ? {} : { objectBefore: input.objectBefore }),
      ...(input.objectAfter === undefined ? {} : { objectAfter: input.objectAfter }),
      operationId: input.operationId,
      directChange: input.directChange,
      potentialImpact: input.potentialImpact,
      observedImpact: input.observedImpact,
    }],
    files: [file],
  };
}
