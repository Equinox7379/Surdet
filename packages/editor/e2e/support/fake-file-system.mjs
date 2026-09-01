import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const EXCLUDED_TREE_NAMES = new Set(['.git', 'node_modules', 'dist', '.vite']);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function collectProjectFiles(root) {
  const files = [];
  const visit = (directory, relativeDirectory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (EXCLUDED_TREE_NAMES.has(entry.name) || entry.name.startsWith('.surdet-')) continue;
      const absolute = path.join(directory, entry.name);
      const relative = relativeDirectory.length === 0
        ? entry.name
        : path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        files.push({
          path: relative.split(path.sep).join('/'),
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
          base64: bytes.toString('base64'),
        });
      }
    }
  };
  visit(root, '');
  return files;
}

export function hashProjectTree(root) {
  const files = collectProjectFiles(root).map(({ path: filePath, bytes, sha256: fileSha256 }) => ({
    path: filePath,
    bytes,
    sha256: fileSha256,
  }));
  const serialized = files
    .map((file) => `${file.path}\0${file.bytes}\0${file.sha256}`)
    .join('\n');
  return {
    path: path.resolve(root),
    fileCount: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    sha256: sha256(Buffer.from(serialized, 'utf8')),
    files,
  };
}

export function fileMapForDirectory(root) {
  return collectProjectFiles(root).map(({ path: filePath, base64 }) => ({
    path: filePath,
    bytes: base64,
  }));
}

export function browserFileMapTreeIdentity(files) {
  const treeFiles = files
    .map((file) => {
      const bytes = Buffer.from(file.bytes, 'base64');
      return {
        path: file.path,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  const serialized = treeFiles
    .map((file) => `${file.path}\0${file.bytes}\0${file.sha256}`)
    .join('\n');
  return {
    fileCount: treeFiles.length,
    bytes: treeFiles.reduce((total, file) => total + file.bytes, 0),
    sha256: sha256(Buffer.from(serialized, 'utf8')),
    files: treeFiles,
  };
}

/**
 * Browser-init-only fake File System Access implementation. Keep this function
 * self-contained: Playwright serializes it before the editor application loads.
 */
export const fakeFileSystemInit = ({ rootName, files }) => {
  const fileMap = new Map(files.map((file) => [file.path, file.bytes]));
  const directories = new Set(['']);
  for (const file of files) {
    const parts = file.path.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current.length === 0 ? part : `${current}/${part}`;
      directories.add(current);
    }
  }

  const fail = (message) => { throw new DOMException(message, 'NotFoundError'); };
  const bytesFromValue = async (value) => {
    if (typeof value === 'string') return new TextEncoder().encode(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value?.arrayBuffer) return new Uint8Array(await value.arrayBuffer());
    if (value?.type === 'write') return bytesFromValue(value.data);
    return new Uint8Array();
  };
  const mimeFor = (name) => {
    if (name.endsWith('.json')) return 'application/json';
    if (name.endsWith('.gal')) return 'text/plain';
    if (name.endsWith('.svg')) return 'image/svg+xml';
    if (name.endsWith('.otf')) return 'font/otf';
    if (name.endsWith('.wav')) return 'audio/wav';
    if (name.endsWith('.ogg')) return 'audio/ogg';
    if (name.endsWith('.mp3')) return 'audio/mpeg';
    if (name.endsWith('.webm')) return 'video/webm';
    if (name.endsWith('.mp4')) return 'video/mp4';
    return 'application/octet-stream';
  };
  const addParentDirectories = (filePath) => {
    const parts = filePath.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current.length === 0 ? part : `${current}/${part}`;
      directories.add(current);
    }
  };
  const makeFile = (filePath) => ({
    kind: 'file',
    name: filePath.split('/').pop(),
    async getFile() {
      if (!fileMap.has(filePath)) fail(`missing file ${filePath}`);
      const binary = Uint8Array.from(atob(fileMap.get(filePath)), (character) => character.charCodeAt(0));
      return new File([binary], filePath.split('/').pop(), {
        type: mimeFor(filePath),
        lastModified: 0,
      });
    },
    async createWritable() {
      return {
        async write(value) {
          const bytes = await bytesFromValue(value);
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          fileMap.set(filePath, btoa(binary));
          addParentDirectories(filePath);
        },
        async close() {},
      };
    },
    async isSameEntry(other) {
      return other?.kind === 'file' && other?.name === filePath.split('/').pop();
    },
  });
  const makeDirectory = (directoryPath) => ({
    kind: 'directory',
    name: directoryPath.length === 0 ? rootName : directoryPath.split('/').pop(),
    async getFileHandle(name, options = {}) {
      const child = directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
      if (!fileMap.has(child) && !options.create) fail(`missing file ${child}`);
      if (!fileMap.has(child)) fileMap.set(child, '');
      addParentDirectories(child);
      return makeFile(child);
    },
    async getDirectoryHandle(name, options = {}) {
      const child = directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
      if (!directories.has(child) && !options.create) fail(`missing directory ${child}`);
      directories.add(child);
      return makeDirectory(child);
    },
    values() {
      const children = new Map();
      const prefix = directoryPath.length === 0 ? '' : `${directoryPath}/`;
      for (const directory of directories) {
        if (!directory.startsWith(prefix) || directory === directoryPath) continue;
        const rest = directory.slice(prefix.length);
        if (!rest.includes('/')) children.set(rest, makeDirectory(directory));
      }
      for (const filePath of fileMap.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        if (!rest.includes('/')) children.set(rest, makeFile(filePath));
      }
      return (async function* entries() {
        for (const entry of [...children.values()].sort((left, right) => left.name.localeCompare(right.name))) {
          yield entry;
        }
      })();
    },
    async removeEntry(name) {
      const child = directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
      fileMap.delete(child);
      for (const filePath of [...fileMap.keys()]) {
        if (filePath.startsWith(`${child}/`)) fileMap.delete(filePath);
      }
      for (const directory of [...directories]) {
        if (directory === child || directory.startsWith(`${child}/`)) directories.delete(directory);
      }
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    async isSameEntry(other) {
      return other?.kind === 'directory' && other?.name === (directoryPath.length === 0 ? rootName : directoryPath.split('/').pop());
    },
  });

  window.__surdetDumpFakeRoot = () => [...fileMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, bytes]) => ({ path: filePath, bytes }));
  window.showDirectoryPicker = async () => makeDirectory('');
};
