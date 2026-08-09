# Surdet 能力矩阵

> 本文件由 `docs/capabilities.json` 生成。请修改 JSON 后运行 `npm run docs:capabilities`，不要手工编辑本文件。

| 能力 | 类型 | Core | Renderer | Editor | Host | 测试证据 | 文档证据 | 当前限制 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `clear` | dsl | ✅ | — | — | ✅ | `packages/core/test/compiler.test.ts`<br>`packages/core/test/interpreter-save.test.ts`<br>`examples/zero-after-midnight/src/main.ts` | `README.md`<br>`docs/dsl-spec.md` | 解释器负责本周目记录并广播事件；跨周目全局记录由宿主 Profile bridge 持久化。 |
| `mov` | dsl | ✅ | ✅ | — | — | `packages/core/test/compiler.test.ts`<br>`packages/renderer/test/adv-renderer.test.ts`<br>`packages/renderer/test/pixi-stage.test.ts` | `README.md`<br>`docs/dsl-spec.md` | — |
| `particle` | dsl | ✅ | ✅ | — | — | `packages/core/test/compiler.test.ts`<br>`packages/renderer/test/adv-renderer.test.ts`<br>`packages/renderer/test/pixi-stage.test.ts` | `README.md`<br>`docs/dsl-spec.md` | 当前为内置轻量粒子表现，不是可编排的完整粒子编辑器。 |
| `tint` | dsl | ✅ | ✅ | — | — | `packages/core/test/compiler.test.ts`<br>`packages/renderer/test/adv-renderer.test.ts`<br>`packages/renderer/test/pixi-stage.test.ts` | `README.md`<br>`docs/dsl-spec.md` | — |
| `battle-formation` | system | 🛠️ | 🛠️ | 🛠️ | 🛠️ | — | `docs/ENGINE-OPTIMIZATION-RECOMMENDATIONS-2026-08-08.md` | 当前战斗使用 1D 位置；开战前阵型编辑、占位和阻挡规则尚未定义。 |
| `battle-move` | system | ✅ | ✅ | — | ✅ | `packages/core/test/combat.test.ts`<br>`packages/renderer/test/gallery.test.ts`<br>`examples/starter/src/main.ts` | `README.md`<br>`docs/dsl-spec.md` | 移动是 1D 位置模型，不包含阵型编辑或多位置布局。 |
| `profile-storage` | system | — | — | — | ✅ | `packages/host/test/profile-store.test.ts`<br>`packages/shell/test/profile-store.test.ts`<br>`examples/starter/src/main.ts`<br>`examples/zero-after-midnight/src/main.ts` | `README.md`<br>`docs/ENGINE-OPTIMIZATION-RECOMMENDATIONS-2026-08-08.md` | Profile 数据与普通 slot 存档分离；Electron 损坏数据宽容回退，浏览器保留旧 localStorage 兼容读取。 |
| `rollback` | system | — | ✅ | — | ✅ | `packages/renderer/test/rollback-buffer.test.ts`<br>`examples/starter/src/main.ts`<br>`examples/zero-after-midnight/src/main.ts` | `README.md`<br>`docs/AI-GUIDE.md` | 运行时历史缓冲默认上限 50 帧；系统交互、菜单和读写档期间不允许回退。 |
| `save-hooks` | system | ✅ | — | — | ✅ | `packages/core/test/interpreter-save.test.ts`<br>`packages/shell/e2e/game.e2e.mjs`<br>`packages/host/test/system-router.test.ts`<br>`examples/zero-after-midnight/src/main.ts` | `README.md`<br>`docs/dsl-spec.md` | — |
| `hot-reload` | tooling | ✅ | ✅ | — | ✅ | `packages/core/test/audit-fixes.test.ts`<br>`packages/renderer/test/scene-hot-reload.test.ts`<br>`examples/starter/src/main.ts`<br>`examples/zero-after-midnight/src/main.ts` | `README.md`<br>`docs/AI-GUIDE.md` | 仅 Vite 开发环境支持 .gal 场景热替换；正式包不启动文件监听器。 |
| `ambience` | ui | ✅ | ✅ | ✅ | — | `packages/core/test/compiler.test.ts`<br>`packages/renderer/test/audio-manager.test.ts`<br>`packages/renderer/test/adv-renderer.test.ts`<br>`packages/editor/src/panels/editor.ts` | `README.md`<br>`docs/dsl-spec.md`<br>`docs/AI-GUIDE.md` | 同一时间最多播放一条环境音；与 BGM、SE、语音分轨独立。 |
| `backlog` | ui | ✅ | ✅ | — | ✅ | `packages/renderer/test/pixi-stage.test.ts` | `README.md`<br>`docs/dsl-spec.md` | 文字记录为当前会话级数据，不跨存档持久化。 |
| `gallery-cg` | ui | ✅ | ✅ | — | ✅ | `packages/renderer/test/gallery.test.ts`<br>`packages/renderer/test/pixi-stage.test.ts` | `README.md`<br>`docs/dsl-spec.md` | — |
| `gallery-text` | ui | ✅ | ✅ | — | ✅ | `packages/renderer/test/gallery.test.ts`<br>`examples/zero-after-midnight/src/main.ts` | `README.md`<br>`docs/dsl-spec.md` | 文本回想依配置跳转到场景与 label，不提供独立的文本资源编辑器。 |
| `renderer-lifecycle` | ui | — | ✅ | ✅ | — | `packages/renderer/test/lifecycle/render-lifecycle.test.ts`<br>`packages/renderer/test/lifecycle/async-generation.test.ts`<br>`packages/renderer/test/integration/resource-cycles.test.ts`<br>`packages/editor/test/preview-runtime-lifecycle.test.ts` | `README.md`<br>`docs/renderer-v2-migration.md`<br>`docs/AI-GUIDE.md` | 正式候选仍保留 M7.5 sceneP95Ms 性能红灯；本能力不代表性能门禁已全绿。 |
| `renderer-v2-runtime` | ui | — | ✅ | ✅ | ✅ | `packages/renderer/test/api/renderer-contract.test.ts`<br>`packages/renderer/test/api/query-purity.test.ts`<br>`packages/renderer/test/integration/renderer-runtime.test.ts`<br>`packages/editor/test/preview-runtime-contract.test.ts`<br>`packages/host/test/system-router.test.ts` | `README.md`<br>`docs/renderer-v2-migration.md`<br>`docs/AI-GUIDE.md` | PixiStage/AdvRenderer 在当前 major 的一版兼容窗口内保留；新生产消费者必须通过 Runtime v2 接线。 |
| `transition-registry` | ui | — | ✅ | ✅ | — | `packages/renderer/test/transition-registry.test.ts`<br>`packages/core/test/compiler.test.ts`<br>`packages/cli/test/lint.test.ts`<br>`packages/editor/src/panels/editor.ts` | `README.md`<br>`docs/dsl-spec.md`<br>`docs/AI-GUIDE.md` | 当前提供内置注册表与四种安全转场；自定义插件转场不在本轮范围。 |

状态含义：✅ 已有代码与测试证据；🛠️ 已列入计划但尚未作为当前能力交付；— 不适用。
