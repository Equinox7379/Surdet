import { buildObjectIndex, loadProjectSnapshot, type PreviewContent } from '@surdet/authoring';

export async function previewTextHash(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** A preview-only projection. It does not use or replace the human Editor buffers. */
export async function projectPreviewContent(content: PreviewContent) {
  const snapshot = await loadProjectSnapshot({
    rootIdentity: content.projectIdentity,
    listFiles: async () => Object.keys(content.files),
    exists: async file => Object.hasOwn(content.files, file),
    readText: async file => {
      const text = content.files[file];
      if (text === undefined) throw new Error(`试玩内容缺少文件：${file}`);
      return { path: file, text, sha256: await previewTextHash(text), bytes: new TextEncoder().encode(text).byteLength };
    },
  }, { sha256: previewTextHash });
  if (snapshot.revision !== content.contentRevision) throw new Error('试玩正文与返回的版本不一致');
  const configs = Object.fromEntries(['calendar', 'events', 'growth', 'achievements', 'gallery'].map(name => {
    const text = content.files[`content/config/${name}.json`];
    return [name, text === undefined ? undefined : JSON.parse(text.replace(/^\uFEFF/, '')) as unknown];
  }));
  return { scenes: snapshot.scenes.map(scene => ({ id: scene.id, text: scene.file.text, file: scene.path })),
    entryScene: snapshot.entryScene, configText: snapshot.configFile?.text ?? '{}', configs,
    timelines: snapshot.timelines.map(file => ({ id: file.path, text: file.text })), index: buildObjectIndex(snapshot), snapshot };
}
