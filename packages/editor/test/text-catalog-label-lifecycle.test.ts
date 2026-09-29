import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {loadProjectSnapshot,inspectTextCatalog,beginChange,InMemoryChangeRepository,applyTextCatalogPatch,editProjectLabel,applyConfigReferenceRename} from '@surdet/authoring';
import {state} from '../src/state.js';
import {editSceneLabel,bindLabelEditingHooks} from '../src/label-editing.js';
import {bindProjectIoHooks,sceneTextSha256,prepareSceneConfigRecovery} from '../src/project-io.js';
import {histories} from '../src/history.js';
const original={...state},originalHandles={...state.handles};
const text='@scene start\n@label opening\n旁白：你好。\n@end\n';
async function fixture(bound=true, sourceText=text){
 const hasher={sha256:sceneTextSha256};const files:Record<string,string>={'game.config.json':'{"entryScene":"start","variables":{},"future":19}','content/scenario/start.gal':sourceText};
 const storage={rootIdentity:'audit',listFiles:async()=>Object.keys(files),exists:async(p:string)=>Object.hasOwn(files,p),readText:async(p:string)=>({path:p,text:files[p]!,bytes:Buffer.byteLength(files[p]!),sha256:await sceneTextSha256(files[p]!)})};
 const snapshot=await loadProjectSnapshot(storage,hasher);const session=await beginChange(snapshot,new InMemoryChangeRepository());session.record.composition!.mode='direct';
 const view=await inspectTextCatalog(snapshot,hasher);
 if(bound)await applyTextCatalogPatch(session,{operationId:'bind',expectedRevision:view.revision,expectedFingerprint:view.fingerprint,patch:{type:'bind',sourceLocale:'zh-CN',bindings:view.sources.map((source,index)=>({key:`text.${index}`,sourceId:source.sourceId}))}},hasher);
 const config=session.record.workingFiles['game.config.json']!;
 const handle={name:'start.gal',getFile:async()=>new File([sourceText],'start.gal')} as FileSystemFileHandle;
 Object.assign(state,{scenes:new Map([['start',{id:'start',file:'start.gal',text:sourceText,eol:'\n',dirty:false,handle,persistedSha256:await sceneTextSha256(sourceText)}]]),current:'start',dirHandle:{name:'audit'},dirName:'audit',gameConfigText:config,
  handles:{...originalHandles,gameConfig:{getFile:async()=>new File([config],'game.config.json')} as FileSystemFileHandle,gallery:null},
  pendingSceneCommit:null,pendingSceneDeletes:[],pendingSceneConfigWrites:[],pendingSceneConfigRenames:[],configReadErrors:{},projectLoading:false,projectWriteLock:null,reviewWorkspace:null,reviewPreviewReadOnly:false,
  configFiles:{events:null,growth:null,calendar:null,gallery:null,achievements:null,terminology:null}});
 return {config,files:{...files,'game.config.json':config},snapshot:()=>JSON.stringify({text:state.scenes.get('start')?.text,config:state.gameConfigText,history:[...histories],writes:state.pendingSceneConfigWrites,renames:state.pendingSceneConfigRenames})};
}
beforeEach(()=>{vi.stubGlobal('document',{getElementById:()=>null});bindProjectIoHooks({renderAll:()=>{},runValidate:()=>{},renderSidebar:()=>{}});bindLabelEditingHooks({prepareConfig:()=>()=>{},onEdited:()=>{}});histories.clear();});
afterEach(()=>{Object.assign(state,original);state.handles={...originalHandles};histories.clear();vi.unstubAllGlobals();});
describe('text catalog references in Editor label lifecycle',()=>{
 it('rejects deleting a catalog-referenced label before changing the draft',async()=>{const f=await fixture();expect(()=>editProjectLabel(f.files,'start','opening')).toThrow('文本目录');const before=f.snapshot();let error:unknown;try{await editSceneLabel('start',1,'@label opening')}catch(e){error=e}
 expect(error,'The human label consumer must pass the same catalog that blocks the shared operation').toBeDefined();expect(f.snapshot()).toBe(before);
 });
 it('renames catalog label references and includes their config write in the same existing batch',async()=>{const f=await fixture();await editSceneLabel('start',1,'@label opening','arrival');const expected={...f.files};applyConfigReferenceRename(expected,{from:'opening',to:'arrival',labelScene:'start'},'start');
 let recovery:unknown;try{await prepareSceneConfigRecovery(state.pendingSceneConfigWrites,state.pendingSceneConfigRenames)}catch(e){recovery=e}
 expect(JSON.parse(state.gameConfigText).textCatalog.entries[0].source.label).toBe('arrival');
 expect(state.pendingSceneConfigWrites.find(w=>w.path==='game.config.json')?.text).toBe(expected['game.config.json']);expect(recovery).toBeUndefined();
 });
 it('keeps the original fingerprint through consecutive renames and rejects changed recovery sources',async()=>{
  const f=await fixture();
  const pending={path:'content/config/events.json',text:'{"events":[]}',expectedSha256:null};
  state.pendingSceneConfigWrites=[pending];
  await editSceneLabel('start',1,'@label opening','arrival');
  await editSceneLabel('start',1,'@label arrival','welcome');
  const root=state.pendingSceneConfigWrites.find(write=>write.path==='game.config.json')!;
  expect(root.expectedSha256).toBe(await sceneTextSha256(f.config));
  expect(JSON.parse(root.text).textCatalog.entries[0].source.label).toBe('welcome');
  expect(JSON.parse(root.text).future).toBe(19);
  expect(state.pendingSceneConfigWrites.find(write=>write.path===pending.path)).toEqual(pending);
  state.pendingSceneConfigWrites=state.pendingSceneConfigWrites.filter(write=>write!==pending);
  const restore=await prepareSceneConfigRecovery(state.pendingSceneConfigWrites,state.pendingSceneConfigRenames);
  state.gameConfigText=f.config;restore();
  expect(JSON.parse(state.gameConfigText).textCatalog.entries[0].source.label).toBe('welcome');
  state.handles.gameConfig={getFile:async()=>new File([f.config+' '],'game.config.json')} as FileSystemFileHandle;
  const before=f.snapshot();
  await expect(prepareSceneConfigRecovery(state.pendingSceneConfigWrites,state.pendingSceneConfigRenames)).rejects.toThrow();
  expect(f.snapshot()).toBe(before);
 });
 it('preserves the normal unreferenced label rename and delete paths',async()=>{await fixture(false);await editSceneLabel('start',1,'@label opening','arrival');expect(state.scenes.get('start')!.text).toContain('@label arrival');expect(state.pendingSceneConfigWrites).toEqual([]);await fixture(false);await editSceneLabel('start',1,'@label opening');expect(state.scenes.get('start')!.text).not.toContain('@label');});
 it('preserves dialogue/choice translations and versions, requiring explicit rebinding after rename',async()=>{
  const f=await fixture(true,'@scene start\n@label opening\n旁白：你好。\n@choice\n  留下 -> @goto opening\n  出发 -> @goto opening\n@end\n');
  const config=JSON.parse(f.config);
  for(const entry of config.textCatalog.entries)entry.translations.en={value:`Translation ${entry.key}`,sourceVersion:entry.source.version};
  const sourceConfig=JSON.stringify(config);state.gameConfigText=sourceConfig;
  state.handles.gameConfig={getFile:async()=>new File([sourceConfig],'game.config.json')} as FileSystemFileHandle;
  await editSceneLabel('start',1,'@label opening','arrival');
  const entries=JSON.parse(state.gameConfigText).textCatalog.entries;
  expect(entries.map((entry:any)=>entry.source.kind)).toEqual(['dialogue','choice','choice']);
  expect(entries).toEqual(config.textCatalog.entries.map((entry:any)=>({...entry,source:{...entry.source,label:'arrival'}})));
  const files={'game.config.json':state.gameConfigText,'content/scenario/start.gal':state.scenes.get('start')!.text};
  const hasher={sha256:sceneTextSha256};
  const snapshot=await loadProjectSnapshot({rootIdentity:'reopened',listFiles:async()=>Object.keys(files),exists:async p=>Object.hasOwn(files,p),readText:async p=>({path:p,text:files[p as keyof typeof files],bytes:Buffer.byteLength(files[p as keyof typeof files]),sha256:await sceneTextSha256(files[p as keyof typeof files])})},hasher);
  const view=await inspectTextCatalog(snapshot,hasher);
  expect(view.entries.map(entry=>entry.status)).toEqual(['needs-rebind','needs-rebind','needs-rebind']);
  const change=await beginChange(snapshot,new InMemoryChangeRepository());change.record.composition!.mode='direct';
  await applyTextCatalogPatch(change,{operationId:'rebind',expectedRevision:view.revision,expectedFingerprint:view.fingerprint,patch:{type:'bind',sourceLocale:'zh-CN',bindings:view.sources.map((source,index)=>({key:`text.${index}`,sourceId:source.sourceId}))}},hasher);
  const confirmed=JSON.parse(change.record.workingFiles['game.config.json']!).textCatalog.entries;
  expect(confirmed.map((entry:any)=>entry.translations)).toEqual(entries.map((entry:any)=>entry.translations));
  expect(confirmed.every((entry:any)=>entry.source.sceneVersion!==entries[0].source.sceneVersion)).toBe(true);
  expect(confirmed.every((entry:any)=>entry.source.version===entry.translations.en.sourceVersion)).toBe(true);
 });
});
