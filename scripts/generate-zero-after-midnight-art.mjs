import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('examples/zero-after-midnight/content/assets');
const bgDir = resolve(root, 'bg');
const portraitDir = resolve(root, 'portrait');
const avatarDir = resolve(root, 'avatar');
mkdirSync(bgDir, { recursive: true });
mkdirSync(portraitDir, { recursive: true });
mkdirSync(avatarDir, { recursive: true });

const backgrounds = {
  apartment_night: ['高层公寓的客厅，落地窗外是被雨雾模糊的城市灯光', '#1b3346', '#081018'],
  apartment_blackout: ['断电的公寓，窗帘漏进冷蓝色街光，桌上有一部碎屏手机', '#1a2835', '#05080d'],
  convenience_exterior: ['雨夜便利店外景，白色玻璃门和温暖的门铃灯', '#29435a', '#091018'],
  convenience_interior: ['空无一人的便利店内景，冷白灯和潮湿的地面反光', '#3b5160', '#11191e'],
  old_apartment_corridor: ['老旧公寓三楼走廊，剥落墙纸和尽头漏雨的窗', '#344451', '#101318'],
  old_apartment_room: ['空置房间中的折叠桌与老录音机，只有一盏侧光', '#353e45', '#101113'],
  underground_passage: ['末班车后的地下通道，长长的灯管与积水反光', '#173f49', '#071114'],
  police_archive: ['深夜派出所档案室，金属柜和扫描仪的白光', '#3d4a55', '#11161b'],
  last_train: ['深夜末班车车厢，空座椅和雨水划过的车窗', '#284859', '#0a1319'],
  rooftop_rain: ['雨夜天台，远处城市灯火和湿冷的混凝土护栏', '#1d3f55', '#071018'],
  dawn_street: ['雨后清晨街道，钢蓝天空中有少量温暖店铺灯光', '#657d8d', '#18242b'],
};

const expressions = {
  calm: ['平静', '#d7bdb3', '#25313d', '0'],
  hesitant: ['迟疑', '#d1b5ad', '#273643', '2'],
  smile: ['勉强微笑', '#d8bcb2', '#30404c', '4'],
  wet: ['湿冷', '#c6afb0', '#294857', '7'],
  alert: ['警觉', '#d4b9b0', '#23333f', '-3'],
  panic: ['惊慌', '#c9aca8', '#182733', '-7'],
  distant: ['失焦', '#b9a8aa', '#425866', '1'],
  signal: ['信号失真', '#a7a9b2', '#1e4255', '0'],
};

function citySvg(title, top, bottom) {
  const windows = Array.from({ length: 34 }, (_, i) => {
    const x = 70 + (i * 127) % 1770;
    const y = 180 + (i * 83) % 410;
    const warm = i % 5 === 0 ? '#d6ad62' : '#92b5c6';
    return `<rect x="${x}" y="${y}" width="30" height="15" fill="${warm}" opacity="${i % 5 === 0 ? '.72' : '.3'}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient><linearGradient id="road" x2="0" y2="1"><stop stop-color="#253b49"/><stop offset="1" stop-color="#05090d"/></linearGradient><filter id="blur"><feGaussianBlur stdDeviation="14"/></filter></defs>
  <rect width="1920" height="1080" fill="url(#sky)"/><circle cx="280" cy="170" r="120" fill="#d9ae62" opacity=".14" filter="url(#blur)"/>
  <path d="M0 620 L180 470 L330 620 L510 350 L730 620 L920 410 L1110 620 L1290 300 L1490 620 L1720 420 L1920 620 V810 H0Z" fill="#101b25" opacity=".92"/>
  ${windows}<path d="M0 690 C510 600 1300 660 1920 590 V1080 H0Z" fill="url(#road)"/><path d="M0 870 C600 770 1260 860 1920 760" fill="none" stroke="#78a3bb" stroke-width="7" opacity=".25"/>
  <g opacity=".27" stroke="#d7e7ee" stroke-width="3">${Array.from({length: 78},(_,i)=>`<line x1="${-200+i*34}" y1="0" x2="${-60+i*34}" y2="1080"/>`).join('')}</g>
  </svg>`;
}

function portraitSvg(label, skin, coat, offset) {
  const mood = {
    平静: { brow: 0, mouth: 'M448 632 Q500 654 552 632', eye: '#b9e4eb' },
    迟疑: { brow: -10, mouth: 'M452 636 Q500 626 548 642', eye: '#b9e4eb' },
    勉强微笑: { brow: 2, mouth: 'M438 628 Q500 680 562 628', eye: '#c5eef1' },
    湿冷: { brow: 7, mouth: 'M452 644 Q500 632 548 644', eye: '#9ed6df' },
    警觉: { brow: -14, mouth: 'M454 642 Q500 620 546 642', eye: '#e2f5f4' },
    惊慌: { brow: -20, mouth: 'M452 628 Q500 690 548 628', eye: '#f1f8f4' },
    失焦: { brow: 4, mouth: 'M460 640 Q500 646 540 640', eye: '#8cb8c6' },
    信号失真: { brow: 0, mouth: 'M450 638 L550 638', eye: '#8ff2ed' },
  }[label] ?? { brow: 0, mouth: 'M448 632 Q500 654 552 632', eye: '#b9e4eb' };
  const glitch = label === '信号失真'
    ? '<path d="M240 420 H760 M280 650 H720 M320 880 H680" stroke="#8fe4e9" stroke-width="18" opacity=".3"/><path d="M350 300 H660" stroke="#d8bd6f" stroke-width="8" opacity=".4"/>'
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500" viewBox="0 0 1000 1500">
  <defs>
    <linearGradient id="coat" x2="1" y2="1"><stop stop-color="#${coat.slice(1)}"/><stop offset=".55" stop-color="#182531"/><stop offset="1" stop-color="#0b131d"/></linearGradient>
    <linearGradient id="hair" x2="1" y2="1"><stop stop-color="#273748"/><stop offset=".5" stop-color="#101a28"/><stop offset="1" stop-color="#070d16"/></linearGradient>
    <radialGradient id="face"><stop stop-color="#f1d4ca"/><stop offset="1" stop-color="${skin}"/></radialGradient>
    <filter id="shadow"><feGaussianBlur stdDeviation="22"/></filter>
  </defs>
  <g transform="translate(${offset},0)">
    <ellipse cx="500" cy="1440" rx="390" ry="70" fill="#02070c" opacity=".65" filter="url(#shadow)"/>
    <path d="M138 1500 Q165 1040 300 820 Q370 750 500 750 Q630 750 700 820 Q835 1040 862 1500Z" fill="url(#coat)" stroke="#4b6b7c" stroke-width="5"/>
    <path d="M300 860 L438 1010 L500 970 L562 1010 L700 860 L650 1500 H350Z" fill="#0d1924" opacity=".72"/>
    <path d="M370 820 L500 990 L630 820 L577 790 L500 895 L423 790Z" fill="#d1d7d6" opacity=".95"/>
    <path d="M423 790 L500 895 L577 790" fill="none" stroke="#8ea6ad" stroke-width="8" opacity=".65"/>
    <path d="M300 970 Q230 1110 230 1430 M700 970 Q770 1110 770 1430" fill="none" stroke="#557083" stroke-width="12" opacity=".5"/>
    <path d="M190 1250 Q500 1190 810 1250" fill="none" stroke="#7d9baa" stroke-width="4" opacity=".28"/>
    <path d="M250 780 Q160 580 190 350 Q245 155 500 135 Q755 155 810 350 Q840 580 750 780 L710 1060 L290 1060Z" fill="url(#hair)" stroke="#5f7b8c" stroke-width="5"/>
    <path d="M330 390 Q350 220 500 195 Q650 220 670 390 L630 610 Q610 760 500 805 Q390 760 370 610Z" fill="url(#face)" stroke="#b78f8b" stroke-width="4"/>
    <path d="M315 405 Q330 240 500 205 Q670 240 685 405 L612 345 Q580 278 500 285 Q420 278 388 345Z" fill="#111a26"/>
    <path d="M312 405 Q350 330 405 278 Q454 225 500 215 Q445 350 370 438Z" fill="#1d2b3b"/>
    <path d="M688 405 Q650 330 595 278 Q546 225 500 215 Q555 350 630 438Z" fill="#1d2b3b"/>
    <path d="M${375 + mood.brow} 472 Q430 ${430 + mood.brow} 480 468" fill="none" stroke="#152131" stroke-width="18" stroke-linecap="round"/>
    <path d="M520 468 Q570 ${430 + mood.brow} ${625 - mood.brow} 472" fill="none" stroke="#152131" stroke-width="18" stroke-linecap="round"/>
    <path d="M405 515 Q450 480 485 520 Q450 565 405 515Z" fill="#f5fbfa"/><path d="M515 520 Q550 480 595 515 Q550 565 515 520Z" fill="#f5fbfa"/>
    <ellipse cx="450" cy="520" rx="14" ry="22" fill="${mood.eye}"/><ellipse cx="550" cy="520" rx="14" ry="22" fill="${mood.eye}"/><circle cx="454" cy="512" r="5" fill="#ffffff"/><circle cx="554" cy="512" r="5" fill="#ffffff"/>
    <path d="M500 525 Q480 575 500 594 Q520 575 500 525" fill="none" stroke="#b88283" stroke-width="7" opacity=".7"/>
    <path d="${mood.mouth}" fill="none" stroke="#9c5f6c" stroke-width="13" stroke-linecap="round"/>
    <path d="M375 586 Q415 620 450 598 M550 598 Q585 620 625 586" fill="none" stroke="#d88991" stroke-width="10" opacity=".25"/>
    <path d="M300 760 Q245 700 230 620 M700 760 Q755 700 770 620" fill="none" stroke="#1b2938" stroke-width="40" stroke-linecap="round"/>
    <path d="M260 320 Q205 420 235 565 M740 320 Q795 420 765 565" fill="none" stroke="#8db0bb" stroke-width="8" opacity=".25"/>
    ${glitch}
  </g></svg>`;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (const [key, [title, top, bottom]] of Object.entries(backgrounds)) {
  await page.setContent(`<body style="margin:0">${citySvg(title, top, bottom)}</body>`);
  await page.screenshot({ path: resolve(bgDir, `${key}.png`) });
}
for (const [key, [label, skin, coat, offset]] of Object.entries(expressions)) {
  await page.setViewportSize({ width: 1000, height: 1500 });
  await page.setContent(`<body style="margin:0;background:transparent">${portraitSvg(label, skin, coat, offset)}</body>`);
  await page.screenshot({ path: resolve(portraitDir, `zhirao_commute_${key}.png`), omitBackground: true });
}
await page.setViewportSize({ width: 512, height: 512 });
await page.setContent(`<body style="margin:0;background:#1d3444">${portraitSvg('平静', '#d7bdb3', '#25313d', '0')}</body>`);
await page.screenshot({ path: resolve(avatarDir, 'zhirao.png') });
await browser.close();
console.log(`generated ${Object.keys(backgrounds).length} backgrounds and ${Object.keys(expressions).length} portraits`);
