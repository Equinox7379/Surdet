import {
  AuthoringOperationError, isReviewPreparationStatus, parseReviewPreparationRequest, samePreparationReference,
  type ReviewPreparationReference, type ReviewPreparationRequest, type ReviewPreparationStatus, type PreparedReviewContent,
} from '@surdet/authoring';
import { isPreparedReviewContent, readOnlyReviewDirectory } from './review-content-directory.js';

export function preparationErrorMessage(error: unknown): string {
  if (!(error instanceof AuthoringOperationError)) return '暂时无法确认准备进度，请先检查状态；不会另建结果。';
  const descriptions: Record<string, string> = {
    REVIEW_PREPARATION_UNAVAILABLE: '请从绑定来源项目的正常编辑器入口准备结果。',
    REVIEW_DECISION_REQUIRED: '请先保存创作决定。',
    REVIEW_DECISION_STALE: '来源项目或候选已变化，请重新核对决定。',
    COMPOSITION_PLAN_STALE: '来源基线或候选已变化，不能继续原准备操作。',
    PROJECT_CHANGED_SINCE_BEGIN: '来源项目已变化，不能沿用原基线。',
    REVIEW_IDENTITY_MISMATCH: '审阅、决定或结果身份不一致，已停止操作。',
    PROJECT_IDENTITY_MISMATCH: '当前入口绑定了不同项目，已停止操作。',
    CAPSULE_IDENTITY_MISMATCH: '候选内容与保存的身份不一致，已停止操作。',
    CHANGE_STORE_CORRUPT: '准备记录或组合数据无法核对，原记录保留，不能另建结果。',
    LEASE_CORRUPT: '正在执行的操作无法核对，已停止准备。',
    REVIEW_AUTHORITY_FORBIDDEN: '当前页面与本机服务的连接已变化，请重新打开正常入口。',
  };
  return descriptions[error.code] ?? error.message;
}

export function createReviewPreparationClient(options: { token: string; endpoint?: string; fetcher?: typeof fetch }) {
  const endpoint = options.endpoint ?? '/__surdet/review-authority/v1/prepare-result';
  const execute = async (request: ReviewPreparationRequest): Promise<ReviewPreparationStatus | PreparedReviewContent> => {
    const parsed = parseReviewPreparationRequest(request);
    const response = await (options.fetcher ?? fetch)(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'x-surdet-review-authority': options.token }, body: JSON.stringify(parsed) });
    const envelope = await response.json() as { ok?: boolean; error?: { code?: unknown; message?: unknown }; result?: unknown };
    if (!response.ok || envelope.ok !== true) {
      throw new AuthoringOperationError(typeof envelope.error?.code === 'string' ? envelope.error.code : 'REVIEW_PREPARATION_IO_FAILED',
        typeof envelope.error?.message === 'string' ? envelope.error.message : '准备结果请求未得到确认。');
    }
    const result = envelope.result;
    if (parsed.action === 'prepare-result' || parsed.action === 'inspect-preparation') {
      if (!isReviewPreparationStatus(result) || !samePreparationReference(result.decision, parsed.decision)) {
        throw new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', '服务返回的准备状态不属于这份决定。');
      }
    } else if (!isPreparedReviewContent(result, parsed.action === 'read-prepared-file' ? 'file' : 'directory')) {
      throw new AuthoringOperationError('REVIEW_IDENTITY_MISMATCH', '服务返回的审阅内容无法核对。');
    }
    return result as ReviewPreparationStatus | PreparedReviewContent;
  };

  const status = async (decision: ReviewPreparationReference, action: 'inspect-preparation' | 'prepare-result') =>
    await execute({ protocolVersion: '1.0.0', action, decision }) as ReviewPreparationStatus;

  /** Read-only File System Access shape consumed by the existing review/project loaders. */
  const directory = (decision: ReviewPreparationReference, view: 'comparison' | 'result'): FileSystemDirectoryHandle => readOnlyReviewDirectory({
    key: `${decision.projectIdentity}/${decision.reviewId}/${view}`,
    rootName: decision.reviewId,
    readonlyMessage: '生成结果为只读，请明确写回来源项目后继续编辑。',
    read: async (path, kind) => {
      try { return await execute({ protocolVersion: '1.0.0', action: kind === 'file' ? 'read-prepared-file' : 'read-prepared-directory', decision, view, path }) as PreparedReviewContent; }
      catch (error) {
        if (error instanceof AuthoringOperationError && error.code === 'OBJECT_NOT_FOUND') throw new DOMException('审阅内容不存在', 'NotFoundError');
        throw error;
      }
    },
  });
  return { execute, status, directory };
}
