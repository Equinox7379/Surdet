import * as fs from 'node:fs';
import * as path from 'node:path';
import { compileScene, computeProjectStats, type CompiledScene } from '@surdet/core';
import { parseProjectConfigDocument } from '@surdet/authoring';
import { findGalFiles, sceneIdFromFile } from './scenario-loader.js';
import { collectConfigSceneRoots } from './lint.js';

function readConfig(projectDir: string): { entryScene: string; customInstructions: string[] } {
  const file = path.join(projectDir, 'game.config.json');
  if (!fs.existsSync(file)) return { entryScene: '', customInstructions: [] };
  const raw = parseProjectConfigDocument(fs.readFileSync(file, 'utf8'), file);
  const custom = raw.customInstructions;
  return {
    entryScene: typeof raw.entryScene === 'string' ? raw.entryScene : '',
    customInstructions: Array.isArray(custom) ? custom.filter((item): item is string => typeof item === 'string') : [],
  };
}

export async function statsCommand(projectDir: string, options: { json?: boolean } = {}): Promise<number> {
  try {
    const files = findGalFiles(projectDir)
      .sort((a, b) => a.localeCompare(b));
    if (files.length === 0) throw new Error('未找到 content/scenario 下的 .gal 场景');
    const config = readConfig(projectDir);
    const scenes: CompiledScene[] = [];
    const sourceTextByScene = Object.create(null) as Record<string, string>;
    for (const file of files) {
      const sceneId = sceneIdFromFile(file);
      const source = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      scenes.push(compileScene(source, file, sceneId, config.customInstructions));
      sourceTextByScene[sceneId] = source;
    }
    const entryScene = config.entryScene || scenes[0]!.sceneId;
    const stats = computeProjectStats({ scenes, entryScene, sourceTextByScene, additionalSceneRoots: collectConfigSceneRoots(projectDir) });
    if (options.json) {
      process.stdout.write(JSON.stringify(stats) + '\n');
    } else {
      process.stdout.write([
        `场景：${stats.sceneCount}`,
        `文本行：${stats.totalTextLines}`,
        `总字数：${stats.totalCharacters}`,
        `选择肢：${stats.choiceCount}`,
        `结局：${stats.endingCount}`,
        `可达场景：${stats.reachableScenes.length}`,
        `不可达场景：${stats.unreachableScenes.length}`,
      ].join('\n') + '\n');
    }
    return 0;
  } catch (error) {
    process.stderr.write(`stats 失败：${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
