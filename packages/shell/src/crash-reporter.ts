import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomic } from './json-file.js';

export interface CrashReportInput {
  error: unknown;
  context?: string;
  extra?: Record<string, string | number | boolean | null>;
}

function safeText(value: unknown): string {
  const text = value instanceof Error ? (value.stack ?? value.message) : String(value);
  return text.replace(/[A-Za-z]:\\[^\s\n)]+/g, '<path>').slice(0, 48_000);
}

export function writeCrashReport(rootDir: string, input: CrashReportInput): string | null {
  try {
    const dir = path.join(rootDir, 'crash-reports');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[.:]/g, '-');
    const file = path.join(dir, `${stamp}-${process.pid}.json`);
    const payload = {
      schema: 1,
      timestamp: new Date().toISOString(),
      context: safeText(input.context ?? 'unknown'),
      error: safeText(input.error),
      extra: input.extra ?? {},
    };
    let output = JSON.stringify(payload, null, 2) + '\n';
    if (Buffer.byteLength(output, 'utf8') > 64_000) {
      // Bound fields before serialization: a UTF-16 code unit can require six JSON bytes.
      output = JSON.stringify({
        ...payload, context: payload.context.slice(0, 1_000), error: payload.error.slice(0, 8_000),
        extra: {}, truncated: true,
      }, null, 2) + '\n';
    }
    writeFileAtomic(file, output);
    return file;
  } catch { return null; }
}
