/** 雾港来信：只声明本作内容，玩家菜单、存档、输入和生命周期由公共入口持有。 */
import { startPlayer, showPlayerRecovery, type PlayerProject } from '../../shared/player/player.js';
import { sceneFiles } from './scene-hmr-boundary.js';
import gameConfig from '../game.config.json';
import gamePackage from '../package.json';
import calendar from '../content/config/calendar.json';
import combat from '../content/config/combat.json';
import events from '../content/config/events.json';
import ngp from '../content/config/ngp.json';
import gallery from '../content/config/gallery.json';
import shop from '../content/config/shop.json';
import growth from '../content/config/growth.json';
import achievements from '../content/config/achievements.json';

const PROJECT_THEME = {
  typography: { bodySize: 28, uiSize: 24, captionSize: 18 },
};
const assetFiles = Object.fromEntries(Object.entries(import.meta.glob<string>(
  '../content/assets/**/*',
  { query: '?url', import: 'default', eager: true },
)).map(([path, url]) => [path.replace('../content/assets/', ''), url]));

void startPlayer({
  id: gamePackage.name,
  config: gameConfig,
  sceneFiles,
  terminology: Object.values(import.meta.glob('../content/config/terminology.json', { eager: true, import: 'default' }))[0],
  timelineFiles: {
    ...import.meta.glob('../content/timelines/**/*.json', { eager: true, import: 'default' }),
    ...import.meta.glob(['../content/timelines/**/*.[jJ][sS][oO][nN]', '!../content/timelines/**/*.json'], { query: '?raw', eager: true, import: 'default' }),
  },
  assetFiles,
  fontFiles: import.meta.glob<string>('../content/assets/fonts/*.{woff2,woff,ttf,otf}', { query: '?url', import: 'default', eager: true }),
  theme: PROJECT_THEME,
  showSpeakerAvatars: false,
  subtitle: '',
  titleBackground: 'harbor',
  titleLogo: 'title_logo',
  additionalEntrypoints: [{ id: 'explore', label: '自由探索', scene: 'playground' }],
  endScenes: Object.keys(sceneFiles).map((path) => path.split('/').pop()!.replace(/\.gal$/i, ''))
    .filter((id) => id.startsWith('ending_') || id === 'playground'),
  firstRunHint: '点击或空格继续 · Esc 打开菜单 · ↑ 回看上一句',
  gallery: gallery as PlayerProject['gallery'],
  systems: {
    calendar, combat, combatResultVariable: 'battleWon', affection: events, ngp, shop, growth,
    achievements, scheduledEvents: events.scheduled,
  } as unknown as PlayerProject['systems'],
  hot: import.meta.hot,
  resolveSceneUrl: (path) => new URL(path, import.meta.url).href,
}).catch(showPlayerRecovery);
