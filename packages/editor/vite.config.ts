import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
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
