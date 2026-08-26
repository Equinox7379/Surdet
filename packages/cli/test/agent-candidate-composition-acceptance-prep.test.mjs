import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  prepareAcceptance,
  validateAcceptancePrepDirectory,
} from '../e2e/agent-candidate-composition-wave-5.e2e.mjs';

describe('Wave 5 acceptance-prep contract', () => {
  it('rejects the historical empty-data false positive', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave5-empty-prep-'));
    const root = path.join(base, 'prep');
    fs.mkdirSync(path.join(root, 'project'), { recursive: true });
    fs.mkdirSync(path.join(root, 'agent-data'), { recursive: true });
    fs.writeFileSync(path.join(root, 'mcp-stage.json'), '{}\n');
    fs.writeFileSync(path.join(root, 'apply-resume-template.json'), '{}\n');
    fs.writeFileSync(path.join(root, 'identity.json'), '{}\n');
    try {
      expect(() => validateAcceptancePrepDirectory(root, {
        status: 'PREPARED',
        sourceCandidates: [],
        sourceChangeRecords: [],
        dataDirFileCount: 0,
        integrationChangeCreated: false,
        externalAgentStarted: false,
        applyAuthorized: false,
        errors: [],
        childCleanupFailures: [],
        activeLeaseDirectories: [],
        projectFixtureEqualsStarterAtPrep: true,
        originalStarterUnchanged: true,
      })).toThrow(/candidate-refs\.json|four sealed source candidates|agent-data/i);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('creates four sealed candidates and every handoff file without an integration change', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'surdet-wave5-prep-contract-'));
    let result;
    try {
      result = await prepareAcceptance({ baseDirectory: base, prefix: 'prepared-' });
      expect(result.status).toBe('PREPARED');
      expect(result.evidence.sourceCandidates).toHaveLength(4);
      expect(new Set(result.evidence.sourceCandidates.map((candidate) => candidate.label))).toEqual(new Set(['A', 'B', 'C', 'D']));
      expect(result.evidence.sourceChangeRecords).toHaveLength(4);
      expect(result.evidence.sourceChangeRecords.every((record) => record.status === 'OPEN' && record.integration === false)).toBe(true);
      expect(result.evidence.dataDirFileCount).toBeGreaterThan(0);
      expect(result.evidence.integrationChangeCreated).toBe(false);
      expect(result.evidence.externalAgentStarted).toBe(false);
      expect(result.evidence.applyAuthorized).toBe(false);
      expect(result.evidence.projectFixtureEqualsStarterAtPrep).toBe(true);
      expect(result.evidence.originalStarterUnchanged).toBe(true);
      expect(result.evidence.errors).toEqual([]);
      expect(result.evidence.childCleanupFailures).toEqual([]);
      expect(result.evidence.activeLeaseDirectories).toEqual([]);
      expect(() => validateAcceptancePrepDirectory(result.root, result.evidence)).not.toThrow();

      for (const name of [
        'mcp-stage.json',
        'apply-resume-template.json',
        'candidate-refs.json',
        'acceptance-instructions.md',
        'evidence.json',
        'identity.json',
      ]) {
        expect(fs.existsSync(path.join(result.root, name)), `${name} missing`).toBe(true);
      }

      const refs = JSON.parse(fs.readFileSync(path.join(result.root, 'candidate-refs.json'), 'utf8'));
      const instructions = fs.readFileSync(path.join(result.root, 'acceptance-instructions.md'), 'utf8');
      for (const label of ['A', 'B', 'C', 'D']) {
        expect(refs.candidates[label].changeId).toMatch(/^chg_/);
        expect(refs.candidates[label].artifactSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(instructions).toContain(refs.candidates[label].changeId);
        expect(instructions).toContain(refs.candidates[label].capsuleId);
        expect(instructions).toContain(refs.candidates[label].artifactSha256);
      }

      const apply = JSON.parse(fs.readFileSync(path.join(result.root, 'apply-resume-template.json'), 'utf8'));
      expect(apply.status).toBe('NOT_AUTHORIZED');
      expect(apply.resumeChange).toContain('CHANGE_ID_REQUIRED');
    } finally {
      if (result?.root !== undefined) fs.rmSync(result.root, { recursive: true, force: true });
      fs.rmSync(base, { recursive: true, force: true });
    }
  }, 30_000);
});
