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

  it.each(['\\', '汉', '\ud800'])('keeps oversized escaped and Unicode errors valid and within the byte limit (%s)', value => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-crash-size-'));
    try {
      const file = writeCrashReport(dir, { error: value.repeat(48_000), context: 'renderer' });
      expect(file).not.toBeNull();
      const raw = fs.readFileSync(file!, 'utf8');
      expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(64_000);
      expect(JSON.parse(raw)).toMatchObject({ schema: 1, context: 'renderer', truncated: true });
      expect(JSON.parse(raw).error.length).toBeGreaterThan(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('bounds context and extra as structured fields instead of cutting the JSON document', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-crash-extra-'));
    try {
      const file = writeCrashReport(dir, { error: 'boom', context: '\\'.repeat(80_000), extra: { details: '汉'.repeat(80_000) } });
      expect(file).not.toBeNull();
      const raw = fs.readFileSync(file!, 'utf8');
      expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(64_000);
      expect(JSON.parse(raw)).toMatchObject({ error: 'boom', extra: {}, truncated: true });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
