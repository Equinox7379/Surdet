import * as path from 'node:path';
import {
  AuthoringOperationError,
  normalizeProjectPath,
  type ProjectMutationInitiator,
  type ProjectMutationNotice,
} from '@surdet/authoring';
import { readJsonRecord, replaceJsonRecord } from './node-json-record.js';
import { NodeLocalLeaseManager } from './node-local-lease.js';
import { projectIdentityFromRoot } from './project-identity.js';

export interface RecordProjectMutationInput {
  projectRevision: string;
  coordinationRevision: string;
  initiator: ProjectMutationInitiator;
  changedPaths: readonly string[];
  operationId?: string;
  changeId?: string;
}

export interface ProjectMutationNoticeStoreOptions {
  dataRoot?: string;
  now?: () => number;
}

const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,256}$/;

function noticeError(message: string, details: Record<string, unknown> = {}): AuthoringOperationError {
  return new AuthoringOperationError('HUMAN_WORKSPACE_STATE_CORRUPT', message, {
    ...details,
    component: 'project-mutation-notice',
  });
}

function validateNotice(
  value: unknown,
  projectRootIdentity: string,
): ProjectMutationNotice {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw noticeError('project mutation notice 不是对象');
  }
  const notice = value as Partial<ProjectMutationNotice> & { projectRootIdentity?: unknown };
  const fields = ['schemaVersion', 'sequence', 'projectIdentity', 'projectRevision', 'coordinationRevision', 'initiator', 'changedPaths', 'occurredAt', 'operationId', 'changeId'];
  if (Object.keys(notice).some(key => !fields.includes(key))) throw noticeError('project mutation notice 包含未知字段');
  if (notice.schemaVersion !== 1
    || !Number.isSafeInteger(notice.sequence)
    || (notice.sequence ?? 0) < 1
    || notice.projectIdentity !== projectIdentityFromRoot(projectRootIdentity)
    || typeof notice.projectRevision !== 'string'
    || !SHA256.test(notice.projectRevision)
    || typeof notice.coordinationRevision !== 'string'
    || !SHA256.test(notice.coordinationRevision)
    || !['external-agent', 'human-editor', 'asset-authority', 'scene-authority'].includes(String(notice.initiator))
    || !Array.isArray(notice.changedPaths)
    || !notice.changedPaths.every((entry) => typeof entry === 'string')
    || typeof notice.occurredAt !== 'string'
    || !Number.isFinite(Date.parse(notice.occurredAt))
    || (notice.operationId !== undefined && !SAFE_ID.test(notice.operationId))
    || (notice.changeId !== undefined && !SAFE_ID.test(notice.changeId))) {
    throw noticeError('project mutation notice 格式或身份无效');
  }
  if (notice.changedPaths!.some(entry => normalizeProjectPath(entry) !== entry)) {
    throw noticeError('project mutation notice 路径未规范化');
  }
  return notice as ProjectMutationNotice;
}

export class ProjectMutationNoticeStore {
  readonly dataRoot: string;
  private readonly now: () => number;

  constructor(options: ProjectMutationNoticeStoreOptions = {}) {
    this.dataRoot = options.dataRoot ?? new NodeLocalLeaseManager().dataRoot;
    this.now = options.now ?? (() => Date.now());
  }

  private noticePath(projectRootIdentity: string): string {
    return path.join(
      this.dataRoot,
      'project-mutations',
      projectIdentityFromRoot(projectRootIdentity),
      'latest.json',
    );
  }

  async readLatest(projectRootIdentity: string): Promise<ProjectMutationNotice | null> {
    const loaded = await readJsonRecord<ProjectMutationNotice>(this.noticePath(projectRootIdentity));
    if (loaded === null) return null;
    return validateNotice(loaded.value, projectRootIdentity);
  }

  async record(
    projectRootIdentity: string,
    input: RecordProjectMutationInput,
    assertProjectLeaseHeld: () => void | Promise<void>,
  ): Promise<ProjectMutationNotice> {
    await assertProjectLeaseHeld();
    if (!SHA256.test(input.projectRevision) || !SHA256.test(input.coordinationRevision)) {
      throw new AuthoringOperationError(
        'INVALID_REQUEST',
        'projectRevision 与 coordinationRevision 必须是 SHA-256',
      );
    }
    const changedPaths = [...new Set(input.changedPaths.map(normalizeProjectPath))]
      .sort((left, right) => left.localeCompare(right));
    if (input.operationId !== undefined && !SAFE_ID.test(input.operationId)) {
      throw new AuthoringOperationError('INVALID_REQUEST', 'operationId 格式无效');
    }
    if (input.changeId !== undefined && !SAFE_ID.test(input.changeId)) {
      throw new AuthoringOperationError('INVALID_REQUEST', 'changeId 格式无效');
    }
    const current = await this.readLatest(projectRootIdentity);
    const notice: ProjectMutationNotice = {
      schemaVersion: 1,
      sequence: (current?.sequence ?? 0) + 1,
      projectIdentity: projectIdentityFromRoot(projectRootIdentity),
      projectRevision: input.projectRevision,
      coordinationRevision: input.coordinationRevision,
      initiator: input.initiator,
      changedPaths,
      occurredAt: new Date(this.now()).toISOString(),
      ...(input.operationId === undefined ? {} : { operationId: input.operationId }),
      ...(input.changeId === undefined ? {} : { changeId: input.changeId }),
    };
    await assertProjectLeaseHeld();
    await replaceJsonRecord(this.noticePath(projectRootIdentity), notice);
    return notice;
  }
}
