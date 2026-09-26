import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createStageFixture } from '../../editor/e2e/support/stage-fixture.mjs';
import { activate, waitTitle } from './player-browser-helpers.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const output=path.resolve(process.argv[2]??path.join(repo,'../stage-player-dist-'+Date.now()));
fs.mkdirSync(output,{recursive:true});
const root=path.join(output,'project');
const entry=path.relative(path.join(root,'src'),path.join(repo,'examples/shared/player/player.ts')).split(path.sep).join('/');
const fixture=createStageFixture(root,entry);
const write=(name,value)=>fs.writeFileSync(path.join(root,name),typeof value==='string'?value:JSON.stringify(value,null,2));
write('content/scenario/start.gal','@scene start\n@stage dock\n@show rin:coat normal @pos=left @scale=1\n@show mio:coat normal @pos=right @scale=.75 @facing=left\n凛：两个人保持各自的位置。\n@show rin:coat smile\n凛：更换表情，但锚点和身高不变。\n@timeline paired @blocking\n澪：演出完成。\n@choice\n  左边码头 -> @jump ending_left\n  右边码头 -> @jump ending_right\n@end\n');
write('content/scenario/ending_left.gal','@scene ending_left\n@stage empty\n左边结局。\n@end\n');
write('content/scenario/ending_right.gal','@scene ending_right\n@bg night\n右边结局。\n@end\n');
write('content/timelines/step.json',{version:2,id:'step',durationMs:2000,tracks:[{kind:'portrait',target:'rin:coat',cues:[{atMs:0,durationMs:2000,easing:'linear',action:'pose',x:700,scale:1.1}]}]});
write('content/timelines/paired.json',{version:2,id:'paired',durationMs:4500,tracks:[{kind:'camera',cues:[{atMs:0,durationMs:4000,easing:'linear',action:'pan',x:60,y:0}]},{kind:'audio',cues:[{atMs:250,durationMs:0,easing:'linear',action:'se',key:'click'}]}],clips:[{timelineId:'step',atMs:0,repeat:2,gapMs:100}]});
// A second independent caller uses the same definition. No expanded tracks
// are baked into the authored project or copied from another run.
write('content/timelines/second.json',{version:2,id:'second',durationMs:2200,tracks:[],clips:[{timelineId:'step',atMs:200,targets:{'rin:coat':'mio:coat'}}]});
write('content/timelines/departure.json',{version:2,id:'departure',durationMs:2000,tracks:[
  {kind:'portrait',target:'rin:coat',cues:[{atMs:0,durationMs:2000,easing:'linear',action:'pose',x:1000}]},
  {kind:'layer',target:'rail',cues:[{atMs:0,durationMs:2000,easing:'linear',action:'pose',x:100}]}
]});
write('content/scenario/start.gal',fs.readFileSync(path.join(root,'content/scenario/start.gal'),'utf8').replace('@choice',
  '@timeline departure\n离场动作进行中。\n@stage off\n清场后旧动作不应复活。\n@stage dock\n@show rin:coat normal @x=700\n@show mio:coat normal @pos=right @scale=.75 @facing=left\n@choice'));
fs.symlinkSync(path.join(repo,'node_modules'),path.join(root,'node_modules'),'junction');
const evidence={status:'running',checks:[],pageErrors:[],console:[],failedRequests:[]};
const pass=(name,detail={})=>{evidence.checks.push({name,...detail});console.log('PASS '+name);};
let browser,server,page;
try{
  const build=execFileSync(process.execPath,[path.join(repo,'packages/cli/dist/index.js'),'build',root,'--web'],{cwd:repo,encoding:'utf8',timeout:120000});
  fs.writeFileSync(path.join(output,'build.log'),build);
  const deployed=path.join(output,'isolated-dist'); fs.cpSync(path.join(root,'dist'),deployed,{recursive:true});
  assert(fs.existsSync(path.join(deployed,'web-trial-info.json')));
  server=http.createServer((req,res)=>{const rel=decodeURIComponent((req.url??'/').split('?')[0]);const file=path.resolve(deployed,'.'+(rel==='/'?'/index.html':rel));
    if(!file.startsWith(deployed+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.wav':'audio/wav','.txt':'text/plain'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]??'application/octet-stream'});fs.createReadStream(file).pipe(res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); const url=`http://127.0.0.1:${server.address().port}/`;
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(15000);
  page.on('pageerror',e=>evidence.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')evidence.console.push(m.text());});
  page.on('requestfailed',r=>evidence.failedRequests.push({url:r.url(),failure:r.failure()?.errorText}));
  await page.goto(url);await waitTitle(page);await activate(page,'开始游戏');
  await page.waitForFunction(()=>window.__surdetDebug?.status==='awaiting-advance');
  const snapshot=()=>page.evaluate(()=>window.__surdetDebug.presentationSnapshot);
  const first=await snapshot(); const a=first.stage.portraits.find(p=>p.key==='rin:coat').view.pose,b=first.stage.portraits.find(p=>p.key==='mio:coat').view.pose;
  assert.equal(a.x,340);assert.equal(a.baseHeight,510);assert.equal(b.x,940);assert.equal(b.scale,.75);assert.equal(b.facing,'left');
  pass('isolated-dist-loads-pinned-calibration-two-independent-actors-and-layers');
  await page.screenshot({path:path.join(output,'01-formal-two-actors.png')});
  await page.setViewportSize({width:1024,height:768});
  assert.deepEqual((await snapshot()).stage.portraits.map(p=>p.view.pose),first.stage.portraits.map(p=>p.view.pose));
  const canvasBounds=await page.locator('canvas').boundingBox();
  assert(canvasBounds && Math.abs(canvasBounds.width/canvasBounds.height-1280/720)<.01);
  pass('different-window-aspect-preserves-design-coordinates-and-uniform-display-scaling');
  await page.setViewportSize({width:1280,height:800});
  const advance=async()=>{await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('Space');};
  for(let n=0;n<6;n++){await advance();if(await page.evaluate(()=>window.__surdetDebug.presentationSnapshot.stage.portraits.find(p=>p.key==='rin:coat')?.view.expression==='smile'))break;await page.waitForTimeout(30);}
  await page.waitForFunction(()=>window.__surdetDebug.presentationSnapshot.stage.portraits.find(p=>p.key==='rin:coat')?.view.expression==='smile');
  const cross=await snapshot();assert.deepEqual(cross.stage.portraits.find(p=>p.key==='rin:coat').view.pose,a);
  assert.equal(cross.stage.portraits.find(p=>p.key==='rin:coat').view.frame.height,1120);
  pass('different-size-expression-keeps-stage-pose-and-uses-new-calibration');
  await page.keyboard.press('Escape');
  await activate(page,'回退一句');
  await page.waitForFunction(()=>window.__surdetDebug.presentationSnapshot.stage.portraits.find(p=>p.key==='rin:coat')?.view.expression==='normal');
  const rolled=await snapshot();
  assert.deepEqual(rolled.stage.portraits.find(p=>p.key==='rin:coat').view.pose,a);
  assert.equal(rolled.stage.layers.length,1);
  pass('actual-menu-rollback-restores-previous-expression-pose-and-layers');
  for(let n=0;n<6;n++){await advance();if(await page.evaluate(()=>window.__surdetDebug.presentationSnapshot.stage.portraits.find(p=>p.key==='rin:coat')?.view.expression==='smile'))break;await page.waitForTimeout(30);}
  await page.waitForFunction(()=>window.__surdetDebug.presentationSnapshot.stage.portraits.find(p=>p.key==='rin:coat')?.view.expression==='smile');
  for(let n=0;n<5;n++){if(await page.evaluate(()=>window.__surdetDebug.status==='awaiting-timer'))break;await advance();await page.waitForTimeout(25);}
  await page.waitForFunction(()=>window.__surdetDebug.status==='awaiting-timer');
  await page.waitForFunction(()=>{const s=window.__surdetDebug.presentationSnapshot;return s.stage.portraits.find(p=>p.key==='rin:coat').view.pose.x>460;});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__surdetDebug.uiSession.overlay==='system-menu');
  const paused=await snapshot();await page.waitForTimeout(350);const still=await snapshot();
  assert.deepEqual(still.stage,paused.stage,'system menu must freeze the real stage clock');
  pass('actual-player-menu-freezes-mid-cue-stage');
  assert.equal(await page.evaluate(()=>window.__surdetDebug.quickSave()),true);
  const saved=await snapshot();await page.keyboard.press('Escape');
  await page.waitForFunction(()=>window.__surdetDebug.uiSession.overlay==='none');await page.waitForTimeout(250);
  assert.notDeepEqual((await snapshot()).stage.portraits,saved.stage.portraits);
  assert.equal(await page.evaluate(()=>window.__surdetDebug.quickLoad()),true);
  const loaded=await snapshot();
  assert(Math.abs(loaded.stage.portraits.find(p=>p.key==='rin:coat').view.pose.x-saved.stage.portraits.find(p=>p.key==='rin:coat').view.pose.x)<15);
  assert.equal(loaded.stage.portraits.length,2);assert.equal(loaded.stage.layers.length,1);
  pass('actual-localstorage-save-load-restores-mid-cue-and-blocking-ownership');
  for(let n=0;n<2;n++)assert.equal(await page.evaluate(()=>window.__surdetDebug.quickLoad()),true);
  assert.equal((await snapshot()).stage.portraits.length,2);assert.equal(await page.locator('canvas').count(),1);
  pass('repeated-load-keeps-one-canvas-two-actors');
  await advance();await page.waitForFunction(()=>window.__surdetDebug.status==='awaiting-advance');
  assert.equal((await snapshot()).stage.portraits.find(p=>p.key==='rin:coat').view.pose.x,700);
  pass('skip-settles-repeated-clip-at-authoritative-final-state');
  for(let n=0;n<8;n++){if(await page.evaluate(()=>window.__surdetDebug.presentationSnapshot.timelines.some(run=>run.definition.id==='departure')))break;await advance();await page.waitForTimeout(30);}
  await page.waitForFunction(()=>window.__surdetDebug.presentationSnapshot.timelines.some(run=>run.definition.id==='departure'));
  for(let n=0;n<8;n++){if((await snapshot()).stage.portraits.length===0)break;await advance();await page.waitForTimeout(30);}
  assert.equal((await snapshot()).stage.portraits.length,0);assert.equal((await snapshot()).stage.layers.length,0);
  assert.equal(await page.evaluate(()=>window.__surdetDebug.quickSave()),true);
  assert.equal(await page.evaluate(()=>window.__surdetDebug.quickLoad()),true);
  await page.waitForTimeout(350);
  assert.equal((await snapshot()).stage.portraits.length,0);assert.equal((await snapshot()).stage.layers.length,0);
  pass('clear-during-live-portrait-and-layer-cues-survives-actual-save-load-without-resurrection');
  for(let n=0;n<8;n++){if(await page.evaluate(()=>window.__surdetDebug.rendererStatus==='choice'))break;await advance();await page.waitForTimeout(30);}
  await activate(page,'左边码头');await page.waitForFunction(()=>window.__surdetDebug.position?.sceneId==='ending_left');
  assert.equal((await snapshot()).stage.portraits.length,0);assert.equal((await snapshot()).stage.layers.length,0);
  pass('first-real-choice-reaches-declared-ending-and-explicit-clear');
  await page.screenshot({path:path.join(output,'02-formal-ending.png')});
  await page.reload();await waitTitle(page);await activate(page,'开始游戏');
  for(let n=0;n<30;n++){if(await page.evaluate(()=>window.__surdetDebug.rendererStatus==='choice'))break;await advance();await page.waitForTimeout(25);}
  await activate(page,'右边码头');await page.waitForFunction(()=>window.__surdetDebug.position?.sceneId==='ending_right');
  assert.equal((await snapshot()).stage.portraits.length,2);pass('second-real-choice-reaches-declared-ending-with-legacy-bg-preservation');
  assert.equal(evidence.pageErrors.length,0,JSON.stringify(evidence.pageErrors));assert.equal(evidence.failedRequests.length,0,JSON.stringify(evidence.failedRequests));
  evidence.status='passed';
}catch(error){evidence.status='failed';evidence.failure=error?.stack??String(error);process.exitCode=1;if(page){evidence.visibleText=await page.locator('body').innerText().catch(()=> '');evidence.snapshot=await page.evaluate(()=>window.__surdetDebug?.presentationSnapshot).catch(()=>null);await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}}
finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));fs.writeFileSync(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,checks:evidence.checks.length,failure:evidence.failure,console:evidence.console,output},null,2));}
