import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectAssetItem, ProjectAssetKind } from '@surdet/authoring';
import type { DirAsset } from '../src/assets.js';
import {
  beginAssetThumbnailSession,
  describeAssetThumbnail,
  disposeAssetCenterThumbnails,
} from '../src/panels/asset-center-thumbnails.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const thumbnailSource = readFileSync(path.resolve(testDirectory, '../src/panels/asset-center-thumbnails.ts'), 'utf8');

function projectItem(kind: ProjectAssetKind, sourcePath: string, physical = true): ProjectAssetItem {
  return {
    assetId: physical ? `file:${sourcePath}` : `missing:${kind}:sample`,
    kind,
    key: 'sample',
    sourcePath: physical ? sourcePath : undefined,
    format: sourcePath.split('.').at(-1),
    physical,
    references: [],
    issues: physical ? [] : ['ASSET_REFERENCE_MISSING'],
  };
}

function dirAsset(sourcePath: string, isImage: boolean, withHandle = true): DirAsset {
  return {
    key: 'sample',
    kind: isImage ? 'bg' : 'bgm',
    sourcePath,
    isImage,
    handle: withHandle ? ({ kind: 'file', name: sourcePath.split('/').at(-1) } as FileSystemFileHandle) : null,
  };
}

class FakeElement {
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  isConnected = true;
  className = '';
  textContent = '';

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }
}

class FakeImage extends FakeElement {
  alt = '';
  decoding = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed = new Set<FakeElement>();
  disconnect = vi.fn(() => this.observed.clear());

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target as unknown as FakeElement);
  }

  unobserve(target: Element): void {
    this.observed.delete(target as unknown as FakeElement);
  }

  reveal(...targets: FakeElement[]): void {
    this.callback(targets.map((target) => ({
      target: target as unknown as Element,
      isIntersecting: true,
      intersectionRatio: 1,
    } as IntersectionObserverEntry)), this as unknown as IntersectionObserver);
  }
}

function installThumbnailDom(): { createUrl: ReturnType<typeof vi.fn>; revokeUrl: ReturnType<typeof vi.fn> } {
  FakeIntersectionObserver.instances = [];
  const createUrl = vi.fn((file: File) => `blob:${file.name}`);
  const revokeUrl = vi.fn();
  vi.stubGlobal('document', {
    createElement: (tagName: string) => tagName === 'img' ? new FakeImage() : new FakeElement(),
  });
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  return { createUrl, revokeUrl };
}

function handledImage(sourcePath: string, getFile: () => Promise<File>): DirAsset {
  return {
    key: 'sample',
    kind: 'bg',
    sourcePath,
    isImage: true,
    handle: { kind: 'file', name: sourcePath.split('/').at(-1)!, getFile } as FileSystemFileHandle,
  };
}

async function settleAsyncThumbnail(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  disposeAssetCenterThumbnails();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Asset Center thumbnail presentation', () => {
  it('loads real image handles and chooses a content-aware fit', () => {
    const background = projectItem('background', 'content/assets/bg/harbor.png');
    const portrait = projectItem('portrait', 'content/assets/portrait/lynn.png');
    const avatar = projectItem('avatar', 'content/assets/avatar/lynn.png');

    expect(describeAssetThumbnail(background, dirAsset(background.sourcePath!, true))).toEqual({
      loadable: true,
      label: '背景图片',
      detail: 'PNG',
      fit: 'cover',
    });
    expect(describeAssetThumbnail(portrait, dirAsset(portrait.sourcePath!, true))).toMatchObject({
      loadable: true,
      label: '立绘图片',
      fit: 'contain',
    });
    expect(describeAssetThumbnail(avatar, dirAsset(avatar.sourcePath!, true))).toMatchObject({
      loadable: true,
      label: '头像图片',
      fit: 'cover',
    });
  });

  it('uses precise Chinese placeholders for non-images and unavailable handles', () => {
    const audio = projectItem('music', 'content/assets/bgm/opening.wav');
    const background = projectItem('background', 'content/assets/bg/harbor.png');

    expect(describeAssetThumbnail(audio, dirAsset(audio.sourcePath!, false))).toEqual({
      loadable: false,
      label: '音乐',
      detail: 'WAV',
      fit: 'contain',
    });
    expect(describeAssetThumbnail(background, dirAsset(background.sourcePath!, true, false))).toEqual({
      loadable: false,
      label: '暂无缩略图',
      detail: 'PNG',
      fit: 'cover',
    });
  });

  it('never invents a thumbnail for a missing reference', () => {
    const missing = projectItem('voice', 'opening.ogg', false);

    expect(describeAssetThumbnail(missing, undefined)).toEqual({
      loadable: false,
      label: '文件缺失',
      detail: '无物理文件',
      fit: 'contain',
    });
  });

  it('keeps viewport loading and Object URL ownership inside one disposable session', () => {
    expect(thumbnailSource).toMatch(/export interface AssetThumbnailSession/);
    expect(thumbnailSource).toMatch(/beginAssetThumbnailSession/);
    expect(thumbnailSource).toMatch(/disposeAssetCenterThumbnails/);
    expect(thumbnailSource).toMatch(/IntersectionObserver/);
    expect(thumbnailSource).toMatch(/rootMargin\s*:\s*['"]160px 0px['"]/);
    expect(thumbnailSource).toMatch(/URL\.createObjectURL/);
    expect(thumbnailSource).toMatch(/URL\.revokeObjectURL/);
    expect(thumbnailSource).toMatch(/pendingUrls/);
    expect(thumbnailSource).toMatch(/generation/);
    expect(thumbnailSource).toMatch(/\.disconnect\(\)/);
    expect(thumbnailSource).toMatch(/typeof IntersectionObserver/);
  });

  it('drops an in-flight file read after the thumbnail session is disposed', async () => {
    const { createUrl } = installThumbnailDom();
    let resolveFile!: (file: File) => void;
    const file = new File(['image'], 'harbor.png', { type: 'image/png' });
    const host = new FakeElement();
    const session = beginAssetThumbnailSession();
    session.mount(
      host as unknown as HTMLElement,
      projectItem('background', 'content/assets/bg/harbor.png'),
      handledImage('content/assets/bg/harbor.png', () => new Promise((resolve) => { resolveFile = resolve; })),
    );

    const observer = FakeIntersectionObserver.instances.at(-1)!;
    observer.reveal(host);
    session.dispose();
    resolveFile(file);
    await settleAsyncThumbnail();

    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(createUrl).not.toHaveBeenCalled();
    expect(host.dataset.assetThumbnailState).toBe('loading');
  });

  it('releases every created Object URL once across image events and disposal', async () => {
    const { createUrl, revokeUrl } = installThumbnailDom();
    const session = beginAssetThumbnailSession();
    const hosts = ['success.png', 'error.png', 'pending.png'].map(() => new FakeElement());
    hosts.forEach((host, index) => {
      const name = ['success.png', 'error.png', 'pending.png'][index]!;
      session.mount(
        host as unknown as HTMLElement,
        projectItem('background', `content/assets/bg/${name}`),
        handledImage(`content/assets/bg/${name}`, async () => new File(['image'], name, { type: 'image/png' })),
      );
    });

    FakeIntersectionObserver.instances.at(-1)!.reveal(...hosts);
    await settleAsyncThumbnail();
    const success = hosts[0]!.children[0] as FakeImage;
    const error = hosts[1]!.children[0] as FakeImage;
    success.onload?.();
    error.onerror?.();
    session.dispose();
    disposeAssetCenterThumbnails();

    expect(createUrl).toHaveBeenCalledTimes(3);
    expect(revokeUrl.mock.calls.map(([url]) => url).sort()).toEqual([
      'blob:error.png',
      'blob:pending.png',
      'blob:success.png',
    ]);
    expect(hosts[0]!.dataset.assetThumbnailState).toBe('ready');
    expect(hosts[1]!.dataset.assetThumbnailState).toBe('error');
  });
});
