// .gal 的唯一 Vite HMR 接受边界；主入口不自接受，避免长期运行时被重新执行。
export const sceneFiles = import.meta.glob('../content/scenario/**/*.[gG][aA][lL]', {
  query: '?raw',
  import: 'default',
});

if (import.meta.hot) {
  import.meta.hot.accept();
}
