import type { ProjectAssetItem, ProjectAssetKind } from '@surdet/authoring';
import type { DirAsset } from '../assets.js';

export interface AssetThumbnailDescriptor {
  loadable: boolean;
  label: string;
  detail: string;
  fit: 'cover' | 'contain';
}

export interface AssetThumbnailSession {
  mount(host: HTMLElement, item: ProjectAssetItem, dirAsset: DirAsset | undefined): void;
  dispose(): void;
}

const KIND_LABELS: Record<ProjectAssetKind, string> = {
  background: '背景',
  portrait: '立绘',
  avatar: '头像',
  music: '音乐',
  ambience: '环境音',
  'sound-effect': '音效',
  voice: '语音',
  video: '视频',
  font: '字体',
  license: '许可证/说明',
  other: '其他',
};

function thumbnailFit(kind: ProjectAssetKind): 'cover' | 'contain' {
  return kind === 'background' || kind === 'avatar' ? 'cover' : 'contain';
}

function formatLabel(item: ProjectAssetItem): string {
  return item.format?.trim() ? item.format.trim().toUpperCase() : '格式未识别';
}

export function describeAssetThumbnail(
  item: ProjectAssetItem,
  dirAsset: DirAsset | undefined,
): AssetThumbnailDescriptor {
  const fit = thumbnailFit(item.kind);
  if (!item.physical) {
    return { loadable: false, label: '文件缺失', detail: '无物理文件', fit };
  }

  const imageKind = item.kind === 'background' || item.kind === 'portrait' || item.kind === 'avatar';
  if (imageKind && dirAsset?.isImage && dirAsset.handle !== null) {
    return {
      loadable: true,
      label: `${KIND_LABELS[item.kind]}图片`,
      detail: formatLabel(item),
      fit,
    };
  }
  if (imageKind) {
    return { loadable: false, label: '暂无缩略图', detail: formatLabel(item), fit };
  }
  return {
    loadable: false,
    label: KIND_LABELS[item.kind],
    detail: formatLabel(item),
    fit,
  };
}

interface PendingThumbnail {
  host: HTMLElement;
  item: ProjectAssetItem;
  dirAsset: DirAsset;
  descriptor: AssetThumbnailDescriptor;
}

let thumbnailGeneration = 0;
let activeSession: AssetThumbnailSession | null = null;

function appendPlaceholder(
  host: HTMLElement,
  descriptor: AssetThumbnailDescriptor,
  state: 'loading' | 'unavailable' | 'error',
  label = descriptor.label,
): void {
  const title = document.createElement('span');
  title.className = 'asset-center-thumbnail-label';
  title.textContent = label;
  const detail = document.createElement('small');
  detail.className = 'asset-center-thumbnail-detail';
  detail.textContent = descriptor.detail;
  host.dataset.assetThumbnailState = state;
  host.replaceChildren(title, detail);
}

export function disposeAssetCenterThumbnails(): void {
  thumbnailGeneration += 1;
  activeSession?.dispose();
  activeSession = null;
}

export function beginAssetThumbnailSession(): AssetThumbnailSession {
  if (activeSession !== null) disposeAssetCenterThumbnails();
  const generation = thumbnailGeneration;
  const pendingUrls = new Set<string>();
  const pending = new Map<Element, PendingThumbnail>();
  let disposed = false;

  const releaseUrl = (url: string): void => {
    if (!pendingUrls.delete(url)) return;
    URL.revokeObjectURL(url);
  };

  const load = async ({ host, item, dirAsset, descriptor }: PendingThumbnail): Promise<void> => {
    try {
      const file = await dirAsset.handle!.getFile();
      if (disposed || generation !== thumbnailGeneration) return;
      const url = URL.createObjectURL(file);
      pendingUrls.add(url);
      const image = document.createElement('img');
      image.alt = '';
      image.decoding = 'async';
      image.dataset.assetThumbnailImage = item.assetId;
      image.onload = () => {
        releaseUrl(url);
        if (disposed || generation !== thumbnailGeneration) return;
        host.dataset.assetThumbnailState = 'ready';
      };
      image.onerror = () => {
        releaseUrl(url);
        if (disposed || generation !== thumbnailGeneration) return;
        appendPlaceholder(host, descriptor, 'error', '无法读取缩略图');
      };
      image.src = url;
      host.replaceChildren(image);
    } catch {
      if (disposed || generation !== thumbnailGeneration) return;
      appendPlaceholder(host, descriptor, 'error', '无法读取缩略图');
    }
  };

  const observer = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting && entry.intersectionRatio <= 0) continue;
        const request = pending.get(entry.target);
        if (!request) continue;
        pending.delete(entry.target);
        observer?.unobserve(entry.target);
        void load(request);
      }
    }, { rootMargin: '160px 0px' });

  const session: AssetThumbnailSession = {
    mount(host, item, dirAsset) {
      const descriptor = describeAssetThumbnail(item, dirAsset);
      host.dataset.assetThumbnailFit = descriptor.fit;
      if (!descriptor.loadable || !dirAsset?.handle) {
        appendPlaceholder(host, descriptor, 'unavailable');
        return;
      }
      appendPlaceholder(host, descriptor, 'loading', '正在读取');
      const request = { host, item, dirAsset, descriptor };
      if (observer === null) {
        void load(request);
        return;
      }
      pending.set(host, request);
      observer.observe(host);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      pending.clear();
      for (const url of [...pendingUrls]) releaseUrl(url);
    },
  };
  activeSession = session;
  return session;
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', disposeAssetCenterThumbnails);
