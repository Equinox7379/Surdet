import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    // Pixi 通过 fetch 加载 SVG；强制保留为同源文件 URL，避免 CSP 下 data: 内联资源加载失败。
    assetsInlineLimit: 0,
  },
});
