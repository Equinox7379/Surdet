import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../content/assets');
const bg = ['apartment_night','apartment_blackout','convenience_exterior','convenience_interior','old_apartment_corridor','old_apartment_room','underground_passage','police_archive','last_train','rooftop_rain','dawn_street'];
const portraits = ['calm','hesitant','smile','wet','alert','panic','distant','signal'];
const bgm = ['midnight_rain','convenience_hum','old_room','underground_signal','investigation','last_train','blackout','ending_testimony','ending_meeting','ending_silence'];
const se = ['phone_ring','store_bell','rain_window','tape_click','voice_static','fluorescent','subway_pass','scanner','printer','siren','wind','power_cut','door_lock','city_morning'];
const paths = [...bg.map((x) => `bg/${x}.png`), ...portraits.map((x) => `portrait/zhirao_commute_${x}.png`), 'avatar/zhirao.png', ...bgm.map((x) => `bgm/${x}.wav`), ...se.map((x) => `se/${x}.wav`)];
const missing = paths.filter((x) => !existsSync(resolve(root, x)));
if (missing.length) { console.error(missing.join('\n')); process.exit(1); }
console.log(`assets ok: ${paths.length}`);
