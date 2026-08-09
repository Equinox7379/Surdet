# Renderer v2 M8 working notes

## Task 20 initial legacy-use scan

The scan was intentionally run before Task 21/22 migration. The fixture tests passed, while the repository scan exited with code 1 and reported these production consumers:

```text
examples/shared/rollback-runtime.ts imports legacy renderer symbol AdvRenderer
examples/shared/rollback-runtime.ts imports legacy renderer symbol AdvStage
examples/starter/src/main.ts uses legacy renderer symbol AdvRenderer
examples/starter/src/main.ts uses legacy renderer symbol PixiStage
examples/starter/src/system-adapters.ts imports legacy renderer symbol AdvStage
examples/zero-after-midnight/src/main.ts uses legacy renderer symbol AdvRenderer
examples/zero-after-midnight/src/main.ts uses legacy renderer symbol PixiStage
examples/zero-after-midnight/src/system-adapters.ts imports legacy renderer symbol AdvStage
packages/cli/templates/game/src/main.ts imports legacy renderer symbol AdvRenderer
packages/cli/templates/game/src/main.ts imports legacy renderer symbol PixiStage
packages/editor/src/preview.ts uses legacy renderer symbol AdvRenderer
packages/editor/src/preview.ts uses legacy renderer symbol PixiStage
packages/host/src/create-host.ts imports legacy renderer symbol AdvRenderer
packages/host/src/create-host.ts imports legacy renderer symbol AdvStage
packages/host/src/types.ts imports legacy renderer symbol AdvRenderer
packages/host/src/types.ts imports legacy renderer symbol AdvStage
```

The scan deliberately excludes renderer implementation/test internals and test sources from the consumer list. Legacy implementation files remain covered by the compatibility contracts and boundary tests.

## Task 21 migration checkpoint

Starter and `zero-after-midnight` production entries now construct one `createRendererRuntime()` instance, consume public v2 command/query ports, use `runtime.canvas`, and let the Runtime own frame scheduling. The shared rollback helper uses the narrow v2 port; the font helper uses the asset command port. The post-Task-21 repository scan intentionally still exits with code 1 only for the editor preview and CLI game template, which are Task 22 scope:

```text
packages/cli/templates/game/src/main.ts imports legacy renderer symbol AdvRenderer
packages/cli/templates/game/src/main.ts imports legacy renderer symbol PixiStage
packages/editor/src/preview.ts uses legacy renderer symbol AdvRenderer
packages/editor/src/preview.ts uses legacy renderer symbol PixiStage
```
