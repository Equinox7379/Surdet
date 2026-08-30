import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AuthoringOperationError,
  type ReviewKind,
} from '@surdet/authoring';
import { createJsonRecord, readJsonRecord, type JsonRecordIdentity } from './node-json-record.js';

const GENERATED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', 'dist']);
const resultReceiptWrites = new Map<string, Promise<unknown>>();

export interface ReviewArtifactIdentity {
  relativePath: string;
  bytes: number;
  sha256: string;
}

export interface ReviewWorkspaceIdentity {
  reviewVersion: '1.0.0';
  reviewId: string;
  kind: ReviewKind;
  projectIdentity: string;
  expectedProjectRevision: string;
  comparisonFingerprint: string;
  planFingerprint?: string;
  integrationChangeId?: string;
  workingRevision?: number;
  payload: ReviewArtifactIdentity;
}

export interface ReviewWorkspaceRead<T> {
  value: T;
  identity: ReviewWorkspaceIdentity;
  reviewDirectory: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function displayPath(value: string): string {
  return path.isAbsolute(value) || path.win32.isAbsolute(value) ? path.basename(value) : value;
}

function pathError(value: string): AuthoringOperationError {
  return new AuthoringOperationError('PATH_OUTSIDE_PROJECT', `review 路径不安全：${displayPath(value)}`);
}

function identityMismatch(message: string): AuthoringOperationError {
  return new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', message);
}

function sha256(bytes: Uint8Array): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function serialized(value: unknown): Buffer {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) throw new AuthoringOperationError('INVALID_REQUEST', 'review JSON 不能序列化 undefined');
  return Buffer.from(`${json}\n`, 'utf8');
}

function fileIdentity(file: string, bytes: Uint8Array): JsonRecordIdentity {
  return { path: file, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function readBytes(file: string, root: string): Promise<Buffer | null> {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw pathError(path.relative(root, file));
    const real = await fs.realpath(file);
    if (!isInside(root, real) || !samePath(real, file)) throw pathError(path.relative(root, file));
    return await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function assertSafeFile(file: string, root: string, allowMissing: boolean): Promise<boolean> {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw pathError(path.relative(root, file));
    const real = await fs.realpath(file);
    if (!isInside(root, real) || !samePath(real, file)) throw pathError(path.relative(root, file));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissing) return false;
    throw error;
  }
}

async function safeJsonRecord<T>(file: string, root: string, label: string): Promise<{ value: T; identity: JsonRecordIdentity } | null> {
  if (!(await assertSafeFile(file, root, true))) return null;
  try {
    return await readJsonRecord<T>(file);
  } catch (error) {
    if (error instanceof AuthoringOperationError && error.code === 'CHANGE_STORE_CORRUPT') {
      throw new AuthoringOperationError('CHANGE_STORE_CORRUPT', `review JSON 无法解析：${label}`);
    }
    throw error;
  }
}

async function createOnlyJson(file: string, root: string, value: unknown): Promise<JsonRecordIdentity> {
  const expected = serialized(value);
  const existing = await readBytes(file, root);
  if (existing !== null) {
    if (Buffer.compare(existing, expected) !== 0) throw identityMismatch(`review record 已存在不同 bytes：${displayPath(file)}`);
    return fileIdentity(file, existing);
  }
  try {
    const identity = await createJsonRecord(file, value);
    await assertSafeFile(file, root, false);
    return identity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const raced = await readBytes(file, root);
    if (raced !== null && Buffer.compare(raced, expected) === 0) return fileIdentity(file, raced);
    throw identityMismatch(`review record 并发创建后身份不一致：${displayPath(file)}`);
  }
}

async function withResultReceiptWrite<T>(reviewDirectory: string, write: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(reviewDirectory);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const previous = resultReceiptWrites.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(write);
  resultReceiptWrites.set(key, operation);
  try {
    return await operation;
  } finally {
    if (resultReceiptWrites.get(key) === operation) resultReceiptWrites.delete(key);
  }
}

function assertReviewId(reviewId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(reviewId)
    || /[. ]$/.test(reviewId)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(reviewId)) {
    throw new AuthoringOperationError('INVALID_REQUEST', `reviewId 含有非法字符：${reviewId}`);
  }
}

function expectedPayloadPath(kind: ReviewKind): 'comparison/review.json' | 'result/review.json' {
  return kind === 'comparison' ? 'comparison/review.json' : 'result/review.json';
}

function asRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw identityMismatch(`review identity 缺少 ${field}`);
  return value;
}

function validateIdentity(value: unknown, reviewId: string, expectedProjectIdentity: string): ReviewWorkspaceIdentity {
  if (!isRecord(value)
    || value['reviewVersion'] !== '1.0.0'
    || value['reviewId'] !== reviewId
    || (value['kind'] !== 'comparison' && value['kind'] !== 'integration-result')) {
    throw identityMismatch(`review identity 无效：${reviewId}`);
  }
  const projectIdentity = asRequiredString(value['projectIdentity'], 'projectIdentity');
  if (projectIdentity !== expectedProjectIdentity) throw identityMismatch(`review 不属于当前 project namespace：${reviewId}`);
  const expectedProjectRevision = asRequiredString(value['expectedProjectRevision'], 'expectedProjectRevision');
  const comparisonFingerprint = asRequiredString(value['comparisonFingerprint'], 'comparisonFingerprint');
  const payload = value['payload'];
  if (!isRecord(payload)
    || typeof payload['relativePath'] !== 'string'
    || typeof payload['bytes'] !== 'number'
    || !Number.isInteger(payload['bytes'])
    || payload['bytes'] < 0
    || typeof payload['sha256'] !== 'string'
    || !/^[0-9a-f]{64}$/.test(payload['sha256'])) {
    throw identityMismatch(`review payload identity 无效：${reviewId}`);
  }
  const kind = value['kind'] as ReviewKind;
  if (payload['relativePath'] !== expectedPayloadPath(kind)
    || path.isAbsolute(payload['relativePath'])
    || path.win32.isAbsolute(payload['relativePath'])) {
    throw identityMismatch(`review payload relativePath 不匹配：${reviewId}`);
  }
  const optionalString = (field: string): string | undefined => (
    value[field] === undefined ? undefined : asRequiredString(value[field], field)
  );
  const workingRevision = value['workingRevision'];
  if (workingRevision !== undefined && (typeof workingRevision !== 'number' || !Number.isInteger(workingRevision) || workingRevision < 0)) {
    throw identityMismatch(`review workingRevision 无效：${reviewId}`);
  }
  return {
    reviewVersion: '1.0.0',
    reviewId,
    kind,
    projectIdentity,
    expectedProjectRevision,
    comparisonFingerprint,
    ...(optionalString('planFingerprint') === undefined ? {} : { planFingerprint: optionalString('planFingerprint') }),
    ...(optionalString('integrationChangeId') === undefined ? {} : { integrationChangeId: optionalString('integrationChangeId') }),
    ...(workingRevision === undefined ? {} : { workingRevision }),
    payload: {
      relativePath: payload['relativePath'],
      bytes: payload['bytes'],
      sha256: payload['sha256'],
    },
  };
}

function payloadFacts(value: unknown, reviewId: string, identity: ReviewWorkspaceIdentity): void {
  const sourceIdentity = isRecord(value) && isRecord(value['sourceIdentity']) ? value['sourceIdentity'] : undefined;
  const comparisonFingerprint = isRecord(value) && typeof value['comparisonFingerprint'] === 'string'
    ? value['comparisonFingerprint']
    : sourceIdentity?.['comparisonFingerprint'];
  if (!isRecord(value)
    || value['reviewId'] !== reviewId
    || value['kind'] !== identity.kind
    || value['projectIdentity'] !== identity.projectIdentity
    || value['expectedProjectRevision'] !== identity.expectedProjectRevision
    || comparisonFingerprint !== identity.comparisonFingerprint) {
    throw identityMismatch(`review payload 与 identity sidecar 不一致：${reviewId}`);
  }
  if (identity.planFingerprint !== undefined && sourceIdentity !== undefined
    && sourceIdentity['planFingerprint'] !== identity.planFingerprint) {
    throw identityMismatch(`review planFingerprint 与 identity sidecar 不一致：${reviewId}`);
  }
}

async function ensureDirectoryChain(target: string, create: boolean): Promise<boolean> {
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  if (!isInside(root, absolute)) throw pathError(target);
  const relative = path.relative(root, absolute);
  let current = root;
  for (const segment of relative.length === 0 ? [] : relative.split(path.sep)) {
    current = path.join(current, segment);
    let stat: Awaited<ReturnType<typeof fs.lstat>>;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw pathError(target);
      if (!create) return false;
      try {
        await fs.mkdir(current);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') throw pathError(target);
        stat = await fs.lstat(current);
      }
      stat ??= await fs.lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw pathError(target);
    const real = await fs.realpath(current).catch(() => '');
    if (real === '' || !samePath(real, current)) throw pathError(target);
  }
  return true;
}

function assertRelativeProjectFile(relativePath: string): void {
  if (relativePath.length === 0 || relativePath.includes('\\') || path.posix.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)
    || relativePath.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..' || segment.startsWith('.surdet-'))
    || path.posix.normalize(relativePath) !== relativePath) {
    throw pathError(relativePath);
  }
  if (GENERATED_DIRECTORY_NAMES.has(relativePath.split('/')[0]!)) throw pathError(relativePath);
}

export class NodeReviewStore {
  readonly projectDirectory: string;

  constructor(projectDirectory: string, private readonly expectedProjectIdentity: string) {
    const normalized = path.resolve(projectDirectory);
    if (path.basename(normalized) !== expectedProjectIdentity) {
      throw new AuthoringOperationError('PROJECT_IDENTITY_MISMATCH',
        `review projectDirectory 与期望 projectIdentity 不符：${expectedProjectIdentity}`);
    }
    this.projectDirectory = normalized;
  }

  reviewDirectoryPath(reviewId: string): string {
    assertReviewId(reviewId);
    const directory = path.join(this.projectDirectory, 'reviews', reviewId);
    if (!isInside(this.projectDirectory, directory)) throw pathError(directory);
    return directory;
  }

  private payloadPath(reviewId: string, kind: ReviewKind): string {
    return path.join(this.reviewDirectoryPath(reviewId), ...expectedPayloadPath(kind).split('/'));
  }

  private async existingReviewDirectory(reviewId: string): Promise<string | null> {
    const directory = this.reviewDirectoryPath(reviewId);
    if (!(await ensureDirectoryChain(this.projectDirectory, false))) return null;
    if (!(await ensureDirectoryChain(path.join(this.projectDirectory, 'reviews'), false))) return null;
    if (!(await ensureDirectoryChain(directory, false))) return null;
    return directory;
  }

  async createReview(reviewId: string, payload: unknown): Promise<ReviewWorkspaceIdentity> {
    assertReviewId(reviewId);
    if (!isRecord(payload)
      || (payload['kind'] !== 'comparison' && payload['kind'] !== 'integration-result')) {
      throw new AuthoringOperationError('INVALID_REQUEST', 'review payload 缺少合法 kind');
    }
    if (payload['reviewVersion'] !== '1.0.0') {
      throw new AuthoringOperationError('REVIEW_FORMAT_UNSUPPORTED', 'reviewVersion 不是受支持的 1.0.0');
    }
    const kind = payload['kind'] as ReviewKind;
    if (payload['reviewId'] !== reviewId) throw identityMismatch(`review payload reviewId 不匹配：${reviewId}`);
    const projectIdentity = asRequiredString(payload['projectIdentity'], 'projectIdentity');
    if (projectIdentity !== this.expectedProjectIdentity) throw identityMismatch(`review 不属于当前 project namespace：${reviewId}`);
    const expectedProjectRevision = asRequiredString(payload['expectedProjectRevision'], 'expectedProjectRevision');
    const comparisonFingerprint = asRequiredString(payload['sourceIdentity'] && isRecord(payload['sourceIdentity'])
      ? payload['sourceIdentity']['comparisonFingerprint'] ?? payload['comparisonFingerprint']
      : payload['comparisonFingerprint'], 'comparisonFingerprint');
    const sourceIdentity = isRecord(payload['sourceIdentity']) ? payload['sourceIdentity'] : undefined;
    const planFingerprint = sourceIdentity !== undefined && typeof sourceIdentity['planFingerprint'] === 'string'
      ? sourceIdentity['planFingerprint']
      : undefined;
    const integrationChangeId = sourceIdentity !== undefined && typeof sourceIdentity['integrationChangeId'] === 'string'
      ? sourceIdentity['integrationChangeId']
      : undefined;
    const workingRevision = sourceIdentity !== undefined && typeof sourceIdentity['workingRevision'] === 'number'
      ? sourceIdentity['workingRevision']
      : undefined;
    const reviewDirectory = this.reviewDirectoryPath(reviewId);
    await ensureDirectoryChain(reviewDirectory, true);
    const payloadRelativePath = expectedPayloadPath(kind);
    const payloadFile = this.payloadPath(reviewId, kind);
    await ensureDirectoryChain(path.dirname(payloadFile), true);
    const payloadBytes = serialized(payload);
    const identity: ReviewWorkspaceIdentity = {
      reviewVersion: '1.0.0',
      reviewId,
      kind,
      projectIdentity,
      expectedProjectRevision,
      comparisonFingerprint,
      ...(planFingerprint === undefined ? {} : { planFingerprint }),
      ...(integrationChangeId === undefined ? {} : { integrationChangeId }),
      ...(workingRevision === undefined ? {} : { workingRevision }),
      payload: { relativePath: payloadRelativePath, bytes: payloadBytes.byteLength, sha256: sha256(payloadBytes) },
    };
    const existingPayload = await readBytes(payloadFile, this.projectDirectory);
    const identityFile = path.join(reviewDirectory, 'identity.json');
    const existingIdentity = await readBytes(identityFile, this.projectDirectory);
    if (existingPayload !== null || existingIdentity !== null) {
      if (existingPayload === null || existingIdentity === null || Buffer.compare(existingPayload, payloadBytes) !== 0) {
        throw identityMismatch(`同 reviewId 已存在不同或不完整的 review workspace：${reviewId}`);
      }
      const read = await this.readReview(reviewId);
      return read.identity;
    }
    await createOnlyJson(payloadFile, this.projectDirectory, payload);
    await createOnlyJson(identityFile, this.projectDirectory, identity);
    return identity;
  }

  async readReview<T = unknown>(reviewId: string): Promise<ReviewWorkspaceRead<T>> {
    assertReviewId(reviewId);
    const reviewDirectory = await this.existingReviewDirectory(reviewId);
    if (reviewDirectory === null) throw new AuthoringOperationError('REVIEW_NOT_FOUND', `review workspace 不存在：${reviewId}`, { reviewId });
    const identityRead = await safeJsonRecord<unknown>(path.join(reviewDirectory, 'identity.json'), this.projectDirectory, 'identity.json');
    if (identityRead === null) throw identityMismatch(`review workspace 缺少 identity sidecar：${reviewId}`);
    const identity = validateIdentity(identityRead.value, reviewId, this.expectedProjectIdentity);
    const payloadFile = path.join(reviewDirectory, ...identity.payload.relativePath.split('/'));
    if (!isInside(reviewDirectory, payloadFile)) throw pathError(payloadFile);
    const payloadRead = await safeJsonRecord<T>(payloadFile, this.projectDirectory, identity.payload.relativePath);
    if (payloadRead === null) throw identityMismatch(`review payload 缺失：${reviewId}`);
    if (payloadRead.identity.bytes !== identity.payload.bytes || payloadRead.identity.sha256 !== identity.payload.sha256) {
      throw identityMismatch(`review payload bytes/SHA 与 identity sidecar 不一致：${reviewId}`);
    }
    payloadFacts(payloadRead.value, reviewId, identity);
    return { value: payloadRead.value, identity, reviewDirectory };
  }

  private async createRecord(reviewId: string, relativePath: string, value: unknown): Promise<JsonRecordIdentity> {
    assertReviewId(reviewId);
    const review = await this.readReview(reviewId);
    const file = path.join(review.reviewDirectory, relativePath);
    if (!isInside(review.reviewDirectory, file)) throw pathError(file);
    return createOnlyJson(file, this.projectDirectory, value);
  }

  private async readRecord<T>(reviewId: string, relativePath: string): Promise<{ value: T; identity: JsonRecordIdentity } | null> {
    assertReviewId(reviewId);
    const review = await this.readReview(reviewId);
    const file = path.join(review.reviewDirectory, relativePath);
    if (!isInside(review.reviewDirectory, file)) throw pathError(file);
    return safeJsonRecord<T>(file, this.projectDirectory, relativePath);
  }

  async createDecision(reviewId: string, value: unknown): Promise<JsonRecordIdentity> {
    const review = await this.readReview(reviewId);
    if (review.identity.kind !== 'comparison') {
      throw new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', `integration result 不能写入 comparison decision：${reviewId}`);
    }
    return this.createRecord(reviewId, 'decision.json', value);
  }

  async readDecision<T = unknown>(reviewId: string): Promise<{ value: T; identity: JsonRecordIdentity } | null> {
    return this.readRecord<T>(reviewId, 'decision.json');
  }

  async createFinalApproval(reviewId: string, value: unknown): Promise<JsonRecordIdentity> {
    const review = await this.readReview(reviewId);
    if (review.identity.kind !== 'integration-result') {
      throw new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', `comparison review 不能写入 final approval：${reviewId}`);
    }
    return withResultReceiptWrite(review.reviewDirectory, async () => {
      const approvalFile = path.join(review.reviewDirectory, 'final-approval.json');
      const returnFile = path.join(review.reviewDirectory, 'return-request.json');
      const [approval, returned] = await Promise.all([
        readBytes(approvalFile, this.projectDirectory),
        readBytes(returnFile, this.projectDirectory),
      ]);
      if (approval !== null && returned !== null) throw identityMismatch(`同一 result review 同时存在 final approval 与 return request：${reviewId}`);
      if (returned !== null) throw identityMismatch(`同一 result review 已存在 return request：${reviewId}`);
      return createOnlyJson(approvalFile, this.projectDirectory, value);
    });
  }

  async readFinalApproval<T = unknown>(reviewId: string): Promise<{ value: T; identity: JsonRecordIdentity } | null> {
    return this.readRecord<T>(reviewId, 'final-approval.json');
  }

  async createApproval(reviewId: string, value: unknown): Promise<JsonRecordIdentity> {
    return this.createFinalApproval(reviewId, value);
  }

  async readApproval<T = unknown>(reviewId: string): Promise<{ value: T; identity: JsonRecordIdentity } | null> {
    return this.readFinalApproval<T>(reviewId);
  }

  async createReturnRequest(reviewId: string, value: unknown): Promise<JsonRecordIdentity> {
    const review = await this.readReview(reviewId);
    if (review.identity.kind !== 'integration-result') {
      throw new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', `comparison review 不能写入 return request：${reviewId}`);
    }
    return withResultReceiptWrite(review.reviewDirectory, async () => {
      const approvalFile = path.join(review.reviewDirectory, 'final-approval.json');
      const returnFile = path.join(review.reviewDirectory, 'return-request.json');
      const [approval, returned] = await Promise.all([
        readBytes(approvalFile, this.projectDirectory),
        readBytes(returnFile, this.projectDirectory),
      ]);
      if (approval !== null && returned !== null) throw identityMismatch(`同一 result review 同时存在 final approval 与 return request：${reviewId}`);
      if (approval !== null) throw identityMismatch(`同一 result review 已存在 final approval：${reviewId}`);
      return createOnlyJson(returnFile, this.projectDirectory, value);
    });
  }

  async readReturnRequest<T = unknown>(reviewId: string): Promise<{ value: T; identity: JsonRecordIdentity } | null> {
    return this.readRecord<T>(reviewId, 'return-request.json');
  }

  async createResultProject(
    reviewId: string,
    files: readonly { relativePath: string; bytes: Uint8Array }[],
  ): Promise<string> {
    const review = await this.readReview(reviewId);
    if (review.identity.kind !== 'integration-result') {
      throw new AuthoringOperationError('REVIEW_RESULT_NOT_READY', `comparison review 没有 result project：${reviewId}`);
    }
    const projectDirectory = path.join(review.reviewDirectory, 'result', 'project');
    await ensureDirectoryChain(projectDirectory, true);
    for (const file of files) {
      assertRelativeProjectFile(file.relativePath);
      const target = path.join(projectDirectory, ...file.relativePath.split('/'));
      if (!isInside(projectDirectory, target)) throw pathError(file.relativePath);
      await ensureDirectoryChain(path.dirname(target), true);
      const expected = Buffer.from(file.bytes);
      const existing = await readBytes(target, projectDirectory);
      if (existing !== null) {
        if (Buffer.compare(existing, expected) !== 0) throw identityMismatch(`result project 文件已存在不同 bytes：${file.relativePath}`);
        continue;
      }
      const handle = await fs.open(target, 'wx');
      try {
        await handle.write(expected);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await assertSafeFile(target, projectDirectory, false);
    }
    return projectDirectory;
  }

  async resultProjectDirectory(reviewId: string): Promise<string> {
    const review = await this.readReview(reviewId);
    if (review.identity.kind !== 'integration-result') throw new AuthoringOperationError('REVIEW_RESULT_NOT_READY', `review 不是 result：${reviewId}`);
    const directory = path.join(review.reviewDirectory, 'result', 'project');
    if (!(await ensureDirectoryChain(directory, false))) throw new AuthoringOperationError('OBJECT_NOT_FOUND', `result project 不存在：${reviewId}`);
    return directory;
  }
}
