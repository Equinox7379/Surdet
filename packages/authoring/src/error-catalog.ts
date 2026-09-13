import type {
  AuthoringEnvelope,
  EnvelopeContext,
  EnvelopeErrorShape,
  EnvelopeRepairAction,
  JsonSchema,
  RetryDisposition,
} from './capability-contract.js';
import { AUTHORING_CONTRACT_VERSION, AUTHORING_ENVELOPE_SCHEMA_VERSION } from './capability-contract.js';
import type { AuthoringCapabilityId } from './capability-registry.js';
import { AuthoringOperationError } from './change-session.js';

export const AUTHORING_ERROR_CODES = [
  'IMPORT_OPERATION_NOT_FOUND',
  'IMPORT_OPERATION_CONFLICT',
  'IMPORT_PLAN_BLOCKED',
  'IMPORT_PLAN_STALE',
  'IMPORT_PROJECT_STALE',
  'IMPORT_TARGET_UNSAFE',
  'IMPORT_TARGET_EXISTS',
  'IMPORT_RECOVERY_REQUIRED',
  'IMPORT_LIMIT_EXCEEDED',
  'IMPORT_UPLOAD_BUSY',
  'IMPORT_UPLOAD_TIMEOUT',
  'IMPORT_UPLOAD_MISMATCH',
  'IMPORT_AUTHORITY_NOT_READY',
  'IMPORT_FILESYSTEM_UNSUPPORTED',
  'IMPORT_PUBLICATION_FAILED',
  'IMPORT_IO_FAILED',
  'ASSET_SOURCE_FORBIDDEN',
  'ASSET_SOURCE_CHANGED',
  'ASSET_IMAGE_INVALID',
  'CAPABILITY_UNAVAILABLE', 'INVALID_REQUEST', 'UNSUPPORTED_OBJECT_KIND',
  'UNSUPPORTED_OPERATION', 'PROJECT_NOT_FOUND', 'PROJECT_INVALID',
  'PATH_OUTSIDE_PROJECT', 'OBJECT_NOT_FOUND', 'OBJECT_AMBIGUOUS',
  'OBJECT_REF_STALE', 'OBJECT_PRECONDITION_FAILED', 'CHANGE_NOT_FOUND',
  'CHANGE_NOT_OPEN', 'CHANGE_ID_AMBIGUOUS', 'OPERATION_ID_CONFLICT',
  'PROJECT_CHANGED_SINCE_BEGIN', 'HUMAN_WORKSPACE_DIRTY', 'HUMAN_WORKSPACE_BUSY',
  'HUMAN_WORKSPACE_STATE_CORRUPT', 'VALIDATION_REQUIRED', 'VALIDATION_STALE',
  'VALIDATION_FAILED', 'SIMULATION_REQUIRED', 'SIMULATION_INCOMPLETE',
  'RUNTIME_EVIDENCE_REQUIRED', 'RUNTIME_FAILED', 'RUNTIME_TIMED_OUT',
  'COMMIT_FAILED_RECOVERED', 'COMMIT_RECOVERY_FAILED',
  'SESSION_STATE_INVALID', 'POLICY_BLOCKED', 'PROJECT_IDENTITY_MISMATCH',
  'CONTRACT_VERSION_UNSUPPORTED', 'CHANGE_RECORD_CONFLICT', 'CHANGE_BUSY',
  'PROJECT_BUSY', 'LEASE_CORRUPT', 'CHANGE_STORE_CORRUPT',
  'CHANGE_STORE_FORMAT_UNSUPPORTED', 'JOURNAL_CORRUPT', 'RECOVERY_NOT_REQUIRED',
  'RECOVERY_PLAN_STALE', 'RECOVERY_AMBIGUOUS', 'RECOVERY_EXECUTION_FAILED',
  'INVOCATION_LEDGER_WRITE_FAILED', 'CAPSULE_IDENTITY_MISMATCH',
  'CANDIDATE_PROJECT_MISMATCH', 'CANDIDATE_BASE_MISMATCH', 'CANDIDATE_NOT_COMPOSABLE',
  'CANDIDATE_DEPENDENCY_NOT_READY', 'CANDIDATE_DEPENDENCY_CYCLE', 'CANDIDATE_OPERATION_FACTS_REQUIRED',
  'COMPOSITION_DEPENDENCY_MISSING', 'COMPOSITION_CONFLICT_UNRESOLVED',
  'COMPOSITION_PLAN_STALE', 'COMPOSITION_PLAN_INVALID', 'COMPOSITION_REPLAY_FAILED',
  'COMPOSITION_INCOMPLETE', 'REVIEW_NOT_FOUND', 'REVIEW_IDENTITY_MISMATCH',
  'REVIEW_FORMAT_UNSUPPORTED', 'REVIEW_DECISION_REQUIRED', 'REVIEW_DECISION_INVALID',
  'REVIEW_DECISION_STALE', 'REVIEW_RESULT_NOT_READY', 'REVIEW_APPROVAL_REQUIRED',
  'REVIEW_APPROVAL_STALE', 'REVIEW_RETURNED', 'REVIEW_FIXTURE_CHANGED',
  'REVIEW_BUSY', 'REVIEW_TERMINAL_ALREADY_SET',
] as const;

export type AuthoringErrorCode = (typeof AUTHORING_ERROR_CODES)[number];
export type ErrorCategory = 'request' | 'not-found' | 'conflict' | 'validation' | 'runtime' | 'commit';
export type RepairAction = EnvelopeRepairAction & {
  capability?: AuthoringCapabilityId | 'session.describe';
};

export interface AuthoringErrorDefinition {
  code: AuthoringErrorCode;
  category: ErrorCategory;
  retryDisposition: RetryDisposition;
  repairActions: readonly RepairAction[];
}

const action = (
  capability: AuthoringCapabilityId | 'session.describe',
  reason: string,
  requiredFreshFacts: string[] = [],
  inputTemplate?: Readonly<Record<string, unknown>>,
  terminal = false,
): RepairAction => ({
  capability,
  reason,
  ...(requiredFreshFacts.length > 0 ? { requiredFreshFacts } : {}),
  ...(inputTemplate === undefined ? {} : { inputTemplate }),
  ...(terminal ? { terminal: true } : {}),
});

const terminalAction = (reason: string): RepairAction => ({ reason, terminal: true });

const jsonObjectValueSchema: JsonSchema = {
  oneOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
    { type: 'array', items: { type: 'string' } },
    { type: 'object', patternProperties: { '^.*$': { type: 'string' } }, additionalProperties: false },
  ],
};

const defaultDefinitions: Record<AuthoringErrorCode, Omit<AuthoringErrorDefinition, 'code'>> = {
  IMPORT_OPERATION_NOT_FOUND: { category: 'not-found', retryDisposition: 'after-inspect', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_OPERATION_CONFLICT: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_PLAN_BLOCKED: { category: 'commit', retryDisposition: 'after-repair', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_PLAN_STALE: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_PROJECT_STALE: { category: 'commit', retryDisposition: 'never', repairActions: [terminalAction('检查授权或实际文件身份；不得扩大目录权限或覆盖现有文件。')] },
  IMPORT_TARGET_UNSAFE: { category: 'commit', retryDisposition: 'never', repairActions: [terminalAction('检查授权或实际文件身份；不得扩大目录权限或覆盖现有文件。')] },
  IMPORT_TARGET_EXISTS: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_RECOVERY_REQUIRED: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_LIMIT_EXCEEDED: { category: 'commit', retryDisposition: 'after-repair', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_UPLOAD_BUSY: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_UPLOAD_TIMEOUT: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_UPLOAD_MISMATCH: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_AUTHORITY_NOT_READY: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_FILESYSTEM_UNSUPPORTED: { category: 'commit', retryDisposition: 'never', repairActions: [terminalAction('检查授权或实际文件身份；不得扩大目录权限或覆盖现有文件。')] },
  IMPORT_PUBLICATION_FAILED: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  IMPORT_IO_FAILED: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('asset.import.inspect', '查询同一 operationId 的持久状态；只按当前计划继续，不新建替代操作。')] },
  ASSET_SOURCE_FORBIDDEN: { category: 'request', retryDisposition: 'never', repairActions: [terminalAction('检查授权或实际文件身份；不得扩大目录权限或覆盖现有文件。')] },
  ASSET_SOURCE_CHANGED: { category: 'request', retryDisposition: 'after-inspect', repairActions: [action('asset.sources', '重新读取已授权的图片来源和摘要。')] },
  ASSET_IMAGE_INVALID: { category: 'request', retryDisposition: 'after-repair', repairActions: [action('asset.sources', '重新读取已授权的图片来源和摘要。')] },
  CAPABILITY_UNAVAILABLE: { category: 'request', retryDisposition: 'never', repairActions: [] },
  INVALID_REQUEST: { category: 'request', retryDisposition: 'same-request', repairActions: [] },
  UNSUPPORTED_OBJECT_KIND: { category: 'request', retryDisposition: 'never', repairActions: [] },
  UNSUPPORTED_OPERATION: { category: 'request', retryDisposition: 'never', repairActions: [] },
  PROJECT_NOT_FOUND: { category: 'not-found', retryDisposition: 'after-inspect', repairActions: [action('project.inspect', '重新读取项目事实并确认项目根与对象路径。')] },
  PROJECT_INVALID: { category: 'validation', retryDisposition: 'after-repair', repairActions: [action('project.validate', '读取最新校验问题并完成类型化修复。')] },
  PATH_OUTSIDE_PROJECT: { category: 'conflict', retryDisposition: 'never', repairActions: [] },
  OBJECT_NOT_FOUND: { category: 'not-found', retryDisposition: 'after-inspect', repairActions: [action('object.inspect', '用最新项目或事务视图重新解析对象引用。')] },
  OBJECT_AMBIGUOUS: { category: 'not-found', retryDisposition: 'after-inspect', repairActions: [action('project.inspect', '读取对象索引并改用唯一 objectRef。')] },
  OBJECT_REF_STALE: { category: 'conflict', retryDisposition: 'after-inspect', repairActions: [action('object.inspect', '先读取对象当前 fingerprint，再生成新的 typed mutation。', ['object fingerprint', 'project revision'])] },
  OBJECT_PRECONDITION_FAILED: { category: 'conflict', retryDisposition: 'after-inspect', repairActions: [action('object.inspect', '先读取对象当前 fingerprint，再生成新的 typed mutation。', ['object fingerprint', 'project revision'])] },
  CHANGE_NOT_FOUND: { category: 'not-found', retryDisposition: 'never', repairActions: [] },
  CHANGE_NOT_OPEN: { category: 'conflict', retryDisposition: 'never', repairActions: [] },
  CHANGE_ID_AMBIGUOUS: { category: 'conflict', retryDisposition: 'manual-recovery', repairActions: [terminalAction('多个 change identity 无法安全猜测；由人工选择并恢复。')] },
  OPERATION_ID_CONFLICT: { category: 'conflict', retryDisposition: 'never', repairActions: [terminalAction('同一 operationId 已绑定另一负载，不得改写或重试不同 payload。')] },
  PROJECT_CHANGED_SINCE_BEGIN: { category: 'conflict', retryDisposition: 'new-change', repairActions: [action('project.inspect', '重新读取项目基线。'), action('change.begin', '在新鲜项目基线上创建新的 change。')] },
  HUMAN_WORKSPACE_DIRTY: { category: 'conflict', retryDisposition: 'after-human-review', repairActions: [action('session.describe', '等待人类保存或放弃未保存草稿，再重新读取工作区状态。')] },
  HUMAN_WORKSPACE_BUSY: { category: 'conflict', retryDisposition: 'after-refresh', repairActions: [action('session.describe', '等待人类保存、项目切换或受控写入完成，再重新读取状态。')] },
  HUMAN_WORKSPACE_STATE_CORRUPT: { category: 'commit', retryDisposition: 'manual-recovery', repairActions: [terminalAction('人类工作区状态无法安全确认；保留项目与 change，检查绑定 Editor 后再继续。')] },
  VALIDATION_REQUIRED: { category: 'validation', retryDisposition: 'after-repair', repairActions: [action('project.validate', '为当前 workingRevision 取得新鲜校验证据。')] },
  VALIDATION_STALE: { category: 'validation', retryDisposition: 'after-repair', repairActions: [action('project.validate', 'mutation 后重新运行校验并绑定当前 workingRevision。')] },
  VALIDATION_FAILED: { category: 'validation', retryDisposition: 'after-repair', repairActions: [action('project.validate', '读取 typed issue 与 objectRef，修复后重新校验。')] },
  SIMULATION_REQUIRED: { category: 'validation', retryDisposition: 'after-repair', repairActions: [action('project.simulate', '在当前 revision 上取得新鲜模拟证据。')] },
  SIMULATION_INCOMPLETE: { category: 'validation', retryDisposition: 'after-repair', repairActions: [action('project.simulate', '调整明确的模拟预算或路径后重新模拟。')] },
  RUNTIME_EVIDENCE_REQUIRED: { category: 'runtime', retryDisposition: 'after-repair', repairActions: [action('runtime.run-from', '使用明确 sceneId 与 choices 运行路径。'), action('runtime.read-trace', '读取新鲜 trace 以确认运行时结果。')] },
  RUNTIME_FAILED: { category: 'runtime', retryDisposition: 'after-repair', repairActions: [action('project.validate', '先修复校验问题，再重跑明确 runtime path。')] },
  RUNTIME_TIMED_OUT: { category: 'runtime', retryDisposition: 'after-repair', repairActions: [action('runtime.run-from', '检查路径与 maxSteps 后重新运行。')] },
  COMMIT_FAILED_RECOVERED: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('session.describe', '读取事务状态与恢复信息。'), action('project.inspect', '确认项目文件与 revision 后再决定是否重试。')] },
  COMMIT_RECOVERY_FAILED: { category: 'commit', retryDisposition: 'manual-recovery', repairActions: [terminalAction('提交恢复失败；必须人工检查 journal、staged identity 与项目文件。')] },
  SESSION_STATE_INVALID: { category: 'conflict', retryDisposition: 'after-repair', repairActions: [action('session.describe', '重新读取 Port session 状态后按允许状态继续。')] },
  POLICY_BLOCKED: { category: 'conflict', retryDisposition: 'never', repairActions: [terminalAction('当前启动 policy 不允许该动作；由项目所有者重启 Port 并显式选择 policy。')] },
  PROJECT_IDENTITY_MISMATCH: { category: 'conflict', retryDisposition: 'never', repairActions: [terminalAction('项目身份不匹配；不得跨项目猜测或继续写入。')] },
  CONTRACT_VERSION_UNSUPPORTED: { category: 'request', retryDisposition: 'never', repairActions: [terminalAction('调用方必须升级到双方支持的 authoring contract version。')] },
  CHANGE_RECORD_CONFLICT: { category: 'conflict', retryDisposition: 'after-refresh', repairActions: [action('session.describe', '重新读取当前 change recordVersion、status 和 lease。'), action('change.diff', '刷新当前 change 事实后，以同一 operationId 安全重试。')] },
  CHANGE_BUSY: { category: 'conflict', retryDisposition: 'after-refresh', repairActions: [action('session.describe', '读取 change lease holder、heartbeat 与 retryAfterMs 后再重试。')] },
  PROJECT_BUSY: { category: 'conflict', retryDisposition: 'after-refresh', repairActions: [action('session.describe', '读取 project lease holder 与 retryAfterMs 后再重试。')] },
  LEASE_CORRUPT: { category: 'conflict', retryDisposition: 'manual-recovery', repairActions: [terminalAction('租约文件损坏或身份不明；保留 lock 证据，由人工检查后再恢复。')] },
  CHANGE_STORE_CORRUPT: { category: 'commit', retryDisposition: 'manual-recovery', repairActions: [terminalAction('change store 的 manifest、head 或 record 损坏；保留原始文件，人工恢复。')] },
  CHANGE_STORE_FORMAT_UNSUPPORTED: { category: 'commit', retryDisposition: 'never', repairActions: [terminalAction('change store 使用不受支持的历史格式；不得自动迁移或删除，需人工处理。')] },
  JOURNAL_CORRUPT: { category: 'commit', retryDisposition: 'manual-recovery', repairActions: [terminalAction('commit journal 损坏、缺号或身份矛盾；保留全部 journal 文件，人工恢复。')] },
  RECOVERY_NOT_REQUIRED: { category: 'conflict', retryDisposition: 'never', repairActions: [terminalAction('当前 change 没有可执行的恢复动作；继续使用 session 当前状态。')] },
  RECOVERY_PLAN_STALE: { category: 'conflict', retryDisposition: 'after-inspect', repairActions: [action('change.recovery.inspect', '重新读取 record、journal、lease 与项目文件身份，再使用新 recoveryToken。')] },
  RECOVERY_AMBIGUOUS: { category: 'commit', retryDisposition: 'manual-recovery', repairActions: [terminalAction('项目存在 unexpected、路径逃逸或锁歧义；不得继续自动写入，需人工恢复。')] },
  RECOVERY_EXECUTION_FAILED: { category: 'commit', retryDisposition: 'manual-recovery', repairActions: [terminalAction('恢复执行失败；保留 RECOVERY_FAILED journal 与项目文件，人工检查后处理。')] },
  INVOCATION_LEDGER_WRITE_FAILED: { category: 'commit', retryDisposition: 'after-inspect', repairActions: [action('session.describe', '确认领域 operation 是否已经成功及其 operationId。'), action('change.diff', '读取当前 change 事实并使用同一 operationId 安全重试。')] },
  CAPSULE_IDENTITY_MISMATCH: { category: 'conflict', retryDisposition: 'never', repairActions: [action('composition.compare', 'capsule artifact 已损坏或不一致；从同一基线重新封存候选，不得重试同一 artifact。')] },
  CANDIDATE_PROJECT_MISMATCH: { category: 'conflict', retryDisposition: 'new-change', repairActions: [action('project.inspect', '确认目标项目身份；为不同项目分别产生候选。')] },
  CANDIDATE_BASE_MISMATCH: { category: 'conflict', retryDisposition: 'new-change', repairActions: [action('project.inspect', '回到统一 base revision 后重新产生全部候选。')] },
  CANDIDATE_NOT_COMPOSABLE: { category: 'request', retryDisposition: 'new-change', repairActions: [action('project.inspect', '确认当前项目与基线后，用 v2 capsule manifest（2.0.0）重新封存该候选。')] },
  CANDIDATE_DEPENDENCY_NOT_READY: { category: 'validation', retryDisposition: 'after-repair', repairActions: [
    action('project.inspect', '确认命名对象是否已在基线存在。'),
    action('project.assets', '素材依赖必须选择当前已解析资源。'),
    action('session.describe', '当前操作尚未写入；依照 issues 中的 suggestedCapabilities 先建立生产者，再以同一 operationId 和原负载重试。'),
  ] },
  CANDIDATE_DEPENDENCY_CYCLE: { category: 'validation', retryDisposition: 'after-repair', repairActions: [
    action('change.diff', '读取当前已持久化的单向依赖；拟写入的第二条环边没有落盘。'),
    action('session.describe', '改写或放弃拟写入的操作，保持对象单元单向依赖；互相创建空骨架不能解除此环。'),
  ] },
  CANDIDATE_OPERATION_FACTS_REQUIRED: { category: 'conflict', retryDisposition: 'new-change', repairActions: [
    action('change.diff', '读取现有 change 的状态；不从最终文件补写历史事实。'),
    action('change.rollback', '放弃缺少时点事实的旧候选。'),
    action('change.begin', '在新合同下重新创建 candidate。'),
  ] },
  COMPOSITION_DEPENDENCY_MISSING: { category: 'request', retryDisposition: 'after-repair', repairActions: [action('composition.plan', '把缺失依赖单元纳入选择或其生产者候选，重新生成计划。')] },
  COMPOSITION_CONFLICT_UNRESOLVED: { category: 'request', retryDisposition: 'after-repair', repairActions: [action('composition.plan', '为每个 selection-required 冲突给出显式 unitId 裁决后重新计划。')] },
  COMPOSITION_PLAN_STALE: { category: 'conflict', retryDisposition: 'after-refresh', repairActions: [action('project.inspect', '刷新项目 revision 与 comparison identity。'), action('composition.inspect', '核对计划基线。'), action('composition.compare', '基线已移动时重新比较并重排计划。')] },
  COMPOSITION_PLAN_INVALID: { category: 'request', retryDisposition: 'never', repairActions: [] },
  COMPOSITION_REPLAY_FAILED: { category: 'validation', retryDisposition: 'after-repair', repairActions: [action('change.diff', '读取失败 operationIndex 的领域差异。'), action('object.inspect', '核对相关对象当前指纹。'), action('change.rollback', '放弃失败集成；创建新候选或新计划，不能原地换 replay payload。')] },
  COMPOSITION_INCOMPLETE: { category: 'conflict', retryDisposition: 'after-inspect', repairActions: [action('composition.execute', '以同一 executeOperationId 精确恢复 REPLAYING 集成。'), action('change.diff', 'FAILED 时只能 inspect/diff/rollback。')] },
  REVIEW_NOT_FOUND: { category: 'not-found', retryDisposition: 'after-inspect', repairActions: [action('review.prepare-comparison', '重新读取 reviewId 与相对审阅路径。')] },
  REVIEW_IDENTITY_MISMATCH: { category: 'conflict', retryDisposition: 'never', repairActions: [terminalAction('保留原始审阅包，重新 prepare；不得改写原包。')] },
  REVIEW_FORMAT_UNSUPPORTED: { category: 'request', retryDisposition: 'never', repairActions: [terminalAction('使用当前支持的 reviewVersion；不得自动转换未知格式。')] },
  REVIEW_DECISION_REQUIRED: { category: 'conflict', retryDisposition: 'after-human-review', repairActions: [terminalAction('在 Editor 完成人类裁决后再继续；Agent 不得伪造决定回执。')] },
  REVIEW_DECISION_INVALID: { category: 'request', retryDisposition: 'after-human-review', repairActions: [terminalAction('在 Editor 修正非法选择并生成新的 decisionId；Agent 不得代填回执。')] },
  REVIEW_DECISION_STALE: { category: 'conflict', retryDisposition: 'after-refresh', repairActions: [action('review.prepare-comparison', 'comparison 或项目基线已变化，重新生成审阅包。')] },
  REVIEW_RESULT_NOT_READY: { category: 'conflict', retryDisposition: 'after-inspect', repairActions: [action('composition.inspect', '确认 integration plan 与 READY 状态后再准备结果审阅。')] },
  REVIEW_APPROVAL_REQUIRED: { category: 'conflict', retryDisposition: 'after-human-review', repairActions: [terminalAction('在 Editor 预览并由项目所有者批准后再继续；Agent 不得伪造批准。')] },
  REVIEW_APPROVAL_STALE: { category: 'conflict', retryDisposition: 'after-refresh', repairActions: [action('review.prepare-result', '重新生成 result review 并取得当前 fresh approval。')] },
  REVIEW_RETURNED: { category: 'conflict', retryDisposition: 'never', repairActions: [terminalAction('用户已退回该计划；必须创建新的候选、comparison 和 plan。')] },
  REVIEW_FIXTURE_CHANGED: { category: 'conflict', retryDisposition: 'after-refresh', repairActions: [action('review.prepare-result', '丢弃探索性 fixture 修改并重新加载正式 result。')] },
  REVIEW_BUSY: { category: 'conflict', retryDisposition: 'after-refresh', repairActions: [{ reason: '另一个本机审阅写入正在进行；重新读取审阅终态后，以相同回执重试。' }] },
  REVIEW_TERMINAL_ALREADY_SET: { category: 'conflict', retryDisposition: 'never', repairActions: [terminalAction('该审阅已存在不同的最终结果；重新打开并显示现有的人类回执，不得覆盖。')] },
};

export const AUTHORING_ERROR_CATALOG: Readonly<Record<AuthoringErrorCode, AuthoringErrorDefinition>> = Object.fromEntries(
  AUTHORING_ERROR_CODES.map((code) => [code, { code, ...defaultDefinitions[code] }]),
) as Record<AuthoringErrorCode, AuthoringErrorDefinition>;

export function errorDefinition(code: AuthoringErrorCode): AuthoringErrorDefinition {
  return AUTHORING_ERROR_CATALOG[code];
}

function isAuthoringErrorCode(value: string): value is AuthoringErrorCode {
  return (AUTHORING_ERROR_CODES as readonly string[]).includes(value);
}

export interface NormalizedAuthoringError extends EnvelopeErrorShape {
  code: AuthoringErrorCode;
  category: ErrorCategory;
  retryDisposition: RetryDisposition;
  repairActions: RepairAction[];
}

export function normalizeAuthoringError(error: unknown): NormalizedAuthoringError {
  const sourceCode = error instanceof AuthoringOperationError
    ? error.code
    : typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined;
  const code: AuthoringErrorCode = sourceCode !== undefined && isAuthoringErrorCode(sourceCode)
    ? sourceCode
    : 'INVALID_REQUEST';
  const definition = errorDefinition(code);
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof AuthoringOperationError
    ? error.details
    : typeof error === 'object' && error !== null && 'details' in error && typeof error.details === 'object' && error.details !== null && !Array.isArray(error.details)
      ? error.details as Record<string, unknown>
      : undefined;
  return {
    code,
    category: definition.category,
    message,
    ...(details === undefined ? {} : { details }),
    retryDisposition: definition.retryDisposition,
    repairActions: definition.repairActions.map((item) => ({
      ...item,
      ...(item.requiredFreshFacts === undefined ? {} : { requiredFreshFacts: [...item.requiredFreshFacts] }),
    })),
  };
}

function envelopeBaseSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      schemaVersion: { const: AUTHORING_ENVELOPE_SCHEMA_VERSION },
      contractVersion: { const: AUTHORING_CONTRACT_VERSION },
      sessionId: { type: 'string' },
      capability: { type: 'string' },
      projectIdentity: { type: 'string' },
      projectRevision: { type: 'string' },
      changeId: { type: 'string' },
      workingRevision: { type: 'integer' },
      operationId: { type: 'string' },
    },
  };
}

export function createSuccessEnvelope<T>(context: EnvelopeContext, result: T): AuthoringEnvelope<T> {
  return {
    ...context,
    schemaVersion: AUTHORING_ENVELOPE_SCHEMA_VERSION,
    contractVersion: AUTHORING_CONTRACT_VERSION,
    ok: true,
    result,
  };
}

export function createFailureEnvelope(context: EnvelopeContext, error: unknown): AuthoringEnvelope<never> {
  return {
    ...context,
    schemaVersion: AUTHORING_ENVELOPE_SCHEMA_VERSION,
    contractVersion: AUTHORING_CONTRACT_VERSION,
    ok: false,
    error: normalizeAuthoringError(error),
  };
}

export function createEnvelopeJsonSchema(resultSchema: JsonSchema): JsonSchema {
  const base = envelopeBaseSchema();
  const baseProperties = base.properties as Record<string, JsonSchema>;
  const errorSchema: JsonSchema = {
    type: 'object',
    properties: {
      code: { enum: [...AUTHORING_ERROR_CODES] },
      category: { enum: ['request', 'not-found', 'conflict', 'validation', 'runtime', 'commit'] },
      message: { type: 'string' },
      details: { type: 'object', patternProperties: { '^.*$': jsonObjectValueSchema }, additionalProperties: false },
      retryDisposition: { enum: ['same-request', 'after-inspect', 'after-refresh', 'after-repair', 'after-human-review', 'new-change', 'manual-recovery', 'never'] },
      repairActions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            capability: { type: 'string' },
            reason: { type: 'string' },
            requiredFreshFacts: { type: 'array', items: { type: 'string' } },
            inputTemplate: { type: 'object', patternProperties: { '^.*$': jsonObjectValueSchema }, additionalProperties: false },
            terminal: { type: 'boolean' },
          },
          required: ['reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['code', 'category', 'message', 'retryDisposition', 'repairActions'],
    additionalProperties: false,
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    oneOf: [
      {
        type: 'object',
        properties: { ...baseProperties, ok: { const: true }, result: resultSchema },
        required: ['schemaVersion', 'contractVersion', 'sessionId', 'capability', 'projectIdentity', 'ok', 'result'],
        additionalProperties: false,
      },
      {
        type: 'object',
        properties: { ...baseProperties, ok: { const: false }, error: errorSchema },
        required: ['schemaVersion', 'contractVersion', 'sessionId', 'capability', 'projectIdentity', 'ok', 'error'],
        additionalProperties: false,
      },
    ],
  };
}
