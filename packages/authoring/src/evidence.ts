export interface EvidenceEnvelope<T> {
  schemaVersion: 1;
  evidenceId: string;
  capability: string;
  status: 'passed' | 'failed' | 'incomplete' | 'timed_out';
  engineIdentity: { version: string; gitHead: string };
  projectRevision: string;
  changeId?: string;
  workingRevision?: number;
  createdAt: string;
  result: T;
  artifact?: { path: string; bytes: number; sha256: string };
}

export type EvidenceInput<T> = Omit<EvidenceEnvelope<T>, 'schemaVersion'>;

export function createEvidenceEnvelope<T>(input: EvidenceInput<T>): EvidenceEnvelope<T> {
  return { schemaVersion: 1, ...input };
}
