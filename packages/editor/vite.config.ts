import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { reviewAuthorityVitePlugin } from '../cli/src/review-authority/vite-plugin.js';
import { assetImportAuthorityVitePlugin } from '../cli/src/asset-import-authority/vite-plugin.js';

const projectLauncher = process.env['SURDET_EDITOR_PROJECT_LAUNCHER'] === '1';
const projectRoot = process.env['SURDET_EDITOR_PROJECT_ROOT'];
const dataRoot = process.env['SURDET_EDITOR_ASSET_IMPORT_DATA_ROOT'];
if (projectLauncher && (projectRoot === undefined || dataRoot === undefined)) {
  throw new Error('绑定项目启动器缺少 projectRoot 或 dataRoot');
}
const assetImportPlugin = projectLauncher
  ? assetImportAuthorityVitePlugin({
    projectRoot,
    dataRoot,
  })
  : assetImportAuthorityVitePlugin(undefined);

export default defineConfig({
  // Review transactions share the Agent/Editor coordination store. --data-root
  // belongs to asset-import storage and may legitimately be a different folder.
  plugins: [reviewAuthorityVitePlugin(projectLauncher ? { projectRoot } : {}), assetImportPlugin],
  server: { port: 5174 },
  build: {
    rollupOptions: {
      // 多页面：主编辑器 + 预览 iframe 运行器（M6 E4）
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        preview: fileURLToPath(new URL('preview.html', import.meta.url)),
      },
    },
  },
});
