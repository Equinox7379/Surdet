import type { CompiledScene } from '../dsl/ast.js';

/**
 * 场景注册表：管理编译产物的注册、查找与跳转目标寻址。
 * 目标格式：sceneId 或 sceneId.label。
 */
export class SceneRegistry {
  #scenes = new Map<string, CompiledScene>();

  /** 注册场景（重复注册抛错） */
  register(scene: CompiledScene): void {
    if (this.#scenes.has(scene.sceneId)) {
      throw new Error(`Scene '${scene.sceneId}' already registered`);
    }
    this.#scenes.set(scene.sceneId, scene);
  }

  has(sceneId: string): boolean {
    return this.#scenes.has(sceneId);
  }

  get(sceneId: string): CompiledScene {
    const scene = this.#scenes.get(sceneId);
    if (!scene) {
      throw new Error(`Scene '${sceneId}' not registered`);
    }
    return scene;
  }

  /** 全部已注册场景 */
  all(): CompiledScene[] {
    return [...this.#scenes.values()];
  }

  /**
   * 解析跳转目标：sceneId（场景开头）或 sceneId.label。
   * 返回目标场景与指令索引。
   */
  resolve(target: string): { scene: CompiledScene; pc: number } {
    const dot = target.indexOf('.');
    if (dot >= 0) {
      const sceneId = target.slice(0, dot);
      const label = target.slice(dot + 1);
      const scene = this.get(sceneId);
      const pc = scene.labels.get(label);
      if (pc === undefined) {
        throw new Error(`Scene '${sceneId}' has no label '@label ${label}'`);
      }
      return { scene, pc };
    }
    return { scene: this.get(target), pc: 0 };
  }
}
