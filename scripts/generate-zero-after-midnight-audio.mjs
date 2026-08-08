import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('examples/zero-after-midnight/content/assets');
const bgmDir = resolve(root, 'bgm');
const seDir = resolve(root, 'se');
mkdirSync(bgmDir, { recursive: true });
mkdirSync(seDir, { recursive: true });
const ffmpeg = 'ffmpeg';
function make(out, filter, seconds) {
  const result = spawnSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', filter, '-t', String(seconds), '-ac', '2', '-ar', '44100', out], { stdio: 'pipe' });
  if (result.status !== 0) throw new Error(result.stderr.toString());
}
const bgm = ['midnight_rain','convenience_hum','old_room','underground_signal','investigation','last_train','blackout','ending_testimony','ending_meeting','ending_silence'];
for (let i = 0; i < bgm.length; i++) {
  const hz = 62 + i * 11;
  make(resolve(bgmDir, `${bgm[i]}.wav`), `sine=frequency=${hz}:sample_rate=44100,volume=0.035`, 32);
}
const se = ['phone_ring','store_bell','rain_window','tape_click','voice_static','fluorescent','subway_pass','scanner','printer','siren','wind','power_cut','door_lock','city_morning'];
for (let i = 0; i < se.length; i++) {
  const hz = 280 + i * 53;
  make(resolve(seDir, `${se[i]}.wav`), `sine=frequency=${hz}:sample_rate=44100,volume=0.18`, i === 10 || i === 13 ? 1.5 : 0.55);
}
console.log(`generated ${bgm.length} BGM and ${se.length} SE files`);
