import { parseProjectConfigDocument } from '@surdet/authoring';
import { state } from './state.js';
import { readGalleryUnlockPolicy } from '@surdet/core';

export type ConfigSourceName = keyof typeof state.handles;

export function configSourcePath(name: ConfigSourceName): string {
  return name === 'gameConfig' ? 'game.config.json' : `content/config/${name}.json`;
}

/** Achievements have always used an array; the other editable config roots are objects. */
export function parseConfigSource(name: ConfigSourceName, text: string): unknown {
  const path = configSourcePath(name);
  if (name !== 'achievements') {
    const config = parseProjectConfigDocument(text, path);
    if (name === 'gallery') readGalleryUnlockPolicy(config);
    return config;
  }
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`${path} 解析失败：${error instanceof Error ? error.message : String(error)}`); }
  if (!Array.isArray(value) || value.some(item => item === null || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error(`${path} 必须是成就对象数组`);
  }
  return value;
}

export function configSourceError(name: ConfigSourceName, source = state): string | undefined {
  if (source.configReadErrors[name]) return source.configReadErrors[name];
  if (name === 'gameConfig' && (source.gameConfigText !== '' || source.handles.gameConfig !== null)) {
    try { parseConfigSource(name, source.gameConfigText); }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }
  return undefined;
}

export function assertConfigSourcesReadable(names: readonly ConfigSourceName[] = Object.keys(state.handles) as ConfigSourceName[], source = state): void {
  for (const name of names) {
    const error = configSourceError(name, source);
    if (error) throw new Error(`${configSourcePath(name)} 无法读取；请修正文件后重新打开项目。${error}`);
  }
}
