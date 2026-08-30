import type {
  HumanReviewProjection,
  ReviewConflict,
  ReviewUnitOutcome,
  ReviewUnitPresentation,
} from '@surdet/authoring';

export interface ReviewDecisionDraftModel {
  selectedUnitIds: string[];
  conflictResolutions: Array<{
    conflictId: string;
    resolution: 'choose-unit' | 'exclude-all' | 'regenerate-candidate';
    chosenUnitId?: string;
  }>;
}

const OBJECT_KIND_LABELS: Record<string, string> = {
  scene: '场景',
  timeline: '时间轴',
  variable: '变量',
  character: '角色',
  'entry-scene': '入口场景',
  label: '标签',
  asset: '素材',
  track: '轨道',
  cue: 'Cue',
};

const REVIEW_STATE_LABELS: Record<string, string> = {
  COMPARISON_PREPARED: '比较结果已准备',
  DECISION_DRAFT: '正在填写决定',
  DECIDED: '决定已保存',
  PLAN_PREPARED: '计划已准备',
  STAGE_READY: '结果已准备，请检查',
  OWNER_APPROVED: '项目所有者已批准',
  APPLY_PENDING: '等待显式应用',
  COMMITTED: '已提交到隔离项目',
  RETURNED: '已退回修改',
  STALE: '已过期，需要刷新',
  INVALID: '审阅包无效',
};

const CONFLICT_SEVERITY_LABELS: Record<string, string> = {
  blocking: '当前无法继续',
  'selection-required': '需要你决定',
  advisory: '建议留意',
  identical: '多个方案结果相同',
};

const FRESHNESS_LABELS: Record<string, string> = {
  fresh: '新鲜',
  stale: '过期',
  missing: '缺失',
  failed: '失败',
  incomplete: '不完整',
};

const DISPOSITION_LABELS: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  remove: '删除',
  unchanged: '不变',
};

export function labelForObjectKind(kind: string): string {
  return OBJECT_KIND_LABELS[kind] ?? '对象';
}

export function labelForReviewState(state: string): string {
  return REVIEW_STATE_LABELS[state] ?? '审阅状态未知';
}

export function labelForConflictSeverity(severity: string): string {
  return CONFLICT_SEVERITY_LABELS[severity] ?? '需要查看详情';
}

export function labelForUnknownCode(code: string): string {
  return code.length === 0 ? '未识别的问题（查看技术详情）' : '未识别的问题（查看技术详情）';
}

/** 把稳定 objectRef 转成面向人的短标签；原始 ref 仍可放在技术详情中。 */
export function labelForObjectRef(objectRef: string): string {
  const separator = objectRef.indexOf(':');
  if (separator < 0) return `对象 ${objectRef}`;
  const kind = objectRef.slice(0, separator);
  const semanticId = objectRef.slice(separator + 1);
  return `${labelForObjectKind(kind)} ${semanticId}`;
}

/** displayOrdinal 是审阅包给出的动态映射，不能从 candidateId 猜方案字母。 */
export function labelForCandidate(
  projection: HumanReviewProjection,
  candidateId: string | undefined,
): string {
  if (candidateId === undefined) return '未知方案';
  const candidate = projection.candidates.find((item) => item.candidateId === candidateId);
  return candidate === undefined ? '未知方案' : `方案 ${candidate.displayOrdinal}`;
}

export function labelForFreshness(value: string): string {
  return FRESHNESS_LABELS[value] ?? '未知';
}

export function labelForDisposition(value: string): string {
  return DISPOSITION_LABELS[value] ?? '变更';
}

/** 旧 v1 payload 没有 presentation；Editor 只明确降级，不从对象或文件猜内容。 */
export function presentationForReviewUnit(unit: ReviewUnitOutcome): ReviewUnitPresentation {
  if (unit.presentation !== undefined) {
    return {
      ...unit.presentation,
      highlights: [...unit.presentation.highlights],
    };
  }
  return {
    actionLabel: '内容摘要不足',
    objectLabel: labelForObjectRef(unit.primaryObject),
    highlights: [],
    completeness: 'metadata-only',
    omittedFactCount: 0,
  };
}

function resolutionIsAllowed(conflict: ReviewConflict, draft: ReviewDecisionDraftModel): boolean {
  const resolutions = draft.conflictResolutions.filter((item) => item.conflictId === conflict.conflictId);
  if (resolutions.length !== 1) return false;
  const resolution = resolutions[0]!;
  if (!conflict.allowedResolutions.includes(resolution.resolution)) return false;
  if (resolution.resolution === 'regenerate-candidate') return false;
  if (resolution.resolution === 'choose-unit') {
    return resolution.chosenUnitId !== undefined
      && conflict.unitIds.includes(resolution.chosenUnitId)
      && draft.selectedUnitIds.includes(resolution.chosenUnitId);
  }
  return resolution.chosenUnitId === undefined;
}

/** 只判断 UI 是否可以封存决定；最终领域验证仍由 shared authoring 完成。 */
export function canSealDecision(
  projection: HumanReviewProjection,
  draft: ReviewDecisionDraftModel,
): boolean {
  if (projection.kind !== 'comparison' || !projection.evidence.canCreateDecision) return false;
  if (projection.conflicts.some((conflict) => conflict.severity === 'blocking')) return false;
  return projection.conflicts
    .filter((conflict) => conflict.severity === 'selection-required')
    .every((conflict) => resolutionIsAllowed(conflict, draft));
}
