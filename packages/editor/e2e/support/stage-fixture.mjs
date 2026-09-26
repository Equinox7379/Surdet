import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deflateSync } from 'node:zlib';

function png(width, height, paint) {
  const crc = bytes => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(body.length + 8); result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE(crc(body), body.length + 4); return result; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const bytes = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const rgba = paint(x, y); for (let c = 0; c < 4; c++) bytes[y * (width * 4 + 1) + x * 4 + 1 + c] = rgba[c]; }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes)), chunk('IEND', Buffer.alloc(0))]);
}
export function createStageFixture(root, sharedPlayerUrl) {
  if (fs.existsSync(root)) throw new Error(`Fixture destination already exists: ${root}`);
  fs.mkdirSync(root, { recursive: true });
  const write = (name, bytes) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
  const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const figure = (factor, variant, color) => png(400 * factor, 700 * factor, (px, py) => {
    const x = px / factor, y = py / factor;
    const head = ((x - 200) / 64) ** 2 + ((y - 152) / 72) ** 2 < 1;
    const body = y > 220 && y < 640 && x > 104 + Math.abs(y - 300) * .05 && x < 296 - Math.abs(y - 300) * .05;
    if (head) { const eye = y > 140 && y < 146 && (Math.abs(x - 178) < 9 || Math.abs(x - 222) < 9); const mouth = variant && Math.abs(y - 178) < 3 && Math.abs(x - 200) < 17; return eye || mouth ? [34,39,45,255] : [226,194,161,255]; }
    return body ? [...color, 255] : [0,0,0,0];
  });
  const normal = figure(1, 0, [54,85,105]), smile = figure(2, 1, [54,85,105]), mio = figure(1, 0, [118,91,65]);
  write('content/assets/portrait/rin_coat_normal.png', normal); write('content/assets/portrait/rin_coat_smile.png', smile); write('content/assets/portrait/mio_coat_normal.png', mio);
  write('content/assets/bg/dock.png', png(1280, 720, (x, y) => y > 540 ? [87 + ((x + y) % 7),83,74,255] : y > 330 ? [63,89,105,255] : [129 + Math.round(y / 30),151 + Math.round(y / 50),161,255]));
  write('content/assets/bg/rail.png', png(1280, 720, (x, y) => y > 578 && y < 589 || x % 175 < 9 && y > 578 ? [32,40,45,220] : [0,0,0,0]));
  write('content/assets/bg/night.png', png(1280, 720, (_x, y) => [25 + Math.round(y / 100),39 + Math.round(y / 80),56,255]));
  const wav = Buffer.alloc(44 + 8000); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(8000,40); for(let i=0;i<4000;i++) wav.writeInt16LE(Math.round(1200*Math.sin(i*.3)*Math.exp(-i/400)),44+i*2); write('content/assets/se/click.wav',wav);
  write('content/assets/LICENSE.txt', 'Self-authored deterministic regression fixtures. CC0. No fonts or third-party artwork.\n');
  const pin = (file, bytes, width, height) => ({ path: file, sha256: hash(bytes), width, height });
  const config = { title: 'Surdet 舞台演出核验', version: '1.0.0', entryScene: 'start', variables: {},
    characters: { rin: { name: '凛' }, mio: { name: '澪' } }, player: { titleBackground: 'dock', firstRunHint: '' },
    stage: { version: 1, design: { width: 1280, height: 720 }, positions: { left: { x: 340, y: 680 }, right: { x: 940, y: 680 } }, distances: { far: .75, medium: 1, near: 1.25 },
      portraits: { 'rin:coat': { height: 510, anchorX: .5, anchorY: 1, expressions: { normal: { x: 104, y: 80, width: 192, height: 560 }, smile: { x: 208, y: 160, width: 384, height: 1120 } },
        sources: { normal: pin('content/assets/portrait/rin_coat_normal.png', normal, 400,700), smile: pin('content/assets/portrait/rin_coat_smile.png',smile,800,1400) } } },
      compositions: { dock: { background: 'dock', layers: [{ id: 'rail', key: 'rail', band: 'foreground', parallax: 1.25 }] }, empty: { background: null, layers: [], keepActors: false, resetCamera: true } } } };
  write('game.config.json', JSON.stringify(config,null,2)+'\n');
  write('content/scenario/start.gal', '@scene start\n@stage dock\n@show rin:coat normal @pos=left @scale=1 @opacity=1\n@show mio:coat normal @pos=right @scale=.75 @facing=left\n凛：这是正式预览里的两名独立舞台角色。\n@show rin:coat smile\n凛：表情改变后，可见范围、脚下锚点和身高保持不变。\n@timeline entrance @blocking\n澪：演出结束。存读档、回退和图层仍使用同一个世界层。\n@end\n');
  const pose = { version: 2, id: 'step', durationMs: 800, tracks: [{ kind: 'portrait', target: 'rin:coat', cues: [{ atMs:0,durationMs:800,easing:'inOutSine',action:'pose',x:700,scale:1.1 }] }] };
  const intro = { version:2,id:'entrance',durationMs:1200,tracks:[{kind:'camera',cues:[{atMs:200,durationMs:700,easing:'linear',action:'pan',x:60,y:0}]},{kind:'audio',cues:[{atMs:300,durationMs:0,easing:'linear',action:'se',key:'click'}]}],clips:[{timelineId:'step',atMs:0}] };
  write('content/timelines/step.json',JSON.stringify(pose,null,2));write('content/timelines/entrance.json',JSON.stringify(intro,null,2));
  write('content/config/gallery.json', JSON.stringify({cgs:[],music:[],texts:[]}));
  write('package.json', JSON.stringify({name:'surdet-stage-contract-fixture',private:true,type:'module',scripts:{build:'vite build'}}));
  write('index.html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stage contract</title><style>html,body{margin:0;background:#151a20;min-height:100vh}canvas{display:block;margin:auto}</style><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>');
  if(sharedPlayerUrl) write('src/main.ts',`import {startPlayer,showPlayerRecovery} from ${JSON.stringify(sharedPlayerUrl)};\nimport config from '../game.config.json';\nconst assetFiles=Object.fromEntries(Object.entries(import.meta.glob('../content/assets/**/*',{query:'?url',import:'default',eager:true})).map(([p,u])=>[p.replace('../content/assets/',''),u]));\nstartPlayer({id:'stage-contract',config,sceneFiles:import.meta.glob('../content/scenario/**/*.gal',{query:'?raw',import:'default'}),timelineFiles:import.meta.glob('../content/timelines/**/*.json',{eager:true,import:'default'}),assetFiles,fontFiles:{},showSpeakerAvatars:false,resolveSceneUrl:p=>new URL(p,import.meta.url).href,endScenes:['ending_left','ending_right']}).catch(showPlayerRecovery);\n`);
  return { root, config, normal, smile, source: fs.readFileSync(path.join(root,'content/scenario/start.gal'),'utf8') };
}
