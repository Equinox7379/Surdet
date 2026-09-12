import type { ReviewApplyViewState } from './review-apply-controller.js';
export interface ReviewApplyActions {check():Promise<void>;write():Promise<void>;synchronize():Promise<void>;continueWriting():Promise<void>;}
// Remember only focus displaced by our own pending render, never focus outside this section.
const displacedFocus=new WeakMap<HTMLElement,string>();
/** Append below the saved approval, inside the existing result review. Not a new screen. */
export function renderReviewApplySection(host:HTMLElement,state:ReviewApplyViewState,actions:ReviewApplyActions):void {
  const focused=(document.activeElement instanceof HTMLElement && host.contains(document.activeElement))
    ?document.activeElement.dataset.action
    :document.activeElement===document.body?displacedFocus.get(host):undefined;
  displacedFocus.delete(host);
  const section=document.createElement('section');section.className='review-section review-approved-apply';
  section.setAttribute('aria-labelledby','review-approved-apply-title');
  const add=(tag:string,text:string,className?:string)=>{const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;section.append(e);return e;};
  const phase=state.status?.phase;
  const title=add('h2',phase==='written'?'结果已写入项目':'把已批准结果写回项目');title.id='review-approved-apply-title';
  add('p','批准与写入是两步。这里仅写回这份结果原来绑定的项目，不覆盖预览目录，也不发布游戏。','review-section-intro');
  if(state.status){
    add('p',`目标项目：${state.status.targetDisplayName}`,'review-apply-target');
    add('p',state.status.targetPath,'review-apply-path');
    const details=document.createElement('details');const summary=document.createElement('summary');
    summary.textContent=`查看涉及的 ${state.status.changedPaths.length} 个文件`;details.append(summary);
    const ul=document.createElement('ul');for(const p of state.status.changedPaths){const li=document.createElement('li');li.textContent=p;ul.append(li);}details.append(ul);section.append(details);
  }
  const labels={ready:'已批准，尚未写入。',blocked:'尚未写入，需要先处理下列问题。',writing:'写入进行中，请勿重复提交。',written:'已确认写入。下一步是加载项目的新内容。',unknown:'写入结果尚未确认，只能先检查状态。','recovery-required':'存储层要求恢复处理。这里不会覆盖文件或自动重新提交。'};
  const writtenLabel=state.targetBlocked?'此前已确认写入；当前目标或存储状态仍需重新核对。'
    :state.continuation==='opening'?'已写入，正在打开剧本工作面……'
    :state.continuation==='failed'?'已写入；进入剧本尚未完成确认，请查看下方原因。'
    :state.sync==='checking'?'已写入，正在加载项目新内容……'
    :state.continuation==='opened'?'已写入，并已进入剧本工作面。'
    :state.sync==='synchronized'?'已写入并加载项目内容。'
    :labels.written;
  const status=add('p',state.request==='writing'?'正在写入项目……':state.request==='checking'?'正在核对写入状态……':phase==='written'?writtenLabel:phase?labels[phase]:'先核对批准结果与目标项目。');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  if(state.message){const warning=add('p',state.message,'review-warning');warning.setAttribute('role','status');}
  if(state.continuationMessage){
    const warning=add('p',state.continuationMessage,'review-warning');
    warning.setAttribute('role','alert');
    warning.dataset.role='continue-writing-error';
  }
  for(const b of state.status?.blockers??[])add('p',b.message,'review-warning');
  if(state.status?.commit?.coordinationMessage)add('p',state.status.commit.coordinationMessage,'review-warning');
  if(state.status?.currentProject==='changed-after-commit')add('p','这份结果已经写入；项目之后还有新改动。加载时读取当前项目，不恢复成旧结果。','review-warning');
  const buttons=document.createElement('div');buttons.className='review-operations';
  const button=(text:string,id:string,disabled:boolean,run:()=>Promise<void>,primary=false)=>{
    const b=document.createElement('button');b.type='button';b.textContent=text;b.dataset.action=id;b.dataset.actionScope='workspace';b.disabled=disabled;
    if(primary)b.className='primary';b.onclick=()=>{void run();};buttons.append(b);
  };
  const busy=state.request!=='idle'||state.sync==='checking'||state.continuation==='opening';
  button('检查写入状态','inspect-approved-apply',busy,()=>actions.check());
  if(phase!=='written')button('写入这个项目','write-approved-result',busy||state.targetBlocked||state.status?.canWrite!==true,()=>actions.write(),true);
  else {
    button(state.sync==='synchronized'?'重新加载项目内容':'加载项目新内容','sync-approved-project',busy||state.targetBlocked,()=>actions.synchronize(),state.sync!=='synchronized');
    button(state.continuation==='failed'?'重试进入剧本':'回到剧本继续编辑','continue-approved-project',busy||state.targetBlocked||state.sync!=='synchronized',()=>actions.continueWriting(),state.sync==='synchronized');
  }
  section.append(buttons);host.replaceChildren(section);
  if(focused){
    const next=Array.from(host.querySelectorAll<HTMLButtonElement>('button[data-action]')).find(b=>b.dataset.action===focused);
    if(next?.disabled)displacedFocus.set(host,focused);
    else (next ?? host.querySelector<HTMLButtonElement>('button[data-action="sync-approved-project"]:not(:disabled)'))?.focus({preventScroll:true});
  }
}
