import { test } from 'vitest';
import assert from 'node:assert/strict';
import {createReviewApplyClient} from '../src/review-apply-client.js';
const approvalRef={resultReviewId:'result',approvalId:'approval',approvalFingerprint:'fp'};
const req={protocolVersion:'1.0.0',action:'inspect-approved-application',approvalRef};
const ready={protocolVersion:'1.0.0',approvalRef,projectIdentity:'p',integrationChangeId:'c',targetDisplayName:'project',targetPath:'D:/fixture',changedPaths:[],phase:'ready',canWrite:true,blockers:[],currentProject:'matches-approved-base'};
const respond=result=>new Response(JSON.stringify({ok:true,result}));
test('client uses same-origin token and never sends target path',async()=>{
 let calls=0;
 const c=createReviewApplyClient({token:'local-test-token-123456',fetch:async(url,init)=>{
  calls++;
  assert.equal(url,'/__surdet/review-authority/v1/apply-approved-result');
  assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');
  assert.equal(init.headers['x-surdet-review-authority'],'local-test-token-123456');
  assert.equal(JSON.parse(init.body).targetPath,undefined);return respond(ready);
 }});
 assert.equal((await c.execute(req)).phase,'ready');assert.equal(calls,1);
});
test('client does not retry a failed write transport',async()=>{
 let calls=0;const c=createReviewApplyClient({token:'local-test-token-123456',fetch:async()=>{calls++;throw new Error('connection closed');}});
 await assert.rejects(c.execute({...req,action:'write-approved-result'}));assert.equal(calls,1);
});
test('client rejects foreign review response',async()=>{
 const c=createReviewApplyClient({token:'local-test-token-123456',fetch:async()=>respond({...ready,approvalRef:{...approvalRef,approvalId:'foreign'}})});
 await assert.rejects(c.execute(req));
});
test('client rejects canWrite=true on unknown outcome',async()=>{
 const c=createReviewApplyClient({token:'local-test-token-123456',fetch:async()=>respond({...ready,phase:'unknown'})});
 await assert.rejects(c.execute(req));
});
