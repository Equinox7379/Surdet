import { describe, expect, it } from 'vitest';
import type { ProjectAssetItem, ProjectAssetKind } from '@surdet/authoring';
import type { DirAsset } from '../src/assets.js';
import { describeAssetThumbnail } from '../src/panels/asset-center-thumbnails.js';

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
});
