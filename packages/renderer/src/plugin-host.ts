import type { RenderQuality } from './quality.js';

/** Narrow formal plugin view; legacy stage types do not cross the runtime boundary. */
export interface RendererPluginStage {
  readonly getQuality?: () => RenderQuality;
}

export const RENDERER_PLUGIN_API = 1 as const;

export interface RendererPluginContext {
  readonly deltaMs: number;
  readonly stage: RendererPluginStage;
  readonly quality?: RenderQuality;
}

export interface RendererPlugin {
  id: string;
  apiVersion?: number;
  onFrame?(context: RendererPluginContext): void;
  onDispose?(): void;
}

export interface RendererPluginDiagnostic {
  pluginId: string;
  message: string;
}

/**
 * 渲染扩展宿主：插件按注册顺序运行，单个插件失败会被隔离并停用，不能拖死主循环。
 * 插件只获得受限的舞台投影接口，不获得 Node/Electron 或任意文件系统能力。
 */
export class RendererPluginHost {
  #plugins = new Map<string, RendererPlugin>();
  #disabled = new Set<string>();
  #diagnostics: RendererPluginDiagnostic[] = [];
  #stage: RendererPluginStage | null = null;

  attach(stage: RendererPluginStage): void { this.#stage = stage; }
  detach(): void { this.#stage = null; }

  register(plugin: RendererPlugin): void {
    if (!/^[A-Za-z0-9_.-]+$/.test(plugin.id)) throw new Error(`invalid renderer plugin id '${plugin.id}'`);
    if (plugin.apiVersion !== undefined && plugin.apiVersion !== RENDERER_PLUGIN_API) {
      throw new Error(`renderer plugin '${plugin.id}' requires unsupported API ${plugin.apiVersion}`);
    }
    if (this.#plugins.has(plugin.id)) throw new Error(`duplicate renderer plugin '${plugin.id}'`);
    this.#plugins.set(plugin.id, plugin);
  }

  unregister(id: string): boolean {
    const plugin = this.#plugins.get(id);
    if (!plugin) return false;
    this.#plugins.delete(id);
    this.#disabled.delete(id);
    try { plugin.onDispose?.(); } catch (err) { this.#record(id, err); }
    return true;
  }

  update(deltaMs: number): void {
    if (!this.#stage) return;
    for (const plugin of this.#plugins.values()) {
      if (this.#disabled.has(plugin.id) || !plugin.onFrame) continue;
      try {
        plugin.onFrame({ deltaMs, stage: this.#stage, quality: this.#stage.getQuality?.() });
      } catch (err) {
        this.#disabled.add(plugin.id);
        this.#record(plugin.id, err);
      }
    }
  }

  dispose(): void {
    for (const plugin of this.#plugins.values()) {
      try { plugin.onDispose?.(); } catch (err) { this.#record(plugin.id, err); }
    }
    this.#plugins.clear();
    this.#disabled.clear();
    this.#stage = null;
  }

  diagnostics(): readonly RendererPluginDiagnostic[] { return this.#diagnostics.slice(); }
  get size(): number { return this.#plugins.size; }

  #record(pluginId: string, error: unknown): void {
    this.#diagnostics.push({ pluginId, message: error instanceof Error ? error.message : String(error) });
  }
}
