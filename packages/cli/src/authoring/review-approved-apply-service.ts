import {
  assertBoundInspection, assertCommitMatches, parseReviewApplyRequest, sameBinding, isReviewApplyTargetError,
  statusFromInspection, ReviewApplyError,
  type ApprovedApplyInspection, type ApprovedResultBinding, type BoundProjectScope,
  type DurableCommitFact, type ReviewApprovalReference, type ReviewApplyStatus,
} from '@surdet/authoring';

/** The adapter MUST read the existing change and commit journal in this explicit scope.
 * inspect must support terminal records without treating the changed post-commit base
 * as a failed approval. commit must retain the original approval/lease/CAS gates.
 * No new journal, apply receipt, project copy, or caller-controlled path is permitted.
 */
export interface ReviewApprovedApplyBackend {
  readonly scope: BoundProjectScope;
  inspect(ref:ReviewApprovalReference):Promise<ApprovedApplyInspection>;
  commit(binding:ApprovedResultBinding):Promise<DurableCommitFact>;
}

export class ReviewApprovedApplyService {
  private readonly backend:ReviewApprovedApplyBackend;
  /** Coalesces same-process clicks only. Existing domain leases protect other processes. */
  private readonly pending=new Map<string,Promise<ReviewApplyStatus>>();
  constructor(backend:ReviewApprovedApplyBackend){this.backend=backend;}
  private async inspect(ref:ReviewApprovalReference):Promise<ApprovedApplyInspection>{
    const s=await this.backend.inspect(ref);
    assertBoundInspection(this.backend.scope,ref,s);
    return s;
  }
  async execute(raw:unknown):Promise<ReviewApplyStatus>{
    const request=parseReviewApplyRequest(raw);
    switch (request.action) {
      case 'inspect-approved-application':
        return statusFromInspection(await this.inspect(request.approvalRef));
      case 'write-approved-result': {
        const key=JSON.stringify([request.approvalRef.resultReviewId,request.approvalRef.approvalId,request.approvalRef.approvalFingerprint]);
        const old=this.pending.get(key);
        if(old!==undefined)return old;
        const work=this.write(request.approvalRef);
        this.pending.set(key,work);
        try{return await work;}finally{if(this.pending.get(key)===work)this.pending.delete(key);}
      }
      default:
        // A new or malformed action must never inherit write permission.
        throw new ReviewApplyError('INVALID_REQUEST','未知写回动作，未执行项目写入。');
    }
  }
  private async write(ref:ReviewApprovalReference):Promise<ReviewApplyStatus>{
    const before=await this.inspect(ref);
    const beforeStatus=statusFromInspection(before);
    if(!beforeStatus.canWrite)return beforeStatus;
    let acknowledged:DurableCommitFact|undefined;
    let failure:unknown;
    try {
      acknowledged=await this.backend.commit(before.binding);
      assertCommitMatches(this.backend.scope,before.binding,acknowledged);
    } catch(error){failure=error;}
    // An identity failure is never converted into success, even if unrelated state changed.
    if(isReviewApplyTargetError(failure))throw failure;
    try {
      const after=await this.inspect(ref);
      if(!sameBinding(before.binding,after.binding))
        throw new ReviewApplyError('REVIEW_IDENTITY_MISMATCH','检查过程中批准结果身份发生变化。');
      if(after.writeState==='committed')return statusFromInspection(after);
      if(acknowledged!==undefined) {
        // A verified durable success cannot be demoted by a stale/failed subsequent read.
        const status=this.acknowledged(before,acknowledged);
        return {...status,blockers:after.writeState==='unknown'
          ? after.blockers.filter(isReviewApplyTargetError)
          : [{code:'RECOVERY_AMBIGUOUS',message:'项目已写入，但当前事务状态与提交记录不一致，请重新检查后再加载。'}]};
      }
      const status=statusFromInspection(after);
      if(status.phase==='ready' && failure!==undefined) {
        // Journal-confirmed unwritten permits a NEW explicit user retry; never auto-retry here.
        return {...status,phase:'blocked',canWrite:false,blockers:[{
          code:'WRITE_NOT_APPLIED',message:'已确认本次尚未写入。检查状态并处理提示后，可以再次明确点击写回。',
        }]};
      }
      return status;
    } catch(readError) {
      if(isReviewApplyTargetError(readError)) {
        if(acknowledged!==undefined) return { ...this.acknowledged(before,acknowledged), blockers:[{
          code: (readError as {code:string}).code, message:'项目已写入，但目标状态需要核对，暂不加载或进入编辑。',
        }] };
        throw readError;
      }
      if(acknowledged!==undefined)return this.acknowledged(before,acknowledged);
      return {...beforeStatus,phase:'unknown',canWrite:false,blockers:[{
        code:'WRITE_OUTCOME_UNKNOWN',message:'写回结果暂未确认。请检查写入状态；不要重复提交，也不要把预览文件复制到项目。',
      }]};
    }
  }
  private acknowledged(before:ApprovedApplyInspection,commit:DurableCommitFact):ReviewApplyStatus{
    return {...statusFromInspection(before),phase:'written',canWrite:false,blockers:[],
      currentProject:'unknown',commit:{...commit,coordination:commit.coordination==='written'?'written':'warning',
        coordinationMessage:commit.coordinationMessage??'项目已写入；当前工作区状态需要重新读取。'}};
  }
}
