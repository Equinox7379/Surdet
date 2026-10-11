import { cmdPack } from '../../cli/dist/pack.js';
process.exitCode = await cmdPack(process.env.SURDET_GAME_DIR);
