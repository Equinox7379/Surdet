import {createHash,randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {loadProjectSnapshot,beginChange,InMemoryChangeRepository,inspectTextCatalog,applyTextCatalogPatch,assertTextCatalogTargetRemovable} from '@surdet/authoring';
import {isStoryTextSource} from '@surdet/core';
import {NodeProjectStorage} from '../../cli/src/authoring/node-project-storage.js';
import {openAssetImportAuthorityPaths} from '../../cli/src/asset-import-authority/filesystem.js';
import {ProjectSceneLifecycleAuthority} from '../../cli/src/asset-import-authority/scene-lifecycle-authority.js';
import {state} from '../src/state.js';
import {histories} from '../src/history.js';
import {editSceneLabel,bindLabelEditingHooks} from '../src/label-editing.js';
import {deleteSceneAtKey,bindFlowHooks} from '../src/panels/flow.js';
import {bindProjectIoHooks} from '../src/project-io.js';
const roots:string[]=[];
const original={...state},originalHandles={...state.handles};
const hash=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const hasher={sha256:async(s:string)=>hash(s)};
const body='@scene bound\n@label opening\n旁白：保持译稿。\n@end\n';
async function fixture(){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'surdet-p6a-lifecycle-audit-'));roots.push(dir);const project=path.join(dir,'project'),dataRoot=path.join(dir,'data');
 await fs.mkdir(path.join(project,'content/scenario'),{recursive:true});await fs.mkdir(dataRoot);
 await fs.writeFile(path.join(project,'content/scenario/bound.gal'),body);await fs.writeFile(path.join(project,'content/scenario/home.gal'),'@scene home\n主入口。\n@end\n');
 await fs.writeFile(path.join(project,'game.config.json'),'{"entryScene":"home","variables":{},"future":"preserve"}');
 const storage=await NodeProjectStorage.open(project);const snapshot=await loadProjectSnapshot(storage,hasher);const change=await beginChange(snapshot,new InMemoryChangeRepository());change.record.composition!.mode='direct';const view=await inspectTextCatalog(snapshot,hasher);
 await applyTextCatalogPatch(change,{operationId:'enroll',expectedFingerprint:view.fingerprint,expectedRevision:view.revision,patch:{type:'bind',sourceLocale:'zh-CN',bindings:[{key:'bound.greeting',sourceId:view.sources.find(s=>isStoryTextSource(s)&&s.sceneId==='bound')!.sourceId}]}},hasher);
 const config=change.record.workingFiles['game.config.json']!;await fs.writeFile(path.join(project,'game.config.json'),config);
 const paths=await openAssetImportAuthorityPaths({projectRoot:project,dataRoot});const authority=new ProjectSceneLifecycleAuthority(paths,{assertLeaseHeld:()=>undefined});
 const file=(p:string)=>({name:path.basename(p),getFile:async()=>new File([await fs.readFile(path.join(project,p))],path.basename(p))}) as FileSystemFileHandle;
 Object.assign(state,{dirHandle:{name:'audit'},dirName:'audit',gameConfigText:config,entryScene:'home',handles:{...originalHandles,gameConfig:file('game.config.json'),gallery:null},
  scenes:new Map([['bound',{id:'bound',file:'bound.gal',text:body,eol:'\n',dirty:false,handle:file('content/scenario/bound.gal'),persistedSha256:hash(body)}],['home',{id:'home',file:'home.gal',text:'@scene home\n主入口。\n@end\n',eol:'\n',dirty:false,handle:file('content/scenario/home.gal')}]]),current:'bound',
  pendingSceneDeletes:[],pendingSceneCommit:null,pendingSceneConfigWrites:[],pendingSceneConfigRenames:[],configReadErrors:{},projectLoading:false,projectWriteLock:null,reviewWorkspace:null,reviewPreviewReadOnly:false,
  configFiles:{events:null,growth:null,calendar:null,gallery:null,achievements:null,terminology:null}});
 bindProjectIoHooks({renderAll:()=>{},runValidate:()=>{},renderSidebar:()=>{},onSceneMutationPlan:async request=>{const plan=await authority.plan({operationId:randomUUID(),...request});return{operationId:plan.operationId,planFingerprint:plan.planFingerprint}}});
 return{project,config,authority};
}
beforeEach(()=>{vi.stubGlobal('document',{getElementById:()=>null});vi.stubGlobal('window',{confirm:()=>true});bindLabelEditingHooks({prepareConfig:()=>()=>{},onEdited:()=>{}});bindFlowHooks({openScene:()=>{},requestValidate:()=>{}});histories.clear();});
afterEach(async()=>{Object.assign(state,original);state.handles={...originalHandles};histories.clear();vi.unstubAllGlobals();for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
describe('actual scene authority receives Editor catalog lifecycle batches',()=>{
 it('rejects an omitted catalog write, then commits the complete Editor rename batch',async()=>{
  const f=await fixture();await editSceneLabel('bound',1,'@label opening','arrival');const request={requestId:randomUUID(),plans:[],configRenames:state.pendingSceneConfigRenames,writes:[{path:'content/scenario/bound.gal',text:state.scenes.get('bound')!.text,expectedSha256:hash(body)},...state.pendingSceneConfigWrites]};
  let failure:unknown;try{await f.authority.commit({...request,writes:request.writes.filter(write=>write.path!=='game.config.json')})}catch(e){failure=e}
  expect(String(failure)).toContain('配置必须完整提交');expect(await fs.readFile(path.join(f.project,'content/scenario/bound.gal'),'utf8')).toBe(body);expect(await fs.readFile(path.join(f.project,'game.config.json'),'utf8')).toBe(f.config);
  expect((await f.authority.commit({...request,requestId:randomUUID()})).status).toBe('COMMITTED');expect(JSON.parse(await fs.readFile(path.join(f.project,'game.config.json'),'utf8')).textCatalog.entries[0].source.label).toBe('arrival');
  const reopened = await loadProjectSnapshot(await NodeProjectStorage.open(f.project), hasher);
  expect((await inspectTextCatalog(reopened, hasher)).entries[0]!.status).toBe('needs-rebind');
 });
 it('rejects human deletion of a catalog-referenced scene before planning and committing its removal',async()=>{
  const f=await fixture();expect(()=>assertTextCatalogTargetRemovable(JSON.parse(f.config),'bound')).toThrow('文本目录');const before=body;
  await expect(deleteSceneAtKey('bound')).rejects.toThrow('文本目录');
  const exists=await fs.readFile(path.join(f.project,'content/scenario/bound.gal'),'utf8').catch(()=>null);
  expect(state.scenes.has('bound')).toBe(true);expect(state.pendingSceneDeletes).toEqual([]);
  expect(await fs.readFile(path.join(f.project,'game.config.json'),'utf8')).toBe(f.config);
  expect(exists,'A catalog-referenced scene must be rejected before the normal physical deletion path').toBe(before);
 });
 it('rechecks catalog enrollment after a delete plan and permits deletion only after explicit removal',async()=>{
  const f=await fixture();
  const cleared=JSON.parse(f.config);cleared.textCatalog.entries=[];
  await fs.writeFile(path.join(f.project,'game.config.json'),JSON.stringify(cleared));
  state.gameConfigText=JSON.stringify(cleared);
  await deleteSceneAtKey('bound');
  const plan=state.pendingSceneDeletes[0]!;
  const request={requestId:randomUUID(),plans:[{operationId:plan.operationId!,planFingerprint:plan.planFingerprint!}],writes:[]};
  await fs.writeFile(path.join(f.project,'game.config.json'),f.config);
  await expect(f.authority.commit(request)).rejects.toThrow('文本目录');
  expect(await fs.readFile(path.join(f.project,'content/scenario/bound.gal'),'utf8')).toBe(body);
  await fs.writeFile(path.join(f.project,'game.config.json'),JSON.stringify(cleared));
  expect((await f.authority.commit(request)).status).toBe('COMMITTED');
  await expect(fs.readFile(path.join(f.project,'content/scenario/bound.gal'))).rejects.toMatchObject({code:'ENOENT'});
 });
});
