import { imageSize } from 'image-size';
import { projectUiNineSlice, type ProjectUiDocument, type ProjectUiNode } from '@surdet/core';
import type { ProjectAssetCatalog } from './contracts.js';
import { AuthoringOperationError } from './change-session.js';

export type UiAssetReader = (path: string) => Promise<Uint8Array>;

export function uiSliceAssets(ui: ProjectUiDocument | null, assets: ProjectAssetCatalog): Array<{ node: ProjectUiNode; path: string }> {
  const result: Array<{ node: ProjectUiNode; path: string }> = [];
  const visit = (node: ProjectUiNode): void => {
    const image = node.style?.backgroundImage;
    if (image?.slice) {
      const matches = assets.backgrounds.filter(asset => asset.key === image.asset && asset.resolved);
      if (matches.length !== 1) throw new AuthoringOperationError('UI_INVALID', `九宫格图片缺失或不唯一：${image.asset}`);
      result.push({ node, path: matches[0]!.sourcePath });
    }
    node.children?.forEach(visit);
  };
  if (ui) Object.values(ui.pages).forEach(root => { if (root) visit(root); });
  return result;
}

/** Actual bytes are supplied by each host's existing safe project-file reader. No filesystem imports. */
export function validateUiImageBytes(ui: ProjectUiDocument | null, assets: ProjectAssetCatalog, read: (path: string) => Uint8Array): void {
  const sizes = new Map<string, { width: number; height: number }>();
  for (const { node, path } of uiSliceAssets(ui, assets)) {
    try {
      let size = sizes.get(path);
      if (!size) {
        const metadata = imageSize(read(path));
        if (metadata.images && metadata.images.length > 1) throw new Error('图片包含多个候选尺寸，无法确定九宫格原图；请改用单幅图片');
        size = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8
          ? { width: metadata.height, height: metadata.width } : { width: metadata.width, height: metadata.height };
        sizes.set(path, size);
      }
      projectUiNineSlice(size, node.frame, node.style!.backgroundImage!.slice!);
    } catch (error) {
      throw new AuthoringOperationError('UI_INVALID', `UI 节点 ${node.id} 的九宫格图片 ${path}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Loads only sliced images; ordinary UI edits retain their existing path-only checks. */
export async function readUiImageFiles(ui: ProjectUiDocument | null, assets: ProjectAssetCatalog, read?: UiAssetReader): Promise<Map<string, Uint8Array>> {
  const paths = [...new Set(uiSliceAssets(ui, assets).map(entry => entry.path))];
  if (paths.length && !read) throw new AuthoringOperationError('UI_INVALID', '九宫格修改需要读取项目图片的真实尺寸');
  return new Map(await Promise.all(paths.map(async path => {
    try { return [path, await read!(path)] as const; }
    catch (error) { throw new AuthoringOperationError('UI_INVALID', `无法读取九宫格图片 ${path}：${error instanceof Error ? error.message : String(error)}`); }
  })));
}
