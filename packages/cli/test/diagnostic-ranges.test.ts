import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';
import type { LintIssue } from '@surdet/core';
import { createEnvelopeJsonSchema, getCapabilityDefinition } from '@surdet/authoring';
import { standardSchemaFromJson } from '../src/authoring/schema-validator.js';

describe('diagnostic ranges through public CLI and MCP', () => {
  it.each([
    ['@goto missing', 'C002', 'missing', true],
    ['@call start.missing', 'J002', 'start.missing', false],
    ['@unknown "@another"', 'W001', '@unknown', false],
    ['@show "unclosed', 'L004', '"unclosed', true],
  ] as const)('preserves %s through real processes and the declared output contract', async (row, code, expected, failsBeforeValidation) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-diagnostic-中文 '));
    fs.mkdirSync(path.join(root, 'content/scenario'), { recursive: true });
    fs.writeFileSync(path.join(root, 'game.config.json'), JSON.stringify({ entryScene: 'start', variables: {} }));
    const source = `\uFEFF@scene start\r\n\t${row}\r\n@end`;
    fs.writeFileSync(path.join(root, 'content/scenario/start.gal'), source);
    const client = new Client({ name: 'diagnostic-range-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../dist/agent-port/main.js', import.meta.url)), '--project', root, '--policy', 'stage'],
      env: { ...process.env as Record<string, string>, SURDET_AGENT_DATA_DIR: path.join(root, 'agent-data'), SURDET_EDITOR_ASSET_IMPORT_DATA_ROOT: path.join(root, 'asset-data') },
      stderr: 'pipe',
    });
    try {
      const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)), 'lint', root, '--json'],
        { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      expect(cli.status, cli.stderr).toBe(code === 'W001' ? 0 : 1);
      const lint = JSON.parse(cli.stdout) as { issues: LintIssue[] };
      const cliIssue = lint.issues.find(issue => issue.code === code)!;
      expect(cliIssue.range).toBeDefined();
      expect(source.split('\r\n')[1]!.slice(cliIssue.range!.start.col - 1, cliIssue.range!.end.col - 1)).toBe(expected);

      await client.connect(transport);
      const response = await client.callTool({ name: 'surdet_project_validate', arguments: {} });
      const envelope = response.structuredContent as {
        ok: boolean; workingRevision?: number;
        result: { issues: LintIssue[] };
        error: { code: string; details: { diagnostic: LintIssue } };
      };
      const schema = standardSchemaFromJson(createEnvelopeJsonSchema(getCapabilityDefinition('project.validate').outputSchema));
      expect((await schema['~standard'].validate(envelope)).issues).toBeUndefined();
      expect(envelope.ok).toBe(!failsBeforeValidation);
      if (failsBeforeValidation) expect(envelope.error.code).toBe('INVALID_REQUEST'); // Existing outer error code.
      const issue = failsBeforeValidation ? envelope.error.details.diagnostic : envelope.result.issues.find(issue => issue.code === code)!;
      expect(issue).toMatchObject({ code, line: cliIssue.line, col: cliIssue.col, range: cliIssue.range });
      if (code === 'C002') expect(issue.hint).toBe('检查拼写或补充 @label');
      if (!failsBeforeValidation) {
        const malformed = { ...envelope, result: { ...envelope.result, issues: [{ ...issue, range: { start: { line: 2, col: 2 } } }] } };
        expect((await schema['~standard'].validate(malformed)).issues).toBeDefined();
        const begun = await client.callTool({ name: 'surdet_change_begin', arguments: { compositionMode: 'direct' } });
        expect(begun.isError).not.toBe(true);
        const before = (await client.callTool({ name: 'surdet_project_validate', arguments: {} })).structuredContent as typeof envelope;
        expect(before.result.issues.find(issue => issue.code === code)?.range).toEqual(cliIssue.range);
        const created = await client.callTool({ name: 'surdet_scene_create', arguments: { operationId: 'new-scene', sceneId: 'next', blocks: [
          { kind: 'text', value: '新的稿件。' }, { kind: 'instruction', name: 'call', args: ['start.missing'] },
        ] } });
        expect(created.isError).not.toBe(true);
        const after = (await client.callTool({ name: 'surdet_project_validate', arguments: {} })).structuredContent as typeof envelope;
        expect((await schema['~standard'].validate(after)).issues).toBeUndefined();
        expect(after.workingRevision).toBeGreaterThan(before.workingRevision!);
        expect(after.result.issues.find(issue => issue.file === 'content/scenario/next.gal' && issue.code === 'J002'))
          .toMatchObject({ range: { start: { line: 3, col: 7 }, end: { line: 3, col: 20 } } });
        expect(before.result.issues.some(issue => issue.file === 'content/scenario/next.gal')).toBe(false);
        expect(fs.readFileSync(path.join(root, 'content/scenario/start.gal'), 'utf8')).toBe(source);
      }
    } finally {
      await client.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});
