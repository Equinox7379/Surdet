import type { DesktopBridge, DirectoryGrant } from '../desktop/contracts.js';
declare global { interface Window { surdetDesktop?: DesktopBridge } }
const identities = new WeakMap<FileSystemDirectoryHandle, string>();
const entries = new WeakMap<object, { identity: string; path: string }>();
const fileTypes: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2', json: 'application/json', gal: 'text/plain',
};
export const desktopProjectIdentity = (handle: FileSystemDirectoryHandle): string | undefined => identities.get(handle);
export function desktopDirectory(grant: DirectoryGrant): FileSystemDirectoryHandle {
  const bridge = window.surdetDesktop!;
  const readonly = () => { throw new DOMException('桌面项目只能通过编辑器的正常保存流程写入。', 'NotAllowedError'); };
  const read = async (path: string) => {
    try { return await bridge.read(grant.token, path); }
    catch (error) {
      if (String(error).includes('ENOENT')) throw new DOMException('文件不存在', 'NotFoundError');
      throw error;
    }
  };
  const make = (path: string, kind: 'directory' | 'file'): FileSystemHandle => {
    const common = { kind, name: path.split('/').pop() || grant.name,
      queryPermission: async (options?: { mode?: string }) => options?.mode === 'readwrite' ? 'denied' : 'granted',
      requestPermission: async (options?: { mode?: string }) => options?.mode === 'readwrite' ? 'denied' : 'granted',
      isSameEntry: async (other: object) => entries.get(other)?.identity === grant.identity && entries.get(other)?.path === path,
    };
    let handle: FileSystemHandle;
    if (kind === 'file') handle = { ...common, createWritable: readonly, getFile: async () => {
      const content = await read(path);
      if (content.kind !== 'file') throw new DOMException('不是文件', 'TypeMismatchError');
      return new File([new Uint8Array(content.bytes)], common.name, { lastModified: content.lastModified, type: fileTypes[common.name.split('.').pop()?.toLowerCase() ?? ''] ?? '' });
    } } as unknown as FileSystemFileHandle;
    else {
      const values = async function* () {
        const content = await read(path);
        if (content.kind !== 'directory') throw new DOMException('不是目录', 'TypeMismatchError');
        for (const entry of content.entries) yield make(path ? `${path}/${entry.name}` : entry.name, entry.kind);
      };
      const child = async (name: string, kind: 'file' | 'directory', options?: { create?: boolean }) => {
        if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new TypeError('无效文件名。');
        for await (const entry of values()) if (entry.name === name) {
          if (entry.kind !== kind) throw new DOMException('文件类型不匹配', 'TypeMismatchError');
          return entry;
        }
        if (options?.create) return readonly();
        throw new DOMException('文件不存在', 'NotFoundError');
      };
      handle = { ...common, values, removeEntry: readonly,
        entries: async function* () { for await (const entry of values()) yield [entry.name, entry]; },
        getFileHandle: (name: string, options?: { create?: boolean }) => child(name, 'file', options),
        getDirectoryHandle: (name: string, options?: { create?: boolean }) => child(name, 'directory', options),
        resolve: async (other: object) => {
          const entry = entries.get(other);
          if (entry?.identity !== grant.identity) return null;
          const target = entry.path;
          if (target === path) return [];
          const prefix = path ? `${path}/` : '';
          return target.startsWith(prefix) ? target.slice(prefix.length).split('/') : null;
        },
      } as unknown as FileSystemDirectoryHandle;
    }
    entries.set(handle, { identity: grant.identity, path });
    return handle;
  };
  const root = make('', 'directory') as FileSystemDirectoryHandle;
  identities.set(root, `desktop:${grant.identity}`);
  return root;
}

if (typeof window !== 'undefined' && window.surdetDesktop) {
  Object.assign(window, { showDirectoryPicker: async () => {
    const grant = await window.surdetDesktop!.pickDirectory();
    if (!grant) throw new DOMException('已取消选择', 'AbortError');
    return desktopDirectory(grant);
  } });
}
