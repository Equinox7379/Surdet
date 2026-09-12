import { parseReviewApplyRequest, sameApproval, ReviewApplyError, type ReviewApplyRequest, type ReviewApplyStatus } from '@surdet/authoring';

const ROUTE='/__surdet/review-authority/v1/apply-approved-result';
const HEADER='x-surdet-review-authority';
function record(x:unknown):x is Record<string,unknown>{return typeof x==='object'&&x!==null&&!Array.isArray(x);}
function strings(x:unknown):x is string[]{return Array.isArray(x)&&x.every(v=>typeof v==='string');}
function validStatus(v:unknown,request:ReviewApplyRequest):v is ReviewApplyStatus{
  if(!record(v)||v.protocolVersion!=='1.0.0'||!record(v.approvalRef)
    ||typeof v.approvalRef.resultReviewId!=='string'||typeof v.approvalRef.approvalId!=='string'
    ||typeof v.approvalRef.approvalFingerprint!=='string'
    ||!sameApproval(v.approvalRef as unknown as ReviewApplyRequest['approvalRef'],request.approvalRef)
    ||typeof v.projectIdentity!=='string'||typeof v.integrationChangeId!=='string'
    ||typeof v.targetDisplayName!=='string'||typeof v.targetPath!=='string'||!strings(v.changedPaths)
    ||typeof v.phase!=='string'||!['ready','blocked','writing','written','unknown','recovery-required'].includes(v.phase)
    ||typeof v.canWrite!=='boolean'||v.canWrite!==(v.phase==='ready')
    ||(v.retryAfterMs!==undefined && (typeof v.retryAfterMs!=='number'||!Number.isSafeInteger(v.retryAfterMs)||v.retryAfterMs<0))
    ||typeof v.currentProject!=='string'||!['matches-approved-base','matches-commit','changed-after-commit','unknown'].includes(v.currentProject)
    ||!Array.isArray(v.blockers)||!v.blockers.every(b=>record(b)&&typeof b.code==='string'&&typeof b.message==='string'))return false;
  if(v.phase==='written'){
    const c=v.commit;
    if(!record(c)||c.projectIdentity!==v.projectIdentity||c.changeId!==v.integrationChangeId
      ||!record(c.binding)||!record(c.binding.approvalRef)||!strings(c.changedPaths)
      ||typeof c.coordination!=='string'||!['written','warning','not-observed'].includes(c.coordination))return false;
  }
  return true;
}
/** Existing same-origin token is supplied in memory. No retry loop and no localStorage token. */
export function createReviewApplyClient(input:{token:string;fetch?:typeof fetch}):{
  execute(request:ReviewApplyRequest):Promise<ReviewApplyStatus>;
}{
  if(input.token.length<16)throw new Error('本机审阅服务尚未建立有效连接。');
  const fetcher=input.fetch??globalThis.fetch;
  return {async execute(raw){
    // Reuse the same strict parser before network I/O; the server still validates independently.
    const request=parseReviewApplyRequest(raw);
    const response=await fetcher(ROUTE,{
      method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
      headers:{'Content-Type':'application/json',[HEADER]:input.token},body:JSON.stringify(request),
    });
    const body:unknown=await response.json();
    if(!response.ok||!record(body)||body.ok!==true){
      const code=record(body)&&record(body.error)&&typeof body.error.code==='string'?body.error.code:'REVIEW_APPLY_UNAVAILABLE';
      throw new ReviewApplyError(code, `本机审阅写回服务暂不可用（${code}）。请检查状态，不要复制文件替代写回。`);
    }
    if(!validStatus(body.result,request))throw new ReviewApplyError('REVIEW_IDENTITY_MISMATCH', '写回状态格式或审阅身份不匹配。');
    return body.result;
  }};
}
