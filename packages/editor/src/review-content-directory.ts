import type { PreparedReviewContent } from '@surdet/authoring';

/** Entry names must stay single path segments before the loaders join them. */
export function isPreparedReviewContent(value: unknown, kind: 'file' | 'directory'): value is PreparedReviewContent {
  const content = value as PreparedReviewContent | undefined;
  if (!content) return false;
  if (kind === 'file') return content.kind === 'file' && typeof content.base64 === 'string';
  return content.kind === 'directory' && Array.isArray(content.entries) && content.entries.every((entry) =>
    !!entry && typeof entry.name === 'string' && !!entry.name && !/[\\/:\x00-\x1f]/.test(entry.name)
    && entry.name !== '.' && entry.name !== '..' && (entry.kind === 'file' || entry.kind === 'directory'));
}

/** Read-only File System Access shape over bounded review reads, consumed by the existing review/project loaders. */
export function readOnlyReviewDirectory(options: {
  key: string;
  rootName: string;
  readonlyMessage: string;
  read(path: string, kind: 'file' | 'directory'): Promise<PreparedReviewContent>;
}): FileSystemDirectoryHandle {
  const readonly = () => { throw new DOMException(options.readonlyMessage, 'NotAllowedError'); };
  const permission = async (request?: { mode?: string }) => request?.mode === 'readwrite' ? 'denied' : 'granted';
  const make = (path: string, kind: 'file' | 'directory'): FileSystemHandle => {
    const key = `${options.key}/${path}`;
    const handle = { kind, name: path.split('/').pop() || options.rootName, reviewKey: key, queryPermission: permission, requestPermission: permission,
      isSameEntry: async (other: unknown) => (other as { reviewKey?: string })?.reviewKey === key };
    if (kind === 'file') return { ...handle, createWritable: readonly, getFile: async () => {
      const content = await options.read(path, 'file');
      if (content.kind !== 'file') throw new DOMException('不是文件', 'TypeMismatchError');
      const bytes = Uint8Array.from(atob(content.base64), (char) => char.charCodeAt(0));
      return new File([bytes], handle.name);
    } } as unknown as FileSystemFileHandle;
    const values = async function* () {
      const content = await options.read(path, 'directory');
      if (content.kind !== 'directory') throw new DOMException('不是目录', 'TypeMismatchError');
      for (const entry of content.entries) yield make(path ? `${path}/${entry.name}` : entry.name, entry.kind);
    };
    const child = async (name: string, kind: 'file' | 'directory', request?: { create?: boolean }) => {
      if (request?.create) return readonly();
      for await (const entry of values()) if (entry.name === name) {
        if (entry.kind !== kind) throw new DOMException('文件种类不匹配', 'TypeMismatchError');
        return entry;
      }
      throw new DOMException('审阅内容不存在', 'NotFoundError');
    };
    return { ...handle, values, removeEntry: readonly,
      entries: async function* () { for await (const entry of values()) yield [entry.name, entry]; },
      getFileHandle: (name: string, request?: { create?: boolean }) => child(name, 'file', request),
      getDirectoryHandle: (name: string, request?: { create?: boolean }) => child(name, 'directory', request),
      resolve: async (other: { reviewKey?: string }) => other.reviewKey?.startsWith(`${key}/`) ? other.reviewKey.slice(key.length + 1).split('/') : null,
    } as unknown as FileSystemDirectoryHandle;
  };
  return make('', 'directory') as FileSystemDirectoryHandle;
}
