/**
 * pixi.js/unsafe-eval 垫片（官方未提供类型声明）：
 * 替换 pixi 内部基于 new Function 的 uniform 解析实现，使其在禁用
 * unsafe-eval 的 CSP 环境（Electron 加固壳/内嵌 webview）可运行。导入即生效。
 */
declare module 'pixi.js/unsafe-eval';
