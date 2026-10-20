import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { createProject } from '../../cli/dist/new.js';
import { startDevProject } from '../scripts/dev-project.mjs';
import { createNodeFsBridge, nodeBackedFileSystemInit } from './asset-import-authority.e2e.mjs';
const output=process.env.SURDET_U3_REVIEW_OUTPUT ?? fs.mkdtempSync(path.join(os.tmpdir(),'surdet-ui-share-review-'));
const root=path.join(output,'project'); createProject('u3-review',{directory:root,template:'blank',title:'U3定向复核'});
const file=path.join(root,'game.config.json'), config=JSON.parse(fs.readFileSync(file));
const frame={x:0,y:0,width:1280,height:720}, text=value=>({kind:'literal',value});
config.variables={flag:{type:'flag',initial:false},amount:{type:'number',initial:5},note:{type:'string',initial:'original'}};
config.player={...config.player,firstRunHint:'U3首次操作提示'}; config.privateMarker='KEEP';
config.ui={version:1,pages:{title:{id:'original',type:'container',frame,children:[{id:'original-start',type:'button',frame:{x:80,y:80,width:200,height:50},text:text('原始开始'),action:{kind:'start'}}]},gallery:{id:'old-gallery',type:'container',frame}}};
fs.writeFileSync(file,JSON.stringify(config,null,2));
const sameImage=JSON.parse(fs.readFileSync(new URL('../../../docs/ui-theme-u3-technical/u3-technical.surdet-ui-theme.json',import.meta.url),'utf8')).assets[0].base64;
fs.mkdirSync(path.join(root,'content/assets/bg/nested'),{recursive:true});
fs.writeFileSync(path.join(root,'content/assets/bg/nested/same.png'),Buffer.from(sameImage,'base64'));
const packet={format:'surdet-ui',version:1,kind:'theme',variables:{flag:{type:'flag'},amount:{type:'number'},note:{type:'string'}},assets:[],config:{
  theme:{colors:{accent:0x123456}},fonts:{},player:{},ui:{version:1,pages:{
    title:{id:'source',type:'container',frame,children:[{id:'start',type:'button',frame:{x:100,y:100,width:220,height:60},text:text('开始游戏'),action:{kind:'start'}}]},
    settings:{id:'settings',type:'container',frame,children:[
      {id:'flag',type:'toggle',frame:{x:100,y:80,width:200,height:50},binding:{kind:'variable',name:'flag'}},
      {id:'amount',type:'slider',frame:{x:100,y:160,width:300,height:50},binding:{kind:'variable',name:'amount'}},
      {id:'note',type:'input',frame:{x:100,y:240,width:300,height:50},binding:{kind:'variable',name:'note'}},
    ]},
  }}}
};
const result={cases:[],errors:[]}; let server,browser,page;
const load=async p=>{ await p.locator('[data-action="open-project"]').click(); await p.waitForFunction(()=>!window.surdetEditorDebug.state.projectLoading && window.surdetEditorDebug.state.assetIntelligenceState==='ready'); await p.locator('[data-editor-mode="config"]').click(); await p.locator('[data-config-section-target="ui"]').click(); };
const choose=async value=>{ await page.locator('.ui-designer-toolbar input[type="file"]').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))}); await page.locator('[data-ui-share-import-apply]:not([disabled])').waitFor(); };
const close=async()=>{ if(await page.locator('.ui-player-preview').count()) await page.getByRole('button',{name:'关闭试玩',exact:true}).click(); if(await page.locator('[data-ui-share-import-dialog]').count()) await page.getByRole('button',{name:'取消',exact:true}).click(); };
const test=async(name,fn)=>{ try{await fn();result.cases.push({name,status:'passed'});}catch(error){result.cases.push({name,status:'failed',error:String(error.stack)});}finally{await close();} };
try{
  server=await startDevProject(['--project',root,'--data-root',path.join(output,'authority'),'--port','18088'],{registerSignals:false,cacheDir:path.join(output,'vite-cache')});
  browser=await chromium.launch({headless:true}); page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.on('pageerror',error=>result.errors.push(error.message));
  await page.exposeFunction('__surdetNodeFs',createNodeFsBridge({project:root})); await page.addInitScript(nodeBackedFileSystemInit,{initialRootKey:'project'});
  await page.goto('http://127.0.0.1:18088/'); await load(page);
  await test('恢复默认和继续默认的页面说明实际位于预览之上',async()=>{
    await choose(packet);await page.locator('[data-ui-share-import-frame][data-ready="true"]').waitFor();
    for(const view of ['gallery','backlog']) {
      await page.locator('[data-ui-share-import-view]').selectOption(view);
      const placeholder=page.locator('[data-ui-share-import-placeholder]');await placeholder.waitFor({state:'visible'});
      assert.match(await placeholder.innerText(),/使用 Player 默认页/);
      const top=await placeholder.evaluate(node=>{const r=node.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===node||node.contains(hit);});
      await page.screenshot({path:path.join(output,`default-${view}.png`)});
      assert.equal(top,true,'默认页说明被iframe遮住');
    }
    await page.locator('[data-ui-share-import-view]').selectOption('title');
    assert.equal(await page.locator('[data-ui-share-import-placeholder]').isHidden(),true);
    const f=await(await page.locator('[data-ui-share-import-frame]').elementHandle()).contentFrame();
    await f.getByRole('button',{name:'开始游戏',exact:true}).waitFor({state:'visible'});
  });
  await test('只读存档选项鉴赏条目不会显示操作失败',async()=>{
    const sample=structuredClone(packet);
    for(const [view,source] of [['save-load','save-slots'],['choices','choices'],['gallery','gallery-cgs']]) {
      sample.config.ui.pages[view]={id:`sample-${view}`,type:'container',frame,children:[{id:`rows-${view}`,type:'content',source,frame:{x:100,y:80,width:600,height:400}}]};
    }
    await choose(sample);await page.locator('[data-ui-share-import-frame][data-ready="true"]').waitFor();
    const f=await(await page.locator('[data-ui-share-import-frame]').elementHandle()).contentFrame();
    for(const [view,id] of [['save-load:load','save-load'],['choices','choices'],['gallery','gallery']]) {
      await page.locator('[data-ui-share-import-view]').selectOption(view);
      await f.locator(`[data-ui-node="rows-${id}"] [data-ui-item][aria-disabled="false"]`).first().click();
      await page.waitForFunction(()=>document.querySelector('[data-ui-share-import-note]')?.textContent?.includes('预览只读：未执行'));
      assert.equal(await f.locator('[data-ui-error]').count(),0,`${view}不应标记失败`);
      assert(!await f.locator('body').innerText().then(value=>value.includes('操作未完成')));
      assert(!await page.locator('[data-ui-share-import-note]').evaluate(node=>node.classList.contains('error')));
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),config);
  });
  await test('同ID组件的真实布局文字修改显示为整页替换',async()=>{
    const revised=structuredClone(packet);
    revised.config.ui.pages.title={id:'original',type:'container',frame,children:[{id:'original-start',type:'button',frame:{x:170,y:130,width:260,height:60},text:text('更新后的开始'),style:{background:0x663311},action:{kind:'start'}}]};
    await choose(revised);
    const row=page.locator('[data-ui-share-import-page="title"]');
    assert.equal(await row.getAttribute('data-change'),'replace');
    assert.match(await row.innerText(),/替换整页/);
    assert.match(await row.innerText(),/相同标识/);
    assert.doesNotMatch(await row.innerText(),/移除 0|加入 0/);
    const f=await(await page.locator('[data-ui-share-import-frame]').elementHandle()).contentFrame();
    await f.getByRole('button',{name:'更新后的开始',exact:true}).waitFor({state:'visible'});
    assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),config);
  });
  await test('原生只读控件在拒绝写入后恢复样本值',async()=>{
    await choose(packet); await page.locator('[data-ui-share-import-view]').selectOption('settings');
    const f=await (await page.locator('[data-ui-share-import-frame]').elementHandle()).contentFrame();
    await f.locator('[data-ui-node="flag"] input').click();
    await f.waitForFunction(()=>!document.querySelector('[data-ui-node="flag"] input').checked);
    const slider=f.locator('[data-ui-node="amount"] input');await slider.focus();await slider.press('ArrowRight');
    await f.waitForFunction(()=>document.querySelector('[data-ui-node="amount"] input').value==='5');
    const input=f.locator('[data-ui-node="note"] input');await input.fill('changed');await input.dispatchEvent('change');
    await f.waitForFunction(()=>document.querySelector('[data-ui-node="note"] input').value==='original',null,{timeout:1000});
  });
  await test('已有子目录同键图片与包内扁平图片只送入试玩一次',async()=>{
    const imageShare=structuredClone(packet);
    imageShare.assets=[{path:'content/assets/bg/same.png',base64:sameImage}];
    imageShare.config.ui.pages.title.style={backgroundImage:{asset:'same',fit:'stretch'}};
    await choose(imageShare);
    assert.equal(await page.locator('[data-ui-share-import-resource="content/assets/bg/same.png"]').getAttribute('data-state'),'present');
    await page.locator('[data-ui-share-import-player]').click();
    await page.waitForFunction(()=>document.querySelector('.ui-player-preview iframe')||document.querySelector('[data-ui-share-import-note]')?.classList.contains('error'));
    assert.equal(await page.locator('.ui-player-preview iframe').count(),1,await page.locator('[data-ui-share-import-note]').innerText());
    const f=await(await page.locator('.ui-player-preview iframe').elementHandle()).contentFrame();
    await f.getByRole('button',{name:'开始游戏',exact:true}).waitFor({timeout:10000}).catch(async error=>{throw new Error(`${error.message}; Player: ${await f.locator('#surdet-fatal-detail').textContent().catch(()=>f.locator('body').innerText())}`);});
    assert.equal(await f.locator('[data-ui-node="source"]').count(),1);
    assert(!fs.existsSync(path.join(root,'content/assets/bg/same.png')));
    assert.deepEqual(fs.readFileSync(path.join(root,'content/assets/bg/nested/same.png')),Buffer.from(sameImage,'base64'));
  });
  await test('导入试玩关闭后恢复首次操作提示的会话键',async()=>{
    for(const original of [null,'already-seen']) {
    await page.evaluate(value=>{if(value===null)sessionStorage.removeItem('surdet:controls-seen');else sessionStorage.setItem('surdet:controls-seen',value);},original);
    await choose(packet);await page.locator('[data-ui-share-import-player]').click();
    const f=await (await page.locator('.ui-player-preview iframe').elementHandle()).contentFrame();
    await f.getByRole('button',{name:'开始游戏',exact:true}).click();
    await page.waitForFunction(()=>sessionStorage.getItem('surdet:controls-seen')==='1');
    await page.getByRole('button',{name:'关闭试玩',exact:true}).click();
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('surdet:controls-seen')),original);
    await close();
    }
  });
  await test('同级试玩对话框拦截后台撤销快捷键',async()=>{
    await page.evaluate(async()=>{const c=await import('/src/panels/config.ts');c.editUiConfigDraft({type:'node.update',page:'title',id:'original',patch:{style:{opacity:.5}}});});
    await choose(packet);await page.locator('[data-ui-share-import-player]').click();
    const before=await page.evaluate(async()=>{const c=await import('/src/panels/config.ts');return {ui:c.readUiConfigDraft(),history:c.configHistoryDepth()};});
    await page.getByRole('button',{name:'关闭试玩',exact:true}).focus();await page.keyboard.press('Control+z');
    const source=fs.readFileSync(file,'utf8');await page.keyboard.press('Control+s');
    const after=await page.evaluate(async()=>{const c=await import('/src/panels/config.ts');return {ui:c.readUiConfigDraft(),history:c.configHistoryDepth()};});
    assert.deepEqual(after,before);
    assert.equal(fs.readFileSync(file,'utf8'),source);
  });
  await test('继续导入会话因重绘关闭仍保留入口',async()=>{
    const missing=structuredClone(packet);missing.assets=[{path:'content/assets/bg/missing.png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}];
    missing.config.ui.pages.title.style={backgroundImage:{asset:'missing',fit:'stretch'}};
    await page.locator('.ui-designer-toolbar input[type="file"]').setInputFiles({name:'pending.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(missing))});
    await page.locator('[data-ui-share-import-stage-assets]').click();
    await page.locator('[data-editor-mode="config"]').click();await page.locator('[data-config-section-target="ui"]').click();
    await page.locator('[data-ui-share-import-resume]').click();await page.locator('[data-ui-share-import-stage-assets]').waitFor();
    const retained=await page.evaluate(async()=>{const d=await import('/src/ui-share-import-dialog.ts');d.disposeUiShareImportDialog();return d.pendingUiShareImport();});
    assert.deepEqual(retained,{name:'pending.json'});
  });
  await page.screenshot({path:path.join(output,'editor.png')});assert.deepEqual(result.errors,[]);
}catch(error){result.failure=String(error.stack);}finally{await browser?.close();await server?.close();fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
if(result.failure||result.errors.length||result.cases.some(c=>c.status!=='passed'))process.exitCode=1;
