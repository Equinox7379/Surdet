/** 项目内容入口。与 Starter 共用同一套玩家菜单、存档、输入和退出实现。 */
import { startPlayer, showPlayerRecovery, type PlayerProject } from '../../../examples/shared/player/player.js';
import gameConfig from '../game.config.json';
import gamePackage from '../package.json';
import { sceneFiles } from './scene-hmr-boundary.js';

const assetFiles = Object.fromEntries(Object.entries(import.meta.glob<string>(
  '../content/assets/**/*',
  { query: '?url', import: 'default', eager: true },
)).map(([path, url]) => [path.replace('../content/assets/', ''), url]));

void startPlayer({
  id: gamePackage.name,
  config: gameConfig,
  sceneFiles,
  assetFiles,
  fontFiles: import.meta.glob<string>('../content/assets/fonts/*.{woff2,woff,ttf,otf}', { query: '?url', import: 'default', eager: true }),
  timelineFiles: {
    ...import.meta.glob('../content/timelines/**/*.json', { eager: true, import: 'default' }),
    ...import.meta.glob(['../content/timelines/**/*.[jJ][sS][oO][nN]', '!../content/timelines/**/*.json'], { query: '?raw', eager: true, import: 'default' }),
  },
  gallery: (Object.values(import.meta.glob('../content/config/gallery.json', { eager: true, import: 'default' }))[0]
    ?? { cgs: [], music: [] }) as NonNullable<PlayerProject['gallery']>,
  subtitle: '一封晚到三年的信',
  titleBackground: 'harbor',
  endScenes: ['ending_public', 'ending_private'],
  firstRunHint: '点击或空格继续 · Esc 打开菜单 · ↑ 回看上一句',
  hot: import.meta.hot,
  resolveSceneUrl: (path) => new URL(path, import.meta.url).href,
}).catch(showPlayerRecovery);
