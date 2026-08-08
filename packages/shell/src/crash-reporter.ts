import * as fs from 'node:fs';
import * as path from 'node:path';

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
      context: input.context ?? 'unknown',
      error: safeText(input.error),
      extra: input.extra ?? {},
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2).slice(0, 64_000) + '\n');
    return file;
  } catch { return null; }
}
