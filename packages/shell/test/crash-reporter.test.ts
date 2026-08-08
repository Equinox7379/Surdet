import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeCrashReport } from '../src/crash-reporter.js';

describe('crash reporter', () => {
  it('writes a capped redacted report', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-crash-'));
    const file = writeCrashReport(dir, { error: new Error('boom C:\\secret\\file.ts'), context: 'test' });
    expect(file).not.toBeNull();
    const payload = JSON.parse(fs.readFileSync(file!, 'utf8')) as { error: string };
    expect(payload.error).toContain('<path>');
    expect(payload.error).not.toContain('secret');
  });
});
