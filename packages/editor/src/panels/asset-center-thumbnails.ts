import type { ProjectAssetItem, ProjectAssetKind } from '@surdet/authoring';
import type { DirAsset } from '../assets.js';

export interface AssetThumbnailDescriptor {
  loadable: boolean;
  label: string;
  detail: string;
  fit: 'cover' | 'contain';
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
