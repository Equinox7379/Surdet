import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../content/assets');
const scenarioRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../content/scenario');
const configPath = resolve(dirname(fileURLToPath(import.meta.url)), '../game.config.json');
const bg = ['apartment_night','apartment_blackout','convenience_exterior','convenience_interior','old_apartment_corridor','old_apartment_room','underground_passage','police_archive','last_train','rooftop_rain','dawn_street'];
const portraits = ['calm','hesitant','smile','wet','alert','panic','distant','signal'];
const bgm = ['midnight_rain','convenience_hum','old_room','underground_signal','investigation','last_train','blackout','ending_testimony','ending_meeting','ending_silence'];
const se = ['phone_ring','store_bell','rain_window','tape_click','voice_static','fluorescent','subway_pass','scanner','printer','siren','wind','power_cut','door_lock','city_morning'];
const paths = [...bg.map((x) => `bg/${x}.png`), ...portraits.map((x) => `portrait/zhirao_commute_${x}.png`), 'avatar/zhirao.png', ...bgm.map((x) => `bgm/${x}.wav`), ...se.map((x) => `se/${x}.wav`)];
const missing = paths.filter((x) => !existsSync(resolve(root, x)));
const allAssetFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else allAssetFiles.push(full);
  }
};
walk(root);
const hasAsset = (kind, stem) => allAssetFiles.some((file) => {
  const relative = file.slice(root.length + 1).replaceAll('\\', '/');
  return relative.startsWith(`${kind}/`) && basename(relative).replace(/\.[^.]+$/, '') === stem;
});

// 逐行审计剧本引用，防止素材文件虽然在包内，但 key/角色/表情拼接错误而回退占位。
const missingReferences = [];
for (const filename of readdirSync(scenarioRoot).filter((x) => x.endsWith('.gal'))) {
  const source = readFileSync(resolve(scenarioRoot, filename), 'utf8');
  for (const line of source.split(/\r?\n/)) {
    const audioOrBg = line.match(/^@(bg|bgm|se|voice)\s+([^\s]+)/);
    if (audioOrBg) {
      const kind = audioOrBg[1];
      const stem = audioOrBg[2];
      if (!hasAsset(kind, stem)) missingReferences.push(`${filename}: ${line}`);
    }
    const portrait = line.match(/^@show\s+([^\s]+)(?:\s+([^\s]+))?/);
    if (portrait) {
      const [char, costume = 'normal'] = portrait[1].split(':');
      const expression = portrait[2] ?? 'normal';
      if (!hasAsset('portrait', `${char}_${costume}_${expression}`)) missingReferences.push(`${filename}: ${line}`);
    }
  }
}

// 配置中的对白头像也必须存在，否则菜单/对白区会静默退回无头像。
const config = JSON.parse(readFileSync(configPath, 'utf8'));
for (const [id, character] of Object.entries(config.characters ?? {})) {
  if (typeof character.avatar === 'string' && !hasAsset('avatar', character.avatar)) {
    missingReferences.push(`game.config.json: characters.${id}.avatar=${character.avatar}`);
  }
}

const errors = [...missing, ...missingReferences];
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`assets ok: ${paths.length}`);
