import { loadProjectSnapshot, type ProjectFile, type ProjectStorage, type TextHasher } from '@surdet/authoring';
import { state, type SceneEntry, type TimelineEntry } from './state.js';

export interface EditorProjectStorage extends ProjectStorage, TextHasher {}

function bytesOf(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function scenarioPath(scene: SceneEntry): string {
  return scene.file.startsWith('content/scenario/') ? scene.file : `content/scenario/${scene.file}`;
}

function timelinePath(timeline: TimelineEntry): string {
  return timeline.file.startsWith('content/timelines/') ? timeline.file : `content/timelines/${timeline.file}`;
}

function configText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * 把 editor 当前内存投影为 authoring 只读存储。读取始终来自 state，
 * 因此 dirty 场景在建 snapshot/index 前不会被磁盘内容覆盖。
 */
export function createEditorProjectStorage(source = state): EditorProjectStorage {
  const files = (): Map<string, string> => {
    const result = new Map<string, string>();
    result.set('game.config.json', source.gameConfigText);
    for (const scene of source.scenes.values()) result.set(scenarioPath(scene), scene.text);
    for (const timeline of source.timelines) result.set(timelinePath(timeline), timeline.text);
    for (const [name, value] of Object.entries(source.configFiles)) {
      if (value !== null) result.set(`content/config/${name}.json`, configText(value));
    }
    return result;
  };
  const sha256 = async (text: string): Promise<string> => {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return hex(digest);
  };
  return {
    rootIdentity: `editor:${source.dirName || 'untitled'}`,
    sha256,
    async listFiles(): Promise<string[]> {
      return [...files().keys()].sort((a, b) => a.localeCompare(b));
    },
    async readText(filePath: string): Promise<ProjectFile> {
      const text = files().get(filePath);
      if (text === undefined) throw new Error(`项目内存文件不存在：${filePath}`);
      return { path: filePath, text, bytes: bytesOf(text), sha256: await sha256(text) };
    },
    async exists(filePath: string): Promise<boolean> {
      return files().has(filePath);
    },
  };
}

/** 以当前 editor 内存为唯一输入构建共享 authoring snapshot。 */
export async function loadEditorProjectSnapshot(): Promise<Awaited<ReturnType<typeof loadProjectSnapshot>>> {
  const storage = createEditorProjectStorage();
  return loadProjectSnapshot(storage, storage);
}
